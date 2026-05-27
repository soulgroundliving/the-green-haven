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
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// Plan B' S1: shared helper for the room-occupancy audit log (subcollection
// at tenants/{b}/list/{r}/occupancyLog/{key}). Append-only per Firestore rule.
const { appendLog } = require('./_occupancyLog');

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

  // ── Returning-tenant lookup (4-pass cascade, prefers strongest match) ──
  // Pass 1: live tenant doc by linkedAuthUid (current LINE account already linked
  //         to a room — covers the "still has a room, signing up for another" case)
  // Pass 2: archive doc by linkedAuthUid (Phase 1: same LINE account, previous room
  //         was archived on move-out)
  // Pass 3: archive doc by lineUserId field (in case linkedAuthUid was rotated)
  // Pass 4: archive doc by phone (returning with new LINE account but same phone)
  // Each pass picks the most recent match (orderBy archivedAt desc on archive
  // queries) so multiple prior tenancies don't fight over the tenantId.
  let priorTenantId = null;
  let priorGamificationFromArchive = null;
  let restoredFrom = null; // 'live' | 'archive_uid' | 'archive_lineid' | 'archive_phone'

  // Pass 1: live tenant doc by linkedAuthUid
  for (const b of ['rooms', 'nest']) {
    try {
      const q = firestore.collection('tenants').doc(b).collection('list')
        .where('linkedAuthUid', '==', lineUid).limit(1);
      const snap = await q.get();
      if (!snap.empty) {
        const data = snap.docs[0].data() || {};
        if (data.tenantId) {
          priorTenantId = String(data.tenantId);
          restoredFrom = 'live';
          break;
        }
      }
    } catch (e) {
      console.warn(`convertBookingToTenant: live tenant lookup in '${b}' failed:`, e.message);
    }
  }

  // Pass 2-4: scan archive subcollections — only if no live match
  if (!priorTenantId) {
    const prospectPhone = String(initialBooking.prospectPhone || '').trim();

    const scanArchive = async (field, value) => {
      if (!value) return null;
      for (const b of ['rooms', 'nest']) {
        try {
          // orderBy archivedAt desc + limit 1 → most recent archive wins
          // (a returning tenant may have rented multiple times before)
          const q = firestore.collection('tenants').doc(b).collection('archive')
            .where(field, '==', value)
            .orderBy('archivedAt', 'desc')
            .limit(1);
          const snap = await q.get();
          if (!snap.empty) {
            const d = snap.docs[0].data() || {};
            if (d.tenantId) return { tenantId: String(d.tenantId), gamification: d.gamification || null, building: b };
          }
        } catch (e) {
          // Missing composite index will throw; log + continue (other passes
          // may still match without the index).
          console.warn(`convertBookingToTenant: archive scan ${field}='${value}' in '${b}' failed:`, e.message);
        }
      }
      return null;
    };

    let hit = await scanArchive('linkedAuthUid', lineUid);
    if (hit) restoredFrom = 'archive_uid';
    if (!hit) {
      hit = await scanArchive('lineID', prospectLineId);
      if (hit) restoredFrom = 'archive_lineid';
    }
    if (!hit && prospectPhone) {
      hit = await scanArchive('phone', prospectPhone);
      if (hit) restoredFrom = 'archive_phone';
    }
    if (hit) {
      priorTenantId = hit.tenantId;
      // Phone-only match (Pass 4) is unverified — a bad actor who knows a prior
      // tenant's phone number could supply it as prospectPhone and claim their
      // gamification points. UID/LINE-ID matches (Passes 1-2) are system-issued
      // and cannot be guessed, so only those passes transfer points.
      priorGamificationFromArchive = (restoredFrom === 'archive_phone') ? null : hit.gamification;
    }

    // Pass 5: check people/{tenantId} for a community-member (player) returning
    // to a new lease. transitionToPlayer sets currentLease:null on this doc.
    if (!priorTenantId) {
      try {
        const peopleSnap = await firestore.collection('people')
          .where('linkedAuthUid', '==', lineUid)
          .where('currentLease', '==', null)
          .limit(1)
          .get();
        if (!peopleSnap.empty) {
          const d = peopleSnap.docs[0].data() || {};
          if (d.tenantId) {
            priorTenantId = String(d.tenantId);
            priorGamificationFromArchive = d.gamification || null;
            restoredFrom = 'people_player';
          }
        }
      } catch (e) {
        console.warn('convertBookingToTenant: people/ player lookup failed:', e.message);
      }
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
      //
      // Phase 1 archive restore: if the prior tenant was found in archive (no
      // live doc at this room), use the archived gamification as the base so
      // points/streaks/badges carry over. Live-doc match keeps existing
      // behavior (rare — only fires if same person is still listed somewhere).
      const priorGamification = existingTenant.exists
        ? (existingTenant.data().gamification || null)
        : (priorGamificationFromArchive || null);
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

      // Phase 6 slim tenant doc — thin room slot pointer only.
      // Identity (name, phone, email, lineID, ...) → people/{tenantId} below
      // Lease snapshot (moveInDate, deposit, rentAmount, ...) → leases/{b}/list/{contractId} below
      // tenants/{b}/list/{roomId} now carries only: pointers + reduced lease mirror
      // + slot-level audit (linkedAuthUid, sourceBookingId, gamification).
      // Readers overlay identity via PersonManager.getPersonSync and lease snapshot
      // via LeaseAgreementManager.getLease(lease.leaseId).
      //
      // Phase 3b-3 (True A1 unification): tenant.lease reduced mirror + activeContractId
      // pointer are set so getActiveLease(building, roomId) returns the lease
      // we create below in the same tx. Admin save then enters the UPDATE path
      // (preserving contractId == leaseId end-to-end) instead of minting a new
      // CONTRACT_<newTs>_<r> id.
      const tenantData = {
        tenantId,
        contractId,
        activeContractId: contractId,
        lease: {
          leaseId: contractId,
          status: 'active',
          startDate: startDateIso,
          endDate: moveOutDateIso,
        },
        building,
        roomId,
        // Slot-level audit (cross-room continuity, lifecycle)
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

      // Phase 3b-3: create the lease doc up-front with full booking terms so
      // tenant.contractId === lease.id end-to-end. Admin's saveTenantInfo will
      // find this via getActiveLease (reduced mirror above carries leaseId) and
      // enter the UPDATE path. Schema matches LeaseAgreementManager.createLease
      // output so the client-side reader is happy.
      const leaseRef = firestore.collection('leases').doc(building).collection('list').doc(contractId);
      const leaseData = {
        id: contractId,
        building,
        roomId,
        tenantId,
        tenantName: String(booking.prospectName || ''),
        moveInDate: startDateIso,
        moveOutDate: moveOutDateIso,
        contractStart: startDateIso,
        contractMonths: durationMonths,
        rentAmount: Number(booking.monthlyRent) || 0,
        deposit: Number(booking.depositAmount) || 0,
        // Phase 6: deposit audit fields now live on lease doc (moved from tenant doc)
        depositPaid: true,                                  // booking flow always paid in advance
        depositPaidAt: booking.slipVerifiedAt || admin.firestore.FieldValue.serverTimestamp(),
        depositSlipRef: booking.slipTransactionRef || '',
        status: 'active',
        contractFileName: '',
        contractDocument: '',
        sourceBookingId: bookingId,
        createdDate: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.set(leaseRef, leaseData, { merge: false });

      // Phase 3b-1: people/{tenantId} canonical write — runs for ALL conversions
      // (not just returning-player) so every new tenant has a person SSoT doc
      // from day one. merge:true so returning tenants don't lose accrued state
      // (gamification carried from archive, prior identity fields, etc.).
      const peopleRef = firestore.collection('people').doc(tenantId);
      const personPayload = {
        tenantId,
        name: String(booking.prospectName || ''),
        phone: String(booking.prospectPhone || ''),
        lineUserId: prospectLineId,
        lineDisplayName: String(booking.prospectName || ''),
        linkedAuthUid: lineUid,
        currentLease: { building, roomId, contractId },
        sourceBookingId: bookingId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (mergedGamification) personPayload.gamification = mergedGamification;
      tx.set(peopleRef, personPayload, { merge: true });

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

      // Plan B' S1: append-only occupancyLog entry for this room. Lives in
      // the SAME transaction so partial failure rolls back the log too
      // (no orphan history). Discriminator=bookingId ensures CF retries +
      // backfill collapse onto the same doc id (set without merge).
      try {
        appendLog(tx, firestore, {
          tenantId,
          tenantName: String(booking.prospectName || ''),
          personId: tenantId,                           // people/{tenantId} pointer
          building,
          roomId,
          action: 'moved_in',
          leaseId: contractId,
          by: context.auth.uid,
          byEmail: String(context.auth.token.email || '') || null,
          source: 'convertBookingToTenant',
          discriminator: bookingId,
          notes: priorTenantId ? `Returning tenant (priorTenantId=${priorTenantId})` : null,
        });
      } catch (logErr) {
        // Re-throw inside the txn so the whole conversion aborts. Wrong source
        // / action / missing field is a deploy bug, not a runtime condition.
        console.error('convertBookingToTenant: occupancyLog append failed (aborting):', logErr.message);
        throw logErr;
      }

      return {
        bookingId,
        tenantId,
        contractId,
        building,
        roomId,
        isReturningTenant: !!priorTenantId,
        restoredFrom,
        earlyBirdAwarded: awardEarlyBird,
        earlyBirdPoints: awardEarlyBird ? ebPoints : 0,
      };
    });
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('convertBookingToTenant: transaction failed:', e);
    throw new functions.https.HttpsError('internal', e.message || 'Conversion transaction failed');
  }

  // If player returning — revoke role:'player' claim + clear liffUsers.role
  // (fire-and-forget). currentLease pointer is set inside the transaction
  // above via the unified person-doc write — no separate update needed here.
  if (result.restoredFrom === 'people_player' && result.tenantId) {
    // Revoke player claim — new tenant claims set by liffSignIn on next sign-in.
    admin.auth().setCustomUserClaims(lineUid, {})
      .catch(e => console.warn(`convertBookingToTenant: revoke player claim failed uid=${lineUid}:`, e.message));

    // Clear role:'player' from liffUsers so liffSignIn issues tenant token next time.
    firestore.collection('liffUsers').doc(prospectLineId)
      .update({ role: admin.firestore.FieldValue.delete() })
      .catch(e => console.warn('convertBookingToTenant: liffUsers role clear failed:', e.message));
  }

  return { success: true, ...result };
});
