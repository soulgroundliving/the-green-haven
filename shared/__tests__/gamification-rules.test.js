/**
 * Unit tests for shared/gamification-rules.js
 *
 * Covers: level tier assignment, level progress calculation, badge ID
 * normalization, badge catalog structure invariants.
 *
 * Run: node --test shared/__tests__/gamification-rules.test.js
 *      OR: npm run test:shared
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ─── Load GamificationRules in a sandbox ────────────────────────────────────

function loadGR() {
  const root = {};
  const ctx = vm.createContext({
    self: root,
    module: { exports: {} },
    console,
    Infinity,
    Math,
    Number,
    Array,
    Object,
    String,
  });
  const code = fs.readFileSync(
    path.resolve(__dirname, '../gamification-rules.js'),
    'utf8'
  );
  vm.runInContext(code, ctx);
  // UMD attaches to root.GamificationRules in browser mode
  return ctx.self.GamificationRules || ctx.module.exports;
}

const GR = loadGR();

// ─── getLevelForPoints ───────────────────────────────────────────────────────

describe('getLevelForPoints', () => {
  test('0 pts → Seedling', () => {
    assert.equal(GR.getLevelForPoints(0).id, 'seedling');
  });

  test('299 pts → Seedling (upper boundary)', () => {
    assert.equal(GR.getLevelForPoints(299).id, 'seedling');
  });

  test('300 pts → Sprout (min boundary)', () => {
    assert.equal(GR.getLevelForPoints(300).id, 'sprout');
  });

  test('699 pts → Sprout (upper boundary)', () => {
    assert.equal(GR.getLevelForPoints(699).id, 'sprout');
  });

  test('700 pts → Blooming', () => {
    assert.equal(GR.getLevelForPoints(700).id, 'blooming');
  });

  test('1500 pts → Guardian', () => {
    assert.equal(GR.getLevelForPoints(1500).id, 'guardian');
  });

  test('3000 pts → Forest Master', () => {
    assert.equal(GR.getLevelForPoints(3000).id, 'forest_master');
  });

  test('9999 pts → Forest Master (no overflow)', () => {
    assert.equal(GR.getLevelForPoints(9999).id, 'forest_master');
  });

  test('negative pts treated as 0', () => {
    assert.equal(GR.getLevelForPoints(-50).id, 'seedling');
  });

  test('non-numeric pts treated as 0', () => {
    assert.equal(GR.getLevelForPoints(null).id, 'seedling');
    assert.equal(GR.getLevelForPoints('abc').id, 'seedling');
  });

  test('level numbers are sequential 1–5', () => {
    const levels = GR.LEVEL_TIERS.map(t => t.level);
    assert.equal(levels.length, 5);
    levels.forEach((n, i) => assert.equal(n, i + 1));
  });
});

// ─── getLevelProgress ────────────────────────────────────────────────────────

describe('getLevelProgress', () => {
  test('0 pts → progress is 0, ptsToNext is 300', () => {
    const { progress, ptsToNext } = GR.getLevelProgress(0);
    assert.equal(progress, 0);
    assert.equal(ptsToNext, 300);
  });

  test('150 pts → 50% of Seedling range (0-299)', () => {
    const { progress } = GR.getLevelProgress(150);
    assert.equal(progress, 50);
  });

  test('at tier min → progress is 0', () => {
    const { progress, ptsToNext } = GR.getLevelProgress(300); // Sprout min
    assert.equal(progress, 0);
    assert.equal(ptsToNext, 400); // next tier (Blooming) at 700
  });

  test('Forest Master → progress is 100, ptsToNext is 0', () => {
    const { progress, ptsToNext, next } = GR.getLevelProgress(5000);
    assert.equal(progress, 100);
    assert.equal(ptsToNext, 0);
    assert.equal(next, null);
  });

  test('returns tier + next tier', () => {
    const { tier, next } = GR.getLevelProgress(150);
    assert.equal(tier.id, 'seedling');
    assert.equal(next.id, 'sprout');
  });
});

// ─── badgeId ─────────────────────────────────────────────────────────────────

describe('badgeId', () => {
  test('returns empty string for falsy input', () => {
    assert.equal(GR.badgeId(null), '');
    assert.equal(GR.badgeId(undefined), '');
    assert.equal(GR.badgeId(''), '');
  });

  test('converts string to lowercase snake_case', () => {
    assert.equal(GR.badgeId('On Time'), 'on_time');
    assert.equal(GR.badgeId('FIRST MONTH'), 'first_month');
  });

  test('returns .id from object shape', () => {
    assert.equal(GR.badgeId({ id: 'loyal_resident', emoji: '💎' }), 'loyal_resident');
  });

  test('returns empty string for object without id', () => {
    assert.equal(GR.badgeId({}), '');
  });
});

// ─── normaliseBadges ─────────────────────────────────────────────────────────

describe('normaliseBadges', () => {
  test('returns [] for non-array input', () => {
    assert.equal(GR.normaliseBadges(null).length, 0);
    assert.equal(GR.normaliseBadges('bad').length, 0);
  });

  test('enriches string badges from BADGE_CATALOG', () => {
    const result = GR.normaliseBadges(['on_time'], '2026-01-01T00:00:00Z');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'on_time');
    assert.equal(result[0].emoji, '⏰');
    assert.equal(result[0].label, 'On Time');
  });

  test('passes through object badges unchanged', () => {
    const badge = { id: 'green_guardian', emoji: '🌿', label: 'Green Guardian', earnedAt: '2026-01-01' };
    const result = GR.normaliseBadges([badge]);
    assert.deepEqual(result[0], badge);
  });

  test('handles unknown string badges gracefully', () => {
    const result = GR.normaliseBadges(['mystery_badge'], '2026-01-01T00:00:00Z');
    assert.equal(result[0].id, 'mystery_badge');
    assert.equal(result[0].emoji, '🏅');
  });
});

// ─── BADGE_CATALOG structure ─────────────────────────────────────────────────

describe('BADGE_CATALOG structure', () => {
  test('all points-based badges have minPts', () => {
    const ptBadges = GR.BADGE_CATALOG.filter(b => !b.marketplace);
    ptBadges.forEach(b => {
      assert.ok(typeof b.minPts === 'number', `${b.id} missing minPts`);
    });
  });

  test('all marketplace badges have minCount', () => {
    const mpBadges = GR.BADGE_CATALOG.filter(b => b.marketplace);
    mpBadges.forEach(b => {
      assert.ok(typeof b.minCount === 'number', `${b.id} missing minCount`);
    });
  });

  test('every badge has id, emoji, label', () => {
    GR.BADGE_CATALOG.forEach(b => {
      assert.ok(b.id, `missing id`);
      assert.ok(b.emoji, `${b.id} missing emoji`);
      assert.ok(b.label, `${b.id} missing label`);
    });
  });
});
