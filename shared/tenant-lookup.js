// Unified Tenant Lookup Helper
// Provides centralized access to tenant data across all buildings

class TenantLookup {
  // Get tenant by ID across any building
  static getTenantById(tenantId) {
    if (!tenantId) return null;
    const rooms = TenantConfigManager.getAllTenants('rooms');
    const nest = TenantConfigManager.getAllTenants('nest');
    return rooms[tenantId] || nest[tenantId] || null;
  }

  // Get tenant occupying a specific room.
  // Phase 4 SSoT: tenants/{building}/list/{roomId} is keyed by roomId, with
  // tenant identity merged with lease subobject. Try direct lookup first,
  // fall back to legacy lease→tenantId chain only if SSoT doc missing.
  // Project lease subobject onto flat fields (contractEnd, deposit, etc.)
  // so modal populate code that reads flat fields keeps working.
  static getTenantByRoom(building, roomId) {
    if (!building || !roomId) return null;

    // SSoT path — direct roomId lookup
    const ssotDoc = TenantConfigManager.getTenant(building, String(roomId));
    if (ssotDoc && ssotDoc.name) {
      const lease = ssotDoc.lease || {};
      // Phase 3d: tenant.lease is a reduced mirror — only carries
      // {leaseId, status, startDate, endDate}. Fetch the full lease doc for
      // rentAmount, deposit, contractDocument etc. that the reduced mirror
      // no longer projects. Old tenant docs still have the legacy 11-field
      // mirror — the fallback chain below prefers tenant doc fields, then
      // mirror, then full lease lookup.
      const leaseId = lease.leaseId || ssotDoc.activeContractId;
      const fullLease = (leaseId && typeof LeaseAgreementManager !== 'undefined')
        ? (LeaseAgreementManager.getLease(leaseId) || {})
        : {};
      // Phase 3e: overlay canonical identity from people/{tenantId} when
      // cached. people/ is the long-term home for identity + cross-room state
      // (gamification, companyInfo, avatar). Tenant-doc fields stay as the
      // fallback while Phase 4 lazy migration backfills the people collection.
      const person = ssotDoc.tenantId && window.PersonManager
        ? window.PersonManager.getPersonSync(ssotDoc.tenantId)
        : null;
      return {
        ...ssotDoc,
        // Identity fields: prefer person doc when present
        name:             person?.name             || ssotDoc.name,
        firstName:        person?.firstName        || ssotDoc.firstName,
        lastName:         person?.lastName         || ssotDoc.lastName,
        phone:            person?.phone            || ssotDoc.phone,
        email:            person?.email            || ssotDoc.email,
        lineID:           person?.lineUserId       || ssotDoc.lineID,
        idCardNumber:     person?.idCardNumber     || ssotDoc.idCardNumber,
        address:          person?.address          || ssotDoc.address,
        emergencyContact: person?.emergencyContact || ssotDoc.emergencyContact,
        notes:            person?.notes            || ssotDoc.notes,
        companyInfo:      person?.companyInfo      || ssotDoc.companyInfo,
        avatar:           person?.avatar           || ssotDoc.avatar,
        gamification:     person?.gamification     || ssotDoc.gamification,
        // Flat-field projection for legacy modal/card render code
        contractEnd: ssotDoc.contractEnd || lease.endDate || lease.moveOutDate || fullLease.endDate || fullLease.moveOutDate || ssotDoc.moveOutDate || null,
        moveInDate:  ssotDoc.moveInDate  || lease.startDate || lease.moveInDate || fullLease.startDate || fullLease.moveInDate || null,
        moveOutDate: ssotDoc.moveOutDate || lease.endDate || lease.moveOutDate || fullLease.endDate || fullLease.moveOutDate || null,
        deposit:     (ssotDoc.deposit !== undefined && ssotDoc.deposit !== null) ? ssotDoc.deposit : (lease.deposit ?? fullLease.deposit ?? null),
        rentAmount:  ssotDoc.rentAmount ?? lease.rentAmount ?? fullLease.rentAmount ?? null,
        // Canonical field is licensePlate; fall back to legacy vehiclePlate
        // for any pre-2026-04-26 doc that was written by the buggy admin modal
        // before the field name was unified. Once admin re-saves once, the
        // legacy key naturally drops out.
        licensePlate: person?.licensePlate || ssotDoc.licensePlate || ssotDoc.vehiclePlate || null,
      };
    }

    // Legacy fallback — try tenantId chain first, then tenantName synthesis.
    // The latter handles rooms where _syncLeaseToTenantSSoT wrote lease fields
    // but never carried tenantName → SSoT identity (pre-fix data gap).
    const lease = LeaseAgreementManager.getActiveLease(building, roomId);
    if (!lease) return null;
    if (lease.tenantId) {
      return TenantConfigManager.getTenant(building, lease.tenantId) || null;
    }
    if (lease.tenantName) {
      // Synthesize minimal tenant from active lease so modal shows as occupied
      const lsub = ssotDoc?.lease || {};
      return {
        ...(ssotDoc || {}),
        name: lease.tenantName,
        moveInDate:  lease.moveInDate  || lease.startDate  || lsub.moveInDate  || null,
        contractEnd: lease.moveOutDate || lease.endDate    || lsub.moveOutDate || null,
        moveOutDate: lease.moveOutDate || lease.endDate    || lsub.moveOutDate || null,
        rentAmount:  lease.rentAmount  ?? lsub.rentAmount  ?? null,
        deposit:     lease.deposit     ?? lsub.deposit     ?? null,
        contractDocument: lease.contractDocument || lsub.contractDocument || null,
        contractFileName: lease.contractFileName || lsub.contractFileName || null,
      };
    }
    return null;
  }

