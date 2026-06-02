/**
 * voidInvoice — void an issued invoice (ใบแจ้งหนี้) WITHOUT deleting it.
 * Core Readiness Roadmap 1.3.
 *
 * Issued invoices used to be silently overwritten in place (the RTDB bill
 * firebaseSet full-replace at dashboard-bill-payment-status.js) with no trace, and
 * BILL_DELETED had zero callers (§7-K) — an auditor could not follow a correction.
 * A void here is a STATE TRANSITION, not a delete: the invoices/{key} doc is flipped
 * to status:'void' with voidedAt / voidedBy / voidReason, and a BILL_VOIDED row is
 * written to the immutable actionAudit trail IN THE SAME transaction. The original
 * number, amount and issuance survive forever (never hard-deleted; the void event is
 * permanent in actionAudit).
 *
 * Re-issue (a corrected invoice with a NEW gapless number referencing the voided
 * one) is a deliberate follow-up — NOT automatic. issueInvoiceNo
 * (notifyTenantOnMeterUpload) refuses to silently reuse a voided number, so a
 * re-notify after a void will not resurrect it.
 *
 * Region SE1. §7-NN: callable, not a Firestore trigger (project Firestore is SE3
 * where Eventarc triggers can't deploy). Admin-gated — the house gate.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendActionAudit } = require('./_actionAudit');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REASON_MAX = 500;

function resolveIp(context) {
  const req = context.rawRequest;
  if (!req) return null;
  const raw = req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
  if (!raw) return null;
  // x-forwarded-for can be "client, proxy1, proxy2" — the client is the first hop.
  return String(raw).split(',')[0].trim() || null;
}

exports.voidInvoice = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { HttpsError } = functions.https;
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required to void an invoice');
  }

  const { invoiceId, reason } = data || {};
  if (!invoiceId || typeof invoiceId !== 'string') {
    throw new HttpsError('invalid-argument', 'invoiceId is required');
  }
  const cleanReason = String(reason == null ? '' : reason).trim();
  if (!cleanReason) {
    throw new HttpsError('invalid-argument', 'A void reason is required (it is part of the audit trail)');
  }

  const invRef = db.collection('invoices').doc(invoiceId);
  const tok = context.auth.token || {};

  try {
    return await db.runTransaction(async (tx) => {
      // READ 1 (only read) — before any write, per all-reads-before-writes.
      const snap = await tx.get(invRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', `Invoice '${invoiceId}' not found`);
      }
      const inv = snap.data() || {};
      // Idempotent: already void → no second write, no duplicate audit row.
      if (inv.status === 'void') {
        return { invoiceNo: inv.invoiceNo || null, alreadyVoid: true };
      }

      tx.update(invRef, {
        status: 'void',
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        voidedBy: context.auth.uid,
        voidReason: cleanReason.slice(0, REASON_MAX),
      });

      appendActionAudit(tx, db, {
        // actor / role / ip / source stamped from the VERIFIED context — never `data`.
        actor:      context.auth.uid,
        actorEmail: tok.email || null,
        actorRole:  tok.admin === true ? 'admin' : (tok.role || null),
        action:     'BILL_VOIDED',
        targetType: 'invoice',
        targetId:   inv.invoiceNo || invoiceId,
        building:   inv.building || null,
        roomId:     inv.room != null ? String(inv.room) : null,
        before:     { status: inv.status || 'issued', amount: inv.amount != null ? inv.amount : null },
        after:      { status: 'void', reason: cleanReason.slice(0, REASON_MAX) },
        ip:         resolveIp(context),
        source:     'cf:voidInvoice',
      });

      return { invoiceNo: inv.invoiceNo || null, alreadyVoid: false };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[voidInvoice] failed:', e && e.message);
    throw new HttpsError('internal', 'Failed to void invoice');
  }
});
