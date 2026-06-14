/**
 * _caretakerEngine — pure logic for the Emergency Caretaker lifecycle (Meaning
 * Layer #14, 🆘🐾 หาคนช่วยดูแลสัตว์เลี้ยงยามฉุกเฉิน). An owner posts an urgent
 * pet-sitting request → a neighbour in the SAME building accepts → the requester
 * (the owner) confirms it is done → cleared.
 *
 * This clones the Meaning Layer #2 _helpRequestEngine state machine VERBATIM
 * (open|accepted|done|cancelled · the same canAccept / canComplete / canCancel
 * transition authority) — pet-sitting instead of labour. The ONLY net-new logic
 * is buildCaretakerDoc (snapshots SAFE pet fields off the registry) + the
 * period/need sanitizers.
 *
 * ⚠️ DESIGN (owner decision D1, 2026-06-13): PER-REQUEST opt-in only. Anyone in
 * the building can accept an OPEN request — there is NO persistent "available to
 * pet-sit" flag, and this engine NEVER touches petProfiles / the #10 write-path.
 * It only READS the requester's own pet doc (tenants/{b}/list/{r}/pets/{petId})
 * to snapshot the SAFE display fields, mirroring the #10 PROFILE_SAFE_FIELDS
 * discipline (no health/vaccine/internal-status leak — PDPA).
 *
 * Owner decision D2: POINT-FREE v1 — completing a caretaker request awards no
 * spendable points (care + neighbourly connection, mirroring #3/#10). No
 * gamification surface, so the engine never trusts or computes a balance.
 *
 * NO I/O. The callables (postCaretakerRequest / acceptCaretakerRequest /
 * completeCaretakerRequest / cancelCaretakerRequest) read the request doc + the
 * actor's claims, then delegate every state-transition decision to these pure
 * functions so the rules are unit-testable and identical across the four entry
 * points.
 *
 * Request doc shape (caretakerRequests/{auto-id}):
 * {
 *   requesterUid, requesterTenantId, requesterName, building, room,
 *   petId, petName, petTypeEmoji,          // SAFE snapshot from the registry (no health)
 *   period: { from, to },                  // when care is needed (Firestore Timestamps)
 *   need,                                  // "ให้อาหารเช้า-เย็น พาเดินเล่น"
 *   urgency: 'scheduled' | 'urgent',
 *   status: 'open' | 'accepted' | 'done' | 'cancelled',
 *   caretakerUid?, caretakerTenantId?, caretakerBuilding?, caretakerRoom?, caretakerName?,
 *   createdAt, acceptedAt?, completedAt?, cancelledAt?
 * }
 *
 * Transition authority (mirrors #2 — the anti-gaming model, §6):
 *   - accept   : ANY tenant in the same building EXCEPT the requester.
 *   - complete : ONLY the requester (peer-confirmed — the OWNER confirms care
 *                happened; the caretaker can never self-mark done, §6).
 *   - cancel   : the requester (or an admin, for moderation).
 *
 * Per §7-NN the CFs are callables, never Firestore triggers.
 */

'use strict';

const VALID_STATUS = new Set(['open', 'accepted', 'done', 'cancelled']);
const VALID_URGENCY = new Set(['scheduled', 'urgent']);

// SAFE display fields snapshot onto the request from the requester's pet doc.
// MIRRORS functions/_petSocialEngine.js PROFILE_SAFE_FIELDS discipline: NEVER
// include healthLog / vaccine* / status / photoPath — health is sensitive and
// approval state is internal (PDPA). Only name + type-emoji are surfaced.
const PET_SAFE_FIELDS = ['name', 'typeEmoji'];

const MAX_NEED_LEN = 300;
const MAX_PET_NAME_LEN = 60;

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** urgency is optional — empty/unset defaults to 'scheduled', a non-empty value must be known. */
function isValidUrgency(u) {
  return u == null || u === '' || VALID_URGENCY.has(u);
}

