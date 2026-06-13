'use strict';
/**
 * Unit tests for clearRoomPaymentSlips.js — admin server-side reset of a room+month's
 * verifiedSlips.
 *
 * Covers: admin gate, input validation, deletion of the deterministic manual ids (BE + CE
 * legacy), inclusion of query-matched docs (explicit yearBE/month AND timestamp-derived),
 * exclusion of a different month, and the PAYMENT_RESET audit in the same batch.
 *
 * Run: node --test functions/__tests__/clearRoomPaymentSlips.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let queryDocs;   // verifiedSlips where room==roomKey
let batchOps;    // [{ op, path, doc? }]
let committed;
let autoId;

function resetStubs() { queryDocs = []; batchOps = []; committed = false; autoId = 0; }
resetStubs();

function makeRef(path) { return { path }; }

const fsInstance = {
  collection: (c) => ({
    doc: (id) => makeRef(`${c}/${id != null ? id : 'auto' + (autoId++)}`),
    where: () => ({ get: async () => ({ forEach: (cb) => queryDocs.forEach(cb) }) }),
  }),
  batch: () => ({
    delete: (ref) => batchOps.push({ op: 'delete', path: ref.path }),
    set: (ref, doc) => batchOps.push({ op: 'set', path: ref.path, doc }),
    commit: async () => { committed = true; },
  }),
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
  return _origLoad.call(this, req, parent, isMain); // _actionAudit REAL → tests PAYMENT_RESET ∈ VALID_ACTIONS
};

require('../clearRoomPaymentSlips');
const handler = capturedHandler;

const adminCtx = { auth: { uid: 'admin1', token: { admin: true, email: 'a@x.co' } }, rawRequest: { ip: '1.2.3.4' } };
const VALID = { building: 'rooms', room: '15', year: 2569, month: 5 };
const deletes = () => batchOps.filter((o) => o.op === 'delete').map((o) => o.path);
const auditOp = () => batchOps.find((o) => o.op === 'set' && o.path.startsWith('actionAudit/'));

describe('clearRoomPaymentSlips — guards', () => {
  beforeEach(resetStubs);
  it('no auth → unauthenticated', async () => {
    await assert.rejects(() => handler(VALID, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('non-admin → permission-denied', async () => {
    await assert.rejects(() => handler(VALID, { auth: { uid: 'u', token: {} } }), (e) => e.code === 'permission-denied');
    assert.equal(committed, false);
  });
  it('missing room → invalid-argument', async () => {
    await assert.rejects(() => handler({ ...VALID, room: '' }, adminCtx), (e) => e.code === 'invalid-argument');
  });
  it('bad month → invalid-argument', async () => {
    await assert.rejects(() => handler({ ...VALID, month: 0 }, adminCtx), (e) => e.code === 'invalid-argument');
  });
});

describe('clearRoomPaymentSlips — deletion set', () => {
  beforeEach(resetStubs);

  it('deletes the deterministic manual ids (BE + CE legacy) even when the room has no slips', async () => {
    const out = await handler(VALID, adminCtx);
    const d = deletes();
    assert.ok(d.includes('verifiedSlips/manual_rooms_15_2569_5'));
    assert.ok(d.includes('verifiedSlips/manual_rooms_15_2026_5'), 'CE-keyed legacy variant');
    assert.equal(out.success, true);
    assert.equal(committed, true);
  });

  it('includes query-matched docs (explicit yearBE/month AND timestamp-derived); excludes other months', async () => {
    queryDocs = [
      { id: 'mv_BANKA', data: () => ({ room: '15', yearBE: 2569, month: 5 }) },                                   // explicit match
      { id: 'TXNSLIPOK1', data: () => ({ room: '15', timestamp: { toDate: () => new Date(Date.UTC(2026, 4, 5, 5)) } }) }, // derived → 2569/5
      { id: 'mv_OTHER', data: () => ({ room: '15', yearBE: 2569, month: 4 }) },                                    // different month → excluded
    ];
    const out = await handler(VALID, adminCtx);
    const d = deletes();
    assert.ok(d.includes('verifiedSlips/mv_BANKA'));
    assert.ok(d.includes('verifiedSlips/TXNSLIPOK1'), 'SlipOK doc matched by its BKK timestamp month');
    assert.ok(!d.includes('verifiedSlips/mv_OTHER'), 'a different-month doc is NOT deleted');
    assert.equal(out.deletedIds.includes('mv_OTHER'), false);
  });

  it('writes a PAYMENT_RESET audit row in the same batch', async () => {
    const out = await handler(VALID, adminCtx);
    const a = auditOp();
    assert.ok(a, 'PAYMENT_RESET audit (real _actionAudit validated the action)');
    assert.equal(a.doc.action, 'PAYMENT_RESET');
    assert.equal(a.doc.targetId, 'rooms_15_2569_5');
    assert.equal(a.doc.roomId, '15');
    assert.ok(out.deletedCount >= 2);
  });
});
