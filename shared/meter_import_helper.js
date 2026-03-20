/**
 * Meter Import Helper Library
 * Handles data continuity validation, matching, and import workflow
 */

/**
 * Load previous month's meter data from METER_DATA
 * @param {number} year - Buddhist year (69)
 * @param {number} month - Month number (1-12)
 * @param {string} building - Building name ('rooms', 'nest', etc.) - optional for backward compatibility
 * @returns {object} Previous month's readings or {} if not found
 */
function getPreviousMonthReadings(year, month, building = null) {
  if (!window.METER_DATA) return {};

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const key = `${prevYear}_${prevMonth}`;

  // If building specified, use new building-aware structure
  if (building) {
    if (!window.METER_DATA[building]) return {};
    return METER_DATA[building][key] || {};
  }

  // Fallback to old structure for backward compatibility
  return METER_DATA[key] || {};
}

/**
 * Validate meter data continuity by comparing with previous month
 * @param {object} importedData - Current month import {year, month, rooms, building?}
 * @returns {object} Match results {summary, details, mismatches, canProceed, isFirstImport}
 */
function matchMeterDataWithPrevious(importedData) {
  const { year, month, rooms, building = null } = importedData;
  const previousData = getPreviousMonthReadings(year, month, building);

  // Determine if this is the first import for this specific month
  // (no need to check if other months exist - if previous month is empty, it's first import for this month)
  const buildingKey = building || 'rooms';
  const isFirstImport = Object.keys(previousData).length === 0;

  console.log(`🔍 matchMeterDataWithPrevious: building=${buildingKey}, month=${month}, isFirstImport=${isFirstImport}`, {
    previousDataEmpty: Object.keys(previousData).length === 0,
    meterDataExists: !!window.METER_DATA,
    buildingDataExists: window.METER_DATA && !!window.METER_DATA[buildingKey],
    buildingDataLength: window.METER_DATA && window.METER_DATA[buildingKey] ? Object.keys(window.METER_DATA[buildingKey]).length : 'N/A'
  });

  const results = {
    summary: {
      totalRooms: Object.keys(rooms).length,
      okCount: 0,
      warningCount: 0,
      errorCount: 0,
      missingCount: 0
    },
    details: [],
    mismatches: [],
    canProceed: true,
    isFirstImport: isFirstImport
  };

  // For each room in imported data
  for (const roomId in rooms) {
    const imported = rooms[roomId];
    const previous = previousData[roomId] || {};

    const electricMatch = compareValues(imported.eOld, previous.eNew, 'electric', isFirstImport);
    const waterMatch = compareValues(imported.wOld, previous.wNew, 'water', isFirstImport);

    const overallStatus = determineStatus([electricMatch, waterMatch]);
    results.summary[`${overallStatus}Count`]++;

    // Block if ANY error found (strategy: block all)
    if (overallStatus === 'error') {
      results.canProceed = false;
    }

    results.details.push({
      room: roomId,
      eNew: imported.eNew,
      eOld: imported.eOld,
      wNew: imported.wNew,
      wOld: imported.wOld,
      electric: electricMatch,
      water: waterMatch,
      status: overallStatus
    });

    // Collect mismatches for detailed view (but not for first import 'ok' status)
    if (electricMatch.status !== 'ok') {
      results.mismatches.push({
        room: roomId,
        field: 'electric',
        fieldLabel: 'ไฟ (Electricity)',
        imported: imported.eOld,
        expected: previous.eNew,
        delta: Math.abs((imported.eOld || 0) - (previous.eNew || 0)),
        status: electricMatch.status
      });
    }
    if (waterMatch.status !== 'ok') {
      results.mismatches.push({
        room: roomId,
        field: 'water',
        fieldLabel: 'น้ำ (Water)',
        imported: imported.wOld,
        expected: previous.wNew,
        delta: Math.abs((imported.wOld || 0) - (previous.wNew || 0)),
        status: waterMatch.status
      });
    }
  }

  return results;
}

/**
 * Compare imported value with previous value
 * @param {number} imported - Imported old reading
 * @param {number} previous - Previous new reading
 * @param {string} fieldType - 'electric' or 'water'
 * @param {boolean} isFirstImport - Whether this is the first import for the building
 * @returns {object} {status: 'ok'|'warning'|'error'|'missing', delta, message}
 */
