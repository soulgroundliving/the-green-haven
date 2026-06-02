/**
 * Unit tests for assignReceiptNumber — the manual-cash gapless receipt callable.
 * Run: node --test functions/__tests__/assignReceiptNumber.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let mrExists, mrReceiptNo, counterSeq, lastTxWrites;
function resetStubs() { mrExists = false; mrReceiptNo = null; counterSeq = null; lastTxWrites = null; }
resetStubs();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({ doc: (docId) => ({ _coll: name, _id: docId }) }),
      runTransaction: async (fn) => {
        const writes = [];
        const tx = {
          get: async (ref) => {
            if (ref && ref._coll === 'manualReceipts') return { exists: mrExists, data: () => ({ receiptNo: mrReceiptNo }) };
            if (ref && ref._coll === 'counters') return { exists: counterSeq != null, data: () => ({ seq: counterSeq }) };
            return { exists: false, data: () => ({}) };
          },
          set: (ref, data) => writes.push({ coll: ref && ref._coll, id: ref && ref._id, data }),
        };
        const r = await fn(tx);
        lastTxWrites = writes;
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

const { assignReceiptNumber: handler } = require('../assignReceiptNumber');

function ctx({ uid = 'admin-1', admin = true } = {}) {
  return { auth: { uid, token: { admin } } };
}
async function throwsCode(fn, code) {
  try { await fn(); assert.fail(`expected throw with code ${code}`); }
  catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code}`); }
}
const valid = { building: 'rooms', roomId: '15', billId: 'TGH-256905-15', be: 2569 };
const findWrite = (coll) => (lastTxWrites || []).find((w) => w.coll === coll);

describe('assignReceiptNumber — auth gate', () => {
  beforeEach(resetStubs);
  it('rejects unauthenticated', async () => {
    await throwsCode(() => handler(valid, { auth: null }), 'unauthenticated');
  });
  it('rejects non-admin', async () => {
    await throwsCode(() => handler(valid, ctx({ admin: false })), 'permission-denied');
  });
});

describe('assignReceiptNumber — validation', () => {
  beforeEach(resetStubs);
  it('rejects missing building / roomId / billId', async () => {
    await throwsCode(() => handler({ roomId: '15', billId: 'b' }, ctx()), 'invalid-argument');
    await throwsCode(() => handler({ building: 'rooms', billId: 'b' }, ctx()), 'invalid-argument');
    await throwsCode(() => handler({ building: 'rooms', roomId: '15' }, ctx()), 'invalid-argument');
  });
});

describe('assignReceiptNumber — mints from the shared gapless counter', () => {
  beforeEach(resetStubs);
  it('returns RCP-{building}-{BE}-00001 on an empty counter + writes manualReceipts', async () => {
    const res = await handler(valid, ctx());
    assert.equal(res.receiptNo, 'RCP-rooms-2569-00001');
    const ctr = findWrite('counters');
    assert.equal(ctr.id, 'receipt_rooms_2569');
    assert.equal(ctr.data.seq, 1);
    const mr = findWrite('manualReceipts');
    assert.equal(mr.id, 'rooms_15_TGH-256905-15');
    assert.equal(mr.data.receiptNo, 'RCP-rooms-2569-00001');
    assert.equal(mr.data.method, 'manual_admin');
  });

  it('increments from the existing counter (shared with slip receipts)', async () => {
    counterSeq = 99;
    const res = await handler(valid, ctx());
    assert.equal(res.receiptNo, 'RCP-rooms-2569-00100');
  });

  it('nest gets its own per-building series', async () => {
    const res = await handler({ ...valid, building: 'nest' }, ctx());
    assert.equal(res.receiptNo, 'RCP-nest-2569-00001');
  });
});

describe('assignReceiptNumber — idempotent (no double-mint / no gap on retry)', () => {
  beforeEach(resetStubs);
  it('returns the existing number WITHOUT incrementing the counter', async () => {
    mrExists = true; mrReceiptNo = 'RCP-rooms-2569-00042';
    const res = await handler(valid, ctx());
    assert.equal(res.receiptNo, 'RCP-rooms-2569-00042');
    assert.ok(!findWrite('counters'), 'counter must NOT be incremented on a repeat call');
    assert.ok(!findWrite('manualReceipts'), 'no new manualReceipts write on a repeat call');
  });
});
