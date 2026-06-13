/**
 * clearRoomPaymentSlips — admin-only server-side delete of every verifiedSlips doc for a
 * room+month (the "reset room payment" action). Replaces the client-side
 * `_deleteVerifiedSlipsForRoomMonth` (shared/dashboard-bill.js) that deleted verifiedSlips
 * directly — moving it server-side closes the same client-write hole as recordManualPayment
 * AND gives a destructive reset a real audit trail (today it leaves none).
 *
 * Deletes (mirrors the old client logic exactly):
 *   - the deterministic manual ids   manual_<bld>_<room>_<yearBE>_<m>  +  the CE-keyed legacy
 *     variant manual_<bld>_<room>_<yearCE>_<m>  (year-format drift, §7-E)
 *   - every verifiedSlips doc with room == room whose billing month (explicit yearBE/month,
 *     else derived from its timestamp in BKK) matches — i.e. SlipOK + override docs too, so
 *     the paid signal is TRULY cleared and the room can be re-paid.
 *
 * Resetting deletes the SlipOK dedup record on purpose (the admin is un-marking the payment);
 * the BILL_PAID_MANUAL/SlipOK history is gone but the PAYMENT_RESET audit row records who/when.
 *
 * Region SE1. §7-NN callable. Admin-gated.
 * Input:  { building, room, year, month }
 * Output: { success, deletedCount, deletedIds }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendActionAudit } = require('./_actionAudit');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const BKK_OFFSET_MS = 7 * 3600 * 1000;

function toBE(y) {
  const n = Number(y) || 0;
  return n < 2400 ? 2500 + (n % 100) : n;
}

function resolveIp(context) {
  const req = context.rawRequest;
  if (!req) return null;
  const raw = req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
  if (!raw) return null;
  return String(raw).split(',')[0].trim() || null;
}

// Billing (yearBE, month) a verifiedSlips doc belongs to. Prefer explicit fields (manual docs
// carry them); else derive from timestamp/date in BKK (matches the old client getFullYear()).
function billingPeriodOf(s) {
  if (Number(s && s.yearBE) && Number(s && s.month)) {
    return { yearBE: Number(s.yearBE), month: Number(s.month) };
  }
  const ts = (s && s.timestamp && typeof s.timestamp.toDate === 'function')
    ? s.timestamp.toDate()
    : (s && s.date ? new Date(s.date) : null);
  if (!ts || isNaN(ts.getTime())) return { yearBE: 0, month: 0 };
  const bkk = new Date(ts.getTime() + BKK_OFFSET_MS);
  return { yearBE: bkk.getUTCFullYear() + 543, month: bkk.getUTCMonth() + 1 };
}

exports.clearRoomPaymentSlips = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  const { HttpsError } = functions.https;
  if (!context.auth || !context.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if ((context.auth.token || {}).admin !== true) {
    throw new HttpsError('permission-denied', 'Admin claim required to reset a room payment');
  }

  const { building, room, year, month } = data || {};
  const bld = building === 'nest' ? 'nest' : 'rooms';
  const roomKey = String(room == null ? '' : room).trim();
  const yearBE = toBE(year);
  const yearCE = yearBE - 543;
  const monthNum = Number(month);
  if (!roomKey) throw new HttpsError('invalid-argument', 'room is required');
  if (!yearBE || !monthNum || monthNum < 1 || monthNum > 12) {
    throw new HttpsError('invalid-argument', 'a valid year + month (1-12) is required');
  }

  // Deterministic manual ids (deleting a non-existent id in a batch is a harmless no-op).
  const ids = new Set([
    `manual_${bld}_${roomKey}_${yearBE}_${monthNum}`,
    `manual_${bld}_${roomKey}_${yearCE}_${monthNum}`,
  ]);

  // SlipOK + override docs key on a txid → find them by room and match the billing month.
  const coll = firestore.collection('verifiedSlips');
  const snap = await coll.where('room', '==', roomKey).get();
  snap.forEach((docSnap) => {
    const p = billingPeriodOf(docSnap.data() || {});
    if (p.yearBE === yearBE && p.month === monthNum) ids.add(docSnap.id);
  });

  const batch = firestore.batch();
  for (const id of ids) batch.delete(coll.doc(id));
  appendActionAudit(batch, firestore, {
    actor: context.auth.uid,
    actorEmail: String(context.auth.token.email || '') || null,
    action: 'PAYMENT_RESET',
    targetType: 'payment',
    targetId: `${bld}_${roomKey}_${yearBE}_${monthNum}`,
    building: bld,
    roomId: roomKey,
    after: { deletedIds: [...ids], yearBE, month: monthNum },
    ip: resolveIp(context),
    source: 'clearRoomPaymentSlips',
    // distinct events (a re-reset is a new fact) → server autoId, no idempotencyKey
  });
  await batch.commit();

  return { success: true, deletedCount: ids.size, deletedIds: [...ids] };
});
