/**
 * joinPetPlaydate — a neighbour brings their own APPROVED pet into an open
 * playdate (Meaning Layer #11). The CAPACITY-RACE LOCK: the conflict check
 * (open + seat free + no dup pet + no dup room) AND the attendees write run
 * inside ONE Firestore transaction (cloned from createFacilityBooking) — so a
 * burst of joins on the last seat produces exactly ONE winner; the losers get
 * 'failed-precondition'.
 *
 * The joiner's pet must be `approved` in their own room roster (D1). The
 * attendee snapshot copies ONLY the safe display fields (name + type emoji —
 * health/vaccine never leak, mirror #10 PROFILE_SAFE_FIELDS). Same-building only
 * (D5). One slot per room (engine canJoin). No points (D7).
 *
 * §7-NN callable (never a Firestore trigger). Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { canJoin, addAttendee, buildAttendee } = require('./_petPlaydateEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const _JOIN_REASON_MSG = {
  'not-found': 'ไม่พบนัดเล่นนี้',
  'not-open': 'นัดเล่นนี้ปิดรับแล้ว',
  ended: 'นัดเล่นนี้ผ่านไปแล้ว',
  full: 'นัดเล่นนี้เต็มแล้ว',
  'already-joined': 'น้องเข้าร่วมนัดนี้อยู่แล้ว',
  'room-already-in': 'ห้องของคุณเข้าร่วมนัดนี้แล้ว (หนึ่งห้องต่อหนึ่งที่)',
  missing: 'ข้อมูลไม่ครบ',
};

exports.joinPetPlaydate = functions
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
    const joinPetId = String(petId);

    // Auth: caller must be the tenant of THEIR room (the joining pet's room).
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    // The joiner's pet must exist in their room roster AND be approved (D1). Read
    // OUTSIDE the tx (it's the joiner's own immutable-ish doc); only the playdate
    // doc needs transactional isolation for the capacity race.
    const petSnap = await firestore
      .collection('tenants').doc(canonicalBuilding)
      .collection('list').doc(room)
      .collection('pets').doc(joinPetId)
      .get();
    if (!petSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบสัตว์เลี้ยงของคุณ');
    }
    const petData = petSnap.data() || {};
    if (petData.status !== 'approved') {
      throw new functions.https.HttpsError('failed-precondition',
        'สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะเข้าร่วมได้');
    }

    // Canonical tenantId for the joiner (best-effort; carried in the snapshot).
    let joinTenantId = '';
    try {
      const rosterSnap = await firestore
        .collection('tenants').doc(canonicalBuilding).collection('list').doc(room).get();
      if (rosterSnap.exists) joinTenantId = String((rosterSnap.data() || {}).tenantId || '');
    } catch (_) { /* non-fatal */ }

    const attendee = buildAttendee({ petId: joinPetId, tenantId: joinTenantId, room, petData });
    const ref = firestore.collection('petPlaydates').doc(String(playdateId));

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ไม่พบนัดเล่นนี้');
      }
      const playdate = snap.data() || {};

      // Defense in depth: the playdate must be in the caller's building (on top of
      // the building-scoped read rule).
      if (playdate.building !== canonicalBuilding) {
        throw new functions.https.HttpsError('permission-denied', 'เข้าร่วมได้เฉพาะนัดเล่นในอาคารเดียวกัน');
      }

      // The capacity-race guard — re-evaluated inside the tx so concurrent joins
      // on the last seat can only commit once.
      const verdict = canJoin(playdate, attendee, Date.now());
      if (!verdict.ok) {
        const code = verdict.reason === 'not-found' ? 'not-found' : 'failed-precondition';
        throw new functions.https.HttpsError(code, _JOIN_REASON_MSG[verdict.reason] || 'เข้าร่วมไม่ได้');
      }

      const next = addAttendee(playdate, attendee);
      tx.update(ref, {
        attendees: next.attendees,
        status: next.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { success: true, playdateId: String(playdateId) };
  });
