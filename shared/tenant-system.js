/**
 * Tenant System - Consolidated Tenant Management
 * Consolidates: tenant-config.js, tenant-manager.js, tenant-firebase-sync.js
 * ระบบจัดการข้อมูลผู้เช่า เรวมศูนย์จากไฟล์สามไฟล์
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
    const success = this.addTenant(building, tenantId, tenantData);

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
        return this.getAllTenants(building);
      }

      // Skip if not authenticated — Firestore rules require auth
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
        console.log(`✅ Tenants for ${building} loaded from Firebase (${querySnap.size} items)`);
        return tenants;
      }
    } catch (error) {
      console.warn(`⚠️ Firebase load failed for tenants:`, error.message);
    }

    // Fallback to localStorage
    return this.getAllTenants(building);
  }

  static async updateTenantWithFirebase(building, tenantId, updates) {
    // 1. Update in localStorage
    const success = this.updateTenant(building, tenantId, updates);

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

  static async deleteTenantWithFirebase(building, tenantId) {
    // 1. Delete from localStorage
    const success = this.deleteTenant(building, tenantId);

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
        console.warn('⚠️ LeaseAgreementManager not loaded');
        return null;
      }

      const lease = LeaseAgreementManager.getActiveLease(building, roomId);
      if (!lease || !lease.tenantId) {
        console.warn(`⚠️ No active lease found for ${building}/${roomId}`);
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
    return tenantData?.tenant?.name || 'ผู้เช่า';
  }

  /**
   * Get room display info
   */
  static getRoomDisplayInfo(tenantData) {
    const { room, roomId, building } = tenantData;
    const roomName = room?.name || `ห้อง ${roomId}`;
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
        title: 'แจ้งปิดน้ำ',
        date: '2026-06-15',
        time: '10:00 - 14:00',
        icon: '💧',
        content: 'มีการดำเนินการซ่อมท่อน้ำในอาคารจึงต้องปิดน้ำ',
        priority: 'high',
        createdDate: '2026-06-10'
      },
      {
        id: 'ANN_002',
        title: 'ทำความสะอาดใหญ่',
        date: '2026-06-20',
        time: 'all day',
        icon: '🧹',
        content: 'การทำความสะอาดสถานที่ทั่วไปในอาคาร',
        priority: 'normal',
        createdDate: '2026-06-12'
      },
      {
        id: 'ANN_003',
        title: 'ซ่อมลิฟต์',
        date: '2026-06-22',
        time: '08:00 - 12:00',
        icon: '🔧',
        content: 'การตรวจสอบและบำรุงรักษาระบบลิฟต์',
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
      return { icon: '✅', text: 'จ่ายแล้ว', color: 'green' };
    } else if (bill.status === 'overdue') {
      return { icon: '⚠️', text: 'เกินกำหนด', color: 'red' };
    } else {
      const daysLeft = this.daysUntilDue(bill.dueDate);
      return { icon: '⏳', text: `รอชำระ (${daysLeft} วัน)`, color: 'orange' };
    }
  }

  /**
   * Sync tenant data with Firebase
   */
  static async syncTenantDataToFirebase(uid, tenantData) {
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
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

      console.log('✅ Tenant data synced to Firebase');
      return true;
    } catch (error) {
      console.warn('⚠️ Firebase sync failed:', error);
      return false;
    }
  }

  /**
   * Load tenant data from Firebase
   */
  static async loadTenantDataFromFirebase(uid) {
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
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
      console.warn('⚠️ Firebase load failed:', error);
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
        console.warn(`⚠️ No meter data found for ${meterKey}`);
        return null;
      }

      // 2. Get lease info (for rent)
      const lease = typeof LeaseAgreementManager !== 'undefined'
        ? LeaseAgreementManager.getActiveLease(building, roomId)
        : null;

      if (!lease) {
        console.warn(`⚠️ No active lease for ${building}/${roomId}`);
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
          name: tenant?.name || 'ผู้เช่า',
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
// PART 3: TENANT FIREBASE SYNC - Real-time Firebase Synchronization
// ============================================================================

class TenantFirebaseSync {
  static database = null;
  static currentUser = null;
  static currentBuilding = null;
  static currentRoom = null;

  /**
   * Initialize Firebase connection
   */
  static initialize(user, building, room) {
    try {
      if (!window.firebaseDatabase) {
        console.warn('⚠️ Firebase Database not initialized. Waiting for Firebase module...');
        return false;
      }

      this.database = window.firebaseDatabase;
      this.currentUser = user;
      this.currentBuilding = building;
      this.currentRoom = room;

      console.log('✅ TenantFirebaseSync initialized for', { building, room });
      return true;
    } catch (error) {
      console.error('❌ Firebase initialization error:', error);
      return false;
    }
  }

  /**
   * Load tenant lease information from Firestore meta_data collection
   * Priority: Firestore FIRST → localStorage FALLBACK
   */
  // Map code building name → Firestore building name
  //   'rooms' → 'RentRoom'  (ตึกแถว)
  //   'nest'  → 'nest'       (ตึก Nest)
  // Room IDs: ใช้ตามที่ admin ตั้งใน Firestore ตรงๆ (เช่น '15ก', 'ร้านใหญ่' ภาษาไทย)
  // หาก Firestore docId ไม่ตรง → loadLease() คืน null + console แจ้ง path ที่ค้น
  static _fsBuilding(b) { return b === 'rooms' ? 'RentRoom' : b; }
  static _fsRoomId(r) { return r; }

  static async loadLease() {
    try {
      // Firestore: buildings/{RentRoom|nest}/rooms/{roomId}
      // Document has nested `.lease` + `.operations` + `.metadata`
      if (window.firebase?.firestore) {
        try {
          const fsBuilding = TenantFirebaseSync._fsBuilding(this.currentBuilding);
          const fsRoomId   = TenantFirebaseSync._fsRoomId(this.currentRoom);
          console.log(`🔍 TenantFirebaseSync: Checking buildings/${fsBuilding}/rooms/${fsRoomId}`);
          const db = window.firebase.firestore();
          const fs = window.firebase.firestoreFunctions;

          // 3-segment path: collection('buildings') → doc(fsBuilding) → collection('rooms') → doc(fsRoomId)
          const docRef = fs.doc(db, 'buildings', fsBuilding, 'rooms', fsRoomId);
          const docSnap = await fs.getDoc(docRef);

          if (docSnap.exists()) {
            const roomData = docSnap.data();
            // ดึง lease subsection + map fields เข้ากับที่ tenant_app ใช้
            const lease = roomData.lease || {};
            const ops = roomData.operations || {};
            const t = roomData.tenant || roomData.personalInfo || {};
            const leaseData = {
              building: this.currentBuilding,
              roomId: this.currentRoom,
              rentAmount: lease.rentAmount ?? 0,
              deposit: lease.deposit ?? 0,
              moveInDate: lease.moveInDate,
              moveOutDate: lease.moveOutDate,
              endDate: lease.moveOutDate,
              startDate: lease.moveInDate,
              status: lease.status || 'empty',
              contractDocument: lease.contractDocument,
              tenantId: ops.tenantId,
              billingCycle: ops.billingCycle ?? 1,
              emergencyContact: ops.emergencyContact,
              // Tenant personal info (user confirm stored in same room doc)
              name: t.name || t.fullName || ops.tenantName,
              phone: t.phone || t.tel || ops.tenantPhone,
              email: t.email || ops.tenantEmail,
              licensePlate: t.licensePlate || ops.plateNumber,
              companyInfo: t.companyInfo || roomData.companyInfo,
              receiptType: t.receiptType || roomData.receiptType,
              _raw: roomData,
            };
            console.log(`✅ TenantFirebaseSync: Loaded from buildings/${fsBuilding}/rooms/${fsRoomId}:`, leaseData);
            return leaseData;
          } else {
            console.log(`   ℹ️ No data at buildings/${fsBuilding}/rooms/${fsRoomId}`);
          }

          // Backward-compat: try old meta_data path (เผื่อบาง room ยังอยู่ที่เดิม)
          const legacyRef = fs.doc(fs.collection(db, 'meta_data'), this.currentRoom);
          const legacySnap = await fs.getDoc(legacyRef);
          if (legacySnap.exists()) {
            console.log(`✅ Fallback: loaded from legacy meta_data/${this.currentRoom}`);
            return legacySnap.data();
          }
        } catch (e) {
          console.debug(`  ❌ Firestore query failed:`, e.message);
        }

        console.log(`ℹ️ No lease data found in Firestore, falling back to localStorage`);
      } else {
        console.warn('⚠️ Firestore not available, using localStorage fallback');
      }

      // Fallback: Try to get from LeaseAgreementManager (localStorage)
      if (typeof LeaseAgreementManager !== 'undefined') {
        const lease = LeaseAgreementManager.getActiveLease(this.currentBuilding, this.currentRoom);
        if (lease) {
          console.log('✅ Loaded lease from localStorage (fallback):', lease);
          return lease;
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading lease:', error);
      return null;
    }
  }

  /**
   * Load tenant personal information from Firebase
   * Path: data/{building}/{room}
   */
  static async loadTenant(tenantId) {
    try {
      // Try localStorage first - TenantConfigManager requires building parameter
      if (typeof TenantConfigManager !== 'undefined' && this.currentBuilding) {
        const tenant = TenantConfigManager.getTenant(this.currentBuilding, tenantId);
        if (tenant) {
          console.log('✅ Loaded tenant from localStorage:', tenant);
          return tenant;
        }
      }

      // For tenant app, tenant data is in the room object at data/{building}/{room}
      // So we load it when we load the lease
      const lease = await this.loadLease();
      if (lease) {
        // The lease object contains basic tenant info (tenantName, rent, etc.)
        // But for phone, email, address, we need the full tenant record
        console.log('✅ Loaded tenant from lease data:', lease);
        return lease;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading tenant:', error);
      return null;
    }
  }

  /**
   * Load room configuration (rates, rent) from Firebase
   * Path: rooms_config/{building}/{room}
   */
  static async loadRoom() {
    try {
      // Try localStorage first
      if (typeof RoomConfigManager !== 'undefined') {
        const room = RoomConfigManager.getRoom(this.currentBuilding, this.currentRoom);
        if (room) {
          console.log('✅ Loaded room from localStorage:', room);
          return room;
        }
      }

      // Load from Firebase
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        return null;
      }

      const roomRef = window.firebaseRef(this.database,
        `rooms_config/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await window.firebaseGet(roomRef);

      if (snapshot.exists()) {
        const roomData = snapshot.val();
        console.log('✅ Loaded room from Firebase:', roomData);
        return roomData;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading room:', error);
      return null;
    }
  }

  /**
   * Load meter data directly from Firebase
   * Returns structure: {year: {monthKey: {roomId: {eNew, wNew, ...}}}}
   */
  static async loadMeterDataFromFirebase() {
    try {
      if (!window.firebase?.firestore) {
        console.warn('⚠️ Firebase Firestore not initialized');
        return {};
      }

      // Determine which years to load (current and previous years)
      const currentDate = new Date();
      const currentBudYear = currentDate.getFullYear() + 543;
      const yearsToLoad = [currentBudYear - 2, currentBudYear - 1, currentBudYear];
      const yearsToLoadShort = yearsToLoad.map(y => y % 100);

      console.log(`🔄 TenantFirebaseSync: Loading meter data from Firebase for building='${this.currentBuilding}'...`);

      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const allMeterData = {};

      // Try to load meter data for all years
      for (const year of yearsToLoad.concat(yearsToLoadShort)) {
        try {
          const q = fs.query(
            fs.collection(db, 'meter_data'),
            fs.where('building', '==', this.currentBuilding),
            fs.where('year', '==', year)
          );

          const querySnap = await fs.getDocs(q);

          if (querySnap.size > 0) {
            const yearKey = String(year).length === 2 ? (2500 + year) : year;
            if (!allMeterData[yearKey]) {
              allMeterData[yearKey] = {};
            }

            querySnap.forEach(doc => {
              const data = doc.data();
              const monthKey = `${yearKey}-${String(data.month).padStart(2, '0')}`;
              const roomId = data.roomId;

              if (!allMeterData[yearKey][monthKey]) {
                allMeterData[yearKey][monthKey] = {};
              }

              allMeterData[yearKey][monthKey][roomId] = {
                currentWater: data.wNew || 0,
                currentElectric: data.eNew || 0,
                waterStart: data.wOld || 0,
                electricStart: data.eOld || 0,
                eOld: data.eOld || 0,
                eNew: data.eNew || 0,
                wOld: data.wOld || 0,
                wNew: data.wNew || 0,
                recordedDate: data.updatedAt || data.createdAt || new Date().toISOString()
              };
            });

            console.log(`   ✅ Loaded meter data for year ${year}`);
          }
        } catch (e) {
          console.debug(`   ℹ️ No meter data for year ${year}: ${e.message}`);
        }
      }

      if (Object.keys(allMeterData).length > 0) {
        console.log('✅ TenantFirebaseSync: Meter data loaded from Firebase');
        return allMeterData;
      } else {
        console.warn('⚠️ TenantFirebaseSync: No meter data found in Firebase');
        return {};
      }
    } catch (error) {
      console.error('❌ Error loading meter data from Firebase:', error);
      return {};
    }
  }

  /**
   * Load bills from both TenantManager (meter data) and Firebase (generated bills)
   * Combines both sources to show all available bills
   */
  static async loadBills() {
    try {
      const allBills = [];
      const billIds = new Set(); // Track bill IDs to avoid duplicates

      // Load bills from TenantManager (calculates from meter data)
      if (typeof TenantManager !== 'undefined') {
        const meterBills = TenantManager.getBillsForRoom(this.currentBuilding, this.currentRoom);
        if (meterBills && meterBills.length > 0) {
          console.log(`✅ Loaded ${meterBills.length} bills from TenantManager (meter data)`);
          allBills.push(...meterBills);
          meterBills.forEach(b => billIds.add(b.billId || b.id));
        }
      }

      // Also load from Firebase bills collection (admin-generated bills)
      if (this.database && window.firebaseRef && window.firebaseGet) {
        try {
          const billsRef = window.firebaseRef(this.database,
            `bills/${this.currentBuilding}/${this.currentRoom}`);
          const snapshot = await window.firebaseGet(billsRef);

          if (snapshot.exists()) {
            const firebaseBills = Object.values(snapshot.val() || {});
            console.log(`✅ Loaded ${firebaseBills.length} bills from Firebase`);

            // Add Firebase bills that aren't already in the list
            firebaseBills.forEach(fbBill => {
              if (!billIds.has(fbBill.billId)) {
                allBills.push(fbBill);
                billIds.add(fbBill.billId);
              }
            });
          }
        } catch (e) {
          // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
          if (!/permission/i.test(e?.message || '')) {
            console.warn(`⚠️ Firebase bill loading failed: ${e.message}`);
          }
        }
      }

      // Sort by date (newest first)
      return allBills.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.billDate || 0);
        const dateB = new Date(b.createdAt || b.billDate || 0);
        return dateB - dateA;
      });
    } catch (error) {
      // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
      if (!/permission/i.test(error?.message || '')) {
        console.error('❌ Error loading bills:', error);
      }
      return [];
    }
  }

  /**
   * Subscribe to real-time bill updates from RTDB.
   * Calls callback whenever bills/{building}/{room} changes.
   * Returns unsubscribe function. Use one-shot loadBills() for initial render,
   * then subscribeBills() to receive updates while the user has the app open.
   */
  static subscribeBills(callback) {
    if (!this.database || !window.firebaseRef || !window.firebaseOnValue) {
      console.warn('⚠️ Firebase not available for bill subscription');
      return () => {};
    }
    try {
      const billsRef = window.firebaseRef(this.database, `bills/${this.currentBuilding}/${this.currentRoom}`);
      const unsub = window.firebaseOnValue(billsRef, (snapshot) => {
        if (snapshot.exists()) {
          const bills = Object.values(snapshot.val() || {});
          callback(bills);
        } else {
          callback([]);
        }
      }, (err) => {
        // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
        if (!/permission/i.test(err?.message || '')) {
          console.warn('⚠️ subscribeBills error:', err.message);
        }
      });
      return typeof unsub === 'function' ? unsub : () => {};
    } catch (e) {
      if (!/permission/i.test(e?.message || '')) {
        console.warn('⚠️ subscribeBills failed:', e.message);
      }
      return () => {};
    }
  }

  /**
   * Load payment history from Firebase
   */
  static async loadPaymentHistory() {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        return [];
      }

      const paymentsRef = window.firebaseRef(this.database,
        `payments/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await window.firebaseGet(paymentsRef);

      if (snapshot.exists()) {
        const paymentsData = Object.values(snapshot.val() || {});
        console.log(`✅ Loaded ${paymentsData.length} payments from Firebase`);
        return paymentsData.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
      }

      return [];
    } catch (error) {
      // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
      if (!/permission/i.test(error?.message || '')) {
        console.error('❌ Error loading payment history:', error);
      }
      return [];
    }
  }

  /**
   * Load maintenance tickets from Firebase
   */
  static async loadMaintenanceTickets() {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        return [];
      }

      const ticketsRef = window.firebaseRef(this.database,
        `maintenance/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await window.firebaseGet(ticketsRef);

      if (snapshot.exists()) {
        const ticketsData = Object.values(snapshot.val() || {});
        console.log(`✅ Loaded ${ticketsData.length} maintenance tickets from Firebase`);
        return ticketsData.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
      }

      return [];
    } catch (error) {
      // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
      if (!/permission/i.test(error?.message || '')) {
        console.error('❌ Error loading maintenance tickets:', error);
      }
      return [];
    }
  }

  /**
   * Load building announcements from Firebase.
   * NOTE: Admin writes announcements to Firestore (`announcements/{id}`), not RTDB.
   * This RTDB path was legacy. tenant_app subscribes Firestore directly via
   * its own onSnapshot, so we just return [] here to avoid noisy permission errors.
   */
  static async loadAnnouncements() {
    return []; // Firestore subscriber in tenant_app handles announcements end-to-end
  }

  /**
   * Load contract document URL
   */
  static async loadContract() {
    try {
      const lease = await this.loadLease();
      if (lease?.contractDocument) {
        console.log('✅ Loaded contract document');
        return lease.contractDocument;
      }
      return null;
    } catch (error) {
      console.error('❌ Error loading contract:', error);
      return null;
    }
  }

  /**
   * Load all tenant data at once
   */
  static async loadAllData() {
    try {
      console.log('🔄 Loading all tenant data from Firebase...');
      console.log('   Building:', this.currentBuilding, 'Room:', this.currentRoom);

      // Load data in parallel (including meter data)
      const [lease, room, bills, payments, tickets, announcements, meterData] =
        await Promise.all([
          this.loadLease().catch(e => { console.error('Error loading lease:', e); return null; }),
          this.loadRoom().catch(e => { console.error('Error loading room:', e); return null; }),
          this.loadBills().catch(e => { console.error('Error loading bills:', e); return []; }),
          this.loadPaymentHistory().catch(e => { console.error('Error loading payments:', e); return []; }),
          this.loadMaintenanceTickets().catch(e => { console.error('Error loading tickets:', e); return []; }),
          this.loadAnnouncements().catch(e => { console.error('Error loading announcements:', e); return []; }),
          this.loadMeterDataFromFirebase().catch(e => { console.warn('Warning loading meter data:', e); return {}; })
        ]);

      // Tenant info comes from the lease object
      let tenant = lease; // Use lease data as tenant data since they're in same Firebase object
      if (lease?.tenantId && typeof this.loadTenant === 'function') {
        const explicitTenant = await this.loadTenant(lease.tenantId);
        if (explicitTenant) {
          tenant = explicitTenant;
        }
      }

      const allData = {
        lease,
        tenant,
        room,
        bills: bills || [],
        payments: payments || [],
        tickets: tickets || [],
        announcements: announcements || [],
        meterData: meterData || {}
      };

      console.log('✅ All tenant data loaded:', {
        hasLease: !!lease,
        leaseDetails: lease ? Object.keys(lease) : 'none',
        hasTenant: !!tenant,
        tenantName: tenant?.name || 'N/A',
        hasRoom: !!room,
        billCount: (bills || []).length,
        paymentCount: (payments || []).length,
        ticketCount: (tickets || []).length,
        announcementCount: (announcements || []).length,
        meterDataYears: Object.keys(meterData || {})
      });
      return allData;
    } catch (error) {
      console.error('❌ Error loading all data:', error);
      return {
        lease: null,
        tenant: null,
        room: null,
        bills: [],
        payments: [],
        tickets: [],
        announcements: [],
        meterData: {}
      };
    }
  }

  /**
   * Save maintenance ticket to Firebase
   */
  static async saveMaintenanceTicket(ticketData) {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseSet) {
        console.warn('⚠️ Firebase not available, saving to localStorage only');
        return null;
      }

      const ticketId = `T${Date.now()}`;
      const ticketRef = window.firebaseRef(this.database,
        `maintenance/${this.currentBuilding}/${this.currentRoom}/${ticketId}`);

      await window.firebaseSet(ticketRef, {
        ...ticketData,
        id: ticketId,
        createdAt: new Date().toISOString()
      });

      console.log('✅ Maintenance ticket saved to Firebase:', ticketId);
      return ticketId;
    } catch (error) {
      console.error('❌ Error saving maintenance ticket:', error);
      return null;
    }
  }

  /**
   * Delete maintenance ticket from Firebase
   */
  static async deleteMaintenanceTicket(building, room, ticketId) {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseRemove) {
        console.warn('⚠️ Firebase not available, cannot delete');
        return false;
      }

      const ticketRef = window.firebaseRef(this.database,
        `maintenance/${building}/${room}/${ticketId}`);

      await window.firebaseRemove(ticketRef);

      console.log('✅ Maintenance ticket deleted from Firebase:', ticketId);
      return true;
    } catch (error) {
      console.error('❌ Error deleting maintenance ticket:', error);
      return false;
    }
  }

  /**
   * Update payment record in Firebase
   */
  static async updatePayment(billId, paymentData) {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseSet) {
        console.warn('⚠️ Firebase not available');
        return false;
      }

      const paymentRef = window.firebaseRef(this.database,
        `payments/${this.currentBuilding}/${this.currentRoom}/${billId}`);

      await window.firebaseSet(paymentRef, {
        ...paymentData,
        billId,
        updatedAt: new Date().toISOString()
      });

      console.log('✅ Payment updated in Firebase:', billId);
      return true;
    } catch (error) {
      console.error('❌ Error updating payment:', error);
      return false;
    }
  }

  /**
   * Debug: List all paths and structure in Firebase
   * Call from console: TenantFirebaseSync.debugFirebaseStructure()
   */
  static async debugFirebaseStructure() {
    if (!this.database || !window.firebaseRef || !window.firebaseGet) {
      console.error('❌ Firebase not available');
      return;
    }

    console.log('🔍 === DEBUG: Firebase Structure ===');
    console.log('Building:', this.currentBuilding);
    console.log('Room:', this.currentRoom);

    // Try root
    try {
      console.log('\n📍 Checking root:');
      const rootRef = window.firebaseRef(this.database, '');
      const rootSnapshot = await window.firebaseGet(rootRef);
      if (rootSnapshot.exists()) {
        const keys = Object.keys(rootSnapshot.val());
        console.log('   Root keys:', keys);

        // For each key, try to get data for this building/room
        for (const key of keys) {
          console.log(`\n📍 Checking /${key}/${this.currentBuilding}/${this.currentRoom}:`);
          try {
            const ref = window.firebaseRef(this.database,
              `${key}/${this.currentBuilding}/${this.currentRoom}`);
            const snapshot = await window.firebaseGet(ref);
            if (snapshot.exists()) {
              console.log(`   ✅ DATA FOUND:`, snapshot.val());
            } else {
              console.log(`   No data`);
            }
          } catch (e) {
            console.log(`   Error: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.error('Error checking root:', e);
    }

    console.log('\n✅ Debug complete');
  }

  /**
   * Listen for real-time updates
   */
  static listenToRealTimeUpdates(callback) {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseOnValue) {
        return null;
      }

      // Listen to lease changes
      const leaseRef = window.firebaseRef(this.database,
        `data/${this.currentBuilding}/${this.currentRoom}`);

      const unsubscribe = window.firebaseOnValue(leaseRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log('📡 Real-time lease update:', data);
          callback({ type: 'lease', data: data });
        }
      });

      console.log('📡 Real-time listener active for lease data');
      return unsubscribe;
    } catch (error) {
      console.error('❌ Error setting up real-time listener:', error);
      return null;
    }
  }
}

// ============================================================================
// BACKWARD COMPATIBILITY & GLOBAL EXPORTS
// ============================================================================

// Make all classes globally available
window.TenantConfigManager = TenantConfigManager;
window.TenantManager = TenantManager;
window.TenantFirebaseSync = TenantFirebaseSync;

// CommonJS export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TenantConfigManager,
    TenantManager,
    TenantFirebaseSync
  };
}

console.log('✅ Tenant System loaded (v3.0 - Consolidated from 3 modules)');