function compareValues(imported, previous, fieldType, isFirstImport = false) {
  // Missing previous month data
  if (previous === undefined || previous === null) {
    const result = {
      status: isFirstImport ? 'ok' : 'missing',
      delta: null,
      message: isFirstImport
        ? '✓ เดือนแรกของการนำเข้า (ไม่มีเดือนที่แล้ว)'
        : 'ไม่พบข้อมูลเดือนที่แล้ว',
      imported: imported,
      previous: previous
    };
    console.log(`📊 compareValues: ${fieldType}, isFirstImport=${isFirstImport} → status=${result.status}`);
    return result;
  }

  // Invalid imported value
  if (imported === undefined || imported === null || imported < 0) {
    return {
      status: 'error',
      delta: null,
      message: 'ค่ามิเตอร์ไม่ถูกต้อง',
      imported: imported,
      previous: previous
    };
  }

  // Check if reading decreased (invalid)
  if (imported < previous) {
    return {
      status: 'error',
      delta: previous - imported,
      message: `เลขมิเตอร์ลดลง (${previous} → ${imported})`,
      imported: imported,
      previous: previous
    };
  }

  const delta = Math.abs(imported - previous);
  const tolerance = fieldType === 'electric' ? 10 : 5;

  if (delta === 0) {
    return {
      status: 'ok',
      delta: 0,
      message: 'ตรงกันอย่างแน่นอน',
      imported: imported,
      previous: previous
    };
  } else if (delta <= tolerance) {
    return {
      status: 'warning',
      delta: delta,
      message: `ต่างกัน ${delta} หน่วย (อาจเป็นเพราะการปรับเทียบมิเตอร์)`,
      imported: imported,
      previous: previous
    };
  } else {
    return {
      status: 'error',
      delta: delta,
      message: `ต่างกัน ${delta} หน่วย (เกินค่าที่ยอมรับได้ ${tolerance})`,
      imported: imported,
      previous: previous
    };
  }
}

/**
 * Determine overall status based on individual field statuses
 * @param {array} fieldStatuses - Array of {status} objects
 * @returns {string} 'error' | 'warning' | 'missing' | 'ok'
 */
function determineStatus(fieldStatuses) {
  if (fieldStatuses.some(f => f.status === 'error')) return 'error';
  if (fieldStatuses.some(f => f.status === 'missing')) return 'missing';
  if (fieldStatuses.some(f => f.status === 'warning')) return 'warning';
  return 'ok';
}

/**
 * Save validated import session to localStorage
 * @param {object} importData - Parsed import data
 * @param {object} matchResults - Matching validation results
 * @returns {object} Saved session
 */
function savePendingImportData(importData, matchResults) {
  const session = {
    sessionId: `imp_${Date.now()}`,
    timestamp: new Date().toISOString(),
    importData: importData,
    matchResults: matchResults,
    userApproval: null
  };
  localStorage.setItem('pendingMeterImport', JSON.stringify(session));
  return session;
}

/**
 * Get pending import session from localStorage
 * @returns {object|null} Session or null if not found
 */
function getPendingImportSession() {
  const session = localStorage.getItem('pendingMeterImport');
  return session ? JSON.parse(session) : null;
}

/**
 * Clear pending import session
 */
function clearPendingImportSession() {
  localStorage.removeItem('pendingMeterImport');
}

/**
 * Approve and send import to backend for storage
 * @param {boolean} acknowledgeWarnings - User acknowledged warnings/mismatches
 * @returns {Promise} Resolves with success response
 */
async function approvePendingImportViaBackend(acknowledgeWarnings = false) {
  const session = getPendingImportSession();
  if (!session) {
    throw new Error('No pending import found');
  }

  const { importData, matchResults } = session;

  // Block if any errors and no acknowledgment
  if (matchResults.summary.errorCount > 0) {
    throw new Error('Cannot import - errors detected in data');
  }

  // Block if warnings exist and not acknowledged
  if (matchResults.summary.warningCount > 0 && !acknowledgeWarnings) {
    throw new Error('Must acknowledge warnings before proceeding');
  }

  try {
    const response = await fetch('/api/admin/meter-data/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        year: importData.year,
        month: importData.month,
        rooms: importData.rooms,
        matchResults: matchResults,
        acknowledged: acknowledgeWarnings
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Backend error');
    }

    const result = await response.json();

    // Log to audit
    if (window.AuditLogger) {
      AuditLogger.log('METER_DATA_IMPORTED', {
        key: `${importData.year}_${importData.month}`,
        roomCount: Object.keys(importData.rooms).length,
        matchStats: matchResults.summary,
        mismatchCount: matchResults.mismatches.length,
        acknowledged: acknowledgeWarnings
      });
    }

    // Clear pending
    clearPendingImportSession();

    return {
      success: true,
      key: `${importData.year}_${importData.month}`,
      message: result.message,
      roomsImported: Object.keys(importData.rooms).length
    };
  } catch (error) {
    console.error('Import failed:', error);
    throw error;
  }
}

