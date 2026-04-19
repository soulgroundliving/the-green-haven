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

// ===== ROOM FILTER STATE =====
let currentRoomFilter = 'all'; // all, occupied, vacant, overdue
let currentNestFilter = 'all'; // all, occupied, vacant, overdue

// ===== HELPER: Get active rooms with merged metadata =====
function getActiveRoomsWithMetadata(building, metadataArray) {
  // Get full room config from RoomConfigManager
  const config = RoomConfigManager.getRoomsConfig(building);
  const activeRooms = config.rooms.filter(r => !r.deleted);

  // Merge RoomConfigManager data with metadata (rent, type, trashFee, etc.)
  return activeRooms.map(r => {
    const metadata = metadataArray.find(m => m.id === r.id);
    // Prioritize rentPrice from RoomConfigManager, fall back to metadata or default
    const rentPrice = (r.rentPrice && r.rentPrice > 0) ? r.rentPrice : (metadata?.rent || 1500);
    // Return merged object with all properties
    return {
      id: r.id,
      name: r.name,
      waterRate: r.waterRate,
      electricRate: r.electricRate,
      deleted: r.deleted,
      rentPrice: rentPrice,
      type: metadata?.type || 'room',
      trashFee: metadata?.trashFee || 20,
      elecRate: metadata?.elecRate || r.electricRate,
      floor: metadata?.floor,
      note: metadata?.note,
      dailyRate: metadata?.dailyRate
    };
  });
}

// ===== ROOMS PAGE =====
function initRoomsPage(){
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();

  // Set up real-time Firebase listeners
  setupRoomDataListener();
  setupLeaseDataListener();
  setupMeterDataListener();
  console.log('✅ Real-time listeners activated for Rooms page');

  const allTenants = loadTenants();
  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  // Update info cards regardless of floor plan visibility
  updateRoomsInfoCards();
  updateShopInfoCard();

  const grid=document.getElementById('roomGrid');
  if(!grid) return;
  grid.innerHTML=rooms.map(r=>{
    const tenant = allTenants[r.id];
    const occupancyIcon = tenant && tenant.name ? '✅' : '🚪';
    const statusInfo = getRoomColorStatus(r.id, r);
    const bgColor = r.type==='commercial'?'rgba(66,133,244,0.15)':statusInfo.color+'40';
    const borderColor = r.type==='commercial'?'#4285f4':statusInfo.color;
    const displayId = (r.name || r.id).replace(/^ห้อง |^Nest /, '');
    return `
    <div class="room-pill ${r.type==='commercial'?'commercial':'occupied'}" onclick="openTenantModal('rooms', '${r.id}')" style="cursor:pointer;transition:transform 0.2s;background:${bgColor};border:2px solid ${borderColor};">
      <div class="room-num">${displayId}</div>
      <div class="room-rent">฿${r.rentPrice.toLocaleString()}/เดือน</div>
      <div class="room-status">${r.type==='commercial'?'🏪 พาณิชย์':occupancyIcon + (tenant && tenant.name ? ' ' + tenant.name : ' ว่าง')}</div>
      <div style="font-size:0.8rem;margin-top:4px;text-align:center;color:${borderColor};font-weight:600;">${statusInfo.icon} ${statusInfo.label}</div>
    </div>`;
  }).join('');

  const tbl=document.getElementById('roomTable');
  if(!tbl) return;
  const rentT=rooms.filter(r=>r.type==='room').reduce((a,r)=>a+r.rentPrice,0);
  const avgE=Math.round(12500/22),avgW=Math.round(3200/22);
  tbl.innerHTML=`
    <thead><tr><th>ห้องเลขที่</th><th>ประเภท</th><th>ค่าเช่า</th><th>อัตราไฟ</th><th>ค่าขยะ</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rooms.map(r=>`<tr>
      <td><strong>${r.id}</strong></td>
      <td><span class="badge ${r.type==='commercial'?'badge-blue':'badge-green'}">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span></td>
      <td style="font-weight:700;color:var(--green-dark)">฿${r.rentPrice.toLocaleString()}</td>
      <td>${r.elecRate} บาท/หน่วย</td>
      <td>฿${r.trashFee}</td>
      <td><span class="badge badge-green">✅ มีผู้เช่า</span></td>
      <td style="font-size:.8rem;color:var(--text-muted)">${r.note||'—'}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--green-pale);font-weight:700;">
      <td colspan="2">รวมห้องพัก (${rooms.length} ห้อง)</td>
      <td>฿${rentT.toLocaleString()}</td><td colspan="4">—</td>
    </tr></tfoot>`;

  renderCompactRoomGrid();

  // Add search functionality
  const searchInput=document.getElementById('roomCompactSearch');
  if(searchInput){
    searchInput.addEventListener('input',renderCompactRoomGrid);
  }

}

// ===== ROOM FILTER FUNCTION =====
function setRoomFilter(filter) {
  currentRoomFilter = filter;

  // Update button styles
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = 'white';
    btn.style.color = btn.style.borderColor;
  });

  // Find and style the active button
  const activeBtn = event.target;
  activeBtn.classList.add('active');
  activeBtn.style.background = activeBtn.style.borderColor || 'var(--green-dark)';
  activeBtn.style.color = 'white';

  renderCompactRoomGrid();
}

// ===== COMPACT ROOM GRID RENDERING =====
function renderCompactRoomGrid(){
  const allTenants = loadTenants();
  const searchInput=document.getElementById('roomCompactSearch');
  const searchTerm=(searchInput?.value||'').toLowerCase();
  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);

  // Apply search filter
  let filtered=rooms.filter(r=>r.id.toString().toLowerCase().includes(searchTerm) || (allTenants[r.id]?.name||'').toLowerCase().includes(searchTerm));

  // Apply status filter
  filtered = filtered.filter(r => {
    if (currentRoomFilter === 'all') return true;

    const statusInfo = getRoomColorStatus(r.id, r);
    const paymentStatus = getPaymentStatus(r.id);

    if (currentRoomFilter === 'occupied') return statusInfo.label === 'มี';
    if (currentRoomFilter === 'vacant') return statusInfo.label === 'ว่าง';
    if (currentRoomFilter === 'overdue') return paymentStatus === 'overdue';

    return true;
  });
  const grid=document.getElementById('roomCompactGrid');
  if(!grid) return;

  // Calculate contract expiry summary
  const today = new Date();
  const in30 = new Date(today.getTime() + 30*86400000);
  const in60 = new Date(today.getTime() + 60*86400000);

  const expiring30 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > today && exp <= in30;
  }).length;

  const expiring60 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > in30 && exp <= in60;
  }).length;

  grid.innerHTML=filtered.map(r=>{
    const tenant = allTenants[r.id];
    const isOccupied = tenant && tenant.name;

    // Format dates
    const moveInDate = tenant?.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const contractEnd = tenant?.contractEnd ? new Date(tenant.contractEnd).toLocaleDateString('th-TH', {month: 'short', day: 'numeric', year: '2-digit'}) : '—';

    // Calculate days until contract end
    let daysLeft = '—';
    let expiryColor = 'var(--text-muted)';
    if(tenant?.contractEnd) {
      const exp = new Date(tenant.contractEnd);
      const days = Math.ceil((exp - today) / 86400000);
      if(days > 0) {
        daysLeft = days;
        if(days <= 30) expiryColor = 'var(--red)';
        else if(days <= 60) expiryColor = 'var(--orange)';
        else expiryColor = 'var(--green-dark)';
      }
    }

    // Get payment status
    const paymentStatus = getPaymentStatus(r.id);
    const paymentStatusLabel = paymentStatus === 'paid' ? 'จ่ายแล้ว' :
                              paymentStatus === 'pending' ? 'รอจ่าย' :
                              paymentStatus === 'overdue' ? 'ค้าง' : '—';
    const paymentStatusHTML = paymentStatus ? `<span class="payment-status ${paymentStatus}">${paymentStatusLabel}</span>` : '';

    // Get payment info (deadline and outstanding)
    const paymentInfo = isOccupied ? getPaymentInfo(r.id) : { nextDueDate: null, overdueAmount: 0 };
    const nextPaymentDate = paymentInfo.nextDueDate ? new Date(paymentInfo.nextDueDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const overdueDisplay = paymentInfo.overdueAmount > 0 ? `฿${paymentInfo.overdueAmount.toLocaleString()}` : '—';

    const displayRoomId = (r.name || r.id).replace(/^ห้อง |^Nest /, '');
    return `
    <div class="compact-card ${r.type==='commercial'?'':''}" style="border-left-color:${r.type==='commercial'?'var(--blue)':'var(--green)'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${displayRoomId}</div>
        <span class="compact-card-type">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          <span style="font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOccupied?'var(--green-pale)':'#f3e5f5'};color:${isOccupied?'var(--green-dark)':'#6a1b9a'};font-weight:600;">${isOccupied?'มีผู้เช่า':'ว่าง'}</span>
          ${paymentStatusHTML}
        </span>
      </div>
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${r.type==='commercial'?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span class="compact-card-value">฿${r.rentPrice.toLocaleString()}</span>
      </div>
      ${isOccupied ? `
      <div class="compact-card-info">
        <span style="font-weight:600;color:var(--text);">ชื่อ</span>
        <span class="compact-card-value">${tenant.name}</span>
      </div>
      <div class="compact-card-info">
        <span>โทร</span>
        <span style="font-size:.8rem;">${tenant.phone || '—'}</span>
      </div>
      <div class="compact-card-info">
        <span>เข้าพัก</span>
        <span style="font-size:.8rem;">${moveInDate}</span>
      </div>
      <div class="compact-card-info">
        <span>สัญญาสิ้นสุด</span>
        <span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${contractEnd}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${daysLeft === '—' ? '—' : daysLeft + ' วัน'}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">ชำระครั้งต่อ</span>
        <span style="font-size:.8rem;font-weight:600;">${nextPaymentDate}</span>
      </div>
      ${paymentInfo.overdueAmount > 0 ? `
      <div class="compact-card-info">
        <span style="color:#d32f2f;font-size:.75rem;">ค้างชำระ</span>
        <span style="font-weight:700;color:#d32f2f;">฿${paymentInfo.overdueAmount.toLocaleString()}</span>
      </div>
      ` : ''}
      ` : `
      <div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);">
        <span style="font-size:.9rem;">🚪 ไม่มีผู้เช่า</span>
      </div>
      `}
      <div class="compact-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button class="compact-btn" onclick="editRoom('${r.id}')" title="แก้ไขสัญญาเช่า" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">📄 สัญญา</button>
        <button class="compact-btn" onclick="recordPayment('${r.id}')" title="บันทึกค่าเช่า" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">💰 ชำระ</button>
        <button class="compact-btn" onclick="viewBills('${r.id}')" title="ดูบิล" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🧾 บิล</button>
        <button class="compact-btn" onclick="reportMaintenance('${r.id}')" title="แจ้งซ่อม" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบห้องที่ค้นหา</div>';
  }

  // Add contract expiry summary at the bottom
  const summaryHtml = `
  <div style="grid-column:1/-1;margin-top:1rem;padding:1rem;background:linear-gradient(135deg, #e8f5e9, #f1f8e9);border-radius:8px;border-left:4px solid var(--green);">
    <div style="font-weight:700;color:var(--green-dark);margin-bottom:0.5rem;">📋 สรุปสัญญา (ห้องแถว)</div>
    <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:.85rem;">
      <div>⚠️ <strong>${expiring30}</strong> ห้อง หมดภายใน 30 วัน</div>
      <div>⏳ <strong>${expiring60}</strong> ห้อง หมดใน 30-60 วัน</div>
      <div>✅ <strong>${rooms.filter(r => allTenants[r.id]?.name).length}</strong> ห้องมีผู้เช่า</div>
      <div>🚪 <strong>${rooms.filter(r => !allTenants[r.id]?.name).length}</strong> ห้องว่าง</div>
    </div>
  </div>`;

  grid.innerHTML += summaryHtml;
}

