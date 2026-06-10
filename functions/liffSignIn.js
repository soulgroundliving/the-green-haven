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
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getValidBuildings } = require('./buildingRegistry');

if (!admin.apps.length) admin.initializeApp();

// LINE Login Channel ID — first segment of LIFF_ID '2009790149-Db7T76sd'.
// Used as client_id when verifying LIFF ID tokens with LINE's /verify endpoint.
const LINE_CHANNEL_ID = '2009790149';

exports.liffSignIn = functions
  .region('asia-southeast1')
  // No minInstances — keepLiffWarm pings this every 5 min (< the ~15-min idle
  // timeout) so it stays warm at ~$0. A 24/7 idle min-instance was the
  // "Min Instance Memory Tier 2" SKU = ~40% of the GCP bill (removed 2026-06-10).
  .https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://the-green-haven.vercel.app');
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
    } catch (e) {
      console.error('liffSignIn: player token failed:', e.message);
      return res.status(500).json({ error: 'Failed to create player token' });
    }
    // Persist claims on the user record so they survive ID-token refresh
    // (see comment in tenant path below — same Firebase-Auth quirk).
    admin.auth().setCustomUserClaims(uid, { role: 'player', tenantId })
      .catch(e => console.warn('liffSignIn: player setCustomUserClaims failed (non-fatal):', e.message));
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

  // Read tenant doc in parallel with displayName update (both non-critical-chain).
  // We need tenantId from the doc so it can be embedded in the custom token claim,
  // enabling the people/{tenantId} Firestore rule to gate reads via
  // request.auth.token.tenantId == tenantId (claims-stable, no UID-drift risk).
  const tenantDocRef = firestore.collection('tenants').doc(building).collection('list').doc(room);
  let tenantSnap = null;
  try {
    [, tenantSnap] = await Promise.all([
      displayNameUpdate,
      tenantDocRef.get().catch(() => null),
    ]);
  } catch (_) {}

  const tenantData = tenantSnap?.exists ? (tenantSnap.data() || {}) : {};
  const tenantId = String(tenantData.tenantId || '');

  let customToken;
  try {
    // Embed { room, building, tenantId } claims so client-side Firestore rules
    // can gate people/{tenantId} reads without UID-drift issues (§7-P).
    customToken = await admin.auth().createCustomToken(uid, { room, building, tenantId });
  } catch (e) {
    console.error('liffSignIn: createCustomToken failed:', e.message);
    return res.status(500).json({ error: 'Failed to create custom token' });
  }

  // ── Persist claims on the user record so they SURVIVE ID-token refresh ────
  // createCustomToken developer-claims are EPHEMERAL: they live only in the
  // first ID token returned by signInWithCustomToken. After the Firebase Auth
  // SDK auto-refreshes (~1h), the new ID token is minted from the user record
  // — without these claims unless setCustomUserClaims has been called too.
  // Without this, every tenant feature that depends on token.room/.building
  // (bills, maintenance, checklist, anything claim-gated) silently breaks
  // ~1h after a fresh LIFF sign-in. Fire-and-forget — non-blocking.
  admin.auth().setCustomUserClaims(uid, { room, building, tenantId })
    .catch(e => console.warn('liffSignIn: setCustomUserClaims failed (non-fatal):', e.message));

  // ── Write linkedAuthUid to Firestore (fire-and-forget) ────────────────────
  // Guard: skip vacant rooms so transitionToPlayer / archiveTenantOnMoveOut
  // blanks are not re-populated by a returning LINE user.
  if (tenantSnap?.exists && tenantData.status !== 'vacant') {
    const linkedUpdate = {
      linkedAuthUid: uid,
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Write to tenant doc (existing behaviour)
    tenantSnap.ref.set(linkedUpdate, { merge: true })
      .catch(e => console.warn(`liffSignIn: tenants linkedAuthUid write failed:`, e.message));
    // Also write to people/{tenantId} so the people/ Firestore rule
    // (resource.data.linkedAuthUid == request.auth.uid) resolves correctly.
    if (tenantId) {
      firestore.collection('people').doc(tenantId)
        .set(linkedUpdate, { merge: true })
        .catch(e => console.warn(`liffSignIn: people/${tenantId} linkedAuthUid write failed:`, e.message));
    }
  } else if (!tenantSnap) {
    // tenantDocRef.get() failed above — fall back to a fresh read (original behaviour)
    tenantDocRef.get()
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
  } else {
    console.warn(`liffSignIn: ${building}/${room} is vacant — skipping linkedAuthUid write`);
  }

  return res.status(200).json({ customToken, room, building });
});
