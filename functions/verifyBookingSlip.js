/**
 * verifyBookingSlip — SlipOK-backed deposit verification for the booking flow.
 *
 * Sibling of verifySlip.js (rent payments). Clones the SlipOK API call + atomic
 * dedup pattern, drops the bill-marking and Nest-gamification side effects (those
 * are tenant-flow concerns), and writes the result back to bookings/{bookingId}
 * instead of bills/.
 *
 * Why a separate CF (not a "mode" param on verifySlip):
 *   - verifySlip requires admin auth (`requireAdmin`) — it's invoked by tenants
 *     today but the path is being audited; auth model is in flux. Mixing
 *     prospect auth with that file would entangle two access models.
 *   - verifySlip writes to bills/* RTDB + tenants/{nest}/list/{}/paymentHistory
 *     subcollections + gamification — none of that applies to a deposit.
 *   - Bug-fix isolation: a regression in booking flow can't break monthly bill
 *     verification, and vice versa.
 *
 * Side-effects on success:
 *   1. Atomic dedup write to verifiedSlips/{transactionId} (gRPC-6 race fence)
 *   2. Slip image → Storage at bookings/{bookingId}/slips/{txid}.jpg (non-fatal)
 *   3. bookings/{bookingId}.status flips locked → paid + slip refs stamped
 *
 * Region: asia-southeast1
 * Auth: caller must be the booking's prospect (auth.uid === booking.prospectUid)
 *       OR have admin claim. Admin path is for ops/dashboard manual verification.
 * Returns success: { success, bookingId, status:'paid', transactionId, amount }
 * Returns retry:   { success: false, retryable: true, code: 'scb_delay', retryAfterSec, message }
 * Throws HttpsError on hard failures (amount mismatch, duplicate, no booking, etc.)
 */
const functions = require('firebase-functions');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// Reuse the existing project-level secret + param so deploy doesn't require new
// secrets. Same SlipOK plan, same API key — bookings count toward the same quota.
const SLIPOK_API_KEY = defineSecret('SLIPOK_API_KEY');
const SLIPOK_API_URL = defineString('SLIPOK_API_URL');

// Per-prospect rate limit. Generous-but-bounded — a real prospect uploads a
// slip 1-3 times max. 10/day caps a compromised prospect token at $0.10/day
// SlipOK quota, well within the 50/room/day rent-flow envelope.
const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 5,
  maxRequestsPerHour: 15,
  maxRequestsPerDay: 10,
};

// ──────────────────── HELPERS (kept local, see file header) ────────────────────

function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
}

async function checkRateLimit(uid, timeWindow) {
  try {
    const now = Date.now();
    const timeMs = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[timeWindow];
    const ref = firestore.collection('rateLimits').doc(`booking_${uid}_${timeWindow}`);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ count: 1, windowStart: now, updatedAt: new Date() });
      return true;
    }
    const data = doc.data();
    if (now - data.windowStart > timeMs) {
      await ref.update({ count: 1, windowStart: now, updatedAt: new Date() });
      return true;
    }
    const max = {
      minute: RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      hour: RATE_LIMIT_CONFIG.maxRequestsPerHour,
      day: RATE_LIMIT_CONFIG.maxRequestsPerDay,
    }[timeWindow];
    if (data.count >= max) {
      console.warn(`⚠️ Booking rate limit exceeded for ${uid} (${timeWindow}): ${data.count}/${max}`);
      return false;
    }
    await ref.update({ count: data.count + 1, updatedAt: new Date() });
    return true;
  } catch (e) {
    console.error('checkRateLimit failed:', e.message);
    return true; // fail open — don't lock out users on infra blip
  }
}

