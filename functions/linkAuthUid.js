/**
 * linkAuthUid — bind a tenant's anonymous Firebase UID to their approved room.
 *
 * Called from tenant_app.html after LIFF verification confirms the tenant is
 * already approved in liffUsers. Sets two things:
 *
 *   1. Custom claims { room, building } on the anonymous Firebase Auth UID →
 *      RTDB rules can now scope bills/payments/maintenance per-room without
 *      cross-DB lookups.
 *
 *   2. linkedAuthUid = anonUid on the Firestore tenant doc →
 *      Firestore rules can scope tenant doc reads per-room once 4C tightening
 *      is complete.
 *
 * Auth: Bearer <Firebase anonymous ID token> (not admin — any signed-in user)
 * Body: { "lineUserId": "U..." }
 * Response: { "success": true, "room": "...", "building": "..." }
 *
 * Idempotent: safe to call on every LIFF open. sessionStorage caches the uid
 * so the client skips repeat calls within the same session.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const { verifyIdTokenFromHeader } = require('./_auth');

exports.linkAuthUid = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verify caller (any signed-in tenant) ──────────────────────────────────
  const decoded = await verifyIdTokenFromHeader(req, res);
  if (!decoded) return; // verifyIdTokenFromHeader already wrote 401

  const anonUid = decoded.uid;

  // ── Validate body ─────────────────────────────────────────────────────────
  const { lineUserId } = req.body || {};
  if (!lineUserId || typeof lineUserId !== 'string' || !/^U[0-9a-f]{32}$/.test(lineUserId)) {
    return res.status(400).json({ error: 'Body must include a valid lineUserId (U + 32 hex chars)' });
  }

  // ── Look up approved liffUsers record ─────────────────────────────────────
  const firestore = admin.firestore();
  let liffDoc;
  try {
    liffDoc = await firestore.collection('liffUsers').doc(lineUserId).get();
  } catch (e) {
    console.error('linkAuthUid: liffUsers read failed', e.message);
    return res.status(500).json({ error: 'Firestore read failed' });
  }

  if (!liffDoc.exists) {
    return res.status(404).json({ error: 'LINE account not found — submit a link request first' });
  }

  const liffData = liffDoc.data();
  if (liffData.status !== 'approved') {
    return res.status(403).json({ error: `Account not approved (status: ${liffData.status})` });
  }

  const room = String(liffData.room || '');
  const building = String(liffData.building || 'rooms');

  if (!room) {
    return res.status(500).json({ error: 'Approved liffUsers doc is missing room field' });
  }
  if (!['rooms', 'nest'].includes(building)) {
    return res.status(400).json({ error: `Unknown building: ${building}` });
  }

  // ── Set custom claims on the anonymous UID ────────────────────────────────
  // Claims: { room, building } — RTDB rules use these for per-room scoping.
  // Existing admin claim is NOT disturbed (this UID is anonymous, never admin).
  try {
    await admin.auth().setCustomUserClaims(anonUid, { room, building });
    console.log(`✅ linkAuthUid: uid=${anonUid} → ${building}/${room} (LINE ${lineUserId})`);
  } catch (e) {
    console.error('linkAuthUid: setCustomUserClaims failed', e.message);
    return res.status(500).json({ error: 'Failed to set claims' });
  }

  // ── Write linkedAuthUid to Firestore tenant doc ───────────────────────────
  // Used by Firestore rules once tenant-doc read is tightened (4C phase 2).
  try {
    await firestore
      .collection('tenants').doc(building)
      .collection('list').doc(room)
      .update({ linkedAuthUid: anonUid, linkedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    // Non-fatal: tenant doc may not exist yet (room not created). Log and continue.
    console.warn(`linkAuthUid: could not write linkedAuthUid to tenants/${building}/list/${room}:`, e.message);
  }

  return res.status(200).json({ success: true, room, building });
});
