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
 * Auth gates (6 paths — first one that passes wins; matches getLeaseDocUrl.js):
 *   • Path 0  — admin claim, OR
 *   • Path 0b — building manager (`managedBuildings` claim) for this building, OR
 *   • Path 1  — tenant whose (room, building) claims match the path, OR
 *   • Path 1b — tenant whose `tenantId` claim matches the room's tenant doc
 *               (survives anon-UID rotation AND room-claim drift), OR
 *   • Path 2a — tenant whose `linkedAuthUid` in tenants/{b}/list/{r} matches
 *               context.auth.uid (server-side SoT, survives claim drift entirely)
 *
 *   After path-auth passes, we still require the instance doc at the
 *   requested instanceId to live at the same building+roomId — protects
 *   against directory-traversal-like reads of another room's checklist
 *   via the same auth token.
 *
 * Input:   { path: "checklists/{building}/{roomId}/{instanceId}/{fileName}" }
 * Returns: { url, expiresAt }   url is a v4 signed URL valid 1 h
 *
 * @see storage.rules — match /checklists/{building}/{roomId}/{instanceId}/{fileName}
 * @see getLeaseDocUrl.js — same 6-path template
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
    // Path 0b — building manager (SaaS prep role).
    const managedBuildings = Array.isArray(tok.managedBuildings) ? tok.managedBuildings : [];
    const isBuildingManager = managedBuildings.includes(building);

    if (!isAdmin && !isBuildingManager) {
      // Path 1 — claim match (preferred; no Firestore read needed).
      const claimsMatch = tok.room === roomId && tok.building === building;
      // Path 1b — tenantId claim survives anon-UID rotation and room-claim drift.
      const tokTenantId = String(tok.tenantId || '');

      if (!claimsMatch) {
        // Path 2 — Firestore SoT cross-check via tenants/{b}/list/{r}:
        //   (a) linkedAuthUid == auth.uid, OR
        //   (b) doc.tenantId == auth.token.tenantId
        // Either match means caller IS the registered tenant of this room
        // regardless of what claims the cached ID token carries right now.
        let tenantSnap;
        try {
          tenantSnap = await firestore
            .collection('tenants').doc(building)
            .collection('list').doc(roomId)
            .get();
        } catch (e) {
          console.error('getChecklistMediaUrl: tenant doc read failed for',
            `${building}/${roomId}`, '—', e.message);
          throw new functions.https.HttpsError('permission-denied',
            'Token claims do not match and tenant doc lookup failed');
        }
        if (!tenantSnap.exists) {
          throw new functions.https.HttpsError('permission-denied',
            `No tenant doc at tenants/${building}/list/${roomId} — relink request may be needed`);
        }
        const tenantData = tenantSnap.data() || {};
        const linkedAuthUid = String(tenantData.linkedAuthUid || '');
        const docTenantId = String(tenantData.tenantId || '');
        const uidMatch = linkedAuthUid && linkedAuthUid === context.auth.uid;
        const tenantIdMatch = tokTenantId && docTenantId && tokTenantId === docTenantId;

        if (!uidMatch && !tenantIdMatch) {
          // Diagnostic-only message — shape info, no full UID/tenantId leaked.
          const linkedShape = linkedAuthUid
            ? (linkedAuthUid.startsWith('line:') ? 'line:' : (linkedAuthUid.startsWith('book:') ? 'book:' : 'other'))
            : 'empty';
          const callerShape = String(context.auth.uid || '').startsWith('line:') ? 'line:'
            : (String(context.auth.uid || '').startsWith('book:') ? 'book:' : 'other');
          throw new functions.https.HttpsError('permission-denied',
            `Tenant SoT check failed for ${building}/${roomId}: ` +
            `linkedAuthUid=${linkedShape}, caller.uid=${callerShape}, ` +
            `tokTenantId=${tokTenantId ? 'present' : 'missing'}, ` +
            `docTenantId=${docTenantId ? 'present' : 'missing'}, ` +
            `tenantIdMatch=${tenantIdMatch}, uidMatch=${uidMatch}`);
        }
        // SoT match — caller is the linked tenant of this room.
      }

      // Instance check — even after path auth, require the instance to live
      // at this exact building+roomId so a tenant of room 15 can't read
      // /checklists/rooms/15/<instance-from-room-16>/photo.jpg.
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
