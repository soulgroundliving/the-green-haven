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
// §7-YY: do NOT require('form-data') — the Node 22 undici global fetch can't
// serialize that package's instance (it stringifies to "[object FormData]" →
// sent as text/plain ~17 bytes → SlipOK 400 "missing data/files/url").
// callSlipOKAPI builds the body with the global FormData + Blob instead, which
// undici emits as a real multipart/form-data body + boundary.
const { getValidBuildings } = require('./buildingRegistry');
const { assertTenantAccess } = require('./_authSoT');
const { appendPointsLedger } = require('./_pointsLedger');
const { appendActionAudit } = require('./_actionAudit');
const { assignReceiptNo } = require('./_receiptCounter');

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

// ==================== VALIDATION ====================
/**
 * Validate request parameters
 * @param {object} params - Request parameters
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateRequest(params, validBuildings) {
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

  if (!params.building || !validBuildings.has(params.building)) {
    return { valid: false, error: `Valid building is required (${[...validBuildings].join(' or ')})` };
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
    // §7-YY: global FormData + Blob (NOT the form-data pkg) so undici sends real
    // multipart. Do NOT set Content-Type — undici derives the boundary.
    form.append('files', new Blob([fileBuffer], { type: mimeType }), `slip.${ext}`);

    const response = await fetch(SLIPOK_API_URL.value(), {
      method: 'POST',
      headers: {
        'x-authorization': SLIPOK_API_KEY.value()
      },
      body: form,
      // §7-YY: undici ignores the node-fetch `timeout` option (it was a silent
      // no-op); AbortSignal.timeout actually aborts a hung request after 30s.
      signal: AbortSignal.timeout(30000),
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
async function saveVerifiedSlip(slipData, params, auditActor, receiptCtx) {
  // Atomic dedup + gapless receipt number + audit, all in ONE transaction so a
  // duplicate slip never consumes a receipt number (the whole tx rolls back → no
  // gap in the sequence — Roadmap 1.2a). Dedup is by tx.get(slipRef): if the doc
  // already exists the slip was verified before → throw ALREADY_EXISTS (gRPC 6)
  // for the caller's duplicate handler. The PAYMENT_VERIFIED audit row commits in
  // the same tx (tamper-proof, Phase 1.1 PR 1b) — all buildings, not just the nest
  // gamification path. The receipt number RCP-{building}-{BE}-{NNNNN} is persisted
  // on the slip and RETURNED for the receipt Flex + RTDB mirror. Any error bubbles
  // to the caller, which keeps verification non-blocking (slip proven valid).
  const slipRef = db.collection('verifiedSlips').doc(slipData.transactionId);
  const building = params.building || 'rooms';
  const be = (receiptCtx && receiptCtx.be) || (new Date().getUTCFullYear() + 543);

  const receiptNo = await db.runTransaction(async (tx) => {
    // READ 1 — dedup. (Firestore requires all reads before all writes.)
    const slipSnap = await tx.get(slipRef);
    if (slipSnap.exists) {
      const dupErr = new Error('Duplicate slip — this transaction has already been verified.');
      dupErr.code = 6; // gRPC ALREADY_EXISTS — recognised by the caller's catch below
      throw dupErr;
    }

    // READ 2 + first WRITE — assignReceiptNo reads the counter then sets it
    // (no tx.get may follow this call). Number only minted for a unique slip.
    const { receiptNo: rcpt } = await assignReceiptNo(tx, db, { building, be });

    tx.set(slipRef, {
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
      receiptNo: rcpt,
      timestamp: new Date(),
      verifiedAt: new Date(),
      verified: true
    });

    // actor/role/ip resolved server-side by the caller from the verified onCall
    // context (never client-supplied). idempotencyKey = transactionId → one audit
    // row per slip, ever.
    appendActionAudit(tx, db, {
      actor:      (auditActor && auditActor.actor) || params.userId || 'system',
      actorEmail: (auditActor && auditActor.actorEmail) || null,
      actorRole:  (auditActor && auditActor.actorRole) || null,
      action:     'PAYMENT_VERIFIED',
      targetType: 'payment',
      targetId:   slipData.transactionId,
      building:   params.building || null,
      roomId:     params.room != null ? String(params.room) : null,
      after: {
        amount: slipData.amount,
        expectedAmount: params.expectedAmount,
        bankCode: slipData.sendingBankCode || null,
        receiptNo: rcpt,
      },
      ip:             (auditActor && auditActor.ip) || null,
      source:         'cf:verifySlip',
      idempotencyKey: slipData.transactionId,
    });

    return rcpt;
  });

  return receiptNo;
}

/**
 * Mark matching RTDB bill as paid so admin dashboard + tax aggregation stay in sync.
 * Looks up bills/{building}/{room}/* and flips the bill matching slip's billing month.
 * Non-blocking.
 */
