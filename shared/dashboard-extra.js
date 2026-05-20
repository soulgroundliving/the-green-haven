// ===== Password Change Modal Functions =====
// Modal has inline style="display:none" so we must set display explicitly per §7-C.
function openChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');
  document.getElementById('oldPassword')?.focus();
}

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.add('u-hidden');
  const ids = ['oldPassword', 'newPassword', 'confirmPassword'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

async function changePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!oldPassword || !newPassword || !confirmPassword) {
    showToast('กรุณากรอกรหัสผ่านทั้งหมด', 'warning');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('รหัสผ่านใหม่ไม่ตรงกัน', 'warning');
    return;
  }

  if (newPassword.length < 6) {
    showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', 'warning');
    return;
  }

  try {
    const user = window.auth.currentUser;
    if (!user) {
      showToast('ไม่พบบัญชีผู้ใช้', 'warning');
      return;
    }

    // Reauthenticate
    const credential = window.firebaseAuthFunctions.EmailAuthProvider?.credential(user.email, oldPassword);
    if (!credential) {
      showToast('อีเมลหรือรหัสผ่านเก่าไม่ถูกต้อง', 'warning');
      return;
    }

    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);

    // Log audit
    const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
    const audit = {
      timestamp: new Date().toISOString(),
      action: 'PASSWORD_CHANGED',
      userId: user.uid,
      userEmail: user.email,
      userType: tenantData.userType
    };

    const auditLog = JSON.parse(localStorage.getItem('auditLog') || '[]');
    auditLog.push(audit);
    localStorage.setItem('auditLog', JSON.stringify(auditLog));

    showToast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
    closeChangePasswordModal();
    setTimeout(() => handleLogout(), 1500);
  } catch (error) {
    console.error('Password change error:', error);
    showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

// ===== Password Visibility Toggle (Inline) =====
function togglePasswordVisibility(fieldId) {
  const input = document.getElementById(fieldId);
  const icon = document.getElementById(`icon-${fieldId}`);

  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '🙈';  // Now visible, show closed eye to close
  } else {
    input.type = 'password';
    icon.textContent = '👁️';  // Now hidden, show open eye to open
  }
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', function() {
  const changePasswordModal = document.getElementById('changePasswordModal');
  if (changePasswordModal) {
    changePasswordModal.addEventListener('click', function(e) {
      if (e.target === this) {
        closeChangePasswordModal();
      }
    });
  }

  // Initialize room status colors
  updateRoomStatuses();
});

// ===== Room Status Color System =====
function getRoomStatus(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenants = tenantData.tenants || {};
  const tenant = tenants[roomId];

  // No tenant = vacant
  if (!tenant || !tenant.name) {
    return 'vacant';
  }

  // Check for overdue payments
  const invoices = tenantData.invoices || [];
  const roomInvoices = invoices.filter(inv => inv.roomId === roomId);
  const overdueInvoices = roomInvoices.filter(inv => {
    if (inv.status === 'paid') return false;
    const dueDate = new Date(inv.dueDate);
    return new Date() > dueDate;
  });

  if (overdueInvoices.length > 0) {
    return 'overdue';
  }

  // Check for expiring lease (< 30 days remaining)
  if (tenant.contractEnd) {
    const endDate = new Date(tenant.contractEnd);
    const today = new Date();
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0 && daysLeft <= 30) {
      return 'expiring';
    }
  }

  // Has tenant and paying = occupied
  return 'occupied';
}

// ===== Payment Status System =====
function getPaymentStatus(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const invoices = tenantData.invoices || [];
  const tenant = tenantData.tenants?.[roomId];

  // No tenant = no payment status
  if (!tenant || !tenant.name) {
    return null;
  }

  // Get room's invoices
  const roomInvoices = invoices.filter(inv => inv.roomId === roomId);
  if (roomInvoices.length === 0) {
    return null;
  }

  const today = new Date();

  // Check for any overdue invoices (unpaid and past due date)
  const overdueInvoices = roomInvoices.filter(inv => {
    if (inv.status === 'paid') return false;
    const dueDate = new Date(inv.dueDate);
    return today > dueDate;
  });

  if (overdueInvoices.length > 0) {
    return 'overdue';
  }

  // Check for unpaid invoices (pending payment)
  const unpaidInvoices = roomInvoices.filter(inv => inv.status !== 'paid');
  if (unpaidInvoices.length > 0) {
    return 'pending';
  }

  // All invoices are paid
  return 'paid';
}

// ===== Room Color Status Function =====
function getRoomColorStatus(roomId, room) {
  const allTenants = loadTenants();
  const tenant = allTenants[roomId];

  // Vacant = gray
  if (!tenant || !tenant.name) {
    return { color: '#e0e0e0', icon: '⚪', label: 'ว่าง' };
  }

  // Check payment status
  const paymentStatus = getPaymentStatus(roomId);
  if (paymentStatus === 'overdue') {
    return { color: '#d32f2f', icon: '🔴', label: 'ค้าง' };
  }

  // Check contract expiry (within 30 days)
  const today = new Date();
  const in30 = new Date(today.getTime() + 30*86400000);
  if (tenant.contractEnd) {
    const exp = new Date(tenant.contractEnd);
    if (exp > today && exp <= in30) {
      return { color: '#fbc02d', icon: '🟡', label: 'ใกล้หมด' };
    }
  }

  // Occupied with good payment = green
  return { color: '#4caf50', icon: '🟢', label: 'มี' };
}

// ===== Get Payment Info Function =====
function getPaymentInfo(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const invoices = tenantData.invoices || [];
  const roomInvoices = invoices.filter(inv => inv.roomId === roomId);

  let nextDueDate = null;
  let overdueAmount = 0;

  if (roomInvoices.length > 0) {
    const today = new Date();

    // Find the next unpaid invoice
    const unpaidInvoices = roomInvoices.filter(inv => inv.status !== 'paid');
    if (unpaidInvoices.length > 0) {
      // Sort by due date and get the earliest
      unpaidInvoices.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      nextDueDate = unpaidInvoices[0].dueDate;
    }

    // Calculate overdue amount
    const overdueInvoices = roomInvoices.filter(inv => {
      if (inv.status === 'paid') return false;
      const dueDate = new Date(inv.dueDate);
      return today > dueDate;
    });

    overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  }

  return { nextDueDate, overdueAmount };
}

// ===== Quick Action Functions =====
function viewContract(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenant = tenantData[roomId];

  if (!tenant || !tenant.name) {
    showToast('ไม่มีข้อมูลผู้เช่า', 'error');
    return;
  }

  const contractStart = tenant.contractStart || '—';
  const contractEnd = tenant.contractEnd || '—';
  const moveInDate = tenant.moveInDate || '—';

  const contractInfo = `
📄 สัญญาเช่า — ห้อง ${roomId}

👤 ชื่อผู้เช่า: ${tenant.name}
📱 โทรศัพท์: ${tenant.phone || '—'}
🆔 เลขประชาชน: ${tenant.idNumber || '—'}

📅 วันเข้าพัก: ${new Date(moveInDate).toLocaleDateString('th-TH') || '—'}
📅 วันเริ่มสัญญา: ${new Date(contractStart).toLocaleDateString('th-TH') || '—'}
📅 วันสิ้นสุดสัญญา: ${new Date(contractEnd).toLocaleDateString('th-TH') || '—'}

💰 ค่าเช่า: ฿${tenant.rent?.toLocaleString() || '—'}
💵 มัดจำ: ฿${tenant.deposit?.toLocaleString() || '0'}

📝 หมายเหตุ: ${tenant.notes || 'ไม่มี'}
  `;

  if (tenant.contractDocument) {
    window.GhModal.confirm({
      title: 'สัญญาเช่า',
      body: function (el) {
        el.style.whiteSpace = 'pre-wrap';
        el.style.fontSize = '.85rem';
        el.style.lineHeight = '1.7';
        el.textContent = contractInfo + '\n✅ มีไฟล์สัญญาอยู่';
      },
      confirmLabel: 'ดูเอกสาร',
      cancelLabel: 'ปิด',
    }).then(function (ok) { if (ok) showContractDocument(roomId, tenant); });
  } else {
    showToast('ยังไม่มีไฟล์สัญญา', 'warning');
  }
}

/**
 * Display contract document in a modal/window
 */
/**
 * Preview contract document from modal button click
 */
