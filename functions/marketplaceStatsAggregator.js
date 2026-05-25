/**
 * marketplaceStatsAggregator — Sprint 6 (Trophies & Badges)
 *
 * Bumps per-owner marketplace counters when a post completes, then
 * evaluates the 3 event-based badges (The Giver / Sky Walker / Pet
 * Whisperer) and writes any newly-earned to gamification.badges.
 *
 * Why HTTPS callable (not Firestore trigger):
 *   Per CLAUDE.md §7-NN, Firestore lives in asia-southeast3 (Jakarta)
 *   and Eventarc does NOT support that region — Gen1/Gen2 Firestore
 *   triggers fail to deploy with "Resource ... is in region
 *   asia-southeast3 which is not supported". Same pattern as
 *   notifyMarketplaceChat + cleanupMarketplaceChat: client invokes
 *   this callable after setDoc({ status: 'COMPLETED' }) lands.
 *
 * Auth: caller must be EITHER:
 *   - admin (custom claim admin:true), OR
 *   - the post's ownerUid (matches request.auth.uid).
 *
 * Call signature:
 *   httpsCallable('marketplaceStatsAggregator')({ postId: '<id>' })
 *   Returns { statsBumped: {...}, badgesAwarded: N, newBadges: [...] }
 *
 * Idempotency:
 *   gamification.marketplaceLedger[postId] = ISO timestamp. Existence
 *   of the postId key in the ledger = already counted. The increment
 *   + ledger entry happen inside one Firestore transaction so a
 *   concurrent re-fire (or double-click of "ปิดประกาศ") cannot
 *   double-count. Subsequent calls are no-ops.
 *
 * Storage target (mirrors checkAndAwardBadges precedent):
 *   - Active tenant path: post has both `building` AND `room`  →
 *     tenants/{building}/list/{room}.gamification.*
 *   - Player path:        post has only `tenantId`            →
 *     people/{tenantId}.gamification.*
 *   - Posts missing all three: no-op (stats unattributable).
 *
 * Deploy: firebase deploy --only functions:marketplaceStatsAggregator
 *
 * Sprint 6 — Trophies & Badges (Nest Marketplace Spec v1.0 §4.3 /
 * tasks/todo.md §S6).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'asia-southeast1';

// Imported from the SSoT at deploy time (see firebase.json predeploy +
// functions/package.json "sync-shared"). Keeps catalog single-source so
// adding a 4th marketplace badge later only touches the shared file.
const { BADGE_CATALOG, badgeId, normaliseBadges } = require('./gamification-rules');

/**
 * Returns the subset of BADGE_CATALOG that is marketplace-event-based.
 * Each entry carries { id, emoji, label, marketplace: '<statKey>', minCount }.
 */
function _marketplaceBadgeDefs() {
  return BADGE_CATALOG.filter(c => typeof c.marketplace === 'string' && typeof c.minCount === 'number');
}

/**
 * Pure aggregation logic — extracted so unit tests can exercise it
 * without spinning up the callable wrapper. Treats `firestore` as an
 * injected dependency exposing the standard Admin Firestore surface.
 */
