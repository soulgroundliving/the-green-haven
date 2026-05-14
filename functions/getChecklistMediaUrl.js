/**
 * getChecklistMediaUrl — mint a short-lived signed URL for a checklist asset
 * (item photo, tenant signature, admin signature) instead of returning the
 * permanent `getDownloadURL` token.
 *
 * Why this exists:
 *   Firebase client SDK's getDownloadURL() returns a tokenised URL that
 *   bypasses Storage rules and lives forever — if an admin pastes it
 *   anywhere (Line chat, email, screenshot upload, etc.) any recipient can
 *   read the underlying file indefinitely. For PDPA-sensitive content
 *   (tenant signatures + room photos) we issue an Admin-SDK signed URL
 *   capped at 1 hour, so a leaked link expires quickly.
 *
 * Auth gates (same shape as storage.rules → easy to audit side-by-side):
 *   • Admin claim, OR
 *   • Tenant whose (room, building) custom claims match the path AND the
 *     instance doc at that path agrees with those claims.
 *
 * Input:   { path: "checklists/{building}/{roomId}/{instanceId}/{fileName}" }
 * Returns: { url, expiresAt }   url is a v4 signed URL valid 1 h
 *
 * @see storage.rules — match /checklists/{building}/{roomId}/{instanceId}/{fileName}
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const SIGNED_URL_TTL_MS = 60 * 60 * 1000;   // 1 hour
const PATH_PATTERN = /^checklists\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_ก-๛-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/;

exports.getChecklistMediaUrl = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const path = String(data?.path || '');
    const m = PATH_PATTERN.exec(path);
    if (!m) {
      throw new functions.https.HttpsError('invalid-argument',
        'path must be checklists/{building}/{roomId}/{instanceId}/{fileName}');
    }
    const [, building, roomId, instanceId] = m;

    const tok = context.auth.token || {};
    const isAdmin = tok.admin === true;

    if (!isAdmin) {
      // Tenant path — both the claims and the instance doc must agree with the
      // requested path. Mirrors storage.rules so the auth surface is identical.
      if (tok.room !== roomId || tok.building !== building) {
        throw new functions.https.HttpsError('permission-denied',
          'Token claims do not match the requested path');
      }
      const snap = await firestore.collection('checklistInstances').doc(instanceId).get();
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Instance not found');
      }
      const inst = snap.data() || {};
      if (inst.building !== building || inst.roomId !== roomId) {
        throw new functions.https.HttpsError('permission-denied',
          'Instance does not belong to the requested room');
      }
    }

    // Mint v4 signed URL via Admin SDK. Limited-action GET; signed by the
    // SA's IAM identity (no need for a key file — runs as the function's SA).
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
    let url;
    try {
      const file = admin.storage().bucket().file(path);
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAt,
      });
      url = signedUrl;
    } catch (err) {
      console.error('getChecklistMediaUrl: signed URL failed for', path, '—', err.message);
      throw new functions.https.HttpsError('internal', 'Failed to mint signed URL');
    }

    return { url, expiresAt };
  });

// Exported for tests
exports.PATH_PATTERN = PATH_PATTERN;
exports.SIGNED_URL_TTL_MS = SIGNED_URL_TTL_MS;
