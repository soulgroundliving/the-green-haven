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
 *   9. rewards / system / wellness_articles: admin write only (announcements = CF-only since S3)
 *  10. communityDocuments: admin write only, public read (communityEvents decommissioned S3)
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
const { setDoc, doc, getDoc, updateDoc, deleteDoc, deleteField, addDoc, collection, collectionGroup, getDocs, query } = require('firebase/firestore');
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

  // NC-2 (2026-05-22 security sprint): pre-fix, the affectedKeys block alone
  // allowed ANY signed-in user (incl. anonymous booking prospect) to overwrite
  // name/phone/email/nationalId of any tenant's room doc. Self-ownership gate
  // via linkedAuthUid now required for non-admin writes.
  it('anonymous tenant WITHOUT linkedAuthUid match CANNOT update tenant doc (NC-2 fix)', async () => {
    // Default seedTenant() does NOT set linkedAuthUid → caller (ANON 'tenant-1')
    // does not own this doc → update must fail even on non-sensitive fields.
    const db = ANON().firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      phone: '0899999999',
      email: 'new@test',
      lineID: 'newLine'
    }));
  });

  it('LIFF-linked tenant CAN update own non-sensitive contact fields (linkedAuthUid match)', async () => {
    // Re-seed with linkedAuthUid matching the caller's uid. seedTenant uses
    // setDoc (not merge) so this fully replaces the beforeEach default.
    await seedTenant({ linkedAuthUid: 'linked-uid-1' });
    const db = ANON('linked-uid-1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      phone: '0899999999',
      email: 'new@test',
      lineID: 'newLine'
    }));
  });

  it('LIFF-linked tenant CANNOT update sensitive fields even with linkedAuthUid match', async () => {
    // Ownership + affectedKeys block are AND-ed: even owner cannot bump gamification.
    await seedTenant({ linkedAuthUid: 'linked-uid-1' });
    const db = ANON('linked-uid-1').firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      gamification: { points: 999999 }
    }));
  });

  it('LIFF-linked tenant CANNOT fake their own reputationTier (Phase 3.2a §6 tamper-proof)', async () => {
    // reputationTier is server-mirrored from trustScores by the trust sweep CF.
    // It's in the protected affectedKeys block so a self-owned tenant can't bump
    // their own trust tier via devtools — even though they own the doc.
    await seedTenant({ linkedAuthUid: 'linked-uid-1' });
    const db = ANON('linked-uid-1').firestore();
    await assertFails(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      reputationTier: 'high'
    }));
  });

  it('email admin CAN modify any tenant field including gamification + reputationTier', async () => {
    const db = EMAIL_ADMIN().firestore();
    await assertSucceeds(updateDoc(doc(db, 'tenants/rooms/list/101'), {
      gamification: { points: 500 },
      rentAmount: 6000,
      reputationTier: 'good'
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
  // announcements/a1 removed (C4 S3): allow write: if false — CF-only, tested in announcements block
  // communityEvents/e1 removed (C4 S3): collection decommissioned, default deny applies
  for (const path of ['rewards/r1', 'system/cfg', 'wellness_articles/w1',
                      'communityDocuments/d1', 'historicalRevenue/2569',
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
  // communityEvents/e1 removed (C4 S3): collection decommissioned, default deny = no public read
  for (const path of ['communityDocuments/d1', 'wellness_articles/w1']) {
    it(`unauthenticated user CAN read ${path}`, async () => {
      await seedDoc(path);
      await assertSucceeds(getDoc(doc(UNAUTH().firestore(), path)));
    });
  }
});

describe('liffUsers — UID-gated creates with field allowlist (P4.2 hardened 2026-05-23)', () => {
  // Canonical payload tenant_app.html:10141 writes — keeps tests in sync with code
  const LIFF_PAYLOAD = (overrides = {}) => ({
    lineUserId: 'U_LINE_1',
    lineDisplayName: 'สมชาย',
    linePictureUrl: 'https://profile.line-scdn.net/abc',
    room: '101',
    building: 'rooms',
    status: 'pending',
    requestedAt: new Date().toISOString(),
    ...overrides
  });

  it('LIFF tenant with matching uid can create own liff link request', async () => {
    await assertSucceeds(setDoc(
      doc(LIFF_TENANT('line:U_LINE_1').firestore(), 'liffUsers/U_LINE_1'),
      LIFF_PAYLOAD()
    ));
  });

  it('LIFF tenant CANNOT impersonate another user (uid mismatch)', async () => {
    // Caller uid is line:U_LINE_2, trying to create liffUsers/U_LINE_1
    await assertFails(setDoc(
      doc(LIFF_TENANT('line:U_LINE_2').firestore(), 'liffUsers/U_LINE_1'),
      LIFF_PAYLOAD()
    ));
  });

  it('Anonymous tenant (non-line: uid) CANNOT create liffUsers (closes pre-poison)', async () => {
    // Attacker is anonymous booking prospect / generic anon — uid doesn't have 'line:' prefix
    await assertFails(setDoc(
      doc(ANON('U_LINE_1').firestore(), 'liffUsers/U_LINE_1'),
      LIFF_PAYLOAD()
    ));
  });

  it('LIFF tenant CANNOT self-approve by setting status:approved', async () => {
    await assertFails(setDoc(
      doc(LIFF_TENANT('line:U_LINE_1').firestore(), 'liffUsers/U_LINE_1'),
      LIFF_PAYLOAD({ status: 'approved' })
    ));
  });

  it('LIFF tenant CANNOT add unknown fields (e.g. admin:true)', async () => {
    await assertFails(setDoc(
      doc(LIFF_TENANT('line:U_LINE_1').firestore(), 'liffUsers/U_LINE_1'),
      { ...LIFF_PAYLOAD(), admin: true }
    ));
  });

  it('LIFF tenant CANNOT exceed lineDisplayName size cap (100 chars)', async () => {
    await assertFails(setDoc(
      doc(LIFF_TENANT('line:U_LINE_1').firestore(), 'liffUsers/U_LINE_1'),
      LIFF_PAYLOAD({ lineDisplayName: 'X'.repeat(101) })
    ));
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

  // P4.3 (2026-05-23): create rule now enforces ownerUid == auth.uid.
  // Prior to this, a tenant could create a listing attributed to a victim's
  // UID; the victim then couldn't delete it (own-UID match required).
  it('tenant creates listing with own ownerUid → succeeds', async () => {
    await assertSucceeds(addDoc(collection(ANON('tenant-X').firestore(), 'marketplace'), {
      title: 'cool stuff',
      ownerUid: 'tenant-X',
      createdAt: new Date().toISOString()
    }));
  });

  it('tenant CANNOT create listing with another tenant ownerUid (impersonation)', async () => {
    await assertFails(addDoc(collection(ANON('tenant-X').firestore(), 'marketplace'), {
      title: 'frame the victim',
      ownerUid: 'tenant-VICTIM',
      createdAt: new Date().toISOString()
    }));
  });
});

describe('marketplace_chats — participant-only chat (Sprint 1)', () => {
  const OWNER = 'line:U00000000000000000000000000000010';
  const BUYER = 'line:U00000000000000000000000000000020';
  const STRANGER = 'line:U00000000000000000000000000000099';

  async function seedChat(extra = {}) {
    await seedDoc('marketplace_chats/c1', {
      participants: [OWNER, BUYER],
      postId: 'post-001',
      postTitle: 'Lamp',
      postImageUrl: '',
      postPrice: 150,
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      unreadCount: { [OWNER]: 0, [BUYER]: 0 },
      ...extra,
    });
  }

  it('participant can read own chat', async () => {
    await seedChat();
    await assertSucceeds(getDoc(doc(ANON(OWNER).firestore(), 'marketplace_chats/c1')));
    await assertSucceeds(getDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1')));
  });

  it('non-participant CANNOT read', async () => {
    await seedChat();
    await assertFails(getDoc(doc(ANON(STRANGER).firestore(), 'marketplace_chats/c1')));
  });

  it('participant CAN create chat with self in participants', async () => {
    await assertSucceeds(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats'), {
      participants: [OWNER, BUYER],
      postId: 'post-001',
      createdAt: new Date().toISOString(),
    }));
  });

  it('caller CANNOT create chat without including self in participants', async () => {
    await assertFails(addDoc(collection(ANON(STRANGER).firestore(), 'marketplace_chats'), {
      participants: [OWNER, BUYER],
      postId: 'post-001',
      createdAt: new Date().toISOString(),
    }));
  });

  it('CANNOT create chat with participants.size != 2', async () => {
    await assertFails(addDoc(collection(ANON(OWNER).firestore(), 'marketplace_chats'), {
      participants: [OWNER],
      postId: 'post-001',
      createdAt: new Date().toISOString(),
    }));
    await assertFails(addDoc(collection(ANON(OWNER).firestore(), 'marketplace_chats'), {
      participants: [OWNER, BUYER, STRANGER],
      postId: 'post-001',
      createdAt: new Date().toISOString(),
    }));
  });

  it('participant CAN update lastMessage / unreadCount', async () => {
    await seedChat();
    await assertSucceeds(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1'), {
      lastMessage: 'hello',
      lastMessageTime: new Date().toISOString(),
    }));
  });

  // S3 PR 2 — read-receipt write
  it('participant CAN stamp lastReadAt for self', async () => {
    await seedChat();
    await assertSucceeds(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1'), {
      [`lastReadAt.${BUYER}`]: new Date().toISOString(),
      [`unreadCount.${BUYER}`]: 0,
    }));
  });

  it('non-participant CANNOT write lastReadAt', async () => {
    await seedChat();
    await assertFails(updateDoc(doc(ANON(STRANGER).firestore(), 'marketplace_chats/c1'), {
      [`lastReadAt.${STRANGER}`]: new Date().toISOString(),
    }));
  });

  // S3 PR 3 — hiddenBy is CF-only (hideMarketplaceChat). Clients cannot
  // write it from their own session even for themselves.
  it('participant CANNOT write hiddenBy from client (CF-only)', async () => {
    await seedChat();
    await assertFails(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1'), {
      [`hiddenBy.${BUYER}`]: new Date().toISOString(),
    }));
  });

  it('participant CANNOT write hiddenBy for counterparty (CF-only)', async () => {
    await seedChat();
    await assertFails(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1'), {
      [`hiddenBy.${OWNER}`]: new Date().toISOString(),
    }));
  });

  // S3 PR 3 — replyTo is allowed on message create
  it('participant CAN send a message with replyTo quote', async () => {
    await seedChat();
    await assertSucceeds(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: BUYER,
      text: 'replying to your earlier',
      timestamp: new Date().toISOString(),
      isRead: false,
      replyTo: { messageId: 'm0', senderId: OWNER, textSnippet: 'hi there' },
    }));
  });

  // S3 PR 3 — text-edit attempt via update still blocked (chat history is
  // immutable; unsend handled by unsendMarketplaceMessage CF via admin SDK)
  it('sender CANNOT edit text of own message via client (unsend is CF-only)', async () => {
    await seedChat();
    const msgRef = doc(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages/m1');
    await assertSucceeds(setDoc(msgRef, {
      senderId: BUYER, text: 'original', timestamp: new Date().toISOString(), isRead: false,
    }));
    await assertFails(updateDoc(msgRef, { text: 'edited!' }));
  });

  it('participant CANNOT mutate participants array', async () => {
    await seedChat();
    await assertFails(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1'), {
      participants: [BUYER, STRANGER],
    }));
  });

  it('tenant CANNOT delete chat (CF/admin only)', async () => {
    await seedChat();
    await assertFails(deleteDoc(doc(ANON(OWNER).firestore(), 'marketplace_chats/c1')));
    await assertFails(deleteDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1')));
  });

  it('admin CAN delete chat', async () => {
    await seedChat();
    await assertSucceeds(deleteDoc(doc(EMAIL_ADMIN().firestore(), 'marketplace_chats/c1')));
  });

  it('participant CAN send a message with senderId == self', async () => {
    await seedChat();
    await assertSucceeds(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: BUYER,
      text: 'hi',
      timestamp: new Date().toISOString(),
      isRead: false,
    }));
  });

  it('participant CANNOT send a message with senderId spoofed as other participant', async () => {
    await seedChat();
    await assertFails(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: OWNER,
      text: 'impersonate',
      timestamp: new Date().toISOString(),
      isRead: false,
    }));
  });

  it('non-participant CANNOT send a message', async () => {
    await seedChat();
    await assertFails(addDoc(collection(ANON(STRANGER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: STRANGER,
      text: 'sneak',
      timestamp: new Date().toISOString(),
      isRead: false,
    }));
  });

  it('non-participant CANNOT read messages', async () => {
    await seedChat();
    await seedDoc('marketplace_chats/c1/messages/m1', {
      senderId: OWNER, text: 'hi', timestamp: new Date().toISOString(), isRead: false,
    });
    await assertFails(getDoc(doc(ANON(STRANGER).firestore(), 'marketplace_chats/c1/messages/m1')));
  });

  it('participant CAN mark message isRead but CANNOT edit text', async () => {
    await seedChat();
    await seedDoc('marketplace_chats/c1/messages/m1', {
      senderId: OWNER, text: 'hi', timestamp: new Date().toISOString(), isRead: false,
    });
    await assertSucceeds(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages/m1'), { isRead: true }));
    await assertFails(updateDoc(doc(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages/m1'), { text: 'edited' }));
  });

  it('participant CANNOT send empty or oversized message', async () => {
    await seedChat();
    await assertFails(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: BUYER, text: '', timestamp: new Date().toISOString(), isRead: false,
    }));
    await assertFails(addDoc(collection(ANON(BUYER).firestore(), 'marketplace_chats/c1/messages'), {
      senderId: BUYER, text: 'x'.repeat(2001), timestamp: new Date().toISOString(), isRead: false,
    }));
  });

  it('tenant CANNOT delete a message (CF only)', async () => {
    await seedChat();
    await seedDoc('marketplace_chats/c1/messages/m1', {
      senderId: OWNER, text: 'hi', timestamp: new Date().toISOString(), isRead: false,
    });
    await assertFails(deleteDoc(doc(ANON(OWNER).firestore(), 'marketplace_chats/c1/messages/m1')));
  });

  it('unauthenticated user CANNOT read a chat (isSignedIn guard)', async () => {
    await seedChat();
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'marketplace_chats/c1')));
  });

  it('unauthenticated user CANNOT create a chat', async () => {
    await assertFails(addDoc(collection(UNAUTH().firestore(), 'marketplace_chats'), {
      participants: [OWNER, BUYER],
      postId: 'post-001',
      createdAt: new Date().toISOString(),
    }));
  });

  it('admin can delete a message (mirrors CF cleanupMarketplaceChat bypass)', async () => {
    await seedChat();
    await seedDoc('marketplace_chats/c1/messages/m1', {
      senderId: OWNER, text: 'hello', timestamp: new Date().toISOString(), isRead: false,
    });
    await assertSucceeds(deleteDoc(doc(EMAIL_ADMIN().firestore(), 'marketplace_chats/c1/messages/m1')));
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

describe('wellnessQuizPassed — CF-only create (Session B server-trusted)', () => {
  // CF-only create is stricter than wellnessClaimed which permits tenant create.
  // claimWellnessQuizPoints writes via Admin SDK (bypasses rules); direct client
  // create must fail or a tenant could forge passed-marker.
  it('anon tenant CANNOT create wellnessQuizPassed (CF-only)', async () => {
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'tenant-1', building: 'rooms', roomId: '101' });
    await assertFails(setDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessQuizPassed/article-1_2026-05'),
      { passed: true, reward: 10 }
    ));
  });

  it('owning tenant CAN read own wellnessQuizPassed marker', async () => {
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'tenant-1', building: 'rooms', roomId: '101' });
    await seedDoc('tenants/rooms/list/101/wellnessQuizPassed/article-1_2026-05', { passed: true, reward: 10 });
    await assertSucceeds(getDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessQuizPassed/article-1_2026-05')
    ));
  });

  it('cross-room tenant CANNOT read other room\'s wellnessQuizPassed', async () => {
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'other-tenant', building: 'rooms', roomId: '101' });
    await seedDoc('tenants/rooms/list/101/wellnessQuizPassed/article-1_2026-05', { passed: true });
    await assertFails(getDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/wellnessQuizPassed/article-1_2026-05')
    ));
  });

  it('admin CAN run collectionGroup("wellnessQuizPassed") for engagement insights', async () => {
    await seedDoc('tenants/rooms/list/101/wellnessQuizPassed/a1_2026-05', { passed: true, reward: 10 });
    await seedDoc('tenants/nest/list/N201/wellnessQuizPassed/a1_2026-05', { passed: false, reward: 0 });
    await assertSucceeds(getDocs(
      query(collectionGroup(EMAIL_ADMIN().firestore(), 'wellnessQuizPassed'))
    ));
  });
});

