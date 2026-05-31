// shared/dashboard-tenant-lease.js
// Tenant + lease + document-hub admin dashboard sections.
// Extracted from shared/dashboard-extra.js on 2026-05-21 (Phase 2 S2).
// See tasks/todo.md for the full Phase 2 plan.
//
// Loaded BEFORE shared/dashboard-extra.js in dashboard.html so the function
// declarations below become window properties (function decl at top-level
// = global) before extra.js callers run at runtime.
//
// Anti-patterns enforced:
//  - §7-V: each onSnapshot subscription tears down a prior unsub before rebind
//  - §7-N: each onSnapshot has an error callback
//  - §7-CC: cross-script vars window._leaseRequestsUnsub + window._petsUnsub
//    are window-attached at the declaration site (S1 prereq complete)
//
// Cross-script identifiers this module READS (resolved via global lookup):
//  - TenantConfigManager, LeaseAgreementManager, RoomConfigManager, BuildingRegistry
//  - OwnerConfigManager (used inside _writeOwnerLogo — NOTE: that lives in extra.js)
//  - window.firebase, window.firebaseAuth, window.firebaseRef, etc.
//  - showToast, showPage (defined elsewhere)
//  - updateOccupancyDashboard, viewContract (stay in dashboard-extra.js)
//  - window.realtimeListeners (set in extra.js, S1 prereq)

// ===== Lease Expiry Alerts (server-emitted leaseNotifications/) =====
// Replaces the prior localStorage `tenant_data.contractEnd` compute with a
// Firestore subscription on the collection written by functions/remindLeaseExpiry.js
// when daysRemaining crosses 60 / 30 / 14 / 0 milestones. Server is the
// single source of truth; this client just renders from the cache populated
// by setupLeaseNotifsListener (called from dashboard-property.js init flows).
let _leaseNotifsCache = [];

// Tier metadata — colors match the LINE Flex + tenant_app bell.
const LEASE_TIER_META = [
  { key: 'expired', label: '⛔ หมดอายุแล้ว',          color: DashColors.RED_DARKEST },
  { key: '14',      label: '🚨 เหลือไม่ถึง 14 วัน',   color: DashColors.RED_DEEP },
  { key: '30',      label: '⚠️ ใกล้หมดอายุ (30 วัน)', color: DashColors.ORANGE_DEEP },
  { key: '60',      label: '📅 ใกล้หมดอายุ (60 วัน)', color: '#f57f17' }
];

const _LEASE_TIER_ORDER = { 'expired': 0, '14': 1, '30': 2, '60': 3 };

function getExpiringLeases(buildingType = null) {
  // Reads from the Firestore-backed cache populated by setupLeaseNotifsListener.
  // KPI count semantics preserved: original returned ≤30d only; we keep that
  // by excluding the 60d tier (early warning, shown in the alert card but
  // doesn't bump the "expiring soon" KPI count).
  const building = buildingType === 'nest' ? 'nest' : 'rooms';
  return _leaseNotifsCache
    .filter(d => d.building === building && d.status !== 'stale' && d.tier !== '60')
    .sort((a, b) => (_LEASE_TIER_ORDER[a.tier] ?? 99) - (_LEASE_TIER_ORDER[b.tier] ?? 99));
}

function _renderLeaseAlertCard(listEl, notifs) {
  if (!listEl) return;
  if (notifs.length === 0) { listEl.innerHTML = ''; return; }
  // Group by tier; render most-urgent group first.
  const byTier = {};
  for (const t of LEASE_TIER_META) byTier[t.key] = [];
  for (const n of notifs) { if (byTier[n.tier]) byTier[n.tier].push(n); }
  const esc = (typeof _esc === 'function') ? _esc : (s => String(s ?? '—'));
  listEl.innerHTML = LEASE_TIER_META
    .filter(t => byTier[t.key].length > 0)
    .map(t => {
      const items = byTier[t.key].map(n => {
        const endDateStr = (n.leaseEndDate && n.leaseEndDate.toDate)
          ? n.leaseEndDate.toDate().toLocaleDateString('th-TH')
          : '—';
        const readMark = n.status === 'read'
          ? `<span style="font-size:.7rem;color:${DashColors.TEXT_LIGHTER};margin-left:8px;">(อ่านแล้ว)</span>`
          : '<span style="font-size:.7rem;color:#dc3545;margin-left:8px;font-weight:bold;" title="ลูกบ้านยังไม่ได้อ่าน">●</span>';
        return `<div style="background:white;padding:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;border-left:3px solid ${t.color};margin-bottom:6px;">
            <div>
              <div style="font-weight:600;color:#333;">ห้อง ${esc(n.room)} — ${esc(n.tenantName)}${readMark}</div>
              <div style="font-size:.85rem;color:${DashColors.TEXT_MUTED};margin-top:4px;">หมดสัญญา ${endDateStr}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:700;color:${t.color};font-size:1.1rem;">${n.daysRemainingAtEmit != null ? n.daysRemainingAtEmit : '—'} วัน</div>
              <div style="font-size:.75rem;color:${DashColors.TEXT_LIGHTER};">เหลือเวลา</div>
            </div>
          </div>`;
      }).join('');
      return `<div style="margin-bottom:10px;">
          <div style="font-weight:700;color:${t.color};font-size:.92rem;margin-bottom:6px;">${t.label} (${byTier[t.key].length})</div>
          ${items}
        </div>`;
    }).join('');
}

function updateLeaseExpiryAlerts() {
  // Render all four tiers (including 60d) in the card; KPI count (getExpiringLeases)
  // excludes 60d for backwards compat.
  const allRooms = _leaseNotifsCache.filter(d => d.building === 'rooms' && d.status !== 'stale')
    .sort((a, b) => (_LEASE_TIER_ORDER[a.tier] ?? 99) - (_LEASE_TIER_ORDER[b.tier] ?? 99));
  const allNest  = _leaseNotifsCache.filter(d => d.building === 'nest'  && d.status !== 'stale')
    .sort((a, b) => (_LEASE_TIER_ORDER[a.tier] ?? 99) - (_LEASE_TIER_ORDER[b.tier] ?? 99));

  // §7-C: the containers have inline style="display:none" in dashboard.html
  // (lines ~3486 / ~3511) so `classList.remove('u-hidden')` doesn't override.
  // Must set `style.display` explicitly here for both branches.
  const oldAlertsDiv = document.getElementById('lease-expiry-alerts');
  const oldListDiv   = document.getElementById('lease-expiry-list');
  if (oldAlertsDiv) {
    if (allRooms.length > 0) {
      oldAlertsDiv.classList.remove('u-hidden');
      oldAlertsDiv.style.display = 'block';
      _renderLeaseAlertCard(oldListDiv, allRooms);
    } else {
      oldAlertsDiv.classList.add('u-hidden');
      oldAlertsDiv.style.display = 'none';
    }
  }

  const nestAlertsDiv = document.getElementById('nest-lease-expiry-alerts');
  const nestListDiv   = document.getElementById('nest-lease-expiry-list');
  if (nestAlertsDiv) {
    if (allNest.length > 0) {
      nestAlertsDiv.classList.remove('u-hidden');
      nestAlertsDiv.style.display = 'block';
      _renderLeaseAlertCard(nestListDiv, allNest);
    } else {
      nestAlertsDiv.classList.add('u-hidden');
      nestAlertsDiv.style.display = 'none';
    }
  }
}

// Firestore subscriber — single point of update for both buildings' cards
// + KPI counts. Wired from dashboard-property.js initRoomsPage / initNestPage.
function setupLeaseNotifsListener() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  if (!window.firebaseAuth?.currentUser) return;
  // §7-V: prior-unsub teardown before rebind.
  if (typeof realtimeListeners.leaseNotifs === 'function') {
    try { realtimeListeners.leaseNotifs(); } catch (_) {}
    realtimeListeners.leaseNotifs = null;
  }
  const db = window.firebase.firestore();
  const { collection, onSnapshot } = window.firebase.firestoreFunctions;
  try {
    realtimeListeners.leaseNotifs = onSnapshot(
      collection(db, 'leaseNotifications'),
      (snap) => {
        _leaseNotifsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateLeaseExpiryAlerts();
        if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
      },
      (err) => {
        // §7-N: surface errors. Permission-denied here = admin token missing
        // admin:true claim; failed-precondition = missing composite index.
        console.error('❌ leaseNotifs listener error:', err?.code, err?.message);
      }
    );
  } catch (err) {
    console.error('Error setting up leaseNotifs listener:', err);
  }
}


// ===== LEASE REQUESTS QUEUE (Firestore leaseRequests) =====
// §7-CC: _leaseRequestsUnsub window-attached so cleanupAdminListeners + future
// extracted dashboard-tenant-lease.js can read it cross-script.
window._leaseRequestsUnsub = null;
let _leaseRequestsCache = [];
let _leaseRequestsFilter = 'all';


