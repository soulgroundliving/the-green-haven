/**
 * leavePetPlaydate — a guest pet leaves an open/full playdate (Meaning Layer
 * #11). The removal runs inside a transaction so a leave that frees the last
 * seat reliably re-opens the playdate (full → open) without racing a concurrent
 * join. The HOST cannot leave — they must CANCEL the whole playdate (leaving
 * would orphan it); the engine canLeave enforces that.
 *
 * Identity guard: the caller may only remove a pet that belongs to THEIR own
 * room (the attendee's room must match the caller's room) — so a tenant can't
 * eject someone else's pet. No points (D7).
 *
 * §7-NN callable (never a Firestore trigger). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { canLeave, removeAttendee } = require('./_petPlaydateEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const _LEAVE_REASON_MSG = {
  'not-found': 'ไม่พบนัดเล่นนี้',
  cancelled: 'นัดเล่นนี้ถูกยกเลิกแล้ว',
  ended: 'นัดเล่นนี้ผ่านไปแล้ว',
  'host-must-cancel': 'ผู้จัดต้องยกเลิกนัด ไม่สามารถออกได้',
  'not-in': 'น้องไม่ได้อยู่ในนัดนี้',
  missing: 'ข้อมูลไม่ครบ',
};

exports.leavePetPlaydate = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, playdateId, petId } = data || {};
    if (!building || !roomId || !playdateId || !petId) {
      throw new functions.https.HttpsError('invalid-argument',
        'building, roomId, playdateId and petId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);
    const leavePetId = String(petId);

    // Auth: caller must be the tenant of THEIR room (the leaving pet's room).
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const ref = firestore.collection('petPlaydates').doc(String(playdateId));

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบนัดเล่นนี้');
      }
      const playdate = snap.data() || {};

      // Identity guard: only remove a pet that belongs to the caller's own room.
      const list = Array.isArray(playdate.attendees) ? playdate.attendees : [];
      const target = list.find((a) => String(a && a.petId) === leavePetId);
      if (!target) {
        throw new functions.https.HttpsError('failed-precondition', 'น้องไม่ได้อยู่ในนัดนี้');
      }
      if (String(target.room) !== room) {
        throw new functions.https.HttpsError('permission-denied', 'นำออกได้เฉพาะสัตว์เลี้ยงในห้องของคุณ');
      }

      const verdict = canLeave(playdate, leavePetId, Date.now());
      if (!verdict.ok) {
        const code = verdict.reason === 'not-found' ? 'not-found' : 'failed-precondition';
        throw new functions.https.HttpsError(code, _LEAVE_REASON_MSG[verdict.reason] || 'ออกจากนัดไม่ได้');
      }

      const next = removeAttendee(playdate, leavePetId);
      tx.update(ref, {
        attendees: next.attendees,
        status: next.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { success: true, playdateId: String(playdateId) };
  });
