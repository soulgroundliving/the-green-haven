# 🔧 IMPLEMENTATION GUIDE #1: KPI SUPPORT NEST BUILDING

**Task:** Add Nest building data to Overall page KPI (combine both buildings)
**Time:** 1-2 hours
**Difficulty:** Medium

---

## 📍 CURRENT CODE ISSUE

**File:** `dashboard.html`
**Current Problem:** Line 7782 only loads Rooms building
```javascript
loadFirestoreData('rooms')  // Only rooms!
```

---

## 🎯 STEP 1: MODIFY updateDashboardLive() FUNCTION

**Location:** Search for `function updateDashboardLive()` around line 5550

**Find this code:**
```javascript
async function updateDashboardLive() {
  try {
    // Load data for rooms building
    const roomsData = await loadFirestoreData('rooms');
    // ... rest of code
```

**Replace with this:**
```javascript
async function updateDashboardLive() {
  try {
    // Load data for BOTH buildings
    const roomsData = await loadFirestoreData('rooms');
    const nestData = await loadFirestoreData('nest');

    // Combine the data
    const combinedData = {
      rooms: roomsData,
      nest: nestData
    };

    // Calculate combined KPIs
    calculateCombinedKPIs(combinedData);
```

---

## 🎯 STEP 2: CREATE COMBINED KPI CALCULATION FUNCTION

**Add this new function** (near the updateDashboardLive function):

```javascript
function calculateCombinedKPIs(combinedData) {
  // Get data for both buildings
  const roomsRent = getRentTotal(combinedData.rooms) || 0;
  const nestRent = getNestRentTotal(combinedData.nest) || 0;

  // COMBINED KPI
  const totalRent = roomsRent + nestRent;
  const roomsElectric = getElectricityTotal(combinedData.rooms) || 0;
  const nestElectric = getNestElectricityTotal(combinedData.nest) || 0;
  const totalElectric = roomsElectric + nestElectric;

  const roomsWater = getWaterTotal(combinedData.rooms) || 0;
  const nestWater = getNestWaterTotal(combinedData.nest) || 0;
  const totalWater = roomsWater + nestWater;

  // Update KPI cards
  updateKPICards({
    totalRent: totalRent,
    roomsRent: roomsRent,
    nestRent: nestRent,
    totalElectric: totalElectric,
    totalWater: totalWater
  });
}

// Helper function to get Nest rent total
function getNestRentTotal(nestData) {
  if (!nestData) return 0;

  let total = 0;

  // Get all nest buildings
  if (nestData.nest && nestData.nest.building) {
    const building = nestData.nest.building;

    // Calculate rent for active units
    if (building.activeUnits && building.unitPrice) {
      total = building.activeUnits * building.unitPrice;
    }
  }

  return total;
}

// Helper function for Nest electricity
function getNestElectricityTotal(nestData) {
  if (!nestData) return 0;

  let total = 0;

  // Get electricity from nest projections or actual
  if (nestData.nestProjections && nestData.nestProjections.electricity) {
    total = nestData.nestProjections.electricity;
  }

  return total;
}

// Helper function for Nest water
function getNestWaterTotal(nestData) {
  if (!nestData) return 0;

  let total = 0;

  // Get water from nest projections or actual
  if (nestData.nestProjections && nestData.nestProjections.water) {
    total = nestData.nestProjections.water;
  }

  return total;
}
```

---

## 🎯 STEP 3: MODIFY KPI DISPLAY

**Find the KPI cards section** around line 2010:

**Current code:**
```html
<div class="kpi-card">
  <h3>🏠 ห้องแถว</h3>
  <p class="kpi-value" id="occupancy-rate">0</p>
</div>
```

**Replace with:**
```html
<!-- Combined Total -->
<div class="kpi-card">
  <h3>💰 รวมรายได้ต่อเดือน</h3>
  <p class="kpi-value" id="combined-rent">0 บาท</p>
  <small style="color: #666;">
    🏠 Rooms: <span id="rooms-rent-value">0</span> |
    🏢 Nest: <span id="nest-rent-value">0</span>
  </small>
</div>

<!-- Occupancy -->
<div class="kpi-card">
  <h3>🏠 ห้องแถว</h3>
  <p class="kpi-value" id="occupancy-rate">0</p>
</div>

<!-- Nest Occupancy -->
<div class="kpi-card">
  <h3>🏢 Nest Building</h3>
  <p class="kpi-value" id="nest-occupancy-rate">0</p>
</div>
```

