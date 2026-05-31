/**
 * Unit tests for shared/building-registry.js — pure / fallback behaviour.
 *
 * Strategy: load the IIFE in a VM sandbox WITHOUT a real Firestore.
 * Tests cover the FALLBACK path (no cache yet) and the normalizeId stub path.
 * Async fetch/write paths require Firestore and are omitted here; they are
 * covered by the E2E smoke suite.
 *
 * Run: node --test shared/__tests__/building-registry.test.js
 *      OR: npm run test:shared
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ─── Sandbox setup ───────────────────────────────────────────────────────────

function loadBR({ normalizeIdFn } = {}) {
  const window = {
    // No firebase → _hasFirestore() returns false → list() uses FALLBACK
    firebase: undefined,
    BuildingConfig: normalizeIdFn
      ? { normalizeId: normalizeIdFn, getDisplayName: id => id }
      : undefined,
    dispatchEvent: () => {},
    CustomEvent: function(type, opts) { return { type, detail: opts?.detail }; },
  };

  const ctx = vm.createContext({
    window,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
  });

  const code = fs.readFileSync(
    path.resolve(__dirname, '../building-registry.js'),
    'utf8'
  );
  vm.runInContext(code, ctx);
  return ctx.window.BuildingRegistry;
}

// ─── Fallback path (no Firestore, no prior init) ─────────────────────────────

describe('BuildingRegistry fallback (no Firestore)', () => {
  test('list() returns the 2 built-in fallback buildings', () => {
    const BR = loadBR();
    const buildings = BR.list();
    assert.equal(buildings.length, 2);
    const ids = buildings.map(b => b.id);
    assert.ok(ids.includes('rooms'), 'missing rooms');
    assert.ok(ids.includes('nest'),  'missing nest');
  });

  test('list() returns a COPY — mutations do not affect internal state', () => {
    const BR = loadBR();
    const first = BR.list();
    first.push({ id: 'injected' });
    const second = BR.list();
    assert.equal(second.length, 2);
  });

  test('getById("rooms") returns the rooms fallback entry', () => {
    const BR = loadBR();
    const b = BR.getById('rooms');
    assert.ok(b, 'expected a result');
    assert.equal(b.id, 'rooms');
    assert.ok(b._fallback, 'expected _fallback: true');
  });

  test('getById("nest") returns the nest fallback entry', () => {
    const BR = loadBR();
    const b = BR.getById('nest');
    assert.ok(b);
    assert.equal(b.id, 'nest');
  });

  test('getById with unknown id returns null', () => {
    const BR = loadBR();
    assert.equal(BR.getById('amazon'), null);
    assert.equal(BR.getById(''),       null);
    assert.equal(BR.getById(null),     null);
  });

  test('isStale() returns true before any fetch', () => {
    const BR = loadBR();
    assert.equal(BR.isStale(), true);
  });
});

// ─── normalizeId integration ──────────────────────────────────────────────────

describe('BuildingRegistry + BuildingConfig.normalizeId', () => {
  test('getById resolves legacy id through normalizeId', () => {
    // Simulate 'RentRoom' → 'rooms' normalization
    const BR = loadBR({ normalizeIdFn: id => id === 'RentRoom' ? 'rooms' : id });
    const b = BR.getById('RentRoom');
    assert.ok(b, 'expected normalised lookup to find rooms');
    assert.equal(b.id, 'rooms');
  });

  test('getById without normalizeId falls back to exact id match', () => {
    const BR = loadBR(); // no BuildingConfig
    assert.equal(BR.getById('rooms').id, 'rooms');
    assert.equal(BR.getById('RentRoom'), null); // no normalization → no match
  });
});
