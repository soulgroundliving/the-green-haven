/**
 * Unit tests for _billFlex.js — computeBill + buildBillFlex + buildReceiptFlex.
 *
 * Pure-function tests: no Firebase, no network. These run in milliseconds and
 * guard against regressions in the LINE Flex message output.
 *
 * Run: node --test functions/__tests__/billFlex.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Stub firebase-admin before requiring _billFlex (it calls initializeApp at module level)
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, ...rest) {
  if (id === 'firebase-admin') {
    return {
      apps: { length: 0 },
      initializeApp: () => {},
      database: () => ({ ref: () => ({ once: async () => ({ val: () => null }) }) }),
      firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }) })
    };
  }
  return _origLoad.call(this, id, ...rest);
};

const { computeBill, buildBillFlex, buildReceiptFlex, DEFAULTS, THAI_MONTHS_SHORT } = require('../_billFlex');

// ── computeBill ───────────────────────────────────────────────────────────────

describe('computeBill', () => {
  const cfg = { rentPrice: 3000, electricRate: 8, waterRate: 18, trashRate: 0 };

  it('computes correct totals', () => {
    const bill = computeBill({ building: 'rooms', roomId: '501', year: 68, month: 4, eOld: 100, eNew: 101, wOld: 50, wNew: 51 }, cfg);
    assert.equal(bill.rent, 3000);
    assert.equal(bill.eUnits, 1);
    assert.equal(bill.wUnits, 1);
    assert.equal(bill.eCost, 8);
    assert.equal(bill.wCost, 18);
    // trashRate: 0 must stay 0 — was being defaulted to 20 due to || operator bug
    assert.equal(bill.trash, 0);
    assert.equal(bill.totalCharge, 3026);
  });

  it('derives 4-digit BE year from 2-digit', () => {
    const bill = computeBill({ building: 'rooms', roomId: '1', year: 68, month: 1, eOld: 0, eNew: 0, wOld: 0, wNew: 0 }, cfg);
    assert.equal(bill.year, 2568);
  });

  it('returns null when rent is 0', () => {
    const zeroCfg = { rentPrice: 0, electricRate: 8, waterRate: 18, trashRate: 0 };
    assert.equal(computeBill({ building: 'rooms', roomId: '1', year: 68, month: 1, eOld: 0, eNew: 0, wOld: 0, wNew: 0 }, zeroCfg), null);
  });

  it('clamps negative meter delta to 0', () => {
    const bill = computeBill({ building: 'rooms', roomId: '1', year: 68, month: 1, eOld: 200, eNew: 100, wOld: 100, wNew: 50 }, cfg);
    assert.equal(bill.eUnits, 0);
    assert.equal(bill.wUnits, 0);
    assert.equal(bill.totalCharge, 3000); // rent only (trashRate: 0)
  });

  it('sets dueDate to 5th of following month', () => {
    const bill = computeBill({ building: 'rooms', roomId: '1', year: 68, month: 4, eOld: 0, eNew: 0, wOld: 0, wNew: 0 }, cfg);
    assert.equal(bill.dueDate, '2025-05-05'); // April 2568 BE = April 2025 CE → due May 5
  });

  it('handles December → January year rollover in dueDate', () => {
    const bill = computeBill({ building: 'rooms', roomId: '1', year: 68, month: 12, eOld: 0, eNew: 0, wOld: 0, wNew: 0 }, cfg);
    assert.equal(bill.dueDate, '2026-01-05');
  });
});

// ── buildBillFlex ─────────────────────────────────────────────────────────────

describe('buildBillFlex', () => {
  const bill = computeBill(
    { building: 'rooms', roomId: '501', year: 68, month: 4, eOld: 100, eNew: 101, wOld: 50, wNew: 51 },
    { rentPrice: 3000, electricRate: 8, waterRate: 18, trashRate: 0 }
  );

  it('returns LINE flex message envelope', () => {
    const msg = buildBillFlex(bill, { tenantName: 'ธนานนท์' });
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText.includes('ห้อง 501'), `altText: ${msg.altText}`);
    assert.ok(msg.altText.includes('3,026'), `altText: ${msg.altText}`);
    assert.ok(msg.contents.type === 'bubble');
  });

  it('header is a bright-blue gradient (ฟ้าสว่าง) with a solid fallback, distinct from green', () => {
    const msg = buildBillFlex(bill, {});
    const h = msg.contents.header;
    assert.equal(h.background?.type, 'linearGradient');
    assert.equal(h.background.startColor, '#039BE5');
    assert.equal(h.background.endColor, '#01579B');
    assert.equal(h.backgroundColor, '#0288D1', 'solid fallback for non-gradient clients');
    assert.notEqual(h.backgroundColor, '#2d8653', 'must NOT be the receipt green');
  });

  it('header subtitle shows tenant name when provided', () => {
    const msg = buildBillFlex(bill, { tenantName: 'สมชาย' });
    const subtitle = msg.contents.header.contents[1].text;
    assert.ok(subtitle.includes('คุณ สมชาย'), `subtitle: ${subtitle}`);
  });

  it('header subtitle falls back to ห้อง when no tenant name', () => {
    const msg = buildBillFlex(bill, {});
    const subtitle = msg.contents.header.contents[1].text;
    assert.ok(subtitle.includes('ห้อง 501'), `subtitle: ${subtitle}`);
  });

  it('footer has exactly one button pointing to payment page', () => {
    const msg = buildBillFlex(bill, {});
    const buttons = msg.contents.footer.contents;
    assert.equal(buttons.length, 1);
    assert.ok(buttons[0].action.uri.includes('page=payment'), `uri: ${buttons[0].action.uri}`);
  });

  it('invoice ref format is INV-R{room}-{YY}{MM}', () => {
    const msg = buildBillFlex(bill, {});
    const body = msg.contents.body.contents;
    const refRow = body.find(c => c.type === 'box' && c.contents?.some(t => t.text === 'เลขที่บิล'));
    const refValue = refRow?.contents.find(t => t.text !== 'เลขที่บิล')?.text;
    assert.ok(refValue?.startsWith('INV-R501-'), `ref: ${refValue}`);
  });

  it('body has no bank account block', () => {
    const msg = buildBillFlex(bill, {});
    const bodyText = JSON.stringify(msg.contents.body);
    assert.ok(!bodyText.includes('bankAccount'));
    assert.ok(!bodyText.includes('คัดลอก'));
  });

  it('total amount is shrink-to-fit (never truncates to "…" on the wire)', () => {
    const msg = buildBillFlex(bill, {});
    const totalBox = msg.contents.body.contents.find(
      c => c.type === 'box' && c.contents?.some(t => t.text === 'ยอดชำระทั้งสิ้น'));
    const amount = totalBox.contents.find(t => t.text !== 'ยอดชำระทั้งสิ้น');
    assert.equal(amount.adjustMode, 'shrink-to-fit');
    assert.ok(amount.flex >= 3, `amount needs room; flex=${amount.flex}`);
  });
});

// ── buildReceiptFlex ──────────────────────────────────────────────────────────

describe('buildReceiptFlex', () => {
  const bill = computeBill(
    { building: 'rooms', roomId: '501', year: 68, month: 4, eOld: 100, eNew: 101, wOld: 50, wNew: 51 },
    { rentPrice: 3000, electricRate: 8, waterRate: 18, trashRate: 0 }
  );

  it('returns LINE flex message envelope', () => {
    const msg = buildReceiptFlex(bill, { tenantName: 'ธนานนท์', paidAt: new Date('2025-04-24') });
    assert.equal(msg.type, 'flex');
    assert.ok(msg.altText.includes('ห้อง 501'));
    assert.ok(msg.altText.includes('เรียบร้อย'));
  });

  it('header is green #2d8653', () => {
    const msg = buildReceiptFlex(bill, {});
    assert.equal(msg.contents.header.backgroundColor, '#2d8653');
  });

  it('receipt ref falls back to the legacy per-render RCP- ref when no receiptNo given', () => {
    const msg = buildReceiptFlex(bill, {});
    const body = msg.contents.body.contents;
    const refRow = body.find(c => c.type === 'box' && c.contents?.some(t => t.text === 'เลขที่ใบเสร็จ'));
    const refValue = refRow?.contents.find(t => t.text !== 'เลขที่ใบเสร็จ')?.text;
    assert.ok(refValue?.startsWith('RCP-R501-'), `ref: ${refValue}`);
  });

  it('receipt ref uses the gapless receiptNo when provided (Roadmap 1.2a)', () => {
    const msg = buildReceiptFlex(bill, { receiptNo: 'RCP-rooms-2569-00042' });
    const body = msg.contents.body.contents;
    const refRow = body.find(c => c.type === 'box' && c.contents?.some(t => t.text === 'เลขที่ใบเสร็จ'));
    const refValue = refRow?.contents.find(t => t.text !== 'เลขที่ใบเสร็จ')?.text;
    assert.equal(refValue, 'RCP-rooms-2569-00042');
  });

  it('footer button points to bill page (not payment)', () => {
    const msg = buildReceiptFlex(bill, {});
    const btn = msg.contents.footer.contents[0];
    assert.ok(btn.action.uri.includes('page=bill'), `uri: ${btn.action.uri}`);
    assert.ok(!btn.action.uri.includes('page=payment'));
  });

  it('shows paid date row', () => {
    const paidAt = new Date('2025-04-24');
    const msg = buildReceiptFlex(bill, { paidAt });
    const bodyText = JSON.stringify(msg.contents.body);
    assert.ok(bodyText.includes('วันที่ชำระ'));
    assert.ok(bodyText.includes('2568')); // Thai year
  });

  it('total amount is shrink-to-fit (never truncates to "…" on the wire)', () => {
    const msg = buildReceiptFlex(bill, {});
    const totalBox = msg.contents.body.contents.find(
      c => c.type === 'box' && c.contents?.some(t => t.text === 'ยอดที่ชำระ'));
    const amount = totalBox.contents.find(t => t.text !== 'ยอดที่ชำระ');
    assert.equal(amount.adjustMode, 'shrink-to-fit');
    assert.ok(amount.flex >= 3, `amount needs room; flex=${amount.flex}`);
  });
});
