/**
 * Unit tests for notifyBillOnCreate.js
 *
 * Design notes:
 *   - admin.database() and admin.firestore() are called at MODULE LOAD TIME
 *     (singletons), so Module._load intercept must be installed BEFORE the
 *     require('../notifyBillOnCreate') call.
 *   - All test-controlled mutable state lives in `stubState` / `captured`
 *     closure variables, reset in beforeEach() via resetStubs().
 *   - global.fetch is overridden to capture LINE push calls.
 *   - _lineRetry and _billFlex are intercepted via Module._load.
 *   - The RTDB trigger handler is captured via the .onCreate() stub.
 *
 * Run: node --test functions/__tests__/notifyBillOnCreate.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ─────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    // RTDB billNotifiedAt write
    rtdbSetError: null,
    // Firestore: meter_data dedup
    meterDocExists: false,
    meterDocData: { notifiedAt: null },
    meterDocGetError: null,
    // Firestore: liffUsers query
    liffUsersEmpty: false,
    liffUsersDocs: [{ id: 'Utenant1' }],
    liffUsersQueryError: null,
    // Firestore: tenants doc
    tenantDocExists: true,
    tenantDocData: { name: 'สมชาย' },
    // LINE push fetch
    fetchOk: true,
    fetchStatus: 200,
    fetchResponseText: '',
    fetchNetworkError: null,
    ...overrides,
  };
  captured = {
    rtdbSetCalls:      [],  // { path, value }
    fetchCalls:        [],  // { url, opts }
    lineRetryEnqueues: [],  // payloads passed to enqueueLineRetry
    buildBillFlexCalls: [], // { bill, opts }
  };
}
resetStubs();

// ── Firestore stub (module-load-time singleton) ────────────────────────────────
// Must be a stable object reference — the CF stores `admin.firestore()` once at
// the top of the module.  Per-test configuration is read from `stubState` at
// call time via closure.

const firestoreStub = {
  collection: (name) => {
    if (name === 'meter_data') {
      return {
        doc: (_id) => ({
          get: async () => {
            if (stubState.meterDocGetError) throw stubState.meterDocGetError;
            return {
              exists: stubState.meterDocExists,
              data: () => stubState.meterDocData,
            };
          },
        }),
      };
    }
    if (name === 'liffUsers') {
      const terminal = {
        get: async () => {
          if (stubState.liffUsersQueryError) throw stubState.liffUsersQueryError;
          return {
            empty: stubState.liffUsersEmpty,
            docs: stubState.liffUsersDocs,
          };
        },
      };
      const chainable = {
        where: () => chainable,
        get: terminal.get,
      };
      return { where: () => chainable };
    }
    if (name === 'tenants') {
      return {
        doc: (_building) => ({
          collection: (_sub) => ({
            doc: (_roomId) => ({
              get: async () => ({
                exists: stubState.tenantDocExists,
                data: () => stubState.tenantDocData,
              }),
            }),
          }),
        }),
      };
    }
    return {};
  },
};

// ── RTDB stub (module-load-time singleton) ─────────────────────────────────────

const rtdbStub = {
  ref: (path) => ({
    set: async (value) => {
      if (stubState.rtdbSetError) throw stubState.rtdbSetError;
      captured.rtdbSetCalls.push({ path, value });
    },
  }),
};

// ── firebase-admin stub ────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],           // non-empty → initializeApp() is skipped
  initializeApp: () => {},
  database:  () => rtdbStub,
  firestore: () => firestoreStub,
};

// ── Module._load intercept ─────────────────────────────────────────────────────
// Must run BEFORE require('../notifyBillOnCreate') so that every module-level
// call (admin.database(), admin.firestore(), require('./_billFlex')) is
// intercepted.  The intercept stays active after the initial require so that
// the lazy `require('./_lineRetry')` inside the handler body is also caught.

let capturedHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({
        runWith: () => ({
          database: {
            ref: () => ({
              onCreate: (handler) => {
                capturedHandler = handler;
                return {};
              },
            }),
          },
        }),
      }),
      https: { HttpsError },
    };
  }

  // _billFlex — stubbed at module load time (top-level require in CF)
  if (
    request === './_billFlex' ||
    request.replace(/\\/g, '/').endsWith('/_billFlex') ||
    request.replace(/\\/g, '/').endsWith('/_billFlex.js')
  ) {
    return {
      buildBillFlex: (bill, opts) => {
        captured.buildBillFlexCalls.push({ bill, opts });
        return { type: 'flex', altText: 'bill', contents: { bill, opts } };
      },
    };
  }

  // _lineRetry — lazy require inside the handler body; intercept stays active
  if (
    request === './_lineRetry' ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry') ||
    request.replace(/\\/g, '/').endsWith('/_lineRetry.js')
  ) {
    return {
      enqueueLineRetry: async (payload) => {
        captured.lineRetryEnqueues.push(payload);
      },
    };
  }

  return _origLoad.apply(this, arguments);
};

// ── global.fetch stub ──────────────────────────────────────────────────────────

const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;
global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (stubState.fetchNetworkError) throw stubState.fetchNetworkError;
  return {
    ok: stubState.fetchOk,
    status: stubState.fetchStatus,
    text: async () => stubState.fetchResponseText,
  };
};

// ── Load CF (stubs already in place) ──────────────────────────────────────────
delete require.cache[require.resolve('../notifyBillOnCreate.js')];
require('../notifyBillOnCreate.js');
// Module._load intentionally left active so the lazy _lineRetry require inside
// the handler is also intercepted during each test invocation.

after(() => {
  Module._load = _origLoad;
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Invocation helpers ─────────────────────────────────────────────────────────

function makeSnap(val) {
  return { val: () => val };
}

function makeContext(params) {
  return { params: params || { building: 'rooms', roomId: '15', billId: 'bill-001' } };
}

// A valid bill that passes all early-exit guards (no meterDocId, no
// billNotifiedAt, positive totalCharge, status not 'paid').
function validBill(overrides = {}) {
  return { totalCharge: 1500, status: 'unpaid', ...overrides };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('notifyBillOnCreate', () => {
  beforeEach(() => {
    resetStubs();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';
  });

  // 1. Handler is captured at module load
  it('captures the onCreate handler at module load time', () => {
    assert.ok(
      typeof capturedHandler === 'function',
      'capturedHandler must be a function after module load'
    );
  });

  // 2. bill = null (snap.val() returns null) → returns null
  it('returns null when snap.val() returns null', async () => {
    const result = await capturedHandler(makeSnap(null), makeContext());
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0, 'must not call LINE API');
  });

  // 3. bill.status === 'paid' → returns null
  it('returns null when bill.status is paid', async () => {
    const result = await capturedHandler(
      makeSnap(validBill({ status: 'paid' })),
      makeContext()
    );
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 4. bill.billNotifiedAt truthy → returns null
  it('returns null when bill.billNotifiedAt is already set', async () => {
    const result = await capturedHandler(
      makeSnap(validBill({ billNotifiedAt: '2026-05-01T00:00:00.000Z' })),
      makeContext()
    );
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 5. bill.totalCharge = 0 → returns null
  it('returns null when bill.totalCharge is 0', async () => {
    const result = await capturedHandler(
      makeSnap(validBill({ totalCharge: 0 })),
      makeContext()
    );
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 6. bill.totalCharge < 0 → returns null
  it('returns null when bill.totalCharge is negative', async () => {
    const result = await capturedHandler(
      makeSnap(validBill({ totalCharge: -100 })),
      makeContext()
    );
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 7. bill.totalCharge undefined → returns null
  it('returns null when bill.totalCharge is undefined', async () => {
    const { totalCharge: _dropped, ...billWithoutCharge } = validBill();
    const result = await capturedHandler(makeSnap(billWithoutCharge), makeContext());
    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 8. meterDocId present + meter_data.notifiedAt set → skip, sets billNotifiedAt in RTDB
  it('skips LINE push and writes billNotifiedAt to RTDB when meter_data was already notified', async () => {
    resetStubs({
      meterDocExists: true,
      meterDocData: { notifiedAt: '2026-05-01T00:00:00.000Z' },
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(
      makeSnap(validBill({ meterDocId: 'meter-abc' })),
      makeContext()
    );

    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0, 'must not call LINE API when dedup skips');
    assert.equal(captured.rtdbSetCalls.length, 1, 'billNotifiedAt must be written');
    assert.ok(
      captured.rtdbSetCalls[0].path.includes('bills/rooms/15/bill-001/billNotifiedAt'),
      `unexpected RTDB path: ${captured.rtdbSetCalls[0].path}`
    );
    assert.ok(
      typeof captured.rtdbSetCalls[0].value === 'string' &&
        captured.rtdbSetCalls[0].value.length > 0,
      'billNotifiedAt value must be a non-empty ISO string'
    );
  });

  // 9. meterDocId present + meter_data.notifiedAt absent → does NOT skip, continues to notify
  it('continues to LINE push when meter_data.notifiedAt is absent', async () => {
    resetStubs({
      meterDocExists: true,
      meterDocData: { notifiedAt: null },
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(
      makeSnap(validBill({ meterDocId: 'meter-abc' })),
      makeContext()
    );

    // Should reach the LINE push path (not return null from dedup)
    assert.notEqual(result, null, 'must continue past meter_data dedup when notifiedAt is absent');
    assert.equal(captured.fetchCalls.length, 1, 'must call LINE API');
  });

  // 10. meterDocId present + meterDocGetError → falls through, continues to notify
  it('falls through and continues to LINE push when meter_data Firestore get throws', async () => {
    resetStubs({
      meterDocGetError: new Error('firestore unavailable'),
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    // Must not throw, must continue past the dedup block
    const result = await capturedHandler(
      makeSnap(validBill({ meterDocId: 'meter-abc' })),
      makeContext()
    );

    assert.notEqual(result, null, 'must continue past error — better to double-notify than drop');
    assert.equal(captured.fetchCalls.length, 1, 'LINE push must still be attempted');
  });

  // 11. LINE_CHANNEL_ACCESS_TOKEN missing → returns null
  it('returns null when LINE_CHANNEL_ACCESS_TOKEN is not set', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 12. liffUsers query throws → returns null
  it('returns null when liffUsers query throws an error', async () => {
    resetStubs({ liffUsersQueryError: new Error('index missing') });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 13. liffUsers query returns empty → returns null
  it('returns null when no approved LINE-linked tenants are found for the room', async () => {
    resetStubs({ liffUsersEmpty: true, liffUsersDocs: [] });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.equal(result, null);
    assert.equal(captured.fetchCalls.length, 0);
  });

  // 14. Success: 1 approved user, push ok → { pushed: 1, failed: 0 }, billNotifiedAt written
  it('returns { pushed: 1, failed: 0 } and writes billNotifiedAt when one user push succeeds', async () => {
    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.deepEqual(result, { pushed: 1, failed: 0 });
    assert.equal(captured.fetchCalls.length, 1);
    assert.equal(captured.rtdbSetCalls.length, 1, 'billNotifiedAt must be written on success');
    assert.ok(
      captured.rtdbSetCalls[0].path.includes('bills/rooms/15/bill-001/billNotifiedAt'),
      `unexpected RTDB path: ${captured.rtdbSetCalls[0].path}`
    );
  });

  // 15. Success: push fails → enqueueLineRetry called, pushed=0, failed=1
  it('enqueues a retry with correct shape and returns { pushed: 0, failed: 1 } when LINE push fails', async () => {
    resetStubs({ fetchOk: false, fetchStatus: 500, fetchResponseText: 'LINE error' });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.deepEqual(result, { pushed: 0, failed: 1 });
    assert.equal(captured.lineRetryEnqueues.length, 1, 'enqueueLineRetry must be called once');
    const payload = captured.lineRetryEnqueues[0];
    assert.equal(payload.lineUserId, 'Utenant1', 'lineUserId must be the doc id');
    assert.ok(
      typeof payload.idempotencyKey === 'string' && payload.idempotencyKey.length > 0,
      'idempotencyKey must be a non-empty string'
    );
    assert.equal(
      payload.context.source,
      'notifyBillOnCreate',
      'context.source must be notifyBillOnCreate'
    );
    // billNotifiedAt must NOT be written when pushed === 0
    assert.equal(captured.rtdbSetCalls.length, 0, 'RTDB must not be written when nobody was notified');
  });

  // 16. Success: 2 users, both push ok → pushed=2
  it('returns { pushed: 2, failed: 0 } when two approved users both receive pushes successfully', async () => {
    resetStubs({
      liffUsersDocs: [{ id: 'Utenant1' }, { id: 'Utenant2' }],
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    // Need per-call responses; override global.fetch for this test
    let callCount = 0;
    const prevFetch = global.fetch;
    global.fetch = async (url, opts) => {
      callCount++;
      captured.fetchCalls.push({ url, opts });
      return { ok: true, status: 200, text: async () => '' };
    };

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    global.fetch = prevFetch;

    assert.deepEqual(result, { pushed: 2, failed: 0 });
    assert.equal(callCount, 2, 'LINE push must be called once per user');
    assert.equal(captured.rtdbSetCalls.length, 1, 'billNotifiedAt written once');
  });

  // 17. LINE push fetch throws a network error → enqueueLineRetry called, pushed=0
  it('enqueues a retry and returns pushed=0 when fetch throws a network error', async () => {
    resetStubs({ fetchNetworkError: new Error('ECONNRESET') });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    const result = await capturedHandler(makeSnap(validBill()), makeContext());

    assert.equal(result.pushed, 0);
    assert.equal(result.failed, 1);
    assert.equal(captured.lineRetryEnqueues.length, 1, 'enqueueLineRetry must be called');
    assert.equal(captured.rtdbSetCalls.length, 0, 'RTDB must not be written when nobody was notified');
  });

  // 18. tenantName is included in the buildBillFlex call
  it('passes tenantName from the tenants Firestore doc to buildBillFlex', async () => {
    resetStubs({
      tenantDocExists: true,
      tenantDocData: { name: 'มนัสนันท์' },
    });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-tok';

    await capturedHandler(makeSnap(validBill()), makeContext());

    assert.equal(
      captured.buildBillFlexCalls.length,
      1,
      'buildBillFlex must be called exactly once'
    );
    assert.equal(
      captured.buildBillFlexCalls[0].opts.tenantName,
      'มนัสนันท์',
      'tenantName must match the Firestore doc name'
    );
  });
});
