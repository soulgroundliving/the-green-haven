/**
 * Billing Test Data & Example Usage
 * Demonstrates how to use BillingCalculator and MeterDataManager
 * ตัวอย่างการใช้ระบบคำนวนบิลจากข้อมูลมิเตอร์
 */

// Sample meter data from year 2567-2569
const SAMPLE_METER_DATA = {
  '2569': {
    // Year 2569 (2026) - Current year
    '2569-01': {
      // January 2569
      '13': {
        currentWater: 125,
        waterStart: 105,
        currentElectric: 340,
        electricStart: 300,
        notes: 'January reading'
      },
      '14': {
        currentWater: 234,
        waterStart: 215,
        currentElectric: 520,
        electricStart: 480,
        notes: ''
      },
      '15': {
        currentWater: 456,
        waterStart: 432,
        currentElectric: 890,
        electricStart: 850,
        notes: ''
      },
      'amazon': {
        currentWater: 2345,
        waterStart: 2100,
        currentElectric: 5600,
        electricStart: 5200,
        notes: 'Large store'
      }
    },
    '2569-02': {
      // February 2569
      '13': {
        currentWater: 145,
        waterStart: 125,
        currentElectric: 385,
        electricStart: 340,
        notes: ''
      },
      '14': {
        currentWater: 258,
        waterStart: 234,
        currentElectric: 575,
        electricStart: 520,
        notes: ''
      },
      '15': {
        currentWater: 489,
        waterStart: 456,
        currentElectric: 950,
        electricStart: 890,
        notes: ''
      },
      'amazon': {
        currentWater: 2680,
        waterStart: 2345,
        currentElectric: 6200,
        electricStart: 5600,
        notes: 'High usage month'
      }
    }
  },
  '2568': {
    // Year 2568 (2025) - Previous year
    '2568-12': {
      // December 2568 (end of year)
      '13': {
        currentWater: 105,
        waterStart: 85,
        currentElectric: 300,
        electricStart: 260,
        notes: 'December 2568'
      },
      '14': {
        currentWater: 215,
        waterStart: 195,
        currentElectric: 480,
        electricStart: 440,
        notes: ''
      },
      '15': {
        currentWater: 432,
        waterStart: 402,
        currentElectric: 850,
        electricStart: 800,
        notes: ''
      },
      'amazon': {
        currentWater: 2100,
        waterStart: 1850,
        currentElectric: 5200,
        electricStart: 4600,
        notes: ''
      }
    }
  }
};

// Room configuration with rates
const ROOM_RATES = {
  '13': {
    rentPrice: 1500,
    waterRate: 20,
    electricRate: 8,
    commonCharge: 0,
    trashCharge: 40
  },
  '14': {
    rentPrice: 1200,
    waterRate: 20,
    electricRate: 8,
    commonCharge: 0,
    trashCharge: 40
  },
  '15': {
    rentPrice: 1200,
    waterRate: 20,
    electricRate: 8,
    commonCharge: 0,
    trashCharge: 40
  },
  'amazon': {
    rentPrice: 15000,
    waterRate: 20,
    electricRate: 6,
    commonCharge: 0,
    trashCharge: 0
  }
};

/**
 * Load and store sample meter data
 */
function initializeSampleMeterData() {
  console.log('📥 Loading sample meter data...');

  Object.keys(SAMPLE_METER_DATA).forEach((year) => {
    const yearNum = parseInt(year);
    const yearData = SAMPLE_METER_DATA[year];

    // Store in localStorage
    localStorage.setItem(`meter_data_${yearNum}`, JSON.stringify(yearData));
    console.log(`  ✅ Loaded data for year ${yearNum}`);
  });

  console.log('✅ Sample meter data initialized');
}

/**
 * Generate sample bills from meter data
 */
function generateSampleBills() {
  console.log('\n📊 Generating sample bills...');

  const meterData = {};

  // Organize meter data by year/month
  Object.keys(SAMPLE_METER_DATA).forEach((year) => {
    const yearNum = parseInt(year);
    const yearData = SAMPLE_METER_DATA[year];

    Object.keys(yearData).forEach((monthKey) => {
      const [y, m] = monthKey.split('-');
      meterData[monthKey] = yearData[monthKey];
    });
  });

  // Generate bills
  const bills = BillingCalculator.generateHistoricalBills(meterData, ROOM_RATES);

  console.log(`✅ Generated ${bills.length} bills`);
  return bills;
}

/**
 * Store and display generated bills
 */
