/**
 * Unit tests for cancelFacilityBooking.
 * Run: node --test functions/__tests__/cancelFacilityBooking.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────
// Using closure variables so the stub captured at module-load time still reads
// the current value set inside each test (per §7-NN harness pattern).
let stubBooking = null;   // null  → doc does not exist; object → doc data
let capturedUpdate = null;

function resetStubs() {
  stubBooking    = null;
  capturedUpdate = null;
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

// ── Module interception (must happen BEFORE require('../cancelFacilityBooking')) ──
const Module    = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    // The CF does: const firestore = admin.firestore();  at module load.
    // firestoreFn() returns an object whose .collection().doc().get() reads
    // stubBooking at call-time via closure, so it stays current across tests.
    const firestoreFn = () => ({
      collection: (name) => ({
        doc: (docId) => ({
          get: async () => ({
            exists: stubBooking !== null,
            data:   () => (stubBooking || {}),
          }),
          // The CF calls ref.update(...) on the doc ref directly (not snap.ref)
          update: async (payload) => {
            capturedUpdate = payload;
          },
        }),
      }),
    });

    // The CF references admin.firestore.FieldValue.serverTimestamp() — attach
    // FieldValue directly on the function object (mirrors real Admin SDK shape).
    firestoreFn.FieldValue = {
      serverTimestamp: () => SERVER_TS,
      delete:          () => '__DELETE__',
    };

    return {
      apps:          [{}],      // truthy → skips initializeApp branch
      initializeApp: () => {},
      firestore:     firestoreFn,
    };
  }

  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) {
        super(msg);
        this.code = code;
      }
    }
    return {
      // .region(...).https.onCall(handler) → returns handler directly so tests
      // can call it with (data, context) as a plain async function.
      region: () => ({ https: { onCall: (h) => h } }),
      https:  { HttpsError },
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

// Require AFTER stubs are registered so module-load-time side effects see them.
const { cancelFacilityBooking: handler } = require('../cancelFacilityBooking');

// ── Context helpers ───────────────────────────────────────────────────────────
function ctx({ uid = 'my-uid', admin = false } = {}) {
  const token = { admin };
  return { auth: { uid, token } };
}

const FUTURE_DATE = '2099-01-01';
const PAST_DATE   = '2020-01-01';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('cancelFacilityBooking', () => {
  beforeEach(resetStubs);

  // 1. Auth gate
  it('throws unauthenticated when no auth', async () => {
    await assert.rejects(
      () => handler({ bookingId: 'BK1' }, { auth: null }),
      (e) => e.code === 'unauthenticated' && /Sign-in required/i.test(e.message),
    );
  });

  // 2. Input validation
  it('throws invalid-argument when bookingId is missing', async () => {
    await assert.rejects(
      () => handler({}, ctx()),
      (e) => e.code === 'invalid-argument' && /bookingId/i.test(e.message),
    );
  });

  it('throws invalid-argument when bookingId is not a string', async () => {
    await assert.rejects(
      () => handler({ bookingId: 42 }, ctx()),
      (e) => e.code === 'invalid-argument',
    );
  });

  // 3. Not found
  it('throws not-found when booking does not exist', async () => {
    stubBooking = null; // doc.exists === false
    await assert.rejects(
      () => handler({ bookingId: 'BK_MISSING' }, ctx()),
      (e) => e.code === 'not-found' && /Booking not found/i.test(e.message),
    );
  });

  // 4. Wrong status
  it('throws failed-precondition when booking is already cancelled', async () => {
    stubBooking = { status: 'cancelled', tenantUid: 'my-uid', date: FUTURE_DATE };
    await assert.rejects(
      () => handler({ bookingId: 'BK1' }, ctx({ uid: 'my-uid' })),
      (e) => e.code === 'failed-precondition' && /already cancelled/i.test(e.message),
    );
  });

  it('throws failed-precondition when booking is already completed', async () => {
    stubBooking = { status: 'completed', tenantUid: 'my-uid', date: FUTURE_DATE };
    await assert.rejects(
      () => handler({ bookingId: 'BK1' }, ctx({ uid: 'my-uid' })),
      (e) => e.code === 'failed-precondition' && /already completed/i.test(e.message),
    );
  });

  // 5. Ownership check
  it('throws permission-denied when tenant cancels another tenant\'s booking', async () => {
    stubBooking = { status: 'confirmed', tenantUid: 'other-uid', date: FUTURE_DATE };
    await assert.rejects(
      () => handler({ bookingId: 'BK1' }, ctx({ uid: 'my-uid', admin: false })),
      (e) => e.code === 'permission-denied' && /own bookings/i.test(e.message),
    );
  });

  // 6. Past-date guard
  it('throws failed-precondition for a past-date booking', async () => {
    stubBooking = { status: 'confirmed', tenantUid: 'my-uid', date: PAST_DATE };
    await assert.rejects(
      () => handler({ bookingId: 'BK1' }, ctx({ uid: 'my-uid' })),
      (e) => e.code === 'failed-precondition' && /past booking/i.test(e.message),
    );
  });

  // 7. Tenant success path
  it('tenant cancels own future booking → returns { cancelled: true }', async () => {
    stubBooking = { status: 'confirmed', tenantUid: 'my-uid', date: FUTURE_DATE };
    const result = await handler({ bookingId: 'BK1' }, ctx({ uid: 'my-uid', admin: false }));

    assert.deepEqual(result, { cancelled: true });
    assert.ok(capturedUpdate, 'ref.update must be called');
    assert.equal(capturedUpdate.status,      'cancelled');
    assert.equal(capturedUpdate.cancelledBy, 'tenant');
    assert.equal(capturedUpdate.updatedAt,   SERVER_TS);
  });

  // 8. Admin success path
  it('admin cancels any future booking → cancelledBy = admin', async () => {
    stubBooking = { status: 'confirmed', tenantUid: 'other-uid', date: FUTURE_DATE };
    const result = await handler({ bookingId: 'BK1' }, ctx({ uid: 'admin-uid', admin: true }));

    assert.deepEqual(result, { cancelled: true });
    assert.ok(capturedUpdate, 'ref.update must be called');
    assert.equal(capturedUpdate.status,      'cancelled');
    assert.equal(capturedUpdate.cancelledBy, 'admin');
    assert.equal(capturedUpdate.updatedAt,   SERVER_TS);
  });

  // 9. Admin bypasses ownership — explicit confirmation
  it('admin flag bypasses ownership check entirely', async () => {
    stubBooking = { status: 'confirmed', tenantUid: 'some-other-tenant', date: FUTURE_DATE };
    // Would throw permission-denied if admin flag were ignored
    const result = await handler({ bookingId: 'BK99' }, ctx({ uid: 'admin-uid', admin: true }));
    assert.deepEqual(result, { cancelled: true });
    assert.equal(capturedUpdate.cancelledBy, 'admin');
  });

  // 10. Today's booking is NOT past (boundary: date === today is allowed)
  it('booking dated today is not rejected as past', async () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    stubBooking = { status: 'confirmed', tenantUid: 'my-uid', date: todayISO };
    const result = await handler({ bookingId: 'BK_TODAY' }, ctx({ uid: 'my-uid' }));
    assert.deepEqual(result, { cancelled: true });
  });
});
