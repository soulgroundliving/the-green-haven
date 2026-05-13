/**
 * revertTransitionToPlayer — undo a transitionToPlayer call.
 *
 * Restores a tenant whose `transitionToPlayer` was mistakenly invoked. Reads
 * the archive doc + people/{tenantId} + archive subcollections, writes a full
 * live tenant doc, revokes the player Auth claim, and clears the player role
 * from liffUsers. Archive doc is preserved (audit trail) with revertedAt set.
 *
 * One Firestore batch + one post-batch setCustomUserClaims:
 *   1. Validates admin caller + input.
 *   2. Reads tenants/{b}/list/{r} — must be status='vacant' with
 *      lastArchivedContractId pointing to a 'transitioned_to_player' archive.
 *   3. Reads tenants/{b}/archive/{contractId} — pre-flight check on
 *      archivedReason so this CF only reverses transitions (not move-outs).
 *   4. Reads people/{tenantId} — must exist, supplies latest identity +
 *      gamification + linkedAuthUid (the player may have earned points
 *      between transition and revert; person doc is the freshest source).
 *   5. Reads archive subcollections (paymentHistory, redemptions,
 *      wellnessClaimed, pets, complaintFreeMonthAwarded) and copies (not
 *      moves) them back to the live doc so the active lease has its
 *      history; archive subdocs stay as audit.
 *   6. Batch:
 *      - Live tenant doc: archived fields ⊕ people overrides ⊕ revertedAt/By
 *        metadata; status + lastArchived* deleted, linkedAt refreshed.
 *      - liveDoc/{subcoll}/{id}: copy from archive subcoll.
 *      - people/{tenantId}.currentLease pointer set.
 *      - liffUsers/{lineUserId}.role + .tenantId deleted; room/building
 *        re-affirmed; status='approved'.
 *      - archive doc: revertedAt + revertedBy stamped (NOT deleted).
 *   7. Post-batch (non-critical, fire-and-forget):
 *      setCustomUserClaims(linkedAuthUid, { room, building }) — replaces
 *      { role:'player', tenantId } claim so next liffSignIn issues a normal
 *      tenant token instead of the player path.
 *
 * Region: asia-southeast1
 * Auth: admin claim required
 * Input:  { building, roomId, contractId? }
 *           contractId optional — falls back to live doc's lastArchivedContractId
 * Output: { success, tenantId, contractId, building, roomId, linkedAuthUid, restoredSubdocs }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { getValidBuildings } = require('./buildingRegistry');

const ARCHIVED_SUBCOLLECTIONS = [
  'paymentHistory', 'redemptions', 'wellnessClaimed', 'pets', 'complaintFreeMonthAwarded',
];

// Archive metadata fields — NOT copied back to live doc on revert.
const ARCHIVE_METADATA_FIELDS = new Set([
  'archivedAt', 'archivedReason', 'archivedBy', 'archivedByEmail', 'sourceRoom',
]);

const BATCH_OP_LIMIT = 440;

exports.revertTransitionToPlayer = functions
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
    const { building, roomId, contractId: explicitContractId } = data || {};
    const validBuildings = await getValidBuildings();
    if (!validBuildings.has(building)) {
      throw new functions.https.HttpsError('invalid-argument',
        `building must be one of [${Array.from(validBuildings).join(', ')}] (got '${building}')`);
    }
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9ก-๛]{1,20}$/.test(roomId)) {
      throw new functions.https.HttpsError('invalid-argument',
        `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
    }

    // ── Read live tenant doc ──────────────────────────────────────────────
    const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(roomId);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `tenants/${building}/list/${roomId} does not exist`);
    }
    const liveData = tenantSnap.data() || {};
    if (liveData.status && liveData.status !== 'vacant') {
      throw new functions.https.HttpsError('failed-precondition',
        `Room ${building}/${roomId} status='${liveData.status}' — expected 'vacant'`);
    }

    const contractId = String(explicitContractId || liveData.lastArchivedContractId || '').trim();
    if (!contractId) {
      throw new functions.https.HttpsError('invalid-argument',
        `contractId required (live doc has no lastArchivedContractId)`);
    }

    // ── Read archive doc ──────────────────────────────────────────────────
    const archiveRef = firestore.collection('tenants').doc(building).collection('archive').doc(contractId);
    const archiveSnap = await archiveRef.get();
    if (!archiveSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `Archive doc tenants/${building}/archive/${contractId} does not exist`);
    }
    const archiveData = archiveSnap.data() || {};
    if (archiveData.archivedReason !== 'transitioned_to_player') {
      throw new functions.https.HttpsError('failed-precondition',
        `Archive doc archivedReason='${archiveData.archivedReason}' — this CF only reverts 'transitioned_to_player'`);
    }
    if (archiveData.revertedAt) {
      throw new functions.https.HttpsError('already-exists',
        `Archive doc was already reverted at ${archiveData.revertedAt.toDate?.()?.toISOString?.() || '<ts>'} — refusing to revert again`);
    }
    const tenantId = String(archiveData.tenantId || '').trim();
    if (!tenantId) {
      throw new functions.https.HttpsError('failed-precondition',
        `Archive doc has no tenantId`);
    }

    // ── Read people doc ───────────────────────────────────────────────────
    const peopleRef = firestore.collection('people').doc(tenantId);
    const peopleSnap = await peopleRef.get();
    if (!peopleSnap.exists) {
      throw new functions.https.HttpsError('not-found',
        `people/${tenantId} does not exist — cannot restore identity from canonical person doc`);
    }
    const personData = peopleSnap.data() || {};
    const linkedAuthUid = String(personData.linkedAuthUid || archiveData.linkedAuthUid || '').trim();
    const lineUserId = String(personData.lineUserId || archiveData.lineID || '').trim();

    // ── Read archive subcollections ───────────────────────────────────────
    const archiveSubDocs = {};
    let totalSubDocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      try {
        const snap = await archiveRef.collection(sub).get();
        archiveSubDocs[sub] = snap.docs;
        totalSubDocs += snap.docs.length;
      } catch (e) {
        console.warn(`revertTransitionToPlayer: read archive ${sub} failed:`, e.message);
        archiveSubDocs[sub] = [];
      }
    }

    // Op count: tenant set + people update + liffUsers set + archive update + subcoll copies
    const totalOps = 4 + totalSubDocs;
    if (totalOps > BATCH_OP_LIMIT) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Archive has ${totalSubDocs} subcoll docs (${totalOps} ops) — exceeds batch limit ${BATCH_OP_LIMIT}`);
    }

    // ── Build restore payload ─────────────────────────────────────────────
    const restoredFields = { ...archiveData };
    for (const field of ARCHIVE_METADATA_FIELDS) {
      delete restoredFields[field];
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const callerEmail = String(context.auth.token.email || '');

    // people doc overrides archive — fresher identity + gamification.
    const personOverrides = {
      name: String(personData.name || archiveData.name || ''),
      firstName: String(personData.firstName || ''),
      lastName: String(personData.lastName || ''),
      phone: String(personData.phone || ''),
      email: String(personData.email || ''),
      lineID: lineUserId,
      linkedAuthUid,
      gamification: personData.gamification || archiveData.gamification || null,
    };

    const liveRestore = {
      ...restoredFields,
      ...personOverrides,
      building,
      roomId,
      tenantId,
      contractId,
      status: admin.firestore.FieldValue.delete(),
      lastArchivedAt: admin.firestore.FieldValue.delete(),
      lastArchivedContractId: admin.firestore.FieldValue.delete(),
      revertedAt: now,
      revertedBy: context.auth.uid,
      revertedByEmail: callerEmail,
      revertedFromContractId: contractId,
      linkedAt: now,
      updatedAt: now,
    };

    // ── Build + commit batch ──────────────────────────────────────────────
    const batch = firestore.batch();

    batch.set(tenantRef, liveRestore, { merge: true });

    let restoredSubdocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      for (const doc of archiveSubDocs[sub]) {
        batch.set(tenantRef.collection(sub).doc(doc.id), doc.data());
        restoredSubdocs++;
      }
    }

    batch.update(peopleRef, {
      currentLease: { building, roomId, contractId },
      revertedAt: now,
      updatedAt: now,
    });

    if (lineUserId) {
      batch.set(firestore.collection('liffUsers').doc(lineUserId), {
        role: admin.firestore.FieldValue.delete(),
        tenantId: admin.firestore.FieldValue.delete(),
        room: roomId,
        building,
        status: 'approved',
        updatedAt: now,
      }, { merge: true });
    }

    batch.update(archiveRef, {
      revertedAt: now,
      revertedBy: context.auth.uid,
      revertedByEmail: callerEmail,
    });

    try {
      await batch.commit();
    } catch (e) {
      console.error('revertTransitionToPlayer: batch commit failed:', e);
      throw new functions.https.HttpsError('internal', e.message || 'Batch commit failed');
    }

    // ── Post-batch: replace player claim with tenant claim ────────────────
    // Fire-and-forget. If this fails, admin can manually re-set via
    // grant-admin-claim tool or by calling this CF again (idempotent —
    // already-reverted check above guards re-entry; admin would need to
    // unset revertedAt on archive first, which is intentional friction).
    if (linkedAuthUid) {
      admin.auth().setCustomUserClaims(linkedAuthUid, { room: roomId, building })
        .then(() => console.log(`revertTransitionToPlayer: claim restored uid=${linkedAuthUid} → ${building}/${roomId}`))
        .catch(e => console.error(`revertTransitionToPlayer: setCustomUserClaims failed uid=${linkedAuthUid}:`, e.message));
    } else {
      console.warn(`revertTransitionToPlayer: no linkedAuthUid for tenant ${tenantId} — claim NOT revoked (manual fix needed)`);
    }

    console.log(`revertTransitionToPlayer: ${building}/${roomId} ← archive/${contractId} (tenantId=${tenantId}, subdocs=${restoredSubdocs}, uid=${linkedAuthUid}, by=${callerEmail || context.auth.uid})`);

    return {
      success: true,
      tenantId,
      contractId,
      building,
      roomId,
      linkedAuthUid,
      restoredSubdocs,
    };
  });
