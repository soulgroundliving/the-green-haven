/**
 * requestPhoneOtp — server-side rate-limit gate before tenant_app.html calls
 * Firebase client SDK's signInWithPhoneNumber.
 *
 * Firebase Phone Auth has its own per-IP rate limiter, but it doesn't know
 * about our app's UID/phone pairing. This adds an app-level cap so a single
 * tenant can't burn through OTPs (cost) and a single phone can't be spammed.
 *
 * Caps (per rolling 60-min window):
 *   - 3 requests per Firebase Auth UID
 *   - 3 requests per E.164 phone number
 *
 * Either limit hitting throws resource-exhausted; client shows toast + cooldown.
 *
 * Auth: any signed-in Firebase user (anonymous tenant OK)
 * Data: { phone: "+66812345678" }   (E.164 — client normalizes before sending)
 * Returns: { ok: true } on pass, throws HttpsError otherwise.
 *
 * Storage: Firestore collection `phoneOtpRateLimit` — two doc shapes:
 *   uid_<uid>     { count, windowStart, updatedAt }
 *   phone_<digits> { count, windowStart, updatedAt }
 * Cleaned up by cleanupOldDocs.cleanupRateLimitsScheduled (already scheduled).
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;

function _decideNext(snap, now) {
  let count = 1;
  let windowStart = now;
  if (snap.exists) {
    const d = snap.data();
    const startedAt = (d.windowStart && d.windowStart.toMillis) ? d.windowStart.toMillis() : 0;
    if (now - startedAt < WINDOW_MS) {
      count = (d.count || 0) + 1;
      windowStart = startedAt;
    }
  }
  return { count, windowStart, exceeded: count > MAX_PER_WINDOW };
}

exports.requestPhoneOtp = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const { phone } = data || {};
  if (!phone || typeof phone !== 'string' || !/^\+66\d{9}$/.test(phone)) {
    throw new functions.https.HttpsError('invalid-argument', 'phone must be E.164 Thai (+66XXXXXXXXX)');
  }

  const uid = context.auth.uid;
  const digits = phone.replace(/\D/g, '');
  const now = Date.now();
  const fs = admin.firestore();
  const uidRef = fs.collection('phoneOtpRateLimit').doc(`uid_${uid}`);
  const phoneRef = fs.collection('phoneOtpRateLimit').doc(`phone_${digits}`);

  try {
    const result = await fs.runTransaction(async (tx) => {
      // Firestore transactions require ALL reads before ANY writes.
      const [uidSnap, phoneSnap] = await Promise.all([tx.get(uidRef), tx.get(phoneRef)]);
      const uidRes = _decideNext(uidSnap, now);
      const phoneRes = _decideNext(phoneSnap, now);

      // If either limit is exceeded we still want the counter persisted so the
      // window keeps rolling, but we report the exceedance to the caller.
      tx.set(uidRef, {
        count: uidRes.count,
        windowStart: admin.firestore.Timestamp.fromMillis(uidRes.windowStart),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(phoneRef, {
        count: phoneRes.count,
        windowStart: admin.firestore.Timestamp.fromMillis(phoneRes.windowStart),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { uidRes, phoneRes };
    });

    if (result.uidRes.exceeded) {
      throw new functions.https.HttpsError('resource-exhausted',
        'OTP request limit reached for this account (max 3/hr). Try again later.');
    }
    if (result.phoneRes.exceeded) {
      throw new functions.https.HttpsError('resource-exhausted',
        'OTP request limit reached for this phone (max 3/hr). Try again later.');
    }
    return { ok: true, uidCount: result.uidRes.count, phoneCount: result.phoneRes.count };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('requestPhoneOtp error:', e.message, e.stack);
    throw new functions.https.HttpsError('internal', 'Rate-limit check failed: ' + e.message);
  }
});
