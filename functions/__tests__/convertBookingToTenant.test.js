/**
 * Integration tests for convertBookingToTenant.js
 *
 * Tests the booking → tenant transaction without Firebase, focused on the
 * Phase 3b-3 True A1 invariants:
 *   - contractId is generated ONCE and used in 4 places:
 *     · tenants doc: contractId, activeContractId, lease.leaseId
 *     · leases doc: id
 *     · bookings doc update: contractId
 *   - lease doc is written at leases/{building}/list/{contractId}
 *
 * Run: node --test functions/__tests__/convertBookingToTenant.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state (reset per test) ────────────────────────────────────────────────
let captured = {
  txSets: [],   // [{ path, data, options }]
  txUpdates: [], // [{ path, data }]
};

let stubState = {};

function makeSnap(exists, data, refPath) {
  return { exists, data: () => data || {}, ref: { path: refPath || '' } };
}

function resetStubs() {
  captured = { txSets: [], txUpdates: [] };
  stubState = {
    booking: {
      status: 'paid',
      building: 'rooms',
      roomId: '20',
      prospectName: 'ทดสอบ ทดสอบ',
      prospectPhone: '0812345678',
      prospectLineId: 'Utest1234567890',
      startDate: { toDate: () => new Date('2026-06-01') },
      durationMonths: 12,
      monthlyRent: 4500,
      depositAmount: 9000,
      slipVerifiedAt: '__slipTs__',
      slipTransactionRef: 'REF12345',
      earlyBirdEligible: false,
      earlyBirdPoints: 0,
    },
    // No prior tenant (new tenant flow)
    priorTenantQueryEmpty: true,
  };
}
resetStubs();

// ── Helpers to build a ref-like object that tracks its path ───────────────────
function makeRef(path) {
  return {
    path,
    collection: (sub) => ({
      doc: (id) => makeRef(`${path}/${sub}/${id}`),
    }),
    get: async () => {
      // booking ref
      if (path === 'bookings/BKtest001') {
        return makeSnap(true, stubState.booking, path);
      }
      // tenant ref check
      if (path.startsWith('tenants/')) {
        return makeSnap(false, null, path);
      }
      return makeSnap(false, null, path);
    },
  };
}

// ── Module._load stubs ─────────────────────────────────────────────────────────
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const emptyQuery = {
      where: function () { return this; },
      orderBy: function () { return this; },
      limit: function () { return this; },
      get: async () => ({ empty: true, docs: [] }),
    };

    const firestoreFn = () => ({
      collection: (coll) => {
        const collPath = coll;
        return {
          doc: (id) => makeRef(`${collPath}/${id}`),
          where: emptyQuery.where,
          orderBy: emptyQuery.orderBy,
          limit: emptyQuery.limit,
          get: emptyQuery.get,
        };
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => {
            if (ref.path === 'bookings/BKtest001') {
              return makeSnap(true, stubState.booking, ref.path);
            }
            if (ref.path.startsWith('tenants/')) {
              return makeSnap(false, null, ref.path);
            }
            return makeSnap(false, null, ref.path);
          },
          set: (ref, data, options) => {
            captured.txSets.push({ path: ref.path, data, options: options || null });
          },
          update: (ref, data) => {
            captured.txUpdates.push({ path: ref.path, data });
          },
        };
        return await fn(tx);
      },
    });
    firestoreFn.FieldValue = {
      serverTimestamp: () => '__ts__',
      delete: () => '__delete__',
    };

    return {
      apps: { length: 1 },
      initializeApp: () => {},
      firestore: firestoreFn,
      auth: () => ({ setCustomUserClaims: async () => {} }),
    };
  }
  if (id === 'firebase-functions') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    return {
      region: () => ({
        https: {
          onCall: (fn) => fn,
        },
      }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { convertBookingToTenant } = require('../convertBookingToTenant');

// ── Test helpers ──────────────────────────────────────────────────────────────
function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true } } };
}

function findSet(pathPrefix) {
  return captured.txSets.find(s => s.path.startsWith(pathPrefix));
}

function findUpdate(pathPrefix) {
  return captured.txUpdates.find(u => u.path.startsWith(pathPrefix));
}

// ── Tests: Phase 3b-3 ID alignment invariants ────────────────────────────────

describe('convertBookingToTenant — Phase 3b-3 True A1 ID alignment', () => {
  beforeEach(() => { resetStubs(); });

  it('writes tenant doc with contractId, activeContractId, lease.leaseId all equal', async () => {
    const result = await convertBookingToTenant({ bookingId: 'BKtest001' }, adminContext());

    const tenantSet = findSet('tenants/rooms/list/20');
    assert.ok(tenantSet, 'tenant doc should be written');
    const t = tenantSet.data;

    assert.equal(typeof t.contractId, 'string');
    assert.ok(t.contractId.startsWith('CONTRACT_'), 'contractId should match pattern CONTRACT_<ts>_<r>');
    assert.equal(t.activeContractId, t.contractId, 'activeContractId must equal contractId');
    assert.ok(t.lease, 'tenant.lease subobject should exist');
    assert.equal(t.lease.leaseId, t.contractId, 'tenant.lease.leaseId must equal contractId');
    assert.equal(t.lease.status, 'active');
    assert.equal(result.contractId, t.contractId);
  });

  it('creates lease doc at leases/{building}/list/{contractId} with id === contractId', async () => {
    const result = await convertBookingToTenant({ bookingId: 'BKtest001' }, adminContext());

    const leaseSet = findSet('leases/rooms/list/');
    assert.ok(leaseSet, 'lease doc should be written');
    const l = leaseSet.data;

    assert.equal(l.id, result.contractId, 'lease.id must equal contractId');
    assert.ok(leaseSet.path.endsWith(`/${result.contractId}`),
      `lease doc path should end with /${result.contractId}, got ${leaseSet.path}`);
    assert.equal(l.building, 'rooms');
    assert.equal(l.roomId, '20');
    assert.equal(l.tenantId, result.tenantId);
    assert.equal(l.status, 'active');
    assert.equal(l.contractMonths, 12);
    assert.equal(l.rentAmount, 4500);
    assert.equal(l.deposit, 9000);
  });

  it('updates booking doc with contractId matching tenant + lease', async () => {
    const result = await convertBookingToTenant({ bookingId: 'BKtest001' }, adminContext());

    const bookingUpdate = findUpdate('bookings/BKtest001');
    assert.ok(bookingUpdate, 'booking should be updated');
    assert.equal(bookingUpdate.data.contractId, result.contractId);
    assert.equal(bookingUpdate.data.status, 'converted');
    assert.equal(bookingUpdate.data.tenantId, result.tenantId);
  });

  it('uses ONE contractId across tenant, lease, booking, and people docs', async () => {
    await convertBookingToTenant({ bookingId: 'BKtest001' }, adminContext());

    const tenantSet = findSet('tenants/rooms/list/20');
    const leaseSet = findSet('leases/rooms/list/');
    const peopleSet = findSet('people/');
    const bookingUpdate = findUpdate('bookings/BKtest001');

    // Spread the contractId across all 4 writes
    const ids = {
      tenantContractId: tenantSet.data.contractId,
      tenantActiveContractId: tenantSet.data.activeContractId,
      tenantLeaseLeaseId: tenantSet.data.lease.leaseId,
      leaseId: leaseSet.data.id,
      peopleCurrentLeaseContractId: peopleSet.data.currentLease.contractId,
      bookingContractId: bookingUpdate.data.contractId,
    };

    // All six must be the same string
    const uniq = new Set(Object.values(ids));
    assert.equal(uniq.size, 1,
      `All contractId references must match. Got: ${JSON.stringify(ids, null, 2)}`);
  });

  it('contractId follows CONTRACT_<ts>_<roomId> pattern', async () => {
    const result = await convertBookingToTenant({ bookingId: 'BKtest001' }, adminContext());
    assert.match(result.contractId, /^CONTRACT_\d+_20$/,
      `contractId should match CONTRACT_<ts>_20 (roomId=20), got: ${result.contractId}`);
  });
});
