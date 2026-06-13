/**
 * _petAlertEngine — pure logic for Lost Pet Alert (Meaning Layer #13).
 *
 * "วันนี้แมวหาย" → the owner raises an urgent, building-wide alert so every
 * approved neighbour gets a 🆘 LINE push and watches for the pet. The owner taps
 * "✅ เจอแล้ว" to resolve it; unresolved alerts auto-expire after a TTL.
 *
 * This mirrors the building-scoped-collection + per-transition-callable shape of
 * the Helper (#2) / Community-requests (#3) / Food-share (#4) / Pet-social (#10)
 * boards. Like #3/#10 it awards NO points — a lost pet is not a farm surface; the
 * value is the building rallying to help. Reads the pet REGISTRY
 * (tenants/{b}/list/{r}/pets/{petId}), NOT petProfiles (#10) — so it does not
 * touch the still-stabilizing pet-social write path.
 *
 * NO I/O. The callables (raisePetAlert / resolvePetAlert / cleanupPetAlertsScheduled)
 * read the docs + the actor's claims, then delegate every decision here so the
 * rules are unit-testable and identical across entry points.
 *
 * Privacy (the reason a snapshot, not a reference): the pet doc carries
 * `healthLog[]` (#9) + vaccine fields + the `status` approval — none of which may
 * leak building-wide. The alert card copies ONLY the safe display fields. The
 * whitelist lives here (mirror of _petSocialEngine.PROFILE_SAFE_FIELDS).
 *
 * petAlerts/{alertId} shape (top-level, building-scoped, CF-only-write):
 * {
 *   alertId,
 *   petId,                          // owner's pet registry doc id
 *   ownerUid,                       // context.auth.uid — server-set, anti-spoof
 *   ownerTenantId,                  // tenants/{b}/list/{r}.tenantId (matches consents/trustScores ids)
 *   building,                       // 'rooms' | 'nest' (canonical)
 *   ownerRoom,                      // String(room) — recipient-only resolve guard + "ห้อง Nxxx" display
 *   petName, petTypeEmoji, petPhotoURL,   // SAFE snapshot only — health/vaccine NEVER copied
 *   lastSeen,                       // free text "เห็นครั้งสุดท้ายแถวลิฟต์ชั้น 3"
 *   contactNote,                    // optional, owner-typed
 *   status: 'active' | 'resolved' | 'expired',
 *   createdAt, resolvedAt?, expiresAt
 * }
 *
 * Per §7-NN the CFs are callables, never Firestore triggers (Eventarc can't watch
 * the SE3 Firestore).
 */

'use strict';

// Pet-display fields copied from the registry doc into the alert card. NEVER
// include healthLog / vaccine* / status / photoPath / any internal path — those
// stay in the private pet doc (PDPA: health is sensitive, approval state internal).
const ALERT_SAFE_FIELDS = ['petName', 'petTypeEmoji', 'petPhotoURL'];

const VALID_STATUS = new Set(['active', 'resolved', 'expired']);

// A search runs longer than a food share's 24h, so the default TTL is wider; the
// owner re-raises if the pet is still missing past it (D4). Clamp the requested
// hours to [MIN, MAX] so a client can never set an absurd window.
const DEFAULT_TTL_HOURS = 48;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 168;          // 7 days ceiling — still ephemeral, swept after grace

const MAX_LAST_SEEN_LEN = 200;
const MAX_CONTACT_LEN = 200;
// The pet a snapshot carries — kept short for the LINE Flex + card.
const MAX_PET_NAME_LEN = 60;

function isValidStatus(s) { return VALID_STATUS.has(s); }

/** Trim + length-cap free-text "last seen"; returns '' for empty/blank input. */
function safeLastSeen(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_LAST_SEEN_LEN);
}

/** Trim + length-cap the optional owner contact note; returns '' for empty/blank input. */
function safeContact(t) {
  return String(t == null ? '' : t).trim().slice(0, MAX_CONTACT_LEN);
}

/** Clamp a requested TTL-hours to [MIN, MAX]; blank/invalid → DEFAULT. */
function normalizeTtlHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_HOURS;
  return Math.max(MIN_TTL_HOURS, Math.min(Math.floor(n), MAX_TTL_HOURS));
}

/** Absolute expiry epoch-ms from a base time + (clamped) TTL hours. */
function computeExpiresAtMs(nowMs, ttlHours) {
  return Number(nowMs) + normalizeTtlHours(ttlHours) * 3600 * 1000;
}

// expiresAt may be a Firestore Timestamp, a {seconds}/{_ms} shape, or raw epoch-ms.
function _expiryMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts._ms === 'number') return ts._ms;
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

