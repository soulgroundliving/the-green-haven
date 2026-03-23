# 💳 Complete Payment Flow System - Test Guide

## System Overview

The Green Haven now has a complete end-to-end payment flow:
1. **Admin generates monthly invoices** (ใบวางบิล) for all rooms
2. **Tenants view invoices** in the Tenant App
3. **Tenants upload payment slips** and verify via SlipOK
4. **Admin receives real-time notifications** when payments are verified
5. **Receipts are auto-generated** (ใบเสร็จรับเงิน) when payment is verified
6. **Payment status updates** in both admin and tenant apps

---

## Phase 1: Admin Dashboard - Generate Monthly Bills

### Location
- **Dashboard** → **💳 ยืนยันการชำระเงิน** (Payment Verification)

### Steps

#### 1. Generate Monthly Bills
```
1. Go to Dashboard → Payment Verification page
2. Look for "📄 สร้างใบวางบิลประจำเดือน" card at the top
3. Click "📋 สร้างบิล" button
4. Select building:
   - 1. rooms (ห้องแถว)
   - 2. nest (Nest Building)
5. Enter month (1-12)
6. Enter year (Buddhist year - e.g., 2569 for 2026)
7. Click OK
```

**Expected Result:**
- Dialog shows: "✅ สร้างใบวางบิลสำเร็จ! จำนวน: X ใบ"
- Invoice count should match number of active rooms in building
- Each room gets one invoice per month

**Sample Output:**
```
✅ สร้างใบวางบิลสำเร็จ!

จำนวน: 24 ใบ
อาคาร: rooms
เดือน: 3/2569
```

---

#### 2. Download Invoices as PDF
```
1. Still on Payment Verification page
2. Click "📥 ดาวน์โหลด PDF" button
3. Select same building
```

**Expected Result:**
- Browser shows: "📥 ดาวน์โหลด 24 ใบวางบิล"
- PDFs download with 500ms delay between each file
- File names: `INV-13-2569_3.pdf`, `INV-14-2569_3.pdf`, etc.

---

### Invoice PDF Content

Each invoice includes:
- **Header**: 🌿 The Green Haven | อพาร์ทเมนต์ (building name)
- **Title**: ใบวางบิล / INVOICE
- **Room Details**: ห้องเลขที่, ประจำเดือน, วันที่ออกบิล
- **Breakdown Table**:
  - ค่าเช่า (Rent from room config)
  - ค่าไฟฟ้า (Electric: meter units × rate)
  - ค่าน้ำ (Water: meter units × rate)
  - ค่ากลาง - ขยะ-ไฟส่วนกลาง (Common fee: ฿40 fixed)
- **Total Amount**: รวมทั้งสิ้น
- **Payment Info**:
  - PromptPay QR code area
  - ชื่อ: The Green Haven
  - เบอร์PromptPay: 089-1234567
  - Payment deadline: 5 days
  - Generated date/time

---

## Phase 2: Real-Time Admin Notifications

### Payment Notifications Panel
- **Location**: Payment Verification page, below bill generation section
- **Updates in real-time** when payments are verified from tenant app
- **Shows latest 10 notifications**, newest first

### Notification Types

#### ✅ Payment Verified
```
✅ ห้อง 13 - โอนเงิน ฿6,900
23 มีนาคม 14:30 | SlipID: TXN123456...
```

#### 📄 Receipt Generated
```
📄 ห้อง 13 - ใบเสร็จ ฿6,900
23 มีนาคม 14:31 | ReceiptID: RCP-13-1711... | Verified: ✅
```

---

## Phase 3: Tenant App - Payment Flow

### Location
- **Tenant App** → **💳 ยืนยันการชำระเงิน** (Payment Verification Tab)

### Step-by-Step Payment Process

#### Step 1: View Bills
```
1. Open Tenant App
2. Login as tenant
3. Go to "💳 ยืนยันการชำระเงิน" tab
4. See list of bills (invoices):
   - Month
   - Breakdown: ค่าเช่า + ค่าไฟ + ค่าน้ำ + ค่ากลาง
   - Total amount
   - Status: ⏳ รอชำระ (Pending) or ✅ จ่ายแล้ว (Paid)
```

---

#### Step 2: Upload Payment Slip

