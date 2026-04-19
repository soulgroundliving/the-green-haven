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


