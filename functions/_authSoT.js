/**
 * _authSoT — shared SoT crosscheck helpers for tenant-gated CFs.
 *
 * Ported from getLeaseDocUrl.js's 6-path auth model (commit b917860 + 8f4b41b)
 * + getChecklistMediaUrl.js (commit a9aa52d).
 *
 * Why this helper exists:
 *   §7-Z: `createCustomToken(uid, claims)` developer claims are EPHEMERAL —
 *         they disappear from the ID token after Firebase's ~1h auto-refresh
 *         unless `setCustomUserClaims` ALSO ran. Even with that fix shipped,
 *         legacy custom tokens minted before liffSignIn's `a5f4e5a` fix can
 *         still leak claim-loss for ~1h windows.
 *   §7-HH: Stale LIFF webview session can serve a cached random anon UID
 *          instead of `line:Uxxx`, making rule checks on uid drift.
 *
 *   Any CF that gates exclusively on `tok.room === roomId && tok.building ==
 *   building` becomes a latent ~1h time bomb. The fix is to fall back to a
 *   Firestore-side SoT check via `tenants/{building}/list/{roomId}.linkedAuthUid`
 *   or `.tenantId`. Either match means the caller IS the registered tenant
 *   of this room — regardless of what claims the cached ID token carries.
 *
 * Usage:
 *   const { assertTenantAccess } = require('./_authSoT');
 *
 *   await assertTenantAccess({
 *     building: canonicalBuilding,
 *     roomId:   String(roomId),
 *     context,
 *     firestore,
 *     HttpsError: functions.https.HttpsError,
 *   });
 *   // If we get here, caller is authorized. Proceed with read/write.
 *
 * @see getLeaseDocUrl.js   lines 50-130
 * @see getChecklistMediaUrl.js lines 50-120
 * @see CLAUDE.md §7-Z, §7-HH, §7-P
 */

'use strict';

/**
 * Throws HttpsError('permission-denied') unless the caller is authorized to
 * act on `tenants/{building}/list/{roomId}`. Authorization paths (first match
 * wins; admin paths skip the Firestore read entirely):
 *
 *   Path 0   admin claim
 *   Path 0b  building manager (`managedBuildings` claim includes building)
 *   Path 1   claim match (tok.room === roomId && tok.building === building)
 *   Path 1b  tenantId claim matches doc.tenantId
 *   Path 2a  linkedAuthUid matches auth.uid
 *   Path 1c  lease-doc-sot — when caller provides leaseId + leaseBuildings,
 *            iterate leases/{b}/list/{leaseId} across buildings and accept if
 *            ANY lease doc has tenantId === tok.tenantId. Closes the
 *            transferTenant-Storage-path-frozen bug: the Firestore lease moves
 *            across buildings on variation transfer but the Storage file path
 *            stays at the original building/room (e.g. leases/rooms/15/...),
 *            so when LIFF tenant reads the contract via getLeaseDocUrl, the
 *            path's building/room map to the OLD room (now vacant, cleared).
 *            Path 1c lets the moved tenant access their own contract by
 *            checking ownership at the LEASE level instead of the path level.
 *
 * @param {Object} opts
 * @param {string} opts.building   canonical building id ('rooms', 'nest', etc.)
 * @param {string} opts.roomId     canonical room id
 * @param {Object} opts.context    Firebase callable context (auth.uid + auth.token)
 * @param {Object} opts.firestore  admin.firestore() instance
 * @param {Function} opts.HttpsError  functions.https.HttpsError class
 * @param {string} [opts.leaseId]  optional — enables Path 1c lease-doc-sot lookup
 * @param {string[]} [opts.leaseBuildings]  optional — buildings to scan for the
 *   lease doc (caller resolves via buildingRegistry.getAllBuildings()).
 *   Required for Path 1c. Ignored if leaseId is empty.
 * @returns {Promise<{tenantData: Object | null, viaPath: string, leaseData?: Object}>}
 *   - tenantData is null for admin/manager paths (no Firestore read needed)
 *   - viaPath identifies which gate passed ('admin', 'manager', 'claim',
 *     'tenantId-sot', 'uid-sot', 'lease-doc-sot') — useful for logging
 *   - leaseData is the matched lease doc when viaPath === 'lease-doc-sot'
 */
