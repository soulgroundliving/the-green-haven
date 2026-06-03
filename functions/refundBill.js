/**
 * refundBill — refund a PAID bill (คืนเงิน) WITHOUT deleting it. Roadmap Phase 2.
 *
 * Blueprint p.1 lists คืนเงิน (refund) as a SEPARATE internal control from ยกเลิกบิล
 * (void, Roadmap 1.3): a refund reverses money that was ALREADY COLLECTED. This is a
 * STATE TRANSITION, not a delete — the RTDB bill is flipped to status:'refunded' with
 * refundedAt / refundedBy / refundReason, and a BILL_REFUNDED row is written to the
 * immutable actionAudit trail. The bill's paidRef / receiptNo / paidAt survive for the
 * trail; the verifiedSlip (proof the money was received) is NOT mutated — the refund is
 * a new fact recorded on the bill + audit, not a rewrite of payment history.
 *
 * Decisions (Roadmap Phase 2, user-approved 2026-06-03):
 *   D1 status:'refunded' = money returned, charge cancelled → excluded from revenue
 *      (aggregateMonthlyRevenue skips it; reconcile pairs it via paidRef into a
 *       refunded bucket so its slip is not orphaned).
 *   D2 points claw-back DEFERRED (gamification points awarded at payment are NOT
 *      reversed in v1; a negative pointsLedger entry is a named follow-up before the
 *      Trust System / Phase 3.2 reads the ledger).
 *   D4 full reversal only (no partial-amount refund in v1).
 *
 * ORDERING — audit FIRST, then RTDB flip. The bill (revenue source-of-truth) lives in
 * RTDB and the audit lives in Firestore, so they cannot share one transaction. We write
 * the BILL_REFUNDED audit row first (idempotent, deterministic key) and flip the RTDB
 * bill second: a reduced revenue must NEVER be untraceable (the whole point of the audit
 * trail). The reverse order could drop a revenue cut with no record if the second write
 * failed and a retry early-returned. The transient window (audit ahead of the flip) only
 * ever OVER-states revenue (conservative) and self-heals on retry — the deterministic
 * idempotencyKey makes the audit a no-op rewrite, and the bill flip is idempotent.
 *
 * Region SE1. §7-NN: callable, not a Firestore trigger (project Firestore is SE3 where
 * Eventarc triggers can't deploy). Admin-gated — the house gate.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendActionAudit } = require('./_actionAudit');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REASON_MAX = 500;

// Mirror verifySlip.markBillPaidInRTDB / aggregateMonthlyRevenue year handling so we
// match the SAME bills the pay-path matched: 2-digit BE → 4-digit BE; already-BE passes.
function toBE(y) {
  const n = Number(y) || 0;
  return n < 2400 ? 2500 + (n % 100) : n;
}

function resolveIp(context) {
  const req = context.rawRequest;
  if (!req) return null;
  const raw = req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
  if (!raw) return null;
  // x-forwarded-for can be "client, proxy1, proxy2" — the client is the first hop.
  return String(raw).split(',')[0].trim() || null;
}

exports.refundBill = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { HttpsError } = functions.https;
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required to refund a bill');
  }

  const { building, room, year, month, reason } = data || {};
  const buildingRaw = building === 'nest' ? 'nest' : 'rooms';
  const roomKey = String(room == null ? '' : room).trim();
  const yearBE = toBE(year);
  const monthNum = Number(month);
  if (!roomKey) {
    throw new HttpsError('invalid-argument', 'room is required');
  }
  if (!yearBE || !monthNum || monthNum < 1 || monthNum > 12) {
    throw new HttpsError('invalid-argument', 'a valid year + month (1-12) is required');
  }
  const cleanReason = String(reason == null ? '' : reason).trim();
  if (!cleanReason) {
    throw new HttpsError('invalid-argument', 'A refund reason is required (it is part of the audit trail)');
  }

  const tok = context.auth.token || {};
  const rtdb = admin.database();
  const roomRef = rtdb.ref(`bills/${buildingRaw}/${roomKey}`);

  // ── Find the bill for this room+period. Prefer a PAID one; remember a refunded one. ──
  let billsObj;
  try {
    const snap = await roomRef.once('value');
    billsObj = snap.val() || {};
  } catch (e) {
    console.error('[refundBill] RTDB read failed:', e && e.message);
    throw new HttpsError('internal', 'Failed to read the bill');
  }

  let targetId = null, target = null, refundedId = null, anyForPeriod = false;
  for (const id of Object.keys(billsObj)) {
    const b = billsObj[id];
    if (!b || typeof b !== 'object') continue;
    if (toBE(b.year) === yearBE && Number(b.month) === monthNum) {
      anyForPeriod = true;
      if (b.status === 'paid') { targetId = id; target = b; break; } // prefer the paid bill
      if (b.status === 'refunded' && !refundedId) refundedId = id;
    }
  }

  if (!target) {
    // Idempotent: already refunded (no paid bill left for the period).
    if (refundedId) {
      const r = billsObj[refundedId] || {};
      return { billId: refundedId, amount: Number(r.totalCharge || r.totalAmount || r.total) || 0, alreadyRefunded: true };
    }
    if (anyForPeriod) {
      throw new HttpsError('failed-precondition', 'The bill for this room/period is not paid — only a paid bill can be refunded');
    }
    throw new HttpsError('not-found', 'No bill found for this room/period');
  }

  const amount = Number(target.totalCharge || target.totalAmount || target.total) || 0;
  const monthPad = String(monthNum).padStart(2, '0');

  // ── 1) AUDIT FIRST (Firestore) — guarantees the trail before revenue is reduced. ──
  // Deterministic idempotencyKey: a retry rewrites the same row (no duplicate).
  try {
    const batch = db.batch();
    appendActionAudit(batch, db, {
      // actor / role / ip / source stamped from the VERIFIED context — never `data`.
      actor:      context.auth.uid,
      actorEmail: tok.email || null,
      actorRole:  tok.admin === true ? 'admin' : (tok.role || null),
      action:     'BILL_REFUNDED',
      targetType: 'bill',
      targetId:   targetId,
      building:   buildingRaw,
      roomId:     roomKey,
      before:     { status: 'paid', amount },
      after:      { status: 'refunded', reason: cleanReason.slice(0, REASON_MAX) },
      ip:         resolveIp(context),
      source:     'cf:refundBill',
      idempotencyKey: `refund_${buildingRaw}_${roomKey}_${yearBE}${monthPad}`,
    });
    await batch.commit();
  } catch (e) {
    console.error('[refundBill] audit write failed:', e && e.message);
    throw new HttpsError('internal', 'Failed to record the refund audit row');
  }

  // ── 2) RTDB bill flip (revenue auto-excludes a refunded bill on next aggregation). ──
  try {
    await roomRef.child(targetId).update({
      status: 'refunded',
      refundedAt: Date.now(),
      refundedBy: context.auth.uid,
      refundReason: cleanReason.slice(0, REASON_MAX),
    });
  } catch (e) {
    // Audit row already committed (idempotent) — a retry completes the flip cleanly.
    console.error('[refundBill] RTDB flip failed (audit row already written — retry to complete):', e && e.message);
    throw new HttpsError('internal', 'Refund logged but the bill flip failed — please retry');
  }

  return { billId: targetId, amount, alreadyRefunded: false };
});
