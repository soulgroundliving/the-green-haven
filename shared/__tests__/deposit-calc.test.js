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

describe('DepositCalc — netRefund (final bill + damage, spec §1.3)', () => {
  it('spec §1.3 example: held 3000 − final bill 2300 − 0 damage = 700', () => {
    assert.equal(D.netRefund(3000, 2300, []), 700);
  });

  it('final bill + damage both deducted', () => {
    assert.equal(D.netRefund(10000, 3500, [{ amount: 1200 }, { amount: 800 }]), 4500);
  });

  it('no final bill (paid / Nest no-bill) → held − damage only', () => {
    assert.equal(D.netRefund(2400, 0, [{ amount: 500 }, { amount: 500 }]), 1400);
  });

  it('over-deduction goes negative (tenant still owes)', () => {
    assert.equal(D.netRefund(3000, 2800, [{ amount: 500 }]), -300);
  });

  it('defensive: garbage args coerce to 0', () => {
    assert.equal(D.netRefund(undefined, null, null), 0);
    assert.equal(D.netRefund('x', 'y', 'z'), 0);
  });
});

describe('DepositCalc — PromptPay refund target (Slice C follow-up)', () => {
  it('validPromptPay accepts a 10-digit mobile starting 0 (strips separators)', () => {
    assert.deepEqual(D.validPromptPay('0812345678'), { valid: true, type: 'mobile', value: '0812345678' });
    assert.deepEqual(D.validPromptPay('08-1234-5678'), { valid: true, type: 'mobile', value: '0812345678' });
  });

  it('validPromptPay accepts a 13-digit national ID', () => {
    const v = D.validPromptPay('1101700230451');
    assert.equal(v.valid, true);
    assert.equal(v.type, 'nationalId');
  });

  it('validPromptPay rejects garbage / wrong length (the 45422222… bug input)', () => {
    assert.equal(D.validPromptPay('45422222444444444444444').valid, false);
    assert.equal(D.validPromptPay('123').valid, false);
    assert.equal(D.validPromptPay('').valid, false);
    assert.equal(D.validPromptPay('8123456789').valid, false); // 10 digits but not starting 0
  });

  it('promptPayPayload returns null for an invalid target', () => {
    assert.equal(D.promptPayPayload('garbage', 100), null);
  });

  it('promptPayPayload (mobile) matches the proven EMVCo reference algorithm', () => {
    // Reference = the production mobile-only builder (dashboard-bill.js buildPromptPayPayload), inlined.
    const ref = (phone, amount) => {
      const s = phone.replace(/[^0-9]/g, '');
      const t = s.startsWith('0') ? '0066' + s.slice(1) : s;
      const aid = '0016A000000677010111' + '01' + String(t.length).padStart(2, '0') + t;
      const a = amount.toFixed(2);
      const p = '000201010212' + '29' + String(aid.length).padStart(2, '0') + aid + '5303764' + '54' + String(a.length).padStart(2, '0') + a + '5802TH6304';
      let c = 0xFFFF;
      for (let i = 0; i < p.length; i++) { c ^= p.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); }
      return p + (c & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    };
    assert.equal(D.promptPayPayload('0812345678', 1400), ref('0812345678', 1400));
  });

  it('promptPayPayload (national ID) is well-formed, tag-02, CRC self-validates', () => {
    const payload = D.promptPayPayload('1101700230451', 1400);
    assert.ok(payload.startsWith('000201010212'), 'EMVCo header');
    assert.ok(payload.includes('1101700230451'), 'embeds the national ID verbatim');
    const body = payload.slice(0, -4);
    let c = 0xFFFF;
    for (let i = 0; i < body.length; i++) { c ^= body.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); }
    assert.equal(payload.slice(-4), (c & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'), 'appended CRC matches body');
  });
});

describe('DepositCalc — depositPhase (pre-move-in lifecycle, Phase 1)', () => {
  it('legacy doc with no status reads as holding (§7-L)', () => {
    assert.equal(D.depositPhase({ amount: 3000 }), 'holding');
    assert.equal(D.depositPhase(null), 'holding');
  });

  it('returns the explicit lifecycle state', () => {
    assert.equal(D.depositPhase({ status: 'reserved' }), 'reserved');
    assert.equal(D.depositPhase({ status: 'holding' }), 'holding');
    assert.equal(D.depositPhase({ status: 'returned' }), 'returned');
    assert.equal(D.depositPhase({ status: 'forfeited' }), 'forfeited');
  });

  it('unknown status falls back to holding (defensive)', () => {
    assert.equal(D.depositPhase({ status: 'weird' }), 'holding');
  });
});

describe('DepositCalc — recordDepositPayment (2-chunk accrual)', () => {
  it('first chunk (จอง 500, cash) on a fresh reserved doc → paidSoFar 500', () => {
    const dep = { amount: 8000, status: 'reserved', paidSoFar: 0 };
    const patch = D.recordDepositPayment(dep, { label: 'จอง', amount: 500, method: 'cash' });
    assert.equal(patch.paidSoFar, 500);
    assert.equal(patch.payments.length, 1);
    assert.equal(patch.payments[0].method, 'cash');
    assert.equal(patch.payments[0].label, 'จอง');
  });

  it('second chunk (slip) accrues on top of the first → fully paid', () => {
    const dep = { amount: 8000, status: 'reserved', paidSoFar: 500, payments: [{ label: 'จอง', amount: 500, method: 'cash' }] };
    const patch = D.recordDepositPayment(dep, { label: 'มัดจำ', amount: 7500, method: 'slip', slipPath: 'deposits/nest/N101/payment_1.jpg' });
    assert.equal(patch.paidSoFar, 8000);
    assert.equal(patch.payments.length, 2);
    assert.equal(patch.payments[1].slipPath, 'deposits/nest/N101/payment_1.jpg');
  });

  it('absent paidSoFar in the recording flow means 0, NOT "fully paid"', () => {
    const patch = D.recordDepositPayment({ amount: 8000, status: 'reserved' }, { amount: 500 });
    assert.equal(patch.paidSoFar, 500);
  });

  it('overpay clamps paidSoFar to the deposit amount', () => {
    const patch = D.recordDepositPayment({ amount: 8000, status: 'reserved', paidSoFar: 7500 }, { amount: 9999 });
    assert.equal(patch.paidSoFar, 8000);
  });

  it('carries lumpRef + SlipOK txid through (lump slip verified via SlipOK)', () => {
    const patch = D.recordDepositPayment({ amount: 8000, status: 'reserved', paidSoFar: 0 }, { amount: 8000, method: 'slip', lumpRef: 'LUMP-2026-06-13-A', txid: 'SLIPOK-TX-123' });
    assert.equal(patch.payments[0].lumpRef, 'LUMP-2026-06-13-A');
    assert.equal(patch.payments[0].txid, 'SLIPOK-TX-123');
    assert.equal(patch.payments[0].method, 'slip');
  });

  it('does NOT mutate the input dep (immutable)', () => {
    const dep = { amount: 8000, status: 'reserved', paidSoFar: 0, payments: [] };
    D.recordDepositPayment(dep, { amount: 500 });
    assert.equal(dep.paidSoFar, 0);
    assert.equal(dep.payments.length, 0);
  });

  it('defaults method to slip and label to มัดจำ', () => {
    const patch = D.recordDepositPayment({ amount: 8000, status: 'reserved', paidSoFar: 0 }, { amount: 100 });
    assert.equal(patch.payments[0].method, 'slip');
    assert.equal(patch.payments[0].label, 'มัดจำ');
  });
});

describe('DepositCalc — splitLumpCash (multi-room single payment)', () => {
  it('valid when allocations sum to the lump total', () => {
    const r = D.splitLumpCash(16000, [
      { building: 'nest', roomId: 'N101', amount: 8000 },
      { building: 'nest', roomId: 'N102', amount: 8000 },
    ]);
    assert.equal(r.valid, true);
    assert.equal(r.allocated, 16000);
    assert.equal(r.remainder, 0);
  });

  it('invalid when the split does not add up to the total', () => {
    const r = D.splitLumpCash(16000, [{ building: 'nest', roomId: 'N101', amount: 8000 }]);
    assert.equal(r.valid, false);
    assert.equal(r.remainder, 8000);
  });

  it('tolerates ฿1 rounding', () => {
    assert.equal(D.splitLumpCash(10000, [{ building: 'rooms', roomId: '7', amount: 9999.5 }]).valid, true);
  });

  it('invalid: a row missing room, an empty list, or a non-positive amount', () => {
    assert.equal(D.splitLumpCash(5000, [{ building: 'nest', amount: 5000 }]).valid, false);
    assert.equal(D.splitLumpCash(0, []).valid, false);
    assert.equal(D.splitLumpCash(5000, [{ building: 'nest', roomId: 'N1', amount: 0 }]).valid, false);
  });
});
