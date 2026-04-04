# 🔧 IMPLEMENTATION GUIDE #2: REAL-TIME FIREBASE LISTENERS

**Task:** Add real-time Firebase listeners to Room Information page
**Time:** 2-3 hours
**Difficulty:** Medium-High

---

## 📍 CURRENT CODE ISSUE

**File:** `dashboard.html`
**Current Problem:** Room Information page loads data once, requires refresh to see updates

**Location:** Room Information page (page-property), around line 2054

---

## 🎯 STEP 1: SET UP REAL-TIME LISTENER FOR ROOMS

**Find:** Search for `function loadPropertyPage()` or similar

**Add this code** (create a new listener function):

```javascript
// Real-time listener for rooms data
function setupRoomDataListener() {
  if (!db) {
    console.warn('Firebase not initialized');
    return;
  }

  // Listen to rooms building
  db.collection('buildings').doc('rooms').collection('rooms')
    .onSnapshot(
      (snapshot) => {
        // Update room data in real-time
        const rooms = [];

        snapshot.forEach((doc) => {
          rooms.push({
            id: doc.id,
            ...doc.data()
          });
        });

        // Update the UI immediately
        updateRoomUI(rooms);
        console.log('✅ Rooms updated in real-time:', rooms.length);
      },
      (error) => {
        console.error('❌ Error listening to rooms:', error);
      }
    );

  // Listen to nest building
  db.collection('buildings').doc('nest').collection('units')
    .onSnapshot(
      (snapshot) => {
        const units = [];

        snapshot.forEach((doc) => {
          units.push({
            id: doc.id,
            ...doc.data()
          });
        });

        updateNestUI(units);
        console.log('✅ Nest units updated in real-time:', units.length);
      },
      (error) => {
        console.error('❌ Error listening to nest units:', error);
      }
    );
}

// Function to update Room UI when data changes
function updateRoomUI(rooms) {
  // Get the room container element
  const container = document.getElementById('rooms-container') ||
                   document.getElementById('room-list') ||
                   document.querySelector('[data-room-list]');

  if (!container) {
    console.warn('Room container not found');
    return;
  }

  // Clear existing content
  container.innerHTML = '';

  // Rebuild room list
  rooms.forEach((room) => {
    const roomElement = createRoomElement(room);
    container.appendChild(roomElement);
  });

  console.log('✅ Room UI updated');
}

// Function to update Nest UI when data changes
function updateNestUI(units) {
  const container = document.getElementById('nest-container') ||
                   document.getElementById('nest-list') ||
                   document.querySelector('[data-nest-list]');

  if (!container) {
    console.warn('Nest container not found');
    return;
  }

  container.innerHTML = '';

  units.forEach((unit) => {
    const unitElement = createNestElement(unit);
    container.appendChild(unitElement);
  });

  console.log('✅ Nest UI updated');
}

// Create room element
function createRoomElement(room) {
  const div = document.createElement('div');
  div.className = 'room-card';
  div.innerHTML = `
    <h3>ห้อง ${room.roomNumber || room.id}</h3>
    <p>อาคาร: ห้องแถว</p>
    <p>สถานะ: ${room.occupied ? '✅ ผู้เช่า' : '❌ ว่าง'}</p>
    <p>ผู้เช่า: ${room.tenantName || 'ว่าง'}</p>
    <p>เช่าตั้งแต่: ${room.leaseStartDate || '-'}</p>
    ${room.leaseEndDate ? `<p>สิ้นสุด: ${room.leaseEndDate}</p>` : ''}
    <button onclick="editRoom('${room.id}')">แก้ไข</button>
  `;
  return div;
}

// Create nest element
function createNestElement(unit) {
  const div = document.createElement('div');
  div.className = 'unit-card';
  div.innerHTML = `
    <h3>หน่วย ${unit.unitNumber || unit.id}</h3>
    <p>อาคาร: Nest Building</p>
    <p>สถานะ: ${unit.occupied ? '✅ ผู้เช่า' : '❌ ว่าง'}</p>
    <p>ผู้เช่า: ${unit.tenantName || 'ว่าง'}</p>
    <p>เช่าตั้งแต่: ${unit.leaseStartDate || '-'}</p>
    ${unit.leaseEndDate ? `<p>สิ้นสุด: ${unit.leaseEndDate}</p>` : ''}
    <button onclick="editUnit('${unit.id}')">แก้ไข</button>
  `;
  return div;
}
```

