/**
 * Unit tests for requestPetLink — a pet sends a friend request to another pet
 * in the same building (Meaning Layer #10). Covers: pending edge creation with
 * sorted petA/petB + owner identity, ownership/building/public guards, dedup
 * (pending/accepted) + re-request after decline, single-winner via the tx.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let store, rateLimitCalls;
function reset() { store = {}; rateLimitCalls = []; }
reset();

function docRef(path) {
  return {
    _path: path,
    async get() { return { exists: path in store, data: () => store[path], ref: docRef(path) }; },
    async set(data) { store[path] = { ...data }; },
    async delete() { delete store[path]; },
    collection(sub) { return collRef(path + '/' + sub); },
  };
}
function collRef(prefix) {
  const c = { doc(id) { return docRef(prefix + '/' + id); } };
  return c;
}

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (n) => collRef(n),
      runTransaction: async (fn) => fn({
        get: async (ref) => ref.get(),
        set: (ref, d) => { store[ref._path] = { ...d }; },
        update: (ref, patch) => { store[ref._path] = { ...(store[ref._path] || {}), ...patch }; },
        delete: (ref) => { delete store[ref._path]; },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './_rateLimit') {
    return { checkRateLimit: async (uid, action, max, win) => { rateLimitCalls.push([uid, action, max, win]); } };
  }
  if (id === './_notifyHelper') {
    return { lookupApprovedRoomUsers: async () => ({ docs: [] }), pushAndRetry: async () => ({ pushed: 0, failed: 0 }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { requestPetLink: handler } = require('../requestPetLink');
after(() => { Module._load = _origLoad; });

function ctx(room = 'N101', building = 'nest', uid = 'line:Uowner') {
  return { auth: { uid, token: { room, building, tenantId: 'TENANT_A' } } };
}
function seedProfiles() {
  store['petProfiles/p1'] = { petId: 'p1', building: 'nest', ownerRoom: 'N101', ownerTenantId: 'TENANT_A', name: 'โกโก้' };
  store['petProfiles/p2'] = { petId: 'p2', building: 'nest', ownerRoom: 'N202', ownerTenantId: 'TENANT_B', name: 'มะลิ' };
}
const ARGS = { building: 'nest', roomId: 'N101', fromPetId: 'p1', toPetId: 'p2' };

describe('requestPetLink — create', () => {
  beforeEach(reset);

  it('creates a pending edge with sorted petA/petB + both identities + rate-limit', async () => {
    seedProfiles();
    const r = await handler(ARGS, ctx());
    assert.equal(r.success, true);
    assert.equal(r.linkId, 'p1_p2');
    const link = store['petLinks/p1_p2'];
    assert.equal(link.status, 'pending');
    assert.equal(link.petA, 'p1');
    assert.equal(link.petB, 'p2');
    assert.equal(link.requesterPetId, 'p1');
    assert.equal(link.requesterTenantId, 'TENANT_A');
    assert.equal(link.requesterRoom, 'N101');
    assert.equal(link.recipientPetId, 'p2');
    assert.equal(link.recipientTenantId, 'TENANT_B');
    assert.equal(link.recipientRoom, 'N202');
    assert.equal(link.createdAt, SERVER_TS);
    assert.deepEqual(rateLimitCalls[0], ['line:Uowner', 'requestPetLink', 20, 86400]);
  });

  it('sorts the edge id even when from > to', async () => {
    store['petProfiles/p9'] = { petId: 'p9', building: 'nest', ownerRoom: 'N101', ownerTenantId: 'TENANT_A', name: 'A' };
    store['petProfiles/p1'] = { petId: 'p1', building: 'nest', ownerRoom: 'N202', ownerTenantId: 'TENANT_B', name: 'B' };
    const r = await handler({ building: 'nest', roomId: 'N101', fromPetId: 'p9', toPetId: 'p1' }, ctx());
    assert.equal(r.linkId, 'p1_p9');
    assert.equal(store['petLinks/p1_p9'].requesterPetId, 'p9');   // requester preserved despite sort
  });

  it('re-request allowed after a previous decline (overwrites to pending)', async () => {
    seedProfiles();
    store['petLinks/p1_p2'] = { status: 'declined', petA: 'p1', petB: 'p2' };
    const r = await handler(ARGS, ctx());
    assert.equal(r.success, true);
    assert.equal(store['petLinks/p1_p2'].status, 'pending');
  });
});

describe('requestPetLink — guards', () => {
  beforeEach(reset);

  it('self-request → invalid-argument', async () => {
    await assert.rejects(() => handler({ ...ARGS, toPetId: 'p1' }, ctx()),
      (e) => e.code === 'invalid-argument');
  });

  it('from-pet not public → failed-precondition', async () => {
    store['petProfiles/p2'] = { petId: 'p2', building: 'nest', ownerRoom: 'N202', ownerTenantId: 'TENANT_B' };
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'failed-precondition');
  });

  it('to-pet not found → not-found', async () => {
    store['petProfiles/p1'] = { petId: 'p1', building: 'nest', ownerRoom: 'N101', ownerTenantId: 'TENANT_A' };
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'not-found');
  });

  it('from-pet not owned by caller (room mismatch) → permission-denied', async () => {
    seedProfiles();
    store['petProfiles/p1'].ownerRoom = 'N999';   // not the caller's room
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'permission-denied');
  });

  it('cross-building to-pet → permission-denied', async () => {
    seedProfiles();
    store['petProfiles/p2'].building = 'rooms';
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'permission-denied');
  });

  it('same-room to-pet → invalid-argument (same owner; would break recipient auth)', async () => {
    seedProfiles();
    store['petProfiles/p2'].ownerRoom = 'N101';   // same room as the caller's from-pet
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'invalid-argument');
  });

  it('pending edge already exists → failed-precondition', async () => {
    seedProfiles();
    store['petLinks/p1_p2'] = { status: 'pending', petA: 'p1', petB: 'p2' };
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'failed-precondition' && /ค้างอยู่/.test(e.message));
  });

  it('already friends → failed-precondition', async () => {
    seedProfiles();
    store['petLinks/p1_p2'] = { status: 'accepted', petA: 'p1', petB: 'p2' };
    await assert.rejects(() => handler(ARGS, ctx()),
      (e) => e.code === 'failed-precondition' && /เพื่อนกัน/.test(e.message));
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler(ARGS, { auth: null }), (e) => e.code === 'unauthenticated');
  });

  it('missing toPetId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101', fromPetId: 'p1' }, ctx()),
      (e) => e.code === 'invalid-argument');
  });
});
