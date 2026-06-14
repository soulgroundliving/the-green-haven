/**
 * _petPlaydateEngine — pure logic for Pet Playdate Booking (Meaning Layer #11).
 *
 * A tenant with an APPROVED pet HOSTS a playdate ("เล่นกับน้องเย็นนี้") → neighbours
 * in the SAME building bring their own approved pet and JOIN up to a capacity →
 * the host can CANCEL (attendees get a LINE push) → expired playdates are hidden
 * by the client + (later) swept. The capacity/dup guard runs inside the join CF's
 * atomic runTransaction (cloned from createFacilityBooking) — these pure helpers
 * make that decision unit-testable and identical across entry points.
 *
 * This is a Pet-pillar CONSUMER of #10: it READS petProfiles/{petId} (read-only,
 * PROFILE_SAFE_FIELDS) for which pets may attend, but never writes them — so it
 * never touches upsertPetProfile / _petSocialEngine (the contended #10 write-path).
 * Like #3 / #10 it awards NO points — the connection is the reward.
 *
 * NO I/O. The callables (createPetPlaydate / joinPetPlaydate / leavePetPlaydate /
 * cancelPetPlaydate) read the docs + the actor's claims, then delegate every
 * state decision to these pure functions. Mirrors _foodShareEngine / _petSocialEngine.
 *
 * petPlaydates/{auto-id} shape (top-level, building-scoped, CF-only-write):
 * {
 *   hostPetId, hostTenantId, hostRoom, hostName,
 *   building,                                       // 'rooms' | 'nest'
 *   title, place,                                   // free text
 *   startAt, endAt,                                 // Firestore Timestamp
 *   capacity,                                       // int [MIN_CAPACITY..MAX_CAPACITY]
 *   attendees: [ { petId, tenantId, room, petName, typeEmoji } ],  // host is index 0
 *   status: 'open' | 'full' | 'cancelled',
 *   createdAt, expiresAt,                           // expiresAt = endAt + GRACE_MS (sweep)
 *   cancelledAt?, cancelledBy?
 * }
 *
 * Per §7-NN the CFs are callables, never Firestore triggers.
 */

'use strict';

const VALID_STATUS = new Set(['open', 'full', 'cancelled']);

// Owner-decision defaults (todo-pet-playdate.md D2). A playdate seats DEFAULT_CAPACITY
// pets including the host (attendee #1); a host may pick anything in [MIN..MAX].
const DEFAULT_CAPACITY = 6;
const MIN_CAPACITY = 2;       // a playdate is pointless with < 2 pets (host + 1)
const MAX_CAPACITY = 12;

const MAX_TITLE_LEN = 80;
const MAX_PLACE_LEN = 80;
const MAX_PET_NAME_LEN = 60;
const MAX_TYPE_EMOJI_LEN = 8;

// A playdate is swept GRACE_MS after its endAt (todo-pet-playdate.md D6). The
// client hides anything past endAt immediately; the grace only governs deletion.
const GRACE_MS = 24 * 60 * 60 * 1000;

// A playdate window must be sane: end strictly after start, no longer than this.
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;     // 8h — a generous single-session ceiling
// And it can't be opened absurdly far ahead (mirror facility maxAdvanceDays spirit).
const MAX_ADVANCE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** Trim + length-cap a free-text title; '' for empty/blank input. */
function sanitizeTitle(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_TITLE_LEN);
}

/** Trim + length-cap a free-text place; '' for empty/blank input. */
function sanitizePlace(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_PLACE_LEN);
}

/** Clamp a requested capacity to [MIN..MAX]; blank/invalid → DEFAULT_CAPACITY. */
function normalizeCapacity(c) {
  const n = Math.floor(Number(c));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CAPACITY;
  return Math.max(MIN_CAPACITY, Math.min(n, MAX_CAPACITY));
}