/**
 * Fallback: Approve and store to localStorage (if backend not available)
 * @param {boolean} acknowledgeWarnings - User acknowledged warnings
 * @returns {object} Success response
 */
function approvePendingImportViaLocalStorage(acknowledgeWarnings = false) {
  const session = getPendingImportSession();
  if (!session) {
    throw new Error('No pending import found');
  }

  const { importData, matchResults } = session;

  // Block if any errors
  if (matchResults.summary.errorCount > 0) {
    throw new Error('Cannot import - errors detected in data');
  }

  const key = `${importData.year}_${importData.month}`;
  const building = importData.building || 'rooms'; // Default to rooms for backward compatibility

  // Initialize METER_DATA if not exists
  if (!window.METER_DATA) {
    window.METER_DATA = {};
    console.log('📊 Initialized window.METER_DATA');
  }

  // Initialize building namespace if not exists
  if (!METER_DATA[building]) {
    METER_DATA[building] = {};
  }

  // Store in building-specific namespace
  METER_DATA[building][key] = importData.rooms;

  // Persist to localStorage
  try {
    localStorage.setItem('METER_DATA', JSON.stringify(window.METER_DATA));
    console.log(`✅ Saved METER_DATA to localStorage - ${building}/${key}`);
  } catch (e) {
    console.warn('⚠️ Failed to save METER_DATA to localStorage:', e);
  }

  // Log to audit
  if (window.AuditLogger) {
    AuditLogger.log('METER_DATA_IMPORTED', {
      key: key,
      building: building,
      roomCount: Object.keys(importData.rooms).length,
      matchStats: matchResults.summary,
      mismatchCount: matchResults.mismatches.length,
      storageMethod: 'localStorage'
    });
  }

  clearPendingImportSession();

  return {
    success: true,
    key: `${importData.year}_${importData.month}`,
    building: importData.building || 'rooms',
    message: `Successfully imported ${Object.keys(importData.rooms).length} rooms`,
    roomsImported: Object.keys(importData.rooms).length,
    storageMethod: window.METER_DATA ? 'METER_DATA' : 'localStorage'
  };
}

/**
 * Save meter data to Firebase Firestore
 * Stores in meter_data collection: meter_data/{building}_{year}_{month}_{roomId}
 * @param {object} importData - {year, month, building, rooms}
 * @returns {Promise} Resolves when saved to Firebase
 */
async function saveMeterDataToFirebase(importData) {
  if (!window.firebase || !window.firebase.firestore) {
    console.error('❌ Firebase not initialized');
    return null;
  }

  const { year, month, building, rooms } = importData;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const yearMonth = `${year}_${month}`;

  let successCount = 0;
  let failureCount = 0;
  const failedRooms = [];

  console.log(`📤 Saving ${building} ${yearMonth} (${Object.keys(rooms).length} rooms)...`);

  for (const roomId in rooms) {
    try {
      const roomData = rooms[roomId];
      const docId = `${building}_${yearMonth}_${roomId}`;
      const docRef = fs.doc(fs.collection(db, 'meter_data'), docId);

      await fs.setDoc(docRef, {
        building: building,
        yearMonth: yearMonth,
        year: year,
        month: month,
        roomId: roomId,
        eOld: roomData.eOld || 0,
        eNew: roomData.eNew || 0,
        wOld: roomData.wOld || 0,
        wNew: roomData.wNew || 0,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }, { merge: true });

      successCount++;
      console.log(`  ✅ ${building}/${yearMonth}/${roomId}`);
    } catch (error) {
      failureCount++;
      failedRooms.push(roomId);
      console.error(`  ❌ ${building}/${yearMonth}/${roomId}: ${error.message}`);
    }
  }

  if (failureCount === 0) {
    console.log(`✅ Saved ${building} ${yearMonth}: ${successCount}/${successCount} rooms success`);
    return true;
  } else {
    console.warn(`⚠️ Saved ${building} ${yearMonth}: ${successCount} success, ${failureCount} failed (${failedRooms.join(', ')})`);
    return successCount > 0; // Return true if at least some rooms were saved
  }
}

/**
 * Approve import and save to BOTH localStorage AND Firebase
 * @param {object} importData - Parsed import data
 * @param {object} matchResults - Validation results
 * @param {boolean} acknowledgeWarnings - User acknowledged warnings
 * @returns {Promise<object>} Success response with both storage methods
 */