async function assertTenantAccess({ building, roomId, context, firestore, HttpsError, leaseId, leaseBuildings }) {
  if (!context?.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  if (!building || !roomId) {
    throw new HttpsError('invalid-argument', 'building and roomId are required');
  }

  const tok = context.auth.token || {};
  if (tok.admin === true) return { tenantData: null, viaPath: 'admin' };

  // Path 0b — building manager (SaaS prep role)
  const managedBuildings = Array.isArray(tok.managedBuildings) ? tok.managedBuildings : [];
  if (managedBuildings.includes(building)) {
    return { tenantData: null, viaPath: 'manager' };
  }

  // Path 1 — claim match (fast path, no Firestore read)
  if (tok.room === roomId && tok.building === building) {
    return { tenantData: null, viaPath: 'claim' };
  }

  // Paths 1b / 2a — Firestore SoT crosscheck
  let tenantSnap;
  try {
    tenantSnap = await firestore
      .collection('tenants').doc(building)
      .collection('list').doc(roomId)
      .get();
  } catch (e) {
    console.error('[_authSoT] tenant doc read failed for',
      `${building}/${roomId}`, '—', e.message);
    throw new HttpsError('permission-denied',
      'Token claims do not match and tenant doc lookup failed');
  }
  if (!tenantSnap.exists) {
    throw new HttpsError('permission-denied',
      `No tenant doc at tenants/${building}/list/${roomId} — relink request may be needed`);
  }

  const tenantData = tenantSnap.data() || {};
  const linkedAuthUid = String(tenantData.linkedAuthUid || '');
  const docTenantId   = String(tenantData.tenantId      || '');
  const tokTenantId   = String(tok.tenantId             || '');
  const uidMatch      = linkedAuthUid && linkedAuthUid === context.auth.uid;
  const tenantIdMatch = tokTenantId && docTenantId && tokTenantId === docTenantId;

  if (uidMatch)      return { tenantData, viaPath: 'uid-sot' };
  if (tenantIdMatch) return { tenantData, viaPath: 'tenantId-sot' };

  // Path 1c — lease-doc-sot. See JSDoc above for the transferTenant-Storage-
  // path-frozen story. Only fires when the caller (e.g. getLeaseDocUrl) opts
  // in by passing both leaseId and leaseBuildings.
  const lid = String(leaseId || '');
  const lbList = Array.isArray(leaseBuildings) ? leaseBuildings.filter(Boolean) : [];
  if (lid && tokTenantId && lbList.length) {
    for (const b of lbList) {
      try {
        const leaseSnap = await firestore
          .collection('leases').doc(b)
          .collection('list').doc(lid)
          .get();
        if (!leaseSnap.exists) continue;
        const leaseData = leaseSnap.data() || {};
        const leaseTenantId = String(leaseData.tenantId || '');
        if (leaseTenantId && leaseTenantId === tokTenantId) {
          return { tenantData, viaPath: 'lease-doc-sot', leaseData };
        }
      } catch (e) {
        console.warn('[_authSoT] lease doc lookup failed for',
          `${b}/list/${lid}`, '—', e.message);
      }
    }
  }

  // Diagnostic-only error — shape info, no full UID/tenantId leaked.
  const linkedShape = linkedAuthUid
    ? (linkedAuthUid.startsWith('line:') ? 'line:' :
       linkedAuthUid.startsWith('book:') ? 'book:' : 'other')
    : 'empty';
  const callerShape = String(context.auth.uid || '').startsWith('line:') ? 'line:' :
                      String(context.auth.uid || '').startsWith('book:') ? 'book:' : 'other';
  throw new HttpsError('permission-denied',
    `Tenant SoT check failed for ${building}/${roomId}: ` +
    `linkedAuthUid=${linkedShape}, caller.uid=${callerShape}, ` +
    `tokTenantId=${tokTenantId ? 'present' : 'missing'}, ` +
    `docTenantId=${docTenantId ? 'present' : 'missing'}, ` +
    `tenantIdMatch=${tenantIdMatch}, uidMatch=${uidMatch}`);
}

/**
 * Resolve a tenant's (building, roomId) from auth claims with people/{tenantId}
 * fallback. Use this in CFs whose work depends on KNOWING building+roomId
 * (e.g., exportMyData), not just authorizing a specific pair.
 *
 *   Path A — tok.room + tok.building present → use directly
 *   Path B — tok.tenantId present, people/{tenantId} has .room + .building → use
 *
 * After resolution, the result is NOT yet authorized — caller must still run
 * `assertTenantAccess(resolved)` to verify ownership (defense in depth).
 *
 * @returns {Promise<{building: string, roomId: string, resolvedVia: 'claim' | 'people-doc' | 'none'}>}
 */
async function resolveTenantClaims({ context, firestore, HttpsError }) {
  if (!context?.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }
  const tok = context.auth.token || {};
  let building = String(tok.building || '');
  let roomId   = String(tok.room     || '');
  let resolvedVia = 'none';

  if (building && roomId) {
    resolvedVia = 'claim';
    return { building, roomId, resolvedVia };
  }

  const tenantId = String(tok.tenantId || '');
  if (tenantId) {
    try {
      const peopleSnap = await firestore.collection('people').doc(tenantId).get();
      if (peopleSnap.exists) {
        const p = peopleSnap.data() || {};
        // People docs store currentBuilding/currentRoom (+ activeBuilding/activeRoom),
        // written by transferTenant et al. — never a bare `building`/`room`. Read the
        // canonical names first; bare building/room/roomId are legacy fallbacks only.
        // Without this, the §7-Z claim-strip fallback never resolved (#2, 2026-06-13).
        const pBuilding = String(p.currentBuilding || p.activeBuilding || p.building || '');
        const pRoom     = String(p.currentRoom || p.activeRoom || p.room || p.roomId || '');
        if (pBuilding && pRoom) {
          building = pBuilding;
          roomId   = pRoom;
          resolvedVia = 'people-doc';
        }
      }
    } catch (e) {
      console.warn('[_authSoT] people doc read failed for', tenantId, '—', e.message);
    }
  }

  return { building, roomId, resolvedVia };
}

module.exports = { assertTenantAccess, resolveTenantClaims };
