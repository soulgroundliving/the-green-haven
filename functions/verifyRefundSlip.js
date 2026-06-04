/**
 * verifyRefundSlip — SlipOK-backed authenticity check for a deposit REFUND slip.
 *
 * Move-out settlement (Slice C, tasks/deposit-pet-damage-rules.md) lets the admin
 * upload the slip proving they transferred the net refund back to the tenant. This
 * CF confirms that slip is a REAL bank transfer (not a screenshot/edit) and that its
 * amount ≈ the net refund — so "ไม่ได้คืนเงิน" disputes are closed by verified proof,
 * not an unverifiable image.
 *
 * Why a SEPARATE CF (not verifySlip / verifyBookingSlip reuse) — handoff 2026-06-04:
 *   - verifySlip marks bills paid + awards gamification points + dedups the slip
 *     against TENANT payments in verifiedSlips/. A refund is the admin's OUTGOING
 *     payment to the tenant — none of those side effects apply, and writing it to
 *     verifiedSlips/ would orphan it in reconcile (no matching bill → unmatched).
 *   - verifyBookingSlip flips a booking to paid. No booking here.
 *   So this CF is PURE VERIFICATION: it calls SlipOK, returns the verdict, and writes
 *   NOTHING. The proof (transactionId + amount) is persisted by the client onto the
 *   deposits/{b}_{r} settlement doc as `refundSlipVerified`, where it belongs.
 *
 * Direction is reversed vs a rent slip: the admin is the SENDER, the tenant is the
 * RECEIVER. So the receiver check (slip receiver ≈ tenant's refund PromptPay) is the
 * real anti-replay guard — a refund slip from a DIFFERENT tenant fails amount + receiver.
 * Both checks are ADVISORY (returned as booleans); the admin decides (§7-I observe-only,
 * the CF never blocks or auto-acts). Auth errors / bad input DO throw.
 *
 * Region SE1. §7-NN: callable, never a Firestore trigger (project Firestore is SE3
 * where Eventarc can't deploy). Admin-gated — the house gate (mirror refundBill).
 * Reuses the project SLIPOK_API_KEY secret + SLIPOK_API_URL param → no new deploy
 * secret (§7-WW), same SlipOK plan/quota as verifySlip + verifyBookingSlip.
 */
const functions = require('firebase-functions/v1');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
// NOTE: do NOT require('form-data') — the Node 22 undici global fetch can't
// serialize that package's instance (it stringifies to "[object FormData]").
// callSlipOKAPI uses the global FormData + Blob instead (§7-YY).

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// Same project-level secret + param as verifySlip / verifyBookingSlip — refunds
// count toward the same SlipOK quota. defineSecret → Secret Manager (no .env write);
// defineString → functions/.env at deploy (CI writes it).
const SLIPOK_API_KEY = defineSecret('SLIPOK_API_KEY');
const SLIPOK_API_URL = defineString('SLIPOK_API_URL');

// Per-admin rate limit. An admin verifies a refund slip 1-3 times per settlement;
// 30/day bounds a compromised admin token's SlipOK quota drain. Mirrors the booking
// envelope (verifyBookingSlip) — generous-but-bounded.
const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 5,
  maxRequestsPerHour: 15,
  maxRequestsPerDay: 30,
};

const AMOUNT_TOLERANCE = 1; // ฿ — matches verifySlip's |diff| <= 1 band

// ──────────────────── HELPERS (local — see file header, no touch to verifySlip) ───

function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
}

