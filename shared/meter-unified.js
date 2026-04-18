/**
 * METER SYSTEM - UNIFIED MODULE
 * Consolidates all meter data management, Firebase operations, validation, and import
 *
 * Contains:
 * - FirebaseMeterHelper: Firebase operations + caching
 * - MeterDataManager: Data management from localStorage/Firebase
 * - Core validation & calculation functions
 * - Import helper functions
 */

// ===== PART 1: FIREBASE METER HELPER =====

class FirebaseMeterHelper {
  /**
   * Get meter readings for a specific building and month
   * @param {string} building - 'rooms' or 'nest'
   * @param {string} yearMonth - Format: '67_1' (year_month) or '67_10'
   * @returns {Promise<Object>} - {roomId: {eNew, eOld, wNew, wOld}, ...}
   */
  static async getMeterDataForMonth(building, yearMonth) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not loaded, returning null');
        return null;
      }

      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;

      // Query meter_data collection for this building and yearMonth
      const q = fs.query(
        fs.collection(db, 'meter_data'),
        fs.where('building', '==', building),
        fs.where('yearMonth', '==', yearMonth)
      );

      const querySnap = await fs.getDocs(q);

      if (querySnap.size > 0) {
        // Reconstruct: {roomId: {eNew, eOld, wNew, wOld}, ...}
        const monthData = {};
        querySnap.forEach(doc => {
          const data = doc.data();
          monthData[data.roomId] = {
            eNew: data.eNew,
            eOld: data.eOld,
            wNew: data.wNew,
            wOld: data.wOld
          };
        });
        return monthData;
      }

      return null;
    } catch (error) {
      console.warn(`⚠️ Firebase meter fetch failed for ${building}/${yearMonth}:`, error);
      return null;
    }
  }

  /**
   * Get meter reading for a specific room
   * @param {string} building
   * @param {string} yearMonth
   * @param {string} roomId
   * @returns {Promise<Object>} - {eNew, eOld, wNew, wOld} or null
   */
  static async getMeterReading(building, yearMonth, roomId) {
    try {
      const monthData = await this.getMeterDataForMonth(building, yearMonth);
      return monthData ? monthData[roomId] || null : null;
    } catch (error) {
      console.warn(`⚠️ Failed to get meter reading for ${building}/${yearMonth}/${roomId}`, error);
      return null;
    }
  }

  /**
   * Save meter reading to Firebase
   */
  static async saveMeterReading(building, yearMonth, roomId, data) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not available for saving');
        return false;
      }

      const db = window.firebase.firestore();
      const monthCollection = window.firebase.firestoreFunctions.collection(
        window.firebase.firestoreFunctions.collection(db, `meter_data/${building}`),
        yearMonth
      );

      const docRef = window.firebase.firestoreFunctions.doc(monthCollection, 'data');

      // Merge new room data with existing
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        [roomId]: {
          eNew: data.eNew,
          eOld: data.eOld,
          wNew: data.wNew,
          wOld: data.wOld,
          updatedAt: new Date().toISOString()
        }
      }, { merge: true });

      console.log(`✅ Meter reading saved for ${building}/${yearMonth}/${roomId}`);
      return true;
    } catch (error) {
      console.warn(`⚠️ Failed to save meter reading:`, error);
      return false;
    }
  }

  /**
   * Cache meter data to localStorage for offline access
   */
  static cacheMeterData(building, yearMonth, data) {
    try {
      const cacheKey = `meter_cache_${building}_${yearMonth}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('⚠️ Failed to cache meter data:', error);
    }
  }

  /**
   * Get cached meter data
   */
  static getCachedMeterData(building, yearMonth) {
    try {
      const cacheKey = `meter_cache_${building}_${yearMonth}`;
      const cached = localStorage.getItem(cacheKey);

      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      const cacheAge = Date.now() - timestamp;
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Cache expires after 1 day
      if (cacheAge > oneDayMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('⚠️ Failed to get cached meter data:', error);
      return null;
    }
  }

  /**
   * Get meter data with cache fallback: Firebase → Cache → null
   */
  static async getMeterDataWithFallback(building, yearMonth) {
    let data = await this.getMeterDataForMonth(building, yearMonth);

    if (data) {
      this.cacheMeterData(building, yearMonth, data);
      return data;
    }

    data = this.getCachedMeterData(building, yearMonth);
    if (data) {
      console.log(`⏳ Using cached meter data for ${building}/${yearMonth}`);
      return data;
    }

    console.warn(`❌ No meter data available for ${building}/${yearMonth}`);
    return null;
  }
}

// ===== PART 2: METER DATA MANAGER =====

class MeterDataManager {
  static isLoadingFromFirebase = false;
  static firebaseLoadComplete = false;

  /**
   * Load meter data from Firebase Firestore for tenant app
   */
  static async loadFromFirebase(building, years = [2567, 2568, 2569]) {
    if (this.isLoadingFromFirebase) {
      console.log('⏳ Firebase meter data load already in progress...');
      return false;
    }

    try {
      if (!window.firebase?.firestore) {
        console.warn('⚠️ Firebase Firestore not initialized');
        return false;
      }

      this.isLoadingFromFirebase = true;
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;

      console.log(`🔄 Loading meter data from Firebase for building='${building}'...`);

      let totalLoaded = 0;

      // Load meter data for each year
      for (const year of years) {
        try {
          const q = fs.query(
            fs.collection(db, 'meter_data'),
            fs.where('building', '==', building),
            fs.where('year', '==', year)
          );

          const querySnap = await fs.getDocs(q);

          if (querySnap.size > 0) {
            const yearData = {};

            querySnap.forEach(doc => {
              const data = doc.data();
              const monthKey = `${year}-${String(data.month).padStart(2, '0')}`;
              const roomId = data.roomId;

              if (!yearData[monthKey]) {
                yearData[monthKey] = {};
              }

              yearData[monthKey][roomId] = {
                currentWater: data.wNew || 0,
                currentElectric: data.eNew || 0,
                waterStart: data.wOld || 0,
                electricStart: data.eOld || 0,
                eOld: data.eOld || 0,
                eNew: data.eNew || 0,
                wOld: data.wOld || 0,
                wNew: data.wNew || 0,
                recordedDate: data.updatedAt || data.createdAt || new Date().toISOString()
              };
            });

            if (Object.keys(yearData).length > 0) {
              const dataKey = `meter_data_${year}`;
              const existingData = JSON.parse(localStorage.getItem(dataKey) || '{}');

              Object.keys(yearData).forEach((monthKey) => {
                if (!existingData[monthKey]) {
                  existingData[monthKey] = {};
                }

                Object.keys(yearData[monthKey]).forEach((roomId) => {
                  if (!existingData[monthKey][roomId]) {
                    existingData[monthKey][roomId] = yearData[monthKey][roomId];
                  }
                });
              });

              localStorage.setItem(dataKey, JSON.stringify(existingData));
              const monthCount = Object.keys(yearData).length;
              const readingCount = Object.values(yearData).reduce((sum, month) => sum + Object.keys(month).length, 0);
              console.log(`  ✅ Loaded ${readingCount} readings across ${monthCount} months for year ${year}`);
              totalLoaded += readingCount;
            }
          } else {
            console.log(`  ℹ️ No meter data found for year ${year}`);
          }
        } catch (error) {
          console.warn(`  ⚠️ Error loading year ${year}:`, error.message);
        }
      }

      console.log(`✅ Firebase meter data sync complete - ${totalLoaded} readings loaded`);
      this.firebaseLoadComplete = true;
      return true;
    } catch (error) {
      console.error('❌ Error loading meter data from Firebase:', error);
      return false;
    } finally {
      this.isLoadingFromFirebase = false;
    }
  }

  /**
   * Get all meter data stored locally
   */
  static getAllMeterData() {
    const data = {};
    for (let year = 2567; year <= 2570; year++) {
      const key = `meter_data_${year}`;
      const yearData = JSON.parse(localStorage.getItem(key) || '{}');
      if (Object.keys(yearData).length > 0) {
        data[year] = yearData;
      }
    }
    return data;
  }

  /**
   * Get meter data for specific year
   */
  static getMeterDataByYear(year) {
    const key = `meter_data_${year}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
  }

  /**
   * Store meter reading for a room in a month
   */
  static storeMeterReading(year, month, roomId, readings) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataKey = `meter_data_${year}`;

    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');

    if (!yearData[monthKey]) {
      yearData[monthKey] = {};
    }

    yearData[monthKey][roomId] = {
      ...readings,
      recordedDate: new Date().toISOString()
    };

    localStorage.setItem(dataKey, JSON.stringify(yearData));
    console.log(`✅ Stored meter reading for ${roomId} on ${monthKey}`);

    return yearData[monthKey][roomId];
  }

  /**
   * Get meter reading for a room in a specific month
   */
  static getMeterReading(year, month, roomId) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataKey = `meter_data_${year}`;
    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');
    return yearData[monthKey]?.[roomId] || null;
  }

  /**
   * Get meter readings for a room across all months/years
   */
  static getMeterReadingsByRoom(roomId) {
    const readings = [];

    for (let year = 2567; year <= 2570; year++) {
      const yearData = this.getMeterDataByYear(year);

      Object.keys(yearData).forEach((monthKey) => {
        if (yearData[monthKey][roomId]) {
          readings.push({
            ...yearData[monthKey][roomId],
            monthKey,
            year,
            month: parseInt(monthKey.split('-')[1])
          });
        }
      });
    }

    readings.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    return readings;
  }

  /**
   * Get meter readings for all rooms in a month
   */
  static getMeterReadingsByMonth(year, month) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataKey = `meter_data_${year}`;
    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');
    return yearData[monthKey] || {};
  }

  /**
   * Validate meter reading sequence
   */
  static validateMeterSequence(roomId) {
    const readings = this.getMeterReadingsByRoom(roomId);
    const errors = [];

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];

      if (curr.currentWater < prev.currentWater) {
        errors.push(
          `Water meter went backwards: ${prev.monthKey} (${prev.currentWater}) → ${curr.monthKey} (${curr.currentWater})`
        );
      }

      if (curr.currentElectric < prev.currentElectric) {
        errors.push(
          `Electric meter went backwards: ${prev.monthKey} (${prev.currentElectric}) → ${curr.monthKey} (${curr.currentElectric})`
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get summary of meter data coverage
   */
  static getDataCoverageSummary() {
    const summary = { years: {}, totalReadings: 0 };

    for (let year = 2567; year <= 2570; year++) {
      const yearData = this.getMeterDataByYear(year);
      const months = Object.keys(yearData);
      if (months.length > 0) {
        summary.years[year] = {
          months: months,
          monthCount: months.length,
          readingCount: Object.values(yearData).reduce((sum, month) => sum + Object.keys(month).length, 0)
        };
        summary.totalReadings += summary.years[year].readingCount;
      }
    }

    return summary;
  }

  /**
   * Export meter data to CSV
   */
  static exportMeterDataToCSV(year) {
    const yearData = this.getMeterDataByYear(year);

    if (Object.keys(yearData).length === 0) {
      return 'ไม่มีข้อมูล';
    }

    const headers = ['ห้อง', 'เดือน/ปี', 'มิเตอร์น้ำ (เดิม)', 'มิเตอร์น้ำ (ปัจจุบัน)', 'มิเตอร์ไฟ (เดิม)', 'มิเตอร์ไฟ (ปัจจุบัน)', 'บันทึก'];
    const rows = [];

    Object.keys(yearData).sort().forEach((monthKey) => {
      const month = monthKey.split('-')[1];
      const monthData = yearData[monthKey];

      Object.keys(monthData).forEach((roomId) => {
        const reading = monthData[roomId];
        rows.push([
          roomId,
          `${month}/${year}`,
          reading.waterStart || '-',
          reading.currentWater || '-',
          reading.electricStart || '-',
          reading.currentElectric || '-',
          reading.notes || ''
        ]);
      });
    });

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    return csv;
  }

  /**
   * Calculate average usage for a room
   */
  static calculateAverageUsage(roomId) {
    const readings = this.getMeterReadingsByRoom(roomId);

    if (readings.length < 2) {
      return { avgWaterUsage: 0, avgElectricUsage: 0, dataPoints: readings.length };
    }

    let totalWaterUsage = 0;
    let totalElectricUsage = 0;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];

      const waterUsage = Math.max(0, curr.currentWater - prev.currentWater);
      const electricUsage = Math.max(0, curr.currentElectric - prev.currentElectric);

      totalWaterUsage += waterUsage;
      totalElectricUsage += electricUsage;
    }

    const dataPoints = readings.length - 1;

    return {
      avgWaterUsage: totalWaterUsage / dataPoints,
      avgElectricUsage: totalElectricUsage / dataPoints,
      dataPoints
    };
  }
}

