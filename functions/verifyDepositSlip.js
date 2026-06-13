/**
 * verifyDepositSlip — SlipOK-backed verification of a pre-move-in deposit payment.
 *
 * The FRONT-half deposit lifecycle (deposits/{b}_{r} status 'reserved') lets an
 * admin record the 2 chunks (จอง ฿500 → ส่วนที่เหลือ) BEFORE move-in. A `cash`
 * chunk is recorded by hand; a `slip` chunk is anti-fraud-verified HERE — the same
 * SlipOK gate the rent (verifySlip) and booking (verifyBookingSlip) paths use.
 *
 * Owner ask (2026-06-13, D5): one transfer slip may pay the deposit for SEVERAL
 * rooms at once ("จ่ายรวมหลายห้อง 1 สลิป"). So the input is an `allocations` array;
 * a single-room verify is just allocations.length === 1. The slip's verified amount
 * must equal Σ allocation amounts (±฿1) — the split is the admin's stated breakdown.
 *
 * Sibling of verifyBookingSlip.js. Differences:
 *   - admin-only (the admin records deposits; there is no tenant/prospect path)
 *   - credits N deposit docs' `paidSoFar` (+ a `payments[]` entry each) instead of
 *     flipping one booking to 'paid'
 *   - one Firestore transaction so the dedup fence + every per-room credit + the
 *     audit row commit atomically (§7-DD: a financial mutation touches all siblings)
 *
 * Anti-patterns honoured:
 *   §7-YY  multipart via the GLOBAL FormData + Blob (the form-data pkg serialises to
 *          "[object FormData]" under Node 22 undici fetch); AbortSignal, not `timeout`.
 *   §7-EEE strip a FileReader `data:…;base64,` prefix before Buffer.from (admin upload
 *          may send the full data URL); decoding the prefix → SlipOK 400 code 1005.
 *   verifiedSlips/{txid} dedup is now USED across THREE sources (rent/booking/deposit)
 *          — one txid → multi-room `allocations`, blocks slip reuse + double-count vs a
 *          booking that already consumed the same transfer.
 *
 * NOTE — server twins of two shared/deposit-calc.js helpers (splitLumpCash +
 * recordDepositPayment) are inlined below: `firebase deploy` packages only
 * functions/ (firebase.json source:"functions"), so a require('../shared/…') would
 * be absent at runtime. The shared copies stay the browser source of truth + are
 * unit-tested there; these twins are pure and locked by this CF's own tests.
 *
 * Region: asia-southeast1
 * Auth:   caller MUST have admin claim (no fallback)
 * Input:  { allocations: [{ building, roomId, amount, label? }], file }   // file = base64 (data: prefix tolerated)
 * Output: { success, transactionId, amount, allocations:[{building,roomId,amount,paidSoFar}], lump, slipPath }
 * Throws HttpsError on hard failures (amount mismatch, duplicate slip, missing deposit, etc.)
 * Returns retry: { success:false, retryable:true, code:'scb_delay', retryAfterSec, message }
 */
const functions = require('firebase-functions/v1');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { appendActionAudit } = require('./_actionAudit');

// Same project secret/param as verifySlip + verifyBookingSlip — one SlipOK plan,
// one quota. Deploy needs no new secret.
const SLIPOK_API_KEY = defineSecret('SLIPOK_API_KEY');
const SLIPOK_API_URL = defineString('SLIPOK_API_URL');

// Admin-only path → light per-admin throttle, purely to cap a compromised admin
// token's SlipOK spend (each call costs quota). Deposits are infrequent; lump
// folds many rooms into ONE call, so this envelope is generous in practice.
const RATE_LIMIT_CONFIG = { minute: 10, hour: 60, day: 200 };
const MAX_ALLOCATIONS = 20;            // lump cap — a single transfer for ≤20 rooms
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/; // safe building / roomId segment for `${b}_${r}`

// ──────────────────── HELPERS (local — see file header re: shared twins) ───────

function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
}

// Server twin of DepositCalc.splitLumpCash — faithful copy (incl. the everyValid
// shape check) so it matches the shared source of truth exactly. Validity ⇔ every
// allocation is a real room with amount>0 AND Σ amounts === total (±฿1). The CF's
// own input loop already pre-rejects bad allocs, so everyValid is belt-and-braces.
function validateLumpSplit(total, allocations) {
  const t = Number(total) || 0;
  const allocated = allocations.reduce((s, a) => s + Math.max(0, Number(a && a.amount) || 0), 0);
  const everyValid = allocations.length > 0 && allocations.every(
    (a) => a && a.building && a.roomId && (Number(a.amount) || 0) > 0
  );
  const remainder = Math.round((t - allocated) * 100) / 100;
  return { valid: everyValid && Math.abs(remainder) <= 1, total: t, allocated, remainder };
}

