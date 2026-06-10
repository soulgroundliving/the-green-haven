/**
 * liffBookingSignIn — exchange a LIFF ID token for a Firebase custom token
 * scoped to the BOOKING flow (prospects, not yet tenants).
 *
 * Why a separate CF (not reuse liffSignIn):
 *   - liffSignIn requires an approved liffUsers/{lineUserId} doc (existing
 *     tenant flow). Prospects don't have one yet — they're shopping.
 *   - liffSignIn mints a token with {room, building} claims for tenant access.
 *     Prospects shouldn't get those — they should only access bookings/*.
 *
 * UID strategy: "book:" + lineUserId (different namespace from "line:" tenant
 * UIDs). Means a tenant can independently sign into both tenant_app.html
 * (line:UID) and booking.html (book:UID) on the same browser without one
 * stomping the other's claims at token-refresh time.
 *
 * Auth: none — the LIFF ID token is the sole credential
 * Body: { "idToken": "<LIFF ID token>" }
 * Response 200: { customToken, lineUserId, displayName }
 * Response 4xx: { error }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// LINE Login Channel ID — same channel as liffSignIn (single LIFF app, route
// based separation between tenant_app.html and booking.html).
const LINE_CHANNEL_ID = '2009790149';

// Allowed origins — only the Vercel deployment may call this CF.
// Matches liffSignIn.js; wildcard was the original value (fixed).
const ALLOWED_ORIGIN = 'https://the-green-haven.vercel.app';

// Rate limit: max 10 sign-ins per lineUserId per rolling hour.
// Stored in rateLimits/booking_<lineUserId> (cleaned up by cleanupOldDocs daily).
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;

async function _checkRateLimit(lineUserId) {
  const fs = admin.firestore();
  const ref = fs.collection('rateLimits').doc(`booking_${lineUserId}`);
  const now = Date.now();
  let exceeded = false;
  await fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let count = 1;
    let windowStart = now;
    if (snap.exists) {
      const d = snap.data();
      const start = d.windowStart ? d.windowStart.toMillis() : 0;
      if (now - start < RATE_WINDOW_MS) {
        count = (d.count || 0) + 1;
        windowStart = start;
      }
    }
    exceeded = count > RATE_MAX;
    tx.set(ref, {
      count,
      windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  return exceeded;
}

exports.liffBookingSignIn = functions
  .region('asia-southeast1')
  // No minInstances — keepLiffWarm pings this every 5 min (< the ~15-min idle
  // timeout) so it stays warm at ~$0. A 24/7 idle min-instance was the
  // "Min Instance Memory Tier 2" SKU = ~40% of the GCP bill (removed 2026-06-10).
  .https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  // Health check — Cloud Scheduler pings GET /liffBookingSignIn every 5 min to keep warm
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', ts: Date.now() });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'Body must include idToken (string)' });
  }

  // ── Verify LIFF ID token with LINE ─────────────────────────────────────
  let lineUserId;
  let lineDisplayName = '';
  try {
    const params = new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID });
    const lineRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const lineData = await lineRes.json();
    if (!lineRes.ok) {
      console.warn('liffBookingSignIn: LINE verify rejected:', lineData);
      return res.status(401).json({ error: lineData.error_description || 'LIFF token verification failed' });
    }
    lineUserId = lineData.sub;
    lineDisplayName = String(lineData.name || '').slice(0, 60);
    if (!lineUserId) {
      return res.status(401).json({ error: 'LINE verify response missing sub' });
    }
  } catch (e) {
    console.error('liffBookingSignIn: LINE verify call failed:', e.message);
    return res.status(500).json({ error: 'Could not reach LINE verify endpoint' });
  }

  // Rate limit: 10 sign-ins per lineUserId per hour
  try {
    const exceeded = await _checkRateLimit(lineUserId);
    if (exceeded) {
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in an hour.' });
    }
  } catch (e) {
    console.warn('liffBookingSignIn: rate-limit check failed (non-fatal):', e.message);
  }

  // UID prefix "book:" keeps prospect Auth user separate from tenant Auth user
  // (which uses "line:" prefix in liffSignIn). Same LINE account → two Firebase
  // Auth users, no claim collision.
  const uid = 'book:' + lineUserId;

  // NOTE: displayName update intentionally skipped — updateUser + createUser were
  // 2 sequential Admin SDK calls adding 3-15s on cold start for a new user.
  // Firebase Auth creates the user lazily on signInWithCustomToken; displayName
  // is cosmetic only and can be patched later if needed.

  // Mint custom token with role:'prospect' claim. createBookingLock CF gates
  // on this — random signed-in users (e.g. tenants on tenant_app) cannot
  // create bookings without going through liffBookingSignIn first.
  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(uid, {
      role: 'prospect',
      lineUserId,
    });
    // Persist claims on the user record so token refreshes keep them (§7-Z).
    admin.auth().setCustomUserClaims(uid, { role: 'prospect', lineUserId })
      .catch(e => console.warn('liffBookingSignIn: setCustomUserClaims failed (non-fatal):', e.message));
  } catch (e) {
    console.error('liffBookingSignIn: createCustomToken failed:', e.message);
    return res.status(500).json({ error: 'Failed to create custom token' });
  }

  return res.status(200).json({
    customToken,
    lineUserId,
    displayName: lineDisplayName,
  });
});
