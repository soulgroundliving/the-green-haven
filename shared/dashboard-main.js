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

// ===== CONTENT MANAGEMENT TAB SWITCHING =====
function switchContentTab(tabName, btn) {
  // Hide all content tabs
  document.querySelectorAll('.content-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.content-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Show selected tab
  const tabElement = document.getElementById('content-tab-' + tabName);
  const resolvedBtn = btn || document.getElementById('tab-' + tabName + '-btn');
  if(tabElement) {
    tabElement.style.display = 'block';
    if(resolvedBtn) resolvedBtn.classList.add('active');
    // Lazy-init tab content
    if(tabName === 'announcements') initAnnouncementsPage();
    else if(tabName === 'events' && typeof initCommunityEventsPage === 'function') initCommunityEventsPage();
    else if(tabName === 'docs' && typeof initCommunityDocsPage === 'function') initCommunityDocsPage();
    else if(tabName === 'wellness' && typeof initWellnessArticlesPage === 'function') initWellnessArticlesPage();
    else if(tabName === 'emergency' && typeof initEmergencyContactsPage === 'function') initEmergencyContactsPage();
  }
}

// ===== WELLNESS ARTICLES CRUD =====
// ===== Wellness Article Editor Helpers (no HTML hand-typing) =====
const WELLNESS_ICONS = [
  { icon: 'fa-leaf',         label: 'ใบไม้' },
  { icon: 'fa-spa',          label: 'สปา' },
  { icon: 'fa-heart',        label: 'หัวใจ' },
  { icon: 'fa-bed',          label: 'นอน' },
  { icon: 'fa-utensils',     label: 'อาหาร' },
  { icon: 'fa-running',      label: 'ออกกำลัง' },
  { icon: 'fa-brain',        label: 'จิตใจ' },
  { icon: 'fa-sun',          label: 'แสง' },
  { icon: 'fa-water',        label: 'น้ำ' },
  { icon: 'fa-mug-hot',      label: 'ชา/กาแฟ' },
  { icon: 'fa-home',         label: 'บ้าน' },
  { icon: 'fa-music',        label: 'เพลง' },
  { icon: 'fa-book-reader',  label: 'อ่าน' },
  { icon: 'fa-yin-yang',     label: 'สมดุล' }
];
function ensureWellnessIconPicker() {
  const wrap = document.getElementById('wellness-icon-picker');
  if (!wrap || wrap.dataset.built === '1') return;
  wrap.dataset.built = '1';
  wrap.innerHTML = WELLNESS_ICONS.map(o => `
    <button type="button" data-icon="${o.icon}" onclick="window.pickWellnessIcon('${o.icon}',this)"
      style="padding:8px 12px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:'Sarabun';font-size:.8rem;transition:all .15s;"
      onmouseover="this.style.background='#f0f9f3'" onmouseout="if(this.dataset.selected!=='1')this.style.background='#fff'">
      <i class="fas ${o.icon}" style="color:var(--green);width:14px;text-align:center;"></i>${o.label}
    </button>`).join('');
  // Restore selection from hidden input
  const cur = document.getElementById('wellness-icon')?.value || 'fa-leaf';
  window.pickWellnessIcon(cur);
}
window.pickWellnessIcon = function(icon, btn) {
  const hidden = document.getElementById('wellness-icon');
  if (hidden) hidden.value = icon;
  // Update large preview
  const preview = document.getElementById('wellness-icon-preview');
  if (preview) preview.innerHTML = `<i class="fas ${icon}"></i>`;
  // Highlight selected button
  document.querySelectorAll('#wellness-icon-picker button').forEach(b => {
    if (b.dataset.icon === icon) {
      b.style.background = 'var(--green-pale)';
      b.style.borderColor = 'var(--green)';
      b.dataset.selected = '1';
    } else {
      b.style.background = '#fff';
      b.style.borderColor = 'var(--border)';
      b.dataset.selected = '0';
    }
  });
};

/** Wrap selection in textarea with given prefix/suffix (for B/I) or line-prefix (for lists/h3). */
window.wellnessFormat = function(kind) {
  const ta = document.getElementById('wellness-body');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const sel = ta.value.slice(start, end) || (kind === 'h3' ? 'หัวข้อย่อย' : (kind === 'ul' || kind === 'ol' ? 'รายการ' : 'ข้อความ'));
  const after = ta.value.slice(end);
  let inserted = '', cursorOffset = 0;
  if (kind === 'bold')   { inserted = `**${sel}**`;   cursorOffset = inserted.length; }
  if (kind === 'italic') { inserted = `*${sel}*`;     cursorOffset = inserted.length; }
  if (kind === 'h3')     { inserted = `\n## ${sel}\n`; cursorOffset = inserted.length; }
  if (kind === 'ul') {
    inserted = sel.split('\n').map(l => `- ${l}`).join('\n');
    cursorOffset = inserted.length;
  }
  if (kind === 'ol') {
    inserted = sel.split('\n').map((l, i) => `${i+1}. ${l}`).join('\n');
    cursorOffset = inserted.length;
  }
  ta.value = before + inserted + after;
  ta.focus();
  ta.setSelectionRange(start + cursorOffset, start + cursorOffset);
};

/** Convert plain-text/light-markdown body → HTML for storage.
 *  Already-HTML (detected by presence of < tags) passes through unchanged. */
function wellnessBodyToHtml(text) {
  if (!text) return '';
  const t = String(text).trim();
  // If user already wrote HTML (power user), keep as-is
  if (/<\/?(p|div|h[1-6]|ul|ol|li|strong|em|br)\b/i.test(t)) return t;
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Split into paragraph blocks by blank lines
  const blocks = t.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n');
    // List detection: every line starts with "- " or "1. " etc.
    const allUL = lines.every(l => /^\s*[-•]\s+/.test(l));
    const allOL = lines.every(l => /^\s*\d+\.\s+/.test(l));
    if (allUL && lines.length) {
      return '<ul>' + lines.map(l => '<li>' + applyInline(esc(l.replace(/^\s*[-•]\s+/, ''))) + '</li>').join('') + '</ul>';
    }
    if (allOL && lines.length) {
      return '<ol>' + lines.map(l => '<li>' + applyInline(esc(l.replace(/^\s*\d+\.\s+/, ''))) + '</li>').join('') + '</ol>';
    }
    // ## heading
    if (/^##\s+/.test(block)) {
      return '<h3>' + applyInline(esc(block.replace(/^##\s+/, ''))) + '</h3>';
    }
    // Default paragraph; inner newlines become <br>
    return '<p>' + lines.map(l => applyInline(esc(l))).join('<br>') + '</p>';
  }).join('\n');
  function applyInline(s) {
    // **bold** → <strong>, *italic* → <em>
    return s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1<em>$2</em>$3');
  }
}
window.wellnessBodyToHtml = wellnessBodyToHtml;

/** Reverse: HTML → plain-text/markdown for editing existing articles. */
function wellnessHtmlToText(html) {
  if (!html) return '';
  let t = String(html);
  t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n## $1\n');
  t = t.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  t = t.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  t = t.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  t = t.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  t = t.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n'));
  t = t.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let i = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++i}. $1\n`).replace(/\$1/g, m => m);
  });
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  t = t.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '');
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.trim();
}
window.wellnessHtmlToText = wellnessHtmlToText;

/** Compress image File → base64 data URL (max 800px wide, JPEG q=0.78). */
function compressImageToBase64(file, maxWidth = 800, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read fail'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode fail'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const useFmt = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(useFmt, quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
window.compressImageToBase64 = compressImageToBase64;

// Store image data URLs by index so textarea stays readable with [img:N] placeholders
window._wellnessImages = window._wellnessImages || []; // array of dataUrl strings

/** Handle multiple image upload — compress + store + add [img:N] placeholder to body. */
window.onWellnessImagesPicked = async function(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  const previewEl = document.getElementById('wellness-images-preview');
  const bodyEl = document.getElementById('wellness-body');
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 10 * 1024 * 1024) {
      showToast(`ไฟล์ ${f.name} ใหญ่เกิน 10MB — ข้าม`, 'warning');
      continue;
    }
    try {
      const dataUrl = await compressImageToBase64(f);
      const idx = window._wellnessImages.length;
      window._wellnessImages.push(dataUrl);
      _renderWellnessImageThumb(idx);
      // Insert [img:N] placeholder at cursor position in body
      if (bodyEl) {
        const marker = `\n\n[img:${idx}]\n\n`;
        const start = bodyEl.selectionStart || bodyEl.value.length;
        bodyEl.value = bodyEl.value.slice(0, start) + marker + bodyEl.value.slice(start);
      }
    } catch (e) {
      console.error('image upload failed:', f.name, e);
      showToast(`อัพโหลด ${f.name} ไม่สำเร็จ`, 'error');
    }
  }
  ev.target.value = ''; // reset for re-pick
};

function _renderWellnessImageThumb(idx) {
  const previewEl = document.getElementById('wellness-images-preview');
  if (!previewEl) return;
  const dataUrl = window._wellnessImages[idx];
  if (!dataUrl) return;
  const thumb = document.createElement('div');
  thumb.id = `_wellness-thumb-${idx}`;
  thumb.style.cssText = 'position:relative;width:100px;height:100px;border:1px solid var(--border);border-radius:6px;overflow:hidden;';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  const label = document.createElement('div');
  label.textContent = `[img:${idx}]`;
  label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);color:#fff;font-size:.65rem;text-align:center;padding:2px;font-family:monospace;';
  thumb.appendChild(img);
  thumb.appendChild(label);
  previewEl.appendChild(thumb);
}

/** Replace [img:N] placeholders with <img src="..."> in saved HTML body. */
function expandWellnessImages(html) {
  if (!html || !window._wellnessImages?.length) return html;
  return html.replace(/\[img:(\d+)\]/g, (_m, n) => {
    const url = window._wellnessImages[Number(n)];
    if (!url) return '';
    return `<img src="${url}" style="max-width:100%;border-radius:8px;margin:8px 0;display:block;" alt="">`;
  });
}
window.expandWellnessImages = expandWellnessImages;

/** Reverse: convert <img src="data:..."> back into [img:N] placeholders + restore _wellnessImages. */
function collapseWellnessImages(html) {
  if (!html) return html;
  window._wellnessImages = [];
  let idx = 0;
  return html.replace(/<img[^>]*src="(data:image\/[^"]+)"[^>]*\/?>/gi, (_m, src) => {
    window._wellnessImages.push(src);
    return `\n\n[img:${idx++}]\n\n`;
  });
}
window.collapseWellnessImages = collapseWellnessImages;

function resetWellnessImages() {
  window._wellnessImages = [];
  const p = document.getElementById('wellness-images-preview');
  if (p) p.innerHTML = '';
}
window.resetWellnessImages = resetWellnessImages;

// Phase: Live wellness articles via onSnapshot (was one-shot getDocs)
let _wellnessUnsub = null;
let _wellnessCache = null;
async function initWellnessArticlesPage() {
  ensureWellnessIconPicker();
  // Render immediately from cache (or empty placeholder) so user doesn't see blank
  await renderWellnessArticlesList();
  if (_wellnessUnsub) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(initWellnessArticlesPage, 1500);
    return;
  }
  try {
    const db = window.firebase.firestore();
    const { collection, onSnapshot } = window.firebase.firestoreFunctions;
    // No orderBy — Firestore would silently exclude docs missing the field.
    // Sort client-side instead.
    _wellnessUnsub = onSnapshot(collection(db, 'wellness_articles'), snap => {
      const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      // Newest first, fallback to title for stable order
      docs.sort((a, b) => {
        const ta = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : (a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0);
        const tb = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : (b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0);
        if (ta !== tb) return tb - ta;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      _wellnessCache = docs;
      renderWellnessArticlesList();
    }, err => console.warn('wellness onSnapshot:', err?.message));
  } catch(e) { console.warn('wellness subscribe:', e); }
}

async function saveWellnessArticle() {
  const title   = document.getElementById('wellness-title').value.trim();
  const icon    = (document.getElementById('wellness-icon').value.trim() || 'fa-leaf').replace(/^fa[srlb]?\s+/, '');
  const excerpt = document.getElementById('wellness-excerpt').value.trim();
  const bodyRaw = document.getElementById('wellness-body').value.trim();
  // Auto-convert plain text → HTML, then expand [img:N] placeholders → <img>
  const body = expandWellnessImages(wellnessBodyToHtml(bodyRaw));
  const category= document.getElementById('wellness-category').value;
  const readtime= parseInt(document.getElementById('wellness-readtime').value) || 3;
  const reward  = parseInt(document.getElementById('wellness-reward').value) || 0;
  const editId  = document.getElementById('wellness-edit-id').value;

  if (!title || !excerpt || !bodyRaw) {
    if (typeof showToast === 'function') showToast('กรอกหัวข้อ + คำโปรย + เนื้อหาให้ครบ', 'error');
    return;
  }
  if (!window.firebase?.firestore) {
    if (typeof showToast === 'function') showToast('Firebase ยังไม่พร้อม ลองรีเฟรชหน้า', 'error');
    return;
  }

  const db = window.firebase.firestore();
  const { collection, doc, addDoc, setDoc, serverTimestamp } = window.firebase.firestoreFunctions || {};
  const data = { title, icon, excerpt, body, category, readtime, reward, updatedAt: serverTimestamp ? serverTimestamp() : new Date() };

  try {
    if (editId) {
      await setDoc(doc(db, 'wellness_articles', editId), data, { merge: true });
      if (typeof showToast === 'function') showToast('อัปเดตบทความเรียบร้อย', 'success');
    } else {
      data.createdAt = serverTimestamp ? serverTimestamp() : new Date();
      await addDoc(collection(db, 'wellness_articles'), data);
      if (typeof showToast === 'function') showToast('บันทึกบทความใหม่แล้ว', 'success');
    }
    resetWellnessForm();
    await renderWellnessArticlesList();
  } catch (e) {
    console.error('saveWellnessArticle failed:', e);
    if (typeof showToast === 'function') showToast('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error');
  }
}

function resetWellnessForm() {
  ['wellness-title','wellness-icon','wellness-excerpt','wellness-body','wellness-edit-id'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const rt = document.getElementById('wellness-readtime'); if (rt) rt.value = '3';
  const rw = document.getElementById('wellness-reward'); if (rw) rw.value = '5';
  const cat = document.getElementById('wellness-category'); if (cat) cat.value = 'Wellness';
  if (typeof resetWellnessImages === 'function') resetWellnessImages();
  if (typeof window.pickWellnessIcon === 'function') window.pickWellnessIcon('fa-leaf');
}

async function renderWellnessArticlesList() {
  const el = document.getElementById('wellnessList');
  if (!el) return;
  // Use cached snapshot if available (populated by onSnapshot in initWellnessArticlesPage)
  let docs = _wellnessCache;
  if (!docs) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">⌛ กำลังโหลด...</div>';
    if (!window.firebase?.firestore) { el.innerHTML = '<div style="color:var(--danger);padding:20px;">Firebase ไม่พร้อม</div>'; return; }
    try {
      const db = window.firebase.firestore();
      const { collection, getDocs } = window.firebase.firestoreFunctions || {};
      const snap = await getDocs(collection(db, 'wellness_articles'));
      docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      docs.sort((a, b) => {
        const ta = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : (a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0);
        const tb = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : (b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0);
        if (ta !== tb) return tb - ta;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      _wellnessCache = docs;
    } catch (e) {
      console.error('renderWellnessArticlesList getDocs:', e);
      el.innerHTML = '<div style="color:var(--danger);padding:20px;">โหลดรายการไม่สำเร็จ: ' + (e.message || e) + '</div>';
      return;
    }
  }
  if (!docs.length) { el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;">ยังไม่มีบทความ — เขียนบทความแรกด้านบน</div>'; return; }
  try {
    el.innerHTML = docs.map(({ id, data: a }) => {
      const d = { id };
      const title = (a.title || '').replace(/</g, '&lt;');
      const excerpt = (a.excerpt || '').replace(/</g, '&lt;');
      return `<div style="padding:1rem;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:var(--green-pale);color:var(--green);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ${a.icon || 'fa-leaf'}"></i></div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;margin-bottom:4px;">${title}</div>
          <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:6px;">${excerpt}</div>
          <div style="font-size:.75rem;color:var(--text-muted);">${a.category || 'Wellness'} • อ่าน ${a.readtime || 3} นาที • ${a.reward > 0 ? '+' + a.reward + ' pts' : 'ไม่ให้แต้ม'}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="editWellnessArticle('${d.id}')" style="padding:6px 10px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun';font-size:.8rem;">✏️ แก้</button>
          <button onclick="deleteWellnessArticle('${d.id}','${title.replace(/'/g, '&#39;')}')" style="padding:6px 10px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun';font-size:.8rem;">🗑️ ลบ</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('renderWellnessArticlesList failed:', e);
    el.innerHTML = '<div style="color:var(--danger);padding:20px;">โหลดรายการไม่สำเร็จ: ' + (e.message || e) + '</div>';
  }
}

