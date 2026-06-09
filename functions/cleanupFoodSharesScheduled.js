/**
 * cleanupFoodSharesScheduled — housekeeping sweep for the ephemeral food-share
 * feed (Meaning Layer #4). The client already HIDES expired shares; this just
 * keeps the `foodShares` collection from growing unbounded.
 *
 * Schedule: daily 03:20 BKK (quiet hour; slots near the other cleanup sweeps).
 *
 * Sweep: delete every share whose `expiresAt` passed more than GRACE_MS ago.
 * Because a CLAIMED share keeps its ORIGINAL expiresAt, this one single-field
 * query (`expiresAt < cutoff`) sweeps available-expired AND claimed/cancelled
 * shares once their lifetime is over — so NO composite index is needed (§7-N).
 *
 * An expired share may carry an optional photo at storage://foodShares/{id}/ —
 * deleted alongside the doc so the ephemeral feed never leaks orphan images
 * (Storage cost + PDPA; §7-DD analogue for Storage, mirror of cleanupChecklists).
 *
 * §7-NN: a scheduled sweep, NOT a Firestore trigger (Eventarc can't watch SE3).
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { deleteFoodImagesForShare } = require('./_foodImage');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const GRACE_MS = 24 * 60 * 60 * 1000;   // delete a share 24h after its expiry (covers all statuses)
const BATCH_PAGE_SIZE = 300;

async function _deleteBatch(query, results) {
  const snap = await query.get();
  if (snap.empty) return 0;
  for (const doc of snap.docs) {
    // Delete the optional Storage photo first (best-effort; the doc delete below
    // is the canonical step). Only shares that actually have an image pay the
    // getFiles round-trip.
    const d = doc.data() || {};
    if (d.imagePath || d.imageUrl) {
      results.deletedFiles += await deleteFoodImagesForShare(doc.id);
    }
    try {
      await doc.ref.delete();
      results.deleted++;
    } catch (err) {
      results.errors.push({ id: doc.id, error: err.message });
      console.warn('[cleanupFoodSharesScheduled] delete failed', doc.id, err.message);
    }
  }
  return snap.size;
}

async function _run() {
  const now = Date.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(now - GRACE_MS);
  const results = { deleted: 0, deletedFiles: 0, errors: [] };
  // Page through expired shares (single-field inequality → auto-indexed).
  let swept;
  do {
    swept = await _deleteBatch(
      firestore.collection('foodShares')
        .where('expiresAt', '<', cutoff)
        .limit(BATCH_PAGE_SIZE),
      results,
    );
  } while (swept === BATCH_PAGE_SIZE);
  return results;
}

exports.cleanupFoodSharesScheduled = functions
  .region('asia-southeast1')
  .pubsub.schedule('20 3 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { await _run(); }
    catch (err) { console.error('cleanupFoodSharesScheduled failed:', err.message); throw err; }
    return null;
  });

// Manual trigger for ops (admin-only; also lets tests exercise the same path).
exports.cleanupFoodSharesManual = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    if (context.auth.token?.admin !== true) throw new functions.https.HttpsError('permission-denied', 'Admin only');
    return await _run();
  });

// Exported for unit tests
exports._run = _run;
exports.GRACE_MS = GRACE_MS;
