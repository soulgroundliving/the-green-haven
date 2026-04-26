// ===== TENANT MANAGEMENT =====
// Phase 4 SSoT projection: SSoT docs have lease info nested under .lease,
// but card-render code throughout the dashboard still reads flat fields
// (t.contractEnd, t.deposit, t.moveInDate). Project lease subobject onto
// the expected flat names so existing render code keeps working.
function _projectSSoTToFlat(t) {
  if (!t || typeof t !== 'object') return t;
  const lease = t.lease || {};
  return {
    ...t,
    contractEnd: t.contractEnd || lease.endDate || lease.moveOutDate || t.moveOutDate || null,
    moveInDate:  t.moveInDate  || lease.startDate || lease.moveInDate || null,
    moveOutDate: t.moveOutDate || lease.endDate || lease.moveOutDate || null,
    deposit:     (t.deposit !== undefined && t.deposit !== null) ? t.deposit : (lease.deposit ?? null),
    rentAmount:  t.rentAmount ?? lease.rentAmount ?? null,
  };
}
function loadTenants(){
  // TenantConfigManager stores to tenant_master_data: {rooms: {id: {...}}, nest: {id: {...}}}
  // Flatten to {id: {...}} for backward compatibility
  const master = localStorage.getItem('tenant_master_data');
  if (master) {
    const raw = JSON.parse(master);
    const flat = Object.values(raw).reduce((acc, bld) => Object.assign(acc, bld), {});
    Object.keys(flat).forEach(k => { flat[k] = _projectSSoTToFlat(flat[k]); });
    return flat;
  }
  const legacy = JSON.parse(localStorage.getItem('tenant_data')||'{}');
  Object.keys(legacy).forEach(k => { legacy[k] = _projectSSoTToFlat(legacy[k]); });
  return legacy;
}

function saveTenants(t){localStorage.setItem('tenant_data',JSON.stringify(t));}

// Initialize all rooms with default tenant users
function initializeAllRoomUsers() {
  const tenants = loadTenants();
  const tNames = ['สมชาย ใจดี', 'นางสาวจิรา สมิตร', 'นายวิชัย จันทร์สว่าง', 'นางสมหญิง พรประเสริฐ', 'นายกมล วงศ์พันธ์',
    'นางปวณีย์ ศรีสวัสดิ์', 'นายศักดา บุญเพิ่ม', 'นับพบ ยิ่มเสถียร', 'นางนิยม ดวงแว่', 'นายปณิต นิยมาน',
    'นางกรรณิการ์ มัตตานี', 'นายเสวิชญ์ ศรีสอง', 'นางอรทัย ชิดโพธิ์', 'นายอภิวัฒน์ คงประเสริฐ'];

  // Get all rooms from RoomConfigManager
  const roomsConfig = RoomConfigManager.getRoomsConfig('rooms');
  const nestConfig = RoomConfigManager.getRoomsConfig('nest');

  let nameIndex = 0;
  let updated = 0;

  // Create users for Rooms building
  if (roomsConfig && roomsConfig.rooms) {
    roomsConfig.rooms.forEach(room => {
      if (!tenants[room.id]) {
        tenants[room.id] = {
          name: tNames[nameIndex % tNames.length],
          lineId: `@tenant_${room.id}`,
          moveInDate: new Date(2024, 0, 15).toISOString().split('T')[0],
          contractEnd: new Date(2025, 11, 15).toISOString().split('T')[0],
          deposit: 3000,
          note: `Tenant for ${room.name}`,
          updatedAt: new Date().toISOString()
        };
        updated++;
        nameIndex++;
      }
    });
  }

  // NOTE: Nest building intentionally excluded — not yet open for service
  // Nest tenants will be added manually when building opens

  if (updated > 0) {
    saveTenants(tenants);
    console.log(`✅ Initialized ${updated} room users`);
    return updated;
  }
  return 0;
}
let tenantBuilding='old';
let currentTenantFilter='all';

