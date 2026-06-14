/**
 * acceptCaretakerRequest — a neighbour accepts an OPEN pet-sitting request
 * (Meaning Layer #14). Atomic single-winner: the transaction re-reads
 * status==='open', so if two neighbours tap "รับดูแล" at once only the first
 * commits; the loser gets failed-precondition "มีคนรับดูแลไปแล้ว".
 *
 * The caretaker must be a tenant of the SAME building as the request (the read
 * rule already scopes the board by building; this enforces it server-side too)
 * and must not be the requester. caretakerUid is taken from context.auth.uid
 * (anti-spoof). On success the requester (the owner) gets a best-effort LINE push.
 *
 * D1 (per-request opt-in): anyone in the building can accept — no persistent
 * "available to pet-sit" flag, no petProfiles read/write.
 *
 * §7-NN callable. LINE notify reuses the existing LINE_CHANNEL_ACCESS_TOKEN
 * secret (§7-WW-safe — same secret notifyMaintenanceTenant / acceptHelpRequest
 * already use). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canAccept } = require('./_caretakerEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

function _acceptedMessage(petName, caretakerName) {
  const pet = petName ? `น้อง “${petName}”` : 'สัตว์เลี้ยงของคุณ';
  return {
    type: 'text',
    text: `🐾 มีเพื่อนบ้านรับช่วยดูแล${pet}แล้ว\n\nผู้ดูแล: ${caretakerName}\n\nเปิดแอปเพื่อดูรายละเอียดและยืนยันเมื่อการดูแลเสร็จสิ้น`,
  };
}

exports.acceptCaretakerRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId, building, roomId, caretakerName } = data || {};
    if (!requestId) {
      throw new functions.https.HttpsError('invalid-argument', 'requestId is required');
    }
    if (!building || !roomId) {
      throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }

    // Auth: caller must be the tenant of THEIR room (the caretaker's room).
    await assertTenantAccess({
      building: canonicalBuilding,
      roomId: String(roomId),
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const caretakerUid = context.auth.uid;
    const reqRef = firestore.collection('caretakerRequests').doc(String(requestId));

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
      }
      const req = snap.data() || {};

      // Same-building enforcement (defense in depth on top of the read rule).
      if (req.building !== canonicalBuilding) {
        throw new functions.https.HttpsError('permission-denied', 'คำขอนี้อยู่คนละอาคาร');
      }

      const verdict = canAccept(req, caretakerUid);
      if (!verdict.ok) {
        if (verdict.reason === 'self-accept') {
          throw new functions.https.HttpsError('failed-precondition', 'รับดูแลสัตว์เลี้ยงของตัวเองไม่ได้');
        }
        throw new functions.https.HttpsError('failed-precondition', 'มีคนรับดูแลไปแล้ว');
      }

      const name = String(caretakerName || `ห้อง ${roomId}`).trim().slice(0, MAX_NAME_LEN);
      tx.update(reqRef, {
        status: 'accepted',
        caretakerUid,
        caretakerTenantId: `${canonicalBuilding}_${roomId}`,
        caretakerBuilding: canonicalBuilding,
        caretakerRoom: String(roomId),
        caretakerName: name,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        requesterBuilding: req.building,
        requesterRoom: req.room,
        petName: req.petName || '',
        caretakerName: name,
      };
    });

    // Best-effort LINE push to the requester — never fails the accept (§ non-blocking).
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.requesterBuilding && result.requesterRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.requesterBuilding, result.requesterRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _acceptedMessage(result.petName, result.caretakerName),
            token,
            source: 'acceptCaretakerRequest',
            context: { building: result.requesterBuilding, roomId: result.requesterRoom, requestId },
            idempotencyKeyFn: (userId) => `caretaker-${requestId}-accepted-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('acceptCaretakerRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId) };
  });