function previewContractDocument(building, roomId) {
  // Support both old signature (single param) and new signature (building, roomId)
  if (typeof building === 'string' && !roomId) {
    roomId = building;
    building = currentEditBuilding || detectBuildingFromRoomId(roomId);
  }

  // Phase 3: lease is SSoT for contract document — check lease first, tenant only as legacy fallback
  let contractDocument = null;
  let contractFileName = null;
  const lease = LeaseAgreementManager.getActiveLease(building, roomId);
  if (lease && lease.contractDocument) {
    contractDocument = lease.contractDocument;
    contractFileName = lease.contractFileName;
  }

  if (!contractDocument) {
    let tenant = null;
    if (currentEditTenantId && typeof TenantConfigManager !== 'undefined') {
      tenant = TenantConfigManager.getTenant(building, currentEditTenantId);
    }
    if (!tenant) {
      const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
      tenant = tenantData[roomId];
    }
    if (tenant?.contractDocument) {
      contractDocument = tenant.contractDocument;
      contractFileName = tenant.contractFileName;
    }
  }

  if (!contractDocument) {
    showToast('ไม่มีไฟล์สัญญา', 'error');
    return;
  }

  showContractDocument(roomId, { contractDocument, contractFileName });
}

/**
 * Delete contract document
 */
function deleteContractDocument(building, roomId) {
  // Support both old signature (single param) and new signature (building, roomId)
  if (typeof building === 'string' && !roomId) {
    roomId = building;
    building = currentEditBuilding || detectBuildingFromRoomId(roomId);
  }

  window.ghConfirm('ลบไฟล์สัญญา? การดำเนินการนี้ไม่สามารถยกเลิกได้', { danger: true }).then(ok => {
    if (!ok) return;
    _doDeleteContractFile(building, roomId);
  });
}

function _doDeleteContractFile(building, roomId) {
  // Delete from TenantConfigManager
  if (currentEditTenantId && typeof TenantConfigManager !== 'undefined') {
    const tenant = TenantConfigManager.getTenant(building, currentEditTenantId);
    if (tenant) {
      TenantConfigManager.updateTenant(building, currentEditTenantId, {
        contractDocument: '',
        contractFileName: ''
      });
    }
  }

  // Also delete from legacy tenant_data for compatibility
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  if (tenantData[roomId]) {
    tenantData[roomId].contractDocument = '';
    tenantData[roomId].contractFileName = '';
    localStorage.setItem('tenant_data', JSON.stringify(tenantData));
  }

  // Delete from lease if exists
  const lease = LeaseAgreementManager.getActiveLease(building, roomId);
  if (lease) {
    LeaseAgreementManager.updateLease(lease.id, {
      contractDocument: '',
      contractFileName: ''
    });
  }

  // Update UI
  document.getElementById('modalContractDocument').value = '';
  document.getElementById('modalContractFileName').value = '';
  document.getElementById('contractDocStatus').textContent = '';

  showToast('ลบไฟล์สัญญาแล้ว', 'success');
}

function showContractDocument(roomId, tenant) {
  if (!tenant.contractDocument) {
    showToast('ไม่มีไฟล์สัญญา', 'error');
    return;
  }

  // Create a modal to display the document
  const modal = document.createElement('div');
  modal.className = 'u-modal-doc';

  const container = document.createElement('div');
  container.className = 'u-modal-doc-box';

  // Header
  const header = document.createElement('div');
  header.className = 'u-modal-doc-head';
  header.innerHTML = `
    <h2 style="margin:0;color:#333;">📄 สัญญาเช่า - ห้อง ${_esc(roomId)} (${_esc(tenant.name)})</h2>
    <button onclick="this.closest('[data-modal]').remove()" style="background:#f0f0f0;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600;">✕ ปิด</button>
  `;

  // Content
  const content = document.createElement('div');
  content.className = 'u-modal-doc-body';

  // Check if it's a PDF or image
  if (tenant.contractDocument.startsWith('data:application/pdf')) {
    // Display PDF
    const iframe = document.createElement('iframe');
    iframe.src = tenant.contractDocument;
    iframe.className = 'u-form-input u-iframe-full';
    content.appendChild(iframe);
  } else if (tenant.contractDocument.startsWith('data:image')) {
    // Display image
    const img = document.createElement('img');
    img.src = tenant.contractDocument;
    img.className = 'u-img-contain';
    content.appendChild(img);
  } else {
    content.innerHTML = '<p style="color:#666;">ไม่สามารถแสดงไฟล์นี้</p>';
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'u-modal-doc-foot';
  const dlBtn = document.createElement('button');
  dlBtn.textContent = '⬇️ ดาวน์โหลด';
  dlBtn.className = 'u-btn-download';
  dlBtn.addEventListener('click', () => downloadContractAsFile(roomId, tenant.name));
  const closeBtn2 = document.createElement('button');
  closeBtn2.textContent = 'ปิด';
  closeBtn2.className = 'u-btn-close';
  closeBtn2.addEventListener('click', () => modal.remove());
  footer.appendChild(dlBtn);
  footer.appendChild(closeBtn2);

  container.appendChild(header);
  container.appendChild(content);
  container.appendChild(footer);
  modal.appendChild(container);
  modal.setAttribute('data-modal', 'true');
  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.remove();
  });
}

/**
 * Download contract document
 */
function downloadContractAsFile(roomId, tenantName) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenant = tenantData[roomId];

  if (!tenant || !tenant.contractDocument) {
    showToast('ไม่มีไฟล์สัญญา', 'error');
    return;
  }

  // Create download link
  const link = document.createElement('a');
  link.href = tenant.contractDocument;
  link.download = `contract_room${roomId}_${tenantName.replace(/\s+/g, '_')}.pdf`;
  link.click();
}

function recordPayment(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenant = tenantData.tenants?.[roomId];

  if (!tenant || !tenant.name) {
    showToast('ไม่มีข้อมูลผู้เช่า', 'error');
    return;
  }

  const amount = prompt(`💰 บันทึกค่าเช่า — ห้อง ${roomId}\n\nชื่อผู้เช่า: ${tenant.name}\nค่าเช่า: ฿${tenant.rent?.toLocaleString() || '0'}\n\nกรุณาระบุจำนวนเงินที่ชำระ:`);

  if (amount === null) return;

  const paymentAmount = parseFloat(amount);
  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    showToast('กรุณาใส่จำนวนเงินที่ถูกต้อง', 'error');
    return;
  }

  // Record payment in invoices
  const invoices = tenantData.invoices || [];
  const roomInvoices = invoices
    .filter(inv => inv.roomId === roomId && inv.status !== 'paid')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  if (roomInvoices.length === 0) {
    showToast('ไม่มีใบแจ้งหนี้ที่รอชำระ', 'success');
    return;
  }

  let remainingAmount = paymentAmount;
  roomInvoices.forEach(inv => {
    if (remainingAmount <= 0) return;

    const invoiceAmount = inv.amount;
    if (remainingAmount >= invoiceAmount) {
      inv.status = 'paid';
      inv.paidDate = new Date().toISOString().split('T')[0];
      remainingAmount -= invoiceAmount;
    } else {
      inv.amount -= remainingAmount;
      inv.paidAmount = (inv.paidAmount || 0) + remainingAmount;
      remainingAmount = 0;
    }
  });

  // Save to localStorage
  tenantData.invoices = invoices;
  localStorage.setItem('tenant_data', JSON.stringify(tenantData));

  showToast(`บันทึกการชำระเงินสำเร็จ จำนวนเงินที่ชำระ: ฿${paymentAmount.toLocaleString()}`, 'success');

  // Refresh the display
  renderCompactRoomGrid();
}

function viewBills(roomId) {
  // Navigate to bill page and pre-filter by room
  if (typeof goBillFromTable === 'function') {
    goBillFromTable(roomId);
  } else {
    window.showPage('bill');
  }
}

function reportMaintenance(roomId) {
  // Navigate to maintenance/requests page
  window.showPage('requests-approvals');
}

function updateRoomStatuses() {
  const roomPills = document.querySelectorAll('.new-room-pill');

  roomPills.forEach(pill => {
    const roomNum = pill.querySelector('.nr-num')?.textContent || '';
    const roomId = 'N' + roomNum;
    const status = getRoomStatus(roomId);

    // Remove all status classes
    pill.classList.remove('occupied', 'vacant', 'overdue', 'expiring');

    // Add current status class
    pill.classList.add(status);
  });
}

