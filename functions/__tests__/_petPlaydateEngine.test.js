/**
 * Unit tests for _petPlaydateEngine — pure Pet Playdate Booking logic (Meaning
 * Layer #11). No firebase mock needed; every function is pure. The capacity /
 * dup / expiry guards here are the correctness-critical core (the join CF runs
 * canJoin/addAttendee inside an atomic transaction).
 *
 * Run: node --test functions/__tests__/_petPlaydateEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  VALID_STATUS, DEFAULT_CAPACITY, MIN_CAPACITY, MAX_CAPACITY, MAX_TITLE_LEN,
  GRACE_MS, MAX_DURATION_MS, MAX_ADVANCE_MS,
  isValidStatus, sanitizeTitle, sanitizePlace, normalizeCapacity,
  toMs, validateWindow, computeExpiresAtMs, isPast,
  attendeeCount, slotsLeft, hasAttendee, hasRoom, buildAttendee,
  canJoin, addAttendee, canLeave, removeAttendee, canCancel,
} = require('../_petPlaydateEngine');

const NOW = 1_700_000_000_000;           // fixed "now" for deterministic tests
const HOUR = 60 * 60 * 1000;

// A canonical OPEN playdate: host in slot 0, capacity 2, window 1h..3h from NOW.
function basePlaydate(over = {}) {
  return Object.assign({
    hostPetId: 'h1', hostRoom: 'N101', building: 'nest',
    title: 'เล่นเย็นนี้', place: 'ลานหญ้าชั้น G',
    startAt: NOW + HOUR, endAt: NOW + 3 * HOUR,
    capacity: 2,
    attendees: [{ petId: 'h1', tenantId: 'TH', room: 'N101', petName: 'โฮสต์', typeEmoji: '🐶' }],
    status: 'open',
  }, over);
}

describe('isValidStatus', () => {
  it('accepts the 3 board states only', () => {
    for (const s of ['open', 'full', 'cancelled']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('accepted'), false);   // that's an edge state (#10), not a board state
    assert.equal(isValidStatus(''), false);
    assert.equal(VALID_STATUS.size, 3);
  });
});

describe('sanitizeTitle / sanitizePlace', () => {
  it('trims and caps', () => {
    assert.equal(sanitizeTitle('  เล่นเย็นนี้  '), 'เล่นเย็นนี้');
    assert.equal(sanitizeTitle(''), '');
    assert.equal(sanitizeTitle(null), '');
    assert.equal(sanitizeTitle('x'.repeat(500)).length, MAX_TITLE_LEN);
    assert.equal(sanitizePlace('  rooftop  '), 'rooftop');
    assert.equal(sanitizePlace(undefined), '');
  });
});

describe('normalizeCapacity', () => {
  it('clamps to [MIN..MAX], blank/invalid → DEFAULT', () => {
    assert.equal(normalizeCapacity(6), 6);
    assert.equal(normalizeCapacity(1), MIN_CAPACITY);   // below min → min
    assert.equal(normalizeCapacity(0), DEFAULT_CAPACITY); // <1 → default
    assert.equal(normalizeCapacity(99), MAX_CAPACITY);  // above max → max
    assert.equal(normalizeCapacity(null), DEFAULT_CAPACITY);
    assert.equal(normalizeCapacity('abc'), DEFAULT_CAPACITY);
    assert.equal(normalizeCapacity(4.9), 4);            // floored
  });
});

describe('toMs — normalizes Timestamp / {seconds} / ISO / epoch', () => {
  it('handles every shape', () => {
    assert.equal(toMs({ toMillis: () => 123 }), 123);
    assert.equal(toMs({ seconds: 2 }), 2000);
    assert.equal(toMs('2023-11-14T22:13:20.000Z'), Date.parse('2023-11-14T22:13:20.000Z'));
    assert.equal(toMs(456), 456);
    assert.equal(toMs(null), 0);
    assert.equal(toMs('not-a-date'), 0);
  });
});

describe('validateWindow', () => {
  it('accepts a sane future window', () => {
    assert.deepEqual(validateWindow(NOW + HOUR, NOW + 2 * HOUR, NOW), { ok: true });
  });
  it('rejects unparseable bounds', () => {
    assert.equal(validateWindow(0, NOW + HOUR, NOW).reason, 'unparseable');
    assert.equal(validateWindow(NOW + HOUR, 0, NOW).reason, 'unparseable');
  });
  it('rejects end <= start', () => {
    assert.equal(validateWindow(NOW + 2 * HOUR, NOW + HOUR, NOW).reason, 'end-before-start');
    assert.equal(validateWindow(NOW + HOUR, NOW + HOUR, NOW).reason, 'end-before-start');
  });
  it('rejects an already-ended window', () => {
    assert.equal(validateWindow(NOW - 3 * HOUR, NOW - HOUR, NOW).reason, 'already-ended');
  });
  it('rejects a window longer than MAX_DURATION_MS', () => {
    assert.equal(validateWindow(NOW + HOUR, NOW + HOUR + MAX_DURATION_MS + 1, NOW).reason, 'too-long');
  });
  it('rejects a start too far in the future', () => {
    assert.equal(validateWindow(NOW + MAX_ADVANCE_MS + HOUR, NOW + MAX_ADVANCE_MS + 2 * HOUR, NOW).reason, 'too-far');
  });
});

describe('computeExpiresAtMs / isPast', () => {
  it('expiresAt = endAt + GRACE_MS', () => {
    assert.equal(computeExpiresAtMs(NOW + 3 * HOUR), NOW + 3 * HOUR + GRACE_MS);
  });
  it('isPast is true once now >= endAt', () => {
    assert.equal(isPast(basePlaydate(), NOW), false);                 // ends in 3h
    assert.equal(isPast(basePlaydate({ endAt: NOW - 1 }), NOW), true); // already ended
    assert.equal(isPast(null, NOW), false);
  });
});

describe('attendeeCount / slotsLeft / hasAttendee / hasRoom', () => {
  it('counts the host and computes free seats', () => {
    const p = basePlaydate();              // cap 2, 1 attendee (host)
    assert.equal(attendeeCount(p), 1);
    assert.equal(slotsLeft(p), 1);
    assert.ok(hasAttendee(p, 'h1'));
    assert.equal(hasAttendee(p, 'x9'), false);
    assert.ok(hasRoom(p, 'N101'));
    assert.equal(hasRoom(p, 'N202'), false);
  });
  it('slotsLeft never goes negative', () => {
    const p = basePlaydate({ capacity: 1, attendees: [{ petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' }] });
    assert.equal(slotsLeft(p), 0);
  });
});

describe('buildAttendee — safe snapshot (privacy)', () => {
  it('copies ONLY petId/tenantId/room/petName/typeEmoji, never health/status', () => {
    const a = buildAttendee({
      petId: 'g1', tenantId: 'TG', room: 'N202',
      petData: {
        name: '  มะลิ  ', typeEmoji: '🐱', type: '🐶', breed: 'เปอร์เซีย',
        healthLog: [{ type: 'vet' }], isVaccinated: true, status: 'approved', photoPath: 'x/y/z',
      },
    });
    assert.deepEqual(Object.keys(a).sort(), ['petId', 'petName', 'room', 'tenantId', 'typeEmoji']);
    assert.equal(a.petName, 'มะลิ');     // trimmed
    assert.equal(a.typeEmoji, '🐱');     // prefers typeEmoji over legacy `type`
    for (const k of ['healthLog', 'isVaccinated', 'status', 'photoPath', 'breed']) {
      assert.ok(!(k in a), `${k} must not be in the attendee snapshot`);
    }
  });
  it('falls back typeEmoji → legacy type, missing → safe defaults', () => {
    const a = buildAttendee({ petId: 'g1', room: 'N202', petData: { type: '🐰' } });
    assert.equal(a.typeEmoji, '🐰');
    assert.equal(a.petName, '');
    assert.equal(a.tenantId, '');
  });
  it('coerces nullish input without throwing', () => {
    const a = buildAttendee();
    assert.deepEqual(a, { petId: '', tenantId: '', room: '', petName: '', typeEmoji: '' });
  });
});

describe('canJoin — the capacity-race guard', () => {
  const guest = { petId: 'g1', room: 'N202' };

  it('allows a fresh neighbour pet to join an open playdate with a free seat', () => {
    assert.deepEqual(canJoin(basePlaydate(), guest, NOW), { ok: true });
  });
  it('rejects when the playdate is full', () => {
    const p = basePlaydate({ status: 'full' });
    assert.equal(canJoin(p, guest, NOW).reason, 'not-open');
  });
  it('rejects when no seats remain even if status still says open', () => {
    // capacity 2 already filled by 2 distinct-room attendees; guest g9 is a 3rd
    // room (so the `full` reason isn't masked by the room-already-in check).
    const p = basePlaydate({ capacity: 2, attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    assert.equal(canJoin(p, { petId: 'g9', room: 'N303' }, NOW).reason, 'full');
  });
  it('rejects a cancelled playdate', () => {
    assert.equal(canJoin(basePlaydate({ status: 'cancelled' }), guest, NOW).reason, 'not-open');
  });
  it('rejects a past playdate', () => {
    assert.equal(canJoin(basePlaydate({ endAt: NOW - 1 }), guest, NOW).reason, 'ended');
  });
  it('rejects a duplicate pet (idempotent double-tap)', () => {
    assert.equal(canJoin(basePlaydate(), { petId: 'h1', room: 'N101' }, NOW).reason, 'already-joined');
  });
  it('rejects a second pet from a room already represented', () => {
    const p = basePlaydate({ capacity: 6 });   // plenty of seats
    assert.equal(canJoin(p, { petId: 'h2', room: 'N101' }, NOW).reason, 'room-already-in');
  });
  it('rejects missing petId/room', () => {
    assert.equal(canJoin(basePlaydate(), { petId: '', room: 'N202' }, NOW).reason, 'missing');
    assert.equal(canJoin(basePlaydate(), { petId: 'g1', room: '' }, NOW).reason, 'missing');
  });
  it('null playdate → not-found', () => {
    assert.equal(canJoin(null, guest, NOW).reason, 'not-found');
  });
});

describe('addAttendee — immutable add + status flip', () => {
  it('appends and stays open while seats remain', () => {
    const p = basePlaydate({ capacity: 6 });
    const next = addAttendee(p, { petId: 'g1', room: 'N202' });
    assert.equal(next.attendees.length, 2);
    assert.equal(next.status, 'open');
    // original is not mutated
    assert.equal(p.attendees.length, 1);
  });
  it('flips to full when the last seat is taken', () => {
    const p = basePlaydate();   // cap 2, 1 attendee
    const next = addAttendee(p, { petId: 'g1', room: 'N202' });
    assert.equal(next.attendees.length, 2);
    assert.equal(next.status, 'full');
  });
});

describe('canLeave', () => {
  const full = basePlaydate({ status: 'full', attendees: [
    { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
  ] });
  it('a non-host attendee may leave', () => {
    assert.deepEqual(canLeave(full, 'g1', NOW), { ok: true });
  });
  it('the host may NOT leave (must cancel instead)', () => {
    assert.equal(canLeave(full, 'h1', NOW).reason, 'host-must-cancel');
  });
  it('a non-attendee pet cannot leave', () => {
    assert.equal(canLeave(full, 'x9', NOW).reason, 'not-in');
  });
  it('rejects a cancelled or past playdate', () => {
    assert.equal(canLeave(basePlaydate({ status: 'cancelled' }), 'g1', NOW).reason, 'cancelled');
    assert.equal(canLeave(basePlaydate({ endAt: NOW - 1 }), 'g1', NOW).reason, 'ended');
  });
  it('null playdate → not-found', () => {
    assert.equal(canLeave(null, 'g1', NOW).reason, 'not-found');
  });
});

describe('removeAttendee — immutable remove + re-open', () => {
  it('removes a guest and re-opens a full playdate', () => {
    const full = basePlaydate({ status: 'full', capacity: 2, attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    const next = removeAttendee(full, 'g1');
    assert.equal(next.attendees.length, 1);
    assert.equal(next.status, 'open');
    assert.equal(full.attendees.length, 2);   // original untouched
  });
  it('is a no-op shape when the pet is absent', () => {
    const next = removeAttendee(basePlaydate({ capacity: 6 }), 'x9');
    assert.equal(next.attendees.length, 1);
  });
});

describe('canCancel', () => {
  it('the host room may cancel in its own building', () => {
    assert.deepEqual(canCancel(basePlaydate(), 'nest', 'N101'), { ok: true });
  });
  it('admin may cancel regardless of building/room', () => {
    assert.deepEqual(canCancel(basePlaydate(), 'rooms', 'Z9', { isAdmin: true }), { ok: true });
  });
  it('a non-host room cannot cancel', () => {
    assert.equal(canCancel(basePlaydate(), 'nest', 'N202').reason, 'not-host');
  });
  it('cross-building cancel is rejected', () => {
    assert.equal(canCancel(basePlaydate(), 'rooms', 'N101').reason, 'cross-building');
  });
  it('an already-cancelled playdate is terminal', () => {
    assert.equal(canCancel(basePlaydate({ status: 'cancelled' }), 'nest', 'N101').reason, 'already-cancelled');
  });
  it('null playdate → not-found', () => {
    assert.equal(canCancel(null, 'nest', 'N101').reason, 'not-found');
  });
});
