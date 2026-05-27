/**
 * submitChecklist — tenant submits a completed checklist with filled items.
 *
 * The tenant passes back the filled items array (notes, checked flags) and
 * the Storage path of their e-signature PNG. Photo paths are written directly
 * to Storage by the client; this CF only persists the metadata.
 *
 * Auth:   LIFF tenant (must own the instance via tenantUid).
 * Input:  { instanceId, items, tenantSignaturePath }
 *         items: Array<{ id, note, checked, photoPath }>
 *         tenantSignaturePath: Storage path to signature PNG (non-empty string)
 * Returns: { submitted: true }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.submitChecklist = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth gate ──────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const callerUid = context.auth.uid;

    // ── Input validation ───────────────────────────────────────────────────
    const { instanceId, items, tenantSignaturePath } = data || {};

    if (!instanceId || typeof instanceId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'instanceId is required');
    }
    if (!Array.isArray(items)) {
      throw new functions.https.HttpsError('invalid-argument', 'items must be an array');
    }
    if (!tenantSignaturePath || typeof tenantSignaturePath !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'tenantSignaturePath is required');
    }

    // ── Load instance ──────────────────────────────────────────────────────
    const ref  = firestore.collection('checklistInstances').doc(instanceId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Checklist instance not found');
    }
    const instance = snap.data();

    // ── Ownership check ────────────────────────────────────────────────────
    if (instance.tenantUid !== callerUid) {
      throw new functions.https.HttpsError('permission-denied',
        'You may only submit your own checklist');
    }

    // ── Status check ──────────────────────────────────────────────────────
    if (instance.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition',
        `Cannot submit — checklist is already ${instance.status}`);
    }

    // ── Sanitize + merge items ─────────────────────────────────────────────
    // Accept only fields we expect; ignore extras to prevent field injection.
    const templateItems = Array.isArray(instance.items) ? instance.items : [];
    const itemMap = new Map(items.map(i => [i.id, i]));

    const mergedItems = templateItems.map(tpl => {
      const filled = itemMap.get(tpl.id) || {};
      return {
        id:        tpl.id,
        label:     tpl.label,
        note:      typeof filled.note === 'string' ? filled.note.slice(0, 500) : '',
        checked:   filled.checked === true,
        photoPath: typeof filled.photoPath === 'string' ? filled.photoPath : null,
      };
    });

    // ── Persist ───────────────────────────────────────────────────────────
    await ref.update({
      items:               mergedItems,
      tenantSignaturePath: tenantSignaturePath.slice(0, 500),
      status:              'submitted',
      submittedAt:         admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:           admin.firestore.FieldValue.serverTimestamp(),
    });

    return { submitted: true };
  });
