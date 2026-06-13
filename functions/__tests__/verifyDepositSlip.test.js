'use strict';
/**
 * Unit tests for verifyDepositSlip.js — admin SlipOK verify of a pre-move-in deposit
 * payment (single room OR lump multi-room).
 *
 * Covers: admin auth gate, allocations validation (shape, cap, dup-room, amount),
 * §7-EEE data: prefix strip, §7-YY global-FormData body, SlipOK call + SCB-delay,
 * HARD amount = Σ allocations (±1) reject, txid safety, verifiedSlips dedup fence,
 * missing/terminal deposit guards, per-room paidSoFar accrual + clamp, payments[]
 * txid/lumpRef/slipPath stamps, DEPOSIT_VERIFIED audit, storage non-fatal, rate limit.
 *
 * Run: node --test functions/__tests__/verifyDepositSlip.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Per-test mutable state ────────────────────────────────────────────────────
let slipOkApiResponse;
let rateLimitState;          // keyed by path; missing = window doesn't exist → allowed
let verifiedExists;          // verifiedSlips/{txid} already present?
let depositDocs;             // keyed by 'deposits/{b}_{r}'
let txSets;                  // [{ path, data, opts }]
let storageSaveShouldThrow;
let slipOkFetchCalled;
let capturedFetchOpts;
let autoId;

function resetStubs() {
  slipOkApiResponse = {
    ok: true, status: 200,
    text: async () => JSON.stringify({
      success: true,
      data: {
        transactionId: 'TXN123456', amount: 3000,
        sender: { displayName: 'Alice' }, receiver: { displayName: 'Bob' },
        date: '2026-06-13', sendingBankCode: '014',
      },
    }),
  };
  rateLimitState = {};
  verifiedExists = false;
  depositDocs = {
    'deposits/rooms_20': {
      status: 'reserved', amount: 9000, paidSoFar: 500, building: 'rooms', roomId: '20',
      payments: [{ label: 'จอง', amount: 500, method: 'cash' }],
    },
    'deposits/rooms_21': {
      status: 'reserved', amount: 9000, paidSoFar: 0, building: 'rooms', roomId: '21', payments: [],
    },
  };
  txSets = [];
  storageSaveShouldThrow = null;
  slipOkFetchCalled = false;
  capturedFetchOpts = null;
  autoId = 0;
}
resetStubs();

// ── Firestore ref (supports direct rateLimits ops + tx path matching) ─────────
function makeRef(path) {
  return {
    path,
    get: async () => {
      const ex = rateLimitState[path] || null;
      return { exists: ex !== null, data: () => ex };
    },
    set: async () => {},
    update: async () => {},
  };
}

const fsInstance = {
  collection: (coll) => ({ doc: (id) => makeRef(`${coll}/${id != null ? id : 'auto' + (autoId++)}`) }),
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => {
        if (ref.path.startsWith('rateLimits/')) {
          const ex = rateLimitState[ref.path] || null;
          return { exists: ex !== null, data: () => ex };
        }
        if (ref.path === 'verifiedSlips/TXN123456') {
          return { exists: verifiedExists, data: () => (verifiedExists ? { transactionId: 'TXN123456' } : null) };
        }
        if (ref.path.startsWith('deposits/')) {
          const d = depositDocs[ref.path];
          return { exists: !!d, data: () => d || null };
        }
        return { exists: false, data: () => null };
      },
      // rateLimits writes are bookkeeping — keep them out of txSets so the deposit/
      // verifiedSlips/audit assertions stay precise (the transactional rate-limiter
      // runs 3 windows before the main tx).
      set: (ref, data, opts) => { if (ref.path.startsWith('rateLimits/')) return; txSets.push({ path: ref.path, data, opts: opts || null }); },
      update: () => {},
    };
    return fn(tx);
  },
};

const storageInstance = {
  bucket: () => ({ file: () => ({ save: async () => { if (storageSaveShouldThrow) throw storageSaveShouldThrow; } }) }),
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, {
    FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL', increment: (n) => n },
  }),
  storage: () => storageInstance,
};

const fetchStub = async (url, opts) => { slipOkFetchCalled = true; capturedFetchOpts = opts; return slipOkApiResponse; };

const HttpsError = class extends Error { constructor(code, msg) { super(msg); this.code = code; } };

let capturedHandler;
const functionsStub = {
  region: () => functionsStub,
  runWith: () => functionsStub,
  https: { onCall: (h) => { capturedHandler = h; return 'cf'; }, HttpsError },
};
const paramStub = {
  defineSecret: () => ({ value: () => 'apikey123' }),
  defineString: () => ({ value: () => 'https://slipok.example.com' }),
};

const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return adminStub;
  if (req === 'firebase-functions/v1') return functionsStub;
  if (req === 'firebase-functions/params') return paramStub;
  return _origLoad.call(this, req, parent, isMain); // _actionAudit loads REAL (tests DEPOSIT_VERIFIED ∈ VALID_ACTIONS)
};

global.fetch = fetchStub;
require('../verifyDepositSlip');
const handler = capturedHandler;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const adminCtx = { auth: { uid: 'admin1', token: { admin: true, email: 'a@x.co' } } };
const validFile = Buffer.from('x'.repeat(200)).toString('base64'); // → jpeg default, ≥100 bytes
const single = (amount = 3000) => ({ allocations: [{ building: 'rooms', roomId: '20', amount }], file: validFile });
const lump = (a = 3000, b = 3000) => ({ allocations: [{ building: 'rooms', roomId: '20', amount: a }, { building: 'rooms', roomId: '21', amount: b }], file: validFile });
const setSlipAmount = (amount) => { slipOkApiResponse = { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { transactionId: 'TXN123456', amount, sender: { displayName: 'A' }, receiver: { displayName: 'B' }, date: '2026-06-13', sendingBankCode: '014' } }) }; };
const setOf = (path) => txSets.find((s) => s.path === path);

// ── Auth ────────────────────────────────────────────────────────────────────
describe('verifyDepositSlip — auth', () => {
  beforeEach(resetStubs);
  it('no auth → unauthenticated', async () => {
    await assert.rejects(() => handler(single(), { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('non-admin → permission-denied', async () => {
    await assert.rejects(() => handler(single(), { auth: { uid: 'u1', token: { role: 'tenant' } } }), (e) => e.code === 'permission-denied');
    assert.equal(txSets.length, 0, 'no writes on a denied call');
  });
});

// ── Input validation ──────────────────────────────────────────────────────────
describe('verifyDepositSlip — input validation', () => {
  beforeEach(resetStubs);
  it('missing allocations → invalid-argument', async () => {
    await assert.rejects(() => handler({ file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('empty allocations → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [], file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('too many allocations (> 20) → invalid-argument', async () => {
    const allocations = Array.from({ length: 21 }, (_, i) => ({ building: 'rooms', roomId: `r${i}`, amount: 10 }));
    await assert.rejects(() => handler({ allocations, file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('bad building/roomId → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'a/b', roomId: '20', amount: 10 }], file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('amount ≤ 0 → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 0 }], file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('duplicate room in allocations → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 10 }, { building: 'rooms', roomId: '20', amount: 10 }], file: validFile }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('missing file → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 10 }] }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('file too large → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 10 }], file: 'a'.repeat(7 * 1024 * 1024 + 1) }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('buffer < 100 bytes after decode → invalid-argument', async () => {
    await assert.rejects(() => handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 10 }], file: Buffer.from('xx').toString('base64') }, adminCtx), (e) => e.code === 'invalid-argument');
  });
});

// ── §7-EEE / §7-YY ─────────────────────────────────────────────────────────────
describe('verifyDepositSlip — slip transport', () => {
  beforeEach(resetStubs);
  it('§7-EEE: a full data: URL is stripped before decode → success', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('x'.repeat(200))]);
    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    setSlipAmount(3000);
    const r = await handler({ allocations: [{ building: 'rooms', roomId: '20', amount: 3000 }], file: dataUrl }, adminCtx);
    assert.equal(r.success, true);
    assert.ok(slipOkFetchCalled);
  });
  it('§7-YY: fetch body is a global FormData with a Blob files entry, no Content-Type', async () => {
    await handler(single(3000), adminCtx);
    const body = capturedFetchOpts && capturedFetchOpts.body;
    assert.ok(body instanceof FormData, 'body must be a global FormData');
    assert.ok(body.get('files') instanceof Blob, 'files entry must be a Blob');
    assert.ok(body.get('files').size > 100);
    const headerKeys = Object.keys((capturedFetchOpts && capturedFetchOpts.headers) || {}).map((k) => k.toLowerCase());
    assert.ok(!headerKeys.includes('content-type'), 'undici must derive the boundary');
  });
});

// ── SlipOK call outcomes ───────────────────────────────────────────────────────
describe('verifyDepositSlip — SlipOK outcomes', () => {
  beforeEach(resetStubs);
  it('SCB delay → retryable shape (no writes)', async () => {
    slipOkApiResponse = { ok: false, status: 400, text: async () => '{"success":false,"message":"SCB","code":1010}' };
    const r = await handler(single(3000), adminCtx);
    assert.equal(r.success, false);
    assert.equal(r.code, 'scb_delay');
    assert.equal(txSets.length, 0);
  });
  it('non-JSON SlipOK → failed-precondition', async () => {
    slipOkApiResponse = { ok: true, status: 200, text: async () => 'not json' };
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'failed-precondition');
  });
  it('unsafe transactionId → failed-precondition', async () => {
    slipOkApiResponse = { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { transactionId: 'AB', amount: 3000 } }) };
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'failed-precondition');
  });
  it('transactionId absent → falls back to transRef', async () => {
    slipOkApiResponse = { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { transRef: 'TXNFROMREF99', amount: 3000, sender: { displayName: 'A' }, receiver: { displayName: 'B' } } }) };
    const r = await handler(single(3000), adminCtx);
    assert.equal(r.success, true);
    assert.equal(r.transactionId, 'TXNFROMREF99');
  });
  it('SlipOK non-positive amount → failed-precondition (explicit guard)', async () => {
    setSlipAmount(0);
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'failed-precondition');
  });
});

// ── Amount validation (HARD) ───────────────────────────────────────────────────
describe('verifyDepositSlip — amount = Σ allocations (±฿1)', () => {
  beforeEach(resetStubs);
  it('single: slip == alloc → success', async () => {
    setSlipAmount(3000);
    assert.equal((await handler(single(3000), adminCtx)).success, true);
  });
  it('single: diff = 1 → success (tolerance)', async () => {
    setSlipAmount(3000);
    assert.equal((await handler(single(3001), adminCtx)).success, true);
  });
  it('single: diff = 2 → failed-precondition', async () => {
    setSlipAmount(3000);
    await assert.rejects(() => handler(single(3002), adminCtx), (e) => e.code === 'failed-precondition');
    assert.equal(txSets.length, 0);
  });
  it('lump: Σ allocs == slip → success', async () => {
    setSlipAmount(6000);
    assert.equal((await handler(lump(3000, 3000), adminCtx)).success, true);
  });
  it('lump: Σ allocs != slip → failed-precondition', async () => {
    setSlipAmount(6000);
    await assert.rejects(() => handler(lump(3000, 2000), adminCtx), (e) => e.code === 'failed-precondition');
  });
});

// ── Dedup + deposit-state guards ───────────────────────────────────────────────
describe('verifyDepositSlip — dedup + deposit guards', () => {
  beforeEach(resetStubs);
  it('verifiedSlips/{txid} already exists → already-exists', async () => {
    setSlipAmount(3000); verifiedExists = true;
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'already-exists');
  });
  it('deposit doc missing → not-found', async () => {
    setSlipAmount(3000); delete depositDocs['deposits/rooms_20'];
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'not-found');
  });
  it('deposit already returned → failed-precondition', async () => {
    setSlipAmount(3000); depositDocs['deposits/rooms_20'].status = 'returned';
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'failed-precondition');
  });
  it('deposit forfeited → failed-precondition', async () => {
    setSlipAmount(3000); depositDocs['deposits/rooms_20'].status = 'forfeited';
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'failed-precondition');
  });
});

// ── Happy path — single ─────────────────────────────────────────────────────────
describe('verifyDepositSlip — single-room happy path', () => {
  beforeEach(resetStubs);
  it('accrues paidSoFar + stamps payment(txid,slipPath), writes verifiedSlips source:deposit + DEPOSIT_VERIFIED audit', async () => {
    setSlipAmount(3000);
    const r = await handler(single(3000), adminCtx);
    assert.equal(r.success, true);
    assert.equal(r.lump, false);
    assert.equal(r.transactionId, 'TXN123456');
    assert.deepEqual(r.allocations, [{ building: 'rooms', roomId: '20', amount: 3000, paidSoFar: 3500 }]);

    const dep = setOf('deposits/rooms_20');
    assert.ok(dep && dep.opts.merge);
    assert.equal(dep.data.paidSoFar, 3500, '500 + 3000');
    const last = dep.data.payments[dep.data.payments.length - 1];
    assert.equal(last.method, 'slip');
    assert.equal(last.amount, 3000);
    assert.equal(last.txid, 'TXN123456');
    assert.equal(last.slipPath, 'deposits/rooms/20/payment_TXN123456.jpg');
    assert.equal(last.lumpRef, undefined, 'single room → no lumpRef');

    const vs = setOf('verifiedSlips/TXN123456');
    assert.ok(vs);
    assert.equal(vs.data.source, 'deposit');
    assert.equal(vs.data.amount, 3000);
    assert.deepEqual(vs.data.allocations, [{ building: 'rooms', roomId: '20', amount: 3000 }]);

    const audit = setOf('actionAudit/deposit_slip_TXN123456');
    assert.ok(audit, 'DEPOSIT_VERIFIED audit row must be written (real _actionAudit validated the action)');
    assert.equal(audit.data.action, 'DEPOSIT_VERIFIED');
    assert.equal(audit.data.targetId, 'rooms_20');
  });
  it('paidSoFar clamps to the deposit amount on overpay', async () => {
    setSlipAmount(9000); depositDocs['deposits/rooms_20'].paidSoFar = 8000;
    await handler(single(9000), adminCtx);
    assert.equal(setOf('deposits/rooms_20').data.paidSoFar, 9000, 'clamped to amount, not 17000');
  });
  it('a holding (already-moved-in) deposit also accepts a slip credit (guard allows non-reserved)', async () => {
    setSlipAmount(3000); depositDocs['deposits/rooms_20'].status = 'holding';
    const r = await handler(single(3000), adminCtx);
    assert.equal(r.success, true);
    assert.equal(setOf('deposits/rooms_20').data.paidSoFar, 3500);
  });
});

// ── Happy path — lump ────────────────────────────────────────────────────────────
describe('verifyDepositSlip — lump multi-room', () => {
  beforeEach(resetStubs);
  it('credits BOTH rooms, stamps lumpRef=txid on each, single audit, allocations[] on the slip', async () => {
    setSlipAmount(6000);
    const r = await handler(lump(3000, 3000), adminCtx);
    assert.equal(r.lump, true);
    assert.equal(r.allocations.length, 2);

    const d20 = setOf('deposits/rooms_20');
    const d21 = setOf('deposits/rooms_21');
    assert.equal(d20.data.paidSoFar, 3500);
    assert.equal(d21.data.paidSoFar, 3000);
    assert.equal(d20.data.payments.at(-1).lumpRef, 'TXN123456');
    assert.equal(d21.data.payments.at(-1).lumpRef, 'TXN123456');
    // both reference the ONE stored slip
    assert.equal(d20.data.payments.at(-1).slipPath, 'deposits/rooms/20/payment_TXN123456.jpg');
    assert.equal(d21.data.payments.at(-1).slipPath, 'deposits/rooms/20/payment_TXN123456.jpg');

    const vs = setOf('verifiedSlips/TXN123456');
    assert.equal(vs.data.allocations.length, 2);

    const audit = setOf('actionAudit/deposit_slip_TXN123456');
    assert.equal(audit.data.targetId, 'TXN123456', 'lump audit keys on the txid');
    assert.equal(audit.data.building, null);
  });
  it('lump where one room is missing → not-found, NO partial credit (tx atomicity)', async () => {
    setSlipAmount(6000); delete depositDocs['deposits/rooms_21'];
    await assert.rejects(() => handler(lump(3000, 3000), adminCtx), (e) => e.code === 'not-found');
    assert.equal(setOf('deposits/rooms_20'), undefined, 'room 20 must NOT be credited when the tx aborts on the missing sibling');
  });
});

// ── Storage non-fatal + rate limit ───────────────────────────────────────────────
describe('verifyDepositSlip — storage + rate limit', () => {
  beforeEach(resetStubs);
  it('storage upload throws → still success (slip already recorded)', async () => {
    setSlipAmount(3000); storageSaveShouldThrow = new Error('storage down');
    assert.equal((await handler(single(3000), adminCtx)).success, true);
  });
  it('rate limit window at max → resource-exhausted (no SlipOK call)', async () => {
    rateLimitState['rateLimits/deposit_admin1_minute'] = { count: 10, windowStart: Date.now() };
    await assert.rejects(() => handler(single(3000), adminCtx), (e) => e.code === 'resource-exhausted');
    assert.equal(slipOkFetchCalled, false, 'rate limit short-circuits before SlipOK');
  });
});
