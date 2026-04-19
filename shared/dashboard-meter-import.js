// ===== IMPORT METER DATA FUNCTIONS =====
let currentImportData = null;
let currentImportMatchResults = null;
let currentImportWorkbook = null; // Store workbook for month changes

function initImportMeterTab() {
  // Reset import state when tab opens
  document.getElementById('importFileInput').value = '';
  document.getElementById('importStatusMessage').innerHTML = '';
  document.getElementById('importResultsSection').style.display = 'none';
  document.getElementById('importMonthSelect').value = ''; // Reset month selector
  document.getElementById('importDropZone').onclick = () => document.getElementById('importFileInput').click();

  // Add month selector change listener
  const monthSelect = document.getElementById('importMonthSelect');
  if (monthSelect) {
    monthSelect.onchange = () => {
      if (currentImportWorkbook && currentImportData) {
        // Get building from current data
        const building = currentImportData.building || 'rooms';
        // Re-parse with new month selection
        const importData = parseImportExcelData(currentImportWorkbook, building);
        if (importData) {
          currentImportData = importData;
          let matchResults;
          // ⚠️ SAME SAFETY CHECK as line ~4254
          // See explanation there for why we check before calling
          if (typeof window.matchMeterDataWithPrevious === 'function') {
            matchResults = window.matchMeterDataWithPrevious(importData);
          } else {
            matchResults = { summary: { totalRooms: 0 }, details: [], canProceed: true, isFirstImport: true };
          }
          currentImportMatchResults = matchResults;
          displayImportPreview(importData, matchResults);
          showImportStatus('✅ อัพเดตข้อมูลเดือนแล้ว!', 'success');
        }
      }
    };
  }
}

function handleImportDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    handleImportFileProcess(files[0]);
  }
}

/**
 * METER IMPORT: File input handler (same as billing import)
 * HTML: onchange="window.handleImportFile && window.handleImportFile(event);"
 *
 * ⚠️ MUST expose to window scope below!
 */
function handleImportFile(event) {
  const files = event.target.files;
  if (files.length > 0) {
    handleImportFileProcess(files[0]);
  }
}

// 🚨 CRITICAL: Expose to global scope for HTML event handlers
window.handleImportFile = handleImportFile;
window.handleImportDrop = handleImportDrop;

/**
 * METER IMPORT: Main file processor
 *
 * 🔄 FLOW (Different from Billing!):
 * 1. Read Excel file using XLSX
 * 2. Parse data with parseImportExcelData()
 * 3. Detect format (V3 has 3 buildings: rooms/nest/amazon)
 * 4. Call matchMeterDataWithPrevious() with SAFETY CHECK
 * 5. Display preview
 * 6. (No auto-save - user must click "บันทึก")
 *
 * ⚠️ KEY DIFFERENCE FROM BILLING:
 * - Meter import has month selector (can change after upload)
 * - Meter import stores in memory (currentImportData)
 * - Billing import auto-saves to localStorage
 */
