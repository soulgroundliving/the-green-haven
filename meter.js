// ===== ENHANCED METER SYSTEM =====
// The Green Haven - Admin Meter Management System
// Handles meter readings, bill generation, and utility tracking

const NEST_ROOMS = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];

let currentMonth = '';
let meterInputs = {};
let anomalies = [];
let currentRates = { water: 18, electric: 7 };

// ===== INITIALIZATION =====

function initMeterPage() {
  // checkAdminAccess();  // Removed - allow all authenticated users
  loadRates();
  setDefaultMonth();
  loadMeterData();
  renderMeterGrid();
  attachEventListeners();
}

function checkAdminAccess() {
  // Permission check completely disabled - allow all authenticated users
  console.log('✅ Permission check skipped');
}

function setDefaultMonth() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  currentMonth = `${year}-${month}`;
  document.getElementById('meterMonth').value = currentMonth;
}

// ===== RATE MANAGEMENT =====

function loadRates() {
  const meterRates = JSON.parse(localStorage.getItem('meterRates') || '{}');

  if (meterRates.current) {
    currentRates = meterRates.current;
  } else {
    currentRates = {
      water: meterRates.water || 18,
      electric: meterRates.electric || 7
    };
  }

  document.getElementById('waterRate').value = currentRates.water || 18;
  document.getElementById('electricRate').value = currentRates.electric || 7;
}

function saveRates() {
  const waterRate = parseFloat(document.getElementById('waterRate').value);
  const electricRate = parseFloat(document.getElementById('electricRate').value);

  // Validation
  if (!waterRate || !electricRate || waterRate < 0 || electricRate < 0) {
    showAlert('❌ กรุณากรอกอัตราที่ถูกต้อง', 'warning');
    return;
  }

  currentRates = { water: waterRate, electric: electricRate };

  const meterRates = {
    current: {
      water: waterRate,
      electric: electricRate,
      effectiveDate: new Date().toISOString()
    },
    history: JSON.parse(localStorage.getItem('meterRates') || '{}').history || []
  };

  // Add to history
  const prevRates = JSON.parse(localStorage.getItem('meterRates') || '{}').current;
  if (prevRates && (prevRates.water !== waterRate || prevRates.electric !== electricRate)) {
    if (prevRates.effectiveDate) {
      prevRates.endDate = new Date().toISOString();
      meterRates.history.unshift(prevRates);
    }
  }

  localStorage.setItem('meterRates', JSON.stringify(meterRates));
  logAudit('METER_RATES_UPDATED', {
    waterRate: waterRate,
    electricRate: electricRate,
    effectiveDate: new Date().toISOString()
  });

  showAlert('✅ บันทึกอัตราค่าธรรมชาติเรียบร้อย', 'success');
}

