# 📥 Billing Import System - Technical Documentation

> เอกสารนี้อธิบายการทำงานของระบบ import บิล และจุดสำคัญที่ต้องระวัง

## 🎯 ภาพรวมการทำงาน

```
User Upload File
       ↓
HTML Input (onchange) → handleBillingImportFile()
       ↓
handleBillingImportFileProcess(file)
       ↓
1. Extract year from filename
2. Read Excel with XLSX library
3. Parse data based on year format
4. Call matchMeterDataWithPrevious (from meter-unified.js)
5. Display preview
6. Save to localStorage (HISTORICAL_DATA)
```

---

## 🔑 ส่วนสำคัญ #1: HTML File Input Element

**Location:** `dashboard.html:2981`

```html
<input
  type="file"
  id="billingFileInput"
  accept=".xlsx,.xls"
  style="display:none;"
  onchange="window.handleBillingImportFile && window.handleBillingImportFile(event);">
```

### 🚨 ทำไมต้อง `window.handleBillingImportFile &&`?

```javascript
// ❌ WRONG - will crash if function not loaded
onchange="handleBillingImportFile(event);"

// ✅ CORRECT - checks if exists first
onchange="window.handleBillingImportFile && window.handleBillingImportFile(event);"
```

**Why:**
- HTML attributes execute immediately when element loads
- JavaScript functions may not be defined yet
- If function not found → `ReferenceError` crash
- `&&` operator checks first before calling
  - If `window.handleBillingImportFile` is undefined → short-circuit, don't call
  - If defined → call the function

---

## 🔑 ส่วนสำคัญ #2: Function Definition & Global Scope

**Location:** `dashboard.html:14720-14760`

```javascript
function handleBillingImportFile(event) {
  const files = event.target.files;
  if (files.length > 0) {
    handleBillingImportFileProcess(files[0]);
  }
}

// 🚨 CRITICAL: Expose to window scope
window.handleBillingImportFile = handleBillingImportFile;
window.handleBillingImportDrop = handleBillingImportDrop;
```

### ⚠️ Common Mistake:

```javascript
// ❌ WRONG - Function exists but not in window scope
function handleBillingImportFile(event) { ... }
// (forgot to do: window.handleBillingImportFile = ...)

// HTML will still crash:
// Error: "handleBillingImportFile is not defined"

// ✅ CORRECT - Must expose to window
window.handleBillingImportFile = handleBillingImportFile;
```

**Why?**
- HTML attributes look for functions in `window` scope
- If function only exists in local scope → not found
- Solution: Always `window.functionName = functionName;`

---

## 🔑 ส่วนสำคัญ #3: Filename Validation

**Location:** `dashboard.html:14785`

```javascript
const yearMatch = file.name.match(/ปี(\d+)/);

if (!yearMatch) {
  showBillingImportStatus('❌ ชื่อไฟล์ต้องมี "ปี" และตัวเลขปี', 'error');
  return; // ⚠️ STOP processing
}
```

### ✅ Valid Filenames:
```
✅ บิลปี69.xlsx
✅ บิลปี70 (2).xlsx
✅ bill_ปี68_final.xlsx
✅ ใบแจ้งหนี้ปี71.xls
```

### ❌ Invalid Filenames:
```
❌ bill69.xlsx (no "ปี")
❌ บิล69.xlsx (no "ปี")
❌ บิลปีนี้.xlsx (no number after "ปี")
```

---

## 🔑 ส่วนสำคัญ #4: The Critical Safety Check

**Location:** `dashboard.html:4254-4259` (and 4175-4180)

```javascript
// ⚠️ THIS IS THE MOST IMPORTANT SAFETY CHECK

// Step 1: Check if function exists
if (typeof window.matchMeterDataWithPrevious === 'function') {
  // Step 2: Safe to call - function is loaded
  matchResults = window.matchMeterDataWithPrevious(importData);
} else {
  // Step 3: Function not loaded yet - use fallback
  console.warn('⚠️ matchMeterDataWithPrevious not available yet');
  matchResults = { summary: { totalRooms: 0 }, details: [], canProceed: true, isFirstImport: true };
}
```

### Why This Check Exists:

**Problem:** `matchMeterDataWithPrevious` comes from another file (`shared/meter-unified.js`)
- If that file doesn't load → function won't exist
- If we call it anyway → `ReferenceError: matchMeterDataWithPrevious is not defined`