async function markBillPaidInRTDB(slipData, params, receiptNo) {
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
        if (receiptNo) updates[`${billId}/receiptNo`] = receiptNo;  // gapless RCP- (Roadmap 1.2a)
        matched++;
      }
    });
    if (matched > 0) {
      await ref.update(updates);
    }

    // Mirror payment record into payments/{b}/{r}/{pushId} for admin
    // reconciliation audit trail. RTDB payments .write rule locked to
    // admin-only as of 2026-05-22 security sprint (anti-pattern NC-1 fix);
    // this CF write via Admin SDK is the new canonical writer. Previously
    // tenant_app.html:12122 pushed from client — that path now silent-fails
    // per the locked-down rule (caught by existing try/catch; localStorage
    // cache preserves tenant UI). Runs even when matched === 0 so the slip
    // audit trail has no gaps if a matching bill is missing.
    //
    // Field shape mirrors the legacy client push at tenant_app.html:12100
    // (billId/month/year/amount/paidAt/method/transRef/building/room) so
    // downstream readers (TenantFirebaseSync.loadPaymentHistory, dashboard
    // reconciliation) see consistent records pre- and post-migration.
    try {
      const firstMatchedBillId = matched > 0
        ? Object.keys(updates).find(k => k.endsWith('/status'))?.split('/')[0] || null
        : null;
      const nowIso = new Date().toISOString();
      await rtdb.ref(`payments/${buildingRaw}/${room}`).push({
        billId: firstMatchedBillId,
        month: billMonth,
        year: billYearBE,
        amount: Number(slipData.amount) || 0,
        paidAt: nowIso,
        createdAt: nowIso,
        method: 'PromptPay',
        slipOkVerified: true,
        transRef: slipData.transactionId || null,
        transactionId: slipData.transactionId || null,  // alias for forward-compat readers
        receiptNo: receiptNo || null,                    // gapless RCP- (Roadmap 1.2a)
        building: buildingRaw,
        room: room,
        sender: (slipData.sender && (slipData.sender.displayName || slipData.sender.name)) || '',
        matchedBillCount: matched,
        source: 'cf:verifySlip',
      });
    } catch (paymentsErr) {
      console.error('⚠️ markBillPaidInRTDB: payments/ audit write failed:', paymentsErr?.message);
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

    // Append the points event to the ledger in the SAME tx (skip 0-point
    // 'too_late' payments — the ledger records point movements, not every slip).
    if (points > 0) {
      appendPointsLedger(tx, db, {
        tenantId: tenantData.tenantId || `nest_${roomId}`,
        building: 'nest',
        roomId,
        source: 'payment', discriminator: monthKey,
        points,
        balanceAfter: (g.points || 0) + points,
        by: params.userId || 'system',
        refId: slipData.transactionId,
      });
    }
  });

  return { roomId, points, status, daysDiff, monthKey };
}

// ==================== RECEIPT NOTIFICATION ====================
/**
 * Push a LINE "ใบเสร็จรับเงิน" Flex to all approved tenants for the room.
 * Non-blocking — caller must wrap in try/catch.
 */
async function sendReceiptNotification(slipData, params, receiptNo) {
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

  const receiptMsg = buildReceiptFlex(billForReceipt, { tenantName, paidAt, receiptNo });

  await Promise.allSettled(usersSnap.docs.map(udoc =>
    fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: udoc.id, messages: [receiptMsg] })
    })
  ));

}

