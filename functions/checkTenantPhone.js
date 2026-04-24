/**
 * checkTenantPhone — verify phone match for LIFF auto-approve without exposing
 * the tenant doc to the client.
 *
 * Called from tenant_app.html submitLiffLinkRequest() before the client writes
 * the liffUsers approval doc. Uses admin SDK so the raw tenant phone stays
 * server-side; the client only receives { match: boolean, tenantName? }.
 *
 * Context: any signed-in Firebase user (anonymous tenant during LIFF linking).
 * Data: { building: "rooms"|"nest", room: "101", phone: "0812345678" }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

exports.checkTenantPhone = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const { building, room, phone } = data || {};

  if (!['rooms', 'nest'].includes(String(building))) {
    throw new functions.https.HttpsError('invalid-argument', 'building must be "rooms" or "nest"');
  }
  if (!room || typeof room !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'room is required');
  }
  if (!phone || typeof phone !== 'string') {
    return { match: false };
  }

  const givenPhone = normalizePhone(phone);
  if (!givenPhone) return { match: false };

  try {
    const snap = await admin.firestore()
      .collection('tenants').doc(String(building))
      .collection('list').doc(String(room))
      .get();

    if (!snap.exists) return { match: false };

    const t = snap.data();
    const tenantPhone = normalizePhone(t.phone || t.tenantPhone || '');

    if (tenantPhone && tenantPhone === givenPhone) {
      // Return name only on match — never expose phone to the caller
      return { match: true, tenantName: t.name || t.firstName || '' };
    }
    return { match: false };
  } catch (e) {
    console.error('checkTenantPhone error:', e.message);
    throw new functions.https.HttpsError('internal', 'Phone check failed');
  }
});
