/**
 * getLeaseDocUrl — mint a short-lived signed URL for a tenant's lease document.
 *
 * Why this exists:
 *   Firebase client SDK's getDownloadURL() returns a tokenised URL that
 *   bypasses Storage rules and lives forever — a leaked link lets anyone read
 *   the contract indefinitely. We issue a v4 signed URL capped at 1 hour so
 *   a leaked link expires quickly (PDPA pattern, same as getChecklistMediaUrl).
 *
 * Auth gates (3 paths — first one that passes wins):
 *   • Admin claim, OR
 *   • Tenant whose (room, building) custom-token claims match the path segments
 *     (claim-based gate survives anon-UID rotation, anti-pattern P), OR
 *   • Tenant whose linkedAuthUid in tenants/{b}/list/{r} matches context.auth.uid
 *     (server-side cross-check — handles claim drift after §7-Z window when the
 *     ID token auto-refreshes and persistent claims weren't set, but the user is
 *     still the registered tenant of that room per Firestore SoT).
 *
 * Input:   { path: "leases/{building}/{roomId}/{leaseId}/{fileName}" }
 * Returns: { url, expiresAt }   url is a v4 signed URL valid for 1 h
 *
 * @see storage.rules — match /leases/{building}/{roomId}/{leaseId}/{fileName}
 * @see getChecklistMediaUrl.js — same pattern, with extra Firestore cross-check
 */
'use strict';
const functions = require('firebase-functions/v1');
const admin     = require('firebase-admin');

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
    const [, building, roomId] = m;

    const tok = context.auth.token || {};
    const isAdmin = tok.admin === true;

    if (!isAdmin) {
      // Path 1 — claim match (preferred; no Firestore read needed).
      const claimsMatch = tok.room === roomId && tok.building === building;

      if (!claimsMatch) {
        // Path 2 — Firestore SoT cross-check. Tenant's claims may have drifted
        // (admin re-issued claims, token auto-refresh after §7-Z window without
        // setCustomUserClaims call, anon-UID rotated, etc.) but they are still
        // the registered tenant of the room per tenants/{b}/list/{r}.
        // Storage rules can't do this cross-check; the CF can.
        const firestore = admin.firestore();
        let tenantSnap;
        try {
          tenantSnap = await firestore
            .collection('tenants').doc(building)
            .collection('list').doc(roomId)
            .get();
        } catch (e) {
          console.error('getLeaseDocUrl: tenant doc read failed for',
            `${building}/${roomId}`, '—', e.message);
          throw new functions.https.HttpsError(
            'permission-denied',
            'Token claims do not match and tenant doc lookup failed',
          );
        }
        const tenantData = tenantSnap.exists ? (tenantSnap.data() || {}) : {};
        const linkedAuthUid = String(tenantData.linkedAuthUid || '');
        if (!linkedAuthUid || linkedAuthUid !== context.auth.uid) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Token claims do not match the requested lease path and tenant doc linkedAuthUid is not this user',
          );
        }
        // SoT match — caller is the linked tenant of this room.
      }
    }

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
