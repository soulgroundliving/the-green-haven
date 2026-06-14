'use strict';

/**
 * Unit tests for shared/tenant-pet-alerts.js — Meaning Layer #13 Lost Pet Alert.
 *
 * Only the PURE helpers are tested here (fmtLastSeen / fmtContact / isActiveAlert /
 * isOwnAlert / alertSortKey): the render / subscription / callable paths need DOM +
 * Firebase + LIFF claims and are verified live on LINE (§7-J). These helpers are the
 * load-bearing logic — they decide which alerts show (active + not expired), which
 * card is the owner's (§7-FFF bucket by room), and the newest-first order.
 *
 * The module is a browser IIFE that, in a node realm (no window/document), exports
 * the pure helpers via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-pet-alerts.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { fmtLastSeen, fmtContact, isActiveAlert, isOwnAlert, alertSortKey } = require('../tenant-pet-alerts.js');

describe('fmtLastSeen / fmtContact — trim + cap (mirror engine 200)', () => {
  test('trims surrounding whitespace', () => {
    assert.equal(fmtLastSeen('  แถวลิฟต์  '), 'แถวลิฟต์');
    assert.equal(fmtContact('  โทร 08x  '), 'โทร 08x');
  });
  test('caps at 200 chars', () => {
    assert.equal(fmtLastSeen('ก'.repeat(500)).length, 200);
    assert.equal(fmtContact('x'.repeat(500)).length, 200);
  });
  test('empty / nullish → empty string (render must not throw)', () => {
    assert.equal(fmtLastSeen(''), '');
    assert.equal(fmtLastSeen(null), '');
    assert.equal(fmtLastSeen(undefined), '');
    assert.equal(fmtContact('   '), '');
  });
  test('coerces non-string input', () => {
    assert.equal(fmtLastSeen(42), '42');
  });
});

describe('isActiveAlert — status active AND not past expiresAt', () => {
  const now = 2_000_000_000_000;
  test('active + future expiry → true', () => {
    assert.equal(isActiveAlert({ status: 'active', expiresAt: now + 10000 }, now), true);
    assert.equal(isActiveAlert({ status: 'active', expiresAt: { _ms: now + 1 } }, now), true);
    assert.equal(isActiveAlert({ status: 'active', expiresAt: { seconds: Math.ceil((now + 5000) / 1000) } }, now), true);
    assert.equal(isActiveAlert({ status: 'active', expiresAt: { toMillis: () => now + 1 } }, now), true);
  });
  test('active but expiresAt missing → still active (client falls back to status)', () => {
    assert.equal(isActiveAlert({ status: 'active' }, now), true);
  });
  test('active but past expiry → false (client hides expired, sweep is a follow-up)', () => {
    assert.equal(isActiveAlert({ status: 'active', expiresAt: now - 1 }, now), false);
    assert.equal(isActiveAlert({ status: 'active', expiresAt: { _ms: now - 1 } }, now), false);
  });
  test('resolved / expired status → false regardless of expiresAt', () => {
    assert.equal(isActiveAlert({ status: 'resolved', expiresAt: now + 10000 }, now), false);
    assert.equal(isActiveAlert({ status: 'expired', expiresAt: now + 10000 }, now), false);
  });
  test('null / missing → false (no crash)', () => {
    assert.equal(isActiveAlert(null, now), false);
    assert.equal(isActiveAlert(undefined, now), false);
    assert.equal(isActiveAlert({}, now), false);
  });
});

describe('isOwnAlert — §7-FFF bucket by ROOM identity, not uid', () => {
  test('same room (string or number) → own', () => {
    assert.equal(isOwnAlert({ ownerRoom: 'N101' }, 'N101'), true);
    assert.equal(isOwnAlert({ ownerRoom: 15 }, '15'), true);
    assert.equal(isOwnAlert({ ownerRoom: '15' }, 15), true);
  });
  test('different room → not own', () => {
    assert.equal(isOwnAlert({ ownerRoom: 'N101' }, 'N102'), false);
  });
  test('null alert → not own (no crash)', () => {
    assert.equal(isOwnAlert(null, 'N101'), false);
    assert.equal(isOwnAlert(undefined, 'N101'), false);
  });
});

describe('alertSortKey — newest-first ordering key (Timestamp / seconds / ms)', () => {
  test('extracts ms from each createdAt shape', () => {
    assert.equal(alertSortKey({ createdAt: 1700 }), 1700);
    assert.equal(alertSortKey({ createdAt: { _ms: 1700 } }), 1700);
    assert.equal(alertSortKey({ createdAt: { seconds: 17 } }), 17000);
    assert.equal(alertSortKey({ createdAt: { toMillis: () => 1700 } }), 1700);
  });
  test('missing / null → 0 (sorts last, never crashes)', () => {
    assert.equal(alertSortKey({}), 0);
    assert.equal(alertSortKey(null), 0);
  });
  test('drives a descending (newest-first) sort', () => {
    const a = { alertId: 'a', createdAt: 100 };
    const b = { alertId: 'b', createdAt: 300 };
    const c = { alertId: 'c', createdAt: 200 };
    const order = [a, b, c].sort((x, y) => alertSortKey(y) - alertSortKey(x)).map((x) => x.alertId);
    assert.deepEqual(order, ['b', 'c', 'a']);
  });
});
