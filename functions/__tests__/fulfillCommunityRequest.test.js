/**
 * Unit tests for fulfillCommunityRequest — the requester confirms they received
 * the item. Covers: offered→fulfilled with the thank-you note, NO points moved,
 * requester-only authority, not-offered / terminal blocks, and guards.
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
  if (id === './_notifyHelper') {
    return { lookupApprovedRoomUsers: async () => ({ docs: [] }), pushAndRetry: async () => ({ pushed: 0, failed: 0 }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { fulfillCommunityRequest: handler } = require('../fulfillCommunityRequest');

after(() => { Module._load = _origLoad; });

const REQUESTER = 'line:Urequester';
const requesterCtx = () => ({ auth: { uid: REQUESTER, token: {} } });
const offererCtx = () => ({ auth: { uid: 'line:Uofferer', token: {} } });
function seedOffered(id = 'r1') {
  reqDocs[id] = {
    status: 'offered', requesterUid: REQUESTER, building: 'rooms', room: '101',
    title: 'ขอยืมไขควง', offererUid: 'line:Uofferer', offererBuilding: 'rooms', offererRoom: '102',
  };
}

describe('fulfillCommunityRequest — confirm received', () => {
  beforeEach(reset);

  it('offered → fulfilled with the thank-you note stored (no points move)', async () => {
    seedOffered('r1');
    const r = await handler({ requestId: 'r1', thankNote: '  ขอบคุณมากครับ  ' }, requesterCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'fulfilled');
    assert.equal(reqDocs.r1.thankNote, 'ขอบคุณมากครับ', 'note trimmed');
    assert.equal(reqDocs.r1.fulfilledAt, SERVER_TS);
    // The board never awards points — no gamification/ledger field is ever written.
    assert.equal('helperPointsAwarded' in reqDocs.r1, false);
  });

  it('an empty note stores null', async () => {
    seedOffered('r1');
    await handler({ requestId: 'r1' }, requesterCtx());
    assert.equal(reqDocs.r1.thankNote, null);
    assert.equal(reqDocs.r1.status, 'fulfilled');
  });
});

describe('fulfillCommunityRequest — guards', () => {
  beforeEach(reset);

  it('a non-requester (even the offerer) cannot fulfil → permission-denied', async () => {
    seedOffered('r1');
    await assert.rejects(() => handler({ requestId: 'r1' }, offererCtx()), (e) => e.code === 'permission-denied');
    assert.equal(reqDocs.r1.status, 'offered', 'unchanged');
  });

  it('cannot fulfil an open (no-offerer) request → failed-precondition', async () => {
    reqDocs.r1 = { status: 'open', requesterUid: REQUESTER, building: 'rooms', room: '101', title: 'x' };
    await assert.rejects(() => handler({ requestId: 'r1' }, requesterCtx()), (e) => e.code === 'failed-precondition');
  });

  it('cannot re-fulfil a fulfilled request → failed-precondition', async () => {
    seedOffered('r1');
    reqDocs.r1.status = 'fulfilled';
    await assert.rejects(() => handler({ requestId: 'r1' }, requesterCtx()), (e) => e.code === 'failed-precondition');
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
