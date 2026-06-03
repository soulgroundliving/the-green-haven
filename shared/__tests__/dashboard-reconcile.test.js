/**
 * Unit tests for shared/dashboard-reconcile.js — computeReconciliation (pure).
 *
 * The matching logic is the audit-grade core of the Phase 2 reconcile report:
 * bill.paidRef → slip, OR manualReceipts[billId], OR a heuristic room+month+amount
 * fallback; unmatched slips / unmatched paid bills / amount mismatches surfaced.
 *
 * Strategy: load the IIFE module in a vm sandbox (only sets window.X at load — no
 * document/Date access until init/render, which we don't call), then exercise
 * window.computeReconciliation against normalized fixtures.
 *
 * Run: node --test shared/__tests__/dashboard-reconcile.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const window = {};
  const context = {
    window, document: { getElementById: () => null },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    setTimeout: () => 0, clearTimeout: () => {}, Promise,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-reconcile.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'dashboard-reconcile.js' });
  return context.window.computeReconciliation;
}

const compute = load();

const bill = (o) => Object.assign({ id: 'B1', building: 'rooms', room: '15', month: 3, beYear: 2569, total: 1000, status: 'paid', paidRef: null, receiptNo: null }, o);
const slip = (o) => Object.assign({ transactionId: 'TX1', building: 'rooms', room: '15', amount: 1000, beYear: 2569, month: 3, receiptNo: 'RCP-rooms-2569-00001' }, o);
const receipt = (o) => Object.assign({ billId: 'B1', building: 'rooms', room: '15', receiptNo: 'RCP-rooms-2569-00002' }, o);

describe('computeReconciliation — exported + matching', () => {
  test('window.computeReconciliation is a function (export guard)', () => {
    assert.equal(typeof compute, 'function');
  });

  test('paid bill linked by paidRef → matched (via paidRef), no mismatch when amounts agree', () => {
    const r = compute({ bills: [bill({ paidRef: 'TX1' })], slips: [slip({ transactionId: 'TX1' })], manualReceipts: [] });
    assert.equal(r.summary.matched, 1);
    assert.equal(r.matched[0].via, 'paidRef');
    assert.equal(r.summary.mismatches, 0);
    assert.equal(r.summary.unmatchedSlips, 0);
    assert.equal(r.summary.unmatchedPaidBills, 0);
  });

  test('paid bill linked by manualReceipt billId → matched (via manualReceipt), no slip needed', () => {
    const r = compute({ bills: [bill({ id: 'B7', paidRef: null })], slips: [], manualReceipts: [receipt({ billId: 'B7' })] });
    assert.equal(r.summary.matched, 1);
    assert.equal(r.matched[0].via, 'manualReceipt');
    assert.equal(r.matched[0].receiptNo, 'RCP-rooms-2569-00002');
    assert.equal(r.summary.unmatchedPaidBills, 0);
  });

  test('heuristic match: same building+room+month, amount within ฿1, no paidRef', () => {
    const r = compute({ bills: [bill({ paidRef: null, total: 1000 })], slips: [slip({ transactionId: 'TXh', amount: 1000.5 })], manualReceipts: [] });
    assert.equal(r.summary.matched, 1);
    assert.equal(r.matched[0].via, 'heuristic');
    assert.equal(r.summary.unmatchedSlips, 0);
  });

  test('slip with no corresponding bill → unmatchedSlips', () => {
    const r = compute({ bills: [], slips: [slip({ transactionId: 'TXorphan' })], manualReceipts: [] });
    assert.equal(r.summary.unmatchedSlips, 1);
    assert.equal(r.unmatchedSlips[0].transactionId, 'TXorphan');
    assert.equal(r.summary.matched, 0);
  });

  test('paid bill with no slip + no receipt → unmatchedPaidBills (cash without proof)', () => {
    const r = compute({ bills: [bill({ paidRef: null })], slips: [], manualReceipts: [] });
    assert.equal(r.summary.unmatchedPaidBills, 1);
    assert.equal(r.summary.matched, 0);
  });

  test('amount mismatch beyond ฿1 → counted in mismatches with signed amountDiff', () => {
    const r = compute({ bills: [bill({ paidRef: 'TX1', total: 1000 })], slips: [slip({ transactionId: 'TX1', amount: 1200 })], manualReceipts: [] });
    assert.equal(r.summary.matched, 1);          // still linked...
    assert.equal(r.summary.mismatches, 1);        // ...but flagged
    assert.equal(r.mismatches[0].amountDiff, 200);
  });

  test('unpaid bills are ignored (reconcile only settled bills)', () => {
    const r = compute({ bills: [bill({ status: 'unpaid' }), bill({ id: 'B2', status: 'pending' })], slips: [], manualReceipts: [] });
    assert.equal(r.summary.paidBills, 0);
    assert.equal(r.summary.matched, 0);
    assert.equal(r.summary.unmatchedPaidBills, 0);
  });

  test('refunded bill pairs its original slip via paidRef → slip not orphaned, in refunded bucket', () => {
    const r = compute({ bills: [bill({ status: 'refunded', paidRef: 'TX1' })], slips: [slip({ transactionId: 'TX1' })], manualReceipts: [] });
    assert.equal(r.summary.refunded, 1);
    assert.equal(r.refundedBills[0].bill.id, 'B1');
    assert.equal(r.refundedBills[0].slip.transactionId, 'TX1');
    assert.equal(r.summary.unmatchedSlips, 0, "the refunded bill's slip must NOT be flagged as an orphan");
    assert.equal(r.summary.matched, 0, 'a refunded bill is not "matched"');
    assert.equal(r.summary.paidBills, 0, 'a refunded bill is not a paid bill');
    assert.equal(r.summary.refundedAmount, 1000);
  });

  test('refunded bill with no linked slip → refunded bucket, not an unmatched-paid bill', () => {
    const r = compute({ bills: [bill({ status: 'refunded', paidRef: null })], slips: [], manualReceipts: [] });
    assert.equal(r.summary.refunded, 1);
    assert.equal(r.refundedBills[0].slip, null);
    assert.equal(r.summary.unmatchedPaidBills, 0, 'a refunded bill is not an unmatched paid bill');
  });

  test('a slip is not double-counted across two bills', () => {
    const r = compute({
      bills: [bill({ id: 'B1', month: 3, paidRef: null }), bill({ id: 'B2', month: 3, paidRef: null })],
      slips: [slip({ transactionId: 'TXone', month: 3 })], manualReceipts: [],
    });
    // One slip can satisfy only one bill heuristically → the other is unmatched-paid.
    assert.equal(r.summary.matched, 1);
    assert.equal(r.summary.unmatchedPaidBills, 1);
    assert.equal(r.summary.unmatchedSlips, 0);
  });

  test('summary totals: matched/slip amounts aggregate correctly', () => {
    const r = compute({
      bills: [bill({ id: 'B1', paidRef: 'TX1', total: 1000 })],
      slips: [slip({ transactionId: 'TX1', amount: 1000 }), slip({ transactionId: 'TX2', room: '99', amount: 500 })],
      manualReceipts: [],
    });
    assert.equal(r.summary.matched, 1);
    assert.equal(r.summary.matchedAmount, 1000);
    assert.equal(r.summary.unmatchedSlips, 1);
    assert.equal(r.summary.unmatchedSlipAmount, 500);
  });

  test('empty inputs → all-zero summary, no throw', () => {
    const r = compute({});
    assert.equal(r.summary.matched, 0);
    assert.equal(r.summary.slips, 0);
    assert.equal(r.summary.paidBills, 0);
  });
});