async function editWellnessArticle(id) {
  if (!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const { doc, getDoc } = window.firebase.firestoreFunctions || {};
  try {
    const snap = await getDoc(doc(db, 'wellness_articles', id));
    if (!snap.exists()) return;
    const a = snap.data();
    document.getElementById('wellness-title').value = a.title || '';
    // Sync icon picker (visual + hidden input)
    if (typeof window.pickWellnessIcon === 'function') window.pickWellnessIcon(a.icon || 'fa-leaf');
    else { const ic = document.getElementById('wellness-icon'); if (ic) ic.value = a.icon || 'fa-leaf'; }
    document.getElementById('wellness-excerpt').value = a.excerpt || '';
    // Reset images, then collapse <img> back to [img:N] for editing
    resetWellnessImages();
    const collapsed = collapseWellnessImages(a.body || '');
    // Re-render thumbnails for restored images
    (window._wellnessImages || []).forEach((_, idx) => _renderWellnessImageThumb(idx));
    // Convert stored HTML back to plain text for editing
    document.getElementById('wellness-body').value = (typeof wellnessHtmlToText === 'function')
      ? wellnessHtmlToText(collapsed) : collapsed;
    document.getElementById('wellness-category').value = a.category || 'Wellness';
    document.getElementById('wellness-readtime').value = a.readtime || 3;
    document.getElementById('wellness-reward').value = a.reward ?? 5;
    document.getElementById('wellness-edit-id').value = id;
    document.getElementById('wellness-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { console.error('editWellnessArticle failed:', e); }
}

// Seed: 7 starter Wellness articles (mirrors hardcoded fallback in tenant_app.html
// const WELLNESS_ARTICLES). Pushed to Firestore once so admin can edit them.
async function seedWellnessStarters() {
  if (!confirm('นำเข้าบทความตัวอย่าง 7 บทความเข้า Firestore?\n(ถ้ามีอยู่แล้วจะไม่ทับ — id เดียวกันจะข้าม)')) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('Firebase ยังไม่พร้อม', 'error');
    return;
  }
  const STARTERS = [
    { id:'sleep-bedroom',  icon:'fa-spa',         title:'3 เคล็ดลับจัดห้องนอนหลับลึก', excerpt:'ลองปรับแสงไฟโทนอุ่น และวางต้นไม้เล็กๆ ช่วยให้เช้าวันใหม่สดชื่น...', category:'Wellness', readtime:3, reward:5,
      body:'<p><strong>1. ปรับแสงให้อุ่นก่อนนอน 1 ชั่วโมง</strong> — หลอดไฟโทนเหลือง 2700K ช่วยให้ร่างกายหลั่งเมลาโทนิน เข้าสู่โหมดพักผ่อนเร็วขึ้น</p><p><strong>2. ต้นไม้ฟอกอากาศหัวเตียง</strong> — พลูด่าง หรือลิ้นมังกร ดูดซับ CO₂ ตอนกลางคืน ช่วยให้อากาศสดชื่น หลับสนิทขึ้น</p><p><strong>3. อุณหภูมิ 24-26°C</strong> — ร่างกายหลับลึกที่สุดในช่วงนี้ ตั้งแอร์ไว้และห่มผ้าบางๆ ดีกว่าห้องเย็นจัดแล้วห่มหนา</p><p>ลองปรับแค่ 1-2 ข้อแล้วสังเกตคุณภาพการนอนในสัปดาห์นี้</p>' },
    { id:'amethyst-power', icon:'fa-gem',         title:'พลังของ \'หินนำโชค\' อเมทิสต์', excerpt:'ทำความรู้จักกับอเมทิสต์ที่จะช่วยให้ใจคุณสงบ และดึงดูดสิ่งดีๆ...', category:'Mindfulness', readtime:3, reward:5,
      body:'<p>อเมทิสต์เป็นหินในตระกูลควอตซ์สีม่วง ที่โบราณเชื่อว่าช่วย <strong>สงบจิตใจ</strong> และ <strong>ปัดเป่าพลังลบ</strong></p><p><strong>วิธีวางในห้อง:</strong> วางบนโต๊ะทำงาน (ด้านซ้ายสุด ใกล้ประตู) หรือหัวเตียง สะท้อนแสงอ่อนๆ ทำให้บรรยากาศสงบ</p><p><strong>การดูแล:</strong> ล้างด้วยน้ำเปล่าเดือนละครั้ง ตากแดดอ่อนๆ ช่วงเช้า 30 นาที เป็นการ "ชาร์จพลัง" ให้หิน</p><p>นอกจากความเชื่อ การมี object สวยๆ อยู่ในสายตาก็ช่วยลดความเครียดได้จริง</p>' },
    { id:'balcony-charge', icon:'fa-mug-hot',     title:'มุมระเบียงชาร์จพลัง', excerpt:'เปลี่ยนพื้นที่เล็กๆ ให้เป็นที่นั่งดูพระอาทิตย์ตกดินสุดพิเศษสำหรับคุณ...', category:'Lifestyle', readtime:3, reward:5,
      body:'<p>ระเบียง 2×1 เมตร ก็สร้างมุมพักใจได้ ลองทำตามนี้</p><p><strong>เบาะนั่งพื้น</strong> — ซื้อเบาะผ้า waterproof ขนาด 60×60 ซม. + หมอนอิงใบใหญ่ จะได้มุมนั่งทันที</p><p><strong>ต้นไม้แนวตั้ง</strong> — แขวนกระถางพลูบนราวกันตก ประหยัดพื้นที่ + ช่วยกรองฝุ่น PM2.5</p><p><strong>โคมไฟ solar</strong> — ไม่ต้องเดินสายไฟ เก็บแสงกลางวัน กลางคืนให้แสงอุ่นธรรมชาติ</p><p>เวลาที่ดีที่สุดคือ 17:00-18:30 น. ดูแสงส้มกับดื่มชาร้อน</p>' },
    { id:'morning-ritual', icon:'fa-sun',         title:'Morning Ritual 10 นาที เริ่มวันดีทั้งวัน', excerpt:'ลองสร้างนิสัยเล็กๆ ที่ทำให้สมองพร้อมก่อนเช็คโทรศัพท์ครั้งแรก...', category:'Wellness', readtime:3, reward:5,
      body:'<p>อย่าเพิ่งหยิบมือถือทันทีที่ตื่น เปลี่ยนเป็น 10 นาทีนี้แทน</p><p><strong>นาทีที่ 1-3:</strong> ดื่มน้ำเปล่า 1 แก้ว เปิดม่าน รับแสงแดด (รีเซ็ต circadian rhythm)</p><p><strong>นาทีที่ 4-7:</strong> ยืดกล้ามเนื้อง่ายๆ คอ ไหล่ หลัง หายใจลึกๆ 5 ครั้ง</p><p><strong>นาทีที่ 8-10:</strong> เขียน 3 สิ่งที่รู้สึกขอบคุณในสมุด (gratitude journaling)</p><p>ทำแค่ 7 วันจะเห็นความต่าง พลังงานเช้าขึ้นและอารมณ์ดีตลอดวัน</p>' },
    { id:'aromatherapy',   icon:'fa-wind',        title:'กลิ่นที่ช่วยคลายเครียดในห้องคอนโด', excerpt:'Lavender, Bergamot, Eucalyptus — 3 กลิ่นที่ควรมีติดห้องไว้...', category:'Health', readtime:3, reward:5,
      body:'<p>Aromatherapy ไม่ใช่แค่ของสวย — มีงานวิจัยยืนยันผลจริง</p><p><strong>Lavender (ลาเวนเดอร์)</strong> — ใช้ก่อนนอน 30 นาที ลดคลื่นสมองให้ผ่อนคลาย งานวิจัยพบว่าช่วยปรับปรุงคุณภาพการนอน 20%</p><p><strong>Bergamot (เบอร์กามอท)</strong> — ใช้ช่วงบ่าย ลดความวิตกกังวล ให้อารมณ์สดชื่นขึ้น</p><p><strong>Eucalyptus (ยูคาลิปตัส)</strong> — ใช้เช้า ปลุกสมองให้ตื่นตัว เหมาะช่วง WFH</p><p>ใช้ diffuser ดีกว่าเทียนหอม (ปลอดภัยในห้องเล็ก)</p>' },
    { id:'indoor-plants',  icon:'fa-leaf',        title:'5 ต้นไม้ในร่มที่เลี้ยงง่ายสุดๆ', excerpt:'ไม่ต้องรดน้ำบ่อย ไม่ต้องแดดเยอะ แต่ฟอกอากาศได้...', category:'Home', readtime:3, reward:5,
      body:'<p>ต้นไม้ 5 ชนิดนี้ แม้ไม่มีมือเขียวก็เลี้ยงรอด</p><p><strong>1. พลูด่าง (Pothos)</strong> — รดน้ำสัปดาห์ละครั้ง แสงน้อยได้ ฟอก formaldehyde</p><p><strong>2. ลิ้นมังกร (Snake Plant)</strong> — ทนแล้ง ปล่อย O₂ ตอนกลางคืน (วางข้างเตียงได้)</p><p><strong>3. ZZ Plant</strong> — "ต้นฆ่าไม่ตาย" รดน้ำ 2-3 สัปดาห์ครั้ง</p><p><strong>4. Peace Lily</strong> — ดอกสวย ชอบที่ชื้น เหมาะในห้องน้ำ</p><p><strong>5. Monstera</strong> — ใบใหญ่ตระการตา โตเร็ว เติม aesthetic ให้ห้อง</p>' },
    { id:'digital-detox',  icon:'fa-mobile-alt',  title:'Digital Detox 1 ชั่วโมงก่อนนอน', excerpt:'แสงสีฟ้าและการ scroll ก่อนนอน = คุณภาพการนอนแย่ลง...', category:'Wellness', readtime:3, reward:5,
      body:'<p>งานวิจัยชัดเจน: แสงสีฟ้าจากหน้าจอกดการหลั่ง melatonin ทำให้หลับยาก + หลับไม่ลึก</p><p><strong>วิธีทำ Digital Detox:</strong></p><p>• ตั้ง alarm "bedtime mode" 1 ชม. ก่อนนอน</p><p>• วางโทรศัพท์นอกห้องนอน (ใช้นาฬิกาปลุกแทน)</p><p>• เปลี่ยนเป็น <strong>หนังสือเล่ม</strong> ฟังพอดแคสต์เบาๆ หรือเขียน journal</p><p>ยากวันแรก ง่ายวันที่ 4 หลังจากนั้นคุณภาพการนอนดีขึ้นชัดเจน</p>' }
  ];
  const db = window.firebase.firestore();
  const { collection, doc, getDoc, setDoc, serverTimestamp } = window.firebase.firestoreFunctions;
  let pushed = 0, skipped = 0, failed = 0;
  for (const s of STARTERS) {
    try {
      const ref = doc(collection(db, 'wellness_articles'), s.id);
      const snap = await getDoc(ref);
      if (snap.exists()) { skipped++; continue; }
      await setDoc(ref, {
        ...s,
        createdAt: serverTimestamp ? serverTimestamp() : new Date(),
        updatedAt: serverTimestamp ? serverTimestamp() : new Date()
      });
      pushed++;
    } catch (e) { console.error('seed', s.id, e); failed++; }
  }
  showToast(`✅ Seed เสร็จ: เพิ่ม ${pushed} / ข้าม ${skipped} / ล้มเหลว ${failed}`,
            failed ? 'warning' : 'success');
}

async function deleteWellnessArticle(id, title) {
  if (!confirm(`ลบบทความ "${title}" ใช่ไหม?`)) return;
  if (!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const { doc, deleteDoc } = window.firebase.firestoreFunctions || {};
  try {
    await deleteDoc(doc(db, 'wellness_articles', id));
    if (typeof showToast === 'function') showToast('ลบบทความแล้ว', 'success');
    await renderWellnessArticlesList();
  } catch (e) {
    console.error('deleteWellnessArticle failed:', e);
    if (typeof showToast === 'function') showToast('ลบไม่สำเร็จ', 'error');
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

// ===== BILL PAGE =====
let currentBuilding='old';
let invoiceData=null;

// Helper: Convert legacy building names to Firebase config + metadata
function getBuildingInfo(legacyBuilding) {
  const firebaseBuilding = window.CONFIG?.getBuildingConfig?.(legacyBuilding) || (legacyBuilding === 'old' ? 'rooms' : 'nest');
  const metadataArray = legacyBuilding === 'old' ? window.ROOMS_OLD : window.ROOMS_NEW;
  const displayName = legacyBuilding === 'old' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น';
  return { firebaseBuilding, metadataArray, displayName };
}

function onBuildingChange(){
  currentBuilding=document.getElementById('f-building').value;
  populateRoomDropdown();
  document.getElementById('f-trash').value=currentBuilding==='new'?40:20;
  document.getElementById('f-elec-rate').value=8;
  const lf=document.getElementById('f-latefee'); if(lf) lf.value=0;
  renderPaymentStatus();
  if (typeof _refreshPromptPayDisplay === 'function') _refreshPromptPayDisplay();
  calcBill(); resetBillFlow();
}

function populateRoomDropdown(){
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  const sel = document.getElementById('f-room');
  sel.innerHTML = '<option value="">-- เลือกห้อง --</option>' +
    rooms.map(r => {
      const tag = r.type === 'daily' ? '📅 ' : r.type === 'pet' ? '🐾 ' : r.type === 'commercial' ? '☕ ' : '';
      const rent = r.rentPrice || 0;  // Use rentPrice from getActiveRoomsWithMetadata
      return `<option value="${r.id}" data-rent="${rent}" data-elec="${r.elecRate || 8}" data-trash="${r.trashFee || 20}" data-daily="${r.dailyRate || 0}" data-type="${r.type}">${tag}ห้อง ${r.id} — ฿${rent.toLocaleString()}/เดือน</option>`;
    }).join('');
  document.getElementById('f-rent').value = '';
}

function onRoomChange(){
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(!opt||!opt.dataset.rent)return;
  document.getElementById('f-rent').value=opt.dataset.rent;
  document.getElementById('f-elec-rate').value=opt.dataset.elec||8;
  document.getElementById('f-trash').value=opt.dataset.trash||20;

  // Show daily section for daily-type rooms
  const isDaily=opt.dataset.type==='daily';
  const ds=document.getElementById('dailySection');
  ds.classList.toggle('show',isDaily);
  if(isDaily){document.getElementById('f-rent-type').value='monthly';onRentTypeChange();}
  // Show tenant name
  const roomId2 = document.getElementById('f-room').value;
  const tn = document.getElementById('f-tenant-name');
  if(tn){
    const tenants2 = loadTenants();
    const t2 = tenants2[roomId2];
    tn.textContent = t2?.name ? `👤 ${t2.name}${t2.phone?' · '+t2.phone:''}` : '';
  }
  autoFillMeters().then(()=>{ renderPaymentStatus(); resetBillFlow(); });
  renderPaymentStatus();
}

function checkVacant(){
  if(typeof METER_DATA==='undefined'){
    document.getElementById('vc-result').innerHTML='<span style="color:var(--text-muted);">ไม่พบข้อมูลมิเตอร์ (meter_data.js)</span>';
    return;
  }
  const month=parseInt(document.getElementById('vc-month').value);
  const yearFull=parseInt(document.getElementById('vc-year')?.value||(new Date().getFullYear()+543));
  const yy=yearFull%100;
  const key=`${yy}_${month}`;
  const bld = window._pvmBuilding || 'rooms';
  const md=METER_DATA[bld] && METER_DATA[bld][key];
  if(!md){
    document.getElementById('vc-result').innerHTML=`<span style="color:var(--text-muted);">ไม่มีข้อมูลเดือนนี้ในปี ${yy+2500}</span>`;
    return;
  }
  const monthNames=window.CONFIG.months.short;
  const allRooms = bld==='nest'
    ? (window.NEST_ROOMS||[]).map(r=>r.id)
    : ['15ก','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','ร้านใหญ่'];
  const vacant=[], occupied=[], noData=[];
  allRooms.forEach(r=>{
    const d=md[r];
    if(!d){noData.push(r);return;}
    const eUsed=(d.eNew!==null&&d.eOld!==null)?d.eNew-d.eOld:null;
    const wUsed=(d.wNew!==null&&d.wOld!==null)?d.wNew-d.wOld:null;
    if(eUsed===0&&(wUsed===0||wUsed===null)){vacant.push({r,eUsed,wUsed});}
    else{occupied.push({r,eUsed,wUsed});}
  });
  const pill=(r,cls,extra='')=>`<span style="display:inline-flex;align-items:center;gap:4px;margin:3px;padding:5px 12px;border-radius:20px;font-size:.82rem;font-weight:600;${cls}">${r}${extra}</span>`;
  let html=`<div style="margin-bottom:.5rem;font-size:.85rem;color:var(--text-muted);">ข้อมูลปี ${yy+2500} ${monthNames[month]} — มิเตอร์จาก Excel</div>`;
  if(vacant.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--red);margin-right:8px;">🚪 อาจว่าง (ไฟ=0) ${vacant.length} ห้อง</span>`;
    vacant.forEach(({r})=>{ html+=pill(r,'background:#ffebee;color:var(--red);border:1px solid #ffcdd2;'); });
    html+='</div>';
  }
  if(occupied.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--green);margin-right:8px;">✅ มีผู้เช่า ${occupied.length} ห้อง</span>`;
    occupied.forEach(({r,eUsed})=>{ html+=pill(r,`background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green-light);`,eUsed!==null?` <small style="opacity:.7">${eUsed}u</small>`:''); });
    html+='</div>';
  }
  if(noData.length){
    html+=`<div><span style="font-size:.8rem;color:var(--text-muted);margin-right:8px;">❓ ไม่มีข้อมูล ${noData.length} ห้อง: ${noData.join(', ')}</span></div>`;
  }
  document.getElementById('vc-result').innerHTML=html;
}

async function autoFillMeters(){
  renderPaymentStatus();
  const roomId=document.getElementById('f-room').value;
  const month=parseInt(document.getElementById('f-month').value);
  const year=parseInt(document.getElementById('f-year').value);

  // If no room selected, just return
  if(!roomId){
    console.log('⏳ Waiting for room selection...');
    return;
  }
  const yy=year%100;
  const key=`${yy}_${month}`;
  const psKey=`${year}_${month}`;
  const meterDataBuilding = getBuildingInfo(currentBuilding).firebaseBuilding;

  // Phase 1b: single facade — MeterStore handles in-memory + Firestore.
  // Falls back to legacy payment_status only if MeterStore returns null.
  let d = await MeterStore.get(meterDataBuilding, year, month, roomId);
  if (!d) {
    const ps = JSON.parse(localStorage.getItem('payment_status')||'{}');
    if (ps[psKey] && ps[psKey][roomId]) d = ps[psKey][roomId];
  }

  let meterData=null;

  if(d){
    meterData=d;
  } else {
    // No current-month reading — pull previous month as eOld/wOld baseline
    const prevMonth=month===1?12:month-1;
    const prevYear=month===1?year-1:year;
    const prevPsKey=`${prevYear}_${prevMonth}`;
    let prevD = await MeterStore.getPrev(meterDataBuilding, year, month, roomId);
    if (!prevD) {
      const ps=JSON.parse(localStorage.getItem('payment_status')||'{}');
      if (ps[prevPsKey] && ps[prevPsKey][roomId]) prevD = ps[prevPsKey][roomId];
    }
    if(prevD){
      meterData={eNew:'',eOld:prevD.eNew,wNew:'',wOld:prevD.wNew};
    }
  }

  if(meterData){
    document.getElementById('f-elec-new').value=(meterData.eNew!=null?meterData.eNew:'');
    document.getElementById('f-elec-old').value=(meterData.eOld!=null?meterData.eOld:'');
    document.getElementById('f-water-new').value=(meterData.wNew!=null?meterData.wNew:'');
    document.getElementById('f-water-old').value=(meterData.wOld!=null?meterData.wOld:'');
  } else {
    document.getElementById('f-elec-new').value='';
    document.getElementById('f-elec-old').value='';
    document.getElementById('f-water-new').value='';
    document.getElementById('f-water-old').value='';
    // Retry once after 1.2s if METER_DATA was still empty (Firebase not ready yet)
    const isMDEmpty = !window.METER_DATA || (
      Object.keys(window.METER_DATA.rooms||{}).length === 0 &&
      Object.keys(window.METER_DATA.nest||{}).length === 0
    );
    if (isMDEmpty && !autoFillMeters._retried) {
      autoFillMeters._retried = true;
      console.log('⏳ METER_DATA empty — retrying autoFillMeters in 1.2s...');
      setTimeout(() => { autoFillMeters._retried = false; autoFillMeters(); }, 1200);
    }
  }

  calcBill();
}

function onRentTypeChange(){
  const isDaily=document.getElementById('f-rent-type').value==='daily';
  document.getElementById('dailyNightsField').style.display=isDaily?'flex':'none';
  document.getElementById('dailyRateField').style.display=isDaily?'flex':'none';
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(isDaily){
    const rate=parseFloat(opt?.dataset?.daily)||400;
    document.getElementById('f-daily-rate').value=rate;
    document.getElementById('f-rent').value=0;
  } else {
    document.getElementById('f-rent').value=opt?.dataset?.rent||0;
  }
  calcBill();
}

function calcBill(){
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0;
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const lateFee=parseFloat(document.getElementById('f-latefee')?.value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate;
  const wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other+lateFee;

  document.getElementById('f-elec-units').value=eUnits;
  document.getElementById('f-water-units').value=wUnits;
  document.getElementById('c-rent').textContent='฿'+rent.toLocaleString();
  document.getElementById('c-elec-label').textContent=`ค่าไฟ (${eUnits} หน่วย × ฿${eRate})`;
  document.getElementById('c-elec').textContent='฿'+eCost.toLocaleString();
  document.getElementById('c-water-label').textContent=`ค่าน้ำ (${wUnits} หน่วย × ฿${wRate})`;
  document.getElementById('c-water').textContent='฿'+wCost.toLocaleString();
  document.getElementById('c-trash').textContent='฿'+trash.toLocaleString();
  const ot=document.getElementById('c-other-row');
  ot.style.display=other>0?'flex':'none';
  document.getElementById('c-other').textContent='฿'+other.toLocaleString();
  const lfRow=document.getElementById('c-latefee-row');
  if(lfRow) lfRow.style.display = lateFee>0 ? 'flex' : 'none';
  const lfEl=document.getElementById('c-latefee');
  if(lfEl) lfEl.textContent='฿'+lateFee.toLocaleString();
  document.getElementById('c-total').textContent='฿'+total.toLocaleString();
}

// ===== FORM VALIDATION FUNCTIONS =====

/**
 * Validate bill form before generating invoice
 */
function validateBillForm() {
  const errors = [];

  // Validate room selection
  const room = document.getElementById('f-room').value;
  if (!room) {
    errors.push('❌ กรุณาเลือกห้อง');
  } else if (room.length > 20) {
    errors.push('❌ เลขห้องต้องไม่เกิน 20 ตัวอักษร');
  }

  // Validate rent amount
  const isDaily = document.getElementById('f-rent-type')?.value === 'daily' &&
                  document.getElementById('dailySection').classList.contains('show');

  if (isDaily) {
    const nights = parseFloat(document.getElementById('f-nights').value) || 0;
    const dailyRate = parseFloat(document.getElementById('f-daily-rate').value) || 0;
    if (nights <= 0) errors.push('❌ จำนวนคืนต้องมากกว่า 0');
    if (dailyRate <= 0) errors.push('❌ ราคารายวันต้องมากกว่า 0');
  } else {
    const rent = parseFloat(document.getElementById('f-rent').value) || 0;
    if (rent <= 0) errors.push('❌ ค่าเช่าต้องมากกว่า 0');
  }

  // Validate electricity readings
  const eNewVal = document.getElementById('f-elec-new').value;
  const eOldVal = document.getElementById('f-elec-old').value;
  const eNew = eNewVal && eNewVal !== '-' ? parseFloat(eNewVal) || 0 : 0;
  const eOld = eOldVal && eOldVal !== '-' ? parseFloat(eOldVal) || 0 : 0;
  const eRate = parseFloat(document.getElementById('f-elec-rate').value) || 0;
  if (eNew < 0 || eOld < 0) errors.push('❌ เลขมิเตอร์ไฟต้องเป็นจำนวนบวก');
  if (eRate < 0) errors.push('❌ ราคาไฟต้องเป็นจำนวนบวก');
  if (eNew < eOld && eNew > 0) errors.push('⚠️ เลขมิเตอร์ไฟล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate water readings
  const wNewVal = document.getElementById('f-water-new').value;
  const wOldVal = document.getElementById('f-water-old').value;
  const wNew = wNewVal && wNewVal !== '-' ? parseFloat(wNewVal) || 0 : 0;
  const wOld = wOldVal && wOldVal !== '-' ? parseFloat(wOldVal) || 0 : 0;
  const wRate = parseFloat(document.getElementById('f-water-rate').value) || 0;
  if (wNew < 0 || wOld < 0) errors.push('❌ เลขมิเตอร์น้ำต้องเป็นจำนวนบวก');
  if (wRate < 0) errors.push('❌ ราคาน้ำต้องเป็นจำนวนบวก');
  if (wNew < wOld && wNew > 0) errors.push('⚠️ เลขมิเตอร์น้ำล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate other charges
  const trash = parseFloat(document.getElementById('f-trash').value) || 0;
  const other = parseFloat(document.getElementById('f-other').value) || 0;
  if (trash < 0) errors.push('❌ ค่าขยะต้องเป็นจำนวนบวก');
  if (other < 0) errors.push('❌ ค่าบริการต้องเป็นจำนวนบวก');

  // Validate year
  const year = parseInt(document.getElementById('f-year').value);
  if (year < 2560 || year > 2590) errors.push('❌ ปีต้องอยู่ระหว่าง 2560-2590');

  // Validate note length
  const note = document.getElementById('f-note').value;
  if (note.length > 500) errors.push('❌ หมายเหตุต้องไม่เกิน 500 ตัวอักษร');

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate maintenance request form
 */
function validateMaintenanceForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('mx-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้อง');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate date
  const date = document.getElementById('mx-date').value;
  if (!date) {
    errors.push('❌ กรุณาเลือกวันที่แจ้ง');
  } else {
    const selectedDate = new Date(date);
    const today = new Date();
    if (selectedDate > today) {
      errors.push('❌ ไม่สามารถเลือกวันที่ในอนาคตได้');
    }
  }

  // Validate description
  const desc = document.getElementById('mx-desc').value.trim();
  if (!desc) {
    errors.push('❌ กรุณากรอกรายละเอียดปัญหา');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  // Validate category and priority (they have default values so always valid)

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate tenant maintenance form
 */
function validateTenantForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('tp-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้องของคุณ');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate description
  const desc = document.getElementById('tp-description').value.trim();
  if (!desc) {
    errors.push('❌ กรุณาอธิบายปัญหาของคุณ');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Show validation errors in alert
 */
function showValidationErrors(errors) {
  if (errors.length === 0) return false;
  showToast('ข้อมูลไม่ครบถ้วน:\n\n' + errors.join('\n'), 'warning');
  return true;
}

function getBillData(){
  const room=document.getElementById('f-room').value;
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0,rentLabel='ค่าเช่าห้อง';
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate; rentLabel=`ค่าเช่ารายวัน (${nights} คืน × ฿${rate})`;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const lateFee=parseFloat(document.getElementById('f-latefee')?.value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate, wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other+lateFee;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  const note=document.getElementById('f-note').value;
  const building=getBuildingInfo(currentBuilding).displayName;
  const now=new Date();
  const no=`TGH-${year}${String(month).padStart(2,'0')}-${room.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const dateStr=now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
  return{room,building,rent,rentLabel,eNew,eOld,eUnits,eRate,eCost,wNew,wOld,wUnits,wRate,wCost,trash,other,lateFee,total,month,year,note,no,dateStr,now};
}

// ===== SLIPOK VERIFICATION =====
// ✅ SlipOK API keys are now secured in Firebase Cloud Functions
// Client no longer exposes API credentials - all calls go through secure backend
let slipVerified = false;
let slipData = null;

// === RATE LIMITING (Dashboard) ===
const DASHBOARD_RATE_LIMIT_CONFIG = {
  slipVerification: { maxRequests: 3, windowMs: 60000 }, // 3 requests per minute
  billUpload: { maxRequests: 5, windowMs: 3600000 }       // 5 uploads per hour
};
const dashboardRateLimitTracker = {};

function checkDashboardRateLimit(key) {
  const now = Date.now();
  const config = DASHBOARD_RATE_LIMIT_CONFIG[key];
  if (!config) return true;

  if (!dashboardRateLimitTracker[key]) {
    dashboardRateLimitTracker[key] = [];
  }

  // Remove old requests outside the window
  dashboardRateLimitTracker[key] = dashboardRateLimitTracker[key].filter(time => now - time < config.windowMs);

  if (dashboardRateLimitTracker[key].length >= config.maxRequests) {
    return false;
  }

  dashboardRateLimitTracker[key].push(now);
  return true;
}

function validateSlipFileAdmin(file) {
  const errors = [];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`❌ ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push('❌ รูปแบบไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }

  return errors;
}

function handleSlipDrop(e){
  e.preventDefault();
  document.getElementById('slipDropArea').classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if(file) verifySlip(file);
}

async function verifySlip(file){
  if(!file) return;

  // Validate file
  const validationErrors = validateSlipFileAdmin(file);
  if (validationErrors.length > 0) {
    const resultEl = document.getElementById('slipResult');
    resultEl.innerHTML = `<div style="color: #d32f2f; padding: 1rem; background: #ffebee; border-radius: 6px;">${validationErrors.join('<br>')}</div>`;
    return;
  }

  const resultEl = document.getElementById('slipResult');
  const dropText = document.getElementById('slipDropText');

  // Show image preview + loading state
  const reader = new FileReader();
  reader.onload = ev => {
    dropText.innerHTML = `\x3cimg src="${ev.target.result}" style="max-height:90px;border-radius:6px;object-fit:contain;margin-bottom:4px;">\x3cbr>\x3csmall style="color:var(--text-muted);">⏳ กำลังตรวจสอบกับ SlipOK...\x3c/small>`;
  };
  reader.readAsDataURL(file);
  resultEl.innerHTML = '';

  try {
    // Check rate limit
    if (!checkDashboardRateLimit('slipVerification')) {
      throw new Error('⏱️ คำขอมากเกินไป โปรดลองใหม่ในเวลาไม่กี่วินาที');
    }
    // Convert file to base64 for Cloud Function
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const billTotal = invoiceData?.total || 0;
    const room = invoiceData?.room || 'unknown';
    // invoiceData.building is a display name — map to 'rooms' or 'nest' for Cloud Function
    const buildingRaw = (currentBuilding === 'nest') ? 'nest' : 'rooms';
    // Call Firebase Cloud Function (API key secured server-side)
    const res = await fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/verifySlip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, expectedAmount: billTotal || 1, building: buildingRaw, room })
    });
    if (!res.ok && res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Cloud Function error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = await res.json();

    if(json.success && json.data){
      const d = json.data;
      const amount  = d.amount ?? 0;
      const sender  = d.sender?.displayName || d.sender?.name || '—';
      const receiver= d.receiver?.displayName || d.receiver?.name || '—';
      const ref     = d.transRef || d.transactionId || '—';
      // SlipOK returns transTimestamp (ISO) + transDate (YYYYMMDD) + transTime (HH:MM:SS)
      const transferDate = d.transTimestamp || null;
      const tDate   = transferDate ? new Date(transferDate).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : '—';
      const amountOk  = json.amountValid !== undefined ? json.amountValid : (billTotal <= 0 || Math.abs(amount - billTotal) < 1);

      slipVerified = true;
      slipData = {amount, sender, receiver, ref, tDate, transferDate, amountOk};

      resultEl.innerHTML = `
        <div class="slip-result-ok">
          <div style="font-weight:700;font-size:.88rem;color:var(--green-dark);margin-bottom:6px;">✅ สลิปผ่านการตรวจสอบ!</div>
          <div class="slip-result-row"><span>ผู้โอน</span><span><strong>${sender}</strong></span></div>
          <div class="slip-result-row"><span>ผู้รับ</span><span>${receiver}</span></div>
          <div class="slip-result-row"><span>จำนวนเงิน</span>
            <span class="${amountOk?'slip-amount-ok':'slip-amount-warn'}">฿${amount.toLocaleString()} ${amountOk?'✅':'⚠️ ยอดไม่ตรงกับบิล'}</span></div>
          <div class="slip-result-row"><span>วันเวลา</span><span>${tDate}</span></div>
          <div class="slip-result-row"><span>เลขอ้างอิง</span><span style="font-size:.75rem;word-break:break-all;">${ref}</span></div>
        </div>`;
      enableReceiptBtn();
    } else {
      const msg = json.message || json.data?.message || 'ไม่ทราบสาเหตุ';
      resultEl.innerHTML = `<div class="slip-result-err">❌ <strong>สลิปไม่ผ่าน:</strong> ${msg}<br><small>ลองถ่ายรูปใหม่ให้คมชัดขึ้น หรือตรวจว่าสลิปถูกต้อง</small></div>`;
    }
  } catch(err){
    console.error('❌ verifySlip error:', err);
    resultEl.innerHTML = `<div class="slip-result-err">⚠️ เชื่อมต่อ Cloud Function ไม่ได้<br>
      <small>${err.message || 'Network error'}</small><br>
      <button onclick="skipSlipVerify()" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:#fff;">ออกใบเสร็จโดยไม่ตรวจสลิป</button>
    </div>`;
  }
}

function skipSlipVerify(){
  slipVerified = false;
  slipData = null;
  document.getElementById('slipResult').innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0;">ข้ามการตรวจสลิป (รับเงินสด) — กดออกใบเสร็จได้เลย ✅</div>';
  enableReceiptBtn();
}

function enableReceiptBtn(){
  const btn = document.getElementById('btnReceipt');
  btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
  document.getElementById('billHint').textContent = slipVerified
    ? `✅ ตรวจสลิปผ่าน ฿${slipData.amount.toLocaleString()} (${slipData.sender}) — กดออกใบเสร็จได้เลย`
    : '✅ พร้อมออกใบเสร็จ — กดปุ่มด้านบน';
}

// ===== PROMPTPAY QR (per-building, sourced from Firestore buildings/{id}) =====
// Legacy localStorage key ('promptpay') kept as cross-page cache — tenant_app.html
// reads it; dashboard mirrors the Firestore per-building value into it on each
// building change (see below).
let PROMPTPAY_NUMBER = localStorage.getItem('promptpay') || '';
window._buildingPaymentCache = window._buildingPaymentCache || { rooms: {}, nest: {} };

// Refresh PromptPay display on bill page based on currently selected building
function _refreshPromptPayDisplay(){
  try {
    const bldg = document.getElementById('f-building')?.value;
    if (!bldg) return;
    const canonical = (bldg === 'new' || bldg === 'nest') ? 'nest' : 'rooms';
    const cfg = window._buildingPaymentCache[canonical] || {};
    // Fallback chain: Firestore per-building → legacy localStorage.promptpay → empty
    const num = cfg.promptpayNumber || cfg.payment?.promptpayNumber
                || localStorage.getItem('promptpay') || '';
    const ownerInfo = (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};
    const payee = cfg.companyName || cfg.payment?.companyName
                || ownerInfo.companyLegalNameTH || '';
    PROMPTPAY_NUMBER = num;
    localStorage.setItem('promptpay', num); // mirror for legacy code paths
    const numEl = document.getElementById('pp-display-number');
    const payeeEl = document.getElementById('pp-display-payee');
    if (numEl) numEl.textContent = num ? num.replace(/(\d{3})(\d{3})(\d+)/, '$1-$2-$3') : '— (ยังไม่ตั้ง)';
    if (payeeEl) payeeEl.textContent = payee ? `· ${payee}` : '';
  } catch(e) { console.warn('_refreshPromptPayDisplay:', e); }
}

// Subscribe Firestore buildings/{RentRoom|nest} once Firebase ready
function _subscribeBuildingPaymentForBill(){
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeBuildingPaymentForBill, 1000);
    return;
  }
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const map = { rooms: 'RentRoom', nest: 'nest' };
  Object.entries(map).forEach(([canonical, fsId]) => {
    try {
      fs.onSnapshot(fs.doc(db, 'buildings', fsId), snap => {
        window._buildingPaymentCache[canonical] = snap.exists ? snap.data() : {};
        _refreshPromptPayDisplay();
      }, err => console.warn('buildings/'+fsId+' listen:', err?.message));
    } catch(e) { console.warn('buildings subscribe error:', e); }
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_subscribeBuildingPaymentForBill, 500));

// ===== PaymentStore — single facade for payment lookups (Phase 2b 2026-04-19) =====
// Single Source of Truth: Firestore verifiedSlips (CF-written by SlipOK).
//   In-memory cache keyed [yearBE_month][room] — populated by the global
//   onSnapshot below. Falls back to legacy localStorage payment_status for
//   admin manual entries that never flowed through SlipOK.
//   Use PaymentStore.isPaid / .getSlip / .onChange instead of touching
//   loadPS()/payment_status directly.
window.PaymentStore = window.PaymentStore || (function(){
  const cache = {};       // {yearBE_month: {room: paymentEntry}}
  const listeners = new Set();
  function _key(year, month) {
    const beYear = Number(year) < 2400 ? Number(year) + 543 : Number(year);
    return `${beYear}_${Number(month)}`;
  }
  function _readLegacy() {
    try { return JSON.parse(localStorage.getItem('payment_status')||'{}'); }
    catch(e) { return {}; }
  }
  function isPaid(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    if (cache[k]?.[r]?.status === 'paid') return true;
    const legacy = _readLegacy();
    return legacy[k]?.[r]?.status === 'paid';
  }
  function getSlip(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    return cache[k]?.[r] || _readLegacy()[k]?.[r] || null;
  }
  function listForMonth(year, month) {
    const k = _key(year, month);
    return { ...(_readLegacy()[k] || {}), ...(cache[k] || {}) };
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function _ingest(yearBE, month, room, entry) {
    const k = `${yearBE}_${month}`;
    if (!cache[k]) cache[k] = {};
    cache[k][room] = entry;
  }
  function _notify() { listeners.forEach(fn => { try { fn(); } catch(e){} }); }
  return { isPaid, getSlip, listForMonth, onChange, _ingest, _notify };
})();

// ===== GLOBAL verifiedSlips SYNC → PaymentStore + payment_status + bill pills =====
// Runs once on load; when tenant pays via tenant_app, the slip arrives here and
// flips the bill-page pill to ✅ in real-time (ครอบคลุมทั้ง Rooms + Nest)
window._globalSlipsUnsub = null;
function _subscribeGlobalVerifiedSlips(){
  if (window._globalSlipsUnsub) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeGlobalVerifiedSlips, 1500);
    return;
  }
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const q = fs.query(fs.collection(db, 'verifiedSlips'), fs.orderBy('timestamp','desc'), fs.limit(300));
    window._globalSlipsUnsub = fs.onSnapshot(q, snap => {
      const ps = loadPS();
      let changed = false;
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') return;
        const s = ch.doc.data();
        if (!s || s.verified === false) return;
        const room = String(s.room || '');
        if (!room) return;
        // Derive year_month (BE year) from slip timestamp
        const ts = s.timestamp?.toDate ? s.timestamp.toDate()
                 : (s.transTimestamp ? new Date(s.transTimestamp)
                 : (s.date ? new Date(s.date) : new Date()));
        const yearBE = ts.getFullYear() + 543;
        const month = ts.getMonth() + 1;
        const key = `${yearBE}_${month}`;
        const entry = {
          status: 'paid',
          amount: s.amount || 0,
          date: ts.toISOString(),
          receiptNo: s.transactionId || s.transRef || ch.doc.id,
          fromTenantApp: true,
          building: s.building || null,
          slip: {
            amount: s.amount || 0,
            sender: s.sender || '',
            bankCode: s.bankCode || '',
            ref: s.transactionId || s.transRef || '',
            transferDate: ts.toISOString()
          }
        };
        // Always feed PaymentStore in-memory cache (idempotent)
        try { window.PaymentStore._ingest(yearBE, month, room, entry); } catch(e){}
        // Mirror to legacy payment_status (skip if already paid there)
        if (ps[key]?.[room]?.status === 'paid') return;
        if (!ps[key]) ps[key] = {};
        ps[key][room] = entry;
        changed = true;
      });
      if (changed) {
        savePS(ps);
        try { window.PaymentStore._notify(); } catch(e){}
        // Re-render bill page pills if open
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){}
        }
        // Re-render monthly report if open
        if (typeof renderMonthlyReport === 'function' &&
            document.getElementById('page-monthly')?.classList.contains('active')) {
          try { renderMonthlyReport(); } catch(e){}
        }
        console.log('💸 Synced tenant-app payment → PaymentStore + payment_status');
      } else {
        // Even when no new slips, fire ingestion of the snapshot's full state
        // so PaymentStore cache is populated at startup
        try { window.PaymentStore._notify(); } catch(e){}
      }
    }, err => console.warn('global verifiedSlips listen:', err?.message));
  } catch(e) { console.warn('subscribeGlobalVerifiedSlips:', e); }
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_subscribeGlobalVerifiedSlips, 800));

