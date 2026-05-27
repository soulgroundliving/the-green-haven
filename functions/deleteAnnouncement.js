/**
 * deleteAnnouncement — admin-only HTTP function.
 * Permanently deletes an existing announcements/{id} doc.
 *
 * POST body: { id }
 *
 * Deploy: firebase deploy --only functions:deleteAnnouncement
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return { error: 'body must be a JSON object' };
  }
  const { id } = payload;
  if (!id || typeof id !== 'string' || !id.trim()) {
    return { error: 'id is required' };
  }
  return { ok: true, id: id.trim() };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const v = validate(req.body);
  if (v.error) { res.status(400).json({ error: v.error }); return; }

  const { id } = v;

  try {
    const db  = admin.firestore();
    const ref = db.collection('announcements').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    await ref.delete();

    res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error('deleteAnnouncement failed:', e);
    res.status(500).json({ error: 'Failed to delete announcement', detail: e.message });
  }
}

exports.deleteAnnouncement = onRequest(
  { region: 'asia-southeast1', cors: true },
  handle
);

exports._handle   = handle;
exports._validate = validate;
