// ===== METER SYSTEM CORE MODULE =====
// The Green Haven - Water & Electric Utilities Management System
// Core calculation engine and utility functions

// ===== VALIDATION FUNCTIONS =====

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

function detectDuplicateReading(roomId, monthKey, readings) {
  if (!readings || !readings[monthKey] || !readings[monthKey][roomId]) {
    return false;
  }
  const existing = readings[monthKey][roomId];
  return existing.currentWater !== null && existing.currentElectric !== null;
}

function validateReadingRange(value, minBound = 0, maxBound = 999999) {
  const numValue = parseFloat(value);
  return numValue >= minBound && numValue <= maxBound;
}

// ===== USAGE CALCULATION FUNCTIONS =====

function calculateWaterUsage(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;

  if (c < p) {
    return null; // Error: meter went backwards
  }

  return c - p;
}

function calculateElectricUsage(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;

  if (c < p) {
    return null; // Error: meter went backwards
  }

  return c - p;
}

function getUsageDecrease(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;

  if (c < p) {
    return {
      usage: 0,
      isNegative: true,
      error: `ค่ามิเตอร์ปัจจุบัน (${c}) ต้องมากกว่าค่าเดิม (${p})`
    };
  }

  return {
    usage: c - p,
    isNegative: false,
    error: null
  };
}

// ===== BILLING CALCULATION FUNCTIONS =====

function calculateWaterCharge(usage, rate) {
  const u = parseFloat(usage) || 0;
  const r = parseFloat(rate) || 0;
  return Math.round(u * r * 100) / 100; // Round to 2 decimals
}

function calculateElectricCharge(usage, rate) {
  const u = parseFloat(usage) || 0;
  const r = parseFloat(rate) || 0;
  return Math.round(u * r * 100) / 100; // Round to 2 decimals
}

function calculateTotalCharge(waterUsage, waterRate, electricUsage, electricRate) {
  const waterCharge = calculateWaterCharge(waterUsage, waterRate);
  const electricCharge = calculateElectricCharge(electricUsage, electricRate);
  return Math.round((waterCharge + electricCharge) * 100) / 100;
}

// ===== ANOMALY DETECTION FUNCTIONS =====

function detectHighWaterUsage(reading, threshold = 50) {
  const usage = parseFloat(reading) || 0;

  if (usage > threshold) {
    const percentage = ((usage - threshold) / threshold * 100).toFixed(1);
    return {
      detected: true,
      severity: usage > threshold * 2 ? 'critical' : 'warning',
      percentage: percentage,
      excess: usage - threshold
    };
  }

  return { detected: false, severity: null };
}

function detectHighElectricUsage(reading, threshold = 500) {
  const usage = parseFloat(reading) || 0;

  if (usage > threshold) {
    const percentage = ((usage - threshold) / threshold * 100).toFixed(1);
    return {
      detected: true,
      severity: usage > threshold * 1.5 ? 'critical' : 'warning',
      percentage: percentage,
      excess: usage - threshold
    };
  }

  return { detected: false, severity: null };
}

function detectAllAnomalies(monthData) {
  const anomalies = [];

  for (const roomId in monthData) {
    if (!monthData[roomId]) continue;

    const data = monthData[roomId];
    const waterUsage = calculateWaterUsage(data.currentWater, data.previousWater);
    const electricUsage = calculateElectricUsage(data.currentElectric, data.previousElectric);

    // Check water
    if (waterUsage !== null) {
      const waterAnomaly = detectHighWaterUsage(waterUsage, 50);
      if (waterAnomaly.detected) {
        anomalies.push({
          roomId: roomId,
          type: 'high_water',
          value: waterUsage,
          threshold: 50,
          severity: waterAnomaly.severity,
          message: `💧 ห้อง ${roomId} ใช้น้ำ ${waterUsage} หน่วย (เกิน ${waterAnomaly.excess.toFixed(1)} หน่วย)`
        });
      }
    }

    // Check electric
    if (electricUsage !== null) {
      const electricAnomaly = detectHighElectricUsage(electricUsage, 500);
      if (electricAnomaly.detected) {
        anomalies.push({
          roomId: roomId,
          type: 'high_electric',
          value: electricUsage,
          threshold: 500,
          severity: electricAnomaly.severity,
          message: `⚡ ห้อง ${roomId} ใช้ไฟ ${electricUsage} หน่วย (เกิน ${electricAnomaly.excess.toFixed(1)} หน่วย)`
        });
      }
    }
  }

  return anomalies;
}

function checkAnomalyThreshold(type, value, threshold) {
  const v = parseFloat(value) || 0;
  const t = parseFloat(threshold) || 1;

  if (v <= t) {
    return { exceeded: false, percentage: 0 };
  }

  const percentage = ((v - t) / t * 100).toFixed(1);
  return {
    exceeded: true,
    percentage: percentage
  };
}

// ===== DATE & FORMATTING FUNCTIONS =====

