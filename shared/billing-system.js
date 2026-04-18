/**
 * Billing System - Unified
 * Consolidates bill calculation and auto-generation from meter data
 * ระบบบิลแบบรวม: คำนวนบิล + สร้างบิลอัตโนมัติจากข้อมูลมิเตอร์
 */

class BillingSystem {
  /**
   * ===== CALCULATION METHODS =====
   */

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
   * ===== BILL GENERATION METHODS =====
   */

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
      status: 'pending',
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
   * ===== FIREBASE AUTO-GENERATION METHODS =====
   */

  /**
   * Generate bills from Firebase meter data
   * @param {string} building - 'rooms' or 'nest'
   * @param {number} year - Buddhist year (e.g., 2569)
   * @returns {Promise<Array>} - Array of generated bill objects
   */
  static async generateBillsFromMeterData(building, year) {
    console.log(`\n🔄 Auto-generating bills for ${building}/${year} from meter data...`);

    try {
      if (!window.firebase?.firestore) {
        console.warn('⚠️ Firebase Firestore not available');
        return [];
      }

      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const generatedBills = [];

      // Query all meter data for this building and year
      const q = fs.query(
        fs.collection(db, 'meter_data'),
        fs.where('building', '==', building),
        fs.where('year', '==', year)
      );

      const querySnap = await fs.getDocs(q);

      if (querySnap.size === 0) {
        console.log(`⏭️ No meter data found for ${building}/${year}`);
        return [];
      }

      console.log(`📊 Found ${querySnap.size} meter readings for ${building}/${year}`);

      // Group by room and month
      const metersByRoomMonth = {};
      querySnap.forEach(doc => {
        const data = doc.data();
        const key = `${data.roomId}_${String(data.month).padStart(2, '0')}`;
        metersByRoomMonth[key] = data;
      });

      console.log(`📈 Organizing into ${Object.keys(metersByRoomMonth).length} room-month combinations`);

      // Generate bills for each room-month combination
      for (const [key, meterData] of Object.entries(metersByRoomMonth)) {
        try {
          const bill = await this.calculateBillFromMeterData(building, meterData);
          if (bill) {
            generatedBills.push(bill);
          }
        } catch (e) {
          console.warn(`⚠️ Failed to generate bill for ${key}:`, e.message);
        }
      }

      console.log(`✅ Generated ${generatedBills.length} bills`);
      return generatedBills;

    } catch (error) {
      console.error('❌ Error generating bills from meter data:', error);
      return [];
    }
  }

  /**
   * Calculate bill from meter data document
   * @param {string} building - 'rooms' or 'nest'
   * @param {Object} meterData - Meter data from Firestore
   * @returns {Promise<Object>} - Bill object
   */
  static async calculateBillFromMeterData(building, meterData) {
    try {
      const {
        roomId,
        year,
        month,
        eNew = 0,
        eOld = 0,
        wNew = 0,
        wOld = 0,
        createdAt = new Date().toISOString()
      } = meterData;

      // Get room configuration for rates
      let room = null;
      if (typeof RoomConfigManager !== 'undefined') {
        room = RoomConfigManager.getRoom(building, roomId);
      }

      const eRate = room?.elecRate ?? room?.electricRate;
      const wRate = room?.waterRate;
      const rent = room?.rent;
      const trash = room?.trashFee ?? 40;

      if (eRate == null || wRate == null || rent == null) {
        const missing = [eRate == null && 'elecRate', wRate == null && 'waterRate', rent == null && 'rent'].filter(Boolean).join(', ');
        console.error(`❌ BillingSystem.calculateBillFromMeterData: room ${building}/${roomId} missing required field(s): ${missing}. Aborting bill generation to prevent silent overcharge.`);
        return null;
      }

      // Calculate usage
      const eUnits = Math.max(0, eNew - eOld);
      const wUnits = Math.max(0, wNew - wOld);

      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const totalCharge = rent + eCost + wCost + trash;

      // Create bill ID
      const billId = `TGH-${year}${String(month).padStart(2, '0')}-${roomId}`;

      // Build bill object matching tenant app's expected format
      const bill = {
        billId,
        roomId,
        building,
        month,
        year,
        status: 'pending',
        billDate: new Date(createdAt).toISOString().split('T')[0],
        totalCharge: Math.round(totalCharge),
        charges: {
          rent: Math.round(rent),
          rentLabel: 'ค่าเช่าห้อง',
          electric: Math.round(eCost),
          water: Math.round(wCost),
          trash: Math.round(trash),
          common: 0,
          total: Math.round(totalCharge)
        },
        meterReadings: {
          electric: {
            old: Math.round(eOld),
            new: Math.round(eNew),
            units: Math.round(eUnits),
            rate: eRate
          },
          water: {
            old: Math.round(wOld),
            new: Math.round(wNew),
            units: Math.round(wUnits),
            rate: wRate
          }
        },
        createdAt,
        updatedAt: new Date().toISOString()
      };

      console.log(`  ✅ ${roomId} month ${month}: ฿${totalCharge}`);
      return bill;

    } catch (error) {
      console.error('Error calculating bill:', error);
      return null;
    }
  }

