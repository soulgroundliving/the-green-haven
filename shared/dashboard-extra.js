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

// Update room statuses when tenant data changes
window.updateRoomStatuses = updateRoomStatuses;

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

// Update occupancy and lease alerts when room statuses are updated
const originalUpdateRoomStatuses = window.updateRoomStatuses;
window.updateRoomStatuses = function() {
  originalUpdateRoomStatuses();
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

// ===== OWNER INFO PAGE =====
function initOwnerInfoPage() {
  renderOwnerInfoPage();
}

function renderOwnerInfoPage() {
  const container = document.getElementById('ownerInfoContainer');
  if (!container) return;

  const owner = OwnerConfigManager.getOwnerInfo();
  const safeLogoUrl = _safeDataUrl(owner.logoDataUrl || '');
  const safeApartmentLogoUrl = _safeDataUrl(owner.apartmentLogoDataUrl || '');
  const safeFaviconUrl = _safeDataUrl(owner.faviconDataUrl || '');

  container.innerHTML = `
    <!-- Company identity (used in tax report letterhead) -->
    <div style="background:#f8faf9; padding:1.2rem; border-left:4px solid var(--green); border-radius:6px; margin-bottom:1.5rem;">
      <div style="font-weight:700; color:var(--green-dark); margin-bottom:.6rem;">🏢 ข้อมูลบริษัท / นิติบุคคล (สำหรับใบเสร็จ + รายงานภาษี)</div>

      <!-- Company logo (B2B — used when tenant chooses "นิติบุคคล") -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="logoPreviewBox" style="width:80px; height:80px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeLogoUrl ? `<img src="${safeLogoUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="company logo">` : `<span style="font-size:2rem; color:#ccc;">🏢</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">โลโก้บริษัท (ใช้บนบิลที่ลูกบ้านเลือก "นิติบุคคล" + รายงานภาษี)</label>
          <input type="file" id="ownerLogoInput" accept="image/png,image/jpeg" onchange="uploadOwnerLogo(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: PNG โปร่งแสง, สี่เหลี่ยมจัตุรัส, ≤ 512px</div>
          ${safeLogoUrl ? `<button type="button" onclick="removeOwnerLogo()" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบโลโก้</button>` : ''}
        </div>
      </div>

      <!-- Apartment logo (B2C / default — used when tenant chooses "บุคคลธรรมดา") -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="apartmentLogoPreviewBox" style="width:80px; height:80px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeApartmentLogoUrl ? `<img src="${safeApartmentLogoUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="apartment logo">` : `<span style="font-size:2rem; color:#ccc;">🌿</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">โลโก้อพาร์ทเม้น (ใช้บนบิลที่ลูกบ้านเลือก "บุคคลธรรมดา" — default)</label>
          <input type="file" id="ownerApartmentLogoInput" accept="image/png,image/jpeg" onchange="uploadApartmentLogo(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: โลโก้แบรนด์ Nature Haven — PNG โปร่งแสง, สี่เหลี่ยมจัตุรัส, ≤ 512px. ถ้าไม่อัพ → fallback เป็น "🌿 Nature Haven"</div>
          ${safeApartmentLogoUrl ? `<button type="button" onclick="removeApartmentLogo()" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบโลโก้อพาร์ทเม้น</button>` : ''}
        </div>
      </div>

      <!-- Favicon upload -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="faviconPreviewBox" style="width:48px; height:48px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${safeFaviconUrl ? `<img src="${safeFaviconUrl}" style="width:32px; height:32px; object-fit:contain;" alt="favicon">` : `<span style="font-size:1.4rem; color:#ccc;">🌐</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">ไอคอนแท็บเบราว์เซอร์ (Favicon)</label>
          <input type="file" id="ownerFaviconInput" accept="image/png,image/jpeg,image/x-icon" onchange="uploadOwnerFavicon(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: PNG สี่เหลี่ยมจัตุรัส — จะย่อเป็น 64×64 อัตโนมัติ</div>
          ${safeFaviconUrl ? `<button type="button" onclick="removeOwnerFavicon()" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบ favicon</button>` : ''}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาไทย)</label>
          <input type="text" id="companyLegalNameTH" value="${(owner.companyLegalNameTH || 'บริษัท เดอะ กรีนเฮฟเว่น จำกัด').replace(/"/g,'&quot;')}" placeholder="บริษัท เดอะ กรีนเฮฟเว่น จำกัด" class="dx-field-sm">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาอังกฤษ)</label>
          <input type="text" id="companyLegalNameEN" value="${(owner.companyLegalNameEN || 'The Green Haven Co., Ltd.').replace(/"/g,'&quot;')}" placeholder="The Green Haven Co., Ltd." class="dx-field-sm">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">สถานะการจดทะเบียน</label>
          <select id="registrationStatus" class="dx-field-sm">
            <option value="active" ${owner.registrationStatus !== 'pending' ? 'selected' : ''}>✅ จดทะเบียนแล้ว</option>
            <option value="pending" ${owner.registrationStatus === 'pending' ? 'selected' : ''}>⏳ อยู่ระหว่างจดทะเบียน</option>
          </select>
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ประเภทเอกสารที่แสดงในรายงาน</label>
          <select id="ownerEntityType" class="dx-field-sm">
            <option value="personal" ${owner.entityType !== 'company' ? 'selected' : ''}>บุคคลธรรมดา (ภ.ง.ด.90)</option>
            <option value="company" ${owner.entityType === 'company' ? 'selected' : ''}>นิติบุคคล (ภ.ง.ด.50)</option>
          </select>
        </div>
      </div>
      <small style="display:block; margin-top:.6rem; color:var(--text-muted); font-size:.8rem;">
        ค่าเหล่านี้จะแสดงใน letterhead ของรายงานภาษี (Tax Filing) + ใบเสร็จลูกบ้าน อัตโนมัติ
      </small>
    </div>

    <!-- 👤 Owner personal info — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.5rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        👤 ข้อมูลเจ้าของ / ผู้จัดทำ
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">ชื่อ-นามสกุล *</label>
          <input type="text" id="ownerName" value="${owner.name || ''}" placeholder="ชื่อเจ้าของ" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขประจำตัวประชาชน *</label>
          <input type="text" id="ownerIdCard" value="${owner.idCardNumber || ''}" placeholder="เลขประจำตัวประชาชน" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เบอร์โทรศัพท์</label>
          <input type="tel" id="ownerPhone" value="${owner.phone || ''}" placeholder="เบอร์โทรศัพท์" maxlength="10" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
          <small id="ownerPhoneError" style="display:none;color:#d32f2f;font-size:0.85rem;margin-top:4px;"></small>
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">อีเมล</label>
          <input type="email" id="ownerEmail" value="${owner.email || ''}" placeholder="อีเมล" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- 🏠 Address — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.2rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        🏠 ที่อยู่ตามทะเบียน
      </div>
      <div style="margin-bottom:1rem;">
        <label class="dx-label" style="font-size:1rem; font-weight:600;">ที่อยู่ (เลขที่ / หมู่ / ซอย / ถนน)</label>
        <input type="text" id="ownerAddress" value="${owner.address || ''}" placeholder="เช่น 123/45 หมู่ 3 ถนนรัชดาภิเษก" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">แขวง/ตำบล</label>
          <input type="text" id="ownerSubDistrict" value="${owner.subDistrict || ''}" placeholder="แขวง/ตำบล" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เขต/อำเภอ</label>
          <input type="text" id="ownerDistrict" value="${owner.district || ''}" placeholder="เขต/อำเภอ" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">จังหวัด</label>
          <input type="text" id="ownerProvince" value="${owner.province || ''}" placeholder="จังหวัด" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">รหัสไปรษณีย์</label>
          <input type="text" id="ownerPostalCode" value="${owner.postalCode || ''}" placeholder="รหัสไปรษณีย์" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- 🏦 Bank + tax — grouped card -->
    <div style="background:#fff; padding:1.4rem; border:1px solid var(--border); border-radius:8px; margin-top:1.2rem;">
      <div style="font-weight:700; font-size:1.05rem; color:var(--green-dark); margin-bottom:1rem; padding-bottom:.6rem; border-bottom:1px solid var(--border);">
        🏦 ธนาคาร & ภาษี
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:1.2rem;">
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขประจำตัวผู้เสียภาษี</label>
          <input type="text" id="ownerTaxId" value="${owner.taxId || ''}" placeholder="เลขประจำตัวผู้เสียภาษี" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
          <small style="display:block; color:var(--text-muted); font-size:.8rem; margin-top:.3rem;">บุคคลธรรมดา = เลขบัตร 13 หลัก / นิติบุคคล = เลขจดทะเบียน 13 หลัก</small>
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">ชื่อธนาคาร</label>
          <input type="text" id="ownerBankName" value="${owner.bankName || ''}" placeholder="เช่น ไทยพาณิชย์ / กสิกร" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
        <div>
          <label class="dx-label" style="font-size:1rem; font-weight:600;">เลขบัญชี</label>
          <input type="text" id="ownerBankAccount" value="${owner.bankAccount || ''}" placeholder="เลขบัญชีธนาคาร" class="dx-field" style="font-size:1rem; padding:.7rem .8rem;">
        </div>
      </div>
    </div>

    <!-- Action buttons — Save primary, Delete subtle outlined -->
    <div style="margin-top: 2rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
      <button onclick="saveOwnerInfo()" style="padding: 0.9rem 2.2rem; background: var(--green); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 1.05rem; box-shadow: 0 2px 8px rgba(76,175,80,.25);">
        💾 บันทึกข้อมูล
      </button>
      <button onclick="clearOwnerInfo()" style="padding: 0.9rem 1.5rem; background: transparent; color: #d32f2f; border: 1.5px solid #ef9a9a; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: .95rem;">
        🗑️ ลบข้อมูล
      </button>
      <small style="color:var(--text-muted); font-size:.85rem; margin-left:auto;">* คือฟิลด์ที่จำเป็นสำหรับรายงานภาษี</small>
    </div>

    <!-- Per-building Internet Status (subscribed by tenant_app displayBuildingInternetStatus) -->
    <hr style="margin: 2.5rem 0 1.5rem; border: none; border-top: 1px solid var(--border);">
    <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: .25rem;">🌐 สถานะอินเทอร์เน็ตอาคาร</div>
    <div style="font-size: .85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
      ตั้งค่าสถานะเน็ต/ผู้ให้บริการ/ความเร็ว แยกตามตึก — ลูกบ้านจะเห็น status จริงในหน้า Services.
      <br>เก็บที่ Firestore <code>buildings/{rooms|nest}.internet</code> (real-time ผ่าน onSnapshot)
    </div>
    <div id="buildingInternetConfigContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
      <div style="text-align:center;color:var(--text-muted);padding:1rem;grid-column:span 2;">กำลังโหลด...</div>
    </div>

  `;
  // Lazy-load building internet config (after Firebase ready). Payment config
  // (PromptPay/companyName/ownerName) lives in the Buildings page since 2026-05-14
  // consolidation — see CLAUDE.md §7-T.
  if (typeof renderBuildingInternetConfig === 'function') renderBuildingInternetConfig();
}

// ===== BUILDING INTERNET CONFIG (per-building ISP + status + speed) =====
// Same pattern as payment config: writes buildings/{canonicalId}.internet (merged)
// where canonicalId ∈ {rooms, nest, ...} from BuildingRegistry (Tier 3F dynamic).
// Tenant_app subscribes via displayBuildingInternetStatus onSnapshot.
async function renderBuildingInternetConfig() {
  const container = document.getElementById('buildingInternetConfigContainer');
  if (!container) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    container.innerHTML = '<div style="color:#c62828;text-align:center;padding:1rem;grid-column:span 2;">Firestore unavailable</div>';
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const [rrSnap, nestSnap] = await Promise.all([
    fs.getDoc(fs.doc(db, 'buildings', 'rooms')).catch(() => null),
    fs.getDoc(fs.doc(db, 'buildings', 'nest')).catch(() => null)
  ]);
  const rr = rrSnap?.exists() ? (rrSnap.data().internet || {}) : {};
  const nest = nestSnap?.exists() ? (nestSnap.data().internet || {}) : {};
  const esc = s => String(s ?? '').replace(/"/g, '&quot;');
  const statusOpt = (cur, v, lbl) => `<option value="${v}"${cur === v ? ' selected' : ''}>${lbl}</option>`;
  const cardHtml = (label, fsId, data) => `
    <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1.25rem; background: #fafafa;">
      <div style="font-weight: 700; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <span>${label}</span>
        <span style="font-size: .72rem; color: var(--text-muted); font-family: monospace;">buildings/${fsId}.internet</span>
      </div>
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">สถานะ</label>
      <select id="bi-${fsId}-status" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;font-family:Sarabun,sans-serif;">
        ${statusOpt(data.status, 'online', '🟢 เชื่อมต่อแล้ว')}
        ${statusOpt(data.status, 'maintenance', '🟡 กำลังบำรุงรักษา')}
        ${statusOpt(data.status, 'offline', '🔴 ไม่เชื่อมต่อ')}
      </select>
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">ผู้ให้บริการ</label>
      <input type="text" id="bi-${fsId}-provider" value="${esc(data.provider)}" placeholder="เช่น True Internet" class="dx-field-sm-mb">
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">เบอร์ติดต่อ</label>
      <input type="tel" id="bi-${fsId}-contact" value="${esc(data.contact)}" placeholder="เช่น 1686" class="dx-field-sm-mb">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:1rem;">
        <div>
          <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Download</label>
          <input type="text" id="bi-${fsId}-download" value="${esc(data.downloadSpeed)}" placeholder="500 Mbps" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Upload</label>
          <input type="text" id="bi-${fsId}-upload" value="${esc(data.uploadSpeed)}" placeholder="500 Mbps" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
        </div>
      </div>
      <button onclick="saveBuildingInternetConfig('${fsId}')" style="width:100%;padding:.65rem;background:#4caf50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun,sans-serif;">💾 บันทึก ${label}</button>
    </div>
  `;
  container.innerHTML = cardHtml('🏠 ห้องแถว', 'rooms', rr) + cardHtml('🏢 Nest', 'nest', nest);
}

async function saveBuildingInternetConfig(fsId) {
  if (!['rooms', 'nest'].includes(fsId)) return;
  const status = document.getElementById(`bi-${fsId}-status`)?.value || 'online';
  const provider = document.getElementById(`bi-${fsId}-provider`)?.value?.trim() || '';
  const contact = document.getElementById(`bi-${fsId}-contact`)?.value?.trim() || '';
  const downloadSpeed = document.getElementById(`bi-${fsId}-download`)?.value?.trim() || '';
  const uploadSpeed = document.getElementById(`bi-${fsId}-upload`)?.value?.trim() || '';
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('Firestore ไม่พร้อม', 'error');
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'buildings', fsId), {
      internet: {
        status, provider, contact, downloadSpeed, uploadSpeed,
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });
    showToast(`✅ บันทึกสถานะเน็ต ${fsId === 'rooms' ? 'ห้องแถว' : 'Nest'} แล้ว`, 'success');
  } catch (e) {
    console.error('saveBuildingInternetConfig failed:', e);
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.renderBuildingInternetConfig = renderBuildingInternetConfig;
  window.saveBuildingInternetConfig = saveBuildingInternetConfig;
}

// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — LEASE REQUESTS QUEUE (Firestore leaseRequests) section

// Accepts only data:image/* base64 URLs so arbitrary strings can never reach the DOM or storage.
function _safeDataUrl(v) {
  if (typeof v !== 'string' || v === '') return '';
  return /^data:image\/(png|jpeg|webp|x-icon);base64,[A-Za-z0-9+/=\r\n]+$/.test(v) ? v : '';
}

// Low-level logo write that bypasses name-required validation in OwnerConfigManager.saveOwnerInfo.
// Needed because users may upload a logo before filling in the owner name.
function _writeOwnerLogo(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, logoDataUrl: safe };
  // Direct localStorage write (no name check)
  localStorage.setItem('owner_info', JSON.stringify(updated));
  // Best-effort Firestore sync (if signed in)
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('logo Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('logo sync:', e?.message); }
}

window.uploadOwnerLogo = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 2MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = file.type !== 'image/jpeg'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
      _writeOwnerLogo(dataUrl);
      showToast('✅ อัปโหลดโลโก้เรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeOwnerLogo = function() {
  window.ghConfirm('ลบโลโก้บริษัท?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeOwnerLogo('');
    showToast('ลบโลโก้แล้ว', 'success');
    renderOwnerInfoPage();
  });
};

// ===== APARTMENT LOGO (used on personal-recipient bills, default brand-friendly) =====
function _writeApartmentLogo(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, apartmentLogoDataUrl: safe };
  localStorage.setItem('owner_info', JSON.stringify(updated));
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('apartment logo Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('apartment logo sync:', e?.message); }
}

window.uploadApartmentLogo = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 2MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = file.type !== 'image/jpeg'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
      _writeApartmentLogo(dataUrl);
      showToast('✅ อัปโหลดโลโก้อพาร์ทเม้นเรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeApartmentLogo = function() {
  window.ghConfirm('ลบโลโก้อพาร์ทเม้น?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeApartmentLogo('');
    showToast('ลบโลโก้อพาร์ทเม้นแล้ว', 'success');
    renderOwnerInfoPage();
  });
};

function _writeOwnerFavicon(dataUrl) {
  const safe = _safeDataUrl(dataUrl);
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, faviconDataUrl: safe };
  localStorage.setItem('owner_info', JSON.stringify(updated));
  try {
    if (window.firebase && window.firebaseAuth?.currentUser) {
      const db = window.firebase.firestore();
      const fn = window.firebase.firestoreFunctions;
      const ref = fn.doc(fn.collection(db, 'owner_info'), 'main');
      fn.setDoc(ref, { ...updated, updatedAt: new Date().toISOString() }, { merge: true })
        .catch(e => console.warn('favicon Firestore sync:', e?.message));
    }
  } catch(e) { console.warn('favicon sync:', e?.message); }
}

window.uploadOwnerFavicon = function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 1 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 1MB', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 64;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      // Crop centre-square before scaling so non-square images don't stretch.
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
      const dataUrl = canvas.toDataURL('image/png');
      _writeOwnerFavicon(dataUrl);
      OwnerConfigManager.applyFavicon(dataUrl);
      showToast('✅ อัปโหลด favicon เรียบร้อย', 'success');
      renderOwnerInfoPage();
    };
    img.onerror = () => showToast('อ่านรูปไม่ได้ — ลองไฟล์อื่น', 'warning');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'warning');
  reader.readAsDataURL(file);
};

window.removeOwnerFavicon = function() {
  window.ghConfirm('ลบ favicon?', { danger: true }).then(ok => {
    if (!ok) return;
    _writeOwnerFavicon('');
    OwnerConfigManager.applyFavicon('');
    showToast('ลบ favicon แล้ว', 'success');
    renderOwnerInfoPage();
  });
};

function saveOwnerInfo() {
  const name = document.getElementById('ownerName').value.trim();
  if (!name) {
    showToast('กรุณากรอกชื่อเจ้าของ', 'warning');
    return;
  }

  const existing = OwnerConfigManager.getOwnerInfo();

  const ownerData = {
    // Preserve existing logo + favicon (uploaded separately)
    logoDataUrl: existing.logoDataUrl || '',
    faviconDataUrl: existing.faviconDataUrl || '',
    // ===== COMPANY IDENTITY (used in tax report letterhead + tenant receipts) =====
    companyLegalNameTH: document.getElementById('companyLegalNameTH')?.value?.trim() || '',
    companyLegalNameEN: document.getElementById('companyLegalNameEN')?.value?.trim() || '',
    registrationStatus: document.getElementById('registrationStatus')?.value || 'active',
    entityType: document.getElementById('ownerEntityType')?.value || 'personal',
    // ===== BASIC INFO =====
    name: name,
    idCardNumber: document.getElementById('ownerIdCard').value.trim(),
    phone: document.getElementById('ownerPhone').value.trim(),
    email: document.getElementById('ownerEmail').value.trim(),
    address: document.getElementById('ownerAddress').value.trim(),
    subDistrict: document.getElementById('ownerSubDistrict').value.trim(),
    district: document.getElementById('ownerDistrict').value.trim(),
    province: document.getElementById('ownerProvince').value.trim(),
    postalCode: document.getElementById('ownerPostalCode').value.trim(),

    // ===== TAX & BANKING =====
    taxId: document.getElementById('ownerTaxId').value.trim(),
    bankName: document.getElementById('ownerBankName').value.trim(),
    bankAccount: document.getElementById('ownerBankAccount').value.trim(),

    // ===== ACCOUNTING INFO =====
    operationStartDate: document.getElementById('ownerOperationStartDate')?.value?.trim() || '',
    businessType: document.getElementById('ownerBusinessType')?.value || 'residential_rental',
    businessCategory: document.getElementById('ownerBusinessCategory')?.value?.trim() || ''
  };

  // Use Firebase-enabled save if available
  if (typeof OwnerConfigManager.saveOwnerInfoWithFirebase === 'function') {
    OwnerConfigManager.saveOwnerInfoWithFirebase(ownerData);
  } else {
    OwnerConfigManager.saveOwnerInfo(ownerData);
  }
  showToast('บันทึกข้อมูลเจ้าของสำเร็จ', 'success');
  renderOwnerInfoPage();
}

function clearOwnerInfo() {
  window.ghConfirm('ลบข้อมูลเจ้าของทั้งหมด? การดำเนินการนี้กู้คืนไม่ได้', { danger: true }).then(ok => {
    if (!ok) return;
    OwnerConfigManager.clearOwnerInfo();
    showToast('ลบข้อมูลเรียบร้อย', 'success');
    renderOwnerInfoPage();
  });
}

// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — TENANT MASTER PAGE + LEASE AGREEMENTS PAGE + Document Hub (contiguous) section
// Moved to shared/dashboard-bills.js (Phase 2 S3) — UPLOAD REAL BILLS PAGE + BILL GENERATION SYSTEM (contiguous) section
// ===== DEBUG CONSOLE HELPERS =====
// UI removed — call these from DevTools console. They return the data so you
// can chain (e.g. `debugShowMaintenance().filter(r => r.priority === 'high')`).
function debugShowMaintenance() {
  const data = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
  console.log('🔍 maintenance_data (' + data.length + ' items):', data);
  return data;
}

function debugShowAnnouncements() {
  const data = JSON.parse(localStorage.getItem('announcements_data') || '[]');
  console.log('🔍 announcements_data (' + data.length + ' items):', data);
  return data;
}

function debugShowAllKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const size = new Blob([localStorage.getItem(key)]).size;
    keys.push({ key, size: size + ' bytes' });
  }
  console.log('🔍 All localStorage keys (' + keys.length + '):', keys);
  return keys;
}

// Expose on window so they're invokable from devtools console
if (typeof window !== 'undefined') {
  window.debugShowMaintenance = debugShowMaintenance;
  window.debugShowAnnouncements = debugShowAnnouncements;
  window.debugShowAllKeys = debugShowAllKeys;
}

// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — ServiceProviders section
// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — CommunityEvents section
// ===== COMMUNITY DOCUMENTS MANAGEMENT =====
// §7-CC: _docsUnsub window-attached so cleanupAdminListeners + future extracted
// dashboard-config.js can read it cross-script.
window._docsUnsub = null;
let _docsCache = null; // null = not yet hydrated from Firestore; falls back to localStorage

function initCommunityDocsPage() {
  loadAndRenderCommunityDocs();
  if (window._docsUnsub) return;
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const col = fs.collection(db, 'communityDocuments');
    window._docsUnsub = fs.onSnapshot(col, snap => {
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const local = _docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]');
      const byId = new Map();
      local.forEach(d => byId.set(d.id, d));
      remote.forEach(d => byId.set(d.id, d)); // Firestore wins on id collision
      _docsCache = Array.from(byId.values());
      localStorage.setItem('community_documents_data', JSON.stringify(_docsCache));
      loadAndRenderCommunityDocs();
    }, err => console.warn('docs onSnapshot failed:', err));
  } catch(e) { console.warn('docs subscribe failed:', e); }
}

function loadAndRenderCommunityDocs() {
  const list = document.getElementById('docsList');
  if (!list) return;

  let docs = (_docsCache ?? JSON.parse(localStorage.getItem('community_documents_data') || '[]')).slice();
  const searchVal = document.getElementById('docSearch')?.value.toLowerCase() || '';

  if (searchVal) {
    docs = docs.filter(d =>
      d.title.toLowerCase().includes(searchVal) ||
      d.category.toLowerCase().includes(searchVal)
    );
  }

  // Group by category
  const grouped = {};
  docs.forEach(d => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  if (docs.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No documents added</div>';
    return;
  }

  list.innerHTML = Object.entries(grouped).map(([category, items]) => `
    <div style="margin-bottom: 2rem;">
      <div style="font-weight: 700; font-size: 0.95rem; color: var(--green-dark); margin-bottom: 1rem; border-bottom: 2px solid var(--green-pale); padding-bottom: 0.5rem;">📑 ${category}</div>
      ${items.map(d => `
        <div class="card" style="margin-bottom: 1rem; border-left: 4px solid #1976d2;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1;">
              <div style="font-weight: 700;">📄 ${d.title}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Type: <strong>${d.fileType || '-'}</strong></div>
              ${d.description ? `<div style="font-size: 0.9rem; margin-top: 0.5rem;">${d.description}</div>` : ''}
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <a href="${d.fileUrl}" target="_blank" class="compact-btn compact-btn-view">📥 View</a>
              <button onclick="deleteDocument('${d.id}')" class="compact-btn compact-btn-delete">🗑️</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function toggleAddDocForm() {
  const form = document.getElementById('addDocForm');
  if (!form) return;
  form.classList.toggle('u-hidden');
  if (!form.classList.contains('u-hidden')) {
    document.getElementById('docTitle').focus();
  }
}

async function saveCommunityDocument() {
  const title = document.getElementById('docTitle')?.value.trim();
  const category = document.getElementById('docCategory')?.value;
  let fileType = document.getElementById('docType')?.value.trim();
  let fileUrl = document.getElementById('docUrl')?.value.trim();
  const description = document.getElementById('docDescription')?.value.trim();
  const fileInput = document.getElementById('docFile');
  const file = fileInput?.files?.[0] || null;

  if (!title || !category) {
    showToast('กรุณากรอก Title และ Category', 'warning');
    return;
  }
  if (!file && !fileUrl) {
    showToast('กรุณาอัพไฟล์ หรือกรอก URL', 'warning');
    return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    showToast('ไฟล์ใหญ่เกิน 5 MB', 'warning');
    return;
  }

  const docId = 'doc_' + Date.now();

  // If admin uploaded a file: push to Firebase Storage, then use downloadURL.
  // Falls back to manually-entered URL when no file was selected.
  if (file && window.firebase?.storage && window.firebase?.storageFunctions) {
    try {
      showToast('📤 กำลังอัพโหลดไฟล์...', 'info');
      const storage = window.firebase.storage();
      const { ref: sRef, uploadBytes, getDownloadURL } = window.firebase.storageFunctions;
      // Sanitize filename — keep extension, strip path traversal
      const safeName = file.name.replace(/[^\w.฀-๿-]+/g, '_').slice(-80);
      const fileRef = sRef(storage, `communityDocuments/${docId}/${safeName}`);
      const snap = await uploadBytes(fileRef, file);
      fileUrl = await getDownloadURL(snap.ref);
      // Auto-detect fileType from extension if admin didn't fill it
      if (!fileType) {
        const ext = (safeName.split('.').pop() || '').toLowerCase();
        fileType = ext || (file.type.startsWith('image/') ? 'image' : 'file');
      }
    } catch (e) {
      console.error('Doc upload failed:', e);
      showToast('❌ อัพโหลดไม่สำเร็จ: ' + (e?.message || e), 'error');
      return;
    }
  }

  const newDoc = {
    id: docId,
    title: title,
    category: category,
    description: description,
    fileUrl: fileUrl,
    fileType: fileType,
    building: 'rooms',
    uploadedDate: new Date().toISOString()
  };

  // Optimistic update via in-memory cache; onSnapshot writes localStorage + confirms
  _docsCache = (_docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]')).concat(newDoc);

  // Firestore write must be awaited; previously fire-and-forget hid failures (§7-N silent failure).
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      await fs.setDoc(fs.doc(fs.collection(db, 'communityDocuments'), newDoc.id), newDoc);
    } catch(e) {
      console.warn('Firestore doc save failed:', e);
      // Roll back optimistic cache so UI doesn't lie about a successful save
      _docsCache = (_docsCache || []).filter(d => d.id !== newDoc.id);
      showToast('❌ บันทึกเอกสารไม่สำเร็จ: ' + (e?.message || e), 'error');
      return;
    }
  }

  ['docTitle', 'docCategory', 'docType', 'docUrl', 'docDescription'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const _fileInput = document.getElementById('docFile');
  if (_fileInput) _fileInput.value = '';

  toggleAddDocForm();
  loadAndRenderCommunityDocs();
  showToast('✅ Document added successfully', 'success');
}

function deleteDocument(id) {
  window.ghConfirm('ลบเอกสารนี้?', { danger: true }).then(ok => {
    if (!ok) return;
    // Optimistic update via in-memory cache; onSnapshot confirms
    _docsCache = (_docsCache || JSON.parse(localStorage.getItem('community_documents_data') || '[]')).filter(d => d.id !== id);
    if (window.firebase?.firestore) {
      try {
        const db = window.firebase.firestore();
        const fs = window.firebase.firestoreFunctions;
        fs.deleteDoc(fs.doc(fs.collection(db, 'communityDocuments'), id));
      } catch(e) { console.warn('Firestore doc delete failed:', e); }
    }
    loadAndRenderCommunityDocs();
    showToast('✅ Document deleted', 'success');
  });
}

// Moved to shared/dashboard-tenant-lease.js (Phase 2 S2) — PET REGISTRATION APPROVALS (collectionGroup pets) section

// LEASE RENEWAL ALERTS SETTINGS — removed 2026-05-19.
// The 'แจ้งเตือน' tab was superseded by the auto-notifier system; tier
// thresholds are now hardcoded in functions/remindLeaseExpiry.js (60/30/14/expired)
// and the list view moved to the ผู้เช่า tab via leaseNotifications/ subscription.
// initLeaseSettingsPage / loadAndRenderLeaseSettings / loadAndRenderLeaseExpirations
// / saveLeaseAlertSettings + their localStorage 'lease_alert_settings' deleted with
// the tab DOM (dashboard.html). See lifecycle_lease_action.md §Auto-notifier.

// Moved to shared/dashboard-domain-stores.js (2026-05-19 Phase 1 refactor) — RequestsStore + Complaints section
// ===== GAMIFICATION PAGE =====
async function initGamificationPage() {
  console.log('✅ Gamification page initialized');
  subscribeGamificationConfig();

  const tbody = document.getElementById('leaderboardTable');
  if (!tbody) return;

  // Build tenant list from TenantConfigManager across both buildings
  const roomsTenants = TenantConfigManager.getTenantList('rooms').map(t => ({ ...t, building: 'rooms' }));
  const nestTenants  = TenantConfigManager.getTenantList('nest').map(t => ({ ...t, building: 'nest' }));
  const allTenants   = [...roomsTenants, ...nestTenants];

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">กำลังโหลด…</td></tr>';
    window.addEventListener('firebaseInitialized', () => initGamificationPage(), { once: true });
    return;
  }

  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">กำลังโหลดข้อมูลจาก Firestore…</td></tr>';

  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();

  // Fetch the full per-building list collection in parallel rather than firing
  // one getDoc per tenant. Same Firestore document-read count, but two
  // network round-trips instead of N. With ~30 tenants the latency win is
  // small; main benefit is the cleaner pattern when the building grows.
  let dataByKey = new Map();
  try {
    const [roomsSnap, nestSnap] = await Promise.all([
      fs.getDocs(fs.collection(db, 'tenants/rooms/list')),
      fs.getDocs(fs.collection(db, 'tenants/nest/list'))
    ]);
    roomsSnap.forEach(d => dataByKey.set('rooms/' + d.id, d.data()));
    nestSnap.forEach(d => dataByKey.set('nest/' + d.id, d.data()));
  } catch (e) {
    console.warn('leaderboard: bulk tenant fetch failed, points will show 0:', e?.message || e);
  }

  const results = allTenants.map(t => {
    // Local TenantConfigManager exposes tenants by `roomId`. The legacy
    // `t.id`/`t.room` aliases were never populated, so the lookup always
    // missed and points/badges defaulted to 0 across the board.
    const roomId = t.roomId || t.id || t.room;
    const data = roomId ? (dataByKey.get(t.building + '/' + roomId) || {}) : {};
    return {
      ...t,
      roomId,
      // The canonical SSoT doc holds the tenant's display name; the local
      // config object only has room metadata. Prefer Firestore name fields.
      name: data.name || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : null) || t.name,
      points: data.gamification?.points || 0,
      badges: data.gamification?.badges || []
    };
  });

  // Drop vacant rooms — no tenant name means there's no one to rank.
  const scored = results
    .filter(t => t.name)
    .map(t => {
      const tier = window.GamificationRules
        ? window.GamificationRules.getLevelForPoints(t.points)
        : { emoji: '🌱', name: 'Seedling' };
      return { name: t.name, points: t.points, rank: `${tier.emoji} ${tier.name}`, badges: t.badges };
    })
    .sort((a, b) => b.points - a.points);

  if (scored.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีข้อมูลผู้เช่า</td></tr>';
    return;
  }

  tbody.innerHTML = scored.map((t, i) => `
    <tr>
      <td style="text-align:center;font-weight:700;">${i + 1}</td>
      <td>${t.name}</td>
      <td style="text-align:center;font-weight:600;">${t.points.toLocaleString()}</td>
      <td style="text-align:center;font-size:0.85rem;">${t.rank}</td>
    </tr>`).join('');

  // Cache for badge tab use
  window._gamificationScored = scored;
}

function switchGamificationTab(tabName, btn) {
  document.querySelectorAll('[id^="gamification"]').forEach(el => {
    el.classList.add('u-hidden');
    // Static HTML ships gamification tabs with inline display:none/block.
    // Clear the inline rule so the class controls visibility from now on.
    if (el.style.display) el.style.display = '';
  });
  const sel = document.getElementById('gamification' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (sel) {
    sel.classList.remove('u-hidden');
    if (sel.style.display) sel.style.display = '';
  }
  document.querySelectorAll('#page-gamification button').forEach(b => b.classList.remove('u-gamification-tab-active'));
  document.querySelectorAll('#page-gamification button').forEach(b => b.classList.add('u-gamification-tab'));
  btn.classList.add('u-gamification-tab-active');
  if (tabName === 'rewards' && typeof loadRewardsAdmin === 'function') loadRewardsAdmin();
  if (tabName === 'badges') loadBadgesAdmin();
}

// ===== GAMIFICATION LIVE TOGGLE =====
// §7-CC: _gamificationConfigUnsub window-attached so cleanupAdminListeners +
// future extracted dashboard-config.js can read it cross-script.
window._gamificationConfigUnsub = null;
function subscribeGamificationConfig() {
  if (window._gamificationConfigUnsub) return;
  if (!window.firebase?.firestoreFunctions) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    window._gamificationConfigUnsub = fs.onSnapshot(fs.doc(db, 'system', 'config'), snap => {
      const live = snap.exists() ? snap.data().gamificationLive === true : false;
      renderGamificationToggle(live);
    }, err => console.warn('gamificationConfig dashboard subscribe failed:', err.message));
  } catch(e) { console.warn('gamificationConfig subscribe init failed:', e.message); }
}
function renderGamificationToggle(live) {
  const btn = document.getElementById('gamificationToggleBtn');
  const status = document.getElementById('gamificationLiveStatus');
  if (!btn || !status) return;
  btn.dataset.state = live ? 'on' : 'off';
  btn.textContent = live ? '⏸ ปิด Gamification' : '🚀 เปิด Gamification';
  btn.style.background = live ? '#c62828' : 'var(--green-dark)';
  status.textContent = live
    ? '🟢 Live — ลูกบ้าน Nest เห็น gamification แล้ว'
    : '🔴 ปิดอยู่ (Pre-launch) — Coming Soon badges แสดงอยู่';
}
async function toggleGamification() {
  const btn = document.getElementById('gamificationToggleBtn');
  const goingLive = btn?.dataset.state !== 'on';
  const msg = goingLive
    ? 'เปิด Gamification ให้ลูกบ้าน Nest เห็น daily modal, badges, rewards?\nการเปลี่ยนแปลงมีผลทันที'
    : 'ปิด Gamification? ลูกบ้านจะเห็น Coming Soon badges อีกครั้ง';
  const ok = await window.ghConfirm(msg, { danger: !goingLive });
  if (!ok) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    if (typeof showToast === 'function') showToast('Firestore ไม่พร้อม', 'error');
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'config'),
      { gamificationLive: goingLive, gamificationUpdatedAt: new Date().toISOString() },
      { merge: true }
    );
    if (typeof showToast === 'function')
      showToast(goingLive ? '🚀 Gamification เปิดแล้ว' : '⏸ ปิด Gamification แล้ว', 'success');
  } catch(e) {
    console.error('toggleGamification failed:', e);
    if (typeof showToast === 'function') showToast('เปลี่ยนสถานะไม่สำเร็จ: ' + e.message, 'error');
  }
}
if (typeof window !== 'undefined') {
  window.toggleGamification = toggleGamification;
  window.subscribeGamificationConfig = subscribeGamificationConfig;
}

function loadBadgesAdmin() {
  const container = document.getElementById('gamificationBadgesContent');
  if (!container) return;

  const catalog = window.GamificationRules?.BADGE_CATALOG;
  if (!catalog) {
    container.innerHTML = '<p style="color:var(--text-muted)">ไม่พบ BADGE_CATALOG — โหลด shared/gamification-rules.js</p>';
    return;
  }

  const scored = window._gamificationScored || [];

  container.innerHTML = catalog.map(badge => {
    const earnedBy = scored.filter(t => Array.isArray(t.badges) && t.badges.some(b => (b.id || b) === badge.id));
    const count = earnedBy.length;
    return `
      <div style="background:var(--green-pale);border-radius:10px;padding:1rem;text-align:center;position:relative;">
        <div style="font-size:2rem;margin-bottom:.4rem;">${badge.emoji || '🏅'}</div>
        <div style="font-weight:700;font-size:.95rem;">${badge.label || badge.name || badge.id}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem;">≥ ${(badge.minPts || 0).toLocaleString()} pts</div>
        <div style="margin-top:.6rem;background:${count > 0 ? '#dcfce7' : '#f1f5f9'};color:${count > 0 ? '#166534' : '#64748b'};border-radius:20px;padding:2px 10px;font-size:.8rem;font-weight:600;display:inline-block;">
          ${count > 0 ? `${count} คน ได้รับแล้ว` : 'ยังไม่มีผู้รับ'}
        </div>
        ${count > 0 ? `<div style="margin-top:.4rem;font-size:.75rem;color:var(--text-muted);">${earnedBy.slice(0,3).map(t=>t.name).join(', ')}${count > 3 ? ` +${count-3}` : ''}</div>` : ''}
      </div>`;
  }).join('');
}

// ===== POLICY ADMIN CRUD (Firestore `system/policies`) =====
// Tenant app subscribes via _subscribePolicies() and renders sanitized HTML live.
// Admin UI is a contenteditable rich-text editor (shared/rich-text-policy.js).
async function loadPoliciesAdmin() {
  const KEYS = ['privacy', 'terms', 'compliance', 'ip'];
  const ID_MAP = {
    privacy: 'policy-privacy-content',
    terms:   'policy-terms-content',
    compliance: 'policy-compliance-content',
    ip:      'policy-ip-content'
  };

  // Mount editors immediately so the UI is responsive even if Firestore is slow
  // or the read fails. mountEditor is idempotent — content updates after fetch.
  KEYS.forEach(key => {
    const wrap = document.getElementById(`policy-admin-${key}`);
    if (!wrap || !window.RichTextPolicy?.mountEditor) return;
    if (wrap.dataset.rtMounted !== '1') {
      wrap._rtEditor = window.RichTextPolicy.mountEditor(wrap, '');
    }
  });

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    const snap = await fs.getDoc(fs.doc(db, 'system', 'policies'));
    const data = snap.exists() ? (snap.data() || {}) : {};

    const missing = KEYS.filter(k => !data[k]);
    if (missing.length) {
      try {
        const resp = await fetch('/tenant_app.html');
        const html = await resp.text();
        const parser = new DOMParser();
        const tenantDoc = parser.parseFromString(html, 'text/html');
        function _htmlToPlain(el) {
          el.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
          el.querySelectorAll('p,div').forEach(b => { if (b.nextSibling) b.insertAdjacentText('afterend', '\n'); });
          return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        }
        const seedData = {};
        missing.forEach(k => {
          const el = tenantDoc.getElementById(ID_MAP[k]);
          if (el) seedData[k] = _htmlToPlain(el);
        });
        if (Object.keys(seedData).length) {
          await fs.setDoc(fs.doc(db, 'system', 'policies'), seedData, { merge: true });
          Object.assign(data, seedData);
        }
      } catch(e) { console.warn('policy seed failed:', e.message); }
    }

    // Update editor content with fetched data (mount call is idempotent — re-mounting
    // just updates the contenteditable's innerHTML through _setContent).
    KEYS.forEach(key => {
      const wrap = document.getElementById(`policy-admin-${key}`);
      if (!wrap || !data[key]) return;
      if (window.RichTextPolicy?.mountEditor) {
        wrap._rtEditor = window.RichTextPolicy.mountEditor(wrap, data[key]);
      } else {
        wrap.textContent = data[key];
      }
    });
  } catch(e) { console.warn('loadPoliciesAdmin:', e.message); }
}

async function savePolicyDoc(key) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const wrap = document.getElementById(`policy-admin-${key}`);
  if (!wrap) return;
  // Editor mounted by rich-text-policy.js stores the contenteditable on `_rtEditor`.
  // Sanitize via the same helper tenant_app uses, so admin and tenant agree on output.
  const editor = wrap._rtEditor || wrap.querySelector('.rt-content');
  let content = '';
  if (editor && window.RichTextPolicy?.getContent) {
    content = window.RichTextPolicy.getContent(editor);
  } else if (wrap.value !== undefined) {
    content = String(wrap.value || '').trim();
  } else {
    content = (wrap.textContent || '').trim();
  }
  const btn = document.getElementById(`policy-save-${key}`);
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'policies'), { [key]: content }, { merge: true });
    if (btn) { btn.textContent = '✅ บันทึกแล้ว'; setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000); }
    if (typeof showToast === 'function') showToast('บันทึก Policy แล้ว — ลูกบ้านเห็นทันที', 'success');
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    if (typeof showToast === 'function') showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

// ===== REWARDS ADMIN CRUD (Firestore `rewards/` collection) =====
// §7-CC: _rewardsAdminUnsub window-attached so cleanupAdminListeners + future
// extracted dashboard-config.js can read it cross-script.
window._rewardsAdminUnsub = null;
let _rewardsAdminCache = [];

function loadRewardsAdmin() {
  if (window._rewardsAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const colRef = fs.collection(db, 'rewards');
  window._rewardsAdminUnsub = fs.onSnapshot(colRef, snap => {
    _rewardsAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
    renderRewardsAdminTable();
  }, err => {
    console.warn('rewards admin onSnapshot failed:', err);
    document.getElementById('rewardsAdminTable').innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c62828;padding:20px;">Failed to load: ${_esc(err.message)}</td></tr>`;
  });
}

