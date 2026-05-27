/**
 * transferTenant — admin-only callable that moves an active tenant to a
 * different room (same building or different building).
 *
 * Two legal modes:
 *
 *   - 'variation' (DEFAULT, การแก้ไขสัญญา) — same lease doc, identity moved
 *     between rooms, amendments[] arrayUnion entry recording the change. The
 *     lease's startDate / endDate / tenure clock stay intact. This matches
 *     Thai property practice for mutual room-change requests (เปลี่ยนห้องระหว่างสัญญา)
 *     where landlord + tenant agree to amend rather than re-sign.
 *
 *   - 'novation' (การเปลี่ยนสัญญา) — OLD lease set to status='transferred' +
 *     transferredToLeaseId pointer; NEW lease created at the new room with
 *     priorLeaseId chain. Use when terms are substantially new (different
 *     building, new deposit terms, new clauses) and a fresh paper trail
 *     is genuinely warranted.
 *
 * Both modes:
 *   - Move tenant identity from tenants/{oldBuilding}/list/{oldRoomId} to
 *     tenants/{newBuilding}/list/{newRoomId} (single atomic batch)
 *   - Update people/{tenantId}.currentBuilding + currentRoom
 *   - Update liffUsers/{lineUserId}.building + room (if a LINE link exists)
 *   - Re-mint Firebase Auth custom claims with new {room, building, tenantId}
 *     + revokeRefreshTokens for the linkedAuthUid (and any legacy anon UID)
 *     per §7-FF — without this the cached LIFF ID token keeps pointing at
 *     the old room for up to ~1 h.
 *   - Write RTDB audit entry at audit_logs/leases/{push} with action
 *     'tenant_transferred' + mode + from-room + to-room.
 *
 * What this CF does NOT do (out of scope this sprint):
 *   - Does NOT move historical bills, paymentHistory, redemptions,
 *     maintenance tickets, complaints, checklists. Those stay attached
 *     to the old room (room-keyed per current data model). Admin can
 *     manually re-issue checklists at the new room if needed.
 *   - Does NOT prorate bills. transferDeposit / prorateBills flags accepted
 *     but only recorded in the audit log — actual deposit ledger + meter
 *     pro-rate is a follow-up sprint.
 *   - DOES carry gamification (points/dailyStreak/lastDailyClaim/badges) to
 *     the new room — IDENTITY_FIELDS below includes 'gamification' so the
 *     tenant doesn't lose accumulated state when changing rooms. Old room
 *     is reset to gamification:null in the same batch (next occupant starts
 *     fresh). people/{tenantId}.gamification is NOT updated by this CF —
 *     that mirror is only relevant after transitionToPlayer, and a returning
 *     player is handled by convertBookingToTenant Pass 5, not transferTenant.
 *
 * Mirrors archiveTenantOnMoveOut + renewLease + unlinkLiffUser patterns:
 *   - §7-DD: single batched Firestore write so partial transfers impossible
 *   - §7-FF: 3-leg claim refresh (setCustomUserClaims + revokeRefreshTokens
 *            server-side + client force-refresh handled by tenant_app's
 *            existing _callLiffSignIn fast-path)
 *   - LeaseId resolution chain matches archive (tenants.lease.leaseId ||
 *     activeContractId || contractId)
 *
 * Region: asia-southeast1
 * Auth:   caller MUST have admin custom claim
 * Input:  {
 *   building,         // CURRENT building (canonical 'rooms' | 'nest' | ...)
 *   oldRoomId,        // CURRENT room
 *   newBuilding,      // TARGET building (may equal `building`)
 *   newRoomId,        // TARGET room (must currently be vacant)
 *   mode?,            // 'variation' (default) | 'novation'
 *   effectiveDate?,   // ISO string — when transfer takes effect (default: now)
 *   transferDeposit?, // boolean (default true) — deposit stays with tenant
 *   prorateBills?,    // boolean (default false) — admin handles meter manually
 *   newRentAmount?,   // number — novation mode only (variation must not change rent)
 *   newDeposit?,      // number — novation mode only
 *   contractDocument?,// string — Storage path / URL (novation typically requires)
 *   contractFileName?,// string — file display name
 *   notes?,           // string — admin's freeform note
 * }
 * Output: {
 *   success, mode, building, oldRoomId, newBuilding, newRoomId,
 *   tenantId, oldLeaseId, newLeaseId?,   // newLeaseId only in novation mode
 *   effectiveDate, transferDeposit, prorateBills,
 *   claimsRefreshed,  // count of UIDs that had claims re-minted
 * }
 *
 * State write matrix per mode (§7-DD audit):
 *
 *   variation:
 *     tenants/{oldB}/list/{oldR}    →  clear identity (like archive, keep
 *                                       building/roomId/status='vacant')
 *     tenants/{newB}/list/{newR}    →  set identity carried from oldR +
 *                                       new lease subobject (same leaseId)
 *     leases/{oldB}/list/{leaseId}  →  arrayUnion amendments[{at, effectiveDate,
 *                                       type:'room_transfer', fromBuilding/Room,
 *                                       toBuilding/Room, transferDeposit,
 *                                       prorateBills, by, byEmail, notes}] +
 *                                       roomId=newRoomId + building=newBuilding +
 *                                       updatedAt + lastAmendedAt + lastAmendedBy
 *                                       (cross-building variation: doc MOVED —
 *                                       set new path + delete old in same batch)
 *     people/{tenantId}             →  currentBuilding=newB + currentRoom=newR +
 *                                       activeBuilding/Room + updatedAt
 *     tenants/{oldB}/list/{oldR}/occupancyLog/{key} →  action='transferred_out'
 *     tenants/{newB}/list/{newR}/occupancyLog/{key} →  action='transferred_in'
 *                                       (paired; discriminator = amendment.at)
 *     liffUsers/{lineUserId}        →  building=newB + room=newR (if linked)
 *     Auth custom claims            →  setCustomUserClaims(linkedUid,
 *                                       {room:newR, building:newB, tenantId,
 *                                        ...preserved}) + revokeRefreshTokens
 *     RTDB audit_logs/leases        →  push {action: 'tenant_transferred',
 *                                       mode: 'variation', ...}
 *
 *   novation:
 *     (same tenants/oldR/newR moves)
 *     leases/{oldB}/list/{oldLeaseId} → status='transferred' +
 *                                        transferredToLeaseId + transferredAt +
 *                                        transferredBy + transferredByEmail +
 *                                        endReason='transferred' + updatedAt
 *     leases/{newB}/list/{newLeaseId} → create with priorLeaseId chain +
 *                                        transferredFromLeaseId + fresh dates
 *     occupancyLog (paired, both rooms) → transferred_out (oldLeaseId) +
 *                                        transferred_in (newLeaseId);
 *                                        discriminator = the OTHER lease's id
 *     (rest same as variation)
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const { getValidBuildings } = require('./buildingRegistry');
const { appendLog } = require('./_occupancyLog');

const VALID_MODES = new Set(['variation', 'novation']);
const ROOM_ID_RE = /^[A-Za-z0-9ก-๛]{1,20}$/;

// Helper — see renewLease._parseDateField. Parse Firestore Timestamp, ISO
// string, or millis-number into a JS Date or null.
function _parseDateField(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validate + normalise input. Returns normalised payload OR throws HttpsError.
 * Pure — no Firestore reads. Exported for white-box testing.
 *
 * Mode default: 'variation' (per lifecycle_tenant_transitions.md § B vote —
 * mutual room-change is most-common operationally + preserves tenure clock).
 */
