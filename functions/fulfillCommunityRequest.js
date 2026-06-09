/**
 * fulfillCommunityRequest — the REQUESTER confirms they received the item
 * (Meaning Layer #3). Only the asker can mark fulfilled — the offerer can never
 * self-confirm (the same honesty stance as the Helper board #2). An optional
 * thank-you note is passed to the offerer.
 *
 * Unlike the Helper board, NO points move here: the community-requests board is a
 * pure connection / micro-economy board, deliberately outside the #6 Kindness
 * source set (see _communityRequestEngine header) — so there is no balance to
 * update, no ledger, no daily cap, and no farm surface. The transition is just
 * status offered → fulfilled, plus a best-effort LINE thank-you to the offerer.
 *
 * §7-NN callable; LINE reuses the existing LINE_CHANNEL_ACCESS_TOKEN secret
 * (§7-WW-safe). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canFulfill, sanitizeNote } = require('./_communityRequestEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _fulfilledMessage(title, note) {
  let text = `🙏 ขอบคุณสำหรับน้ำใจ!\n\nเพื่อนบ้านยืนยันว่าได้รับ “${title}” แล้ว`;
  if (note) text += `\n“${note}”`;
  return { type: 'text', text };
}

exports.fulfillCommunityRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId, thankNote } = data || {};
    if (!requestId) {
      throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    const callerUid = context.auth.uid;
    const reqRef = firestore.collection('communityRequests').doc(String(requestId));

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
      }
      const req = snap.data() || {};

      const verdict = canFulfill(req, callerUid);
      if (!verdict.ok) {
        if (verdict.reason === 'not-requester') {
          throw new functions.https.HttpsError('permission-denied', 'เฉพาะผู้ขอเท่านั้นที่ยืนยันได้');
        }
        if (verdict.reason === 'not-offered') {
          throw new functions.https.HttpsError('failed-precondition',
            req.status === 'fulfilled' ? 'คำขอนี้เสร็จสิ้นแล้ว' : 'คำขอนี้ยังไม่มีผู้เสนอให้');
        }
        throw new functions.https.HttpsError('failed-precondition', 'ไม่สามารถยืนยันคำขอนี้ได้');
      }

      const cleanNote = sanitizeNote(thankNote) || null;
      tx.update(reqRef, {
        status: 'fulfilled',
        thankNote: cleanNote,
        fulfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        offererBuilding: String(req.offererBuilding || ''),
        offererRoom: String(req.offererRoom || ''),
        title: req.title || '',
        note: cleanNote || '',
      };
    });

    // Best-effort LINE push to the offerer — never fails the confirmation.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.offererBuilding && result.offererRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.offererBuilding, result.offererRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _fulfilledMessage(result.title, result.note),
            token,
            source: 'fulfillCommunityRequest',
            context: { building: result.offererBuilding, roomId: result.offererRoom, requestId },
            idempotencyKeyFn: (userId) => `creq-${requestId}-fulfilled-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('fulfillCommunityRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId) };
  });