describe('contractQuizPassed — CF-only create (Session B server-trusted)', () => {
  it('anon tenant CANNOT create contractQuizPassed (CF-only)', async () => {
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'tenant-1', building: 'rooms', roomId: '101' });
    await assertFails(setDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/contractQuizPassed/2026-05'),
      { passed: true, reward: 20 }
    ));
  });

  it('owning tenant CAN read own contractQuizPassed marker', async () => {
    await seedDoc('tenants/rooms/list/101', { linkedAuthUid: 'tenant-1', building: 'rooms', roomId: '101' });
    await seedDoc('tenants/rooms/list/101/contractQuizPassed/2026-05', { passed: true, reward: 20 });
    await assertSucceeds(getDoc(
      doc(ANON().firestore(), 'tenants/rooms/list/101/contractQuizPassed/2026-05')
    ));
  });

  it('admin CAN run collectionGroup("contractQuizPassed") for monthly pass-rate', async () => {
    await seedDoc('tenants/rooms/list/101/contractQuizPassed/2026-05', { passed: true, reward: 20 });
    await seedDoc('tenants/nest/list/N201/contractQuizPassed/2026-05', { passed: false, reward: 0 });
    await assertSucceeds(getDocs(
      query(collectionGroup(EMAIL_ADMIN().firestore(), 'contractQuizPassed'))
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

describe('consents — PDPA consent ledger, tenant reads own / admin reads all, CF-write-only (Roadmap 1.4)', () => {
  // LIFF tenant with uid + optional tenantId claim. The consents rule grants a
  // tenant read access to a row whose authUid == their uid OR whose tenantId ==
  // their tenantId claim — the dual path survives §7-Z claim strip / §7-P UID drift.
  const LIFF_WITH_TENANT_ID = (uid, tenantId, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      tenantId, room, building, firebase: { sign_in_provider: 'custom' }
    });

  const ownRow = {
    tenantId: 'T_OWN', authUid: 'line:Uown', room: '15', building: 'rooms',
    purpose: 'account_v1', noticeVersion: 'v1',
  };

  it('admin can read any consent row (PDPA audit)', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'consents/T_OWN_account_v1')));
  });

  it('tenant can read their OWN consent row via authUid match', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    // uid == resource.data.authUid grants read; no tenantId claim needed here
    const ctx = LIFF_WITH_TENANT_ID('line:Uown', '');
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'consents/T_OWN_account_v1')));
  });

  it('tenant can read their OWN consent row via tenantId claim (survives UID drift)', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    // UID rotated (≠ authUid) but tenantId claim still matches resource.data.tenantId
    const ctx = LIFF_WITH_TENANT_ID('line:UdriftedNewUid', 'T_OWN');
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'consents/T_OWN_account_v1')));
  });

  it('tenant CANNOT read another tenant\'s consent row', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    const ctx = LIFF_WITH_TENANT_ID('line:Uother', 'T_OTHER');
    await assertFails(getDoc(doc(ctx.firestore(), 'consents/T_OWN_account_v1')));
  });

  it('unauth user CANNOT read any consent row', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'consents/T_OWN_account_v1')));
  });

  it('client CANNOT write a consent row (CF / Admin-SDK only — write:false)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'consents/forge_account_v1'), ownRow));
    await assertFails(setDoc(doc(ANON().firestore(), 'consents/forge_account_v1'), ownRow));
  });

  it('tenant CANNOT update or delete their own consent row (immutable, CF-only)', async () => {
    await seedDoc('consents/T_OWN_account_v1', ownRow);
    const ctx = LIFF_WITH_TENANT_ID('line:Uown', 'T_OWN');
    await assertFails(updateDoc(doc(ctx.firestore(), 'consents/T_OWN_account_v1'), { purpose: 'hacked' }));
    await assertFails(deleteDoc(doc(ctx.firestore(), 'consents/T_OWN_account_v1')));
  });
});

