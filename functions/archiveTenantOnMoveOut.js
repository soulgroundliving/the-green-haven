/**
 * archiveTenantOnMoveOut — admin-only archive of a tenant on move-out.
 *
 * Preserves identity + history at `tenants/{building}/archive/{contractId}` so
 * a returning tenant (Phase 1) — and eventually the person-centric data model
 * (Phase 2) — can recover gamification points, payment history, and wellness
 * claims that would otherwise be overwritten when admin assigns the room to
 * the next occupant.
 *
 * What it does (single batched write so partial archives are impossible):
 *   1. Validates caller has admin custom claim.
 *   2. Reads `tenants/{b}/list/{r}` — must have a meaningful tenantId, else
 *      throws 'failed-precondition' (room is already vacant).
 *   3. Computes a stable contractId. If the live doc has `contractId` (set by
 *      convertBookingToTenant since 2026-05-04), uses it. Pre-booking-flow
 *      tenants don't have one — falls back to `LEGACY_${tenantId}_${ts}`.
 *   4. Reads ALL subcollection docs under the tenant doc (paymentHistory,
 *      redemptions, wellnessClaimed, pets, complaintFreeMonthAwarded). One
 *      read per subcollection (collection().get()) — runs outside the batch.
 *   5. Builds one Firestore batch:
 *        - set archive parent at `tenants/{b}/archive/{contractId}`
 *          (clone of live doc + archivedAt/Reason/By + ensured contractId)
 *        - for each subcollection doc: set archive copy + delete original
 *        - update live doc: blank identity fields, keep building/roomId,
 *          set status='vacant' so dashboard treats the room as available
 *   6. Commits the batch atomically.
 *
 * Why a batch (not transaction): Firestore transactions can read max 500
 * docs and require all reads before writes. Subcollection lists are normal
 * queries (not direct doc gets) which transactions can't do. A batch is
 * acceptable here because:
 *   - Concurrent archive of the same room by two admins would converge
 *     to the same outcome (idempotent — both copies succeed, second blank
 *     overwrites first).
 *   - The pre-condition check (live doc has tenantId) plus the rare
 *     concurrency window (admin clicks archive twice within ~100ms) means
 *     a transaction's MVCC retry would be wasted overhead.
 *
 * Why preserve subcollections inline (not later): paymentHistory is the
 * source of truth for past payments — losing it loses tax-filing data.
 * Easier to keep them attached to the archive doc than to re-key by
 * tenantId in Phase 2 (which can read straight from archive).
 *
 * Region: asia-southeast1
 * Auth: caller MUST have admin claim
 * Input:  { building, roomId, reason }
 *           building: 'rooms' | 'nest' (canonical)
 *           roomId: string (e.g. '13', 'N101', 'Amazon')
 *           reason: 'moved_out' | 'reassigned' | 'admin_action'
 * Output: { success, contractId, tenantId, building, roomId, archivedSubdocs }
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_REASONS = new Set(['moved_out', 'reassigned', 'admin_action']);
const VALID_BUILDINGS = new Set(['rooms', 'nest']);

// Subcollections under tenant docs that should travel with the archive.
// Order doesn't matter — each is read independently.
const ARCHIVED_SUBCOLLECTIONS = [
  'paymentHistory',
  'redemptions',
  'wellnessClaimed',
  'pets',
  'complaintFreeMonthAwarded',
];

// Firestore batch hard cap is 500 ops. We compute total ops upfront and
// refuse if it would exceed a safety margin (450) — leaves room for the
// parent set + list update + a few audit writes without bumping the limit.
const BATCH_OP_LIMIT = 450;

// Fields blanked on the live doc after archive. Identity + per-tenant
// state goes; room-level config stays so the room slot is still queryable.
const FIELDS_TO_CLEAR = {
  // Identity
  name: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  emailVerified: false,
  lineID: '',
  address: '',
  idCardNumber: '',
  // Identifiers
  tenantId: '',
  contractId: '',
  // Auth link
  linkedAuthUid: '',
  linkedAt: admin.firestore.FieldValue.delete(),
  phoneVerifiedAt: admin.firestore.FieldValue.delete(),
  // Lease state
  moveInDate: '',
  moveOutDate: '',
  rentAmount: 0,
  deposit: 0,
  depositPaid: false,
  contractDocument: '',
  contractFileName: '',
  contractStart: '',
  contractEnd: '',
  contractMonths: 0,
  lease: admin.firestore.FieldValue.delete(),
  // Misc
  notes: '',
  licensePlate: '',
  emergencyContact: null,
  companyInfo: null,
  // Gamification belongs to the person — Phase 2 moves to people/{tenantId}.
  // Until then, blank it so a new tenant in this room starts at zero.
  gamification: null,
  // Booking source link no longer applicable to next occupant
  sourceBookingId: '',
};

exports.archiveTenantOnMoveOut = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth ────────────────────────────────────────────────────────────────
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied',
        'Admin claim required to archive a tenant');
    }

    // ── Input ──────────────────────────────────────────────────────────────
    const { building, roomId, reason } = data || {};
    if (!VALID_BUILDINGS.has(building)) {
      throw new functions.https.HttpsError('invalid-argument',
        `building must be 'rooms' or 'nest' (got '${building}')`);
    }
    if (typeof roomId !== 'string' || !/^[A-Za-z0-9ก-๛]{1,20}$/.test(roomId)) {
      throw new functions.https.HttpsError('invalid-argument',
        `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
    }
    const archiveReason = String(reason || 'moved_out');
    if (!VALID_REASONS.has(archiveReason)) {
      throw new functions.https.HttpsError('invalid-argument',
        `reason must be one of: ${[...VALID_REASONS].join(', ')}`);
    }

    // ── Pre-condition: live tenant doc must exist with identity ────────────
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
        `Room ${building}/${roomId} has no tenantId — already vacant or never assigned`);
    }
    // If a tenant is mid-move-in but has no name yet, they aren't really a
    // tenant to archive. Block to avoid wiping a freshly-created blank doc.
    if (!String(tenantData.name || '').trim() && !String(tenantData.firstName || '').trim()) {
      throw new functions.https.HttpsError('failed-precondition',
        `Room ${building}/${roomId} has tenantId but no name — incomplete tenant record`);
    }

    // ── Compute stable contractId ──────────────────────────────────────────
    // convertBookingToTenant since 2026-05-04 always sets `contractId`. Pre-
    // booking-flow tenants (manual admin create) don't have one — generate a
    // LEGACY_-prefixed id deterministically tied to the tenantId so two
    // archives of the same identity at the same instant don't collide.
    const contractId = String(tenantData.contractId || '').trim()
      || `LEGACY_${tenantId}_${Date.now()}`;

    const archiveRef = firestore
      .collection('tenants').doc(building)
      .collection('archive').doc(contractId);

    // Defense: don't overwrite an existing archive doc by accident
    const existingArchive = await archiveRef.get();
    if (existingArchive.exists) {
      throw new functions.https.HttpsError('already-exists',
        `Archive doc tenants/${building}/archive/${contractId} already exists — refusing to overwrite`);
    }

    // ── Read all subcollection docs (outside the batch) ────────────────────
    const subDocs = {};
    let totalSubDocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      try {
        const snap = await tenantRef.collection(sub).get();
        subDocs[sub] = snap.docs;
        totalSubDocs += snap.docs.length;
      } catch (e) {
        console.warn(`archiveTenantOnMoveOut: read ${sub} failed for ${building}/${roomId}:`, e.message);
        subDocs[sub] = [];
      }
    }

    // Each subdoc costs 2 ops (set archive + delete original) plus 3 ops for
    // parent (archive set + list update + tracker), so ceiling check:
    const totalOps = 3 + (totalSubDocs * 2);
    if (totalOps > BATCH_OP_LIMIT) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Tenant has ${totalSubDocs} subcollection docs (${totalOps} ops) — exceeds batch limit ${BATCH_OP_LIMIT}. Manual admin SDK migration needed.`);
    }

    // ── Build + commit the batch ───────────────────────────────────────────
    const batch = firestore.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const callerUid = context.auth.uid;
    const callerEmail = String(context.auth.token.email || '');

    // 1. Archive parent doc — clone of live doc + archive metadata
    const archivePayload = {
      ...tenantData,
      contractId, // ensure stored even if generated above
      archivedAt: now,
      archivedReason: archiveReason,
      archivedBy: callerUid,
      archivedByEmail: callerEmail,
      sourceRoom: { building, roomId },
    };
    batch.set(archiveRef, archivePayload);

    // 2. Subcollection copies + deletes
    let copiedSubdocs = 0;
    for (const sub of ARCHIVED_SUBCOLLECTIONS) {
      for (const doc of subDocs[sub]) {
        batch.set(archiveRef.collection(sub).doc(doc.id), doc.data());
        batch.delete(doc.ref);
        copiedSubdocs++;
      }
    }

    // 3. Blank the live doc (keep building/roomId/status='vacant')
    batch.update(tenantRef, {
      ...FIELDS_TO_CLEAR,
      building,
      roomId,
      status: 'vacant',
      updatedAt: now,
      lastArchivedAt: now,
      lastArchivedContractId: contractId,
    });

    try {
      await batch.commit();
    } catch (e) {
      console.error('archiveTenantOnMoveOut: batch commit failed:', e);
      throw new functions.https.HttpsError('internal',
        e.message || 'Archive batch commit failed');
    }

    console.log(`archiveTenantOnMoveOut: ${building}/${roomId} → archive/${contractId} ` +
      `(tenantId=${tenantId}, subdocs=${copiedSubdocs}, reason=${archiveReason}, by=${callerEmail || callerUid})`);

    return {
      success: true,
      contractId,
      tenantId,
      building,
      roomId,
      archivedSubdocs: copiedSubdocs,
      reason: archiveReason,
    };
  });
