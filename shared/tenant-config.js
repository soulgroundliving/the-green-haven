// Tenant Master Data Manager
// Centralized storage for all tenant information

class TenantConfigManager {
  static getAllTenants() {
    const stored = localStorage.getItem('tenant_master_data');
    return stored ? JSON.parse(stored) : {};
  }

  static saveTenants(data) {
    localStorage.setItem('tenant_master_data', JSON.stringify(data));
    console.log('✅ Tenant data saved');
  }

  static addTenant(tenantData) {
    // tenantData: {id, name, idCardNumber, phone, email, address}
    if (!tenantData.id || !tenantData.name) {
      console.warn('⚠️ Tenant ID and name are required');
      return false;
    }

    const tenants = this.getAllTenants();
    if (tenants[tenantData.id]) {
      console.warn(`⚠️ Tenant ${tenantData.id} already exists`);
      return false;
    }

    tenants[tenantData.id] = {
      ...tenantData,
      createdDate: new Date().toISOString()
    };
    this.saveTenants(tenants);
    console.log(`✅ Tenant ${tenantData.id} added: ${tenantData.name}`);
    return true;
  }

  static getTenant(tenantId) {
    const tenants = this.getAllTenants();
    return tenants[tenantId] || null;
  }

  static getTenantList() {
    const tenants = this.getAllTenants();
    return Object.values(tenants).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }

  static updateTenant(tenantId, updates) {
    const tenants = this.getAllTenants();
    if (!tenants[tenantId]) {
      console.warn(`⚠️ Tenant ${tenantId} not found`);
      return false;
    }

    tenants[tenantId] = { ...tenants[tenantId], ...updates };
    this.saveTenants(tenants);
    console.log(`✅ Tenant ${tenantId} updated`);
    return true;
  }

  static deleteTenant(tenantId) {
    const tenants = this.getAllTenants();
    if (!tenants[tenantId]) {
      console.warn(`⚠️ Tenant ${tenantId} not found`);
      return false;
    }

    delete tenants[tenantId];
    this.saveTenants(tenants);
    console.log(`✅ Tenant ${tenantId} deleted`);
    return true;
  }

  static getTenantsByBuilding(building) {
    // Get all leases for building, extract unique tenants
    if (typeof LeaseAgreementManager === 'undefined') {
      console.warn('⚠️ LeaseAgreementManager not loaded yet');
      return [];
    }

    const leases = LeaseAgreementManager.getAllLeases();
    const tenantIds = new Set();

    Object.values(leases).forEach(lease => {
      if (lease.building === building && lease.tenantId) {
        tenantIds.add(lease.tenantId);
      }
    });

    return Array.from(tenantIds)
      .map(id => this.getTenant(id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }

  static getTenantCount() {
    return Object.keys(this.getAllTenants()).length;
  }

  static searchTenants(keyword) {
    const tenants = this.getTenantList();
    const lowerKeyword = keyword.toLowerCase();
    return tenants.filter(t =>
      t.name.toLowerCase().includes(lowerKeyword) ||
      t.idCardNumber.includes(keyword) ||
      t.phone.includes(keyword)
    );
  }
}
