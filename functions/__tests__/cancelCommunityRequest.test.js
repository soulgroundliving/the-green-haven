/**
 * Unit tests for cancelCommunityRequest — requester (or admin, for moderation)
 * cancels a non-terminal request. Covers: requester cancel, admin cancel,
 * non-requester block, terminal-state block, guards.
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
        if (name === 'communityRequests') return { doc: (rid) => ({ _kind: 'req', _key: rid }) };
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

const { cancelCommunityRequest: handler } = require('../cancelCommunityRequest');

after(() => { Module._load = _origLoad; });

const REQUESTER = 'line:Urequester';
const requesterCtx = () => ({ auth: { uid: REQUESTER, token: {} } });
const adminCtx = () => ({ auth: { uid: 'admin-1', token: { admin: true } } });
const otherCtx = () => ({ auth: { uid: 'line:Uother', token: {} } });
function seed(id = 'r1', status = 'open') { reqDocs[id] = { status, requesterUid: REQUESTER, building: 'rooms', room: '101' }; }

describe('cancelCommunityRequest', () => {
  beforeEach(reset);

  it('requester cancels an open request', async () => {
    seed('r1', 'open');
    const r = await handler({ requestId: 'r1' }, requesterCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'cancelled');
    assert.equal(reqDocs.r1.cancelledBy, 'requester');
  });

  it('requester cancels an offered request', async () => {
    seed('r1', 'offered');
    await handler({ requestId: 'r1' }, requesterCtx());
    assert.equal(reqDocs.r1.status, 'cancelled');
  });

  it('admin cancels someone else\'s request (moderation) → cancelledBy admin', async () => {
    seed('r1', 'open');
    await handler({ requestId: 'r1' }, adminCtx());
    assert.equal(reqDocs.r1.status, 'cancelled');
    assert.equal(reqDocs.r1.cancelledBy, 'admin');
  });

  it('a non-requester non-admin cannot cancel → permission-denied', async () => {
    seed('r1', 'open');
    await assert.rejects(() => handler({ requestId: 'r1' }, otherCtx()), (e) => e.code === 'permission-denied');
    assert.equal(reqDocs.r1.status, 'open');
  });

  it('cannot cancel a terminal request → failed-precondition', async () => {
    seed('r1', 'fulfilled');
    await assert.rejects(() => handler({ requestId: 'r1' }, requesterCtx()), (e) => e.code === 'failed-precondition');
    seed('r2', 'cancelled');
    await assert.rejects(() => handler({ requestId: 'r2' }, adminCtx()), (e) => e.code === 'failed-precondition');
  });

  it('request not found → not-found', async () => {
    await assert.rejects(() => handler({ requestId: 'ghost' }, requesterCtx()), (e) => e.code === 'not-found');
  });
  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing requestId → invalid-argument', async () => {
    await assert.rejects(() => handler({}, requesterCtx()), (e) => e.code === 'invalid-argument');
  });
});
