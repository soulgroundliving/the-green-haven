/**
 * Integration tests for confirmMoveIn.js — the deposit Phase 2 move-in activation.
 *
 * Verifies: reserved → holding flip (real occupancy date stamped), §7-BBB moveInDate
 * mirrored onto BOTH lease doc + tenant.lease, §7-DD occupancyLog 'moved_in' audit,
 * admin gate, and the reserved-status idempotency precondition.
 *
 * Run: node --test functions/__tests__/confirmMoveIn.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── stub state (reset per test) ──────────────────────────────────────────────
let captured = { txSets: [] };
let docs = {};

function makeSnap(exists, data) {
  return { exists, data: () => data || {} };
}

function resetStubs() {
  captured = { txSets: [] };
  docs = {
    'deposits/rooms_20': { exists: true, data: {
      status: 'reserved', amount: 9000, paidSoFar: 9000, building: 'rooms', roomId: '20',
      expectedMoveInDate: '2026-07-01', payments: [{ label: 'จอง', amount: 500, method: 'cash' }],
    } },
    'tenants/rooms/list/20': { exists: true, data: {
      tenantId: 'TENANT_77_20', activeContractId: 'CONTRACT_1_20', contractId: 'CONTRACT_1_20',
      lease: { leaseId: 'CONTRACT_1_20', status: 'active', startDate: '2026-07-05' },
    } },
    'leases/rooms/list/CONTRACT_1_20': { exists: true, data: {
      id: 'CONTRACT_1_20', tenantName: 'ทดสอบ ผู้เช่า', building: 'rooms', roomId: '20', status: 'active',
    } },
  };
}
resetStubs();

// ── ref that tracks its path + supports nested collection/doc chaining ────────
function makeRef(path) {
  return {
    path,
    collection: (sub) => ({ doc: (id) => makeRef(`${path}/${sub}/${id}`) }),
  };
}

// ── Module._load stubs (mirror convertBookingToTenant.test.js) ───────────────
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (coll) => ({ doc: (docId) => makeRef(`${coll}/${docId}`) }),
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => {
            const d = docs[ref.path];
            return makeSnap(d ? d.exists : false, d ? d.data : null);
          },
          set: (ref, data, options) => {
            captured.txSets.push({ path: ref.path, data, options: options || null });
          },
        };
        return await fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__delete__' };
    return { apps: { length: 1 }, initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions' || id === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    const wrapOnCall = (handler) => { const fn = (data, ctx) => handler(data, ctx); fn.run = (data, ctx) => handler(data, ctx); return fn; };
    return { region: () => ({ https: { onCall: wrapOnCall, HttpsError } }), https: { HttpsError, onCall: wrapOnCall } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { confirmMoveIn } = require('../confirmMoveIn');

function adminCtx() { return { auth: { uid: 'admin-uid', token: { admin: true, email: 'a@x.co' } } }; }
const VALID = { building: 'rooms', roomId: '20', moveInDate: '2026-07-05' };
const exactSet = (path) => captured.txSets.find(s => s.path === path);
const logSet = () => captured.txSets.find(s => s.path.startsWith('tenants/rooms/list/20/occupancyLog/'));

describe('confirmMoveIn — deposit reserved → holding', () => {
  beforeEach(() => { resetStubs(); });

  it('flips the deposit to holding, stamps the real occupancy date + owning tenant', async () => {
    const out = await confirmMoveIn.run(VALID, adminCtx());
    const dep = exactSet('deposits/rooms_20');
    assert.ok(dep, 'deposit doc must be written');
    assert.equal(dep.data.status, 'holding');
    assert.equal(dep.data.tenantId, 'TENANT_77_20');
    assert.equal(dep.data.receivedAt, '2026-07-05');     // real move-in, not the '2026-07-01' prediction
    assert.equal(dep.data.expectedMoveInDate, null);     // prediction cleared
    assert.equal(dep.options.merge, true);
    assert.equal(out.depositStatus, 'holding');
  });

  it('§7-BBB: stamps moveInDate on BOTH the lease doc and the tenant.lease mirror', async () => {
    await confirmMoveIn.run(VALID, adminCtx());
    const lease = exactSet('leases/rooms/list/CONTRACT_1_20');
    assert.ok(lease, 'lease doc must be stamped');
    assert.equal(lease.data.moveInDate, '2026-07-05');

    const tenant = exactSet('tenants/rooms/list/20');
    assert.ok(tenant, 'tenant doc must be stamped');
    assert.equal(tenant.data.lease.moveInDate, '2026-07-05', 'BillStore.tenantBoundaryYM reads lease.moveInDate first');
    assert.equal(tenant.options.merge, true, 'merge:true so the lease map is not clobbered');
  });

  it('§7-DD: appends ONE moved_in occupancyLog entry (source confirmMoveIn)', async () => {
    await confirmMoveIn.run(VALID, adminCtx());
    const log = logSet();
    assert.ok(log, 'occupancyLog entry must be written');
    assert.equal(log.data.action, 'moved_in');
    assert.equal(log.data.source, 'confirmMoveIn');
    assert.equal(log.data.leaseId, 'CONTRACT_1_20');
    assert.equal(log.data.tenantId, 'TENANT_77_20');
    assert.equal(log.data.by, 'admin-uid');
    assert.equal(log.data.reason, 'confirmed_reserved_deposit');
    assert.ok(log.data.idempotencyKey.includes('confirmMoveIn'));
    assert.ok(log.data.idempotencyKey.includes('moved_in'));
  });

  it('returns the success contract', async () => {
    const out = await confirmMoveIn.run(VALID, adminCtx());
    assert.deepEqual(out, { success: true, building: 'rooms', roomId: '20', tenantId: 'TENANT_77_20', moveInDate: '2026-07-05', depositStatus: 'holding' });
  });
});

describe('confirmMoveIn — guards', () => {
  beforeEach(() => { resetStubs(); });

  it('rejects a non-admin caller (permission-denied)', async () => {
    await assert.rejects(
      () => confirmMoveIn.run(VALID, { auth: { uid: 'u1', token: {} } }),
      (e) => e.code === 'permission-denied'
    );
    assert.equal(captured.txSets.length, 0, 'no writes on a denied call');
  });

  it('rejects an unauthenticated caller (unauthenticated)', async () => {
    await assert.rejects(() => confirmMoveIn.run(VALID, {}), (e) => e.code === 'unauthenticated');
  });

  it('rejects an invalid moveInDate (invalid-argument)', async () => {
    await assert.rejects(() => confirmMoveIn.run({ building: 'rooms', roomId: '20', moveInDate: 'not-a-date' }, adminCtx()), (e) => e.code === 'invalid-argument');
    await assert.rejects(() => confirmMoveIn.run({ building: 'rooms', roomId: '20' }, adminCtx()), (e) => e.code === 'invalid-argument');
  });

  it('rejects when the deposit is not reserved — idempotency guard (failed-precondition)', async () => {
    docs['deposits/rooms_20'].data.status = 'holding';
    await assert.rejects(() => confirmMoveIn.run(VALID, adminCtx()), (e) => e.code === 'failed-precondition');
    assert.equal(captured.txSets.length, 0);
  });

  it('rejects when there is no deposit (not-found)', async () => {
    docs['deposits/rooms_20'] = { exists: false, data: null };
    await assert.rejects(() => confirmMoveIn.run(VALID, adminCtx()), (e) => e.code === 'not-found');
  });

  it('rejects when no tenant exists yet (failed-precondition — create tenant first)', async () => {
    docs['tenants/rooms/list/20'] = { exists: false, data: null };
    await assert.rejects(() => confirmMoveIn.run(VALID, adminCtx()), (e) => e.code === 'failed-precondition');
  });

  it('rejects when the tenant has no active lease/contractId (failed-precondition)', async () => {
    docs['tenants/rooms/list/20'].data = { tenantId: 'TENANT_77_20' }; // no contractId/lease
    await assert.rejects(() => confirmMoveIn.run(VALID, adminCtx()), (e) => e.code === 'failed-precondition');
  });
});
