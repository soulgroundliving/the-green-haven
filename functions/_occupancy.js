/**
 * Shared room-occupancy heuristic used by both createBookingLock (write gate)
 * and getRoomAvailability (read view). Extracted so the two CFs cannot drift —
 * if they disagreed, the booking page would show a room as "ว่าง" but the
 * lock attempt would reject it (or vice-versa, allowing double-booking).
 *
 * Inputs: the raw tenant doc data at tenants/{building}/list/{roomId}.
 * Returns: true if the room has an active occupant.
 *
 * Why not just `!!td.name && !td.movedOut`:
 *   Phase 3+ conversions write a SLIM tenant doc — identity (name, phone,
 *   email) lives in people/{tenantId}, NOT in the tenant doc. A name-only
 *   check misses every post-Phase-3 active room and treats them as vacant —
 *   which is exactly how a second prospect could double-book the same room.
 *
 * Why these four signals:
 *   - `tenantId`        : set by convertBookingToTenant on conversion
 *   - `linkedAuthUid`   : set by linkAuthUid CF when LIFF user links
 *   - `lease.status==='active'` : reduced lease mirror written by
 *                          convertBookingToTenant + admin save flow
 *   - `name`            : legacy pre-Phase-3 identity field (still present
 *                          on docs whose migration script never ran)
 *
 *   archiveTenantOnMoveOut + transitionToPlayer clear ALL of these to empty
 *   strings (and `FieldValue.delete()` the lease subobject), so a truly
 *   vacant doc returns false here.
 */
function isActiveTenant(td) {
  if (!td || typeof td !== 'object') return false;
  if (td.movedOut === true) return false;
  const hasTenantId    = typeof td.tenantId === 'string'      && td.tenantId.trim()      !== '';
  const hasLinkedUid   = typeof td.linkedAuthUid === 'string' && td.linkedAuthUid.trim() !== '';
  const hasActiveLease = !!(td.lease && td.lease.status === 'active');
  const hasLegacyName  = typeof td.name === 'string'          && td.name.trim()          !== '';
  return hasTenantId || hasLinkedUid || hasActiveLease || hasLegacyName;
}

module.exports = { isActiveTenant };