function toggleRoomView(view, btn){
  const compactView=document.getElementById('roomViewCompact');
  const classicView=document.getElementById('roomViewClassic');
  if(!compactView && !classicView) return;
  const buttons=document.querySelectorAll('.view-btn');

  buttons.forEach(b=>b.classList.remove('active'));
  buttons.forEach(b=>b.style.background='none');
  buttons.forEach(b=>b.style.color='var(--text)');
  buttons.forEach(b=>b.style.border='1.5px solid var(--border)');

  btn.classList.add('active');
  btn.style.background='var(--green-pale)';
  btn.style.color='var(--green-dark)';
  btn.style.border='1.5px solid var(--green)';

  if(view==='grid'){
    compactView.style.display='block';
    classicView.style.display='none';
  }else{
    compactView.style.display='none';
    classicView.style.display='block';
  }
}

function editRoom(roomId){openTenantModal(roomId);}
function viewRoomDetails(roomId){openTenantModal(roomId);}

// ===== BATCH RENT ADJUSTMENT FUNCTIONS =====
let batchSelectedRooms = new Set();

function openBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderRoomSelectionCheckboxes();
  updateAdjustmentDisplay();
}

function closeBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (modal) modal.style.display = 'none';
  batchSelectedRooms.clear();
}

function renderRoomSelectionCheckboxes() {
  const container = document.getElementById('roomSelectionContainer');
  if (!container) return;

  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  container.innerHTML = rooms.map(room => {
    const currentRent = room.rentPrice || 0;
    return `
      <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;border:1.5px solid #e0e0e0;border-radius:6px;cursor:pointer;transition:all 0.2s;background:white;" onclick="toggleBatchRoomSelection('${room.id}')">
        <input type="checkbox" id="batchRoom_${room.id}" onchange="updateBatchRoomCount()" style="cursor:pointer;">
        <span style="font-size:0.85rem;font-weight:600;color:#333;">${room.id}</span>
        <span style="font-size:0.75rem;color:#666;">฿${currentRent}</span>
      </label>
    `;
  }).join('');
}

function toggleBatchRoomSelection(roomId) {
  const checkbox = document.getElementById(`batchRoom_${roomId}`);
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  updateBatchRoomCount();
}

function updateBatchRoomCount() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]:checked');
  const countElement = document.getElementById('roomSelectionCount');
  const count = checkboxes.length;
  if (countElement) countElement.textContent = count;

  batchSelectedRooms.clear();
  checkboxes.forEach(cb => {
    const roomId = cb.id.replace('batchRoom_', '');
    batchSelectedRooms.add(roomId);
  });

  updatePreview();
}

function selectAllRooms() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = true);
  updateBatchRoomCount();
}

