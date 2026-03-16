# 📋 Complete Requirements Summary

**Source:** Documents from C:\Users\usEr\Documents\The Green Haven\Dashboard

---

## 🎯 Core Features (Both Pages)

### ⭐ 1. Occupancy Dashboard
**Status:** ⚠️ Not Started
**Priority:** 🔴 CRITICAL

What it shows (top of page):
- ห้องทั้งหมด: 90
- มีผู้เช่า: 67
- ว่าง: 23
- Occupancy %: 74%

**Why:** Foundation metric for all property management

---

### ⭐ 2. Lease Expiry Alerts
**Status:** ⚠️ Not Started
**Priority:** 🔴 CRITICAL

What it shows:
- ⚠️ หมดสัญญาใน 30 วัน
- List of rooms with upcoming expiries

**Why:** Landlord needs to know renewals in advance

---

### ⭐ 3. Vacancy Alert System
**Status:** ⚠️ Not Started
**Priority:** 🟠 HIGH

What it shows:
- ⚠️ ห้องว่างเกิน 60 วัน (color-coded)
- Lost revenue calculation

**Why:** Identify revenue leaks

---

### ⭐ 4. Tenant History
**Status:** ⚠️ Not Started
**Priority:** 🟡 MEDIUM

Click room → see:
- 2023: คุณเอก
- 2024: คุณปิง
- Rental duration

**Why:** Track tenant patterns

---

### ⭐ 5. Rent Adjustment Tool
**Status:** ⚠️ Not Started
**Priority:** 🟡 MEDIUM

Features:
- Increase rent: +200 baht per room
- Apply to: Full floor OR specific type
- Batch update capability

**Why:** Easy price management

---

## 📊 Dashboard (ห้องแถว) Features

### 1. Hero KPIs (Top Section)
**Priority:** 🔴 CRITICAL - Add immediately

```
┌─────────────────────────────────┐
│ Occupancy Rate      │ 67/90 (74%) │
│ Expected Revenue    │ ฿118,000    │
│ Overdue Rent        │ 3 ห้อง      │
│                     │ ฿14,200     │
└─────────────────────────────────┘
```

---

### 2. Monthly Revenue Chart
**Priority:** 🟠 HIGH
**Current Status:** ✅ Has chart, needs improvement

Improvements:
- Add average line (horizontal)
- Show avg value on line
- Better labeling

---

### 3. Revenue Breakdown (Pie Chart)
**Priority:** 🟠 HIGH
**Current Status:** ✅ Has chart, needs labels

Add labels:
- ค่าเช่าห้อง: 65%
- ค่าไฟ: 18%
- ค่าน้ำ: 10%
- อื่นๆ: 7%

---

### 4. Revenue Trend Cards
**Priority:** 🟠 HIGH

Show each revenue stream:
```
ค่าเช่า
฿132,304
⬆️ +6% จากเดือนก่อน
```

Or if down:
```
⬇️ -3% จากเดือนก่อน
```

---

### 5. 3-Year Comparison Chart
**Priority:** 🟡 MEDIUM
**Current Status:** ✅ Has chart, needs labels

Improve:
- Label years more clearly
- Add legend: 2567 (Actual) / 2568 (Actual) / 2569 (Forecast)

---

### 6. Monthly Utility Charts (ค่าไฟ/ค่าน้ำ)
**Priority:** 🟡 MEDIUM
**Current Status:** ✅ Has charts, needs hover

Add hover information:
```
June
ค่าไฟ: ฿14,120
ค่าน้ำ: ฿3,200
```

---

### 7. Payment Status Colors
**Priority:** 🟠 HIGH
**Current Status:** ⚠️ Needs color coding

Implement:
- 🟢 จ่ายแล้ว (Green)
- 🟡 รอจ่าย (Yellow)
- 🔴 ค้าง (Red)

---

### 8. Occupancy Rate Card
**Priority:** 🟠 HIGH

Show:
```
Occupancy Rate
74%

(+ 0 ผู้เช่า, 23 ห้องว่าง)
```

**Why:** Standard real estate metric

---

### 9. Potential Revenue vs Actual
**Priority:** 🟠 HIGH

