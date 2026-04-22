// ===== Password Change Modal Functions =====
function openChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'flex';
  document.getElementById('oldPassword').focus();
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'none';
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
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

  // Show dialog with option to view document
  if (tenant.contractDocument) {
    const viewDoc = confirm(contractInfo + '\n\n✅ มีไฟล์สัญญาอยู่\n\nคลิก "ตกลง" เพื่อแสดงเอกสาร');
    if (viewDoc) {
      showContractDocument(roomId, tenant);
    }
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

  if (!confirm('❓ คุณแน่ใจหรือว่าต้องการลบไฟล์สัญญา?\n\nการดำเนินการนี้ไม่สามารถยกเลิกได้')) {
    return;
  }

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
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    background: white;
    border-radius: 12px;
    max-width: 95%;
    max-height: 90%;
    width: 800px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px;
    border-bottom: 2px solid #f0f0f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  header.innerHTML = `
    <h2 style="margin:0;color:#333;">📄 สัญญาเช่า - ห้อง ${_esc(roomId)} (${_esc(tenant.name)})</h2>
    <button onclick="this.closest('[data-modal]').remove()" style="background:#f0f0f0;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600;">✕ ปิด</button>
  `;

  // Content
  const content = document.createElement('div');
  content.style.cssText = `
    flex: 1;
    overflow: auto;
    padding: 20px;
    background: #f9f9f9;
  `;

  // Check if it's a PDF or image
  if (tenant.contractDocument.startsWith('data:application/pdf')) {
    // Display PDF
    const iframe = document.createElement('iframe');
    iframe.src = tenant.contractDocument;
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    content.appendChild(iframe);
  } else if (tenant.contractDocument.startsWith('data:image')) {
    // Display image
    const img = document.createElement('img');
    img.src = tenant.contractDocument;
    img.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain;';
    content.appendChild(img);
  } else {
    content.innerHTML = '<p style="color:#666;">ไม่สามารถแสดงไฟล์นี้</p>';
  }

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 15px 20px;
    background: white;
    border-top: 1px solid #f0f0f0;
    display: flex;
    gap: 10px;
  `;
  const dlBtn = document.createElement('button');
  dlBtn.textContent = '⬇️ ดาวน์โหลด';
  dlBtn.style.cssText = 'flex:1;padding:12px;background:#1976d2;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
  dlBtn.addEventListener('click', () => downloadContractAsFile(roomId, tenant.name));
  const closeBtn2 = document.createElement('button');
  closeBtn2.textContent = 'ปิด';
  closeBtn2.style.cssText = 'flex:1;padding:12px;background:#f0f0f0;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
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
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const invoices = (tenantData.invoices || []).filter(inv => inv.roomId === roomId);

  if (invoices.length === 0) {
    showToast(`ไม่มีบิลสำหรับห้อง ${roomId}`, 'warning');
    return;
  }

  let billInfo = `📋 บิล — ห้อง ${roomId}\n\n`;
  invoices.forEach(inv => {
    const dueDate = new Date(inv.dueDate).toLocaleDateString('th-TH');
    const paidDate = inv.paidDate ? new Date(inv.paidDate).toLocaleDateString('th-TH') : '—';
    const status = inv.status === 'paid' ? '✅ จ่ายแล้ว' : '⏳ รอจ่าย';
    billInfo += `${dueDate} | ฿${inv.amount.toLocaleString()} | ${status} | ${paidDate}\n`;
  });

  showToast(billInfo, 'warning');
}

function reportMaintenance(roomId) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenant = tenantData.tenants?.[roomId];

  if (!tenant || !tenant.name) {
    showToast('ไม่มีข้อมูลผู้เช่า', 'error');
    return;
  }

  const issue = prompt(`🔧 แจ้งซ่อม — ห้อง ${roomId}\n\nชื่อผู้เช่า: ${tenant.name}\n\nกรุณาอธิบายปัญหา:`);

  if (issue === null || !issue.trim()) return;

  // Record maintenance request
  const maintenanceReports = tenantData.maintenanceReports || [];
  maintenanceReports.push({
    id: Date.now().toString(),
    roomId: roomId,
    tenantName: tenant.name,
    issue: issue,
    date: new Date().toISOString().split('T')[0],
    status: 'pending',
    phone: tenant.phone || '—'
  });

  tenantData.maintenanceReports = maintenanceReports;
  localStorage.setItem('tenant_data', JSON.stringify(tenantData));

  showToast(`บันทึกการแจ้งซ่อมสำเร็จ เรื่อง: ${issue} วันที่แจ้ง: ${new Date().toLocaleDateString('th-TH')}`, 'success');
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
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenants = tenantData.tenants || {};

  // Use RoomConfigManager to get dynamic room list
  const building = buildingType === 'nest' ? 'nest' : 'rooms';
  const config = RoomConfigManager.getRoomsConfig(building);
  const rooms = config.rooms
    .filter(r => !r.deleted)
    .map(r => r.id);

  const occupied = rooms.filter(r => tenants[r] && tenants[r].name).length;
  const vacant = rooms.length - occupied;
  const rate = rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0;

  const result = {
    total: rooms.length,
    occupied: occupied,
    vacant: vacant,
    rate: rate
  };

  console.log(`Occupancy for ${buildingType || 'old'}: ${result.total} total, ${result.occupied} occupied, ${result.vacant} vacant`);
  return result;
}

// Export to window for global access
window.calculateOccupancy = calculateOccupancy;

function updateOccupancyDashboard() {
  // Update Old Building (page-property - rooms section)
  const oldMetrics = calculateOccupancy('old');
  document.getElementById('occupancy-total').textContent = oldMetrics.total;
  document.getElementById('occupancy-occupied').textContent = oldMetrics.occupied;
  document.getElementById('occupancy-vacant').textContent = oldMetrics.vacant;
  document.getElementById('occupancy-rate').textContent = oldMetrics.rate + '%';

  // Update Nest Building (page-property - nest section)
  const nestMetrics = calculateOccupancy('nest');
  document.getElementById('nest-occupancy-total').textContent = nestMetrics.total;
  document.getElementById('nest-occupancy-occupied').textContent = nestMetrics.occupied;
  document.getElementById('nest-occupancy-vacant').textContent = nestMetrics.vacant;
  document.getElementById('nest-occupancy-rate').textContent = nestMetrics.rate + '%';
}

// ===== Lease Expiry Alerts =====
function getExpiringLeases(buildingType = null) {
  const tenantData = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  const tenants = tenantData.tenants || {};

  // Use RoomConfigManager to get dynamic room list
  const building = buildingType === 'nest' ? 'nest' : 'rooms';
  const config = RoomConfigManager.getRoomsConfig(building);
  const rooms = config.rooms
    .filter(r => !r.deleted)
    .map(r => r.id);

  const today = new Date();
  const expiringLeases = [];

  rooms.forEach(roomId => {
    const tenant = tenants[roomId];
    if (!tenant || !tenant.name || !tenant.contractEnd) return;

    const endDate = new Date(tenant.contractEnd);
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    if (daysLeft > 0 && daysLeft <= 30) {
      expiringLeases.push({
        roomId: roomId,
        tenantName: tenant.name,
        endDate: tenant.contractEnd,
        daysLeft: daysLeft
      });
    }
  });

  // Sort by days left (closest first)
  return expiringLeases.sort((a, b) => a.daysLeft - b.daysLeft);
}

function updateLeaseExpiryAlerts() {
  // Update Old Building alerts
  const oldExpiringLeases = getExpiringLeases('old');
  const oldAlertsDiv = document.getElementById('lease-expiry-alerts');
  const oldListDiv = document.getElementById('lease-expiry-list');

  if (oldExpiringLeases.length > 0) {
    oldAlertsDiv.style.display = 'block';
    oldListDiv.innerHTML = oldExpiringLeases.map(lease => `
      <div style="background:white;padding:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;border-left:3px solid #fbc02d;">
        <div>
          <div style="font-weight:600;color:#333;">🟡 ห้อง ${lease.roomId} — ${lease.tenantName}</div>
          <div style="font-size:.85rem;color:#666;margin-top:4px;">หมดสัญญา ${new Date(lease.endDate).toLocaleDateString('th-TH')}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;color:#f57f17;font-size:1.1rem;">${lease.daysLeft} วัน</div>
          <div style="font-size:.75rem;color:#999;">เหลือเวลา</div>
        </div>
      </div>
    `).join('');
  } else {
    oldAlertsDiv.style.display = 'none';
  }

  // Update Nest Building alerts
  const nestExpiringLeases = getExpiringLeases('nest');
  const nestAlertsDiv = document.getElementById('nest-lease-expiry-alerts');
  const nestListDiv = document.getElementById('nest-lease-expiry-list');

  if (nestExpiringLeases.length > 0) {
    nestAlertsDiv.style.display = 'block';
    nestListDiv.innerHTML = nestExpiringLeases.map(lease => `
      <div style="background:white;padding:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;border-left:3px solid #fbc02d;">
        <div>
          <div style="font-weight:600;color:#333;">🟡 ห้อง ${lease.roomId} — ${lease.tenantName}</div>
          <div style="font-size:.85rem;color:#666;margin-top:4px;">หมดสัญญา ${new Date(lease.endDate).toLocaleDateString('th-TH')}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;color:#f57f17;font-size:1.1rem;">${lease.daysLeft} วัน</div>
          <div style="font-size:.75rem;color:#999;">เหลือเวลา</div>
        </div>
      </div>
    `).join('');
  } else {
    nestAlertsDiv.style.display = 'none';
  }
}