// ===== METER GRID RENDERING =====

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
        <label>💧 น้ำ ปัจจุบัน</label>
        <input type="number" placeholder="ปัจจุบัน" id="water-current-${room}"
               onchange="updateMeterCard('${room}')" step="1" min="0" class="meter-input">
        <small id="water-prev-${room}" style="color: #6b7a8d;">เดิม: ---</small>
        <div class="meter-display" id="water-info-${room}">---</div>
      </div>

      <div class="meter-input-group">
        <label>⚡ ไฟ ปัจจุบัน</label>
        <input type="number" placeholder="ปัจจุบัน" id="electric-current-${room}"
               onchange="updateMeterCard('${room}')" step="1" min="0" class="meter-input">
        <small id="electric-prev-${room}" style="color: #6b7a8d;">เดิม: ---</small>
        <div class="meter-display" id="electric-info-${room}">---</div>
      </div>

      <span class="status-badge status-empty" id="status-${room}">ยังไม่บันทึก</span>
    `;

    grid.appendChild(card);
  });
}

function updateMeterCard(room) {
  const waterCurrent = parseFloat(document.getElementById(`water-current-${room}`).value) || 0;
  const electricCurrent = parseFloat(document.getElementById(`electric-current-${room}`).value) || 0;

  const monthKey = getMonthKey(currentMonth);
  const readings = getMeterReadings(monthKey);

  let waterPrev = readings[room]?.previousWater || 0;
  let electricPrev = readings[room]?.previousElectric || 0;

  // Get previous month's values if available
  const prevMonthKey = getPreviousMonthKey(monthKey);
  const prevReadings = getMeterReadings(prevMonthKey);
  if (prevReadings[room]) {
    waterPrev = prevReadings[room].currentWater || waterPrev;
    electricPrev = prevReadings[room].currentElectric || electricPrev;
  }

  // Update display
  document.getElementById(`water-prev-${room}`).textContent = `เดิม: ${waterPrev}`;
  document.getElementById(`electric-prev-${room}`).textContent = `เดิม: ${electricPrev}`;

  // Calculate usage
  const waterUsage = calculateWaterUsage(waterCurrent, waterPrev);
  const electricUsage = calculateElectricUsage(electricCurrent, electricPrev);

  if (waterUsage === null) {
    document.getElementById(`water-info-${room}`).innerHTML = `⚠️ ค่าน้ำต้องมากกว่า ${waterPrev}`;
  } else {
    const waterCharge = calculateWaterCharge(waterUsage, currentRates.water);
    document.getElementById(`water-info-${room}`).innerHTML =
      `ใช้ ${waterUsage} หน่วย = ${formatCurrency(waterCharge)}`;
  }

  if (electricUsage === null) {
    document.getElementById(`electric-info-${room}`).innerHTML = `⚠️ ค่าไฟต้องมากกว่า ${electricPrev}`;
  } else {
    const electricCharge = calculateElectricCharge(electricUsage, currentRates.electric);
    document.getElementById(`electric-info-${room}`).innerHTML =
      `ใช้ ${electricUsage} หน่วย = ${formatCurrency(electricCharge)}`;
  }

  // Update status and save to temp object
  const card = document.getElementById(`meter-${room}`);
  const status = document.getElementById(`status-${room}`);

  if (waterCurrent > 0 && electricCurrent > 0) {
    card.classList.add('filled');

    if (waterUsage !== null && electricUsage !== null) {
      const waterCharge = calculateWaterCharge(waterUsage, currentRates.water);
      const electricCharge = calculateElectricCharge(electricUsage, currentRates.electric);
      const totalCharge = waterCharge + electricCharge;

      status.className = 'status-badge status-filled';
      status.textContent = `✅ ${formatCurrency(totalCharge)}`;

      meterInputs[room] = {
        waterCurrent: waterCurrent,
        electricCurrent: electricCurrent,
        waterPrev: waterPrev,
        electricPrev: electricPrev,
        waterUsage: waterUsage,
        electricUsage: electricUsage,
        waterCharge: waterCharge,
        electricCharge: electricCharge,
        totalCharge: totalCharge
      };

      // Check for anomalies
      checkAndFlagAnomalies(room, waterUsage, electricUsage);
    }
  } else {
    card.classList.remove('filled');
    status.className = 'status-badge status-empty';
    status.textContent = 'ยังไม่บันทึก';
    delete meterInputs[room];
  }
}

function checkAndFlagAnomalies(room, waterUsage, electricUsage) {
  const monthKey = getMonthKey(currentMonth);
  let flagged = false;

  // Check water
  const waterAnomaly = detectHighWaterUsage(waterUsage, 50);
  if (waterAnomaly.detected) {
    const card = document.getElementById(`meter-${room}`);
    card.style.borderColor = waterAnomaly.severity === 'critical' ? '#c62828' : '#ff8f00';
    card.style.backgroundColor = waterAnomaly.severity === 'critical' ? '#ffebee' : '#fff8e1';
    flagged = true;
  }

  // Check electric
  const electricAnomaly = detectHighElectricUsage(electricUsage, 500);
  if (electricAnomaly.detected) {
    const card = document.getElementById(`meter-${room}`);
    card.style.borderColor = electricAnomaly.severity === 'critical' ? '#c62828' : '#ff8f00';
    card.style.backgroundColor = electricAnomaly.severity === 'critical' ? '#ffebee' : '#fff8e1';
    flagged = true;
  }

  if (flagged) {
    // Store anomaly
    const allAnomalies = JSON.parse(localStorage.getItem('meterAnomalies') || '{}');
    if (!allAnomalies[monthKey]) allAnomalies[monthKey] = {};

    const anomalyList = [];
    if (waterAnomaly.detected) {
      anomalyList.push({
        type: 'high_water',
        value: waterUsage,
        severity: waterAnomaly.severity,
        message: `💧 ห้อง ${room}: ${waterUsage} หน่วย (เกิน ${anomalyList.length || detectHighWaterUsage(waterUsage).excess.toFixed(1)} หน่วย)`
      });
    }
    if (electricAnomaly.detected) {
      anomalyList.push({
        type: 'high_electric',
        value: electricUsage,
        severity: electricAnomaly.severity,
        message: `⚡ ห้อง ${room}: ${electricUsage} หน่วย (เกิน ${detectHighElectricUsage(electricUsage).excess.toFixed(1)} หน่วย)`
      });
    }

    allAnomalies[monthKey][room] = anomalyList;
    localStorage.setItem('meterAnomalies', JSON.stringify(allAnomalies));
  }
}

// ===== METER DATA OPERATIONS =====

function loadMeterData() {
  const monthKey = getMonthKey(currentMonth);
  const readings = getMeterReadings(monthKey);

  for (const room of NEST_ROOMS) {
    if (readings[room]) {
      const reading = readings[room];
      document.getElementById(`water-current-${room}`).value = reading.currentWater || '';
      document.getElementById(`electric-current-${room}`).value = reading.currentElectric || '';
      updateMeterCard(room);
    }
  }
}

function loadPreviousMonth() {
  const monthKey = getMonthKey(currentMonth);
  const prevMonthKey = getPreviousMonthKey(monthKey);

  const prevReadings = getMeterReadings(prevMonthKey);

  if (Object.keys(prevReadings).length === 0) {
    showAlert(`❌ ไม่มีข้อมูลจากเดือน ${prevMonthKey}`, 'warning');
    return;
  }

  // Auto-fill with previous month's current values
  for (const room of NEST_ROOMS) {
    if (prevReadings[room]) {
      document.getElementById(`water-current-${room}`).value = prevReadings[room].currentWater || '';
      document.getElementById(`electric-current-${room}`).value = prevReadings[room].currentElectric || '';
    }
  }

  showAlert(`✅ โหลดข้อมูลจากเดือน ${prevMonthKey} สำเร็จ`, 'success');
}

function submitMeterReadings() {
  const monthKey = getMonthKey(currentMonth);
  const filledRooms = Object.keys(meterInputs).length;

  if (filledRooms === 0) {
    showAlert('❌ กรุณากรอกข้อมูลมิเตอร์อย่างน้อย 1 ห้อง', 'warning');
    return;
  }

  if (filledRooms !== NEST_ROOMS.length) {
    if (!confirm(`⚠️ เพิ่งบันทึก ${filledRooms}/${NEST_ROOMS.length} ห้อง ยืนยันต่อหรือไม่?`)) {
      return;
    }
  }

  let grandTotal = 0;
  for (const room in meterInputs) {
    grandTotal += meterInputs[room].totalCharge;
  }

  if (!confirm(`✅ ยืนยันบันทึกมิเตอร์\nเดือน: ${document.getElementById('meterMonth').value}\nจำนวนห้อง: ${filledRooms}\nรวมค่าธรรมชาติ: ${formatCurrency(grandTotal)}`)) {
    return;
  }

  // Save readings
  const readings = {};
  for (const room in meterInputs) {
    readings[room] = {
      currentWater: meterInputs[room].waterCurrent,
      currentElectric: meterInputs[room].electricCurrent,
      previousWater: meterInputs[room].waterPrev,
      previousElectric: meterInputs[room].electricPrev,
      date: new Date().toISOString(),
      status: 'recorded'
    };
  }

  saveMeterReadings(monthKey, readings);

  // Save to history
  saveToHistory(monthKey, meterInputs);

  // Generate bills
  const billResult = generateBillsForMonth(monthKey, readings, { current: currentRates });

  if (billResult.success) {
    logAudit('METER_SUBMITTED', {
      month: monthKey,
      roomsCount: filledRooms,
      totalCharge: grandTotal,
      billsGenerated: billResult.created
    });

    showAlert(`✅ บันทึกมิเตอร์สำเร็จ!\n✅ สร้างใบวางบิล ${billResult.created} ใบ`, 'success');

    setTimeout(() => {
      resetForm();
      renderMeterGrid();
      loadMeterData();
    }, 1500);
  } else {
    showAlert(`❌ เกิดข้อผิดพลาดในการสร้างบิล: ${billResult.errors.join(', ')}`, 'warning');
  }
}

function saveToHistory(monthKey, inputs) {
  const history = JSON.parse(localStorage.getItem('meterHistory') || '{}');
  const [year, month] = monthKey.split('_');

  for (const room in inputs) {
    if (!history[room]) history[room] = [];

    const monthName = getMonthNameThai(parseInt(month));
    history[room].push({
      month: monthKey,
      monthName: monthName,
      waterUsage: inputs[room].waterUsage,
      waterCharge: inputs[room].waterCharge,
      electricUsage: inputs[room].electricUsage,
      electricCharge: inputs[room].electricCharge,
      totalCharge: inputs[room].totalCharge,
      recordedAt: new Date().toISOString()
    });
  }

  localStorage.setItem('meterHistory', JSON.stringify(history));
}

function resetForm() {
  meterInputs = {};

  for (const room of NEST_ROOMS) {
    document.getElementById(`water-current-${room}`).value = '';
    document.getElementById(`electric-current-${room}`).value = '';
    document.getElementById(`status-${room}`).className = 'status-badge status-empty';
    document.getElementById(`status-${room}`).textContent = 'ยังไม่บันทึก';
    document.getElementById(`water-info-${room}`).innerHTML = '---';
    document.getElementById(`electric-info-${room}`).innerHTML = '---';
    const card = document.getElementById(`meter-${room}`);
    card.classList.remove('filled');
    card.style.borderColor = '';
    card.style.backgroundColor = '';
  }
}

// ===== HELPER FUNCTIONS =====

function getMonthKey(dateStr) {
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    return `${parts[0]}_${parts[1]}`;
  }
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}_${month}`;
}

