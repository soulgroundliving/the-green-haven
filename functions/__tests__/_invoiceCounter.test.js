/**
 * Unit tests for _invoiceCounter.js — gapless INVOICE number (Roadmap 1.2).
 * Run: node --test functions/__tests__/_invoiceCounter.test.js
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
const { assignInvoiceNo, formatInvoiceNo } = require('../_invoiceCounter');
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

describe('_invoiceCounter — formatInvoiceNo', () => {
  it('pads seq to 5 digits', () => {
    assert.equal(formatInvoiceNo('rooms', 2569, 1), 'INV-rooms-2569-00001');
    assert.equal(formatInvoiceNo('nest', 2570, 42), 'INV-nest-2570-00042');
    assert.equal(formatInvoiceNo('rooms', 2569, 123456), 'INV-rooms-2569-123456'); // no truncation past 5
  });
  it('sanitises the building segment', () => {
    assert.equal(formatInvoiceNo('a/b.c', 2569, 1), 'INV-a_b_c-2569-00001');
  });
  it('defaults an empty building to rooms', () => {
    assert.equal(formatInvoiceNo('', 2569, 1), 'INV-rooms-2569-00001');
  });
});

describe('_invoiceCounter — assignInvoiceNo', () => {
  it('starts at 00001 on an absent counter', async () => {
    const tx = makeTx(null);
    const { seq, invoiceNo } = await assignInvoiceNo(tx, db, { building: 'rooms', be: 2569 });
    assert.equal(seq, 1);
    assert.equal(invoiceNo, 'INV-rooms-2569-00001');
    assert.equal(tx.writes[0].id, 'invoice_rooms_2569');
    assert.equal(tx.writes[0].data.seq, 1);
    assert.equal(tx.writes[0].data.docType, 'invoice');
  });

  it('increments from the existing seq (gapless, consecutive)', async () => {
    const tx = makeTx(41);
    const { seq, invoiceNo } = await assignInvoiceNo(tx, db, { building: 'nest', be: 2570 });
    assert.equal(seq, 42);
    assert.equal(invoiceNo, 'INV-nest-2570-00042');
    assert.equal(tx.writes[0].id, 'invoice_nest_2570');
    assert.equal(tx.writes[0].data.seq, 42);
  });

  it('reads the counter BEFORE writing it (all-reads-before-writes contract)', async () => {
    const order = [];
    const tx = {
      get: async () => { order.push('get'); return { exists: false, data: () => ({}) }; },
      set: () => { order.push('set'); },
    };
    await assignInvoiceNo(tx, db, { building: 'rooms', be: 2569 });
    assert.deepEqual(order, ['get', 'set']);
  });

  it('rejects an invalid BE year', async () => {
    await assert.rejects(() => assignInvoiceNo(makeTx(null), db, { building: 'rooms', be: 1999 }), /invalid BE/);
    await assert.rejects(() => assignInvoiceNo(makeTx(null), db, { building: 'rooms', be: 'x' }), /invalid BE/);
  });

  it('rejects a non-transaction writer', async () => {
    await assert.rejects(() => assignInvoiceNo({}, db, { building: 'rooms', be: 2569 }), /must be a Firestore transaction/);
  });

  it('mints an INV- series independent of the RCP- receipt counter', async () => {
    // The two counters live at different doc ids (invoice_* vs receipt_*) so the
    // sequences never collide even for the same building+BE.
    const tx = makeTx(null);
    const { invoiceNo } = await assignInvoiceNo(tx, db, { building: 'rooms', be: 2569 });
    assert.match(invoiceNo, /^INV-/);
    assert.equal(tx.writes[0].id, 'invoice_rooms_2569');
  });
});