describe('pointsLedger — append-only points event log, admin-read-only (Core Readiness Phase 0)', () => {
  // LIFF tenant with explicit tenantId claim — proves even an authenticated
  // tenant has NO read access in Phase 0 (self-view is a deferred feature).
  const LIFF_WITH_TENANT_ID = (uid, tenantId, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      tenantId, room, building,
      firebase: { sign_in_provider: 'custom' }
    });

  const sampleEntry = {
    tenantId: 'TENANT_X', source: 'daily_login', points: 1,
    balanceAfter: 1, building: 'rooms', roomId: '15', by: 'line:abc',
  };

  it('admin can read a pointsLedger entry', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_X__2026-06-02', sampleEntry);
    await assertSucceeds(getDoc(
      doc(EMAIL_ADMIN().firestore(), 'pointsLedger/daily_login__TENANT_X__2026-06-02')
    ));
  });

  it('admin collection query over pointsLedger succeeds (analytics / Trust System)', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_X__2026-06-02', sampleEntry);
    await assertSucceeds(getDocs(
      query(collection(EMAIL_ADMIN().firestore(), 'pointsLedger'))
    ));
  });

  it('tenant CANNOT read pointsLedger — even their own (admin-only in Phase 0)', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_OWN__2026-06-02',
      { ...sampleEntry, tenantId: 'TENANT_OWN' });
    const ctx = LIFF_WITH_TENANT_ID('line:abc', 'TENANT_OWN');
    await assertFails(getDoc(doc(ctx.firestore(), 'pointsLedger/daily_login__TENANT_OWN__2026-06-02')));
  });

  it('unauth user CANNOT read any pointsLedger entry', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_X__2026-06-02', sampleEntry);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'pointsLedger/daily_login__TENANT_X__2026-06-02')));
  });

  it('client CANNOT create a pointsLedger entry (CF-only via Admin SDK)', async () => {
    // write:false — even admin via the client SDK is blocked; only the Admin SDK
    // (which bypasses rules) writes, inside the points CFs.
    await assertFails(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'pointsLedger/forge'), sampleEntry
    ));
    await assertFails(setDoc(
      doc(ANON().firestore(), 'pointsLedger/forge'), sampleEntry
    ));
  });

  it('admin CANNOT update an existing pointsLedger entry (append-only invariant)', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_X__2026-06-02', sampleEntry);
    await assertFails(updateDoc(
      doc(EMAIL_ADMIN().firestore(), 'pointsLedger/daily_login__TENANT_X__2026-06-02'),
      { points: 999 }
    ));
  });

  it('admin CANNOT delete a pointsLedger entry (audit-grade — history is permanent)', async () => {
    await seedDoc('pointsLedger/daily_login__TENANT_X__2026-06-02', sampleEntry);
    await assertFails(deleteDoc(
      doc(EMAIL_ADMIN().firestore(), 'pointsLedger/daily_login__TENANT_X__2026-06-02')
    ));
  });
});

