'use strict';

// Parity tests for tools/preview-deposit-settlement.js — the read-only #253
// dry-run. The tool re-implements the bill selection/normalisation in Node (the
// app version lives in browser-global shared/dashboard-aging.js and can't be
// required here), so these tests pin the Node copy to the SAME contract the app
// uses + the §7-E year-format traps + the negative-net ("ค้างเพิ่ม") case.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  bld, toBE, isArrears, normalizeBill, outstandingFromBills, computeSettlementPreview,
} = require('../../tools/preview-deposit-settlement.js');

describe('preview-deposit-settlement — bld() agrees with BillStore._bld', () => {
  test('rooms/old/RentRoom → rooms; nest/new → nest; passthrough otherwise', () => {
    assert.equal(bld('rooms'), 'rooms');
    assert.equal(bld('old'), 'rooms');
    assert.equal(bld('RentRoom'), 'rooms');
    assert.equal(bld('nest'), 'nest');
    assert.equal(bld('new'), 'nest');
    assert.equal(bld('amazon'), 'amazon');
  });
});

describe('preview-deposit-settlement — toBE() §7-E mixed year formats', () => {
  test('2-digit BE, CE, and 4-digit BE all normalise to 2569', () => {
    assert.equal(toBE(69), 2569);    // 2-digit BE
    assert.equal(toBE('69'), 2569);  // string 2-digit BE
    assert.equal(toBE(2026), 2569);  // CE
    assert.equal(toBE('2026'), 2569);// string CE
    assert.equal(toBE(2569), 2569);  // already 4-digit BE
    assert.equal(toBE('2569'), 2569);
  });
});

describe('preview-deposit-settlement — isArrears() mirrors _isArrears', () => {
  test('pending / overdue / blank with positive total are arrears', () => {
    assert.equal(isArrears('pending', 2300, true), true);
    assert.equal(isArrears('overdue', 2100, true), true);
    assert.equal(isArrears('', 1500, true), true);
  });
  test('paid / refunded / void are NOT arrears (any case)', () => {
    assert.equal(isArrears('paid', 2300, true), false);
    assert.equal(isArrears('PAID', 2300, true), false);
    assert.equal(isArrears('refunded', 2300, true), false);
    assert.equal(isArrears('void', 2300, true), false);
  });
  test('zero/negative total with no charges is a ghost stub → not arrears', () => {
    assert.equal(isArrears('pending', 0, false), false);
    assert.equal(isArrears('pending', -5, false), false);
    assert.equal(isArrears('pending', 0, true), true); // 0 but has charges → still arrears
  });
});

describe('preview-deposit-settlement — outstandingFromBills() == app outstandingBillsForRoom', () => {
  // Same fixture shape as shared/__tests__/dashboard-aging.test.js
  test('keeps each unpaid bill (key + month + beYear + total); skips paid/refunded/void', () => {
    const raw = {
      'TGH-A': { status: 'pending',  totalCharge: 2300, month: 5, year: 2569, charges: {} },
      'TGH-B': { status: 'paid',     totalCharge: 1500, month: 4, year: 2569, charges: {} },
      'TGH-C': { status: 'refunded', totalCharge: 999,  month: 3, year: 2569, charges: {} },
      'TGH-D': { status: 'void',     totalCharge: 777,  month: 2, year: 2569, charges: {} },
    };
    const res = outstandingFromBills(raw);
    assert.equal(res.total, 2300);
    assert.equal(res.bills.length, 1);
    assert.equal(res.bills[0].key, 'TGH-A');
    assert.equal(res.bills[0].month, 5);
    assert.equal(res.bills[0].beYear, 2569);
    assert.equal(res.bills[0].total, 2300);
  });

  test('the displayed month/beYear are correct when the raw bill uses 2-digit BE', () => {
    // The modal shows `บิลเดือน ${b.month}/${b.beYear}` — guards the §7-E display.
    const res = outstandingFromBills({ M: { status: 'pending', totalCharge: 1800, month: 6, year: 69, charges: {} } });
    assert.equal(res.bills[0].month, 6);
    assert.equal(res.bills[0].beYear, 2569);
  });

  test('totalCharge → totalAmount → total fallback (mirrors _normBill)', () => {
    const res = outstandingFromBills({
      A: { status: 'pending', totalAmount: 1200, month: 1, year: 69, charges: {} }, // no totalCharge
      B: { status: 'pending', total: 800, month: 2, year: 69, charges: {} },        // only total
    });
    assert.equal(res.total, 2000);
    assert.equal(res.bills.length, 2);
  });

  test('sums multiple unpaid bills (carry-forward arrears)', () => {
    const res = outstandingFromBills({
      M1: { status: 'pending', totalCharge: 2300, month: 5, year: 2569, charges: {} },
      M2: { status: 'overdue', totalCharge: 2100, month: 4, year: 2569, charges: {} },
    });
    assert.equal(res.total, 4400);
    assert.equal(res.bills.length, 2);
  });

  test('null / empty subtree → { bills: [], total: 0 } (Nest no-op)', () => {
    assert.equal(outstandingFromBills(null).total, 0);
    assert.equal(outstandingFromBills(null).bills.length, 0);
    assert.equal(outstandingFromBills({}).total, 0);
  });
});

