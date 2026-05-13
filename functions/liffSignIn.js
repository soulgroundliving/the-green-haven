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
const { getValidBuildings } = require('./buildingRegistry');

if (!admin.apps.length) admin.initializeApp();

// LINE Login Channel ID — first segment of LIFF_ID '2009790149-Db7T76sd'.
// Used as client_id when verifying LIFF ID tokens with LINE's /verify endpoint.
const LINE_CHANNEL_ID = '2009790149';

exports.liffSignIn = functions
  .region('asia-southeast1')
  .runWith({ minInstances: 1 })
  .https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  // Health check — Cloud Scheduler pings GET /liffSignIn every 5 min to keep warm
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', ts: Date.now() });
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

  // ── Community member (player) path ────────────────────────────────────────
  // transitionToPlayer CF sets liffUsers/{lineUserId}.role='player' so we can
  // detect returning community members without requiring room/building claims.
  if (liffData.role === 'player') {
    const uid = 'line:' + lineUserId;
    const tenantId = String(liffData.tenantId || '');

    // Fetch player identity from people/ (admin SDK — bypasses Firestore rules)
    // so the LIFF profile page can show name/phone without a client-side query.
    let playerName = '', playerPhone = '';
    if (tenantId) {
      try {
        const peopleSnap = await firestore.collection('people').doc(tenantId).get();
        if (peopleSnap.exists) {
          const pd = peopleSnap.data();
          playerName = String(pd.name || '');
          playerPhone = String(pd.phone || '');
        }
      } catch (e) {
        console.warn('liffSignIn: people lookup failed for player:', e.message);
      }
    }

    let playerToken;
    try {
      playerToken = await admin.auth().createCustomToken(uid, { role: 'player', tenantId });
      console.log(`✅ liffSignIn (player): uid=${uid} tenantId=${tenantId} LINE ${lineUserId}`);
    } catch (e) {
      console.error('liffSignIn: player token failed:', e.message);
      return res.status(500).json({ error: 'Failed to create player token' });
    }
    return res.status(200).json({ customToken: playerToken, role: 'player', tenantId, name: playerName, phone: playerPhone });
  }

  const room = String(liffData.room || '');
  const building = String(liffData.building || 'rooms');

  if (!room) {
    return res.status(500).json({ error: 'Approved liffUsers doc is missing room field' });
  }
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(room)) {
    return res.status(400).json({ error: 'Invalid room format in liffUsers doc' });
  }
  // Dynamic building validation — uses the same 5-min Firestore cache as other CFs.
  // Replaces the hardcoded ['rooms','nest'] so new buildings added via the admin
  // Buildings page are immediately accepted without a code deploy.
  const validBuildings = await getValidBuildings(firestore);
  if (!validBuildings.has(building)) {
    return res.status(400).json({ error: `Unknown building: ${building}` });
  }

  // ── Mint Firebase custom token ────────────────────────────────────────────
  // UID is deterministic per LINE user — stable across sessions.
  const uid = 'line:' + lineUserId;

  // displayName update is cosmetic only (admin Console UX). Run it concurrently
  // with createCustomToken — createCustomToken does NOT require the Auth user to
  // pre-exist. This cuts the critical-path from 2 sequential Admin SDK RPCs to 1.
  const lineDisplayName = String(liffData.lineDisplayName || '').slice(0, 60);
  const displayName = `${building}/${room}${lineDisplayName ? ' — ' + lineDisplayName : ''}`;

  const displayNameUpdate = admin.auth().updateUser(uid, { displayName }).catch(async e => {
    if (e.code === 'auth/user-not-found') {
      await admin.auth().createUser({ uid, displayName }).catch(createErr =>
        console.warn('liffSignIn: createUser displayName failed (non-fatal):', createErr.message));
    } else {
      console.warn('liffSignIn: updateUser displayName failed (non-fatal):', e.message);
    }
  });

  let customToken;
  try {
    // Promise.all: displayNameUpdate (cosmetic) runs concurrently with createCustomToken (critical).
    [, customToken] = await Promise.all([
      displayNameUpdate,
      admin.auth().createCustomToken(uid, { room, building }),
    ]);
    console.log(`✅ liffSignIn: uid=${uid} → ${building}/${room} (LINE ${lineUserId})`);
  } catch (e) {
    console.error('liffSignIn: createCustomToken failed:', e.message);
    return res.status(500).json({ error: 'Failed to create custom token' });
  }

  // ── Write linkedAuthUid to Firestore tenant doc (fire-and-forget) ─────────
  // Guard: read status first — skip write if room is vacant so transitionToPlayer /
  // archiveTenantOnMoveOut blanks are not re-populated by a returning LINE user.
  firestore.collection('tenants').doc(building).collection('list').doc(room).get()
    .then(snap => {
      if (!snap.exists || (snap.data() || {}).status === 'vacant') {
        console.warn(`liffSignIn: ${building}/${room} is vacant — skipping linkedAuthUid write`);
        return;
      }
      return snap.ref.set(
        { linkedAuthUid: uid, linkedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    })
    .catch(e => console.warn(`liffSignIn: linkedAuthUid write failed for ${building}/${room}:`, e.message));

  return res.status(200).json({ customToken, room, building });
});
