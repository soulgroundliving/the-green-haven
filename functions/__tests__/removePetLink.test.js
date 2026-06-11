/**
 * Unit tests for removePetLink — either party deletes a friend edge (Meaning
 * Layer #10). Covers: either-party removal, non-party + cross-building blocks,
 * not-found, guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let store;
function reset() { store = {}; }
reset();

function docRef(path) {
  return {
    _path: path,
    async get() { return { exists: path in store, data: () => store[path], ref: docRef(path) }; },
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
        delete: (ref) => { delete store[ref._path]; },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__TS__' };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { removePetLink: handler } = require('../removePetLink');
after(() => { Module._load = _origLoad; });

function ctx(room, building = 'nest', uid = 'line:Uowner') {
  return { auth: { uid, token: { room, building, tenantId: 'T' } } };
}
function seed() {
  store['petLinks/p1_p2'] = {
    linkId: 'p1_p2', petA: 'p1', petB: 'p2', building: 'nest', status: 'accepted',
    requesterRoom: 'N101', recipientRoom: 'N202',
  };
}

describe('removePetLink', () => {
  beforeEach(reset);

  it('the requester room may remove the edge', async () => {
    seed();
    const r = await handler({ building: 'nest', roomId: 'N101', linkId: 'p1_p2' }, ctx('N101'));
    assert.equal(r.success, true);
    assert.ok(!store['petLinks/p1_p2']);
  });

  it('the recipient room may remove the edge', async () => {
    seed();
    const r = await handler({ building: 'nest', roomId: 'N202', linkId: 'p1_p2' }, ctx('N202'));
    assert.equal(r.success, true);
    assert.ok(!store['petLinks/p1_p2']);
  });

  it('a non-party room cannot remove → permission-denied', async () => {
    seed();
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N303', linkId: 'p1_p2' }, ctx('N303')),
      (e) => e.code === 'permission-denied',
    );
    assert.ok(store['petLinks/p1_p2'], 'unchanged');
  });

  it('cross-building removal → permission-denied', async () => {
    seed();
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: 'N101', linkId: 'p1_p2' }, ctx('N101', 'rooms')),
      (e) => e.code === 'permission-denied',
    );
  });

  it('edge not found → not-found', async () => {
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', linkId: 'ghost' }, ctx('N101')),
      (e) => e.code === 'not-found',
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101', linkId: 'p1_p2' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing linkId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101' }, ctx('N101')),
      (e) => e.code === 'invalid-argument');
  });
});