function deselectAllRooms() {
  const checkboxes = document.querySelectorAll('#roomSelectionContainer input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
  updateBatchRoomCount();
}

function updateAdjustmentDisplay() {
  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const labelEl = document.getElementById('adjustLabel');
  const symbolEl = document.getElementById('adjustSymbol');
  const unitEl = document.getElementById('adjustUnit');

  const labels = {
    'fixed-increase': 'จำนวนที่เพิ่ม',
    'percentage-increase': 'เปอร์เซ็นต์ที่เพิ่ม',
    'fixed-decrease': 'จำนวนที่ลด',
    'percentage-decrease': 'เปอร์เซ็นต์ที่ลด',
    'set-fixed': 'ค่าเช่าคงที่'
  };

  const symbols = {
    'fixed-increase': '฿',
    'percentage-increase': '%',
    'fixed-decrease': '฿',
    'percentage-decrease': '%',
    'set-fixed': '฿'
  };

  const units = {
    'fixed-increase': 'บาท',
    'percentage-increase': '%',
    'fixed-decrease': 'บาท',
    'percentage-decrease': '%',
    'set-fixed': 'บาท/เดือน'
  };

  if (labelEl) labelEl.textContent = labels[adjustType];
  if (symbolEl) symbolEl.textContent = symbols[adjustType];
  if (unitEl) unitEl.textContent = units[adjustType];

  updatePreview();
}

function updatePreview() {
  if (batchSelectedRooms.size === 0) {
    document.getElementById('previewResult').innerHTML = '<p style="margin:0;color:#999;">เลือกห้องเพื่อดูตัวอย่าง</p>';
    return;
  }

  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const adjustValue = parseFloat(document.getElementById('adjustmentValue')?.value || 0);

  if (isNaN(adjustValue) || adjustValue === 0) {
    document.getElementById('previewResult').innerHTML = '<p style="margin:0;color:#999;">กรอกจำนวนที่ต้องการปรับ</p>';
    return;
  }

  const rooms = getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  const selectedRooms = rooms.filter(r => batchSelectedRooms.has(r.id));
  const preview = selectedRooms.map(room => {
    let newRent = room.rentPrice;

    if (adjustType === 'fixed-increase') newRent = room.rentPrice + adjustValue;
    else if (adjustType === 'percentage-increase') newRent = Math.round(room.rentPrice * (1 + adjustValue / 100));
    else if (adjustType === 'fixed-decrease') newRent = room.rentPrice - adjustValue;
    else if (adjustType === 'percentage-decrease') newRent = Math.round(room.rentPrice * (1 - adjustValue / 100));
    else if (adjustType === 'set-fixed') newRent = adjustValue;

    newRent = Math.max(0, newRent);
    const change = newRent - room.rentPrice;
    const changePercent = ((change / room.rentPrice) * 100).toFixed(1);
    const arrow = change >= 0 ? '↑' : '↓';
    const color = change > 0 ? '#4caf50' : (change < 0 ? '#d32f2f' : '#999');

    return `<p style="margin:4px 0;font-size:0.8rem;"><strong>${room.id}</strong>: ฿${room.rentPrice} <span style="color:${color};">→ ฿${newRent} ${arrow} ${Math.abs(changePercent)}%</span></p>`;
  }).join('');

  document.getElementById('previewResult').innerHTML = preview || '<p style="margin:0;color:#999;">ไม่มีการเปลี่ยนแปลง</p>';
}

function applyBatchRentAdjustment() {
  if (batchSelectedRooms.size === 0) {
    showToast('กรุณาเลือกห้องพักอย่างน้อย 1 ห้อง', 'warning');
    return;
  }

  const adjustType = document.querySelector('input[name="adjustType"]:checked')?.value || 'fixed-increase';
  const adjustValue = parseFloat(document.getElementById('adjustmentValue')?.value || 0);

  if (isNaN(adjustValue) || adjustValue === 0) {
    showToast('กรุณากรอกจำนวนที่ต้องการปรับ', 'warning');
    return;
  }

  // Apply adjustments to window.ROOMS_OLD
  window.ROOMS_OLD.forEach(room => {
    if (batchSelectedRooms.has(room.id)) {
      if (adjustType === 'fixed-increase') room.rentPrice = room.rentPrice + adjustValue;
      else if (adjustType === 'percentage-increase') room.rentPrice = Math.round(room.rentPrice * (1 + adjustValue / 100));
      else if (adjustType === 'fixed-decrease') room.rentPrice = room.rentPrice - adjustValue;
      else if (adjustType === 'percentage-decrease') room.rentPrice = Math.round(room.rentPrice * (1 - adjustValue / 100));
      else if (adjustType === 'set-fixed') room.rentPrice = adjustValue;

      room.rentPrice = Math.max(0, room.rentPrice);
    }
  });

  // Log to audit
  if (typeof AuditLogger !== 'undefined') {
    AuditLogger.log('BATCH_RENT_ADJUSTMENT', {
      roomCount: batchSelectedRooms.size,
      adjustType: adjustType,
      adjustValue: adjustValue,
      affectedRooms: Array.from(batchSelectedRooms)
    });
  }

  // Update UI
  updateRoomDisplay();
  updateDashboardLive();

  // Show success message
  showToast(`ปรับค่าเช่า ${batchSelectedRooms.size} ห้อง สำเร็จ!`, 'success');

  closeBatchRentAdjustmentModal();
}

// window.NEST_ROOMS is now defined in shared-config.js
// Use window.CONFIG.nest_rooms instead

// ===== SET NEST FILTER =====
function setNestFilter(filter) {
  currentNestFilter = filter;

  // Update button styles
  const buttons = document.querySelectorAll('.filter-btn-nest');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = 'white';
    btn.style.color = btn.style.borderColor;
  });

  // Find and style the active button
  const activeBtn = event.target;
  activeBtn.classList.add('active');
  activeBtn.style.background = activeBtn.style.borderColor || 'var(--green-dark)';
  activeBtn.style.color = 'white';

  renderNestCompactGrid();
}

// ===== RENDER NEST COMPACT GRID =====
function renderNestCompactGrid(){
  const allTenants = loadTenants();
  const searchInput = document.getElementById('nestCompactSearch');
  const searchTerm = (searchInput?.value || '').toLowerCase();
  const rooms = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);

  // Apply search filter
  let filtered = rooms.filter(r =>
    r.id.toString().toLowerCase().includes(searchTerm) ||
    (allTenants[r.id]?.name || '').toLowerCase().includes(searchTerm)
  );

  // Apply status filter
  filtered = filtered.filter(r => {
    if (currentNestFilter === 'all') return true;

    const statusInfo = getRoomColorStatus(r.id, r);
    const paymentStatus = getPaymentStatus(r.id);

    if (currentNestFilter === 'occupied') return statusInfo.label === 'มี';
    if (currentNestFilter === 'vacant') return statusInfo.label === 'ว่าง';
    if (currentNestFilter === 'overdue') return paymentStatus === 'overdue';

    return true;
  });

  const grid = document.getElementById('nestCompactGrid');

  // Calculate contract expiry summary for Nest
  const today = new Date();
  const in30 = new Date(today.getTime() + 30*86400000);
  const in60 = new Date(today.getTime() + 60*86400000);

  const expiring30 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > today && exp <= in30;
  }).length;

  const expiring60 = rooms.filter(r => {
    const t = allTenants[r.id];
    if(!t?.contractEnd) return false;
    const exp = new Date(t.contractEnd);
    return exp > in30 && exp <= in60;
  }).length;

  grid.innerHTML = filtered.map(r => {
    const tenant = allTenants[r.id];
    const isOccupied = tenant && tenant.name;

    // Format dates
    const moveInDate = tenant?.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
    const contractEnd = tenant?.contractEnd ? new Date(tenant.contractEnd).toLocaleDateString('th-TH', {month: 'short', day: 'numeric', year: '2-digit'}) : '—';

    // Calculate days until contract end
    let daysLeft = '—';
    let expiryColor = 'var(--text-muted)';
    if(tenant?.contractEnd) {
      const exp = new Date(tenant.contractEnd);
      const days = Math.ceil((exp - today) / 86400000);
      if(days > 0) {
        daysLeft = days;
        if(days <= 30) expiryColor = 'var(--red)';
        else if(days <= 60) expiryColor = 'var(--orange)';
        else expiryColor = 'var(--green-dark)';
      }
    }

    // Pet badges
    const petKey = `tenant_pets_nest_${r.id}`;
    const roomPets = JSON.parse(localStorage.getItem(petKey) || '[]').filter(p => p.status === 'approved');
    const petBadgesHtml = roomPets.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;">${roomPets.map(p => {
          const em = {'dog':'🐕','cat':'🐈','rabbit':'🐇','bird':'🐦','fish':'🐠','hamster':'🐹'}[((p.type||'').toLowerCase())] || '🐾';
          return `<span title="${p.type}: ${p.name}" style="font-size:.68rem;padding:1px 6px;border-radius:8px;background:#f3e5f5;color:#6a1b9a;border:1px solid #ce93d8;">${em} ${p.name}</span>`;
        }).join('')}</div>`
      : '';

    const typeLabel = r.type === 'daily' ? '📅 รายวัน' : (r.type === 'pet' ? '🐾 Pet Friendly' : '🏠 Studio');
    const floorLabel = `ชั้น ${r.floor}`;

    return `
    <div class="compact-card" style="border-left-color: ${r.type === 'pet' ? 'var(--purple)' : 'var(--blue)'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${r.id}</div>
        <span class="compact-card-type" style="background: ${r.type === 'pet' ? 'var(--purple-pale)' : 'var(--blue)'}60; color: ${r.type === 'pet' ? 'var(--purple)' : 'var(--blue)'};">${floorLabel}</span>
        <span style="margin-left:auto;font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOccupied?'var(--green-pale)':'#f3e5f5'};color:${isOccupied?'var(--green-dark)':'#6a1b9a'};font-weight:600;">${isOccupied?'มีผู้เช่า':'ว่าง'}</span>
      </div>
      ${petBadgesHtml}
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${typeLabel}</span>
        <span class="compact-card-value">฿${r.rentPrice.toLocaleString()}</span>
      </div>
      ${isOccupied ? `
      <div class="compact-card-info">
        <span style="font-weight:600;color:var(--text);">ชื่อ</span>
        <span class="compact-card-value" style="font-size:.9rem;">${tenant.name}</span>
      </div>
      <div class="compact-card-info">
        <span>โทร</span>
        <span style="font-size:.8rem;">${tenant.phone || '—'}</span>
      </div>
      <div class="compact-card-info">
        <span>เข้าพัก</span>
        <span style="font-size:.8rem;">${moveInDate}</span>
      </div>
      <div class="compact-card-info">
        <span>สัญญาสิ้นสุด</span>
        <span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${contractEnd}</span>
      </div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${daysLeft === '—' ? '—' : daysLeft + ' วัน'}</span>
      </div>
      ${(() => {
        const paymentInfo = getPaymentInfo(r.id);
        const nextPaymentDate = paymentInfo.nextDueDate ? new Date(paymentInfo.nextDueDate).toLocaleDateString('th-TH', {month: 'short', day: 'numeric'}) : '—';
        return `
        <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
          <span style="color:var(--text-muted);font-size:.75rem;">ชำระครั้งต่อ</span>
          <span style="font-size:.8rem;font-weight:600;">${nextPaymentDate}</span>
        </div>
        ${paymentInfo.overdueAmount > 0 ? `
        <div class="compact-card-info">
          <span style="color:#d32f2f;font-size:.75rem;">ค้างชำระ</span>
          <span style="font-weight:700;color:#d32f2f;">฿${paymentInfo.overdueAmount.toLocaleString()}</span>
        </div>
        ` : ''}
        `;
      })()}
      ` : `
      <div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);">
        <span style="font-size:.9rem;">🚪 ไม่มีผู้เช่า</span>
      </div>
      `}
      <div class="compact-card-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button class="compact-btn" onclick="editRoom('${r.id}')" title="แก้ไขสัญญาเช่า" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">📄 สัญญา</button>
        <button class="compact-btn" onclick="recordPayment('${r.id}')" title="บันทึกค่าเช่า" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">💰 ชำระ</button>
        <button class="compact-btn" onclick="viewBills('${r.id}')" title="ดูบิล" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🧾 บิล</button>
        <button class="compact-btn" onclick="reportMaintenance('${r.id}')" title="แจ้งซ่อม" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบห้องที่ค้นหา</div>';
  }

  // Add contract expiry summary at the bottom
  const summaryHtml = `
  <div style="grid-column:1/-1;margin-top:1rem;padding:1rem;background:linear-gradient(135deg, #f3e5f5, #ede7f6);border-radius:8px;border-left:4px solid var(--purple);">
    <div style="font-weight:700;color:var(--purple);margin-bottom:0.5rem;">📋 สรุปสัญญา (Nest)</div>
    <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:.85rem;">
      <div>⚠️ <strong>${expiring30}</strong> ห้อง หมดภายใน 30 วัน</div>
      <div>⏳ <strong>${expiring60}</strong> ห้อง หมดใน 30-60 วัน</div>
      <div>✅ <strong>${rooms.filter(r => allTenants[r.id]?.name).length}</strong> ห้องมีผู้เช่า</div>
      <div>🚪 <strong>${rooms.filter(r => !allTenants[r.id]?.name).length}</strong> ห้องว่าง</div>
    </div>
  </div>`;

  grid.innerHTML += summaryHtml;
}

