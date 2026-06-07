'use strict';

/**
 * verifySlip — Firestore/RTDB write helpers.
 * Extracted from verifySlip.js to keep the main handler readable.
 */

const admin = require('firebase-admin');
if (!admin.apps.length) { admin.initializeApp(); }
const db = admin.firestore();

// ==================== AUDIT LOG ====================
/**
 * Log verification attempt for audit trail.
 * @param {object} params - Verification parameters (includes ipAddress, userAgent)
 * @param {object} result - Verification result or error object
 * @param {string} status - 'success' | 'failed' | 'rate_limited' | 'duplicate' | 'amount_mismatch' | 'scb_delay'
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
    // Don't throw — logging failure shouldn't break the main function
  }
}

// ==================== SAVE VERIFIED SLIP ====================
/**
 * Save verified slip data to Firestore.
 * Uses .create() for atomic duplicate detection (gRPC ALREADY_EXISTS on replay).
 * @param {object} slipData - Verified slip data from SlipOK
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

// ==================== RTDB BILL + PAYMENT AUDIT ====================
/**
 * Mark matching RTDB bill as paid so admin dashboard + tax aggregation stay in sync.
 * Also writes a payments/{b}/{r}/{pushId} audit record for reconciliation.
 * Non-blocking — caller should wrap in try/catch.
 */
async function markBillPaidInRTDB(slipData, params, receiptNo = null) {
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
    // Read only the 12 most-recent bills (≈1 yr). The current month's unpaid
    // bill is always within the last 12 since bills are monthly.
    const snap = await ref.orderByKey().limitToLast(12).once('value');
    const bills = snap.val() || {};
    const updates = {};
    let matched = 0;
    let paidBillId = null;
    let sawCurrentMonth = false;   // any bill (paid OR unpaid) already exists for the slip month
    Object.keys(bills).forEach(billId => {
      const b = bills[billId];
      if (!b) return;
      const by = Number(b.year); const bm = Number(b.month);
      const byBE = by < 2400 ? 2500 + (by % 100) : by;
      if (byBE === billYearBE && bm === billMonth) {
        sawCurrentMonth = true;
        if (b.status === 'paid') return;   // month already settled — nothing to mark
        updates[`${billId}/status`] = 'paid';
        updates[`${billId}/paidAt`] = Date.now();
        updates[`${billId}/paidVia`] = 'tenant_app_slipok';
        updates[`${billId}/paidRef`] = slipData.transactionId || '';
        if (!paidBillId) paidBillId = billId;
        matched++;
      }
    });
    if (matched > 0) {
      await ref.update(updates);
      console.info(`💸 RTDB bill(s) marked paid: ${buildingRaw}/${room} × ${matched} (${billMonth}/${billYearBE})`);
    }

    // ===== MATERIALIZE A SYNTHESIZED CURRENT-MONTH BILL (Option B, 2026-06-08) =====
    // The current month's bill is SYNTHESIZED client-side from meter_data
    // (invoice `SYNTH-…`) and has NO RTDB doc — generateBillsOnMeterUpdate (the
    // CF that used to create bills on meter write) is frozen + SE3-Eventarc-dead.
    // So a valid slip for the current month matches no existing bill and would
    // silently leave it "รอชำระ". Create the REAL RTDB bill marked paid so tenant
    // + admin views agree (RTDB = SoT).
    //
    // Gate is SERVER-SIDE (robust to §7-MM: a stale-cached frontend may NOT send
    // the `synthetic` flag, so we must NOT depend on it): materialize when NO bill
    // at all exists for the slip's BKK month (`!sawCurrentMonth`) AND it is the
    // current BKK month (no back/forward-dating) AND the slip already passed the
    // amount check upstream. The client's `charges`/`meterReadings` decorate the
    // breakdown when present (fresh frontend) else null. Deterministic id so a
    // re-pay merges; never overwrite a paid doc. Field shape mirrors a real bill
    // (year "BE4" string, totalCharge) per §7-E.
    const _nowBkk = new Date(Date.now() + BKK_OFFSET_MS);
    const _curYM = (_nowBkk.getUTCFullYear() + 543) * 100 + (_nowBkk.getUTCMonth() + 1);
    const _billYM = billYearBE * 100 + billMonth;
    if (matched === 0 && !sawCurrentMonth && _billYM === _curYM) {
      try {
        {
          const mm = String(billMonth).padStart(2, '0');
          const newBillId = `TGH-${billYearBE}${mm}-${room}`;   // deterministic (matches generateBills format)
          const billRef = ref.child(newBillId);
          const existing = (await billRef.once('value')).val();
          const total = Number(params.totalAmount ?? params.expectedAmount ?? slipData.amount) || 0;
          if (!existing) {
            const nowIso2 = new Date().toISOString();
            await billRef.set({
              billId: newBillId,
              building: buildingRaw,
              room,
              month: billMonth,
              year: String(billYearBE),          // "2569" string — §7-E RTDB-bill format
              status: 'paid',
              totalCharge: total,
              totalAmount: total,
              charges: params.charges || null,
              meterReadings: params.meterReadings || null,
              paidVia: 'tenant_app_slipok',
              paidAt: Date.now(),
              paidRef: slipData.transactionId || '',
              slipVerified: true,
              receiptNo: receiptNo || null,
              billDate: nowIso2,
              createdAt: nowIso2,
              materializedFromSynth: true,
              source: 'cf:verifySlip',
              note: 'ออกบิล+ชำระอัตโนมัติจากสลิป (materialized from synthesized meter bill)',
            });
            paidBillId = newBillId;
            matched = 1;
            console.info(`🧾 Materialized synth bill as paid: ${buildingRaw}/${room}/${newBillId} ฿${total}`);
          } else if (existing.status !== 'paid') {
            // Doc appeared between synth render and pay (admin issued / race) but unpaid → mark paid.
            await billRef.update({
              status: 'paid',
              paidAt: Date.now(),
              paidVia: 'tenant_app_slipok',
              paidRef: slipData.transactionId || '',
              receiptNo: receiptNo || existing.receiptNo || null,
            });
            paidBillId = newBillId;
            matched = 1;
            console.info(`💸 Existing current-month bill marked paid: ${buildingRaw}/${room}/${newBillId}`);
          } else {
            paidBillId = newBillId;  // already paid (double-submit) — leave as-is
          }
        }
      } catch (matErr) {
        console.error('⚠️ markBillPaidInRTDB: synth materialize failed:', matErr?.message);
      }
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
      const nowIso = new Date().toISOString();
      await rtdb.ref(`payments/${buildingRaw}/${room}`).push({
        billId: paidBillId,
        month: billMonth,
        year: billYearBE,
        amount: Number(slipData.amount) || 0,
        paidAt: nowIso,
        createdAt: nowIso,
        method: 'PromptPay',
        slipOkVerified: true,
        transRef: slipData.transactionId || null,
        transactionId: slipData.transactionId || null,  // alias for forward-compat readers
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
  });

  console.info(`🎮 Awarded ${points}pts to nest/${roomId} (${status}, daysDiff=${daysDiff}, month=${monthKey})`);
  return { roomId, points, status, daysDiff, monthKey };
}

module.exports = {
  logVerificationAttempt,
  saveVerifiedSlip,
  markBillPaidInRTDB,
  recordPaymentAndAwardPoints,
};
