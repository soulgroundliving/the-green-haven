/**
 * offerCommunityRequest — a tenant offers the item for an OPEN neighbour request
 * (Meaning Layer #3). Atomic single-winner: the transaction re-reads
 * status==='open', so if two neighbours tap "ฉันมีให้" at once only the first
 * commits; the loser gets failed-precondition "มีคนเสนอให้คำขอนี้ไปแล้ว".
 *
 * The offerer must be a tenant of the SAME building as the request (the read rule
 * already scopes the board by building; this enforces it server-side too) and
 * must not be the requester. offererUid is taken from context.auth.uid
 * (anti-spoof). On success the requester gets a best-effort LINE push.
 *
 * No points move on this board (see _communityRequestEngine header). §7-NN
 * callable. LINE notify reuses the existing LINE_CHANNEL_ACCESS_TOKEN secret
 * (§7-WW-safe — same secret notifyMaintenanceTenant already uses). Region
 * asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canOffer } = require('./_communityRequestEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

function _offeredMessage(title, offererName) {
  return {
    type: 'text',
    text: `🔄 มีเพื่อนบ้านมีของให้คุณแล้ว\n\n“${title}”\nผู้ให้: ${offererName}\n\nเปิดแอปเพื่อนัดรับ แล้วกดยืนยันเมื่อได้รับของ`,
  };
}

exports.offerCommunityRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId, building, roomId, offererName } = data || {};
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

    // Auth: caller must be the tenant of THEIR room (the offerer's room).
    await assertTenantAccess({
      building: canonicalBuilding,
      roomId: String(roomId),
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const offererUid = context.auth.uid;
    const reqRef = firestore.collection('communityRequests').doc(String(requestId));

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

      const verdict = canOffer(req, offererUid);
      if (!verdict.ok) {
        if (verdict.reason === 'self-offer') {
          throw new functions.https.HttpsError('failed-precondition', 'เสนอให้คำขอของตัวเองไม่ได้');
        }
        throw new functions.https.HttpsError('failed-precondition', 'มีคนเสนอให้คำขอนี้ไปแล้ว');
      }

      const name = String(offererName || `ห้อง ${roomId}`).trim().slice(0, MAX_NAME_LEN);
      tx.update(reqRef, {
        status: 'offered',
        offererUid,
        offererTenantId: `${canonicalBuilding}_${roomId}`,
        offererBuilding: canonicalBuilding,
        offererRoom: String(roomId),
        offererName: name,
        offeredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        requesterBuilding: req.building,
        requesterRoom: req.room,
        title: req.title || '',
        offererName: name,
      };
    });

    // Best-effort LINE push to the requester — never fails the offer (§ non-blocking).
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.requesterBuilding && result.requesterRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.requesterBuilding, result.requesterRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _offeredMessage(result.title, result.offererName),
            token,
            source: 'offerCommunityRequest',
            context: { building: result.requesterBuilding, roomId: result.requesterRoom, requestId },
            idempotencyKeyFn: (userId) => `creq-${requestId}-offered-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('offerCommunityRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId) };
  });
