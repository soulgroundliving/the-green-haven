/**
 * Unit tests for keepLiffWarm — Gen1 pubsub.schedule CF (every 5 min).
 *
 * Stubs: firebase-functions/v1 (Module._load), node-fetch (Module._load).
 * No Firebase Admin / Firestore used by this CF — no admin stub needed.
 *
 * Run: node --test functions/__tests__/keepLiffWarm.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

const CF_BASE = 'https://asia-southeast1-the-green-haven.cloudfunctions.net';

// Expected TARGETS in declaration order (matches keepLiffWarm.js)
const EXPECTED_TARGETS = [
  { url: `${CF_BASE}/liffSignIn`,            callable: false },
  { url: `${CF_BASE}/liffBookingSignIn`,     callable: false },
  { url: `${CF_BASE}/verifySlip`,            callable: false },
  { url: `${CF_BASE}/claimDailyLoginPoints`, callable: true  },
  { url: `${CF_BASE}/getLeaderboard`,        callable: true  },
];

let stubState = {};
let captured = {};

/**
 * Reset per-test state.
 * responses: array of { ok, status } indexed by fetch call order.
 *   If responses[i] is absent, defaults to { ok: true, status: 200 }.
 * networkErrors: map of url → Error to throw instead of returning a response.
 */
function resetStubs(overrides = {}) {
  stubState = {
    responses: [],
    networkErrors: {},
    ...overrides,
  };
  captured = {
    fetchCalls: [],  // [{ url, opts }]
  };
}
resetStubs();

// ── Module._load interception (installed BEFORE require('../keepLiffWarm.js')) ─

let capturedScheduledHandler = null;

const _origLoad = Module._load;

// node-fetch stub — intercept the `node-fetch` module require
const nodeFetchStub = async (url, opts) => {
  const callIndex = captured.fetchCalls.length;
  captured.fetchCalls.push({ url, opts });
  if (stubState.networkErrors && stubState.networkErrors[url]) {
    throw stubState.networkErrors[url];
  }
  const r = stubState.responses[callIndex] || { ok: true, status: 200 };
  return { ok: r.ok, status: r.status };
};

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        pubsub: {
          schedule: () => ({
            onRun: (h) => {
              capturedScheduledHandler = h;
              return {};
            },
          }),
        },
      }),
    };
  }
  return _origLoad.call(this, request, parent, ...rest);
};

global.fetch = nodeFetchStub;

// Require CF after all stubs are in place
delete require.cache[require.resolve('../keepLiffWarm.js')];
require('../keepLiffWarm.js');

after(() => {
  Module._load = _origLoad;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('keepLiffWarm', () => {
  beforeEach(() => resetStubs());

  // Test 1 — CF registers its handler via pubsub.schedule().onRun
  it('captures the scheduled onRun handler during module load', () => {
    assert.ok(
      typeof capturedScheduledHandler === 'function',
      'capturedScheduledHandler must be a function after require'
    );
  });

  // Test 2 — handler returns null
  it('handler returns null', async () => {
    const result = await capturedScheduledHandler();
    assert.equal(result, null, 'onRun handler must return null');
  });

  // Test 3 — all 5 URLs are fetched
  it('issues exactly 5 fetch calls — one per TARGETS entry', async () => {
    await capturedScheduledHandler();
    assert.equal(
      captured.fetchCalls.length,
      5,
      'must fetch exactly 5 URLs'
    );
  });

  // Test 4 — each fetch uses method GET
  it('uses method GET for every fetch call', async () => {
    await capturedScheduledHandler();
    for (const call of captured.fetchCalls) {
      assert.equal(
        call.opts && call.opts.method,
        'GET',
        `expected method:GET for url ${call.url}`
      );
    }
  });

  // Test 5 — fetched URLs match the hardcoded TARGETS in order
  it('fetches the correct CF URLs in order', async () => {
    await capturedScheduledHandler();
    const fetchedUrls = captured.fetchCalls.map(c => c.url);
    const expectedUrls = EXPECTED_TARGETS.map(t => t.url);
    assert.deepEqual(fetchedUrls, expectedUrls, 'fetched URLs must match TARGETS in declaration order');
  });

  // Test 6 — CF_BASE contains the expected region + project
  it('all URLs share the asia-southeast1-the-green-haven.cloudfunctions.net base', async () => {
    await capturedScheduledHandler();
    for (const call of captured.fetchCalls) {
      assert.ok(
        call.url.includes('asia-southeast1-the-green-haven.cloudfunctions.net'),
        `url must include the correct CF_BASE, got: ${call.url}`
      );
    }
  });

  // Test 7 — 200 on non-callable URL → handler does not throw
  it('handles 200 response on a non-callable URL without throwing', async () => {
    // liffSignIn (callable:false) → 200 is the happy path
    resetStubs({ responses: [{ ok: true, status: 200 }] });
    await assert.doesNotReject(capturedScheduledHandler, 'handler must not throw on 200');
  });

  // Test 8 — 405 on callable URL → treated as warm-ok, handler does not throw
  it('handles 405 response on a callable URL as warm-ok without throwing', async () => {
    // claimDailyLoginPoints (callable:true) is index 3 → override its response
    resetStubs({
      responses: [
        { ok: true,  status: 200 },  // liffSignIn
        { ok: true,  status: 200 },  // liffBookingSignIn
        { ok: true,  status: 200 },  // verifySlip
        { ok: false, status: 405 },  // claimDailyLoginPoints (callable)
        { ok: true,  status: 200 },  // getLeaderboard
      ],
    });
    await assert.doesNotReject(capturedScheduledHandler, 'handler must not throw on 405 callable');
    assert.equal(captured.fetchCalls.length, 5, 'all 5 fetches still complete');
  });

  // Test 9 — non-200/non-405 status → handler does not throw (warning only)
  it('does not throw when one URL returns an unexpected status (e.g. 503)', async () => {
    resetStubs({
      responses: [
        { ok: false, status: 503 },  // liffSignIn fails with 503
        { ok: true,  status: 200 },
        { ok: true,  status: 200 },
        { ok: true,  status: 200 },
        { ok: true,  status: 200 },
      ],
    });
    await assert.doesNotReject(capturedScheduledHandler, 'handler must not throw on non-200/non-405 status');
  });

  // Test 10 — network error on one URL → Promise.allSettled swallows it, handler does not throw
  it('does not throw when one URL throws a network error', async () => {
    const targetUrl = `${CF_BASE}/liffSignIn`;
    resetStubs({
      networkErrors: { [targetUrl]: new Error('ECONNRESET') },
    });
    await assert.doesNotReject(capturedScheduledHandler, 'handler must not throw on per-URL network error');
    // The erroring fetch call was still attempted
    assert.ok(
      captured.fetchCalls.some(c => c.url === targetUrl),
      'the failing URL must have been attempted'
    );
  });

  // Test 11 — all 5 URLs fail with network errors → handler still returns null
  it('returns null when all 5 URLs throw network errors', async () => {
    const networkErrors = {};
    for (const t of EXPECTED_TARGETS) {
      networkErrors[t.url] = new Error('network failure');
    }
    resetStubs({ networkErrors });
    const result = await capturedScheduledHandler();
    assert.equal(result, null, 'handler must still return null when all fetches fail');
  });
});
