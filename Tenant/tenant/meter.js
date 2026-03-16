// ===== Meter Tracking System =====
// เมื่อเจ้าของบันทึกมิเตอร์ → ระบบ AUTO-GENERATE ทุกอย่าง

const NEST_ROOMS = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];

let currentRates = {
  water: 30,
  electric: 8.5
};

let meterInputs = {};

// ====== Initialize ======
function initMeterPage() {
  checkAdminAccess();
  loadRates();
  setDefaultMonth();
  renderMeterGrid();
  loadMeterData();
}

function checkAdminAccess() {
  // Get user from sessionStorage (set by login page)
  const userData = JSON.parse(sessionStorage.getItem('user') || '{}');

  console.log('🔐 Permission Check Debug:', {
    hasUserData: !!userData,
    email: userData.email,
    userType: userData.userType,
    fullData: userData
  });

  // If no user session at all, redirect to login
  if (!userData || !userData.email) {
    console.warn('⚠️ No user session found. Redirecting to login.');
    window.location.href = 'login.html';
    return;
  }

  // Simple admin check: if email exists and user logged in, allow access
  // (user had to authenticate through login to get here)
  const userEmail = (userData.email || '').toLowerCase();
  const userType = (userData.userType || '').toLowerCase();

  // Allow if: email contains 'admin' OR userType contains 'admin/owner/superadmin'
  const isAdmin = userEmail.includes('admin') ||
                  userType.includes('admin') ||
                  userType.includes('owner') ||
                  userType.includes('superadmin');

  if (!isAdmin) {
    console.warn('⚠️ User access denied. Email:', userData.email, 'Role:', userData.userType);
    alert(`⚠️ สิทธิ์ไม่เพียงพอ\nบัญชี: ${userData.email}\nบทบาท: ${userData.userType || 'unknown'}\n\nติดต่อแอดมินเพื่อขออนุญาต`);
    window.location.href = 'login.html';
    return;
  }

  console.log('✅ Admin access granted for:', userData.email);
}

function setDefaultMonth() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  document.getElementById('meterMonth').value = `${year}-${month}`;
}

// ====== Rates Management ======
function loadRates() {
  const savedRates = JSON.parse(localStorage.getItem('meterRates') || '{}');
  if (savedRates.water) currentRates.water = savedRates.water;
  if (savedRates.electric) currentRates.electric = savedRates.electric;

  document.getElementById('waterRate').value = currentRates.water;
  document.getElementById('electricRate').value = currentRates.electric;
}

function saveRates() {
  const waterRate = parseFloat(document.getElementById('waterRate').value);
  const electricRate = parseFloat(document.getElementById('electricRate').value);

  if (!waterRate || !electricRate || waterRate < 0 || electricRate < 0) {
    showAlert('❌ กรุณากรอกอัตราที่ถูกต้อง', 'warning');
    return;
  }

  currentRates.water = waterRate;
  currentRates.electric = electricRate;

  localStorage.setItem('meterRates', JSON.stringify(currentRates));
  showAlert('✅ บันทึกอัตราค่าธรรมชาติเรียบร้อย', 'success');
}

// ====== Render Meter Grid ======
function renderMeterGrid() {
  const grid = document.getElementById('meterGrid');
  grid.innerHTML = '';

  NEST_ROOMS.forEach(room => {
    const card = document.createElement('div');
    card.className = 'meter-card';
    card.id = `meter-${room}`;

    card.innerHTML = `
      <div class="room-number">ห้อง ${room}</div>

      <div class="meter-input-group">
        <label>💧 น้ำ (หน่วย)</label>
        <input type="number" placeholder="เลขมิเตอร์น้ำ" id="water-${room}"
               onchange="updateMeterCard('${room}')" step="1" min="0">
        <div class="meter-display" id="water-info-${room}">---</div>
      </div>

      <div class="meter-input-group">
        <label>⚡ ไฟ (หน่วย)</label>
        <input type="number" placeholder="เลขมิเตอร์ไฟ" id="electric-${room}"
               onchange="updateMeterCard('${room}')" step="1" min="0">
        <div class="meter-display" id="electric-info-${room}">---</div>
      </div>

      <span class="status-badge status-empty" id="status-${room}">ยังไม่บันทึก</span>
    `;

    grid.appendChild(card);
  });
}

