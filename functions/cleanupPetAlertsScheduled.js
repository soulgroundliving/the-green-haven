/**
 * cleanupPetAlertsScheduled — housekeeping sweep for the ephemeral Lost Pet
 * Alert feed (Meaning Layer #13). The client already HIDES expired/resolved
 * alerts (status + expiresAt > now); this just keeps the `petAlerts` collection
 * from growing unbounded once an alert's lifetime is over.
 *
 * Schedule: daily 03:30 BKK (quiet hour; slots between the other cleanup sweeps —
 * foodShares 03:20, playdates 03:40).
 *
 * Sweep: delete every alert whose `expiresAt` passed more than GRACE_MS ago.
 * A resolved/expired alert keeps its ORIGINAL expiresAt, so this ONE single-field
 * query (`expiresAt < cutoff`) sweeps active-expired AND resolved alerts once
 * their lifetime is over — NO composite index needed (§7-N).
 *
 * No Storage cleanup: a petAlert only ever stores a COPIED pet photo URL from the
 * registry (raisePetAlert never uploads its own object), so there is no orphan
 * Storage object to delete — unlike foodShares (§7-DD analogue does not apply).
 *
 * §7-NN: a scheduled sweep, NOT a Firestore trigger (Eventarc can't watch SE3).
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const GRACE_MS = 24 * 60 * 60 * 1000;   // delete an alert 24h after its expiry
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
      console.warn('[cleanupPetAlertsScheduled] delete failed', doc.id, err.message);
    }
  }
  return snap.size;
}

async function _run() {
  const now = Date.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(now - GRACE_MS);
  const results = { deleted: 0, errors: [] };
  // Page through expired alerts (single-field inequality → auto-indexed).
  let swept;
  do {
    swept = await _deleteBatch(
      firestore.collection('petAlerts')
        .where('expiresAt', '<', cutoff)
        .limit(BATCH_PAGE_SIZE),
      results,
    );
  } while (swept === BATCH_PAGE_SIZE);
  return results;
}

exports.cleanupPetAlertsScheduled = functions
  .region('asia-southeast1')
  .pubsub.schedule('30 3 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { await _run(); }
    catch (err) { console.error('cleanupPetAlertsScheduled failed:', err.message); throw err; }
    return null;
  });

// Manual trigger for ops (admin-only; also lets tests exercise the same path).
exports.cleanupPetAlertsManual = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    if (context.auth.token?.admin !== true) throw new functions.https.HttpsError('permission-denied', 'Admin only');
    return await _run();
  });

// Exported for unit tests
exports._run = _run;
exports.GRACE_MS = GRACE_MS;
