/**
 * cleanupAnonymousUsers — bulk-delete legacy Firebase Auth users that have
 * no provider data (i.e. they signed in via signInAnonymously()). Anonymous
 * sign-in must already be disabled at the Firebase Console — otherwise
 * tenant_app would just create new anon users to replace the deleted ones.
 *
 * Tenants who have linked their LINE account (LIFF flow → linkAuthUid CF
 * gives them a custom-token-based auth UID with provider data) are NOT
 * affected. Only orphaned anon records get deleted.
 *
 * Auth: caller must have admin custom claim (verified via _auth.requireAdmin).
 *
 * Returns: { success, scanned, deleted, sample (up to 5 deleted UIDs) }.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

exports.cleanupAnonymousUsers = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 300 })  // 5 min — listUsers paginates, deleteUsers does 1k batches
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const decoded = await requireAdmin(req, res);
    if (!decoded) return;  // requireAdmin already wrote 401/403

    try {
      const anonUids = [];
      let nextPageToken;

      // listUsers paginates at 1000/page max. Walk all pages, collect anon UIDs.
      do {
        const page = await admin.auth().listUsers(1000, nextPageToken);
        for (const u of page.users) {
          // Anonymous = no providerData entries (no email, phone, oauth, etc.).
          // Custom-token signIns also produce empty providerData, BUT those
          // come with custom claims set by linkAuthUid (room + building).
          // So: skip anyone with custom claims to be safe.
          const isAnon = (!u.providerData || u.providerData.length === 0);
          const hasClaims = u.customClaims && Object.keys(u.customClaims).length > 0;
          if (isAnon && !hasClaims) anonUids.push(u.uid);
        }
        nextPageToken = page.pageToken;
      } while (nextPageToken);

      let deleted = 0;
      const sample = anonUids.slice(0, 5);
      // deleteUsers handles up to 1000 UIDs per call.
      for (let i = 0; i < anonUids.length; i += 1000) {
        const batch = anonUids.slice(i, i + 1000);
        const result = await admin.auth().deleteUsers(batch);
        deleted += result.successCount;
        if (result.failureCount > 0) {
          console.warn(`cleanupAnonymousUsers: ${result.failureCount} deletes failed in batch starting ${i}`);
        }
      }

      console.log(`✅ cleanupAnonymousUsers: deleted=${deleted} scanned candidate=${anonUids.length} caller=${decoded.email}`);
      return res.status(200).json({
        success: true,
        scanned: anonUids.length,
        deleted,
        sample
      });
    } catch (e) {
      console.error('cleanupAnonymousUsers failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