describe('maintenanceArchive — closed-ticket archive, admin-read-only (Phase 3.1 peak-repair-season)', () => {
  // Authenticated LIFF tenant — proves even a signed-in tenant has NO read access.
  const LIFF_TENANT = (uid, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      room, building, firebase: { sign_in_provider: 'custom' }
    });

  const sampleArchive = {
    building: 'rooms', roomId: '15', ticketId: 'T1', status: 'done',
    category: 'electric', priority: 'normal', createdAtMs: 100, completedAtMs: 200,
  };

  it('admin can read a maintenanceArchive entry', async () => {
    await seedDoc('maintenanceArchive/rooms_15_T1', sampleArchive);
    await assertSucceeds(getDoc(
      doc(EMAIL_ADMIN().firestore(), 'maintenanceArchive/rooms_15_T1')
    ));
  });

  it('admin collection query over maintenanceArchive succeeds (seasonality analytics)', async () => {
    await seedDoc('maintenanceArchive/rooms_15_T1', sampleArchive);
    await assertSucceeds(getDocs(
      query(collection(EMAIL_ADMIN().firestore(), 'maintenanceArchive'))
    ));
  });

  it('tenant CANNOT read maintenanceArchive (admin-only)', async () => {
    await seedDoc('maintenanceArchive/rooms_15_T1', sampleArchive);
    const ctx = LIFF_TENANT('line:abc');
    await assertFails(getDoc(doc(ctx.firestore(), 'maintenanceArchive/rooms_15_T1')));
  });

  it('unauth user CANNOT read maintenanceArchive', async () => {
    await seedDoc('maintenanceArchive/rooms_15_T1', sampleArchive);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'maintenanceArchive/rooms_15_T1')));
  });

  it('client CANNOT create a maintenanceArchive entry (CF-only via Admin SDK)', async () => {
    await assertFails(setDoc(
      doc(EMAIL_ADMIN().firestore(), 'maintenanceArchive/forge'), sampleArchive
    ));
    await assertFails(setDoc(
      doc(ANON().firestore(), 'maintenanceArchive/forge'), sampleArchive
    ));
  });
});