---

## 🎯 STEP 4: UPDATE KPI CARD FUNCTION

**Find function** `updateKPICards()` and modify it:

```javascript
function updateKPICards(data) {
  // Combined Rent
  document.getElementById('combined-rent').textContent =
    formatCurrency(data.totalRent);
  document.getElementById('rooms-rent-value').textContent =
    formatCurrency(data.roomsRent);
  document.getElementById('nest-rent-value').textContent =
    formatCurrency(data.nestRent);

  // Electricity (combined)
  document.getElementById('electricity-usage').textContent =
    data.totalElectric + ' บาท';

  // Water (combined)
  document.getElementById('water-usage').textContent =
    data.totalWater + ' บาท';

  // Occupancy rates
  if (data.occupancyRooms !== undefined) {
    document.getElementById('occupancy-rate').textContent =
      data.occupancyRooms + '%';
  }

  if (data.occupancyNest !== undefined) {
    document.getElementById('nest-occupancy-rate').textContent =
      data.occupancyNest + '%';
  }
}

// Helper to format currency
function formatCurrency(value) {
  if (!value) return '0 บาท';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB'
  }).format(value);
}
```

---

## 🎯 STEP 5: UPDATE CHART TO SHOW COMBINED DATA

**Find the monthly chart section** around line 2200:

**Current code:**
```javascript
// Monthly rent data
const monthlyData = await getMonthlyRentData('rooms');
```

**Replace with:**
```javascript
// Monthly rent data from BOTH buildings
const roomsMonthly = await getMonthlyRentData('rooms');
const nestMonthly = await getMonthlyRentData('nest');

// Combine into one dataset
const combinedMonthly = combineMonthlyData(roomsMonthly, nestMonthly);

// Use combined data for chart
const monthlyData = combinedMonthly;
```

**Add this function:**
```javascript
function combineMonthlyData(roomsData, nestData) {
  // Combine arrays month by month
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const combined = [];

  for (let i = 0; i < 12; i++) {
    const roomsValue = roomsData[i]?.rent || 0;
    const nestValue = nestData[i]?.rent || 0;

    combined.push({
      month: months[i],
      rent: roomsValue + nestValue,
      rooms: roomsValue,
      nest: nestValue
    });
  }

  return combined;
}
```

---

## 🎯 STEP 6: CALL FUNCTION ON PAGE LOAD

**Find where updateDashboardLive() is called** around line 5540:

**Current:**
```javascript
updateDashboardLive();  // Loads only rooms
```

**This is already correct** - just make sure it's being called, and the new logic will use both buildings.

---

## ✅ TEST YOUR CHANGES

After implementing:

1. Open dashboard in browser
2. Check Overall page
3. Verify you see:
   - ✅ Combined rent total (Rooms + Nest)
   - ✅ Rooms rent value shown separately
   - ✅ Nest rent value shown separately
   - ✅ Both occupancy rates
   - ✅ Combined monthly chart

4. Test with:
   - Rooms building occupied
   - Nest building occupied
   - Mixed occupancy

---

## 🐛 TROUBLESHOOTING

**Problem:** Nest data showing as 0
- **Check:** Is Nest data structure in Firestore correct?
- **Check:** Are getNestRentTotal() functions getting correct data path?

**Problem:** Combined total wrong
- **Check:** Are both helper functions returning numbers?
- **Check:** Is formatCurrency() working?

**Problem:** KPI cards not updating
- **Check:** Are element IDs correct in updateKPICards()?
- **Check:** Is updateKPICards() being called?

---

## 📝 SUMMARY

**Changes made:**
- ✅ Load both 'rooms' and 'nest' building data
- ✅ Create combined KPI calculation
- ✅ Add display cards for both buildings separately + combined total
- ✅ Update charts to show combined data

**Files modified:** `dashboard.html` (around lines 2010, 5540, 7782)

**Ready for:** Real-time Firebase listeners next (Step 2)