function renderRewardsAdminTable() {
  const tbody = document.getElementById('rewardsAdminTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_rewardsAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">No rewards yet — click "+ Add Reward" to create one</td>';
    tbody.appendChild(tr);
    return;
  }
  // DOM API to avoid XSS — admin-controlled fields still escape to be safe
  const esc = s => String(s == null ? '' : s);
  _rewardsAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const tdOrder = document.createElement('td'); tdOrder.textContent = r.order || '—'; tr.appendChild(tdOrder);
    const tdIcon = document.createElement('td'); tdIcon.style.fontSize = '1.4rem'; tdIcon.textContent = r.icon || '🎁'; tr.appendChild(tdIcon);
    const tdName = document.createElement('td'); tdName.textContent = esc(r.name); tr.appendChild(tdName);
    const tdCost = document.createElement('td'); tdCost.textContent = Number(r.cost || 0).toLocaleString(); tr.appendChild(tdCost);
    const tdActive = document.createElement('td');
    tdActive.innerHTML = r.active === false
      ? '<span style="color:#c62828;font-weight:600;">No</span>'
      : '<span style="color:var(--green-dark);font-weight:600;">Yes</span>';
    tr.appendChild(tdActive);
    const tdQuota = document.createElement('td');
    tdQuota.className = 'u-text-sm u-color-muted';
    if (Number(r.monthlyQuota) > 0) {
      const quotaSpan = document.createElement('span');
      quotaSpan.style.cssText = 'display:inline-block;background:#fff3e0;color:#e65100;border:1px solid #ffb74d;border-radius:4px;padding:1px 6px;font-size:.78rem;font-weight:700;';
      quotaSpan.textContent = `🎯 ${r.monthlyQuota} ครั้ง/เดือน`;
      tdQuota.appendChild(quotaSpan);
    } else {
      tdQuota.textContent = '∞ ไม่จำกัด';
      tdQuota.style.color = 'var(--text-muted)';
    }
    tr.appendChild(tdQuota);
    const tdActions = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit'; editBtn.className = 'u-btn-tbl-edit';
    editBtn.addEventListener('click', () => openRewardEdit(r.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete'; delBtn.className = 'u-btn-tbl-del';
    delBtn.addEventListener('click', () => deleteReward(r.id, r.name));
    tdActions.appendChild(editBtn); tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

function openRewardEdit(rewardId) {
  const modal = document.getElementById('rewardEditModal');
  if (!modal) return;
  const isNew = !rewardId;
  document.getElementById('rewardEditTitle').textContent = isNew ? '+ Add Reward' : 'Edit Reward';
  document.getElementById('rewardEditId').value = rewardId || '';
  if (isNew) {
    document.getElementById('rewardEditName').value = '';
    document.getElementById('rewardEditCost').value = '';
    document.getElementById('rewardEditIcon').value = '🎁';
    document.getElementById('rewardEditOrder').value = (_rewardsAdminCache.length + 1);
    document.getElementById('rewardEditMonthlyQuota').value = 0;
    document.getElementById('rewardEditActive').checked = true;
  } else {
    const r = _rewardsAdminCache.find(x => x.id === rewardId);
    if (!r) return;
    document.getElementById('rewardEditName').value = r.name || '';
    document.getElementById('rewardEditCost').value = r.cost || '';
    document.getElementById('rewardEditIcon').value = r.icon || '🎁';
    document.getElementById('rewardEditOrder').value = r.order || 99;
    document.getElementById('rewardEditMonthlyQuota').value = Number(r.monthlyQuota || 0);
    document.getElementById('rewardEditActive').checked = r.active !== false;
  }
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');
}

function closeRewardEdit() {
  const modal = document.getElementById('rewardEditModal');
  if (!modal) return;
  modal.style.display = '';
  modal.classList.add('u-hidden');
}

async function saveReward() {
  const id = document.getElementById('rewardEditId').value;
  const name = document.getElementById('rewardEditName').value.trim();
  const cost = parseInt(document.getElementById('rewardEditCost').value, 10);
  const icon = document.getElementById('rewardEditIcon').value.trim() || '🎁';
  const order = parseInt(document.getElementById('rewardEditOrder').value, 10) || 99;
  const monthlyQuota = Math.max(0, parseInt(document.getElementById('rewardEditMonthlyQuota').value, 10) || 0);
  const active = document.getElementById('rewardEditActive').checked;
  if (!name || !cost || cost < 1) {
    window.ghAlert('กรุณากรอกชื่อและคะแนน (>0)', { title: 'ข้อมูลไม่ครบ' });
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    window.ghAlert('Firestore ไม่พร้อมใช้งาน', { title: 'ขัดข้อง' });
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const now = new Date().toISOString();
  // Removed `note` — quota-only mode. Tenant_app + CF auto-generate alert text.
  const data = { name, cost, icon, order, monthlyQuota, active, updatedAt: now };
  try {
    if (id) {
      await fs.updateDoc(fs.doc(db, 'rewards', id), data);
    } else {
      // Auto-generate id from name slug + timestamp suffix for stable URL-friendly key
      const slug = name.toLowerCase().replace(/[^\u0E00-\u0E7Fa-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
      const newId = `${slug}-${Date.now().toString(36)}`;
      await fs.setDoc(fs.doc(db, 'rewards', newId), { ...data, createdAt: now });
    }
    closeRewardEdit();
  } catch (e) {
    window.ghAlert('บันทึกไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

async function deleteReward(rewardId, rewardName) {
  const ok = await window.ghConfirm(`ลบของรางวัล "${rewardName}"? การดำเนินการนี้กู้คืนไม่ได้`, { danger: true });
  if (!ok) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    await fs.deleteDoc(fs.doc(db, 'rewards', rewardId));
  } catch (e) {
    window.ghAlert('ลบไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
}

// Expose for inline onclick handlers
if (typeof window !== 'undefined') {
  window.loadRewardsAdmin = loadRewardsAdmin;
  window.openRewardEdit = openRewardEdit;
  window.closeRewardEdit = closeRewardEdit;
  window.saveReward = saveReward;
  window.deleteReward = deleteReward;
}

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

// Grant admin/accountant custom claim to a user. Calls the deployed
// setAdminClaim CF with the current admin's ID token. Target user must
// already exist in Firebase Auth (signed up at least once). They need to
// log out + log back in for the new claim to appear in their token.
async function grantAdminRole() {
  const out = document.getElementById('ins-grant-output');
  const emailEl = document.getElementById('ins-grant-email');
  const roleEl = document.getElementById('ins-grant-role');
  if (!out || !emailEl || !roleEl) return;
  const email = (emailEl.value || '').trim();
  const role = roleEl.value || 'admin';
  if (!email || !email.includes('@')) {
    out.innerHTML = '<span style="color:#c62828;">❌ ใส่ email ที่ถูกต้อง</span>';
    return;
  }
  out.innerHTML = '⏳ กำลัง grant...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/setAdminClaim',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role })
      }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      out.innerHTML = `<span style="color:#c62828;">❌ ${json.error || res.statusText}</span>`;
      return;
    }
    out.innerHTML = `<span style="color:var(--green-dark);">✅ Granted <strong>${role}</strong> to <strong>${json.email}</strong> (uid: ${json.uid.slice(0, 12)}...)</span><br><span style="color:var(--text-muted);">⚠️ User ต้อง logout/login ใหม่ เพื่อรับ token ที่มี claim ใหม่</span>`;
    emailEl.value = '';
  } catch (e) {
    out.innerHTML = `<span style="color:#c62828;">❌ ${e.message}</span>`;
  }
}
window.grantAdminRole = grantAdminRole;

// Bulk-delete legacy anonymous user records (Firebase Auth users with
// providerData.length === 0). Anonymous provider must be disabled at the
// Firebase Console first — otherwise tenant_app would just create new
// anon users to replace the deleted ones. Calls cleanupAnonymousUsers CF.
async function cleanupAnonUsers() {
  const out = document.getElementById('ins-anon-output');
  if (!out) return;
  const ok = await window.ghConfirm('ลบ user records anon ทั้งหมด? ผู้ที่ link LINE แล้วไม่กระทบ — ลบเฉพาะ guest ที่ไม่เคย link', { danger: true });
  if (!ok) return;
  out.innerHTML = '⏳ กำลังลบ...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/cleanupAnonymousUsers',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + idToken } }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      out.innerHTML = `<span style="color:#c62828;">❌ ${json.error || res.statusText}</span>`;
      return;
    }
    out.innerHTML = `<span style="color:var(--green-dark);">✅ ลบ ${json.deleted} anonymous user records (สแกน ${json.scanned} users)</span>`;
  } catch (e) {
    out.innerHTML = `<span style="color:#c62828;">❌ ${e.message}</span>`;
  }
}
window.cleanupAnonUsers = cleanupAnonUsers;

// Trigger manual dry-run of awardComplaintFreeMonth CF. Shows what would be
// awarded without writing to DB. Use before the 1st-of-month schedule to verify.
async function runAwardComplaintFreeMonthDryRun() {
  const out = document.getElementById('ins-award-dryrun-output');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = '⏳ กำลังรัน...';
  try {
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Session หมดอายุ — login ใหม่');
    const res = await fetch(
      'https://asia-southeast1-the-green-haven.cloudfunctions.net/awardComplaintFreeMonthManual?dryRun=1',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + idToken } }
    );
    const j = await res.json();
    // Human-readable summary instead of raw JSON
    const [yr, mo] = (j.monthKey || '').split('-');
    const beYear = yr ? Number(yr) + 543 : '?';
    const monthThai = mo ? mo + '/' + beYear : j.monthKey || '?';
    const wouldAward = (j.wouldAward || []).join(', ') || '— ไม่มี';
    const complained = (j.complainedRooms || []).join(', ') || '— ไม่มี';
    out.textContent = [
      '✅ Dry run — เดือน ' + monthThai,
      '',
      '📊 สรุป:',
      '  จะได้รับ 40 แต้ม:      ' + (j.awarded ?? '?') + ' ห้อง',
      '  ข้ามเพราะรับแล้ว:     ' + (j.skippedAlreadyAwarded ?? '?') + ' ห้อง',
      '  ข้ามเพราะร้องเรียน:   ' + (j.skippedHadComplaint ?? '?') + ' ห้อง',
      '  ทั้งหมด Nest:         ' + (j.totalRooms ?? '?') + ' ห้อง  (ร้องเรียน ' + (j.complaintsLastMonth ?? '?') + ' ครั้ง)',
      '',
      '📋 ห้องที่จะได้แต้ม:',
      '  ' + wouldAward,
      '',
      '⚠️  ห้องที่ร้องเรียน:',
      '  ' + complained,
    ].join('\n');
  } catch (e) {
    out.textContent = '❌ Error: ' + e.message;
  }
}
window.runAwardComplaintFreeMonthDryRun = runAwardComplaintFreeMonthDryRun;


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

