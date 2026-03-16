# Testing Guide — Dashboard Navigation Restructure

## Quick Verification Checklist

### ✅ Sidebar Navigation
- [ ] Navigate to The Green Haven dashboard
- [ ] Verify **NO "People"** group in sidebar
- [ ] Confirm **"Property"** group shows:
  - [ ] 🏠 ห้องแถว (Old Building)
  - [ ] 🏗️ Nest (New Building)
- [ ] Verify no sidebar link to tenant management page

### ✅ Room Floor Plan (ห้องแถว)
- [ ] Click "Property" → "ห้องแถว"
- [ ] Verify floor plan cards display:
  - [ ] Room number (e.g., "1", "15", "Amazon")
  - [ ] Rent amount (e.g., "฿1,200/เดือน")
  - [ ] Tenant status (✅ name OR 🚪 ว่าง)
- [ ] **Click any room card**
  - [ ] Modal opens with room info
  - [ ] Modal closes on X button or outside click
  - [ ] No errors in browser console

### ✅ Compact Grid View
- [ ] In "ห้องแถว" page, verify compact grid shows:
  - [ ] Room number
  - [ ] Room type (🏠 ที่พัก or 🏪 พาณิชย์)
  - [ ] **Occupancy status** (ผู้เช่า row with ✅ name OR 🚪 ว่าง)
  - [ ] Rent amount
  - [ ] Electricity rate
  - [ ] Water rate
  - [ ] Trash fee
  - [ ] Edit and View buttons
- [ ] Click "📝 แก้ไข" button
  - [ ] Modal opens with selected room
  - [ ] Tenant data populated (if exists)

### ✅ Tenant Modal
- [ ] Modal displays with:
  - [ ] **Header:** "📋 ข้อมูลห้อง & ผู้เช่า"
  - [ ] **Room Status Box:** Room number, status badge, type, rent
  - [ ] **Occupancy Badge:** "มีผู้เช่า" or "ว่าง" with color
  - [ ] **All Input Fields:**
    - [ ] ชื่อ-นามสกุล (Name)
    - [ ] เบอร์โทรศัพท์ (Phone)
    - [ ] Line ID
    - [ ] วันเข้าพัก (Move-in date)
    - [ ] สัญญาสิ้นสุด (Contract end)
    - [ ] มัดจำ (Deposit)
    - [ ] หมายเหตุ (Notes)
  - [ ] **Action Buttons:**
    - [ ] 💾 บันทึก (Save button, green)
    - [ ] ปิด (Close button, gray)

### ✅ Tenant Data Management
- [ ] **Add new tenant:**
  - [ ] Open modal for vacant room (shows 🔴 ว่าง)
  - [ ] Fill in tenant information
  - [ ] Click "บันทึก"
  - [ ] Alert shows "✅ บันทึกข้อมูลสำเร็จ"
  - [ ] Modal closes
  - [ ] Room card updated to show tenant name (✅ [Name])
- [ ] **Edit existing tenant:**
  - [ ] Open modal for occupied room
  - [ ] Verify all fields pre-filled with current data
  - [ ] Modify a field (e.g., phone number)
  - [ ] Click "บันทึก"
  - [ ] Alert shows success
  - [ ] Changes persist (refresh page and verify)
- [ ] **Remove tenant (empty name):**
  - [ ] Open tenant modal
  - [ ] Clear name field (leave blank)
  - [ ] Click "บันทึก"
  - [ ] Room card changes to 🚪 ว่าง
  - [ ] Modal shows 🔴 ว่าง status on reopen

### ✅ Data Persistence
- [ ] **Verify localStorage:**
  - [ ] Open browser DevTools (F12)
  - [ ] Go to Application → LocalStorage
  - [ ] Find `tenant_data` key
  - [ ] Verify JSON contains recently added/edited room data
- [ ] **Verify Firebase (if enabled):**
  - [ ] Check Firebase Console
  - [ ] Navigate to `data/tenants` path
  - [ ] Confirm room data synced

### ✅ New Building (Nest)
- [ ] Click "Property" → "Nest"
- [ ] Verify floor plan displays all 4 floors
- [ ] **Click any room pill** (should have room ID like 101, 202, etc.)
  - [ ] Modal opens correctly
  - [ ] Room type shows correctly (Studio/Pet Friendly)
  - [ ] Rent amount correct (5,600 or 5,900)
- [ ] Verify all 20 rooms are clickable
- [ ] Test modal on multiple floors (Floor 1, 2, 3, 4)

### ✅ Dashboard Integration
- [ ] Go to Dashboard (main page)
- [ ] Find "อัตราการเช่า (ห้องแถว)" KPI card
- [ ] **Click KPI card**
  - [ ] Navigate to "ห้องแถว" page (NOT old tenant page)
  - [ ] Verify correct page loads

### ✅ Compact Grid Search
- [ ] In room list, use search box "🔍 ค้นหาห้อง..."
- [ ] Type room number (e.g., "15")
  - [ ] Grid filters to matching rooms
- [ ] Type partial match (e.g., "1")
  - [ ] Shows all rooms containing "1"
- [ ] Type tenant name (e.g., "สมชาย")
  - [ ] Grid filters by name
- [ ] Clear search
  - [ ] All rooms reappear