describe('trustScores — server-computed reputation, admin-read-only, CF-write-only (Roadmap Phase 3.2a)', () => {
  // LIFF tenant whose tenantId claim matches the doc id — proves even the SUBJECT
  // of the score has NO read access in admin-only v1 (tenant self-view is deferred).
  const LIFF_WITH_TENANT_ID = (uid, tenantId, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      tenantId, room, building,
      firebase: { sign_in_provider: 'custom' }
    });

  const sampleTrust = {
    tenantId: 'TENANT_X', building: 'rooms', roomId: '15',
    reputation: 82, provisional: false,
    factors: {
      paymentScore: 100, tenureScore: 50, complaintScore: 100, onTimeRatio: 1,
      onTimeBills: 6, lateBills: 0, tenureMonths: 12, complaintFreeMonths: 18,
    },
  };

  it('admin can read a trustScores doc', async () => {
    await seedDoc('trustScores/TENANT_X', sampleTrust);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'trustScores/TENANT_X')));
  });

  it('admin collection query over trustScores succeeds (the dashboard reputation card)', async () => {
    await seedDoc('trustScores/TENANT_X', sampleTrust);
    await assertSucceeds(getDocs(query(collection(EMAIL_ADMIN().firestore(), 'trustScores'))));
  });

  it('tenant CANNOT read trustScores — even their own (admin-only v1)', async () => {
    await seedDoc('trustScores/TENANT_OWN', { ...sampleTrust, tenantId: 'TENANT_OWN' });
    const ctx = LIFF_WITH_TENANT_ID('line:abc', 'TENANT_OWN');
    await assertFails(getDoc(doc(ctx.firestore(), 'trustScores/TENANT_OWN')));
  });

  it('unauth user CANNOT read any trustScores doc', async () => {
    await seedDoc('trustScores/TENANT_X', sampleTrust);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'trustScores/TENANT_X')));
  });

  it('client CANNOT create a trustScores doc (CF / Admin-SDK only)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'trustScores/forge'), sampleTrust));
    await assertFails(setDoc(doc(ANON().firestore(), 'trustScores/forge'), sampleTrust));
  });

  it('admin CANNOT update an existing trustScores doc (server-computed — never client-writable)', async () => {
    await seedDoc('trustScores/TENANT_X', sampleTrust);
    await assertFails(updateDoc(doc(EMAIL_ADMIN().firestore(), 'trustScores/TENANT_X'), { reputation: 100 }));
  });

  it('admin CANNOT delete a trustScores doc', async () => {
    await seedDoc('trustScores/TENANT_X', sampleTrust);
    await assertFails(deleteDoc(doc(EMAIL_ADMIN().firestore(), 'trustScores/TENANT_X')));
  });
});