// ====== Load Meter Data ======
function loadMeterData() {
  const meterMonth = document.getElementById('meterMonth').value;
  if (!meterMonth) return;

  const [year, month] = meterMonth.split('-');
  const monthKey = `${year}_${month}`;

  // Load previous month's data if available
  if (METER_DATA[monthKey]) {
    const prevData = METER_DATA[monthKey];

    NEST_ROOMS.forEach(room => {
      if (prevData[room]) {
        const data = prevData[room];
        document.getElementById(`water-${room}`).value = data.wNew;
        document.getElementById(`electric-${room}`).value = data.eNew;
        updateMeterCard(room);
      }
    });

    showAlert(`📂 โหลดข้อมูลจากเดือน ${monthKey} สำเร็จ`, 'info');
  }
}

function loadPreviousMonth() {
  const meterMonth = document.getElementById('meterMonth').value;
  if (!meterMonth) {
    showAlert('❌ เลือกเดือนก่อน', 'warning');
    return;
  }

  const [year, month] = meterMonth.split('-');
  let prevMonth = parseInt(month) - 1;
  let prevYear = parseInt(year);

  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear--;
  }

  const monthKey = `${prevYear}_${String(prevMonth).padStart(2, '0')}`;

  if (!METER_DATA[monthKey]) {
    showAlert('❌ ไม่มีข้อมูลจากเดือนที่แล้ว', 'warning');
    return;
  }

  const prevData = METER_DATA[monthKey];

  NEST_ROOMS.forEach(room => {
    if (prevData[room]) {
      const data = prevData[room];
      // Load old values as new values (previous month's current = this month's old)
      document.getElementById(`water-${room}`).value = data.wNew;
      document.getElementById(`electric-${room}`).value = data.eNew;
      updateMeterCard(room);
    }
  });

  showAlert(`📂 โหลดข้อมูลจากเดือน ${monthKey} สำเร็จ`, 'info');
}

// ====== Update Meter Card Display ======
function updateMeterCard(room) {
  const waterNewInput = document.getElementById(`water-${room}`);
  const electricNewInput = document.getElementById(`electric-${room}`);
  const waterNewValue = parseFloat(waterNewInput.value) || 0;
  const electricNewValue = parseFloat(electricNewInput.value) || 0;

  // Get previous month's data
  const meterMonth = document.getElementById('meterMonth').value;
  const [year, month] = meterMonth.split('-');
  const monthKey = `${year}_${month}`;

  let waterOld = 0, electricOld = 0;

  if (METER_DATA[monthKey] && METER_DATA[monthKey][room]) {
    waterOld = METER_DATA[monthKey][room].wOld;
    electricOld = METER_DATA[monthKey][room].eOld;
  }

  const waterUsed = waterNewValue - waterOld;
  const electricUsed = electricNewValue - electricOld;
  const waterCharge = waterUsed * currentRates.water;
  const electricCharge = electricUsed * currentRates.electric;
  const totalCharge = waterCharge + electricCharge;

  // Update display
  document.getElementById(`water-info-${room}`).innerHTML =
    `ใช้ ${waterUsed} หน่วย = ${waterCharge.toLocaleString('th-TH')} บาท`;

  document.getElementById(`electric-info-${room}`).innerHTML =
    `ใช้ ${electricUsed} หน่วย = ${electricCharge.toLocaleString('th-TH')} บาท`;

  // Update status
  const card = document.getElementById(`meter-${room}`);
  const status = document.getElementById(`status-${room}`);

  if (waterNewValue > 0 && electricNewValue > 0) {
    card.classList.add('filled');
    status.className = 'status-badge status-filled';
    status.textContent = `✅ พร้อม (${totalCharge.toLocaleString('th-TH')} บาท)`;
  } else {
    status.className = 'status-badge status-empty';
    status.textContent = 'ยังไม่บันทึก';
  }

  // Store in temp object
  meterInputs[room] = {
    waterNew: waterNewValue,
    electricNew: electricNewValue,
    waterOld: waterOld,
    electricOld: electricOld,
    waterUsed: waterUsed,
    electricUsed: electricUsed,
    waterCharge: waterCharge,
    electricCharge: electricCharge,
    totalCharge: totalCharge
  };
}

