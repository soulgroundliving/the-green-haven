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
    // Phase 2a: delegate to BillStore (RTDB primary + localStorage fallback)
    if (typeof BillStore !== 'undefined') {
      // Try both buildings; BillStore will dedupe via cache
      const r = BillStore.getByRoom('rooms', roomId, year);
      const n = BillStore.getByRoom('nest', roomId, year);
      const merged = [...r, ...n];
      if (merged.length > 0) return merged;
    }
    // Final fallback: raw localStorage scan (legacy)
    const bills = [];
    if (year) {
      const key = `bills_${year}`;
      const yearBills = JSON.parse(localStorage.getItem(key) || '[]');
      return yearBills.filter((bill) => bill.roomId === roomId);
    }
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
    // Phase 2a: delegate to BillStore
    if (typeof BillStore !== 'undefined') {
      const r = BillStore.getByMonth('rooms', roomId, year, month);
      if (r) return r;
      const n = BillStore.getByMonth('nest', roomId, year, month);
      if (n) return n;
    }
    // Fallback: localStorage
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
    // Phase 2a: pull from BillStore (RTDB) — fall back to localStorage
    let yearBills = [];
    if (typeof BillStore !== 'undefined') {
      yearBills = BillStore.listAllForYear(year);
    }
    if (yearBills.length === 0) {
      const key = `bills_${year}`;
      yearBills = JSON.parse(localStorage.getItem(key) || '[]');
    }
    const monthBills = yearBills.filter((bill) => Number(bill.month) === Number(month));

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

// ===== BillStore — single facade for all bill reads (Phase 2a 2026-04-19) =====
// Single Source of Truth: RTDB bills/{building}/{roomId}/{billId}
//   Read order: in-memory cache (populated by RTDB onValue) → direct RTDB read
//                → localStorage bills_{year} (legacy fallback) → []
//   Subscribe once; receives live updates when CF auto-creates bills or
//   verifySlip flips status='paid'. All call sites should prefer this over
//   raw localStorage.bills_YYYY reads.
class BillStore {
  static _cache = { rooms: {}, nest: {} };  // [building][room][billId] = bill
  static _subscribed = false;
  static _listeners = new Set();
  static _ready = false;

  /** Coerce building → 'rooms' | 'nest' canonical */
  static _bld(b) {
    if (b === 'old' || b === 'rooms' || b === 'RentRoom') return 'rooms';
    if (b === 'new' || b === 'nest') return 'nest';
    return b;
  }
  /** Normalize year to BE 4-digit (2569). Delegates to YearUtils when loaded. */
  static _be(year) {
    if (typeof window !== 'undefined' && window.YearUtils) {
      const v = window.YearUtils.toBE(year);
      if (v != null) return v;
    }
    // Fallback (YearUtils not loaded — shouldn't happen in normal page context):
    // Bug fix: previous `n < 2400 → 2500 + (n%100)` gave wrong result for 4-digit CE
    // (e.g. 2026 → 2526 instead of 2569). Correct: 4-digit CE + 543.
    const n = Number(year);
    if (!Number.isFinite(n) || n <= 0) return n;
    if (n < 100)  return 2500 + n;        // 2-digit BE
    if (n < 2400) return n + 543;          // 4-digit CE
    return n;                              // 4-digit BE
  }

