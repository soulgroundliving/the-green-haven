/**
 * setAdminClaim — set admin:true custom claim on a Firebase Auth user.
 *
 * Two bootstrap paths (checked in order):
 *   1. X-Init-Token header matching INIT_TOKEN env var — single-use bootstrap
 *      when NO admin has a custom claim yet. Remove INIT_TOKEN from .env after
 *      all admins are provisioned.
 *   2. Authorization: Bearer <idToken> where the decoded token already has
 *      admin:true — ongoing management (admin grants another admin).
 *
 * Body (JSON): { "email": "admin@example.com" }
 * Response:    { "success": true, "uid": "...", "email": "..." }
 *
 * NOTE: after this CF runs for an email, that user must sign out and back in
 * to pick up the new claim in their ID token. Then Stage 2 can flip the rules
 * from isAdminOrEmail() → isAdmin().
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
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

  // ── Auth path 1: X-Init-Token bootstrap ──────────────────────────────────
  const initToken = (req.get('X-Init-Token') || '').trim();
  const envToken = (process.env.INIT_TOKEN || '').trim();

  let authed = false;

  if (initToken && envToken && initToken === envToken) {
    authed = true;
    console.log('🔑 setAdminClaim: bootstrap via INIT_TOKEN');
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
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Body must be JSON { "email": "..." } with a valid email' });
  }

  // ── Set claim ─────────────────────────────────────────────────────────────
  try {
    const user = await admin.auth().getUserByEmail(email.trim().toLowerCase());
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log(`✅ setAdminClaim: admin:true set on uid=${user.uid} email=${email}`);
    return res.status(200).json({ success: true, uid: user.uid, email: user.email });
  } catch (e) {
    console.error('setAdminClaim error:', e.code, e.message);
    if (e.code === 'auth/user-not-found') {
      return res.status(404).json({ error: `No Firebase Auth user found for email: ${email}` });
    }
    return res.status(500).json({ error: 'Failed to set custom claim', detail: e.message });
  }
});
