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

// Tier keys must match functions/remindLeaseExpiry.js TIERS — these are the
// possible doc ids at leaseNotifications/{building}_{roomId}_{tier}. Renewal +
// extension both clear all four (idempotent — Firestore delete on a missing
// doc is a no-op) so the scheduler re-emits fresh tiers from the new endDate.
const LEASE_NOTIF_TIERS = ['60', '30', '14', 'expired'];

// Helper — read a date-ish field off a Firestore doc (could be ISO string,
// Firestore Timestamp, or millis). Returns a Date or null.
function _parseDateField(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate(); // Firestore Timestamp
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

/**
 * Reads pre-conditions for both modes — tenant doc + active lease doc.
 * Returns { tenantRef, tenantData, oldLeaseRef, oldLeaseData, oldEndDate }
 * or throws HttpsError. Pulled out for white-box testing.
 *
 * §7-DD discipline: the lease pointer chain mirrors archiveTenantOnMoveOut
 * exactly so renewals + archives agree on which lease is "active" for a room.
 */
async function _readLeaseState(firestore, building, roomId) {
  const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(roomId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) {
    throw new functions.https.HttpsError('not-found',
      `tenants/${building}/list/${roomId} does not exist`);
  }
  const tenantData = tenantSnap.data() || {};

  // Tenant must have a real identity (mirror archive CF guard at L158-168)
  const tenantId = String(tenantData.tenantId || '').trim();
  if (!tenantId) {
    throw new functions.https.HttpsError('failed-precondition',
      `Room ${building}/${roomId} has no tenantId — vacant rooms cannot be renewed`);
  }

  // Lease pointer chain — same precedence as archiveTenantOnMoveOut L215-217
  const leaseId = (tenantData.lease && tenantData.lease.leaseId)
    || tenantData.activeContractId
    || (tenantData.contractId ? String(tenantData.contractId) : null);
  if (!leaseId) {
    throw new functions.https.HttpsError('failed-precondition',
      `Room ${building}/${roomId} has tenantId but no active lease pointer ` +
      `(lease.leaseId / activeContractId / contractId all empty) — cannot renew`);
  }

  const oldLeaseRef = firestore.collection('leases').doc(building).collection('list').doc(String(leaseId));
  const oldLeaseSnap = await oldLeaseRef.get();
  if (!oldLeaseSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease doc leases/${building}/list/${leaseId} not found — tenant doc points at a non-existent lease`);
  }
  const oldLeaseData = oldLeaseSnap.data() || {};

  // Block double-renewal: lease must currently be 'active'. status='ended' or
  // 'renewed' means a prior op already closed it; refuse to overwrite.
  const status = String(oldLeaseData.status || 'active');
  if (status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease ${leaseId} has status='${status}' — only 'active' leases can be renewed`);
  }

  // moveOutDate is the canonical end-date field on lease docs (see
  // convertBookingToTenant.js:312). Some legacy docs may carry endDate instead;
  // fall back if needed.
  const oldEndDate = _parseDateField(oldLeaseData.moveOutDate) || _parseDateField(oldLeaseData.endDate);
  if (!oldEndDate) {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease ${leaseId} has no parseable moveOutDate/endDate — cannot determine renewal start point`);
  }

  return { tenantRef, tenantData, tenantId, leaseId, oldLeaseRef, oldLeaseData, oldEndDate };
}

/**
 * Runs the renewal-mode batch. Pure helper — caller owns the auth check + input
 * validation. Returns the audit payload to be written separately (RTDB) so a
 * test can assert against it without engaging RTDB.
 */
async function _runRenewalMode(input, callerUid, callerEmail, firestore) {
  const { building, roomId, newEndDate, newRentAmount, newDeposit,
          contractDocument, contractFileName, notes } = input;

  const state = await _readLeaseState(firestore, building, roomId);
  const { tenantRef, tenantData, tenantId, leaseId: oldLeaseId,
          oldLeaseRef, oldLeaseData, oldEndDate } = state;

  // newEndDate must strictly extend the lease. Past the validator's "future"
  // check, this catches the case where admin types a date that's after today
  // but before the existing endDate (i.e. shortening — not a renewal).
  if (newEndDate.getTime() <= oldEndDate.getTime()) {
    throw new functions.https.HttpsError('invalid-argument',
      `newEndDate (${newEndDate.toISOString()}) must be after current endDate (${oldEndDate.toISOString()})`);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const newLeaseId = `CONTRACT_${Date.now()}_${roomId}`;
  const newLeaseRef = firestore.collection('leases').doc(building).collection('list').doc(newLeaseId);

  // Resolved values for the new lease — explicit overrides win, else inherit
  const resolvedRent = (newRentAmount !== undefined) ? newRentAmount : Number(oldLeaseData.rentAmount) || 0;
  const resolvedDeposit = (newDeposit !== undefined) ? newDeposit : Number(oldLeaseData.deposit) || 0;
  const resolvedDocPath = contractDocument || String(oldLeaseData.contractDocument || '');
  const resolvedDocName = contractFileName || String(oldLeaseData.contractFileName || '');

  // contractMonths derived from start-to-end span (rounded). Admin may want a
  // different value but the common case is "matches actual span" — easier
  // to derive than to require admin input.
  const monthsBetween = Math.max(1, Math.round(
    (newEndDate.getTime() - oldEndDate.getTime()) / (30 * 86400 * 1000)
  ));

  const startIso = oldEndDate.toISOString();
  const endIso = newEndDate.toISOString();

  // ── Build single Firestore batch ──────────────────────────────────────────
  const batch = firestore.batch();

  // 1. Old lease → status='renewed' + back-pointer to the new doc
  batch.update(oldLeaseRef, {
    status: 'renewed',
    renewedAt: now,
    renewedToLeaseId: newLeaseId,
    renewedBy: callerUid,
    renewedByEmail: callerEmail,
    updatedAt: now,
  });

  // 2. New lease — clone of old + new dates + (optional) rent/deposit overrides
  const newLeaseData = {
    id: newLeaseId,
    building,
    roomId,
    tenantId,
    tenantName: String(oldLeaseData.tenantName || tenantData.name || ''),
    moveInDate: startIso,
    moveOutDate: endIso,
    contractStart: startIso,
    contractMonths: monthsBetween,
    rentAmount: resolvedRent,
    deposit: resolvedDeposit,
    depositPaid: !!oldLeaseData.depositPaid,
    depositPaidAt: oldLeaseData.depositPaidAt || null,
    depositSlipRef: String(oldLeaseData.depositSlipRef || ''),
    status: 'active',
    contractFileName: resolvedDocName,
    contractDocument: resolvedDocPath,
    priorLeaseId: oldLeaseId,
    renewedFromLeaseId: oldLeaseId,
    renewalNotes: notes,
    sourceBookingId: String(oldLeaseData.sourceBookingId || ''),
    createdDate: now,
    updatedAt: now,
  };
  batch.set(newLeaseRef, newLeaseData, { merge: false });

  // 3. Tenant doc — point at new lease + mirror endDate + (optional) rent
  const tenantPatch = {
    contractEnd: endIso,
    contractStart: startIso,
    contractMonths: monthsBetween,
    activeContractId: newLeaseId,
    contractId: newLeaseId,
    lease: {
      leaseId: newLeaseId,
      status: 'active',
      startDate: startIso,
      endDate: endIso,
    },
    updatedAt: now,
  };
  if (newRentAmount !== undefined) tenantPatch.rentAmount = resolvedRent;
  if (newDeposit !== undefined) tenantPatch.deposit = resolvedDeposit;
  if (resolvedDocPath) tenantPatch.contractDocument = resolvedDocPath;
  if (resolvedDocName) tenantPatch.contractFileName = resolvedDocName;
  batch.update(tenantRef, tenantPatch);

  // 4. Clear stale leaseNotifications tier docs — idempotent (delete on
  //    missing doc is a no-op) so we don't need to pre-read existence.
  for (const tier of LEASE_NOTIF_TIERS) {
    const notifRef = firestore.collection('leaseNotifications').doc(`${building}_${roomId}_${tier}`);
    batch.delete(notifRef);
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error('renewLease[renewal]: batch commit failed:', e);
    throw new functions.https.HttpsError('internal',
      e.message || 'Renewal batch commit failed');
  }

  // ── Audit payload (caller writes to RTDB best-effort outside the batch) ──
  const auditPayload = {
    action: 'lease_renewed',
    mode: 'renewal',
    building, room: roomId,
    tenantId,
    oldLeaseId,
    newLeaseId,
    oldEndDate: oldEndDate.toISOString(),
    newEndDate: endIso,
    oldRent: Number(oldLeaseData.rentAmount) || 0,
    newRent: resolvedRent,
    rentChanged: (newRentAmount !== undefined) && (resolvedRent !== (Number(oldLeaseData.rentAmount) || 0)),
    depositChanged: (newDeposit !== undefined) && (resolvedDeposit !== (Number(oldLeaseData.deposit) || 0)),
    documentReplaced: !!contractDocument,
    notes: notes || '',
    actor: callerEmail || callerUid,
    actorUid: callerUid,
  };

  console.log(`renewLease[renewal]: ${building}/${roomId} ${oldLeaseId} → ${newLeaseId} ` +
    `(rent ${auditPayload.oldRent}→${resolvedRent}, by=${auditPayload.actor})`);

  return {
    success: true,
    mode: 'renewal',
    building, roomId,
    oldLeaseId, newLeaseId,
    oldEndDate: oldEndDate.toISOString(),
    newEndDate: endIso,
    auditPayload,
  };
}

/**
 * Runs the extension-mode batch. Variation — single lease doc; endDate
 * updated in place, extensions[] appended via arrayUnion. No new lease doc,
 * no rent change (use renewal mode for that).
 *
 * Legacy graceful handling: if the lease doc has no extensions[] field at
 * all (older docs pre-date this feature), arrayUnion just initialises it.
 * Existing-but-wrong-shape (e.g. extensions={} object) is treated as fresh
 * — we replace with an array containing only the new entry. This rare-but-
 * recoverable case is logged.
 */
async function _runExtensionMode(input, callerUid, callerEmail, firestore) {
  const { building, roomId, newEndDate, notes, newRentAmount, newDeposit } = input;

  // Extension mode never changes rent/deposit — those go via renewal. Reject
  // up front so admin doesn't think the change took effect silently.
  if (newRentAmount !== undefined) {
    throw new functions.https.HttpsError('invalid-argument',
      `newRentAmount not allowed in extension mode — use mode='renewal' for rent changes`);
  }
  if (newDeposit !== undefined) {
    throw new functions.https.HttpsError('invalid-argument',
      `newDeposit not allowed in extension mode — use mode='renewal' for deposit changes`);
  }

  const state = await _readLeaseState(firestore, building, roomId);
  const { tenantRef, tenantId, leaseId, oldLeaseRef, oldLeaseData, oldEndDate } = state;

  if (newEndDate.getTime() <= oldEndDate.getTime()) {
    throw new functions.https.HttpsError('invalid-argument',
      `newEndDate (${newEndDate.toISOString()}) must be after current endDate (${oldEndDate.toISOString()})`);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const startIso = oldEndDate.toISOString();
  const endIso = newEndDate.toISOString();

  // Build the extension entry. Note: `at` is wall-clock here (not serverTs)
  // because arrayUnion + serverTimestamp() sentinel don't play together —
  // serverTimestamp() inside arrayUnion silently becomes null on commit.
  // The lease.updatedAt field still uses serverTimestamp(); the per-entry
  // timestamp here trades server-trust for usability.
  const extensionEntry = {
    at: new Date().toISOString(),
    fromEndDate: startIso,
    toEndDate: endIso,
    by: callerUid,
    byEmail: callerEmail,
    notes: notes || '',
  };

  // Detect wrong-shape extensions field (defensive). Treat anything other
  // than an array as "no extensions yet" and reset.
  const existingExtensions = oldLeaseData.extensions;
  const extensionsIsArray = Array.isArray(existingExtensions);
  if (existingExtensions !== undefined && !extensionsIsArray) {
    console.warn(`renewLease[extension]: lease ${leaseId} has non-array extensions field ` +
      `(${typeof existingExtensions}) — resetting to fresh array`);
  }

  // ── Build single Firestore batch ──────────────────────────────────────────
  const batch = firestore.batch();

  // 1. Lease doc — update endDate + append extension entry
  const leasePatch = {
    moveOutDate: endIso,
    updatedAt: now,
    lastExtendedAt: now,
    lastExtendedBy: callerUid,
  };
  if (extensionsIsArray || existingExtensions === undefined) {
    leasePatch.extensions = admin.firestore.FieldValue.arrayUnion(extensionEntry);
  } else {
    // wrong-shape recovery — overwrite with fresh single-entry array
    leasePatch.extensions = [extensionEntry];
  }
  batch.update(oldLeaseRef, leasePatch);

  // 2. Tenant doc — mirror endDate. Lease pointer stays the same.
  batch.update(tenantRef, {
    contractEnd: endIso,
    lease: {
      leaseId,
      status: 'active',
      startDate: String(oldLeaseData.contractStart || oldLeaseData.moveInDate || ''),
      endDate: endIso,
    },
    updatedAt: now,
  });

  // 3. Clear stale notification tiers — same idempotent delete as renewal
  for (const tier of LEASE_NOTIF_TIERS) {
    const notifRef = firestore.collection('leaseNotifications').doc(`${building}_${roomId}_${tier}`);
    batch.delete(notifRef);
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error('renewLease[extension]: batch commit failed:', e);
    throw new functions.https.HttpsError('internal',
      e.message || 'Extension batch commit failed');
  }

  const auditPayload = {
    action: 'lease_extended',
    mode: 'extension',
    building, room: roomId,
    tenantId,
    leaseId,
    fromEndDate: startIso,
    toEndDate: endIso,
    extensionEntryAt: extensionEntry.at,
    extensionCountAfter: extensionsIsArray ? existingExtensions.length + 1 : 1,
    notes: notes || '',
    actor: callerEmail || callerUid,
    actorUid: callerUid,
  };

  console.log(`renewLease[extension]: ${building}/${roomId} ${leaseId} ${startIso} → ${endIso} ` +
    `(entry #${auditPayload.extensionCountAfter}, by=${auditPayload.actor})`);

  return {
    success: true,
    mode: 'extension',
    building, roomId,
    leaseId,
    fromEndDate: startIso,
    toEndDate: endIso,
    extensionCountAfter: auditPayload.extensionCountAfter,
    auditPayload,
  };
}

/**
 * Best-effort RTDB audit write. Logs + swallows on failure — Firestore batch
 * is the source of truth; audit is observability only.
 */
async function _writeAuditLog(payload) {
  try {
    if (!admin.database) return; // shouldn't happen, but be defensive
    const ref = admin.database().ref('audit_logs/leases').push();
    await ref.set({
      ...payload,
      at: admin.database.ServerValue.TIMESTAMP,
    });
  } catch (e) {
    console.warn('renewLease: audit log write failed (non-fatal):', e && e.message ? e.message : e);
  }
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
    const callerUid = context.auth.uid;
    const callerEmail = String(context.auth.token.email || '');

    const firestore = admin.firestore();

    const runner = input.mode === 'renewal' ? _runRenewalMode : _runExtensionMode;
    const result = await runner(input, callerUid, callerEmail, firestore);
    // Fire-and-await is fine — audit write is fast (single push). If we
    // really want to never block on it we can drop the await; for now the
    // ~20ms latency cost is worth the test reproducibility.
    await _writeAuditLog(result.auditPayload);
    const { auditPayload, ...callerResult } = result;
    return callerResult;
  });

// Export internals for unit testing.
exports._validateInput = _validateInput;
exports._readLeaseState = _readLeaseState;
exports._runRenewalMode = _runRenewalMode;
exports._runExtensionMode = _runExtensionMode;
exports._writeAuditLog = _writeAuditLog;
exports._VALID_MODES = VALID_MODES;
exports._ROOM_ID_RE = ROOM_ID_RE;
exports._LEASE_NOTIF_TIERS = LEASE_NOTIF_TIERS;
