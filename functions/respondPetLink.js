/**
 * respondPetLink — the RECIPIENT pet's owner accepts or declines a pending
 * friend request (Meaning Layer #10). Flips petLinks/{linkId} pending →
 * accepted | declined.
 *
 * Atomic single-winner: the transaction re-reads status==='pending', so a
 * double-tap (or a race with a cancel) can only commit once. Only the recipient
 * party (link.recipientRoom == the caller's room) may respond — the requester
 * can never accept their own request (the same peer-confirmed stance as
 * #2/#3/#4). On accept the requester's owner gets a best-effort LINE push.
 *
 * §7-NN callable. LINE notify reuses the existing LINE_CHANNEL_ACCESS_TOKEN
 * secret (§7-WW-safe). No points. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { canRespondLink } = require('./_petSocialEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _acceptedMessage(recipientName, requesterName) {
  return {
    type: 'text',
    text: `🎉 น้อง${recipientName || 'เพื่อนใหม่'} ตอบรับเป็นเพื่อนกับน้อง${requesterName || 'ของคุณ'} แล้ว!\n\nเปิดแอป → Pet Park → ไดเรกทอรี เพื่อดูเพื่อนของน้อง`,
  };
}

exports.respondPetLink = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, linkId, accept } = data || {};
    if (!building || !roomId || !linkId) {
      throw new functions.https.HttpsError('invalid-argument', 'building, roomId and linkId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);
    const accepting = accept === true;

    // Auth: caller must be the tenant of THEIR room (the recipient pet's room).
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const linkRef = firestore.collection('petLinks').doc(String(linkId));

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(linkRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
      }
      const link = snap.data() || {};

      // AUTHORIZATION: only the recipient party may respond. requestPetLink
      // forbids same-room edges, so requesterRoom !== recipientRoom always — a
      // room match here means the caller is the recipient, never the requester
      // (can't self-accept). Defense in depth on top of the building read rule.
      if (link.building !== canonicalBuilding || String(link.recipientRoom) !== room) {
        throw new functions.https.HttpsError('permission-denied', 'ตอบรับคำขอนี้ไม่ได้');
      }
      // STATE TRANSITION guard (single-winner): must still be pending.
      const verdict = canRespondLink(link);
      if (!verdict.ok) {
        throw new functions.https.HttpsError('failed-precondition', 'คำขอนี้ถูกตอบไปแล้ว');
      }

      tx.update(linkRef, {
        status: accepting ? 'accepted' : 'declined',
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        requesterBuilding: link.building,
        requesterRoom: String(link.requesterRoom || ''),
        requesterName: String(link.requesterName || ''),
        recipientName: String(link.recipientName || ''),
      };
    });

    // Best-effort LINE push to the requester — only on accept; never fails.
    if (accepting) {
      try {
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (token && result.requesterRoom) {
          const { docs } = await lookupApprovedRoomUsers(firestore, result.requesterBuilding, result.requesterRoom);
          if (docs && docs.length) {
            await pushAndRetry({
              docs,
              message: _acceptedMessage(result.recipientName, result.requesterName),
              token,
              source: 'respondPetLink',
              context: { building: result.requesterBuilding, roomId: result.requesterRoom, linkId },
              idempotencyKeyFn: (userId) => `petlink-${linkId}-accepted-${userId}`,
            });
          }
        }
      } catch (e) {
        console.warn('respondPetLink notify failed (non-fatal):', e.message);
      }
    }

    return { success: true, linkId: String(linkId), status: accepting ? 'accepted' : 'declined' };
  });
