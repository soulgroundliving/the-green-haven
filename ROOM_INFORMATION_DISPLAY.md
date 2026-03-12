# Room Information Display — Complete Tenant Details

## Overview

The room information display has been significantly enhanced to show **complete tenant information** directly in the compact room grid for both buildings (ห้องแถว and Nest).

## What's Displayed on Each Room Card

### Room Header
- **Room ID** (e.g., "15n", "N101")
- **Room Type** (Floor label for Nest, type badge for old building)
- **Occupancy Status** (สี่เหลี่ยมขนาดเล็ก: มีผู้เช่า ✅ or ว่าง 🚪)

### Tenant Information (When Occupied)
- **ชื่อ (Name):** Full name of tenant
- **โทร (Phone):** Contact phone number
- **เข้าพัก (Move-in date):** When tenant moved in (formatted as "MMM DD")
- **สัญญาสิ้นสุด (Contract End):** When contract expires (formatted as "MMM DD YY")
- **เหลือ (Days Remaining):** Number of days until contract expires
  - Color coded:
    - 🔴 **Red** = Less than 30 days (urgent)
    - 🟠 **Orange** = 30-60 days
    - 🟢 **Green** = More than 60 days

### Room Status (When Vacant)
- Shows "🚪 ไม่มีผู้เช่า" (No tenant) with centered text

### Room Rates
- **ค่าเช่า (Rent):** Monthly rent amount in bold

### Actions
- **📝 แก้ไข (Edit):** Opens tenant modal for editing

## Contract Expiry Summary

Below the room grid, there's a summary box showing:

### For ห้องแถว (Old Building)
```
📋 สรุปสัญญา (ห้องแถว)
⚠️ X ห้อง หมดภายใน 30 วัน
⏳ X ห้อง หมดใน 30-60 วัน
✅ X ห้องมีผู้เช่า
🚪 X ห้องว่าง
```

### For Nest (New Building)
```
📋 สรุปสัญญา (Nest)
⚠️ X ห้อง หมดภายใน 30 วัน
⏳ X ห้อง หมดใน 30-60 วัน
✅ X ห้องมีผู้เช่า
🚪 X ห้องว่าง
```

## Features

### 1. **Search Functionality**
- Search box: "🔍 ค้นหาห้อง..."
- Searches by:
  - Room ID (e.g., "15n" or "N101")
  - Tenant name (e.g., "สมชาย")
- Results update in real-time as you type

### 2. **Visual Indicators**
- Occupancy badges with color-coded backgrounds
- Expiry dates with color-coded days remaining
- Room type labels (Floor numbers for Nest)

### 3. **Responsive Layout**
- Grid layout adapts to screen size
- Cards maintain consistent width and spacing
- Works on mobile, tablet, and desktop

### 4. **Quick Reference**
- All essential tenant info visible without opening modal
- No need to click to see:
  - Tenant name
  - Contact phone
  - Contract end date
  - Days remaining

## Buildings Supported

### ห้องแถว (Old Building)
- 22 rooms (1-27 including Amazon)
- Shows room ID, occupancy, tenant name, phone, dates
- Contract expiry tracking for all occupied rooms

### Nest (New Building)
- 20 rooms (N101-N105, N201-N205, N301-N305, N401-N405)
- Shows floor labels (ชั้น 1-4)
- Room types: Studio (🏠), Pet Friendly (🐾), Daily (📅)
- Identical tenant information display

## Data Structure

### Room Data for Old Building (ROOMS_OLD)
```javascript
{
  id: "15",
  type: "room",
  rent: 1200,
  elecRate: 8,
  trashFee: 20,
  note: "..."
}
```

### Room Data for Nest (NEST_ROOMS)
```javascript
{
  id: "N101",
  floor: 1,
  type: "daily",    // 'daily', 'studio', 'pet'
  rent: 5600,
  deposit: 3000
}
```

