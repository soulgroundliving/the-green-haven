/**
 * createPetPlaydate — a tenant with an APPROVED pet opens a playdate slot
 * (Meaning Layer #11). Writes petPlaydates/{auto} with the host as attendee[0].
 *
 * Owner-decision defaults (todo-pet-playdate.md): any tenant whose pet is
 * `approved` may host (D1); capacity default 6 / max 12 (D2); free-text place
 * (D4); same-building scope (D5); auto-expire endAt + 24h grace (D6); no points
 * (D7). The host's approved pet is snapshotted into the attendee list using ONLY
 * the safe display fields (name + type emoji — health/vaccine never leak, mirror
 * #10 PROFILE_SAFE_FIELDS).
 *
 * A create is a brand-new event with no conflict to check, so it's a plain
 * doc.set (no transaction) — the capacity race only exists on JOIN. Rate-limited
 * 5/day per uid (anti-spam, mirrors createPetPlaydate D-default).
 *
 * §7-NN callable (never a Firestore trigger). Region asia-southeast1. No points.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const {
  sanitizeTitle, sanitizePlace, normalizeCapacity,
  toMs, validateWindow, computeExpiresAtMs, buildAttendee,
} = require('./_petPlaydateEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const CREATE_LIMIT_PER_DAY = 5;

exports.createPetPlaydate = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, hostPetId, title, place, startAt, endAt, capacity } = data || {};
    if (!building || !roomId || !hostPetId) {
      throw new functions.https.HttpsError('invalid-argument',
        'building, roomId and hostPetId are required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);
    const petId = String(hostPetId);

    const cleanTitle = sanitizeTitle(title);
    const cleanPlace = sanitizePlace(place);
    if (!cleanTitle) {
      throw new functions.https.HttpsError('invalid-argument', 'กรุณาตั้งชื่อกิจกรรม');
    }
    if (!cleanPlace) {
      throw new functions.https.HttpsError('invalid-argument', 'กรุณาระบุสถานที่');
    }

    const startMs = toMs(startAt);
    const endMs = toMs(endAt);
    const now = Date.now();
    const window = validateWindow(startMs, endMs, now);
    if (!window.ok) {
      const map = {
        unparseable: 'เวลาเริ่ม/สิ้นสุดไม่ถูกต้อง',
        'end-before-start': 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
        'already-ended': 'เลือกเวลาในอนาคต',
        'too-long': 'ช่วงเวลายาวเกินไป (สูงสุด 8 ชั่วโมง)',
        'too-far': 'นัดล่วงหน้าได้ไม่เกิน 30 วัน',
      };
      throw new functions.https.HttpsError('invalid-argument', map[window.reason] || 'ช่วงเวลาไม่ถูกต้อง');
    }

    const cap = normalizeCapacity(capacity);

    // Auth: caller must be the tenant of THEIR room (the host pet's room).
    await assertTenantAccess({
      building: canonicalBuilding, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    // Anti-spam: max CREATE_LIMIT_PER_DAY playdates/day per uid. Checked BEFORE the
    // pet read so a rate-limited caller can't probe pet docs.
    await checkRateLimit(context.auth.uid, 'createPetPlaydate', CREATE_LIMIT_PER_DAY, 86400);

    // The host's pet must exist in the room roster AND be approved (D1).
    const petSnap = await firestore
      .collection('tenants').doc(canonicalBuilding)
      .collection('list').doc(room)
      .collection('pets').doc(petId)
      .get();
    if (!petSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'ไม่พบสัตว์เลี้ยงของคุณ');
    }
    const petData = petSnap.data() || {};
    if (petData.status !== 'approved') {
      throw new functions.https.HttpsError('failed-precondition',
        'สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะเปิดนัดเล่นได้');
    }

    // Canonical tenantId for the host (best-effort; the attendee snapshot carries it).
    let hostTenantId = '';
    let hostName = '';
    try {
      const rosterSnap = await firestore
        .collection('tenants').doc(canonicalBuilding).collection('list').doc(room).get();
      if (rosterSnap.exists) {
        const r = rosterSnap.data() || {};
        hostTenantId = String(r.tenantId || '');
        hostName = String(r.name || '');
      }
    } catch (_) { /* non-fatal */ }

    const hostAttendee = buildAttendee({
      petId, tenantId: hostTenantId, room, petData,
    });

    const ref = firestore.collection('petPlaydates').doc();
    await ref.set({
      hostPetId: petId,
      hostTenantId,
      hostRoom: room,
      hostName: hostName.slice(0, 60),
      building: canonicalBuilding,
      title: cleanTitle,
      place: cleanPlace,
      startAt: admin.firestore.Timestamp.fromMillis(startMs),
      endAt: admin.firestore.Timestamp.fromMillis(endMs),
      capacity: cap,
      attendees: [hostAttendee],
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(computeExpiresAtMs(endMs)),
      cancelledAt: null,
      cancelledBy: null,
    });

    return { success: true, playdateId: ref.id };
  });
