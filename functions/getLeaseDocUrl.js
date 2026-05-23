/**
 * getLeaseDocUrl — mint a short-lived signed URL for a tenant's lease document.
 *
 * Why this exists:
 *   Firebase client SDK's getDownloadURL() returns a tokenised URL that
 *   bypasses Storage rules and lives forever — a leaked link lets anyone read
 *   the contract indefinitely. We issue a v4 signed URL capped at 1 hour so
 *   a leaked link expires quickly (PDPA pattern, same as getChecklistMediaUrl).
 *
 * Auth gates: 6-path SoT crosscheck via _authSoT.assertTenantAccess —
 *   admin / managedBuildings / claim / tenantId-sot / linkedAuthUid-sot.
 *   See _authSoT.js for the canonical template; this CF was the original
 *   inline implementation that the helper was extracted from.
 *
 * Input:   { path: "leases/{building}/{roomId}/{leaseId}/{fileName}" }
 * Returns: { url, expiresAt }   url is a v4 signed URL valid for 1 h
 *
 * @see storage.rules — match /leases/{building}/{roomId}/{leaseId}/{fileName}
 * @see _authSoT.js — assertTenantAccess
 * @see getChecklistMediaUrl.js — same pattern + extra instance-doc check
 */
'use strict';
const functions = require('firebase-functions/v1');
const admin     = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { getAllBuildings } = require('./buildingRegistry');

if (!admin.apps.length) admin.initializeApp();

const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1 hour
// Accepts building IDs like 'rooms', 'nest', 'amazon'; room IDs like '15', 'N405'.
const PATH_PATTERN = /^leases\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_ก-๛-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/;

exports.getLeaseDocUrl = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const path = String(data?.path || '');
    const m = PATH_PATTERN.exec(path);
    if (!m) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'path must be leases/{building}/{roomId}/{leaseId}/{fileName}',
      );
    }
    const [, building, roomId, leaseId] = m;

    // 6-path auth gate via _authSoT helper: admin / managedBuildings / claim /
    // tenantId-sot / linkedAuthUid-sot / lease-doc-sot. See _authSoT.js for
    // the canonical template; this CF was the original inline implementation
    // that the helper was extracted from (commit b917860 + 8f4b41b + a9aa52d).
    //
    // Path 1c (lease-doc-sot) enabled by passing leaseId + leaseBuildings —
    // catches the transferTenant-Storage-path-frozen case where the path
    // points at the OLD room (now vacant) but the lease moved across
    // buildings. Without this, transferred tenants get permission-denied on
    // their own contract until the Storage file is moved manually.
    const leaseBuildings = await getAllBuildings();
    await assertTenantAccess({
      building, roomId, leaseId, leaseBuildings,
      context, firestore: admin.firestore(),
      HttpsError: functions.https.HttpsError,
    });

    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    let url;
    try {
      const [signedUrl] = await admin.storage().bucket().file(path).getSignedUrl({
        version: 'v4',
        action : 'read',
        expires: expiresAt,
      });
      url = signedUrl;
    } catch (err) {
      console.error('getLeaseDocUrl: signed URL failed for', path, '—', err.message);
      throw new functions.https.HttpsError('internal', 'Failed to mint signed URL');
    }

    return { url, expiresAt };
  });

// Exported for tests
exports.PATH_PATTERN      = PATH_PATTERN;
exports.SIGNED_URL_TTL_MS = SIGNED_URL_TTL_MS;
