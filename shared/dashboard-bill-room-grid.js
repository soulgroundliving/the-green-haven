// ===== BILL ROOM GRID + PAYMENT STATUS UI =====

// Update visual state of ส่งใบวางบิล + ออกใบเสร็จรับเงิน buttons
// based on whether the selected room has already paid this month.
// PAID   → both buttons faded  (room is settled, no urgent action)
// UNPAID → invoice vivid, receipt vivid-override (awaiting payment)
function _updateBillActionPaidState(){
  const row=document.querySelector('.bill-actions-row');
  if(!row)return;
  const roomId=(document.getElementById('f-room')||{}).value;
  if(!roomId){row.classList.remove('room-paid','room-unpaid');return;}
  const month=parseInt(document.getElementById('f-month').value);
  const year=parseInt(document.getElementById('f-year').value);
  const fbBld=getBuildingInfo(window.currentBuilding).firebaseBuilding;
  const paid=typeof PaymentStore!=='undefined'&&PaymentStore.isPaid(fbBld,roomId,year,month);
  row.classList.toggle('room-paid',paid);
  row.classList.toggle('room-unpaid',!paid);
}

function renderPaymentStatus(){
  // Keep #payStatusGrid updated for backward compat (it's hidden in the new layout)
  const el=document.getElementById('payStatusGrid');
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  const paid = (typeof PaymentStore !== 'undefined')
    ? PaymentStore.listForMonth(year, month)
    : (loadPS()[`${year}_${month}`] || {});
  const bldgInfo = getBuildingInfo(window.currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  if(el){
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
      if(p) return`<span data-action="showPayDetail" data-id="${r.id}" title="คลิกดูรายละเอียด" class="u-bill-paid-badge">✅ ${r.id}</span>`;
      return`<span data-action="selectRoomForBill" data-id="${r.id}" title="คลิกเพื่อออกบิล" class="u-bill-pending-badge">⏳ ${r.id}</span>`;
    }).join('')}
    </div>`;
  }
  // Also refresh the new room-grid UI
  renderRoomGrid();
}

function selectRoomForBill(roomId){
  // Ensure we're on the bill page (sidebar sync via showPage)
  window.showPage('bill');
  // Drive the hidden select — triggers onRoomChange() via data-action delegation
  const sel = document.getElementById('f-room');
  if(sel){
    sel.value = roomId;
    sel.dispatchEvent(new Event('change', {bubbles: true}));
  }
  // Show the right-panel form
  _showBillActiveRoom(roomId);
  // Highlight the active card in the grid
  document.querySelectorAll('.bill-room-card').forEach(c=>c.classList.remove('bc-active'));
  const card = document.querySelector(`.bill-room-card[data-room="${roomId}"]`);
  if(card){ card.classList.add('bc-active'); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  // Auto-focus the invoice button so keyboard users can hit Enter immediately
  setTimeout(()=>{ document.querySelector('[data-action="generateInvoice"]:not([disabled])')?.focus(); }, 80);
}

// ── Direction A helpers ────────────────────────────────────────────────────

/** Show/hide the right-panel active-room form */
function _showBillActiveRoom(roomId){
  const empty  = document.getElementById('billEmptyState');
  const active = document.getElementById('billActiveRoom');
  if(!empty||!active) return;
  if(roomId){
    empty.classList.add('u-hidden');
    active.classList.remove('u-hidden');
  } else {
    empty.classList.remove('u-hidden');
    active.classList.add('u-hidden');
  }
  // Always hide doc panels + next-btn when switching rooms — they reveal again after ส่งใบวางบิล
  document.getElementById('billDocPanels')?.classList.add('u-hidden');
  document.getElementById('btnNextUnpaidRoom')?.classList.add('u-hidden');
}

/** Update the room-header card (room #, tenant, paid badge) after onRoomChange() */
function _updateBillRoomHeader(){
  const roomId = document.getElementById('f-room')?.value;
  if(!roomId) return;

  const fpNum = document.getElementById('fpRoomNum');
  const fpTenant = document.getElementById('fpTenantLabel');
  const fpBadge = document.getElementById('fpPaidBadge');
  if(fpNum) fpNum.textContent = 'ห้อง ' + roomId;

  // Tenant name from the hidden #f-tenant-name span (already filled by onRoomChange)
  const tn = document.getElementById('f-tenant-name');
  if(fpTenant) fpTenant.textContent = tn?.textContent || '';

  // Paid badge
  if(fpBadge){
    const month = parseInt(document.getElementById('f-month').value);
    const year  = parseInt(document.getElementById('f-year').value);
    const fbBld = getBuildingInfo(window.currentBuilding).firebaseBuilding;
    const isPaid = typeof PaymentStore!=='undefined' && PaymentStore.isPaid(fbBld, roomId, year, month);
    fpBadge.textContent = isPaid ? '✅ ชำระแล้ว' : '⏳ ยังไม่ชำระ';
    fpBadge.className = 'bill-paid-badge ' + (isPaid ? 'is-paid' : 'is-unpaid');
  }
}

/** Render large clickable room cards in #billRoomGrid */
function renderRoomGrid(){
  const container = document.getElementById('billRoomGrid');
  const chip      = document.getElementById('billProgressChip');
  if(!container) return;

  const month    = parseInt(document.getElementById('f-month').value) || (new Date().getMonth()+1);
  const year     = parseInt(document.getElementById('f-year').value)  || (new Date().getFullYear()+543);
  const bldgInfo = getBuildingInfo(window.currentBuilding);
  const rooms    = typeof getActiveRoomsWithMetadata==='function'
    ? getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray)
    : [];
  const paidMap  = typeof PaymentStore!=='undefined' ? PaymentStore.listForMonth(year, month) : {};
  const activeId = document.getElementById('f-room')?.value || '';

  // Tenant name lookup
  const tenantNames = {};
  try {
    const list = (typeof TenantConfigManager!=='undefined')
      ? TenantConfigManager.getTenantList(bldgInfo.firebaseBuilding) : {};
    Object.values(list).forEach(t=>{ if(t.roomId) tenantNames[t.roomId] = t.name||''; });
  } catch(e){}

  const paidCount   = rooms.filter(r=>paidMap[r.id]).length;
  const unpaidCount = rooms.length - paidCount;

  if(chip) chip.innerHTML =
    `<span style="color:var(--green-dark)">✅ ${paidCount}</span>&nbsp;·&nbsp;<span style="color:#c2410c">⏳ ${unpaidCount}</span>`;

  if(!rooms.length){
    container.innerHTML='<div style="color:var(--text-muted);font-size:.8rem;padding:.4rem;">ไม่พบห้อง</div>';
    return;
  }

  const cards = rooms.map(r=>{
    const isPaid   = !!paidMap[r.id];
    const isActive = r.id===activeId;
    const tenant   = tenantNames[r.id]||'';
    const entry    = paidMap[r.id];
    const amount   = entry?.amount ? '฿'+parseInt(entry.amount).toLocaleString() : '';
    const stCls    = isActive ? 'bc-active' : (isPaid ? 'bc-paid' : 'bc-unpaid');
    const icon     = isPaid ? '✅' : '⏳';
    const clickAttrs = isPaid
      ? `data-action="showPayDetail" data-id="${r.id}" data-year="${year}" data-month="${month}"`
      : `data-action="selectRoomForBill" data-id="${r.id}"`;
    return `<div class="bill-room-card ${stCls}" data-room="${r.id}" tabindex="0" ${clickAttrs} title="${isPaid?'ดูรายละเอียด':'คลิกเพื่อออกบิล'}">
      <span class="bc-icon">${icon}</span>
      <span class="bc-num">${r.id}</span>
      ${tenant?`<span class="bc-tenant">${tenant}</span>`:''}
      ${amount?`<span class="bc-amount">${amount}</span>`:''}
    </div>`;
  }).join('');

  container.innerHTML = cards;
}
window.renderRoomGrid = renderRoomGrid;

/** Advance to the next unpaid room (batch workflow) */
function _goToNextUnpaidRoom(){
  const month    = parseInt(document.getElementById('f-month').value);
  const year     = parseInt(document.getElementById('f-year').value);
  const bldgInfo = getBuildingInfo(window.currentBuilding);
  const rooms    = typeof getActiveRoomsWithMetadata==='function'
    ? getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray) : [];
  const paidMap  = typeof PaymentStore!=='undefined' ? PaymentStore.listForMonth(year, month) : {};
  const currentId= document.getElementById('f-room')?.value||'';
  const currentIdx = rooms.findIndex(r=>r.id===currentId);
  // Search from current+1, then wrap around
  const after   = rooms.slice(currentIdx+1).find(r=>!paidMap[r.id]);
  const before  = rooms.slice(0, currentIdx).find(r=>!paidMap[r.id]);
  const next    = after||before;
  if(next){
    selectRoomForBill(next.id);
  } else {
    if(typeof showToast==='function') showToast('ทุกห้องชำระแล้วสำหรับเดือนนี้ 🎉','success');
  }
}
window.goToNextUnpaidRoom = _goToNextUnpaidRoom;