describe('actionAudit — immutable admin-action trail, admin-read-only (Core Readiness Phase 1.1)', () => {
  // Authenticated LIFF tenant — proves even a signed-in tenant has NO read access
  // (tenant self-view is not a v1 feature; admin-only).
  const LIFF_TENANT = (uid, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      room, building, firebase: { sign_in_provider: 'custom' }
    });

  const sampleEntry = {
    actor: 'admin-uid-1', actorEmail: 'admin@x.com', actorRole: 'admin',
    action: 'TENANT_UPDATED', targetType: 'tenant', targetId: '15',
    building: 'rooms', roomId: '15', ip: '1.2.3.4', source: 'recordAdminAction',
  };

  it('admin can read an actionAudit entry', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'actionAudit/abc123')));
  });

  it('admin collection query over actionAudit succeeds (the dashboard audit panel)', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertSucceeds(getDocs(query(collection(EMAIL_ADMIN().firestore(), 'actionAudit'))));
  });

  it('tenant CANNOT read actionAudit (admin-only)', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertFails(getDoc(doc(LIFF_TENANT('line:abc').firestore(), 'actionAudit/abc123')));
  });

  it('unauth user CANNOT read any actionAudit entry', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'actionAudit/abc123')));
  });

  it('client CANNOT create an actionAudit entry (CF / Admin-SDK only)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'actionAudit/forge'), sampleEntry));
    await assertFails(setDoc(doc(ANON().firestore(), 'actionAudit/forge'), sampleEntry));
  });

  it('admin CANNOT update an existing actionAudit entry (append-only invariant)', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertFails(updateDoc(
      doc(EMAIL_ADMIN().firestore(), 'actionAudit/abc123'), { action: 'BILL_PAID_MANUAL' }
    ));
  });

  it('admin CANNOT delete an actionAudit entry (audit-grade — trail is permanent)', async () => {
    await seedDoc('actionAudit/abc123', sampleEntry);
    await assertFails(deleteDoc(doc(EMAIL_ADMIN().firestore(), 'actionAudit/abc123')));
  });
});

describe('counters — gapless document-number sequences, admin-read-only, CF-write-only (Roadmap 1.2a)', () => {
  const LIFF_TENANT = (uid, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      room, building, firebase: { sign_in_provider: 'custom' }
    });

  const sampleCounter = { seq: 42, docType: 'receipt', building: 'rooms', be: 2569 };

  it('admin can read a counter (reconciliation)', async () => {
    await seedDoc('counters/receipt_rooms_2569', sampleCounter);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'counters/receipt_rooms_2569')));
  });

  it('tenant CANNOT read a counter (admin-only)', async () => {
    await seedDoc('counters/receipt_rooms_2569', sampleCounter);
    await assertFails(getDoc(doc(LIFF_TENANT('line:abc').firestore(), 'counters/receipt_rooms_2569')));
  });

  it('unauth user CANNOT read a counter', async () => {
    await seedDoc('counters/receipt_rooms_2569', sampleCounter);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'counters/receipt_rooms_2569')));
  });

  it('client CANNOT create a counter (a client increment would corrupt the gapless invariant)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'counters/forge'), sampleCounter));
    await assertFails(setDoc(doc(ANON().firestore(), 'counters/forge'), sampleCounter));
  });

  it('client CANNOT update a counter (only the server transaction increments seq)', async () => {
    await seedDoc('counters/receipt_rooms_2569', sampleCounter);
    await assertFails(updateDoc(
      doc(EMAIL_ADMIN().firestore(), 'counters/receipt_rooms_2569'), { seq: 1 }
    ));
  });
});

describe('manualReceipts — gapless cash receipt of record, admin-read-only, CF-write-only (Roadmap 1.2a-2)', () => {
  const LIFF_TENANT = (uid, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      room, building, firebase: { sign_in_provider: 'custom' }
    });

  const sample = {
    receiptNo: 'RCP-rooms-2569-00007', building: 'rooms', roomId: '15',
    billId: 'TGH-256905-15', be: 2569, by: 'admin-uid', method: 'manual_admin',
  };

  it('admin can read a manualReceipts record (reconciliation)', async () => {
    await seedDoc('manualReceipts/rooms_15_TGH-256905-15', sample);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'manualReceipts/rooms_15_TGH-256905-15')));
  });

  it('tenant CANNOT read a manualReceipts record (admin-only)', async () => {
    await seedDoc('manualReceipts/rooms_15_TGH-256905-15', sample);
    await assertFails(getDoc(doc(LIFF_TENANT('line:abc').firestore(), 'manualReceipts/rooms_15_TGH-256905-15')));
  });

  it('unauth user CANNOT read a manualReceipts record', async () => {
    await seedDoc('manualReceipts/rooms_15_TGH-256905-15', sample);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'manualReceipts/rooms_15_TGH-256905-15')));
  });

  it('client CANNOT create a manualReceipts record (CF / Admin-SDK only)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'manualReceipts/forge'), sample));
    await assertFails(setDoc(doc(ANON().firestore(), 'manualReceipts/forge'), sample));
  });
});

