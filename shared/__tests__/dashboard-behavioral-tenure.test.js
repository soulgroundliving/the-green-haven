/**
 * Unit tests for shared/dashboard-behavioral-tenure.js — Phase 3.1 pure compute.
 *
 * The module's render fn needs DOM + Firebase, but the math (tenure stats,
 * turnover from archive entries, move-out propensity scoring) is pure and
 * exported on window._ins.behavioralTenure. Loaded in a vm sandbox with a bare
 * window stub (same pattern as dashboard-owner-insights.test.js). `typeof
 * DashColors` is guarded in the module so the missing global is safe at load.
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-tenure.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Load in THIS realm (not vm.createContext) so array/object literals created
// inside the module share the test's intrinsics — otherwise assert/strict's
// deepEqual fails on prototype mismatch even for equal values. The module is a
// self-contained IIFE that only touches `window`; we stub global.window for the
// load, grab the namespace, then restore.
function load() {
  const prev = global.window;
  global.window = {};
  try {
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-tenure.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-tenure.js' });
    return global.window._ins.behavioralTenure;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();
const DAY = 86400000;
const MONTH = 30 * DAY;
const NOW = Date.UTC(2026, 5, 15); // 2026-06-15

describe('monthsBetween', () => {
  test('null / non-finite inputs → null', () => {
    assert.equal(M.monthsBetween(null, 1), null);
    assert.equal(M.monthsBetween(1, null), null);
    assert.equal(M.monthsBetween(NaN, 1), null);
  });
  test('floors to whole months (30-day month)', () => {
    assert.equal(M.monthsBetween(0, 90 * DAY), 3);
    assert.equal(M.monthsBetween(0, 89 * DAY), 2); // floor
    assert.equal(M.monthsBetween(0, 0), 0);
  });
});

describe('median / avg', () => {
  test('empty → null', () => {
    assert.equal(M.median([]), null);
    assert.equal(M.avg([]), null);
  });
  test('median odd / even, ignores null', () => {
    assert.equal(M.median([1, 3, 2]), 2);
    assert.equal(M.median([1, 2, 3, 4]), 3); // round((2+3)/2)=3
    assert.equal(M.median([5, null, 1, 3]), 3);
  });
  test('avg rounds, ignores non-finite', () => {
    assert.equal(M.avg([2, 4]), 3);
    assert.equal(M.avg([1, 2, 2]), 2); // round(1.67)=2
    assert.equal(M.avg([4, null, NaN]), 4);
  });
});

describe('computeTenureStats', () => {
  test('empty → zeroed', () => {
    const s = M.computeTenureStats([]);
    assert.equal(s.count, 0);
    assert.equal(s.avgMonths, null);
    assert.equal(s.medianMonths, null);
    assert.deepEqual(s.buckets, { le3: 0, le6: 0, le12: 0, gt12: 0, unknown: 0 });
    assert.deepEqual(s.longest, []);
  });
  test('buckets + unknown + longest top-5 desc', () => {
    const recs = [
      { roomId: 'a', tenureMonths: 2 },
      { roomId: 'b', tenureMonths: 5 },
      { roomId: 'c', tenureMonths: 10 },
      { roomId: 'd', tenureMonths: 24 },
      { roomId: 'e', tenureMonths: 36 },
      { roomId: 'f', tenureMonths: null },
    ];
    const s = M.computeTenureStats(recs);
    assert.equal(s.count, 6);
    assert.deepEqual(s.buckets, { le3: 1, le6: 1, le12: 1, gt12: 2, unknown: 1 });
    assert.equal(s.longest.length, 5);
    assert.equal(s.longest[0].roomId, 'e'); // 36
    assert.equal(s.longest[1].roomId, 'd'); // 24
    // avg/median over non-null [2,5,10,24,36]
    assert.equal(s.medianMonths, 10);
    assert.equal(s.avgMonths, 15); // round(77/5)=15
  });
  test('boundary: exactly 3 months → le3, exactly 12 → le12', () => {
    const s = M.computeTenureStats([{ tenureMonths: 3 }, { tenureMonths: 12 }, { tenureMonths: 13 }]);
    assert.equal(s.buckets.le3, 1);
    assert.equal(s.buckets.le12, 1);
    assert.equal(s.buckets.gt12, 1);
  });
});

describe('computeTurnover', () => {
  test('empty → zeroed, 6 month buckets', () => {
    const t = M.computeTurnover([], NOW);
    assert.equal(t.total, 0);
    assert.equal(t.completed12mo, 0);
    assert.equal(t.avgCompletedMonths, null);
    assert.equal(t.medianCompletedMonths, null);
    assert.equal(t.byMonth.length, 6);
    assert.equal(t.byMonth[5].ym, '2026-06'); // newest = current month
    assert.equal(t.byMonth[0].ym, '2026-01'); // oldest = 5 months back
    assert.ok(t.byMonth.every(b => b.count === 0));
  });
  test('completed12mo counts only archives within 365d', () => {
    const entries = [
      { moveInMs: NOW - 200 * DAY, archivedMs: NOW - 30 * DAY },  // recent
      { moveInMs: NOW - 500 * DAY, archivedMs: NOW - 400 * DAY }, // >365d
    ];
    const t = M.computeTurnover(entries, NOW);
    assert.equal(t.total, 2);
    assert.equal(t.completed12mo, 1);
  });
  test('completed durations: avg + median over move-in→archive', () => {
    const entries = [
      { moveInMs: 0, archivedMs: 6 * MONTH },   // 6 mo
      { moveInMs: 0, archivedMs: 12 * MONTH },  // 12 mo
      { moveInMs: 0, archivedMs: 3 * MONTH },   // 3 mo
      { moveInMs: null, archivedMs: NOW },      // unknown move-in → excluded from durations
    ];
    const t = M.computeTurnover(entries, NOW);
    assert.equal(t.total, 4);
    assert.equal(t.medianCompletedMonths, 6); // [3,6,12]
    assert.equal(t.avgCompletedMonths, 7);    // round(21/3)=7
  });
  test('byMonth groups archives into the right calendar month', () => {
    const entries = [
      { moveInMs: NOW - 100 * DAY, archivedMs: Date.UTC(2026, 5, 10) }, // 2026-06
      { moveInMs: NOW - 100 * DAY, archivedMs: Date.UTC(2026, 4, 2) },  // 2026-05
      { moveInMs: NOW - 100 * DAY, archivedMs: Date.UTC(2026, 4, 28) }, // 2026-05
    ];
    const t = M.computeTurnover(entries, NOW);
    const may = t.byMonth.find(b => b.ym === '2026-05');
    const jun = t.byMonth.find(b => b.ym === '2026-06');
    assert.equal(may.count, 2);
    assert.equal(jun.count, 1);
  });
  test('ignores entries with no archivedMs', () => {
    const t = M.computeTurnover([{ moveInMs: 0, archivedMs: null }], NOW);
    assert.equal(t.total, 0);
  });
});

describe('computeMovePropensity', () => {
  test('no signals → score 0, stable, no factors', () => {
    const p = M.computeMovePropensity({});
    assert.equal(p.score, 0);
    assert.equal(p.tier, 'stable');
    assert.deepEqual(p.factors, []);
  });
  test('lease expiry tiers', () => {
    assert.equal(M.computeMovePropensity({ daysToEnd: 20 }).score, 40);
    assert.equal(M.computeMovePropensity({ daysToEnd: 45 }).score, 28);
    assert.equal(M.computeMovePropensity({ daysToEnd: 80 }).score, 18);
    assert.equal(M.computeMovePropensity({ daysToEnd: 120 }).score, 0); // >90 = no flag
  });
  test('expired contract scores', () => {
    const p = M.computeMovePropensity({ daysToEnd: -5 });
    assert.equal(p.score, 35);
    assert.match(p.factors[0], /หมดแล้ว/);
  });
  test('tier thresholds: watch >=25, high >=50', () => {
    assert.equal(M.computeMovePropensity({ daysToEnd: 20 }).tier, 'watch');           // 40
    assert.equal(M.computeMovePropensity({ daysToEnd: 20, paymentLateCount: 3 }).tier, 'high'); // 60
    assert.equal(M.computeMovePropensity({ tenureMonths: 2 }).tier, 'stable');        // 12
  });
  test('enrichment factors stack and cap at 100', () => {
    const p = M.computeMovePropensity({
      daysToEnd: -10, tenureMonths: 1, inactiveDays: 30,
      paymentLateCount: 5, complaintCount90d: 4,
    });
    // 35 + 12 + 10 + 20 + 15 = 92
    assert.equal(p.score, 92);
    assert.equal(p.tier, 'high');
    assert.ok(p.factors.length === 5);
  });
  test('missing enrichment data does not penalize (null ≠ 0 threshold)', () => {
    const p = M.computeMovePropensity({ daysToEnd: 100, paymentLateCount: null, complaintCount90d: null });
    assert.equal(p.score, 0);
  });
});

describe('rankPropensity', () => {
  test('sorts descending by score, annotates each record', () => {
    const recs = [
      { roomId: 'low', daysToEnd: 200 },                 // 0
      { roomId: 'high', daysToEnd: 10, paymentLateCount: 4 }, // 60
      { roomId: 'mid', daysToEnd: 50 },                  // 28
    ];
    const ranked = M.rankPropensity(recs);
    assert.deepEqual(ranked.map(r => r.roomId), ['high', 'mid', 'low']);
    assert.ok(ranked[0].propensity && typeof ranked[0].propensity.score === 'number');
  });
});
