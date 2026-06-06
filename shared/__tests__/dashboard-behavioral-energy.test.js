/**
 * Unit tests for shared/dashboard-behavioral-energy.js — Phase 3.1 pure compute.
 *
 * The render fn needs DOM + Firebase, but the math (month keying, trailing-window
 * aggregation, avg/room, trajectory, peak) is pure and exported on
 * window._ins.behavioralEnergy. Loaded in a vm sandbox with a bare window stub
 * (same pattern as dashboard-behavioral-tenure.test.js). `typeof DashColors` is
 * guarded in the module so the missing global is safe at load.
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-energy.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-energy.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-energy.js' });
    return global.window._ins.behavioralEnergy;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();

describe('monthKey', () => {
  test('2-digit BE year + month → monotonic sortable key', () => {
    assert.equal(M.monthKey(69, 1), 69 * 12 + 0);
    assert.equal(M.monthKey(69, 12), 69 * 12 + 11);
    // cross-year ordering: 68/12 must sort before 69/1
    assert.ok(M.monthKey(68, 12) < M.monthKey(69, 1));
  });
  test('invalid month / non-finite → null', () => {
    assert.equal(M.monthKey(69, 0), null);
    assert.equal(M.monthKey(69, 13), null);
    assert.equal(M.monthKey(NaN, 5), null);
    assert.equal(M.monthKey(69, null), null);
  });
});

describe('monthLabel', () => {
  test('Thai month abbrev + 2-digit BE year', () => {
    assert.equal(M.monthLabel(69, 1), 'ม.ค. 69');
    assert.equal(M.monthLabel(69, 5), 'พ.ค. 69');
    assert.equal(M.monthLabel(69, 12), 'ธ.ค. 69');
  });
  test('out-of-range month falls back to the raw value', () => {
    assert.equal(M.monthLabel(69, 13), '13 69');
  });
});

describe('computeEnergyTrend', () => {
  test('empty → no months, zeroed summary', () => {
    const r = M.computeEnergyTrend([], 6);
    assert.deepEqual(r.months, []);
    assert.equal(r.summary.latestAvgE, 0);
    assert.equal(r.summary.deltaPct, null);
    assert.equal(r.summary.peakLabel, null);
    assert.equal(r.summary.monthsTracked, 0);
  });

  test('aggregates totals + distinct room count per month, avg = total/rooms', () => {
    const readings = [
      { building: 'rooms', roomId: '1', year: 69, month: 5, eUsage: 100, wUsage: 10 },
      { building: 'rooms', roomId: '2', year: 69, month: 5, eUsage: 200, wUsage: 20 },
      // same room appears twice in a month → counted once for the room count
      { building: 'rooms', roomId: '2', year: 69, month: 5, eUsage: 0, wUsage: 0 },
    ];
    const { months } = M.computeEnergyTrend(readings, 6);
    assert.equal(months.length, 1);
    assert.equal(months[0].totalE, 300);
    assert.equal(months[0].totalW, 30);
    assert.equal(months[0].rooms, 2);
    assert.equal(months[0].avgE, 150); // 300/2
    assert.equal(months[0].avgW, 15);  // 30/2
    assert.equal(months[0].label, 'พ.ค. 69');
  });

  test('negative usage (meter reset) is dropped from totals', () => {
    const readings = [
      { building: 'rooms', roomId: '1', year: 69, month: 5, eUsage: -50, wUsage: 5 },
      { building: 'rooms', roomId: '1', year: 69, month: 5, eUsage: 80, wUsage: -3 },
    ];
    const { months } = M.computeEnergyTrend(readings, 6);
    assert.equal(months[0].totalE, 80); // -50 skipped
    assert.equal(months[0].totalW, 5);  // -3 skipped
    assert.equal(months[0].rooms, 1);
  });

  test('keeps only the trailing N months, oldest→newest', () => {
    const readings = [];
    // 8 months: 69/1..69/8, one room each, eUsage = month*10
    for (let m = 1; m <= 8; m++) {
      readings.push({ building: 'rooms', roomId: '1', year: 69, month: m, eUsage: m * 10, wUsage: m });
    }
    const { months, summary } = M.computeEnergyTrend(readings, 6);
    assert.equal(months.length, 6);
    assert.equal(months[0].month, 3);  // 69/3 is the oldest kept (8 - 6 + 1)
    assert.equal(months[5].month, 8);  // newest
    assert.equal(summary.monthsTracked, 6);
  });

  test('deltaPct = latest avg vs prior avg; peak = highest avg/room', () => {
    const readings = [
      { building: 'rooms', roomId: '1', year: 69, month: 4, eUsage: 100, wUsage: 0 }, // avgE 100
      { building: 'rooms', roomId: '1', year: 69, month: 5, eUsage: 150, wUsage: 0 }, // avgE 150 (peak)
      { building: 'rooms', roomId: '1', year: 69, month: 6, eUsage: 120, wUsage: 0 }, // avgE 120 latest
    ];
    const { summary } = M.computeEnergyTrend(readings, 6);
    assert.equal(summary.latestAvgE, 120);
    assert.equal(summary.prevAvgE, 150);
    assert.equal(summary.deltaPct, -20); // (120-150)/150 = -20%
    assert.equal(summary.peakLabel, 'พ.ค. 69');
    assert.equal(summary.peakAvgE, 150);
  });

  test('deltaPct null when no prior month or prior avg is 0', () => {
    const one = M.computeEnergyTrend(
      [{ building: 'rooms', roomId: '1', year: 69, month: 6, eUsage: 100, wUsage: 0 }], 6);
    assert.equal(one.summary.deltaPct, null);
  });

  test('cross-year months order correctly (68/12 before 69/1)', () => {
    const readings = [
      { building: 'rooms', roomId: '1', year: 69, month: 1, eUsage: 50, wUsage: 0 },
      { building: 'rooms', roomId: '1', year: 68, month: 12, eUsage: 40, wUsage: 0 },
    ];
    const { months } = M.computeEnergyTrend(readings, 6);
    assert.equal(months[0].label, 'ธ.ค. 68');
    assert.equal(months[1].label, 'ม.ค. 69');
  });
});
