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

window.switchDashboardTab = function(tabName, btn) {
  ['financial','tenants','operations','community'].forEach(t => {
    const el = document.getElementById('dash-cat-' + t);
    if (el) {
      el.classList.toggle('u-hidden', t !== tabName);
      if (el.style.display) el.style.display = '';
    }
  });
  document.querySelectorAll('[id^="dash-cat-btn-"]').forEach(b => b.classList.remove('active'));
  const canonical = document.getElementById('dash-cat-btn-' + tabName);
  if (canonical) canonical.classList.add('active');
  if (btn && btn !== canonical) btn.classList.add('active');
  // Lazy-init deep analytics on first tab show
  if (tabName === 'community'   && typeof initCommunityInsights   === 'function') initCommunityInsights();
  if (tabName === 'financial'   && typeof initFinancialInsights   === 'function') initFinancialInsights();
  if (tabName === 'tenants'     && typeof initTenantInsights      === 'function') initTenantInsights();
  if (tabName === 'operations'  && typeof initOperationsInsights  === 'function') initOperationsInsights();
  if (tabName === 'financial'  && typeof updatePaymentStatusWidget === 'function') updatePaymentStatusWidget();
  if (tabName === 'tenants'    && typeof updateTenantStatusWidget  === 'function') updateTenantStatusWidget();
  if (tabName === 'community'  && typeof updateGamificationWidget  === 'function') updateGamificationWidget();
  if (tabName === 'community'  && typeof updatePetAnalyticsWidget  === 'function') updatePetAnalyticsWidget();
  if (tabName === 'operations' && typeof updateComplaintsWidget    === 'function') updateComplaintsWidget();
  if (tabName === 'operations' && typeof updateMaintenanceWidget   === 'function') updateMaintenanceWidget();
};

window.switchDashboardProperty = function(property) {
  window.dashPropertyFilter = property || 'apartment';
};

window.switchTenantMainTab = function(tab, btn) {
  ['tenants','leases','requests','alerts'].forEach(t => {
    const el = document.getElementById('tenant-main-tab-' + t);
    if(el) {
      el.classList.toggle('u-hidden', !((t === tab)));
      // Static HTML ships non-default tabs with inline display:none, which
      // overrides the class toggle. Clear it so u-hidden controls visibility.
      if (el.style.display) el.style.display = '';
    }
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
    if(el) {
      el.classList.toggle('u-hidden', !((t === tab)));
      if (el.style.display) el.style.display = '';
    }
  });
  document.querySelectorAll('#bill-main-tab-btn-billing,#bill-main-tab-btn-verify').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(tab === 'verify' && typeof initPaymentVerify === 'function') initPaymentVerify();
};

// Meter Tab Switching Function
window._switchMeterTabImpl = function(tabName, btnElement) {
  // Hide all tabs (clear inline display so the class wins on next show — static
  // HTML ships several .meter-tab-content panels with inline display:none/block)
  document.querySelectorAll('.meter-tab-content').forEach(el => {
    el.classList.add('u-hidden');
    if (el.style.display) el.style.display = '';
  });

  // Remove active state from all buttons
  document.querySelectorAll('.meter-tab').forEach(btn => btn.classList.remove('active'));

  // Show selected tab
  const contentEl = document.getElementById('meter-' + tabName + '-content');
  const resolvedBtn = btnElement || document.getElementById('tab-' + tabName + '-btn');
  if (contentEl) {
    contentEl.classList.remove('u-hidden');
    if (contentEl.style.display) contentEl.style.display = '';
    if (resolvedBtn) resolvedBtn.classList.add('active');
  }

  // Initialize meter page content if needed
  if (tabName === 'room-config') {
    const dropdown = document.getElementById('roomConfigBuilding');
    if (dropdown && !dropdown.value) dropdown.value = 'rooms';
    setTimeout(() => loadRoomConfigUI(), 50);
  } else if (tabName === 'import-meter') {
    if (typeof initImportMeterTab === 'function') initImportMeterTab();
  } else if (tabName === 'import-billing') {
    if (typeof initImportBillingTab === 'function') initImportBillingTab();
  }
  // Note: 'nest' and 'rooms' branches removed — those tabs no longer exist
  // since the Property page consolidation. The dead initMeterNestTab/
  // initMeterRoomsTab calls were silently throwing ReferenceError on every
  // page-meter visit if anything dispatched those tab names.
};
// Assign to global scope
window.switchMeterTab = window._switchMeterTabImpl;