// ===== PART 3: VALIDATION & CALCULATION FUNCTIONS =====

function validateWaterReading(value, previousValue = 0) {
  if (value === null || value === undefined || value === '') {
    return { valid: false, error: 'ค่าน้ำต้องระบุ' };
  }

  const numValue = parseFloat(value);
  if (isNaN(numValue)) {
    return { valid: false, error: 'กรุณาระบุตัวเลข' };
  }

  if (numValue < 0) {
    return { valid: false, error: 'ค่ามิเตอร์ต้องเป็นบวก' };
  }

  if (numValue < previousValue) {
    return {
      valid: false,
      error: `ค่าปัจจุบัน (${numValue}) ต้องมากกว่าค่าเดิม (${previousValue})`
    };
  }

  return { valid: true, error: null };
}

function validateElectricReading(value, previousValue = 0) {
  if (value === null || value === undefined || value === '') {
    return { valid: false, error: 'ค่าไฟต้องระบุ' };
  }

  const numValue = parseFloat(value);
  if (isNaN(numValue)) {
    return { valid: false, error: 'กรุณาระบุตัวเลข' };
  }

  if (numValue < 0) {
    return { valid: false, error: 'ค่ามิเตอร์ต้องเป็นบวก' };
  }

  if (numValue < previousValue) {
    return {
      valid: false,
      error: `ค่าปัจจุบัน (${numValue}) ต้องมากกว่าค่าเดิม (${previousValue})`
    };
  }

  return { valid: true, error: null };
}

