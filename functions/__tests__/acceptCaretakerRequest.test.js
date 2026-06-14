/**
 * Unit tests for acceptCaretakerRequest — a neighbour accepts an open pet-sitting
 * request. Covers: open→accepted with server-set caretakerUid, self-accept block,
 * already-taken (single-winner) block, cross-building block, and guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let reqDocs, lastUpdate;
function reset() { reqDocs = {}; lastUpdate = null; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'caretakerRequests') return { doc: (rid) => ({ _kind: 'req', _key: rid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ({ exists: ref._key in reqDocs, data: () => reqDocs[ref._key] }),
          update: async (ref, patch) => { lastUpdate = { key: ref._key, patch }; reqDocs[ref._key] = { ...(reqDocs[ref._key] || {}), ...patch }; },
        };
        return fn(tx);
      },
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

const { acceptCaretakerRequest: handler } = require('../acceptCaretakerRequest');

after(() => { Module._load = _origLoad; });

function caretakerCtx(room = '102', building = 'rooms', uid = 'line:Usitter') {
  return { auth: { uid, token: { room, building } } };
}
function seedOpen(id = 'r1', { building = 'rooms', requesterUid = 'line:Uowner', room = '101', petName = 'ขนมปัง' } = {}) {
  reqDocs[id] = { building, room, petName, need: 'ให้อาหาร', status: 'open', requesterUid };
}

describe('acceptCaretakerRequest — accept', () => {
  beforeEach(reset);

  it('open → accepted with caretakerUid from auth + caretaker identity stamped', async () => {
    seedOpen('r1');
    const r = await handler({ requestId: 'r1', building: 'rooms', roomId: '102', caretakerName: 'สมหญิง' }, caretakerCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'accepted');
    assert.equal(reqDocs.r1.caretakerUid, 'line:Usitter');
    assert.equal(reqDocs.r1.caretakerBuilding, 'rooms');
    assert.equal(reqDocs.r1.caretakerRoom, '102');
    assert.equal(reqDocs.r1.caretakerTenantId, 'rooms_102');
    assert.equal(reqDocs.r1.caretakerName, 'สมหญิง');
    assert.equal(reqDocs.r1.acceptedAt, SERVER_TS);
  });
});

describe('acceptCaretakerRequest — guards', () => {
  beforeEach(reset);

  it('cannot accept your own request → failed-precondition (self-accept)', async () => {
    seedOpen('r1', { requesterUid: 'line:Usitter' }); // requester == the caller
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, caretakerCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(reqDocs.r1.status, 'open', 'unchanged');
  });

  it('already accepted → failed-precondition (single-winner)', async () => {
    seedOpen('r1');
    reqDocs.r1.status = 'accepted';
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, caretakerCtx()),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('cross-building accept → permission-denied', async () => {
    seedOpen('r1', { building: 'rooms' });
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'nest', roomId: 'N12' }, caretakerCtx('N12', 'nest')),
      (e) => e.code === 'permission-denied',
    );
  });

  it('request not found → not-found', async () => {
    await assert.rejects(
      () => handler({ requestId: 'ghost', building: 'rooms', roomId: '102' }, caretakerCtx()),
      (e) => e.code === 'not-found',
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing requestId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '102' }, caretakerCtx()),
      (e) => e.code === 'invalid-argument');
  });
});
