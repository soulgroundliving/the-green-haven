/**
 * Admin Dashboard Firebase Sync System
 * Manages all admin operations with Firestore
 */

class AdminFirebaseSync {
  static firestore = null;
  static currentUser = null;
  static currentBuilding = 'Nest';

  /**
   * Initialize Firebase for Admin
   */
  static initialize() {
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not initialized');
        return false;
      }

      this.firestore = window.firebase.firestore();
      console.log('✅ AdminFirebaseSync initialized');
      return true;
    } catch (error) {
      console.error('❌ Admin initialization error:', error);
      return false;
    }
  }

  /**
   * Load all rooms for both buildings
   */
  static async loadAllRooms() {
    try {
      console.log('🔄 Loading all rooms...');
      const rooms = [];

      for (const building of ['Nest', 'GroupA']) {
        const snapshot = await this.firestore
          .collection('buildings')
          .doc(building)
          .collection('rooms')
          .get();

        snapshot.forEach(doc => {
          rooms.push({
            id: doc.id,
            building: building,
            ...doc.data()
          });
        });
      }

      console.log(`✅ Loaded ${rooms.length} rooms`);
      return rooms;
    } catch (error) {
      console.error('❌ Error loading rooms:', error);
      return [];
    }
  }

  /**
   * Load all tenants
   */
  static async loadAllTenants() {
    try {
      console.log('🔄 Loading all tenants...');
      const snapshot = await this.firestore.collection('tenants').get();
      const tenants = [];

      snapshot.forEach(doc => {
        tenants.push({
          id: doc.id,
          ...doc.data()
        });
      });

      console.log(`✅ Loaded ${tenants.length} tenants`);
      return tenants;
    } catch (error) {
      console.error('❌ Error loading tenants:', error);
      return [];
    }
  }

  /**
   * Save room (create or update)
   */
  static async saveRoom(building, roomId, roomData) {
    try {
      console.log(`💾 Saving room ${building}/${roomId}...`);

      const docData = {
        id: roomId,
        building: building,
        lease: roomData.lease || {},
        operations: roomData.operations || {
          emergencyContact: {},
          plateNumber: null,
          billingCycle: 1,
          lastMaintenanceDate: null,
          referralSource: null,
          acquiredDate: new Date().toISOString()
        },
        metadata: {
          createdAt: roomData.metadata?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };

      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .set(docData, { merge: true });

      console.log(`✅ Room saved: ${building}/${roomId}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving room:', error);
      return false;
    }
  }

  /**
   * Save tenant profile
   */
  static async saveTenant(tenantId, tenantData) {
    try {
      console.log(`💾 Saving tenant ${tenantId}...`);

      const docData = {
        identity: tenantData.identity || {
          firstName: null,
          lastName: null,
          tenantName: null,
          phone: null,
          email: null
        },
        petFriendly: tenantData.petFriendly || {
          hasPet: false,
          pets: []
        },
        logistics: tenantData.logistics || {},
        gamification: tenantData.gamification || {
          points: 0,
          rank: null,
          interests: [],
          badges: []
        },
        metadata: {
          createdAt: tenantData.metadata?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };

      await this.firestore
        .collection('tenants')
        .doc(tenantId)
        .set(docData, { merge: true });

      console.log(`✅ Tenant saved: ${tenantId}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving tenant:', error);
      return false;
    }
  }

  /**
   * Add complaint to room
   */
  static async addComplaint(building, roomId, complaint) {
    try {
      console.log(`💾 Adding complaint to ${building}/${roomId}...`);

      const complaintData = {
        id: `COMPLAINT_${Date.now()}`,
        date: new Date().toISOString(),
        category: complaint.category,
        severity: complaint.severity, // low, medium, high
        description: complaint.description,
        status: 'open', // open, in-progress, resolved
        createdAt: new Date().toISOString(),
        resolvedDate: null,
        notes: null
      };

      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .collection('complaintHistory')
        .doc(complaintData.id)
        .set(complaintData);

      console.log(`✅ Complaint added to ${roomId}`);
      return true;
    } catch (error) {
      console.error('❌ Error adding complaint:', error);
      return false;
    }
  }

  /**
   * Add maintenance record
   */
  static async addMaintenanceRecord(building, roomId, maintenance) {
    try {
      console.log(`💾 Adding maintenance record to ${building}/${roomId}...`);

      const maintenanceData = {
        id: `MAINT_${Date.now()}`,
        date: maintenance.date || new Date().toISOString(),
        type: maintenance.type, // AC Cleaning, Electrical, etc.
        notes: maintenance.notes,
        technician: maintenance.technician,
        createdAt: new Date().toISOString()
      };

      // Update lastMaintenanceDate in room
      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .update({
          'operations.lastMaintenanceDate': maintenance.date
        });

      // Add to maintenance history
      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .collection('maintenanceHistory')
        .doc(maintenanceData.id)
        .set(maintenanceData);

      console.log(`✅ Maintenance record added to ${roomId}`);
      return true;
    } catch (error) {
      console.error('❌ Error adding maintenance:', error);
      return false;
    }
  }

  /**
   * Add room condition report
   */
  static async addRoomConditionReport(building, roomId, report) {
    try {
      console.log(`💾 Adding condition report to ${building}/${roomId}...`);

      const reportData = {
        id: `REPORT_${Date.now()}`,
        inspectionDate: report.inspectionDate || new Date().toISOString(),
        inspectedBy: report.inspectedBy,
        condition: report.condition,
        notes: report.notes,
        photoUrls: report.photoUrls || [],
        nextInspectionDate: report.nextInspectionDate,
        createdAt: new Date().toISOString()
      };

      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .collection('roomConditionReports')
        .doc(reportData.id)
        .set(reportData);

      console.log(`✅ Room condition report added to ${roomId}`);
      return true;
    } catch (error) {
      console.error('❌ Error adding condition report:', error);
      return false;
    }
  }

  /**
   * Get all complaints
   */
  static async getAllComplaints() {
    try {
      console.log('🔄 Loading all complaints...');
      const complaints = [];

      for (const building of ['Nest', 'GroupA']) {
        const roomsSnapshot = await this.firestore
          .collection('buildings')
          .doc(building)
          .collection('rooms')
          .get();

        for (const roomDoc of roomsSnapshot.docs) {
          const complaintSnapshot = await roomDoc.ref
            .collection('complaintHistory')
            .get();

          complaintSnapshot.forEach(doc => {
            complaints.push({
              roomId: roomDoc.id,
              building: building,
              ...doc.data()
            });
          });
        }
      }

      console.log(`✅ Loaded ${complaints.length} complaints`);
      return complaints;
    } catch (error) {
      console.error('❌ Error loading complaints:', error);
      return [];
    }
  }

  /**
   * Get dashboard stats
   */
  static async getDashboardStats() {
    try {
      console.log('📊 Loading dashboard stats...');

      const rooms = await this.loadAllRooms();
      const occupiedCount = rooms.filter(r => r.lease?.status === 'active').length;
      const complaints = await this.getAllComplaints();
      const pendingComplaints = complaints.filter(c => c.status === 'open').length;

      // Check maintenance due (not done in last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const maintenanceDueCount = rooms.filter(r => {
        if (!r.operations?.lastMaintenanceDate) return true;
        const lastMaintDate = new Date(r.operations.lastMaintenanceDate);
        return lastMaintDate < ninetyDaysAgo;
      }).length;

      const stats = {
        totalRooms: rooms.length,
        occupiedRooms: occupiedCount,
        emptyRooms: rooms.length - occupiedCount,
        pendingComplaints,
        maintenanceDue: maintenanceDueCount
      };

      console.log('✅ Dashboard stats:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Error loading stats:', error);
      return {};
    }
  }

  /**
   * Get marketing ROI report
   */
  static async getMarketingROI() {
    try {
      console.log('📈 Generating marketing ROI report...');

      const rooms = await this.loadAllRooms();
      const referralStats = {};

      rooms.forEach(room => {
        const source = room.operations?.referralSource || 'Unknown';
        if (!referralStats[source]) {
          referralStats[source] = {
            source,
            total: 0,
            occupied: 0
          };
        }
        referralStats[source].total++;
        if (room.lease?.status === 'active') {
          referralStats[source].occupied++;
        }
      });

      console.log('✅ Marketing ROI:', referralStats);
      return Object.values(referralStats);
    } catch (error) {
      console.error('❌ Error generating ROI:', error);
      return [];
    }
  }

  /**
   * Update complaint status
   */
  static async updateComplaintStatus(building, roomId, complaintId, status) {
    try {
      console.log(`💾 Updating complaint ${complaintId} to ${status}...`);

      const updateData = {
        status: status,
        updatedAt: new Date().toISOString()
      };

      if (status === 'resolved') {
        updateData.resolvedDate = new Date().toISOString();
      }

      await this.firestore
        .collection('buildings')
        .doc(building)
        .collection('rooms')
        .doc(roomId)
        .collection('complaintHistory')
        .doc(complaintId)
        .update(updateData);

      console.log(`✅ Complaint updated`);
      return true;
    } catch (error) {
      console.error('❌ Error updating complaint:', error);
      return false;
    }
  }

  /**
   * Award points and badge to tenant
   */
  static async awardGamification(tenantId, points, badge) {
    try {
      console.log(`🎮 Awarding ${points} points and badge "${badge}" to ${tenantId}...`);

      const tenantRef = this.firestore.collection('tenants').doc(tenantId);
      const tenantDoc = await tenantRef.get();

      if (tenantDoc.exists()) {
        const currentData = tenantDoc.data();
        const currentPoints = currentData.gamification?.points || 0;
        const currentBadges = currentData.gamification?.badges || [];

        const newBadges = badge ? [...new Set([...currentBadges, badge])] : currentBadges;

        await tenantRef.update({
          'gamification.points': currentPoints + points,
          'gamification.badges': newBadges,
          'metadata.updatedAt': new Date().toISOString()
        });

        console.log(`✅ Gamification awarded`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Error awarding gamification:', error);
      return false;
    }
  }
}