```
1. Click on pending bill
2. See PromptPay QR code (or mock QR)
3. Options for payment:
   - 📱 Prompt Pay (QR scan)
   - 🏦 E-Banking (instructions)
   - 📸 อัปโหลดสลิป (Upload slip)

4. Select "📸 อัปโหลดสลิป"
5. Choose payment slip image from device
6. Click "อัปโหลด"
```

**Sample Slip Data** (mock for testing):
```javascript
{
  transactionId: "TXN-2026-03-23-001",
  sender: "สมชาย วงค์นวล",
  amount: 6900,
  tDate: "23/03/2569 14:25",
  receiver: "089-1234567"
}
```

---

#### Step 3: Verify Payment with SlipOK

**Current Status**: SlipOK integration has mock verification with TODO for real API

```
Flow:
1. Slip uploaded → Shows "⏳ กำลังตรวจสอบ..."
2. Verifies amount matches invoice total
3. If match: ✅ "ตรวจสอบโดย SlipOK"
4. If mismatch: ❌ "จำนวนไม่ตรงกัน"
```

**Expected Result:**
- Slip verified and shows:
  - ผู้โอน: [Sender name]
  - จำนวน: [Amount]
  - เวลา: [Transfer time]
  - หมายเลขอ้างอิง: [Transaction ID]

---

#### Step 4: Generate Receipt

```
1. After slip verified, click "กด 'ออกใบเสร็จรับเงิน' หลังรับเงินแล้ว"
2. System creates receipt (ใบเสร็จรับเงิน):
   - ✅ ยืนยันการชำระแล้ว
   - Shows all payment details
   - Includes SlipOK verification badge
   - ขอบคุณที่ชำระค่าเช่าตรงเวลา
```

---

## Phase 4: Admin Dashboard - Payment Notifications

### Real-Time Updates

When tenant generates receipt:

1. **Notification Toast** appears in admin dashboard
   - "📄 ใบเสร็จรับเงินถูกสร้าง" (green success notification)

2. **Notifications Panel** updates automatically
   - Shows room number, amount, timestamp
   - Shows receipt ID and verification status
   - Updates in real-time across browser tabs

3. **Payment Status Updated**
   - Invoice marked as "paid"
   - Invoice updated in InvoiceReceiptManager
   - Firebase synced with timestamp

---

## Data Storage & Flow

### localStorage Keys

```javascript
// Invoices (per building)
localStorage['invoices_rooms'] = {
  'INV-13-2569_3': { invoice data... },
  'INV-14-2569_3': { invoice data... }
}

// Receipts (per building)
localStorage['receipts_rooms'] = {
  'RCP-13-1711...' = { receipt data... }
}

// Payment Notifications (admin notifications)
localStorage['payment_notifications'] = [
  {
    type: 'payment_verified',
    building: 'rooms',
    room: '13',
    amount: 6900,
    timestamp: '2026-03-23T...',
    slipId: 'TXN-2026-03-23-001',
    status: 'verified'
  },
  {
    type: 'receipt_generated',
    building: 'rooms',
    room: '13',
    amount: 6900,
    receiptId: 'RCP-13-1711...',
    timestamp: '2026-03-23T...',
    verified: true
  }
]
```

### Firebase Sync

```
Firestore Collections:
- /invoices/{building}/list/{invoiceId}
  - All invoices synced with status: pending/paid/overdue

- /receipts/{building}/list/{receiptId}
  - All receipts synced with verification badge

- /data/payment_notifications
  - Admin notifications synced in real-time
```

---

## Complete Test Scenario

### Test Case 1: Basic Bill Generation

```
Test Setup:
- Building: rooms
- Month: March (3)
- Year: 2026 (2569 Buddhist)

Expected:
1. Dashboard shows "✅ สร้างใบวางบิลสำเร็จ! จำนวน: 24 ใบ"
2. 24 invoices created (rooms 13-33 + AMAZON)
3. Each invoice has rent + meter charges + common fee
4. Invoices stored in localStorage['invoices_rooms']
```

### Test Case 2: Tenant Uploads Slip

```
Test Setup:
- Tenant: Room 13
- Invoice: 6900 baht
- Slip Image: Any image file

Expected Flow:
1. Tenant uploads image
2. System shows "⏳ กำลังตรวจสอบ..."
3. Amount verification passes (6900 matches)
4. Slip verified badge shows ✅
5. Payment status updates to "ชำระแล้ว"
```

