// ===== ROOM CONFIGURATION FUNCTIONS =====
// Extracted from dashboard-main.js
// Depends on globals: RoomConfigManager, showToast (main.js), initMeterRoomsTab (meter-import.js)

function loadRoomConfigUI() {
  try {
    const dropdown = document.getElementById('roomConfigBuilding');
    if (!dropdown) {
      console.error('❌ roomConfigBuilding dropdown not found');
      return;
    }

    const building = dropdown.value || 'rooms';
    console.log('📋 Loading room config for building:', building);

    if (typeof RoomConfigManager === 'undefined') {
      console.error('❌ RoomConfigManager not loaded');
      return;
    }

    const config = RoomConfigManager.getRoomsConfig(building);
    console.log('📦 Config loaded:', config);

    const tbody = document.getElementById('roomConfigBody');
    if (!tbody) {
      console.error('❌ roomConfigBody tbody not found');
      return;
    }

    tbody.innerHTML = config.rooms
    .filter(room => !room.deleted)
    .map(room => {
      // Get rent: use RoomConfigManager if explicitly set, fallback to metadata, then default
      const metadataArray = building === 'rooms' ? window.ROOMS_OLD : window.NEST_ROOMS;
      // Search using room ID as-is (both window.ROOMS_OLD and window.NEST_ROOMS use the actual IDs)
      const searchId = room.id;
      const metadata = metadataArray.find(m => m.id === searchId);
      // Prefer explicit room.rentPrice from DEFAULT_ROOMS_CONFIG, but only if it was actually saved (not 0 or undefined)
      const rent = (room.rentPrice && room.rentPrice > 0) ? room.rentPrice : (metadata?.rentPrice || 1500);
      const depositId = `deposit_${building}_${room.id}`;
      return `
      <tr style="border-bottom:1px solid var(--border);">
        <td class="table-th">
          <input type="text" value="${room.name}" onchange="updateRoomField('${building}', '${room.id}', 'name', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
          <div style="font-size:.7rem;color:#bbb;margin-top:3px;">ID: ${room.id}</div>
        </td>
        <td class="table-th">
          <input type="number" value="${rent}" onchange="updateRentAndDeposit('${building}', '${room.id}', parseInt(this.value), '${depositId}')" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td class="table-th">
          <input type="number" id="${depositId}" value="${rent * 2}" readonly style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;background:#f5f5f5;color:#666;">
        </td>
        <td class="table-th">
          <input type="number" value="${room.waterRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'water', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td class="table-th">
          <input type="number" value="${room.electricRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'electric', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td class="table-th">
          <input type="number" value="${room.trashRate || 20}" step="1" onchange="updateTrashRate('${building}', '${room.id}', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td class="table-th" style="text-align:center;">
          <button onclick="deleteRoom('${building}', '${room.id}')" style="padding:0.4rem 0.8rem;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:0.85rem;">ลบ</button>
        </td>
      </tr>
    `}).join('');

    populateTemplateSelect(building);
    console.log('✅ Room config UI loaded successfully');
  } catch (error) {
    console.error('❌ Error loading room config UI:', error);
  }
}

function populateTemplateSelect(building) {
  try {
    const config = RoomConfigManager.getRoomsConfig(building);
    const select = document.getElementById('templateRoomSelect');
    if (!select) {
      console.warn('⚠️ templateRoomSelect not found');
      return;
    }
    select.innerHTML = '<option value="">-- เลือกห้อง --</option>' +
      config.rooms
        .filter(room => !room.deleted)
        .map(room => `<option value="${room.id}">${room.id} - ${room.name}</option>`)
        .join('');
  } catch (error) {
    console.error('❌ Error populating template select:', error);
  }
}

function toggleAddMode(mode) {
  document.getElementById('manualEntryMode').style.display = mode === 'manual' ? 'grid' : 'none';
  document.getElementById('copyEntryMode').style.display = mode === 'copy' ? 'grid' : 'none';
}

// Shop room: id='ร้านใหญ่' (stable internal ID, same in RoomConfigManager & METER_DATA)
// Display name (room.name) is editable via ⚙️ config table → "ชื่อห้อง" column

function refreshPropertyPageIfActive() {
  // Property page removed — refresh tenant page if active
  const tenantPage = document.getElementById('page-tenant');
  if (tenantPage && tenantPage.classList.contains('active')) {
    if (tenantBuilding === 'old') { initRoomsPage(); } else { initNestPage(); }
  }
  updateShopInfoCard();
  updateRoomsInfoCards();
}

function updateDepositDisplay() {
  const rentInput = document.getElementById('newRoomRent');
  const depositInput = document.getElementById('newRoomDeposit');
  if (rentInput && depositInput) {
    const rent = parseInt(rentInput.value) || 1500;
    depositInput.value = rent * 2;
  }
}

