/**
 * requestPetLink — a tenant sends a friend request from their pet to another
 * pet in the SAME building (Meaning Layer #10). Writes/overwrites the
 * deterministic edge petLinks/{linkId} to status:'pending'.
 *
 * Both pets must already be PUBLIC (have a petProfiles doc) and in the same
 * building. The from-pet must be the caller's own (its profile.ownerRoom ==
 * the caller's room, verified after assertTenantAccess). The edge id is
 * order-independent (`${minId}_${maxId}`) so A→B and B→A never duplicate; an
 * existing pending/accepted edge is rejected, a previously declined edge can be
 * re-requested. Rate-limited 20/day per uid. The recipient's owner gets a
 * best-effort LINE push.
 *
 * §7-NN callable. LINE notify reuses the existing LINE_CHANNEL_ACCESS_TOKEN
 * secret (§7-WW-safe). No points (social-only). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { lookupApprovedRoomUsers, pushAndRetry } = require('./_notifyHelper');
const { buildLinkId, canRequestLink } = require('./_petSocialEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _requestMessage(fromName, toName) {
  return {
    type: 'text',
    text: `🐾 มีเพื่อนขอเป็นเพื่อนกับน้อง${toName || 'ของคุณ'}\n\nจาก: ${fromName || 'เพื่อนบ้าน'}\n\nเปิดแอป → Pet Park → ไดเรกทอรี เพื่อตอบรับ`,
  };
}

exports.requestPetLink = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, fromPetId, toPetId } = data || {};
    if (!building || !roomId || !fromPetId || !toPetId) {
      throw new functions.https.HttpsError('invalid-argument',
        'building, roomId, fromPetId and toPetId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);
    const fromId = String(fromPetId);
    const toId = String(toPetId);
    if (fromId === toId) {
      throw new functions.https.HttpsError('invalid-argument', 'ผูกเพื่อนกับตัวเองไม่ได้');
    }

    // Auth: caller must be the tenant of THEIR room (the from-pet's room).
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    // Anti-spam: max 20 friend requests/day per uid. Checked BEFORE the profile
    // reads so a rate-limited caller can't enumerate which petIds are public.
    await checkRateLimit(context.auth.uid, 'requestPetLink', 20, 86400);

    // Both pets must be public; the from-pet must belong to the caller's room;
    // both must be in the caller's building; and the two pets must be in
    // DIFFERENT rooms (same-room pets share one owner — friending is moot, and a
    // same-room edge would break the room-based recipient auth in respondPetLink).
    const [fromSnap, toSnap] = await Promise.all([
      firestore.collection('petProfiles').doc(fromId).get(),
      firestore.collection('petProfiles').doc(toId).get(),
    ]);
    if (!fromSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'สัตว์เลี้ยงของคุณยังไม่ได้เปิดในไดเรกทอรี');
    }
    if (!toSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบสัตว์เลี้ยงที่ต้องการเป็นเพื่อน');
    }
    const fromProfile = fromSnap.data() || {};
    const toProfile = toSnap.data() || {};
    if (fromProfile.building !== canonicalBuilding || String(fromProfile.ownerRoom) !== room) {
      throw new functions.https.HttpsError('permission-denied', 'สัตว์เลี้ยงนี้ไม่ใช่ของคุณ');
    }
    if (toProfile.building !== canonicalBuilding) {
      throw new functions.https.HttpsError('permission-denied', 'เป็นเพื่อนได้เฉพาะสัตว์เลี้ยงในอาคารเดียวกัน');
    }
    if (String(toProfile.ownerRoom) === room) {
      throw new functions.https.HttpsError('invalid-argument', 'เป็นเพื่อนกับสัตว์เลี้ยงในห้องเดียวกันไม่ได้');
    }

    const linkId = buildLinkId(fromId, toId);
    const linkRef = firestore.collection('petLinks').doc(linkId);

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(linkRef);
      const existing = snap.exists ? (snap.data() || {}) : null;
      const verdict = canRequestLink(existing, fromId, toId);
      if (!verdict.ok) {
        if (verdict.reason === 'already-friends') {
          throw new functions.https.HttpsError('failed-precondition', 'เป็นเพื่อนกันอยู่แล้ว');
        }
        if (verdict.reason === 'pending-exists') {
          throw new functions.https.HttpsError('failed-precondition', 'มีคำขอค้างอยู่แล้ว');
        }
        throw new functions.https.HttpsError('failed-precondition', 'ส่งคำขอไม่ได้');
      }

      const [petA, petB] = fromId < toId ? [fromId, toId] : [toId, fromId];
      tx.set(linkRef, {
        linkId,
        petA,
        petB,
        building: canonicalBuilding,
        requesterPetId: fromId,
        requesterTenantId: String(fromProfile.ownerTenantId || ''),
        requesterRoom: room,
        requesterName: String(fromProfile.name || '').slice(0, 60),
        recipientPetId: toId,
        recipientTenantId: String(toProfile.ownerTenantId || ''),
        recipientRoom: String(toProfile.ownerRoom || ''),
        recipientName: String(toProfile.name || '').slice(0, 60),
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedAt: null,
      });

      return {
        recipientBuilding: canonicalBuilding,
        recipientRoom: String(toProfile.ownerRoom || ''),
        fromName: String(fromProfile.name || ''),
        toName: String(toProfile.name || ''),
      };
    });

    // Best-effort LINE push to the recipient's owner — never fails the request.
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token && result.recipientRoom) {
        const { docs } = await lookupApprovedRoomUsers(firestore, result.recipientBuilding, result.recipientRoom);
        if (docs && docs.length) {
          await pushAndRetry({
            docs,
            message: _requestMessage(result.fromName, result.toName),
            token,
            source: 'requestPetLink',
            context: { building: result.recipientBuilding, roomId: result.recipientRoom, linkId },
            idempotencyKeyFn: (userId) => `petlink-${linkId}-pending-${userId}`,
          });
        }
      }
    } catch (e) {
      console.warn('requestPetLink notify failed (non-fatal):', e.message);
    }

    return { success: true, linkId };
  });
