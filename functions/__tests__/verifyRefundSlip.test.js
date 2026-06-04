'use strict';
/**
 * Unit tests for verifyRefundSlip.js — onCall handler for deposit refund-slip
 * authenticity verification (move-out settlement, Slice C).
 *
 * Covers: admin-only auth gate, input validation (file, expectedAmount>0, size cap),
 * rate limiting (fail-closed), base64 decode, SlipOK call (SCB-delay + invalid),
 * ADVISORY amount match/mismatch (success:true either way — slip authenticity is the
 * only hard signal), ADVISORY receiver match (true/false/null), unsafe transactionId,
 * and the no-side-effect-writes invariant (only rateLimits is ever touched).
 *
 * Run: node --test functions/__tests__/verifyRefundSlip.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Per-test mutable state ────────────────────────────────────────────────────
let slipOkApiResponse;
let rateLimitState;            // keyed by doc id; null value = doc doesn't exist
let slipOkFetchCalled;
let collectionsAccessed;       // Set of collection names touched on firestore

function resetStubs() {
  slipOkApiResponse = {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      success: true,
      data: {
        transactionId: 'REFUNDTXN1',
        amount: 5000,
        sender: { displayName: 'Green Haven' },
        receiver: { displayName: 'Tenant 15', proxy: { value: '0812345678', type: 'MSISDN' } },
        transTimestamp: '2026-06-04T10:00:00Z',
        sendingBankCode: '014',
      },
    }),
  };
  rateLimitState = {};         // empty = all docs don't exist → fresh window → allowed
  slipOkFetchCalled = false;
  collectionsAccessed = new Set();
}
resetStubs();

// ── Stubs ─────────────────────────────────────────────────────────────────────
const fsInstance = {
  collection: (coll) => {
    collectionsAccessed.add(coll);
    return {
      doc: (id) => {
        if (coll === 'rateLimits') {
          const existing = rateLimitState[id] !== undefined ? rateLimitState[id] : null;
          return {
            get: async () => ({ exists: existing !== null, data: () => existing }),
            set: async () => {},
            update: async () => {},
          };
        }
        // Any other collection access is a side-effect this CF must NOT do.
        return {
          get: async () => ({ exists: false, data: () => null }),
          set: async () => { throw new Error(`unexpected write to ${coll}`); },
          update: async () => { throw new Error(`unexpected write to ${coll}`); },
          create: async () => { throw new Error(`unexpected write to ${coll}`); },
        };
      },
    };
  },
  // checkRateLimit wraps its read-modify-write in a transaction (mirrors verifySlip).
  // The tx delegates to the doc ref's own get/set/update so the rateLimits stub above
  // drives behaviour; a throwing ref.get (test 13) rejects the tx → fail-closed.
  runTransaction: async (fn) => {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data) => ref.set(data),
      update: (ref, data) => ref.update(data),
    };
    return fn(tx);
  },
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  }),
};

const fetchStub = async () => {
  slipOkFetchCalled = true;
  return slipOkApiResponse;
};

const FormDataStub = class { append() {} };

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

// ── Module interception (before require) ──────────────────────────────────────
const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return adminStub;
  if (req === 'firebase-functions/v1') return functionsStub;
  if (req === 'firebase-functions/params') return paramStub;
  if (req === 'form-data') return FormDataStub;
  return _origLoad.call(this, req, parent, isMain);
};

global.fetch = fetchStub;

require('../verifyRefundSlip');
const handler = capturedHandler;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const adminCtx  = { auth: { uid: 'admin1', token: { admin: true } } };
const tenantCtx = { auth: { uid: 'u1', token: { role: 'tenant' } } };

// Valid base64 — decodes to 200 bytes, above the 100-byte minimum
const validFile = Buffer.from('x'.repeat(200)).toString('base64');
const baseData = { file: validFile, expectedAmount: 5000, expectedReceiver: '0812345678' };

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('verifyRefundSlip — auth (admin-only house gate)', () => {
  beforeEach(resetStubs);

  it('1. no auth → unauthenticated', async () => {
    await assert.rejects(() => handler(baseData, { auth: null }), (e) => e.code === 'unauthenticated');
  });

  it('2. authed but not admin → permission-denied', async () => {
    await assert.rejects(() => handler(baseData, tenantCtx), (e) => e.code === 'permission-denied');
  });

  it('3. admin → allowed (success path)', async () => {
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, true);
    assert.ok(slipOkFetchCalled);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────
describe('verifyRefundSlip — input validation', () => {
  beforeEach(resetStubs);

  it('4. missing file → invalid-argument', async () => {
    await assert.rejects(() => handler({ expectedAmount: 5000 }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('5. file not a string → invalid-argument', async () => {
    await assert.rejects(() => handler({ file: 123, expectedAmount: 5000 }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('6. file > 5MB → invalid-argument', async () => {
    const big = 'a'.repeat(5 * 1024 * 1024 + 1);
    await assert.rejects(() => handler({ file: big, expectedAmount: 5000 }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('7. expectedAmount missing → invalid-argument', async () => {
    await assert.rejects(() => handler({ file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('8. expectedAmount = 0 → invalid-argument (no refund to verify)', async () => {
    await assert.rejects(() => handler({ file: validFile, expectedAmount: 0 }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('9. expectedAmount negative → invalid-argument', async () => {
    await assert.rejects(() => handler({ file: validFile, expectedAmount: -100 }, adminCtx), (e) => e.code === 'invalid-argument');
  });

  it('10. expectedAmount non-numeric → invalid-argument', async () => {
    await assert.rejects(() => handler({ file: validFile, expectedAmount: 'abc' }, adminCtx), (e) => e.code === 'invalid-argument');
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('verifyRefundSlip — rate limiting', () => {
  beforeEach(resetStubs);

  it('11. fresh windows → proceeds to success', async () => {
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, true);
  });

  it('12. minute window at max → resource-exhausted', async () => {
    rateLimitState['refundslip_admin1_minute'] = { count: 5, windowStart: Date.now() - 1000 };
    await assert.rejects(() => handler(baseData, adminCtx), (e) => e.code === 'resource-exhausted');
  });

  it('13. checkRateLimit throws → fails CLOSED → resource-exhausted', async () => {
    const original = fsInstance.collection;
    fsInstance.collection = (coll) => {
      if (coll === 'rateLimits') {
        return { doc: () => ({ get: async () => { throw new Error('Firestore down'); }, set: async () => {}, update: async () => {} }) };
      }
      return original(coll);
    };
    try {
      await assert.rejects(() => handler(baseData, adminCtx), (e) => e.code === 'resource-exhausted');
    } finally {
      fsInstance.collection = original;
    }
  });
});

// ── Base64 decode ─────────────────────────────────────────────────────────────
describe('verifyRefundSlip — base64 decode', () => {
  beforeEach(resetStubs);

  it('14. buffer < 100 bytes → invalid-argument', async () => {
    const tiny = Buffer.from('x'.repeat(50)).toString('base64');
    await assert.rejects(() => handler({ ...baseData, file: tiny }, adminCtx), (e) => e.code === 'invalid-argument');
  });
});

// ── SlipOK call ───────────────────────────────────────────────────────────────
describe('verifyRefundSlip — SlipOK call', () => {
  beforeEach(resetStubs);

  it('15. SlipOK non-JSON → slip_invalid resolve (success:false, NOT thrown)', async () => {
    slipOkApiResponse = { ok: true, status: 200, text: async () => 'not json!!!' };
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, false);
    assert.equal(r.code, 'slip_invalid');
  });

  it('16. SlipOK non-ok HTTP → slip_invalid resolve', async () => {
    slipOkApiResponse = { ok: false, status: 500, text: async () => 'Server Error' };
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, false);
    assert.equal(r.code, 'slip_invalid');
  });

  it('17. SCB delay ("code":1010) → retryable resolve', async () => {
    slipOkApiResponse = { ok: false, status: 400, text: async () => '{"success":false,"message":"SCB","code":1010}' };
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, false);
    assert.equal(r.retryable, true);
    assert.equal(r.code, 'scb_delay');
    assert.ok(r.retryAfterSec > 0);
  });

  it('18. SCB delay (ไทยพาณิชย์) → retryable resolve', async () => {
    slipOkApiResponse = { ok: false, status: 400, text: async () => JSON.stringify({ success: false, message: 'ธนาคารไทยพาณิชย์ delay' }) };
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, false);
    assert.equal(r.code, 'scb_delay');
  });
});

// ── Amount check (ADVISORY — success:true either way) ─────────────────────────
describe('verifyRefundSlip — amount (advisory)', () => {
  beforeEach(resetStubs);

  it('19. amount diff 0 → success, amountMatch true', async () => {
    const r = await handler({ ...baseData, expectedAmount: 5000 }, adminCtx);
    assert.equal(r.success, true);
    assert.equal(r.amountMatch, true);
    assert.equal(r.amountDiff, 0);
  });

  it('20. amount diff 1 → amountMatch true (tolerance)', async () => {
    const r = await handler({ ...baseData, expectedAmount: 5001 }, adminCtx);
    assert.equal(r.amountMatch, true);
  });

  it('21. amount diff 2 → success:true but amountMatch false (advisory, never thrown)', async () => {
    const r = await handler({ ...baseData, expectedAmount: 5002 }, adminCtx);
    assert.equal(r.success, true);          // slip is authentic
    assert.equal(r.amountMatch, false);     // but amount differs
    assert.equal(r.amountDiff, 2);
    assert.equal(r.slipAmount, 5000);
    assert.equal(r.expectedAmount, 5002);
  });
});

// ── Receiver check (ADVISORY — true/false/null) ───────────────────────────────
describe('verifyRefundSlip — receiver (advisory)', () => {
  beforeEach(resetStubs);

  it('22. expectedReceiver last-4 found in receiver proxy → receiverMatch true', async () => {
    const r = await handler({ ...baseData, expectedReceiver: '0812345678' }, adminCtx);
    assert.equal(r.receiverMatch, true);    // proxy.value 0812345678 contains 5678
  });

  it('23. expectedReceiver last-4 not in receiver → receiverMatch false', async () => {
    const r = await handler({ ...baseData, expectedReceiver: '0899990000' }, adminCtx);
    assert.equal(r.receiverMatch, false);   // 0000 not in 0812345678
  });

  it('24. no expectedReceiver → receiverMatch null', async () => {
    const r = await handler({ file: validFile, expectedAmount: 5000 }, adminCtx);
    assert.equal(r.receiverMatch, null);
  });

  it('25. receiver carries no digits (masked name only) → receiverMatch null', async () => {
    slipOkApiResponse = {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        success: true,
        data: { transactionId: 'REFUNDTXN1', amount: 5000, receiver: { displayName: 'นาย ก' } },
      }),
    };
    const r = await handler({ ...baseData, expectedReceiver: '0812345678' }, adminCtx);
    assert.equal(r.receiverMatch, null);
  });
});

// ── transactionId safety ──────────────────────────────────────────────────────
describe('verifyRefundSlip — transactionId safety', () => {
  beforeEach(resetStubs);

  it('26. unsafe transactionId → data.transactionId null but success:true', async () => {
    slipOkApiResponse = {
      ok: true, status: 200,
      text: async () => JSON.stringify({ success: true, data: { transactionId: 'AB', amount: 5000 } }),
    };
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, true);
    assert.equal(r.data.transactionId, null);
  });
});

// ── Happy path + no-side-effect invariant ─────────────────────────────────────
describe('verifyRefundSlip — happy path + no writes', () => {
  beforeEach(resetStubs);

  it('27. full happy path → return shape + SlipOK called', async () => {
    const r = await handler(baseData, adminCtx);
    assert.equal(r.success, true);
    assert.equal(r.data.transactionId, 'REFUNDTXN1');
    assert.equal(r.data.amount, 5000);
    assert.equal(r.data.sender, 'Green Haven');
    assert.equal(r.data.receiver, 'Tenant 15');
    assert.equal(r.data.bankCode, '014');
    assert.equal(r.amountMatch, true);
    assert.equal(r.receiverMatch, true);
    assert.ok(slipOkFetchCalled);
  });

  it('28. NO side-effect writes — only rateLimits collection is ever touched', async () => {
    await handler(baseData, adminCtx);
    const touched = [...collectionsAccessed];
    assert.deepEqual(touched, ['rateLimits'],
      `verifyRefundSlip must not write verifiedSlips/bills/etc — touched: ${touched.join(', ')}`);
  });
});
