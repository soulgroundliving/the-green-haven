/**
 * adminSignChecklist — admin co-signs a submitted checklist.
 *
 * Auth:   admin only.
 * Input:  { instanceId, adminSignaturePath }
 *         adminSignaturePath: Storage path to admin signature PNG
 * Returns: { signed: true }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.adminSignChecklist = functions
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
    const { instanceId, adminSignaturePath } = data || {};

    if (!instanceId || typeof instanceId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'instanceId is required');
    }
    if (!adminSignaturePath || typeof adminSignaturePath !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'adminSignaturePath is required');
    }

    // ── Load instance ──────────────────────────────────────────────────────
    const ref  = firestore.collection('checklistInstances').doc(instanceId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Checklist instance not found');
    }
    const instance = snap.data();

    // ── Status check ──────────────────────────────────────────────────────
    if (instance.status !== 'submitted') {
      throw new functions.https.HttpsError('failed-precondition',
        `Cannot sign — checklist status is '${instance.status}' (expected 'submitted')`);
    }

    // ── Persist ───────────────────────────────────────────────────────────
    await ref.update({
      adminSignaturePath: adminSignaturePath.slice(0, 500),
      adminSignedBy:      context.auth.uid,
      status:             'admin_signed',
      adminSignedAt:      admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ adminSignChecklist: ${instanceId} signed by admin uid=${context.auth.uid}`);
    return { signed: true };
  });