  /**
   * Auto-generate bills for current and previous years
   * @returns {Promise<number>} - Number of bills generated
   */
  static async autogenerateBillsForAllYears(building) {
    console.log(`\n🚀 ===== AUTO-BILL GENERATION =====`);
    console.log(`Building: ${building}`);

    try {
      if (!window.firebase?.firestore) {
        console.warn('⚠️ Firebase Firestore not initialized');
        return 0;
      }

      // Get current year (Buddhist calendar)
      const today = new Date();
      const currentBudYear = today.getFullYear() + 543;

      // Generate bills for current and previous 2 years
      const yearsToGenerate = [
        currentBudYear,
        currentBudYear - 1,
        currentBudYear - 2
      ];

      let totalGenerated = 0;

      for (const year of yearsToGenerate) {
        try {
          const bills = await this.generateBillsFromMeterData(building, year);
          const saved = this.saveBillsToLocalStorage(bills);
          // Push to RTDB so tenants on mobile see the same bills (admin-only path —
          // _bootstrapAutoBilling already gates this to admin dashboard)
          await this.pushBillsToFirebase(building, bills);
          totalGenerated += saved;
        } catch (e) {
          console.warn(`⚠️ Failed to generate bills for year ${year}:`, e.message);
        }
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ AUTO-GENERATION COMPLETE`);
      console.log(`📊 Total bills generated: ${totalGenerated}`);
      console.log(`📍 Bills stored in localStorage (bills_2567, bills_2568, bills_2569)`);
      console.log(`📲 Tenant app will automatically display them on next load`);
      console.log(`${'='.repeat(60)}\n`);

      return totalGenerated;

    } catch (error) {
      console.error('❌ Error in auto-bill generation:', error);
      return 0;
    }
  }

  /**
   * Watch for new meter data in real-time
   */
  static watchForNewMeterData(building) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      console.warn('⚠️ Firestore not available for real-time watching');
      return;
    }
    // Skip if not authenticated — Firestore rules require auth
    if (!window.firebaseAuth?.currentUser) return;

    const { collection, query, where, onSnapshot } = window.firebase.firestoreFunctions;
    if (!onSnapshot) {
      console.warn('⚠️ onSnapshot not available — skipping meter watching');
      return;
    }

    try {
      const db = window.firebase.firestore();
      const q = query(collection(db, 'meter_data'), where('building', '==', building));

      console.log(`👁️ Watching meter_data collection for ${building}...`);

      const unsubscribe = onSnapshot(q, async (snapshot) => {
        const changes = snapshot.docChanges();
        const hasChanges = changes.some(change => change.type === 'added' || change.type === 'modified');
        if (hasChanges) {
          console.log(`📡 New meter data detected! Re-generating bills...`);
          await BillingSystem.autogenerateBillsForAllYears(building);
          console.log(`✅ Bills auto-updated from new meter data`);
        }
      });

      return unsubscribe;
    } catch (error) {
      console.warn('⚠️ Could not set up real-time meter watching:', error.message);
    }
  }

  /**
   * ===== LOCALSTORAGE MANAGEMENT =====
   */

  /**
   * Save generated bills to localStorage
   * @param {Array} bills - Array of bill objects
   * @returns {number} - Number of bills saved
   */
  /**
   * Push generated bills to RTDB so tenant_app (any device) can read them.
   * Path: bills/{building}/{room}/{billId} — matches what tenant TenantFirebaseSync.loadBills reads.
   * Idempotent — overwrites existing billId (last-write-wins).
   */
  static async pushBillsToFirebase(building, bills) {
    if (!bills || bills.length === 0) return 0;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseSet) {
      console.warn('⚠️ RTDB unavailable, skipping bill Firebase push');
      return 0;
    }
    // Normalize building once (rooms|nest), use canonical id everywhere downstream
    const fbBuilding = (window.CONFIG?.getBuildingConfig?.(building)) || building;
    let pushed = 0;
    for (const bill of bills) {
      try {
        const billId = bill.billId || bill.id || `${bill.year}-${String(bill.month).padStart(2,'0')}-${bill.roomId||bill.room}`;
        const room = bill.room || bill.roomId;
        if (!room) { continue; }
        const path = `bills/${fbBuilding}/${room}/${billId}`;
        const ref = window.firebaseRef(window.firebaseDatabase, path);
        await window.firebaseSet(ref, { ...bill, billId, building: fbBuilding, room });
        pushed++;
      } catch (e) {
        console.warn(`⚠️ pushBillsToFirebase: failed for ${bill.billId}:`, e.message);
      }
    }
    if (pushed > 0) console.log(`📡 Pushed ${pushed}/${bills.length} bills to RTDB (${fbBuilding})`);
    return pushed;
  }

  static saveBillsToLocalStorage(bills) {
    if (!bills || bills.length === 0) return 0;

    console.log(`\n💾 Saving ${bills.length} bills to localStorage...`);

    // Group bills by year
    const billsByYear = {};
    bills.forEach(bill => {
      if (!billsByYear[bill.year]) {
        billsByYear[bill.year] = [];
      }
      billsByYear[bill.year].push(bill);
    });

    // Save each year's bills
    let savedCount = 0;
    for (const [year, yearBills] of Object.entries(billsByYear)) {
      try {
        const key = `bills_${year}`;

        // Get existing bills and merge
        let existingBills = [];
        const existing = localStorage.getItem(key);
        if (existing) {
          existingBills = JSON.parse(existing);
        }

        // Merge: remove duplicates by billId, then add new bills
        const billIds = new Set(existingBills.map(b => b.billId));
        const newBills = yearBills.filter(b => !billIds.has(b.billId));

        const merged = [...existingBills, ...newBills];
        localStorage.setItem(key, JSON.stringify(merged));

        console.log(`  ✅ Saved ${newBills.length} bills to ${key} (total: ${merged.length})`);
        savedCount += newBills.length;
      } catch (e) {
        console.error(`  ❌ Failed to save bills for year ${year}:`, e.message);
      }
    }

    return savedCount;
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
    const key = `bills_${year}`;
    const yearBills = JSON.parse(localStorage.getItem(key) || '[]');

    return yearBills.find((bill) => bill.month === month && bill.roomId === roomId) || null;
  }

  /**
   * Update bill status
   * @param {string} billId - Bill identifier
   * @param {string} status - New status (paid, pending, overdue)
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

// Auto-run guarded: only fire on the admin dashboard, not on tenant_app.html
// (tenant pages should not regenerate bills for ALL years on every load —
// that runs N rooms × N months × N years of work and leaks an onSnapshot listener)
function _isAdminDashboard() {
  const path = (window.location.pathname || '').toLowerCase();
  return path.includes('dashboard') || path === '/' || path.endsWith('/index.html');
}

let _billingMeterUnsubscribe = null;

async function _bootstrapAutoBilling() {
  if (!_isAdminDashboard()) {
    console.log('ℹ️ BillingSystem: skipping auto-regen (not admin dashboard)');
    return;
  }
  let waitCount = 0;
  while (!window.firebase?.firestore && waitCount < 20) {
    await new Promise(r => setTimeout(r, 500));
    waitCount++;
  }
  if (!window.firebase?.firestore) return;

  const params = new URLSearchParams(window.location.search);
  const building = params.get('building') || localStorage.getItem('currentBuilding') || 'rooms';

  console.log('🔔 Billing system activated (admin dashboard)');
  await BillingSystem.autogenerateBillsForAllYears(building);

  if (typeof window.initHistoricalDataDisplay === 'function') {
    window.initHistoricalDataDisplay();
  }

  // Track unsubscribe so we can clean up on page unload / SPA navigation
  _billingMeterUnsubscribe = BillingSystem.watchForNewMeterData(building);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootstrapAutoBilling);
} else {
  _bootstrapAutoBilling();
}

window.addEventListener('beforeunload', () => {
  if (typeof _billingMeterUnsubscribe === 'function') {
    _billingMeterUnsubscribe();
    _billingMeterUnsubscribe = null;
  }
});

// Expose globally (backward compatibility)
if (typeof window !== 'undefined') {
  window.BillingSystem = BillingSystem;
  window.AutoBillCalculator = BillingSystem; // Alias for backward compatibility
  window.BillingCalculator = BillingSystem; // Alias for backward compatibility
}

console.log('✅ BillingSystem (consolidated) loaded');
