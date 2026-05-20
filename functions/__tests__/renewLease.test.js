/**
 * Unit tests for renewLease — S1 (auth + validation) and S2 (renewal mode).
 *
 * S3 will add extension-mode tests. Stubs are written so the same Firestore
 * mock supports both "empty state" tests (S1 validation-only) and "fully
 * configured" tests (S2 renewal happy paths).
 *
 * Run: node --test functions/__tests__/renewLease.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // tenants/{b}/list/{r} — set null to mean "doc does not exist"
    tenantDoc: null,
    // leases/{b}/list/{leaseId} — set null to mean "doc does not exist"
    leaseDoc: null,
    // batch.commit() throws this if non-null
    batchCommitError: null,
    // audit RTDB push throws this if non-null
    auditWriteError: null,
    ...overrides,
  };
  captured = {
    batchOps: [],         // { op: 'set'|'update'|'delete', path, data?, options? }
    auditPushes: [],      // payloads written via admin.database().ref().push().set()
    setCustomClaims: [],  // (not used in renewLease but kept for parity)
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────

function makeSnap(exists, data, path) {
  return { exists, data: () => data || {}, ref: { path } };
}

function makeDocRef(path) {
  return {
    path,
    collection: (sub) => makeColl(`${path}/${sub}`),
    get: async () => {
      // tenants/{b}/list/{r}
      if (path.match(/^tenants\/[^/]+\/list\/[^/]+$/)) {
        return stubState.tenantDoc
          ? makeSnap(true, stubState.tenantDoc, path)
          : makeSnap(false, null, path);
      }
      // leases/{b}/list/{leaseId}
      if (path.match(/^leases\/[^/]+\/list\/[^/]+$/)) {
        return stubState.leaseDoc
          ? makeSnap(true, stubState.leaseDoc, path)
          : makeSnap(false, null, path);
      }
      // buildings collection (registry) — handled by collection.get() path
      return makeSnap(false, null, path);
    },
  };
}

function makeColl(path) {
  return {
    path,
    doc: (id) => makeDocRef(`${path}/${id}`),
    get: async () => ({ forEach: (_fn) => {} }), // empty registry → STATIC_FALLBACK
  };
}

const fsBatch = () => ({
  set: (ref, data, options) => captured.batchOps.push({ op: 'set', path: ref.path, data, options: options || null }),
  update: (ref, data) => captured.batchOps.push({ op: 'update', path: ref.path, data }),
  delete: (ref) => captured.batchOps.push({ op: 'delete', path: ref.path }),
  commit: async () => {
    if (stubState.batchCommitError) throw new Error(stubState.batchCommitError);
  },
});

const firestoreFn = Object.assign(
  () => ({
    collection: (path) => makeColl(path),
    batch: fsBatch,
  }),
  {
    FieldValue: {
      serverTimestamp: () => '__serverTs__',
      delete: () => '__delete__',
      arrayUnion: (...args) => ({ __arrayUnion: args }),
    },
    Timestamp: {
      fromDate: (d) => ({ toDate: () => d, toMillis: () => d.getTime() }),
    },
  }
);

const dbRefPush = () => ({
  set: async (payload) => {
    if (stubState.auditWriteError) throw new Error(stubState.auditWriteError);
    captured.auditPushes.push(payload);
  },
});

const dbFn = Object.assign(
  () => ({
    ref: (_path) => ({ push: () => dbRefPush() }),
  }),
  { ServerValue: { TIMESTAMP: '__rtdbTs__' } }
);

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: firestoreFn,
  database: dbFn,
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  return originalLoad.apply(this, arguments);
};

const { renewLease, _validateInput, _runRenewalMode, _LEASE_NOTIF_TIERS } = require('../renewLease');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true, email: 'admin@test' } } };
}

function tenantContext() {
  return { auth: { uid: 'tenant-uid', token: { admin: false } } };
}

function futureDate(daysAhead = 365) {
  return new Date(Date.now() + daysAhead * 86400 * 1000).toISOString();
}

function pastDate(daysAgo = 1) {
  return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
}

const goodInput = () => ({
  building: 'rooms',
  roomId: '15',
  newEndDate: futureDate(365),
  mode: 'renewal',
});

async function expectHttpsError(promise, code) {
  let caught;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, `expected HttpsError with code='${code}', got success`);
  assert.equal(caught.code, code,
    `expected code='${code}', got '${caught.code}' (message: ${caught.message})`);
  return caught;
}

/** Seed a tenant + active lease so renewal can proceed. */
function seedActiveLease(overrides = {}) {
  const oldEndDate = overrides.oldEndDate || futureDate(30);
  const oldLeaseId = overrides.oldLeaseId || 'CONTRACT_1234567890_15';
  const tenantId = overrides.tenantId || 'TENANT_t_15';
  stubState.tenantDoc = {
    name: 'สมชาย สิบห้า',
    tenantId,
    activeContractId: oldLeaseId,
    contractId: oldLeaseId,
    lease: { leaseId: oldLeaseId, status: 'active' },
    contractEnd: oldEndDate,
    ...overrides.tenantExtras,
  };
  stubState.leaseDoc = {
    id: oldLeaseId,
    building: 'rooms',
    roomId: '15',
    tenantId,
    tenantName: 'สมชาย สิบห้า',
    rentAmount: 4500,
    deposit: 9000,
    moveOutDate: oldEndDate,
    contractStart: pastDate(335),
    contractFileName: 'lease_2025.pdf',
    contractDocument: 'gs://bucket/leases/old.pdf',
    status: 'active',
    depositPaid: true,
    depositPaidAt: '2026-01-01T00:00:00.000Z',
    depositSlipRef: 'REF12345',
    sourceBookingId: 'BK001',
    ...overrides.leaseExtras,
  };
  return { tenantId, oldLeaseId, oldEndDate };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('renewLease — S1 (auth + validation)', () => {
  beforeEach(() => { resetStubs(); });

  describe('Auth gates', () => {
    it('rejects unauthenticated callers', async () => {
      await expectHttpsError(renewLease.run(goodInput(), { auth: null }), 'unauthenticated');
    });
    it('rejects callers without admin claim', async () => {
      await expectHttpsError(renewLease.run(goodInput(), tenantContext()), 'permission-denied');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid building', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), building: 'not-a-building' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects empty / malformed / too-long roomId', async () => {
      for (const bad of ['', 'room#1', 'a'.repeat(21)]) {
        await expectHttpsError(
          renewLease.run({ ...goodInput(), roomId: bad }, adminContext()),
          'invalid-argument'
        );
      }
    });
    it('rejects unknown mode', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), mode: 'novation' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects missing or unparseable newEndDate', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: undefined }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: 'not-a-date' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects newEndDate in the past', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: pastDate(1) }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects non-positive newRentAmount when provided', async () => {
      for (const bad of [0, -100]) {
        await expectHttpsError(
          renewLease.run({ ...goodInput(), newRentAmount: bad }, adminContext()),
          'invalid-argument'
        );
      }
    });
    it('rejects negative newDeposit when provided', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newDeposit: -1 }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects non-string contractDocument / contractFileName / notes', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), contractDocument: 123 }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), contractFileName: {} }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        renewLease.run({ ...goodInput(), notes: [] }, adminContext()),
        'invalid-argument'
      );
    });
  });

  describe('Validation passes → state read attempted', () => {
    it('renewal mode with no tenant doc → not-found', async () => {
      // resetStubs leaves tenantDoc=null → renewal mode hits _readLeaseState
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'not-found');
    });
    it('extension mode with no tenant doc → not-found (S3 — no longer unimplemented)', async () => {
      await expectHttpsError(
        renewLease.run({ ...goodInput(), mode: 'extension' }, adminContext()),
        'not-found'
      );
    });
  });

  describe('_validateInput direct (white-box)', () => {
    it('normalises mode to "renewal" when omitted', async () => {
      const data = goodInput();
      delete data.mode;
      const result = await _validateInput(data);
      assert.equal(result.mode, 'renewal');
    });
    it('parses newEndDate ISO string to Date instance', async () => {
      const iso = futureDate(180);
      const result = await _validateInput({ ...goodInput(), newEndDate: iso });
      assert.ok(result.newEndDate instanceof Date);
      assert.equal(result.newEndDate.toISOString(), iso);
    });
    it('coerces numeric strings for rent + deposit', async () => {
      const result = await _validateInput({
        ...goodInput(),
        newRentAmount: '5500',
        newDeposit: '11000',
      });
      assert.equal(result.newRentAmount, 5500);
      assert.equal(result.newDeposit, 11000);
    });
    it('defaults optional strings to empty when omitted', async () => {
      const result = await _validateInput(goodInput());
      assert.equal(result.contractDocument, '');
      assert.equal(result.contractFileName, '');
      assert.equal(result.notes, '');
    });
  });
});