describe('preview-deposit-settlement — computeSettlementPreview() net refund (DepositCalc reused)', () => {
  test('held − final bill = net refund (no damage deductions pre-settlement)', () => {
    const dep = { status: 'holding', amount: 6000 }; // no paidSoFar → fully paid = held 6000
    const rawBills = { M: { status: 'pending', totalCharge: 2300, month: 5, year: 2569, charges: {} } };
    const p = computeSettlementPreview(dep, rawBills);
    assert.equal(p.held, 6000);
    assert.equal(p.finalBillTotal, 2300);
    assert.equal(p.netRefund, 3700);
    assert.equal(p.tenantOwes, false);
    assert.equal(p.outstandingBills.length, 1);
  });

  test('existing deductions[] on the doc are included in the net', () => {
    const dep = { status: 'holding', amount: 6000, deductions: [{ desc: 'ทาสีใหม่', amount: 1000 }] };
    const rawBills = { M: { status: 'pending', totalCharge: 2300, month: 5, year: 2569, charges: {} } };
    const p = computeSettlementPreview(dep, rawBills);
    assert.equal(p.deductionTotal, 1000);
    assert.equal(p.netRefund, 6000 - 2300 - 1000); // 2700
  });

  test('outstanding bill > deposit → negative net, tenantOwes flagged ("ค้างเพิ่ม")', () => {
    const dep = { status: 'holding', amount: 2000 };
    const rawBills = {
      A: { status: 'pending', totalCharge: 2300, month: 5, year: 69, charges: {} },
      B: { status: 'pending', totalCharge: 1900, month: 4, year: 69, charges: {} },
    };
    const p = computeSettlementPreview(dep, rawBills);
    assert.equal(p.finalBillTotal, 4200);
    assert.equal(p.netRefund, 2000 - 4200); // -2200
    assert.equal(p.tenantOwes, true);
  });

  test('holding deposit with NO outstanding bill → full refund, no deduction', () => {
    const dep = { status: 'holding', amount: 6000 };
    const rawBills = { M: { status: 'paid', totalCharge: 2300, month: 5, year: 2569, charges: {} } };
    const p = computeSettlementPreview(dep, rawBills);
    assert.equal(p.finalBillTotal, 0);
    assert.equal(p.netRefund, 6000);
    assert.equal(p.outstandingBills.length, 0);
  });

  test('paidSoFar (installment) is the held amount, not the full target', () => {
    const dep = { status: 'holding', amount: 6000, paidSoFar: 4000 };
    const p = computeSettlementPreview(dep, { M: { status: 'pending', totalCharge: 1000, month: 5, year: 2569, charges: {} } });
    assert.equal(p.held, 4000);          // DepositCalc.depositPaid
    assert.equal(p.netRefund, 3000);     // 4000 − 1000
  });
});
