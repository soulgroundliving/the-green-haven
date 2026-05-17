/**
 * publishAnnouncement — admin-only HTTP function: unified writer for all
 * tenant-facing announcements. Replaces broadcastMessage (notice) + direct
 * CommunityEventsStore writes (event) + direct announcements writes (banner).
 *
 * Session 1 of C4 merge (2026-05-17). Legacy CFs/writers stay alive defensively;
 * tenant_app reads NEW + LEGACY merged. Session 2 = data migration. Session 3 =
 * legacy cleanup.
 *
 * Why one CF for three types instead of three: server-side enforcement of the
 * discriminator + audience model. Discriminator lives in the doc, validation
 * lives here, tenant query is uniform: `where audience in ['all', _building]`.
 *
 * Flow:
 *   1. requireAdmin (Bearer ID token + custom claim admin:true)
 *   2. validate({ type, title, body, audience, ...typeSpecific })
 *   3. Write announcements/{auto} with sender + sentAt + status='published'
 *
 * Schema written (see memory/lifecycle_announcements_unified.md):
 *   {
 *     type:     'notice' | 'event' | 'banner',
 *     title:    string  (1-80 chars),
 *     body:     string  (1-1000 chars — 2x broadcastMessage limit to fit events),
 *     audience: 'all' | 'rooms' | 'nest',
 *     sender:   { uid, email },
 *     sentAt:   serverTimestamp,
 *     status:   'published',
 *     // type='event' only:
 *     eventDate?: Timestamp (from client ISO string),
 *     location?:  string (<=200),
 *     photoUrl?:  string,
 *     // type='banner' only:
 *     expiresAt?: Timestamp (from client ISO string),
 *   }
 *
 * Deploy: firebase deploy --only functions:publishAnnouncement
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

const VALID_TYPES = new Set(['notice', 'event', 'banner']);
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

  const type     = typeof payload.type === 'string' ? payload.type.trim() : '';
  const title    = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body     = typeof payload.body  === 'string' ? payload.body.trim()  : '';
  const audience = payload.audience;

  if (!VALID_TYPES.has(type))         return { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` };
  if (!title)                          return { error: 'title is required' };
  if (title.length > TITLE_MAX)        return { error: `title exceeds ${TITLE_MAX} chars` };
  if (!body)                           return { error: 'body is required' };
  if (body.length > BODY_MAX)          return { error: `body exceeds ${BODY_MAX} chars` };
  if (!VALID_AUDIENCES.has(audience))  return { error: `audience must be one of: ${[...VALID_AUDIENCES].join(', ')}` };

  // Type-specific
  const extra = {};

  if (type === 'event') {
    const parsed = parseIsoToDate(payload.eventDate, 'eventDate');
    if (parsed && parsed.error) return { error: parsed.error };
    if (!parsed || !parsed.date) return { error: 'eventDate is required for type=event' };
    extra.eventDate = parsed.date;

    if (payload.location !== undefined && payload.location !== null && payload.location !== '') {
      if (typeof payload.location !== 'string') return { error: 'location must be a string' };
      const loc = payload.location.trim();
      if (loc.length > LOCATION_MAX) return { error: `location exceeds ${LOCATION_MAX} chars` };
      extra.location = loc;
    }

    if (payload.photoUrl !== undefined && payload.photoUrl !== null && payload.photoUrl !== '') {
      if (typeof payload.photoUrl !== 'string') return { error: 'photoUrl must be a string' };
      extra.photoUrl = payload.photoUrl;
    }
  }

  if (type === 'banner') {
    if (payload.expiresAt !== undefined && payload.expiresAt !== null && payload.expiresAt !== '') {
      const parsed = parseIsoToDate(payload.expiresAt, 'expiresAt');
      if (parsed && parsed.error) return { error: parsed.error };
      if (parsed && parsed.date)  extra.expiresAt = parsed.date;
    }
  }

  return { ok: true, normalized: { type, title, body, audience, extra } };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const v = validate(req.body);
  if (v.error) { res.status(400).json({ error: v.error }); return; }

  const { type, title, body, audience, extra } = v.normalized;

  try {
    const db  = admin.firestore();
    const docData = {
      type,
      title,
      body,
      audience,
      sender: {
        uid:   decoded.uid,
        email: decoded.email || '',
      },
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'published',
      ...extra,
    };

    const ref = await db.collection('announcements').add(docData);

    res.status(200).json({ ok: true, id: ref.id, type });
  } catch (e) {
    console.error('publishAnnouncement write failed:', e);
    res.status(500).json({ error: 'Failed to publish announcement', detail: e.message });
  }
}

exports.publishAnnouncement = onRequest(
  { region: 'asia-southeast1', cors: true },
  handle
);

exports._handle   = handle;
exports._validate = validate;
