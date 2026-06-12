'use strict';

// Unit tests for functions/_residentRank.js (Meaning Layer #8 pure core).
// Pins the owner contract: balanced 40/30/30 blend (tenure rides inside
// reputation, NOT a separate term), 5-rung growth ladder, top rungs unreachable
// on reputation alone (participation lock-in), provisional does NOT force the
// tier, positive-only enum. Run: node --test functions/__tests__/_residentRank.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeResidentRank, residentRankTier, RANK_CONSTANTS } = require('../_residentRank');

describe('computeResidentRank — balanced blend (owner "สมดุล" 40/30/30)', () => {
  test('weights are reputation 0.40 / kindness 0.30 / verifiedHelper 0.30, summing to 1', () => {
    assert.equal(RANK_CONSTANTS.W_REPUTATION, 0.40);
    assert.equal(RANK_CONSTANTS.W_KINDNESS, 0.30);
    assert.equal(RANK_CONSTANTS.W_VERIFIED_HELPER, 0.30);
    const sum = RANK_CONSTANTS.W_REPUTATION + RANK_CONSTANTS.W_KINDNESS + RANK_CONSTANTS.W_VERIFIED_HELPER;
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to 1 (got ${sum})`);
  });

  test('all three maxed → 100 → taproot', () => {
    const r = computeResidentRank({ reputation: 100, kindness: 100, verifiedHelper: 100 });
    assert.equal(r.score, 100);
    assert.equal(r.tier, 'taproot');
  });

  test('all zero → 0 → seed', () => {
    const r = computeResidentRank({ reputation: 0, kindness: 0, verifiedHelper: 0 });
    assert.equal(r.score, 0);
    assert.equal(r.tier, 'seed');
  });

  test('exact weighted sum is rounded (40·0.4 + 50·0.3 + 60·0.3 = 49)', () => {
    const r = computeResidentRank({ reputation: 40, kindness: 50, verifiedHelper: 60 });
    // 16 + 15 + 18 = 49
    assert.equal(r.score, 49);
    assert.equal(r.tier, 'rooted'); // ≥35
  });

  test('factors echo the inputs + the weights used', () => {
    const r = computeResidentRank({ reputation: 80, kindness: 20, verifiedHelper: 10 });
    assert.equal(r.factors.reputation, 80);
    assert.equal(r.factors.kindness, 20);
    assert.equal(r.factors.verifiedHelper, 10);
    assert.deepEqual(r.factors.weights, { reputation: 0.40, kindness: 0.30, verifiedHelper: 0.30 });
  });
});

describe('computeResidentRank — participation lock-in (top rungs need community signal)', () => {
  test('reputation ALONE (kindness/helper 0) cannot exceed the rooted floor', () => {
    // Max reputation-only composite = 0.40·100 = 40 → rooted, never canopy/taproot.
    const maxRepOnly = computeResidentRank({ reputation: 100, kindness: 0, verifiedHelper: 0 });
    assert.equal(maxRepOnly.score, 40);
    assert.equal(maxRepOnly.tier, 'rooted');
    assert.ok(maxRepOnly.score < RANK_CONSTANTS.RANK_BOUND_CANOPY, 'reputation alone < canopy');
  });

  test('reaching canopy requires kindness + verifiedHelper, not just reputation', () => {
    const r = computeResidentRank({ reputation: 90, kindness: 50, verifiedHelper: 40 });
    // 36 + 15 + 12 = 63 → canopy
    assert.equal(r.score, 63);
    assert.equal(r.tier, 'canopy');
  });

  test('a settled long-tenure tenant with light kindness, no help jobs → rooted (ไม้ประจำถิ่น)', () => {
    // The classic complaint-free Nest resident: reputation high, some kindness, vh 0.
    const r = computeResidentRank({ reputation: 100, kindness: 13, verifiedHelper: 0 });
    // 40 + 3.9 + 0 = 43.9 → 44 → rooted
    assert.equal(r.score, 44);
    assert.equal(r.tier, 'rooted');
  });
});

describe('residentRankTier — 5-rung growth ladder bounds (75/55/35/15)', () => {
  test('bounds map exactly at each edge', () => {
    assert.equal(residentRankTier(75), 'taproot');
    assert.equal(residentRankTier(74), 'canopy');
    assert.equal(residentRankTier(55), 'canopy');
    assert.equal(residentRankTier(54), 'rooted');
    assert.equal(residentRankTier(35), 'rooted');
    assert.equal(residentRankTier(34), 'sprout');
    assert.equal(residentRankTier(15), 'sprout');
    assert.equal(residentRankTier(14), 'seed');
    assert.equal(residentRankTier(0), 'seed');
  });

  test('non-finite score → seed (never throws, never a scary state)', () => {
    assert.equal(residentRankTier(NaN), 'seed');
    assert.equal(residentRankTier(undefined), 'seed');
    assert.equal(residentRankTier(null), 'seed');
  });

  test('positive-only invariant — only the 5 growth rungs, never a low/negative tier', () => {
    const LADDER = ['taproot', 'canopy', 'rooted', 'sprout', 'seed'];
    for (const s of [-10, 0, 15, 35, 55, 75, 100, 200]) {
      assert.ok(LADDER.includes(residentRankTier(s)), `${s} → a valid rung`);
    }
  });
});

describe('computeResidentRank — provisional gate (informational, never forces the tier)', () => {
  test('provisional only when ALL three sub-scores are provisional', () => {
    const allProv = computeResidentRank({
      reputation: 0, kindness: 0, verifiedHelper: 0,
      reputationProvisional: true, kindnessProvisional: true, verifiedHelperProvisional: true,
    });
    assert.equal(allProv.provisional, true);
  });

  test('a real reputation (not provisional) → NOT provisional even with 0 community activity', () => {
    const r = computeResidentRank({
      reputation: 100, kindness: 0, verifiedHelper: 0,
      reputationProvisional: false, kindnessProvisional: true, verifiedHelperProvisional: true,
    });
    assert.equal(r.provisional, false);
  });

  test('provisional does NOT downgrade the tier — score still drives it', () => {
    // High reputation but provisional everywhere (e.g. a long-tenure 0-bill tenant
    // whose kindness/helper are also seed): the rank reflects the real reputation
    // contribution, it is NOT slammed to seed by the provisional flag.
    const r = computeResidentRank({
      reputation: 100, kindness: 0, verifiedHelper: 0,
      reputationProvisional: true, kindnessProvisional: true, verifiedHelperProvisional: true,
    });
    assert.equal(r.score, 40);
    assert.equal(r.tier, 'rooted'); // NOT seed — the score, not the flag, decides the rung
    assert.equal(r.provisional, true); // flag is informational only
  });
});

describe('computeResidentRank — robustness', () => {
  test('missing/undefined input → safe zero result', () => {
    const r = computeResidentRank();
    assert.equal(r.score, 0);
    assert.equal(r.tier, 'seed');
    assert.equal(r.provisional, false);
  });

  test('non-numeric / out-of-range sub-scores coerce safely', () => {
    const r = computeResidentRank({ reputation: 'nope', kindness: null, verifiedHelper: undefined });
    assert.equal(r.score, 0);
    assert.equal(r.factors.reputation, 0);
  });

  test('score is always an integer clamped 0..100', () => {
    for (const inp of [
      { reputation: 33, kindness: 33, verifiedHelper: 33 },
      { reputation: 999, kindness: 999, verifiedHelper: 999 },
      { reputation: -50, kindness: -50, verifiedHelper: -50 },
    ]) {
      const r = computeResidentRank(inp);
      assert.ok(Number.isInteger(r.score));
      assert.ok(r.score >= 0 && r.score <= 100);
    }
  });
});