// ====== Submit All Meter Readings =====
async function submitMeterReadings() {
  const meterMonth = document.getElementById('meterMonth').value;
  if (!meterMonth) {
    showAlert('❌ กรุณาเลือกเดือน', 'warning');
    return;
  }

  // Validate all rooms filled
  const filledRooms = Object.keys(meterInputs).filter(room =>
    meterInputs[room].waterNew > 0 && meterInputs[room].electricNew > 0
  );

  if (filledRooms.length !== NEST_ROOMS.length) {
    showAlert(`❌ กรุณากรอกข้อมูลทั้งหมด (${filledRooms.length}/${NEST_ROOMS.length})`, 'warning');
    return;
  }

  // Calculate total
  let grandTotal = 0;
  Object.values(meterInputs).forEach(meter => {
    grandTotal += meter.totalCharge;
  });

  if (!confirm(`✅ ยืนยันบันทึกมิเตอร์เดือน ${meterMonth}\nรวมค่าธรรมชาติ: ${grandTotal.toLocaleString('th-TH')} บาท`)) {
    return;
  }

  try {
    showAlert('⏳ กำลังบันทึก...', 'info');

    // 1️⃣ Get tenant data
    const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');

    // 2️⃣ Create invoices for each tenant
    const invoices = JSON.parse(localStorage.getItem('invoices') || '[]');
    const [year, month] = meterMonth.split('-');
    const monthKey = `${year}_${month}`;
    const invoiceDate = new Date(year, month - 1, 1);
    const monthThaiName = getMonthNameThai(month);

    NEST_ROOMS.forEach(room => {
      const meter = meterInputs[room];
      const tenant = tenantData[room];

      // Create invoice
      const invoiceId = `INV-${room}-${monthKey}`;
      const existingIdx = invoices.findIndex(inv => inv.invoiceId === invoiceId);

      const invoice = {
        invoiceId: invoiceId,
        roomId: room,
        tenantName: tenant?.name || `ห้อง ${room}`,
        amount: meter.totalCharge,
        baseRent: tenant?.rentAmount || 0,
        waterUsed: meter.waterUsed,
        waterCharge: meter.waterCharge,
        electricUsed: meter.electricUsed,
        electricCharge: meter.electricCharge,
        month: monthKey,
        monthName: monthThaiName,
        year: year,
        date: invoiceDate.toISOString(),
        dueDate: new Date(year, month, 5).toISOString(),
        status: 'unpaid',
        createdAt: new Date().toISOString(),
        createdBy: JSON.parse(localStorage.getItem('currentUser')).email
      };

      if (existingIdx >= 0) {
        invoices[existingIdx] = invoice; // Update
      } else {
        invoices.push(invoice); // Create
      }

      // 3️⃣ Update tenant data with new invoice
      if (tenant) {
        tenant.lastInvoiceId = invoiceId;
        tenant.lastInvoiceAmount = meter.totalCharge;
        tenant.lastInvoiceDate = invoiceDate.toISOString();
        tenant.lastWaterUsed = meter.waterUsed;
        tenant.lastElectricUsed = meter.electricUsed;
      }
    });

    // Save to localStorage
    localStorage.setItem('invoices', JSON.stringify(invoices));
    localStorage.setItem('tenant_data', JSON.stringify(tenantData));

    // 4️⃣ Sync to Firebase
    const db = firebase.database();
    const userEmail = JSON.parse(localStorage.getItem('currentUser')).email.replace(/[.@]/g, '_');

    await db.ref(`users/${userEmail}/invoices`).set(invoices);
    await db.ref(`users/${userEmail}/meter_readings/${monthKey}`).set(meterInputs);

    // 5️⃣ Log audit
    logAudit('METER_RECORDED', {
      month: monthKey,
      roomsCount: NEST_ROOMS.length,
      totalCharges: grandTotal,
      readings: meterInputs
    });

    // 6️⃣ Show success
    showAlert(`✅ บันทึกมิเตอร์สำเร็จ! สร้างใบวางบิล ${NEST_ROOMS.length} ใบ`, 'success');
    setTimeout(() => {
      resetForm();
      renderMeterGrid();
    }, 1500);

  } catch (error) {
    console.error('Error:', error);
    showAlert(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'warning');
  }
}

// ====== Helper Functions ======
function getMonthNameThai(month) {
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return months[parseInt(month) - 1] || '';
}

function showAlert(message, type) {
  const alertBox = document.getElementById('alertBox');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertBox.innerHTML = '';
  alertBox.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 4000);
}

function resetForm() {
  NEST_ROOMS.forEach(room => {
    document.getElementById(`water-${room}`).value = '';
    document.getElementById(`electric-${room}`).value = '';
    document.getElementById(`status-${room}`).className = 'status-badge status-empty';
    document.getElementById(`status-${room}`).textContent = 'ยังไม่บันทึก';
    document.getElementById(`water-info-${room}`).innerHTML = '---';
    document.getElementById(`electric-info-${room}`).innerHTML = '---';
    document.getElementById(`meter-${room}`).classList.remove('filled');
  });
  meterInputs = {};
}

function goToDashboard() {
  window.location.href = 'dashboard.html';
}

function goToAccounting() {
  window.location.href = 'accounting.html';
}

function logout() {
  if (confirm('ต้องการออกจากระบบหรือไม่?')) {
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
  }
}

// Initialize on load
window.addEventListener('load', initMeterPage);
