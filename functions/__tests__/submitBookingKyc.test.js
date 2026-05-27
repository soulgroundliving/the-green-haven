'use strict';

/**
 * Unit tests for submitBookingKyc Cloud Function.
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so
 *     Module._load interception must be installed BEFORE the require.
 *   - admin.storage() is called INSIDE the handler — the adminStub returns
 *     a fresh bucket factory each call, allowing per-test error injection.
 *   - admin.firestore.FieldValue is a static method on the function object
 *     (Object.assign pattern used in real Admin SDK).
 *   - All mutable state lives in stubState / captured; resetStubs() is
 *     called in every beforeEach so tests cannot bleed into each other.
 *
 * Run: node --test functions/__tests__/submitBookingKyc.test.js
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ─────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    // Booking document
    bookingExists:      true,
    bookingData: {
      prospectUid: 'Uprospect',
      status:      'paid',
      building:    'rooms',
      roomId:      '15',
    },
    bookingGetError:    null,
    bookingUpdateError: null,
    // Storage
    storageInitError: null,
    storageFiles: [
      { name: 'bookings/BOOK01/kyc/idCardFront.jpg' },
      { name: 'bookings/BOOK01/kyc/idCardBack.jpg' },
    ],
    getFilesError: null,
    ...overrides,
  };
  captured = {
    updateCalls: [],   // data objects passed to bookingRef.update()
    getFilesCalls: [], // { prefix } objects passed to bucket.getFiles()
  };
}

resetStubs();

// ── FieldValue sentinel ────────────────────────────────────────────────────────

const FieldValueSentinel = {
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
};

// ── Firestore stub (module-load-time singleton) ────────────────────────────────
// The CF captures `admin.firestore()` once at the top level, so this object
// must be stable. Per-test variation is achieved through closures that read
// stubState at call time.

const firestoreStub = {
  collection: (name) => ({
    doc: (id) => ({
      get: async () => {
        if (stubState.bookingGetError) throw stubState.bookingGetError;
        return {
          exists: stubState.bookingExists,
          data:   () => stubState.bookingData,
        };
      },
      update: async (data) => {
        if (stubState.bookingUpdateError) throw stubState.bookingUpdateError;
        captured.updateCalls.push(data);
      },
    }),
  }),
};

// ── Admin stub ─────────────────────────────────────────────────────────────────

const adminStub = {
  apps:          [{}],
  initializeApp: () => {},
  // admin.firestore() is called at module load — must return the singleton.
  // admin.firestore.FieldValue is a static attached to the function object.
  firestore: Object.assign(() => firestoreStub, { FieldValue: FieldValueSentinel }),
  // admin.storage() is called INSIDE the handler — factory shape is fine.
  storage: () => ({
    bucket: () => {
      if (stubState.storageInitError) throw stubState.storageInitError;
      return {
        getFiles: async ({ prefix }) => {
          if (stubState.getFilesError) throw stubState.getFilesError;
          captured.getFilesCalls.push({ prefix });
          return [stubState.storageFiles]; // CF does [files] = await bucket.getFiles(...)
        },
      };
    },
  }),
};

// ── firebase-functions/v1 stub ─────────────────────────────────────────────────

let capturedCallHandler = null;

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    return {
      region: () => ({
        https: {
          onCall: (fn) => { capturedCallHandler = fn; return fn; },
          HttpsError,
        },
      }),
      https: { HttpsError },
    };
  }
  return _origLoad.apply(this, arguments);
};

// Load the CF — Module._load intercept is active from this point.
delete require.cache[require.resolve('../submitBookingKyc.js')];
require('../submitBookingKyc.js');

after(() => { Module._load = _origLoad; });

// ── Reusable contexts and data ─────────────────────────────────────────────────

const prospectCtx = { auth: { uid: 'Uprospect', token: { role: 'prospect' } } };
const adminCtx    = { auth: { uid: 'Uadmin',    token: { admin: true } } };
const validData   = { bookingId: 'BOOK01' };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('submitBookingKyc — handler capture', () => {
  it('handler is captured after module load', () => {
    assert.equal(typeof capturedCallHandler, 'function',
      'onCall handler must be captured');
  });
});

describe('submitBookingKyc — auth checks', () => {
  beforeEach(() => { resetStubs(); });

  it('no auth throws unauthenticated', async () => {
    const err = await capturedCallHandler(validData, {}).catch(e => e);
    assert.equal(err.code, 'unauthenticated');
  });

  it('null uid throws unauthenticated', async () => {
    const err = await capturedCallHandler(validData, { auth: { uid: null, token: {} } }).catch(e => e);
    assert.equal(err.code, 'unauthenticated');
  });

  it('non-prospect non-admin (empty token) throws permission-denied', async () => {
    const ctx = { auth: { uid: 'Usome', token: {} } };
    const err = await capturedCallHandler(validData, ctx).catch(e => e);
    assert.equal(err.code, 'permission-denied');
  });

  it('role=tenant (not prospect) throws permission-denied', async () => {
    const ctx = { auth: { uid: 'Utenant', token: { role: 'tenant' } } };
    const err = await capturedCallHandler(validData, ctx).catch(e => e);
    assert.equal(err.code, 'permission-denied');
  });
});

describe('submitBookingKyc — input validation', () => {
  beforeEach(() => { resetStubs(); });

  it('missing bookingId throws invalid-argument', async () => {
    const err = await capturedCallHandler({}, prospectCtx).catch(e => e);
    assert.equal(err.code, 'invalid-argument');
  });

  it('bookingId too short (3 chars) throws invalid-argument', async () => {
    const err = await capturedCallHandler({ bookingId: 'ABC' }, prospectCtx).catch(e => e);
    assert.equal(err.code, 'invalid-argument');
  });

  it('bookingId with special chars throws invalid-argument', async () => {
    const err = await capturedCallHandler({ bookingId: 'BOOK-01!' }, prospectCtx).catch(e => e);
    assert.equal(err.code, 'invalid-argument');
  });

  it('bookingId that is not a string throws invalid-argument', async () => {
    const err = await capturedCallHandler({ bookingId: 12345 }, prospectCtx).catch(e => e);
    assert.equal(err.code, 'invalid-argument');
  });
});

describe('submitBookingKyc — booking checks', () => {
  beforeEach(() => { resetStubs(); });

  it('booking not found throws not-found', async () => {
    resetStubs({ bookingExists: false });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'not-found');
    assert.ok(err.message.includes('BOOK01'));
  });

  it('booking owned by different prospectUid throws permission-denied', async () => {
    resetStubs({ bookingData: { prospectUid: 'Usomeone-else', status: 'paid', building: 'rooms', roomId: '15' } });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'permission-denied');
  });

  it('admin can access booking owned by another prospect (ownership bypass)', async () => {
    resetStubs({ bookingData: { prospectUid: 'Usomeone-else', status: 'paid', building: 'rooms', roomId: '15' } });
    const result = await capturedCallHandler(validData, adminCtx);
    assert.equal(result.success, true);
  });

  it('booking status locked throws failed-precondition', async () => {
    resetStubs({ bookingData: { prospectUid: 'Uprospect', status: 'locked', building: 'rooms', roomId: '15' } });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'failed-precondition');
    assert.ok(err.message.includes('locked'));
  });

  it('booking status expired throws failed-precondition', async () => {
    resetStubs({ bookingData: { prospectUid: 'Uprospect', status: 'expired', building: 'rooms', roomId: '15' } });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'failed-precondition');
    assert.ok(err.message.includes('expired'));
  });

  it('booking status kyc_pending is allowed (re-submission)', async () => {
    resetStubs({ bookingData: { prospectUid: 'Uprospect', status: 'kyc_pending', building: 'rooms', roomId: '15' } });
    const result = await capturedCallHandler(validData, prospectCtx);
    assert.equal(result.success, true);
  });
});

describe('submitBookingKyc — storage errors', () => {
  beforeEach(() => { resetStubs(); });

  it('storage init error throws internal', async () => {
    resetStubs({ storageInitError: new Error('bucket not configured') });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'internal');
    assert.ok(err.message.includes('Storage not initialized'));
  });

  it('getFiles error throws internal', async () => {
    resetStubs({ getFilesError: new Error('network error') });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'internal');
    assert.ok(err.message.includes('Could not list KYC files'));
  });
});

describe('submitBookingKyc — required docs check', () => {
  beforeEach(() => { resetStubs(); });

  it('missing idCardFront throws failed-precondition mentioning idCardFront', async () => {
    resetStubs({
      storageFiles: [
        { name: 'bookings/BOOK01/kyc/idCardBack.jpg' },
      ],
    });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'failed-precondition');
    assert.ok(err.message.includes('idCardFront'), `expected 'idCardFront' in: ${err.message}`);
  });

  it('missing idCardBack throws failed-precondition mentioning idCardBack', async () => {
    resetStubs({
      storageFiles: [
        { name: 'bookings/BOOK01/kyc/idCardFront.jpg' },
      ],
    });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'failed-precondition');
    assert.ok(err.message.includes('idCardBack'), `expected 'idCardBack' in: ${err.message}`);
  });

  it('missing both required docs throws failed-precondition with both names', async () => {
    resetStubs({ storageFiles: [] });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'failed-precondition');
    assert.ok(err.message.includes('idCardFront'));
    assert.ok(err.message.includes('idCardBack'));
  });

  it('unknown file stems (not in KYC_TYPES) are ignored', async () => {
    resetStubs({
      storageFiles: [
        { name: 'bookings/BOOK01/kyc/idCardFront.jpg' },
        { name: 'bookings/BOOK01/kyc/idCardBack.jpg' },
        { name: 'bookings/BOOK01/kyc/unknownDoc.jpg' },
        { name: 'bookings/BOOK01/kyc/randomFile.pdf' },
      ],
    });
    const result = await capturedCallHandler(validData, prospectCtx);
    assert.equal(result.success, true);
    assert.ok(!result.uploadedTypes.includes('unknownDoc'));
    assert.ok(!result.uploadedTypes.includes('randomFile'));
  });
});

describe('submitBookingKyc — success path', () => {
  beforeEach(() => { resetStubs(); });

  it('returns success:true with bookingId, status kyc_pending, and uploadedTypes', async () => {
    const result = await capturedCallHandler(validData, prospectCtx);
    assert.equal(result.success, true);
    assert.equal(result.bookingId, 'BOOK01');
    assert.equal(result.status, 'kyc_pending');
    assert.ok(Array.isArray(result.uploadedTypes));
    assert.ok(result.uploadedTypes.includes('idCardFront'));
    assert.ok(result.uploadedTypes.includes('idCardBack'));
  });

  it('all 4 KYC types present — uploadedTypes includes all four', async () => {
    resetStubs({
      storageFiles: [
        { name: 'bookings/BOOK01/kyc/idCardFront.jpg' },
        { name: 'bookings/BOOK01/kyc/idCardBack.jpg' },
        { name: 'bookings/BOOK01/kyc/houseReg.jpg' },
        { name: 'bookings/BOOK01/kyc/employmentLetter.pdf' },
      ],
    });
    const result = await capturedCallHandler(validData, prospectCtx);
    assert.equal(result.success, true);
    assert.equal(result.uploadedTypes.length, 4);
    assert.ok(result.uploadedTypes.includes('idCardFront'));
    assert.ok(result.uploadedTypes.includes('idCardBack'));
    assert.ok(result.uploadedTypes.includes('houseReg'));
    assert.ok(result.uploadedTypes.includes('employmentLetter'));
  });

  it('bookingRef.update called with status kyc_pending and kycDocsTypes', async () => {
    await capturedCallHandler(validData, prospectCtx);
    assert.equal(captured.updateCalls.length, 1, 'update must be called exactly once');
    const payload = captured.updateCalls[0];
    assert.equal(payload.status, 'kyc_pending');
    assert.ok(Array.isArray(payload.kycDocsTypes));
    assert.ok(payload.kycDocsTypes.includes('idCardFront'));
    assert.ok(payload.kycDocsTypes.includes('idCardBack'));
  });

  it('bookingRef.update includes kycDocsPath, kycSubmittedAt, updatedAt', async () => {
    await capturedCallHandler(validData, prospectCtx);
    const payload = captured.updateCalls[0];
    assert.equal(payload.kycDocsPath, 'bookings/BOOK01/kyc/');
    assert.deepEqual(payload.kycSubmittedAt, { _type: 'serverTimestamp' });
    assert.deepEqual(payload.updatedAt, { _type: 'serverTimestamp' });
  });

  it('getFiles called with the correct prefix', async () => {
    await capturedCallHandler(validData, prospectCtx);
    assert.equal(captured.getFilesCalls.length, 1);
    assert.equal(captured.getFilesCalls[0].prefix, 'bookings/BOOK01/kyc/');
  });

  it('bookingRef.update error throws internal', async () => {
    resetStubs({ bookingUpdateError: new Error('quota exceeded') });
    const err = await capturedCallHandler(validData, prospectCtx).catch(e => e);
    assert.equal(err.code, 'internal');
    assert.ok(err.message.includes('Could not update booking status'));
  });
});
