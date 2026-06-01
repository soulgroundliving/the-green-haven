/**
 * Unit tests for shared/dashboard-owner-insights.js — _computeCFHealthStats.
 *
 * The CF Health board (Insight #8) reads the lineRetryQueue collection and
 * derives: queue depth (pending), 7-day success rate, avg attempts before
 * success, oldest-pending age, and recent-abandoned samples. The pure
 * derivation was extracted from the DOM render so the FIELD CONTRACT can be
 * locked: queue docs carry `firstFailureAt` (set at enqueue) and never
 * `createdAt`. A prior version read `i.createdAt`, so `new Date(undefined||0)`
 * collapsed to the epoch → nothing was ever "recent" → every 7-day stat read
 * zero and oldest-pending age rendered "NaN นาที". The `reads firstFailureAt,
 * not createdAt` test below is the regression guard for that bug.
 *
 * `_computeCFHealthStats` is module-internal (no window export), so the loader
 * appends a test-only shim to the source string (same pattern as
 * bill-generator.test.js). The module only executes `window.addEventListener`
 * + a couple of `window.X =` assignments at load time, so a minimal window stub
 * is enough — the helper itself is pure (no DOM, no Firebase).
 *
 * Run: node --test shared/__tests__/dashboard-owner-insights.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadComputeCFHealthStats() {
  const window = { addEventListener: () => {} };
  const context = {
    window,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    parseInt, parseFloat, isFinite, isNaN,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-owner-insights.js');
  vm.runInContext(
    fs.readFileSync(abs, 'utf8') + '\nwindow.__computeCFHealthStats = _computeCFHealthStats;',
    context,
    { filename: 'dashboard-owner-insights.js' }
  );
  return context.window.__computeCFHealthStats;
}

const compute = loadComputeCFHealthStats();

// Fixed "now" so ISO offsets are deterministic. 7-day cutoff = 2026-05-26T00:00Z.
const NOW = new Date('2026-06-02T00:00:00.000Z').getTime();
const recentIso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
const daysAgoIso = (days) => new Date(NOW - days * 86400000).toISOString();

function mk(status, firstFailureAt, attempts, lineUserId) {
  return { status, firstFailureAt, attempts, lineUserId };
}

describe('_computeCFHealthStats — empty / degenerate', () => {
  test('empty queue → zeroed, nulls, em-dash, no samples', () => {
    const s = compute([], NOW);
    assert.equal(s.pending, 0);
    assert.equal(s.sent, 0);
    assert.equal(s.abandoned, 0);
    assert.equal(s.successRate, null);
    assert.equal(s.avgAttempts, '—');
    assert.equal(s.sentItemsCount, 0);
    assert.equal(s.oldestPending, null);
    assert.equal(s.oldestPendingAgeMin, null);
    assert.deepEqual(s.recentAbandonedSamples, []);
  });
});

describe('_computeCFHealthStats — field contract (regression guard for createdAt→firstFailureAt)', () => {
  test('reads firstFailureAt, NOT createdAt — a createdAt-only doc is never "recent"', () => {
    const wrongField = { status: 'sent', createdAt: recentIso(1), attempts: 1 }; // no firstFailureAt
    const rightField = mk('sent', recentIso(1), 1, 'Uxxxxxx111111');
    const s = compute([wrongField, rightField], NOW);
    // Only the firstFailureAt-bearing doc counts toward the 7-day window.
    assert.equal(s.sent, 1);
    assert.equal(s.sentItemsCount, 1);
    assert.equal(s.successRate, 100);
  });

  test('oldest-pending age is a real number, never NaN, when firstFailureAt is present', () => {
    const s = compute([mk('pending', recentIso(2), 0, 'Upend11')], NOW);
    assert.equal(s.oldestPendingAgeMin, 120); // 2h ago → 120 min
    assert.ok(Number.isFinite(s.oldestPendingAgeMin));
  });
});

describe('_computeCFHealthStats — queue depth (pending)', () => {
  test('counts ALL pending regardless of age (depth ≠ 7-day window)', () => {
    const items = [
      mk('pending', recentIso(1), 0, 'Ua'),
      mk('pending', daysAgoIso(30), 4, 'Ub'), // old but still pending → counts
      mk('sent', recentIso(1), 1, 'Uc'),
    ];
    const s = compute(items, NOW);
    assert.equal(s.pending, 2);
  });
});

describe('_computeCFHealthStats — 7-day success rate + avg attempts', () => {
  test('successRate = sent / (sent + abandoned) within 7d, rounded', () => {
    const items = [
      mk('sent', recentIso(1), 1, 'Ua'),
      mk('sent', recentIso(2), 2, 'Ub'),
      mk('sent', recentIso(3), 3, 'Uc'),
      mk('abandoned', recentIso(4), 5, 'Ud'),
    ];
    const s = compute(items, NOW);
    assert.equal(s.sent, 3);
    assert.equal(s.abandoned, 1);
    assert.equal(s.successRate, 75); // 3/4
    assert.equal(s.avgAttempts, '2.0'); // (1+2+3)/3
    assert.equal(s.sentItemsCount, 3);
  });

  test('excludes settled docs older than 7 days from the rate', () => {
    const items = [
      mk('sent', recentIso(1), 1, 'Ua'),
      mk('sent', daysAgoIso(10), 1, 'Uold'),      // out of window
      mk('abandoned', daysAgoIso(12), 5, 'Uold2'), // out of window
    ];
    const s = compute(items, NOW);
    assert.equal(s.sent, 1);
    assert.equal(s.abandoned, 0);
    assert.equal(s.successRate, 100);
  });

  test('avgAttempts ignores sent docs whose attempts is null', () => {
    const items = [
      mk('sent', recentIso(1), 4, 'Ua'),
      { status: 'sent', firstFailureAt: recentIso(2), lineUserId: 'Ub' }, // attempts == null
    ];
    const s = compute(items, NOW);
    assert.equal(s.sentItemsCount, 1);
    assert.equal(s.avgAttempts, '4.0');
  });

  test('successRate null when nothing settled in window (avoids 0/0)', () => {
    const s = compute([mk('pending', recentIso(1), 0, 'Ua')], NOW);
    assert.equal(s.successRate, null);
  });
});

describe('_computeCFHealthStats — oldest pending', () => {
  test('picks the smallest firstFailureAt among pending and ages it from now', () => {
    const items = [
      mk('pending', recentIso(1), 0, 'Unew'),
      mk('pending', recentIso(3), 2, 'Uold'), // 3h ago → oldest
      mk('pending', recentIso(2), 1, 'Umid'),
    ];
    const s = compute(items, NOW);
    assert.equal(s.oldestPending.lineUserId, 'Uold');
    assert.equal(s.oldestPendingAgeMin, 180); // 3h
  });
});

describe('_computeCFHealthStats — recent abandoned samples', () => {
  test('most-recent 3, last-6 chars of lineUserId, newest first', () => {
    const items = [
      mk('abandoned', recentIso(1), 5, 'Uaaaaaa111111'),
      mk('abandoned', recentIso(2), 5, 'Ubbbbbb222222'),
      mk('abandoned', recentIso(3), 5, 'Ucccccc333333'),
      mk('abandoned', recentIso(4), 5, 'Udddddd444444'),
    ];
    const s = compute(items, NOW);
    assert.equal(s.abandoned, 4);
    assert.deepEqual(s.recentAbandonedSamples, ['111111', '222222', '333333']);
  });

  test('abandoned docs older than 7 days are excluded from samples', () => {
    const items = [
      mk('abandoned', recentIso(1), 5, 'Uxxxxxx012345'),
      mk('abandoned', daysAgoIso(20), 5, 'Uold9999999'),
    ];
    const s = compute(items, NOW);
    assert.equal(s.abandoned, 1);
    assert.deepEqual(s.recentAbandonedSamples, ['012345']);
  });
});