// Server twin of DepositCalc.recordDepositPayment — accrue one chunk onto a deposit
// doc, CLAMPING paidSoFar to the deposit amount. Returns { paidSoFar, payments }.
// Specialised for this CF: every chunk here is a verified slip, so method is fixed
// to 'slip' (the shared helper takes method as a param; this call site never sends cash).
function accruePayment(dep, payment) {
  const amount = Math.max(0, Number(payment.amount) || 0);
  const prevPaid = Math.max(0, Number(dep && dep.paidSoFar) || 0);
  const cap = Number(dep && dep.amount) || 0;
  const paidSoFar = cap > 0 ? Math.min(cap, prevPaid + amount) : prevPaid + amount;
  const prior = (dep && Array.isArray(dep.payments)) ? dep.payments : [];
  const entry = { label: payment.label || 'มัดจำ', amount, method: 'slip' };
  if (payment.slipPath) entry.slipPath = String(payment.slipPath);
  if (payment.lumpRef) entry.lumpRef = String(payment.lumpRef);
  if (payment.txid) entry.txid = String(payment.txid);
  if (payment.at != null) entry.at = payment.at;
  return { paidSoFar, payments: prior.concat([entry]) };
}

async function checkRateLimit(uid, timeWindow) {
  try {
    const now = Date.now();
    const timeMs = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[timeWindow];
    const ref = firestore.collection('rateLimits').doc(`deposit_${uid}_${timeWindow}`);
    // Transactional read-modify-write so two concurrent admin instances can't both
    // read count=N and both commit N+1 (→ 2× the cap). Mirrors verifySlip.checkRateLimit
    // (the money-path original) — a non-tx counter is the weaker verifyBookingSlip shape.
    return await firestore.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }
      const d = doc.data();
      if (now - d.windowStart > timeMs) {
        tx.set(ref, { count: 1, windowStart: now, updatedAt: new Date() });
        return true;
      }
      if (d.count >= RATE_LIMIT_CONFIG[timeWindow]) {
        console.warn(`⚠️ Deposit slip rate limit exceeded for ${uid} (${timeWindow}): ${d.count}`);
        return false;
      }
      tx.update(ref, { count: d.count + 1, updatedAt: new Date() });
      return true;
    });
  } catch (e) {
    // Fail CLOSED — a Firestore throttle must NOT silently grant a bypass.
    console.error('checkRateLimit failed (failing CLOSED):', e.message);
    return false;
  }
}

function detectImage(fileBuffer) {
  if (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) return { mimeType: 'image/png', ext: 'png' };
  if (fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49) return { mimeType: 'image/gif', ext: 'gif' };
  if (fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49) return { mimeType: 'image/webp', ext: 'webp' };
  return { mimeType: 'image/jpeg', ext: 'jpg' };
}