async function callSlipOKAPI(fileBuffer) {
  const form = new FormData();
  // Detect MIME from magic bytes — same heuristic as verifySlip.js
  let mimeType = 'image/jpeg';
  let ext = 'jpg';
  if (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) { mimeType = 'image/png'; ext = 'png'; }
  else if (fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49) { mimeType = 'image/gif'; ext = 'gif'; }
  else if (fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49) { mimeType = 'image/webp'; ext = 'webp'; }
  form.append('files', fileBuffer, { filename: `slip.${ext}`, contentType: mimeType });

  const response = await fetch(SLIPOK_API_URL.value(), {
    method: 'POST',
    headers: { 'x-authorization': SLIPOK_API_KEY.value() },
    body: form,
    timeout: 30_000,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SlipOK API returned ${response.status}: ${text.slice(0, 300)}`);
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error(`SlipOK non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!data.success) {
    throw new Error(data.message || 'SlipOK verification failed');
  }
  // Normalize transactionId — SlipOK returns transRef
  if (data.data && !data.data.transactionId) {
    data.data.transactionId = data.data.transRef || data.data.ref || null;
  }
  return data.data;
}

// ──────────────────── MAIN CF ────────────────────

exports.verifyBookingSlip = functions
  .region('asia-southeast1')
  .runWith({ secrets: [SLIPOK_API_KEY] })
  .https.onCall(async (data, context) => {
    // ── Auth ────────────────────────────────────────────────────────────────
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const tok = context.auth.token || {};
    const isAdmin = tok.admin === true;
    const isProspect = tok.role === 'prospect';
    if (!isAdmin && !isProspect) {
      throw new functions.https.HttpsError('permission-denied',
        'Only prospects (LIFF booking) or admins can verify a deposit slip');
    }

    // ── Input ──────────────────────────────────────────────────────────────
    const { bookingId, file } = data || {};
    if (!bookingId || typeof bookingId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
    }
    if (!/^[A-Za-z0-9]{4,40}$/.test(bookingId)) {
      throw new functions.https.HttpsError('invalid-argument', 'bookingId format invalid');
    }
    if (!file || typeof file !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'file (base64) is required');
    }
    if (file.length > 5 * 1024 * 1024) {
      throw new functions.https.HttpsError('invalid-argument', 'Payload too large (max ~3.75MB binary)');
    }

    // ── Read booking + ownership/status checks ──────────────────────────────
    const bookingRef = firestore.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Booking ${bookingId} not found`);
    }
    const booking = bookingSnap.data();
    if (!isAdmin && booking.prospectUid !== context.auth.uid) {
      throw new functions.https.HttpsError('permission-denied',
        'You can only verify your own booking');
    }
    if (booking.status !== 'locked') {
      throw new functions.https.HttpsError('failed-precondition',
        `Booking is in status '${booking.status}'; cannot verify slip`);
    }
    const lockedUntilMs = booking.lockedUntil && typeof booking.lockedUntil.toMillis === 'function'
      ? booking.lockedUntil.toMillis() : 0;
    if (lockedUntilMs <= Date.now()) {
      throw new functions.https.HttpsError('failed-precondition',
        'Booking lock has expired — please book again');
    }
    const expectedAmount = Number(booking.depositAmount || 0);
    if (expectedAmount <= 0) {
      console.error('verifyBookingSlip: booking has invalid depositAmount:', bookingId);
      throw new functions.https.HttpsError('internal', 'Booking has invalid deposit amount');
    }

    // ── Rate limit per prospect UID ────────────────────────────────────────
    const rateLimited = !(
      await checkRateLimit(context.auth.uid, 'minute') &&
      await checkRateLimit(context.auth.uid, 'hour') &&
      await checkRateLimit(context.auth.uid, 'day')
    );
    if (rateLimited) {
      throw new functions.https.HttpsError('resource-exhausted',
        'Too many slip verification attempts — please wait and try again');
    }

    // ── Decode base64 ──────────────────────────────────────────────────────
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(file, 'base64');
    } catch (e) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid base64 encoding');
    }
    if (fileBuffer.length < 100) {
      throw new functions.https.HttpsError('invalid-argument', 'File too small to be a slip image');
    }

    // ── Call SlipOK ─────────────────────────────────────────────────────────
    let slipData;
    try {
      slipData = await callSlipOKAPI(fileBuffer);
    } catch (e) {
      const msg = e.message || '';
      const isSCBDelay = msg.includes('"code":1010') || msg.includes('ไทยพาณิชย์');
      if (isSCBDelay) {
        // Retryable — return shape matching verifySlip's SCB delay response
        return {
          success: false,
          retryable: true,
          code: 'scb_delay',
          retryAfterSec: 120,
          message: 'สลิปธนาคารไทยพาณิชย์ใช้เวลาตรวจสอบประมาณ 2 นาทีหลังโอน กรุณารอแล้วลองใหม่อีกครั้ง',
        };
      }
      console.error('verifyBookingSlip: SlipOK call failed:', msg);
      throw new functions.https.HttpsError('failed-precondition', msg || 'SlipOK verification failed');
    }

    // ── Amount validation (HARD reject — no "warn and continue" path) ──────
    const amountDiff = Math.abs(Number(slipData.amount) - expectedAmount);
    if (amountDiff > 1) {
      console.warn(`⚠️ Booking deposit amount mismatch: bookingId=${bookingId}, slip=฿${slipData.amount}, expected=฿${expectedAmount}`);
      throw new functions.https.HttpsError('failed-precondition',
        `จำนวนเงินไม่ตรงกับยอดมัดจำ (สลิป ฿${slipData.amount} / ต้องการ ฿${expectedAmount})`);
    }

    // ── Transaction ID safety ──────────────────────────────────────────────
    if (!isSafeTransactionId(slipData.transactionId)) {
      console.warn(`⚠️ Unsafe transactionId from SlipOK: ${slipData.transactionId}`);
      throw new functions.https.HttpsError('failed-precondition', 'Invalid slip transaction id');
    }

    // ── Atomic dedup write (gRPC-6 race fence — same as verifySlip) ────────
    try {
      await firestore.collection('verifiedSlips').doc(slipData.transactionId).create({
        transactionId: slipData.transactionId,
        bookingId,
        prospectUid: context.auth.uid,
        building: booking.building,
        room: booking.roomId,
        amount: Number(slipData.amount),
        expectedAmount,
        sender: slipData.sender?.displayName || slipData.sender?.name || '',
        receiver: slipData.receiver?.displayName || slipData.receiver?.name || '',
        date: slipData.date || null,
        bankCode: slipData.sendingBankCode || '',
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        verified: true,
        source: 'booking', // distinguishes from rent-payment slips
      });
    } catch (e) {
      const dup = e && (
        e.code === 6 ||
        e.code === 'already-exists' ||
        e.code === 'ALREADY_EXISTS' ||
        (e.message && e.message.toLowerCase().includes('already exists'))
      );
      if (dup) {
        console.warn(`🚨 Duplicate booking slip: bookingId=${bookingId}, txid=${slipData.transactionId}`);
        throw new functions.https.HttpsError('already-exists',
          'Duplicate slip — this transaction has already been verified for another booking');
      }
      console.error('verifyBookingSlip: verifiedSlips create failed:', e);
      throw new functions.https.HttpsError('internal', 'Failed to record verified slip');
    }

    // ── Upload slip image to Storage (non-fatal) ───────────────────────────
    let slipImagePath = '';
    try {
      slipImagePath = `bookings/${bookingId}/slips/${slipData.transactionId}.jpg`;
      const bucket = admin.storage().bucket();
      await bucket.file(slipImagePath).save(fileBuffer, {
        metadata: { contentType: 'image/jpeg' },
        resumable: false,
      });
    } catch (e) {
      console.warn('verifyBookingSlip: Storage upload failed (non-fatal):', e.message);
      slipImagePath = '';
    }

    // ── Flip booking status → paid ─────────────────────────────────────────
    try {
      await bookingRef.update({
        status: 'paid',
        slipVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        slipTransactionRef: slipData.transactionId,
        slipImagePath,
        slipAmount: Number(slipData.amount),
        slipSender: slipData.sender?.displayName || slipData.sender?.name || '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // Slip is verified + recorded — booking update failure is recoverable by
      // admin manually flipping status, but log loudly so it's caught.
      console.error('verifyBookingSlip: booking update failed AFTER slip verified:', e);
      throw new functions.https.HttpsError('internal',
        'Slip was verified but booking update failed — admin will resolve');
    }

    console.log(`✅ verifyBookingSlip: bookingId=${bookingId} → paid (txid=${slipData.transactionId}, amount=฿${slipData.amount})`);
    return {
      success: true,
      bookingId,
      status: 'paid',
      transactionId: slipData.transactionId,
      amount: Number(slipData.amount),
    };
  });