async function _validateInput(data) {
  const {
    building,
    oldRoomId,
    newBuilding,
    newRoomId,
    mode,
    effectiveDate,
    transferDeposit,
    prorateBills,
    newRentAmount,
    newDeposit,
    contractDocument,
    contractFileName,
    contractDocumentUrl,
    notes,
  } = data || {};

  // ── Buildings (both validated against registry) ─────────────────────────
  const validBuildings = await getValidBuildings();
  if (!validBuildings.has(building)) {
    throw new functions.https.HttpsError('invalid-argument',
      `building must be one of [${Array.from(validBuildings).join(', ')}] (got '${building}')`);
  }
  if (!validBuildings.has(newBuilding)) {
    throw new functions.https.HttpsError('invalid-argument',
      `newBuilding must be one of [${Array.from(validBuildings).join(', ')}] (got '${newBuilding}')`);
  }

  // ── Room IDs ────────────────────────────────────────────────────────────
  if (typeof oldRoomId !== 'string' || !ROOM_ID_RE.test(oldRoomId)) {
    throw new functions.https.HttpsError('invalid-argument',
      `oldRoomId must be 1-20 alphanumeric/Thai chars (got '${oldRoomId}')`);
  }
  if (typeof newRoomId !== 'string' || !ROOM_ID_RE.test(newRoomId)) {
    throw new functions.https.HttpsError('invalid-argument',
      `newRoomId must be 1-20 alphanumeric/Thai chars (got '${newRoomId}')`);
  }

  // Same-room transfer is a no-op (and would otherwise corrupt state when
  // the batch tries to clear+populate the same doc in one batch).
  if (building === newBuilding && oldRoomId === newRoomId) {
    throw new functions.https.HttpsError('invalid-argument',
      `Cannot transfer to the same room (${building}/${oldRoomId} → ${newBuilding}/${newRoomId})`);
  }

  // ── Mode ────────────────────────────────────────────────────────────────
  const normalisedMode = String(mode || 'variation');
  if (!VALID_MODES.has(normalisedMode)) {
    throw new functions.https.HttpsError('invalid-argument',
      `mode must be one of: ${[...VALID_MODES].join(', ')} (got '${mode}')`);
  }

  // Variation must NOT change rent/deposit — that's a novation concern.
  // Admin should pick mode='novation' if they need fresh financial terms.
  if (normalisedMode === 'variation') {
    if (newRentAmount !== undefined) {
      throw new functions.https.HttpsError('invalid-argument',
        `newRentAmount not allowed in variation mode — use mode='novation' for rent changes`);
    }
    if (newDeposit !== undefined) {
      throw new functions.https.HttpsError('invalid-argument',
        `newDeposit not allowed in variation mode — use mode='novation' for deposit changes`);
    }
  }

  // ── effectiveDate (optional; defaults to "now") ─────────────────────────
  let normalisedEffectiveDate;
  if (effectiveDate === undefined || effectiveDate === null || effectiveDate === '') {
    normalisedEffectiveDate = new Date();
  } else {
    const d = new Date(effectiveDate);
    if (Number.isNaN(d.getTime())) {
      throw new functions.https.HttpsError('invalid-argument',
        `effectiveDate is not a valid date (got '${effectiveDate}')`);
    }
    // Allow today; reject only strictly past (more than 1 day ago) to
    // tolerate timezone fuzz. Future dates are accepted (admin may schedule).
    if (d.getTime() < Date.now() - 86400 * 1000) {
      throw new functions.https.HttpsError('invalid-argument',
        `effectiveDate is more than 1 day in the past (got '${d.toISOString()}')`);
    }
    normalisedEffectiveDate = d;
  }

  // ── Optional numerics (novation only) ───────────────────────────────────
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

  // ── Optional booleans (default true / false respectively) ───────────────
  const normalisedTransferDeposit = (transferDeposit === undefined) ? true : !!transferDeposit;
  const normalisedProrateBills = (prorateBills === undefined) ? false : !!prorateBills;

  // ── Optional strings ────────────────────────────────────────────────────
  if (contractDocument !== undefined && typeof contractDocument !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'contractDocument must be a string (Storage path or download URL)');
  }
  if (contractFileName !== undefined && typeof contractFileName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'contractFileName must be a string');
  }
  // Optional download URL paired with contractDocument (Storage path). Same
  // contract as renewLease — enables the canonical documentURLs.agreement write.
  if (contractDocumentUrl !== undefined && typeof contractDocumentUrl !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'contractDocumentUrl must be a string');
  }
  if (notes !== undefined && typeof notes !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'notes must be a string');
  }

  return {
    building,
    oldRoomId,
    newBuilding,
    newRoomId,
    mode: normalisedMode,
    effectiveDate: normalisedEffectiveDate,
    transferDeposit: normalisedTransferDeposit,
    prorateBills: normalisedProrateBills,
    newRentAmount: normalisedRent,
    newDeposit: normalisedDeposit,
    contractDocument: contractDocument || '',
    contractFileName: contractFileName || '',
    contractDocumentUrl: contractDocumentUrl || '',
    notes: notes || '',
  };
}

