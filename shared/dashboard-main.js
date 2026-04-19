// Use CONFIG from config-unified.js instead (with fallback if not loaded yet)
const MONTHS_TH = (window.CONFIG?.months?.short) || ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = (window.CONFIG?.months?.full) || ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// window.ROOMS_OLD and window.ROOMS_NEW are now defined in shared-config.js
// Use window.CONFIG.rooms_old and window.CONFIG.rooms_new instead

// Hardcoded data removed - use only Firebase and HISTORICAL_DATA
// All billing data must be imported through the billing import tool
const DATA = {};

// ===== NAV =====
window._showPageImpl = function(page,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if(btn)btn.classList.add('active');
  window.scrollTo(0,0);
  // Close sidebar on mobile after navigation
  if(window.innerWidth <= 600){
    window._closeSidebarImpl();
  }
  if(page==='dashboard'){setTimeout(initDashboardCharts,100);updateDashboardLive();syncDashboardYearUI();if(typeof applyBuildingAvailability==='function')applyBuildingAvailability(currentYear);}
  if(page==='tenant')initTenantPage();
  if(page==='expense')initExpensePage();
  if(page==='requests-approvals'){
    // Default to Maintenance tab on first load
    setTimeout(()=>switchRequestsTab('maintenance',document.getElementById('tab-maintenance-btn')),80);
  }
  if(page==='announcements')initAnnouncementsPage();
  if(page==='tenant-portal')initTenantPortal();
  if(page==='analytics')initAnalyticsPage();
  if(page==='contract')initContractPage();
  if(page==='meter')initMeterPage();
  if(page==='owner-info')initOwnerInfoPage();
  if(page==='tenant-master')initTenantMasterPage();
  if(page==='lease-agreements')initLeaseAgreementsPage();
  if(page==='gamification')initGamificationPage();
  if(page==='content-management'){
    if(typeof initAnnouncementsPage==='function')initAnnouncementsPage();
    if(typeof initCommunityEventsPage==='function')initCommunityEventsPage();
    if(typeof initCommunityDocsPage==='function')initCommunityDocsPage();
  }
  if(page==='people-management'){
    if(typeof initOwnerInfoPage==='function')initOwnerInfoPage();
    if(typeof initServiceProvidersPage==='function')initServiceProvidersPage();
  }
};
// Assign to global scope after definition
window.showPage = window._showPageImpl;

