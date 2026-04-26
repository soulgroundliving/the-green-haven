/**
 * LINE push retry queue helper.
 *
 * Why: the LINE Messaging API can fail intermittently (network blip, 5xx,
 * rate limit). Without a retry queue, the failed message is lost forever:
 * Promise.allSettled in the caller catches the rejection but doesn't
 * re-attempt, so the tenant never gets the bill / late-payment / lease
 * notification they were supposed to.
 *
 * Pattern:
 *   1. Original CF tries to push immediately.
 *   2. On failure, calls enqueueLineRetry() with the user, message, and
 *      a context blob (for later debugging).
 *   3. processLineRetryQueue (scheduled every 15 min) drains the queue
 *      with exponential backoff, abandoning after MAX_ATTEMPTS.
 *
 * Storage: Firestore lineRetryQueue/{idempotencyKey} — keyed so the same
 * underlying event (same bill/reminder/etc) only enqueues once even if
 * the parent CF itself retries.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

async function enqueueLineRetry({ lineUserId, message, context, idempotencyKey, error }) {
  if (!lineUserId || !message) {
    console.warn('enqueueLineRetry: missing lineUserId or message');
    return;
  }
  const db = admin.firestore();
  const docId = idempotencyKey || `${lineUserId}-${Date.now()}`;
  // First attempt fires 5 min out so transient blips have time to clear.
  const nextAttemptAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  try {
    await db.collection('lineRetryQueue').doc(docId).set({
      lineUserId,
      message,
      context: context || {},
      firstFailureAt: new Date().toISOString(),
      nextAttemptAt,
      attempts: 0,
      lastError: String(error || '').slice(0, 500),
      status: 'pending'
    }, { merge: false });
  } catch (e) {
    // If we can't even enqueue, the message is truly lost. Log loudly.
    console.error('❌ enqueueLineRetry failed — message permanently lost:', e, { lineUserId, context });
  }
}

module.exports = { enqueueLineRetry };
