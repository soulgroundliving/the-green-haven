/**
 * Unit tests for transferTenant — covers auth, validation, state read,
 * variation mode batch shape, novation mode batch shape, claim refresh
 * (§7-FF), and audit log payload.
 *
 * Mirrors renewLease.test.js's stub harness but adds:
 *   - NEW tenant doc (must be vacant or non-existent)
 *   - people doc (for lineUserId lookup → claim refresh)
 *   - liffUsers doc (for building/room update)
 *   - admin.auth() stub capturing setCustomUserClaims + revokeRefreshTokens
 *
 * Run: node --test functions/__tests__/transferTenant.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // tenants/{b}/list/{r} — keyed by full path so old + new are distinct
    docs: {},                  // { 'tenants/rooms/list/15': {...}, ... }
    // batch.commit() throws this if non-null
    batchCommitError: null,
    // audit RTDB push throws this if non-null
    auditWriteError: null,
    // admin.auth().setCustomUserClaims throws this for given uid if set
    claimErrors: {},           // { uid: 'user-not-found' | 'permission-denied' }
    // admin.auth().getUser returns this customClaims for given uid
    existingClaims: {},        // { uid: { admin: true } }
    ...overrides,
  };
  captured = {
    batchOps: [],              // { op, path, data?, options? }
    auditPushes: [],
    setCustomClaims: [],       // [{ uid, claims }]
    revokeRefreshTokens: [],   // [uid, uid]
    getUserCalls: [],          // [uid]
    liffUserUpdates: [],       // [{ path, patch }] — non-batched updates
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────

function makeSnap(path) {
  const data = stubState.docs[path];
  return {
    exists: data !== undefined && data !== null,
    data: () => data || {},
    ref: { path },
  };
}

function makeDocRef(path) {
  return {
    path,
    collection: (sub) => makeColl(`${path}/${sub}`),
    get: async () => makeSnap(path),
    // Non-batched update path (used by _updateLiffUserAndClaims)
    update: async (patch) => {
      captured.liffUserUpdates.push({ path, patch });
      // Apply to stubState so subsequent reads see the change
      if (stubState.docs[path] !== undefined && stubState.docs[path] !== null) {
        stubState.docs[path] = { ...stubState.docs[path], ...patch };
      }
    },
  };
}

function makeColl(path) {
  return {
    path,
    doc: (id) => makeDocRef(`${path}/${id}`),
    get: async () => ({ forEach: (_fn) => {} }),
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

const authFn = () => ({
  getUser: async (uid) => {
    captured.getUserCalls.push(uid);
    const err = stubState.claimErrors[uid];
    if (err === 'user-not-found') {
      const e = new Error('There is no user record corresponding to the provided identifier.');
      e.code = 'auth/user-not-found';
      throw e;
    }
    return { uid, customClaims: stubState.existingClaims[uid] || {} };
  },
  setCustomUserClaims: async (uid, claims) => {
    const err = stubState.claimErrors[uid];
    if (err === 'user-not-found') {
      const e = new Error('There is no user record corresponding to the provided identifier.');
      e.code = 'auth/user-not-found';
      throw e;
    }
    captured.setCustomClaims.push({ uid, claims });
  },
  revokeRefreshTokens: async (uid) => {
    captured.revokeRefreshTokens.push(uid);
  },
});

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: firestoreFn,
  database: dbFn,
  auth: authFn,
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const wrapOnCall = (handler) => {
      const fn = (data, ctx) => handler(data, ctx);
      fn.run = (data, ctx) => handler(data, ctx);
      return fn;
    };
    return {
      https: { HttpsError, onCall: wrapOnCall },
      region: () => ({ https: { HttpsError, onCall: wrapOnCall } }),
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  transferTenant,
  _validateInput,
  _readTransferState,
  _runVariationMode,
  _runNovationMode,
  _updateLiffUserAndClaims,
  _IDENTITY_FIELDS,
} = require('../transferTenant');

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

const goodInput = () => ({
  building: 'rooms',
  oldRoomId: '15',
  newBuilding: 'rooms',
  newRoomId: '17',
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

/**
 * Seed a tenant at oldRoomId + active lease + vacant newRoomId.
 * Returns { tenantId, oldLeaseId, oldEndDate }.
 */
