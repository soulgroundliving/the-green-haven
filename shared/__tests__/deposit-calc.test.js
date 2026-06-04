/**
 * Unit tests for shared/deposit-calc.js
 * Run: node --test shared/__tests__/deposit-calc.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const D = require('../deposit-calc.js');

describe('DepositCalc — installment math', () => {
  it('legacy doc with no paidSoFar is fully paid (§7-L back-compat)', () => {
    const dep = { amount: 3000 };
    assert.equal(D.depositPaid(dep), 3000);
    assert.equal(D.depositDue(dep), 0);
    assert.equal(D.isFullyPaid(dep), true);
  });

  it('partial: paidSoFar 1500 of 3000 → due 1500, not fully paid', () => {
    const dep = { amount: 3000, paidSoFar: 1500 };
    assert.equal(D.depositPaid(dep), 1500);
    assert.equal(D.depositDue(dep), 1500);
    assert.equal(D.isFullyPaid(dep), false);
  });

  it('paidSoFar 0 → due = full amount', () => {
    const dep = { amount: 3000, paidSoFar: 0 };
    assert.equal(D.depositDue(dep), 3000);
    assert.equal(D.isFullyPaid(dep), false);
  });

  it('paidSoFar === amount → due 0, fully paid', () => {
    const dep = { amount: 14000, paidSoFar: 14000 };
    assert.equal(D.depositDue(dep), 0);
    assert.equal(D.isFullyPaid(dep), true);
  });

  it('overpay clamps due to 0 (never negative)', () => {
    const dep = { amount: 3000, paidSoFar: 3500 };
    assert.equal(D.depositDue(dep), 0);
    assert.equal(D.isFullyPaid(dep), true);
  });

  it('defensive: missing/garbage amount → 0, no throw', () => {
    assert.equal(D.depositDue({}), 0);
    assert.equal(D.depositDue(null), 0);
    assert.equal(D.depositPaid({ amount: 'x', paidSoFar: 'y' }), 0);
    assert.equal(D.depositDue({ amount: 2000, paidSoFar: -50 }), 2000); // negative paid clamps to 0
  });
});

describe('DepositCalc — deduction shape (Slice C)', () => {
  it('reads new {desc} shape', () => {
    assert.equal(D.deductionDesc({ desc: 'ค่าทำความสะอาด', amount: 500 }), 'ค่าทำความสะอาด');
  });

  it('falls back to legacy {reason} when desc absent (§7-L back-compat)', () => {
    assert.equal(D.deductionDesc({ reason: 'ค่าเสียหาย', amount: 800 }), 'ค่าเสียหาย');
  });

  it('prefers desc over reason when both present', () => {
    assert.equal(D.deductionDesc({ desc: 'new', reason: 'old', amount: 1 }), 'new');
  });

  it('empty desc falls back to reason; both missing → empty string', () => {
    assert.equal(D.deductionDesc({ desc: '', reason: 'fallback' }), 'fallback');
    assert.equal(D.deductionDesc({ amount: 100 }), '');
    assert.equal(D.deductionDesc(null), '');
  });

  it('deductionsTotal sums amounts (mixed legacy + new shapes)', () => {
    assert.equal(D.deductionsTotal([{ reason: 'a', amount: 300 }, { desc: 'b', amount: 700 }]), 1000);
  });

  it('deductionsTotal defensive: non-array → 0, garbage amounts ignored', () => {
    assert.equal(D.deductionsTotal(null), 0);
    assert.equal(D.deductionsTotal([]), 0);
    assert.equal(D.deductionsTotal([{ amount: 'x' }, { amount: 250 }]), 250);
  });

  it('example refund: held 3000 − deduction 2300 = 700 (spec §1.3)', () => {
    const dep = { amount: 3000 };
    const deductions = [{ desc: 'บิลเดือนสุดท้าย', amount: 2300 }];
    const netRefund = D.depositPaid(dep) - D.deductionsTotal(deductions);
    assert.equal(netRefund, 700);
  });
});
