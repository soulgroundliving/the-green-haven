/**
 * Unit tests for acceptHelpRequest — a tenant accepts an open neighbor request.
 * Covers: open→accepted with server-set helperUid, self-help block, already-taken
 * (single-winner) block, cross-building block, and guards.
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
        if (name === 'helpRequests') return { doc: (rid) => ({ _kind: 'req', _key: rid }) };
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

const { acceptHelpRequest: handler } = require('../acceptHelpRequest');

after(() => { Module._load = _origLoad; });

function helperCtx(room = '102', building = 'rooms', uid = 'line:Uhelper') {
  return { auth: { uid, token: { room, building } } };
}
function seedOpen(id = 'r1', { building = 'rooms', requesterUid = 'line:Urequester', room = '101' } = {}) {
  reqDocs[id] = { building, room, title: 'ช่วยยกของ', status: 'open', requesterUid };
}

describe('acceptHelpRequest — accept', () => {
  beforeEach(reset);

  it('open → accepted with helperUid from auth + helper identity stamped', async () => {
    seedOpen('r1');
    const r = await handler({ requestId: 'r1', building: 'rooms', roomId: '102', helperName: 'สมหญิง' }, helperCtx());
    assert.equal(r.success, true);
    assert.equal(reqDocs.r1.status, 'accepted');
    assert.equal(reqDocs.r1.helperUid, 'line:Uhelper');
    assert.equal(reqDocs.r1.helperBuilding, 'rooms');
    assert.equal(reqDocs.r1.helperRoom, '102');
    assert.equal(reqDocs.r1.helperTenantId, 'rooms_102');
    assert.equal(reqDocs.r1.helperName, 'สมหญิง');
    assert.equal(reqDocs.r1.acceptedAt, SERVER_TS);
  });
});

describe('acceptHelpRequest — guards', () => {
  beforeEach(reset);

  it('cannot accept your own request → failed-precondition (self-help)', async () => {
    seedOpen('r1', { requesterUid: 'line:Uhelper' }); // requester == the caller
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, helperCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(reqDocs.r1.status, 'open', 'unchanged');
  });

  it('already accepted → failed-precondition (single-winner)', async () => {
    seedOpen('r1');
    reqDocs.r1.status = 'accepted';
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, helperCtx()),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('cross-building accept → permission-denied', async () => {
    seedOpen('r1', { building: 'rooms' });
    // helper authenticates as a NEST tenant trying to accept a ROOMS request
    await assert.rejects(
      () => handler({ requestId: 'r1', building: 'nest', roomId: 'N12' }, helperCtx('N12', 'nest')),
      (e) => e.code === 'permission-denied',
    );
  });

  it('request not found → not-found', async () => {
    await assert.rejects(
      () => handler({ requestId: 'ghost', building: 'rooms', roomId: '102' }, helperCtx()),
      (e) => e.code === 'not-found',
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1', building: 'rooms', roomId: '102' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });

  it('missing requestId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '102' }, helperCtx()),
      (e) => e.code === 'invalid-argument');
  });
});
