// Tenant Master Data Manager
// Centralized storage for all tenant information

// Prevent re-declaration errors when script is loaded multiple times
if (typeof TenantConfigManager === 'undefined') {
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
}
