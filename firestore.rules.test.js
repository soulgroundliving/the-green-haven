/**
 * Firestore security rules unit tests.
 *
 * Why this exists: a single bad allow rule (e.g. anyone-write to taxSummary,
 * or anonymous LIFF tenant being allowed to bump their own gamification
 * points) is a silent catastrophe — no error in CI, no console warning, the
 * rule just deploys and someone exploits it. This suite encodes the
 * invariants we never want to lose.
 *
 * What it covers (15 critical paths, NOT exhaustive — focus is on
 * "would-be-disaster" paths):
 *   1. Default deny — random/unknown collections
 *   2. Anonymous tenants CANNOT mutate gamification, rentAmount, building, roomId, tenantId
 *   3. Anonymous tenants CAN update their own non-sensitive fields (phone, email, lineID)
 *   4. taxSummary is NEVER client-writable (CF-only via admin SDK)
 *   5. rateLimits is fully sealed (CF-only)
 *   6. verifiedSlips: admin write only
 *   7. leaseRequests: LIFF tenant creates own room only, only admin updates
 *   8. complaints: any auth creates, only admin modifies/deletes
 *   9. rewards / system / announcements / wellness_articles: admin write only
 *  10. communityEvents / communityDocuments: admin write only, public read
 *  11. buildings + nested rooms: admin write only
 *  12. liffUsers: any auth creates, only admin approves/deletes
 *  13. Anonymous tenant cannot escalate to admin paths
 *  14. Marketplace: owner-only update/delete
 *  15. wellnessClaimed: tenant create-only (no update/delete)
 *
 * Runs against Firebase Local Emulator started by:
 *   firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc, getDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup, getDocs, query } = require('firebase/firestore');
const { readFileSync } = require('node:fs');
const { describe, before, after, beforeEach, it } = require('node:test');

let testEnv;

// Auth contexts ---------------------------------------------------------
const ANON = (uid = 'tenant-1') => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'anonymous' }
});
// Phase 4A Stage 2: admin requires custom claim admin:true
const EMAIL_ADMIN = (uid = 'admin-1') => testEnv.authenticatedContext(uid, {
  admin: true,
  firebase: { sign_in_provider: 'password' }
});
// accountant1@test.com: tax-filing read-only, no admin claim
const ACCOUNTANT = (uid = 'accountant-1') => testEnv.authenticatedContext(uid, {
  accountant: true,
  firebase: { sign_in_provider: 'password' }
});
// Email user with no custom claim — must be denied admin paths after Stage 2
const EMAIL_NO_CLAIM = (uid = 'noclaim-1') => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'password' }
});
// LIFF-linked tenant (post-liffSignIn): custom-token UID + room/building claims
const LIFF_TENANT = (uid = 'line:U00000000000000000000000000000001', room = '101', building = 'rooms') =>
  testEnv.authenticatedContext(uid, {
    room, building,
    firebase: { sign_in_provider: 'custom' }
  });
// LIFF-linked prospect (post-liffBookingSignIn): custom-token UID prefix
// "book:" + role:'prospect' claim. No room/building — they don't have one yet.
const PROSPECT = (uid = 'book:U00000000000000000000000000000001') =>
  testEnv.authenticatedContext(uid, {
    role: 'prospect',
    firebase: { sign_in_provider: 'custom' }
  });
const UNAUTH = () => testEnv.unauthenticatedContext();
// Tier 3c: building manager — managedBuildings claim scopes read to their building(s)
const BUILDING_MANAGER = (buildings = ['rooms'], uid = 'manager-1') =>
  testEnv.authenticatedContext(uid, {
    managedBuildings: buildings,
    firebase: { sign_in_provider: 'password' }
  });

// Seed helpers ---------------------------------------------------------
async function seedTenant(tenantData = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'tenants/rooms/list/101'), {
      name: 'Original',
      phone: '0801234567',
      email: 'orig@test',
      lineID: 'origLine',
      gamification: { points: 100, level: 2 },
      rentAmount: 5000,
      building: 'rooms',
      roomId: '101',
      tenantId: 'TENANT_1',
      ...tenantData
    });
  });
}

async function seedDoc(path, data = { v: 1 }) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

// Lifecycle ------------------------------------------------------------
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || 'localhost',
      port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10)
    }
  });
});

after(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

// Tests ----------------------------------------------------------------
describe('Default deny', () => {
  it('unauthenticated user cannot read random/unknown collection', async () => {
    const db = UNAUTH().firestore();
    await assertFails(getDoc(doc(db, 'definitelyNotARealCollection/x')));
  });

  it('anonymous tenant cannot read random/unknown collection', async () => {
    const db = ANON().firestore();
    await assertFails(getDoc(doc(db, 'definitelyNotARealCollection/x')));
  });

  it('email admin cannot write random/unknown collection (catch-all deny)', async () => {
    const db = EMAIL_ADMIN().firestore();
    await assertFails(setDoc(doc(db, 'definitelyNotARealCollection/x'), { v: 1 }));
  });
});

describe('tenants — sensitive field protection', () => {
  beforeEach(async () => { await seedTenant(); });

  it('anonymous tenant CANNOT modify gamification subobject', async () => {
    const db = ANON().firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      gamification: { points: 999999, level: 99 }
    }));
  });

  it('anonymous tenant CANNOT modify rentAmount', async () => {
    const db = ANON().firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), { rentAmount: 1 }));
  });

  it('anonymous tenant CANNOT modify building/roomId/tenantId', async () => {
    const db = ANON().firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), { building: 'nest' }));
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), { roomId: '999' }));
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), { tenantId: 'HIJACK' }));
  });

  it('anonymous tenant CAN update non-sensitive contact fields', async () => {
    const db = ANON().firestore();
    await assertSucceeds(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      phone: '0899999999',
      email: 'new@test',
      lineID: 'newLine'
    }));
  });

  it('email admin CAN modify any tenant field including gamification', async () => {
    const db = EMAIL_ADMIN().firestore();
    await assertSucceeds(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      gamification: { points: 500 },
      rentAmount: 6000
    }));
  });

  it('admin can read any tenant doc', async () => {
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101')));
  });

  it('linked tenant CAN read their own room doc (linkedAuthUid matches)', async () => {
    // seed with linkedAuthUid = 'tenant-1' (matches ANON uid)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants/rooms/list/101'), {
        name: 'Test', linkedAuthUid: 'tenant-1'
      });
    });
    await assertSucceeds(getDoc(doc(ANON('tenant-1').firestore(), 'tenants/rooms/list/101')));
  });

  it('unlinked anon tenant CANNOT read any tenant doc (Phase 4C-2)', async () => {
    // doc has linkedAuthUid of a different uid
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants/rooms/list/101'), {
        name: 'Other', linkedAuthUid: 'tenant-99'
      });
    });
    await assertFails(getDoc(doc(ANON('tenant-1').firestore(), 'tenants/rooms/list/101')));
  });

  it('tenant CANNOT read a different room even if both are signed in', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants/rooms/list/202'), {
        name: 'Neighbour', linkedAuthUid: 'tenant-2'
      });
    });
    await assertFails(getDoc(doc(ANON('tenant-1').firestore(), 'tenants/rooms/list/202')));
  });
});

describe('taxSummary — financial data, CF-only writes, admin-only reads', () => {
  it('email admin CANNOT write (CF-only via admin SDK)', async () => {
    const db = EMAIL_ADMIN().firestore();
    await assertFails(setDoc(doc(db, 'taxSummary/2569'), { totalRevenue: 0 }));
  });

  it('anonymous tenant CANNOT write', async () => {
    await assertFails(setDoc(doc(ANON().firestore(), 'taxSummary/2569'), { totalRevenue: 999 }));
  });

  it('admin CAN read, anonymous tenant CANNOT (Phase 3 tightening)', async () => {
    await seedDoc('taxSummary/2569', { totalRevenue: 100000 });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'taxSummary/2569')));
    await assertFails(getDoc(doc(ANON().firestore(), 'taxSummary/2569')));
  });
});

describe('verifiedSlips / historicalRevenue / leaseRequests / paymentHistory / redemptions — admin-only reads (Phase 3)', () => {
  it('anon tenant CANNOT read verifiedSlips', async () => {
    await seedDoc('verifiedSlips/s1', { amount: 100 });
    await assertFails(getDoc(doc(ANON().firestore(), 'verifiedSlips/s1')));
  });
  it('admin CAN read verifiedSlips', async () => {
    await seedDoc('verifiedSlips/s1', { amount: 100 });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'verifiedSlips/s1')));
  });

  it('anon tenant CANNOT read historicalRevenue', async () => {
    await seedDoc('historicalRevenue/2569', { totalRevenue: 1 });
    await assertFails(getDoc(doc(ANON().firestore(), 'historicalRevenue/2569')));
  });
  it('admin CAN read historicalRevenue', async () => {
    await seedDoc('historicalRevenue/2569', { totalRevenue: 1 });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'historicalRevenue/2569')));
  });

  it('anon tenant CANNOT read leaseRequests', async () => {
    await seedDoc('leaseRequests/req-1', { status: 'pending' });
    await assertFails(getDoc(doc(ANON().firestore(), 'leaseRequests/req-1')));
  });

  it('anon tenant CANNOT read paymentHistory', async () => {
    await seedDoc('tenants/nest/list/101/paymentHistory/2026-04', { amount: 2828 });
    await assertFails(getDoc(doc(ANON().firestore(), 'tenants/nest/list/101/paymentHistory/2026-04')));
  });

  it('anon tenant CANNOT read redemptions', async () => {
    await seedDoc('tenants/nest/list/101/redemptions/r1', { rewardId: 'x' });
    await assertFails(getDoc(doc(ANON().firestore(), 'tenants/nest/list/101/redemptions/r1')));
  });
});

describe('rateLimits — fully sealed', () => {
  it('admin cannot read or write', async () => {
    const db = EMAIL_ADMIN().firestore();
    await assertFails(getDoc(doc(db, 'rateLimits/anyKey')));
    await assertFails(setDoc(doc(db, 'rateLimits/anyKey'), { count: 1 }));
  });

  it('anon cannot read or write', async () => {
    const db = ANON().firestore();
    await assertFails(getDoc(doc(db, 'rateLimits/anyKey')));
    await assertFails(setDoc(doc(db, 'rateLimits/anyKey'), { count: 1 }));
  });
});

describe('verifiedSlips — admin write only', () => {
  it('anonymous tenant cannot write', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'verifiedSlips'), { amount: 99999 }));
  });

  it('email admin can write', async () => {
    await assertSucceeds(addDoc(collection(EMAIL_ADMIN().firestore(), 'verifiedSlips'), { amount: 100 }));
  });
});

describe('leaseRequests — LIFF tenant creates own room only, admin updates', () => {
  it('anon tenant CANNOT create — no room claims (anonymous bypass closed 2026-04-28)', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'leaseRequests'),
      { type: 'renew', room: '101', building: 'rooms' }));
  });

  it('LIFF tenant CAN create for their own room (claims match payload)', async () => {
    await assertSucceeds(addDoc(collection(LIFF_TENANT().firestore(), 'leaseRequests'),
      { type: 'renew', room: '101', building: 'rooms', tenantId: 'TENANT_1' }));
  });

  it('LIFF tenant CANNOT create for a different room (cross-tenant forgery)', async () => {
    await assertFails(addDoc(collection(LIFF_TENANT().firestore(), 'leaseRequests'),
      { type: 'moveout', room: '999', building: 'rooms', moveOutDate: '2026-05-01' }));
  });

  it('LIFF tenant CANNOT create for a different building', async () => {
    await assertFails(addDoc(collection(LIFF_TENANT().firestore(), 'leaseRequests'),
      { type: 'renew', room: '101', building: 'nest' }));
  });

  it('admin CAN create regardless of claims (ops/migration)', async () => {
    await assertSucceeds(addDoc(collection(EMAIL_ADMIN().firestore(), 'leaseRequests'),
      { type: 'renew', room: '101', building: 'rooms' }));
  });

  it('anon tenant CANNOT update', async () => {
    await seedDoc('leaseRequests/req-1', { status: 'pending' });
    await assertFails(updateDoc(doc(ANON().firestore(), 'leaseRequests/req-1'), { status: 'approved' }));
  });

  it('admin can update', async () => {
    await seedDoc('leaseRequests/req-1', { status: 'pending' });
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), 'leaseRequests/req-1'), { status: 'approved' }));
  });
});

describe('complaints — any auth creates, only admin modifies/deletes', () => {
  const validComplaint = (uid = 'tenant-1') => ({
    linkedAuthUid: uid,
    description: 'noise from upstairs',
    room: '101',
    building: 'rooms',
    category: 'noise',
    createdAt: new Date().toISOString(),
  });

  it('anon tenant CAN create complaint with valid shape', async () => {
    await assertSucceeds(addDoc(collection(ANON().firestore(), 'complaints'), validComplaint()));
  });

  it('anon tenant CANNOT create with wrong linkedAuthUid', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'complaints'), {
      ...validComplaint(), linkedAuthUid: 'other-uid',
    }));
  });

  it('CANNOT create with extra forbidden fields', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'complaints'), {
      ...validComplaint(), admin: true,
    }));
  });

  it('CANNOT create with description over 2000 chars', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'complaints'), {
      ...validComplaint(), description: 'x'.repeat(2001),
    }));
  });

  it('CANNOT create without required fields', async () => {
    await assertFails(addDoc(collection(ANON().firestore(), 'complaints'), {
      linkedAuthUid: 'tenant-1', description: 'noise',  // missing room + building
    }));
  });

  it('anon tenant CANNOT update or delete', async () => {
    await seedDoc('complaints/c-1', { description: 'old', linkedAuthUid: 'tenant-1', room: '101', building: 'rooms' });
    await assertFails(updateDoc(doc(ANON().firestore(), 'complaints/c-1'), { resolved: true }));
    await assertFails(deleteDoc(doc(ANON().firestore(), 'complaints/c-1')));
  });
});

describe('admin-only collections — anon tenant denied write', () => {
  for (const path of ['rewards/r1', 'system/cfg', 'announcements/a1', 'wellness_articles/w1',
                      'communityEvents/e1', 'communityDocuments/d1', 'historicalRevenue/2569',
                      'meter_data/m1', 'leases/rooms/list/L1', 'buildings/b1']) {
    it(`anon tenant CANNOT write ${path}`, async () => {
      await assertFails(setDoc(doc(ANON().firestore(), path), { v: 1 }));
    });
    it(`email admin CAN write ${path}`, async () => {
      await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), path), { v: 1 }));
    });
  }
});

describe('public-read content — unauth user can read', () => {
  // announcements/{id} removed from this set 2026-05-17 (C4 merge): read now
  // requires signed-in + audience match. See `announcements — audience-filtered`
  // describe block below.
  for (const path of ['communityEvents/e1', 'communityDocuments/d1', 'wellness_articles/w1']) {
    it(`unauthenticated user CAN read ${path}`, async () => {
      await seedDoc(path);
      await assertSucceeds(getDoc(doc(UNAUTH().firestore(), path)));
    });
  }
});

describe('liffUsers — any auth creates, only admin approves/deletes', () => {
  it('anon tenant can create their own liff link request', async () => {
    await assertSucceeds(setDoc(doc(ANON('U_LINE_1').firestore(), 'liffUsers/U_LINE_1'), {
      building: 'rooms', room: '101', status: 'pending'
    }));
  });

  it('anon tenant CANNOT update (approve themselves) or delete', async () => {
    await seedDoc('liffUsers/U_LINE_1', { status: 'pending' });
    await assertFails(updateDoc(doc(ANON().firestore(), 'liffUsers/U_LINE_1'), { status: 'approved' }));
    await assertFails(deleteDoc(doc(ANON().firestore(), 'liffUsers/U_LINE_1')));
  });

  it('admin can approve + delete', async () => {
    await seedDoc('liffUsers/U_LINE_1', { status: 'pending' });
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), 'liffUsers/U_LINE_1'), { status: 'approved' }));
  });

  // 2026-05-21: own-doc read re-opened (§7-FF leg 4 — mid-session unlink listener).
  it('LIFF user CAN read own liffUsers doc (uid = line:userId)', async () => {
    await seedDoc('liffUsers/U_LINE_1', { status: 'approved', room: '101', building: 'rooms' });
    await assertSucceeds(getDoc(doc(LIFF_TENANT('line:U_LINE_1').firestore(), 'liffUsers/U_LINE_1')));
  });

  it('LIFF user CANNOT read another user liffUsers doc', async () => {
    await seedDoc('liffUsers/U_LINE_1', { status: 'approved' });
    await assertFails(getDoc(doc(LIFF_TENANT('line:U_LINE_2').firestore(), 'liffUsers/U_LINE_1')));
  });

  it('anonymous tenant (non-line: uid) CANNOT read liffUsers doc', async () => {
    await seedDoc('liffUsers/U_LINE_1', { status: 'approved' });
    await assertFails(getDoc(doc(ANON('tenant-1').firestore(), 'liffUsers/U_LINE_1')));
  });
});

describe('marketplace — owner-only mutations', () => {
  it('owner can update their own listing', async () => {
    await seedDoc('marketplace/m1', { title: 'old', ownerUid: 'tenant-X' });
    await assertSucceeds(updateDoc(doc(ANON('tenant-X').firestore(), 'marketplace/m1'), { title: 'new' }));
  });

  it('non-owner CANNOT update someone else listing', async () => {
    await seedDoc('marketplace/m1', { title: 'old', ownerUid: 'tenant-X' });
    await assertFails(updateDoc(doc(ANON('tenant-Y').firestore(), 'marketplace/m1'), { title: 'hijacked' }));
  });
});

describe('auth_events — failed-login audit log (Phase 4B)', () => {
  it('unauthenticated user can create an auth_event (login failed, no uid yet)', async () => {
    await assertSucceeds(addDoc(
      collection(UNAUTH().firestore(), 'auth_events'),
      { maskedEmail: 'te***@test.com', ua: 'Mozilla', errorCode: 'auth/wrong-password', ts: new Date() }
    ));
  });

  it('anonymous user can also create an auth_event', async () => {
    await assertSucceeds(addDoc(
      collection(ANON().firestore(), 'auth_events'),
      { maskedEmail: 'te***@test.com', ua: 'Mozilla', errorCode: 'auth/wrong-password', ts: new Date() }
    ));
  });

  it('CANNOT create with extra fields (schema enforcement)', async () => {
    await assertFails(addDoc(
      collection(UNAUTH().firestore(), 'auth_events'),
      { maskedEmail: 'te***@test.com', ua: 'Mozilla', errorCode: 'x', ts: new Date(), extra: 'injected' }
    ));
  });

  it('CANNOT create with maskedEmail longer than 100 chars', async () => {
    await assertFails(addDoc(
      collection(UNAUTH().firestore(), 'auth_events'),
      { maskedEmail: 'a'.repeat(101), ua: 'Mozilla', errorCode: 'x', ts: new Date() }
    ));
  });

  it('anonymous tenant CANNOT read auth_events (admin-only)', async () => {
    await seedDoc('auth_events/ev1', { maskedEmail: 'te***@test.com', ua: 'Mozilla', errorCode: 'x', ts: new Date() });
    await assertFails(getDoc(doc(ANON().firestore(), 'auth_events/ev1')));
  });

  it('admin CAN read auth_events', async () => {
    await seedDoc('auth_events/ev1', { maskedEmail: 'te***@test.com', ua: 'Mozilla', errorCode: 'x', ts: new Date() });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'auth_events/ev1')));
  });

  it('CANNOT update or delete auth_events (immutable log)', async () => {
    await seedDoc('auth_events/ev1', { maskedEmail: 'te***@test.com', ua: 'x', errorCode: 'x', ts: new Date() });
    await assertFails(updateDoc(doc(EMAIL_ADMIN().firestore(), 'auth_events/ev1'), { ua: 'changed' }));
    await assertFails(deleteDoc(doc(EMAIL_ADMIN().firestore(), 'auth_events/ev1')));
  });
});

describe('accountant role — tax-filing read access, no admin paths (Phase 4A Stage 2)', () => {
  it('accountant CAN read taxSummary', async () => {
    await seedDoc('taxSummary/2569', { totalRevenue: 100000 });
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), 'taxSummary/2569')));
  });

  it('accountant CAN read historicalRevenue', async () => {
    await seedDoc('historicalRevenue/2568', { totalRevenue: 80000 });
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), 'historicalRevenue/2568')));
  });

  it('accountant CANNOT write historicalRevenue (read-only role)', async () => {
    await assertFails(setDoc(doc(ACCOUNTANT().firestore(), 'historicalRevenue/2568'), { totalRevenue: 999 }));
  });

  it('accountant CANNOT read leaseRequests (admin-only)', async () => {
    await seedDoc('leaseRequests/lr1', { status: 'pending' });
    await assertFails(getDoc(doc(ACCOUNTANT().firestore(), 'leaseRequests/lr1')));
  });

  it('accountant CANNOT read verifiedSlips (admin-only)', async () => {
    await seedDoc('verifiedSlips/s1', { amount: 100 });
    await assertFails(getDoc(doc(ACCOUNTANT().firestore(), 'verifiedSlips/s1')));
  });

  it('email user with NO custom claim is denied admin paths (Stage 2 regression)', async () => {
    await seedDoc('leaseRequests/lr1', { status: 'pending' });
    await assertFails(getDoc(doc(EMAIL_NO_CLAIM().firestore(), 'leaseRequests/lr1')));
  });

  it('email user with NO claim CANNOT write system config', async () => {
    await assertFails(setDoc(doc(EMAIL_NO_CLAIM().firestore(), 'system/config'), { v: 1 }));
  });
});

describe('wellnessClaimed — tenant create-only (idempotent)', () => {
  it('anon tenant can create claim doc', async () => {
    // Rule (L267-273) requires parent tenants/{b}/list/{r}.linkedAuthUid ==
    // request.auth.uid for create. ANON() defaults to uid='tenant-1' — seed
    // the parent doc with matching linkedAuthUid so the rule's get() resolves.
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'tenant-1', building: 'rooms', roomId: '101' });
    await assertSucceeds(setDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessClaimed/article-1'),
      { claimedAt: 'now' }
    ));
  });

  it('anon tenant CANNOT update or delete claim (prevents replay-for-points)', async () => {
    await seedDoc('tenants/rooms/list/101/wellnessClaimed/article-1', { claimedAt: 'old' });
    await assertFails(updateDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessClaimed/article-1'),
      { claimedAt: 'replay' }
    ));
    await assertFails(deleteDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessClaimed/article-1')
    ));
  });

  it('admin can run collectionGroup("wellnessClaimed") to aggregate all claims', async () => {
    // Seed claims in multiple rooms to verify cross-room aggregation
    await seedDoc('tenants/rooms/list/101/wellnessClaimed/a1', { claimedAt: 't1', reward: 20 });
    await seedDoc('tenants/nest/list/N201/wellnessClaimed/a1', { claimedAt: 't2', reward: 20 });
    await assertSucceeds(getDocs(
      query(collectionGroup(EMAIL_ADMIN().firestore(), 'wellnessClaimed'))
    ));
  });

  it('anon tenant CANNOT run collectionGroup("wellnessClaimed") — would leak cross-room data', async () => {
    await assertFails(getDocs(
      query(collectionGroup(ANON().firestore(), 'wellnessClaimed'))
    ));
  });
});

describe('occupancyLog — append-only audit history (Plan B\' S1)', () => {
  // Helper: LIFF tenant with explicit tenantId claim (the rule's read gate)
  const LIFF_WITH_TENANT_ID = (uid, tenantId, room = '101', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      tenantId, room, building,
      firebase: { sign_in_provider: 'custom' }
    });

  it('admin can read all occupancyLog entries', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant'
    });
    await assertSucceeds(getDoc(
      doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101/occupancyLog/key1')
    ));
  });

  it('tenant can read their OWN occupancyLog entries (via tenantId claim)', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_OWN', action: 'moved_in', source: 'convertBookingToTenant'
    });
    const ctx = LIFF_WITH_TENANT_ID('line:abc', 'TENANT_OWN');
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'tenants/rooms/list/101/occupancyLog/key1')));
  });

  it('tenant CANNOT read OTHER tenant\'s occupancyLog entries (cross-tenant leak block)', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_OTHER', action: 'moved_in', source: 'convertBookingToTenant'
    });
    const ctx = LIFF_WITH_TENANT_ID('line:abc', 'TENANT_OWN');
    await assertFails(getDoc(doc(ctx.firestore(), 'tenants/rooms/list/101/occupancyLog/key1')));
  });

  it('unauth user CANNOT read any occupancyLog', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant'
    });
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'tenants/rooms/list/101/occupancyLog/key1')));
  });

  it('client CANNOT create occupancyLog directly (CF-only via Admin SDK)', async () => {
    // Even admin via client SDK is blocked — only Admin SDK (which bypasses rules) writes.
    await assertFails(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101/occupancyLog/forge'),
      { tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant' }
    ));
    await assertFails(setDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/occupancyLog/forge'),
      { tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant' }
    ));
  });

  it('admin CANNOT update an existing occupancyLog entry (tamper-proof invariant)', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant'
    });
    await assertFails(updateDoc(
      doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101/occupancyLog/key1'),
      { action: 'archived' }
    ));
  });

  it('admin CANNOT delete an occupancyLog entry (audit-grade — history is permanent)', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/key1', {
      tenantId: 'TENANT_X', action: 'moved_in', source: 'convertBookingToTenant'
    });
    await assertFails(deleteDoc(
      doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101/occupancyLog/key1')
    ));
  });

  it('admin collectionGroup query across rooms succeeds (per-tenant timeline)', async () => {
    await seedDoc('tenants/rooms/list/101/occupancyLog/k1', { tenantId: 'TENANT_Y', action: 'moved_in', source: 'convertBookingToTenant' });
    await seedDoc('tenants/nest/list/N201/occupancyLog/k2', { tenantId: 'TENANT_Y', action: 'transferred_in', source: 'transferTenant.variation' });
    await assertSucceeds(getDocs(
      query(collectionGroup(EMAIL_ADMIN().firestore(), 'occupancyLog'))
    ));
  });
});

describe('bookings — CF-only writes, prospect reads own only', () => {
  const sampleBooking = (prospectUid) => ({
    prospectUid,
    prospectLineId: 'U' + prospectUid.replace('book:', ''),
    prospectName: 'Test Prospect',
    prospectPhone: '0801234567',
    building: 'nest',
    roomId: 'N101',
    durationMonths: 12,
    monthlyRent: 5800,
    depositAmount: 3000,
    status: 'locked',
    qrAmount: 3000,
    promptPayPayload: '00020101...',
    earlyBirdEligible: false,
    earlyBirdPoints: 0,
  });

  it('prospect CAN read own booking (prospectUid matches auth.uid)', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertSucceeds(getDoc(doc(PROSPECT('book:U001').firestore(), 'bookings/b1')));
  });

  it('prospect CANNOT read another prospect\'s booking (cross-prospect leak)', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertFails(getDoc(doc(PROSPECT('book:U002').firestore(), 'bookings/b1')));
  });

  it('admin CAN read any booking', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'bookings/b1')));
  });

  it('anon tenant CANNOT read someone else\'s booking', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    // Anon has uid 'tenant-1' which does NOT match prospectUid 'book:U001'
    // → uid check fails, admin check fails → read denied.
    await assertFails(getDoc(doc(ANON('tenant-1').firestore(), 'bookings/b1')));
  });

  it('LIFF tenant CANNOT read someone else\'s booking', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    // LIFF tenant uid is 'line:U0000...' — different namespace from 'book:U001'.
    await assertFails(getDoc(doc(LIFF_TENANT().firestore(), 'bookings/b1')));
  });

  it('unauthenticated user CANNOT read bookings', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'bookings/b1')));
  });

  it('prospect CANNOT create booking directly (must go through CF)', async () => {
    await assertFails(addDoc(
      collection(PROSPECT('book:U001').firestore(), 'bookings'),
      sampleBooking('book:U001')
    ));
  });

  it('LIFF tenant CANNOT create booking directly', async () => {
    await assertFails(addDoc(
      collection(LIFF_TENANT().firestore(), 'bookings'),
      sampleBooking('book:U001')
    ));
  });

  it('anon CANNOT create booking directly', async () => {
    await assertFails(addDoc(
      collection(ANON().firestore(), 'bookings'),
      sampleBooking('book:U001')
    ));
  });

  it('prospect CANNOT update own booking (e.g. flip status=locked → paid bypassing slip verify)', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertFails(updateDoc(
      doc(PROSPECT('book:U001').firestore(), 'bookings/b1'),
      { status: 'paid' }
    ));
  });

  it('prospect CANNOT delete own booking', async () => {
    await seedDoc('bookings/b1', sampleBooking('book:U001'));
    await assertFails(deleteDoc(doc(PROSPECT('book:U001').firestore(), 'bookings/b1')));
  });

  it('admin CAN write booking (manual ops/dashboard)', async () => {
    await assertSucceeds(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'bookings/b1'),
      sampleBooking('book:U001')
    ));
  });
});

// ── Tenants archive (Phase 1: person-centric identity) ────────────────────
// Archive doc + subcollections must be admin-only — they preserve PII +
// gamification history of former tenants. CF writes via admin SDK (bypasses
// rules); direct client write is blocked because the archive batch is atomic.
describe('tenants archive — admin-only (Phase 1)', () => {
  it('admin CAN read archive doc', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1', {
      tenantId: 'TENANT_1', contractId: 'CONTRACT_X1', name: 'Old',
      archivedAt: new Date(), archivedReason: 'moved_out', archivedBy: 'admin-1',
    });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/archive/CONTRACT_X1')));
  });

  it('LIFF tenant CANNOT read archive (not even own former room)', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1', {
      tenantId: 'TENANT_1', linkedAuthUid: 'line:U00000000000000000000000000000001',
      archivedAt: new Date(),
    });
    await assertFails(getDoc(doc(
      LIFF_TENANT('line:U00000000000000000000000000000001').firestore(),
      'tenants/rooms/archive/CONTRACT_X1'
    )));
  });

  it('anonymous CANNOT read archive', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1', { tenantId: 'TENANT_1' });
    await assertFails(getDoc(doc(ANON().firestore(), 'tenants/rooms/archive/CONTRACT_X1')));
  });

  it('unauthenticated CANNOT read archive', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1', { tenantId: 'TENANT_1' });
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'tenants/rooms/archive/CONTRACT_X1')));
  });

  it('LIFF tenant CANNOT write archive (CF-only)', async () => {
    await assertFails(setDoc(
      doc(LIFF_TENANT().firestore(), 'tenants/rooms/archive/CONTRACT_HIJACK'),
      { tenantId: 'TENANT_HIJACK', archivedAt: new Date() }
    ));
  });

  it('admin CAN write archive (admin SDK pattern)', async () => {
    await assertSucceeds(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/archive/CONTRACT_NEW'),
      { tenantId: 'TENANT_1', archivedAt: new Date(), archivedReason: 'moved_out' }
    ));
  });

  it('admin CAN read archived paymentHistory subdoc (recursive wildcard)', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1/paymentHistory/2026-04', {
      amount: 5000, status: 'paid'
    });
    await assertSucceeds(getDoc(doc(
      EMAIL_ADMIN().firestore(),
      'tenants/rooms/archive/CONTRACT_X1/paymentHistory/2026-04'
    )));
  });

  it('LIFF tenant CANNOT read archived paymentHistory', async () => {
    await seedDoc('tenants/rooms/archive/CONTRACT_X1/paymentHistory/2026-04', {
      amount: 5000
    });
    await assertFails(getDoc(doc(
      LIFF_TENANT().firestore(),
      'tenants/rooms/archive/CONTRACT_X1/paymentHistory/2026-04'
    )));
  });

  it('LIFF tenant CANNOT read archived redemptions', async () => {
    await seedDoc('tenants/nest/archive/CONTRACT_X2/redemptions/r1', {
      rewardId: 'x', cost: 100
    });
    await assertFails(getDoc(doc(
      LIFF_TENANT('line:U001', 'N101', 'nest').firestore(),
      'tenants/nest/archive/CONTRACT_X2/redemptions/r1'
    )));
  });

  it('admin CAN write archived subdoc', async () => {
    await assertSucceeds(setDoc(
      doc(EMAIL_ADMIN().firestore(),
        'tenants/nest/archive/CONTRACT_X2/wellnessClaimed/article-1'),
      { claimedAt: new Date(), points: 5 }
    ));
  });

  it('LIFF tenant CANNOT write archived subdoc', async () => {
    await assertFails(setDoc(
      doc(LIFF_TENANT().firestore(),
        'tenants/rooms/archive/CONTRACT_X1/wellnessClaimed/article-1'),
      { claimedAt: new Date() }
    ));
  });
});

// ── people/{tenantId} (Phase 2 — ex-tenant player identity) ──────────────────
// rule: read = admin OR linkedAuthUid matches caller uid; write = admin only
describe('people — player identity, owner read / admin write', () => {
  const PLAYER_UID = 'player-firebase-uid-1';
  const PLAYER = () => testEnv.authenticatedContext(PLAYER_UID, {
    role: 'player', tenantId: 'TENANT_P1',
    firebase: { sign_in_provider: 'custom' }
  });

  it('admin CAN read people doc', async () => {
    await seedDoc('people/TENANT_P1', { linkedAuthUid: PLAYER_UID, name: 'Test' });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'people/TENANT_P1')));
  });

  it('player CAN read their own people doc (linkedAuthUid match)', async () => {
    await seedDoc('people/TENANT_P1', { linkedAuthUid: PLAYER_UID, name: 'Test' });
    await assertSucceeds(getDoc(doc(PLAYER().firestore(), 'people/TENANT_P1')));
  });

  it('player CANNOT read a different people doc (other linkedAuthUid)', async () => {
    await seedDoc('people/TENANT_OTHER', { linkedAuthUid: 'other-uid-9999', name: 'Other' });
    await assertFails(getDoc(doc(PLAYER().firestore(), 'people/TENANT_OTHER')));
  });

  it('unauthenticated CANNOT read people doc', async () => {
    await seedDoc('people/TENANT_P1', { linkedAuthUid: PLAYER_UID, name: 'Test' });
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'people/TENANT_P1')));
  });

  it('LIFF tenant CANNOT read people doc (no linkedAuthUid match)', async () => {
    await seedDoc('people/TENANT_P1', { linkedAuthUid: PLAYER_UID, name: 'Test' });
    await assertFails(getDoc(doc(LIFF_TENANT().firestore(), 'people/TENANT_P1')));
  });

  it('admin CAN write people doc', async () => {
    await assertSucceeds(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'people/TENANT_P1'),
      { linkedAuthUid: PLAYER_UID, name: 'Test', tenantId: 'TENANT_P1' }
    ));
  });

  it('player CANNOT write their own people doc (CF-only writes)', async () => {
    await assertFails(setDoc(
      doc(PLAYER().firestore(), 'people/TENANT_P1'),
      { linkedAuthUid: PLAYER_UID, name: 'Hack' }
    ));
  });

  it('anonymous tenant CANNOT write people doc', async () => {
    await assertFails(setDoc(
      doc(ANON().firestore(), 'people/TENANT_HIJACK'),
      { linkedAuthUid: 'anon-uid', name: 'Hack' }
    ));
  });
});

// ── broadcastMessages (admin → tenant in-app announcement) ────────────────────
// CF-only writes; tenant read scoped by audience match.
describe('broadcastMessages — admin write, audience-filtered tenant read', () => {
  const seedBroadcast = (audience, extra = {}) => seedDoc(`broadcastMessages/B_${audience}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, {
    title: 'Test',
    body: 'hello',
    audience,
    sender: { uid: 'admin-1', email: 'admin@test.com' },
    sentAt: new Date().toISOString(),
    status: 'published',
    ...extra,
  });

  it('admin CAN read any broadcast', async () => {
    await seedDoc('broadcastMessages/B1', {
      title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'broadcastMessages/B1')));
  });

  it('LIFF tenant in rooms CAN read audience=rooms broadcast', async () => {
    await seedDoc('broadcastMessages/B1', {
      title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertSucceeds(getDoc(doc(
      LIFF_TENANT('line:U1', '15', 'rooms').firestore(),
      'broadcastMessages/B1'
    )));
  });

  it('LIFF tenant in rooms CAN read audience=all broadcast', async () => {
    await seedDoc('broadcastMessages/B2', {
      title: 't', body: 'b', audience: 'all', status: 'published',
    });
    await assertSucceeds(getDoc(doc(
      LIFF_TENANT('line:U1', '15', 'rooms').firestore(),
      'broadcastMessages/B2'
    )));
  });

  it('LIFF tenant in nest CANNOT read audience=rooms broadcast (building mismatch)', async () => {
    await seedDoc('broadcastMessages/B3', {
      title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertFails(getDoc(doc(
      LIFF_TENANT('line:U2', 'N101', 'nest').firestore(),
      'broadcastMessages/B3'
    )));
  });

  it('unauthenticated CANNOT read any broadcast', async () => {
    await seedDoc('broadcastMessages/B4', {
      title: 't', body: 'b', audience: 'all', status: 'published',
    });
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'broadcastMessages/B4')));
  });

  it('LIFF tenant CANNOT create broadcast directly (CF-only writes)', async () => {
    await assertFails(addDoc(
      collection(LIFF_TENANT().firestore(), 'broadcastMessages'),
      { title: 'spam', body: 'hijack', audience: 'all', status: 'published' }
    ));
  });

  it('admin CANNOT write broadcast directly (rule blocks even admin; CF uses admin SDK)', async () => {
    await assertFails(addDoc(
      collection(EMAIL_ADMIN().firestore(), 'broadcastMessages'),
      { title: 't', body: 'b', audience: 'all', status: 'published' }
    ));
  });
});

// ── announcements (unified notice/event/banner — C4 merge 2026-05-17) ────────
// Same audience model as broadcastMessages. Read tightened from `if true` to
// signed-in + audience match. Write stays open to admin during Session 1
// transition (legacy admin code still writes directly until Session 3 cutover).
describe('announcements — audience-filtered read, admin write (C4 unified)', () => {
  it('admin CAN read any announcement', async () => {
    await seedDoc('announcements/A1', {
      type: 'notice', title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'announcements/A1')));
  });

  it('LIFF tenant in rooms CAN read audience=rooms announcement', async () => {
    await seedDoc('announcements/A2', {
      type: 'event', title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertSucceeds(getDoc(doc(
      LIFF_TENANT('line:U1', '15', 'rooms').firestore(),
      'announcements/A2'
    )));
  });

  it('LIFF tenant in rooms CAN read audience=all announcement', async () => {
    await seedDoc('announcements/A3', {
      type: 'banner', title: 't', body: 'b', audience: 'all', status: 'published',
    });
    await assertSucceeds(getDoc(doc(
      LIFF_TENANT('line:U1', '15', 'rooms').firestore(),
      'announcements/A3'
    )));
  });

  it('LIFF tenant in nest CANNOT read audience=rooms announcement (building mismatch)', async () => {
    await seedDoc('announcements/A4', {
      type: 'notice', title: 't', body: 'b', audience: 'rooms', status: 'published',
    });
    await assertFails(getDoc(doc(
      LIFF_TENANT('line:U2', 'N101', 'nest').firestore(),
      'announcements/A4'
    )));
  });

  it('unauthenticated CANNOT read any announcement (tightened from public-read)', async () => {
    await seedDoc('announcements/A5', {
      type: 'banner', title: 't', body: 'b', audience: 'all', status: 'published',
    });
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'announcements/A5')));
  });

  it('LIFF tenant CANNOT write announcement directly (admin-only write during transition)', async () => {
    await assertFails(addDoc(
      collection(LIFF_TENANT().firestore(), 'announcements'),
      { type: 'notice', title: 'spam', body: 'hijack', audience: 'all', status: 'published' }
    ));
  });
});

describe('expenses — admin CRUD, accountant read, tenants denied', () => {
  const EXP_PATH = 'expenses/rooms/2026-05/exp1';
  const EXP_DATA = { date: '2026-05-13', category: 'repair', desc: 'ซ่อมประตู', room: '15', amount: 500 };

  it('admin can read an expense', async () => {
    await seedDoc(EXP_PATH, EXP_DATA);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), EXP_PATH)));
  });

  it('admin can write (add) an expense', async () => {
    await assertSucceeds(addDoc(
      collection(EMAIL_ADMIN().firestore(), 'expenses/rooms/2026-05'),
      EXP_DATA
    ));
  });

  it('admin can delete an expense', async () => {
    await seedDoc(EXP_PATH, EXP_DATA);
    await assertSucceeds(deleteDoc(doc(EMAIL_ADMIN().firestore(), EXP_PATH)));
  });

  it('accountant can read an expense', async () => {
    await seedDoc(EXP_PATH, EXP_DATA);
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), EXP_PATH)));
  });

  it('accountant CANNOT write an expense', async () => {
    await assertFails(addDoc(
      collection(ACCOUNTANT().firestore(), 'expenses/rooms/2026-05'),
      EXP_DATA
    ));
  });

  it('LIFF tenant CANNOT read expenses', async () => {
    await seedDoc(EXP_PATH, EXP_DATA);
    await assertFails(getDoc(doc(LIFF_TENANT().firestore(), EXP_PATH)));
  });

  it('unauthenticated CANNOT read expenses', async () => {
    await seedDoc(EXP_PATH, EXP_DATA);
    await assertFails(getDoc(doc(UNAUTH().firestore(), EXP_PATH)));
  });
});

describe('deposits — admin write, accountant read, tenants denied', () => {
  const DEP_PATH = 'deposits/rooms_15';
  const DEP_DATA = {
    amount: 10000, status: 'holding', receivedAt: '2026-01-01',
    deductions: [], notes: '', updatedAt: '2026-05-13'
  };

  it('admin can read a deposit doc', async () => {
    await seedDoc(DEP_PATH, DEP_DATA);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), DEP_PATH)));
  });

  it('admin can write (create) a deposit doc', async () => {
    await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), DEP_PATH), DEP_DATA));
  });

  it('admin can update a deposit doc', async () => {
    await seedDoc(DEP_PATH, DEP_DATA);
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), DEP_PATH), { status: 'returned' }));
  });

  it('accountant can read a deposit doc', async () => {
    await seedDoc(DEP_PATH, DEP_DATA);
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), DEP_PATH)));
  });

  it('accountant CANNOT write a deposit doc', async () => {
    await assertFails(setDoc(doc(ACCOUNTANT().firestore(), DEP_PATH), DEP_DATA));
  });

  it('LIFF tenant CANNOT read deposit doc', async () => {
    await seedDoc(DEP_PATH, DEP_DATA);
    await assertFails(getDoc(doc(LIFF_TENANT().firestore(), DEP_PATH)));
  });

  it('unauthenticated CANNOT read deposit doc', async () => {
    await seedDoc(DEP_PATH, DEP_DATA);
    await assertFails(getDoc(doc(UNAUTH().firestore(), DEP_PATH)));
  });
});

describe('buildings — admin CRUD, signed-in read (Multi-Property registry)', () => {
  const BLD_PATH = 'buildings/test_b1';
  const BLD_DATA = {
    displayName: 'Test Building 1',
    address: '123 Test Road',
    promptPayId: '0812345678',
    contact: '',
    companyName: '',
    ownerName: '',
    status: 'active'
  };

  it('admin can create a building doc', async () => {
    await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), BLD_DATA));
  });

  it('admin can update a building doc', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { displayName: 'Renamed' }));
  });

  it('admin can archive a building (status update)', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { status: 'archived' }));
  });

  it('admin can read a building doc', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH)));
  });

  it('LIFF tenant can read a building doc (needed for tenant_app display name)', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertSucceeds(getDoc(doc(LIFF_TENANT().firestore(), BLD_PATH)));
  });

  it('LIFF tenant CANNOT create a building doc', async () => {
    await assertFails(setDoc(doc(LIFF_TENANT().firestore(), BLD_PATH), BLD_DATA));
  });

  it('LIFF tenant CANNOT update a building doc', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertFails(updateDoc(doc(LIFF_TENANT().firestore(), BLD_PATH), { displayName: 'Hacked' }));
  });

  it('accountant can read a building doc', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), BLD_PATH)));
  });

  it('accountant CANNOT write a building doc', async () => {
    await assertFails(setDoc(doc(ACCOUNTANT().firestore(), BLD_PATH), BLD_DATA));
  });

  it('unauthenticated CANNOT read a building doc', async () => {
    await seedDoc(BLD_PATH, BLD_DATA);
    await assertFails(getDoc(doc(UNAUTH().firestore(), BLD_PATH)));
  });

  it('unauthenticated CANNOT create a building doc', async () => {
    await assertFails(setDoc(doc(UNAUTH().firestore(), BLD_PATH), BLD_DATA));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tier 3c: isBuildingManager — per-building read scope (SaaS prep)
// ═══════════════════════════════════════════════════════════════════════════════
describe('building manager — scoped read, no write (Tier 3c)', () => {
  const TENANT_PATH = 'tenants/rooms/list/101';
  const TENANT_DATA = {
    name: 'สมชาย',
    phone: '0800000001',
    linkedAuthUid: 'uid-rooms-101',
    status: 'occupied',
    gamification: { points: 50 }
  };
  const METER_PATH = 'meter_data/rooms_101_2569';
  const METER_DATA = { building: 'rooms', roomId: '101', year: 2569, month: 5 };

  // ── Tenant path ──────────────────────────────────────────────────────────

  it('building manager can read tenants in their building', async () => {
    await seedDoc(TENANT_PATH, TENANT_DATA);
    await assertSucceeds(getDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), TENANT_PATH)));
  });

  it('building manager CANNOT read tenants in a different building', async () => {
    await seedDoc('tenants/nest/list/N101', { name: 'อื่น', linkedAuthUid: 'uid-nest-n101', status: 'occupied' });
    await assertFails(getDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), 'tenants/nest/list/N101')));
  });

  it('building manager CANNOT create a tenant doc (admin-only)', async () => {
    await assertFails(setDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), 'tenants/rooms/list/999'), { name: 'test', status: 'vacant' }));
  });

  it('building manager CANNOT update protected fields (gamification)', async () => {
    await seedDoc(TENANT_PATH, TENANT_DATA);
    await assertFails(updateDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), TENANT_PATH), { gamification: { points: 9999 } }));
  });

  it('building manager with multiple buildings can read each', async () => {
    await seedDoc(TENANT_PATH, TENANT_DATA);
    await seedDoc('tenants/nest/list/N101', { name: 'อื่น', linkedAuthUid: 'uid-nest-n101', status: 'occupied' });
    const mgr = BUILDING_MANAGER(['rooms', 'nest']);
    await assertSucceeds(getDoc(doc(mgr.firestore(), TENANT_PATH)));
    await assertSucceeds(getDoc(doc(mgr.firestore(), 'tenants/nest/list/N101')));
  });

  // ── Meter data path ──────────────────────────────────────────────────────

  it('building manager can read meter_data for their building', async () => {
    await seedDoc(METER_PATH, METER_DATA);
    await assertSucceeds(getDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), METER_PATH)));
  });

  it('building manager CANNOT read meter_data for a different building', async () => {
    await seedDoc('meter_data/nest_N101_2569', { building: 'nest', roomId: 'N101', year: 2569, month: 5 });
    await assertFails(getDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), 'meter_data/nest_N101_2569')));
  });

  // ── No escalation ────────────────────────────────────────────────────────

  it('building manager CANNOT write admin-only collections (taxSummary)', async () => {
    await assertFails(setDoc(doc(BUILDING_MANAGER(['rooms']).firestore(), 'taxSummary/2569'), { revenue: 1 }));
  });

  it('user with no managedBuildings claim CANNOT use building manager path', async () => {
    await seedDoc(TENANT_PATH, TENANT_DATA);
    await assertFails(getDoc(doc(EMAIL_NO_CLAIM().firestore(), TENANT_PATH)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tier 3G: facilityBookings — tenant creates own, reads own; admin reads/writes all
// ═══════════════════════════════════════════════════════════════════════════════
describe('facilityBookings — slot reservations (Tier 3G)', () => {
  const BOOKING_ID   = 'booking-test-001';
  const BOOKING_PATH = `facilityBookings/${BOOKING_ID}`;
  const BOOKING_DATA = {
    building:       'rooms',
    facilityType:   'parking',
    slot:           'A1',
    date:           '2030-12-01',
    timeSlot:       'morning',
    tenantUid:      'line:U00000000000000000000000000000001',
    tenantRoom:     '101',
    tenantBuilding: 'rooms',
    tenantName:     'Test Tenant',
    status:         'confirmed',
    cancelledBy:    null,
  };

  it('LIFF tenant can CREATE a booking in their own building', async () => {
    const fs = LIFF_TENANT().firestore();
    await assertSucceeds(setDoc(doc(fs, BOOKING_PATH), BOOKING_DATA));
  });

  it('LIFF tenant CANNOT create booking for a different building', async () => {
    const badData = { ...BOOKING_DATA, building: 'nest', tenantBuilding: 'nest' };
    // tenant has building='rooms' claim but tries to book for 'nest'
    await assertFails(setDoc(doc(LIFF_TENANT().firestore(), `facilityBookings/booking-other-bld`), badData));
  });

  it('LIFF tenant can READ their own booking', async () => {
    await seedDoc(BOOKING_PATH, BOOKING_DATA);
    await assertSucceeds(getDoc(doc(LIFF_TENANT().firestore(), BOOKING_PATH)));
  });

  it('LIFF tenant CANNOT read another tenant\'s booking', async () => {
    await seedDoc(BOOKING_PATH, BOOKING_DATA);
    // Different uid — uid='line:Uother'
    const otherTenant = testEnv.authenticatedContext('line:Uother', {
      room: '102', building: 'rooms', firebase: { sign_in_provider: 'custom' }
    });
    await assertFails(getDoc(doc(otherTenant.firestore(), BOOKING_PATH)));
  });

  it('admin can READ any facilityBooking', async () => {
    await seedDoc(BOOKING_PATH, BOOKING_DATA);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), BOOKING_PATH)));
  });

  it('admin can CREATE a facilityBooking for any building', async () => {
    await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), `facilityBookings/admin-booking-001`), BOOKING_DATA));
  });

  it('admin can UPDATE (cancel) a facilityBooking', async () => {
    await seedDoc(BOOKING_PATH, BOOKING_DATA);
    await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BOOKING_PATH), { status: 'cancelled', cancelledBy: 'admin' }));
  });

  it('unauthenticated user CANNOT read facilityBookings', async () => {
    await seedDoc(BOOKING_PATH, BOOKING_DATA);
    await assertFails(getDoc(doc(UNAUTH().firestore(), BOOKING_PATH)));
  });

  it('unauthenticated user CANNOT create facilityBookings', async () => {
    await assertFails(setDoc(doc(UNAUTH().firestore(), BOOKING_PATH), BOOKING_DATA));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tier 3G: facilityConfig — any signed-in user reads; admin writes
// ═══════════════════════════════════════════════════════════════════════════════
describe('facilityConfig — slot configuration (Tier 3G)', () => {
  const CONFIG_PATH = 'facilityConfig/rooms_parking';
  const CONFIG_DATA = {
    building:      'rooms',
    facilityType:  'parking',
    displayName:   'ที่จอดรถ',
    active:        true,
    slots:         [{ id: 'A1', label: 'A1', enabled: true }],
    timeSlots:     [],
    maxAdvanceDays: 14,
  };

  it('signed-in user can READ facilityConfig', async () => {
    await seedDoc(CONFIG_PATH, CONFIG_DATA);
    await assertSucceeds(getDoc(doc(LIFF_TENANT().firestore(), CONFIG_PATH)));
  });

  it('admin can WRITE facilityConfig', async () => {
    await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), CONFIG_PATH), CONFIG_DATA));
  });

  it('non-admin CANNOT write facilityConfig', async () => {
    await assertFails(setDoc(doc(LIFF_TENANT().firestore(), CONFIG_PATH), CONFIG_DATA));
  });

  it('accountant CANNOT write facilityConfig', async () => {
    await assertFails(setDoc(doc(ACCOUNTANT().firestore(), CONFIG_PATH), CONFIG_DATA));
  });

  it('unauthenticated user CANNOT read facilityConfig', async () => {
    await seedDoc(CONFIG_PATH, CONFIG_DATA);
    await assertFails(getDoc(doc(UNAUTH().firestore(), CONFIG_PATH)));
  });
});