  // Get lease for a room.
  // Phase 4 SSoT: lease subobject lives under tenants/{building}/list/{roomId}.lease
  static getLeaseByRoom(building, roomId) {
    if (!building || !roomId) return null;

    // SSoT path — derive lease from the merged tenant doc + full lease record
    const ssotDoc = TenantConfigManager.getTenant(building, String(roomId));
    const ssotLease = ssotDoc?.lease;
    if (ssotLease && (ssotLease.status === 'active' || ssotLease.rentAmount || ssotLease.deposit || ssotLease.leaseId)) {
      // Phase 3d: tenant.lease is a reduced mirror — fetch full lease for
      // rentAmount/deposit/contractDocument/etc that the mirror no longer
      // carries. Falls back gracefully for old tenant docs that still hold
      // the legacy 11-field mirror.
      const leaseId = ssotLease.leaseId || ssotDoc.activeContractId;
      const fullLease = (leaseId && typeof LeaseAgreementManager !== 'undefined')
        ? (LeaseAgreementManager.getLease(leaseId) || {})
        : {};
      return {
        ...fullLease,
        ...ssotLease,
        // Re-merge fields that may exist in fullLease but not ssotLease
        rentAmount:       ssotLease.rentAmount       ?? fullLease.rentAmount       ?? null,
        deposit:          ssotLease.deposit          ?? fullLease.deposit          ?? null,
        contractDocument: ssotLease.contractDocument ?? fullLease.contractDocument ?? null,
        contractFileName: ssotLease.contractFileName ?? fullLease.contractFileName ?? null,
        documents:        ssotLease.documents        ?? fullLease.documents        ?? fullLease.documentURLs ?? null,
        building,
        roomId: String(roomId),
        tenantId: ssotDoc.tenantId,
        // Compatibility — flat fields for legacy consumers
        moveInDate: ssotLease.startDate || ssotLease.moveInDate || fullLease.startDate || fullLease.moveInDate,
        moveOutDate: ssotLease.endDate || ssotLease.moveOutDate || fullLease.endDate || fullLease.moveOutDate,
        tenantName: ssotDoc.name,
      };
    }

    // Legacy fallback
    return LeaseAgreementManager.getActiveLease(building, roomId);
  }

  // Search tenants across all buildings
  static searchAllTenants(keyword) {
    if (!keyword) return [];

    const rooms = TenantConfigManager.getTenantList('rooms');
    const nest = TenantConfigManager.getTenantList('nest');
    const all = [...(rooms || []), ...(nest || [])];

    return all.filter(t => {
      const name = (t.name || '').toLowerCase();
      const phone = (t.phone || '').toLowerCase();
      const idCard = (t.idCardNumber || '').toLowerCase();
      const keyword_lower = keyword.toLowerCase();

      return name.includes(keyword_lower) ||
             phone.includes(keyword_lower) ||
             idCard.includes(keyword_lower);
    });
  }

