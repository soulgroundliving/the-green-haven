/**
 * Unit tests for _reputation.js — computeReputation (Roadmap Phase 3.2a v1).
 *
 * Pure-function tests: no Firebase, no network, no Date.now() (now is injected),
 * so they run in milliseconds and are fully deterministic. Table-driven across
 * the payment / tenure / complaint factors + the 60/25/15 weighting and the
 * provisional renormalisation when there are 0 ratable bills.
 *
 * Run: node --test functions/__tests__/_reputation.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { computeReputation, reputationTier, REPUTATION_CONSTANTS: C } = require('../_reputation');

// Fixed "now" so every relative date is reproducible.
const NOW = Date.parse('2026-06-07T00:00:00.000Z');
const monthsAgo = (n) => NOW - n * C.MONTH_MS;

// Bill factories — dueDate is the date-only string the billing pipeline writes.
const paidBill = (dueDate, paidAt, status = 'paid') => ({ status, dueDate, paidAt });
const ON_TIME = (dueDate = '2026-05-05') => paidBill(dueDate, Date.parse('2026-05-03T10:00:00Z'));
const LATE    = (dueDate = '2026-05-05') => paidBill(dueDate, Date.parse('2026-05-09T10:00:00Z'));

// A long-tenure, complaint-free tenant — isolates the payment dimension.
const OLD_MOVE_IN = monthsAgo(30); // > 24mo → tenure capped 100; > 12mo clean → complaint 100

// ── Payment punctuality ─────────────────────────────────────────────────────

describe('computeReputation — payment', () => {
  it('all on-time paid bills → paymentScore 100, 0 late', () => {
    const r = computeReputation({ bills: [ON_TIME(), ON_TIME(), ON_TIME()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 3);
    assert.equal(r.factors.lateBills, 0);
    assert.equal(r.factors.onTimeRatio, 1);
    assert.equal(r.factors.paymentScore, 100);
    assert.equal(r.provisional, false);
  });

  it('all late paid bills → paymentScore 0', () => {
    const r = computeReputation({ bills: [LATE(), LATE()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 0);
    assert.equal(r.factors.lateBills, 2);
    assert.equal(r.factors.paymentScore, 0);
  });

  it('mixed 2 on-time / 1 late → 66.7 (ratio 0.6667)', () => {
    const r = computeReputation({ bills: [ON_TIME(), ON_TIME(), LATE()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 2);
    assert.equal(r.factors.lateBills, 1);
    assert.equal(r.factors.onTimeRatio, 0.6667);
    assert.equal(r.factors.paymentScore, 66.7);
    // 0.6·(2/3·100) + 0.25·100 + 0.15·100 = 40 + 40 = 80
    assert.equal(r.reputation, 80);
  });

  it('paid bill without paidAt is excluded from the ratio (honest metric)', () => {
    const noTs = paidBill('2026-05-05', undefined); // paid, no timestamp
    const r = computeReputation({ bills: [ON_TIME(), ON_TIME(), noTs], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 2);
    assert.equal(r.factors.lateBills, 0);
    assert.equal(r.factors.paymentScore, 100);
  });

  it('refunded and void bills are excluded', () => {
    const bills = [ON_TIME(), paidBill('2026-05-05', Date.parse('2026-05-04Z'), 'refunded'), paidBill('2026-05-05', Date.parse('2026-05-04Z'), 'void')];
    const r = computeReputation({ bills, moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 1);
    assert.equal(r.factors.lateBills, 0);
  });

  it('unpaid overdue counts as late; unpaid not-yet-due is excluded', () => {
    const overdue = { status: 'unpaid', dueDate: '2026-04-05' }; // before NOW
    const future  = { status: 'unpaid', dueDate: '2026-12-05' }; // after NOW
    const r = computeReputation({ bills: [ON_TIME(), overdue, future], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.onTimeBills, 1);
    assert.equal(r.factors.lateBills, 1);
    assert.equal(r.factors.onTimeRatio, 0.5);
  });

  it('0 ratable bills → paymentScore null + provisional + reweight', () => {
    const r = computeReputation({ bills: [], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.factors.paymentScore, null);
    assert.equal(r.factors.onTimeRatio, null);
    assert.equal(r.provisional, true);
    // renorm over tenure(100)+complaint(100): (0.25·100 + 0.15·100) / 0.40 = 100
    assert.equal(r.reputation, 100);
  });
});

// ── Tenure ──────────────────────────────────────────────────────────────────

describe('computeReputation — tenure', () => {
  const base = { bills: [ON_TIME()], complaints: [], now: NOW };

  it('12mo → tenureScore 50', () => {
    const r = computeReputation({ ...base, moveInDate: monthsAgo(12) });
    assert.equal(r.factors.tenureMonths, 12);
    assert.equal(r.factors.tenureScore, 50);
  });

  it('24mo → 100, 30mo capped 100', () => {
    assert.equal(computeReputation({ ...base, moveInDate: monthsAgo(24) }).factors.tenureScore, 100);
    assert.equal(computeReputation({ ...base, moveInDate: monthsAgo(30) }).factors.tenureScore, 100);
  });

  it('just moved in → tenureScore 0', () => {
    const r = computeReputation({ ...base, moveInDate: NOW });
    assert.equal(r.factors.tenureMonths, 0);
    assert.equal(r.factors.tenureScore, 0);
  });

  it('missing moveInDate → tenureMonths 0', () => {
    const r = computeReputation({ ...base, moveInDate: undefined });
    assert.equal(r.factors.tenureMonths, 0);
    assert.equal(r.factors.tenureScore, 0);
  });
});

// ── Complaint-free streak ─────────────────────────────────────────────────────

describe('computeReputation — complaint', () => {
  const base = { bills: [ON_TIME()], moveInDate: OLD_MOVE_IN, now: NOW };

  it('no complaints + long tenure → complaintScore 100 (capped at 12mo)', () => {
    const r = computeReputation({ ...base, complaints: [] });
    assert.equal(r.factors.complaintScore, 100);
  });

  it('complaint 6mo ago → complaintScore 50', () => {
    const r = computeReputation({ ...base, complaints: [{ createdAt: monthsAgo(6) }] });
    assert.equal(r.factors.complaintFreeMonths, 6);
    assert.equal(r.factors.complaintScore, 50);
  });

  it('complaint today → complaintScore 0', () => {
    const r = computeReputation({ ...base, complaints: [{ createdAt: NOW }] });
    assert.equal(r.factors.complaintScore, 0);
  });

  it('uses the most-recent of multiple complaints', () => {
    const r = computeReputation({ ...base, complaints: [{ createdAt: monthsAgo(10) }, { createdAt: monthsAgo(3) }] });
    assert.equal(r.factors.complaintFreeMonths, 3);
    assert.equal(r.factors.complaintScore, 25);
  });
});

// ── Weighting + provisional renormalisation ──────────────────────────────────

describe('computeReputation — 60/25/15 weighting', () => {
  it('payment100 + tenure100 + complaint100 → 100', () => {
    const r = computeReputation({ bills: [ON_TIME()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.reputation, 100);
  });

  it('payment0 + tenure100 + complaint100 → 40 (payment is the 60-pt swing)', () => {
    const r = computeReputation({ bills: [LATE()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.reputation, 40);
  });

  it('60% weight isolation: payment100, tenure0, complaint0 → 60', () => {
    // synthetic unit input — moveIn=NOW zeroes tenure + complaint, on-time bill keeps payment 100
    const r = computeReputation({ bills: [ON_TIME()], moveInDate: NOW, complaints: [], now: NOW });
    assert.equal(r.factors.tenureScore, 0);
    assert.equal(r.factors.complaintScore, 0);
    assert.equal(r.reputation, 60);
    assert.equal(r.provisional, false);
  });

  it('renorm: null payment + tenure100 + complaint0 → 63', () => {
    // 30mo tenure (100) but a complaint today (streak 0) and no ratable bills
    const r = computeReputation({ bills: [], moveInDate: OLD_MOVE_IN, complaints: [{ createdAt: NOW }], now: NOW });
    assert.equal(r.factors.tenureScore, 100);
    assert.equal(r.factors.complaintScore, 0);
    // (0.25·100 + 0.15·0) / 0.40 = 62.5 → 63
    assert.equal(r.reputation, 63);
    assert.equal(r.provisional, true);
  });

  it('renorm: null payment + no data → 0 provisional', () => {
    const r = computeReputation({ bills: [], moveInDate: NOW, complaints: [], now: NOW });
    assert.equal(r.reputation, 0);
    assert.equal(r.provisional, true);
  });
});

// ── Robustness + determinism ──────────────────────────────────────────────────

describe('computeReputation — robustness', () => {
  it('no args → does not throw, provisional, reputation 0', () => {
    const r = computeReputation();
    assert.equal(r.provisional, true);
    assert.equal(r.reputation, 0);
    assert.equal(r.factors.paymentScore, null);
    assert.equal(r.factors.onTimeBills, 0);
  });

  it('deterministic: identical input → identical output', () => {
    const input = { bills: [ON_TIME(), LATE()], moveInDate: monthsAgo(15), complaints: [{ createdAt: monthsAgo(2) }], now: NOW };
    assert.deepEqual(computeReputation(input), computeReputation(input));
  });

  it('reputation is an integer within [0,100]', () => {
    const r = computeReputation({ bills: [ON_TIME(), LATE(), LATE()], moveInDate: monthsAgo(7), complaints: [{ createdAt: monthsAgo(1) }], now: NOW });
    assert.equal(Number.isInteger(r.reputation), true);
    assert.equal(r.reputation >= 0 && r.reputation <= 100, true);
  });

  it('accepts ISO string / Date / Firestore Timestamp for dates', () => {
    const ms = monthsAgo(24);
    const asNum  = computeReputation({ bills: [ON_TIME()], moveInDate: ms, complaints: [], now: NOW });
    const asISO  = computeReputation({ bills: [ON_TIME()], moveInDate: new Date(ms).toISOString(), complaints: [], now: NOW });
    const asDate = computeReputation({ bills: [ON_TIME()], moveInDate: new Date(ms), complaints: [], now: NOW });
    const asTs   = computeReputation({ bills: [ON_TIME()], moveInDate: { seconds: Math.floor(ms / 1000), nanoseconds: 0 }, complaints: [], now: NOW });
    assert.equal(asNum.factors.tenureScore, 100);
    assert.equal(asISO.factors.tenureScore, 100);
    assert.equal(asDate.factors.tenureScore, 100);
    assert.equal(asTs.factors.tenureScore, 100);
  });
});

// ── Tenant-facing tier enum (Phase 3.2a v1.x) ────────────────────────────────

describe('reputationTier — tenant-facing enum', () => {
  it('provisional flag wins regardless of score', () => {
    assert.equal(reputationTier(100, true), 'provisional');
    assert.equal(reputationTier(0, true), 'provisional');
    assert.equal(reputationTier(75, true), 'provisional');
  });

  it('maps score bands to admin-aligned keys (80/60/40)', () => {
    assert.equal(reputationTier(95, false), 'high');
    assert.equal(reputationTier(70, false), 'good');
    assert.equal(reputationTier(50, false), 'fair');
    assert.equal(reputationTier(10, false), 'low');
  });

  it('boundaries are inclusive at 80 / 60 / 40', () => {
    assert.equal(reputationTier(80, false), 'high');
    assert.equal(reputationTier(79, false), 'good');
    assert.equal(reputationTier(60, false), 'good');
    assert.equal(reputationTier(59, false), 'fair');
    assert.equal(reputationTier(40, false), 'fair');
    assert.equal(reputationTier(39, false), 'low');
  });

  it('non-finite / null score → low (never throws)', () => {
    assert.equal(reputationTier(null, false), 'low');
    assert.equal(reputationTier(undefined, false), 'low');
    assert.equal(reputationTier(NaN, false), 'low');
  });

  it('omitted provisional arg treated as falsy', () => {
    assert.equal(reputationTier(85), 'high');
    assert.equal(reputationTier(20), 'low');
  });

  it('integrates with computeReputation output (provisional tenant → provisional tier)', () => {
    const r = computeReputation({ bills: [], moveInDate: monthsAgo(5), complaints: [], now: NOW });
    assert.equal(r.provisional, true);
    assert.equal(reputationTier(r.reputation, r.provisional), 'provisional');
  });

  it('integrates with computeReputation output (strong tenant → high tier)', () => {
    const r = computeReputation({ bills: [ON_TIME(), ON_TIME()], moveInDate: OLD_MOVE_IN, complaints: [], now: NOW });
    assert.equal(r.reputation, 100);
    assert.equal(reputationTier(r.reputation, r.provisional), 'high');
  });
});