function updateRentAndDeposit(building, roomId, newRent, depositId) {
  // Update deposit field immediately (real-time)
  const depositInput = document.getElementById(depositId);
  if (depositInput) {
    depositInput.value = newRent * 2;
  }
  // Save the rent change to database
  updateRoomField(building, roomId, 'rentPrice', newRent);
}

function updateRoomField(building, roomId, fieldName, value) {
  const config = RoomConfigManager.getRoomsConfig(building);
  const room = config.rooms.find(r => r.id === roomId);
  if (room) {
    room[fieldName] = value;
    RoomConfigManager.saveRoomsConfig(building, config);

    const fieldLabel = {
      'name': 'ชื่อห้อง',
      'rent': 'ราคาเช่า',
      'rentPrice': 'ราคาเช่า',
      'waterRate': 'อัตราน้ำ',
      'electricRate': 'อัตราไฟ'
    }[fieldName] || fieldName;

    showToast(`✅ บันทึก${fieldLabel}สำหรับห้อง ${roomId} เรียบร้อย`, 'success', 2500);
    console.log(`✅ อัปเดต ${fieldName} สำหรับ ${roomId}`);
    refreshPropertyPageIfActive();
  }
}

function updateRoomRate(building, roomId, rateType, rate) {
  RoomConfigManager.updateRoomRate(building, roomId, rateType, parseFloat(rate));

  const rateLabel = rateType === 'water' ? 'อัตราน้ำ' : 'อัตราไฟฟ้า';
  showToast(`✅ บันทึก${rateLabel}สำหรับห้อง ${roomId} = ${rate} บาท/หน่วย`, 'success', 2500);
  console.log(`✅ อัปเดตอัตรา ${rateType === 'water' ? 'น้ำ' : 'ไฟ'} สำหรับ ${roomId} = ${rate} บาท/หน่วย`);
  refreshPropertyPageIfActive();
}

function updateTrashRate(building, roomId, rate) {
  RoomConfigManager.updateTrashRate(building, roomId, parseInt(rate));

  showToast(`✅ บันทึกค่าขยะสำหรับห้อง ${roomId} = ${rate} บาท`, 'success', 2500);
  console.log(`✅ อัปเดตค่าขยะสำหรับ ${roomId} = ${rate} บาท`);
  refreshPropertyPageIfActive();
}

function addNewRoom() {
  const building = document.getElementById('roomConfigBuilding').value;
  const mode = document.querySelector('input[name="addMode"]:checked').value;

  let roomId, roomName, rent, waterRate, electricRate;

  if (mode === 'manual') {
    roomId = document.getElementById('newRoomId').value.trim();
    roomName = document.getElementById('newRoomName').value.trim();
    rent = parseInt(document.getElementById('newRoomRent').value) || 1500;
    waterRate = parseFloat(document.getElementById('newRoomWater').value);
    electricRate = parseFloat(document.getElementById('newRoomElectric').value);

    if (!roomId || !roomName) {
      showToast('กรุณากรอก ID และชื่อห้อง', 'warning');
      return;
    }
  } else {
    const templateId = document.getElementById('templateRoomSelect').value;
    roomId = document.getElementById('newRoomIdCopy').value.trim();
    roomName = document.getElementById('newRoomNameCopy').value.trim();
    rent = parseInt(document.getElementById('newRoomRentCopy').value) || 1500;

    if (!templateId || !roomId || !roomName) {
      showToast('กรุณาเลือก template และป้อน ID กับชื่อห้อง', 'warning');
      return;
    }

    const template = RoomConfigManager.getRoom(building, templateId);
    waterRate = template.waterRate;
    electricRate = template.electricRate;
  }

  const success = RoomConfigManager.addRoom(building, {
    id: roomId,
    name: roomName,
    rent: rent,
    waterRate: waterRate,
    electricRate: electricRate,
    deleted: false
  });

  if (success) {
    showToast(`เพิ่มห้อง ${roomId} สำเร็จ`, 'success');
    document.getElementById('newRoomId').value = '';
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomRent').value = '1500';
    document.getElementById('newRoomIdCopy').value = '';
    document.getElementById('newRoomNameCopy').value = '';
    document.getElementById('newRoomRentCopy').value = '1500';
    document.getElementById('templateRoomSelect').value = '';
    loadRoomConfigUI();
    initMeterRoomsTab();
  } else {
    showToast(`ห้อง ${roomId} มีอยู่แล้ว`, 'warning');
  }
}

function deleteRoom(building, roomId) {
  if (confirm(`คุณแน่ใจหรือว่าต้องการลบห้อง ${roomId}? (เก็บข้อมูลมิเตอร์ไว้)`)) {
    const config = RoomConfigManager.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room.deleted = true;
      RoomConfigManager.saveRoomsConfig(building, config);
      showToast(`ลบห้อง ${roomId} เรียบร้อย (ข้อมูลมิเตอร์ยังเก็บไว้)`, 'success');
      loadRoomConfigUI();
      initMeterRoomsTab();
    }
  }
}