function calculateWaterUsage(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  if (c < p) return null;
  return c - p;
}

function calculateElectricUsage(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  if (c < p) return null;
  return c - p;
}

// ===== PART 4: IMPORT HELPER FUNCTIONS =====

function getPreviousMonthReadings(year, month, building = null) {
  if (!window.METER_DATA) return {};

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const key = `${prevYear}_${prevMonth}`;

  if (building) {
    if (!window.METER_DATA[building]) return {};
    return window.METER_DATA[building][key] || {};
  }

  return window.METER_DATA[key] || {};
}

function compareValues(imported, expected, field, isFirstImport) {
  const importedVal = parseFloat(imported) || 0;
  const expectedVal = parseFloat(expected) || 0;

  if (isFirstImport) {
    return { status: 'ok', match: true, imported: importedVal, expected: expectedVal };
  }

  if (importedVal === expectedVal) {
    return { status: 'ok', match: true, imported: importedVal, expected: expectedVal };
  }

  const delta = Math.abs(importedVal - expectedVal);
  const tolerance = 5;

  if (delta <= tolerance) {
    return { status: 'warning', match: false, imported: importedVal, expected: expectedVal, delta, reason: `Delta ${delta} within tolerance` };
  }

  return { status: 'error', match: false, imported: importedVal, expected: expectedVal, delta, reason: `Delta ${delta} exceeds tolerance` };
}

