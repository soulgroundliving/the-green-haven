/**
 * acceptHelpRequest — a tenant accepts an OPEN neighbor help request (Meaning
 * Layer #2). Atomic single-winner: the transaction re-reads status==='open', so
 * if two neighbors tap "รับ" at once only the first commits; the loser gets
 * failed-precondition "มีคนรับคำขอนี้ไปแล้ว".
 *
 * The helper must be a tenant of the SAME building as the request (the read rule
 * already scopes the board by building; this enforces it server-side too) and
 * must not be the requester. helperUid is taken from context.auth.uid
 * (anti-spoof). On success the requester gets a best-effort LINE push.
 *
 * §7-NN callable. LINE notify reuses the existing LINE_CHANNEL_ACCESS_TOKEN
 * secret (§7-WW-safe — same secret notifyMaintenanceTenant already uses).
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canAccept } = require('./_helpRequestEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

function _acceptedMessage(title, helperName) {
  return {
    type: 'text',
    text: `🤝 มีเพื่อนบ้านรับช่วยเหลือคุณแล้ว\n\n“${title}”\nผู้ช่วย: ${helperName}\n\nเปิดแอปเพื่อดูรายละเอียดและยืนยันเมื่อช่วยเสร็จ`,
  };
}

exports.acceptHelpRequest = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { requestId, building, roomId, helperName } = data || {};
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

    // Auth: caller must be the tenant of THEIR room (the helper's room).
    await assertTenantAccess({
      building: canonicalBuilding,
      roomId: String(roomId),
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const helperUid = context.auth.uid;
    const reqRef = firestore.collection('helpRequests').doc(String(requestId));

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

      const verdict = canAccept(req, helperUid);
      if (!verdict.ok) {
        if (verdict.reason === 'self-help') {
          throw new functions.https.HttpsError('failed-precondition', 'รับคำขอของตัวเองไม่ได้');
        }
        throw new functions.https.HttpsError('failed-precondition', 'มีคนรับคำขอนี้ไปแล้ว');
      }

      const name = String(helperName || `ห้อง ${roomId}`).trim().slice(0, MAX_NAME_LEN);
      tx.update(reqRef, {
        status: 'accepted',
        helperUid,
        helperTenantId: `${canonicalBuilding}_${roomId}`,
        helperBuilding: canonicalBuilding,
        helperRoom: String(roomId),
        helperName: name,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        requesterBuilding: req.building,
        requesterRoom: req.room,
        title: req.title || '',
        helperName: name,
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
            message: _acceptedMessage(result.title, result.helperName),
            token,
            source: 'acceptHelpRequest',
            context: { building: result.requesterBuilding, roomId: result.requesterRoom, requestId },
            idempotencyKeyFn: (userId) => `help-${requestId}-accepted-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('acceptHelpRequest notify failed (non-fatal):', e.message);
    }

    return { success: true, requestId: String(requestId) };
  });
