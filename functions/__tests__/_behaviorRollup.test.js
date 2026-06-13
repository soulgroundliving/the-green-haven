/**
 * Unit tests for functions/_behaviorRollup.js — Behavioral Analytics Phase 1b.
 * Pure aggregation (no firebase) → plain node:test.
 *
 * Run: node --test functions/__tests__/_behaviorRollup.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeAdoption } = require('../_behaviorRollup');

const DAY = 86400000;
const NOW = 1750000000000;
const within = NOW - 2 * DAY;
const stale = NOW - 45 * DAY;

describe('computeAdoption — empty / degenerate', () => {
  test('empty tree → all zero, empty arrays', () => {
    const r = computeAdoption({}, { nowMs: NOW, occupiedRooms: 10 });
    assert.equal(r.totalEvents, 0);
    assert.equal(r.totalFlushes, 0);
    assert.equal(r.activeRooms, 0);
    assert.deepEqual(r.pages, []);
    assert.deepEqual(r.actions, []);
    assert.equal(r.occupiedRooms, 10);
    assert.equal(r.windowDays, 30);
  });
  test('null tree / null opts do not throw', () => {
    assert.equal(computeAdoption(null, null).totalEvents, 0);
    assert.equal(computeAdoption(undefined).totalFlushes, 0);
  });
});

describe('computeAdoption — counting + distinct rooms + pct', () => {
  const tree = {
    rooms: {
      '15': { f1: { events: [{ t: 'pv', p: 'home', ts: within }, { t: 'ac', a: 'claimDaily', p: 'home', ts: within }], flushedAt: within } },
      '16': { f2: { events: [{ t: 'pv', p: 'home', ts: within }], flushedAt: within } },
    },
    nest: {
      '3': { f3: { events: [{ t: 'pv', p: 'usage', ts: within }], flushedAt: within } },
    },
  };
  const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 10 });

  test('totals + active rooms', () => {
    assert.equal(r.totalFlushes, 3);
    assert.equal(r.totalEvents, 4);
    assert.equal(r.activeRooms, 3); // rooms/15, rooms/16, nest/3
  });
  test('pages: distinct-room count + adoption pct, sorted by rooms desc', () => {
    assert.deepEqual(r.pages[0], { k: 'home', count: 2, rooms: 2, pct: 20 });  // 2/10
    assert.deepEqual(r.pages[1], { k: 'usage', count: 1, rooms: 1, pct: 10 }); // 1/10
  });
  test('actions captured from data-action clicks', () => {
    assert.deepEqual(r.actions, [{ k: 'claimDaily', count: 1, rooms: 1, pct: 10 }]);
  });
});

describe('computeAdoption — window filter (by event ts)', () => {
  test('events older than windowDays are excluded', () => {
    const tree = { rooms: { '15': { f: { events: [{ t: 'pv', p: 'home', ts: stale }, { t: 'pv', p: 'home', ts: within }], flushedAt: within } } } };
    const r = computeAdoption(tree, { nowMs: NOW, windowDays: 30, occupiedRooms: 5 });
    assert.equal(r.totalEvents, 1);
    assert.equal(r.pages[0].count, 1);
  });
  test('an event with no ts is kept (not excluded by the window)', () => {
    const tree = { rooms: { '15': { f: { events: [{ t: 'pv', p: 'home' }], flushedAt: within } } } };
    const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 5 });
    assert.equal(r.totalEvents, 1);
  });
});

describe('computeAdoption — distinct-room semantics', () => {
  test('same room hitting a page twice → rooms:1, count:2', () => {
    const tree = { rooms: { '15': {
      f1: { events: [{ t: 'pv', p: 'home', ts: within }], flushedAt: within },
      f2: { events: [{ t: 'pv', p: 'home', ts: within }], flushedAt: within },
    } } };
    const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 4 });
    assert.deepEqual(r.pages[0], { k: 'home', count: 2, rooms: 1, pct: 25 });
    assert.equal(r.totalFlushes, 2);
  });
});

describe('computeAdoption — RTDB array-as-object + occupiedRooms 0', () => {
  test('events stored as an object with numeric keys are handled', () => {
    const tree = { rooms: { '15': { f: { events: { 0: { t: 'pv', p: 'home', ts: within }, 1: { t: 'ac', a: 'x', ts: within } }, flushedAt: within } } } };
    const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 2 });
    assert.equal(r.totalEvents, 2);
    assert.equal(r.pages[0].k, 'home');
    assert.equal(r.actions[0].k, 'x');
  });
  test('occupiedRooms 0 → pct null (no divide-by-zero)', () => {
    const tree = { rooms: { '15': { f: { events: [{ t: 'pv', p: 'home', ts: within }], flushedAt: within } } } };
    const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 0 });
    assert.equal(r.pages[0].pct, null);
  });
});

describe('computeAdoption — malformed entries are skipped gracefully', () => {
  test('null events + missing type do not throw; unknown type counts as activity only', () => {
    const tree = { rooms: { '15': { f: { events: [null, { p: 'home', ts: within }, { t: 'zz', ts: within }], flushedAt: within } } } };
    const r = computeAdoption(tree, { nowMs: NOW, occupiedRooms: 3 });
    assert.equal(r.totalEvents, 2);   // null skipped; the no-type and unknown-type count as raw events
    assert.equal(r.activeRooms, 1);
    assert.deepEqual(r.pages, []);     // none are a 'pv'
    assert.deepEqual(r.actions, []);   // none are an 'ac'
  });
});
