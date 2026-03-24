# 📊 Setup Billing System with Real Data (ปี 67-69)

## 📁 ไฟล์ Excel ที่มี

```
C:\Users\usEr\Documents\The Green Haven\
  ├── บิลปี67.xlsx (106 KB)  → Year 2567
  ├── บิลปี68.xlsx (84 KB)   → Year 2568
  └── บิลปี69.xlsx (63 KB)   → Year 2569
```

## 📋 โครงสร้างข้อมูล Excel

### Sheets ในแต่ละไฟล์
- `EX` หรือ `EX.` - Summary/template
- เดือนต่างๆ (12 sheets for months)

### Column Structure
```
A: ห้อง ID (13, 14, 15, 15ก, 16... amazon)
B: (empty/hidden)
C: (empty/hidden)
D: Rent Price (ค่าเช่า)
E: (empty)
F: Water (ค่าน้ำ)
G: Electric (ค่าไฟ)
H: Subtotal
...
Total Column: ค่าบิลรวม
```

## 🚀 วิธี Import ข้อมูลจริง

### Step 1: ใช้ openpyxl Extract ข้อมูล

```python
from openpyxl import load_workbook

wb = load_workbook(r'C:\Users\usEr\Documents\The Green Haven\บิลปี69.xlsx')

# ดึงข้อมูลแต่ละเดือน
for sheet_name in wb.sheetnames:
    if sheet_name not in ['EX', 'EX.']:
        ws = wb[sheet_name]
        month = extract_month_from_sheet_name(sheet_name)

        # ดึงข้อมูลแต่ละห้อง
        for row in ws.iter_rows(min_row=2, values_only=False):
            room_id = row[0].value
            rent = row[3].value
            water_cost = row[5].value
            electric_cost = row[6].value
            total = row[11].value  # หรือคอลัมน์สุดท้าย
```

### Step 2: Import เข้า localStorage

```javascript
// โหลด script
<script src="./shared/billing-calculator.js"></script>
<script src="./shared/meter-data-manager.js"></script>
<script src="./shared/billing-data-importer.js"></script>

// จากนั้น import ข้อมูล
const billsData = [
  { roomId: '13', month: 1, rent: 1500, waterCost: 300, electricCost: 280, totalCharge: 2120 },
  { roomId: '14', month: 1, rent: 1200, waterCost: 240, electricCost: 224, totalCharge: 1704 },
  // ... more
];

BillingDataImporter.importBills(billsData, 2569);
```

### Step 3: ดูข้อมูลที่ import

```javascript
// ดูบิลทั้งหมดของห้อง 13
const bills13 = BillingCalculator.getBillsByRoom('13');
console.log(bills13);

// ดูบิลเดือนมกราคม ปี 69
const jan69 = BillingCalculator.getBillByMonthYear('13', 1, 2569);
console.log(jan69.totalCharge);
```

## 🎯 ข้อมูลที่สามารถแยกได้

### จากบิลปี 67-69:
- ✅ ห้อง ID
- ✅ ค่าเช่า
- ✅ ค่าน้ำ
- ✅ ค่าไฟ
- ✅ ค่ากลาง (if available)
- ✅ ค่าขยะ (if available)
- ✅ ค่าบิลรวม

### ที่ต้องคำนวน/ระบุเพิ่มเติม:
- 📝 Usage (units) - คำนวนจากข้อมูล หรือจำเป็นต้องมี meter readings
- 🔧 Meter readings - ต้องจากระบบการบันทึกมิเตอร์
- 💾 Status - สมมติว่า 'pending' ถ้าไม่มีข้อมูลจ่ายแล้ว

## 📌 Format ข้อมูล ที่ Importer คาดหวัง

