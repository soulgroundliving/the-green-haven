/**
 * Unit tests for tenant-pet-matching.js pure layer (Meaning Layer #12).
 * Floor derivation, type compatibility, proximity, scoring, ranking, friend-set.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../tenant-pet-matching.js');

describe('deriveFloor — hundreds digit == floor (matches config-unified)', () => {
  it('nest N1xx-N4xx → floor 1-4', () => {
    assert.equal(M.deriveFloor('N101'), 1);
    assert.equal(M.deriveFloor('N405'), 4);
    assert.equal(M.deriveFloor('N201'), 2);
  });
  it('rooms 1xx-2xx → floor 1-2', () => {
    assert.equal(M.deriveFloor('101'), 1);
    assert.equal(M.deriveFloor('204'), 2);
  });
  it('sub-100 / single-digit → floor 1', () => {
    assert.equal(M.deriveFloor('N1'), 1);
    assert.equal(M.deriveFloor('28'), 1);
  });
  it('non-numeric / empty → null (skip the bonus, never guess)', () => {
    assert.equal(M.deriveFloor(''), null);
    assert.equal(M.deriveFloor('lobby'), null);
    assert.equal(M.deriveFloor(null), null);
  });
});

describe('typeMatch — normalized equality, non-empty', () => {
  it('same emoji matches; trims whitespace', () => {
    assert.equal(M.typeMatch('🐶', '🐶'), true);
    assert.equal(M.typeMatch(' 🐶', '🐶 '), true);
  });
  it('different / empty → false', () => {
    assert.equal(M.typeMatch('🐶', '🐱'), false);
    assert.equal(M.typeMatch('', ''), false);
    assert.equal(M.typeMatch('🐶', ''), false);
  });
});

describe('floorRel', () => {
  it('same / adjacent / far', () => {
    assert.equal(M.floorRel(2, 2), 'same');
    assert.equal(M.floorRel(2, 3), 'adjacent');
    assert.equal(M.floorRel(1, 4), 'far');
  });
  it('a null floor → unknown (never far)', () => {
    assert.equal(M.floorRel(null, 2), 'unknown');
    assert.equal(M.floorRel(2, null), 'unknown');
  });
});

describe('scoreOne', () => {
  it('type + same floor = 5 (3 + 2)', () => {
    const s = M.scoreOne('🐶', 1, { typeEmoji: '🐶', ownerRoom: 'N101' });
    assert.equal(s.score, 5);
    assert.deepEqual(s.reasons.sort(), ['same-floor', 'type']);
  });
  it('type only (adjacent? no — far floor) = 3', () => {
    const s = M.scoreOne('🐶', 1, { typeEmoji: '🐶', ownerRoom: 'N401' });
    assert.equal(s.score, 3);
    assert.deepEqual(s.reasons, ['type']);
  });
  it('floor only (different type, adjacent) = 1', () => {
    const s = M.scoreOne('🐶', 1, { typeEmoji: '🐱', ownerRoom: 'N201' });
    assert.equal(s.score, 1);
    assert.deepEqual(s.reasons, ['adjacent-floor']);
  });
  it('no signal (different type, far floor) = 0', () => {
    const s = M.scoreOne('🐶', 1, { typeEmoji: '🐱', ownerRoom: 'N401' });
    assert.equal(s.score, 0);
    assert.deepEqual(s.reasons, []);
  });
  it('reads the legacy `type` alias when typeEmoji is absent', () => {
    const s = M.scoreOne('🐶', 1, { type: '🐶', ownerRoom: 'N101' });
    assert.ok(s.reasons.includes('type'));
  });
});

describe('rankMatches', () => {
  const myPets = [{ petId: 'mine1', typeEmoji: '🐶' }];
  const profiles = [
    { petId: 'far-cat', typeEmoji: '🐱', ownerRoom: 'N405', name: 'Mimi' },   // far + diff type → 0, excluded
    { petId: 'same-dog', typeEmoji: '🐶', ownerRoom: 'N102', name: 'Rex' },    // type + same floor = 5
    { petId: 'adj-dog', typeEmoji: '🐶', ownerRoom: 'N201', name: 'Bud' },     // type + adjacent = 4
    { petId: 'mine-room', typeEmoji: '🐶', ownerRoom: 'N101', name: 'self' },  // own room → excluded (§7-FFF)
  ];

  it('excludes own room + zero-signal; sorts by score desc', () => {
    const r = M.rankMatches(myPets, profiles, { myRoom: 'N101' });
    assert.deepEqual(r.map(m => m.profile.petId), ['same-dog', 'adj-dog']);
    assert.equal(r[0].score, 5);
    assert.equal(r[1].score, 4);
  });

  it('already-friend is deprioritised below an equal-score stranger', () => {
    const profs = [
      { petId: 'friend-dog', typeEmoji: '🐶', ownerRoom: 'N102', name: 'A' },
      { petId: 'stranger-dog', typeEmoji: '🐶', ownerRoom: 'N103', name: 'B' },
    ];
    const r = M.rankMatches(myPets, profs, { myRoom: 'N101', friendPetIds: { 'friend-dog': true } });
    // both score 5 (type + same floor 1) → stranger first
    assert.equal(r[0].profile.petId, 'stranger-dog');
    assert.equal(r[1].profile.petId, 'friend-dog');
    assert.equal(r[1].isFriend, true);
  });

  it('no own pet type → floor-only suggestions (still useful)', () => {
    const r = M.rankMatches([], profiles, { myRoom: 'N101' });
    // same-dog (floor 1, same) scores 2; adj-dog (floor 2) scores 1; far-cat 0 excluded
    assert.deepEqual(r.map(m => m.profile.petId), ['same-dog', 'adj-dog']);
    assert.equal(r[0].score, 2);
  });
});

describe('friendPetIdSet', () => {
  const myPetIds = { mine1: true };
  it('maps accepted edges to the OTHER petId', () => {
    const links = [
      { petA: 'mine1', petB: 'other1', status: 'accepted' },
      { petA: 'other2', petB: 'mine1', status: 'accepted' },
    ];
    assert.deepEqual(M.friendPetIdSet(links, myPetIds), { other1: true, other2: true });
  });
  it('ignores pending/declined + edges not touching my pets', () => {
    const links = [
      { petA: 'mine1', petB: 'other1', status: 'pending' },
      { petA: 'x', petB: 'y', status: 'accepted' },
    ];
    assert.deepEqual(M.friendPetIdSet(links, myPetIds), {});
  });
});
