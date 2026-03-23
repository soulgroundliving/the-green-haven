/**
 * Tenant App Firebase Sync System
 * Fetches all tenant data from Firebase Realtime Database
 */

class TenantFirebaseSync {
  static db = null;
  static currentUser = null;
  static currentBuilding = null;
  static currentRoom = null;

  /**
   * Initialize Firebase connection
   */
  static initialize(user, building, room) {
    try {
      if (!window.firebaseDB || !window.firebaseDB.ref) {
        console.warn('⚠️ Firebase Database not initialized');
        return false;
      }

      this.db = window.firebaseDB;
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
   * Load tenant lease information
   */
  static async loadLease() {
    try {
      // Try to get from LeaseAgreementManager first (localStorage)
      if (typeof LeaseAgreementManager !== 'undefined') {
        const lease = LeaseAgreementManager.getActiveLease(this.currentBuilding, this.currentRoom);
        if (lease) {
          console.log('✅ Loaded lease from localStorage:', lease);
          return lease;
        }
      }

      // Fallback: load from Firebase
      if (!this.db) return null;

      const leaseRef = this.db.ref(window.firebaseDB,
        `leases/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await this.db.get(leaseRef);

      if (snapshot.exists()) {
        const leaseData = snapshot.val();
        console.log('✅ Loaded lease from Firebase:', leaseData);
        return leaseData;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading lease:', error);
      return null;
    }
  }

  /**
   * Load tenant personal information
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

      // Fallback: load from Firebase
      if (!this.db) return null;

      const tenantRef = this.db.ref(window.firebaseDB,
        `tenants/${this.currentBuilding}/${tenantId}`);
      const snapshot = await this.db.get(tenantRef);

      if (snapshot.exists()) {
        const tenantData = snapshot.val();
        console.log('✅ Loaded tenant from Firebase:', tenantData);
        return tenantData;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading tenant:', error);
      return null;
    }
  }

  /**
   * Load room configuration (rates, rent)
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

      // Fallback: load from Firebase
      if (!this.db) return null;

      const roomRef = this.db.ref(window.firebaseDB,
        `rooms/${this.currentBuilding}/${this.currentRoom}`);
      const snapshot = await this.db.get(roomRef);

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
   * Load bills and invoices
   */
  static async loadBills() {
    try {
      // Try InvoiceReceiptManager first (localStorage)
      if (typeof InvoiceReceiptManager !== 'undefined') {
        const bills = InvoiceReceiptManager.getInvoiceReceiptHistory(this.currentBuilding, this.currentRoom);
        if (bills && bills.length > 0) {
          console.log(`✅ Loaded ${bills.length} bills from localStorage`);
          return bills;
        }
      }

      // Fallback: load from Firebase
      if (!this.db) return [];

      const billsRef = this.db.ref(window.firebaseDB,
        `bills/${this.currentBuilding}/${this.currentRoom}/list`);
      const snapshot = await this.db.get(billsRef);

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
   * Load payment history
   */
  static async loadPaymentHistory() {
    try {
      if (!this.db) return [];

      const paymentsRef = this.db.ref(window.firebaseDB,
        `payments/${this.currentBuilding}/${this.currentRoom}/list`);
      const snapshot = await this.db.get(paymentsRef);

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
   * Load maintenance tickets
   */
  static async loadMaintenanceTickets() {
    try {
      if (!this.db) return [];

      const ticketsRef = this.db.ref(window.firebaseDB,
        `maintenance/${this.currentBuilding}/${this.currentRoom}/list`);
      const snapshot = await this.db.get(ticketsRef);

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
   * Load building announcements
   */
  static async loadAnnouncements() {
    try {
      if (!this.db) return [];

      const announcementsRef = this.db.ref(window.firebaseDB,
        `announcements/${this.currentBuilding}`);
      const snapshot = await this.db.get(announcementsRef);

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
      console.log('🔄 Loading all tenant data...');

      const [lease, room, bills, payments, tickets, announcements] =
        await Promise.all([
          this.loadLease(),
          this.loadRoom(),
          this.loadBills(),
          this.loadPaymentHistory(),
          this.loadMaintenanceTickets(),
          this.loadAnnouncements()
        ]);

      let tenant = null;
      if (lease?.tenantId) {
        tenant = await this.loadTenant(lease.tenantId);
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

      console.log('✅ All tenant data loaded:', allData);
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
      if (!this.db) {
        console.warn('⚠️ Firebase not available, saving to localStorage only');
        // Save to localStorage as fallback
        const tickets = JSON.parse(localStorage.getItem('tenant_maintenance_tickets') || '[]');
        tickets.push({
          ...ticketData,
          id: `T${Date.now()}`,
          createdAt: new Date().toISOString()
        });
        localStorage.setItem('tenant_maintenance_tickets', JSON.stringify(tickets));
        return ticketData.id;
      }

      const ticketId = `T${Date.now()}`;
      const ticketRef = this.db.ref(window.firebaseDB,
        `maintenance/${this.currentBuilding}/${this.currentRoom}/list/${ticketId}`);

      await this.db.set(ticketRef, {
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
      if (!this.db) {
        console.warn('⚠️ Firebase not available, updating localStorage only');
        return false;
      }

      const paymentRef = this.db.ref(window.firebaseDB,
        `payments/${this.currentBuilding}/${this.currentRoom}/list/${billId}`);

      await this.db.set(paymentRef, {
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
      if (!this.db) return null;

      // Listen to bills changes
      const billsRef = this.db.ref(window.firebaseDB,
        `bills/${this.currentBuilding}/${this.currentRoom}/list`);

      const unsubscribe = this.db.onValue(billsRef, (snapshot) => {
        if (snapshot.exists()) {
          const bills = Object.values(snapshot.val());
          console.log('📡 Real-time bill update:', bills.length, 'bills');
          callback({ type: 'bills', data: bills });
        }
      });

      console.log('📡 Real-time listener active for bills');
      return unsubscribe;
    } catch (error) {
      console.error('❌ Error setting up real-time listener:', error);
      return null;
    }
  }
}

// Initialize when Firebase is ready
if (window.firebaseDB) {
  console.log('✅ TenantFirebaseSync loaded');
} else {
  console.warn('⚠️ Firebase Database not ready, TenantFirebaseSync will use localStorage fallback');
}

window.TenantFirebaseSync = TenantFirebaseSync;
