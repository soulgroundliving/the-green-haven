/**
 * recordChecklistConsent — tenant logs their PDPA consent for the checklist
 * feature (Section 19 of พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล: explicit consent
 * before processing personal data).
 *
 * Why we record this server-side and not just localStorage:
 *   localStorage is per-device. A device wipe / new LIFF install loses the
 *   record. PDPA enforcement may require us to demonstrate consent — so we
 *   ALSO mint a server-side ledger row at consents/{tenantId}_{purpose}.
 *
 * Auth: tenant — verified via _authSoT 6-path model:
 *       admin / managedBuildings / claim match / tenantId-sot / linkedAuthUid-sot.
 *       Building/room is resolved via claims, then people-doc fallback,
 *       so the consent write survives §7-Z claim-strip windows.
 * Input:  { purpose: 'checklist_v1' | 'account_v1' | 'reputation_v1', noticeVersion: 'v1' }
 *         account_v1    = whole-app PDPA acceptance (privacy notice + ToS),
 *                         recorded once on tenant first-run (shared/tenant-consent.js).
 *         reputation_v1 = explicit consent to be shown the server-computed
 *                         Reputation tier badge (Phase 3.2a v1.x, tenant-reputation.js).
 * Returns: { recorded: true, consentedAt }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { resolveTenantClaims, assertTenantAccess } = require('./_authSoT');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_PURPOSES = new Set(['checklist_v1', 'account_v1', 'reputation_v1']);

exports.recordChecklistConsent = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    // Resolve building/room from claims OR people-doc fallback (§7-Z survives
    // claim strip after ~1h ID token refresh). Then verify the caller is
    // the registered tenant of the resolved room via assertTenantAccess.
    const { building, roomId: room } = await resolveTenantClaims({
      context, firestore, HttpsError: functions.https.HttpsError,
    });
    if (!building || !room) {
      throw new functions.https.HttpsError('permission-denied',
        'Unable to resolve room/building — claims missing and people-doc lookup empty');
    }
    await assertTenantAccess({
      building, roomId: room,
      context, firestore, HttpsError: functions.https.HttpsError,
    });

    const tok = context.auth.token || {};
    const tenantId = String(tok.tenantId || '') || `uid:${context.auth.uid}`;

    const purpose = String(data?.purpose || '');
    if (!VALID_PURPOSES.has(purpose)) {
      throw new functions.https.HttpsError('invalid-argument',
        `Unknown purpose: ${purpose}`);
    }
    const noticeVersion = String(data?.noticeVersion || 'v1').slice(0, 16);

    const docId = `${tenantId}_${purpose}`;
    const ref   = firestore.collection('consents').doc(docId);
    const payload = {
      tenantId,
      authUid:      context.auth.uid,
      room,
      building,
      purpose,
      noticeVersion,
      consentedAt:  admin.firestore.FieldValue.serverTimestamp(),
      // Audit context — handy when responding to a future DSR request
      userAgent:    String(data?.userAgent || '').slice(0, 256),
    };
    try {
      await ref.set(payload, { merge: true });
    } catch (err) {
      console.error('recordChecklistConsent: write failed:', err.message);
      throw new functions.https.HttpsError('internal', 'Failed to record consent');
    }

    return { recorded: true, consentedAt: Date.now(), docId };
  });

exports.VALID_PURPOSES = VALID_PURPOSES;