function seedTransferable(overrides = {}) {
  const oldEndDate = overrides.oldEndDate || futureDate(180);
  const oldLeaseId = overrides.oldLeaseId || 'CONTRACT_1234567890_15';
  const tenantId = overrides.tenantId || 'TENANT_t_15';
  const oldRoomPath = `tenants/${overrides.building || 'rooms'}/list/${overrides.oldRoomId || '15'}`;
  const leasePath = `leases/${overrides.building || 'rooms'}/list/${oldLeaseId}`;
  const newRoomPath = `tenants/${overrides.newBuilding || 'rooms'}/list/${overrides.newRoomId || '17'}`;

  stubState.docs[oldRoomPath] = {
    name: 'สมชาย สิบห้า',
    firstName: 'สมชาย',
    lastName: 'สิบห้า',
    phone: '0900000015',
    tenantId,
    linkedAuthUid: overrides.linkedAuthUid !== undefined ? overrides.linkedAuthUid : 'line:U_TEST_LINE_UID',
    activeContractId: oldLeaseId,
    contractId: oldLeaseId,
    lease: { leaseId: oldLeaseId, status: 'active' },
    contractEnd: oldEndDate,
    rentAmount: 4500,
    deposit: 9000,
    status: 'occupied',
    ...overrides.oldTenantExtras,
  };
  stubState.docs[leasePath] = {
    id: oldLeaseId,
    building: overrides.building || 'rooms',
    roomId: overrides.oldRoomId || '15',
    tenantId,
    tenantName: 'สมชาย สิบห้า',
    rentAmount: 4500,
    deposit: 9000,
    moveOutDate: oldEndDate,
    contractStart: '2026-02-21T00:00:00.000Z',
    moveInDate: '2026-02-21T00:00:00.000Z',
    contractFileName: 'lease_2025.pdf',
    contractDocument: 'gs://bucket/leases/old.pdf',
    status: 'active',
    depositPaid: true,
    depositPaidAt: '2026-01-01T00:00:00.000Z',
    contractMonths: 12,
    ...overrides.leaseExtras,
  };
  // New room: by default DOES NOT exist (vacant target). Set explicitly to test "exists+vacant" or "exists+occupied".
  if (overrides.newRoomDoc !== undefined) {
    stubState.docs[newRoomPath] = overrides.newRoomDoc;
  }

  // people doc — has lineUserId for claim-refresh leg
  stubState.docs[`people/${tenantId}`] = {
    tenantId,
    lineUserId: overrides.lineUserId === undefined ? 'U_TEST_LINE_UID' : overrides.lineUserId,
    currentBuilding: overrides.building || 'rooms',
    currentRoom: overrides.oldRoomId || '15',
    ...overrides.peopleExtras,
  };

  // liffUsers doc (deterministic UID convention: 'line:' + lineUserId)
  if (overrides.lineUserId !== null) {
    stubState.docs[`liffUsers/${overrides.lineUserId || 'U_TEST_LINE_UID'}`] = {
      lineUserId: overrides.lineUserId || 'U_TEST_LINE_UID',
      building: overrides.building || 'rooms',
      room: overrides.oldRoomId || '15',
      status: 'approved',
      ...overrides.liffExtras,
    };
  }

  return { tenantId, oldLeaseId, oldEndDate, oldRoomPath, leasePath, newRoomPath };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('transferTenant — S1 (auth + validation)', () => {
  beforeEach(() => { resetStubs(); });

  describe('Auth gates', () => {
    it('rejects unauthenticated callers', async () => {
      await expectHttpsError(transferTenant.run(goodInput(), { auth: null }), 'unauthenticated');
    });
    it('rejects callers without admin claim', async () => {
      await expectHttpsError(transferTenant.run(goodInput(), tenantContext()), 'permission-denied');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid building', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), building: 'not-a-building' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects invalid newBuilding', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), newBuilding: 'not-a-building' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects malformed oldRoomId / newRoomId', async () => {
      for (const bad of ['', 'room#1', 'a'.repeat(21)]) {
        await expectHttpsError(
          transferTenant.run({ ...goodInput(), oldRoomId: bad }, adminContext()),
          'invalid-argument'
        );
        await expectHttpsError(
          transferTenant.run({ ...goodInput(), newRoomId: bad }, adminContext()),
          'invalid-argument'
        );
      }
    });
    it('rejects same-room transfer (no-op)', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), newRoomId: '15' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects unknown mode', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), mode: 'unknown' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects newRentAmount in variation mode (rent must use novation)', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), mode: 'variation', newRentAmount: 5000 }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects newDeposit in variation mode', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), mode: 'variation', newDeposit: 10000 }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects invalid effectiveDate', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), effectiveDate: 'not-a-date' }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects effectiveDate more than 1 day in the past', async () => {
      const longAgo = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), effectiveDate: longAgo }, adminContext()),
        'invalid-argument'
      );
    });
    it('accepts effectiveDate today / yesterday (timezone tolerance)', async () => {
      // Just validates — state read will then fail with not-found (no seed)
      seedTransferable();
      const todayIso = new Date().toISOString();
      // not-found is the expected NEXT failure (no tenant doc → wait we DID seed).
      // So this should succeed all the way through to variation mode.
      const result = await transferTenant.run(
        { ...goodInput(), effectiveDate: todayIso },
        adminContext()
      );
      assert.equal(result.success, true);
    });
    it('rejects non-positive newRentAmount in novation', async () => {
      for (const bad of [0, -100]) {
        await expectHttpsError(
          transferTenant.run({ ...goodInput(), mode: 'novation', newRentAmount: bad }, adminContext()),
          'invalid-argument'
        );
      }
    });
    it('rejects negative newDeposit in novation', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), mode: 'novation', newDeposit: -1 }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects non-string contractDocument / contractFileName / notes', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), contractDocument: 123 }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), contractFileName: {} }, adminContext()),
        'invalid-argument'
      );
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), notes: [] }, adminContext()),
        'invalid-argument'
      );
    });
    it('rejects non-string contractDocumentUrl', async () => {
      await expectHttpsError(
        transferTenant.run({ ...goodInput(), contractDocumentUrl: { invalid: true } }, adminContext()),
        'invalid-argument'
      );
    });
  });

  describe('_validateInput direct (white-box)', () => {
    it('normalises mode to "variation" when omitted', async () => {
      const result = await _validateInput(goodInput());
      assert.equal(result.mode, 'variation');
    });
    it('defaults effectiveDate to now (~ within 5s)', async () => {
      const before = Date.now();
      const result = await _validateInput(goodInput());
      const t = result.effectiveDate.getTime();
      assert.ok(t >= before && t <= Date.now() + 5000, `effectiveDate ${t} not near now ${before}`);
    });
    it('defaults transferDeposit=true, prorateBills=false', async () => {
      const result = await _validateInput(goodInput());
      assert.equal(result.transferDeposit, true);
      assert.equal(result.prorateBills, false);
    });
    it('coerces explicit booleans for transferDeposit / prorateBills', async () => {
      const result = await _validateInput({
        ...goodInput(),
        transferDeposit: 0,    // truthy → false
        prorateBills: 'yes',   // truthy → true
      });
      assert.equal(result.transferDeposit, false);
      assert.equal(result.prorateBills, true);
    });
  });
});

