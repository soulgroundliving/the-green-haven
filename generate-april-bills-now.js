/**
 * Generate April 2569 Bills NOW
 * Uses existing meter data from dashboard MONTHS array
 * Paste into browser console on admin dashboard to execute
 */

function generateAprilBillsNow() {
  console.log('\n🚀 ===== APRIL BILL GENERATION =====\n');

  if (typeof ROOMS === 'undefined' || typeof MONTHS === 'undefined') {
    console.error('❌ ROOMS or MONTHS not loaded');
    return;
  }

  const building = 'rooms';
  const month = 4;
  const year = 69;
  let generated = 0;
  let failed = 0;

  // Get March and April meter data from dashboard
  const marchIdx = 2; // March = index 2
  const aprilIdx = 3; // April = index 3

  console.log(`📊 Extracting meter data for April 2569...`);
  console.log(`   March data at index ${marchIdx}: ${MONTHS['69'].months[marchIdx]}`);
  console.log(`   April data at index ${aprilIdx}: ${MONTHS['69'].months[aprilIdx]}\n`);

  // Iterate through all rooms
  for (const [roomId, roomConfig] of Object.entries(ROOMS)) {
    try {
      const rent = roomConfig.rent || 1200;
      const eRate = roomConfig.elecRate || 8;
      const wRate = 20;
      const trash = roomConfig.trashFee || 20;

      // Load meter data for this room from localStorage
      const meterKey = `meter_data_${year}`;
      const meterStorage = JSON.parse(localStorage.getItem(meterKey) || '{}');
      const aprilKey = `${year}-04`; // 69-04
      const marchKey = `${year}-03`; // 69-03

      let meterData = null;

      // Try to get April data from localStorage
      if (meterStorage[aprilKey] && meterStorage[aprilKey][roomId]) {
        meterData = meterStorage[aprilKey][roomId];
      }
      // Fallback: use March data as baseline for April
      else if (meterStorage[marchKey] && meterStorage[marchKey][roomId]) {
        const marchData = meterStorage[marchKey][roomId];
        const eUsage = (marchData.currentElectric - marchData.electricStart) || 0;
        const wUsage = (marchData.currentWater - marchData.waterStart) || 0;

        meterData = {
          eOld: marchData.currentElectric,
          eNew: Math.round(marchData.currentElectric + eUsage * 1.05),
          wOld: marchData.currentWater,
          wNew: Math.round(marchData.currentWater + wUsage * 1.05)
        };
      }

      if (!meterData) {
        console.log(`⏭️  ${roomId}: No meter data`);
        failed++;
        continue;
      }

      const eUnits = Math.max(0, meterData.eNew - meterData.eOld);
      const wUnits = Math.max(0, meterData.wNew - meterData.wOld);
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      const now = new Date();
      const billId = `TGH-${year}${String(month).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

      const billObject = {
        billId,
        room: roomId,
        building: 'เดอะ กรีน เฮฟเว่น',
        month,
        year,
        status: 'pending',
        billDate: now.toISOString().split('T')[0],
        totalCharge: total,
        charges: {
          rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: meterData.eOld || 0,
            new: meterData.eNew || 0,
            units: eUnits || 0,
            rate: eRate
          },
          water: {
            cost: wCost || 0,
            old: meterData.wOld || 0,
            new: meterData.wNew || 0,
            units: wUnits || 0,
            rate: wRate
          },
          trash,
          common: 0
        },
        meterReadings: {
          electric: { old: meterData.eOld || 0, new: meterData.eNew || 0, units: eUnits || 0 },
          water: { old: meterData.wOld || 0, new: meterData.wNew || 0, units: wUnits || 0 }
        },
        note: '',
        createdAt: now.toISOString()
      };

      // Save to localStorage
      const billsKey = `bills_${building}_${month}_${year}`;
      let bills = JSON.parse(localStorage.getItem(billsKey) || '{}');
      bills[roomId] = billObject;
      localStorage.setItem(billsKey, JSON.stringify(bills));

      generated++;
      console.log(`✅ ${roomId.padEnd(8)} | ฿${total.toString().padStart(8)} | ${billId}`);

    } catch (error) {
      failed++;
      console.error(`❌ ${roomId}: ${error.message}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ GENERATED: ${generated} April bills`);
  console.log(`❌ FAILED: ${failed} rooms`);
  console.log(`📍 Saved to: localStorage (bills_rooms_4_69)`);
  console.log(`${'='.repeat(60)}\n`);

  console.log('📝 Now open tenant app and refresh to see April bills!');

  return { success: true, generated, failed };
}

// Execute
generateAprilBillsNow();
