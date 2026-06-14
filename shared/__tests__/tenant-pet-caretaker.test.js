/**
 * Unit tests for shared/tenant-pet-caretaker.js — Emergency Caretaker board
 * (Meaning Layer #14). The pure helpers (isRequester / isCaretaker / fmtPeriod)
 * are loaded via the vm shim (window._petCaretakerHelpers); the IIFE never
 * touches Firebase at load time, so the shim is enough.
 *
 * Run: node --test shared/__tests__/tenant-pet-caretaker.test.js
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
    const abs = path.join(__dirname, '..', 'tenant-pet-caretaker.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'tenant-pet-caretaker.js' });
    return global.window._petCaretakerHelpers;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();
const MY = 'line:Ume';
const OTHER = 'line:Uother';

describe('isRequester / isCaretaker — §7-FFF bucket by stable uid', () => {
  test('isRequester true only when requesterUid === my uid', () => {
    assert.equal(M.isRequester({ requesterUid: MY }, MY), true);
    assert.equal(M.isRequester({ requesterUid: OTHER }, MY), false);
  });
  test('isCaretaker true only when caretakerUid === my uid', () => {
    assert.equal(M.isCaretaker({ caretakerUid: MY }, MY), true);
    assert.equal(M.isCaretaker({ caretakerUid: OTHER }, MY), false);
  });
  test('empty uid (pre-auth / admin preview) → nothing is mine (safe default)', () => {
    assert.equal(M.isRequester({ requesterUid: OTHER }, ''), false);
    assert.equal(M.isCaretaker({ caretakerUid: OTHER }, ''), false);
    // even if a doc somehow had an empty uid, an empty viewer never claims it
    assert.equal(M.isRequester({ requesterUid: '' }, ''), false);
  });
  test('null / missing fields never throw', () => {
    assert.equal(M.isRequester(null, MY), false);
    assert.equal(M.isCaretaker({}, MY), false);
  });
});

describe('fmtPeriod — Thai-locale care window', () => {
  test('formats a from–to window (epoch ms)', () => {
    const s = M.fmtPeriod({ from: Date.parse('2026-06-20T01:00:00Z'), to: Date.parse('2026-06-22T11:00:00Z') });
    assert.ok(s.includes('–'), 'has an en-dash separator');
    assert.ok(s.length > 5);
  });
  test('handles Firestore-Timestamp-like {seconds} / toMillis()', () => {
    const a = M.fmtPeriod({ from: { seconds: 1700000000 }, to: { seconds: 1700100000 } });
    assert.ok(a.includes('–'));
    const b = M.fmtPeriod({ from: { toMillis: () => 1700000000000 }, to: { toMillis: () => 1700100000000 } });
    assert.ok(b.includes('–'));
  });
  test('missing bounds → empty string (no NaN/Invalid Date leak)', () => {
    assert.equal(M.fmtPeriod(null), '');
    assert.equal(M.fmtPeriod({}), '');
    assert.equal(M.fmtPeriod({ from: 1000 }), '');
    assert.equal(M.fmtPeriod({ to: 1000 }), '');
  });
});
