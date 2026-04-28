/**
 * setAdminClaim — set admin:true custom claim on a Firebase Auth user.
 *
 * Two bootstrap paths (checked in order):
 *   1. X-Init-Token header matching INIT_TOKEN env var — single-use bootstrap.
 *      AUTO-LOCKED once any admin exists in the project: even if INIT_TOKEN is
 *      still set, the path returns 403. This defends against post-bootstrap
 *      INIT_TOKEN leaks. For the very first admin, prefer
 *      tools/grant-admin-claim.js (uses ADC, never sends a secret over HTTP).
 *   2. Authorization: Bearer <idToken> where the decoded token already has
 *      admin:true — ongoing management (admin grants another admin).
 *
 * Body (JSON): { "email": "admin@example.com" }
 * Response:    { "success": true, "uid": "...", "email": "..." }
 *
 * NOTE: after this CF runs for an email, that user must sign out and back in
 * to pick up the new claim in their ID token.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Returns true if any user in the project already has admin:true claim.
 * Used to lock the INIT_TOKEN bootstrap path post-launch — even if the token
 * leaks (logs / .env backup / screenshot), a second admin can't be minted via
 * curl. Bearer flow (path 2) becomes the only way in.
 *
 * Pages through all users; bails out on the first match. For projects with
 * thousands of users this is still <1s because the first admin is typically
 * in the first page (created early).
 */
async function hasAnyAdmin() {
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.customClaims && u.customClaims.admin === true) return true;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return false;
}

exports.setAdminClaim = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Init-Token');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth path 1: X-Init-Token bootstrap (locked once any admin exists) ───
  const initToken = (req.get('X-Init-Token') || '').trim();
  const envToken = (process.env.INIT_TOKEN || '').trim();

  let authed = false;

  if (initToken && envToken && initToken === envToken) {
    // Lockdown: the INIT_TOKEN path is intended ONLY for first-time bootstrap.
    // Once an admin exists, force the Bearer flow so a leaked INIT_TOKEN can't
    // be replayed to mint additional admins.
    let adminAlready;
    try {
      adminAlready = await hasAnyAdmin();
    } catch (e) {
      console.error('setAdminClaim: hasAnyAdmin lookup failed:', e.message);
      return res.status(500).json({ error: 'Could not verify project admin state' });
    }
    if (adminAlready) {
      console.warn('🔒 setAdminClaim: INIT_TOKEN rejected — an admin already exists; use Bearer flow');
      return res.status(403).json({
        error: 'INIT_TOKEN bootstrap locked: an admin already exists. Use Authorization: Bearer <admin idToken>.'
      });
    }
    authed = true;
    console.log('🔑 setAdminClaim: bootstrap via INIT_TOKEN (no admin yet)');
  }

  // ── Auth path 2: Bearer idToken with admin:true claim ────────────────────
  if (!authed) {
    const authHeader = req.get('Authorization') || req.get('authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Missing auth: provide X-Init-Token header or Bearer idToken with admin claim' });
    }
    try {
      const decoded = await admin.auth().verifyIdToken(match[1].trim());
      if (decoded.admin !== true) {
        return res.status(403).json({ error: 'Caller does not have admin custom claim' });
      }
      authed = true;
      console.log(`🔑 setAdminClaim: called by existing admin ${decoded.email}`);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired ID token' });
    }
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const { email, role = 'admin' } = req.body || {};
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Body must be JSON { "email": "...", "role": "admin"|"accountant" }' });
  }
  if (!['admin', 'accountant'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "accountant"' });
  }

  // ── Set claim ─────────────────────────────────────────────────────────────
  const claims = role === 'accountant' ? { accountant: true } : { admin: true };
  try {
    const user = await admin.auth().getUserByEmail(email.trim().toLowerCase());
    await admin.auth().setCustomUserClaims(user.uid, claims);
    console.log(`✅ setAdminClaim: ${JSON.stringify(claims)} set on uid=${user.uid} email=${email}`);
    return res.status(200).json({ success: true, uid: user.uid, email: user.email, claims });
  } catch (e) {
    console.error('setAdminClaim error:', e.code, e.message);
    if (e.code === 'auth/user-not-found') {
      return res.status(404).json({ error: `No Firebase Auth user found for email: ${email}` });
    }
    return res.status(500).json({ error: 'Failed to set custom claim', detail: e.message });
  }
});