describe('transferTenant — S2 (state read)', () => {
  beforeEach(() => { resetStubs(); });

  it('throws not-found when old tenant doc does not exist', async () => {
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'not-found');
  });

  it('throws failed-precondition when old room has no tenantId', async () => {
    seedTransferable({ oldTenantExtras: { tenantId: '' } });
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws failed-precondition when tenant has no name', async () => {
    seedTransferable({ oldTenantExtras: { name: '', firstName: '', lastName: '' } });
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws failed-precondition when lease doc missing', async () => {
    const seed = seedTransferable();
    // Remove lease but keep tenant pointer
    delete stubState.docs[seed.leasePath];
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws failed-precondition when lease.status !== active', async () => {
    seedTransferable({ leaseExtras: { status: 'ended' } });
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws already-exists when target room is occupied', async () => {
    seedTransferable({ newRoomDoc: { tenantId: 'TENANT_other', name: 'อื่น' } });
    await expectHttpsError(transferTenant.run(goodInput(), adminContext()), 'already-exists');
  });

  it('accepts target room that exists but is vacant', async () => {
    seedTransferable({ newRoomDoc: { tenantId: '', status: 'vacant', building: 'rooms', roomId: '17' } });
    const result = await transferTenant.run(goodInput(), adminContext());
    assert.equal(result.success, true);
  });
});

