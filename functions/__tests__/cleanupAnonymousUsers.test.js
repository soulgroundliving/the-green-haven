/**
 * Unit tests for cleanupAnonymousUsers — bulk-delete orphan Firebase Auth users
 * that have no provider data AND no custom claims.
 *
 * Covers: CORS/method guard, requireAdmin short-circuit, user-filtering logic
 * (providerData / customClaims combinations), pagination, batch deletion,
 * failureCount warning path, large-batch splitting, sample capping, response
 * shape, and error propagation.
 *
 * Run: node --test functions/__tests__/cleanupAnonymousUsers.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let requireAdminStub;    // called as requireAdmin(req, res) — return decoded or null
let authPagesQueue = []; // array of { users: [...], pageToken?: string }
let deleteResults = [];  // array of { successCount, failureCount } per batch call
let deleteCallArgs = []; // records each batch of UIDs passed to deleteUsers

function resetStubs() {
  requireAdminStub = async (_req, _res) => ({ uid: 'adminUid', email: 'admin@example.com', admin: true });
  authPagesQueue = [];
  deleteResults = [];
  deleteCallArgs = [];
}

// ── Auth instance stub ────────────────────────────────────────────────────────

const authInstance = {
  listUsers: async (_maxResults, _pageToken) => {
    // Pop pages in order; fall back to empty terminal page
    return authPagesQueue.shift() || { users: [], pageToken: undefined };
  },
  deleteUsers: async (uids) => {
    deleteCallArgs.push([...uids]);
    const r = deleteResults.shift() || { successCount: uids.length, failureCount: 0 };
    return r;
  },
};

// ── Admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  auth: () => authInstance,
  firestore: Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => ({}) },
    Timestamp: {},
  }),
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

let capturedHandler;

const functionsStub = {
  region: () => ({
    runWith: () => ({
      https: {
        onRequest: (h) => {
          capturedHandler = h;
          return {};
        },
      },
    }),
  }),
};

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;

before(() => {
  Module._load = function (request, parent, ...rest) {
    if (request === 'firebase-functions/v1') return functionsStub;
    if (request === 'firebase-admin') return adminStub;
    if (request === './_auth') {
      return {
        requireAdmin: async (req, res) => requireAdminStub(req, res),
      };
    }
    return _origLoad.call(this, request, parent, ...rest);
  };

  // Load the CF — capturedHandler is populated as a side-effect
  require('../cleanupAnonymousUsers');
});

after(() => {
  Module._load = _origLoad;
});

beforeEach(() => {
  resetStubs();
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return { method: 'POST', body: {}, ...overrides };
}

function makeRes() {
  const r = { _status: null, _body: null };
  r.set = () => r;
  r.status = (code) => {
    r._status = code;
    return {
      json: (b) => { r._body = b; return r; },
      send: (b) => { r._body = b; return r; },
    };
  };
  return r;
}

// Helper: build a user record
function makeUser({ uid = 'u1', providerData = undefined, customClaims = undefined } = {}) {
  const u = { uid };
  if (providerData !== undefined) u.providerData = providerData;
  if (customClaims !== undefined) u.customClaims = customClaims;
  return u;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanupAnonymousUsers', () => {

  // ── Request handling ────────────────────────────────────────────────────────
  describe('request handling', () => {
    it('OPTIONS returns 204', async () => {
      const req = makeReq({ method: 'OPTIONS' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 204);
    });

    it('GET returns 405', async () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('PUT returns 405', async () => {
      const req = makeReq({ method: 'PUT' });
      const res = makeRes();
      await capturedHandler(req, res);
      assert.equal(res._status, 405);
    });

    it('requireAdmin returns null → handler short-circuits without calling listUsers', async () => {
      requireAdminStub = async (_req, res) => {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      };
      // Push a page so we can detect if listUsers was called
      authPagesQueue.push({ users: [makeUser({ uid: 'x1' })], pageToken: undefined });

      const req = makeReq();
      const res = makeRes();
      await capturedHandler(req, res);

      // The stub wrote 401; listUsers page still in queue (not consumed)
      assert.equal(authPagesQueue.length, 1, 'listUsers must NOT be called when requireAdmin returns null');
    });
  });

  // ── User filtering ──────────────────────────────────────────────────────────
  describe('user filtering', () => {
    it('user with non-empty providerData (email) → NOT collected as anon', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'u1', providerData: [{ providerId: 'password' }] })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 0);
      assert.equal(res._body.deleted, 0);
    });

    it('user with no providerData but has customClaims (non-empty) → NOT collected', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'u2', providerData: [], customClaims: { room: '15', building: 'rooms' } })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 0);
    });

    it('user with no providerData AND no customClaims → collected as anon', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'u3', providerData: [] })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 1);
      assert.ok(res._body.sample.includes('u3'));
    });

    it('user with empty customClaims ({}) → Object.keys length === 0 → hasClaims is false → collected', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'u4', providerData: [], customClaims: {} })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 1);
    });

    it('user with undefined providerData AND no customClaims → isAnon is true → collected', async () => {
      // providerData omitted entirely — `!u.providerData` is true
      authPagesQueue.push({
        users: [makeUser({ uid: 'u5' })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 1);
    });

    it('mixed page: one anon, one with providerData, one with claims → only anon collected', async () => {
      authPagesQueue.push({
        users: [
          makeUser({ uid: 'anon1', providerData: [] }),
          makeUser({ uid: 'withProvider', providerData: [{ providerId: 'google.com' }] }),
          makeUser({ uid: 'withClaims', providerData: [], customClaims: { admin: true } }),
        ],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 1);
      assert.ok(res._body.sample.includes('anon1'));
    });
  });

  // ── Pagination ──────────────────────────────────────────────────────────────
  describe('pagination', () => {
    it('single page with no pageToken → all users collected in one loop iteration', async () => {
      authPagesQueue.push({
        users: [
          makeUser({ uid: 'p1', providerData: [] }),
          makeUser({ uid: 'p2', providerData: [] }),
        ],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 2);
    });

    it('two pages → users from both pages are collected', async () => {
      // First page has pageToken → loop continues
      authPagesQueue.push({
        users: [makeUser({ uid: 'page1user', providerData: [] })],
        pageToken: 'token-for-page-2',
      });
      // Second page has no pageToken → loop stops
      authPagesQueue.push({
        users: [makeUser({ uid: 'page2user', providerData: [] })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 2);
      assert.ok(res._body.sample.includes('page1user'));
      assert.ok(res._body.sample.includes('page2user'));
    });

    it('three pages → users from all three pages collected', async () => {
      authPagesQueue.push({ users: [makeUser({ uid: 'a' })], pageToken: 'tk1' });
      authPagesQueue.push({ users: [makeUser({ uid: 'b' })], pageToken: 'tk2' });
      authPagesQueue.push({ users: [makeUser({ uid: 'c' })], pageToken: undefined });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 3);
    });
  });

  // ── Deletion ────────────────────────────────────────────────────────────────
  describe('deletion', () => {
    it('no anon users found → deleteUsers never called, scanned=0, deleted=0, sample=[]', async () => {
      authPagesQueue.push({ users: [], pageToken: undefined });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 0);
      assert.equal(res._body.deleted, 0);
      assert.deepEqual(res._body.sample, []);
      assert.equal(deleteCallArgs.length, 0);
    });

    it('anon users found → deleteUsers called with their UIDs', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'del1' }), makeUser({ uid: 'del2' })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(deleteCallArgs.length, 1);
      assert.deepEqual(deleteCallArgs[0].sort(), ['del1', 'del2'].sort());
    });

    it('successCount returned by deleteUsers → deleted reflects that count', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'x1' }), makeUser({ uid: 'x2' }), makeUser({ uid: 'x3' })],
        pageToken: undefined,
      });
      deleteResults.push({ successCount: 3, failureCount: 0 });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.deleted, 3);
    });

    it('failureCount > 0 → deleted = successCount only (not total batch size)', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'y1' }), makeUser({ uid: 'y2' }), makeUser({ uid: 'y3' })],
        pageToken: undefined,
      });
      deleteResults.push({ successCount: 2, failureCount: 1 });
      const res = makeRes();

      // Capture console.warn to confirm it fires
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      await capturedHandler(makeReq(), res);
      console.warn = origWarn;

      assert.equal(res._body.deleted, 2);
      assert.ok(warnings.length > 0, 'console.warn must be called when failureCount > 0');
    });

    it('large batch (>1000 anon users) → deleteUsers called twice', async () => {
      // Build 1500 anon user records
      const users = Array.from({ length: 1500 }, (_, i) => makeUser({ uid: `anon${i}` }));
      authPagesQueue.push({ users, pageToken: undefined });

      const res = makeRes();
      await capturedHandler(makeReq(), res);

      assert.equal(deleteCallArgs.length, 2, 'Expected exactly 2 deleteUsers calls for 1500 users');
      assert.equal(deleteCallArgs[0].length, 1000);
      assert.equal(deleteCallArgs[1].length, 500);
    });

    it('large batch deletion → deleted = sum of successCounts across both calls', async () => {
      const users = Array.from({ length: 1200 }, (_, i) => makeUser({ uid: `u${i}` }));
      authPagesQueue.push({ users, pageToken: undefined });
      deleteResults.push({ successCount: 1000, failureCount: 0 });
      deleteResults.push({ successCount: 200, failureCount: 0 });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.deleted, 1200);
    });

    it('sample is capped at 5 UIDs even when more anon users exist', async () => {
      const users = Array.from({ length: 10 }, (_, i) => makeUser({ uid: `samp${i}` }));
      authPagesQueue.push({ users, pageToken: undefined });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.sample.length, 5);
    });

    it('sample contains the first 5 UID values in collection order', async () => {
      const uids = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
      authPagesQueue.push({ users: uids.map(uid => makeUser({ uid })), pageToken: undefined });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.deepEqual(res._body.sample, uids.slice(0, 5));
    });
  });

  // ── Response shape ──────────────────────────────────────────────────────────
  describe('response shape', () => {
    it('success response has shape { success: true, scanned, deleted, sample }', async () => {
      authPagesQueue.push({
        users: [makeUser({ uid: 'r1' }), makeUser({ uid: 'r2' })],
        pageToken: undefined,
      });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.ok(typeof res._body.scanned === 'number');
      assert.ok(typeof res._body.deleted === 'number');
      assert.ok(Array.isArray(res._body.sample));
    });

    it('scanned reflects total anon candidates found across all pages', async () => {
      authPagesQueue.push({ users: [makeUser({ uid: 'sc1' })], pageToken: 'next' });
      authPagesQueue.push({ users: [makeUser({ uid: 'sc2' }), makeUser({ uid: 'sc3' })], pageToken: undefined });
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      assert.equal(res._body.scanned, 3);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────
  describe('error handling', () => {
    it('listUsers throws → handler returns 500', async () => {
      // Replace authInstance.listUsers temporarily via authPagesQueue trick:
      // override at the instance level for this test only
      const origListUsers = authInstance.listUsers;
      authInstance.listUsers = async () => { throw new Error('Auth service unavailable'); };
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      authInstance.listUsers = origListUsers;
      assert.equal(res._status, 500);
    });

    it('deleteUsers throws → handler returns 500', async () => {
      authPagesQueue.push({ users: [makeUser({ uid: 'z1' })], pageToken: undefined });
      const origDelete = authInstance.deleteUsers;
      authInstance.deleteUsers = async () => { throw new Error('Delete batch failed'); };
      const res = makeRes();
      await capturedHandler(makeReq(), res);
      authInstance.deleteUsers = origDelete;
      assert.equal(res._status, 500);
    });
  });
});
