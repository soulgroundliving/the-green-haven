/**
 * Tenant System - Consolidated Tenant Management
 * Consolidates: tenant-config.js, tenant-manager.js, tenant-firebase-sync.js
 * เธฃเธฐเธเธเธเธฑเธ”เธเธฒเธฃเธเนเธญเธกเธนเธฅเธเธนเนเน€เธเนเธฒ เน€เธฃเธงเธกเธจเธนเธเธขเนเธเธฒเธเนเธเธฅเนเธชเธฒเธกเนเธเธฅเน
 *
 * Part 1: TenantConfigManager - Master data storage and CRUD operations
 * Part 2: TenantManager - Tenant data loading utilities for tenant app
 * Part 3: TenantFirebaseSync - Firebase real-time synchronization
 */

// ============================================================================
// PART 1: TENANT CONFIG MANAGER - Master Tenant Data Storage
// ============================================================================

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
  }

  // Add tenant to specific building
  static addTenant(building, tenantId, tenantData) {
    if (!building || !tenantId || !tenantData.name) {
      console.warn('โ ๏ธ Building, tenant ID, and name are required');
      return false;
    }

    const tenants = this.getAllTenants(building);
    if (tenants[tenantId]) {
      console.warn(`โ ๏ธ Tenant ${tenantId} already exists in ${building}`);
      return false;
    }

    tenants[tenantId] = {
      ...tenantData,
      id: tenantId,
      building: building,
      createdDate: new Date().toISOString()
    };

    this.saveTenants(building, tenants);
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
      console.warn(`โ ๏ธ Tenant ${tenantId} not found in ${building}`);
      return false;
    }

    const updatedTenants = { ...tenants, [tenantId]: { ...tenants[tenantId], ...updates } };
    this.saveTenants(building, updatedTenants);
    return true;
  }

  // Delete tenant from specific building
  static deleteTenant(building, tenantId) {
    const tenants = this.getAllTenants(building);
    if (!tenants[tenantId]) {
      console.warn(`โ ๏ธ Tenant ${tenantId} not found in ${building}`);
      return false;
    }

    const updatedTenants = Object.fromEntries(Object.entries(tenants).filter(([k]) => k !== tenantId));
    this.saveTenants(building, updatedTenants);
    return true;
  }

  // Get tenants in building via leases (for reference purposes)
  static getTenantsByBuilding(building) {
    if (typeof LeaseAgreementManager === 'undefined') {
      console.warn('โ ๏ธ LeaseAgreementManager not loaded yet');
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

  // Phase 4 SSoT: extract roomId from tenantId pattern TENANT_<ts>_<roomId>
  // (or use tenantData.roomId if present). Used to write to canonical key.
  static _resolveRoomId(tenantId, tenantData) {
    if (tenantData && tenantData.roomId) return String(tenantData.roomId);
    const m = String(tenantId || '').match(/^TENANT_\d+_(.+)$/);
    return m ? m[1] : (tenantId ? String(tenantId) : null);
  }

  static async saveTenantToFirebase(building, tenantId, tenantData) {
    // 1. Save to localStorage
    const success = this.addTenant(building, tenantId, tenantData);

    // 2. Phase 4 SSoT: write to tenants/{building}/list/{roomId} (canonical key)
    //    instead of {tenantId}. Store tenantId as a field inside the doc.
    try {
      if (!window.firebase) {
        console.warn('โ ๏ธ Firebase not loaded');
        return success;
      }

      const roomId = TenantConfigManager._resolveRoomId(tenantId, tenantData);
      if (!roomId) {
        console.warn(`โ ๏ธ Cannot resolve roomId from tenantId=${tenantId}, skipping Firestore sync`);
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`),
        roomId
      );
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...tenantData,
        tenantId,
        building,
        roomId,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.warn(`โ ๏ธ Firebase sync failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }

  static async loadTenantsFromFirebase(building) {
    try {
      if (!window.firebase) {
        return this.getAllTenants(building);
      }

      // Skip if not authenticated โ€” Firestore rules require auth
      if (!window.firebaseAuth?.currentUser) {
        return this.getAllTenants(building);
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
        return tenants;
      }
    } catch (error) {
      console.warn(`โ ๏ธ Firebase load failed for tenants:`, error.message);
    }

    // Fallback to localStorage
    return this.getAllTenants(building);
  }

  static async updateTenantWithFirebase(building, tenantId, updates) {
    // 1. Update in localStorage
    const success = this.updateTenant(building, tenantId, updates);

    // 2. Phase 4 SSoT: write to canonical roomId-keyed doc. Pull current tenant
    //    record from localStorage to resolve roomId (older callers don't pass it).
    try {
      if (!window.firebase) {
        console.warn('โ ๏ธ Firebase not loaded');
        return success;
      }

      const current = this.getTenant(building, tenantId) || {};
      const roomId = TenantConfigManager._resolveRoomId(tenantId, { ...current, ...updates });
      if (!roomId) {
        console.warn(`โ ๏ธ Cannot resolve roomId from tenantId=${tenantId}, skipping Firestore sync`);
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `tenants/${building}/list`),
        roomId
      );
      // setDoc(merge:true) so first write also creates the canonical doc.
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...updates,
        tenantId,
        building,
        roomId,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.warn(`โ ๏ธ Firebase update failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }

  static async deleteTenantWithFirebase(building, tenantId) {
    // 1. Delete from localStorage
    const success = this.deleteTenant(building, tenantId);

    // 2. Phase 4 SSoT: delete the canonical roomId-keyed doc.
    //    Don't delete the doc itself โ€” clear identity fields only, so linkedAuthUid
    //    + lease history archive references survive. Admin can re-assign tenant later.
    try {
      if (!window.firebase) {
        console.warn('โ ๏ธ Firebase not loaded');
        return success;
      }

      const current = this.getTenant(building, tenantId) || {};
      const roomId = TenantConfigManager._resolveRoomId(tenantId, current);
      if (!roomId) return success;

      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const docRef = fs.doc(fs.collection(db, `tenants/${building}/list`), roomId);
      // Mark moved-out instead of deleting (preserves linkedAuthUid + history)
      await fs.setDoc(docRef, {
        tenantId: null,
        name: null,
        firstName: null,
        lastName: null,
        phone: null,
        email: null,
        licensePlate: null,
        idCardNumber: null,
        address: null,
        notes: null,
        lineID: null,
        moveInDate: null,
        moveOutDate: null,
        deposit: null,
        contractDocument: null,
        contractFileName: null,
        companyInfo: null,
        receiptType: null,
        lease: { status: 'empty' },
        movedOutAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.warn(`โ ๏ธ Firebase delete failed for tenant ${tenantId}:`, error.message);
    }

    return success;
  }
}

// ============================================================================
// PART 2: TENANT MANAGER - Tenant Data Loading for Tenant App
// ============================================================================

class TenantManager {
  /**
   * Load full tenant data for a specific room
   * Returns: { tenant, lease, room, building }
   */
  static loadTenantDataForRoom(building, roomId) {
    try {
      // Get active lease for the room
      if (typeof LeaseAgreementManager === 'undefined') {
        console.warn('โ ๏ธ LeaseAgreementManager not loaded');
        return null;
      }

      const lease = LeaseAgreementManager.getActiveLease(building, roomId);
      if (!lease || !lease.tenantId) {
        console.warn(`โ ๏ธ No active lease found for ${building}/${roomId}`);
        return null;
      }

      // Get tenant info
      const tenant = typeof TenantConfigManager !== 'undefined'
        ? TenantConfigManager.getTenant(building, lease.tenantId)
        : null;

      // Get room info
      const room = typeof RoomConfigManager !== 'undefined'
        ? RoomConfigManager.getRoom(building, roomId)
        : null;

      return {
        tenant,
        lease,
        room,
        building,
        roomId
      };
    } catch (error) {
      console.error('Error loading tenant data:', error);
      return null;
    }
  }

  /**
   * Get display name for tenant
   */
  static getTenantDisplayName(tenantData) {
    return tenantData?.tenant?.name || 'เธเธนเนเน€เธเนเธฒ';
  }

  /**
   * Get room display info
   */
  static getRoomDisplayInfo(tenantData) {
    const { room, roomId, building } = tenantData;
    const roomName = room?.name || `เธซเนเธญเธ ${roomId}`;
    const floor = Math.floor(parseInt(roomId.replace(/[^0-9]/g, '')) / 100) || 1;

    return {
      name: roomName,
      id: roomId,
      floor,
      building,
      rentPrice: room?.rentPrice || 5900,
      waterRate: room?.waterRate || 20,
      electricRate: room?.electricRate || 8
    };
  }

  /**
   * Get lease info for display
   */
  static getLeaseDisplayInfo(tenantData) {
    const { lease } = tenantData;
    if (!lease) return null;

    return {
      startDate: lease.moveInDate,
      endDate: lease.moveOutDate,
      rentAmount: lease.rentAmount || 5900,
      deposit: lease.deposit || 0,
      status: lease.status,
      tenantName: lease.tenantName
    };
  }

  /**
   * Load bills for tenant (mock - will be replaced with real API)
   */
  static loadBillsForTenant(roomId) {
    // Check if bills exist in localStorage
    const stored = localStorage.getItem(`bills_${roomId}`);
    if (stored) {
      return JSON.parse(stored);
    }

    // Return mock bills
    return [
      {
        id: 'BILL_202606_01',
        month: 'June',
        year: 2026,
        rent: 5900,
        electric: 820,
        water: 120,
        trash: 40,
        total: 6880,
        status: 'pending',
        dueDate: '2026-06-05',
        createdDate: '2026-05-28'
      },
      {
        id: 'BILL_202605_01',
        month: 'May',
        year: 2026,
        rent: 5900,
        electric: 750,
        water: 100,
        trash: 40,
        total: 6790,
        status: 'paid',
        dueDate: '2026-05-05',
        createdDate: '2026-04-28',
        paidDate: '2026-05-04'
      },
      {
        id: 'BILL_202604_01',
        month: 'April',
        year: 2026,
        rent: 5900,
        electric: 690,
        water: 110,
        trash: 40,
        total: 6740,
        status: 'paid',
        dueDate: '2026-04-05',
        createdDate: '2026-03-28',
        paidDate: '2026-04-03'
      }
    ];
  }

  /**
   * Get next bill due (pending bill with earliest due date)
   */
  static getNextBillDue(bills) {
    return bills.find(b => b.status === 'pending') || null;
  }

  /**
   * Get payment status summary
   */
  static getPaymentStatusSummary(bills) {
    return {
      total: bills.length,
      paid: bills.filter(b => b.status === 'paid').length,
      pending: bills.filter(b => b.status === 'pending').length,
      overdue: bills.filter(b => b.status === 'overdue').length
    };
  }

  /**
   * Load maintenance tickets for tenant
   */
  static loadMaintenanceTickets() {
    const stored = localStorage.getItem('tenant_maintenance_tickets');
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Create new maintenance ticket
   */
  static createMaintenanceTicket(category, description, photoData = null) {
    const ticket = {
      id: `T${Date.now()}`,
      date: new Date().toLocaleDateString('th-TH'),
      category: category,
      description: description,
      photo: photoData,
      status: 'pending',
      submittedDate: new Date().toISOString(),
      updates: []
    };

    let tickets = this.loadMaintenanceTickets();
    tickets.push(ticket);
    localStorage.setItem('tenant_maintenance_tickets', JSON.stringify(tickets));

    return ticket;
  }

  /**
   * Get maintenance ticket by ID
   */
  static getMaintenanceTicket(ticketId) {
    const tickets = this.loadMaintenanceTickets();
    return tickets.find(t => t.id === ticketId);
  }

  /**
   * Update maintenance ticket status
   */
  static updateTicketStatus(ticketId, newStatus) {
    let tickets = this.loadMaintenanceTickets();
    const ticket = tickets.find(t => t.id === ticketId);

    if (ticket) {
      ticket.status = newStatus;
      ticket.updates = ticket.updates || [];
      ticket.updates.push({
        status: newStatus,
        date: new Date().toISOString()
      });
      localStorage.setItem('tenant_maintenance_tickets', JSON.stringify(tickets));
      return ticket;
    }

    return null;
  }

  /**
   * Load announcements
   */
  static loadAnnouncements() {
    const stored = localStorage.getItem('announcements');
    if (stored) {
      return JSON.parse(stored);
    }

    // Return mock announcements
    return [
      {
        id: 'ANN_001',
        title: 'เนเธเนเธเธเธดเธ”เธเนเธณ',
        date: '2026-06-15',
        time: '10:00 - 14:00',
        icon: '๐’ง',
        content: 'เธกเธตเธเธฒเธฃเธ”เธณเน€เธเธดเธเธเธฒเธฃเธเนเธญเธกเธ—เนเธญเธเนเธณเนเธเธญเธฒเธเธฒเธฃเธเธถเธเธ•เนเธญเธเธเธดเธ”เธเนเธณ',
        priority: 'high',
        createdDate: '2026-06-10'
      },
      {
        id: 'ANN_002',
        title: 'เธ—เธณเธเธงเธฒเธกเธชเธฐเธญเธฒเธ”เนเธซเธเน',
        date: '2026-06-20',
        time: 'all day',
        icon: '๐งน',
        content: 'เธเธฒเธฃเธ—เธณเธเธงเธฒเธกเธชเธฐเธญเธฒเธ”เธชเธ–เธฒเธเธ—เธตเนเธ—เธฑเนเธงเนเธเนเธเธญเธฒเธเธฒเธฃ',
        priority: 'normal',
        createdDate: '2026-06-12'
      },
      {
        id: 'ANN_003',
        title: 'เธเนเธญเธกเธฅเธดเธเธ•เน',
        date: '2026-06-22',
        time: '08:00 - 12:00',
        icon: '๐”ง',
        content: 'เธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเนเธฅเธฐเธเธณเธฃเธธเธเธฃเธฑเธเธฉเธฒเธฃเธฐเธเธเธฅเธดเธเธ•เน',
        priority: 'normal',
        createdDate: '2026-06-14'
      }
    ];
  }

  /**
   * Format date for Thai locale
   */
  static formatThaiDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Format currency for Thai locale
   */
  static formatThaiCurrency(amount) {
    return amount.toLocaleString('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Calculate days until due date
   */
  static daysUntilDue(dueDate) {
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = due - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Get bill status with color
   */
  static getBillStatusDisplay(bill) {
    if (bill.status === 'paid') {
      return { icon: 'โ…', text: 'เธเนเธฒเธขเนเธฅเนเธง', color: 'green' };
    } else if (bill.status === 'overdue') {
      return { icon: 'โ ๏ธ', text: 'เน€เธเธดเธเธเธณเธซเธเธ”', color: 'red' };
    } else {
      const daysLeft = this.daysUntilDue(bill.dueDate);
      return { icon: 'โณ', text: `เธฃเธญเธเธณเธฃเธฐ (${daysLeft} เธงเธฑเธ)`, color: 'orange' };
    }
  }

  /**
   * Sync tenant data with Firebase
   */
  static async syncTenantDataToFirebase(uid, tenantData) {
    try {
      if (!window.firebase) {
        console.warn('โ ๏ธ Firebase not loaded');
        return false;
      }

      const db = window.firebase.firestore();
      const userRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, 'users'),
        uid.replace(/[.@]/g, '_')
      );

      await window.firebase.firestoreFunctions.setDoc(userRef, {
        tenant: tenantData,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return true;
    } catch (error) {
      console.warn('โ ๏ธ Firebase sync failed:', error);
      return false;
    }
  }

  /**
   * Load tenant data from Firebase
   */
  static async loadTenantDataFromFirebase(uid) {
    try {
      if (!window.firebase) {
        console.warn('โ ๏ธ Firebase not loaded');
        return null;
      }

      const db = window.firebase.firestore();
      const userRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, 'users'),
        uid.replace(/[.@]/g, '_')
      );

      const userSnap = await window.firebase.firestoreFunctions.getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        return data.tenant || null;
      }

      return null;
    } catch (error) {
      console.warn('โ ๏ธ Firebase load failed:', error);
      return null;
    }
  }

  /**
   * Calculate bill from meter data, rates, and lease info
   * Combines: meter readings + rates + rent + tenant info into a complete bill
   */
  static calculateBillFromMeters(building, roomId, yearMonth) {
    try {
      // 1. Get meter data
      const meterKey = `${building}_${roomId}_${yearMonth}`;
      const allMeters = JSON.parse(localStorage.getItem('meter_data') || '{}');
      const meterData = allMeters[meterKey];

      if (!meterData) {
        console.warn(`โ ๏ธ No meter data found for ${meterKey}`);
        return null;
      }

      // 2. Get lease info (for rent)
      const lease = typeof LeaseAgreementManager !== 'undefined'
        ? LeaseAgreementManager.getActiveLease(building, roomId)
        : null;

      if (!lease) {
        console.warn(`โ ๏ธ No active lease for ${building}/${roomId}`);
        return null;
      }

      // 3. Get room rates
      const room = typeof RoomConfigManager !== 'undefined'
        ? RoomConfigManager.getRoom(building, roomId)
        : null;

      const electricRate = room?.electricRate || 8; // Default fallback
      const waterRate = room?.waterRate || 20; // Default fallback

      // 4. Get tenant info
      const tenant = typeof TenantConfigManager !== 'undefined'
        ? TenantConfigManager.getTenant(building, lease.tenantId)
        : null;

      // 5. Calculate usage and charges
      const eUsage = meterData.eNew - meterData.eOld;
      const wUsage = meterData.wNew - meterData.wOld;

      const eCharge = eUsage * electricRate;
      const wCharge = wUsage * waterRate;
      const rent = lease.rentAmount || 1500;
      const trash = 40; // Fixed trash fee

      const total = rent + eCharge + wCharge + trash;

      // 6. Build complete bill object
      return {
        // Bill meta
        billId: meterKey,
        building,
        roomId,
        year: meterData.year,
        month: meterData.month,
        yearMonth: meterData.yearMonth,

        // Meter readings
        electricity: {
          old: meterData.eOld,
          new: meterData.eNew,
          usage: eUsage,
          rate: electricRate,
          charge: eCharge
        },
        water: {
          old: meterData.wOld,
          new: meterData.wNew,
          usage: wUsage,
          rate: waterRate,
          charge: wCharge
        },

        // Charges breakdown
        charges: {
          rent,
          electricity: eCharge,
          water: wCharge,
          trash,
          total
        },

        // Tenant info
        tenant: {
          id: lease.tenantId,
          name: tenant?.name || 'เธเธนเนเน€เธเนเธฒ',
          phone: tenant?.phone || '-',
          email: tenant?.email || '-',
          address: tenant?.address || '-'
        },

        // Lease info
        lease: {
          startDate: lease.moveInDate,
          endDate: lease.moveOutDate,
          deposit: lease.deposit,
          rentAmount: lease.rentAmount
        },

        // Metadata
        createdAt: meterData.createdAt,
        updatedAt: meterData.updatedAt,
        status: 'pending' // pending, paid, overdue
      };
    } catch (error) {
      console.error('Error calculating bill from meters:', error);
      return null;
    }
  }

  /**
   * Get all bills for a room (for a date range or month)
   */
  static getBillsForRoom(building, roomId, year, month) {
    try {
      const bills = [];
      const yearMonth = `${year}_${String(month).padStart(2, '0')}`;
      const meterKey = `${building}_${roomId}_${yearMonth}`;

      // Get meter data
      const allMeters = JSON.parse(localStorage.getItem('meter_data') || '{}');

      // If specific month requested
      if (year && month) {
        const bill = this.calculateBillFromMeters(building, roomId, yearMonth);
        if (bill) bills.push(bill);
      } else {
        // Get all bills for this room
        for (const [key, meterData] of Object.entries(allMeters)) {
          if (key.includes(`${building}_${roomId}`)) {
            const bill = this.calculateBillFromMeters(building, roomId, meterData.yearMonth);
            if (bill) bills.push(bill);
          }
        }
      }

      return bills.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    } catch (error) {
      console.error('Error getting bills for room:', error);
      return [];
    }
  }
}


// ============================================================================
// BACKWARD COMPATIBILITY & GLOBAL EXPORTS
// ============================================================================

window.TenantConfigManager = TenantConfigManager;
window.TenantManager = TenantManager;
// TenantFirebaseSync is exported from tenant-firebase-sync.js

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TenantConfigManager, TenantManager };
}
