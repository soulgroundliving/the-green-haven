/**
 * Unit tests for _petSocialEngine — pure Pet Social Graph logic (Meaning Layer
 * #10). No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_petSocialEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROFILE_SAFE_FIELDS, MAX_BIO_LEN,
  sanitizeBio, isValidLinkStatus, buildProfileFields, buildLinkId,
  canRequestLink, canRespondLink, canRemoveLink,
} = require('../_petSocialEngine');

describe('sanitizeBio', () => {
  it('trims and caps at MAX_BIO_LEN', () => {
    assert.equal(sanitizeBio('  ขี้เล่น ชอบวิ่ง  '), 'ขี้เล่น ชอบวิ่ง');
    assert.equal(sanitizeBio(''), '');
    assert.equal(sanitizeBio(null), '');
    assert.equal(sanitizeBio(undefined), '');
    assert.equal(sanitizeBio('x'.repeat(500)).length, MAX_BIO_LEN);
  });
});

describe('isValidLinkStatus', () => {
  it('accepts the 3 edge states only', () => {
    for (const s of ['pending', 'accepted', 'declined']) assert.ok(isValidLinkStatus(s));
    assert.equal(isValidLinkStatus('open'), false);   // that's a board state, not an edge state
    assert.equal(isValidLinkStatus(''), false);
  });
});

describe('buildProfileFields — safe-field whitelist (privacy)', () => {
  it('copies ONLY the safe display fields, never health/vaccine/status/paths', () => {
    const raw = {
      name: '  โกโก้  ', typeEmoji: '🐶', type: '🐱', breed: 'ชิวาวา', gender: 'male',
      age: ' 2 ปี ', photoURL: 'https://x/p.png',
      // private — must NOT appear:
      healthLog: [{ type: 'vet' }], isVaccinated: true, vaxDate: '2026-01-01',
      vaccineBookURL: 'https://x/v.png', vaccineBookPath: 'pets/a/b/c/v.png',
      status: 'approved', photoPath: 'pets/a/b/c/p.png',
    };
    const out = buildProfileFields(raw);
    assert.deepEqual(Object.keys(out).sort(), ['age', 'breed', 'gender', 'name', 'photoURL', 'typeEmoji']);
    assert.equal(out.name, 'โกโก้');     // trimmed
    assert.equal(out.typeEmoji, '🐶');    // prefers typeEmoji over legacy `type`
    assert.equal(out.age, '2 ปี');
    assert.equal(out.photoURL, 'https://x/p.png');
    // privacy invariant: no health/vaccine/status/path keys leak
    for (const k of ['healthLog', 'isVaccinated', 'vaxDate', 'vaccineBookURL', 'vaccineBookPath', 'status', 'photoPath']) {
      assert.ok(!(k in out), `${k} must not be in the public profile`);
    }
    assert.ok(PROFILE_SAFE_FIELDS.every((f) => f in out || f === 'photoURL'));
  });

  it('falls back typeEmoji → legacy `type`, missing → safe defaults', () => {
    const out = buildProfileFields({ type: '🐱' });
    assert.equal(out.typeEmoji, '🐱');
    assert.equal(out.name, '');
    assert.equal(out.photoURL, null);
  });

  it('handles null/undefined input without throwing', () => {
    assert.deepEqual(buildProfileFields(null), { name: '', typeEmoji: '', breed: '', gender: '', age: '', photoURL: null });
  });
});

describe('buildLinkId — deterministic, order-independent', () => {
  it('sorts the pair so A↔B collapses to ONE id', () => {
    assert.equal(buildLinkId('100', '200'), '100_200');
    assert.equal(buildLinkId('200', '100'), '100_200');   // reverse → same id
    assert.equal(buildLinkId('b', 'a'), 'a_b');
  });
  it('coerces non-strings', () => {
    assert.equal(buildLinkId(100, 200), '100_200');
  });
  it('throws when either petId is empty/nullish', () => {
    assert.throws(() => buildLinkId('', 'p2'));
    assert.throws(() => buildLinkId('p1', null));
  });
});

describe('canRequestLink', () => {
  it('allows a request when no edge exists', () => {
    assert.deepEqual(canRequestLink(null, 'p1', 'p2'), { ok: true });
  });
  it('rejects a self-request', () => {
    assert.equal(canRequestLink(null, 'p1', 'p1').reason, 'self');
  });
  it('rejects when a pending edge already exists', () => {
    assert.equal(canRequestLink({ status: 'pending' }, 'p1', 'p2').reason, 'pending-exists');
  });
  it('rejects when already friends', () => {
    assert.equal(canRequestLink({ status: 'accepted' }, 'p1', 'p2').reason, 'already-friends');
  });
  it('allows a re-request after a previous decline', () => {
    assert.deepEqual(canRequestLink({ status: 'declined' }, 'p1', 'p2'), { ok: true });
  });
  it('rejects missing ids', () => {
    assert.equal(canRequestLink(null, '', 'p2').reason, 'missing');
  });
});

describe('canRespondLink — state-transition guard (status only; auth is room-based in the CF)', () => {
  it('a pending edge can be responded to', () => {
    assert.deepEqual(canRespondLink({ status: 'pending' }), { ok: true });
  });
  it('cannot respond to a non-pending edge (single-winner)', () => {
    assert.equal(canRespondLink({ status: 'accepted' }).reason, 'not-pending');
    assert.equal(canRespondLink({ status: 'declined' }).reason, 'not-pending');
  });
  it('null edge → not-found', () => {
    assert.equal(canRespondLink(null).reason, 'not-found');
  });
});

describe('canRemoveLink', () => {
  const link = { building: 'nest', requesterRoom: 'N101', recipientRoom: 'N202' };
  it('either party room may remove, in the same building', () => {
    assert.deepEqual(canRemoveLink(link, 'nest', 'N101'), { ok: true });
    assert.deepEqual(canRemoveLink(link, 'nest', 'N202'), { ok: true });
  });
  it('a non-party room cannot remove', () => {
    assert.equal(canRemoveLink(link, 'nest', 'N303').reason, 'not-a-party');
  });
  it('cross-building removal is rejected', () => {
    assert.equal(canRemoveLink(link, 'rooms', 'N101').reason, 'cross-building');
  });
  it('null edge → not-found', () => {
    assert.equal(canRemoveLink(null, 'nest', 'N101').reason, 'not-found');
  });
});
