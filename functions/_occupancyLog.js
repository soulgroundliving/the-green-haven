/**
 * Per-room occupancy history — append-only audit-grade log.
 *
 * Subcollection: tenants/{building}/list/{roomId}/occupancyLog/{idempotencyKey}
 * Rule: tampered-proof — Firestore rule blocks update + delete + client create.
 *       Only CFs via admin SDK can write. Reads: admin all + tenant-self only.
 *
 * Surfaced by:
 *   - shared/occupancy-log.js (reader module — S3)
 *   - shared/dashboard-tenant-modal.js "📋 ประวัติผู้เช่าเก่า" (S3)
 *
 * Why subcollection (D1 = a): room-scoped query is the dominant access pattern
 * (admin opens a room's history view). collectionGroup('occupancyLog') answers
 * the per-tenant "ฉันเคยอยู่ห้องไหนบ้าง" use case too.
 *
 * Why deterministic ID (D3 = a): CF retries + backfill re-runs MUST be safe.
 * Caller provides a per-event `discriminator` so each logical event has a
 * unique stable key.
 *
 * Document schema (immutable per doc — enforced by rule):
 * {
 *   tenantId:      string,         // canonical (carries across rooms)
 *   tenantName:    string,         // denormalized — copy at event time
 *   personId:      string | null,  // people/{personId} link if present
 *
 *   building:      string,
 *   roomId:        string,
 *   at:            Timestamp,      // serverTimestamp() at write
 *
 *   action:        'moved_in' | 'moved_out' | 'transferred_in' | 'transferred_out'
 *                | 'archived'  | 'restored',
 *   reason:        string | null,
 *
 *   otherBuilding: string | null,  // pair for transfers (null otherwise)
 *   otherRoom:     string | null,
 *
 *   leaseId:       string,
 *
 *   by:            string,         // admin UID (CF caller)
 *   byEmail:       string | null,  // denormalized — survives user deletion
 *
 *   source:        string,         // CF that wrote this entry (see VALID_SOURCES)
 *   idempotencyKey: string,
 *   notes:         string | null,
 * }
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Restricting source values catches typos at write-time. Update VALID_SOURCES
// alongside any new CF that calls appendLog.
const VALID_SOURCES = new Set([
  'convertBookingToTenant',
  'transferTenant.variation',
  'transferTenant.novation',
  'archiveTenantOnMoveOut',
  'transitionToPlayer',
  'revertTransitionToPlayer',
  'restoreReturningTenant',
  'backfill',
]);

const VALID_ACTIONS = new Set([
  'moved_in', 'moved_out',
  'transferred_in', 'transferred_out',
  'archived', 'restored',
]);

// Firestore doc IDs cannot contain '/' or start with '.'. Build a safe key.
function _sanitiseSegment(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]]/g, '_');
}

/**
 * Deterministic key for an occupancy event. Same logical event MUST produce
 * the same key across retries + backfill re-runs.
 *
 * Caller-supplied `discriminator` covers cases where source+leaseId+action
 * isn't unique (e.g. a lease that was variation-transferred multiple times).
 * Recommended discriminators per source:
 *   - convertBookingToTenant: bookingId
 *   - transferTenant.variation: ISO timestamp of the amendment entry
 *   - transferTenant.novation: the OTHER lease's id (paired)
 *   - archiveTenantOnMoveOut: '' (one archive per leaseId is exhaustive)
 *   - restoreReturningTenant: priorLeaseId
 *   - backfill: same as the live-write equivalent (so backfill re-runs collapse onto same doc)
 */
function buildIdempotencyKey({ source, leaseId, action, building, roomId, discriminator }) {
  const parts = [
    _sanitiseSegment(source),
    _sanitiseSegment(leaseId),
    _sanitiseSegment(action),
    _sanitiseSegment(building),
    _sanitiseSegment(roomId),
    _sanitiseSegment(discriminator || ''),
  ];
  return parts.join('__');
}

/**
 * Append one occupancyLog entry to an in-flight Firestore batch or transaction.
 *
 * @param {FirebaseFirestore.WriteBatch|FirebaseFirestore.Transaction} writer
 *   - Both have `.set(ref, data, options?)`. Caller controls atomicity.
 * @param {FirebaseFirestore.Firestore} firestore
 *   - admin.firestore() instance for building the ref.
 * @param {object} payload
 *   - REQUIRED: tenantId, tenantName, building, roomId, action, leaseId, by, source
 *   - OPTIONAL: personId, reason, otherBuilding, otherRoom, byEmail, notes, discriminator
 * @returns {{ ref: DocumentReference, idempotencyKey: string }}
 *   - Returned so caller can assert in tests + chain RTDB audit alongside.
 */
function appendLog(writer, firestore, payload) {
  if (!writer || typeof writer.set !== 'function') {
    throw new Error('appendLog: writer must be a Firestore batch or transaction');
  }
  if (!firestore || typeof firestore.collection !== 'function') {
    throw new Error('appendLog: firestore must be an admin Firestore instance');
  }

  const required = ['tenantId', 'tenantName', 'building', 'roomId', 'action', 'leaseId', 'by', 'source'];
  for (const k of required) {
    if (payload[k] == null || payload[k] === '') {
      throw new Error(`appendLog: missing required field '${k}'`);
    }
  }
  if (!VALID_ACTIONS.has(payload.action)) {
    throw new Error(`appendLog: invalid action '${payload.action}' — must be one of ${[...VALID_ACTIONS].join(', ')}`);
  }
  if (!VALID_SOURCES.has(payload.source)) {
    throw new Error(`appendLog: invalid source '${payload.source}' — must be one of ${[...VALID_SOURCES].join(', ')}`);
  }

  const idempotencyKey = buildIdempotencyKey(payload);

  const docRef = firestore
    .collection('tenants').doc(payload.building)
    .collection('list').doc(payload.roomId)
    .collection('occupancyLog').doc(idempotencyKey);

  const doc = {
    tenantId:      String(payload.tenantId),
    tenantName:    String(payload.tenantName || ''),
    personId:      payload.personId ? String(payload.personId) : null,

    building:      String(payload.building),
    roomId:        String(payload.roomId),
    at:            admin.firestore.FieldValue.serverTimestamp(),

    action:        payload.action,
    reason:        payload.reason ? String(payload.reason) : null,

    otherBuilding: payload.otherBuilding ? String(payload.otherBuilding) : null,
    otherRoom:     payload.otherRoom     ? String(payload.otherRoom)     : null,

    leaseId:       String(payload.leaseId),

    by:            String(payload.by),
    byEmail:       payload.byEmail ? String(payload.byEmail) : null,

    source:        payload.source,
    idempotencyKey,
    notes:         payload.notes ? String(payload.notes) : null,
  };

  // No merge: each doc is immutable. If the same key is written twice (retry
  // or backfill re-run), the second write replaces with identical content
  // (serverTimestamp will refresh — acceptable; deduplicated by doc id).
  writer.set(docRef, doc);

  return { ref: docRef, idempotencyKey };
}

module.exports = {
  appendLog,
  buildIdempotencyKey,
  VALID_ACTIONS,
  VALID_SOURCES,
};
