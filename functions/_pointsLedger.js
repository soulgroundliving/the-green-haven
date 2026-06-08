/**
 * Append-only points event log — engagement-over-time + Trust System foundation.
 *
 * Collection: pointsLedger/{idempotencyKey}   (flat, top-level)
 * Rule:       write: if false  → CF / admin-SDK only.  read: admin only (Phase 0).
 *
 * WHY this exists (Core Readiness Roadmap, Phase 0):
 *   gamification.points is a running TOTAL mutated in place — the individual
 *   earning/spending EVENTS (when, why, how many) are not logged anywhere. Without
 *   this ledger, "whose engagement rose/fell over 3 months" is unanswerable and a
 *   Trust System is impossible. Every day without it = engagement history lost.
 *
 * WHY in the same writer (tx/batch) as the balance update: the ledger row and the
 *   `gamification.points` mutation must commit atomically — no drift between the
 *   running total and the event history.
 *
 * Writer-agnostic: works with a Firestore Transaction OR WriteBatch (both expose
 * `.set(ref, data)`). Mirrors functions/_occupancyLog.js (same house pattern).
 *
 * Document schema (immutable per doc — deduped by deterministic id):
 * {
 *   tenantId:     string,          // canonical person/tenant id (carries across rooms)
 *   building:     string | null,   // null for player-path (people/{tenantId}) events
 *   roomId:       string | null,
 *   source:       'daily_login' | 'wellness_quiz' | 'contract_quiz'
 *               | 'complaint_free_month' | 'payment' | 'redeem' | 'quest'
 *               | 'help_completed',
 *   points:       number,          // SIGNED: + for earn, − for redeem (never 0)
 *   balanceAfter: number | null,   // running total after this event, when known
 *   at:           Timestamp,       // serverTimestamp() at write
 *   by:           string,          // actor uid, or 'system' for scheduled awards
 *   refId:        string | null,   // link to source event (slip txid / redemptionId / articleId / date)
 *   note:         string | null,
 * }
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Restrict source values — catches typos at write time. Update alongside any new
// CF that calls appendPointsLedger.
const VALID_SOURCES = new Set([
  'daily_login',
  'wellness_quiz',
  'contract_quiz',
  'complaint_free_month',
  'payment',
  'redeem',
  'quest',
  'help_completed',   // completeHelpRequest — peer-confirmed neighbor help (Meaning Layer #2)
]);

// Firestore doc IDs cannot contain '/' or start with '.'. Build a safe segment.
function _sanitiseSegment(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]]/g, '_');
}

/**
 * Deterministic id for a points event. The same logical event MUST collapse onto
 * the same doc across CF transaction retries (and any future backfill), so a
 * retried claim/payment can never double-log. Every call site supplies a
 * discriminator that is unique for that logical event:
 *   - daily_login:          the BKK date string (one per day)
 *   - wellness_quiz:         markerId (articleId + month — one per article/month)
 *   - contract_quiz:         monthKey (one per month)
 *   - complaint_free_month:  monthKey (one per month)
 *   - payment:               monthKey (matches the paymentHistory idempotency fence)
 *   - redeem:                redemptionId (unique per redemption)
 *   - quest:                 questId__day (one credit per quest per BKK day)
 *   - help_completed:        requestId (one credit per completed help request)
 */
function buildLedgerKey({ source, tenantId, discriminator }) {
  return [
    _sanitiseSegment(source),
    _sanitiseSegment(tenantId),
    _sanitiseSegment(discriminator),
  ].join('__');
}

/**
 * Append one pointsLedger entry to an in-flight Firestore transaction or batch.
 *
 * @param {FirebaseFirestore.Transaction|FirebaseFirestore.WriteBatch} writer
 *   — both expose `.set(ref, data)`. Caller owns atomicity (place AFTER all tx reads).
 * @param {FirebaseFirestore.Firestore} firestore — admin.firestore() instance.
 * @param {object} payload
 *   REQUIRED: tenantId, source, points (non-zero), discriminator
 *   OPTIONAL: building, roomId, balanceAfter, by, refId, note
 * @returns {{ ref: DocumentReference, idempotencyKey: string }}
 */
function appendPointsLedger(writer, firestore, payload) {
  if (!writer || typeof writer.set !== 'function') {
    throw new Error('appendPointsLedger: writer must be a Firestore batch or transaction');
  }
  if (!firestore || typeof firestore.collection !== 'function') {
    throw new Error('appendPointsLedger: firestore must be an admin Firestore instance');
  }

  for (const k of ['tenantId', 'source', 'discriminator']) {
    if (payload[k] == null || payload[k] === '') {
      throw new Error(`appendPointsLedger: missing required field '${k}'`);
    }
  }
  if (!VALID_SOURCES.has(payload.source)) {
    throw new Error(`appendPointsLedger: invalid source '${payload.source}' — must be one of ${[...VALID_SOURCES].join(', ')}`);
  }
  const points = Number(payload.points);
  if (!Number.isFinite(points) || points === 0) {
    throw new Error(`appendPointsLedger: points must be a non-zero finite number (got ${payload.points})`);
  }

  const idempotencyKey = buildLedgerKey(payload);
  const ref = firestore.collection('pointsLedger').doc(idempotencyKey);

  const balanceAfter = Number(payload.balanceAfter);
  const doc = {
    tenantId:     String(payload.tenantId),
    building:     payload.building ? String(payload.building) : null,
    roomId:       (payload.roomId != null && payload.roomId !== '') ? String(payload.roomId) : null,
    source:       payload.source,
    points,
    balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : null,
    at:           admin.firestore.FieldValue.serverTimestamp(),
    by:           payload.by ? String(payload.by) : 'system',
    refId:        payload.refId ? String(payload.refId) : null,
    note:         payload.note ? String(payload.note) : null,
  };

  // Immutable per doc: a retry re-writes the same key with identical content
  // (serverTimestamp refreshes — acceptable; deduped by doc id).
  writer.set(ref, doc);

  return { ref, idempotencyKey };
}

module.exports = {
  appendPointsLedger,
  buildLedgerKey,
  VALID_SOURCES,
};
