/**
 * Unit tests for archiveTenantOnMoveOut — covers auth, validation,
 * pre-conditions, batch shape (archive + tenant blank + lease end + subdocs),
 * and Plan B' S2 occupancyLog write.
 *
 * Mirrors transferTenant.test.js's stub harness (firebase-admin via
 * Module._load, real firebase-functions/v1 for .run() handle).
 *
 * Run: node --test functions/__tests__/archiveTenantOnMoveOut.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // 'tenants/rooms/list/15' → {...}
    docs: {},
    // 'tenants/rooms/list/15/paymentHistory' → [{id, data}]
    subcollections: {},
    batchCommitError: null,
    ...overrides,
  };
  captured = {
    batchOps: [],
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
  };
}

function makeColl(path) {
  return {
    path,
    doc: (id) => makeDocRef(`${path}/${id}`),
    get: async () => {
      const subDocs = stubState.subcollections[path] || [];
      const docs = subDocs.map(d => ({
        id: d.id,
        data: () => d.data,
        ref: makeDocRef(`${path}/${d.id}`),
      }));
      return {
        docs,
        empty: docs.length === 0,
        forEach: (fn) => docs.forEach(fn),
      };
    },
    // buildingRegistry calls .get() on the buildings collection — empty
    // means we fall through to STATIC_FALLBACK ['rooms','nest']. OK.
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
      serverTimestamp: () => '__ts__',
      delete: () => '__delete__',
    },
  }
);

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: firestoreFn,
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  // Stub firebase-functions/v1 (Gen1 callable wrapper) so tests run without
  // the package installed locally. Mirrors the firebase-functions/v2/https
  // stub pattern used in cleanupMarketplaceChat.test.js etc.
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    // Gen1 onCall returns a wrapped function with a .run(data, context) test
    // hook; replicate that surface so existing .run(input, ctx) tests work.
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

const { archiveTenantOnMoveOut } = require('../archiveTenantOnMoveOut');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true, email: 'admin@test' } } };
}

function tenantContext() {
  return { auth: { uid: 'tenant-uid', token: { admin: false } } };
}

const goodInput = () => ({ building: 'rooms', roomId: '15', reason: 'moved_out' });

async function expectHttpsError(promise, code) {
  let caught;
  try { await promise; } catch (e) { caught = e; }
  assert.ok(caught, `expected HttpsError with code='${code}', got success`);
  assert.equal(caught.code, code,
    `expected code='${code}', got '${caught.code}' (message: ${caught.message})`);
  return caught;
}

/**
 * Seed an archivable tenant at rooms/15 with active lease.
 * Returns { tenantId, leaseId, tenantPath, leasePath, archivePath }.
 */
