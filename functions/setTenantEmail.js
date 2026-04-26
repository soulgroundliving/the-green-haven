/**
 * setTenantEmail — OTP-free but server-validated email save.
 *
 * 1. Updates Firebase Auth user so sendEmailVerification() works client-side.
 * 2. Stores email + emailVerified:false in the tenant Firestore doc.
 *
 * Auth: any signed-in Firebase user (anonymous tenant OK before LIFF approval).
 *       If the caller already has building+room custom claims, they must match
 *       the supplied building/room pair. Pre-approval anonymous tenants have no
 *       claims, so we fall through to a Firestore ownership check instead.
 *
 * Data: { email, building, room }
 * Returns: { ok: true }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

exports.setTenantEmail = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const { email, building, room } = data || {};
  if (!email || !building || !room) {
    throw new functions.https.HttpsError('invalid-argument', 'email, building, and room are required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid email format');
  }

  const uid = context.auth.uid;
  const claims = context.auth.token;

  // If caller has building/room claims, they must match the requested pair.
  // Anonymous pre-approval tenants have no claims — allowed through.
  if (claims.building || claims.room) {
    if (claims.building !== building || String(claims.room) !== String(room)) {
      throw new functions.https.HttpsError('permission-denied', 'Tenant may only update their own room');
    }
  }

  const fs = admin.firestore();
  const tenantRef = fs.doc(`tenants/${building}/list/${String(room)}`);

  // Verify the tenant doc exists and the linkedAuthUid matches this caller
  // (only if the doc has a linkedAuthUid — skip for docs without it).
  const snap = await tenantRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Tenant document not found');
  }
  const linked = snap.data().linkedAuthUid;
  if (linked && linked !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Auth UID does not match tenant record');
  }

  // Update Firebase Auth so client-side sendEmailVerification works.
  await admin.auth().updateUser(uid, { email, emailVerified: false });

  // Persist to Firestore tenant doc.
  await tenantRef.update({
    email,
    emailVerified: false,
    emailUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