async function approvePendingImportWithFirebase(importData, matchResults, acknowledgeWarnings = false) {
  const { year, month, building = 'rooms', rooms } = importData;

  if (matchResults.summary.errorCount > 0) {
    throw new Error('Cannot import - errors detected in data');
  }

  const localStorageResult = approvePendingImportViaLocalStorage(acknowledgeWarnings);
  const firebaseResult = await saveMeterDataToFirebase(importData);

  return {
    success: true,
    key: `${year}_${month}`,
    building: building,
    message: localStorageResult.message,
    roomsImported: Object.keys(rooms).length,
    storageMethod: `localStorage + ${firebaseResult ? 'Firebase' : 'localStorage only'}`,
    firebaseSync: firebaseResult
  };
}

/**
 * Format month number to Thai month name
 * @param {number} month - Month number (1-12)
 * @returns {string} Thai month name
 */
function getThaiMonthName(month) {
  const months = {
    1: 'มกราคม',
    2: 'กุมภาพันธ์',
    3: 'มีนาคม',
    4: 'เมษายน',
    5: 'พฤษภาคม',
    6: 'มิถุนายน',
    7: 'กรกฎาคม',
    8: 'สิงหาคม',
    9: 'กันยายน',
    10: 'ตุลาคม',
    11: 'พฤศจิกายน',
    12: 'ธันวาคม'
  };
  return months[month] || `เดือน ${month}`;
}

/**
 * Format Buddhist year to display format
 * @param {number} year - Buddhist year (69)
 * @returns {string} Formatted year display
 */
function formatBuddhistYear(year) {
  return `ปี ${year}`;
}

/**
 * Validate that import is sequential (previous month must exist)
 * @param {number} year - Buddhist year to import
 * @param {number} month - Month to import (1-12)
 * @returns {object} {isValid, message, nextMonthRequired}
 */
function validateSequentialImport(year, month) {
  if (!window.METER_DATA) {
    // First time import - January of first year is allowed
    if (month === 1) {
      return {
        isValid: true,
        message: 'เดือนแรกของการนำเข้า - อนุญาติ',
        nextMonthRequired: null
      };
    } else {
      return {
        isValid: false,
        message: `❌ ต้องเริ่มจากเดือนมกราคม (เดือนที่ 1) ก่อน`,
        nextMonthRequired: 1
      };
    }
  }

  // Get the most recent imported month
  const keys = Object.keys(window.METER_DATA).sort();
  if (keys.length === 0) {
    if (month === 1) {
      return {
        isValid: true,
        message: 'เดือนแรกของการนำเข้า - อนุญาติ',
        nextMonthRequired: null
      };
    } else {
      return {
        isValid: false,
        message: `❌ ต้องเริ่มจากเดือนมกราคม (เดือนที่ 1) ก่อน`,
        nextMonthRequired: 1
      };
    }
  }

  const lastKey = keys[keys.length - 1];
  const [lastYear, lastMonth] = lastKey.split('_').map(Number);

  // Determine next expected month
  let expectedYear = lastYear;
  let expectedMonth = lastMonth + 1;
  if (expectedMonth > 12) {
    expectedMonth = 1;
    expectedYear += 1;
  }

  // Check if import is the next sequential month
  if (year === expectedYear && month === expectedMonth) {
    return {
      isValid: true,
      message: `✓ เดือนถัดไป - อนุญาติ`,
      nextMonthRequired: null
    };
  }

  // If trying to import same month/year as last
  if (year === lastYear && month === lastMonth) {
    return {
      isValid: false,
      message: `❌ เดือน ${month} ปี ${year} นำเข้าแล้ว`,
      nextMonthRequired: expectedMonth
    };
  }

  // If trying to skip months
  const monthThaiNames = {
    1: 'มกราคม', 2: 'กุมภาพันธ์', 3: 'มีนาคม', 4: 'เมษายน', 5: 'พฤษภาคม', 6: 'มิถุนายน',
    7: 'กรกฎาคม', 8: 'สิงหาคม', 9: 'กันยายน', 10: 'ตุลาคม', 11: 'พฤศจิกายน', 12: 'ธันวาคม'
  };

  return {
    isValid: false,
    message: `❌ ต้องอัพโหลดเดือน ${monthThaiNames[expectedMonth]} ปี ${expectedYear} ก่อน (ไม่สามารถข้ามเดือน)`,
    nextMonthRequired: expectedMonth
  };
}
