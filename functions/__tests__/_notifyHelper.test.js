/**
 * Unit tests for _notifyHelper.js
 * Run: node --test functions/__tests__/_notifyHelper.test.js
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ─────────────────────────────────────────────────────────────────

let stubLiffDocs = [];       // { id: string }[]  — approved liffUsers docs
let stubQueryError = null;   // Error | null — throw from .get()
let fetchResponses = [];     // { ok, status?, text? }[]
let retryCalls = [];         // args passed to enqueueLineRetry

function resetStubs() {
  stubLiffDocs = [];
  stubQueryError = null;
  fetchResponses = [];
  retryCalls = [];
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────

const Module = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === './_lineRetry') {
    return { enqueueLineRetry: async (arg) => { retryCalls.push(arg); } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────

const origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (_url, _opts) => {
  const reply = fetchResponses.shift() || { ok: true, status: 200 };
  return {
    ok: reply.ok,
    status: reply.status || (reply.ok ? 200 : 500),
    text: async () => reply.text || '',
  };
};

after(() => {
  Module._load = _origLoad;
  if (origFetch === null) delete global.fetch;
  else global.fetch = origFetch;
});

// ── Load helper after stubs ───────────────────────────────────────────────────

const { lookupApprovedRoomUsers, pushAndRetry } = require('../_notifyHelper');

// ── Firestore stub factory ────────────────────────────────────────────────────

function makeFirestore({ throwError = null } = {}) {
  return {
    collection: () => ({
      where: function () { return this; },
      get: async () => {
        if (throwError) throw throwError;
        return { docs: stubLiffDocs.map(d => ({ id: d.id })) };
      },
    }),
  };
}

// ── lookupApprovedRoomUsers ───────────────────────────────────────────────────

describe('lookupApprovedRoomUsers', () => {
  beforeEach(() => resetStubs());

  it('returns docs array when query succeeds and users exist', async () => {
    stubLiffDocs = [{ id: 'UA' }, { id: 'UB' }];
    const fs = makeFirestore();
    const { docs, error } = await lookupApprovedRoomUsers(fs, 'rooms', '15');
    assert.equal(error, undefined);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].id, 'UA');
    assert.equal(docs[1].id, 'UB');
  });

  it('returns empty docs array when no approved users exist', async () => {
    stubLiffDocs = [];
    const { docs, error } = await lookupApprovedRoomUsers(makeFirestore(), 'rooms', '15');
    assert.equal(error, undefined);
    assert.deepEqual(docs, []);
  });

  it('returns { docs: null, error } when Firestore throws', async () => {
    const fs = makeFirestore({ throwError: new Error('index missing') });
    const { docs, error } = await lookupApprovedRoomUsers(fs, 'rooms', '15');
    assert.equal(docs, null);
    assert.ok(error.includes('liffUsers_query_failed'));
    assert.ok(error.includes('index missing'));
  });
});

// ── pushAndRetry ──────────────────────────────────────────────────────────────

describe('pushAndRetry', () => {
  beforeEach(() => resetStubs());

  const message = { type: 'text', text: 'hello' };
  const baseOpts = {
    message,
    token: 'test-token',
    source: 'testSource',
    context: { building: 'rooms', roomId: '15' },
    idempotencyKeyFn: (uid) => `test-${uid}`,
  };

  it('returns { pushed: 0, failed: 0 } for empty docs', async () => {
    const result = await pushAndRetry({ ...baseOpts, docs: [] });
    assert.deepEqual(result, { pushed: 0, failed: 0 });
    assert.equal(retryCalls.length, 0);
  });

  it('returns { pushed: 1, failed: 0 } on single successful push', async () => {
    fetchResponses = [{ ok: true }];
    const docs = [{ id: 'UA' }];
    const result = await pushAndRetry({ ...baseOpts, docs });
    assert.deepEqual(result, { pushed: 1, failed: 0 });
    assert.equal(retryCalls.length, 0);
  });

  it('returns { pushed: 2, failed: 0 } on two successful pushes', async () => {
    fetchResponses = [{ ok: true }, { ok: true }];
    const docs = [{ id: 'UA' }, { id: 'UB' }];
    const result = await pushAndRetry({ ...baseOpts, docs });
    assert.deepEqual(result, { pushed: 2, failed: 0 });
  });

  it('returns { pushed: 0, failed: 1 } and enqueues retry on push failure', async () => {
    fetchResponses = [{ ok: false, status: 500, text: 'Server Error' }];
    const docs = [{ id: 'UFAIL' }];
    const result = await pushAndRetry({ ...baseOpts, docs });
    assert.deepEqual(result, { pushed: 0, failed: 1 });
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].lineUserId, 'UFAIL');
    assert.equal(retryCalls[0].idempotencyKey, 'test-UFAIL');
    assert.equal(retryCalls[0].context.source, 'testSource');
    assert.equal(retryCalls[0].context.building, 'rooms');
    assert.ok(retryCalls[0].error.includes('LINE 500'));
  });

  it('counts only successes and enqueues only failures in mixed result', async () => {
    fetchResponses = [{ ok: true }, { ok: false, status: 429, text: 'Too Many Requests' }];
    const docs = [{ id: 'UPASS' }, { id: 'UFAIL' }];
    const result = await pushAndRetry({ ...baseOpts, docs });
    assert.equal(result.pushed, 1);
    assert.equal(result.failed, 1);
    assert.equal(retryCalls.length, 1);
    assert.equal(retryCalls[0].lineUserId, 'UFAIL');
  });

  it('uses idempotencyKeyFn result as the retry key', async () => {
    fetchResponses = [{ ok: false, status: 500, text: 'err' }];
    const docs = [{ id: 'UXYZ' }];
    const customKeyFn = (uid) => `custom-prefix-${uid}-suffix`;
    await pushAndRetry({ ...baseOpts, docs, idempotencyKeyFn: customKeyFn });
    assert.equal(retryCalls[0].idempotencyKey, 'custom-prefix-UXYZ-suffix');
  });
});
