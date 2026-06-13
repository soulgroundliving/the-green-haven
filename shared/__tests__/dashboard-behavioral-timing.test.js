/**
 * Unit tests for shared/dashboard-behavioral-timing.js — Behavioral Analytics Phase 0.
 *
 * computeTiming is pure (no I/O) and exported on window._ins.behavioralTiming.
 * Loaded in THIS realm (vm.runInThisContext) so deepEqual works on module arrays.
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-timing.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const prev = global.window;
  global.window = {};
  try {
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-timing.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-timing.js' });
    return global.window._ins.behavioralTiming;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();
const HOUR = 3600000;
const DAY = 86400000;
// A late-window "now" so all crafted events sit comfortably inside 90 days.
const NOW = Date.UTC(2026, 5, 15, 0, 0); // 2026-06-15 00:00 UTC

function gridSum(grid) {
  return grid.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
}

describe('computeTiming — empty / degenerate', () => {
  test('no events → all zero, peak count 0', () => {
    const e = M.computeTiming([], NOW);
    assert.equal(e.total, 0);
    assert.equal(gridSum(e.grid), 0);
    assert.equal(e.peak.count, 0);
    assert.equal(e.peakHour.count, 0);
    assert.equal(e.peakDow.count, 0);
    assert.equal(e.weekdayCount, 0);
    assert.equal(e.weekendCount, 0);
    assert.equal(e.grid.length, 7);
    assert.equal(e.grid[0].length, 24);
  });

  test('null entry and non-finite atMs are skipped', () => {
    const e = M.computeTiming([
      null,
      { atMs: NaN },
      { atMs: undefined },
      { atMs: 'not-a-number' },
      { atMs: NOW - 2 * DAY }, // the only valid one
    ], NOW);
    assert.equal(e.total, 1);
  });

  test('events older than the 90-day window are excluded', () => {
    const e = M.computeTiming([
      { atMs: NOW - 100 * DAY }, // outside
      { atMs: NOW - 3 * DAY },   // inside
    ], NOW);
    assert.equal(e.total, 1);
  });
});

describe('computeTiming — BKK (UTC+7) bucketing', () => {
  test('05:00 UTC buckets to 12:00 BKK (no day rollover)', () => {
    const e = M.computeTiming([{ atMs: Date.UTC(2026, 5, 1, 5, 0) }], NOW);
    assert.equal(e.total, 1);
    assert.equal(e.byHour[12], 1);
    assert.equal(e.peakHour.hour, 12);
    assert.equal(gridSum(e.grid), 1);
  });

  test('18:00 UTC rolls into 01:00 BKK next day — proves the +7h offset, not UTC/local', () => {
    const e = M.computeTiming([{ atMs: Date.UTC(2026, 5, 1, 18, 0) }], NOW);
    assert.equal(e.byHour[1], 1);  // 18:00 + 7h = 01:00
    assert.equal(e.byHour[18], 0); // NOT bucketed at the raw UTC hour
  });

  test('23:30 BKK and 00:30 BKK land in hours 23 and 0', () => {
    // 16:30 UTC = 23:30 BKK ; 17:30 UTC = 00:30 BKK (next day)
    const e = M.computeTiming([
      { atMs: Date.UTC(2026, 5, 1, 16, 30) },
      { atMs: Date.UTC(2026, 5, 1, 17, 30) },
    ], NOW);
    assert.equal(e.byHour[23], 1);
    assert.equal(e.byHour[0], 1);
    assert.equal(e.total, 2);
  });
});

describe('computeTiming — day-of-week distribution (calendar-independent)', () => {
  test('7 consecutive days at BKK noon → each weekday once, 5 weekday + 2 weekend', () => {
    // 05:00 UTC = 12:00 BKK; step exactly 24h so every day stays at BKK noon.
    const base = Date.UTC(2026, 0, 5, 5, 0);
    const events = [];
    for (let i = 0; i < 7; i++) events.push({ atMs: base + i * DAY });
    const later = base + 8 * DAY; // now, just after the run, all within 90d
    const e = M.computeTiming(events, later);

    assert.equal(e.total, 7);
    // Every day-of-week hit exactly once (7 consecutive days cover Mon..Sun).
    assert.deepEqual(e.byDow, [1, 1, 1, 1, 1, 1, 1]);
    // Weekend = Sat(5)+Sun(6) Mon-first → always 2 across any 7 consecutive days.
    assert.equal(e.weekendCount, 2);
    assert.equal(e.weekdayCount, 5);
    // All at the same BKK hour (noon).
    assert.equal(e.byHour[12], 7);
  });
});

describe('computeTiming — peak + grid integrity', () => {
  test('repeated (day,hour) raises the peak cell; grid sum equals total', () => {
    const slot = Date.UTC(2026, 5, 10, 7, 0); // 14:00 BKK, some weekday
    const e = M.computeTiming([
      { atMs: slot },
      { atMs: slot + 60000 },        // same hour bucket
      { atMs: slot + 2 * 60000 },    // same hour bucket → 3 in one cell
      { atMs: slot + 5 * HOUR },     // a different hour
    ], NOW);
    assert.equal(e.total, 4);
    assert.equal(e.peak.count, 3);
    assert.equal(e.peak.hour, 14);   // 07:00 UTC = 14:00 BKK
    assert.equal(e.peakHour.hour, 14);
    assert.equal(e.peakHour.count, 3);
    assert.equal(gridSum(e.grid), 4);
    // byHour and byDow are exact projections of grid.
    const hourFromGrid = new Array(24).fill(0);
    const dowFromGrid = new Array(7).fill(0);
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      hourFromGrid[h] += e.grid[d][h];
      dowFromGrid[d] += e.grid[d][h];
    }
    assert.deepEqual(e.byHour, hourFromGrid);
    assert.deepEqual(e.byDow, dowFromGrid);
  });
});