// PaymentStore listener: auto-rerender payment grid when a new slip arrives
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof window.PaymentStore !== 'undefined') {
      window.PaymentStore.onChange(() => {
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){}
        }
      });
    }
  }, 1000);
});

function buildPromptPayPayload(phone,amount){
  const s=phone.replace(/[^0-9]/g,'');
  const t=s.startsWith('0')?'0066'+s.slice(1):s;
  const aid='0016A000000677010111'+'01'+String(t.length).padStart(2,'0')+t;
  const a=amount.toFixed(2);
  let p='000201'+'010212'+'29'+String(aid.length).padStart(2,'0')+aid+'5303764'+'54'+String(a.length).padStart(2,'0')+a+'5802TH'+'6304';
  let c=0xFFFF;
  for(let i=0;i<p.length;i++){c^=p.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=(c&0x8000)?((c<<1)^0x1021):(c<<1);}
  return p+(c&0xFFFF).toString(16).toUpperCase().padStart(4,'0');
}

function renderQR(elementId,amount){
  const el=document.getElementById(elementId);
  if(!el)return;
  if(!PROMPTPAY_NUMBER){el.style.display='none';return;}
  try{
    const payload=buildPromptPayPayload(PROMPTPAY_NUMBER,amount);
    const wrap=document.createElement('div');
    new QRCode(wrap,{text:payload,width:160,height:160,correctLevel:QRCode.CorrectLevel.M});
    setTimeout(()=>{
      const src=wrap.querySelector('canvas')?.toDataURL()||wrap.querySelector('img')?.src||'';
      el.src=src; el.style.display=src?'block':'none';
    },120);
  }catch(e){console.warn('QR generation failed:',e);el.style.display='none';}
}