function setTenantBuilding(bld,btn){
  document.querySelectorAll('#page-tenant .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  tenantBuilding=bld;
  currentTenantFilter='all';
  // Reset filter buttons to "ทั้งหมด"
  document.querySelectorAll('.filter-btn-tenant').forEach((b,i)=>{
    b.classList.toggle('active',i===0);
    b.style.background=i===0?'var(--green-dark)':'white';
    b.style.color=i===0?'white':b.style.borderColor||'#666';
  });
  // Show/hide building-specific sections
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = bld==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = bld==='new' ? '' : 'none';
  // Init the building's room grid & info cards
  if(bld==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
}

function initTenantPage(){
  // Show/hide building sections based on current building tab
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.style.display = tenantBuilding==='old' ? '' : 'none';
  if(nestSec)  nestSec.style.display  = tenantBuilding==='new' ? '' : 'none';
  // Initialize the active building room grid
  if(tenantBuilding==='old'){ initRoomsPage(); } else { initNestPage(); }
  renderTenantPage();
  renderTenantTable();
  updateTenantAlertBlock();
  updateRoomTypeCards();
  const searchInput=document.getElementById('tenantSearch');
  if(searchInput){
    searchInput.addEventListener('input',()=>{
      renderTenantPage();
      renderTenantTable();
      updateTenantAlertBlock();
      updateRoomTypeCards();
    });
  }
  _setupTenantRealtimeListener();
}

let _tenantListenerUnsubscribers=[];
function _setupTenantRealtimeListener(){
  // Unsubscribe previous listeners to avoid duplicates
  _tenantListenerUnsubscribers.forEach(fn=>fn());
  _tenantListenerUnsubscribers=[];
  if(!window.firebase?.firestoreFunctions) return;
  const {collection,onSnapshot}=window.firebase.firestoreFunctions;
  const db=window.firebase.firestore();
  ['rooms','nest'].forEach(bld=>{
    const unsub=onSnapshot(collection(db,`tenants/${bld}/list`),snap=>{
      const all=JSON.parse(localStorage.getItem('tenant_master_data')||'{}');
      if(!all[bld])all[bld]={};
      snap.forEach(doc=>{all[bld][doc.id]=doc.data();});
      localStorage.setItem('tenant_master_data',JSON.stringify(all));
      if(document.getElementById('page-tenant')?.style.display!=='none'){
        renderTenantPage();
        renderTenantTable();
        updateTenantAlertBlock();
        updateRoomTypeCards();
      }
      if(document.getElementById('page-property')?.style.display!=='none'){
        const nestVisible = document.getElementById('property-nest-section')?.style.display!=='none';
        if(nestVisible && typeof initNestPage==='function') initNestPage();
        else if(typeof initRoomsPage==='function') initRoomsPage();
      }
    },err=>console.warn('tenant listener error:',err));
    _tenantListenerUnsubscribers.push(unsub);
  });
}

function _getTenantRooms(){
  return tenantBuilding==='old'
    ?getActiveRoomsWithMetadata('rooms',window.ROOMS_OLD)
    :getActiveRoomsWithMetadata('nest',window.NEST_ROOMS);
}

function renderTenantPage(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let occ=0,vac=0,soon=0;
  rooms.forEach(r=>{
    const t=tenants[r.id];
    if(t?.name){
      occ++;
      if(t.contractEnd){
        const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
        if(diff>=0&&diff<=30)soon++;
      }
    }else vac++;
  });
  // Write สัญญาใกล้หมด to the unified building KPI (occupancy-soon / nest-occupancy-soon)
  const soonId = tenantBuilding==='old' ? 'occupancy-soon' : 'nest-occupancy-soon';
  const soonEl = document.getElementById(soonId);
  if(soonEl){
    soonEl.textContent = soon;
    // Color: red if any expiring, purple otherwise
    const card = soonEl.closest('.kpi-card');
    if(card){ card.className = `kpi-card ${soon>0?'red':'purple'}`; }
  }
  const grid=document.getElementById('tenantGrid');if(!grid)return;
  const searchTerm=(document.getElementById('tenantSearch')?.value||'').toLowerCase();

  // Apply filters
  let filtered=rooms.filter(r=>{
    const t=tenants[r.id];
    const matchSearch=!searchTerm||r.id.toString().toLowerCase().includes(searchTerm)||(t?.name||'').toLowerCase().includes(searchTerm);
    if(!matchSearch)return false;
    const isOcc=!!t?.name;
    if(currentTenantFilter==='occupied')return isOcc;
    if(currentTenantFilter==='vacant')return !isOcc;
    if(currentTenantFilter==='expiring'){
      if(!t?.contractEnd)return false;
      const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
      return diff>=0&&diff<=30;
    }
    return true;
  });

  grid.innerHTML=filtered.map(r=>{
    const t=tenants[r.id];
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t?.moveInDate||t?.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{month:'short',day:'numeric'}):'—';
    const ce=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{month:'short',day:'numeric',year:'2-digit'}):'—';
    let daysLeft='—',expiryColor='var(--text-muted)';
    if(t?.contractEnd){
      const days=Math.ceil((new Date(t.contractEnd)-today)/86400000);
      if(days>0){daysLeft=days;expiryColor=days<=30?'var(--red)':days<=60?'#f57c00':'var(--green-dark)';}
      else{daysLeft='❌ หมดแล้ว';expiryColor='var(--red)';}
    }
    return`<div class="compact-card${!isOcc?' vacant':''}" style="border-left-color:${isCom?'var(--blue)':isOcc?'var(--green)':'#ff9800'}">
      <div class="compact-card-header">
        <div class="compact-card-id">${r.id}</div>
        <span class="compact-card-type">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span style="margin-left:auto;font-size:.75rem;padding:2px 8px;border-radius:4px;background:${isOcc?'var(--green-pale)':'#fff3e0'};color:${isOcc?'var(--green-dark)':'#e65100'};font-weight:600;">${isOcc?'มีผู้เช่า':'ว่าง'}</span>
      </div>
      <div class="compact-card-info">
        <span style="font-size:.8rem;color:var(--text-muted);">${isCom?'🏪 พาณิชย์':'🏠 ที่พัก'}</span>
        <span class="compact-card-value">฿${Number(r.rentPrice||r.rent||0).toLocaleString()}</span>
      </div>
      ${isOcc?`
      <div class="compact-card-info"><span style="font-weight:600;color:var(--text);">ชื่อ</span><span class="compact-card-value">${t.name}</span></div>
      <div class="compact-card-info"><span>โทร</span><span style="font-size:.8rem;">${t.phone||'—'}</span></div>
      <div class="compact-card-info"><span>เข้าพัก</span><span style="font-size:.8rem;">${mi}</span></div>
      <div class="compact-card-info"><span>สัญญาสิ้นสุด</span><span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${ce}</span></div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${typeof daysLeft==='number'?daysLeft+' วัน':daysLeft}</span>
      </div>
      ${t.deposit?`<div class="compact-card-info"><span style="font-size:.75rem;color:var(--text-muted);">มัดจำ</span><span style="font-weight:700;color:var(--green-dark);">฿${Number(t.deposit).toLocaleString()}</span></div>`:''}
      `:`<div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);"><span>🚪 ไม่มีผู้เช่า</span></div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button onclick="openTenantModal('${tenantBuilding==='old'?'rooms':'nest'}','${r.id}')" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">📄 สัญญา</button>
        <button onclick="showBillingModal('${r.id}')" style="background:#e8f5e9;color:#388e3c;border:1px solid #388e3c;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">💰 ชำระ</button>
        <button onclick="showBillingHistoryModal('${r.id}')" style="background:#fff3e0;color:#f57c00;border:1px solid #f57c00;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🧾 บิล</button>
        <button onclick="window.showPage('requests-approvals')" style="background:#f3e5f5;color:#7b1fa2;border:1px solid #7b1fa2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">🔧 ซ่อม</button>
      </div>
    </div>`;
  }).join('');

  if(filtered.length===0){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</div>';
  }
  updateTenantAlertBlock();
  updateRoomTypeCards();
}

// ===== COMPACT TENANT TABLE RENDERING =====
function renderTenantTable(){
  const searchInput=document.getElementById('tenantSearch');
  const searchTerm=(searchInput?.value||'').toLowerCase();
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const tbody=document.getElementById('tenantTableBody');
  const today=new Date();

  const rows=rooms.filter(r=>{
    const t=tenants[r.id]||{};
    const roomStr=r.id.toString().toLowerCase();
    const nameStr=(t.name||'').toLowerCase();
    return roomStr.includes(searchTerm)||nameStr.includes(searchTerm);
  }).map(r=>{
    const t=tenants[r.id]||{};
    const isOcc=!!t?.name;
    const isCom=r.type==='commercial';
    const mi=(t.moveInDate||t.moveIn)?new Date(t.moveInDate||t.moveIn).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const ce=t.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
    const diff=t.contractEnd?Math.round((new Date(t.contractEnd)-today)/(1000*60*60*24)):null;
    const status=isCom?'💼 พาณิชย์':!isOcc?'🚪 ว่าง':diff===null?'—':diff<0?'❌ หมด':diff<=30?`⚠️ ${diff}วัน`:'✅ ปกติ';
    return`<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px;font-weight:700;color:var(--green-dark);">${r.id}</td>
      <td style="padding:10px;">${isOcc?t.name:'<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${t.phone||'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${mi}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${ce}</td>
      <td style="padding:10px;text-align:center;font-weight:700;color:var(--green-dark);">${t.deposit?'฿'+Number(t.deposit).toLocaleString():'—'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;font-weight:600;">${status}</td>
    </tr>`;
  });

  tbody.innerHTML=rows.join('');
  if(rows.length===0){
    tbody.innerHTML=`<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลที่ค้นหา</td></tr>`;
  }
}

function toggleTenantView(view, btn){
  const cardsView=document.getElementById('tenantViewCards');
  const tableView=document.getElementById('tenantViewTable');
  document.querySelectorAll('.view-toggle-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(view==='cards'){
    cardsView.style.display='block';
    tableView.style.display='none';
  }else{
    cardsView.style.display='none';
    tableView.style.display='block';
  }
}

// ===== TENANT FILTER =====
function setTenantFilter(filter){
  currentTenantFilter=filter;
  // Active state styled purely by CSS (.filter-btn-tenant.active); just toggle class.
  document.querySelectorAll('.filter-btn-tenant').forEach(btn=>btn.classList.remove('active'));
  if(event?.target) event.target.classList.add('active');
  renderTenantPage();
  renderTenantTable();
}

// ===== TENANT ALERT BLOCK =====
function updateTenantAlertBlock(){
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  const expiring=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const diff=(new Date(t.contractEnd)-today)/(1000*60*60*24);
    return diff>=0&&diff<=30;
  });
  const alertBlock=document.getElementById('tenantAlertBlock');
  const alertList=document.getElementById('tenantAlertList');
  if(!alertBlock) return;
  if(expiring.length===0){
    alertBlock.style.display='none';
  }else{
    alertBlock.style.display='block';
    if(alertList) alertList.innerHTML=expiring.map(r=>`<div style="background:#fff;padding:6px 12px;border-radius:6px;border-left:3px solid #f57c00;font-size:.85rem;">🚪 ห้อง ${r.id}</div>`).join('');
  }
}

// ===== ROOM TYPE INFO CARDS =====
function updateRoomTypeCards(){
  const rooms=_getTenantRooms();
  const container=document.getElementById('roomTypeCardsContainer');
  if(!container) return;
  const types={};
  (rooms||[]).forEach(room=>{
    if(!types[room.type])types[room.type]={type:room.type,rooms:0,rent:room.rentPrice||room.rent||0};
    types[room.type].rooms++;
  });
  container.innerHTML=Object.values(types).map(typeInfo=>`
    <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:1rem;">
      <div style="font-weight:700;color:var(--green);margin-bottom:0.5rem;">${typeInfo.type}</div>
      <div style="font-size:.9rem;color:var(--text-muted);">
        <div>🏠 ${typeInfo.rooms} ห้อง</div>
        <div>💰 ฿${Number(typeInfo.rent).toLocaleString()} / เดือน</div>
      </div>
    </div>
  `).join('');
}

// ===== EXPORT TENANT CSV =====
function exportTenantCSV(){
  const building=tenantBuilding==='old'?'ห้องแถว':'Nest';
  const rooms=_getTenantRooms();
  const tenants=loadTenants();
  const today=new Date();
  let csv='ห้อง,ชื่อ-นามสกุล,เบอร์โทร,วันเข้า,วันหมดสัญญา,มัดจำ,สถานะ\n';
  rooms.forEach(r=>{
    const t=tenants[r.id];
    const name=t?.name||'ว่าง';
    const phone=t?.phone||'-';
    const moveIn=t?.moveInDate?new Date(t.moveInDate).toLocaleDateString('th-TH'):'-';
    const contractEnd=t?.contractEnd?new Date(t.contractEnd).toLocaleDateString('th-TH'):'-';
    const deposit=t?.deposit?Number(t.deposit).toLocaleString('th-TH'):'-';
    const status=!t?.name?'ว่าง':t.contractEnd&&new Date(t.contractEnd)<today?'หมด':'ปกติ';
    csv+=`"${r.id}","${name}","${phone}","${moveIn}","${contractEnd}","${deposit}","${status}"\n`;
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`tenant-${building}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

let editingTenantRoom=null;
function showTenantModal(roomId){
  editingTenantRoom=roomId;
  const t=loadTenants()[roomId]||{};
  document.getElementById('payModalTitle').textContent=`👤 ผู้เช่า — ห้อง ${roomId}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');
  body.innerHTML=`
    <div class="pm-row"><span class="pm-label">ชื่อ-นามสกุล</span><input class="pm-input" id="tm-name" style="width:185px" type="text" value="${t.name||''}" placeholder="สมชาย ใจดี"></div>
    <div class="pm-row"><span class="pm-label">Line ID</span><input class="pm-input" id="tm-line" style="width:145px" type="text" value="${t.lineId||''}" placeholder="@username"></div>
    <div class="pm-row"><span class="pm-label">วันที่เข้าอยู่</span><input class="pm-input" id="tm-moveIn" style="width:145px" type="date" value="${t.moveInDate||''}"></div>
    <div class="pm-row"><span class="pm-label">วันหมดสัญญา</span><input class="pm-input" id="tm-contractEnd" style="width:145px" type="date" value="${t.contractEnd||''}"></div>
    <div class="pm-row"><span class="pm-label">เงินมัดจำ (บาท)</span><input class="pm-input" id="tm-deposit" type="number" value="${t.deposit||0}"></div>
    <div class="pm-row"><span class="pm-label">หมายเหตุ</span><input class="pm-input" id="tm-note" style="width:185px" type="text" value="${t.note||''}" placeholder="เช่น มีสัตว์เลี้ยง..."></div>`;
  footer.innerHTML=`
    <button class="pm-btn green" onclick="saveTenant()">💾 บันทึก</button>
    ${t.name?`<button class="pm-btn red" onclick="deleteTenant('${roomId}')">🗑️ ลบผู้เช่า</button>`:''}
    <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  document.getElementById('payModalOverlay').classList.add('show');

  // Initialize phone validation for the modal
  setTimeout(function() {
    initPhoneValidation();
  }, 100);
}

function saveTenant(){
  if(!editingTenantRoom)return;
  const tenants=loadTenants();
  const name=document.getElementById('tm-name').value.trim();
  if(name){
    tenants[editingTenantRoom]={
      name,
      lineId:document.getElementById('tm-line').value.trim(),
      moveInDate:document.getElementById('tm-moveIn').value,
      contractEnd:document.getElementById('tm-contractEnd').value,
      deposit:parseFloat(document.getElementById('tm-deposit').value)||0,
      note:document.getElementById('tm-note').value.trim(),
      updatedAt:new Date().toISOString()
    };
  }else{delete tenants[editingTenantRoom];}
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
  const toast=document.createElement('div');
  toast.textContent=name?`✅ บันทึกผู้เช่าห้อง ${editingTenantRoom} เรียบร้อย`:`🗑️ ลบข้อมูลผู้เช่าห้อง ${editingTenantRoom} แล้ว`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2200);
}

function deleteTenant(roomId){
  if(!confirm(`ยืนยันการลบผู้เช่าห้อง ${roomId}?`))return;
  const tenants=loadTenants();
  delete tenants[roomId];
  saveTenants(tenants);
  closePayModal();
  renderTenantPage();
  updateDashboardLive();
}

// ===== EXPENSE MANAGEMENT =====
function loadExpenses(){return JSON.parse(localStorage.getItem('expense_data')||'[]');}
function saveExpenses(e){localStorage.setItem('expense_data',JSON.stringify(e));}

function initExpensePage(){
  const now=new Date();
  const fm=document.getElementById('exp-filter-month');
  const fy=document.getElementById('exp-filter-year');
  const ed=document.getElementById('exp-date');
  if(fm)fm.value=now.getMonth()+1;
  if(fy)fy.value=now.getFullYear()+543;
  if(ed&&!ed.value)ed.value=now.toISOString().split('T')[0];
  renderExpensePage();
}

function renderExpensePage(){
  const now=new Date();
  const filterMonth=parseInt(document.getElementById('exp-filter-month')?.value||now.getMonth()+1);
  const filterYear=parseInt(document.getElementById('exp-filter-year')?.value||now.getFullYear()+543);
  const expenses=loadExpenses();
  const filtered=expenses.filter(e=>{
    if(!e.date)return false;
    const d=new Date(e.date);
    return d.getMonth()+1===filterMonth&&(d.getFullYear()+543)===filterYear;
  });
  const total=filtered.reduce((a,e)=>a+e.amount,0);
  const byCat={};
  filtered.forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount;});
  const ps=loadPS();
  const income=Object.values(ps[`${filterYear}_${filterMonth}`]||{}).reduce((a,p)=>a+(p.amount||0),0);
  const profit=income-total;
  const catLabels={repair:'ซ่อมแซม',utility:'ค่าน้ำ/ไฟ',supply:'ซื้อของ',wages:'ค่าแรง',other:'อื่นๆ'};
  const catCls={repair:'cat-repair',utility:'cat-utility',supply:'cat-supply',wages:'cat-wages',other:'cat-other'};
  const expSum=document.getElementById('expSummary');
  if(expSum){
    expSum.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;margin-bottom:1rem;">
        <div style="text-align:center;padding:.75rem;background:var(--green-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--green-dark)">฿${income.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายรับ</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:var(--red-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--red)">฿${total.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายจ่าย</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:${profit>=0?'var(--green-pale)':'var(--red-pale)'};border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:${profit>=0?'var(--green-dark)':'var(--red)'}">${profit>=0?'+':''}฿${profit.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${profit>=0?'กำไร':'ขาดทุน'}</div>
        </div>
      </div>
      ${Object.keys(byCat).length?`<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;">แยกตามหมวด:</div>
      <div style="display:flex;flex-direction:column;gap:5px;">${Object.entries(byCat).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
        <span class="exp-cat-pill ${catCls[cat]||'cat-other'}">${catLabels[cat]||cat}</span>
        <strong>฿${amt.toLocaleString()}</strong></div>`).join('')}</div>`
      :'<div style="text-align:center;color:var(--text-muted);padding:.8rem;font-size:.84rem;">ยังไม่มีรายจ่ายเดือนนี้</div>'}`;
  }
  const listEl=document.getElementById('expList');
  if(listEl){
    if(!filtered.length){
      listEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้</div>';
    }else{
      listEl.innerHTML=`<div class="scroll-x"><table class="data-table">
        <thead><tr><th>วันที่</th><th>หมวด</th><th>รายการ</th><th>ห้อง</th><th>จำนวน</th><th></th></tr></thead>
        <tbody>${filtered.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr>
          <td style="font-size:.8rem;">${new Date(e.date).toLocaleDateString('th-TH',{day:'numeric',month:'short'})}</td>
          <td><span class="exp-cat-pill ${catCls[e.category]||'cat-other'}">${catLabels[e.category]||e.category}</span></td>
          <td>${e.desc}</td>
          <td style="font-size:.8rem;color:var(--text-muted)">${e.room||'—'}</td>
          <td style="font-weight:700;color:var(--red)">฿${e.amount.toLocaleString()}</td>
          <td><button onclick="deleteExpense(${e.id})" style="background:none;border:none;cursor:pointer;font-size:.9rem;" title="ลบ">🗑️</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--red-pale);"><td colspan="4" style="font-weight:700;">รวม</td>
          <td style="font-weight:800;color:var(--red)">฿${total.toLocaleString()}</td><td></td></tr></tfoot>
      </table></div>`;
    }
  }
}

function addExpense(){
  const date=document.getElementById('exp-date').value;
  const category=document.getElementById('exp-category').value;
  const desc=document.getElementById('exp-desc').value.trim();
  const room=document.getElementById('exp-room').value.trim();
  const amount=parseFloat(document.getElementById('exp-amount').value)||0;
  if(!date||!desc||!amount){showToast('กรุณากรอกวันที่ รายการ และจำนวนเงิน', 'warning');return;}
  const expenses=loadExpenses();
  expenses.push({id:Date.now(),date,category,desc,room,amount});
  saveExpenses(expenses);
  document.getElementById('exp-desc').value='';
  document.getElementById('exp-amount').value='';
  document.getElementById('exp-room').value='';
  renderExpensePage();
  const toast=document.createElement('div');
  toast.textContent=`✅ บันทึกรายจ่าย ฿${amount.toLocaleString()} เรียบร้อย`;
  toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a5c38;color:#fff;padding:10px 22px;border-radius:24px;font-family:Sarabun,sans-serif;font-weight:700;font-size:.88rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2000);
}

function deleteExpense(id){
  if(!confirm('ยืนยันการลบรายการนี้?'))return;
  saveExpenses(loadExpenses().filter(e=>e.id!==id));
  renderExpensePage();
}

// ===== TENANT PORTAL MAINTENANCE =====
function loadTenantMaintenance(){
  return JSON.parse(localStorage.getItem('tenant_maintenance')||'[]');
}

function saveTenantMaintenance(data){
  localStorage.setItem('tenant_maintenance',JSON.stringify(data));
}

function submitMaintenance(){
  // Validate tenant maintenance form
  const validation = validateTenantForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    return;
  }

  const room=document.getElementById('tp-room').value.trim();
  const type=document.getElementById('tp-type').value;
  const priority=document.getElementById('tp-priority').value;
  const description=document.getElementById('tp-description').value.trim();

  // Sanitize inputs
  const sanitizedRoom = window.SecurityUtils.sanitizeInput(room);
  const sanitizedDescription = window.SecurityUtils.sanitizeInput(description);

  if(!sanitizedRoom||!type||!sanitizedDescription){
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
    return;
  }

  const data=loadTenantMaintenance();
  data.unshift({
    id:Date.now(),
    room:sanitizedRoom,
    type:type,
    priority:priority,
    description:sanitizedDescription,
    status:'pending',
    submittedAt:new Date().toLocaleString('th-TH'),
    updatedAt:new Date().toLocaleString('th-TH')
  });

  saveTenantMaintenance(data);

  // Reset form
  document.getElementById('tp-room').value='';
  document.getElementById('tp-type').value='';
  document.getElementById('tp-priority').value='medium';
  document.getElementById('tp-description').value='';

  showToast('แจ้งซ่อมเรียบร้อยแล้ว เจ้าของจะติดต่อในไม่ช้า', 'success');
  renderTenantMaintenanceList();
}

function renderTenantMaintenanceList(){
  const data=loadTenantMaintenance();
  const list=document.getElementById('tp-list');

  if(data.length===0){
    list.innerHTML='<div style="color:var(--text-muted);text-align:center;padding:2rem;">ยังไม่มีรายการแจ้ง</div>';
    return;
  }

  const typeLabel={
    'plumbing':'🚿 ท่อน้ำ/ระบายน้ำ',
    'electrical':'⚡ ไฟฟ้า',
    'appliance':'🔌 เครื่องใช้ไฟฟ้า',
    'ac':'❄️ แอร์',
    'door':'🚪 ประตู/กุญแจ',
    'wall':'🧱 ผนัง/ปูน',
    'other':'📝 อื่นๆ'
  };

  const priorityColor={
    'low':'#4caf50',
    'medium':'#ff9800',
    'high':'#f44336'
  };

  list.innerHTML=data.map(item=>`
    <div style="background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:10px;border-left:4px solid ${priorityColor[item.priority]};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;color:var(--text);">ห้อง ${item.room}</div>
          <div style="font-size:.8rem;color:var(--text-muted);">${typeLabel[item.type]||item.type}</div>
        </div>
        <span style="background:${item.status==='pending'?'#ff9800':item.status==='done'?'#4caf50':'#2196f3'};color:#fff;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700;">
          ${item.status==='pending'?'⏳ รอดำเนินการ':item.status==='done'?'✅ เสร็จแล้ว':'🔨 กำลังดำเนินการ'}
        </span>
      </div>
      <div style="font-size:.85rem;color:var(--text);line-height:1.5;margin-bottom:8px;">
        ${item.description}
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);">
        ส่งเมื่อ: ${item.submittedAt}
      </div>
    </div>
  `).join('');
}

function initTenantPortal(){
  loadTenantProfile();
  renderTenantMaintenanceList();
}

function loadTenantProfile(){
  // Get first tenant as example (in real app, would be logged-in tenant)
  const tenants = loadTenants();
  const firstTenantRoom = Object.keys(tenants)[0];
  const tenant = tenants[firstTenantRoom];

  if (!tenant) {
    document.getElementById('tenantProfileContent').innerHTML =
      '<div style="padding:1rem;text-align:center;color:var(--text-muted);">ไม่พบข้อมูลผู้เช่า</div>';
    return;
  }

  const profileHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
      <!-- Left: Personal Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">👤 ชื่อ-สกุล</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--text);">${tenant.name || '—'}</div>
        </div>
      </div>

      <!-- Right: Lease Info -->
      <div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">🏠 ห้องเลขที่</div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--green);">${firstTenantRoom}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">📅 วันเช่า</div>
          <div style="font-size:.95rem;color:var(--text);">${tenant.startDate || '—'}</div>
        </div>
        <div style="margin-bottom:1.5rem;">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.5rem;">💰 ค่าเช่ารายเดือน</div>
          <div style="font-size:1rem;font-weight:700;color:var(--text);">฿${tenant.rent ? tenant.rent.toLocaleString() : '—'}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('tenantProfileContent').innerHTML = profileHTML;
}

