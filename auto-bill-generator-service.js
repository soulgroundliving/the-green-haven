/**
 * Auto Bill Generator Service
 * ดึงข้อมูลมิเตอร์จาก Firebase และสร้างบิลอัตโนมัติ
 *
 * Usage:
 * - ทำงานอัตโนมัติเมื่อมีข้อมูลมิเตอร์ใหม่
 * - เรียกผ่าน Cloud Function trigger หรือ Scheduled job
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./service-account-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();
const firestore = admin.firestore();

/**
 * Main function: Fetch meter data and auto-generate bills
 * @param {string} building - 'rooms' or 'nest'
 * @param {number} month - Month (1-12)
 * @param {number} year - Year (Buddhist year, e.g., 2569)
 * @returns {Promise<object>} - Result with generated bill count
 */
async function autoBillGenerator(building = 'rooms', month, year) {
  console.log(`\n🚀 ===== AUTO BILL GENERATOR =====`);
  console.log(`📊 Building: ${building}`);
  console.log(`📅 Month: ${month}, Year: ${year}\n`);

  try {
    // 1. Fetch meter data from Firestore
    console.log('📥 Step 1: Fetching meter data from Firestore...');
    const meterQuery = await firestore.collection('meter_data')
      .where('building', '==', building)
      .where('year', '==', year % 100) // Use short year
      .where('month', '==', month)
      .get();

    if (meterQuery.empty) {
      console.log(`❌ No meter data found for ${building}/${month}/${year}`);
      return { success: false, message: 'No meter data found', count: 0 };
    }

    const meterDataMap = {};
    meterQuery.forEach(doc => {
      const data = doc.data();
      meterDataMap[data.roomId] = data;
    });

    console.log(`✅ Found meter data for ${Object.keys(meterDataMap).length} rooms`);

    // 2. Get room configurations
    console.log('\n🏢 Step 2: Fetching room configurations...');
    const roomsQuery = await firestore.collection('rooms_config')
      .where('building', '==', building)
      .get();

    const roomConfigs = {};
    roomsQuery.forEach(doc => {
      roomConfigs[doc.id] = doc.data();
    });

    console.log(`✅ Found configurations for ${Object.keys(roomConfigs).length} rooms`);

    // 3. Generate bills
    console.log('\n🧮 Step 3: Generating bills...');
    let generatedCount = 0;
    const generatedBills = [];
    const failedRooms = [];

    for (const [roomId, meterData] of Object.entries(meterDataMap)) {
      try {
        const roomConfig = roomConfigs[roomId] || {};

        // Get rates
        const rent = roomConfig.rent || 1200;
        const eRate = roomConfig.elecRate || 8;
        const wRate = 20;
        const trash = roomConfig.trashFee || 20;

        // Calculate units and costs
        const eOld = meterData.eOld || 0;
        const eNew = meterData.eNew || 0;
        const wOld = meterData.wOld || 0;
        const wNew = meterData.wNew || 0;

        const eUnits = Math.max(0, eNew - eOld);
        const wUnits = Math.max(0, wNew - wOld);
        const eCost = eUnits * eRate;
        const wCost = wUnits * wRate;
        const total = rent + eCost + wCost + trash;

        // Create bill ID
        const now = new Date();
        const billId = `TGH-${year}${String(month).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        // Build bill object
        const billObject = {
          billId,
          room: roomId,
          building: building === 'rooms' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น',
          month,
          year,
          status: 'pending',
          billDate: now.toISOString().split('T')[0],
          totalCharge: total,
          charges: {
            rent,
            rentLabel: 'ค่าเช่าห้อง',
            electric: { cost: eCost || 0, old: eOld, new: eNew, units: eUnits, rate: eRate },
            water: { cost: wCost || 0, old: wOld, new: wNew, units: wUnits, rate: wRate },
            trash,
            common: 0
          },
          meterReadings: {
            electric: { old: eOld, new: eNew, units: eUnits },
            water: { old: wOld, new: wNew, units: wUnits }
          },
          note: '',
          createdAt: now.toISOString(),
          sourceData: 'firestore_meter_data'
        };

        // Save to Realtime Database (bills path)
        await db.ref(`bills/${building}/${roomId}/${billId}`).set(billObject);

        // Also save to Firestore for backup
        await firestore.collection('bills').doc(billId).set(billObject);

        generatedCount++;
        generatedBills.push({ roomId, billId, total });
        console.log(`✅ ${roomId}: ฿${total.toLocaleString()}`);

      } catch (error) {
        failedRooms.push({ roomId, error: error.message });
        console.error(`❌ ${roomId}: ${error.message}`);
      }
    }

    // 4. Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ BILL GENERATION COMPLETE`);
    console.log(`📊 Generated: ${generatedCount} bills`);
    console.log(`❌ Failed: ${failedRooms.length} rooms`);
    console.log(`📍 Location: bills/${building}/{roomId}/{billId}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      success: true,
      message: `Generated ${generatedCount} bills`,
      generatedCount,
      generatedBills,
      failedRooms,
      building,
      month,
      year
    };

  } catch (error) {
    console.error('❌ Error in auto bill generator:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Scheduled job: Run monthly on the first day
 * Fetch ALL buildings and months that have meter data
 */
async function monthlyAutoGeneration() {
  console.log('\n🔄 ===== MONTHLY AUTO GENERATION =====\n');

  try {
    // Get all unique building + month combinations from meter_data
    const meterQuery = await firestore.collection('meter_data').get();

    const monthCombinations = new Set();
    meterQuery.forEach(doc => {
      const { building, month, year } = doc.data();
      monthCombinations.add(`${building}_${month}_${year}`);
    });

    console.log(`Found ${monthCombinations.size} billing periods to process\n`);

    let totalGenerated = 0;

    for (const combo of monthCombinations) {
      const [building, month, year] = combo.split('_');
      const result = await autoBillGenerator(building, parseInt(month), parseInt(year));

      if (result.success) {
        totalGenerated += result.generatedCount;
      }
    }

    console.log(`\n📊 TOTAL BILLS GENERATED: ${totalGenerated}`);
    return { success: true, totalGenerated };

  } catch (error) {
    console.error('❌ Monthly generation error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Real-time listener: Watch for new meter data and auto-generate
 */
function watchMeterDataChanges() {
  console.log('👀 Watching for meter data changes...\n');

  firestore.collection('meter_data')
    .onSnapshot(async (snapshot) => {
      console.log('📡 Meter data changed, checking for bills to generate...');

      for (const doc of snapshot.docs) {
        const { building, month, year, roomId } = doc.data();

        // Check if bill already exists
        const billSnapshot = await firestore.collection('bills')
          .where('building', '==', building)
          .where('month', '==', month)
          .where('year', '==', year)
          .where('room', '==', roomId)
          .limit(1)
          .get();

        if (billSnapshot.empty) {
          console.log(`🔄 Auto-generating bill for ${roomId}/${month}/${year}...`);
          await autoBillGenerator(building, month, year);
        }
      }
    }, error => {
      console.error('❌ Snapshot listener error:', error);
    });
}

// Export functions for Cloud Functions or external use
module.exports = {
  autoBillGenerator,
  monthlyAutoGeneration,
  watchMeterDataChanges
};

// Main execution (if run directly)
if (require.main === module) {
  // Example usage:
  // node auto-bill-generator-service.js

  autoBillGenerator('rooms', 4, 2569)
    .then(result => {
      console.log('\nResult:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
