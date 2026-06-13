/**
 * forfeitReservedDeposit — admin-only: forfeit a reserved pre-move-in deposit when
 * the prospect does NOT actually move in (no-show). Owner policy (Q2, 2026-06-13):
 * forfeit EVERYTHING paid (the ฿500 booking credit + any further deposit) — no refund.
 *
 * Flips deposits/{b}_{r} reserved → forfeited, records forfeitedAmount (= all paid so
 * far) + forfeitedAt + forfeitedBy, and writes an immutable DEPOSIT_FORFEITED
 * actionAudit row in the SAME transaction. No tenant/lease/occupancy writes — the
 * prospect never occupied the room. The `reserved` status is the idempotency guard.
 *
 * Region: asia-southeast1
 * Auth:   caller MUST have admin claim (no fallback)
 * Input:  { building, roomId, reason? }
 * Output: { success, building, roomId, forfeitedAmount, depositStatus:'forfeited' }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { appendActionAudit } = require('./_actionAudit');

exports.forfeitReservedDeposit = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin claim required to forfeit a deposit');
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  const { building, roomId, reason } = data || {};
  if (!building || typeof building !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'building is required');
  }
  if (!roomId || typeof roomId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'roomId is required');
  }
  const note = reason ? String(reason).slice(0, 300) : null;

  const depRef = firestore.collection('deposits').doc(`${building}_${roomId}`);

  const result = await firestore.runTransaction(async (tx) => {
    const depSnap = await tx.get(depRef);
    if (!depSnap.exists) {
      throw new functions.https.HttpsError('not-found', `No deposit recorded for ${building}/${roomId}`);
    }
    const dep = depSnap.data() || {};
    if (dep.status !== 'reserved') {
      throw new functions.https.HttpsError('failed-precondition',
        `Deposit is '${dep.status || 'holding'}', not 'reserved' — only a reserved (pre-move-in) deposit can be forfeited`);
    }

    // Forfeit EVERYTHING paid so far (Q2: no refund on a no-show).
    const forfeitedAmount = Math.max(0, Number(dep.paidSoFar) || 0);
    const forfeitedAt = new Date().toISOString();

    tx.set(depRef, {
      status: 'forfeited',
      forfeitedAt,
      forfeitedAmount,
      forfeitedBy: context.auth.uid,
      forfeitReason: note,
      expectedMoveInDate: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Immutable audit — a forfeiture is a financial mutation an auditor must trace.
    appendActionAudit(tx, firestore, {
      actor: context.auth.uid,
      actorEmail: String(context.auth.token.email || '') || null,
      action: 'DEPOSIT_FORFEITED',
      targetType: 'deposit',
      targetId: `${building}_${roomId}`,
      building,
      roomId,
      after: { forfeitedAmount, forfeitedAt, fromStatus: 'reserved' },
      note,
      source: 'forfeitReservedDeposit',
    });

    return { forfeitedAmount };
  });

  return {
    success: true,
    building,
    roomId,
    forfeitedAmount: result.forfeitedAmount,
    depositStatus: 'forfeited',
  };
});
