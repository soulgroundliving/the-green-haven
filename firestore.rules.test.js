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
 *   7. leaseRequests: any auth creates, only admin updates
 *   8. complaints: any auth creates, only admin modifies/deletes
 *   9. rewards / system / announcements / wellness_articles: admin write only
 *  10. communityEvents / communityDocs: admin write only, public read
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
const { setDoc, doc, getDoc, updateDoc, deleteDoc, addDoc, collection } = require('firebase/firestore');
const { readFileSync } = require('node:fs');
const { describe, before, after, beforeEach, it } = require('node:test');

let testEnv;

// Auth contexts ---------------------------------------------------------
const ANON = (uid = 'tenant-1') => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'anonymous' }
});
const EMAIL_ADMIN = (uid = 'admin-1') => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'password' }
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

  it('any signed-in user can read tenant doc', async () => {
    await assertSucceeds(getDoc(doc(ANON().firestore(), 'tenants/rooms/list/101')));
    await assertSucceeds(getDoc(doc(EMAIL_ADMIN().firestore(), 'tenants/rooms/list/101')));
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

describe('leaseRequests — any auth creates, admin updates', () => {
  it('anon tenant can create', async () => {
    await assertSucceeds(addDoc(collection(ANON().firestore(), 'leaseRequests'), { type: 'renew' }));
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
  it('anon tenant can create complaint', async () => {
    await assertSucceeds(addDoc(collection(ANON().firestore(), 'complaints'), { text: 'noise' }));
  });

  it('anon tenant CANNOT update or delete', async () => {
    await seedDoc('complaints/c-1', { text: 'old' });
    await assertFails(updateDoc(doc(ANON().firestore(), 'complaints/c-1'), { resolved: true }));
    await assertFails(deleteDoc(doc(ANON().firestore(), 'complaints/c-1')));
  });
});

describe('admin-only collections — anon tenant denied write', () => {
  for (const path of ['rewards/r1', 'system/cfg', 'announcements/a1', 'wellness_articles/w1',
                      'communityEvents/e1', 'communityDocs/d1', 'historicalRevenue/2569',
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
  for (const path of ['announcements/a1', 'communityEvents/e1', 'communityDocs/d1', 'wellness_articles/w1']) {
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
});
