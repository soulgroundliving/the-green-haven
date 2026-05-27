/**
 * Firebase Cloud Function: Secure SlipOK Payment Verification
 *
 * This function securely verifies payment slips using the SlipOK API
 * API keys are stored in environment variables (not in client code)
 *
 * Deploy with: firebase deploy --only functions:verifySlip
 */

const functions = require('firebase-functions/v1');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Initialize Firebase Admin SDK (if not already done)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const { validateRequest, isSafeTransactionId } = require('./_verifySlipValidate');
const { logVerificationAttempt, saveVerifiedSlip, markBillPaidInRTDB, recordPaymentAndAwardPoints } = require('./_verifySlipWrite');

// ==================== CONFIGURATION ====================
// Secret: set via `firebase functions:secrets:set SLIPOK_API_KEY`
// Param:  set in functions/.env (e.g. SLIPOK_API_URL=https://api.slipok.com/...)
const SLIPOK_API_KEY = defineSecret('SLIPOK_API_KEY');
const SLIPOK_API_URL = defineString('SLIPOK_API_URL');
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

// Rate limiting configuration
// Per-room/userId caps (not global — admin can still verify all rooms in a
// peak-billing month). Daily cap dropped from 1000→50 on 2026-04-28: a
// legitimate tenant pays once a month, so 50/day per room is still 50× the
// expected volume but bounds SlipOK quota drain from any single compromised
// LIFF account at ~$0.50/day per room (1500/mo) instead of 30,000/mo.
const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 10,  // Burst tolerance for retries
  maxRequestsPerHour: 30,    // ~1 payment per 2 min sustained — still way over real need
  maxRequestsPerDay: 50      // 50 SlipOK calls/room/day (was 1000)
};

// ==================== RATE LIMITING ====================
/**
 * Check if request should be rate limited
 * @param {string} userId - User ID or room ID
 * @param {string} timeWindow - 'minute', 'hour', or 'day'
 * @returns {Promise<boolean>} - true if allowed, false if rate limited
 */