// ── S2 — Renewal mode (novation) ──────────────────────────────────────────────

describe('renewLease — S2 (renewal mode)', () => {
  beforeEach(() => { resetStubs(); });

  describe('Pre-condition guards (_readLeaseState)', () => {
    it('rejects when tenant doc has no tenantId', async () => {
      stubState.tenantDoc = { name: 'No ID', tenantId: '' };
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'failed-precondition');
    });
    it('rejects when tenant has tenantId but no lease pointer', async () => {
      stubState.tenantDoc = { name: 'Orphan', tenantId: 'TID', activeContractId: '', contractId: '' };
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'failed-precondition');
    });
    it('rejects when pointer points at a missing lease doc', async () => {
      stubState.tenantDoc = {
        name: 'Pointer', tenantId: 'TID',
        activeContractId: 'CONTRACT_doesnotexist',
      };
      // stubState.leaseDoc stays null → lease lookup returns exists:false
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'failed-precondition');
    });
    it('rejects when old lease is not status=active', async () => {
      seedActiveLease({ leaseExtras: { status: 'ended' } });
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'failed-precondition');
    });
    it('rejects when lease has no parseable moveOutDate/endDate', async () => {
      seedActiveLease({ leaseExtras: { moveOutDate: null, endDate: null } });
      await expectHttpsError(renewLease.run(goodInput(), adminContext()), 'failed-precondition');
    });
    it('rejects when newEndDate is not after old endDate (shortening attempt)', async () => {
      // Seed with end-date 365 days ahead; renew to 30 days ahead → still in future
      // (passes validator) but BEFORE old end (rejected by _runRenewalMode).
      seedActiveLease({ oldEndDate: futureDate(365) });
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: futureDate(30) }, adminContext()),
        'invalid-argument'
      );
    });
  });

  describe('Happy paths — batch contents', () => {
    it('rent + deposit unchanged: clones old fields, dates roll forward', async () => {
      const seeded = seedActiveLease({ oldEndDate: futureDate(30) });
      const result = await renewLease.run(
        { ...goodInput(), newEndDate: futureDate(395) }, // +1 year
        adminContext()
      );

      assert.equal(result.success, true);
      assert.equal(result.mode, 'renewal');
      assert.equal(result.oldLeaseId, seeded.oldLeaseId);
      assert.ok(result.newLeaseId.startsWith('CONTRACT_'), 'newLeaseId follows CONTRACT_ pattern');
      assert.notEqual(result.newLeaseId, seeded.oldLeaseId);

      // 1. Old lease updated to renewed
      const oldUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.endsWith(`/${seeded.oldLeaseId}`));
      assert.ok(oldUpdate, 'old lease update op present');
      assert.equal(oldUpdate.data.status, 'renewed');
      assert.equal(oldUpdate.data.renewedToLeaseId, result.newLeaseId);
      assert.equal(oldUpdate.data.renewedBy, 'admin-uid');

      // 2. New lease created
      const newSet = captured.batchOps.find(o => o.op === 'set' && o.path.endsWith(`/${result.newLeaseId}`));
      assert.ok(newSet, 'new lease set op present');
      assert.equal(newSet.data.status, 'active');
      assert.equal(newSet.data.tenantId, seeded.tenantId);
      assert.equal(newSet.data.priorLeaseId, seeded.oldLeaseId);
      assert.equal(newSet.data.rentAmount, 4500); // inherited
      assert.equal(newSet.data.deposit, 9000);    // inherited

      // 3. Tenant doc updated to point at new lease
      const tenantUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.startsWith('tenants/'));
      assert.ok(tenantUpdate, 'tenant update op present');
      assert.equal(tenantUpdate.data.activeContractId, result.newLeaseId);
      assert.equal(tenantUpdate.data.contractId, result.newLeaseId);
      assert.equal(tenantUpdate.data.lease.leaseId, result.newLeaseId);
      assert.equal(tenantUpdate.data.lease.status, 'active');

      // 4. All 4 leaseNotifications tiers deleted
      const deletes = captured.batchOps.filter(o => o.op === 'delete' && o.path.startsWith('leaseNotifications/'));
      assert.equal(deletes.length, _LEASE_NOTIF_TIERS.length, 'one delete per tier');
      for (const tier of _LEASE_NOTIF_TIERS) {
        assert.ok(
          deletes.some(d => d.path === `leaseNotifications/rooms_15_${tier}`),
          `expected delete for tier=${tier}`
        );
      }
    });

    it('rent increased: new lease + tenant doc carry the new amount', async () => {
      const seeded = seedActiveLease({ oldEndDate: futureDate(30) });
      const result = await renewLease.run(
        { ...goodInput(), newEndDate: futureDate(395), newRentAmount: 5500 },
        adminContext()
      );

      const newSet = captured.batchOps.find(o => o.op === 'set' && o.path.endsWith(`/${result.newLeaseId}`));
      assert.equal(newSet.data.rentAmount, 5500);
      assert.equal(newSet.data.deposit, 9000); // unchanged

      const tenantUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.startsWith('tenants/'));
      assert.equal(tenantUpdate.data.rentAmount, 5500);
      assert.equal(tenantUpdate.data.deposit, undefined, 'deposit not in patch when unchanged');

      // Audit reflects rent change
      const audit = captured.auditPushes[0];
      assert.equal(audit.oldRent, 4500);
      assert.equal(audit.newRent, 5500);
      assert.equal(audit.rentChanged, true);
      assert.equal(audit.depositChanged, false);
      assert.equal(audit.action, 'lease_renewed');
      assert.equal(audit.mode, 'renewal');
    });

    it('rent + deposit + document replaced: all fields propagate to new lease', async () => {
      const seeded = seedActiveLease({ oldEndDate: futureDate(30) });
      const result = await renewLease.run({
        ...goodInput(),
        newEndDate: futureDate(395),
        newRentAmount: 5500,
        newDeposit: 11000,
        contractDocument: 'gs://bucket/leases/2026.pdf',
        contractFileName: 'lease_2026.pdf',
        notes: 'rent +1000, deposit +2000',
      }, adminContext());

      const newSet = captured.batchOps.find(o => o.op === 'set' && o.path.endsWith(`/${result.newLeaseId}`));
      assert.equal(newSet.data.rentAmount, 5500);
      assert.equal(newSet.data.deposit, 11000);
      assert.equal(newSet.data.contractDocument, 'gs://bucket/leases/2026.pdf');
      assert.equal(newSet.data.contractFileName, 'lease_2026.pdf');
      assert.equal(newSet.data.renewalNotes, 'rent +1000, deposit +2000');

      const audit = captured.auditPushes[0];
      assert.equal(audit.rentChanged, true);
      assert.equal(audit.depositChanged, true);
      assert.equal(audit.documentReplaced, true);
    });
  });

  describe('Side effects', () => {
    it('writes a single RTDB audit log entry per call', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      await renewLease.run({ ...goodInput(), newEndDate: futureDate(395) }, adminContext());
      assert.equal(captured.auditPushes.length, 1);
      assert.equal(captured.auditPushes[0].action, 'lease_renewed');
    });

    it('does not throw if audit write fails (Firestore batch is source of truth)', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      stubState.auditWriteError = 'simulated RTDB outage';
      const result = await renewLease.run(
        { ...goodInput(), newEndDate: futureDate(395) },
        adminContext()
      );
      assert.equal(result.success, true);
      assert.equal(captured.auditPushes.length, 0);
    });

    it('throws internal when batch commit fails', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      stubState.batchCommitError = 'simulated Firestore outage';
      await expectHttpsError(
        renewLease.run({ ...goodInput(), newEndDate: futureDate(395) }, adminContext()),
        'internal'
      );
    });
  });
});