let isGeneratingInvoice = false; // Prevent rapid clicks
function generateInvoice(){
  // Prevent rapid button clicks
  if(isGeneratingInvoice) return;
  isGeneratingInvoice = true;
  setTimeout(() => { isGeneratingInvoice = false; }, 1500);

  // Validate bill form before processing
  const validation = validateBillForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    isGeneratingInvoice = false;
    return;
  }

  const d=getBillData();
  if(!d.room||d.total===0){showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');return;}
  invoiceData=d;

  // Due date = 5th of next month
  const due=new Date(d.now); due.setDate(5); if(due<=d.now)due.setMonth(due.getMonth()+1);
  const dueStr=due.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide receipt panel to show only invoice
  document.getElementById('receiptPanel').style.display='none';
  document.getElementById('invoicePanel').style.display='block';

  document.getElementById('invoicePanel').innerHTML=buildDocHTML(d,'invoice',dueStr);
  renderQR('qr-payment', d.total); // generate PromptPay QR with bill amount

  // ===== AUDIT LOGGING =====
  if (window.logBillGenerated) {
    window.logBillGenerated(d.room, d.total, { invoiceNumber: d.no, building: d.building, month: d.month, year: d.year });
  }

  // Show slip verification section (instead of auto-enabling receipt)
  slipVerified=false; slipData=null;
  document.getElementById('slipResult').innerHTML='';
  document.getElementById('slipDropText').innerHTML='🖼️ แตะเพื่ออัปโหลดสลิป หรือลากมาวางที่นี่<br><small>SlipOK ตรวจสอบชื่อ ยอด วันเวลา สลิปซ้ำ ภายใน 3 วินาที</small>';
  document.getElementById('slipFileInput').value='';
  document.getElementById('slipVerifySection').classList.add('show');
  document.getElementById('billHint').textContent='📲 อัปโหลดสลิปเพื่อตรวจสอบ → จากนั้นออกใบเสร็จได้เลย';
  document.getElementById('step1').className='step done';
  document.getElementById('step2').className='step active';
  document.getElementById('invoicePanel').scrollIntoView({behavior:'smooth'});
}

