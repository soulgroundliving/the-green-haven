/**
 * _helpRequestEngine — pure logic for the Helper-request lifecycle (Meaning
 * Layer #2). A neighbor posts a help request → another tenant accepts → the
 * requester confirms-done + rates → the helper earns peer-confirmed kindness
 * points (pointsLedger source:'help_completed', feeds #6 Kindness + #7 Verified
 * Helper).
 *
 * NO I/O. The callables (postHelpRequest / acceptHelpRequest /
 * completeHelpRequest / cancelHelpRequest) read the request doc + the actor's
 * claims, then delegate every state-transition decision to these pure functions
 * so the rules are unit-testable and identical across the four entry points.
 *
 * Request doc shape (helpRequests/{auto-id}):
 * {
 *   requesterUid, requesterTenantId, requesterName,
 *   building, room, title, detail?, category?,
 *   status: 'open' | 'accepted' | 'done' | 'cancelled',
 *   helperUid?, helperTenantId?, helperBuilding?, helperRoom?, helperName?,
 *   rating?(1-5), ratingNote?,
 *   createdAt, acceptedAt?, completedAt?, cancelledAt?
 * }
 *
 * Transition authority (the anti-gaming model — owner decision 2026-06-08):
 *   - accept   : ANY tenant in the same building EXCEPT the requester.
 *   - complete : ONLY the requester (peer-confirmed — the helped party confirms
 *                the work happened before any points move; the helper can never
 *                self-mark done, mirroring the quests `admin`-verify stance, §6).
 *   - cancel   : the requester (or an admin, for moderation).
 *
 * Per §7-NN the CFs are callables, never Firestore triggers. Per §6 the awarded
 * balance is server-authoritative — the engine never trusts a client value.
 */

'use strict';

const VALID_STATUS = new Set(['open', 'accepted', 'done', 'cancelled']);
const VALID_CATEGORY = new Set(['lifting', 'errand', 'petcare', 'tech', 'other']);

// Owner decision 2026-06-08: a completed, peer-confirmed help is worth 20 pts
// (the 10-50 "real kindness" band). Tune here; the callables read this constant.
const HELPER_REWARD_POINTS = 20;

const MAX_TITLE_LEN = 80;
const MAX_DETAIL_LEN = 500;
const MAX_RATING_NOTE_LEN = 280;

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** category is optional — empty/unset is allowed, a non-empty value must be known. */
function isValidCategory(c) {
  return c == null || c === '' || VALID_CATEGORY.has(c);
}

/** rating must be an integer 1-5. */
function isValidRating(r) {
  const n = Number(r);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Trim + length-cap a free-text title; returns '' for empty/blank input. */
function sanitizeTitle(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_TITLE_LEN);
}

/** Trim + length-cap optional detail text; returns '' for empty/blank input. */
function sanitizeDetail(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_DETAIL_LEN);
}

/**
 * Can `helperUid` accept request `req`?
 *   - request must be 'open' (atomic single-winner — the CF re-reads status
 *     inside the transaction, so a second accepter loses).
 *   - the helper must NOT be the requester (you can't help yourself).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canAccept(req, helperUid) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'open') return { ok: false, reason: 'not-open' };
  if (req.requesterUid && helperUid && req.requesterUid === helperUid) {
    return { ok: false, reason: 'self-help' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` complete (confirm-done + rate) request `req`?
 *   - request must be 'accepted'.
 *   - caller must be the requester (peer-confirmed award — §6).
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
  VALID_CATEGORY,
  HELPER_REWARD_POINTS,
  MAX_TITLE_LEN,
  MAX_DETAIL_LEN,
  MAX_RATING_NOTE_LEN,
  isValidStatus,
  isValidCategory,
  isValidRating,
  sanitizeTitle,
  sanitizeDetail,
  canAccept,
  canComplete,
  canCancel,
};
