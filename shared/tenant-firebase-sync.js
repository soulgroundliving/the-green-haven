/**
 * Tenant Firebase Sync
 * Extracted from tenant-system.js — PART 1 (TenantConfigManager) + PART 2 (TenantManager) remain there.
 */

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
        console.warn('โ ๏ธ Firebase Database not initialized. Waiting for Firebase module...');
        return false;
      }

      // Idempotent: skip log + state-write when called again with the same identity.
      // Auth state listeners + page handlers re-call this on the same session.
      const same = this.database === window.firebaseDatabase
                && this.currentUser === user
                && this.currentBuilding === building
                && this.currentRoom === room;
      if (same) return true;

      this.database = window.firebaseDatabase;
      this.currentUser = user;
      this.currentBuilding = building;
      this.currentRoom = room;

      return true;
    } catch (error) {
      console.error('โ Firebase initialization error:', error);
      return false;
    }
  }

  /**
   * Load tenant lease information from Firestore meta_data collection
   * Priority: Firestore FIRST โ’ localStorage FALLBACK
   */
  // Canonical building id IS the Firestore doc id since B4 migration (rooms โ’ buildings/rooms).
  // Room IDs: ใช้ตามที่ admin ตั้งใน Firestore ตรงๆ (เช่น '15ก', 'ร้านใหญ่' ภาษาไทย)
  // หาก Firestore docId ไม่ตรง → loadLease() คืน null + console แจ้ง path ที่ค้น
  static _fsBuilding(b) { return b; }
  static _fsRoomId(r) { return r; }

  static async loadLease() {
    try {
      if (window.firebase?.firestore) {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        const building = this.currentBuilding;
        const roomId = String(this.currentRoom);

        // === SSoT: tenants/{building}/list/{roomId} (post-migration) ===
        // Single doc holds tenant identity + lease subobject + linkedAuthUid.
        // saveProfileEdit / setVerifiedPhone CF / linkAuthUid CF write here.
        try {
          const ssotRef = fs.doc(db, 'tenants', building, 'list', roomId);
          const ssotSnap = await fs.getDoc(ssotRef);
          if (ssotSnap.exists()) {
            const d = ssotSnap.data();
            const lease = d.lease || {};
            // Phase 3d: tenant.lease mirror is reduced — fetch full lease
            // record when leaseId is present so amounts + contract docs
            // resolve correctly even when the mirror omits them.
            let fullLease = {};
            const leaseId = lease.leaseId || d.activeContractId;
            if (leaseId) {
              try {
                const leaseRef = fs.doc(db, 'leases', building, 'list', String(leaseId));
                const leaseSnap = await fs.getDoc(leaseRef);
                if (leaseSnap.exists()) fullLease = leaseSnap.data() || {};
              } catch (e) {
                // Permission errors aren't fatal — fall back to mirror.
                console.debug(`  โ ๏ธ leases lookup failed for ${leaseId}:`, e.message);
              }
            }
            const leaseData = {
              building,
              roomId,
              // Lease — read from .lease subobject; fall back to full lease
              // record; then top-level for unmigrated docs (Phase 6 will
              // remove top-level dupes).
              rentAmount: lease.rentAmount ?? fullLease.rentAmount ?? d.rentAmount ?? 0,
              deposit: lease.deposit ?? fullLease.deposit ?? d.deposit ?? 0,
              startDate: lease.startDate || lease.moveInDate || fullLease.startDate || fullLease.moveInDate || d.moveInDate,
              endDate: lease.endDate || lease.moveOutDate || fullLease.endDate || fullLease.moveOutDate || d.moveOutDate,
              moveInDate: lease.startDate || lease.moveInDate || fullLease.startDate || fullLease.moveInDate || d.moveInDate,
              moveOutDate: lease.endDate || lease.moveOutDate || fullLease.endDate || fullLease.moveOutDate || d.moveOutDate,
              status: lease.status || fullLease.status || 'empty',
              contractDocument: lease.contractDocument || fullLease.contractDocument || d.contractDocument,
              contractFileName: lease.contractFileName || fullLease.contractFileName || d.contractFileName,
              billingCycle: d.billingCycle ?? 1,
              emergencyContact: d.emergencyContact,
              // Identity
              tenantId: d.tenantId,
              name: d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim() || null,
              firstName: d.firstName,
              lastName: d.lastName,
              phone: d.phone,
              email: d.email,
              licensePlate: d.licensePlate,
              idCardNumber: d.idCardNumber,
              address: d.address,
              lineID: d.lineID,
              notes: d.notes,
              // Tenant-managed
              companyInfo: d.companyInfo,
              receiptType: d.receiptType,
              // Auth links
              linkedAuthUid: d.linkedAuthUid,
              phoneVerifiedAt: d.phoneVerifiedAt,
              _raw: d,
              _source: 'tenants/list',
            };
            return leaseData;
          }
        } catch (e) {
          // permission_denied expected pre-LIFF-link (linkedAuthUid not set yet)
          if (!/permission/i.test(e?.message || '')) {
            console.debug(`  โ tenants/list lookup failed:`, e.message);
          }
        }

        // Phase 6 SSoT cleanup removed .tenant/.lease/.operations/.personalInfo
        // from buildings/{alias}/rooms/{r}, so the old fallback can never find
        // data anymore. tenants/{b}/list/{roomId} is the only canonical source.

      } else {
        console.warn('โ ๏ธ Firestore not available, using localStorage fallback');
      }

      // Final fallback: localStorage
      if (typeof LeaseAgreementManager !== 'undefined') {
        const lease = LeaseAgreementManager.getActiveLease(this.currentBuilding, this.currentRoom);
        if (lease) {
          return lease;
        }
      }

      return null;
    } catch (error) {
      console.error('โ Error loading lease:', error);
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
          return tenant;
        }
      }

      // For tenant app, tenant data is in the room object at data/{building}/{room}
      // So we load it when we load the lease
      const lease = await this.loadLease();
      if (lease) {
        // The lease object contains basic tenant info (tenantName, rent, etc.)
        // But for phone, email, address, we need the full tenant record
        return lease;
      }

      return null;
    } catch (error) {
      console.error('โ Error loading tenant:', error);
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
        return roomData;
      }

      return null;
    } catch (error) {
      console.error('โ Error loading room:', error);
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
        console.warn('โ ๏ธ Firebase Firestore not initialized');
        return {};
      }

      // Determine which years to load (current and previous years)
      const currentDate = new Date();
      const currentBudYear = currentDate.getFullYear() + 543;
      const yearsToLoad = [currentBudYear - 2, currentBudYear - 1, currentBudYear];
      const yearsToLoadShort = yearsToLoad.map(y => y % 100);


      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const allMeterData = {};

      // Try to load meter data for all years
      for (const year of yearsToLoad.concat(yearsToLoadShort)) {
        try {
          const q = fs.query(
            fs.collection(db, 'meter_data'),
            fs.where('building', '==', this.currentBuilding),
            fs.where('roomId', '==', String(this.currentRoom)),
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

          }
        } catch (e) {
          console.debug(`   โน๏ธ No meter data for year ${year}: ${e.message}`);
        }
      }

      if (Object.keys(allMeterData).length > 0) {
        return allMeterData;
      } else {
        console.debug('โ ๏ธ TenantFirebaseSync: No meter data found in Firebase');
        return {};
      }
    } catch (error) {
      console.error('โ Error loading meter data from Firebase:', error);
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
            console.warn(`โ ๏ธ Firebase bill loading failed: ${e.message}`);
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
        console.error('โ Error loading bills:', error);
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
  static subscribeBills(callback, onPermissionDenied) {
    if (!this.database || !window.firebaseRef || !window.firebaseOnValue) {
      console.warn('โ ๏ธ Firebase not available for bill subscription');
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
        if (/permission/i.test(err?.message || '')) {
          if (typeof onPermissionDenied === 'function') onPermissionDenied();
        } else {
          console.warn('โ ๏ธ subscribeBills error:', err.message);
        }
      });
      return typeof unsub === 'function' ? unsub : () => {};
    } catch (e) {
      if (!/permission/i.test(e?.message || '')) {
        console.warn('โ ๏ธ subscribeBills failed:', e.message);
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
        return paymentsData.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
      }

      return [];
    } catch (error) {
      // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
      if (!/permission/i.test(error?.message || '')) {
        console.error('โ Error loading payment history:', error);
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
        return ticketsData.sort((a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
        );
      }

      return [];
    } catch (error) {
      // Phase 4C: permission_denied expected until linkAuthUid sets {room,building} claims.
      if (!/permission/i.test(error?.message || '')) {
        console.error('โ Error loading maintenance tickets:', error);
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
        return lease.contractDocument;
      }
      return null;
    } catch (error) {
      console.error('โ Error loading contract:', error);
      return null;
    }
  }

  /**
   * Load all tenant data at once
   */
  static async loadAllData() {
    try {

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

      // Tenant info — when loadLease returned data from SSoT (tenants/{b}/list/{roomId}),
      // it already includes ALL tenant identity fields (name, phone, email, lineID,
      // idCardNumber, etc.) plus the lease subobject. Don't call loadTenant() in that
      // case because localStorage has a different (legacy-flat) shape that would
      // overwrite the rich SSoT data with stale partial fields.
      let tenant = lease;
      if (lease?.tenantId && lease._source !== 'tenants/list' && typeof this.loadTenant === 'function') {
        const explicitTenant = await this.loadTenant(lease.tenantId);
        if (explicitTenant) {
          tenant = explicitTenant;
        }
      }

      // Phase 6: overlay canonical identity from people/{tenantId}. After
      // Phase 6 slim-down, tenant docs no longer carry identity fields —
      // people/ is the SSoT. Falls through to tenant-doc fields when person
      // doc is missing (legacy tenants pre-people/ creation).
      if (tenant?.tenantId && typeof window !== 'undefined' && window.PersonManager) {
        try {
          const person = await window.PersonManager.getPerson(tenant.tenantId);
          if (person) {
            tenant = {
              ...tenant,
              name:             person.name             || tenant.name,
              firstName:        person.firstName        || tenant.firstName,
              lastName:         person.lastName         || tenant.lastName,
              phone:            person.phone            || tenant.phone,
              email:            person.email            || tenant.email,
              lineID:           person.lineUserId       || tenant.lineID,
              idCardNumber:     person.idCardNumber     || tenant.idCardNumber,
              address:          person.address          || tenant.address,
              licensePlate:     person.licensePlate     || tenant.licensePlate,
              emergencyContact: person.emergencyContact || tenant.emergencyContact,
              companyInfo:      person.companyInfo      || tenant.companyInfo,
              avatar:           person.avatar           || tenant.avatar,
              notes:            person.notes            || tenant.notes,
            };
          }
        } catch (e) {
          console.warn('Phase 6 person overlay failed:', e.message);
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

      return allData;
    } catch (error) {
      console.error('โ Error loading all data:', error);
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
        console.warn('โ ๏ธ Firebase not available, saving to localStorage only');
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

      return ticketId;
    } catch (error) {
      console.error('โ Error saving maintenance ticket:', error);
      return null;
    }
  }

  /**
   * Delete maintenance ticket from Firebase
   */
  static async deleteMaintenanceTicket(building, room, ticketId) {
    try {
      if (!this.database || !window.firebaseRef || !window.firebaseRemove) {
        console.warn('โ ๏ธ Firebase not available, cannot delete');
        return false;
      }

      const ticketRef = window.firebaseRef(this.database,
        `maintenance/${building}/${room}/${ticketId}`);

      await window.firebaseRemove(ticketRef);

      return true;
    } catch (error) {
      console.error('โ Error deleting maintenance ticket:', error);
      return false;
    }
  }

  /**
   * Debug: List all paths and structure in Firebase
   * Call from console: TenantFirebaseSync.debugFirebaseStructure()
   */
  static async debugFirebaseStructure() {
    if (!this.database || !window.firebaseRef || !window.firebaseGet) {
      console.error('โ Firebase not available');
      return;
    }


    // Try root
    try {
      const rootRef = window.firebaseRef(this.database, '');
      const rootSnapshot = await window.firebaseGet(rootRef);
      if (rootSnapshot.exists()) {
        const keys = Object.keys(rootSnapshot.val());

        // For each key, try to get data for this building/room
        for (const key of keys) {
          try {
            const ref = window.firebaseRef(this.database,
              `${key}/${this.currentBuilding}/${this.currentRoom}`);
            const snapshot = await window.firebaseGet(ref);
            if (snapshot.exists()) {
            } else {
            }
          } catch (e) {
          }
        }
      }
    } catch (e) {
      console.error('Error checking root:', e);
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
          callback({ type: 'lease', data: data });
        }
      });

      return unsubscribe;
    } catch (error) {
      console.error('โ Error setting up real-time listener:', error);
      return null;
    }
  }
}

window.TenantFirebaseSync = TenantFirebaseSync;