async function callSlipOKAPI(fileBuffer) {
  const { mimeType, ext } = detectImage(fileBuffer);
  // §7-YY: global FormData + Blob (NOT the form-data pkg). Do NOT set Content-Type —
  // undici derives the multipart boundary.
  const form = new FormData();
  form.append('files', new Blob([fileBuffer], { type: mimeType }), `slip.${ext}`);

  const response = await fetch(SLIPOK_API_URL.value(), {
    method: 'POST',
    headers: { 'x-authorization': SLIPOK_API_KEY.value().trim() }, // .trim(): guard pasted-secret whitespace → 401
    body: form,
    signal: AbortSignal.timeout(30_000), // §7-YY: undici ignores node-fetch `timeout`
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
  if (data.data && !data.data.transactionId) {
    data.data.transactionId = data.data.transRef || data.data.ref || null;
  }
  return data.data;
}

// ──────────────────── MAIN CF ────────────────────

exports.verifyDepositSlip = functions
  .region('asia-southeast1')
  .runWith({ secrets: [SLIPOK_API_KEY] })
  .https.onCall(async (data, context) => {
    // ── Auth (admin only) ────────────────────────────────────────────────────
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin claim required to verify a deposit slip');
    }

    // ── Input: allocations[] + file ──────────────────────────────────────────
    const { allocations, file } = data || {};
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'allocations (a non-empty array) is required');
    }
    if (allocations.length > MAX_ALLOCATIONS) {
      throw new functions.https.HttpsError('invalid-argument', `Too many rooms in one slip (max ${MAX_ALLOCATIONS})`);
    }
    const seen = new Set();
    const allocs = allocations.map((a) => {
      const building = String((a && a.building) || '').trim();
      const roomId = String((a && a.roomId) || '').trim();
      const amount = Number(a && a.amount);
      if (!ID_RE.test(building) || !ID_RE.test(roomId)) {
        throw new functions.https.HttpsError('invalid-argument', 'allocations[].building/roomId invalid');
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', `allocations amount must be > 0 (room ${roomId})`);
      }
      const key = `${building}_${roomId}`;
      if (seen.has(key)) {
        throw new functions.https.HttpsError('invalid-argument', `Duplicate room in allocations: ${key}`);
      }
      seen.add(key);
      return { building, roomId, amount, label: a.label ? String(a.label).slice(0, 40) : 'มัดจำ' };
    });
    const isLump = allocs.length > 1;

    if (!file || typeof file !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'file (base64) is required');
    }
    if (file.length > 7 * 1024 * 1024) { // ~5MB binary after base64
      throw new functions.https.HttpsError('invalid-argument', 'Payload too large (max ~5MB binary)');
    }

    // ── Rate limit per admin uid ─────────────────────────────────────────────
    const ok = (
      await checkRateLimit(context.auth.uid, 'minute') &&
      await checkRateLimit(context.auth.uid, 'hour') &&
      await checkRateLimit(context.auth.uid, 'day')
    );
    if (!ok) {
      throw new functions.https.HttpsError('resource-exhausted',
        'Too many slip verification attempts — please wait and try again');
    }

    // ── Decode base64 (§7-EEE: tolerate a full data: URL) ────────────────────
    let fileBuffer;
    try {
      const b64 = file.startsWith('data:') ? file.slice(file.indexOf(',') + 1) : file;
      fileBuffer = Buffer.from(b64, 'base64');
    } catch (e) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid base64 encoding');
    }
    if (fileBuffer.length < 100) {
      throw new functions.https.HttpsError('invalid-argument', 'File too small to be a slip image');
    }

    // ── Call SlipOK ───────────────────────────────────────────────────────────
    let slipData;
    try {
      slipData = await callSlipOKAPI(fileBuffer);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('"code":1010') || msg.includes('ไทยพาณิชย์')) {
        return {
          success: false, retryable: true, code: 'scb_delay', retryAfterSec: 120,
          message: 'สลิปธนาคารไทยพาณิชย์ใช้เวลาตรวจสอบประมาณ 2 นาทีหลังโอน กรุณารอแล้วลองใหม่อีกครั้ง',
        };
      }
      console.error('verifyDepositSlip: SlipOK call failed:', msg);
      throw new functions.https.HttpsError('failed-precondition', msg || 'SlipOK verification failed');
    }

    // ── Amount validation (HARD reject) — slip total = Σ allocations (±฿1) ────
    // Guard a malformed/tampered SlipOK amount explicitly (mirrors verifyBookingSlip's
    // expectedAmount<=0 guard) so validateLumpSplit never reasons about a non-positive total.
    const slipAmount = Number(slipData.amount);
    if (!Number.isFinite(slipAmount) || slipAmount <= 0) {
      console.error('verifyDepositSlip: SlipOK returned a non-positive amount:', slipData.amount);
      throw new functions.https.HttpsError('failed-precondition', 'SlipOK returned an invalid amount');
    }
    const split = validateLumpSplit(slipAmount, allocs);
    if (!split.valid) {
      console.warn(`⚠️ Deposit slip amount mismatch: slip=฿${slipAmount}, allocated=฿${split.allocated}`);
      throw new functions.https.HttpsError('failed-precondition',
        `จำนวนเงินไม่ตรงกับยอดที่กระจาย (สลิป ฿${slipAmount} / รวมจัดสรร ฿${split.allocated})`);
    }

    // ── Transaction id safety ────────────────────────────────────────────────
    if (!isSafeTransactionId(slipData.transactionId)) {
      console.warn(`⚠️ Unsafe transactionId from SlipOK: ${slipData.transactionId}`);
      throw new functions.https.HttpsError('failed-precondition', 'Invalid slip transaction id');
    }
    const txid = slipData.transactionId;

    // ── Deterministic slip storage path (written into payment entries IN the tx;
    //    actual upload happens AFTER the tx, non-fatal). One file per slip — every
    //    room's payment entry references the same path via lumpRef. ──────────────
    const { ext } = detectImage(fileBuffer);
    const slipPath = `deposits/${allocs[0].building}/${allocs[0].roomId.replace(/[^\w-]/g, '_')}/payment_${txid}.${ext}`;
    const at = new Date().toISOString();

    const verifiedRef = firestore.collection('verifiedSlips').doc(txid);
    const depRefs = allocs.map((a) => firestore.collection('deposits').doc(`${a.building}_${a.roomId}`));

    // ── One transaction: dedup fence + every per-room credit + audit (§7-DD) ──
    let perRoom;
    try {
      perRoom = await firestore.runTransaction(async (tx) => {
        // Reads first (Firestore tx constraint).
        const dupSnap = await tx.get(verifiedRef);
        if (dupSnap.exists) {
          const e = new Error('duplicate'); e._dup = true; throw e;
        }
        const depSnaps = await Promise.all(depRefs.map((r) => tx.get(r)));
        depSnaps.forEach((snap, i) => {
          if (!snap.exists) {
            const e = new Error('missing'); e._missing = allocs[i]; throw e;
          }
          const st = (snap.data() || {}).status;
          if (st === 'returned' || st === 'forfeited') {
            const e = new Error('terminal'); e._terminal = { alloc: allocs[i], status: st }; throw e;
          }
        });

        // Writes.
        const credited = depSnaps.map((snap, i) => {
          const dep = snap.data() || {};
          const patch = accruePayment(dep, {
            label: allocs[i].label, amount: allocs[i].amount, slipPath, txid,
            lumpRef: isLump ? txid : undefined, at,
          });
          tx.set(depRefs[i], {
            paidSoFar: patch.paidSoFar,
            payments: patch.payments,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          return { building: allocs[i].building, roomId: allocs[i].roomId, amount: allocs[i].amount, paidSoFar: patch.paidSoFar };
        });

        // Dedup record — keyed by txid, shared with rent + booking slips.
        tx.set(verifiedRef, {
          transactionId: txid,
          source: 'deposit',
          allocations: allocs.map((a) => ({ building: a.building, roomId: a.roomId, amount: a.amount })),
          building: allocs[0].building,
          room: allocs[0].roomId,
          amount: slipAmount,
          sender: slipData.sender?.displayName || slipData.sender?.name || '',
          receiver: slipData.receiver?.displayName || slipData.receiver?.name || '',
          date: slipData.date || null,
          bankCode: slipData.sendingBankCode || '',
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          verified: true,
          by: context.auth.uid,
        });

        // Immutable audit — a deposit credit is a financial mutation.
        appendActionAudit(tx, firestore, {
          actor: context.auth.uid,
          actorEmail: String(context.auth.token.email || '') || null,
          action: 'DEPOSIT_VERIFIED',
          targetType: 'deposit',
          targetId: isLump ? txid : `${allocs[0].building}_${allocs[0].roomId}`,
          building: isLump ? null : allocs[0].building,
          roomId: isLump ? null : allocs[0].roomId,
          after: { transactionId: txid, amount: slipAmount, lump: isLump, allocations: credited },
          source: 'verifyDepositSlip',
          idempotencyKey: `deposit_slip_${txid}`,
        });

        return credited;
      });
    } catch (e) {
      if (e && e._dup) {
        console.warn(`🚨 Duplicate deposit slip: txid=${txid}`);
        throw new functions.https.HttpsError('already-exists',
          'สลิปนี้ถูกใช้ยืนยันไปแล้ว (ตรวจสอบ/ใช้ซ้ำไม่ได้)');
      }
      if (e && e._missing) {
        throw new functions.https.HttpsError('not-found',
          `ยังไม่มีรายการมัดจำของห้อง ${e._missing.building}/${e._missing.roomId} — บันทึกมัดจำก่อนย้ายเข้าก่อน`);
      }
      if (e && e._terminal) {
        throw new functions.https.HttpsError('failed-precondition',
          `มัดจำห้อง ${e._terminal.alloc.building}/${e._terminal.alloc.roomId} เป็นสถานะ '${e._terminal.status}' แล้ว — เพิ่มชำระไม่ได้`);
      }
      if (e instanceof functions.https.HttpsError) throw e;
      console.error('verifyDepositSlip: transaction failed:', e);
      throw new functions.https.HttpsError('internal', 'Failed to record the verified deposit slip');
    }

    // ── Upload slip image to Storage (non-fatal — slipPath is already recorded) ─
    try {
      const { mimeType } = detectImage(fileBuffer);
      await admin.storage().bucket().file(slipPath).save(fileBuffer, {
        metadata: { contentType: mimeType }, resumable: false,
      });
    } catch (e) {
      console.warn('verifyDepositSlip: Storage upload failed (non-fatal):', e.message);
    }

    return {
      success: true,
      transactionId: txid,
      amount: slipAmount,
      lump: isLump,
      allocations: perRoom,
      slipPath,
    };
  });
