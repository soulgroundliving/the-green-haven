/**
 * Unit tests for voidInvoice — void an issued invoice with an audit trail (Roadmap 1.3).
 * Run: node --test functions/__tests__/voidInvoice.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let invExists, invData, txOps;
function resetStubs() {
  invExists = true;
  invData = { invoiceNo: 'INV-rooms-2569-00001', building: 'rooms', room: '15', status: 'issued', amount: 3520 };
  txOps = null;
}
resetStubs();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({ doc: (docId) => ({ _coll: name, _id: docId }) }),
      runTransaction: async (fn) => {
        const ops = [];
        const tx = {
          get: async (ref) => {
            if (ref && ref._coll === 'invoices') return { exists: invExists, data: () => invData };
            return { exists: false, data: () => ({}) };
          },
          update: (ref, data) => ops.push({ op: 'update', coll: ref && ref._coll, id: ref && ref._id, data }),
          set: (ref, data) => ops.push({ op: 'set', coll: ref && ref._coll, id: ref && ref._id, data }),
        };
        const r = await fn(tx);
        txOps = ops;
        return r;
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    return { region: () => ({ https: { onCall: (h) => h } }), https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { voidInvoice: handler } = require('../voidInvoice');

function ctx({ uid = 'admin-1', admin = true, email = 'a@x.io' } = {}) {
  return { auth: { uid, token: { admin, email } }, rawRequest: { ip: '203.0.113.7' } };
}
async function throwsCode(fn, code) {
  try { await fn(); assert.fail(`expected throw with code ${code}`); }
  catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code}`); }
}
const valid = { invoiceId: 'rooms_15_256905', reason: 'แก้ค่ามิเตอร์ผิด' };
const findOp = (op, coll) => (txOps || []).find((o) => o.op === op && o.coll === coll);

describe('voidInvoice — auth gate', () => {
  beforeEach(resetStubs);
  it('rejects unauthenticated', async () => {
    await throwsCode(() => handler(valid, { auth: null }), 'unauthenticated');
  });
  it('rejects non-admin', async () => {
    await throwsCode(() => handler(valid, ctx({ admin: false })), 'permission-denied');
  });
});

describe('voidInvoice — validation', () => {
  beforeEach(resetStubs);
  it('rejects a missing invoiceId', async () => {
    await throwsCode(() => handler({ reason: 'x' }, ctx()), 'invalid-argument');
  });
  it('rejects a missing / blank reason (reason is audit-required)', async () => {
    await throwsCode(() => handler({ invoiceId: 'rooms_15_256905' }, ctx()), 'invalid-argument');
    await throwsCode(() => handler({ invoiceId: 'rooms_15_256905', reason: '   ' }, ctx()), 'invalid-argument');
  });
});

describe('voidInvoice — not found', () => {
  beforeEach(resetStubs);
  it('throws not-found when the invoice does not exist', async () => {
    invExists = false;
    await throwsCode(() => handler(valid, ctx()), 'not-found');
  });
});

describe('voidInvoice — voids + writes the audit trail', () => {
  beforeEach(resetStubs);

  it('flips status to void with voidedBy/voidReason and returns the invoiceNo', async () => {
    const res = await handler(valid, ctx());
    assert.equal(res.alreadyVoid, false);
    assert.equal(res.invoiceNo, 'INV-rooms-2569-00001');
    const upd = findOp('update', 'invoices');
    assert.ok(upd, 'invoices doc must be updated');
    assert.equal(upd.id, 'rooms_15_256905');
    assert.equal(upd.data.status, 'void');
    assert.equal(upd.data.voidedBy, 'admin-1');
    assert.equal(upd.data.voidReason, 'แก้ค่ามิเตอร์ผิด');
    assert.equal(upd.data.voidedAt, SERVER_TS);
  });

  it('writes a BILL_VOIDED audit row with server-stamped actor + before/after', async () => {
    await handler(valid, ctx());
    const audit = findOp('set', 'actionAudit');
    assert.ok(audit, 'a BILL_VOIDED audit row must be written in the same tx');
    assert.equal(audit.data.action, 'BILL_VOIDED');
    assert.equal(audit.data.actor, 'admin-1');
    assert.equal(audit.data.actorEmail, 'a@x.io');
    assert.equal(audit.data.actorRole, 'admin');
    assert.equal(audit.data.targetType, 'invoice');
    assert.equal(audit.data.targetId, 'INV-rooms-2569-00001');
    assert.equal(audit.data.ip, '203.0.113.7');
    assert.equal(audit.data.before.status, 'issued');
    assert.equal(audit.data.before.amount, 3520);
    assert.equal(audit.data.after.status, 'void');
    assert.equal(audit.data.after.reason, 'แก้ค่ามิเตอร์ผิด');
  });

  it('never hard-deletes — only an update + an audit set (the original survives)', async () => {
    await handler(valid, ctx());
    assert.equal((txOps || []).filter((o) => o.op === 'update' && o.coll === 'invoices').length, 1);
    assert.equal((txOps || []).filter((o) => o.op === 'set' && o.coll === 'actionAudit').length, 1);
    // No delete op exists in the tx surface — void is a state transition, not a delete.
    assert.ok(!(txOps || []).some((o) => o.op === 'delete'));
  });

  it('ignores a client-supplied actor (actor is stamped from context, not data)', async () => {
    await handler({ ...valid, actor: 'evil-uid', actorRole: 'superadmin' }, ctx({ uid: 'real-admin' }));
    const audit = findOp('set', 'actionAudit');
    assert.equal(audit.data.actor, 'real-admin');
    assert.equal(audit.data.actorRole, 'admin');
  });
});

describe('voidInvoice — idempotent', () => {
  beforeEach(resetStubs);
  it('an already-void invoice returns alreadyVoid without a second write or audit row', async () => {
    invData = { ...invData, status: 'void' };
    const res = await handler(valid, ctx());
    assert.equal(res.alreadyVoid, true);
    assert.equal(res.invoiceNo, 'INV-rooms-2569-00001');
    assert.ok(!findOp('update', 'invoices'), 'no second update on an already-void invoice');
    assert.ok(!findOp('set', 'actionAudit'), 'no duplicate BILL_VOIDED row');
  });
});
