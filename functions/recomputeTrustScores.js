/**
 * recomputeTrustScores — admin "refresh now" for the Reputation sweep
 * (Roadmap Phase 3.2a v1).
 *
 * Same logic as the daily computeTrustScoresScheduled CF, on demand: the admin
 * dashboard calls this after seeding/editing data (or to verify) instead of
 * waiting for 05:40 BKK. Shares the single orchestration (runTrustScoreSweep)
 * → which shares the pure `_reputation` core, so the number can never diverge
 * between the scheduled and the manual path.
 *
 * §7-NN: an HTTPS callable, NOT a Firestore trigger — project Firestore is in
 * SE3 where Eventarc triggers can't deploy. Auth: admin claim required
 * (context.auth.token.admin === true) — the house gate; trust is admin-only in v1.
 *
 * Region: asia-southeast1 (matches every other CF).
 */

const functions = require('firebase-functions/v1');
const { runTrustScoreSweep } = require('./computeTrustScoresScheduled');

exports.recomputeTrustScores = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if ((context.auth.token || {}).admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin claim required to recompute trust scores');
    }

    try {
      const summary = await runTrustScoreSweep();
      return { ok: true, ...summary };
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      console.error('[recomputeTrustScores] sweep failed:', e && e.message);
      throw new functions.https.HttpsError('internal', 'Failed to recompute trust scores');
    }
  });
