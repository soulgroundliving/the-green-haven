'use strict';

/**
 * Unit tests for createBookingLock.
 * Run: node --test functions/__tests__/createBookingLock.test.js
 *
 * Harness strategy (§7-NN pattern):
 *   - Module._load intercepts ALL dependencies BEFORE require('../createBookingLock')
 *   - Stub state lives in closure variables so each test's resetStubs() call
 *     is seen by stubs already captured at module-load time
 *   - admin.firestore() is called at module load → returns firestoreInstance closure
 *   - admin.database() is called INSIDE the handler → separate stub
 *   - Transaction uses a two-get sequence: (1) bookings query, (2) tenant doc
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // buildingRegistry
    validBuildings: new Set(['rooms', 'nest']),
    // _rateLimit
    rateLimitError: null,
    // RTDB rooms_config
    roomConfigVal: { id: '15', rentPrice: 3000, deposit: 6000 },
    roomConfigReadError: null,
    // Firestore buildings doc (for promptPayId)
    buildingDocExists: true,
    buildingDocData: { promptPayId: '0812345678' },
    buildingDocReadError: null,
    // promptpay stub
    qrPayload: 'MOCK_QR_PAYLOAD',
    promptPayError: null,
    // Transaction
    existingBookingDocs: [],   // docs that conflict (active status)
    tenantDocExists: false,
    tenantDocData: { tenantId: '' },
    isActiveTenantResult: false,
    txError: null,
    newBookingId: 'NEWBOOK001',
    ...overrides,
  };
  captured = {
    txSetCalls: [],     // { ref, data }
    rateLimitCalls: [], // { uid, action, limit, window }
  };
}
resetStubs();

// ── Firestore static sentinels ────────────────────────────────────────────────

const TimestampSentinel = {
  fromMillis: (ms) => ({ _type: 'Timestamp', ms }),
  fromDate: (d) => ({ _type: 'Timestamp', date: d.toISOString() }),
};
const FieldValueSentinel = {
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
};

// ── Firestore transaction stub ────────────────────────────────────────────────
// Mirrors the two-get sequence inside the CF:
//   get #1 → bookings query (conflict check)
//   get #2 → tenant doc ref

function makeTxStub() {
  let getCallIndex = 0;
  return {
    get: async (_refOrQuery) => {
      getCallIndex += 1;
      if (getCallIndex === 1) {
        // bookings query — returns docs matching existingBookingDocs
        return {
          docs: stubState.existingBookingDocs.map((d) => ({ data: () => d })),
        };
      }
      // tenant doc
      return {
        exists: stubState.tenantDocExists,
        data: () => stubState.tenantDocData,
      };
    },
    set: (ref, data) => {
      captured.txSetCalls.push({ ref, data });
    },
  };
}

// ── Firestore instance stub ───────────────────────────────────────────────────
// Captured at module-load time via admin.firestore().

const firestoreInstance = {
  collection: (name) => {
    if (name === 'bookings') {
      return {
        // chainable where() for the query object passed to tx.get
        where: function () { return this; },
        // bookingsRef.doc() inside the transaction → new doc ref
        doc: () => ({ id: stubState.newBookingId }),
      };
    }
    if (name === 'tenants') {
      return {
        doc: () => ({
          collection: () => ({
            doc: () => ({}), // tenantRef — tx.get intercepts the actual read
          }),
        }),
      };
    }
    return {
      doc: () => ({
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    };
  },
  doc: (_path) => ({
    get: async () => {
      if (stubState.buildingDocReadError) throw stubState.buildingDocReadError;
      return {
        exists: stubState.buildingDocExists,
        data: () => stubState.buildingDocData,
      };
    },
  }),
  runTransaction: async (cb) => {
    if (stubState.txError) throw stubState.txError;
    return cb(makeTxStub());
  },
};

// ── RTDB stub (admin.database() called inside handler) ───────────────────────

const rtdbInstance = {
  ref: (_path) => ({
    once: async (_event) => {
      if (stubState.roomConfigReadError) throw stubState.roomConfigReadError;
      return { val: () => stubState.roomConfigVal };
    },
  }),
};

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => firestoreInstance, {
    Timestamp: TimestampSentinel,
    FieldValue: FieldValueSentinel,
  }),
  database: () => rtdbInstance,
};

// ── Module interception (must be set up BEFORE require('../createBookingLock')) ─

let capturedCallHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) {
        super(msg);
        this.code = code;
      }
    }
    return {
      region: () => ({
        https: {
          onCall: (fn) => {
            capturedCallHandler = fn;
            return fn;
          },
          HttpsError,
        },
      }),
      https: { HttpsError },
    };
  }

  if (
    request === './buildingRegistry' ||
    request.replace(/\\/g, '/').endsWith('/buildingRegistry')
  ) {
    return { getValidBuildings: async () => stubState.validBuildings };
  }

  if (
    request === './_rateLimit' ||
    request.replace(/\\/g, '/').endsWith('/_rateLimit')
  ) {
    return {
      checkRateLimit: async (uid, action, limit, window) => {
        captured.rateLimitCalls.push({ uid, action, limit, window });
        if (stubState.rateLimitError) throw stubState.rateLimitError;
      },
    };
  }

  if (
    request === './promptpay' ||
    request.replace(/\\/g, '/').endsWith('/promptpay')
  ) {
    return {
      buildPromptPayPayload: (_phone, _amount) => {
        if (stubState.promptPayError) throw stubState.promptPayError;
        return stubState.qrPayload;
      },
    };
  }

  if (
    request === './_occupancy' ||
    request.replace(/\\/g, '/').endsWith('/_occupancy')
  ) {
    return {
      isActiveTenant: (_td) => stubState.isActiveTenantResult,
    };
  }

  return _origLoad.apply(this, arguments);
};

// Clear any prior require cache entry and load the CF under test
delete require.cache[require.resolve('../createBookingLock.js')];
require('../createBookingLock.js');

after(() => {
  Module._load = _origLoad;
});

// ── Context + data helpers ────────────────────────────────────────────────────

const prospectCtx = {
  auth: {
    uid: 'Uprospect',
    token: { role: 'prospect', lineUserId: 'Uline123' },
  },
};

const adminCtx = {
  auth: {
    uid: 'Uadmin',
    token: { admin: true },
  },
};

// A date 60 days from now — comfortably satisfies the 30-day early-bird window
const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
const futureDateStr = futureDate.toISOString().slice(0, 10); // YYYY-MM-DD

// A date only 5 days away — does NOT meet the early-bird threshold
const nearFutureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
const nearFutureDateStr = nearFutureDate.toISOString().slice(0, 10);

const validData = {
  building: 'rooms',
  roomId: '15',
  startDate: futureDateStr,
  durationMonths: 6,
  prospectName: 'สมชาย ทดสอบ',
  prospectPhone: '0812345678',
  consentAccepted: true,   // PDPA §19 — prospects must accept before booking (Roadmap 1.4 Slice C)
  consentVersion: 'v1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createBookingLock', () => {
  beforeEach(resetStubs);

  // 1. Handler captured
  it('handler is captured by onCall interceptor', () => {
    assert.ok(
      typeof capturedCallHandler === 'function',
      'capturedCallHandler must be a function after module load',
    );
  });

  // 2. No auth → unauthenticated
  it('throws unauthenticated when context.auth is null', async () => {
    await assert.rejects(
      () => capturedCallHandler(validData, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  // 3. Signed in but no prospect/admin role → permission-denied
  it('throws permission-denied for signed-in user with no prospect or admin role', async () => {
    const noRoleCtx = {
      auth: { uid: 'Uregular', token: { role: 'tenant' } },
    };
    await assert.rejects(
      () => capturedCallHandler(validData, noRoleCtx),
      (e) => e.code === 'permission-denied',
    );
  });

  // 4. Prospect: rate-limit check IS called
  it('calls checkRateLimit for a prospect caller', async () => {
    await capturedCallHandler(validData, prospectCtx);
    assert.equal(captured.rateLimitCalls.length, 1);
    assert.equal(captured.rateLimitCalls[0].uid, 'Uprospect');
    assert.equal(captured.rateLimitCalls[0].action, 'createBookingLock');
    assert.equal(captured.rateLimitCalls[0].limit, 3);
  });

  // 5. Admin: rate-limit check is NOT called
  it('does not call checkRateLimit for an admin caller', async () => {
    await capturedCallHandler(validData, adminCtx);
    assert.equal(captured.rateLimitCalls.length, 0);
  });

  // 6. Missing building → invalid-argument
  it('throws invalid-argument when building is missing', async () => {
    const { building: _omit, ...noBuilding } = validData;
    await assert.rejects(
      () => capturedCallHandler(noBuilding, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  // 7. Missing roomId → invalid-argument
  it('throws invalid-argument when roomId is missing', async () => {
    const { roomId: _omit, ...noRoomId } = validData;
    await assert.rejects(
      () => capturedCallHandler(noRoomId, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  // 8. Missing startDate → invalid-argument
  it('throws invalid-argument when startDate is missing', async () => {
    const { startDate: _omit, ...noStartDate } = validData;
    await assert.rejects(
      () => capturedCallHandler(noStartDate, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  // 9. Unknown building → invalid-argument mentioning building
  it('throws invalid-argument for an unknown building', async () => {
    const badData = { ...validData, building: 'unknown_bldg' };
    await assert.rejects(
      () => capturedCallHandler(badData, prospectCtx),
      (e) => e.code === 'invalid-argument' && /unknown building/i.test(e.message),
    );
  });

  // 10. Invalid durationMonths (5 is not in [3,6,12,24]) → invalid-argument
  it('throws invalid-argument for durationMonths not in VALID_DURATIONS', async () => {
    const badData = { ...validData, durationMonths: 5 };
    await assert.rejects(
      () => capturedCallHandler(badData, prospectCtx),
      (e) => e.code === 'invalid-argument' && /durationMonths/i.test(e.message),
    );
  });

  // 11. Invalid startDate format (no dashes) → invalid-argument
  it('throws invalid-argument when startDate is not YYYY-MM-DD', async () => {
    const badData = { ...validData, startDate: '20260101' };
    await assert.rejects(
      () => capturedCallHandler(badData, prospectCtx),
      (e) => e.code === 'invalid-argument' && /startDate/i.test(e.message),
    );
  });

  // 12. Room not found (roomConfigVal returns empty object, no .id field)
  it('throws not-found when room does not exist in rooms_config', async () => {
    resetStubs({ roomConfigVal: {} });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) => e.code === 'not-found',
    );
  });

  // 13. Room deleted flag set → failed-precondition
  it('throws failed-precondition when room has been deleted', async () => {
    resetStubs({
      roomConfigVal: { id: '15', deleted: true, rentPrice: 3000, deposit: 6000 },
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition' && /removed/i.test(e.message),
    );
  });

  // 14. Room has rentPrice = 0 → failed-precondition about rent price
  it('throws failed-precondition when room rentPrice is 0', async () => {
    resetStubs({
      roomConfigVal: { id: '15', rentPrice: 0, deposit: 6000 },
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition' && /rent price/i.test(e.message),
    );
  });

  // 15. Building has no promptPayId → failed-precondition
  it('throws failed-precondition when building has no promptPayId configured', async () => {
    resetStubs({
      buildingDocExists: true,
      buildingDocData: { promptPayId: '' }, // empty string → falsy
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) =>
        e.code === 'failed-precondition' &&
        /PromptPay not configured/i.test(e.message),
    );
  });

  // 16. Conflicting active booking in transaction → failed-precondition
  it('throws failed-precondition when room is currently locked by another booking', async () => {
    resetStubs({
      existingBookingDocs: [
        {
          status: 'locked',
          lockedUntil: { toMillis: () => Date.now() + 600000 }, // active lock
        },
      ],
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) =>
        e.code === 'failed-precondition' &&
        /held or booked/i.test(e.message),
    );
  });

  // 17. Active tenant in room → failed-precondition about occupied
  it('throws failed-precondition when room is currently occupied by a tenant', async () => {
    resetStubs({
      existingBookingDocs: [],
      tenantDocExists: true,
      tenantDocData: { tenantId: 't-15', name: 'สมชาย' },
      isActiveTenantResult: true,
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) =>
        e.code === 'failed-precondition' &&
        /currently occupied/i.test(e.message),
    );
  });

  // 18. SUCCESS — returns the full booking response shape
  it('success: returns bookingId, qrPayload, qrAmount, monthlyRent, lockedUntil, earlyBirdEligible, earlyBirdPoints', async () => {
    const result = await capturedCallHandler(validData, prospectCtx);

    assert.equal(result.bookingId, stubState.newBookingId);
    assert.equal(result.qrPayload, stubState.qrPayload);
    assert.equal(result.qrAmount, 3000 * 2);  // depositAmount = monthlyRent * 2
    assert.equal(result.monthlyRent, 3000);
    assert.ok(typeof result.lockedUntil === 'number', 'lockedUntil must be a number (ms)');
    assert.ok(result.lockedUntil > Date.now(), 'lockedUntil must be in the future');
    assert.ok('earlyBirdEligible' in result);
    assert.ok('earlyBirdPoints' in result);
  });

  // 19. Early bird: building=nest + startDate 60 days away → earlyBirdEligible=true
  it('earlyBirdEligible=true and earlyBirdPoints=500 for nest with start date 60 days away', async () => {
    const nestData = {
      ...validData,
      building: 'nest',
      startDate: futureDateStr, // 60 days from now — exceeds EARLY_BIRD_WINDOW_DAYS (30)
    };
    const result = await capturedCallHandler(nestData, prospectCtx);

    assert.equal(result.earlyBirdEligible, true);
    assert.equal(result.earlyBirdPoints, 500);
  });

  // 20. NOT early bird: building=rooms → earlyBirdEligible=false even with a far future date
  it('earlyBirdEligible=false and earlyBirdPoints=0 for rooms building regardless of start date', async () => {
    const roomsData = {
      ...validData,
      building: 'rooms',
      startDate: futureDateStr, // far future, but not nest
    };
    const result = await capturedCallHandler(roomsData, prospectCtx);

    assert.equal(result.earlyBirdEligible, false);
    assert.equal(result.earlyBirdPoints, 0);
  });

  // Bonus: success also writes exactly one tx.set call with correct shape
  it('success: tx.set is called once with correct booking doc fields', async () => {
    await capturedCallHandler(validData, prospectCtx);

    assert.equal(captured.txSetCalls.length, 1);
    const { ref, data } = captured.txSetCalls[0];
    assert.equal(ref.id, stubState.newBookingId);
    assert.equal(data.building, 'rooms');
    assert.equal(data.roomId, '15');
    assert.equal(data.monthlyRent, 3000);
    assert.equal(data.depositAmount, 6000); // 3000 * 2
    assert.equal(data.status, 'locked');
    assert.equal(data.prospectUid, 'Uprospect');
    assert.ok(data.lockedUntil, 'lockedUntil sentinel must be set');
    assert.ok(data.startDate, 'startDate sentinel must be set');
    assert.deepEqual(data.createdAt, { _type: 'serverTimestamp' });
    assert.deepEqual(data.updatedAt, { _type: 'serverTimestamp' });
  });

  // Bonus: expired lock (lockedUntil in the past) does NOT block a new booking
  it('expired lock (lockedUntil in the past) does not block new booking', async () => {
    resetStubs({
      existingBookingDocs: [
        {
          status: 'locked',
          lockedUntil: { toMillis: () => Date.now() - 1000 }, // expired lock
        },
      ],
    });
    const result = await capturedCallHandler(validData, prospectCtx);
    assert.equal(result.bookingId, stubState.newBookingId);
  });

  // Bonus: paid/kyc_pending/kyc_approved statuses (no lockedUntil check) always block
  it('booking with status=paid blocks new lock regardless of lockedUntil', async () => {
    resetStubs({
      existingBookingDocs: [{ status: 'paid' }],
    });
    await assert.rejects(
      () => capturedCallHandler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });

  // Bonus: near-future date (5 days) with nest still does NOT qualify for early bird
  it('earlyBirdEligible=false for nest when start date is only 5 days away', async () => {
    const nestNearData = {
      ...validData,
      building: 'nest',
      startDate: nearFutureDateStr, // 5 days — below 30-day threshold
    };
    const result = await capturedCallHandler(nestNearData, prospectCtx);

    assert.equal(result.earlyBirdEligible, false);
    assert.equal(result.earlyBirdPoints, 0);
  });

  // ── PDPA consent gate (Roadmap 1.4 Slice C) ──────────────────────────────────

  // Prospect omits consent → invalid-argument (server-side fence behind the checkbox)
  it('throws invalid-argument when a prospect omits consentAccepted', async () => {
    const { consentAccepted: _c, consentVersion: _cv, ...noConsent } = validData;
    await assert.rejects(
      () => capturedCallHandler(noConsent, prospectCtx),
      (e) => e.code === 'invalid-argument' && /ยอมรับ|consent/i.test(e.message),
    );
  });

  // Prospect explicitly declines → invalid-argument
  it('throws invalid-argument when a prospect sends consentAccepted=false', async () => {
    await assert.rejects(
      () => capturedCallHandler({ ...validData, consentAccepted: false }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  // Success: the booking doc records the consent proof (PDPA §19 record-of-proof)
  it('success: booking doc records consentAcceptedAt + consentVersion', async () => {
    await capturedCallHandler({ ...validData, consentVersion: 'v1' }, prospectCtx);
    assert.equal(captured.txSetCalls.length, 1);
    const { data } = captured.txSetCalls[0];
    assert.deepEqual(data.consentAcceptedAt, { _type: 'serverTimestamp' });
    assert.equal(data.consentVersion, 'v1');
  });

  // Admin on-behalf booking is exempt from the consent gate (paper-contract basis)
  it('admin booking succeeds without consentAccepted (on-behalf exemption)', async () => {
    const { consentAccepted: _c, consentVersion: _cv, ...noConsent } = validData;
    const result = await capturedCallHandler(noConsent, adminCtx);
    assert.equal(result.bookingId, stubState.newBookingId);
    // No consent supplied → recorded as null, not a serverTimestamp sentinel
    assert.equal(captured.txSetCalls[0].data.consentAcceptedAt, null);
    assert.equal(captured.txSetCalls[0].data.consentVersion, null);
  });
});
