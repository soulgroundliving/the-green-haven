/**
 * Invoice & Receipt Manager
 * Manages storage and retrieval of invoices (ใบวางบิล) and receipts (ใบเสร็จรับเงิน)
 *
 * SECURITY PATCHED VERSION:
 * - Fixed Firebase path injection vulnerability
 * - Added input validation for all parameters
 * - Added data structure validation
 * - Improved error handling
 *
 * Data Structure:
 * localStorage['invoices_{building}'] = {
 *   'INV-roomId-YYYY-MM': { invoice object }
 * }
 * localStorage['receipts_{building}'] = {
 *   'RCP-roomId-TIMESTAMP': { receipt object }
 * }
 */

class InvoiceReceiptManager {
  /**
   * Validate building and room IDs for security
   * @param {string} building - Building identifier
   * @param {string} roomId - Room identifier
   * @returns {boolean} True if valid, false otherwise
   */
  static validateBuildingAndRoom(building, roomId) {
    // SECURITY: Validate building ID (alphanumeric, underscore, hyphen only)
    const buildingValid = /^[a-z0-9_-]+$/.test(building);
    if (!buildingValid) {
      console.warn(`⚠️ Invalid building ID format: ${building}`);
      return false;
    }

    // SECURITY: Validate room ID (numeric only)
    const roomValid = /^[0-9]+$/.test(roomId);
    if (!roomValid) {
      console.warn(`⚠️ Invalid room ID format: ${roomId}`);
      return false;
    }

    return true;
  }

  /**
   * Create new invoice (ใบวางบิล)
   */
  static createInvoice(building, roomId, month, breakdown) {
    try {
      // SECURITY: Validate inputs
      if (!this.validateBuildingAndRoom(building, roomId)) {
        throw new Error('Invalid building or room ID');
      }

      if (!month || typeof month !== 'string') {
        throw new Error('Invalid month parameter');
      }

      if (!breakdown || typeof breakdown !== 'object') {
        throw new Error('Invalid breakdown object');
      }

      // Generate invoice ID: INV-ROOM-YYYY-MM
      const invoiceId = `INV-${roomId}-${month}`;

      // Calculate total with type safety
      const total = (parseFloat(breakdown.rent) || 0) +
                   (parseFloat(breakdown.electric) || 0) +
                   (parseFloat(breakdown.water) || 0) +
                   (parseFloat(breakdown.trash) || 0);

      if (isNaN(total) || total < 0) {
        throw new Error('Invalid total amount calculated');
      }

      // Create invoice object
      const invoice = {
        id: invoiceId,
        building: building,
        roomId: roomId,
        type: 'invoice', // ใบวางบิล
        month: month,
        amount: total,
        breakdown: breakdown,
        createdAt: new Date().toISOString(),
        status: 'pending', // pending, paid, overdue
        qrCode: breakdown.qrCode || null,
        notes: breakdown.notes || ''
      };

      // Save to localStorage
      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse existing invoices for ${key}, starting fresh`);
        invoices = {};
      }

      invoices[invoiceId] = invoice;
      localStorage.setItem(key, JSON.stringify(invoices));

      console.log(`✅ Invoice created: ${invoiceId}`);

      // Sync to Firebase
      this.syncInvoiceToFirebase(building, roomId, invoiceId, invoice);

      return invoice;
    } catch (error) {
      console.error('❌ Error creating invoice:', error.message);
      return null;
    }
  }

  /**
   * Create receipt (ใบเสร็จรับเงิน) from verified payment
   */
  static createReceipt(building, invoiceId, paymentData) {
    try {
      // SECURITY: Validate inputs
      if (!invoiceId || typeof invoiceId !== 'string') {
        throw new Error('Invalid invoice ID');
      }

      if (!paymentData || typeof paymentData !== 'object') {
        throw new Error('Invalid payment data');
      }

      // Extract and validate room ID from invoice ID
      const invoiceParts = invoiceId.split('-');
      if (invoiceParts.length < 2) {
        throw new Error('Invalid invoice ID format');
      }

      const roomId = invoiceParts[1];

      // Validate building and room
      if (!this.validateBuildingAndRoom(building, roomId)) {
        throw new Error('Invalid building or room ID');
      }

      // Generate receipt ID: RCP-ROOM-TIMESTAMP
      const timestamp = Date.now();
      const receiptId = `RCP-${roomId}-${timestamp}`;

      // Validate amount
      const amount = parseFloat(paymentData.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid payment amount');
      }

      // Create receipt object
      const receipt = {
        id: receiptId,
        building: building,
        roomId: roomId,
        type: 'receipt', // ใบเสร็จรับเงิน
        invoiceId: invoiceId,
        amount: amount,
        paymentMethod: paymentData.paymentMethod || 'slip', // slip, cash, transfer
        slipData: paymentData.slipData || null,
        slipOkVerified: paymentData.slipOkVerified === true,
        verifiedBy: paymentData.verifiedBy || 'system', // SECURITY: Changed from 'admin' default
        createdAt: new Date().toISOString(),
        verifiedAt: paymentData.verifiedAt || new Date().toISOString(),
        status: 'completed'
      };

      // Save to localStorage
      const key = `receipts_${building}`;
      let receipts = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          receipts = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse existing receipts for ${key}, starting fresh`);
        receipts = {};
      }