// ===== Occupancy Dashboard =====
function calculateOccupancy(buildingType = null) {
  const building = buildingType === 'nest' ? 'nest' : 'rooms';
  const config = RoomConfigManager.getRoomsConfig(building);
  const rooms = config.rooms.filter(r => !r.deleted).map(r => r.id);

  // SSoT: TenantConfigManager reads from tenant_master_data (Firestore-backed).
  // Per tenant_config_manager_keys.md, items are keyed by `roomId` (NOT `id`).
  // Previously `t.id` (undefined) made the set ["undefined"] → 0 matches.
  // "มีผู้เช่า" = identity is filled OR LINE-linked OR lease records the name.
  const tenantList = typeof TenantConfigManager !== 'undefined'
    ? (TenantConfigManager.getTenantList(building) || [])
    : [];
  const hasIdentity = t => !!(t && (t.name || t.firstName || t.lastName || t.linkedAuthUid || t.lease?.tenantName));
  const occupiedSet = new Set(
    tenantList.filter(hasIdentity).map(t => String(t.roomId ?? t.id ?? ''))
  );

  const occupied = rooms.filter(r => occupiedSet.has(String(r))).length;
  const vacant = rooms.length - occupied;
  const rate = rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0;

  return { total: rooms.length, occupied, vacant, rate };
}

// Export to window for global access
window.calculateOccupancy = calculateOccupancy;

function updateOccupancyDashboard() {
  // Update rooms building
  const oldMetrics = calculateOccupancy('old');
  document.getElementById('occupancy-total').textContent = oldMetrics.total;
  document.getElementById('occupancy-occupied').textContent = oldMetrics.occupied;
  document.getElementById('occupancy-vacant').textContent = oldMetrics.vacant;
  document.getElementById('occupancy-rate').textContent = oldMetrics.rate + '%';
  const soonRooms = typeof getExpiringLeases === 'function' ? getExpiringLeases('old').length : 0;
  const soonEl = document.getElementById('occupancy-soon');
  if (soonEl) soonEl.textContent = soonRooms;

  // Update Nest building
  const nestMetrics = calculateOccupancy('nest');
  document.getElementById('nest-occupancy-total').textContent = nestMetrics.total;
  document.getElementById('nest-occupancy-occupied').textContent = nestMetrics.occupied;
  document.getElementById('nest-occupancy-vacant').textContent = nestMetrics.vacant;
  document.getElementById('nest-occupancy-rate').textContent = nestMetrics.rate + '%';
  const soonNest = typeof getExpiringLeases === 'function' ? getExpiringLeases('nest').length : 0;
  const soonNestEl = document.getElementById('nest-occupancy-soon');
  if (soonNestEl) soonNestEl.textContent = soonNest;
}

// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — Lease Expiry Alerts (server-emitted leaseNotifications/) section
// ===== REAL-TIME FIREBASE LISTENERS =====
// §7-CC: window-attached so cleanupAdminListeners + future extracted modules
// can read/write the same listener map across <script> tag boundaries.
window.realtimeListeners = window.realtimeListeners || {};

function setupRoomDataListener() {
  // Room data comes from RoomConfigManager (local config), not Firestore subcollection.
  // No Firestore listener needed — avoids permission errors on non-existent collection.
  realtimeListeners.rooms = null;
  realtimeListeners.nest = null;
  updateRealtimeStatus(true); // data is always ready from local config
}

function setupLeaseDataListener() {
  // Lease data comes from lease-config.js (local config), not a Firestore collection.
  // No Firestore listener needed — avoids permission errors.
  realtimeListeners.leases = null;
}

function setupMeterDataListener() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    console.warn('Firebase not initialized, skipping meter listeners');
    return;
  }
  if (!window.firebaseAuth?.currentUser) return;

  // Idempotency: initNestPage() runs on every roomconfig-updated event (debounced
  // 250ms). Without this guard each call stacked a fresh onSnapshot on top of the
  // previous one — collection replay then fires once per stacked listener, and
  // subsequent meter writes fan out N times. After ~10 rerenders the console
  // shows the alternating "Real-time listeners activated" / "Meter data updated"
  // pattern from the screenshot. Tear down the prior listener first.
  if (typeof realtimeListeners.meter === 'function') {
    try { realtimeListeners.meter(); } catch (_) { /* noop */ }
    realtimeListeners.meter = null;
  }

  const db = window.firebase.firestore();
  const { collection, onSnapshot } = window.firebase.firestoreFunctions;

  try {
    const meterUnsubscribe = onSnapshot(
      collection(db, 'meter_data'),
      (snapshot) => {
        updateDashboardLive();
      },
      (error) => {
        console.error('❌ Error listening to meter data:', error);
      }
    );

    realtimeListeners.meter = meterUnsubscribe;
  } catch (err) {
    console.error('Error setting up meter listeners:', err);
  }
}

function updateRealtimeStatus(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  if (!dot || !text) return; // Element may not exist on all pages

  if (connected) {
    dot.classList.remove('u-dot-offline'); dot.classList.add('u-dot-online');
    text.textContent = '🟢 Real-time (Live)';
  } else {
    dot.classList.remove('u-dot-online'); dot.classList.add('u-dot-offline');
    text.textContent = '🔴 Disconnected';
  }
}

function stopRealtimeListeners() {
  // Unsubscribe from all listeners
  Object.values(window.realtimeListeners).forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
  window.realtimeListeners = {};
  console.log('✅ Real-time listeners stopped');
}

function setupAnnouncementListener() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    console.warn('Firebase not initialized, skipping announcement listeners');
    return;
  }
  if (realtimeListeners.announcements) return; // already subscribed

  const db = window.firebase.firestore();
  const { collection, onSnapshot } = window.firebase.firestoreFunctions;

  try {
    const unsub = onSnapshot(
      collection(db, 'announcements'),
      (snapshot) => {
        // C4 S2 (2026-05-18): all banner docs now carry type='banner' (post-backfill).
        // Normalize banner schema into legacy render shape so renderAnnouncementsList
        // keeps working unchanged.
        const docs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.type === 'banner')
          .map(d => {
            // Safely resolve sentAt → Date. Manual-backfilled docs may lack sentAt
            // entirely (Firestore Console edits don't add Timestamps). Each fallback
            // is independently guarded — ?? only catches null/undefined, NOT NaN.
            let sentMs = d.sentAt?.toDate?.()?.getTime?.();
            if (sentMs == null) sentMs = Date.parse(d.sentAt || '');
            if (!Number.isFinite(sentMs)) sentMs = Date.now();
            const sentDate = new Date(sentMs);
            return {
              id: d.id,
              icon: d.icon || '📢',
              title: d.title || '',
              content: d.body || '',
              date: sentDate.toISOString().split('T')[0],
              time: '',
              building: d.audience || 'all',
              createdAt: sentDate.toISOString(),
              createdBy: d.sender?.email || '📌 Admin',
              _source: 'announcements_new',
            };
          });
        const local = JSON.parse(localStorage.getItem('announcements_data') || '[]');
        const byId = new Map();
        local.forEach(a => byId.set(a.id, a));
        docs.forEach(a => byId.set(a.id, a));
        localStorage.setItem('announcements_data', JSON.stringify(Array.from(byId.values())));
        if (document.getElementById('announcementsList') && typeof renderAnnouncementsList === 'function') {
          renderAnnouncementsList();
        }
      },
      (err) => console.error('❌ announcements onSnapshot:', err)
    );
    realtimeListeners.announcements = unsub;
  } catch (err) {
    console.error('Error setting up announcement listener:', err);
  }
}