async function checkRateLimit(userId, timeWindow = 'minute') {
  try {
    const now = Date.now();
    const timeMs = {
      'minute': 60 * 1000,
      'hour': 60 * 60 * 1000,
      'day': 24 * 60 * 60 * 1000
    }[timeWindow];
    const maxRequests = {
      'minute': RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      'hour': RATE_LIMIT_CONFIG.maxRequestsPerHour,
      'day': RATE_LIMIT_CONFIG.maxRequestsPerDay
    }[timeWindow];

    const rateLimitRef = db.collection('rateLimits').doc(`${userId}_${timeWindow}`);

    // Wrap in a Firestore transaction so concurrent CF instances can't race past
    // the limit. Without a transaction, two instances that both read count=N at
    // the same moment would both write count=N+1 — allowing 2× the intended
    // requests. runTransaction retries the losing writer so it re-reads the
    // committed value and enforces the cap correctly.
    const allowed = await db.runTransaction(async (tx) => {
      const doc = await tx.get(rateLimitRef);

      if (!doc.exists) {
        // First request in this window — create document atomically.
        tx.set(rateLimitRef, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }

      const data = doc.data();
      const windowElapsed = now - data.windowStart;

      if (windowElapsed > timeMs) {
        // Window expired — reset counter atomically.
        tx.set(rateLimitRef, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }

      // Still inside the active window.
      if (data.count >= maxRequests) {
        console.warn(`⚠️ Rate limit exceeded for ${userId} (${timeWindow}): ${data.count}/${maxRequests}`);
        return false;  // no write — transaction commits as a no-op read
      }

      // Increment counter atomically.
      tx.update(rateLimitRef, { count: data.count + 1, updatedAt: new Date() });
      return true;
    });

    return allowed;
  } catch (error) {
    console.error('❌ Rate limit check failed (failing CLOSED for safety):', error);
    // Fail CLOSED — Firestore throttle/outage should NOT silently grant a bypass
    // of all three rate-limit windows simultaneously. Caller turns false into a
    // 'resource-exhausted' HttpsError → client gets a retry-able 503-shape.
    // A 503 spike is alertable; an abuse spike via fail-open is silent.
    return false;
  }
}

// ==================== SLIPOK API CALL ====================
/**
 * Call SlipOK API to verify payment slip
 * @param {Buffer} fileBuffer - Image file buffer
 * @returns {Promise<object>} - SlipOK response data
 */
async function callSlipOKAPI(fileBuffer) {
  try {
    const form = new FormData();
    // Detect image type from buffer magic bytes
    let mimeType = 'image/jpeg';
    let ext = 'jpg';
    if (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) { mimeType = 'image/png'; ext = 'png'; }
    else if (fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49) { mimeType = 'image/gif'; ext = 'gif'; }
    else if (fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49) { mimeType = 'image/webp'; ext = 'webp'; }
    form.append('files', fileBuffer, { filename: `slip.${ext}`, contentType: mimeType });

    const response = await fetch(SLIPOK_API_URL.value(), {
      method: 'POST',
      headers: {
        'x-authorization': SLIPOK_API_KEY.value()
      },
      body: form,
      timeout: 30000 // 30 second timeout
    });

    const responseText = await response.text();
    // Note: success bodies omitted from logs to keep Cloud Logging volume
    // low. Failures still include up to 300 chars in the thrown error
    // (see line below + caller's catch).

    if (!response.ok) {
      console.warn(`📡 SlipOK ${response.status}:`, responseText.slice(0, 300));
      throw new Error(`SlipOK API returned ${response.status}: ${responseText.slice(0, 300)}`);
    }

    let data;
    try { data = JSON.parse(responseText); } catch(e) { throw new Error(`SlipOK non-JSON response: ${responseText.slice(0, 200)}`); }

    if (!data.success) {
      throw new Error(data.message || 'SlipOK verification failed');
    }

    // Normalize: SlipOK returns `transRef` but our code uses `transactionId`
    if (data.data && !data.data.transactionId) {
      data.data.transactionId = data.data.transRef || data.data.ref || null;
    }

    return data.data;
  } catch (error) {
    console.error('❌ SlipOK API call failed:', error);
    throw new Error(`SlipOK verification error: ${error.message}`);
  }
}

// ==================== RECEIPT NOTIFICATION ====================
/**
 * Push a LINE "ใบเสร็จรับเงิน" Flex to all approved tenants for the room.
 * Non-blocking — caller must wrap in try/catch.
 */
async function sendReceiptNotification(slipData, params) {
  const token = LINE_CHANNEL_ACCESS_TOKEN.value();
  if (!token) return;

  const building = params.building === 'nest' ? 'nest' : 'rooms';
  const room = String(params.room || '');
  if (!room) return;

  // Find approved LINE user IDs for the room
  const usersSnap = await db.collection('liffUsers')
    .where('building', '==', building)
    .where('room', '==', room)
    .where('status', '==', 'approved')
    .get();
  if (usersSnap.empty) return;

  // Fetch RTDB bill for line-item breakdown
  const billSnap = await admin.database().ref(`bills/${building}/${room}`).once('value');
  const billsObj = billSnap.val() || {};
  const allBills = Object.values(billsObj).filter(Boolean);
  // Prefer the bill we just marked paid by transactionId, fall back to latest paid bill
  const paidBill = allBills.find(b => b.paidRef === slipData.transactionId)
    || allBills.filter(b => b.status === 'paid').sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))[0];

  // Tenant name from SSoT
  const tenantDoc = await db.collection('tenants').doc(building).collection('list').doc(room).get();
  const tenantName = tenantDoc.exists ? (tenantDoc.data()?.name || '') : '';

  const { buildReceiptFlex } = require('./_billFlex');
  const paidAt = new Date(slipData.transTimestamp || slipData.date || Date.now());

  // Fallback bill shape when no RTDB bill matched (shows only total)
  const billForReceipt = paidBill || {
    room, building,
    month: paidAt.getMonth() + 1,
    year: paidAt.getFullYear() + 543,
    rent: 0, eCost: 0, wCost: 0, trash: 0, eUnits: 0, wUnits: 0,
    totalCharge: slipData.amount
  };

  const receiptMsg = buildReceiptFlex(billForReceipt, { tenantName, paidAt });

  await Promise.allSettled(usersSnap.docs.map(udoc =>
    fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: udoc.id, messages: [receiptMsg] })
    })
  ));

  console.info(`🧾 Receipt notification sent: ${building}/${room} → ${usersSnap.size} user(s)`);
}

// ==================== MAIN CLOUD FUNCTION ====================
/**
 * HTTP Cloud Function: Verify payment slip with SlipOK
 *
 * Request body:
 * {
 *   file: "base64-encoded image",
 *   expectedAmount: 2828,
 *   building: "rooms" or "nest",
 *   room: "15",
 *   userId: "tenant_15" // if no room provided
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     amount: 2828,
 *     sender: { displayName: "Bank Name", ... },
 *     receiver: { ... },
 *     transactionId: "...",
 *     date: "...",
 *     sendingBankCode: "..."
 *   }
 * }
 */
