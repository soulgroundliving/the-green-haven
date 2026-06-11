/**
 * Unit tests for respondPetLink — the recipient pet's owner accepts/declines a
 * pending friend request (Meaning Layer #10). Covers: accept/decline transition,
 * recipient-only authority (requester can't self-accept), single-winner, guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let store;
function reset() { store = {}; }
reset();

function docRef(path) {
  return {
    _path: path,
    async get() { return { exists: path in store, data: () => store[path], ref: docRef(path) }; },
    collection(sub) { return { doc: (id) => docRef(path + '/' + sub + '/' + id) }; },
  };
}
function collRef(prefix) { return { doc: (id) => docRef(prefix + '/' + id) }; }

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (n) => collRef(n),
      runTransaction: async (fn) => fn({
        get: async (ref) => ref.get(),
        update: (ref, patch) => { store[ref._path] = { ...(store[ref._path] || {}), ...patch }; },
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
  if (id === './_notifyHelper') {
    return { lookupApprovedRoomUsers: async () => ({ docs: [] }), pushAndRetry: async () => ({ pushed: 0, failed: 0 }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { respondPetLink: handler } = require('../respondPetLink');
after(() => { Module._load = _origLoad; });

// Caller is the RECIPIENT (room N202) by default.
function ctx(room = 'N202', building = 'nest', uid = 'line:Urecipient') {
  return { auth: { uid, token: { room, building, tenantId: 'TENANT_B' } } };
}
function seedPending() {
  store['petLinks/p1_p2'] = {
    linkId: 'p1_p2', petA: 'p1', petB: 'p2', building: 'nest', status: 'pending',
    requesterPetId: 'p1', requesterRoom: 'N101', requesterName: 'โกโก้',
    recipientPetId: 'p2', recipientRoom: 'N202', recipientName: 'มะลิ',
  };
}
const ARGS = { building: 'nest', roomId: 'N202', linkId: 'p1_p2' };

describe('respondPetLink — accept/decline', () => {
  beforeEach(reset);

  it('pending → accepted with respondedAt', async () => {
    seedPending();
    const r = await handler({ ...ARGS, accept: true }, ctx());
    assert.equal(r.success, true);
    assert.equal(r.status, 'accepted');
    assert.equal(store['petLinks/p1_p2'].status, 'accepted');
    assert.equal(store['petLinks/p1_p2'].respondedAt, SERVER_TS);
  });

  it('pending → declined when accept is falsy', async () => {
    seedPending();
    const r = await handler({ ...ARGS, accept: false }, ctx());
    assert.equal(r.status, 'declined');
    assert.equal(store['petLinks/p1_p2'].status, 'declined');
  });
});

describe('respondPetLink — guards', () => {
  beforeEach(reset);

  it('the requester cannot accept their own request → permission-denied', async () => {
    seedPending();
    // caller authenticates as room N101 = the REQUESTER, not the recipient
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', linkId: 'p1_p2', accept: true }, ctx('N101', 'nest')),
      (e) => e.code === 'permission-denied',
    );
    assert.equal(store['petLinks/p1_p2'].status, 'pending', 'unchanged');
  });

  it('cross-building responder → permission-denied', async () => {
    seedPending();
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: 'N202', linkId: 'p1_p2', accept: true }, ctx('N202', 'rooms')),
      (e) => e.code === 'permission-denied',
    );
  });

  it('already answered (not pending) → failed-precondition (single-winner)', async () => {
    seedPending();
    store['petLinks/p1_p2'].status = 'accepted';
    await assert.rejects(() => handler({ ...ARGS, accept: true }, ctx()),
      (e) => e.code === 'failed-precondition');
  });

  it('edge not found → not-found', async () => {
    await assert.rejects(() => handler({ ...ARGS, accept: true }, ctx()),
      (e) => e.code === 'not-found');
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ ...ARGS, accept: true }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing linkId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N202', accept: true }, ctx()),
      (e) => e.code === 'invalid-argument');
  });
});
