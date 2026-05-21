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
    // Path 0b — building manager (SaaS prep role; see firestore.rules
    // isBuildingManager helper). Granted via grantBuildingManager CF / tool.
    const managedBuildings = Array.isArray(tok.managedBuildings) ? tok.managedBuildings : [];
    const isBuildingManager = managedBuildings.includes(building);

    if (!isAdmin && !isBuildingManager) {
      // Path 1 — claim match (preferred; no Firestore read needed).
      const claimsMatch = tok.room === roomId && tok.building === building;
      // Path 1b — tenantId claim match. Survives anon-UID rotation AND room
      // claims being stripped (§7-Z window) as long as tenantId persists.
      // Also handles legacy admin grants that set tenantId but not room.
      const tokTenantId = String(tok.tenantId || '');

      if (!claimsMatch) {
        // Path 2 — Firestore SoT cross-check via two SoT fields:
        //   (a) linkedAuthUid == auth.uid (current LIFF session's UID), OR
        //   (b) tenantId == auth.token.tenantId (claim survived UID rotation).
        // Either match means the caller IS the registered tenant of this room
        // per Firestore SoT, regardless of what claims the cached ID token
        // happens to carry right now.
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
        if (!tenantSnap.exists) {
          throw new functions.https.HttpsError(
            'permission-denied',
            `No tenant doc at tenants/${building}/list/${roomId} — relink request may be needed`,
          );
        }
        const tenantData = tenantSnap.data() || {};
        const linkedAuthUid = String(tenantData.linkedAuthUid || '');
        const docTenantId = String(tenantData.tenantId || '');
        const uidMatch = linkedAuthUid && linkedAuthUid === context.auth.uid;
        const tenantIdMatch = tokTenantId && docTenantId && tokTenantId === docTenantId;

        if (!uidMatch && !tenantIdMatch) {
          // Build diagnostic-only message — no full UID/tenantId values leaked,
          // just shape info. Tells caller exactly which gate failed so the
          // client can show actionable guidance instead of generic denial.
          const linkedShape = linkedAuthUid
            ? (linkedAuthUid.startsWith('line:') ? 'line:' : (linkedAuthUid.startsWith('book:') ? 'book:' : 'other'))
            : 'empty';
          const callerShape = String(context.auth.uid || '').startsWith('line:') ? 'line:'
            : (String(context.auth.uid || '').startsWith('book:') ? 'book:' : 'other');
          throw new functions.https.HttpsError(
            'permission-denied',
            `Tenant SoT check failed for ${building}/${roomId}: ` +
            `linkedAuthUid=${linkedShape}, caller.uid=${callerShape}, ` +
            `tokTenantId=${tokTenantId ? 'present' : 'missing'}, ` +
            `docTenantId=${docTenantId ? 'present' : 'missing'}, ` +
            `tenantIdMatch=${tenantIdMatch}, uidMatch=${uidMatch}`,
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