async function checkRateLimit(uid, timeWindow) {
  try {
    const now = Date.now();
    const timeMs = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[timeWindow];
    const max = {
      minute: RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      hour: RATE_LIMIT_CONFIG.maxRequestsPerHour,
      day: RATE_LIMIT_CONFIG.maxRequestsPerDay,
    }[timeWindow];
    const ref = firestore.collection('rateLimits').doc(`refundslip_${uid}_${timeWindow}`);
    // Transaction so concurrent CF instances can't both read count=N and both
    // write N+1, doubling the cap. Mirrors verifySlip.js's rate limiter (the
    // canonical pattern); verifyBookingSlip's non-transactional copy is the weaker one.
    return await firestore.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }
      const data = doc.data();
      if (now - data.windowStart > timeMs) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }
      if (data.count >= max) {
        console.warn(`⚠️ Refund-slip rate limit exceeded for ${uid} (${timeWindow}): ${data.count}/${max}`);
        return false; // no write — transaction commits as a no-op read
      }
      tx.update(ref, { count: data.count + 1, updatedAt: new Date() });
      return true;
    });
  } catch (e) {
    // Fail CLOSED — a Firestore outage must not silently grant a rate-limit bypass.
    // Caller turns false into resource-exhausted (a 503-shape the client can retry).
    console.error('checkRateLimit failed (failing CLOSED for safety):', e.message);
    return false;
  }
}

