/**
 * renewLease — admin-only callable that ends or extends an active lease.
 *
 * Two modes:
 *   - 'renewal' (novation; DEFAULT) — old lease set to status='renewed';
 *     a brand-new lease doc is created at leases/{b}/list/{newLeaseId};
 *     tenant doc's lease subobject + contractEnd updated to point at the new
 *     lease. Rent/deposit may change. Audit chain preserved via priorLeaseId.
 *   - 'extension' (variation) — single lease doc; endDate updated in place,
 *     extensions[] appended via arrayUnion. Old leaseId stays as the active
 *     lease. Rent NEVER changes in extension mode (use renewal instead).
 *
 * Both modes clear stale leaseNotifications/{b}_{r}_* tier docs so
 * remindLeaseExpiryScheduled re-emits fresh tiers from the new endDate.
 * Neither mode touches people/, liffUsers/, or Auth custom claims (room +
 * building + tenantId all stay stable).
 *
 * Mirrors archiveTenantOnMoveOut.js — single batched Firestore write so
 * partial renewals are impossible. leaseId resolution chain matches archive
 * (tenants.lease.leaseId || activeContractId || contractId).
 *
 * Region: asia-southeast1
 * Auth:   caller MUST have admin custom claim
 * Input:  { building, roomId, newEndDate, mode?, newRentAmount?, newDeposit?,
 *           contractDocument?, contractFileName?, notes? }
 * Output: { success, mode, building, roomId, oldLeaseId, newLeaseId?, oldEndDate, newEndDate }
 *
 * State write contracts: see tasks/todo.md ## State write matrix per mode.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const { getValidBuildings } = require('./buildingRegistry');

const VALID_MODES = new Set(['renewal', 'extension']);
const ROOM_ID_RE = /^[A-Za-z0-9ก-๛]{1,20}$/;

/**
 * Parses + validates input. Returns a normalised payload OR throws
 * functions.https.HttpsError. Split out so unit tests can exercise the
 * validation surface without engaging any Firestore writes.
 *
 * Today (post-S1) the main onCall entry calls this + then throws 'unimplemented'.
 * S2 fills in the renewal-mode branch; S3 fills in extension mode.
 */
async function _validateInput(data) {
  const {
    building,
    roomId,
    newEndDate,
    mode,
    newRentAmount,
    newDeposit,
    contractDocument,
    contractFileName,
    notes,
  } = data || {};

  // ── Building (delegated to registry for canonical aliases) ────────────────
  const validBuildings = await getValidBuildings();
  if (!validBuildings.has(building)) {
    throw new functions.https.HttpsError('invalid-argument',
      `building must be one of [${Array.from(validBuildings).join(', ')}] (got '${building}')`);
  }

  // ── Room ID ──────────────────────────────────────────────────────────────
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) {
    throw new functions.https.HttpsError('invalid-argument',
      `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
  }

  // ── Mode (defaults to 'renewal' per lifecycle_tenant_transitions.md §C) ──
  const normalisedMode = String(mode || 'renewal');
  if (!VALID_MODES.has(normalisedMode)) {
    throw new functions.https.HttpsError('invalid-argument',
      `mode must be one of: ${[...VALID_MODES].join(', ')} (got '${mode}')`);
  }

  // ── newEndDate (accept ISO string or Date-like) ──────────────────────────
  if (newEndDate === undefined || newEndDate === null || newEndDate === '') {
    throw new functions.https.HttpsError('invalid-argument',
      'newEndDate is required (ISO string or Date)');
  }
  const parsedEndDate = new Date(newEndDate);
  if (Number.isNaN(parsedEndDate.getTime())) {
    throw new functions.https.HttpsError('invalid-argument',
      `newEndDate is not a valid date (got '${newEndDate}')`);
  }
  // Strictly future. A "renew to today" or "renew to a past date" is always wrong.
  const now = Date.now();
  if (parsedEndDate.getTime() <= now) {
    throw new functions.https.HttpsError('invalid-argument',
      `newEndDate must be in the future (got '${parsedEndDate.toISOString()}', now '${new Date(now).toISOString()}')`);
  }

  // ── Optional numerics — present + positive if provided ───────────────────
  let normalisedRent;
  if (newRentAmount !== undefined && newRentAmount !== null) {
    const n = Number(newRentAmount);
    if (!Number.isFinite(n) || n <= 0) {
      throw new functions.https.HttpsError('invalid-argument',
        `newRentAmount must be a positive number (got '${newRentAmount}')`);
    }
    normalisedRent = n;
  }
  let normalisedDeposit;
  if (newDeposit !== undefined && newDeposit !== null) {
    const n = Number(newDeposit);
    if (!Number.isFinite(n) || n < 0) {
      throw new functions.https.HttpsError('invalid-argument',
        `newDeposit must be >= 0 (got '${newDeposit}')`);
    }
    normalisedDeposit = n;
  }

  // ── Optional strings — type-check only ───────────────────────────────────
  if (contractDocument !== undefined && typeof contractDocument !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'contractDocument must be a string (Storage path or download URL)');
  }
  if (contractFileName !== undefined && typeof contractFileName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'contractFileName must be a string');
  }
  if (notes !== undefined && typeof notes !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'notes must be a string');
  }

  return {
    building,
    roomId,
    mode: normalisedMode,
    newEndDate: parsedEndDate,
    newRentAmount: normalisedRent,
    newDeposit: normalisedDeposit,
    contractDocument: contractDocument || '',
    contractFileName: contractFileName || '',
    notes: notes || '',
  };
}

exports.renewLease = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth ────────────────────────────────────────────────────────────────
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied',
        'Admin claim required to renew a lease');
    }

    // ── Input validation ────────────────────────────────────────────────────
    const input = await _validateInput(data);

    // S1 STUB — state-write branches land in S2 (renewal) and S3 (extension).
    // Tests assert that validation passed by catching this specific code.
    throw new functions.https.HttpsError('unimplemented',
      `renewLease ${input.mode} mode is not yet implemented (S2/S3 pending)`);
  });

// Export internals for unit testing.
exports._validateInput = _validateInput;
exports._VALID_MODES = VALID_MODES;
exports._ROOM_ID_RE = ROOM_ID_RE;