/** Is this alert past its expiry at `nowMs`? (expired alerts are hidden + swept) */
function isExpired(alert, nowMs) {
  if (!alert) return false;
  const exp = _expiryMs(alert.expiresAt);
  return exp > 0 && Number(nowMs) >= exp;
}

/**
 * Pick ONLY the safe display fields off a raw pet registry doc → the snapshot the
 * alert card + LINE Flex show. Missing fields become '' / null so the doc shape is
 * stable. typeEmoji falls back to the legacy `type` alias (some pet docs store
 * `type` not `typeEmoji`).
 * @param {Object} petData raw pet doc data
 * @returns {{ petName: string, petTypeEmoji: string, petPhotoURL: string|null }}
 */
function buildPetSnapshot(petData) {
  const p = petData || {};
  return {
    petName:     String(p.name || '').trim().slice(0, MAX_PET_NAME_LEN),
    petTypeEmoji: String(p.typeEmoji || p.type || '🐾').slice(0, 8),
    petPhotoURL: p.photoURL || null,
  };
}

/**
 * Can the owner raise an alert for `pet`, given any existing alert for this pet?
 *   - the pet must exist and be 'approved' (an un-approved/ghost pet can't alert).
 *   - there must be NO already-active alert for the same pet (anti-dup / anti-spam).
 * @param {Object|null} pet the pet registry doc data
 * @param {Object|null} existingActive an existing active alert for this pet, or null
 * @returns {{ ok: boolean, reason?: string }}
 */
function canRaiseAlert(pet, existingActive) {
  if (!pet) return { ok: false, reason: 'not-found' };
  if (pet.status !== 'approved') return { ok: false, reason: 'not-approved' };
  if (existingActive && existingActive.status === 'active') {
    return { ok: false, reason: 'already-active' };
  }
  return { ok: true };
}

/**
 * Can `callerRoom` (in `callerBuilding`) resolve / mark-found alert `alert`?
 *   - the alert must exist and still be 'active' (a resolved/expired one is terminal).
 *   - the caller must be the OWNER (alert.ownerRoom === callerRoom) — the
 *     recipient/owner-only guard (mirrors the petLinks recipientRoom guard).
 *     Admin override is handled in the CF (token.admin), not here.
 *   - building must match (defense in depth on top of the building-scoped read).
 * @returns {{ ok: boolean, reason?: string }}
 */
function canResolveAlert(alert, callerBuilding, callerRoom) {
  if (!alert) return { ok: false, reason: 'not-found' };
  if (alert.status !== 'active') return { ok: false, reason: 'not-active' };
  if (alert.building !== callerBuilding) return { ok: false, reason: 'cross-building' };
  if (String(alert.ownerRoom) !== String(callerRoom)) return { ok: false, reason: 'not-owner' };
  return { ok: true };
}

/**
 * Build the petAlerts doc body (everything EXCEPT the server timestamps, which the
 * caller adds with admin.firestore.FieldValue.serverTimestamp() / Timestamp).
 * Snapshots ONLY the safe pet fields (privacy) + sanitizes the free text. The
 * caller supplies ownerUid/ownerTenantId from context (anti-spoof), never the client.
 * @returns {Object} the doc body
 */
function buildAlertDoc({ petId, pet, building, room, ownerTenantId, ownerUid, lastSeen, contactNote }) {
  const snap = buildPetSnapshot(pet);
  return {
    petId: String(petId),
    ownerUid: String(ownerUid || ''),
    ownerTenantId: String(ownerTenantId || ''),
    building: String(building),
    ownerRoom: String(room),
    petName: snap.petName,
    petTypeEmoji: snap.petTypeEmoji,
    petPhotoURL: snap.petPhotoURL,
    lastSeen: safeLastSeen(lastSeen) || null,
    contactNote: safeContact(contactNote) || null,
    status: 'active',
    resolvedAt: null,
  };
}

module.exports = {
  ALERT_SAFE_FIELDS,
  VALID_STATUS,
  DEFAULT_TTL_HOURS,
  MIN_TTL_HOURS,
  MAX_TTL_HOURS,
  MAX_LAST_SEEN_LEN,
  MAX_CONTACT_LEN,
  MAX_PET_NAME_LEN,
  isValidStatus,
  safeLastSeen,
  safeContact,
  normalizeTtlHours,
  computeExpiresAtMs,
  isExpired,
  buildPetSnapshot,
  canRaiseAlert,
  canResolveAlert,
  buildAlertDoc,
};
