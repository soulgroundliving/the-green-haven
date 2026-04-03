/**
 * Auto Bill Calculator
 * Automatically generates bills from existing meter data
 * No manual intervention needed - works for any month that has meter data
 *
 * How it works:
 * 1. Loads meter data from Firebase Firestore (meter_data collection)
 * 2. For each month with meter data, calculates the bill
 * 3. Stores bills in localStorage in format: bills_{year}
 * 4. Tenant app automatically loads and displays them
 */

class AutoBillCalculator {
  /**
   * Generate bills from meter data
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

      const eRate = room?.elecRate || room?.electricRate || 8;
      const wRate = room?.waterRate || 20;
      const rent = room?.rent || 1200;
      const trash = room?.trashFee || 40;

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
   * Save generated bills to localStorage
   * Matches format expected by tenant app: bills_{year}
   * @param {Array} bills - Array of bill objects
   * @returns {number} - Number of bills saved
   */
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

        // Get existing bills and merge (don't overwrite)
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
   * Auto-generate bills for current and previous years
   * Call this when tenant app loads
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
}

// Auto-run when tenant app loads (if Firebase is ready)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    // Wait for Firebase to initialize
    let waitCount = 0;
    while (!window.firebase?.firestore && waitCount < 20) {
      await new Promise(r => setTimeout(r, 500));
      waitCount++;
    }

    if (window.firebase?.firestore) {
      // Extract building from URL or use default
      const params = new URLSearchParams(window.location.search);
      const building = params.get('building') || localStorage.getItem('currentBuilding') || 'rooms';

      console.log('🔔 Auto-bill generator activated');
      await AutoBillCalculator.autogenerateBillsForAllYears(building);
    }
  });
} else {
  // Page already loaded, run immediately
  if (window.firebase?.firestore) {
    const params = new URLSearchParams(window.location.search);
    const building = params.get('building') || localStorage.getItem('currentBuilding') || 'rooms';
    AutoBillCalculator.autogenerateBillsForAllYears(building);
  }
}

// Export for manual use
if (typeof window !== 'undefined') {
  window.AutoBillCalculator = AutoBillCalculator;
}