// Toggle Nest room view between grid and classic table
function toggleNestRoomView(view, btn){
  const compactView = document.getElementById('nestViewCompact');
  if(!compactView) return;
  const classicView = document.getElementById('nestViewClassic');
  const buttons = btn.parentElement.querySelectorAll('.view-btn');

  buttons.forEach(b => {
    b.classList.remove('active');
    b.style.background = 'none';
    b.style.color = 'var(--text)';
    b.style.border = '1.5px solid var(--border)';
  });

  btn.classList.add('active');
  btn.style.background = '#e3f2fd';
  btn.style.color = '#1565c0';
  btn.style.border = '1.5px solid #2196f3';

  if(view === 'grid'){
    compactView.style.display = 'block';
    classicView.style.display = 'none';
  } else {
    compactView.style.display = 'none';
    classicView.style.display = 'block';
  }
}

// Initialize Nest compact grid when page loads
function initNestPage(){
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();

  // Set up real-time Firebase listeners
  setupRoomDataListener();
  setupLeaseDataListener();
  setupMeterDataListener();
  console.log('✅ Real-time listeners activated for Nest page');

  // Update info cards from live RoomConfigManager data (must be before early returns)
  updateNestInfoCards();

  // Populate room grid (visual layout)
  const allTenants = loadTenants();
  const rooms = getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);
  const grid = document.getElementById('nestRoomGrid');
  if(!grid) return;
  grid.innerHTML = rooms.map(r => {
    const tenant = allTenants[r.id];
    const occupancyIcon = tenant && tenant.name ? '✅' : '🚪';
    const typeIcon = r.type === 'pet-allowed' ? '🐾' : '🏠';
    const statusInfo = getRoomColorStatus(r.id, r);
    const bgColor = statusInfo.color+'40';
    const borderColor = statusInfo.color;
    return `
    <div class="room-pill ${r.type === 'pet-allowed' ? 'pet-allowed' : 'studio'}" onclick="openTenantModal('nest', '${r.id}')" style="cursor:pointer;transition:transform 0.2s;background:${bgColor};border:2px solid ${borderColor};">
      <div class="room-num">${(r.name || r.id).replace(/^ห้อง |^Nest /, '')}</div>
      <div class="room-rent">฿${r.rentPrice.toLocaleString()}/เดือน</div>
      <div class="room-status">${typeIcon} ${tenant && tenant.name ? tenant.name : 'ว่าง'}</div>
      <div style="font-size:0.8rem;margin-top:4px;text-align:center;color:${borderColor};font-weight:600;">${statusInfo.icon} ${statusInfo.label}</div>
    </div>`;
  }).join('');

  // Populate classic table view
  const tbl = document.getElementById('nestRoomTable');
  if(!tbl) return;
  const rentStudio = rooms.filter(r => r.type === 'studio').reduce((a, r) => a + (r.rentPrice || 0), 0);
  const rentPet = rooms.filter(r => r.type === 'pet-allowed').reduce((a, r) => a + (r.rentPrice || 0), 0);
  const rentTotal = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);

  tbl.innerHTML = `
    <thead><tr><th>ห้องเลขที่</th><th>ชั้น</th><th>ประเภท</th><th>ค่าเช่า</th><th>อัตราไฟ</th><th>ค่าขยะ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${rooms.map(r => {
      const typeLabel = r.type === 'pet-allowed' ? '🐾 Pet-Allowed' : '🏠 Studio';
      return `<tr>
        <td><strong>${r.id}</strong></td>
        <td>ชั้น ${r.floor}</td>
        <td><span class="badge ${r.type === 'pet-allowed' ? 'badge-purple' : 'badge-blue'}">${typeLabel}</span></td>
        <td style="font-weight:700;color:var(--green-dark)">฿${r.rentPrice.toLocaleString()}</td>
        <td>${r.electricRate || r.elecRate || 8} บาท/หน่วย</td>
        <td>฿${r.trashRate || r.trashFee || 40}</td>
        <td style="font-size:.8rem;color:var(--text-muted)">${r.note || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr style="background:var(--blue-pale);font-weight:700;">
      <td colspan="3">รวม (${rooms.length} ห้อง)</td>
      <td>฿${rentTotal.toLocaleString()}</td>
      <td colspan="3">—</td>
    </tr></tfoot>`;

  // Render compact grid and setup search
  renderNestCompactGrid();
  const searchInput = document.getElementById('nestCompactSearch');
  if(searchInput){
    searchInput.addEventListener('input', renderNestCompactGrid);
  }

}

// ===== PROPERTY PAGE (COMBINED ROOMS & NEST) =====
function initPropertyPage(){
  // Initialize the active tab based on current state
  const roomsSection = document.getElementById('property-rooms-section');
  const nestSection = document.getElementById('property-nest-section');

  if(roomsSection) initRoomsPage();
  if(nestSection) initNestPage();
  updateShopInfoCard();
}

// ─── Dynamic Nest info cards — reads from RoomConfigManager ───
function updateNestInfoCards() {
  const nestConfig = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('nest') : null;
  const rooms = nestConfig?.rooms?.filter(r => !r.deleted) || [];
  if (!rooms.length) return;

  const byType = { studio: [], 'pet-allowed': [] };
  rooms.forEach(r => { const key = r.type === 'pet-allowed' ? 'pet-allowed' : 'studio'; byType[key].push(r); });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const fmtRent  = v => v > 0 ? `฿${v.toLocaleString()}/เดือน` : '—';
  const fmtElec  = v => v > 0 ? `${v} บาท/หน่วย` : '—';
  const fmtWater = v => v > 0 ? `${v} บาท/หน่วย` : '—';
  const fmtTrash = v => v > 0 ? `฿${v}/เดือน` : '—';
  const floorStr = arr => [...new Set(arr.map(r => r.floor).filter(Boolean))].sort((a,b)=>a-b).join(', ');
  const rep = arr => arr[0] || {};

  const s = byType.studio, p = byType['pet-allowed'];

  const rs = rep(s);
  set('nest-studio-title', `🏠 Studio (N101–N205)${s.length ? ' — ' + s.length + ' ห้อง' : ''}`);
  set('nest-studio-rent',  fmtRent(rs.rentPrice));
  set('nest-studio-elec',  fmtElec(rs.electricRate));
  set('nest-studio-water', fmtWater(rs.waterRate));
  set('nest-studio-trash', fmtTrash(rs.trashRate));

  const rp = rep(p);
  set('nest-pet-title', `🐾 Pet-Allowed (N301–N405)${p.length ? ' — ' + p.length + ' ห้อง' : ''}`);
  set('nest-pet-rent',  fmtRent(rp.rentPrice));
  set('nest-pet-elec',  fmtElec(rp.electricRate));
  set('nest-pet-water', fmtWater(rp.waterRate));
  set('nest-pet-trash', fmtTrash(rp.trashRate));

  const totalRent = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);
  set('nest-total-title', `📊 รวมทั้งหมด (${rooms.length} ห้อง)`);
  set('nest-total-income',  `฿${totalRent.toLocaleString()}/เดือน`);
  set('nest-total-income2', `฿${totalRent.toLocaleString()}/เดือน`);
  set('nest-total-breakdown', `${s.length} Studio + ${p.length} Pet-Allowed`);
}

// ─── Dynamic shop info card — reads from RoomConfigManager ───
function updateShopInfoCard() {
  // Read live config from RoomConfigManager
  const config = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('rooms') : null;
  const shopRoom = config?.rooms?.find(r => r.id === 'ร้านใหญ่');
  const shopName = shopRoom?.name || 'ร้านใหญ่';  // use editable name field directly

  const rent  = shopRoom?.rentPrice   || 0;
  const elec  = shopRoom?.electricRate || 0;
  const water = shopRoom?.waterRate    || 0;
  // trashRate may not be set in RoomConfigManager — fall back to ROOMS_OLD metadata
  const shopMeta = (window.ROOMS_OLD || []).find(r => r.id === 'ร้านใหญ่');
  const trash = shopRoom?.trashRate || shopMeta?.trashFee || 0;

  const titleEl = document.getElementById('shop-info-title');
  const rentEl  = document.getElementById('shop-info-rent');
  const elecEl  = document.getElementById('shop-info-elec');
  const waterEl = document.getElementById('shop-info-water');
  const trashEl = document.getElementById('shop-info-trash');

  if (titleEl) titleEl.textContent = `🏪 ${shopName}`;
  if (rentEl)  rentEl.textContent  = rent  > 0 ? `฿${rent.toLocaleString()}/เดือน`  : '—';
  if (elecEl)  elecEl.textContent  = elec  > 0 ? `${elec} บาท/หน่วย`  : '—';
  if (waterEl) waterEl.textContent = water > 0 ? `${water} บาท/หน่วย` : '—';
  if (trashEl) trashEl.textContent = trash > 0 ? `฿${trash}/เดือน`    : '—';
}

// ─── Dynamic Rooms info cards — reads from RoomConfigManager ───
function updateRoomsInfoCards() {
  const config = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig('rooms') : null;
  if (!config?.rooms) return;
  const rooms = config.rooms.filter(r => !r.deleted && r.id !== 'ร้านใหญ่');

  // Group by rent price tier
  const tiers = {};
  rooms.forEach(r => {
    const p = r.rentPrice || 0;
    tiers[p] = (tiers[p] || 0) + 1;
  });
  const tierStr = Object.keys(tiers).sort((a, b) => Number(a) - Number(b))
    .map(p => `฿${Number(p).toLocaleString()} × ${tiers[p]}`)
    .join(' | ');
  const totalRooms = rooms.length;
  const totalIncome = rooms.reduce((a, r) => a + (r.rentPrice || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('rooms-card-title', `🏠 ห้องพัก (${totalRooms} ห้อง)`);
  set('rooms-rent-tiers', tierStr || '—');
  const elecRate = config.elecRate || config.electricityRate || 8;
  const waterRate = config.waterRate || 20;
  const trashFee = config.trashFee || 20;
  set('rooms-rates-row', `⚡ ${elecRate} · 💧 ${waterRate} บ/หน่วย · 🗑️ ${trashFee} บ/เดือน`);
  set('rooms-total-title', `📊 รวมทั้งหมด (${totalRooms + 1} ห้อง)`);
  set('rooms-total-income',  `฿${totalIncome.toLocaleString()}/เดือน (ไม่รวมร้านค้า)`);
  set('rooms-total-income2', `฿${totalIncome.toLocaleString()}/เดือน (ไม่รวมร้านค้า)`);
  set('rooms-total-breakdown', `${totalRooms} ห้องพัก + 1 พาณิชย์`);
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

// ===== TENANT MANAGEMENT =====
function loadTenants(){
  // TenantConfigManager stores to tenant_master_data: {rooms: {id: {...}}, nest: {id: {...}}}
  // Flatten to {id: {...}} for backward compatibility
  const master = localStorage.getItem('tenant_master_data');
  if (master) {
    const raw = JSON.parse(master);
    return Object.values(raw).reduce((acc, bld) => Object.assign(acc, bld), {});
  }
  return JSON.parse(localStorage.getItem('tenant_data')||'{}');
}

function saveTenants(t){localStorage.setItem('tenant_data',JSON.stringify(t));}

// Initialize all rooms with default tenant users
function initializeAllRoomUsers() {
  const tenants = loadTenants();
  const tNames = ['สมชาย ใจดี', 'นางสาวจิรา สมิตร', 'นายวิชัย จันทร์สว่าง', 'นางสมหญิง พรประเสริฐ', 'นายกมล วงศ์พันธ์',
    'นางปวณีย์ ศรีสวัสดิ์', 'นายศักดา บุญเพิ่ม', 'นับพบ ยิ่มเสถียร', 'นางนิยม ดวงแว่', 'นายปณิต นิยมาน',
    'นางกรรณิการ์ มัตตานี', 'นายเสวิชญ์ ศรีสอง', 'นางอรทัย ชิดโพธิ์', 'นายอภิวัฒน์ คงประเสริฐ'];

  // Get all rooms from RoomConfigManager
  const roomsConfig = RoomConfigManager.getRoomsConfig('rooms');
  const nestConfig = RoomConfigManager.getRoomsConfig('nest');

  let nameIndex = 0;
  let updated = 0;

  // Create users for Rooms building
  if (roomsConfig && roomsConfig.rooms) {
    roomsConfig.rooms.forEach(room => {
      if (!tenants[room.id]) {
        tenants[room.id] = {
          name: tNames[nameIndex % tNames.length],
          lineId: `@tenant_${room.id}`,
          moveInDate: new Date(2024, 0, 15).toISOString().split('T')[0],
          contractEnd: new Date(2025, 11, 15).toISOString().split('T')[0],
          deposit: 3000,
          note: `Tenant for ${room.name}`,
          updatedAt: new Date().toISOString()
        };
        updated++;
        nameIndex++;
      }
    });
  }

  // NOTE: Nest building intentionally excluded — not yet open for service
  // Nest tenants will be added manually when building opens

  if (updated > 0) {
    saveTenants(tenants);
    console.log(`✅ Initialized ${updated} room users`);
    return updated;
  }
  return 0;
}
let tenantBuilding='old';
let currentTenantFilter='all';

function setTenantBuilding(bld,btn){
  document.querySelectorAll('#page-tenant .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  tenantBuilding=bld;
  currentTenantFilter='all';
  // Reset filter buttons to "ทั้งหมด"
  document.querySelectorAll('.filter-btn-tenant').forEach((b,i)=>{
    b.classList.toggle('active',i===0);
    b.style.background=i===0?'var(--green-dark)':'white';
    b.style.color=i===0?'white':b.style.borderColor||'#666';
  });
  // Show/hide building-specific sections
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = bld==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = bld==='new' ? '' : 'none';
  // Init the building's room grid & info cards
  if(bld==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
}

function initTenantPage(){
  // Show/hide building sections based on current building tab
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = tenantBuilding==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = tenantBuilding==='new' ? '' : 'none';
  // Initialize the active building room grid
  if(tenantBuilding==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
  renderTenantTable();
  updateTenantAlertBlock();
  updateRoomTypeCards();
  const searchInput=document.getElementById('tenantSearch');
  if(searchInput){
    searchInput.addEventListener('input',()=>{
      renderTenantPage();
      renderTenantTable();
      updateTenantAlertBlock();
      updateRoomTypeCards();
    });
  }
  _setupTenantRealtimeListener();
}

let _tenantListenerUnsubscribers=[];
function _setupTenantRealtimeListener(){
  // Unsubscribe previous listeners to avoid duplicates
  _tenantListenerUnsubscribers.forEach(fn=>fn());
  _tenantListenerUnsubscribers=[];
  if(!window.firebase?.firestoreFunctions) return;
  const {collection,onSnapshot}=window.firebase.firestoreFunctions;
  const db=window.firebase.firestore();
  ['rooms','nest'].forEach(bld=>{
    const unsub=onSnapshot(collection(db,`tenants/${bld}/list`),snap=>{
      const all=JSON.parse(localStorage.getItem('tenant_master_data')||'{}');
      if(!all[bld])all[bld]={};
      snap.forEach(doc=>{all[bld][doc.id]=doc.data();});
      localStorage.setItem('tenant_master_data',JSON.stringify(all));
      if(document.getElementById('page-tenant')?.style.display!=='none'){
        renderTenantPage();
        renderTenantTable();
        updateTenantAlertBlock();
        updateRoomTypeCards();
      }
    },err=>console.warn('tenant listener error:',err));
    _tenantListenerUnsubscribers.push(unsub);
  });
}

function _getTenantRooms(){
  return tenantBuilding==='old'
    ?getActiveRoomsWithMetadata('rooms',window.ROOMS_OLD)
    :getActiveRoomsWithMetadata('nest',window.NEST_ROOMS);
}

function renderTenantPage(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let occ=0,vac=0,soon=0;
  rooms.forEach(r=>{
    const t=tenants[r.id];
    if(t?.name){
      occ++;
      if(t.contractEnd){
        const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
        if(diff>=0&&diff<=30)soon++;
      }
    }else vac++;
  });
  // Write สัญญาใกล้หมด to the unified building KPI (occupancy-soon / nest-occupancy-soon)
  const soonId = tenantBuilding==='old' ? 'occupancy-soon' : 'nest-occupancy-soon';
  const soonEl = document.getElementById(soonId);
  if(soonEl){
    soonEl.textContent = soon;
    // Color: red if any expiring, purple otherwise
    const card = soonEl.closest('.kpi-card');
    if(card){ card.className = `kpi-card ${soon>0?'red':'purple'}`; }
  }
  const grid=document.getElementById('tenantGrid');if(!grid)return;
  const searchTerm=(document.getElementById('tenantSearch')?.value||'').toLowerCase();

  // Apply filters
  let filtered=rooms.filter(r=>{
    const t=tenants[r.id];
    const matchSearch=!searchTerm||r.id.toString().toLowerCase().includes(searchTerm)||(t?.name||'').toLowerCase().includes(searchTerm);
    if(!matchSearch)return false;
    const isOcc=!!t?.name;
    if(currentTenantFilter==='occupied')return isOcc;
    if(currentTenantFilter==='vacant')return !isOcc;
    if(currentTenantFilter==='expiring'){
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    }
    return true;
  });

  grid.innerHTML=filtered.map(r=>{
    const t=tenants[r.id];
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t?.moveInDate||t?.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{month:'short',day:'numeric'}):'—';
    const ce=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{month:'short',day:'numeric',year:'2-digit'}):'—';
    let daysLeft='—',expiryColor='var(--text-muted)';
    if(t?.contractEnd){
      const days=Math.ceil((new Date(t.contractEnd)-today)/86400000);
      if(days>0){daysLeft=days;expiryColor=days<=30?'var(--red)':days<=60?'#f57c00':'var(--green-dark)';}
      else{daysLeft='❌ หมดแล้ว';expiryColor='var(--red)';}
    }
    return`<div class="compact-card${!isOcc?' vacant':''}" style="border-left-color:${isCom?'var(--blue)':isOcc?'var(--green)':'#ff9800'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${r.id}</div>
        <span class="compact-card-type">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span style="margin-left:auto;font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOcc?'var(--green-pale)':'#fff3e0'};color:${isOcc?'var(--green-dark)':'#e65100'};font-weight:600;">${isOcc?'มีผู้เช่า':'ว่าง'}</span>
      </div>
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span class="compact-card-value">฿${Number(r.rentPrice||r.rent||0).toLocaleString()}</span>
      </div>
      ${isOcc?`
      <div class="compact-card-info"><span style="font-weight:600;color:var(--text);">ชื่อ</span><span class="compact-card-value">${t.name}</span></div>
      <div class="compact-card-info"><span>โทร</span><span style="font-size:.8rem;">${t.phone||'—'}</span></div>
      <div class="compact-card-info"><span>เข้าพัก</span><span style="font-size:.8rem;">${mi}</span></div>
      <div class="compact-card-info"><span>สัญญาสิ้นสุด</span><span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${ce}</span></div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${typeof daysLeft==='number'?daysLeft+' วัน':daysLeft}</span>
      </div>
      ${t.deposit?`<div class="compact-card-info"><span style="font-size:.75rem;color:var(--text-muted);">มัดจำ</span><span style="font-weight:700;color:var(--green-dark);">฿${Number(t.deposit).toLocaleString()}</span></div>`:''}
      `:`<div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);"><span>🚪 ไม่มีผู้เช่า</span></div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button onclick="openTenantModal('${tenantBuilding==='old'?'rooms':'nest'}','${r.id}')" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">📄 สัญญา</button>
        <button onclick="showBillingModal('${r.id}')" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">💰 ชำระ</button>
        <button onclick="showBillingHistoryModal('${r.id}')" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🧾 บิล</button>
        <button onclick="window.showPage('requests-approvals')" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</div>';
  }
  updateTenantAlertBlock();
  updateRoomTypeCards();
}

// ===== COMPACT TENANT TABLE RENDERING =====
function renderTenantTable(){
  const searchInput=document.getElementById('tenantSearch');
  const searchTerm=(searchInput?.value||'').toLowerCase();
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const tbody=document.getElementById('tenantTableBody');
  const today=new Date();

  const rows=rooms.filter(r=>{
    const t=tenants[r.id]||{};
    const roomStr=r.id.toString().toLowerCase();
    const nameStr=(t.name||'').toLowerCase();
    return roomStr.includes(searchTerm)||nameStr.includes(searchTerm);
  }).map(r=>{
    const t=tenants[r.id]||{};
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t.moveInDate||t.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const ce=t.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const diff=t.contractEnd?Math.round((new Date(t.contractEnd)-today)/(1000*60*60*24)):null;
    const status=isCom?'💼 พาณิชย์':!isOcc?'🚪 ว่าง':diff===null?'—':diff<0?'❌ หมด':diff<=30?`⚠️ ${diff}วัน`:'✅ ปกติ';
    return`<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px;font-weight:700;color:var(--green-dark);">${r.id}</td>
      <td style="padding:10px;">${isOcc?t.name:'<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${t.phone||'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${mi}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${ce}</td>
      <td style="padding:10px;text-align:center;font-weight:700;color:var(--green-dark);">${t.deposit?'฿'+Number(t.deposit).toLocaleString():'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;font-weight:600;">${status}</td>
    </tr>`;
  });

  tbody.innerHTML=rows.join('');
  if(rows.length===0){
    tbody.innerHTML=`<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</td></tr>`;
  }
}

function toggleTenantView(view, btn){
  const cardsView=document.getElementById('tenantViewCards');
  const tableView=document.getElementById('tenantViewTable');
  document.querySelectorAll('.view-toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(view==='cards'){
    cardsView.style.display='block';
    tableView.style.display='none';
  }else{
    cardsView.style.display='none';
    tableView.style.display='block';
  }
}

// ===== TENANT FILTER =====
function setTenantFilter(filter){
  currentTenantFilter=filter;
  // Active state styled purely by CSS (.filter-btn-tenant.active); just toggle class.
  document.querySelectorAll('.filter-btn-tenant').forEach(btn=>btn.classList.remove('active'));
  if(event?.target) event.target.classList.add('active');
  renderTenantPage();
  renderTenantTable();
}

// ===== TENANT ALERT BLOCK =====
function updateTenantAlertBlock(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  const expiring=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
    return diff>=0&&diff<=30;
  });
  const alertBlock=document.getElementById('tenantAlertBlock');
  const alertList=document.getElementById('tenantAlertList');
  if(!alertBlock) return;
  if(expiring.length===0){
    alertBlock.style.display='none';
  }else{
    alertBlock.style.display='block';
    if(alertList) alertList.innerHTML=expiring.map(r=>`<div style="background:#fff;padding:6px 12px;border-radius:6px;border-left:3px solid #f57c00;font-size:.85rem;">🚪 ห้อง ${r.id}</div>`).join('');
  }
}

// ===== ROOM TYPE INFO CARDS =====
function updateRoomTypeCards(){
  const rooms=_getTenantRooms();
  const container=document.getElementById('roomTypeCardsContainer');
  if(!container) return;
  const types={};
  (rooms||[]).forEach(room=>{
    if(!types[room.type])types[room.type]={type:room.type,rooms:0,rent:room.rentPrice||room.rent||0};
    types[room.type].rooms++;
  });
  container.innerHTML=Object.values(types).map(typeInfo=>`
    <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:1rem;">
      <div style="font-weight:700;color:var(--green);margin-bottom:0.5rem;">${typeInfo.type}</div>
      <div style="font-size:.9rem;color:var(--text-muted);">
        <div>🏠 ${typeInfo.rooms} ห้อง</div>
        <div>💰 ฿${Number(typeInfo.rent).toLocaleString()} / เดือน</div>
      </div>
    </div>
  `).join('');
}

// ===== EXPORT TENANT CSV =====
function exportTenantCSV(){
  const building=tenantBuilding==='old'?'ห้องแถว':'Nest';
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let csv='ห้อง,ชื่อ-นามสกุล,เบอร์โทร,วันเข้า,วันหมดสัญญา,มัดจำ,สถานะ\n';
  rooms.forEach(r=>{
    const t=tenants[r.id];
    const name=t?.name||'ว่าง';
    const phone=t?.phone||'-';
    const moveIn=t?.moveInDate?new Date(t.moveInDate).toLocaleDateString('th-TH'):'-';
    const contractEnd=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH'):'-';
    const deposit=t?.deposit?Number(t.deposit).toLocaleString('th-TH'):'-';
    const status=!t?.name?'ว่าง':t.contractEnd&&new Date(t.contractEnd)<today?'หมด':'ปกติ';
    csv+=`"${r.id}","${name}","${phone}","${moveIn}","${contractEnd}","${deposit}","${status}"\n`;
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`tenant-${building}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

let editingTenantRoom=null;
function showTenantModal(roomId){
  editingTenantRoom=roomId;
  const t=loadTenants()[roomId]||{};
  document.getElementById('payModalTitle').textContent=`👤 ผู้เช่า — ห้อง ${roomId}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');
  body.innerHTML=`
    <div class="pm-row"><span class="pm-label">ชื่อ-นามสกุล</span><input class="pm-input" id="tm-name" style="width:185px" type="text" value="${t.name||''}" placeholder="สมชาย ใจดี"></div>
    <div class="pm-row"><span class="pm-label">Line ID</span><input class="pm-input" id="tm-line" style="width:145px" type="text" value="${t.lineId||''}" placeholder="@username"></div>
    <div class="pm-row"><span class="pm-label">วันที่เข้าอยู่</span><input class="pm-input" id="tm-moveIn" style="width:145px" type="date" value="${t.moveInDate||''}"></div>
    <div class="pm-row"><span class="pm-label">วันหมดสัญญา</span><input class="pm-input" id="tm-contractEnd" style="width:145px" type="date" value="${t.contractEnd||''}"></div>
    <div class="pm-row"><span class="pm-label">เงินมัดจำ (บาท)</span><input class="pm-input" id="tm-deposit" type="number" value="${t.deposit||0}"></div>
    <div class="pm-row"><span class="pm-label">หมายเหตุ</span><input class="pm-input" id="tm-note" style="width:185px" type="text" value="${t.note||''}" placeholder="เช่น มีสัตว์เลี้ยง..."></div>`;
  footer.innerHTML=`
    <button class="pm-btn green" onclick="saveTenant()">💾 บันทึก</button>
    ${t.name?`<button class="pm-btn red" onclick="deleteTenant('${roomId}')">🗑️ ลบผู้เช่า</button>`:''}
    <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  document.getElementById('payModalOverlay').classList.add('show');

  // Initialize phone validation for the modal
  setTimeout(function() {
    initPhoneValidation();
  }, 100);
}

function saveTenant(){
  if(!editingTenantRoom)return;
  const tenants=loadTenants();
  const name=document.getElementById('tm-name').value.trim();
  if(name){
    tenants[editingTenantRoom]={
      name,
      lineId:document.getElementById('tm-line').value.trim(),
      moveInDate:document.getElementById('tm-moveIn').value,
      contractEnd:document.getElementById('tm-contractEnd').value,
      deposit:parseFloat(document.getElementById('tm-deposit').value)||0,
      note:document.getElementById('tm-note').value.trim(),
      updatedAt:new Date().toISOString()
    };
  }else{delete tenants[editingTenantRoom];}
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
  const toast=document.createElement('div');
  toast.textContent=name?`✅ บันทึกผู้เช่าห้อง ${editingTenantRoom} เรียบร้อย`:`🗑️ ลบข้อมูลผู้เช่าห้อง ${editingTenantRoom} แล้ว`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2200);
}

function deleteTenant(roomId){
  if(!confirm(`ยืนยันการลบผู้เช่าห้อง ${roomId}?`))return;
  const tenants=loadTenants();
  delete tenants[roomId];
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
}

// ===== EXPENSE MANAGEMENT =====
function loadExpenses(){return JSON.parse(localStorage.getItem('expense_data')||'[]');}
function saveExpenses(e){localStorage.setItem('expense_data',JSON.stringify(e));}

function initExpensePage(){
  const now=new Date();
  const fm=document.getElementById('exp-filter-month');
  const fy=document.getElementById('exp-filter-year');
  const ed=document.getElementById('exp-date');
  if(fm)fm.value=now.getMonth()+1;
  if(fy)fy.value=now.getFullYear()+543;
  if(ed&&!ed.value)ed.value=now.toISOString().split('T')[0];
  renderExpensePage();
}

function renderExpensePage(){
  const now=new Date();
  const filterMonth=parseInt(document.getElementById('exp-filter-month')?.value||now.getMonth()+1);
  const filterYear=parseInt(document.getElementById('exp-filter-year')?.value||now.getFullYear()+543);
  const expenses=loadExpenses();
  const filtered=expenses.filter(e=>{
    if(!e.date)return false;
    const d=new Date(e.date);
    return d.getMonth()+1===filterMonth&&(d.getFullYear()+543)===filterYear;
  });
  const total=filtered.reduce((a,e)=>a+e.amount,0);
  const byCat={};
  filtered.forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount;});
  const ps=loadPS();
  const income=Object.values(ps[`${filterYear}_${filterMonth}`]||{}).reduce((a,p)=>a+(p.amount||0),0);
  const profit=income-total;
  const catLabels={repair:'ซ่อมแซม',utility:'ค่าน้ำ/ไฟ',supply:'ซื้อของ',wages:'ค่าแรง',other:'อื่นๆ'};
  const catCls={repair:'cat-repair',utility:'cat-utility',supply:'cat-supply',wages:'cat-wages',other:'cat-other'};
  const expSum=document.getElementById('expSummary');
  if(expSum){
    expSum.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;margin-bottom:1rem;">
        <div style="text-align:center;padding:.75rem;background:var(--green-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--green-dark)">฿${income.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายรับ</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:var(--red-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--red)">฿${total.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายจ่าย</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:${profit>=0?'var(--green-pale)':'var(--red-pale)'};border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:${profit>=0?'var(--green-dark)':'var(--red)'}">${profit>=0?'+':''}฿${profit.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${profit>=0?'กำไร':'ขาดทุน'}</div>
        </div>
      </div>
      ${Object.keys(byCat).length?`<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;">แยกตามหมวด:</div>
      <div style="display:flex;flex-direction:column;gap:5px;">${Object.entries(byCat).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span class="exp-cat-pill ${catCls[cat]||'cat-other'}">${catLabels[cat]||cat}</span>
        <strong>฿${amt.toLocaleString()}</strong></div>`).join('')}</div>`
      :'<div style="text-align:center;color:var(--text-muted);padding:.8rem;font-size:.84rem;">ยังไม่มีรายจ่ายเดือนนี้</div>'}`;
  }
  const listEl=document.getElementById('expList');
  if(listEl){
    if(!filtered.length){
      listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้</div>';
    }else{
      listEl.innerHTML=`<div class="scroll-x"><table class="data-table">
        <thead><tr><th>วันที่</th><th>หมวด</th><th>รายการ</th><th>ห้อง</th><th>จำนวน</th><th></th></tr></thead>
        <tbody>${filtered.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr>
          <td style="font-size:.8rem;">${new Date(e.date).toLocaleDateString('th-TH',{day:'numeric',month:'short'})}</td>
          <td><span class="exp-cat-pill ${catCls[e.category]||'cat-other'}">${catLabels[e.category]||e.category}</span></td>
          <td>${e.desc}</td>
          <td style="font-size:.8rem;color:var(--text-muted)">${e.room||'—'}</td>
          <td style="font-weight:700;color:var(--red)">฿${e.amount.toLocaleString()}</td>
          <td><button onclick="deleteExpense(${e.id})" style="background:none;border:none;cursor:pointer;font-size:.9rem;" title="ลบ">🗑️</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--red-pale);"><td colspan="4" style="font-weight:700;">รวม</td>
          <td style="font-weight:800;color:var(--red)">฿${total.toLocaleString()}</td><td></td></tr></tfoot>
      </table></div>`;
    }
  }
}

function addExpense(){
  const date=document.getElementById('exp-date').value;
  const category=document.getElementById('exp-category').value;
  const desc=document.getElementById('exp-desc').value.trim();
  const room=document.getElementById('exp-room').value.trim();
  const amount=parseFloat(document.getElementById('exp-amount').value)||0;
  if(!date||!desc||!amount){showToast('กรุณากรอกวันที่ รายการ และจำนวนเงิน', 'warning');return;}
  const expenses=loadExpenses();
  expenses.push({id:Date.now(),date,category,desc,room,amount});
  saveExpenses(expenses);
  document.getElementById('exp-desc').value='';
  document.getElementById('exp-amount').value='';
  document.getElementById('exp-room').value='';
  renderExpensePage();
  const toast=document.createElement('div');
  toast.textContent=`✅ บันทึกรายจ่าย ฿${amount.toLocaleString()} เรียบร้อย`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2000);
}

function deleteExpense(id){
  if(!confirm('ยืนยันการลบรายการนี้?'))return;
  saveExpenses(loadExpenses().filter(e=>e.id!==id));
  renderExpensePage();
}

// ===== TENANT PORTAL MAINTENANCE =====
function loadTenantMaintenance(){
  return JSON.parse(localStorage.getItem('tenant_maintenance')||'[]');
}

function saveTenantMaintenance(data){
  localStorage.setItem('tenant_maintenance',JSON.stringify(data));
}

function submitMaintenance(){
  // Validate tenant maintenance form
  const validation = validateTenantForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    return;
  }

  const room=document.getElementById('tp-room').value.trim();
  const type=document.getElementById('tp-type').value;
  const priority=document.getElementById('tp-priority').value;
  const description=document.getElementById('tp-description').value.trim();

  // Sanitize inputs
  const sanitizedRoom = window.SecurityUtils.sanitizeInput(room);
  const sanitizedDescription = window.SecurityUtils.sanitizeInput(description);

  if(!sanitizedRoom||!type||!sanitizedDescription){
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
    return;
  }

  const data=loadTenantMaintenance();
  data.unshift({
    id:Date.now(),
    room:sanitizedRoom,
    type:type,
    priority:priority,
    description:sanitizedDescription,
    status:'pending',
    submittedAt:new Date().toLocaleString('th-TH'),
    updatedAt:new Date().toLocaleString('th-TH')
  });

  saveTenantMaintenance(data);

  // Reset form
  document.getElementById('tp-room').value='';
  document.getElementById('tp-type').value='';
  document.getElementById('tp-priority').value='medium';
  document.getElementById('tp-description').value='';

  showToast('แจ้งซ่อมเรียบร้อยแล้ว เจ้าของจะติดต่อในไม่ช้า', 'success');
  renderTenantMaintenanceList();
}