function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split('_');
  let prevMonth = parseInt(month) - 1;
  let prevYear = parseInt(year);

  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear--;
  }

  return `${prevYear}_${String(prevMonth).padStart(2, '0')}`;
}

function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function showAlert(message, type) {
  const alertBox = document.getElementById('alertBox');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.innerHTML = message;
  alertBox.innerHTML = '';
  alertBox.appendChild(alert);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}

// ===== NAVIGATION =====

function goToDashboard() {
  window.location.href = '/dashboard';
}

function goToAccounting() {
  window.location.href = '/accounting';
}

function logout() {
  if (confirm('ต้องการออกจากระบบหรือไม่?')) {
    localStorage.removeItem('currentUser');
    window.location.href = '/login';
  }
}

// ===== BULK IMPORT FUNCTIONS =====

function toggleBulkImport() {
  const section = document.getElementById('bulkImportSection');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
}

function downloadCSVTemplate() {
  const roomList = NEST_ROOMS.map(room => `${room},,`).join('\n');

  const csv = `Room,Water,Electric
${roomList}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `meter_template_${currentMonth}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showAlert('✅ ดาวน์โหลดตัวอย่าง CSV สำเร็จ', 'success');
}

function importFromCSV() {
  const fileInput = document.getElementById('csvFile');

  if (!fileInput.files || fileInput.files.length === 0) {
    showAlert('❌ กรุณาเลือกไฟล์ CSV', 'warning');
    return;
  }

  const file = fileInput.files[0];

  if (!file.name.endsWith('.csv')) {
    showAlert('❌ กรุณาเลือกไฟล์ CSV เท่านั้น', 'warning');
    return;
  }

  const reader = new FileReader();

  reader.onload = function(e) {
    try {
      const csv = e.target.result;
      const data = parseCSVFile(csv);

      const validation = validateBulkReadings(data);

      if (!validation.valid) {
        let errorMsg = '❌ ข้อมูลไม่ถูกต้อง:\n';
        validation.errors.forEach(error => {
          errorMsg += `• ${error}\n`;
        });
        showAlert(errorMsg, 'warning');
        return;
      }

      // Fill in the form
      for (const room in data) {
        if (document.getElementById(`water-current-${room}`)) {
          document.getElementById(`water-current-${room}`).value = data[room].currentWater || '';
          document.getElementById(`electric-current-${room}`).value = data[room].currentElectric || '';
          updateMeterCard(room);
        }
      }

      showAlert(`✅ นำเข้าข้อมูล ${Object.keys(data).length} ห้องสำเร็จ`, 'success');
      toggleBulkImport();
      fileInput.value = '';

      logAudit('METER_IMPORTED_CSV', {
        month: currentMonth,
        roomsImported: Object.keys(data).length
      });
    } catch (error) {
      showAlert(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'warning');
    }
  };

  reader.readAsText(file);
}

