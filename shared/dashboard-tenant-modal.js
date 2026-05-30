// ===== TENANT MODAL MANAGEMENT =====
// Cross-script edit context — set here, read by dashboard-pdpa-erasure.js +
// dashboard-extra.js + dashboard-main.js. MUST live on `window`: a `let` at
// script-top-level is block-scoped to THIS <script> tag and invisible to
// sibling scripts (the original cause of "ไม่มี tenantId" in PDPA erasure
// modal — pre-existing since 2026-05-14). All writers below use
// `window.X = ...` so siblings can read via `window.X` or bareword lookup.
window.currentEditRoomId = null;
window.currentEditBuilding = null;
window.currentEditTenantId = null;

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

  window.currentEditRoomId = roomId;
  window.currentEditBuilding = building;
  const modal = document.getElementById('tenantModal');

  // Use TenantLookup to get room occupancy info
  const occupancyInfo = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant = occupancyInfo.tenant || {};
  const lease = occupancyInfo.lease || {};
  const room = occupancyInfo.room || {};

  // Set tenant ID for this edit session
  window.currentEditTenantId = lease.tenantId || null;

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
  // Normalize anything (full ISO from renewLease/transferTenant, Date object,
  // YYYY-MM-DD already, or empty) to YYYY-MM-DD — <input type="date"> silently
  // rejects values it can't parse, leaving the field blank. renewLease.js +
  // transferTenant.js write full toISOString() ("2030-10-21T17:00:00.000Z"),
  // which is why dates were not pre-filling after a renewal.
  const _toDateInputValue = (v) => {
    if (!v) return '';
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    const d = (v instanceof Date) ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  };
  document.getElementById('modalTenantMoveIn').value = _toDateInputValue(tenant.moveInDate);
  const _csEl = document.getElementById('modalTenantContractStart');
  if (_csEl) _csEl.value = _toDateInputValue(tenant.contractStart || tenant.moveInDate);
  const _cmEl = document.getElementById('modalTenantContractMonths');
  if (_cmEl) _cmEl.value = tenant.contractMonths || '';
  document.getElementById('modalTenantContractEnd').value = _toDateInputValue(tenant.contractEnd);
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
              return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;border:1px solid ${DashColors.PURPLE_BG};">
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

  const _roomOccupied = !!(occupancyInfo?.isOccupied);
  if ((contractStorageURL || contractData) && _roomOccupied) {
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
  } else if (contractStorageURL || contractData) {
    // Room vacant but SSoT retains an orphaned lease/contract — redirect to history
    if (statusEl) statusEl.textContent = '📁 พบเอกสารสัญญาเก่า — ดูได้ใน "ประวัติผู้เช่าเก่า"';
  } else {
    if (statusEl) statusEl.textContent = '📋 ยังไม่มีสัญญา — อัพโหลดได้ที่ Tab สัญญา';
  }

  // Show modal — must set inline display:flex too because dashboard.html ships
  // the modal with style="display:none;" inline, which !important on .u-hidden
  // can't override (inline style wins over external CSS regardless of !important).
  // Per feedback_inline_style_class_toggle.md.
  modal.style.display = 'flex';
  modal.classList.remove('u-hidden');

  // Always start at the top — browsers persist scrollTop on the scrollable
  // container across hide/show, so re-opening the modal for a different room
  // would land mid-form. The inner wrapper carries `overflow-y:auto`.
  const scrollContainer = modal.firstElementChild;
  if (scrollContainer) scrollContainer.scrollTop = 0;

  // Initialize phone validation for the modal
  setTimeout(function() {
    if (typeof initPhoneValidation === 'function') initPhoneValidation();
  }, 100);
}

