/**
 * Unit tests for dashboard-kindness.js — the PURE helpers (kindTier, computeKindStats).
 * Loads the module in a VM context (no DOM / no firebase) and calls the exported pure
 * fns, exactly like dashboard-reputation.test.js. The render/recompute paths are
 * browser-only and not exercised here.
 *
 * Run: node --test shared/__tests__/dashboard-kindness.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const prev = global.window;
  global.window = {};
  try {
    const abs = path.join(__dirname, '..', 'dashboard-kindness.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-kindness.js' });
    return global.window._ins.kindness;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}
const M = load();

describe('kindTier', () => {
  it('maps score bands to positive tiers', () => {
    assert.equal(M.kindTier(95).key, 'radiant');
    assert.equal(M.kindTier(70).key, 'radiant');
    assert.equal(M.kindTier(69).key, 'warm');
    assert.equal(M.kindTier(40).key, 'warm');
    assert.equal(M.kindTier(39).key, 'kind');
    assert.equal(M.kindTier(10).key, 'kind');
    assert.equal(M.kindTier(9).key, 'budding');
    assert.equal(M.kindTier(1).key, 'budding');
    assert.equal(M.kindTier(0).key, 'seed');
  });

  it('handles null/undefined/NaN → none', () => {
    assert.equal(M.kindTier(null).key, 'none');
    assert.equal(M.kindTier(undefined).key, 'none');
    assert.equal(M.kindTier(NaN).key, 'none');
  });

  it('every tier carries label, color, emoji', () => {
    for (const s of [95, 50, 20, 3, 0, null]) {
      const t = M.kindTier(s);
      assert.ok(t.label && t.color && t.emoji, `tier for ${s} complete`);
    }
  });

  it('never returns a negative/"low" framing — generosity is positive-only', () => {
    // No tier should read as "ต่ำ"/"low"/red. The lowest real states are seed/budding.
    for (const s of [0, 1, 5, 9]) {
      const t = M.kindTier(s);
      assert.ok(['seed', 'budding'].includes(t.key), `${s} → gentle tier, got ${t.key}`);
      assert.ok(!/ต่ำ|low/i.test(t.label), `${s} label not negative`);
    }
  });
});

describe('computeKindStats', () => {
  const D = (kindness, totalEvents, extra = {}) => ({
    kindness, kindnessProvisional: totalEvents < 3,
    kindnessFactors: { totalEvents, questCount: totalEvents, foodShareCount: 0, helpCompletedCount: 0 },
    building: 'nest', roomId: 'N1', ...extra,
  });

  it('empty / undefined → zeroed object', () => {
    for (const inp of [undefined, null, []]) {
      const s = M.computeKindStats(inp);
      assert.equal(s.count, 0);
      assert.equal(s.giversCount, 0);
      assert.equal(s.avgGivers, null);
      assert.equal(s.totalActs, 0);
      assert.deepEqual(s.sorted, []);
    }
  });

  it('counts all finite-kindness docs but ranks only givers (totalEvents>0)', () => {
    const docs = [
      D(13, 4, { roomId: 'N101' }),  // giver
      D(0, 0, { roomId: 'N102' }),   // not a giver (0 acts)
      D(20, 3, { roomId: 'N405' }),  // giver
      { kindness: null, kindnessFactors: { totalEvents: 0 }, building: 'nest', roomId: 'X' }, // dropped (null)
    ];
    const s = M.computeKindStats(docs);
    assert.equal(s.count, 3);          // 3 finite-kindness docs (null dropped)
    assert.equal(s.giversCount, 2);    // only the 2 with acts
    assert.equal(s.totalActs, 7);      // 4 + 0 + 3
    assert.equal(s.avgGivers, 17);     // round((13+20)/2) = 16.5 → 17
    assert.equal(s.sorted.length, 2);  // only givers ranked
    assert.equal(s.sorted[0].roomId, 'N405'); // 20 before 13
    assert.equal(s.sorted[1].roomId, 'N101');
  });

  it('avg is over GIVERS only (0-act tenants do not drag it down)', () => {
    const docs = [D(60, 5), D(0, 0), D(0, 0), D(0, 0)];
    const s = M.computeKindStats(docs);
    assert.equal(s.giversCount, 1);
    assert.equal(s.avgGivers, 60); // not 15 (which a count-all avg would give)
  });

  it('breaks ties by act count then building/room', () => {
    const docs = [
      D(13, 2, { roomId: 'B' }),
      D(13, 5, { roomId: 'A' }), // same score, more acts → first
    ];
    const s = M.computeKindStats(docs);
    assert.equal(s.sorted[0].roomId, 'A');
  });
});
