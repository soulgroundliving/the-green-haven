/**
 * Unit tests for liffBookingSignIn.js
 *
 * Covers: CORS/method routing, body validation, LINE token verification,
 * createCustomToken UID + claims contract, displayName truncation, and
 * error paths (network failure, token creation failure).
 *
 * Run: node --test functions/__tests__/liffBookingSignIn.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state (reset per test) ───────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // node-fetch LINE verify response
    lineVerifyOk: true,
    lineVerifyStatus: 200,
    lineVerifyBody: { sub: 'Uabc123', name: 'สมชาย ทดสอบ' },
    lineVerifyError: null,  // null = no network error; Error = throw
    // admin.auth().createCustomToken
    customToken: 'test-custom-token-xyz',
    createTokenError: null,
    // rate limit — false = not exceeded (allow through)
    rateLimitExceeded: false,
    ...overrides,
  };
  captured = {
    fetchCalls: [],        // { url, opts }
    createTokenCalls: [],  // { uid, claims }
    setClaimsCalls: [],    // { uid, claims }
    resSets: [],           // { k, v } from res.set()
  };
}
resetStubs();

// ── node-fetch stub ───────────────────────────────────────────────────────────

const nodeFetchStub = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (stubState.lineVerifyError) throw stubState.lineVerifyError;
  return {
    ok: stubState.lineVerifyOk,
    status: stubState.lineVerifyStatus,
    json: async () => stubState.lineVerifyBody,
  };
};

// ── firebase-admin stub ───────────────────────────────────────────────────────

// admin.firestore() stub — supports collection/doc/runTransaction for rate limiting.
// admin.firestore.Timestamp / FieldValue are static properties on the function.
const _firestoreInstance = () => ({
  collection: () => ({ doc: () => ({}) }),
  runTransaction: async (fn) => {
    const tx = {
      get: async () => ({ exists: stubState.rateLimitExceeded, data: () => ({ count: stubState.rateLimitExceeded ? 999 : 0, windowStart: { toMillis: () => Date.now() - 60000 } }) }),
      set: () => {},
    };
    return fn(tx);
  },
});
_firestoreInstance.Timestamp = { fromMillis: (ms) => ({ toMillis: () => ms }) };
_firestoreInstance.FieldValue = { serverTimestamp: () => null };

const adminStub = {
  apps: [{}],          // non-empty → initializeApp() skipped
  initializeApp: () => {},
  auth: () => ({
    createCustomToken: async (uid, claims) => {
      captured.createTokenCalls.push({ uid, claims: { ...claims } });
      if (stubState.createTokenError) throw stubState.createTokenError;
      return stubState.customToken;
    },
    setCustomUserClaims: async (uid, claims) => {
      captured.setClaimsCalls.push({ uid, claims: { ...claims } });
    },
  }),
  firestore: _firestoreInstance,
};

// ── Module._load intercept ────────────────────────────────────────────────────
// Must run BEFORE requiring the CF so stubs are in place at load time.

let capturedHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        runWith: () => ({
          https: {
            onRequest: (fn) => { capturedHandler = fn; return fn; },
          },
        }),
      }),
    };
  }
  return _origLoad.apply(this, arguments);
};

global.fetch = nodeFetchStub;

// ── Load CF under test ────────────────────────────────────────────────────────

delete require.cache[require.resolve('../liffBookingSignIn.js')];
require('../liffBookingSignIn.js');

after(() => { Module._load = _origLoad; });

// ── Request / response helpers ────────────────────────────────────────────────

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body) => { res._body = body; return res; };
  res.send   = (body) => { res._body = body; return res; };
  res.set    = (k, v) => { captured.resSets.push({ k, v }); res._headers[k] = v; return res; };
  return res;
}

function makeReq(overrides = {}) {
  return { method: 'POST', body: { idToken: 'valid-liff-token' }, ...overrides };
}

async function call(reqOverrides = {}) {
  const req = makeReq(reqOverrides);
  const res = makeRes();
  await capturedHandler(req, res);
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('liffBookingSignIn — setup', () => {
  it('handler was captured from onRequest', () => {
    assert.ok(typeof capturedHandler === 'function', 'capturedHandler must be a function');
  });
});

describe('liffBookingSignIn — CORS / method routing', () => {
  beforeEach(() => resetStubs());

  it('OPTIONS returns 204 with empty body', async () => {
    const res = await call({ method: 'OPTIONS' });
    assert.equal(res._status, 204);
    assert.equal(res._body, '');
  });

  it('OPTIONS sets Access-Control-Allow-Origin to Vercel deployment URL', async () => {
    const res = await call({ method: 'OPTIONS' });
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://the-green-haven.vercel.app');
  });

  it('GET returns 200 with status:ok and numeric ts', async () => {
    const res = await call({ method: 'GET', body: {} });
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.ok(typeof res._body.ts === 'number', 'ts must be a number');
  });

  it('PUT returns 405 method not allowed', async () => {
    const res = await call({ method: 'PUT', body: {} });
    assert.equal(res._status, 405);
    assert.ok(res._body.error.length > 0);
  });

  it('DELETE returns 405 method not allowed', async () => {
    const res = await call({ method: 'DELETE', body: {} });
    assert.equal(res._status, 405);
    assert.ok(res._body.error.length > 0);
  });

  it('Access-Control-Allow-Origin is set to Vercel deployment URL on POST requests', async () => {
    const res = await call();
    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://the-green-haven.vercel.app');
  });
});

describe('liffBookingSignIn — body validation', () => {
  beforeEach(() => resetStubs());

  it('returns 400 when body is empty object (no idToken)', async () => {
    const res = await call({ body: {} });
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('idToken'));
  });

  it('returns 400 when idToken is a number', async () => {
    const res = await call({ body: { idToken: 12345 } });
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('idToken'));
  });

  it('returns 400 when idToken is null', async () => {
    const res = await call({ body: { idToken: null } });
    assert.equal(res._status, 400);
    assert.ok(res._body.error.includes('idToken'));
  });

  it('returns 400 when body is null', async () => {
    const res = await call({ body: null });
    assert.equal(res._status, 400);
  });
});

describe('liffBookingSignIn — LINE token verification', () => {
  beforeEach(() => resetStubs());

  it('returns 500 when fetch throws a network error', async () => {
    resetStubs({ lineVerifyError: new Error('ECONNRESET') });
    const res = await call();
    assert.equal(res._status, 500);
    assert.ok(res._body.error.includes('LINE verify'));
  });

  it('returns 401 with error_description when LINE API rejects the token (HTTP not ok)', async () => {
    resetStubs({ lineVerifyOk: false, lineVerifyStatus: 400, lineVerifyBody: { error_description: 'invalid token' } });
    const res = await call();
    assert.equal(res._status, 401);
    assert.ok(res._body.error.includes('invalid token'));
  });

  it('returns 401 when LINE verify response is missing sub', async () => {
    resetStubs({ lineVerifyBody: { name: 'Test User' } }); // no sub field
    const res = await call();
    assert.equal(res._status, 401);
    assert.ok(res._body.error.includes('sub'));
  });

  it('calls LINE verify endpoint with correct URL', async () => {
    await call();
    assert.ok(captured.fetchCalls.length > 0, 'fetch must be called');
    assert.equal(captured.fetchCalls[0].url, 'https://api.line.me/oauth2/v2.1/verify');
  });

  it('calls LINE verify with POST method and form-urlencoded content-type', async () => {
    await call();
    const c = captured.fetchCalls[0];
    assert.equal(c.opts.method, 'POST');
    assert.equal(c.opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  });
});

describe('liffBookingSignIn — createCustomToken UID + claims', () => {
  beforeEach(() => resetStubs());

  it('calls createCustomToken with UID prefix book:<lineUserId>', async () => {
    await call();
    const mint = captured.createTokenCalls[0];
    assert.ok(mint, 'createCustomToken must be called');
    assert.equal(mint.uid, 'book:Uabc123');
  });

  it('claims include role: prospect', async () => {
    await call();
    const mint = captured.createTokenCalls[0];
    assert.equal(mint.claims.role, 'prospect');
  });

  it('claims include lineUserId matching LINE sub', async () => {
    await call();
    const mint = captured.createTokenCalls[0];
    assert.equal(mint.claims.lineUserId, 'Uabc123');
  });

  it('UID is never the raw LINE userId (always book: prefixed)', async () => {
    await call();
    const mint = captured.createTokenCalls[0];
    assert.notEqual(mint.uid, 'Uabc123');
    assert.ok(mint.uid.startsWith('book:'));
  });

  it('returns 500 when createCustomToken throws', async () => {
    resetStubs({ createTokenError: new Error('quota exceeded') });
    const res = await call();
    assert.equal(res._status, 500);
    assert.ok(res._body.error.length > 0);
  });
});

describe('liffBookingSignIn — success response shape', () => {
  beforeEach(() => resetStubs());

  it('returns 200 with customToken, lineUserId, and displayName on success', async () => {
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.customToken, 'test-custom-token-xyz');
    assert.equal(res._body.lineUserId, 'Uabc123');
    assert.equal(res._body.displayName, 'สมชาย ทดสอบ');
  });

  it('displayName is truncated to 60 characters when name exceeds 60 chars', async () => {
    resetStubs({ lineVerifyBody: { sub: 'Uxyz', name: 'a'.repeat(65) } });
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.displayName.length, 60);
  });

  it('displayName is the full name when name is exactly 60 characters', async () => {
    const name60 = 'b'.repeat(60);
    resetStubs({ lineVerifyBody: { sub: 'Uxyz', name: name60 } });
    const res = await call();
    assert.equal(res._body.displayName.length, 60);
    assert.equal(res._body.displayName, name60);
  });

  it('displayName is empty string when LINE response has no name field', async () => {
    resetStubs({ lineVerifyBody: { sub: 'Uxyz' } }); // no name
    const res = await call();
    assert.equal(res._status, 200);
    assert.equal(res._body.displayName, '');
  });

  it('lineUserId in response matches LINE sub value', async () => {
    resetStubs({ lineVerifyBody: { sub: 'Uother999', name: 'Test' } });
    const res = await call();
    assert.equal(res._body.lineUserId, 'Uother999');
  });
});

describe('liffBookingSignIn — rate limiting', () => {
  beforeEach(() => resetStubs());

  it('returns 429 when rate limit is exceeded for the lineUserId', async () => {
    resetStubs({ rateLimitExceeded: true });
    const res = await call();
    assert.equal(res._status, 429);
    assert.ok(res._body.error.toLowerCase().includes('too many'), `error was: ${res._body.error}`);
  });

  it('returns 200 when rate limit is not exceeded', async () => {
    resetStubs({ rateLimitExceeded: false });
    const res = await call();
    assert.equal(res._status, 200);
  });
});

describe('liffBookingSignIn — setCustomUserClaims (§7-Z)', () => {
  beforeEach(() => resetStubs());

  it('calls setCustomUserClaims with the same UID as createCustomToken', async () => {
    await call();
    assert.equal(captured.setClaimsCalls.length, 1);
    assert.equal(captured.setClaimsCalls[0].uid, 'book:Uabc123');
  });

  it('persists role:prospect and lineUserId in setCustomUserClaims', async () => {
    await call();
    const sc = captured.setClaimsCalls[0];
    assert.equal(sc.claims.role, 'prospect');
    assert.equal(sc.claims.lineUserId, 'Uabc123');
  });
});
