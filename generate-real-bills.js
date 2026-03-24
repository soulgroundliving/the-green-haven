/**
 * Generate Real Bills from meter_data_export.json
 * Converts Excel meter data (621 records) into 36 months of bills for tenant app
 */

const fs = require('fs');
const path = require('path');

// Room rates from room-config.js
const ROOM_RATES = {
  'rooms': {
    '13': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '14': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '15': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '15ก': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '16': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '17': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '18': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '19': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '20': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '21': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '22': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '23': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '24': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '25': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '26': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '27': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '28': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '29': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '30': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '31': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    '32': { rent: 1200, water: 20, electric: 8, common: 0, trash: 40 },
    '33': { rent: 1500, water: 20, electric: 8, common: 0, trash: 40 },
    'AMAZON': { rent: 15000, water: 20, electric: 6, common: 0, trash: 0 }
  },
  'nest': {
    'N101': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N102': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N103': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N104': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N105': { rent: 5000, water: 20, electric: 8, common: 0, trash: 40 },
    'N201': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N202': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N203': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N204': { rent: 4500, water: 20, electric: 8, common: 0, trash: 40 },
    'N205': { rent: 5000, water: 20, electric: 8, common: 0, trash: 40 },
    'N301': { rent: 5000, water: 20, electric: 8, common: 0, trash: 40 },
    'N302': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N303': { rent: 5000, water: 20, electric: 8, common: 0, trash: 40 },
    'N304': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N305': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N401': { rent: 5600, water: 20, electric: 8, common: 0, trash: 40 },
    'N402': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N403': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N404': { rent: 5900, water: 20, electric: 8, common: 0, trash: 40 },
    'N405': { rent: 5600, water: 20, electric: 8, common: 0, trash: 40 }
  }
};

// Load meter data
const meterDataPath = path.join(__dirname, 'meter_data_export.json');
const meterDataRaw = JSON.parse(fs.readFileSync(meterDataPath, 'utf8'));
const meterData = meterDataRaw.data;

console.log(`📊 Loaded ${meterData.length} meter records`);

// Group meter data by building, year, month, roomId
const groupedData = {};
meterData.forEach(record => {
  const key = `${record.building}_${record.year}_${record.month}`;
  if (!groupedData[key]) groupedData[key] = {};
  groupedData[key][record.roomId] = record;
});

console.log(`📦 Grouped into ${Object.keys(groupedData).length} month groups`);

// Generate bills from meter data
const bills = [];
let billCount = 0;

Object.entries(groupedData).forEach(([key, roomData]) => {
  const [building, year, month] = key.split('_');

  Object.entries(roomData).forEach(([roomId, meter]) => {
    const rates = ROOM_RATES[building]?.[roomId];
    if (!rates) {
      console.warn(`⚠️  No rates found for ${building}/${roomId}`);
      return;
    }

    // Calculate usage
    const waterUsage = Math.max(0, meter.wNew - meter.wOld);
    const electricUsage = Math.max(0, meter.eNew - meter.eOld);

    // Calculate costs
    const waterCost = waterUsage * rates.water;
    const electricCost = electricUsage * rates.electric;
    const commonCost = rates.common;
    const trashCost = rates.trash;
    const rentCost = rates.rent;

    const totalCharge = rentCost + waterCost + electricCost + commonCost + trashCost;

    // Create bill object
    const bill = {
      billId: `BILL-${year}-${String(month).padStart(2, '0')}-${building}-${roomId}`,
      building: building,
      roomId: roomId,
      month: parseInt(month),
      year: parseInt(year),
      charges: {
        rent: rentCost,
        water: {
          usage: waterUsage,
          rate: rates.water,
          cost: waterCost
        },
        electric: {
          usage: electricUsage,
          rate: rates.electric,
          cost: electricCost
        },
        common: commonCost,
        trash: trashCost
      },
      totalCharge: totalCharge,
      status: 'pending',
      meterReadings: {
        water: {
          previous: meter.wOld,
          current: meter.wNew,
          usage: waterUsage
        },
        electric: {
          previous: meter.eOld,
          current: meter.eNew,
          usage: electricUsage
        }
      },
      billDate: new Date(`${year}-${String(month).padStart(2, '0')}-01`).toISOString(),
      notes: ''
    };

    bills.push(bill);
    billCount++;
  });
});

console.log(`✅ Generated ${billCount} bills`);

// Group bills by year
const billsByYear = {};
bills.forEach(bill => {
  if (!billsByYear[bill.year]) billsByYear[bill.year] = [];
  billsByYear[bill.year].push(bill);
});

// Save output
const output = {
  timestamp: new Date().toISOString(),
  totalBills: bills.length,
  billsByYear: Object.keys(billsByYear).reduce((acc, year) => {
    acc[year] = billsByYear[year].length;
    return acc;
  }, {}),
  bills: bills
};

const outputPath = path.join(__dirname, 'real-bills-generated.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\n📁 Saved to: ${outputPath}`);
console.log(`\n📊 Summary:`);
console.log(`   Year 67: ${billsByYear[67]?.length || 0} bills`);
console.log(`   Year 68: ${billsByYear[68]?.length || 0} bills`);
console.log(`   Year 69: ${billsByYear[69]?.length || 0} bills`);
console.log(`   Total: ${billCount} bills`);

// Sample bills
console.log(`\n📋 Sample Bill (Room 13, June 2569):`);
const sampleBill = bills.find(b => b.roomId === '13' && b.month === 6 && b.year === 69);
if (sampleBill) {
  console.log(JSON.stringify(sampleBill, null, 2));
}
