/**
 * Building / room helpers — single source of truth for building-id naming,
 * room-membership checks, and room-type rules. Wrap existing config-unified
 * arrays so callers don't have to know the array layout.
 *
 * Loads after config-unified.js (depends on window.NEST_ROOMS / ROOMS_NEW).
 *
 * Usage examples:
 *   BuildingConfig.normalizeId('RentRoom')   → 'rooms'
 *   BuildingConfig.normalizeId('new')        → 'nest'
 *   BuildingConfig.isNestRoom('N301')        → true
 *   BuildingConfig.isPetAllowedRoom('N301')  → true
 *   BuildingConfig.getDisplayName('rooms')   → 'Nature Haven Rooms'
 *   BuildingConfig.getNestRoomIds()          → ['N101', ..., 'N405']
 *   BuildingConfig.getBuildingForRoom('N301')→ 'nest'  ('250' → 'nest', '15' → 'rooms')
 *
 * Why this exists: building IDs come in 4 flavors across the codebase —
 * 'rooms' / 'old' / 'RentRoom' all refer to the same building, and 'nest' / 'new'
 * to the other. Without a normalizer, every comparison sprouts its own ad-hoc
 * variant set. Same for "is this a Nest room" — historically grepped as
 * roomId.startsWith('N'), which works but isn't discoverable.
 */
(function() {
  'use strict';

  // Canonical building IDs used in Firebase paths (RTDB + Firestore)
  const CANONICAL = {
    ROOMS: 'rooms',  // Nature Haven Rooms (legacy "old building")
    NEST:  'nest'    // Nature Nest (newer building)
  };

  // Legacy Nest rooms were stored as bare numbers 101–405 (before the 'N' prefix
  // convention). Current data uses 'N101'…'N405', but the numeric range stays as
  // a resolver so a legacy bare-numeric id still maps to nest. This is the ONE
  // place the range is defined — getBuildingForRoom is the single source of truth;
  // BillingSystem.detectBuilding / _taDetectBuilding / detectBuildingFromRoomId
  // all resolve through it (each keeps a thin defensive copy for pre-load safety).
  const NEST_LEGACY_NUMERIC_MIN = 101;
  const NEST_LEGACY_NUMERIC_MAX = 405;

  // Display name in tenant_app + dashboard UI. Note: 'RentRoom' is *only* used
  // as the Firestore doc id under buildings/{RentRoom} — for any path that
  // says tenants/{b}/list/, bills/{b}/, meter_data/{b}/ etc., use 'rooms'.
  const DISPLAY_NAMES = {
    rooms: 'Nature Haven',
    nest:  'Nature Nest'
  };

  // Aliases that need to coerce to canonical. Keep this aligned with
  // BillStore._bld() in shared/billing-system.js — they must agree.
  const ALIASES = {
    'rooms':    'rooms',
    'old':      'rooms',
    'RentRoom': 'rooms',
    'nest':     'nest',
    'new':      'nest'
  };

  function normalizeId(b) {
    if (!b) return b;
    return ALIASES[b] || b;
  }

  function isNestRoom(roomId) {
    if (!roomId) return false;
    return String(roomId).startsWith('N');
  }

  function isRoomsRoom(roomId) {
    if (!roomId) return false;
    return !isNestRoom(roomId);
  }

  // Resolve the canonical building id for a room id. Unlike isNestRoom (a pure
  // 'N'-prefix string check), this ALSO maps the legacy bare-numeric Nest range
  // (101–405) to nest, matching how bills/meter data was historically keyed.
  // Single source of truth for room→building resolution across both apps.
  function getBuildingForRoom(roomId) {
    if (roomId == null || roomId === '') return CANONICAL.ROOMS;
    const s = String(roomId);
    if (s.startsWith('N') || s.startsWith('n')) return CANONICAL.NEST;
    const n = parseInt(s, 10);
    return (n >= NEST_LEGACY_NUMERIC_MIN && n <= NEST_LEGACY_NUMERIC_MAX)
      ? CANONICAL.NEST
      : CANONICAL.ROOMS;
  }

  function isPetAllowedRoom(roomId) {
    const list = window.NEST_ROOMS || [];
    const room = list.find(r => r.id === roomId);
    return !!(room && room.type === 'pet-allowed');
  }

  function getNestRoomIds() {
    return (window.NEST_ROOMS || []).map(r => r.id);
  }

  function getRoomsRoomIds() {
    return (window.ROOMS_NEW || []).map(r => r.id);
  }

  function getDisplayName(buildingId) {
    return DISPLAY_NAMES[normalizeId(buildingId)] || buildingId;
  }

  // Format room label with building prefix for compact display (e.g. tables).
  // 'N201' → 'N201'; '13' → '13' (Rooms doesn't get prefixed since the room
  // numbers don't collide with Nest's N-prefixed ids).
  function formatRoomLabel(roomId) {
    return String(roomId);
  }

  window.BuildingConfig = {
    CANONICAL,
    DISPLAY_NAMES,
    normalizeId,
    isNestRoom,
    isRoomsRoom,
    getBuildingForRoom,
    isPetAllowedRoom,
    getNestRoomIds,
    getRoomsRoomIds,
    getDisplayName,
    formatRoomLabel
  };
})();