function closeTenantModal() {
  const modal = document.getElementById('tenantModal');
  modal.style.display = ''; // clear inline display:flex set in openTenantModal
  modal.classList.add('u-hidden');
  window.currentEditRoomId = null;
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

  // Plan B' S3: merge in the per-room occupancyLog (newest first). OccupancyLog
  // exposes events the lease docs don't capture cleanly — variation transfers
  // (lease roomId field flipped in-place), archive events, restored events.
  // Empty list on read failure (e.g. composite index still building); UI still
  // renders the lease-based rows.
  const events = (typeof OccupancyLog !== 'undefined')
    ? OccupancyLog.pairTransfers(await OccupancyLog.getByRoom(building, roomId, { limit: 50 }))
    : [];

  if (!leases.length && !events.length) {
    content.innerHTML = '<p style="color:var(--text-muted);">ยังไม่มีประวัติผู้เช่า</p>';
  } else {
    const leaseRows = leases.map(l => {
      const moveIn  = l.moveInDate    ? new Date(l.moveInDate).toLocaleDateString('th-TH')    : '—';
      const moveOut = l.moveOutDate   ? new Date(l.moveOutDate).toLocaleDateString('th-TH')   : (l.status==='active'?'ปัจจุบัน':'—');
      const badge   = l.status==='active'
        ? `<span style="background:${DashColors.GREEN_BG};color:${DashColors.GREEN_MED};padding:2px 8px;border-radius:10px;font-size:.7rem;">กำลังเช่า</span>`
        : `<span style="background:${DashColors.PURPLE_BG};color:#7b1fa2;padding:2px 8px;border-radius:10px;font-size:.7rem;">สิ้นสุดแล้ว</span>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
        <div><strong>${l.tenantName||'—'}</strong> ${badge}</div>
        <div style="font-size:.78rem;color:var(--text-muted);">${moveIn} → ${moveOut}</div>
      </div>`;
    }).join('');

    const eventRows = events.map(e => {
      const when = OccupancyLog.formatAt(e.atDate);
      const tenant = e.tenantName || '—';
      const actor = e.byEmail || e.by || '—';
      // For paired transfers the row shows directional arrow; for others the
      // single-room context is implied.
      const detail = e.paired
        ? `${e.fromBuilding||''}/${e.fromRoom||''} → ${e.toBuilding||''}/${e.toRoom||''}`
        : '';
      const note = e.reason ? ` · ${e.reason}` : '';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--border);">
        <div>
          <span style="font-size:.95rem;margin-right:6px;">${e.meta.icon}</span>
          <strong>${e.meta.label}</strong>
          <span style="color:var(--text-muted);font-size:.85rem;"> · ${tenant}${note}</span>
          ${detail ? `<div style="font-size:.72rem;color:var(--text-muted);margin-left:24px;">${detail}</div>` : ''}
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);text-align:right;" title="${e.sourceLabel} · ${actor}">${when}</div>
      </div>`;
    }).join('');

    const leaseBlock = leases.length
      ? `<div style="font-size:.78rem;color:var(--text-muted);font-weight:600;margin:.4rem 0 .2rem;">สัญญาเช่า (${leases.length})</div>${leaseRows}`
      : '';
    const eventBlock = events.length
      ? `<div style="font-size:.78rem;color:var(--text-muted);font-weight:600;margin:.8rem 0 .2rem;">เหตุการณ์ (${events.length})</div>${eventRows}`
      : '';
    content.innerHTML = leaseBlock + eventBlock;
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
        ? `<span style="color:${DashColors.GREEN_MED};font-weight:700;">✅ ชำระแล้ว</span>`
        : `<span style="color:${DashColors.ORANGE_DARK};font-weight:700;">⏳ ค้างชำระ</span>`)
    : '';

  const modal = document.createElement('div');
  modal.id = 'billingPayModal';
  modal.className = 'u-modal-overlay';
  modal.dataset.modal = 'true';
  modal.innerHTML = `
    <div style="background:${DashColors.WHITE};border-radius:var(--radius);max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;">
      <div style="background:linear-gradient(135deg,${DashColors.GREEN_MED},${DashColors.GREEN_DEEP});color:${DashColors.WHITE};padding:1.2rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;font-size:1.05rem;">💰 บันทึกการชำระ</div>
          <div style="font-size:.8rem;opacity:.85;">${roomId} · ${tenantName}</div>
        </div>
        <button data-action="closeNearestDataModal" style="background:rgba(255,255,255,.2);border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;color:${DashColors.WHITE};font-size:1.1rem;">✕</button>
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
        <button data-action="markBillPaid" data-room="${roomId}" data-month="${existingBill.month}" data-year="${existingBill.year}" data-billid="${existingBill.billId}" style="width:100%;padding:12px;background:linear-gradient(135deg,${DashColors.GREEN_MED},${DashColors.GREEN_DEEP});color:${DashColors.WHITE};border:none;border-radius:8px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;font-size:.95rem;">✅ บันทึกว่าชำระแล้ว</button>
        ` : existingBill?.status === 'paid' ? `
        <div style="text-align:center;padding:1rem;color:${DashColors.GREEN_MED};font-weight:700;">✅ ชำระเรียบร้อยแล้ว</div>
        ` : `
        <div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.85rem;">ยังไม่มีบิลสำหรับเดือนนี้<br>กรุณาสร้างบิลจากหน้า "บิล" ก่อน</div>
        `}
        <div style="border-top:1px solid var(--border);margin-top:.8rem;padding-top:.8rem;text-align:center;">
          <button data-action="closeBillingAndGoHistory" data-id="${roomId}" style="background:none;border:none;cursor:pointer;font-family:'Sarabun',sans-serif;font-size:.82rem;color:var(--green-dark);font-weight:700;text-decoration:underline;padding:4px 0;">📜 ดูประวัติการชำระทั้งหมด →</button>
        </div>
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
      console.info(`✅ markBillPaid: synced bill ${billId} status to RTDB`);
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

  // Read all modal inputs into a local object — used for lease + people/ writes.
  // After Phase 6: tenant doc is a thin slot pointer, not an identity record.
  // Identity → people/{tenantId} (via PersonManager.savePerson below)
  // Lease snapshot → leases/{b}/list/{leaseId} (via createLease/updateLease below)
  const inputs = {
    phone:         document.getElementById('modalTenantPhone').value,
    idCardNumber:  document.getElementById('modalTenantIdCard')?.value || '',
    email:         document.getElementById('modalTenantEmail')?.value || '',
    licensePlate:  document.getElementById('modalTenantLicensePlate')?.value || '',
    address:       document.getElementById('modalTenantAddress')?.value || '',
    lineID:        document.getElementById('modalTenantLineID').value,
    moveInDate:    document.getElementById('modalTenantMoveIn').value,
    contractStart: document.getElementById('modalTenantContractStart')?.value || '',
    contractMonths: parseInt(document.getElementById('modalTenantContractMonths')?.value || '', 10) || null,
    moveOutDate:   document.getElementById('modalTenantContractEnd').value,
    deposit:       (RoomConfigManager.getRentPrice(building, roomId) || 0) * 2,
    notes:         document.getElementById('modalTenantNotes').value,
    emergencyContact: {
      name:  document.getElementById('modalEmergencyName')?.value?.trim() || '',
      phone: document.getElementById('modalEmergencyPhone')?.value?.trim() || ''
    },
  };

  // Phase 6 slim tenant doc — only validation-name + room/building meta.
  // Identity overlay comes from PersonManager.getPersonSync at read time.
  // TenantConfigManager.addTenant validates `tenantData.name`, so we keep that
  // single identity field; readers always prefer person doc when cached.
  const tenantData = {
    name: fullName,
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
      moveInDate: inputs.moveInDate,
      contractStart: inputs.contractStart || inputs.moveInDate || null,
      contractMonths: inputs.contractMonths || null,
      moveOutDate: inputs.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: inputs.deposit,
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
    // Phase 3b-3 (True A1): reuse existing contractId minted by convertBookingToTenant
    // CF (if any) so tenant.contractId === lease.id end-to-end. If no contractId is
    // present (purely admin-created tenant), createLease mints a fresh one.
    const existingTenant = (typeof TenantConfigManager !== 'undefined'
      ? TenantConfigManager.getTenant(building, String(roomId))
      : null) || {};
    const reuseContractId = existingTenant.activeContractId || existingTenant.contractId || null;
    leaseId = LeaseAgreementManager.createLease({
      id: reuseContractId,
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      tenantName: fullName,
      moveInDate: inputs.moveInDate,
      contractStart: inputs.contractStart || inputs.moveInDate || null,
      contractMonths: inputs.contractMonths || null,
      moveOutDate: inputs.moveOutDate || null,
      rentAmount: rentPrice,
      deposit: inputs.deposit,
      status: 'active',
      contractFileName: contractFileNameValue,
      contractDocument: contractDocumentValue
    });
    window.currentEditTenantId = tenantId; // Update for future edits
  }

  // Also save to legacy tenant_data for backward compatibility
  const allTenants = loadTenants();
  allTenants[roomId] = tenantData;
  localStorage.setItem('tenant_data', JSON.stringify(allTenants));

  // Firebase sync (async, non-blocking)
  if (typeof TenantConfigManager.saveTenantToFirebase === 'function') {
    TenantConfigManager.saveTenantToFirebase(building, tenantId, tenantData);
  }
  // Phase 3c-1 dual-write: identity → people/{tenantId} (the canonical person
  // doc in the person-centric model). Async + non-blocking — failures don't
  // affect the legacy tenant-doc write path. As admin edits flow through over
  // time, every active tenant ends up with a people/* doc (Phase 4 lazy).
  if (window.PersonManager) {
    window.PersonManager.savePerson(tenantId, {
      name: fullName,
      firstName,
      lastName,
      phone: inputs.phone || '',
      email: inputs.email || '',
      lineUserId: inputs.lineID || '',
      idCardNumber: inputs.idCardNumber || '',
      address: inputs.address || '',
      licensePlate: inputs.licensePlate || '',
      emergencyContact: inputs.emergencyContact || null,
      notes: inputs.notes || '',
    });
    // Mark the current room link so person doc tracks where this tenant lives.
    window.PersonManager.linkRoom(tenantId, building, roomId, leaseId || tenantId);
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

  // Log the action — describe what changed (slim tenant doc has only name;
  // capture the inputs keys that the admin actually filled in so the audit
  // entry is meaningful).
  if (window.AuditLogger) {
    AuditLogger.log('TENANT_UPDATED', {
      building: building,
      roomId: roomId,
      tenantId: tenantId,
      changes: Object.keys(inputs).filter(k => inputs[k])
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

  // Refresh UI — guard mirrors the pattern at L731-32, L798-99, L856-57 in
  // this same file. dashboard-extra.js declares these as top-level functions
  // but cross-script bareword resolution can fail in minified builds; the
  // guard matches every other call site and silences ReferenceError spam.
  if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
  if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();

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

// ─── Archive tenant on move-out (Phase 1: person-centric identity) ───
// Calls archiveTenantOnMoveOut CF — preserves identity + history at
// tenants/{building}/archive/{contractId} so a returning tenant gets old
// data back (lookup runs in convertBookingToTenant). Live doc is blanked
// to status='vacant' so admin can assign the room to a new tenant.
async function archiveTenantOnMoveOut() {
  const building = currentEditBuilding;
  const roomId = currentEditRoomId;
  if (!building || !roomId) {
    showToast('ไม่พบข้อมูลห้อง — เปิด modal ก่อนแล้วลองใหม่', 'error');
    return;
  }

  const occupancy = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant = occupancy.tenant || {};
  const tenantName = String(tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`).trim();
  if (!tenant.tenantId) {
    showToast('ห้องนี้ไม่มีผู้เช่าอยู่ — ไม่ต้อง archive', 'info');
    return;
  }

  const ok = await window.ghConfirm(
    `ย้ายข้อมูลของ "${tenantName || 'ผู้เช่า'}" (ห้อง ${roomId}) ไปยัง archive?\n\n` +
    `• ข้อมูลทั้งหมด (ประวัติชำระ, points, wellness, pets) จะถูกเก็บไว้\n` +
    `• ห้อง ${roomId} จะกลับเป็นว่าง — assign ผู้เช่าใหม่ได้ทันที\n` +
    `• ถ้าผู้เช่าคนนี้กลับมาเช่าในอนาคต ระบบจะคืนข้อมูลเดิมให้อัตโนมัติ`,
    { title: 'ย้ายผู้เช่าออกจากห้อง', confirmLabel: 'ย้ายไป Archive', danger: true }
  );
  if (!ok) return;

  if (!window.firebase?.functions?.httpsCallable) {
    showToast('Firebase functions ไม่พร้อม — รีโหลดหน้า', 'error');
    return;
  }

  try {
    const callable = window.firebase.functions.httpsCallable('archiveTenantOnMoveOut');
    const res = await callable({ building, roomId, reason: 'moved_out' });
    const data = res?.data || {};
    showToast(
      `✓ Archive สำเร็จ — contractId=${data.contractId}, ` +
      `${data.archivedSubdocs} รายการประวัติถูกเก็บ`,
      'success'
    );

    // Refresh + close
    closeTenantModal();
    if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
    if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === 'page-property') {
      const nestSection = document.getElementById('property-nest-section');
      if (nestSection && nestSection.style.display !== 'none') {
        if (typeof initNestPage === 'function') initNestPage();
      } else {
        if (typeof initRoomsPage === 'function') initRoomsPage();
        if (typeof renderCompactRoomGrid === 'function') renderCompactRoomGrid();
      }
    }
  } catch (e) {
    console.error('archiveTenantOnMoveOut failed:', e);
    const msg = e?.message || String(e);
    showToast('Archive ไม่สำเร็จ: ' + msg, 'error');
  }
}
// Expose globally so dashboard-main.js's data-action dispatcher can find it
window.archiveTenantOnMoveOut = archiveTenantOnMoveOut;

