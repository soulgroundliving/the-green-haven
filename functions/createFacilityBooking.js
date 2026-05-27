/**
 * createFacilityBooking — atomic facility slot reservation.
 *
 * Prevents double-booking by running the conflict check + write inside one
 * Firestore transaction. If the slot+timeSlot is already taken for the same
 * date, the transaction aborts and a 'already-exists' error is returned.
 *
 * Input:
 *   { building, facilityType, slot, date, timeSlot }
 *   building:      canonical building id (e.g. 'rooms', 'nest')
 *   facilityType:  'parking' | 'laundry' | 'rooftop' | 'other'
 *   slot:          slot id matching a facilityConfig entry (e.g. 'A1', 'machine-1')
 *   date:          'YYYY-MM-DD' (CE calendar)
 *   timeSlot:      'morning' | 'afternoon' | 'evening' | 'fullday'
 *
 * Auth:
 *   LIFF tenant (token.room + token.building claims) or admin.
 *
 * Returns:
 *   { bookingId: string }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getValidBuildings } = require('./buildingRegistry');
const { resolveTenantClaims, assertTenantAccess } = require('./_authSoT');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_FACILITY_TYPES = new Set(['parking', 'laundry', 'rooftop', 'other']);
const VALID_TIME_SLOTS = new Set(['morning', 'afternoon', 'evening', 'fullday']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ADVANCE_DAYS_DEFAULT = 14;

exports.createFacilityBooking = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth gate ──────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const tok = context.auth.token || {};
    const isAdmin = tok.admin === true;

    // ── Input validation ───────────────────────────────────────────────────
    const { building, facilityType, slot, date, timeSlot } = data || {};

    if (!building || typeof building !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'building is required');
    }
    if (!VALID_FACILITY_TYPES.has(facilityType)) {
      throw new functions.https.HttpsError('invalid-argument',
        `facilityType must be one of: ${[...VALID_FACILITY_TYPES].join(', ')}`);
    }
    if (!slot || typeof slot !== 'string' || slot.length > 30) {
      throw new functions.https.HttpsError('invalid-argument', 'slot is required (max 30 chars)');
    }
    if (!date || !DATE_RE.test(date)) {
      throw new functions.https.HttpsError('invalid-argument', 'date must be YYYY-MM-DD');
    }
    if (!VALID_TIME_SLOTS.has(timeSlot)) {
      throw new functions.https.HttpsError('invalid-argument',
        `timeSlot must be one of: ${[...VALID_TIME_SLOTS].join(', ')}`);
    }

    // Tenant ownership check — _authSoT 6-path model. resolveTenantClaims
    // pulls from tok.room/tok.building OR people-doc fallback (§7-Z survival
    // after ~1h claim-strip window). assertTenantAccess then runs the
    // SoT crosscheck against tenants/{building}/list/{roomId}.linkedAuthUid
    // + tenantId. Admin bypasses both via Path 0.
    let resolvedTenantRoom = '';
    if (!isAdmin) {
      const resolved = await resolveTenantClaims({
        context, firestore,
        HttpsError: functions.https.HttpsError,
      });
      if (!resolved.building || !resolved.roomId) {
        throw new functions.https.HttpsError('permission-denied',
          'Unable to resolve tenant room/building — claims missing and people-doc lookup empty');
      }
      if (resolved.building !== building) {
        throw new functions.https.HttpsError('permission-denied',
          'Tenants may only book facilities in their own building');
      }
      await assertTenantAccess({
        building: resolved.building,
        roomId:   resolved.roomId,
        context, firestore,
        HttpsError: functions.https.HttpsError,
      });
      resolvedTenantRoom = resolved.roomId;
    }

    // ── Building validation ────────────────────────────────────────────────
    const validBuildings = await getValidBuildings(firestore);
    if (!validBuildings.has(building)) {
      throw new functions.https.HttpsError('invalid-argument', `Unknown building: ${building}`);
    }

    // ── Date range validation ──────────────────────────────────────────────
    const bookingDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      throw new functions.https.HttpsError('invalid-argument', 'Cannot book in the past');
    }

    // ── Load facility config ───────────────────────────────────────────────
    const configId = `${building}_${facilityType}`;
    const configSnap = await firestore.collection('facilityConfig').doc(configId).get();

    if (!configSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `Facility ${facilityType} is not configured for building ${building}`);
    }

    const config = configSnap.data();
    if (!config.active) {
      throw new functions.https.HttpsError('failed-precondition',
        `Facility ${facilityType} is currently not available`);
    }

    // Validate slot exists and is enabled
    const slots = Array.isArray(config.slots) ? config.slots : [];
    const slotConfig = slots.find(s => s.id === slot);
    if (!slotConfig) {
      throw new functions.https.HttpsError('invalid-argument',
        `Slot "${slot}" not found in facility config`);
    }
    if (slotConfig.enabled === false) {
      throw new functions.https.HttpsError('failed-precondition',
        `Slot "${slot}" is currently disabled`);
    }

    // Validate timeSlot exists in config (if config defines custom ones)
    const timeSlots = Array.isArray(config.timeSlots) ? config.timeSlots : [];
    if (timeSlots.length > 0 && !timeSlots.find(ts => ts.id === timeSlot)) {
      throw new functions.https.HttpsError('invalid-argument',
        `Time slot "${timeSlot}" not available for this facility`);
    }

    // Advance booking limit
    const maxDays = Number(config.maxAdvanceDays) || MAX_ADVANCE_DAYS_DEFAULT;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDays);
    maxDate.setHours(23, 59, 59, 999);
    if (bookingDate > maxDate) {
      throw new functions.https.HttpsError('invalid-argument',
        `Cannot book more than ${maxDays} days in advance`);
    }

    // ── Tenant identity ────────────────────────────────────────────────────
    const tenantUid  = context.auth.uid;
    const tenantRoom = isAdmin ? (data.tenantRoom || '') : resolvedTenantRoom;
    let tenantName = '';
    if (!isAdmin && tenantRoom) {
      try {
        const snap = await firestore
          .collection('tenants').doc(building).collection('list').doc(tenantRoom).get();
        if (snap.exists) tenantName = String(snap.data()?.name || '');
      } catch (_) { /* non-fatal */ }
    }

    // ── Atomic conflict check + write ──────────────────────────────────────
    const bookingsCol = firestore.collection('facilityBookings');

    // Query for conflicting confirmed booking on the same slot + timeSlot + date
    const conflictQuery = bookingsCol
      .where('building', '==', building)
      .where('facilityType', '==', facilityType)
      .where('slot', '==', slot)
      .where('date', '==', date)
      .where('timeSlot', '==', timeSlot)
      .where('status', '==', 'confirmed')
      .limit(1);

    let bookingId;
    await firestore.runTransaction(async tx => {
      const conflictSnap = await tx.get(conflictQuery);
      if (!conflictSnap.empty) {
        throw new functions.https.HttpsError('already-exists',
          `ช่วงเวลานี้ถูกจองไปแล้ว — กรุณาเลือกช่วงเวลาอื่น`);
      }

      const newRef = bookingsCol.doc();
      bookingId = newRef.id;
      tx.set(newRef, {
        building,
        facilityType,
        slot,
        date,
        timeSlot,
        tenantUid,
        tenantRoom,
        tenantBuilding: building,
        tenantName,
        status:     'confirmed',
        cancelledBy: null,
        createdAt:  admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { bookingId };
  });
