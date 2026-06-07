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
    const user = window.firebaseAuth.currentUser;
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

    await window.firebaseAuthFunctions.reauthenticateWithCredential(user, credential);
    await window.firebaseAuthFunctions.updatePassword(user, newPassword);

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

// Canonical "occupied" predicate — shared between the Nest/Rooms stats card
// (calculateOccupancy) and the per-room grid renderers (getRoomColorStatus).
// Both checks read from the SSoT projection so a LIFF-linked tenant with no
// explicit name field, or a lease-derived name only, still counts as occupied
// in both surfaces. Prior to this helper, getRoomColorStatus checked only
// `tenant.name` while calculateOccupancy checked the full identity set, so
// the stats card and the room grid could disagree on occupancy counts.
window.hasTenantIdentity = function (t) {
  return !!(t && (t.name || t.firstName || t.lastName || t.linkedAuthUid || t.lease?.tenantName));
};

// ===== Room Color Status Function =====
function getRoomColorStatus(roomId, room) {
  const allTenants = loadTenants();
  const tenant = allTenants[roomId];

  // Vacant = gray
  if (!window.hasTenantIdentity(tenant)) {
    return { color: '#e0e0e0', icon: '⚪', label: 'ว่าง' };
  }

  // Check payment status
  const paymentStatus = getPaymentStatus(roomId);
  if (paymentStatus === 'overdue') {
    return { color: DashColors.RED_TEXT, icon: '🔴', label: 'ค้าง' };
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
  return { color: DashColors.GREEN_ACTIVE, icon: '🟢', label: 'มี' };
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
    <button data-action="closeNearestDataModal" style="background:${DashColors.SURFACE_GRAY};border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600;">✕ ปิด</button>
  `;

  // Content
  const content = document.createElement('div');
  content.className = 'u-modal-doc-body';

  // 4 possible shapes for contractDocument:
  //   a. 'data:application/pdf;base64,...'  — legacy Tab ผู้เช่า upload (Firestore)
  //   b. 'data:image/...'                   — legacy image, same path
  //   c. 'https://...' / 'http://...'       — signed/public URL (documentURLs.agreement era)
  //   d. 'leases/{b}/{r}/{leaseId}/...'     — Storage PATH only — current renewLease /
  //                                            transferTenant writers. Needs getDownloadURL.
  // Case (d) used to fall into the else branch and surface "ไม่สามารถแสดงไฟล์นี้"
  // even though the file was uploaded fine. Resolve to a download URL and render
  // by extension instead.
  const _renderInline = (url) => {
    const lower = String(url).split('?')[0].toLowerCase();
    if (lower.endsWith('.pdf') || /^data:application\/pdf/i.test(url)) {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.className = 'u-form-input u-iframe-full';
      content.appendChild(iframe);
    } else if (/^data:image|\.(jpe?g|png|gif|webp|bmp|heic|svg)$/i.test(lower) || /^data:image/i.test(url)) {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'u-img-contain';
      content.appendChild(img);
    } else {
      // Unknown extension — give the user a working link rather than a dead-end.
      content.innerHTML = `<p style="color:${DashColors.TEXT_MUTED};">ไม่สามารถแสดงตัวอย่างไฟล์ชนิดนี้ — ใช้ปุ่ม "ดาวน์โหลด" ด้านล่าง</p>
        <p style="margin-top:8px;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#2d8653;font-weight:600;">เปิดในแท็บใหม่ →</a></p>`;
    }
  };
  const docRef = tenant.contractDocument;
  if (typeof docRef === 'string' && /^https?:\/\//i.test(docRef)) {
    _renderInline(docRef);
  } else if (typeof docRef === 'string' && docRef.startsWith('data:')) {
    _renderInline(docRef);
  } else if (typeof docRef === 'string' && docRef.length > 0) {
    // Storage path (case d) — resolve via Firebase Storage SDK. Admin's read
    // grant on storage.rules lets getDownloadURL return a long-lived token URL.
    content.innerHTML = `<p style="color:${DashColors.TEXT_MUTED};">⏳ กำลังโหลดเอกสาร...</p>`;
    try {
      const storage = window.firebase.storage();
      const { ref: sRef, getDownloadURL } = window.firebase.storageFunctions;
      const fileRef = sRef(storage, docRef);
      getDownloadURL(fileRef)
        .then((url) => {
          // Stash for downloadContractAsFile fallback so its href is the
          // resolved URL, not the raw Storage path.
          tenant.contractDocumentResolvedUrl = url;
          content.innerHTML = '';
          _renderInline(url);
        })
        .catch((e) => {
          console.error('getDownloadURL failed for', docRef, e);
          content.innerHTML = `<p style="color:${DashColors.RED_DEEP};">โหลดเอกสารไม่สำเร็จ: ${_esc(e.message || String(e))}</p>`;
        });
    } catch (e) {
      console.error('Firebase Storage SDK not available:', e);
      content.innerHTML = `<p style="color:${DashColors.RED_DEEP};">Firebase Storage ยังไม่พร้อม</p>`;
    }
  } else {
    content.innerHTML = `<p style="color:${DashColors.TEXT_MUTED};">ไม่สามารถแสดงไฟล์นี้</p>`;
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

async function recordPayment(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenant = tenantData.tenants?.[roomId];

  if (!tenant || !tenant.name) {
    showToast('ไม่มีข้อมูลผู้เช่า', 'error');
    return;
  }

  const amount = await window.ghPrompt(`💰 บันทึกค่าเช่า — ห้อง ${roomId}\n\nชื่อผู้เช่า: ${tenant.name}\nค่าเช่า: ฿${tenant.rent?.toLocaleString() || '0'}\n\nกรุณาระบุจำนวนเงินที่ชำระ:`, '', { title: '💰 บันทึกค่าเช่า' });

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
  // "มีผู้เช่า" predicate lives in window.hasTenantIdentity so getRoomColorStatus
  // uses the same definition — keeps stats card and grid in lockstep.
  const tenantList = typeof TenantConfigManager !== 'undefined'
    ? (TenantConfigManager.getTenantList(building) || [])
    : [];
  const occupiedSet = new Set(
    tenantList.filter(window.hasTenantIdentity).map(t => String(t.roomId ?? t.id ?? ''))
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
  const { collection, onSnapshot, query, where } = window.firebase.firestoreFunctions;

  try {
    // meter_data grows per room × month × year (can reach thousands of docs). This
    // callback only pings updateDashboardLive() — it never reads the snapshot payload.
    // §7-AAA: a bare limit() watch returns docs doc-ID-ASCENDING (oldest first), so it
    // would watch the OLDEST N docs and miss the NEWEST writes (this month's meters) —
    // the very changes that warrant a refresh. Scope the watch to the current + previous
    // 2-digit-BE year instead (§7-E: `year` is 2-digit BE): bounded like the old cap, but
    // now firing on the writes that matter. Single-field `in` uses the automatic index —
    // no composite index. (billing-system.js keeps a per-building unbounded watch as the
    // primary refresh path; this is the secondary ping.)
    const _curBE = new Date().getFullYear() - 1957;            // 2026 → 69
    const _yearScope = [_curBE - 1, _curBE, String(_curBE - 1), String(_curBE)];
    const meterUnsubscribe = onSnapshot(
      query(collection(db, 'meter_data'), where('year', 'in', _yearScope)),
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
  console.info('✅ Real-time listeners stopped');
}

function setupAnnouncementListener() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    console.warn('Firebase not initialized, skipping announcement listeners');
    return;
  }
  if (realtimeListeners.announcements) return; // already subscribed

  const db = window.firebase.firestore();
  const { collection, onSnapshot, query, where } = window.firebase.firestoreFunctions;

  try {
    const unsub = onSnapshot(
      // Filter to banner docs server-side (was a full-collection subscription that
      // streamed every notice/event/banner and re-fired on every announcement write,
      // then dropped non-banners via the client .filter below). Same rendered result,
      // far fewer docs over the wire. Single-field equality → no composite index.
      query(collection(db, 'announcements'), where('type', '==', 'banner')),
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

    console.info('🔄 Initializing cloud data from Firebase...');

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

    console.info('✅ Cloud data initialization complete');
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
// bareword which non-strict global lookup resolves to THIS wrapper.
//
// Capture-before-reassign pattern: top-level `function updateRoomStatuses()`
// only creates the window property — it does NOT create a separate lexical
// binding in the script scope. Once `window.updateRoomStatuses = function(){}`
// reassigns, any bareword `updateRoomStatuses()` inside the wrapper resolves
// to the wrapper itself (via window) → INFINITE RECURSION (Phase 2 S6 trap).
// Capturing the original window value here freezes the reference to the
// L555 inner fn so the wrapper can call it without re-entry.
const _innerUpdateRoomStatuses = window.updateRoomStatuses;
window.updateRoomStatuses = function() {
  _innerUpdateRoomStatuses();
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
      <div style="font-size: 0.95rem; font-weight: 700; color: ${DashColors.ORANGE_DEEP};">${title}</div>
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
// ===== OWNER INSIGHTS PAGE =====
// Moved to shared/dashboard-owner-insights.js (Phase 2 S7, 2026-05-29)
// initInsightsPage, cleanupAdminListeners, all _insights* functions

