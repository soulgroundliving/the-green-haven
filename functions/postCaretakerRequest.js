/**
 * postCaretakerRequest — an owner posts an emergency pet-sitting request
 * (Meaning Layer #14, 🆘🐾 หาคนช่วยดูแลสัตว์เลี้ยงยามฉุกเฉิน).
 *
 * Creates caretakerRequests/{auto-id} with status:'open'. The requesterUid is
 * taken from context.auth.uid (server-set, never the client) so a request can't
 * be spoofed onto another resident. Rate-limited 5/day per uid (anti board-spam).
 *
 * Auth: the caller must be the registered tenant of {building, roomId} —
 * assertTenantAccess (claim fast-path + Firestore SoT fallback, §7-Z/HH/P).
 *
 * ⚠️ D1 (per-request opt-in): this READS the requester's OWN pet doc
 * (tenants/{b}/list/{r}/pets/{petId}) read-only to snapshot the SAFE display
 * fields (name + type-emoji, §7-DD/PDPA — no health leak). It NEVER touches
 * petProfiles / the #10 write-path. The pet must be the requester's own and
 * `approved` (matches the directory publish gate).
 *
 * §7-NN: callable, not a Firestore trigger (Eventarc can't watch SE3 Firestore).
 * Region asia-southeast1 (matches every gamification CF).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { sanitizeNeed, validatePeriod, buildPetSnapshot, normalizeUrgency } = require('./_caretakerEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const MAX_NAME_LEN = 60;

exports.postCaretakerRequest = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, petId, period, need, urgency, requesterName } = data || {};
  if (!building || !roomId) {
    throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
  }
  const canonicalBuilding = String(building).toLowerCase();
  if (!['rooms', 'nest'].includes(canonicalBuilding)) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  if (!petId) {
    throw new functions.https.HttpsError('invalid-argument', 'กรุณาเลือกสัตว์เลี้ยงที่ต้องการให้ช่วยดูแล');
  }
  const cleanNeed = sanitizeNeed(need);
  if (!cleanNeed) {
    throw new functions.https.HttpsError('invalid-argument', 'กรุณาระบุสิ่งที่ต้องการให้ช่วยดูแล');
  }
  const periodVerdict = validatePeriod(period);
  if (!periodVerdict.ok) {
    throw new functions.https.HttpsError('invalid-argument',
      periodVerdict.reason === 'order'
        ? 'ช่วงเวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม'
        : 'กรุณาระบุช่วงเวลาที่ต้องการให้ช่วยดูแล');
  }

  // Auth: caller must be the tenant of this room (claim match, else SoT crosscheck).
  const { tenantData } = await assertTenantAccess({
    building: canonicalBuilding,
    roomId: String(roomId),
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  // Anti-spam: max 5 posts/day per uid.
  await checkRateLimit(context.auth.uid, 'postCaretakerRequest', 5, 86400);

  // D1: read the requester's OWN pet doc (read-only) → snapshot SAFE fields.
  const petRef = firestore.collection('tenants').doc(canonicalBuilding)
    .collection('list').doc(String(roomId)).collection('pets').doc(String(petId));
  const petSnap = await petRef.get();
  if (!petSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'ไม่พบสัตว์เลี้ยงตัวนี้');
  }
  const petData = petSnap.data() || {};
  if (petData.status !== 'approved') {
    throw new functions.https.HttpsError('failed-precondition', 'สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะขอผู้ดูแลได้');
  }
  const { petName, petTypeEmoji } = buildPetSnapshot(petData);

  const name = String(
    requesterName
    || (tenantData && (tenantData.name || tenantData.displayName))
    || `ห้อง ${roomId}`
  ).trim().slice(0, MAX_NAME_LEN);

  const Timestamp = admin.firestore.Timestamp;
  const ref = await firestore.collection('caretakerRequests').add({
    requesterUid: context.auth.uid,                  // server-set — anti-spoof
    requesterTenantId: `${canonicalBuilding}_${roomId}`,
    requesterName: name,
    building: canonicalBuilding,
    room: String(roomId),
    petId: String(petId),
    petName,
    petTypeEmoji,
    period: {
      from: Timestamp.fromMillis(periodVerdict.fromMs),
      to: Timestamp.fromMillis(periodVerdict.toMs),
    },
    need: cleanNeed,
    urgency: normalizeUrgency(urgency),
    status: 'open',
    caretakerUid: null,
    caretakerTenantId: null,
    caretakerBuilding: null,
    caretakerRoom: null,
    caretakerName: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, requestId: ref.id };
});
