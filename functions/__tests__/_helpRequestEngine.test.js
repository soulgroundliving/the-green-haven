/**
 * Unit tests for _helpRequestEngine — pure Helper-request lifecycle logic
 * (Meaning Layer #2). No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_helpRequestEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  HELPER_REWARD_POINTS, KINDNESS_DAILY_CAP, MAX_TITLE_LEN,
  VALID_APPRECIATION_TAGS, APPRECIATION_LABELS,
  isValidStatus, isValidCategory, isValidRating,
  isValidAppreciation, sanitizeAppreciation, kindnessCapCheck,
  sanitizeTitle, sanitizeDetail,
  canAccept, canComplete, canCancel,
} = require('../_helpRequestEngine');

const REQUESTER = 'line:Urequester';
const HELPER = 'line:Uhelper';

describe('constants', () => {
  it('helper reward is 20 (owner decision 2026-06-08)', () => {
    assert.equal(HELPER_REWARD_POINTS, 20);
  });
});

describe('validators', () => {
  it('isValidStatus accepts the 4 lifecycle states only', () => {
    for (const s of ['open', 'accepted', 'done', 'cancelled']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('paused'), false);
    assert.equal(isValidStatus(''), false);
  });

  it('isValidCategory allows empty/unset, rejects unknown', () => {
    assert.ok(isValidCategory(''));
    assert.ok(isValidCategory(null));
    assert.ok(isValidCategory(undefined));
    assert.ok(isValidCategory('lifting'));
    assert.equal(isValidCategory('nonsense'), false);
  });

  it('isValidRating requires an integer 1-5', () => {
    for (const r of [1, 2, 3, 4, 5]) assert.ok(isValidRating(r));
    assert.equal(isValidRating(0), false);
    assert.equal(isValidRating(6), false);
    assert.equal(isValidRating(2.5), false);
    assert.equal(isValidRating(NaN), false);
    assert.equal(isValidRating(null), false);
    assert.equal(isValidRating(undefined), false);
  });
});

describe('appreciation tags (replace 1-5 stars)', () => {
  it('sanitizeAppreciation keeps valid keys, dedupes, caps at 5', () => {
    assert.deepEqual(sanitizeAppreciation(['kind', 'fast', 'kind']), ['kind', 'fast']);
    assert.deepEqual(sanitizeAppreciation(['kind', 'bogus', 'extra']), ['kind', 'extra']);
    assert.deepEqual(sanitizeAppreciation([]), []);
    assert.deepEqual(sanitizeAppreciation('kind'), []);   // not an array
    assert.deepEqual(sanitizeAppreciation(null), []);
  });
  it('isValidAppreciation requires ≥1 valid tag', () => {
    assert.ok(isValidAppreciation(['kind']));
    assert.equal(isValidAppreciation(['bogus']), false);
    assert.equal(isValidAppreciation([]), false);
  });
  it('every valid tag key has a label', () => {
    assert.equal(VALID_APPRECIATION_TAGS.size, 5);
    for (const k of VALID_APPRECIATION_TAGS) assert.ok(APPRECIATION_LABELS[k], `label for ${k}`);
  });
});

describe('sanitizers', () => {
  it('sanitizeTitle trims and caps at MAX_TITLE_LEN', () => {
    assert.equal(sanitizeTitle('  ช่วยยกของ  '), 'ช่วยยกของ');
    assert.equal(sanitizeTitle(''), '');
    assert.equal(sanitizeTitle(null), '');
    assert.equal(sanitizeTitle('x'.repeat(200)).length, MAX_TITLE_LEN);
  });

  it('sanitizeDetail trims and is empty for blank input', () => {
    assert.equal(sanitizeDetail('   '), '');
    assert.equal(sanitizeDetail('  รายละเอียด  '), 'รายละเอียด');
    assert.ok(sanitizeDetail('y'.repeat(900)).length <= 500);
  });
});

describe('kindnessCapCheck (daily points cap)', () => {
  const cap = 60, today = '2026-06-09';
  it('full reward under the cap; advances the daily total', () => {
    assert.deepEqual(kindnessCapCheck({ kindnessDay: today, kindnessToday: 0, today, reward: 20, cap }),
      { award: 20, prior: 0, newToday: 20, capped: false, cap: 60 });
    assert.equal(kindnessCapCheck({ kindnessDay: today, kindnessToday: 40, today, reward: 20, cap }).award, 20);
  });
  it('caps at the limit → award 0, capped true, total unchanged', () => {
    const r = kindnessCapCheck({ kindnessDay: today, kindnessToday: 60, today, reward: 20, cap });
    assert.equal(r.award, 0); assert.equal(r.capped, true); assert.equal(r.newToday, 60);
  });
  it('clamps a partial award at the boundary', () => {
    assert.equal(kindnessCapCheck({ kindnessDay: today, kindnessToday: 50, today, reward: 20, cap }).award, 10);
  });
  it('resets on day rollover (yesterday total ignored)', () => {
    assert.equal(kindnessCapCheck({ kindnessDay: '2026-06-08', kindnessToday: 60, today, reward: 20, cap }).award, 20);
  });
  it('uncapped when cap is unset/0', () => {
    assert.equal(kindnessCapCheck({ kindnessDay: today, kindnessToday: 9999, today, reward: 20, cap: 0 }).award, 20);
  });
  it('KINDNESS_DAILY_CAP is 60', () => { assert.equal(KINDNESS_DAILY_CAP, 60); });
});

describe('canAccept', () => {
  it('a different tenant can accept an open request', () => {
    assert.deepEqual(canAccept({ status: 'open', requesterUid: REQUESTER }, HELPER), { ok: true });
  });
  it('cannot accept your own request (self-help)', () => {
    const v = canAccept({ status: 'open', requesterUid: REQUESTER }, REQUESTER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'self-help');
  });
  it('cannot accept a non-open request', () => {
    assert.equal(canAccept({ status: 'accepted', requesterUid: REQUESTER }, HELPER).reason, 'not-open');
    assert.equal(canAccept({ status: 'done', requesterUid: REQUESTER }, HELPER).reason, 'not-open');
    assert.equal(canAccept({ status: 'cancelled', requesterUid: REQUESTER }, HELPER).reason, 'not-open');
  });
  it('null request → not-found', () => {
    assert.equal(canAccept(null, HELPER).reason, 'not-found');
  });
});

describe('canComplete', () => {
  it('the requester can complete an accepted request', () => {
    assert.deepEqual(canComplete({ status: 'accepted', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester (even the helper) cannot complete', () => {
    const v = canComplete({ status: 'accepted', requesterUid: REQUESTER, helperUid: HELPER }, HELPER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'not-requester');
  });
  it('cannot complete a request that is not accepted', () => {
    assert.equal(canComplete({ status: 'open', requesterUid: REQUESTER }, REQUESTER).reason, 'not-accepted');
    assert.equal(canComplete({ status: 'done', requesterUid: REQUESTER }, REQUESTER).reason, 'not-accepted');
  });
  it('null request → not-found', () => {
    assert.equal(canComplete(null, REQUESTER).reason, 'not-found');
  });
});

describe('canCancel', () => {
  it('the requester can cancel an open or accepted request', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, REQUESTER), { ok: true });
    assert.deepEqual(canCancel({ status: 'accepted', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester cannot cancel', () => {
    assert.equal(canCancel({ status: 'open', requesterUid: REQUESTER }, HELPER).reason, 'not-requester');
  });
  it('an admin can cancel anyone\'s non-terminal request (moderation)', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
    assert.deepEqual(canCancel({ status: 'accepted', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
  });
  it('cannot cancel a terminal (done/cancelled) request, even as admin', () => {
    assert.equal(canCancel({ status: 'done', requesterUid: REQUESTER }, REQUESTER).reason, 'terminal');
    assert.equal(canCancel({ status: 'cancelled', requesterUid: REQUESTER }, 'a', { isAdmin: true }).reason, 'terminal');
  });
});