describe('invoices — issued invoice document-of-record, admin-read-only, CF-write-only (Roadmap 1.2)', () => {
  const LIFF_TENANT = (uid, room = '15', building = 'rooms') =>
    testEnv.authenticatedContext(uid, {
      room, building, firebase: { sign_in_provider: 'custom' }
    });

  const sample = {
    invoiceNo: 'INV-rooms-2569-00001', building: 'rooms', room: '15',
    period: '256905', be: 2569, month: 5, status: 'issued', amount: 3520,
  };

  it('admin can read an invoice (reconciliation)', async () => {
    await seedDoc('invoices/rooms_15_256905', sample);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'invoices/rooms_15_256905')));
  });

  it('admin collection query over invoices succeeds (reconciliation / void list)', async () => {
    await seedDoc('invoices/rooms_15_256905', sample);
    await assertSucceeds(getDocs(query(collection(EMAIL_ADMIN().firestore(), 'invoices'))));
  });

  it('tenant CANNOT read an invoice (admin-only in v1)', async () => {
    await seedDoc('invoices/rooms_15_256905', sample);
    await assertFails(getDoc(doc(LIFF_TENANT('line:abc').firestore(), 'invoices/rooms_15_256905')));
  });

  it('unauth user CANNOT read an invoice', async () => {
    await seedDoc('invoices/rooms_15_256905', sample);
    await assertFails(getDoc(doc(UNAUTH().firestore(), 'invoices/rooms_15_256905')));
  });

  it('client CANNOT create an invoice (CF / Admin-SDK only — gapless invariant)', async () => {
    await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), 'invoices/forge'), sample));
    await assertFails(setDoc(doc(ANON().firestore(), 'invoices/forge'), sample));
  });

  it('client CANNOT update an invoice (void flows through the voidInvoice CF, not the client)', async () => {
    await seedDoc('invoices/rooms_15_256905', sample);
    await assertFails(updateDoc(
      doc(EMAIL_ADMIN().firestore(), 'invoices/rooms_15_256905'), { status: 'void' }
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

// broadcastMessages DECOMMISSIONED — C4 S3 (2026-05-27). Tests removed.
// Collection migrated to announcements/ (type='notice') in S2. Default deny applies.

// ── announcements (unified notice/event/banner — C4 S3 sealed 2026-05-27) ───
// Read: signed-in + audience match. Write: CF-only (if false) — admin SDK bypasses.
describe('announcements — audience-filtered read, CF-only write (C4 S3)', () => {
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

  it('LIFF tenant CANNOT write announcement directly (CF-only)', async () => {
    await assertFails(addDoc(
      collection(LIFF_TENANT().firestore(), 'announcements'),
      { type: 'notice', title: 'spam', body: 'hijack', audience: 'all', status: 'published' }
    ));
  });

  it('email admin CANNOT write announcement directly (CF-only after S3)', async () => {
    await assertFails(addDoc(
      collection(EMAIL_ADMIN().firestore(), 'announcements'),
      { type: 'notice', title: 't', body: 'b', audience: 'all', status: 'published' }
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

  // ── history subcollection (per-tenancy archived settlements) ──
  const HIST_PATH = 'deposits/rooms_15/history/2026-03-01_tenantA';
  const HIST_DATA = {
    tenantId: 'tenantA', returnedAt: '2026-03-01', returnedAmount: 8000,
    deductions: [{ desc: 'cleaning', amount: 500, photo: 'deposits/rooms/15/damage_1.jpg' }],
    refundSlip: 'deposits/rooms/15/slip_1.jpg', archivedAt: '2026-03-01'
  };

  it('admin can write a deposit history settlement', async () => {
    await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), HIST_PATH), HIST_DATA));
  });

  it('admin can read a deposit history settlement', async () => {
    await seedDoc(HIST_PATH, HIST_DATA);
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), HIST_PATH)));
  });

  it('accountant can read a deposit history settlement', async () => {
    await seedDoc(HIST_PATH, HIST_DATA);
    await assertSucceeds(getDoc(doc(ACCOUNTANT().firestore(), HIST_PATH)));
  });

  it('accountant CANNOT write a deposit history settlement', async () => {
    await assertFails(setDoc(doc(ACCOUNTANT().firestore(), HIST_PATH), HIST_DATA));
  });

  it('LIFF tenant CANNOT read a deposit history settlement', async () => {
    await seedDoc(HIST_PATH, HIST_DATA);
    await assertFails(getDoc(doc(LIFF_TENANT().firestore(), HIST_PATH)));
  });
});

