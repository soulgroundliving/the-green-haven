/**
 * Tenant App Firebase Sync System
 * Fetches all tenant data from Firebase Realtime Database
 * Structure: data/{building}/{room} contains tenant lease info
 */

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
   * Load tenant lease information from Firebase
   * Tries multiple possible paths for flexibility
   */
  static async loadLease() {
    try {
      // Try to get from LeaseAgreementManager first (localStorage - faster)
      if (typeof LeaseAgreementManager !== 'undefined') {
        const lease = LeaseAgreementManager.getActiveLease(this.currentBuilding, this.currentRoom);
        if (lease) {
          console.log('✅ Loaded lease from localStorage:', lease);
          return lease;
        }
      }

      // Load from Firebase Realtime Database
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        console.warn('⚠️ Firebase functions not available');
        return null;
      }

      // Try multiple possible paths
      const possiblePaths = [
        `data/${this.currentBuilding}/${this.currentRoom}`,
        `${this.currentBuilding}/${this.currentRoom}`,
        `tenants/${this.currentBuilding}/${this.currentRoom}`,
        `rooms/${this.currentBuilding}/${this.currentRoom}`
      ];

      for (const path of possiblePaths) {
        try {
          console.log(`🔍 Checking Firebase path: ${path}`);
          const leaseRef = window.firebaseRef(this.database, path);
          const snapshot = await window.firebaseGet(leaseRef);

          if (snapshot.exists()) {
            const leaseData = snapshot.val();
            console.log(`✅ Loaded lease from Firebase at ${path}:`, leaseData);
            return leaseData;
          }
        } catch (e) {
          console.debug(`  Path ${path} failed:`, e.message);
        }
      }

      console.log(`ℹ️ No lease data found in Firebase for ${this.currentBuilding}/${this.currentRoom}`);
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
      // Try localStorage first
      if (typeof TenantConfigManager !== 'undefined') {
        const tenant = TenantConfigManager.getTenant(tenantId);
        if (tenant) {
          console.log('✅ Loaded tenant from localStorage:', tenant);
          return tenant;
        }
      }

      // For tenant app, tenant data is in the room object at data/{building}/{room}
      // So we load it when we load the lease
      const lease = await this.loadLease();
      if (lease) {
        // The lease object contains tenant info (name, phone, email, etc.)
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
   * Load bills from localStorage or calculated from meter data
   */
  static async loadBills() {
    try {
      // Try TenantManager first (calculates from meter data)
      if (typeof TenantManager !== 'undefined') {
        const bills = TenantManager.getBillsForRoom(this.currentBuilding, this.currentRoom);
        if (bills && bills.length > 0) {
          console.log(`✅ Loaded ${bills.length} bills from TenantManager`);
          return bills;
        }
      }

      // Fallback: load from Firebase bills collection
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        return [];
      }

      const billsRef = window.firebaseRef(this.database,
        `bills/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await window.firebaseGet(billsRef);

      if (snapshot.exists()) {
        const billsData = Object.values(snapshot.val() || {});
        console.log(`✅ Loaded ${billsData.length} bills from Firebase`);
        return billsData;
      }

      return [];
    } catch (error) {
      console.error('❌ Error loading bills:', error);
      return [];
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
      console.error('❌ Error loading payment history:', error);
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
      console.error('❌ Error loading maintenance tickets:', error);
      return [];
    }
  }

  /**
   * Load building announcements from Firebase
   */
  static async loadAnnouncements() {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseGet) {
        return [];
      }

      const announcementsRef = window.firebaseRef(this.database,
        `announcements/${this.currentBuilding}`);
      const snapshot = await window.firebaseGet(announcementsRef);

      if (snapshot.exists()) {
        const announcementsData = Object.values(snapshot.val() || {});
        console.log(`✅ Loaded ${announcementsData.length} announcements from Firebase`);
        return announcementsData.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
      }

      return [];
    } catch (error) {
      console.error('❌ Error loading announcements:', error);
      return [];
    }
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

      const [lease, room, bills, payments, tickets, announcements] =
        await Promise.all([
          this.loadLease(),
          this.loadRoom(),
          this.loadBills(),
          this.loadPaymentHistory(),
          this.loadMaintenanceTickets(),
          this.loadAnnouncements()
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
        announcements: announcements || []
      };

      console.log('✅ All tenant data loaded:', {
        hasLease: !!lease,
        hasTenant: !!tenant,
        hasRoom: !!room,
        billCount: (bills || []).length,
        paymentCount: (payments || []).length,
        ticketCount: (tickets || []).length,
        announcementCount: (announcements || []).length
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
        announcements: []
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
