/**
 * Firebase Cloud Function: Auto-generate bills when meter data is added/updated
 * Deploy with: firebase deploy --only functions:generateBillsOnMeterUpdate
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.database();
const firestore = admin.firestore();

/**
 * Trigger: When meter_data is written to Firebase
 * Action: Automatically generate and save bills to bills/{building}/{room}/{billId}
 */
exports.generateBillsOnMeterUpdate = functions.database
  .ref('meter_data/{building}/{yearMonth}/{roomId}')
  .onWrite(async (change, context) => {
    try {
      const { building, yearMonth, roomId } = context.params;
      const meterData = change.after.val();

      if (!meterData) {
        console.log(`⏭️ Meter data deleted for ${building}/${yearMonth}/${roomId}`);
        return null;
      }

      console.log(`🚀 Auto-generating bill for ${building}/${yearMonth}/${roomId}...`);

      // Parse year and month from yearMonth format (e.g., "69_04" = year 69, month 4)
      const [yy, month] = yearMonth.split('_').map(Number);
      const year = yy < 100 ? 2500 + yy : yy;
      const month_num = parseInt(month);

      // Get room configuration
      const roomConfigSnap = await db.ref(`rooms_config/${building}/${roomId}`).once('value');
      const roomConfig = roomConfigSnap.val() || {};

      // Calculate costs
      const rent = roomConfig.rent || 1200;
      const eRate = roomConfig.elecRate || 8;
      const wRate = 20;
      const trash = roomConfig.trashFee || 20;

      const eUnits = Math.max(0, (meterData.eNew || 0) - (meterData.eOld || 0));
      const wUnits = Math.max(0, (meterData.wNew || 0) - (meterData.wOld || 0));
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      // Create bill ID
      const now = new Date();
      const billId = `TGH-${year}${String(month_num).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

      // Build bill object
      const billObject = {
        billId,
        room: roomId,
        building: building === 'rooms' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น',
        month: month_num,
        year,
        status: 'pending',
        billDate: new Date().toISOString().split('T')[0],
        totalCharge: total,
        charges: {
          rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: meterData.eOld || 0,
            new: meterData.eNew || 0,
            units: eUnits || 0,
            rate: eRate || 8
          },
          water: {
            cost: wCost || 0,
            old: meterData.wOld || 0,
            new: meterData.wNew || 0,
            units: wUnits || 0,
            rate: wRate || 20
          },
          trash: trash || 0,
          common: 0
        },
        meterReadings: {
          electric: { old: meterData.eOld || 0, new: meterData.eNew || 0, units: eUnits || 0 },
          water: { old: meterData.wOld || 0, new: meterData.wNew || 0, units: wUnits || 0 }
        },
        note: '',
        createdAt: now.toISOString()
      };

      // Save bill to Firebase
      await db.ref(`bills/${building}/${roomId}/${billId}`).set(billObject);

      console.log(`✅ Bill auto-generated: bills/${building}/${roomId}/${billId}`);
      console.log(`   Amount: ฿${total.toLocaleString()}`);

      return { success: true, billId, total };
    } catch (error) {
      console.error('❌ Error auto-generating bill:', error);
      throw error;
    }
  });

/**
 * Manual trigger: Generate bills for all rooms in a month
 * Call with: curl -X POST https://us-central1-{project}.cloudfunctions.net/generateAllBillsForMonth -d '{"building":"rooms","year":2569,"month":4}'
 */
exports.generateAllBillsForMonth = functions.https.onRequest(async (req, res) => {
  try {
    const { building = 'rooms', year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: 'year and month required' });
    }

    const yy = year % 100;
    const yearMonth = `${yy}_${String(month).padStart(2, '0')}`;

    console.log(`🚀 Generating all bills for ${building}/${yearMonth}...`);

    // Get all meter data for this month
    const meterSnap = await db.ref(`meter_data/${building}/${yearMonth}`).once('value');
    const meterDataMap = meterSnap.val() || {};

    let generatedCount = 0;
    const promises = [];

    for (const [roomId, meterData] of Object.entries(meterDataMap)) {
      const promise = (async () => {
        try {
          // Get room config
          const roomConfigSnap = await db.ref(`rooms_config/${building}/${roomId}`).once('value');
          const roomConfig = roomConfigSnap.val() || {};

          const rent = roomConfig.rent || 1200;
          const eRate = roomConfig.elecRate || 8;
          const wRate = 20;
          const trash = roomConfig.trashFee || 20;

          const eUnits = Math.max(0, (meterData.eNew || 0) - (meterData.eOld || 0));
          const wUnits = Math.max(0, (meterData.wNew || 0) - (meterData.wOld || 0));
          const eCost = eUnits * eRate;
          const wCost = wUnits * wRate;
          const total = rent + eCost + wCost + trash;

          const now = new Date();
          const billId = `TGH-${year}${String(month).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

          const billObject = {
            billId, room: roomId,
            building: building === 'rooms' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น',
            month, year, status: 'pending',
            billDate: new Date().toISOString().split('T')[0],
            totalCharge: total,
            charges: {
              rent, rentLabel: 'ค่าเช่าห้อง',
              electric: { cost: eCost || 0, old: meterData.eOld || 0, new: meterData.eNew || 0, units: eUnits || 0, rate: eRate || 8 },
              water: { cost: wCost || 0, old: meterData.wOld || 0, new: meterData.wNew || 0, units: wUnits || 0, rate: wRate || 20 },
              trash: trash || 0, common: 0
            },
            meterReadings: {
              electric: { old: meterData.eOld || 0, new: meterData.eNew || 0, units: eUnits || 0 },
              water: { old: meterData.wOld || 0, new: meterData.wNew || 0, units: wUnits || 0 }
            },
            note: '', createdAt: now.toISOString()
          };

          await db.ref(`bills/${building}/${roomId}/${billId}`).set(billObject);
          generatedCount++;
          console.log(`✅ ${roomId}: ฿${total}`);
        } catch (e) {
          console.error(`❌ Error for ${roomId}:`, e.message);
        }
      })();

      promises.push(promise);
    }

    await Promise.all(promises);

    return res.json({
      success: true,
      message: `✅ Generated ${generatedCount} bills for ${building}/${yearMonth}`,
      generatedCount,
      building,
      yearMonth
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});
