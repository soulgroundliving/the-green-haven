'use strict';

/**
 * Unit tests for shared/tenant-resident-rank.js — Meaning Layer #8 v1 tenant badge.
 *
 * Only the pure tierDisplay() is tested here: the render/consent/read paths need
 * DOM + Firebase + LIFF claims and are verified via the static harness + live on
 * LINE (§7-J). tierDisplay is the privacy-critical surface — it is the ONE place
 * that decides what a tenant sees, so the tests pin the positive-framing
 * invariants: never show the raw composite score; the rank ladder is
 * POSITIVE-ONLY — every rung is a stage of growth, there is no "ต่ำ/low" face,
 * the bottom is the gentle 🌱 "เมล็ดใหม่" seed state.
 *
 * The module is a browser IIFE that, in a node realm (no window/document),
 * exports { tierDisplay } via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-resident-rank.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { tierDisplay } = require('../tenant-resident-rank.js');

// The five rungs the CF (_residentRank.js residentRankTier) can emit.
const CF_ENUMS = ['taproot', 'canopy', 'rooted', 'sprout', 'seed'];

describe('tierDisplay — the 5 growth rungs map to positive faces', () => {
  test("'taproot' → 🌲 รากแก้วชุมชน", () => {
    const d = tierDisplay('taproot');
    assert.equal(d.key, 'taproot');
    assert.equal(d.emoji, '🌲');
    assert.equal(d.label, 'รากแก้วชุมชน');
  });

  test("'canopy' → 🌳 ร่มเงาของตึก", () => {
    const d = tierDisplay('canopy');
    assert.equal(d.key, 'canopy');
    assert.equal(d.emoji, '🌳');
    assert.equal(d.label, 'ร่มเงาของตึก');
  });

  test("'rooted' → 🪴 ไม้ประจำถิ่น", () => {
    const d = tierDisplay('rooted');
    assert.equal(d.key, 'rooted');
    assert.equal(d.emoji, '🪴');
    assert.equal(d.label, 'ไม้ประจำถิ่น');
  });

  test("'sprout' → 🌿 ต้นกล้า", () => {
    const d = tierDisplay('sprout');
    assert.equal(d.key, 'sprout');
    assert.equal(d.emoji, '🌿');
    assert.equal(d.label, 'ต้นกล้า');
  });
});

describe('tierDisplay — gentle seed state (growth, never a verdict)', () => {
  test("'seed' → 🌱 เมล็ดใหม่ (no number, no judgment)", () => {
    const d = tierDisplay('seed');
    assert.equal(d.key, 'seed');
    assert.equal(d.emoji, '🌱');
    assert.equal(d.label, 'เมล็ดใหม่');
  });

  test("legacy/foreign verdict enums ('provisional'/'low') collapse into the SAME seed face", () => {
    // residentRankTier never emits these (the ladder is positive-only; there is no
    // 'low'/'provisional' rung), but if a stale value ever reached the field it must
    // degrade to the gentle seed state, never a scary one.
    const seed = tierDisplay('seed');
    assert.deepEqual(tierDisplay('provisional'), seed);
    assert.deepEqual(tierDisplay('low'), seed);
  });
});

describe('tierDisplay — absent / unknown values degrade to seed (mirror empty before first sweep)', () => {
  // The residentRankTier mirror field is undefined until the first 05:40 sweep
  // writes it; an unknown enum should never throw or show a scary state.
  for (const bad of [undefined, null, '', 'garbage', 0, 'Taproot', 'CANOPY', {}]) {
    test(`${JSON.stringify(bad)} → seed`, () => {
      const d = tierDisplay(bad);
      assert.equal(d.key, 'seed');
      assert.equal(d.emoji, '🌱');
    });
  }
});

describe('tierDisplay — display contract (every result is renderable)', () => {
  test('every CF enum yields {emoji, label, sub} non-empty strings', () => {
    for (const e of CF_ENUMS) {
      const d = tierDisplay(e);
      assert.ok(d && typeof d === 'object', `${e} → object`);
      for (const f of ['key', 'emoji', 'label', 'sub']) {
        assert.equal(typeof d[f], 'string', `${e}.${f} is a string`);
        assert.ok(d[f].length > 0, `${e}.${f} non-empty`);
      }
    }
  });

  test('PRIVACY INVARIANT — no rung face leaks a raw number or a "low/ต่ำ" judgment', () => {
    for (const e of CF_ENUMS) {
      const d = tierDisplay(e);
      const text = `${d.label} ${d.sub}`;
      assert.ok(!/\d/.test(text), `${e} face must not contain digits (tier-only): "${text}"`);
      assert.ok(!/ต่ำ/.test(text), `${e} face must not say "ต่ำ": "${text}"`);
      assert.ok(!/low/i.test(text), `${e} face must not say "low": "${text}"`);
    }
  });

  test('exactly five distinct rungs on the ladder', () => {
    const keys = new Set(CF_ENUMS.map((e) => tierDisplay(e).key));
    assert.deepEqual([...keys].sort(), ['canopy', 'rooted', 'seed', 'sprout', 'taproot']);
  });
});
