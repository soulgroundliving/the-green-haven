// Tenant Manager - Tenant-specific data loading utilities
// Provides helper functions for the Tenant App (tenant.html)

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
        ? TenantConfigManager.getTenant(lease.tenantId)
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
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TenantManager;
}