function getMonthKey(date) {
  if (typeof date === 'string' && date.includes('-')) {
    // Already in format YYYY-MM
    const parts = date.split('-');
    return `${parts[0]}_${parts[1]}`;
  }

  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}_${month}`;
}

function getMonthNameThai(monthNumber) {
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const num = parseInt(monthNumber) - 1;
  return months[num] || '';
}

function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2
  }).format(num);
}

function formatThaiDate(isoDate) {
  const d = new Date(isoDate);
  const day = d.getDate();
  const month = getMonthNameThai(d.getMonth() + 1);
  const year = d.getFullYear() + 543; // Convert to Buddhist calendar
  return `${day} ${month} ${year}`;
}

function formatMeterValue(value) {
  const num = parseFloat(value) || 0;
  return num.toLocaleString('th-TH');
}

function formatThousandsSeparator(num) {
  return num.toLocaleString('th-TH');
}

// ===== HISTORY & TREND FUNCTIONS =====

function getMeterHistoryForRoom(roomId, limit = 12) {
  const history = JSON.parse(localStorage.getItem('meterHistory') || '{}');

  if (!history[roomId]) {
    return [];
  }

  return history[roomId].slice(-limit).reverse();
}

function calculateTrendData(roomId, monthsBack = 12) {
  const history = getMeterHistoryForRoom(roomId, monthsBack);

  if (history.length === 0) {
    return null;
  }

  const waterUsages = history.map(h => h.waterUsage);
  const electricUsages = history.map(h => h.electricUsage);

  return {
    waterAverage: (waterUsages.reduce((a, b) => a + b, 0) / waterUsages.length).toFixed(1),
    electricAverage: (electricUsages.reduce((a, b) => a + b, 0) / electricUsages.length).toFixed(1),
    waterMax: Math.max(...waterUsages),
    electricMax: Math.max(...electricUsages),
    waterMin: Math.min(...waterUsages),
    electricMin: Math.min(...electricUsages),
    monthsAnalyzed: history.length,
    history: history
  };
}

function compareMonthOverMonth(roomId, currentMonth, previousMonth) {
  const history = JSON.parse(localStorage.getItem('meterHistory') || '{}');

  if (!history[roomId]) {
    return null;
  }

  const current = history[roomId].find(h => h.month === currentMonth);
  const previous = history[roomId].find(h => h.month === previousMonth);

  if (!current || !previous) {
    return null;
  }

  const waterChange = current.waterUsage - previous.waterUsage;
  const electricChange = current.electricUsage - previous.electricUsage;
  const costChange = current.totalCharge - previous.totalCharge;

  return {
    waterChange: waterChange,
    waterChangePercent: ((waterChange / previous.waterUsage) * 100).toFixed(1),
    electricChange: electricChange,
    electricChangePercent: ((electricChange / previous.electricUsage) * 100).toFixed(1),
    costChange: costChange,
    costChangePercent: ((costChange / previous.totalCharge) * 100).toFixed(1)
  };
}

function getHighestUsageMonth(roomId, year) {
  const history = getMeterHistoryForRoom(roomId, 12);

  if (history.length === 0) {
    return null;
  }

  let highest = history[0];

  for (let i = 1; i < history.length; i++) {
    const totalUsage = history[i].waterUsage + history[i].electricUsage;
    const highestUsage = highest.waterUsage + highest.electricUsage;

    if (totalUsage > highestUsage) {
      highest = history[i];
    }
  }

  return {
    month: highest.month,
    usage: highest.waterUsage + highest.electricUsage
  };
}

function getAverageUsage(roomId, monthsBack = 12) {
  const history = getMeterHistoryForRoom(roomId, monthsBack);

  if (history.length === 0) {
    return null;
  }

  const waterSum = history.reduce((sum, h) => sum + h.waterUsage, 0);
  const electricSum = history.reduce((sum, h) => sum + h.electricUsage, 0);

  return {
    water: (waterSum / history.length).toFixed(1),
    electric: (electricSum / history.length).toFixed(1),
    monthsAveraged: history.length
  };
}

// ===== BULK OPERATION FUNCTIONS =====

function validateBulkReadings(data) {
  const errors = [];
  const warnings = [];

  if (!data || Object.keys(data).length === 0) {
    errors.push('ไม่มีข้อมูลที่จะตรวจสอบ');
    return { valid: false, errors, warnings };
  }

  for (const roomId in data) {
    const reading = data[roomId];

    // Validate water
    if (reading.currentWater === null || reading.currentWater === undefined) {
      errors.push(`ห้อง ${roomId}: ค่าน้ำปัจจุบันหายไป`);
      continue;
    }

    const waterVal = validateWaterReading(reading.currentWater, reading.previousWater || 0);
    if (!waterVal.valid) {
      errors.push(`ห้อง ${roomId}: ${waterVal.error}`);
    }

    // Validate electric
    if (reading.currentElectric === null || reading.currentElectric === undefined) {
      errors.push(`ห้อง ${roomId}: ค่าไฟปัจจุบันหายไป`);
      continue;
    }

    const electricVal = validateElectricReading(reading.currentElectric, reading.previousElectric || 0);
    if (!electricVal.valid) {
      errors.push(`ห้อง ${roomId}: ${electricVal.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

function calculateBulkBills(monthKey, readings, rates) {
  const bills = {};
  const rates_obj = rates || JSON.parse(localStorage.getItem('meterRates') || '{}');
  const waterRate = rates_obj.current?.water || rates_obj.water || 18;
  const electricRate = rates_obj.current?.electric || rates_obj.electric || 7;

  for (const roomId in readings) {
    const reading = readings[roomId];

    const waterUsage = calculateWaterUsage(reading.currentWater, reading.previousWater);
    const electricUsage = calculateElectricUsage(reading.currentElectric, reading.previousElectric);

    const waterCharge = calculateWaterCharge(waterUsage, waterRate);
    const electricCharge = calculateElectricCharge(electricUsage, electricRate);
    const totalCharge = waterCharge + electricCharge;

    bills[roomId] = {
      invoiceId: `INV-${roomId}-${monthKey}`,
      roomId: roomId,
      monthKey: monthKey,
      waterUsage: waterUsage,
      waterCharge: waterCharge,
      electricUsage: electricUsage,
      electricCharge: electricCharge,
      totalCharge: totalCharge,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
  }

  return bills;
}

function generateBillsForMonth(monthKey, allReadings, rates) {
  const validation = validateBulkReadings(allReadings);

  if (!validation.valid) {
    return {
      success: false,
      created: 0,
      errors: validation.errors
    };
  }

  try {
    const bills = calculateBulkBills(monthKey, allReadings, rates);
    const billGenerated = JSON.parse(localStorage.getItem('billGenerated') || '{}');

    if (!billGenerated[monthKey]) {
      billGenerated[monthKey] = {};
    }

    let createdCount = 0;
    for (const roomId in bills) {
      billGenerated[monthKey][roomId] = bills[roomId];
      createdCount++;
    }

    localStorage.setItem('billGenerated', JSON.stringify(billGenerated));

    return {
      success: true,
      created: createdCount,
      errors: []
    };
  } catch (error) {
    return {
      success: false,
      created: 0,
      errors: [error.message]
    };
  }
}

// ===== DATA IMPORT/EXPORT FUNCTIONS =====

function parseCSVFile(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const data = {};

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());

    if (values.length < 3) continue;

    const roomId = values[0];
    const waterValue = parseFloat(values[1]) || 0;
    const electricValue = parseFloat(values[2]) || 0;

    data[roomId] = {
      currentWater: waterValue,
      currentElectric: electricValue
    };
  }

  return data;
}