---

## 🎯 STEP 2: LISTEN TO LEASE CHANGES

**Add listener for expiring leases** (new function):

```javascript
// Real-time listener for lease expiry alerts
function setupLeaseExpiryListener() {
  const today = new Date();

  // Listen to all leases
  db.collection('leases')
    .onSnapshot(
      (snapshot) => {
        const expiringLeases = [];

        snapshot.forEach((doc) => {
          const lease = doc.data();
          const endDate = new Date(lease.leaseEndDate);

          // Check if lease expires within 30 days
          const daysUntilExpiry = Math.ceil(
            (endDate - today) / (1000 * 60 * 60 * 24)
          );

          if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
            expiringLeases.push({
              id: doc.id,
              ...lease,
              daysLeft: daysUntilExpiry
            });
          }
        });

        // Update lease expiry alerts
        updateLeaseExpiryAlerts(expiringLeases);
      },
      (error) => {
        console.error('❌ Error listening to leases:', error);
      }
    );
}

function updateLeaseExpiryAlerts(leases) {
  const alertContainer = document.getElementById('lease-alerts') ||
                         document.getElementById('expiry-alerts');

  if (!alertContainer) return;

  alertContainer.innerHTML = '';

  if (leases.length === 0) {
    alertContainer.innerHTML = '<p>✅ ไม่มีสัญญาเช่าที่ใกล้หมดอายุ</p>';
    return;
  }

  leases.forEach((lease) => {
    const alert = document.createElement('div');
    alert.className = 'lease-alert warning';
    alert.innerHTML = `
      <strong>⚠️ ${lease.tenantName} - ห้อง ${lease.roomNumber}</strong>
      <p>หมดสัญญา: ${lease.leaseEndDate}</p>
      <p>เหลือ: <strong>${lease.daysLeft} วัน</strong></p>
    `;
    alertContainer.appendChild(alert);
  });

  console.log('✅ Lease expiry alerts updated');
}
```

---

## 🎯 STEP 3: LISTEN TO METER DATA CHANGES

**Add listener for real-time meter updates**:

```javascript
// Real-time listener for meter readings
function setupMeterDataListener() {
  // Listen to rooms meter data
  db.collection('meterReadings')
    .where('building', '==', 'rooms')
    .onSnapshot(
      (snapshot) => {
        const readings = [];

        snapshot.forEach((doc) => {
          readings.push({
            id: doc.id,
            ...doc.data()
          });
        });

        updateMeterDisplay(readings, 'rooms');
      },
      (error) => {
        console.error('❌ Error listening to meter data:', error);
      }
    );

  // Listen to nest meter data
  db.collection('meterReadings')
    .where('building', '==', 'nest')
    .onSnapshot(
      (snapshot) => {
        const readings = [];

        snapshot.forEach((doc) => {
          readings.push({
            id: doc.id,
            ...doc.data()
          });
        });

        updateMeterDisplay(readings, 'nest');
      }
    );
}

function updateMeterDisplay(readings, building) {
  console.log(`✅ ${building} meter data updated:`, readings.length);
  // Update UI with new meter readings
}
```

---

## 🎯 STEP 4: CALL LISTENERS ON PAGE LOAD

**Find where Room Information page is loaded** (around line 2054):

**Add this code:**

```javascript
// When showing property/room info page
if (pageId === 'page-property') {
  // Set up all real-time listeners
  setupRoomDataListener();
  setupLeaseExpiryListener();
  setupMeterDataListener();

  console.log('✅ All real-time listeners activated');
}
```