// ===== FIREBASE CLOUD DATA INITIALIZATION =====
async function initializeCloudData() {
  try {
    // Wait for Firebase to finish initializing (max 5s) — same pattern as initializeMeterDataFromFirebase
    let waited = 0;
    while (!window.firebaseReady && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (!window.firebaseReady || !window.firebaseApp || !window.firebase) {
      console.warn('⚠️ Firebase not ready for cloud data initialization after 5s');
      return;
    }

    console.log('🔄 Initializing cloud data from Firebase...');

    // Load owner info
    if (typeof OwnerConfigManager !== 'undefined' && typeof OwnerConfigManager.loadOwnerInfoFromFirebase === 'function') {
      await OwnerConfigManager.loadOwnerInfoFromFirebase();
    }

    // Load tenants for both buildings
    if (typeof TenantConfigManager !== 'undefined' && typeof TenantConfigManager.loadTenantsFromFirebase === 'function') {
      await TenantConfigManager.loadTenantsFromFirebase('rooms');
      await TenantConfigManager.loadTenantsFromFirebase('nest');
    }

    // Load leases for both buildings
    if (typeof LeaseAgreementManager !== 'undefined' && typeof LeaseAgreementManager.loadLeasesFromFirebase === 'function') {
      await LeaseAgreementManager.loadLeasesFromFirebase('rooms');
      await LeaseAgreementManager.loadLeasesFromFirebase('nest');
    }

    console.log('✅ Cloud data initialization complete');
  } catch (error) {
    console.warn('⚠️ Cloud data initialization failed:', error.message);
  }
}

// Initialize occupancy dashboard & lease alerts on page load
document.addEventListener('DOMContentLoaded', function() {
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();
  // Initialize cloud data from Firebase
  initializeCloudData();
});

// window.updateRoomStatuses — wrapper that runs the room-pill repaint THEN
// updates the occupancy KPIs + lease-expiry alerts. Cross-script callers in
// dashboard-tenant-modal.js + dashboard-pdpa-erasure.js invoke this name as a
// bareword; non-strict global lookup resolves it to THIS function, so they
// get the full repaint + KPI refresh in one call. Local bareword references
// inside this file still hit the inner `updateRoomStatuses()` function via
// JS scope precedence (no recursion).
window.updateRoomStatuses = function() {
  updateRoomStatuses();
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();
};


/**
 * Custom confirmation modal for duplicate month detection
 */
function showDuplicateConfirmDialog(title, message) {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.className = 'u-modal-overlay';

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'u-confirm-box';

    // Modal header
    const header = document.createElement('div');
    header.className = 'u-confirm-head';
    header.innerHTML = `
      <span style="font-size: 1.5rem;">⚠️</span>
      <div style="font-size: 0.95rem; font-weight: 700; color: #e65100;">${title}</div>
    `;

    // Modal body
    const body = document.createElement('div');
    body.className = 'u-confirm-body';
    body.textContent = message;

    // Modal footer
    const footer = document.createElement('div');
    footer.className = 'u-confirm-foot';

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ ยกเลิก';
    cancelBtn.className = 'u-btn-confirm-cancel';
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(false);
    };

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✅ ตกลง แทนที่ข้อมูล';
    confirmBtn.className = 'u-btn-confirm-ok';
    confirmBtn.onclick = () => {
      overlay.remove();
      resolve(true);
    };

    // Assemble modal
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus confirm button for keyboard navigation
    confirmBtn.focus();
  });
}

// Moved to shared/dashboard-config.js (Phase 2 S4) — OWNER INFO PAGE + BUILDING INTERNET CONFIG (contiguous) section
// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — LEASE REQUESTS QUEUE (Firestore leaseRequests) section

// Moved to shared/dashboard-config.js (Phase 2 S4) — LOGO MANAGEMENT (owner + apartment logo, includes _safeDataUrl orphan) section
// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — TENANT MASTER PAGE + LEASE AGREEMENTS PAGE + Document Hub (contiguous) section
// Moved to shared/dashboard-bills.js (Phase 2 S3) — UPLOAD REAL BILLS PAGE + BILL GENERATION SYSTEM (contiguous) section
// Moved to shared/dashboard-admin-ops.js (Phase 2 S5) — DEBUG CONSOLE HELPERS section
// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — ServiceProviders section
// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — CommunityEvents section
// Moved to shared/dashboard-config.js (Phase 2 S4) — COMMUNITY DOCUMENTS MANAGEMENT section
// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — PET REGISTRATION APPROVALS (collectionGroup pets) section

// LEASE RENEWAL ALERTS SETTINGS — removed 2026-05-19.
// The 'แจ้งเตือน' tab was superseded by the auto-notifier system; tier
// thresholds are now hardcoded in functions/remindLeaseExpiry.js (60/30/14/expired)
// and the list view moved to the ผู้เช่า tab via leaseNotifications/ subscription.
// initLeaseSettingsPage / loadAndRenderLeaseSettings / loadAndRenderLeaseExpirations
// / saveLeaseAlertSettings + their localStorage 'lease_alert_settings' deleted with
// the tab DOM (dashboard.html). See lifecycle_lease_action.md §Auto-notifier.

// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — RequestsStore + Complaints section
// Moved to shared/dashboard-config.js (Phase 2 S4) — GAMIFICATION PAGE + GAMIFICATION LIVE TOGGLE (contiguous) section
// Moved to shared/dashboard-config.js (Phase 2 S4) — POLICY ADMIN CRUD + REWARDS ADMIN CRUD (contiguous) section
// ===== REPORTS PAGE =====

// Moved to shared/dashboard-bills.js (Phase 2 S3) — BILLING IMPORT FUNCTIONS (Excel→Firestore pipeline) section
// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — HistoricalDataStore section
// ===== Listener cleanup =====
// ===== OWNER INSIGHTS PAGE =====
let _insightsCharts = {};
let _insightsUnsubs = [];
let _insightsTenantsCache = null;
let _insightsRenderTimer = null;

