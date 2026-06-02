/**
 * assignReceiptNumber — mint a gapless RECEIPT number for a MANUAL (cash) payment.
 * Core Readiness Roadmap 1.2a, PR 1.2a-2.
 *
 * The slip path (verifySlip) mints its number inside the verifiedSlips transaction.
 * Cash payments are admin-marked CLIENT-SIDE (markBillPaid / saveBillToFirebase),
 * which can't run the server-side counter transaction — so the client calls this
 * callable after marking the bill paid. It reuses _receiptCounter (the SAME gapless
 * counter as slips), so cash + slip receipts share one per-building/BE sequence.
 *
 * GAPLESS + IDEMPOTENT: the counter increment AND a deterministic manualReceipts
 * record commit in the SAME Firestore transaction. The record id is
 * {building}_{roomId}_{billId} — re-calling for the same bill returns the existing
 * number WITHOUT incrementing (no double-mint, no gap on a client retry). The RTDB
 * bill mirror (the client writes receiptNo there) is a display convenience; the
 * manualReceipts Firestore record is the gapless source of truth.
 *
 * Region SE1. §7-NN: callable, not a Firestore trigger. Admin-gated (manual
 * mark-paid is an admin-only action — the house gate).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assignReceiptNo } = require('./_receiptCounter');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function _safe(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]]/g, '_');
}

exports.assignReceiptNumber = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { HttpsError } = functions.https;
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required to assign a receipt number');
  }

  const { building, roomId, billId, be } = data || {};
  if (!building || !roomId || !billId) {
    throw new HttpsError('invalid-argument', 'building, roomId and billId are required');
  }
  const safeBuilding = building === 'nest' ? 'nest' : 'rooms';
  // BE year: prefer the bill's year (caller-supplied); else the server's BKK BE now.
  let beYear = Number(be);
  if (!Number.isInteger(beYear) || beYear < 2400 || beYear > 3000) {
    beYear = new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear() + 543;
  }
  const receiptKey = `${safeBuilding}_${_safe(roomId)}_${_safe(billId)}`;

  try {
    const receiptNo = await db.runTransaction(async (tx) => {
      const mrRef = db.collection('manualReceipts').doc(receiptKey);
      // READ 1 — idempotency: this bill already has a number → return it, no increment.
      const mrSnap = await tx.get(mrRef);
      if (mrSnap.exists) return mrSnap.data().receiptNo;
      // READ 2 + first WRITE — mint from the shared gapless counter.
      const { receiptNo } = await assignReceiptNo(tx, db, { building: safeBuilding, be: beYear });
      tx.set(mrRef, {
        receiptNo,
        building: safeBuilding,
        roomId: String(roomId),
        billId: String(billId),
        be: beYear,
        by: context.auth.uid,
        method: 'manual_admin',
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return receiptNo;
    });
    return { receiptNo };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[assignReceiptNumber] failed:', e && e.message);
    throw new HttpsError('internal', 'Failed to assign receipt number');
  }
});
