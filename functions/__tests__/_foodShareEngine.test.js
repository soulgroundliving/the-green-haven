/**
 * Unit tests for _foodShareEngine — pure Food-sharing lifecycle logic (Meaning
 * Layer #4). No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_foodShareEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  FOOD_SHARE_REWARD, FOOD_SHARE_DAILY_CAP, DEFAULT_EXPIRY_HOURS, MAX_EXPIRY_HOURS, MAX_PORTIONS,
  isValidStatus, isValidCategory,
  sanitizeTitle, sanitizeDetail, sanitizePortions,
  normalizeExpiryHours, computeExpiresAtMs, isExpired,
  foodShareCapCheck, canClaim, canCancel,
} = require('../_foodShareEngine');

const SHARER = 'line:Usharer';
const CLAIMER = 'line:Uclaimer';
const FAR_FUTURE = 9_000_000_000_000;

describe('constants', () => {
  it('reward 10, cap 50, default expiry 24h', () => {
    assert.equal(FOOD_SHARE_REWARD, 10);
    assert.equal(FOOD_SHARE_DAILY_CAP, 50);
    assert.equal(DEFAULT_EXPIRY_HOURS, 24);
  });
});

describe('validators', () => {
  it('isValidStatus accepts the 3 lifecycle states only', () => {
    for (const s of ['available', 'claimed', 'cancelled']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('offered'), false);   // a #3 board state, not ours
    assert.equal(isValidStatus(''), false);
  });
  it('isValidCategory allows empty/unset, rejects unknown', () => {
    assert.ok(isValidCategory(''));
    assert.ok(isValidCategory(null));
    for (const c of ['meal', 'snack', 'fruit', 'drink', 'ingredient', 'other']) assert.ok(isValidCategory(c));
    assert.equal(isValidCategory('tool'), false);   // a #3 item category, not a food category
  });
});

describe('sanitizers', () => {
  it('sanitizeTitle trims + caps at 80', () => {
    assert.equal(sanitizeTitle('  ข้าวกล่อง 2 กล่อง  '), 'ข้าวกล่อง 2 กล่อง');
    assert.equal(sanitizeTitle(''), '');
    assert.equal(sanitizeTitle('x'.repeat(200)).length, 80);
  });
  it('sanitizeDetail trims, blank → empty', () => {
    assert.equal(sanitizeDetail('   '), '');
    assert.equal(sanitizeDetail('  มารับได้เลย  '), 'มารับได้เลย');
  });
  it('sanitizePortions → int 1..MAX or null', () => {
    assert.equal(sanitizePortions(3), 3);
    assert.equal(sanitizePortions('2'), 2);
    assert.equal(sanitizePortions(2.9), 2);          // floored
    assert.equal(sanitizePortions(0), null);
    assert.equal(sanitizePortions(-1), null);
    assert.equal(sanitizePortions('x'), null);
    assert.equal(sanitizePortions(999), MAX_PORTIONS);
  });
});

describe('expiry', () => {
  it('normalizeExpiryHours clamps to [1, MAX]; blank/invalid → DEFAULT', () => {
    assert.equal(normalizeExpiryHours(5), 5);
    assert.equal(normalizeExpiryHours(0), DEFAULT_EXPIRY_HOURS);
    assert.equal(normalizeExpiryHours(-3), DEFAULT_EXPIRY_HOURS);
    assert.equal(normalizeExpiryHours(undefined), DEFAULT_EXPIRY_HOURS);
    assert.equal(normalizeExpiryHours(999), MAX_EXPIRY_HOURS);
    assert.equal(normalizeExpiryHours(0.5), 1);      // floor → 0 → clamped up to MIN 1
  });
  it('accepts the longer dropdown presets up to 7 days (dried-goods window)', () => {
    assert.equal(MAX_EXPIRY_HOURS, 168);             // 7 days
    assert.equal(normalizeExpiryHours(72), 72);      // 3 วัน
    assert.equal(normalizeExpiryHours(120), 120);    // 5 วัน
    assert.equal(normalizeExpiryHours(168), 168);    // 7 วัน
    assert.equal(normalizeExpiryHours(169), MAX_EXPIRY_HOURS);  // beyond max → clamp
  });
  it('computeExpiresAtMs adds clamped hours to the base', () => {
    assert.equal(computeExpiresAtMs(1000, 2), 1000 + 2 * 3600 * 1000);
    assert.equal(computeExpiresAtMs(0, 999), MAX_EXPIRY_HOURS * 3600 * 1000);
  });
  it('isExpired handles ms / Timestamp / {seconds}; no expiry → never', () => {
    assert.equal(isExpired({ expiresAt: 1000 }, 2000), true);
    assert.equal(isExpired({ expiresAt: 5000 }, 2000), false);
    assert.equal(isExpired({ expiresAt: { toMillis: () => 1000 } }, 2000), true);
    assert.equal(isExpired({ expiresAt: { seconds: 1 } }, 2000), true);   // 1000ms < 2000
    assert.equal(isExpired({}, 2000), false);
    assert.equal(isExpired(null, 2000), false);
  });
});

describe('foodShareCapCheck (daily points cap)', () => {
  const cap = 50, today = '2026-06-09';
  it('full reward under the cap; advances the daily total', () => {
    assert.deepEqual(foodShareCapCheck({ shareDay: today, shareToday: 0, today, reward: 10, cap }),
      { award: 10, prior: 0, newToday: 10, capped: false, cap: 50 });
  });
  it('caps at the limit → award 0, capped true, total unchanged', () => {
    const r = foodShareCapCheck({ shareDay: today, shareToday: 50, today, reward: 10, cap });
    assert.equal(r.award, 0); assert.equal(r.capped, true); assert.equal(r.newToday, 50);
  });
  it('clamps a partial award at the boundary', () => {
    assert.equal(foodShareCapCheck({ shareDay: today, shareToday: 45, today, reward: 10, cap }).award, 5);
  });
  it('resets on day rollover', () => {
    assert.equal(foodShareCapCheck({ shareDay: '2026-06-08', shareToday: 50, today, reward: 10, cap }).award, 10);
  });
  it('uncapped when cap unset/0', () => {
    assert.equal(foodShareCapCheck({ shareDay: today, shareToday: 9999, today, reward: 10, cap: 0 }).award, 10);
  });
});

describe('canClaim', () => {
  it('a different tenant can claim an available, non-expired share', () => {
    assert.deepEqual(canClaim({ status: 'available', sharerUid: SHARER, expiresAt: FAR_FUTURE }, CLAIMER, 1000), { ok: true });
  });
  it('cannot claim your own share (self-claim)', () => {
    assert.equal(canClaim({ status: 'available', sharerUid: SHARER, expiresAt: FAR_FUTURE }, SHARER, 1000).reason, 'self-claim');
  });
  it('cannot claim an expired share', () => {
    assert.equal(canClaim({ status: 'available', sharerUid: SHARER, expiresAt: 500 }, CLAIMER, 1000).reason, 'expired');
  });
  it('cannot claim a non-available share', () => {
    assert.equal(canClaim({ status: 'claimed', sharerUid: SHARER, expiresAt: FAR_FUTURE }, CLAIMER, 1000).reason, 'not-available');
    assert.equal(canClaim({ status: 'cancelled', sharerUid: SHARER, expiresAt: FAR_FUTURE }, CLAIMER, 1000).reason, 'not-available');
  });
  it('null share → not-found', () => {
    assert.equal(canClaim(null, CLAIMER, 1000).reason, 'not-found');
  });
});

describe('canCancel', () => {
  it('the sharer can cancel an available share', () => {
    assert.deepEqual(canCancel({ status: 'available', sharerUid: SHARER }, SHARER), { ok: true });
  });
  it('a non-sharer cannot cancel', () => {
    assert.equal(canCancel({ status: 'available', sharerUid: SHARER }, CLAIMER).reason, 'not-sharer');
  });
  it('an admin can cancel anyone\'s available share (moderation)', () => {
    assert.deepEqual(canCancel({ status: 'available', sharerUid: SHARER }, 'admin-x', { isAdmin: true }), { ok: true });
  });
  it('cannot cancel a claimed/cancelled (terminal) share, even as admin', () => {
    assert.equal(canCancel({ status: 'claimed', sharerUid: SHARER }, SHARER).reason, 'terminal');
    assert.equal(canCancel({ status: 'cancelled', sharerUid: SHARER }, 'a', { isAdmin: true }).reason, 'terminal');
  });
});
