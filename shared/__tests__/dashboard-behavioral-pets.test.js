/**
 * Unit tests for shared/dashboard-behavioral-pets.js — Phase 3.1 pure compute.
 *
 * The render fn needs DOM + Firebase, but the math (vaccine currency, approval
 * split, type/vaccine/building aggregation, room penetration) is pure and exported
 * on window._ins.behavioralPets. Loaded in a vm sandbox with a bare window stub
 * (same pattern as dashboard-behavioral-tenure.test.js).
 *
 * Run: node --test shared/__tests__/dashboard-behavioral-pets.test.js
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
    const abs = path.join(__dirname, '..', 'dashboard-behavioral-pets.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-pets.js' });
    return global.window._ins.behavioralPets;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const M = load();
const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 15); // 2026-06-15
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

describe('petVaccineStatus', () => {
  test('no / empty expiry → unknown (currency unprovable)', () => {
    assert.equal(M.petVaccineStatus({}, NOW), 'unknown');
    assert.equal(M.petVaccineStatus({ vaxExpiry: '' }, NOW), 'unknown');
    assert.equal(M.petVaccineStatus({ vaxExpiry: 'not-a-date' }, NOW), 'unknown');
    // vaccinated flag without an expiry date is still unprovable
    assert.equal(M.petVaccineStatus({ isVaccinated: true }, NOW), 'unknown');
  });
  test('past expiry → expired', () => {
    assert.equal(M.petVaccineStatus({ vaxExpiry: iso(NOW - DAY) }, NOW), 'expired');
  });
  test('within 30 days → expiring', () => {
    assert.equal(M.petVaccineStatus({ vaxExpiry: iso(NOW + 10 * DAY) }, NOW), 'expiring');
    assert.equal(M.petVaccineStatus({ vaxExpiry: iso(NOW + 30 * DAY) }, NOW), 'expiring');
  });
  test('beyond 30 days → ok', () => {
    assert.equal(M.petVaccineStatus({ vaxExpiry: iso(NOW + 60 * DAY) }, NOW), 'ok');
  });
});

describe('computePetPatterns', () => {
  test('empty → zeros, null penetration', () => {
    const r = M.computePetPatterns([], { occupiedRooms: 0, nowMs: NOW });
    assert.equal(r.totalApproved, 0);
    assert.equal(r.pending, 0);
    assert.deepEqual(r.byType, []);
    assert.deepEqual(r.vaccine, { ok: 0, expiring: 0, expired: 0, unknown: 0 });
    assert.equal(r.roomsWithPets, 0);
    assert.equal(r.penetrationPct, null);
  });

  test('only approved counted in stats; non-approved → pending', () => {
    const pets = [
      { building: 'rooms', room: '1', typeEmoji: '🐶', vaxExpiry: iso(NOW + 60 * DAY), status: 'approved' },
      { building: 'rooms', room: '2', typeEmoji: '🐱', status: 'pending' },
      { building: 'nest', room: '3', typeEmoji: '🐶', vaxExpiry: iso(NOW - DAY), status: 'approved' },
      // missing status defaults to pending
      { building: 'nest', room: '4', typeEmoji: '🐰' },
    ];
    const r = M.computePetPatterns(pets, { occupiedRooms: 8, nowMs: NOW });
    assert.equal(r.totalApproved, 2);
    assert.equal(r.pending, 2);
  });

  test('byType breakdown with pct + Thai label, sorted desc', () => {
    const pets = [
      { building: 'rooms', room: '1', typeEmoji: '🐶', status: 'approved' },
      { building: 'rooms', room: '2', typeEmoji: '🐶', status: 'approved' },
      { building: 'rooms', room: '3', typeEmoji: '🐱', status: 'approved' },
    ];
    const r = M.computePetPatterns(pets, { occupiedRooms: 10, nowMs: NOW });
    assert.equal(r.byType[0].type, '🐶');
    assert.equal(r.byType[0].label, 'สุนัข');
    assert.equal(r.byType[0].count, 2);
    assert.equal(r.byType[0].pct, 67); // round(2/3*100)
    assert.equal(r.byType[1].type, '🐱');
    assert.equal(r.byType[1].label, 'แมว');
  });

  test('vaccine buckets tally across approved pets', () => {
    const pets = [
      { building: 'rooms', room: '1', typeEmoji: '🐶', vaxExpiry: iso(NOW + 60 * DAY), status: 'approved' }, // ok
      { building: 'rooms', room: '2', typeEmoji: '🐶', vaxExpiry: iso(NOW + 5 * DAY), status: 'approved' },  // expiring
      { building: 'rooms', room: '3', typeEmoji: '🐱', vaxExpiry: iso(NOW - 5 * DAY), status: 'approved' },  // expired
      { building: 'rooms', room: '4', typeEmoji: '🐱', status: 'approved' },                                  // unknown
    ];
    const r = M.computePetPatterns(pets, { occupiedRooms: 10, nowMs: NOW });
    assert.deepEqual(r.vaccine, { ok: 1, expiring: 1, expired: 1, unknown: 1 });
  });

  test('roomsWithPets distinct + penetration %, byBuilding', () => {
    const pets = [
      { building: 'rooms', room: '1', typeEmoji: '🐶', status: 'approved' },
      { building: 'rooms', room: '1', typeEmoji: '🐱', status: 'approved' }, // same room → 1 room
      { building: 'nest', room: '2', typeEmoji: '🐶', status: 'approved' },
    ];
    const r = M.computePetPatterns(pets, { occupiedRooms: 4, nowMs: NOW });
    assert.equal(r.roomsWithPets, 2);       // rooms:1 + nest:2
    assert.equal(r.penetrationPct, 50);     // 2/4
    assert.deepEqual(
      r.byBuilding.sort((a, b) => a.building < b.building ? -1 : 1),
      [{ building: 'nest', count: 1 }, { building: 'rooms', count: 2 }]
    );
  });

  test('penetration null when occupiedRooms unknown', () => {
    const pets = [{ building: 'rooms', room: '1', typeEmoji: '🐶', status: 'approved' }];
    const r = M.computePetPatterns(pets, { occupiedRooms: 0, nowMs: NOW });
    assert.equal(r.penetrationPct, null);
  });

  test('type falls back to 🐾 when no typeEmoji/type', () => {
    const pets = [{ building: 'rooms', room: '1', status: 'approved' }];
    const r = M.computePetPatterns(pets, { occupiedRooms: 1, nowMs: NOW });
    assert.equal(r.byType[0].type, '🐾');
    assert.equal(r.byType[0].label, 'อื่นๆ');
  });
});
