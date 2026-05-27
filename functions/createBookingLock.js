/**
 * createBookingLock — atomic room reservation for the booking flow.
 *
 * The race-condition fence: two prospects clicking the same room within the
 * same millisecond. A naive client-side write would let both succeed
 * (Firestore has no unique constraints other than docId). Here we run the
 * existence check and the create inside one transaction, so exactly one wins.
 *
 * Side-effects on success:
 *   1. Creates bookings/{auto} with status='locked', lockedUntil=now+20min
 *   2. Generates the PromptPay deposit QR payload (server-side — receiver
 *      phone comes from buildings/{rooms|nest}.promptPayId, never trusted from client)
 *   3. Returns { bookingId, qrPayload, qrAmount, lockedUntil } to client
 *
 * Region: asia-southeast1 (matches liffSignIn / verifySlip / redeemReward)
 * Auth: caller must have role='prospect' claim (set by liffBookingSignIn).
 *       Admin claim bypasses for ops/dashboard manual booking.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { buildPromptPayPayload } = require('./promptpay');
const { checkRateLimit } = require('./_rateLimit');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { getValidBuildings } = require('./buildingRegistry');
const { isActiveTenant } = require('./_occupancy');

const LOCK_DURATION_MS = 20 * 60 * 1000; // 20 minutes
const EARLY_BIRD_WINDOW_DAYS = 30;
const EARLY_BIRD_POINTS = 500;
const VALID_DURATIONS = [3, 6, 12, 24];

exports.createBookingLock = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  // ── Auth gate ────────────────────────────────────────────────────────────
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const tok = context.auth.token || {};
  const isAdmin = tok.admin === true;
  const isProspect = tok.role === 'prospect';
  if (!isAdmin && !isProspect) {
    throw new functions.https.HttpsError('permission-denied',
      'Only prospects (LIFF booking flow) or admins can create a booking lock');
  }

  // 3 lock attempts per hour per prospect — prevents simultaneous room hoarding.
  if (isProspect) await checkRateLimit(context.auth.uid, 'createBookingLock', 3, 3600);

  // ── Input validation ────────────────────────────────────────────────────
  const {
    building,
    roomId,
    startDate,         // ISO date string (YYYY-MM-DD)
    durationMonths,
    prospectName,
    prospectPhone,
  } = data || {};

  if (!building || !roomId || !startDate || !durationMonths || !prospectName || !prospectPhone) {
    throw new functions.https.HttpsError('invalid-argument',
      'Missing required fields: building, roomId, startDate, durationMonths, prospectName, prospectPhone');
  }
  const validBuildings = await getValidBuildings();
  if (!validBuildings.has(String(building).toLowerCase())) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown building: ${building}`);
  }
  if (!VALID_DURATIONS.includes(Number(durationMonths))) {
    throw new functions.https.HttpsError('invalid-argument',
      `durationMonths must be one of ${VALID_DURATIONS.join(', ')}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate))) {
    throw new functions.https.HttpsError('invalid-argument', 'startDate must be YYYY-MM-DD');
  }
  const startDateObj = new Date(String(startDate) + 'T00:00:00+07:00');
  if (Number.isNaN(startDateObj.getTime())) {
    throw new functions.https.HttpsError('invalid-argument', 'startDate is not a valid date');
  }
  if (startDateObj < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
    throw new functions.https.HttpsError('invalid-argument', 'startDate cannot be in the past');
  }
  if (typeof prospectName !== 'string' || prospectName.length < 2 || prospectName.length > 80) {
    throw new functions.https.HttpsError('invalid-argument', 'prospectName must be 2-80 chars');
  }
  const cleanPhone = String(prospectPhone).replace(/\D/g, '');
  if (cleanPhone.length !== 10 || !cleanPhone.startsWith('0')) {
    throw new functions.https.HttpsError('invalid-argument', 'prospectPhone must be a 10-digit Thai mobile');
  }

  const canonicalBuilding = String(building).toLowerCase();
  const canonicalRoomId = String(roomId);
  if (!/^[A-Za-z0-9ก-๛]{1,20}$/.test(canonicalRoomId)) {
    throw new functions.https.HttpsError('invalid-argument', 'roomId contains invalid characters');
  }

  // ── Pull room rate from rooms_config (RTDB) — same source as billing ────
  // Note: room-config.js seeds RTDB rooms_config/{building}/{roomId}. We
  // read from there so prospects can't pass a bogus rentPrice in the body.
  let monthlyRent = 0;
  let depositFromConfig = 0;
  try {
    const roomSnap = await admin.database().ref(`rooms_config/${canonicalBuilding}/${canonicalRoomId}`).once('value');
    const roomData = roomSnap.val() || {};
    if (!roomData.id) {
      throw new functions.https.HttpsError('not-found',
        `Room ${canonicalBuilding}/${canonicalRoomId} not found in rooms_config`);
    }
    if (roomData.deleted) {
      throw new functions.https.HttpsError('failed-precondition',
        `Room ${canonicalBuilding}/${canonicalRoomId} has been removed`);
    }
    monthlyRent = Number(roomData.rentPrice) || 0;
    depositFromConfig = Number(roomData.deposit) || 0;
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('createBookingLock: rooms_config read failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not resolve room rate');
  }
  if (monthlyRent <= 0) {
    throw new functions.https.HttpsError('failed-precondition',
      'Room has no rent price configured — admin must set this first');
  }
  const depositAmount = monthlyRent * 2;

  // ── Pull receiver phone from buildings/{canonicalBuilding}.promptPayId ────────
  // Admin configures per-building PromptPay in dashboard → Buildings page.
  // Canonical building id ('rooms', 'nest') IS the Firestore doc id since B4 migration.
  // All buildings/* docs are canonical-only as of 2026-05-18 migration (see
  // tools/migrate-buildings-promptpay.js). CLAUDE.md §7-T documents the history.
  const fsBuildingId = canonicalBuilding;
  let receiverPhone;
  try {
    const buildingSnap = await firestore.doc(`buildings/${fsBuildingId}`).get();
    const bd = buildingSnap.exists ? buildingSnap.data() : {};
    receiverPhone = String(bd.promptPayId || '');
  } catch (e) {
    console.error('createBookingLock: buildings read failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not resolve receiver phone');
  }
  if (!receiverPhone) {
    throw new functions.https.HttpsError('failed-precondition',
      'PromptPay not configured for this building — admin must save payment info first');
  }

  // ── Generate PromptPay payload ──────────────────────────────────────────
  let qrPayload;
  try {
    qrPayload = buildPromptPayPayload(receiverPhone, depositAmount);
  } catch (e) {
    console.error('createBookingLock: PromptPay generation failed:', e.message);
    throw new functions.https.HttpsError('internal', 'Could not generate PromptPay QR');
  }

  // ── Compute Early Bird eligibility ─────────────────────────────────────
  // Phase 6: Gamification is Nest-only (per gamification_ssot.md); awarding
  // points to a Rooms tenant doc that has no gamification UI is dead-data.
  // Gate eligibility on building='nest' so Rooms prospects don't see misleading
  // "+500 pts" hints in booking.html that would never materialize.
  const nowMs = Date.now();
  const daysUntilStart = (startDateObj.getTime() - nowMs) / (24 * 60 * 60 * 1000);
  const meetsTimingThreshold = daysUntilStart >= EARLY_BIRD_WINDOW_DAYS;
  const earlyBirdEligible = meetsTimingThreshold && canonicalBuilding === 'nest';
  const earlyBirdPoints = earlyBirdEligible ? EARLY_BIRD_POINTS : 0;

  // ── Atomic lock-or-fail transaction ────────────────────────────────────
  // Strategy: query bookings filtered to building+roomId (small result set,
  // no composite index needed), then in-memory filter active statuses. Inside
  // the transaction we re-read to ensure no other lock landed between query
  // and create. Firestore transactions retry on conflict.
  const bookingsRef = firestore.collection('bookings');
  const lockedUntilMs = nowMs + LOCK_DURATION_MS;

  let bookingId;
  try {
    bookingId = await firestore.runTransaction(async (tx) => {
      // Re-query inside transaction for atomicity. Filter by building+roomId
      // only (Firestore transaction.get supports queries; result set is small).
      const q = bookingsRef
        .where('building', '==', canonicalBuilding)
        .where('roomId', '==', canonicalRoomId);
      const snap = await tx.get(q);
      const blockingStatuses = new Set(['locked', 'paid', 'kyc_pending', 'kyc_approved']);
      const stillActive = snap.docs.filter(d => {
        const b = d.data() || {};
        if (!blockingStatuses.has(b.status)) return false;
        if (b.status === 'locked') {
          const lu = b.lockedUntil;
          const luMs = lu && typeof lu.toMillis === 'function' ? lu.toMillis() : 0;
          if (luMs <= nowMs) return false; // expired lock = not blocking
        }
        return true;
      });
      if (stillActive.length > 0) {
        throw new functions.https.HttpsError('failed-precondition',
          `Room ${canonicalBuilding}/${canonicalRoomId} is currently held or booked`);
      }

      // Check active tenant on the room. Post-Phase-3 conversions write a SLIM
      // tenant doc — identity (name/phone/email) is in people/{tenantId}, so a
      // name-only check (legacy) misses active rooms. Treat the doc as occupied
      // if ANY of these signals is present: tenantId, linkedAuthUid, an active
      // lease subobject, or the legacy name field. archiveTenantOnMoveOut +
      // transitionToPlayer clear ALL of these to empty strings, so a truly
      // vacant doc returns false here.
      const tenantRef = firestore
        .collection('tenants').doc(canonicalBuilding)
        .collection('list').doc(canonicalRoomId);
      const tenantSnap = await tx.get(tenantRef);
      if (tenantSnap.exists) {
        const td = tenantSnap.data() || {};
        if (isActiveTenant(td)) {
          throw new functions.https.HttpsError('failed-precondition',
            `Room ${canonicalBuilding}/${canonicalRoomId} is currently occupied`);
        }
      }

      // Mint the booking doc
      const newRef = bookingsRef.doc();
      const lineUserId = String(tok.lineUserId || '').trim();
      tx.set(newRef, {
        prospectUid: context.auth.uid,
        prospectLineId: lineUserId,
        prospectName: String(prospectName).trim(),
        prospectPhone: cleanPhone,
        building: canonicalBuilding,
        roomId: canonicalRoomId,
        startDate: admin.firestore.Timestamp.fromDate(startDateObj),
        durationMonths: Number(durationMonths),
        monthlyRent,
        depositAmount,
        earlyBirdEligible,
        earlyBirdPoints,
        status: 'locked',
        lockedUntil: admin.firestore.Timestamp.fromMillis(lockedUntilMs),
        promptPayPayload: qrPayload,
        qrAmount: depositAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return newRef.id;
    });
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('createBookingLock: transaction failed:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Lock transaction failed');
  }

  console.info(`🔒 createBookingLock: ${canonicalBuilding}/${canonicalRoomId} locked by ${context.auth.uid} → bookingId=${bookingId}`);
  return {
    bookingId,
    qrPayload,
    qrAmount: depositAmount,
    monthlyRent,
    lockedUntil: lockedUntilMs,
    earlyBirdEligible,
    earlyBirdPoints,
  };
});
