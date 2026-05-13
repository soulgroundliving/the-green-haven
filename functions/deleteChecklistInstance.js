/**
 * deleteChecklistInstance — admin deletes a checklist instance and its
 * associated Storage assets (item photos + tenant/admin signatures).
 *
 * Auth:   admin only.
 * Input:  { instanceId }
 * Returns: { deleted: true, storageFilesDeleted: number }
 *
 * Storage cleanup uses bucket.deleteFiles({ prefix }) so any file under
 * `checklists/{building}/{roomId}/{instanceId}/...` is wiped — including
 * future item types we haven't formalized yet.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.deleteChecklistInstance = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth gate ──────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token?.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    // ── Input validation ───────────────────────────────────────────────────
    const { instanceId } = data || {};
    if (!instanceId || typeof instanceId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'instanceId is required');
    }

    // ── Load instance (need building+roomId for Storage prefix) ───────────
    const ref  = firestore.collection('checklistInstances').doc(instanceId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Checklist instance not found');
    }
    const inst = snap.data();
    const { building, roomId } = inst;

    // ── Wipe Storage prefix (item photos + signatures) ────────────────────
    let storageFilesDeleted = 0;
    if (building && roomId) {
      const prefix = `checklists/${building}/${roomId}/${instanceId}/`;
      try {
        const bucket = admin.storage().bucket();
        const [files] = await bucket.getFiles({ prefix });
        storageFilesDeleted = files.length;
        if (files.length) {
          await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
        }
      } catch (err) {
        // Storage cleanup is best-effort — log but don't block the doc delete
        console.warn(`[deleteChecklistInstance] storage cleanup failed for ${prefix}:`, err.message || err);
      }
    }

    // ── Delete the Firestore doc ──────────────────────────────────────────
    await ref.delete();

    console.log(`✅ deleteChecklistInstance: ${instanceId} (${building}/${roomId}) — storage files removed: ${storageFilesDeleted}`);
    return { deleted: true, storageFilesDeleted };
  });