  /** Subscribe to RTDB bills (idempotent). Auto-fires on first BillStore use.
   *
   * Phase 4C scoping: RTDB rules deny reads of `bills/{building}` to everyone
   * except admins — tenants can only read their own `bills/{building}/{room}`.
   * Skip the building-level subscribe outside the admin dashboard; tenants
   * read their room through tenant-system.js narrow subscribe, which is
   * already scoped correctly. This also keeps the console free of the
   * permission_denied log spam that shows up on every tenant page load. */
  static subscribe() {
    if (this._subscribed) return;
    try {
      const path = (typeof location !== 'undefined' ? location.pathname : '') || '';
      if (!/^\/dashboard(\.html)?$/.test(path)) {
        this._subscribed = true;
        return;
      }
    } catch (_) {}
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) {
      // Firebase not ready yet — retry shortly
      setTimeout(() => this.subscribe(), 1500);
      return;
    }
    this._subscribed = true;
    ['rooms', 'nest'].forEach(building => {
      try {
        const ref = window.firebaseRef(window.firebaseDatabase, `bills/${building}`);
        window.firebaseOnValue(ref, snap => {
          this._cache[building] = snap.val() || {};
          this._ready = true;
          this._listeners.forEach(fn => { try { fn(building, this._cache[building]); } catch(e) {} });
        }, err => console.warn(`BillStore subscribe bills/${building}:`, err?.message));
      } catch(e) { console.warn('BillStore subscribe error:', e); }
    });
  }

  /** Add a listener that fires whenever bills change for a building. */
  static onChange(fn) {
    this._listeners.add(fn);
    this.subscribe();
    return () => this._listeners.delete(fn);
  }

  /** Get all bills for a room (optionally a single year). */
  static getByRoom(building, roomId, year = null) {
    this.subscribe();
    const bld = this._bld(building);
    const room = String(roomId);
    const all = this._cache[bld]?.[room] || {};
    let bills = Object.values(all);
    if (year != null) {
      const beYear = this._be(year);
      bills = bills.filter(b => this._be(b.year) === beYear);
    }
    // Fallback to localStorage if cache empty (e.g., before subscribe completes)
    if (bills.length === 0 && year != null) {
      try {
        const ls = JSON.parse(localStorage.getItem(`bills_${this._be(year)}`) || '[]');
        bills = ls.filter(b => String(b.roomId || b.room) === room &&
                              (this._bld(b.building) === bld || !b.building));
      } catch(e) {}
    }
    return bills;
  }

  /** Get a single bill by month/year for a room. */
  static getByMonth(building, roomId, year, month) {
    return this.getByRoom(building, roomId, year)
              .find(b => Number(b.month) === Number(month)) || null;
  }

  /** Get all bills across all rooms for a building+year. */
  static listForYear(building, year) {
    this.subscribe();
    const bld = this._bld(building);
    const beYear = this._be(year);
    const out = [];
    const rooms = this._cache[bld] || {};
    Object.keys(rooms).forEach(room => {
      Object.values(rooms[room] || {}).forEach(b => {
        if (this._be(b.year) === beYear) out.push(b);
      });
    });
    if (out.length === 0) {
      try {
        const ls = JSON.parse(localStorage.getItem(`bills_${beYear}`) || '[]');
        ls.forEach(b => {
          if (!b.building || this._bld(b.building) === bld) out.push(b);
        });
      } catch(e) {}
    }
    return out;
  }

  /** Get all bills across all buildings for a year. */
  static listAllForYear(year) {
    return [...this.listForYear('rooms', year), ...this.listForYear('nest', year)];
  }

  static get isReady() { return this._ready; }

  // ===== SYNTHETIC BILLS — SSoT for tenant-side gap-filling =====
  // When admin hasn't pushed a real bill to RTDB yet for a given month, the
  // tenant-side bill list synthesizes a "what your bill would look like"
  // row from meter readings. Past months default to "paid (cash legacy)";
  // current month defaults to "pending". Once admin actually issues a real
  // bill for that month, dedupSynthetic() drops the synth twin.

  /** Prefix used in billId of synthetic bills. Don't write bills with this
   *  prefix to RTDB — synth lives only in tenant-side _taBills until real
   *  bill arrives via subscribe.
   */
  static SYNTH_PREFIX = 'SYNTH-';

  /** Is this bill considered paid?
   *  Primary signal: status field equals 'paid' (case-insensitive).
   *  Secondary signal: paidAt is set (admin marked but status field missing).
   *  Either is enough — guards against bills that admin/CF wrote without a
   *  status field but did set paidAt.
   */
  static isPaid(bill) {
    if (!bill) return false;
    const s = String(bill.status || '').toLowerCase();
    if (s === 'paid') return true;
    if (bill.paidAt) return true;
    return false;
  }

  static isSynthetic(bill) {
    if (!bill) return false;
    if (bill.synthetic === true) return true;
    const id = String(bill.billId || bill.id || '');
    return id.indexOf(BillStore.SYNTH_PREFIX) === 0;
  }

  /** Drop synthetic bills when a real (non-synthetic) bill exists for the
   *  same (CE-normalized year, month). Without this, a tenant briefly sees
   *  two cards for the same month — one "จ่ายแล้ว" (real) and one
   *  "รอออกบิล" (synth) — when synth was pushed before subscribe answered.
   *  Returns a NEW array (no in-place mutation).
   */
  static dedupSynthetic(bills) {
    if (!Array.isArray(bills) || !bills.length) return bills || [];
    const realByYM = new Set();
    const ce = (y) => (window.YearUtils?.toCE?.(y)) || Number(y) || 0;
    bills.forEach(b => {
      if (BillStore.isSynthetic(b)) return;
      realByYM.add(`${ce(b.year)}-${Number(b.month)}`);
    });
    return bills.filter(b => {
      if (!BillStore.isSynthetic(b)) return true;
      return !realByYM.has(`${ce(b.year)}-${Number(b.month)}`);
    });
  }

  /** Build synthetic bills for past 6 months of meter history that don't
   *  have a real bill yet. Pure — no side effects, returns array of new bills.
   *  Caller is responsible for merging into their bill list and re-rendering.
   *
   *  @param {Object} args
   *  @param {Array}  args.meterHistory — sorted desc; entries: {year, month, eOld, eNew, wOld, wNew, createdAt}
   *  @param {Array}  args.existingBills — current _taBills (real + already-synth)
   *  @param {Object} args.rates — {rent, eRate, wRate, trash}; missing fields fall back to defaults
   *  @param {string|number} [args.moveInDate] — ISO/Date; entries before move-in skipped
   *  @param {string} args.building
   *  @param {string} args.room
   *  @param {boolean} [args.pastOnly=false] — when true, skip current+future months
   *      (tenant-side: only "ชำระด้วยเงินสดก่อน SlipOK" rows; admin's forecast-revenue
   *      tool owns the current-month projection use case).
   *  @returns {Array} new synthetic bills (NOT yet merged into existingBills)
   */
  static synthesizeFromMeter({ meterHistory, existingBills, rates, moveInDate, building, room, pastOnly = false }) {
    if (!Array.isArray(meterHistory) || !meterHistory.length) return [];
    const rent  = Number(rates?.rent)  || 0;
    const eRate = Number(rates?.eRate) || 8;
    const wRate = Number(rates?.wRate) || 20;
    const trash = Number(rates?.trash) || 40;

    const now = new Date();
    const currentYM = now.getFullYear() * 100 + (now.getMonth() + 1);
    let moveInYM = 0;
    try {
      if (moveInDate) {
        const mi = new Date(moveInDate);
        if (!isNaN(mi)) moveInYM = mi.getFullYear() * 100 + (mi.getMonth() + 1);
      }
    } catch (_) {}

    const ce = (y) => (window.YearUtils?.toCE?.(y)) || Number(y) || 0;
    const existingByYM = new Set();
    (existingBills || []).forEach(b => existingByYM.add(`${ce(b.year)}-${Number(b.month)}`));

    const out = [];
    meterHistory.slice(0, 6).forEach(m => {
      const billYM = m.year * 100 + m.month;
      if (moveInYM && billYM < moveInYM) return;
      if (existingByYM.has(`${m.year}-${m.month}`)) return;
      const isPastMonth = billYM < currentYM;
      // Tenant view skips current+future months (admin's forecast tool owns those)
      if (pastOnly && !isPastMonth) return;

      const eUnits = Math.max(0, (m.eNew || 0) - (m.eOld || 0));
      const wUnits = Math.max(0, (m.wNew || 0) - (m.wOld || 0));
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      out.push({
        billId: `${BillStore.SYNTH_PREFIX}${building}-${room}-${m.year}${String(m.month).padStart(2,'0')}`,
        synthetic: true,
        building, room: String(room),
        month: m.month, year: m.year,
        status: isPastMonth ? 'paid' : 'pending',
        method: isPastMonth ? 'cash_legacy' : null,
        paidAt: isPastMonth ? new Date(m.year, m.month - 1, 5).toISOString() : null,
        totalCharge: total, totalAmount: total,
        meterReadings: {
          electric: { old: m.eOld, new: m.eNew, units: eUnits },
          water:    { old: m.wOld, new: m.wNew, units: wUnits }
        },
        charges: {
          rent, rentLabel: 'ค่าเช่าห้อง',
          electric: { cost: eCost, old: m.eOld, new: m.eNew, units: eUnits, rate: eRate },
          water:    { cost: wCost, old: m.wOld, new: m.wNew, units: wUnits, rate: wRate },
          trash, common: 0
        },
        createdAt: m.createdAt || new Date(m.year, m.month - 1, 5).toISOString(),
        note: isPastMonth
          ? 'บันทึกย้อนหลัง — ชำระด้วยเงินสดก่อนเริ่มระบบ SlipOK'
          : '(คำนวณอัตโนมัติจากมิเตอร์ — แอดมินยังไม่ได้ออกบิลอย่างเป็นทางการ)'
      });
    });
    return out;
  }
}

// Auto-subscribe once globals are wired
if (typeof window !== 'undefined') {
  setTimeout(() => BillStore.subscribe(), 600);
}

// Expose globally (backward compatibility)
if (typeof window !== 'undefined') {
  window.BillingSystem = BillingSystem;
  window.BillStore = BillStore;
  window.AutoBillCalculator = BillingSystem; // Alias for backward compatibility
  window.BillingCalculator = BillingSystem; // Alias for backward compatibility
}

console.log('✅ BillingSystem (consolidated) loaded');
