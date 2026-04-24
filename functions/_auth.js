/**
 * Shared auth helpers for HTTP Cloud Functions.
 *
 * verifyIdTokenFromHeader: parse "Authorization: Bearer <idToken>", verify via
 * admin SDK, return decoded token or throw. Call this at the top of every
 * HTTP onRequest handler that should require a signed-in caller.
 *
 * requireAdmin: stricter variant — decoded token must belong to a non-anonymous
 * email user (mirrors firestore.rules isAdminOrEmail). Use for endpoints that
 * only admins should hit (archiveSlipLogs, backupFirestore, cleanupOldDocs,
 * remindLatePayments, verifySlip).
 *
 * Both functions write a 401/403 response and return null on failure so the
 * caller just checks the return value and `return` early.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

async function verifyIdTokenFromHeader(req, res) {
  const authHeader = req.get('authorization') || req.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return null;
  }
  const idToken = match[1].trim();
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (e) {
    console.warn('⚠️ verifyIdToken failed:', e.code || e.message);
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

async function requireAdmin(req, res) {
  const decoded = await verifyIdTokenFromHeader(req, res);
  if (!decoded) return null;

  // Admin = non-anonymous email user. Mirrors firestore.rules isAdminOrEmail().
  // Anonymous auth has no email / no provider; email-password auth has both.
  const isEmailUser = !!decoded.email && decoded.firebase?.sign_in_provider !== 'anonymous';
  if (!isEmailUser) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return decoded;
}

module.exports = { verifyIdTokenFromHeader, requireAdmin };