// ==================== MAIN CLOUD FUNCTION ====================
/**
 * Callable Cloud Function: Verify payment slip with SlipOK.
 *
 * Migrated 2026-06-02 from https.onRequest → https.onCall for transport-layer
 * auth consistency with the 7 other tenant-gated callables (_authSoT). The
 * Firebase SDK auto-attaches the caller's ID token into `context.auth`, so the
 * old manual `Authorization: Bearer` parse + manual CORS are gone. Auth is now
 * "admin OR the room's own tenant" via assertTenantAccess (was admin-only,
 * which had silently 401'd every tenant self-verify since 2026-04-24 —
 * gamification tiers are computed from the tenant's own slip date, so tenant
 * self-verify was always the intended design).
 *
 * Request data:
 * {
 *   file: "base64-encoded image",
 *   expectedAmount: 2828,
 *   building: "rooms" | "nest" | <canonical building id>,
 *   room: "15",
 *   userId: "tenant_15"   // legacy fallback; all live callers send room
 * }
 *
 * Resolves on success:
 *   { success: true, data: {...}, amountValid: true, amountDiff }
 * Resolves (NOT rejects) on slip business-outcomes so the UI shows the reason:
 *   scb_delay (retryable), amount_mismatch, isDuplicate, slip-not-valid →
 *   { success: false, ... }
 * Rejects with HttpsError on true errors:
 *   unauthenticated / permission-denied (auth), invalid-argument (bad input),
 *   resource-exhausted (rate limit), internal (unexpected).
 */