// ─── Transition tenant to community member / player role ──────────────────
// Calls transitionToPlayer CF — archives contract, creates people/{tenantId},
// sets role:'player' claim. Person stays in LINE with community/wellness/
// gamification access. Billing, meter, maintenance, housekeeping are hidden.
async function transitionToPlayer() {
  const building = currentEditBuilding;
  const roomId = currentEditRoomId;
  if (!building || !roomId) {
    showToast('ไม่พบข้อมูลห้อง — เปิด modal ก่อนแล้วลองใหม่', 'error');
    return;
  }

  const occupancy = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant = occupancy.tenant || {};
  const tenantName = String(tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`).trim();
  if (!tenant.tenantId) {
    showToast('ห้องนี้ไม่มีผู้เช่าอยู่', 'info');
    return;
  }

  const ok = await window.ghConfirm(
    `ย้าย "${tenantName || 'ผู้เช่า'}" (ห้อง ${roomId}) เป็น Community Member?\n\n` +
    `• ห้อง ${roomId} จะกลับเป็นว่าง — assign ผู้เช่าใหม่ได้ทันที\n` +
    `• ข้อมูลและ points ของผู้เช่าจะถูกเก็บไว้\n` +
    `• ผู้เช่ายังอยู่ใน LINE ได้ — เข้าถึง community / wellness / gamification\n` +
    `• billing, meter, maintenance จะถูกซ่อน\n` +
    `• ย้อนกลับได้ — เมื่อ booking ใหม่และ convert เป็น tenant ข้อมูลเดิมจะกลับมา`,
    { title: 'ย้ายเป็น Community Member', confirmLabel: 'ย้ายเป็น Community', danger: false }
  );
  if (!ok) return;

  if (!window.firebase?.functions?.httpsCallable) {
    showToast('Firebase functions ไม่พร้อม — รีโหลดหน้า', 'error');
    return;
  }

  try {
    const callable = window.firebase.functions.httpsCallable('transitionToPlayer');
    const res = await callable({ building, roomId });
    const d = res?.data || {};
    showToast(
      `✓ ย้ายเป็น Community Member สำเร็จ — ${tenantName} (tenantId=${d.tenantId})`,
      'success'
    );

    closeTenantModal();
    if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
    if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === 'page-property') {
      const nestSection = document.getElementById('property-nest-section');
      if (nestSection && nestSection.style.display !== 'none') {
        if (typeof initNestPage === 'function') initNestPage();
      } else {
        if (typeof initRoomsPage === 'function') initRoomsPage();
        if (typeof renderCompactRoomGrid === 'function') renderCompactRoomGrid();
      }
    }
  } catch (e) {
    console.error('transitionToPlayer failed:', e);
    showToast('ย้ายเป็น Community ไม่สำเร็จ: ' + (e?.message || String(e)), 'error');
  }
}
window.transitionToPlayer = transitionToPlayer;

// ─── Revert a mistaken transitionToPlayer ─────────────────────────────────
// Calls revertTransitionToPlayer CF — restores tenant from archive doc, copies
// subcollections back to live doc, revokes player Auth claim, clears
// liffUsers.role. Archive doc kept as audit trail with revertedAt stamp.
async function revertTransitionToPlayer() {
  const building = currentEditBuilding;
  const roomId = currentEditRoomId;
  if (!building || !roomId) {
    showToast('ไม่พบข้อมูลห้อง — เปิด modal ก่อนแล้วลองใหม่', 'error');
    return;
  }

  const ok = await window.ghConfirm(
    `ย้อน transitionToPlayer สำหรับห้อง ${roomId}?\n\n` +
    `• คืนข้อมูลผู้เช่าจาก archive doc → ห้อง active อีกครั้ง\n` +
    `• คืน subcollections (paymentHistory, redemptions, pets, etc.)\n` +
    `• revoke role:'player' จาก Firebase Auth claim ของผู้ใช้\n` +
    `• ล้าง liffUsers.role → liffSignIn จะออก tenant token ครั้งถัดไป\n` +
    `• archive doc ยังเก็บไว้เป็น audit (มี revertedAt stamp)\n\n` +
    `เงื่อนไข: ห้องต้อง status='vacant' + lastArchivedContractId ของ archive doc archivedReason='transitioned_to_player'`,
    { title: 'ย้อน transitionToPlayer', confirmLabel: 'ย้อนกลับเป็น Tenant', danger: false }
  );
  if (!ok) return;

  if (!window.firebase?.functions?.httpsCallable) {
    showToast('Firebase functions ไม่พร้อม — รีโหลดหน้า', 'error');
    return;
  }

  try {
    const callable = window.firebase.functions.httpsCallable('revertTransitionToPlayer');
    const res = await callable({ building, roomId });
    const d = res?.data || {};
    showToast(
      `✓ ย้อน transitionToPlayer สำเร็จ — tenantId=${d.tenantId}, subdocs=${d.restoredSubdocs}`,
      'success'
    );

    closeTenantModal();
    if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
    if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === 'page-property') {
      const nestSection = document.getElementById('property-nest-section');
      if (nestSection && nestSection.style.display !== 'none') {
        if (typeof initNestPage === 'function') initNestPage();
      } else {
        if (typeof initRoomsPage === 'function') initRoomsPage();
        if (typeof renderCompactRoomGrid === 'function') renderCompactRoomGrid();
      }
    }
  } catch (e) {
    console.error('revertTransitionToPlayer failed:', e);
    showToast('ย้อนกลับไม่สำเร็จ: ' + (e?.message || String(e)), 'error');
  }
}
window.revertTransitionToPlayer = revertTransitionToPlayer;

// ─── Checklist instance trigger (Tier 3I) ────────────────────────────────────
// Opens a quick dialog to choose move_in or move_out, then calls
// ChecklistManager.createInstance so tenant can fill it in their LIFF app.
async function openChecklistModal() {
  const building = currentEditBuilding;
  const roomId   = currentEditRoomId;
  if (!building || !roomId) {
    showToast('ไม่พบข้อมูลห้อง', 'error');
    return;
  }

  if (!window.ChecklistManager) {
    showToast('ChecklistManager ยังไม่โหลด', 'error');
    return;
  }

  const occupancy  = TenantLookup.getRoomOccupancyInfo(building, roomId);
  const tenant     = occupancy.tenant || {};
  const tenantName = String(tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`).trim();
  let   tenantUid  = tenant.linkedAuthUid || '';
  const hasLiff    = !!tenant.linkedAuthUid;

  if (!tenantUid) {
    // No LIFF-linked UID — allow admin to still create an instance for their own flow
    // (tenant won't see it in LIFF app until they link their account)
    if (!tenantName) {
      showToast('ห้องนี้ยังไม่มีผู้เช่า', 'info');
      return;
    }
    const proceed = confirm(
      `ผู้เช่า "${tenantName}" ยังไม่ได้ Link LIFF\n\n` +
      `สามารถสร้าง checklist ได้ แต่ผู้เช่าจะไม่เห็นใน app จนกว่าจะ Link\n\n` +
      `ต้องการสร้างสำหรับแอดมินตรวจสอบเองหรือไม่?`
    );
    if (!proceed) return;
    tenantUid = window.firebase?.auth?.()?.currentUser?.uid || ('admin_' + Date.now());
  }

  // Check if building has a template
  const tpl = await window.ChecklistManager.getTemplate(building).catch(() => null);
  if (!tpl || !Array.isArray(tpl.items) || !tpl.items.length) {
    const goEdit = confirm(`ยังไม่มี checklist template สำหรับอาคาร "${building}"\n\nไปตั้งค่า template ใน Buildings → ⚙️ Checklist Template หรือไม่?`);
    if (goEdit && typeof window.showPage === 'function') {
      window.showPage('buildings');
    }
    return;
  }

  // Duplicate guard — warn if an active (pending/submitted) instance already exists
  const existingInstance = await window.ChecklistManager.getActiveInstanceForRoom(building, roomId).catch(() => null);
  if (existingInstance) {
    const statusLabel = existingInstance.status === 'submitted' ? 'รอแอดมิน sign' : 'รอผู้เช่ากรอก';
    const proceed = confirm(
      `⚠️ ห้อง ${roomId} มี checklist ที่ยังค้างอยู่ (${statusLabel})\n\n` +
      `สร้างอีก instance จะทำให้ผู้เช่าสับสน\n\n` +
      `ต้องการสร้างใหม่ทับอยู่ดีหรือไม่?`
    );
    if (!proceed) return;
  }

  const typeLabel = await window.ghPrompt(
    `สร้าง Checklist ห้อง ${roomId} — ${tenantName || 'ผู้เช่า'}\n\nพิมพ์ "in" สำหรับ Move-In หรือ "out" สำหรับ Move-Out:`,
    'in',
    { title: '📋 ประเภท Checklist', confirmLabel: 'สร้าง' }
  );
  if (!typeLabel) return;
  const type = typeLabel.trim().toLowerCase() === 'out' ? 'move_out' : 'move_in';
  const typeText = type === 'move_out' ? 'ย้ายออก' : 'ย้ายเข้า';

  const confirmed = confirm(
    `ยืนยันสร้าง checklist ${typeText} สำหรับห้อง ${roomId}?\n` +
    `ผู้เช่า: ${tenantName || tenantUid}\n` +
    (hasLiff
      ? `ผู้เช่าจะเห็น instance ใน app ทันที`
      : `⚠️ ผู้เช่ายังไม่ได้เชื่อม LINE — instance จะรอจนกว่าจะ Link`)
  );
  if (!confirmed) return;

  const btn = document.querySelector('[data-action="openChecklistModal"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังสร้าง...'; }

  try {
    const result = await window.ChecklistManager.createInstance({
      building,
      roomId,
      tenantUid,
      tenantRoom: roomId,
      tenantName,
      type,
    });
    showToast(
      `✅ สร้าง checklist ${typeText} แล้ว — ` +
      (hasLiff ? `ผู้เช่าจะเห็นใน app` : `⚠️ ผู้เช่ายังไม่ได้เชื่อม LINE`),
      hasLiff ? 'success' : 'warning'
    );

    // Auto-navigate to Checklists tab so admin can see the new instance immediately
    if (typeof window.showPage === 'function') {
      window.showPage('requests-approvals');
      setTimeout(() => {
        const tabBtn = document.getElementById('tab-checklist-btn');
        if (typeof switchRequestsTab === 'function') switchRequestsTab('checklist', tabBtn);
        if (typeof window.setChecklistAdminBuilding === 'function') window.setChecklistAdminBuilding(building);
      }, 150);
    }
  } catch (err) {
    console.error('openChecklistModal error:', err);
    showToast('สร้างไม่สำเร็จ: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗒️ Checklist ห้อง'; }
  }
}
window.openChecklistModal = openChecklistModal;

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  const modal = document.getElementById('tenantModal');
  if (modal && e.target === modal) {
    closeTenantModal();
  }
});
