/**
 * upsertPetProfile — a tenant opts a pet INTO (or OUT of) the building-visible
 * pet directory (Meaning Layer #10). Writes/deletes petProfiles/{petId}.
 *
 * Publish (isPublic:true):
 *   - the pet must be the caller's own (assertTenantAccess on its room) and
 *     status==='approved' (only admin-approved pets go public).
 *   - the caller must have recorded `pet_profile_v1` consent first — making a
 *     pet + its owner's room visible building-wide is a PDPA §19 disclosure, so
 *     the gate is enforced SERVER-side (the client can't bypass it). The badge
 *     flow calls recordChecklistConsent({purpose:'pet_profile_v1'}) before this.
 *   - the public doc carries ONLY the safe display fields (name/type/breed/
 *     gender/age/photo + an owner-written bio), copied from the pet doc
 *     server-side (anti-spoof — the client can't publish a fake name/photo).
 *     healthLog / vaccine / status NEVER leave the private pet doc.
 *
 * Opt-out (isPublic:false):
 *   - deletes petProfiles/{petId} and unfriends the pet everywhere
 *     (cleanupLinksForPet — top-level petLinks don't ride the pet lifecycle).
 *
 * §7-NN callable. Region asia-southeast1.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { buildProfileFields, sanitizeBio } = require('./_petSocialEngine');
const { cleanupLinksForPet } = require('./_petSocialCleanup');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

exports.upsertPetProfile = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }

  const { building, roomId, petId, bio, isPublic } = data || {};
  if (!building || !roomId || !petId) {
    throw new functions.https.HttpsError('invalid-argument', 'building, roomId and petId are required');
  }
  const canonicalBuilding = String(building).toLowerCase();
  if (!['rooms', 'nest'].includes(canonicalBuilding)) {
    throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
  }
  const room = String(roomId);
  const pid = String(petId);

  // Auth: caller must be the registered tenant of this room (claim or SoT).
  await assertTenantAccess({
    building: canonicalBuilding, roomId: room,
    context, firestore,
    HttpsError: functions.https.HttpsError,
  });

  const profileRef = firestore.collection('petProfiles').doc(pid);

  // ── Opt-out: delete the public profile + unfriend everywhere ──────────────
  // Verify ownership via the CF-written profile (ownerRoom/building) BEFORE
  // deleting — assertTenantAccess only proves the caller owns `room`, NOT that
  // `petId` belongs to it. Without this guard a tenant who knows another room's
  // petId could opt out that profile + wipe its friend edges (auth bypass).
  if (isPublic === false) {
    const existing = await profileRef.get();
    if (!existing.exists) {
      return { success: true, isPublic: false, removedLinks: 0 };   // idempotent no-op
    }
    const pd = existing.data() || {};
    if (pd.building !== canonicalBuilding || String(pd.ownerRoom) !== room) {
      throw new functions.https.HttpsError('permission-denied', 'สัตว์เลี้ยงนี้ไม่ใช่ของคุณ');
    }
    await profileRef.delete().catch((e) => {
      console.warn('upsertPetProfile: profile delete failed (non-fatal):', e.message);
    });
    const removedLinks = await cleanupLinksForPet(firestore, pid);
    return { success: true, isPublic: false, removedLinks };
  }

  // ── Publish: read the tenant + pet + existing-profile docs ────────────────
  const tenantRef = firestore.collection('tenants').doc(canonicalBuilding).collection('list').doc(room);
  const petRef = tenantRef.collection('pets').doc(pid);
  const [tenantSnap, petSnap, existingProfileSnap] = await Promise.all([
    tenantRef.get(), petRef.get(), profileRef.get(),
  ]);

  if (!petSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'ไม่พบสัตว์เลี้ยงนี้');
  }
  const petData = petSnap.data() || {};
  if (petData.status !== 'approved') {
    throw new functions.https.HttpsError('failed-precondition',
      'สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะแสดงในไดเรกทอรีได้');
  }

  // Canonical tenantId — the SoT tenant-doc value (matches consents/trustScores).
  const tenantData = tenantSnap.exists ? (tenantSnap.data() || {}) : {};
  const tenantId = String(tenantData.tenantId || context.auth.token?.tenantId || '')
    || `uid:${context.auth.uid}`;

  // PDPA §19 consent gate — must be recorded BEFORE going public (server-enforced).
  const consentSnap = await firestore.collection('consents')
    .doc(`${tenantId}_pet_profile_v1`).get().catch(() => null);
  if (!consentSnap || !consentSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition',
      'ต้องยินยอมก่อนแสดงสัตว์เลี้ยงในไดเรกทอรีอาคาร');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const safe = buildProfileFields(petData);
  const payload = {
    petId: pid,
    ownerTenantId: tenantId,
    ownerRoom: room,
    building: canonicalBuilding,
    ...safe,
    bio: sanitizeBio(bio) || null,
    updatedAt: now,
  };
  // createdAt only on first publish — merge keeps the original on re-publish.
  // (Two simultaneous first-publishes could each set createdAt and the later
  // merge wins by ms — cosmetic only; not worth a transaction here.)
  if (!existingProfileSnap.exists) {
    payload.createdAt = now;
  }

  await profileRef.set(payload, { merge: true });
  return { success: true, isPublic: true, petId: pid };
});
