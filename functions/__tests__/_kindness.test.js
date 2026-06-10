/**
 * Unit tests for _kindness.js — pure computeKindness core (Meaning Layer #6).
 *
 * Verifies the math + invariants in isolation (no I/O, no firebase): source
 * filtering, positive-only summing, the target cap, the provisional accrual gate,
 * and the factors breakdown. The sweep wiring (ledger read → group by tenant →
 * doc write) is covered by computeTrustScoresScheduled.test.js.
 *
 * Run: node --test functions/__tests__/_kindness.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { computeKindness, KINDNESS_SOURCES, KINDNESS_CONSTANTS } = require('../_kindness');
const { KINDNESS_TARGET_POINTS, KINDNESS_MIN_EVENTS } = KINDNESS_CONSTANTS;

// Build N events of a source, each worth `pts` — handy for hitting thresholds.
const events = (source, n, pts) => Array.from({ length: n }, () => ({ source, points: pts }));

describe('computeKindness', () => {
  it('no events → kindness 0, provisional, empty factors', () => {
    const r = computeKindness({ events: [] });
    assert.equal(r.kindness, 0);
    assert.equal(r.provisional, true);
    assert.equal(r.factors.totalPoints, 0);
    assert.equal(r.factors.totalEvents, 0);
    assert.equal(r.factors.questPoints, 0);
    assert.equal(r.factors.foodSharePoints, 0);
    assert.equal(r.factors.helpCompletedPoints, 0);
  });

  it('missing/garbage input degrades gracefully (no throw)', () => {
    assert.equal(computeKindness().kindness, 0);
    assert.equal(computeKindness({}).kindness, 0);
    assert.equal(computeKindness({ events: null }).kindness, 0);
    assert.equal(computeKindness({ events: 'nope' }).provisional, true);
  });

  it('sums all three kindness sources into the breakdown', () => {
    const r = computeKindness({
      events: [
        { source: 'quest', points: 5 },
        { source: 'quest', points: 5 },
        { source: 'food_share', points: 10 },
        { source: 'help_completed', points: 20 },
      ],
    });
    assert.equal(r.factors.questPoints, 10);
    assert.equal(r.factors.questCount, 2);
    assert.equal(r.factors.foodSharePoints, 10);
    assert.equal(r.factors.foodShareCount, 1);
    assert.equal(r.factors.helpCompletedPoints, 20);
    assert.equal(r.factors.helpCompletedCount, 1);
    assert.equal(r.factors.totalPoints, 40);
    assert.equal(r.factors.totalEvents, 4);
    assert.equal(r.provisional, false); // 4 events ≥ KINDNESS_MIN_EVENTS
  });

  it('ignores non-kindness sources (daily_login, payment, redeem, wellness_quiz…)', () => {
    const r = computeKindness({
      events: [
        { source: 'help_completed', points: 20 },
        { source: 'daily_login', points: 1 },
        { source: 'payment', points: 150 },
        { source: 'redeem', points: -1200 },
        { source: 'wellness_quiz', points: 50 },
        { source: 'contract_quiz', points: 50 },
        { source: 'complaint_free_month', points: 50 },
      ],
    });
    // Only the single help_completed (+20) counts.
    assert.equal(r.factors.totalPoints, 20);
    assert.equal(r.factors.totalEvents, 1);
  });

  it('ignores non-positive points — a kind act is a positive earn, never subtracts', () => {
    const r = computeKindness({
      events: [
        { source: 'food_share', points: 10 },
        { source: 'food_share', points: 0 },     // zero → skipped
        { source: 'food_share', points: -10 },    // negative anomaly → skipped, not subtracted
        { source: 'quest', points: NaN },          // non-finite → skipped
        { source: 'quest', points: 'x' },          // non-numeric → skipped
      ],
    });
    assert.equal(r.factors.foodSharePoints, 10);
    assert.equal(r.factors.foodShareCount, 1);
    assert.equal(r.factors.totalPoints, 10);
    assert.equal(r.factors.totalEvents, 1);
  });

  it('scales linearly with cumulative points (half target → 50)', () => {
    const half = KINDNESS_TARGET_POINTS / 2;
    const r = computeKindness({ events: [{ source: 'help_completed', points: half }] });
    assert.equal(r.kindness, 50);
  });

  it('caps at 100 when points reach/exceed the target', () => {
    const atTarget = computeKindness({ events: [{ source: 'help_completed', points: KINDNESS_TARGET_POINTS }] });
    assert.equal(atTarget.kindness, 100);

    const overTarget = computeKindness({ events: [{ source: 'help_completed', points: KINDNESS_TARGET_POINTS * 5 }] });
    assert.equal(overTarget.kindness, 100); // clamped, never >100
  });

  it('provisional flips on the event count (accrual gate), not the point magnitude', () => {
    // Just under the threshold, even with big points → still provisional (little signal).
    const few = computeKindness({ events: events('help_completed', KINDNESS_MIN_EVENTS - 1, 100) });
    assert.equal(few.factors.totalEvents, KINDNESS_MIN_EVENTS - 1);
    assert.equal(few.provisional, true);

    // Exactly at the threshold → no longer provisional.
    const enough = computeKindness({ events: events('quest', KINDNESS_MIN_EVENTS, 5) });
    assert.equal(enough.factors.totalEvents, KINDNESS_MIN_EVENTS);
    assert.equal(enough.provisional, false);
  });

  it('kindness stays within 0–100 for any input', () => {
    for (const n of [0, 1, 50, 500]) {
      const r = computeKindness({ events: events('food_share', n, 10) });
      assert.ok(r.kindness >= 0 && r.kindness <= 100, `kindness ${r.kindness} out of range for n=${n}`);
    }
  });

  it('exposes the canonical source list + tunable constants', () => {
    assert.deepEqual([...KINDNESS_SOURCES], ['quest', 'food_share', 'help_completed']);
    assert.equal(typeof KINDNESS_TARGET_POINTS, 'number');
    assert.equal(typeof KINDNESS_MIN_EVENTS, 'number');
    // KINDNESS_SOURCES is frozen — can't be mutated by a consumer.
    assert.throws(() => { KINDNESS_SOURCES.push('giveaway'); });
  });
});