---

## 🎯 STEP 5: ADD REAL-TIME STATUS INDICATOR

**Add this HTML** (near the page title):

```html
<div style="display: flex; justify-content: space-between; align-items: center;">
  <h1>📊 ข้อมูลห้องพัก</h1>

  <!-- Real-time indicator -->
  <div id="realtime-status" style="font-size: 12px;">
    <span id="status-dot" style="
      width: 10px;
      height: 10px;
      background: green;
      border-radius: 50%;
      display: inline-block;
      margin-right: 5px;
    "></span>
    <span id="status-text">🔴 Disconnected</span>
  </div>
</div>
```

**Add this JavaScript** (to show connection status):

```javascript
function updateRealtimeStatus(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  if (connected) {
    dot.style.background = '#00cc00';
    text.textContent = '🟢 Real-time (Live)';
  } else {
    dot.style.background = '#cc0000';
    text.textContent = '🔴 Disconnected';
  }
}

// Call when listeners connect
updateRealtimeStatus(true);
```

---

## 🎯 STEP 6: ADD FALLBACK AUTO-REFRESH

**If real-time listeners fail**, add auto-refresh:

```javascript
// Fallback: Auto-refresh every 30 seconds if listeners fail
function setupAutoRefreshFallback() {
  setInterval(() => {
    // Check if listeners are still connected
    if (!db) {
      // Reconnect
      setupRoomDataListener();
      setupLeaseExpiryListener();
      setupMeterDataListener();
    }
  }, 30000); // Every 30 seconds
}
```

---

## ✅ COMPLETE IMPLEMENTATION CHECKLIST

- [ ] Add `setupRoomDataListener()` function
- [ ] Add `setupLeaseExpiryListener()` function
- [ ] Add `setupMeterDataListener()` function
- [ ] Add `updateRoomUI()` and `createRoomElement()` functions
- [ ] Add `updateNestUI()` and `createNestElement()` functions
- [ ] Add `updateLeaseExpiryAlerts()` function
- [ ] Call listeners when page-property is shown
- [ ] Add real-time status indicator HTML
- [ ] Add fallback auto-refresh
- [ ] Test: Open Room page → make changes in database → watch UI update in real-time

---

## 🧪 TEST YOUR IMPLEMENTATION

1. **Open dashboard** → Go to Room Information page
2. **Check status indicator** → Should show "🟢 Real-time (Live)"
3. **In another window:**
   - Open Firestore Console
   - Change a room's `occupied` status
   - Back in dashboard: Room UI updates automatically ✅
4. **Change meter data:**
   - Add new meter reading in Firestore
   - Dashboard updates automatically ✅
5. **Change lease:**
   - Update lease end date
   - Expiry alert updates automatically ✅

---

## 🐛 TROUBLESHOOTING

**Problem:** Status shows "🔴 Disconnected"
- **Fix:** Check Firebase authentication
- **Fix:** Check Firestore rules allow read access
- **Fix:** Check browser console for errors

**Problem:** UI not updating when data changes
- **Check:** Are container IDs correct?
- **Check:** Is onSnapshot() callback being called?
- **Check:** Are there JavaScript errors in console?

**Problem:** Too many updates/lag
- **Fix:** Add debouncing to updateRoomUI():
```javascript
let updateTimeout;
function updateRoomUI(rooms) {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    // Update logic
  }, 500); // Wait 500ms before updating
}
```

---

## 📝 SUMMARY

**Changes made:**
- ✅ Real-time Firebase listeners for rooms data
- ✅ Real-time listeners for lease data
- ✅ Real-time listeners for meter data
- ✅ Auto-update UI when data changes
- ✅ Real-time status indicator
- ✅ Fallback auto-refresh every 30 seconds

**Files modified:** `dashboard.html` (page-property section)

**Result:** Room Information page now updates in real-time without page refresh

