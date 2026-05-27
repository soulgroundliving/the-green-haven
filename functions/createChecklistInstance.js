/**
 * createChecklistInstance — admin creates a move-in or move-out checklist
 * instance for a specific room/tenant from the building's template.
 *
 * Auth:   admin only.
 * Input:  { building, roomId, tenantUid, tenantRoom, tenantName, type }
 *         type: 'move_in' | 'move_out'
 * Returns: { instanceId }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_TYPES = new Set(['move_in', 'move_out']);

exports.createChecklistInstance = functions
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
    const { building, roomId, tenantUid, tenantRoom, tenantName, type } = data || {};

    if (!building || typeof building !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'building is required');
    }
    if (!roomId || typeof roomId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'roomId is required');
    }
    if (!tenantUid || typeof tenantUid !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'tenantUid is required');
    }
    if (!VALID_TYPES.has(type)) {
      throw new functions.https.HttpsError('invalid-argument', `type must be 'move_in' or 'move_out'`);
    }

    // ── Load template ──────────────────────────────────────────────────────
    const templateSnap = await firestore.collection('checklistTemplates').doc(building).get();
    if (!templateSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `No checklist template found for building: ${building}`);
    }
    const template = templateSnap.data();
    const templateItems = Array.isArray(template.items) ? template.items : [];

    if (!templateItems.length) {
      throw new functions.https.HttpsError('failed-precondition',
        'Template has no items — add items to the template first');
    }

    // ── Build instance items (copy template, reset fill state) ────────────
    const items = templateItems.map((item, idx) => ({
      id:        item.id || String(idx),
      label:     item.label || '',
      note:      '',
      photoPath: null,
      checked:   false,
    }));

    // ── Create instance ────────────────────────────────────────────────────
    const ref = firestore.collection('checklistInstances').doc();
    const instanceId = ref.id;

    await ref.set({
      instanceId,
      building,
      roomId,
      tenantUid,
      tenantRoom:  tenantRoom  || roomId,
      tenantName:  tenantName  || '',
      type,
      status:      'pending',   // pending → submitted → admin_signed
      items,
      tenantSignaturePath: null,
      adminSignaturePath:  null,
      adminSignedBy:       null,
      createdBy:   context.auth.uid,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
      submittedAt: null,
      adminSignedAt: null,
    });

    console.info(`✅ createChecklistInstance: ${instanceId} ${building}/${roomId} type=${type} uid=${tenantUid}`);
    return { instanceId };
  });
