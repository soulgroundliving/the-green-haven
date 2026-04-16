// Use CONFIG from config-unified.js instead (with fallback if not loaded yet)
const MONTHS_TH = (window.CONFIG?.months?.short) || ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = (window.CONFIG?.months?.full) || ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// window.ROOMS_OLD and window.ROOMS_NEW are now defined in shared-config.js
// Use window.CONFIG.rooms_old and window.CONFIG.rooms_new instead

// Hardcoded data removed - use only Firebase and HISTORICAL_DATA
// All billing data must be imported through the billing import tool
const DATA = {};

// ===== NAV =====
window._showPageImpl = function(page,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if(btn)btn.classList.add('active');
  window.scrollTo(0,0);
  // Close sidebar on mobile after navigation
  if(window.innerWidth <= 600){
    window._closeSidebarImpl();
  }
  if(page==='dashboard'){setTimeout(initDashboardCharts,100);updateDashboardLive();syncDashboardYearUI();}
  if(page==='tenant')initTenantPage();
  if(page==='expense')initExpensePage();
  if(page==='requests-approvals'){
    // Default to Maintenance tab on first load
    setTimeout(()=>switchRequestsTab('maintenance',document.getElementById('tab-maintenance-btn')),80);
  }
  if(page==='announcements')initAnnouncementsPage();
  if(page==='tenant-portal')initTenantPortal();
  if(page==='payment-verify')initPaymentVerify();
  if(page==='analytics')initAnalyticsPage();
  if(page==='contract')initContractPage();
  if(page==='meter')initMeterPage();
  if(page==='owner-info')initOwnerInfoPage();
  if(page==='tenant-master')initTenantMasterPage();
  if(page==='lease-agreements')initLeaseAgreementsPage();
  if(page==='gamification')initGamificationPage();
};
// Assign to global scope after definition
window.showPage = window._showPageImpl;

// Meter Tab Switching Function
window._switchMeterTabImpl = function(tabName, btnElement) {
  // Hide all tabs
  document.querySelectorAll('.meter-tab-content').forEach(el => el.style.display = 'none');

  // Remove active state from all buttons
  document.querySelectorAll('.meter-tab').forEach(btn => btn.classList.remove('active'));

  // Show selected tab
  const contentEl = document.getElementById('meter-' + tabName + '-content');
  const resolvedBtn = btnElement || document.getElementById('tab-' + tabName + '-btn');
  if (contentEl) {
    contentEl.style.display = 'block';
    if (resolvedBtn) resolvedBtn.classList.add('active');
  }

  // Initialize meter page content if needed
  if (tabName === 'nest') {
    initMeterNestTab();
  } else if (tabName === 'rooms') {
    initMeterRoomsTab();
  } else if (tabName === 'room-config') {
    // Initialize room config tab
    const dropdown = document.getElementById('roomConfigBuilding');
    if (dropdown && !dropdown.value) {
      dropdown.value = 'rooms'; // Set default
    }
    // Small delay to ensure DOM is ready
    setTimeout(() => loadRoomConfigUI(), 50);
  } else if (tabName === 'import-meter') {
    initImportMeterTab();
  } else if (tabName === 'monthly-status') {
    // Render meter status table + set sensible defaults
    setTimeout(() => {
      const now = new Date();
      const mm = document.getElementById('mt-month');
      const my = document.getElementById('mt-year');
      const vm = document.getElementById('vc-month');
      const vy = document.getElementById('vc-year');
      if (mm && !mm.value) mm.value = now.getMonth() + 1;
      if (my && !my.value) my.value = now.getFullYear() + 543;
      if (vm && !vm.value) vm.value = now.getMonth() + 1;
      if (vy && !vy.value) vy.value = now.getFullYear() + 543;
      if (typeof renderMeterTable === 'function') renderMeterTable();
    }, 50);
  }
};
// Assign to global scope
window.switchMeterTab = window._switchMeterTabImpl;

window.switchPropertyTab = function(tab, el) {
  // Hide all sections
  const roomsSection = document.getElementById('property-rooms-section');
  const nestSection = document.getElementById('property-nest-section');

  if (roomsSection) roomsSection.style.display = 'none';
  if (nestSection) nestSection.style.display = 'none';

  // Remove active state from all tabs
  document.querySelectorAll('.property-tab').forEach(btn => {
    btn.style.color = '#999';
    btn.style.borderBottom = '3px solid transparent';
  });

  // Show selected section and set active tab
  if (tab === 'rooms') {
    if (roomsSection) roomsSection.style.display = 'block';
    if (el) {
      el.style.color = '#2d8653';
      el.style.borderBottom = '3px solid #2d8653';
    }
    // Initialize rooms page if needed
    if (typeof initRoomsPage === 'function') {
      initRoomsPage();
    }
  } else if (tab === 'nest') {
    if (nestSection) nestSection.style.display = 'block';
    if (el) {
      el.style.color = '#2d8653';
      el.style.borderBottom = '3px solid #2d8653';
    }
    // Initialize nest page if needed
    if (typeof initNestPage === 'function') {
      initNestPage();
    }
  }
};

