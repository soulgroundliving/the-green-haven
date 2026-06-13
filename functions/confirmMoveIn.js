/**
 * confirmMoveIn — admin-only: activate a pre-move-in (reserved) deposit when the
 * tenant ACTUALLY moves in. Flips deposits/{b}_{r} reserved → holding, stamps the
 * real occupancy date, and mirrors moveInDate onto the existing lease + tenant doc.
 *
 * Does NOT create the tenant/lease — that's convertBookingToTenant (or the admin
 * tenant-add UI). confirmMoveIn ASSUMES the tenant doc + active lease already exist
 * and only bridges the deposit Phase 1 (reserved) → Phase 2 (holding) gap. The
 * `reserved` status is the idempotency guard: a second call rejects (already holding).
 *
 * One Firestore transaction so the deposit flip + date stamps + audit are atomic
 * (§7-DD — a lifecycle transition must update every sibling a reader falls through to).
 *
 * §7-BBB: BOTH the lease doc AND the tenant doc's `.lease` subobject must carry
 * `moveInDate` = OCCUPANCY (not a future renewal `contractStart`) — BillStore
 * .tenantBoundaryYM reads `lease.moveInDate` FIRST to gate meter/bill months.
 *
 * Region: asia-southeast1
 * Auth:   caller MUST have admin claim (no fallback)
 * Input:  { building, roomId, moveInDate }   // moveInDate = real occupancy date (YYYY-MM-DD)
 * Output: { success, building, roomId, tenantId, moveInDate, depositStatus:'holding' }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const { appendLog } = require('./_occupancyLog');

exports.confirmMoveIn = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin claim required to confirm move-in');
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  const { building, roomId, moveInDate } = data || {};
  if (!building || typeof building !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'building is required');
  }
  if (!roomId || typeof roomId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'roomId is required');
  }
  const moveIn = String(moveInDate == null ? '' : moveInDate).trim();
  if (!moveIn || isNaN(new Date(moveIn).getTime())) {
    throw new functions.https.HttpsError('invalid-argument', 'moveInDate (a valid date) is required');
  }

  const depRef    = firestore.collection('deposits').doc(`${building}_${roomId}`);
  const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(roomId);

  const result = await firestore.runTransaction(async (tx) => {
    // ── Reads (ALL before writes — Firestore tx constraint) ──────────────────
    const depSnap = await tx.get(depRef);
    if (!depSnap.exists) {
      throw new functions.https.HttpsError('not-found', `No deposit recorded for ${building}/${roomId}`);
    }
    const dep = depSnap.data() || {};
    if (dep.status !== 'reserved') {
      throw new functions.https.HttpsError('failed-precondition',
        `Deposit is '${dep.status || 'holding'}', not 'reserved' — only a reserved deposit can be confirmed`);
    }

    const tenantSnap = await tx.get(tenantRef);
    if (!tenantSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition',
        `No tenant in ${building}/${roomId} yet — create the tenant before confirming move-in`);
    }
    const tenant = tenantSnap.data() || {};
    const tenantId = String(tenant.tenantId || '').trim();
    const contractId = String(
      tenant.activeContractId || tenant.contractId || (tenant.lease && tenant.lease.leaseId) || ''
    ).trim();
    if (!tenantId) {
      throw new functions.https.HttpsError('failed-precondition', 'Tenant has no tenantId — cannot confirm move-in');
    }
    if (!contractId) {
      throw new functions.https.HttpsError('failed-precondition', 'Tenant has no active lease (contractId)');
    }

    const leaseRef = firestore.collection('leases').doc(building).collection('list').doc(contractId);
    const leaseSnap = await tx.get(leaseRef);
    const lease = leaseSnap.exists ? (leaseSnap.data() || {}) : {};
    const tenantName = String(lease.tenantName || tenant.tenantName || tenantId);

    // ── Writes ───────────────────────────────────────────────────────────────
    // 1. Deposit: reserved → holding, stamp the real occupancy date + owning tenant
    //    (matches the seed's freshHolding shape so the move-out flow reads it).
    tx.set(depRef, {
      status: 'holding',
      tenantId,
      receivedAt: moveIn,
      expectedMoveInDate: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. Lease doc: stamp the occupancy date (§7-BBB).
    if (leaseSnap.exists) {
      tx.set(leaseRef, {
        moveInDate: moveIn,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // 3. Tenant doc lease mirror — BillStore.tenantBoundaryYM reads lease.moveInDate
    //    FIRST (§7-BBB), so the meter/bill boundary must be the real move-in, never a
    //    future contractStart. merge:true deep-merges the lease map (keeps status/dates).
    tx.set(tenantRef, {
      lease: { moveInDate: moveIn },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 4. Append-only occupancy audit (move-in).
    appendLog(tx, firestore, {
      tenantId,
      tenantName,
      personId: tenantId,
      building,
      roomId,
      action: 'moved_in',
      reason: 'confirmed_reserved_deposit',
      leaseId: contractId,
      by: context.auth.uid,
      byEmail: String(context.auth.token.email || '') || null,
      source: 'confirmMoveIn',
      discriminator: moveIn,
    });

    return { tenantId, contractId };
  });

  return {
    success: true,
    building,
    roomId,
    tenantId: result.tenantId,
    moveInDate: moveIn,
    depositStatus: 'holding',
  };
});