let isGeneratingReceipt = false; // Prevent rapid clicks
function generateReceipt(){
  if(isGeneratingReceipt) return;
  isGeneratingReceipt = true;
  setTimeout(() => { isGeneratingReceipt = false; }, 1500);

  if(!invoiceData){showToast('กรุณาส่งใบวางบิลก่อน', 'warning');isGeneratingReceipt = false;return;}
  const d=invoiceData;
  const payDate=new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide invoice panel to show only receipt
  document.getElementById('invoicePanel').style.display='none';
  document.getElementById('receiptPanel').style.display='block';

  // ===== AUDIT LOGGING =====
  if (window.AuditLogger) {
    window.AuditLogger.log(
      window.AuditActionTypes.RECEIPT_GENERATED,
      `Generated receipt for room ${d.room}: ฿${d.total.toLocaleString()}`,
      { room: d.room, amount: d.total, receiptNumber: d.no, slipVerified: slipVerified }
    );
  }
  // Attach slip verification result if available
  const slipNote = slipVerified && slipData
    ? `<div style="margin-top:10px;padding:8px;background:#e8f5e9;border-radius:6px;font-size:.78rem;color:var(--green-dark);">✅ ยืนยันด้วย SlipOK · ผู้โอน: ${slipData.sender} · ฿${slipData.amount.toLocaleString()} · ${slipData.tDate}</div>`
    : '';
  document.getElementById('receiptPanel').innerHTML=buildDocHTML(d,'receipt',null,payDate)+slipNote;
  document.getElementById('step2').className='step done';
  document.getElementById('slipVerifySection').classList.remove('show');
  markRoomPaid(d); // บันทึกสถานะห้องนี้ว่าชำระแล้ว
  document.getElementById('receiptPanel').scrollIntoView({behavior:'smooth'});
}

