/**
 * Unit tests for the pure layer of tenant-farewell.js (Meaning Layer #16 v1).
 *   node --test shared/__tests__/tenant-farewell.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { toMs, tenureText, deriveFarewell, FAREWELL_WINDOW_DAYS } = require('../tenant-farewell.js');

const MOVE_IN = Date.parse('2024-01-15T00:00:00Z');
const NOW = Date.parse('2026-06-12T00:00:00Z');
const DAY = 86400000;

describe('tenureText', () => {
  test('years + months', () => {
    assert.equal(tenureText(MOVE_IN, NOW), '2 ปี 4 เดือน');
  });
  test('empty when unknown', () => {
    assert.equal(tenureText(0, NOW), '');
  });
});

describe('deriveFarewell — visibility', () => {
  test('null for a blank/vacant room (no tenure, points, badges)', () => {
    assert.equal(deriveFarewell({ lease: {}, gamification: {} }, NOW), null);
    assert.equal(deriveFarewell(null, NOW), null);
  });
  test('shows once there is a move-in date', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2024-01-15' }, gamification: {} }, NOW);
    assert.ok(vm);
    assert.equal(vm.tenure, '2 ปี 4 เดือน');
  });
  test('shows on points/badges even without a lease', () => {
    assert.ok(deriveFarewell({ gamification: { points: 30 } }, NOW));
    assert.ok(deriveFarewell({ gamification: { badges: [{ id: 'a' }] } }, NOW));
  });
});

describe('deriveFarewell — stats extraction', () => {
  test('reads points / badgeCount / streak / trades', () => {
    const vm = deriveFarewell({
      lease: { moveInDate: '2024-01-15' },
      gamification: {
        points: 130,
        badges: [{ id: 'a', emoji: '🌱' }, { id: 'b', emoji: '🤝' }],
        dailyStreak: 5,
        marketplaceStats: { tradesCompleted: 3 },
      },
    }, NOW);
    assert.equal(vm.points, 130);
    assert.equal(vm.badgeCount, 2);
    assert.equal(vm.streak, 5);
    assert.equal(vm.trades, 3);
    assert.deepEqual(vm.badgeEmojis, ['🌱', '🤝']);
  });
  test('badgeEmojis capped at 6', () => {
    const badges = Array.from({ length: 9 }, (_, i) => ({ id: 'b' + i, emoji: '🏅' }));
    assert.equal(deriveFarewell({ lease: { moveInDate: '2024-01-15' }, gamification: { badges } }, NOW).badgeEmojis.length, 6);
  });
  test('negative / garbage numbers floor to 0', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2024-01-15' }, gamification: { points: -5, dailyStreak: 'x' } }, NOW);
    assert.equal(vm.points, 0);
    assert.equal(vm.streak, 0);
  });
});

describe('deriveFarewell — phase + tone', () => {
  test('active when the lease end is far away', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2024-01-15', endDate: NOW + 300 * DAY } }, NOW);
    assert.equal(vm.phase, 'active');
    assert.equal(vm.title, 'เรื่องราวของคุณที่นี่');
    assert.equal(vm.daysLeft, 300);
  });
  test('ending when within the farewell window', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2024-01-15', endDate: NOW + 20 * DAY } }, NOW);
    assert.equal(vm.phase, 'ending');
    assert.equal(vm.daysLeft, 20);
    assert.match(vm.message, /ครบสัญญา/);
    assert.ok(FAREWELL_WINDOW_DAYS >= 20);
  });
  test('ended via lease.status', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2024-01-15', status: 'ended' } }, NOW);
    assert.equal(vm.phase, 'ended');
    assert.match(vm.message, /คิดถึง/);
    assert.equal(vm.daysLeft, null);
  });
  test('ended via a past endDate', () => {
    const vm = deriveFarewell({ lease: { moveInDate: '2020-01-15', endDate: NOW - 10 * DAY } }, NOW);
    assert.equal(vm.phase, 'ended');
  });
});