function seedArchivable(overrides = {}) {
  const tenantId = overrides.tenantId || 'TENANT_t_15';
  const leaseId = overrides.leaseId || 'CONTRACT_999_15';
  const tenantPath = `tenants/${overrides.building || 'rooms'}/list/${overrides.roomId || '15'}`;
  const leasePath = `leases/${overrides.building || 'rooms'}/list/${leaseId}`;

  stubState.docs[tenantPath] = {
    name: 'สมชาย สิบห้า',
    firstName: 'สมชาย',
    lastName: 'สิบห้า',
    phone: '0900000015',
    tenantId,
    contractId: leaseId,
    activeContractId: leaseId,
    lease: { leaseId, status: 'active' },
    rentAmount: 4500,
    deposit: 9000,
    status: 'occupied',
    ...overrides.tenantExtras,
  };
  if (overrides.includeLease !== false) {
    stubState.docs[leasePath] = {
      id: leaseId,
      status: 'active',
      tenantId,
      building: overrides.building || 'rooms',
      roomId: overrides.roomId || '15',
      ...overrides.leaseExtras,
    };
  }
  return {
    tenantId,
    leaseId,
    tenantPath,
    leasePath,
    archivePath: `tenants/${overrides.building || 'rooms'}/archive/${leaseId}`,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('archiveTenantOnMoveOut — auth + validation', () => {
  beforeEach(() => { resetStubs(); });

  it('rejects unauthenticated callers', async () => {
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), { auth: null }), 'unauthenticated');
  });

  it('rejects callers without admin claim', async () => {
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), tenantContext()), 'permission-denied');
  });

  it('rejects invalid building', async () => {
    await expectHttpsError(
      archiveTenantOnMoveOut.run({ ...goodInput(), building: 'not-a-building' }, adminContext()),
      'invalid-argument'
    );
  });

  it('rejects malformed roomId', async () => {
    for (const bad of ['', 'room#1', 'a'.repeat(21)]) {
      await expectHttpsError(
        archiveTenantOnMoveOut.run({ ...goodInput(), roomId: bad }, adminContext()),
        'invalid-argument'
      );
    }
  });

  it('rejects unknown reason', async () => {
    await expectHttpsError(
      archiveTenantOnMoveOut.run({ ...goodInput(), reason: 'eaten_by_alpacas' }, adminContext()),
      'invalid-argument'
    );
  });

  it('defaults reason to "moved_out" when omitted', async () => {
    seedArchivable();
    const result = await archiveTenantOnMoveOut.run({ building: 'rooms', roomId: '15' }, adminContext());
    assert.equal(result.reason, 'moved_out');
  });
});

describe('archiveTenantOnMoveOut — pre-conditions', () => {
  beforeEach(() => { resetStubs(); });

  it('throws not-found when tenant doc does not exist', async () => {
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), adminContext()), 'not-found');
  });

  it('throws failed-precondition when tenant has no tenantId (vacant)', async () => {
    seedArchivable({ tenantExtras: { tenantId: '' } });
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws failed-precondition when tenant has tenantId but no name', async () => {
    seedArchivable({ tenantExtras: { name: '', firstName: '', lastName: '' } });
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), adminContext()), 'failed-precondition');
  });

  it('throws already-exists when archive doc with same contractId already present', async () => {
    const seed = seedArchivable();
    stubState.docs[seed.archivePath] = { tenantId: 'prior' };
    await expectHttpsError(archiveTenantOnMoveOut.run(goodInput(), adminContext()), 'already-exists');
  });
});

describe('archiveTenantOnMoveOut — batch shape', () => {
  beforeEach(() => { resetStubs(); });

  it('writes archive doc with archive metadata + contractId', async () => {
    const seed = seedArchivable();
    const result = await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const archSet = captured.batchOps.find(o => o.op === 'set' && o.path === seed.archivePath);
    assert.ok(archSet, 'expected archive doc set');
    assert.equal(archSet.data.contractId, seed.leaseId);
    assert.equal(archSet.data.archivedReason, 'moved_out');
    assert.equal(archSet.data.archivedBy, 'admin-uid');
    assert.equal(archSet.data.archivedByEmail, 'admin@test');
    assert.deepEqual(archSet.data.sourceRoom, { building: 'rooms', roomId: '15' });
    assert.equal(result.success, true);
    assert.equal(result.contractId, seed.leaseId);
    assert.equal(result.tenantId, seed.tenantId);
  });

  it('blanks live tenant doc to status="vacant"', async () => {
    const seed = seedArchivable();
    await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const upd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.tenantPath);
    assert.ok(upd, 'expected tenant doc update');
    assert.equal(upd.data.tenantId, '');
    assert.equal(upd.data.name, '');
    assert.equal(upd.data.status, 'vacant');
    assert.equal(upd.data.lease, '__delete__');
  });

  it('marks active lease as status="ended" (§7-L)', async () => {
    const seed = seedArchivable();
    await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const leaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.ok(leaseUpd, 'expected lease end update');
    assert.equal(leaseUpd.data.status, 'ended');
    assert.equal(leaseUpd.data.endReason, 'moved_out');
    assert.equal(leaseUpd.data.endedBy, 'admin-uid');
  });

  it('skips lease end update when no lease doc found (legacy data)', async () => {
    const seed = seedArchivable({ includeLease: false });
    await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const leaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.equal(leaseUpd, undefined, 'must not write lease end when lease doc absent');
  });

  it('copies subcollection docs + deletes originals', async () => {
    const seed = seedArchivable();
    stubState.subcollections[`${seed.tenantPath}/paymentHistory`] = [
      { id: 'pay1', data: { amount: 4500, at: '2026-04-01' } },
      { id: 'pay2', data: { amount: 4500, at: '2026-05-01' } },
    ];
    const result = await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const archSets = captured.batchOps.filter(o => o.op === 'set' && o.path.startsWith(`${seed.archivePath}/paymentHistory/`));
    const dels = captured.batchOps.filter(o => o.op === 'delete' && o.path.startsWith(`${seed.tenantPath}/paymentHistory/`));
    assert.equal(archSets.length, 2);
    assert.equal(dels.length, 2);
    assert.equal(result.archivedSubdocs, 2);
  });
});

