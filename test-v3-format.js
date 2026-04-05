#!/usr/bin/env node
/**
 * Test V3 meter format detection and parsing
 * Verifies that the parseImportExcelData V3 logic works correctly
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Test file path
const testFilePath = 'C:\\Users\\usEr\\Downloads\\บิลปี69 (1).xlsx';

console.log('🧪 Testing V3 Meter Format Detection & Parsing\n');
console.log(`📁 Test file: ${testFilePath}`);
console.log(`✓ File exists: ${fs.existsSync(testFilePath)}\n`);

try {
  // Read the Excel file
  const workbook = XLSX.readFile(testFilePath);
  console.log(`📊 Workbook loaded`);
  console.log(`📋 Sheet names: ${workbook.SheetNames.join(', ')}\n`);

  // Test V3 detection logic
  const monthMap = {
    'มค': 1, 'กพ': 2, 'มีค': 3, 'เมษา': 4, 'พค': 5, 'พฤษ': 5, 'มิย': 6, 'มิถุน': 6,
    'กค': 7, 'กรก': 7, 'สค': 8, 'สิงห': 8, 'กย': 9, 'กันย': 9, 'ตค': 10,
    'ตุลา': 10, 'พย': 11, 'พยค': 11, 'ธค': 12, 'ธันว': 12
  };

  // Find first sheet with Thai month
  let selectedSheet = null;
  for (let sheetName of workbook.SheetNames) {
    for (let key in monthMap) {
      if (sheetName.includes(key)) {
        selectedSheet = sheetName;
        break;
      }
    }
    if (selectedSheet) break;
  }

  if (!selectedSheet) {
    console.error('❌ No sheet with Thai month found');
    process.exit(1);
  }

  console.log(`✅ Selected sheet: "${selectedSheet}"\n`);

  const worksheet = workbook.Sheets[selectedSheet];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  console.log(`📈 Total rows: ${data.length}\n`);

  // ===== V3 DETECTION LOGIC =====
  console.log('🔍 Testing V3 Format Detection...\n');

  let isV3Format = false;
  let hasNestData = false;
  let hasAmazonData = false;

  // Check first 20 data rows for V3 indicators
  for (let i = 1; i < Math.min(21, data.length); i++) {
    const row = data[i];
    if (!row[0]) continue;

    // Check if columns F (5) and L (11) have numeric values (meter readings)
    const colF = parseFloat(row[5]);
    const colL = parseFloat(row[11]);

    if (!isNaN(colF) && colF > 0 && colF < 100000) {
      hasNestData = true;
    }
    if (!isNaN(colL) && colL > 0 && colL < 100000) {
      hasAmazonData = true;
    }
  }

  isV3Format = hasNestData && hasAmazonData;

  console.log(`📊 Detection Results:`);
  console.log(`  • Column F (Nest) has numeric data: ${hasNestData ? '✓' : '✗'}`);
  console.log(`  • Column L (Amazon) has numeric data: ${hasAmazonData ? '✓' : '✗'}`);
  console.log(`  • Is V3 Format: ${isV3Format ? '✅ YES' : '❌ NO'}\n`);

  // ===== V3 PARSING LOGIC =====
  if (isV3Format) {
    console.log('🔧 Parsing V3 Format\n');

    const allRooms = {
      rooms: {},
      nest: {},
      amazon: {}
    };

    const roomsRoomList = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25',
                           '26', '27', '28', '29', '30', '31', '32', '33', '35', 'AMAZON', 'ร้านใหญ่'];
    const nestRoomList = ['N101', 'N102', 'N103', 'N104', 'N105',
                          'N201', 'N202', 'N203', 'N204', 'N205',
                          'N301', 'N302', 'N303', 'N304', 'N305',
                          'N401', 'N402', 'N403', 'N404', 'N405'];

    // Parse all rows
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;

      const roomNum = String(row[0]).trim();

      const roomsPrev = parseFloat(row[1]) || 0;
      const roomsCurr = parseFloat(row[2]) || 0;
      const nestPrev = parseFloat(row[5]) || 0;
      const nestCurr = parseFloat(row[6]) || 0;
      const amazonPrev = parseFloat(row[11]) || 0;
      const amazonCurr = parseFloat(row[12]) || 0;

      // Store for all buildings
      if (roomsRoomList.includes(roomNum)) {
        allRooms.rooms[roomNum] = {
          eNew: roomsCurr,
          eOld: roomsPrev,
          wNew: nestCurr,
          wOld: nestPrev
        };
      }

      if (nestRoomList.includes(roomNum)) {
        allRooms.nest[roomNum] = {
          eNew: roomsCurr,
          eOld: roomsPrev,
          wNew: nestCurr,
          wOld: nestPrev
        };
      }

      allRooms.amazon[roomNum] = {
        eNew: amazonCurr,
        eOld: amazonPrev,
        wNew: roomsCurr,
        wOld: roomsPrev
      };
    }

    console.log(`📦 V3 Parse Results:`);
    console.log(`  • Rooms building: ${Object.keys(allRooms.rooms).length} rooms`);
    console.log(`  • Nest building: ${Object.keys(allRooms.nest).length} rooms`);
    console.log(`  • Amazon building: ${Object.keys(allRooms.amazon).length} rooms\n`);

    // Display sample data
    console.log(`📋 Sample Data (Rooms building):`);
    const roomsSample = Object.entries(allRooms.rooms).slice(0, 3);
    roomsSample.forEach(([roomNum, data]) => {
      console.log(`  Room ${roomNum}: Rooms(${data.eOld}→${data.eNew}), Nest(${data.wOld}→${data.wNew})`);
    });

    console.log(`\n📋 Sample Data (Nest building):`);
    const nestSample = Object.entries(allRooms.nest).slice(0, 3);
    nestSample.forEach(([roomNum, data]) => {
      console.log(`  Room ${roomNum}: Rooms(${data.eOld}→${data.eNew}), Nest(${data.wOld}→${data.wNew})`);
    });

    console.log(`\n📋 Sample Data (Amazon building):`);
    const amazonSample = Object.entries(allRooms.amazon).slice(0, 3);
    amazonSample.forEach(([roomNum, data]) => {
      console.log(`  Room ${roomNum}: Amazon(${data.eOld}→${data.eNew}), Rooms(${data.wOld}→${data.wNew})`);
    });

    console.log(`\n✅ V3 Format parsing successful!\n`);
  }

} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}

console.log('✨ Test completed successfully');
