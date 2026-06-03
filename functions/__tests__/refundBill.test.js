/**
 * Unit tests for refundBill — refund a PAID bill with an audit trail (Roadmap Phase 2).
 * Run: node --test functions/__tests__/refundBill.test.js
 *
 * Mocks firebase-admin (RTDB bills + Firestore batch) + firebase-functions/v1, mirroring
 * voidInvoice.test.js. The real _actionAudit helper runs (pure) so the BILL_REFUNDED
 * row shape + idempotencyKey are exercised end-to-end.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let billsObj;      // RTDB bills/{building}/{room} content
let rtdbUpdates;   // captured roomRef.child(id).update() calls
let batchOps;      // captured Firestore batch ops
let committed;     // batch.commit() count

function resetStubs() {
  billsObj = {
    'TGH-256905-15-3012': {
      room: '15', building: 'rooms', year: 2569, month: 5,
      status: 'paid', totalCharge: 3520, paidRef: 'TX123', receiptNo: 'RCP-rooms-2569-00001',
    },
  };
  rtdbUpdates = [];
  batchOps = [];
  committed = 0;
}
resetStubs();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({ doc: (docId) => ({ _coll: name, _id: docId || '__auto__' }) }),
      batch: () => ({
        set: (ref, data) => batchOps.push({ op: 'set', coll: ref && ref._coll, id: ref && ref._id, data }),
        commit: async () => { committed++; },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    const databaseFn = () => ({
      ref: (path) => ({
        _path: path,
        once: async () => ({ val: () => billsObj }),
        child: (childId) => ({ update: async (data) => { rtdbUpdates.push({ id: childId, data }); } }),
      }),
    });
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn, database: databaseFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    return { region: () => ({ https: { onCall: (h) => h } }), https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { refundBill: handler } = require('../refundBill');

function ctx({ uid = 'admin-1', admin = true, email = 'a@x.io' } = {}) {
  return { auth: { uid, token: { admin, email } }, rawRequest: { ip: '203.0.113.7' } };
}
async function throwsCode(fn, code) {
  try { await fn(); assert.fail(`expected throw with code ${code}`); }
  catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code}`); }
}
const valid = { building: 'rooms', room: '15', year: 2569, month: 5, reason: 'ผู้เช่าย้ายออกก่อนกำหนด' };
const auditOp = () => (batchOps || []).find((o) => o.op === 'set' && o.coll === 'actionAudit');

describe('refundBill — auth gate', () => {
  beforeEach(resetStubs);
  it('rejects unauthenticated', async () => {
    await throwsCode(() => handler(valid, { auth: null }), 'unauthenticated');
  });
  it('rejects non-admin', async () => {
    await throwsCode(() => handler(valid, ctx({ admin: false })), 'permission-denied');
  });
});

describe('refundBill — validation', () => {
  beforeEach(resetStubs);
  it('rejects a missing room', async () => {
    await throwsCode(() => handler({ ...valid, room: '' }, ctx()), 'invalid-argument');
  });
  it('rejects an invalid month', async () => {
    await throwsCode(() => handler({ ...valid, month: 13 }, ctx()), 'invalid-argument');
  });
  it('rejects a missing / blank reason (reason is audit-required)', async () => {
    await throwsCode(() => handler({ ...valid, reason: '' }, ctx()), 'invalid-argument');
    await throwsCode(() => handler({ ...valid, reason: '   ' }, ctx()), 'invalid-argument');
  });
});

describe('refundBill — not found / not paid', () => {
  beforeEach(resetStubs);
  it('throws not-found when no bill exists for the period', async () => {
    billsObj = {};
    await throwsCode(() => handler(valid, ctx()), 'not-found');
  });
  it('throws failed-precondition when the period bill is not paid', async () => {
    billsObj = { B1: { room: '15', year: 2569, month: 5, status: 'pending', totalCharge: 3520 } };
    await throwsCode(() => handler(valid, ctx()), 'failed-precondition');
    assert.equal(rtdbUpdates.length, 0, 'no flip on a non-paid bill');
    assert.ok(!auditOp(), 'no audit row on a non-paid bill');
  });
});

describe('refundBill — refunds + writes the audit trail', () => {
  beforeEach(resetStubs);

  it('flips the bill to refunded with refundedBy/refundReason and returns the amount', async () => {
    const res = await handler(valid, ctx());
    assert.equal(res.alreadyRefunded, false);
    assert.equal(res.billId, 'TGH-256905-15-3012');
    assert.equal(res.amount, 3520);
    assert.equal(rtdbUpdates.length, 1);
    const upd = rtdbUpdates[0];
    assert.equal(upd.id, 'TGH-256905-15-3012');
    assert.equal(upd.data.status, 'refunded');
    assert.equal(upd.data.refundedBy, 'admin-1');
    assert.equal(upd.data.refundReason, 'ผู้เช่าย้ายออกก่อนกำหนด');
    assert.equal(typeof upd.data.refundedAt, 'number');
  });

  it('writes a BILL_REFUNDED audit row with server-stamped actor + before/after', async () => {
    await handler(valid, ctx());
    const audit = auditOp();
    assert.ok(audit, 'a BILL_REFUNDED audit row must be written');
    assert.equal(audit.data.action, 'BILL_REFUNDED');
    assert.equal(audit.data.actor, 'admin-1');
    assert.equal(audit.data.actorEmail, 'a@x.io');
    assert.equal(audit.data.actorRole, 'admin');
    assert.equal(audit.data.targetType, 'bill');
    assert.equal(audit.data.targetId, 'TGH-256905-15-3012');
    assert.equal(audit.data.building, 'rooms');
    assert.equal(audit.data.roomId, '15');
    assert.equal(audit.data.ip, '203.0.113.7');
    assert.equal(audit.data.before.status, 'paid');
    assert.equal(audit.data.before.amount, 3520);
    assert.equal(audit.data.after.status, 'refunded');
    assert.equal(audit.data.after.reason, 'ผู้เช่าย้ายออกก่อนกำหนด');
    assert.equal(committed, 1, 'the audit batch is committed');
  });

  it('uses a deterministic idempotencyKey (retry rewrites the same audit row)', async () => {
    await handler(valid, ctx());
    const audit = auditOp();
    assert.equal(audit.id, 'refund_rooms_15_256905');
  });

  it('matches a bill stored with a 2-digit BE year', async () => {
    billsObj = { B1: { room: '15', year: 69, month: 5, status: 'paid', totalCharge: 1200 } };
    const res = await handler(valid, ctx());
    assert.equal(res.alreadyRefunded, false);
    assert.equal(res.amount, 1200);
    assert.equal(rtdbUpdates[0].data.status, 'refunded');
  });

  it('never hard-deletes — only an RTDB update + an audit set', async () => {
    await handler(valid, ctx());
    assert.equal(rtdbUpdates.length, 1);
    assert.equal((batchOps || []).filter((o) => o.op === 'set' && o.coll === 'actionAudit').length, 1);
  });

  it('ignores a client-supplied actor (actor is stamped from context, not data)', async () => {
    await handler({ ...valid, actor: 'evil-uid', actorRole: 'superadmin' }, ctx({ uid: 'real-admin' }));
    const audit = auditOp();
    assert.equal(audit.data.actor, 'real-admin');
    assert.equal(audit.data.actorRole, 'admin');
  });
});

describe('refundBill — idempotent', () => {
  beforeEach(resetStubs);
  it('an already-refunded bill returns alreadyRefunded without a second flip or audit row', async () => {
    billsObj = { B1: { room: '15', year: 2569, month: 5, status: 'refunded', totalCharge: 3520 } };
    const res = await handler(valid, ctx());
    assert.equal(res.alreadyRefunded, true);
    assert.equal(res.billId, 'B1');
    assert.equal(rtdbUpdates.length, 0, 'no second flip on an already-refunded bill');
    assert.ok(!auditOp(), 'no duplicate BILL_REFUNDED row');
  });
});
