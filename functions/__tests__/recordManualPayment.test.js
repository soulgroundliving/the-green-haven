'use strict';
/**
 * Unit tests for recordManualPayment.js — admin server-side MANUAL payment write.
 *
 * Covers: admin gate, input validation (cash + override), the dedup guard (never clobber
 * a CF-written canonical SlipOK doc), server-stamped verifiedBy/ip (not client), the
 * deterministic ids (manual_… / mv_…), year normalization, and the BILL_PAID_MANUAL audit.
 *
 * Run: node --test functions/__tests__/recordManualPayment.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let existingVerified;   // the doc at the target verifiedSlips id (null = absent)
let txSets;             // [{ path, doc, opts }]
let autoId;

function resetStubs() { existingVerified = null; txSets = []; autoId = 0; }
resetStubs();

function makeRef(path) { return { path }; }

const fsInstance = {
  collection: (c) => ({ doc: (id) => makeRef(`${c}/${id != null ? id : 'auto' + (autoId++)}`) }),
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => {
        if (ref.path.startsWith('verifiedSlips/')) return { exists: existingVerified !== null, data: () => existingVerified };
        return { exists: false, data: () => null };
      },
      set: (ref, doc, opts) => { txSets.push({ path: ref.path, doc, opts: opts || null }); },
    };
    return fn(tx);
  },
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => fsInstance, { FieldValue: { serverTimestamp: () => 'TS' } }),
};

const HttpsError = class extends Error { constructor(code, msg) { super(msg); this.code = code; } };
let capturedHandler;
const functionsStub = {
  region: () => ({ https: { onCall: (h) => { capturedHandler = h; return 'cf'; } } }),
  https: { HttpsError },
};

const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return adminStub;
  if (req === 'firebase-functions/v1') return functionsStub;
  return _origLoad.call(this, req, parent, isMain); // _actionAudit loads REAL (tests BILL_PAID_MANUAL ∈ VALID_ACTIONS)
};

require('../recordManualPayment');
const handler = capturedHandler;

const adminCtx = { auth: { uid: 'admin1', token: { admin: true, email: 'a@x.co' } }, rawRequest: { ip: '1.2.3.4' } };
const cash = (over = {}) => ({ building: 'rooms', room: '15', year: 2569, month: 5, amount: 3000, mode: 'cash', ...over });
const override = (over = {}) => ({ building: 'rooms', room: '15', year: 2569, month: 5, amount: 3000, mode: 'override', txid: 'BANKREF99', overrideReason: 'checked statement', ...over });
const setOf = (path) => txSets.find((s) => s.path === path);

describe('recordManualPayment — auth', () => {
  beforeEach(resetStubs);
  it('no auth → unauthenticated', async () => {
    await assert.rejects(() => handler(cash(), { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('non-admin → permission-denied', async () => {
    await assert.rejects(() => handler(cash(), { auth: { uid: 'u', token: {} } }), (e) => e.code === 'permission-denied');
    assert.equal(txSets.length, 0);
  });
});

describe('recordManualPayment — input validation', () => {
  beforeEach(resetStubs);
  it('missing room → invalid-argument', async () => {
    await assert.rejects(() => handler(cash({ room: '' }), adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('bad month → invalid-argument', async () => {
    await assert.rejects(() => handler(cash({ month: 13 }), adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('amount ≤ 0 → invalid-argument', async () => {
    await assert.rejects(() => handler(cash({ amount: 0 }), adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('override without txid → invalid-argument', async () => {
    await assert.rejects(() => handler(override({ txid: '' }), adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('override without reason → invalid-argument', async () => {
    await assert.rejects(() => handler(override({ overrideReason: '' }), adminCtx), (e) => e.code === 'invalid-argument');
  });
});

describe('recordManualPayment — cash happy path', () => {
  beforeEach(resetStubs);
  it('writes the deterministic manual doc (manualEntry) + server-stamps + BILL_PAID_MANUAL audit', async () => {
    const out = await handler(cash(), adminCtx);
    assert.deepEqual(out, { success: true, docId: 'manual_rooms_15_2569_5', action: 'written' });
    const vs = setOf('verifiedSlips/manual_rooms_15_2569_5');
    assert.ok(vs);
    assert.equal(vs.doc.manualEntry, true);
    assert.equal(vs.doc.manualOverride, undefined);
    assert.equal(vs.doc.amount, 3000);
    assert.equal(vs.doc.yearBE, 2569);
    assert.equal(vs.doc.month, 5);
    assert.equal(vs.doc.verifiedBy, 'a@x.co', 'server-stamped from token, not client');
    assert.equal(vs.doc.recordedByUid, 'admin1');
    assert.equal(vs.doc.ip, '1.2.3.4');
    assert.equal(vs.opts.merge, true);
    const audit = setOf('actionAudit/manualpay_manual_rooms_15_2569_5');
    assert.ok(audit, 'BILL_PAID_MANUAL audit row (real _actionAudit validated the action)');
    assert.equal(audit.doc.action, 'BILL_PAID_MANUAL');
    assert.equal(audit.doc.targetType, 'payment');
  });
  it('normalizes a 2-digit BE year into the 4-digit docId', async () => {
    const out = await handler(cash({ year: 69 }), adminCtx);
    assert.equal(out.docId, 'manual_rooms_15_2569_5');
  });
});

describe('recordManualPayment — override happy path', () => {
  beforeEach(resetStubs);
  it('writes mv_<txid> with manualOverride + bankStatementConfirmed + reason', async () => {
    const out = await handler(override(), adminCtx);
    assert.equal(out.docId, 'mv_BANKREF99');
    const vs = setOf('verifiedSlips/mv_BANKREF99');
    assert.ok(vs);
    assert.equal(vs.doc.manualOverride, true);
    assert.equal(vs.doc.bankStatementConfirmed, true);
    assert.equal(vs.doc.overrideReason, 'checked statement');
    assert.equal(vs.doc.manualEntry, undefined);
  });
});

describe('recordManualPayment — dedup guard', () => {
  beforeEach(resetStubs);
  it('NEVER clobbers an existing canonical SlipOK doc (no manual flag) → noop_canonical', async () => {
    existingVerified = { transactionId: 'BANKREF99', verified: true, amount: 3000 }; // CF-written SlipOK, no manual flag
    const out = await handler(override(), adminCtx);
    assert.equal(out.action, 'noop_canonical');
    assert.equal(txSets.length, 0, 'no write, no audit — the canonical record is untouched');
  });
  it('overwrites an existing MANUAL doc (re-mark) → written', async () => {
    existingVerified = { manualEntry: true, amount: 1000 };
    const out = await handler(cash({ amount: 3000 }), adminCtx);
    assert.equal(out.action, 'written');
    assert.equal(setOf('verifiedSlips/manual_rooms_15_2569_5').doc.amount, 3000);
  });
});