// ===== REAL-TIME FIREBASE LISTENERS =====
let realtimeListeners = {};

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

  const db = window.firebase.firestore();
  const { collection, onSnapshot } = window.firebase.firestoreFunctions;

  try {
    const meterUnsubscribe = onSnapshot(
      collection(db, 'meter_data'),
      (snapshot) => {
        console.log('✅ Meter data updated in real-time');
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
    dot.style.background = '#00cc00';
    text.textContent = '🟢 Real-time (Live)';
  } else {
    dot.style.background = '#cc0000';
    text.textContent = '🔴 Disconnected';
  }
}

function stopRealtimeListeners() {
  // Unsubscribe from all listeners
  Object.values(realtimeListeners).forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
  realtimeListeners = {};
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
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    `;

    // Create modal container
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      width: 100%;
      max-width: 420px;
      overflow: hidden;
      animation: modalIn 0.18s ease;
    `;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 1rem 1.3rem 0.85rem;
      background: #fff3e0;
      border-bottom: 1px solid #ffe0b2;
      display: flex;
      align-items: center;
      gap: 0.8rem;
    `;
    header.innerHTML = `
      <span style="font-size: 1.5rem;">⚠️</span>
      <div style="font-size: 0.95rem; font-weight: 700; color: #e65100;">${title}</div>
    `;

    // Modal body
    const body = document.createElement('div');
    body.style.cssText = `
      padding: 1.1rem 1.3rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-size: 0.95rem;
      color: #333;
      line-height: 1.5;
    `;
    body.textContent = message;

    // Modal footer
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 0.85rem 1.3rem;
      background: #fafafa;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 0.8rem;
      justify-content: flex-end;
    `;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ ยกเลิก';
    cancelBtn.style.cssText = `
      padding: 0.6rem 1.2rem;
      background: #e0e0e0;
      color: #333;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: background 0.2s;
    `;
    cancelBtn.onmouseover = () => cancelBtn.style.background = '#d0d0d0';
    cancelBtn.onmouseout = () => cancelBtn.style.background = '#e0e0e0';
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(false);
    };

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✅ ตกลง แทนที่ข้อมูล';
    confirmBtn.style.cssText = `
      padding: 0.6rem 1.2rem;
      background: #4caf50;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: background 0.2s;
    `;
    confirmBtn.onmouseover = () => confirmBtn.style.background = '#45a049';
    confirmBtn.onmouseout = () => confirmBtn.style.background = '#4caf50';
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

  container.innerHTML = `
    <!-- Company identity (used in tax report letterhead) -->
    <div style="background:#f8faf9; padding:1.2rem; border-left:4px solid var(--green); border-radius:6px; margin-bottom:1.5rem;">
      <div style="font-weight:700; color:var(--green-dark); margin-bottom:.6rem;">🏢 ข้อมูลบริษัท / นิติบุคคล (สำหรับใบเสร็จ + รายงานภาษี)</div>

      <!-- Logo upload -->
      <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1rem; padding:.8rem; background:white; border:1px dashed #c8e6c9; border-radius:6px;">
        <div id="logoPreviewBox" style="width:80px; height:80px; border:1px solid #e0e0e0; border-radius:6px; display:flex; align-items:center; justify-content:center; background:#fafafa; overflow:hidden; flex-shrink:0;">
          ${owner.logoDataUrl ? `<img src="${owner.logoDataUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="logo">` : `<span style="font-size:2rem; color:#ccc;">🏢</span>`}
        </div>
        <div style="flex:1;">
          <label style="display:block; margin-bottom:.3rem; font-weight:600; font-size:.9rem;">โลโก้บริษัท (แสดงบนบิล + รายงานภาษี)</label>
          <input type="file" id="ownerLogoInput" accept="image/png,image/jpeg,image/svg+xml" onchange="uploadOwnerLogo(event)" style="font-size:.85rem;">
          <div style="font-size:.75rem; color:var(--text-muted); margin-top:.3rem;">แนะนำ: PNG โปร่งแสง, สี่เหลี่ยมจัตุรัส, ≤ 512px</div>
          ${owner.logoDataUrl ? `<button type="button" onclick="removeOwnerLogo()" style="margin-top:.4rem; padding:.3rem .7rem; background:#ffebee; color:#c62828; border:1px solid #ef9a9a; border-radius:4px; cursor:pointer; font-size:.78rem;">🗑️ ลบโลโก้</button>` : ''}
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาไทย)</label>
          <input type="text" id="companyLegalNameTH" value="${(owner.companyLegalNameTH || 'บริษัท เดอะ กรีนเฮฟเว่น จำกัด').replace(/"/g,'&quot;')}" placeholder="บริษัท เดอะ กรีนเฮฟเว่น จำกัด" style="width:100%; padding:.6rem; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ชื่อนิติบุคคล (ภาษาอังกฤษ)</label>
          <input type="text" id="companyLegalNameEN" value="${(owner.companyLegalNameEN || 'The Green Haven Co., Ltd.').replace(/"/g,'&quot;')}" placeholder="The Green Haven Co., Ltd." style="width:100%; padding:.6rem; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">สถานะการจดทะเบียน</label>
          <select id="registrationStatus" style="width:100%; padding:.6rem; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;">
            <option value="active" ${owner.registrationStatus !== 'pending' ? 'selected' : ''}>✅ จดทะเบียนแล้ว</option>
            <option value="pending" ${owner.registrationStatus === 'pending' ? 'selected' : ''}>⏳ อยู่ระหว่างจดทะเบียน</option>
          </select>
        </div>
        <div>
          <label style="display:block; margin-bottom:.4rem; font-weight:600; font-size:.9rem;">ประเภทเอกสารที่แสดงในรายงาน</label>
          <select id="ownerEntityType" style="width:100%; padding:.6rem; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;">
            <option value="personal" ${owner.entityType !== 'company' ? 'selected' : ''}>บุคคลธรรมดา (ภ.ง.ด.90)</option>
            <option value="company" ${owner.entityType === 'company' ? 'selected' : ''}>นิติบุคคล (ภ.ง.ด.50)</option>
          </select>
        </div>
      </div>
      <small style="display:block; margin-top:.6rem; color:var(--text-muted); font-size:.8rem;">
        ค่าเหล่านี้จะแสดงใน letterhead ของรายงานภาษี (Tax Filing) + ใบเสร็จลูกบ้าน อัตโนมัติ
      </small>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
      <!-- Left column -->
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">ชื่อ-นามสกุล (เจ้าของ/ผู้จัดทำ) *</label>
        <input type="text" id="ownerName" value="${owner.name || ''}" placeholder="ชื่อเจ้าของ" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลขประจำตัวประชาชน *</label>
        <input type="text" id="ownerIdCard" value="${owner.idCardNumber || ''}" placeholder="เลขประจำตัวประชาชน" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เบอร์โทรศัพท์</label>
        <input type="tel" id="ownerPhone" value="${owner.phone || ''}" placeholder="เบอร์โทรศัพท์" maxlength="10" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        <small id="ownerPhoneError" style="display:none;color:#d32f2f;font-size:0.85rem;margin-top:4px;"></small>
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">อีเมล</label>
        <input type="email" id="ownerEmail" value="${owner.email || ''}" placeholder="อีเมล" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr; gap: 1.5rem; margin-top: 1.5rem;">
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">ที่อยู่</label>
        <input type="text" id="ownerAddress" value="${owner.address || ''}" placeholder="ที่อยู่" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-top: 1rem;">
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">แขวง/ตำบล</label>
        <input type="text" id="ownerSubDistrict" value="${owner.subDistrict || ''}" placeholder="แขวง/ตำบล" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เขต/อำเภอ</label>
        <input type="text" id="ownerDistrict" value="${owner.district || ''}" placeholder="เขต/อำเภอ" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">จังหวัด</label>
        <input type="text" id="ownerProvince" value="${owner.province || ''}" placeholder="จังหวัด" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem;">
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">รหัสไปรษณีย์</label>
        <input type="text" id="ownerPostalCode" value="${owner.postalCode || ''}" placeholder="รหัสไปรษณีย์" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลขประจำตัวผู้เสียภาษี</label>
        <input type="text" id="ownerTaxId" value="${owner.taxId || ''}" placeholder="เลขประจำตัวผู้เสียภาษี" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem;">
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">ชื่อธนาคาร</label>
        <input type="text" id="ownerBankName" value="${owner.bankName || ''}" placeholder="ชื่อธนาคาร" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลขบัญชี</label>
        <input type="text" id="ownerBankAccount" value="${owner.bankAccount || ''}" placeholder="เลขบัญชี" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
      </div>
    </div>


    <div style="margin-top: 2rem; display: flex; gap: 1rem;">
      <button onclick="saveOwnerInfo()" style="padding: 0.8rem 2rem; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 1rem;">
        💾 บันทึกข้อมูล
      </button>
      <button onclick="clearOwnerInfo()" style="padding: 0.8rem 2rem; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 1rem;">
        🗑️ ลบข้อมูล
      </button>
    </div>

    <!-- Per-building Payment Config (subscribed by tenant_app _subscribePaymentConfig) -->
    <hr style="margin: 2.5rem 0 1.5rem; border: none; border-top: 1px solid var(--border);">
    <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: .25rem;">💳 ข้อมูลการชำระเงิน (ต่อตึก)</div>
    <div style="font-size: .85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
      ตั้งค่า PromptPay + ชื่อบริษัทแยกตามตึก — ลูกบ้านแต่ละตึกจะเห็น QR + ชื่อ payee ของตึกตัวเอง.
      <br>เก็บที่ Firestore <code>buildings/{RentRoom|nest}</code>
    </div>
    <div id="buildingPaymentConfigContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
      <div style="text-align:center;color:var(--text-muted);padding:1rem;grid-column:span 2;">กำลังโหลด...</div>
    </div>

    <!-- Per-building Internet Status (subscribed by tenant_app displayBuildingInternetStatus) -->
    <hr style="margin: 2.5rem 0 1.5rem; border: none; border-top: 1px solid var(--border);">
    <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: .25rem;">🌐 สถานะอินเทอร์เน็ตอาคาร</div>
    <div style="font-size: .85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
      ตั้งค่าสถานะเน็ต/ผู้ให้บริการ/ความเร็ว แยกตามตึก — ลูกบ้านจะเห็น status จริงในหน้า Services.
      <br>เก็บที่ Firestore <code>buildings/{RentRoom|nest}.internet</code> (real-time ผ่าน onSnapshot)
    </div>
    <div id="buildingInternetConfigContainer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
      <div style="text-align:center;color:var(--text-muted);padding:1rem;grid-column:span 2;">กำลังโหลด...</div>
    </div>
  `;
  // Lazy-load building payment + internet config (after Firebase ready)
  if (typeof renderBuildingPaymentConfig === 'function') renderBuildingPaymentConfig();
  if (typeof renderBuildingInternetConfig === 'function') renderBuildingInternetConfig();
}

// ===== BUILDING PAYMENT CONFIG (per-building PromptPay + company name) =====
async function renderBuildingPaymentConfig() {
  const container = document.getElementById('buildingPaymentConfigContainer');
  if (!container) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    container.innerHTML = '<div style="color:#c62828;text-align:center;padding:1rem;grid-column:span 2;">Firestore unavailable</div>';
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  // Load both building docs in parallel
  const [rrSnap, nestSnap] = await Promise.all([
    fs.getDoc(fs.doc(db, 'buildings', 'RentRoom')).catch(() => null),
    fs.getDoc(fs.doc(db, 'buildings', 'nest')).catch(() => null)
  ]);
  const rr = rrSnap?.exists() ? rrSnap.data() : {};
  const nest = nestSnap?.exists() ? nestSnap.data() : {};
  const cardHtml = (label, fsId, data) => `
    <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1.25rem; background: #fafafa;">
      <div style="font-weight: 700; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <span>${label}</span>
        <span style="font-size: .72rem; color: var(--text-muted); font-family: monospace;">buildings/${fsId}</span>
      </div>
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">PromptPay (เบอร์โทร)</label>
      <input type="tel" id="bp-${fsId}-promptpay" value="${(data.promptpayNumber||data.payment?.promptpayNumber||'').replace(/"/g,'&quot;')}" placeholder="0xxxxxxxxx" maxlength="13" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;">
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">ชื่อบริษัท / ผู้รับเงิน (ใบเสร็จ)</label>
      <input type="text" id="bp-${fsId}-company" value="${(data.companyName||data.payment?.companyName||'').replace(/"/g,'&quot;')}" placeholder="เช่น The Green Haven Co., Ltd." style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;">
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">ชื่อเจ้าของ (Owner)</label>
      <input type="text" id="bp-${fsId}-owner" value="${(data.ownerName||data.payment?.ownerName||'').replace(/"/g,'&quot;')}" placeholder="ชื่อเจ้าของอาคารนี้" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:1rem;">
      <button onclick="saveBuildingPaymentConfig('${fsId}')" style="width:100%;padding:.65rem;background:#4caf50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun,sans-serif;">💾 บันทึก ${label}</button>
    </div>
  `;
  container.innerHTML = cardHtml('🏠 ห้องแถว', 'RentRoom', rr) + cardHtml('🏢 Nest', 'nest', nest);
}

async function saveBuildingPaymentConfig(fsId) {
  if (!['RentRoom', 'nest'].includes(fsId)) return;
  const promptpayNumber = document.getElementById(`bp-${fsId}-promptpay`)?.value?.trim() || '';
  const companyName = document.getElementById(`bp-${fsId}-company`)?.value?.trim() || '';
  const ownerName = document.getElementById(`bp-${fsId}-owner`)?.value?.trim() || '';
  if (promptpayNumber && !/^\d{9,13}$/.test(promptpayNumber.replace(/\D/g, ''))) {
    showToast('PromptPay ต้องเป็นตัวเลข 9-13 หลัก', 'warning');
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('Firestore ไม่พร้อม', 'error');
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'buildings', fsId), {
      promptpayNumber, companyName, ownerName,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    showToast(`✅ บันทึกข้อมูล ${fsId === 'RentRoom' ? 'ห้องแถว' : 'Nest'} แล้ว`, 'success');
  } catch (e) {
    console.error('saveBuildingPaymentConfig failed:', e);
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.renderBuildingPaymentConfig = renderBuildingPaymentConfig;
  window.saveBuildingPaymentConfig = saveBuildingPaymentConfig;
}


// ===== BUILDING INTERNET CONFIG (per-building ISP + status + speed) =====
// Same pattern as payment config: writes buildings/{RentRoom|nest}.internet (merged).
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
    fs.getDoc(fs.doc(db, 'buildings', 'RentRoom')).catch(() => null),
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
      <input type="text" id="bi-${fsId}-provider" value="${esc(data.provider)}" placeholder="เช่น True Internet" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;">
      <label style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">เบอร์ติดต่อ</label>
      <input type="tel" id="bi-${fsId}-contact" value="${esc(data.contact)}" placeholder="เช่น 1686" style="width:100%;padding:.6rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;margin-bottom:.8rem;">
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
  container.innerHTML = cardHtml('🏠 ห้องแถว', 'RentRoom', rr) + cardHtml('🏢 Nest', 'nest', nest);
}

async function saveBuildingInternetConfig(fsId) {
  if (!['RentRoom', 'nest'].includes(fsId)) return;
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
    showToast(`✅ บันทึกสถานะเน็ต ${fsId === 'RentRoom' ? 'ห้องแถว' : 'Nest'} แล้ว`, 'success');
  } catch (e) {
    console.error('saveBuildingInternetConfig failed:', e);
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.renderBuildingInternetConfig = renderBuildingInternetConfig;
  window.saveBuildingInternetConfig = saveBuildingInternetConfig;
}


// ===== LEASE REQUESTS QUEUE (Firestore leaseRequests) =====
let _leaseRequestsUnsub = null;
let _leaseRequestsCache = [];
let _leaseRequestsFilter = 'all';

function _esc(s) {
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => map[m]);
}

function initLeaseRequestsPage() {
  if (_leaseRequestsUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const colRef = fs.collection(db, 'leaseRequests');
  _leaseRequestsUnsub = fs.onSnapshot(colRef, snap => {
    _leaseRequestsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderLeaseRequestsList();
    updateLeaseRequestsBadge();
  }, err => {
    console.warn('lease requests onSnapshot failed:', err);
    document.getElementById('leaseRequestsList').innerHTML = `<div style="text-align:center;padding:30px;color:#c62828;">โหลดไม่สำเร็จ: ${_esc(err.message)}</div>`;
  });
}

function setLeaseRequestFilter(filter, btn) {
  _leaseRequestsFilter = filter;
  document.querySelectorAll('.lease-req-filter-btn').forEach(b => {
    b.style.background = '#eee'; b.style.color = '#333';
  });
  if (btn) { btn.style.background = 'var(--green-dark)'; btn.style.color = 'white'; }
  renderLeaseRequestsList();
}

function updateLeaseRequestsBadge() {
  const badge = document.getElementById('leaseRequestsBadge');
  if (!badge) return;
  const pending = _leaseRequestsCache.filter(r => r.status === 'pending').length;
  if (pending > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = pending;
  } else {
    badge.style.display = 'none';
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
    const statusColor = r.status === 'pending' ? '#f57c00'
                      : r.status === 'approved' ? '#388e3c'
                      : r.status === 'rejected' ? '#c62828' : '#999';
    const statusLabel = r.status === 'pending' ? '⏳ รอดำเนินการ'
                      : r.status === 'approved' ? '✅ อนุมัติแล้ว'
                      : r.status === 'rejected' ? '❌ ปฏิเสธ' : r.status;
    const typeLabel = r.type === 'renew' ? '✅ ขอต่อสัญญา' : (r.type === 'moveout' ? '❌ แจ้งย้ายออก' : r.type);
    const buildingLabel = r.building === 'rooms' ? 'ห้องแถว' : (r.building === 'nest' ? 'Nest' : r.building);
    const created = r.createdAt ? new Date(r.createdAt).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }) : '—';
    const detailsHtml = r.type === 'renew'
      ? `<div style="font-size:.88rem;line-height:1.7;"><div><strong>ระยะเวลา:</strong> ${_esc(r.duration === '1y' ? '1 ปี (มีส่วนลด)' : '6 เดือน')}</div>${r.note ? `<div><strong>หมายเหตุ:</strong> ${_esc(r.note)}</div>` : ''}</div>`
      : `<div style="font-size:.88rem;line-height:1.7;"><div><strong>วันย้ายออก:</strong> ${_esc(r.moveOutDate || '—')}</div><div><strong>บัญชีคืนมัดจำ:</strong> ${_esc(r.depositRefundBank || '—')}</div>${r.reason ? `<div><strong>เหตุผล:</strong> ${_esc(r.reason)}</div>` : ''}</div>`;
    card.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:1.25rem;background:#fafafa;';
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
          <button onclick="actLeaseRequest('${r.id}','approve')" style="flex:1;padding:8px;background:#388e3c;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun;">✅ อนุมัติ</button>
          <button onclick="actLeaseRequest('${r.id}','reject')" style="flex:1;padding:8px;background:#c62828;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-family:Sarabun;">❌ ปฏิเสธ</button>
        </div>
      ` : ''}
    `;
    list.appendChild(card);
  });
}

async function actLeaseRequest(id, action) {
  const note = prompt(action === 'approve' ? 'หมายเหตุ (ถ้ามี) — เช่น เงื่อนไขสัญญาใหม่' : 'เหตุผลที่ปฏิเสธ:') || '';
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

// Low-level logo write that bypasses name-required validation in OwnerConfigManager.saveOwnerInfo.
// Needed because users may upload a logo before filling in the owner name.
function _writeOwnerLogo(dataUrl) {
  const current = OwnerConfigManager.getOwnerInfo();
  const updated = { ...current, logoDataUrl: dataUrl };
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
      const dataUrl = file.type === 'image/png' || file.type === 'image/svg+xml'
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
  if (!confirm('ยืนยันการลบโลโก้?')) return;
  _writeOwnerLogo('');
  showToast('ลบโลโก้แล้ว', 'success');
  renderOwnerInfoPage();
};

function saveOwnerInfo() {
  const name = document.getElementById('ownerName').value.trim();
  if (!name) {
    showToast('กรุณากรอกชื่อเจ้าของ', 'warning');
    return;
  }

  const existing = OwnerConfigManager.getOwnerInfo();

  const ownerData = {
    // Preserve existing logo (uploaded separately via uploadOwnerLogo)
    logoDataUrl: existing.logoDataUrl || '',
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
    operationStartDate: document.getElementById('ownerOperationStartDate').value.trim(),
    businessType: document.getElementById('ownerBusinessType').value,
    businessCategory: document.getElementById('ownerBusinessCategory').value.trim()
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
  if (confirm('คุณแน่ใจหรือว่าต้องการลบข้อมูลเจ้าของทั้งหมด?')) {
    OwnerConfigManager.clearOwnerInfo();
    showToast('ลบข้อมูลเรียบร้อย', 'success');
    renderOwnerInfoPage();
  }
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
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลือกอาคาร</label>
        <select id="tenantMasterBuilding" onchange="window.currentTenantMasterBuilding = this.value; renderTenantMasterPage();" style="padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px;">
          <option value="rooms" ${(window.currentTenantMasterBuilding || 'rooms') === 'rooms' ? 'selected' : ''}>ห้องแถว (Rooms)</option>
          <option value="nest" ${(window.currentTenantMasterBuilding || 'rooms') === 'nest' ? 'selected' : ''}>Nest</option>
        </select>
      </div>

      <!-- Add Tenant Form -->
      <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 2rem;">
        <div style="font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">➕ เพิ่มผู้เช่าใหม่</div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">รหัสผู้เช่า *</label>
            <input type="text" id="newTenantId" placeholder="เช่น T001, T002" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">ชื่อ-นามสกุล *</label>
            <input type="text" id="newTenantName" placeholder="ชื่อผู้เช่า" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลขประจำตัวประชาชน/Passport</label>
            <input type="text" id="newTenantIdCard" placeholder="เลขประจำตัว" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เบอร์โทรศัพท์</label>
            <input type="tel" id="newTenantPhone" placeholder="เบอร์โทรศัพท์" maxlength="10" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
            <small id="newTenantPhoneError" style="display:none;color:#d32f2f;font-size:0.85rem;margin-top:4px;"></small>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">อีเมล</label>
            <input type="email" id="newTenantEmail" placeholder="อีเมล" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">ที่อยู่</label>
            <input type="text" id="newTenantAddress" placeholder="ที่อยู่" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
          </div>
        </div>

        <button onclick="addNewTenant()" style="padding: 0.8rem 1.5rem; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
          ➕ เพิ่มผู้เช่า
        </button>
      </div>

      <!-- Tenant List -->
      <div style="font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">📋 รายชื่อผู้เช่า (${tenants.length} คน)</div>
      ${tenants.length === 0 ? '<div style="padding: 1.5rem; text-align: center; color: #999;">ยังไม่มีผู้เช่า</div>' : ''}
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">รหัส</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">ชื่อ</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">เบอร์โทร</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">อีเมล</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: center;">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            ${tenants.map(tenant => `
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${tenant.id}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${tenant.name}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${tenant.phone || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${tenant.email || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem; text-align: center;">
                  <button onclick="editTenant('${tenant.id}')" style="padding: 0.4rem 0.8rem; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 0.5rem;">📝</button>
                  <button onclick="deleteTenant('${tenant.id}')" style="padding: 0.4rem 0.8rem; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️</button>
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
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  // Use DOM manipulation (not innerHTML) for fields that take user-controlled data
  // to avoid XSS from tenant name/phone/etc.
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:8px;padding:2rem;width:min(500px,95vw);max-height:90vh;overflow-y:auto;';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:1.1rem;margin-bottom:1.5rem;';
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
  grid.style.cssText = 'display:grid;gap:1rem;';
  fields.forEach(f => {
    const wrap = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;margin-bottom:0.4rem;font-weight:600;';
    lbl.textContent = f.label;
    const inp = document.createElement('input');
    inp.id = f.id; inp.type = f.type; inp.value = f.val;
    if (f.id === 'etPhone') inp.maxLength = 10;
    inp.style.cssText = 'width:100%;padding:0.7rem;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    grid.appendChild(wrap);
  });
  box.appendChild(grid);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:0.8rem;margin-top:1.5rem;justify-content:flex-end;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'ยกเลิก';
  cancelBtn.style.cssText = 'padding:0.7rem 1.2rem;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff;';
  cancelBtn.onclick = () => modal.remove();
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 บันทึก';
  saveBtn.style.cssText = 'padding:0.7rem 1.5rem;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;';
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

  const leases = LeaseAgreementManager.getAllLeasesList();

  // Aggregate tenants from both buildings (SSoT: Tab ผู้เช่า)
  // We tag each tenant with its building so the info card can show it without re-asking.
  const allTenants = [];
  ['rooms', 'nest'].forEach(b => {
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

  const tenantOptions = allTenants
    .map(t => {
      const activeLease = LeaseAgreementManager.getLeasesByTenant(t.id).find(l => l.status === 'active');
      const roomLabel = activeLease ? `ห้อง ${activeLease.roomId}` : 'ยังไม่ผูกห้อง';
      const buildingLabel = t.building === 'rooms' ? 'ห้องแถว' : 'Nest';
      return `<option value="${t.id}">${_escapeHTML(t.name || t.id)} — ${roomLabel} (${buildingLabel})</option>`;
    }).join('');

  container.innerHTML = `
    <div style="margin-top: 1.5rem;">
      <!-- Add Lease Form — SSoT: tenant data from Tab ผู้เช่า, rent from Tab จัดการห้อง -->
      <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 2rem;">
        <div style="font-weight: 600; margin-bottom: 0.3rem; font-size: 1.1rem;">📎 แนบเอกสารสัญญา</div>
        <div style="font-size: 0.82rem; color: #666; margin-bottom: 1rem;">
          ข้อมูลลูกบ้านและค่าเช่าดึงจาก SSoT อัตโนมัติ — ต้องแก้ที่ต้นทาง:
          <a href="#" data-action="showPage" data-page="tenant" style="color: #2e7d32; font-weight: 600; text-decoration: underline;">Tab ผู้เช่า</a> ·
          <a href="#" data-action="showPage" data-page="meter" style="color: #2e7d32; font-weight: 600; text-decoration: underline;">Tab จัดการห้อง</a>
        </div>

        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">เลือกผู้เช่า *</label>
          <select id="leaseTenant" onchange="_updateLeasePreview()" style="width: 100%; padding: 0.7rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
            <option value="">-- เลือกผู้เช่า --</option>
            ${tenantOptions}
          </select>
        </div>

        <!-- Auto-filled info card (populated by _updateLeasePreview on change) -->
        <div id="leasePreviewCard" style="display: none; padding: 12px 14px; background: #e8f5e9; border-left: 3px solid #4caf50; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; line-height: 1.6;"></div>

        <!-- FILE UPLOADS SECTION -->
        <div style="background: #f0f9ff; padding: 1rem; border-radius: 6px; border: 1px solid #b3e5fc; margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.8rem; color: #01579b;">📄 เอกสารประกอบสัญญา (optional)</div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 0.8rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">💉 ใบรับรองวัคซีนสัตว์เลี้ยง</label>
              <input type="file" id="leaseFilePetCert" accept=".pdf,.jpg,.png" style="width: 100%; padding: 0.5rem; border: 1px solid #b3e5fc; border-radius: 4px; box-sizing: border-box; font-size: 0.85rem;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">📞 ข้อมูลติดต่อผู้เช่า</label>
              <input type="file" id="leaseFileTenantContact" accept=".pdf,.jpg,.png" style="width: 100%; padding: 0.5rem; border: 1px solid #b3e5fc; border-radius: 4px; box-sizing: border-box; font-size: 0.85rem;">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 0.8rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">📋 สัญญาเช่า</label>
              <input type="file" id="leaseFileAgreement" accept=".pdf,.jpg,.png" style="width: 100%; padding: 0.5rem; border: 1px solid #b3e5fc; border-radius: 4px; box-sizing: border-box; font-size: 0.85rem;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">🆔 สำเนาบัตรประชาชน</label>
              <input type="file" id="leaseFileId" accept=".pdf,.jpg,.png" style="width: 100%; padding: 0.5rem; border: 1px solid #b3e5fc; border-radius: 4px; box-sizing: border-box; font-size: 0.85rem;">
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-weight: 600; font-size: 0.9rem;">💰 หลักฐานรายได้</label>
            <input type="file" id="leaseFileIncome" accept=".pdf,.jpg,.png" style="width: 100%; padding: 0.5rem; border: 1px solid #b3e5fc; border-radius: 4px; box-sizing: border-box; font-size: 0.85rem;">
          </div>
          <small style="color: #666; margin-top: 0.5rem; display: block;">📁 สนับสนุน: PDF, JPG, PNG · ขนาดสูงสุด: 5MB</small>
        </div>

        <button onclick="createNewLease()" style="padding: 0.8rem 1.5rem; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
          💾 บันทึกสัญญา & แนบเอกสาร
        </button>
      </div>

      <!-- Lease List -->
      <div style="font-weight: 600; margin-bottom: 1rem; font-size: 1.1rem;">📋 สัญญาเช่าทั้งหมด (${leases.length})</div>
      ${leases.length === 0 ? '<div style="padding: 1.5rem; text-align: center; color: #999;">ยังไม่มีสัญญาเช่า</div>' : ''}
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">อาคาร</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">ห้อง</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">ผู้เช่า</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">วันเข้า</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">ค่าเช่า</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: left;">สถานะ</th>
              <th style="border: 1px solid #ddd; padding: 0.8rem; text-align: center;">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            ${leases.map(lease => `
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${lease.building === 'rooms' ? 'ห้องแถว' : 'Nest'}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${lease.roomId}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${lease.tenantName || lease.tenantId}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">${new Date(lease.moveInDate).toLocaleDateString('th-TH')}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem; text-align: right;">฿${lease.rentAmount?.toLocaleString() || '-'}</td>
                <td style="border: 1px solid #ddd; padding: 0.8rem;">
                  <span style="padding: 0.3rem 0.8rem; border-radius: 4px; background: ${lease.status === 'active' ? '#c8e6c9' : '#f5f5f5'}; color: ${lease.status === 'active' ? '#2e7d32' : '#999'}; font-weight: 600;">
                    ${lease.status === 'active' ? '✅ กำลังเช่า' : '❌ เลิกเช่า'}
                  </span>
                </td>
                <td style="border: 1px solid #ddd; padding: 0.8rem; text-align: center; white-space: nowrap;">
                  <button onclick="viewLeaseDocuments('${lease.id}')" style="padding: 0.4rem 0.8rem; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;" title="ดูเอกสาร">📁</button>
                  ${lease.status === 'active' ? `<button onclick="endLease('${lease.id}')" style="padding: 0.4rem 0.8rem; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;" title="สิ้นสุดสัญญา">🚪</button>` : ''}
                  <button onclick="deleteLease('${lease.id}')" style="padding: 0.4rem 0.8rem; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;" title="ลบ">🗑️</button>
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

  // Derive room from active lease (tenant→lease→room relationship)
  // If no active lease exists yet, that's a data gap — tenant wasn't fully saved in Tab ผู้เช่า
  const activeLease = LeaseAgreementManager.getLeasesByTenant(tenantId).find(l => l.status === 'active');
  const roomId = activeLease?.roomId;
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
  const petCertFile = document.getElementById('leaseFilePetCert')?.files[0];
  const tenantContactFile = document.getElementById('leaseFileTenantContact')?.files[0];
  const agreementFile = document.getElementById('leaseFileAgreement')?.files[0];
  const idFile = document.getElementById('leaseFileId')?.files[0];
  const incomeFile = document.getElementById('leaseFileIncome')?.files[0];

  if (petCertFile) documentsToUpload.petCert = petCertFile;
  if (tenantContactFile) documentsToUpload.tenantContact = tenantContactFile;
  if (agreementFile) documentsToUpload.agreement = agreementFile;
  if (idFile) documentsToUpload.id = idFile;
  if (incomeFile) documentsToUpload.income = incomeFile;

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
    if (preview) preview.style.display = 'none';
    ['leaseFilePetCert', 'leaseFileTenantContact', 'leaseFileAgreement', 'leaseFileId', 'leaseFileIncome']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    renderLeaseAgreementsPage();
  }
}

// Find a tenant record across both buildings, return with building tag
function _findTenantWithBuilding(tenantId) {
  if (typeof TenantConfigManager === 'undefined') return null;
  for (const b of ['rooms', 'nest']) {
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
  if (!tenantId) { card.style.display = 'none'; card.innerHTML = ''; return; }

  const info = _findTenantWithBuilding(tenantId);
  if (!info) { card.style.display = 'none'; return; }
  const { tenant, building } = info;

  const activeLease = LeaseAgreementManager.getLeasesByTenant(tenantId).find(l => l.status === 'active');
  const roomId = activeLease?.roomId;
  const rent = roomId && typeof RoomConfigManager !== 'undefined'
    ? RoomConfigManager.getRentPrice(building, roomId) || 0
    : 0;
  const buildingLabel = building === 'rooms' ? 'ห้องแถว' : 'Nest';
  const moveIn = tenant.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('th-TH') : '—';
  const deposit = Number(tenant.deposit) || 0;

  card.style.display = 'block';
  card.innerHTML = `
    <div style="font-weight: 700; color: #1b5e20; margin-bottom: 6px;">📋 ข้อมูลจาก SSoT (read-only)</div>
    <div>🏠 <b>${buildingLabel} ${roomId ? 'ห้อง ' + _escapeHTML(roomId) : '(ยังไม่ผูกห้อง)'}</b></div>
    <div>👤 ${_escapeHTML(tenant.name || '-')} ${tenant.phone ? '· 📱 ' + _escapeHTML(tenant.phone) : ''}</div>
    <div>📅 วันเข้าเช่า: ${_escapeHTML(moveIn)} <span style="color:#666;font-size:.78rem;">(จาก Tab ผู้เช่า)</span></div>
    <div>💰 ค่าเช่า: ฿${rent.toLocaleString()}/เดือน <span style="color:#666;font-size:.78rem;">(จาก Tab จัดการห้อง)</span></div>
    <div>💵 มัดจำ: ฿${deposit.toLocaleString()} <span style="color:#666;font-size:.78rem;">(จาก Tab ผู้เช่า)</span></div>
    ${!roomId ? '<div style="color:#c62828;margin-top:6px;">⚠️ ต้องกำหนดห้องใน Tab ผู้เช่าก่อนบันทึกสัญญา</div>' : ''}
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
        console.log(`🗜️ Compressed ${docType}: saved ${savedMB}MB`);
      }

      const ext = file.name.split('.').pop();
      const fileName = `${fileTypeMap[docType]}-${Date.now()}.${ext}`;
      const storagePath = `leases/${building}/${roomId}/${leaseId}/${fileName}`;
      const storageRef = storage.ref(storagePath);

      storageRef.put(file)
        .then((snapshot) => {
          uploadCount++;
          console.log(`✅ Document uploaded: ${docType} (${uploadCount}/${totalFiles})`);
          return snapshot.ref.getDownloadURL();
        })
        .then((downloadURL) => {
          console.log(`📄 Download URL: ${downloadURL}`);
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
        })
        .catch((error) => {
          console.error(`❌ Error uploading ${docType}:`, error);
        });
    }

    console.log(`📁 Uploading ${totalFiles} documents for lease ${leaseId}...`);
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
    modal.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;align-items:center;justify-content:center;padding:1rem;';
    document.body.appendChild(modal);
  }

  const moveIn = lease.moveInDate ? new Date(lease.moveInDate).toLocaleDateString('th-TH') : '—';
  const buildingLabel = lease.building === 'rooms' ? 'ห้องแถว' : 'Nest';

  modal.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <div style="padding:20px 24px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 id="leaseDocumentsTitle" style="font-size:1.3rem;margin:0;color:#1b5e20;">📁 เอกสารสัญญา — ${buildingLabel} ห้อง ${lease.roomId}</h2>
          <div style="font-size:.85rem;color:#666;margin-top:4px;">${lease.tenantName || lease.tenantId} · เข้า ${moveIn} · ฿${lease.rentAmount?.toLocaleString() || '-'}</div>
        </div>
        <button onclick="document.getElementById('leaseDocumentsModal').remove()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#999;">✕</button>
      </div>
      <div id="leaseDocumentsBody" style="padding:20px 24px;">
        <div style="text-align:center;padding:30px;color:#999;">⏳ กำลังโหลดเอกสาร...</div>
      </div>
    </div>
  `;

  const body = document.getElementById('leaseDocumentsBody');
  const sections = [];

  // Section 1a: Contract base64 stored directly in lease record (from tenant modal upload)
  if (lease.contractDocument) {
    const fname = lease.contractFileName || 'lease-contract';
    sections.push(`
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:700;color:#1b5e20;margin-bottom:.5rem;font-size:.95rem;">📋 สัญญาเช่า (อัพโหลดผ่าน Tab ผู้เช่า)</div>
        <div style="padding:10px 12px;background:#e8f5e9;border-left:3px solid #4caf50;border-radius:4px;font-size:.88rem;">
          <a href="${_escapeAttr(lease.contractDocument)}" download="${_escapeAttr(fname)}" style="color:#2e7d32;font-weight:600;text-decoration:none;">⬇️ ${_escapeHTML(fname)}</a>
          ${lease.contractUploadedAt ? `<div style="font-size:.75rem;color:#999;margin-top:3px;">อัพโหลด: ${new Date(lease.contractUploadedAt).toLocaleString('th-TH')}</div>` : ''}
        </div>
      </div>
    `);
  }

  // Section 1b: Lease documents from Firebase Storage (uploaded via Tab สัญญา form)
  const leaseDocsHTML = await _renderLeaseStorageDocs(lease);
  sections.push(`
    <div style="margin-bottom:1.5rem;">
      <div style="font-weight:700;color:#1b5e20;margin-bottom:.5rem;font-size:.95rem;">📎 เอกสารแนบสัญญา (อัพโหลดผ่าน Tab สัญญา)</div>
      ${leaseDocsHTML}
    </div>
  `);

  // Section 2: Legacy contractDocument (base64 in tenant record — pre-Phase-3 data)
  if (tenant?.contractDocument) {
    const fname = tenant.contractFileName || 'contract-legacy';
    sections.push(`
      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:700;color:#bf360c;margin-bottom:.5rem;font-size:.95rem;">📄 สัญญาเช่า (Legacy — อยู่ใน tenant record, รอย้าย)</div>
        <div style="padding:10px 12px;background:#fff3e0;border-left:3px solid #ff9800;border-radius:4px;font-size:.88rem;">
          <a href="${_escapeAttr(tenant.contractDocument)}" download="${_escapeAttr(fname)}" style="color:#e65100;font-weight:600;text-decoration:none;">⬇️ ${_escapeHTML(fname)}</a>
          <div style="font-size:.75rem;color:#999;margin-top:3px;">ข้อมูลเก่าก่อน Phase 3 — จะย้ายไป lease SSoT อัตโนมัติเมื่อมีการแก้ไขผ่าน Tab ผู้เช่า</div>
        </div>
      </div>
    `);
  }

  // Section 3: Tenant-side data (company info, avatar, etc.)
  if (tenant?.companyInfo?.name) {
    const ci = tenant.companyInfo;
    sections.push(`
      <div style="margin-bottom:1.5rem;">
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
        <div style="padding:10px 12px;background:#f3e5f5;border-left:3px solid #7b1fa2;border-radius:4px;font-size:.88rem;line-height:1.6;">
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
        <div style="padding:10px 12px;background:#e8f5e9;border-left:3px solid #4caf50;border-radius:4px;margin-bottom:6px;font-size:.88rem;display:flex;justify-content:space-between;align-items:center;">
          <span>${meta.icon} <b>${meta.label}</b> <span style="color:#999;font-size:.78rem;">(${_escapeHTML(fname)})</span></span>
          <a href="${_escapeAttr(url)}" target="_blank" rel="noopener noreferrer" style="color:#2e7d32;font-weight:600;text-decoration:none;">⬇️ ดาวน์โหลด</a>
        </div>`;
    }).join('') || '<div style="color:#999;font-size:.85rem;">ยังไม่มีเอกสาร</div>';
  }

  // Fallback: list Storage folder (for legacy leases without documentURLs)
  try {
    if (!window.firebase?.storage) {
      return '<div style="color:#999;font-size:.85rem;">Firebase Storage ไม่พร้อมใช้งาน</div>';
    }
    const storage = window.firebase.storage();
    const folderRef = storage.ref(`leases/${building}/${roomId}/${leaseId}`);
    const result = await folderRef.listAll();
    if (!result.items.length) {
      return '<div style="color:#999;font-size:.85rem;padding:8px;">ยังไม่มีไฟล์เอกสาร (admin ยังไม่ได้อัพโหลด)</div>';
    }
    const urls = await Promise.all(result.items.map(async (ref) => ({
      name: ref.name,
      url: await ref.getDownloadURL()
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
        <div style="padding:10px 12px;background:#e8f5e9;border-left:3px solid #4caf50;border-radius:4px;margin-bottom:6px;font-size:.88rem;display:flex;justify-content:space-between;align-items:center;">
          <span>${meta.icon} <b>${meta.label}</b> <span style="color:#999;font-size:.78rem;">(${_escapeHTML(name)})</span></span>
          <a href="${_escapeAttr(url)}" target="_blank" rel="noopener noreferrer" style="color:#2e7d32;font-weight:600;text-decoration:none;">⬇️ ดาวน์โหลด</a>
        </div>`;
    }).join('');
  } catch (e) {
    console.warn('⚠️ listAll failed:', e.message);
    return '<div style="color:#c62828;font-size:.85rem;padding:8px;">โหลดเอกสารล้มเหลว: ' + _escapeHTML(e.message) + '</div>';
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
  if (confirm('คุณแน่ใจหรือว่าต้องการสิ้นสุดสัญญาเช่า?')) {
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
  }
}

function deleteLease(leaseId) {
  if (confirm('คุณแน่ใจหรือว่าต้องการลบสัญญาเช่า?')) {
    if (LeaseAgreementManager.deleteLease(leaseId)) {
      showToast('ลบสัญญาเช่าเรียบร้อย', 'success');
      renderLeaseAgreementsPage();
    }
  }
}

// ===== UPLOAD REAL BILLS PAGE (ADMIN ONLY) =====
// Phone Number Validation Function
// Handles: format, validation, error messages, auto-formatting
function validatePhoneNumber(inputElement, errorElementId) {
  const input = inputElement.value;
  const errorEl = errorElementId ? document.getElementById(errorElementId) : null;

  // Remove all non-digit characters for processing
  const cleanedInput = input.replace(/\D/g, '');

  // Initialize error message as empty
  let errorMsg = '';
  let isValid = true;

  // Validation rules:
  // 1. Must contain only numbers
  if (input !== cleanedInput && input.length > 0) {
    // Allow dashes and spaces but clean them
    if (!/^[0-9\s\-]*$/.test(input)) {
      errorMsg = '❌ เบอร์โทรต้องเป็นตัวเลขเท่านั้น (0-9, dash, space)';
      isValid = false;
    }
  }

  // 2. Must be exactly 10 digits
  if (cleanedInput.length > 0 && cleanedInput.length !== 10) {
    errorMsg = '❌ กรุณากรอกเบอร์โทร 10 หลัก';
    isValid = false;
  }

  // 3. Must start with 0
  if (cleanedInput.length > 0 && !cleanedInput.startsWith('0')) {
    errorMsg = '❌ เบอร์โทรต้องขึ้นต้นด้วย 0';
    isValid = false;
  }

  // Update input value with cleaned version (store without dashes)
  inputElement.value = cleanedInput;

  // Display formatted version for user (with dashes) - optional
  // Format: 081-234-5678
  if (cleanedInput.length === 10) {
    const formatted = cleanedInput.slice(0, 3) + '-' + cleanedInput.slice(3, 6) + '-' + cleanedInput.slice(6);
    inputElement.placeholder = formatted;
  }

  // Show/hide error message
  if (errorEl) {
    if (errorMsg) {
      errorEl.style.display = 'block';
      errorEl.textContent = errorMsg;
      errorEl.style.color = '#d32f2f';
      errorEl.style.fontSize = '0.85rem';
      errorEl.style.marginTop = '4px';
    } else {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }
  }

  // Update input styling based on validation
  if (cleanedInput.length === 10 && isValid) {
    inputElement.style.borderColor = '#4caf50'; // Green for valid
    inputElement.style.boxShadow = '0 0 10px rgba(76,175,80,0.2)';
  } else if (cleanedInput.length > 0 && !isValid) {
    inputElement.style.borderColor = '#d32f2f'; // Red for invalid
    inputElement.style.boxShadow = '0 0 10px rgba(211,47,47,0.2)';
  } else {
    inputElement.style.borderColor = 'var(--border)';
    inputElement.style.boxShadow = 'none';
  }

  return isValid && cleanedInput.length === 10;
}

// Attach validation to phone input fields
function initPhoneValidation() {
  const phoneFields = [
    { id: 'modalTenantPhone', errorId: 'modalTenantPhoneError' },
    { id: 'tm-phone', errorId: 'tmPhoneError' },
    { id: 'ownerPhone', errorId: 'ownerPhoneError' },
    { id: 'newTenantPhone', errorId: 'newTenantPhoneError' }
  ];

  phoneFields.forEach(field => {
    const input = document.getElementById(field.id);
    if (input) {
      // Real-time validation on input
      input.addEventListener('input', function() {
        validatePhoneNumber(this, field.errorId);
      });

      // Validate on blur
      input.addEventListener('blur', function() {
        validatePhoneNumber(this, field.errorId);
      });
    }
  });
}

// Call this when page loads or modals open
document.addEventListener('DOMContentLoaded', function() {
  initPhoneValidation();
});

// ============== BILL GENERATION SYSTEM ==============

/**
 * Generate monthly invoices for all rooms
 */
function generateMonthlyBillsUI() {
  const building = prompt('เลือกอาคาร:\n1. rooms (ห้องแถว)\n2. nest (Nest Building)', '1');
  if (!building) return;

  const buildingName = building === '2' ? 'nest' : 'rooms';
  const month = prompt('เดือน (1-12):', new Date().getMonth() + 1);
  const year = prompt('ปี (ค.ศ.)', new Date().getFullYear() + 543);

  if (!month || !year) return;

  try {
    const buddhistYear = parseInt(year) - 543;
    const monthNum = parseInt(month);

    if (monthNum < 1 || monthNum > 12) {
      showToast('เดือนไม่ถูกต้อง', 'error');
      return;
    }

    // Generate bills
    const result = BillGenerator.generateMonthlyBills(buildingName, buddhistYear, monthNum);

    if (result.success) {
      showToast(`สร้างใบวางบิลสำเร็จ! จำนวน: ${result.count} ใบ อาคาร: ${buildingName} เดือน: ${monthNum}/${buddhistYear}`, 'success');

      // Show generated invoice list
      showGeneratedInvoices(buildingName, result.invoiceIds);

      // Update dashboard
      updateOccupancyDashboard();
    } else {
      showToast(`เกิดข้อผิดพลาด: ไม่สามารถสร้างใบวางบิล`, 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

/**
 * Display list of generated invoices
 */
function showGeneratedInvoices(building, invoiceIds) {
  let invoiceList = `📋 สร้างใบวางบิล ${invoiceIds.length} ใบ\n\n`;

  invoiceIds.slice(0, 10).forEach((id, idx) => {
    invoiceList += `${idx + 1}. ${id}\n`;
  });

  if (invoiceIds.length > 10) {
    invoiceList += `\n... และอีก ${invoiceIds.length - 10} ใบ`;
  }

  console.log(invoiceList);
}

/**
 * Download all invoices as PDF
 */
function downloadInvoicesPDF() {
  const building = prompt('เลือกอาคาร:\n1. rooms\n2. nest', '1');
  if (!building) return;

  const buildingName = building === '2' ? 'nest' : 'rooms';
  const allInvoices = InvoiceReceiptManager.getAllInvoices(buildingName);

  if (allInvoices.length === 0) {
    showToast('ไม่มีใบวางบิล', 'error');
    return;
  }

  showToast(`ดาวน์โหลด ${allInvoices.length} ใบวางบิล (ระบบจะดาวน์โหลดแต่ละไฟล์)`, 'warning');

  // Perf #3: lazy-load jsPDF/html2pdf before first use
  (typeof window.ensurePDFLibs === 'function' ? window.ensurePDFLibs() : Promise.resolve())
    .then(() => {
      allInvoices.forEach((invoice, idx) => {
        setTimeout(() => {
          const pdf = InvoicePDFGenerator.generateInvoicePDF(invoice);
          if (pdf) {
            InvoicePDFGenerator.downloadPDF(pdf, `INV-${invoice.id}.pdf`);
          }
        }, idx * 500);  // Delay to avoid browser blocking
      });
    })
    .catch(err => showToast('โหลด PDF library ล้มเหลว: ' + err.message, 'error'));
}

/**
 * Listen for new invoice notifications
 */
function listenForInvoiceNotifications() {
  window.addEventListener('new_invoices_generated', function() {
    console.log('🔔 New invoices generated!');
    showNotification('📄 สร้างใบวางบิลใหม่เข้ามา', 'success');
  });

  window.addEventListener('storage', function(e) {
    if (e.key === 'invoice_notifications') {
      const notifications = JSON.parse(e.newValue || '[]');
      if (notifications.length > 0) {
        const latest = notifications[notifications.length - 1];
        showNotification(`📄 มีใบวางบิลใหม่ ${latest.count} ใบ`, 'info');
      }
    }
  });
}

/**
 * Show notification on dashboard
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#4caf50' : '#2196f3'};
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    font-size: 14px;
    font-weight: 600;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// Add notification styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Initialize listeners on page load
listenForInvoiceNotifications();
listenForPaymentNotifications();

/**
 * Listen for payment notifications from tenant app
 */
function listenForPaymentNotifications() {
  // Listen for payment verified event
  window.addEventListener('payment_verified', function() {
    console.log('🔔 Payment verified from tenant app!');
    showNotification('✅ ได้รับเงินจากผู้เช่า', 'success');
    loadPaymentNotifications();
  });

  // Listen for receipt generated event
  window.addEventListener('receipt_generated', function() {
    console.log('🔔 Receipt generated!');
    showNotification('📄 ใบเสร็จรับเงินถูกสร้าง', 'success');
    loadPaymentNotifications();
  });

  // Listen for storage changes (for cross-tab sync)
  window.addEventListener('storage', function(e) {
    if (e.key === 'payment_notifications') {
      const notifications = JSON.parse(e.newValue || '[]');
      if (notifications.length > 0) {
        const latest = notifications[notifications.length - 1];
        if (latest.type === 'payment_verified') {
          showNotification(`✅ ห้อง ${latest.room} - โอนเงิน ฿${latest.amount.toLocaleString('th-TH')}`, 'success');
        } else if (latest.type === 'receipt_generated') {
          showNotification(`📄 ห้อง ${latest.room} - ใบเสร็จ ${latest.receiptId}`, 'success');
        }
      }
    }
  });

  // Load initial notifications
  loadPaymentNotifications();
}

/**
 * Load and display payment notifications
 */
function loadPaymentNotifications() {
  try {
    const notifications = JSON.parse(localStorage.getItem('payment_notifications') || '[]');

    if (notifications.length === 0) {
      console.log('📭 No payment notifications');
      const notifPanel = document.getElementById('paymentNotificationsList');
      if (notifPanel) {
        notifPanel.innerHTML = '<div style="text-align: center; color: #999; padding: 2rem;">📭 ยังไม่มีการชำระเงิน</div>';
      }
      return;
    }

    // Update notifications panel on payment verification page
    updatePaymentNotificationsPanel(notifications);

    // Display latest 5 notifications in console
    const recent = notifications.slice(-5).reverse();
    console.log('💳 Recent Payment Notifications:');
    recent.forEach((notif, idx) => {
      console.log(`${idx + 1}. [${notif.type}] ห้อง ${notif.room} - ฿${notif.amount?.toLocaleString('th-TH')} (${new Date(notif.timestamp).toLocaleString('th-TH')})`);

      // Update dashboard UI if payment verification section exists
      if (notif.type === 'payment_verified') {
        updatePaymentVerificationUI(notif);
      } else if (notif.type === 'receipt_generated') {
        updateReceiptGenerationUI(notif);
      }
    });

    // Update payment notification badge if it exists
    updatePaymentNotificationBadge(notifications.length);
  } catch (error) {
    console.warn('⚠️ Error loading payment notifications:', error);
  }
}

/**
 * Update payment notifications panel display
 */
function updatePaymentNotificationsPanel(notifications) {
  try {
    const notifPanel = document.getElementById('paymentNotificationsList');
    if (!notifPanel) return;

    // Show latest 10 notifications, newest first
    const recent = notifications.slice(-10).reverse();

    notifPanel.innerHTML = recent.map((notif, idx) => {
      const timeStr = new Date(notif.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(notif.timestamp).toLocaleDateString('th-TH');

      if (notif.type === 'payment_verified') {
        return `
          <div style="background: white; border-left: 4px solid #4caf50; padding: 1rem; margin-bottom: 0.5rem; border-radius: 4px; font-size: 0.9rem;">
            <div style="font-weight: 600; color: #2e7d32;">✅ ห้อง ${notif.room} - โอนเงิน ฿${notif.amount?.toLocaleString('th-TH')}</div>
            <div style="font-size: 0.8rem; color: #666; margin-top: 0.3rem;">
              ${dateStr} ${timeStr} | SlipID: ${notif.slipId?.substring(0, 10) || 'N/A'}...
            </div>
          </div>
        `;
      } else if (notif.type === 'receipt_generated') {
        return `
          <div style="background: white; border-left: 4px solid #1976d2; padding: 1rem; margin-bottom: 0.5rem; border-radius: 4px; font-size: 0.9rem;">
            <div style="font-weight: 600; color: #1565c0;">📄 ห้อง ${notif.room} - ใบเสร็จ ฿${notif.amount?.toLocaleString('th-TH')}</div>
            <div style="font-size: 0.8rem; color: #666; margin-top: 0.3rem;">
              ${dateStr} ${timeStr} | ReceiptID: ${notif.receiptId?.substring(0, 10) || 'N/A'}... | Verified: ${notif.verified ? '✅' : '❌'}
            </div>
          </div>
        `;
      }
      return '';
    }).join('');
  } catch (error) {
    console.warn('⚠️ Error updating notifications panel:', error);
  }
}

/**
 * Update payment verification UI in admin dashboard
 */
function updatePaymentVerificationUI(notification) {
  try {
    // Find payment section in dashboard
    const paymentSection = document.querySelector('[data-section="payment-verification"]');
    if (!paymentSection) return;

    // Add notification item to payment list
    const notifItem = document.createElement('div');
    notifItem.className = 'payment-notification-item';
    notifItem.style.cssText = `
      background: #e8f5e9;
      border-left: 4px solid #4caf50;
      padding: 12px;
      margin: 8px 0;
      border-radius: 4px;
      font-size: 14px;
    `;

    const timeStr = new Date(notification.timestamp).toLocaleTimeString('th-TH');
    notifItem.innerHTML = `
      <div style="font-weight: 600; color: #2e7d32;">
        ✅ ห้อง ${_esc(notification.room)} - โอนเงิน ฿${notification.amount?.toLocaleString('th-TH')}
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">
        เวลา: ${timeStr} | SlipID: ${_esc(notification.slipId || 'N/A')}
      </div>
    `;

    // Insert at top of payment list
    const paymentList = paymentSection.querySelector('.payment-list') || paymentSection;
    if (paymentList.firstChild) {
      paymentList.insertBefore(notifItem, paymentList.firstChild);
    } else {
      paymentList.appendChild(notifItem);
    }

    // Keep only last 10 items
    const items = paymentList.querySelectorAll('.payment-notification-item');
    if (items.length > 10) {
      items[items.length - 1].remove();
    }
  } catch (error) {
    console.warn('⚠️ Error updating payment verification UI:', error);
  }
}

/**
 * Update receipt generation UI in admin dashboard
 */
function updateReceiptGenerationUI(notification) {
  try {
    // Find receipt section in dashboard
    const receiptSection = document.querySelector('[data-section="receipt-list"]');
    if (!receiptSection) return;

    // Add receipt item
    const receiptItem = document.createElement('div');
    receiptItem.className = 'receipt-notification-item';
    receiptItem.style.cssText = `
      background: #e3f2fd;
      border-left: 4px solid #1976d2;
      padding: 12px;
      margin: 8px 0;
      border-radius: 4px;
      font-size: 14px;
    `;

    const timeStr = new Date(notification.timestamp).toLocaleTimeString('th-TH');
    receiptItem.innerHTML = `
      <div style="font-weight: 600; color: #1565c0;">
        📄 ใบเสร็จ ห้อง ${notification.room} - ฿${notification.amount?.toLocaleString('th-TH')}
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">
        เวลา: ${timeStr} | ReceiptID: ${notification.receiptId || 'N/A'} | Verified: ${notification.verified ? '✅' : '❌'}
      </div>
    `;

    // Insert at top of receipt list
    const receiptList = receiptSection.querySelector('.receipt-list') || receiptSection;
    if (receiptList.firstChild) {
      receiptList.insertBefore(receiptItem, receiptList.firstChild);
    } else {
      receiptList.appendChild(receiptItem);
    }

    // Keep only last 10 items
    const items = receiptList.querySelectorAll('.receipt-notification-item');
    if (items.length > 10) {
      items[items.length - 1].remove();
    }
  } catch (error) {
    console.warn('⚠️ Error updating receipt generation UI:', error);
  }
}

/**
 * Update payment notification badge
 */
function updatePaymentNotificationBadge(count) {
  try {
    let badge = document.querySelector('[data-badge="payment-count"]');
    if (!badge) {
      // Create badge if doesn't exist
      badge = document.createElement('span');
      badge.setAttribute('data-badge', 'payment-count');
      badge.style.cssText = `
        display: inline-block;
        background: #f44336;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        text-align: center;
        line-height: 24px;
        font-size: 12px;
        font-weight: bold;
        margin-left: 4px;
      `;
      const paymentTab = document.querySelector('[data-nav="💳"]') || document.querySelector('button:contains("💳")');
      if (paymentTab) {
        paymentTab.appendChild(badge);
      }
    }

    if (badge && count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-block';
    } else if (badge) {
      badge.style.display = 'none';
    }
  } catch (error) {
    console.warn('⚠️ Error updating payment notification badge:', error);
  }
}

/**
 * Get payment notification summary
 */
/**
 * Clear payment notifications (admin function)
 */
function clearPaymentNotifications() {
  if (confirm('คุณแน่ใจที่จะล้างประวัติการชำระเงินทั้งหมด?')) {
    localStorage.setItem('payment_notifications', '[]');
    showNotification('✅ ล้างประวัติเรียบร้อย', 'success');
    loadPaymentNotifications();
  }
}

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

// ===== SERVICE PROVIDERS MANAGEMENT =====
function initServiceProvidersPage() {
  loadAndRenderServiceProviders();
}

// ===== ServiceProvidersStore (Phase 4 2026-04-19) =====
// Single Source of Truth: Firestore system/serviceProviders.items
//   localStorage cache only; cloud canonical so admin from any device sees same list
window.ServiceProvidersStore = window.ServiceProvidersStore || (function(){
  let cache = null;            // null = not loaded yet
  const listeners = new Set();
  let unsub = null;

  function _local() {
    try { return JSON.parse(localStorage.getItem('service_providers_data') || '[]'); }
    catch(e) { return []; }
  }
  function _writeLocal(arr) {
    try { localStorage.setItem('service_providers_data', JSON.stringify(arr)); } catch(e){}
  }
  function getAll() { return cache !== null ? cache : _local(); }
  function onChange(fn) {
    listeners.add(fn);
    if (cache !== null) { try { fn(cache); } catch(e){} }
    return () => listeners.delete(fn);
  }
  function _notify() { listeners.forEach(fn => { try { fn(getAll()); } catch(e){} }); }

  async function _push(items) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return false;
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.setDoc(fs.doc(db, 'system', 'serviceProviders'), {
        items, updatedAt: new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (e) { console.warn('ServiceProvidersStore push:', e?.message); return false; }
  }
  async function setAll(items) {
    cache = Array.isArray(items) ? items : [];
    _writeLocal(cache);
    _notify();
    await _push(cache);
  }
  async function add(provider) {
    const list = getAll().slice();
    list.push(provider);
    return setAll(list);
  }
  async function update(id, changes) {
    const list = getAll().slice();
    const idx = list.findIndex(p => p.id === id);
    if (idx < 0) return false;
    list[idx] = { ...list[idx], ...changes, updatedDate: new Date().toISOString() };
    return setAll(list);
  }
  async function remove(id) {
    return setAll(getAll().filter(p => p.id !== id));
  }
  async function migrateLocalToCloud() {
    return _push(_local()) ? { pushed: _local().length } : { pushed: 0 };
  }
  function subscribe() {
    if (unsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribe, 1500); return;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      unsub = fs.onSnapshot(fs.doc(db, 'system', 'serviceProviders'), snap => {
        const items = snap.exists() ? ((snap.data() || {}).items || []) : [];
        cache = items;
        _writeLocal(items);
        _notify();
      }, err => console.warn('serviceProviders listen:', err?.message));
    } catch(e) { console.warn('subscribe:', e); }
  }
  if (typeof window !== 'undefined') setTimeout(subscribe, 800);
  return { getAll, onChange, setAll, add, update, remove, migrateLocalToCloud, subscribe };
})();

function loadAndRenderServiceProviders() {
  const list = document.getElementById('providersList');
  if (!list) return;

  // Phase 4 race fix: auto-rerender when cloud snapshot arrives after initial render
  if (typeof ServiceProvidersStore !== 'undefined' && !window._spRendererSubscribed) {
    window._spRendererSubscribed = true;
    ServiceProvidersStore.onChange(() => {
      // Only rerender if the providers list element is currently in the DOM
      if (document.getElementById('providersList')) loadAndRenderServiceProviders();
    });
  }

  let providers = (typeof ServiceProvidersStore !== 'undefined')
    ? ServiceProvidersStore.getAll()
    : JSON.parse(localStorage.getItem('service_providers_data') || '[]');
  const searchVal = document.getElementById('providerSearch')?.value.toLowerCase() || '';

  if (searchVal) {
    providers = providers.filter(p =>
      p.name.toLowerCase().includes(searchVal) ||
      p.type.toLowerCase().includes(searchVal) ||
      p.phone.includes(searchVal)
    );
  }

  if (providers.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No service providers yet</div>';
    return;
  }

  list.innerHTML = providers.map(p => `
    <div class="card" style="margin-bottom: 1rem; border-left: 4px solid var(--green);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
        <div>
          <div style="font-weight: 700; font-size: 1rem;">📞 ${p.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Type: <strong>${p.type}</strong></div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="editServiceProvider('${p.id}')" class="compact-btn compact-btn-edit">✏️ Edit</button>
          <button onclick="deleteServiceProvider('${p.id}')" class="compact-btn compact-btn-delete">🗑️ Delete</button>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
        <div>📱 Phone: <strong>${p.phone}</strong></div>
        <div>📧 Email: <strong>${p.email || '-'}</strong></div>
        <div style="grid-column: 1/-1;">🌐 Website: <strong><a href="${p.website}" target="_blank" style="color: var(--blue);">${p.website || '-'}</a></strong></div>
      </div>
    </div>
  `).join('');
}

function toggleAddProviderForm() {
  const form = document.getElementById('addProviderForm');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('providerType').focus();
  }
}

async function saveServiceProvider() {
  const type = document.getElementById('providerType')?.value.trim();
  const name = document.getElementById('providerName')?.value.trim();
  const phone = document.getElementById('providerPhone')?.value.trim();
  const email = document.getElementById('providerEmail')?.value.trim();
  const website = document.getElementById('providerWebsite')?.value.trim();

  if (!type || !name || !phone) {
    showToast('Please fill in Type, Name, and Phone', 'warning');
    return;
  }

  const newProvider = {
    id: 'sp_' + Date.now(),
    type, name, phone, email, website,
    createdDate: new Date().toISOString()
  };

  // Phase 4: dual-write via ServiceProvidersStore (Firestore + localStorage)
  await ServiceProvidersStore.add(newProvider);

  ['providerType','providerName','providerPhone','providerEmail','providerWebsite']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  toggleAddProviderForm();
  loadAndRenderServiceProviders();
  showToast('✅ Service provider added successfully (☁️ Firestore)', 'success');
}

function editServiceProvider(id) {
  const providers = ServiceProvidersStore.getAll();
  const provider = providers.find(p => p.id === id);
  if (!provider) return;

  document.getElementById('providerType').value = provider.type;
  document.getElementById('providerName').value = provider.name;
  document.getElementById('providerPhone').value = provider.phone;
  document.getElementById('providerEmail').value = provider.email || '';
  document.getElementById('providerWebsite').value = provider.website || '';

  const form = document.getElementById('addProviderForm');
  form.style.display = 'block';

  const button = form.querySelector('button.btn-receipt');
  const originalText = button.textContent;
  button.textContent = '✏️ Update Provider';
  button.onclick = async function() {
    const changes = {
      type: document.getElementById('providerType').value.trim(),
      name: document.getElementById('providerName').value.trim(),
      phone: document.getElementById('providerPhone').value.trim(),
      email: document.getElementById('providerEmail').value.trim(),
      website: document.getElementById('providerWebsite').value.trim()
    };
    const ok = await ServiceProvidersStore.update(id, changes);
    if (ok !== false) {
      ['providerType','providerName','providerPhone','providerEmail','providerWebsite']
        .forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
      form.style.display = 'none';
      button.textContent = originalText;
      button.onclick = null;
      loadAndRenderServiceProviders();
      showToast('✅ Service provider updated', 'success');
    }
  };
}

async function deleteServiceProvider(id) {
  if (!confirm('Are you sure you want to delete this provider?')) return;
  await ServiceProvidersStore.remove(id);
  loadAndRenderServiceProviders();
  showToast('✅ Service provider deleted', 'success');
}

// ===== COMMUNITY EVENTS MANAGEMENT =====
let _eventsUnsub = null;
// ===== CommunityEventsStore (2026-04-19) — Firestore canonical =====
window.CommunityEventsStore = window.CommunityEventsStore || (function(){
  let cache = null;
  const listeners = new Set();
  let unsub = null;
  function _local() {
    try { return JSON.parse(localStorage.getItem('community_events_data') || '[]'); }
    catch(e) { return []; }
  }
  function _writeLocal(arr) {
    try { localStorage.setItem('community_events_data', JSON.stringify(arr)); } catch(e){}
  }
  function getAll() { return cache !== null ? cache : _local(); }
  function getById(id) { return getAll().find(e => e.id === id) || null; }
  function onChange(fn) {
    listeners.add(fn);
    if (cache !== null) { try { fn(cache); } catch(e){} }
    return () => listeners.delete(fn);
  }
  function _notify() { listeners.forEach(fn => { try { fn(getAll()); } catch(e){} }); }
  async function setOne(ev) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      // Local-only fallback
      const all = getAll().filter(e => e.id !== ev.id);
      all.push(ev);
      cache = all; _writeLocal(all); _notify();
      return false;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.setDoc(fs.doc(db, 'communityEvents', ev.id), ev, { merge: true });
      return true;
    } catch (e) { console.warn('CommunityEventsStore setOne:', e?.message); return false; }
  }
  async function remove(id) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      cache = getAll().filter(e => e.id !== id);
      _writeLocal(cache); _notify();
      return false;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.deleteDoc(fs.doc(db, 'communityEvents', id));
      return true;
    } catch (e) { console.warn('CommunityEventsStore remove:', e?.message); return false; }
  }
  function subscribe() {
    if (unsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribe, 1500); return;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      unsub = fs.onSnapshot(fs.collection(db, 'communityEvents'), snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cache = docs;
        _writeLocal(docs);
        _notify();
      }, err => console.warn('communityEvents listen:', err?.message));
    } catch(e) { console.warn('subscribe:', e); }
  }
  if (typeof window !== 'undefined') setTimeout(subscribe, 800);
  return { getAll, getById, onChange, setOne, remove, subscribe };
})();

function initCommunityEventsPage() {
  loadAndRenderCommunityEvents();
  // Auto-rerender on cloud snapshot (F5 race fix)
  if (typeof CommunityEventsStore !== 'undefined' && !window._eventsRendererSubscribed) {
    window._eventsRendererSubscribed = true;
    CommunityEventsStore.onChange(() => {
      if (document.getElementById('eventsList')) loadAndRenderCommunityEvents();
    });
  }
  CommunityEventsStore.subscribe(); // idempotent
}

function loadAndRenderCommunityEvents() {
  const list = document.getElementById('eventsList');
  if (!list) return;

  let events = (typeof CommunityEventsStore !== 'undefined')
    ? CommunityEventsStore.getAll().slice()
    : JSON.parse(localStorage.getItem('community_events_data') || '[]');
  const searchVal = document.getElementById('eventSearch')?.value.toLowerCase() || '';
  const buildingFilter = document.getElementById('eventBuildingFilter')?.value || 'all';

  if (searchVal) {
    events = events.filter(e =>
      (e.title || '').toLowerCase().includes(searchVal) ||
      (e.location || '').toLowerCase().includes(searchVal)
    );
  }
  if (buildingFilter !== 'all') {
    events = events.filter(e => !e.building || e.building === buildingFilter || e.building === 'all');
  }

  // Sort: upcoming first, then past
  const today = new Date(); today.setHours(0,0,0,0);
  events.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    const aPast = da < today, bPast = db < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return da - db;
  });

  if (events.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No events scheduled</div>';
    return;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  list.innerHTML = events.map(e => {
    const isPast = new Date(e.date) < today;
    const bldgLabel = e.building === 'nest' ? '🏢 Nest' : e.building === 'rooms' ? '🏠 ห้องแถว' : '🌐 ทุกตึก';
    return `
    <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${isPast ? '#999' : '#ff8f00'}; ${isPast ? 'opacity:0.65;' : ''}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 1rem;">📅 ${esc(e.title)} ${isPast ? '<span style="font-size:.7rem;color:#999;">(ผ่านแล้ว)</span>' : ''}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">
            ${bldgLabel} | 📍 ${esc(e.location)} | 🕐 ${esc(e.time)}
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="editEvent('${esc(e.id)}')" class="compact-btn compact-btn-edit">✏️</button>
          <button onclick="deleteEvent('${esc(e.id)}')" class="compact-btn compact-btn-delete">🗑️</button>
        </div>
      </div>
      <div style="font-size: 0.9rem; color: var(--text);">📝 ${esc(e.description || '-')}</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">📅 ${new Date(e.date).toLocaleDateString('th-TH')}</div>
    </div>
  `;}).join('');
}

let _editingEventId = null;
function toggleAddEventForm() {
  const form = document.getElementById('addEventForm');
  if (!form) return;
  if (form.style.display !== 'none') {
    form.style.display = 'none';
    _editingEventId = null;
    return;
  }
  form.style.display = 'block';
  document.getElementById('eventTitle')?.focus();
}

async function saveCommunityEvent() {
  const title = document.getElementById('eventTitle')?.value.trim();
  const date = document.getElementById('eventDate')?.value;
  const time = document.getElementById('eventTime')?.value;
  const location = document.getElementById('eventLocation')?.value.trim();
  const description = document.getElementById('eventDescription')?.value.trim();
  const building = document.getElementById('eventBuilding')?.value || 'all';

  if (!title || !date || !time || !location) {
    showToast('Please fill in Title, Date, Time, and Location', 'warning');
    return;
  }

  const ev = _editingEventId
    ? { ...(CommunityEventsStore.getById(_editingEventId) || {}),
        title, date, time, location, description, building,
        updatedDate: new Date().toISOString() }
    : { id: 'evt_' + Date.now(),
        title, date, time, location, description, building,
        createdDate: new Date().toISOString() };

  await CommunityEventsStore.setOne(ev);

  ['eventTitle','eventDate','eventTime','eventLocation','eventDescription']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const bldEl = document.getElementById('eventBuilding'); if (bldEl) bldEl.value = 'all';
  const wasEdit = !!_editingEventId;
  _editingEventId = null;
  toggleAddEventForm();
  showToast(wasEdit ? '✅ อัพเดทกิจกรรมแล้ว (☁️ Firestore)' : '✅ สร้างกิจกรรมแล้ว (☁️ Firestore)', 'success');
}

function editEvent(id) {
  const ev = CommunityEventsStore.getById(id);
  if (!ev) { showToast('ไม่พบกิจกรรม', 'warning'); return; }
  _editingEventId = id;
  const form = document.getElementById('addEventForm');
  if (form) form.style.display = 'block';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('eventTitle', ev.title);
  set('eventDate', ev.date);
  set('eventTime', ev.time);
  set('eventLocation', ev.location);
  set('eventDescription', ev.description);
  set('eventBuilding', ev.building || 'all');
  document.getElementById('eventTitle')?.focus();
}

async function deleteEvent(id) {
  if (!confirm('Are you sure you want to delete this event?')) return;
  await CommunityEventsStore.remove(id);
  showToast('✅ Event deleted', 'success');
}

// ===== COMMUNITY DOCUMENTS MANAGEMENT =====
let _docsUnsub = null;
function initCommunityDocsPage() {
  loadAndRenderCommunityDocs();
  if (_docsUnsub) return;
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const col = fs.collection(db, 'communityDocuments');
    _docsUnsub = fs.onSnapshot(col, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const local = JSON.parse(localStorage.getItem('community_documents_data') || '[]');
      const byId = new Map();
      local.forEach(d => byId.set(d.id, d));
      docs.forEach(d => byId.set(d.id, d));
      localStorage.setItem('community_documents_data', JSON.stringify(Array.from(byId.values())));
      loadAndRenderCommunityDocs();
    }, err => console.warn('docs onSnapshot failed:', err));
  } catch(e) { console.warn('docs subscribe failed:', e); }
}

function loadAndRenderCommunityDocs() {
  const list = document.getElementById('docsList');
  if (!list) return;

  let docs = JSON.parse(localStorage.getItem('community_documents_data') || '[]');
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
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('docTitle').focus();
  }
}

function saveCommunityDocument() {
  const title = document.getElementById('docTitle')?.value.trim();
  const category = document.getElementById('docCategory')?.value;
  const fileType = document.getElementById('docType')?.value.trim();
  const fileUrl = document.getElementById('docUrl')?.value.trim();
  const description = document.getElementById('docDescription')?.value.trim();

  if (!title || !category || !fileUrl) {
    showToast('Please fill in Title, Category, and URL', 'warning');
    return;
  }

  let docs = JSON.parse(localStorage.getItem('community_documents_data') || '[]');
  const newDoc = {
    id: 'doc_' + Date.now(),
    title: title,
    category: category,
    description: description,
    fileUrl: fileUrl,
    fileType: fileType,
    building: 'rooms',
    uploadedDate: new Date().toISOString()
  };

  docs.push(newDoc);
  localStorage.setItem('community_documents_data', JSON.stringify(docs));
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      fs.setDoc(fs.doc(fs.collection(db, 'communityDocuments'), newDoc.id), newDoc);
    } catch(e) { console.warn('Firestore doc save failed:', e); }
  }

  document.getElementById('docTitle').value = '';
  document.getElementById('docCategory').value = '';
  document.getElementById('docType').value = '';
  document.getElementById('docUrl').value = '';
  document.getElementById('docDescription').value = '';

  toggleAddDocForm();
  loadAndRenderCommunityDocs();
  showToast('✅ Document added successfully', 'success');
}

function deleteDocument(id) {
  if (!confirm('Are you sure you want to delete this document?')) return;

  let docs = JSON.parse(localStorage.getItem('community_documents_data') || '[]');
  docs = docs.filter(d => d.id !== id);
  localStorage.setItem('community_documents_data', JSON.stringify(docs));
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      fs.deleteDoc(fs.doc(fs.collection(db, 'communityDocuments'), id));
    } catch(e) { console.warn('Firestore doc delete failed:', e); }
  }
  loadAndRenderCommunityDocs();
  showToast('✅ Document deleted', 'success');
}

// ===== PET REGISTRATION APPROVALS =====
let _petsUnsub = null;
let _petsFromFirestore = [];
function initPetApprovalsPage() {
  loadAndRenderPetApprovals();
  if (_petsUnsub) return;
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const col = fs.collection(db, 'petApprovals');
    _petsUnsub = fs.onSnapshot(col, snap => {
      _petsFromFirestore = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      loadAndRenderPetApprovals();
    }, err => console.warn('pets onSnapshot failed:', err));
  } catch(e) { console.warn('pets subscribe failed:', e); }
}

function loadAndRenderPetApprovals() {
  const list = document.getElementById('petsList');
  if (!list) return;

  // Load from Firestore first, then merge localStorage (fallback)
  const byId = new Map();
  (_petsFromFirestore || []).forEach(p => byId.set(p.id, { ...p, source: 'firestore' }));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tenant_pets_')) {
      const pets = JSON.parse(localStorage.getItem(key) || '[]');
      const parts = key.split('_');
      const building = parts[2], room = parts[3];
      pets.forEach(p => {
        if (!byId.has(p.id)) byId.set(p.id, { ...p, room: p.room || room, building: p.building || building, storageKey: key });
      });
    }
  }
  let allPets = Array.from(byId.values());

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
    const statusColor = p.status === 'approved' ? '#4caf50' : p.status === 'rejected' ? '#f44336' : '#ff9800';

    return `
      <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${statusColor};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
          <div>
            <div style="font-weight: 700; font-size: 1rem;">🐾 ${p.name} (${p.type})</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Room: <strong>${p.room}</strong></div>
          </div>
          <span style="padding: 0.4rem 0.8rem; border-radius: 20px; background: ${statusColor}; color: white; font-size: 0.85rem; font-weight: 600;">${statusBadge}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.6rem 1rem; font-size: 0.9rem; margin-bottom: 0.8rem;">
          <div>🐕 สายพันธุ์: <strong>${p.breed || '-'}</strong></div>
          <div>⚧️ เพศ: <strong>${p.gender || '-'}</strong></div>
          <div>🎂 อายุ: <strong>${p.age || '-'}</strong></div>
          ${p.weight ? `<div>⚖️ น้ำหนัก: <strong>${p.weight}</strong></div>` : ''}
          ${p.color ? `<div>🎨 สี: <strong>${p.color}</strong></div>` : ''}
        </div>
        <div style="font-size:0.85rem; margin-bottom:0.8rem; padding:6px 10px; border-radius:8px; background:${p.isVaccinated ? '#f0fdf4' : '#fef2f2'}; color:${p.isVaccinated ? '#166534' : '#991b1b'};">
          💉 วัคซีน: <strong>${p.isVaccinated ? '✅ ฉีดแล้ว' : '❌ ยังไม่ฉีด'}</strong>
          ${p.vaxDate ? ` · วันฉีด: ${p.vaxDate}` : ''}
          ${p.vaxExpiry ? ` · หมดอายุ: ${p.vaxExpiry}` : ''}
        </div>
        ${p.notes ? `<div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.8rem;">📝 ${p.notes}</div>` : ''}
        ${p.status === 'pending' ? `
          <div style="display: flex; gap: 0.5rem;">
            <button onclick="approvePet('${p.id}', '${p.room}', '${p.storageKey}')" class="compact-btn compact-btn-view">✅ Approve</button>
            <button onclick="rejectPet('${p.id}', '${p.room}', '${p.storageKey}')" class="compact-btn compact-btn-delete">❌ Reject</button>
          </div>
        ` : `
          <button onclick="removePetApproval('${p.id}', '${p.room}', '${p.storageKey}')" class="compact-btn compact-btn-delete">🗑️ Remove</button>
        `}
      </div>
    `;
  }).join('');
}

function filterPetsByStatus(status) {
  loadAndRenderPetApprovals();
}

async function _writePetToFirestore(id, patch){
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const docRef = fs.doc(fs.collection(db, 'petApprovals'), id);
    await fs.setDoc(docRef, patch, { merge: true });
  } catch(e) { console.warn('Firestore pet update failed:', e); }
}
async function _deletePetFromFirestore(id){
  if (!window.firebase?.firestore) return;
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const docRef = fs.doc(fs.collection(db, 'petApprovals'), id);
    await fs.deleteDoc(docRef);
  } catch(e) { console.warn('Firestore pet delete failed:', e); }
}

function approvePet(id, room, storageKey) {
  if (storageKey) {
    const pets = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const pet = pets.find(p => p.id === id);
    if (pet) { pet.status = 'approved'; pet.approvalDate = new Date().toISOString(); localStorage.setItem(storageKey, JSON.stringify(pets)); }
  }
  _writePetToFirestore(id, { status: 'approved', approvalDate: new Date().toISOString() });
  loadAndRenderPetApprovals();
  showToast('✅ Pet approved', 'success');
}

function rejectPet(id, room, storageKey) {
  if (!confirm('Are you sure you want to reject this pet registration?')) return;
  if (storageKey) {
    const pets = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const pet = pets.find(p => p.id === id);
    if (pet) { pet.status = 'rejected'; pet.rejectionDate = new Date().toISOString(); localStorage.setItem(storageKey, JSON.stringify(pets)); }
  }
  _writePetToFirestore(id, { status: 'rejected', rejectionDate: new Date().toISOString() });
  loadAndRenderPetApprovals();
  showToast('✅ Pet rejected', 'success');
}

function removePetApproval(id, room, storageKey) {
  if (!confirm('Are you sure you want to remove this pet registration?')) return;
  if (storageKey) {
    let pets = JSON.parse(localStorage.getItem(storageKey) || '[]');
    pets = pets.filter(p => p.id !== id);
    localStorage.setItem(storageKey, JSON.stringify(pets));
  }
  _deletePetFromFirestore(id);
  loadAndRenderPetApprovals();
  showToast('✅ Pet registration removed', 'success');
}

// ===== LEASE RENEWAL ALERTS SETTINGS =====
function initLeaseSettingsPage() {
  loadAndRenderLeaseSettings();
}

function loadAndRenderLeaseSettings() {
  // Load current settings
  const settings = JSON.parse(localStorage.getItem('lease_alert_settings') || '{"threshold": 60, "severity": "warning"}');
  document.getElementById('alertThreshold').value = settings.threshold || 60;
  document.getElementById('alertSeverity').value = settings.severity || 'warning';

  // Load lease expirations
  loadAndRenderLeaseExpirations();
}

function loadAndRenderLeaseExpirations() {
  const container = document.getElementById('leaseExpiryList');
  if (!container) return;

  // Get all leases
  const leases = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('lease_')) {
      try {
        const lease = JSON.parse(localStorage.getItem(key));
        if (lease && lease.status === 'active') leases.push(lease);
      } catch (e) {}
    }
  }

  const threshold = parseInt(document.getElementById('alertThreshold')?.value || 60);
  const today = new Date();
  const expiringLeases = [];

  leases.forEach(lease => {
    const endDate = new Date(lease.moveOutDate || lease.moveInDate);
    if (lease.duration) {
      endDate.setMonth(endDate.getMonth() + lease.duration);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const daysUntilExpiry = Math.floor((endDate - today) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry >= 0 && daysUntilExpiry <= threshold) {
      expiringLeases.push({ ...lease, daysUntilExpiry, expiryDate: endDate });
    }
  });

  expiringLeases.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  if (expiringLeases.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">✅ No leases expiring soon</div>';
    return;
  }

  container.innerHTML = expiringLeases.map(lease => {
    let urgency = 'notice';
    if (lease.daysUntilExpiry <= 7) urgency = 'urgent';
    else if (lease.daysUntilExpiry <= 30) urgency = 'warning';

    const urgencyColor = urgency === 'urgent' ? '#f44336' : urgency === 'warning' ? '#ff9800' : '#2196f3';
    const urgencyIcon = urgency === 'urgent' ? '🚨' : urgency === 'warning' ? '⚠️' : 'ℹ️';

    return `
      <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${urgencyColor};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 1rem;">🏠 Room ${lease.roomId}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">
              Building: <strong>${lease.building === 'rooms' ? 'Rooms Building' : 'Nest Building'}</strong>
            </div>
          </div>
          <span style="padding: 0.6rem 1rem; border-radius: 20px; background: ${urgencyColor}; color: white; font-size: 0.85rem; font-weight: 600; white-space: nowrap;">${urgencyIcon} ${lease.daysUntilExpiry} days</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem; margin-top: 1rem;">
          <div>👤 Tenant: <strong>${lease.tenantName || lease.tenantId}</strong></div>
          <div>📅 Expires: <strong>${lease.expiryDate.toLocaleDateString('th-TH')}</strong></div>
        </div>
      </div>
    `;
  }).join('');
}

function saveLeaseAlertSettings() {
  const threshold = parseInt(document.getElementById('alertThreshold')?.value || 60);
  const severity = document.getElementById('alertSeverity')?.value || 'warning';

  if (threshold < 1 || threshold > 365) {
    showToast('Threshold must be between 1 and 365 days', 'warning');
    return;
  }

  const settings = { threshold, severity };
  localStorage.setItem('lease_alert_settings', JSON.stringify(settings));
  showToast('✅ Lease alert settings saved', 'success');
  loadAndRenderLeaseSettings();
}

// ===== COMPLAINTS PAGE =====
// ===== RequestsStore — single facade for complaints/maintenance/housekeeping =====
// Phase 3 (2026-04-19): Source of truth = Firestore complaints/{id} for complaints,
// RTDB for maintenance + housekeeping. localStorage retained as offline cache only.
window.RequestsStore = window.RequestsStore || (function(){
  const cache = { complaints: [], maintenance: [], housekeeping: [] };
  const listeners = { complaints: new Set(), maintenance: new Set(), housekeeping: new Set() };
  const subscribed = { complaints: false, maintenance: false, housekeeping: false };

  function _legacy(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
  }

  function getComplaints() {
    if (cache.complaints.length === 0) return _legacy('complaints_data');
    return cache.complaints;
  }
  function getMaintenance() {
    if (cache.maintenance.length === 0) return _legacy('maintenance_data');
    return cache.maintenance;
  }
  function getHousekeeping() {
    if (cache.housekeeping.length === 0) return _legacy('housekeeping_data');
    return cache.housekeeping;
  }

  function onChange(type, fn) {
    if (!listeners[type]) return () => {};
    listeners[type].add(fn);
    // Catch-up: fire immediately if cache populated
    if (cache[type].length > 0) {
      try { fn(cache[type]); } catch(e) {}
    }
    return () => listeners[type].delete(fn);
  }

  function _notify(type) {
    listeners[type].forEach(fn => { try { fn(cache[type]); } catch(e) {} });
  }

  function _ingest(type, list) {
    cache[type] = list || [];
    // Backfill localStorage for offline cache
    try { localStorage.setItem(`${type}_data`, JSON.stringify(cache[type])); } catch(e) {}
    _notify(type);
  }

  function subscribeComplaints() {
    if (subscribed.complaints) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribeComplaints, 1500);
      return;
    }
    subscribed.complaints = true;
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      fs.onSnapshot(fs.collection(db, 'complaints'), snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Merge with any local-only entries (Firestore wins on collision)
        const local = _legacy('complaints_data');
        const byId = new Map();
        local.forEach(c => byId.set(c.id, c));
        docs.forEach(c => byId.set(c.id, c));
        _ingest('complaints', Array.from(byId.values()));
      }, err => console.warn('RequestsStore complaints listen:', err?.message));
    } catch(e) { subscribed.complaints = false; console.warn('subscribeComplaints:', e); }
  }

  // Auto-subscribe complaints on load (admin dashboard always wants live data)
  if (typeof window !== 'undefined') setTimeout(subscribeComplaints, 800);

  return { getComplaints, getMaintenance, getHousekeeping, onChange,
           subscribeComplaints, _ingest };
})();

let _complaintsUnsub = null;
function initComplaintsPage() {
  console.log('✅ Complaints page initialized');
  // Phase 3: pull from RequestsStore (cache + Firestore subscription auto-runs)
  renderComplaints(window.RequestsStore.getComplaints());
  if (typeof window !== 'undefined' && !window._complaintsRendererSubscribed) {
    window._complaintsRendererSubscribed = true;
    window.RequestsStore.onChange('complaints', list => renderComplaints(list));
  }
  // Idempotent: ensure subscription is live (no-op if already subscribed)
  window.RequestsStore.subscribeComplaints();
}

function renderComplaints(complaints){
  const open     = complaints.filter(c => c.status === 'open').length;
  const inProg   = complaints.filter(c => c.status === 'in-progress').length;
  const resolved = complaints.filter(c => c.status === 'resolved').length;

  const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setTxt('totalComplaintsCount', complaints.length);
  setTxt('openComplaintsCount', open);
  setTxt('inProgressComplaintsCount', inProg);
  setTxt('resolvedComplaintsCount', resolved);

  const list = document.getElementById('complaintsList');
  if (!list) return;

  if (complaints.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีการร้องเรียน</div>';
    return;
  }

  const statusColor = { 'open': '#f57c00', 'in-progress': '#1976d2', 'resolved': '#388e3c' };
  const statusLabel = { 'open': '🔴 Open', 'in-progress': '🟡 In Progress', 'resolved': '🟢 Resolved' };

  const sorted = complaints.slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  list.innerHTML = sorted.map(c => {
    const color = statusColor[c.status] || '#999';
    const label = statusLabel[c.status] || c.status;
    const date  = c.createdAt ? new Date(c.createdAt).toLocaleDateString('th-TH') : '-';
    return `
      <div style="background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);padding:1.2rem;margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-weight:700;">${c.title || '(ไม่มีหัวข้อ)'}</span>
          <span style="font-size:0.8rem;color:${color};font-weight:600;">${label}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem;">ห้อง ${c.room || '-'} · ${date}</div>
        <div style="font-size:0.9rem;">${c.desc || ''}</div>
        <div style="margin-top:0.8rem;display:flex;gap:0.5rem;">
          ${c.status !== 'resolved' ? `<button onclick="updateComplaintStatus('${c.id}','resolved')" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:#e8f5e9;color:#388e3c;border:1px solid #c8e6c9;border-radius:4px;cursor:pointer;">✅ Resolve</button>` : ''}
          ${c.status === 'open' ? `<button onclick="updateComplaintStatus('${c.id}','in-progress')" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:#e3f2fd;color:#1976d2;border:1px solid #bbdefb;border-radius:4px;cursor:pointer;">🔄 In Progress</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function updateComplaintStatus(id, newStatus) {
  const complaints = JSON.parse(localStorage.getItem('complaints_data') || '[]');
  const idx = complaints.findIndex(c => c.id === id);
  if (idx >= 0) {
    complaints[idx].status = newStatus;
    complaints[idx].updatedAt = new Date().toISOString();
    localStorage.setItem('complaints_data', JSON.stringify(complaints));
  }
  // Update Firestore
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const docRef = fs.doc(fs.collection(db, 'complaints'), id);
      await fs.setDoc(docRef, { status: newStatus, updatedAt: new Date().toISOString() }, { merge: true });
    } catch(e) { console.warn('Firestore complaint update failed:', e); }
  }
  if (idx >= 0) renderComplaints(complaints);
}

// ===== GAMIFICATION PAGE =====
async function initGamificationPage() {
  console.log('✅ Gamification page initialized');

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

  // Read actual gamification.points from Firestore for each tenant
  const results = await Promise.all(allTenants.map(async t => {
    const roomId = t.id || t.room;
    if (!roomId) return { ...t, points: 0, badges: [] };
    try {
      const snap = await fs.getDoc(fs.doc(db, `tenants/${t.building}/list/${roomId}`));
      const data = snap.exists() ? snap.data() : {};
      return { ...t, points: data.gamification?.points || 0, badges: data.gamification?.badges || [] };
    } catch(e) {
      return { ...t, points: 0, badges: [] };
    }
  }));

  const scored = results.map(t => {
    const tier = window.GamificationRules
      ? window.GamificationRules.getLevelForPoints(t.points)
      : { emoji: '🌱', name: 'Seedling' };
    return { name: t.name || t.id || t.room, points: t.points, rank: `${tier.emoji} ${tier.name}`, badges: t.badges };
  }).sort((a, b) => b.points - a.points);

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
  document.querySelectorAll('[id^="gamification"]').forEach(el => el.style.display = 'none');
  document.getElementById('gamification' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).style.display = 'block';
  document.querySelectorAll('#page-gamification button').forEach(b => b.style.color = 'var(--text-muted)');
  document.querySelectorAll('#page-gamification button').forEach(b => b.style.borderBottom = '3px solid transparent');
  btn.style.color = '#2d8653';
  btn.style.borderBottom = '3px solid #2d8653';
  if (tabName === 'rewards' && typeof loadRewardsAdmin === 'function') loadRewardsAdmin();
  if (tabName === 'badges') loadBadgesAdmin();
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
// Tenant app subscribes via _subscribePolicies() and renders content live.
async function loadPoliciesAdmin() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const KEYS = ['privacy', 'terms', 'compliance', 'ip'];
  const ID_MAP = {
    privacy: 'policy-privacy-content',
    terms:   'policy-terms-content',
    compliance: 'policy-compliance-content',
    ip:      'policy-ip-content'
  };
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

    KEYS.forEach(key => {
      const ta = document.getElementById(`policy-admin-${key}`);
      if (ta && data[key]) ta.value = data[key];
    });
  } catch(e) { console.warn('loadPoliciesAdmin:', e.message); }
}

async function savePolicyDoc(key) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const ta = document.getElementById(`policy-admin-${key}`);
  if (!ta) return;
  const content = ta.value.trim();
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
let _rewardsAdminUnsub = null;
let _rewardsAdminCache = [];

function loadRewardsAdmin() {
  if (_rewardsAdminUnsub) return; // idempotent
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const colRef = fs.collection(db, 'rewards');
  _rewardsAdminUnsub = fs.onSnapshot(colRef, snap => {
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
    const tdNote = document.createElement('td'); tdNote.style.fontSize = '.8rem'; tdNote.style.color = 'var(--text-muted)'; tdNote.textContent = esc(r.note); tr.appendChild(tdNote);
    const tdActions = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit'; editBtn.style.cssText = 'padding:4px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:4px;cursor:pointer;margin-right:4px;font-family:Sarabun,sans-serif;font-size:.8rem;';
    editBtn.addEventListener('click', () => openRewardEdit(r.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete'; delBtn.style.cssText = 'padding:4px 10px;background:#ffebee;color:#c62828;border:1px solid #c62828;border-radius:4px;cursor:pointer;font-family:Sarabun,sans-serif;font-size:.8rem;';
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
    document.getElementById('rewardEditNote').value = '';
    document.getElementById('rewardEditActive').checked = true;
  } else {
    const r = _rewardsAdminCache.find(x => x.id === rewardId);
    if (!r) return;
    document.getElementById('rewardEditName').value = r.name || '';
    document.getElementById('rewardEditCost').value = r.cost || '';
    document.getElementById('rewardEditIcon').value = r.icon || '🎁';
    document.getElementById('rewardEditOrder').value = r.order || 99;
    document.getElementById('rewardEditNote').value = r.note || '';
    document.getElementById('rewardEditActive').checked = r.active !== false;
  }
  modal.style.display = 'flex';
}

function closeRewardEdit() {
  const modal = document.getElementById('rewardEditModal');
  if (modal) modal.style.display = 'none';
}

async function saveReward() {
  const id = document.getElementById('rewardEditId').value;
  const name = document.getElementById('rewardEditName').value.trim();
  const cost = parseInt(document.getElementById('rewardEditCost').value, 10);
  const icon = document.getElementById('rewardEditIcon').value.trim() || '🎁';
  const order = parseInt(document.getElementById('rewardEditOrder').value, 10) || 99;
  const note = document.getElementById('rewardEditNote').value.trim();
  const active = document.getElementById('rewardEditActive').checked;
  if (!name || !cost || cost < 1) {
    alert('Name and cost (>0) are required');
    return;
  }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    alert('Firestore unavailable');
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const now = new Date().toISOString();
  const data = { name, cost, icon, order, note, active, updatedAt: now };
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
    alert('Save failed: ' + e.message);
  }
}

async function deleteReward(rewardId, rewardName) {
  if (!confirm(`Delete reward "${rewardName}"? This is permanent.`)) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    await fs.deleteDoc(fs.doc(db, 'rewards', rewardId));
  } catch (e) {
    alert('Delete failed: ' + e.message);
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

// ===== BILLING IMPORT FUNCTIONS =====
/**
 * CRITICAL SECTION: Handles file uploads for billing data
 *
 * 🔑 KEY CONCEPT: Two entry points → One processor
 * 1. Drop Zone (ondrop) → handleBillingImportDrop()
 * 2. File Input (onchange) → handleBillingImportFile()
 * 3. Both call → handleBillingImportFileProcess(file)
 *
 * ⚠️ IMPORTANT: Functions MUST be exposed to window scope (bottom of this section)
 *    Otherwise HTML onclick/ondrop attributes will not find them!
 */

function handleBillingImportDrop(event) {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    handleBillingImportFileProcess(files[0]);
  }
}

/**
 * ENTRY POINT #1: File input onchange handler
 * HTML attribute: onchange="window.handleBillingImportFile && window.handleBillingImportFile(event);"
 *
 * Flow: User clicks drop zone → clicks hidden input → selects file → onchange fires → this function called
 *
 * ⚠️ Safety check in HTML: "window.handleBillingImportFile &&" prevents error if not loaded yet
 */
function handleBillingImportFile(event) {
  const files = event.target.files;
  if (files.length > 0) {
    handleBillingImportFileProcess(files[0]);
  }
}

/**
 * 🚨 CRITICAL SECTION: EXPOSE TO GLOBAL SCOPE
 *
 * WHY: HTML attributes (onchange, ondrop) need these functions in window scope
 * WHEN: After function definitions above
 *
 * If this is missing or wrong:
 * ❌ Error: "handleBillingImportFile is not defined"
 * ❌ Error: "handleBillingImportDrop is not defined"
 *
 * Solution: Always assign to window object:
 */
window.handleBillingImportFile = handleBillingImportFile;
window.handleBillingImportDrop = handleBillingImportDrop;

/**
 * MAIN PROCESSOR: Handles Excel file reading and parsing
 *
 * 🔄 FLOW:
 * 1. Extract year from filename (must have "ปี" + number)
 * 2. Read Excel file using XLSX library
 * 3. Parse sheets based on year format
 * 4. Save to HISTORICAL_DATA in localStorage
 * 5. Display preview with matchResults
 *
 * ⚠️ CRITICAL DEPENDENCIES:
 * - XLSX library (loaded in HTML header)
 * - meter-unified.js (for matchMeterDataWithPrevious)
 * - Functions: showBillingImportStatus, parseImportExcelData, displayImportPreview
 *
 * 🐛 COMMON ISSUES:
 * - "matchMeterDataWithPrevious is not defined" → Check if meter-unified.js loaded
 * - File not processing → Check browser console for errors
 * - Filename not recognized → Must contain "ปี" + year number
 */
function handleBillingImportFileProcess(file) {
  // STEP 1: Filename validation - Auto-detect year from filename
  // Example: "บิลปี69.xlsx" → year = 69
  // Pattern: Look for Thai character "ปี" followed by digits
  const yearMatch = file.name.match(/ปี(\d+)/);

  if (!yearMatch) {
    showBillingImportStatus('❌ ชื่อไฟล์ต้องมี "ปี" และตัวเลขปี เช่น "บิลปี69.xlsx" หรือ "บิลปี70 (2).xlsx"', 'error');
    return; // STOP: Cannot proceed without year
  }

  const yearInput = yearMatch[1];
  showBillingImportStatus(`✅ ตรวจพบปี ${yearInput} จากชื่อไฟล์`, 'success');

  // STEP 2: Start file loading
  showBillingImportStatus('⏳ กำลังโหลดไฟล์...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      showBillingImportStatus('⏳ กำลังประมวลผลข้อมูล...', 'info');

      // STEP 3: Async processing to prevent UI freeze
      // setTimeout allows browser to update UI between processing
      setTimeout(() => {
        try {
          // STEP 4: Read and parse Excel file
          const data = new Uint8Array(e.target.result);
          console.log('📥 Reading Excel file...', data.length, 'bytes');

          // XLSX library reads binary data and returns workbook object
          const workbook = XLSX.read(data, { type: 'array' });
          console.log('✅ Excel loaded:', workbook.SheetNames.length, 'sheets');

          const year = yearInput;
          console.log(`📊 Parsing billing data for year: ${year}`);

          // STEP 5: Detect file format version based on year
          // Year >= 70 (Thai year 2570+) = V2 format
          // Year < 70 = V3 format
          let monthlyData = [];
          const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;
          const yearNum = parseInt(year);
          const forceV2 = yearNum >= 70;

          // Process sheets with async breaks to avoid UI freeze
          let sheetIdx = startIdx;

          const processSheet = () => {
            if (sheetIdx >= workbook.SheetNames.length) {
              // Done processing all sheets
              finalizeBillingImport(monthlyData, year, forceV2);
              return;
            }

            const sheet = workbook.Sheets[workbook.SheetNames[sheetIdx]];
            const hasD43 = sheet['D43']?.v !== undefined;

            try {
              if (forceV2) {
                const result = parseSingleSheetV2(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              } else if (hasD43) {
                const result = parseSingleSheetV2(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              } else {
                const result = parseSingleSheetV1(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              }
            } catch (sheetErr) {
              console.warn(`⚠️ Error processing sheet ${sheetIdx}:`, sheetErr.message);
            }

            sheetIdx++;

            // Process next sheet with tiny delay to allow UI refresh
            setTimeout(processSheet, 10);
          };

          processSheet();

        } catch (err) {
          showBillingImportStatus('❌ เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message, 'error');
          console.error('File reading error:', err);
        }
      }, 50);

    } catch (err) {
      showBillingImportStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Helper: Finalize billing import after all sheets processed
function finalizeBillingImport(monthlyData, year, forceV2) {
  try {
    const parserMode = forceV2 ? '(V2 only)' : '(mixed V1/V2)';
    console.log(`📌 Year ${year}: Parsed ${monthlyData.length} months ${parserMode}`);

    if (!monthlyData || monthlyData.length === 0) {
      showBillingImportStatus('❌ ไม่พบข้อมูลบิล H32 ในไฟล์', 'error');
      return;
    }

    // Display preview
    displayBillingImportPreview(monthlyData, year);
    showBillingImportStatus(`✅ โหลดข้อมูลบิล ${monthlyData.length} เดือน สำหรับปี ${year} สำเร็จ`, 'success');

    // Store for approval
    window.pendingBillingData = {
      year: year,
      monthlyData: monthlyData
    };
  } catch (err) {
    showBillingImportStatus('❌ เกิดข้อผิดพลาดในการประมวลผล: ' + err.message, 'error');
    console.error('Finalization error:', err);
  }
}

// Helper: Parse single sheet with V1 format
function parseSingleSheetV1(worksheet, monthNum, sheetName) {
  // Rooms: D24=rent, J24=elec, P24=water, S2:S23=trash
  const roomsRent = parseFloat(worksheet['D24']?.v || 0) || 0;
  const roomsElec = parseFloat(worksheet['J24']?.v || 0) || 0;
  const roomsWater = parseFloat(worksheet['P24']?.v || 0) || 0;
  let roomsTrash = 0;
  for (let row = 2; row <= 23; row++) {
    roomsTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Amazon: D26=rent, J26=elec, P26=water, S26=trash
  const amazonRent = parseFloat(worksheet['D26']?.v || 0) || 0;
  const amazonElec = parseFloat(worksheet['J26']?.v || 0) || 0;
  const amazonWater = parseFloat(worksheet['P26']?.v || 0) || 0;
  const amazonTrash = parseFloat(worksheet['S26']?.v || 0) || 0;

  const totalRent = roomsRent + amazonRent;
  const totalElec = roomsElec + amazonElec;
  const totalWater = roomsWater + amazonWater;
  const totalTrash = roomsTrash + amazonTrash;
  const total = totalRent + totalElec + totalWater + totalTrash;

  if (total > 0) {
    return {
      month: monthNum,
      sheetName: sheetName,
      rent: totalRent,
      electricity: totalElec,
      water: totalWater,
      trash: totalTrash,
      total: total,
      breakdown: {
        rooms: { rent: roomsRent, elec: roomsElec, water: roomsWater, trash: roomsTrash, total: roomsRent + roomsElec + roomsWater + roomsTrash },
        nest: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        amazon: { rent: amazonRent, elec: amazonElec, water: amazonWater, trash: amazonTrash, total: amazonRent + amazonElec + amazonWater + amazonTrash }
      }
    };
  }
  return null;
}

// Helper: Parse single sheet with V2 format (with Nest building)
// Layout (June 69+):
//   Rows 2-23:  Rooms (22 ห้อง), summary at row 24
//   Rows 26-45: Nest (20 ห้อง N101-N405), summary at row 46
//   Row 47:     empty separator
//   Row 48:     ร้านใหญ่ (Amazon)
function parseSingleSheetV2(worksheet, monthNum, sheetName) {
  // Rooms: D24=total, J24=elec, P24=water, S2:S23=trash
  const roomsRent = parseFloat(worksheet['D24']?.v || 0) || 0;
  const roomsElec = parseFloat(worksheet['J24']?.v || 0) || 0;
  const roomsWater = parseFloat(worksheet['P24']?.v || 0) || 0;
  let roomsTrash = 0;
  for (let row = 2; row <= 23; row++) {
    roomsTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Nest: D46=total, J46=elec, P46=water, S26:S45=trash (20 rooms, summary row 46)
  const nestRent = parseFloat(worksheet['D46']?.v || 0) || 0;
  const nestElec = parseFloat(worksheet['J46']?.v || 0) || 0;
  const nestWater = parseFloat(worksheet['P46']?.v || 0) || 0;
  let nestTrash = 0;
  for (let row = 26; row <= 45; row++) {
    nestTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Amazon/ร้านใหญ่: D48=rent, J48=elec, P48=water, S48=trash (row moved from 47→48 in June 69+)
  const amazonRent = parseFloat(worksheet['D48']?.v || 0) || 0;
  const amazonElec = parseFloat(worksheet['J48']?.v || 0) || 0;
  const amazonWater = parseFloat(worksheet['P48']?.v || 0) || 0;
  const amazonTrash = parseFloat(worksheet['S48']?.v || 0) || 0;

  // Total trash: S51 (shifted down 1 row from S50 due to Amazon moving to row 48)
  const totalTrash = parseFloat(worksheet['S51']?.v || 0) || parseFloat(worksheet['S50']?.v || 0) || 0;

  const totalRent = roomsRent + nestRent + amazonRent;
  const totalElec = roomsElec + nestElec + amazonElec;
  const totalWater = roomsWater + nestWater + amazonWater;
  const total = totalRent + totalElec + totalWater + totalTrash;

  if (total > 0) {
    return {
      month: monthNum,
      sheetName: sheetName,
      rent: totalRent,
      electricity: totalElec,
      water: totalWater,
      trash: totalTrash,
      total: total,
      breakdown: {
        rooms: { rent: roomsRent, elec: roomsElec, water: roomsWater, trash: roomsTrash, total: roomsRent + roomsElec + roomsWater + roomsTrash },
        nest: { rent: nestRent, elec: nestElec, water: nestWater, trash: nestTrash, total: nestRent + nestElec + nestWater + nestTrash },
        amazon: { rent: amazonRent, elec: amazonElec, water: amazonWater, trash: amazonTrash, total: amazonRent + amazonElec + amazonWater + amazonTrash }
      }
    };
  }
  return null;
}

function parseBillingExcelData(workbook) {
  const monthlyData = [];

  // Try to extract detailed data from each sheet (skip first sheet if it's template)
  const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;

  for (let idx = startIdx; idx < workbook.SheetNames.length; idx++) {
    const sheetName = workbook.SheetNames[idx];
    const worksheet = workbook.Sheets[sheetName];

    // Read individual cells for Rooms (row 24) and Amazon (row 26)
    const d24 = parseFloat(worksheet['D24']?.v || 0) || 0;  // Room rent
    const j24 = parseFloat(worksheet['J24']?.v || 0) || 0;  // Room electricity
    const p24 = parseFloat(worksheet['P24']?.v || 0) || 0;  // Room water

    const d26 = parseFloat(worksheet['D26']?.v || 0) || 0;  // Amazon rent
    const j26 = parseFloat(worksheet['J26']?.v || 0) || 0;  // Amazon electricity
    const p26 = parseFloat(worksheet['P26']?.v || 0) || 0;  // Amazon water

    // Read trash total from S29 (รวมค่าขยะ summary cell)
    const totalTrash = parseFloat(worksheet['S29']?.v || 0) || 0;

    // Calculate totals
    const totalRent = d24 + d26;
    const totalElec = j24 + j26;
    const totalWater = p24 + p26;
    const total = totalRent + totalElec + totalWater + totalTrash;

    if (total > 0) {
      monthlyData.push({
        month: idx - startIdx + 1,
        sheetName: sheetName,
        rent: totalRent,
        electricity: totalElec,
        water: totalWater,
        trash: totalTrash,
        total: total
      });
    }
  }

  return monthlyData;
}

// V2: For June 69 onwards (with Nest building + rooms rows)
function parseBillingExcelDataV2(workbook) {
  const monthlyData = [];

  // Skip first sheet if template (EX)
  const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;

  for (let idx = startIdx; idx < workbook.SheetNames.length; idx++) {
    const sheetName = workbook.SheetNames[idx];
    const worksheet = workbook.Sheets[sheetName];

    // V2 Cell mapping for June onwards:
    // D43 = Nest rent, J43 = Nest elec, P43 = Nest water
    // D45 = Amazon rent, J45 = Amazon elec, P45 = Amazon water
    // S48 = Trash total

    const nestRent = parseFloat(worksheet['D43']?.v || 0) || 0;    // Nest rent
    const nestElec = parseFloat(worksheet['J43']?.v || 0) || 0;    // Nest electricity
    const nestWater = parseFloat(worksheet['P43']?.v || 0) || 0;   // Nest water

    const amazonRent = parseFloat(worksheet['D45']?.v || 0) || 0;  // Amazon rent
    const amazonElec = parseFloat(worksheet['J45']?.v || 0) || 0;  // Amazon electricity
    const amazonWater = parseFloat(worksheet['P45']?.v || 0) || 0; // Amazon water

    // Rooms: Sum D24:D26 (or detect from A24:A42 rows with N10x pattern)
    let roomsRent = 0, roomsElec = 0, roomsWater = 0;
    for (let row = 24; row <= 42; row++) {
      const d = worksheet[`D${row}`]?.v;
      const j = worksheet[`J${row}`]?.v;
      const p = worksheet[`P${row}`]?.v;
      if (d !== undefined) roomsRent += parseFloat(d) || 0;
      if (j !== undefined) roomsElec += parseFloat(j) || 0;
      if (p !== undefined) roomsWater += parseFloat(p) || 0;
    }

    // Trash total from S48
    const totalTrash = parseFloat(worksheet['S48']?.v || 0) || 0;

    // Calculate totals
    const totalRent = roomsRent + nestRent + amazonRent;
    const totalElec = roomsElec + nestElec + amazonElec;
    const totalWater = roomsWater + nestWater + amazonWater;
    const total = totalRent + totalElec + totalWater + totalTrash;

    if (total > 0) {
      monthlyData.push({
        month: idx - startIdx + 1,
        sheetName: sheetName,
        rent: totalRent,
        electricity: totalElec,
        water: totalWater,
        trash: totalTrash,
        total: total,
        breakdown: { rooms: roomsRent, nest: nestRent, amazon: amazonRent } // For debug
      });
    }
  }

  return monthlyData;
}

function displayBillingImportPreview(monthlyData, year) {
  const previewDiv = document.getElementById('billingPreviewData');
  const monthNames = ['มค', 'กพ', 'มีค', 'เมษา', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];

  let html = `<strong>ข้อมูลบิลปี ${year} (Rooms + Nest + Amazon):</strong><br>`;
  html += `<div style="font-family:'Sarabun',sans-serif;font-size:0.9rem;overflow-x:auto;margin-top:0.5rem;">`;
  html += `<table style="width:100%;border-collapse:collapse;">`;
  html += `<thead>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.8rem;text-align:left;border-right:1px solid var(--border);">เดือน</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#e8f5e9;color:#1b5e20;font-weight:700;">🏠 Rooms</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#f3e5f5;color:#4a148c;font-weight:700;">🏢 Nest</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#fff9c4;color:#f57f17;font-weight:700;">📦 Amazon</th>
      <th style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">รวม</th>
    </tr>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.2rem;border-right:1px solid var(--border);"></th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">รวม</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">รวม</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">รวม</th>
      <th style="padding:0.2rem;text-align:right;font-size:0.8rem;color:var(--green);font-weight:700;">รวม</th>
    </tr>
  </thead>
  <tbody>`;

  let roomsRentSum = 0, roomsElecSum = 0, roomsWaterSum = 0, roomsTrashSum = 0, roomsTotal = 0;
  let nestRentSum = 0, nestElecSum = 0, nestWaterSum = 0, nestTrashSum = 0, nestTotal = 0;
  let amazonRentSum = 0, amazonElecSum = 0, amazonWaterSum = 0, amazonTrashSum = 0, amazonTotal = 0;
  let yearlyTotal = 0;

  monthlyData.forEach(m => {
    const bd = m.breakdown || {};
    const rooms = bd.rooms || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
    const nest = bd.nest || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
    const amazon = bd.amazon || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };

    const monthName = monthNames[m.month - 1] || `เดือน${m.month}`;
    html += `<tr style="border-bottom:1px solid var(--border);">`;
    html += `<td style="padding:0.5rem;text-align:left;border-right:1px solid var(--border);">${monthName}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${(rooms.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${(rooms.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${(rooms.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${(rooms.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;font-weight:600;">฿${(rooms.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${(nest.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${(nest.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${(nest.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${(nest.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;font-weight:600;">฿${(nest.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${(amazon.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${(amazon.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${(amazon.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${(amazon.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;font-weight:600;">฿${(amazon.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;font-weight:600;color:var(--green);">฿${m.total.toLocaleString()}</td>`;
    html += `</tr>`;

    roomsRentSum += rooms.rent||0;
    roomsElecSum += rooms.elec||0;
    roomsWaterSum += rooms.water||0;
    roomsTrashSum += rooms.trash||0;
    roomsTotal += rooms.total||0;
    nestRentSum += nest.rent||0;
    nestElecSum += nest.elec||0;
    nestWaterSum += nest.water||0;
    nestTrashSum += nest.trash||0;
    nestTotal += nest.total||0;
    amazonRentSum += amazon.rent||0;
    amazonElecSum += amazon.elec||0;
    amazonWaterSum += amazon.water||0;
    amazonTrashSum += amazon.trash||0;
    amazonTotal += amazon.total||0;
    yearlyTotal += m.total;
  });

  html += `  </tbody>
  <tfoot>
    <tr style="background:var(--bg-secondary);border-top:2px solid var(--border);font-weight:700;">
      <td style="padding:0.8rem;border-right:1px solid var(--border);">รวมทั้งปี</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${roomsRentSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${roomsElecSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${roomsWaterSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${roomsTrashSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${roomsTotal.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${nestRentSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${nestElecSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${nestWaterSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${nestTrashSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${nestTotal.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${amazonRentSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${amazonElecSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${amazonWaterSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${amazonTrashSum.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${amazonTotal.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${yearlyTotal.toLocaleString()}</td>
    </tr>
  </tfoot>
  </table>
  </div>`;

  previewDiv.innerHTML = html;
  document.getElementById('billingResultsSection').style.display = 'block';
}

// Handle billing import data that comes from meter import flow (V1/V2 billing format)
async function approveBillingImportDataFromMeter(importData, matchResults) {
  console.log('💾 Processing billing data import to localStorage', { importData, matchResults });

  try {
    const year = importData.year;
    const month = importData.month;
    const roomsData = importData.rooms || {};

    // Convert meter readings to billing amounts
    // For V1/V2 billing format: eNew/eOld are electricity, wNew/wOld are water
    // Create monthly breakdown
    const monthlyData = [{
      rent: 0,
      electricity: 0,
      water: 0,
      trash: 0,
      total: 0,
      breakdown: {
        rooms: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        nest: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        amazon: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 }
      }
    }];

    // Process room data based on building
    const building = importData.building || 'rooms';
    if (building === 'rooms' || building === 'all') {
      // For Rooms building, eNew/eOld are electricity, wNew/wOld are water
      for (let roomNum in roomsData) {
        const room = roomsData[roomNum];
        const elecUsage = Math.abs(room.eNew - room.eOld) || 0;
        const waterUsage = Math.abs(room.wNew - room.wOld) || 0;

        // Simple calculation: multiply usage by assumed rates (can be refined)
        const elecCharge = elecUsage * 5; // ฿5 per unit
        const waterCharge = waterUsage * 10; // ฿10 per unit
        const trash = 50; // Fixed trash fee per room
        const rent = 1500; // Default rent (can be retrieved from data if available)

        const roomTotal = elecCharge + waterCharge + trash + rent;

        // Add to Rooms building breakdown
        monthlyData[0].breakdown.rooms.elec += elecCharge;
        monthlyData[0].breakdown.rooms.water += waterCharge;
        monthlyData[0].breakdown.rooms.trash += trash;
        monthlyData[0].breakdown.rooms.rent += rent;
        monthlyData[0].breakdown.rooms.total += roomTotal;
      }
    }

    // Update totals
    monthlyData[0].rent = monthlyData[0].breakdown.rooms.rent + monthlyData[0].breakdown.nest.rent + monthlyData[0].breakdown.amazon.rent;
    monthlyData[0].electricity = monthlyData[0].breakdown.rooms.elec + monthlyData[0].breakdown.nest.elec + monthlyData[0].breakdown.amazon.elec;
    monthlyData[0].water = monthlyData[0].breakdown.rooms.water + monthlyData[0].breakdown.nest.water + monthlyData[0].breakdown.amazon.water;
    monthlyData[0].trash = monthlyData[0].breakdown.rooms.trash + monthlyData[0].breakdown.nest.trash + monthlyData[0].breakdown.amazon.trash;
    monthlyData[0].total = monthlyData[0].rent + monthlyData[0].electricity + monthlyData[0].water + monthlyData[0].trash;

    // Create months array for this year
    const months = monthlyData.map(m => ({
      total: [m.rent, m.electricity, m.water, m.trash, m.total],
      rooms: [m.breakdown.rooms.rent, m.breakdown.rooms.elec, m.breakdown.rooms.water, m.breakdown.rooms.trash, m.breakdown.rooms.total],
      nest: [m.breakdown.nest.rent, m.breakdown.nest.elec, m.breakdown.nest.water, m.breakdown.nest.trash, m.breakdown.nest.total],
      amazon: [m.breakdown.amazon.rent, m.breakdown.amazon.elec, m.breakdown.amazon.water, m.breakdown.amazon.trash, m.breakdown.amazon.total]
    }));

    const yearPayload = {
      label: `ปี ${2500 + parseInt(year)} (${year})`,
      months: months
    };

    // Phase 2c: dual-write local + Firestore (persist across devices)
    if (typeof HistoricalDataStore !== 'undefined') {
      await HistoricalDataStore.setYear(year, yearPayload);
    } else {
      const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
      historicalData[year] = yearPayload;
      localStorage.setItem('HISTORICAL_DATA', JSON.stringify(historicalData));
    }

    showImportStatus(`✅ บันทึกข้อมูลบิลปี ${year} (${months.length} เดือน) → ☁️ Firestore สำเร็จ!`, 'success');

    // Clean up and refresh
    setTimeout(() => {
      cancelImportProcess();
      if (typeof initDashboardCharts === 'function') {
        initDashboardCharts();
      }
    }, 1000);

  } catch (error) {
    showImportStatus(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
    console.error('Error processing billing data:', error);
  }
}

async function approveBillingImportData() {
  if (!window.pendingBillingData) {
    showBillingImportStatus('❌ ไม่มีข้อมูลที่รออนุมัติ', 'error');
    return;
  }

  try {
    const { year, monthlyData } = window.pendingBillingData;

    if (!monthlyData || !Array.isArray(monthlyData) || monthlyData.length === 0) {
      showBillingImportStatus('❌ ข้อมูลเดือนไม่ถูกต้องหรือเป็นช่วง', 'error');
      return;
    }

    // Create HISTORICAL_DATA structure with detailed breakdown (rooms, nest, amazon)
    const months = monthlyData.map(m => {
      // Ensure m is an object with default values
      if (!m || typeof m !== 'object') {
        return {
          total: [0, 0, 0, 0, 0],
          rooms: [0, 0, 0, 0, 0],
          nest: [0, 0, 0, 0, 0],
          amazon: [0, 0, 0, 0, 0]
        };
      }

      const bd = m.breakdown || {};
      const rooms = bd.rooms || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
      const nest = bd.nest || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
      const amazon = bd.amazon || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };

      return {
        total: [m.rent || 0, m.electricity || 0, m.water || 0, m.trash || 0, m.total || 0],
        rooms: [rooms.rent || 0, rooms.elec || 0, rooms.water || 0, rooms.trash || 0, rooms.total || 0],
        nest: [nest.rent || 0, nest.elec || 0, nest.water || 0, nest.trash || 0, nest.total || 0],
        amazon: [amazon.rent || 0, amazon.elec || 0, amazon.water || 0, amazon.trash || 0, amazon.total || 0]
      };
    });

  const yearPayload = {
    label: `ปี ${2500 + parseInt(year)} (${year})`,
    months: months
  };

  // Phase 2c: dual-write local + Firestore historicalRevenue/{year}
  if (typeof HistoricalDataStore !== 'undefined') {
    await HistoricalDataStore.setYear(year, yearPayload);
  } else {
    const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
    historicalData[year] = yearPayload;
    localStorage.setItem('HISTORICAL_DATA', JSON.stringify(historicalData));
  }

  showBillingImportStatus(`✅ บันทึกข้อมูลบิลปี ${year} (${months.length} เดือน) → ☁️ Firestore สำเร็จ!`, 'success');

  // Reload dashboard charts with new data
  showBillingImportStatus(`✅ กำลังอัพเดทข้อมูล...`, 'info');

  setTimeout(async () => {
    try {
      cancelBillingImportProcess();

      // Reload dashboard charts (await for completion)
      if (typeof initDashboardCharts === 'function') {
        console.log('🔄 Updating dashboard charts...');
        await initDashboardCharts();
        console.log('✅ Dashboard charts updated');
      }

      // Refresh historical data display
      if (typeof initHistoricalDataDisplay === 'function') {
        console.log('🔄 Updating historical data display...');
        initHistoricalDataDisplay();
        console.log('✅ Historical data display updated');
      }

      // Navigate to HISTORICAL_DATA page to show the imported data
      showBillingImportStatus(`✅ บันทึกข้อมูลและอัพเดทสำเร็จ!`, 'success');

      // Navigate to meter page to show the imported data in HISTORICAL_DATA
      setTimeout(() => {
        console.log('🔄 Navigating to HISTORICAL_DATA page...');
        // Find the meter page button and click it to navigate
        const meterPageBtn = document.querySelector('[onclick*="\'meter\'"]');
        if (meterPageBtn) {
          meterPageBtn.click();
          console.log('✅ Navigated to meter page');
        } else {
          console.warn('⚠️ Could not find meter page button, using window.showPage');
          if (typeof window.showPage === 'function') {
            window.showPage('meter');
          }
        }
      }, 1000);

    } catch (error) {
      console.error('❌ Error during billing import refresh:', error);
      showBillingImportStatus(`❌ เกิดข้อผิดพลาดขณะอัพเดท: ${error.message}`, 'error');
    }
  }, 500);
  } catch (error) {
    showBillingImportStatus(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
    console.error('Error in approveBillingImportData:', error);
  }
}

function cancelBillingImportProcess() {
  const fileInput = document.getElementById('billingFileInput');
  const resultsSection = document.getElementById('billingResultsSection');
  const previewData = document.getElementById('billingPreviewData');
  const statusMsg = document.getElementById('billingStatusMessage');

  if (fileInput) fileInput.value = '';
  if (resultsSection) resultsSection.style.display = 'none';
  if (previewData) previewData.innerHTML = '';
  if (statusMsg) statusMsg.innerHTML = '';
  window.pendingBillingData = null;
}

function showBillingImportStatus(message, type) {
  const statusDiv = document.getElementById('billingStatusMessage');
  let bgColor = 'var(--accent-light)';
  let borderColor = 'var(--accent)';

  if (type === 'success') {
    bgColor = '#e8f5e9';
    borderColor = '#2e7d32';
  } else if (type === 'error') {
    bgColor = '#ffebee';
    borderColor = '#c62828';
  }

  statusDiv.innerHTML = `<div style="padding:0.8rem;background:${bgColor};border:1px solid ${borderColor};border-radius:var(--radius-sm);color:var(--text);">${message}</div>`;
}

// ===== HistoricalDataStore (Phase 2c 2026-04-19) =====
// Single Source of Truth for legacy/pre-launch annual bill summaries.
//   Firestore canonical: historicalRevenue/{yearShort}  (e.g., 67/68/69)
//   localStorage cache:  HISTORICAL_DATA  (read-through, fast)
//   Excel imports dual-write to both. Migration helper pushes any local-only
//   years up to Firestore so they persist across devices.
window.HistoricalDataStore = window.HistoricalDataStore || (function(){
  let cloudCache = null;            // {yearShort: {label, months}}
  let cloudUnsub = null;
  const listeners = new Set();

  function _local() {
    try { return JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}'); }
    catch(e) { return {}; }
  }
  function _writeLocal(data) {
    try { localStorage.setItem('HISTORICAL_DATA', JSON.stringify(data)); } catch(e) {}
  }

  /** Merge cloud + local; cloud wins per-year if both exist. */
  function getAll() {
    const local = _local();
    if (!cloudCache) return local;
    return { ...local, ...cloudCache };
  }
  function getYear(year) { return getAll()[String(year)] || null; }
  function listYears() { return Object.keys(getAll()).sort(); }
  function onChange(fn) {
    listeners.add(fn);
    // Catch-up: if cloud data already loaded, fire immediately so late
    // subscribers don't miss the initial snapshot
    if (cloudCache !== null) {
      try { fn(getAll()); } catch(e) {}
    }
    return () => listeners.delete(fn);
  }
  function _notify() { listeners.forEach(fn => { try { fn(getAll()); } catch(e){} }); }

  /** Write a single year (used by Excel import); dual-writes to local + cloud. */
  async function setYear(year, payload) {
    const local = _local();
    local[String(year)] = payload;
    _writeLocal(local);
    if (!cloudCache) cloudCache = {};
    cloudCache[String(year)] = payload;
    _notify();
    await _pushYearToCloud(year, payload);
  }

  async function _pushYearToCloud(year, payload) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      console.warn('HistoricalDataStore: Firestore not ready, year saved locally only');
      return false;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.setDoc(fs.doc(db, 'historicalRevenue', String(year)), {
        ...payload,
        year: Number(year),
        savedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`☁️ historicalRevenue/${year} pushed to Firestore`);
      return true;
    } catch (e) {
      console.warn(`HistoricalDataStore push failed for year ${year}:`, e?.message);
      return false;
    }
  }

  /** One-shot migration: push every localStorage year to Firestore. */
  async function migrateLocalToCloud() {
    const local = _local();
    const years = Object.keys(local);
    if (years.length === 0) return { pushed: 0, failed: 0, skipped: 0 };
    let pushed = 0, failed = 0;
    for (const y of years) {
      const ok = await _pushYearToCloud(y, local[y]);
      if (ok) pushed++; else failed++;
    }
    console.log(`☁️ Migration done: ${pushed} pushed, ${failed} failed`);
    return { pushed, failed, skipped: 0, years };
  }

  /** Subscribe to Firestore historicalRevenue collection (live). */
  function subscribe() {
    if (cloudUnsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribe, 1500);
      return;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      cloudUnsub = fs.onSnapshot(fs.collection(db, 'historicalRevenue'), snap => {
        const next = {};
        snap.forEach(doc => { next[doc.id] = doc.data(); });
        cloudCache = next;
        // Backfill localStorage so dashboard charts work offline next time
        const local = _local();
        Object.keys(next).forEach(y => { local[y] = next[y]; });
        _writeLocal(local);
        _notify();
      }, err => console.warn('historicalRevenue subscribe:', err?.message));
    } catch(e) { console.warn('subscribe error:', e); }
  }

  // Auto-subscribe
  if (typeof window !== 'undefined') setTimeout(subscribe, 700);

  return { getAll, getYear, listYears, setYear, migrateLocalToCloud, subscribe, onChange };
})();

// One-shot migrate button — appears above the historical year dropdown
async function _renderHistoricalCloudMigrateButton(historicalData) {
  const yearSelect = document.getElementById('historicalDataYearSelect');
  if (!yearSelect) return;
  const parent = yearSelect.parentElement;
  if (!parent) return;
  let btn = document.getElementById('historicalDataMigrateBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'historicalDataMigrateBtn';
    btn.style.cssText = 'background:#1565c0;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer;margin-left:8px;font-family:inherit;';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '☁️ กำลังอัพโหลด...';
      try {
        const r = await HistoricalDataStore.migrateLocalToCloud();
        const msg = `☁️ Migrate เสร็จ: ${r.pushed} ปี → Firestore${r.failed?` (${r.failed} ล้มเหลว)`:''}`;
        if (typeof showToast === 'function') showToast(msg, r.failed ? 'warning' : 'success');
        else alert(msg);
        btn.textContent = `☁️ ขึ้น cloud แล้ว (${r.pushed})`;
        setTimeout(() => { btn.disabled = false; btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore อีกครั้ง'; }, 3000);
      } catch (e) {
        if (typeof showToast === 'function') showToast('Migration ล้มเหลว: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore';
      }
    };
    btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore';
    parent.appendChild(btn);
  }
}

// Initialize HISTORICAL_DATA dropdown and display
function initHistoricalDataDisplay() {
  const historicalData = (typeof HistoricalDataStore !== 'undefined')
    ? HistoricalDataStore.getAll()
    : JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const yearSelect = document.getElementById('historicalDataYearSelect');
  const displayDiv = document.getElementById('historicalDataDisplay');

  if (!yearSelect) return;

  if (Object.keys(historicalData).length === 0) {
    displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">ยังไม่มีข้อมูลบิล - โปรดอัพโหลดไฟล์บิล Excel</p>';
    yearSelect.disabled = true;
    return;
  }

  yearSelect.disabled = false;

  // Phase 2c: Cloud migration button (visible if any year only in localStorage)
  _renderHistoricalCloudMigrateButton(historicalData);

  // Auto-rerender on cloud updates
  if (typeof HistoricalDataStore !== 'undefined' && !window._histStoreSubscribed) {
    window._histStoreSubscribed = true;
    HistoricalDataStore.onChange(() => {
      try { initHistoricalDataDisplay(); } catch(e){}
    });
  }

  // Populate dropdown with available years (sorted descending)
  const years = Object.keys(historicalData).sort((a, b) => parseInt(b) - parseInt(a));

  // Clear existing options (except the placeholder)
  while (yearSelect.options.length > 1) {
    yearSelect.remove(1);
  }

  // Add year options (Buddhist year format only)
  years.forEach(year => {
    const buddhistYear = 2500 + parseInt(year);
    const option = document.createElement('option');
    option.value = year;
    option.textContent = buddhistYear.toString(); // Just show Buddhist year number
    yearSelect.appendChild(option);
  });

  // Select first year by default
  if (years.length > 0) {
    yearSelect.value = years[0];
    displayHistoricalDataForYear(years[0]);
  }

  // Add change event listener
  yearSelect.addEventListener('change', function() {
    if (this.value) {
      displayHistoricalDataForYear(this.value);
    } else {
      displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">โปรดเลือกปีที่ต้องการดู</p>';
    }
  });
}

// Display data for a specific year
function displayHistoricalDataForYear(year) {
  const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const displayDiv = document.getElementById('historicalDataDisplay');

  if (!historicalData[year]) {
    displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">ไม่พบข้อมูลสำหรับปีนี้</p>';
    return;
  }

  const yearData = historicalData[year];
  const yearLabel = yearData.label || `ปี ${2500 + parseInt(year)} (${year})`;
  const months = yearData.months || [];

  let html = '<div style="font-family:\'Sarabun\',sans-serif;font-size:0.9rem;overflow-x:auto;">';
  html += `<table style="width:100%;border-collapse:collapse;">`;
  html += `<thead>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.8rem;text-align:left;border-right:1px solid var(--border);rowspan:2;">เดือน</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#e8f5e9;color:#1b5e20;font-weight:700;">🏠 Rooms</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#f3e5f5;color:#4a148c;font-weight:700;">🏢 Nest</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:#fff9c4;color:#f57f17;font-weight:700;">📦 Amazon</th>
      <th style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">รวม</th>
    </tr>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.2rem;border-right:1px solid var(--border);"></th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#e8f5e9;">รวม</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#f3e5f5;">รวม</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">เช่า</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">ไฟ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">น้ำ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">ขยะ</th>
      <th style="padding:0.2rem;text-align:right;border-right:1px solid var(--border);font-size:0.8rem;background:#fff9c4;">รวม</th>
      <th style="padding:0.2rem;text-align:right;font-size:0.8rem;color:var(--green);font-weight:700;">รวม</th>
    </tr>
  </thead>`;
  html += `<tbody>`;

  let totalRent = 0, totalElec = 0, totalWater = 0, totalAll = 0;
  let totalRoomsRent = 0, totalRoomsElec = 0, totalRoomsWater = 0, totalRoomsAll = 0;
  let totalNestRent = 0, totalNestElec = 0, totalNestWater = 0, totalNestAll = 0;
  let totalAmazonRent = 0, totalAmazonElec = 0, totalAmazonWater = 0, totalAmazonAll = 0;

  months.forEach((month, idx) => {
    if (!month) {
      html += `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:0.8rem;color:var(--text-muted);border-right:1px solid var(--border);">เดือน ${idx + 1}</td>
                <td colspan="8" style="padding:0.8rem;text-align:center;color:var(--text-muted);font-style:italic;">ไม่มีข้อมูล</td>
              </tr>`;
      return;
    }

    // Support both old format (array) and new format (object with total/rooms/nest)
    let rent, elec, water, trash, total, roomsData, nestData;
    if (Array.isArray(month)) {
      // Old format: [rent, elec, water, total] or new format: [rent, elec, water, trash, total]
      if (month.length >= 5) {
        [rent, elec, water, trash, total] = month;
      } else {
        [rent, elec, water, total] = month;
        trash = 0;
      }
      roomsData = [0, 0, 0, 0, 0];
      nestData = [0, 0, 0, 0, 0];
    } else {
      // New format: { total: [...], rooms: [...], nest: [...], amazon: [...] }
      const totalArr = month.total || [0, 0, 0, 0, 0];
      if (totalArr.length >= 5) {
        [rent, elec, water, trash, total] = totalArr;
      } else {
        [rent, elec, water, total] = totalArr;
        trash = 0;
      }
      roomsData = month.rooms || [0, 0, 0, 0, 0];
      nestData = month.nest || [0, 0, 0, 0, 0];
      var amazonData = month.amazon || [0, 0, 0, 0, 0];
    }

    totalRent += rent || 0;
    totalElec += elec || 0;
    totalWater += water || 0;
    totalAll += total || 0;
    totalRoomsRent += roomsData[0] || 0;
    totalRoomsElec += roomsData[1] || 0;
    totalRoomsWater += roomsData[2] || 0;
    totalRoomsAll += roomsData[4] || 0;
    totalNestRent += nestData[0] || 0;
    totalNestElec += nestData[1] || 0;
    totalNestWater += nestData[2] || 0;
    totalNestAll += nestData[4] || 0;
    totalAmazonRent += amazonData[0] || 0;
    totalAmazonElec += amazonData[1] || 0;
    totalAmazonWater += amazonData[2] || 0;
    totalAmazonAll += amazonData[4] || 0;

    const monthNames = ['มค.', 'กพ.', 'มีค.', 'เมย.', 'พค.', 'มิย.', 'กค.', 'สค.', 'กย.', 'ตค.', 'พย.', 'ธค.'];
    const monthName = monthNames[idx] || `เดือน ${idx + 1}`;

    html += `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:0.8rem;border-right:1px solid var(--border);font-weight:600;">${monthName}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#e8f5e9;">฿${(roomsData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#e8f5e9;">฿${(roomsData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#e8f5e9;">฿${(roomsData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#e8f5e9;">฿${(roomsData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#e8f5e9;color:#2d8653;font-weight:600;">฿${(roomsData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#f3e5f5;">฿${(nestData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#f3e5f5;">฿${(nestData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#f3e5f5;">฿${(nestData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#f3e5f5;">฿${(nestData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#f3e5f5;color:#7b1fa2;font-weight:600;">฿${(nestData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#fff9c4;">฿${(amazonData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#fff9c4;">฿${(amazonData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#fff9c4;">฿${(amazonData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#fff9c4;">฿${(amazonData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:#fff9c4;color:#f57f17;font-weight:600;">฿${(amazonData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${(total || 0).toLocaleString()}</td>
            </tr>`;
  });

  // Calculate trash totals for rooms, nest, and amazon
  let totalRoomsTrash = 0, totalNestTrash = 0, totalAmazonTrash = 0;
  months.forEach(month => {
    if (month) {
      if (Array.isArray(month)) {
        if (month.length >= 5) {
          totalRoomsTrash += month[3] || 0; // This logic needs review
        }
      } else {
        const rd = month.rooms || [];
        const nd = month.nest || [];
        const ad = month.amazon || [];
        totalRoomsTrash += rd[3] || 0;
        totalNestTrash += nd[3] || 0;
        totalAmazonTrash += ad[3] || 0;
      }
    }
  });

  html += `<tr style="font-weight:700;border-bottom:2px solid var(--green);">
            <td style="padding:0.8rem;border-right:1px solid var(--border);">รวมทั้งสิ้น</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${totalRoomsRent.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${totalRoomsElec.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${totalRoomsWater.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;">฿${totalRoomsTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#e8f5e9;color:#2d8653;font-weight:700;">฿${totalRoomsAll.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${totalNestRent.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${totalNestElec.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${totalNestWater.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;">฿${totalNestTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#f3e5f5;color:#7b1fa2;font-weight:700;">฿${totalNestAll.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${totalAmazonRent.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${totalAmazonElec.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${totalAmazonWater.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;">฿${totalAmazonTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:#fff9c4;color:#f57f17;font-weight:700;">฿${totalAmazonAll.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${totalAll.toLocaleString()}</td>
          </tr>`;

  html += `</tbody></table>`;
  html += '</div>';
  displayDiv.innerHTML = html;
}

// Initialize display on page load and when switching tabs
document.addEventListener('DOMContentLoaded', function() {
  // Initialize when page loads if on billing import tab
  const billingContent = document.getElementById('meter-import-billing-content');
  if (billingContent && billingContent.style.display !== 'none') {
    setTimeout(initHistoricalDataDisplay, 100);
  }
});

// Hook into tab switching to refresh display
if (window.switchMeterTab) {
  const originalSwitchTab = window.switchMeterTab;
  window.switchMeterTab = function(tab, btn) {
    originalSwitchTab.call(window, tab, btn);
    if (tab === 'import-billing') {
      setTimeout(initHistoricalDataDisplay, 100);
    }
  };
}

