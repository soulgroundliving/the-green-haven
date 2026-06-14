/**
 * completeCaretakerRequest — the REQUESTER (the pet owner) confirms the care is
 * done (Meaning Layer #14). This is the peer-confirmed transition: only the
 * helped party can mark done, so the caretaker can never self-mark (§6 "never
 * self-claim"; mirrors the #2 completeHelpRequest stance).
 *
 * D2 (point-free v1): completing awards NO spendable points — caretaking is its
 * own reward (care + neighbourly connection, mirroring #3/#10). No gamification
 * write, no ledger; the engine never trusts or computes a balance. (If points
 * are ever wanted, append a `caretaker_completed` ledger row here — a v2.)
 *
 * On success (status accepted → done) the caretaker gets a best-effort LINE push
 * thanking them. §7-NN callable; LINE reuses the existing LINE_CHANNEL_ACCESS_TOKEN
 * secret (§7-WW-safe). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canComplete } = require('./_caretakerEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _completedMessage(petName) {
  const pet = petName ? `น้อง “${petName}”` : 'สัตว์เลี้ยง';
  return {
    type: 'text',
    text: `💚 ขอบคุณที่ช่วยดูแล${pet}!\n\nเจ้าของยืนยันว่าการดูแลเสร็จสิ้นแล้ว น้ำใจของคุณช่วยให้เพื่อนบ้านอุ่นใจ 🐾`,
  };
}

exports.completeCaretakerRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId } = data || {};
    if (!requestId) {
      throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    const callerUid = context.auth.uid;
    const reqRef = firestore.collection('caretakerRequests').doc(String(requestId));

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
      }
      const req = snap.data() || {};

      const verdict = canComplete(req, callerUid);
      if (!verdict.ok) {
        if (verdict.reason === 'not-requester') {
          throw new functions.https.HttpsError('permission-denied', 'เฉพาะเจ้าของเท่านั้นที่ยืนยันได้');
        }
        if (verdict.reason === 'not-accepted') {
          throw new functions.https.HttpsError('failed-precondition',
            req.status === 'done' ? 'คำขอนี้เสร็จสิ้นแล้ว' : 'คำขอนี้ยังไม่มีผู้รับดูแล');
        }
        throw new functions.https.HttpsError('failed-precondition', 'ไม่สามารถยืนยันคำขอนี้ได้');
      }

      tx.update(reqRef, {
        status: 'done',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        caretakerBuilding: String(req.caretakerBuilding || ''),
        caretakerRoom: String(req.caretakerRoom || ''),
        petName: req.petName || '',
      };
    });

    // Best-effort LINE push to the caretaker — never fails the completion.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.caretakerBuilding && result.caretakerRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.caretakerBuilding, result.caretakerRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _completedMessage(result.petName),
            token,
            source: 'completeCaretakerRequest',
            context: { building: result.caretakerBuilding, roomId: result.caretakerRoom, requestId },
            idempotencyKeyFn: (userId) => `caretaker-${requestId}-completed-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('completeCaretakerRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId) };
  });
