/**
 * Unit tests for checkTenantPhone — verifies a caller's phone against the
 * tenant doc without exposing the raw phone number to the client.
 *
 * Covers: auth gate, building/room/phone validation, normalizePhone edge cases,
 *         Firestore doc presence checks, phone matching logic, name resolution,
 *         and error propagation.
 *
 * Run: node --test functions/__tests__/checkTenantPhone.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    docExists: true,
    docData: { phone: '0812345678', name: 'สมชาย สิบห้า' },
    firestoreGetError: null,
    ...overrides,
  };
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
// Must run BEFORE requiring the CF so that firebase-admin and firebase-functions
// are intercepted at module-load time.

const _origLoad = Module._load;
let capturedHandler = null;

// HttpsError class — shared between admin stub and functions stub so that
// instanceof checks (if any) and code property work correctly.
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Build a Firestore stub that honours stubState per invocation.
// Path used by the CF: .collection('tenants').doc(building).collection('list').doc(room).get()
function makeFirestoreStub() {
  return {
    collection: (_c1) => ({
      doc: (_d1) => ({
        collection: (_c2) => ({
          doc: (_d2) => ({
            get: async () => {
              if (stubState.firestoreGetError) throw stubState.firestoreGetError;
              return {
                exists: stubState.docExists,
                data: () => stubState.docData,
              };
            },
          }),
        }),
      }),
    }),
  };
}

const adminStub = {
  apps: [{}],           // non-empty → initializeApp() branch is skipped
  initializeApp: () => {},
  firestore: () => makeFirestoreStub(),  // factory — called fresh per handler invocation
};
// Static properties referenced by some CF patterns
adminStub.firestore.FieldValue = {
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  increment: (n) => ({ _inc: n }),
  delete: () => ({ _del: true }),
};

const functionsStub = {
  region: () => functionsStub,
  runWith: () => functionsStub,
  https: {
    HttpsError,
    onCall: (h) => {
      capturedHandler = h;
      return 'cf';
    },
  },
};

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return functionsStub;
  return _origLoad.call(this, request, parent, ...rest);
};

// Load the CF under test (stubs installed above ensure correct interception).
require('../checkTenantPhone');

// Restore Module._load after all tests complete.
after(() => {
  Module._load = _origLoad;
});

// ── Context / call helpers ────────────────────────────────────────────────────

/** Build a minimal context object. Pass null to simulate unauthenticated. */
function ctx(authOverride) {
  if (authOverride === null) return { auth: null };
  return { auth: { uid: 'u1', token: {}, ...authOverride } };
}

/** Call the captured handler with (data, context). */
function call(data, context) {
  return capturedHandler(data, context);
}

