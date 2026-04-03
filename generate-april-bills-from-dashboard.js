#!/usr/bin/env node
/**
 * Generate April 2569 Bills Directly from Dashboard Data
 * This script:
 * 1. Extracts March 2569 data from the dashboard's MONTHS/ROOMS data
 * 2. Uses March ending readings as April starting readings
 * 3. Generates April bills with estimated usage
 * 4. Can be pasted into browser console to run
 */

// This function should be run in the browser console where MONTHS data is available
function generateAprilBillsFromDashboard() {
  console.log('🚀 ===== APRIL BILL GENERATION FROM DASHBOARD =====\n');

  const building = 'rooms';
  const march_month = 3;
  const april_month = 4;
  const year = 69; // 2569

  // Get room configurations from the system (assume ROOMS data available)
  if (typeof ROOMS === 'undefined') {
    console.error('❌ ROOMS data not loaded. Make sure you are on the admin dashboard.');
    return { success: false, error: 'ROOMS data not available' };
  }

  if (!MONTHS || !MONTHS['69'] || !MONTHS['69'].months[march_month - 1]) {
    console.error(`❌ March 2569 data not found`);
    return { success: false, error: 'March data missing' };
  }

  const marchMonthIndex = march_month - 1; // 0-based
  const generateBills = {
    success: true,
    building,
    month: april_month,
    year,
    bills: [],
    failed: 0
  };

  // Generate bill for each room
  for (const [roomId, roomConfig] of Object.entries(ROOMS)) {
    try {
      // Get rates from room config
      const rent = roomConfig.rent || 1200;
      const eRate = roomConfig.elecRate || 8;
      const wRate = 20;
      const trash = roomConfig.trashFee || 20;

      // For April: use March's ending values as starting, estimate usage
      // Since we don't have actual meter readings for April, estimate 5-10% usage increase
      const estimatedUsageIncrease = 1.06; // 6% increase

      // Get March ending data from dashboard (if available in localStorage)
      let aprMeterData = null;
      try {
        const marchKey = `2569-03`;
        const meterDataKey = `meter_data_2569`;
        const meterStorage = JSON.parse(localStorage.getItem(meterDataKey) || '{}');

        if (meterStorage[marchKey] && meterStorage[marchKey][roomId]) {
          const marchData = meterStorage[marchKey][roomId];
          const eUnits = (marchData.currentElectric - marchData.electricStart) || 0;
          const wUnits = (marchData.currentWater - marchData.waterStart) || 0;

          aprMeterData = {
            eOld: Math.round(marchData.currentElectric),
            eNew: Math.round(marchData.currentElectric + (eUnits * estimatedUsageIncrease)),
            wOld: Math.round(marchData.currentWater),
            wNew: Math.round(marchData.currentWater + (wUnits * estimatedUsageIncrease))
          };
        }
      } catch (e) {
        console.log(`⚠️ Could not load March data for ${roomId}`);
      }

      if (!aprMeterData) {
        console.log(`⏭️  Skipping ${roomId} - no March data available`);
        continue;
      }

      const eUnits = Math.max(0, aprMeterData.eNew - aprMeterData.eOld);
      const wUnits = Math.max(0, aprMeterData.wNew - aprMeterData.wOld);
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      // Create bill ID
      const now = new Date();
      const billId = `TGH-${year}${String(april_month).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

      // Build bill object
      const billObject = {
        billId,
        room: roomId,
        building: 'เดอะ กรีน เฮฟเว่น',
        month: april_month,
        year,
        status: 'pending',
        billDate: new Date().toISOString().split('T')[0],
        totalCharge: total,
        charges: {
          rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: aprMeterData.eOld || 0,
            new: aprMeterData.eNew || 0,
            units: eUnits || 0,
            rate: eRate || 8
          },
          water: {
            cost: wCost || 0,
            old: aprMeterData.wOld || 0,
            new: aprMeterData.wNew || 0,
            units: wUnits || 0,
            rate: wRate || 20
          },
          trash: trash || 0,
          common: 0
        },
        meterReadings: {
          electric: { old: aprMeterData.eOld || 0, new: aprMeterData.eNew || 0, units: eUnits || 0 },
          water: { old: aprMeterData.wOld || 0, new: aprMeterData.wNew || 0, units: wUnits || 0 }
        },
        note: 'เดือนเมษายน (April)',
        createdAt: now.toISOString(),
        sourceData: 'estimated_from_march'
      };

      // Save to localStorage (admin side)
      const billsKey = `bills_${building}_${april_month}_${year}`;
      let bills = JSON.parse(localStorage.getItem(billsKey) || '{}');
      bills[roomId] = billObject;
      localStorage.setItem(billsKey, JSON.stringify(bills));

      generateBills.bills.push({ roomId, billId, total });
      console.log(`✅ ${roomId.padEnd(8)} | ฿${total.toString().padStart(8)}`);

    } catch (error) {
      generateBills.failed++;
      console.error(`❌ ${roomId}: ${error.message}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ APRIL BILLS GENERATED`);
  console.log(`📊 Generated: ${generateBills.bills.length} bills`);
  console.log(`❌ Failed: ${generateBills.failed} rooms`);
  console.log(`📍 Saved to: localStorage (bills_rooms_4_69)`);
  console.log(`${'='.repeat(60)}\n`);

  return generateBills;
}

// Auto-run if in Node environment
if (typeof ROOMS !== 'undefined') {
  generateAprilBillsFromDashboard();
}
