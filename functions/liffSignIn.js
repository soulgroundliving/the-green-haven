/**
 * liffSignIn — exchange a LIFF ID token for a Firebase custom token.
 *
 * Eliminates the anonymous-auth dependency from LIFF onboarding:
 *   1. Client gets LIFF ID token via liff.getIDToken()
 *   2. POSTs { idToken } to this endpoint (no Firebase auth required)
 *   3. CF verifies token with LINE's /verify API → extracts lineUserId (sub)
 *   4. Reads liffUsers/{lineUserId} server-side (admin SDK — bypasses Firestore rules)
 *   5. If approved: mints custom token with { room, building } claims embedded
 *   6. Client signInWithCustomToken(customToken) → non-anonymous, deterministic UID
 *
 * UID strategy: "line:" + lineUserId — stable across sessions, never clashes with
 * anonymous UIDs. Old anonymous UIDs (with {room, building} claims from linkAuthUid)
 * remain valid until cleanupAnonymousUsers removes them after liffSignIn is fully live.
 *
 * Auth: none — the LIFF ID token is the sole credential
 * Body: { "idToken": "<LIFF ID token>" }
 * Response 200: { customToken, room, building }
 * Response 403: { error, status }   (pending | rejected)
 * Response 404: { error }           (first-time user, no liffUsers doc)
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

if (!admin.apps.length) admin.initializeApp();

// LINE Login Channel ID — first segment of LIFF_ID '2009790149-Db7T76sd'.
// Used as client_id when verifying LIFF ID tokens with LINE's /verify endpoint.
const LINE_CHANNEL_ID = '2009790149';

exports.liffSignIn = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'Body must include idToken (string)' });
  }

  // ── Verify LIFF ID token with LINE ────────────────────────────────────────
  let lineUserId;
  try {
    const params = new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID });
    const lineRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const lineData = await lineRes.json();
    if (!lineRes.ok) {
      console.warn('liffSignIn: LINE verify rejected:', lineData);
      return res.status(401).json({ error: lineData.error_description || 'LIFF token verification failed' });
    }
    lineUserId = lineData.sub;
    if (!lineUserId) {
      return res.status(401).json({ error: 'LINE verify response missing sub' });
    }
  } catch (e) {
    console.error('liffSignIn: LINE verify call failed:', e.message);
    return res.status(500).json({ error: 'Could not reach LINE verify endpoint' });
  }

  // ── Look up approved liffUsers record (admin SDK — no rule dependency) ────
  const firestore = admin.firestore();
  let liffDoc;
  try {
    liffDoc = await firestore.collection('liffUsers').doc(lineUserId).get();
  } catch (e) {
    console.error('liffSignIn: liffUsers read failed:', e.message);
    return res.status(500).json({ error: 'Firestore read failed' });
  }

  if (!liffDoc.exists) {
    return res.status(404).json({ error: 'LINE account not registered — submit a link request first' });
  }

  const liffData = liffDoc.data();
  const status = liffData.status || 'pending';

  if (status !== 'approved') {
    return res.status(403).json({ error: `Account not approved (status: ${status})`, status });
  }

  const room = String(liffData.room || '');
  const building = String(liffData.building || 'rooms');

  if (!room) {
    return res.status(500).json({ error: 'Approved liffUsers doc is missing room field' });
  }
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(room)) {
    return res.status(400).json({ error: 'Invalid room format in liffUsers doc' });
  }
  if (!['rooms', 'nest'].includes(building)) {
    return res.status(400).json({ error: `Unknown building: ${building}` });
  }

  // ── Mint Firebase custom token ────────────────────────────────────────────
  // UID is deterministic per LINE user — stable across sessions.
  const uid = 'line:' + lineUserId;

  // Set displayName on the Auth user record so admins see "rooms/15 — John"
  // in Firebase Auth Console instead of "(-)". Non-fatal: if it fails the
  // sign-in still works, just the admin Console UX is poorer. Idempotent.
  const lineDisplayName = String(liffData.lineDisplayName || '').slice(0, 60);
  const displayName = `${building}/${room}${lineDisplayName ? ' — ' + lineDisplayName : ''}`;
  try {
    await admin.auth().updateUser(uid, { displayName });
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      try {
        await admin.auth().createUser({ uid, displayName });
      } catch (createErr) {
        console.warn('liffSignIn: createUser displayName failed (non-fatal):', createErr.message);
      }
    } else {
      console.warn('liffSignIn: updateUser displayName failed (non-fatal):', e.message);
    }
  }

  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(uid, { room, building });
    console.log(`✅ liffSignIn: uid=${uid} → ${building}/${room} (LINE ${lineUserId})`);
  } catch (e) {
    console.error('liffSignIn: createCustomToken failed:', e.message);
    return res.status(500).json({ error: 'Failed to create custom token' });
  }

  // ── Write linkedAuthUid to Firestore tenant doc ───────────────────────────
  // Non-fatal: keeps linkedAuthUid in sync for Firestore rules that scope per-room.
  try {
    await firestore
      .collection('tenants').doc(building)
      .collection('list').doc(room)
      .set({ linkedAuthUid: uid, linkedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn(`liffSignIn: could not write linkedAuthUid to tenants/${building}/list/${room}:`, e.message);
  }

  return res.status(200).json({ customToken, room, building });
});
