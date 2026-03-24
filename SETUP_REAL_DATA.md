# Green Haven - Real Data Setup Guide

## Overview
This guide explains how to upload 594 real bills to Firebase and manage tenant data in the system.

---

## Step 1: Upload Real Bills to Firebase

### Option A: Using Admin Upload Page (Recommended)

1. **Open the admin upload page:**
   - Go to: `http://localhost:8000/admin-upload-bills.html`
   - Or open `admin-upload-bills.html` directly in your browser

2. **Click "เริ่มอัปโหลด" (Start Upload)**
   - Wait for upload to complete
   - You'll see progress bar and status messages
   - Success summary shows at the bottom

3. **What gets uploaded:**
   - 594 real bills from `real-bills-generated.json`
   - Year 67: 264 bills (complete)
   - Year 68: 264 bills (complete)
   - Year 69: 66 bills (January-March only)
   - Organized as: `bills/{building}/{roomId}/{billId}`

### Data Structure in Firebase
```
bills/
  rooms/
    13/
      BILL-67-01-rooms-13: {...}
      BILL-67-02-rooms-13: {...}
      ...
    14/
      BILL-67-01-rooms-14: {...}
      ...
  nest/
    N101/
      BILL-67-01-nest-N101: {...}
      ...
```

---

## Step 2: Verify Bills in Tenant App

1. **Access tenant app:**
   - Go to: `http://localhost:8000/tenant.html?room=13`
   - Login with tenant account (if required)

2. **Check Bills Tab:**
   - Navigate to Bills (💳) tab
   - Should show 12 months of real bills
   - Each bill shows: rent, water, electric, trash charges
   - Month/year data should match actual bill data

3. **Click on a Bill:**
   - View full invoice (ใบวางบิล)
   - See meter readings (previous, current, usage)
   - See itemized charges

---

## Step 3: Manage Tenant Data in Dashboard

### Owner Information
1. Go to Dashboard → Management (👤) → Owner Info (🏢)
2. Fill in owner/landlord details:
   - Name, ID number, phone, email
   - Address, tax ID, bank account
3. Click "บันทึก" (Save)
4. Data auto-syncs to Firebase

### Tenant Master
1. Go to Dashboard → Management (👤) → Tenant Master (👥)
2. Select building: "ห้องแถว" or "Nest"
3. Add new tenant:
   - Tenant ID: T001, T002, etc.
   - Name, ID card number, phone
   - Email, address
4. Click "เพิ่มผู้เช่า" (Add Tenant)
5. Tenant appears in list and syncs to Firebase

### Lease Agreements
1. Go to Dashboard → Management (👤) → Lease Agreements (📋)
2. Create new lease:
   - Select building and room
   - Select tenant from master list
   - Set move-in date, rent amount, deposit
3. Click "สร้างสัญญา" (Create Lease)
4. View lease history for each room
5. End lease when tenant moves out

---

## Step 4: Verify Data Sync

### Check Firebase Realtime Database
1. Open Firebase Console
2. Go to Realtime Database
3. Verify data exists at:
   - `bills/rooms/{roomId}` - Contains uploaded bills
   - `bills/nest/{roomId}` - Contains uploaded bills

### Check Firebase Firestore
1. Open Firebase Console → Firestore
2. Verify collections exist:
   - `tenants/{building}/list/{tenantId}` - Tenant data
   - `leases/{building}/list/{leaseId}` - Lease agreements
   - `owner_info/main` - Owner information

### Check localStorage (Browser DevTools)
1. Open browser DevTools (F12)
2. Application → Local Storage
3. Verify keys exist:
   - `tenant_master_data` - All tenants by building
   - `lease_agreements_data` - All leases
   - `owner_info` - Owner data
   - `rooms_config_rooms`, `rooms_config_nest` - Room configs

---

## Step 5: Test Full Data Flow

### Test 1: Add Tenant and View in Tenant App
1. Dashboard → Add tenant "T001"
2. Create lease for Room 13, T001
3. Tenant app: Check tenant info displays correctly
4. Verify rent price matches room config

### Test 2: Upload Payment Slip
1. Tenant app → Bills → Click bill
2. Click "ชำระเงิน" (Pay) → Select "อัปโหลดสลิป"
3. Upload sample slip image
4. Verify payment appears in history

### Test 3: Verify 12-Month Filter (Tenant App)
1. Tenant app → Bills tab
2. Count bills displayed - should be ≤ 12
3. Oldest should be ~12 months ago
4. Most recent should be current month

### Test 4: Verify 3-Year View (Dashboard)
1. Dashboard → Select room with 3 years of bills
2. Go to "📥 นำเข้ามิเตอร์" tab
3. View "ดูบิล" (View Bills)
4. Should show all bills from years 67, 68, 69

---

## Troubleshooting

### Bills not appearing in tenant app
1. Check Firebase Realtime Database has data
2. Hard refresh browser (Ctrl+Shift+R)
3. Check browser console for errors
4. Verify room number is correct in URL parameter

### Tenant data not syncing
1. Check Firestore rules allow authenticated writes
2. Verify user is logged in with admin account
3. Check browser console for Firebase errors
4. Verify data exists in localStorage before Firebase sync

### Upload page stuck on progress
1. Check browser console for error messages
2. Verify internet connection
3. Check Firebase project is accessible
4. Try small test upload (1-2 bills) first

---

## File Locations

- **Real Bills Data:** `real-bills-generated.json` (594 bills)
- **Admin Upload:** `admin-upload-bills.html`
- **Tenant App:** `tenant.html`
- **Dashboard:** `dashboard.html`
- **Manager Classes:**
  - `shared/tenant-config.js`
  - `shared/lease-config.js`
  - `shared/owner-config.js`
  - `shared/room-config.js`

---

## Next Steps

1. ✅ Upload 594 real bills via admin page
2. ✅ Test tenant app displays real bills
3. ✅ Add test tenant and verify data sync
4. ⏳ Extract months 4-12 of year 69 from Excel (if available)
5. ⏳ Generate and upload additional year 69 bills
6. ⏳ Implement payment verification workflow
7. ⏳ Test complete payment flow with receipt generation

---

## Support

- Firebase Realtime Database: `https://console.firebase.google.com`
- Firebase Firestore: `https://console.firebase.google.com`
- Project: `the-green-haven`
- Database: `the-green-haven-default-rtdb` (Realtime)