function handleImportFileProcess(file) {
  showImportStatus('⏳ กำลังโหลด...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      // STEP 1: Read Excel file binary data
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      // Store workbook globally for month selector changes
      // (User can change month without re-uploading file)
      currentImportWorkbook = workbook;

      // STEP 2: Parse the data
      // Building auto-detected from room names in parseImportExcelData()
      let importData = parseImportExcelData(workbook, 'rooms'); // Parse as rooms first
      console.log('📊 Parsed import data:', importData);

      if (importData) {
        // Check if V3 format - more reliable: check if Nest data exists (not just flag)
        const hasNestData = importData.nest && Object.keys(importData.nest || {}).length >= 5; // At least 5 rooms to be Nest
        const isV3Format = (importData.isV3 === true) || (importData.building === 'all') || hasNestData;

        console.log(`🔍 V3 Format Check:`);
        console.log(`   isV3=${importData.isV3}, building=${importData.building}, hasNestData=${hasNestData}`);
        console.log(`   Data counts - Rooms: ${Object.keys(importData.rooms || {}).length}, Nest: ${Object.keys(importData.nest || {}).length}, Amazon: ${Object.keys(importData.amazon || {}).length}`);

        let detectedBuilding = 'rooms'; // Default value
        if (isV3Format) {
          // V3 format - already has all 3 buildings (rooms/nest/amazon), don't re-parse
          console.log(`✅ V3 format confirmed - SKIP re-parsing to preserve Nest data!`);
          detectedBuilding = 'all';
        } else {
          // V1/V2 format - auto-detect single building
          console.log(`⚠️ Not V3 format - attempting V1/V2 building detection...`);
          detectedBuilding = detectBuildingFromRooms(Object.keys(importData.rooms));
          console.log(`🏢 Auto-detected building: ${detectedBuilding}`);

          // Re-parse with correct building if needed
          if (detectedBuilding === 'nest') {
            console.log(`⚠️ Re-parsing as NEST building...`);
            importData = parseImportExcelData(workbook, 'nest');
          }
        }

        console.log(`📊 Final: Rooms=${Object.keys(importData.rooms || {}).length}, Nest=${Object.keys(importData.nest || {}).length}, Amazon=${Object.keys(importData.amazon || {}).length}`);
        currentImportData = importData;

        // STEP 6: Get match results - CRITICAL SAFETY CHECK
        // This function comes from meter-unified.js (shared/meter-unified.js)
        // It compares imported data with previous month's readings
        //
        // ⚠️ WHY THE SAFETY CHECK IS CRITICAL:
        // - Function must be loaded from meter-unified.js
        // - If meter-unified.js didn't load → function won't exist
        // - If we call undefined function → ReferenceError crash
        // - Solution: Check if exists before calling + provide fallback
        //
        // Error would be: "Uncaught ReferenceError: matchMeterDataWithPrevious is not defined"
        console.log('🔍 Calling matchMeterDataWithPrevious...');
        let matchResults;
        if (typeof window.matchMeterDataWithPrevious === 'function') {
          // Function exists - safe to call
          matchResults = window.matchMeterDataWithPrevious(importData);
        } else {
          // Function not loaded yet - use default/fallback object
          console.warn('⚠️ matchMeterDataWithPrevious not available yet, using fallback');
          matchResults = { summary: { totalRooms: 0 }, details: [], canProceed: true, isFirstImport: true };
        }
        console.log('📋 Match results:', matchResults);
        currentImportMatchResults = matchResults;

        // Display preview
        displayImportPreview(importData, matchResults);
        const buildingLabel = (detectedBuilding === 'nest' ? 'Nest Building' : (detectedBuilding === 'all' ? 'All Buildings' : 'Rooms Building'));
        showImportStatus('✅ โหลดข้อมูลสำเร็จ! (อาคาร: ' + buildingLabel + ')', 'success');
      } else {
        console.error('❌ importData is null or undefined');
      }
    } catch (err) {
      showImportStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Auto-detect building from room names
 * Nest rooms start with 'N' (e.g., N101, N102, ...)
 * Rooms building rooms are numbered (e.g., 13, 14, ...)
 */
function detectBuildingFromRooms(roomIds) {
  if (!roomIds || roomIds.length === 0) return 'rooms'; // Default to rooms

  // Check if any room ID starts with 'N' (Nest Building)
  const hasNestRooms = roomIds.some(id => String(id).toUpperCase().startsWith('N'));

  return hasNestRooms ? 'nest' : 'rooms';
}

function parseImportExcelData(workbook, building) {
  const monthMap = {
    'มค': 1, 'กพ': 2, 'มีค': 3, 'เมษา': 4, 'พค': 5, 'พฤษ': 5, 'มิย': 6, 'มิถุน': 6,
    'กค': 7, 'กรก': 7, 'สค': 8, 'สิงห': 8, 'กย': 9, 'กันย': 9, 'ตค': 10,
    'ตุลา': 10, 'พย': 11, 'พยค': 11, 'ธค': 12, 'ธันว': 12
  };

  // Create reverse month map (number to Thai abbreviation)
  const reverseMonthMap = {};
  for (let thai in monthMap) {
    const monthNum = monthMap[thai];
    if (!reverseMonthMap[monthNum]) {
      reverseMonthMap[monthNum] = thai;
    }
  }

  // Check for manual month selection first
  let selectedMonth = null;
  const manualMonth = document.getElementById('importMonthSelect').value;
  if (manualMonth) {
    selectedMonth = parseInt(manualMonth);
  }

  // Find the sheet based on selected month
  let selectedSheet = null;

  if (selectedMonth) {
    // Manual month selected - find sheet with this month
    const thaiMonthAbbr = reverseMonthMap[selectedMonth];
    if (thaiMonthAbbr) {
      selectedSheet = workbook.SheetNames.find(name => name.includes(thaiMonthAbbr));
    }
  } else {
    // Auto-detect from sheet names
    for (let sheetName of workbook.SheetNames) {
      for (let key in monthMap) {
        if (sheetName.includes(key)) {
          selectedSheet = sheetName;
          selectedMonth = monthMap[key];
          break;
        }
      }
      if (selectedSheet) break;
    }
  }

  if (!selectedSheet) {
    showImportStatus('❌ ไม่พบชีตที่มีข้อมูลในไฟล์', 'error');
    return null;
  }

  if (!selectedMonth) {
    showImportStatus('❌ กรุณาเลือกเดือน หรือใช้ชีตที่มีชื่อเดือนภาษาไทย', 'error');
    return null;
  }

  const worksheet = workbook.Sheets[selectedSheet];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // Get year from filename or sheet name (from file input)
  let year = null;

  // Try filename first
  const fileInput = document.getElementById('importFileInput');
  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const filename = fileInput.files[0].name;
    console.log(`🔍 [Year Detection] Filename: "${filename}"`);

    // Support formats: "68_...", "...68", "... 68" etc
    const yearPatterns = [
      /(\d{2})$/,           // End of string: "..68"
      /^(\d{2})[_\-]/,      // Start with dash/underscore: "68_..."
      /[_\-\s](\d{2})$/,    // Before end with separator: "..._68"
      /(\d{2})[_\-\s]/      // Followed by separator: "68_..."
    ];

    for (let i = 0; i < yearPatterns.length; i++) {
      const pattern = yearPatterns[i];
      const match = filename.match(pattern);
      console.log(`  Pattern ${i}: ${pattern} → ${match ? 'MATCHED: ' + match[1] : 'no match'}`);

      if (match) {
        const num = parseInt(match[1]);
        console.log(`    Parsed as number: ${num} (valid: ${num >= 50 && num <= 99})`);

        if (num >= 50 && num <= 99) {
          year = num;
          console.log(`✅ Detected year ${year} from filename: ${filename}`);
          break;
        }
      }
    }
  } else {
    console.warn(`⚠️ [Year Detection] No file in input. fileInput=${!!fileInput}, files=${fileInput?.files?.length}`);
  }

  // Try sheet name if filename didn't work
  if (!year && selectedSheet) {
    console.log(`🔍 [Year Detection] Sheet name: "${selectedSheet}"`);

    const yearPatterns = [
      /(\d{2})$/,           // End: "สค68"
      /^(\d{2})[_\-]/,      // Start: "68_สค"
      /[_\-\s](\d{2})$/,    // Before end: "สค_68"
      /(\d{2})[_\-\s]/      // Followed: "68_สค"
    ];

    for (let i = 0; i < yearPatterns.length; i++) {
      const pattern = yearPatterns[i];
      const match = selectedSheet.match(pattern);
      console.log(`  Pattern ${i}: ${pattern} → ${match ? 'MATCHED: ' + match[1] : 'no match'}`);

      if (match) {
        const num = parseInt(match[1]);
        console.log(`    Parsed as number: ${num} (valid: ${num >= 50 && num <= 99})`);

        if (num >= 50 && num <= 99) {
          year = num;
          console.log(`✅ Detected year ${year} from sheet name: ${selectedSheet}`);
          break;
        }
      }
    }
  }

  // Default to 69 only if nothing found
  if (!year) {
    console.warn('⚠️ Could not detect year - defaulting to 69');
    year = 69;
  } else {
    console.log(`✅ Final year: ${year}`);
  }

  // ===== V3 METER FORMAT PARSING (June 69+) =====
  // V3 Format: All buildings in ONE SHEET with different row ranges
  // Row Structure:
  // - Rows 2-23: ROOMS (ห้อง 13-33, 15ก)
  // - Rows 26-44: NEST (N101-N405)
  // - Row 47: AMAZON (ร้านใหญ่)
  // Columns: B-C (Rooms prev/curr), G (Nest prev), H (Nest curr), M (Amazon prev), L (Amazon curr)

  // Detect file format first
  const isV3FormatFile = workbook.SheetNames.length === 1; // V3 = 1 sheet, V1/V2 = 12 sheets
  console.log(`📊 File structure: ${workbook.SheetNames.length} sheet(s) → V${isV3FormatFile ? '3' : '1/V2'} format`);

  // ===== V3 FORMAT PARSING (Single sheet with all buildings) =====
  if (isV3FormatFile) {
    console.log('🔧 Parsing V3 meter format - All buildings in one sheet');

    const allRooms = {
      rooms: {},
      nest: {},
      amazon: {}
    };

    const roomsRoomList = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25',
                           '26', '27', '28', '29', '30', '31', '32', '33'];
    const nestRoomList = ['N101', 'N102', 'N103', 'N104', 'N105',
                          'N201', 'N202', 'N203', 'N204', 'N205',
                          'N301', 'N302', 'N303', 'N304', 'N305',
                          'N401', 'N402', 'N403', 'N404', 'N405'];

    // Pre-populate
    console.log('📋 Pre-populating all expected rooms with 0 values...');
    roomsRoomList.forEach(roomNum => {
      allRooms.rooms[roomNum] = {eNew: 0, eOld: 0, wNew: 0, wOld: 0};
    });
    nestRoomList.forEach(roomNum => {
      allRooms.nest[roomNum] = {eNew: 0, eOld: 0, wNew: 0, wOld: 0};
    });
    allRooms.amazon['ร้านใหญ่'] = {eNew: 0, eOld: 0, wNew: 0, wOld: 0};

    // Parse data
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const roomNum = String(row[0]).trim();
      // Excel layout: F (col 5) = electric new (formula =B for Rooms/Amazon, direct entry for Nest)
      //               L (col 11) = water new (formula =C for Rooms/Amazon, direct entry for Nest)
      //               G (col 6) = electric old, M (col 12) = water old
      const meterData = {
        eNew: parseFloat(row[5]) || 0,
        eOld: parseFloat(row[6]) || 0,
        wNew: parseFloat(row[11]) || 0,
        wOld: parseFloat(row[12]) || 0
      };

      if (roomsRoomList.includes(roomNum)) {
        allRooms.rooms[roomNum] = meterData;
      } else if (nestRoomList.includes(roomNum)) {
        allRooms.nest[roomNum] = meterData;
      } else if (roomNum === 'ร้านใหญ่' || roomNum === 'AMAZON') {
        allRooms.amazon['ร้านใหญ่'] = meterData;
      }
    }

    return {
      year, month: selectedMonth || 1, sheetName: selectedSheet,
      rooms: allRooms.rooms, nest: allRooms.nest, amazon: allRooms.amazon,
      building: 'all', isV3: true, importType: 'meter'
    };
  }

  // ===== FALLBACK: V1/V2 FORMAT PARSING (Multi-sheet with all buildings) =====
  console.log('🔧 Parsing V1/V2 meter format (auto-detect all buildings)');

  const roomsRoomList = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25',
                         '26', '27', '28', '29', '30', '31', '32', '33'];
  const nestRoomList = ['N101', 'N102', 'N103', 'N104', 'N105',
                        'N201', 'N202', 'N203', 'N204', 'N205',
                        'N301', 'N302', 'N303', 'N304', 'N305',
                        'N401', 'N402', 'N403', 'N404', 'N405'];

  const roomsData = {};
  const nestData = {};
  const amazonData = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const roomNum = String(row[0]).trim();
    const meterData = {
      eNew: parseFloat(row[5]) || 0,   // Column F: Electricity New (formula =B for Rooms/Amazon, direct for Nest)
      eOld: parseFloat(row[6]) || 0,   // Column G: Electricity Old
      wNew: parseFloat(row[11]) || 0,  // Column L: Water New (formula =C for Rooms/Amazon, direct for Nest)
      wOld: parseFloat(row[12]) || 0   // Column M: Water Old
    };

    // Auto-detect building from room number
    if (roomsRoomList.includes(roomNum)) {
      roomsData[roomNum] = meterData;
    } else if (nestRoomList.includes(roomNum)) {
      nestData[roomNum] = meterData;
    } else if (roomNum === 'ร้านใหญ่' || roomNum === 'AMAZON') {
      amazonData['ร้านใหญ่'] = meterData;
    }
  }

  return {
    year,
    month: selectedMonth || 1,
    sheetName: selectedSheet,
    rooms: roomsData,
    nest: nestData,
    amazon: amazonData,
    building: 'all',  // V1/V2 can have mixed buildings
    isV3: false,
    importType: 'billing'   // Store as billing_data in localStorage
  };
}

