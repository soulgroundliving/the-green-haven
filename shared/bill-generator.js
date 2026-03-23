/**
 * Bill Generator
 * Automatically generates monthly invoices for all active rooms
 *
 * Usage:
 * BillGenerator.generateMonthlyBills('rooms', 2569, 3);  // March 2026 (Buddhist year)
 */

class BillGenerator {
  /**
   * Generate invoices for all rooms in a building for a specific month
   */
  static generateMonthlyBills(building, year, month) {
    try {
      console.log(`🔄 Generating invoices for ${building} building, ${month}/${year}...`);

      if (typeof RoomConfigManager === 'undefined') {
        console.error('❌ RoomConfigManager not loaded');
        return { success: false, count: 0 };
      }

      if (typeof InvoiceReceiptManager === 'undefined') {
        console.error('❌ InvoiceReceiptManager not loaded');
        return { success: false, count: 0 };
      }

      // 1. Get all active rooms
      const allRooms = RoomConfigManager.getRoomsConfig(building);
      const activeRooms = allRooms.rooms.filter(r => !r.deleted);

      let invoiceCount = 0;
      const invoiceIds = [];

      // 2. Generate invoice for each room
      activeRooms.forEach(room => {
        try {
          // Get meter reading for this month (if exists)
          const meterKey = `${building}_${room.id}_${year}_${month}`;
          const meterData = JSON.parse(localStorage.getItem('meter_data') || '{}');
          const roomMeter = meterData[meterKey] || null;

          // Calculate charges
          const breakdown = {
            rent: room.rentPrice || 1500,
            electric: (roomMeter?.electric_current || 0) * (room.electricRate || 8),
            water: (roomMeter?.water_current || 0) * (room.waterRate || 20),
            trash: 40  // Fixed common fee
          };

          // Create invoice
          const monthStr = String(month).padStart(2, '0');
          const invoiceMonth = `${year}_${monthStr}`;

          const invoice = InvoiceReceiptManager.createInvoice(
            building,
            room.id,
            invoiceMonth,
            breakdown,
            {
              qrCode: this.generatePromptPayQR(breakdown.rent + breakdown.electric + breakdown.water + breakdown.trash),
              notes: `ค่าเช่าประจำเดือน ${this.getThaiMonthName(month)} ${year}`
            }
          );

          if (invoice) {
            invoiceCount++;
            invoiceIds.push(invoice.id);
            console.log(`✅ Invoice created: ${invoice.id} for room ${room.id}`);
          }
        } catch (error) {
          console.warn(`⚠️ Error creating invoice for room ${room.id}:`, error);
        }
      });

      // 3. Notify tenants
      this.notifyTenantsOfNewInvoices(building, invoiceIds);

      console.log(`✅ Generated ${invoiceCount}/${activeRooms.length} invoices`);

      return {
        success: true,
        count: invoiceCount,
        invoiceIds: invoiceIds
      };
    } catch (error) {
      console.error('❌ Error in generateMonthlyBills:', error);
      return { success: false, count: 0 };
    }
  }

  /**
   * Generate PromptPay QR code (simplified - returns URL)
   */
  static generatePromptPayQR(amount) {
    // In production, integrate with PromptPay QR generation API
    // For now, return mobile number linked to PromptPay
    return {
      type: 'promptpay',
      identifier: '0891234567',  // Replace with actual PromptPay account
      amount: amount
    };
  }

  /**
   * Notify tenants of new invoices via event
   */
  static notifyTenantsOfNewInvoices(building, invoiceIds) {
    try {
      // Trigger storage event for tenant app to listen
      const notification = {
        type: 'new_invoices',
        building: building,
        invoiceIds: invoiceIds,
        timestamp: new Date().toISOString(),
        count: invoiceIds.length
      };

      // Store notification
      let notifications = JSON.parse(localStorage.getItem('invoice_notifications') || '[]');
      notifications.push(notification);
      localStorage.setItem('invoice_notifications', JSON.stringify(notifications));

      // Trigger event for all listeners
      window.dispatchEvent(new Event('new_invoices_generated'));

      console.log(`📢 Notified of ${invoiceIds.length} new invoices`);
    } catch (error) {
      console.warn('⚠️ Error notifying tenants:', error);
    }
  }

  /**
   * Get Thai month name
   */
  static getThaiMonthName(monthNum) {
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    return months[monthNum - 1] || 'ไม่ระบุ';
  }
}

console.log('✅ BillGenerator loaded');
