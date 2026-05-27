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
    console.info(`getLeaseDocUrl[in]: path=${path} parsed=${building}/${roomId} ` +
      `leaseId=${leaseId} caller.uid=${String(context.auth.uid || '').slice(0, 20)} ` +
      `tokRoom=${context.auth.token?.room || ''} tokBuilding=${context.auth.token?.building || ''} ` +
      `tokTenantId=${context.auth.token?.tenantId ? 'present' : 'missing'} ` +
      `leaseBuildings=[${leaseBuildings.join(',')}]`);
    let viaPath;
    try {
      const r = await assertTenantAccess({
        building, roomId, leaseId, leaseBuildings,
        context, firestore: admin.firestore(),
        HttpsError: functions.https.HttpsError,
      });
      viaPath = r.viaPath;
      const matchedAt = r.leaseData
        ? ` matchedAt=leases/${r.leaseData.building || '?'}/list/${leaseId}`
        : '';
      console.info(`getLeaseDocUrl[ok]: viaPath=${viaPath}${matchedAt}`);
    } catch (authErr) {
      // Path 1d — current-tenant-contract fallback (lease-file-specific).
      //
      // After all 6 generic paths in _authSoT fail, check ONE more thing: does
      // the caller's CURRENT tenant doc (per their claims) actually have this
      // exact file as their lease contract? If yes, the file IS the tenant's
      // current contract — regardless of how the path's building/room/leaseId
      // ended up frozen (renewal, transfer, renewal-after-transfer cascade).
      //
      // Why this is safe:
      //   - Caller's identity is verified via claims (Firebase Auth signed token)
      //   - We only allow the EXACT path stored as their contractPath; can't
      //     access arbitrary files
      //   - tenantId double-check defends against UID rotation drift
      //
      // Why _authSoT generic paths fail this case:
      //   - Path 1/1b: claims have new building/room, but path's building/room
      //     point at old/cleared tenant doc → no match
      //   - Path 1c: lease doc lookup by path's leaseId fails when the lease was
      //     replaced by renewal AND the old renewed lease was later deleted
      //     (cleanup, transferTenant in some edge cases, manual ops)
      //   - Path 2a: linkedAuthUid at old room is empty (post-transfer state)
      const tok = context.auth.token || {};
      const tokTenantId = String(tok.tenantId || '');
      const tokBuilding = String(tok.building || '');
      const tokRoom     = String(tok.room     || '');
      if (tokTenantId && tokBuilding && tokRoom) {
        try {
          const currTenantSnap = await admin.firestore()
            .collection('tenants').doc(tokBuilding)
            .collection('list').doc(tokRoom)
            .get();
          if (currTenantSnap.exists) {
            const td = currTenantSnap.data() || {};
            const ownerOk = String(td.tenantId || '') === tokTenantId;
            const docMatch = path === String(td.contractDocument || '');
            const leasePathMatch = path === String(td.lease?.contractPath || '');
            if (ownerOk && (docMatch || leasePathMatch)) {
              viaPath = 'current-tenant-contract';
              console.info(`getLeaseDocUrl[ok]: viaPath=${viaPath} ` +
                `at=tenants/${tokBuilding}/list/${tokRoom} ` +
                `matched=${docMatch ? 'contractDocument' : 'lease.contractPath'}`);
            }
          }
        } catch (e) {
          console.warn(`getLeaseDocUrl: Path 1d lookup failed (${tokBuilding}/${tokRoom}):`, e.message);
        }
      }
      if (!viaPath) {
        console.info(`getLeaseDocUrl[deny]: ${authErr.message}`);
        throw authErr;
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
