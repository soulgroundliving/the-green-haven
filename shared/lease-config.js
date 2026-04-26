// Lease Agreement Manager
// Centralized storage for all rental contracts

class LeaseAgreementManager {
  static getAllLeases() {
    const stored = localStorage.getItem('lease_agreements_data');
    return stored ? JSON.parse(stored) : {};
  }

  static saveLeases(data) {
    localStorage.setItem('lease_agreements_data', JSON.stringify(data));
    console.log('✅ Lease data saved');
  }

  static createLease(leaseData) {
    // leaseData: {
    //   building: 'rooms'|'nest',
    //   roomId: string,
    //   tenantId: string,
    //   tenantName: string,
    //   moveInDate: ISO date,
    //   moveOutDate: ISO date (null if ongoing),
    //   rentAmount: number,
    //   deposit: number,
    //   status: 'active'|'inactive'
    // }

    if (!leaseData.building || !leaseData.roomId || !leaseData.tenantId) {
      console.warn('⚠️ Building, room, and tenant are required');
      return null;
    }

    const leases = this.getAllLeases();
    const leaseId = `${leaseData.building}_${leaseData.roomId}_${leaseData.tenantId}_${Date.now()}`;

    leases[leaseId] = {
      ...leaseData,
      id: leaseId,
      createdDate: new Date().toISOString(),
      status: leaseData.status || 'active'
    };

    this.saveLeases(leases);
    console.log(`✅ Lease created: ${leaseId}`);
    return leaseId;
  }

  static getActiveLease(building, roomId) {
    // Phase 4 SSoT: prefer lease referenced by tenants/{b}/list/{roomId}.lease.leaseId.
    // Without this, save flows on the dashboard see localStorage-empty leases and
    // create duplicate active leases on every save instead of updating the existing one.
    if (typeof TenantConfigManager !== 'undefined') {
      const ssotDoc = TenantConfigManager.getTenant(building, String(roomId));
      const ssotLease = ssotDoc?.lease;
      if (ssotLease && (ssotLease.leaseId || ssotLease.status === 'active')) {
        return {
          ...ssotLease,
          id: ssotLease.leaseId,
          building,
          roomId: String(roomId),
          tenantId: ssotDoc.tenantId,
          tenantName: ssotDoc.name,
          // Compatibility — flat field aliases for legacy consumers
          moveInDate:  ssotLease.moveInDate || ssotLease.startDate,
          moveOutDate: ssotLease.moveOutDate || ssotLease.endDate,
        };
      }
    }
    // Legacy fallback: localStorage scan
    const leases = this.getAllLeases();
    const active = Object.values(leases).find(lease =>
      lease.building === building &&
      lease.roomId === roomId &&
      lease.status === 'active'
    );
    return active || null;
  }

  static getLeaseHistory(building, roomId) {
    const leases = this.getAllLeases();
    return Object.values(leases)
      .filter(lease =>
        lease.building === building &&
        lease.roomId === roomId &&
        // Drop "superseded" — duplicate leases created before Phase-4 SSoT bug fix.
        // Real history (active + ended/inactive) still shows.
        lease.status !== 'superseded'
      )
      .sort((a, b) => new Date(b.moveInDate) - new Date(a.moveInDate));
  }