function exportMeterData() {
  const monthKey = getMonthKey(currentMonth);
  const readings = getMeterReadings(monthKey);
  const rates = { current: currentRates };

  if (Object.keys(readings).length === 0) {
    showAlert('❌ ไม่มีข้อมูลที่จะส่งออก', 'warning');
    return;
  }

  let csv = 'Room,Water Current,Electric Current,Water Previous,Electric Previous,Water Usage,Electric Usage,Water Charge,Electric Charge,Total\n';

  for (const room in readings) {
    const reading = readings[room];
    const waterUsage = calculateWaterUsage(reading.currentWater, reading.previousWater);
    const electricUsage = calculateElectricUsage(reading.currentElectric, reading.previousElectric);
    const waterCharge = calculateWaterCharge(waterUsage, currentRates.water);
    const electricCharge = calculateElectricCharge(electricUsage, currentRates.electric);
    const totalCharge = waterCharge + electricCharge;

    csv += `${room},${reading.currentWater},${reading.currentElectric},${reading.previousWater},${reading.previousElectric},${waterUsage},${electricUsage},${waterCharge},${electricCharge},${totalCharge}\n`;
  }

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `meter_readings_${currentMonth}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  logAudit('METER_EXPORTED_CSV', {
    month: currentMonth,
    roomsExported: Object.keys(readings).length
  });

  showAlert('✅ ส่งออกข้อมูลสำเร็จ', 'success');
}

// ===== EVENT LISTENERS =====

function attachEventListeners() {
  const monthInput = document.getElementById('meterMonth');
  if (monthInput) {
    monthInput.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      resetForm();
      loadMeterData();
    });
  }

  // CSV file input
  const csvInput = document.getElementById('csvFile');
  if (csvInput) {
    csvInput.addEventListener('change', () => {
      // Auto-import on file select (optional)
    });
  }
}

// ===== PAGE INITIALIZATION =====

window.addEventListener('load', initMeterPage);