async function _runAggregator({ firestore, postId, callerUid, isAdmin, FieldValue }) {
  if (!postId || typeof postId !== 'string') {
    throw new HttpsError('invalid-argument', 'postId is required');
  }

  // 1. Resolve the post + verify ownership / completion.
  const postRef = firestore.collection('marketplace').doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    throw new HttpsError('not-found', 'Post not found');
  }
  const post = postSnap.data() || {};

  if (!isAdmin && post.ownerUid !== callerUid) {
    throw new HttpsError('permission-denied', 'Not authorized to aggregate stats for this post');
  }

  // Only completed posts count toward badges. Re-opening a closed post
  // (Sprint-1 re-open feature) flips status back to AVAILABLE; the
  // ledger entry from the prior close stays, so re-completing does not
  // double-count.
  if (post.status !== 'COMPLETED') {
    return { statsBumped: {}, badgesAwarded: 0, newBadges: [], skipped: 'post-not-completed' };
  }

  // 2. Pick the gamification doc to update (active-tenant vs player).
  const { building, room, tenantId } = post;
  let target;
  if (building && room) {
    target = firestore.collection('tenants').doc(String(building))
      .collection('list').doc(String(room));
  } else if (tenantId) {
    target = firestore.collection('people').doc(String(tenantId));
  } else {
    return { statsBumped: {}, badgesAwarded: 0, newBadges: [], skipped: 'no-target' };
  }

  // 3. Build the increment payload from the post's category + flags.
  // Order matches BADGE_CATALOG marketplace keys; missing flags = no
  // increment (so an item post with neither sky-hook nor pet contributes
  // nothing — that's intentional).
  const statsBumped = {};
  if (post.category === 'free')   statsBumped.freeGiven        = 1;
  if (post.skyHookReady === true) statsBumped.skyHookCompleted = 1;
  if (post.isPetCategory === true) statsBumped.petHelped       = 1;

  // Even an item post can complete with no relevant flags — that's a
  // valid no-op (we still write the ledger entry so future re-fires
  // remain idempotent? — NO: writing a no-op ledger entry would lock
  // out future legitimate completions of the same ID; we just return).
  if (Object.keys(statsBumped).length === 0) {
    return { statsBumped: {}, badgesAwarded: 0, newBadges: [], skipped: 'no-stats-eligible' };
  }

  const now = new Date().toISOString();

  // 4. Transaction: check the ledger, increment counters, mark ledger.
  // The transaction returns whether THIS call performed the write —
  // critical for telling "I counted it" vs "a prior call counted it".
  // (A post-hoc ledger-read would always show 'has the entry' once
  // either call has succeeded.)
  const counted = await firestore.runTransaction(async (tx) => {
    const fresh = await tx.get(target);
    const data = fresh.exists ? fresh.data() : {};
    const ledger = (data.gamification && data.gamification.marketplaceLedger) || {};
    if (ledger[postId]) {
      // Already counted — short-circuit the transaction.
      return false;
    }
    const patch = {
      [`gamification.marketplaceLedger.${postId}`]: now
    };
    for (const [statKey, delta] of Object.entries(statsBumped)) {
      patch[`gamification.marketplaceStats.${statKey}`] = FieldValue.increment(delta);
    }
    // Use set+merge so we don't fail if the target doc doesn't exist
    // yet (player path can be first-write).
    tx.set(target, _expandDotKeys(patch), { merge: true });
    return true;
  });

  if (!counted) {
    return { statsBumped: {}, badgesAwarded: 0, newBadges: [], skipped: 'already-counted' };
  }

  // 5. Re-read the doc OUTSIDE the transaction to evaluate badges.
  // (Could be done inside but the SET via FieldValue.increment doesn't
  // make the new values available to the transaction's read snapshot —
  // we'd be checking the pre-increment counts.)
  const finalSnap = await target.get();
  const finalData = finalSnap.exists ? finalSnap.data() : {};
  const finalGam = finalData.gamification || {};
  const finalStats = finalGam.marketplaceStats || {};
  const rawBadges = finalGam.badges || [];
  const normalised = normaliseBadges(rawBadges, now);
  const earnedIds = new Set(normalised.map(badgeId));

  const toAward = _marketplaceBadgeDefs()
    .filter(def => !earnedIds.has(def.id) && (Number(finalStats[def.marketplace]) || 0) >= def.minCount)
    .map(def => ({ id: def.id, emoji: def.emoji, label: def.label, earnedAt: now }));

  if (toAward.length > 0) {
    await target.update({
      'gamification.badges': [...normalised, ...toAward]
    });
    toAward.forEach(b => console.log(`🎖️ marketplaceStatsAggregator awarded "${b.label}" (post ${postId})`));
  }

  return {
    statsBumped,
    badgesAwarded: toAward.length,
    newBadges: toAward,
    skipped: null
  };
}
exports._runAggregator = _runAggregator;

/**
 * Convert dot-notation keys to nested objects for setDoc(merge:true) —
 * Firestore Admin's `tx.set(ref, {...}, { merge: true })` does NOT
 * interpret dot-keys as nested paths (that's `update()`-only, per
 * §7-OO). Build the nested shape ourselves so the merge lands on the
 * intended sub-paths.
 *
 * Carefully preserves FieldValue sentinels (increment, serverTimestamp)
 * by passing them through unchanged.
 */
function _expandDotKeys(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}
exports._expandDotKeys = _expandDotKeys;

exports.marketplaceStatsAggregator = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const callerUid = request.auth.uid;
    const isAdmin = request.auth.token && request.auth.token.admin === true;
    const postId = request.data && request.data.postId;
    try {
      return await _runAggregator({
        firestore: admin.firestore(),
        postId,
        callerUid,
        isAdmin,
        FieldValue: admin.firestore.FieldValue,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('marketplaceStatsAggregator error:', err);
      throw new HttpsError('internal', err.message || 'aggregation failed');
    }
  }
);
