/**
 * cleanupPetPlaydatesScheduled — housekeeping sweep for the ephemeral Pet
 * Playdate slots (Meaning Layer #11). The client already HIDES past playdates
 * (status + time); this just keeps the `petPlaydates` collection from growing
 * unbounded once a slot's lifetime is over.
 *
 * Schedule: daily 03:40 BKK (quiet hour; after foodShares 03:20 + petAlerts 03:30).
 *
 * Sweep: delete every playdate whose `expiresAt` passed more than GRACE_MS ago.
 * createPetPlaydate stamps `expiresAt = endAt + 24h grace`; a cancelled/closed
 * playdate keeps that ORIGINAL expiresAt, so this ONE single-field query
 * (`expiresAt < cutoff`) sweeps open-expired AND cancelled slots once their
 * lifetime is over — NO composite index needed (§7-N).
 *
 * No Storage cleanup: a petPlaydate stores only attendee SNAPSHOTS (name + type
 * emoji copied from the registry), never its own uploaded object — no orphan
 * Storage to delete.
 *
 * §7-NN: a scheduled sweep, NOT a Firestore trigger (Eventarc can't watch SE3).
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const GRACE_MS = 24 * 60 * 60 * 1000;   // delete a playdate 24h after its (already-graced) expiry
const BATCH_PAGE_SIZE = 300;

async function _deleteBatch(query, results) {
  const snap = await query.get();
  if (snap.empty) return 0;
  for (const doc of snap.docs) {
    try {
      await doc.ref.delete();
      results.deleted++;
    } catch (err) {
      results.errors.push({ id: doc.id, error: err.message });
      console.warn('[cleanupPetPlaydatesScheduled] delete failed', doc.id, err.message);
    }
  }
  return snap.size;
}

async function _run() {
  const now = Date.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(now - GRACE_MS);
  const results = { deleted: 0, errors: [] };
  // Page through expired playdates (single-field inequality → auto-indexed).
  let swept;
  do {
    swept = await _deleteBatch(
      firestore.collection('petPlaydates')
        .where('expiresAt', '<', cutoff)
        .limit(BATCH_PAGE_SIZE),
      results,
    );
  } while (swept === BATCH_PAGE_SIZE);
  return results;
}

exports.cleanupPetPlaydatesScheduled = functions
  .region('asia-southeast1')
  .pubsub.schedule('40 3 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { await _run(); }
    catch (err) { console.error('cleanupPetPlaydatesScheduled failed:', err.message); throw err; }
    return null;
  });

// Manual trigger for ops (admin-only; also lets tests exercise the same path).
exports.cleanupPetPlaydatesManual = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    if (context.auth.token?.admin !== true) throw new functions.https.HttpsError('permission-denied', 'Admin only');
    return await _run();
  });

// Exported for unit tests
exports._run = _run;
exports.GRACE_MS = GRACE_MS;
