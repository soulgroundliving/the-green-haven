/**
 * Unit tests for dashboard-verified-helper.js — the PURE helpers (vhTier,
 * computeVHStats). Loads the module in a VM context (no DOM / no firebase) and
 * calls the exported pure fns, exactly like dashboard-kindness.test.js. The
 * render/recompute paths are browser-only and not exercised here.
 *
 * Run: node --test shared/__tests__/dashboard-verified-helper.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-verified-helper.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-verified-helper.js' });
    return global.window._ins.verifiedHelper;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}
const M = load();

describe('vhTier', () => {
  it('maps score bands to positive tiers (aligned with the CF enum bounds 70/40/10)', () => {
    assert.equal(M.vhTier(95).key, 'trusted');
    assert.equal(M.vhTier(70).key, 'trusted');
    assert.equal(M.vhTier(69).key, 'seasoned');
    assert.equal(M.vhTier(40).key, 'seasoned');
    assert.equal(M.vhTier(39).key, 'helper');
    assert.equal(M.vhTier(10).key, 'helper');
    assert.equal(M.vhTier(9).key, 'newcomer');
    assert.equal(M.vhTier(1).key, 'newcomer');
    assert.equal(M.vhTier(0).key, 'seed');
  });

  it('handles null/undefined/NaN → none', () => {
    assert.equal(M.vhTier(null).key, 'none');
    assert.equal(M.vhTier(undefined).key, 'none');
    assert.equal(M.vhTier(NaN).key, 'none');
  });

  it('every tier carries label, color, emoji', () => {
    for (const s of [95, 50, 20, 3, 0, null]) {
      const t = M.vhTier(s);
      assert.ok(t.label && t.color && t.emoji, `tier for ${s} complete`);
    }
  });

  it('never returns a negative/"low" framing — a helper credential is positive-only', () => {
    for (const s of [0, 1, 5, 9]) {
      const t = M.vhTier(s);
      assert.ok(['seed', 'newcomer'].includes(t.key), `${s} → gentle tier, got ${t.key}`);
      assert.ok(!/ต่ำ|low/i.test(t.label), `${s} label not negative`);
    }
  });
});

describe('computeVHStats', () => {
  const D = (verifiedHelper, completedCount, extra = {}) => ({
    verifiedHelper, verifiedHelperProvisional: completedCount < 3,
    verifiedHelperFactors: { completedCount, distinctRequesters: completedCount, totalTags: 0 },
    building: 'nest', roomId: 'N1', ...extra,
  });

  it('empty / undefined → zeroed object', () => {
    for (const inp of [undefined, null, []]) {
      const s = M.computeVHStats(inp);
      assert.equal(s.count, 0);
      assert.equal(s.helpersCount, 0);
      assert.equal(s.avgHelpers, null);
      assert.equal(s.totalJobs, 0);
      assert.deepEqual(s.sorted, []);
    }
  });

  it('counts all finite-score docs but ranks only helpers (completedCount>0)', () => {
    const docs = [
      D(45, 4, { roomId: 'N101' }),  // helper
      D(0, 0, { roomId: 'N102' }),   // not a helper (0 jobs)
      D(60, 3, { roomId: 'N405' }),  // helper
      { verifiedHelper: null, verifiedHelperFactors: { completedCount: 0 }, building: 'nest', roomId: 'X' }, // dropped (null)
    ];
    const s = M.computeVHStats(docs);
    assert.equal(s.count, 3);           // 3 finite-score docs (null dropped)
    assert.equal(s.helpersCount, 2);    // only the 2 with jobs
    assert.equal(s.totalJobs, 7);       // 4 + 0 + 3
    assert.equal(s.avgHelpers, 53);     // round((45+60)/2) = 52.5 → 53
    assert.equal(s.sorted.length, 2);   // only helpers ranked
    assert.equal(s.sorted[0].roomId, 'N405'); // 60 before 45
    assert.equal(s.sorted[1].roomId, 'N101');
  });

  it('avg is over HELPERS only (0-job tenants do not drag it down)', () => {
    const docs = [D(60, 5), D(0, 0), D(0, 0), D(0, 0)];
    const s = M.computeVHStats(docs);
    assert.equal(s.helpersCount, 1);
    assert.equal(s.avgHelpers, 60); // not 15
  });

  it('breaks ties by job count then building/room', () => {
    const docs = [
      D(40, 2, { roomId: 'B' }),
      D(40, 5, { roomId: 'A' }), // same score, more jobs → first
    ];
    const s = M.computeVHStats(docs);
    assert.equal(s.sorted[0].roomId, 'A');
  });
});
