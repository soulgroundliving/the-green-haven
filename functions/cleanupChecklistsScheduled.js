/**
 * cleanupChecklistsScheduled — PDPA retention sweep for checklistInstances.
 *
 * Schedule: daily 03:05 BKK (slots between cleanupOldDocs runs at 04:00 and
 * other ops; quiet hour so it never collides with admin activity).
 *
 * Why this exists:
 *   PDPA (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล 2562) requires data is kept only
 *   as long as the original purpose requires. Checklist photos + signatures
 *   are personal data — once the lease ends and the dispute window passes,
 *   keeping them risks both PDPA non-compliance AND Storage cost bloat.
 *
 *   Civil Code §193/34: rent claims expire in 5 years. Move-OUT instances
 *   are the artifact of the move-out event, so a 2-year hold after admin
 *   sign-off comfortably covers any deposit-deduction or condition-dispute
 *   claim while staying well under the PDPA "necessary" threshold.
 *
 *   Move-IN instances stay relevant for the entire lease. Without a lease
 *   pointer on the instance we can't precisely know lease end, but no
 *   commercial lease in this project goes beyond 24 months — a 5-year
 *   floor on `createdAt` makes them safely orphan beyond any active lease.
 *
 * Cleanup criteria (delete if ANY match):
 *   1. status==='admin_signed' AND adminSignedAt < now - 2 years
 *      (workflow finished, both parties signed off, dispute window closed)
 *   2. createdAt < now - 5 years
 *      (catches pending/submitted instances that were never signed —
 *       longer than any realistic lease duration in this project)
 *
 * Cleanup steps per matched instance:
 *   a. Delete every file under storage://checklists/{building}/{roomId}/{instanceId}/
 *      (item photos + tenant signature + admin signature)
 *   b. Delete the Firestore doc
 *
 * Errors are best-effort per-instance — one bad doc shouldn't block the rest.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const SIGNED_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;  // 2 years after admin sign-off
const ORPHAN_RETENTION_MS = 5 * 365 * 24 * 60 * 60 * 1000;  // 5 years from createdAt (orphan floor)
const BATCH_PAGE_SIZE = 200;                                // Firestore doc page per query

async function _deleteStoragePrefix(prefix) {
  try {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
    return files.length;
  } catch (err) {
    console.warn(`[cleanupChecklistsScheduled] storage cleanup failed for ${prefix}:`, err.message || err);
    return 0;
  }
}

async function _cleanupBatch(query, label, results) {
  const snap = await query.get();
  if (snap.empty) return;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const { building, roomId } = d;
    let storageDeleted = 0;
    if (building && roomId) {
      storageDeleted = await _deleteStoragePrefix(`checklists/${building}/${roomId}/${doc.id}/`);
    }
    try {
      await doc.ref.delete();
      results.deletedDocs++;
      results.deletedFiles += storageDeleted;
    } catch (err) {
      results.errors.push({ instanceId: doc.id, error: err.message });
      console.warn(`[cleanupChecklistsScheduled] doc delete failed ${doc.id}:`, err.message);
    }
  }
}

async function _run() {
  const now = Date.now();
  const signedCutoff = admin.firestore.Timestamp.fromMillis(now - SIGNED_RETENTION_MS);
  const orphanCutoff = admin.firestore.Timestamp.fromMillis(now - ORPHAN_RETENTION_MS);

  const results = { deletedDocs: 0, deletedFiles: 0, errors: [] };

  // 1. admin_signed instances older than 2 years
  await _cleanupBatch(
    firestore.collection('checklistInstances')
      .where('status', '==', 'admin_signed')
      .where('adminSignedAt', '<', signedCutoff)
      .limit(BATCH_PAGE_SIZE),
    'signed>2y',
    results,
  );

  // 2. ANY instance older than 5 years (catches orphans)
  await _cleanupBatch(
    firestore.collection('checklistInstances')
      .where('createdAt', '<', orphanCutoff)
      .limit(BATCH_PAGE_SIZE),
    'orphan>5y',
    results,
  );

  return results;
}

exports.cleanupChecklistsScheduled = functions
  .region('asia-southeast1')
  .pubsub.schedule('5 3 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try { await _run(); }
    catch (err) { console.error('cleanupChecklistsScheduled failed:', err.message); throw err; }
    return null;
  });

// Manual trigger for ops (admin-only HTTP callable; useful for one-off backfills
// and for tests to exercise the same code path without waiting for the cron).
exports.cleanupChecklistsManual = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    if (context.auth.token?.admin !== true) throw new functions.https.HttpsError('permission-denied', 'Admin only');
    return await _run();
  });

// Exported for unit tests
exports._run = _run;
exports.SIGNED_RETENTION_MS = SIGNED_RETENTION_MS;
exports.ORPHAN_RETENTION_MS = ORPHAN_RETENTION_MS;