exports.verifySlip = functions
  .region('asia-southeast1')
  .runWith({ secrets: [SLIPOK_API_KEY, LINE_CHANNEL_ACCESS_TOKEN] })
  .https.onRequest(async (req, res) => {
  try {
    // CORS headers
    res.set('Access-Control-Allow-Origin', 'https://the-green-haven.vercel.app');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method === 'GET') {
      return res.status(200).json({ status: 'ok', ts: Date.now() });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ===== AUTH — require Firebase ID token from signed-in admin =====
    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    // ===== VALIDATION =====
    const validation = await validateRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { file, expectedAmount, building, room, userId } = req.body;
    const identifier = room || userId;

    // ===== SIZE CAP — reject payloads larger than ~5MB base64 (~3.75MB binary) =====
    if (typeof file !== 'string' || file.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Payload too large (max 5MB base64)' });
    }

    // ===== RATE LIMITING =====
    const rateLimited = !(
      await checkRateLimit(identifier, 'minute') &&
      await checkRateLimit(identifier, 'hour') &&
      await checkRateLimit(identifier, 'day')
    );

    if (rateLimited) {
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        { error: 'Rate limited' },
        'rate_limited'
      );
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: 60
      });
    }

    // ===== CONVERT BASE64 TO BUFFER =====
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(file, 'base64');
    } catch (error) {
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }

    // ===== CALL SLIPOK API =====
    let slipData;
    try {
      slipData = await callSlipOKAPI(fileBuffer);
    } catch (error) {
      // SCB-specific delay (SlipOK code 1010): ไทยพาณิชย์ takes ~2 minutes to register the slip
      const msg = error.message || '';
      const isSCBDelay = msg.includes('"code":1010') || msg.includes('ไทยพาณิชย์');
      if (isSCBDelay) {
        await logVerificationAttempt(
          { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
          { error: 'scb_delay' },
          'scb_delay'
        );
        return res.status(200).json({
          success: false,
          retryable: true,
          code: 'scb_delay',
          retryAfterSec: 120,
          message: 'สลิปธนาคารไทยพาณิชย์ใช้เวลาตรวจสอบประมาณ 2 นาทีหลังโอน กรุณารอแล้วลองใหม่อีกครั้ง'
        });
      }
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        { error: error.message },
        'failed'
      );
      return res.status(400).json({ error: error.message });
    }

    // ===== VALIDATE AMOUNT =====
    // Reject (do not "warn and continue") — frontend doesn't read amountValid,
    // so the old "warn but return success" path was data poisoning: a ฿1 slip
    // against a ฿10,000 bill returned success and was saved as paid.
    const amountDiff = Math.abs(slipData.amount - expectedAmount);
    if (amountDiff > 1) {
      console.warn(`⚠️ Amount mismatch: expected ฿${expectedAmount}, got ฿${slipData.amount}`);
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        slipData,
        'amount_mismatch'
      );
      return res.status(400).json({
        error: `จำนวนเงินไม่ตรงกับยอดบิล (สลิป ฿${slipData.amount} / ต้องการ ฿${expectedAmount})`,
        code: 'amount_mismatch',
        slipAmount: slipData.amount,
        expectedAmount
      });
    }

    // ===== VALIDATE TRANSACTION ID + SAVE (atomic duplicate detection) =====
    // doc ID = transactionId + .create() — two concurrent submissions can't
    // both succeed; replaces the old where()+add() pattern that had a race
    // window between check and write.
    if (!isSafeTransactionId(slipData.transactionId)) {
      console.warn(`⚠️ Unsafe transactionId from SlipOK: ${slipData.transactionId}`);
      return res.status(400).json({ error: 'Invalid slip transaction id' });
    }

    try {
      await saveVerifiedSlip(slipData, req.body);
    } catch (e) {
      // gRPC code 6 = ALREADY_EXISTS → atomic duplicate detection (string form varies by SDK version)
      if (e && (e.code === 6 || e.code === 'already-exists' || e.code === 'ALREADY_EXISTS' ||
                e?.message?.toLowerCase().includes('already exists'))) {
        console.warn(`🚨 Duplicate slip detected (atomic): ${slipData.transactionId}`);
        await logVerificationAttempt(
          { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
          slipData,
          'duplicate'
        );
        return res.status(400).json({
          error: 'Duplicate slip — this transaction has already been verified.',
          isDuplicate: true
        });
      }
      // Other errors: log but don't break (slip was proven valid by SlipOK).
      console.error('⚠️ Failed to save verified slip (non-blocking):', e);
    }

    // ===== MARK RTDB BILL AS PAID (non-blocking) =====
    try {
      await markBillPaidInRTDB(slipData, req.body);
    } catch (e) {
      console.error('⚠️ markBillPaidInRTDB failed (non-blocking):', e);
    }

    // ===== SEND RECEIPT NOTIFICATION (non-blocking) =====
    try {
      await sendReceiptNotification(slipData, req.body);
    } catch (e) {
      console.error('⚠️ sendReceiptNotification failed (non-blocking):', e);
    }

    // ===== GAMIFICATION: record payment + award points (non-blocking) =====
    try {
      await recordPaymentAndAwardPoints(slipData, req.body);
    } catch (e) {
      console.error('⚠️ Gamification award failed (non-blocking):', e);
    }

    // ===== LOG SUCCESS =====
    await logVerificationAttempt(
      { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
      slipData,
      'success'
    );

    // ===== RETURN SUCCESS =====
    // amountDiff is guaranteed ≤1 by the validation above; amountValid kept
    // in response for backward compat with any caller that reads it.
    console.info(`✅ Slip verified: ${identifier}, Amount: ฿${slipData.amount}`);

    return res.status(200).json({
      success: true,
      data: slipData,
      amountValid: true,
      amountDiff
    });

  } catch (error) {
    console.error('❌ Unexpected error in verifySlip:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

