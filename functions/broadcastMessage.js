/**
 * broadcastMessage — admin-only HTTP function: publishes an announcement to
 * tenants via in-app notification (no LINE).
 *
 * Why in-app instead of LINE Multicast:
 *   LINE OA free tier = 200 messages/month; paid plans start at ฿1,200/mo.
 *   At ~30 tenants × 5 broadcasts/month = 150 msg → already brushing the
 *   free-tier ceiling. In-app via Firestore onSnapshot is free + verifiable.
 *   LINE integration deferred until a paid OA plan is justified.
 *
 * Flow:
 *   1. requireAdmin (Bearer ID token + custom claim admin:true)
 *   2. Validate body { title, body, building }
 *   3. Write broadcastMessages/{auto} with audience derived from building
 *   4. tenant_app subscribes via onSnapshot filtered by audience match
 *
 * Schema written:
 *   {
 *     title:    string  (1-80 chars)
 *     body:     string  (1-500 chars)
 *     audience: 'all' | 'rooms' | 'nest'
 *     sender:   { uid, email }
 *     sentAt:   serverTimestamp
 *     status:   'published'
 *   }
 *
 * Deploy: firebase deploy --only functions:broadcastMessage
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

const VALID_AUDIENCES = new Set(['all', 'rooms', 'nest']);
const TITLE_MAX = 80;
const BODY_MAX  = 500;

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'body must be a JSON object';
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body  = typeof payload.body  === 'string' ? payload.body.trim()  : '';
  const building = payload.building;

  if (!title) return 'title is required';
  if (title.length > TITLE_MAX) return `title exceeds ${TITLE_MAX} chars`;
  if (!body) return 'body is required';
  if (body.length > BODY_MAX) return `body exceeds ${BODY_MAX} chars`;
  if (!VALID_AUDIENCES.has(building)) {
    return `building must be one of: ${[...VALID_AUDIENCES].join(', ')}`;
  }

  return null;
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const error = validate(req.body);
  if (error) { res.status(400).json({ error }); return; }

  const title    = req.body.title.trim();
  const body     = req.body.body.trim();
  const audience = req.body.building;

  try {
    const db  = admin.firestore();
    const ref = await db.collection('broadcastMessages').add({
      title,
      body,
      audience,
      sender: {
        uid:   decoded.uid,
        email: decoded.email || '',
      },
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'published',
    });

    res.status(200).json({ ok: true, id: ref.id });
  } catch (e) {
    console.error('broadcastMessage write failed:', e);
    res.status(500).json({ error: 'Failed to publish broadcast', detail: e.message });
  }
}

exports.broadcastMessage = onRequest(
  { region: 'asia-southeast1', cors: true },
  handle
);

// Exported for unit tests — direct handler bypass of onRequest wrapper
exports._handle   = handle;
exports._validate = validate;
