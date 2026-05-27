/**
 * cleanupPlayersOver1Year — prune player docs after the 1-year grace period.
 *
 * After a tenant's lease ends, `transitionToPlayer` moves their identity and
 * gamification data to `people/{tenantId}`. They retain points for 1 year so
 * they can redeem as former community members. After that year the entire
 * player record (including subcollections: paymentHistory, redemptions,
 * wellnessClaimed, pets, complaintFreeMonthAwarded) is permanently deleted.
 *
 * Uses Admin SDK v12 recursiveDelete so subcollections are handled automatically
 * without manual batching across 5 subcollection types.
 *
 * Schedule: daily 05:00 BKK. Most runs will exit in <1s (0 docs found). The
 * few runs that actually delete docs are bounded by the number of tenants whose
 * 1-year anniversary falls today — historically 0–5 per run.
 *
 * Cost: negligible. Reads only docs where transitionedAt < cutoff; deletes are
 * sub-penny at this scale.
 *
 * Region: asia-southeast1 (same as all other CFs in this project).
 */

'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

async function runCleanupPlayersOver1Year() {
  const cutoff = new Date(Date.now() - ONE_YEAR_MS);
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

  const snap = await firestore
    .collection('people')
    .where('transitionedAt', '<', cutoffTs)
    .get();

  if (snap.empty) {
    console.info('✅ cleanupPlayersOver1Year: no expired players found');
    return { scanned: 0, deleted: 0 };
  }

  console.info(`🧹 cleanupPlayersOver1Year: ${snap.size} expired player(s) to purge`);

  let deleted = 0;
  const errors = [];

  for (const doc of snap.docs) {
    const transitionedAt = doc.data().transitionedAt?.toDate?.().toISOString() ?? 'unknown';
    try {
      await firestore.recursiveDelete(doc.ref);
      console.info(`  ✅ purged ${doc.id} (transitionedAt: ${transitionedAt})`);
      deleted++;
    } catch (e) {
      console.error(`  ❌ failed to purge ${doc.id}:`, e.message);
      errors.push({ id: doc.id, error: e.message });
    }
  }

  if (errors.length > 0) {
    console.warn('cleanupPlayersOver1Year: some deletions failed:', JSON.stringify(errors));
  }

  return { scanned: snap.size, deleted, errors: errors.length };
}

exports.cleanupPlayersOver1YearScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('0 5 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try {
      const result = await runCleanupPlayersOver1Year();
      console.info('✅ cleanupPlayersOver1Year finished:', JSON.stringify(result));
      return result;
    } catch (e) {
      console.error('cleanupPlayersOver1Year failed:', e);
      throw e;
    }
  });

// Exported for unit tests (jest can call runCleanupPlayersOver1Year directly).
exports._runCleanupPlayersOver1Year = runCleanupPlayersOver1Year;
