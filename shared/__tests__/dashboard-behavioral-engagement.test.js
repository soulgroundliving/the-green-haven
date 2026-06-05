/**
 * Unit tests for shared/dashboard-behavioral-engagement.js — Phase 3.1.
 *
 * computeEngagement is pure (no I/O) and exported on
 * window._ins.behavioralEngagement. Loaded in THIS realm (vm.runInThisContext)
 * so assert/strict deepEqual works on module-created arrays/objects.
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-engagement.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-engagement.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-engagement.js' });
    return global.window._ins.behavioralEngagement;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();
const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 15);
const ago = (days) => NOW - days * DAY;

describe('computeEngagement — empty / degenerate', () => {
  test('no events → zeroed, participationPct null when occupiedCount 0', () => {
    const e = M.computeEngagement([], NOW, { occupiedCount: 0 });
    assert.equal(e.activeParticipants30, 0);
    assert.equal(e.participationPct, null);
    assert.equal(e.avgPerActive, 0);
    assert.equal(e.totalEarned30, 0);
    assert.equal(e.totalEarned90, 0);
    assert.equal(e.redeemed30, 0);
    assert.deepEqual(e.bySource30, []);
    assert.deepEqual(e.movers.risers, []);
    assert.deepEqual(e.movers.fallers, []);
  });
  test('ignores events older than 90 days and points===0', () => {
    const e = M.computeEngagement([
      { tenantId: 't1', source: 'daily_login', points: 10, atMs: ago(100) }, // >90d
      { tenantId: 't1', source: 'daily_login', points: 0, atMs: ago(5) },     // zero
    ], NOW, { occupiedCount: 2 });
    assert.equal(e.totalEarned90, 0);
    assert.equal(e.activeParticipants30, 0);
  });
});

describe('computeEngagement — earning windows', () => {
  test('totals split recent-30 vs 90-day', () => {
    const e = M.computeEngagement([
      { tenantId: 't1', source: 'daily_login', points: 10, atMs: ago(5) },  // recent
      { tenantId: 't1', source: 'payment', points: 20, atMs: ago(40) },     // prior (in 90d)
      { tenantId: 't1', source: 'payment', points: 7, atMs: ago(70) },      // in 90d, neither window
    ], NOW, { occupiedCount: 4 });
    assert.equal(e.totalEarned30, 10);
    assert.equal(e.totalEarned90, 37);
  });
  test('redemptions excluded from earning, counted in redeemed30', () => {
    const e = M.computeEngagement([
      { tenantId: 't1', source: 'daily_login', points: 15, atMs: ago(3) },
      { tenantId: 't1', source: 'redeem', points: -50, atMs: ago(10) },
      { tenantId: 't1', source: 'redeem', points: -20, atMs: ago(45) }, // >30d → not in redeemed30
    ], NOW, { occupiedCount: 1 });
    assert.equal(e.totalEarned30, 15);
    assert.equal(e.redeemed30, 50);
    assert.equal(e.activeParticipants30, 1); // earning makes t1 active; redeem alone wouldn't
  });
});

describe('computeEngagement — participation + source breakdown', () => {
  test('activeParticipants30 distinct, participationPct vs occupiedCount', () => {
    const e = M.computeEngagement([
      { tenantId: 't1', source: 'daily_login', points: 5, atMs: ago(2) },
      { tenantId: 't1', source: 'payment', points: 100, atMs: ago(4) }, // same tenant — still 1
      { tenantId: 't2', source: 'daily_login', points: 5, atMs: ago(6) },
    ], NOW, { occupiedCount: 4 });
    assert.equal(e.activeParticipants30, 2);
    assert.equal(e.participationPct, 50); // 2/4
    assert.equal(e.avgPerActive, 55);     // (5+100+5)=110 / 2
  });
  test('bySource30 grouped, pct of recent earning total, sorted desc', () => {
    const e = M.computeEngagement([
      { tenantId: 't1', source: 'daily_login', points: 10, atMs: ago(2) },
      { tenantId: 't2', source: 'payment', points: 30, atMs: ago(3) },
    ], NOW, { occupiedCount: 5 });
    assert.equal(e.bySource30.length, 2);
    assert.equal(e.bySource30[0].source, 'payment'); // 30 > 10
    assert.equal(e.bySource30[0].pct, 75);
    assert.equal(e.bySource30[1].source, 'daily_login');
    assert.equal(e.bySource30[1].pct, 25);
  });
});

describe('computeEngagement — movers (Δ recent vs prior 30d)', () => {
  test('risers Δ>0 desc; fallers Δ<0 (with prior) asc', () => {
    const e = M.computeEngagement([
      // riser: recent 30, prior 5 → +25
      { tenantId: 'up', source: 'daily_login', points: 30, atMs: ago(5) },
      { tenantId: 'up', source: 'daily_login', points: 5, atMs: ago(45) },
      // faller: recent 10, prior 40 → -30
      { tenantId: 'down', source: 'payment', points: 10, atMs: ago(8) },
      { tenantId: 'down', source: 'payment', points: 40, atMs: ago(50) },
      // new (no prior): recent 12, prior 0 → +12 riser (delta>0)
      { tenantId: 'new', source: 'daily_login', points: 12, atMs: ago(1) },
    ], NOW, { occupiedCount: 10 });
    assert.deepEqual(e.movers.risers.map(r => r.tenantId), ['up', 'new']); // 25, 12
    assert.deepEqual(e.movers.fallers.map(r => r.tenantId), ['down']);     // -30
    assert.equal(e.movers.fallers[0].delta, -30);
  });
  test('a tenant with only prior activity (Δ<0) IS a faller', () => {
    const e = M.computeEngagement([
      { tenantId: 'gone', source: 'daily_login', points: 20, atMs: ago(40) }, // prior only
    ], NOW, { occupiedCount: 3 });
    assert.equal(e.activeParticipants30, 0);
    assert.deepEqual(e.movers.fallers.map(r => r.tenantId), ['gone']);
    assert.equal(e.movers.fallers[0].delta, -20);
  });
  test('caps risers/fallers at top 5', () => {
    const evs = [];
    for (let i = 0; i < 8; i++) evs.push({ tenantId: 'r' + i, source: 'daily_login', points: (i + 1) * 10, atMs: ago(3) });
    const e = M.computeEngagement(evs, NOW, { occupiedCount: 20 });
    assert.equal(e.movers.risers.length, 5);
    assert.equal(e.movers.risers[0].tenantId, 'r7'); // largest delta (80)
  });
});