describe('buildings — admin CRUD, signed-in read (Multi-Property registry)', () => {
  const BLD_PATH = 'buildings/test_b1';
  // P4.4b (2026-05-23): top-level write rule rejects PII keys —
  // address/contact/ownerEmail MUST be written to buildings/{id}/private/admin
  // instead. Tests below preserve this contract; BLD_DATA is intentionally
  // public-only and mirrors what BuildingRegistry.create() writes.
  const BLD_DATA = {
    displayName: 'Test Building 1',
    promptPayId: '0812345678',
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

  // P4.4 (2026-05-23): sensitive fields moved to admin-only subcollection.
  describe('buildings/{id}/private/admin — admin-only sensitive fields', () => {
    const PRIV_PATH = 'buildings/test_b1/private/admin';
    const PRIV_DATA = {
      address: '123 Test Road, Bangkok',
      contact: '02-xxx-xxxx',
      ownerEmail: 'landlord@example.com'
    };

    it('admin can read private/admin subdoc', async () => {
      await seedDoc(PRIV_PATH, PRIV_DATA);
      await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), PRIV_PATH)));
    });

    it('admin can write private/admin subdoc', async () => {
      await assertSucceeds(setDoc(doc(EMAIL_ADMIN().firestore(), PRIV_PATH), PRIV_DATA));
    });

    it('LIFF tenant CANNOT read private/admin subdoc (closes leak to signed-in users)', async () => {
      await seedDoc(PRIV_PATH, PRIV_DATA);
      await assertFails(getDoc(doc(LIFF_TENANT().firestore(), PRIV_PATH)));
    });

    it('anonymous booking prospect CANNOT read private/admin subdoc', async () => {
      await seedDoc(PRIV_PATH, PRIV_DATA);
      await assertFails(getDoc(doc(PROSPECT().firestore(), PRIV_PATH)));
    });

    it('building manager CANNOT read private/admin (kept owner-only)', async () => {
      await seedDoc(PRIV_PATH, PRIV_DATA);
      await assertFails(getDoc(doc(BUILDING_MANAGER(['test_b1']).firestore(), PRIV_PATH)));
    });

    it('accountant CANNOT read private/admin (admin-only)', async () => {
      await seedDoc(PRIV_PATH, PRIV_DATA);
      await assertFails(getDoc(doc(ACCOUNTANT().firestore(), PRIV_PATH)));
    });
  });

  // P4.4b (2026-05-23): defense-in-depth field allowlist at top-level.
  // Even though BuildingRegistry splits writes correctly, the rule itself
  // now rejects top-level writes that include address/contact/ownerEmail.
  // This catches future code paths that bypass BuildingRegistry, manual
  // Firestore Console edits, and accidental admin writes.
  describe('P4.4b — top-level PII field guard (defense-in-depth)', () => {
    it('admin CANNOT create with address at top-level (must go to private/admin)', async () => {
      await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), {
        ...BLD_DATA, address: '99 Sukhumvit'
      }));
    });

    it('admin CANNOT create with contact at top-level', async () => {
      await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), {
        ...BLD_DATA, contact: '02-555-1212'
      }));
    });

    it('admin CANNOT create with ownerEmail at top-level', async () => {
      await assertFails(setDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), {
        ...BLD_DATA, ownerEmail: 'landlord@example.com'
      }));
    });

    it('admin CANNOT update to ADD address (was absent, now present)', async () => {
      await seedDoc(BLD_PATH, BLD_DATA);
      await assertFails(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { address: '99 Sukhumvit' }));
    });

    it('admin CANNOT update to CHANGE existing address value', async () => {
      await seedDoc(BLD_PATH, { ...BLD_DATA, address: 'old value' });
      await assertFails(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { address: 'new value' }));
    });

    it('admin CAN update to REMOVE existing address via deleteField (cleanup path)', async () => {
      await seedDoc(BLD_PATH, { ...BLD_DATA, address: 'legacy value to clean up' });
      await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { address: deleteField() }));
    });

    it('admin CAN update unrelated field (displayName) even when address pre-exists', async () => {
      await seedDoc(BLD_PATH, { ...BLD_DATA, address: 'legacy unchanged' });
      await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { displayName: 'Renamed' }));
    });

    it('admin CAN write same PII field with unchanged value (no-op merge)', async () => {
      await seedDoc(BLD_PATH, { ...BLD_DATA, contact: 'unchanged' });
      await assertSucceeds(updateDoc(doc(EMAIL_ADMIN().firestore(), BLD_PATH), { contact: 'unchanged' }));
    });
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

  // P4.6 (2026-05-23): `is list` type guard against substring-match attack.
  // CEL `in` operator on a string does substring check, not array membership.
  // If managedBuildings is ever set as a string instead of array,
  // `'rooms' in 'rooms_extra'` returns true → cross-building access leak.
  it('CEL substring vuln: managedBuildings as string is rejected by is-list guard', async () => {
    await seedDoc(TENANT_PATH, TENANT_DATA);
    // Spoof the claim shape: pass a string instead of array
    const STRING_MANAGER = testEnv.authenticatedContext('mgr-string-1', {
      managedBuildings: 'rooms_extra',  // attacker-set string containing 'rooms'
      firebase: { sign_in_provider: 'password' }
    });
    // Without the `is list` guard, this would silently succeed via substring match
    await assertFails(getDoc(doc(STRING_MANAGER.firestore(), TENANT_PATH)));
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

  // Fix #5 (2026-05-22 security sprint): close §7-P gap on facilityBookings.
  // After a fresh LIFF session re-mints a new anonymous UID, the booking
  // (whose tenantUid was stamped at create time) becomes invisible to its own
  // tenant unless the read rule has a claim-based fallback. Mirrors the
  // checklistInstances pattern (firestore.rules:494-497).
  it('LIFF tenant CAN read facilityBooking via claim fallback after UID rotation (Fix #5 / §7-P)', async () => {
    // Doc stamped with an OLD anon UID (now stale — different from caller).
    await seedDoc(BOOKING_PATH, {
      ...BOOKING_DATA,
      tenantUid: 'anon-old-uid-no-longer-current',
      tenantBuilding: 'rooms',
      tenantRoom: '101',
    });
    // Caller is the same tenant in a NEW LIFF session: fresh UID, but claims
    // still point to building=rooms, room=101. Read must succeed via fallback.
    const newSessionDb = LIFF_TENANT('line:U_FRESH_LIFF_SESSION', '101', 'rooms').firestore();
    await assertSucceeds(getDoc(doc(newSessionDb, BOOKING_PATH)));
  });

  it('LIFF tenant CANNOT read facilityBooking for different building (claim mismatch)', async () => {
    await seedDoc(BOOKING_PATH, {
      ...BOOKING_DATA,
      tenantUid: 'anon-old-uid',
      tenantBuilding: 'rooms',
      tenantRoom: '101',
    });
    // Caller is a tenant of NEST building, NOT rooms — claim fallback must NOT match.
    const otherBldDb = LIFF_TENANT('line:U_NEST_TENANT', 'N101', 'nest').firestore();
    await assertFails(getDoc(doc(otherBldDb, BOOKING_PATH)));
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