/**
 * Reads pre-conditions for transfer. Returns:
 *   { oldTenantRef, oldTenantData, tenantId, leaseId,
 *     oldLeaseRef, oldLeaseData, oldEndDate, oldStartDate,
 *     newTenantRef, newTenantData }
 * or throws HttpsError. Exported for white-box testing.
 *
 * Guards:
 *   1. OLD tenant doc must exist with tenantId (room must be occupied).
 *   2. OLD lease must exist with status='active'.
 *   3. NEW tenant doc — if it exists, must be vacant (no tenantId).
 *      If it doesn't exist, that's fine (we'll create it in the batch).
 */
async function _readTransferState(firestore, building, oldRoomId, newBuilding, newRoomId) {
  // ── OLD tenant doc ──────────────────────────────────────────────────────
  const oldTenantRef = firestore.collection('tenants').doc(building).collection('list').doc(oldRoomId);
  const oldTenantSnap = await oldTenantRef.get();
  if (!oldTenantSnap.exists) {
    throw new functions.https.HttpsError('not-found',
      `tenants/${building}/list/${oldRoomId} does not exist`);
  }
  const oldTenantData = oldTenantSnap.data() || {};

  const tenantId = String(oldTenantData.tenantId || '').trim();
  if (!tenantId) {
    throw new functions.https.HttpsError('failed-precondition',
      `Room ${building}/${oldRoomId} has no tenantId — vacant rooms cannot be transferred`);
  }
  if (!String(oldTenantData.name || '').trim() && !String(oldTenantData.firstName || '').trim()) {
    throw new functions.https.HttpsError('failed-precondition',
      `Room ${building}/${oldRoomId} has tenantId but no name — incomplete tenant record`);
  }

  // ── OLD lease pointer chain (same precedence as archive + renew CFs) ───
  const leaseId = (oldTenantData.lease && oldTenantData.lease.leaseId)
    || oldTenantData.activeContractId
    || (oldTenantData.contractId ? String(oldTenantData.contractId) : null);
  if (!leaseId) {
    throw new functions.https.HttpsError('failed-precondition',
      `Room ${building}/${oldRoomId} has tenantId but no active lease pointer ` +
      `(lease.leaseId / activeContractId / contractId all empty) — cannot transfer`);
  }

  const oldLeaseRef = firestore.collection('leases').doc(building).collection('list').doc(String(leaseId));
  const oldLeaseSnap = await oldLeaseRef.get();
  if (!oldLeaseSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease doc leases/${building}/list/${leaseId} not found — tenant doc points at a non-existent lease`);
  }
  const oldLeaseData = oldLeaseSnap.data() || {};

  const status = String(oldLeaseData.status || 'active');
  if (status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease ${leaseId} has status='${status}' — only 'active' leases can be transferred`);
  }

  const oldEndDate = _parseDateField(oldLeaseData.moveOutDate) || _parseDateField(oldLeaseData.endDate);
  const oldStartDate = _parseDateField(oldLeaseData.contractStart) || _parseDateField(oldLeaseData.moveInDate);
  if (!oldEndDate) {
    throw new functions.https.HttpsError('failed-precondition',
      `Lease ${leaseId} has no parseable moveOutDate/endDate — cannot transfer`);
  }

  // ── NEW tenant doc (must be vacant or non-existent) ─────────────────────
  const newTenantRef = firestore.collection('tenants').doc(newBuilding).collection('list').doc(newRoomId);
  const newTenantSnap = await newTenantRef.get();
  const newTenantData = newTenantSnap.exists ? (newTenantSnap.data() || {}) : null;
  if (newTenantData) {
    const newTenantId = String(newTenantData.tenantId || '').trim();
    if (newTenantId) {
      throw new functions.https.HttpsError('already-exists',
        `Target room ${newBuilding}/${newRoomId} is occupied (tenantId='${newTenantId}') — must be vacant to receive transfer`);
    }
  }

  return {
    oldTenantRef, oldTenantData, tenantId, leaseId,
    oldLeaseRef, oldLeaseData, oldEndDate, oldStartDate,
    newTenantRef, newTenantData,
  };
}

/**
 * Identity fields to MOVE from old room to new room. Mirror archive's
 * FIELDS_TO_CLEAR list inverted — anything blanked on archive is anything
 * we need to carry on transfer.
 *
 * Building + roomId are set explicitly to the NEW values (not carried).
 * Lease fields are recomputed per mode (variation: same leaseId; novation: new).
 */
const IDENTITY_FIELDS = [
  'name', 'firstName', 'lastName', 'phone', 'email', 'emailVerified',
  'lineID', 'address', 'idCardNumber',
  'tenantId', 'linkedAuthUid', 'linkedAt', 'phoneVerifiedAt',
  'licensePlate', 'emergencyContact', 'companyInfo',
  'gamification', 'sourceBookingId',
];

/**
 * Build the identity carry-over object for the new tenant doc.
 */
function _carryIdentity(oldTenantData) {
  const carried = {};
  for (const f of IDENTITY_FIELDS) {
    if (oldTenantData[f] !== undefined) carried[f] = oldTenantData[f];
  }
  return carried;
}

/**
 * Fields to BLANK on the old tenant doc post-transfer. Identical to
 * archiveTenantOnMoveOut's FIELDS_TO_CLEAR but does NOT touch lease subobject
 * (lease is handled per-mode). Status becomes 'vacant' immediately (Q4=immediate).
 */