window.switchTenantMainTab = function(tab, btn) {
  ['tenants','leases','requests','alerts'].forEach(t => {
    const el = document.getElementById('tenant-main-tab-' + t);
    if(el) el.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#tenant-main-tab-btn-tenants,#tenant-main-tab-btn-leases,#tenant-main-tab-btn-requests,#tenant-main-tab-btn-alerts').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(tab === 'leases' && typeof initLeaseAgreementsPage === 'function') initLeaseAgreementsPage();
  if(tab === 'requests' && typeof initLeaseRequestsPage === 'function') initLeaseRequestsPage();
  if(tab === 'alerts' && typeof initLeaseSettingsPage === 'function') initLeaseSettingsPage();
};

window.switchBillingMainTab = function(tab, btn) {
  ['billing','verify'].forEach(t => {
    const el = document.getElementById('bill-main-tab-' + t);
    if(el) el.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#bill-main-tab-btn-billing,#bill-main-tab-btn-verify').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(tab === 'verify' && typeof initPaymentVerify === 'function') initPaymentVerify();
};

// Meter Tab Switching Function
window._switchMeterTabImpl = function(tabName, btnElement) {
  // Hide all tabs
  document.querySelectorAll('.meter-tab-content').forEach(el => el.style.display = 'none');

  // Remove active state from all buttons
  document.querySelectorAll('.meter-tab').forEach(btn => btn.classList.remove('active'));

  // Show selected tab
  const contentEl = document.getElementById('meter-' + tabName + '-content');
  const resolvedBtn = btnElement || document.getElementById('tab-' + tabName + '-btn');
  if (contentEl) {
    contentEl.style.display = 'block';
    if (resolvedBtn) resolvedBtn.classList.add('active');
  }

  // Initialize meter page content if needed
  if (tabName === 'nest') {
    initMeterNestTab();
  } else if (tabName === 'rooms') {
    initMeterRoomsTab();
  } else if (tabName === 'room-config') {
    // Initialize room config tab
    const dropdown = document.getElementById('roomConfigBuilding');
    if (dropdown && !dropdown.value) {
      dropdown.value = 'rooms'; // Set default
    }
    // Small delay to ensure DOM is ready
    setTimeout(() => loadRoomConfigUI(), 50);
  } else if (tabName === 'import-meter') {
    initImportMeterTab();
  }
};
// Assign to global scope
window.switchMeterTab = window._switchMeterTabImpl;

window.switchPropertyTab = function(tab, el) {
  // Hide all sections
  const roomsSection = document.getElementById('property-rooms-section');
  const nestSection = document.getElementById('property-nest-section');

  if (roomsSection) roomsSection.style.display = 'none';
  if (nestSection) nestSection.style.display = 'none';

  // Remove active state from all tabs
  document.querySelectorAll('.property-tab').forEach(btn => {
    btn.style.color = '#999';
    btn.style.borderBottom = '3px solid transparent';
  });

  // Show selected section and set active tab
  if (tab === 'rooms') {
    if (roomsSection) roomsSection.style.display = 'block';
    if (el) {
      el.style.color = '#2d8653';
      el.style.borderBottom = '3px solid #2d8653';
    }
    // Initialize rooms page if needed
    if (typeof initRoomsPage === 'function') {
      initRoomsPage();
    }
  } else if (tab === 'nest') {
    if (nestSection) nestSection.style.display = 'block';
    if (el) {
      el.style.color = '#2d8653';
      el.style.borderBottom = '3px solid #2d8653';
    }
    // Initialize nest page if needed
    if (typeof initNestPage === 'function') {
      initNestPage();
    }
  }
};

// Keep old function name for backward compatibility
window.switchBuildingTab = window.switchPropertyTab;

// ===== ROOM CONFIGURATION FUNCTIONS =====
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
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="text" value="${room.name}" onchange="updateRoomField('${building}', '${room.id}', 'name', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
          <div style="font-size:.7rem;color:#bbb;margin-top:3px;">ID: ${room.id}</div>
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${rent}" onchange="updateRentAndDeposit('${building}', '${room.id}', parseInt(this.value), '${depositId}')" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" id="${depositId}" value="${rent * 2}" readonly style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;background:#f5f5f5;color:#666;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.waterRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'water', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.electricRate}" step="0.01" onchange="updateRoomRate('${building}', '${room.id}', 'electric', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;">
          <input type="number" value="${room.trashRate || 20}" step="1" onchange="updateTrashRate('${building}', '${room.id}', this.value)" style="width:100%;padding:0.2rem;border:1px solid var(--border);border-radius:4px;font-family:'Sarabun',sans-serif;">
        </td>
        <td style="border:1px solid var(--border);padding:0.8rem;text-align:center;">
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

// Show toast notification
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;

  container.appendChild(toast);

  // Remove after duration
  setTimeout(() => {
    toast.classList.add('remove');
    setTimeout(() => toast.remove(), 300);
  }, duration);
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

// Dashboard Tab Switching Function
function switchDashboardTab(tabName, btn) {
  // Hide all tabs
  document.querySelectorAll('.dashboard-tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active class and inline styles from all buttons
  document.querySelectorAll('.dashboard-tab').forEach(button => {
    button.classList.remove('active');
    button.style.color = '';
  });

  // Show selected tab
  const tabElement = document.getElementById('dashboard-' + tabName + '-tab');
  if(tabElement) {
    tabElement.classList.add('active');
  }

  // Add active class and styles to button
  if(btn) {
    btn.classList.add('active');
    btn.style.color = 'var(--green)';
  }

  // Initialize charts if analytics tab
  if(tabName === 'analytics') {
    setTimeout(() => {
      if(typeof initDashboardAnalyticsCharts === 'function') {
        initDashboardAnalyticsCharts();
      }
    }, 100);
  }
}

// ===== REQUESTS & APPROVALS TAB SWITCHING =====
function switchRequestsTab(tabName, btn) {
  // Hide all requests tabs
  document.querySelectorAll('.requests-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.requests-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Hide all tab content
  document.querySelectorAll('.requests-mgmt-content').forEach(tab => tab.style.display = 'none');

  // Show selected tab
  const tabElement = document.getElementById('requests-tab-' + tabName);
  if(tabElement) {
    tabElement.style.display = 'block';
    if(btn) btn.classList.add('active');
    // Initialize content for each tab
    if(tabName === 'maintenance') initMaintenancePage();
    else if(tabName === 'housekeeping') initHousekeepingPage();
    else if(tabName === 'complaints' && typeof initComplaintsPage === 'function') initComplaintsPage();
    else if(tabName === 'pets' && typeof initPetApprovalsPage === 'function') initPetApprovalsPage();
    else if(tabName === 'liff' && typeof initLiffRequestsPage === 'function') initLiffRequestsPage();
  }
}

// ===== LIFF LINK REQUESTS — admin approval =====
let _liffRequestsUnsub = null;
function initLiffRequestsPage(){
  if(_liffRequestsUnsub) return;
  if(!window.firebase?.firestore){
    const list = document.getElementById('liffRequestsList');
    if(list) list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ Firebase ยังไม่พร้อม</div>';
    return;
  }
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const col = fs.collection(db, 'liffUsers');
  _liffRequestsUnsub = fs.onSnapshot(col, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLiffRequestsList(docs);
  }, err => console.warn('liffUsers onSnapshot:', err));
}

function renderLiffRequestsList(docs){
  const pending = docs.filter(d => d.status === 'pending');
  const approved = docs.filter(d => d.status === 'approved');
  const rejected = docs.filter(d => d.status === 'rejected');
  const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setTxt('liff-pending-count', pending.length);
  setTxt('liff-approved-count', approved.length);
  setTxt('liff-rejected-count', rejected.length);

  const list = document.getElementById('liffRequestsList');
  if(!list) return;
  if(docs.length === 0){
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">📭 ยังไม่มีคำขอเชื่อมบัญชี</div>';
    return;
  }
  // Sort: pending first, then approved, then rejected
  const order = { pending: 0, approved: 1, rejected: 2 };
  docs.sort((a,b) => (order[a.status]??9) - (order[b.status]??9) || (b.requestedAt||'').localeCompare(a.requestedAt||''));

  list.innerHTML = docs.map(d => {
    const colors = { pending:'#f57c00', approved:'#2d8653', rejected:'#c62828' };
    const labels = { pending:'⏳ รออนุมัติ', approved:'✅ อนุมัติแล้ว', rejected:'❌ ปฏิเสธ' };
    const c = colors[d.status] || '#999';
    const when = d.requestedAt ? new Date(d.requestedAt).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const pic = d.linePictureUrl ? `<img src="${d.linePictureUrl}" style="width:42px;height:42px;border-radius:50%;flex-shrink:0;">` : '<div style="width:42px;height:42px;border-radius:50%;background:#eee;flex-shrink:0;"></div>';
    const actions = d.status === 'pending' ? `
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button onclick="approveLiffLink('${d.id}')" style="padding:6px 14px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.8rem;">✅ อนุมัติ</button>
        <button onclick="rejectLiffLink('${d.id}')" style="padding:6px 14px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.8rem;">❌ ปฏิเสธ</button>
      </div>` : (d.status === 'approved'
        ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px;">โดย ${d.approvedBy||'Admin'} · ${d.approvedAt?new Date(d.approvedAt).toLocaleDateString('th-TH'):''}</div>`
        : `<button onclick="approveLiffLink('${d.id}')" style="padding:4px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:6px;cursor:pointer;font-family:inherit;font-size:.75rem;margin-top:4px;">↩️ อนุมัติย้อนหลัง</button>`);
    return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      ${pic}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="font-weight:700;font-size:.92rem;">${d.lineDisplayName||'—'}</div>
          <span style="color:${c};font-size:.78rem;font-weight:700;">${labels[d.status]||d.status}</span>
        </div>
        <div style="font-size:.82rem;color:var(--text);margin-top:2px;">
          ตึก: <strong>${d.building==='nest'?'🏢 Nest':'🏠 ห้องแถว'}</strong> ·
          ห้อง <strong>${d.room||'—'}</strong>
          ${d.phone?` · 📱 ${d.phone}`:''}
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">ขอเมื่อ ${when}</div>
        ${actions}
      </div>
    </div>`;
  }).join('');
}

async function approveLiffLink(lineUserId){
  if(!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const adminName = window.SecurityUtils?.getSecureSession()?.name || 'Admin';
  try {
    await fs.setDoc(fs.doc(fs.collection(db, 'liffUsers'), lineUserId), {
      status: 'approved', approvedBy: adminName, approvedAt: new Date().toISOString()
    }, { merge: true });
  } catch(e) { alert('❌ ' + e.message); }
}

async function rejectLiffLink(lineUserId){
  if(!confirm('ปฏิเสธคำขอนี้?')) return;
  if(!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const adminName = window.SecurityUtils?.getSecureSession()?.name || 'Admin';
  try {
    await fs.setDoc(fs.doc(fs.collection(db, 'liffUsers'), lineUserId), {
      status: 'rejected', rejectedBy: adminName, rejectedAt: new Date().toISOString()
    }, { merge: true });
  } catch(e) { alert('❌ ' + e.message); }
}

// ===== PEOPLE MANAGEMENT TAB SWITCHING =====
function switchPeopleTab(tabName, btn) {
  // Hide all people tabs
  document.querySelectorAll('.people-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.people-mgmt-tab').forEach(button => {
    button.style.color = '#999';
    button.style.borderBottomColor = 'transparent';
  });

  // Show selected tab
  const tabElement = document.getElementById('people-tab-' + tabName);
  if(tabElement) {
    tabElement.style.display = 'block';
  }

  // Highlight active button
  if(btn) {
    btn.style.color = 'var(--green)';
    btn.style.borderBottomColor = 'var(--green)';
  }
}

// ===== LEASE MANAGEMENT TAB SWITCHING =====
// ===== SIDEBAR FUNCTIONS =====
function toggleSidebar(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  sidebar.classList.toggle('visible');
  hamburger.classList.toggle('active');
}

window._closeSidebarImpl = function(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  sidebar.classList.remove('visible');
  hamburger.classList.remove('active');
};
// Assign to global scope
window.closeSidebar = window._closeSidebarImpl;

// Close sidebar when clicking outside
document.addEventListener('click',function(e){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  if(!sidebar.contains(e.target) && !hamburger.contains(e.target) && window.innerWidth <= 600){
    window.closeSidebar();
  }

  // Close batch rent modal if clicking outside
  const batchModal = document.getElementById('batchRentModal');
  if (batchModal && batchModal.style.display === 'flex') {
    const modalContent = batchModal.querySelector('div[style*="background:white"]');
    if (modalContent && !modalContent.contains(e.target)) {
      closeBatchRentAdjustmentModal();
    }
  }
});

// Close sidebar on resize to desktop
window.addEventListener('resize',function(){
  if(window.innerWidth > 600){
    closeSidebar();
  }
});


// ===== DASHBOARD =====
// Auto-detect latest year from HISTORICAL_DATA, fallback to 69 (2026)
// Phase 2c: prefer HistoricalDataStore (cloud-aware) when available
const historicalData = (typeof HistoricalDataStore !== 'undefined')
  ? HistoricalDataStore.getAll()
  : JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
const availableYears = Object.keys(historicalData).map(y => parseInt(y)).sort((a,b) => b-a);
let currentYear = '69';
window.dashBuildingFilter = 'all';
let chartRevenue,chartPie,chartYears,chartElec,chartWater,chartMS,chartCum;

function syncDashboardYearUI(){
  const yr = currentYear;
  const isAll = yr==='all';
  const isOldYear = yr==='67'||yr==='68';
  // 3-year compare — all only
  const cardYears = document.getElementById('card-years-compare');
  if(cardYears) cardYears.style.display = isAll ? '' : 'none';
  // Live-only cards + panels — all only
  document.querySelectorAll('.kpi-live').forEach(el=>el.style.display=isAll?'block':'none');
  const livePanels = document.getElementById('dash-live-panels');
  if(livePanels) livePanels.style.display = isAll ? 'grid' : 'none';
  // Nest Building card — hide for 67/68 (not open yet)
  document.querySelectorAll('.kpi-nest').forEach(el=>el.style.display=isOldYear?'none':'');
}

function setYear(yr,btn){
  // Only clear active state on the year row (first .year-tabs), not the building row
  const rows = document.querySelectorAll('#page-dashboard .year-tabs');
  if(rows[0]) rows[0].querySelectorAll('.year-tab').forEach(b=>b.classList.remove('active'));
  if(btn) {
    btn.classList.add('active');
  } else if (rows[0]) {
    // Programmatic call without btn — find the matching tab by its onclick handler
    const target = rows[0].querySelector(`.year-tab[onclick*="setYear('${yr}'"]`);
    if (target) target.classList.add('active');
  }
  currentYear=yr;
  applyBuildingAvailability(yr);
  syncDashboardYearUI();
  updateDashboardLive();
  initDashboardCharts();
}

// Ensure 2569 (current BE year) is the active year on page load
if (typeof window !== 'undefined' && !window._initialDashboardYear) {
  window._initialDashboardYear = true;
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const beYear = String(new Date().getFullYear() + 543).slice(-2);  // '69'
      try { if (typeof setYear === 'function') setYear(beYear, null); } catch(e){}
    }, 600);
  });
}

// Nest building didn't exist in 2567/2568 — disable those options for those years
function applyBuildingAvailability(yr){
  const preNest = (yr==='67' || yr==='68');
  const btnAll  = document.getElementById('dash-bld-all');
  const btnNest = document.getElementById('dash-bld-nest');
  const btnRooms= document.getElementById('dash-bld-rooms');
  [btnAll, btnNest].forEach(b=>{
    if(!b) return;
    b.disabled = preNest;
    b.style.opacity = preNest ? '.4' : '';
    b.style.cursor = preNest ? 'not-allowed' : 'pointer';
    b.title = preNest ? 'อาคาร Nest เปิดปี 2569 (2026)' : '';
  });
  if(preNest){
    // If current filter is 'all' or 'nest', force to 'rooms'
    if(window.dashBuildingFilter==='all' || window.dashBuildingFilter==='nest'){
      window.dashBuildingFilter = 'rooms';
      document.querySelectorAll('#page-dashboard .year-tabs').forEach((r,i)=>{
        if(i===1) r.querySelectorAll('.year-tab').forEach(b=>b.classList.remove('active'));
      });
      if(btnRooms) btnRooms.classList.add('active');
    }
  }
}

function setBuilding(filter, btn) {
  window.dashBuildingFilter = filter;
  // Update active state on building filter row only (second year-tabs row)
  const rows = document.querySelectorAll('#page-dashboard .year-tabs');
  if (rows[1]) rows[1].querySelectorAll('.year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  initDashboardCharts();
}

// Load dashboard data from Firebase - aggregates meter readings into monthly totals
async function loadDashboardDataFromFirebase() {
  try {
    // Get Firestore references
    if (!window.firebase || !window.firebase.firestore) {
      return null;
    }

    // Skip if not authenticated — Firestore rules require auth
    if (!window.firebaseAuth?.currentUser) {
      return null;
    }

    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;

    // Query all meter_data documents from both buildings
    const meterDocsSnapshot = await fs.getDocs(fs.collection(db, 'meter_data'));

    // Initialize data structure
    const aggregated = {};

    // Process each meter document
    meterDocsSnapshot.forEach(doc => {
      const data = doc.data();
      const building = data.building; // 'rooms' or 'nest'
      const yearMonth = data.yearMonth; // format: '67_1', '67_2', etc.

      if (!yearMonth) return; // Skip if no yearMonth

      const [year, monthStr] = yearMonth.split('_');
      const month = parseInt(monthStr);

      if (!aggregated[year]) {
        aggregated[year] = { label: `ปี ${2500 + parseInt(year)} (${year})`, months: Array(12).fill(null) };
      }

      // Get existing month data or create new
      let monthData = aggregated[year].months[month - 1];
      if (!monthData) {
        monthData = [0, 0, 0, 0]; // [rent, electric, water, total]
      }

      // Get active rooms for this building
      const activeRooms = RoomConfigManager ? RoomConfigManager.getAllRooms(building) : [];
      const tenants = loadTenants();

      // Aggregate rent from active rooms (only count occupied rooms)
      let rentTotal = 0;
      activeRooms.forEach(roomId => {
        if (tenants[roomId]?.name) { // Only count occupied rooms
          const room = RoomConfigManager ? RoomConfigManager.getRoom(building, roomId) : null;
          rentTotal += (room?.rentPrice || 0);
        }
      });

      // Aggregate electricity and water from meter readings
      let elecTotal = 0;
      let waterTotal = 0;

      // data contains { roomId: { eNew, eOld, wNew, wOld }, ... }
      Object.entries(data.rooms || {}).forEach(([roomId, readings]) => {
        if (readings && typeof readings === 'object') {
          const eUsage = (readings.eNew || 0) - (readings.eOld || 0);
          const wUsage = (readings.wNew || 0) - (readings.wOld || 0);

          // Get room rates
          const room = RoomConfigManager ? RoomConfigManager.getRoom(building, roomId) : null;
          const elecRate = room?.electricRate || 8;
          const waterRate = room?.waterRate || 20;

          elecTotal += eUsage * elecRate;
          waterTotal += wUsage * waterRate;
        }
      });

      // ✅ FIXED: ADD to existing month data (combines multiple buildings) instead of overwriting
      monthData[0] += Math.round(rentTotal); // rent
      monthData[1] += Math.round(elecTotal); // electricity
      monthData[2] += Math.round(waterTotal); // water
      monthData[3] = monthData[0] + monthData[1] + monthData[2]; // total

      aggregated[year].months[month - 1] = monthData;
    });

    // Format to match DATA structure
    const result = {};
    Object.entries(aggregated).forEach(([year, data]) => {
      result[year] = data;
    });

    return Object.keys(result).length > 0 ? result : null;
  } catch(err) {
    console.error('Error loading Firebase data:', err);
    return null;
  }
}

// Phase 2c: re-render dashboard charts whenever HistoricalDataStore cloud data
// arrives (handles F5 → Firestore subscribe lag where localStorage is empty).
// Polls until HistoricalDataStore exists, then registers the listener immediately.
if (typeof window !== 'undefined' && !window._dashHistSubscribed) {
  window._dashHistSubscribed = true;
  (function _waitForHistStore() {
    if (typeof HistoricalDataStore !== 'undefined' && HistoricalDataStore.onChange) {
      HistoricalDataStore.onChange(() => {
        if (typeof initDashboardCharts === 'function') {
          try { initDashboardCharts(); } catch(e){}
        }
      });
    } else {
      setTimeout(_waitForHistStore, 100);
    }
  })();
}

// Phase 5 race fix: re-render UI pages when RTDB rooms_config lands (F5 + cloud lag)
if (typeof window !== 'undefined' && !window._roomConfigListenerAdded) {
  window._roomConfigListenerAdded = true;
  document.addEventListener('roomconfig-updated', () => {
    // Re-render whichever admin page is currently showing room data
    try {
      if (document.getElementById('page-bill')?.classList.contains('active')) {
        if (typeof populateRoomDropdown === 'function') populateRoomDropdown();
        if (typeof renderPaymentStatus === 'function') renderPaymentStatus();
      }
      if (document.getElementById('page-tenant')?.classList.contains('active')
          && typeof initTenantPage === 'function') {
        initTenantPage();
      }
      if (document.getElementById('page-property')?.classList.contains('active')) {
        if (typeof initRoomsPage === 'function') initRoomsPage();
        if (typeof initNestPage === 'function') initNestPage();
      }
      if (document.getElementById('page-dashboard')?.classList.contains('active')
          && typeof initDashboardCharts === 'function') {
        initDashboardCharts();
      }
    } catch(e) { console.warn('roomconfig-updated rerender:', e?.message); }
  });
}

async function initDashboardCharts(){
  const yr=currentYear;
  let labels,totals,elecs,waters,rents;

  // Try to load from Firebase first
  let firebaseData = null;
  try {
    if(window.firebase && window.firebase.firestore) {
      firebaseData = await loadDashboardDataFromFirebase();
      console.log('✅ Loaded dashboard data from Firebase');
    }
  } catch(err) {
    console.log('⚠️ Firebase dashboard load failed:', err.message);
  }

  // Use HISTORICAL_DATA first (imported bills take priority), then Firebase
  // Phase 2c: pull from HistoricalDataStore so cloud-only years are visible
  const historicalData = (typeof HistoricalDataStore !== 'undefined')
    ? HistoricalDataStore.getAll()
    : JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const dataSource = historicalData && Object.keys(historicalData).length > 0 ? historicalData : (firebaseData || {});

  // ─── HELPER: รองรับ 2 รูปแบบ month entry ───
  // รูปแบบเก่า (Firebase): Array [rent, elec, water, grandTotal]  → idx 3 = total
  // รูปแบบใหม่ (HISTORICAL_DATA): Object { total:[rent,elec,water,trash,grandTotal], rooms:[...], nest:[...], amazon:[...] }
  const mv  = (m, idx) => !m ? null : (Array.isArray(m) ? (m[idx] ?? null) : (m.total?.[idx] ?? null));
  const mgt = m => {
    if (!m) return null;
    if (Array.isArray(m)) return m[3] ?? null;
    const fromTotal = m.total?.[4] ?? null;
    if (fromTotal > 0) return fromTotal;
    // Fallback: sum building grand totals (in case total[4] wasn't saved correctly)
    const sumBuildings = (m.rooms?.[4] || 0) + (m.nest?.[4] || 0) + (m.amazon?.[4] || 0);
    return sumBuildings > 0 ? sumBuildings : fromTotal;
  }; // grand total
  const mbuild = (m, bld, idx) => !m || Array.isArray(m) ? null : (m[bld]?.[idx] ?? null); // building breakdown

  if(yr==='all'){
    labels=['67','68','69'].flatMap(y=>dataSource[y]?.months.map((_,i)=>MONTHS_TH[i+1]+"'"+y) || []);
    totals=['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mgt(m)) || []);
    elecs =['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,1)) || []);
    waters=['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,2)) || []);
    rents =['67','68','69'].flatMap(y=>dataSource[y]?.months.map(m=>mv(m,0)) || []);
  } else {
    const d=dataSource[yr];
    if(d){
      labels=d.months.map((_,i)=>MONTHS_TH[i+1]);
      totals=d.months.map(m=>mgt(m));
      elecs =d.months.map(m=>mv(m,1));
      waters=d.months.map(m=>mv(m,2));
      rents =d.months.map(m=>mv(m,0));
    } else {
      labels=[]; totals=[]; elecs=[]; waters=[]; rents=[];
    }
  }

  const valid=totals.filter(v=>v!=null&&v>0);
  const total=valid.reduce((a,b)=>a+b,0);
  const avg=valid.length?Math.round(total/valid.length):0;
  const maxV=valid.length?Math.max(...valid):0;
  const maxIdx=maxV>0?totals.findIndex(t=>t===maxV):-1;
  const rentT=rents.filter(Boolean).reduce((a,b)=>a+b,0);
  const elecT=elecs.filter(Boolean).reduce((a,b)=>a+b,0);
  const waterT=waters.filter(Boolean).reduce((a,b)=>a+b,0);

  document.getElementById('kpi-total').textContent='฿'+total.toLocaleString();
  const yearLabel=yr==='all'?'ปี 2567-2569':dataSource[yr]?.label||`ปี ${2500+parseInt(yr)} (${yr})`;
  document.getElementById('kpi-total-sub').textContent=yearLabel+' · '+valid.length+' เดือน';
  document.getElementById('kpi-monthly').textContent='฿'+avg.toLocaleString();
  document.getElementById('kpi-monthly-sub').textContent=maxV>0?('สูงสุด: ฿'+maxV.toLocaleString()+(maxIdx>=0&&MONTHS_TH[maxIdx+1]?' ('+MONTHS_TH[maxIdx+1]+')':'')):'—';

  // ─── Building breakdown from HISTORICAL_DATA ───
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest  = getActiveRoomsWithMetadata('nest',  window.NEST_ROOMS);
  const tenants = loadTenants();
  const occupiedRooms = activeRooms.filter(r=>tenants[r.id]?.name).length;
  const occupiedNest  = activeNest.filter(r=>tenants[r.id]?.name).length;

  let yearlyRoomsTotal=0, yearlyNestTotal=0, yearlyAmazonTotal=0;
  let yearlyRoomsRent=0, yearlyNestRent=0;

  const yearsToSum = yr==='all'?['67','68','69']:[yr];
  yearsToSum.forEach(y=>{
    (dataSource[y]?.months||[]).forEach(month=>{
      if(!month)return;
      if(!Array.isArray(month)){
        // New object format — sum per building
        yearlyRoomsTotal  += (month.rooms?.[4]  || 0);
        yearlyNestTotal   += (month.nest?.[4]   || 0);
        yearlyAmazonTotal += (month.amazon?.[4] || 0);
        yearlyRoomsRent   += (month.rooms?.[0]  || 0);
        yearlyNestRent    += (month.nest?.[0]   || 0);
      }
    });
  });

  // Fallback: estimate from active tenants if no historical data
  const estRoomsMonthly = activeRooms.filter(r=>tenants[r.id]?.name).reduce((s,r)=>s+(r.rentPrice||0),0);
  const estNestMonthly  = activeNest.filter(r=>tenants[r.id]?.name).reduce((s,r)=>s+(r.rentPrice||0),0);
  const mCount = valid.length || 1;

  // Potential Revenue (100% occupancy)
  const potentialRoomsMonthly = activeRooms.reduce((s,r)=>s+(r.rentPrice||0),0);
  const potentialNestMonthly  = activeNest.reduce((s,r)=>s+(r.rentPrice||0),0);

  const kpiRooms = yearlyRoomsTotal>0 ? yearlyRoomsTotal : estRoomsMonthly*mCount;
  const kpiNest  = yearlyNestTotal>0  ? yearlyNestTotal  : estNestMonthly*mCount;

  document.getElementById('kpi-rooms-total').textContent='฿'+kpiRooms.toLocaleString();
  document.getElementById('kpi-rooms-sub').textContent=yearlyRoomsTotal>0
    ? `เช่า ฿${Math.round(yearlyRoomsRent/mCount).toLocaleString()}/เดือน · Potential ฿${potentialRoomsMonthly.toLocaleString()}/เดือน`
    : `${occupiedRooms}/${activeRooms.length} ห้อง · Potential ฿${potentialRoomsMonthly.toLocaleString()}/เดือน`;

  if (yr !== '69' && yr !== 'all') {
    document.getElementById('kpi-nest-total').textContent = '—';
    document.getElementById('kpi-nest-sub').textContent = 'ยังไม่มีตึกนี้ในปีนั้น';
  } else {
    document.getElementById('kpi-nest-total').textContent='฿'+kpiNest.toLocaleString();
    document.getElementById('kpi-nest-sub').textContent=yearlyNestTotal>0
      ? `เช่า ฿${Math.round(yearlyNestRent/mCount).toLocaleString()}/เดือน · Potential ฿${potentialNestMonthly.toLocaleString()}/เดือน`
      : `${occupiedNest}/${activeNest.length} ยูนิต · Potential ฿${potentialNestMonthly.toLocaleString()}/เดือน`;
  }

  // ─── Insight cards ───
  document.getElementById('ins-rent').textContent  = rentT >0?'฿'+rentT.toLocaleString() :'—';
  document.getElementById('ins-elec').textContent  = elecT >0?'฿'+elecT.toLocaleString() :'—';
  document.getElementById('ins-water').textContent = waterT>0?'฿'+waterT.toLocaleString():'—';
  const avgRentPerMonth = rents.filter(Boolean).length>0 ? Math.round(rentT/rents.filter(Boolean).length) : 0;
  document.getElementById('ins-rent-d').textContent = avgRentPerMonth>0
    ? `เฉลี่ย ฿${avgRentPerMonth.toLocaleString()}/เดือน · ${rents.filter(Boolean).length} เดือน`
    : 'รวมห้องพักทั้งหมด';

  // ─── Trend arrows: compare last month vs previous month ───
  const trendArrow = arr => {
    const valid = arr.filter(v => v > 0);
    if (valid.length < 2) return '';
    const last = valid[valid.length-1], prev = valid[valid.length-2];
    const pct = Math.round((last-prev)/prev*100);
    return pct > 0 ? ` ⬆️ +${pct}%` : pct < 0 ? ` ⬇️ ${pct}%` : ' ➡️ 0%';
  };
  const rentTrend  = trendArrow(rents);
  const elecTrend  = trendArrow(elecs);
  const waterTrend = trendArrow(waters);
  if (rentTrend)  document.getElementById('ins-rent-d').textContent  += rentTrend + ' จากเดือนก่อน';

  // ─── Last 12 months table (filtered by selected year) ───
  renderLast6MonthsTable(dataSource, mv, mgt, yr);

  const mkChart=(id,type,data,opts)=>{
    const el=document.getElementById(id);
    if(!el)return null;
    Chart.getChart(el)?.destroy();
    return new Chart(el.getContext('2d'),{type,data,options:{responsive:true,maintainAspectRatio:false,...opts}});
  };

  // Revenue chart: filter months with total data
  const chartLabels=[], chartTotals=[], chartElecs=[], chartWaters=[], chartRents=[];
  labels.forEach((lbl,i)=>{
    if(totals[i]!=null){
      chartLabels.push(lbl);
      chartTotals.push(totals[i]);
      chartElecs.push(elecs[i]  || 0);
      chartWaters.push(waters[i] || 0);
      chartRents.push(rents[i]  || 0);
    }
  });

  // Elec/Water charts: same year selection + same filter as table (mgt > 0)
  // ensures charts always show identical months to what table shows
  const elecChartLabels=[], elecChartData=[], waterChartLabels=[], waterChartData=[];
  const utilYears = yr === 'all' ? ['67','68','69'] : [yr];
  utilYears.forEach(y=>{
    (dataSource[y]?.months||[]).forEach((m,i)=>{
      if(!m || !(mgt(m)>0)) return;
      const lbl = MONTHS_TH[i+1] + (utilYears.length>1 ? `'${y}` : '');
      elecChartLabels.push(lbl); elecChartData.push(mv(m,1)||0);
      waterChartLabels.push(lbl); waterChartData.push(mv(m,2)||0);
    });
  });

  chartRevenue=mkChart('chartRevenue','bar',{labels:chartLabels,datasets:[
    {label:'ค่าเช่า',data:chartRents, backgroundColor:'rgba(45,134,83,.75)', stack:'s',borderRadius:3},
    {label:'ค่าไฟ', data:chartElecs, backgroundColor:'rgba(255,143,0,.75)',  stack:'s'},
    {label:'ค่าน้ำ', data:chartWaters,backgroundColor:'rgba(33,150,243,.75)', stack:'s'},
    {label:`เฉลี่ย ฿${avg.toLocaleString()}`,data:chartLabels.map(()=>avg),type:'line',borderColor:'rgba(0,0,0,.4)',borderDash:[6,4],pointRadius:0,borderWidth:2,fill:false,stack:'',order:0,yAxisID:'y'}
  ]},{plugins:{legend:{position:'bottom',labels:{font:{size:10},padding:8}},tooltip:{callbacks:{label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{x:{stacked:true,grid:{display:false},ticks:{maxRotation:45}},y:{stacked:true,ticks:{callback:v=>'฿'+(v/1000).toFixed(0)+'K'},grid:{color:'rgba(0,0,0,.04)'}}}});

  const avgE=chartElecs.filter(Boolean).length?Math.round(elecT/chartElecs.filter(Boolean).length):0;
  const avgW=chartWaters.filter(Boolean).length?Math.round(waterT/chartWaters.filter(Boolean).length):0;
  const elecDEl  = document.getElementById('ins-elec-d');
  const waterDEl = document.getElementById('ins-water-d');
  if (elecDEl)  elecDEl.textContent  = `เฉลี่ย ฿${avgE.toLocaleString()}/เดือน${elecTrend ? elecTrend+' จากเดือนก่อน' : ''}`;
  if (waterDEl) waterDEl.textContent = `เฉลี่ย ฿${avgW.toLocaleString()}/เดือน${waterTrend ? waterTrend+' จากเดือนก่อน' : ''}`;
  const avgR=rents.filter(Boolean).length?Math.round(rentT/rents.filter(Boolean).length):0;
  const avgOth=Math.max(0,avg-avgR-avgE-avgW);
  const pieTotal=avgR+avgE+avgW+avgOth||1;
  const piePct=v=>Math.round(v/pieTotal*100);
  chartPie=mkChart('chartPie','doughnut',{labels:[`ค่าเช่าห้อง ${piePct(avgR)}%`,`ค่าไฟ ${piePct(avgE)}%`,`ค่าน้ำ ${piePct(avgW)}%`,`อื่นๆ ${piePct(avgOth)}%`],datasets:[{data:[avgR,avgE,avgW,avgOth],backgroundColor:['#2d8653','#ff8f00','#2196f3','#9c27b0'],borderWidth:0,hoverOffset:8}]},{plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:12}},tooltip:{callbacks:{label:c=>c.label+': ฿'+Math.round(c.raw).toLocaleString()}}}});

  const yrAvgs=['67','68','69'].map(y=>{const v=(dataSource[y]?.months||[]).filter(m=>mgt(m)>0);return v.length?Math.round(v.reduce((a,m)=>a+mgt(m),0)/v.length):0;});
  const yrHasData=y=>(dataSource[y]?.months||[]).some(m=>mgt(m)>0);
  const yrLabels=['67','68','69'].map(y=>yrHasData(y)?`${2500+parseInt(y)}\n(Actual)`:`${2500+parseInt(y)}\n(Forecast)`);
  chartYears=mkChart('chartYears','bar',{labels:yrLabels,datasets:[{label:'เฉลี่ย/เดือน',data:yrAvgs,backgroundColor:['#2d8653','#1976d2','#ff8f00'],borderRadius:8}]},{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{y:{ticks:{callback:v=>'฿'+(v/1000).toFixed(0)+'K'},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false},ticks:{font:{size:9}}}}});

  const lineOpts=()=>({layout:{padding:{right:8}},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items[0]?.label||'',label:c=>'฿'+(c.raw||0).toLocaleString()}}},scales:{y:{ticks:{callback:v=>'฿'+(v/1000).toFixed(1)+'K'},grid:{color:'rgba(0,0,0,.04)'}},x:{grid:{display:false},ticks:{autoSkip:true,maxTicksLimit:8,maxRotation:60,minRotation:30,font:{size:8}}}}});
  chartElec =mkChart('chartElec','line', {labels:elecChartLabels,datasets:[{label:'ค่าไฟ', data:elecChartData, borderColor:'#ff8f00',backgroundColor:'rgba(255,143,0,.1)',fill:true,tension:.4,pointRadius:4,pointHoverRadius:6}]},lineOpts());
  chartWater=mkChart('chartWater','line',{labels:waterChartLabels,datasets:[{label:'ค่าน้ำ',data:waterChartData,borderColor:'#2196f3',backgroundColor:'rgba(33,150,243,.1)',fill:true,tension:.4,pointRadius:4,pointHoverRadius:6}]},lineOpts());
}