function buildDocHTML(d,type,dueDate,payDate){
  const isInvoice=type==='invoice';
  const color=isInvoice?'var(--blue)':'var(--green-dark)';
  const titleText=isInvoice?'ใบวางบิล / Invoice':'ใบเสร็จรับเงิน / Receipt';
  const stamp=isInvoice?`<div class="doc-stamp stamp-pending">⏳ รอชำระ</div>`:`<div class="doc-stamp stamp-paid">✅ ชำระแล้ว</div>`;
  const due=isInvoice?`<div class="due-box">⏰ กรุณาชำระภายใน ${dueDate}</div>`:'';

  // QR PromptPay section — แสดงในใบวางบิลเท่านั้น (ก่อนชำระ)
  const qrSection = PROMPTPAY_NUMBER ? `
    <div class="qr-section">
      <div class="qr-title">📲 สแกน QR เพื่อชำระเงิน</div>
      <img id="qr-payment" src="" alt="QR PromptPay" style="width:160px;height:160px;border-radius:8px;border:4px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.15);">
      <div><div class="qr-amount-badge">฿${d.total.toLocaleString()}</div></div>
      <div class="qr-footer-text">พร้อมเพย์: ${PROMPTPAY_NUMBER}<br>สแกนแล้วยอดขึ้นอัตโนมัติ ไม่ต้องพิมพ์ตัวเลข</div>
    </div>` : '';

  const docId = isInvoice ? 'doc-invoice' : 'doc-receipt';
  const _ownerForDoc = (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};
  const logoName = _ownerForDoc.companyLegalNameTH || 'The Green Haven';
  const logoHTML = _ownerForDoc.logoDataUrl
    ? `<img src="${_ownerForDoc.logoDataUrl}" alt="logo" style="max-height:56px;max-width:180px;object-fit:contain;vertical-align:middle;"><div style="font-size:.85rem;color:var(--text-muted);margin-top:4px;">${logoName}</div>`
    : `🌿 ${logoName}`;
  return`
  <div id="${docId}" class="doc-body">
    <div class="doc-header">
      <div class="doc-logo">${logoHTML}</div>
      <div class="doc-sub">${d.building}</div>
      <div class="doc-title ${type}">${titleText}</div>
      <div class="doc-no">เลขที่: ${d.no}</div>
    </div>
    <div class="doc-content">
      <div class="d-row"><span>ห้องเลขที่:</span><strong>ห้อง ${d.room}</strong></div>
      <div class="d-row"><span>ประจำเดือน:</span><strong>${MONTHS_FULL[d.month]} ${d.year}</strong></div>
      <div class="d-row"><span>${isInvoice?'วันที่ออกบิล':'วันที่ชำระ'}:</span><span>${isInvoice?d.dateStr:payDate}</span></div>
      <hr class="d-divider">
      <div class="d-row"><span>${d.rentLabel}</span><span>฿${d.rent.toLocaleString()}</span></div>
      ${d.eOld!=null||d.eNew!=null?`<div class="d-row"><span>ค่าไฟฟ้า</span><span>฿${(d.eCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์ไฟ: ${d.eOld||0} → ${d.eNew||0} (${d.eUnits||0} หน่วย × ฿${d.eRate||0})</span></div>`:''}
      ${d.wOld!=null||d.wNew!=null?`<div class="d-row"><span>ค่าน้ำประปา</span><span>฿${(d.wCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์น้ำ: ${d.wOld||0} → ${d.wNew||0} (${d.wUnits||0} หน่วย × ฿${d.wRate||0})</span></div>`:''}
      ${d.trash>0?`<div class="d-row"><span>ค่าขยะ</span><span>฿${d.trash.toLocaleString()}</span></div>`:''}
      ${d.other>0?`<div class="d-row"><span>ค่าบริการอื่นๆ</span><span>฿${d.other.toLocaleString()}</span></div>`:''}
      ${d.lateFee>0?`<div class="d-row" style="color:#c62828;"><span>⚠️ ค่าปรับ</span><span>฿${d.lateFee.toLocaleString()}</span></div>`:''}
      ${d.note?`<div class="d-row" style="font-size:.78rem;color:var(--accent);"><span>หมายเหตุ:</span><span>${d.note}</span></div>`:''}
      <div class="d-total ${type}"><span>รวมทั้งสิ้น</span><span>฿${d.total.toLocaleString()}</span></div>
    </div>
    ${isInvoice ? qrSection : ''}
    <div class="doc-footer">
      ${due}${stamp}
      <div>ขอบคุณที่ใช้บริการ The Green Haven</div>
      ${!isInvoice?'<div>กรุณาเก็บใบเสร็จไว้เป็นหลักฐาน</div>':''}
    </div>
  </div>
  <div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
    <button class="btn-doc-action ${isInvoice?'blue':'green'}" onclick="printDoc('${docId}')">🖨️ พิมพ์ / บันทึก PDF</button>
  </div>`;
}

function resetBillFlow(){
  invoiceData=null; slipVerified=false; slipData=null;
  document.getElementById('invoicePanel').innerHTML=`<div class="doc-placeholder"><div class="icon">📄</div><div style="font-size:.9rem;font-weight:600;">กรอกข้อมูลและกด "ส่งใบวางบิล"</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 1 — แจ้งยอดก่อนชำระ</div></div>`;
  document.getElementById('receiptPanel').innerHTML=`<div class="doc-placeholder"><div class="icon">✅</div><div style="font-size:.9rem;font-weight:600;">กด "ออกใบเสร็จรับเงิน" หลังรับเงินแล้ว</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 2 — ยืนยันการชำระเงิน</div></div>`;
  document.getElementById('btnReceipt').disabled=true;
  document.getElementById('btnReceipt').style.opacity='.4';
  document.getElementById('btnReceipt').style.cursor='not-allowed';
  document.getElementById('billHint').textContent='ส่งใบวางบิลก่อน → อัปโหลดสลิป → ออกใบเสร็จรับเงิน';
  document.getElementById('step1').className='step active';
  document.getElementById('step2').className='step pending';
  document.getElementById('slipVerifySection').classList.remove('show');
  document.getElementById('slipResult').innerHTML='';
}

// ===== PRINT DOC — popup หน้าเดียว ไม่มี header/footer ของ browser =====
let printWindow = null; // Track print window to prevent accumulation

let isPrinting = false; // Prevent rapid print requests
function printDoc(docId){
  // Prevent rapid print requests
  if(isPrinting) return;
  isPrinting = true;
  setTimeout(() => { isPrinting = false; }, 2000);

  // Close previous print window if still open
  if(printWindow && !printWindow.closed){
    try{printWindow.close();}catch(e){}
  }

  const el=document.getElementById(docId);
  if(!el){showToast('ไม่พบเอกสาร', 'error');return;}
  // รวม styles ทั้งหมดจากหน้าหลัก
  const styles=[...document.querySelectorAll('style')].map(s=>s.innerHTML).join('\n');
  const fonts='<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
  const content=el.outerHTML;
  const html=`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">${fonts}
<style>
${styles}
/* Print overrides - let browser print dialog handle page size */
@page{margin:10mm;}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:#fff!important;padding:0;margin:0;}
  .doc-body{max-width:100%!important;box-shadow:none!important;padding:15mm;}
  .btn-doc-action{display:none!important;}
}
</style></head>
<body>${content}</body></html>`;

  printWindow=window.open('','_blank','width=420,height=700,toolbar=0,menubar=0,scrollbars=1');
  if(!printWindow){showToast('Pop-up ถูกบล็อก — กรุณาอนุญาต pop-up สำหรับ localhost', 'warning');return;}

  // ตั้งให้ปิดเมื่อ unload
  printWindow.onunload = () => { printWindow = null; };

  printWindow.document.write(html);
  printWindow.document.close();

  // รอ QR image โหลดก่อน print
  const imgs=printWindow.document.querySelectorAll('img');
  const doPrint=()=>{
    try{printWindow.focus();printWindow.print();}catch(e){}
    // Force close window หลัง print dialog (รอเพื่อให้ user กด Save/Cancel)
    setTimeout(()=>{
      if(printWindow && !printWindow.closed){
        try{printWindow.close();}catch(e){}
      }
      printWindow = null; // Clear reference completely
    }, 1000);
  };

  if(imgs.length===0){
    setTimeout(doPrint,400);
  } else {
    let done=0;
    const tryPrint=()=>{if(++done>=imgs.length)setTimeout(doPrint,200);};
    imgs.forEach(img=>{img.complete?tryPrint():(img.onload=tryPrint,img.onerror=tryPrint);});
    setTimeout(doPrint,3000); // fallback 3 วิ
  }
}

// ===== PAYMENT STATUS TRACKING =====
function loadPS(){return JSON.parse(localStorage.getItem('payment_status')||'{}');}
function savePS(ps){localStorage.setItem('payment_status',JSON.stringify(ps));}

function markRoomPaid(d){
  const ps=loadPS();
  const key=`${d.year}_${d.month}`;
  if(!ps[key])ps[key]={};
  ps[key][d.room]={
    status:'paid', amount:d.total, date:new Date().toISOString(),
    receiptNo:d.no, eNew:d.eNew, eOld:d.eOld, wNew:d.wNew, wOld:d.wOld,
    slip:slipVerified?{
      amount:slipData.amount,
      sender:slipData.sender,
      receiver:slipData.receiver,
      ref:slipData.ref,
      tDate:slipData.tDate,
      transferDate:slipData.transferDate,  // ISO datetime — for on-time gamification
      dueDate:`${d.year}-${String(d.month).padStart(2,'0')}-05`,  // 5th of billing month
      amountOk:slipData.amountOk
    }:null
  };
  savePS(ps);
  renderPaymentStatus();

  // ===== SYNC BILL STATUS → bills_YYYY (tenant app reads this) =====
  if (typeof BillingSystem !== 'undefined') {
    const yr = parseInt(d.year);
    const bill = BillingSystem.getBillByMonthYear(d.room, d.month, yr);
    if (bill) {
      BillingSystem.updateBillStatus(bill.billId, 'paid', yr);
      console.log(`🔄 Synced bill status to bills_${yr}: room ${d.room} month ${d.month} → paid`);
    }
  }

  // ===== SYNC PAYMENT RECORD → payment_{building}_{room} (tenant history) =====
  try {
    const fbBuilding = (typeof getBuildingInfo === 'function')
      ? getBuildingInfo(currentBuilding).firebaseBuilding
      : (currentBuilding === 'old' ? 'rooms' : 'nest');
    const phKey = `payment_${fbBuilding}_${d.room}`;
    const history = JSON.parse(localStorage.getItem(phKey) || '[]');
    history.unshift({
      billId: d.no,
      month: d.month,
      year: parseInt(d.year),
      amount: d.total,
      paidAt: new Date().toISOString(),
      method: slipVerified ? 'PromptPay' : 'Cash',
      slipOkVerified: !!slipVerified
    });
    localStorage.setItem(phKey, JSON.stringify(history));
    console.log(`💾 Synced payment history → ${phKey}`);
  } catch(e) { console.warn('payment history sync failed', e); }

  // ===== SAVE BILL TO FIREBASE FOR TENANT APP =====
  saveBillToFirebase(d);
}

async function saveBillToFirebase(d){
  try {
    if (!window.firebaseDatabase || !window.firebaseSet) {
      console.warn('⚠️ Firebase not initialized, skipping bill save');
      return;
    }

    // Create bill object with all necessary data for tenant app
    const billObject = {
      billId: d.no,
      room: d.room,
      building: d.building,
      month: d.month,
      year: d.year,
      status: 'paid',
      billDate: d.dateStr,
      totalCharge: d.total,
      charges: {
        rent: d.rent,
        rentLabel: d.rentLabel,
        electric: {
          cost: d.eCost || 0,
          old: d.eOld || 0,
          new: d.eNew || 0,
          units: d.eUnits || 0,
          rate: d.eRate || 8
        },
        water: {
          cost: d.wCost || 0,
          old: d.wOld || 0,
          new: d.wNew || 0,
          units: d.wUnits || 0,
          rate: d.wRate || 20
        },
        trash: d.trash || 0,
        common: d.other || 0
      },
      meterReadings: {
        electric: { old: d.eOld || 0, new: d.eNew || 0, units: d.eUnits || 0 },
        water: { old: d.wOld || 0, new: d.wNew || 0, units: d.wUnits || 0 }
      },
      note: d.note || '',
      createdAt: new Date().toISOString(),
      slipVerified: slipVerified,
      slipData: slipVerified && slipData ? {
        amount: slipData.amount,
        sender: slipData.sender,
        receiver: slipData.receiver,
        ref: slipData.ref,
        tDate: slipData.tDate,
        transferDate: slipData.transferDate,  // ISO — actual transfer time
        dueDate: `${d.year}-${String(d.month).padStart(2,'0')}-05`,
        paidOnTime: slipData.transferDate
          ? new Date(slipData.transferDate) <= new Date(`${d.year}-${String(d.month).padStart(2,'0')}-05T23:59:59`)
          : null
      } : null
    };

    // Save to Firebase: bills/{building}/{roomId}/{billId}
    // Tenant app expects: bills/{building}/{room} as an object with billIds as keys
    const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');

    // Determine Firebase building ID using proper conversion
    // currentBuilding is 'old' or 'new', need to convert to 'rooms' or 'nest'
    const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);

    // Save bill at bills/{building}/{room}/{billId}
    const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${d.room}/${d.no}`);
    await window.firebaseSet(billsRef, billObject);

    console.log(`✅ Bill saved to Firebase: bills/${fbBuildingId}/${d.room}/${d.no}`);
  } catch (error) {
    console.error('❌ Error saving bill to Firebase:', error);
  }
}

// ===== AUTO-GENERATE BILLS FROM FIREBASE METER DATA =====
async function autoGenerateAllBills() {
  const month = parseInt(document.getElementById('f-month').value);
  const year = document.getElementById('f-year').value;
  const bldgInfo = getBuildingInfo(currentBuilding);
  const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);

  // VERIFICATION #1: Check room count before generation
  const expectedRoomCount = fbBuildingId === 'rooms' ? 23 : 10; // 23 for Rooms, 10 for Nest
  const actualRoomCount = rooms.length;

  if (actualRoomCount !== expectedRoomCount) {
    const proceed = confirm(
      `⚠️ Warning: Expected ${expectedRoomCount} rooms but found ${actualRoomCount}.\n\n` +
      `This may result in incomplete bill generation.\n\n` +
      `Continue anyway?`
    );
    if (!proceed) {
      console.log('❌ Bill generation cancelled by user');
      return;
    }
  }

  console.log(`🚀 Auto-generating bills for ${fbBuildingId}/${month}/${year}... (${actualRoomCount} rooms)`);

  try {
    // Get meter data from Firebase for this month
    const yearMonth = `${year % 100}_${String(month).padStart(2, '0')}`;
    const meterData = await FirebaseMeterHelper.getMeterDataForMonth(fbBuildingId, yearMonth);

    if (!meterData) {
      showToast(`ไม่พบข้อมูลมิเตอร์สำหรับ ${MONTHS_FULL[month]} ${year + 543}`, 'error');
      return;
    }

    let generatedCount = 0;
    const generatedBills = [];
    const totalMeterEntries = Object.entries(meterData).length;

    // Generate bill for each room with meter data
    for (const [roomId, meterReadings] of Object.entries(meterData)) {
      // Show progress
      const progressPercent = Math.round((generatedCount / totalMeterEntries) * 100);
      console.log(`📊 Generating bills... ${generatedCount}/${totalMeterEntries} (${progressPercent}%)`);
      // Get room config
      const roomConfig = rooms.find(r => r.id === roomId);
      if (!roomConfig) continue;

      const rent = roomConfig.rent || 0;
      const eRate = roomConfig.elecRate || 8;
      const wRate = 20; // Standard water rate
      const trash = roomConfig.trashFee || 20;

      // Calculate costs from meter data
      const eUnits = Math.max(0, (meterReadings.eNew || 0) - (meterReadings.eOld || 0));
      const wUnits = Math.max(0, (meterReadings.wNew || 0) - (meterReadings.wOld || 0));
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      // Create bill object
      const now = new Date();
      const billObject = {
        billId: `TGH-${year}${String(month).padStart(2,'0')}-${roomId.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`,
        room: roomId,
        building: bldgInfo.displayName,
        month: month,
        year: year,
        status: 'pending',
        billDate: now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}),
        totalCharge: total,
        charges: {
          rent: rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: meterReadings.eOld || 0,
            new: meterReadings.eNew || 0,
            units: eUnits || 0,
            rate: eRate || 8
          },
          water: {
            cost: wCost || 0,
            old: meterReadings.wOld || 0,
            new: meterReadings.wNew || 0,
            units: wUnits || 0,
            rate: wRate || 20
          },
          trash: trash || 0,
          common: 0
        },
        meterReadings: {
          electric: { old: meterReadings.eOld || 0, new: meterReadings.eNew || 0, units: eUnits || 0 },
          water: { old: meterReadings.wOld || 0, new: meterReadings.wNew || 0, units: wUnits || 0 }
        },
        note: '',
        createdAt: new Date().toISOString()
      };

      // Save to Firebase
      try {
        const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');
        const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${roomId}/${billObject.billId}`);
        await window.firebaseSet(billsRef, billObject);

        generatedCount++;
        generatedBills.push(`${roomId}: ฿${total.toLocaleString()}`);
        console.log(`✅ Bill generated: ${fbBuildingId}/${roomId}/${billObject.billId}`);
      } catch (e) {
        console.error(`❌ Error saving bill for ${roomId}:`, e);
      }
    }

    // VERIFICATION #2: Check if all expected bills were generated
    const missingRooms = rooms.filter(r => !generatedBills.some(b => b.includes(r.id)));

    if (generatedCount === 0) {
      showToast(`ไม่มีบิลที่สร้างได้ (ตรวจสอบข้อมูลมิเตอร์)`, 'warning');
      return;
    }

    let message = `✅ สร้างบิลสำเร็จ ${generatedCount}/${actualRoomCount} ห้อง\n\n${generatedBills.join('\n')}`;

    if (generatedCount < actualRoomCount) {
      const missingRoomIds = missingRooms.map(r => r.id).join(', ');
      message += `\n\n⚠️ ไม่พบข้อมูลมิเตอร์สำหรับ: ${missingRoomIds}`;
    }

    if (generatedCount === actualRoomCount) {
      message = `✅ สร้างบิลครบทั้ง ${generatedCount} ห้องแล้ว!\n\n${generatedBills.join('\n')}`;
    }

    showToast(message, 'success');
    console.log(`📊 Auto-generated ${generatedCount}/${actualRoomCount} bills for ${MONTHS_FULL[month]} ${year + 543}`);
  } catch (error) {
    console.error('❌ Error in auto-generate bills:', error);
    showToast(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
  }
}

function renderPaymentStatus(){
  const el=document.getElementById('payStatusGrid');if(!el)return;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  // Phase 2b: PaymentStore unifies verifiedSlips (Firestore) + payment_status (legacy)
  const paid = (typeof PaymentStore !== 'undefined')
    ? PaymentStore.listForMonth(year, month)
    : (loadPS()[`${year}_${month}`] || {});
  // Map building names and get active rooms
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  const monthName=MONTHS_FULL[month]||month;
  const countPaid=Object.keys(paid).length;
  el.innerHTML=`<div style="font-size:.8rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">
    📋 สถานะการชำระ — ${monthName} ${year} &nbsp;
    <span style="color:var(--green)">✅ จ่ายแล้ว ${countPaid}</span> /
    <span style="color:var(--accent)">⏳ รอ ${rooms.length-countPaid}</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;">
  ${rooms.map(r=>{
    const p=paid[r.id];
    if(p){
      return`<span onclick="showPayDetail('${r.id}')" title="คลิกดูรายละเอียด / แก้ไข" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:700;background:#e8f5e9;color:var(--green-dark);border:1px solid #a5d6a7;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#c8e6c9'" onmouseout="this.style.background='#e8f5e9'">✅ ${r.id}</span>`;
    } else {
      return`<span onclick="selectRoomForBill('${r.id}')" title="คลิกเพื่อออกบิล" style="padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:600;background:#fff3e0;color:#e65100;border:1px solid #ffcc80;cursor:pointer;">⏳ ${r.id}</span>`;
    }
  }).join('')}
  </div>`;
}

function selectRoomForBill(roomId){
  // เปลี่ยนไปหน้า ออกบิล แล้วเลือกห้องนั้นเลย
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-bill').classList.add('active');
  document.querySelector('[onclick*="showPage(\'bill\'"]')?.classList.add('active');
  document.getElementById('f-room').value=roomId;
  onRoomChange();
  document.getElementById('f-room').scrollIntoView({behavior:'smooth'});
}

// ===== PAYMENT DETAIL MODAL =====
let payModalRoomId=null, payModalYear=null, payModalMonth=null;

function showPayDetail(roomId, year, month){
  const month2 = month ?? parseInt(document.getElementById('f-month')?.value||new Date().getMonth()+1);
  const year2  = year  ?? (document.getElementById('f-year')?.value||String(new Date().getFullYear()+543));
  payModalRoomId=roomId; payModalYear=String(year2); payModalMonth=month2;

  const ps=loadPS();
  const key=`${year2}_${month2}`;
  const p=ps[key]?.[roomId];
  const monthName=MONTHS_FULL[month2]||month2;

  document.getElementById('payModalTitle').textContent=`📋 ห้อง ${roomId} — ${monthName} ${year2}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');

  if(p){
    const paidDate=new Date(p.date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});
    const editedBadge=p.editedAt?`<span style="font-size:.73rem;color:var(--accent)"> · แก้ไขล่าสุด ${new Date(p.editedAt).toLocaleDateString('th-TH')}</span>`:'';
    body.innerHTML=`
      <div style="background:var(--green-pale);border-radius:8px;padding:.65rem .85rem;font-size:.82rem;line-height:1.7;">
        ✅ ชำระแล้ว · <strong>${p.receiptNo}</strong> · ${paidDate}${editedBadge}
        ${p.slip?`<br>💳 SlipOK: ${p.slip.sender||'—'} · ฿${(p.slip.amount||0).toLocaleString()}`:''}
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.4rem 0 2px;">✏️ แก้ไขมิเตอร์ (ถ้ากรอกผิด)</div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ ล่าสุด (eNew)</span><input class="pm-input" id="pm-eNew" type="number" value="${p.eNew??0}"></div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ เดิม (eOld)</span><input class="pm-input" id="pm-eOld" type="number" value="${p.eOld??0}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ ล่าสุด (wNew)</span><input class="pm-input" id="pm-wNew" type="number" value="${p.wNew??0}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ เดิม (wOld)</span><input class="pm-input" id="pm-wOld" type="number" value="${p.wOld??0}"></div>
      <div class="pm-row"><span class="pm-label">💰 ยอดรวม</span><strong style="color:var(--green-dark);font-size:.95rem;">฿${(p.amount||0).toLocaleString()}</strong></div>`;
    footer.innerHTML=`
      <button class="pm-btn green" onclick="savePayEdit()">💾 บันทึกมิเตอร์</button>
      <button class="pm-btn red" onclick="resetRoomPayment()">🔄 รีเซ็ตกลับ "ยังไม่จ่าย"</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  } else {
    body.innerHTML=`
      <div style="background:#fff3e0;border-radius:8px;padding:.75rem;font-size:.84rem;color:#e65100;margin-bottom:.5rem;">
        ⏳ ยังไม่ได้ชำระ — ${monthName} ${year2}
      </div>
      <div style="font-size:.86rem;color:var(--text-muted);text-align:center;padding:.9rem 0;">
        คลิก "ออกบิล" เพื่อเปิดฟอร์มออกใบวางบิลห้องนี้
      </div>`;
    footer.innerHTML=`
      <button class="pm-btn blue" onclick="closePayModal();goBillFromTable('${roomId}',${year2},${month2})">📄 ออกบิลห้อง ${roomId}</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  }
  document.getElementById('payModalOverlay').classList.add('show');
}

