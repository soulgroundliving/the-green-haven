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

function bumpCounter(tx, ref, now) {
  return tx.get(ref).then((snap) => {
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
    if (count > MAX_PER_WINDOW) {
      return { exceeded: true, count };
    }
    tx.set(ref, {
      count,
      windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { exceeded: false, count };
  });
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
      const uidRes = await bumpCounter(tx, uidRef, now);
      const phoneRes = await bumpCounter(tx, phoneRef, now);
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
    console.error('requestPhoneOtp error:', e.message);
    throw new functions.https.HttpsError('internal', 'Rate-limit check failed');
  }
});
