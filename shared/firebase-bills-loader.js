/**
 * Firebase Bills Loader
 * Loads real bills from Firebase Realtime Database
 * Used by tenant app to display pre-calculated bills
 */

class FirebaseBillsLoader {
  /**
   * Load bills for a room from Firebase
   * @param {string} building - Building ID ('rooms' or 'nest')
   * @param {string} roomId - Room ID
   * @returns {Promise<Array>} Bills array or empty array if not found
   */
  static async loadBillsFromFirebase(building, roomId) {
    try {
      if (!window.firebaseDatabase) {
        console.warn('⚠️ Firebase database not initialized');
        return [];
      }

      const { ref: firebaseRef, get: firebaseGet } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');

      const billsRef = firebaseRef(window.firebaseDatabase, `bills/${building}/${roomId}`);
      const snapshot = await firebaseGet(billsRef);

      if (snapshot.exists()) {
        const billsData = snapshot.val();
        const billsArray = Object.values(billsData);
        console.log(`✅ Loaded ${billsArray.length} real bills for ${building}/${roomId} from Firebase`);
        return billsArray;
      } else {
        console.log(`ℹ️ No bills found in Firebase for ${building}/${roomId}`);
        return [];
      }
    } catch (error) {
      console.warn(`⚠️ Firebase bill loading failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Format bill data for display
   * Converts stored bill structure to UI-friendly format
   */
  static formatBillForDisplay(bill) {
    if (!bill) return null;

    const monthNames = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monthName = monthNames[bill.month] || `Month ${bill.month}`;

    return {
      billId: bill.billId,
      month: monthName,
      year: bill.year + 543, // Convert to Buddhist year
      yearMonth: `${bill.year}${String(bill.month).padStart(2, '0')}`,
      rent: bill.charges?.rent || bill.charges?.rentCost || 0,
      electric: bill.charges?.electric?.cost || bill.charges?.electricCost || 0,
      water: bill.charges?.water?.cost || bill.charges?.waterCost || 0,
      trash: bill.charges?.trash || 0,
      common: bill.charges?.common || 0,
      total: bill.totalCharge || 0,
      status: bill.status || 'pending',
      meterReadings: bill.meterReadings || {},
      createdAt: bill.billDate || bill.createdAt || new Date().toISOString()
    };
  }

  /**
   * Filter bills to last 12 months (for tenant app)
   */
  static filterLast12Months(bills) {
    if (!bills || bills.length === 0) return [];

    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    return bills.filter(bill => {
      const billDate = new Date(bill.year, bill.month - 1, 1);
      return billDate >= twelveMonthsAgo;
    }).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }

  /**
   * Get all bills (for dashboard)
   */
  static getAllBills(bills) {
    if (!bills || bills.length === 0) return [];

    return bills.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }
}