function _buildOldRoomClearPatch(now) {
  return {
    // Identity
    name: '', firstName: '', lastName: '', phone: '', email: '',
    emailVerified: false, lineID: '', address: '', idCardNumber: '',
    tenantId: '', contractId: '',
    linkedAuthUid: '', linkedAt: admin.firestore.FieldValue.delete(),
    phoneVerifiedAt: admin.firestore.FieldValue.delete(),
    // Lease state (lease subobject handled per-mode below)
    moveInDate: '', moveOutDate: '', rentAmount: 0, deposit: 0,
    depositPaid: false, contractDocument: '', contractFileName: '',
    contractStart: '', contractEnd: '', contractMonths: 0,
    lease: admin.firestore.FieldValue.delete(),
    activeContractId: '',
    // Misc
    notes: '', licensePlate: '',
    emergencyContact: null, companyInfo: null,
    gamification: null, sourceBookingId: '',
    // Room metadata
    status: 'vacant',
    updatedAt: now,
    lastTransferredAt: now,
  };
}

/**
 * Resolve a non-empty tenantName for occupancyLog entries (helper required-
 * field check rejects empty string). Fallback chain:
 *   1. lease.tenantName (set at convertBookingToTenant time — most canonical)
 *   2. tenants doc name (live identity at transfer moment)
 *   3. composed firstName + lastName from tenants doc
 *   4. 'unknown' last-resort so the log entry still writes
 *
 * Exposed for white-box tests covering missing-name edge case.
 */
function _resolveTenantName(leaseData, tenantData) {
  const leaseName = String((leaseData && leaseData.tenantName) || '').trim();
  if (leaseName) return leaseName;
  const docName = String((tenantData && tenantData.name) || '').trim();
  if (docName) return docName;
  const first = String((tenantData && tenantData.firstName) || '').trim();
  const last  = String((tenantData && tenantData.lastName)  || '').trim();
  const composed = [first, last].filter(Boolean).join(' ').trim();
  if (composed) return composed;
  return 'unknown';
}

/**
 * Move the lease contract Storage object from the old room path to the new
 * room path. Path shape (per storage.rules /leases/{building}/{roomId}/{leaseId}/{fileName}):
 *   leases/{building}/{roomId}/{leaseId}/{fileName}
 *
 * Returns the NEW path if a move happened, OR the input path unchanged if:
 *   - oldPath empty (legacy lease with no Storage doc) → return ''
 *   - oldPath doesn't match the canonical pattern (URL or malformed) → return as-is, no move
 *   - oldPath segments already match new building/room → no-op, return as-is
 *   - source object doesn't exist in Storage → return target path anyway so the
 *     stored field points where the file WOULD have been (defensive — admin may
 *     have manually moved or never uploaded)
 *
 * Throws on actual Storage copy/delete failure so the caller can abort BEFORE
 * Firestore batch commit (per option 1 design — keep contractDocument field
 * consistent with the file's real location).
 */
async function _moveContractStorage(oldPath, newBuilding, newRoomId, leaseId) {
  if (!oldPath) return '';
  // Canonical lease Storage path: leases/{b}/{r}/{leaseId}/{fileName}
  const m = /^leases\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(oldPath);
  if (!m) {
    // URL or malformed value (e.g. https://... or a contract uploaded outside the
    // canonical leases/ tree). Leave it alone — manual cleanup if needed.
    console.warn(`transferTenant: contractDocument doesn't match canonical leases path, skipping move: ${oldPath}`);
    return oldPath;
  }
  const [, oldB, oldR, oldLeaseId, fileName] = m;
  // Defensive: leaseId in the path should match the lease being transferred. If
  // not, log + skip — we don't want to silently move a file under a different
  // lease's path.
  if (oldLeaseId !== String(leaseId)) {
    console.warn(`transferTenant: contractDocument leaseId mismatch ` +
      `(path=${oldLeaseId}, expected=${leaseId}); skipping move`);
    return oldPath;
  }
  const newPath = `leases/${newBuilding}/${newRoomId}/${leaseId}/${fileName}`;
  if (oldPath === newPath) return oldPath; // already at target (idempotent re-run)

  const bucket = admin.storage().bucket();
  const sourceFile = bucket.file(oldPath);
  const [exists] = await sourceFile.exists();
  if (!exists) {
    console.warn(`transferTenant: contractDocument source missing in Storage, ` +
      `updating field to new path anyway: ${oldPath} -> ${newPath}`);
    return newPath;
  }
  // Copy then delete (move). Throws on either step — caller aborts BEFORE batch.
  await sourceFile.copy(bucket.file(newPath));
  try {
    await sourceFile.delete();
  } catch (delErr) {
    // Copy succeeded but delete failed — file now exists at BOTH paths. Log
    // loud, return newPath so the tenant gets the new contractDocument. The
    // orphan at oldPath is recoverable via storage console or sweep CF later;
    // failing the transfer at this point would be worse (file exists at new
    // path, batch not committed → tenant doc still points at old path).
    console.error(`transferTenant: contractDocument copy succeeded but delete failed for ${oldPath}: ${delErr.message}`);
  }
  return newPath;
}

/**
 * Variation mode batch. Single lease doc, amendments[] arrayUnion entry.
 * Lease moves room (roomId field updated) but startDate/endDate/leaseId stay.
 *
 * Pure helper — caller owns auth + validation. Returns audit payload.
 */