async function callSlipOKAPI(fileBuffer) {
  // Detect MIME from magic bytes — same heuristic as verifySlip.js / verifyBookingSlip.js
  let mimeType = 'image/jpeg';
  let ext = 'jpg';
  if (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) { mimeType = 'image/png'; ext = 'png'; }
  else if (fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49) { mimeType = 'image/gif'; ext = 'gif'; }
  else if (fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49) { mimeType = 'image/webp'; ext = 'webp'; }
  // §7-YY: the Node 22 undici global fetch does NOT serialize the `form-data`
  // npm package — it stringifies the instance to "[object FormData]" (sent as
  // text/plain, ~17 bytes), so SlipOK rejects it 400 "missing data/files/url".
  // The SPEC-compliant global FormData + Blob makes undici emit a real
  // multipart/form-data body + boundary. Do NOT set Content-Type — undici
  // derives the boundary; a manual one would mismatch the body.
  const form = new FormData();
  form.append('files', new Blob([fileBuffer], { type: mimeType }), `slip.${ext}`);

  const response = await fetch(SLIPOK_API_URL.value(), {
    method: 'POST',
    headers: { 'x-authorization': SLIPOK_API_KEY.value() },
    body: form,
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

/**
 * Best-effort, ADVISORY check that the slip's receiver matches the tenant's refund
 * PromptPay. SlipOK masks receiver account/proxy (e.g. "xxx-x-x1234-x"), so an exact
 * match is impossible — we compare the last 4 digits of the expected PromptPay against
 * any digit run SlipOK exposes on the receiver. Returns:
 *   true   — a receiver digit run contains the expected last-4
 *   false  — receiver carries comparable digits but none match (possible wrong target)
 *   null   — nothing to compare (no expected number, or receiver is a masked name only)
 * Never throws; the admin makes the final call.
 */
function receiverMatches(receiver, expectedReceiver) {
  const expDigits = String(expectedReceiver == null ? '' : expectedReceiver).replace(/[^0-9]/g, '');
  if (expDigits.length < 4) return null;
  const tail = expDigits.slice(-4);
  const cands = [];
  if (receiver && typeof receiver === 'object') {
    if (receiver.proxy && receiver.proxy.value) cands.push(receiver.proxy.value);
    if (receiver.account && receiver.account.value) cands.push(receiver.account.value);
    if (typeof receiver.account === 'string') cands.push(receiver.account);
    if (receiver.displayName) cands.push(receiver.displayName);
    if (receiver.name) cands.push(receiver.name);
  } else if (typeof receiver === 'string') {
    cands.push(receiver);
  }
  const digitRuns = cands
    .map((c) => String(c).replace(/[^0-9]/g, ''))
    .filter((d) => d.length >= 4);
  if (!digitRuns.length) return null;
  return digitRuns.some((d) => d.includes(tail));
}

function receiverLabel(receiver) {
  if (!receiver) return '';
  if (typeof receiver === 'string') return receiver.slice(0, 120);
  return String(receiver.displayName || receiver.name || '').slice(0, 120);
}

// ──────────────────── MAIN CF ────────────────────

exports.verifyRefundSlip = functions
  .region('asia-southeast1')
  .runWith({ secrets: [SLIPOK_API_KEY] })
  .https.onCall(async (data, context) => {
    const { HttpsError } = functions.https;

    // ── Auth — admin only (the house gate; a refund is an admin action) ──────
    if (!context.auth || !context.auth.uid) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }
    if ((context.auth.token || {}).admin !== true) {
      throw new HttpsError('permission-denied', 'Admin claim required to verify a refund slip');
    }

    // ── Input ────────────────────────────────────────────────────────────────
    const { file, expectedAmount, expectedReceiver, building, room } = data || {};
    if (!file || typeof file !== 'string') {
      throw new HttpsError('invalid-argument', 'file (base64) is required');
    }
    if (file.length > 5 * 1024 * 1024) { // base64 string length; base64 inflates ~33% → ~3.75MB binary
      throw new HttpsError('invalid-argument', 'Payload too large (max ~3.75MB binary)');
    }
    const expected = Number(expectedAmount);
    if (!Number.isFinite(expected) || expected <= 0) {
      throw new HttpsError('invalid-argument', 'expectedAmount (net refund > 0) is required');
    }

    // ── Rate limit per admin UID (fail-closed) ──────────────────────────────
    const rateLimited = !(
      await checkRateLimit(context.auth.uid, 'minute') &&
      await checkRateLimit(context.auth.uid, 'hour') &&
      await checkRateLimit(context.auth.uid, 'day')
    );
    if (rateLimited) {
      throw new HttpsError('resource-exhausted',
        'Too many refund-slip verification attempts — please wait and try again');
    }

    // ── Decode base64 ───────────────────────────────────────────────────────
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(file, 'base64');
    } catch (e) {
      throw new HttpsError('invalid-argument', 'Invalid base64 encoding');
    }
    if (fileBuffer.length < 100) {
      throw new HttpsError('invalid-argument', 'File too small to be a slip image');
    }

    // ── Call SlipOK ─────────────────────────────────────────────────────────
    let slipData;
    try {
      slipData = await callSlipOKAPI(fileBuffer);
    } catch (e) {
      const msg = e.message || '';
      const isSCBDelay = msg.includes('"code":1010') || msg.includes('ไทยพาณิชย์');
      if (isSCBDelay) {
        // Retryable business outcome — resolve, don't reject (mirror verifySlip).
        return {
          success: false,
          retryable: true,
          code: 'scb_delay',
          retryAfterSec: 120,
          message: 'สลิปธนาคารไทยพาณิชย์ใช้เวลาตรวจสอบประมาณ 2 นาทีหลังโอน กรุณารอแล้วลองใหม่อีกครั้ง',
        };
      }
      // Slip not valid is a business outcome — resolve with the reason so the admin
      // sees the specific SlipOK message (not a generic error toast).
      console.warn('verifyRefundSlip: SlipOK call failed:', msg);
      return { success: false, code: 'slip_invalid', error: msg, message: msg };
    }

    // ── Amount + receiver checks (ADVISORY — slip is authentic; admin decides) ─
    const slipAmount = Number(slipData.amount);
    const amountDiff = Math.abs(slipAmount - expected);
    const amountMatch = Number.isFinite(slipAmount) && amountDiff <= AMOUNT_TOLERANCE;
    if (!amountMatch) {
      console.warn(`⚠️ Refund-slip amount advisory: slip=฿${slipAmount}, expected=฿${expected} (b=${building||'-'} r=${room||'-'})`);
    }
    const receiverMatch = receiverMatches(slipData.receiver, expectedReceiver);

    const txid = isSafeTransactionId(slipData.transactionId) ? slipData.transactionId : null;

    return {
      success: true,
      data: {
        transactionId: txid,
        amount: Number.isFinite(slipAmount) ? slipAmount : null,
        sender: slipData.sender?.displayName || slipData.sender?.name || '',
        receiver: receiverLabel(slipData.receiver),
        date: slipData.transTimestamp || slipData.date || null,
        bankCode: slipData.sendingBankCode || '',
      },
      amountMatch,
      amountDiff,
      slipAmount: Number.isFinite(slipAmount) ? slipAmount : null,
      expectedAmount: expected,
      receiverMatch,
    };
  });
