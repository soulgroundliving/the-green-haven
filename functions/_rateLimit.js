/**
 * Shared Firestore-backed rate limiter for Cloud Functions.
 *
 * Uses rateLimits/{uid}_{action} docs (client-blocked in firestore.rules).
 * Each doc tracks a sliding-window counter. The window resets after
 * windowSeconds elapses since the window opened.
 *
 * Usage:
 *   const { checkRateLimit } = require('./_rateLimit');
 *   await checkRateLimit(context.auth.uid, 'redeemReward', 5, 86400);
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

const firestore = admin.firestore();

/**
 * Enforce a rate limit. Throws HttpsError 'resource-exhausted' if over limit.
 *
 * @param {string} uid          - Firebase UID of the caller
 * @param {string} action       - unique action name (e.g. 'redeemReward')
 * @param {number} maxCalls     - max allowed calls within the window
 * @param {number} windowSeconds - window size in seconds
 */
async function checkRateLimit(uid, action, maxCalls, windowSeconds) {
  const key = `${uid}_${action}`;
  const ref = firestore.collection('rateLimits').doc(key);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { count: 1, windowStart: now, action, uid });
      return;
    }
    const { count, windowStart } = snap.data();
    if (now - windowStart > windowMs) {
      tx.update(ref, { count: 1, windowStart: now });
      return;
    }
    if (count >= maxCalls) {
      const retryAfterSec = Math.ceil((windowStart + windowMs - now) / 1000);
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Rate limit: max ${maxCalls} per ${Math.round(windowSeconds / 3600)}h. Retry in ${retryAfterSec}s.`
      );
    }
    tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
  });
}

module.exports = { checkRateLimit };
