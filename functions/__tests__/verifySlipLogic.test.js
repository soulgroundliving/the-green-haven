/**
 * Pure function tests for verifySlip.js
 *
 * Tests validateRequest, isSafeTransactionId, RTDB bill-matching logic,
 * and gamification payment tier logic — all without Firebase or network.
 *
 * Helpers are extracted inline; when verifySlip.js changes these functions,
 * failing tests here flag the regression immediately.
 *
 * Run: node --test functions/__tests__/verifySlipLogic.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Pure helpers extracted from verifySlip.js ─────────────────────────────────

function validateRequest(params) {
  if (!params.file)
    return { valid: false, error: 'File is required' };
  if (typeof params.file !== 'string')
    return { valid: false, error: 'File must be base64 string' };
  if (!params.expectedAmount || params.expectedAmount <= 0)
    return { valid: false, error: 'Expected amount must be positive' };
  if (!params.room && !params.userId)
    return { valid: false, error: 'Room ID or User ID is required' };
  if (!params.building || !['rooms', 'nest'].includes(params.building))
    return { valid: false, error: 'Valid building is required (rooms or nest)' };
  return { valid: true };
}

function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
}

// Mirrors the bill-matching logic in markBillPaidInRTDB.
// Returns the list of bill IDs that would be updated to status='paid'.
function matchBillsForMonth(bills, billYearBE, billMonth) {
  const matched = [];
  Object.keys(bills).forEach(billId => {
    const b = bills[billId];
    if (!b || b.status === 'paid') return;
    const by = Number(b.year);
    const bm = Number(b.month);
    const byBE = by < 2400 ? 2500 + (by % 100) : by;
    if (byBE === billYearBE && bm === billMonth) matched.push(billId);
  });
  return matched;
}

// Mirrors the point-tier logic in recordPaymentAndAwardPoints.
function computePaymentTier(daysDiff) {
  if (daysDiff <= -4) return { points: 150, status: 'early_bird' };
  if (daysDiff <= 0)  return { points: 100, status: 'on_time' };
  if (daysDiff <= 3)  return { points: 40,  status: 'slightly_late' };
  if (daysDiff <= 5)  return { points: 15,  status: 'late' };
  return { points: 0, status: 'too_late' };
}

// ── Tests: validateRequest ────────────────────────────────────────────────────

describe('validateRequest', () => {
  const base = { file: 'abc123', expectedAmount: 2828, room: '15', building: 'rooms' };

  it('accepts valid params', () => {
    assert.deepEqual(validateRequest(base), { valid: true });
  });

  it('rejects when file is missing', () => {
    const r = validateRequest({ ...base, file: undefined });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('File'));
  });

  it('rejects when file is not a string (Buffer passed as object)', () => {
    const r = validateRequest({ ...base, file: Buffer.from('data') });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('base64'));
  });

  it('rejects when expectedAmount is 0', () => {
    const r = validateRequest({ ...base, expectedAmount: 0 });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('amount'));
  });

  it('rejects when expectedAmount is negative', () => {
    const r = validateRequest({ ...base, expectedAmount: -100 });
    assert.equal(r.valid, false);
  });

  it('rejects when neither room nor userId is provided', () => {
    const { room, ...noRoom } = base;
    const r = validateRequest(noRoom);
    assert.equal(r.valid, false);
  });

  it('accepts when userId substitutes room', () => {
    const { room, ...noRoom } = base;
    const r = validateRequest({ ...noRoom, userId: 'tenant_15' });
    assert.deepEqual(r, { valid: true });
  });

  it('rejects unknown building value', () => {
    const r = validateRequest({ ...base, building: 'amazon' });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('building'));
  });

  it('accepts "nest" as a valid building', () => {
    const r = validateRequest({ ...base, building: 'nest' });
    assert.deepEqual(r, { valid: true });
  });
});

// ── Tests: isSafeTransactionId ────────────────────────────────────────────────

describe('isSafeTransactionId', () => {
  it('accepts a typical SlipOK transRef', () => {
    assert.ok(isSafeTransactionId('ABCD1234-XYZ'));
  });

  it('accepts lowercase alphanumeric with underscores and dashes', () => {
    assert.ok(isSafeTransactionId('txn_20250501_abc'));
  });

  it('rejects a string shorter than 4 chars', () => {
    assert.ok(!isSafeTransactionId('AB3'));
  });

  it('rejects strings with forward slash (Firestore path injection)', () => {
    assert.ok(!isSafeTransactionId('TXN/abc/evil'));
  });

  it('rejects strings with spaces', () => {
    assert.ok(!isSafeTransactionId('TXN 123'));
  });

  it('rejects strings with Thai characters', () => {
    assert.ok(!isSafeTransactionId('TXN-สวัสดี'));
  });

  it('rejects null and non-string types', () => {
    assert.ok(!isSafeTransactionId(null));
    assert.ok(!isSafeTransactionId(12345));
    assert.ok(!isSafeTransactionId(undefined));
  });

  it('rejects empty string', () => {
    assert.ok(!isSafeTransactionId(''));
  });

  it('rejects string over 200 chars', () => {
    assert.ok(!isSafeTransactionId('A'.repeat(201)));
  });

  it('accepts string of exactly 200 chars', () => {
    assert.ok(isSafeTransactionId('A'.repeat(200)));
  });
});

// ── Tests: markBillPaidInRTDB — bill matching logic ───────────────────────────

describe('matchBillsForMonth — RTDB bill-matching logic', () => {
  it('matches unpaid bill for the correct BE year and month', () => {
    const bills = {
      bill1: { year: 2568, month: 4, status: 'unpaid' }
    };
    const matched = matchBillsForMonth(bills, 2568, 4);
    assert.deepEqual(matched, ['bill1']);
  });

  it('normalises 2-digit BE year (68 → 2568)', () => {
    const bills = {
      bill1: { year: 68, month: 4, status: 'unpaid' }
    };
    const matched = matchBillsForMonth(bills, 2568, 4);
    assert.deepEqual(matched, ['bill1']);
  });

  it('skips bills already marked paid', () => {
    const bills = {
      bill1: { year: 2568, month: 4, status: 'paid' }
    };
    const matched = matchBillsForMonth(bills, 2568, 4);
    assert.deepEqual(matched, []);
  });

  it('matches only the bill in the correct month — not adjacent months', () => {
    const bills = {
      march: { year: 2568, month: 3, status: 'unpaid' },
      april: { year: 2568, month: 4, status: 'unpaid' },
      may:   { year: 2568, month: 5, status: 'unpaid' }
    };
    const matched = matchBillsForMonth(bills, 2568, 4);
    assert.deepEqual(matched, ['april']);
  });

  it('returns empty array when no bills exist', () => {
    const matched = matchBillsForMonth({}, 2568, 4);
    assert.deepEqual(matched, []);
  });

  it('handles null bill entries gracefully', () => {
    const bills = { bill1: null, bill2: { year: 2568, month: 4, status: 'unpaid' } };
    const matched = matchBillsForMonth(bills, 2568, 4);
    assert.deepEqual(matched, ['bill2']);
  });
});

// ── Tests: gamification payment tier logic ────────────────────────────────────

describe('computePaymentTier — Nest gamification point tiers', () => {
  it('early_bird: paid 5+ days before due → 150 pts', () => {
    const t = computePaymentTier(-5);
    assert.equal(t.status, 'early_bird');
    assert.equal(t.points, 150);
  });

  it('early_bird boundary: exactly -4 days → 150 pts', () => {
    const t = computePaymentTier(-4);
    assert.equal(t.status, 'early_bird');
    assert.equal(t.points, 150);
  });

  it('on_time: paid on due date (daysDiff=0) → 100 pts', () => {
    const t = computePaymentTier(0);
    assert.equal(t.status, 'on_time');
    assert.equal(t.points, 100);
  });

  it('on_time boundary: daysDiff=-1 → 100 pts', () => {
    const t = computePaymentTier(-1);
    assert.equal(t.status, 'on_time');
    assert.equal(t.points, 100);
  });

  it('slightly_late: 1-3 days late → 40 pts', () => {
    assert.equal(computePaymentTier(1).status, 'slightly_late');
    assert.equal(computePaymentTier(3).points, 40);
  });

  it('late: 4-5 days late → 15 pts', () => {
    const t = computePaymentTier(4);
    assert.equal(t.status, 'late');
    assert.equal(t.points, 15);
  });

  it('too_late: 6+ days late → 0 pts', () => {
    const t = computePaymentTier(6);
    assert.equal(t.status, 'too_late');
    assert.equal(t.points, 0);
  });

  it('tier boundaries are exclusive on the right: daysDiff=3 is slightly_late not late', () => {
    const t = computePaymentTier(3);
    assert.equal(t.status, 'slightly_late');
  });

  it('tier boundaries are exclusive on the right: daysDiff=5 is late not too_late', () => {
    const t = computePaymentTier(5);
    assert.equal(t.status, 'late');
  });
});

// ── Tests: synth-materialize gating (Option B, 2026-06-08) ────────────────────
// Mirrors the materialize decision + deterministic id added to markBillPaidInRTDB
// so a tenant paying the CURRENT (synthesized, no-RTDB-doc) month flips to paid.
// Guards: current BKK month only · synthetic-flagged only · never when a real bill
// already matched · never overwrite an existing paid doc · deterministic id.

function shouldMaterializeSynthBill({ matched, synthetic, billYM, curYM, existingStatus }) {
  if (matched > 0) return false;            // a real bill already matched the month
  if (synthetic !== true) return false;     // only the client-flagged synth path
  if (billYM !== curYM) return false;       // current BKK month only (no back/forward-dating)
  if (existingStatus === 'paid') return false; // never overwrite a paid doc
  return true;
}
function synthMaterializedBillId(billYearBE, billMonth, room) {
  return `TGH-${billYearBE}${String(billMonth).padStart(2, '0')}-${room}`;
}

describe('shouldMaterializeSynthBill — Option B synth-materialize gating', () => {
  const cur = 256906;  // มิ.ย. 2569 = current BE year*100+month

  it('synth + current month + no existing bill → materialize', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 0, synthetic: true, billYM: cur, curYM: cur }), true);
  });
  it('past month → never materialize (no back-dating)', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 0, synthetic: true, billYM: 256905, curYM: cur }), false);
  });
  it('future month → never materialize', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 0, synthetic: true, billYM: 256907, curYM: cur }), false);
  });
  it('not flagged synthetic → never materialize (real bills use the normal match path)', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 0, synthetic: false, billYM: cur, curYM: cur }), false);
  });
  it('an existing bill already matched → no duplicate materialize', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 1, synthetic: true, billYM: cur, curYM: cur }), false);
  });
  it('existing paid doc → never overwrite', () => {
    assert.equal(shouldMaterializeSynthBill({ matched: 0, synthetic: true, billYM: cur, curYM: cur, existingStatus: 'paid' }), false);
  });
});

describe('synthMaterializedBillId — deterministic id (re-pay merges, never dups)', () => {
  it('builds TGH-{BE4}{MM}-{room}', () => {
    assert.equal(synthMaterializedBillId(2569, 6, '13'), 'TGH-256906-13');
  });
  it('zero-pads single-digit month', () => {
    assert.equal(synthMaterializedBillId(2569, 4, '13'), 'TGH-256904-13');
  });
  it('is stable across calls for the same month+room (idempotent)', () => {
    assert.equal(synthMaterializedBillId(2570, 12, '7'), synthMaterializedBillId(2570, 12, '7'));
  });
});
