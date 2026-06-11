/**
 * _petSocialCleanup — shared deletion helpers for the Pet Social Graph (#10).
 *
 * petProfiles/{petId} and petLinks/{linkId} are TOP-LEVEL collections, so they
 * do NOT ride the pet doc's lifecycle automatically (§7-DD: a state-transition
 * CF must update every sibling collection downstream readers fall through to).
 * Three callers need to tear them down:
 *   - upsertPetProfile (opt-out)        → cleanupLinksForPet(petId)
 *   - archiveTenantOnMoveOut (move-out)  → cleanupPetSocialByTenant(tenantId)
 *   - requestDataDeletion (PDPA §32)     → cleanupPetSocialByTenant(tenantId)
 *
 * Every query is single-field (no composite index, §7-J/N-safe). Best-effort:
 * each query is independently try/caught and returns counts, never throws — the
 * callers are fire-and-forget (archive) or error-collecting (erasure).
 */

'use strict';

const PAGE_SIZE = 300;

/** Delete every doc in a snapshot, best-effort. Returns the deleted count. */
async function _deleteSnap(snap, label) {
  if (!snap || snap.empty) return 0;
  // Single-page sweep (matches the project-wide requestDataDeletion convention);
  // unreachable at this feature's scale (a pet/tenant has well under PAGE_SIZE
  // edges) but surface a truncation so a future data anomaly isn't silent.
  if (snap.docs.length >= PAGE_SIZE) {
    console.warn(`[petSocialCleanup] PAGE_SIZE(${PAGE_SIZE}) hit${label ? ` for ${label}` : ''} — some docs may remain`);
  }
  let n = 0;
  for (const doc of snap.docs) {
    try { await doc.ref.delete(); n++; }
    catch (_) { /* best-effort — a single failed delete must not abort the sweep */ }
  }
  return n;
}

/**
 * Remove every friend edge touching `petId` (both directions). Used when a pet
 * opts OUT of the directory — unfriending it everywhere.
 * @returns {Promise<number>} edges deleted
 */
async function cleanupLinksForPet(firestore, petId) {
  const id = String(petId || '');
  if (!id) return 0;
  let n = 0;
  for (const field of ['petA', 'petB']) {
    try {
      const snap = await firestore.collection('petLinks')
        .where(field, '==', id).limit(PAGE_SIZE).get();
      n += await _deleteSnap(snap, `petLinks.${field}=${id}`);
    } catch (_) { /* best-effort */ }
  }
  return n;
}

/**
 * Remove a tenant's entire pet-social footprint: every public profile they own
 * + every friend edge they're a party to. Keyed on the canonical tenantId
 * (the same id petProfiles.ownerTenantId / petLinks.requester|recipientTenantId
 * are stamped with, matching consents + trustScores).
 * @returns {Promise<{ profiles: number, links: number }>}
 */
async function cleanupPetSocialByTenant(firestore, tenantId) {
  const tid = String(tenantId || '');
  if (!tid) return { profiles: 0, links: 0 };

  let profiles = 0;
  try {
    const snap = await firestore.collection('petProfiles')
      .where('ownerTenantId', '==', tid).limit(PAGE_SIZE).get();
    profiles = await _deleteSnap(snap, `petProfiles.ownerTenantId=${tid}`);
  } catch (_) { /* best-effort */ }

  let links = 0;
  for (const field of ['requesterTenantId', 'recipientTenantId']) {
    try {
      const snap = await firestore.collection('petLinks')
        .where(field, '==', tid).limit(PAGE_SIZE).get();
      links += await _deleteSnap(snap, `petLinks.${field}=${tid}`);
    } catch (_) { /* best-effort */ }
  }

  return { profiles, links };
}

module.exports = { cleanupLinksForPet, cleanupPetSocialByTenant, PAGE_SIZE };
