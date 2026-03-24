/**
 * Billing Calculator System
 * Auto-generates bills from meter readings with full historical tracking
 * ระบบคำนวนบิลอัตโนมัติจากข้อมูลมิเตอร์ ติดตาม history ตั้งแต่ปี 67
 */

class BillingCalculator {
  /**
   * Calculate usage from meter readings
   * @param {number} currentReading - Current meter reading
   * @param {number} previousReading - Previous meter reading
   * @returns {object} - { usage, valid, error }
   */
  static calculateUsage(currentReading, previousReading = 0) {
    const curr = parseFloat(currentReading) || 0;
    const prev = parseFloat(previousReading) || 0;

    if (curr < prev) {
      return {
        usage: 0,
        valid: false,
        error: `มิเตอร์ถูกรีเซ็ต: เดิม ${prev} → ปัจจุบัน ${curr}`
      };
    }

    return {
      usage: curr - prev,
      valid: true,
      error: null
    };
  }

  /**
   * Calculate bill cost
   * @param {number} usage - Unit usage
   * @param {number} rate - Rate per unit
   * @returns {number} - Total cost
   */
  static calculateCost(usage, rate) {
    return (parseFloat(usage) || 0) * (parseFloat(rate) || 0);
  }

  /**
   * Generate bill for a room for a specific month
   * @param {object} billData - Bill data structure
   * @returns {object} - Complete bill with breakdown
   */
  static generateBill(billData) {
    const {
      building,
      roomId,
      month,
      year,
      rentPrice = 0,
      waterCurrentReading = 0,
      waterPreviousReading = 0,
      waterRate = 20,
      electricCurrentReading = 0,
      electricPreviousReading = 0,
      electricRate = 8,
      commonChargePerRoom = 0,
      trashCharge = 40,
      notes = ''
    } = billData;

    // Calculate water usage and cost
    const waterUsageResult = this.calculateUsage(waterCurrentReading, waterPreviousReading);
    const waterUsage = waterUsageResult.usage;
    const waterCost = this.calculateCost(waterUsage, waterRate);

    // Calculate electric usage and cost
    const electricUsageResult = this.calculateUsage(electricCurrentReading, electricPreviousReading);
    const electricUsage = electricUsageResult.usage;
    const electricCost = this.calculateCost(electricUsage, electricRate);

    // Calculate common charge
    const commonCharge = parseFloat(commonChargePerRoom) || 0;

    // Generate bill ID
    const billId = `BILL-${year}-${String(month).padStart(2, '0')}-${building}-${roomId}`;

    // Calculate totals
    const totalCharge =
      parseFloat(rentPrice) +
      waterCost +
      electricCost +
      commonCharge +
      parseFloat(trashCharge);

    return {
      billId,
      building,
      roomId,
      month,
      year,
      billDate: new Date().toISOString(),
      charges: {
        rent: parseFloat(rentPrice),
        water: {
          usage: waterUsage,
          rate: waterRate,
          cost: waterCost
        },
        electric: {
          usage: electricUsage,
          rate: electricRate,
          cost: electricCost
        },
        common: commonCharge,
        trash: parseFloat(trashCharge)
      },
      totalCharge,
      meterReadings: {
        water: {
          previous: waterPreviousReading,
          current: waterCurrentReading,
          usage: waterUsage
        },
        electric: {
          previous: electricPreviousReading,
          current: electricCurrentReading,
          usage: electricUsage
        }
      },
      status: 'pending', // pending, paid, overdue
      notes,
      errors: [
        ...(waterUsageResult.valid ? [] : [waterUsageResult.error]),
        ...(electricUsageResult.valid ? [] : [electricUsageResult.error])
      ]
    };
  }

  /**
   * Generate historical bills from meter data
   * @param {object} meterDataByMonth - Meter readings grouped by month
   * @param {object} roomRates - Rates and rent for each room
   * @returns {array} - Array of generated bills
   */
  static generateHistoricalBills(meterDataByMonth, roomRates) {
    const bills = [];

    // Sort months chronologically
    const sortedMonths = Object.keys(meterDataByMonth).sort((a, b) => {
      const [yearA, monthA] = a.split('-').map(Number);
      const [yearB, monthB] = b.split('-').map(Number);
      return yearA === yearB ? monthA - monthB : yearA - yearB;
    });

    // Generate bills for each month
    sortedMonths.forEach((monthKey, index) => {
      const [year, month] = monthKey.split('-').map(Number);
      const monthMeterData = meterDataByMonth[monthKey];

      Object.keys(monthMeterData).forEach((roomId) => {
        const room = monthMeterData[roomId];
        const prevMonthKey = index > 0 ? sortedMonths[index - 1] : null;
        const prevMonthData = prevMonthKey ? meterDataByMonth[prevMonthKey][roomId] : null;

        const previousWaterReading = prevMonthData?.currentWater || room.startWater || 0;
        const previousElectricReading = prevMonthData?.currentElectric || room.startElectric || 0;

        const roomConfig = roomRates[roomId] || {};
        const [building] = this.detectBuilding(roomId);

        const billData = {
          building,
          roomId,
          month,
          year,
          rentPrice: roomConfig.rentPrice || 0,
          waterCurrentReading: room.currentWater || 0,
          waterPreviousReading: previousWaterReading,
          waterRate: roomConfig.waterRate || 20,
          electricCurrentReading: room.currentElectric || 0,
          electricPreviousReading: previousElectricReading,
          electricRate: roomConfig.electricRate || 8,
          commonChargePerRoom: roomConfig.commonCharge || 0,
          trashCharge: roomConfig.trashCharge || 40,
          notes: room.notes || ''
        };

        bills.push(this.generateBill(billData));
      });
    });

    return bills;
  }