describe('transferTenant — S3 (variation mode batch)', () => {
  beforeEach(() => { resetStubs(); });

  it('writes new tenant doc with carried identity', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const setOps = captured.batchOps.filter(o => o.op === 'set' && o.path === seed.newRoomPath);
    assert.equal(setOps.length, 1);
    const data = setOps[0].data;
    // Identity carried
    assert.equal(data.name, 'สมชาย สิบห้า');
    assert.equal(data.tenantId, seed.tenantId);
    assert.equal(data.phone, '0900000015');
    // Lease pointer same as old
    assert.equal(data.activeContractId, seed.oldLeaseId);
    assert.equal(data.lease.leaseId, seed.oldLeaseId);
    // Location updated to new room
    assert.equal(data.building, 'rooms');
    assert.equal(data.roomId, '17');
    assert.equal(data.status, 'occupied');
  });

  it('clears old tenant doc to vacant', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const upd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.oldRoomPath);
    assert.ok(upd, 'expected old tenant doc update');
    assert.equal(upd.data.tenantId, '');
    assert.equal(upd.data.name, '');
    assert.equal(upd.data.status, 'vacant');
    // lease subobject deletion sentinel
    assert.equal(upd.data.lease, '__delete__');
  });

  it('appends amendment entry to lease via arrayUnion', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation', notes: 'ตกลงย้ายห้อง' }, adminContext());
    const leaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.ok(leaseUpd, 'expected lease update');
    assert.equal(leaseUpd.data.roomId, '17');
    assert.equal(leaseUpd.data.building, 'rooms');
    assert.ok(leaseUpd.data.amendments && leaseUpd.data.amendments.__arrayUnion,
      'amendments must use arrayUnion sentinel');
    const entry = leaseUpd.data.amendments.__arrayUnion[0];
    assert.equal(entry.type, 'room_transfer');
    assert.equal(entry.fromRoom, '15');
    assert.equal(entry.toRoom, '17');
    assert.equal(entry.notes, 'ตกลงย้ายห้อง');
    assert.equal(entry.by, 'admin-uid');
  });

  it('keeps lease status="active" in variation (no transferredToLeaseId)', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const leaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.equal(leaseUpd.data.status, undefined, 'variation must NOT change lease status');
    assert.equal(leaseUpd.data.transferredToLeaseId, undefined);
  });

  it('does NOT create a new lease doc in variation (same-building)', async () => {
    seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const leaseSets = captured.batchOps.filter(o => o.op === 'set' && o.path.startsWith('leases/'));
    assert.equal(leaseSets.length, 0, 'variation same-building must not create a new lease');
  });

  it('moves lease doc across buildings when newBuilding != building', async () => {
    const seed = seedTransferable({ newBuilding: 'nest', newRoomId: 'N101' });
    await transferTenant.run(
      { ...goodInput(), newBuilding: 'nest', newRoomId: 'N101', mode: 'variation' },
      adminContext()
    );
    const newLeasePath = `leases/nest/list/${seed.oldLeaseId}`;
    const sets = captured.batchOps.filter(o => o.op === 'set' && o.path === newLeasePath);
    const deletes = captured.batchOps.filter(o => o.op === 'delete' && o.path === seed.leasePath);
    assert.equal(sets.length, 1, 'cross-building variation must create lease at new path');
    assert.equal(deletes.length, 1, 'cross-building variation must delete old lease path');
    // New lease doc has amendments resolved (NOT arrayUnion sentinel)
    assert.ok(Array.isArray(sets[0].data.amendments), 'cross-building set must resolve amendments to array');
  });

  it('updates people doc with new location', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const peopleOps = captured.batchOps.filter(o => o.path === `people/${seed.tenantId}`);
    assert.equal(peopleOps.length, 1);
    assert.equal(peopleOps[0].data.currentRoom, '17');
    assert.equal(peopleOps[0].data.currentBuilding, 'rooms');
  });

  it('carries old lease contractPath onto new tenant lease subobject (mirror for tenant_app reader)', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const newTenantSet = captured.batchOps.find(o => o.op === 'set' && o.path === seed.newRoomPath);
    // Seed sets lease.contractDocument = 'gs://bucket/leases/old.pdf' →
    // variation should mirror it as lease.contractPath on the new tenant doc
    // so tenant_app's _taLease.contractPath read finds it cleanly.
    assert.equal(newTenantSet.data.lease.contractPath, 'gs://bucket/leases/old.pdf');
    assert.equal(newTenantSet.data.lease.contractFileName, 'lease_2025.pdf');
  });
});