async function _runVariationMode(input, callerUid, callerEmail, firestore) {
  const {
    building, oldRoomId, newBuilding, newRoomId,
    effectiveDate, transferDeposit, prorateBills, notes,
  } = input;

  const state = await _readTransferState(firestore, building, oldRoomId, newBuilding, newRoomId);
  const { oldTenantRef, oldTenantData, tenantId, leaseId,
          oldLeaseRef, oldLeaseData, oldEndDate, newTenantRef } = state;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const effectiveIso = effectiveDate.toISOString();

  // Detect wrong-shape amendments field (mirror renewLease._runExtensionMode
  // defensive handling — older lease docs predate this field).
  const existingAmendments = oldLeaseData.amendments;
  const amendmentsIsArray = Array.isArray(existingAmendments);
  if (existingAmendments !== undefined && !amendmentsIsArray) {
    console.warn(`transferTenant[variation]: lease ${leaseId} has non-array amendments field ` +
      `(${typeof existingAmendments}) — resetting to fresh array`);
  }

  // Build amendment entry (wall-clock `at` per renewLease._runExtensionMode
  // comment — serverTimestamp() inside arrayUnion silently becomes null).
  const amendmentEntry = {
    at: new Date().toISOString(),
    effectiveDate: effectiveIso,
    type: 'room_transfer',
    fromBuilding: building,
    fromRoom: oldRoomId,
    toBuilding: newBuilding,
    toRoom: newRoomId,
    transferDeposit,
    prorateBills,
    by: callerUid,
    byEmail: callerEmail,
    notes: notes || '',
  };

  // ── Storage move BEFORE batch (per H2 design option 1) ─────────────────
  // Move the contract Storage object to its new room path so that direct
  // getDownloadURL() reads (storage.rules /leases/{b}/{r}/{leaseId}/{fileName})
  // continue to pass the claim gate after transfer. getLeaseDocUrl CF still
  // works either way (admin SDK bypasses Storage rules), but moving the file
  // keeps the canonical state consistent and avoids relying on Path 1c/1d
  // fallbacks indefinitely.
  //
  // Throws on Storage failure → batch never commits, transfer aborts cleanly.
  const originalDocPath = String(oldLeaseData.contractDocument || '');
  const carriedDocPath = await _moveContractStorage(
    originalDocPath, newBuilding, newRoomId, leaseId,
  );
  const carriedDocName = String(oldLeaseData.contractFileName || '');

  // ── Batch ───────────────────────────────────────────────────────────────
  const batch = firestore.batch();

  // 1. NEW tenant doc — populate with carried identity + same lease pointer
  // Mirror contractPath/contractFileName onto the lease subobject too so the
  // tenant_app contract reader (which checks _taLease.contractPath first) stays
  // on the canonical path for variation transfers. Same lease doc, same agreement.
  const carriedIdentity = _carryIdentity(oldTenantData);
  const newTenantPatch = {
    ...carriedIdentity,
    building: newBuilding,
    roomId: newRoomId,
    status: 'occupied',
    contractStart: String(oldLeaseData.contractStart || oldLeaseData.moveInDate || ''),
    contractEnd: oldEndDate.toISOString(),
    contractMonths: Number(oldLeaseData.contractMonths) || 0,
    rentAmount: Number(oldLeaseData.rentAmount) || 0,
    deposit: Number(oldLeaseData.deposit) || 0,
    depositPaid: !!oldLeaseData.depositPaid,
    activeContractId: leaseId,
    contractId: leaseId,
    lease: {
      leaseId,
      status: 'active',
      startDate: String(oldLeaseData.contractStart || oldLeaseData.moveInDate || ''),
      endDate: oldEndDate.toISOString(),
      contractPath: carriedDocPath,
      contractFileName: carriedDocName,
    },
    contractDocument: carriedDocPath,
    contractFileName: carriedDocName,
    createdAt: now,
    updatedAt: now,
    transferredFromBuilding: building,
    transferredFromRoom: oldRoomId,
    lastTransferredAt: now,
  };
  // Using set with merge:false so the NEW doc fully replaces any stale
  // data (e.g. a previously-archived shell). The pre-condition guard already
  // verified the doc is vacant or non-existent.
  batch.set(newTenantRef, newTenantPatch, { merge: false });

  // 2. OLD tenant doc — blank identity (mirror archiveTenantOnMoveOut)
  batch.update(oldTenantRef, _buildOldRoomClearPatch(now));

  // 3. Lease doc — update roomId + building + append amendment entry.
  // contractDocument is updated to the new Storage path if _moveContractStorage
  // moved the file (otherwise no-change). Keeps the lease doc consistent with
  // the file's actual location so Path 1c (lease-doc-sot) in getLeaseDocUrl
  // resolves to a path that storage.rules will permit on direct reads.
  const leasePatch = {
    building: newBuilding,
    roomId: newRoomId,
    updatedAt: now,
    lastAmendedAt: now,
    lastAmendedBy: callerUid,
  };
  if (carriedDocPath !== originalDocPath) {
    leasePatch.contractDocument = carriedDocPath;
  }
  if (amendmentsIsArray || existingAmendments === undefined) {
    leasePatch.amendments = admin.firestore.FieldValue.arrayUnion(amendmentEntry);
  } else {
    leasePatch.amendments = [amendmentEntry];
  }
  // If the lease is at a different doc path (newBuilding != building) the
  // doc would need to be moved. Lease docs are keyed by leaseId not roomId,
  // BUT the path includes building (leases/{b}/list/{leaseId}). For variation
  // across buildings, we must move the doc.
  if (newBuilding !== building) {
    // Cross-building variation: read full lease data, create at new path,
    // delete at old path. Same batch keeps atomicity.
    const newLeaseRef = firestore.collection('leases').doc(newBuilding).collection('list').doc(String(leaseId));
    batch.set(newLeaseRef, {
      ...oldLeaseData,
      ...leasePatch,
      // Amendments field needs the resolved value (not the FieldValue sentinel
      // — set() with the sentinel inside a NEW doc-set won't apply arrayUnion).
      amendments: amendmentsIsArray
        ? [...existingAmendments, amendmentEntry]
        : [amendmentEntry],
    });
    batch.delete(oldLeaseRef);
  } else {
    batch.update(oldLeaseRef, leasePatch);
  }

  // 4. people doc — update currentBuilding + currentRoom
  const peopleRef = firestore.collection('people').doc(String(tenantId));
  batch.set(peopleRef, {
    currentBuilding: newBuilding,
    currentRoom: newRoomId,
    activeBuilding: newBuilding,
    activeRoom: newRoomId,
    updatedAt: now,
  }, { merge: true });

  // 5. Plan B' S2: paired occupancyLog entries (transferred_out + transferred_in)
  //    in same batch as the lease + tenant moves. Discriminator = amendment
  //    timestamp (unique per event, allows multiple transfers of same lease to
  //    coexist without idempotency collisions per _occupancyLog.js doc).
  const tenantNameForLog = _resolveTenantName(oldLeaseData, oldTenantData);
  const personIdForLog = String(oldTenantData.personId || tenantId);
  try {
    appendLog(batch, firestore, {
      tenantId, tenantName: tenantNameForLog, personId: personIdForLog,
      building, roomId: oldRoomId,
      action: 'transferred_out',
      reason: notes || null,
      otherBuilding: newBuilding, otherRoom: newRoomId,
      leaseId,
      by: callerUid, byEmail: callerEmail || null,
      source: 'transferTenant.variation',
      discriminator: amendmentEntry.at,
    });
    appendLog(batch, firestore, {
      tenantId, tenantName: tenantNameForLog, personId: personIdForLog,
      building: newBuilding, roomId: newRoomId,
      action: 'transferred_in',
      reason: notes || null,
      otherBuilding: building, otherRoom: oldRoomId,
      leaseId,
      by: callerUid, byEmail: callerEmail || null,
      source: 'transferTenant.variation',
      discriminator: amendmentEntry.at,
    });
  } catch (logErr) {
    console.error('transferTenant[variation]: occupancyLog append failed (aborting):', logErr.message);
    throw new functions.https.HttpsError('internal',
      `occupancyLog append failed: ${logErr.message}`);
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error('transferTenant[variation]: batch commit failed:', e);
    throw new functions.https.HttpsError('internal',
      e.message || 'Variation batch commit failed');
  }

  // ── Post-batch: liffUsers update + claim refresh (§7-FF) ────────────────
  const linkedAuthUid = String(oldTenantData.linkedAuthUid || '').trim();
  const claimsRefreshed = await _updateLiffUserAndClaims({
    firestore,
    tenantId,
    linkedAuthUid,
    newBuilding,
    newRoomId,
  });

  const auditPayload = {
    action: 'tenant_transferred',
    mode: 'variation',
    fromBuilding: building, fromRoom: oldRoomId,
    toBuilding: newBuilding, toRoom: newRoomId,
    tenantId,
    leaseId,
    effectiveDate: effectiveIso,
    transferDeposit, prorateBills,
    amendmentCountAfter: amendmentsIsArray ? existingAmendments.length + 1 : 1,
    claimsRefreshed,
    notes: notes || '',
    actor: callerEmail || callerUid,
    actorUid: callerUid,
  };

  return {
    success: true,
    mode: 'variation',
    building, oldRoomId, newBuilding, newRoomId,
    tenantId, oldLeaseId: leaseId,
    effectiveDate: effectiveIso,
    transferDeposit, prorateBills,
    claimsRefreshed,
    auditPayload,
  };
}

