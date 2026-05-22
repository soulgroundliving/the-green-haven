/**
 * exportMyData — DSR (Data Subject Right) export endpoint for tenants.
 *
 * Why: PDPA §30 grants every data subject the right to receive a copy of
 * their personal data in a machine-readable form. Without an API the only
 * channel is a manual admin export — slow and audit-unfriendly. This CF
 * compiles every personal-data location for the calling tenant into a
 * single JSON payload.
 *
 * Auth: tenant — verified via _authSoT 6-path model (admin / managedBuildings
 *       / claim / tenantId-sot / linkedAuthUid-sot). Building/room resolved
 *       via claims, then people-doc fallback, so the export survives §7-Z
 *       claim-strip windows. Tenant-scoped: returns ONLY their own data.
 *
 * Input:  none (the token identifies the caller)
 * Output: {
 *   subject:  { authUid, tenantId, room, building, exportedAt },
 *   person:   {...} | null,           // people/{tenantId}
 *   tenant:   {...} | null,           // tenants/{building}/list/{room}
 *   lease:    {...} | null,           // leases/{building}/list/{activeContractId}
 *   liffUser: {...} | null,           // liffUsers/{lineId} (sanitised)
 *   checklistInstances: [...],        // every doc where building+roomId match
 *   consents: [...],                  // consents/* for this tenantId
 *   complaints: [...],                // RTDB complaints/{building}/{room}
 *   maintenance: [...],               // RTDB maintenance/{building}/{room}
 *   bills: [...]                      // RTDB bills/{building}/{room}
 * }
 *
 * Storage assets (photos/signatures) are NOT inlined as base64 (would bloat
 * the response). Instead, each entry carries `storagePath`; the caller can
 * fetch a 1h signed URL via getChecklistMediaUrl. Listed in the response
 * shape so a future client can present a "download attached files" UI.
 *
 * Rate limit: this is an O(reads) operation. We don't enforce a hard limit
 * (tenant has only a handful of records) but we DO log every export call
 * for audit.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { resolveTenantClaims, assertTenantAccess } = require('./_authSoT');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

function _safeData(snap) {
  if (!snap || !snap.exists) return null;
  return snap.data() || null;
}

async function _safeRtdbObject(ref) {
  try {
    const snap = await ref.once('value');
    const val = snap.val();
    return val ? Object.entries(val).map(([id, v]) => ({ id, ...v })) : [];
  } catch (err) {
    console.warn('[exportMyData] RTDB read failed:', ref.toString(), err.message);
    return [];
  }
}

exports.exportMyData = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    const authUid   = context.auth.uid;
    const tok       = context.auth.token || {};
    const tenantId  = String(tok.tenantId || '');
    const lineUserId = String(tok.lineUserId || '') ||
                       (String(authUid).startsWith('line:') ? String(authUid).slice(5) : '');

    // Resolve building/room via claims OR people-doc fallback (§7-Z survival
    // window). Then verify ownership via _authSoT 6-path SoT crosscheck.
    const { building, roomId: room } = await resolveTenantClaims({
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });
    if (!building || !room) {
      throw new functions.https.HttpsError('permission-denied',
        'Unable to resolve tenant room/building — claims missing and people-doc lookup empty');
    }
    await assertTenantAccess({
      building, roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    const exportedAt = Date.now();
    console.log(`[exportMyData] uid=${authUid} tenantId=${tenantId} ${building}/${room}`);

    // ---- Firestore: person, tenant, lease, liffUser, consents ----
    const tenantRef = firestore.collection('tenants').doc(building).collection('list').doc(room);
    const tenantSnap = await tenantRef.get().catch(() => null);
    const tenantData = _safeData(tenantSnap);

    let personData = null;
    const effectiveTenantId = tenantId || String(tenantData?.tenantId || '');
    if (effectiveTenantId) {
      const personSnap = await firestore.collection('people').doc(effectiveTenantId).get().catch(() => null);
      personData = _safeData(personSnap);
    }

    let leaseData = null;
    const activeContractId = String(tenantData?.activeContractId || tenantData?.contractId || '');
    if (activeContractId) {
      const leaseSnap = await firestore
        .collection('leases').doc(building).collection('list').doc(activeContractId)
        .get().catch(() => null);
      leaseData = _safeData(leaseSnap);
    }

    let liffUserData = null;
    if (lineUserId) {
      const liffSnap = await firestore.collection('liffUsers').doc(lineUserId).get().catch(() => null);
      const raw = _safeData(liffSnap);
      if (raw) {
        // Sanitise — never return secret/internal tokens to the user-facing export
        const { liffIdToken, ...safe } = raw;
        liffUserData = safe;
      }
    }

    // ---- checklistInstances by room ----
    const checklistInstances = [];
    try {
      const q = await firestore.collection('checklistInstances')
        .where('building', '==', building)
        .where('roomId',   '==', room)
        .get();
      q.docs.forEach(d => checklistInstances.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[exportMyData] checklistInstances query failed:', err.message);
    }

    // ---- consents ledger ----
    const consents = [];
    if (effectiveTenantId) {
      try {
        const q = await firestore.collection('consents')
          .where('tenantId', '==', effectiveTenantId)
          .get();
        q.docs.forEach(d => consents.push({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn('[exportMyData] consents query failed:', err.message);
      }
    }

    // ---- RTDB: complaints, maintenance, bills ----
    const db = admin.database();
    const [complaints, maintenance, bills] = await Promise.all([
      _safeRtdbObject(db.ref(`complaints/${building}/${room}`)),
      _safeRtdbObject(db.ref(`maintenance/${building}/${room}`)),
      _safeRtdbObject(db.ref(`bills/${building}/${room}`)),
    ]);

    return {
      subject: {
        authUid,
        tenantId: effectiveTenantId || null,
        room,
        building,
        exportedAt,
      },
      person:             personData,
      tenant:             tenantData,
      lease:              leaseData,
      liffUser:           liffUserData,
      checklistInstances,
      consents,
      complaints,
      maintenance,
      bills,
      _note: 'Photos/signatures are NOT inlined. Use getChecklistMediaUrl with each storagePath to fetch a 1h URL.',
    };
  });
