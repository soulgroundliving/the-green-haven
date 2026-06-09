/**
 * Unit tests for postCommunityRequest — a tenant posts a borrow/share request.
 * Covers: server-set requesterUid (anti-spoof), open status, requestKind default
 * + validation, canonicalised building, title/category validation, auth +
 * rate-limit guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let added;          // docs passed to communityRequests.add()
let rateLimitCalls; // [uid, action, max, window]

function reset() { added = []; rateLimitCalls = []; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'communityRequests') {
          return { add: async (doc) => { added.push(doc); return { id: `req-${added.length}` }; } };
        }
        throw new Error('unexpected collection: ' + name);
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
  if (id === './_rateLimit') {
    return { checkRateLimit: async (uid, action, max, win) => { rateLimitCalls.push([uid, action, max, win]); } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { postCommunityRequest: handler } = require('../postCommunityRequest');

after(() => { Module._load = _origLoad; });

// LIFF tenant with matching room/building claims → assertTenantAccess claim fast-path.
function tenantCtx(room = '101', building = 'rooms', uid = 'line:Utenant') {
  return { auth: { uid, token: { room, building } } };
}

describe('postCommunityRequest — create', () => {
  beforeEach(reset);

  it('creates an open request with the server-set requesterUid (anti-spoof)', async () => {
    const r = await handler(
      { building: 'rooms', roomId: '101', title: '  ขอยืมไขควง  ', detail: 'คืนพรุ่งนี้', category: 'tool', requestKind: 'borrow', requesterName: 'สมชาย', requesterUid: 'line:Uattacker' },
      tenantCtx(),
    );
    assert.equal(r.success, true);
    assert.equal(r.requestId, 'req-1');
    assert.equal(added.length, 1);
    const doc = added[0];
    assert.equal(doc.requesterUid, 'line:Utenant', 'requesterUid comes from auth, not the spoofed data field');
    assert.equal(doc.status, 'open');
    assert.equal(doc.building, 'rooms');
    assert.equal(doc.room, '101');
    assert.equal(doc.title, 'ขอยืมไขควง', 'title trimmed');
    assert.equal(doc.category, 'tool');
    assert.equal(doc.requestKind, 'borrow');
    assert.equal(doc.requesterTenantId, 'rooms_101');
    assert.equal(doc.requesterName, 'สมชาย');
    assert.equal(doc.offererUid, null);
    assert.equal(rateLimitCalls.length, 1);
    assert.deepEqual(rateLimitCalls[0], ['line:Utenant', 'postCommunityRequest', 5, 86400]);
  });

  it('canonicalises building, stores the "have" kind, falls back to ห้อง-label name', async () => {
    await handler({ building: 'NEST', roomId: 'N12', title: 'ขอกล่องลัง', requestKind: 'have' }, tenantCtx('N12', 'nest'));
    assert.equal(added[0].building, 'nest');
    assert.equal(added[0].requesterName, 'ห้อง N12');
    assert.equal(added[0].category, null);
    assert.equal(added[0].detail, null);
    assert.equal(added[0].requestKind, 'have');
  });

  it('unknown/blank requestKind normalises to borrow', async () => {
    await handler({ building: 'rooms', roomId: '101', title: 'ขอบันได' }, tenantCtx());
    assert.equal(added[0].requestKind, 'borrow');
  });
});

describe('postCommunityRequest — guards', () => {
  beforeEach(reset);

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });
  it('missing building/roomId → invalid-argument', async () => {
    await assert.rejects(() => handler({ title: 'x' }, tenantCtx()), (e) => e.code === 'invalid-argument');
  });
  it('blank title → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: '   ' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('unknown building → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'amazon', roomId: '1', title: 'x' }, tenantCtx('1', 'amazon')),
      (e) => e.code === 'invalid-argument');
  });
  it('bad category → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x', category: 'nope' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('bad requestKind → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x', requestKind: 'steal' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('claim mismatch (wrong room) → permission-denied (assertTenantAccess)', async () => {
    // tenant claims room 101 but tries to post for room 999 → no claim match,
    // and the SoT read isn't stubbed here → permission-denied path.
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '999', title: 'x' }, tenantCtx('101', 'rooms')),
      (e) => e.code === 'permission-denied' || e.code === 'internal',
    );
  });
});