// startAt/endAt may arrive as a Firestore Timestamp, a {seconds} shape, an ISO
// string, or raw epoch-ms. Normalize to epoch-ms (0 = unparseable).
function toMs(ts) {
  if (ts == null) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return Number.isFinite(p) ? p : 0;
  }
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validate a requested [startMs, endMs] window against `nowMs`.
 *   - both must parse,
 *   - end strictly after start,
 *   - end must be in the future (can't host an already-finished playdate),
 *   - duration <= MAX_DURATION_MS,
 *   - start <= now + MAX_ADVANCE_MS (no absurd-future opens).
 * A small past-tolerance on start lets "starts now" survive clock skew.
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateWindow(startMs, endMs, nowMs) {
  const s = Number(startMs);
  const e = Number(endMs);
  const now = Number(nowMs);
  if (!s || !e) return { ok: false, reason: 'unparseable' };
  if (e <= s) return { ok: false, reason: 'end-before-start' };
  if (e <= now) return { ok: false, reason: 'already-ended' };
  if (e - s > MAX_DURATION_MS) return { ok: false, reason: 'too-long' };
  if (s > now + MAX_ADVANCE_MS) return { ok: false, reason: 'too-far' };
  return { ok: true };
}

/** Absolute sweep-expiry epoch-ms from a playdate's endAt. */
function computeExpiresAtMs(endMs) {
  return Number(endMs) + GRACE_MS;
}

/** Is this playdate past its END at `nowMs`? (the client hides past playdates) */
function isPast(playdate, nowMs) {
  if (!playdate) return false;
  const end = toMs(playdate.endAt);
  return end > 0 && Number(nowMs) >= end;
}

/** Number of attendees currently seated (host counts as one). */
function attendeeCount(playdate) {
  return Array.isArray(playdate && playdate.attendees) ? playdate.attendees.length : 0;
}

/** Open seats remaining (never negative). */
function slotsLeft(playdate) {
  const cap = normalizeCapacity(playdate && playdate.capacity);
  return Math.max(0, cap - attendeeCount(playdate));
}

/** Is `petId` already an attendee of `playdate`? */
function hasAttendee(playdate, petId) {
  const id = String(petId);
  const list = Array.isArray(playdate && playdate.attendees) ? playdate.attendees : [];
  return list.some((a) => String(a && a.petId) === id);
}

/** Is `room` already represented among the attendees? (one room → one slot, fairness) */
function hasRoom(playdate, room) {
  const r = String(room);
  const list = Array.isArray(playdate && playdate.attendees) ? playdate.attendees : [];
  return list.some((a) => String(a && a.room) === r);
}

/**
 * Pick ONLY the safe display fields for an attendee snapshot — name + type emoji.
 * NEVER copies health/vaccine/status (those stay in the private pet doc; mirrors
 * #10 PROFILE_SAFE_FIELDS). typeEmoji falls back to the legacy `type` alias.
 * @param {Object} attendee { petId, tenantId, room, ...petData }
 * @returns {{ petId, tenantId, room, petName, typeEmoji }}
 */
function buildAttendee({ petId, tenantId, room, petData } = {}) {
  const p = petData || {};
  return {
    petId: String(petId == null ? '' : petId),
    tenantId: String(tenantId == null ? '' : tenantId),
    room: String(room == null ? '' : room),
    petName: String(p.name || '').trim().slice(0, MAX_PET_NAME_LEN),
    typeEmoji: String(p.typeEmoji || p.type || '').slice(0, MAX_TYPE_EMOJI_LEN),
  };
}

/**
 * Can the pet `attendee.petId` (in room `attendee.room`) JOIN `playdate` at `nowMs`?
 * The capacity-race guard — the join CF re-checks this inside its transaction so a
 * burst of joins on the last seat produces a single winner.
 *   - playdate must exist + be 'open' (a 'full' or 'cancelled' one can't be joined),
 *   - must NOT be past its end,
 *   - a seat must be free,
 *   - the pet must not already be in (idempotent double-tap → reject),
 *   - the room must not already be in (one slot per room — keeps it a NEIGHBOUR mix
 *     and stops a host stacking all their own pets; the host already holds slot 0).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canJoin(playdate, attendee, nowMs) {
  if (!playdate) return { ok: false, reason: 'not-found' };
  if (playdate.status !== 'open') return { ok: false, reason: 'not-open' };
  if (isPast(playdate, nowMs)) return { ok: false, reason: 'ended' };
  const petId = String(attendee && attendee.petId);
  const room = String(attendee && attendee.room);
  if (!petId || !room) return { ok: false, reason: 'missing' };
  if (slotsLeft(playdate) <= 0) return { ok: false, reason: 'full' };
  if (hasAttendee(playdate, petId)) return { ok: false, reason: 'already-joined' };
  if (hasRoom(playdate, room)) return { ok: false, reason: 'room-already-in' };
  return { ok: true };
}

/**
 * Immutable add: returns a NEW { attendees, status } for `playdate` with
 * `attendee` appended; status flips to 'full' when the seat just filled the last
 * slot. Does NOT validate — call canJoin first (the CF does, inside the tx).
 * @returns {{ attendees: Array, status: 'open'|'full' }}
 */
function addAttendee(playdate, attendee) {
  const cap = normalizeCapacity(playdate && playdate.capacity);
  const current = Array.isArray(playdate && playdate.attendees) ? playdate.attendees : [];
  const attendees = current.concat([attendee]);
  return { attendees, status: attendees.length >= cap ? 'full' : 'open' };
}

/**
 * Can the pet `petId` LEAVE `playdate`? The HOST (attendee index 0) cannot leave —
 * they must CANCEL the whole playdate instead (leaving would orphan it). A
 * cancelled/past playdate can't be left.
 * @returns {{ ok: boolean, reason?: string }}
 */
function canLeave(playdate, petId, nowMs) {
  if (!playdate) return { ok: false, reason: 'not-found' };
  if (playdate.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (isPast(playdate, nowMs)) return { ok: false, reason: 'ended' };
  const id = String(petId);
  if (!id) return { ok: false, reason: 'missing' };
  if (String(playdate.hostPetId) === id) return { ok: false, reason: 'host-must-cancel' };
  if (!hasAttendee(playdate, id)) return { ok: false, reason: 'not-in' };
  return { ok: true };
}

/**
 * Immutable remove: returns a NEW { attendees, status } for `playdate` with
 * `petId` removed; status re-opens to 'open' if it was 'full' (a seat freed up).
 * Never validates host-leave — call canLeave first (the CF does, inside the tx).
 * @returns {{ attendees: Array, status: 'open'|'full' }}
 */
function removeAttendee(playdate, petId) {
  const id = String(petId);
  const cap = normalizeCapacity(playdate && playdate.capacity);
  const current = Array.isArray(playdate && playdate.attendees) ? playdate.attendees : [];
  const attendees = current.filter((a) => String(a && a.petId) !== id);
  return { attendees, status: attendees.length >= cap ? 'full' : 'open' };
}

/**
 * Can `callerRoom` (in `callerBuilding`) CANCEL `playdate`? The HOST (host room) or
 * an admin may cancel; an already-cancelled playdate is terminal. Building must
 * match (defense in depth on top of the building-scoped read rule).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canCancel(playdate, callerBuilding, callerRoom, opts = {}) {
  if (!playdate) return { ok: false, reason: 'not-found' };
  if (playdate.status === 'cancelled') return { ok: false, reason: 'already-cancelled' };
  if (opts.isAdmin === true) return { ok: true };
  if (playdate.building !== callerBuilding) return { ok: false, reason: 'cross-building' };
  if (String(playdate.hostRoom) !== String(callerRoom)) return { ok: false, reason: 'not-host' };
  return { ok: true };
}

module.exports = {
  VALID_STATUS,
  DEFAULT_CAPACITY,
  MIN_CAPACITY,
  MAX_CAPACITY,
  MAX_TITLE_LEN,
  MAX_PLACE_LEN,
  GRACE_MS,
  MAX_DURATION_MS,
  MAX_ADVANCE_MS,
  isValidStatus,
  sanitizeTitle,
  sanitizePlace,
  normalizeCapacity,
  toMs,
  validateWindow,
  computeExpiresAtMs,
  isPast,
  attendeeCount,
  slotsLeft,
  hasAttendee,
  hasRoom,
  buildAttendee,
  canJoin,
  addAttendee,
  canLeave,
  removeAttendee,
  canCancel,
};
