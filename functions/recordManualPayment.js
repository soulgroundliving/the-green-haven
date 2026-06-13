/**
 * recordManualPayment — admin-only server-side write of a MANUAL payment record into
 * verifiedSlips/{docId}. Replaces two client-side `setDoc` paths that wrote verifiedSlips
 * directly (security: a live admin browser token could forge/poison the SlipOK dedup
 * fence — see tasks/todo-verifiedslips-cf-only.md). Moving the write server-side lets a CF
 * enforce invariants a Firestore rule can't AND gives manual payments a real audit trail.
 *
 * Two manual flavours (NOT SlipOK — verifySlip owns those canonical docs):
 *   mode:'cash'     — admin marks a bill paid as cash, no slip. docId is the deterministic
 *                     manual_<bld>_<room>_<yearBE>_<month> (re-mark same month overwrites).
 *   mode:'override' — admin verified the BANK STATEMENT directly (the slip image may be
 *                     forged). Requires a real bank txid + a reason (both audit-traceable);
 *                     docId mv_<txid>.
 *
 * DEDUP GUARD (the actual security fix the rule couldn't express): inside the transaction,
 * if the target doc already exists and is NOT a manual record (i.e. a CF-written SlipOK
 * canonical doc, no manualEntry/manualOverride flag), the CF returns success WITHOUT
 * clobbering it — a manual write must never overwrite a real verified-slip record.
 *
 * verifiedBy / verifiedAt / ip are server-stamped from the verified auth context, NOT
 * client input (the old client path set verifiedBy from an untrusted localStorage session).
 *
 * Region SE1. §7-NN callable (Firestore is SE3, no Eventarc triggers). Admin-gated.
 * Input:  { building, room, year, month, amount, mode:'cash'|'override',
 *           txid?, sender?, bankCode?, receiptNo?, overrideReason? }
 * Output: { success, docId, action:'written'|'noop_canonical' }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendActionAudit } = require('./_actionAudit');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const REASON_MAX = 500;

// Mirror refundBill.toBE / the client year handling: 2-digit → 4-digit BE; already-BE passes.
function toBE(y) {
  const n = Number(y) || 0;
  return n < 2400 ? 2500 + (n % 100) : n;
}

function resolveIp(context) {
  const req = context.rawRequest;
  if (!req) return null;
  const raw = req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
  if (!raw) return null;
  return String(raw).split(',')[0].trim() || null; // x-forwarded-for: client is the first hop
}

// Safe Firestore doc-id segment (the typed txid feeds an mv_<txid> id).
function safeId(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]\s]/g, '_').slice(0, 200);
}

exports.recordManualPayment = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { HttpsError } = functions.https;
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required to record a manual payment');
  }

  const { building, room, year, month, amount, mode, txid, sender, bankCode, receiptNo, overrideReason } = data || {};
  const bld = building === 'nest' ? 'nest' : 'rooms';
  const roomKey = String(room == null ? '' : room).trim();
  const yearBE = toBE(year);
  const yearCE = yearBE - 543;
  const monthNum = Number(month);
  const amt = Number(amount);
  const payMode = mode === 'override' ? 'override' : 'cash';

  if (!roomKey) throw new HttpsError('invalid-argument', 'room is required');
  if (!yearBE || !monthNum || monthNum < 1 || monthNum > 12) {
    throw new HttpsError('invalid-argument', 'a valid year + month (1-12) is required');
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new HttpsError('invalid-argument', 'a positive amount is required');
  }

  let reason = null;
  let docId;
  if (payMode === 'override') {
    // The slip may be forged → the admin asserts they checked the real bank statement.
    // A txid (the bank reference they found) + a reason are the audit trail (mirror refundBill).
    const cleanTxid = String(txid == null ? '' : txid).trim();
    if (!cleanTxid) throw new HttpsError('invalid-argument', 'override mode requires a bank txid (audit trail)');
    reason = String(overrideReason == null ? '' : overrideReason).trim();
    if (!reason) throw new HttpsError('invalid-argument', 'override mode requires a reason (audit trail)');
    reason = reason.slice(0, REASON_MAX);
    docId = 'mv_' + safeId(cleanTxid);
  } else {
    docId = `manual_${bld}_${roomKey}_${yearBE}_${monthNum}`;
  }

  // Timestamp inside the billing month (5th @ noon BKK = 05:00 UTC) so readers that derive
  // yearBE/month from timestamp.getFullYear()/getMonth() key to the right month — even when
  // the admin marks paid in a different calendar month than the bill belongs to.
  const billingTs = new Date(Date.UTC(yearCE, monthNum - 1, 5, 5, 0, 0));
  const verifiedBy = String(context.auth.token.email || context.auth.uid);
  const verifiedRef = firestore.collection('verifiedSlips').doc(docId);

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(verifiedRef);
    if (snap.exists) {
      const existing = snap.data() || {};
      const isManual = existing.manualEntry === true || existing.manualOverride === true;
      if (!isManual) {
        // A CF-written canonical SlipOK doc — NEVER clobber it with a manual record.
        return { action: 'noop_canonical' };
      }
    }

    const doc = {
      transactionId: docId,
      building: bld,
      room: roomKey,
      amount: amt,
      expectedAmount: amt,
      sender: payMode === 'override' ? (String(sender || '').trim() || '(บันทึกโดย admin)') : '(บันทึกโดย admin)',
      receiver: '',
      bankCode: payMode === 'override' ? String(bankCode || '').trim() : '',
      date: billingTs.toISOString(),
      timestamp: billingTs,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      verified: true,
      yearBE,
      month: monthNum,
      verifiedBy,                                  // server-stamped (not client input)
      recordedByUid: context.auth.uid,
      ip: resolveIp(context),
      receiptNo: receiptNo != null ? String(receiptNo) : docId,
      ...(payMode === 'override'
        ? { manualOverride: true, bankStatementConfirmed: true, overrideReason: reason }
        : { manualEntry: true }),
    };
    tx.set(verifiedRef, doc, { merge: true });

    appendActionAudit(tx, firestore, {
      actor: context.auth.uid,
      actorEmail: String(context.auth.token.email || '') || null,
      action: 'BILL_PAID_MANUAL',
      targetType: 'payment',
      targetId: docId,
      building: bld,
      roomId: roomKey,
      after: { amount: amt, mode: payMode, yearBE, month: monthNum },
      note: reason,
      ip: resolveIp(context),
      source: 'recordManualPayment',
      idempotencyKey: `manualpay_${docId}`,
    });

    return { action: 'written' };
  });

  return { success: true, docId, action: result.action };
});
