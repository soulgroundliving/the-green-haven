'use strict';

// Parity tests for tools/preview-pet-social.js — the read-only #10 Pet Social
// state asserter. The tool re-implements buildLinkId + the privacy/link
// invariants in Node (the app/CF versions live in functions/_petSocialEngine.js
// and aren't required here), so these pin the Node copy to the SAME contract:
// the PROFILE_SAFE_FIELDS whitelist, the §7-LLL consent invariant inputs, the
// lexicographic linkId, and the same-room-forbidden edge rule.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROFILE_ALLOWED, KNOWN_PRIVATE_FIELDS, VALID_LINK_STATUS,
  buildLinkId, auditProfilePrivacy, auditLink, summarize,
} = require('../../tools/preview-pet-social.js');

describe('buildLinkId — mirrors _petSocialEngine (lexicographic, order-independent)', () => {
  test('sorts lexicographically and is order-independent', () => {
    assert.equal(buildLinkId('100', '200'), '100_200');
    assert.equal(buildLinkId('200', '100'), '100_200'); // same edge regardless of initiator
    assert.equal(buildLinkId('abc', 'abd'), 'abc_abd');
  });
  test('throws on an empty petId', () => {
    assert.throws(() => buildLinkId('', '200'), /non-empty/);
    assert.throws(() => buildLinkId('100', null), /non-empty/);
  });
});

describe('auditProfilePrivacy — INV1, whitelist of safe + struct + bio', () => {
  const clean = {
    petId: '1', ownerTenantId: 't1', ownerRoom: '15', building: 'rooms',
    name: 'Mochi', typeEmoji: '🐱', breed: 'Scottish', gender: 'M', age: '2', photoURL: 'https://x/p.jpg',
    bio: 'friendly', createdAt: 'x', updatedAt: 'y',
  };
  test('a clean mirror doc passes (every allowed field present)', () => {
    const r = auditProfilePrivacy(clean);
    assert.equal(r.ok, true);
    assert.deepEqual(r.leaked, []);
  });
  test('a leaked private field (healthLog) fails as a known-private leak', () => {
    const r = auditProfilePrivacy({ ...clean, healthLog: [{ type: 'vet' }] });
    assert.equal(r.ok, false);
    assert.ok(r.leaked.includes('healthLog'));
    assert.ok(r.knownPrivate.includes('healthLog'));
  });
  test('vaccine/status/photoPath leaks are all flagged as known-private', () => {
    const r = auditProfilePrivacy({ ...clean, vaxDate: '2026-01-01', status: 'approved', photoPath: 'pets/x' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.knownPrivate.sort(), ['photoPath', 'status', 'vaxDate'].sort());
  });
  test('an unknown extra field is leaked but not "known-private"', () => {
    const r = auditProfilePrivacy({ ...clean, someTypo: 1 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.leaked, ['someTypo']);
    assert.deepEqual(r.knownPrivate, []);
  });
  test('PROFILE_ALLOWED has the 13 expected keys; KNOWN_PRIVATE excludes them', () => {
    assert.equal(PROFILE_ALLOWED.size, 13);
    for (const k of ['name', 'photoURL', 'bio', 'building']) assert.ok(PROFILE_ALLOWED.has(k));
    for (const k of ['healthLog', 'vaccineBookURL', 'status']) assert.ok(KNOWN_PRIVATE_FIELDS.has(k));
  });
});

describe('auditLink — INV3 link self-consistency', () => {
  const ok = {
    linkId: '100_200', petA: '100', petB: '200', building: 'rooms',
    requesterPetId: '100', requesterRoom: '15', recipientPetId: '200', recipientRoom: '16',
    status: 'pending',
  };
  test('a consistent pending link has no problems', () => {
    assert.deepEqual(auditLink(ok), []);
  });
  test('accepted/declined are valid statuses', () => {
    assert.deepEqual(auditLink({ ...ok, status: 'accepted' }), []);
    assert.deepEqual(auditLink({ ...ok, status: 'declined' }), []);
  });
  test('a mismatched linkId is flagged', () => {
    const probs = auditLink({ ...ok, linkId: '200_999' });
    assert.equal(probs.length, 1);
    assert.match(probs[0], /buildLinkId/);
  });
  test('an invalid status is flagged', () => {
    assert.ok(auditLink({ ...ok, status: 'friends' }).some((p) => /invalid status/.test(p)));
  });
  test('a same-room edge (forbidden) is flagged', () => {
    assert.ok(auditLink({ ...ok, recipientRoom: '15' }).some((p) => /same-room/.test(p)));
  });
});

describe('summarize — building filter + status tally', () => {
  const profiles = [
    { building: 'rooms', petId: '1' }, { building: 'rooms', petId: '2' }, { building: 'nest', petId: '3' },
  ];
  const links = [
    { building: 'rooms', status: 'pending' }, { building: 'rooms', status: 'accepted' }, { building: 'nest', status: 'pending' },
  ];
  test('scopes to one building', () => {
    const s = summarize(profiles, links, 'rooms');
    assert.equal(s.profileCount, 2);
    assert.equal(s.linkCount, 2);
    assert.deepEqual(s.byStatus, { pending: 1, accepted: 1 });
  });
  test('no building → all', () => {
    const s = summarize(profiles, links, null);
    assert.equal(s.profileCount, 3);
    assert.equal(s.linkCount, 3);
    assert.equal(s.byStatus.pending, 2);
  });
  test('VALID_LINK_STATUS is exactly the three CF statuses', () => {
    assert.deepEqual([...VALID_LINK_STATUS].sort(), ['accepted', 'declined', 'pending']);
  });
});
