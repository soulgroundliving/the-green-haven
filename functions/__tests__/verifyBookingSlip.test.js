'use strict';
/**
 * Unit tests for verifyBookingSlip.js — onCall handler for deposit slip verification.
 *
 * Covers: auth gate, input validation, booking ownership/status checks, rate limiting,
 * base64 decode, SlipOK API call, amount validation, transactionId safety, atomic dedup,
 * storage upload (non-fatal), booking update, and the SCB-delay retryable path.
 *
 * Run: node --test functions/__tests__/verifyBookingSlip.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Per-test mutable state ────────────────────────────────────────────────────
let slipOkApiResponse;
let rateLimitState;           // keyed by doc id; null value = doc doesn't exist
let verifiedSlipsCreateShouldThrow;
let bookingSnapState;         // null = booking doc doesn't exist
let storageUploadShouldThrow;
let bookingUpdateArgs;
let verifiedSlipCreateArgs;
let slipOkFetchCalled;
let capturedFetchOpts;         // { method, headers, body } passed to fetch (§7-YY guard)

function resetStubs() {
  slipOkApiResponse = {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      success: true,
      data: {
        transactionId: 'TXN123456',
        amount: 3000,
        sender: { displayName: 'Alice' },
        receiver: { displayName: 'Bob' },
        date: '2026-05-01',
        sendingBankCode: '014',
      },
    }),
  };
  rateLimitState = {};        // empty = all docs don't exist → fresh window → allowed
  verifiedSlipsCreateShouldThrow = null;
  bookingSnapState = null;    // null = booking not found by default
  storageUploadShouldThrow = null;
  bookingUpdateArgs = null;
  verifiedSlipCreateArgs = null;
  slipOkFetchCalled = false;
  capturedFetchOpts = null;
}
resetStubs();

// ── Firestore doc factory ─────────────────────────────────────────────────────
function makeDocRef(data, { shouldExist = true } = {}) {
  return {
    get: async () => ({ exists: shouldExist, data: () => data }),
    update: async (args) => { bookingUpdateArgs = args; },
    create: async (args) => {
      if (verifiedSlipsCreateShouldThrow) throw verifiedSlipsCreateShouldThrow;
      verifiedSlipCreateArgs = args;
    },
  };
}

// ── Stubs ─────────────────────────────────────────────────────────────────────
const fsInstance = {
  collection: (coll) => ({
    doc: (id) => {
      if (coll === 'bookings') {
        const exists = bookingSnapState !== null;
        return {
          get: async () => ({ exists, data: () => bookingSnapState }),
          update: async (args) => { bookingUpdateArgs = args; },
        };
      }
      if (coll === 'rateLimits') {
        const existing = rateLimitState[id] !== undefined ? rateLimitState[id] : null;
        return {
          get: async () => ({ exists: existing !== null, data: () => existing }),
          set: async () => {},
          update: async () => {},
        };
      }
      if (coll === 'verifiedSlips') {
        return {
          create: async (args) => {
            if (verifiedSlipsCreateShouldThrow) throw verifiedSlipsCreateShouldThrow;
            verifiedSlipCreateArgs = args;
          },
        };
      }
      return makeDocRef({});
    },
  }),
};

const storageInstance = {
  bucket: () => ({
    file: () => ({
      save: async () => {
        if (storageUploadShouldThrow) throw storageUploadShouldThrow;
      },
    }),
  }),
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TS',
      delete: () => 'DEL',
      increment: (n) => n,
    },
    Timestamp: { fromMillis: (ms) => ms },
  }),
  storage: () => storageInstance,
};

const fetchStub = async (url, opts) => {
  slipOkFetchCalled = true;
  capturedFetchOpts = opts || null;
  return slipOkApiResponse;
};

const HttpsError = class extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
};

let capturedHandler;
const functionsStub = {
  region: () => functionsStub,
  runWith: () => functionsStub,
  https: {
    onCall: (h) => { capturedHandler = h; return 'cf'; },
    HttpsError,
  },
};

const paramStub = {
  defineSecret: () => ({ value: () => 'apikey123' }),
  defineString: () => ({ value: () => 'https://slipok.example.com' }),
};

// ── Module interception (must happen before require) ──────────────────────────
const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return adminStub;
  if (req === 'firebase-functions/v1') return functionsStub;
  if (req === 'firebase-functions/params') return paramStub;
  // NO 'form-data' interception — callSlipOKAPI uses global FormData + Blob (§7-YY).
  return _origLoad.call(this, req, parent, isMain);
};

global.fetch = fetchStub;

// Require after stubs are wired
require('../verifyBookingSlip');
const handler = capturedHandler;

// ── Shared fixtures ───────────────────────────────────────────────────────────
const prospectCtx = { auth: { uid: 'u1', token: { role: 'prospect' } } };
const adminCtx    = { auth: { uid: 'admin1', token: { admin: true } } };

// Valid base64 payload — decodes to 200 bytes, well above the 100-byte minimum
const validFile = Buffer.from('x'.repeat(200)).toString('base64');

function seedBooking(overrides = {}) {
  bookingSnapState = {
    prospectUid: 'u1',
    status: 'locked',
    lockedUntil: { toMillis: () => Date.now() + 3_600_000 },
    depositAmount: 3000,
    building: 'rooms',
    roomId: '15',
    ...overrides,
  };
}

const validData = { bookingId: 'BOOK1234', file: validFile };

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('verifyBookingSlip — auth', () => {
  beforeEach(resetStubs);

  it('1. no auth → unauthenticated', async () => {
    seedBooking();
    await assert.rejects(
      () => handler(validData, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('2. auth present but not admin and not prospect → permission-denied', async () => {
    seedBooking();
    await assert.rejects(
      () => handler(validData, { auth: { uid: 'u1', token: { role: 'tenant' } } }),
      (e) => e.code === 'permission-denied',
    );
  });

  it('3. admin=true → allowed (no ownership check)', async () => {
    seedBooking({ prospectUid: 'someone_else' });
    const result = await handler(validData, adminCtx);
    assert.equal(result.success, true);
  });

  it('4. role=prospect → allowed', async () => {
    seedBooking();
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────
describe('verifyBookingSlip — input validation', () => {
  beforeEach(resetStubs);

  it('5. missing bookingId → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ file: validFile }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('6. bookingId too short (< 4 chars) → invalid-argument (regex fails)', async () => {
    await assert.rejects(
      () => handler({ bookingId: 'AB3', file: validFile }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('7. bookingId with special chars → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ bookingId: 'BOOK-1234', file: validFile }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('8. missing file → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ bookingId: 'BOOK1234' }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('9. file not a string → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ bookingId: 'BOOK1234', file: 12345 }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('10. file length > 5MB → invalid-argument', async () => {
    const oversizedFile = 'a'.repeat(5 * 1024 * 1024 + 1);
    await assert.rejects(
      () => handler({ bookingId: 'BOOK1234', file: oversizedFile }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });
});

// ── Booking checks ────────────────────────────────────────────────────────────
describe('verifyBookingSlip — booking checks', () => {
  beforeEach(resetStubs);

  it('11. booking not found → not-found', async () => {
    // bookingSnapState remains null
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'not-found',
    );
  });

  it('12. prospect trying to verify someone else\'s booking → permission-denied', async () => {
    seedBooking({ prospectUid: 'other_user' });
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'permission-denied',
    );
  });

  it('13. admin can verify any booking (no ownership check)', async () => {
    seedBooking({ prospectUid: 'someone_else' });
    const result = await handler(validData, adminCtx);
    assert.equal(result.success, true);
  });

  it('14. booking status !== locked → failed-precondition', async () => {
    seedBooking({ status: 'pending' });
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('15. lockedUntil in the past → failed-precondition', async () => {
    seedBooking({ lockedUntil: { toMillis: () => Date.now() - 1000 } });
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('16. depositAmount = 0 → internal', async () => {
    seedBooking({ depositAmount: 0 });
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'internal',
    );
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('verifyBookingSlip — rate limiting', () => {
  beforeEach(resetStubs);

  it('17. all 3 rate limit windows pass → proceeds to success', async () => {
    seedBooking();
    // rateLimitState is empty → all docs return exists:false → fresh window → allowed
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
  });

  it('18. minute window at max → resource-exhausted', async () => {
    seedBooking();
    // Set minute window count to max (5)
    rateLimitState[`booking_u1_minute`] = {
      count: 5,
      windowStart: Date.now() - 1000, // within the 60s window
    };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'resource-exhausted',
    );
  });

  it('19. checkRateLimit throws → fails CLOSED → resource-exhausted', async () => {
    seedBooking();
    // Override rateLimitState to make the first get throw
    const originalFsCollection = fsInstance.collection;
    let callCount = 0;
    const originalCollection = fsInstance.collection.bind(fsInstance);
    fsInstance.collection = (coll) => {
      if (coll === 'rateLimits') {
        return {
          doc: () => ({
            get: async () => { throw new Error('Firestore unavailable'); },
            set: async () => {},
            update: async () => {},
          }),
        };
      }
      return originalCollection(coll);
    };
    try {
      await assert.rejects(
        () => handler(validData, prospectCtx),
        (e) => e.code === 'resource-exhausted',
      );
    } finally {
      fsInstance.collection = originalCollection;
    }
  });
});

// ── Base64 decode ─────────────────────────────────────────────────────────────
describe('verifyBookingSlip — base64 decode', () => {
  beforeEach(resetStubs);

  it('20. valid base64 of >= 100 bytes → proceeds to success', async () => {
    seedBooking();
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
    assert.ok(slipOkFetchCalled, 'SlipOK API should have been called');
  });

  it('21. buffer < 100 bytes after decode → invalid-argument', async () => {
    seedBooking();
    // 50 bytes decoded = 68 base64 chars, well under 100
    const tinyFile = Buffer.from('x'.repeat(50)).toString('base64');
    await assert.rejects(
      () => handler({ bookingId: 'BOOK1234', file: tinyFile }, prospectCtx),
      (e) => e.code === 'invalid-argument',
    );
  });
});

// ── SlipOK call ───────────────────────────────────────────────────────────────
describe('verifyBookingSlip — SlipOK API call', () => {
  beforeEach(resetStubs);

  it('22. SlipOK returns non-JSON → failed-precondition', async () => {
    seedBooking();
    slipOkApiResponse = {
      ok: true,
      status: 200,
      text: async () => 'not json at all!!!',
    };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });

  it('23. SlipOK returns non-ok HTTP status → failed-precondition', async () => {
    seedBooking();
    slipOkApiResponse = {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });

  // §7-YY regression: body must be a real multipart FormData (global + Blob), not
  // the form-data pkg (which Node 22 undici stringifies to "[object FormData]").
  it('23b. SlipOK body is a global FormData with a Blob files entry (§7-YY)', async () => {
    seedBooking();
    await handler(validData, prospectCtx);
    const body = capturedFetchOpts && capturedFetchOpts.body;
    assert.ok(body instanceof FormData, 'fetch body must be a global FormData (not form-data pkg / a string)');
    assert.ok(body.get('files') instanceof Blob, 'the "files" entry must be a Blob (real bytes)');
    const hKeys = Object.keys((capturedFetchOpts && capturedFetchOpts.headers) || {}).map(k => k.toLowerCase());
    assert.ok(!hKeys.includes('content-type'), 'do not set Content-Type manually (undici derives the boundary)');
  });

  it('24. SCB delay — message includes "code":1010 → retryable shape', async () => {
    seedBooking();
    // The raw HTTP body must contain the literal string "code":1010 so that
    // callSlipOKAPI's throw message (which embeds text.slice(0,300)) triggers
    // the isSCBDelay check in the catch block. Use a raw string — NOT
    // JSON.stringify — so the quotes are unescaped in the response body.
    slipOkApiResponse = {
      ok: false,
      status: 400,
      text: async () => '{"success":false,"message":"SCB error","code":1010}',
    };
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.code, 'scb_delay');
    assert.ok(result.retryAfterSec > 0);
  });

  it('25. SCB delay — message includes ไทยพาณิชย์ → retryable shape', async () => {
    seedBooking();
    slipOkApiResponse = {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ success: false, message: 'ธนาคารไทยพาณิชย์ processing delay' }),
    };
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.code, 'scb_delay');
  });
});

// ── Amount validation ─────────────────────────────────────────────────────────
describe('verifyBookingSlip — amount validation', () => {
  beforeEach(resetStubs);

  it('26. amount diff = 0 → success', async () => {
    seedBooking({ depositAmount: 3000 });
    // slipOkApiResponse.data.amount = 3000 by default
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
  });

  it('27. amount diff = 1 → success (tolerance ≤ 1 is OK)', async () => {
    seedBooking({ depositAmount: 3001 });
    // slip returns 3000, booking expects 3001 → diff = 1 → allowed
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
  });

  it('28. amount diff = 2 → failed-precondition', async () => {
    seedBooking({ depositAmount: 3002 });
    // slip returns 3000, booking expects 3002 → diff = 2 → rejected
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });
});

// ── TransactionId safety ──────────────────────────────────────────────────────
describe('verifyBookingSlip — transactionId safety', () => {
  beforeEach(resetStubs);

  it('29. invalid transactionId (< 4 chars) → failed-precondition', async () => {
    seedBooking();
    slipOkApiResponse = {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        data: {
          transactionId: 'AB',   // only 2 chars — below minimum
          amount: 3000,
          sender: { displayName: 'Alice' },
          receiver: { displayName: 'Bob' },
          date: '2026-05-01',
          sendingBankCode: '014',
        },
      }),
    };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'failed-precondition',
    );
  });
});

// ── Dedup (atomic verifiedSlips.create) ──────────────────────────────────────
describe('verifyBookingSlip — atomic dedup', () => {
  beforeEach(resetStubs);

  it('30. verifiedSlips.create throws { code: 6 } → already-exists', async () => {
    seedBooking();
    verifiedSlipsCreateShouldThrow = { code: 6, message: 'Document already exists' };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'already-exists',
    );
  });

  it('31. verifiedSlips.create throws { code: "already-exists" } → already-exists', async () => {
    seedBooking();
    verifiedSlipsCreateShouldThrow = { code: 'already-exists', message: 'Document already exists' };
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'already-exists',
    );
  });

  it('32. verifiedSlips.create throws other error → internal', async () => {
    seedBooking();
    verifiedSlipsCreateShouldThrow = new Error('Unexpected Firestore error');
    await assert.rejects(
      () => handler(validData, prospectCtx),
      (e) => e.code === 'internal',
    );
  });
});

// ── Storage upload (non-fatal) ────────────────────────────────────────────────
describe('verifyBookingSlip — storage upload', () => {
  beforeEach(resetStubs);

  it('33. storage upload throws → handler continues, success returned', async () => {
    seedBooking();
    storageUploadShouldThrow = new Error('Storage permission denied');
    const result = await handler(validData, prospectCtx);
    assert.equal(result.success, true);
    assert.equal(result.status, 'paid');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────
describe('verifyBookingSlip — happy path', () => {
  beforeEach(resetStubs);

  it('34. full happy path → bookingRef.update called with status=paid, returns success shape', async () => {
    seedBooking();
    const result = await handler(validData, prospectCtx);

    // Return shape
    assert.equal(result.success, true);
    assert.equal(result.bookingId, 'BOOK1234');
    assert.equal(result.status, 'paid');
    assert.equal(result.transactionId, 'TXN123456');
    assert.equal(result.amount, 3000);

    // Booking update was called with status='paid'
    assert.ok(bookingUpdateArgs, 'bookingRef.update must have been called');
    assert.equal(bookingUpdateArgs.status, 'paid');
    assert.equal(bookingUpdateArgs.slipTransactionRef, 'TXN123456');
    assert.equal(bookingUpdateArgs.slipAmount, 3000);

    // Dedup record was written
    assert.ok(verifiedSlipCreateArgs, 'verifiedSlips.create must have been called');
    assert.equal(verifiedSlipCreateArgs.transactionId, 'TXN123456');
    assert.equal(verifiedSlipCreateArgs.bookingId, 'BOOK1234');
    assert.equal(verifiedSlipCreateArgs.amount, 3000);
    assert.equal(verifiedSlipCreateArgs.source, 'booking');

    // SlipOK was called
    assert.ok(slipOkFetchCalled, 'SlipOK API must have been called');
  });
});
