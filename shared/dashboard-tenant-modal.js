// ===== TENANT MODAL MANAGEMENT =====
let currentEditRoomId = null;
let currentEditBuilding = null;
let currentEditTenantId = null;

const MONTHS_TH_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// Real-time sync event system
const TenantDataEvents = {
  listeners: {},

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  },

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      });
    }
  },

  clear() {
    this.listeners = {};
  }
};

// Subscribe to tenant data changes
TenantDataEvents.on('TENANT_UPDATED', (data) => {
  const {building, roomId, tenantId} = data;

  // Refresh room display if visible
  if (typeof refreshRoomTenantDisplay === 'function') {
    try {
      refreshRoomTenantDisplay(building, roomId);
    } catch (e) {
      console.warn('Could not refresh room display:', e.message);
    }
  }

  // Reload modal if currently open with same room
  const tenantModal = document.getElementById('tenantModal');
  if (tenantModal && !tenantModal.classList.contains('u-hidden') && currentEditRoomId === roomId) {
    setTimeout(() => {
      openTenantModal(building, roomId);
    }, 500);
  }
});

// Make TenantDataEvents globally available
window.TenantDataEvents = TenantDataEvents;

// Helper function to detect building from room ID (fallback)
function detectBuildingFromRoomId(roomId) {
  // Single source of truth — delegate to BillingSystem.detectBuilding
  // (handles both "N101" prefix style AND legacy numeric 101-405 stored as nest)
  if (typeof BillingSystem !== 'undefined' && BillingSystem.detectBuilding) {
    return BillingSystem.detectBuilding(roomId)[0];
  }
  const s = String(roomId);
  if (s.startsWith('N') || s.startsWith('n')) return 'nest';
  const n = parseInt(s);
  return (n >= 101 && n <= 405) ? 'nest' : 'rooms';
}