async function initInsightsPage() {
  const container = document.getElementById('insightsContainer');
  if (!container) return;

  // Tear down prior session: charts + listeners
  Object.values(_insightsCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  _insightsCharts = {};
  _insightsUnsubs.forEach(fn => { try { fn(); } catch(e){} });
  _insightsUnsubs = [];

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:1.5rem;">
      <span style="font-size:1.2rem;font-weight:700;">📊 Owner Insights</span>
      <span style="font-size:.78rem;color:var(--text-muted);padding:2px 8px;background:var(--green-pale);border-radius:20px;" id="ins-status">กำลังโหลด...</span>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">💰 อัตราการชำระเงิน (Collection Rate)</div>
      <div id="ins-collection-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div style="height:220px;position:relative;"><canvas id="ins-chart-collection"></canvas></div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">📈 Cash Flow Forecast (6 เดือนข้างหน้า)</div>
      <div id="ins-cashflow-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div style="height:220px;position:relative;"><canvas id="ins-chart-cashflow"></canvas></div>
      <div id="ins-lease-expiry-table" style="margin-top:1rem;"></div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">🔧 Complaint Resolution (MTTR)</div>
      <div id="ins-mttr-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div style="height:220px;position:relative;"><canvas id="ins-chart-mttr"></canvas></div>
      <div id="ins-hotspot-table" style="margin-top:1rem;"></div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">💵 Profit per Room (เดือนปัจจุบัน)</div>
      <div id="ins-profit-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div style="height:240px;position:relative;"><canvas id="ins-chart-profit"></canvas></div>
      <div id="ins-profit-table" style="margin-top:1rem;"></div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">🔄 Tenant Cohort Retention</div>
      <div id="ins-cohort-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div style="height:220px;position:relative;"><canvas id="ins-chart-cohort"></canvas></div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">⚠️ Meter Anomaly Detection (z-score &gt; 2σ)</div>
      <div id="ins-meter-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div id="ins-meter-table" style="margin-top:.5rem;"></div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:.5rem;">วิเคราะห์การใช้น้ำ/ไฟจากบิล 6 เดือนล่าสุด — ห้องที่ใช้สูงผิดปกติอาจมีน้ำรั่ว/มิเตอร์เสีย/ใช้จริงเพิ่ม</div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">⚙️ CF Health (LINE retry queue)</div>
      <div id="ins-cf-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.2rem;"></div>
      <div id="ins-cf-detail" style="font-size:.83rem;color:var(--text-muted);margin-bottom:1rem;"></div>
      <div style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem;">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:.5rem;">🎯 awardComplaintFreeMonth — Manual Dry Run</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem;">รัน dry-run ก่อน schedule 1 พ.ค. เพื่อตรวจสอบว่าจะ award ใครบ้างโดยไม่เขียน DB จริง</div>
        <button data-action="runAwardDryRun" style="padding:6px 14px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:.83rem;">🧪 Run Dry Run</button>
        <pre id="ins-award-dryrun-output" style="margin-top:.7rem;padding:.7rem;background:#f5f5f5;border-radius:6px;font-size:.75rem;max-height:240px;overflow:auto;display:none;white-space:pre-wrap;"></pre>
      </div>
    </div>
    <div class="card dx-mb">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:1rem;">🔐 Admin Operations</div>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:1rem;">เครื่องมือสำหรับจัดการสิทธิ์ admin/accountant — เรียก setAdminClaim CF ด้วย ID token ของคุณ</div>
      <div style="border:1px solid var(--border);border-radius:6px;padding:1rem;margin-bottom:1rem;">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:.5rem;">➕ Grant Admin / Accountant Role</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.6rem;">ตั้งค่า custom claim ให้ user ที่สมัครแล้ว (Firebase Auth บันทึกแล้ว แต่ระบบยังไม่ count เป็น admin จนกว่าจะ grant claim) — user ต้อง logout/login ใหม่หลัง grant เพื่อรับ token ใหม่</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
          <input type="email" id="ins-grant-email" placeholder="user@example.com" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun',sans-serif;font-size:.85rem;">
          <select id="ins-grant-role" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun',sans-serif;font-size:.85rem;">
            <option value="admin">admin</option>
            <option value="accountant">accountant</option>
          </select>
          <button data-action="grantAdminRole" style="padding:8px 14px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:.83rem;">Grant</button>
        </div>
        <div id="ins-grant-output" style="margin-top:.6rem;font-size:.78rem;"></div>
      </div>
      <div style="border:1px solid var(--border);border-radius:6px;padding:1rem;">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:.5rem;">🧹 Cleanup Anonymous Users</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.6rem;">ลบ anonymous user records ที่ไม่มี custom claims (guest ที่ยังไม่ link LINE) — ลูกบ้านที่ link LIFF แล้วมี claims {room,building} ไม่กระทบ ⚠️ ห้ามปิด Anonymous auth ใน Firebase Console เพราะ LIFF ยังต้องใช้</div>
        <button data-action="cleanupAnonUsers" style="padding:6px 14px;background:#e65100;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:.83rem;">🗑️ Delete Anonymous Users</button>
        <div id="ins-anon-output" style="margin-top:.6rem;font-size:.78rem;"></div>
      </div>
    </div>`;

  // Initial render with whatever cache we have
  _insightsTenantsCache = await _insightsLoadTenants();
  _insightsRenderAll();
  _insightsSetStatus(_insightsHasData() ? 'Live from SSoT' : 'รอข้อมูลจาก Firebase...');

  // Re-render when bills land/change (BillStore subscribes RTDB once)
  if (typeof BillStore !== 'undefined' && BillStore.onChange) {
    _insightsUnsubs.push(BillStore.onChange(() => _insightsScheduleRender()));
  }
  // Re-render when complaints land/change
  if (window.RequestsStore?.onChange) {
    _insightsUnsubs.push(window.RequestsStore.onChange('complaints', () => _insightsScheduleRender()));
  }
}

function _insightsHasData() {
  const beNow = new Date().getFullYear() + 543;
  const bills = BillStore.listAllForYear(String(beNow).slice(-2));
  return (bills && bills.length > 0) || (_insightsTenantsCache && _insightsTenantsCache.length > 0);
}

function _insightsSetStatus(msg) {
  const el = document.getElementById('ins-status');
  if (el) el.textContent = msg;
}

function _insightsScheduleRender() {
  // Debounce — RTDB onValue can fire twice in quick succession (rooms then nest)
  clearTimeout(_insightsRenderTimer);
  _insightsRenderTimer = setTimeout(() => {
    _insightsRenderAll();
    if (_insightsHasData()) _insightsSetStatus('Live from SSoT');
  }, 150);
}

function _insightsRenderAll() {
  const beNow = new Date().getFullYear() + 543;
  const allBills = [
    ...BillStore.listAllForYear(String(beNow).slice(-2)),
    ...BillStore.listAllForYear(String(beNow - 1).slice(-2))
  ];
  const allComplaints = window.RequestsStore?.getComplaints() || [];
  const tenants = _insightsTenantsCache || [];

  _insightsRenderCollection(allBills);
  _insightsRenderCashFlow(tenants);
  _insightsRenderMTTR(allComplaints);
  _insightsRenderProfit(allBills, tenants);
  _insightsRenderCohort(tenants);
  _insightsRenderMeterAnomaly(allBills, tenants);
  // CF health is async (Firestore query) — fire and forget
  _insightsRenderCFHealth().catch(e => console.warn('CF health:', e));
}

async function _insightsLoadTenants() {
  try {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return [];
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const [snapR, snapN] = await Promise.all([
      fs.getDocs(fs.collection(db, 'tenants/rooms/list')),
      fs.getDocs(fs.collection(db, 'tenants/nest/list'))
    ]);
    const out = [];
    snapR.docs.forEach(d => { const t = d.data(); if (t.name) out.push({ ...t, _building: 'rooms', _roomId: d.id }); });
    snapN.docs.forEach(d => { const t = d.data(); if (t.name) out.push({ ...t, _building: 'nest', _roomId: d.id }); });
    return out;
  } catch(e) {
    console.warn('insightsLoadTenants:', e);
    return [];
  }
}

function _insightsKpiCard(label, value, sub, color) {
  const c = color || 'var(--green-dark)';
  return `<div style="background:var(--green-pale);border-radius:var(--radius-sm);padding:.9rem 1rem;">
    <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:3px;">${label}</div>
    <div style="font-size:1.45rem;font-weight:700;color:${c};">${value}</div>
    ${sub ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">${sub}</div>` : ''}
  </div>`;
}

function _insightsMonthLabels(count, fromNow) {
  const now = new Date();
  const months = [];
  for (let i = fromNow ? 0 : -(count - 1); i <= (fromNow ? count - 1 : 0); i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      label: d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }),
      year: d.getFullYear(), month: d.getMonth() + 1,
      beY: String(d.getFullYear() + 543).slice(-2),
      monthEnd: new Date(d.getFullYear(), d.getMonth() + 1, 0)
    });
  }
  return months;
}

function _insightsRenderCollection(bills) {
  const months = _insightsMonthLabels(6, false);
  const real = bills.filter(b => !BillStore.isSynthetic(b));

  const rates = months.map(({ beY, month }) => {
    const mb = real.filter(b => String(b.year).slice(-2) === beY && Number(b.month) === month);
    if (!mb.length) return null;
    return Math.round(mb.filter(b => BillStore.isPaid(b)).length / mb.length * 100);
  });

  const curr = months[months.length - 1];
  const currBills = real.filter(b => String(b.year).slice(-2) === curr.beY && Number(b.month) === curr.month);
  const currPaid = currBills.filter(b => BillStore.isPaid(b)).length;
  const currRate = currBills.length ? Math.round(currPaid / currBills.length * 100) : null;
  const overdue = currBills.filter(b => !BillStore.isPaid(b));
  const overdueAmt = overdue.reduce((s, b) => s + Number(b.totalAmount || b.total || 0), 0);

  const allLast6 = real.filter(b => months.some(({ beY, month }) =>
    String(b.year).slice(-2) === beY && Number(b.month) === month
  ));
  const overallPaid = allLast6.filter(b => BillStore.isPaid(b)).length;
  const overallRate = allLast6.length ? Math.round(overallPaid / allLast6.length * 100) : null;

  document.getElementById('ins-collection-kpis').innerHTML =
    _insightsKpiCard('อัตรารวม 6 เดือน', overallRate !== null ? overallRate + '%' : '—', `${overallPaid}/${allLast6.length} บิล`) +
    _insightsKpiCard('เดือนนี้', currRate !== null ? currRate + '%' : '—',
      `${currPaid}/${currBills.length} ห้อง`,
      currRate === null ? undefined : currRate >= 90 ? 'var(--green-dark)' : currRate >= 70 ? '#e65100' : '#c62828') +
    _insightsKpiCard('ค้างชำระ (เดือนนี้)', '฿' + overdueAmt.toLocaleString(), `${overdue.length} ห้อง`, overdue.length > 0 ? '#c62828' : 'var(--green-dark)');

  const ctx = document.getElementById('ins-chart-collection');
  if (!ctx) return;
  if (_insightsCharts.collection) { try { _insightsCharts.collection.destroy(); } catch(e){} }
  _insightsCharts.collection = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        label: 'อัตราชำระ (%)',
        data: rates,
        backgroundColor: rates.map(r => r === null ? '#e0e0e0' : r >= 90 ? 'rgba(45,136,45,0.75)' : r >= 70 ? 'rgba(230,81,0,0.7)' : 'rgba(198,40,40,0.7)'),
        borderRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#f0f0f0' } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.raw !== null ? c.raw + '%' : 'ไม่มีข้อมูล' } }
      }
    }
  });
}

function _insightsRenderCashFlow(tenants) {
  const months = _insightsMonthLabels(6, true);
  const now = new Date();

  const projected = months.map(({ year, month, monthEnd }) =>
    tenants.reduce((s, t) => {
      if (!t.contractEnd || new Date(t.contractEnd) < new Date(year, month - 1, 1)) return s;
      return s + Number(t.rentPrice || 0);
    }, 0)
  );
  const atRisk = months.map(({ year, month, monthEnd }) =>
    tenants.reduce((s, t) => {
      if (!t.contractEnd) return s;
      const end = new Date(t.contractEnd);
      if (end >= new Date(year, month - 1, 1) && end <= monthEnd) return s + Number(t.rentPrice || 0);
      return s;
    }, 0)
  );

  const exp30 = tenants.filter(t => { if (!t.contractEnd) return false; const d = (new Date(t.contractEnd) - now) / 86400000; return d >= 0 && d <= 30; });
  const exp90 = tenants.filter(t => { if (!t.contractEnd) return false; const d = (new Date(t.contractEnd) - now) / 86400000; return d > 30 && d <= 90; });

  document.getElementById('ins-cashflow-kpis').innerHTML =
    _insightsKpiCard('รายรับที่คาด (เดือนนี้)', '฿' + projected[0].toLocaleString(), `${tenants.length} ห้องที่มีผู้เช่า`) +
    _insightsKpiCard('หมดสัญญา ≤30 วัน', exp30.length + ' ห้อง', exp30.map(t => (t._building === 'nest' ? 'N' : '') + t._roomId).join(', ') || '—', exp30.length > 0 ? '#c62828' : 'var(--green-dark)') +
    _insightsKpiCard('หมดสัญญา 31–90 วัน', exp90.length + ' ห้อง', exp90.map(t => (t._building === 'nest' ? 'N' : '') + t._roomId).join(', ') || '—', exp90.length > 0 ? '#e65100' : 'var(--green-dark)');

  const ctx = document.getElementById('ins-chart-cashflow');
  if (ctx) {
    if (_insightsCharts.cashflow) { try { _insightsCharts.cashflow.destroy(); } catch(e){} }
    _insightsCharts.cashflow = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          { label: 'รายรับที่คาด (฿)', data: projected.map((p, i) => p - atRisk[i]), backgroundColor: 'rgba(45,136,45,0.75)', borderRadius: 5, stack: 'a' },
          { label: 'ความเสี่ยง — สัญญาหมด (฿)', data: atRisk, backgroundColor: 'rgba(198,40,40,0.55)', borderRadius: 5, stack: 'a' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, ticks: { callback: v => '฿' + v.toLocaleString() }, grid: { color: '#f0f0f0' } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ฿' + Number(c.raw || 0).toLocaleString() } }
        }
      }
    });
  }

  const expiring = tenants
    .filter(t => t.contractEnd && (new Date(t.contractEnd) - now) / 86400000 <= 90 && (new Date(t.contractEnd) - now) / 86400000 >= -7)
    .sort((a, b) => new Date(a.contractEnd) - new Date(b.contractEnd));

  if (expiring.length) {
    const rows = expiring.map(t => {
      const diff = Math.ceil((new Date(t.contractEnd) - now) / 86400000);
      const color = diff <= 0 ? '#c62828' : diff <= 30 ? '#e65100' : '#1976d2';
      const badge = diff <= 0 ? '⚠️ หมดแล้ว' : diff + ' วัน';
      return `<tr>
        <td style="padding:5px 10px;font-weight:600;">${t._building === 'nest' ? 'N' : ''}${t._roomId}</td>
        <td class="dx-td-sm">${t.name || '—'}</td>
        <td class="dx-td-sm">${new Date(t.contractEnd).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
        <td style="padding:5px 10px;color:${color};font-weight:600;">${badge}</td>
        <td class="dx-td-sm">฿${Number(t.rentPrice || 0).toLocaleString()}</td>
      </tr>`;
    }).join('');
    document.getElementById('ins-lease-expiry-table').innerHTML = `
      <div style="font-weight:600;font-size:.82rem;margin-bottom:.5rem;color:var(--text-muted);">สัญญาหมดใน 90 วัน</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.83rem;">
        <thead><tr style="background:var(--green-pale);">
          <th class="dx-th-sm">ห้อง</th>
          <th class="dx-th-sm">ผู้เช่า</th>
          <th class="dx-th-sm">สิ้นสุด</th>
          <th class="dx-th-sm">เหลือ</th>
          <th class="dx-th-sm">ค่าเช่า</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }
}

function _insightsRenderMTTR(complaints) {
  const resolved = complaints.filter(c => c.status === 'resolved' && c.createdAt && c.updatedAt);
  const mttrs = resolved.map(c => (new Date(c.updatedAt) - new Date(c.createdAt)) / 86400000);
  const avgMttr = mttrs.length ? parseFloat((mttrs.reduce((s, v) => s + v, 0) / mttrs.length).toFixed(1)) : null;
  const open = complaints.filter(c => c.status === 'open' || c.status === 'in-progress');

  const byRoom = {};
  complaints.forEach(c => { const k = String(c.room || 'unknown'); byRoom[k] = (byRoom[k] || 0) + 1; });
  const hotspots = Object.entries(byRoom).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  document.getElementById('ins-mttr-kpis').innerHTML =
    _insightsKpiCard('MTTR เฉลี่ย', avgMttr !== null ? avgMttr + ' วัน' : '—',
      `จาก ${resolved.length} เคสที่แก้แล้ว`,
      avgMttr === null ? undefined : avgMttr <= 3 ? 'var(--green-dark)' : avgMttr <= 7 ? '#e65100' : '#c62828') +
    _insightsKpiCard('เปิดอยู่', open.length + ' เคส', 'open + in-progress', open.length > 0 ? '#e65100' : 'var(--green-dark)') +
    _insightsKpiCard('ห้องที่มีปัญหาซ้ำ', hotspots.length + ' ห้อง',
      hotspots.slice(0, 3).map(([r, n]) => `${r}(${n})`).join(' · ') || '—',
      hotspots.length > 0 ? '#e65100' : 'var(--green-dark)');

  const months = _insightsMonthLabels(6, false);
  const monthlyMttr = months.map(({ year, month }) => {
    const mc = resolved.filter(c => {
      const d = new Date(c.updatedAt);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    if (!mc.length) return null;
    return parseFloat((mc.reduce((s, c) => s + (new Date(c.updatedAt) - new Date(c.createdAt)) / 86400000, 0) / mc.length).toFixed(1));
  });

  const ctx = document.getElementById('ins-chart-mttr');
  if (ctx) {
    if (_insightsCharts.mttr) { try { _insightsCharts.mttr.destroy(); } catch(e){} }
    _insightsCharts.mttr = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: 'MTTR (วัน)',
          data: monthlyMttr,
          backgroundColor: monthlyMttr.map(v => v === null ? '#e0e0e0' : v <= 3 ? 'rgba(45,136,45,0.75)' : v <= 7 ? 'rgba(230,81,0,0.7)' : 'rgba(198,40,40,0.7)'),
          borderRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, ticks: { callback: v => v + 'd' }, grid: { color: '#f0f0f0' } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => c.raw !== null ? c.raw + ' วัน' : 'ไม่มีข้อมูล' } }
        }
      }
    });
  }

  if (hotspots.length) {
    const rows = hotspots.slice(0, 10).map(([room, count]) => {
      const latest = complaints.filter(c => String(c.room) === room).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      const s = latest?.status || '—';
      const color = s === 'resolved' ? 'var(--green-dark)' : s === 'in-progress' ? '#1976d2' : '#e65100';
      return `<tr>
        <td style="padding:5px 10px;font-weight:600;">ห้อง ${room}</td>
        <td class="dx-td-sm">${count} เคส</td>
        <td style="padding:5px 10px;color:${color};">${s}</td>
      </tr>`;
    }).join('');
    document.getElementById('ins-hotspot-table').innerHTML = `
      <div style="font-weight:600;font-size:.82rem;margin-bottom:.5rem;color:var(--text-muted);">ห้องที่มีการร้องเรียนซ้ำ (≥2 ครั้ง)</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.83rem;">
        <thead><tr style="background:var(--green-pale);">
          <th class="dx-th-sm">ห้อง</th>
          <th class="dx-th-sm">จำนวน</th>
          <th class="dx-th-sm">สถานะล่าสุด</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }
}

// ===== Insight #7: Profit per Room =====
// revenue (paid bills, current month) − expenses (current month, room-attributed)
// Note: maintenance/housekeeping costs are not stored per-room, so we attribute
// expense_data entries by `room` field. Cross-building rooms with same number
// (e.g. "13") will fold together — building scope is a TODO when expenses gain a
// building field.
function _insightsRenderProfit(bills, tenants) {
  const now = new Date();
  const beY = String(now.getFullYear() + 543).slice(-2);
  const m = now.getMonth() + 1;
  const real = bills.filter(b => !BillStore.isSynthetic(b));
  const monthBills = real.filter(b => String(b.year).slice(-2) === beY && Number(b.month) === m);

  let expenses = [];
  try { expenses = JSON.parse(localStorage.getItem('expense_data') || '[]'); } catch(e) {}
  const monthExp = expenses.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() + 1 === m;
  });

  const expByRoom = {};
  let unattributed = 0;
  monthExp.forEach(e => {
    const room = String(e.room || '').trim();
    const amt = Number(e.amount) || 0;
    if (!room || room === '-' || room.toLowerCase() === 'all') unattributed += amt;
    else expByRoom[room] = (expByRoom[room] || 0) + amt;
  });

  const revByRoom = {};
  monthBills.forEach(b => {
    if (!BillStore.isPaid(b)) return;
    const k = String(b.room);
    revByRoom[k] = (revByRoom[k] || 0) + Number(b.totalAmount || b.total || 0);
  });

  const allRooms = new Set([...Object.keys(revByRoom), ...Object.keys(expByRoom), ...tenants.map(t => String(t._roomId))]);
  const rows = Array.from(allRooms).map(r => {
    const rev = revByRoom[r] || 0;
    const cost = expByRoom[r] || 0;
    return { room: r, rev, cost, profit: rev - cost };
  }).filter(x => x.rev > 0 || x.cost > 0).sort((a, b) => b.profit - a.profit);

  const totalRev = rows.reduce((s, x) => s + x.rev, 0);
  const totalCost = rows.reduce((s, x) => s + x.cost, 0) + unattributed;
  const netProfit = totalRev - totalCost;
  const margin = totalRev > 0 ? Math.round(netProfit / totalRev * 100) : null;

  document.getElementById('ins-profit-kpis').innerHTML =
    _insightsKpiCard('รายรับ (เดือนนี้)', '฿' + totalRev.toLocaleString(), `${rows.filter(x => x.rev > 0).length} ห้องชำระแล้ว`) +
    _insightsKpiCard('ค่าใช้จ่าย', '฿' + totalCost.toLocaleString(), unattributed > 0 ? `รวมไม่ระบุห้อง ฿${unattributed.toLocaleString()}` : 'แยกตามห้อง', '#e65100') +
    _insightsKpiCard('กำไรสุทธิ', '฿' + netProfit.toLocaleString(), margin !== null ? `Margin ${margin}%` : '—',
      netProfit < 0 ? '#c62828' : netProfit < totalRev * 0.3 ? '#e65100' : 'var(--green-dark)');

  const ctx = document.getElementById('ins-chart-profit');
  if (ctx) {
    if (_insightsCharts.profit) { try { _insightsCharts.profit.destroy(); } catch(e){} }
    const top = rows.slice(0, 12);
    _insightsCharts.profit = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(x => x.room),
        datasets: [
          { label: 'รายรับ (฿)', data: top.map(x => x.rev), backgroundColor: 'rgba(45,136,45,0.75)', borderRadius: 4 },
          { label: 'ค่าใช้จ่าย (฿)', data: top.map(x => x.cost), backgroundColor: 'rgba(198,40,40,0.55)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { ticks: { callback: v => '฿' + v.toLocaleString() }, grid: { color: '#f0f0f0' } } },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ฿' + Number(c.raw || 0).toLocaleString() } }
        }
      }
    });
  }

  // Underperformers: profit margin < 50%
  const underPerf = rows.filter(x => x.rev > 0 && (x.rev - x.cost) / x.rev < 0.5).slice(0, 8);
  if (underPerf.length) {
    const trs = underPerf.map(x => {
      const mgn = x.rev > 0 ? Math.round((x.rev - x.cost) / x.rev * 100) : 0;
      return `<tr>
        <td style="padding:5px 10px;font-weight:600;">ห้อง ${x.room}</td>
        <td class="dx-td-sm">฿${x.rev.toLocaleString()}</td>
        <td style="padding:5px 10px;color:#c62828;">฿${x.cost.toLocaleString()}</td>
        <td style="padding:5px 10px;font-weight:600;color:${mgn < 0 ? '#c62828' : '#e65100'};">${mgn}%</td>
      </tr>`;
    }).join('');
    document.getElementById('ins-profit-table').innerHTML = `
      <div style="font-weight:600;font-size:.82rem;margin-bottom:.5rem;color:var(--text-muted);">ห้องที่ Margin ต่ำ (&lt;50%)</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.83rem;">
        <thead><tr style="background:var(--green-pale);">
          <th class="dx-th-sm">ห้อง</th>
          <th class="dx-th-sm">รายรับ</th>
          <th class="dx-th-sm">ค่าใช้จ่าย</th>
          <th class="dx-th-sm">Margin</th>
        </tr></thead><tbody>${trs}</tbody>
      </table></div>`;
  } else {
    document.getElementById('ins-profit-table').innerHTML = '';
  }
}

// ===== Insight #3: Tenant Cohort Retention =====
// Bucketed by move-in year. Currently we only have active leases via
// tenants/{b}/list/, so this is a snapshot view: which years' move-ins are
// still here, average tenancy length to date. Move-out tracking would need
// historical leases — not yet wired.
function _insightsRenderCohort(tenants) {
  const now = new Date();
  const active = tenants.filter(t => t.moveInDate);

  // Group by move-in year (Buddhist year for display, CE for math)
  const byYear = {};
  active.forEach(t => {
    const d = new Date(t.moveInDate);
    if (isNaN(d)) return;
    const ce = d.getFullYear();
    const beLabel = (ce + 543).toString().slice(-2);
    if (!byYear[ce]) byYear[ce] = { ce, beLabel, count: 0, totalDays: 0 };
    byYear[ce].count++;
    byYear[ce].totalDays += (now - d) / 86400000;
  });
  const years = Object.values(byYear).sort((a, b) => a.ce - b.ce);

  const totalDays = active.reduce((s, t) => s + (now - new Date(t.moveInDate)) / 86400000, 0);
  const avgMonths = active.length ? (totalDays / active.length / 30).toFixed(1) : '—';
  const stillHere = active.length;
  const longTenure = active.filter(t => (now - new Date(t.moveInDate)) / 86400000 > 365).length;

  document.getElementById('ins-cohort-kpis').innerHTML =
    _insightsKpiCard('ผู้เช่าปัจจุบัน', stillHere + ' ห้อง', 'มีข้อมูล move-in') +
    _insightsKpiCard('Tenancy เฉลี่ย', avgMonths + ' เดือน', 'นับถึงวันนี้') +
    _insightsKpiCard('อยู่นานกว่า 1 ปี', longTenure + ' ห้อง',
      stillHere ? `${Math.round(longTenure / stillHere * 100)}% ของผู้เช่าปัจจุบัน` : '—');

  const ctx = document.getElementById('ins-chart-cohort');
  if (ctx) {
    if (_insightsCharts.cohort) { try { _insightsCharts.cohort.destroy(); } catch(e){} }
    _insightsCharts.cohort = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years.map(y => 'ปี ' + y.beLabel),
        datasets: [{
          label: 'ผู้เช่าที่ยังอยู่ (ห้อง)',
          data: years.map(y => y.count),
          backgroundColor: 'rgba(45,136,45,0.75)',
          borderRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, grid: { color: '#f0f0f0' } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            afterLabel: c => {
              const y = years[c.dataIndex];
              const avgM = (y.totalDays / y.count / 30).toFixed(1);
              return `Tenancy เฉลี่ย ${avgM} เดือน`;
            }
          }}
        }
      }
    });
  }
}

// ===== Insight #2: Meter Anomaly Detection =====
// z-score on per-room consumption from bills (bills already include
// electricityUsage + waterUsage, no need to query meter_data separately).
// Flags rooms with z > 2 in the most recent month. 6-month rolling baseline.
function _insightsRenderMeterAnomaly(bills, tenants) {
  const real = bills.filter(b => !BillStore.isSynthetic(b));
  const now = new Date();
  // Bucket bills per room over last 6 months
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ beY: String(d.getFullYear() + 543).slice(-2), m: d.getMonth() + 1 });
  }

  const byRoom = {}; // room → [{m, elec, water}, ...]
  real.forEach(b => {
    const inWin = months.some(({ beY, m }) => String(b.year).slice(-2) === beY && Number(b.month) === m);
    if (!inWin) return;
    const room = String(b.room);
    if (!byRoom[room]) byRoom[room] = [];
    byRoom[room].push({
      ym: String(b.year).slice(-2) + '-' + String(b.month).padStart(2, '0'),
      elec: Number(b.electricityUsage || 0),
      water: Number(b.waterUsage || 0),
      building: b.building
    });
  });

  const latest = months[months.length - 1];
  const latestKey = latest.beY + '-' + String(latest.m).padStart(2, '0');

  const anomalies = [];
  Object.entries(byRoom).forEach(([room, hist]) => {
    if (hist.length < 3) return; // need at least 3 for meaningful z-score
    const cur = hist.find(h => h.ym === latestKey);
    if (!cur) return;
    const past = hist.filter(h => h.ym !== latestKey);
    if (past.length < 2) return;

    ['elec', 'water'].forEach(metric => {
      const past_vals = past.map(h => h[metric]);
      const mean = past_vals.reduce((s, v) => s + v, 0) / past_vals.length;
      const variance = past_vals.reduce((s, v) => s + (v - mean) ** 2, 0) / past_vals.length;
      const sd = Math.sqrt(variance);
      if (sd < 1) return; // too flat, σ ~0 makes z explode
      const z = (cur[metric] - mean) / sd;
      if (Math.abs(z) > 2) {
        anomalies.push({
          room, metric, z, current: cur[metric], baseline: Math.round(mean),
          building: cur.building,
          direction: z > 0 ? 'spike' : 'drop'
        });
      }
    });
  });

  anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  const elecHigh = anomalies.filter(a => a.metric === 'elec' && a.z > 0).length;
  const waterHigh = anomalies.filter(a => a.metric === 'water' && a.z > 0).length;
  const totalRoomsAnalyzed = Object.keys(byRoom).filter(r => byRoom[r].length >= 3).length;

  document.getElementById('ins-meter-kpis').innerHTML =
    _insightsKpiCard('ห้องที่วิเคราะห์ได้', totalRoomsAnalyzed + ' ห้อง', '≥3 เดือนใน 6 เดือนล่าสุด') +
    _insightsKpiCard('ไฟใช้สูงผิดปกติ', elecHigh + ' ห้อง', 'z > 2 (เดือนนี้)', elecHigh > 0 ? '#e65100' : 'var(--green-dark)') +
    _insightsKpiCard('น้ำใช้สูงผิดปกติ', waterHigh + ' ห้อง', 'z > 2 (เดือนนี้) — เช็คน้ำรั่ว', waterHigh > 0 ? '#c62828' : 'var(--green-dark)');

  const tEl = document.getElementById('ins-meter-table');
  if (anomalies.length) {
    const trs = anomalies.slice(0, 10).map(a => {
      const icon = a.metric === 'elec' ? '⚡' : '💧';
      const dirIcon = a.direction === 'spike' ? '📈' : '📉';
      const color = a.direction === 'spike' ? '#c62828' : '#1976d2';
      const tn = tenants.find(t => String(t._roomId) === a.room && t._building === a.building);
      const roomLabel = (a.building === 'nest' ? 'N' : '') + a.room;
      return `<tr>
        <td style="padding:5px 10px;font-weight:600;">${icon} ${roomLabel}</td>
        <td class="dx-td-sm">${tn?.name || '—'}</td>
        <td class="dx-td-sm">${a.current} <span style="color:#999;">(ปกติ ~${a.baseline})</span></td>
        <td style="padding:5px 10px;color:${color};font-weight:600;">${dirIcon} z=${a.z.toFixed(1)}</td>
      </tr>`;
    }).join('');
    tEl.innerHTML = `
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.83rem;">
        <thead><tr style="background:var(--green-pale);">
          <th class="dx-th-sm">ห้อง</th>
          <th class="dx-th-sm">ผู้เช่า</th>
          <th class="dx-th-sm">การใช้ (เดือนนี้)</th>
          <th class="dx-th-sm">z-score</th>
        </tr></thead><tbody>${trs}</tbody>
      </table></div>`;
  } else {
    tEl.innerHTML = `<div style="padding:1rem;text-align:center;color:var(--green-dark);font-size:.85rem;">✅ ไม่พบความผิดปกติ — ทุกห้องใช้ในช่วงปกติ</div>`;
  }
}

// ===== Insight #8: CF Health Board (LINE retry queue) =====
async function _insightsRenderCFHealth() {
  const kEl = document.getElementById('ins-cf-kpis');
  const dEl = document.getElementById('ins-cf-detail');
  if (!kEl || !dEl) return;

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    kEl.innerHTML = _insightsKpiCard('—', '—', 'Firebase ยังไม่พร้อม');
    return;
  }
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;

  let snap;
  try {
    snap = await fs.getDocs(fs.collection(db, 'lineRetryQueue'));
  } catch(e) {
    kEl.innerHTML = _insightsKpiCard('CF Health', '—', 'อ่านไม่ได้: ' + (e.code || e.message), '#c62828');
    return;
  }

  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const cutoff7d = Date.now() - 7 * 86400000;
  const recent = items.filter(i => {
    const ts = new Date(i.createdAt || 0).getTime();
    return ts >= cutoff7d;
  });

  const pending = items.filter(i => i.status === 'pending').length;
  const sent = recent.filter(i => i.status === 'sent').length;
  const abandoned = recent.filter(i => i.status === 'abandoned').length;
  const settled = sent + abandoned;
  const successRate = settled > 0 ? Math.round(sent / settled * 100) : null;

  const sentItems = recent.filter(i => i.status === 'sent' && i.attempts != null);
  const avgAttempts = sentItems.length ? (sentItems.reduce((s, i) => s + (i.attempts || 0), 0) / sentItems.length).toFixed(1) : '—';

  kEl.innerHTML =
    _insightsKpiCard('Success rate (7 วัน)', successRate !== null ? successRate + '%' : '—',
      `${sent} sent / ${abandoned} abandoned`,
      successRate === null ? undefined : successRate >= 95 ? 'var(--green-dark)' : successRate >= 80 ? '#e65100' : '#c62828') +
    _insightsKpiCard('Queue depth', pending + ' items', 'pending ตอนนี้', pending > 50 ? '#c62828' : pending > 10 ? '#e65100' : 'var(--green-dark)') +
    _insightsKpiCard('Attempts ก่อน success', avgAttempts, sentItems.length ? `จาก ${sentItems.length} รายการ` : '—');

  // Detail: oldest pending + recent abandoned
  const oldestPending = items.filter(i => i.status === 'pending')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))[0];
  const lines = [];
  if (oldestPending) {
    const age = Math.round((Date.now() - new Date(oldestPending.createdAt).getTime()) / 60000);
    lines.push(`⏳ <strong>Oldest pending:</strong> ${age} นาที (attempts ${oldestPending.attempts || 0}/5)`);
  }
  if (abandoned > 0) {
    const recentAbandoned = recent.filter(i => i.status === 'abandoned')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 3);
    lines.push(`🚫 <strong>Abandoned (7d):</strong> ${abandoned} รายการ — ตัวอย่าง user: ${recentAbandoned.map(i => (i.lineUserId || '?').slice(-6)).join(', ')}`);
  }
  if (!lines.length) lines.push('✅ ไม่มี pending ค้าง — CF retry queue ทำงานปกติ');
  dEl.innerHTML = lines.join('<br>');
}

// Moved to shared/dashboard-admin-ops.js (Phase 2 S5) — ADMIN UTILITY CFs (grantAdminRole + cleanupAnonUsers + runAwardComplaintFreeMonthDryRun) section


// Detaches every long-lived Firestore onSnapshot subscription this file
// owns. Called on `beforeunload` so the listeners don't keep firing on
// the server side after the admin closes the dashboard. Safe to call
// multiple times — each unsub becomes a no-op once invoked.
function cleanupAdminListeners() {
  const unsubs = [
    ['_leaseRequestsUnsub', window._leaseRequestsUnsub],
    ['_docsUnsub', window._docsUnsub],
    ['_petsUnsub', window._petsUnsub],
    ['_rewardsAdminUnsub', window._rewardsAdminUnsub],
    ['_RequestsStoreComplaintsUnsub', window._RequestsStoreComplaintsUnsub],
    ['_gamificationConfigUnsub', window._gamificationConfigUnsub]
  ];
  for (const [name, fn] of unsubs) {
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.warn('cleanup', name, 'threw:', e?.message || e); }
    }
  }
  _insightsUnsubs.forEach(fn => { try { fn(); } catch(e) {} });
  _insightsUnsubs = [];
}
window.cleanupAdminListeners = cleanupAdminListeners;
window.addEventListener('beforeunload', cleanupAdminListeners);

