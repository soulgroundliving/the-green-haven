# ✅ Verification Checklist

Complete this checklist after uploading bills to verify everything works correctly.

---

## Phase 1: Upload Completion

- [ ] Admin upload page loads without errors
- [ ] Upload completes successfully (100% progress bar)
- [ ] Success summary shows: 22 rooms, 594 bills
- [ ] No error messages in console (F12)
- [ ] Takes 1-2 minutes to complete

**Time: 5 minutes**

---

## Phase 2: Tenant App Bill Display

- [ ] Tenant app loads at `http://localhost:8000/tenant.html?room=13`
- [ ] Can navigate to Bills (💳) tab
- [ ] Bills list shows real bills (NOT the mock 6 bills with ฿2,160)
- [ ] Bill amounts vary between bills (not all same amount)
- [ ] See at least 3-6 bills displayed
- [ ] Most recent bill month is current or recent past
- [ ] Bills sorted by month (newest first)

**Expected:** Different amounts like:
- ฿20,796 (Jan 2567)
- ฿22,576 (Jan 2567)
- ฿1,248 (Jan 2567)
- Not all ฿2,160

**Time: 3 minutes**

---

## Phase 3: Invoice/Bill Details

- [ ] Click on first bill to open invoice view
- [ ] Invoice header shows: Room, Year, Month
- [ ] Meter readings section displays:
  - Water: previous/current/usage
  - Electric: previous/current/usage
- [ ] Charges breakdown shows:
  - Rent (e.g., ฿1,500)
  - Water (e.g., ฿19,420)
  - Electric (e.g., ฿136)
  - Common (e.g., ฿0)
  - Trash (e.g., ฿40)
- [ ] Total charge equals sum of all charges
- [ ] No NaN or undefined values shown

**Time: 2 minutes**

---

## Phase 4: 12-Month Filter (Tenant App)

- [ ] Go to Bills tab in tenant app
- [ ] Count total bills shown: should be ≤ 12
- [ ] Oldest bill date: approximately 12 months ago
- [ ] Most recent bill date: within last 3 months
- [ ] Bills for different buildings show correctly
  - Room 13 (rooms): shows rooms building bills
  - Room N101 (nest): shows nest building bills

**Time: 2 minutes**

---

## Phase 5: Dashboard Tenant Management

### Owner Info Page
- [ ] Dashboard loads without errors
- [ ] Can navigate to Management → Owner Info
- [ ] Form displays with fields: name, ID, phone, email, address, tax ID, bank info
- [ ] Can fill in owner data
- [ ] Can save owner info
- [ ] Success message appears
- [ ] Data persists after page refresh

**Time: 2 minutes**

### Tenant Master Page
- [ ] Navigate to Management → Tenant Master
- [ ] Building selector displays (rooms/nest)
- [ ] Can select different building (changes displayed tenants)
- [ ] Add tenant form displays
- [ ] Can fill tenant info: ID, name, phone, email, address
- [ ] Can click "เพิ่มผู้เช่า" button
- [ ] Success message shows: "✅ เพิ่มผู้เช่า [name] สำเร็จ"
- [ ] New tenant appears in list
- [ ] Can delete tenant from list
- [ ] Tenant remains after page refresh

**Time: 3 minutes**

### Lease Agreements Page
- [ ] Navigate to Management → Lease Agreements
- [ ] Can create new lease
- [ ] Can select building, room, tenant
- [ ] Can set move-in date, rent, deposit
- [ ] Can save lease
- [ ] Lease appears in table
- [ ] Can view lease history for room
- [ ] Lease persists after refresh

**Time: 3 minutes**

---

## Phase 6: Firebase Sync Verification

### localStorage Check (Browser DevTools)
- [ ] Open DevTools (F12)
- [ ] Go to Application → Local Storage → http://localhost:8000
- [ ] Find key: `tenant_master_data`
  - [ ] Contains building structure: `{"rooms": {...}, "nest": {...}}`
  - [ ] Contains tenant data under building
- [ ] Find key: `lease_agreements_data`
  - [ ] Contains lease data organized by building
- [ ] Find key: `owner_info`
  - [ ] Contains owner details
- [ ] Find key: `rooms_config_rooms`, `rooms_config_nest`
  - [ ] Contains room configurations

**Time: 3 minutes**