function determineStatus(results) {
  if (results.some(r => r.status === 'error')) return 'error';
  if (results.some(r => r.status === 'warning')) return 'warning';
  return 'ok';
}

function matchMeterDataWithPrevious(importedData) {
  const { year, month, building = null } = importedData;

  // Combine all buildings into a flat roomId→data map
  // V3 format returns { rooms:{...}, nest:{...}, amazon:{...} }
  // V1/V2 format returns { rooms:{...} } or flat rooms object
  const allRooms = {};
  if (importedData.rooms && typeof importedData.rooms === 'object') {
    Object.assign(allRooms, importedData.rooms);
  }
  if (importedData.nest && typeof importedData.nest === 'object') {
    Object.assign(allRooms, importedData.nest);
  }
  if (importedData.amazon && typeof importedData.amazon === 'object') {
    Object.assign(allRooms, importedData.amazon);
  }
  // Fallback: if importedData has numeric/string keys directly (old format)
  if (Object.keys(allRooms).length === 0 && importedData.rooms) {
    Object.assign(allRooms, importedData.rooms);
  }

  // Get previous month readings for all buildings
  let previousData = {};
  if (building === 'all') {
    // Merge previous readings from all three buildings
    const prevRooms = getPreviousMonthReadings(year, month, 'rooms');
    const prevNest = getPreviousMonthReadings(year, month, 'nest');
    const prevAmazon = getPreviousMonthReadings(year, month, 'amazon');
    Object.assign(previousData, prevRooms, prevNest, prevAmazon);
  } else {
    previousData = getPreviousMonthReadings(year, month, building);
  }

  const buildingKey = building || 'rooms';
  const isFirstImport = Object.keys(previousData).length === 0;

  console.log(`🔍 matchMeterDataWithPrevious: building=${buildingKey}, month=${month}, totalRooms=${Object.keys(allRooms).length}, isFirstImport=${isFirstImport}`);

  const results = {
    summary: {
      totalRooms: Object.keys(allRooms).length,
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

  for (const roomId in allRooms) {
    const imported = allRooms[roomId];
    const previous = previousData[roomId] || {};

    const electricMatch = compareValues(imported.eOld, previous.eNew, 'electric', isFirstImport);
    const waterMatch = compareValues(imported.wOld, previous.wNew, 'water', isFirstImport);

    const overallStatus = determineStatus([electricMatch, waterMatch]);
    results.summary[`${overallStatus}Count`]++;

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

    if (electricMatch.status !== 'ok') {
      results.mismatches.push({
        room: roomId,
        field: 'electric',
        fieldLabel: 'ไฟ (Electricity)',
        imported: imported.eOld,
        expected: previous.eNew
      });
    }

    if (waterMatch.status !== 'ok') {
      results.mismatches.push({
        room: roomId,
        field: 'water',
        fieldLabel: 'น้ำ (Water)',
        imported: imported.wOld,
        expected: previous.wNew
      });
    }
  }

  return results;
}

// ===== PART 5: MeterStore — single facade for all meter reads =====
// Single Source of Truth (Phase 1b 2026-04-19):
//   Read order: window.METER_DATA (in-memory) → Firestore meter_data → null
//   Hot cache backfilled from Firestore so repeated reads stay fast.
//   All call sites should use MeterStore.get / .getPrev instead of touching
//   window.METER_DATA / localStorage.METER_DATA / Firestore directly.
class MeterStore {
  /** Normalize year to 2-digit (Firestore docId convention: 67/68/69) */
  static _yy(year) {
    const n = Number(year);
    return n > 2400 ? n - 2500 : n;
  }
  /** Coerce building → 'rooms' | 'nest' (canonical) */
  static _bld(b) {
    if (b === 'old' || b === 'rooms' || b === 'RentRoom') return 'rooms';
    if (b === 'new' || b === 'nest') return 'nest';
    return b;
  }

  /** In-memory hot cache — window.METER_DATA[building][yy_m][roomId] */
  static _readMemory(building, yy, month, roomId) {
    const key = `${yy}_${month}`;
    const md = (typeof window !== 'undefined' && window.METER_DATA) || (() => {
      try { return JSON.parse(localStorage.getItem('METER_DATA') || 'null'); }
      catch(e) { return null; }
    })();
    if (md && md[building] && md[building][key] && md[building][key][roomId]) {
      return md[building][key][roomId];
    }
    return null;
  }

  /** Backfill in-memory cache after Firestore read (so next call is sync-fast) */
  static _writeMemory(building, yy, month, roomId, data) {
    if (typeof window === 'undefined') return;
    if (!window.METER_DATA) window.METER_DATA = { rooms: {}, nest: {} };
    const key = `${yy}_${month}`;
    window.METER_DATA[building] = window.METER_DATA[building] || {};
    window.METER_DATA[building][key] = window.METER_DATA[building][key] || {};
    window.METER_DATA[building][key][roomId] = data;
  }

  /**
   * Get meter reading for a specific room/month.
   * @param {string} building - 'rooms' | 'nest' (also accepts 'old'/'new'/'RentRoom')
   * @param {number} year - BE (2569) or short (69)
   * @param {number} month - 1-12
   * @param {string|number} roomId
   * @returns {Promise<{eNew,eOld,wNew,wOld}|null>}
   */
  static async get(building, year, month, roomId) {
    const bld = this._bld(building);
    const yy = this._yy(year);
    const m = Number(month);
    const room = String(roomId);

    // 1. In-memory hot path
    const mem = this._readMemory(bld, yy, m, room);
    if (mem) return mem;

    // 2. Firestore canonical
    try {
      if (window.firebase?.firestore && window.firebase?.firestoreFunctions) {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        const docId = `${bld}_${yy}_${m}_${room}`;
        const snap = await fs.getDoc(fs.doc(db, 'meter_data', docId));
        if (snap.exists()) {
          const data = snap.data();
          this._writeMemory(bld, yy, m, room, data);
          return data;
        }
      }
    } catch (e) {
      console.warn(`MeterStore.get(${bld}/${yy}_${m}/${room}):`, e.message);
    }

    return null;
  }

  /** Get previous month's reading (used as eOld/wOld baseline for new bills). */
  static async getPrev(building, year, month, roomId) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? Number(year) - 1 : Number(year);
    return this.get(building, prevYear, prevMonth, roomId);
  }
}

// ===== GLOBAL EXPORTS & ALIASES =====

// Expose globally for backward compatibility
if (typeof window !== 'undefined') {
  window.FirebaseMeterHelper = FirebaseMeterHelper;
  window.MeterDataManager = MeterDataManager;
  window.MeterStore = MeterStore;
  window.validateWaterReading = validateWaterReading;
  window.validateElectricReading = validateElectricReading;
  window.calculateWaterUsage = calculateWaterUsage;
  window.calculateElectricUsage = calculateElectricUsage;
  window.getPreviousMonthReadings = getPreviousMonthReadings;
  window.matchMeterDataWithPrevious = matchMeterDataWithPrevious;
}

console.log('✅ Meter System Unified Module loaded');