function storeSampleBills() {
  console.log('\n💾 Storing sample bills...');

  // Generate bills for each year
  Object.keys(SAMPLE_METER_DATA).forEach((year) => {
    const yearNum = parseInt(year);
    const yearData = SAMPLE_METER_DATA[year];

    const bills = [];

    Object.keys(yearData).forEach((monthKey) => {
      const [y, m] = monthKey.split('-');
      const month = parseInt(m);

      const monthMeterData = yearData[monthKey];

      Object.keys(monthMeterData).forEach((roomId) => {
        const room = monthMeterData[roomId];

        const billData = {
          building: BillingCalculator.detectBuilding(roomId)[0],
          roomId,
          month,
          year: yearNum,
          rentPrice: ROOM_RATES[roomId]?.rentPrice || 0,
          waterCurrentReading: room.currentWater,
          waterPreviousReading: room.waterStart,
          waterRate: ROOM_RATES[roomId]?.waterRate || 20,
          electricCurrentReading: room.currentElectric,
          electricPreviousReading: room.electricStart,
          electricRate: ROOM_RATES[roomId]?.electricRate || 8,
          commonChargePerRoom: ROOM_RATES[roomId]?.commonCharge || 0,
          trashCharge: ROOM_RATES[roomId]?.trashCharge || 40,
          notes: room.notes || ''
        };

        bills.push(BillingCalculator.generateBill(billData));
      });
    });

    BillingCalculator.saveBillsToLocalStorage(bills, yearNum);
  });

  console.log('✅ Sample bills stored to localStorage');
}

/**
 * Display bill details for verification
 */
function displayBillDetails(roomId, month, year) {
  console.log(`\n📋 Bill Details: ${roomId} (${month}/${year})`);
  console.log('─'.repeat(60));

  const bill = BillingCalculator.getBillByMonthYear(roomId, month, year);

  if (!bill) {
    console.log('❌ Bill not found');
    return null;
  }

  console.log(`Bill ID: ${bill.billId}`);
  console.log(`Status: ${bill.status}`);
  console.log('');
  console.log('Charges Breakdown:');
  console.log(`  Rent:      ${bill.charges.rent.toLocaleString('th-TH')} บาท`);
  console.log(
    `  Water:     ${bill.charges.water.usage.toFixed(1)} units × ${bill.charges.water.rate} บาท = ${bill.charges.water.cost.toLocaleString('th-TH')} บาท`
  );
  console.log(
    `  Electric:  ${bill.charges.electric.usage.toFixed(1)} units × ${bill.charges.electric.rate} บาท = ${bill.charges.electric.cost.toLocaleString('th-TH')} บาท`
  );
  console.log(`  Common:    ${bill.charges.common.toLocaleString('th-TH')} บาท`);
  console.log(`  Trash:     ${bill.charges.trash.toLocaleString('th-TH')} บาท`);
  console.log('─'.repeat(60));
  console.log(`  TOTAL:     ${bill.totalCharge.toLocaleString('th-TH')} บาท`);
  console.log('');

  if (bill.errors.length > 0) {
    console.log('⚠️  Errors:');
    bill.errors.forEach((err) => console.log(`  - ${err}`));
  }

  return bill;
}

/**
 * Display monthly summary
 */
function displayMonthlySummary(month, year) {
  console.log(`\n📊 Monthly Summary: ${month}/${year}`);
  console.log('─'.repeat(60));

  const summary = BillingCalculator.generateMonthlySummary(month, year);

  console.log(`Total Rooms:           ${summary.totalRooms}`);
  console.log(`Total Revenue:         ${summary.totalCharge.toLocaleString('th-TH')} บาท`);
  console.log(`Water Usage (Total):   ${summary.totalWaterUsage.toFixed(1)} units`);
  console.log(`Electric Usage (Total): ${summary.totalElectricUsage.toFixed(1)} units`);
  console.log(`Paid Bills:            ${summary.paidCount}`);
  console.log(`Pending Bills:         ${summary.pendingCount}`);
  console.log('─'.repeat(60));
  console.log('');

  return summary;
}

/**
 * Main demo function
 */
function runBillingDemo() {
  console.log('═════════════════════════════════════════════════════════════');
  console.log('🏢 Green Haven Billing System - Demo');
  console.log('═════════════════════════════════════════════════════════════\n');

  // Step 1: Initialize data
  initializeSampleMeterData();

  // Step 2: Generate and store bills
  storeSampleBills();

  // Step 3: Display specific bills
  displayBillDetails('13', 1, 2569);
  displayBillDetails('amazon', 2, 2569);

  // Step 4: Display monthly summary
  displayMonthlySummary(1, 2569);
  displayMonthlySummary(2, 2569);

  // Step 5: Show meter coverage
  const coverage = MeterDataManager.getDataCoverageSummary();
  console.log('📈 Data Coverage Summary:');
  console.log(JSON.stringify(coverage, null, 2));

  console.log('\n✅ Demo complete! Try these commands in console:');
  console.log('  • BillingCalculator.getBillsByRoom("13")');
  console.log('  • MeterDataManager.getMeterReadingsByRoom("13")');
  console.log('  • BillingCalculator.generateMonthlySummary(1, 2569)');
  console.log('  • BillingCalculator.exportToCSV(BillingCalculator.getBillsByRoom("13"))');
}

// Auto-run if script is loaded
if (typeof BillingCalculator !== 'undefined' && typeof MeterDataManager !== 'undefined') {
  console.log('📌 To run demo: runBillingDemo()');
} else {
  console.warn('⚠️  BillingCalculator or MeterDataManager not loaded');
}
