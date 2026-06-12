/**
 * Unit tests for dashboard-resident-rank.js — the PURE helpers (rrTier,
 * computeRRStats). Loads the module in a VM context (no DOM / no firebase) and
 * calls the exported pure fns, exactly like dashboard-verified-helper.test.js. The
 * render/recompute paths are browser-only and not exercised here.
 *
 * Run: node --test shared/__tests__/dashboard-resident-rank.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-resident-rank.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-resident-rank.js' });
    return global.window._ins.residentRank;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}
const M = load();

describe('rrTier', () => {
  it('maps the composite to the 5 growth rungs (aligned with the CF bounds 75/55/35/15)', () => {
    assert.equal(M.rrTier(100).key, 'taproot');
    assert.equal(M.rrTier(75).key, 'taproot');
    assert.equal(M.rrTier(74).key, 'canopy');
    assert.equal(M.rrTier(55).key, 'canopy');
    assert.equal(M.rrTier(54).key, 'rooted');
    assert.equal(M.rrTier(35).key, 'rooted');
    assert.equal(M.rrTier(34).key, 'sprout');
    assert.equal(M.rrTier(15).key, 'sprout');
    assert.equal(M.rrTier(14).key, 'seed');
    assert.equal(M.rrTier(0).key, 'seed');
  });

  it('handles null/undefined/NaN → none (a doc predating #8)', () => {
    assert.equal(M.rrTier(null).key, 'none');
    assert.equal(M.rrTier(undefined).key, 'none');
    assert.equal(M.rrTier(NaN).key, 'none');
  });

  it('every rung carries label, color, emoji', () => {
    for (const s of [90, 60, 45, 20, 3, 0, null]) {
      const t = M.rrTier(s);
      assert.ok(t.label && t.color && t.emoji, `rung for ${s} complete`);
    }
  });

  it('never returns a negative/"low" framing — the ladder is positive-only', () => {
    for (const s of [0, 5, 14, 40, 75, 100]) {
      const t = M.rrTier(s);
      assert.ok(!/ต่ำ|low/i.test(t.label), `${s} label not negative`);
    }
  });

  it('uses the growth-metaphor Thai rung names', () => {
    assert.equal(M.rrTier(80).label, 'รากแก้วชุมชน');
    assert.equal(M.rrTier(60).label, 'ร่มเงาของตึก');
    assert.equal(M.rrTier(40).label, 'ไม้ประจำถิ่น');
    assert.equal(M.rrTier(20).label, 'ต้นกล้า');
    assert.equal(M.rrTier(5).label, 'เมล็ดใหม่');
  });
});

describe('computeRRStats', () => {
  const D = (residentRank, extra = {}) => ({
    residentRank,
    residentRankProvisional: false,
    residentRankFactors: { reputation: residentRank, kindness: 0, verifiedHelper: 0 },
    building: 'nest', roomId: 'N1', ...extra,
  });

  it('empty / undefined → zeroed object', () => {
    for (const inp of [undefined, null, []]) {
      const s = M.computeRRStats(inp);
      assert.equal(s.count, 0);
      assert.equal(s.avg, null);
      assert.equal(s.pillars, 0);
      assert.deepEqual(s.sorted, []);
    }
  });

  it('ranks ALL finite-score docs (every active tenant has a rank) by score desc', () => {
    const docs = [
      D(40, { roomId: 'N101' }),
      D(0, { roomId: 'N102' }),   // a real seed-rung resident still counts
      D(62, { roomId: 'N405' }),
      { residentRank: null, building: 'nest', roomId: 'X' }, // dropped (null)
    ];
    const s = M.computeRRStats(docs);
    assert.equal(s.count, 3);            // 3 finite-score docs (null dropped)
    assert.equal(s.avg, 34);             // round((40+0+62)/3) = 34
    assert.equal(s.sorted.length, 3);    // ALL ranked (not just participants)
    assert.equal(s.sorted[0].roomId, 'N405'); // 62 first
    assert.equal(s.sorted[1].roomId, 'N101'); // 40
    assert.equal(s.sorted[2].roomId, 'N102'); // 0
  });

  it('pillars = residents at the canopy/taproot rungs (≥55)', () => {
    const docs = [D(75), D(55), D(54), D(20), D(0)];
    const s = M.computeRRStats(docs);
    assert.equal(s.count, 5);
    assert.equal(s.pillars, 2); // 75 + 55
  });

  it('breaks ties by building/room', () => {
    const docs = [D(50, { roomId: 'B' }), D(50, { roomId: 'A' })];
    const s = M.computeRRStats(docs);
    assert.equal(s.sorted[0].roomId, 'A');
  });
});
