# 📊 Meter System Documentation
## The Green Haven - Water & Electric Utilities Management

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [Features](#features)
3. [System Architecture](#system-architecture)
4. [User Workflows](#user-workflows)
5. [Data Structure](#data-structure)
6. [API Reference](#api-reference)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The Meter System is a comprehensive utility management solution for The Green Haven apartment building. It automates meter reading collection, bill generation, and utility income tracking for water and electricity usage.

### Key Goals
- ✅ Automated meter reading and bill generation
- ✅ Anomaly detection for unusual usage
- ✅ Historical tracking and trend analysis
- ✅ Integration with accounting system
- ✅ CSV import/export for bulk operations

### Default Rates
- 💧 **Water**: 18 บาท/unit
- ⚡ **Electric**: 7 บาท/unit

---

## Features

### 1. **Meter Reading Entry** (`/meter`)
- Admin interface for monthly meter readings
- Separate water and electric inputs for each room
- Automatic calculation of usage: `Current - Previous`
- Real-time bill preview before submission
- Previous month autofill
- Bulk CSV import support

### 2. **Anomaly Detection**
- Automatic flagging of unusual usage:
  - 🚨 Water > 50 units → Warning
  - 🚨 Electric > 500 units → Warning
- Visual highlighting of affected rooms
- Storage for investigation and tracking

### 3. **Bill Generation**
- Automatic invoice creation on submission
- Format: `INV-{roomId}-{YYYY_MM}`
- Status tracking: pending → sent → paid
- Integration with payment system
- Storage in `billGenerated` localStorage

### 4. **History & Analytics** (`/meter_history`)
- Historical usage tracking per room
- Usage trend visualization (Chart.js)
- Month-over-month comparisons
- Statistics: average, max, min usage
- Room filtering and date range selection
- CSV export for reporting

### 5. **Bulk Operations**
- CSV import template download
- Batch upload with validation
- CSV export of readings and calculations
- Error reporting and validation

### 6. **Rate Management**
- Configurable water and electric rates
- Rate change history tracking
- Effective date management
- Easy update interface

### 7. **Accounting Integration**
- Automatic revenue tracking
- Utility income separated from rent
- Functions for accounting system:
  - `calculateUtilityIncome(month, year)`
  - `getUtilityIncomeDetails(month, year)`

---

## System Architecture

### File Structure
```
The Green Haven/
├── meter.html               # Admin meter reading interface
├── meter.js                 # Meter system logic
├── meter_history.html       # Analytics and history page
├── meter_history.js         # Analytics logic
├── shared/
│   └── meter_system.js      # Core calculation engine
├── accounting.js            # Updated with utility income functions
└── dashboard.html           # Updated with meter navigation
```

### Workflow Diagram
```
┌─────────────────────────────────────────────────────────┐
│ Admin → /meter (Enter readings)                        │
│         ↓                                               │
│ System calculates usage (Current - Previous)           │
│         ↓                                               │
│ System detects anomalies (Water >50, Electric >500)   │
│         ↓                                               │
│ System generates bills (Usage × Rate)                  │
│         ↓                                               │
│ Save to localStorage + Accounting system              │
│         ↓                                               │
│ Tenants see bills in payment system                   │
│         ↓                                               │
│ Admin tracks history → /meter_history                 │
└─────────────────────────────────────────────────────────┘
```

### Data Flow
```
meter.html                   meter_history.html
    ↓                              ↓
meter.js          ←→        meter_history.js
    ↓                              ↓
meter_system.js (Core Engine)
    ↓
localStorage:
├── meterReadings
├── meterRates
├── meterHistory
├── meterAnomalies
├── billGenerated
└── ...

Accounting System:
├── calculateUtilityIncome()
└── getUtilityIncomeDetails()
```

---

## User Workflows

### Workflow 1: Monthly Meter Recording

**Step 1: Access Meter System**
```
Dashboard → Data Entry → บันทึกมิเตอร์ → /meter
```

**Step 2: Prepare for Month**
- Select month: Choose the month to record
- Load previous: Auto-fill "last reading" from previous month's "current"
- Verify rates: Check water (18) and electric (7) rates

**Step 3: Enter Readings**
- For each room: Enter current water and electric meter values
- System auto-calculates usage and bill
- Status badge shows completion and bill amount
- Red/yellow highlighting indicates high usage

**Step 4: Review & Submit**
- Check total rooms filled
- Review anomaly warnings
- Confirm in dialog
- System generates bills automatically

**Step 5: Verify Results**
- Check audit log
- View generated invoices
- Navigate to accounting to verify income

---

### Workflow 2: Bulk Import from CSV

**Step 1: Access Bulk Import**
```
/meter → Button "📥 นำเข้าจาก CSV"
```

**Step 2: Download Template**
- Click "📥 ดาวน์โหลดตัวอย่าง"
- Get CSV with all room numbers pre-filled

**Step 3: Fill Data**
```
Room,Water,Electric
13,145,3200
14,230,5400
15,120,2800
...
```

**Step 4: Upload & Import**
- Select file
- Click "✅ นำเข้า"
- System validates all data
- Shows count of imported rooms
- Auto-fills the form

---

### Workflow 3: View History & Analytics

**Step 1: Navigate**
```
Meter → Navigation → ประวัติมิเตอร์ → /meter_history
```

**Step 2: Filter Data**
- Select room (or "all" for aggregate)
- Choose time period: 3, 6, or 12 months
- Click "🔍 ค้นหา"

**Step 3: View Analysis**
- **Statistics Box**: Avg and max usage
- **Trend Chart**: Line or bar chart visualization
- **History Table**: Detailed readings and charges
- **Comparison**: Month-over-month trends

**Step 4: Export Data**
- Click "📥 ดาวน์โหลด CSV"
- File saved as `meter_history_room_{id}_{timestamp}.csv`

---

## Data Structure

### localStorage Keys

#### `meterReadings`
```javascript
{
  "2026_03": {
    "13": {
      currentWater: 1710,
      previousWater: 1707,
      currentElectric: 3291,
      previousElectric: 3267,
      date: "2026-03-01T10:30:00Z",
      status: "recorded"
    },
    "14": { ... },
    ...
  },
  "2026_02": { ... }
}
```

#### `meterRates`
```javascript
{
  "current": {
    water: 18,
    electric: 7,
    effectiveDate: "2026-03-01T00:00:00Z"
  },
  "history": [
    {
      water: 18,
      electric: 7,
      startDate: "2026-03-01T00:00:00Z",
      endDate: null,
      changedBy: "admin@example.com"
    }
  ]
}
```

#### `meterHistory`
```javascript
{
  "13": [
    {
      month: "2026_03",
      monthName: "มีนาคม",
      waterUsage: 3,
      waterCharge: 54,
      electricUsage: 24,
      electricCharge: 168,
      totalCharge: 222,
      recordedAt: "2026-03-01T10:30:00Z"
    },
    ...
  ],
  "14": [ ... ]
}
```

#### `meterAnomalies`
```javascript
{
  "2026_03": {
    "16": [
      {
        type: "high_water",
        value: 51,
        threshold: 50,
        severity: "warning",
        message: "💧 ห้อง 16: ใช้น้ำ 51 หน่วย (เกิน 1 หน่วย)"
      }
    ],
    "21": [
      {
        type: "high_electric",
        value: 625,
        threshold: 500,
        severity: "warning",
        message: "⚡ ห้อง 21: ใช้ไฟ 625 หน่วย (เกิน 125 หน่วย)"
      }
    ]
  }
}
```

#### `billGenerated`
```javascript
{
  "2026_03": {
    "13": {
      invoiceId: "INV-13-2026_03",
      roomId: "13",
      monthKey: "2026_03",
      waterUsage: 3,
      waterCharge: 54,
      electricUsage: 24,
      electricCharge: 168,
      totalCharge: 222,
      status: "pending",
      createdAt: "2026-03-01T10:30:00Z"
    },
    "14": { ... }
  }
}
```

---

## API Reference

### Core Functions (meter_system.js)

#### Calculation Functions
```javascript
// Usage calculation
calculateWaterUsage(current, previous) → number
calculateElectricUsage(current, previous) → number

// Billing
calculateWaterCharge(usage, rate) → number
calculateElectricCharge(usage, rate) → number
calculateTotalCharge(waterUsage, waterRate, electricUsage, electricRate) → number

// Anomaly detection
detectHighWaterUsage(reading, threshold = 50) → {detected, severity}
detectHighElectricUsage(reading, threshold = 500) → {detected, severity}
detectAllAnomalies(monthData) → anomalyArray

// Validation
validateWaterReading(value, previousValue) → {valid, error}
validateElectricReading(value, previousValue) → {valid, error}
validateBulkReadings(data) → {valid, errors, warnings}
```

#### History & Analysis
```javascript
getMeterHistoryForRoom(roomId, limit = 12) → historyArray
calculateTrendData(roomId, monthsBack = 12) → trendObject
compareMonthOverMonth(roomId, currentMonth, previousMonth) → comparisonObject
getAverageUsage(roomId, monthsBack = 12) → {water, electric}
```

#### Bulk Operations
```javascript
calculateBulkBills(monthKey, readings, rates) → billsObject
generateBillsForMonth(monthKey, allReadings, rates) → {success, created, errors}
parseCSVFile(csvText) → dataObject
validateImportData(data) → {valid, warnings, errors}
```

### Admin Functions (meter.js)

```javascript
submitMeterReadings() → void
loadPreviousMonth() → void
importFromCSV() → void
exportMeterData() → void
downloadCSVTemplate() → void
```

### History Functions (meter_history.js)

```javascript
loadHistory() → void
loadSingleRoomHistory(roomId) → void
loadAllRoomsHistory() → void
exportHistory() → void
```

### Accounting Integration (accounting.js)

```javascript
calculateUtilityIncome(month, year) → number
getUtilityIncomeDetails(month, year) → {water, electric, total}
```

---

## Configuration

### Rate Configuration

**Default Rates:**
- Water: 18 บาท/unit
- Electric: 7 บาท/unit

**Update Rates:**

**Option 1: Via Web Interface**
1. Go to `/meter`
2. Edit rates in "⚙️ ตั้งค่าอัตราค่าธรรมชาติ" section
3. Click "💾 บันทึกอัตรา"

**Option 2: Direct localStorage**
```javascript
const rates = {
  current: { water: 20, electric: 8, effectiveDate: new Date().toISOString() },
  history: [/* ... */]
};
localStorage.setItem('meterRates', JSON.stringify(rates));
```

### Anomaly Thresholds

**Water Threshold** (default: 50 units)
- Line: `detectHighWaterUsage(reading, 50)`
- Change in `meter_system.js`

**Electric Threshold** (default: 500 units)
- Line: `detectHighElectricUsage(reading, 500)`
- Change in `meter_system.js`

---

## Troubleshooting

### Issue: Bills not generating

**Symptom**: Submit button works but no bills appear

**Solutions**:
1. Check browser console for errors
2. Verify all rooms have readings (0 counts as empty)
3. Confirm rates are set (should be ≥0)
4. Check localStorage size isn't full
5. Clear cache and reload

### Issue: CSV import fails

**Symptom**: "ข้อมูลไม่ถูกต้อง" error on CSV import

**Solutions**:
1. Verify CSV format:
   - First row: `Room,Water,Electric`
   - Data must be numeric
   - Room number must match (13-33, 15ก)
2. Check for blank rows or extra spaces
3. Use provided template: "📥 ดาวน์โหลดตัวอย่าง"

### Issue: History page shows no data

**Symptom**: Meter history page displays "ไม่มีข้อมูล"

**Solutions**:
1. Ensure meters have been recorded this month
2. Select correct room and month range
3. Check localStorage: `JSON.parse(localStorage.getItem('meterHistory'))`
4. Verify previous entries were saved

### Issue: Anomalies not flagging

**Symptom**: High usage rooms don't show warnings

**Solutions**:
1. Verify usage actually exceeds threshold:
   - Water > 50
   - Electric > 500
2. Check browser console for JS errors
3. Clear localStorage cache

### Issue: Accounting not showing utility income

**Symptom**: Utility charges don't appear in accounting revenue

**Solutions**:
1. Verify bills were generated (check `billGenerated` in localStorage)
2. Ensure accounting.js functions are updated:
   - `calculateUtilityIncome()`
   - `getUtilityIncomeDetails()`
3. Check accounting dashboard filters
4. Verify month/year in queries

---

## Performance & Storage

### localStorage Limits
- Each entry ~200-300 bytes
- ~22 rooms × 12 months = 528 entries
- ~528 × 250 bytes = 132 KB estimated
- Browser limit: 5-10 MB (plenty of space)

### Optimization Tips
1. Archive old meter data after 2 years
2. Export and remove from localStorage
3. Keep only current year in active storage
4. Use database for long-term storage

### Archiving Example
```javascript
// Backup and remove old data
const backup = JSON.parse(localStorage.getItem('meterHistory'));
// Send to server/backup
localStorage.removeItem('meterHistory'); // Clear
```

---

## Integration Examples

### Integration 1: Display Utility Income in Dashboard KPI

```javascript
// In dashboard.html
const utilityIncome = calculateUtilityIncome(3, 2026);
document.getElementById('utilityKPI').textContent = `💧⚡ ${formatCurrency(utilityIncome)}`;
```

### Integration 2: Export Monthly Report

```javascript
// Generate comprehensive report
const revenue = calculateMonthlyRevenue(3, 2026);
const utilities = getUtilityIncomeDetails(3, 2026);

const report = {
  month: 'March 2026',
  rentIncome: revenue - utilities.total,
  waterIncome: utilities.water,
  electricIncome: utilities.electric,
  totalIncome: revenue
};
```

### Integration 3: Tax Filing

```javascript
// Include utility income in tax calculations
const taxableIncome = calculateMonthlyRevenue(1, 2026); // Includes utilities
const taxAmount = taxableIncome * 0.15; // Thai corporate tax rate
```

---

## Future Enhancements

### Phase 4 Features (Planned)
- [ ] QR code scanning for meter numbers
- [ ] Meter photo proof capture
- [ ] Meter route optimization (Building → Floor → Room)
- [ ] Mobile app for field reading
- [ ] Real-time notifications for anomalies
- [ ] Tenant self-service bill viewing

### Phase 5 Features (Planned)
- [ ] Predictive analytics for usage patterns
- [ ] Seasonal trend analysis
- [ ] Automated leak detection
- [ ] Integration with IoT smart meters
- [ ] Multi-building support
- [ ] Advanced filtering and reporting

---

## Support & Documentation

### Key URLs
- 📊 Meter Reading: `/meter`
- 📈 History & Analytics: `/meter_history`
- 🏠 Dashboard: `/dashboard`
- 💳 Accounting: `/accounting`

### File References
- Core Logic: `shared/meter_system.js`
- Admin UI: `meter.js` & `meter.html`
- Analytics: `meter_history.js` & `meter_history.html`
- Integration: `accounting.js`

### Contact & Issues
- Report bugs in Git issues
- Suggest features in Git discussions
- Document custom modifications

---

**Last Updated**: March 2026
**Version**: 1.0.0
**Status**: Production Ready

---

*The Green Haven Meter System - Making utility management simple and accurate* 📊💚