Show:
```
เต็ม (Full): ฿135,000
จริง (Actual): ฿102,500
สูญเสีย (Lost): ฿32,500

What if เต็มห้อง?
```

---

## 🏢 Nest Building Features

### 1. Room Map with Status Colors
**Priority:** 🔴 CRITICAL
**Current Status:** ⚠️ All rooms look the same

Add color status:
- 🟢 มีผู้เช่า (Occupied)
- ⚪ ว่าง (Vacant)
- 🔴 ค้างค่าเช่า (Overdue)
- 🟡 ใกล้หมดสัญญา (Lease Expiring)

**Why:** Visual mini-command center

---

### 2. View Toggle (Floor vs Grid)
**Priority:** 🟡 MEDIUM

Options:
- Floor View (เห็นชั้น)
- Grid View (แบบตารางเลขห้อง)

```
Grid View:
101 102 103
201 202 203
```

---

### 3. Summary Section
**Priority:** 🟠 HIGH

For each unit type (Studio/1BR/2BR):
```
Studio
- 10 ห้อง
- 7/10 occupied
- ฿39,200 / เดือน
- Potential: ฿42,000
```

---

### 4. Revenue Simulation
**Priority:** 🟡 MEDIUM

Show:
```
เต็ม: ฿134,200
จริง: ฿102,500
```

---

### 5. Room Cards - Quick Actions
**Priority:** 🟠 HIGH
**Current:** Only "Edit" button

Add buttons:
- 📄 ดูสัญญา (View Contract)
- 💰 บันทึกค่าเช่า (Record Payment)
- 🧾 ดูบิล (View Bills)
- 🔧 แจ้งซ่อม (Report Maintenance)

---

### 6. Room Cards - Payment Status
**Priority:** 🟠 HIGH

Show:
```
จ่ายแล้ว
หรือ
ค้าง 1 เดือน
```

---

### 7. Room Cards - Lease Expiry
**Priority:** 🟠 HIGH

Show:
```
หมดสัญญา 3 เดือน
```

**Why:** Critical for landlord planning

---

### 8. Modal - Document Upload
**Priority:** 🟡 MEDIUM

Add ability to upload:
- สัญญาเช่า (Lease Contract)
- บัตรประชาชน (ID Card)

---

### 9. Modal - Meter Start Values
**Priority:** 🟡 MEDIUM

When room is first rented:
- มิเตอร์ไฟเริ่มต้น (Starting electric meter)
- มิเตอร์น้ำเริ่มต้น (Starting water meter)

---

### 10. Modal - Rental History
**Priority:** 🟢 LOW

Show:
```
เคยเช่าตั้งแต่: 01/2024
```

---

## 🏘️ Old Building (ห้องแถว) Features

### 1. Room Status Colors
**Priority:** 🔴 CRITICAL

Implement:
- 🟢 เขียว = มีผู้เช่า
- ⚪ เทา = ว่าง
- 🔴 แดง = ค้างค่าเช่า
- 🟡 เหลือง = ใกล้หมดสัญญา

---

### 2. Occupancy Indicator (Header)
**Priority:** 🟠 HIGH

Show:
```
ห้องทั้งหมด 90
มีผู้เช่า 67
ว่าง 23
Occupancy 74%
```

---

### 3. Revenue Projection
**Priority:** 🟠 HIGH

Show:
```
เต็ม: ฿120,000
จริง: ฿94,500
สูญเสีย: ฿25,500
```

---

### 4. Amazon/Shop Section
**Priority:** 🟡 MEDIUM

Show contract info:
```
สัญญาเหลืออีก: 8 เดือน
หรือ
หมดสัญญาใน: 2 เดือน
```

---

### 5. Room Cards - Quick Actions
**Priority:** 🟠 HIGH

Add buttons:
- 📄 ดูสัญญา (View Contract)
- 💰 บันทึกค่าเช่า (Record Payment)
- 🧾 ดูบิล (View Bills)

---

### 6. Room Cards - Due Date
**Priority:** 🟠 HIGH

Show:
```
ครบกำหนด: 5 มิ.ย.
```

---

### 7. Room Cards - Overdue Amount
**Priority:** 🟠 HIGH

Show:
```
ค้าง: 1 เดือน
฿1,500
```

---

