'use strict';
/**
 * Unit tests for requestPhoneOtp.js — UID + phone rate-limit gate.
 *
 * Uses Module._load interception because firebase-admin and firebase-functions/v1
 * are not installed in this worktree.
 *
 * Run: node --test functions/__tests__/requestPhoneOtp.test.js
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ───────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    // What tx.get(uidRef) returns
    uidSnapExists: false,
    uidSnapData: null,
    // What tx.get(phoneRef) returns
    phoneSnapExists: false,
    phoneSnapData: null,
    // Simulate a non-HttpsError thrown inside runTransaction
    transactionError: null,
    ...overrides,
  };
  captured = {
    txSetCalls: [],  // [{ ref, data }] — uidRef set comes first, phoneRef second
    txGetCalls: [],  // ref objects passed to tx.get in call order
  };
}
resetStubs();

// ── Firestore transaction stub ───────────────────────────────────────────────

function makeTxStub() {
  let getCallIndex = 0;
  return {
    get: async (ref) => {
      captured.txGetCalls.push(ref);
      if (getCallIndex === 0) {
        getCallIndex++;
        return { exists: stubState.uidSnapExists, data: () => stubState.uidSnapData };
      }
      return { exists: stubState.phoneSnapExists, data: () => stubState.phoneSnapData };
    },
    set: (ref, data) => {
      captured.txSetCalls.push({ ref, data });
    },
  };
}

// ── Firestore instance stub (factory — called per handler invocation) ─────────

function makeFirestoreStub() {
  return {
    collection: (name) => ({
      doc: (id) => ({ _id: id, _collection: name }),
    }),
    runTransaction: async (cb) => {
      if (stubState.transactionError) throw stubState.transactionError;
      const tx = makeTxStub();
      return cb(tx);
    },
  };
}

// ── Timestamp / FieldValue sentinels ─────────────────────────────────────────

const TimestampSentinel = { fromMillis: (ms) => ({ _type: 'Timestamp', ms }) };
const FieldValueSentinel = { serverTimestamp: () => ({ _type: 'serverTimestamp' }) };

// ── admin stub ───────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  // admin.firestore() is a factory; static methods attached via Object.assign
  firestore: Object.assign(() => makeFirestoreStub(), {
    Timestamp: TimestampSentinel,
    FieldValue: FieldValueSentinel,
  }),
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

let capturedCallHandler = null;

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const functionStub = {
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

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return functionStub;
  return _origLoad.apply(this, arguments);
};

delete require.cache[require.resolve('../requestPhoneOtp.js')];
require('../requestPhoneOtp.js');

after(() => {
  Module._load = _origLoad;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const validPhone = '+66812345678';
const makeCtx = (uid = 'Uabc') => ({ auth: { uid } });

// Build a snap stub that looks like N prior requests inside the current window.
function priorUidRequests(n) {
  return {
    uidSnapExists: true,
    uidSnapData: {
      count: n,
      windowStart: { toMillis: () => Date.now() - 60_000 }, // 1 min ago — inside window
    },
  };
}

function priorPhoneRequests(n) {
  return {
    phoneSnapExists: true,
    phoneSnapData: {
      count: n,
      windowStart: { toMillis: () => Date.now() - 60_000 },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requestPhoneOtp', () => {
  beforeEach(() => resetStubs());

  // ── 1. Handler capture ────────────────────────────────────────────────────

  it('handler is captured by onCall intercept', () => {
    assert.ok(typeof capturedCallHandler === 'function', 'capturedCallHandler must be a function');
  });

  // ── 2. Auth guard ─────────────────────────────────────────────────────────

  it('no auth context → throws unauthenticated', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, { auth: null }),
      (err) => err.code === 'unauthenticated',
    );
  });

  // ── 3. Missing phone ──────────────────────────────────────────────────────

  it('missing phone field → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({}, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('phone is null → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: null }, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  // ── 4. Invalid phone formats ──────────────────────────────────────────────

  it('non-Thai E.164 (+1234567890) → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: '+1234567890' }, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('local format (0812345678) → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: '0812345678' }, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('short Thai (+668123456 — 8 digits after +66) → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: '+668123456' }, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('phone as number type → throws invalid-argument', async () => {
    await assert.rejects(
      () => capturedCallHandler({ phone: 66812345678 }, makeCtx()),
      (err) => err.code === 'invalid-argument',
    );
  });

  // ── 5. Happy path — no prior requests ────────────────────────────────────

  it('valid phone, no prior requests → returns { ok: true, uidCount: 1, phoneCount: 1 }', async () => {
    const result = await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.deepEqual(result, { ok: true, uidCount: 1, phoneCount: 1 });
  });

  // ── 6. Two prior UID requests ─────────────────────────────────────────────

  it('two prior UID requests (count=2) → returns { ok: true, uidCount: 3, phoneCount: 1 }', async () => {
    resetStubs(priorUidRequests(2));
    const result = await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.deepEqual(result, { ok: true, uidCount: 3, phoneCount: 1 });
  });

  // ── 7. UID limit exceeded ─────────────────────────────────────────────────

  it('three prior UID requests (count=3) → throws resource-exhausted', async () => {
    resetStubs(priorUidRequests(3));
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => err.code === 'resource-exhausted',
    );
  });

  // ── 8. Phone limit exceeded ───────────────────────────────────────────────

  it('three prior phone requests (count=3) → throws resource-exhausted', async () => {
    resetStubs(priorPhoneRequests(3));
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => err.code === 'resource-exhausted',
    );
  });

  // ── 9. UID limit message mentions "account" ───────────────────────────────

  it('UID limit error message mentions "account" not "phone"', async () => {
    resetStubs(priorUidRequests(3));
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => {
        assert.ok(/account/i.test(err.message), `Expected "account" in: ${err.message}`);
        assert.ok(!/this phone/i.test(err.message), `Should not mention "this phone": ${err.message}`);
        return true;
      },
    );
  });

  // ── 10. Phone limit message mentions "phone" ──────────────────────────────

  it('phone limit error message mentions "phone" not "account"', async () => {
    resetStubs(priorPhoneRequests(3));
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => {
        assert.ok(/phone/i.test(err.message), `Expected "phone" in: ${err.message}`);
        assert.ok(!/this account/i.test(err.message), `Should not mention "this account": ${err.message}`);
        return true;
      },
    );
  });

  // ── 11. Both limits exceeded — UID checked first ──────────────────────────

  it('both UID and phone at limit → resource-exhausted (UID checked first, message mentions account)', async () => {
    resetStubs({
      ...priorUidRequests(3),
      ...priorPhoneRequests(3),
    });
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => {
        assert.equal(err.code, 'resource-exhausted');
        // UID is checked before phone in the CF, so "account" should appear
        assert.ok(/account/i.test(err.message), `Expected UID limit message: ${err.message}`);
        return true;
      },
    );
  });

  // ── 12. Outside window — count resets ────────────────────────────────────

  it('UID window expired (2h ago, count=3) → count resets to 1, no error', async () => {
    resetStubs({
      uidSnapExists: true,
      uidSnapData: {
        count: 3,
        windowStart: { toMillis: () => Date.now() - 2 * 3600 * 1000 }, // 2 hours ago
      },
    });
    const result = await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.uidCount, 1, 'count must reset to 1 after window expiry');
  });

  it('phone window expired (2h ago, count=3) → count resets to 1, no error', async () => {
    resetStubs({
      phoneSnapExists: true,
      phoneSnapData: {
        count: 3,
        windowStart: { toMillis: () => Date.now() - 2 * 3600 * 1000 },
      },
    });
    const result = await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.phoneCount, 1, 'count must reset to 1 after window expiry');
  });

  // ── 13. tx.set called twice ───────────────────────────────────────────────

  it('tx.set is called exactly twice (once for uid doc, once for phone doc)', async () => {
    await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.equal(captured.txSetCalls.length, 2, 'tx.set must be called exactly twice');
  });

  // ── 14. tx.set data shape ─────────────────────────────────────────────────

  it('first tx.set (uid doc) data includes count, Timestamp windowStart, serverTimestamp updatedAt', async () => {
    await capturedCallHandler({ phone: validPhone }, makeCtx());
    const { data } = captured.txSetCalls[0];
    assert.equal(data.count, 1);
    assert.equal(data.windowStart._type, 'Timestamp', 'windowStart must be a Timestamp sentinel');
    assert.equal(data.updatedAt._type, 'serverTimestamp', 'updatedAt must be a serverTimestamp sentinel');
  });

  it('second tx.set (phone doc) data includes count, Timestamp windowStart, serverTimestamp updatedAt', async () => {
    await capturedCallHandler({ phone: validPhone }, makeCtx());
    const { data } = captured.txSetCalls[1];
    assert.equal(data.count, 1);
    assert.equal(data.windowStart._type, 'Timestamp', 'windowStart must be a Timestamp sentinel');
    assert.equal(data.updatedAt._type, 'serverTimestamp', 'updatedAt must be a serverTimestamp sentinel');
  });

  // ── 15. Non-HttpsError from transaction → wrapped in internal ─────────────

  it('transaction throws non-HttpsError → wrapped in internal HttpsError', async () => {
    resetStubs({ transactionError: new Error('Firestore unavailable') });
    await assert.rejects(
      () => capturedCallHandler({ phone: validPhone }, makeCtx()),
      (err) => {
        assert.equal(err.code, 'internal');
        assert.ok(
          err.message.includes('Firestore unavailable'),
          `Expected original message in wrapped error: ${err.message}`,
        );
        return true;
      },
    );
  });

  // ── 16. Phone digits stripped correctly for doc ID ────────────────────────

  it('phone "+66812345678" produces phone doc id "phone_66812345678"', async () => {
    await capturedCallHandler({ phone: '+66812345678' }, makeCtx());
    // second tx.get call is for the phone ref
    const phoneRef = captured.txGetCalls[1];
    assert.equal(phoneRef._id, 'phone_66812345678', `Expected phone_66812345678, got ${phoneRef._id}`);
  });

  it('uid doc id is "uid_<uid>"', async () => {
    await capturedCallHandler({ phone: validPhone }, makeCtx('TestUid99'));
    const uidRef = captured.txGetCalls[0];
    assert.equal(uidRef._id, 'uid_TestUid99', `Expected uid_TestUid99, got ${uidRef._id}`);
  });

  // ── Edge: snap without toMillis on windowStart → treated as outside window ─

  it('snap exists but windowStart has no toMillis → startedAt=0 → outside window, count resets', async () => {
    resetStubs({
      uidSnapExists: true,
      uidSnapData: {
        count: 3,
        windowStart: null, // no toMillis method
      },
    });
    const result = await capturedCallHandler({ phone: validPhone }, makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.uidCount, 1, 'count must reset when windowStart has no toMillis');
  });
});