function formatToCSV(data) {
  let csv = 'Room,Water Current,Electric Current,Water Usage,Electric Usage,Water Charge,Electric Charge,Total\n';

  for (const roomId in data) {
    const reading = data[roomId];
    csv += `${roomId},${reading.currentWater || ''},${reading.currentElectric || ''},${reading.waterUsage || ''},${reading.electricUsage || ''},${reading.waterCharge || ''},${reading.electricCharge || ''},${reading.totalCharge || ''}\n`;
  }

  return csv;
}

function formatToJSON(data) {
  return JSON.stringify(data, null, 2);
}

function validateImportData(data) {
  const warnings = [];
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('ข้อมูลต้องเป็นวัตถุ (object)');
    return { valid: false, warnings, errors };
  }

  let roomCount = 0;
  for (const roomId in data) {
    roomCount++;

    if (!data[roomId].currentWater && data[roomId].currentWater !== 0) {
      errors.push(`ห้อง ${roomId}: ค่าน้ำปัจจุบันหายไป`);
    }

    if (!data[roomId].currentElectric && data[roomId].currentElectric !== 0) {
      errors.push(`ห้อง ${roomId}: ค่าไฟปัจจุบันหายไป`);
    }
  }

  if (roomCount === 0) {
    errors.push('ไม่มีข้อมูลห้อง');
  }

  return {
    valid: errors.length === 0,
    warnings: warnings,
    errors: errors
  };
}

// ===== UTILITY FUNCTIONS =====

function getCurrentRates() {
  const meterRates = JSON.parse(localStorage.getItem('meterRates') || '{}');

  if (meterRates.current) {
    return meterRates.current;
  }

  // Fallback to old format
  return {
    water: meterRates.water || 18,
    electric: meterRates.electric || 7
  };
}

function getMeterReadings(monthKey) {
  const readings = JSON.parse(localStorage.getItem('meterReadings') || '{}');
  return readings[monthKey] || {};
}

function saveMeterReadings(monthKey, readings) {
  const allReadings = JSON.parse(localStorage.getItem('meterReadings') || '{}');
  allReadings[monthKey] = readings;
  localStorage.setItem('meterReadings', JSON.stringify(allReadings));
}

function getGeneratedBills(monthKey) {
  const bills = JSON.parse(localStorage.getItem('billGenerated') || '{}');
  return bills[monthKey] || {};
}

function getTotalChargeForMonth(monthKey) {
  const bills = getGeneratedBills(monthKey);
  let total = 0;

  for (const roomId in bills) {
    total += bills[roomId].totalCharge || 0;
  }

  return total;
}
