/**
 * _foodShareEngine — pure logic for the Food sharing feed (Meaning Layer #4).
 *
 * A tenant SHARES leftover food ("คืนนี้มีของกินเหลือ") → a neighbour in the SAME
 * building CLAIMS it → the **sharer** earns peer-confirmed kindness points
 * (`pointsLedger source:'food_share'`, feeds #6 Kindness). Unlike the Community
 * board (#3) this DOES award points — food-sharing is a giving act and is in the
 * #6 Kindness source set. Unlike the Helper board (#2) the reward is "light"
 * (FOOD_SHARE_REWARD) with its own modest daily cap, and the lifecycle is
 * share→claim (an OFFER feed) not request→fulfil.
 *
 * Anti-farm: the sharer earns only when a neighbour actually CLAIMS (a fake share
 * nobody claims earns nothing — peer-confirmed, the same stance as #2/#3), and a
 * daily points cap bounds a colluding pair. Shares are EPHEMERAL — every share
 * carries an `expiresAt`; expired-but-unclaimed shares are hidden by the client
 * and swept by cleanupFoodSharesScheduled (§7-NN: a scheduled sweep, not a
 * Firestore trigger).
 *
 * NO I/O. The callables (shareFood / claimFood / cancelFood) read the share doc +
 * the actor's claims, then delegate every decision to these pure functions.
 *
 * Share doc shape (foodShares/{auto-id}):
 * {
 *   sharerUid, sharerTenantId, sharerName, building, room,
 *   title, detail?, category?, portions?,
 *   status: 'available' | 'claimed' | 'cancelled',
 *   claimerUid?, claimerTenantId?, claimerBuilding?, claimerRoom?, claimerName?,
 *   sharerPointsAwarded?,
 *   createdAt, expiresAt, claimedAt?, cancelledAt?, cancelledBy?
 * }
 */

'use strict';

const VALID_STATUS = new Set(['available', 'claimed', 'cancelled']);
const VALID_CATEGORY = new Set(['meal', 'snack', 'fruit', 'drink', 'ingredient', 'other']);

// Owner-tunable. Light, high-frequency kindness signal — deliberately below the
// Helper board's 20 (sharing leftovers is lower-effort than doing a task).
const FOOD_SHARE_REWARD = 10;
// Daily cap on the food-share POINTS a sharer can EARN = 50 = 5 claimed shares.
// Points = money (10pts = ฿1) so this bounds a colluding pair. Beyond the cap the
// share still completes + records the kindness (feeds #6), just awards 0 points.
// Own counter (gamification.foodShareDay/foodShareToday) — decoupled from the #2
// kindness cap for now; a future PR may unify them once #5 lands. Unset/<=0 = uncapped.
const FOOD_SHARE_DAILY_CAP = 50;

const DEFAULT_EXPIRY_HOURS = 24;
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 72;

const MAX_TITLE_LEN = 80;
const MAX_DETAIL_LEN = 500;
const MAX_PORTIONS = 99;

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** category is optional — empty/unset is allowed, a non-empty value must be known. */
function isValidCategory(c) {
  return c == null || c === '' || VALID_CATEGORY.has(c);
}

/** Trim + length-cap a free-text title; returns '' for empty/blank input. */
function sanitizeTitle(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_TITLE_LEN);
}

/** Trim + length-cap optional detail text; returns '' for empty/blank input. */
function sanitizeDetail(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_DETAIL_LEN);
}

/** Optional servings count → integer 1..MAX_PORTIONS, or null for blank/invalid. */
function sanitizePortions(p) {
  const n = Math.floor(Number(p));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, MAX_PORTIONS);
}

/** Clamp a requested expiry-hours to [MIN, MAX]; blank/invalid → DEFAULT. */
function normalizeExpiryHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPIRY_HOURS;
  return Math.max(MIN_EXPIRY_HOURS, Math.min(Math.floor(n), MAX_EXPIRY_HOURS));
}

/** Absolute expiry epoch-ms from a base time + (clamped) hours. */
function computeExpiresAtMs(nowMs, hours) {
  return Number(nowMs) + normalizeExpiryHours(hours) * 3600 * 1000;
}

// expiresAt may be a Firestore Timestamp, a {seconds} shape, or raw epoch-ms.
function _expiryMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Number(ts); return Number.isFinite(n) ? n : 0;
}

/** Is this share past its expiry at `nowMs`? (expired unclaimed shares are hidden + swept) */
function isExpired(share, nowMs) {
  if (!share) return false;
  const exp = _expiryMs(share.expiresAt);
  return exp > 0 && Number(nowMs) >= exp;
}

/**
 * Daily food-share-POINTS cap for a sharer. Returns the award (clamped to the
 * remaining room) and a `capped` flag so the caller can word the LINE push.
 * Same shape as the Helper board's kindnessCapCheck, but its OWN counter fields
 * (decoupled). @returns {{ award, prior, newToday, capped, cap }}
 */
function foodShareCapCheck({ shareDay, shareToday, today, reward, cap }) {
  const capNum = Number(cap);
  const effectiveCap = (Number.isFinite(capNum) && capNum > 0) ? capNum : Infinity;
  const prior = shareDay === today ? (Number(shareToday) || 0) : 0;
  const want = Math.max(0, Number(reward) || 0);
  const award = Math.max(0, Math.min(want, effectiveCap - prior));
  return { award, prior, newToday: prior + award, capped: award <= 0 && want > 0, cap: effectiveCap };
}

/**
 * Can `claimerUid` claim food share `share` at `nowMs`?
 *   - must be 'available' (atomic single-winner — the CF re-reads in a tx),
 *   - must NOT be expired,
 *   - the claimer must NOT be the sharer (you can't claim your own food).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canClaim(share, claimerUid, nowMs) {
  if (!share) return { ok: false, reason: 'not-found' };
  if (share.status !== 'available') return { ok: false, reason: 'not-available' };
  if (isExpired(share, nowMs)) return { ok: false, reason: 'expired' };
  if (share.sharerUid && claimerUid && share.sharerUid === claimerUid) {
    return { ok: false, reason: 'self-claim' };
  }
  return { ok: true };
}

/**
 * Can `callerUid` cancel food share `share`?
 *   - only an 'available' share can be cancelled (a 'claimed' one is terminal —
 *     the claimer is on their way; a 'cancelled' one is already done).
 *   - caller must be the sharer, UNLESS opts.isAdmin (moderation).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canCancel(share, callerUid, opts = {}) {
  if (!share) return { ok: false, reason: 'not-found' };
  if (share.status !== 'available') return { ok: false, reason: 'terminal' };
  if (!opts.isAdmin && (!callerUid || share.sharerUid !== callerUid)) {
    return { ok: false, reason: 'not-sharer' };
  }
  return { ok: true };
}

module.exports = {
  VALID_STATUS,
  VALID_CATEGORY,
  FOOD_SHARE_REWARD,
  FOOD_SHARE_DAILY_CAP,
  DEFAULT_EXPIRY_HOURS,
  MIN_EXPIRY_HOURS,
  MAX_EXPIRY_HOURS,
  MAX_TITLE_LEN,
  MAX_DETAIL_LEN,
  MAX_PORTIONS,
  isValidStatus,
  isValidCategory,
  sanitizeTitle,
  sanitizeDetail,
  sanitizePortions,
  normalizeExpiryHours,
  computeExpiresAtMs,
  isExpired,
  foodShareCapCheck,
  canClaim,
  canCancel,
};
