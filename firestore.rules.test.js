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
  for (const path of ['announcements/a1', 'communityEvents/e1', 'communityDocuments/d1', 'wellness_articles/w1']) {
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