// ── Plan B' S2 — occupancyLog write asserts ───────────────────────────────────

describe("archiveTenantOnMoveOut — Plan B' S2 occupancyLog write", () => {
  beforeEach(() => { resetStubs(); });

  it('appends ONE occupancyLog entry (action=archived) under the tenant room', async () => {
    const seed = seedArchivable();
    await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog entry must be written under the tenant room');

    const e = logSet.data;
    assert.equal(e.action, 'archived');
    assert.equal(e.source, 'archiveTenantOnMoveOut');
    assert.equal(e.building, 'rooms');
    assert.equal(e.roomId, '15');
    assert.equal(e.tenantId, seed.tenantId);
    assert.equal(e.leaseId, seed.leaseId);
    assert.equal(e.by, 'admin-uid');
    assert.equal(e.byEmail, 'admin@test');
    assert.equal(e.reason, 'moved_out');
    // Pair fields null for non-transfer events
    assert.equal(e.otherBuilding, null);
    assert.equal(e.otherRoom, null);
    assert.equal(e.tenantName, 'สมชาย สิบห้า');
  });

  it('idempotencyKey shape includes source__leaseId__action__building__roomId', async () => {
    const seed = seedArchivable();
    await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    const docId = logSet.path.split('/').pop();
    assert.equal(docId, logSet.data.idempotencyKey,
      'doc id MUST equal idempotencyKey so retries collapse onto same doc');
    // Shape: archiveTenantOnMoveOut__{leaseId}__archived__rooms__15__
    // (discriminator is empty string per _occupancyLog.js doc)
    assert.ok(docId.startsWith('archiveTenantOnMoveOut__'),
      `expected key to start with source, got: ${docId}`);
    assert.ok(docId.includes(seed.leaseId),
      `expected key to include leaseId ${seed.leaseId}, got: ${docId}`);
    assert.ok(docId.includes('archived'),
      `expected key to include action 'archived', got: ${docId}`);
    assert.ok(docId.includes('rooms__15'),
      `expected key to include building/roomId, got: ${docId}`);
  });

  it('works for legacy tenants without an active lease (uses LEGACY_ contractId)', async () => {
    // Drop the lease doc — CF falls through to LEGACY_${tenantId}_${ts} contractId.
    // CF should still write a single occupancyLog entry (leaseId = the LEGACY_ contractId).
    const seed = seedArchivable({
      includeLease: false,
      tenantExtras: { contractId: '', lease: null, activeContractId: '' },
    });
    const result = await archiveTenantOnMoveOut.run(goodInput(), adminContext());
    assert.ok(result.contractId.startsWith('LEGACY_'), 'expected LEGACY_ prefix contractId');

    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog must still write even when no lease doc exists');
    assert.equal(logSet.data.leaseId, result.contractId,
      'log leaseId must fall back to the computed LEGACY_ contractId');
    assert.equal(logSet.data.action, 'archived');
  });
});
