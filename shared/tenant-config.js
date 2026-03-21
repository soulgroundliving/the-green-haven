// Tenant Master Data Manager
// Centralized storage for all tenant information

class TenantConfigManager {
  // Get all tenants from a specific building
  static getAllTenants(building) {
    const stored = localStorage.getItem('tenant_master_data');
    const data = stored ? JSON.parse(stored) : {};
    return data[building] || {};
  }

  // Get all data (all buildings)
  static getAllTenantsRaw() {
    const stored = localStorage.getItem('tenant_master_data');
    return stored ? JSON.parse(stored) : {};
  }

  // Save tenants for specific building
  static saveTenants(building, data) {
    const allData = this.getAllTenantsRaw();
    allData[building] = data;
    localStorage.setItem('tenant_master_data', JSON.stringify(allData));
    console.log(`✅ Tenant data saved for ${building}`);
  }

  // Add tenant to specific building
  static addTenant(building, tenantId, tenantData) {
    if (!building || !tenantId || !tenantData.name) {
      console.warn('⚠️ Building, tenant ID, and name are required');
      return false;
    }

    const tenants = this.getAllTenants(building);
    if (tenants[tenantId]) {
      console.warn(`⚠️ Tenant ${tenantId} already exists in ${building}`);
      return false;
    }

    tenants[tenantId] = {
      ...tenantData,
      id: tenantId,
      building: building,
      createdDate: new Date().toISOString()
    };

    this.saveTenants(building, tenants);
    console.log(`✅ Tenant ${tenantId} added to ${building}: ${tenantData.name}`);
    return true;
  }

  // Get tenant from specific building
  static getTenant(building, tenantId) {
    const tenants = this.getAllTenants(building);
    return tenants[tenantId] || null;
  }

  // Get all tenants from a building as list
  static getTenantList(building) {
    const tenants = this.getAllTenants(building);
    return Object.values(tenants).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  }

  // Update tenant in specific building
  static updateTenant(building, tenantId, updates) {
    const tenants = this.getAllTenants(building);
    if (!tenants[tenantId]) {
      console.warn(`⚠️ Tenant ${tenantId} not found in ${building}`);
      return false;
    }

    tenants[tenantId] = { ...tenants[tenantId], ...updates };
    this.saveTenants(building, tenants);
    console.log(`✅ Tenant ${tenantId} in ${building} updated`);
    return true;
  }

  // Delete tenant from specific building
  static deleteTenant(building, tenantId) {
    const tenants = this.getAllTenants(building);
    if (!tenants[tenantId]) {
      console.warn(`⚠️ Tenant ${tenantId} not found in ${building}`);
      return false;
    }

    delete tenants[tenantId];
    this.saveTenants(building, tenants);
    console.log(`✅ Tenant ${tenantId} deleted from ${building}`);
    return true;
  }

  // Get tenants in building via leases (for reference purposes)
  static getTenantsByBuilding(building) {
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
      .map(id => this.getTenant(building, id))
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  }

  static getTenantCount(building) {
    return Object.keys(this.getAllTenants(building)).length;
  }

  static searchTenants(building, keyword) {
    const tenants = this.getTenantList(building);
    const lowerKeyword = keyword.toLowerCase();
    return tenants.filter(t =>
      (t.name || '').toLowerCase().includes(lowerKeyword) ||
      (t.idCardNumber || '').includes(keyword) ||
      (t.phone || '').includes(keyword)
    );
  }

  // Get tenant by ID across any building (search helper)
  static getTenantByIdAnyBuilding(tenantId) {
    const rooms = this.getAllTenants('rooms');
    const nest = this.getAllTenants('nest');
    return rooms[tenantId] || nest[tenantId] || null;
  }

  static async saveTenantToFirebase(building, tenantId, tenantData) {
    // 1. Save to localStorage
    const success = this.addTenant(tenantData);

    // 2. Try Firebase in parallel
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`),
        tenantId
      );
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...tenantData,
        building,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`✅ Tenant ${tenantId} synced to Firebase`);
    } catch (error) {
      console.warn(`⚠️ Firebase sync failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }

  static async loadTenantsFromFirebase(building) {
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return this.getAllTenants();
      }

      const db = window.firebase.firestore();
      const collectionRef = window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`);
      const querySnap = await window.firebase.firestoreFunctions.getDocs(collectionRef);

      if (querySnap.size > 0) {
        const tenants = {};
        querySnap.forEach(doc => {
          tenants[doc.id] = doc.data();
        });
        // Save to localStorage as backup
        const stored = JSON.parse(localStorage.getItem('tenant_master_data') || '{}');
        stored[building] = tenants;
        localStorage.setItem('tenant_master_data', JSON.stringify(stored));
        console.log(`✅ Tenants for ${building} loaded from Firebase (${querySnap.size} items)`);
        return tenants;
      }
    } catch (error) {
      console.warn(`⚠️ Firebase load failed for tenants:`, error.message);
    }

    // Fallback to localStorage
    return this.getAllTenants();
  }

  static async updateTenantWithFirebase(tenantId, building, updates) {
    // 1. Update in localStorage
    const success = this.updateTenant(tenantId, updates);

    // 2. Try Firebase in parallel
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`),
        tenantId
      );
      await window.firebase.firestoreFunctions.updateDoc(docRef, {
        ...updates,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ Tenant ${tenantId} updated in Firebase`);
    } catch (error) {
      console.warn(`⚠️ Firebase update failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }

  static async deleteTenantWithFirebase(tenantId, building) {
    // 1. Delete from localStorage
    const success = this.deleteTenant(tenantId);

    // 2. Try Firebase in parallel
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`),
        tenantId
      );
      await window.firebase.firestoreFunctions.deleteDoc(docRef);
      console.log(`✅ Tenant ${tenantId} deleted from Firebase`);
    } catch (error) {
      console.warn(`⚠️ Firebase delete failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }
}