  // Get all active tenants in a building
  static getTenantsInBuilding(building) {
    if (!building) return [];

    const leases = Object.values(LeaseAgreementManager.getAllLeases())
      .filter(l => l.building === building && l.status === 'active');

    return leases
      .map(lease => {
        const tenant = TenantConfigManager.getTenant(building, lease.tenantId);
        return tenant ? {
          ...tenant,
          roomId: lease.roomId,
          lease: lease
        } : null;
      })
      .filter(Boolean);
  }

  // Get all tenants (both buildings) as flat list
  static getAllTenantsAcrossBuildings() {
    const rooms = TenantConfigManager.getTenantList('rooms') || [];
    const nest = TenantConfigManager.getTenantList('nest') || [];
    return [...rooms, ...nest];
  }

  // Get tenant count for building
  static getTenantCountInBuilding(building) {
    if (!building) return 0;
    const tenants = TenantConfigManager.getAllTenants(building);
    return Object.keys(tenants).length;
  }

  // Get occupancy info for a room
  static getRoomOccupancyInfo(building, roomId) {
    if (!building || !roomId) return null;

    const lease = this.getLeaseByRoom(building, roomId);
    const tenant = this.getTenantByRoom(building, roomId);
    const room = RoomConfigManager.getRoom(building, roomId);

    return {
      building,
      roomId,
      room: room || null,
      tenant: tenant || null,
      lease: lease || null,
      isOccupied: !!tenant,
      status: tenant ? 'occupied' : 'vacant'
    };
  }

  // Check if tenant exists in building
  static tenantExistsInBuilding(building, tenantId) {
    if (!building || !tenantId) return false;
    const tenant = TenantConfigManager.getTenant(building, tenantId);
    return !!tenant;
  }

  // Get rooms occupied by a tenant (across buildings)
  static getRoomsByTenant(tenantId) {
    if (!tenantId) return [];

    const leases = Object.values(LeaseAgreementManager.getAllLeases())
      .filter(l => l.tenantId === tenantId && l.status === 'active');

    return leases.map(lease => ({
      building: lease.building,
      roomId: lease.roomId,
      lease: lease
    }));
  }

  /**
   * Phase 3e: warm PersonManager cache for every tenantId visible in
   * TenantConfigManager. Called once at page load (dashboard + tenant_app)
   * so getTenantByRoom's sync overlay sees fresh person docs immediately.
   * Returns the count of fetched docs.
   */
  static async prefetchAllPeople() {
    if (!window.PersonManager) return 0;
    const ids = new Set();
    for (const b of ['rooms', 'nest']) {
      const tenants = TenantConfigManager.getAllTenants(b) || {};
      for (const key of Object.keys(tenants)) {
        const t = tenants[key];
        if (t?.tenantId) ids.add(String(t.tenantId));
      }
    }
    return window.PersonManager.prefetchByTenantIds([...ids]);
  }

  // Validate tenant data before save
  static validateTenantData(tenantData) {
    const errors = [];

    if (!tenantData.name || tenantData.name.trim() === '') {
      errors.push('ชื่อผู้เช่าเป็นข้อมูลที่จำเป็น');
    }

    if (tenantData.phone && !/^[0-9\s\-\+\(\)]*$/.test(tenantData.phone)) {
      errors.push('เบอร์โทรศัพท์ไม่ถูกต้อง');
    }

    if (tenantData.moveInDate && isNaN(new Date(tenantData.moveInDate))) {
      errors.push('วันเข้าอยู่ไม่ถูกต้อง');
    }

    if (tenantData.moveOutDate && tenantData.moveInDate) {
      if (new Date(tenantData.moveOutDate) < new Date(tenantData.moveInDate)) {
        errors.push('วันย้ายออกต้องหลังจากวันเข้าอยู่');
      }
    }

    if (tenantData.deposit !== undefined && tenantData.deposit < 0) {
      errors.push('เงินประกันต้องเป็นค่าบวก');
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }
}

// Make it available globally
window.TenantLookup = TenantLookup;
