/**
 * Firebase Cloud Function: Secure SlipOK Payment Verification
 *
 * This function securely verifies payment slips using the SlipOK API
 * API keys are stored in environment variables (not in client code)
 *
 * Deploy with: firebase deploy --only functions:verifySlip
 */

const functions = require('firebase-functions');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Initialize Firebase Admin SDK (if not already done)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ==================== CONFIGURATION ====================
// Secret: set via `firebase functions:secrets:set SLIPOK_API_KEY`
// Param:  set in functions/.env (e.g. SLIPOK_API_URL=https://api.slipok.com/...)
const SLIPOK_API_KEY = defineSecret('SLIPOK_API_KEY');
const SLIPOK_API_URL = defineString('SLIPOK_API_URL');

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

    const rateLimitRef = db.collection('rateLimits').doc(`${userId}_${timeWindow}`);
    const doc = await rateLimitRef.get();

    if (!doc.exists) {
      // First request
      await rateLimitRef.set({
        count: 1,
        windowStart: now,
        updatedAt: new Date()
      });
      return true;
    }

    const data = doc.data();
    const windowElapsed = now - data.windowStart;

    if (windowElapsed > timeMs) {
      // Window expired, reset
      await rateLimitRef.update({
        count: 1,
        windowStart: now,
        updatedAt: new Date()
      });
      return true;
    }

    // Still in window
    const maxRequests = {
      'minute': RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      'hour': RATE_LIMIT_CONFIG.maxRequestsPerHour,
      'day': RATE_LIMIT_CONFIG.maxRequestsPerDay
    }[timeWindow];

    if (data.count >= maxRequests) {
      console.warn(`⚠️ Rate limit exceeded for ${userId} (${timeWindow}): ${data.count}/${maxRequests}`);
      return false;
    }

    // Increment count
    await rateLimitRef.update({
      count: data.count + 1,
      updatedAt: new Date()
    });

    return true;
  } catch (error) {
    console.error('❌ Rate limit check failed:', error);
    // On error, allow request (fail open)
    return true;
  }
}

// ==================== VALIDATION ====================
/**
 * Validate request parameters
 * @param {object} params - Request parameters
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateRequest(params) {
  if (!params.file) {
    return { valid: false, error: 'File is required' };
  }

  if (typeof params.file !== 'string') {
    return { valid: false, error: 'File must be base64 string' };
  }

  if (!params.expectedAmount || params.expectedAmount <= 0) {
    return { valid: false, error: 'Expected amount must be positive' };
  }

  if (!params.room && !params.userId) {
    return { valid: false, error: 'Room ID or User ID is required' };
  }

  if (!params.building || !['rooms', 'nest'].includes(params.building)) {
    return { valid: false, error: 'Valid building is required (rooms or nest)' };
  }

  return { valid: true };
}

// ==================== TRANSACTION ID SAFETY ====================
/**
 * Validate transactionId is safe to use as a Firestore doc ID.
 * Firestore disallows '/', leading '.', and reserved prefixes; we additionally
 * cap length and restrict charset to defend against malformed SlipOK responses.
 */
function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
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

// ==================== LOGGING ====================
/**
 * Log verification attempt for audit trail
 * @param {object} params - Verification parameters
 * @param {object} result - Verification result
 * @param {string} status - 'success', 'failed', 'rate_limited', 'duplicate'
 */
async function logVerificationAttempt(params, result, status) {
  try {
    await db.collection('slipVerificationLog').add({
      status,
      building: params.building,
      room: params.room,
      userId: params.userId,
      expectedAmount: params.expectedAmount,
      verifiedAmount: result?.amount,
      transactionId: result?.transactionId,
      slipSender: result?.sender?.displayName || result?.sender?.name,
      slipDate: result?.date,
      error: result?.error,
      timestamp: new Date(),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent
    });
    // Verification log success is silent — main success log at end of
    // verifySlip handler is the single operational record.
  } catch (error) {
    console.error('⚠️ Failed to log verification:', error);
    // Don't throw - logging failure shouldn't break the main function
  }
}

// ==================== SAVE VERIFIED SLIP ====================
/**
 * Save verified slip data to Firestore
 * @param {object} slipData - Verified slip data
 * @param {object} params - Original request parameters
 */
async function saveVerifiedSlip(slipData, params) {
  // Use transactionId as doc ID + .create() so concurrent submissions of the
  // same slip can't both succeed — Firestore enforces doc-ID uniqueness
  // atomically. ALREADY_EXISTS (gRPC code 6) is propagated to the caller so
  // the user gets a duplicate response. Any other error is swallowed (storage
  // failure shouldn't break verification — slip is already proven valid).
  await db.collection('verifiedSlips').doc(slipData.transactionId).create({
    transactionId: slipData.transactionId,
    building: params.building,
    room: params.room,
    userId: params.userId,
    amount: slipData.amount,
    expectedAmount: params.expectedAmount,
    sender: slipData.sender?.displayName || slipData.sender?.name,
    receiver: slipData.receiver?.displayName || slipData.receiver?.name,
    date: slipData.date,
    bankCode: slipData.sendingBankCode,
    timestamp: new Date(),
    verifiedAt: new Date(),
    verified: true
  });
}

/**
 * Mark matching RTDB bill as paid so admin dashboard + tax aggregation stay in sync.
 * Looks up bills/{building}/{room}/* and flips the bill matching slip's billing month.
 * Non-blocking.
 */
