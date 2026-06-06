/**
 * Unit tests for shared/dashboard-behavioral-repair.js — Phase 3.1 pure compute.
 *
 * The render fn needs DOM + Firebase, but the math (month keying from epoch ms,
 * trailing-window count aggregation, season + category breakdown, peak detection)
 * is pure and exported on window._ins.behavioralRepair. Loaded in a vm sandbox
 * with a bare window stub (same pattern as dashboard-behavioral-energy.test.js).
 * `typeof DashColors` is guarded in the module so the missing global is safe.
 *
 * Timestamps are built with local-time `new Date(y, m-1, d)` and the module reads
 * getMonth()/getFullYear() (also local), so month bucketing is TZ-independent.
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-repair.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-repair.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-repair.js' });
    return global.window._ins.behavioralRepair;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();

// Local-time epoch ms for a given calendar month (mid-month so TZ can't flip it).
const ms = (y, m1to12, day) => new Date(y, m1to12 - 1, day || 15).getTime();

describe('monthKeyFromMs', () => {
  test('epoch ms → monotonic sortable key (year*12 + monthIndex)', () => {
    assert.equal(M.monthKeyFromMs(ms(2026, 1)), 2026 * 12 + 0);
    assert.equal(M.monthKeyFromMs(ms(2026, 12)), 2026 * 12 + 11);
    // cross-year ordering: 2025/12 must sort before 2026/1
    assert.ok(M.monthKeyFromMs(ms(2025, 12)) < M.monthKeyFromMs(ms(2026, 1)));
  });
  test('invalid / non-positive ms → null', () => {
    assert.equal(M.monthKeyFromMs(0), null);
    assert.equal(M.monthKeyFromMs(-5), null);
    assert.equal(M.monthKeyFromMs(NaN), null);
    assert.equal(M.monthKeyFromMs(null), null);
    assert.equal(M.monthKeyFromMs('nope'), null);
  });
});

describe('monthLabelFromMs', () => {
  test('Thai month abbrev + 2-digit BE year (CE+543)', () => {
    assert.equal(M.monthLabelFromMs(ms(2026, 1)), 'ม.ค. 69');  // 2026 → 2569
    assert.equal(M.monthLabelFromMs(ms(2026, 5)), 'พ.ค. 69');
    assert.equal(M.monthLabelFromMs(ms(2025, 12)), 'ธ.ค. 68'); // 2025 → 2568
  });
  test('invalid ms → null', () => {
    assert.equal(M.monthLabelFromMs(0), null);
    assert.equal(M.monthLabelFromMs(NaN), null);
  });
});

describe('seasonOfMonth (Thai seasons)', () => {
  test('hot Mar–May, rainy Jun–Oct, cool Nov–Feb', () => {
    assert.equal(M.seasonOfMonth(3), 'hot');
    assert.equal(M.seasonOfMonth(5), 'hot');
    assert.equal(M.seasonOfMonth(6), 'rainy');
    assert.equal(M.seasonOfMonth(10), 'rainy');
    assert.equal(M.seasonOfMonth(11), 'cool');
    assert.equal(M.seasonOfMonth(2), 'cool');
    assert.equal(M.seasonOfMonth(1), 'cool');
  });
  test('invalid month → null', () => {
    assert.equal(M.seasonOfMonth(0), null);
    assert.equal(M.seasonOfMonth(13), null);
    assert.equal(M.seasonOfMonth(NaN), null);
  });
});

describe('catLabel', () => {
  test('known category key → emoji+Thai label', () => {
    assert.equal(M.catLabel('electric'), '⚡ ไฟฟ้า');
    assert.equal(M.catLabel('aircon'), '❄️ แอร์');
  });
  test('null / empty → other; unknown key → raw passthrough', () => {
    assert.equal(M.catLabel(null), '📝 อื่นๆ');
    assert.equal(M.catLabel(''), '📝 อื่นๆ');
    assert.equal(M.catLabel('mystery'), 'mystery');
  });
});

describe('computeRepairSeasonality', () => {
  test('empty → no months, zeroed summary', () => {
    const r = M.computeRepairSeasonality([], 12);
    assert.deepEqual(r.months, []);
    assert.deepEqual(r.categories, []);
    assert.equal(r.summary.total, 0);
    assert.equal(r.summary.monthsTracked, 0);
    assert.equal(r.summary.peakMonthLabel, null);
    assert.equal(r.summary.peakSeasonName, null);
    assert.equal(r.summary.topCategoryKey, null);
  });

  test('counts repairs per month; peak month = highest count', () => {
    const tickets = [
      { completedAtMs: ms(2026, 4), category: 'electric' },
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 5), category: 'aircon' },
      { completedAtMs: ms(2026, 6), category: 'door' },
    ];
    const { months, summary } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(months.length, 3);
    assert.equal(summary.total, 5);
    assert.equal(months[0].label, 'เม.ย. 69');
    assert.equal(months[1].count, 3);          // May has the most
    assert.equal(summary.peakMonthLabel, 'พ.ค. 69');
    assert.equal(summary.peakMonthCount, 3);
  });

  test('completedAtMs preferred; falls back to createdAtMs when missing', () => {
    const tickets = [
      { createdAtMs: ms(2026, 3), category: 'other' },             // no completedAtMs → uses created (Mar)
      { completedAtMs: ms(2026, 7), createdAtMs: ms(2026, 1), category: 'other' }, // uses completed (Jul)
    ];
    const { months } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(months.length, 2);
    assert.equal(months[0].label, 'มี.ค. 69'); // from createdAtMs
    assert.equal(months[1].label, 'ก.ค. 69');  // from completedAtMs (not Jan)
  });

  test('category breakdown sorted desc; top category surfaced', () => {
    const tickets = [
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 6), category: 'water' },
      { completedAtMs: ms(2026, 6), category: 'electric' },
    ];
    const { categories, summary } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(categories[0].key, 'water');
    assert.equal(categories[0].count, 3);
    assert.equal(categories[0].pct, 75);       // 3/4
    assert.equal(categories[1].key, 'electric');
    assert.equal(summary.topCategoryKey, 'water');
    assert.equal(summary.topCategoryLabel, '💧 น้ำ/ประปา');
    assert.equal(summary.topCategoryCount, 3);
  });

  test('null/empty category bucketed as other', () => {
    const tickets = [
      { completedAtMs: ms(2026, 5), category: null },
      { completedAtMs: ms(2026, 5) },             // no category field
      { completedAtMs: ms(2026, 5), category: '' },
    ];
    const { categories } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(categories.length, 1);
    assert.equal(categories[0].key, 'other');
    assert.equal(categories[0].count, 3);
  });

  test('season aggregation; peak season = highest count', () => {
    const tickets = [
      { completedAtMs: ms(2026, 7), category: 'aircon' }, // rainy
      { completedAtMs: ms(2026, 8), category: 'aircon' }, // rainy
      { completedAtMs: ms(2026, 9), category: 'water' },  // rainy
      { completedAtMs: ms(2026, 4), category: 'electric' }, // hot
    ];
    const { seasons, summary } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(seasons[0].key, 'rainy');
    assert.equal(seasons[0].count, 3);
    assert.equal(summary.peakSeasonKey, 'rainy');
    assert.equal(summary.peakSeasonName, '🌧️ ฤดูฝน');
    assert.equal(summary.peakSeasonCount, 3);
  });

  test('keeps only the trailing N months, oldest→newest', () => {
    const tickets = [];
    // 14 distinct months 2025/1 .. 2026/2, one ticket each
    for (let i = 0; i < 14; i++) {
      const y = 2025 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      tickets.push({ completedAtMs: ms(y, m), category: 'other' });
    }
    const { months, summary } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(months.length, 12);
    assert.equal(summary.monthsTracked, 12);
    assert.equal(months[0].label, 'มี.ค. 68');  // 2025/3 is oldest kept (14 - 12 + 1)
    assert.equal(months[11].label, 'ก.พ. 69');  // 2026/2 newest
  });

  test('invalid timestamps are skipped (not counted)', () => {
    const tickets = [
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: 0, category: 'water' },       // skipped
      { createdAtMs: NaN, category: 'water' },       // skipped
      { category: 'water' },                          // no ts → skipped
    ];
    const { summary } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(summary.total, 1);
  });

  test('per-month top categories surfaced (max 2)', () => {
    const tickets = [
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 5), category: 'water' },
      { completedAtMs: ms(2026, 5), category: 'electric' },
      { completedAtMs: ms(2026, 5), category: 'aircon' },
    ];
    const { months } = M.computeRepairSeasonality(tickets, 12);
    assert.equal(months[0].top.length, 2);
    assert.equal(months[0].top[0].label, '💧 น้ำ/ประปา'); // water, count 2
    assert.equal(months[0].top[0].count, 2);
  });
});
