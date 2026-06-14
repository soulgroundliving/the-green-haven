/**
 * Unit tests for cancelCaretakerRequest — the requester cancels their own
 * pet-sitting request, or an admin cancels for moderation. Covers: open→cancelled,
 * accepted→cancelled, non-requester block, admin override, terminal-state block.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let reqDocs;
function reset() { reqDocs = {}; }
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
          update: async (ref, patch) => { reqDocs[ref._key] = { ...(reqDocs[ref._key] || {}), ...patch }; },
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
  return _origLoad.call(this, id, parent, ...rest);
};

const { cancelCaretakerRequest: handler } = require('../cancelCaretakerRequest');

after(() => { Module._load = _origLoad; });

const OWNER = 'line:Uowner';
function ownerCtx(uid = OWNER) { return { auth: { uid, token: {} } }; }
function adminCtx(uid = 'admin-1') { return { auth: { uid, token: { admin: true } } }; }
function seed(id = 'r1', { status = 'open', requesterUid = OWNER } = {}) {
  reqDocs[id] = { building: 'rooms', room: '101', petName: 'ขนมปัง', status, requesterUid };
}

describe('cancelCaretakerRequest — cancel', () => {
  beforeEach(reset);

  it('the requester can cancel an open request', async () => {
    seed('r1', { status: 'open' });
    const r = await handler({ requestId: 'r1' }, ownerCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'cancelled');
    assert.equal(reqDocs.r1.cancelledBy, 'requester');
    assert.equal(reqDocs.r1.cancelledAt, SERVER_TS);
  });

  it('the requester can cancel an accepted request', async () => {
    seed('r1', { status: 'accepted' });
    await handler({ requestId: 'r1' }, ownerCtx());
    assert.equal(reqDocs.r1.status, 'cancelled');
  });

  it('an admin can cancel someone else\'s request → cancelledBy admin (moderation)', async () => {
    seed('r1', { status: 'open', requesterUid: OWNER });
    await handler({ requestId: 'r1' }, adminCtx());
    assert.equal(reqDocs.r1.status, 'cancelled');
    assert.equal(reqDocs.r1.cancelledBy, 'admin');
  });
});

describe('cancelCaretakerRequest — guards', () => {
  beforeEach(reset);

  it('a non-requester cannot cancel → permission-denied', async () => {
    seed('r1', { status: 'open', requesterUid: OWNER });
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx('line:Ustranger')),
      (e) => e.code === 'permission-denied');
    assert.equal(reqDocs.r1.status, 'open', 'unchanged');
  });

  it('cannot cancel a terminal (done) request → failed-precondition', async () => {
    seed('r1', { status: 'done' });
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx()),
      (e) => e.code === 'failed-precondition');
  });

  it('cannot cancel an already-cancelled request even as admin → failed-precondition', async () => {
    seed('r1', { status: 'cancelled' });
    await assert.rejects(() => handler({ requestId: 'r1' }, adminCtx()),
      (e) => e.code === 'failed-precondition');
  });

  it('request not found → not-found', async () => {
    await assert.rejects(() => handler({ requestId: 'ghost' }, ownerCtx()),
      (e) => e.code === 'not-found');
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing requestId → invalid-argument', async () => {
    await assert.rejects(() => handler({}, ownerCtx()), (e) => e.code === 'invalid-argument');
  });
});