// ─── Render last-12-months summary table ───
function renderLast6MonthsTable(dataSource, mv, mgt, yr) {
  const el = document.getElementById('dash-last6-body');
  if (!el) return;

  // Update table title based on selected year
  const titleEl = document.getElementById('dash-last6-title');
  if (titleEl) {
    if (!yr || yr === 'all') {
      titleEl.textContent = '📅 รายได้ย้อนหลัง 12 เดือน (ล่าสุด)';
    } else {
      titleEl.textContent = `📅 รายได้ทั้งปี ${2500+parseInt(yr)} (12 เดือน)`;
    }
  }

  // Flatten months — only from the selected year (or all years if 'all')
  const yearsToRender = (!yr || yr === 'all') ? ['67','68','69'] : [yr];
  const allEntries = [];
  yearsToRender.forEach(y => {
    (dataSource[y]?.months || []).forEach((m, idx) => {
      if (mgt(m) > 0) {
        allEntries.push({
          label: MONTHS_TH[idx+1] + (yearsToRender.length > 1 ? ' ' + (2500+parseInt(y)) : ''),
          rent:  mv(m,0) || 0,
          elec:  mv(m,1) || 0,
          water: mv(m,2) || 0,
          trash: mv(m,3) || 0,
          total: mgt(m)  || 0,
          rooms: Array.isArray(m) ? null : m.rooms,
          nest:  Array.isArray(m) ? null : m.nest,
          amazon:Array.isArray(m) ? null : m.amazon
        });
      }
    });
  });

  // For 'all': take last 12 across years. For specific year: show all months in that year.
  const last6 = (!yr || yr === 'all') ? allEntries.slice(-12).reverse() : allEntries.slice().reverse();

  if (last6.length === 0) {
    el.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">ยังไม่มีข้อมูล — นำเข้าบิลก่อน</td></tr>`;
    return;
  }

  const bldFilter = window.dashBuildingFilter || 'all';
  el.innerHTML = last6.map(row => {
    const roomsTotal  = row.rooms?.[4]  || 0;
    const nestTotal   = row.nest?.[4]   || 0;
    const amazonTotal = row.amazon?.[4] || 0;
    const hasBreakdown = row.rooms !== null;
    let dRent, dElec, dWater, dTotal, dBreakdown;
    if (bldFilter === 'rooms' && hasBreakdown) {
      dRent = row.rooms[0]||0; dElec = row.rooms[1]||0; dWater = row.rooms[2]||0;
      dTotal = row.rooms[4]||0; dBreakdown = '🏠 ห้องแถว';
    } else if (bldFilter === 'nest' && hasBreakdown) {
      dRent = row.nest[0]||0; dElec = row.nest[1]||0; dWater = row.nest[2]||0;
      dTotal = row.nest[4]||0; dBreakdown = '🏢 Nest';
    } else {
      dRent = row.rent; dElec = row.elec; dWater = row.water; dTotal = row.total;
      dBreakdown = hasBreakdown ? `🏠${roomsTotal.toLocaleString()} 🏢${nestTotal.toLocaleString()}${amazonTotal?' 🏪'+amazonTotal.toLocaleString():''}` : '—';
    }
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:.55rem .7rem;font-weight:700;">${row.label}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#2d8653;">฿${dRent.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#ff8f00;">฿${dElec.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;color:#2196f3;">฿${dWater.toLocaleString()}</td>
      <td style="padding:.55rem .7rem;text-align:right;font-size:.78rem;color:#666;">${dBreakdown}</td>
      <td style="padding:.55rem .7rem;text-align:right;font-weight:800;color:var(--green-dark);">฿${dTotal.toLocaleString()}</td>
    </tr>`;
  }).join('');
}

// ===== MONTHLY METER TABLE =====
// ===== Tracking start date (เริ่มติดตามการชำระ) =====
window.loadTrackingStart = function(){
  const raw = localStorage.getItem('system_tracking_start');
  if(!raw) return null; // no limit set
  const [y, m] = raw.split('-').map(Number);
  if(!y || !m) return null;
  return { year: y, month: m };
};
window.saveTrackingStart = function(){
  const m = parseInt(document.getElementById('tracking-start-month').value);
  const y = parseInt(document.getElementById('tracking-start-year').value);
  if(!m || !y){ alert('กรุณาเลือกเดือน/ปี'); return; }
  localStorage.setItem('system_tracking_start', `${y}-${String(m).padStart(2,'0')}`);
  const info = document.getElementById('tracking-start-info');
  if(info) info.textContent = `✅ บันทึกแล้ว: ${m}/${y}`;
  if(typeof renderMeterTable === 'function') renderMeterTable();
  setTimeout(()=>{ if(info) info.textContent = `บันทึกล่าสุด: ${m}/${y}`; }, 2000);
};
// Returns true if selected year/month is BEFORE tracking start (i.e. archived)
window.isArchivedMonth = function(year, month){
  const t = window.loadTrackingStart();
  if(!t) return false;
  return (year < t.year) || (year === t.year && month < t.month);
};

window._pvmBuilding = 'rooms';
window.setPVMBuilding = function(bld, btn){
  window._pvmBuilding = bld;
  document.querySelectorAll('#pv-tab-monthly .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const label = bld==='nest' ? 'Nest' : 'ห้องแถว';
  const secT = document.getElementById('pvm-section-title');
  if(secT) secT.innerHTML = `📋 สถานะชำระรายเดือน &amp; ห้องว่าง — ${label}`;
  const tabT = document.getElementById('pvm-table-title');
  if(tabT) tabT.innerHTML = `📋 ตารางมิเตอร์ &amp; สถานะชำระ — ${label}`;
  if(typeof renderMeterTable === 'function') renderMeterTable();
  const vcRes = document.getElementById('vc-result');
  if(vcRes) vcRes.innerHTML = '';
};

function renderMeterTable(){
  const el=document.getElementById('meterTableBody');if(!el)return;
  const month=parseInt(document.getElementById('mt-month')?.value||new Date().getMonth()+1);
  const year=parseInt(document.getElementById('mt-year')?.value||(new Date().getFullYear()+543));

  // Archived period: before tracking-start-date → render banner, skip per-room table
  if(window.isArchivedMonth && window.isArchivedMonth(year, month)){
    const t = window.loadTrackingStart();
    const monthName=MONTHS_FULL[month]||month;
    el.innerHTML = `<div style="padding:2rem;text-align:center;background:#fafafa;border:2px dashed var(--border);border-radius:8px;">
      <div style="font-size:2rem;margin-bottom:.5rem;">📦</div>
      <div style="font-weight:700;margin-bottom:.4rem;">Archived — ${monthName} ${year}</div>
      <div style="font-size:.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">
        ก่อนเริ่มติดตามระบบ (${t.month}/${t.year}) — ไม่นับเป็น "ค้างชำระ"<br>
        ข้อมูลรายได้ย้อนหลังใช้จาก Excel HISTORICAL_DATA (ดูใน Meter → 📥 นำเข้าข้อมูลบิล)
      </div>
    </div>`;
    return;
  }

  const yy=year%100;
  const mdKey=`${yy}_${month}`;
  const psKey=`${year}_${month}`;
  const ps=loadPS();
  const paid=ps[psKey]||{};
  let totalPaid=0, totalPending=0, totalAmt=0;

  const bld = window._pvmBuilding || 'rooms';
  const roomList = bld==='nest' ? (window.NEST_ROOMS||[]) : (window.ROOMS_OLD||[]);
  const rooms = getActiveRoomsWithMetadata(bld, roomList);
  const rows=rooms.map(r=>{
    const lookupId=r.id;
    const md=(typeof METER_DATA!=='undefined'&&METER_DATA[bld]&&METER_DATA[bld][mdKey])?METER_DATA[bld][mdKey][lookupId]:null;
    const p=paid[r.id];
    // Prefer saved payment data, then METER_DATA, then —
    const eNew=p?.eNew!=null?p.eNew:(md?.eNew!=null?md.eNew:'—');
    const eOld=p?.eOld!=null?p.eOld:(md?.eOld!=null?md.eOld:'—');
    const wNew=p?.wNew!=null?p.wNew:(md?.wNew!=null?md.wNew:'—');
    const wOld=p?.wOld!=null?p.wOld:(md?.wOld!=null?md.wOld:'—');
    const eU=(typeof eNew==='number'&&typeof eOld==='number')?eNew-eOld:'—';
    const wU=(typeof wNew==='number'&&typeof wOld==='number')?wNew-wOld:'—';
    const isPaid=!!p;
    if(isPaid){totalPaid++;totalAmt+=p.amount||0;}else totalPending++;
    const statusCell=isPaid
      ?`<button class="mt-paid-badge" onclick="showPayDetail('${r.id}',${year},${month})">✅ จ่ายแล้ว ฿${(p.amount||0).toLocaleString()}</button>`
      :`<span class="mt-pending-badge">⏳ รอ</span>`;
    const actionCell=isPaid?''
      :`<button class="mt-go-btn" onclick="goBillFromTable('${r.id}',${year},${month})">📄 ออกบิล</button>`;
    const rowBg=isPaid?'':'';
    const meterStyle=md?'':'color:var(--text-muted);font-style:italic;';
    return`<tr style="${isPaid?'background:#fafffe;':''}">
      <td><strong style="${isPaid?'color:var(--green-dark);':''}">${r.id}</strong></td>
      <td style="font-size:.8rem;${meterStyle}">${eOld} → ${eNew}</td>
      <td style="${eU==='—'?'color:var(--text-muted);':eU>0?'color:var(--accent);font-weight:700;':'color:var(--red);'}">${eU}</td>
      <td style="font-size:.8rem;${meterStyle}">${wOld} → ${wNew}</td>
      <td style="${wU==='—'?'color:var(--text-muted);':wU>0?'color:var(--blue);font-weight:700;':'color:var(--red);'}">${wU}</td>
      <td>${statusCell}</td>
      <td>${actionCell}</td>
    </tr>`;
  });

  const monthName=MONTHS_FULL[month]||month;
  el.innerHTML=`
    <div class="mt-summary">
      <strong>${monthName} ${year}</strong>
      <span class="mt-pill green">✅ จ่ายแล้ว ${totalPaid} ห้อง · ฿${totalAmt.toLocaleString()}</span>
      <span class="mt-pill amber">⏳ รอ ${totalPending} ห้อง</span>
    </div>
    <div class="scroll-x">
      <table class="data-table">
        <thead><tr>
          <th>ห้อง</th><th>มิเตอร์ไฟ (เดิม→ล่าสุด)</th><th>หน่วยไฟ</th>
          <th>มิเตอร์น้ำ (เดิม→ล่าสุด)</th><th>หน่วยน้ำ</th><th>สถานะ</th><th>ดำเนินการ</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

function goBillFromTable(roomId, year, month){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-bill').classList.add('active');
  document.querySelector('.nav-btn[onclick*="\'bill\'"]')?.classList.add('active');
  if(month)document.getElementById('f-month').value=month;
  if(year)document.getElementById('f-year').value=year;
  const wantBld = (window._pvmBuilding === 'nest') ? 'new' : 'old';
  if(document.getElementById('f-building').value !== wantBld){
    document.getElementById('f-building').value = wantBld;
    onBuildingChange();
  }
  document.getElementById('f-room').value=roomId;
  onRoomChange();
  document.getElementById('f-room').scrollIntoView({behavior:'smooth',block:'center'});
}

// ===== DASHBOARD LIVE UPDATES =====
function updateDashboardLive(){
  // Ensure data is available (both buildings)
  if(!window.ROOMS_OLD || window.ROOMS_OLD.length === 0) {
    console.warn('⚠️ window.ROOMS_OLD data not available yet, retrying...');
    setTimeout(updateDashboardLive, 200);
    return;
  }
  if(!window.NEST_ROOMS || window.NEST_ROOMS.length === 0) {
    console.warn('⚠️ window.NEST_ROOMS data not available yet, retrying...');
    setTimeout(updateDashboardLive, 200);
    return;
  }

  const now=new Date();
  const currentDate=now.getFullYear()+543;
  const currentMonth=now.getMonth()+1;

  // Specific year selected — live cards are hidden by setYear(), nothing to render
  if(currentYear !== 'all') return;

  const month=currentMonth;
  const year=currentDate;
  const ps=loadPS();
  const key=`${year}_${month}`;
  const paid=ps[key]||{};
  const paidCount=Object.keys(paid).length;

  // Rooms building only — Nest ยังไม่เปิด (มิถุนายน 2569)
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest = []; // exclude Nest until it opens
  const allActiveRooms = [...activeRooms];
  const totalRooms = allActiveRooms.length;

  // Calculate paid for both buildings
  const paidCountAll = Object.keys(paid).length;
  // For now, use combined total
  const paidCountRooms = Object.keys(paid).filter(k => activeRooms.map(r => r.id).includes(k)).length;
  const paidCountNest = Object.keys(paid).filter(k => activeNest.map(r => r.id).includes(k)).length;
  const pendingCount=totalRooms-paidCountAll;
  const totalCollected=Object.values(paid).reduce((a,p)=>a+(p.amount||0),0);

  // KPI: paid this month (COMBINED - both buildings)
  const kpiPN=document.getElementById('kpi-paid-now');
  const kpiPNS=document.getElementById('kpi-paid-now-sub');
  if(kpiPN)kpiPN.textContent=`${paidCountAll}/${totalRooms}`;
  if(kpiPNS)kpiPNS.textContent=`฿${totalCollected.toLocaleString()} · รอ ${pendingCount} ห้อง`;

  // KPI: occupancy from tenant data (COMBINED - both buildings)
  const tenants=loadTenants();
  const occCountRooms=activeRooms.filter(r=>tenants[r.id]?.name).length;
  const occCountNest=activeNest.filter(r=>tenants[r.id]?.name).length;
  const occCount = occCountRooms + occCountNest;
  const kpiOcc=document.getElementById('kpi-occupancy');
  const kpiOccS=document.getElementById('kpi-occupancy-sub');
  if(kpiOcc)kpiOcc.textContent=`${Math.round(occCount/totalRooms*100)}%`;
  if(kpiOccS)kpiOccS.textContent=`มีผู้เช่า ${occCount} · ว่าง ${totalRooms-occCount} ห้อง`;

  // KPI: Expected Revenue (this month from occupied rooms - COMBINED)
  // getActiveRoomsWithMetadata returns rentPrice (not rent)
  const expectedRevenueRooms=activeRooms.filter(r=>tenants[r.id]?.name).reduce((sum,r)=>sum+(r.rentPrice||0),0);
  const expectedRevenueNest=activeNest.filter(r=>tenants[r.id]?.name).reduce((sum,r)=>sum+(r.rentPrice||0),0);
  const expectedRevenue=expectedRevenueRooms + expectedRevenueNest;
  const kpiExp=document.getElementById('kpi-expected');
  const kpiExpS=document.getElementById('kpi-expected-sub');
  if(kpiExp)kpiExp.textContent=`฿${expectedRevenue.toLocaleString()}`;
  if(kpiExpS)kpiExpS.textContent=`จากห้องที่มีผู้เช่า ${occCount} ห้อง`;

  // KPI: Overdue Rent (ค้างชำระทั้งสิ้น) = expected this month minus already collected
  const overdueAmount=Math.max(0, expectedRevenue - totalCollected);
  const kpiOD=document.getElementById('kpi-overdue');
  const kpiODS=document.getElementById('kpi-overdue-sub');
  if(kpiOD)kpiOD.textContent=`฿${overdueAmount.toLocaleString()}`;
  if(kpiODS)kpiODS.textContent=`${pendingCount} ห้อง ยังไม่จ่ายเดือนนี้`;

  // Quick payment panel (COMBINED)
  const dashPay=document.getElementById('dashPaymentStatus');
  if(dashPay){
    const pendingRoomsArr=activeRooms.filter(r=>!paid[r.id]).map(r=>r.id);
    const pendingNestArr=activeNest.filter(r=>!paid[r.id]).map(r=>r.id);
    const allPending=[...pendingRoomsArr, ...pendingNestArr];
    const overdueCount = pendingCount; // rooms not yet paid this month
    dashPay.innerHTML=`
      <div style="display:flex;gap:1.4rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${paidCountAll}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ จ่ายแล้ว</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${pendingCount}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">⏳ รอชำระ</div></div>
        ${overdueCount?`<div><div style="font-size:1.5rem;font-weight:800;color:#dc2626">${overdueCount}</div><div style="font-size:.72rem;color:#dc2626;font-weight:600;">🔴 ค้างชำระ</div></div>`:''}
        <div><div style="font-size:1.15rem;font-weight:800;color:var(--green-dark)">฿${totalCollected.toLocaleString()}</div><div style="font-size:.72rem;color:var(--text-muted)">เก็บได้แล้ว</div></div>
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:3px;">🏠 Rooms: ${paidCountRooms}/${activeRooms.length} | 🏢 Nest: ${paidCountNest}/${activeNest.length}</div>
      ${allPending.length?`<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:5px;">ยังไม่จ่าย:</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${allPending.map(r=>`<span onclick="goBillFromTable('${r}',${year},${month})" style="padding:2px 8px;border-radius:20px;font-size:.72rem;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;cursor:pointer;">⏳${r}</span>`).join('')}</div>`
      :'<div style="color:var(--green);font-weight:700;font-size:.86rem;">🎉 เก็บค่าเช่าครบทุกห้องแล้ว!</div>'}`;
  }

  // Quick tenant panel (COMBINED from both buildings)
  const dashTen=document.getElementById('dashTenantStatus');
  if(dashTen){
    const today=new Date();
    const vacantRoomsRooms=activeRooms.filter(r=>!tenants[r.id]?.name).map(r=>r.id);
    const vacantRoomsNest=activeNest.filter(r=>!tenants[r.id]?.name).map(r=>r.id);
    const allVacant=[...vacantRoomsRooms, ...vacantRoomsNest];
    const soonRooms=activeRooms.filter(r=>{
      const t=tenants[r.id];
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    });
    const soonNest=activeNest.filter(r=>{
      const t=tenants[r.id];
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    });
    const allSoon=[...soonRooms, ...soonNest];
    const occRate = totalRooms>0 ? Math.round(occCount/totalRooms*100) : 0;
    dashTen.innerHTML=`
      <div style="display:flex;gap:1.4rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <div><div style="font-size:1.5rem;font-weight:800;color:var(--blue)">${occCount}</div><div style="font-size:.72rem;color:var(--text-muted)">มีผู้เช่า</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent)">${totalRooms-occCount}</div><div style="font-size:.72rem;color:var(--text-muted)">ห้องว่าง</div></div>
        <div><div style="font-size:1.5rem;font-weight:800;color:${occRate>=80?'#2d8653':occRate>=60?'#f59e0b':'#dc2626'}">${occRate}%</div><div style="font-size:.72rem;color:var(--text-muted)">Occupancy Rate</div></div>
        ${allSoon.length?`<div><div style="font-size:1.5rem;font-weight:800;color:var(--red)">${allSoon.length}</div><div style="font-size:.72rem;color:var(--text-muted)">สัญญาใกล้หมด</div></div>`:''}
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:3px;">🏠 Rooms: ${occCountRooms}/${activeRooms.length} | 🏢 Nest: ${occCountNest}/${activeNest.length}</div>
      ${allVacant.length?`<div style="font-size:.74rem;color:var(--text-muted);">ว่าง: ${allVacant.slice(0,8).join(', ')}${allVacant.length>8?'...':''}</div>`
      :'<div style="color:var(--green);font-weight:700;font-size:.85rem;">✅ ไม่มีห้องว่าง</div>'}
      ${allSoon.length?`<div style="font-size:.74rem;color:var(--red);margin-top:4px;">⚠️ สัญญาใกล้หมด: ${allSoon.map(r=>r.id).join(', ')}</div>`:''}`;
  }

  // Complaints mini-stats
  const dashComp = document.getElementById('dashComplaintsStatus');
  if(dashComp) {
    const comp = JSON.parse(localStorage.getItem('complaints_data') || '[]');
    const cOpen = comp.filter(c => c.status === 'open').length;
    const cInProg = comp.filter(c => c.status === 'in-progress').length;
    const cDone = comp.filter(c => c.status === 'resolved').length;
    dashComp.innerHTML = comp.length === 0
      ? '<div style="color:var(--text-muted);font-size:.85rem;">ไม่มีข้อร้องเรียน</div>'
      : `<div style="display:flex;gap:1.4rem;flex-wrap:wrap;">
          <div><div style="font-size:1.5rem;font-weight:800;color:#dc2626">${cOpen}</div><div style="font-size:.72rem;color:#dc2626;font-weight:600;">🔴 Open</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${cInProg}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">🟡 In Progress</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${cDone}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ Resolved</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--text-muted)">${comp.length}</div><div style="font-size:.72rem;color:var(--text-muted);font-weight:600;">Total</div></div>
        </div>`;
  }

  // Maintenance mini-stats
  const dashMx = document.getElementById('dashMaintenanceStatus');
  if(dashMx) {
    const mx = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
    const mxPending = mx.filter(r => r.status === 'pending' || r.status === 'open').length;
    const mxDone = mx.filter(r => r.status === 'completed' || r.status === 'done').length;
    const mxInProg = mx.filter(r => r.status === 'in-progress').length;
    dashMx.innerHTML = mx.length === 0
      ? '<div style="color:var(--text-muted);font-size:.85rem;">ไม่มีคำขอซ่อม</div>'
      : `<div style="display:flex;gap:1.4rem;flex-wrap:wrap;">
          <div><div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${mxPending}</div><div style="font-size:.72rem;color:#f59e0b;font-weight:600;">⏳ Pending</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#1976d2">${mxInProg}</div><div style="font-size:.72rem;color:#1976d2;font-weight:600;">🔨 In Progress</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#2d8653">${mxDone}</div><div style="font-size:.72rem;color:#2d8653;font-weight:600;">✅ Done</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:var(--text-muted)">${mx.length}</div><div style="font-size:.72rem;color:var(--text-muted);font-weight:600;">Total</div></div>
        </div>`;
  }

  updateNotificationBell();
  updateGamificationWidget();
  updatePetAnalyticsWidget();
  updateNavBadge();
  updateMxBadge();
}

function updateGamificationWidget() {
  const el = document.getElementById('dashTopTenants');
  if (!el) return;
  if (typeof TenantConfigManager === 'undefined') { el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีข้อมูล</div>'; return; }
  const all = [
    ...TenantConfigManager.getTenantList('rooms'),
    ...TenantConfigManager.getTenantList('nest')
  ].map(t => {
    const months = t.createdDate
      ? Math.min(120, Math.floor((Date.now() - new Date(t.createdDate).getTime()) / (1000*60*60*24*30)))
      : 0;
    const pts = months * 10;
    const rank = pts >= 1000 ? '🥇' : pts >= 500 ? '🥈' : '🥉';
    return { name: t.name || t.id, pts, rank, months };
  }).filter(t => t.name && t.name !== t.id).sort((a,b) => b.pts - a.pts).slice(0,3);

  if (all.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีผู้เช่า</div>'; return; }
  el.innerHTML = all.map((t, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:1.1rem;">${['🥇','🥈','🥉'][i]}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div>
        <div style="font-size:.7rem;color:var(--text-muted);">${t.months} เดือน</div>
      </div>
      <span style="font-size:.78rem;font-weight:800;color:var(--green-dark);">${t.pts} pts</span>
    </div>`).join('');
}

function updatePetAnalyticsWidget() {
  const el = document.getElementById('dashPetAnalytics');
  const card = document.getElementById('dashPetAnalyticsCard');
  if (!el) return;
  const counts = {};
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tenant_pets_')) {
      const pets = JSON.parse(localStorage.getItem(key) || '[]');
      pets.filter(p => p.status === 'approved').forEach(p => {
        const t = (p.type || 'other').toLowerCase();
        counts[t] = (counts[t] || 0) + 1;
        total++;
      });
    }
  }
  if (total === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem;">ยังไม่มีสัตว์เลี้ยงลงทะเบียน</div>';
    return;
  }
  const emojis = { dog:'🐕', cat:'🐈', rabbit:'🐇', bird:'🐦', fish:'🐠', hamster:'🐹' };
  el.innerHTML = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([type, cnt]) => {
    const pct = Math.round(cnt / total * 100);
    const em = emojis[type] || '🐾';
    return `<div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:2px;">
        <span>${em} ${type}</span><span style="font-weight:700;">${cnt} ตัว</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:6px;">
        <div style="background:var(--green);border-radius:4px;height:6px;width:${pct}%;transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('') + `<div style="font-size:.7rem;color:var(--text-muted);margin-top:4px;">รวม ${total} ตัว</div>`;
}

function updateNavBadge(){
  const badge=document.getElementById('billBadge');if(!badge)return;
  const now=new Date();
  const ps=loadPS();
  const key=`${now.getFullYear()+543}_${now.getMonth()+1}`;
  const paid=ps[key]||{};
  // Count both buildings
  const activeRooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const activeNest = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);
  const allActive = [...activeRooms, ...activeNest];
  const pending=allActive.length-Object.keys(paid).length;
  if(pending>0){badge.textContent=pending;badge.style.display='inline-block';}
  else{badge.style.display='none';}
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async ()=>{
  // Wait for Firebase to be initialized
  if (!window.firebaseReady) {
    console.log('⏳ Waiting for Firebase to initialize...');
    // Wait up to 10 seconds for Firebase
    let waitCount = 0;
    while (!window.firebaseReady && waitCount < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }
    if (!window.firebaseReady) {
      console.error('❌ Firebase failed to initialize');
      alert('Error: Firebase initialization failed. Please reload the page.');
      return;
    }
  }

  // ===== ACCESS CONTROL =====
  // Protect dashboard - admin only
  if (!AccessControl.protectPage('admin')) {
    console.error('❌ Access denied: This page is for admin only');
    AccessControl.logAccessAttempt('/dashboard', false);
    return;
  }
  AccessControl.logAccessAttempt('/dashboard', true);

  // Initialize all room users if not already done
  initializeAllRoomUsers();

  populateRoomDropdown();
  const now=new Date();
  document.getElementById('f-month').value=now.getMonth()+1;
  document.getElementById('f-year').value=now.getFullYear()+543;
  // Pre-select current month in vacant room checker
  document.getElementById('vc-month').value=now.getMonth()+1;
  renderPaymentStatus();
  // PromptPay is edited in People Management → Owner tab → per-building payment.
  // Legacy pp-input/pp-status DOM was removed; the old display-restore block is gone too.
  // Pre-select current month in meter table
  document.getElementById('mt-month').value=now.getMonth()+1;
  document.getElementById('mt-year').value=now.getFullYear()+543;
  // Sync year UI state immediately (hide/show live cards based on default currentYear)
  syncDashboardYearUI();
  // Delay KPI updates to ensure data is loaded from localStorage
  setTimeout(updateDashboardLive,100);
  setTimeout(initDashboardCharts,300);
});