exports.verifySlip = functions
  .region('asia-southeast1')
  .runWith({ secrets: [SLIPOK_API_KEY, LINE_CHANNEL_ACCESS_TOKEN] })
  .https.onCall(async (data, context) => {
    const { HttpsError } = functions.https;
    // Request metadata for the audit log (v1 onCall exposes the raw request).
    const ipAddress = context.rawRequest?.ip;
    const userAgent = context.rawRequest?.get?.('user-agent');

    try {
      // ===== VALIDATION (before auth — assertTenantAccess needs building+room) =====
      const validBuildings = await getValidBuildings();
      const validation = validateRequest(data, validBuildings);
      if (!validation.valid) {
        throw new HttpsError('invalid-argument', validation.error);
      }

      const { file, expectedAmount, building, room, userId } = data;
      const identifier = room || userId;

      // ===== AUTH — admin OR the room's own tenant =====
      // assertTenantAccess: Path 0 admin · Path 1 claim (room+building) ·
      // Path 1b tenantId · Path 2a linkedAuthUid. Survives §7-Z claim-strip +
      // §7-HH stale-UID. Throws unauthenticated/permission-denied on failure.
      await assertTenantAccess({
        building,
        roomId: String(room || ''),
        context,
        firestore: db,
        HttpsError,
      });

      // ===== SIZE CAP — reject payloads larger than ~5MB base64 (~3.75MB binary) =====
      if (typeof file !== 'string' || file.length > 5 * 1024 * 1024) {
        throw new HttpsError('invalid-argument', 'Payload too large (max 5MB base64)');
      }

      // ===== RATE LIMITING =====
      const rateLimited = !(
        await checkRateLimit(identifier, 'minute') &&
        await checkRateLimit(identifier, 'hour') &&
        await checkRateLimit(identifier, 'day')
      );

      if (rateLimited) {
        await logVerificationAttempt(
          { ...data, ipAddress, userAgent },
          { error: 'Rate limited' },
          'rate_limited'
        );
        throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.', { retryAfter: 60 });
      }

      // ===== CONVERT BASE64 TO BUFFER =====
      let fileBuffer;
      try {
        fileBuffer = Buffer.from(file, 'base64');
      } catch (error) {
        throw new HttpsError('invalid-argument', 'Invalid base64 encoding');
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
            { ...data, ipAddress, userAgent },
            { error: 'scb_delay' },
            'scb_delay'
          );
          // Business outcome (retryable) — resolve, don't reject.
          return {
            success: false,
            retryable: true,
            code: 'scb_delay',
            retryAfterSec: 120,
            message: 'สลิปธนาคารไทยพาณิชย์ใช้เวลาตรวจสอบประมาณ 2 นาทีหลังโอน กรุณารอแล้วลองใหม่อีกครั้ง'
          };
        }
        await logVerificationAttempt(
          { ...data, ipAddress, userAgent },
          { error: error.message },
          'failed'
        );
        // Slip-not-valid is a business outcome — resolve with the reason so the
        // client shows the specific SlipOK message (not a generic error toast).
        return { success: false, error: error.message, message: error.message };
      }

      // ===== VALIDATE AMOUNT — business reject (resolve, don't throw) =====
      // Hard reject |diff| > 1 (frontend doesn't read amountValid, so the old
      // "warn but return success" path was data poisoning: a ฿1 slip against a
      // ฿10,000 bill saved as paid).
      const amountDiff = Math.abs(slipData.amount - expectedAmount);
      if (amountDiff > 1) {
        console.warn(`⚠️ Amount mismatch: expected ฿${expectedAmount}, got ฿${slipData.amount}`);
        await logVerificationAttempt(
          { ...data, ipAddress, userAgent },
          slipData,
          'amount_mismatch'
        );
        const mismatchMsg = `จำนวนเงินไม่ตรงกับยอดบิล (สลิป ฿${slipData.amount} / ต้องการ ฿${expectedAmount})`;
        return {
          success: false,
          error: mismatchMsg,
          message: mismatchMsg,
          code: 'amount_mismatch',
          slipAmount: slipData.amount,
          expectedAmount
        };
      }

      // ===== VALIDATE TRANSACTION ID + SAVE (atomic dedup + receipt number) =====
      // saveVerifiedSlip runs a transaction: doc ID = transactionId, tx.get dedup
      // (exists → throw ALREADY_EXISTS), then mints the gapless receipt number +
      // writes the slip + audit row atomically. Replaces the old where()+add()
      // race window; a duplicate consumes no receipt number.
      if (!isSafeTransactionId(slipData.transactionId)) {
        console.warn(`⚠️ Unsafe transactionId from SlipOK: ${slipData.transactionId}`);
        return { success: false, error: 'Invalid slip transaction id', message: 'Invalid slip transaction id' };
      }

      let receiptNo = null;
      try {
        // actor/role/ip stamped from the VERIFIED onCall context (never client
        // data) for the in-tx PAYMENT_VERIFIED audit row. be = BKK Buddhist-Era
        // year of the payment → the gapless RCP-{building}-{BE}-{NNNNN} counter
        // (Roadmap 1.2a). saveVerifiedSlip returns the assigned receipt number.
        const _slipMs = new Date(slipData.transTimestamp || slipData.date || Date.now()).getTime();
        const _be = new Date((isNaN(_slipMs) ? Date.now() : _slipMs) + 7 * 3600 * 1000).getUTCFullYear() + 543;
        receiptNo = await saveVerifiedSlip(slipData, data, {
          actor:      context.auth?.uid || data.userId || 'system',
          actorEmail: context.auth?.token?.email || null,
          actorRole:  context.auth?.token?.admin === true ? 'admin' : 'tenant',
          ip:         ipAddress,
        }, { be: _be });
      } catch (e) {
        // gRPC code 6 = ALREADY_EXISTS → atomic duplicate detection (string form varies by SDK version)
        if (e && (e.code === 6 || e.code === 'already-exists' || e.code === 'ALREADY_EXISTS' ||
                  e?.message?.toLowerCase().includes('already exists'))) {
          console.warn(`🚨 Duplicate slip detected (atomic): ${slipData.transactionId}`);
          await logVerificationAttempt(
            { ...data, ipAddress, userAgent },
            slipData,
            'duplicate'
          );
          return {
            success: false,
            error: 'Duplicate slip — this transaction has already been verified.',
            message: 'Duplicate slip — this transaction has already been verified.',
            isDuplicate: true
          };
        }
        // Other errors: log but don't break (slip was proven valid by SlipOK).
        console.error('⚠️ Failed to save verified slip (non-blocking):', e);
      }

      // ===== MARK RTDB BILL AS PAID (non-blocking) =====
      try {
        await markBillPaidInRTDB(slipData, data, receiptNo);
      } catch (e) {
        console.error('⚠️ markBillPaidInRTDB failed (non-blocking):', e);
      }

      // ===== SEND RECEIPT NOTIFICATION (non-blocking) =====
      try {
        await sendReceiptNotification(slipData, data, receiptNo);
      } catch (e) {
        console.error('⚠️ sendReceiptNotification failed (non-blocking):', e);
      }

      // ===== GAMIFICATION: record payment + award points (non-blocking) =====
      try {
        await recordPaymentAndAwardPoints(slipData, data);
      } catch (e) {
        console.error('⚠️ Gamification award failed (non-blocking):', e);
      }

      // ===== LOG SUCCESS =====
      await logVerificationAttempt(
        { ...data, ipAddress, userAgent },
        slipData,
        'success'
      );

      // ===== RETURN SUCCESS =====
      // amountDiff is guaranteed ≤1 by the validation above; amountValid kept
      // in response for backward compat with any caller that reads it.
      return {
        success: true,
        data: slipData,
        amountValid: true,
        amountDiff
      };

    } catch (error) {
      // Preserve typed errors (auth/validation/rate-limit) — re-throw as-is so
      // the SDK surfaces the correct code; only wrap genuinely-unexpected ones.
      if (error instanceof HttpsError) throw error;
      console.error('❌ Unexpected error in verifySlip:', error);
      throw new HttpsError('internal', error.message || 'Internal server error');
    }
  });

