/**
 * Append-only admin-action audit trail — the document-of-record an auditor opens.
 *
 * Collection: actionAudit/{autoId | deterministicKey}   (flat, top-level)
 * Rule:       write: if false  → CF / admin-SDK only.  read: admin only (Phase 1.1).
 *
 * WHY this exists (Core Readiness Roadmap, Phase 1.1):
 *   The previous "audit log" was shared/audit.js → browser localStorage
 *   (`audit_logs`, mutable, has clearLogs(), per-browser) and access-control.js →
 *   localStorage `access_logs` (what audit-log-viewer.html read). The only real
 *   server trail (auth_events→BigQuery) logs failed logins + PDPA erasures only —
 *   never bill / meter / tenant / payment admin actions. An auditor cannot trust a
 *   per-browser, clearable log. This is the immutable server-side record.
 *
 * WHO stamps what: the CALLER (the recordAdminAction callable, or an in-tx CF)
 *   resolves `actor` / `actorEmail` / `actorRole` / `ip` from its OWN auth context
 *   and passes them in — NEVER from client-supplied data. This helper only
 *   validates shape and writes; it does not (and cannot) authenticate.
 *
 * Writer-agnostic: works with a Firestore Transaction OR WriteBatch (both expose
 * `.set(ref, data)`). Mirrors functions/_pointsLedger.js + _occupancyLog.js.
 *
 * Idempotency: client-initiated actions get a server autoId (two identical edits
 *   are two distinct real events — must NOT collapse). An in-tx CF that needs
 *   retry-dedup (e.g. verifySlip — one payment per month) passes an explicit
 *   `idempotencyKey` so a transaction retry rewrites the same doc instead of
 *   double-logging.
 *
 * Document schema (immutable per doc):
 * {
 *   actor:       string,        // admin uid (or 'system' for scheduled/CF-internal)
 *   actorEmail:  string | null, // denormalized at write time
 *   actorRole:   string | null, // 'admin' | 'accountant' | ...
 *   action:      string,        // one of VALID_ACTIONS
 *   targetType:  string,        // 'tenant' | 'payment' | 'bill' | 'meter' | ...
 *   targetId:    string | null, // roomId / transactionId / billId / ...
 *   building:    string | null,
 *   roomId:      string | null,
 *   before:      object | null, // small field-diff snapshot (caller-supplied)
 *   after:       object | null,
 *   at:          Timestamp,     // serverTimestamp() at write
 *   ip:          string | null, // server-resolved (context.rawRequest.ip)
 *   source:      string,        // CF name, or 'recordAdminAction'
 *   note:        string | null,
 * }
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Restrict action values — catches typos at write time. Extend alongside any new
// CF / callable site that logs an action.
const VALID_ACTIONS = new Set([
  'TENANT_UPDATED',        // admin edits a tenant record (PR 1a)
  'PAYMENT_VERIFIED',      // verifySlip records a payment in-tx (PR 1b)
  'BILL_PAID_MANUAL',      // admin marks a bill paid manually (PR 1b)
  'METER_IMPORT_APPROVED', // admin approves a meter import (PR 1b)
  'BILL_ISSUED',           // gapless invoice number minted at issuance (Phase 1.2)
  'BILL_VOIDED',           // admin voids an issued invoice (Phase 1.3)
  'BILL_REFUNDED',         // admin refunds a PAID bill — money returned (Phase 2)
  'DEPOSIT_RETURNED',      // admin settles + returns a security deposit at move-out (Slice C)
  'PAYMENT_RESET',         // admin resets a room's payment — deletes its verifiedSlips (clearRoomPaymentSlips)
]);

// Firestore doc IDs cannot contain '/' or start with '.'. Build a safe segment.
function _sanitiseSegment(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]]/g, '_');
}

function _objOrNull(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

/**
 * Append one actionAudit entry to an in-flight Firestore transaction or batch.
 *
 * @param {FirebaseFirestore.Transaction|FirebaseFirestore.WriteBatch} writer
 *   — both expose `.set(ref, data)`. Caller owns atomicity (place AFTER tx reads).
 * @param {FirebaseFirestore.Firestore} firestore — admin.firestore() instance.
 * @param {object} payload
 *   REQUIRED: actor, action (∈ VALID_ACTIONS), targetType
 *   OPTIONAL: targetId, actorEmail, actorRole, building, roomId, before, after,
 *             ip, source, note, idempotencyKey (→ deterministic doc id)
 * @returns {{ ref: DocumentReference }}
 */
function appendActionAudit(writer, firestore, payload) {
  if (!writer || typeof writer.set !== 'function') {
    throw new Error('appendActionAudit: writer must be a Firestore batch or transaction');
  }
  if (!firestore || typeof firestore.collection !== 'function') {
    throw new Error('appendActionAudit: firestore must be an admin Firestore instance');
  }

  for (const k of ['actor', 'action', 'targetType']) {
    if (payload[k] == null || payload[k] === '') {
      throw new Error(`appendActionAudit: missing required field '${k}'`);
    }
  }
  if (!VALID_ACTIONS.has(payload.action)) {
    throw new Error(`appendActionAudit: invalid action '${payload.action}' — must be one of ${[...VALID_ACTIONS].join(', ')}`);
  }

  const coll = firestore.collection('actionAudit');
  const ref = payload.idempotencyKey
    ? coll.doc(_sanitiseSegment(payload.idempotencyKey))
    : coll.doc(); // server autoId — distinct event per call

  const doc = {
    actor:      String(payload.actor),
    actorEmail: payload.actorEmail ? String(payload.actorEmail) : null,
    actorRole:  payload.actorRole ? String(payload.actorRole) : null,
    action:     payload.action,
    targetType: String(payload.targetType),
    targetId:   (payload.targetId != null && payload.targetId !== '') ? String(payload.targetId) : null,
    building:   payload.building ? String(payload.building) : null,
    roomId:     (payload.roomId != null && payload.roomId !== '') ? String(payload.roomId) : null,
    before:     _objOrNull(payload.before),
    after:      _objOrNull(payload.after),
    at:         admin.firestore.FieldValue.serverTimestamp(),
    ip:         payload.ip ? String(payload.ip) : null,
    source:     payload.source ? String(payload.source) : 'recordAdminAction',
    note:       payload.note ? String(payload.note) : null,
  };

  writer.set(ref, doc);

  return { ref };
}

module.exports = {
  appendActionAudit,
  VALID_ACTIONS,
};