// Keep old function name for backward compatibility
window.switchBuildingTab = window.switchPropertyTab;

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
      const meterData = {
        eNew: parseFloat(row[1]) || 0,
        eOld: parseFloat(row[6]) || 0,
        wNew: parseFloat(row[2]) || 0,
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
      eNew: parseFloat(row[1]) || 0,  // Column B: Electricity New
      eOld: parseFloat(row[6]) || 0,  // Column G: Electricity Old
      wNew: parseFloat(row[2]) || 0,  // Column C: Water New
      wOld: parseFloat(row[12]) || 0  // Column M: Water Old
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
    // Clear old test data to ensure we use actual Excel data
    localStorage.removeItem('METER_READINGS_NEST');
    localStorage.removeItem('METER_READINGS_ROOMS');
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
async function autoFillOldReadingsNest() {
  const monthInputEl = document.getElementById('nestMeterMonth');
  if (!monthInputEl || !monthInputEl.value) {
    console.log('⚠️ Month input field not found or empty');
    return;
  }

  const monthInput = monthInputEl.value;
  const [year, month] = monthInput.split('-').map(Number);
  if (!year || !month) {
    console.log('⚠️ Invalid month format:', monthInput);
    return;
  }

  // Try to load from Firebase first
  console.log(`🔄 Loading meter data from Firebase for Nest ${monthInput}...`);
  const nestRooms = RoomConfigManager.getAllRooms('nest');

  try {
    const fb = window.firebase;
    if (fb && fb.firestore) {
      const firestore = fb.firestore();
      const fs = fb.firestoreFunctions;
      const buddhistYear = year + 543;
      const yy = buddhistYear % 100;

      // Try to load current month data from Firebase
      let foundData = false;
      for (const room of nestRooms) {
        const docId = `nest_${yy}_${month}_${room}`;
        try {
          const docRef = fs.doc(fs.collection(firestore, 'meter_data'), docId);
          const docSnapshot = await fs.getDoc(docRef);
          if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
            const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);
            const eNewInput = document.getElementById(`meter-nest-${room}-electric-new`);
            const wNewInput = document.getElementById(`meter-nest-${room}-water-new`);

            if (eNewInput && data.eNew !== null && data.eNew !== undefined) {
              eNewInput.value = data.eNew;
              eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (wNewInput && data.wNew !== null && data.wNew !== undefined) {
              wNewInput.value = data.wNew;
              wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (eOldInput && data.eOld !== null && data.eOld !== undefined) {
              eOldInput.value = data.eOld;
              eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (wOldInput && data.wOld !== null && data.wOld !== undefined) {
              wOldInput.value = data.wOld;
              wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            foundData = true;
            console.log(`✅ Loaded Firebase data for room ${room}`);
          }
        } catch (err) {
          console.log(`⚠️ No Firebase data for ${room}: ${err.message}`);
        }
      }

      if (foundData) {
        console.log('✅ Loaded data from Firebase successfully');
        return;
      }
    }
  } catch (firebaseErr) {
    console.log('⚠️ Firebase loading failed:', firebaseErr.message);
  }

  // Fallback to METER_DATA if Firebase fails
  if (typeof METER_DATA === 'undefined') {
    console.log('⚠️ METER_DATA not available');
    return;
  }

  const buddhistYear = year + 543;
  const yy = buddhistYear % 100;
  const key = `${yy}_${month}`;

  console.log(`📊 Fallback: Looking up METER_DATA['nest'][${key}]...`);
  // Read from building-namespaced METER_DATA (METER_DATA.nest.{key})
  let monthData = METER_DATA['nest'] && METER_DATA['nest'][key];

  if (!monthData) {
    console.log(`⚠️ No data for ${key}, trying previous month as fallback...`);
    // For unrecorded months, try to get previous month's data
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevBuddhistYear = prevYear + 543;
    const prevYy = prevBuddhistYear % 100;
    const prevKey = `${prevYy}_${prevMonth}`;

    // Read from building-namespaced structure
    const prevMonthData = METER_DATA['nest'] && METER_DATA['nest'][prevKey];
    if (prevMonthData) {
      console.log(`📊 Found previous month data ${prevKey}, using eNew/wNew as old readings for current month...`);
      // Use previous month's NEW readings as current month's OLD readings
      nestRooms.forEach(room => {
        const lookupId = room === 'AMAZON' ? 'ร้านใหญ่' : room;
        const prevD = prevMonthData[lookupId];

        const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
        const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);
        const eNewInput = document.getElementById(`meter-nest-${room}-electric-new`);
        const wNewInput = document.getElementById(`meter-nest-${room}-water-new`);

        if (prevD) {
          // Set old readings from previous month's new readings
          if (prevD.eNew !== null && prevD.eNew !== undefined && eOldInput) {
            eOldInput.value = prevD.eNew;
            eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (prevD.wNew !== null && prevD.wNew !== undefined && wOldInput) {
            wOldInput.value = prevD.wNew;
            wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Clear new readings field (not recorded yet)
          if (eNewInput) {
            eNewInput.value = '';
            eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wNewInput) {
            wNewInput.value = '';
            wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          // No previous month data either, show "-"
          if (eOldInput) {
            eOldInput.value = '-';
            eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wOldInput) {
            wOldInput.value = '-';
            wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (eNewInput) {
            eNewInput.value = '-';
            eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wNewInput) {
            wNewInput.value = '-';
            wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });
      return;
    } else {
      // No previous month data found either, show "-" for all
      nestRooms.forEach(room => {
        const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
        const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);
        const eNewInput = document.getElementById(`meter-nest-${room}-electric-new`);
        const wNewInput = document.getElementById(`meter-nest-${room}-water-new`);
        if (eOldInput) eOldInput.value = '-';
        if (wOldInput) wOldInput.value = '-';
        if (eNewInput) eNewInput.value = '-';
        if (wNewInput) wNewInput.value = '-';
      });
      return;
    }
  }

  // If current month has data, use it
  nestRooms.forEach(room => {
    const lookupId = room === 'AMAZON' ? 'ร้านใหญ่' : room;
    const d = monthData[lookupId];

    const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
    const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);
    const eNewInput = document.getElementById(`meter-nest-${room}-electric-new`);
    const wNewInput = document.getElementById(`meter-nest-${room}-water-new`);

    if (d) {
      if (d.eNew !== null && d.eNew !== undefined && eNewInput) {
        eNewInput.value = d.eNew;
        eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (d.eOld !== null && d.eOld !== undefined && eOldInput) {
        eOldInput.value = d.eOld;
        eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (d.wNew !== null && d.wNew !== undefined && wNewInput) {
        wNewInput.value = d.wNew;
        wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (d.wOld !== null && d.wOld !== undefined && wOldInput) {
        wOldInput.value = d.wOld;
        wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      // No data for this room
      if (eOldInput) eOldInput.value = '-';
      if (wOldInput) wOldInput.value = '-';
      if (eNewInput) eNewInput.value = '-';
      if (wNewInput) wNewInput.value = '-';
    }
  });
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
async function autoFillOldReadingsRooms() {
  const monthInputEl = document.getElementById('roomsMeterMonth');
  if (!monthInputEl || !monthInputEl.value) {
    console.log('⚠️ Month input field not found or empty');
    return;
  }

  const monthInput = monthInputEl.value;
  const [year, month] = monthInput.split('-').map(Number);
  if (!year || !month) {
    console.log('⚠️ Invalid month format:', monthInput);
    return;
  }

  // Try to load from Firebase first
  console.log(`🔄 Loading meter data from Firebase for ${monthInput}...`);
  const roomsRooms = RoomConfigManager.getAllRooms('rooms');

  try {
    const fb = window.firebase;
    if (fb && fb.firestore) {
      const firestore = fb.firestore();
      const fs = fb.firestoreFunctions;
      const buddhistYear = year + 543;
      const yy = buddhistYear % 100;

      // Try to load current month data from Firebase
      let foundData = false;
      for (const room of roomsRooms) {
        const docId = `rooms_${yy}_${month}_${room}`;
        try {
          const docRef = fs.doc(fs.collection(firestore, 'meter_data'), docId);
          const docSnapshot = await fs.getDoc(docRef);
          if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
            const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);
            const eNewInput = document.getElementById(`meter-rooms-${room}-electric-new`);
            const wNewInput = document.getElementById(`meter-rooms-${room}-water-new`);

            if (eNewInput && data.eNew !== null && data.eNew !== undefined) {
              eNewInput.value = data.eNew;
              eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (wNewInput && data.wNew !== null && data.wNew !== undefined) {
              wNewInput.value = data.wNew;
              wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (eOldInput && data.eOld !== null && data.eOld !== undefined) {
              eOldInput.value = data.eOld;
              eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (wOldInput && data.wOld !== null && data.wOld !== undefined) {
              wOldInput.value = data.wOld;
              wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            foundData = true;
            console.log(`✅ Loaded Firebase data for room ${room}`);
          }
        } catch (err) {
          console.log(`⚠️ No Firebase data for ${room}: ${err.message}`);
        }
      }

      if (foundData) {
        console.log('✅ Loaded data from Firebase successfully');
        return;
      }
    }
  } catch (firebaseErr) {
    console.log('⚠️ Firebase loading failed:', firebaseErr.message);
  }

  // Fallback to METER_DATA if Firebase fails
  if (typeof METER_DATA === 'undefined') {
    console.log('⚠️ METER_DATA not available');
    return;
  }

  // monthInputEl already defined above, just verify it's still valid
  if (!monthInputEl || !monthInputEl.value) {
    console.log('⚠️ Month input field not found or empty');
    return;
  }

  // monthInput and year/month already parsed above, use them directly

  // Convert Gregorian year to Buddhist year (2-digit), then to 2-digit year
  // 2026 (Gregorian) = 2569 (Buddhist) = 69 (2-digit)
  const buddhistYear = year + 543;
  const yy = buddhistYear % 100;
  const key = `${yy}_${month}`;

  console.log(`📊 Looking up METER_DATA['rooms'][${key}] for ${monthInput}...`);
  // Read from building-namespaced METER_DATA (METER_DATA.rooms.{key})
  let monthData = METER_DATA['rooms'] && METER_DATA['rooms'][key];
  // roomsRooms already declared above, reuse it
  let loadCount = 0;

  if (!monthData) {
    console.log(`⚠️ No data for ${key}, trying previous month as fallback...`);
    // For unrecorded months, try to get previous month's data
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevBuddhistYear = prevYear + 543;
    const prevYy = prevBuddhistYear % 100;
    const prevKey = `${prevYy}_${prevMonth}`;

    // Read from building-namespaced structure
    const prevMonthData = METER_DATA['rooms'] && METER_DATA['rooms'][prevKey];
    if (prevMonthData) {
      console.log(`📊 Found previous month data ${prevKey}, using eNew/wNew as old readings for current month...`);
      // Use previous month's NEW readings as current month's OLD readings
      roomsRooms.forEach(room => {
        const lookupId = room === 'AMAZON' ? 'ร้านใหญ่' : room;
        const prevD = prevMonthData[lookupId];

        const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
        const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);
        const eNewInput = document.getElementById(`meter-rooms-${room}-electric-new`);
        const wNewInput = document.getElementById(`meter-rooms-${room}-water-new`);

        if (prevD) {
          // Set old readings from previous month's new readings
          // For unrecorded months (e.g., April): place March's ending values in the right field (เดิม/old)
          if (prevD.eNew !== null && prevD.eNew !== undefined && eOldInput) {
            eOldInput.value = prevD.eNew;
            eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (prevD.wNew !== null && prevD.wNew !== undefined && wOldInput) {
            wOldInput.value = prevD.wNew;
            wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Clear new readings field (not recorded yet)
          if (eNewInput) {
            eNewInput.value = '';
            eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wNewInput) {
            wNewInput.value = '';
            wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          // No previous month data either, show "-"
          if (eOldInput) {
            eOldInput.value = '-';
            eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wOldInput) {
            wOldInput.value = '-';
            wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (eNewInput) {
            eNewInput.value = '-';
            eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (wNewInput) {
            wNewInput.value = '-';
            wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });
      return;
    } else {
      // No current or previous month data, show "-"
      console.log(`⚠️ No data for previous month ${prevKey} either, showing "-"...`);
      roomsRooms.forEach(room => {
        const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
        const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);
        const eNewInput = document.getElementById(`meter-rooms-${room}-electric-new`);
        const wNewInput = document.getElementById(`meter-rooms-${room}-water-new`);
        if (eOldInput) {
          eOldInput.value = '-';
          eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (wOldInput) {
          wOldInput.value = '-';
          wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (eNewInput) {
          eNewInput.value = '-';
          eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (wNewInput) {
          wNewInput.value = '-';
          wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      return;
    }
  }

  // Load data from METER_DATA
  roomsRooms.forEach(room => {
    // Map room names to METER_DATA keys
    const lookupId = room === 'AMAZON' ? 'ร้านใหญ่' : room;
    const d = monthData[lookupId];

    const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
    const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);
    const eNewInput = document.getElementById(`meter-rooms-${room}-electric-new`);
    const wNewInput = document.getElementById(`meter-rooms-${room}-water-new`);

    if (d) {
      // For recorded months: eOld/wOld in the "เดิม" (old) input fields, eNew/wNew in "ล่าสุด" (new) input fields
      if (d.eOld !== null && d.eOld !== undefined && eOldInput) {
        eOldInput.value = d.eOld;
        eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
        loadCount++;
      }
      if (d.wOld !== null && d.wOld !== undefined && wOldInput) {
        wOldInput.value = d.wOld;
        wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Load current/new readings from METER_DATA in "ล่าสุด" (new) fields
      if (d.eNew !== null && d.eNew !== undefined && eNewInput) {
        eNewInput.value = d.eNew;
        eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (d.wNew !== null && d.wNew !== undefined && wNewInput) {
        wNewInput.value = d.wNew;
        wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      // No data for this room, show "-"
      if (eOldInput) {
        eOldInput.value = '-';
        eOldInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (wOldInput) {
        wOldInput.value = '-';
        wOldInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (eNewInput) {
        eNewInput.value = '-';
        eNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (wNewInput) {
        wNewInput.value = '-';
        wNewInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  console.log(`✅ Loaded old readings for ${loadCount} rooms from METER_DATA[${key}]`);
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

function loadPreviousMonthNest() {
  const currentMonthInput = document.getElementById('nestMeterMonth').value;
  if (!currentMonthInput) {
    showToast('กรุณาเลือกเดือนก่อน', 'warning');
    return;
  }

  // Calculate previous month
  const [year, month] = currentMonthInput.split('-').map(Number);
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  // Get saved meter data
  const allData = JSON.parse(localStorage.getItem('METER_READINGS_NEST') || '[]');
  const prevMonthData = allData.find(d => d.month === prevMonthStr);

  if (!prevMonthData) {
    showToast(`ไม่มีข้อมูลมิเตอร์สำหรับเดือน ${prevMonthStr}`, 'warning');
    return;
  }

  // Load data into form (use previous month's NEW readings as this month's OLD readings)
  const nestRooms = ['N101', 'N102', 'N103', 'N104', 'N105', 'N201', 'N202', 'N203', 'N204', 'N205', 'N301', 'N302', 'N303', 'N304', 'N305', 'N401', 'N402', 'N403', 'N404', 'N405'];
  let loadCount = 0;

  nestRooms.forEach(room => {
    const reading = prevMonthData.readings[room];
    if (reading) {
      // Load as "old reading" using previous month's NEW readings
      const eOldInput = document.getElementById(`meter-nest-${room}-electric-old`);
      const wOldInput = document.getElementById(`meter-nest-${room}-water-old`);

      // Handle both old data format (e, w) and new format (eOld, eNew, wOld, wNew)
      if (reading.eNew !== undefined) {
        // New format: use eNew as old reading for current month
        if (eOldInput) eOldInput.value = reading.eNew;
        if (wOldInput) wOldInput.value = reading.wNew;
      } else {
        // Old format: use e and w as old reading
        if (eOldInput) eOldInput.value = reading.e || 0;
        if (wOldInput) wOldInput.value = reading.w || 0;
      }

      // Trigger calculation updates
      if (eOldInput) eOldInput.dispatchEvent(new Event('input'));
      if (wOldInput) wOldInput.dispatchEvent(new Event('input'));
      loadCount++;
    }
  });

  showToast(`โหลดข้อมูลเดือน ${prevMonthStr} เป็นค่าเดิม (${loadCount} ห้อง)`, 'success');
}

function loadPreviousMonthRooms() {
  const currentMonthInput = document.getElementById('roomsMeterMonth').value;
  if (!currentMonthInput) {
    showToast('กรุณาเลือกเดือนก่อน', 'warning');
    return;
  }

  // Calculate previous month
  const [year, month] = currentMonthInput.split('-').map(Number);
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  // Get saved meter data
  const allData = JSON.parse(localStorage.getItem('METER_READINGS_ROOMS') || '[]');
  const prevMonthData = allData.find(d => d.month === prevMonthStr);

  if (!prevMonthData) {
    showToast(`ไม่มีข้อมูลมิเตอร์สำหรับเดือน ${prevMonthStr}`, 'warning');
    return;
  }

  // Load data into form (use previous month's NEW readings as this month's OLD readings)
  const previous_rooms_list = RoomConfigManager.getAllRooms('rooms');
  let loadCount = 0;

  previous_rooms_list.forEach(room => {
    const reading = prevMonthData.readings[room];
    if (reading) {
      // Load as "old reading" using previous month's NEW readings
      const eOldInput = document.getElementById(`meter-rooms-${room}-electric-old`);
      const wOldInput = document.getElementById(`meter-rooms-${room}-water-old`);

      // Handle both old data format (e, w) and new format (eOld, eNew, wOld, wNew)
      if (reading.eNew !== undefined) {
        // New format: use eNew as old reading for current month
        if (eOldInput) eOldInput.value = reading.eNew;
        if (wOldInput) wOldInput.value = reading.wNew;
      } else {
        // Old format: use e and w as old reading
        if (eOldInput) eOldInput.value = reading.e || 0;
        if (wOldInput) wOldInput.value = reading.w || 0;
      }

      // Trigger calculation updates
      if (eOldInput) eOldInput.dispatchEvent(new Event('input'));
      if (wOldInput) wOldInput.dispatchEvent(new Event('input'));
      loadCount++;
    }
  });

  showToast(`โหลดข้อมูลเดือน ${prevMonthStr} เป็นค่าเดิม (${loadCount} ห้อง)`, 'success');
}

function saveNestMeterReadings() {
  const month = document.getElementById('nestMeterMonth').value;
  if (!month) {
    showToast('กรุณาเลือกเดือน', 'warning');
    return;
  }

  const readings = {};
  const nestRooms = ['N101', 'N102', 'N103', 'N104', 'N105', 'N201', 'N202', 'N203', 'N204', 'N205', 'N301', 'N302', 'N303', 'N304', 'N305', 'N401', 'N402', 'N403', 'N404', 'N405'];

  nestRooms.forEach(room => {
    const eOld = parseFloat(document.getElementById(`meter-nest-${room}-electric-old`)?.value || 0);
    const eNew = parseFloat(document.getElementById(`meter-nest-${room}-electric-new`)?.value || 0);
    const wOld = parseFloat(document.getElementById(`meter-nest-${room}-water-old`)?.value || 0);
    const wNew = parseFloat(document.getElementById(`meter-nest-${room}-water-new`)?.value || 0);
    if (eNew > 0 || wNew > 0) {
      readings[room] = { eOld, eNew, wOld, wNew };
    }
  });

  const data = {
    month,
    readings,
    timestamp: new Date().toISOString()
  };

  let allData = JSON.parse(localStorage.getItem('METER_READINGS_NEST') || '[]');
  allData.push(data);
  localStorage.setItem('METER_READINGS_NEST', JSON.stringify(allData));

  showToast(`บันทึกค่ามิเตอร์ ${Object.keys(readings).length} ห้อง เรียบร้อย`, 'success');
}

function saveRoomsMeterReadings() {
  const month = document.getElementById('roomsMeterMonth').value;
  if (!month) {
    showToast('กรุณาเลือกเดือน', 'warning');
    return;
  }

  const readings = {};
  const save_rooms_list = RoomConfigManager.getAllRooms('rooms');

  save_rooms_list.forEach(room => {
    const eOld = parseFloat(document.getElementById(`meter-rooms-${room}-electric-old`)?.value || 0);
    const eNew = parseFloat(document.getElementById(`meter-rooms-${room}-electric-new`)?.value || 0);
    const wOld = parseFloat(document.getElementById(`meter-rooms-${room}-water-old`)?.value || 0);
    const wNew = parseFloat(document.getElementById(`meter-rooms-${room}-water-new`)?.value || 0);
    if (eNew > 0 || wNew > 0) {
      readings[room] = { eOld, eNew, wOld, wNew };
    }
  });

  const data = {
    month,
    readings,
    timestamp: new Date().toISOString()
  };

  let allData = JSON.parse(localStorage.getItem('METER_READINGS_ROOMS') || '[]');
  allData.push(data);
  localStorage.setItem('METER_READINGS_ROOMS', JSON.stringify(allData));

  showToast(`บันทึกค่ามิเตอร์ ${Object.keys(readings).length} ห้อง เรียบร้อย`, 'success');
}

function exportNestMeterCSV() {
  const month = document.getElementById('nestMeterMonth')?.value;
  if (!month) { showToast('กรุณาเลือกเดือนก่อน', 'warning'); return; }

  const allData = JSON.parse(localStorage.getItem('METER_READINGS_NEST') || '[]');
  const entry = [...allData].reverse().find(d => d.month === month);
  const readings = entry?.readings || {};

  if (Object.keys(readings).length === 0) {
    showToast('ไม่มีข้อมูลมิเตอร์สำหรับเดือนนี้', 'warning');
    return;
  }

  let csv = 'ห้อง,ไฟเก่า,ไฟใหม่,หน่วยไฟ,น้ำเก่า,น้ำใหม่,หน่วยน้ำ\n';
  Object.entries(readings).forEach(([roomId, r]) => {
    const eUsed = Math.max(0, (r.eNew || 0) - (r.eOld || 0));
    const wUsed = Math.max(0, (r.wNew || 0) - (r.wOld || 0));
    csv += `${roomId},${r.eOld || 0},${r.eNew || 0},${eUsed},${r.wOld || 0},${r.wNew || 0},${wUsed}\n`;
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meter-nest-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRoomsMeterCSV() {
  const month = document.getElementById('roomsMeterMonth')?.value;
  if (!month) { showToast('กรุณาเลือกเดือนก่อน', 'warning'); return; }

  const allData = JSON.parse(localStorage.getItem('METER_READINGS_ROOMS') || '[]');
  const entry = [...allData].reverse().find(d => d.month === month);
  const readings = entry?.readings || {};

  if (Object.keys(readings).length === 0) {
    showToast('ไม่มีข้อมูลมิเตอร์สำหรับเดือนนี้', 'warning');
    return;
  }

  let csv = 'ห้อง,ไฟเก่า,ไฟใหม่,หน่วยไฟ,น้ำเก่า,น้ำใหม่,หน่วยน้ำ\n';
  Object.entries(readings).forEach(([roomId, r]) => {
    const eUsed = Math.max(0, (r.eNew || 0) - (r.eOld || 0));
    const wUsed = Math.max(0, (r.wNew || 0) - (r.wOld || 0));
    csv += `${roomId},${r.eOld || 0},${r.eNew || 0},${eUsed},${r.wOld || 0},${r.wNew || 0},${wUsed}\n`;
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meter-rooms-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== ROOM CONFIGURATION FUNCTIONS =====
function loadRoomConfigUI() {
  try {
    const dropdown = document.getElementById('roomConfigBuilding');
    if (!dropdown) {
      console.error('❌ roomConfigBuilding dropdown not found');
      return;
    }

    const building = dropdown.value || 'rooms';
    console.log('📋 Loading room config for building:', building);

    if (typeof RoomConfigManager === 'undefined') {
      console.error('❌ RoomConfigManager not loaded');
      return;
    }

    const config = RoomConfigManager.getRoomsConfig(building);
    console.log('📦 Config loaded:', config);

    const tbody = document.getElementById('roomConfigBody');
    if (!tbody) {
      console.error('❌ roomConfigBody tbody not found');
      return;
    }

    tbody.innerHTML = config.rooms
    .filter(room => !room.deleted)
    .map(room => {
      // Get rent: use RoomConfigManager if explicitly set, fallback to metadata, then default
      const metadataArray = building === 'rooms' ? window.ROOMS_OLD : window.NEST_ROOMS;
      // Search using room ID as-is (both window.ROOMS_OLD and window.NEST_ROOMS use the actual IDs)
      const searchId = room.id;
      const metadata = metadataArray.find(m => m.id === searchId);
      // Prefer explicit room.rentPrice from DEFAULT_ROOMS_CONFIG, but only if it was actually saved (not 0 or undefined)
      const rent = (room.rentPrice && room.rentPrice > 0) ? room.rentPrice : (metadata?.rentPrice || 1500);
      const depositId = `deposit_${building}_${room.id}`;
      return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="text" value="${room.name}" onchange="updateRoomField('${building}', '${room.id}', 'name', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
          <div style="font-size:.7rem;color:#bbb;margin-top:3px;">ID: ${room.id}</div>
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${rent}" onchange="updateRentAndDeposit('${building}', '${room.id}', parseInt(this.value), '${depositId}')" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" id="${depositId}" value="${rent * 2}" readonly style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;background:#f5f5f5;color:#666;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.waterRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'water', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.electricRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'electric', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.trashRate || 20}" step="1" onchange="updateTrashRate('${building}', '${room.id}', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;font-size:.85rem;color:var(--text-muted);">${(loadTenants()||{})[room.id]?.name||'—'}</td>
        <td style="border:1px solid var(--border);padding:0.8rem;text-align:center;">
          <button onclick="deleteRoom('${building}', '${room.id}')" style="padding:0.4rem 0.8rem;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:0.85rem;">ลบ</button>
        </td>
      </tr>
    `}).join('');

    populateTemplateSelect(building);
    console.log('✅ Room config UI loaded successfully');
  } catch (error) {
    console.error('❌ Error loading room config UI:', error);
  }
}

function populateTemplateSelect(building) {
  try {
    const config = RoomConfigManager.getRoomsConfig(building);
    const select = document.getElementById('templateRoomSelect');
    if (!select) {
      console.warn('⚠️ templateRoomSelect not found');
      return;
    }
    select.innerHTML = '<option value="">-- เลือกห้อง --</option>' +
      config.rooms
        .filter(room => !room.deleted)
        .map(room => `<option value="${room.id}">${room.id} - ${room.name}</option>`)
        .join('');
  } catch (error) {
    console.error('❌ Error populating template select:', error);
  }
}

function toggleAddMode(mode) {
  document.getElementById('manualEntryMode').style.display = mode === 'manual' ? 'grid' : 'none';
  document.getElementById('copyEntryMode').style.display = mode === 'copy' ? 'grid' : 'none';
}

// Show toast notification
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;

  container.appendChild(toast);

  // Remove after duration
  setTimeout(() => {
    toast.classList.add('remove');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Shop room: id='ร้านใหญ่' (stable internal ID, same in RoomConfigManager & METER_DATA)
// Display name (room.name) is editable via ⚙️ config table → "ชื่อห้อง" column

function refreshPropertyPageIfActive() {
  // Property page removed — refresh tenant page if active
  const tenantPage = document.getElementById('page-tenant');
  if (tenantPage && tenantPage.classList.contains('active')) {
    if (tenantBuilding === 'old') { initRoomsPage(); } else { initNestPage(); }
  }
  updateShopInfoCard();
  updateRoomsInfoCards();
}

function updateDepositDisplay() {
  const rentInput = document.getElementById('newRoomRent');
  const depositInput = document.getElementById('newRoomDeposit');
  if (rentInput && depositInput) {
    const rent = parseInt(rentInput.value) || 1500;
    depositInput.value = rent * 2;
  }
}

function updateRentAndDeposit(building, roomId, newRent, depositId) {
  // Update deposit field immediately (real-time)
  const depositInput = document.getElementById(depositId);
  if (depositInput) {
    depositInput.value = newRent * 2;
  }
  // Save the rent change to database
  updateRoomField(building, roomId, 'rentPrice', newRent);
}

function updateRoomField(building, roomId, fieldName, value) {
  const config = RoomConfigManager.getRoomsConfig(building);
  const room = config.rooms.find(r => r.id === roomId);
  if (room) {
    room[fieldName] = value;
    RoomConfigManager.saveRoomsConfig(building, config);

    const fieldLabel = {
      'name': 'ชื่อห้อง',
      'rent': 'ราคาเช่า',
      'rentPrice': 'ราคาเช่า',
      'waterRate': 'อัตราน้ำ',
      'electricRate': 'อัตราไฟ'
    }[fieldName] || fieldName;

    showToast(`✅ บันทึก${fieldLabel}สำหรับห้อง ${roomId} เรียบร้อย`, 'success', 2500);
    console.log(`✅ อัปเดต ${fieldName} สำหรับ ${roomId}`);
    refreshPropertyPageIfActive();
  }
}

function updateRoomRate(building, roomId, rateType, rate) {
  RoomConfigManager.updateRoomRate(building, roomId, rateType, parseFloat(rate));

  const rateLabel = rateType === 'water' ? 'อัตราน้ำ' : 'อัตราไฟฟ้า';
  showToast(`✅ บันทึก${rateLabel}สำหรับห้อง ${roomId} = ${rate} บาท/หน่วย`, 'success', 2500);
  console.log(`✅ อัปเดตอัตรา ${rateType === 'water' ? 'น้ำ' : 'ไฟ'} สำหรับ ${roomId} = ${rate} บาท/หน่วย`);
  refreshPropertyPageIfActive();
}

function updateTrashRate(building, roomId, rate) {
  RoomConfigManager.updateTrashRate(building, roomId, parseInt(rate));

  showToast(`✅ บันทึกค่าขยะสำหรับห้อง ${roomId} = ${rate} บาท`, 'success', 2500);
  console.log(`✅ อัปเดตค่าขยะสำหรับ ${roomId} = ${rate} บาท`);
  refreshPropertyPageIfActive();
}

function addNewRoom() {
  const building = document.getElementById('roomConfigBuilding').value;
  const mode = document.querySelector('input[name="addMode"]:checked').value;

  let roomId, roomName, rent, waterRate, electricRate;

  if (mode === 'manual') {
    roomId = document.getElementById('newRoomId').value.trim();
    roomName = document.getElementById('newRoomName').value.trim();
    rent = parseInt(document.getElementById('newRoomRent').value) || 1500;
    waterRate = parseFloat(document.getElementById('newRoomWater').value);
    electricRate = parseFloat(document.getElementById('newRoomElectric').value);

    if (!roomId || !roomName) {
      showToast('กรุณากรอก ID และชื่อห้อง', 'warning');
      return;
    }
  } else {
    const templateId = document.getElementById('templateRoomSelect').value;
    roomId = document.getElementById('newRoomIdCopy').value.trim();
    roomName = document.getElementById('newRoomNameCopy').value.trim();
    rent = parseInt(document.getElementById('newRoomRentCopy').value) || 1500;

    if (!templateId || !roomId || !roomName) {
      showToast('กรุณาเลือก template และป้อน ID กับชื่อห้อง', 'warning');
      return;
    }

    const template = RoomConfigManager.getRoom(building, templateId);
    waterRate = template.waterRate;
    electricRate = template.electricRate;
  }

  const success = RoomConfigManager.addRoom(building, {
    id: roomId,
    name: roomName,
    rent: rent,
    waterRate: waterRate,
    electricRate: electricRate,
    deleted: false
  });

  if (success) {
    showToast(`เพิ่มห้อง ${roomId} สำเร็จ`, 'success');
    document.getElementById('newRoomId').value = '';
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomRent').value = '1500';
    document.getElementById('newRoomIdCopy').value = '';
    document.getElementById('newRoomNameCopy').value = '';
    document.getElementById('newRoomRentCopy').value = '1500';
    document.getElementById('templateRoomSelect').value = '';
    loadRoomConfigUI();
    initMeterRoomsTab();
  } else {
    showToast(`ห้อง ${roomId} มีอยู่แล้ว`, 'warning');
  }
}

function deleteRoom(building, roomId) {
  if (confirm(`คุณแน่ใจหรือว่าต้องการลบห้อง ${roomId}? (เก็บข้อมูลมิเตอร์ไว้)`)) {
    const config = RoomConfigManager.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room.deleted = true;
      RoomConfigManager.saveRoomsConfig(building, config);
      showToast(`ลบห้อง ${roomId} เรียบร้อย (ข้อมูลมิเตอร์ยังเก็บไว้)`, 'success');
      loadRoomConfigUI();
      initMeterRoomsTab();
    }
  }
}

// Dashboard Tab Switching Function
function switchDashboardTab(tabName, btn) {
  // Hide all tabs
  document.querySelectorAll('.dashboard-tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active class and inline styles from all buttons
  document.querySelectorAll('.dashboard-tab').forEach(button => {
    button.classList.remove('active');
    button.style.color = '';
  });

  // Show selected tab
  const tabElement = document.getElementById('dashboard-' + tabName + '-tab');
  if(tabElement) {
    tabElement.classList.add('active');
  }

  // Add active class and styles to button
  if(btn) {
    btn.classList.add('active');
    btn.style.color = 'var(--green)';
  }

  // Initialize charts if analytics tab
  if(tabName === 'analytics') {
    setTimeout(() => {
      if(typeof initDashboardAnalyticsCharts === 'function') {
        initDashboardAnalyticsCharts();
      }
    }, 100);
  }
}

// ===== CONTENT MANAGEMENT TAB SWITCHING =====
function switchContentTab(tabName, btn) {
  // Hide all content tabs
  document.querySelectorAll('.content-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.content-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Show selected tab
  const tabElement = document.getElementById('content-tab-' + tabName);
  const resolvedBtn = btn || document.getElementById('tab-' + tabName + '-btn');
  if(tabElement) {
    tabElement.style.display = 'block';
    if(resolvedBtn) resolvedBtn.classList.add('active');
    // Lazy-init tab content
    if(tabName === 'announcements') initAnnouncementsPage();
    else if(tabName === 'events' && typeof initCommunityEventsPage === 'function') initCommunityEventsPage();
    else if(tabName === 'docs' && typeof initCommunityDocsPage === 'function') initCommunityDocsPage();
  }
}

// ===== REQUESTS & APPROVALS TAB SWITCHING =====
function switchRequestsTab(tabName, btn) {
  // Hide all requests tabs
  document.querySelectorAll('.requests-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.requests-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Hide all tab content
  document.querySelectorAll('.requests-mgmt-content').forEach(tab => tab.style.display = 'none');

  // Show selected tab
  const tabElement = document.getElementById('requests-tab-' + tabName);
  if(tabElement) {
    tabElement.style.display = 'block';
    if(btn) btn.classList.add('active');
    // Initialize content for each tab
    if(tabName === 'maintenance') initMaintenancePage();
    else if(tabName === 'housekeeping') initHousekeepingPage();
    else if(tabName === 'complaints' && typeof initComplaintsPage === 'function') initComplaintsPage();
    else if(tabName === 'pets' && typeof initPetApprovalsPage === 'function') initPetApprovalsPage();
  }
}

// ===== PEOPLE MANAGEMENT TAB SWITCHING =====
function switchPeopleTab(tabName, btn) {
  // Hide all people tabs
  document.querySelectorAll('.people-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.people-mgmt-tab').forEach(button => {
    button.style.color = '#999';
    button.style.borderBottomColor = 'transparent';
  });

  // Show selected tab
  const tabElement = document.getElementById('people-tab-' + tabName);
  if(tabElement) {
    tabElement.style.display = 'block';
  }

  // Highlight active button
  if(btn) {
    btn.style.color = 'var(--green)';
    btn.style.borderBottomColor = 'var(--green)';
  }
}

// ===== LEASE MANAGEMENT TAB SWITCHING =====
function switchLeaseTab(tabName, btn) {
  // Hide all lease tabs
  document.querySelectorAll('.lease-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.lease-mgmt-tab').forEach(button => {
    button.style.color = '#999';
    button.style.borderBottomColor = 'transparent';
  });

  // Show selected tab
  const tabElement = document.getElementById('lease-tab-' + tabName);
  if(tabElement) {
    tabElement.style.display = 'block';
  }

  // Highlight active button
  if(btn) {
    btn.style.color = 'var(--green)';
    btn.style.borderBottomColor = 'var(--green)';
  }
}

// ===== SIDEBAR FUNCTIONS =====
function toggleSidebar(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  sidebar.classList.toggle('visible');
  hamburger.classList.toggle('active');
}

window._closeSidebarImpl = function(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  sidebar.classList.remove('visible');
  hamburger.classList.remove('active');
};
// Assign to global scope
window.closeSidebar = window._closeSidebarImpl;

// Close sidebar when clicking outside
document.addEventListener('click',function(e){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  if(!sidebar.contains(e.target) && !hamburger.contains(e.target) && window.innerWidth <= 600){
    window.closeSidebar();
  }

  // Close batch rent modal if clicking outside
  const batchModal = document.getElementById('batchRentModal');
  if (batchModal && batchModal.style.display === 'flex') {
    const modalContent = batchModal.querySelector('div[style*="background:white"]');
    if (modalContent && !modalContent.contains(e.target)) {
      closeBatchRentAdjustmentModal();
    }
  }
});

// Close sidebar on resize to desktop
window.addEventListener('resize',function(){
  if(window.innerWidth > 600){
    closeSidebar();
  }
});


// ===== DASHBOARD =====
// Auto-detect latest year from HISTORICAL_DATA, fallback to 69 (2026)
const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
const availableYears = Object.keys(historicalData).map(y => parseInt(y)).sort((a,b) => b-a);
let currentYear = '69';
window.dashBuildingFilter = 'all';
let chartRevenue,chartPie,chartYears,chartElec,chartWater,chartMS,chartCum;

function syncDashboardYearUI(){
  const yr = currentYear;
  const isAll = yr==='all';
  const isOldYear = yr==='67'||yr==='68';
  // 3-year compare — all only
  const cardYears = document.getElementById('card-years-compare');
  if(cardYears) cardYears.style.display = isAll ? '' : 'none';
  // Live-only cards + panels — all only
  document.querySelectorAll('.kpi-live').forEach(el=>el.style.display=isAll?'block':'none');
  const livePanels = document.getElementById('dash-live-panels');
  if(livePanels) livePanels.style.display = isAll ? 'grid' : 'none';
  // Nest Building card — hide for 67/68 (not open yet)
  document.querySelectorAll('.kpi-nest').forEach(el=>el.style.display=isOldYear?'none':'');
}

function setYear(yr,btn){
  document.querySelectorAll('#page-dashboard .year-tabs .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  currentYear=yr;
  syncDashboardYearUI();
  updateDashboardLive();
  initDashboardCharts();
}

function setBuilding(filter, btn) {
  window.dashBuildingFilter = filter;
  // Update active state on building filter row only (second year-tabs row)
  const rows = document.querySelectorAll('#page-dashboard .year-tabs');
  if (rows[1]) rows[1].querySelectorAll('.year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  initDashboardCharts();
}

// Load dashboard data from Firebase - aggregates meter readings into monthly totals
async function loadDashboardDataFromFirebase() {
  try {
    // Get Firestore references
    if (!window.firebase || !window.firebase.firestore) {
      return null;
    }

    // Skip if not authenticated — Firestore rules require auth
    if (!window.firebaseAuth?.currentUser) {
      return null;
    }

    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;

    // Query all meter_data documents from both buildings
    const meterDocsSnapshot = await fs.getDocs(fs.collection(db, 'meter_data'));

    // Initialize data structure
    const aggregated = {};

    // Process each meter document
    meterDocsSnapshot.forEach(doc => {
      const data = doc.data();
      const building = data.building; // 'rooms' or 'nest'
      const yearMonth = data.yearMonth; // format: '67_1', '67_2', etc.

      if (!yearMonth) return; // Skip if no yearMonth

      const [year, monthStr] = yearMonth.split('_');
      const month = parseInt(monthStr);

      if (!aggregated[year]) {
        aggregated[year] = { label: `ปี ${2500 + parseInt(year)} (${year})`, months: Array(12).fill(null) };
      }

      // Get existing month data or create new
      let monthData = aggregated[year].months[month - 1];
      if (!monthData) {
        monthData = [0, 0, 0, 0]; // [rent, electric, water, total]
      }

      // Get active rooms for this building
      const activeRooms = RoomConfigManager ? RoomConfigManager.getAllRooms(building) : [];
      const tenants = loadTenants();

      // Aggregate rent from active rooms (only count occupied rooms)
      let rentTotal = 0;
      activeRooms.forEach(roomId => {
        if (tenants[roomId]?.name) { // Only count occupied rooms
          const room = RoomConfigManager ? RoomConfigManager.getRoom(building, roomId) : null;
          rentTotal += (room?.rentPrice || 0);
        }
      });

      // Aggregate electricity and water from meter readings
      let elecTotal = 0;
      let waterTotal = 0;

      // data contains { roomId: { eNew, eOld, wNew, wOld }, ... }
      Object.entries(data.rooms || {}).forEach(([roomId, readings]) => {
        if (readings && typeof readings === 'object') {
          const eUsage = (readings.eNew || 0) - (readings.eOld || 0);
          const wUsage = (readings.wNew || 0) - (readings.wOld || 0);

          // Get room rates
          const room = RoomConfigManager ? RoomConfigManager.getRoom(building, roomId) : null;
          const elecRate = room?.electricRate || 8;
          const waterRate = room?.waterRate || 20;

          elecTotal += eUsage * elecRate;
          waterTotal += wUsage * waterRate;
        }
      });

      // ✅ FIXED: ADD to existing month data (combines multiple buildings) instead of overwriting
      monthData[0] += Math.round(rentTotal); // rent
      monthData[1] += Math.round(elecTotal); // electricity
      monthData[2] += Math.round(waterTotal); // water
      monthData[3] = monthData[0] + monthData[1] + monthData[2]; // total

      aggregated[year].months[month - 1] = monthData;
    });

    // Format to match DATA structure
    const result = {};
    Object.entries(aggregated).forEach(([year, data]) => {
      result[year] = data;
    });

    return Object.keys(result).length > 0 ? result : null;
  } catch(err) {
    console.error('Error loading Firebase data:', err);
    return null;
  }
}

async function initDashboardCharts(){
  const yr=currentYear;
  let labels,totals,elecs,waters,rents;

  // Try to load from Firebase first
  let firebaseData = null;
  try {
    if(window.firebase && window.firebase.firestore) {
      firebaseData = await loadDashboardDataFromFirebase();
      console.log('✅ Loaded dashboard data from Firebase');
    }
  } catch(err) {
    console.log('⚠️ Firebase dashboard load failed:', err.message);
  }

  // Use HISTORICAL_DATA first (imported bills take priority), then Firebase
  const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const dataSource = historicalData && Object.keys(historicalData).length > 0 ? historicalData : (firebaseData || {});

  // ─── HELPER: รองรับ 2 รูปแบบ month entry ───
  // รูปแบบเก่า (Firebase): Array [rent, elec, water, grandTotal]  → idx 3 = total
  // รูปแบบใหม่ (HISTORICAL_DATA): Object { total:[rent,elec,water,trash,grandTotal], rooms:[...], nest:[...], amazon:[...] }
  const mv  = (m, idx) => !m ? null : (Array.isArray(m) ? (m[idx] ?? null) : (m.total?.[idx] ?? null));
  const mgt = m => {
    if (!m) return null;
    if (Array.isArray(m)) return m[3] ?? null;
    const fromTotal = m.total?.[4] ?? null;
    if (fromTotal > 0) return fromTotal;
    // Fallback: sum building grand totals (in case total[4] wasn't saved correctly)
    const sumBuildings = (m.rooms?.[4] || 0) + (m.nest?.[4] || 0) + (m.amazon?.[4] || 0);
    return sumBuildings > 0 ? sumBuildings : fromTotal;
  }; // grand total
  const mbuild = (m, bld, idx) => !m || Array.isArray(m) ? null : (m[bld]?.[idx] ?? null); // building breakdown

  if(yr==='all'){
    labels=['67','68','69'].flatMap(y=>dataSource[y]?.months.map((_,i)=>MONTHS_TH[i+1]+"'"+y) || []);
    totals=['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mgt(m)) || []);
    elecs =['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,1)) || []);
    waters=['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,2)) || []);
    rents =['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,0)) || []);
  } else {
    const d=dataSource[yr];
    if(d){
      labels=d.months.map((_,i)=>MONTHS_TH[i+1]);
      totals=d.months.map(m=>mgt(m));
      elecs =d.months.map(m=>mv(m,1));
      waters=d.months.map(m=>mv(m,2));
      rents =d.months.map(m=>mv(m,0));
    } else {
      labels=[]; totals=[]; elecs=[]; waters=[]; rents=[];
    }
  }

  const valid=totals.filter(v=>v!=null&&v>0);
  const total=valid.reduce((a,b)=>a+b,0);
  const avg=valid.length?Math.round(total/valid.length):0;
  const maxV=valid.length?Math.max(...valid):0;
  const maxIdx=maxV>0?totals.findIndex(t=>t===maxV):-1;
  const rentT=rents.filter(Boolean).reduce((a,b)=>a+b,0);
  const elecT=elecs.filter(Boolean).reduce((a,b)=>a+b,0);
  const waterT=waters.filter(Boolean).reduce((a,b)=>a+b,0);

  document.getElementById('kpi-total').textContent='฿'+total.toLocaleString();
  const yearLabel=yr==='all'?'ปี 2567-2569':dataSource[yr]?.label||`ปี ${2500+parseInt(yr)} (${yr})`;
  document.getElementById('kpi-total-sub').textContent=yearLabel+' · '+valid.length+' เดือน';
  document.getElementById('kpi-monthly').textContent='฿'+avg.toLocaleString();
  document.getElementById('kpi-monthly-sub').textContent=maxV>0?('สูงสุด: ฿'+maxV.toLocaleString()+(maxIdx>=0&&MONTHS_TH[maxIdx+1]?' ('+MONTHS_TH[maxIdx+1]+')':'')):'—';

  // ─── Building breakdown from HISTORICAL_DATA ───
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest  = getActiveRoomsWithMetadata('nest',  window.NEST_ROOMS);
  const tenants = loadTenants();
  const occupiedRooms = activeRooms.filter(r=>tenants[r.id]?.name).length;
  const occupiedNest  = activeNest.filter(r=>tenants[r.id]?.name).length;

  let yearlyRoomsTotal=0, yearlyNestTotal=0, yearlyAmazonTotal=0;
  let yearlyRoomsRent=0, yearlyNestRent=0;

  const yearsToSum = yr==='all'?['67','68','69']:[yr];
  yearsToSum.forEach(y=>{
    (dataSource[y]?.months||[]).forEach(month=>{
      if(!month)return;
      if(!Array.isArray(month)){
        // New object format — sum per building
        yearlyRoomsTotal  += (month.rooms?.[4]  || 0);
        yearlyNestTotal   += (month.nest?.[4]   || 0);
        yearlyAmazonTotal += (month.amazon?.[4] || 0);
        yearlyRoomsRent   += (month.rooms?.[0]  || 0);
        yearlyNestRent    += (month.nest?.[0]   || 0);
      }
    });
  });

  // Fallback: estimate from active tenants if no historical data
  const estRoomsMonthly = activeRooms.filter(r=>tenants[r.id]?.name).reduce((s,r)=>s+(r.rentPrice||0),0);
  const estNestMonthly  = activeNest.filter(r=>tenants[r.id]?.name).reduce((s,r)=>s+(r.rentPrice||0),0);
  const mCount = valid.length || 1;

  // Potential Revenue (100% occupancy)
  const potentialRoomsMonthly = activeRooms.reduce((s,r)=>s+(r.rentPrice||0),0);
  const potentialNestMonthly  = activeNest.reduce((s,r)=>s+(r.rentPrice||0),0);

  const kpiRooms = yearlyRoomsTotal>0 ? yearlyRoomsTotal : estRoomsMonthly*mCount;
  const kpiNest  = yearlyNestTotal>0  ? yearlyNestTotal  : estNestMonthly*mCount;

  document.getElementById('kpi-rooms-total').textContent='฿'+kpiRooms.toLocaleString();
  document.getElementById('kpi-rooms-sub').textContent=yearlyRoomsTotal>0
    ? `เช่า ฿${Math.round(yearlyRoomsRent/mCount).toLocaleString()}/เดือน · Potential ฿${potentialRoomsMonthly.toLocaleString()}/เดือน`
    : `${occupiedRooms}/${activeRooms.length} ห้อง · Potential ฿${potentialRoomsMonthly.toLocaleString()}/เดือน`;

  if (yr !== '69' && yr !== 'all') {
    document.getElementById('kpi-nest-total').textContent = '—';
    document.getElementById('kpi-nest-sub').textContent = 'ยังไม่มีตึกนี้ในปีนั้น';
  } else {
    document.getElementById('kpi-nest-total').textContent='฿'+kpiNest.toLocaleString();
    document.getElementById('kpi-nest-sub').textContent=yearlyNestTotal>0
      ? `เช่า ฿${Math.round(yearlyNestRent/mCount).toLocaleString()}/เดือน · Potential ฿${potentialNestMonthly.toLocaleString()}/เดือน`
      : `${occupiedNest}/${activeNest.length} ยูนิต · Potential ฿${potentialNestMonthly.toLocaleString()}/เดือน`;
  }

  // ─── Insight cards ───
  document.getElementById('ins-rent').textContent  = rentT >0?'฿'+rentT.toLocaleString() :'—';
  document.getElementById('ins-elec').textContent  = elecT >0?'฿'+elecT.toLocaleString() :'—';
  document.getElementById('ins-water').textContent = waterT>0?'฿'+waterT.toLocaleString():'—';
  const avgRentPerMonth = rents.filter(Boolean).length>0 ? Math.round(rentT/rents.filter(Boolean).length) : 0;
  document.getElementById('ins-rent-d').textContent = avgRentPerMonth>0
    ? `เฉลี่ย ฿${avgRentPerMonth.toLocaleString()}/เดือน · ${rents.filter(Boolean).length} เดือน`
    : 'รวมห้องพักทั้งหมด';

  // ─── Trend arrows: compare last month vs previous month ───
  const trendArrow = arr => {
    const valid = arr.filter(v => v > 0);
    if (valid.length < 2) return '';
    const last = valid[valid.length-1], prev = valid[valid.length-2];
    const pct = Math.round((last-prev)/prev*100);
    return pct > 0 ? ` ⬆️ +${pct}%` : pct < 0 ? ` ⬇️ ${pct}%` : ' ➡️ 0%';
  };
  const rentTrend  = trendArrow(rents);
  const elecTrend  = trendArrow(elecs);
  const waterTrend = trendArrow(waters);
  if (rentTrend)  document.getElementById('ins-rent-d').textContent  += rentTrend + ' จากเดือนก่อน';

  // ─── Last 12 months table (filtered by selected year) ───
  renderLast6MonthsTable(dataSource, mv, mgt, yr);

  const mkChart=(id,type,data,opts)=>{
    const el=document.getElementById(id);
    if(!el)return null;
    Chart.getChart(el)?.destroy();
    return new Chart(el.getContext('2d'),{type,data,options:{responsive:true,maintainAspectRatio:false,...opts}});
  };

  // Revenue chart: filter months with total data
  const chartLabels=[], chartTotals=[], chartElecs=[], chartWaters=[], chartRents=[];
  labels.forEach((lbl,i)=>{
    if(totals[i]!=null){
      chartLabels.push(lbl);
      chartTotals.push(totals[i]);
      chartElecs.push(elecs[i]  || 0);
      chartWaters.push(waters[i] || 0);
      chartRents.push(rents[i]  || 0);
    }
  });

  // Elec/Water charts: same year selection + same filter as table (mgt > 0)
  // ensures charts always show identical months to what table shows
  const elecChartLabels=[], elecChartData=[], waterChartLabels=[], waterChartData=[];
  const utilYears = yr === 'all' ? ['67','68','69'] : [yr];
  utilYears.forEach(y=>{
    (dataSource[y]?.months||[]).forEach((m,i)=>{
      if(!m || !(mgt(m)>0)) return;
      const lbl = MONTHS_TH[i+1] + (utilYears.length>1 ? `'${y}` : '');
      elecChartLabels.push(lbl); elecChartData.push(mv(m,1)||0);
      waterChartLabels.push(lbl); waterChartData.push(mv(m,2)||0);
    });
  });

  chartRevenue=mkChart('chartRevenue','bar',{labels:chartLabels,datasets:[
    {label:'ค่าเช่า',data:chartRents, backgroundColor:'rgba(45,134,83,.75)', stack:'s',borderRadius:3},
    {label:'ค่าไฟ', data:chartElecs, backgroundColor:'rgba(255,143,0,.75)',  stack:'s'},
    {label:'ค่าน้ำ', data:chartWaters,backgroundColor:'rgba(33,150,243,.75)', stack:'s'},
    {label:`เฉลี่ย ฿${avg.toLocaleString()}`,data:chartLabels.map(()=>avg),type:'line',borderColor:'rgba(0,0,0,.4)',borderDash:[6,4],pointRadius:0,borderWidth:2,fill:false,stack:'',order:0,yAxisID:'y'}
  ]},{plugins:{legend:{position:'bottom',labels:{font:{size:10},padding:8}},tooltip:{callbacks:{label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{x:{stacked:true,grid:{display:false},ticks:{maxRotation:45}},y:{stacked:true,ticks:{callback:v=>'฿'+(v/1000).toFixed(0)+'K'},grid:{color:'rgba(0,0,0,.04)'}}}});

  const avgE=chartElecs.filter(Boolean).length?Math.round(elecT/chartElecs.filter(Boolean).length):0;
  const avgW=chartWaters.filter(Boolean).length?Math.round(waterT/chartWaters.filter(Boolean).length):0;
  const elecDEl  = document.getElementById('ins-elec-d');
  const waterDEl = document.getElementById('ins-water-d');
  if (elecDEl)  elecDEl.textContent  = `เฉลี่ย ฿${avgE.toLocaleString()}/เดือน${elecTrend ? elecTrend+' จากเดือนก่อน' : ''}`;
  if (waterDEl) waterDEl.textContent = `เฉลี่ย ฿${avgW.toLocaleString()}/เดือน${waterTrend ? waterTrend+' จากเดือนก่อน' : ''}`;
  const avgR=rents.filter(Boolean).length?Math.round(rentT/rents.filter(Boolean).length):0;
  const avgOth=Math.max(0,avg-avgR-avgE-avgW);
  const pieTotal=avgR+avgE+avgW+avgOth||1;
  const piePct=v=>Math.round(v/pieTotal*100);
  chartPie=mkChart('chartPie','doughnut',{labels:[`ค่าเช่าห้อง ${piePct(avgR)}%`,`ค่าไฟ ${piePct(avgE)}%`,`ค่าน้ำ ${piePct(avgW)}%`,`อื่นๆ ${piePct(avgOth)}%`],datasets:[{data:[avgR,avgE,avgW,avgOth],backgroundColor:['#2d8653','#ff8f00','#2196f3','#9c27b0'],borderWidth:0,hoverOffset:8}]},{plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:12}},tooltip:{callbacks:{label:c=>c.label+': ฿'+Math.round(c.raw).toLocaleString()}}}});

  const yrAvgs=['67','68','69'].map(y=>{const v=(dataSource[y]?.months||[]).filter(m=>mgt(m)>0);return v.length?Math.round(v.reduce((a,m)=>a+mgt(m),0)/v.length):0;});
  const yrHasData=y=>(dataSource[y]?.months||[]).some(m=>mgt(m)>0);
  const yrLabels=['67','68','69'].map(y=>yrHasData(y)?`${2500+parseInt(y)}\n(Actual)`:`${2500+parseInt(y)}\n(Forecast)`);
  chartYears=mkChart('chartYears','bar',{labels:yrLabels,datasets:[{label:'เฉลี่ย/เดือน',data:yrAvgs,backgroundColor:['#2d8653','#1976d2','#ff8f00'],borderRadius:8}]},{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{y:{ticks:{callback:v=>'฿'+(v/1000).toFixed(0)+'K'},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false},ticks:{font:{size:9}}}}});

  const lineOpts=()=>({layout:{padding:{right:8}},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items[0]?.label||'',label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{y:{ticks:{callback:v=>'฿'+(v/1000).toFixed(1)+'K'},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false},ticks:{autoSkip:true,maxTicksLimit:8,maxRotation:60,minRotation:30,font:{size:8}}}}});
  chartElec =mkChart('chartElec','line', {labels:elecChartLabels,datasets:[{label:'ค่าไฟ', data:elecChartData, borderColor:'#ff8f00',backgroundColor:'rgba(255,143,0,.1)',fill:true,tension:.4,pointRadius:4,pointHoverRadius:6}]},lineOpts());
  chartWater=mkChart('chartWater','line',{labels:waterChartLabels,datasets:[{label:'ค่าน้ำ',data:waterChartData,borderColor:'#2196f3',backgroundColor:'rgba(33,150,243,.1)',fill:true,tension:.4,pointRadius:4,pointHoverRadius:6}]},lineOpts());
}

// ─── Render last-12-months summary table ───
function renderLast6MonthsTable(dataSource, mv, mgt, yr) {
  const el = document.getElementById('dash-last6-body');
  if (!el) return;

  // Update table title based on selected year
  const titleEl = document.getElementById('dash-last6-title');
  if (titleEl) {
    if (!yr || yr === 'all') {
      titleEl.textContent = '📅 รายได้ย้อนหลัง 12 เดือน (ล่าสุด)';
    } else {
      titleEl.textContent = `📅 รายได้ทั้งปี ${2500+parseInt(yr)} (12 เดือน)`;
    }
  }

  // Flatten months — only from the selected year (or all years if 'all')
  const yearsToRender = (!yr || yr === 'all') ? ['67','68','69'] : [yr];
  const allEntries = [];
  yearsToRender.forEach(y => {
    (dataSource[y]?.months || []).forEach((m, idx) => {
      if (mgt(m) > 0) {
        allEntries.push({
          label: MONTHS_TH[idx+1] + (yearsToRender.length > 1 ? ' ' + (2500+parseInt(y)) : ''),
          rent:  mv(m,0) || 0,
          elec:  mv(m,1) || 0,
          water: mv(m,2) || 0,
          trash: mv(m,3) || 0,
          total: mgt(m)  || 0,
          rooms: Array.isArray(m) ? null : m.rooms,
          nest:  Array.isArray(m) ? null : m.nest,
          amazon:Array.isArray(m) ? null : m.amazon
        });
      }
    });
  });

  // For 'all': take last 12 across years. For specific year: show all months in that year.
  const last6 = (!yr || yr === 'all') ? allEntries.slice(-12).reverse() : allEntries.slice().reverse();

  if (last6.length === 0) {
    el.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">ยังไม่มีข้อมูล — นำเข้าบิลก่อน</td></tr>`;
    return;
  }

  const bldFilter = window.dashBuildingFilter || 'all';
  el.innerHTML = last6.map(row => {
    const roomsTotal  = row.rooms?.[4]  || 0;
    const nestTotal   = row.nest?.[4]   || 0;
    const amazonTotal = row.amazon?.[4] || 0;
    const hasBreakdown = row.rooms !== null;
    let dRent, dElec, dWater, dTotal, dBreakdown;
    if (bldFilter === 'rooms' && hasBreakdown) {
      dRent = row.rooms[0]||0; dElec = row.rooms[1]||0; dWater = row.rooms[2]||0;
      dTotal = row.rooms[4]||0; dBreakdown = '🏠 ห้องแถว';
    } else if (bldFilter === 'nest' && hasBreakdown) {
      dRent = row.nest[0]||0; dElec = row.nest[1]||0; dWater = row.nest[2]||0;
      dTotal = row.nest[4]||0; dBreakdown = '🏢 Nest';
    } else {
      dRent = row.rent; dElec = row.elec; dWater = row.water; dTotal = row.total;
      dBreakdown = hasBreakdown ? `🏠${roomsTotal.toLocaleString()} 🏢${nestTotal.toLocaleString()}${amazonTotal?' 🏪'+amazonTotal.toLocaleString():''}` : '—';
    }
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:.55rem .7rem;font-weight:700;">${row.label}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#2d8653;">฿${dRent.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#ff8f00;">฿${dElec.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#2196f3;">฿${dWater.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;font-size:.78rem;color:#666;">${dBreakdown}</td>
      <td style="padding:.55rem .7rem;text-align:right;font-weight:800;color:var(--green-dark);">฿${dTotal.toLocaleString()}</td>
    </tr>`;
  }).join('');
}

// ===== ROOM FILTER STATE =====
let currentRoomFilter = 'all'; // all, occupied, vacant, overdue
let currentNestFilter = 'all'; // all, occupied, vacant, overdue

// ===== HELPER: Get active rooms with merged metadata =====
function getActiveRoomsWithMetadata(building, metadataArray) {
  // Get full room config from RoomConfigManager
  const config = RoomConfigManager.getRoomsConfig(building);
  const activeRooms = config.rooms.filter(r => !r.deleted);

  // Merge RoomConfigManager data with metadata (rent, type, trashFee, etc.)
  return activeRooms.map(r => {
    const metadata = metadataArray.find(m => m.id === r.id);
    // Prioritize rentPrice from RoomConfigManager, fall back to metadata or default
    const rentPrice = (r.rentPrice && r.rentPrice > 0) ? r.rentPrice : (metadata?.rent || 1500);
    // Return merged object with all properties
    return {
      id: r.id,
      name: r.name,
      waterRate: r.waterRate,
      electricRate: r.electricRate,
      deleted: r.deleted,
      rentPrice: rentPrice,
      type: metadata?.type || 'room',
      trashFee: metadata?.trashFee || 20,
      elecRate: metadata?.elecRate || r.electricRate,
      floor: metadata?.floor,
      note: metadata?.note,
      dailyRate: metadata?.dailyRate
    };
  });
}

// ===== ROOMS PAGE =====
function initRoomsPage(){
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();

  // Set up real-time Firebase listeners
  setupRoomDataListener();
  setupLeaseDataListener();
  setupMeterDataListener();
  console.log('✅ Real-time listeners activated for Rooms page');

  const allTenants = loadTenants();
  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  // Update info cards regardless of floor plan visibility
  updateRoomsInfoCards();
  updateShopInfoCard();

  const grid=document.getElementById('roomGrid');
  if(!grid) return;
  grid.innerHTML=rooms.map(r=>{
    const tenant = allTenants[r.id];
    const occupancyIcon = tenant && tenant.name ? '✅' : '🚪';
    const statusInfo = getRoomColorStatus(r.id, r);
    const bgColor = r.type==='commercial'?'rgba(66,133,244,0.15)':statusInfo.color+'40';
    const borderColor = r.type==='commercial'?'#4285f4':statusInfo.color;
    const displayId = (r.name || r.id).replace(/^ห้อง |^Nest /, '');
    return `
    <div class="room-pill ${r.type==='commercial'?'commercial':'occupied'}" onclick="openTenantModal('rooms', '${r.id}')" style="cursor:pointer;transition:transform 0.2s;background:${bgColor};border:2px solid ${borderColor};">
      <div class="room-num">${displayId}</div>
      <div class="room-rent">฿${r.rentPrice.toLocaleString()}/เดือน</div>
      <div class="room-status">${r.type==='commercial'?'🏪 พาณิชย์':occupancyIcon + (tenant && tenant.name ? ' ' + tenant.name : ' ว่าง')}</div>
      <div style="font-size:0.8rem;margin-top:4px;text-align:center;color:${borderColor};font-weight:600;">${statusInfo.icon} ${statusInfo.label}</div>
    </div>`;
  }).join('');

  const tbl=document.getElementById('roomTable');
  if(!tbl) return;
  const rentT=rooms.filter(r=>r.type==='room').reduce((a,r)=>a+r.rentPrice,0);
  const avgE=Math.round(12500/22),avgW=Math.round(3200/22);
  tbl.innerHTML=`
    <thead><tr><th>ห้องเลขที่</th><th>ประเภท</th><th>ค่าเช่า</th><th>อัตราไฟ</th><th>ค่าขยะ</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rooms.map(r=>`<tr>
      <td><strong>${r.id}</strong></td>
      <td><span class="badge ${r.type==='commercial'?'badge-blue':'badge-green'}">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span></td>
      <td style="font-weight:700;color:var(--green-dark)">฿${r.rentPrice.toLocaleString()}</td>
      <td>${r.elecRate} บาท/หน่วย</td>
      <td>฿${r.trashFee}</td>
      <td><span class="badge badge-green">✅ มีผู้เช่า</span></td>
      <td style="font-size:.8rem;color:var(--text-muted)">${r.note||'—'}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--green-pale);font-weight:700;">
      <td colspan="2">รวมห้องพัก (${rooms.length} ห้อง)</td>
      <td>฿${rentT.toLocaleString()}</td><td colspan="4">—</td>
    </tr></tfoot>`;

  renderCompactRoomGrid();

  // Add search functionality
  const searchInput=document.getElementById('roomCompactSearch');
  if(searchInput){
    searchInput.addEventListener('input',renderCompactRoomGrid);
  }

}

// ===== ROOM FILTER FUNCTION =====
function setRoomFilter(filter) {
  currentRoomFilter = filter;

  // Update button styles
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = 'white';
    btn.style.color = btn.style.borderColor;
  });

  // Find and style the active button
  const activeBtn = event.target;
  activeBtn.classList.add('active');
  activeBtn.style.background = activeBtn.style.borderColor || 'var(--green-dark)';
  activeBtn.style.color = 'white';

  renderCompactRoomGrid();
}

// ===== COMPACT ROOM GRID RENDERING =====
function renderCompactRoomGrid(){
  const allTenants = loadTenants();
  const searchInput=document.getElementById('roomCompactSearch');
  const searchTerm=(searchInput?.value||'').toLowerCase();
  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);

  // Apply search filter
  let filtered=rooms.filter(r=>r.id.toString().toLowerCase().includes(searchTerm) || (allTenants[r.id]?.name||'').toLowerCase().includes(searchTerm));

  // Apply status filter
  filtered = filtered.filter(r => {
    if (currentRoomFilter === 'all') return true;

    const statusInfo = getRoomColorStatus(r.id, r);
    const paymentStatus = getPaymentStatus(r.id);

    if (currentRoomFilter === 'occupied') return statusInfo.label === 'มี';
    if (currentRoomFilter === 'vacant') return statusInfo.label === 'ว่าง';
    if (currentRoomFilter === 'overdue') return paymentStatus === 'overdue';

    return true;
  });
  const grid=document.getElementById('roomCompactGrid');
  if(!grid) return;

  // Calculate contract expiry summary
  const today = new Date();
  const in30 = new Date(today.getTime() + 30*86400000);
  const in60 = new Date(today.getTime() + 60*86400000);

  const expiring30 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > today && exp <= in30;
  }).length;

  const expiring60 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > in30 && exp <= in60;
  }).length;

  grid.innerHTML=filtered.map(r=>{
    const tenant = allTenants[r.id];
    const isOccupied = tenant && tenant.name;

    // Format dates
    const moveInDate = tenant?.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const contractEnd = tenant?.contractEnd ? new Date(tenant.contractEnd).toLocaleDateString('th-TH', {month: 'short', day: 'numeric', year: '2-digit'}) : '—';

    // Calculate days until contract end
    let daysLeft = '—';
    let expiryColor = 'var(--text-muted)';
    if(tenant?.contractEnd) {
      const exp = new Date(tenant.contractEnd);
      const days = Math.ceil((exp - today) / 86400000);
      if(days > 0) {
        daysLeft = days;
        if(days <= 30) expiryColor = 'var(--red)';
        else if(days <= 60) expiryColor = 'var(--orange)';
        else expiryColor = 'var(--green-dark)';
      }
    }

    // Get payment status
    const paymentStatus = getPaymentStatus(r.id);
    const paymentStatusLabel = paymentStatus === 'paid' ? 'จ่ายแล้ว' :
                              paymentStatus === 'pending' ? 'รอจ่าย' :
                              paymentStatus === 'overdue' ? 'ค้าง' : '—';
    const paymentStatusHTML = paymentStatus ? `<span class="payment-status ${paymentStatus}">${paymentStatusLabel}</span>` : '';

    // Get payment info (deadline and outstanding)
    const paymentInfo = isOccupied ? getPaymentInfo(r.id) : { nextDueDate: null, overdueAmount: 0 };
    const nextPaymentDate = paymentInfo.nextDueDate ? new Date(paymentInfo.nextDueDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const overdueDisplay = paymentInfo.overdueAmount > 0 ? `฿${paymentInfo.overdueAmount.toLocaleString()}` : '—';

    const displayRoomId = (r.name || r.id).replace(/^ห้อง |^Nest /, '');
    return `
    <div class="compact-card ${r.type==='commercial'?'':''}" style="border-left-color:${r.type==='commercial'?'var(--blue)':'var(--green)'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${displayRoomId}</div>
        <span class="compact-card-type">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          <span style="font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOccupied?'var(--green-pale)':'#f3e5f5'};color:${isOccupied?'var(--green-dark)':'#6a1b9a'};font-weight:600;">${isOccupied?'มีผู้เช่า':'ว่าง'}</span>
          ${paymentStatusHTML}
        </span>
      </div>
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span class="compact-card-value">฿${r.rentPrice.toLocaleString()}</span>
      </div>
      ${isOccupied ? `
      <div class="compact-card-info">
        <span style="font-weight:600;color:var(--text);">ชื่อ</span>
        <span class="compact-card-value">${tenant.name}</span>
      </div>
      <div class="compact-card-info">
        <span>โทร</span>
        <span style="font-size:.8rem;">${tenant.phone || '—'}</span>
      </div>
      <div class="compact-card-info">
        <span>เข้าพัก</span>
        <span style="font-size:.8rem;">${moveInDate}</span>
      </div>
      <div class="compact-card-info">
        <span>สัญญาสิ้นสุด</span>
        <span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${contractEnd}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${daysLeft === '—' ? '—' : daysLeft + ' วัน'}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">ชำระครั้งต่อ</span>
        <span style="font-size:.8rem;font-weight:600;">${nextPaymentDate}</span>
      </div>
      ${paymentInfo.overdueAmount > 0 ? `
      <div class="compact-card-info">
        <span style="color:#d32f2f;font-size:.75rem;">ค้างชำระ</span>
        <span style="font-weight:700;color:#d32f2f;">฿${paymentInfo.overdueAmount.toLocaleString()}</span>
      </div>
      ` : ''}
      ` : `
      <div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);">
        <span style="font-size:.9rem;">🚪 ไม่มีผู้เช่า</span>
      </div>
      `}
      <div class="compact-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button class="compact-btn" onclick="editRoom('${r.id}')" title="แก้ไขสัญญาเช่า" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">📄 สัญญา</button>
        <button class="compact-btn" onclick="recordPayment('${r.id}')" title="บันทึกค่าเช่า" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">💰 ชำระ</button>
        <button class="compact-btn" onclick="viewBills('${r.id}')" title="ดูบิล" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🧾 บิล</button>
        <button class="compact-btn" onclick="reportMaintenance('${r.id}')" title="แจ้งซ่อม" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบห้องที่ค้นหา</div>';
  }

  // Add contract expiry summary at the bottom
  const summaryHtml = `
  <div style="grid-column:1/-1;margin-top:1rem;padding:1rem;background:linear-gradient(135deg, #e8f5e9, #f1f8e9);border-radius:8px;border-left:4px solid var(--green);">
    <div style="font-weight:700;color:var(--green-dark);margin-bottom:0.5rem;">📋 สรุปสัญญา (ห้องแถว)</div>
    <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:.85rem;">
      <div>⚠️ <strong>${expiring30}</strong> ห้อง หมดภายใน 30 วัน</div>
      <div>⏳ <strong>${expiring60}</strong> ห้อง หมดใน 30-60 วัน</div>
      <div>✅ <strong>${rooms.filter(r => allTenants[r.id]?.name).length}</strong> ห้องมีผู้เช่า</div>
      <div>🚪 <strong>${rooms.filter(r => !allTenants[r.id]?.name).length}</strong> ห้องว่าง</div>
    </div>
  </div>`;

  grid.innerHTML += summaryHtml;
}

function toggleRoomView(view, btn){
  const compactView=document.getElementById('roomViewCompact');
  const classicView=document.getElementById('roomViewClassic');
  if(!compactView && !classicView) return;
  const buttons=document.querySelectorAll('.view-btn');

  buttons.forEach(b=>b.classList.remove('active'));
  buttons.forEach(b=>b.style.background='none');
  buttons.forEach(b=>b.style.color='var(--text)');
  buttons.forEach(b=>b.style.border='1.5px solid var(--border)');

  btn.classList.add('active');
  btn.style.background='var(--green-pale)';
  btn.style.color='var(--green-dark)';
  btn.style.border='1.5px solid var(--green)';

  if(view==='grid'){
    compactView.style.display='block';
    classicView.style.display='none';
  }else{
    compactView.style.display='none';
    classicView.style.display='block';
  }
}

function editRoom(roomId){openTenantModal(roomId);}
function viewRoomDetails(roomId){openTenantModal(roomId);}

// ===== BATCH RENT ADJUSTMENT FUNCTIONS =====
let batchSelectedRooms = new Set();

function openBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderRoomSelectionCheckboxes();
  updateAdjustmentDisplay();
}

function closeBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (modal) modal.style.display = 'none';
  batchSelectedRooms.clear();
}

function renderRoomSelectionCheckboxes() {
  const container = document.getElementById('roomSelectionContainer');
  if (!container) return;

  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  container.innerHTML = rooms.map(room => {
    const currentRent = room.rentPrice || 0;
    return `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border:1.5px solid #e0e0e0;border-radius:6px;cursor:pointer;transition:all 0.2s;background:white;" onclick="toggleBatchRoomSelection('${room.id}')">
        <input type="checkbox" id="batchRoom_${room.id}" onchange="updateBatchRoomCount()" style="cursor:pointer;">
        <span style="font-size:0.85rem;font-weight:600;color:#333;">${room.id}</span>
        <span style="font-size:0.75rem;color:#666;">฿${currentRent}</span>
      </label>
    `;
  }).join('');
}

function toggleBatchRoomSelection(roomId) {
  const checkbox = document.getElementById(`batchRoom_${roomId}`);
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  updateBatchRoomCount();
}

function updateBatchRoomCount() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]:checked');
  const countElement = document.getElementById('roomSelectionCount');
  const count = checkboxes.length;
  if (countElement) countElement.textContent = count;

  batchSelectedRooms.clear();
  checkboxes.forEach(cb => {
    const roomId = cb.id.replace('batchRoom_', '');
    batchSelectedRooms.add(roomId);
  });

  updatePreview();
}

function selectAllRooms() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = true);
  updateBatchRoomCount();
}

function deselectAllRooms() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
  updateBatchRoomCount();
}

function updateAdjustmentDisplay() {
  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const labelEl = document.getElementById('adjustLabel');
  const symbolEl = document.getElementById('adjustSymbol');
  const unitEl = document.getElementById('adjustUnit');

  const labels = {
    'fixed-increase': 'จำนวนที่เพิ่ม',
    'percentage-increase': 'เปอร์เซ็นต์ที่เพิ่ม',
    'fixed-decrease': 'จำนวนที่ลด',
    'percentage-decrease': 'เปอร์เซ็นต์ที่ลด',
    'set-fixed': 'ค่าเช่าคงที่'
  };

  const symbols = {
    'fixed-increase': '฿',
    'percentage-increase': '%',
    'fixed-decrease': '฿',
    'percentage-decrease': '%',
    'set-fixed': '฿'
  };

  const units = {
    'fixed-increase': 'บาท',
    'percentage-increase': '%',
    'fixed-decrease': 'บาท',
    'percentage-decrease': '%',
    'set-fixed': 'บาท/เดือน'
  };

  if (labelEl) labelEl.textContent = labels[adjustType];
  if (symbolEl) symbolEl.textContent = symbols[adjustType];
  if (unitEl) unitEl.textContent = units[adjustType];

  updatePreview();
}

function updatePreview() {
  if (batchSelectedRooms.size === 0) {
    document.getElementById('previewResult').innerHTML = '<p style="margin:0;color:#999;">เลือกห้องเพื่อดูตัวอย่าง</p>';
    return;
  }

  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const adjustValue = parseFloat(document.getElementById('adjustmentValue')?.value || 0);

  if (isNaN(adjustValue) || adjustValue === 0) {
    document.getElementById('previewResult').innerHTML = '<p style="margin:0;color:#999;">กรอกจำนวนที่ต้องการปรับ</p>';
    return;
  }

  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const selectedRooms = rooms.filter(r => batchSelectedRooms.has(r.id));
  const preview = selectedRooms.map(room => {
    let newRent = room.rentPrice;

    if (adjustType === 'fixed-increase') newRent = room.rentPrice + adjustValue;
    else if (adjustType === 'percentage-increase') newRent = Math.round(room.rentPrice * (1 + adjustValue / 100));
    else if (adjustType === 'fixed-decrease') newRent = room.rentPrice - adjustValue;
    else if (adjustType === 'percentage-decrease') newRent = Math.round(room.rentPrice * (1 - adjustValue / 100));
    else if (adjustType === 'set-fixed') newRent = adjustValue;

    newRent = Math.max(0, newRent);
    const change = newRent - room.rentPrice;
    const changePercent = ((change / room.rentPrice) * 100).toFixed(1);
    const arrow = change >= 0 ? '↑' : '↓';
    const color = change > 0 ? '#4caf50' : (change < 0 ? '#d32f2f' : '#999');

    return `<p style="margin:4px 0;font-size:0.8rem;"><strong>${room.id}</strong>: ฿${room.rentPrice} <span style="color:${color};">→ ฿${newRent} ${arrow} ${Math.abs(changePercent)}%</span></p>`;
  }).join('');

  document.getElementById('previewResult').innerHTML = preview || '<p style="margin:0;color:#999;">ไม่มีการเปลี่ยนแปลง</p>';
}

function applyBatchRentAdjustment() {
  if (batchSelectedRooms.size === 0) {
    showToast('กรุณาเลือกห้องพักอย่างน้อย 1 ห้อง', 'warning');
    return;
  }

  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const adjustValue = parseFloat(document.getElementById('adjustmentValue')?.value || 0);

  if (isNaN(adjustValue) || adjustValue === 0) {
    showToast('กรุณากรอกจำนวนที่ต้องการปรับ', 'warning');
    return;
  }

  // Apply adjustments to window.ROOMS_OLD
  window.ROOMS_OLD.forEach(room => {
    if (batchSelectedRooms.has(room.id)) {
      if (adjustType === 'fixed-increase') room.rentPrice = room.rentPrice + adjustValue;
      else if (adjustType === 'percentage-increase') room.rentPrice = Math.round(room.rentPrice * (1 + adjustValue / 100));
      else if (adjustType === 'fixed-decrease') room.rentPrice = room.rentPrice - adjustValue;
      else if (adjustType === 'percentage-decrease') room.rentPrice = Math.round(room.rentPrice * (1 - adjustValue / 100));
      else if (adjustType === 'set-fixed') room.rentPrice = adjustValue;

      room.rentPrice = Math.max(0, room.rentPrice);
    }
  });

  // Log to audit
  if (typeof AuditLogger !== 'undefined') {
    AuditLogger.log('BATCH_RENT_ADJUSTMENT', {
      roomCount: batchSelectedRooms.size,
      adjustType: adjustType,
      adjustValue: adjustValue,
      affectedRooms: Array.from(batchSelectedRooms)
    });
  }

  // Update UI
  updateRoomDisplay();
  updateDashboardLive();

  // Show success message
  showToast(`ปรับค่าเช่า ${batchSelectedRooms.size} ห้อง สำเร็จ!`, 'success');

  closeBatchRentAdjustmentModal();
}

// window.NEST_ROOMS is now defined in shared-config.js
// Use window.CONFIG.nest_rooms instead

// ===== SET NEST FILTER =====
function setNestFilter(filter) {
  currentNestFilter = filter;

  // Update button styles
  const buttons = document.querySelectorAll('.filter-btn-nest');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = 'white';
    btn.style.color = btn.style.borderColor;
  });

  // Find and style the active button
  const activeBtn = event.target;
  activeBtn.classList.add('active');
  activeBtn.style.background = activeBtn.style.borderColor || 'var(--green-dark)';
  activeBtn.style.color = 'white';

  renderNestCompactGrid();
}

// ===== RENDER NEST COMPACT GRID =====
function renderNestCompactGrid(){
  const allTenants = loadTenants();
  const searchInput = document.getElementById('nestCompactSearch');
  const searchTerm = (searchInput?.value || '').toLowerCase();
  const rooms = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);

  // Apply search filter
  let filtered = rooms.filter(r =>
    r.id.toString().toLowerCase().includes(searchTerm) ||
    (allTenants[r.id]?.name || '').toLowerCase().includes(searchTerm)
  );

  // Apply status filter
  filtered = filtered.filter(r => {
    if (currentNestFilter === 'all') return true;

    const statusInfo = getRoomColorStatus(r.id, r);
    const paymentStatus = getPaymentStatus(r.id);

    if (currentNestFilter === 'occupied') return statusInfo.label === 'มี';
    if (currentNestFilter === 'vacant') return statusInfo.label === 'ว่าง';
    if (currentNestFilter === 'overdue') return paymentStatus === 'overdue';

    return true;
  });

  const grid = document.getElementById('nestCompactGrid');

  // Calculate contract expiry summary for Nest
  const today = new Date();
  const in30 = new Date(today.getTime() + 30*86400000);
  const in60 = new Date(today.getTime() + 60*86400000);

  const expiring30 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > today && exp <= in30;
  }).length;

  const expiring60 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > in30 && exp <= in60;
  }).length;

  grid.innerHTML = filtered.map(r => {
    const tenant = allTenants[r.id];
    const isOccupied = tenant && tenant.name;

    // Format dates
    const moveInDate = tenant?.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const contractEnd = tenant?.contractEnd ? new Date(tenant.contractEnd).toLocaleDateString('th-TH', {month: 'short', day: 'numeric', year: '2-digit'}) : '—';

    // Calculate days until contract end
    let daysLeft = '—';
    let expiryColor = 'var(--text-muted)';
    if(tenant?.contractEnd) {
      const exp = new Date(tenant.contractEnd);
      const days = Math.ceil((exp - today) / 86400000);
      if(days > 0) {
        daysLeft = days;
        if(days <= 30) expiryColor = 'var(--red)';
        else if(days <= 60) expiryColor = 'var(--orange)';
        else expiryColor = 'var(--green-dark)';
      }
    }

    // Pet badges
    const petKey = `tenant_pets_nest_${r.id}`;
    const roomPets = JSON.parse(localStorage.getItem(petKey) || '[]').filter(p => p.status === 'approved');
    const petBadgesHtml = roomPets.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;">${roomPets.map(p => {
          const em = {'dog':'🐕','cat':'🐈','rabbit':'🐇','bird':'🐦','fish':'🐠','hamster':'🐹'}[((p.type||'').toLowerCase())] || '🐾';
          return `<span title="${p.type}: ${p.name}" style="font-size:.68rem;padding:1px 6px;border-radius:8px;background:#f3e5f5;color:#6a1b9a;border:1px solid #ce93d8;">${em} ${p.name}</span>`;
        }).join('')}</div>`
      : '';

    const typeLabel = r.type === 'daily' ? '📅 รายวัน' : (r.type === 'pet' ? '🐾 Pet Friendly' : '🏠 Studio');
    const floorLabel = `ชั้น ${r.floor}`;

    return `
    <div class="compact-card" style="border-left-color: ${r.type === 'pet' ? 'var(--purple)' : 'var(--blue)'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${r.id}</div>
        <span class="compact-card-type" style="background: ${r.type === 'pet' ? 'var(--purple-pale)' : 'var(--blue)'}60; color: ${r.type === 'pet' ? 'var(--purple)' : 'var(--blue)'};">${floorLabel}</span>
        <span style="margin-left:auto;font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOccupied?'var(--green-pale)':'#f3e5f5'};color:${isOccupied?'var(--green-dark)':'#6a1b9a'};font-weight:600;">${isOccupied?'มีผู้เช่า':'ว่าง'}</span>
      </div>
      ${petBadgesHtml}
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${typeLabel}</span>
        <span class="compact-card-value">฿${r.rentPrice.toLocaleString()}</span>
      </div>
      ${isOccupied ? `
      <div class="compact-card-info">
        <span style="font-weight:600;color:var(--text);">ชื่อ</span>
        <span class="compact-card-value" style="font-size:.9rem;">${tenant.name}</span>
      </div>
      <div class="compact-card-info">
        <span>โทร</span>
        <span style="font-size:.8rem;">${tenant.phone || '—'}</span>
      </div>
      <div class="compact-card-info">
        <span>เข้าพัก</span>
        <span style="font-size:.8rem;">${moveInDate}</span>
      </div>
      <div class="compact-card-info">
        <span>สัญญาสิ้นสุด</span>
        <span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${contractEnd}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${daysLeft === '—' ? '—' : daysLeft + ' วัน'}</span>
      </div>
      ${(() => {
        const paymentInfo = getPaymentInfo(r.id);
        const nextPaymentDate = paymentInfo.nextDueDate ? new Date(paymentInfo.nextDueDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
        return `
        <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
          <span style="color:var(--text-muted);font-size:.75rem;">ชำระครั้งต่อ</span>
          <span style="font-size:.8rem;font-weight:600;">${nextPaymentDate}</span>
        </div>
        ${paymentInfo.overdueAmount > 0 ? `
        <div class="compact-card-info">
          <span style="color:#d32f2f;font-size:.75rem;">ค้างชำระ</span>
          <span style="font-weight:700;color:#d32f2f;">฿${paymentInfo.overdueAmount.toLocaleString()}</span>
        </div>
        ` : ''}
        `;
      })()}
      ` : `
      <div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);">
        <span style="font-size:.9rem;">🚪 ไม่มีผู้เช่า</span>
      </div>
      `}
      <div class="compact-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button class="compact-btn" onclick="editRoom('${r.id}')" title="แก้ไขสัญญาเช่า" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">📄 สัญญา</button>
        <button class="compact-btn" onclick="recordPayment('${r.id}')" title="บันทึกค่าเช่า" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">💰 ชำระ</button>
        <button class="compact-btn" onclick="viewBills('${r.id}')" title="ดูบิล" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🧾 บิล</button>
        <button class="compact-btn" onclick="reportMaintenance('${r.id}')" title="แจ้งซ่อม" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบห้องที่ค้นหา</div>';
  }

  // Add contract expiry summary at the bottom
  const summaryHtml = `
  <div style="grid-column:1/-1;margin-top:1rem;padding:1rem;background:linear-gradient(135deg, #f3e5f5, #ede7f6);border-radius:8px;border-left:4px solid var(--purple);">
    <div style="font-weight:700;color:var(--purple);margin-bottom:0.5rem;">📋 สรุปสัญญา (Nest)</div>
    <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:.85rem;">
      <div>⚠️ <strong>${expiring30}</strong> ห้อง หมดภายใน 30 วัน</div>
      <div>⏳ <strong>${expiring60}</strong> ห้อง หมดใน 30-60 วัน</div>
      <div>✅ <strong>${rooms.filter(r => allTenants[r.id]?.name).length}</strong> ห้องมีผู้เช่า</div>
      <div>🚪 <strong>${rooms.filter(r => !allTenants[r.id]?.name).length}</strong> ห้องว่าง</div>
    </div>
  </div>`;

  grid.innerHTML += summaryHtml;
}

// Toggle Nest room view between grid and classic table
function toggleNestRoomView(view, btn){
  const compactView = document.getElementById('nestViewCompact');
  if(!compactView) return;
  const classicView = document.getElementById('nestViewClassic');
  const buttons = btn.parentElement.querySelectorAll('.view-btn');

  buttons.forEach(b => {
    b.classList.remove('active');
    b.style.background = 'none';
    b.style.color = 'var(--text)';
    b.style.border = '1.5px solid var(--border)';
  });

  btn.classList.add('active');
  btn.style.background = '#e3f2fd';
  btn.style.color = '#1565c0';
  btn.style.border = '1.5px solid #2196f3';

  if(view === 'grid'){
    compactView.style.display = 'block';
    classicView.style.display = 'none';
  } else {
    compactView.style.display = 'none';
    classicView.style.display = 'block';
  }
}

// Initialize Nest compact grid when page loads
function initNestPage(){
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();

  // Set up real-time Firebase listeners
  setupRoomDataListener();
  setupLeaseDataListener();
  setupMeterDataListener();
  console.log('✅ Real-time listeners activated for Nest page');

  // Update info cards from live RoomConfigManager data (must be before early returns)
  updateNestInfoCards();

  // Populate room grid (visual layout)
  const allTenants = loadTenants();
  const rooms = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);
  const grid = document.getElementById('nestRoomGrid');
  if(!grid) return;
  grid.innerHTML = rooms.map(r => {
    const tenant = allTenants[r.id];
    const occupancyIcon = tenant && tenant.name ? '✅' : '🚪';
    const typeIcon = r.type === 'pet-allowed' ? '🐾' : '🏠';
    const statusInfo = getRoomColorStatus(r.id, r);
    const bgColor = statusInfo.color+'40';
    const borderColor = statusInfo.color;
    return `
    <div class="room-pill ${r.type === 'pet-allowed' ? 'pet-allowed' : 'studio'}" onclick="openTenantModal('nest', '${r.id}')" style="cursor:pointer;transition:transform 0.2s;background:${bgColor};border:2px solid ${borderColor};">
      <div class="room-num">${(r.name || r.id).replace(/^ห้อง |^Nest /, '')}</div>
      <div class="room-rent">฿${r.rentPrice.toLocaleString()}/เดือน</div>
      <div class="room-status">${typeIcon} ${tenant && tenant.name ? tenant.name : 'ว่าง'}</div>
      <div style="font-size:0.8rem;margin-top:4px;text-align:center;color:${borderColor};font-weight:600;">${statusInfo.icon} ${statusInfo.label}</div>
    </div>`;
  }).join('');

  // Populate classic table view
  const tbl = document.getElementById('nestRoomTable');
  if(!tbl) return;
  const rentStudio = rooms.filter(r => r.type === 'studio').reduce((a, r) => a + (r.rentPrice || 0), 0);
  const rentPet = rooms.filter(r => r.type === 'pet-allowed').reduce((a, r) => a + (r.rentPrice || 0), 0);
  const rentTotal = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);

  tbl.innerHTML = `
    <thead><tr><th>ห้องเลขที่</th><th>ชั้น</th><th>ประเภท</th><th>ค่าเช่า</th><th>อัตราไฟ</th><th>ค่าขยะ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rooms.map(r => {
      const typeLabel = r.type === 'pet-allowed' ? '🐾 Pet-Allowed' : '🏠 Studio';
      return `<tr>
        <td><strong>${r.id}</strong></td>
        <td>ชั้น ${r.floor}</td>
        <td><span class="badge ${r.type === 'pet-allowed' ? 'badge-purple' : 'badge-blue'}">${typeLabel}</span></td>
        <td style="font-weight:700;color:var(--green-dark)">฿${r.rentPrice.toLocaleString()}</td>
        <td>${r.electricRate || r.elecRate || 8} บาท/หน่วย</td>
        <td>฿${r.trashRate || r.trashFee || 40}</td>
        <td style="font-size:.8rem;color:var(--text-muted)">${r.note || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr style="background:var(--blue-pale);font-weight:700;">
      <td colspan="3">รวม (${rooms.length} ห้อง)</td>
      <td>฿${rentTotal.toLocaleString()}</td>
      <td colspan="3">—</td>
    </tr></tfoot>`;

  // Render compact grid and setup search
  renderNestCompactGrid();
  const searchInput = document.getElementById('nestCompactSearch');
  if(searchInput){
    searchInput.addEventListener('input', renderNestCompactGrid);
  }

}

// ===== PROPERTY PAGE (COMBINED ROOMS & NEST) =====
function initPropertyPage(){
  // Initialize the active tab based on current state
  const roomsSection = document.getElementById('property-rooms-section');
  const nestSection = document.getElementById('property-nest-section');

  if(roomsSection) initRoomsPage();
  if(nestSection) initNestPage();
  updateShopInfoCard();
}

// ─── Dynamic Nest info cards — reads from RoomConfigManager ───
function updateNestInfoCards() {
  const nestConfig = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('nest') : null;
  const rooms = nestConfig?.rooms?.filter(r => !r.deleted) || [];
  if (!rooms.length) return;

  const byType = { studio: [], 'pet-allowed': [] };
  rooms.forEach(r => { const key = r.type === 'pet-allowed' ? 'pet-allowed' : 'studio'; byType[key].push(r); });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const fmtRent  = v => v > 0 ? `฿${v.toLocaleString()}/เดือน` : '—';
  const fmtElec  = v => v > 0 ? `${v} บาท/หน่วย` : '—';
  const fmtWater = v => v > 0 ? `${v} บาท/หน่วย` : '—';
  const fmtTrash = v => v > 0 ? `฿${v}/เดือน` : '—';
  const floorStr = arr => [...new Set(arr.map(r => r.floor).filter(Boolean))].sort((a,b)=>a-b).join(', ');
  const rep = arr => arr[0] || {};

  const s = byType.studio, p = byType['pet-allowed'];

  const rs = rep(s);
  set('nest-studio-title', `🏠 Studio (N101–N205)${s.length ? ' — ' + s.length + ' ห้อง' : ''}`);
  set('nest-studio-rent',  fmtRent(rs.rentPrice));
  set('nest-studio-elec',  fmtElec(rs.electricRate));
  set('nest-studio-water', fmtWater(rs.waterRate));
  set('nest-studio-trash', fmtTrash(rs.trashRate));

  const rp = rep(p);
  set('nest-pet-title', `🐾 Pet-Allowed (N301–N405)${p.length ? ' — ' + p.length + ' ห้อง' : ''}`);
  set('nest-pet-rent',  fmtRent(rp.rentPrice));
  set('nest-pet-elec',  fmtElec(rp.electricRate));
  set('nest-pet-water', fmtWater(rp.waterRate));
  set('nest-pet-trash', fmtTrash(rp.trashRate));

  const totalRent = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);
  set('nest-total-title', `📊 รวมทั้งหมด (${rooms.length} ห้อง)`);
  set('nest-total-income',  `฿${totalRent.toLocaleString()}/เดือน`);
  set('nest-total-income2', `฿${totalRent.toLocaleString()}/เดือน`);
  set('nest-total-breakdown', `${s.length} Studio + ${p.length} Pet-Allowed`);
}

// ─── Dynamic shop info card — reads from RoomConfigManager ───
function updateShopInfoCard() {
  // Read live config from RoomConfigManager
  const config = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('rooms') : null;
  const shopRoom = config?.rooms?.find(r => r.id === 'ร้านใหญ่');
  const shopName = shopRoom?.name || 'ร้านใหญ่';  // use editable name field directly

  const rent  = shopRoom?.rentPrice   || 0;
  const elec  = shopRoom?.electricRate || 0;
  const water = shopRoom?.waterRate    || 0;
  // trashRate may not be set in RoomConfigManager — fall back to ROOMS_OLD metadata
  const shopMeta = (window.ROOMS_OLD || []).find(r => r.id === 'ร้านใหญ่');
  const trash = shopRoom?.trashRate || shopMeta?.trashFee || 0;

  const titleEl = document.getElementById('shop-info-title');
  const rentEl  = document.getElementById('shop-info-rent');
  const elecEl  = document.getElementById('shop-info-elec');
  const waterEl = document.getElementById('shop-info-water');
  const trashEl = document.getElementById('shop-info-trash');

  if (titleEl) titleEl.textContent = `🏪 ${shopName}`;
  if (rentEl)  rentEl.textContent  = rent  > 0 ? `฿${rent.toLocaleString()}/เดือน`  : '—';
  if (elecEl)  elecEl.textContent  = elec  > 0 ? `${elec} บาท/หน่วย`  : '—';
  if (waterEl) waterEl.textContent = water > 0 ? `${water} บาท/หน่วย` : '—';
  if (trashEl) trashEl.textContent = trash > 0 ? `฿${trash}/เดือน`    : '—';
}

// ─── Dynamic Rooms info cards — reads from RoomConfigManager ───
function updateRoomsInfoCards() {
  const config = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('rooms') : null;
  if (!config?.rooms) return;
  const rooms = config.rooms.filter(r => !r.deleted && r.id !== 'ร้านใหญ่');

  // Group by rent price tier
  const tiers = {};
  rooms.forEach(r => {
    const p = r.rentPrice || 0;
    tiers[p] = (tiers[p] || 0) + 1;
  });
  const tierStr = Object.keys(tiers).sort((a, b) => Number(a) - Number(b))
    .map(p => `฿${Number(p).toLocaleString()} × ${tiers[p]}`)
    .join(' | ');
  const totalRooms = rooms.length;
  const totalIncome = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rooms-card-title', `🏠 ห้องพัก (${totalRooms} ห้อง)`);
  set('rooms-rent-tiers', tierStr || '฿1,200 / ฿1,500 / ฿2,000/เดือน');
  set('rooms-total-title', `📊 รวมทั้งหมด (${totalRooms + 1} ห้อง)`);
  set('rooms-total-income',  `฿${totalIncome.toLocaleString()}/เดือน (ไม่รวมร้านค้า)`);
  set('rooms-total-income2', `฿${totalIncome.toLocaleString()}/เดือน (ไม่รวมร้านค้า)`);
  set('rooms-total-breakdown', `${totalRooms} ห้องพัก + 1 พาณิชย์`);
}

// ===== BILL PAGE =====
let currentBuilding='old';
let invoiceData=null;

// Helper: Convert legacy building names to Firebase config + metadata
function getBuildingInfo(legacyBuilding) {
  const firebaseBuilding = window.CONFIG?.getBuildingConfig?.(legacyBuilding) || (legacyBuilding === 'old' ? 'rooms' : 'nest');
  const metadataArray = legacyBuilding === 'old' ? window.ROOMS_OLD : window.ROOMS_NEW;
  const displayName = legacyBuilding === 'old' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น';
  return { firebaseBuilding, metadataArray, displayName };
}

function onBuildingChange(){
  currentBuilding=document.getElementById('f-building').value;
  populateRoomDropdown();
  document.getElementById('f-trash').value=currentBuilding==='new'?40:20;
  document.getElementById('f-elec-rate').value=8;
  renderPaymentStatus();
  calcBill(); resetBillFlow();
}

function populateRoomDropdown(){
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  const sel = document.getElementById('f-room');
  sel.innerHTML = '<option value="">-- เลือกห้อง --</option>' +
    rooms.map(r => {
      const tag = r.type === 'daily' ? '📅 ' : r.type === 'pet' ? '🐾 ' : r.type === 'commercial' ? '☕ ' : '';
      const rent = r.rentPrice || 0;  // Use rentPrice from getActiveRoomsWithMetadata
      return `<option value="${r.id}" data-rent="${rent}" data-elec="${r.elecRate || 8}" data-trash="${r.trashFee || 20}" data-daily="${r.dailyRate || 0}" data-type="${r.type}">${tag}ห้อง ${r.id} — ฿${rent.toLocaleString()}/เดือน</option>`;
    }).join('');
  document.getElementById('f-rent').value = '';
}

function onRoomChange(){
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(!opt||!opt.dataset.rent)return;
  document.getElementById('f-rent').value=opt.dataset.rent;
  document.getElementById('f-elec-rate').value=opt.dataset.elec||8;
  document.getElementById('f-trash').value=opt.dataset.trash||20;

  // Show daily section for daily-type rooms
  const isDaily=opt.dataset.type==='daily';
  const ds=document.getElementById('dailySection');
  ds.classList.toggle('show',isDaily);
  if(isDaily){document.getElementById('f-rent-type').value='monthly';onRentTypeChange();}
  // Show tenant name
  const roomId2 = document.getElementById('f-room').value;
  const tn = document.getElementById('f-tenant-name');
  if(tn){
    const tenants2 = loadTenants();
    const t2 = tenants2[roomId2];
    tn.textContent = t2?.name ? `👤 ${t2.name}${t2.phone?' · '+t2.phone:''}` : '';
  }
  autoFillMeters().then(()=>{ renderPaymentStatus(); resetBillFlow(); });
  renderPaymentStatus();
}

function checkVacant(){
  if(typeof METER_DATA==='undefined'){
    document.getElementById('vc-result').innerHTML='<span style="color:var(--text-muted);">ไม่พบข้อมูลมิเตอร์ (meter_data.js)</span>';
    return;
  }
  const month=parseInt(document.getElementById('vc-month').value);
  const yearFull=parseInt(document.getElementById('vc-year')?.value||(new Date().getFullYear()+543));
  const yy=yearFull%100;
  const key=`${yy}_${month}`;
  // Read from building-namespaced METER_DATA (Rooms Building)
  const md=METER_DATA['rooms'] && METER_DATA['rooms'][key];
  if(!md){
    document.getElementById('vc-result').innerHTML=`<span style="color:var(--text-muted);">ไม่มีข้อมูลเดือนนี้ในปี ${yy+2500}</span>`;
    return;
  }
  const monthNames=window.CONFIG.months.short;
  // ALL rooms in old building
  const allRooms=['15ก','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','ร้านใหญ่'];
  const vacant=[], occupied=[], noData=[];
  allRooms.forEach(r=>{
    const d=md[r];
    if(!d){noData.push(r);return;}
    const eUsed=(d.eNew!==null&&d.eOld!==null)?d.eNew-d.eOld:null;
    const wUsed=(d.wNew!==null&&d.wOld!==null)?d.wNew-d.wOld:null;
    if(eUsed===0&&(wUsed===0||wUsed===null)){vacant.push({r,eUsed,wUsed});}
    else{occupied.push({r,eUsed,wUsed});}
  });
  const pill=(r,cls,extra='')=>`<span style="display:inline-flex;align-items:center;gap:4px;margin:3px;padding:5px 12px;border-radius:20px;font-size:.82rem;font-weight:600;${cls}">${r}${extra}</span>`;
  let html=`<div style="margin-bottom:.5rem;font-size:.85rem;color:var(--text-muted);">ข้อมูลปี ${yy+2500} ${monthNames[month]} — มิเตอร์จาก Excel</div>`;
  if(vacant.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--red);margin-right:8px;">🚪 อาจว่าง (ไฟ=0) ${vacant.length} ห้อง</span>`;
    vacant.forEach(({r})=>{ html+=pill(r,'background:#ffebee;color:var(--red);border:1px solid #ffcdd2;'); });
    html+='</div>';
  }
  if(occupied.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--green);margin-right:8px;">✅ มีผู้เช่า ${occupied.length} ห้อง</span>`;
    occupied.forEach(({r,eUsed})=>{ html+=pill(r,`background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green-light);`,eUsed!==null?` <small style="opacity:.7">${eUsed}u</small>`:''); });
    html+='</div>';
  }
  if(noData.length){
    html+=`<div><span style="font-size:.8rem;color:var(--text-muted);margin-right:8px;">❓ ไม่มีข้อมูล ${noData.length} ห้อง: ${noData.join(', ')}</span></div>`;
  }
  document.getElementById('vc-result').innerHTML=html;
}

async function autoFillMeters(){
  renderPaymentStatus();
  const roomId=document.getElementById('f-room').value;
  const month=parseInt(document.getElementById('f-month').value);
  const year=parseInt(document.getElementById('f-year').value);

  // If no room selected, just return
  if(!roomId){
    console.log('⏳ Waiting for room selection...');
    return;
  }
  const yy=year%100;
  const key=`${yy}_${month}`;
  const psKey=`${year}_${month}`;
  const meterDataBuilding = getBuildingInfo(currentBuilding).firebaseBuilding;

  // Helper: fetch one meter doc from Firestore
  async function fetchFirestoreDoc(building, yyVal, monthVal, room){
    try {
      if(!window.firebaseAuth?.currentUser) return null;
      const db=window.firebase?.firestore?.();
      const fs=window.firebase?.firestoreFunctions;
      if(!db||!fs?.doc||!fs?.getDoc) return null;
      const docId=`${building}_${yyVal}_${monthVal}_${room}`;
      const snap=await fs.getDoc(fs.doc(db,'meter_data',docId));
      return snap.exists()?snap.data():null;
    } catch(e){
      console.warn('Firestore meter fetch failed:',e.message);
      return null;
    }
  }

  // Try METER_DATA (window global → localStorage)
  const _md = (typeof METER_DATA!=='undefined' && METER_DATA)
    || (() => { try { return JSON.parse(localStorage.getItem('METER_DATA')||'null'); } catch(e){ return null; } })();

  let d=null;
  if(_md&&_md[meterDataBuilding]&&_md[meterDataBuilding][key]){
    d=_md[meterDataBuilding][key][roomId];
  }

  // Try localStorage payment_status
  if(!d){
    const ps=JSON.parse(localStorage.getItem('payment_status')||'{}');
    if(ps[psKey]&&ps[psKey][roomId]) d=ps[psKey][roomId];
  }

  // Try Firestore for current month
  if(!d){
    d=await fetchFirestoreDoc(meterDataBuilding,yy,month,roomId);
  }

  let meterData=null;

  if(d){
    meterData=d;
  } else {
    // Try previous month as eOld baseline
    const prevMonth=month===1?12:month-1;
    const prevYear=month===1?year-1:year;
    const prevYy=prevYear%100;
    const prevKey=`${prevYy}_${prevMonth}`;
    const prevPsKey=`${prevYear}_${prevMonth}`;
    let prevD=null;

    if(_md&&_md[meterDataBuilding]&&_md[meterDataBuilding][prevKey]){
      prevD=_md[meterDataBuilding][prevKey][roomId];
    }
    if(!prevD){
      const ps=JSON.parse(localStorage.getItem('payment_status')||'{}');
      if(ps[prevPsKey]&&ps[prevPsKey][roomId]) prevD=ps[prevPsKey][roomId];
    }
    if(!prevD){
      prevD=await fetchFirestoreDoc(meterDataBuilding,prevYy,prevMonth,roomId);
    }

    if(prevD){
      meterData={eNew:'',eOld:prevD.eNew,wNew:'',wOld:prevD.wNew};
    }
  }

  if(meterData){
    document.getElementById('f-elec-new').value=(meterData.eNew!=null?meterData.eNew:'');
    document.getElementById('f-elec-old').value=(meterData.eOld!=null?meterData.eOld:'');
    document.getElementById('f-water-new').value=(meterData.wNew!=null?meterData.wNew:'');
    document.getElementById('f-water-old').value=(meterData.wOld!=null?meterData.wOld:'');
  } else {
    document.getElementById('f-elec-new').value='';
    document.getElementById('f-elec-old').value='';
    document.getElementById('f-water-new').value='';
    document.getElementById('f-water-old').value='';
  }

  calcBill();
}

function onRentTypeChange(){
  const isDaily=document.getElementById('f-rent-type').value==='daily';
  document.getElementById('dailyNightsField').style.display=isDaily?'flex':'none';
  document.getElementById('dailyRateField').style.display=isDaily?'flex':'none';
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(isDaily){
    const rate=parseFloat(opt?.dataset?.daily)||400;
    document.getElementById('f-daily-rate').value=rate;
    document.getElementById('f-rent').value=0;
  } else {
    document.getElementById('f-rent').value=opt?.dataset?.rent||0;
  }
  calcBill();
}

function calcBill(){
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0;
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate;
  const wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other;

  document.getElementById('f-elec-units').value=eUnits;
  document.getElementById('f-water-units').value=wUnits;
  document.getElementById('c-rent').textContent='฿'+rent.toLocaleString();
  document.getElementById('c-elec-label').textContent=`ค่าไฟ (${eUnits} หน่วย × ฿${eRate})`;
  document.getElementById('c-elec').textContent='฿'+eCost.toLocaleString();
  document.getElementById('c-water-label').textContent=`ค่าน้ำ (${wUnits} หน่วย × ฿${wRate})`;
  document.getElementById('c-water').textContent='฿'+wCost.toLocaleString();
  document.getElementById('c-trash').textContent='฿'+trash.toLocaleString();
  const ot=document.getElementById('c-other-row');
  ot.style.display=other>0?'flex':'none';
  document.getElementById('c-other').textContent='฿'+other.toLocaleString();
  document.getElementById('c-total').textContent='฿'+total.toLocaleString();
}

// ===== FORM VALIDATION FUNCTIONS =====

/**
 * Validate bill form before generating invoice
 */
function validateBillForm() {
  const errors = [];

  // Validate room selection
  const room = document.getElementById('f-room').value;
  if (!room) {
    errors.push('❌ กรุณาเลือกห้อง');
  } else if (room.length > 20) {
    errors.push('❌ เลขห้องต้องไม่เกิน 20 ตัวอักษร');
  }

  // Validate rent amount
  const isDaily = document.getElementById('f-rent-type')?.value === 'daily' &&
                  document.getElementById('dailySection').classList.contains('show');

  if (isDaily) {
    const nights = parseFloat(document.getElementById('f-nights').value) || 0;
    const dailyRate = parseFloat(document.getElementById('f-daily-rate').value) || 0;
    if (nights <= 0) errors.push('❌ จำนวนคืนต้องมากกว่า 0');
    if (dailyRate <= 0) errors.push('❌ ราคารายวันต้องมากกว่า 0');
  } else {
    const rent = parseFloat(document.getElementById('f-rent').value) || 0;
    if (rent <= 0) errors.push('❌ ค่าเช่าต้องมากกว่า 0');
  }

  // Validate electricity readings
  const eNewVal = document.getElementById('f-elec-new').value;
  const eOldVal = document.getElementById('f-elec-old').value;
  const eNew = eNewVal && eNewVal !== '-' ? parseFloat(eNewVal) || 0 : 0;
  const eOld = eOldVal && eOldVal !== '-' ? parseFloat(eOldVal) || 0 : 0;
  const eRate = parseFloat(document.getElementById('f-elec-rate').value) || 0;
  if (eNew < 0 || eOld < 0) errors.push('❌ เลขมิเตอร์ไฟต้องเป็นจำนวนบวก');
  if (eRate < 0) errors.push('❌ ราคาไฟต้องเป็นจำนวนบวก');
  if (eNew < eOld && eNew > 0) errors.push('⚠️ เลขมิเตอร์ไฟล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate water readings
  const wNewVal = document.getElementById('f-water-new').value;
  const wOldVal = document.getElementById('f-water-old').value;
  const wNew = wNewVal && wNewVal !== '-' ? parseFloat(wNewVal) || 0 : 0;
  const wOld = wOldVal && wOldVal !== '-' ? parseFloat(wOldVal) || 0 : 0;
  const wRate = parseFloat(document.getElementById('f-water-rate').value) || 0;
  if (wNew < 0 || wOld < 0) errors.push('❌ เลขมิเตอร์น้ำต้องเป็นจำนวนบวก');
  if (wRate < 0) errors.push('❌ ราคาน้ำต้องเป็นจำนวนบวก');
  if (wNew < wOld && wNew > 0) errors.push('⚠️ เลขมิเตอร์น้ำล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate other charges
  const trash = parseFloat(document.getElementById('f-trash').value) || 0;
  const other = parseFloat(document.getElementById('f-other').value) || 0;
  if (trash < 0) errors.push('❌ ค่าขยะต้องเป็นจำนวนบวก');
  if (other < 0) errors.push('❌ ค่าบริการต้องเป็นจำนวนบวก');

  // Validate year
  const year = parseInt(document.getElementById('f-year').value);
  if (year < 2560 || year > 2590) errors.push('❌ ปีต้องอยู่ระหว่าง 2560-2590');

  // Validate note length
  const note = document.getElementById('f-note').value;
  if (note.length > 500) errors.push('❌ หมายเหตุต้องไม่เกิน 500 ตัวอักษร');

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate maintenance request form
 */
function validateMaintenanceForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('mx-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้อง');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate date
  const date = document.getElementById('mx-date').value;
  if (!date) {
    errors.push('❌ กรุณาเลือกวันที่แจ้ง');
  } else {
    const selectedDate = new Date(date);
    const today = new Date();
    if (selectedDate > today) {
      errors.push('❌ ไม่สามารถเลือกวันที่ในอนาคตได้');
    }
  }

  // Validate description
  const desc = document.getElementById('mx-desc').value.trim();
  if (!desc) {
    errors.push('❌ กรุณากรอกรายละเอียดปัญหา');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  // Validate category and priority (they have default values so always valid)

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate tenant maintenance form
 */
function validateTenantForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('tp-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้องของคุณ');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate description
  const desc = document.getElementById('tp-description').value.trim();
  if (!desc) {
    errors.push('❌ กรุณาอธิบายปัญหาของคุณ');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Show validation errors in alert
 */
function showValidationErrors(errors) {
  if (errors.length === 0) return false;
  showToast('ข้อมูลไม่ครบถ้วน:\n\n' + errors.join('\n'), 'warning');
  return true;
}

function getBillData(){
  const room=document.getElementById('f-room').value;
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0,rentLabel='ค่าเช่าห้อง';
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate; rentLabel=`ค่าเช่ารายวัน (${nights} คืน × ฿${rate})`;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate, wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  const note=document.getElementById('f-note').value;
  const building=getBuildingInfo(currentBuilding).displayName;
  const now=new Date();
  const no=`TGH-${year}${String(month).padStart(2,'0')}-${room.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const dateStr=now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
  return{room,building,rent,rentLabel,eNew,eOld,eUnits,eRate,eCost,wNew,wOld,wUnits,wRate,wCost,trash,other,total,month,year,note,no,dateStr,now};
}

// ===== SLIPOK VERIFICATION =====
// ✅ SlipOK API keys are now secured in Firebase Cloud Functions
// Client no longer exposes API credentials - all calls go through secure backend
let slipVerified = false;
let slipData = null;

// === RATE LIMITING (Dashboard) ===
const DASHBOARD_RATE_LIMIT_CONFIG = {
  slipVerification: { maxRequests: 3, windowMs: 60000 }, // 3 requests per minute
  billUpload: { maxRequests: 5, windowMs: 3600000 }       // 5 uploads per hour
};
const dashboardRateLimitTracker = {};

function checkDashboardRateLimit(key) {
  const now = Date.now();
  const config = DASHBOARD_RATE_LIMIT_CONFIG[key];
  if (!config) return true;

  if (!dashboardRateLimitTracker[key]) {
    dashboardRateLimitTracker[key] = [];
  }

  // Remove old requests outside the window
  dashboardRateLimitTracker[key] = dashboardRateLimitTracker[key].filter(time => now - time < config.windowMs);

  if (dashboardRateLimitTracker[key].length >= config.maxRequests) {
    return false;
  }

  dashboardRateLimitTracker[key].push(now);
  return true;
}

function validateSlipFileAdmin(file) {
  const errors = [];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`❌ ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push('❌ รูปแบบไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }

  return errors;
}

function handleSlipDrop(e){
  e.preventDefault();
  document.getElementById('slipDropArea').classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if(file) verifySlip(file);
}

async function verifySlip(file){
  if(!file) return;

  // Validate file
  const validationErrors = validateSlipFileAdmin(file);
  if (validationErrors.length > 0) {
    const resultEl = document.getElementById('slipResult');
    resultEl.innerHTML = `<div style="color: #d32f2f; padding: 1rem; background: #ffebee; border-radius: 6px;">${validationErrors.join('<br>')}</div>`;
    return;
  }

  const resultEl = document.getElementById('slipResult');
  const dropText = document.getElementById('slipDropText');

  // Show image preview + loading state
  const reader = new FileReader();
  reader.onload = ev => {
    dropText.innerHTML = `\x3cimg src="${ev.target.result}" style="max-height:90px;border-radius:6px;object-fit:contain;margin-bottom:4px;">\x3cbr>\x3csmall style="color:var(--text-muted);">⏳ กำลังตรวจสอบกับ SlipOK...\x3c/small>`;
  };
  reader.readAsDataURL(file);
  resultEl.innerHTML = '';

  try {
    // Check rate limit
    if (!checkDashboardRateLimit('slipVerification')) {
      throw new Error('⏱️ คำขอมากเกินไป โปรดลองใหม่ในเวลาไม่กี่วินาที');
    }
    // Convert file to base64 for Cloud Function
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const billTotal = invoiceData?.total || 0;
    const room = invoiceData?.room || 'unknown';
    // invoiceData.building is a display name — map to 'rooms' or 'nest' for Cloud Function
    const buildingRaw = (currentBuilding === 'nest') ? 'nest' : 'rooms';
    // Call Firebase Cloud Function (API key secured server-side)
    const res = await fetch('https://us-central1-the-green-haven.cloudfunctions.net/verifySlip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, expectedAmount: billTotal || 1, building: buildingRaw, room })
    });
    if (!res.ok && res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Cloud Function error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = await res.json();

    if(json.success && json.data){
      const d = json.data;
      const amount  = d.amount ?? 0;
      const sender  = d.sender?.displayName || d.sender?.name || '—';
      const receiver= d.receiver?.displayName || d.receiver?.name || '—';
      const ref     = d.transRef || d.transactionId || '—';
      // SlipOK returns transTimestamp (ISO) + transDate (YYYYMMDD) + transTime (HH:MM:SS)
      const transferDate = d.transTimestamp || null;
      const tDate   = transferDate ? new Date(transferDate).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : '—';
      const amountOk  = json.amountValid !== undefined ? json.amountValid : (billTotal <= 0 || Math.abs(amount - billTotal) < 1);

      slipVerified = true;
      slipData = {amount, sender, receiver, ref, tDate, transferDate, amountOk};

      resultEl.innerHTML = `
        <div class="slip-result-ok">
          <div style="font-weight:700;font-size:.88rem;color:var(--green-dark);margin-bottom:6px;">✅ สลิปผ่านการตรวจสอบ!</div>
          <div class="slip-result-row"><span>ผู้โอน</span><span><strong>${sender}</strong></span></div>
          <div class="slip-result-row"><span>ผู้รับ</span><span>${receiver}</span></div>
          <div class="slip-result-row"><span>จำนวนเงิน</span>
            <span class="${amountOk?'slip-amount-ok':'slip-amount-warn'}">฿${amount.toLocaleString()} ${amountOk?'✅':'⚠️ ยอดไม่ตรงกับบิล'}</span></div>
          <div class="slip-result-row"><span>วันเวลา</span><span>${tDate}</span></div>
          <div class="slip-result-row"><span>เลขอ้างอิง</span><span style="font-size:.75rem;word-break:break-all;">${ref}</span></div>
        </div>`;
      enableReceiptBtn();
    } else {
      const msg = json.message || json.data?.message || 'ไม่ทราบสาเหตุ';
      resultEl.innerHTML = `<div class="slip-result-err">❌ <strong>สลิปไม่ผ่าน:</strong> ${msg}<br><small>ลองถ่ายรูปใหม่ให้คมชัดขึ้น หรือตรวจว่าสลิปถูกต้อง</small></div>`;
    }
  } catch(err){
    console.error('❌ verifySlip error:', err);
    resultEl.innerHTML = `<div class="slip-result-err">⚠️ เชื่อมต่อ Cloud Function ไม่ได้<br>
      <small>${err.message || 'Network error'}</small><br>
      <button onclick="skipSlipVerify()" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:#fff;">ออกใบเสร็จโดยไม่ตรวจสลิป</button>
    </div>`;
  }
}

function skipSlipVerify(){
  slipVerified = false;
  slipData = null;
  document.getElementById('slipResult').innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0;">ข้ามการตรวจสลิป (รับเงินสด) — กดออกใบเสร็จได้เลย ✅</div>';
  enableReceiptBtn();
}

function enableReceiptBtn(){
  const btn = document.getElementById('btnReceipt');
  btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
  document.getElementById('billHint').textContent = slipVerified
    ? `✅ ตรวจสลิปผ่าน ฿${slipData.amount.toLocaleString()} (${slipData.sender}) — กดออกใบเสร็จได้เลย`
    : '✅ พร้อมออกใบเสร็จ — กดปุ่มด้านบน';
}

// ===== PROMPTPAY QR =====
let PROMPTPAY_NUMBER = (typeof SecureConfig !== 'undefined' ? localStorage.getItem(SecureConfig.promptpay.storageKey) : localStorage.getItem('promptpay')) || '';

function savePromptPay(){
  const v=(document.getElementById('pp-input')?.value||'').trim();
  PROMPTPAY_NUMBER=v;
  localStorage.setItem('promptpay',v);
  const st=document.getElementById('pp-status');
  if(st)st.textContent=v?'✅ บันทึกแล้ว':'';
}

function buildPromptPayPayload(phone,amount){
  const s=phone.replace(/[^0-9]/g,'');
  const t=s.startsWith('0')?'0066'+s.slice(1):s;
  const aid='0016A000000677010111'+'01'+String(t.length).padStart(2,'0')+t;
  const a=amount.toFixed(2);
  let p='000201'+'010212'+'29'+String(aid.length).padStart(2,'0')+aid+'5303764'+'54'+String(a.length).padStart(2,'0')+a+'5802TH'+'6304';
  let c=0xFFFF;
  for(let i=0;i<p.length;i++){c^=p.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=(c&0x8000)?((c<<1)^0x1021):(c<<1);}
  return p+(c&0xFFFF).toString(16).toUpperCase().padStart(4,'0');
}

function renderQR(elementId,amount){
  const el=document.getElementById(elementId);
  if(!el)return;
  if(!PROMPTPAY_NUMBER){el.style.display='none';return;}
  try{
    const payload=buildPromptPayPayload(PROMPTPAY_NUMBER,amount);
    const wrap=document.createElement('div');
    new QRCode(wrap,{text:payload,width:160,height:160,correctLevel:QRCode.CorrectLevel.M});
    setTimeout(()=>{
      const src=wrap.querySelector('canvas')?.toDataURL()||wrap.querySelector('img')?.src||'';
      el.src=src; el.style.display=src?'block':'none';
    },120);
  }catch(e){console.warn('QR generation failed:',e);el.style.display='none';}
}

let isGeneratingInvoice = false; // Prevent rapid clicks
function generateInvoice(){
  // Prevent rapid button clicks
  if(isGeneratingInvoice) return;
  isGeneratingInvoice = true;
  setTimeout(() => { isGeneratingInvoice = false; }, 1500);

  // Validate bill form before processing
  const validation = validateBillForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    isGeneratingInvoice = false;
    return;
  }

  const d=getBillData();
  if(!d.room||d.total===0){showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');return;}
  invoiceData=d;

  // Due date = 5th of next month
  const due=new Date(d.now); due.setDate(5); if(due<=d.now)due.setMonth(due.getMonth()+1);
  const dueStr=due.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide receipt panel to show only invoice
  document.getElementById('receiptPanel').style.display='none';
  document.getElementById('invoicePanel').style.display='block';

  document.getElementById('invoicePanel').innerHTML=buildDocHTML(d,'invoice',dueStr);
  renderQR('qr-payment', d.total); // generate PromptPay QR with bill amount

  // ===== AUDIT LOGGING =====
  if (window.logBillGenerated) {
    window.logBillGenerated(d.room, d.total, { invoiceNumber: d.no, building: d.building, month: d.month, year: d.year });
  }

  // Show slip verification section (instead of auto-enabling receipt)
  slipVerified=false; slipData=null;
  document.getElementById('slipResult').innerHTML='';
  document.getElementById('slipDropText').innerHTML='🖼️ แตะเพื่ออัปโหลดสลิป หรือลากมาวางที่นี่<br><small>SlipOK ตรวจสอบชื่อ ยอด วันเวลา สลิปซ้ำ ภายใน 3 วินาที</small>';
  document.getElementById('slipFileInput').value='';
  document.getElementById('slipVerifySection').classList.add('show');
  document.getElementById('billHint').textContent='📲 อัปโหลดสลิปเพื่อตรวจสอบ → จากนั้นออกใบเสร็จได้เลย';
  document.getElementById('step1').className='step done';
  document.getElementById('step2').className='step active';
  document.getElementById('invoicePanel').scrollIntoView({behavior:'smooth'});
}

let isGeneratingReceipt = false; // Prevent rapid clicks
function generateReceipt(){
  if(isGeneratingReceipt) return;
  isGeneratingReceipt = true;
  setTimeout(() => { isGeneratingReceipt = false; }, 1500);

  if(!invoiceData){showToast('กรุณาส่งใบวางบิลก่อน', 'warning');isGeneratingReceipt = false;return;}
  const d=invoiceData;
  const payDate=new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide invoice panel to show only receipt
  document.getElementById('invoicePanel').style.display='none';
  document.getElementById('receiptPanel').style.display='block';

  // ===== AUDIT LOGGING =====
  if (window.AuditLogger) {
    window.AuditLogger.log(
      window.AuditActionTypes.RECEIPT_GENERATED,
      `Generated receipt for room ${d.room}: ฿${d.total.toLocaleString()}`,
      { room: d.room, amount: d.total, receiptNumber: d.no, slipVerified: slipVerified }
    );
  }
  // Attach slip verification result if available
  const slipNote = slipVerified && slipData
    ? `<div style="margin-top:10px;padding:8px;background:#e8f5e9;border-radius:6px;font-size:.78rem;color:var(--green-dark);">✅ ยืนยันด้วย SlipOK · ผู้โอน: ${slipData.sender} · ฿${slipData.amount.toLocaleString()} · ${slipData.tDate}</div>`
    : '';
  document.getElementById('receiptPanel').innerHTML=buildDocHTML(d,'receipt',null,payDate)+slipNote;
  document.getElementById('step2').className='step done';
  document.getElementById('slipVerifySection').classList.remove('show');
  markRoomPaid(d); // บันทึกสถานะห้องนี้ว่าชำระแล้ว
  document.getElementById('receiptPanel').scrollIntoView({behavior:'smooth'});
}

function buildDocHTML(d,type,dueDate,payDate){
  const isInvoice=type==='invoice';
  const color=isInvoice?'var(--blue)':'var(--green-dark)';
  const titleText=isInvoice?'ใบวางบิล / Invoice':'ใบเสร็จรับเงิน / Receipt';
  const stamp=isInvoice?`<div class="doc-stamp stamp-pending">⏳ รอชำระ</div>`:`<div class="doc-stamp stamp-paid">✅ ชำระแล้ว</div>`;
  const due=isInvoice?`<div class="due-box">⏰ กรุณาชำระภายใน ${dueDate}</div>`:'';

  // QR PromptPay section — แสดงในใบวางบิลเท่านั้น (ก่อนชำระ)
  const qrSection = PROMPTPAY_NUMBER ? `
    <div class="qr-section">
      <div class="qr-title">📲 สแกน QR เพื่อชำระเงิน</div>
      <img id="qr-payment" src="" alt="QR PromptPay" style="width:160px;height:160px;border-radius:8px;border:4px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.15);">
      <div><div class="qr-amount-badge">฿${d.total.toLocaleString()}</div></div>
      <div class="qr-footer-text">พร้อมเพย์: ${PROMPTPAY_NUMBER}<br>สแกนแล้วยอดขึ้นอัตโนมัติ ไม่ต้องพิมพ์ตัวเลข</div>
    </div>` : '';

  const docId = isInvoice ? 'doc-invoice' : 'doc-receipt';
  return`
  <div id="${docId}" class="doc-body">
    <div class="doc-header">
      <div class="doc-logo">🌿 The Green Haven</div>
      <div class="doc-sub">${d.building}</div>
      <div class="doc-title ${type}">${titleText}</div>
      <div class="doc-no">เลขที่: ${d.no}</div>
    </div>
    <div class="doc-content">
      <div class="d-row"><span>ห้องเลขที่:</span><strong>ห้อง ${d.room}</strong></div>
      <div class="d-row"><span>ประจำเดือน:</span><strong>${MONTHS_FULL[d.month]} ${d.year}</strong></div>
      <div class="d-row"><span>${isInvoice?'วันที่ออกบิล':'วันที่ชำระ'}:</span><span>${isInvoice?d.dateStr:payDate}</span></div>
      <hr class="d-divider">
      <div class="d-row"><span>${d.rentLabel}</span><span>฿${d.rent.toLocaleString()}</span></div>
      ${d.eOld!=null||d.eNew!=null?`<div class="d-row"><span>ค่าไฟฟ้า</span><span>฿${(d.eCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์ไฟ: ${d.eOld||0} → ${d.eNew||0} (${d.eUnits||0} หน่วย × ฿${d.eRate||0})</span></div>`:''}
      ${d.wOld!=null||d.wNew!=null?`<div class="d-row"><span>ค่าน้ำประปา</span><span>฿${(d.wCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์น้ำ: ${d.wOld||0} → ${d.wNew||0} (${d.wUnits||0} หน่วย × ฿${d.wRate||0})</span></div>`:''}
      ${d.trash>0?`<div class="d-row"><span>ค่าขยะ</span><span>฿${d.trash.toLocaleString()}</span></div>`:''}
      ${d.other>0?`<div class="d-row"><span>ค่าบริการอื่นๆ</span><span>฿${d.other.toLocaleString()}</span></div>`:''}
      ${d.note?`<div class="d-row" style="font-size:.78rem;color:var(--accent);"><span>หมายเหตุ:</span><span>${d.note}</span></div>`:''}
      <div class="d-total ${type}"><span>รวมทั้งสิ้น</span><span>฿${d.total.toLocaleString()}</span></div>
    </div>
    ${isInvoice ? qrSection : ''}
    <div class="doc-footer">
      ${due}${stamp}
      <div>ขอบคุณที่ใช้บริการ The Green Haven</div>
      ${!isInvoice?'<div>กรุณาเก็บใบเสร็จไว้เป็นหลักฐาน</div>':''}
    </div>
  </div>
  <div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
    <button class="btn-doc-action ${isInvoice?'blue':'green'}" onclick="printDoc('${docId}')">🖨️ พิมพ์ / บันทึก PDF</button>
  </div>`;
}

function resetBillFlow(){
  invoiceData=null; slipVerified=false; slipData=null;
  document.getElementById('invoicePanel').innerHTML=`<div class="doc-placeholder"><div class="icon">📄</div><div style="font-size:.9rem;font-weight:600;">กรอกข้อมูลและกด "ส่งใบวางบิล"</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 1 — แจ้งยอดก่อนชำระ</div></div>`;
  document.getElementById('receiptPanel').innerHTML=`<div class="doc-placeholder"><div class="icon">✅</div><div style="font-size:.9rem;font-weight:600;">กด "ออกใบเสร็จรับเงิน" หลังรับเงินแล้ว</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 2 — ยืนยันการชำระเงิน</div></div>`;
  document.getElementById('btnReceipt').disabled=true;
  document.getElementById('btnReceipt').style.opacity='.4';
  document.getElementById('btnReceipt').style.cursor='not-allowed';
  document.getElementById('billHint').textContent='ส่งใบวางบิลก่อน → อัปโหลดสลิป → ออกใบเสร็จรับเงิน';
  document.getElementById('step1').className='step active';
  document.getElementById('step2').className='step pending';
  document.getElementById('slipVerifySection').classList.remove('show');
  document.getElementById('slipResult').innerHTML='';
}

// ===== PRINT DOC — popup หน้าเดียว ไม่มี header/footer ของ browser =====
let printWindow = null; // Track print window to prevent accumulation

let isPrinting = false; // Prevent rapid print requests
function printDoc(docId){
  // Prevent rapid print requests
  if(isPrinting) return;
  isPrinting = true;
  setTimeout(() => { isPrinting = false; }, 2000);

  // Close previous print window if still open
  if(printWindow && !printWindow.closed){
    try{printWindow.close();}catch(e){}
  }

  const el=document.getElementById(docId);
  if(!el){showToast('ไม่พบเอกสาร', 'error');return;}
  // รวม styles ทั้งหมดจากหน้าหลัก
  const styles=[...document.querySelectorAll('style')].map(s=>s.innerHTML).join('\n');
  const fonts='<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
  const content=el.outerHTML;
  const html=`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">${fonts}
<style>
${styles}
/* Print overrides - let browser print dialog handle page size */
@page{margin:10mm;}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:#fff!important;padding:0;margin:0;}
  .doc-body{max-width:100%!important;box-shadow:none!important;padding:15mm;}
  .btn-doc-action{display:none!important;}
}
</style></head>
<body>${content}</body></html>`;

  printWindow=window.open('','_blank','width=420,height=700,toolbar=0,menubar=0,scrollbars=1');
  if(!printWindow){showToast('Pop-up ถูกบล็อก — กรุณาอนุญาต pop-up สำหรับ localhost', 'warning');return;}

  // ตั้งให้ปิดเมื่อ unload
  printWindow.onunload = () => { printWindow = null; };

  printWindow.document.write(html);
  printWindow.document.close();

  // รอ QR image โหลดก่อน print
  const imgs=printWindow.document.querySelectorAll('img');
  const doPrint=()=>{
    try{printWindow.focus();printWindow.print();}catch(e){}
    // Force close window หลัง print dialog (รอเพื่อให้ user กด Save/Cancel)
    setTimeout(()=>{
      if(printWindow && !printWindow.closed){
        try{printWindow.close();}catch(e){}
      }
      printWindow = null; // Clear reference completely
    }, 1000);
  };

  if(imgs.length===0){
    setTimeout(doPrint,400);
  } else {
    let done=0;
    const tryPrint=()=>{if(++done>=imgs.length)setTimeout(doPrint,200);};
    imgs.forEach(img=>{img.complete?tryPrint():(img.onload=tryPrint,img.onerror=tryPrint);});
    setTimeout(doPrint,3000); // fallback 3 วิ
  }
}

// ===== PAYMENT STATUS TRACKING =====
function loadPS(){return JSON.parse(localStorage.getItem('payment_status')||'{}');}
function savePS(ps){localStorage.setItem('payment_status',JSON.stringify(ps));}

function markRoomPaid(d){
  const ps=loadPS();
  const key=`${d.year}_${d.month}`;
  if(!ps[key])ps[key]={};
  ps[key][d.room]={
    status:'paid', amount:d.total, date:new Date().toISOString(),
    receiptNo:d.no, eNew:d.eNew, eOld:d.eOld, wNew:d.wNew, wOld:d.wOld,
    slip:slipVerified?{
      amount:slipData.amount,
      sender:slipData.sender,
      receiver:slipData.receiver,
      ref:slipData.ref,
      tDate:slipData.tDate,
      transferDate:slipData.transferDate,  // ISO datetime — for on-time gamification
      dueDate:`${d.year}-${String(d.month).padStart(2,'0')}-05`,  // 5th of billing month
      amountOk:slipData.amountOk
    }:null
  };
  savePS(ps);
  renderPaymentStatus();

  // ===== SYNC BILL STATUS → bills_YYYY (tenant app reads this) =====
  if (typeof BillingSystem !== 'undefined') {
    const yr = parseInt(d.year);
    const bill = BillingSystem.getBillByMonthYear(d.room, d.month, yr);
    if (bill) {
      BillingSystem.updateBillStatus(bill.billId, 'paid', yr);
      console.log(`🔄 Synced bill status to bills_${yr}: room ${d.room} month ${d.month} → paid`);
    }
  }

  // ===== SYNC PAYMENT RECORD → payment_{building}_{room} (tenant history) =====
  try {
    const fbBuilding = (typeof getBuildingInfo === 'function')
      ? getBuildingInfo(currentBuilding).firebaseBuilding
      : (currentBuilding === 'old' ? 'rooms' : 'nest');
    const phKey = `payment_${fbBuilding}_${d.room}`;
    const history = JSON.parse(localStorage.getItem(phKey) || '[]');
    history.unshift({
      billId: d.no,
      month: d.month,
      year: parseInt(d.year),
      amount: d.total,
      paidAt: new Date().toISOString(),
      method: slipVerified ? 'PromptPay' : 'Cash',
      slipOkVerified: !!slipVerified
    });
    localStorage.setItem(phKey, JSON.stringify(history));
    console.log(`💾 Synced payment history → ${phKey}`);
  } catch(e) { console.warn('payment history sync failed', e); }

  // ===== SAVE BILL TO FIREBASE FOR TENANT APP =====
  saveBillToFirebase(d);
}

async function saveBillToFirebase(d){
  try {
    if (!window.firebaseDatabase || !window.firebaseSet) {
      console.warn('⚠️ Firebase not initialized, skipping bill save');
      return;
    }

    // Create bill object with all necessary data for tenant app
    const billObject = {
      billId: d.no,
      room: d.room,
      building: d.building,
      month: d.month,
      year: d.year,
      status: 'paid',
      billDate: d.dateStr,
      totalCharge: d.total,
      charges: {
        rent: d.rent,
        rentLabel: d.rentLabel,
        electric: {
          cost: d.eCost || 0,
          old: d.eOld || 0,
          new: d.eNew || 0,
          units: d.eUnits || 0,
          rate: d.eRate || 8
        },
        water: {
          cost: d.wCost || 0,
          old: d.wOld || 0,
          new: d.wNew || 0,
          units: d.wUnits || 0,
          rate: d.wRate || 20
        },
        trash: d.trash || 0,
        common: d.other || 0
      },
      meterReadings: {
        electric: { old: d.eOld || 0, new: d.eNew || 0, units: d.eUnits || 0 },
        water: { old: d.wOld || 0, new: d.wNew || 0, units: d.wUnits || 0 }
      },
      note: d.note || '',
      createdAt: new Date().toISOString(),
      slipVerified: slipVerified,
      slipData: slipVerified && slipData ? {
        amount: slipData.amount,
        sender: slipData.sender,
        receiver: slipData.receiver,
        ref: slipData.ref,
        tDate: slipData.tDate,
        transferDate: slipData.transferDate,  // ISO — actual transfer time
        dueDate: `${d.year}-${String(d.month).padStart(2,'0')}-05`,
        paidOnTime: slipData.transferDate
          ? new Date(slipData.transferDate) <= new Date(`${d.year}-${String(d.month).padStart(2,'0')}-05T23:59:59`)
          : null
      } : null
    };

    // Save to Firebase: bills/{building}/{roomId}/{billId}
    // Tenant app expects: bills/{building}/{room} as an object with billIds as keys
    const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');

    // Determine Firebase building ID using proper conversion
    // currentBuilding is 'old' or 'new', need to convert to 'rooms' or 'nest'
    const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);

    // Save bill at bills/{building}/{room}/{billId}
    const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${d.room}/${d.no}`);
    await window.firebaseSet(billsRef, billObject);

    console.log(`✅ Bill saved to Firebase: bills/${fbBuildingId}/${d.room}/${d.no}`);
  } catch (error) {
    console.error('❌ Error saving bill to Firebase:', error);
  }
}

// ===== AUTO-GENERATE BILLS FROM FIREBASE METER DATA =====
async function autoGenerateAllBills() {
  const month = parseInt(document.getElementById('f-month').value);
  const year = document.getElementById('f-year').value;
  const bldgInfo = getBuildingInfo(currentBuilding);
  const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);

  // VERIFICATION #1: Check room count before generation
  const expectedRoomCount = fbBuildingId === 'rooms' ? 23 : 10; // 23 for Rooms, 10 for Nest
  const actualRoomCount = rooms.length;

  if (actualRoomCount !== expectedRoomCount) {
    const proceed = confirm(
      `⚠️ Warning: Expected ${expectedRoomCount} rooms but found ${actualRoomCount}.\n\n` +
      `This may result in incomplete bill generation.\n\n` +
      `Continue anyway?`
    );
    if (!proceed) {
      console.log('❌ Bill generation cancelled by user');
      return;
    }
  }

  console.log(`🚀 Auto-generating bills for ${fbBuildingId}/${month}/${year}... (${actualRoomCount} rooms)`);

  try {
    // Get meter data from Firebase for this month
    const yearMonth = `${year % 100}_${String(month).padStart(2, '0')}`;
    const meterData = await FirebaseMeterHelper.getMeterDataForMonth(fbBuildingId, yearMonth);

    if (!meterData) {
      showToast(`ไม่พบข้อมูลมิเตอร์สำหรับ ${MONTHS_FULL[month]} ${year + 543}`, 'error');
      return;
    }

    let generatedCount = 0;
    const generatedBills = [];
    const totalMeterEntries = Object.entries(meterData).length;

    // Generate bill for each room with meter data
    for (const [roomId, meterReadings] of Object.entries(meterData)) {
      // Show progress
      const progressPercent = Math.round((generatedCount / totalMeterEntries) * 100);
      console.log(`📊 Generating bills... ${generatedCount}/${totalMeterEntries} (${progressPercent}%)`);
      // Get room config
      const roomConfig = rooms.find(r => r.id === roomId);
      if (!roomConfig) continue;

      const rent = roomConfig.rent || 0;
      const eRate = roomConfig.elecRate || 8;
      const wRate = 20; // Standard water rate
      const trash = roomConfig.trashFee || 20;

      // Calculate costs from meter data
      const eUnits = Math.max(0, (meterReadings.eNew || 0) - (meterReadings.eOld || 0));
      const wUnits = Math.max(0, (meterReadings.wNew || 0) - (meterReadings.wOld || 0));
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      // Create bill object
      const now = new Date();
      const billObject = {
        billId: `TGH-${year}${String(month).padStart(2,'0')}-${roomId.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`,
        room: roomId,
        building: bldgInfo.displayName,
        month: month,
        year: year,
        status: 'pending',
        billDate: now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}),
        totalCharge: total,
        charges: {
          rent: rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: meterReadings.eOld || 0,
            new: meterReadings.eNew || 0,
            units: eUnits || 0,
            rate: eRate || 8
          },
          water: {
            cost: wCost || 0,
            old: meterReadings.wOld || 0,
            new: meterReadings.wNew || 0,
            units: wUnits || 0,
            rate: wRate || 20
          },
          trash: trash || 0,
          common: 0
        },
        meterReadings: {
          electric: { old: meterReadings.eOld || 0, new: meterReadings.eNew || 0, units: eUnits || 0 },
          water: { old: meterReadings.wOld || 0, new: meterReadings.wNew || 0, units: wUnits || 0 }
        },
        note: '',
        createdAt: new Date().toISOString()
      };

      // Save to Firebase
      try {
        const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');
        const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${roomId}/${billObject.billId}`);
        await window.firebaseSet(billsRef, billObject);

        generatedCount++;
        generatedBills.push(`${roomId}: ฿${total.toLocaleString()}`);
        console.log(`✅ Bill generated: ${fbBuildingId}/${roomId}/${billObject.billId}`);
      } catch (e) {
        console.error(`❌ Error saving bill for ${roomId}:`, e);
      }
    }

    // VERIFICATION #2: Check if all expected bills were generated
    const missingRooms = rooms.filter(r => !generatedBills.some(b => b.includes(r.id)));

    if (generatedCount === 0) {
      showToast(`ไม่มีบิลที่สร้างได้ (ตรวจสอบข้อมูลมิเตอร์)`, 'warning');
      return;
    }

    let message = `✅ สร้างบิลสำเร็จ ${generatedCount}/${actualRoomCount} ห้อง\n\n${generatedBills.join('\n')}`;

    if (generatedCount < actualRoomCount) {
      const missingRoomIds = missingRooms.map(r => r.id).join(', ');
      message += `\n\n⚠️ ไม่พบข้อมูลมิเตอร์สำหรับ: ${missingRoomIds}`;
    }

    if (generatedCount === actualRoomCount) {
      message = `✅ สร้างบิลครบทั้ง ${generatedCount} ห้องแล้ว!\n\n${generatedBills.join('\n')}`;
    }

    showToast(message, 'success');
    console.log(`📊 Auto-generated ${generatedCount}/${actualRoomCount} bills for ${MONTHS_FULL[month]} ${year + 543}`);
  } catch (error) {
    console.error('❌ Error in auto-generate bills:', error);
    showToast(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
  }
}

function renderPaymentStatus(){
  const el=document.getElementById('payStatusGrid');if(!el)return;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  const ps=loadPS();
  const key=`${year}_${month}`;
  const paid=ps[key]||{};
  // Map building names and get active rooms
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  const monthName=MONTHS_FULL[month]||month;
  const countPaid=Object.keys(paid).length;
  el.innerHTML=`<div style="font-size:.8rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">
    📋 สถานะการชำระ — ${monthName} ${year} &nbsp;
    <span style="color:var(--green)">✅ จ่ายแล้ว ${countPaid}</span> /
    <span style="color:var(--accent)">⏳ รอ ${rooms.length-countPaid}</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;">
  ${rooms.map(r=>{
    const p=paid[r.id];
    if(p){
      return`<span onclick="showPayDetail('${r.id}')" title="คลิกดูรายละเอียด / แก้ไข" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:700;background:#e8f5e9;color:var(--green-dark);border:1px solid #a5d6a7;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#c8e6c9'" onmouseout="this.style.background='#e8f5e9'">✅ ${r.id}</span>`;
    } else {
      return`<span onclick="selectRoomForBill('${r.id}')" title="คลิกเพื่อออกบิล" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:600;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;cursor:pointer;">⏳ ${r.id}</span>`;
    }
  }).join('')}
  </div>`;
}

function selectRoomForBill(roomId){
  // เปลี่ยนไปหน้า ออกบิล แล้วเลือกห้องนั้นเลย
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-bill').classList.add('active');
  document.querySelector('[onclick*="showPage(\'bill\'"]')?.classList.add('active');
  document.getElementById('f-room').value=roomId;
  onRoomChange();
  document.getElementById('f-room').scrollIntoView({behavior:'smooth'});
}

// ===== PAYMENT DETAIL MODAL =====
let payModalRoomId=null, payModalYear=null, payModalMonth=null;

function showPayDetail(roomId, year, month){
  const month2 = month ?? parseInt(document.getElementById('f-month')?.value||new Date().getMonth()+1);
  const year2  = year  ?? (document.getElementById('f-year')?.value||String(new Date().getFullYear()+543));
  payModalRoomId=roomId; payModalYear=String(year2); payModalMonth=month2;

  const ps=loadPS();
  const key=`${year2}_${month2}`;
  const p=ps[key]?.[roomId];
  const monthName=MONTHS_FULL[month2]||month2;

  document.getElementById('payModalTitle').textContent=`📋 ห้อง ${roomId} — ${monthName} ${year2}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');

  if(p){
    const paidDate=new Date(p.date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});
    const editedBadge=p.editedAt?`<span style="font-size:.73rem;color:var(--accent)"> · แก้ไขล่าสุด ${new Date(p.editedAt).toLocaleDateString('th-TH')}</span>`:'';
    body.innerHTML=`
      <div style="background:var(--green-pale);border-radius:8px;padding:.65rem .85rem;font-size:.82rem;line-height:1.7;">
        ✅ ชำระแล้ว · <strong>${p.receiptNo}</strong> · ${paidDate}${editedBadge}
        ${p.slip?`<br>💳 SlipOK: ${p.slip.sender||'—'} · ฿${(p.slip.amount||0).toLocaleString()}`:''}
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.4rem 0 2px;">✏️ แก้ไขมิเตอร์ (ถ้ากรอกผิด)</div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ ล่าสุด (eNew)</span><input class="pm-input" id="pm-eNew" type="number" value="${p.eNew??0}"></div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ เดิม (eOld)</span><input class="pm-input" id="pm-eOld" type="number" value="${p.eOld??0}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ ล่าสุด (wNew)</span><input class="pm-input" id="pm-wNew" type="number" value="${p.wNew??0}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ เดิม (wOld)</span><input class="pm-input" id="pm-wOld" type="number" value="${p.wOld??0}"></div>
      <div class="pm-row"><span class="pm-label">💰 ยอดรวม</span><strong style="color:var(--green-dark);font-size:.95rem;">฿${(p.amount||0).toLocaleString()}</strong></div>`;
    footer.innerHTML=`
      <button class="pm-btn green" onclick="savePayEdit()">💾 บันทึกมิเตอร์</button>
      <button class="pm-btn red" onclick="resetRoomPayment()">🔄 รีเซ็ตกลับ "ยังไม่จ่าย"</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  } else {
    body.innerHTML=`
      <div style="background:#fff3e0;border-radius:8px;padding:.75rem;font-size:.84rem;color:#e65100;margin-bottom:.5rem;">
        ⏳ ยังไม่ได้ชำระ — ${monthName} ${year2}
      </div>
      <div style="font-size:.86rem;color:var(--text-muted);text-align:center;padding:.9rem 0;">
        คลิก "ออกบิล" เพื่อเปิดฟอร์มออกใบวางบิลห้องนี้
      </div>`;
    footer.innerHTML=`
      <button class="pm-btn blue" onclick="closePayModal();goBillFromTable('${roomId}',${year2},${month2})">📄 ออกบิลห้อง ${roomId}</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  }
  document.getElementById('payModalOverlay').classList.add('show');
}

function closePayModal(){
  document.getElementById('payModalOverlay').classList.remove('show');
  payModalRoomId=null;
}

function savePayEdit(){
  if(!payModalRoomId)return;
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(!ps[key]?.[payModalRoomId]){closePayModal();return;}
  ps[key][payModalRoomId].eNew=parseFloat(document.getElementById('pm-eNew').value)||0;
  ps[key][payModalRoomId].eOld=parseFloat(document.getElementById('pm-eOld').value)||0;
  ps[key][payModalRoomId].wNew=parseFloat(document.getElementById('pm-wNew').value)||0;
  ps[key][payModalRoomId].wOld=parseFloat(document.getElementById('pm-wOld').value)||0;
  ps[key][payModalRoomId].editedAt=new Date().toISOString();
  savePS(ps);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
  // แสดง toast
  const t=document.createElement('div');
  t.textContent='✅ บันทึกมิเตอร์เรียบร้อย';
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2200);
}

function resetRoomPayment(){
  if(!payModalRoomId)return;
  if(!confirm(`ยืนยันรีเซ็ตห้อง ${payModalRoomId} กลับเป็น "ยังไม่ชำระ"?\n(ข้อมูลใบเสร็จจะถูกลบออก)`))return;
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(ps[key]){
    delete ps[key][payModalRoomId];
    if(Object.keys(ps[key]).length===0)delete ps[key];
  }
  savePS(ps);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
}

// ===== MONTHLY METER TABLE =====
function renderMeterTable(){
  const el=document.getElementById('meterTableBody');if(!el)return;
  const month=parseInt(document.getElementById('mt-month')?.value||new Date().getMonth()+1);
  const year=parseInt(document.getElementById('mt-year')?.value||(new Date().getFullYear()+543));
  const yy=year%100;
  const mdKey=`${yy}_${month}`;
  const psKey=`${year}_${month}`;
  const ps=loadPS();
  const paid=ps[psKey]||{};
  let totalPaid=0, totalPending=0, totalAmt=0;

  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const rows=rooms.map(r=>{
    const lookupId=r.id; // id unified as 'ร้านใหญ่' in both systems
    // Read from building-namespaced METER_DATA (Rooms Building)
    const md=(typeof METER_DATA!=='undefined'&&METER_DATA['rooms']&&METER_DATA['rooms'][mdKey])?METER_DATA['rooms'][mdKey][lookupId]:null;
    const p=paid[r.id];
    // Prefer saved payment data, then METER_DATA, then —
    const eNew=p?.eNew!=null?p.eNew:(md?.eNew!=null?md.eNew:'—');
    const eOld=p?.eOld!=null?p.eOld:(md?.eOld!=null?md.eOld:'—');
    const wNew=p?.wNew!=null?p.wNew:(md?.wNew!=null?md.wNew:'—');
    const wOld=p?.wOld!=null?p.wOld:(md?.wOld!=null?md.wOld:'—');
    const eU=(typeof eNew==='number'&&typeof eOld==='number')?eNew-eOld:'—';
    const wU=(typeof wNew==='number'&&typeof wOld==='number')?wNew-wOld:'—';
    const isPaid=!!p;
    if(isPaid){totalPaid++;totalAmt+=p.amount||0;}else totalPending++;
    const statusCell=isPaid
      ?`<button class="mt-paid-badge" onclick="showPayDetail('${r.id}',${year},${month})">✅ จ่ายแล้ว ฿${(p.amount||0).toLocaleString()}</button>`
      :`<span class="mt-pending-badge">⏳ รอ</span>`;
    const actionCell=isPaid?''
      :`<button class="mt-go-btn" onclick="goBillFromTable('${r.id}',${year},${month})">📄 ออกบิล</button>`;
    const rowBg=isPaid?'':'';
    const meterStyle=md?'':'color:var(--text-muted);font-style:italic;';
    return`<tr style="${isPaid?'background:#fafffe;':''}">
      <td><strong style="${isPaid?'color:var(--green-dark);':''}">${r.id}</strong></td>
      <td style="font-size:.8rem;${meterStyle}">${eOld} → ${eNew}</td>
      <td style="${eU==='—'?'color:var(--text-muted);':eU>0?'color:var(--accent);font-weight:700;':'color:var(--red);'}">${eU}</td>
      <td style="font-size:.8rem;${meterStyle}">${wOld} → ${wNew}</td>
      <td style="${wU==='—'?'color:var(--text-muted);':wU>0?'color:var(--blue);font-weight:700;':'color:var(--red);'}">${wU}</td>
      <td>${statusCell}</td>
      <td>${actionCell}</td>
    </tr>`;
  });

  const monthName=MONTHS_FULL[month]||month;
  el.innerHTML=`
    <div class="mt-summary">
      <strong>${monthName} ${year}</strong>
      <span class="mt-pill green">✅ จ่ายแล้ว ${totalPaid} ห้อง · ฿${totalAmt.toLocaleString()}</span>
      <span class="mt-pill amber">⏳ รอ ${totalPending} ห้อง</span>
    </div>
    <div class="scroll-x">
      <table class="data-table">
        <thead><tr>
          <th>ห้อง</th><th>มิเตอร์ไฟ (เดิม→ล่าสุด)</th><th>หน่วยไฟ</th>
          <th>มิเตอร์น้ำ (เดิม→ล่าสุด)</th><th>หน่วยน้ำ</th><th>สถานะ</th><th>ดำเนินการ</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

function goBillFromTable(roomId, year, month){
  // ไปที่หน้าออกบิล และเซ็ตค่า
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-bill').classList.add('active');
  document.querySelector('.nav-btn[onclick*="\'bill\'"]')?.classList.add('active');
  if(month)document.getElementById('f-month').value=month;
  if(year)document.getElementById('f-year').value=year;
  if(document.getElementById('f-building').value!=='old'){
    document.getElementById('f-building').value='old';
    onBuildingChange();
  }
  document.getElementById('f-room').value=roomId;
  onRoomChange();
  document.getElementById('f-room').scrollIntoView({behavior:'smooth',block:'center'});
}

// ===== DASHBOARD LIVE UPDATES =====
function updateDashboardLive(){
  // Ensure data is available (both buildings)
  if(!window.ROOMS_OLD || window.ROOMS_OLD.length === 0) {
    console.warn('⚠️ window.ROOMS_OLD data not available yet, retrying...');
    setTimeout(updateDashboardLive, 200);
    return;
  }
  if(!window.NEST_ROOMS || window.NEST_ROOMS.length === 0) {
    console.warn('⚠️ window.NEST_ROOMS data not available yet, retrying...');
    setTimeout(updateDashboardLive, 200);
    return;
  }

  const now=new Date();
  const currentDate=now.getFullYear()+543;
  const currentMonth=now.getMonth()+1;

  // Specific year selected — live cards are hidden by setYear(), nothing to render
  if(currentYear !== 'all') return;

  const month=currentMonth;
  const year=currentDate;
  const ps=loadPS();
  const key=`${year}_${month}`;
  const paid=ps[key]||{};
  const paidCount=Object.keys(paid).length;

  // Rooms building only — Nest ยังไม่เปิด (มิถุนายน 2569)
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest = []; // exclude Nest until it opens
  const allActiveRooms = [...activeRooms];
  const totalRooms = allActiveRooms.length;

  // Calculate paid for both buildings
  const paidCountAll = Object.keys(paid).length;
  // For now, use combined total
  const paidCountRooms = Object.keys(paid).filter(k => activeRooms.map(r => r.id).includes(k)).length;
  const paidCountNest = Object.keys(paid).filter(k => activeNest.map(r => r.id).includes(k)).length;
  const pendingCount=totalRooms-paidCountAll;
  const totalCollected=Object.values(paid).reduce((a,p)=>a+(p.amount||0),0);

  // KPI: paid this month (COMBINED - both buildings)
  const kpiPN=document.getElementById('kpi-paid-now');
  const kpiPNS=document.getElementById('kpi-paid-now-sub');
  if(kpiPN)kpiPN.textContent=`${paidCountAll}/${totalRooms}`;
  if(kpiPNS)kpiPNS.textContent=`฿${totalCollected.toLocaleString()} · รอ ${pendingCount} ห้อง`;

  // KPI: occupancy from tenant data (COMBINED - both buildings)
  const tenants=loadTenants();
  const occCountRooms=activeRooms.filter(r=>tenants[r.id]?.name).length;
  const occCountNest=activeNest.filter(r=>tenants[r.id]?.name).length;
  const occCount = occCountRooms + occCountNest;
  const kpiOcc=document.getElementById('kpi-occupancy');
  const kpiOccS=document.getElementById('kpi-occupancy-sub');
  if(kpiOcc)kpiOcc.textContent=`${Math.round(occCount/totalRooms*100)}%`;
  if(kpiOccS)kpiOccS.textContent=`มีผู้เช่า ${occCount} · ว่าง ${totalRooms-occCount} ห้อง`;

  // KPI: Expected Revenue (this month from occupied rooms - COMBINED)
  // getActiveRoomsWithMetadata returns rentPrice (not rent)
  const expectedRevenueRooms=activeRooms.filter(r=>tenants[r.id]?.name).reduce((sum,r)=>sum+(r.rentPrice||0),0);
  const expectedRevenueNest=activeNest.filter(r=>tenants[r.id]?.name).reduce((sum,r)=>sum+(r.rentPrice||0),0);
  const expectedRevenue=expectedRevenueRooms + expectedRevenueNest;
  const kpiExp=document.getElementById('kpi-expected');
  const kpiExpS=document.getElementById('kpi-expected-sub');
  if(kpiExp)kpiExp.textContent=`฿${expectedRevenue.toLocaleString()}`;
  if(kpiExpS)kpiExpS.textContent=`จากห้องที่มีผู้เช่า ${occCount} ห้อง`;

  // KPI: Overdue Rent (ค้างชำระทั้งสิ้น) = expected this month minus already collected
  const overdueAmount=Math.max(0, expectedRevenue - totalCollected);
  const kpiOD=document.getElementById('kpi-overdue');
  const kpiODS=document.getElementById('kpi-overdue-sub');
  if(kpiOD)kpiOD.textContent=`฿${overdueAmount.toLocaleString()}`;
  if(kpiODS)kpiODS.textContent=`${pendingCount} ห้อง ยังไม่จ่ายเดือนนี้`;

  // Quick payment panel (COMBINED)
  const dashPay=document.getElementById('dashPaymentStatus');
  if(dashPay){
    const pendingRoomsArr=activeRooms.filter(r=>!paid[r.id]).map(r=>r.id);
    const pendingNestArr=activeNest.filter(r=>!paid[r.id]).map(r=>r.id);
    const allPending=[...pendingRoomsArr, ...pendingNestArr];
    const overdueCount = pendingCount; // rooms not yet paid this month
    dashPay.innerHTML=`
      <div style="display:flex;gap:1.4rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${paidCountAll}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ จ่ายแล้ว</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${pendingCount}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">⏳ รอชำระ</div></div>
        ${overdueCount?`<div><div style="font-size:1.5rem;font-weight:800;color:#dc2626">${overdueCount}</div><div style="font-size:.72rem;color:#dc2626;font-weight:600;">🔴 ค้างชำระ</div></div>`:''}
        <div><div style="font-size:1.15rem;font-weight:800;color:var(--green-dark)">฿${totalCollected.toLocaleString()}</div><div style="font-size:.72rem;color:var(--text-muted)">เก็บได้แล้ว</div></div>
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:3px;">🏠 Rooms: ${paidCountRooms}/${activeRooms.length} | 🏢 Nest: ${paidCountNest}/${activeNest.length}</div>
      ${allPending.length?`<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:5px;">ยังไม่จ่าย:</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${allPending.map(r=>`<span onclick="goBillFromTable('${r}',${year},${month})" style="padding:2px 8px;border-radius:20px;font-size:.72rem;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;cursor:pointer;">⏳${r}</span>`).join('')}</div>`
      :'<div style="color:var(--green);font-weight:700;font-size:.86rem;">🎉 เก็บค่าเช่าครบทุกห้องแล้ว!</div>'}`;
  }

  // Quick tenant panel (COMBINED from both buildings)
  const dashTen=document.getElementById('dashTenantStatus');
  if(dashTen){
    const today=new Date();
    const vacantRoomsRooms=activeRooms.filter(r=>!tenants[r.id]?.name).map(r=>r.id);
    const vacantRoomsNest=activeNest.filter(r=>!tenants[r.id]?.name).map(r=>r.id);
    const allVacant=[...vacantRoomsRooms, ...vacantRoomsNest];
    const soonRooms=activeRooms.filter(r=>{
      const t=tenants[r.id];
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    });
    const soonNest=activeNest.filter(r=>{
      const t=tenants[r.id];
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    });
    const allSoon=[...soonRooms, ...soonNest];
    const occRate = totalRooms>0 ? Math.round(occCount/totalRooms*100) : 0;
    dashTen.innerHTML=`
      <div style="display:flex;gap:1.4rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <div><div style="font-size:1.5rem;font-weight:800;color:var(--blue)">${occCount}</div><div style="font-size:.72rem;color:var(--text-muted)">มีผู้เช่า</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent)">${totalRooms-occCount}</div><div style="font-size:.72rem;color:var(--text-muted)">ห้องว่าง</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:${occRate>=80?'#2d8653':occRate>=60?'#f59e0b':'#dc2626'}">${occRate}%</div><div style="font-size:.72rem;color:var(--text-muted)">Occupancy Rate</div></div>
        ${allSoon.length?`<div><div style="font-size:1.5rem;font-weight:800;color:var(--red)">${allSoon.length}</div><div style="font-size:.72rem;color:var(--text-muted)">สัญญาใกล้หมด</div></div>`:''}
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:3px;">🏠 Rooms: ${occCountRooms}/${activeRooms.length} | 🏢 Nest: ${occCountNest}/${activeNest.length}</div>
      ${allVacant.length?`<div style="font-size:.74rem;color:var(--text-muted);">ว่าง: ${allVacant.slice(0,8).join(', ')}${allVacant.length>8?'...':''}</div>`
      :'<div style="color:var(--green);font-weight:700;font-size:.85rem;">✅ ไม่มีห้องว่าง</div>'}
      ${allSoon.length?`<div style="font-size:.74rem;color:var(--red);margin-top:4px;">⚠️ สัญญาใกล้หมด: ${allSoon.map(r=>r.id).join(', ')}</div>`:''}`;
  }

  // Complaints mini-stats
  const dashComp = document.getElementById('dashComplaintsStatus');
  if(dashComp) {
    const comp = JSON.parse(localStorage.getItem('complaints_data') || '[]');
    const cOpen = comp.filter(c => c.status === 'open').length;
    const cInProg = comp.filter(c => c.status === 'in-progress').length;
    const cDone = comp.filter(c => c.status === 'resolved').length;
    dashComp.innerHTML = comp.length === 0
      ? '<div style="color:var(--text-muted);font-size:.85rem;">ไม่มีข้อร้องเรียน</div>'
      : `<div style="display:flex;gap:1.4rem;flex-wrap:wrap;">
          <div><div style="font-size:1.5rem;font-weight:800;color:#dc2626">${cOpen}</div><div style="font-size:.72rem;color:#dc2626;font-weight:600;">🔴 Open</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${cInProg}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">🟡 In Progress</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${cDone}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ Resolved</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--text-muted)">${comp.length}</div><div style="font-size:.72rem;color:var(--text-muted);font-weight:600;">Total</div></div>
        </div>`;
  }

  // Maintenance mini-stats
  const dashMx = document.getElementById('dashMaintenanceStatus');
  if(dashMx) {
    const mx = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
    const mxPending = mx.filter(r => r.status === 'pending' || r.status === 'open').length;
    const mxDone = mx.filter(r => r.status === 'completed' || r.status === 'done').length;
    const mxInProg = mx.filter(r => r.status === 'in-progress').length;
    dashMx.innerHTML = mx.length === 0
      ? '<div style="color:var(--text-muted);font-size:.85rem;">ไม่มีคำขอซ่อม</div>'
      : `<div style="display:flex;gap:1.4rem;flex-wrap:wrap;">
          <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${mxPending}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">⏳ Pending</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#1976d2">${mxInProg}</div><div style="font-size:.72rem;color:#1976d2;font-weight:600;">🔨 In Progress</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${mxDone}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ Done</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--text-muted)">${mx.length}</div><div style="font-size:.72rem;color:var(--text-muted);font-weight:600;">Total</div></div>
        </div>`;
  }

  updateNotificationBell();
  updateGamificationWidget();
  updatePetAnalyticsWidget();
  updateNavBadge();
  updateMxBadge();
}

function updateGamificationWidget() {
  const el = document.getElementById('dashTopTenants');
  if (!el) return;
  if (typeof TenantConfigManager === 'undefined') { el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีข้อมูล</div>'; return; }
  const all = [
    ...TenantConfigManager.getTenantList('rooms'),
    ...TenantConfigManager.getTenantList('nest')
  ].map(t => {
    const months = t.createdDate
      ? Math.min(120, Math.floor((Date.now() - new Date(t.createdDate).getTime()) / (1000*60*60*24*30)))
      : 0;
    const pts = months * 10;
    const rank = pts >= 1000 ? '🥇' : pts >= 500 ? '🥈' : '🥉';
    return { name: t.name || t.id, pts, rank, months };
  }).filter(t => t.name && t.name !== t.id).sort((a,b) => b.pts - a.pts).slice(0,3);

  if (all.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีผู้เช่า</div>'; return; }
  el.innerHTML = all.map((t, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:1.1rem;">${['🥇','🥈','🥉'][i]}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div>
        <div style="font-size:.7rem;color:var(--text-muted);">${t.months} เดือน</div>
      </div>
      <span style="font-size:.78rem;font-weight:800;color:var(--green-dark);">${t.pts} pts</span>
    </div>`).join('');
}

function updatePetAnalyticsWidget() {
  const el = document.getElementById('dashPetAnalytics');
  const card = document.getElementById('dashPetAnalyticsCard');
  if (!el) return;
  const counts = {};
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tenant_pets_')) {
      const pets = JSON.parse(localStorage.getItem(key) || '[]');
      pets.filter(p => p.status === 'approved').forEach(p => {
        const t = (p.type || 'other').toLowerCase();
        counts[t] = (counts[t] || 0) + 1;
        total++;
      });
    }
  }
  if (total === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีสัตว์เลี้ยงลงทะเบียน</div>';
    return;
  }
  const emojis = { dog:'🐕', cat:'🐈', rabbit:'🐇', bird:'🐦', fish:'🐠', hamster:'🐹' };
  el.innerHTML = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([type, cnt]) => {
    const pct = Math.round(cnt / total * 100);
    const em = emojis[type] || '🐾';
    return `<div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:2px;">
        <span>${em} ${type}</span><span style="font-weight:700;">${cnt} ตัว</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:6px;">
        <div style="background:var(--green);border-radius:4px;height:6px;width:${pct}%;transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('') + `<div style="font-size:.7rem;color:var(--text-muted);margin-top:4px;">รวม ${total} ตัว</div>`;
}

function updateNavBadge(){
  const badge=document.getElementById('billBadge');if(!badge)return;
  const now=new Date();
  const ps=loadPS();
  const key=`${now.getFullYear()+543}_${now.getMonth()+1}`;
  const paid=ps[key]||{};
  // Count both buildings
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);
  const allActive = [...activeRooms, ...activeNest];
  const pending=allActive.length-Object.keys(paid).length;
  if(pending>0){badge.textContent=pending;badge.style.display='inline-block';}
  else{badge.style.display='none';}
}

// ===== TENANT MANAGEMENT =====
function loadTenants(){
  // TenantConfigManager stores to tenant_master_data: {rooms: {id: {...}}, nest: {id: {...}}}
  // Flatten to {id: {...}} for backward compatibility
  const master = localStorage.getItem('tenant_master_data');
  if (master) {
    const raw = JSON.parse(master);
    return Object.values(raw).reduce((acc, bld) => Object.assign(acc, bld), {});
  }
  return JSON.parse(localStorage.getItem('tenant_data')||'{}');
}

function saveTenants(t){localStorage.setItem('tenant_data',JSON.stringify(t));}

// Initialize all rooms with default tenant users
function initializeAllRoomUsers() {
  const tenants = loadTenants();
  const tNames = ['สมชาย ใจดี', 'นางสาวจิรา สมิตร', 'นายวิชัย จันทร์สว่าง', 'นางสมหญิง พรประเสริฐ', 'นายกมล วงศ์พันธ์',
    'นางปวณีย์ ศรีสวัสดิ์', 'นายศักดา บุญเพิ่ม', 'นับพบ ยิ่มเสถียร', 'นางนิยม ดวงแว่', 'นายปณิต นิยมาน',
    'นางกรรณิการ์ มัตตานี', 'นายเสวิชญ์ ศรีสอง', 'นางอรทัย ชิดโพธิ์', 'นายอภิวัฒน์ คงประเสริฐ'];

  // Get all rooms from RoomConfigManager
  const roomsConfig = RoomConfigManager.getRoomsConfig('rooms');
  const nestConfig = RoomConfigManager.getRoomsConfig('nest');

  let nameIndex = 0;
  let updated = 0;

  // Create users for Rooms building
  if (roomsConfig && roomsConfig.rooms) {
    roomsConfig.rooms.forEach(room => {
      if (!tenants[room.id]) {
        tenants[room.id] = {
          name: tNames[nameIndex % tNames.length],
          lineId: `@tenant_${room.id}`,
          moveInDate: new Date(2024, 0, 15).toISOString().split('T')[0],
          contractEnd: new Date(2025, 11, 15).toISOString().split('T')[0],
          deposit: 3000,
          note: `Tenant for ${room.name}`,
          updatedAt: new Date().toISOString()
        };
        updated++;
        nameIndex++;
      }
    });
  }

  // NOTE: Nest building intentionally excluded — not yet open for service
  // Nest tenants will be added manually when building opens

  if (updated > 0) {
    saveTenants(tenants);
    console.log(`✅ Initialized ${updated} room users`);
    return updated;
  }
  return 0;
}
let tenantBuilding='old';
let currentTenantFilter='all';

function setTenantBuilding(bld,btn){
  document.querySelectorAll('#page-tenant .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  tenantBuilding=bld;
  currentTenantFilter='all';
  // Reset filter buttons to "ทั้งหมด"
  document.querySelectorAll('.filter-btn-tenant').forEach((b,i)=>{
    b.classList.toggle('active',i===0);
    b.style.background=i===0?'var(--green-dark)':'white';
    b.style.color=i===0?'white':b.style.borderColor||'#666';
  });
  // Show/hide building-specific sections
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = bld==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = bld==='new' ? '' : 'none';
  // Init the building's room grid & info cards
  if(bld==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
}

function initTenantPage(){
  // Show/hide building sections based on current building tab
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = tenantBuilding==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = tenantBuilding==='new' ? '' : 'none';
  // Initialize the active building room grid
  if(tenantBuilding==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
  renderTenantTable();
  updateTenantAlertBlock();
  updateRoomTypeCards();
  const searchInput=document.getElementById('tenantSearch');
  if(searchInput){
    searchInput.addEventListener('input',()=>{
      renderTenantPage();
      renderTenantTable();
      updateTenantAlertBlock();
      updateRoomTypeCards();
    });
  }
  _setupTenantRealtimeListener();
}

let _tenantListenerUnsubscribers=[];
function _setupTenantRealtimeListener(){
  // Unsubscribe previous listeners to avoid duplicates
  _tenantListenerUnsubscribers.forEach(fn=>fn());
  _tenantListenerUnsubscribers=[];
  if(!window.firebase?.firestoreFunctions) return;
  const {collection,onSnapshot}=window.firebase.firestoreFunctions;
  const db=window.firebase.firestore();
  ['rooms','nest'].forEach(bld=>{
    const unsub=onSnapshot(collection(db,`tenants/${bld}/list`),snap=>{
      const all=JSON.parse(localStorage.getItem('tenant_master_data')||'{}');
      if(!all[bld])all[bld]={};
      snap.forEach(doc=>{all[bld][doc.id]=doc.data();});
      localStorage.setItem('tenant_master_data',JSON.stringify(all));
      if(document.getElementById('page-tenant')?.style.display!=='none'){
        renderTenantPage();
        renderTenantTable();
        updateTenantAlertBlock();
        updateRoomTypeCards();
      }
    },err=>console.warn('tenant listener error:',err));
    _tenantListenerUnsubscribers.push(unsub);
  });
}

function _getTenantRooms(){
  return tenantBuilding==='old'
    ?getActiveRoomsWithMetadata('rooms',window.ROOMS_OLD)
    :getActiveRoomsWithMetadata('nest',window.NEST_ROOMS);
}

function renderTenantPage(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let occ=0,vac=0,soon=0;
  rooms.forEach(r=>{
    const t=tenants[r.id];
    if(t?.name){
      occ++;
      if(t.contractEnd){
        const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
        if(diff>=0&&diff<=30)soon++;
      }
    }else vac++;
  });
  // Write สัญญาใกล้หมด to the unified building KPI (occupancy-soon / nest-occupancy-soon)
  const soonId = tenantBuilding==='old' ? 'occupancy-soon' : 'nest-occupancy-soon';
  const soonEl = document.getElementById(soonId);
  if(soonEl){
    soonEl.textContent = soon;
    // Color: red if any expiring, purple otherwise
    const card = soonEl.closest('.kpi-card');
    if(card){ card.className = `kpi-card ${soon>0?'red':'purple'}`; }
  }
  const grid=document.getElementById('tenantGrid');if(!grid)return;
  const searchTerm=(document.getElementById('tenantSearch')?.value||'').toLowerCase();

  // Apply filters
  let filtered=rooms.filter(r=>{
    const t=tenants[r.id];
    const matchSearch=!searchTerm||r.id.toString().toLowerCase().includes(searchTerm)||(t?.name||'').toLowerCase().includes(searchTerm);
    if(!matchSearch)return false;
    const isOcc=!!t?.name;
    if(currentTenantFilter==='occupied')return isOcc;
    if(currentTenantFilter==='vacant')return !isOcc;
    if(currentTenantFilter==='expiring'){
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    }
    return true;
  });

  grid.innerHTML=filtered.map(r=>{
    const t=tenants[r.id];
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t?.moveInDate||t?.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{month:'short',day:'numeric'}):'—';
    const ce=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{month:'short',day:'numeric',year:'2-digit'}):'—';
    let daysLeft='—',expiryColor='var(--text-muted)';
    if(t?.contractEnd){
      const days=Math.ceil((new Date(t.contractEnd)-today)/86400000);
      if(days>0){daysLeft=days;expiryColor=days<=30?'var(--red)':days<=60?'#f57c00':'var(--green-dark)';}
      else{daysLeft='❌ หมดแล้ว';expiryColor='var(--red)';}
    }
    return`<div class="compact-card${!isOcc?' vacant':''}" style="border-left-color:${isCom?'var(--blue)':isOcc?'var(--green)':'#ff9800'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${r.id}</div>
        <span class="compact-card-type">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span style="margin-left:auto;font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOcc?'var(--green-pale)':'#fff3e0'};color:${isOcc?'var(--green-dark)':'#e65100'};font-weight:600;">${isOcc?'มีผู้เช่า':'ว่าง'}</span>
      </div>
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span class="compact-card-value">฿${Number(r.rentPrice||r.rent||0).toLocaleString()}</span>
      </div>
      ${isOcc?`
      <div class="compact-card-info"><span style="font-weight:600;color:var(--text);">ชื่อ</span><span class="compact-card-value">${t.name}</span></div>
      <div class="compact-card-info"><span>โทร</span><span style="font-size:.8rem;">${t.phone||'—'}</span></div>
      <div class="compact-card-info"><span>เข้าพัก</span><span style="font-size:.8rem;">${mi}</span></div>
      <div class="compact-card-info"><span>สัญญาสิ้นสุด</span><span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${ce}</span></div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${typeof daysLeft==='number'?daysLeft+' วัน':daysLeft}</span>
      </div>
      ${t.deposit?`<div class="compact-card-info"><span style="font-size:.75rem;color:var(--text-muted);">มัดจำ</span><span style="font-weight:700;color:var(--green-dark);">฿${Number(t.deposit).toLocaleString()}</span></div>`:''}
      `:`<div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);"><span>🚪 ไม่มีผู้เช่า</span></div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button onclick="openTenantModal('${tenantBuilding==='old'?'rooms':'nest'}','${r.id}')" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">📄 สัญญา</button>
        <button onclick="showBillingModal('${r.id}')" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">💰 ชำระ</button>
        <button onclick="showBillingHistoryModal('${r.id}')" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🧾 บิล</button>
        <button onclick="window.showPage('maintenance')" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</div>';
  }
  updateTenantAlertBlock();
  updateRoomTypeCards();
}

// ===== COMPACT TENANT TABLE RENDERING =====
function renderTenantTable(){
  const searchInput=document.getElementById('tenantSearch');
  const searchTerm=(searchInput?.value||'').toLowerCase();
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const tbody=document.getElementById('tenantTableBody');
  const today=new Date();

  const rows=rooms.filter(r=>{
    const t=tenants[r.id]||{};
    const roomStr=r.id.toString().toLowerCase();
    const nameStr=(t.name||'').toLowerCase();
    return roomStr.includes(searchTerm)||nameStr.includes(searchTerm);
  }).map(r=>{
    const t=tenants[r.id]||{};
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t.moveInDate||t.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const ce=t.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const diff=t.contractEnd?Math.round((new Date(t.contractEnd)-today)/(1000*60*60*24)):null;
    const status=isCom?'💼 พาณิชย์':!isOcc?'🚪 ว่าง':diff===null?'—':diff<0?'❌ หมด':diff<=30?`⚠️ ${diff}วัน`:'✅ ปกติ';
    return`<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px;font-weight:700;color:var(--green-dark);">${r.id}</td>
      <td style="padding:10px;">${isOcc?t.name:'<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${t.phone||'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${mi}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${ce}</td>
      <td style="padding:10px;text-align:center;font-weight:700;color:var(--green-dark);">${t.deposit?'฿'+Number(t.deposit).toLocaleString():'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;font-weight:600;">${status}</td>
    </tr>`;
  });

  tbody.innerHTML=rows.join('');
  if(rows.length===0){
    tbody.innerHTML=`<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</td></tr>`;
  }
}

function toggleTenantView(view, btn){
  const cardsView=document.getElementById('tenantViewCards');
  const tableView=document.getElementById('tenantViewTable');
  document.querySelectorAll('.view-toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(view==='cards'){
    cardsView.style.display='block';
    tableView.style.display='none';
  }else{
    cardsView.style.display='none';
    tableView.style.display='block';
  }
}

// ===== TENANT FILTER =====
function setTenantFilter(filter){
  currentTenantFilter=filter;
  document.querySelectorAll('.filter-btn-tenant').forEach(btn=>{
    btn.classList.remove('active');
    btn.style.background='white';
    btn.style.color=btn.style.borderColor||'#666';
  });
  if(event?.target){
    event.target.classList.add('active');
    event.target.style.background='var(--green-dark)';
    event.target.style.color='white';
  }
  renderTenantPage();
  renderTenantTable();
}

// ===== TENANT ALERT BLOCK =====
function updateTenantAlertBlock(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  const expiring=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
    return diff>=0&&diff<=30;
  });
  const alertBlock=document.getElementById('tenantAlertBlock');
  const alertList=document.getElementById('tenantAlertList');
  if(!alertBlock) return;
  if(expiring.length===0){
    alertBlock.style.display='none';
  }else{
    alertBlock.style.display='block';
    if(alertList) alertList.innerHTML=expiring.map(r=>`<div style="background:#fff;padding:6px 12px;border-radius:6px;border-left:3px solid #f57c00;font-size:.85rem;">🚪 ห้อง ${r.id}</div>`).join('');
  }
}

// ===== ROOM TYPE INFO CARDS =====
function updateRoomTypeCards(){
  const rooms=_getTenantRooms();
  const container=document.getElementById('roomTypeCardsContainer');
  if(!container) return;
  const types={};
  (rooms||[]).forEach(room=>{
    if(!types[room.type])types[room.type]={type:room.type,rooms:0,rent:room.rentPrice||room.rent||0};
    types[room.type].rooms++;
  });
  container.innerHTML=Object.values(types).map(typeInfo=>`
    <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:1rem;">
      <div style="font-weight:700;color:var(--green);margin-bottom:0.5rem;">${typeInfo.type}</div>
      <div style="font-size:.9rem;color:var(--text-muted);">
        <div>🏠 ${typeInfo.rooms} ห้อง</div>
        <div>💰 ฿${Number(typeInfo.rent).toLocaleString()} / เดือน</div>
      </div>
    </div>
  `).join('');
}

// ===== EXPORT TENANT CSV =====
function exportTenantCSV(){
  const building=tenantBuilding==='old'?'ห้องแถว':'Nest';
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let csv='ห้อง,ชื่อ-นามสกุล,เบอร์โทร,วันเข้า,วันหมดสัญญา,มัดจำ,สถานะ\n';
  rooms.forEach(r=>{
    const t=tenants[r.id];
    const name=t?.name||'ว่าง';
    const phone=t?.phone||'-';
    const moveIn=t?.moveInDate?new Date(t.moveInDate).toLocaleDateString('th-TH'):'-';
    const contractEnd=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH'):'-';
    const deposit=t?.deposit?Number(t.deposit).toLocaleString('th-TH'):'-';
    const status=!t?.name?'ว่าง':t.contractEnd&&new Date(t.contractEnd)<today?'หมด':'ปกติ';
    csv+=`"${r.id}","${name}","${phone}","${moveIn}","${contractEnd}","${deposit}","${status}"\n`;
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`tenant-${building}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

let editingTenantRoom=null;
function showTenantModal(roomId){
  editingTenantRoom=roomId;
  const t=loadTenants()[roomId]||{};
  document.getElementById('payModalTitle').textContent=`👤 ผู้เช่า — ห้อง ${roomId}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');
  body.innerHTML=`
    <div class="pm-row"><span class="pm-label">ชื่อ-นามสกุล</span><input class="pm-input" id="tm-name" style="width:185px" type="text" value="${t.name||''}" placeholder="สมชาย ใจดี"></div>
    <div class="pm-row"><span class="pm-label">Line ID</span><input class="pm-input" id="tm-line" style="width:145px" type="text" value="${t.lineId||''}" placeholder="@username"></div>
    <div class="pm-row"><span class="pm-label">วันที่เข้าอยู่</span><input class="pm-input" id="tm-moveIn" style="width:145px" type="date" value="${t.moveInDate||''}"></div>
    <div class="pm-row"><span class="pm-label">วันหมดสัญญา</span><input class="pm-input" id="tm-contractEnd" style="width:145px" type="date" value="${t.contractEnd||''}"></div>
    <div class="pm-row"><span class="pm-label">เงินมัดจำ (บาท)</span><input class="pm-input" id="tm-deposit" type="number" value="${t.deposit||0}"></div>
    <div class="pm-row"><span class="pm-label">หมายเหตุ</span><input class="pm-input" id="tm-note" style="width:185px" type="text" value="${t.note||''}" placeholder="เช่น มีสัตว์เลี้ยง..."></div>`;
  footer.innerHTML=`
    <button class="pm-btn green" onclick="saveTenant()">💾 บันทึก</button>
    ${t.name?`<button class="pm-btn red" onclick="deleteTenant('${roomId}')">🗑️ ลบผู้เช่า</button>`:''}
    <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  document.getElementById('payModalOverlay').classList.add('show');

  // Initialize phone validation for the modal
  setTimeout(function() {
    initPhoneValidation();
  }, 100);
}

function saveTenant(){
  if(!editingTenantRoom)return;
  const tenants=loadTenants();
  const name=document.getElementById('tm-name').value.trim();
  if(name){
    tenants[editingTenantRoom]={
      name,
      lineId:document.getElementById('tm-line').value.trim(),
      moveInDate:document.getElementById('tm-moveIn').value,
      contractEnd:document.getElementById('tm-contractEnd').value,
      deposit:parseFloat(document.getElementById('tm-deposit').value)||0,
      note:document.getElementById('tm-note').value.trim(),
      updatedAt:new Date().toISOString()
    };
  }else{delete tenants[editingTenantRoom];}
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
  const toast=document.createElement('div');
  toast.textContent=name?`✅ บันทึกผู้เช่าห้อง ${editingTenantRoom} เรียบร้อย`:`🗑️ ลบข้อมูลผู้เช่าห้อง ${editingTenantRoom} แล้ว`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2200);
}

function deleteTenant(roomId){
  if(!confirm(`ยืนยันการลบผู้เช่าห้อง ${roomId}?`))return;
  const tenants=loadTenants();
  delete tenants[roomId];
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
}

// ===== EXPENSE MANAGEMENT =====
function loadExpenses(){return JSON.parse(localStorage.getItem('expense_data')||'[]');}
function saveExpenses(e){localStorage.setItem('expense_data',JSON.stringify(e));}

function initExpensePage(){
  const now=new Date();
  const fm=document.getElementById('exp-filter-month');
  const fy=document.getElementById('exp-filter-year');
  const ed=document.getElementById('exp-date');
  if(fm)fm.value=now.getMonth()+1;
  if(fy)fy.value=now.getFullYear()+543;
  if(ed&&!ed.value)ed.value=now.toISOString().split('T')[0];
  renderExpensePage();
}

function renderExpensePage(){
  const now=new Date();
  const filterMonth=parseInt(document.getElementById('exp-filter-month')?.value||now.getMonth()+1);
  const filterYear=parseInt(document.getElementById('exp-filter-year')?.value||now.getFullYear()+543);
  const expenses=loadExpenses();
  const filtered=expenses.filter(e=>{
    if(!e.date)return false;
    const d=new Date(e.date);
    return d.getMonth()+1===filterMonth&&(d.getFullYear()+543)===filterYear;
  });
  const total=filtered.reduce((a,e)=>a+e.amount,0);
  const byCat={};
  filtered.forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount;});
  const ps=loadPS();
  const income=Object.values(ps[`${filterYear}_${filterMonth}`]||{}).reduce((a,p)=>a+(p.amount||0),0);
  const profit=income-total;
  const catLabels={repair:'ซ่อมแซม',utility:'ค่าน้ำ/ไฟ',supply:'ซื้อของ',wages:'ค่าแรง',other:'อื่นๆ'};
  const catCls={repair:'cat-repair',utility:'cat-utility',supply:'cat-supply',wages:'cat-wages',other:'cat-other'};
  const expSum=document.getElementById('expSummary');
  if(expSum){
    expSum.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;margin-bottom:1rem;">
        <div style="text-align:center;padding:.75rem;background:var(--green-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--green-dark)">฿${income.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายรับ</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:var(--red-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--red)">฿${total.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายจ่าย</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:${profit>=0?'var(--green-pale)':'var(--red-pale)'};border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:${profit>=0?'var(--green-dark)':'var(--red)'}">${profit>=0?'+':''}฿${profit.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${profit>=0?'กำไร':'ขาดทุน'}</div>
        </div>
      </div>
      ${Object.keys(byCat).length?`<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;">แยกตามหมวด:</div>
      <div style="display:flex;flex-direction:column;gap:5px;">${Object.entries(byCat).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span class="exp-cat-pill ${catCls[cat]||'cat-other'}">${catLabels[cat]||cat}</span>
        <strong>฿${amt.toLocaleString()}</strong></div>`).join('')}</div>`
      :'<div style="text-align:center;color:var(--text-muted);padding:.8rem;font-size:.84rem;">ยังไม่มีรายจ่ายเดือนนี้</div>'}`;
  }
  const listEl=document.getElementById('expList');
  if(listEl){
    if(!filtered.length){
      listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้</div>';
    }else{
      listEl.innerHTML=`<div class="scroll-x"><table class="data-table">
        <thead><tr><th>วันที่</th><th>หมวด</th><th>รายการ</th><th>ห้อง</th><th>จำนวน</th><th></th></tr></thead>
        <tbody>${filtered.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr>
          <td style="font-size:.8rem;">${new Date(e.date).toLocaleDateString('th-TH',{day:'numeric',month:'short'})}</td>
          <td><span class="exp-cat-pill ${catCls[e.category]||'cat-other'}">${catLabels[e.category]||e.category}</span></td>
          <td>${e.desc}</td>
          <td style="font-size:.8rem;color:var(--text-muted)">${e.room||'—'}</td>
          <td style="font-weight:700;color:var(--red)">฿${e.amount.toLocaleString()}</td>
          <td><button onclick="deleteExpense(${e.id})" style="background:none;border:none;cursor:pointer;font-size:.9rem;" title="ลบ">🗑️</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--red-pale);"><td colspan="4" style="font-weight:700;">รวม</td>
          <td style="font-weight:800;color:var(--red)">฿${total.toLocaleString()}</td><td></td></tr></tfoot>
      </table></div>`;
    }
  }
}

function addExpense(){
  const date=document.getElementById('exp-date').value;
  const category=document.getElementById('exp-category').value;
  const desc=document.getElementById('exp-desc').value.trim();
  const room=document.getElementById('exp-room').value.trim();
  const amount=parseFloat(document.getElementById('exp-amount').value)||0;
  if(!date||!desc||!amount){showToast('กรุณากรอกวันที่ รายการ และจำนวนเงิน', 'warning');return;}
  const expenses=loadExpenses();
  expenses.push({id:Date.now(),date,category,desc,room,amount});
  saveExpenses(expenses);
  document.getElementById('exp-desc').value='';
  document.getElementById('exp-amount').value='';
  document.getElementById('exp-room').value='';
  renderExpensePage();
  const toast=document.createElement('div');
  toast.textContent=`✅ บันทึกรายจ่าย ฿${amount.toLocaleString()} เรียบร้อย`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2000);
}

function deleteExpense(id){
  if(!confirm('ยืนยันการลบรายการนี้?'))return;
  saveExpenses(loadExpenses().filter(e=>e.id!==id));
  renderExpensePage();
}

// ===== TENANT PORTAL MAINTENANCE =====
function loadTenantMaintenance(){
  return JSON.parse(localStorage.getItem('tenant_maintenance')||'[]');
}

function saveTenantMaintenance(data){
  localStorage.setItem('tenant_maintenance',JSON.stringify(data));
}

function submitMaintenance(){
  // Validate tenant maintenance form
  const validation = validateTenantForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    return;
  }

  const room=document.getElementById('tp-room').value.trim();
  const type=document.getElementById('tp-type').value;
  const priority=document.getElementById('tp-priority').value;
  const description=document.getElementById('tp-description').value.trim();

  // Sanitize inputs
  const sanitizedRoom = window.SecurityUtils.sanitizeInput(room);
  const sanitizedDescription = window.SecurityUtils.sanitizeInput(description);

  if(!sanitizedRoom||!type||!sanitizedDescription){
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
    return;
  }

  const data=loadTenantMaintenance();
  data.unshift({
    id:Date.now(),
    room:sanitizedRoom,
    type:type,
    priority:priority,
    description:sanitizedDescription,
    status:'pending',
    submittedAt:new Date().toLocaleString('th-TH'),
    updatedAt:new Date().toLocaleString('th-TH')
  });

  saveTenantMaintenance(data);

  // Reset form
  document.getElementById('tp-room').value='';
  document.getElementById('tp-type').value='';
  document.getElementById('tp-priority').value='medium';
  document.getElementById('tp-description').value='';

  showToast('แจ้งซ่อมเรียบร้อยแล้ว เจ้าของจะติดต่อในไม่ช้า', 'success');
  renderTenantMaintenanceList();
}

function renderTenantMaintenanceList(){
  const data=loadTenantMaintenance();
  const list=document.getElementById('tp-list');

  if(data.length===0){
    list.innerHTML='<div style="color:var(--text-muted);text-align:center;padding:2rem;">ยังไม่มีรายการแจ้ง</div>';
    return;
  }

  const typeLabel={
    'plumbing':'🚿 ท่อน้ำ/ระบายน้ำ',
    'electrical':'⚡ ไฟฟ้า',
    'appliance':'🔌 เครื่องใช้ไฟฟ้า',
    'ac':'❄️ แอร์',
    'door':'🚪 ประตู/กุญแจ',
    'wall':'🧱 ผนัง/ปูน',
    'other':'📝 อื่นๆ'
  };

  const priorityColor={
    'low':'#4caf50',
    'medium':'#ff9800',
    'high':'#f44336'
  };

  list.innerHTML=data.map(item=>`
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:10px;border-left:4px solid ${priorityColor[item.priority]};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;color:var(--text);">ห้อง ${item.room}</div>
          <div style="font-size:.8rem;color:var(--text-muted);">${typeLabel[item.type]||item.type}</div>
        </div>
        <span style="background:${item.status==='pending'?'#ff9800':item.status==='done'?'#4caf50':'#2196f3'};color:#fff;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700;">
          ${item.status==='pending'?'⏳ รอดำเนินการ':item.status==='done'?'✅ เสร็จแล้ว':'🔨 กำลังดำเนินการ'}
        </span>
      </div>
      <div style="font-size:.85rem;color:var(--text);line-height:1.5;margin-bottom:8px;">
        ${item.description}
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);">
        ส่งเมื่อ: ${item.submittedAt}
      </div>
    </div>
  `).join('');
}

function initTenantPortal(){
  loadTenantProfile();
  renderTenantMaintenanceList();
}

function loadTenantProfile(){
  // Get first tenant as example (in real app, would be logged-in tenant)
  const tenants = loadTenants();
  const firstTenantRoom = Object.keys(tenants)[0];
  const tenant = tenants[firstTenantRoom];

  if (!tenant) {
    document.getElementById('tenantProfileContent').innerHTML =
      '<div style="padding:1rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลผู้เช่า</div>';
    return;
  }

  const profileHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
      <!-- Left: Personal Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">👤 ชื่อ-สกุล</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--text);">${tenant.name || '—'}</div>
        </div>
      </div>

      <!-- Right: Lease Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">🏠 ห้องเลขที่</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--green);">${firstTenantRoom}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">📅 วันเช่า</div>
          <div style="font-size:.95rem;color:var(--text);">${tenant.startDate || '—'}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">💰 ค่าเช่ารายเดือน</div>
          <div style="font-size:1rem;font-weight:700;color:var(--text);">฿${tenant.rent ? tenant.rent.toLocaleString() : '—'}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('tenantProfileContent').innerHTML = profileHTML;
}

// ===== PAYMENT VERIFICATION =====
function loadTenantPayments(){
  return JSON.parse(localStorage.getItem('tenant_payments')||'[]');
}

function saveTenantPayments(data){
  localStorage.setItem('tenant_payments',JSON.stringify(data));
}

// ===== PAYMENT VERIFICATION — Firestore real-time feed =====
let _pvUnsubscribe = null;
window._pvFilter = 'today';

function initPaymentVerify() {
  // Tear down previous listener
  if (_pvUnsubscribe) { _pvUnsubscribe(); _pvUnsubscribe = null; }

  const feed = document.getElementById('pvFeed');
  if (!feed) return;
  feed.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">🔄 กำลังโหลด...</div>';

  if (!window.firebase?.firestore) {
    feed.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ Firebase ยังไม่พร้อม</div>';
    return;
  }

  const db = window.firebase.firestore();
  _pvUnsubscribe = db.collection('verifiedSlips')
    .orderBy('timestamp', 'desc')
    .limit(200)
    .onSnapshot(snapshot => {
      const slips = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      updatePVStats(slips);
      renderPVFeed(slips);
    }, err => {
      feed.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ ${err.message}</div>`;
    });
}

function setPVFilter(filter, btn) {
  window._pvFilter = filter;
  document.querySelectorAll('#page-payment-verify .year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Re-trigger render by re-reading from snapshot cache
  if (window.firebase?.firestore) {
    window.firebase.firestore().collection('verifiedSlips')
      .orderBy('timestamp', 'desc').limit(200).get()
      .then(snap => {
        const slips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updatePVStats(slips);
        renderPVFeed(slips);
      });
  }
}

function _pvInRange(slip) {
  const ts = slip.timestamp?.toDate ? slip.timestamp.toDate() : new Date(slip.timestamp || slip.verifiedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart - 6 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const f = window._pvFilter || 'today';
  if (f === 'today')  return ts >= todayStart;
  if (f === 'week')   return ts >= weekStart;
  if (f === 'month')  return ts >= monthStart;
  return true; // 'all'
}

function updatePVStats(slips) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = s => s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.verifiedAt);
  const todaySlips = slips.filter(s => toDate(s) >= todayStart);
  const monthSlips = slips.filter(s => toDate(s) >= monthStart);
  const monthTotal = monthSlips.reduce((sum, s) => sum + (s.amount || 0), 0);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pv-today-count', todaySlips.length);
  set('pv-month-count', monthSlips.length);
  set('pv-month-total', '฿' + monthTotal.toLocaleString());
  // Update notification badge
  const badge = document.getElementById('paymentBadge');
  if (badge) { badge.style.display = 'none'; }
}

function renderPVFeed(slips) {
  const feed = document.getElementById('pvFeed');
  if (!feed) return;
  const filtered = slips.filter(_pvInRange);
  if (filtered.length === 0) {
    feed.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--text-muted);">📭 ยังไม่มีการโอนในช่วงนี้</div>';
    return;
  }
  const bankName = code => ({'004':'กสิกรไทย','014':'ไทยพาณิชย์','025':'กรุงไทย','002':'กรุงเทพ','006':'กรุงศรี','011':'TMB','065':'ทิสโก้','069':'เกียรตินาคิน','022':'CIMB','067':'ทีทีบี'})[code] || (code || '—');
  feed.innerHTML = filtered.map(s => {
    const ts = s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.verifiedAt);
    const timeStr = ts.toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const amountOk = !s.expectedAmount || Math.abs(s.amount - s.expectedAmount) < 1;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="background:${amountOk ? 'var(--green-pale)' : '#fff3e0'};color:${amountOk ? 'var(--green-dark)' : '#e65100'};border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${amountOk ? '✅' : '⚠️'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.9rem;">ห้อง <span style="color:var(--green-dark);">${s.room || '—'}</span> <span style="color:var(--text-muted);font-size:.78rem;">${s.building || ''}</span></div>
        <div style="font-size:.78rem;color:var(--text-muted);">โดย ${s.sender || '—'} · ${bankName(s.bankCode)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-weight:800;color:var(--green-dark);font-size:.95rem;">฿${(s.amount||0).toLocaleString()}</div>
        <div style="font-size:.72rem;color:var(--text-muted);">${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function updateLinkPreview(){
  const room = document.getElementById('linkRoomSelect').value;
  if(!room){
    document.getElementById('linkPreview').innerHTML = '';
    return;
  }

  const paymentLink = `${window.location.origin}/payment?room=${room}`;
  const qrId = 'qr-' + room;

  document.getElementById('linkPreview').innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:1.5rem;margin-top:1rem;">
      <div style="margin-bottom:1.5rem;">
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📱 ลิ้งค์ชำระเงิน:</label>
        <div style="background:#f5f5f5;padding:10px;border-radius:6px;word-break:break-all;font-size:.9rem;font-family:monospace;margin-bottom:10px;">
          ${paymentLink}
        </div>
        <button onclick="copyToClipboard('${paymentLink}')" style="padding:8px 16px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">📋 คัดลอก</button>
      </div>

      <div>
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📲 QR Code:</label>
        <div style="background:#f5f5f5;border-radius:6px;padding:1rem;text-align:center;" id="${qrId}"></div>
        <button onclick="downloadQRCode('${qrId}', 'payment-room-${room}')" style="width:100%;margin-top:10px;padding:8px 16px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">⬇️ ดาวน์โหลด QR Code</button>
      </div>
    </div>
  `;

  setTimeout(() => {
    new QRCode(document.getElementById(qrId), {
      text: paymentLink,
      width: 180,
      height: 180,
      colorDark: '#000',
      colorLight: '#fff'
    });
  }, 50);
}

function copyToClipboard(text){
  navigator.clipboard.writeText(text).then(() => {
    showToast('คัดลอกลิ้งค์เรียบร้อย', 'success');
  });
}

function downloadQRCode(elementId, filename){
  const canvas = document.querySelector(`#${elementId} canvas`);
  if(!canvas){
    showToast('QR Code ยังสร้างไม่เสร็จ', 'warning');
    return;
  }
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename + '.png';
  link.click();
}


// ===== INIT =====
document.addEventListener('DOMContentLoaded', async ()=>{
  // Wait for Firebase to be initialized
  if (!window.firebaseReady) {
    console.log('⏳ Waiting for Firebase to initialize...');
    // Wait up to 10 seconds for Firebase
    let waitCount = 0;
    while (!window.firebaseReady && waitCount < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }
    if (!window.firebaseReady) {
      console.error('❌ Firebase failed to initialize');
      alert('Error: Firebase initialization failed. Please reload the page.');
      return;
    }
  }

  // ===== ACCESS CONTROL =====
  // Protect dashboard - admin only
  if (!AccessControl.protectPage('admin')) {
    console.error('❌ Access denied: This page is for admin only');
    AccessControl.logAccessAttempt('/dashboard', false);
    return;
  }
  AccessControl.logAccessAttempt('/dashboard', true);

  // Initialize all room users if not already done
  initializeAllRoomUsers();

  populateRoomDropdown();
  const now=new Date();
  document.getElementById('f-month').value=now.getMonth()+1;
  document.getElementById('f-year').value=now.getFullYear()+543;
  // Pre-select current month in vacant room checker
  document.getElementById('vc-month').value=now.getMonth()+1;
  renderPaymentStatus();
  // PromptPay number must be set by admin in settings
  // No hardcoded default for security reasons
  if(!localStorage.getItem('promptpay')){
    console.warn('⚠️ PromptPay number not configured. Admin must set this in dashboard settings.');
  }
  // Restore saved PromptPay number
  if(PROMPTPAY_NUMBER){
    document.getElementById('pp-input').value=PROMPTPAY_NUMBER;
    document.getElementById('pp-status').textContent='✅ บันทึกแล้ว: '+PROMPTPAY_NUMBER;
  }
  // Pre-select current month in meter table
  document.getElementById('mt-month').value=now.getMonth()+1;
  document.getElementById('mt-year').value=now.getFullYear()+543;
  // Sync year UI state immediately (hide/show live cards based on default currentYear)
  syncDashboardYearUI();
  // Delay KPI updates to ensure data is loaded from localStorage
  setTimeout(updateDashboardLive,100);
  setTimeout(initDashboardCharts,300);
});

// ===== MAINTENANCE SYSTEM =====

// Auto-cleanup old completed tickets (delete after 30 days of completion)
function autoCleanupOldCompletedTickets(tickets) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const filtered = tickets.filter(ticket => {
    // Keep tickets that are not done
    if (ticket.status !== 'done') return true;

    // Keep tickets without completedAt field
    if (!ticket.completedAt) return true;

    try {
      const completedTime = new Date(ticket.completedAt).getTime();
      const ageMs = now - completedTime;

      // Keep if less than 30 days old
      if (ageMs <= THIRTY_DAYS_MS) return true;

      // Delete old completed ticket from storage
      console.log(`🗑️ Deleting old maintenance ticket: ${ticket.id} (${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days old)`);

      // Remove from Firebase if available
      if (typeof TenantFirebaseSync !== 'undefined' && TenantFirebaseSync.deleteMaintenanceTicket) {
        const building = ticket.building || 'rooms';
        const room = ticket.room;
        if (room) {
          TenantFirebaseSync.deleteMaintenanceTicket(building, room, ticket.id).catch(err =>
            console.warn('⚠️ Could not delete from Firebase:', err)
          );
        }
      }

      return false; // Remove from filtered array
    } catch (error) {
      console.warn(`⚠️ Error processing ticket ${ticket.id}:`, error);
      return true; // Keep on error
    }
  });

  // Update localStorage with filtered tickets
  if (filtered.length !== tickets.length) {
    console.log(`✅ Cleaned up ${tickets.length - filtered.length} old maintenance tickets`);
  }

  return filtered;
}

function loadMaintenance(){
  // ✅ Load from localStorage (admin dashboard primary source)
  let localData = JSON.parse(localStorage.getItem('maintenance_data')||'[]');
  console.log(`📋 Loaded ${localData.length} maintenance requests from localStorage`);

  // Auto-cleanup old completed tickets (30+ days old)
  localData = autoCleanupOldCompletedTickets(localData);

  // Update localStorage with cleaned data
  if (localData.length > 0) {
    localStorage.setItem('maintenance_data', JSON.stringify(localData));
  }

  // Note: Firebase sync would happen via tenant app → updates localStorage
  // For real-time updates, integrate Firebase listener here in future
  return localData;
}
function saveMaintenance(d){
  localStorage.setItem('maintenance_data',JSON.stringify(d));
  console.log('✅ Maintenance saved to localStorage');
}

function initMaintenancePage(){

  const now=new Date();
  const md=document.getElementById('mx-date');
  if(md&&!md.value)md.value=now.toISOString().split('T')[0];
  const hd=document.getElementById('hk-date');
  if(hd&&!hd.value)hd.value=now.toISOString().split('T')[0];
  renderMaintenancePage();
  renderHousekeepingList();
  updateMxBadge();
  updateMaintenanceBadge();
}

function updateMxBadge(){
  const badge=document.getElementById('mxBadge');
  if(!badge)return;
  const mx=loadMaintenance();
  const hk=loadHousekeeping();
  const mxPending=mx.filter(x=>x.status==='pending'||x.status==='inprogress').length;
  const hkPending=hk.filter(x=>x.status==='pending'||x.status==='inprogress').length;
  const total=mxPending+hkPending;
  if(total>0){badge.textContent=total;badge.style.display='inline-block';}
  else{badge.style.display='none';}
}

function updateNotificationBell() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  const mx = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
  const hk = JSON.parse(localStorage.getItem('housekeeping_data') || '[]');
  const comp = JSON.parse(localStorage.getItem('complaints_data') || '[]');
  const pays = JSON.parse(localStorage.getItem('tenant_payments') || '[]');

  let pendingPets = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tenant_pets_')) {
      const pets = JSON.parse(localStorage.getItem(key) || '[]');
      pendingPets = pendingPets.concat(pets.filter(p => p.status === 'pending'));
    }
  }

  const counts = {
    maintenance: mx.filter(x => x.status === 'pending' || x.status === 'inprogress').length,
    housekeeping: hk.filter(x => x.status === 'pending' || x.status === 'inprogress').length,
    complaints: comp.filter(x => x.status === 'open').length,
    pets: pendingPets.length,
    payments: pays.filter(x => x.status === 'pending').length
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  badge.textContent = total > 99 ? '99+' : total;
  badge.style.display = total > 0 ? 'inline-block' : 'none';

  // Build dropdown content
  const content = document.getElementById('notifContent');
  if (!content) return;

  if (total === 0) {
    content.innerHTML = '<div class="notif-empty">✅ ไม่มีการแจ้งเตือนใหม่</div>';
    return;
  }

  const groups = [
    { key: 'maintenance', icon: '🔧', label: 'Maintenance รอดำเนินการ', page: 'requests-approvals', tab: 'maintenance' },
    { key: 'housekeeping', icon: '🧹', label: 'Housekeeping รอดำเนินการ', page: 'requests-approvals', tab: 'housekeeping' },
    { key: 'complaints', icon: '⚠️', label: 'Complaints ที่ยังเปิดอยู่', page: 'requests-approvals', tab: 'complaints' },
    { key: 'pets', icon: '🐾', label: 'Pet Approvals รอการอนุมัติ', page: 'requests-approvals', tab: 'pets' },
    { key: 'payments', icon: '💳', label: 'Payment ยังไม่ตรวจสอบ', page: 'payment-verify', tab: null }
  ];

  content.innerHTML = groups
    .filter(g => counts[g.key] > 0)
    .map(g => {
      const nav = g.tab
        ? `window.showPage('${g.page}');setTimeout(()=>switchRequestsTab('${g.tab}',document.getElementById('tab-${g.tab}-btn')),80);toggleNotifPanel();`
        : `window.showPage('${g.page}',document.querySelector('[onclick*="${g.page}"]'));toggleNotifPanel();`;
      return `<div class="notif-group-title">${g.icon} ${g.label}</div>
<div class="notif-item" onclick="${nav}">
  <span>${g.icon} ${counts[g.key]} รายการรอดำเนินการ</span>
  <span class="notif-item-count">${counts[g.key]}</span>
</div>`;
    }).join('');
}

function toggleNotifPanel() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (!isOpen) updateNotificationBell(); // refresh on open
  dd.classList.toggle('open', !isOpen);
}

document.addEventListener('click', function(e) {
  const wrapper = document.getElementById('notifBellWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.classList.remove('open');
  }
});

function updateMaintenanceBadge(){
  const banner=document.getElementById('mx-notification-banner');
  const pendingCount=document.getElementById('mx-pending-count');
  if(!banner||!pendingCount)return;
  const mx=loadMaintenance();
  const pendingTickets=mx.filter(x=>x.status==='pending').length;
  if(pendingTickets>0){
    pendingCount.textContent=pendingTickets;
    banner.style.display='block';
  }else{
    banner.style.display='none';
  }
}

// Fixed to match tenant.html category names
const MX_CAT_LABEL={
  'electric':'⚡ ไฟฟ้า',
  'electrical':'⚡ ไฟฟ้า',
  'water':'💧 น้ำ',
  'plumbing':'🚿 ประปา/น้ำ',
  'aircon':'❄️ แอร์',
  'ac':'❄️ แอร์/พัดลม',
  'furniture':'🪑 เฟอร์นิเจอร์',
  'repair':'🔧 ซ่อมแซม',
  'other':'📝 อื่นๆ'
};
const MX_STATUS_LABEL={'pending':'⏳ รอดำเนินการ','inprogress':'🔨 กำลังดำเนินการ','done':'✅ เสร็จแล้ว'};
const MX_STATUS_CLASS={'pending':'mx-pending','inprogress':'mx-inprogress','done':'mx-done'};

function addMaintenanceRequest(){
  // Validate maintenance form
  const validation = validateMaintenanceForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    return;
  }

  const room=document.getElementById('mx-room').value.trim();
  const desc=document.getElementById('mx-desc').value.trim();
  const date=document.getElementById('mx-date').value;
  const cat=document.getElementById('mx-category').value;
  const pri=document.getElementById('mx-priority').value;
  // Sanitize inputs
  const sanitizedRoom = window.SecurityUtils.sanitizeInput(room);
  const sanitizedDesc = window.SecurityUtils.sanitizeInput(desc);
  const mx=loadMaintenance();
  const ticketId='T'+Date.now();
  const newTicket={
    id:ticketId,
    room:sanitizedRoom,
    desc:sanitizedDesc,
    category:cat,
    priority:pri,
    status:'pending',
    reportedAt:date,
    updatedAt:date,
    assignedTo:null,
    startedAt:null,
    workNotes:null,
    completedAt:null,
    beforePhoto:null,
    afterPhoto:null
  };
  mx.unshift(newTicket);
  saveMaintenance(mx);

  // Also save to tenant_maintenance_tickets for realtime sync
  const tenantTickets=JSON.parse(localStorage.getItem('tenant_maintenance_tickets')||'[]');
  tenantTickets.unshift({...newTicket});
  localStorage.setItem('tenant_maintenance_tickets',JSON.stringify(tenantTickets));
  console.log('💾 Added new ticket to tenant_maintenance_tickets:', ticketId);

  // ===== AUDIT LOGGING =====
  if (window.logMaintenanceCreated) {
    window.logMaintenanceCreated(sanitizedRoom, sanitizedDesc, MX_CAT_LABEL[cat] || cat);
  }

  document.getElementById('mx-room').value='';
  document.getElementById('mx-desc').value='';
  document.getElementById('mx-priority').value='normal';
  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();
  // Dispatch event for tenant app
  window.dispatchEvent(new CustomEvent('maintenance_ticket_submitted', {detail:{room:sanitizedRoom,category:cat}}));
  // toast
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกงานซ่อมแล้ว';document.body.appendChild(t);setTimeout(()=>t.remove(),2500);
  closeAddMaintenanceModal();
}

function showAddMaintenanceModal(){
  const modal=document.createElement('div');
  modal.id='mx-add-modal';
  modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;color:var(--text);">➕ แจ้งซ่อมใหม่</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ห้อง</label><input type="text" id="mx-room-modal" placeholder="เช่น 15ก, 22, Amazon" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">วันที่แจ้ง</label><input type="date" id="mx-date-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
    </div>
    <div style="margin-bottom:1.5rem;"><label style="font-weight:600;display:block;margin-bottom:6px;">รายละเอียดปัญหา</label><textarea id="mx-desc-modal" placeholder="เช่น ประตูปิดไม่สนิท, น้ำรั้ว, แอร์ไม่เย็น..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:80px;resize:vertical;"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">หมวดหมู่</label>
        <select id="mx-category-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="electrical">⚡ ไฟฟ้า</option>
          <option value="plumbing">🚿 ประปา/น้ำ</option>
          <option value="repair">🔧 ซ่อมแซมทั่วไป</option>
          <option value="ac">❄️ แอร์/พัดลม</option>
          <option value="other">📦 อื่นๆ</option>
        </select>
      </div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ความสำคัญ</label>
        <select id="mx-priority-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="normal">🟡 ปกติ</option>
          <option value="urgent">🔴 ด่วน</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="addMaintenanceRequestFromModal()" style="flex:1;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);color:#fff;border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;transition:all 0.3s;">📝 บันทึกงานซ่อม</button>
      <button onclick="closeAddMaintenanceModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target.id==='mx-add-modal')closeAddMaintenanceModal();});
  // Set today's date
  document.getElementById('mx-date-modal').valueAsDate=new Date();
}

function closeAddMaintenanceModal(){
  const modal=document.getElementById('mx-add-modal');
  if(modal)modal.remove();
}

function addMaintenanceRequestFromModal(){
  const room=document.getElementById('mx-room-modal').value.trim();
  const desc=document.getElementById('mx-desc-modal').value.trim();
  const date=document.getElementById('mx-date-modal').value;
  const cat=document.getElementById('mx-category-modal').value;
  const pri=document.getElementById('mx-priority-modal').value;

  if(!room||!desc||!date){
    showToast('กรุณากรอกข้อมูลให้ครบ', 'warning');
    return;
  }

  // Temporarily set form inputs for addMaintenanceRequest
  document.getElementById('mx-room').value=room;
  document.getElementById('mx-desc').value=desc;
  document.getElementById('mx-date').value=date;
  document.getElementById('mx-category').value=cat;
  document.getElementById('mx-priority').value=pri;

  addMaintenanceRequest();
}

function updateMaintenanceStatus(id,newStatus){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  // Direct status update with timestamps
  if(newStatus==='inprogress'){
    item.status='inprogress';
    item.startedAt=new Date().toISOString();
  } else if(newStatus==='done'){
    // Ensure startedAt exists before marking done
    if(!item.startedAt){
      item.startedAt=new Date().toISOString(); // Auto-set if missing
    }
    item.status='done';
    item.completedAt=new Date().toISOString();
  } else {
    item.status=newStatus;
  }

  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);

  // Sync to tenant's maintenance tickets
  const tenantTickets=JSON.parse(localStorage.getItem('tenant_maintenance_tickets')||'[]');
  console.log('🔍 Looking for ticket',id,'in tenant_maintenance_tickets:', tenantTickets.map(t=>t.id));
  let tenantTicket=tenantTickets.find(t=>t.id===id);

  if(tenantTicket){
    console.log('✅ Found ticket, updating status from',tenantTicket.status,'to',item.status);
    tenantTicket.status=item.status;
    tenantTicket.updatedAt=item.updatedAt;
    // Push admin data when marked as done
    if(item.status==='done'){
      tenantTicket.assignedTo=item.assignedTo;
      tenantTicket.beforePhoto=item.beforePhoto; // Keep tenant's original "before" photo
      tenantTicket.afterPhoto=item.afterPhoto;
      tenantTicket.workNotes=item.workNotes;
      tenantTicket.completedAt=item.completedAt;
      console.log('📤 Sending admin completion data to tenant:', {assignedTo: item.assignedTo, beforePhoto: !!item.beforePhoto, afterPhoto: !!item.afterPhoto, workNotes: item.workNotes});
    }
  } else {
    // If not found, add it with current data (for tickets that existed before tenant_maintenance_tickets)
    console.log('⚠️ Ticket not found in tenant_maintenance_tickets, adding it now');
    tenantTicket={
      id: item.id,
      room: item.room,
      category: item.category,
      title: item.title,
      description: item.description,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      assignedTo: item.assignedTo,
      afterPhoto: item.afterPhoto,
      workNotes: item.workNotes
    };
    tenantTickets.unshift(tenantTicket);
  }

  localStorage.setItem('tenant_maintenance_tickets',JSON.stringify(tenantTickets));
  console.log('🔄 Synced ticket',id,'to tenant_maintenance_tickets with status:',tenantTicket.status);

  // Sync to Firebase for tenant app to see
  if(window.firebaseRef && window.firebaseUpdate && window.firebaseDatabase) {
    try {
      // Update in Firebase at maintenance/{building}/{room}/{id}
      const room = item.room;
      const maintenanceRef = window.firebaseRef(window.firebaseDatabase, `maintenance/rooms/${room}/${id}`);
      const firebaseData = {
        status: item.status,
        updatedAt: item.updatedAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt
      };
      // Include admin data when completed
      if(item.status==='done'){
        firebaseData.assignedTo = item.assignedTo;
        firebaseData.afterPhoto = item.afterPhoto;
        firebaseData.workNotes = item.workNotes;
      }
      window.firebaseUpdate(maintenanceRef, firebaseData);
      console.log('🔥 Updated Firebase maintenance ticket:', id, firebaseData);
    } catch(e) {
      console.log('⚠️ Firebase update failed (fallback to localStorage only):', e.message);
    }
  }

  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();

  // Show success toast
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  if(newStatus==='inprogress') t.textContent='✅ เริ่มทำงานแล้ว';
  else if(newStatus==='done') t.textContent='✅ บันทึกเสร็จสิ้นแล้ว';
  else t.textContent='✅ อัปเดตสถานะแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);

  // Broadcast to tenants (tenant.html listening)
  window.dispatchEvent(new CustomEvent('maintenance_status_updated', {
    detail: { id, status: newStatus, ticket: item }
  }));
}

// ===== MODAL FUNCTIONS FOR MAINTENANCE =====
function showAssignModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-assign-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:450px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">👤 อัปเดตผู้รับผิดชอบ</h2>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">ชื่อช่าง/ชื่อคน</label>
      <input type="text" id="assigned-name" placeholder="เช่น สมชาย, นายช่างสมบูรณ์" value="${item.assignedTo||''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:'Sarabun',sans-serif;">
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="assignMaintenanceWorker('${id}')" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ ยืนยัน</button>
      <button onclick="closeAssignModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">❌ ยกเลิก</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closeAssignModal();
  };
  document.body.appendChild(modal);
}

function showNotesModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-notes-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;overflow-y:auto;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;margin:20px auto;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">📝 หมายเหตุการทำงาน</h2>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">รายละเอียดการทำงาน</label>
      <textarea id="work-notes" placeholder="อธิบายสิ่งที่ทำแล้ว เช่น ซ่อมแซมไฟฟ้า เปลี่ยนสวิตช์..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:'Sarabun',sans-serif;resize:vertical;min-height:100px;">${item.workNotes||''}</textarea>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="saveWorkNotes('${id}')" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ บันทึก</button>
      <button onclick="closeNotesModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">❌ ยกเลิก</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closeNotesModal();
  };
  document.body.appendChild(modal);
}

function showPhotosModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-photos-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;overflow-y:auto;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;margin:20px auto;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">📷 แนบรูปภาพ</h2>
    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">📸 ถ่ายรูปก่อน (Before)</label>
      <input type="file" id="before-photo-input" accept="image/*" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
      ${(item.beforePhoto && (item.beforePhoto.startsWith('data:') || item.beforePhoto.startsWith('https://')))?'<div style="margin-top:8px;">\x3cimg src="'+item.beforePhoto+'" style="max-width:100%;height:120px;object-fit:cover;border-radius:6px;"></div>':''}
    </div>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">📸 ถ่ายรูปหลัง (After)</label>
      <input type="file" id="after-photo-input" accept="image/*" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
      ${(item.afterPhoto && (item.afterPhoto.startsWith('data:') || item.afterPhoto.startsWith('https://')))?'<div style="margin-top:8px;">\x3cimg src="'+item.afterPhoto+'" style="max-width:100%;height:120px;object-fit:cover;border-radius:6px;"></div>':''}
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="closePhotosModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ เสร็จ</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closePhotosModal();
  };
  document.body.appendChild(modal);

  const beforeInput=document.getElementById('before-photo-input');
  if(beforeInput){
    beforeInput.onchange=function(e){
      const file=e.target.files[0];
      if(file)handlePhotoUpload(file,'beforePhoto',id);
    };
  }

  const afterInput=document.getElementById('after-photo-input');
  if(afterInput){
    afterInput.onchange=function(e){
      const file=e.target.files[0];
      if(file)handlePhotoUpload(file,'afterPhoto',id);
    };
  }
}


function handlePhotoUpload(file, fieldName, id){
  const reader=new FileReader();
  reader.onload=function(e){
    const base64=e.target.result;
    const mx=loadMaintenance();
    const item=mx.find(x=>x.id===id);
    if(!item)return;
    item[fieldName]=base64;
    saveMaintenance(mx);
    renderMaintenancePage();
  };
  reader.readAsDataURL(file);
}

function assignMaintenanceWorker(id){
  const assignedName=document.getElementById('assigned-name').value.trim();
  if(!assignedName){
    showToast('กรุณากรอกชื่อผู้รับผิดชอบ', 'warning');
    return;
  }
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;
  item.assignedTo=assignedName;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);
  closeAssignModal();
  renderMaintenancePage();
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกผู้รับผิดชอบแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}

function saveWorkNotes(id){
  const workNotes=document.getElementById('work-notes').value.trim();
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;
  item.workNotes=workNotes;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);
  closeNotesModal();
  renderMaintenancePage();
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกหมายเหตุแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}

function editMaintenance(id, field){
  if(field==='assign'){
    showAssignModal(id);
  } else if(field==='notes'){
    showNotesModal(id);
  } else if(field==='photos'){
    showPhotosModal(id);
  }
}

function closeAssignModal(){
  const modal=document.getElementById('mx-assign-modal');
  if(modal)modal.remove();
}

function closeNotesModal(){
  const modal=document.getElementById('mx-notes-modal');
  if(modal)modal.remove();
}

function closePhotosModal(){
  const modal=document.getElementById('mx-photos-modal');
  if(modal)modal.remove();
}

function deleteMaintenanceRequest(id){
  if(!confirm('ลบรายการนี้?'))return;
  saveMaintenance(loadMaintenance().filter(x=>x.id!==id));
  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();
}

function calculateDuration(startedAt, completedAt){
  if(!startedAt||!completedAt)return null;
  const start=new Date(startedAt);
  const end=new Date(completedAt);
  let ms=end-start;

  // Fix negative duration (from timezone or wrong order)
  if(ms<0)ms=0;

  const mins=Math.floor(ms/60000);
  const hours=Math.floor(mins/60);
  const remMins=mins%60;
  if(hours===0)return`${remMins} นาที`;
  if(remMins===0)return`${hours} ชั่วโมง`;
  return`${hours} ชั่วโมง ${remMins} นาที`;
}

// Open photo modal to view before/after images
function openPhotoModal(beforePhoto, afterPhoto) {
  const modal = document.getElementById('photoModal');
  const photosContainer = document.getElementById('photoModalPhotos');

  let html = '';

  const isValidPhoto = (url) => url && (url.startsWith('data:') || url.startsWith('https://'));

  if (isValidPhoto(beforePhoto)) {
    html += `
      <div class="photo-modal-item">
        <span class="photo-modal-item-label">ก่อนซ่อม (Before)</span>
        \x3cimg src="${beforePhoto}" alt="Before repair">
      </div>
    `;
  }

  if (isValidPhoto(afterPhoto)) {
    html += `
      <div class="photo-modal-item">
        <span class="photo-modal-item-label">หลังซ่อม (After)</span>
        \x3cimg src="${afterPhoto}" alt="After repair">
      </div>
    `;
  }

  photosContainer.innerHTML = html;
  modal.classList.add('active');
}

// Close photo modal
function closePhotoModal() {
  const modal = document.getElementById('photoModal');
  modal.classList.remove('active');
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('photoModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closePhotoModal();
      }
    });
  }
});

function renderMaintenancePage(){
  const mx=loadMaintenance();
  // Update KPIs
  document.getElementById('mx-kpi-pending').textContent=mx.filter(x=>x.status==='pending').length;
  document.getElementById('mx-kpi-inprogress').textContent=mx.filter(x=>x.status==='inprogress').length;
  document.getElementById('mx-kpi-done').textContent=mx.filter(x=>x.status==='done').length;
  // Update notification banner
  updateMaintenanceBadge();
  // Filter
  const fs=document.getElementById('mx-filter-status')?.value||'all';
  const fr=(document.getElementById('mx-filter-room')?.value||'').toLowerCase();
  let filtered=mx;
  if(fs!=='all')filtered=filtered.filter(x=>x.status===fs);
  if(fr)filtered=filtered.filter(x=>x.room.toLowerCase().includes(fr));
  const el=document.getElementById('mxList');
  if(!el)return;
  if(!filtered.length){el.innerHTML='<div style="text-align:center;padding:40px 32px;color:var(--text-muted);font-size:.95rem;">ไม่มีรายการ</div>';return;}
  const fmt=d=>{if(!d)return'—';const p=d.split('-');return`${parseInt(p[2])} ${['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(p[1])]}`;};
  el.innerHTML=filtered.map(x=>`
    <div class="mx-row" style="${x.status==='done'?'opacity:.7;':''}">
      <div>
        <div style="width:60px;height:60px;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;box-shadow:0 2px 8px rgba(76, 175, 80, 0.3);">
          ${x.room.substring(0,2)}
        </div>
        <div>
          <div style="font-weight: 700; font-size: 1rem; color: var(--green); margin-bottom: 0.5rem; padding: 0.4rem 0.8rem; background: #f0f9f0; border-radius: 4px; border-left: 4px solid var(--green); display: inline-block;">🎟️ ${x.id}</div>
          <div class="mx-row-header">${x.room} ${x.priority==='urgent'?'<span class="mx-urgent">ด่วน!</span>':''}</div>
          <div style="font-size:.85rem;color:#555;line-height:1.5;margin-bottom:6px;">${x.desc}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="mx-status-pill ${MX_STATUS_CLASS[x.status]||'mx-pending'}">${MX_STATUS_LABEL[x.status]||x.status}</span>
            ${x.photoUrl||x.photo||x.beforePhoto||x.afterPhoto?'<span style="font-size:.75rem;color:var(--blue);background:#e3f2fd;padding:4px 10px;border-radius:20px;">📸 มีรูปภาพ</span>':''}
            ${x.assignedTo?'<span style="font-size:.75rem;color:#5e35b1;background:#e8e4f3;padding:4px 10px;border-radius:20px;">👤 '+x.assignedTo+'</span>':''}
          </div>
          ${x.photoUrl||x.photo||x.beforePhoto||x.afterPhoto?`<div style="margin-top:8px;"><button class="photo-viewer-btn" onclick="openPhotoModal('${x.beforePhoto||x.photoUrl||x.photo||''}', '${x.afterPhoto||''}')">📸 รูปภาพ</button></div>`:''}

          <div class="mx-row-meta">
            <div><strong>หมวด:</strong> ${MX_CAT_LABEL[x.category]||x.category}</div>
            <div><strong>วันที่แจ้ง:</strong> ${fmt(x.reportedAt)}</div>
            <div><strong>เวลาทำงาน:</strong> ${(() => {
              if(!x.startedAt||!x.completedAt)return'—';
              const dur = calculateDuration(x.startedAt,x.completedAt);
              return dur==='0 นาที'?'ภายใน 1-2 วัน':'⏱️ '+dur;
            })()}</div>
          </div>
          <div class="mx-row-actions">
            ${x.status==='pending'?`<button class="mx-btn mx-btn-next" onclick="updateMaintenanceStatus('${x.id}','inprogress')">🔨 รับงาน</button>`:''}
            ${x.status==='inprogress'?`<button class="mx-btn mx-btn-done" onclick="updateMaintenanceStatus('${x.id}','done')">✅ เสร็จ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','assign')">📝 ผู้รับผิดชอบ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','notes')">📋 หมายเหตุ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','photos')">📷 รูปภาพ</button>`:''}
            ${x.status==='done'?`<button class="mx-btn mx-btn-reopen" onclick="updateMaintenanceStatus('${x.id}','pending')">↩ เปิดใหม่</button>`:''}
            <button class="mx-btn mx-btn-del" onclick="deleteMaintenanceRequest('${x.id}')">🗑️ ลบ</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}

// ===== HOUSEKEEPING REQUEST MANAGEMENT =====
function loadHousekeeping(){return JSON.parse(localStorage.getItem('housekeeping_data')||'[]');}
function saveHousekeeping(d){localStorage.setItem('housekeeping_data',JSON.stringify(d));}

function initHousekeepingPage(){
  const now=new Date();
  const hd=document.getElementById('hk-date');
  if(hd&&!hd.value)hd.value=now.toISOString().split('T')[0];
  renderHousekeepingList();
  updateMxBadge(); // Update combined badge
}

const HK_SERVICE_LABEL={
  'standard':'🧹 Standard (ทำความสะอาดมาตรฐาน)',
  'deep-clean':'🧼 Deep-Clean (ทำความสะอาดเชิงลึก)',
  'linen-change':'🛏️ Linen Change (เปลี่ยนผ้านวม/หมอน)',
  'urgent':'⚡ Urgent (ด่วนพิเศษ)'
};
const HK_STATUS_LABEL={'pending':'⏳ รอดำเนินการ','inprogress':'🔨 กำลังดำเนินการ','done':'✅ เสร็จแล้ว'};
const HK_STATUS_CLASS={'pending':'mx-pending','inprogress':'mx-inprogress','done':'mx-done'};

function showAddHousekeepingModal(){
  const modal=document.createElement('div');
  modal.id='hk-add-modal';
  modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;color:var(--text);">➕ ขอบริการทำความสะอาดใหม่</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ห้อง</label><input type="text" id="hk-room-modal" placeholder="เช่น 15ก, 22, Amazon" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">วันที่ขอ</label><input type="date" id="hk-date-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
    </div>
    <div style="margin-bottom:1.5rem;"><label style="font-weight:600;display:block;margin-bottom:6px;">หมายเหตุพิเศษ</label><textarea id="hk-desc-modal" placeholder="เช่น ฝังหนามความสะอาด, บริเวณให้ความสำคัญ..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:80px;resize:vertical;"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ประเภทบริการ</label>
        <select id="hk-service-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="standard">🧹 Standard</option>
          <option value="deep-clean">🧼 Deep-Clean</option>
          <option value="linen-change">🛏️ Linen Change</option>
          <option value="urgent">⚡ Urgent</option>
        </select>
      </div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ความสำคัญ</label>
        <select id="hk-priority-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="normal">🟡 ปกติ</option>
          <option value="urgent">🔴 ด่วน</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="addHousekeepingRequestFromModal()" style="flex:1;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);color:#fff;border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;transition:all 0.3s;">📝 บันทึกการขอบริการ</button>
      <button onclick="closeAddHousekeepingModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target.id==='hk-add-modal')closeAddHousekeepingModal();});
  // Set today's date
  document.getElementById('hk-date-modal').valueAsDate=new Date();
}

function closeAddHousekeepingModal(){
  const modal=document.getElementById('hk-add-modal');
  if(modal)modal.remove();
}

function addHousekeepingRequestFromModal(){
  const room=document.getElementById('hk-room-modal').value.trim();
  const desc=document.getElementById('hk-desc-modal').value.trim();
  const date=document.getElementById('hk-date-modal').value;
  const service=document.getElementById('hk-service-modal').value;
  const priority=document.getElementById('hk-priority-modal').value;

  if(!room||!date){
    showToast('กรุณากรอกข้อมูลให้ครบ', 'warning');
    return;
  }

  // Temporarily set form inputs for addHousekeepingRequest
  document.getElementById('hk-room').value=room;
  document.getElementById('hk-desc').value=desc;
  document.getElementById('hk-date').value=date;
  document.getElementById('hk-service').value=service;
  document.getElementById('hk-priority').value=priority;

  addHousekeepingRequest();
}

function addHousekeepingRequest(){
  // Validate housekeeping form
  const room=document.getElementById('hk-room')?.value?.trim()||'';
  const service=document.getElementById('hk-service')?.value||'standard';
  const priority=document.getElementById('hk-priority')?.value||'normal';
  const desc=document.getElementById('hk-desc')?.value?.trim()||'';
  const date=document.getElementById('hk-date')?.value||'';

  // Validation
  if(!room||room.length>10){showToast('กรุณาป้อนหมายเลขห้องให้ถูกต้อง (สูงสุด 10 ตัว)', 'warning');return;}
  if(!date){showToast('กรุณาเลือกวันที่', 'warning');return;}
  if(new Date(date)>new Date()){showToast('ไม่สามารถเลือกวันในอนาคต', 'warning');return;}
  if(desc.length>200){showToast('หมายเหตุต้องไม่เกิน 200 ตัวอักษร', 'warning');return;}

  // Sanitize inputs
  const sanitizedRoom=window.SecurityUtils.sanitizeInput(room);
  const sanitizedDesc=window.SecurityUtils.sanitizeInput(desc);

  const hk=loadHousekeeping();
  hk.unshift({
    id:'HK'+Date.now(),
    room:sanitizedRoom,
    service:service,
    priority:priority,
    description:sanitizedDesc,
    status:'pending',
    submittedAt:date,
    updatedAt:date
  });
  saveHousekeeping(hk);

  // Clear form
  document.getElementById('hk-room').value='';
  document.getElementById('hk-desc').value='';
  document.getElementById('hk-service').value='standard';
  document.getElementById('hk-priority').value='normal';

  renderHousekeepingList();
  updateMxBadge(); // Update combined badge

  // Toast notification
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกการขอบริการแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
  closeAddHousekeepingModal();
}

function updateHousekeepingStatus(id,newStatus){
  const hk=loadHousekeeping();
  const item=hk.find(x=>x.id===id);
  if(!item)return;
  item.status=newStatus;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveHousekeeping(hk);

  // Broadcast to tenants if maintenance status changed
  window.dispatchEvent(new CustomEvent('housekeeping_status_updated', {
    detail: { id, status: newStatus, ticket: item }
  }));

  renderHousekeepingList();
  updateMxBadge(); // Update combined badge
}

function deleteHousekeepingRequest(id){
  if(!confirm('ลบรายการนี้?'))return;
  saveHousekeeping(loadHousekeeping().filter(x=>x.id!==id));
  renderHousekeepingList();
  updateMxBadge(); // Update combined badge
}

function renderHousekeepingList(){
  const hk=loadHousekeeping();
  // Update KPIs
  document.getElementById('hk-kpi-pending').textContent=hk.filter(x=>x.status==='pending').length;
  document.getElementById('hk-kpi-inprogress').textContent=hk.filter(x=>x.status==='inprogress').length;
  document.getElementById('hk-kpi-done').textContent=hk.filter(x=>x.status==='done').length;

  // Filter
  const fs=document.getElementById('hk-filter-status')?.value||'all';
  const fr=(document.getElementById('hk-filter-room')?.value||'').toLowerCase();
  let filtered=hk;
  if(fs!=='all')filtered=filtered.filter(x=>x.status===fs);
  if(fr)filtered=filtered.filter(x=>x.room.toLowerCase().includes(fr));

  const el=document.getElementById('hkList');
  if(!el)return;
  if(!filtered.length){
    el.innerHTML='<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:.9rem;">ไม่มีรายการ</div>';
    return;
  }

  const fmt=d=>{
    if(!d)return'—';
    const p=d.split('-');
    return`${parseInt(p[2])} ${['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(p[1])]}`;
  };

  el.innerHTML=filtered.map(x=>`
    <div class="mx-row" style="${x.status==='done'?'opacity:.7;':''}">
      <div>
        <div style="width:60px;height:60px;background:linear-gradient(135deg, #2196f3 0%, #1976d2 100%);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;box-shadow:0 2px 8px rgba(33, 150, 243, 0.3);">
          ${x.room.substring(0,2)}
        </div>
        <div>
          <div class="mx-row-header">${x.room} ${x.priority==='urgent'?'<span class="mx-urgent">ด่วน!</span>':''}</div>
          <div style="font-size:.85rem;color:#555;line-height:1.5;margin-bottom:6px;">${HK_SERVICE_LABEL[x.service]||x.service}</div>
          ${x.description?'<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px;">หมายเหตุ: '+x.description+'</div>':''}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="mx-status-pill ${HK_STATUS_CLASS[x.status]||'mx-pending'}">${HK_STATUS_LABEL[x.status]||x.status}</span>
          </div>
          <div class="mx-row-meta">
            <div><strong>วันที่ขอ:</strong> ${fmt(x.submittedAt)}</div>
            <div><strong>ประเภท:</strong> ${x.service}</div>
            <div><strong>สถานะ:</strong> ${HK_STATUS_LABEL[x.status]||x.status}</div>
          </div>
          <div class="mx-row-actions">
            ${x.status==='pending'?`<button class="mx-btn mx-btn-next" onclick="updateHousekeepingStatus('${x.id}','inprogress')">🔨 เริ่มทำความสะอาด</button>`:''}
            ${x.status==='inprogress'?`<button class="mx-btn mx-btn-done" onclick="updateHousekeepingStatus('${x.id}','done')">✅ เสร็จสิ้น</button>`:''}
            ${x.status==='done'?`<button class="mx-btn mx-btn-reopen" onclick="updateHousekeepingStatus('${x.id}','pending')">↩ เปิดใหม่</button>`:''}
            <button class="mx-btn mx-btn-del" onclick="deleteHousekeepingRequest('${x.id}')">🗑️ ลบ</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}

function switchMaintenanceTab(tabName, btn) {
  // Shim: redirect to unified switchRequestsTab
  const tabBtn = btn || document.getElementById('tab-' + tabName + '-btn');
  switchRequestsTab(tabName, tabBtn);
}

// ===== ANNOUNCEMENTS MANAGEMENT =====
let announcementBuilding = 'rooms';

function setAnnouncementBuilding(bld, btn) {
  document.querySelectorAll('#page-announcements .year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  announcementBuilding = bld;
  renderAnnouncementsList();
}

function initAnnouncementsPage() {
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('ann-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = today;
  }

  // Set up real-time Firebase listeners for announcements
  setupAnnouncementListener();
  console.log('✅ Real-time announcement listeners activated');

  renderAnnouncementsList();
}

function loadAnnouncements() {
  return JSON.parse(localStorage.getItem('announcements_data') || '[]');
}

function saveAnnouncementsData(data) {
  localStorage.setItem('announcements_data', JSON.stringify(data));
  console.log('✅ Announcements saved to localStorage');
}

function saveAnnouncement() {
  const title = document.getElementById('ann-title')?.value?.trim();
  const content = document.getElementById('ann-content')?.value?.trim();
  const icon = document.getElementById('ann-icon')?.value?.trim() || '📢';
  const date = document.getElementById('ann-date')?.value || new Date().toISOString().split('T')[0];
  const time = document.getElementById('ann-time')?.value?.trim() || '';

  if (!title || !content) {
    showToast('กรุณากรอกหัวข้อและเนื้อหา', 'warning');
    return;
  }

  const announcement = {
    id: `ANN${Date.now()}`,
    building: announcementBuilding,
    title: title,
    content: content,
    icon: icon,
    date: date,
    time: time,
    createdAt: new Date().toISOString(),
    createdBy: window.SecurityUtils?.getSecureSession()?.name || window.SecurityUtils?.getSecureSession()?.email || '📌 Admin'
  };

  // Save to localStorage
  let announcements = loadAnnouncements();
  announcements.unshift(announcement);
  saveAnnouncementsData(announcements);

  // Save to Firebase
  if (window.firebase && window.firebase.firestore) {
    try {
      const db = window.firebase.firestore();
      const docRef = db.collection('announcements').doc(announcement.building).collection('items').doc(announcement.id);
      docRef.set(announcement)
        .then(() => {
          console.log('✅ Announcement saved to Firebase:', announcement.id);
        })
        .catch(err => {
          console.error('❌ Error saving to Firebase:', err);
        });
    } catch (err) {
      console.warn('⚠️ Firebase not available, announcement saved to localStorage only');
    }
  }

  console.log('📢 Announcement saved:', announcement);

  // Clear form
  document.getElementById('ann-title').value = '';
  document.getElementById('ann-content').value = '';
  document.getElementById('ann-icon').value = '📢';
  document.getElementById('ann-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ann-time').value = '';

  // Show toast
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  toast.textContent = '✅ สร้างประกาศแล้ว';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);

  renderAnnouncementsList();
}

function deleteAnnouncement(id) {
  if (!confirm('ลบประกาศนี้?')) return;

  let announcements = loadAnnouncements();
  const announcement = announcements.find(a => a.id === id);
  announcements = announcements.filter(a => a.id !== id);
  saveAnnouncementsData(announcements);

  // Delete from Firebase
  if (window.firebase && window.firebase.firestore && announcement) {
    try {
      const db = window.firebase.firestore();
      db.collection('announcements').doc(announcement.building).collection('items').doc(id)
        .delete()
        .then(() => {
          console.log('✅ Announcement deleted from Firebase:', id);
        })
        .catch(err => {
          console.error('❌ Error deleting from Firebase:', err);
        });
    } catch (err) {
      console.warn('⚠️ Firebase not available, announcement deleted from localStorage only');
    }
  }

  renderAnnouncementsList();
}

function renderAnnouncementsList() {
  const announcements = loadAnnouncements();
  const filtered = announcements.filter(a => a.building === announcementBuilding);

  const container = document.getElementById('announcementsList');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 32px; color: var(--text-muted);">ไม่มีประกาศ</div>';
    return;
  }

  const monthNames = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const fmtDate = d => {
    if (!d) return '';
    const parts = d.split('-');
    const year = parseInt(parts[0]) + 543;
    const month = monthNames[parseInt(parts[1])];
    const day = parts[2];
    return `${day} ${month} ${year}`;
  };

  container.innerHTML = filtered
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(ann => `
      <div style="padding: 1.5rem; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-size: 1.3rem; margin-bottom: 0.5rem;">${ann.icon}</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem;">${ann.title}</div>
            <div style="color: var(--text-muted); margin-bottom: 0.5rem; font-size: 0.85rem;">
              📅 ${fmtDate(ann.date)} ${ann.time ? '⏰ ' + ann.time : ''}
            </div>
            <div style="color: var(--text); line-height: 1.6; white-space: pre-wrap;">${ann.content}</div>
          </div>
          <button onclick="deleteAnnouncement('${ann.id}')" style="padding: 6px 12px; background: #ffebee; color: var(--red); border: 1px solid var(--red); border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 0.85rem;">🗑️ ลบ</button>
        </div>
      </div>
    `)
    .join('');
}

// ===== CONTRACT MANAGEMENT =====
let contractBuilding='old';

function setContractBuilding(bld,btn){
  document.querySelectorAll('#page-contract .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  contractBuilding=bld;
  renderContractPage();
}

function initContractPage(){renderContractPage();}

function getContractStatus(t,now){
  if(!t?.name)return'vacant';
  if(!t.contractEnd)return'active';
  const exp=new Date(t.contractEnd);
  const diff=exp-now;
  if(diff<0)return'expired';
  if(diff<60*86400000)return'expiring';
  return'active';
}

function renderContractPage(){
  const rooms=getBuildingInfo(contractBuilding).metadataArray;
  const tenants=loadTenants();
  const now=new Date();
  const monthNames=window.CONFIG.months.short.slice(1);
  const fmtDate=d=>{if(!d)return'—';const p=new Date(d);return`${p.getDate()} ${monthNames[p.getMonth()]} ${p.getFullYear()+543}`;};

  // KPIs
  let nActive=0,nExpiring=0,nExpired=0,nVacant=0;
  rooms.forEach(r=>{
    const s=getContractStatus(tenants[r.id],now);
    if(s==='active')nActive++;else if(s==='expiring')nExpiring++;else if(s==='expired')nExpired++;else nVacant++;
  });
  document.getElementById('ct-kpi-active').textContent=nActive;
  document.getElementById('ct-kpi-expiring').textContent=nExpiring;
  document.getElementById('ct-kpi-expired').textContent=nExpired;
  document.getElementById('ct-kpi-vacant').textContent=nVacant;

  // Filter
  const fs=document.getElementById('ct-filter-status')?.value||'all';
  const search=(document.getElementById('ct-filter-search')?.value||'').toLowerCase();
  const filtered=rooms.filter(r=>{
    const t=tenants[r.id];
    const s=getContractStatus(t,now);
    if(fs!=='all'&&s!==fs)return false;
    if(search&&!r.id.toLowerCase().includes(search)&&!(t?.name||'').toLowerCase().includes(search))return false;
    return true;
  });

  const grid=document.getElementById('ctGrid');
  if(!grid)return;
  if(!filtered.length){grid.innerHTML='<div style="color:var(--text-muted);padding:24px;font-size:.9rem;">ไม่พบรายการ</div>';return;}

  grid.innerHTML=filtered.map(r=>{
    const t=tenants[r.id];
    const s=getContractStatus(t,now);
    const cardClass={active:'',expiring:'expiring',expired:'expired',vacant:'vacant'}[s];
    const badgeClass={active:'ct-active',expiring:'ct-expiring',expired:'ct-expired',vacant:'ct-vacant-badge'}[s];
    const badgeText={active:'✅ ใช้งานอยู่',expiring:'⚠️ ใกล้หมดอายุ',expired:'❌ หมดอายุแล้ว',vacant:'🚪 ห้องว่าง'}[s];
    const daysLeft=t?.contractEnd?Math.ceil((new Date(t.contractEnd)-now)/86400000):null;
    return`<div class="ct-card ${cardClass}">
      <div class="ct-card-room">ห้อง ${r.id}${r.label?' · '+r.label:''}</div>
      <div class="ct-card-name">${t?.name||'<span style="color:var(--text-muted);font-weight:400;">ห้องว่าง</span>'}</div>
      <span class="ct-badge ${badgeClass}">${badgeText}${daysLeft!==null&&daysLeft>=0?' (เหลือ '+daysLeft+' วัน)':''}</span>
      ${t?.phone?`<div class="ct-card-info">📞 ${t.phone}${t.lineId?' · LINE: '+t.lineId:''}</div>`:''}
      ${(t?.moveInDate||t?.moveIn)?`<div class="ct-card-info">📅 เข้าอยู่: ${fmtDate(t.moveInDate||t.moveIn)}</div>`:''}
      ${t?.contractEnd?`<div class="ct-card-info">⏰ หมดสัญญา: <strong>${fmtDate(t.contractEnd)}</strong></div>`:''}
      ${t?.deposit?`<div class="ct-card-info">💰 มัดจำ: ฿${Number(t.deposit).toLocaleString()}</div>`:''}
      ${t?.note?`<div class="ct-card-info" style="color:var(--text-muted);font-style:italic;">📝 ${t.note}</div>`:''}
      <div class="ct-actions">
        ${t?.name?`<button class="ct-btn ct-btn-view" onclick="showTenantModal('${r.id}')">✏️ แก้ไข</button>
        <button class="ct-btn ct-btn-print" onclick="printContract('${r.id}')">🖨️ พิมพ์สัญญา</button>
        ${s==='expiring'||s==='expired'?`<button class="ct-btn ct-btn-renew" onclick="renewContract('${r.id}')">🔄 ต่อสัญญา</button>`:''}
        `:`<button class="ct-btn ct-btn-view" onclick="showTenantModal('${r.id}')">➕ เพิ่มผู้เช่า</button>`}
      </div>
    </div>`;
  }).join('');
}

function renewContract(roomId){
  const t=loadTenants();
  const tenant=t[roomId];
  if(!tenant)return;
  // Pre-fill modal with existing data, user can update contractEnd
  showTenantModal(roomId);
  setTimeout(()=>{
    const msg=document.getElementById('payModalBody');
    if(msg){
      const note=document.createElement('div');
      note.style.cssText='background:#e3f2fd;border-radius:8px;padding:10px 12px;font-size:.82rem;color:#1565c0;margin-bottom:12px;';
      note.textContent='🔄 ต่อสัญญา — กรุณาอัปเดตวันหมดสัญญาใหม่';
      msg.insertBefore(note,msg.firstChild);
    }
  },100);
}

function printContract(roomId){
  const t=loadTenants()[roomId];
  if(!t?.name){showToast('ไม่พบข้อมูลผู้เช่า', 'warning');return;}
  const bldgInfo=getBuildingInfo(contractBuilding);
  const room=bldgInfo.metadataArray.find(r=>r.id===roomId)||{id:roomId};
  const building=bldgInfo.displayName;
  const monthNames=window.CONFIG.months.short.slice(1);
  const fmtDate=d=>{if(!d)return'—';const p=new Date(d);return`${p.getDate()} ${monthNames[p.getMonth()]} ${p.getFullYear()+543}`;};
  const w=window.open('','_blank','width=720,height=900,scrollbars=yes');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>สัญญาเช่า ห้อง ${roomId}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Sarabun',sans-serif;font-size:14px;padding:40px;color:#222;line-height:1.7;}
  h2{text-align:center;font-size:18px;margin-bottom:4px;}
  .sub{text-align:center;color:#666;font-size:13px;margin-bottom:30px;}
  .section{margin-bottom:18px;} .section-title{font-weight:700;font-size:14px;border-bottom:1.5px solid #222;padding-bottom:4px;margin-bottom:10px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td{padding:6px 10px;border:1px solid #ddd;} td:first-child{font-weight:600;background:#f8f8f8;width:40%;}
  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px;}
  .sig-box{border-top:1.5px solid #222;padding-top:6px;text-align:center;font-size:13px;}
  @media print{body{padding:20px;}}
  </style></head><body>
  <h2>สัญญาเช่าห้องพัก</h2>
  <div class="sub">${building}</div>
  <div class="section"><div class="section-title">ข้อมูลห้องและผู้เช่า</div>
  <table>
    <tr><td>ห้องเลขที่</td><td>${room.id}${room.label?' ('+room.label+')':''}</td></tr>
    <tr><td>ชื่อ-นามสกุลผู้เช่า</td><td>${t.name}</td></tr>
    <tr><td>เบอร์โทรศัพท์</td><td>${t.phone||'—'}</td></tr>
    <tr><td>Line ID</td><td>${t.lineId||'—'}</td></tr>
    <tr><td>วันที่เข้าอยู่</td><td>${fmtDate(t.moveInDate||t.moveIn)}</td></tr>
    <tr><td>วันหมดสัญญา</td><td>${fmtDate(t.contractEnd)}</td></tr>
    <tr><td>เงินมัดจำ</td><td>฿${Number(t.deposit||0).toLocaleString()} บาท</td></tr>
  </table></div>
  <div class="section"><div class="section-title">เงื่อนไขการเช่า</div>
  <ol style="margin:0;padding-left:20px;font-size:13px;">
    <li>ผู้เช่าตกลงชำระค่าเช่าและค่าสาธารณูปโภคภายในวันที่ 5 ของทุกเดือน</li>
    <li>ห้ามดัดแปลงหรือต่อเติมห้องโดยไม่ได้รับอนุญาต</li>
    <li>ผู้เช่าต้องรักษาความสะอาดและดูแลทรัพย์สินของผู้ให้เช่า</li>
    <li>ห้ามนำสัตว์เลี้ยงเข้าพักในห้อง (เว้นแต่ได้รับอนุญาตเป็นลายลักษณ์อักษร)</li>
    <li>หากผิดสัญญา ผู้ให้เช่ามีสิทธิ์บอกเลิกสัญญาโดยแจ้งล่วงหน้า 30 วัน</li>
    ${t.note?`<li>หมายเหตุพิเศษ: ${t.note}</li>`:''}
  </ol></div>
  ${t.note?`<div class="section"><div class="section-title">บันทึกเพิ่มเติม</div><p style="font-size:13px;">${t.note}</p></div>`:''}
  <div class="sig-row">
    <div class="sig-box">ลายมือชื่อผู้เช่า<br>${t.name}<br><small>วันที่ ........../........../..........ิ</small></div>
    <div class="sig-box">ลายมือชื่อผู้ให้เช่า<br>${building}<br><small>วันที่ ........../........../..........ิ</small></div>
  </div>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  w.document.close();
}

// ===== OCCUPANCY ANALYTICS =====
let analyticsBuilding='old';
let chartOccMonthly=null, chartRevRoom=null;

function setAnalyticsBuilding(bld,btn){
  document.querySelectorAll('#page-analytics .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  analyticsBuilding=bld;
  renderAnalyticsPage();
}

function initAnalyticsPage(){
  renderAnalyticsPage();
}

function renderAnalyticsPage(){
  const rooms=analyticsBuilding==='old'?window.ROOMS_OLD:window.ROOMS_NEW;
  const tenants=loadTenants();
  const ps=loadPS();
  const now=new Date();
  const thYear=now.getFullYear()+543; // e.g. 2569

  // ---- KPIs ----
  const occupiedRooms=rooms.filter(r=>tenants[r.id]?.name);
  const vacantCount=rooms.length-occupiedRooms.length;
  document.getElementById('ana-occupancy-rate').textContent=
    rooms.length?Math.round(occupiedRooms.length/rooms.length*100)+'%':'0%';
  document.getElementById('ana-vacant-count').textContent=vacantCount;

  // Avg monthly revenue this year (sum of all paid months / count of months with data)
  let totalRevYear=0, monthsWithData=0;
  for(let m=1;m<=12;m++){
    const key=`${thYear}_${m}`;
    const monthData=ps[key]||{};
    const rev=Object.values(monthData).reduce((s,p)=>s+(p.amount||p.total||0),0);
    if(rev>0){totalRevYear+=rev;monthsWithData++;}
  }
  const avgRev=monthsWithData?Math.round(totalRevYear/monthsWithData):0;
  document.getElementById('ana-avg-revenue').textContent=avgRev?'฿'+avgRev.toLocaleString():'—';

  // Expiring contracts within 60 days
  const in60=now.getTime()+60*86400000;
  const expiringRooms=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const exp=new Date(t.contractEnd).getTime();
    return exp>now.getTime()&&exp<=in60;
  });
  document.getElementById('ana-expiring').textContent=expiringRooms.length;

  // ---- Monthly occupancy chart ----
  const monthLabels = window.CONFIG.months.short.slice(1);
  const roomIds=rooms.map(r=>r.id);
  const paidCountByMonth=Array.from({length:12},(_,i)=>{
    const key=`${thYear}_${i+1}`;
    const monthData=ps[key]||{};
    return roomIds.filter(id=>monthData[id]).length;
  });
  const revenueByMonth=Array.from({length:12},(_,i)=>{
    const key=`${thYear}_${i+1}`;
    const monthData=ps[key]||{};
    return roomIds.reduce((s,id)=>{const p=monthData[id];return s+(p?(p.amount||p.total||0):0);},0);
  });

  const ctx1=document.getElementById('chartOccupancyMonthly');
  if(ctx1){
    if(chartOccMonthly)chartOccMonthly.destroy();
    chartOccMonthly=new Chart(ctx1,{
      type:'bar',
      data:{
        labels:monthLabels,
        datasets:[
          {label:'จำนวนห้องที่ชำระ',data:paidCountByMonth,backgroundColor:'rgba(45,136,45,0.75)',borderRadius:5,yAxisID:'y'},
          {label:'รายรับรวม (บาท)',data:revenueByMonth,type:'line',borderColor:'#e65100',backgroundColor:'transparent',pointBackgroundColor:'#e65100',tension:.4,yAxisID:'y1'}
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index'},
        scales:{
          y:{position:'left',title:{display:true,text:'ห้อง'},max:rooms.length,grid:{color:'#f0f0f0'}},
          y1:{position:'right',title:{display:true,text:'บาท'},grid:{drawOnChartArea:false},ticks:{callback:v=>'฿'+v.toLocaleString()}}
        },
        plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}
      }
    });
  }

  // ---- Room status list ----
  const anaEl=document.getElementById('anaRoomStatus');
  if(anaEl){
    anaEl.innerHTML=`
      <div class="ana-room-row ana-room-head"><div>ห้อง</div><div>ผู้เช่า</div><div>สถานะ</div><div>หมดสัญญา</div></div>
      ${rooms.map(r=>{
        const t=tenants[r.id];
        const occ=!!t?.name;
        const exp=t?.contractEnd?new Date(t.contractEnd):null;
        const expFmt=exp?`${exp.getDate()} ${monthLabels[exp.getMonth()]}`:'—';
        const expWarn=exp&&(exp.getTime()-now.getTime()<60*86400000)&&exp>now?'color:var(--red);font-weight:700;':'';
        return`<div class="ana-room-row">
          <div><strong>${r.id}</strong></div>
          <div style="font-size:.81rem;">${t?.name||'<span style="color:var(--text-muted)">ว่าง</span>'}</div>
          <div>${occ?'<span class="ana-occ-tag">เช่าอยู่</span>':'<span class="ana-vacant-tag">ว่าง</span>'}</div>
          <div style="${expWarn}font-size:.8rem;">${expFmt}</div>
        </div>`;
      }).join('')}`;
  }

  // ---- Revenue per room chart ----
  const revPerRoom=rooms.map(r=>{
    let total=0;
    for(let m=1;m<=12;m++){const key=`${thYear}_${m}`;const p=(ps[key]||{})[r.id];total+=p?(p.amount||p.total||0):0;}
    return total;
  });
  const ctx2=document.getElementById('chartRevenuePerRoom');
  if(ctx2){
    if(chartRevRoom)chartRevRoom.destroy();
    chartRevRoom=new Chart(ctx2,{
      type:'bar',
      data:{
        labels:rooms.map(r=>r.id),
        datasets:[{label:'รายรับรวมปีนี้ (บาท)',data:revPerRoom,
          backgroundColor:revPerRoom.map(v=>v>0?'rgba(45,136,45,0.7)':'rgba(200,200,200,0.5)'),borderRadius:4}]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{y:{ticks:{callback:v=>'฿'+v.toLocaleString()},grid:{color:'#f0f0f0'}},x:{ticks:{font:{size:10}}}}
      }
    });
  }

  // ---- Contract expiry section ----
  const contractCard=document.getElementById('anaContractCard');
  const contractList=document.getElementById('anaContractList');
  const in90=now.getTime()+90*86400000;
  const expiring90=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const exp=new Date(t.contractEnd).getTime();
    return exp>now.getTime()&&exp<=in90;
  }).sort((a,b)=>new Date(tenants[a.id].contractEnd)-new Date(tenants[b.id].contractEnd));
  if(contractCard&&contractList){
    if(expiring90.length){
      contractCard.style.display='block';
      contractList.innerHTML=expiring90.map(r=>{
        const t=tenants[r.id];
        const exp=new Date(t.contractEnd);
        const daysLeft=Math.ceil((exp-now)/86400000);
        return`<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border);font-size:.85rem;">
          <strong style="min-width:60px;">${r.id}</strong>
          <span>${t.name}</span>
          <span style="color:var(--text-muted);">${t.phone||''}</span>
          <span style="margin-left:auto;color:${daysLeft<=30?'var(--red)':'var(--orange)'};font-weight:700;">เหลือ ${daysLeft} วัน</span>
        </div>`;
      }).join('');
    } else {
      contractCard.style.display='none';
    }
  }
}

// ===== TENANT MODAL MANAGEMENT =====
let currentEditRoomId = null;
let currentEditBuilding = null;
let currentEditTenantId = null;

// Real-time sync event system
const TenantDataEvents = {
  listeners: {},

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  },

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      });
    }
  },

  clear() {
    this.listeners = {};
  }
};

// Subscribe to tenant data changes
TenantDataEvents.on('TENANT_UPDATED', (data) => {
  const {building, roomId, tenantId} = data;

  // Refresh room display if visible
  if (typeof refreshRoomTenantDisplay === 'function') {
    try {
      refreshRoomTenantDisplay(building, roomId);
    } catch (e) {
      console.warn('Could not refresh room display:', e.message);
    }
  }

  // Reload modal if currently open with same room
  const tenantModal = document.getElementById('tenantModal');
  if (tenantModal && tenantModal.style.display !== 'none' && currentEditRoomId === roomId) {
    setTimeout(() => {
      openTenantModal(building, roomId);
    }, 500);
  }
});

// Make TenantDataEvents globally available
window.TenantDataEvents = TenantDataEvents;

// Helper function to detect building from room ID (fallback)
function detectBuildingFromRoomId(roomId) {
  return roomId.startsWith('N') ? 'nest' : 'rooms';
}

function openTenantModal(building, roomId) {
  // Support both old signature (single param) and new signature (building, roomId)
  if (typeof building === 'string' && !roomId) {
    // Old signature: openTenantModal(roomId)
    roomId = building;
    building = detectBuildingFromRoomId(roomId);
  }

  currentEditRoomId = roomId;
  currentEditBuilding = building;
  const modal = document.getElementById('tenantModal');

  // Use TenantLookup to get room occupancy info
  const occupancyInfo = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant = occupancyInfo.tenant || {};
  const lease = occupancyInfo.lease || {};
  const room = occupancyInfo.room || {};

  // Set tenant ID for this edit session
  currentEditTenantId = lease.tenantId || null;

  // Get correct rent from RoomConfigManager
  let rentPrice = room.rentPrice || 0;
  if (!rentPrice && typeof RoomConfigManager !== 'undefined') {
    const rmConfigRoom = RoomConfigManager.getRoom(building, roomId);
    if (rmConfigRoom && rmConfigRoom.rentPrice) {
      rentPrice = rmConfigRoom.rentPrice;
    }
  }

  // Update room info
  document.getElementById('modalRoomNumber').textContent = `ห้อง ${roomId}`;
  const roomType = room.type === 'commercial' ? '🏪 พาณิชย์' : (room.type === 'pet' ? '🐾 Pet Friendly' : '🏠 ห้องพัก');
  document.getElementById('modalRoomType').textContent = roomType || '🏠 ห้องพัก';
  document.getElementById('modalRoomRent').textContent = `฿${rentPrice.toLocaleString('th-TH')}`;

  // Store rent in modal for editing
  if (document.getElementById('modalRentPrice')) {
    document.getElementById('modalRentPrice').value = rentPrice || '';
  }

  // Determine occupancy status
  const isOccupied = tenant && tenant.name;
  const statusBadge = document.getElementById('modalRoomStatus');
  const occupancyBadge = document.getElementById('modalOccupancyBadge');

  if (isOccupied) {
    statusBadge.textContent = '🟢 มีผู้เช่า';
    statusBadge.style.background = 'var(--green-pale)';
    statusBadge.style.color = 'var(--green-dark)';
    occupancyBadge.textContent = 'มีผู้เช่า';
    occupancyBadge.style.background = 'var(--green-pale)';
    occupancyBadge.style.color = 'var(--green-dark)';
  } else {
    statusBadge.textContent = '🔴 ว่าง';
    statusBadge.style.background = '#ffebee';
    statusBadge.style.color = '#c62828';
    occupancyBadge.textContent = 'ว่าง';
    occupancyBadge.style.background = '#e3f2fd';
    occupancyBadge.style.color = '#1565c0';
  }

  // Fill form with tenant data
  // Handle both separate fields and combined name for backward compatibility
  if (tenant.firstName || tenant.lastName) {
    document.getElementById('modalTenantFirstName').value = tenant.firstName || '';
    document.getElementById('modalTenantLastName').value = tenant.lastName || '';
  } else if (tenant.name) {
    // Split combined name into first and last (simple split by space)
    const nameParts = (tenant.name || '').trim().split(' ');
    document.getElementById('modalTenantFirstName').value = nameParts[0] || '';
    document.getElementById('modalTenantLastName').value = nameParts.slice(1).join(' ') || '';
  } else {
    document.getElementById('modalTenantFirstName').value = '';
    document.getElementById('modalTenantLastName').value = '';
  }
  document.getElementById('modalTenantPhone').value = tenant.phone || '';
  document.getElementById('modalTenantLineID').value = tenant.lineID || '';
  document.getElementById('modalTenantEmail').value = tenant.email || '';
  document.getElementById('modalTenantVehiclePlate').value = tenant.vehiclePlate || '';
  document.getElementById('modalTenantMoveIn').value = tenant.moveInDate || '';
  document.getElementById('modalTenantContractEnd').value = tenant.contractEnd || '';
  document.getElementById('modalTenantDeposit').value = tenant.deposit || '';
  // Meter fields removed - no longer used
  document.getElementById('modalTenantNotes').value = tenant.notes || '';


  // Load contract document - check both tenant and lease sources
  let contractData = null;
  let contractFileName = '';

  // Check tenant data first
  if (tenant && tenant.contractDocument) {
    contractData = tenant.contractDocument;
    contractFileName = tenant.contractFileName || 'สัญญาเช่า';
  }
  // Also check lease for contracts
  else if (lease && lease.contractDocument) {
    contractData = lease.contractDocument;
    contractFileName = lease.contractFileName || 'สัญญาเช่า';
  }

  if (contractData) {
    document.getElementById('modalContractDocument').value = contractData;
    document.getElementById('modalContractFileName').value = contractFileName;
    document.getElementById('contractDocStatus').innerHTML = `✅ <strong>${contractFileName}</strong> <button type="button" onclick="previewContractDocument('${building}', '${roomId}')" style="margin-left:8px;padding:6px 12px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.8rem;font-family:'Sarabun',sans-serif;">👁️ ดูตัวอย่าง</button> <button type="button" onclick="deleteContractDocument('${building}', '${roomId}')" style="margin-left:4px;padding:6px 12px;background:#d32f2f;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.8rem;font-family:'Sarabun',sans-serif;">🗑️ ลบ</button>`;
  } else {
    document.getElementById('modalContractDocument').value = '';
    document.getElementById('modalContractFileName').value = '';
    document.getElementById('contractDocStatus').textContent = '';
  }

  // IMPORTANT: Clear file input to prevent showing previous room's file
  const fileInput = document.getElementById('modalContractFile');
  if (fileInput) {
    fileInput.value = '';
  }

  // Show modal
  modal.style.display = 'flex';

  // Initialize phone validation for the modal
  setTimeout(function() {
    initPhoneValidation();
  }, 100);
}

function closeTenantModal() {
  document.getElementById('tenantModal').style.display = 'none';
  currentEditRoomId = null;
  // Hide lease history if open
  const hist = document.getElementById('tenantLeaseHistorySection');
  if (hist) hist.style.display = 'none';
}

// ─── Lease History (ประวัติผู้เช่าเก่า) ───
function showTenantLeaseHistory(building, roomId) {
  if (!building || !roomId) return;
  const section = document.getElementById('tenantLeaseHistorySection');
  const content = document.getElementById('tenantLeaseHistoryContent');
  if (!section || !content) return;

  // Toggle: hide if already visible for same room
  if (section.style.display !== 'none') { section.style.display = 'none'; return; }

  const leases = (typeof LeaseAgreementManager !== 'undefined')
    ? LeaseAgreementManager.getLeaseHistory(building, roomId)
    : [];

  if (!leases.length) {
    content.innerHTML = '<p style="color:var(--text-muted);">ยังไม่มีประวัติผู้เช่า</p>';
  } else {
    content.innerHTML = leases.map(l => {
      const moveIn  = l.moveInDate    ? new Date(l.moveInDate).toLocaleDateString('th-TH')    : '—';
      const moveOut = l.moveOutDate   ? new Date(l.moveOutDate).toLocaleDateString('th-TH')   : (l.status==='active'?'ปัจจุบัน':'—');
      const badge   = l.status==='active'
        ? '<span style="background:#e8f5e9;color:#388e3c;padding:2px 8px;border-radius:10px;font-size:.7rem;">กำลังเช่า</span>'
        : '<span style="background:#f3e5f5;color:#7b1fa2;padding:2px 8px;border-radius:10px;font-size:.7rem;">สิ้นสุดแล้ว</span>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
        <div><strong>${l.tenantName||'—'}</strong> ${badge}</div>
        <div style="font-size:.78rem;color:var(--text-muted);">${moveIn} → ${moveOut}</div>
      </div>`;
    }).join('');
  }
  section.style.display = 'block';
}

// ─── Billing Modal (ชำระค่าเช่า) ───
function showBillingModal(roomId) {
  const building = tenantBuilding === 'old' ? 'rooms' : 'nest';
  const rooms = _getTenantRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;

  const tenants = loadTenants();
  const tenant = tenants[roomId];
  const tenantName = tenant?.name || '(ว่าง)';

  // Get current month/year (Thai year)
  const now = new Date();
  const thMonth = now.getMonth() + 1;
  const thYear = now.getFullYear() + 543;

  // Check if bill exists for this month
  let existingBill = null;
  if (typeof BillingSystem !== 'undefined') {
    existingBill = BillingSystem.getBillByMonthYear(roomId, thMonth, thYear);
  }

  const totalStr = existingBill
    ? `฿${Number(existingBill.totalCharge).toLocaleString()} (บิลเดือนนี้)`
    : `฿${Number(room.rentPrice||0).toLocaleString()} (ค่าเช่าเท่านั้น)`;

  const statusBadge = existingBill
    ? (existingBill.status === 'paid'
        ? '<span style="color:#388e3c;font-weight:700;">✅ ชำระแล้ว</span>'
        : '<span style="color:#f57c00;font-weight:700;">⏳ ค้างชำระ</span>')
    : '';

  const modal = document.createElement('div');
  modal.id = 'billingPayModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;padding:1rem;';
  const MONTHS_TH_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#388e3c,#1b5e20);color:#fff;padding:1.2rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;font-size:1.05rem;">💰 บันทึกการชำระ</div>
          <div style="font-size:.8rem;opacity:.85;">${roomId} · ${tenantName}</div>
        </div>
        <button onclick="document.getElementById('billingPayModal').remove()" style="background:rgba(255,255,255,.2);border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;color:#fff;font-size:1.1rem;">✕</button>
      </div>
      <div style="padding:1.5rem;">
        <div style="background:#f9fafb;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:.9rem;line-height:2;">
          <div>📅 เดือน: <strong>${MONTHS_TH_SHORT[thMonth]} ${thYear}</strong></div>
          <div>💰 ยอดที่ต้องชำระ: <strong style="color:var(--green-dark);font-size:1.05rem;">${totalStr}</strong></div>
          ${existingBill ? `<div>สถานะ: ${statusBadge}</div>` : ''}
          ${existingBill?.charges ? `
          <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;font-size:.8rem;color:var(--text-muted);">
            ค่าเช่า ฿${Number(existingBill.charges.rent||0).toLocaleString()} +
            ไฟ ฿${Number(existingBill.charges.electric?.cost||0).toLocaleString()} +
            น้ำ ฿${Number(existingBill.charges.water?.cost||0).toLocaleString()} +
            ขยะ ฿${Number(existingBill.charges.trash||0).toLocaleString()}
          </div>` : ''}
        </div>
        ${existingBill && existingBill.status !== 'paid' ? `
        <div style="margin-bottom:1rem;">
          <label style="font-size:.85rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px;">หมายเหตุการชำระ</label>
          <input type="text" id="billingPayNote" placeholder="เช่น โอนผ่าน PromptPay" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:6px;font-family:'Sarabun',sans-serif;font-size:.9rem;">
        </div>
        <button onclick="markBillPaid('${roomId}',${existingBill.month},${existingBill.year},'${existingBill.billId}')" style="width:100%;padding:12px;background:linear-gradient(135deg,#388e3c,#1b5e20);color:#fff;border:none;border-radius:8px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;font-size:.95rem;">✅ บันทึกว่าชำระแล้ว</button>
        ` : existingBill?.status === 'paid' ? `
        <div style="text-align:center;padding:1rem;color:#388e3c;font-weight:700;">✅ ชำระเรียบร้อยแล้ว</div>
        ` : `
        <div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.85rem;">ยังไม่มีบิลสำหรับเดือนนี้<br>กรุณาสร้างบิลจากหน้า "บิล" ก่อน</div>
        `}
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function markBillPaid(roomId, month, year, billId) {
  if (typeof BillingSystem === 'undefined') { showToast('ไม่พบระบบบิล', 'error'); return; }
  const note = document.getElementById('billingPayNote')?.value || '';
  BillingSystem.updateBillStatus(billId, 'paid', year);
  showToast(`✅ บันทึกการชำระห้อง ${roomId} เดือน ${month}/${year} แล้ว`, 'success');
  document.getElementById('billingPayModal')?.remove();
}

// ─── Billing History Modal (ประวัติบิล 6 เดือน) ───
function showBillingHistoryModal(roomId) {
  const rooms = _getTenantRooms();
  const room = rooms.find(r => r.id === roomId);
  const tenants = loadTenants();
  const tenantName = tenants[roomId]?.name || '(ว่าง)';

  // Collect last 6 months of bills
  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ m: d.getMonth() + 1, y: d.getFullYear() + 543 });
  }

  let bills = [];
  if (typeof BillingSystem !== 'undefined') {
    bills = BillingSystem.getBillsByRoom(roomId);
  }

  const MONTHS_TH_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const rows = months.map(({m, y}) => {
    const bill = bills.find(b => b.month === m && b.year === y);
    if (!bill) return `<tr><td><strong>${MONTHS_TH_SHORT[m]} ${y}</strong></td><td colspan="4" style="color:var(--text-muted);text-align:center;">ไม่มีบิล</td></tr>`;
    const statusColor = bill.status === 'paid' ? '#388e3c' : '#f57c00';
    const statusLabel = bill.status === 'paid' ? '✅ ชำระแล้ว' : '⏳ ค้างชำระ';
    return `<tr>
      <td><strong>${MONTHS_TH_SHORT[m]} ${y}</strong></td>
      <td style="text-align:right;">฿${Number(bill.charges?.rent||0).toLocaleString()}</td>
      <td style="text-align:right;">฿${Number((bill.charges?.electric?.cost||0)+(bill.charges?.water?.cost||0)).toLocaleString()}</td>
      <td style="text-align:right;font-weight:700;color:var(--green-dark);">฿${Number(bill.totalCharge||0).toLocaleString()}</td>
      <td style="color:${statusColor};font-weight:700;">${statusLabel}</td>
    </tr>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'billingHistoryModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;padding:1rem;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#f57c00,#e65100);color:#fff;padding:1.2rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;font-size:1.05rem;">🧾 ประวัติบิล — ห้อง ${roomId}</div>
          <div style="font-size:.8rem;opacity:.85;">${tenantName} · 6 เดือนย้อนหลัง</div>
        </div>
        <button onclick="document.getElementById('billingHistoryModal').remove()" style="background:rgba(255,255,255,.2);border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;color:#fff;font-size:1.1rem;">✕</button>
      </div>
      <div style="padding:1rem;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
          <thead><tr style="background:var(--green-pale);text-align:left;">
            <th style="padding:8px;">เดือน</th>
            <th style="padding:8px;text-align:right;">ค่าเช่า</th>
            <th style="padding:8px;text-align:right;">ค่าน้ำ/ไฟ</th>
            <th style="padding:8px;text-align:right;">รวม</th>
            <th style="padding:8px;">สถานะ</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:1rem;text-align:right;border-top:1px solid var(--border);">
        <button onclick="document.getElementById('billingHistoryModal').remove()" style="padding:8px 20px;background:var(--border);border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;">ปิด</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function saveTenantInfo() {
  if (!currentEditRoomId || !currentEditBuilding) return;

  const building = currentEditBuilding;
  const roomId = currentEditRoomId;

  // Read form data
  const firstName = document.getElementById('modalTenantFirstName').value.trim();
  const lastName = document.getElementById('modalTenantLastName').value.trim();
  const fullName = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName || '');

  // Validate data
  if (!fullName) {
    showToast('กรุณากรอกชื่อผู้เช่า', 'error');
    return;
  }

  const tenantData = {
    name: fullName,
    firstName: firstName,
    lastName: lastName,
    phone: document.getElementById('modalTenantPhone').value,
    idCardNumber: document.getElementById('modalTenantIdCard')?.value || '',
    email: document.getElementById('modalTenantEmail')?.value || '',
    vehiclePlate: document.getElementById('modalTenantVehiclePlate')?.value || '',
    address: document.getElementById('modalTenantAddress')?.value || '',
    lineID: document.getElementById('modalTenantLineID').value,
    moveInDate: document.getElementById('modalTenantMoveIn').value,
    moveOutDate: document.getElementById('modalTenantContractEnd').value,
    deposit: parseFloat(document.getElementById('modalTenantDeposit').value) || 0,
    // Meter fields removed - no longer used
    // elecMeterStart and waterMeterStart now managed by Firebase only
    notes: document.getElementById('modalTenantNotes').value,
    contractDocument: document.getElementById('modalContractDocument').value || '',
    contractFileName: document.getElementById('modalContractFileName').value || ''
  };

  // Generate or reuse tenant ID
  const tenantId = currentEditTenantId || `TENANT_${Date.now()}_${roomId}`;

  // Save to TenantConfigManager (single source of truth)
  const saved = currentEditTenantId
    ? TenantConfigManager.updateTenant(building, tenantId, tenantData)
    : TenantConfigManager.addTenant(building, tenantId, tenantData);

  if (!saved && !currentEditTenantId) {
    showToast('ไม่สามารถบันทึกข้อมูลได้', 'error');
    return;
  }

  // Update or create lease agreement
  const currentLease = LeaseAgreementManager.getActiveLease(building, roomId);
  let leaseId;

  if (currentLease) {
    // Update existing lease
    const rentPrice = RoomConfigManager.getRentPrice(building, roomId);
    LeaseAgreementManager.updateLease(currentLease.id, {
      tenantName: fullName,
      tenantId: tenantId,
      moveInDate: tenantData.moveInDate,
      moveOutDate: tenantData.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: tenantData.deposit,
      status: 'active',
      contractFileName: tenantData.contractFileName,
      contractDocument: tenantData.contractDocument
    });
    leaseId = currentLease.id;
  } else {
    // Create new lease
    const rentPrice = RoomConfigManager.getRentPrice(building, roomId);
    leaseId = LeaseAgreementManager.createLease({
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      tenantName: fullName,
      moveInDate: tenantData.moveInDate,
      moveOutDate: tenantData.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: tenantData.deposit,
      status: 'active',
      contractFileName: tenantData.contractFileName,
      contractDocument: tenantData.contractDocument
    });
    currentEditTenantId = tenantId; // Update for future edits
  }

  // Handle rent price editing
  const modalRentPrice = document.getElementById('modalRentPrice');
  if (modalRentPrice && modalRentPrice.value) {
    const newRent = parseFloat(modalRentPrice.value);
    const currentRent = RoomConfigManager.getRentPrice(building, roomId);
    if (newRent !== currentRent) {
      RoomConfigManager.updateRentPrice(building, roomId, newRent);
      if (currentLease) {
        LeaseAgreementManager.updateLease(currentLease.id, {rentAmount: newRent});
      }
    }
  }

  // Also save to legacy tenant_data for backward compatibility
  const allTenants = loadTenants();
  allTenants[roomId] = tenantData;
  localStorage.setItem('tenant_data', JSON.stringify(allTenants));

  // Firebase sync (async, non-blocking)
  if (typeof TenantConfigManager.saveTenantToFirebase === 'function') {
    TenantConfigManager.saveTenantToFirebase(building, tenantId, tenantData);
  }
  if (typeof LeaseAgreementManager.createLeaseWithFirebase === 'function' && !currentLease) {
    LeaseAgreementManager.createLeaseWithFirebase(LeaseAgreementManager.getLease(leaseId));
  }

  // Log the action
  if (window.AuditLogger) {
    AuditLogger.log('TENANT_UPDATED', {
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      changes: Object.keys(tenantData).filter(k => tenantData[k])
    });
  }

  // Emit event for real-time sync
  if (window.TenantDataEvents) {
    TenantDataEvents.emit('TENANT_UPDATED', {
      building: building,
      roomId: roomId,
      tenantId: tenantId
    });
  }

  // Close modal
  closeTenantModal();

  // Refresh UI
  updateRoomStatuses();
  updateOccupancyDashboard();

  // Refresh current page
  const currentPage = document.querySelector('.page.active');
  if (currentPage && currentPage.id === 'page-property') {
    // Check which section is visible and refresh accordingly
    const nestSection = document.getElementById('property-nest-section');
    if (nestSection && nestSection.style.display !== 'none') {
      initNestPage();
    } else {
      initRoomsPage();
      renderCompactRoomGrid();
    }
  }

  // Show success message
  showToast('บันทึกข้อมูลสำเร็จ', 'success');
}

/**
 * Upload contract document and auto-save to Lease Agreement
 */
function uploadContractDocument() {
  const fileInput = document.getElementById('modalContractFile');
  const file = fileInput.files[0];
  const statusEl = document.getElementById('contractDocStatus');

  if (!file) {
    statusEl.textContent = '❌ กรุณาเลือกไฟล์';
    return;
  }

  // File size limit 5MB
  if (file.size > 5 * 1024 * 1024) {
    statusEl.textContent = '❌ ไฟล์ใหญ่เกินไป (สูงสุด 5MB)';
    return;
  }

  statusEl.textContent = '⏳ กำลังอัพโหลด...';

  // Read file as base64
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result;
    const fileName = file.name;

    // Store base64 and filename in hidden fields for tenant data
    document.getElementById('modalContractDocument').value = base64Data;
    document.getElementById('modalContractFileName').value = fileName;

    // Update file input display to show filename
    const newFileInput = document.createElement('input');
    newFileInput.type = 'file';
    newFileInput.id = 'modalContractFile';
    newFileInput.accept = '.pdf,.jpg,.jpeg,.png';
    newFileInput.onchange = uploadContractDocument;
    fileInput.parentNode.replaceChild(newFileInput, fileInput);

    // Auto-save to Lease Agreement if LeaseAgreementManager exists
    if (typeof LeaseAgreementManager !== 'undefined' && currentEditRoomId) {
      try {
        const leases = LeaseAgreementManager.getAllLeases();

        // Find active lease for this room
        let leaseId = Object.keys(leases).find(id => leases[id].roomId === currentEditRoomId);

        if (leaseId) {
          // Update existing lease with contract
          LeaseAgreementManager.updateLease(leaseId, {
            contractDocument: base64Data,
            contractFileName: fileName,
            contractUploadedAt: new Date().toISOString()
          });
          console.log(`✅ Contract saved to lease: ${leaseId}`);
        }
      } catch (error) {
        console.warn('Could not auto-save to lease agreement:', error.message);
      }
    }

    // Show success with filename
    statusEl.innerHTML = `✅ อัพโหลด: <strong>${fileName}</strong> (${(file.size / 1024).toFixed(1)}KB)<br><span style="color:#2d8653;font-size:0.85rem;font-weight:600;">✓ บันทึกใน Lease Agreement แล้ว</span>`;
  };

  reader.onerror = function() {
    statusEl.textContent = '❌ ข้อผิดพลาดในการอ่านไฟล์';
  };

  reader.readAsDataURL(file);
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  const modal = document.getElementById('tenantModal');
  if (modal && e.target === modal) {
    closeTenantModal();
  }
});
