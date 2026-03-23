/**
 * Invoice & Receipt Manager
 * Manages storage and retrieval of invoices (ใบวางบิล) and receipts (ใบเสร็จรับเงิน)
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
   * Create new invoice (ใบวางบิล)
   */
  static createInvoice(building, roomId, month, breakdown) {
    try {
      // Generate invoice ID: INV-ROOM-YYYY-MM
      const invoiceId = `INV-${roomId}-${month}`;

      // Calculate total
      const total = (breakdown.rent || 0) +
                   (breakdown.electric || 0) +
                   (breakdown.water || 0) +
                   (breakdown.trash || 0);

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
      const invoices = JSON.parse(localStorage.getItem(key) || '{}');
      invoices[invoiceId] = invoice;
      localStorage.setItem(key, JSON.stringify(invoices));

      console.log(`✅ Invoice created: ${invoiceId}`);

      // Sync to Firebase
      this.syncInvoiceToFirebase(building, invoiceId, invoice);

      return invoice;
    } catch (error) {
      console.error('❌ Error creating invoice:', error);
      return null;
    }
  }

  /**
   * Create receipt (ใบเสร็จรับเงิน) from verified payment
   */
  static createReceipt(building, invoiceId, paymentData) {
    try {
      // Generate receipt ID: RCP-ROOM-TIMESTAMP
      const timestamp = Date.now();
      const roomId = invoiceId.split('-')[1]; // Extract room from invoice ID
      const receiptId = `RCP-${roomId}-${timestamp}`;

      // Create receipt object
      const receipt = {
        id: receiptId,
        building: building,
        roomId: roomId,
        type: 'receipt', // ใบเสร็จรับเงิน
        invoiceId: invoiceId,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod || 'slip', // slip, cash, transfer
        slipData: paymentData.slipData || null,
        slipOkVerified: paymentData.slipOkVerified || false,
        verifiedBy: paymentData.verifiedBy || 'admin',
        createdAt: new Date().toISOString(),
        verifiedAt: paymentData.verifiedAt || new Date().toISOString(),
        status: 'completed'
      };

      // Save to localStorage
      const key = `receipts_${building}`;
      const receipts = JSON.parse(localStorage.getItem(key) || '{}');
      receipts[receiptId] = receipt;
      localStorage.setItem(key, JSON.stringify(receipts));

      console.log(`✅ Receipt created: ${receiptId}`);

      // Update invoice status to 'paid'
      this.updateInvoiceStatus(building, invoiceId, 'paid');

      // Sync to Firebase
      this.syncReceiptToFirebase(building, receiptId, receipt);

      return receipt;
    } catch (error) {
      console.error('❌ Error creating receipt:', error);
      return null;
    }
  }

  /**
   * Get all invoices for a room
   */
  static getInvoicesByRoom(building, roomId) {
    try {
      const key = `invoices_${building}`;
      const invoices = JSON.parse(localStorage.getItem(key) || '{}');

      const roomInvoices = Object.values(invoices)
        .filter(inv => inv.roomId === roomId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return roomInvoices;
    } catch (error) {
      console.error('❌ Error getting invoices:', error);
      return [];
    }
  }

  /**
   * Get all receipts for a room
   */
  static getReceiptsByRoom(building, roomId) {
    try {
      const key = `receipts_${building}`;
      const receipts = JSON.parse(localStorage.getItem(key) || '{}');

      const roomReceipts = Object.values(receipts)
        .filter(rcp => rcp.roomId === roomId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return roomReceipts;
    } catch (error) {
      console.error('❌ Error getting receipts:', error);
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
      console.error('❌ Error getting history:', error);
      return [];
    }
  }

  /**
   * Get invoice by ID
   */
  static getInvoice(building, invoiceId) {
    try {
      const key = `invoices_${building}`;
      const invoices = JSON.parse(localStorage.getItem(key) || '{}');
      return invoices[invoiceId] || null;
    } catch (error) {
      console.error('❌ Error getting invoice:', error);
      return null;
    }
  }

  /**
   * Update invoice status
   */
  static updateInvoiceStatus(building, invoiceId, status) {
    try {
      const key = `invoices_${building}`;
      const invoices = JSON.parse(localStorage.getItem(key) || '{}');

      if (invoices[invoiceId]) {
        invoices[invoiceId].status = status;
        invoices[invoiceId].updatedAt = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify(invoices));
        console.log(`✅ Invoice ${invoiceId} status updated to: ${status}`);

        // Sync to Firebase
        this.syncInvoiceToFirebase(building, invoiceId, invoices[invoiceId]);

        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error updating invoice status:', error);
      return false;
    }
  }

  /**
   * Sync invoice to Firebase
   */
  static syncInvoiceToFirebase(building, invoiceId, invoiceData) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not initialized, skipping sync');
        return;
      }

      const db = window.firebase.firestore();
      const roomId = invoiceData.roomId;
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `invoices/${building}/${roomId}/list`),
        invoiceId
      );

      window.firebase.firestoreFunctions.setDoc(docRef, {
        ...invoiceData,
        syncedAt: new Date().toISOString()
      }, { merge: true }).then(() => {
        console.log(`✅ Invoice synced to Firebase: ${invoiceId}`);
      }).catch(err => {
        console.warn(`⚠️ Firebase sync failed for invoice:`, err);
      });
    } catch (error) {
      console.warn('⚠️ Firebase sync error (non-critical):', error);
    }
  }

  /**
   * Sync receipt to Firebase
   */
  static syncReceiptToFirebase(building, receiptId, receiptData) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not initialized, skipping sync');
        return;
      }

      const db = window.firebase.firestore();
      const roomId = receiptData.roomId;
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `receipts/${building}/${roomId}/list`),
        receiptId
      );

      window.firebase.firestoreFunctions.setDoc(docRef, {
        ...receiptData,
        syncedAt: new Date().toISOString()
      }, { merge: true }).then(() => {
        console.log(`✅ Receipt synced to Firebase: ${receiptId}`);
      }).catch(err => {
        console.warn(`⚠️ Firebase sync failed for receipt:`, err);
      });
    } catch (error) {
      console.warn('⚠️ Firebase sync error (non-critical):', error);
    }
  }

  /**
   * Get all invoices for a building
   */
  static getAllInvoices(building) {
    try {
      const key = `invoices_${building}`;
      const invoices = JSON.parse(localStorage.getItem(key) || '{}');
      return Object.values(invoices).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('❌ Error getting all invoices:', error);
      return [];
    }
  }

  /**
   * Get all receipts for a building
   */
  static getAllReceipts(building) {
    try {
      const key = `receipts_${building}`;
      const receipts = JSON.parse(localStorage.getItem(key) || '{}');
      return Object.values(receipts).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('❌ Error getting all receipts:', error);
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

      const totalInvoiced = allInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const totalPaid = allReceipts.reduce((sum, rcp) => sum + (rcp.amount || 0), 0);
      const pendingAmount = totalInvoiced - totalPaid;

      return {
        total_invoices: allInvoices.length,
        total_receipts: allReceipts.length,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        pending_amount: pendingAmount,
        pending_invoices: allInvoices.filter(inv => inv.status === 'pending').length
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return null;
    }
  }
}

console.log('✅ InvoiceReceiptManager loaded');
