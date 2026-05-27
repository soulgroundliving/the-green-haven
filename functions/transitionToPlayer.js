/**
 * transitionToPlayer — move an active tenant to community-member (player) status.
 *
 * Difference from archiveTenantOnMoveOut:
 *   - archiveTenantOnMoveOut: archives identity, room freed, no more LIFF access.
 *   - transitionToPlayer: same archive PLUS creates people/{tenantId} doc PLUS
 *     sets Firebase Auth claim role:'player' so the person stays in LINE with
 *     community/wellness/gamification access (billing, meter, maintenance hidden).
 *
 * What it does:
 *   1. Validates admin caller + input.
 *   2. Reads tenants/{b}/list/{r} — must have tenantId + name.
 *   3. Archives contract to tenants/{b}/archive/{contractId} with all subcollections
 *      (same batch logic as archiveTenantOnMoveOut — preserves identity + history).
 *   4. Upserts people/{tenantId} doc — identity + gamification, currentLease: null.
 *   5. Sets Firebase Auth custom claim role:'player' (fire-and-forget after batch).
 *   6. Updates liffUsers/{lineID}.role='player' so liffSignIn issues community token.
 *
 * Reversibility: when admin converts a new booking for the same LINE user,
 *   convertBookingToTenant Pass 5 reads people/{tenantId} to restore gamification
 *   and sets currentLease back. role:'player' is then revoked and tenant claims set.
 *
 * Region: asia-southeast1
 * Auth: admin claim required
 * Input:  { building, roomId }
 * Output: { success, tenantId, contractId, building, roomId, archivedSubdocs }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { getValidBuildings } = require('./buildingRegistry');
const { appendLog } = require('./_occupancyLog');

const ARCHIVED_SUBCOLLECTIONS = [
  'paymentHistory', 'redemptions', 'wellnessClaimed', 'pets', 'complaintFreeMonthAwarded',
];

// Lower than archiveTenantOnMoveOut (450) — leaves room for the extra people/ write + occupancyLog entry.
const BATCH_OP_LIMIT = 438;

const FIELDS_TO_CLEAR = {
  name: '', firstName: '', lastName: '', phone: '', email: '',
  emailVerified: false, lineID: '', address: '', idCardNumber: '',
  tenantId: '', contractId: '', linkedAuthUid: '',
  linkedAt: admin.firestore.FieldValue.delete(),
  phoneVerifiedAt: admin.firestore.FieldValue.delete(),
  moveInDate: '', moveOutDate: '', rentAmount: 0, deposit: 0,
  depositPaid: false, contractDocument: '', contractFileName: '',
  contractStart: '', contractEnd: '', contractMonths: 0,
  lease: admin.firestore.FieldValue.delete(),
  notes: '', licensePlate: '', emergencyContact: null, companyInfo: null,
  gamification: null, sourceBookingId: '',
};

exports.transitionToPlayer = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth ──────────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin claim required');
    }

    // ── Input ─────────────────────────────────────────────────────────────
    const { building, roomId } = data || {};
    const validBuildings = await getValidBuildings();
    if (!validBuildings.has(building)) {
      throw new functions.https.HttpsError('invalid-argument',
        `building must be one of [${Array.from(validBuildings).join(', ')}] (got '${building}')`);
    }
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9ก-๛]{1,20}$/.test(roomId)) {
      throw new functions.https.HttpsError('invalid-argument',
        `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
    }

    // ── Read tenant doc ───────────────────────────────────────────────────
    const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(roomId);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `tenants/${building}/list/${roomId} does not exist`);
    }
    const tenantData = tenantSnap.data() || {};
    const tenantId = String(tenantData.tenantId || '').trim();
    if (!tenantId) {
      throw new functions.https.HttpsError('failed-precondition',
        `Room ${building}/${roomId} is already vacant or has no tenantId`);
    }
    if (!String(tenantData.name || '').trim() && !String(tenantData.firstName || '').trim()) {
      throw new functions.https.HttpsError('failed-precondition',
        `Room ${building}/${roomId} has tenantId but no name — incomplete record`);
    }

    const linkedAuthUid = String(tenantData.linkedAuthUid || '').trim();
    const lineID = String(tenantData.lineID || '').trim();

    // ── Compute contractId ────────────────────────────────────────────────
    const contractId = String(tenantData.contractId || '').trim()
      || `LEGACY_${tenantId}_${Date.now()}`;

    const archiveRef = firestore
      .collection('tenants').doc(building)
      .collection('archive').doc(contractId);

    const existingArchive = await archiveRef.get();
    if (existingArchive.exists) {
      throw new functions.https.HttpsError('already-exists',
        `Archive doc tenants/${building}/archive/${contractId} already exists — cannot transition`);
    }

    // ── Read subcollections ───────────────────────────────────────────────
    const subDocs = {};
    let totalSubDocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      try {
        const snap = await tenantRef.collection(sub).get();
        subDocs[sub] = snap.docs;
        totalSubDocs += snap.docs.length;
      } catch (e) {
        console.warn(`transitionToPlayer: read ${sub} failed for ${building}/${roomId}:`, e.message);
        subDocs[sub] = [];
      }
    }

    // ── Resolve lease pointer + existence (anti-pattern §7-L fix 2026-05-20) ──
    // Mirror of archiveTenantOnMoveOut.js — without this the lease stays
    // status='active' after the player transition, and getActiveLease() finds
    // the orphan. revertTransitionToPlayer (kin CF) re-flips status back to
    // 'active' so the lifecycle pair is symmetric.
    const leaseIdToEnd = (tenantData.lease && tenantData.lease.leaseId)
      || tenantData.activeContractId
      || (tenantData.contractId ? tenantData.contractId : null);
    let leaseRefToEnd = null;
    if (leaseIdToEnd) {
      const candidateRef = firestore.collection('leases').doc(building).collection('list').doc(String(leaseIdToEnd));
      const leaseSnap = await candidateRef.get();
      if (leaseSnap.exists) {
        leaseRefToEnd = candidateRef;
      } else {
        console.warn(`transitionToPlayer: lease leases/${building}/list/${leaseIdToEnd} not found — skipping status update`);
      }
    } else {
      console.warn(`transitionToPlayer: no leaseId on tenants/${building}/list/${roomId} — skipping lease status update`);
    }

    // ops: archive set + blank + people set + occupancyLog set + (optional) lease + subcoll copies
    const totalOps = (leaseRefToEnd ? 6 : 5) + (totalSubDocs * 2);
    if (totalOps > BATCH_OP_LIMIT) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Tenant has ${totalSubDocs} subcoll docs (${totalOps} ops) — exceeds batch limit.`);
    }

    // ── Build + commit batch ──────────────────────────────────────────────
    const batch = firestore.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const callerEmail = String(context.auth.token.email || '');

    // 1. Archive parent doc
    batch.set(archiveRef, {
      ...tenantData,
      contractId,
      archivedAt: now,
      archivedReason: 'transitioned_to_player',
      archivedBy: context.auth.uid,
      archivedByEmail: callerEmail,
      sourceRoom: { building, roomId },
    });

    // 2. Subcollection copies + deletes
    let copiedSubdocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      for (const doc of subDocs[sub]) {
        batch.set(archiveRef.collection(sub).doc(doc.id), doc.data());
        batch.delete(doc.ref);
        copiedSubdocs++;
      }
    }

    // 3. Blank live doc (room freed)
    batch.update(tenantRef, {
      ...FIELDS_TO_CLEAR,
      building, roomId,
      status: 'vacant',
      updatedAt: now,
      lastArchivedAt: now,
      lastArchivedContractId: contractId,
    });

    // 4. Mark the active lease as ended (anti-pattern §7-L fix 2026-05-20) —
    //    mirror of archiveTenantOnMoveOut. End-reason distinguishes player
    //    transition from a full move-out, so audit + revert flow can tell.
    if (leaseRefToEnd) {
      batch.update(leaseRefToEnd, {
        status: 'ended',
        endedAt: now,
        endReason: 'transitioned_to_player',
        endedBy: context.auth.uid,
        endedByEmail: callerEmail,
      });
    }

    // 5. Upsert people/{tenantId} — identity + gamification + currentLease: null
    const gamification = tenantData.gamification || {};
    const peopleRef = firestore.collection('people').doc(tenantId);
    batch.set(peopleRef, {
      tenantId,
      name: tenantData.name || `${tenantData.firstName || ''} ${tenantData.lastName || ''}`.trim(),
      firstName: tenantData.firstName || '',
      lastName: tenantData.lastName || '',
      phone: tenantData.phone || '',
      email: tenantData.email || '',
      lineUserId: lineID,
      lineDisplayName: tenantData.lineDisplayName || '',
      linkedAuthUid,
      gamification: {
        points: Number(gamification.points) || 0,
        dailyStreak: Number(gamification.dailyStreak) || 0,
        badges: Array.isArray(gamification.badges) ? gamification.badges : [],
        lastDailyClaim: gamification.lastDailyClaim || null,
      },
      currentLease: null,
      sourceBuilding: building,
      sourceRoom: roomId,
      transitionedAt: now,
      transitionedBy: context.auth.uid,
      updatedAt: now,
    }, { merge: true });

    // 6. Plan B' occupancyLog — action='archived' (transition functionally archives
    //    the lease). Mirrors archiveTenantOnMoveOut's wiring. discriminator='' since
    //    one transition per leaseId is exhaustive (reverts undo the lease-end but
    //    don't write a new transition event — see revertTransitionToPlayer's
    //    'restored' entry). §7-DD: every sibling collection that downstream readers
    //    fall through to must be updated in the same batch.
    const personIdForLog = tenantData.personId ? String(tenantData.personId) : tenantId;
    try {
      appendLog(batch, firestore, {
        tenantId,
        tenantName: String(tenantData.name || tenantData.firstName || ''),
        personId: personIdForLog,
        building,
        roomId,
        action: 'archived',
        reason: 'transitioned_to_player',
        leaseId: leaseIdToEnd || contractId,
        by: context.auth.uid,
        byEmail: callerEmail || null,
        source: 'transitionToPlayer',
        discriminator: '',
      });
    } catch (logErr) {
      console.error('transitionToPlayer: occupancyLog append failed (aborting):', logErr.message);
      throw new functions.https.HttpsError('internal',
        `occupancyLog append failed: ${logErr.message}`);
    }

    try {
      await batch.commit();
    } catch (e) {
      console.error('transitionToPlayer: batch commit failed:', e);
      throw new functions.https.HttpsError('internal', e.message || 'Batch commit failed');
    }

    // ── Storage cleanup INTENTIONALLY NOT CALLED ────────────────────────────
    // archiveTenantOnMoveOut deletes pet Storage files via deletePetStorageForRoom
    // (§7-DD analogue) because move-out is one-way. transitionToPlayer is the
    // REVERSIBLE archive path — `revertTransitionToPlayer` restores the tenant
    // from `tenants/{b}/archive/{contractId}/pets/*` (Firestore subcollection).
    // If we deleted Storage here, the revert flow would restore pet docs whose
    // photoURL + vaccineBookURL point to deleted files (404 broken images).
    //
    // PII concern (next tenant of same room reading old player's pet photos)
    // is handled by storage.rules:28 — tightened in Phase C to require
    // token.room/token.building claim match. Do NOT add Storage cleanup here
    // without first removing the revert flow or coordinating with a Storage
    // restore mechanism.

    // ── Post-batch: set Auth claim + update liffUsers (fire-and-forget) ──
    // Both are non-critical: archive + people doc are committed. If claim set
    // fails, admin can manually set via grant-admin-claim tool with role:'player'.
    if (linkedAuthUid) {
      admin.auth().setCustomUserClaims(linkedAuthUid, { role: 'player' })
        .then(() => console.info(`transitionToPlayer: claim set uid=${linkedAuthUid} role=player`))
        .catch(e => console.error(`transitionToPlayer: setCustomUserClaims failed uid=${linkedAuthUid}:`, e.message));
    } else {
      console.warn(`transitionToPlayer: no linkedAuthUid for ${building}/${roomId} — claim not set`);
    }

    if (lineID) {
      firestore.collection('liffUsers').doc(lineID)
        .update({ role: 'player', tenantId, updatedAt: now })
        .catch(e => console.warn(`transitionToPlayer: liffUsers update failed lineID=${lineID}:`, e.message));
    }

    console.info(`transitionToPlayer: ${building}/${roomId} → archive/${contractId} + people/${tenantId} (subdocs=${copiedSubdocs}, uid=${linkedAuthUid}, by=${callerEmail || context.auth.uid})`);

    return {
      success: true,
      tenantId,
      contractId,
      building,
      roomId,
      archivedSubdocs: copiedSubdocs,
    };
  });
