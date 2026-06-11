/**
 * _petSocialEngine — pure logic for the Pet Social Graph (Meaning Layer #10).
 * A tenant opts a pet into a building-visible directory (petProfiles/{petId}) →
 * neighbours in the SAME building browse the directory → a pet sends a friend
 * request to another pet → the recipient pet's owner accepts or declines
 * (petLinks/{linkId}).
 *
 * This is the Pet-pillar shared primitive (#11 playdate / #12 matching / #14
 * caretaker build on it). It mirrors the building-scoped-collection + per-
 * transition-callable shape of the Helper (#2) / Community-requests (#3) /
 * Food-share (#4) boards, and — like #3 — it awards NO points (social
 * connection is self-attested; points = money → a farm surface). The reward is
 * the connection itself.
 *
 * NO I/O. The callables (upsertPetProfile / requestPetLink / respondPetLink /
 * removePetLink) read the docs + the actor's claims, then delegate every
 * state-transition decision to these pure functions so the rules are
 * unit-testable and identical across the entry points.
 *
 * Privacy (the reason for a SEPARATE mirror collection, not a flag on the pet
 * doc): the pet doc `tenants/{b}/list/{r}/pets/{petId}` carries `healthLog[]`
 * (#9) + vaccine fields + the `status` approval — none of which may leak
 * building-wide. petProfiles holds ONLY the safe display fields, copied
 * server-side by the CF (anti-spoof). The whitelist lives here.
 *
 * petProfiles/{petId} shape (petId == the pet doc id):
 * {
 *   petId, ownerTenantId, ownerRoom, building,
 *   name, typeEmoji, breed, gender, age, photoURL, bio,
 *   createdAt, updatedAt
 * }
 *
 * petLinks/{linkId} shape (linkId = `${minPetId}_${maxPetId}`, deterministic so
 * an A↔B edge can never duplicate regardless of who initiates):
 * {
 *   linkId, petA, petB, building,
 *   requesterPetId, requesterTenantId, requesterRoom,
 *   recipientPetId, recipientTenantId, recipientRoom,
 *   status: 'pending' | 'accepted' | 'declined',
 *   createdAt, respondedAt?
 * }
 *
 * Per §7-NN the CFs are callables, never Firestore triggers.
 */

'use strict';

// Display fields copied from the pet doc into the public profile. NEVER include
// healthLog / vaccine* / status / photoPath / any internal path — those stay in
// the private pet doc (PDPA: health is sensitive, approval state is internal).
const PROFILE_SAFE_FIELDS = ['name', 'typeEmoji', 'breed', 'gender', 'age', 'photoURL'];

const VALID_LINK_STATUS = new Set(['pending', 'accepted', 'declined']);

const MAX_BIO_LEN = 160;

/** Trim + length-cap the owner-written pet bio; returns '' for empty/blank input. */
function sanitizeBio(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_BIO_LEN);
}

function isValidLinkStatus(s) { return VALID_LINK_STATUS.has(s); }

/**
 * Pick ONLY the safe display fields off a raw pet doc → the public profile body.
 * Missing fields become '' (string) / null (photoURL) so the mirror doc has a
 * stable shape. typeEmoji falls back to the legacy `type` alias.
 * @param {Object} petData raw pet doc data
 * @returns {{ name: string, typeEmoji: string, breed: string, gender: string, age: string, photoURL: string|null }}
 */
function buildProfileFields(petData) {
  const p = petData || {};
  return {
    name:     String(p.name || '').trim().slice(0, 60),
    typeEmoji: String(p.typeEmoji || p.type || '').slice(0, 8),
    breed:    String(p.breed || '').trim().slice(0, 60),
    gender:   String(p.gender || '').slice(0, 16),
    age:      String(p.age || '').trim().slice(0, 32),
    photoURL: p.photoURL || null,
  };
}

/**
 * Build the deterministic edge id for two pets. Sorted so A→B and B→A collapse
 * to ONE doc — a friend request can never create a duplicate reverse edge.
 * @returns {string} `${min}_${max}` by string order
 */
function buildLinkId(petIdA, petIdB) {
  const a = String(petIdA == null ? '' : petIdA);
  const b = String(petIdB == null ? '' : petIdB);
  if (!a || !b) throw new Error('buildLinkId: both petIds must be non-empty');
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Can `fromPetId` send a friend request to `toPetId`, given the current edge doc
 * (or null if none exists)?
 *   - a pet can't friend itself.
 *   - a 'pending' or 'accepted' edge already exists → reject (no dup / already friends).
 *   - a 'declined' edge → allow re-request (the CF overwrites it back to pending).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canRequestLink(existing, fromPetId, toPetId) {
  if (!fromPetId || !toPetId) return { ok: false, reason: 'missing' };
  if (String(fromPetId) === String(toPetId)) return { ok: false, reason: 'self' };
  if (!existing) return { ok: true };
  if (existing.status === 'pending')  return { ok: false, reason: 'pending-exists' };
  if (existing.status === 'accepted') return { ok: false, reason: 'already-friends' };
  // declined (or any non-active state) → a fresh request is allowed
  return { ok: true };
}

/**
 * Can edge `link` be responded to (accept/decline)? This guards the STATE
 * TRANSITION only: the edge must exist and be 'pending' (terminal edges can't be
 * re-answered — atomic single-winner: the CF re-reads status inside the
 * transaction). AUTHORIZATION (the caller must be the RECIPIENT party, never the
 * requester) is enforced separately in respondPetLink by matching the caller's
 * room against `link.recipientRoom` — the project's room-based auth model. Since
 * requestPetLink forbids same-room edges, requester and recipient rooms always
 * differ, so the room check is an airtight recipient-only guard.
 * @returns {{ ok: boolean, reason?: string }}
 */
function canRespondLink(link) {
  if (!link) return { ok: false, reason: 'not-found' };
  if (link.status !== 'pending') return { ok: false, reason: 'not-pending' };
  return { ok: true };
}

/**
 * Can the tenant of `callerRoom` (in `callerBuilding`) remove edge `link`?
 * Either party (requester or recipient room) may unfriend. Building must match
 * (defense in depth on top of the building-scoped read rule).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canRemoveLink(link, callerBuilding, callerRoom) {
  if (!link) return { ok: false, reason: 'not-found' };
  if (link.building !== callerBuilding) return { ok: false, reason: 'cross-building' };
  const room = String(callerRoom);
  if (String(link.requesterRoom) !== room && String(link.recipientRoom) !== room) {
    return { ok: false, reason: 'not-a-party' };
  }
  return { ok: true };
}

module.exports = {
  PROFILE_SAFE_FIELDS,
  VALID_LINK_STATUS,
  MAX_BIO_LEN,
  sanitizeBio,
  isValidLinkStatus,
  buildProfileFields,
  buildLinkId,
  canRequestLink,
  canRespondLink,
  canRemoveLink,
};