function initLeaseRequestsPage() {
  if (window._leaseRequestsUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const colRef = fs.collection(db, 'leaseRequests');
  window._leaseRequestsUnsub = fs.onSnapshot(colRef, snap => {
    _leaseRequestsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderLeaseRequestsList();
    updateLeaseRequestsBadge();
  }, err => {
    console.warn('lease requests onSnapshot failed:', err);
    document.getElementById('leaseRequestsList').innerHTML = `<div style="text-align:center;padding:30px;color:${DashColors.RED_DEEP};">โหลดไม่สำเร็จ: ${_esc(err.message)}</div>`;
  });
}

function setLeaseRequestFilter(filter, btn) {
  _leaseRequestsFilter = filter;
  document.querySelectorAll('.lease-req-filter-btn').forEach(b => {
    b.classList.remove('active');
  });
  if (btn) { btn.classList.add('active'); }
  renderLeaseRequestsList();
}

function updateLeaseRequestsBadge() {
  const badge = document.getElementById('leaseRequestsBadge');
  if (!badge) return;
  const pending = _leaseRequestsCache.filter(r => r.status === 'pending').length;
  if (pending > 0) {
    badge.classList.add('u-iblock'); /*iblock*/;
    badge.textContent = pending;
  } else {
    badge.classList.add('u-hidden');
  }
}

function renderLeaseRequestsList() {
  const list = document.getElementById('leaseRequestsList');
  if (!list) return;
  let items = _leaseRequestsCache;
  if (_leaseRequestsFilter === 'pending') items = items.filter(r => r.status === 'pending');
  else if (_leaseRequestsFilter === 'done') items = items.filter(r => r.status !== 'pending');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">ไม่มีคำขอในหมวดนี้</div>';
    return;
  }
  items.forEach(r => {
    const card = document.createElement('div');
    const statusColor = r.status === 'pending' ? DashColors.ORANGE_DARK
                      : r.status === 'approved' ? DashColors.GREEN_MED
                      : r.status === 'rejected' ? DashColors.RED_DEEP : DashColors.TEXT_LIGHTER;
    const statusLabel = r.status === 'pending' ? '⏳ รอดำเนินการ'
                      : r.status === 'approved' ? '✅ อนุมัติแล้ว'
                      : r.status === 'rejected' ? '❌ ปฏิเสธ' : r.status;
    const typeLabel = r.type === 'renew' ? '✅ ขอต่อสัญญา' : (r.type === 'moveout' ? '❌ แจ้งย้ายออก' : r.type);
    const buildingLabel = r.building === 'rooms' ? 'ห้องแถว' : (r.building === 'nest' ? 'Nest' : r.building);
    const created = r.createdAt ? new Date(r.createdAt).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : '—';
    const detailsHtml = r.type === 'renew'
      ? `<div style="font-size:.88rem;line-height:1.7;"><div><strong>ระยะเวลา:</strong> ${_esc(r.duration === '1y' ? '1 ปี (มีส่วนลด)' : '6 เดือน')}</div>${r.note ? `<div><strong>หมายเหตุ:</strong> ${_esc(r.note)}</div>` : ''}</div>`
      : `<div style="font-size:.88rem;line-height:1.7;"><div><strong>วันย้ายออก:</strong> ${_esc(r.moveOutDate || '—')}</div><div><strong>บัญชีคืนมัดจำ:</strong> ${_esc(r.depositRefundBank || '—')}</div>${r.reason ? `<div><strong>เหตุผล:</strong> ${_esc(r.reason)}</div>` : ''}</div>`;
    card.className = 'card'; // u-hidden already handled
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.75rem;">
        <div>
          <div style="font-size:1.05rem;font-weight:700;">${_esc(typeLabel)} — ห้อง ${_esc(r.room)} (${_esc(buildingLabel)})</div>
          <div style="font-size:.85rem;color:var(--text-muted);margin-top:2px;">${_esc(r.tenantName || '(ไม่มีชื่อ)')} · ${_esc(r.phone || '')} · ส่งเมื่อ ${_esc(created)}</div>
        </div>
        <span style="background:${statusColor};color:white;padding:4px 12px;border-radius:12px;font-size:.78rem;font-weight:600;white-space:nowrap;">${_esc(statusLabel)}</span>
      </div>
      ${detailsHtml}
      ${r.adminNote ? `<div style="margin-top:.75rem;padding:.5rem;background:#fff8e1;border-radius:4px;font-size:.82rem;"><strong>บันทึกแอดมิน:</strong> ${_esc(r.adminNote)}</div>` : ''}
      ${r.status === 'pending' ? `
        <div style="margin-top:1rem;display:flex;gap:.5rem;">
          <button data-action="actLeaseRequest" data-id="${r.id}" data-arg="approve" style="flex:1;padding:8px;background:${DashColors.GREEN_MED};color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun;">✅ อนุมัติ</button>
          <button data-action="actLeaseRequest" data-id="${r.id}" data-arg="reject" style="flex:1;padding:8px;background:${DashColors.RED_DEEP};color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun;">❌ ปฏิเสธ</button>
        </div>
      ` : ''}
    `;
    list.appendChild(card);
  });
}

async function actLeaseRequest(id, action) {
  const note = (await window.ghPrompt(action === 'approve' ? 'หมายเหตุ (ถ้ามี) — เช่น เงื่อนไขสัญญาใหม่' : 'เหตุผลที่ปฏิเสธ:', '', { title: action === 'approve' ? '✅ อนุมัติคำขอ' : '❌ ปฏิเสธคำขอ' })) || '';
  if (action === 'reject' && !note.trim()) {
    showToast('กรุณาระบุเหตุผลที่ปฏิเสธ', 'warning');
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.updateDoc(fs.doc(db, 'leaseRequests', id), {
      status: action === 'approve' ? 'approved' : 'rejected',
      adminNote: note.trim(),
      processedAt: new Date().toISOString()
    });
    showToast(action === 'approve' ? '✅ อนุมัติคำขอแล้ว' : '❌ ปฏิเสธคำขอแล้ว', 'success');
  } catch (e) {
    console.error('actLeaseRequest failed:', e);
    showToast('ดำเนินการไม่สำเร็จ: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.initLeaseRequestsPage = initLeaseRequestsPage;
  window.setLeaseRequestFilter = setLeaseRequestFilter;
  window.actLeaseRequest = actLeaseRequest;
}

// ===== TENANT MASTER PAGE =====
function initTenantMasterPage() {
  renderTenantMasterPage();
}

function renderTenantMasterPage() {
  const container = document.getElementById('tenantMasterContainer');
  if (!container) return;

  const building = window.currentTenantMasterBuilding || 'rooms';
  const tenants = TenantConfigManager.getTenantList(building);

  container.innerHTML = `
    <div style="margin-top: 1.5rem;">
      <!-- Building Selector -->
      <div style="margin-bottom: 1.5rem;">
        <label class="dx-label">เลือกอาคาร</label>
        <select id="tenantMasterBuilding" data-action="setTenantMasterBuilding" style="padding: 0.7rem; border: 1px solid ${DashColors.BORDER}; border-radius: 4px;">
          <option value="rooms" ${(window.currentTenantMasterBuilding || 'rooms') === 'rooms' ? 'selected' : ''}>ห้องแถว (Rooms)</option>
          <option value="nest" ${(window.currentTenantMasterBuilding || 'rooms') === 'nest' ? 'selected' : ''}>Nest</option>
        </select>
      </div>

      <!-- Add Tenant Form -->
      <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid ${DashColors.BORDER}; margin-bottom: 2rem;">
        <div style="font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">➕ เพิ่มผู้เช่าใหม่</div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label class="dx-label">รหัสผู้เช่า *</label>
            <input type="text" id="newTenantId" placeholder="เช่น T001, T002" class="dx-field">
          </div>
          <div>
            <label class="dx-label">ชื่อ-นามสกุล *</label>
            <input type="text" id="newTenantName" placeholder="ชื่อผู้เช่า" class="dx-field">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label class="dx-label">เลขประจำตัวประชาชน/Passport</label>
            <input type="text" id="newTenantIdCard" placeholder="เลขประจำตัว" class="dx-field">
          </div>
          <div>
            <label class="dx-label">เบอร์โทรศัพท์</label>
            <input type="tel" id="newTenantPhone" placeholder="เบอร์โทรศัพท์" maxlength="10" class="dx-field">
            <small id="newTenantPhoneError" style="display:none;color:${DashColors.RED_TEXT};font-size:0.85rem;margin-top:4px;"></small>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label class="dx-label">อีเมล</label>
            <input type="email" id="newTenantEmail" placeholder="อีเมล" class="dx-field">
          </div>
          <div>
            <label class="dx-label">ที่อยู่</label>
            <input type="text" id="newTenantAddress" placeholder="ที่อยู่" class="dx-field">
          </div>
        </div>

        <button data-action="addNewTenant" style="padding: 0.8rem 1.5rem; background: ${DashColors.GREEN_ACTIVE}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
          ➕ เพิ่มผู้เช่า
        </button>
      </div>

      <!-- Tenant List -->
      <div style="font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">📋 รายชื่อผู้เช่า (${tenants.length} คน)</div>
      ${tenants.length === 0 ? `<div style="padding: 1.5rem; text-align: center; color: ${DashColors.TEXT_LIGHTER};">ยังไม่มีผู้เช่า</div>` : ''}
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: ${DashColors.SURFACE_GRAY};">
              <th class="dx-th-plain">รหัส</th>
              <th class="dx-th-plain">ชื่อ</th>
              <th class="dx-th-plain">เบอร์โทร</th>
              <th class="dx-th-plain">อีเมล</th>
              <th style="border: 1px solid ${DashColors.BORDER}; padding: 0.8rem; text-align: center;">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            ${tenants.map(tenant => `
              <tr style="border-bottom: 1px solid ${DashColors.BORDER};">
                <td class="dx-td-plain">${tenant.id}</td>
                <td class="dx-td-plain">${tenant.name}</td>
                <td class="dx-td-plain">${tenant.phone || '-'}</td>
                <td class="dx-td-plain">${tenant.email || '-'}</td>
                <td style="border: 1px solid ${DashColors.BORDER}; padding: 0.8rem; text-align: center;">
                  <button data-action="editTenant" data-id="${tenant.id}" style="padding: 0.4rem 0.8rem; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 0.5rem;">📝</button>
                  <button data-action="deleteTenant" data-id="${tenant.id}" style="padding: 0.4rem 0.8rem; background: ${DashColors.RED_MED}; color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function addNewTenant() {
  const building = window.currentTenantMasterBuilding || 'rooms';
  const id = document.getElementById('newTenantId').value.trim();
  const name = document.getElementById('newTenantName').value.trim();

  if (!id || !name) {
    showToast('กรุณากรอกรหัสและชื่อผู้เช่า', 'warning');
    return;
  }

  const tenantData = {
    id: id,
    name: name,
    idCardNumber: document.getElementById('newTenantIdCard').value.trim(),
    phone: document.getElementById('newTenantPhone').value.trim(),
    email: document.getElementById('newTenantEmail').value.trim(),
    address: document.getElementById('newTenantAddress').value.trim()
  };

  // Use Firebase-enabled save if available
  const saveSuccess = typeof TenantConfigManager.saveTenantToFirebase === 'function'
    ? (TenantConfigManager.saveTenantToFirebase(building, id, tenantData), TenantConfigManager.getTenant(building, id) !== null)
    : TenantConfigManager.addTenant(building, id, tenantData);

  if (saveSuccess) {
    showToast(`เพิ่มผู้เช่า ${name} สำเร็จ`, 'success');
    // Clear inputs
    document.getElementById('newTenantId').value = '';
    document.getElementById('newTenantName').value = '';
    document.getElementById('newTenantIdCard').value = '';
    document.getElementById('newTenantPhone').value = '';
    document.getElementById('newTenantEmail').value = '';
    document.getElementById('newTenantAddress').value = '';
    renderTenantMasterPage();
  } else {
    showToast(`ผู้เช่า ${id} มีอยู่แล้ว`, 'warning');
  }
}


function editTenant(tenantId) {
  const building = window.currentTenantMasterBuilding || 'rooms';
  const tenant = TenantConfigManager.getTenant(building, tenantId);
  if (!tenant) { showToast('ไม่พบข้อมูลผู้เช่า', 'warning'); return; }

  // Remove any existing edit modal
  const existing = document.getElementById('editTenantModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'editTenantModal';
  modal.className = 'u-modal-overlay';

  // Use DOM manipulation (not innerHTML) for fields that take user-controlled data
  // to avoid XSS from tenant name/phone/etc.
  const box = document.createElement('div');
  box.className = 'u-modal-panel u-modal-panel-sm';

  const title = document.createElement('div');
  title.className = 'u-modal-title';
  title.textContent = `✏️ แก้ไขข้อมูลผู้เช่า — ${tenant.id}`;
  box.appendChild(title);

  const fields = [
    { id: 'etName',    label: 'ชื่อ-นามสกุล *', val: tenant.name || '',   type: 'text' },
    { id: 'etIdCard',  label: 'เลขประจำตัว',      val: tenant.idCard || '', type: 'text' },
    { id: 'etPhone',   label: 'เบอร์โทรศัพท์',    val: tenant.phone || '',  type: 'tel'  },
    { id: 'etEmail',   label: 'อีเมล',             val: tenant.email || '',  type: 'email'},
    { id: 'etAddress', label: 'ที่อยู่',            val: tenant.address || '',type: 'text' }
  ];
  const grid = document.createElement('div');
  grid.className = 'u-grid-1';
  fields.forEach(f => {
    const wrap = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.className = 'u-form-label';
    lbl.textContent = f.label;
    const inp = document.createElement('input');
    inp.id = f.id; inp.type = f.type; inp.value = f.val;
    if (f.id === 'etPhone') inp.maxLength = 10;
    inp.className = 'u-form-input';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    grid.appendChild(wrap);
  });
  box.appendChild(grid);

  const btnRow = document.createElement('div');
  btnRow.className = 'u-btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'ยกเลิก';
  cancelBtn.className = 'u-btn-cancel';
  cancelBtn.onclick = () => modal.remove();
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 บันทึก';
  saveBtn.className = 'u-btn-primary';
  saveBtn.onclick = () => saveEditTenant(building, tenantId);
  btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
  box.appendChild(btnRow);

  modal.appendChild(box);
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById('etName')?.focus();
}

function saveEditTenant(building, tenantId) {
  const name = document.getElementById('etName')?.value.trim();
  if (!name) { showToast('กรุณากรอกชื่อ-นามสกุล', 'warning'); return; }

  const updates = {
    name,
    idCard: document.getElementById('etIdCard')?.value.trim() || '',
    phone: document.getElementById('etPhone')?.value.trim() || '',
    email: document.getElementById('etEmail')?.value.trim() || '',
    address: document.getElementById('etAddress')?.value.trim() || '',
    updatedDate: new Date().toISOString()
  };

  const ok = TenantConfigManager.updateTenant(building, tenantId, updates);
  if (ok) {
    if (typeof TenantConfigManager.saveTenantToFirebase === 'function') {
      TenantConfigManager.saveTenantToFirebase(building, tenantId, updates);
    }
    document.getElementById('editTenantModal')?.remove();
    renderTenantMasterPage();
    showToast('อัพเดทข้อมูลผู้เช่าเรียบร้อย', 'success');
  } else {
    showToast('ไม่สามารถบันทึกข้อมูลได้', 'error');
  }
}

// ===== LEASE AGREEMENTS PAGE =====
function initLeaseAgreementsPage() {
  renderLeaseAgreementsPage();
}

function renderLeaseAgreementsPage() {
  const container = document.getElementById('leaseAgreementsContainer');
  if (!container) return;

  // Dedupe: legacy migrations + parallel writers can leave 2+ lease records for
  // the same (building, room, moveInDate). Keep one per natural key — prefer
  // canonical id (NOT prefixed with "LEGACY_"), then highest rentAmount,
  // then newest createdAt. Hidden ones still exist in storage; admin can
  // delete them via cleanup script if desired.
  const _allLeases = LeaseAgreementManager.getAllLeasesList();
  const _leaseGroups = {};
  _allLeases.forEach(l => {
    const k = `${l.building}|${l.roomId}|${l.moveInDate || ''}|${l.tenantId || l.tenantName || ''}`;
    if (!_leaseGroups[k]) _leaseGroups[k] = [];
    _leaseGroups[k].push(l);
  });
  const _pickCanonical = arr => {
    if (arr.length === 1) return arr[0];
    return [...arr].sort((a, b) => {
      const aLegacy = String(a.id || '').startsWith('LEGACY_') ? 1 : 0;
      const bLegacy = String(b.id || '').startsWith('LEGACY_') ? 1 : 0;
      if (aLegacy !== bLegacy) return aLegacy - bLegacy; // non-legacy first
      const ar = Number(a.rentAmount || 0);
      const br = Number(b.rentAmount || 0);
      if (ar !== br) return br - ar; // higher rent first
      return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); // newer first
    })[0];
  };
  const leases = Object.values(_leaseGroups).map(_pickCanonical);
  const _hiddenDupCount = _allLeases.length - leases.length;

  // Aggregate tenants from all registered buildings (SSoT: Tab ผู้เช่า)
  // We tag each tenant with its building so the info card can show it without re-asking.
  const allTenants = [];
  ((window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest']).forEach(b => {
    const list = (typeof TenantConfigManager !== 'undefined')
      ? TenantConfigManager.getTenantList(b) || []
      : [];
    list.forEach(t => {
      // Find the tenantId key (saveTenantInfo stores by generated id, not by name)
      const raw = TenantConfigManager.getAllTenants(b);
      const id = Object.keys(raw).find(k => raw[k] === t) || t.id;
      allTenants.push({ ...t, id, building: b });
    });
  });

  // t.roomId is the canonical room key from TenantConfigManager (reference equality to find t.id
  // was always broken — t.id is undefined). Filter to occupied rooms via getActiveLease.
  const tenantOptions = allTenants
    .filter(t => t.roomId && LeaseAgreementManager.getActiveLease(t.building, t.roomId) !== null)
    .map(t => {
      const buildingLabel = t.building === 'rooms' ? 'ห้องแถว' : 'Nest';
      return `<option value="${t.roomId}">${_escapeHTML(t.name || `ห้อง ${t.roomId}`)} — ห้อง ${t.roomId} (${buildingLabel})</option>`;
    }).join('');

  container.innerHTML = `
    <div style="margin-top: 1.5rem;">
      <!-- Add Lease Form — SSoT: tenant data from Tab ผู้เช่า, rent from Tab จัดการห้อง -->
      <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid ${DashColors.BORDER}; margin-bottom: 2rem;">
        <div style="font-weight: 600; margin-bottom: 0.3rem; font-size: 1.1rem;">📎 แนบเอกสารสัญญา</div>
        <div style="font-size: 0.82rem; color: ${DashColors.TEXT_MUTED}; margin-bottom: 1rem;">
          ข้อมูลลูกบ้านและค่าเช่าดึงจาก SSoT อัตโนมัติ — ต้องแก้ที่ต้นทาง:
          <a href="#" data-action="showPage" data-page="tenant" style="color: ${DashColors.GREEN_DARK}; font-weight: 600; text-decoration: underline;">Tab ผู้เช่า</a> ·
          <a href="#" data-action="showPage" data-page="meter" style="color: ${DashColors.GREEN_DARK}; font-weight: 600; text-decoration: underline;">Tab จัดการห้อง</a>
        </div>

        <div style="margin-bottom: 1rem;">
          <label class="dx-label">เลือกผู้เช่า *</label>
          <select id="leaseTenant" data-action="updateLeasePreview" class="dx-field">
            <option value="">-- เลือกผู้เช่า --</option>
            ${tenantOptions}
          </select>
        </div>

        <!-- Auto-filled info card (populated by _updateLeasePreview on change) -->
        <div id="leasePreviewCard" style="display: none; padding: 12px 14px; background: ${DashColors.GREEN_BG}; border-left: 3px solid ${DashColors.GREEN_ACTIVE}; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; line-height: 1.6;"></div>

        <!-- FILE UPLOADS SECTION -->
        <div style="background: #f0f9ff; padding: 1rem; border-radius: 6px; border: 1px solid #b3e5fc; margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.8rem; color: #01579b;">📄 เอกสารสัญญาเช่า (optional)</div>
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">📋 ไฟล์สัญญาเช่า</label>
            <input type="file" id="leaseFileAgreement" accept=".pdf,.jpg,.png" class="dx-field-upload">
          </div>
          <small style="color: ${DashColors.TEXT_MUTED}; margin-top: 0.5rem; display: block;">📁 สนับสนุน: PDF, JPG, PNG · ขนาดสูงสุด: 5MB</small>
        </div>

        <button data-action="createNewLease" style="padding: 0.8rem 1.5rem; background: ${DashColors.GREEN_ACTIVE}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
          💾 บันทึกสัญญา & แนบเอกสาร
        </button>
      </div>

      <!-- Lease List -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem; flex-wrap:wrap; gap:8px;">
        <div style="font-weight: 600; font-size: 1.1rem;">📋 สัญญาเช่าทั้งหมด (${leases.length})</div>
        ${_hiddenDupCount > 0 ? `<div style="font-size:.78rem; color:${DashColors.ORANGE_DEEP}; background:${DashColors.ORANGE_BG}; padding:4px 10px; border-radius:6px; border:1px solid #ffb74d;">🔁 ซ่อน ${_hiddenDupCount} รายการซ้ำ (legacy/duplicate)</div>` : ''}
      </div>
      ${leases.length === 0 ? `<div style="padding: 1.5rem; text-align: center; color: ${DashColors.TEXT_LIGHTER};">ยังไม่มีสัญญาเช่า</div>` : ''}
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: ${DashColors.SURFACE_GRAY};">
              <th class="dx-th-plain">อาคาร</th>
              <th class="dx-th-plain">ห้อง</th>
              <th class="dx-th-plain">ผู้เช่า</th>
              <th class="dx-th-plain">วันเข้า</th>
              <th class="dx-th-plain">ค่าเช่า</th>
              <th class="dx-th-plain">สถานะ</th>
              <th style="border: 1px solid ${DashColors.BORDER}; padding: 0.8rem; text-align: center;">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            ${leases.map(lease => `
              <tr style="border-bottom: 1px solid ${DashColors.BORDER};">
                <td class="dx-td-plain">${lease.building === 'rooms' ? 'ห้องแถว' : 'Nest'}</td>
                <td class="dx-td-plain">${lease.roomId}</td>
                <td class="dx-td-plain">${lease.tenantName || lease.tenantId}</td>
                <td class="dx-td-plain">${new Date(lease.moveInDate).toLocaleDateString('th-TH')}</td>
                <td style="border: 1px solid ${DashColors.BORDER}; padding: 0.8rem; text-align: right;">${(() => {
                  // Live rent from RoomConfigManager (current source of truth). Falls back to frozen lease.rentAmount.
                  const live = (typeof RoomConfigManager !== 'undefined')
                    ? (RoomConfigManager.getRentPrice(lease.building, lease.roomId) || 0) : 0;
                  const v = live || lease.rentAmount || 0;
                  return v ? '฿' + v.toLocaleString() : '-';
                })()}</td>
                <td class="dx-td-plain">
                  <span style="padding: 0.3rem 0.8rem; border-radius: 4px; background: ${lease.status === 'active' ? DashColors.GREEN_BORDER : '#f5f5f5'}; color: ${lease.status === 'active' ? DashColors.GREEN_DARK : DashColors.TEXT_LIGHTER}; font-weight: 600;">
                    ${lease.status === 'active' ? '✅ กำลังเช่า' : '❌ เลิกเช่า'}
                  </span>
                </td>
                <td style="border: 1px solid ${DashColors.BORDER}; padding: 0.8rem; text-align: center; white-space: nowrap;">
                  <button data-action="viewLeaseDocuments" data-id="${lease.id}" style="padding: 0.4rem 0.8rem; background: ${DashColors.BLUE_MED}; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;" title="ดูเอกสาร">📁</button>
                  ${lease.status === 'active' ? `<button data-action="endLease" data-id="${lease.id}" style="padding: 0.4rem 0.8rem; background: ${DashColors.ORANGE_MED}; color: white; border: none; border-radius: 4px; cursor: pointer;" title="สิ้นสุดสัญญา">🚪</button>` : ''}
                  <button data-action="deleteLease" data-id="${lease.id}" style="padding: 0.4rem 0.8rem; background: ${DashColors.RED_MED}; color: white; border: none; border-radius: 4px; cursor: pointer;" title="ลบ">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// SSoT-aware lease creation:
// - tenant data (name, moveIn, deposit) comes from Tab ผู้เช่า
// - rent comes from Tab จัดการห้อง (room config)
// - this form only accepts tenant selection + file uploads
function createNewLease() {
  const tenantId = document.getElementById('leaseTenant').value;
  if (!tenantId) {
    showToast('กรุณาเลือกผู้เช่า', 'warning');
    return;
  }

  // Find tenant + building across all buildings
  const tenantInfo = _findTenantWithBuilding(tenantId);
  if (!tenantInfo) {
    showToast('ไม่พบข้อมูลผู้เช่าใน Tab ผู้เช่า — กรุณาสร้างผู้เช่าก่อน', 'error');
    return;
  }
  const { tenant, building } = tenantInfo;

  // tenantId here is the roomId (select value = t.roomId). Use getActiveLease(building, roomId)
  // which checks SSoT first — consistent with the filter used to build the dropdown.
  const roomId = tenantId;
  const activeLease = LeaseAgreementManager.getActiveLease(building, roomId);
  if (!roomId) {
    showToast('ผู้เช่านี้ยังไม่มีห้อง กรุณาแก้ไขผ่าน Tab ผู้เช่าก่อน', 'error');
    return;
  }

  const rentAmount = (typeof RoomConfigManager !== 'undefined')
    ? (RoomConfigManager.getRentPrice(building, roomId) || 0)
    : 0;
  const moveInDate = tenant.moveInDate ? new Date(tenant.moveInDate).toISOString() : new Date().toISOString();
  const deposit = Number(tenant.deposit) || 0;

  // Collect uploaded files
  const documentsToUpload = {};
  const agreementFile = document.getElementById('leaseFileAgreement')?.files[0];
  if (agreementFile) documentsToUpload.agreement = agreementFile;

  let leaseId = activeLease?.id;

  if (activeLease) {
    // Reuse the existing active lease (tenant already has one from saveTenantInfo)
    const leaseUpdates = {
      tenantName: tenant.name,
      moveInDate,
      rentAmount,
      deposit,
      documents: Array.from(new Set([...(activeLease.documents || []), ...Object.keys(documentsToUpload)]))
    };
    if (typeof LeaseAgreementManager.updateLeaseWithFirebase === 'function') {
      LeaseAgreementManager.updateLeaseWithFirebase(leaseId, building, leaseUpdates);
    } else {
      LeaseAgreementManager.updateLease(leaseId, leaseUpdates);
    }
  } else {
    // Historical record — create a new lease entirely from SSoT
    const leaseData = {
      building,
      roomId,
      tenantId,
      tenantName: tenant.name,
      moveInDate,
      moveOutDate: null,
      rentAmount,
      deposit,
      status: 'active',
      documents: Object.keys(documentsToUpload)
    };
    leaseId = typeof LeaseAgreementManager.createLeaseWithFirebase === 'function'
      ? LeaseAgreementManager.createLeaseWithFirebase(leaseData)
      : LeaseAgreementManager.createLease(leaseData);
  }

  if (leaseId) {
    if (Object.keys(documentsToUpload).length > 0 && window.firebase && window.firebase.storage) {
      uploadLeaseDocuments(leaseId, building, roomId, documentsToUpload);
      showToast(`บันทึกสัญญาสำเร็จ กำลังอัพโหลดเอกสาร...`, 'success');
    } else {
      showToast(`บันทึกสัญญาสำเร็จ`, 'success');
    }

    // Clear form
    document.getElementById('leaseTenant').value = '';
    const preview = document.getElementById('leasePreviewCard');
    if (preview) preview.classList.add('u-hidden');
    const leaseAgreementEl = document.getElementById('leaseFileAgreement');
    if (leaseAgreementEl) leaseAgreementEl.value = '';

    renderLeaseAgreementsPage();
  }
}

// Find a tenant record across all registered buildings, return with building tag
function _findTenantWithBuilding(tenantId) {
  if (typeof TenantConfigManager === 'undefined') return null;
  for (const b of (window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest']) {
    const raw = TenantConfigManager.getAllTenants(b);
    if (raw[tenantId]) return { tenant: raw[tenantId], building: b };
  }
  return null;
}

// Populate the read-only info card below the tenant select
function _updateLeasePreview() {
  const tenantId = document.getElementById('leaseTenant')?.value;
  const card = document.getElementById('leasePreviewCard');
  if (!card) return;
  if (!tenantId) { card.classList.add('u-hidden'); card.innerHTML = ''; return; }

  const info = _findTenantWithBuilding(tenantId);
  if (!info) { card.classList.add('u-hidden'); return; }
  const { tenant, building } = info;

  const activeLease = LeaseAgreementManager.getLeasesByTenant(tenantId).find(l => l.status === 'active');
  const roomId = activeLease?.roomId;
  const rent = roomId && typeof RoomConfigManager !== 'undefined'
    ? RoomConfigManager.getRentPrice(building, roomId) || 0
    : 0;
  const buildingLabel = building === 'rooms' ? 'ห้องแถว' : 'Nest';
  const moveIn = tenant.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH') : '—';
  const deposit = Number(tenant.deposit) || 0;

  const existingDoc = activeLease?.documentURLs?.agreement;
  const existingFileName = existingDoc?.fileName || activeLease?.contractFileName || null;

  card.classList.remove('u-hidden');
  card.innerHTML = `
    <div style="font-weight: 700; color: ${DashColors.GREEN_DEEP}; margin-bottom: 6px;">📋 ข้อมูลจาก SSoT (read-only)</div>
    <div>🏠 <b>${buildingLabel} ${roomId ? 'ห้อง ' + _escapeHTML(roomId) : '(ยังไม่ผูกห้อง)'}</b></div>
    <div>👤 ${_escapeHTML(tenant.name || '-')} ${tenant.phone ? '· 📱 ' + _escapeHTML(tenant.phone) : ''}</div>
    <div>📅 วันเข้าเช่า: ${_escapeHTML(moveIn)} <span style="color:${DashColors.TEXT_MUTED};font-size:.78rem;">(จาก Tab ผู้เช่า)</span></div>
    <div>💰 ค่าเช่า: ฿${rent.toLocaleString()}/เดือน <span style="color:${DashColors.TEXT_MUTED};font-size:.78rem;">(จาก Tab จัดการห้อง)</span></div>
    <div>💵 มัดจำ: ฿${deposit.toLocaleString()} <span style="color:${DashColors.TEXT_MUTED};font-size:.78rem;">(จาก Tab ผู้เช่า)</span></div>
    ${existingFileName ? `<div style="margin-top:8px; padding:6px 10px; background:${DashColors.ORANGE_BG}; border-left:3px solid ${DashColors.ORANGE_DARK}; border-radius:4px; font-size:.85rem;">📎 เอกสารปัจจุบัน: <b>${_escapeHTML(existingFileName)}</b> — อัพโหลดใหม่เพื่อเปลี่ยน</div>` : ''}
    ${!roomId ? `<div style="color:${DashColors.RED_DEEP};margin-top:6px;">⚠️ ต้องกำหนดห้องใน Tab ผู้เช่าก่อนบันทึกสัญญา</div>` : ''}
  `;
}

if (typeof window !== 'undefined') {
  window._updateLeasePreview = _updateLeasePreview;
}

// Storage cost control — enforced client-side before upload
const LEASE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;     // 5MB hard cap per file
const LEASE_COMPRESS_THRESHOLD = 2 * 1024 * 1024;   // Images above this get resized
const LEASE_MAX_IMAGE_PX = 1600;                    // Max long-edge for images

// Perf #2: shared compressor — now parameterized + exposed on window so other
// upload flows (SlipOK verification, future maintenance photos) can reuse it.
// opts: { threshold, maxPx, quality }
function _compressImageIfLarge(file, opts) {
  const threshold = opts?.threshold ?? LEASE_COMPRESS_THRESHOLD;
  const maxPx = opts?.maxPx ?? LEASE_MAX_IMAGE_PX;
  const quality = opts?.quality ?? 0.85;

  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith('image/') || file.size <= threshold) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        const ratio = longest > maxPx ? maxPx / longest : 1;
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name.replace(/\.(png|bmp|webp)$/i, '.jpg'), { type: 'image/jpeg' }));
          } else {
            resolve(file);
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

if (typeof window !== 'undefined') {
  window._compressImageIfLarge = _compressImageIfLarge;
}

async function uploadLeaseDocuments(leaseId, building, roomId, documents) {
  try {
    const storage = window.firebase.storage();
    const { ref: sRef, uploadBytes: sUploadBytes, getDownloadURL: sGetDownloadURL } = window.firebase.storageFunctions;
    const fileTypeMap = {
      petCert: 'pet-vaccine-certificate',
      tenantContact: 'tenant-contact',
      agreement: 'lease-agreement',
      id: 'tenant-id',
      income: 'proof-of-income'
    };

    const entries = Object.entries(documents).filter(([, f]) => !!f);
    const totalFiles = entries.length;
    let uploadCount = 0;

    for (const [docType, originalFile] of entries) {
      // Hard size cap — reject before upload to protect Storage quota
      if (originalFile.size > LEASE_UPLOAD_MAX_BYTES) {
        const mb = (originalFile.size / 1024 / 1024).toFixed(1);
        console.warn(`⚠️ Skipped ${docType}: ${mb}MB exceeds ${LEASE_UPLOAD_MAX_BYTES / 1024 / 1024}MB limit`);
        if (typeof showToast === 'function') {
          showToast(`เอกสาร ${docType} ${mb}MB ใหญ่เกินไป (สูงสุด 5MB) กรุณาย่อไฟล์ก่อน`, 'warning');
        }
        continue;
      }

      // Compress images above 2MB, keep PDFs/small files as-is
      const file = await _compressImageIfLarge(originalFile);
      if (file !== originalFile) {
        const savedMB = ((originalFile.size - file.size) / 1024 / 1024).toFixed(2);
        console.info(`🗜️ Compressed ${docType}: saved ${savedMB}MB`);
      }

      const ext = file.name.split('.').pop();
      const fileName = `${fileTypeMap[docType]}-${Date.now()}.${ext}`;
      const storagePath = `leases/${building}/${roomId}/${leaseId}/${fileName}`;
      const fileRef = sRef(storage, storagePath);

      sUploadBytes(fileRef, file)
        .then((snapshot) => {
          uploadCount++;
          console.info(`✅ Document uploaded: ${docType} (${uploadCount}/${totalFiles})`);
          return sGetDownloadURL(snapshot.ref);
        })
        .then((downloadURL) => {
          console.info(`📄 Download URL: ${downloadURL}`);
          // Persist URL to lease record so Document Hub can render instantly without listAll()
          try {
            if (typeof LeaseAgreementManager.updateLeaseWithFirebase === 'function') {
              const existing = LeaseAgreementManager.getLease(leaseId) || {};
              const documentURLs = { ...(existing.documentURLs || {}) };
              documentURLs[docType] = { url: downloadURL, fileName, path: storagePath, uploadedAt: new Date().toISOString() };
              LeaseAgreementManager.updateLeaseWithFirebase(leaseId, building, { documentURLs });
            }
          } catch (e) {
            console.warn('⚠️ Failed to persist document URL to lease:', e.message);
          }
          // Mirror storage PATH (not permanent download URL) to tenant SSoT so
          // tenant app can call getLeaseDocUrl CF for a PDPA-friendly 1-hour signed URL.
          if (docType === 'agreement') {
            try {
              const db = window.firebase.firestore();
              const { doc: fsDoc, updateDoc } = window.firebase.firestoreFunctions;
              updateDoc(
                fsDoc(db, 'tenants', building, 'list', roomId),
                { 'lease.contractPath': storagePath, 'lease.contractFileName': fileName },
              ).catch(e2 => console.warn('[LeaseDoc] tenant mirror update failed:', e2.message));
            } catch (e) {
              console.warn('[LeaseDoc] Firestore unavailable for tenant mirror write:', e.message);
            }
          }
        })
        .catch((error) => {
          console.error(`❌ Error uploading ${docType}:`, error);
        });
    }

    console.info(`📁 Uploading ${totalFiles} documents for lease ${leaseId}...`);
  } catch (err) {
    console.warn('⚠️ Firebase Storage not available, documents will be uploaded later');
  }
}

// ===== Document Hub — Phase 2 SSoT =====
// Aggregates all documents for a lease: uploads from admin dashboard (leases/ Storage)
// + legacy base64 contractDocument from tenant record + company info from tenant_app.
const LEASE_DOC_LABELS = {
  agreement: { label: 'สัญญาเช่า', icon: '📋' },
  id: { label: 'สำเนาบัตรประชาชน', icon: '🆔' },
  petCert: { label: 'ใบรับรองวัคซีนสัตว์เลี้ยง', icon: '💉' },
  tenantContact: { label: 'ข้อมูลติดต่อผู้เช่า', icon: '📞' },
  income: { label: 'หลักฐานรายได้', icon: '💰' }
};

async function viewLeaseDocuments(leaseId) {
  const lease = LeaseAgreementManager.getLease(leaseId);
  if (!lease) {
    showToast('ไม่พบสัญญานี้', 'error');
    return;
  }

  // getTenant signature is (building, id), but lease only has tenantId — use the any-building lookup
  const tenant = (typeof TenantConfigManager !== 'undefined')
    ? (TenantConfigManager.getTenant(lease.building, lease.tenantId)
       || TenantConfigManager.getTenantByIdAnyBuilding?.(lease.tenantId)
       || null)
    : null;

  // Build modal
  let modal = document.getElementById('leaseDocumentsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'leaseDocumentsModal';
    modal.className = 'ui-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'leaseDocumentsTitle');
    modal.className = 'u-modal-overlay';
    document.body.appendChild(modal);
  }

  const moveIn = lease.moveInDate ? new Date(lease.moveInDate).toLocaleDateString('th-TH') : '—';
  const buildingLabel = lease.building === 'rooms' ? 'ห้องแถว' : 'Nest';

  modal.innerHTML = `
    <div data-modal style="background:white;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <div style="padding:20px 24px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 id="leaseDocumentsTitle" style="font-size:1.3rem;margin:0;color:${DashColors.GREEN_DEEP};">📁 เอกสารสัญญา — ${buildingLabel} ห้อง ${lease.roomId}</h2>
          <div style="font-size:.85rem;color:${DashColors.TEXT_MUTED};margin-top:4px;">${lease.tenantName || lease.tenantId} · เข้า ${moveIn} · ฿${lease.rentAmount?.toLocaleString() || '-'}</div>
        </div>
        <button data-action="closeNearestDataModal" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:${DashColors.TEXT_LIGHTER};">✕</button>
      </div>
      <div id="leaseDocumentsBody" style="padding:20px 24px;">
        <div style="text-align:center;padding:30px;color:${DashColors.TEXT_LIGHTER};">⏳ กำลังโหลดเอกสาร...</div>
      </div>
    </div>
  `;

  const body = document.getElementById('leaseDocumentsBody');
  const sections = [];

  // Resolve a contractDocument value (data: URL, http(s) URL, or Firebase Storage
  // path) into a usable href. renewLease + transferTenant write the Storage PATH
  // (e.g. "leases/rooms/15/{leaseId}/lease-renewal-X.jpg"), which used to render
  // as `<a href="leases/...">` → browser resolves to `https://the-green-haven.
  // vercel.app/leases/...` → 404. We now await getDownloadURL for storage paths
  // before building the link.
  async function _resolveContractHref(value) {
    if (!value || typeof value !== 'string') return null;
    if (value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
    try {
      const storage = window.firebase.storage();
      const { ref: sRef, getDownloadURL: sGetDownloadURL } = window.firebase.storageFunctions;
      return await sGetDownloadURL(sRef(storage, value));
    } catch (e) {
      console.warn('[LeaseDocs] getDownloadURL failed for', value, '—', e.message);
      return null;
    }
  }

  // Section 1a: Contract base64/path stored directly in lease record (from tenant modal upload)
  if (lease.contractDocument) {
    const fname = lease.contractFileName || 'lease-contract';
    const href = await _resolveContractHref(lease.contractDocument);
    const linkInner = href
      ? `<a href="${_escapeAttr(href)}" download="${_escapeAttr(fname)}" target="_blank" rel="noopener noreferrer" style="color:${DashColors.GREEN_DARK};font-weight:600;text-decoration:none;">⬇️ ${_escapeHTML(fname)}</a>`
      : `<span style="color:${DashColors.RED_DEEP};font-weight:600;">⚠️ ${_escapeHTML(fname)} (โหลดไฟล์ไม่สำเร็จ)</span>`;
    sections.push(`
      <div class="dx-mb">
        <div style="font-weight:700;color:${DashColors.GREEN_DEEP};margin-bottom:.5rem;font-size:.95rem;">📋 สัญญาเช่า (อัพโหลดผ่าน Tab ผู้เช่า)</div>
        <div style="padding:10px 12px;background:${DashColors.GREEN_BG};border-left:3px solid ${DashColors.GREEN_ACTIVE};border-radius:4px;font-size:.88rem;">
          ${linkInner}
          ${lease.contractUploadedAt ? `<div style="font-size:.75rem;color:${DashColors.TEXT_LIGHTER};margin-top:3px;">อัพโหลด: ${new Date(lease.contractUploadedAt).toLocaleString('th-TH')}</div>` : ''}
        </div>
      </div>
    `);
  }

  // Section 1b: Lease documents from Firebase Storage (uploaded via Tab สัญญา form)
  const leaseDocsHTML = await _renderLeaseStorageDocs(lease);
  sections.push(`
    <div class="dx-mb">
      <div style="font-weight:700;color:${DashColors.GREEN_DEEP};margin-bottom:.5rem;font-size:.95rem;">📎 เอกสารแนบสัญญา (อัพโหลดผ่าน Tab สัญญา)</div>
      ${leaseDocsHTML}
    </div>
  `);

  // Section 2: Legacy contractDocument (base64 in tenant record — pre-Phase-3 data)
  if (tenant?.contractDocument) {
    const fname = tenant.contractFileName || 'contract-legacy';
    const href = await _resolveContractHref(tenant.contractDocument);
    const linkInner = href
      ? `<a href="${_escapeAttr(href)}" download="${_escapeAttr(fname)}" target="_blank" rel="noopener noreferrer" style="color:${DashColors.ORANGE_DEEP};font-weight:600;text-decoration:none;">⬇️ ${_escapeHTML(fname)}</a>`
      : `<span style="color:${DashColors.RED_DEEP};font-weight:600;">⚠️ ${_escapeHTML(fname)} (โหลดไฟล์ไม่สำเร็จ)</span>`;
    sections.push(`
      <div class="dx-mb">
        <div style="font-weight:700;color:#bf360c;margin-bottom:.5rem;font-size:.95rem;">📄 สัญญาเช่า (Legacy — อยู่ใน tenant record, รอย้าย)</div>
        <div style="padding:10px 12px;background:${DashColors.ORANGE_BG};border-left:3px solid ${DashColors.ORANGE_MED};border-radius:4px;font-size:.88rem;">
          ${linkInner}
          <div style="font-size:.75rem;color:${DashColors.TEXT_LIGHTER};margin-top:3px;">ข้อมูลเก่าก่อน Phase 3 — จะย้ายไป lease SSoT อัตโนมัติเมื่อมีการแก้ไขผ่าน Tab ผู้เช่า</div>
        </div>
      </div>
    `);
  }

  // Section 3: Tenant-side data (company info, avatar, etc.)
  if (tenant?.companyInfo?.name) {
    const ci = tenant.companyInfo;
    sections.push(`
      <div class="dx-mb">
        <div style="font-weight:700;color:#01579b;margin-bottom:.5rem;font-size:.95rem;">🏢 ข้อมูลบริษัท (จาก tenant_app)</div>
        <div style="padding:10px 12px;background:#e1f5fe;border-left:3px solid #0288d1;border-radius:4px;font-size:.88rem;line-height:1.6;">
          <div><b>ชื่อ:</b> ${_escapeHTML(ci.name || '-')}</div>
          ${ci.taxId ? `<div><b>เลขผู้เสียภาษี:</b> ${_escapeHTML(ci.taxId)}</div>` : ''}
          ${ci.address ? `<div><b>ที่อยู่:</b> ${_escapeHTML(ci.address)}</div>` : ''}
        </div>
      </div>
    `);
  }

  // Section 4: Tenant contact info (always show for completeness)
  if (tenant) {
    sections.push(`
      <div>
        <div style="font-weight:700;color:#4a148c;margin-bottom:.5rem;font-size:.95rem;">👤 ข้อมูลผู้เช่า (SSoT: Tab ผู้เช่า)</div>
        <div style="padding:10px 12px;background:${DashColors.PURPLE_BG};border-left:3px solid #7b1fa2;border-radius:4px;font-size:.88rem;line-height:1.6;">
          <div><b>ชื่อ:</b> ${_escapeHTML(tenant.name || '-')}</div>
          ${tenant.phone ? `<div><b>เบอร์:</b> ${_escapeHTML(tenant.phone)}</div>` : ''}
          ${tenant.lineID ? `<div><b>LINE ID:</b> ${_escapeHTML(tenant.lineID)}</div>` : ''}
          ${tenant.idCardNumber ? `<div><b>เลขบัตรประชาชน:</b> ${_escapeHTML(tenant.idCardNumber)}</div>` : ''}
          ${tenant.emergencyContact?.name ? `<div><b>ติดต่อฉุกเฉิน:</b> ${_escapeHTML(tenant.emergencyContact.name)} ${tenant.emergencyContact.phone || ''}</div>` : ''}
        </div>
      </div>
    `);
  }

  body.innerHTML = sections.join('');
}

async function _renderLeaseStorageDocs(lease) {
  const { documentURLs, building, roomId, id: leaseId, documents = [] } = lease;

  // Prefer stored URLs (new uploads)
  if (documentURLs && Object.keys(documentURLs).length > 0) {
    return Object.entries(documentURLs).map(([key, v]) => {
      const meta = LEASE_DOC_LABELS[key] || { label: key, icon: '📄' };
      const url = typeof v === 'string' ? v : v?.url;
      const fname = (typeof v === 'object' && v?.fileName) || `${key}`;
      if (!url) return '';
      return `
        <div style="padding:10px 12px;background:${DashColors.GREEN_BG};border-left:3px solid ${DashColors.GREEN_ACTIVE};border-radius:4px;margin-bottom:6px;font-size:.88rem;display:flex;justify-content:space-between;align-items:center;">
          <span>${meta.icon} <b>${meta.label}</b> <span style="color:${DashColors.TEXT_LIGHTER};font-size:.78rem;">(${_escapeHTML(fname)})</span></span>
          <a href="${_escapeAttr(url)}" target="_blank" rel="noopener noreferrer" style="color:${DashColors.GREEN_DARK};font-weight:600;text-decoration:none;">⬇️ ดาวน์โหลด</a>
        </div>`;
    }).join('') || `<div style="color:${DashColors.TEXT_LIGHTER};font-size:.85rem;">ยังไม่มีเอกสาร</div>`;
  }

  // Fallback: list Storage folder (for legacy leases without documentURLs)
  try {
    if (!window.firebase?.storage) {
      return `<div style="color:${DashColors.TEXT_LIGHTER};font-size:.85rem;">Firebase Storage ไม่พร้อมใช้งาน</div>`;
    }
    const storage = window.firebase.storage();
    const { ref: sRef, listAll: sListAll, getDownloadURL: sGetDownloadURL } = window.firebase.storageFunctions;
    const folderRef = sRef(storage, `leases/${building}/${roomId}/${leaseId}`);
    const result = await sListAll(folderRef);
    if (!result.items.length) {
      return `<div style="color:${DashColors.TEXT_LIGHTER};font-size:.85rem;padding:8px;">ยังไม่มีไฟล์เอกสาร (admin ยังไม่ได้อัพโหลด)</div>`;
    }
    const urls = await Promise.all(result.items.map(async (item) => ({
      name: item.name,
      url: await sGetDownloadURL(item)
    })));
    return urls.map(({ name, url }) => {
      // Guess doc type from filename prefix
      const docType = Object.entries({
        'lease-agreement': 'agreement',
        'tenant-id': 'id',
        'pet-vaccine-certificate': 'petCert',
        'tenant-contact': 'tenantContact',
        'proof-of-income': 'income'
      }).find(([prefix]) => name.startsWith(prefix))?.[1] || 'other';
      const meta = LEASE_DOC_LABELS[docType] || { label: 'เอกสารอื่น', icon: '📄' };
      return `
        <div style="padding:10px 12px;background:${DashColors.GREEN_BG};border-left:3px solid ${DashColors.GREEN_ACTIVE};border-radius:4px;margin-bottom:6px;font-size:.88rem;display:flex;justify-content:space-between;align-items:center;">
          <span>${meta.icon} <b>${meta.label}</b> <span style="color:${DashColors.TEXT_LIGHTER};font-size:.78rem;">(${_escapeHTML(name)})</span></span>
          <a href="${_escapeAttr(url)}" target="_blank" rel="noopener noreferrer" style="color:${DashColors.GREEN_DARK};font-weight:600;text-decoration:none;">⬇️ ดาวน์โหลด</a>
        </div>`;
    }).join('');
  } catch (e) {
    console.warn('⚠️ listAll failed:', e.message);
    return `<div style="color:${DashColors.RED_DEEP};font-size:.85rem;padding:8px;">โหลดเอกสารล้มเหลว: ` + _escapeHTML(e.message) + '</div>';
  }
}

function _escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function _escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

if (typeof window !== 'undefined') {
  window.viewLeaseDocuments = viewLeaseDocuments;
}

function endLease(leaseId) {
  window.ghConfirm('สิ้นสุดสัญญาเช่านี้?', { title: 'สิ้นสุดสัญญา', confirmLabel: 'สิ้นสุดสัญญา', danger: true }).then(ok => {
    if (!ok) return;
    const lease = LeaseAgreementManager.getLease(leaseId);
    const moveOutDate = new Date().toISOString();

    // Use Firebase-enabled update if available
    const success = typeof LeaseAgreementManager.updateLeaseWithFirebase === 'function'
      ? LeaseAgreementManager.updateLeaseWithFirebase(leaseId, lease.building, {
          moveOutDate: moveOutDate,
          status: 'inactive'
        })
      : LeaseAgreementManager.endLease(leaseId);

    if (success) {
      showToast('สิ้นสุดสัญญาเช่าเรียบร้อย', 'success');
      renderLeaseAgreementsPage();
    }
  });
}

function deleteLease(leaseId) {
  window.ghConfirm('ลบสัญญาเช่านี้? ประวัติจะหายไป', { danger: true }).then(ok => {
    if (!ok) return;
    if (LeaseAgreementManager.deleteLease(leaseId)) {
      showToast('ลบสัญญาเช่าเรียบร้อย', 'success');
      renderLeaseAgreementsPage();
    }
  });
}


// ===== PET REGISTRATION APPROVALS =====
// SSoT: tenants/{building}/list/{roomId}/pets/{petId} (matches tenant_app.html write path)
// Admin reads via collectionGroup('pets') so any pet under any room is picked up.
// §7-CC: _petsUnsub window-attached so cleanupAdminListeners + future extracted
// dashboard-tenant-lease.js can read it cross-script.
window._petsUnsub = null;
let _petsFromFirestore = [];
function initPetApprovalsPage() {
  loadAndRenderPetApprovals();
  if (window._petsUnsub) return;
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const cg = fs.collectionGroup(db, 'pets');
    window._petsUnsub = fs.onSnapshot(cg, snap => {
      // Filter out archived pets — §7-T discipline. collectionGroup('pets')
      // matches BOTH live (`tenants/{b}/list/{r}/pets/{id}`) and archived
      // (`tenants/{b}/archive/{contractId}/pets/{id}`) paths because the
      // collection name is identical. Without the path-segment guard, admin
      // queue renders archived pets (with `room: contractId` from parts[3])
      // and insights overcount each move-out cycle.
      _petsFromFirestore = snap.docs
        .filter(d => {
          const parts = d.ref.path.split('/');
          // tenants/{b}/list/{r}/pets/{id}            → parts[2] === 'list'    (live, keep)
          // tenants/{b}/archive/{cid}/pets/{id}       → parts[2] === 'archive' (skip)
          if (parts[2] === 'list') return true;
          if (parts[2] === 'archive') return false;
          // Unexpected shape — log so future drift is visible (e.g. someone
          // adds a third subcollection-of-pets without updating this filter).
          console.warn('[pets cg] unexpected path shape — skipping:', d.ref.path);
          return false;
        })
        .map(d => {
          // Path: tenants/{building}/list/{roomId}/pets/{petId}
          const parts = d.ref.path.split('/');
          const pathBuilding = parts[1];
          const pathRoom     = parts[3];
          const data = d.data();
          return {
            id: d.id,
            ...data,
            // Trust path over field for admin write-back, but keep field as default.
            building: data.building || pathBuilding,
            room:     data.room     || pathRoom,
          };
        });
      loadAndRenderPetApprovals();
    }, err => console.warn('pets onSnapshot failed:', err));
  } catch(e) { console.warn('pets subscribe failed:', e); }
}

function loadAndRenderPetApprovals() {
  const list = document.getElementById('petsList');
  if (!list) return;

  // SSoT only — Firestore tenants/{b}/list/{r}/pets/{id}.
  // (Removed admin-localStorage merge: admin's localStorage never contains
  // another device's tenant data, so the merge was always a no-op.)
  let allPets = (_petsFromFirestore || []).slice();

  const searchVal = document.getElementById('petSearch')?.value.toLowerCase() || '';
  const statusFilter = document.getElementById('petFilterStatus')?.value || '';

  allPets = allPets.filter(p => {
    const matchesSearch = !searchVal || p.room.toLowerCase().includes(searchVal) || p.name.toLowerCase().includes(searchVal);
    const matchesStatus = !statusFilter || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (allPets.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">🐾 No pet registrations</div>';
    return;
  }

  list.innerHTML = allPets.map(p => {
    const statusBadge = p.status === 'approved' ? '✅ Approved' : p.status === 'rejected' ? '❌ Rejected' : '⏳ Pending';
    const statusColor = p.status === 'approved' ? DashColors.GREEN_ACTIVE : p.status === 'rejected' ? DashColors.RED_MED : DashColors.ORANGE_MED;

    const photoBlock = p.photoURL
      ? `<img src="${p.photoURL}" alt="${p.name}" style="width:64px; height:64px; border-radius:14px; object-fit:cover; border:1px solid #eee;">`
      : `<div style="width:64px; height:64px; border-radius:14px; background:#f5f5f5; display:flex; align-items:center; justify-content:center; font-size:1.4rem;">${p.type || '🐾'}</div>`;
    const vaccineBookBtn = p.vaccineBookURL
      ? `<a href="${p.vaccineBookURL}" target="_blank" rel="noopener" class="compact-btn compact-btn-view" style="text-decoration:none; display:inline-block;">📖 ดูสมุดวัคซีน${p.vaccineBookFileName ? ` (${p.vaccineBookFileName})` : ''}</a>`
      : '';
    return `
      <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${statusColor};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem; gap:0.8rem;">
          <div style="display:flex; gap:0.8rem; align-items:center;">
            ${photoBlock}
            <div>
              <div style="font-weight: 700; font-size: 1rem;">🐾 ${p.name} (${p.type})</div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Room: <strong>${p.room}</strong> · ${p.building === 'nest' ? 'Nest' : 'ห้องแถว'}</div>
            </div>
          </div>
          <span style="padding: 0.4rem 0.8rem; border-radius: 20px; background: ${statusColor}; color: white; font-size: 0.85rem; font-weight: 600;">${statusBadge}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.6rem 1rem; font-size: 0.9rem; margin-bottom: 0.8rem;">
          <div>🐕 สายพันธุ์: <strong>${p.breed || '-'}</strong></div>
          <div>⚧️ เพศ: <strong>${p.gender || '-'}</strong></div>
          <div>🎂 อายุ: <strong>${p.age || '-'}</strong></div>
        </div>
        <div style="font-size:0.85rem; margin-bottom:0.8rem; padding:6px 10px; border-radius:8px; background:${p.isVaccinated ? '#f0fdf4' : '#fef2f2'}; color:${p.isVaccinated ? '#166534' : '#991b1b'};">
          💉 วัคซีน: <strong>${p.isVaccinated ? '✅ ฉีดแล้ว' : '❌ ยังไม่ฉีด'}</strong>
          ${p.vaxDate ? ` · วันฉีด: ${p.vaxDate}` : ''}
          ${p.vaxExpiry ? ` · หมดอายุ: ${p.vaxExpiry}` : ''}
        </div>
        ${vaccineBookBtn ? `<div style="margin-bottom:0.8rem;">${vaccineBookBtn}</div>` : ''}
        ${p.status === 'pending' ? `
          <div style="display: flex; gap: 0.5rem;">
            <button data-action="approvePet" data-id="${p.building}" data-arg="${p.room}" data-arg2="${p.id}" class="compact-btn compact-btn-view">✅ Approve</button>
            <button data-action="rejectPet" data-id="${p.building}" data-arg="${p.room}" data-arg2="${p.id}" class="compact-btn compact-btn-delete">❌ Reject</button>
          </div>
        ` : `
          <button data-action="removePetApproval" data-id="${p.building}" data-arg="${p.room}" data-arg2="${p.id}" class="compact-btn compact-btn-delete">🗑️ Remove</button>
        `}
      </div>
    `;
  }).join('');
}

function filterPetsByStatus(status) {
  loadAndRenderPetApprovals();
}

async function _writePetToFirestore(building, room, id, patch){
  if (!window.firebase?.firestore) return;
  if (!building || !room || !id) { console.warn('pet write missing building/room/id', { building, room, id }); return; }
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const docRef = fs.doc(db, 'tenants', building, 'list', String(room), 'pets', id);
    await fs.setDoc(docRef, patch, { merge: true });
  } catch(e) { console.warn('Firestore pet update failed:', e); }
}
// _deletePetFromFirestore removed 2026-05-23 — was orphaning Storage files
// at pets/{b}/{r}/{id}/* on admin "🗑️ Remove". Replaced by deletePetMedia CF
// which deletes Firestore doc + Storage in one server call (admin-only gated).

function approvePet(building, room, id) {
  _writePetToFirestore(building, room, id, { status: 'approved', approvalDate: new Date().toISOString() });
  showToast('✅ Pet approved', 'success');
}

function rejectPet(building, room, id) {
  window.ghConfirm('ปฏิเสธการขึ้นทะเบียนสัตว์เลี้ยงนี้?', { danger: true }).then(ok => {
    if (!ok) return;
    _writePetToFirestore(building, room, id, { status: 'rejected', rejectionDate: new Date().toISOString() });
    showToast('✅ Pet rejected', 'success');
  });
}

async function removePetApproval(building, room, id) {
  const ok = await window.ghConfirm('ลบการขึ้นทะเบียนสัตว์เลี้ยงนี้?\n(จะลบรูป + สมุดวัคซีนใน Storage ด้วย)', { danger: true });
  if (!ok) return;
  if (!building || !room || !id) {
    console.warn('removePetApproval: missing building/room/id', { building, room, id });
    showToast('❌ ข้อมูลไม่ครบ', 'error');
    return;
  }
  try {
    const callable = window.firebase.functions.httpsCallable('deletePetMedia');
    const res = await callable({ building, roomId: String(room), petId: String(id) });
    const data = res?.data || {};
    const errSuffix = data.storageErrors ? ` (Storage: ${data.storageErrors} error)` : '';
    showToast(`✅ ลบสำเร็จ — ลบไฟล์ ${data.storageDeleted || 0} ไฟล์${errSuffix}`, 'success');
  } catch (e) {
    console.warn('deletePetMedia call failed:', e);
    showToast(`❌ ลบไม่สำเร็จ: ${e.message || 'unknown'}`, 'error');
  }
}
