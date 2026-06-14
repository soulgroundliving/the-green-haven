/**
 * cancelCaretakerRequest — the requester cancels their own pet-sitting request,
 * or an admin cancels an abusive one (Meaning Layer #14 · the admin-monitor
 * moderation action). Allowed only from a non-terminal state (open | accepted);
 * done / already-cancelled requests are immutable. No points move on cancel.
 *
 * §7-NN callable. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { canCancel } = require('./_caretakerEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.cancelCaretakerRequest = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { requestId } = data || {};
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
  }
  const callerUid = context.auth.uid;
  const isAdmin = (context.auth.token || {}).admin === true;
  const reqRef = firestore.collection('caretakerRequests').doc(String(requestId));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
    }
    const req = snap.data() || {};

    const verdict = canCancel(req, callerUid, { isAdmin });
    if (!verdict.ok) {
      if (verdict.reason === 'terminal') {
        throw new functions.https.HttpsError('failed-precondition', 'คำขอนี้สิ้นสุดแล้ว');
      }
      throw new functions.https.HttpsError('permission-denied', 'เฉพาะเจ้าของเท่านั้นที่ยกเลิกได้');
    }

    tx.update(reqRef, {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: isAdmin && req.requesterUid !== callerUid ? 'admin' : 'requester',
    });
    return { success: true, requestId: String(requestId) };
  });
});
