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
 *
 * @param {Object} opts
 * @param {string} opts.building   canonical building id ('rooms', 'nest', etc.)
 * @param {string} opts.roomId     canonical room id
 * @param {Object} opts.context    Firebase callable context (auth.uid + auth.token)
 * @param {Object} opts.firestore  admin.firestore() instance
 * @param {Function} opts.HttpsError  functions.https.HttpsError class
 * @returns {Promise<{tenantData: Object | null, viaPath: string}>}
 *   - tenantData is null for admin/manager paths (no Firestore read needed)
 *   - viaPath identifies which gate passed ('admin', 'manager', 'claim',
 *     'tenantId-sot', 'uid-sot') — useful for logging
 */
async function assertTenantAccess({ building, roomId, context, firestore, HttpsError }) {
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
        const pBuilding = String(p.building || '');
        const pRoom     = String(p.room     || p.roomId || '');
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