### Test Case 3: Admin Gets Notification

```
Test Setup:
- Admin dashboard open
- Tenant app in another tab/window
- Tenant generates receipt

Expected:
1. Admin sees toast: "📄 ใบเสร็จรับเงินถูกสร้าง"
2. Notifications panel shows:
   - ✅ ห้อง 13 - โอนเงิน ฿6,900
   - Receipt ID and verification status
3. Payment marked "paid" in invoice list
```

---

## Testing Checklist

### Admin Dashboard Tests
- [ ] Generate bills for rooms building (24 rooms)
- [ ] Generate bills for nest building (16 rooms)
- [ ] Download invoices as PDF (file count correct)
- [ ] Bill generation with different months/years
- [ ] Notifications panel displays payments
- [ ] Notifications panel clears without clearing localStorage
- [ ] Page refresh - notifications persist

### Tenant App Tests
- [ ] View generated invoices in Bills tab
- [ ] Invoice shows correct breakdown (rent + utilities + common fee)
- [ ] Upload payment slip
- [ ] Slip verification (amount matching)
- [ ] Receipt generation and display
- [ ] Payment marked as paid
- [ ] Payment history shows completed payments

### Real-Time Sync Tests
- [ ] Open admin dashboard in 2 browser tabs
- [ ] Tenant generates receipt in one window
- [ ] Both admin tabs receive notification
- [ ] localStorage payment_notifications updates correctly

### Data Persistence Tests
- [ ] Refresh admin dashboard - payments still show
- [ ] Refresh tenant app - bills still show
- [ ] Close and reopen browser - data persists in localStorage
- [ ] Firebase syncs correctly (if online)

---

## Known Limitations & TODO

### SlipOK API Integration
- Current: **Mock verification** (predefined response)
- TODO: Integrate with real SlipOK API
- Location: `tenant.html` line 1341-1431, function `verifySlipWithSlipOK()`

```javascript
// TODO: Replace with real SlipOK API call
// Current: Mock response
// Real: POST to SlipOK API with slip image
```

### Email/SMS Notifications
- Current: **localStorage/event-based** (real-time dashboard only)
- TODO: Add email to tenant when payment verified
- TODO: Add SMS to admin when receipt generated

### QR Code Generation
- Current: **Placeholder text** ("📱 สแกน QR Code เพื่อชำระเงิน")
- TODO: Generate actual PromptPay QR code with amount encoded
- Library: `qrcodejs` already loaded in tenant app

---

## Console Debugging

To check what's happening:

```javascript
// Check all invoices for a building
localStorage['invoices_rooms']

// Check payment notifications
JSON.parse(localStorage.getItem('payment_notifications'))

// Check invoice status
const invoices = JSON.parse(localStorage.getItem('invoices_rooms'));
Object.values(invoices).map(inv => ({id: inv.id, status: inv.status, amount: inv.amount}))

// Check if managers are loaded
typeof BillGenerator          // should be 'function'
typeof InvoicePDFGenerator    // should be 'function'
typeof InvoiceReceiptManager  // should be 'function'

// Manually trigger bill generation
BillGenerator.generateMonthlyBills('rooms', 2569, 3)

// Get payment summary
getPaymentNotificationSummary()
```

---

## Success Criteria

✅ **Complete** when:
1. Admin can generate 20+ invoices for a building in < 1 second
2. Tenant receives and views invoice in app
3. Tenant uploads slip and receives verification
4. Receipt auto-generates when verified
5. Admin dashboard receives and displays notification in real-time
6. Payment status updates to "paid" in both apps
7. All data persists on browser refresh
8. Firebase syncs (when online)

---

## Next Steps

### Phase 1 Complete ✅
- Bill generation automation
- Invoice PDF generation
- Payment verification UI
- Receipt generation
- Admin notifications

### Phase 2 Ready
- Tenant App payment flow
- Multi-building support
- Real-time synchronization
- Payment history tracking

### Phase 3 Future
- Email/SMS notifications
- Real SlipOK API integration
- Tax filing integration
- Accounting reports

---

**System Version**: v1.0
**Last Updated**: March 23, 2026
**Test Environment**: Both local (port 8000) and production ready
