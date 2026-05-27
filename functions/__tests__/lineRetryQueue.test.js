/**
 * Unit tests for lineRetryQueue.js — processLineRetryQueue scheduled CF.
 *
 * Tests exercise the captured pubsub onRun handler directly.
 * All Firestore and global fetch calls are stubbed via Module._load
 * interception installed BEFORE the module is required.
 *
 * Run: node --test functions/__tests__/lineRetryQueue.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

/**
 * Each doc descriptor: { id, data: { lineUserId, message, attempts?, status?,
 *   nextAttemptAt?, context? }, _updateCalls? }
 */
function resetStubs(overrides = {}) {
  stubState = {
    token: 'line-test-token',
    docs: [],           // Firestore docs returned by the query
    fetchOk: true,      // whether fetch returns r.ok = true
    fetchStatus: 200,   // HTTP status when fetchOk is false
    fetchBody: 'OK',    // response body text
    ...overrides,
  };
  captured = {
    fetchCalls: [],     // [{ url, opts }]
    updateCalls: {},    // docId → last data passed to doc.ref.update()
  };
  if (stubState.token) {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = stubState.token;
  } else {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  }
}
resetStubs();

// ── Doc helper ────────────────────────────────────────────────────────────────

function makeDoc(id, data = {}) {
  return {
    id,
    data: () => ({
      lineUserId: 'U_default',
      message:    { type: 'text', text: 'hello' },
      attempts:   0,
      status:     'pending',
      ...data,
    }),
    ref: {
      update: async (updates) => {
        captured.updateCalls[id] = updates;
      },
    },
  };
}

// ── Firestore stub ────────────────────────────────────────────────────────────

const firestoreInstance = {
  collection: (_name) => {
    // Build the full query chain:
    // .where(...).where(...).orderBy(...).limit(...).get()
    // All intermediate methods return the same chainable object.
    const chain = {
      where:   () => chain,
      orderBy: () => chain,
      limit:   () => chain,
      get: async () => {
        const docs = stubState.docs;
        return {
          docs,
          size:  docs.length,
          empty: docs.length === 0,
        };
      },
    };
    return chain;
  },
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => firestoreInstance,
};

// ── Module._load interception ─────────────────────────────────────────────────

let capturedHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    return adminStub;
  }

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    const onRun = (h) => { capturedHandler = h; return {}; };
    const chainEnd   = { onRun };
    const schedChain = { timeZone: () => chainEnd };
    const pubsubObj  = { schedule: () => schedChain };
    const runWithResult = {
      pubsub: pubsubObj,
      https:  { HttpsError, onRequest: (h) => h },
    };
    return {
      region:  () => ({ runWith: () => runWithResult }),
      https:   { HttpsError, onRequest: (h) => h },
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────

const origFetch = global.fetch;

// ── Require CF after stubs are wired ─────────────────────────────────────────

before(() => {
  global.fetch = (...args) => {
    captured.fetchCalls.push({ url: args[0], opts: args[1] });
    const { fetchOk, fetchStatus, fetchBody } = stubState;
    return Promise.resolve({
      ok:     fetchOk,
      status: fetchStatus,
      text:   async () => fetchBody,
    });
  };

  delete require.cache[require.resolve('../lineRetryQueue.js')];
  require('../lineRetryQueue.js');
});

after(() => {
  Module._load = _origLoad;
  if (typeof origFetch === 'function') {
    global.fetch = origFetch;
  } else {
    delete global.fetch;
  }
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

// ── Convenience runner ────────────────────────────────────────────────────────

async function run() {
  return capturedHandler();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processLineRetryQueue', () => {
  beforeEach(() => resetStubs());

  // ──────────────────────────────────────────────────────────────────────────
  describe('early exits', () => {
    // Test 1
    it('returns null and makes no Firestore calls when LINE_CHANNEL_ACCESS_TOKEN is not set', async () => {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const result = await run();
      assert.equal(result, null, 'must return null when token is missing');
      assert.equal(captured.fetchCalls.length, 0, 'fetch must not be called');
    });

    // Test 2
    it('returns null when LINE_CHANNEL_ACCESS_TOKEN is an empty string', async () => {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
      const result = await run();
      assert.equal(result, null);
    });

    // Test 3
    it('returns { processed:0, recovered:0, failed:0, abandoned:0 } when snap is empty', async () => {
      stubState.docs = [];
      const result = await run();
      assert.deepEqual(result, { processed: 0, recovered: 0, failed: 0, abandoned: 0 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('successful delivery', () => {
    // Test 4
    it('increments recovered and calls doc.ref.update with status:sent for a single successful doc', async () => {
      stubState.docs = [makeDoc('doc1')];
      const result = await run();
      assert.equal(result.recovered, 1, 'recovered must be 1');
      assert.equal(result.failed,    0);
      assert.equal(result.abandoned, 0);
      assert.equal(captured.updateCalls['doc1'].status, 'sent');
      assert.ok(
        typeof captured.updateCalls['doc1'].sentAt === 'string',
        'sentAt must be an ISO string'
      );
      assert.equal(captured.updateCalls['doc1'].attempts, 1);
    });

    // Test 5
    it('sets attempts to (item.attempts + 1) on successful delivery', async () => {
      stubState.docs = [makeDoc('doc_attempts', { attempts: 3 })];
      const result = await run();
      assert.equal(result.recovered, 1);
      assert.equal(captured.updateCalls['doc_attempts'].attempts, 4);
    });

    // Test 6
    it('recovers all docs when multiple docs all succeed', async () => {
      stubState.docs = [makeDoc('d1'), makeDoc('d2'), makeDoc('d3')];
      const result = await run();
      assert.equal(result.recovered, 3);
      assert.equal(result.processed, 3);
      assert.equal(result.failed,    0);
      assert.equal(result.abandoned, 0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('permanent HTTP failures (400 / 403)', () => {
    // Test 7
    it('abandons the doc immediately when LINE returns HTTP 400', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 400;
      stubState.fetchBody   = 'invalid user id';
      stubState.docs        = [makeDoc('doc400')];
      const result = await run();
      assert.equal(result.abandoned, 1);
      assert.equal(result.recovered, 0);
      assert.equal(result.failed,    0);
      assert.equal(captured.updateCalls['doc400'].status, 'abandoned');
      assert.ok(
        captured.updateCalls['doc400'].lastError.includes('400'),
        'lastError must include the HTTP status code'
      );
    });

    // Test 8
    it('abandons the doc immediately when LINE returns HTTP 403', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 403;
      stubState.fetchBody   = 'blocked';
      stubState.docs        = [makeDoc('doc403')];
      const result = await run();
      assert.equal(result.abandoned, 1);
      assert.equal(captured.updateCalls['doc403'].status, 'abandoned');
    });

    // Test 9
    it('writes attempts = newAttempts (not item.attempts) on permanent failure', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 400;
      stubState.docs        = [makeDoc('doc_perm', { attempts: 2 })];
      await run();
      assert.equal(captured.updateCalls['doc_perm'].attempts, 3, 'attempts must be incremented');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('transient HTTP failures — backoff and max-attempts', () => {
    // Test 10
    it('increments failed and applies backoff when status=500 and attempts < MAX_ATTEMPTS', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      stubState.fetchBody   = 'Server error';
      // attempts=0 → newAttempts=1, backoffMs = 300000 * 2^0 = 300000ms
      stubState.docs        = [makeDoc('doc500', { attempts: 0 })];
      const result = await run();
      assert.equal(result.failed,    1);
      assert.equal(result.abandoned, 0);
      assert.equal(captured.updateCalls['doc500'].attempts, 1);
      assert.ok(
        typeof captured.updateCalls['doc500'].nextAttemptAt === 'string',
        'nextAttemptAt must be set on transient failure'
      );
      assert.ok(
        captured.updateCalls['doc500'].lastError.includes('500'),
        'lastError must include status code'
      );
      // status must NOT be 'abandoned' or 'sent'
      assert.equal(captured.updateCalls['doc500'].status, undefined,
        'status field must not be explicitly set when retrying');
    });

    // Test 11
    it('applies backoff formula: BACKOFF_BASE_MS * 2^(newAttempts-1) for attempt 1 (expect 300000ms)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      stubState.docs        = [makeDoc('doc_backoff1', { attempts: 0 })];
      const before = Date.now();
      await run();
      const after  = Date.now();
      const nextAt = new Date(captured.updateCalls['doc_backoff1'].nextAttemptAt).getTime();
      const expectedBackoff = 5 * 60 * 1000; // 300000ms
      // nextAt should be approximately before + expectedBackoff
      assert.ok(
        nextAt >= before + expectedBackoff - 200 &&
        nextAt <= after  + expectedBackoff + 200,
        `nextAttemptAt must be ~${expectedBackoff}ms from now, got offset ${nextAt - before}ms`
      );
    });

    // Test 12
    it('applies backoff formula: 10 minutes for attempt 2 (2^1 * 5min)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      // attempts=1 → newAttempts=2, backoffMs = 300000 * 2^1 = 600000ms
      stubState.docs        = [makeDoc('doc_backoff2', { attempts: 1 })];
      const before = Date.now();
      await run();
      const after  = Date.now();
      const nextAt = new Date(captured.updateCalls['doc_backoff2'].nextAttemptAt).getTime();
      const expectedBackoff = 10 * 60 * 1000; // 600000ms
      assert.ok(
        nextAt >= before + expectedBackoff - 200 &&
        nextAt <= after  + expectedBackoff + 200,
        `nextAttemptAt must be ~${expectedBackoff}ms from now, got offset ${nextAt - before}ms`
      );
    });

    // Test 13
    it('abandons the doc when status=500 and newAttempts reaches MAX_ATTEMPTS (5)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      // attempts=4 → newAttempts=5 = MAX_ATTEMPTS
      stubState.docs        = [makeDoc('doc_maxed', { attempts: 4 })];
      const result = await run();
      assert.equal(result.abandoned, 1);
      assert.equal(result.failed,    0);
      assert.equal(captured.updateCalls['doc_maxed'].status, 'abandoned');
      assert.equal(captured.updateCalls['doc_maxed'].attempts, 5);
    });

    // Test 14
    it('still retries (failed++) when newAttempts=4 (one below MAX_ATTEMPTS)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      // attempts=3 → newAttempts=4 < MAX_ATTEMPTS(5)
      stubState.docs        = [makeDoc('doc_below_max', { attempts: 3 })];
      const result = await run();
      assert.equal(result.failed,    1);
      assert.equal(result.abandoned, 0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('network errors (fetch throws)', () => {
    // Test 15
    it('increments failed and applies backoff when fetch throws a network error and attempts < MAX_ATTEMPTS', async () => {
      // Override global.fetch to throw for this test
      const savedFetch = global.fetch;
      global.fetch = async (_url, _opts) => {
        captured.fetchCalls.push({ url: _url, opts: _opts });
        throw new Error('network timeout');
      };
      stubState.docs = [makeDoc('doc_neterr', { attempts: 0 })];
      const result = await run();
      global.fetch = savedFetch;

      assert.equal(result.failed,    1);
      assert.equal(result.abandoned, 0);
      assert.ok(
        captured.updateCalls['doc_neterr'].lastError.includes('network timeout'),
        'lastError must contain the thrown message'
      );
      assert.ok(
        typeof captured.updateCalls['doc_neterr'].nextAttemptAt === 'string',
        'nextAttemptAt must be set'
      );
    });

    // Test 16
    it('abandons the doc when fetch throws and newAttempts reaches MAX_ATTEMPTS', async () => {
      const savedFetch = global.fetch;
      global.fetch = async () => { throw new Error('connection refused'); };
      // attempts=4 → newAttempts=5 = MAX_ATTEMPTS
      stubState.docs = [makeDoc('doc_neterr_max', { attempts: 4 })];
      const result = await run();
      global.fetch = savedFetch;

      assert.equal(result.abandoned, 1);
      assert.equal(result.failed,    0);
      assert.equal(captured.updateCalls['doc_neterr_max'].status, 'abandoned');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('fetch request shape', () => {
    // Test 17
    it('calls the LINE push endpoint with the correct URL', async () => {
      stubState.docs = [makeDoc('doc_url')];
      await run();
      assert.equal(captured.fetchCalls.length, 1);
      assert.equal(
        captured.fetchCalls[0].url,
        'https://api.line.me/v2/bot/message/push'
      );
    });

    // Test 18
    it('uses POST method in the fetch call', async () => {
      stubState.docs = [makeDoc('doc_method')];
      await run();
      assert.equal(captured.fetchCalls[0].opts.method, 'POST');
    });

    // Test 19
    it('sets Authorization header to "Bearer <token>"', async () => {
      stubState.docs = [makeDoc('doc_auth')];
      await run();
      assert.equal(
        captured.fetchCalls[0].opts.headers.Authorization,
        `Bearer ${stubState.token}`
      );
    });

    // Test 20
    it('sends lineUserId and message from the doc in the request body', async () => {
      const lineUserId = 'Uabc123';
      const message    = { type: 'text', text: 'Pay your bill' };
      stubState.docs   = [makeDoc('doc_body', { lineUserId, message })];
      await run();
      const body = JSON.parse(captured.fetchCalls[0].opts.body);
      assert.equal(body.to, lineUserId);
      assert.deepEqual(body.messages, [message]);
    });

    // Test 21
    it('makes one fetch call per doc in the queue', async () => {
      stubState.docs = [makeDoc('d1'), makeDoc('d2'), makeDoc('d3')];
      await run();
      assert.equal(captured.fetchCalls.length, 3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('result shape', () => {
    // Test 22
    it('returns { processed, recovered, failed, abandoned } with correct counts', async () => {
      // 1 success, 1 transient failure, 1 permanent failure
      const savedFetch = global.fetch;
      let callCount = 0;
      global.fetch = async (url, opts) => {
        captured.fetchCalls.push({ url, opts });
        callCount++;
        if (callCount === 1) return { ok: true,  status: 200, text: async () => '' };
        if (callCount === 2) return { ok: false, status: 500, text: async () => 'err' };
        return { ok: false, status: 400, text: async () => 'bad user' };
      };

      stubState.docs = [
        makeDoc('r1'),                          // → recovered
        makeDoc('r2', { attempts: 0 }),         // → failed (500, retry)
        makeDoc('r3', { attempts: 0 }),         // → abandoned (400)
      ];

      const result = await run();
      global.fetch = savedFetch;

      assert.equal(result.processed, 3);
      assert.equal(result.recovered, 1);
      assert.equal(result.failed,    1);
      assert.equal(result.abandoned, 1);
    });

    // Test 23
    it('processed equals snap.size regardless of individual outcomes', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 400;
      stubState.docs        = [makeDoc('x1'), makeDoc('x2')];
      const result = await run();
      assert.equal(result.processed, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('backoff calculation — BACKOFF_BASE_MS * BACKOFF_MULTIPLIER^(newAttempts-1)', () => {
    // Test 24
    it('backoff for attempts=0 (newAttempts=1) equals 300000ms (5min * 2^0)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      stubState.docs        = [makeDoc('backoff_calc', { attempts: 0 })];
      const beforeMs = Date.now();
      await run();
      const nextMs = new Date(captured.updateCalls['backoff_calc'].nextAttemptAt).getTime();
      assert.ok(
        Math.abs(nextMs - beforeMs - 300000) < 500,
        `expected ~300000ms offset, got ${nextMs - beforeMs}ms`
      );
    });

    // Test 25
    it('backoff for attempts=2 (newAttempts=3) equals 1200000ms (5min * 2^2)', async () => {
      stubState.fetchOk     = false;
      stubState.fetchStatus = 500;
      // newAttempts=3, backoffMs = 300000 * 4 = 1200000
      stubState.docs        = [makeDoc('backoff_calc3', { attempts: 2 })];
      const beforeMs = Date.now();
      await run();
      const nextMs = new Date(captured.updateCalls['backoff_calc3'].nextAttemptAt).getTime();
      assert.ok(
        Math.abs(nextMs - beforeMs - 1200000) < 500,
        `expected ~1200000ms offset, got ${nextMs - beforeMs}ms`
      );
    });
  });
});