function displayImportPreview(importData, matchResults) {
  // Guard against undefined importData
  if (!importData) {
    showImportStatus('❌ เกิดข้อผิดพลาด: ไม่มีข้อมูลที่นำเข้า', 'error');
    return;
  }

  function escapeHtml(text) {
    const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  // ===== BUILD COMPLETE TABLE WITH ALL BUILDINGS =====
  // Count all 3 buildings
  const roomsCount = Object.keys(importData.rooms || {}).length;
  const nestCount = Object.keys(importData.nest || {}).length;
  const amazonCount = Object.keys(importData.amazon || {}).length;
  const totalCount = roomsCount + nestCount + amazonCount;

  // Build table rows for all buildings
  let tableRows = '';

  // Add Rooms Building rows
  if (importData.rooms) {
    Object.entries(importData.rooms).forEach((entry, idx) => {
      const [room, data] = entry;
      tableRows += `
        <tr style="border-bottom:1px solid var(--border);background:${idx % 2 === 0 ? 'white' : 'rgba(0,0,0,0.01)'};">
          <td style="padding:0.7rem;font-weight:600;">🏠 ${escapeHtml(room)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eOld || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wOld || 0)}</td>
          <td style="padding:0.7rem;text-align:center;"><span style="background:#c8e6c9;color:#2e7d32;padding:0.3rem 0.6rem;border-radius:3px;font-size:0.75rem;font-weight:600;">✓</span></td>
        </tr>
      `;
    });
  }

  // Add Nest Building rows
  if (importData.nest) {
    Object.entries(importData.nest).forEach((entry, idx) => {
      const [room, data] = entry;
      tableRows += `
        <tr style="border-bottom:1px solid var(--border);background:${idx % 2 === 0 ? 'white' : 'rgba(0,0,0,0.01)'};">
          <td style="padding:0.7rem;font-weight:600;">🏢 ${escapeHtml(room)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eOld || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wOld || 0)}</td>
          <td style="padding:0.7rem;text-align:center;"><span style="background:#c8e6c9;color:#2e7d32;padding:0.3rem 0.6rem;border-radius:3px;font-size:0.75rem;font-weight:600;">✓</span></td>
        </tr>
      `;
    });
  }

  // Add Amazon rows
  if (importData.amazon) {
    Object.entries(importData.amazon).forEach((entry, idx) => {
      const [room, data] = entry;
      tableRows += `
        <tr style="border-bottom:1px solid var(--border);background:${idx % 2 === 0 ? 'white' : 'rgba(0,0,0,0.01)'};">
          <td style="padding:0.7rem;font-weight:600;">📦 ${escapeHtml(room)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.eOld || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wNew || 0)}</td>
          <td style="padding:0.7rem;text-align:right;">${escapeHtml(data.wOld || 0)}</td>
          <td style="padding:0.7rem;text-align:center;"><span style="background:#c8e6c9;color:#2e7d32;padding:0.3rem 0.6rem;border-radius:3px;font-size:0.75rem;font-weight:600;">✓</span></td>
        </tr>
      `;
    });
  }

  const previewHtml = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-sm);">
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
        <thead style="background:var(--accent-light);">
          <tr>
            <th style="padding:0.7rem;text-align:left;border-bottom:2px solid var(--border);">ห้อง</th>
            <th style="padding:0.7rem;text-align:right;border-bottom:2px solid var(--border);">⚡ New</th>
            <th style="padding:0.7rem;text-align:right;border-bottom:2px solid var(--border);">⚡ Old</th>
            <th style="padding:0.7rem;text-align:right;border-bottom:2px solid var(--border);">💧 New</th>
            <th style="padding:0.7rem;text-align:right;border-bottom:2px solid var(--border);">💧 Old</th>
            <th style="padding:0.7rem;text-align:center;border-bottom:2px solid var(--border);">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    <div style="margin-top:1rem;padding:0.8rem;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.85rem;color:var(--text-muted);text-align:center;">
      <strong style="color:var(--text);">ปี ${escapeHtml(importData.year)}</strong> | เดือน <strong style="color:var(--text);">${escapeHtml(importData.month)}</strong> | ห้องทั้งหมด: <strong style="color:var(--text);">${escapeHtml(totalCount)}</strong> (Rooms: ${roomsCount}, Nest: ${nestCount}, Amazon: ${amazonCount})
    </div>
  `;

  const previewDataDiv = document.getElementById('importPreviewData');
  previewDataDiv.innerHTML = previewHtml;
  // Force remove scroll constraints
  previewDataDiv.style.maxHeight = 'none';
  previewDataDiv.style.height = 'auto';
  previewDataDiv.style.overflow = 'visible';
  previewDataDiv.style.overflowX = 'visible';
  previewDataDiv.style.overflowY = 'visible';
  document.getElementById('importResultsSection').style.display = 'block';

  // Display match summary
  displayMatchSummary(matchResults);
}

// Display data continuity validation results
function displayMatchSummary(matchResults) {
  const summaryDiv = document.getElementById('importMatchSummary');
  const approveBtn = document.getElementById('approveImportBtn');

  if (!summaryDiv || !matchResults) return;

  const { summary, canProceed, mismatches } = matchResults;
  const { okCount, warningCount, errorCount } = summary;

  function escapeHtml(text) {
    const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  let html = '<div style="font-weight:600;margin-bottom:0.8rem;">🔍 ตรวจสอบความต่อเนื่องของข้อมูล:</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;">';

  // OK Status
  html += `<div style="text-align:center;padding:0.8rem;background:white;border-radius:4px;border-left:4px solid #4caf50;">
    <div style="font-size:1.2rem;font-weight:bold;color:#4caf50;">${escapeHtml(okCount)}</div>
    <div style="font-size:0.85rem;color:#666;">✅ ตรงกัน</div>
  </div>`;

  // Warning Status
  html += `<div style="text-align:center;padding:0.8rem;background:white;border-radius:4px;border-left:4px solid #ff9800;">
    <div style="font-size:1.2rem;font-weight:bold;color:#ff9800;">${escapeHtml(warningCount)}</div>
    <div style="font-size:0.85rem;color:#666;">⚠️ ต่างเล็กน้อย</div>
  </div>`;

  // Error Status
  html += `<div style="text-align:center;padding:0.8rem;background:white;border-radius:4px;border-left:4px solid #f44336;">
    <div style="font-size:1.2rem;font-weight:bold;color:#f44336;">${escapeHtml(errorCount)}</div>
    <div style="font-size:0.85rem;color:#666;">❌ ต่างมาก</div>
  </div>`;

  html += '</div>';

  // Show mismatches if any
  if (mismatches && mismatches.length > 0) {
    html += '<div style="background:white;padding:0.8rem;border-radius:4px;margin-bottom:0.8rem;max-height:200px;overflow-y:auto;">';
    html += '<strong style="display:block;margin-bottom:0.5rem;font-size:0.9rem;">ห้องที่ต่างกัน:</strong>';
    html += '<div style="font-size:0.85rem;">';
    mismatches.forEach(m => {
      const icon = m.status === 'error' ? '❌' : '⚠️';
      html += `<div style="padding:0.25rem;color:#666;">
        ${icon} ห้อง <strong>${escapeHtml(m.room)}</strong> (${escapeHtml(m.fieldLabel)}):
        นำเข้า ${escapeHtml(m.imported)} / ระบบ ${escapeHtml(m.expected)} (ต่างกัน ${escapeHtml(m.delta)})
      </div>`;
    });
    html += '</div></div>';
  }

  // Status message
  if (canProceed) {
    if (errorCount === 0) {
      html += '<div style="color:#4caf50;font-weight:600;padding:0.25rem;">✅ ข้อมูลสามารถบันทึกได้</div>';
      approveBtn.disabled = false;
      approveBtn.style.opacity = '1';
      approveBtn.style.cursor = 'pointer';
    } else {
      html += '<div style="color:#ff9800;font-weight:600;padding:0.25rem;">⚠️ มีข้อมูลที่ต่างกัน ตรวจสอบอีกครั้ง</div>';
      approveBtn.disabled = true;
      approveBtn.style.opacity = '0.5';
      approveBtn.style.cursor = 'not-allowed';
    }
  } else {
    html += '<div style="color:#f44336;font-weight:600;padding:0.25rem;">❌ มีข้อผิดพลาดในข้อมูล ไม่สามารถบันทึกได้</div>';
    approveBtn.disabled = true;
    approveBtn.style.opacity = '0.5';
    approveBtn.style.cursor = 'not-allowed';
  }

  summaryDiv.innerHTML = html;
}

async function approveImportData() {
  const user = window.SecurityUtils.getSecureSession();
  if (!user || (user.userType !== 'admin' && user.userType !== 'accountant')) {
    showImportStatus('❌ คุณไม่มีสิทธิ์ในการอัพโหลดข้อมูล', 'error');
    return;
  }

  if (!currentImportData && !getPendingImportSession()) {
    showImportStatus('❌ ต้องอัพโหลดไฟล์ Excel และตรวจสอบข้อมูลก่อน', 'error');
    return;
  }

  if (!currentImportMatchResults || !currentImportMatchResults.canProceed) {
    showImportStatus('❌ มีข้อมูลที่ไม่ตรงกับระบบ ไม่สามารถบันทึกได้', 'error');
    return;
  }

  if (currentImportMatchResults.summary.errorCount > 0) {
    showImportStatus('❌ พบข้อผิดพลาดในการตรวจสอบข้อมูล ไม่สามารถบันทึกได้', 'error');
    return;
  }

  if (!currentImportData) {
    showImportStatus('❌ ไม่มีข้อมูลให้บันทึก', 'error');
    return;
  }

  // ===== ROUTE TO CORRECT STORAGE BASED ON IMPORT TYPE =====
  const importType = currentImportData.importType || (currentImportData.isV3 ? 'meter' : 'billing');

  if (importType === 'billing') {
    // Billing data goes to localStorage
    console.log('📥 Routing to billing import (localStorage)');
    return approveBillingImportDataFromMeter(currentImportData, currentImportMatchResults);
  }

  // Meter data goes to Firebase (default)
  console.log('📊 Routing to meter import (Firebase)');

  // Check for duplicate month upload
  const key = `${currentImportData.year}_${currentImportData.month}`;
  const building = currentImportData.building || 'rooms';

  const existingData = window.METER_DATA &&
                       window.METER_DATA[building] &&
                       window.METER_DATA[building][key];

  if (existingData) {
    const monthName = getThaiMonthName(currentImportData.month);
    const capturedImportData = JSON.parse(JSON.stringify(currentImportData));
    const capturedMatchResults = JSON.parse(JSON.stringify(currentImportMatchResults));

    showDuplicateConfirmDialog(
      `เดือน ${monthName} ปี ${capturedImportData.year} มีข้อมูลแล้ว`,
      `ต้องการแทนที่ข้อมูลเก่าด้วยข้อมูลใหม่หรือไม่?`
    ).then(async (confirmed) => {
      if (confirmed) {
        try {
          await performDataReplacementWithData(capturedImportData, capturedMatchResults);
        } catch (err) {
          showImportStatus(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
        }
      } else {
        showImportStatus('⏸️ ยกเลิกการอัพโหลด', 'info');
      }
    });
    return;
  } else {
    await performDataReplacement();
  }
}

async function performDataReplacementWithData(importData, matchResults) {
  try {
    localStorage.setItem('pendingMeterImport', JSON.stringify({
      sessionId: `imp_${Date.now()}`,
      timestamp: new Date().toISOString(),
      importData: importData,
      matchResults: matchResults,
      userApproval: null
    }));

    const result = await approvePendingImportWithFirebase(importData, matchResults, true);

    // Use the result from the import function - it's more reliable than checking METER_DATA
    if (result.success) {
      // Get month name for display
      const monthName = MONTHS_FULL[importData.month] || `เดือน ${importData.month}`;
      const displayYear = importData.year;

      showImportStatus(`✅ บันทึกข้อมูล ${monthName} ปี ${displayYear} สำเร็จ! 🎉 Dashboard อัพเดทแล้ว 📊`, 'success');

      // Display recorded meter data
      displayRecordedMeterData(importData, matchResults);

      // Refresh dashboard in background
      console.log('🔄 Refreshing dashboard after import...');
      setTimeout(async () => {
        try {
          // Refresh METER_DATA from localStorage
          if (window.METER_DATA) {
            console.log('📊 Reloading dashboard data...');
            // If dashboard is currently open, refresh the charts
            const dashboardPage = document.getElementById('page-dashboard');
            if (dashboardPage && dashboardPage.classList.contains('active')) {
              setTimeout(() => {
                initDashboardCharts();
                updateDashboardLive();
                console.log('✅ Dashboard refreshed with new data');
              }, 500);
            }
          }
        } catch (error) {
          console.warn('⚠️ Error refreshing dashboard:', error);
        }
      }, 500);
    } else {
      showImportStatus(`❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${result.message || 'Unknown error'}`, 'error');
    }

    setTimeout(() => {
      document.getElementById('importFileInput').value = '';
      document.getElementById('importResultsSection').style.display = 'none';
      document.getElementById('importPreviewData').innerHTML = '';
      currentImportData = null;
      currentImportMatchResults = null;
    }, 2000);
  } catch (error) {
    showImportStatus(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
  }
}

async function performDataReplacement() {
  await performDataReplacementWithData(currentImportData, currentImportMatchResults);
}

function displayRecordedMeterData(importData, matchResults) {
  const recordedSection = document.getElementById('meterDataRecordedSection');

  if (!recordedSection) return;

  try {
    // DEBUG: Check what importData contains
    console.log(`🔍 displayRecordedMeterData called with:`);
    console.log(`   importData keys:`, Object.keys(importData || {}));
    console.log(`   importData.isV3:`, importData?.isV3);
    console.log(`   importData.building:`, importData?.building);
    console.log(`   importData.rooms keys count:`, Object.keys(importData?.rooms || {}).length);
    console.log(`   importData.nest keys count:`, Object.keys(importData?.nest || {}).length);
    console.log(`   importData.amazon keys count:`, Object.keys(importData?.amazon || {}).length);

    if (importData?.nest && Object.keys(importData.nest).length > 0) {
      console.log(`✅ Nest data FOUND:`, Object.keys(importData.nest).slice(0, 3), '...');
    } else {
      console.warn(`❌ Nest data MISSING or EMPTY!`);
    }

    // ===== POPULATE PERIOD INFO =====
    const monthNames = {
      1: 'มกราคม', 2: 'กุมภาพันธ์', 3: 'มีนาคม', 4: 'เมษายน',
      5: 'พฤษภาคม', 6: 'มิถุนายน', 7: 'กรกฎาคม', 8: 'สิงหาคม',
      9: 'กันยายน', 10: 'ตุลาคม', 11: 'พฤศจิกายน', 12: 'ธันวาคม'
    };

    const year = importData.year;
    const month = importData.month;
    const monthName = monthNames[month] || `เดือน ${month}`;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    document.getElementById('recordedYear').textContent = `ปี ${year}`;
    document.getElementById('recordedMonth').textContent = `${monthName} (เดือน ${month})`;
    document.getElementById('recordedTime').textContent = timeStr;

    // ===== ENSURE NEST DATA EXISTS =====
    // If Nest data is missing, re-populate it with pre-defined list
    if (!importData.nest || Object.keys(importData.nest).length === 0) {
      console.warn(`⚠️ Nest data missing in display! Re-populating...`);
      const nestRoomList = ['N101', 'N102', 'N103', 'N104', 'N105',
                            'N201', 'N202', 'N203', 'N204', 'N205',
                            'N301', 'N302', 'N303', 'N304', 'N305',
                            'N401', 'N402', 'N403', 'N404', 'N405'];
      importData.nest = {};
      nestRoomList.forEach(roomNum => {
        importData.nest[roomNum] = { eNew: 0, eOld: 0, wNew: 0, wOld: 0 };
      });
      console.log(`✅ Nest data re-populated with ${Object.keys(importData.nest).length} rooms`);
    }

    // ===== COUNT BUILDINGS =====
    const roomsCount = Object.keys(importData.rooms || {}).length;
    const nestCount = Object.keys(importData.nest || {}).length;
    const amazonCount = Object.keys(importData.amazon || {}).length;

    console.log(`📊 Final display counts: Rooms=${roomsCount}, Nest=${nestCount}, Amazon=${amazonCount}`);

    document.getElementById('recordedRoomsCount').textContent = roomsCount;
    document.getElementById('recordedNestCount').textContent = nestCount;
    document.getElementById('recordedAmazonCount').textContent = amazonCount;

    // ===== GENERATE COMPLETE DATA TABLE (ALL 43 ROOMS) =====
    const tableDiv = document.getElementById('recordedMeterTable');
    let tableHtml = '<div style="font-weight:600;margin-bottom:0.8rem;">📋 ข้อมูลมิเตอร์ทั้งหมด (43 ห้อง):</div>';

    tableHtml += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;max-height:600px;overflow-y:auto;">';
    tableHtml += '<thead style="position:sticky;top:0;"><tr style="background:#e8f5e9;border-bottom:2px solid #4caf50;">';
    tableHtml += '<th style="padding:0.6rem;text-align:left;border-right:1px solid #c8e6c9;">🏢 Building</th>';
    tableHtml += '<th style="padding:0.6rem;text-align:left;border-right:1px solid #c8e6c9;">🔢 ห้อง</th>';
    tableHtml += '<th style="padding:0.6rem;text-align:right;border-right:1px solid #c8e6c9;">📊 เก่า</th>';
    tableHtml += '<th style="padding:0.6rem;text-align:right;border-right:1px solid #c8e6c9;">📊 ใหม่</th>';
    tableHtml += '<th style="padding:0.6rem;text-align:right;">📈 ใช้</th>';
    tableHtml += '</tr></thead><tbody>';

    // ALL Rooms data (not just sample)
    const allRoomsData = Object.entries(importData.rooms || {});
    allRoomsData.forEach(([roomNum, data]) => {
      const usage = Math.abs((data.eNew || 0) - (data.eOld || 0));
      tableHtml += `<tr style="border-bottom:1px solid #e8f5e9;background:#fafafa;">
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;"><strong>🏠 Rooms</strong></td>
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;">${roomNum}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;">${(data.eOld || 0).toLocaleString()}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;"><strong>${(data.eNew || 0).toLocaleString()}</strong></td>
        <td style="padding:0.5rem;text-align:right;color:#2e7d32;font-weight:600;">${usage.toLocaleString()}</td>
      </tr>`;
    });

    // ALL Nest data (not just sample)
    const allNestData = Object.entries(importData.nest || {});
    allNestData.forEach(([roomNum, data]) => {
      const usage = Math.abs((data.eNew || 0) - (data.eOld || 0));
      tableHtml += `<tr style="border-bottom:1px solid #e8f5e9;background:#fafafa;">
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;"><strong>🏢 Nest</strong></td>
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;">${roomNum}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;">${(data.eOld || 0).toLocaleString()}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;"><strong>${(data.eNew || 0).toLocaleString()}</strong></td>
        <td style="padding:0.5rem;text-align:right;color:#6a1b9a;font-weight:600;">${usage.toLocaleString()}</td>
      </tr>`;
    });

    // Amazon data
    const allAmazonData = Object.entries(importData.amazon || {});
    allAmazonData.forEach(([roomNum, data]) => {
      const usage = Math.abs((data.eNew || 0) - (data.eOld || 0));
      tableHtml += `<tr style="border-bottom:1px solid #e8f5e9;background:#fafafa;">
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;"><strong>📦 Amazon</strong></td>
        <td style="padding:0.5rem;border-right:1px solid #c8e6c9;">${roomNum}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;">${(data.eOld || 0).toLocaleString()}</td>
        <td style="padding:0.5rem;text-align:right;border-right:1px solid #c8e6c9;"><strong>${(data.eNew || 0).toLocaleString()}</strong></td>
        <td style="padding:0.5rem;text-align:right;color:#f57f17;font-weight:600;">${usage.toLocaleString()}</td>
      </tr>`;
    });

    tableHtml += '</tbody></table>';

    // Display all rooms count summary
    const totalRooms = roomsCount + nestCount + amazonCount;
    tableHtml += `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;">📌 รวม ${totalRooms} ห้อง: Rooms ${roomsCount} + Nest ${nestCount} + Amazon ${amazonCount}</div>`;

    tableDiv.innerHTML = tableHtml;

    // ===== HISTORICAL COMPARISON =====
    const comparisonDiv = document.getElementById('meterHistoricalComparison');
    let comparisonHtml = '<div style="font-weight:600;margin-bottom:0.8rem;">📈 สรุปข้อมูล:</div>';
    comparisonHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;font-size:0.9rem;">';

    // Validation summary
    if (matchResults && matchResults.summary) {
      const { okCount, warningCount, errorCount } = matchResults.summary;
      comparisonHtml += `<div style="background:#e8f5e9;padding:0.8rem;border-radius:4px;border-left:4px solid #4caf50;">
        <div style="color:#2e7d32;font-weight:600;margin-bottom:0.3rem;">✅ ข้อมูลตรงกัน</div>
        <div style="font-size:1.2rem;font-weight:600;color:#2e7d32;">${okCount}</div>
        <div style="color:var(--text-muted);font-size:0.8rem;">ห้อง</div>
      </div>`;

      if (warningCount > 0) {
        comparisonHtml += `<div style="background:#fff3e0;padding:0.8rem;border-radius:4px;border-left:4px solid #ff9800;">
          <div style="color:#e65100;font-weight:600;margin-bottom:0.3rem;">⚠️ ต่างเล็กน้อย</div>
          <div style="font-size:1.2rem;font-weight:600;color:#e65100;">${warningCount}</div>
          <div style="color:var(--text-muted);font-size:0.8rem;">ห้อง</div>
        </div>`;
      }

      if (errorCount > 0) {
        comparisonHtml += `<div style="background:#ffebee;padding:0.8rem;border-radius:4px;border-left:4px solid #f44336;">
          <div style="color:#c62828;font-weight:600;margin-bottom:0.3rem;">❌ ต่างมาก</div>
          <div style="font-size:1.2rem;font-weight:600;color:#c62828;">${errorCount}</div>
          <div style="color:var(--text-muted);font-size:0.8rem;">ห้อง</div>
        </div>`;
      }
    }

    comparisonHtml += '</div>';
    comparisonDiv.innerHTML = comparisonHtml;

    // ===== SHOW SECTION =====
    recordedSection.style.display = 'block';

    // Scroll into view
    setTimeout(() => {
      recordedSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    console.log('✅ Meter data recorded section displayed', { year, month, roomsCount, nestCount, amazonCount });

  } catch (error) {
    console.error('Error displaying recorded meter data:', error);
  }
}

function cancelImportProcess() {
  document.getElementById('importFileInput').value = '';
  document.getElementById('importResultsSection').style.display = 'none';
  document.getElementById('importPreviewData').innerHTML = '';
  document.getElementById('importStatusMessage').innerHTML = '';
  document.getElementById('importMonthSelect').value = '';
  currentImportData = null;
  currentImportMatchResults = null;
  currentImportWorkbook = null;

  // Only clear pending import session data (NOT saved meter data)
  if (sessionStorage.getItem('pendingImportData')) {
    sessionStorage.removeItem('pendingImportData');
  }
}

function showImportStatus(message, type) {
  const statusDiv = document.getElementById('importStatusMessage');
  let bgColor = 'var(--accent-light)';
  let borderColor = 'var(--accent)';

  if (type === 'success') {
    bgColor = '#e8f5e9';
    borderColor = '#2e7d32';
  } else if (type === 'error') {
    bgColor = '#ffebee';
    borderColor = '#c62828';
  } else if (type === 'warning') {
    bgColor = '#fff3e0';
    borderColor = '#e65100';
  } else if (type === 'info') {
    bgColor = '#e3f2fd';
    borderColor = '#1565c0';
  }

  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = `background:${bgColor};border-left:4px solid ${borderColor};padding:1rem;border-radius:4px;color:var(--text);`;
  msgDiv.textContent = message;
  statusDiv.innerHTML = '';
  statusDiv.appendChild(msgDiv);
}

// Initialize Meter Pages
function initMeterPage() {
  // Load mock tenant data if not already loaded
  if (!localStorage.getItem('tenant_data')) {
    // Load from global mockTenantData if available
    if (typeof mockTenantData !== 'undefined') {
      localStorage.setItem('tenant_data', JSON.stringify(mockTenantData));
    }
  }

  // Load METER_DATA from Excel (always refresh to get latest data)
  if (typeof METER_DATA !== 'undefined') {
    localStorage.setItem('METER_DATA', JSON.stringify(METER_DATA));
    console.log('✅ Loaded Excel meter data (METER_DATA)');
  }

  console.log('✅ Meter page initialized');
  // Auto-switch to Room Config tab (default)
  setTimeout(() => {
    const roomConfigBtn = document.querySelector('[onclick*="room-config"]');
    if (roomConfigBtn) window.switchMeterTab('room-config', roomConfigBtn);
    if (typeof loadRoomConfigUI === 'function') loadRoomConfigUI();
  }, 100);
}

// F4+F5: Module-level interval IDs to prevent leak when tabs are switched repeatedly
let _nestMeterIntervalId = null;
let _roomsMeterIntervalId = null;

function initMeterNestTab() {
  console.log('📊 Loading Nest Building meter...');
  // Set current month if not set
  const monthInput = document.getElementById('nestMeterMonth');
  if (!monthInput.value) {
    const today = new Date();
    monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  // Populate meter grid
  renderNestMeterGrid();

  // Load old readings from METER_DATA
  autoFillOldReadingsNest();

  // Add robust event listeners to reload data when month changes
  // Use 'change', 'input', and 'blur' to catch all types of changes
  const handleMonthChange = () => {
    console.log('📅 Month changed to:', monthInput.value, ' - reloading old readings from METER_DATA...');
    autoFillOldReadingsNest();
  };

  monthInput.addEventListener('change', handleMonthChange);
  monthInput.addEventListener('input', handleMonthChange);
  monthInput.addEventListener('blur', handleMonthChange);

  // Also watch for value changes via setInterval (catches programmatic changes)
  // Clear previous interval before creating a new one to prevent leak on tab switch
  if (_nestMeterIntervalId) {
    clearInterval(_nestMeterIntervalId);
    _nestMeterIntervalId = null;
  }
  let lastMonthValue = monthInput.value;
  _nestMeterIntervalId = setInterval(() => {
    if (monthInput.value !== lastMonthValue) {
      console.log('📅 Month value changed (detected via polling):', monthInput.value);
      lastMonthValue = monthInput.value;
      autoFillOldReadingsNest();
    }
  }, 500);
}

function initMeterRoomsTab() {
  console.log('📊 Loading Rooms Building meter...');

  // Set current month if not set
  const monthInput = document.getElementById('roomsMeterMonth');
  if (!monthInput.value) {
    const today = new Date();
    monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  // Populate meter grid
  renderRoomsMeterGrid();

  // Load old readings from METER_DATA
  autoFillOldReadingsRooms();

  // Add robust event listeners to reload data when month changes
  // Use 'change', 'input', and 'blur' to catch all types of changes
  const handleMonthChange = () => {
    console.log('📅 Month changed to:', monthInput.value, ' - reloading old readings from METER_DATA...');
    autoFillOldReadingsRooms();
  };

  monthInput.addEventListener('change', handleMonthChange);
  monthInput.addEventListener('input', handleMonthChange);
  monthInput.addEventListener('blur', handleMonthChange);

  // Also watch for value changes via setInterval (catches programmatic changes)
  // Clear previous interval before creating a new one to prevent leak on tab switch
  if (_roomsMeterIntervalId) {
    clearInterval(_roomsMeterIntervalId);
    _roomsMeterIntervalId = null;
  }
  let lastMonthValue = monthInput.value;
  _roomsMeterIntervalId = setInterval(() => {
    if (monthInput.value !== lastMonthValue) {
      console.log('📅 Month value changed (detected via polling):', monthInput.value);
      lastMonthValue = monthInput.value;
      autoFillOldReadingsRooms();
    }
  }, 500);
}

// Auto-fill Old readings from METER_DATA (Nest Building)
// Phase 1c: rewritten to use MeterStore facade (was ~280 lines of duplicated
// Firebase + METER_DATA + previous-month fallback logic).
async function autoFillOldReadingsNest() {
  return _autoFillReadingsForGrid('nest');
}

function renderNestMeterGrid() {
  const gridEl = document.getElementById('nestMeterGrid');
  if (!gridEl) return;

  // Hardcoded Nest Building rooms (20 rooms: N101-N105, N201-N205, N301-N305, N401-N405)
  const nestRooms = ['N101', 'N102', 'N103', 'N104', 'N105', 'N201', 'N202', 'N203', 'N204', 'N205', 'N301', 'N302', 'N303', 'N304', 'N305', 'N401', 'N402', 'N403', 'N404', 'N405'];

  gridEl.innerHTML = nestRooms.map(room => `
    <div style="background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:1rem;">
      <div style="font-weight:600;margin-bottom:0.8rem;color:var(--text);">🏠 ${room}</div>

      <!-- Electric Reading -->
      <div style="margin-bottom:0.8rem;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">⚡ ค่าไฟ (kWh)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.3rem;">
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">ล่าสุด</small>
            <input type="number" id="meter-nest-${room}-electric-new" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">เดิม</small>
            <input type="number" id="meter-nest-${room}-electric-old" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:right;">ผลต่าง: <span id="diff-nest-${room}-electric">0</span> หน่วย = <span id="calc-nest-${room}-electric" style="color:var(--green);font-weight:600;">฿0</span></div>
      </div>

      <!-- Water Reading -->
      <div style="margin-bottom:0.8rem;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">💧 น้ำ (m³)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.3rem;">
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">ล่าสุด</small>
            <input type="number" id="meter-nest-${room}-water-new" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">เดิม</small>
            <input type="number" id="meter-nest-${room}-water-old" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:right;">ผลต่าง: <span id="diff-nest-${room}-water">0</span> หน่วย = <span id="calc-nest-${room}-water" style="color:var(--green);font-weight:600;">฿0</span></div>
      </div>
    </div>
  `).join('');

  // Add change listeners to calculate charges (New - Old) × Rate
  nestRooms.forEach(room => {
    const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
    const eNewInput = document.getElementById(`meter-nest-${room}-electric-new`);
    const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);
    const wNewInput = document.getElementById(`meter-nest-${room}-water-new`);
    const eCalc = document.getElementById(`calc-nest-${room}-electric`);
    const wCalc = document.getElementById(`calc-nest-${room}-water`);
    const eDiff = document.getElementById(`diff-nest-${room}-electric`);
    const wDiff = document.getElementById(`diff-nest-${room}-water`);

    const updateElectric = () => {
      const eOld = parseFloat(eOldInput?.value || 0);
      const eNew = parseFloat(eNewInput?.value || 0);
      const rate = parseFloat(document.getElementById('nestElectricRate')?.value || 8);
      const usage = Math.max(0, eNew - eOld);
      const charge = usage * rate;
      eDiff.textContent = usage.toFixed(2);
      eCalc.textContent = `฿${charge.toFixed(2)}`;
    };

    const updateWater = () => {
      const wOld = parseFloat(wOldInput?.value || 0);
      const wNew = parseFloat(wNewInput?.value || 0);
      const rate = parseFloat(document.getElementById('nestWaterRate')?.value || 20);
      const usage = Math.max(0, wNew - wOld);
      const charge = usage * rate;
      wDiff.textContent = usage.toFixed(2);
      wCalc.textContent = `฿${charge.toFixed(2)}`;
    };

    if (eOldInput) eOldInput.addEventListener('input', updateElectric);
    if (eNewInput) eNewInput.addEventListener('input', updateElectric);
    if (wOldInput) wOldInput.addEventListener('input', updateWater);
    if (wNewInput) wNewInput.addEventListener('input', updateWater);
  });
}

// Auto-fill Old readings from METER_DATA (Rooms Building)
// Phase 1c shared helper: per-room meter input grid auto-fill via MeterStore.
// Replaces ~500 lines of duplicated Firebase + METER_DATA fallback logic in
// autoFillOldReadingsNest / autoFillOldReadingsRooms.
async function _autoFillReadingsForGrid(building) {
  const monthInputId = building === 'nest' ? 'nestMeterMonth' : 'roomsMeterMonth';
  const inputPrefix  = building === 'nest' ? 'meter-nest-'    : 'meter-rooms-';
  const monthInputEl = document.getElementById(monthInputId);
  if (!monthInputEl || !monthInputEl.value) return;
  const [year, month] = monthInputEl.value.split('-').map(Number);
  if (!year || !month) return;

  const rooms = (typeof RoomConfigManager !== 'undefined')
    ? RoomConfigManager.getAllRooms(building) : [];
  if (!rooms.length) return;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v == null ? '' : v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  for (const room of rooms) {
    const lookupId = (building === 'nest' && room === 'AMAZON') ? 'ร้านใหญ่' : room;
    let d = await MeterStore.get(building, year, month, lookupId);
    let usePrev = false;
    if (!d) {
      d = await MeterStore.getPrev(building, year, month, lookupId);
      usePrev = !!d;
    }
    const eOldId = `${inputPrefix}${room}-electric-old`;
    const wOldId = `${inputPrefix}${room}-water-old`;
    const eNewId = `${inputPrefix}${room}-electric-new`;
    const wNewId = `${inputPrefix}${room}-water-new`;
    if (!d) {
      setVal(eOldId, '-'); setVal(wOldId, '-');
      setVal(eNewId, '-'); setVal(wNewId, '-');
      continue;
    }
    if (usePrev) {
      // Previous month found — use its eNew/wNew as current month's eOld/wOld
      setVal(eOldId, d.eNew);
      setVal(wOldId, d.wNew);
      setVal(eNewId, '');
      setVal(wNewId, '');
    } else {
      setVal(eOldId, d.eOld);
      setVal(wOldId, d.wOld);
      setVal(eNewId, d.eNew);
      setVal(wNewId, d.wNew);
    }
  }
}

async function autoFillOldReadingsRooms() {
  return _autoFillReadingsForGrid('rooms');
}


function renderRoomsMeterGrid() {
  const gridEl = document.getElementById('roomsMeterGrid');
  if (!gridEl) return;

  // Load rooms from RoomConfigManager (dynamic instead of hardcoded)
  const rooms_grid_list = RoomConfigManager.getAllRooms('rooms');

  gridEl.innerHTML = rooms_grid_list.map(room => `
    <div style="background:#f9f9f9;border:1px solid #ddd;border-radius:8px;padding:1rem;">
      <div style="font-weight:600;margin-bottom:0.8rem;color:var(--text);">🏠 ${room}</div>

      <!-- Electric Reading -->
      <div style="margin-bottom:0.8rem;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">⚡ ค่าไฟ (kWh)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.3rem;">
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">ล่าสุด</small>
            <input type="number" id="meter-rooms-${room}-electric-new" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">เดิม</small>
            <input type="number" id="meter-rooms-${room}-electric-old" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:right;">ผลต่าง: <span id="diff-rooms-${room}-electric">0</span> หน่วย = <span id="calc-rooms-${room}-electric" style="color:var(--green);font-weight:600;">฿0</span></div>
      </div>

      <!-- Water Reading -->
      <div style="margin-bottom:0.8rem;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:0.2rem;">💧 น้ำ (m³)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.3rem;">
          <div> 
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">ล่าสุด</small>
            <input type="number" id="meter-rooms-${room}-water-new" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
          <div>
            <small style="color:var(--text-muted);display:block;margin-bottom:0.2rem;">เดิม</small>
            <input type="number" id="meter-rooms-${room}-water-old" placeholder="0" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-size:0.85rem;">
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);text-align:right;">ผลต่าง: <span id="diff-rooms-${room}-water">0</span> หน่วย = <span id="calc-rooms-${room}-water" style="color:var(--green);font-weight:600;">฿0</span></div>
      </div>
    </div>
  `).join('');

  // Add change listeners to calculate charges (New - Old) × Rate
  rooms_grid_list.forEach(room => {
    const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
    const eNewInput = document.getElementById(`meter-rooms-${room}-electric-new`);
    const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);
    const wNewInput = document.getElementById(`meter-rooms-${room}-water-new`);
    const eCalc = document.getElementById(`calc-rooms-${room}-electric`);
    const wCalc = document.getElementById(`calc-rooms-${room}-water`);
    const eDiff = document.getElementById(`diff-rooms-${room}-electric`);
    const wDiff = document.getElementById(`diff-rooms-${room}-water`);

    const updateElectric = () => {
      const eOld = parseFloat(eOldInput?.value || 0);
      const eNew = parseFloat(eNewInput?.value || 0);
      // Use per-room rate from RoomConfigManager
      const rate = RoomConfigManager.getRoomRate('rooms', room, 'electric');
      const usage = Math.max(0, eNew - eOld);
      const charge = usage * rate;
      eDiff.textContent = usage.toFixed(2);
      eCalc.textContent = `฿${charge.toFixed(2)}`;
    };

    const updateWater = () => {
      const wOld = parseFloat(wOldInput?.value || 0);
      const wNew = parseFloat(wNewInput?.value || 0);
      // Use per-room rate from RoomConfigManager
      const rate = RoomConfigManager.getRoomRate('rooms', room, 'water');
      const usage = Math.max(0, wNew - wOld);
      const charge = usage * rate;
      wDiff.textContent = usage.toFixed(2);
      wCalc.textContent = `฿${charge.toFixed(2)}`;
    };

    if (eOldInput) eOldInput.addEventListener('input', updateElectric);
    if (eNewInput) eNewInput.addEventListener('input', updateElectric);
    if (wOldInput) wOldInput.addEventListener('input', updateWater);
    if (wNewInput) wNewInput.addEventListener('input', updateWater);
  });
}

// Meter Form Handler Functions

// Meter manual save/load/export functions removed (Phase 1a cleanup 2026-04-19):
// loadPreviousMonth*, save*MeterReadings, export*MeterCSV were orphan dead code
// reading/writing localStorage.METER_READINGS_NEST/ROOMS which initMeterPage()
// explicitly clears on every load. No UI button called them. Active flow uses
// Firestore meter_data via MeterDataManager (meter-unified.js) — single source.


