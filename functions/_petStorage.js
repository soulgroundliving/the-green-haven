/**
 * _petStorage — Storage cleanup helper for pet photos + vaccine books.
 *
 * Pet uploads land at:
 *   storage://pets/{building}/{roomId}/{petId}/{kind}_{ts}.{ext}
 * (see tenant_app.html `_uploadPetFile`). When admin archives a tenant via
 * `archiveTenantOnMoveOut`, the Firestore subcollection pet docs are moved
 * to `tenants/{b}/archive/{contractId}/pets/*` but Storage files are NEVER
 * touched — they accumulate forever and remain readable (per the storage
 * rule `allow read: if isSignedIn()` as of 2026-05-23). This module is the
 * §7-DD analogue for Storage: called post-batch by lifecycle CFs so the
 * deletion symmetric to Firestore archival ships.
 *
 * Why post-batch (not inside the Firestore batch):
 *   Firestore batches don't span Storage. The archive batch is the canonical
 *   audit record; a transient Storage error must not roll back the archive.
 *   Callers invoke this AFTER `batch.commit()` with `.catch(e => console.error)`.
 *
 * Why trailing slash on the prefix is REQUIRED (§7-DD analogue A5 unit test):
 *   `bucket.getFiles({ prefix: 'pets/rooms/1' })` matches BOTH `pets/rooms/1/*`
 *   AND `pets/rooms/15/*` AND `pets/rooms/123/*` — every room whose id starts
 *   with '1'. With the trailing slash `pets/rooms/1/` only `pets/rooms/1/*`
 *   matches. The path-construction enforces this; do NOT remove the literal
 *   trailing '/' or the unit test will catch it but only after a regression.
 *
 * Why allSettled (not Promise.all):
 *   One failed delete (auth blip, transient 5xx) must not skip the rest. Per-
 *   file error accounting is returned so callers can log without blowing up.
 *
 * Why exception-tolerant on getFiles failure:
 *   If the Storage SDK itself fails (initialization, IAM), we log and return
 *   `deletedCount: 0` so the lifecycle CF caller keeps running. The Firestore
 *   archive already committed — symmetry is desired but not load-bearing.
 *
 * Called by:
 *   - functions/archiveTenantOnMoveOut.js (full move-out — Storage cleared)
 *   - functions/deletePetMedia.js (admin "🗑️ Remove" — Phase B3 wrapper)
 *
 * Intentionally NOT called by:
 *   - functions/transitionToPlayer.js — reversible via revertTransitionToPlayer,
 *     keep Storage so revert can restore the photos. PII concern for the next
 *     tenant of the same room is handled separately by storage.rules tightening
 *     (Phase C1 — read gated on token.room/token.building match).
 *   - functions/revertTransitionToPlayer.js — Storage was kept, nothing to do.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

/**
 * Delete every Storage file under `pets/{building}/{roomId}/`.
 *
 * @param {string} building     Canonical building id ('rooms' | 'nest' | other registered).
 * @param {string} roomId       Room identifier — used as path segment exactly as written.
 * @param {object} [opts]
 * @param {string} [opts.reason='lifecycle_cleanup']  Logged with each result for audit.
 *
 * @returns {Promise<{ deletedCount: number, totalFiles: number, errors: Array<{name: string, error: string}> }>}
 *   Resolves regardless of failures so callers can fire-and-forget.
 *   `deletedCount` ≤ `totalFiles`. `errors` is per-file (empty array on full success).
 *
 * @throws {Error}  Only on missing/empty building or roomId (programmer error
 *                  — wide-prefix delete would be catastrophic so we fail loud).
 */
async function deletePetStorageForRoom(building, roomId, opts = {}) {
  const reason = String(opts.reason || 'lifecycle_cleanup');

  // Shape guard — prevents accidental whole-bucket scan via empty prefix.
  // (`bucket.getFiles({ prefix: 'pets/' })` would list every pet across every
  // room of every building, then delete them all if we naively continued.)
  if (typeof building !== 'string' || building.length === 0) {
    throw new Error('deletePetStorageForRoom: building must be non-empty string');
  }
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('deletePetStorageForRoom: roomId must be non-empty string');
  }

  // Trailing-slash terminator — see header doc on the prefix-bug class.
  const prefix = `pets/${building}/${roomId}/`;

  const bucket = admin.storage().bucket();

  let files;
  try {
    [files] = await bucket.getFiles({ prefix });
  } catch (err) {
    console.warn(
      `[_petStorage] getFiles failed for ${prefix} (reason=${reason}):`,
      err.message || err
    );
    return { deletedCount: 0, totalFiles: 0, errors: [{ name: prefix, error: err.message || String(err) }] };
  }

  if (!files.length) {
    return { deletedCount: 0, totalFiles: 0, errors: [] };
  }

  const results = await Promise.allSettled(
    files.map(f => f.delete({ ignoreNotFound: true }))
  );

  const errors = [];
  let deletedCount = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      deletedCount += 1;
    } else {
      errors.push({
        name: files[i].name,
        error: r.reason?.message || String(r.reason),
      });
    }
  });

  return { deletedCount, totalFiles: files.length, errors };
}

/**
 * Delete every Storage file under `pets/{building}/{roomId}/{petId}/`.
 *
 * Used by `deletePetMedia` CF when admin clicks "🗑️ Remove" on the admin
 * pet-approvals queue — symmetrical Storage cleanup so the per-pet remove
 * matches the room-wide cleanup that archive uses.
 *
 * @param {string} building     Canonical building id.
 * @param {string} roomId       Room identifier.
 * @param {string} petId        Pet doc id (matches Firestore subcollection key).
 * @param {object} [opts]
 * @param {string} [opts.reason='admin_remove']
 *
 * @returns {Promise<{ deletedCount: number, totalFiles: number, errors: Array }>}
 * @throws {Error}  On missing/empty building, roomId, or petId.
 */
async function deletePetStorageForPet(building, roomId, petId, opts = {}) {
  const reason = String(opts.reason || 'admin_remove');

  if (typeof building !== 'string' || building.length === 0) {
    throw new Error('deletePetStorageForPet: building must be non-empty string');
  }
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('deletePetStorageForPet: roomId must be non-empty string');
  }
  if (typeof petId !== 'string' || petId.length === 0) {
    throw new Error('deletePetStorageForPet: petId must be non-empty string');
  }

  const prefix = `pets/${building}/${roomId}/${petId}/`;
  const bucket = admin.storage().bucket();

  let files;
  try {
    [files] = await bucket.getFiles({ prefix });
  } catch (err) {
    console.warn(
      `[_petStorage] getFiles failed for ${prefix} (reason=${reason}):`,
      err.message || err
    );
    return { deletedCount: 0, totalFiles: 0, errors: [{ name: prefix, error: err.message || String(err) }] };
  }

  if (!files.length) {
    return { deletedCount: 0, totalFiles: 0, errors: [] };
  }

  const results = await Promise.allSettled(
    files.map(f => f.delete({ ignoreNotFound: true }))
  );

  const errors = [];
  let deletedCount = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      deletedCount += 1;
    } else {
      errors.push({
        name: files[i].name,
        error: r.reason?.message || String(r.reason),
      });
    }
  });

  return { deletedCount, totalFiles: files.length, errors };
}

module.exports = {
  deletePetStorageForRoom,
  deletePetStorageForPet,
};