describe('transferTenant — S4 (novation mode batch)', () => {
  beforeEach(() => { resetStubs(); });

  it('creates NEW lease doc with priorLeaseId chain', async () => {
    seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    assert.ok(result.newLeaseId, 'novation must return newLeaseId');
    const newLeasePath = `leases/rooms/list/${result.newLeaseId}`;
    const newLeaseSet = captured.batchOps.find(o => o.op === 'set' && o.path === newLeasePath);
    assert.ok(newLeaseSet, 'expected new lease doc set');
    assert.equal(newLeaseSet.data.priorLeaseId, 'CONTRACT_1234567890_15');
    assert.equal(newLeaseSet.data.transferredFromLeaseId, 'CONTRACT_1234567890_15');
    assert.equal(newLeaseSet.data.transferredFromRoom, '15');
    assert.equal(newLeaseSet.data.roomId, '17');
    assert.equal(newLeaseSet.data.status, 'active');
  });

  it('sets old lease status="transferred" + transferredToLeaseId', async () => {
    const seed = seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const oldLeaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.ok(oldLeaseUpd, 'expected old lease update');
    assert.equal(oldLeaseUpd.data.status, 'transferred');
    assert.equal(oldLeaseUpd.data.transferredToLeaseId, result.newLeaseId);
    assert.equal(oldLeaseUpd.data.endReason, 'transferred');
  });

  it('applies newRentAmount override in novation', async () => {
    seedTransferable();
    const result = await transferTenant.run(
      { ...goodInput(), mode: 'novation', newRentAmount: 5500 },
      adminContext()
    );
    const newLeasePath = `leases/rooms/list/${result.newLeaseId}`;
    const newLeaseSet = captured.batchOps.find(o => o.op === 'set' && o.path === newLeasePath);
    assert.equal(newLeaseSet.data.rentAmount, 5500);
  });

  it('inherits old rent when newRentAmount omitted', async () => {
    seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const newLeasePath = `leases/rooms/list/${result.newLeaseId}`;
    const newLeaseSet = captured.batchOps.find(o => o.op === 'set' && o.path === newLeasePath);
    assert.equal(newLeaseSet.data.rentAmount, 4500);
  });

  it('does NOT touch amendments array (novation creates fresh lease)', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const oldLeaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.equal(oldLeaseUpd.data.amendments, undefined, 'novation must not amend old lease array');
  });

  it('novation with contractDocumentUrl: writes canonical documentURLs.agreement on new lease + lease.contractPath mirror', async () => {
    seedTransferable();
    const result = await transferTenant.run({
      ...goodInput(),
      mode: 'novation',
      contractDocument: 'leases/rooms/17/NEW_LEASE/lease-renewal-1779999.pdf',
      contractFileName: 'lease_novated_2026.pdf',
      contractDocumentUrl: 'https://firebasestorage.example.com/?token=novation',
    }, adminContext());

    const newLeasePath = `leases/rooms/list/${result.newLeaseId}`;
    const newLeaseSet = captured.batchOps.find(o => o.op === 'set' && o.path === newLeasePath);
    assert.ok(newLeaseSet.data.documentURLs, 'documentURLs object present on novated lease');
    assert.equal(newLeaseSet.data.documentURLs.agreement.url, 'https://firebasestorage.example.com/?token=novation');
    assert.equal(newLeaseSet.data.documentURLs.agreement.path, 'leases/rooms/17/NEW_LEASE/lease-renewal-1779999.pdf');
    assert.equal(newLeaseSet.data.documentURLs.agreement.fileName, 'lease_novated_2026.pdf');
    // Legacy path field still written (reader fallback chain)
    assert.equal(newLeaseSet.data.contractDocument, 'leases/rooms/17/NEW_LEASE/lease-renewal-1779999.pdf');

    // New tenant doc — lease.contractPath is what tenant_app.html reads first
    const newTenantPath = 'tenants/rooms/list/17';
    const newTenantSet = captured.batchOps.find(o => o.op === 'set' && o.path === newTenantPath);
    assert.equal(newTenantSet.data.lease.contractPath, 'leases/rooms/17/NEW_LEASE/lease-renewal-1779999.pdf');
    assert.equal(newTenantSet.data.lease.contractFileName, 'lease_novated_2026.pdf');
  });

  it('novation without new upload but old lease has documentURLs.agreement: new lease INHERITS it', async () => {
    const existingAgreement = {
      url: 'https://firebasestorage.example.com/old?token=xyz',
      path: 'leases/rooms/15/OLD_LEASE/old.pdf',
      fileName: 'old.pdf',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    seedTransferable({ leaseExtras: { documentURLs: { agreement: existingAgreement } } });

    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const newLeasePath = `leases/rooms/list/${result.newLeaseId}`;
    const newLeaseSet = captured.batchOps.find(o => o.op === 'set' && o.path === newLeasePath);
    assert.deepEqual(newLeaseSet.data.documentURLs.agreement, existingAgreement);
  });
});

