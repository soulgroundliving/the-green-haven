/**
 * _communityRequestEngine — pure logic for the Community-requests board (Meaning
 * Layer #3). A tenant posts a request to BORROW or be GIVEN an item → a neighbor
 * in the SAME building offers it → the requester confirms they received it.
 *
 * This is the micro-economy sibling of the Helper board (#2): identical
 * open→…→done lifecycle shape, but it is about THINGS (lend / share) not LABOUR,
 * and — by roadmap design — it awards NO kindness points. The #6 Kindness score
 * sums the source set {quest, food_share, giveaway, help_completed}; community
 * requests is deliberately NOT in it, so there is no spendable-points (= money)
 * reward here and therefore no collusion-farm surface at all. The reward is the
 * neighbourly connection plus an optional thank-you note.
 *
 * NO I/O. The callables (postCommunityRequest / offerCommunityRequest /
 * fulfillCommunityRequest / cancelCommunityRequest) read the request doc + the
 * actor's claims, then delegate every state-transition decision to these pure
 * functions so the rules are unit-testable and identical across the four entry
 * points.
 *
 * Request doc shape (communityRequests/{auto-id}):
 * {
 *   requesterUid, requesterTenantId, requesterName,
 *   building, room, title, detail?, category?, requestKind('borrow'|'have'),
 *   status: 'open' | 'offered' | 'fulfilled' | 'cancelled',
 *   offererUid?, offererTenantId?, offererBuilding?, offererRoom?, offererName?,
 *   thankNote?,
 *   createdAt, offeredAt?, fulfilledAt?, cancelledAt?, cancelledBy?
 * }
 *
 * Transition authority (mirrors #2 — peer-confirmed, never self-serve):
 *   - offer   : ANY tenant in the same building EXCEPT the requester.
 *   - fulfill : ONLY the requester (confirms they received the item — the offerer
 *               can never self-mark fulfilled, the same honesty stance as #2).
 *   - cancel  : the requester (or an admin, for moderation).
 *
 * Per §7-NN the CFs are callables, never Firestore triggers.
 */

'use strict';

const VALID_STATUS = new Set(['open', 'offered', 'fulfilled', 'cancelled']);
// Item categories (lendable / shareable things), distinct from #2's labour set.
const VALID_CATEGORY = new Set(['tool', 'kitchen', 'household', 'electronics', 'other']);
// borrow = lend-and-return · have = give-away/keep. Optional; defaults to 'borrow'.
const VALID_KIND = new Set(['borrow', 'have']);

const MAX_TITLE_LEN = 80;
const MAX_DETAIL_LEN = 500;
const MAX_NOTE_LEN = 280;

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** category is optional — empty/unset is allowed, a non-empty value must be known. */
function isValidCategory(c) {
  return c == null || c === '' || VALID_CATEGORY.has(c);
}

/** kind is optional — empty/unset is allowed (the caller defaults it to 'borrow'). */
function isValidKind(k) {
  return k == null || k === '' || VALID_KIND.has(k);
}

/** Normalise the request kind to a stored value; unknown/blank → 'borrow'. */
function normalizeKind(k) {
  return VALID_KIND.has(k) ? k : 'borrow';
}

/** Trim + length-cap a free-text title; returns '' for empty/blank input. */
function sanitizeTitle(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_TITLE_LEN);
}

/** Trim + length-cap optional detail text; returns '' for empty/blank input. */
function sanitizeDetail(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_DETAIL_LEN);
}

/** Trim + length-cap the optional thank-you note; returns '' for empty/blank input. */
function sanitizeNote(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_NOTE_LEN);
}

/**
 * Can `offererUid` offer the item for request `req`?
 *   - request must be 'open' (atomic single-winner — the CF re-reads status
 *     inside the transaction, so a second offerer loses).
 *   - the offerer must NOT be the requester (you can't fulfil your own request).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canOffer(req, offererUid) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'open') return { ok: false, reason: 'not-open' };
  if (req.requesterUid && offererUid && req.requesterUid === offererUid) {
    return { ok: false, reason: 'self-offer' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` fulfil (confirm-received) request `req`?
 *   - request must be 'offered'.
 *   - caller must be the requester (peer-confirmed — only the asker knows they
 *     actually got the item).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canFulfill(req, callerUid) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'offered') return { ok: false, reason: 'not-offered' };
  if (!callerUid || req.requesterUid !== callerUid) {
    return { ok: false, reason: 'not-requester' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` cancel request `req`?
 *   - request must still be open or offered (terminal states can't be cancelled).
 *   - caller must be the requester, UNLESS opts.isAdmin (moderation).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canCancel(req, callerUid, opts = {}) {
  if (!req) return { ok: false, reason: 'not-found' };
  if (req.status !== 'open' && req.status !== 'offered') {
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
  VALID_KIND,
  MAX_TITLE_LEN,
  MAX_DETAIL_LEN,
  MAX_NOTE_LEN,
  isValidStatus,
  isValidCategory,
  isValidKind,
  normalizeKind,
  sanitizeTitle,
  sanitizeDetail,
  sanitizeNote,
  canOffer,
  canFulfill,
  canCancel,
};
