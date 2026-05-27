/**
 * Unit tests for setTenantEmail.js
 *
 * Covers: auth guard, input validation, email regex, claims matching,
 * tenant doc existence, linkedAuthUid ownership, Firebase Auth + Firestore
 * write shape, return value, and String(room) coercion.
 *
 * Run: node --test functions/__tests__/setTenantEmail.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Per-test state ────────────────────────────────────────────────────────────

let tenantSnap;
let updateUserArgs;
let tenantUpdateArgs;
let docPathCaptured;

function resetStubs() {
  tenantSnap = { exists: true, data: () => ({ linkedAuthUid: null }) };
  updateUserArgs = null;
  tenantUpdateArgs = null;
  docPathCaptured = null;
}
resetStubs();

// ── Stubs ─────────────────────────────────────────────────────────────────────

const tenantRefStub = {
  get: async () => tenantSnap,
  update: async (patch) => { tenantUpdateArgs = patch; },
};

const fsInstance = {
  doc: (path) => {
    docPathCaptured = path;
    return tenantRefStub;
  },
};

const authInstance = {
  updateUser: async (uid, data) => { updateUserArgs = { uid, data }; },
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TS',
      increment: (n) => n,
      delete: () => 'DEL',
    },
    Timestamp: { fromMillis: (ms) => ms },
  }),
  auth: () => authInstance,
};

// ── Module intercept ──────────────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1' || request === 'firebase-functions') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (handler) => handler } }),
      https: { HttpsError },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { setTenantEmail: handler } = require('../setTenantEmail');

// ── Context helpers ───────────────────────────────────────────────────────────

function makeContext({ uid = 'user-uid-1', token = {} } = {}) {
  return { auth: { uid, token } };
}

function makeData(overrides = {}) {
  return { email: 'user@example.com', building: 'rooms', room: '15', ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('setTenantEmail', () => {

  beforeEach(resetStubs);

  // ── Auth guard ────────────────────────────────────────────────────────────

  describe('auth guard', () => {
    it('not authenticated (context.auth = null) → throws unauthenticated', async () => {
      await assert.rejects(
        () => handler(makeData(), { auth: null }),
        (err) => err.code === 'unauthenticated'
      );
    });
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe('input validation', () => {
    it('missing email → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler({ building: 'rooms', room: '15' }, makeContext()),
        (err) => err.code === 'invalid-argument'
      );
    });

    it('missing building → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler({ email: 'user@example.com', room: '15' }, makeContext()),
        (err) => err.code === 'invalid-argument'
      );
    });

    it('missing room → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler({ email: 'user@example.com', building: 'rooms' }, makeContext()),
        (err) => err.code === 'invalid-argument'
      );
    });

    it('empty data object → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler({}, makeContext()),
        (err) => err.code === 'invalid-argument'
      );
    });
  });

  // ── Email format validation ───────────────────────────────────────────────

  describe('email format validation', () => {
    it('invalid email (no @) → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler(makeData({ email: 'notanemail' }), makeContext()),
        (err) => err.code === 'invalid-argument' && /email/i.test(err.message)
      );
    });

    it('invalid email (space in local part) → throws invalid-argument', async () => {
      await assert.rejects(
        () => handler(makeData({ email: 'user name@example.com' }), makeContext()),
        (err) => err.code === 'invalid-argument'
      );
    });

    it('valid email format passes regex (user@example.com)', async () => {
      // A valid email with matching claims and existing doc must NOT throw invalid-argument.
      await assert.doesNotReject(
        () => handler(makeData({ email: 'user@example.com' }), makeContext())
      );
    });
  });

  // ── Claims matching ───────────────────────────────────────────────────────

  describe('claims matching', () => {
    it('has building claim matching supplied building → proceeds without permission error', async () => {
      const ctx = makeContext({ token: { building: 'rooms', room: '15' } });
      await assert.doesNotReject(() => handler(makeData(), ctx));
    });

    it('has building claim, building mismatch → throws permission-denied', async () => {
      const ctx = makeContext({ token: { building: 'nest', room: '15' } });
      await assert.rejects(
        () => handler(makeData({ building: 'rooms' }), ctx),
        (err) => err.code === 'permission-denied'
      );
    });

    it('has room claim, room mismatch → throws permission-denied', async () => {
      const ctx = makeContext({ token: { building: 'rooms', room: '99' } });
      await assert.rejects(
        () => handler(makeData({ room: '15' }), ctx),
        (err) => err.code === 'permission-denied'
      );
    });

    it('no claims (anonymous) → skips claim check, proceeds', async () => {
      const ctx = makeContext({ token: {} });
      await assert.doesNotReject(() => handler(makeData(), ctx));
    });
  });

  // ── Tenant doc checks ────────────────────────────────────────────────────

  describe('tenant doc checks', () => {
    it('tenant doc not found → throws not-found', async () => {
      tenantSnap = { exists: false, data: () => ({}) };
      await assert.rejects(
        () => handler(makeData(), makeContext()),
        (err) => err.code === 'not-found'
      );
    });

    it('linkedAuthUid is null → proceeds (no uid check)', async () => {
      tenantSnap = { exists: true, data: () => ({ linkedAuthUid: null }) };
      await assert.doesNotReject(() => handler(makeData(), makeContext({ uid: 'any-uid' })));
    });

    it('linkedAuthUid is empty string → proceeds (no uid check)', async () => {
      tenantSnap = { exists: true, data: () => ({ linkedAuthUid: '' }) };
      await assert.doesNotReject(() => handler(makeData(), makeContext({ uid: 'any-uid' })));
    });

    it('linkedAuthUid matches caller uid → proceeds', async () => {
      tenantSnap = { exists: true, data: () => ({ linkedAuthUid: 'user-uid-1' }) };
      await assert.doesNotReject(
        () => handler(makeData(), makeContext({ uid: 'user-uid-1' }))
      );
    });

    it('linkedAuthUid mismatches caller uid → throws permission-denied', async () => {
      tenantSnap = { exists: true, data: () => ({ linkedAuthUid: 'other-uid' }) };
      await assert.rejects(
        () => handler(makeData(), makeContext({ uid: 'user-uid-1' })),
        (err) => err.code === 'permission-denied'
      );
    });
  });

  // ── Success path ─────────────────────────────────────────────────────────

  describe('success path', () => {
    it('admin.auth().updateUser called with { email, emailVerified: false }', async () => {
      await handler(makeData({ email: 'user@example.com' }), makeContext({ uid: 'user-uid-1' }));
      assert.ok(updateUserArgs !== null, 'updateUser was called');
      assert.equal(updateUserArgs.uid, 'user-uid-1');
      assert.deepEqual(updateUserArgs.data, { email: 'user@example.com', emailVerified: false });
    });

    it('tenantRef.update called with { email, emailVerified: false, emailUpdatedAt: SERVER_TS }', async () => {
      await handler(makeData({ email: 'user@example.com' }), makeContext());
      assert.ok(tenantUpdateArgs !== null, 'update was called');
      assert.equal(tenantUpdateArgs.email, 'user@example.com');
      assert.equal(tenantUpdateArgs.emailVerified, false);
      assert.equal(tenantUpdateArgs.emailUpdatedAt, 'SERVER_TS');
    });

    it('returns { ok: true }', async () => {
      const result = await handler(makeData(), makeContext());
      assert.deepEqual(result, { ok: true });
    });
  });

  // ── String(room) coercion ─────────────────────────────────────────────────

  describe('String(room) coercion', () => {
    it('room passed as number 15 → doc path uses "15"', async () => {
      await handler(makeData({ room: 15 }), makeContext());
      assert.ok(docPathCaptured !== null, 'doc() was called');
      assert.ok(
        docPathCaptured.endsWith('/15'),
        `doc path "${docPathCaptured}" should end with /15`
      );
    });

    it('claims.room as number 15 vs room "15" → String comparison passes, no permission error', async () => {
      const ctx = makeContext({ token: { building: 'rooms', room: 15 } });
      // String(15) === String('15') → both are '15' → no mismatch
      await assert.doesNotReject(() => handler(makeData({ room: '15' }), ctx));
    });
  });
});
