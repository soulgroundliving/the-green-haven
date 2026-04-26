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
      return {
        ...ssotDoc,
        // Flat-field projection for legacy modal/card render code
        contractEnd: ssotDoc.contractEnd || lease.endDate || lease.moveOutDate || ssotDoc.moveOutDate || null,
        moveInDate:  ssotDoc.moveInDate  || lease.startDate || lease.moveInDate || null,
        moveOutDate: ssotDoc.moveOutDate || lease.endDate || lease.moveOutDate || null,
        deposit:     (ssotDoc.deposit !== undefined && ssotDoc.deposit !== null) ? ssotDoc.deposit : (lease.deposit ?? null),
        rentAmount:  ssotDoc.rentAmount ?? lease.rentAmount ?? null,
        // Field name aliases used by the modal populate code
        vehiclePlate: ssotDoc.vehiclePlate || ssotDoc.licensePlate || null,
      };
    }

    // Legacy fallback
    const lease = LeaseAgreementManager.getActiveLease(building, roomId);
    if (!lease || !lease.tenantId) return null;
    return TenantConfigManager.getTenant(building, lease.tenantId);
  }

  // Get lease for a room.
  // Phase 4 SSoT: lease subobject lives under tenants/{building}/list/{roomId}.lease
  static getLeaseByRoom(building, roomId) {
    if (!building || !roomId) return null;

    // SSoT path — derive lease from the merged tenant doc
    const ssotDoc = TenantConfigManager.getTenant(building, String(roomId));
    const ssotLease = ssotDoc?.lease;
    if (ssotLease && (ssotLease.status === 'active' || ssotLease.rentAmount || ssotLease.deposit)) {
      return {
        ...ssotLease,
        building,
        roomId: String(roomId),
        tenantId: ssotDoc.tenantId,
        // Compatibility — flat fields for legacy consumers
        moveInDate: ssotLease.startDate || ssotLease.moveInDate,
        moveOutDate: ssotLease.endDate || ssotLease.moveOutDate,
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