  // Pull fresh leases from Firestore and rewrite localStorage cache.
  // Drops local-only orphans that aren't in Firestore (e.g. stale records
  // from failed Firestore writes during Phase-4 transition).
  static async refreshLeasesFromFirestore(building) {
    if (!window.firebase?.firestore) return;
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const snap = await fs.getDocs(fs.collection(db, 'leases', building, 'list'));
      const fresh = {};
      snap.forEach(d => { fresh[d.id] = d.data(); });
      // Replace this building's leases — drop orphans
      const all = this.getAllLeases();
      Object.keys(all).forEach(id => {
        if (all[id]?.building === building) delete all[id];
      });
      Object.assign(all, fresh);
      this.saveLeases(all);
      console.log(`✅ Refreshed ${Object.keys(fresh).length} leases for ${building} from Firestore`);
    } catch (e) {
      console.warn('Lease refresh failed:', e.message);
    }
  }

  static getLease(leaseId) {
    const leases = this.getAllLeases();
    return leases[leaseId] || null;
  }

  static getAllLeasesList() {
    return Object.values(this.getAllLeases())
      .sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
  }

  static updateLease(leaseId, updates) {
    const leases = this.getAllLeases();
    if (!leases[leaseId]) {
      console.warn(`⚠️ Lease ${leaseId} not found`);
      return false;
    }

    leases[leaseId] = { ...leases[leaseId], ...updates };
    this.saveLeases(leases);
    console.log(`✅ Lease ${leaseId} updated`);
    return true;
  }

  static endLease(leaseId, moveOutDate) {
    const date = moveOutDate || new Date().toISOString();
    return this.updateLease(leaseId, {
      moveOutDate: date,
      status: 'inactive'
    });
  }

  static deleteLease(leaseId) {
    const leases = this.getAllLeases();
    if (!leases[leaseId]) {
      console.warn(`⚠️ Lease ${leaseId} not found`);
      return false;
    }

    delete leases[leaseId];
    this.saveLeases(leases);
    console.log(`✅ Lease ${leaseId} deleted`);
    return true;
  }

  static getLeasesByBuilding(building) {
    const leases = this.getAllLeases();
    return Object.values(leases)
      .filter(lease => lease.building === building)
      .sort((a, b) => new Date(b.moveInDate) - new Date(a.moveInDate));
  }

  static getLeasesByTenant(tenantId) {
    const leases = this.getAllLeases();
    return Object.values(leases)
      .filter(lease => lease.tenantId === tenantId)
      .sort((a, b) => new Date(b.moveInDate) - new Date(a.moveInDate));
  }

  static getActiveLeaseCount(building) {
    const leases = this.getAllLeases();
    return Object.values(leases).filter(l => l.building === building && l.status === 'active').length;
  }

  static getRoomOccupancy(building) {
    // Return which rooms are occupied and which are vacant
    const leases = this.getAllLeases();
    const occupied = new Set();

    Object.values(leases).forEach(lease => {
      if (lease.building === building && lease.status === 'active') {
        occupied.add(lease.roomId);
      }
    });

    return {
      occupied: Array.from(occupied),
      count: occupied.size
    };
  }

  static isRoomOccupied(building, roomId) {
    return this.getActiveLease(building, roomId) !== null;
  }

  // Phase 4 SSoT: project lease fields onto tenants/{b}/list/{roomId}.lease
  // (current active lease snapshot). leases/{b}/list/{leaseId} stays as the
  // history archive — old leases keep their record for audit / lease history.
  static async _syncLeaseToTenantSSoT(building, roomId, leaseId, leaseData) {
    if (!window.firebase || !roomId) return;
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const ref = fs.doc(db, 'tenants', building, 'list', String(roomId));
      const leaseSubobject = {
        startDate:        leaseData.moveInDate || leaseData.startDate || null,
        endDate:          leaseData.moveOutDate || leaseData.endDate || null,
        moveInDate:       leaseData.moveInDate || leaseData.startDate || null,
        moveOutDate:      leaseData.moveOutDate || leaseData.endDate || null,
        rentAmount:       leaseData.rentAmount ?? null,
        deposit:          leaseData.deposit ?? null,
        status:           leaseData.status || 'active',
        contractDocument: leaseData.contractDocument || null,
        contractFileName: leaseData.contractFileName || null,
        documents:        leaseData.documents || leaseData.documentURLs || null,
        leaseId:          leaseId,
      };
      await fs.setDoc(ref, {
        lease: leaseSubobject,
        tenantId: leaseData.tenantId || null,
        building,
        roomId: String(roomId),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      console.log(`✅ Lease projected to tenants/${building}/list/${roomId}.lease`);
    } catch (e) {
      console.warn(`⚠️ Lease SSoT sync failed for ${roomId}:`, e.message);
    }
  }

  static async createLeaseWithFirebase(leaseData) {
    // 1. Save to localStorage
    const leaseId = this.createLease(leaseData);

    // 2. Write archive at leases/{b}/list/{leaseId}
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return leaseId;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `leases/${leaseData.building}/list`),
        leaseId
      );
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...leaseData,
        id: leaseId,
        createdDate: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: false });
      console.log(`✅ Lease ${leaseId} archived at leases/${leaseData.building}/list/${leaseId}`);
    } catch (error) {
      console.warn(`⚠️ Firebase sync failed for lease:`, error.message);
    }

    // 3. Phase 4 SSoT: project current lease onto tenants/{b}/list/{roomId}.lease
    await LeaseAgreementManager._syncLeaseToTenantSSoT(
      leaseData.building, leaseData.roomId, leaseId, leaseData
    );

    return leaseId;
  }

  static async updateLeaseWithFirebase(leaseId, building, updates) {
    // 1. Update in localStorage
    const success = this.updateLease(leaseId, updates);

    // 2. Update archive
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `leases/${building}/list`),
        leaseId
      );
      // setDoc(merge:true) — dashboard.html doesn't expose updateDoc, and merge
      // semantics are equivalent (write specified fields, don't touch others).
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...updates,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`✅ Lease ${leaseId} updated at leases/${building}/list/${leaseId}`);
    } catch (error) {
      console.warn(`⚠️ Firebase update failed for lease ${leaseId}:`, error.message);
    }

    // 3. Phase 4 SSoT: re-project current lease snapshot to tenants/{b}/list/{roomId}.
    //    Read from Firestore archive (which we just updated) so we have the merged
    //    record including roomId, even when localStorage cache is empty.
    try {
      let fullLease = this.getLease(leaseId);
      if ((!fullLease || !fullLease.roomId) && window.firebase?.firestore) {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        const archiveRef = fs.doc(db, 'leases', building, 'list', leaseId);
        const archiveSnap = await fs.getDoc(archiveRef);
        if (archiveSnap.exists()) {
          fullLease = archiveSnap.data();
        }
      }
      if (fullLease && fullLease.roomId) {
        await LeaseAgreementManager._syncLeaseToTenantSSoT(
          building, fullLease.roomId, leaseId, fullLease
        );
      } else {
        console.warn(`⚠️ Cannot SSoT-project lease ${leaseId} — no roomId resolved`);
      }
    } catch (e) {
      console.warn(`⚠️ Lease SSoT projection failed for ${leaseId}:`, e.message);
    }

    return success;
  }

  static async loadLeasesFromFirebase(building) {
    try {
      if (!window.firebase) {
        return this.getAllLeases();
      }

      // Skip if not authenticated — Firestore rules require auth
      if (!window.firebaseAuth?.currentUser) {
        return this.getAllLeases();
      }

      const db = window.firebase.firestore();
      const collectionRef = window.firebase.firestoreFunctions.collection(db, `leases/${building}/list`);
      const querySnap = await window.firebase.firestoreFunctions.getDocs(collectionRef);

      if (querySnap.size > 0) {
        const leases = {};
        querySnap.forEach(doc => {
          leases[doc.id] = doc.data();
        });
        // Save to localStorage as backup
        const stored = JSON.parse(localStorage.getItem('lease_agreements_data') || '{}');
        stored[building] = leases;
        localStorage.setItem('lease_agreements_data', JSON.stringify(stored));
        console.log(`✅ Leases for ${building} loaded from Firebase (${querySnap.size} items)`);
        return leases;
      }
    } catch (error) {
      console.warn(`⚠️ Firebase load failed for leases:`, error.message);
    }

    // Fallback to localStorage
    return this.getAllLeases();
  }

  static async deleteLeaseWithFirebase(leaseId, building) {
    // 1. Delete from localStorage
    const success = this.deleteLease(leaseId);

    // 2. Try Firebase in parallel
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `leases/${building}/list`),
        leaseId
      );
      await window.firebase.firestoreFunctions.deleteDoc(docRef);
      console.log(`✅ Lease ${leaseId} deleted from Firebase`);
    } catch (error) {
      console.warn(`⚠️ Firebase delete failed for lease ${leaseId}:`, error.message);
    }

    return success;
  }
}
