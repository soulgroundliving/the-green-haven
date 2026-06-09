/**
 * Unit tests for shareFood — a tenant posts leftover food. Covers: server-set
 * sharerUid (anti-spoof), available status, server-computed future expiresAt,
 * portions/category, auth + rate-limit guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let added, rateLimitCalls;

function reset() { added = []; rateLimitCalls = []; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'foodShares') {
          return { add: async (doc) => { added.push(doc); return { id: `share-${added.length}` }; } };
        }
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    firestoreFn.Timestamp = { fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }) };
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

const { shareFood: handler } = require('../shareFood');

after(() => { Module._load = _origLoad; });

function tenantCtx(room = '101', building = 'rooms', uid = 'line:Utenant') {
  return { auth: { uid, token: { room, building } } };
}

describe('shareFood — create', () => {
  beforeEach(reset);

  it('creates an available share with the server-set sharerUid + a future expiresAt', async () => {
    const r = await handler(
      { building: 'rooms', roomId: '101', title: '  ข้าวกล่อง 2 กล่อง  ', detail: 'มารับได้เลย', category: 'meal', portions: 2, expiresInHours: 6, sharerName: 'สมชาย', sharerUid: 'line:Uattacker' },
      tenantCtx(),
    );
    assert.equal(r.success, true);
    assert.equal(r.shareId, 'share-1');
    assert.ok(r.expiresAt > Date.now(), 'expiresAt is in the future');
    const doc = added[0];
    assert.equal(doc.sharerUid, 'line:Utenant', 'sharerUid from auth, not the spoofed field');
    assert.equal(doc.status, 'available');
    assert.equal(doc.title, 'ข้าวกล่อง 2 กล่อง', 'trimmed');
    assert.equal(doc.category, 'meal');
    assert.equal(doc.portions, 2);
    assert.equal(doc.sharerTenantId, 'rooms_101');
    assert.equal(doc.sharerName, 'สมชาย');
    assert.equal(doc.claimerUid, null);
    assert.ok(doc.expiresAt && typeof doc.expiresAt.toMillis === 'function', 'expiresAt is a Timestamp');
    assert.deepEqual(rateLimitCalls[0], ['line:Utenant', 'shareFood', 5, 86400]);
  });

  it('defaults: no category/portions, canonical building, fallback name, 24h expiry', async () => {
    await handler({ building: 'NEST', roomId: 'N12', title: 'ผลไม้รวม' }, tenantCtx('N12', 'nest'));
    assert.equal(added[0].building, 'nest');
    assert.equal(added[0].sharerName, 'ห้อง N12');
    assert.equal(added[0].category, null);
    assert.equal(added[0].portions, null);
    const ms = added[0].expiresAt.toMillis();
    assert.ok(ms > Date.now() + 23 * 3600 * 1000 && ms < Date.now() + 25 * 3600 * 1000, '~24h default expiry');
  });
});

describe('shareFood — guards', () => {
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
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', title: 'x', category: 'tool' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('claim mismatch (wrong room) → permission-denied', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '999', title: 'x' }, tenantCtx('101', 'rooms')),
      (e) => e.code === 'permission-denied' || e.code === 'internal',
    );
  });
});