/**
 * Novation mode batch. OLD lease set to status='transferred' + pointer to
 * NEW lease; NEW lease created at the new room with priorLeaseId chain.
 *
 * Pure helper — caller owns auth + validation. Returns audit payload.
 */
async function _runNovationMode(input, callerUid, callerEmail, firestore) {
  const {
    building, oldRoomId, newBuilding, newRoomId,
    effectiveDate, transferDeposit, prorateBills, notes,
    newRentAmount, newDeposit, contractDocument, contractFileName, contractDocumentUrl,
  } = input;

  const state = await _readTransferState(firestore, building, oldRoomId, newBuilding, newRoomId);
  const { oldTenantRef, oldTenantData, tenantId, leaseId: oldLeaseId,
          oldLeaseRef, oldLeaseData, oldEndDate, newTenantRef } = state;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const effectiveIso = effectiveDate.toISOString();
  const newLeaseId = `CONTRACT_${Date.now()}_${newRoomId}`;
  const newLeaseRef = firestore.collection('leases').doc(newBuilding).collection('list').doc(newLeaseId);

  // Resolved values for new lease — novation may override rent/deposit
  const resolvedRent = (newRentAmount !== undefined) ? newRentAmount : Number(oldLeaseData.rentAmount) || 0;
  const resolvedDeposit = (newDeposit !== undefined) ? newDeposit : Number(oldLeaseData.deposit) || 0;
  const resolvedDocPath = contractDocument || String(oldLeaseData.contractDocument || '');
  const resolvedDocName = contractFileName || String(oldLeaseData.contractFileName || '');

  // Canonical document object — same shape contract as renewLease. When a
  // new upload is provided, build the fresh object; otherwise inherit old.
  let resolvedDocAgreement = null;
  if (contractDocument && contractDocumentUrl) {
    resolvedDocAgreement = {
      url: contractDocumentUrl,
      path: contractDocument,
      fileName: resolvedDocName,
      uploadedAt: new Date().toISOString(),
    };
  } else if (oldLeaseData.documentURLs && oldLeaseData.documentURLs.agreement) {
    resolvedDocAgreement = oldLeaseData.documentURLs.agreement;
  }

  // The new lease keeps the old's endDate (novation doesn't extend term).
  // If admin wants a new endDate, they fire renewLease against the new room
  // separately (per Q2=sequential CFs).
  const endIso = oldEndDate.toISOString();

  // ── Batch ───────────────────────────────────────────────────────────────
  const batch = firestore.batch();

  // 1. NEW tenant doc — populate with carried identity + NEW lease pointer
  const carriedIdentity = _carryIdentity(oldTenantData);
  const newTenantPatch = {
    ...carriedIdentity,
    building: newBuilding,
    roomId: newRoomId,
    status: 'occupied',
    contractStart: effectiveIso,
    contractEnd: endIso,
    contractMonths: Number(oldLeaseData.contractMonths) || 0,
    rentAmount: resolvedRent,
    deposit: resolvedDeposit,
    depositPaid: !!oldLeaseData.depositPaid,
    activeContractId: newLeaseId,
    contractId: newLeaseId,
    lease: {
      leaseId: newLeaseId,
      status: 'active',
      startDate: effectiveIso,
      endDate: endIso,
      contractPath: resolvedDocPath,
      contractFileName: resolvedDocName,
    },
    contractDocument: resolvedDocPath,
    contractFileName: resolvedDocName,
    createdAt: now,
    updatedAt: now,
    transferredFromBuilding: building,
    transferredFromRoom: oldRoomId,
    transferredFromLeaseId: oldLeaseId,
    lastTransferredAt: now,
  };
  batch.set(newTenantRef, newTenantPatch, { merge: false });

  // 2. OLD tenant doc — blank identity
  batch.update(oldTenantRef, _buildOldRoomClearPatch(now));

  // 3. OLD lease — status='transferred' + pointer to new lease
  batch.update(oldLeaseRef, {
    status: 'transferred',
    transferredAt: now,
    transferredToLeaseId: newLeaseId,
    transferredBy: callerUid,
    transferredByEmail: callerEmail,
    endReason: 'transferred',
    updatedAt: now,
  });

  // 4. NEW lease — fresh doc
  const newLeaseData = {
    id: newLeaseId,
    building: newBuilding,
    roomId: newRoomId,
    tenantId,
    tenantName: String(oldLeaseData.tenantName || oldTenantData.name || ''),
    moveInDate: effectiveIso,
    moveOutDate: endIso,
    contractStart: effectiveIso,
    contractMonths: Number(oldLeaseData.contractMonths) || 0,
    rentAmount: resolvedRent,
    deposit: resolvedDeposit,
    depositPaid: !!oldLeaseData.depositPaid,
    depositPaidAt: oldLeaseData.depositPaidAt || null,
    depositSlipRef: String(oldLeaseData.depositSlipRef || ''),
    status: 'active',
    contractFileName: resolvedDocName,
    contractDocument: resolvedDocPath,
    priorLeaseId: oldLeaseId,
    transferredFromLeaseId: oldLeaseId,
    transferredFromBuilding: building,
    transferredFromRoom: oldRoomId,
    transferDeposit,
    prorateBills,
    transferNotes: notes,
    sourceBookingId: String(oldLeaseData.sourceBookingId || ''),
    createdDate: now,
    updatedAt: now,
  };
  if (resolvedDocAgreement) {
    newLeaseData.documentURLs = { agreement: resolvedDocAgreement };
  }
  batch.set(newLeaseRef, newLeaseData, { merge: false });

  // 5. people doc — update location
  const peopleRef = firestore.collection('people').doc(String(tenantId));
  batch.set(peopleRef, {
    currentBuilding: newBuilding,
    currentRoom: newRoomId,
    activeBuilding: newBuilding,
    activeRoom: newRoomId,
    updatedAt: now,
  }, { merge: true });

  // 6. Plan B' S2: paired occupancyLog entries. transferred_out carries the OLD
  //    leaseId, transferred_in carries the NEW leaseId (each entry's leaseId is
  //    the lease in effect at the time of the event). Discriminator pairs them
  //    via the OTHER lease's id per _occupancyLog.js doc.
  const tenantNameForLog = _resolveTenantName(oldLeaseData, oldTenantData);
  const personIdForLog = String(oldTenantData.personId || tenantId);
  try {
    appendLog(batch, firestore, {
      tenantId, tenantName: tenantNameForLog, personId: personIdForLog,
      building, roomId: oldRoomId,
      action: 'transferred_out',
      reason: notes || null,
      otherBuilding: newBuilding, otherRoom: newRoomId,
      leaseId: oldLeaseId,
      by: callerUid, byEmail: callerEmail || null,
      source: 'transferTenant.novation',
      discriminator: newLeaseId,
    });
    appendLog(batch, firestore, {
      tenantId, tenantName: tenantNameForLog, personId: personIdForLog,
      building: newBuilding, roomId: newRoomId,
      action: 'transferred_in',
      reason: notes || null,
      otherBuilding: building, otherRoom: oldRoomId,
      leaseId: newLeaseId,
      by: callerUid, byEmail: callerEmail || null,
      source: 'transferTenant.novation',
      discriminator: oldLeaseId,
    });
  } catch (logErr) {
    console.error('transferTenant[novation]: occupancyLog append failed (aborting):', logErr.message);
    throw new functions.https.HttpsError('internal',
      `occupancyLog append failed: ${logErr.message}`);
  }

  try {
    await batch.commit();
  } catch (e) {
    console.error('transferTenant[novation]: batch commit failed:', e);
    throw new functions.https.HttpsError('internal',
      e.message || 'Novation batch commit failed');
  }

  // ── Post-batch: liffUsers update + claim refresh (§7-FF) ────────────────
  const linkedAuthUid = String(oldTenantData.linkedAuthUid || '').trim();
  const claimsRefreshed = await _updateLiffUserAndClaims({
    firestore,
    tenantId,
    linkedAuthUid,
    newBuilding,
    newRoomId,
  });

  const auditPayload = {
    action: 'tenant_transferred',
    mode: 'novation',
    fromBuilding: building, fromRoom: oldRoomId,
    toBuilding: newBuilding, toRoom: newRoomId,
    tenantId,
    oldLeaseId,
    newLeaseId,
    effectiveDate: effectiveIso,
    transferDeposit, prorateBills,
    oldRent: Number(oldLeaseData.rentAmount) || 0,
    newRent: resolvedRent,
    rentChanged: (newRentAmount !== undefined) && (resolvedRent !== (Number(oldLeaseData.rentAmount) || 0)),
    depositChanged: (newDeposit !== undefined) && (resolvedDeposit !== (Number(oldLeaseData.deposit) || 0)),
    documentReplaced: !!contractDocument,
    claimsRefreshed,
    notes: notes || '',
    actor: callerEmail || callerUid,
    actorUid: callerUid,
  };

  return {
    success: true,
    mode: 'novation',
    building, oldRoomId, newBuilding, newRoomId,
    tenantId, oldLeaseId, newLeaseId,
    effectiveDate: effectiveIso,
    transferDeposit, prorateBills,
    claimsRefreshed,
    auditPayload,
  };
}

