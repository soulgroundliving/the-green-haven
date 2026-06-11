/**
 * removePetLink — either party deletes a friend edge (Meaning Layer #10):
 * unfriend an accepted link, withdraw a pending request, or clear a declined
 * one. petLinks/{linkId} is removed entirely (a fresh request can be sent later).
 *
 * Either the requester's or the recipient's room may remove the edge
 * (canRemoveLink), within the same building. No points. §7-NN callable.
 * Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { canRemoveLink } = require('./_petSocialEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.removePetLink = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, linkId } = data || {};
  if (!building || !roomId || !linkId) {
    throw new functions.https.HttpsError('invalid-argument', 'building, roomId and linkId are required');
  }
  const canonicalBuilding = String(building).toLowerCase();
  if (!['rooms', 'nest'].includes(canonicalBuilding)) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const room = String(roomId);

  // Auth: caller must be the tenant of THEIR room.
  await assertTenantAccess({
    building: canonicalBuilding, roomId: room,
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const linkRef = firestore.collection('petLinks').doc(String(linkId));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(linkRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบคำขอนี้');
    }
    const link = snap.data() || {};

    const verdict = canRemoveLink(link, canonicalBuilding, room);
    if (!verdict.ok) {
      throw new functions.https.HttpsError('permission-denied', 'ลบความเชื่อมโยงนี้ไม่ได้');
    }

    tx.delete(linkRef);
    return { success: true, linkId: String(linkId) };
  });
});
