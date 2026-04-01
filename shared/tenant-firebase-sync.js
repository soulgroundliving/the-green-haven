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
   * Load tenant lease information from Firestore meta_data collection
   * Priority: Firestore FIRST → localStorage FALLBACK
   */
  static async loadLease() {
    try {
      // Load from Firestore meta_data collection FIRST (for actual data)
      if (window.firebase?.firestore) {
        try {
          console.log(`🔍 TenantFirebaseSync: Checking Firestore meta_data/${this.currentRoom}`);
          const db = window.firebase.firestore();
          const fs = window.firebase.firestoreFunctions;

          const docRef = fs.doc(fs.collection(db, 'meta_data'), this.currentRoom);
          const docSnap = await fs.getDoc(docRef);

          if (docSnap.exists()) {
            const leaseData = docSnap.data();
            console.log(`✅ TenantFirebaseSync: Loaded lease from Firestore meta_data:`, leaseData);
            return leaseData;
          } else {
            console.log(`   ℹ️ No data in Firestore meta_data/${this.currentRoom}`);
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
          console.warn(`⚠️ Firebase bill loading failed: ${e.message}`);
        }
      }

      // Sort by date (newest first)
      return allBills.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.billDate || 0);
        const dateB = new Date(b.createdAt || b.billDate || 0);
        return dateB - dateA;
      });
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
