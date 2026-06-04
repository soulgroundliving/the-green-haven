/**
 * Unit tests for verifySlip.js — main callable handler (exports.verifySlip).
 *
 * verifySlip migrated 2026-06-02 from https.onRequest → https.onCall. The handler
 * is now (data, context); auth is delegated to _authSoT.assertTenantAccess
 * (admin OR the room's own tenant). Business outcomes (scb_delay / amount_mismatch
 * / duplicate / slip-not-valid) RESOLVE with { success:false, ... }; true errors
 * (auth / validation / rate-limit / internal) REJECT with HttpsError.
 *
 * Helper functions (validateRequest, isSafeTransactionId, markBillPaidInRTDB,
 * recordPaymentAndAwardPoints, sendReceiptNotification) are tested in
 * verifySlipLogic.test.js and verifySlipReceipt.test.js respectively.
 *
 * Run: node --test functions/__tests__/verifySlip.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state (reset per test) ───────────────────────────────────────────────

let slipOkResponse = null;   // null = use defaultSlipOkOk; set per-test to override
let runTransactionResult = true;  // true = allowed, false = rate-limited, Error = throw
let verifiedSlipExists = false;  // tx.get(verifiedSlips) dedup result: true = duplicate slip
let counterDocSeq = null;        // tx.get(counters) seq value: null = counter doc absent → first receipt = 00001
let saveSlipTxThrow = null;      // Error = simulate a non-dup receipt-tx commit failure (non-blocking path)
let lastTxWrites = null;         // captures the last receipt-tx writes [{coll,id,data}] (receipt/audit assertions)
let logAddCalled = false;
let authSoTThrow = null;     // null = authorized; Error = throw (permission-denied etc.)
let getValidBuildingsThrow = false;  // true = getValidBuildings throws (unexpected error path)

// Configurable behaviour for non-blocking side effects
let markBillPaidShouldThrow = false;
let recordPaymentShouldThrow = false;
let capturedFetchOpts = null;   // { method, headers, body } passed to fetch (§7-YY guard)

function resetStubs() {
  slipOkResponse = null;
  capturedFetchOpts = null;
  runTransactionResult = true;
  verifiedSlipExists = false;
  counterDocSeq = null;
  saveSlipTxThrow = null;
  lastTxWrites = null;
  logAddCalled = false;
  authSoTThrow = null;
  getValidBuildingsThrow = false;
  markBillPaidShouldThrow = false;
  recordPaymentShouldThrow = false;
}
resetStubs();

// ── Default SlipOK success response ──────────────────────────────────────────

const DEFAULT_SLIP_DATA = {
  transactionId: 'TXN1234-ABCD',
  amount: 1000,
  sender: { displayName: 'Alice', name: 'Alice' },
  receiver: { displayName: 'GH' },
  date: '2026-05-01',
  sendingBankCode: '014',
};

function makeSlipOkOk(override = {}) {
  const data = { ...DEFAULT_SLIP_DATA, ...override };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data }),
  };
}

function makeSlipOkError(statusCode, bodyText) {
  return {
    ok: false,
    status: statusCode,
    text: async () => bodyText,
  };
}

// ── Firestore stub ────────────────────────────────────────────────────────────

const dbInstance = {
  collection: (name) => ({
    doc: (id) => ({
      _coll: name, _id: id,   // ref identity for the ref-aware transaction mock
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async () => {},
      update: async () => {},
      collection: (_sub) => ({
        doc: (_did) => ({
          get: async () => ({ exists: false, data: () => ({}) }),
          set: async () => {},
        }),
      }),
    }),
    add: async (_data) => {
      if (name === 'slipVerificationLog') logAddCalled = true;
      return { id: 'log1' };
    },
    where: () => ({
      where: () => ({
        where: () => ({
          get: async () => ({ empty: true, size: 0, docs: [] }),
        }),
      }),
    }),
  }),
  // runTransaction handles BOTH the rate-limit tx (verifySlip.js ~72) and
  // saveVerifiedSlip's dedup + gapless-receipt + audit tx. runTransactionResult
  // short-circuits the rate-limit path (Error → infra throw, false → rate-limited).
  // For the receipt tx, tx.get is ref-aware: verifiedSlips → dedup (verifiedSlipExists),
  // counters → the gapless sequence (counterDocSeq). Writes captured in lastTxWrites.
  // saveSlipTxThrow simulates a non-dup commit failure on the receipt tx only.
  runTransaction: async (fn) => {
    if (runTransactionResult instanceof Error) throw runTransactionResult;
    if (runTransactionResult === false) return false;
    const writes = [];
    const tx = {
      get: async (ref) => {
        const coll = ref && ref._coll;
        if (coll === 'verifiedSlips') return { exists: verifiedSlipExists, data: () => ({}) };
        if (coll === 'counters') return { exists: counterDocSeq != null, data: () => ({ seq: counterDocSeq }) };
        return { exists: false, data: () => ({}) };  // rateLimits (first request), etc.
      },
      set: (ref, data) => { writes.push({ coll: ref && ref._coll, id: ref && ref._id, data }); },
      update: (ref, data) => { writes.push({ coll: ref && ref._coll, id: ref && ref._id, op: 'update', data }); },
    };
    const result = await fn(tx);
    lastTxWrites = writes;
    // Receipt tx writes verifiedSlips — simulate a non-dup commit failure there.
    if (saveSlipTxThrow && writes.some((w) => w.coll === 'verifiedSlips')) throw saveSlipTxThrow;
    return result;
  },
};

// ── RTDB stub ─────────────────────────────────────────────────────────────────

const rtdbRefStub = {
  once: async () => ({ val: () => ({}) }),
  update: async () => {
    if (markBillPaidShouldThrow) throw new Error('RTDB update failed');
  },
  push: async () => ({ key: 'pushId' }),
};
const rtdbInstance = { ref: (_path) => rtdbRefStub };

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => dbInstance, {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TS',
      delete: () => 'DEL',
      increment: (n) => n,
    },
    Timestamp: { fromMillis: (ms) => ms },
  }),
  database: () => rtdbInstance,
  storage: () => ({ bucket: () => ({ file: () => ({ save: async () => {} }) }) }),
};

// ── fetch stub ────────────────────────────────────────────────────────────────

const fetchStub = async (_url, _opts) => {
  capturedFetchOpts = _opts || null;
  if (slipOkResponse !== null) return slipOkResponse;
  return makeSlipOkOk();
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

class HttpsError extends Error {
  constructor(code, msg, details) { super(msg); this.code = code; this.details = details; }
}

let capturedHandler;
const functionsStub = {
  region: () => functionsStub,
  runWith: () => functionsStub,
  https: {
    onCall: (h) => { capturedHandler = h; return 'cf'; },
    HttpsError,
  },
};

// ── firebase-functions/params stub ────────────────────────────────────────────

const paramStub = {
  defineSecret: (name) => ({
    value: () => name === 'LINE_CHANNEL_ACCESS_TOKEN' ? '' : 'apikey',
  }),
  defineString: (_name) => ({ value: () => 'https://api.slipok.example.com' }),
};

// ── _authSoT stub ──────────────────────────────────────────────────────────────
// Mimics assertTenantAccess: unauthenticated when no auth.uid; otherwise pass
// (admin or claim) unless authSoTThrow is set (simulates permission-denied).

const authSoTStub = {
  assertTenantAccess: async ({ context, HttpsError: HE }) => {
    if (!context?.auth?.uid) throw new HE('unauthenticated', 'Sign-in required');
    if (authSoTThrow) throw authSoTThrow;
    const tok = context.auth.token || {};
    return { tenantData: null, viaPath: tok.admin === true ? 'admin' : 'claim' };
  },
  resolveTenantClaims: async ({ context }) => {
    const tok = context?.auth?.token || {};
    return { building: tok.building || 'rooms', roomId: tok.room || '15', resolvedVia: 'claim' };
  },
};

// ── _billFlex stub ────────────────────────────────────────────────────────────

const billFlexStub = {
  buildReceiptFlex: () => ({ type: 'flex', altText: 'receipt' }),
  buildBillFlex: () => ({ type: 'flex', altText: 'bill' }),
  loadRoomConfig: async () => ({}),
  computeBill: () => null,
};

// ── Module._load interception ─────────────────────────────────────────────────

const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') return functionsStub;
  if (request === 'firebase-functions/params') return paramStub;
  // NO 'form-data' interception — callSlipOKAPI uses global FormData + Blob (§7-YY).
  if (request === './_authSoT') return authSoTStub;
  if (request === './_billFlex') return billFlexStub;
  if (request === './buildingRegistry') return {
    getValidBuildings: async () => {
      if (getValidBuildingsThrow) throw new Error('buildingRegistry boom');
      return new Set(['rooms', 'nest']);
    },
  };
  return _origLoad.call(this, request, parent, isMain);
};

global.fetch = fetchStub;

// Load module under test — capturedHandler is set by onCall() above
require('../verifySlip');
const handler = capturedHandler;

// ── Callable data / context helpers ───────────────────────────────────────────

const validData = {
  file: Buffer.from('x'.repeat(200)).toString('base64'),
  expectedAmount: 1000,
  building: 'rooms',
  room: '15',
};

// Build a callable context. Default = signed-in admin. Pass { noAuth:true } for an
// anonymous (unauthenticated) call, or { admin:false, room, building } for a tenant.
function makeCtx({ noAuth = false, admin = true, room = '15', building = 'rooms', uid = 'u1' } = {}) {
  const rawRequest = { ip: '1.2.3.4', get: (_h) => 'test-agent' };
  if (noAuth) return { rawRequest };
  const token = admin ? { admin: true } : { room, building };
  return { auth: { uid, token }, rawRequest };
}

// ── Restore Module._load after all tests ──────────────────────────────────────

after(() => {
  Module._load = _origLoad;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('verifySlip — callable handler', () => {
  beforeEach(() => resetStubs());

  // ── Auth gate (assertTenantAccess) ────────────────────────────────────────

  describe('auth gate', () => {
    it('no auth context → rejects unauthenticated', async () => {
      await assert.rejects(
        () => handler(validData, makeCtx({ noAuth: true })),
        (err) => err.code === 'unauthenticated'
      );
    });

    it('admin context → proceeds to success', async () => {
      const result = await handler(validData, makeCtx({ admin: true }));
      assert.equal(result.success, true);
    });

    it('owning tenant context (room+building claim) → proceeds to success', async () => {
      const result = await handler(validData, makeCtx({ admin: false, room: '15', building: 'rooms' }));
      assert.equal(result.success, true);
    });

    it('assertTenantAccess throws permission-denied → rejects permission-denied', async () => {
      authSoTThrow = new HttpsError('permission-denied', 'not your room');
      await assert.rejects(
        () => handler(validData, makeCtx({ admin: false, room: '99', building: 'rooms' })),
        (err) => err.code === 'permission-denied'
      );
    });
  });

  // ── validateRequest (invalid-argument) ─────────────────────────────────────

  describe('validateRequest — rejects invalid-argument', () => {
    it('missing file field → invalid-argument "File is required"', async () => {
      await assert.rejects(
        () => handler({ ...validData, file: undefined }, makeCtx()),
        (err) => err.code === 'invalid-argument' && /File/.test(err.message)
      );
    });

    it('file is not a string (Buffer passed) → invalid-argument', async () => {
      await assert.rejects(
        () => handler({ ...validData, file: Buffer.from('data') }, makeCtx()),
        (err) => err.code === 'invalid-argument'
      );
    });

    it('expectedAmount = 0 → invalid-argument "amount"', async () => {
      await assert.rejects(
        () => handler({ ...validData, expectedAmount: 0 }, makeCtx()),
        (err) => err.code === 'invalid-argument' && /amount/.test(err.message)
      );
    });

    it('no room and no userId → invalid-argument "Room"', async () => {
      const { room: _r, ...data } = validData;
      await assert.rejects(
        () => handler(data, makeCtx()),
        (err) => err.code === 'invalid-argument' && /Room/.test(err.message)
      );
    });

    it('invalid building → invalid-argument "building"', async () => {
      await assert.rejects(
        () => handler({ ...validData, building: 'amazon' }, makeCtx()),
        (err) => err.code === 'invalid-argument' && /building/.test(err.message)
      );
    });

    it('valid body passes validation (resolves success)', async () => {
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
    });
  });

  // ── File size cap ─────────────────────────────────────────────────────────

  describe('file size cap', () => {
    it('file.length > 5MB → invalid-argument "Payload too large"', async () => {
      const bigFile = 'A'.repeat(5 * 1024 * 1024 + 1);
      await assert.rejects(
        () => handler({ ...validData, file: bigFile }, makeCtx()),
        (err) => err.code === 'invalid-argument' && /too large|Payload/i.test(err.message)
      );
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('runTransaction returns false (rate limited) → resource-exhausted with retryAfter detail', async () => {
      runTransactionResult = false;
      await assert.rejects(
        () => handler(validData, makeCtx()),
        (err) => err.code === 'resource-exhausted' && err.details?.retryAfter === 60
      );
    });

    it('rate limit Firestore throws → resource-exhausted (fail CLOSED)', async () => {
      runTransactionResult = new Error('Firestore connection failed');
      await assert.rejects(
        () => handler(validData, makeCtx()),
        (err) => err.code === 'resource-exhausted'
      );
    });
  });

  // ── SlipOK API call ──────────────────────────────────────────────────────

  describe('SlipOK API call', () => {
    it('SlipOK returns HTTP 400 → resolves { success:false } (business outcome)', async () => {
      slipOkResponse = makeSlipOkError(400, JSON.stringify({ success: false, message: 'Bad request' }));
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, false);
      assert.ok(result.message, 'message field must be present');
    });

    // §7-YY regression: body must be a real multipart FormData (global + Blob),
    // not the form-data pkg (Node 22 undici stringifies it to "[object FormData]"
    // → SlipOK 400 "missing files"). Locks the global-FormData construction.
    it('SlipOK body is a global FormData with a Blob files entry (§7-YY)', async () => {
      await handler(validData, makeCtx());
      const body = capturedFetchOpts && capturedFetchOpts.body;
      assert.ok(body instanceof FormData, 'fetch body must be a global FormData (not form-data pkg / a string)');
      assert.ok(body.get('files') instanceof Blob, 'the "files" entry must be a Blob (real bytes)');
      const hKeys = Object.keys((capturedFetchOpts && capturedFetchOpts.headers) || {}).map(k => k.toLowerCase());
      assert.ok(!hKeys.includes('content-type'), 'do not set Content-Type manually (undici derives the boundary)');
    });

    it('SCB delay — error body contains "code":1010 → { success:false, retryable:true, code:scb_delay }', async () => {
      slipOkResponse = { ok: false, status: 400, text: async () => 'SlipOK API returned 400: "code":1010 scb error' };
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, false);
      assert.equal(result.retryable, true);
      assert.equal(result.code, 'scb_delay');
    });

    it('SCB delay — error message contains ไทยพาณิชย์ → retryable scb_delay', async () => {
      slipOkResponse = { ok: false, status: 400, text: async () => 'ไทยพาณิชย์ processing delay error' };
      const result = await handler(validData, makeCtx());
      assert.equal(result.retryable, true);
      assert.equal(result.code, 'scb_delay');
    });
  });

  // ── Amount validation ─────────────────────────────────────────────────────

  describe('amount validation', () => {
    it('amount matches exactly → success', async () => {
      slipOkResponse = makeSlipOkOk({ amount: 1000 });
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
    });

    it('amount diff = 1 (within tolerance) → success', async () => {
      slipOkResponse = makeSlipOkOk({ amount: 1001 });
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
    });

    it('amount diff = 2 (exceeds tolerance) → { success:false, code:amount_mismatch }', async () => {
      slipOkResponse = makeSlipOkOk({ amount: 1002 });
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, false);
      assert.equal(result.code, 'amount_mismatch');
      assert.equal(result.slipAmount, 1002);
      assert.equal(result.expectedAmount, 1000);
    });
  });

  // ── TransactionId safety ──────────────────────────────────────────────────

  describe('transactionId safety', () => {
    it('SlipOK returns a short transactionId (< 4 chars) → { success:false } invalid slip transaction id', async () => {
      slipOkResponse = makeSlipOkOk({ transactionId: 'AB' });
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, false);
      assert.ok(/transaction/i.test(result.error));
    });

    it('SlipOK returns transRef but no transactionId → transactionId normalised from transRef', async () => {
      slipOkResponse = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            transRef: 'TRANSREF-ABCD1234',
            amount: 1000,
            sender: { displayName: 'Alice' },
            receiver: {},
            date: '2026-05-01',
            sendingBankCode: '014',
          },
        }),
      };
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      assert.equal(result.data.transactionId, 'TRANSREF-ABCD1234');
    });
  });

  // ── Duplicate detection ───────────────────────────────────────────────────

  describe('duplicate detection', () => {
    it('slip already verified (tx.get finds existing) → { success:false, isDuplicate:true }', async () => {
      verifiedSlipExists = true;
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, false);
      assert.equal(result.isDuplicate, true);
    });

    it('duplicate burns NO receipt number (counter untouched → no gap)', async () => {
      verifiedSlipExists = true;
      const result = await handler(validData, makeCtx());
      assert.equal(result.isDuplicate, true);
      // The receipt tx throws on the dedup read, before any write — no counter increment.
      assert.ok(!(lastTxWrites || []).some((w) => w.coll === 'counters'),
        'a duplicate slip must not consume a receipt number');
    });

    it('non-dup receipt-tx error (e.g. network) → non-blocking, resolves success', async () => {
      const err = new Error('Network error');
      err.code = 'unavailable';
      saveSlipTxThrow = err;
      const result = await handler(validData, makeCtx());
      // Non-ALREADY_EXISTS errors are non-blocking — slip is proven valid by SlipOK.
      assert.equal(result.success, true);
    });
  });

  // ── PAYMENT_VERIFIED audit row (Phase 1.1 PR 1b) ──────────────────────────
  // saveVerifiedSlip writes an immutable actionAudit row in the SAME transaction
  // as the verifiedSlips dedup + receipt number — every building, tamper-proof.
  describe('PAYMENT_VERIFIED audit row', () => {
    function findAuditOp() {
      return (lastTxWrites || []).find(
        (w) => w.coll === 'actionAudit' && w.data && w.data.action === 'PAYMENT_VERIFIED'
      );
    }

    it('success → writes a PAYMENT_VERIFIED row in the same transaction', async () => {
      const result = await handler(validData, makeCtx({ admin: true }));
      assert.equal(result.success, true);
      const audit = findAuditOp();
      assert.ok(audit, 'expected a PAYMENT_VERIFIED row set in the transaction');
      assert.equal(audit.data.targetType, 'payment');
      assert.equal(audit.data.targetId, DEFAULT_SLIP_DATA.transactionId);
      assert.equal(audit.data.building, 'rooms');
      assert.equal(audit.data.roomId, '15');
      assert.equal(audit.data.source, 'cf:verifySlip');
    });

    it('logs a rooms-building payment (not just the nest gamification path)', async () => {
      // recordPaymentAndAwardPoints returns early for non-nest; the audit must
      // still fire because it lives in saveVerifiedSlip (runs for every building).
      const result = await handler({ ...validData, building: 'rooms' }, makeCtx());
      assert.equal(result.success, true);
      assert.ok(findAuditOp(), 'rooms-building payment must still be audited');
    });

    it('actor / role / ip are stamped from the verified context, NOT client data', async () => {
      // A client that forges data.userId must NOT become the audit actor.
      const result = await handler(
        { ...validData, userId: 'CLIENT-FORGED' },
        makeCtx({ admin: true, uid: 'admin-uid-7' })
      );
      assert.equal(result.success, true);
      const audit = findAuditOp();
      assert.equal(audit.data.actor, 'admin-uid-7');   // context.auth.uid, not data.userId
      assert.notEqual(audit.data.actor, 'CLIENT-FORGED');
      assert.equal(audit.data.actorRole, 'admin');
      assert.equal(audit.data.ip, '1.2.3.4');          // context.rawRequest.ip, server-side
    });

    it('owning tenant → actorRole "tenant"', async () => {
      const result = await handler(
        validData,
        makeCtx({ admin: false, room: '15', building: 'rooms', uid: 'tenant-uid-9' })
      );
      assert.equal(result.success, true);
      const audit = findAuditOp();
      assert.equal(audit.data.actor, 'tenant-uid-9');
      assert.equal(audit.data.actorRole, 'tenant');
    });
  });

  // ── Gapless receipt number (RCP-, Roadmap 1.2a) ───────────────────────────
  // DEFAULT_SLIP_DATA.date = '2026-05-01' → BKK Buddhist-Era year 2569.
  describe('gapless receipt number', () => {
    const slipWrite = () => (lastTxWrites || []).find((w) => w.coll === 'verifiedSlips');
    const counterWrite = () => (lastTxWrites || []).find((w) => w.coll === 'counters');

    it('success → assigns RCP-{building}-{BE}-00001 on an empty counter', async () => {
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      const slip = slipWrite();
      assert.ok(slip, 'verifiedSlips doc must be written');
      assert.equal(slip.data.receiptNo, 'RCP-rooms-2569-00001');
      const ctr = counterWrite();
      assert.ok(ctr, 'counter must be set');
      assert.equal(ctr.id, 'receipt_rooms_2569');
      assert.equal(ctr.data.seq, 1);
    });

    it('increments from the existing counter (consecutive, no gap)', async () => {
      counterDocSeq = 41;
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      assert.equal(slipWrite().data.receiptNo, 'RCP-rooms-2569-00042');
      assert.equal(counterWrite().data.seq, 42);
    });

    it('nest building gets its own per-building series', async () => {
      const result = await handler({ ...validData, building: 'nest' }, makeCtx());
      assert.equal(result.success, true);
      assert.equal(slipWrite().data.receiptNo, 'RCP-nest-2569-00001');
      assert.equal(counterWrite().id, 'receipt_nest_2569');
    });

    it('receiptNo is mirrored into the PAYMENT_VERIFIED audit row', async () => {
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      const audit = (lastTxWrites || []).find((w) => w.coll === 'actionAudit');
      assert.equal(audit.data.after.receiptNo, 'RCP-rooms-2569-00001');
    });
  });

  // ── Non-blocking side effects ─────────────────────────────────────────────

  describe('non-blocking side effects', () => {
    it('markBillPaidInRTDB throws → still resolves success', async () => {
      markBillPaidShouldThrow = true;
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
    });

    it('recordPaymentAndAwardPoints throws → still resolves success', async () => {
      recordPaymentShouldThrow = true;
      const result = await handler({ ...validData, building: 'nest' }, makeCtx());
      assert.equal(result.success, true);
    });
  });

  // ── Logging ───────────────────────────────────────────────────────────────

  describe('logging', () => {
    it('success: logVerificationAttempt calls slipVerificationLog.add', async () => {
      logAddCalled = false;
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      assert.equal(logAddCalled, true);
    });
  });

  // ── Success response shape ────────────────────────────────────────────────

  describe('success response shape', () => {
    it('resolves { success:true, data:slipData, amountValid:true, amountDiff }', async () => {
      slipOkResponse = makeSlipOkOk({ amount: 1000 });
      const result = await handler(validData, makeCtx());
      assert.equal(result.success, true);
      assert.ok(result.data, 'data field must be present');
      assert.equal(result.data.transactionId, DEFAULT_SLIP_DATA.transactionId);
      assert.equal(result.data.amount, 1000);
      assert.equal(result.amountValid, true);
      assert.equal(typeof result.amountDiff, 'number');
      assert.equal(result.amountDiff, 0);
    });

    it('amountDiff is 1 when slip amount is 1 off from expected', async () => {
      slipOkResponse = makeSlipOkOk({ amount: 999 });
      const result = await handler(validData, makeCtx());
      assert.equal(result.amountDiff, 1);
    });
  });

  // ── Unexpected error ──────────────────────────────────────────────────────

  describe('unexpected error handling', () => {
    it('unexpected thrown error (getValidBuildings throws) → internal HttpsError', async () => {
      getValidBuildingsThrow = true;
      await assert.rejects(
        () => handler(validData, makeCtx()),
        (err) => err.code === 'internal'
      );
    });
  });
});
