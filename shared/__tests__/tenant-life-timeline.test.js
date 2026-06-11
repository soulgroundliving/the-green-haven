/**
 * Unit tests for the pure layer of tenant-life-timeline.js (Meaning Layer #15).
 * Runs in Node's realm — the module exports its pure helpers via module.exports
 * (the `typeof window === 'undefined'` guard) and stops before any DOM/Firebase.
 *
 *   node --test shared/__tests__/tenant-life-timeline.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { toMs, anniversaries, tenureText, deriveTimeline } = require('../tenant-life-timeline.js');

// Fixed clock for determinism.
const MOVE_IN = Date.parse('2024-01-15T00:00:00Z'); // occupancy start
const NOW = Date.parse('2026-06-12T00:00:00Z');     // "today"
const DAY = 86400000;

describe('toMs', () => {
  test('parses an ISO date string', () => {
    assert.equal(toMs('2024-01-15'), Date.parse('2024-01-15'));
  });
  test('passes an epoch-ms number through', () => {
    assert.equal(toMs(1700000000000), 1700000000000);
  });
  test('reads a Firestore Timestamp via toMillis()', () => {
    assert.equal(toMs({ toMillis: () => 123 }), 123);
  });
  test('reads a {seconds} timestamp', () => {
    assert.equal(toMs({ seconds: 2 }), 2000);
  });
  test('returns 0 for empty / garbage', () => {
    assert.equal(toMs(null), 0);
    assert.equal(toMs(''), 0);
    assert.equal(toMs('not-a-date'), 0);
    assert.equal(toMs(undefined), 0);
  });
});

describe('anniversaries', () => {
  test('one event per completed year', () => {
    const a = anniversaries(MOVE_IN, NOW); // Jan 2024 → Jun 2026 = 2 completed years
    assert.equal(a.length, 2);
    assert.equal(a[0].year, 1);
    assert.equal(a[1].year, 2);
    assert.equal(a[1].dateMs, Date.parse('2026-01-15T00:00:00Z'));
  });
  test('empty before the first anniversary', () => {
    assert.deepEqual(anniversaries(MOVE_IN, MOVE_IN + 180 * DAY), []);
  });
  test('empty when move-in is unknown', () => {
    assert.deepEqual(anniversaries(0, NOW), []);
  });
});

describe('tenureText', () => {
  test('formats years + months', () => {
    assert.equal(tenureText(MOVE_IN, NOW), '2 ปี 4 เดือน'); // 2024-01-15 → 2026-06-12
  });
  test('months only when under a year', () => {
    assert.equal(tenureText(Date.parse('2026-03-15'), NOW), '2 เดือน');
  });
  test('empty when move-in unknown', () => {
    assert.equal(tenureText(0, NOW), '');
  });
});

describe('deriveTimeline', () => {
  test('move-in prefers moveInDate over a future startDate (§7-BBB)', () => {
    const t = deriveTimeline({ lease: { moveInDate: '2024-01-15', startDate: '2027-01-21' } }, NOW);
    const mi = t.find(e => e.type === 'move_in');
    assert.equal(mi.dateMs, Date.parse('2024-01-15'));
  });
  test('falls back to startDate when moveInDate absent', () => {
    const t = deriveTimeline({ lease: { startDate: '2024-01-15' } }, NOW);
    assert.ok(t.find(e => e.type === 'move_in'));
  });
  test('one badge event per dated badge; undated badges are skipped', () => {
    const t = deriveTimeline({
      lease: {},
      badges: [
        { id: 'a', emoji: '🌱', label: 'Seedling', earnedAt: '2025-03-01' },
        { id: 'b', label: 'No date' }, // skipped — no earnedAt
      ],
    }, NOW);
    const badges = t.filter(e => e.type === 'badge');
    assert.equal(badges.length, 1);
    assert.equal(badges[0].sub, 'Seedling');
    assert.equal(badges[0].icon, '🌱');
  });
  test('lease end appears only when in the future, flagged future', () => {
    const future = deriveTimeline({ lease: { moveInDate: '2024-01-15', endDate: '2027-01-21' } }, NOW);
    const le = future.find(e => e.type === 'lease_end');
    assert.ok(le && le.future === true);

    const past = deriveTimeline({ lease: { moveInDate: '2020-01-15', endDate: '2021-01-21' } }, NOW);
    assert.equal(past.find(e => e.type === 'lease_end'), undefined);
  });
  test('sorted newest-first — a future lease-end is on top, move-in at the bottom', () => {
    const t = deriveTimeline({
      lease: { moveInDate: '2024-01-15', endDate: '2027-01-21' },
      badges: [{ id: 'a', emoji: '🌱', label: 'S', earnedAt: '2025-03-01' }],
    }, NOW);
    for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].dateMs >= t[i].dateMs);
    assert.equal(t[0].type, 'lease_end');               // future = newest
    assert.equal(t[t.length - 1].type, 'move_in');      // oldest
  });
  test('empty / null input → empty array, never throws', () => {
    assert.deepEqual(deriveTimeline({}, NOW), []);
    assert.deepEqual(deriveTimeline(null, NOW), []);
    assert.deepEqual(deriveTimeline({ lease: {}, badges: [] }, NOW), []);
  });
});
