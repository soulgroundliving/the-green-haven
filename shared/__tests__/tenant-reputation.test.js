'use strict';

/**
 * Unit tests for shared/tenant-reputation.js — Trust 3.2a v1.x tenant tier badge.
 *
 * Only the pure tierDisplay() is tested here: the render/consent/read paths need
 * DOM + Firebase + LIFF claims and are verified live on LINE (§7-J). tierDisplay
 * is the privacy-critical surface — it is the ONE place that decides what a tenant
 * sees, so the tests pin the positive-framing + collapse invariants that the
 * 2026-06-07 product decision depends on (never show a raw number or a "low"
 * judgment; provisional + low collapse into one gentle 🌱 seed state).
 *
 * The module is a browser IIFE that, in a node realm (no window/document),
 * exports { tierDisplay } via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-reputation.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { tierDisplay } = require('../tenant-reputation.js');

// The five enums the CF (_reputation.js reputationTier) can emit.
const CF_ENUMS = ['provisional', 'high', 'good', 'fair', 'low'];

describe('tierDisplay — known tiers map to positive faces', () => {
  test("'high' → 💎 ดีเยี่ยม", () => {
    const d = tierDisplay('high');
    assert.equal(d.key, 'great');
    assert.equal(d.emoji, '💎');
    assert.equal(d.label, 'ดีเยี่ยม');
  });

  test("'good' → ⭐ ดี", () => {
    const d = tierDisplay('good');
    assert.equal(d.key, 'good');
    assert.equal(d.emoji, '⭐');
    assert.equal(d.label, 'ดี');
  });

  test("'fair' → 🌿 กำลังไปได้ดี", () => {
    const d = tierDisplay('fair');
    assert.equal(d.key, 'fair');
    assert.equal(d.emoji, '🌿');
    assert.equal(d.label, 'กำลังไปได้ดี');
  });
});

describe('tierDisplay — gentle seed state (collapse invariant)', () => {
  test("'provisional' → 🌱 กำลังสร้างคะแนน (no number, no judgment)", () => {
    const d = tierDisplay('provisional');
    assert.equal(d.key, 'seed');
    assert.equal(d.emoji, '🌱');
    assert.equal(d.label, 'กำลังสร้างคะแนน');
  });

  test("'low' collapses into the SAME seed face as 'provisional' — never a 'ต่ำ' label", () => {
    const low = tierDisplay('low');
    const prov = tierDisplay('provisional');
    assert.equal(low.key, 'seed');
    assert.deepEqual(low, prov); // same object shape → one mental model for the tenant
  });
});

describe('tierDisplay — absent / unknown values degrade to seed (mirror empty before first sweep)', () => {
  // The reputationTier mirror field is undefined until the first 05:40 sweep
  // writes it; an unknown enum should never throw or show a scary state.
  for (const bad of [undefined, null, '', 'garbage', 0, 'High', 'GOOD', {}]) {
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
    // great / good / fair / seed — 'low' folds into seed → 4 distinct keys total.
    assert.deepEqual([...keys].sort(), ['fair', 'good', 'great', 'seed']);
  });
});