/**
 * Update liffUsers/{lineUserId}.building+room AND re-mint Firebase Auth
 * custom claims for the linked UID(s) per §7-FF three-leg:
 *   1. setCustomUserClaims with new {room, building, tenantId} (+ preserve)
 *   2. revokeRefreshTokens so the cached ID token can no longer be used
 *      against rules that gate by request.auth.token.room
 * Step 3 (client-side force-refresh) is handled by tenant_app's existing
 * `_callLiffSignIn` fast-path (lines 9775-9800 — verified P1.1).
 *
 * Mirrors unlinkLiffUser's claim-handling pattern except minting fresh
 * claims rather than stripping them. Returns the count of UIDs successfully
 * updated (best-effort — failures here don't undo the Firestore batch).
 */
async function _updateLiffUserAndClaims({ firestore, tenantId, linkedAuthUid, newBuilding, newRoomId }) {
  let claimsRefreshed = 0;

  // ── Step A: find lineUserId via people doc lookup ───────────────────────
  // people/{tenantId} carries lineUserId after liffSignIn links; the
  // deterministic UID is 'line:' + lineUserId (per liffSignIn.js convention).
  let lineUserId = null;
  let peopleData = null;
  try {
    const peopleSnap = await firestore.collection('people').doc(String(tenantId)).get();
    if (peopleSnap.exists) {
      peopleData = peopleSnap.data() || {};
      lineUserId = String(peopleData.lineUserId || '').trim() || null;
    }
  } catch (e) {
    console.warn(`transferTenant: people lookup for ${tenantId} failed (non-fatal):`, e.message);
  }

  // ── Step B: update liffUsers/{lineUserId}.building + room ───────────────
  if (lineUserId) {
    try {
      const liffRef = firestore.collection('liffUsers').doc(lineUserId);
      const liffSnap = await liffRef.get();
      if (liffSnap.exists) {
        await liffRef.update({
          building: newBuilding,
          room: newRoomId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        console.warn(`transferTenant: liffUsers/${lineUserId} missing despite people.lineUserId set — skipping liff update`);
      }
    } catch (e) {
      console.warn(`transferTenant: liffUsers update for ${lineUserId} failed (non-fatal):`, e.message);
    }
  }

  // ── Step C: re-mint claims for both deterministic + legacy UIDs ─────────
  // Two UIDs may be in play (per unlinkLiffUser pattern):
  //   - deterministicUid = 'line:' + lineUserId (current liffSignIn flow)
  //   - linkedAuthUid    = pre-liffSignIn anonymous UID stored on tenant doc
  const uidsToRefresh = [];
  if (lineUserId) uidsToRefresh.push('line:' + lineUserId);
  if (linkedAuthUid && !uidsToRefresh.includes(linkedAuthUid)) {
    uidsToRefresh.push(linkedAuthUid);
  }

  if (uidsToRefresh.length === 0) {
    // No linked Auth UID — tenant has never signed into LIFF. Nothing to
    // refresh. This is normal for manually-created tenants who never used
    // the LINE link.
    return 0;
  }

  const newClaims = {
    room: newRoomId,
    building: newBuilding,
    tenantId,
  };

  const auth = admin.auth();
  const results = await Promise.allSettled(
    uidsToRefresh.map(async uid => {
      try {
        // Preserve any non-room/building/tenantId claims that may be on
        // the user record (e.g. role='player' from a prior player phase —
        // although that combination shouldn't occur).
        const userRecord = await auth.getUser(uid).catch(() => null);
        const existingClaims = (userRecord && userRecord.customClaims) || {};
        const mergedClaims = { ...existingClaims, ...newClaims };
        await auth.setCustomUserClaims(uid, mergedClaims);
        await auth.revokeRefreshTokens(uid);
        return uid;
      } catch (e) {
        // auth/user-not-found is expected for legacyAuthUid that was cleaned
        // up by cleanupAnonymousUsers — log warn, don't throw.
        if (e && e.code === 'auth/user-not-found') {
          console.info(`transferTenant: ${uid} not found (legacy UID likely cleaned up) — skipping`);
        } else {
          console.warn(`transferTenant: claim refresh failed for ${uid}: ${e?.message || e}`);
        }
        throw e;
      }
    })
  );
  claimsRefreshed = results.filter(r => r.status === 'fulfilled').length;
  return claimsRefreshed;
}

/**
 * Best-effort RTDB audit write. Same pattern as renewLease._writeAuditLog.
 */
async function _writeAuditLog(payload) {
  try {
    if (!admin.database) return;
    const ref = admin.database().ref('audit_logs/leases').push();
    await ref.set({
      ...payload,
      at: admin.database.ServerValue.TIMESTAMP,
    });
  } catch (e) {
    console.warn('transferTenant: audit log write failed (non-fatal):', e && e.message ? e.message : e);
  }
}

exports.transferTenant = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth ────────────────────────────────────────────────────────────────
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token.admin !== true) {
      throw new functions.https.HttpsError('permission-denied',
        'Admin claim required to transfer a tenant');
    }

    // ── Input validation ────────────────────────────────────────────────────
    const input = await _validateInput(data);
    const callerUid = context.auth.uid;
    const callerEmail = String(context.auth.token.email || '');

    const firestore = admin.firestore();

    const runner = input.mode === 'variation' ? _runVariationMode : _runNovationMode;
    const result = await runner(input, callerUid, callerEmail, firestore);
    await _writeAuditLog(result.auditPayload);
    const { auditPayload, ...callerResult } = result;
    return callerResult;
  });

// Export internals for unit testing.
exports._validateInput = _validateInput;
exports._readTransferState = _readTransferState;
exports._runVariationMode = _runVariationMode;
exports._runNovationMode = _runNovationMode;
exports._updateLiffUserAndClaims = _updateLiffUserAndClaims;
exports._writeAuditLog = _writeAuditLog;
exports._carryIdentity = _carryIdentity;
exports._buildOldRoomClearPatch = _buildOldRoomClearPatch;
exports._resolveTenantName = _resolveTenantName;
exports._moveContractStorage = _moveContractStorage;
exports._VALID_MODES = VALID_MODES;
exports._ROOM_ID_RE = ROOM_ID_RE;
exports._IDENTITY_FIELDS = IDENTITY_FIELDS;
