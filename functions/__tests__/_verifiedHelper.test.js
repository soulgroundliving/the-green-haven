'use strict';

// Unit tests for functions/_verifiedHelper.js (Meaning Layer #7 pure core).
// Pins the owner-D2 anti-farm contract: volume + DISTINCT requesters dominate,
// appreciation tags are a small bonus, < VH_MIN_JOBS = provisional, positive-only
// tiers. Run: node --test functions/__tests__/_verifiedHelper.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeVerifiedHelper, verifiedHelperTier, VH_CONSTANTS } = require('../_verifiedHelper');

const job = (requester, tags, completedAt) => ({
  requesterTenantId: requester,
  appreciationTags: tags || [],
  completedAt: completedAt || '2026-06-01T00:00:00Z',
});

describe('computeVerifiedHelper — empty / provisional gate (D3)', () => {
  test('no jobs → 0, provisional, newcomer', () => {
    const r = computeVerifiedHelper({ jobs: [] });
    assert.equal(r.score, 0);
    assert.equal(r.provisional, true);
    assert.equal(r.tier, 'newcomer');
    assert.equal(r.factors.completedCount, 0);
    assert.equal(r.factors.distinctRequesters, 0);
  });
  test('missing/undefined input → safe empty result', () => {
    const r = computeVerifiedHelper();
    assert.equal(r.score, 0);
    assert.equal(r.provisional, true);
  });
  test('below VH_MIN_JOBS confirmed jobs stays provisional', () => {
    const r = computeVerifiedHelper({ jobs: [job('t1'), job('t2')] }); // 2 < 3
    assert.equal(r.provisional, true);
    assert.equal(r.tier, 'newcomer');
    assert.equal(r.factors.completedCount, 2);
  });
  test('VH_MIN_JOBS is 3', () => {
    assert.equal(VH_CONSTANTS.VH_MIN_JOBS, 3);
  });
});

describe('computeVerifiedHelper — distinct requesters (D2 anti-farm)', () => {
  test('many jobs from ONE requester score far below the same count spread across many', () => {
    const farmed = computeVerifiedHelper({ jobs: [job('buddy'), job('buddy'), job('buddy'), job('buddy'), job('buddy'), job('buddy')] });
    const broad = computeVerifiedHelper({ jobs: [job('a'), job('b'), job('c'), job('d'), job('e'), job('f')] });
    assert.equal(farmed.factors.completedCount, 6);
    assert.equal(broad.factors.completedCount, 6);
    assert.equal(farmed.factors.distinctRequesters, 1);
    assert.equal(broad.factors.distinctRequesters, 6);
    assert.ok(broad.score > farmed.score, `broad ${broad.score} should beat farmed ${farmed.score}`);
  });
  test('distinct key falls back to requesterRoom when no tenantId', () => {
    const r = computeVerifiedHelper({ jobs: [
      { requesterRoom: '15', appreciationTags: [] },
      { requesterRoom: '16', appreciationTags: [] },
      { requesterRoom: '15', appreciationTags: [] },
    ] });
    assert.equal(r.factors.completedCount, 3);
    assert.equal(r.factors.distinctRequesters, 2); // 15, 16
  });
});

describe('computeVerifiedHelper — score blend + tag bonus (D2)', () => {
  test('full volume + full breadth saturates to 100', () => {
    // 8 jobs across 4 distinct requesters → base = 1.0
    const jobs = ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'].map((x) => job(x));
    const r = computeVerifiedHelper({ jobs });
    assert.equal(r.score, 100);
    assert.equal(r.tier, 'trusted');
  });
  test('appreciation tags add only a small bonus (never dominate)', () => {
    // 3 jobs, 1 distinct requester, no tags vs heavy tags — bonus is bounded
    const noTags = computeVerifiedHelper({ jobs: [job('a'), job('a'), job('a')] });
    const tagged = computeVerifiedHelper({ jobs: [
      job('a', ['kind', 'fast']), job('a', ['kind', 'extra']), job('a', ['friendly', 'trusty']),
    ] });
    const delta = tagged.score - noTags.score;
    assert.ok(delta > 0, 'tags should help');
    assert.ok(delta <= VH_CONSTANTS.TAG_BONUS_WEIGHT * 100 + 1, `tag bonus ${delta} must stay small (<= ${VH_CONSTANTS.TAG_BONUS_WEIGHT * 100})`);
    assert.equal(tagged.factors.totalTags, 6);
    assert.equal(tagged.factors.tagCounts.kind, 2);
  });
  test('score is clamped 0..100 and rounded integer', () => {
    const r = computeVerifiedHelper({ jobs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((x) => job(x, ['kind', 'fast', 'extra'])) });
    assert.ok(Number.isInteger(r.score));
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.equal(r.score, 100);
  });
});

describe('computeVerifiedHelper — robustness', () => {
  test('malformed rows are skipped, valid ones still count', () => {
    const r = computeVerifiedHelper({ jobs: [null, 42, 'x', job('a'), job('b'), job('c')] });
    assert.equal(r.factors.completedCount, 3);
    assert.equal(r.factors.distinctRequesters, 3);
  });
  test('lastCompletedAt is the max completedAt', () => {
    const r = computeVerifiedHelper({ jobs: [
      job('a', [], '2026-05-01T00:00:00Z'),
      job('b', [], '2026-06-15T00:00:00Z'),
      job('c', [], '2026-06-02T00:00:00Z'),
    ] });
    assert.equal(r.factors.lastCompletedAt, '2026-06-15T00:00:00Z');
  });
});

describe('verifiedHelperTier — positive-only enum (D4)', () => {
  test('provisional → newcomer regardless of score', () => {
    assert.equal(verifiedHelperTier(95, true), 'newcomer');
  });
  test('bounds: 70 trusted / 40 seasoned / 10 helper / below newcomer', () => {
    assert.equal(verifiedHelperTier(70, false), 'trusted');
    assert.equal(verifiedHelperTier(69, false), 'seasoned');
    assert.equal(verifiedHelperTier(40, false), 'seasoned');
    assert.equal(verifiedHelperTier(39, false), 'helper');
    assert.equal(verifiedHelperTier(10, false), 'helper');
    assert.equal(verifiedHelperTier(9, false), 'newcomer');
    assert.equal(verifiedHelperTier(0, false), 'newcomer');
  });
  test('non-finite score → newcomer', () => {
    assert.equal(verifiedHelperTier(NaN, false), 'newcomer');
    assert.equal(verifiedHelperTier(undefined, false), 'newcomer');
  });
  test('never returns a low/negative tier (positive-only invariant)', () => {
    for (const s of [0, 5, 10, 40, 70, 100]) {
      assert.ok(['trusted', 'seasoned', 'helper', 'newcomer'].includes(verifiedHelperTier(s, false)));
    }
  });
});