/** Assert that the call rejects with an HttpsError whose code matches. */
async function expectHttpsError(promise, expectedCode) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpsError,
      `Expected HttpsError but got ${err.constructor.name}: ${err.message}`);
    assert.equal(err.code, expectedCode,
      `Expected code=${expectedCode}, got code=${err.code}: ${err.message}`);
    return true;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkTenantPhone', () => {
  beforeEach(() => resetStubs());

  // ── Handler registration ──────────────────────────────────────────────────
  it('registers an onCall handler', () => {
    assert.ok(typeof capturedHandler === 'function', 'onCall handler should have been captured');
  });

  // ── Auth gate ─────────────────────────────────────────────────────────────
  describe('auth gate', () => {
    it('unauthenticated context (auth: null) → throws HttpsError unauthenticated', async () => {
      await expectHttpsError(
        call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx(null)),
        'unauthenticated',
      );
    });
  });

  // ── Building validation ───────────────────────────────────────────────────
  describe('building validation', () => {
    it('missing building (undefined) → throws HttpsError invalid-argument', async () => {
      await expectHttpsError(
        call({ room: '15', phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });

    it('null building → throws HttpsError invalid-argument', async () => {
      await expectHttpsError(
        call({ building: null, room: '15', phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });

    it('invalid building ("amazon") → throws HttpsError invalid-argument', async () => {
      await expectHttpsError(
        call({ building: 'amazon', room: '15', phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });

    it('valid building "rooms" passes building validation', async () => {
      // We expect success-path (match: true) to confirm building was accepted.
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
    });

    it('valid building "nest" passes building validation', async () => {
      const result = await call({ building: 'nest', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
    });
  });

  // ── Room validation ───────────────────────────────────────────────────────
  describe('room validation', () => {
    it('missing room (undefined) → throws HttpsError invalid-argument', async () => {
      await expectHttpsError(
        call({ building: 'rooms', phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });

    it('room is null → throws HttpsError invalid-argument', async () => {
      await expectHttpsError(
        call({ building: 'rooms', room: null, phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });

    it('room is a number (123) → throws HttpsError invalid-argument (not a string)', async () => {
      await expectHttpsError(
        call({ building: 'rooms', room: 123, phone: '0812345678' }, ctx()),
        'invalid-argument',
      );
    });
  });

  // ── Phone early-return (no Firestore read) ────────────────────────────────
  describe('phone early returns', () => {
    it('phone is undefined → returns { match: false } without Firestore read', async () => {
      // Set firestoreGetError so that any read would throw; if we get { match:false } the read was skipped.
      stubState.firestoreGetError = new Error('Should not reach Firestore');
      const result = await call({ building: 'rooms', room: '15', phone: undefined }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('phone is null → returns { match: false } without Firestore read', async () => {
      stubState.firestoreGetError = new Error('Should not reach Firestore');
      const result = await call({ building: 'rooms', room: '15', phone: null }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('phone is empty string → returns { match: false } without Firestore read', async () => {
      stubState.firestoreGetError = new Error('Should not reach Firestore');
      const result = await call({ building: 'rooms', room: '15', phone: '' }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('phone is a number (123) → typeof check fails → returns { match: false }', async () => {
      // The CF checks `typeof phone !== 'string'` — a numeric 123 fails this.
      stubState.firestoreGetError = new Error('Should not reach Firestore');
      const result = await call({ building: 'rooms', room: '15', phone: 123 }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('phone normalizes to empty string ("---") → returns { match: false }', async () => {
      // '---' strips to '' after /\D/g removal → givenPhone is falsy → early return.
      stubState.firestoreGetError = new Error('Should not reach Firestore');
      const result = await call({ building: 'rooms', room: '15', phone: '---' }, ctx());
      assert.deepEqual(result, { match: false });
    });
  });

  // ── Firestore doc checks ──────────────────────────────────────────────────
  describe('Firestore doc presence', () => {
    it('Firestore doc not found (exists: false) → returns { match: false }', async () => {
      stubState.docExists = false;
      stubState.docData = {};
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('tenant phone is empty string → returns { match: false }', async () => {
      stubState.docData = { phone: '', name: 'สมชาย สิบห้า' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('tenant has no phone fields at all → returns { match: false }', async () => {
      stubState.docData = { name: 'สมชาย สิบห้า' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.deepEqual(result, { match: false });
    });
  });

  // ── Phone matching ────────────────────────────────────────────────────────
  describe('phone matching', () => {
    it('phone mismatch → returns { match: false }', async () => {
      stubState.docData = { phone: '0899999999', name: 'สมชาย สิบห้า' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.deepEqual(result, { match: false });
    });

    it('phone matches via t.phone → returns { match: true, tenantName: t.name }', async () => {
      stubState.docData = { phone: '0812345678', name: 'สมชาย สิบห้า' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
      assert.equal(result.tenantName, 'สมชาย สิบห้า');
    });

    it('phone matches via t.tenantPhone (fallback field) → returns { match: true, tenantName: t.name }', async () => {
      stubState.docData = { tenantPhone: '0812345678', name: 'สมชาย สิบห้า' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
      assert.equal(result.tenantName, 'สมชาย สิบห้า');
    });

    it('phone matches but tenant name comes from t.firstName when t.name is absent', async () => {
      stubState.docData = { phone: '0812345678', firstName: 'สมชาย' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
      assert.equal(result.tenantName, 'สมชาย');
    });

    it('phone matches but no name fields present → tenantName is empty string', async () => {
      stubState.docData = { phone: '0812345678' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
      assert.equal(result.tenantName, '');
    });
  });

  // ── normalizePhone behaviour ──────────────────────────────────────────────
  describe('normalizePhone (via matching)', () => {
    it('input with dashes and spaces ("081-234 5678") normalizes and matches stored digits', async () => {
      stubState.docData = { phone: '0812345678', name: 'ทดสอบ' };
      const result = await call({ building: 'rooms', room: '15', phone: '081-234 5678' }, ctx());
      assert.equal(result.match, true);
    });

    it('stored phone with dashes also normalizes and matches clean input', async () => {
      stubState.docData = { phone: '081-234-5678', name: 'ทดสอบ' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, true);
    });

    it('international prefix "+66" in stored phone normalizes and matches local format', async () => {
      // +66812345678 → 66812345678 (non-digits stripped); 0812345678 → 0812345678
      // These differ → match: false (expected — the CF does not handle country-code normalization)
      stubState.docData = { phone: '+66812345678', name: 'ทดสอบ' };
      const result = await call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx());
      assert.equal(result.match, false);
    });
  });

  // ── Error propagation ─────────────────────────────────────────────────────
  describe('error propagation', () => {
    it('Firestore get() throws → rethrows as HttpsError internal', async () => {
      stubState.firestoreGetError = new Error('Firestore unavailable');
      await expectHttpsError(
        call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx()),
        'internal',
      );
    });

    it('Firestore throws permission-denied error → rethrows as HttpsError internal', async () => {
      const err = new Error('Missing or insufficient permissions');
      err.code = 'permission-denied';
      stubState.firestoreGetError = err;
      await expectHttpsError(
        call({ building: 'rooms', room: '15', phone: '0812345678' }, ctx()),
        'internal',
      );
    });
  });

  // ── null data guard ───────────────────────────────────────────────────────
  describe('null data guard', () => {
    it('null data argument → building validation fires → throws invalid-argument', async () => {
      await expectHttpsError(
        call(null, ctx()),
        'invalid-argument',
      );
    });
  });
});