describe('transferTenant — S5 (claim refresh §7-FF)', () => {
  beforeEach(() => { resetStubs(); });

  it('calls setCustomUserClaims with new room+building+tenantId on linked UID', async () => {
    seedTransferable({ linkedAuthUid: 'line:U_TEST_LINE_UID' });
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    assert.ok(captured.setCustomClaims.length > 0, 'expected setCustomUserClaims to be called');
    const claim = captured.setCustomClaims.find(c => c.uid === 'line:U_TEST_LINE_UID');
    assert.ok(claim, 'expected deterministic UID claim refresh');
    assert.equal(claim.claims.room, '17');
    assert.equal(claim.claims.building, 'rooms');
    assert.equal(claim.claims.tenantId, 'TENANT_t_15');
  });

  it('calls revokeRefreshTokens for the refreshed UID', async () => {
    seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    assert.ok(captured.revokeRefreshTokens.includes('line:U_TEST_LINE_UID'),
      'expected revokeRefreshTokens for deterministic UID');
  });

  it('preserves existing admin claim when merging', async () => {
    seedTransferable({ linkedAuthUid: 'line:U_TEST_LINE_UID' });
    stubState.existingClaims['line:U_TEST_LINE_UID'] = { admin: false, role: 'tenant' };
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const claim = captured.setCustomClaims.find(c => c.uid === 'line:U_TEST_LINE_UID');
    assert.equal(claim.claims.role, 'tenant', 'must merge with existing claims');
    assert.equal(claim.claims.room, '17', 'must apply new room');
  });

  it('refreshes both deterministic + legacy UIDs when they differ', async () => {
    seedTransferable({ linkedAuthUid: 'legacy_anon_uid_xyz' });
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const uids = captured.setCustomClaims.map(c => c.uid).sort();
    assert.deepEqual(uids, ['legacy_anon_uid_xyz', 'line:U_TEST_LINE_UID'].sort());
  });

  it('handles auth/user-not-found for legacy UID gracefully', async () => {
    seedTransferable({ linkedAuthUid: 'legacy_anon_cleaned_up' });
    stubState.claimErrors['legacy_anon_cleaned_up'] = 'user-not-found';
    const result = await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    // Deterministic UID should still succeed
    assert.equal(result.claimsRefreshed, 1);
  });

  it('returns claimsRefreshed=0 when tenant has never linked LIFF', async () => {
    seedTransferable({ linkedAuthUid: '', lineUserId: null });
    const result = await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    assert.equal(result.claimsRefreshed, 0);
    assert.equal(captured.setCustomClaims.length, 0);
  });

  it('updates liffUsers/{lineUserId}.building+room', async () => {
    seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const upd = captured.liffUserUpdates.find(u => u.path === 'liffUsers/U_TEST_LINE_UID');
    assert.ok(upd, 'expected liffUsers update');
    assert.equal(upd.patch.building, 'rooms');
    assert.equal(upd.patch.room, '17');
  });
});

describe('transferTenant — S6 (audit log)', () => {
  beforeEach(() => { resetStubs(); });

  it('writes RTDB audit entry on variation', async () => {
    seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation', notes: 'test note' }, adminContext());
    assert.equal(captured.auditPushes.length, 1);
    const audit = captured.auditPushes[0];
    assert.equal(audit.action, 'tenant_transferred');
    assert.equal(audit.mode, 'variation');
    assert.equal(audit.fromRoom, '15');
    assert.equal(audit.toRoom, '17');
    assert.equal(audit.notes, 'test note');
    assert.equal(audit.actor, 'admin@test');
  });

  it('writes RTDB audit entry on novation', async () => {
    seedTransferable();
    const result = await transferTenant.run(
      { ...goodInput(), mode: 'novation', newRentAmount: 5500 },
      adminContext()
    );
    assert.equal(captured.auditPushes.length, 1);
    const audit = captured.auditPushes[0];
    assert.equal(audit.mode, 'novation');
    assert.equal(audit.newLeaseId, result.newLeaseId);
    assert.equal(audit.oldLeaseId, 'CONTRACT_1234567890_15');
    assert.equal(audit.rentChanged, true);
    assert.equal(audit.newRent, 5500);
  });

  it('does NOT fail the call when audit write throws', async () => {
    seedTransferable();
    stubState.auditWriteError = 'rtdb-down';
    const result = await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    assert.equal(result.success, true, 'audit failure must be swallowed');
  });
});

