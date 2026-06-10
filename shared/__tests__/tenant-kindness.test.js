'use strict';

/**
 * Unit tests for shared/tenant-kindness.js — Meaning Layer #6 v1.x tenant tier badge.
 *
 * Only the pure tierDisplay() is tested here: the render/consent/read paths need
 * DOM + Firebase + LIFF claims and are verified live on LINE (§7-J). tierDisplay
 * is the privacy-critical surface — it is the ONE place that decides what a tenant
 * sees, so the tests pin the positive-framing invariants the 2026-06-11 product
 * decision depends on (never show a raw number; kindness is POSITIVE-ONLY — there
 * is no "ต่ำ/low" face, only the gentle 🌱 seed growth state).
 *
 * The module is a browser IIFE that, in a node realm (no window/document),
 * exports { tierDisplay } via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-kindness.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { tierDisplay } = require('../tenant-kindness.js');

// The four enums the CF (_kindness.js kindnessTier) can emit.
const CF_ENUMS = ['radiant', 'warm', 'kind', 'seed'];

describe('tierDisplay — known tiers map to positive faces', () => {
  test("'radiant' → 💚 น้ำใจล้น", () => {
    const d = tierDisplay('radiant');
    assert.equal(d.key, 'radiant');
    assert.equal(d.emoji, '💚');
    assert.equal(d.label, 'น้ำใจล้น');
  });

  test("'warm' → 🌿 ใจดี", () => {
    const d = tierDisplay('warm');
    assert.equal(d.key, 'warm');
    assert.equal(d.emoji, '🌿');
    assert.equal(d.label, 'ใจดี');
  });

  test("'kind' → 🤲 มีน้ำใจ", () => {
    const d = tierDisplay('kind');
    assert.equal(d.key, 'kind');
    assert.equal(d.emoji, '🤲');
    assert.equal(d.label, 'มีน้ำใจ');
  });
});

describe('tierDisplay — gentle seed state (growth, never a verdict)', () => {
  test("'seed' → 🌱 กำลังสร้างน้ำใจ (no number, no judgment)", () => {
    const d = tierDisplay('seed');
    assert.equal(d.key, 'seed');
    assert.equal(d.emoji, '🌱');
    assert.equal(d.label, 'กำลังสร้างน้ำใจ');
  });

  test("legacy/foreign verdict enums ('provisional'/'low') collapse into the SAME seed face", () => {
    // kindnessTier never emits these (provisional → seed server-side; there is no
    // 'low'), but if a stale reputation-style value ever reached the field it must
    // degrade to the gentle seed state, never a scary one.
    const seed = tierDisplay('seed');
    assert.deepEqual(tierDisplay('provisional'), seed);
    assert.deepEqual(tierDisplay('low'), seed);
  });
});

describe('tierDisplay — absent / unknown values degrade to seed (mirror empty before first sweep)', () => {
  // The kindnessTier mirror field is undefined until the first 05:40 sweep writes
  // it; an unknown enum should never throw or show a scary state.
  for (const bad of [undefined, null, '', 'garbage', 0, 'Radiant', 'WARM', {}]) {
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

  test('PRIVACY INVARIANT — no tier face leaks a raw number or a "low/ต่ำ" judgment', () => {
    for (const e of CF_ENUMS) {
      const d = tierDisplay(e);
      const text = `${d.label} ${d.sub}`;
      assert.ok(!/\d/.test(text), `${e} face must not contain digits (tier-only): "${text}"`);
      assert.ok(!/ต่ำ/.test(text), `${e} face must not say "ต่ำ": "${text}"`);
      assert.ok(!/low/i.test(text), `${e} face must not say "low": "${text}"`);
    }
  });

  test('exactly three distinct positive ladders above the seed state', () => {
    const keys = new Set(CF_ENUMS.map((e) => tierDisplay(e).key));
    // radiant / warm / kind / seed — 4 distinct keys total.
    assert.deepEqual([...keys].sort(), ['kind', 'radiant', 'seed', 'warm']);
  });
});
