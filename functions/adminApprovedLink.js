/**
 * adminApprovedLink — admin-mediated LINE re-link for tenants who lost their
 * LINE access entirely (F2 scenario in lifecycle_tenant_transitions.md §F2).
 *
 * F1 (requestRoomRelink) handles tenants who still have LINE and re-submit
 * via LIFF. F2 handles tenants who changed phones or deleted their LINE
 * account — they cannot authenticate via LIFF at all.
 *
 * Flow:
 *   1. Admin verifies identity out-of-band (ID card, in-person, video call)
 *   2. Admin obtains tenant's new LINE userId (from new phone/LINE app)
 *   3. Admin calls this CF — pre-creates liffUsers/{newLineUserId} status='approved'
 *   4. Tenant opens LIFF → liffSignIn sees pre-approved doc → proceeds normally
 *
 * Security: admin-only callable. Abuse mitigated by mandatory evidenceNote
 * (non-empty, ≥10 chars) + RTDB audit log entry for every call.
 *
 * §7-FF note: does NOT call setCustomUserClaims/revokeRefreshTokens because
 * the new LINE user has no prior Firebase Auth record — claims are minted on
 * first successful liffSignIn.
 *
 * §NN: callable (not Firestore trigger) — Eventarc doesn't support SE3.
 *
 * Caller:  token.admin === true  (httpsCallable)
 * Region:  asia-southeast1
 *
 * Data:
 *   lineUserId      — tenant's new LINE user ID (string, starts with 'U', required)
 *   building        — building key ('rooms' | 'nest', required)
 *   room            — room ID, 1-30 alphanumeric+Thai chars (required)
 *   evidenceNote    — mandatory audit note ≥10 chars (required)
 *   lineDisplayName — tenant's new LINE display name (optional, from admin observation)
 *
 * Returns: { ok: true, lineUserId, building, room, status: 'approved' }
 */
'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const NOTIFY_URL = 'https://asia-southeast1-the-green-haven.cloudfunctions.net/notifyLiffRequest';

exports.adminApprovedLink = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    // ── Auth gate ─────────────────────────────────────────────────────────────
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only admins can perform a direct LINE link.'
      );
    }
    const adminUid = context.auth.uid;
    const adminEmail = String(context.auth.token.email || adminUid);

    // ── Validate inputs ───────────────────────────────────────────────────────
    const { lineUserId, building, room, evidenceNote, lineDisplayName } = data || {};

    if (!lineUserId || typeof lineUserId !== 'string' || !lineUserId.startsWith('U')) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'lineUserId must be a non-empty string starting with "U"'
      );
    }
    if (!building || typeof building !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'building (string) is required'
      );
    }
    const roomTrimmed = (typeof room === 'string' ? room : '').trim();
    if (!/^[A-Za-z0-9ก-๛_-]{1,30}$/.test(roomTrimmed)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'room must be 1-30 alphanumeric/Thai characters'
      );
    }
    const noteTrimmed = (typeof evidenceNote === 'string' ? evidenceNote : '').trim();
    if (noteTrimmed.length < 10) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'evidenceNote must be at least 10 characters (mandatory audit record)'
      );
    }

    const db = admin.firestore();

    // ── Validate building via registry ────────────────────────────────────────
    const { getValidBuildings } = require('./buildingRegistry');
    const validBuildings = await getValidBuildings(db);
    if (!validBuildings.has(building)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Unknown building: ${building}`
      );
    }

    // ── Tenant record must exist before linking ────────────────────────────────
    // Prevents linking a LINE to a vacant/non-existent room by mistake.
    const tenantRef = db
      .collection('tenants').doc(building)
      .collection('list').doc(roomTrimmed);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        `No tenant record at tenants/${building}/list/${roomTrimmed}. Add tenant first.`
      );
    }
    const tenantData = tenantSnap.data() || {};
    if (tenantData.linkedAuthUid) {
      // Non-fatal warning — admin may have already called unlinkLiffUser.
      // liffSignIn will overwrite linkedAuthUid on first login with the new UID.
      console.warn(
        `adminApprovedLink: ${building}/${roomTrimmed} has linkedAuthUid=${tenantData.linkedAuthUid}. ` +
        'Consider calling unlinkLiffUser first to avoid claim confusion.'
      );
    }

    // ── Guard: new LINE user must not already be approved for a different room ─
    const liffRef = db.collection('liffUsers').doc(lineUserId);
    const liffSnap = await liffRef.get();
    if (liffSnap.exists) {
      const existing = liffSnap.data() || {};
      if (
        existing.status === 'approved' &&
        (existing.building !== building || existing.room !== roomTrimmed)
      ) {
        throw new functions.https.HttpsError(
          'already-exists',
          `LINE user ${lineUserId} is already approved for ` +
          `${existing.building}/${existing.room}. Unlink first.`
        );
      }
    }

    // ── Write liffUsers doc ───────────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const FV = admin.firestore.FieldValue;
    const displayName = (
      (typeof lineDisplayName === 'string' ? lineDisplayName : '').trim() ||
      (liffSnap.exists ? String(liffSnap.data()?.lineDisplayName || '') : '')
    ).slice(0, 60);

    const payload = {
      lineUserId,
      lineDisplayName: displayName,
      building,
      room: roomTrimmed,
      status: 'approved',
      approvedAt: nowIso,
      approvedBy: adminEmail,
      // F2-specific audit fields — distinguish admin-direct from LIFF-flow approvals
      adminDirectLink: true,
      adminDirectLinkAt: nowIso,
      adminDirectLinkBy: adminEmail,
      adminDirectLinkNote: noteTrimmed,
      // Clear any prior rejection/terminal-state audit stamps
      rejectedAt: FV.delete(),
      rejectedBy: FV.delete(),
      rejectionReason: FV.delete(),
      unlinkedAt: FV.delete(),
      unlinkedBy: FV.delete(),
    };

    try {
      await liffRef.set(payload, { merge: true });
    } catch (e) {
      console.error('adminApprovedLink: liffUsers write failed:', e.message);
      throw new functions.https.HttpsError('internal', 'Firestore write failed');
    }

    // ── RTDB audit log — high-privilege action, always logged ─────────────────
    try {
      const auditRef = admin.database().ref('audit_logs/admin_direct_link').push();
      await auditRef.set({
        lineUserId,
        building,
        room: roomTrimmed,
        evidenceNote: noteTrimmed,
        adminUid,
        adminEmail,
        at: nowIso,
      });
    } catch (e) {
      // Non-fatal — Firestore write already committed; log the failure.
      console.error('adminApprovedLink: RTDB audit write failed:', e.message);
    }

    // ── Best-effort LINE push so tenant knows to open LIFF ───────────────────
    require('node-fetch')(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId }),
    }).catch(e => console.warn('adminApprovedLink: notify failed (non-fatal):', e.message));

    console.log(
      `adminApprovedLink: admin=${adminEmail} pre-approved ${lineUserId} ` +
      `for ${building}/${roomTrimmed} (F2 direct link)`
    );
    return { ok: true, lineUserId, building, room: roomTrimmed, status: 'approved' };
  });
