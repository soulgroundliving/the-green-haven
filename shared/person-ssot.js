/**
 * PersonManager — canonical access to people/{tenantId} (the person SSoT in
 * the person-centric identity model).
 *
 * Replaces the historical pattern of storing identity (name, phone, email,
 * lineID, address, gamification, etc.) inline on tenants/{building}/list/
 * {roomId}. In the target architecture:
 *   - people/{tenantId} owns identity + cross-room state (gamification,
 *     pets, wellness claims, redemptions, complaint-free month markers).
 *   - leases/{building}/list/{contractId} owns lease terms + paymentHistory.
 *   - tenants/{building}/list/{roomId} is a thin room-slot pointer:
 *     { status, currentTenantId, currentLeaseId, building, roomId }.
 *
 * Phase 3a: this class is the FOUNDATION. Writers + readers migrate in
 * later phases. Until then, tenant docs still carry duplicate identity
 * fields for backward compatibility — call savePerson() alongside the
 * existing tenant-doc write so people/ catches up lazily.
 *
 * transitionToPlayer + archiveTenantOnMoveOut already populate / merge
 * people/{tid}. convertBookingToTenant Pass 5 reads it for returning-player
 * detection. This class centralizes those reads so callers don't have to
 * touch firestoreFunctions directly.
 */
class PersonManager {
  // ── in-memory cache ────────────────────────────────────────────────
  // Sync access to person docs for reader-side overlays (Phase 3e). Populated
  // on getPerson() fetch + savePerson() write. Not persisted — refills on the
  // first read after page load.
  static _cache = new Map();

  static getPersonSync(tenantId) {
    if (!tenantId) return null;
    return this._cache.get(tenantId) || null;
  }

  static _setCache(tenantId, data) {
    if (!tenantId || !data) return;
    this._cache.set(tenantId, data);
  }

  // ── private helpers ───────────────────────────────────────────────
  static _db() { return window.firebase?.firestore?.(); }
  static _fs() { return window.firebase?.firestoreFunctions; }
  static _ref(tenantId) {
    const db = this._db();
    const fs = this._fs();
    if (!db || !fs) return null;
    return fs.doc(db, 'people', tenantId);
  }

  // ── reads ─────────────────────────────────────────────────────────

  /** Read people/{tenantId}. Returns { id, ...data } or null. Updates cache. */
  static async getPerson(tenantId) {
    if (!tenantId) return null;
    const ref = this._ref(tenantId);
    if (!ref) return null;
    try {
      const fs = this._fs();
      const snap = await fs.getDoc(ref);
      if (!snap.exists()) return null;
      const data = { id: snap.id, ...snap.data() };
      this._setCache(tenantId, data);
      return data;
    } catch (e) {
      console.warn(`PersonManager.getPerson(${tenantId}) failed:`, e.message);
      return null;
    }
  }

  /**
   * Find the first people/* doc whose linkedAuthUid matches uid. Used by
   * returning-tenant cross-room continuity lookups (e.g. liffSignIn,
   * convertBookingToTenant). Returns null when no doc matches.
   */
  static async getByLinkedAuthUid(uid) {
    if (!uid) return null;
    const db = this._db();
    const fs = this._fs();
    if (!db || !fs) return null;
    try {
      const q = fs.query(
        fs.collection(db, 'people'),
        fs.where('linkedAuthUid', '==', uid),
        fs.limit(1)
      );
      const snap = await fs.getDocs(q);
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (e) {
      console.warn(`PersonManager.getByLinkedAuthUid(${uid}) failed:`, e.message);
      return null;
    }
  }

  /**
   * Find the first people/* doc whose lineUserId matches. Used when only
   * the LINE ID is known (e.g. booking flow before custom token is minted).
   */
  static async getByLineUserId(lineId) {
    if (!lineId) return null;
    const db = this._db();
    const fs = this._fs();
    if (!db || !fs) return null;
    try {
      const q = fs.query(
        fs.collection(db, 'people'),
        fs.where('lineUserId', '==', lineId),
        fs.limit(1)
      );
      const snap = await fs.getDocs(q);
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (e) {
      console.warn(`PersonManager.getByLineUserId(${lineId}) failed:`, e.message);
      return null;
    }
  }

  // ── writes ────────────────────────────────────────────────────────

  /**
   * Merge-set people/{tenantId} with the given fields. Always stamps
   * tenantId + updatedAt. Returns true on success.
   *
   * Caller should pass only the fields that need updating — merge:true
   * leaves other fields intact. Pass `gamification: null` to clear, not
   * `undefined` (Firestore drops undefined).
   */
  static async savePerson(tenantId, data) {
    if (!tenantId || !data || typeof data !== 'object') return false;
    const ref = this._ref(tenantId);
    if (!ref) return false;
    try {
      const fs = this._fs();
      await fs.setDoc(ref, {
        ...data,
        tenantId,
        updatedAt: fs.serverTimestamp(),
      }, { merge: true });
      // Cache locally for sync reads (overlay in getTenantByRoom etc.).
      // Merge with existing cache so partial saves don't lose other fields.
      const prior = this._cache.get(tenantId) || {};
      this._setCache(tenantId, { ...prior, ...data, tenantId });
      return true;
    } catch (e) {
      console.error(`PersonManager.savePerson(${tenantId}) failed:`, e.message);
      return false;
    }
  }

  /**
   * Bulk-prefetch people/* docs that match a list of tenantIds. Used at page
   * load to warm the cache so sync overlays in getTenantByRoom have data.
   * Returns the number of docs fetched.
   */
  static async prefetchByTenantIds(tenantIds) {
    if (!Array.isArray(tenantIds) || tenantIds.length === 0) return 0;
    const unique = [...new Set(tenantIds.filter(Boolean))];
    let fetched = 0;
    // Parallel reads — small N (≤ ~50 tenants), no need to batch.
    await Promise.all(unique.map(async (tid) => {
      const data = await this.getPerson(tid);
      if (data) fetched++;
    }));
    return fetched;
  }

  /**
   * Point people/{tenantId}.currentLease at a room+contract. Idempotent —
   * safe to call on tenant create, lease renewal, and returning-tenant
   * restore. building/roomId/contractId must all be non-empty.
   */
  static async linkRoom(tenantId, building, roomId, contractId) {
    if (!tenantId || !building || !roomId || !contractId) return false;
    return this.savePerson(tenantId, {
      currentLease: { building, roomId, contractId },
    });
  }

  /**
   * Set people/{tenantId}.currentLease = null. Called on move-out and on
   * transitionToPlayer when the person no longer holds a room. Doc itself
   * is preserved — gamification + identity stay.
   */
  static async unlinkRoom(tenantId) {
    if (!tenantId) return false;
    return this.savePerson(tenantId, { currentLease: null });
  }
}

window.PersonManager = PersonManager;
