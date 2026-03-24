/**
 * Meter Data Manager
 * Manages historical meter readings organized by year/month/room
 * ระบบจัดการข้อมูลมิเตอร์ย้อนหลัง ตั้งแต่ปี 67
 */

class MeterDataManager {
  /**
   * Get all meter data stored locally
   * @returns {object} - Meter data structure
   */
  static getAllMeterData() {
    const data = {};

    // Load from localStorage for years 2567-2570
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
   * @param {number} year - Year to retrieve
   * @returns {object} - Meter data for year organized as {monthKey: {roomId: reading}}
   */
  static getMeterDataByYear(year) {
    const key = `meter_data_${year}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
  }

  /**
   * Store meter reading for a room in a month
   * @param {number} year - Year
   * @param {number} month - Month (1-12)
   * @param {string} roomId - Room identifier
   * @param {object} readings - { waterCurrent, waterStart, electricCurrent, electricStart, ...}
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
   * @param {number} year - Year
   * @param {number} month - Month
   * @param {string} roomId - Room identifier
   * @returns {object|null} - Meter reading or null
   */
  static getMeterReading(year, month, roomId) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataKey = `meter_data_${year}`;

    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');

    return yearData[monthKey]?.[roomId] || null;
  }

  /**
   * Get meter readings for a room across all months/years
   * @param {string} roomId - Room identifier
   * @returns {array} - Array of meter readings sorted by date
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

    // Sort chronologically
    readings.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    return readings;
  }

  /**
   * Get meter readings for all rooms in a month
   * @param {number} year - Year
   * @param {number} month - Month
   * @returns {object} - Meter readings keyed by roomId
   */
  static getMeterReadingsByMonth(year, month) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dataKey = `meter_data_${year}`;

    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');

    return yearData[monthKey] || {};
  }

  /**
   * Import meter data from Firebase
   * @param {object} firebaseData - Data from Firebase
   * @param {number} year - Year to import into
   */
  static importFromFirebase(firebaseData, year) {
    if (!firebaseData || Object.keys(firebaseData).length === 0) {
      console.warn('⚠️ No Firebase data to import');
      return false;
    }

    const dataKey = `meter_data_${year}`;
    const yearData = JSON.parse(localStorage.getItem(dataKey) || '{}');

    // Merge Firebase data
    Object.keys(firebaseData).forEach((monthKey) => {
      if (!yearData[monthKey]) {
        yearData[monthKey] = {};
      }

      Object.keys(firebaseData[monthKey]).forEach((roomId) => {
        if (!yearData[monthKey][roomId]) {
          yearData[monthKey][roomId] = firebaseData[monthKey][roomId];
        }
      });
    });

    localStorage.setItem(dataKey, JSON.stringify(yearData));
    console.log(`✅ Imported Firebase data for year ${year}`);

    return true;
  }

  /**
   * Validate meter reading sequence (no backwards readings)
   * @param {string} roomId - Room identifier
   * @returns {object} - { valid, errors }
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

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get summary of meter data coverage
   * @returns {object} - Summary with years and months covered
   */
  static getDataCoverageSummary() {
    const summary = {
      years: {},
      totalReadings: 0
    };

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
   * @param {number} year - Year to export
   * @returns {string} - CSV content
   */
  static exportMeterDataToCSV(year) {
    const yearData = this.getMeterDataByYear(year);

    if (Object.keys(yearData).length === 0) {
      return 'ไม่มีข้อมูล';
    }

    const headers = [
      'ห้อง',
      'เดือน/ปี',
      'มิเตอร์น้ำ (เดิม)',
      'มิเตอร์น้ำ (ปัจจุบัน)',
      'มิเตอร์ไฟ (เดิม)',
      'มิเตอร์ไฟ (ปัจจุบัน)',
      'บันทึก'
    ];

    const rows = [];

    Object.keys(yearData)
      .sort()
      .forEach((monthKey) => {
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
   * @param {string} roomId - Room identifier
   * @returns {object} - { avgWaterUsage, avgElectricUsage, dataPoints }
   */
  static calculateAverageUsage(roomId) {
    const readings = this.getMeterReadingsByRoom(roomId);

    if (readings.length < 2) {
      return {
        avgWaterUsage: 0,
        avgElectricUsage: 0,
        dataPoints: readings.length
      };
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

// Expose globally
window.MeterDataManager = MeterDataManager;

console.log('✅ MeterDataManager loaded');
