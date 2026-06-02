/**
 * recordAdminAction — append an admin action to the immutable actionAudit log.
 *
 * The hybrid (Phase 1.1) logger for admin mutations that happen CLIENT-SIDE
 * (dashboard writes Firestore/RTDB directly): the client calls this callable
 * right after the write succeeds. Actions that are already Cloud Functions
 * (verifySlip payment) log in-tx instead, via appendActionAudit directly — they
 * don't need this callable.
 *
 * WHY a callable (not trusting shared/audit.js localStorage): the previous audit
 * log was per-browser localStorage — mutable, clearable, invisible to an auditor.
 * This stamps actor / role / ip / time SERVER-SIDE from the verified auth context,
 * so the record cannot be forged by the client. See _actionAudit.js.
 *
 * Region: asia-southeast1 (matches the other CFs). §7-NN: callable, not a Firestore
 * trigger (project Firestore is in SE3 where Eventarc triggers can't deploy).
 * Auth: admin claim required (context.auth.token.admin === true) — the house gate.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { appendActionAudit, VALID_ACTIONS } = require('./_actionAudit');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();

// Cap caller-supplied before/after so a bug or abuse can't bloat the log.
const MAX_SNAPSHOT_CHARS = 8000;
const NOTE_MAX = 500;

function capSnapshot(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  let s;
  try { s = JSON.stringify(v); } catch (_) { return null; }
  if (s.length > MAX_SNAPSHOT_CHARS) return { _truncated: true, _chars: s.length };
  return v;
}

function resolveIp(context) {
  const req = context.rawRequest;
  if (!req) return null;
  const raw = req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
  if (!raw) return null;
  // x-forwarded-for can be "client, proxy1, proxy2" — the client is the first hop.
  return String(raw).split(',')[0].trim() || null;
}

exports.recordAdminAction = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  const tok = context.auth.token || {};
  if (tok.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin claim required to record an admin action');
  }

  const { action, targetType, targetId, building, roomId, before, after, note } = data || {};

  if (!action || !VALID_ACTIONS.has(action)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `action must be one of: ${[...VALID_ACTIONS].join(', ')}`,
    );
  }
  if (!targetType || typeof targetType !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'targetType is required');
  }

  try {
    // appendActionAudit is writer-agnostic; a one-doc batch keeps validation in
    // the single shared helper (same path verifySlip's in-tx write will use).
    const batch = firestore.batch();
    appendActionAudit(batch, firestore, {
      // actor / role / ip / source are stamped from the VERIFIED context — never `data`.
      actor:      context.auth.uid,
      actorEmail: tok.email || null,
      actorRole:  tok.admin === true ? 'admin' : (tok.role || null),
      action,
      targetType: String(targetType),
      targetId:   targetId != null ? String(targetId) : null,
      building:   building != null ? String(building) : null,
      roomId:     roomId != null ? String(roomId) : null,
      before:     capSnapshot(before),
      after:      capSnapshot(after),
      ip:         resolveIp(context),
      source:     'recordAdminAction',
      note:       note != null ? String(note).slice(0, NOTE_MAX) : null,
    });
    await batch.commit();
    return { ok: true };
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('[recordAdminAction] failed to write audit row:', e && e.message);
    throw new functions.https.HttpsError('internal', 'Failed to record admin action');
  }
});
