/**
 * FacilityBookingManager — client-side module for shared facility reservations.
 *
 * Manages parking / laundry / rooftop bookings by tenants.
 * All writes go through CFs (createFacilityBooking, cancelFacilityBooking)
 * for atomic slot-conflict checking.
 *
 * Globals exposed:
 *   window.FacilityBookingManager
 *
 * Depends on:
 *   window.firebase.firestore(), window.firebase.firestoreFunctions
 *   window.firebase.functions() for callable CFs
 */
(function () {
  'use strict';

  const FACILITY_TYPES = {
    parking:  { label: 'ที่จอดรถ',       emoji: '🅿️' },
    laundry:  { label: 'ห้องซักผ้า',      emoji: '👕' },
    rooftop:  { label: 'ดาดฟ้า',          emoji: '🌿' },
    other:    { label: 'พื้นที่ส่วนกลาง', emoji: '🏛️' },
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _db() { return window.firebase?.firestore?.(); }
  function _fs() { return window.firebase?.firestoreFunctions; }
  function _fn() { return window.firebase?.functions?.(); }

  function _ready() {
    return !!(window.firebase?.firestore && window.firebase?.firestoreFunctions && window.firebase?.functions);
  }

  function _configDocId(building, facilityType) {
    return `${building}_${facilityType}`;
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  /**
   * Load facilityConfig docs for a building.
   * Returns an array of config objects: { id, type, displayName, slots, timeSlots, ... }
   */
  async function listConfig(building) {
    if (!_ready()) return [];
    const db = _db();
    const fs = _fs();
    try {
      const snap = await fs.getDocs(
        fs.query(fs.collection(db, 'facilityConfig'),
          fs.where('building', '==', building),
          fs.where('active', '==', true))
      );
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[FacilityBooking] listConfig failed:', e);
      return [];
    }
  }

  /**
   * Load a single facilityConfig doc.
   * Returns null if not found or not active.
   */
  async function getConfig(building, facilityType) {
    if (!_ready()) return null;
    const db = _db();
    const fs = _fs();
    try {
      const snap = await fs.getDoc(fs.doc(db, 'facilityConfig', _configDocId(building, facilityType)));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data.active ? { id: snap.id, ...data } : null;
    } catch (e) {
      console.warn('[FacilityBooking] getConfig failed:', e);
      return null;
    }
  }

  // ── Bookings ───────────────────────────────────────────────────────────────

  /**
   * Load all confirmed bookings for a building + facilityType + date.
   * Returns an array of booking objects.
   * date: 'YYYY-MM-DD' (CE)
   */
  async function listBookingsByDate(building, facilityType, date) {
    if (!_ready()) return [];
    const db = _db();
    const fs = _fs();
    try {
      const snap = await fs.getDocs(
        fs.query(fs.collection(db, 'facilityBookings'),
          fs.where('building', '==', building),
          fs.where('facilityType', '==', facilityType),
          fs.where('date', '==', date),
          fs.where('status', '==', 'confirmed'))
      );
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[FacilityBooking] listBookingsByDate failed:', e);
      return [];
    }
  }

  /**
   * Load upcoming bookings for the current tenant (own bookings only).
   * Returns array sorted by date ascending.
   */
  async function listMyBookings(tenantUid) {
    if (!_ready() || !tenantUid) return [];
    const db = _db();
    const fs = _fs();
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const snap = await fs.getDocs(
        fs.query(fs.collection(db, 'facilityBookings'),
          fs.where('tenantUid', '==', tenantUid),
          fs.where('status', '==', 'confirmed'),
          fs.orderBy('date', 'asc'))
      );
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.date >= todayStr);
    } catch (e) {
      console.warn('[FacilityBooking] listMyBookings failed:', e);
      return [];
    }
  }

  /**
   * Subscribe to live booking updates for admin view.
   * Filters by building + optional facilityType.
   * Returns unsubscribe function.
   */
  function subscribeAdminBookings(building, facilityType, date, callback) {
    if (!_ready()) return () => {};
    const db = _db();
    const fs = _fs();
    let q = fs.query(fs.collection(db, 'facilityBookings'),
      fs.where('building', '==', building),
      fs.where('date', '==', date));
    if (facilityType) {
      q = fs.query(fs.collection(db, 'facilityBookings'),
        fs.where('building', '==', building),
        fs.where('facilityType', '==', facilityType),
        fs.where('date', '==', date));
    }
    return fs.onSnapshot(q,
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => console.warn('[FacilityBooking] subscribeAdminBookings err:', err)
    );
  }

  // ── Write via CFs ──────────────────────────────────────────────────────────

  /**
   * Create a facility booking.
   * data: { building, facilityType, slot, date, timeSlot }
   * Returns { bookingId } on success.
   */
  async function createBooking(data) {
    if (!_fn()) throw new Error('Firebase functions not ready');
    const fn = _fn();
    const callable = fn.httpsCallable
      ? fn.httpsCallable('createFacilityBooking')
      : window.firebase.firestoreFunctions?.httpsCallable?.('createFacilityBooking');
    if (!callable) throw new Error('createFacilityBooking CF not available');
    const result = await callable(data);
    return result.data;
  }

  /**
   * Cancel a facility booking.
   * bookingId: string
   * Returns { cancelled: true } on success.
   */
  async function cancelBooking(bookingId) {
    if (!_fn()) throw new Error('Firebase functions not ready');
    const fn = _fn();
    const callable = fn.httpsCallable
      ? fn.httpsCallable('cancelFacilityBooking')
      : window.firebase.firestoreFunctions?.httpsCallable?.('cancelFacilityBooking');
    if (!callable) throw new Error('cancelFacilityBooking CF not available');
    const result = await callable({ bookingId });
    return result.data;
  }

  // ── Config admin writes ────────────────────────────────────────────────────

  /**
   * Save (upsert) a facilityConfig doc. Admin only.
   * configData: { building, type, displayName, slots, timeSlots, maxAdvanceDays, active }
   */
  async function saveConfig(building, facilityType, configData) {
    if (!_ready()) throw new Error('Firebase not ready');
    const db = _db();
    const fs = _fs();
    const ref = fs.doc(db, 'facilityConfig', _configDocId(building, facilityType));
    await fs.setDoc(ref, {
      building,
      type: facilityType,
      ...configData,
      updatedAt: fs.serverTimestamp ? fs.serverTimestamp() : new Date().toISOString()
    }, { merge: true });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /** Return all known facility type definitions. */
  function getFacilityTypes() {
    return Object.entries(FACILITY_TYPES).map(([id, meta]) => ({ id, ...meta }));
  }

  /** Return a human-readable label for a facility type. */
  function getFacilityLabel(type) {
    return FACILITY_TYPES[type]?.label || type;
  }

  function getFacilityEmoji(type) {
    return FACILITY_TYPES[type]?.emoji || '🏛️';
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  window.FacilityBookingManager = {
    listConfig,
    getConfig,
    listBookingsByDate,
    listMyBookings,
    subscribeAdminBookings,
    createBooking,
    cancelBooking,
    saveConfig,
    getFacilityTypes,
    getFacilityLabel,
    getFacilityEmoji,
  };
})();