/** Normalise urgency to a known value; unknown/empty → 'scheduled'. */
function normalizeUrgency(u) {
  return VALID_URGENCY.has(u) ? u : 'scheduled';
}

/** Trim + length-cap the free-text care need; returns '' for empty/blank input. */
function sanitizeNeed(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_NEED_LEN);
}

/**
 * Validate the care window. Accepts plain numbers (epoch ms), Date, or any
 * object carrying numeric `.seconds` / `.toMillis()` (a Firestore Timestamp or
 * the {seconds,nanoseconds} wire shape). Both bounds are required and `to` must
 * be strictly after `from`.
 * @returns {{ ok: boolean, reason?: string, fromMs?: number, toMs?: number }}
 */
function validatePeriod(period) {
  if (!period || typeof period !== 'object') return { ok: false, reason: 'missing' };
  const fromMs = _toMs(period.from);
  const toMs = _toMs(period.to);
  if (fromMs == null || toMs == null) return { ok: false, reason: 'missing' };
  if (toMs <= fromMs) return { ok: false, reason: 'order' };
  return { ok: true, fromMs, toMs };
}

/** Coerce a date-ish value to epoch ms, or null if it isn't one. */
function _toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) { const n = v.getTime(); return Number.isFinite(n) ? n : null; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { const n = v.toMillis(); return Number.isFinite(n) ? n : null; }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + (Number(v.nanoseconds) || 0) / 1e6;
    if (typeof v._seconds === 'number') return v._seconds * 1000 + (Number(v._nanoseconds) || 0) / 1e6;
  }
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  return null;
}

/**
 * Pick ONLY the safe display fields off a raw pet doc → the request snapshot.
 * Missing fields become '' so the doc has a stable shape. typeEmoji falls back
 * to the legacy `type` alias (mirrors _petSocialEngine.buildProfileFields).
 * @param {Object} petData raw pet doc data
 * @returns {{ petName: string, petTypeEmoji: string }}
 */
function buildPetSnapshot(petData) {
  const p = petData || {};
  return {
    petName: String(p.name || '').trim().slice(0, MAX_PET_NAME_LEN),
    petTypeEmoji: String(p.typeEmoji || p.type || '').slice(0, 8),
  };
}

/**
 * Can `helperUid` accept request `req`?
 *   - request must be 'open' (atomic single-winner — the CF re-reads status
 *     inside the transaction, so a second accepter loses).
 *   - the helper must NOT be the requester (you can't pet-sit your own pet).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canAccept(req, helperUid) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'open') return { ok: false, reason: 'not-open' };
  if (req.requesterUid && helperUid && req.requesterUid === helperUid) {
    return { ok: false, reason: 'self-accept' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` complete (confirm-done) request `req`?
 *   - request must be 'accepted'.
 *   - caller must be the requester (peer-confirmed — the OWNER confirms care
 *     happened; §6 never self-claim by the caretaker).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canComplete(req, callerUid) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'accepted') return { ok: false, reason: 'not-accepted' };
  if (!callerUid || req.requesterUid !== callerUid) {
    return { ok: false, reason: 'not-requester' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` cancel request `req`?
 *   - request must still be open or accepted (terminal states can't be cancelled).
 *   - caller must be the requester, UNLESS opts.isAdmin (moderation).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canCancel(req, callerUid, opts = {}) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'open' && req.status !== 'accepted') {
    return { ok: false, reason: 'terminal' };
  }
  if (!opts.isAdmin && (!callerUid || req.requesterUid !== callerUid)) {
    return { ok: false, reason: 'not-requester' };
  }
  return { ok: true };
}

module.exports = {
  VALID_STATUS,
  VALID_URGENCY,
  PET_SAFE_FIELDS,
  MAX_NEED_LEN,
  MAX_PET_NAME_LEN,
  isValidStatus,
  isValidUrgency,
  normalizeUrgency,
  sanitizeNeed,
  validatePeriod,
  buildPetSnapshot,
  canAccept,
  canComplete,
  canCancel,
};