async function markBillPaidInRTDB(slipData, params) {
  try {
    const rtdb = admin.database();
    const buildingRaw = params.building === 'nest' ? 'nest' : 'rooms';
    const room = String(params.room);
    if (!room) return;
    // Determine billing month (BKK)
    const BKK_OFFSET_MS = 7 * 3600 * 1000;
    const slipMs = new Date(slipData.transTimestamp || slipData.date || Date.now()).getTime();
    const bkk = new Date(slipMs + BKK_OFFSET_MS);
    const billYearBE = bkk.getUTCFullYear() + 543;
    const billMonth = bkk.getUTCMonth() + 1;
    const ref = rtdb.ref(`bills/${buildingRaw}/${room}`);
    const snap = await ref.once('value');
    const bills = snap.val() || {};
    const updates = {};
    let matched = 0;
    Object.keys(bills).forEach(billId => {
      const b = bills[billId];
      if (!b || b.status === 'paid') return;
      const by = Number(b.year); const bm = Number(b.month);
      const byBE = by < 2400 ? 2500 + (by % 100) : by;
      if (byBE === billYearBE && bm === billMonth) {
        updates[`${billId}/status`] = 'paid';
        updates[`${billId}/paidAt`] = Date.now();
        updates[`${billId}/paidVia`] = 'tenant_app_slipok';
        updates[`${billId}/paidRef`] = slipData.transactionId || '';
        matched++;
      }
    });
    if (matched > 0) {
      await ref.update(updates);
      console.log(`💸 RTDB bill(s) marked paid: ${buildingRaw}/${room} × ${matched} (${billMonth}/${billYearBE})`);
    }
  } catch (e) {
    console.error('⚠️ markBillPaidInRTDB failed:', e?.message);
  }
}

// ==================== PAYMENT GAMIFICATION (Nest only) ====================
/**
 * Record on-time/late payment stats and award gamification points.
 * Writes tenants/{id}/paymentHistory/{YYYY-MM} + updates gamification counters.
 * Non-blocking: caller should wrap in try/catch so failures don't break verify.
 */
async function recordPaymentAndAwardPoints(slipData, params) {
  if (params.building !== 'nest') return null;

  // Firestore schema: tenants/{building}/list/{roomId}
  const roomId = String(params.room);
  const tenantRef = db.collection('tenants').doc('nest').collection('list').doc(roomId);
  const tenantDoc = await tenantRef.get();

  if (!tenantDoc.exists) {
    return null;  // No tenant doc → no points to award (rooms-building tenants don't get points)
  }

  const tenantData = tenantDoc.data();
  const dueDay = tenantData.lease?.dueDay || tenantData.dueDay || 5;

  const slipMs = new Date(slipData.transTimestamp || slipData.date).getTime();
  if (isNaN(slipMs)) {
    console.warn('🎮 Invalid slip timestamp, skipping award');
    return null;
  }

  // Bangkok timezone (UTC+7) — Cloud Functions run in UTC, so shift explicitly
  const BKK_OFFSET_MS = 7 * 3600 * 1000;
  const slipBkk = new Date(slipMs + BKK_OFFSET_MS);
  const billYear = slipBkk.getUTCFullYear();
  const billMonthIdx = slipBkk.getUTCMonth();
  const monthKey = `${billYear}-${String(billMonthIdx + 1).padStart(2, '0')}`;

  // Due date = end of dueDay of bill month in BKK → convert to UTC ms
  const dueBkkMs = Date.UTC(billYear, billMonthIdx, dueDay, 23, 59, 59);
  const dueUtcMs = dueBkkMs - BKK_OFFSET_MS;
  const daysDiff = Math.floor((slipMs - dueUtcMs) / 86400000);

  let points, status;
  if (daysDiff <= -4)     { points = 150; status = 'early_bird'; }
  else if (daysDiff <= 0) { points = 100; status = 'on_time'; }
  else if (daysDiff <= 3) { points = 40;  status = 'slightly_late'; }
  else if (daysDiff <= 5) { points = 15;  status = 'late'; }
  else                    { points = 0;   status = 'too_late'; }

  const historyRef = tenantRef.collection('paymentHistory').doc(monthKey);
  const existing = await historyRef.get();
  if (existing.exists) {
    // Idempotent: already awarded for this month, no-op silently
    return { skipped: true, monthKey };
  }

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(tenantRef);
    const g = fresh.data()?.gamification || {};
    const isOnTime = daysDiff <= 0;
    const newStreak = isOnTime ? (g.currentStreak || 0) + 1 : 0;

    tx.set(historyRef, {
      slipDate: new Date(slipMs),
      dueDate: new Date(dueUtcMs),
      amount: slipData.amount,
      status,
      daysDiff,
      points,
      transactionId: slipData.transactionId,
      recordedAt: new Date()
    });

    tx.update(tenantRef, {
      'gamification.points': (g.points || 0) + points,
      'gamification.paymentPoints': (g.paymentPoints || 0) + points,
      'gamification.onTimeCount': (g.onTimeCount || 0) + (isOnTime ? 1 : 0),
      'gamification.lateCount': (g.lateCount || 0) + (isOnTime ? 0 : 1),
      'gamification.currentStreak': newStreak,
      'gamification.longestStreak': Math.max(g.longestStreak || 0, newStreak),
      'gamification.lastPaymentStatus': status,
      'gamification.lastPaymentAt': new Date()
    });
  });

  console.log(`🎮 Awarded ${points}pts to nest/${roomId} (${status}, daysDiff=${daysDiff}, month=${monthKey})`);
  return { roomId, points, status, daysDiff, monthKey };
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
  .runWith({ secrets: [SLIPOK_API_KEY] })
  .https.onRequest(async (req, res) => {
  try {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ===== AUTH — require Firebase ID token from signed-in admin =====
    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    // ===== VALIDATION =====
    const validation = validateRequest(req.body);
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
    console.log(`✅ Slip verified: ${identifier}, Amount: ฿${slipData.amount}`);

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