function closePayModal(){
  document.getElementById('payModalOverlay').classList.remove('show');
  payModalRoomId=null;
}

function savePayEdit(){
  if(!payModalRoomId)return;
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(!ps[key]?.[payModalRoomId]){closePayModal();return;}
  ps[key][payModalRoomId].eNew=parseFloat(document.getElementById('pm-eNew').value)||0;
  ps[key][payModalRoomId].eOld=parseFloat(document.getElementById('pm-eOld').value)||0;
  ps[key][payModalRoomId].wNew=parseFloat(document.getElementById('pm-wNew').value)||0;
  ps[key][payModalRoomId].wOld=parseFloat(document.getElementById('pm-wOld').value)||0;
  ps[key][payModalRoomId].editedAt=new Date().toISOString();
  savePS(ps);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
  // แสดง toast
  const t=document.createElement('div');
  t.textContent='✅ บันทึกมิเตอร์เรียบร้อย';
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2200);
}

function resetRoomPayment(){
  if(!payModalRoomId)return;
  if(!confirm(`ยืนยันรีเซ็ตห้อง ${payModalRoomId} กลับเป็น "ยังไม่ชำระ"?\n(ข้อมูลใบเสร็จจะถูกลบออก)`))return;
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(ps[key]){
    delete ps[key][payModalRoomId];
    if(Object.keys(ps[key]).length===0)delete ps[key];
  }
  savePS(ps);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
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


