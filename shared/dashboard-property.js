// ===== ROOM FILTER STATE =====
const _escProp = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
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
      waterRate: r.waterRate || 20,
      electricRate: r.electricRate || 8,
      deleted: r.deleted,
      rentPrice: rentPrice,
      trashRate: r.trashRate || metadata?.trashFee || 20,
      type: r.type || metadata?.type || 'room',
      trashFee: r.trashRate || metadata?.trashFee || 20,
      elecRate: r.electricRate || metadata?.elecRate || 8,
      floor: r.floor || metadata?.floor,
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
      <div class="room-status">${r.type==='commercial'?'🏪 พาณิชย์':occupancyIcon + (tenant && tenant.name ? ' ' + _escProp(tenant.name) : ' ว่าง')}</div>
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
        <span class="compact-card-value">${_escProp(tenant.name)}</span>
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
    compactView.classList.remove('u-hidden');
    classicView.classList.add('u-hidden');
  }else{
    compactView.classList.add('u-hidden');
    classicView.classList.remove('u-hidden');
  }
}

function editRoom(roomId){openTenantModal(roomId);}
function viewRoomDetails(roomId){openTenantModal(roomId);}

// ===== BATCH RENT ADJUSTMENT FUNCTIONS =====
let batchSelectedRooms = new Set();

function openBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (!modal) return;
  modal.classList.remove('u-hidden'); /*flex*/;
  renderRoomSelectionCheckboxes();
  updateAdjustmentDisplay();
}

function closeBatchRentAdjustmentModal() {
  const modal = document.getElementById('batchRentModal');
  if (modal) modal.classList.add('u-hidden');
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
    compactView.classList.remove('u-hidden');
    classicView.classList.add('u-hidden');
  } else {
    compactView.classList.add('u-hidden');
    classicView.classList.remove('u-hidden');
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
    const roomPets = r.type === 'pet-allowed'
      ? JSON.parse(localStorage.getItem(`tenant_pets_nest_${r.id}`) || '[]').filter(p => p.status === 'approved')
      : [];
    const statusInfo = getRoomColorStatus(r.id, r);
    const bgColor = statusInfo.color+'40';
    const borderColor = statusInfo.color;
    return `
    <div class="room-pill ${r.type === 'pet-allowed' ? 'pet-allowed' : 'studio'}" onclick="openTenantModal('nest', '${r.id}')" style="cursor:pointer;transition:transform 0.2s;background:${bgColor};border:2px solid ${borderColor};">
      <div class="room-num">${(r.name || r.id).replace(/^ห้อง |^Nest /, '')}</div>
      <div class="room-rent">฿${r.rentPrice.toLocaleString()}/เดือน</div>
      <div class="room-status">${typeIcon} ${tenant && tenant.name ? tenant.name : 'ว่าง'}</div>
      ${roomPets.length > 0 ? `<div style="font-size:0.7rem;text-align:center;margin-top:2px;">🐾 ${roomPets.map(p=>_escProp(p.name||p.type||'สัตว์เลี้ยง')).join(', ')}</div>` : ''}
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

