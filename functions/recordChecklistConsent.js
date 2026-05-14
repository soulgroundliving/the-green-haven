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
 * Auth: tenant — must have room+building claims (linkAuthUid path) OR be
 *       signed in via the LIFF custom-token path (which carries the same).
 * Input:  { purpose: 'checklist_v1', noticeVersion: 'v1' }
 * Returns: { recorded: true, consentedAt }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const VALID_PURPOSES = new Set(['checklist_v1']);

exports.recordChecklistConsent = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const tok = context.auth.token || {};
    const room     = String(tok.room     || '');
    const building = String(tok.building || '');
    const tenantId = String(tok.tenantId || '') || `uid:${context.auth.uid}`;

    if (!room || !building) {
      throw new functions.https.HttpsError('permission-denied',
        'room and building claims required');
    }

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