### 8. Modal - Document Upload
**Priority:** 🟡 MEDIUM

Add:
- สัญญาเช่า (Contract)
- บัตรประชาชน (ID)

---

### 9. Modal - Initial Meter Readings
**Priority:** 🟡 MEDIUM

Add:
- มิเตอร์ไฟเริ่มต้น
- มิเตอร์น้ำเริ่มต้น

**When:** On move-in

---

### 10. Modal - Room Status Toggle
**Priority:** 🟢 LOW

Toggles:
- ว่าง (Vacant)
- มีผู้เช่า (Occupied)
- กำลังซ่อม (Maintenance)

---

## ⭐ New Features (Both Buildings)

### 1. Occupancy Indicator
**Priority:** 🔴 CRITICAL

Header shows:
```
ห้องทั้งหมด: 90
มีผู้เช่า: 67
ว่าง: 23
Occupancy: 74%
```

---

### 2. Filter Rooms
**Priority:** 🟠 HIGH

Options:
- [ว่าง] (Vacant)
- [มีผู้เช่า] (Occupied)
- [ค้างชำระ] (Overdue)

---

### 3. Search Rooms
**Priority:** 🟠 HIGH

Search by:
- เลขห้อง (Room number)
- ชื่อผู้เช่า (Tenant name)

---

### 4. Batch Actions
**Priority:** 🟡 MEDIUM

Select multiple rooms → Apply action:
- เพิ่มค่าเช่า +200
- เปลี่ยนสถานะ
- เพิ่มค่าใช้บริการ

**When:** Price adjustments

---

## 📈 Advanced Features (Future)

### Lease Timeline Visualization
**Priority:** 🟢 LOW

Show:
```
N101  หมดสัญญา 20 วัน
N203  หมดสัญญา 3 เดือน
...
```

---

### Vacancy Duration Tracking
**Priority:** 🟢 LOW

Show:
```
N203
ว่าง 42 วัน
```

---

### Rent Trend Analysis
**Priority:** 🟢 LOW

Show:
```
Studio
2023 → ฿5,200
2024 → ฿5,600
```

---

### Tenant Risk Assessment
**Priority:** 🟢 LOW

Calculate from:
- จ่ายช้า (Late payments)
- ค้างบ่อย (Frequent arrears)

---

### Profit per Floor
**Priority:** 🟢 LOW

Show:
```
ชั้น 1 → ฿32,000
ชั้น 2 → ฿28,000
ชั้น 3 → ฿31,000
```

---

## 🚀 Implementation Priority

### Phase 1: Critical (Week 1)
1. ✅ Occupancy Dashboard
2. ✅ Color-coded room status
3. ✅ Lease expiry alerts
4. ✅ Payment status indicator
5. ✅ Room status colors

### Phase 2: High (Week 2)
1. ⚠️ Hero KPIs dashboard
2. ⚠️ Revenue projection
3. ⚠️ Room quick actions
4. ⚠️ Filter & Search
5. ⚠️ Batch actions

### Phase 3: Medium (Week 3)
1. ⚠️ Chart improvements
2. ⚠️ Document upload modal
3. ⚠️ Meter reading modal
4. ⚠️ Vacancy alert system
5. ⚠️ Rent adjustment tool

### Phase 4: Nice-to-Have (Future)
1. ⚠️ Advanced analytics
2. ⚠️ Lease timeline
3. ⚠️ Tenant risk scoring
4. ⚠️ Batch operations
5. ⚠️ Timeline visualization

---

## 📊 Completion Status

| Category | Done | Todo | Progress |
|----------|------|------|----------|
| Dashboard | 0 | 9 | 0% |
| Nest | 1 | 9 | 10% |
| Old Building | 0 | 10 | 0% |
| Core Features | 0 | 5 | 0% |
| **Total** | **1** | **33** | **3%** |

---

## 🎯 Next Steps

1. **Start Phase 1 features this week**
2. **Focus on color-coded UI first** (biggest visual impact)
3. **Implement room status colors** (all buildings)
4. **Add occupancy dashboard** (critical metric)
5. **Test with real data**

---

*Last Updated: March 2026*
*Total Features: 34*
*Critical Features: 5*
*High Priority: 8*
