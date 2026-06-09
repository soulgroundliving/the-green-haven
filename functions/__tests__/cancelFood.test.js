/**
 * Unit tests for cancelFood — sharer (or admin, for moderation) takes down an
 * AVAILABLE food share. Covers: sharer cancel, admin cancel, non-sharer block,
 * terminal-state block, guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let shareDocs;
function reset() { shareDocs = {}; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'foodShares') return { doc: (sid) => ({ _kind: 'share', _key: sid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ({ exists: ref._key in shareDocs, data: () => shareDocs[ref._key] }),
          update: async (ref, patch) => { shareDocs[ref._key] = { ...(shareDocs[ref._key] || {}), ...patch }; },
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

const { cancelFood: handler } = require('../cancelFood');

after(() => { Module._load = _origLoad; });

const SHARER = 'line:Usharer';
const sharerCtx = () => ({ auth: { uid: SHARER, token: {} } });
const adminCtx = () => ({ auth: { uid: 'admin-1', token: { admin: true } } });
const otherCtx = () => ({ auth: { uid: 'line:Uother', token: {} } });
function seed(id = 's1', status = 'available') { shareDocs[id] = { status, sharerUid: SHARER, building: 'rooms', room: '101' }; }

describe('cancelFood', () => {
  beforeEach(reset);

  it('sharer cancels an available share', async () => {
    seed('s1', 'available');
    const r = await handler({ shareId: 's1' }, sharerCtx());
    assert.equal(r.success, true);
    assert.equal(shareDocs.s1.status, 'cancelled');
    assert.equal(shareDocs.s1.cancelledBy, 'sharer');
  });

  it('admin cancels someone else\'s share (moderation) → cancelledBy admin', async () => {
    seed('s1', 'available');
    await handler({ shareId: 's1' }, adminCtx());
    assert.equal(shareDocs.s1.status, 'cancelled');
    assert.equal(shareDocs.s1.cancelledBy, 'admin');
  });

  it('a non-sharer non-admin cannot cancel → permission-denied', async () => {
    seed('s1', 'available');
    await assert.rejects(() => handler({ shareId: 's1' }, otherCtx()), (e) => e.code === 'permission-denied');
    assert.equal(shareDocs.s1.status, 'available');
  });

  it('cannot cancel a claimed or cancelled (terminal) share → failed-precondition', async () => {
    seed('s1', 'claimed');
    await assert.rejects(() => handler({ shareId: 's1' }, sharerCtx()), (e) => e.code === 'failed-precondition');
    seed('s2', 'cancelled');
    await assert.rejects(() => handler({ shareId: 's2' }, adminCtx()), (e) => e.code === 'failed-precondition');
  });

  it('share not found → not-found', async () => {
    await assert.rejects(() => handler({ shareId: 'ghost' }, sharerCtx()), (e) => e.code === 'not-found');
  });
  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ shareId: 's1' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing shareId → invalid-argument', async () => {
    await assert.rejects(() => handler({}, sharerCtx()), (e) => e.code === 'invalid-argument');
  });
});