### Tenant Data (tenant_data)
```javascript
{
  name: "สมชาย ใจดี",
  phone: "081-234-5678",
  lineID: "somchai.jai",
  moveInDate: "2025-01-15",
  contractEnd: "2026-01-14",
  deposit: 3000,
  notes: "..."
}
```

## How to Use

### View Room Information
1. Navigate to **Property** → **ห้องแถว** or **Nest**
2. Scroll to **"รายชื่อห้องพัก (ตารางกระทัดรัด)"**
3. All room cards display with tenant information

### Search for a Room
1. Use the search box: 🔍 ค้นหาห้อง...
2. Type room ID (e.g., "15n", "N202")
3. Grid filters to matching rooms
4. Clear search to see all rooms

### Search for a Tenant
1. Use the search box
2. Type tenant name (e.g., "สมชาย")
3. Grid shows only rooms with that tenant

### Edit Tenant Information
1. Click the **📝 แก้ไข** button on any room card
2. Modal opens with full editing interface
3. Make changes and save
4. Card updates automatically with new information

### Monitor Contract Expiry
1. Look for **red dates** (< 30 days) - urgent renewal needed
2. Look for **orange dates** (30-60 days) - plan ahead
3. Check summary box for count of expiring contracts
4. Sort by expiry date if needed (coming soon)

## Technical Implementation

### Functions

#### `renderCompactRoomGrid()` - Old Building
- Loads tenant data
- Filters rooms based on search term
- Calculates days remaining for contracts
- Colors expiry dates (red/orange/green)
- Generates contract expiry summary

#### `renderNestCompactGrid()` - New Building
- Identical logic to old building version
- Works with NEST_ROOMS data
- Shows floor labels instead of type badges
- Calculates occupancy statistics

#### `initNestPage()` - Initialize Nest Page
- Calls renderNestCompactGrid()
- Attaches search event listener
- Called when Nest page is loaded

### Data Persistence
- All changes saved to `tenant_data` in localStorage
- Data synced to Firebase
- Grid refreshes after modal saves
- Search results reflect latest data

## CSS Styling

### Compact Card Layout
- **Header:** Room ID, type/floor, occupancy badge
- **Tenant Info:** Name, phone, dates with icons
- **Status Line:** Days remaining with color coding
- **Rent Line:** Separated by border
- **Action:** Edit button

### Color Scheme
- **Occupied:** Green badges (var(--green-pale))
- **Vacant:** Purple badges (#f3e5f5)
- **Urgent:** Red text for < 30 days (var(--red))
- **Caution:** Orange text for 30-60 days (var(--orange))
- **Safe:** Green text for > 60 days (var(--green-dark))

## Future Enhancements

1. **Sorting**
   - Sort by contract expiry date
   - Sort by occupancy status
   - Sort by room number

2. **Filtering**
   - Filter by status (occupied/vacant)
   - Filter by expiry urgency
   - Filter by room type

3. **Bulk Operations**
   - Select multiple rooms
   - Bulk edit operations
   - Export to CSV

4. **Analytics**
   - Occupancy rate dashboard
   - Revenue projection
   - Expiry timeline visualization

5. **Notifications**
   - Alert when contract within 30 days
   - Email reminders
   - SMS notifications

## Testing

### Visual Verification
- [ ] Room cards display with complete tenant info
- [ ] Occupancy badges show correct status
- [ ] Dates format correctly (MMM DD / MMM DD YY)
- [ ] Days remaining calculated accurately
- [ ] Color coding matches expiry urgency
- [ ] Summary box shows correct counts

### Functional Testing
- [ ] Search filters by room ID
- [ ] Search filters by tenant name
- [ ] Edit button opens modal
- [ ] Modal saves update grid
- [ ] Vacant rooms show placeholder
- [ ] Both buildings display correctly

### Data Testing
- [ ] Tenant data persists to localStorage
- [ ] Firebase sync works
- [ ] Grid updates after modal save
- [ ] Search reflects latest data

---

**Deployed:** March 12, 2026
**Commit:** a031826
**Status:** ✅ Live on Vercel
**Coverage:** ห้องแถว + Nest buildings
