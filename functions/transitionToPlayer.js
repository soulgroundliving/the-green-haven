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
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_BUILDINGS = new Set(['rooms', 'nest']);

const ARCHIVED_SUBCOLLECTIONS = [
  'paymentHistory', 'redemptions', 'wellnessClaimed', 'pets', 'complaintFreeMonthAwarded',
];

// Lower than archiveTenantOnMoveOut (450) — leaves room for the extra people/ write.
const BATCH_OP_LIMIT = 440;

const FIELDS_TO_CLEAR = {
  name: '', firstName: '', lastName: '', phone: '', email: '',
  emailVerified: false, lineID: '', address: '', idCardNumber: '',
  tenantId: '', contractId: '', linkedAuthUid: '',
  moveInDate: '', moveOutDate: '', rentAmount: 0, deposit: 0,
  depositPaid: false, contractDocument: '', contractFileName: '',
  contractStart: '', contractEnd: '', contractMonths: 0,
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
    if (!VALID_BUILDINGS.has(building)) {
      throw new functions.https.HttpsError('invalid-argument',
        `building must be 'rooms' or 'nest' (got '${building}')`);
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

    const totalOps = 4 + (totalSubDocs * 2); // archive set + blank + people set + liffUsers update + subcoll copies
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

    // 4. Upsert people/{tenantId} — identity + gamification + currentLease: null
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

    try {
      await batch.commit();
    } catch (e) {
      console.error('transitionToPlayer: batch commit failed:', e);
      throw new functions.https.HttpsError('internal', e.message || 'Batch commit failed');
    }

    // ── Post-batch: set Auth claim + update liffUsers (fire-and-forget) ──
    // Both are non-critical: archive + people doc are committed. If claim set
    // fails, admin can manually set via grant-admin-claim tool with role:'player'.
    if (linkedAuthUid) {
      admin.auth().setCustomUserClaims(linkedAuthUid, { role: 'player' })
        .then(() => console.log(`transitionToPlayer: claim set uid=${linkedAuthUid} role=player`))
        .catch(e => console.error(`transitionToPlayer: setCustomUserClaims failed uid=${linkedAuthUid}:`, e.message));
    } else {
      console.warn(`transitionToPlayer: no linkedAuthUid for ${building}/${roomId} — claim not set`);
    }

    if (lineID) {
      firestore.collection('liffUsers').doc(lineID)
        .update({ role: 'player', updatedAt: now })
        .catch(e => console.warn(`transitionToPlayer: liffUsers update failed lineID=${lineID}:`, e.message));
    }

    console.log(`transitionToPlayer: ${building}/${roomId} → archive/${contractId} + people/${tenantId} (subdocs=${copiedSubdocs}, uid=${linkedAuthUid}, by=${callerEmail || context.auth.uid})`);

    return {
      success: true,
      tenantId,
      contractId,
      building,
      roomId,
      archivedSubdocs: copiedSubdocs,
    };
  });
