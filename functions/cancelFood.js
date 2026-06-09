/**
 * cancelFood — the sharer takes down their own AVAILABLE food share, or an admin
 * removes an abusive one (Meaning Layer #4 · the admin-monitor moderation action).
 * Allowed only from 'available' (a 'claimed' share is terminal — the claimer is on
 * their way; a 'cancelled' one is already done). No points move.
 *
 * §7-NN callable. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { canCancel } = require('./_foodShareEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.cancelFood = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { shareId } = data || {};
  if (!shareId) {
    throw new functions.https.HttpsError('invalid-argument', 'shareId is required');
  }
  const callerUid = context.auth.uid;
  const isAdmin = (context.auth.token || {}).admin === true;
  const shareRef = firestore.collection('foodShares').doc(String(shareId));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(shareRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบรายการนี้');
    }
    const share = snap.data() || {};

    const verdict = canCancel(share, callerUid, { isAdmin });
    if (!verdict.ok) {
      if (verdict.reason === 'terminal') {
        throw new functions.https.HttpsError('failed-precondition', 'รายการนี้สิ้นสุดแล้ว');
      }
      throw new functions.https.HttpsError('permission-denied', 'เฉพาะผู้แบ่งปันเท่านั้นที่ยกเลิกได้');
    }

    tx.update(shareRef, {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: isAdmin && share.sharerUid !== callerUid ? 'admin' : 'sharer',
    });
    return { success: true, shareId: String(shareId) };
  });
});
