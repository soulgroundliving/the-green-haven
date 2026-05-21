/**
 * Unit tests for revertTransitionToPlayer — focus on Plan B' occupancyLog wiring.
 *
 * Mirrors archiveTenantOnMoveOut.test.js's stub harness pattern.
 *
 * Run: node --test functions/__tests__/revertTransitionToPlayer.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    docs: {},
    subcollections: {},
    batchCommitError: null,
    ...overrides,
  };
  captured = { batchOps: [] };
}
resetStubs();

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
    update: async () => {},
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
      return { docs, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
    },
  };
}

const fsBatch = () => ({
  set: (ref, data, options) => captured.batchOps.push({ op: 'set', path: ref.path, data, options: options || null }),
  update: (ref, data) => captured.batchOps.push({ op: 'update', path: ref.path, data }),
  delete: (ref) => captured.batchOps.push({ op: 'delete', path: ref.path }),
  commit: async () => { if (stubState.batchCommitError) throw new Error(stubState.batchCommitError); },
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
  auth: () => ({ setCustomUserClaims: async () => {} }),
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'firebase-admin') return adminStub;
  return originalLoad.apply(this, arguments);
};

const { revertTransitionToPlayer } = require('../revertTransitionToPlayer');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminContext() {
  return { auth: { uid: 'admin-uid', token: { admin: true, email: 'admin@test' } } };
}

const goodInput = () => ({ building: 'rooms', roomId: '15' });

async function expectHttpsError(promise, code) {
  let caught;
  try { await promise; } catch (e) { caught = e; }
  assert.ok(caught, `expected HttpsError with code='${code}', got success`);
  assert.equal(caught.code, code, `expected code='${code}', got '${caught.code}' (${caught.message})`);
  return caught;
}

/**
 * Seed a reversibly-transitioned tenant — live doc vacant with
 * lastArchivedContractId, archive doc with archivedReason='transitioned_to_player',
 * people doc with identity + gamification.
 */
function seedRevertable(overrides = {}) {
  const tenantId = overrides.tenantId || 'TENANT_t_15';
  const contractId = overrides.contractId || 'CONTRACT_999_15';
  const building = overrides.building || 'rooms';
  const roomId = overrides.roomId || '15';
  const tenantPath = `tenants/${building}/list/${roomId}`;
  const archivePath = `tenants/${building}/archive/${contractId}`;
  const peoplePath = `people/${tenantId}`;
  const leasePath = `leases/${building}/list/${contractId}`;

  stubState.docs[tenantPath] = {
    building,
    roomId,
    status: 'vacant',
    lastArchivedContractId: contractId,
    ...overrides.tenantExtras,
  };
  stubState.docs[archivePath] = {
    tenantId,
    name: 'สมชาย สิบห้า',
    firstName: 'สมชาย',
    lastName: 'สิบห้า',
    phone: '0900000015',
    lineID: 'Uabc123',
    linkedAuthUid: 'uid_abc',
    archivedReason: 'transitioned_to_player',
    archivedAt: '__ts__',
    contractId,
    rentAmount: 4500,
    deposit: 9000,
    ...overrides.archiveExtras,
  };
  stubState.docs[peoplePath] = {
    tenantId,
    name: 'สมชาย สิบห้า',
    firstName: 'สมชาย',
    lastName: 'สิบห้า',
    phone: '0900000015',
    email: '',
    lineUserId: 'Uabc123',
    linkedAuthUid: 'uid_abc',
    gamification: { points: 600, dailyStreak: 6, badges: [], lastDailyClaim: null },
    ...overrides.peopleExtras,
  };
  if (overrides.includeLease !== false) {
    stubState.docs[leasePath] = {
      id: contractId,
      status: 'ended',
      endReason: 'transitioned_to_player',
      tenantId,
    };
  }
  return { tenantId, contractId, tenantPath, archivePath, peoplePath, leasePath };
}

// ── Tests — Plan B' occupancyLog wiring ───────────────────────────────────────

describe("revertTransitionToPlayer — Plan B' occupancyLog write", () => {
  beforeEach(() => { resetStubs(); });

  it('appends ONE occupancyLog entry (action=restored) under the tenant room', async () => {
    const seed = seedRevertable();
    await revertTransitionToPlayer.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog entry must be written under the tenant room');

    const e = logSet.data;
    assert.equal(e.action, 'restored');
    assert.equal(e.source, 'revertTransitionToPlayer');
    assert.equal(e.building, 'rooms');
    assert.equal(e.roomId, '15');
    assert.equal(e.tenantId, seed.tenantId);
    assert.equal(e.leaseId, seed.contractId,
      'log.leaseId must equal the archive contractId (the lease being re-activated)');
    assert.equal(e.by, 'admin-uid');
    assert.equal(e.byEmail, 'admin@test');
    assert.equal(e.reason, 'reverted_from_player');
    assert.equal(e.otherBuilding, null);
    assert.equal(e.otherRoom, null);
    assert.equal(e.tenantName, 'สมชาย สิบห้า');
  });

  it('idempotencyKey doc id = idempotencyKey field, shape starts with source', async () => {
    const seed = seedRevertable();
    await revertTransitionToPlayer.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    const docId = logSet.path.split('/').pop();
    assert.equal(docId, logSet.data.idempotencyKey,
      'doc id MUST equal idempotencyKey so retries collapse onto same doc');
    assert.ok(docId.startsWith('revertTransitionToPlayer__'),
      `expected key to start with source 'revertTransitionToPlayer__', got: ${docId}`);
    assert.ok(docId.includes(seed.contractId), `expected key to include leaseId, got: ${docId}`);
    assert.ok(docId.includes('restored'), `expected key to include action 'restored', got: ${docId}`);
    assert.ok(docId.includes('rooms__15'), `expected key to include building/roomId, got: ${docId}`);
  });

  it('writes occupancyLog even when no lease doc exists (legacy contract pre-Phase-3d split)', async () => {
    const seed = seedRevertable({ includeLease: false });
    const result = await revertTransitionToPlayer.run(goodInput(), adminContext());
    assert.equal(result.success, true);

    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog must still write even when no lease doc exists');
    assert.equal(logSet.data.leaseId, seed.contractId);
    assert.equal(logSet.data.action, 'restored');

    // Confirm no lease update was emitted
    const leaseUpd = captured.batchOps.find(o => o.op === 'update' && o.path === seed.leasePath);
    assert.equal(leaseUpd, undefined, 'must not write lease re-activate when lease doc absent');
  });

  it('rejects revert when archive doc was already reverted (no duplicate occupancyLog)', async () => {
    seedRevertable({ archiveExtras: { revertedAt: '__ts__' } });
    await expectHttpsError(revertTransitionToPlayer.run(goodInput(), adminContext()), 'already-exists');
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.includes('/occupancyLog/'));
    assert.equal(logSet, undefined, 'pre-condition must block before any batch ops');
  });
});
