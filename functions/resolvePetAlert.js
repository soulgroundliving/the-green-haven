/**
 * resolvePetAlert — the owner taps "✅ เจอแล้ว" to close a Lost Pet Alert
 * (Meaning Layer #13). Flips petAlerts/{alertId} active → resolved + resolvedAt.
 * No relief-push in v1 (D5). After this the client stops showing the card.
 *
 * Auth: caller must be the registered tenant of {building, roomId} AND the OWNER
 * of the alert (alert.ownerRoom === room — the recipient/owner-only guard, mirror
 * of the petLinks recipientRoom guard). An admin (token.admin === true) may also
 * resolve any alert for moderation. The atomic active→resolved transition is
 * re-checked inside a transaction (single-winner).
 *
 * §7-NN callable. Region asia-southeast1. No points, no secret.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { canResolveAlert } = require('./_petAlertEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.resolvePetAlert = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, alertId } = data || {};
    if (!building || !roomId || !alertId) {
      throw new functions.https.HttpsError('invalid-argument', 'building, roomId and alertId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    const room = String(roomId);
    const isAdmin = context.auth.token && context.auth.token.admin === true;

    // Auth: caller must be the tenant of this room (admins skip via the helper's
    // admin path). The owner-only / building checks happen in canResolveAlert below.
    await assertTenantAccess({
      building: canonicalBuilding,
      roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const ref = firestore.collection('petAlerts').doc(String(alertId));

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบประกาศนี้');
      }
      const alert = snap.data() || {};

      // Admin may resolve any active alert (moderation); otherwise the owner-only +
      // active + same-building guard applies (re-checked in-tx → atomic single-winner).
      if (!isAdmin) {
        const decision = canResolveAlert(alert, canonicalBuilding, room);
        if (!decision.ok) {
          const MSG = {
            'not-found': 'ไม่พบประกาศนี้',
            'not-active': 'ประกาศนี้ถูกปิดไปแล้ว',
            'cross-building': 'ไม่มีสิทธิ์ปิดประกาศนี้',
            'not-owner': 'เฉพาะเจ้าของน้องเท่านั้นที่ปิดประกาศได้',
          };
          throw new functions.https.HttpsError('permission-denied', MSG[decision.reason] || 'ไม่มีสิทธิ์ปิดประกาศนี้');
        }
      } else if (alert.status !== 'active') {
        throw new functions.https.HttpsError('failed-precondition', 'ประกาศนี้ถูกปิดไปแล้ว');
      }

      tx.update(ref, {
        status: 'resolved',
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { success: true, alertId: String(alertId), status: 'resolved' };
  });
