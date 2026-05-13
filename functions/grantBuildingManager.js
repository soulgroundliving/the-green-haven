/**
 * grantBuildingManager — set or revoke the `managedBuildings` custom claim
 * on a Firebase Auth user, scoping them to one or more buildings.
 *
 * Called by: admin dashboard (future "Building Manager" panel) or the
 * companion CLI tool `tools/grant-building-manager.js`.
 *
 * SaaS prep: a building manager can read tenant, billing, and meter data
 * for their buildings without being a global admin. Firestore rules check
 * `isBuildingManager(building)` for read paths. Write paths still require
 * `isAdmin()`.
 *
 * Input:
 *   { targetUid: string, buildings: string[] }   ← grant / replace list
 *   { targetUid: string, buildings: [] }          ← revoke all (empty array)
 *
 * Caller must be a global admin (token.admin === true).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getValidBuildings } = require('./buildingRegistry');

if (!admin.apps.length) admin.initializeApp();

exports.grantBuildingManager = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth guard ──────────────────────────────────────────────────────────
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only global admins can grant building manager claims.'
      );
    }

    const { targetUid, buildings } = data || {};

    if (!targetUid || typeof targetUid !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid (string) is required.'
      );
    }
    if (!Array.isArray(buildings)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'buildings must be an array of building id strings.'
      );
    }

    // ── Validate each building id against the live registry ─────────────────
    const validBuildings = await getValidBuildings(admin.firestore());
    const invalid = buildings.filter(b => !validBuildings.has(b));
    if (invalid.length > 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Unknown building(s): ${invalid.join(', ')}. Valid: ${[...validBuildings].join(', ')}`
      );
    }

    // ── Fetch existing claims and merge ──────────────────────────────────────
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(targetUid);
    } catch (e) {
      throw new functions.https.HttpsError(
        'not-found',
        `No Firebase Auth user found for uid "${targetUid}": ${e.message}`
      );
    }

    const existingClaims = userRecord.customClaims || {};
    const next = { ...existingClaims };

    if (buildings.length === 0) {
      delete next.managedBuildings;
    } else {
      next.managedBuildings = buildings;
    }

    await admin.auth().setCustomUserClaims(targetUid, next);

    const action = buildings.length === 0 ? 'revoked' : `granted [${buildings.join(', ')}]`;
    console.log(`✅ grantBuildingManager: uid=${targetUid} managedBuildings ${action} by admin=${context.auth.uid}`);

    return {
      uid: targetUid,
      managedBuildings: buildings,
      note: 'User must sign out and back in (or force-refresh their ID token) for the new claim to take effect.'
    };
  });