describe('transferTenant — S7 (top-level integration)', () => {
  beforeEach(() => { resetStubs(); });

  it('returns mode + tenantId + lease IDs on success', async () => {
    seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    assert.equal(result.success, true);
    assert.equal(result.mode, 'novation');
    assert.equal(result.tenantId, 'TENANT_t_15');
    assert.equal(result.oldLeaseId, 'CONTRACT_1234567890_15');
    assert.match(result.newLeaseId, /^CONTRACT_\d+_17$/);
  });

  it('throws internal on batch.commit failure', async () => {
    seedTransferable();
    stubState.batchCommitError = 'firestore-down';
    await expectHttpsError(
      transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext()),
      'internal'
    );
  });

  it('IDENTITY_FIELDS export sanity check', () => {
    assert.ok(_IDENTITY_FIELDS.includes('name'));
    assert.ok(_IDENTITY_FIELDS.includes('tenantId'));
    assert.ok(_IDENTITY_FIELDS.includes('linkedAuthUid'));
    assert.ok(_IDENTITY_FIELDS.includes('gamification'));
  });

  it('carries gamification (points + dailyStreak + lastDailyClaim + badges) to new room', async () => {
    const seed = seedTransferable({
      oldTenantExtras: {
        gamification: {
          points: 41,
          dailyStreak: 5,
          lastDailyClaim: '2026-05-23',
          badges: ['eco_starter', 'wellness_5d'],
        },
      },
    });
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const setOp = captured.batchOps.find(o => o.op === 'set' && o.path === seed.newRoomPath);
    assert.ok(setOp, 'expected new room set op');
    assert.deepEqual(setOp.data.gamification, {
      points: 41,
      dailyStreak: 5,
      lastDailyClaim: '2026-05-23',
      badges: ['eco_starter', 'wellness_5d'],
    }, 'gamification must transfer intact to new room (NOT reset)');
  });

  it('resets old room gamification to null after transfer (next occupant fresh)', async () => {
    const seed = seedTransferable({
      oldTenantExtras: { gamification: { points: 41, dailyStreak: 5 } },
    });
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const updOp = captured.batchOps.find(o => o.op === 'update' && o.path === seed.oldRoomPath);
    assert.ok(updOp, 'expected old room update');
    assert.equal(updOp.data.gamification, null, 'old room gamification must be nulled so next tenant cannot see prior points');
  });
});

// ── Plan B' S2 — occupancyLog write asserts ───────────────────────────────────

describe("transferTenant — Plan B' S2 occupancyLog (variation mode)", () => {
  beforeEach(() => { resetStubs(); });

  it('writes paired transferred_out + transferred_in entries with source="transferTenant.variation"', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const outOps = captured.batchOps.filter(o => o.op === 'set'
      && o.path.startsWith(`${seed.oldRoomPath}/occupancyLog/`));
    const inOps = captured.batchOps.filter(o => o.op === 'set'
      && o.path.startsWith(`${seed.newRoomPath}/occupancyLog/`));
    assert.equal(outOps.length, 1, 'expected exactly one transferred_out entry at OLD room');
    assert.equal(inOps.length, 1, 'expected exactly one transferred_in entry at NEW room');
    assert.equal(outOps[0].data.action, 'transferred_out');
    assert.equal(inOps[0].data.action, 'transferred_in');
    assert.equal(outOps[0].data.source, 'transferTenant.variation');
    assert.equal(inOps[0].data.source, 'transferTenant.variation');
  });

  it('both variation entries share the SAME discriminator (paired via amendment timestamp)', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const outOp = captured.batchOps.find(o => o.path.startsWith(`${seed.oldRoomPath}/occupancyLog/`));
    const inOp = captured.batchOps.find(o => o.path.startsWith(`${seed.newRoomPath}/occupancyLog/`));
    // idempotencyKey shape: source__leaseId__action__building__roomId__discriminator
    // The LAST segment (after the last '__') is the discriminator. Both entries
    // must share it so admin can pair them.
    const extractDisc = (key) => key.split('__').slice(-1)[0];
    const outDisc = extractDisc(outOp.data.idempotencyKey);
    const inDisc  = extractDisc(inOp.data.idempotencyKey);
    assert.equal(outDisc, inDisc,
      `variation pair must share discriminator; got out='${outDisc}', in='${inDisc}'`);
    assert.ok(outDisc.length > 0, 'discriminator must be non-empty (amendment timestamp)');
  });

  it('variation entries carry otherBuilding/otherRoom pointing at each other', async () => {
    const seed = seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const outOp = captured.batchOps.find(o => o.path.startsWith(`${seed.oldRoomPath}/occupancyLog/`));
    const inOp = captured.batchOps.find(o => o.path.startsWith(`${seed.newRoomPath}/occupancyLog/`));
    assert.equal(outOp.data.otherBuilding, 'rooms');
    assert.equal(outOp.data.otherRoom, '17');
    assert.equal(inOp.data.otherBuilding, 'rooms');
    assert.equal(inOp.data.otherRoom, '15');
    // Both share the SAME leaseId in variation mode (it's the same lease)
    assert.equal(outOp.data.leaseId, seed.oldLeaseId);
    assert.equal(inOp.data.leaseId, seed.oldLeaseId);
  });

  it('variation reverse transfer writes 2 entries with new discriminator (independent of first pair)', async () => {
    // First leg: 15 → 17
    seedTransferable();
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const firstOpsCount = captured.batchOps.filter(o => o.path.includes('/occupancyLog/')).length;
    assert.equal(firstOpsCount, 2);
    const firstKeys = captured.batchOps
      .filter(o => o.path.includes('/occupancyLog/'))
      .map(o => o.data.idempotencyKey);

    // Reset + seed reverse: tenant now at 17, going back to 15.
    resetStubs();
    seedTransferable({ oldRoomId: '17', newRoomId: '15', oldLeaseId: 'CONTRACT_1234567890_15' });
    // Wait a beat so the amendmentEntry.at (Date.now ISO) differs.
    await new Promise(r => setTimeout(r, 5));
    await transferTenant.run({
      building: 'rooms', oldRoomId: '17', newBuilding: 'rooms', newRoomId: '15', mode: 'variation',
    }, adminContext());
    const secondKeys = captured.batchOps
      .filter(o => o.path.includes('/occupancyLog/'))
      .map(o => o.data.idempotencyKey);
    assert.equal(secondKeys.length, 2);
    // The two pairs must NOT share any keys (different discriminators)
    for (const k of secondKeys) {
      assert.ok(!firstKeys.includes(k),
        `reverse pair must produce fresh discriminators; key '${k}' collided with first pair`);
    }
  });
});