function renderTenantMaintenanceList(){
  const data=loadTenantMaintenance();
  const list=document.getElementById('tp-list');

  if(data.length===0){
    list.innerHTML='<div style="color:var(--text-muted);text-align:center;padding:2rem;">ยังไม่มีรายการแจ้ง</div>';
    return;
  }

  const typeLabel={
    'plumbing':'🚿 ท่อน้ำ/ระบายน้ำ',
    'electrical':'⚡ ไฟฟ้า',
    'appliance':'🔌 เครื่องใช้ไฟฟ้า',
    'ac':'❄️ แอร์',
    'door':'🚪 ประตู/กุญแจ',
    'wall':'🧱 ผนัง/ปูน',
    'other':'📝 อื่นๆ'
  };

  const priorityColor={
    'low':'#4caf50',
    'medium':'#ff9800',
    'high':'#f44336'
  };

  list.innerHTML=data.map(item=>`
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:10px;border-left:4px solid ${priorityColor[item.priority]};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;color:var(--text);">ห้อง ${item.room}</div>
          <div style="font-size:.8rem;color:var(--text-muted);">${typeLabel[item.type]||item.type}</div>
        </div>
        <span style="background:${item.status==='pending'?'#ff9800':item.status==='done'?'#4caf50':'#2196f3'};color:#fff;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700;">
          ${item.status==='pending'?'⏳ รอดำเนินการ':item.status==='done'?'✅ เสร็จแล้ว':'🔨 กำลังดำเนินการ'}
        </span>
      </div>
      <div style="font-size:.85rem;color:var(--text);line-height:1.5;margin-bottom:8px;">
        ${item.description}
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);">
        ส่งเมื่อ: ${item.submittedAt}
      </div>
    </div>
  `).join('');
}

function initTenantPortal(){
  loadTenantProfile();
  renderTenantMaintenanceList();
}

function loadTenantProfile(){
  // Get first tenant as example (in real app, would be logged-in tenant)
  const tenants = loadTenants();
  const firstTenantRoom = Object.keys(tenants)[0];
  const tenant = tenants[firstTenantRoom];

  if (!tenant) {
    document.getElementById('tenantProfileContent').innerHTML =
      '<div style="padding:1rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลผู้เช่า</div>';
    return;
  }

  const profileHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
      <!-- Left: Personal Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">👤 ชื่อ-สกุล</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--text);">${tenant.name || '—'}</div>
        </div>
      </div>

      <!-- Right: Lease Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">🏠 ห้องเลขที่</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--green);">${firstTenantRoom}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">📅 วันเช่า</div>
          <div style="font-size:.95rem;color:var(--text);">${tenant.startDate || '—'}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">💰 ค่าเช่ารายเดือน</div>
          <div style="font-size:1rem;font-weight:700;color:var(--text);">฿${tenant.rent ? tenant.rent.toLocaleString() : '—'}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('tenantProfileContent').innerHTML = profileHTML;
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


