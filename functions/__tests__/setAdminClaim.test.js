/**
 * Unit tests for setAdminClaim — HTTP endpoint (onRequest) that sets
 * admin or accountant custom claims on a Firebase Auth user.
 *
 * Two auth paths:
 *   1. X-Init-Token header matching INIT_TOKEN env var (bootstrap, locked once any admin exists)
 *   2. Authorization: Bearer <idToken> where decoded.admin === true
 *
 * Run: node --test functions/__tests__/setAdminClaim.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ──────────────────────────────────────────────────────────────
let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    hasAnyAdminResult: false,       // true  → INIT_TOKEN path returns 403
    hasAnyAdminError: null,         // Error → hasAnyAdmin throws → 500
    verifyIdTokenResult: null,      // null  → verifyIdToken throws; object → decoded token
    getUserByEmailResult: { uid: 'uid123', email: 'target@example.com' },
    getUserByEmailError: null,      // Error → propagates (404 or 500)
    setCustomUserClaimsError: null, // Error → propagates as 500
    initToken: 'secret123',
    ...overrides,
  };
  captured = {
    setCustomUserClaimsCalls: [],   // [{ uid, claims }]
    getUserByEmailCalls: [],        // [email]
  };
  process.env.INIT_TOKEN = stubState.initToken;
}
resetStubs();

// ── firebase-admin stub ─────────────────────────────────────────────────────
const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  auth: () => ({
    listUsers: async (_maxResults, _pageToken) => {
      if (stubState.hasAnyAdminError) throw stubState.hasAnyAdminError;
      return {
        users: stubState.hasAnyAdminResult
          ? [{ customClaims: { admin: true } }]
          : [],
        pageToken: undefined,
      };
    },
    verifyIdToken: async (_token) => {
      if (!stubState.verifyIdTokenResult) throw new Error('Invalid token');
      return stubState.verifyIdTokenResult;
    },
    getUserByEmail: async (email) => {
      captured.getUserByEmailCalls.push(email);
      if (stubState.getUserByEmailError) throw stubState.getUserByEmailError;
      return stubState.getUserByEmailResult;
    },
    setCustomUserClaims: async (uid, claims) => {
      captured.setCustomUserClaimsCalls.push({ uid, claims });
      if (stubState.setCustomUserClaimsError) throw stubState.setCustomUserClaimsError;
    },
  }),
};

// ── firebase-functions/v1 stub ──────────────────────────────────────────────
const functionsStub = {
  region: () => ({
    https: {
      HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
      },
      onRequest: (h) => h,
    },
  }),
  https: {
    HttpsError: class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    },
    onRequest: (h) => h,
  },
};

// ── Module._load intercept ──────────────────────────────────────────────────
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return functionsStub;
  return originalLoad.call(this, request, parent, isMain);
};

// ── Load CF under test (after stubs are installed) ──────────────────────────
const { setAdminClaim: handler } = require('../setAdminClaim');

// ── Request / response helpers ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  const headers = overrides.headers || {};
  return {
    method: 'POST',
    body: { email: 'target@example.com' },
    get: (name) => headers[name.toLowerCase()] || headers[name] || '',
    ...overrides,
  };
}

function makeRes() {
  const r = { _status: null, _body: null };
  r.set = () => r;           // headers — chainable no-op
  r.status = (code) => {
    r._status = code;
    return {
      json: (b) => { r._body = b; return r; },
      send: (b) => { r._body = b; return r; },
    };
  };
  return r;
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('setAdminClaim', () => {
  beforeEach(() => resetStubs());

  // ── CORS ─────────────────────────────────────────────────────────────────
  describe('CORS', () => {
    it('OPTIONS returns 204', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 204);
    });
  });

  // ── Method guard ──────────────────────────────────────────────────────────
  describe('method guard', () => {
    it('GET returns 405', async () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 405);
    });

    it('PUT returns 405', async () => {
      const req = makeReq({ method: 'PUT' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 405);
    });
  });

  // ── Auth gate — no credentials ────────────────────────────────────────────
  describe('auth gate — no credentials', () => {
    it('POST with no headers returns 401', async () => {
      const req = makeReq({ headers: {} });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 401);
    });
  });

  // ── Auth gate — INIT_TOKEN path ───────────────────────────────────────────
  describe('auth gate — INIT_TOKEN path', () => {
    it('valid INIT_TOKEN with no existing admin proceeds past auth (bad email → 400, not 401/403)', async () => {
      // hasAnyAdminResult: false → no admin yet → authed=true
      // Bad email body ensures the 400 comes from body validation, NOT auth rejection
      const req = makeReq({
        headers: { 'x-init-token': 'secret123' },
        body: { email: 'not-an-email' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('valid INIT_TOKEN but admin already exists → 403 with lockout message', async () => {
      stubState.hasAnyAdminResult = true;
      const req = makeReq({
        headers: { 'x-init-token': 'secret123' },
        body: { email: 'target@example.com' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 403);
      assert.match(res._body.error, /INIT_TOKEN bootstrap locked/i);
    });

    it('hasAnyAdmin throws → 500', async () => {
      stubState.hasAnyAdminError = new Error('Firestore unavailable');
      const req = makeReq({
        headers: { 'x-init-token': 'secret123' },
        body: { email: 'target@example.com' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 500);
    });

    it('INIT_TOKEN mismatch falls through to bearer check → 401 (no bearer present)', async () => {
      // The env token is 'secret123', send 'WRONG' — mismatch → not authed via INIT_TOKEN
      // No Authorization header present → 401 from bearer path
      const req = makeReq({
        headers: { 'x-init-token': 'WRONG' },
        body: { email: 'target@example.com' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 401);
    });
  });

  // ── Auth gate — Bearer path ───────────────────────────────────────────────
  describe('auth gate — Bearer path', () => {
    it('Bearer present but verifyIdToken throws → 401', async () => {
      // verifyIdTokenResult: null causes stub to throw
      const req = makeReq({
        headers: { authorization: 'Bearer bad-token-value' },
        body: { email: 'target@example.com' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 401);
    });

    it('Bearer valid but decoded.admin !== true → 403', async () => {
      stubState.verifyIdTokenResult = { uid: 'u1', email: 'nonadmin@example.com' };
      // no admin: true in decoded token
      const req = makeReq({
        headers: { authorization: 'Bearer valid-token' },
        body: { email: 'target@example.com' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 403);
    });

    it('Bearer valid with admin:true → proceeds to body validation', async () => {
      stubState.verifyIdTokenResult = { uid: 'adminUid', email: 'admin@example.com', admin: true };
      // Bad email ensures we get 400 from body validation — proving auth passed
      const req = makeReq({
        headers: { authorization: 'Bearer valid-token' },
        body: { email: 'not-valid' },
      });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });
  });

  // ── Body validation ───────────────────────────────────────────────────────
  describe('body validation', () => {
    // Shared helper: authed via INIT_TOKEN, no admin exists yet
    function authedReq(bodyOverrides = {}) {
      return makeReq({
        headers: { 'x-init-token': 'secret123' },
        body: { email: 'target@example.com', ...bodyOverrides },
      });
    }

    it('missing email → 400', async () => {
      const req = authedReq({ email: undefined });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('email without @ fails regex → 400', async () => {
      const req = authedReq({ email: 'notanemail' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('invalid role → 400', async () => {
      const req = authedReq({ role: 'superadmin' });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 400);
    });

    it('role defaults to admin when omitted — uses { admin: true } claim', async () => {
      // No role field in body → should default to 'admin'
      const req = authedReq({ role: undefined });
      const res = makeRes();
      await handler(req, res);
      assert.equal(res._status, 200);
      assert.equal(captured.setCustomUserClaimsCalls.length, 1);
      assert.deepEqual(captured.setCustomUserClaimsCalls[0].claims, { admin: true });
    });
  });

  // ── Set claim ─────────────────────────────────────────────────────────────
  describe('set claim', () => {
    // All happy-path tests use Bearer auth with admin:true
    function authedReq(bodyOverrides = {}) {
      stubState.verifyIdTokenResult = { uid: 'adminUid', email: 'admin@example.com', admin: true };
      return makeReq({
        headers: { authorization: 'Bearer valid-token' },
        body: { email: 'target@example.com', ...bodyOverrides },
      });
    }

    it('valid admin Bearer + valid body → getUserByEmail called, setCustomUserClaims called with { admin: true }, returns 200 with success payload', async () => {
      const req = authedReq();
      const res = makeRes();
      await handler(req, res);

      assert.equal(res._status, 200);
      assert.equal(captured.getUserByEmailCalls.length, 1);
      assert.equal(captured.setCustomUserClaimsCalls.length, 1);
      assert.deepEqual(captured.setCustomUserClaimsCalls[0].claims, { admin: true });
      assert.equal(captured.setCustomUserClaimsCalls[0].uid, 'uid123');

      assert.equal(res._body.success, true);
      assert.equal(res._body.uid, 'uid123');
      assert.equal(res._body.email, 'target@example.com');
      assert.deepEqual(res._body.claims, { admin: true });
    });

    it('role=accountant → setCustomUserClaims called with { accountant: true }', async () => {
      const req = authedReq({ role: 'accountant' });
      const res = makeRes();
      await handler(req, res);

      assert.equal(res._status, 200);
      assert.deepEqual(captured.setCustomUserClaimsCalls[0].claims, { accountant: true });
      assert.deepEqual(res._body.claims, { accountant: true });
    });

    it('getUserByEmail throws auth/user-not-found → 404', async () => {
      const err = new Error('No user found');
      err.code = 'auth/user-not-found';
      stubState.getUserByEmailError = err;

      const req = authedReq();
      const res = makeRes();
      await handler(req, res);

      assert.equal(res._status, 404);
    });

    it('getUserByEmail throws an unexpected error → 500', async () => {
      stubState.getUserByEmailError = new Error('Network failure');
      // No code property — should not match auth/user-not-found

      const req = authedReq();
      const res = makeRes();
      await handler(req, res);

      assert.equal(res._status, 500);
    });
  });
});