### ✅ Browser Compatibility
- [ ] Test on Chrome/Edge (Chromium)
  - [ ] Modal styling correct
  - [ ] All buttons functional
- [ ] Test on Firefox
  - [ ] Modal displays properly
- [ ] Test on Mobile (if available)
  - [ ] Modal responsive (90% width)
  - [ ] All inputs accessible
  - [ ] Modal scrollable if needed

## Advanced Testing

### 🔍 Console Checks
1. Open DevTools (F12)
2. Go to Console tab
3. When performing actions, verify:
   - [ ] No JavaScript errors (red messages)
   - [ ] No warnings relevant to modal
   - [ ] AuditLogger messages show (if enabled)

### 📊 Firebase Sync
1. Open Firebase Console
2. Navigate to Realtime Database
3. Check path: `data/tenants`
4. Verify structure:
```json
{
  "1": {
    "name": "สมชาย...",
    "phone": "081...",
    "lineID": "...",
    "moveInDate": "2025-01-15",
    "contractEnd": "2026-01-14",
    "deposit": 3000,
    "notes": "..."
  }
}
```

### 🔄 Refresh/Persistence Test
1. Add/edit a tenant
2. Click browser refresh (F5)
3. Navigate back to same room
4. Open modal for that room
5. Verify data still present and unchanged
6. Repeat for different rooms

### ⚠️ Edge Cases

#### Empty Tenant
- [ ] Open modal for room with no tenant
- [ ] Name field is empty
- [ ] Save without entering name
- [ ] Room shows 🚪 ว่าง

#### Missing Fields
- [ ] Fill only name field, leave others blank
- [ ] Save successfully
- [ ] Missing fields don't cause errors
- [ ] Only name shows in room card

#### Special Characters
- [ ] Enter Thai name with special characters
- [ ] Enter phone with dashes (081-234-5678)
- [ ] Enter notes with line breaks
- [ ] Save and verify display

#### Date Formats
- [ ] Enter dates in YYYY-MM-DD format
- [ ] Save and verify persistence
- [ ] Different dates for move-in and contract end
- [ ] Contract end before today still saves

#### Large Numbers
- [ ] Enter high deposit (999,999)
- [ ] Enter future contract dates (year 2099)
- [ ] Verify no truncation or errors

### 🎨 Visual Verification

#### Modal Appearance
- [ ] Modal background is dark overlay (not pure black)
- [ ] Modal content centered on screen
- [ ] Modal has rounded corners
- [ ] Modal has shadow effect
- [ ] Close button (✕) visible and clickable

#### Color Coding
- [ ] Occupied room: 🟢 ว่าง (green) → 🟢 มีผู้เช่า (green)
- [ ] Vacant room: 🔴 ว่าง (red/dark) with blue badge
- [ ] Status changes color based on occupancy
- [ ] Save button is green
- [ ] Close button is gray

#### Form Styling
- [ ] Input fields have proper borders
- [ ] Focus state shows blue outline
- [ ] Labels are readable
- [ ] Fields are properly spaced
- [ ] Textarea is resizable

## Troubleshooting

### Issue: Modal doesn't open
1. Check browser console for JavaScript errors
2. Verify `openTenantModal()` function exists
3. Verify modal element `#tenantModal` exists
4. Check Z-index (should be 9999)

### Issue: Data not saving
1. Check localStorage `tenant_data` key
2. Verify JSON is valid (DevTools → Application → LocalStorage)
3. Check browser allows localStorage
4. Check Firebase connection status

### Issue: Room names not showing
1. Verify `loadTenants()` function works
2. Check localStorage key is `tenant_data` (not `tenantData`)
3. Open DevTools console and run:
   ```javascript
   loadTenants()  // Should show tenant object
   ```

### Issue: Modal styling broken
1. Verify CSS variables exist in `:root`
2. Check for CSS conflicts
3. Verify modal has `style="display:flex"` when opened
4. Check for z-index conflicts with other modals

### Issue: Close button not working
1. Verify `closeTenantModal()` function exists
2. Check onclick handler is `onclick="closeTenantModal()"`
3. Verify function sets `display:none`

## Performance Testing

- [ ] Modal opens within 300ms
- [ ] Data saves and persists within 1 second
- [ ] Page refresh shows saved data within 500ms
- [ ] Compact grid renders 20+ cards without lag
- [ ] Search filters respond in <100ms
- [ ] No memory leaks when opening/closing modal multiple times

## Regression Testing

Ensure existing features still work:
- [ ] Bill generation still works
- [ ] Payment verification still works
- [ ] Monthly reports still work
- [ ] Maintenance system still works
- [ ] Occupancy analytics still works
- [ ] Accounting module still works

## Sign-off Checklist

- [ ] All tests pass
- [ ] No console errors
- [ ] Data persists correctly
- [ ] Modal styling correct
- [ ] Navigation restructured as intended
- [ ] No regression in other features
- [ ] Ready for production

---

**Test Date:** _______________
**Tested By:** _______________
**Browser/Version:** _______________
**Notes:**

___________________________________________________________________
___________________________________________________________________
___________________________________________________________________

**Result:** ☐ PASS ☐ FAIL ☐ PARTIAL

**Sign-off:** ___________________ Date: _______________