  /**
   * Detect building from room ID
   * @param {string} roomId - Room identifier
   * @returns {array} - [building, roomNumber]
   */
  static detectBuilding(roomId) {
    const roomStr = roomId.toString();
    if (roomStr.startsWith('N') || roomStr.startsWith('n')) {
      return ['nest', roomStr];
    }
    const numRoom = parseInt(roomStr);
    const building = numRoom >= 101 && numRoom <= 405 ? 'nest' : 'rooms';
    return [building, roomStr];
  }

  /**
   * Save bills to localStorage
   * @param {array} bills - Array of bill objects
   * @param {string} year - Year to save under
   */
  static saveBillsToLocalStorage(bills, year) {
    const key = `bills_${year}`;
    const existingBills = JSON.parse(localStorage.getItem(key) || '[]');

    // Merge with existing bills (update if same billId)
    const billMap = new Map();
    existingBills.forEach((bill) => billMap.set(bill.billId, bill));
    bills.forEach((bill) => billMap.set(bill.billId, bill));

    const mergedBills = Array.from(billMap.values());
    localStorage.setItem(key, JSON.stringify(mergedBills));

    console.log(`✅ Saved ${bills.length} bills for year ${year}`);
    return mergedBills;
  }

  /**
   * Get bills for a room
   * @param {string} roomId - Room identifier
   * @param {number} year - Year (optional)
   * @returns {array} - Array of bills for the room
   */
  static getBillsByRoom(roomId, year = null) {
    const bills = [];

    if (year) {
      const key = `bills_${year}`;
      const yearBills = JSON.parse(localStorage.getItem(key) || '[]');
      return yearBills.filter((bill) => bill.roomId === roomId);
    }

    // Get all years
    for (let y = 2567; y <= 2570; y++) {
      const key = `bills_${y}`;
      const yearBills = JSON.parse(localStorage.getItem(key) || '[]');
      bills.push(...yearBills.filter((bill) => bill.roomId === roomId));
    }

    return bills;
  }

  /**
   * Get bill for a room in a specific month/year
   * @param {string} roomId - Room identifier
   * @param {number} month - Month (1-12)
   * @param {number} year - Year
   * @returns {object|null} - Bill object or null
   */
  static getBillByMonthYear(roomId, month, year) {
    const billId = `BILL-${year}-${String(month).padStart(2, '0')}-*-${roomId}`;
    const key = `bills_${year}`;
    const yearBills = JSON.parse(localStorage.getItem(key) || '[]');

    return yearBills.find((bill) => bill.month === month && bill.roomId === roomId) || null;
  }

  /**
   * Update bill status (paid, pending, overdue)
   * @param {string} billId - Bill identifier
   * @param {string} status - New status
   * @param {number} year - Year
   */
  static updateBillStatus(billId, status, year) {
    const key = `bills_${year}`;
    const bills = JSON.parse(localStorage.getItem(key) || '[]');

    const billIndex = bills.findIndex((b) => b.billId === billId);
    if (billIndex >= 0) {
      bills[billIndex].status = status;
      bills[billIndex].updatedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(bills));
      console.log(`✅ Updated bill ${billId} status to ${status}`);
      return bills[billIndex];
    }

    return null;
  }

  /**
   * Generate summary report for a month
   * @param {number} month - Month
   * @param {number} year - Year
   * @returns {object} - Summary with totals
   */
  static generateMonthlySummary(month, year) {
    const key = `bills_${year}`;
    const yearBills = JSON.parse(localStorage.getItem(key) || '[]');
    const monthBills = yearBills.filter((bill) => bill.month === month);

    const summary = {
      year,
      month,
      totalRooms: monthBills.length,
      totalBills: monthBills.length,
      totalCharge: 0,
      totalWaterUsage: 0,
      totalElectricUsage: 0,
      paidCount: 0,
      pendingCount: 0,
      bills: monthBills
    };

    monthBills.forEach((bill) => {
      summary.totalCharge += bill.totalCharge || 0;
      summary.totalWaterUsage += bill.meterReadings?.water?.usage || 0;
      summary.totalElectricUsage += bill.meterReadings?.electric?.usage || 0;

      if (bill.status === 'paid') summary.paidCount++;
      if (bill.status === 'pending') summary.pendingCount++;
    });

    return summary;
  }

  /**
   * Export bills to CSV format
   * @param {array} bills - Array of bills
   * @returns {string} - CSV content
   */
  static exportToCSV(bills) {
    const headers = [
      'Bill ID',
      'Room',
      'Month/Year',
      'Rent',
      'Water (Units)',
      'Water Cost',
      'Electric (Units)',
      'Electric Cost',
      'Common Charge',
      'Trash',
      'Total',
      'Status'
    ];

    const rows = bills.map((bill) => [
      bill.billId,
      bill.roomId,
      `${bill.month}/${bill.year}`,
      bill.charges.rent.toFixed(2),
      bill.charges.water.usage.toFixed(2),
      bill.charges.water.cost.toFixed(2),
      bill.charges.electric.usage.toFixed(2),
      bill.charges.electric.cost.toFixed(2),
      bill.charges.common.toFixed(2),
      bill.charges.trash.toFixed(2),
      bill.totalCharge.toFixed(2),
      bill.status
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    return csv;
  }
}

// Expose globally
window.BillingCalculator = BillingCalculator;

console.log('✅ BillingCalculator loaded');
