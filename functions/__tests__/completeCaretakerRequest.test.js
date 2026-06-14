/**
 * Unit tests for completeCaretakerRequest — the OWNER (requester) confirms the
 * care is done (§6 peer-confirmed; the caretaker can never self-mark). Covers:
 * accepted→done by the requester, non-requester block, wrong-state block, guards.
 * D2 point-free: no gamification/ledger write on completion.
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
  if (id === './_notifyHelper') {
    return { lookupApprovedRoomUsers: async () => ({ docs: [] }), pushAndRetry: async () => ({ pushed: 0, failed: 0 }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { completeCaretakerRequest: handler } = require('../completeCaretakerRequest');

after(() => { Module._load = _origLoad; });

const OWNER = 'line:Uowner';
const SITTER = 'line:Usitter';
function ownerCtx(uid = OWNER) { return { auth: { uid, token: {} } }; }
function seedAccepted(id = 'r1', { requesterUid = OWNER } = {}) {
  reqDocs[id] = {
    building: 'rooms', room: '101', petName: 'ขนมปัง', status: 'accepted',
    requesterUid, caretakerUid: SITTER, caretakerBuilding: 'rooms', caretakerRoom: '102',
  };
}

describe('completeCaretakerRequest — complete (owner confirms)', () => {
  beforeEach(reset);

  it('accepted → done when the requester confirms', async () => {
    seedAccepted('r1');
    const r = await handler({ requestId: 'r1' }, ownerCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'done');
    assert.equal(reqDocs.r1.completedAt, SERVER_TS);
  });

  it('D2 point-free: no points/ledger field written on the doc', async () => {
    seedAccepted('r1');
    await handler({ requestId: 'r1' }, ownerCtx());
    assert.equal('helperPointsAwarded' in reqDocs.r1, false);
    assert.equal('caretakerPointsAwarded' in reqDocs.r1, false);
  });
});

describe('completeCaretakerRequest — guards', () => {
  beforeEach(reset);

  it('the caretaker CANNOT complete (only the owner) → permission-denied (§6)', async () => {
    seedAccepted('r1');
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx(SITTER)),
      (e) => e.code === 'permission-denied');
    assert.equal(reqDocs.r1.status, 'accepted', 'unchanged');
  });

  it('an unrelated tenant cannot complete → permission-denied', async () => {
    seedAccepted('r1');
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx('line:Ustranger')),
      (e) => e.code === 'permission-denied');
  });

  it('not-accepted (still open) → failed-precondition', async () => {
    seedAccepted('r1');
    reqDocs.r1.status = 'open';
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx()),
      (e) => e.code === 'failed-precondition');
  });

  it('already done → failed-precondition (no double-complete)', async () => {
    seedAccepted('r1');
    reqDocs.r1.status = 'done';
    await assert.rejects(() => handler({ requestId: 'r1' }, ownerCtx()),
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
