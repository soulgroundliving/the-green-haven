/**
 * Unit tests for shared/tenant-analytics.js pure helpers (Behavioral Analytics 1a).
 *
 * The module is a browser IIFE; its DOM wiring is guarded (no `document` in node),
 * so it loads cleanly via the vm shim. Pure helpers are exported on
 * window.TenantAnalytics.__t.
 *
 * Run: node --test shared/__tests__/tenant-analytics.test.js
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
    const abs = path.join(__dirname, '..', 'tenant-analytics.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'tenant-analytics.js' });
    return global.window.TenantAnalytics.__t;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const T = load();

describe('eligibleFrom — identity gate (§7-P/HH/FFF)', () => {
  test('real LINE tenant with building+room+firebaseReady → true', () => {
    assert.equal(T.eligibleFrom('line:U001', 'rooms', '15', '0', true), true);
    assert.equal(T.eligibleFrom('line:U001', 'rooms', '15', null, true), true);
  });
  test('admin-preview marker excludes even a line: uid', () => {
    assert.equal(T.eligibleFrom('line:U001', 'rooms', '15', '1', true), false);
  });
  test('non-line uid (admin / web) → false', () => {
    assert.equal(T.eligibleFrom('abc123xyz', 'rooms', '15', null, true), false);
  });
  test('empty / undefined uid → false (auth not ready)', () => {
    assert.equal(T.eligibleFrom('', 'rooms', '15', null, true), false);
    assert.equal(T.eligibleFrom(undefined, 'rooms', '15', null, true), false);
  });
  test('missing building or room → false', () => {
    assert.equal(T.eligibleFrom('line:U001', '', '15', null, true), false);
    assert.equal(T.eligibleFrom('line:U001', 'rooms', '', null, true), false);
  });
  test('firebase not ready → false', () => {
    assert.equal(T.eligibleFrom('line:U001', 'rooms', '15', null, false), false);
  });
  test('uid must START with line: (not merely contain it)', () => {
    assert.equal(T.eligibleFrom('x-line:U001', 'rooms', '15', null, true), false);
  });
});

describe('makeEvent — compact event shaping', () => {
  test('page_view carries t/ts/p, never an action field', () => {
    const ev = T.makeEvent('pv', 'ignored', 'home', 1234);
    assert.deepEqual(ev, { t: 'pv', ts: 1234, p: 'home' });
    assert.equal('a' in ev, false);
  });
  test('action carries t/ts/p/a', () => {
    const ev = T.makeEvent('ac', 'claimDailyPoints', 'home', 1234);
    assert.deepEqual(ev, { t: 'ac', ts: 1234, p: 'home', a: 'claimDailyPoints' });
  });
  test('omits empty page and empty action', () => {
    assert.deepEqual(T.makeEvent('ac', '', '', 5), { t: 'ac', ts: 5 });
    assert.deepEqual(T.makeEvent('pv', '', '', 5), { t: 'pv', ts: 5 });
  });
  test('truncates action to 60 and page to 40 chars', () => {
    const ev = T.makeEvent('ac', 'a'.repeat(100), 'p'.repeat(100), 9);
    assert.equal(ev.a.length, 60);
    assert.equal(ev.p.length, 40);
  });
});

describe('capBuffer — bounds memory, keeps newest', () => {
  test('under cap → unchanged copy (not same ref)', () => {
    const input = [1, 2, 3];
    const out = T.capBuffer(input, 5);
    assert.deepEqual(out, [1, 2, 3]);
    assert.notEqual(out, input);
  });
  test('over cap → keeps the newest `max`', () => {
    assert.deepEqual(T.capBuffer([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  });
  test('exactly at cap → unchanged', () => {
    assert.deepEqual(T.capBuffer([1, 2, 3], 3), [1, 2, 3]);
  });
  test('returns a copy — mutating output does not touch input', () => {
    const input = [1, 2, 3, 4];
    const out = T.capBuffer(input, 2);
    out.push(99);
    assert.deepEqual(input, [1, 2, 3, 4]);
  });
});

describe('exported constants', () => {
  test('MAX_BUFFER > FLUSH_AT (cap is a backstop above the early-flush trigger)', () => {
    assert.ok(T.MAX_BUFFER > T.FLUSH_AT);
  });
});
