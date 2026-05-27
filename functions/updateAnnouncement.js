/**
 * updateAnnouncement — admin-only HTTP function.
 * Updates mutable fields of an existing announcements/{id} doc.
 * type, sender, sentAt are immutable after creation.
 *
 * POST body: { id, title?, body?, audience?, eventDate?, location?, expiresAt? }
 *
 * Deploy: firebase deploy --only functions:updateAnnouncement
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

const VALID_AUDIENCES = new Set(['all', 'rooms', 'nest']);
const TITLE_MAX = 80;
const BODY_MAX = 1000;
const LOCATION_MAX = 200;

function parseIsoToDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return { error: `${fieldName} must be an ISO date string` };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { error: `${fieldName} is not a valid ISO date string` };
  return { date: new Date(ms) };
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return { error: 'body must be a JSON object' };
  }

  const { id, title, body, audience, eventDate, location, expiresAt } = payload;

  if (!id || typeof id !== 'string' || !id.trim()) {
    return { error: 'id is required' };
  }

  const updates = {};

  if (title !== undefined) {
    const t = typeof title === 'string' ? title.trim() : '';
    if (!t)                      return { error: 'title cannot be empty' };
    if (t.length > TITLE_MAX)    return { error: `title exceeds ${TITLE_MAX} chars` };
    updates.title = t;
  }

  if (body !== undefined) {
    const b = typeof body === 'string' ? body.trim() : '';
    if (!b)                      return { error: 'body cannot be empty' };
    if (b.length > BODY_MAX)     return { error: `body exceeds ${BODY_MAX} chars` };
    updates.body = b;
  }

  if (audience !== undefined) {
    if (!VALID_AUDIENCES.has(audience)) {
      return { error: `audience must be one of: ${[...VALID_AUDIENCES].join(', ')}` };
    }
    updates.audience = audience;
  }

  if (eventDate !== undefined) {
    const parsed = parseIsoToDate(eventDate, 'eventDate');
    if (parsed && parsed.error) return { error: parsed.error };
    if (parsed && parsed.date)  updates.eventDate = parsed.date;
  }

  if (location !== undefined) {
    if (typeof location !== 'string') return { error: 'location must be a string' };
    const loc = location.trim();
    if (loc.length > LOCATION_MAX)    return { error: `location exceeds ${LOCATION_MAX} chars` };
    updates.location = loc;
  }

  if (expiresAt !== undefined) {
    const parsed = parseIsoToDate(expiresAt, 'expiresAt');
    if (parsed && parsed.error) return { error: parsed.error };
    if (parsed && parsed.date)  updates.expiresAt = parsed.date;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'at least one field to update is required' };
  }

  return { ok: true, id: id.trim(), updates };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const v = validate(req.body);
  if (v.error) { res.status(400).json({ error: v.error }); return; }

  const { id, updates } = v;

  try {
    const db  = admin.firestore();
    const ref = db.collection('announcements').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    await ref.update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: { uid: decoded.uid, email: decoded.email || '' },
    });

    res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error('updateAnnouncement write failed:', e);
    res.status(500).json({ error: 'Failed to update announcement', detail: e.message });
  }
}

exports.updateAnnouncement = onRequest(
  { region: 'asia-southeast1', cors: true },
  handle
);

exports._handle   = handle;
exports._validate = validate;
