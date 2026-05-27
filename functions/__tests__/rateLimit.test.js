'use strict';
/**
 * Unit tests for _rateLimit.js — Firestore-backed sliding-window rate limiter.
 *
 * Uses Module._load interception because firebase-admin and firebase-functions/v1
 * are not installed in this worktree.
 *
 * Run: node --test functions/__tests__/rateLimit.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ───────────────────────────────────────────────────────────────
let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    existingDoc: null, // null = doc does not exist; object = existing doc data
    ...overrides,
  };
  captured = {
    txSet: null,    // { path, data } — recorded on tx.set()
    txUpdate: null, // { path, data } — recorded on tx.update()
  };
}
resetStubs();

// ── firebase-admin stub ──────────────────────────────────────────────────────
// firestore() is called at module load (singleton pattern in _rateLimit.js).
// The stub closes over `stubState` and `captured` so individual tests can
// mutate those variables AFTER the require() below has already run.

function makeRef(path) {
  return { path };
}

const firestoreInstance = {
  collection: (c) => ({
    doc: (d) => makeRef(`${c}/${d}`),
  }),
  runTransaction: async (fn) => {
    const tx = {
      get: async (_ref) => {
        const data = stubState.existingDoc;
        return {
          exists: data !== null,
          data: () => (data ? { ...data } : {}),
        };
      },
      set: (ref, data) => {
        captured.txSet = { path: ref.path, data: { ...data } };
      },
      update: (ref, data) => {
        captured.txUpdate = { path: ref.path, data: { ...data } };
      },
    };
    return fn(tx);
  },
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => firestoreInstance,
};
adminStub.firestore.FieldValue = {
  increment: (n) => ({ _type: 'FieldValue.increment', n }),
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  delete: () => ({ _type: 'FieldValue.delete' }),
};

// ── firebase-functions/v1 stub ───────────────────────────────────────────────
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return { https: { HttpsError } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { checkRateLimit } = require('../_rateLimit');

// ── Tests ────────────────────────────────────────────────────────────────────
describe('checkRateLimit', () => {
  beforeEach(() => resetStubs());

  it('no prior record — calls tx.set with count:1 and metadata', async () => {
    // existingDoc: null → snap.exists is false → tx.set branch
    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.ok(captured.txSet, 'tx.set should have been called');
    const { path, data } = captured.txSet;
    assert.equal(path, 'rateLimits/uid1_myAction');
    assert.equal(data.count, 1);
    assert.equal(data.action, 'myAction');
    assert.equal(data.uid, 'uid1');
    assert.equal(typeof data.windowStart, 'number');
  });

  it('no prior record — tx.update is not called', async () => {
    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.equal(captured.txUpdate, null, 'tx.update must not be called for a new doc');
  });

  it('window expired — resets count to 1 via tx.update', async () => {
    // windowStart is 100 seconds ago; windowSeconds=60 → window expired
    resetStubs({
      existingDoc: { count: 99, windowStart: Date.now() - 100_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 60);

    assert.ok(captured.txUpdate, 'tx.update should have been called');
    const { data } = captured.txUpdate;
    assert.equal(data.count, 1, 'count must reset to 1 on window expiry');
    assert.equal(typeof data.windowStart, 'number', 'windowStart must be refreshed');
  });

  it('window expired — tx.set is not called', async () => {
    resetStubs({
      existingDoc: { count: 99, windowStart: Date.now() - 100_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 60);

    assert.equal(captured.txSet, null, 'tx.set must not be called when resetting an existing doc');
  });

  it('at limit — throws HttpsError with code resource-exhausted', async () => {
    resetStubs({
      existingDoc: { count: 3, windowStart: Date.now() - 1_000 },
    });

    await checkRateLimit('uid1', 'myAction', 3, 3600)
      .then(() => assert.fail('Expected HttpsError to be thrown'))
      .catch((e) => {
        assert.equal(e.code, 'resource-exhausted');
      });
  });

  it('at limit — error message mentions maxCalls and window hours', async () => {
    resetStubs({
      existingDoc: { count: 5, windowStart: Date.now() - 1_000 },
    });

    await checkRateLimit('uid1', 'testAction', 5, 7200)
      .then(() => assert.fail('Expected HttpsError to be thrown'))
      .catch((e) => {
        assert.match(e.message, /max 5/);
        assert.match(e.message, /2h/);
        assert.match(e.message, /Retry in/);
      });
  });

  it('below limit — increments count via tx.update with FieldValue.increment', async () => {
    resetStubs({
      existingDoc: { count: 2, windowStart: Date.now() - 1_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.ok(captured.txUpdate, 'tx.update should have been called');
    const { data } = captured.txUpdate;
    assert.deepEqual(data.count, { _type: 'FieldValue.increment', n: 1 });
  });

  it('below limit — tx.set is not called', async () => {
    resetStubs({
      existingDoc: { count: 2, windowStart: Date.now() - 1_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.equal(captured.txSet, null, 'tx.set must not be called when incrementing');
  });

  it('key format — Firestore doc path is uid_action', async () => {
    await checkRateLimit('myUid', 'myAction', 5, 3600);

    assert.ok(captured.txSet, 'tx.set should have been called');
    assert.equal(captured.txSet.path, 'rateLimits/myUid_myAction');
  });

  it('tx.set data contains all required metadata fields', async () => {
    const before = Date.now();
    await checkRateLimit('uid1', 'actionX', 10, 86400);
    const after = Date.now();

    const { data } = captured.txSet;
    assert.equal(data.count, 1);
    assert.equal(data.action, 'actionX');
    assert.equal(data.uid, 'uid1');
    assert.ok(data.windowStart >= before, 'windowStart must be >= time before call');
    assert.ok(data.windowStart <= after, 'windowStart must be <= time after call');
  });

  it('window exactly at boundary — expired by 1 ms → resets, not increments', async () => {
    // 3601 seconds ago is strictly greater than the 3600s window → expired
    resetStubs({
      existingDoc: { count: 1, windowStart: Date.now() - 3_601_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.ok(captured.txUpdate, 'tx.update should have been called');
    assert.equal(captured.txUpdate.data.count, 1, 'should reset to 1, not increment');
    assert.equal(captured.txSet, null, 'tx.set must not be called');
  });

  it('window still open by 1 ms — increments, does not reset', async () => {
    // 3599 seconds ago is strictly less than the 3600s window → still active
    resetStubs({
      existingDoc: { count: 1, windowStart: Date.now() - 3_599_000 },
    });

    await checkRateLimit('uid1', 'myAction', 5, 3600);

    assert.ok(captured.txUpdate, 'tx.update should have been called');
    assert.deepEqual(
      captured.txUpdate.data.count,
      { _type: 'FieldValue.increment', n: 1 },
      'should increment, not reset',
    );
  });

  it('count exactly one below limit — increments without throwing', async () => {
    resetStubs({
      existingDoc: { count: 4, windowStart: Date.now() - 1_000 },
    });

    // maxCalls=5, count=4 → should not throw
    await assert.doesNotReject(() => checkRateLimit('uid1', 'myAction', 5, 3600));
    assert.deepEqual(
      captured.txUpdate.data.count,
      { _type: 'FieldValue.increment', n: 1 },
    );
  });

  it('different uid+action pair — Firestore path reflects both', async () => {
    await checkRateLimit('userABC', 'publishAnnouncement', 3, 3600);

    assert.equal(captured.txSet.path, 'rateLimits/userABC_publishAnnouncement');
  });
});
