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
      .filter(lease => lease.building === building && lease.roomId === roomId)
      .sort((a, b) => new Date(b.moveInDate) - new Date(a.moveInDate));
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
}
