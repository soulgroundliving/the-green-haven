'use strict';

/**
 * Unit tests for shared/tenant-pet-playdate.js — Meaning Layer #11 booking UI.
 *
 * Only the PURE helpers are tested here (isHost / slotsLeft / roomJoined /
 * isJoinable / isLive / clampCapacity / fmtWhen): the render / subscription /
 * callable paths need DOM + Firebase + LIFF claims and are verified live on LINE
 * (§7-J). These functions are the load-bearing client logic — they decide which
 * card shows เข้าร่วม vs เต็มแล้ว vs ยกเลิก, bucket "mine" by ROOM (§7-FFF), and
 * filter past/cancelled playdates so the feature works without the deferred sweep.
 *
 * The module is a browser IIFE that, in a node realm (no window/document), exports
 * the pure helpers via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-pet-playdate.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  isHost, slotsLeft, roomJoined, isJoinable, isLive, clampCapacity, fmtWhen,
} = require('../tenant-pet-playdate.js');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function pd(over) {
  return Object.assign({
    id: 'pd1', hostRoom: 'N101', building: 'nest', capacity: 2,
    startAt: NOW + HOUR, endAt: NOW + 3 * HOUR, status: 'open',
    attendees: [{ petId: 'h1', room: 'N101', petName: 'โฮสต์', typeEmoji: '🐶' }],
  }, over || {});
}

describe('isHost — §7-FFF bucket by ROOM, not auth uid', () => {
  test('true when the playdate hostRoom matches my room', () => {
    assert.equal(isHost(pd(), 'N101'), true);
    assert.equal(isHost(pd(), 'N202'), false);
    assert.equal(isHost(pd(), 101), false);     // string vs number — coerced, '101' !== 'N101'
    assert.equal(isHost(null, 'N101'), false);
  });
});

describe('slotsLeft', () => {
  test('counts the host and never goes negative', () => {
    assert.equal(slotsLeft(pd()), 1);                              // cap 2, 1 attendee
    assert.equal(slotsLeft(pd({ capacity: 6 })), 5);
    assert.equal(slotsLeft(pd({ capacity: 1, attendees: [{ petId: 'h1', room: 'N101' }, { petId: 'g', room: 'N2' }] })), 0);
    assert.equal(slotsLeft(pd({ capacity: undefined })), 5);       // default 6 - 1
  });
});

describe('roomJoined', () => {
  test('true when my room already holds a slot', () => {
    assert.equal(roomJoined(pd(), 'N101'), true);
    assert.equal(roomJoined(pd(), 'N202'), false);
  });
});

describe('isJoinable — drives the เข้าร่วม button', () => {
  test('open + seat free + my room not in → joinable', () => {
    assert.equal(isJoinable(pd(), 'N202', NOW), true);
  });
  test('not joinable when full status', () => {
    assert.equal(isJoinable(pd({ status: 'full' }), 'N202', NOW), false);
  });
  test('not joinable when no seats left', () => {
    const full = pd({ capacity: 2, attendees: [{ petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' }] });
    assert.equal(isJoinable(full, 'N303', NOW), false);
  });
  test('not joinable when my room already joined', () => {
    assert.equal(isJoinable(pd(), 'N101', NOW), false);   // host's own room
  });
  test('not joinable once past the end time', () => {
    assert.equal(isJoinable(pd({ endAt: NOW - 1 }), 'N202', NOW), false);
  });
  test('not joinable when cancelled', () => {
    assert.equal(isJoinable(pd({ status: 'cancelled' }), 'N202', NOW), false);
  });
});

describe('isLive — filters the list (open|full AND not past)', () => {
  test('open future playdate is live', () => {
    assert.equal(isLive(pd(), NOW), true);
  });
  test('full future playdate is still live (shown as เต็มแล้ว)', () => {
    assert.equal(isLive(pd({ status: 'full' }), NOW), true);
  });
  test('cancelled is not live', () => {
    assert.equal(isLive(pd({ status: 'cancelled' }), NOW), false);
  });
  test('past playdate is not live', () => {
    assert.equal(isLive(pd({ endAt: NOW - 1 }), NOW), false);
  });
  test('accepts a {seconds} Timestamp shape for endAt', () => {
    assert.equal(isLive(pd({ endAt: { seconds: (NOW + 3 * HOUR) / 1000 } }), NOW), true);
    assert.equal(isLive(pd({ endAt: { seconds: (NOW - HOUR) / 1000 } }), NOW), false);
  });
});

describe('clampCapacity — host form input guard', () => {
  test('clamps to [2..12], blank/invalid → 6', () => {
    assert.equal(clampCapacity(6), 6);
    assert.equal(clampCapacity(1), 2);
    assert.equal(clampCapacity(0), 6);
    assert.equal(clampCapacity(99), 12);
    assert.equal(clampCapacity('abc'), 6);
    assert.equal(clampCapacity(null), 6);
  });
});

describe('fmtWhen — Thai short date/time', () => {
  // Use a fixed-offset Date factory so the test is timezone-independent: render the
  // ms as if UTC (getHours==getUTCHours) by shifting the input by the local offset.
  function utcDate(ms) {
    const d = new Date(ms);
    return new Date(ms + d.getTimezoneOffset() * 60000);
  }
  const base = Date.UTC(2023, 5, 14, 17, 0, 0);   // 14 มิ.ย. 17:00 UTC
  test('same-day window → one date, two times', () => {
    const s = fmtWhen(base, base + 2 * HOUR, utcDate);
    assert.equal(s, '14 มิ.ย. 17:00–19:00');
  });
  test('cross-day window → both dates', () => {
    const s = fmtWhen(Date.UTC(2023, 5, 14, 23, 0, 0), Date.UTC(2023, 5, 15, 1, 0, 0), utcDate);
    assert.equal(s, '14 มิ.ย. 23:00 – 15 มิ.ย. 01:00');
  });
  test('empty/invalid → empty string', () => {
    assert.equal(fmtWhen(0, base, utcDate), '');
    assert.equal(fmtWhen(base, 0, utcDate), '');
  });
});