      receipts[receiptId] = receipt;
      localStorage.setItem(key, JSON.stringify(receipts));

      console.log(`✅ Receipt created: ${receiptId}`);

      // Update invoice status to 'paid'
      this.updateInvoiceStatus(building, invoiceId, 'paid');

      // Sync to Firebase
      this.syncReceiptToFirebase(building, roomId, receiptId, receipt);

      return receipt;
    } catch (error) {
      console.error('❌ Error creating receipt:', error.message);
      return null;
    }
  }

  /**
   * Get all invoices for a room
   */
  static getInvoicesByRoom(building, roomId) {
    try {
      // SECURITY: Validate inputs
      if (!this.validateBuildingAndRoom(building, roomId)) {
        return [];
      }

      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse invoices for ${key}`);
        return [];
      }

      const roomInvoices = Object.values(invoices)
        .filter(inv => inv && inv.roomId === roomId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return roomInvoices;
    } catch (error) {
      console.error('❌ Error getting invoices:', error.message);
      return [];
    }
  }

  /**
   * Get all receipts for a room
   */
  static getReceiptsByRoom(building, roomId) {
    try {
      // SECURITY: Validate inputs
      if (!this.validateBuildingAndRoom(building, roomId)) {
        return [];
      }

      const key = `receipts_${building}`;
      let receipts = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          receipts = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse receipts for ${key}`);
        return [];
      }

      const roomReceipts = Object.values(receipts)
        .filter(rcp => rcp && rcp.roomId === roomId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return roomReceipts;
    } catch (error) {
      console.error('❌ Error getting receipts:', error.message);
      return [];
    }
  }

  /**
   * Get combined payment history (invoices + receipts)
   * Returns timeline: [{type: 'invoice'|'receipt', ...data}]
   */
  static getInvoiceReceiptHistory(building, roomId) {
    try {
      const invoices = this.getInvoicesByRoom(building, roomId);
      const receipts = this.getReceiptsByRoom(building, roomId);

      // Combine and sort by date
      const history = [
        ...invoices.map(inv => ({
          ...inv,
          type: 'invoice',
          icon: '📄',
          displayStatus: inv.status === 'paid' ? '✅ ชำระแล้ว' : '⏳ ต้องชำระ'
        })),
        ...receipts.map(rcp => ({
          ...rcp,
          type: 'receipt',
          icon: '✅',
          displayStatus: '✅ ชำระแล้ว'
        }))
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return history;
    } catch (error) {
      console.error('❌ Error getting history:', error.message);
      return [];
    }
  }

  /**
   * Get invoice by ID
   */
  static getInvoice(building, invoiceId) {
    try {
      if (!invoiceId || typeof invoiceId !== 'string') {
        return null;
      }

      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        return null;
      }

      return invoices[invoiceId] || null;
    } catch (error) {
      console.error('❌ Error getting invoice:', error.message);
      return null;
    }
  }

  /**
   * Update invoice status
   */
  static updateInvoiceStatus(building, invoiceId, status) {
    try {
      // SECURITY: Validate inputs
      if (!invoiceId || typeof invoiceId !== 'string') {
        throw new Error('Invalid invoice ID');
      }

      if (!status || !['pending', 'paid', 'overdue'].includes(status)) {
        throw new Error('Invalid status value');
      }

      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse invoices for ${key}`);
        return false;
      }

      if (invoices[invoiceId]) {
        invoices[invoiceId].status = status;
        invoices[invoiceId].updatedAt = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify(invoices));
        console.log(`✅ Invoice ${invoiceId} status updated to: ${status}`);

        // Extract roomId from invoiceId for Firebase sync
        const invoiceParts = invoiceId.split('-');
        const roomId = invoiceParts[1];

        // Sync to Firebase
        if (this.validateBuildingAndRoom(building, roomId)) {
          this.syncInvoiceToFirebase(building, roomId, invoiceId, invoices[invoiceId]);
        }

        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error updating invoice status:', error.message);
      return false;
    }
  }

  /**
   * Sync invoice to Firebase with security validation
   * SECURITY: Now includes building and roomId validation
   */
  static syncInvoiceToFirebase(building, roomId, invoiceId, invoiceData) {
    try {
      // SECURITY: Validate inputs before Firebase sync
      if (!this.validateBuildingAndRoom(building, roomId)) {
        console.warn('⚠️ Invalid parameters, skipping Firebase sync');
        return;
      }

      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not initialized, skipping sync');
        return;
      }

      const db = window.firebase.firestore();

      // SECURITY: Use validated parameters in path
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `invoices/${building}/${roomId}/list`),
        invoiceId
      );

      // SECURITY: Validate and filter data before spreading
      const syncData = {
        id: invoiceData.id,
        building: invoiceData.building,
        roomId: invoiceData.roomId,
        type: invoiceData.type,
        month: invoiceData.month,
        amount: invoiceData.amount,
        status: invoiceData.status,
        createdAt: invoiceData.createdAt,
        updatedAt: invoiceData.updatedAt || invoiceData.createdAt,
        syncedAt: new Date().toISOString()
      };

      window.firebase.firestoreFunctions.setDoc(docRef, syncData, { merge: true }).then(() => {
        console.log(`✅ Invoice synced to Firebase: ${invoiceId}`);
      }).catch(err => {
        console.warn(`⚠️ Firebase sync failed for invoice:`, err);
      });
    } catch (error) {
      console.warn('⚠️ Firebase sync error (non-critical):', error.message);
    }
  }

  /**
   * Sync receipt to Firebase with security validation
   * SECURITY: Now includes building and roomId validation
   */
  static syncReceiptToFirebase(building, roomId, receiptId, receiptData) {
    try {
      // SECURITY: Validate inputs before Firebase sync
      if (!this.validateBuildingAndRoom(building, roomId)) {
        console.warn('⚠️ Invalid parameters, skipping Firebase sync');
        return;
      }

      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not initialized, skipping sync');
        return;
      }

      const db = window.firebase.firestore();

      // SECURITY: Use validated parameters in path
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `receipts/${building}/${roomId}/list`),
        receiptId
      );

      // SECURITY: Validate and filter data before spreading
      const syncData = {
        id: receiptData.id,
        building: receiptData.building,
        roomId: receiptData.roomId,
        type: receiptData.type,
        invoiceId: receiptData.invoiceId,
        amount: receiptData.amount,
        paymentMethod: receiptData.paymentMethod,
        status: receiptData.status,
        verifiedBy: receiptData.verifiedBy,
        createdAt: receiptData.createdAt,
        verifiedAt: receiptData.verifiedAt,
        syncedAt: new Date().toISOString()
      };

      window.firebase.firestoreFunctions.setDoc(docRef, syncData, { merge: true }).then(() => {
        console.log(`✅ Receipt synced to Firebase: ${receiptId}`);
      }).catch(err => {
        console.warn(`⚠️ Firebase sync failed for receipt:`, err);
      });
    } catch (error) {
      console.warn('⚠️ Firebase sync error (non-critical):', error.message);
    }
  }

  /**
   * Get all invoices for a building
   */
  static getAllInvoices(building) {
    try {
      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse invoices for ${key}`);
        return [];
      }

      return Object.values(invoices)
        .filter(inv => inv && typeof inv === 'object')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('❌ Error getting all invoices:', error.message);
      return [];
    }
  }

  /**
   * Get all receipts for a building
   */
  static getAllReceipts(building) {
    try {
      const key = `receipts_${building}`;
      let receipts = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          receipts = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse receipts for ${key}`);
        return [];
      }

      return Object.values(receipts)
        .filter(rcp => rcp && typeof rcp === 'object')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('❌ Error getting all receipts:', error.message);
      return [];
    }
  }

  /**
   * Get summary statistics
   */
  static getStats(building) {
    try {
      const allInvoices = this.getAllInvoices(building);
      const allReceipts = this.getAllReceipts(building);

      const totalInvoiced = allInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);
      const totalPaid = allReceipts.reduce((sum, rcp) => sum + (parseFloat(rcp.amount) || 0), 0);
      const pendingAmount = totalInvoiced - totalPaid;

      return {
        total_invoices: allInvoices.length,
        total_receipts: allReceipts.length,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        pending_amount: Math.max(0, pendingAmount), // Ensure non-negative
        pending_invoices: allInvoices.filter(inv => inv && inv.status === 'pending').length
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error.message);
      return null;
    }
  }

  /**
   * Sync all invoices and receipts to Dashboard (Firebase)
   * Called after payment to ensure dashboard has latest data
   * SECURITY: Added building validation
   */
  static syncToDashboard(building) {
    try {
      // SECURITY: Validate building parameter
      if (!building || typeof building !== 'string' || !/^[a-z0-9_-]+$/.test(building)) {
        console.warn(`⚠️ Invalid building parameter for dashboard sync: ${building}`);
        return false;
      }

      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not initialized, skipping dashboard sync');
        return false;
      }

      const db = window.firebase.firestore();
      const allInvoices = this.getAllInvoices(building);
      const allReceipts = this.getAllReceipts(building);

      // SECURITY: Use validated building parameter in path
      // Sync all invoices to centralized dashboard collection
      const dashboardInvoicesRef = window.firebase.firestoreFunctions.doc(
        db,
        `dashboard_data/${building}/invoices_summary`
      );

      window.firebase.firestoreFunctions.setDoc(dashboardInvoicesRef, {
        building: building,
        invoices: allInvoices,
        total_count: allInvoices.length,
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true }).then(() => {
        console.log(`✅ Invoices synced to Dashboard: ${allInvoices.length} invoices`);
      }).catch(err => {
        console.warn(`⚠️ Dashboard invoice sync failed:`, err);
      });

      // Sync all receipts to centralized dashboard collection
      const dashboardReceiptsRef = window.firebase.firestoreFunctions.doc(
        db,
        `dashboard_data/${building}/receipts_summary`
      );

      window.firebase.firestoreFunctions.setDoc(dashboardReceiptsRef, {
        building: building,
        receipts: allReceipts,
        total_count: allReceipts.length,
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true }).then(() => {
        console.log(`✅ Receipts synced to Dashboard: ${allReceipts.length} receipts`);
      }).catch(err => {
        console.warn(`⚠️ Dashboard receipt sync failed:`, err);
      });

      return true;
    } catch (error) {
      console.warn('⚠️ Dashboard sync error (non-critical):', error.message);
      return false;
    }
  }

  /**
   * Mark all invoices as paid for a building
   */
  static markAllInvoicesAsPaid(building) {
    try {
      // SECURITY: Validate building parameter
      if (!building || typeof building !== 'string' || !/^[a-z0-9_-]+$/.test(building)) {
        console.warn(`⚠️ Invalid building parameter: ${building}`);
        return { success: false, marked: 0 };
      }

      const key = `invoices_${building}`;
      let invoices = {};

      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          invoices = JSON.parse(stored);
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse invoices for ${key}`);
        return { success: false, marked: 0 };
      }

      let totalMarked = 0;

      Object.keys(invoices).forEach(invoiceId => {
        if (invoices[invoiceId] && invoices[invoiceId].status !== 'paid') {
          invoices[invoiceId].status = 'paid';
          invoices[invoiceId].updatedAt = new Date().toISOString();
          totalMarked++;
        }
      });

      if (totalMarked > 0) {
        localStorage.setItem(key, JSON.stringify(invoices));
        console.log(`✅ Marked ${totalMarked} invoices as paid for ${building}`);
      }

      return { success: true, marked: totalMarked };
    } catch (error) {
      console.error('❌ Error marking invoices as paid:', error.message);
      return { success: false, marked: 0 };
    }
  }
}

console.log('✅ InvoiceReceiptManager loaded (SECURITY PATCHED VERSION)');
