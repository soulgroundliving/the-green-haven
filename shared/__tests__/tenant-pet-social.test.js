'use strict';

/**
 * Unit tests for shared/tenant-pet-social.js — Meaning Layer #10 PR2 directory.
 *
 * Only the PURE helpers are tested here (buildLinkId / sanitizeBio / isOwnProfile /
 * linkStatusFor): the render / subscription / callable paths need DOM + Firebase +
 * LIFF claims and are verified live on LINE (§7-J). These four functions are the
 * load-bearing logic — they decide which friend doc the client looks up, what a
 * bio is capped to, and which button each neighbour card shows — so the tests pin:
 *   - buildLinkId is order-independent and byte-identical to the CF engine for
 *     valid ids (so the client reads the SAME petLinks/{linkId} the CF writes),
 *     and returns '' (never throws) on empty input (client render must not crash).
 *   - isOwnProfile buckets by ROOM identity (§7-FFF), not auth uid.
 *   - linkStatusFor classifies an edge from the caller's room perspective.
 *
 * The module is a browser IIFE that, in a node realm (no window/document), exports
 * the pure helpers via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-pet-social.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeBio, buildLinkId, isOwnProfile, linkStatusFor } = require('../tenant-pet-social.js');

describe('buildLinkId — deterministic, order-independent dedup', () => {
  test('A→B and B→A collapse to the same sorted id', () => {
    assert.equal(buildLinkId('100', '200'), '100_200');
    assert.equal(buildLinkId('200', '100'), '100_200');
    assert.equal(buildLinkId('100', '200'), buildLinkId('200', '100'));
  });

  test('sorts by STRING order (matches the CF engine ${min}_${max})', () => {
    // string compare: '1700000000002' < '1700000000010' lexicographically
    assert.equal(buildLinkId('1700000000010', '1700000000002'), '1700000000002_1700000000010');
  });

  test("coerces non-string ids before sorting", () => {
    assert.equal(buildLinkId(100, 200), '100_200');
    assert.equal(buildLinkId(200, 100), '100_200');
  });

  test("returns '' on empty/nullish input (client render must not throw, unlike the CF)", () => {
    assert.equal(buildLinkId('', '200'), '');
    assert.equal(buildLinkId('100', ''), '');
    assert.equal(buildLinkId(null, '200'), '');
    assert.equal(buildLinkId(undefined, undefined), '');
  });
});

describe('sanitizeBio — trim + cap (mirrors engine MAX_BIO_LEN=160)', () => {
  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeBio('  hello  '), 'hello');
  });

  test('caps at 160 chars', () => {
    const long = 'ก'.repeat(300);
    assert.equal(sanitizeBio(long).length, 160);
  });

  test('empty / nullish → empty string', () => {
    assert.equal(sanitizeBio(''), '');
    assert.equal(sanitizeBio(null), '');
    assert.equal(sanitizeBio(undefined), '');
    assert.equal(sanitizeBio('   '), '');
  });

  test('coerces non-string input', () => {
    assert.equal(sanitizeBio(42), '42');
  });
});

describe('isOwnProfile — §7-FFF bucket by ROOM identity, not uid', () => {
  test('same room (string or number) → own', () => {
    assert.equal(isOwnProfile({ ownerRoom: '15' }, '15'), true);
    assert.equal(isOwnProfile({ ownerRoom: 15 }, '15'), true);
    assert.equal(isOwnProfile({ ownerRoom: '15' }, 15), true);
  });

  test('different room → not own', () => {
    assert.equal(isOwnProfile({ ownerRoom: '15' }, '16'), false);
  });

  test('null profile → not own (no crash)', () => {
    assert.equal(isOwnProfile(null, '15'), false);
    assert.equal(isOwnProfile(undefined, '15'), false);
  });
});

describe('linkStatusFor — classify an edge from the caller room perspective', () => {
  test('no edge → none', () => {
    assert.equal(linkStatusFor(null, '15'), 'none');
  });

  test('accepted → friends (either party)', () => {
    assert.equal(linkStatusFor({ status: 'accepted', requesterRoom: '15', recipientRoom: '16' }, '15'), 'friends');
    assert.equal(linkStatusFor({ status: 'accepted', requesterRoom: '15', recipientRoom: '16' }, '16'), 'friends');
  });

  test('declined → declined (re-request allowed)', () => {
    assert.equal(linkStatusFor({ status: 'declined', requesterRoom: '15', recipientRoom: '16' }, '15'), 'declined');
  });

  test('pending + I am the requester → outgoing', () => {
    assert.equal(linkStatusFor({ status: 'pending', requesterRoom: '15', recipientRoom: '16' }, '15'), 'outgoing');
  });

  test('pending + I am the recipient → incoming', () => {
    assert.equal(linkStatusFor({ status: 'pending', requesterRoom: '15', recipientRoom: '16' }, '16'), 'incoming');
  });

  test('room match is string-coerced (claims may be numeric)', () => {
    assert.equal(linkStatusFor({ status: 'pending', requesterRoom: 15, recipientRoom: 16 }, 15), 'outgoing');
    assert.equal(linkStatusFor({ status: 'pending', requesterRoom: 15, recipientRoom: 16 }, 16), 'incoming');
  });

  test('unknown status → none (defensive)', () => {
    assert.equal(linkStatusFor({ status: 'weird', requesterRoom: '15', recipientRoom: '16' }, '15'), 'none');
  });
});
