/**
 * Unit tests for offerCommunityRequest — a tenant offers the item for an open
 * neighbour request. Covers: open→offered with server-set offererUid, self-offer
 * block, already-offered (single-winner) block, cross-building block, and guards.
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
        if (name === 'communityRequests') return { doc: (rid) => ({ _kind: 'req', _key: rid }) };
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

const { offerCommunityRequest: handler } = require('../offerCommunityRequest');

after(() => { Module._load = _origLoad; });

function offererCtx(room = '102', building = 'rooms', uid = 'line:Uofferer') {
  return { auth: { uid, token: { room, building } } };
}
function seedOpen(id = 'r1', { building = 'rooms', requesterUid = 'line:Urequester', room = '101' } = {}) {
  reqDocs[id] = { building, room, title: 'ขอยืมไขควง', status: 'open', requesterUid };
}

describe('offerCommunityRequest — offer', () => {
  beforeEach(reset);

  it('open → offered with offererUid from auth + offerer identity stamped', async () => {
    seedOpen('r1');
    const r = await handler({ requestId: 'r1', building: 'rooms', roomId: '102', offererName: 'สมหญิง' }, offererCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'offered');
    assert.equal(reqDocs.r1.offererUid, 'line:Uofferer');
    assert.equal(reqDocs.r1.offererBuilding, 'rooms');
    assert.equal(reqDocs.r1.offererRoom, '102');
    assert.equal(reqDocs.r1.offererTenantId, 'rooms_102');
    assert.equal(reqDocs.r1.offererName, 'สมหญิง');
    assert.equal(reqDocs.r1.offeredAt, SERVER_TS);
  });
});

describe('offerCommunityRequest — guards', () => {
  beforeEach(reset);

  it('cannot offer for your own request → failed-precondition (self-offer)', async () => {
    seedOpen('r1', { requesterUid: 'line:Uofferer' }); // requester == the caller
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, offererCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(reqDocs.r1.status, 'open', 'unchanged');
  });

  it('already offered → failed-precondition (single-winner)', async () => {
    seedOpen('r1');
    reqDocs.r1.status = 'offered';
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, offererCtx()),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('cross-building offer → permission-denied', async () => {
    seedOpen('r1', { building: 'rooms' });
    // offerer authenticates as a NEST tenant trying to offer for a ROOMS request
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'nest', roomId: 'N12' }, offererCtx('N12', 'nest')),
      (e) => e.code === 'permission-denied',
    );
  });

  it('request not found → not-found', async () => {
    await assert.rejects(
      () => handler({ requestId: 'ghost', building: 'rooms', roomId: '102' }, offererCtx()),
      (e) => e.code === 'not-found',
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing requestId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '102' }, offererCtx()),
      (e) => e.code === 'invalid-argument');
  });
});