window.switchPropertyTab = function(tab, el) {
  // Hide all sections
  const roomsSection = document.getElementById('property-rooms-section');
  const nestSection = document.getElementById('property-nest-section');

  if (roomsSection) roomsSection.classList.add('u-hidden');
  if (nestSection) nestSection.classList.add('u-hidden');

  // Remove active state from all tabs
  document.querySelectorAll('.property-tab').forEach(btn => {
    // CSS .property-tab handles inactive state
  });

  // Show selected section and set active tab
  if (tab === 'rooms') {
    if (roomsSection) roomsSection.classList.remove('u-hidden');
    if (el) {
      // CSS .property-tab.active handles active state
    }
    // Initialize rooms page if needed
    if (typeof initRoomsPage === 'function') {
      initRoomsPage();
    }
  } else if (tab === 'nest') {
    if (nestSection) nestSection.classList.remove('u-hidden');
    if (el) {
      // CSS .property-tab.active handles active state
    }
    // Initialize nest page if needed
    if (typeof initNestPage === 'function') {
      initNestPage();
    }
  }
};

// Keep old function name for backward compatibility
window.switchBuildingTab = window.switchPropertyTab;

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

// Dashboard Tab Switching Function
function switchDashboardTab(tabName, btn) {
  // Hide all tabs
  document.querySelectorAll('.dashboard-tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active class and inline styles from all buttons
  document.querySelectorAll('.dashboard-tab').forEach(button => {
    button.classList.remove('active');
    // CSS .people-mgmt-tab handles inactive state
  });

  // Show selected tab
  const tabElement = document.getElementById('dashboard-' + tabName + '-tab');
  if(tabElement) {
    tabElement.classList.add('active');
  }

  // Add active class and styles to button
  if(btn) {
    btn.classList.add('active');
    // CSS .people-mgmt-tab.active handles active state
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
  // Hide all requests tabs (clear inline display so the class wins on next show)
  document.querySelectorAll('.requests-mgmt-content').forEach(tab => {
    tab.classList.add('u-hidden');
    if (tab.style.display) tab.style.display = '';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.requests-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Show selected tab
  const tabElement = document.getElementById('requests-tab-' + tabName);
  if(tabElement) {
    tabElement.classList.remove('u-hidden');
    if (tabElement.style.display) tabElement.style.display = '';
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

  // Escape user-controlled fields before innerHTML render
  const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[m]));
  // Verification helper: opens existing tenant modal for {building, room} so admin
  // can compare LINE display name + picture against the actual lease record.
  const viewTenantBtn = d => {
    if (!d.building || !d.room) return '';
    return ` · <a href="#" data-action="viewLiffTenantInfo" data-building="${esc(d.building)}" data-room="${esc(d.room)}" style="color:var(--blue);font-weight:600;text-decoration:none;">🔍 ดูข้อมูลห้อง ${esc(d.room)}</a>`;
  };

  list.innerHTML = docs.map(d => {
    const colors = { pending:'#f57c00', approved:'#2d8653', rejected:'#c62828' };
    const labels = { pending:'⏳ รออนุมัติ', approved:'✅ อนุมัติแล้ว', rejected:'❌ ปฏิเสธ' };
    const c = colors[d.status] || '#999';
    const when = d.requestedAt ? new Date(d.requestedAt).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const pic = d.linePictureUrl ? `<img src="${esc(d.linePictureUrl)}" style="width:42px;height:42px;border-radius:50%;flex-shrink:0;">` : '<div style="width:42px;height:42px;border-radius:50%;background:#eee;flex-shrink:0;"></div>';
    const buildingLabel = window.CONFIG?.getBuildingLabel?.(d.building) || (d.building === 'nest' ? '🏢 ตึก Nest' : '🏠 ห้องเช่า');
    const rejectionReasonHtml = (d.status === 'rejected' && d.rejectionReason)
      ? `<div style="font-size:.72rem;color:#c62828;margin-top:2px;">เหตุผล: ${esc(d.rejectionReason)}</div>` : '';
    const actions = d.status === 'pending' ? `
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button onclick="approveLiffLink('${esc(d.id)}')" style="padding:6px 14px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.8rem;">✅ อนุมัติ</button>
        <button onclick="rejectLiffLink('${esc(d.id)}')" style="padding:6px 14px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.8rem;">❌ ปฏิเสธ</button>
      </div>` : (d.status === 'approved'
        ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px;">โดย ${esc(d.approvedBy||'Admin')} · ${d.approvedAt?new Date(d.approvedAt).toLocaleDateString('th-TH'):''}</div>`
        : `<button onclick="approveLiffLink('${esc(d.id)}')" style="padding:4px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:6px;cursor:pointer;font-family:inherit;font-size:.75rem;margin-top:4px;">↩️ อนุมัติย้อนหลัง</button>`);
    return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      ${pic}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="font-weight:700;font-size:.92rem;">${esc(d.lineDisplayName||'—')}</div>
          <span style="color:${c};font-size:.78rem;font-weight:700;">${labels[d.status]||esc(d.status)}</span>
        </div>
        <div style="font-size:.82rem;color:var(--text);margin-top:2px;">
          ตึก: <strong>${esc(buildingLabel)}</strong> ·
          ห้อง <strong>${esc(d.room||'—')}</strong>
          ${viewTenantBtn(d)}
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">ขอเมื่อ ${when}</div>
        ${rejectionReasonHtml}
        ${actions}
      </div>
    </div>`;
  }).join('');
}

// Best-effort LINE push to tenant — never blocks the Firestore status update.
function _pushLiffStatusToTenant(lineUserId, status, reason) {
  fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/notifyLiffStatusChange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { lineUserId, status, reason } : { lineUserId, status })
  }).catch(e => console.warn('notifyLiffStatusChange (' + status + ') failed:', e.message));
}

// Open the existing tenant modal for the room being requested, so the admin
// can compare the LINE display name + picture against the actual lease record
// (name, phone, lease dates) and decide approval manually.
function viewLiffTenantInfo(building, roomId) {
  if (typeof openTenantModal !== 'function') {
    alert('Tenant modal not available — try opening from the Property/Tenant page');
    return;
  }
  openTenantModal(building, roomId);
}

// Returns true if a tenant record exists at tenants/{building}/list/{roomId}.
// Used by approveLiffLink to warn admin before linking a LIFF user to a room
// with no DB record (likely admin forgot to enter the lease).
async function _tenantRecordExists(building, roomId) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return null;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const fsBuilding = window.CONFIG?.getFirestoreBuilding?.(building) || building;
    const ref = fs.doc(db, 'tenants', fsBuilding, 'list', String(roomId));
    const snap = await fs.getDoc(ref);
    return snap.exists();
  } catch (e) {
    console.warn('_tenantRecordExists check failed:', e.message);
    return null;
  }
}

async function approveLiffLink(lineUserId){
  if(!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  // Look up the request to know which {building, room} we're approving
  let building, room;
  try {
    const reqSnap = await fs.getDoc(fs.doc(fs.collection(db, 'liffUsers'), lineUserId));
    const reqData = reqSnap.data() || {};
    building = reqData.building;
    room = reqData.room;
  } catch (e) { console.warn('Could not load liffUsers doc for approve check:', e.message); }
  // Warn (don't block) if no tenant record exists for this room
  if (building && room) {
    const exists = await _tenantRecordExists(building, room);
    if (exists === false) {
      const proceed = confirm(`⚠️ ยังไม่มีข้อมูลลูกบ้านในระบบสำหรับห้อง ${room} (ตึก ${building})\n\nควรเพิ่มข้อมูลลูกบ้านในแท็บ "ผู้เช่า" ก่อนอนุมัติ\n\nต้องการอนุมัติต่อหรือไม่?`);
      if (!proceed) return;
    }
  }
  const adminName = window.SecurityUtils?.getSecureSession()?.name || 'Admin';
  try {
    await fs.setDoc(fs.doc(fs.collection(db, 'liffUsers'), lineUserId), {
      status: 'approved', approvedBy: adminName, approvedAt: new Date().toISOString()
    }, { merge: true });
    _pushLiffStatusToTenant(lineUserId, 'approved');
  } catch(e) { alert('❌ ' + e.message); }
}

async function rejectLiffLink(lineUserId){
  const defaultReason = 'ข้อมูลไม่ตรงกับสัญญาเช่า กรุณาติดต่อเจ้าของ';
  const reason = prompt('เหตุผลในการปฏิเสธ (ส่งให้ลูกบ้านทาง LINE):', defaultReason);
  if (reason === null) return; // admin cancelled
  const finalReason = (reason && reason.trim()) || defaultReason;
  if(!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const adminName = window.SecurityUtils?.getSecureSession()?.name || 'Admin';
  try {
    await fs.setDoc(fs.doc(fs.collection(db, 'liffUsers'), lineUserId), {
      status: 'rejected',
      rejectedBy: adminName,
      rejectedAt: new Date().toISOString(),
      rejectionReason: finalReason
    }, { merge: true });
    _pushLiffStatusToTenant(lineUserId, 'rejected', finalReason);
  } catch(e) { alert('❌ ' + e.message); }
}

// ===== PEOPLE MANAGEMENT TAB SWITCHING =====
function switchPeopleTab(tabName, btn) {
  // Hide all people tabs (clear inline display so the class wins on next show)
  document.querySelectorAll('.people-mgmt-content').forEach(tab => {
    tab.classList.add('u-hidden');
    if (tab.style.display) tab.style.display = '';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.people-mgmt-tab').forEach(button => {
    button.classList.remove('active');
  });

  // Show selected tab
  const tabElement = document.getElementById('people-tab-' + tabName);
  if(tabElement) {
    tabElement.classList.remove('u-hidden');
    if (tabElement.style.display) tabElement.style.display = '';
  }

  // Highlight active button
  if(btn) {
    btn.classList.add('active');
  }

  // Lazy-load policies from Firestore when tab first opens
  if (tabName === 'policies' && typeof loadPoliciesAdmin === 'function') loadPoliciesAdmin();
  if (tabName === 'insights' && typeof initInsightsPage === 'function') initInsightsPage();
}

// ===== LEASE MANAGEMENT TAB SWITCHING =====
// ===== SIDEBAR FUNCTIONS =====
function toggleSidebar(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  const visible=sidebar.classList.toggle('visible');
  hamburger.classList.toggle('active');
  hamburger.setAttribute('aria-expanded', String(visible));
}

window._closeSidebarImpl = function(){
  const sidebar=document.getElementById('sidebar');
  const hamburger=document.getElementById('hamburger');
  sidebar.classList.remove('visible');
  hamburger.classList.remove('active');
  hamburger.setAttribute('aria-expanded', 'false');
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
  if (batchModal && !batchModal.classList.contains('u-hidden')) {
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
  // Wait for Firebase to be initialized (max 2 seconds, not 10)
  if (!window.firebaseReady) {
    console.log('⏳ Waiting for Firebase...');
    let waitCount = 0;
    while (!window.firebaseReady && waitCount < 20) {  // 20 × 100ms = 2s max (was 10s)
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }
    if (!window.firebaseReady) {
      console.warn('⚠️ Firebase not ready yet, will retry...');
      // Don't block — let initialization continue, retry in 1s
      setTimeout(() => {
        if (!window.firebaseReady) console.error('❌ Firebase initialization timeout');
      }, 2000);
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
  // KPI + charts are rendered by setYear('69') in dashboard-home-live.js DOMContentLoaded (600ms)
  // — do not add extra calls here; they cause the dashboard to re-render 4 times on load.

  // ===== URL DEEP LINK: ?page=requests-approvals&tab=liff =====
  const _dlParams = new URLSearchParams(window.location.search);
  const _dlPage = _dlParams.get('page');
  const _dlTab  = _dlParams.get('tab');
  if (_dlPage) {
    setTimeout(() => {
      showPage(_dlPage);
      if (_dlTab) {
        setTimeout(() => {
          if (_dlPage === 'requests-approvals') {
            const btn = document.getElementById(`tab-${_dlTab}-btn`);
            if (typeof switchRequestsTab === 'function') switchRequestsTab(_dlTab, btn);
          }
        }, 200);
      }
    }, 500);
  }

  // ===== CENTRALIZED EVENT DELEGATION HUB =====
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    // Overlay guard — only trigger if the overlay itself was clicked (not children)
    if (a === 'closePayModalIfOverlay') { if (e.target === el && typeof closePayModal === 'function') closePayModal(); return; }
    // Prevent default navigation for <a> elements carrying data-action
    if (el.tagName === 'A') e.preventDefault();
    const page = el.dataset.page;
    const tab = el.dataset.tab;
    const year = el.dataset.year;
    const building = el.dataset.building;
    const filter = el.dataset.filter;
    const fmt = el.dataset.fmt;
    const field = el.dataset.field;
    const v = el.dataset.value;

    // Navigation
    if (a === 'showPage') { window.showPage(page, el); return; }
    if (a === 'closeThenNavigate') { closeTenantModal(); window.showPage(page); return; }
    if (a === 'showPageTab') {
      // Close any open tenant modal + navigate to a page and auto-switch to a sub-tab.
      // Used by tenant modal's "→ Tab สัญญา" link to jump admin to the document hub.
      if (typeof closeTenantModal === 'function') closeTenantModal();
      window.showPage(page);
      setTimeout(() => {
        if (page === 'tenant' && typeof switchTenantMainTab === 'function') {
          const tabBtn = document.getElementById(`tenant-main-tab-btn-${tab}`);
          switchTenantMainTab(tab, tabBtn);
        }
      }, 80);
      return;
    }
    if (a === 'goToAuditLog') { window.location.href = '/audit-log-viewer'; return; }
    if (a === 'goToTaxFiling') { goToTaxFiling(v || 'dashboard'); return; }
    if (a === 'clickInput') { const t = document.getElementById(el.dataset.target); if(t) t.click(); return; }
    if (a === 'reload') { window.location.reload(); return; }
    if (a === 'navToOwnerTab') {
      window.showPage('people-management');
      setTimeout(() => document.querySelector('[data-action="switchPeopleTab"][data-tab="owner"]')?.click(), 50);
      return;
    }
    if (a === 'testFirebaseConnection') { typeof window.testFirebaseConnection === 'function' && window.testFirebaseConnection(); return; }
    if (a === 'syncDataToFirebase') { typeof window.syncDataToFirebase === 'function' && window.syncDataToFirebase(); return; }
    if (a === 'removeParent') { el.parentElement && el.parentElement.remove(); return; }

    // Sidebar / app chrome
    if (a === 'toggleSidebar') { toggleSidebar(); return; }
    if (a === 'handleLogout') { handleLogout(); return; }
    if (a === 'openChangePasswordModal') { openChangePasswordModal(); return; }
    if (a === 'toggleNotifPanel') { toggleNotifPanel(); return; }
    if (a === 'toggleFirebasePanel') { typeof toggleFirebasePanel === 'function' && toggleFirebasePanel(); return; }

    // Modals — open/close
    if (a === 'closeTenantModal') { closeTenantModal(); return; }
    if (a === 'closeChangePasswordModal') { closeChangePasswordModal(); return; }
    if (a === 'closeBatchRentAdjustmentModal') { closeBatchRentAdjustmentModal(); return; }
    if (a === 'closePhotoModal') { typeof closePhotoModal === 'function' && closePhotoModal(); return; }
    if (a === 'closePayModal') { typeof closePayModal === 'function' && closePayModal(); return; }
    if (a === 'closeEmergencyEdit') { typeof closeEmergencyEdit === 'function' && closeEmergencyEdit(); return; }
    if (a === 'closeRewardEdit') { typeof closeRewardEdit === 'function' && closeRewardEdit(); return; }
    if (a === 'openEmergencyEdit') { typeof openEmergencyEdit === 'function' && openEmergencyEdit(null); return; }
    if (a === 'openRewardEdit') { typeof openRewardEdit === 'function' && openRewardEdit(null); return; }

    // Tenant modal quick-links
    if (a === 'showTenantLease') { typeof showTenantLeaseHistory === 'function' && showTenantLeaseHistory(currentEditBuilding, currentEditRoomId); return; }

    // Dashboard tabs
    if (a === 'switchDashboardTab') { typeof switchDashboardTab === 'function' && switchDashboardTab(el.dataset.tab, el); return; }
    if (a === 'switchDashboardProperty') { typeof switchDashboardProperty === 'function' && switchDashboardProperty(el.dataset.property); return; }
    if (a === 'setYear') { setYear(year, el); return; }
    if (a === 'setBuilding') { setBuilding(building, el); return; }
    if (a === 'setTenantBuilding') { setTenantBuilding(building, el); return; }
    if (a === 'switchTenantMainTab') { switchTenantMainTab(tab, el); return; }
    if (a === 'switchMeterTab') { window.switchMeterTab(tab, el); return; }
    if (a === 'switchContentTab') { typeof switchContentTab === 'function' && switchContentTab(tab, el); return; }
    if (a === 'switchBillingMainTab') { typeof switchBillingMainTab === 'function' && switchBillingMainTab(tab, el); return; }
    if (a === 'switchPVTab') { typeof switchPVTab === 'function' && switchPVTab(tab, el); return; }
    if (a === 'switchPeopleTab') { typeof switchPeopleTab === 'function' && switchPeopleTab(tab, el); return; }
    if (a === 'runAwardDryRun') { typeof runAwardComplaintFreeMonthDryRun === 'function' && runAwardComplaintFreeMonthDryRun(); return; }
    if (a === 'grantAdminRole') { typeof grantAdminRole === 'function' && grantAdminRole(); return; }
    if (a === 'cleanupAnonUsers') { typeof cleanupAnonUsers === 'function' && cleanupAnonUsers(); return; }
    if (a === 'switchRequestsTab') { typeof switchRequestsTab === 'function' && switchRequestsTab(tab, el); return; }
    if (a === 'switchGamificationTab') { typeof switchGamificationTab === 'function' && switchGamificationTab(tab, el); return; }
    if (a === 'setAnnouncementBuilding') { typeof setAnnouncementBuilding === 'function' && setAnnouncementBuilding(building, el); return; }
    if (a === 'setLeaseRequestFilter') { typeof setLeaseRequestFilter === 'function' && setLeaseRequestFilter(filter, el); return; }
    if (a === 'setTenantFilter') { typeof setTenantFilter === 'function' && setTenantFilter(filter); return; }
    if (a === 'setPVFilter') { typeof setPVFilter === 'function' && setPVFilter(filter, el); return; }
    if (a === 'setPVMBuilding') { typeof setPVMBuilding === 'function' && setPVMBuilding(building, el); return; }

    // Toggles
    if (a === 'toggleAddProviderForm') { typeof toggleAddProviderForm === 'function' && toggleAddProviderForm(); return; }
    if (a === 'toggleAddEventForm') { typeof toggleAddEventForm === 'function' && toggleAddEventForm(); return; }
    if (a === 'toggleAddDocForm') { typeof toggleAddDocForm === 'function' && toggleAddDocForm(); return; }
    if (a === 'togglePasswordVisibility') { typeof togglePasswordVisibility === 'function' && togglePasswordVisibility(field); return; }

    // Wellness format
    if (a === 'wellnessFormat') { typeof wellnessFormat === 'function' && wellnessFormat(fmt); return; }

    // Save / action buttons
    if (a === 'saveTenantInfo') { saveTenantInfo(); return; }
    if (a === 'addNewRoom') { addNewRoom(); return; }
    if (a === 'selectAllRooms') { typeof selectAllRooms === 'function' && selectAllRooms(); return; }
    if (a === 'deselectAllRooms') { typeof deselectAllRooms === 'function' && deselectAllRooms(); return; }
    if (a === 'applyBatchRentAdjustment') { typeof applyBatchRentAdjustment === 'function' && applyBatchRentAdjustment(); return; }
    if (a === 'exportTenantCSV') { typeof exportTenantCSV === 'function' && exportTenantCSV(); return; }
    if (a === 'approveImportData') { typeof approveImportData === 'function' && approveImportData(); return; }
    if (a === 'cancelImportProcess') { typeof cancelImportProcess === 'function' && cancelImportProcess(); return; }
    if (a === 'approveBillingImportData') { typeof approveBillingImportData === 'function' && approveBillingImportData(); return; }
    if (a === 'cancelBillingImportProcess') { typeof cancelBillingImportProcess === 'function' && cancelBillingImportProcess(); return; }
    if (a === 'addExpense') { typeof addExpense === 'function' && addExpense(); return; }
    if (a === 'saveAnnouncement') { typeof saveAnnouncement === 'function' && saveAnnouncement(); return; }
    if (a === 'saveCommunityEvent') { typeof saveCommunityEvent === 'function' && saveCommunityEvent(); return; }
    if (a === 'saveCommunityDocument') { typeof saveCommunityDocument === 'function' && saveCommunityDocument(); return; }
    if (a === 'saveWellnessArticle') { typeof saveWellnessArticle === 'function' && saveWellnessArticle(); return; }
    if (a === 'resetWellnessForm') { typeof resetWellnessForm === 'function' && resetWellnessForm(); return; }
    if (a === 'seedWellnessStarters') { typeof seedWellnessStarters === 'function' && seedWellnessStarters(); return; }
    if (a === 'saveLeaseAlertSettings') { typeof saveLeaseAlertSettings === 'function' && saveLeaseAlertSettings(); return; }
    if (a === 'saveTrackingStart') { typeof saveTrackingStart === 'function' && saveTrackingStart(); return; }
    if (a === 'checkVacant') { typeof checkVacant === 'function' && checkVacant(); return; }
    if (a === 'saveEmergencyContact') { typeof saveEmergencyContact === 'function' && saveEmergencyContact(); return; }
    if (a === 'generateInvoice') { typeof generateInvoice === 'function' && generateInvoice(); return; }
    if (a === 'generateReceipt') { typeof generateReceipt === 'function' && generateReceipt(); return; }
    if (a === 'skipSlipVerify') { typeof skipSlipVerify === 'function' && skipSlipVerify(); return; }
    if (a === 'saveServiceProvider') { typeof saveServiceProvider === 'function' && saveServiceProvider(); return; }
    if (a === 'showAddMaintenanceModal') { typeof showAddMaintenanceModal === 'function' && showAddMaintenanceModal(); return; }
    if (a === 'showAddHousekeepingModal') { typeof showAddHousekeepingModal === 'function' && showAddHousekeepingModal(); return; }
    if (a === 'saveReward') { typeof saveReward === 'function' && saveReward(); return; }

    // Phase 4E Step 2 — page-people-management policy saves + page-requests-approvals housekeeping campaign + wellness form
    if (a === 'savePolicyDoc') { typeof savePolicyDoc === 'function' && savePolicyDoc(el.dataset.doc); return; }
    if (a === 'toggleCleaningCampaign') { typeof toggleCleaningCampaign === 'function' && toggleCleaningCampaign(); return; }
    if (a === 'toggleGamification') { typeof toggleGamification === 'function' && toggleGamification(); return; }
    if (a === 'clearWellnessCover') { typeof clearWellnessCover === 'function' && clearWellnessCover(); return; }
    if (a === 'viewLiffTenantInfo') {
      viewLiffTenantInfo(el.dataset.building, el.dataset.room);
      return;
    }
  });

  // ===== CHANGE / INPUT EVENT DELEGATION =====
  // For form controls (selects, radios, text inputs) that fire on change or input.
  // Same data-action attribute pattern as the click hub above.
  function _handleFormAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    // Tenant page modal
    if (a === 'updateAdjustmentDisplay') { typeof updateAdjustmentDisplay === 'function' && updateAdjustmentDisplay(); return; }
    if (a === 'togglePetTypeRow') {
      const row = document.getElementById('modalPetTypeRow');
      if (row) row.classList.toggle('u-hidden', !(el.checked));
      return;
    }
    // Requests page filters
    if (a === 'renderMaintenancePage') { typeof renderMaintenancePage === 'function' && renderMaintenancePage(); return; }
    if (a === 'renderHousekeepingList') { typeof renderHousekeepingList === 'function' && renderHousekeepingList(); return; }
    if (a === 'filterPetsByStatus') { typeof filterPetsByStatus === 'function' && filterPetsByStatus(el.value); return; }
    // Phase 4E Step 2 chunk 2: page-meter / page-expense / page-content / page-payment-verify
    if (a === 'loadRoomConfigUI') { typeof loadRoomConfigUI === 'function' && loadRoomConfigUI(); return; }
    if (a === 'toggleAddMode') { typeof toggleAddMode === 'function' && toggleAddMode(el.value); return; }
    if (a === 'updateDepositDisplay') { typeof updateDepositDisplay === 'function' && updateDepositDisplay(); return; }
    if (a === 'handleImportFile') { typeof handleImportFile === 'function' && handleImportFile(e); return; }
    if (a === 'handleBillingImportFile') { typeof handleBillingImportFile === 'function' && handleBillingImportFile(e); return; }
    if (a === 'renderExpensePage') { typeof renderExpensePage === 'function' && renderExpensePage(); return; }
    if (a === 'loadAndRenderCommunityEvents') { typeof loadAndRenderCommunityEvents === 'function' && loadAndRenderCommunityEvents(); return; }
    if (a === 'onWellnessCoverPicked') { typeof onWellnessCoverPicked === 'function' && onWellnessCoverPicked(e); return; }
    if (a === 'onWellnessImagesPicked') { typeof onWellnessImagesPicked === 'function' && onWellnessImagesPicked(e); return; }
    if (a === 'renderMeterTable') { typeof renderMeterTable === 'function' && renderMeterTable(); return; }
    if (a === 'loadPVHistoryRooms') { typeof loadPVHistoryRooms === 'function' && loadPVHistoryRooms(); return; }
    if (a === 'renderPVHistory') { typeof renderPVHistory === 'function' && renderPVHistory(); return; }
    // Phase 4E Step 2 chunk 3 — page-bill form (oninput on rent/elec/water/trash/other/latefee/nights/daily-rate, onchange on building/room/month/year/rent-type)
    if (a === 'calcBill') { typeof calcBill === 'function' && calcBill(); return; }
    if (a === 'onBuildingChange') { typeof onBuildingChange === 'function' && onBuildingChange(); return; }
    if (a === 'onRoomChange') { typeof onRoomChange === 'function' && onRoomChange(); return; }
    if (a === 'autoFillMeters') { typeof autoFillMeters === 'function' && autoFillMeters(); return; }
    if (a === 'onRentTypeChange') { typeof onRentTypeChange === 'function' && onRentTypeChange(); return; }
    if (a === 'verifySlipFromInput') { typeof verifySlip === 'function' && verifySlip(el.files && el.files[0]); return; }
  }
  document.addEventListener('change', _handleFormAction);
  document.addEventListener('input', _handleFormAction);

  // ===== SUBMIT EVENT DELEGATION =====
  // For <form> elements that previously used onsubmit="event.preventDefault();fn();".
  document.addEventListener('submit', function(e) {
    const el = e.target.closest('form[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'changePassword') { e.preventDefault(); typeof changePassword === 'function' && changePassword(); return; }
  });
});


