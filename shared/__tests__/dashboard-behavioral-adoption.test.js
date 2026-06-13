/**
 * Unit tests for shared/dashboard-behavioral-adoption.js — Behavioral Analytics 1c.
 * splitByAdoption is pure; loaded via the vm shim (window._ins.behavioralAdoption).
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-adoption.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-adoption.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-adoption.js' });
    return global.window._ins.behavioralAdoption;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();

describe('splitByAdoption — dead-feature partition', () => {
  test('splits below vs at/above the threshold', () => {
    const items = [
      { k: 'home', count: 100, rooms: 8, pct: 80 },
      { k: 'usage', count: 20, rooms: 2, pct: 20 },
      { k: 'petpark', count: 1, rooms: 1, pct: 5 },     // dead (< 10)
      { k: 'quiz', count: 0, rooms: 0, pct: 0 },          // dead
    ];
    const { live, dead } = M.splitByAdoption(items, 10);
    assert.deepEqual(live.map((i) => i.k), ['home', 'usage']);
    assert.deepEqual(dead.map((i) => i.k), ['petpark', 'quiz']);
  });

  test('pct exactly at threshold is LIVE (not dead)', () => {
    const { live, dead } = M.splitByAdoption([{ k: 'x', pct: 10 }], 10);
    assert.equal(live.length, 1);
    assert.equal(dead.length, 0);
  });

  test('null pct (occupiedRooms 0) is treated as LIVE, never dead', () => {
    const { live, dead } = M.splitByAdoption([{ k: 'x', pct: null }], 10);
    assert.equal(live.length, 1);
    assert.equal(dead.length, 0);
  });

  test('empty / null input does not throw', () => {
    assert.deepEqual(M.splitByAdoption([], 10), { live: [], dead: [] });
    assert.deepEqual(M.splitByAdoption(null, 10), { live: [], dead: [] });
  });

  test('DEAD_PCT default is exported', () => {
    assert.equal(typeof M.DEAD_PCT, 'number');
    assert.ok(M.DEAD_PCT > 0 && M.DEAD_PCT < 100);
  });
});
