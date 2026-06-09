/**
 * Unit tests for _communityRequestEngine — pure Community-requests lifecycle
 * logic (Meaning Layer #3). No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_communityRequestEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TITLE_LEN,
  isValidStatus, isValidCategory, isValidKind, normalizeKind,
  sanitizeTitle, sanitizeDetail, sanitizeNote,
  canOffer, canFulfill, canCancel,
} = require('../_communityRequestEngine');

const REQUESTER = 'line:Urequester';
const OFFERER = 'line:Uofferer';

describe('validators', () => {
  it('isValidStatus accepts the 4 lifecycle states only', () => {
    for (const s of ['open', 'offered', 'fulfilled', 'cancelled']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('accepted'), false);   // that's the #2 Helper board's state, not ours
    assert.equal(isValidStatus(''), false);
  });

  it('isValidCategory allows empty/unset, rejects unknown', () => {
    assert.ok(isValidCategory(''));
    assert.ok(isValidCategory(null));
    assert.ok(isValidCategory(undefined));
    for (const c of ['tool', 'kitchen', 'household', 'electronics', 'other']) assert.ok(isValidCategory(c));
    assert.equal(isValidCategory('lifting'), false);   // a #2 labour category, not an item category
  });

  it('isValidKind allows empty/unset, accepts borrow|have, rejects unknown', () => {
    assert.ok(isValidKind(''));
    assert.ok(isValidKind(null));
    assert.ok(isValidKind('borrow'));
    assert.ok(isValidKind('have'));
    assert.equal(isValidKind('steal'), false);
  });

  it('normalizeKind defaults unknown/blank to borrow', () => {
    assert.equal(normalizeKind('have'), 'have');
    assert.equal(normalizeKind('borrow'), 'borrow');
    assert.equal(normalizeKind(''), 'borrow');
    assert.equal(normalizeKind(null), 'borrow');
    assert.equal(normalizeKind('bogus'), 'borrow');
  });
});

describe('sanitizers', () => {
  it('sanitizeTitle trims and caps at MAX_TITLE_LEN', () => {
    assert.equal(sanitizeTitle('  ขอยืมไขควง  '), 'ขอยืมไขควง');
    assert.equal(sanitizeTitle(''), '');
    assert.equal(sanitizeTitle(null), '');
    assert.equal(sanitizeTitle('x'.repeat(200)).length, MAX_TITLE_LEN);
  });

  it('sanitizeDetail trims and is empty for blank input', () => {
    assert.equal(sanitizeDetail('   '), '');
    assert.equal(sanitizeDetail('  คืนพรุ่งนี้  '), 'คืนพรุ่งนี้');
    assert.ok(sanitizeDetail('y'.repeat(900)).length <= 500);
  });

  it('sanitizeNote trims and caps', () => {
    assert.equal(sanitizeNote('  ขอบคุณมาก  '), 'ขอบคุณมาก');
    assert.equal(sanitizeNote(''), '');
    assert.ok(sanitizeNote('z'.repeat(400)).length <= 280);
  });
});

describe('canOffer', () => {
  it('a different tenant can offer for an open request', () => {
    assert.deepEqual(canOffer({ status: 'open', requesterUid: REQUESTER }, OFFERER), { ok: true });
  });
  it('cannot offer for your own request (self-offer)', () => {
    const v = canOffer({ status: 'open', requesterUid: REQUESTER }, REQUESTER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'self-offer');
  });
  it('cannot offer for a non-open request', () => {
    assert.equal(canOffer({ status: 'offered', requesterUid: REQUESTER }, OFFERER).reason, 'not-open');
    assert.equal(canOffer({ status: 'fulfilled', requesterUid: REQUESTER }, OFFERER).reason, 'not-open');
    assert.equal(canOffer({ status: 'cancelled', requesterUid: REQUESTER }, OFFERER).reason, 'not-open');
  });
  it('null request → not-found', () => {
    assert.equal(canOffer(null, OFFERER).reason, 'not-found');
  });
});

describe('canFulfill', () => {
  it('the requester can fulfil an offered request', () => {
    assert.deepEqual(canFulfill({ status: 'offered', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester (even the offerer) cannot fulfil', () => {
    const v = canFulfill({ status: 'offered', requesterUid: REQUESTER, offererUid: OFFERER }, OFFERER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'not-requester');
  });
  it('cannot fulfil a request that is not offered', () => {
    assert.equal(canFulfill({ status: 'open', requesterUid: REQUESTER }, REQUESTER).reason, 'not-offered');
    assert.equal(canFulfill({ status: 'fulfilled', requesterUid: REQUESTER }, REQUESTER).reason, 'not-offered');
  });
  it('null request → not-found', () => {
    assert.equal(canFulfill(null, REQUESTER).reason, 'not-found');
  });
});

describe('canCancel', () => {
  it('the requester can cancel an open or offered request', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, REQUESTER), { ok: true });
    assert.deepEqual(canCancel({ status: 'offered', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester cannot cancel', () => {
    assert.equal(canCancel({ status: 'open', requesterUid: REQUESTER }, OFFERER).reason, 'not-requester');
  });
  it('an admin can cancel anyone\'s non-terminal request (moderation)', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
    assert.deepEqual(canCancel({ status: 'offered', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
  });
  it('cannot cancel a terminal (fulfilled/cancelled) request, even as admin', () => {
    assert.equal(canCancel({ status: 'fulfilled', requesterUid: REQUESTER }, REQUESTER).reason, 'terminal');
    assert.equal(canCancel({ status: 'cancelled', requesterUid: REQUESTER }, 'a', { isAdmin: true }).reason, 'terminal');
  });
});
