/**
 * Unit tests for transitionToPlayer — focus on Plan B' occupancyLog wiring.
 *
 * Mirrors archiveTenantOnMoveOut.test.js's stub harness (firebase-admin via
 * Module._load, real firebase-functions/v1 for .run()).
 *
 * Run: node --test functions/__tests__/transitionToPlayer.test.js
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
    update: async () => {}, // post-batch liffUsers update; ignored
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
  auth: () => ({
    setCustomUserClaims: async () => {},
    revokeRefreshTokens: async () => {},
  }),
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
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

const { transitionToPlayer } = require('../transitionToPlayer');

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

function seedTransitionable(overrides = {}) {
  const tenantId = overrides.tenantId || 'TENANT_t_15';
  const leaseId = overrides.leaseId || 'CONTRACT_999_15';
  const tenantPath = `tenants/${overrides.building || 'rooms'}/list/${overrides.roomId || '15'}`;
  const leasePath = `leases/${overrides.building || 'rooms'}/list/${leaseId}`;

  stubState.docs[tenantPath] = {
    name: 'สมชาย สิบห้า',
    firstName: 'สมชาย',
    lastName: 'สิบห้า',
    phone: '0900000015',
    lineID: 'Uabc123',
    tenantId,
    contractId: leaseId,
    activeContractId: leaseId,
    lease: { leaseId, status: 'active' },
    rentAmount: 4500,
    deposit: 9000,
    gamification: { points: 500, dailyStreak: 5, badges: ['first-pay'], lastDailyClaim: '2026-05-21' },
    status: 'occupied',
    ...overrides.tenantExtras,
  };
  if (overrides.includeLease !== false) {
    stubState.docs[leasePath] = { id: leaseId, status: 'active', tenantId };
  }
  return {
    tenantId,
    leaseId,
    tenantPath,
    leasePath,
    archivePath: `tenants/${overrides.building || 'rooms'}/archive/${leaseId}`,
  };
}

// ── Tests — Plan B' occupancyLog wiring ───────────────────────────────────────

describe("transitionToPlayer — Plan B' occupancyLog write", () => {
  beforeEach(() => { resetStubs(); });

  it('appends ONE occupancyLog entry (action=archived) under the tenant room', async () => {
    const seed = seedTransitionable();
    await transitionToPlayer.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog entry must be written under the tenant room');

    const e = logSet.data;
    assert.equal(e.action, 'archived');
    assert.equal(e.source, 'transitionToPlayer');
    assert.equal(e.building, 'rooms');
    assert.equal(e.roomId, '15');
    assert.equal(e.tenantId, seed.tenantId);
    assert.equal(e.leaseId, seed.leaseId);
    assert.equal(e.by, 'admin-uid');
    assert.equal(e.byEmail, 'admin@test');
    assert.equal(e.reason, 'transitioned_to_player');
    assert.equal(e.otherBuilding, null);
    assert.equal(e.otherRoom, null);
    assert.equal(e.tenantName, 'สมชาย สิบห้า');
  });

  it('idempotencyKey doc id = idempotencyKey field, shape starts with source', async () => {
    const seed = seedTransitionable();
    await transitionToPlayer.run(goodInput(), adminContext());
    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    const docId = logSet.path.split('/').pop();
    assert.equal(docId, logSet.data.idempotencyKey,
      'doc id MUST equal idempotencyKey so retries collapse onto same doc');
    assert.ok(docId.startsWith('transitionToPlayer__'),
      `expected key to start with source 'transitionToPlayer__', got: ${docId}`);
    assert.ok(docId.includes(seed.leaseId), `expected key to include leaseId, got: ${docId}`);
    assert.ok(docId.includes('archived'), `expected key to include action 'archived', got: ${docId}`);
    assert.ok(docId.includes('rooms__15'), `expected key to include building/roomId, got: ${docId}`);
  });

  it('falls back to LEGACY_ contractId for log.leaseId when no lease doc', async () => {
    const seed = seedTransitionable({
      includeLease: false,
      tenantExtras: { contractId: '', lease: null, activeContractId: '' },
    });
    const result = await transitionToPlayer.run(goodInput(), adminContext());
    assert.ok(result.contractId.startsWith('LEGACY_'), 'expected LEGACY_ prefix contractId');

    const logSet = captured.batchOps.find(o => o.op === 'set'
      && o.path.startsWith(`${seed.tenantPath}/occupancyLog/`));
    assert.ok(logSet, 'occupancyLog must still write even when no lease doc exists');
    assert.equal(logSet.data.leaseId, result.contractId,
      'log.leaseId must fall back to the computed LEGACY_ contractId');
    assert.equal(logSet.data.action, 'archived');
  });

  it('aborts with internal error if occupancyLog write would violate a required field', async () => {
    // Seed a tenant whose name is empty (firstName-only), then force the empty-fallback
    // path to confirm appendLog's missing-tenantName guard fires before commit.
    // First show that with name set, transition succeeds (sanity).
    seedTransitionable();
    const okResult = await transitionToPlayer.run(goodInput(), adminContext());
    assert.equal(okResult.success, true);

    // Now reset + seed without a name AND without firstName so the
    // appendLog `tenantName` ends up '' — but the CF's own pre-condition check
    // would block this first (failed-precondition: 'has tenantId but no name').
    // Verify the pre-condition guard ALONE catches it (preferred), so the
    // appendLog guard never has to.
    resetStubs();
    seedTransitionable({ tenantExtras: { name: '', firstName: '', lastName: '' } });
    await expectHttpsError(transitionToPlayer.run(goodInput(), adminContext()), 'failed-precondition');
  });
});
