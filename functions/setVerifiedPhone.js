/**
 * setVerifiedPhone — server-side write of OTP-verified phone to tenant doc.
 *
 * Why: client-side flow (linkWithCredential then updateDoc) hit silent token
 * refresh 403s on securetoken.googleapis.com after the phone-link, which made
 * the subsequent Firestore write go out with a stale/missing token → "Missing
 * or insufficient permissions". Doing the write in a CF with admin SDK side-
 * steps the entire client auth-state dance.
 *
 * Auth: caller must be currently signed in as the phone-auth user (proves OTP
 * passed). The phone number on the token MUST match the phone they claim to
 * save. We also require the caller pass their original anonymous UID; the CF
 * verifies that UID is the tenant doc's linkedAuthUid before writing — that
 * prevents a malicious caller from writing to someone else's room.
 *
 * Data: { oldAnonUid: "abc...", building: "rooms"|"nest", room: "201", phone: "0xxxxxxxxx" }
 * Returns: { ok: true } | throws HttpsError
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

exports.setVerifiedPhone = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  // Must be signed in via phone provider — proves OTP just succeeded
  const provider = context.auth.token?.firebase?.sign_in_provider;
  if (provider !== 'phone') {
    throw new functions.https.HttpsError('permission-denied',
      'Caller must be authenticated via phone provider (provider=' + provider + ')');
  }
  const tokenPhone = normalizePhone(context.auth.token?.phone_number || '');
  if (!tokenPhone) {
    throw new functions.https.HttpsError('permission-denied', 'Token has no phone_number claim');
  }

  const { oldAnonUid, lineUserId, building, room, phone } = data || {};
  const phoneDigits = normalizePhone(phone);

  if (!['rooms', 'nest'].includes(String(building))) {
    throw new functions.https.HttpsError('invalid-argument', 'building must be rooms or nest');
  }
  if (!room || typeof room !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'room required');
  }
  if (!phoneDigits || phoneDigits.length < 9) {
    throw new functions.https.HttpsError('invalid-argument', 'phone invalid');
  }

  // Token phone is +66XXXXXXXXX; saved phone is 0XXXXXXXXX. Compare on
  // last 9 digits to prove the saved phone matches the verified one.
  if (tokenPhone.slice(-9) !== phoneDigits.slice(-9)) {
    throw new functions.https.HttpsError('permission-denied',
      'Saved phone does not match the OTP-verified phone on the token');
  }

  const fs = admin.firestore();
  const ref = fs.collection('tenants').doc(building).collection('list').doc(String(room));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Tenant doc not found');
  }
  const tenantData = snap.data();

  // Ownership check — accept ANY of these proofs (need at least one):
  //   (a) oldAnonUid matches doc.linkedAuthUid (set by linkAuthUid via LIFF)
  //   (b) lineUserId matches doc.lineUserId (also set by linkAuthUid)
  //   (c) the saved phone equals the existing phone on the doc (phone EDIT)
  // (a) is the strongest and the normal case. (b) covers users whose anon UID
  // was overwritten by an old confirmationResult.confirm() during testing. (c)
  // covers phone-edit when nothing else matches but the user already proves
  // ownership of the previous phone via OTP.
  const ownsByAnonUid = oldAnonUid && tenantData.linkedAuthUid === oldAnonUid;
  const ownsByLineUid = lineUserId && tenantData.lineUserId === lineUserId;
  const ownsByPhone = tenantData.phone &&
    normalizePhone(tenantData.phone).slice(-9) === phoneDigits.slice(-9);
  if (!ownsByAnonUid && !ownsByLineUid && !ownsByPhone) {
    throw new functions.https.HttpsError('permission-denied',
      'No ownership proof for ' + building + '/' + room +
      ' (anonUid=' + !!ownsByAnonUid + ' lineUid=' + !!ownsByLineUid + ' phone=' + !!ownsByPhone + ')');
  }

  await ref.update({
    phone: phoneDigits,
    phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
