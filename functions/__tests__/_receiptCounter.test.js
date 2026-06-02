/**
 * Unit tests for _receiptCounter.js — gapless RECEIPT number (Roadmap 1.2a).
 * Run: node --test functions/__tests__/_receiptCounter.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Stub firebase-admin before requiring the module under test.
const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  }),
};
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  return _origLoad.call(this, request, parent, isMain);
};
const { assignReceiptNo, formatReceiptNo } = require('../_receiptCounter');
Module._load = _origLoad;

// Minimal Firestore tx + db mocks.
function makeTx(existingSeq) {
  const writes = [];
  return {
    writes,
    get: async (_ref) => ({ exists: existingSeq != null, data: () => ({ seq: existingSeq }) }),
    set: (ref, data) => writes.push({ id: ref && ref._id, data }),
  };
}
const db = { collection: (name) => ({ doc: (id) => ({ _coll: name, _id: id }) }) };

describe('_receiptCounter — formatReceiptNo', () => {
  it('pads seq to 5 digits', () => {
    assert.equal(formatReceiptNo('rooms', 2569, 1), 'RCP-rooms-2569-00001');
    assert.equal(formatReceiptNo('nest', 2570, 42), 'RCP-nest-2570-00042');
    assert.equal(formatReceiptNo('rooms', 2569, 123456), 'RCP-rooms-2569-123456'); // no truncation past 5
  });
  it('sanitises the building segment', () => {
    assert.equal(formatReceiptNo('a/b.c', 2569, 1), 'RCP-a_b_c-2569-00001');
  });
  it('defaults an empty building to rooms', () => {
    assert.equal(formatReceiptNo('', 2569, 1), 'RCP-rooms-2569-00001');
  });
});

describe('_receiptCounter — assignReceiptNo', () => {
  it('starts at 00001 on an absent counter', async () => {
    const tx = makeTx(null);
    const { seq, receiptNo } = await assignReceiptNo(tx, db, { building: 'rooms', be: 2569 });
    assert.equal(seq, 1);
    assert.equal(receiptNo, 'RCP-rooms-2569-00001');
    assert.equal(tx.writes[0].id, 'receipt_rooms_2569');
    assert.equal(tx.writes[0].data.seq, 1);
    assert.equal(tx.writes[0].data.docType, 'receipt');
  });

  it('increments from the existing seq (gapless, consecutive)', async () => {
    const tx = makeTx(41);
    const { seq, receiptNo } = await assignReceiptNo(tx, db, { building: 'nest', be: 2570 });
    assert.equal(seq, 42);
    assert.equal(receiptNo, 'RCP-nest-2570-00042');
    assert.equal(tx.writes[0].id, 'receipt_nest_2570');
    assert.equal(tx.writes[0].data.seq, 42);
  });

  it('reads the counter BEFORE writing it (all-reads-before-writes contract)', async () => {
    const order = [];
    const tx = {
      get: async () => { order.push('get'); return { exists: false, data: () => ({}) }; },
      set: () => { order.push('set'); },
    };
    await assignReceiptNo(tx, db, { building: 'rooms', be: 2569 });
    assert.deepEqual(order, ['get', 'set']);
  });

  it('rejects an invalid BE year', async () => {
    await assert.rejects(() => assignReceiptNo(makeTx(null), db, { building: 'rooms', be: 1999 }), /invalid BE/);
    await assert.rejects(() => assignReceiptNo(makeTx(null), db, { building: 'rooms', be: 'x' }), /invalid BE/);
  });

  it('rejects a non-transaction writer', async () => {
    await assert.rejects(() => assignReceiptNo({}, db, { building: 'rooms', be: 2569 }), /must be a Firestore transaction/);
  });
});