```javascript
const billsData = [
  {
    roomId: '13',
    month: 1,              // 1-12
    year: 2569,            // auto-add by importer
    rent: 1500,
    waterUsage: 15,        // optional
    waterCost: 300,
    electricUsage: 35,     // optional
    electricCost: 280,
    trash: 40,
    common: 0,
    totalCharge: 2120,
    status: 'pending',     // optional
    notes: ''              // optional
  },
  // ... more bills
];

// Import
BillingDataImporter.importBills(billsData, 2569);
```

## 🔄 ขั้นตอนทั้งหมด

```
1. Read Excel บิลปี 67-69
   ↓
2. Extract ค่าบิลแต่ละห้อง/เดือน
   ↓
3. Format เป็น JavaScript array
   ↓
4. Import ด้วย BillingDataImporter
   ↓
5. ตรวจสอบด้วย BillingCalculator.getBillsByRoom()
   ↓
6. Display ใน dashboard/tenant app
```

## 📊 ตัวอย่าง Script Extract

```python
from openpyxl import load_workbook
import json

def extract_month_number(sheet_name):
    # แปลง ม.ค., ก.พ., มี.ค. เป็น 1, 2, 3
    months = {
        'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4,
        'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8,
        'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12
    }
    for thai_month, num in months.items():
        if thai_month in sheet_name:
            return num
    return None

def extract_bills(excel_file, year):
    wb = load_workbook(excel_file)
    bills = []

    for sheet_name in wb.sheetnames:
        if sheet_name in ['EX', 'EX.']:
            continue

        month = extract_month_number(sheet_name)
        if month is None:
            continue

        ws = wb[sheet_name]

        # Extract rows (start from row 2, skip header)
        for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
            room_id = row[0].value
            if room_id is None or room_id == '':
                continue

            bill = {
                'roomId': str(room_id).strip(),
                'month': month,
                'rent': float(row[3].value or 0),           # Column D
                'waterCost': float(row[5].value or 0),      # Column F
                'electricCost': float(row[6].value or 0),   # Column G
                'trash': float(row[9].value or 0),          # Column J
                'common': float(row[10].value or 0),        # Column K
                'totalCharge': float(row[11].value or 0)    # Column L
            }

            bills.append(bill)

    return bills

# Usage
bills_67 = extract_bills('บิลปี67.xlsx', 2567)
bills_68 = extract_bills('บิลปี68.xlsx', 2568)
bills_69 = extract_bills('บิลปี69.xlsx', 2569)

# Save to JSON
with open('bills_data.json', 'w', encoding='utf-8') as f:
    json.dump({
        '2567': bills_67,
        '2568': bills_68,
        '2569': bills_69
    }, f, ensure_ascii=False, indent=2)
```

## ✅ Checklist

- [ ] Read all 3 Excel files
- [ ] Extract billing data for all months/rooms
- [ ] Format data as JavaScript array
- [ ] Import to localStorage using BillingDataImporter
- [ ] Verify data loads correctly with BillingCalculator
- [ ] Display in dashboard Billing History page
- [ ] (Optional) Extract meter data if available in Excel

## 🎯 ผลลัพธ์

หลังจาก import เสร็จ:

```javascript
// ดูบิลทั้งหมดของห้อง 13 (ปี 67-69)
BillingCalculator.getBillsByRoom('13');
// Result: 36 bills (12 months × 3 years)

// ดูบิลเดือนมกราคม ปี 69
BillingCalculator.getBillByMonthYear('13', 1, 2569);
// Result: { billId: "BILL-2569-01-rooms-13", ... }

// Summary เดือนมกราคม ปี 69
BillingCalculator.generateMonthlySummary(1, 2569);
// Result: { totalRooms: 20+, totalCharge: 40000+, ... }
```

## 📞 ติดตามอยู่

ได้ 3 files:
- ✅ `billing-calculator.js` - Calculate bills
- ✅ `meter-data-manager.js` - Manage meter data
- ✅ `billing-test-data.js` - Sample data
- ✅ `billing-data-importer.js` - Import from Excel (NEW)

Ready to import real data! 🚀