### Firebase Firestore Check (Firebase Console)
- [ ] Open https://console.firebase.google.com
- [ ] Select project: `the-green-haven`
- [ ] Go to Firestore Database
- [ ] Navigate to collection: `tenants`
  - [ ] Subfolder: `rooms` (contains room tenants)
  - [ ] Subfolder: `nest` (contains nest tenants)
  - [ ] Each has `list` subfolder with tenant documents
- [ ] Navigate to collection: `leases`
  - [ ] Similar structure with lease documents
- [ ] Navigate to document: `owner_info/main`
  - [ ] Contains owner details

**Time: 5 minutes**

### Firebase Realtime Database Check
- [ ] Go to Realtime Database in Firebase Console
- [ ] Navigate to: `bills` → `rooms` → `13`
  - [ ] Shows multiple bill IDs
  - [ ] Each bill has: charges, meterReadings, totalCharge, status, billDate
- [ ] Navigate to: `bills` → `nest` → `N101`
  - [ ] Shows bills for that room

**Time: 3 minutes**

---

## Phase 7: Data Consistency

- [ ] Same tenant appears in all three storage layers:
  1. localStorage (DevTools)
  2. Firestore (Firebase Console)
  3. Visible in Dashboard list
- [ ] Same bill amounts appear in all viewing contexts:
  1. Tenant app Bills tab
  2. Invoice detail view
  3. Firebase database
- [ ] Building isolation verified:
  - [ ] Room tenants don't appear in Nest building data
  - [ ] Nest tenants don't appear in Room building data
  - [ ] Can't accidentally mix data between buildings

**Time: 3 minutes**

---

## Phase 8: Error-Free Operation

### Browser Console Check
```
F12 → Console Tab
Verify NO errors of type:
```
- [ ] ❌ No `Cannot read property of undefined` errors
- [ ] ❌ No Firebase connection errors
- [ ] ❌ No `TenantConfigManager is not defined` errors
- [ ] ❌ No `#REF!`, `#DIV/0!`, or formula errors
- [ ] ✅ See success messages: `✅ Loaded X bills`, etc.
- [ ] ✅ See sync messages: `✅ Data synced to Firebase`

**Time: 2 minutes**

---

## Phase 9: Cross-Building Isolation

- [ ] Test Room 13 (rooms building)
  - [ ] Shows correct building bills
  - [ ] Shows correct rent (1500 ฿)
- [ ] Test Room N101 (nest building)
  - [ ] Shows correct building bills
  - [ ] Shows correct rent (4500 ฿)
- [ ] No mixed data appears
- [ ] Building selector in dashboard works

**Time: 2 minutes**

---

## Phase 10: 3-Year Dashboard View

- [ ] Open Dashboard
- [ ] Select a room with full data
- [ ] View bills section
- [ ] Should show bills from:
  - [ ] Year 67 (2567): 12 months
  - [ ] Year 68 (2568): 12 months
  - [ ] Year 69 (2569): 3 months (Jan-Mar)
- [ ] Total: 27 bills shown
- [ ] All years display without filtering

**Time: 2 minutes**

---

## Final Verification

### Summary Checklist
- [ ] ✅ 594 bills uploaded to Firebase
- [ ] ✅ Tenant app shows real bills (12-month view)
- [ ] ✅ Dashboard shows 3-year history
- [ ] ✅ Can manage tenants in dashboard
- [ ] ✅ Can create leases
- [ ] ✅ Data syncs to Firebase
- [ ] ✅ localStorage persists data
- [ ] ✅ No console errors
- [ ] ✅ Building isolation works
- [ ] ✅ All 22 rooms accessible

---

## Total Verification Time
```
Phase 1: 5 minutes (upload)
Phase 2: 3 minutes (bill display)
Phase 3: 2 minutes (invoice details)
Phase 4: 2 minutes (12-month filter)
Phase 5: 8 minutes (tenant management)
Phase 6: 11 minutes (Firebase verification)
Phase 7: 3 minutes (data consistency)
Phase 8: 2 minutes (error checking)
Phase 9: 2 minutes (cross-building)
Phase 10: 2 minutes (3-year view)
─────────────────
Total: ~40 minutes (thorough check)
Quick: ~15 minutes (essential checks only)
```

---

## If All Checks Pass ✅
System is ready for:
- Tenant app daily use
- Payment workflow testing
- Maintenance ticket system
- Next phase development

---

## If Any Check Fails ❌
Reference troubleshooting in QUICKSTART.md or SETUP_REAL_DATA.md