**Solution:** Check before calling + provide fallback

```javascript
// ❌ WITHOUT SAFETY CHECK - will crash
const matchResults = matchMeterDataWithPrevious(importData);
// If meter-unified.js didn't load → CRASH!

// ✅ WITH SAFETY CHECK - won't crash
if (typeof window.matchMeterDataWithPrevious === 'function') {
  const matchResults = window.matchMeterDataWithPrevious(importData);
} else {
  const matchResults = fallbackObject;
}
```

---

## 📋 Data Flow Detailed

### 1️⃣ File Upload Triggered
```
User clicks drop zone
  → Triggers billingDropZone onclick
  → Clicks hidden billingFileInput
  → User selects file
  → onchange event fires
  → window.handleBillingImportFile(event) called
```

### 2️⃣ File Processing
```
handleBillingImportFile(event)
  → Extract file from event.target.files[0]
  → Call handleBillingImportFileProcess(file)
```

### 3️⃣ Excel Parsing
```
handleBillingImportFileProcess(file)
  → Extract year from filename regex (/ปี(\d+)/)
  → Read file with FileReader.readAsArrayBuffer()
  → Parse with XLSX.read()
  → Detect format (V2 if year >= 70, else V3)
  → Process each sheet with async breaks
```

### 4️⃣ Data Matching
```
parseImportExcelData(workbook, building)
  → Returns: { year, month, rooms: { roomId: { eNew, eOld, ... } } }

matchMeterDataWithPrevious(importData) [from meter-unified.js]
  → Compares with previous month
  → Returns: { summary, details, mismatches, canProceed }
```

### 5️⃣ Display & Save
```
displayImportPreview(importData, matchResults)
  → Shows table with comparison results

HISTORICAL_DATA (localStorage)
  → Stores all import data for dashboard display
```

---

## 🐛 Troubleshooting

### Error: "handleBillingImportFile is not defined"

**Cause:** Function not exposed to `window` scope

**Fix:** Check line ~14760
```javascript
window.handleBillingImportFile = handleBillingImportFile; ✅
```

---

### Error: "matchMeterDataWithPrevious is not defined"

**Cause:** `meter-unified.js` didn't load OR safety check missing

**Fix 1:** Check if meter-unified.js is included
```html
<script src="./shared/meter-unified.js"></script> ✅
```

**Fix 2:** Check if function exposed in meter-unified.js
```javascript
window.matchMeterDataWithPrevious = matchMeterDataWithPrevious; ✅
```

**Fix 3:** Check if safety check in place (line 4254-4259)
```javascript
if (typeof window.matchMeterDataWithPrevious === 'function') { ✅
```

---

### File Not Processing

**Check:**
1. Browser console (F12) for errors
2. Filename has "ปี" + number
3. File is valid .xlsx or .xls
4. XLSX library loaded (check HTML header)
5. localStorage not full (some browsers limit size)

---

## 🔄 Two Entry Points (Same Processor)

### Entry Point 1: Drop Zone
```html
<div ondrop="handleBillingImportDrop(event);">
  <!-- User drags file here -->
</div>
```

### Entry Point 2: File Input
```html
<input onchange="window.handleBillingImportFile && window.handleBillingImportFile(event);">
```

**Both lead to:**
```javascript
handleBillingImportFileProcess(file) ← Single processor
```

---

## 💾 Data Storage

### localStorage Key: `HISTORICAL_DATA`
```javascript
{
  "69": {
    "label": "ปี 69 (2026)",
    "months": [
      null, // Month 1 (Jan) - no data
      [rent, elec, water, trash, total], // Month 2 (Feb)
      ...
    ]
  },
  "70": { ... }
}
```

---

## 🧪 Testing Checklist

- [ ] Filename has "ปี" + year (e.g., "บิลปี69.xlsx")
- [ ] Browser cache cleared (Ctrl+F5)
- [ ] Console shows no errors (F12)
- [ ] meter-unified.js loaded (check Network tab)
- [ ] Functions exposed to window scope
- [ ] Safety checks in place before function calls

---

## 📚 Related Files

- `dashboard.html` - Main UI and logic
- `shared/meter-unified.js` - matchMeterDataWithPrevious function
- `shared/billing-system.js` - Billing calculations

---

**Last Updated:** 2026-04-07
