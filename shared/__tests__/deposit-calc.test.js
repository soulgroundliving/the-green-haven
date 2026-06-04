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
