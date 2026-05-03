/**
 * convertBookingToTenant — admin-only conversion of a paid booking into a real
 * tenant doc + liffUsers approval. Closes the loop from prospect to occupant.
 *
 * What it does (one Firestore transaction so partial writes are impossible):
 *   1. Validates the caller is admin (custom claim) and the booking is in a
 *      convert-eligible status ('paid' or 'kyc_approved'; 'kyc_pending' allowed
 *      with skipKyc:true escape hatch for ops).
 *   2. Refuses if the target room already has an active tenant (defense
 *      against a race where admin double-clicks Convert while another admin
 *      is mid-edit on the same room).
 *   3. Looks up the LINE user across both buildings — if they were a tenant
 *      before (linkedAuthUid == 'line:' + prospectLineId), reuses that
 *      tenantId so cross-room continuity is preserved. Otherwise mints a new
 *      one in the existing TENANT_{ts}_{roomId} pattern (matches
 *      dashboard-tenant-modal.js:499).
 *   4. Creates tenants/{building}/list/{roomId} with the same field shape
 *      tenant_app.html / dashboard-extra.js read.
 *   5. Sets liffUsers/{lineUserId} = approved + room/building so the new
 *      tenant can sign into tenant_app.html immediately via liffSignIn —
 *      no admin re-approval step needed.
 *   6. Marks booking status='converted', tenantId, contractId, convertedAt.
 *
 * Why a separate CF (not inline admin SDK from a dashboard script): the
 * tenant create + booking update + liffUsers create must all succeed or all
 * fail. A multi-step client-side write would leave booking='paid' with no
 * tenant doc if it crashed mid-way, and admins would have to clean up
 * manually. Server-side transaction = atomic.
 *
 * Region: asia-southeast1
 * Auth: caller MUST have admin claim (no fallback)
 * Input:  { bookingId, skipKyc?: boolean }
 * Output: { success, bookingId, tenantId, building, roomId, isReturningTenant }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const CONVERT_ELIGIBLE_STATUSES = new Set(['paid', 'kyc_approved']);
const SKIP_KYC_STATUSES = new Set(['paid', 'kyc_pending', 'kyc_approved']);

exports.convertBookingToTenant = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied',
      'Admin claim required to convert a booking');
  }

  // ── Input ──────────────────────────────────────────────────────────────
  const { bookingId, skipKyc } = data || {};
  if (!bookingId || typeof bookingId !== 'string' || !/^[A-Za-z0-9]{4,40}$/.test(bookingId)) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
  }
  const allowedStatuses = skipKyc === true ? SKIP_KYC_STATUSES : CONVERT_ELIGIBLE_STATUSES;

  const bookingRef = firestore.collection('bookings').doc(bookingId);

  // ── Existing-tenant lookup runs OUTSIDE the transaction ─────────────────
  // We need to query across both buildings (collection paths differ — admin SDK
  // can't `where` across two collections in one go). Two non-transactional reads
  // are acceptable here because:
  //   - linkedAuthUid is a SET-ONCE field per LINE account (only liffSignIn /
  //     this CF write it), so the result doesn't drift mid-conversion;
  //   - if we did a tx.get inside the transaction, the txn would conflict on
  //     every tenants/* doc read, ballooning retry rate.
  // Read booking once first to get prospectLineId.
  const initialSnap = await bookingRef.get();
  if (!initialSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Booking ${bookingId} not found`);
  }
  const initialBooking = initialSnap.data() || {};
  const prospectLineId = String(initialBooking.prospectLineId || '');
  if (!prospectLineId) {
    throw new functions.https.HttpsError('failed-precondition',
      'Booking has no prospectLineId — cannot link to LINE account');
  }
  const lineUid = 'line:' + prospectLineId;

  // Search both buildings for prior tenancy
  let priorTenantId = null;
  for (const b of ['rooms', 'nest']) {
    try {
      const q = firestore.collection('tenants').doc(b).collection('list')
        .where('linkedAuthUid', '==', lineUid).limit(1);
      const snap = await q.get();
      if (!snap.empty) {
        const data = snap.docs[0].data() || {};
        if (data.tenantId) {
          priorTenantId = String(data.tenantId);
          break;
        }
      }
    } catch (e) {
      console.warn(`convertBookingToTenant: tenant lookup in '${b}' failed:`, e.message);
    }
  }

  // ── Atomic conversion transaction ──────────────────────────────────────
  let result;
  try {
    result = await firestore.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Booking ${bookingId} disappeared`);
      }
      const booking = bookingSnap.data();
      if (!allowedStatuses.has(booking.status)) {
        throw new functions.https.HttpsError('failed-precondition',
          `Booking status is '${booking.status}'; not eligible for conversion (need ${[...allowedStatuses].join('/')})`);
      }

      const building = String(booking.building);
      const roomId = String(booking.roomId);
      if (!['rooms', 'nest'].includes(building) || !roomId) {
        throw new functions.https.HttpsError('failed-precondition',
          'Booking has invalid building/roomId');
      }

      // Refuse if room already occupied (race-double-click defense)
      const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(roomId);
      const existingTenant = await tx.get(tenantRef);
      if (existingTenant.exists) {
        const td = existingTenant.data() || {};
        if (td.name && String(td.name).trim() && !td.movedOut) {
          throw new functions.https.HttpsError('failed-precondition',
            `Room ${building}/${roomId} already has an active tenant — cannot overwrite`);
        }
      }

      const tenantId = priorTenantId || `TENANT_${Date.now()}_${roomId}`;
      const contractId = `CONTRACT_${Date.now()}_${roomId}`;

      // Compute moveOutDate = startDate + durationMonths (best-effort; admin can edit later)
      const startDate = booking.startDate && typeof booking.startDate.toDate === 'function'
        ? booking.startDate.toDate() : null;
      const durationMonths = Number(booking.durationMonths) || 12;
      let moveOutDateIso = null;
      if (startDate) {
        const moveOut = new Date(startDate);
        moveOut.setMonth(moveOut.getMonth() + durationMonths);
        moveOutDateIso = moveOut.toISOString().slice(0, 10);
      }
      const startDateIso = startDate ? startDate.toISOString().slice(0, 10) : null;

      // ── Phase 6: Early Bird gamification award ─────────────────────────
      // booking.earlyBirdEligible was already gated to building='nest' inside
      // createBookingLock — so this branch only fires for Nest tenants. Award
      // is idempotent because convert can only run once per booking (status
      // guard rejects 'converted' on subsequent calls).
      const priorGamification = existingTenant.exists ? (existingTenant.data().gamification || null) : null;
      const ebPoints = Number(booking.earlyBirdPoints) || 0;
      const awardEarlyBird = !!booking.earlyBirdEligible && ebPoints > 0;
      let mergedGamification = priorGamification;
      if (awardEarlyBird) {
        const priorPts = Number(priorGamification?.points) || 0;
        mergedGamification = {
          ...(priorGamification || {}),
          points: priorPts + ebPoints,
          earlyBirdPoints: ebPoints,
          earlyBirdAwardedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }

      // Build tenant doc — minimal but complete enough that tenant_app.html
      // can render the room without admin filling more fields. Admin can still
      // edit via dashboard's existing tenant modal afterward.
      const tenantData = {
        tenantId,
        contractId,
        name: String(booking.prospectName || ''),
        firstName: '',
        lastName: '',
        phone: String(booking.prospectPhone || ''),
        email: '',
        lineID: '',
        building,
        roomId,
        moveInDate: startDateIso,
        moveOutDate: moveOutDateIso,
        rentAmount: Number(booking.monthlyRent) || 0,
        deposit: Number(booking.depositAmount) || 0,
        depositPaid: true,                                  // booking flow always paid in advance
        depositPaidAt: booking.slipVerifiedAt || admin.firestore.FieldValue.serverTimestamp(),
        depositSlipRef: booking.slipTransactionRef || '',
        contractStart: startDateIso,
        contractEnd: moveOutDateIso,
        contractMonths: durationMonths,
        linkedAuthUid: lineUid,
        linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceBookingId: bookingId,
        gamification: mergedGamification,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      // Only write gamification field if there's something to write
      if (!tenantData.gamification) {
        delete tenantData.gamification;
      }

      tx.set(tenantRef, tenantData, { merge: true });

      // Audit ledger for the Early Bird award (mirrors verifySlip's
      // paymentHistory pattern). monthKey is the conversion month so it
      // doesn't collide with rent payments — rent uses YYYY-MM, this uses
      // booking_early_bird_{conversionMonth}.
      if (awardEarlyBird) {
        const conversionMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const ledgerRef = tenantRef.collection('paymentHistory').doc(`booking_early_bird_${conversionMonth}`);
        tx.set(ledgerRef, {
          type: 'booking_early_bird',
          points: ebPoints,
          status: 'awarded',
          bookingId,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // liffUsers/{lineUserId} approval — so the new tenant's NEXT liffSignIn
      // call (when they open tenant_app.html) succeeds without admin re-approval
      const liffUserRef = firestore.collection('liffUsers').doc(prospectLineId);
      tx.set(liffUserRef, {
        lineUserId: prospectLineId,
        lineDisplayName: String(booking.prospectName || ''),
        room: roomId,
        building,
        status: 'approved',
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedVia: 'booking-conversion',
        sourceBookingId: bookingId,
      }, { merge: true });

      // Mark booking converted
      tx.update(bookingRef, {
        status: 'converted',
        tenantId,
        contractId,
        convertedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedBy: context.auth.uid,
        earlyBirdAwarded: awardEarlyBird,
        earlyBirdAwardedPoints: awardEarlyBird ? ebPoints : 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        bookingId,
        tenantId,
        contractId,
        building,
        roomId,
        isReturningTenant: !!priorTenantId,
        earlyBirdAwarded: awardEarlyBird,
        earlyBirdPoints: awardEarlyBird ? ebPoints : 0,
      };
    });
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('convertBookingToTenant: transaction failed:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Conversion transaction failed');
  }

  console.log(`✅ convertBookingToTenant: ${bookingId} → tenants/${result.building}/list/${result.roomId} (tenantId=${result.tenantId}, returning=${result.isReturningTenant})`);
  return { success: true, ...result };
});