// ── S3 — Extension mode (variation) ───────────────────────────────────────────

describe('renewLease — S3 (extension mode)', () => {
  beforeEach(() => { resetStubs(); });

  describe('Pre-condition guards', () => {
    it('rejects newRentAmount in extension mode (rent changes belong to renewal)', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      await expectHttpsError(
        renewLease.run({
          ...goodInput(), mode: 'extension',
          newEndDate: futureDate(395), newRentAmount: 5500,
        }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects newDeposit in extension mode', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      await expectHttpsError(
        renewLease.run({
          ...goodInput(), mode: 'extension',
          newEndDate: futureDate(395), newDeposit: 11000,
        }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects when newEndDate ≤ current endDate', async () => {
      seedActiveLease({ oldEndDate: futureDate(365) });
      await expectHttpsError(
        renewLease.run({
          ...goodInput(), mode: 'extension', newEndDate: futureDate(30),
        }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects when old lease is not status=active', async () => {
      seedActiveLease({ leaseExtras: { status: 'ended' } });
      await expectHttpsError(
        renewLease.run({
          ...goodInput(), mode: 'extension', newEndDate: futureDate(395),
        }, adminContext()),
        'failed-precondition'
      );
    });
  });

  describe('Happy paths — batch contents', () => {
    it('first extension on a lease with no extensions[] field: arrayUnion initialises', async () => {
      const seeded = seedActiveLease({ oldEndDate: futureDate(30) });
      const result = await renewLease.run({
        ...goodInput(), mode: 'extension',
        newEndDate: futureDate(395),
        notes: 'tenant requested 1yr extension',
      }, adminContext());

      assert.equal(result.success, true);
      assert.equal(result.mode, 'extension');
      assert.equal(result.leaseId, seeded.oldLeaseId, 'lease pointer unchanged in extension mode');
      assert.equal(result.extensionCountAfter, 1);

      // 1. Lease updated in place — endDate + extensions arrayUnion
      const leaseUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.endsWith(`/${seeded.oldLeaseId}`));
      assert.ok(leaseUpdate, 'lease update op present');
      assert.equal(leaseUpdate.data.moveOutDate, new Date(result.toEndDate).toISOString());
      assert.ok(leaseUpdate.data.extensions, 'extensions field present');
      assert.ok(leaseUpdate.data.extensions.__arrayUnion, 'extensions uses arrayUnion sentinel');
      const entries = leaseUpdate.data.extensions.__arrayUnion;
      assert.equal(entries.length, 1);
      assert.equal(entries[0].notes, 'tenant requested 1yr extension');
      assert.equal(entries[0].by, 'admin-uid');

      // 2. Tenant doc — contractEnd + lease.endDate mirrored, leaseId UNCHANGED
      const tenantUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.startsWith('tenants/'));
      assert.ok(tenantUpdate);
      assert.equal(tenantUpdate.data.contractEnd, result.toEndDate);
      assert.equal(tenantUpdate.data.lease.leaseId, seeded.oldLeaseId);
      assert.equal(tenantUpdate.data.lease.endDate, result.toEndDate);

      // 3. No new lease doc created
      const setOps = captured.batchOps.filter(o => o.op === 'set');
      assert.equal(setOps.length, 0, 'extension mode must not create new lease doc');

      // 4. All 4 leaseNotifications tiers deleted (same as renewal)
      const deletes = captured.batchOps.filter(o => o.op === 'delete' && o.path.startsWith('leaseNotifications/'));
      assert.equal(deletes.length, _LEASE_NOTIF_TIERS.length);

      // 5. Audit log: type=lease_extended, count=1
      const audit = captured.auditPushes[0];
      assert.equal(audit.action, 'lease_extended');
      assert.equal(audit.mode, 'extension');
      assert.equal(audit.extensionCountAfter, 1);
    });

    it('second extension: arrayUnion appends (count reflects prior entries)', async () => {
      const seeded = seedActiveLease({
        oldEndDate: futureDate(30),
        leaseExtras: {
          extensions: [
            { at: '2026-03-01T00:00:00.000Z', fromEndDate: '2026-02-01', toEndDate: '2026-05-01', by: 'admin-a' },
          ],
        },
      });
      const result = await renewLease.run({
        ...goodInput(), mode: 'extension', newEndDate: futureDate(395),
      }, adminContext());

      assert.equal(result.extensionCountAfter, 2, 'count after = prior 1 + this 1');

      const leaseUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.endsWith(`/${seeded.oldLeaseId}`));
      // Verify arrayUnion still used (Firestore preserves prior entries on the
      // server side) — the entry we ship is just THIS extension
      const entries = leaseUpdate.data.extensions.__arrayUnion;
      assert.equal(entries.length, 1, 'arrayUnion only sends THIS entry; server merges');
    });

    it('extension with notes carries notes into entry + audit', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      const result = await renewLease.run({
        ...goodInput(), mode: 'extension',
        newEndDate: futureDate(395),
        notes: 'verbal agreement 2026-05-20 — no doc change',
      }, adminContext());

      const leaseUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.startsWith('leases/'));
      assert.equal(leaseUpdate.data.extensions.__arrayUnion[0].notes,
        'verbal agreement 2026-05-20 — no doc change');
      assert.equal(captured.auditPushes[0].notes, 'verbal agreement 2026-05-20 — no doc change');
    });
  });

  describe('Edge cases', () => {
    it('wrong-shape extensions field (object not array): resets to fresh array', async () => {
      const seeded = seedActiveLease({
        oldEndDate: futureDate(30),
        leaseExtras: { extensions: { someKey: 'wrong type' } }, // object, not array
      });
      const result = await renewLease.run({
        ...goodInput(), mode: 'extension', newEndDate: futureDate(395),
      }, adminContext());

      assert.equal(result.success, true);
      assert.equal(result.extensionCountAfter, 1, 'count starts fresh when prior shape was wrong');

      const leaseUpdate = captured.batchOps.find(o => o.op === 'update' && o.path.endsWith(`/${seeded.oldLeaseId}`));
      // Should be raw array (not arrayUnion sentinel) — defensive overwrite path
      assert.ok(Array.isArray(leaseUpdate.data.extensions),
        'wrong-shape recovery uses plain array, not arrayUnion');
      assert.equal(leaseUpdate.data.extensions.length, 1);
    });

    it('audit log also written for extension mode', async () => {
      seedActiveLease({ oldEndDate: futureDate(30) });
      await renewLease.run({
        ...goodInput(), mode: 'extension', newEndDate: futureDate(395),
      }, adminContext());
      assert.equal(captured.auditPushes.length, 1);
      assert.equal(captured.auditPushes[0].action, 'lease_extended');
      assert.equal(captured.auditPushes[0].mode, 'extension');
    });
  });
});