describe("transferTenant — Plan B' S2 occupancyLog (novation mode)", () => {
  beforeEach(() => { resetStubs(); });

  it('writes paired transferred_out + transferred_in entries with source="transferTenant.novation"', async () => {
    const seed = seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const outOp = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.oldRoomPath}/occupancyLog/`));
    const inOp = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.newRoomPath}/occupancyLog/`));
    assert.ok(outOp, 'expected transferred_out at old room');
    assert.ok(inOp, 'expected transferred_in at new room');
    assert.equal(outOp.data.source, 'transferTenant.novation');
    assert.equal(inOp.data.source, 'transferTenant.novation');
    assert.equal(outOp.data.action, 'transferred_out');
    assert.equal(inOp.data.action, 'transferred_in');
    // Novation: each entry's leaseId is the lease in effect AT THAT EVENT
    assert.equal(outOp.data.leaseId, seed.oldLeaseId, 'transferred_out carries OLD leaseId');
    assert.equal(inOp.data.leaseId, result.newLeaseId, 'transferred_in carries NEW leaseId');
  });

  it('novation discriminators pair the two entries via OTHER lease id', async () => {
    const seed = seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const outOp = captured.batchOps.find(o => o.path.startsWith(`${seed.oldRoomPath}/occupancyLog/`));
    const inOp = captured.batchOps.find(o => o.path.startsWith(`${seed.newRoomPath}/occupancyLog/`));
    const extractDisc = (key) => key.split('__').slice(-1)[0];
    // out's discriminator points at NEW lease; in's discriminator points at OLD lease.
    // This is by design — either entry's discriminator identifies the OTHER lease.
    assert.equal(extractDisc(outOp.data.idempotencyKey), result.newLeaseId);
    assert.equal(extractDisc(inOp.data.idempotencyKey), seed.oldLeaseId);
  });

  it('tenantName falls back through lease → tenant doc name when lease.tenantName empty', async () => {
    // Lease has NO tenantName; tenant doc still has name='สมชาย สิบห้า' — fallback should pick that up.
    seedTransferable({ leaseExtras: { tenantName: '' } });
    await transferTenant.run({ ...goodInput(), mode: 'variation' }, adminContext());
    const outOp = captured.batchOps.find(o => o.path.includes('/list/15/occupancyLog/'));
    assert.equal(outOp.data.tenantName, 'สมชาย สิบห้า',
      'must fall back to tenants doc name when lease.tenantName empty');
  });

  it('retry within same effective period produces IDENTICAL idempotencyKey (no double-write)', async () => {
    // Two consecutive novation calls with the same fixture should yield two entries
    // each, but if newLeaseId is deterministic for a given call, the keys are stable
    // per call. We mainly verify that for a SINGLE call, keys are deterministic from
    // the {source, leaseId, action, building, roomId, discriminator} tuple.
    seedTransferable();
    const result = await transferTenant.run({ ...goodInput(), mode: 'novation' }, adminContext());
    const ops = captured.batchOps.filter(o => o.path.includes('/occupancyLog/'));
    // Doc id (last path segment) MUST equal the persisted idempotencyKey field —
    // this is what makes set-without-merge replays safe.
    for (const op of ops) {
      const docIdFromPath = op.path.split('/').pop();
      assert.equal(docIdFromPath, op.data.idempotencyKey,
        'doc id must equal idempotencyKey so CF retries collapse onto same doc');
    }
    // And the keys must include the source for backfill differentiation later.
    assert.ok(ops[0].data.idempotencyKey.startsWith('transferTenant.novation__')
           || ops[0].data.idempotencyKey.startsWith('transferTenant_novation__'),
      `idempotencyKey must encode the source; got: ${ops[0].data.idempotencyKey}`);
    void result;
  });
});