function openTenantModal(building, roomId) {
  // Support both old signature (single param) and new signature (building, roomId)
  if (typeof building === 'string' && !roomId) {
    // Old signature: openTenantModal(roomId)
    roomId = building;
    building = detectBuildingFromRoomId(roomId);
  }

  currentEditRoomId = roomId;
  currentEditBuilding = building;
  const modal = document.getElementById('tenantModal');

  // Use TenantLookup to get room occupancy info
  const occupancyInfo = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant = occupancyInfo.tenant || {};
  const lease = occupancyInfo.lease || {};
  const room = occupancyInfo.room || {};

  // Set tenant ID for this edit session
  currentEditTenantId = lease.tenantId || null;

  // Get correct rent from RoomConfigManager
  let rentPrice = room.rentPrice || 0;
  if (!rentPrice && typeof RoomConfigManager !== 'undefined') {
    const rmConfigRoom = RoomConfigManager.getRoom(building, roomId);
    if (rmConfigRoom && rmConfigRoom.rentPrice) {
      rentPrice = rmConfigRoom.rentPrice;
    }
  }

  // Update room info
  document.getElementById('modalRoomNumber').textContent = `ห้อง ${roomId}`;
  const roomType = room.type === 'commercial' ? '🏪 พาณิชย์' : (room.type === 'pet' ? '🐾 Pet Friendly' : '🏠 ห้องพัก');
  document.getElementById('modalRoomType').textContent = roomType || '🏠 ห้องพัก';

  // Pre-fill rent price in contract section
  if (document.getElementById('modalRentPrice')) {
    document.getElementById('modalRentPrice').value = rentPrice || '';
  }

  // Determine occupancy status
  const isOccupied = tenant && tenant.name;
  const statusBadge = document.getElementById('modalRoomStatus');

  if (isOccupied) {
    statusBadge.textContent = '🟢 มีผู้เช่า';
    statusBadge.classList.add('u-badge-occupied'); statusBadge.classList.remove('u-badge-vacant');
  } else {
    statusBadge.textContent = '🔴 ว่าง';
    statusBadge.classList.add('u-badge-vacant'); statusBadge.classList.remove('u-badge-occupied');
  }

  // Fill form with tenant data
  // Handle both separate fields and combined name for backward compatibility
  if (tenant.firstName || tenant.lastName) {
    document.getElementById('modalTenantFirstName').value = tenant.firstName || '';
    document.getElementById('modalTenantLastName').value = tenant.lastName || '';
  } else if (tenant.name) {
    // Split combined name into first and last (simple split by space)
    const nameParts = (tenant.name || '').trim().split(' ');
    document.getElementById('modalTenantFirstName').value = nameParts[0] || '';
    document.getElementById('modalTenantLastName').value = nameParts.slice(1).join(' ') || '';
  } else {
    document.getElementById('modalTenantFirstName').value = '';
    document.getElementById('modalTenantLastName').value = '';
  }
  document.getElementById('modalTenantPhone').value = tenant.phone || '';
  document.getElementById('modalTenantLineID').value = tenant.lineID || '';
  document.getElementById('modalTenantEmail').value = tenant.email || '';
  const evEl = document.getElementById('modalTenantEmailVerified');
  if (evEl) evEl.textContent = tenant.email ? (tenant.emailVerified ? '✅ ยืนยันแล้ว' : '(ยังไม่ยืนยัน)') : '';
  document.getElementById('modalTenantLicensePlate').value = tenant.licensePlate || '';
  document.getElementById('modalTenantMoveIn').value = tenant.moveInDate || '';
  document.getElementById('modalTenantContractEnd').value = tenant.contractEnd || '';
  // Meter fields removed - no longer used
  document.getElementById('modalTenantNotes').value = tenant.notes || '';

  // New fields
  const idCardEl = document.getElementById('modalTenantIdCard');
  if (idCardEl) idCardEl.value = tenant.idCardNumber || '';
  const addrEl = document.getElementById('modalTenantAddress');
  if (addrEl) addrEl.value = tenant.address || '';
  const emNameEl = document.getElementById('modalEmergencyName');
  if (emNameEl) emNameEl.value = (tenant.emergencyContact && tenant.emergencyContact.name) || '';
  const emPhoneEl = document.getElementById('modalEmergencyPhone');
  if (emPhoneEl) emPhoneEl.value = (tenant.emergencyContact && tenant.emergencyContact.phone) || '';
  // Pets section — show only for pet-allowed rooms (N301-N405), read-only from approval system
  const isPetAllowed = room?.type === 'pet-allowed';
  const petsSection = document.getElementById('modalPetsSection');
  if (petsSection) {
    petsSection.classList.toggle('u-hidden', !(isPetAllowed));
    if (isPetAllowed) {
      const petsListEl = document.getElementById('modalPetsList');
      if (petsListEl) {
        const petKey = `tenant_pets_nest_${roomId}`;
        const roomPets = JSON.parse(localStorage.getItem(petKey) || '[]').filter(p => p.status === 'approved');
        const emojis = {dog:'🐕', cat:'🐈', rabbit:'🐇', bird:'🐦', fish:'🐠', hamster:'🐹'};
        petsListEl.innerHTML = roomPets.length > 0
          ? roomPets.map(p => {
              const icon = emojis[(p.type||'').toLowerCase()] || '🐾';
              return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;border:1px solid #f3e5f5;">
                <span style="font-size:1.3rem;">${icon}</span>
                <div><div style="font-weight:600;font-size:.9rem;">${p.name || '—'}</div><div style="font-size:.78rem;color:var(--text-muted);">${p.type || ''}</div></div>
              </div>`;
            }).join('')
          : '<span style="color:var(--text-muted);font-size:.85rem;">ยังไม่มีสัตว์เลี้ยงที่อนุมัติแล้ว — ลูกบ้านขอผ่าน app</span>';
      }
    }
  }

  // Receipt/company info display (read-only — tenants self-serve via tenant_app)
  const co = tenant.companyInfo || {};
  const hasCo = !!(co.name || co.taxId || co.address);
  const dispEl = document.getElementById('modalTenantCompanyDisplay');
  if (dispEl) {
    dispEl.classList.toggle('u-hidden', !(hasCo));
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
    set('modalTenantCompanyDisplayName',    co.name);
    set('modalTenantCompanyDisplayTaxId',   co.taxId);
    set('modalTenantCompanyDisplayAddress', co.address);
  }


  // Load contract status — 3 possible sources, checked in priority order:
  //   1. lease.documentURLs.agreement (Firebase Storage — Tab สัญญา uploads, current SSoT)
  //   2. lease.contractDocument (Firestore base64 — legacy Tab ผู้เช่า uploads, still supported)
  //   3. tenant.contractDocument (Firestore base64 — pre-Phase-3 legacy)
  let contractData = null;
  let contractFileName = '';
  let contractStorageURL = null;

  const agreementDoc = lease?.documentURLs?.agreement;
  if (agreementDoc) {
    contractStorageURL = typeof agreementDoc === 'string' ? agreementDoc : agreementDoc.url;
    contractFileName = (typeof agreementDoc === 'object' && agreementDoc.fileName)
      ? agreementDoc.fileName
      : 'สัญญาเช่า.pdf';
  } else if (lease && lease.contractDocument) {
    contractData = lease.contractDocument;
    contractFileName = lease.contractFileName || 'สัญญาเช่า';
  } else if (tenant && tenant.contractDocument) {
    contractData = tenant.contractDocument;
    contractFileName = tenant.contractFileName || 'สัญญาเช่า';
  }

  // Read-only contract status — upload/delete UI moved to Tab สัญญา (SSoT).
  // We keep preview here for convenience so admin can quickly eyeball the doc
  // from the tenant modal without switching tabs.
  const statusEl = document.getElementById('contractDocStatus');
  if (statusEl) statusEl.textContent = '';

  // Keep hidden fields in sync so saveTenantInfo → lease update doesn't wipe
  // the existing contract. For Storage-based contracts we leave them empty
  // (the real source is lease.documentURLs, not this modal's hidden fields).
  document.getElementById('modalContractDocument').value = contractData || '';
  document.getElementById('modalContractFileName').value = contractFileName || '';

  if (contractStorageURL || contractData) {
    const tick = document.createTextNode('✅ มีสัญญา: ');
    const strong = document.createElement('strong');
    strong.textContent = contractFileName;
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.textContent = '👁️ ดูตัวอย่าง';
    previewBtn.className = 'u-btn-preview';
    previewBtn.addEventListener('click', () => {
      if (contractStorageURL) {
        window.open(contractStorageURL, '_blank', 'noopener,noreferrer');
      } else {
        previewContractDocument(building, roomId);
      }
    });
    if (statusEl) statusEl.append(tick, strong, previewBtn);
  } else {
    if (statusEl) statusEl.textContent = '📋 ยังไม่มีสัญญา — อัพโหลดได้ที่ Tab สัญญา';
  }

  // Show modal — must set inline display:flex too because dashboard.html ships
  // the modal with style="display:none;" inline, which !important on .u-hidden
  // can't override (inline style wins over external CSS regardless of !important).
  // Per feedback_inline_style_class_toggle.md.
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');

  // Initialize phone validation for the modal
  setTimeout(function() {
    initPhoneValidation();
  }, 100);
}

function closeTenantModal() {
  const modal = document.getElementById('tenantModal');
  modal.style.display = ''; // clear inline display:flex set in openTenantModal
  modal.classList.add('u-hidden');
  currentEditRoomId = null;
  // Hide lease history if open — clear inline display too for symmetry
  const hist = document.getElementById('tenantLeaseHistorySection');
  if (hist) { hist.style.display = ''; hist.classList.add('u-hidden'); }
}

// ─── Lease History (ประวัติผู้เช่าเก่า) ───
async function showTenantLeaseHistory(building, roomId) {
  if (!building || !roomId) return;
  const section = document.getElementById('tenantLeaseHistorySection');
  const content = document.getElementById('tenantLeaseHistoryContent');
  if (!section || !content) return;

  // Toggle: hide if currently visible. Check computedStyle — relying on
  // !classList.contains('u-hidden') alone misfires because dashboard.html:2181
  // ships the section with inline style="display:none;" (no u-hidden class), so
  // first click went into the "hide" branch and never showed. Per
  // feedback_inline_style_class_toggle.md.
  if (getComputedStyle(section).display !== 'none') {
    section.style.display = 'none';
    section.classList.add('u-hidden');
    return;
  }

  // Refresh from Firestore so superseded/deleted leases reflect immediately
  // and local-only orphans (failed-write artifacts) get dropped.
  if (typeof LeaseAgreementManager?.refreshLeasesFromFirestore === 'function') {
    try { await LeaseAgreementManager.refreshLeasesFromFirestore(building); } catch (_) {}
  }

  const leases = (typeof LeaseAgreementManager !== 'undefined')
    ? LeaseAgreementManager.getLeaseHistory(building, roomId)
    : [];

  if (!leases.length) {
    content.innerHTML = '<p style="color:var(--text-muted);">ยังไม่มีประวัติผู้เช่า</p>';
  } else {
    content.innerHTML = leases.map(l => {
      const moveIn  = l.moveInDate    ? new Date(l.moveInDate).toLocaleDateString('th-TH')    : '—';
      const moveOut = l.moveOutDate   ? new Date(l.moveOutDate).toLocaleDateString('th-TH')   : (l.status==='active'?'ปัจจุบัน':'—');
      const badge   = l.status==='active'
        ? '<span style="background:#e8f5e9;color:#388e3c;padding:2px 8px;border-radius:10px;font-size:.7rem;">กำลังเช่า</span>'
        : '<span style="background:#f3e5f5;color:#7b1fa2;padding:2px 8px;border-radius:10px;font-size:.7rem;">สิ้นสุดแล้ว</span>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
        <div><strong>${l.tenantName||'—'}</strong> ${badge}</div>
        <div style="font-size:.78rem;color:var(--text-muted);">${moveIn} → ${moveOut}</div>
      </div>`;
    }).join('');
  }
  section.style.display = 'block'; // override inline display:none from dashboard.html:2181
  section.classList.remove('u-hidden');
}

// ─── Billing Modal (ชำระค่าเช่า) ───
function showBillingModal(roomId) {
  const building = tenantBuilding === 'old' ? 'rooms' : 'nest';
  const rooms = _getTenantRooms();
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;

  const tenants = loadTenants();
  const tenant = tenants[roomId];
  const tenantName = tenant?.name || '(ว่าง)';

  // Get current month/year (Thai year)
  const now = new Date();
  const thMonth = now.getMonth() + 1;
  const thYear = now.getFullYear() + 543;

  // Check if bill exists for this month
  let existingBill = null;
  if (typeof BillingSystem !== 'undefined') {
    existingBill = BillingSystem.getBillByMonthYear(roomId, thMonth, thYear);
  }

  const totalStr = existingBill
    ? `฿${Number(existingBill.totalCharge).toLocaleString()} (บิลเดือนนี้)`
    : `฿${Number(room.rentPrice||0).toLocaleString()} (ค่าเช่าเท่านั้น)`;

  const statusBadge = existingBill
    ? (existingBill.status === 'paid'
        ? '<span style="color:#388e3c;font-weight:700;">✅ ชำระแล้ว</span>'
        : '<span style="color:#f57c00;font-weight:700;">⏳ ค้างชำระ</span>')
    : '';

  const modal = document.createElement('div');
  modal.id = 'billingPayModal';
  modal.className = 'u-modal-overlay';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#388e3c,#1b5e20);color:#fff;padding:1.2rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;font-size:1.05rem;">💰 บันทึกการชำระ</div>
          <div style="font-size:.8rem;opacity:.85;">${roomId} · ${tenantName}</div>
        </div>
        <button onclick="document.getElementById('billingPayModal').remove()" style="background:rgba(255,255,255,.2);border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;color:#fff;font-size:1.1rem;">✕</button>
      </div>
      <div style="padding:1.5rem;">
        <div style="background:#f9fafb;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:.9rem;line-height:2;">
          <div>📅 เดือน: <strong>${MONTHS_TH_SHORT[thMonth]} ${thYear}</strong></div>
          <div>💰 ยอดที่ต้องชำระ: <strong style="color:var(--green-dark);font-size:1.05rem;">${totalStr}</strong></div>
          ${existingBill ? `<div>สถานะ: ${statusBadge}</div>` : ''}
          ${existingBill?.charges ? `
          <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;font-size:.8rem;color:var(--text-muted);">
            ค่าเช่า ฿${Number(existingBill.charges.rent||0).toLocaleString()} +
            ไฟ ฿${Number(existingBill.charges.electric?.cost||0).toLocaleString()} +
            น้ำ ฿${Number(existingBill.charges.water?.cost||0).toLocaleString()} +
            ขยะ ฿${Number(existingBill.charges.trash||0).toLocaleString()}
          </div>` : ''}
        </div>
        ${existingBill && existingBill.status !== 'paid' ? `
        <div style="margin-bottom:1rem;">
          <label style="font-size:.85rem;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px;">หมายเหตุการชำระ</label>
          <input type="text" id="billingPayNote" placeholder="เช่น โอนผ่าน PromptPay" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:6px;font-family:'Sarabun',sans-serif;font-size:.9rem;">
        </div>
        <button onclick="markBillPaid('${roomId}',${existingBill.month},${existingBill.year},'${existingBill.billId}')" style="width:100%;padding:12px;background:linear-gradient(135deg,#388e3c,#1b5e20);color:#fff;border:none;border-radius:8px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;font-size:.95rem;">✅ บันทึกว่าชำระแล้ว</button>
        ` : existingBill?.status === 'paid' ? `
        <div style="text-align:center;padding:1rem;color:#388e3c;font-weight:700;">✅ ชำระเรียบร้อยแล้ว</div>
        ` : `
        <div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.85rem;">ยังไม่มีบิลสำหรับเดือนนี้<br>กรุณาสร้างบิลจากหน้า "บิล" ก่อน</div>
        `}
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function markBillPaid(roomId, month, year, billId) {
  if (typeof BillingSystem === 'undefined') { showToast('ไม่พบระบบบิล', 'error'); return; }
  const note = document.getElementById('billingPayNote')?.value || '';
  BillingSystem.updateBillStatus(billId, 'paid', year);

  // Mirror status flip into RTDB so tenant_app's onValue subscriber sees it instantly
  // (without this, lookbook stays "ยังไม่จ่าย" even after admin manually approves)
  try {
    if (window.firebaseDatabase && window.firebaseRef && window.firebaseSet) {
      const fbBuilding = (window.CONFIG?.getBuildingConfig?.(typeof currentBuilding !== 'undefined' ? currentBuilding : 'rooms')) || 'rooms';
      const paidAt = new Date().toISOString();
      const statusRef = window.firebaseRef(window.firebaseDatabase, `bills/${fbBuilding}/${roomId}/${billId}/status`);
      const paidAtRef = window.firebaseRef(window.firebaseDatabase, `bills/${fbBuilding}/${roomId}/${billId}/paidAt`);
      await window.firebaseSet(statusRef, 'paid');
      await window.firebaseSet(paidAtRef, paidAt);
      // Also push payment record so tenant payment history reflects manual approval
      if (window.firebasePush) {
        const paymentsRef = window.firebaseRef(window.firebaseDatabase, `payments/${fbBuilding}/${roomId}`);
        const newRef = window.firebasePush(paymentsRef);
        await window.firebaseSet(newRef, {
          billId, month, year, paidAt, createdAt: paidAt,
          method: 'manual_admin', note, building: fbBuilding, room: roomId,
          verifiedBy: 'admin_manual'
        });
      }
      console.log(`✅ markBillPaid: synced bill ${billId} status to RTDB`);
    }
  } catch (e) { console.warn('⚠️ markBillPaid RTDB sync failed:', e.message); }

  showToast(`✅ บันทึกการชำระห้อง ${roomId} เดือน ${month}/${year} แล้ว`, 'success');
  document.getElementById('billingPayModal')?.remove();
}

// Navigate to bill page filtered by the currently-open room
window.openTenantBillPage = function() {
  const roomId = currentEditRoomId;
  closeTenantModal();
  if (roomId && typeof goBillFromTable === 'function') {
    goBillFromTable(roomId);
  } else {
    window.showPage('bill');
  }
};

// ─── Billing History: navigate to bill page with room pre-filtered ───
function showBillingHistoryModal(roomId) {
  if (typeof goBillFromTable === 'function') {
    goBillFromTable(roomId);
  } else {
    window.showPage('bill');
  }
}

function saveTenantInfo() {
  if (!currentEditRoomId || !currentEditBuilding) return;

  const building = currentEditBuilding;
  const roomId = currentEditRoomId;

  const firstName = (document.getElementById('modalTenantFirstName')?.value || '').trim();
  const lastName = (document.getElementById('modalTenantLastName')?.value || '').trim();
  const fullName = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName || '');

  // Validate data
  if (!fullName) {
    showToast('กรุณากรอกชื่อผู้เช่า', 'error');
    return;
  }

  const tenantData = {
    name: fullName,
    firstName: firstName,
    lastName: lastName,
    phone: document.getElementById('modalTenantPhone').value,
    idCardNumber: document.getElementById('modalTenantIdCard')?.value || '',
    email: document.getElementById('modalTenantEmail')?.value || '',
    licensePlate: document.getElementById('modalTenantLicensePlate')?.value || '',
    address: document.getElementById('modalTenantAddress')?.value || '',
    lineID: document.getElementById('modalTenantLineID').value,
    moveInDate: document.getElementById('modalTenantMoveIn').value,
    moveOutDate: document.getElementById('modalTenantContractEnd').value,
    deposit: (RoomConfigManager.getRentPrice(building, roomId) || 0) * 2,
    // Meter fields removed - no longer used
    // elecMeterStart and waterMeterStart now managed by Firebase only
    notes: document.getElementById('modalTenantNotes').value,
    emergencyContact: {
      name: document.getElementById('modalEmergencyName')?.value?.trim() || '',
      phone: document.getElementById('modalEmergencyPhone')?.value?.trim() || ''
    },
    // Phase 3: contractDocument moved to lease record (SSoT). Tenant record no
    // longer stores the base64 — contract uploads now happen in Tab สัญญา and
    // land in Firebase Storage (lease.documentURLs.agreement).
    // receiptType + companyInfo are tenant-self-serve via tenant_app — admin
    // does NOT overwrite from this modal. They flow into the doc separately
    // when the tenant edits in their app (TenantFirebaseSync.saveCompanyInfo).
  };
  // Capture contract fields separately — written only to lease, not tenant
  const contractDocumentValue = document.getElementById('modalContractDocument').value || '';
  const contractFileNameValue = document.getElementById('modalContractFileName').value || '';

  // Generate or reuse tenant ID
  const tenantId = currentEditTenantId || `TENANT_${Date.now()}_${roomId}`;

  // Save to TenantConfigManager (single source of truth)
  const saved = currentEditTenantId
    ? TenantConfigManager.updateTenant(building, tenantId, tenantData)
    : TenantConfigManager.addTenant(building, tenantId, tenantData);

  if (!saved && !currentEditTenantId) {
    showToast('ไม่สามารถบันทึกข้อมูลได้', 'error');
    return;
  }

  // Update or create lease agreement
  const currentLease = LeaseAgreementManager.getActiveLease(building, roomId);
  let leaseId;

  if (currentLease) {
    // Update existing lease — lease is SSoT for contract document
    // Phase 4: use Firebase-aware update so tenant→lease sync reaches Firestore, not just localStorage
    const rentPrice = RoomConfigManager.getRentPrice(building, roomId);
    const leaseUpdates = {
      tenantName: fullName,
      tenantId: tenantId,
      moveInDate: tenantData.moveInDate,
      moveOutDate: tenantData.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: tenantData.deposit,
      status: 'active',
      contractFileName: contractFileNameValue,
      contractDocument: contractDocumentValue
    };
    if (typeof LeaseAgreementManager.updateLeaseWithFirebase === 'function') {
      LeaseAgreementManager.updateLeaseWithFirebase(currentLease.id, building, leaseUpdates);
    } else {
      LeaseAgreementManager.updateLease(currentLease.id, leaseUpdates);
    }
    leaseId = currentLease.id;
  } else {
    // Create new lease — lease is SSoT for contract document
    const rentPrice = RoomConfigManager.getRentPrice(building, roomId);
    leaseId = LeaseAgreementManager.createLease({
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      tenantName: fullName,
      moveInDate: tenantData.moveInDate,
      moveOutDate: tenantData.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: tenantData.deposit,
      status: 'active',
      contractFileName: contractFileNameValue,
      contractDocument: contractDocumentValue
    });
    currentEditTenantId = tenantId; // Update for future edits
  }

  // Also save to legacy tenant_data for backward compatibility
  const allTenants = loadTenants();
  allTenants[roomId] = tenantData;
  localStorage.setItem('tenant_data', JSON.stringify(allTenants));

  // Firebase sync (async, non-blocking)
  if (typeof TenantConfigManager.saveTenantToFirebase === 'function') {
    TenantConfigManager.saveTenantToFirebase(building, tenantId, tenantData);
  }
  // updateTenant/addTenant key tenant_master_data by tenantId, but getTenantByRoom()
  // reads by roomId. Write the roomId key now so the modal re-opens with fresh data
  // without waiting for the next Firestore → localStorage sync.
  try {
    const _m = JSON.parse(localStorage.getItem('tenant_master_data') || '{}');
    if (!_m[building]) _m[building] = {};
    _m[building][roomId] = { ...tenantData, tenantId, building, roomId };
    localStorage.setItem('tenant_master_data', JSON.stringify(_m));
  } catch(_) {}
  if (typeof LeaseAgreementManager.createLeaseWithFirebase === 'function' && !currentLease) {
    LeaseAgreementManager.createLeaseWithFirebase(LeaseAgreementManager.getLease(leaseId));
  }

  // Log the action
  if (window.AuditLogger) {
    AuditLogger.log('TENANT_UPDATED', {
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      changes: Object.keys(tenantData).filter(k => tenantData[k])
    });
  }

  // Emit event for real-time sync
  if (window.TenantDataEvents) {
    TenantDataEvents.emit('TENANT_UPDATED', {
      building: building,
      roomId: roomId,
      tenantId: tenantId
    });
  }

  // Close modal
  closeTenantModal();

  // Refresh UI
  updateRoomStatuses();
  updateOccupancyDashboard();

  // Refresh current page
  const currentPage = document.querySelector('.page.active');
  if (currentPage && currentPage.id === 'page-property') {
    // Check which section is visible and refresh accordingly
    const nestSection = document.getElementById('property-nest-section');
    if (nestSection && nestSection.style.display !== 'none') {
      initNestPage();
    } else {
      initRoomsPage();
      renderCompactRoomGrid();
    }
  }

  // Show success message
  showToast('บันทึกข้อมูลสำเร็จ', 'success');
}

// Perf #4: uploadContractDocument() was removed in the "Tab ผู้เช่า drops
// contract upload" refactor — its file input + onchange handler were replaced
// with a read-only status line that points to Tab สัญญา. The function had
// no remaining callers and was writing base64 into Firestore docs (the exact
// pattern we consolidated away to Firebase Storage).

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  const modal = document.getElementById('tenantModal');
  if (modal && e.target === modal) {
    closeTenantModal();
  }
});
