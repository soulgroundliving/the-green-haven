/**
 * Unit tests for shared/dashboard-reputation.js — Trust System Phase 3.2a pure compute.
 *
 * The render/recompute fns need DOM + Firebase, but repTier + computeRepStats are
 * pure and exported on window._ins.reputation. Loaded in this realm with a bare
 * window stub (same pattern as dashboard-behavioral-tenure.test.js). `typeof
 * DashColors` is guarded in the module so the missing global is safe at load.
 *
 * Run: node --test shared/__tests__/dashboard-reputation.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-reputation.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-reputation.js' });
    return global.window._ins.reputation;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();

describe('repTier', () => {
  test('maps score bands to tiers', () => {
    assert.equal(M.repTier(95).key, 'high');
    assert.equal(M.repTier(80).key, 'high');
    assert.equal(M.repTier(79).key, 'good');
    assert.equal(M.repTier(60).key, 'good');
    assert.equal(M.repTier(59).key, 'fair');
    assert.equal(M.repTier(40).key, 'fair');
    assert.equal(M.repTier(39).key, 'low');
    assert.equal(M.repTier(0).key, 'low');
  });
  test('non-finite → none', () => {
    assert.equal(M.repTier(null).key, 'none');
    assert.equal(M.repTier(undefined).key, 'none');
    assert.equal(M.repTier(NaN).key, 'none');
  });
  test('each tier carries a label + colour', () => {
    for (const s of [90, 70, 50, 10]) {
      const t = M.repTier(s);
      assert.ok(t.label && t.label !== '—');
      assert.ok(t.color);
    }
  });
});

describe('computeRepStats', () => {
  test('empty / missing → zeroed', () => {
    const r = M.computeRepStats([]);
    assert.equal(r.count, 0);
    assert.equal(r.avg, null);
    assert.equal(r.provisionalCount, 0);
    assert.equal(r.ratedCount, 0);
    assert.deepEqual(r.sorted, []);
    assert.deepEqual(M.computeRepStats(undefined).sorted, []);
  });

  test('sorts by reputation desc and computes avg/counts', () => {
    const docs = [
      { reputation: 40, provisional: false, building: 'rooms', roomId: '15' },
      { reputation: 90, provisional: false, building: 'rooms', roomId: '12' },
      { reputation: 26, provisional: true,  building: 'nest',  roomId: 'N1' },
    ];
    const r = M.computeRepStats(docs);
    assert.equal(r.count, 3);
    assert.equal(r.avg, 52);                 // (40+90+26)/3 = 52
    assert.equal(r.provisionalCount, 1);
    assert.equal(r.ratedCount, 2);
    assert.deepEqual(r.sorted.map(d => d.reputation), [90, 40, 26]);
  });

  test('drops docs with non-finite reputation', () => {
    const docs = [
      { reputation: 50, building: 'rooms', roomId: '1' },
      { reputation: null, building: 'rooms', roomId: '2' },
      { building: 'rooms', roomId: '3' },
    ];
    const r = M.computeRepStats(docs);
    assert.equal(r.count, 1);
    assert.equal(r.avg, 50);
  });

  test('ties break by building+roomId for stable order', () => {
    const docs = [
      { reputation: 50, building: 'rooms', roomId: '9' },
      { reputation: 50, building: 'nest',  roomId: '1' },
    ];
    const r = M.computeRepStats(docs);
    // 'nest1' < 'rooms9' lexically → nest first
    assert.deepEqual(r.sorted.map(d => `${d.building}${d.roomId}`), ['nest1', 'rooms9']);
  });
});
