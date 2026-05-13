// ===== TENANT MANAGEMENT =====
// HTML-entity escape for any tenant-supplied string injected into innerHTML
// or attribute values. Tenants who edit their own profile + complaints/
// maintenance descriptions could inject script tags; admin renders the same
// data without sanitization. Defensive even though admin XSSes themselves.
const _escTP = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Phase 4 SSoT projection: SSoT docs have lease info nested under .lease,
// but card-render code throughout the dashboard still reads flat fields
// (t.contractEnd, t.deposit, t.moveInDate). Project lease subobject onto
// the expected flat names so existing render code keeps working.
function _projectSSoTToFlat(t) {
  if (!t || typeof t !== 'object') return t;
  const lease = t.lease || {};
  // Phase 3d: tenant.lease may be a reduced mirror (leaseId, status,
  // startDate, endDate only). Look up the full lease via
  // LeaseAgreementManager cache so amount fields the mirror omits still
  // render. fullLease is empty when leaseId missing or cache cold.
  const leaseId = lease.leaseId || t.activeContractId;
  const fullLease = (leaseId && typeof LeaseAgreementManager !== 'undefined')
    ? (LeaseAgreementManager.getLease(leaseId) || {})
    : {};
  // Phase 6: overlay canonical identity from people/{tenantId} so card-render
  // code continues to display name/phone/email even after tenant docs slim
  // down. Cache is warmed by TenantLookup.prefetchAllPeople() at page load.
  // Falls through to tenant-doc fields when cache cold or person doc missing.
  const person = (t.tenantId && typeof PersonManager !== 'undefined')
    ? PersonManager.getPersonSync(t.tenantId)
    : null;
  const personName = person?.name || `${person?.firstName || ''} ${person?.lastName || ''}`.trim() || null;
  return {
    ...t,
    // Identity: prefer person doc when present, fall back to tenant doc
    name:             personName              || t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim() || null,
    firstName:        person?.firstName       || t.firstName,
    lastName:         person?.lastName        || t.lastName,
    phone:            person?.phone           || t.phone,
    email:            person?.email           || t.email,
    lineID:           person?.lineUserId      || t.lineID,
    idCardNumber:     person?.idCardNumber    || t.idCardNumber,
    address:          person?.address         || t.address,
    licensePlate:     person?.licensePlate    || t.licensePlate,
    emergencyContact: person?.emergencyContact|| t.emergencyContact,
    notes:            person?.notes           || t.notes,
    companyInfo:      person?.companyInfo     || t.companyInfo,
    avatar:           person?.avatar          || t.avatar,
    // Lease snapshot fallback chain (tenant doc → reduced mirror → full lease)
    contractEnd:    t.contractEnd    || lease.endDate    || lease.moveOutDate || fullLease.endDate    || fullLease.moveOutDate || t.moveOutDate    || null,
    moveInDate:     t.moveInDate     || lease.startDate  || lease.moveInDate  || fullLease.startDate  || fullLease.moveInDate  || null,
    moveOutDate:    t.moveOutDate    || lease.endDate    || lease.moveOutDate || fullLease.endDate    || fullLease.moveOutDate || null,
    contractStart:  t.contractStart  || lease.contractStart  || fullLease.contractStart  || lease.startDate || lease.moveInDate || fullLease.startDate || null,
    contractMonths: t.contractMonths ?? lease.contractMonths ?? fullLease.contractMonths ?? null,
    deposit:        (t.deposit !== undefined && t.deposit !== null) ? t.deposit : (lease.deposit ?? fullLease.deposit ?? null),
    rentAmount:     t.rentAmount ?? lease.rentAmount ?? fullLease.rentAmount ?? null,
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
    // CSS .filter-btn-tenant.active handles active state
  });
  // Dispatcher: rooms/nest use their existing sections + init functions
  // (which carry pet badges, shop card, etc). Any other building uses the
  // generic section + initGenericBuildingPage. The 'old'/'new' aliases are
  // legacy from when the toggle was binary; we keep them so existing buttons
  // and renderers (renderTenantPage, _getTenantRooms) keep working.
  const canonical = (window.BuildingConfig?.normalizeId?.(bld === 'old' ? 'rooms' : (bld === 'new' ? 'nest' : bld))) || bld;
  const isLegacyRooms = (canonical === 'rooms');
  const isLegacyNest  = (canonical === 'nest');
  const isGeneric = !isLegacyRooms && !isLegacyNest;
  const roomsSec   = document.getElementById('tenant-rooms-section');
  const nestSec    = document.getElementById('tenant-nest-section');
  const genericSec = document.getElementById('tenant-generic-section');
  if (roomsSec)   { roomsSec.classList.toggle('u-hidden', !isLegacyRooms); roomsSec.style.display = isLegacyRooms ? '' : 'none'; }
  if (nestSec)    { nestSec.classList.toggle('u-hidden',  !isLegacyNest);  nestSec.style.display  = isLegacyNest  ? '' : 'none'; }
  if (genericSec) { genericSec.classList.toggle('u-hidden', !isGeneric);   genericSec.style.display = isGeneric ? '' : 'none'; }
  if (isLegacyRooms)      initRoomsPage();
  else if (isLegacyNest)  initNestPage();
  else if (typeof initGenericBuildingPage === 'function') initGenericBuildingPage(canonical);
  renderTenantPage();
}

function initTenantPage(){
  // Dynamic building tabs — appends any building beyond rooms/nest from the
  // multi-property registry while preserving the existing inline 'old'/'new'
  // buttons (so their icons + behaviour stay identical).
  _renderTenantBuildingTabs();
  // Show/hide building sections based on current building tab
  const roomsSec = document.getElementById('tenant-rooms-section');
  const nestSec  = document.getElementById('tenant-nest-section');
  if(roomsSec) roomsSec.classList.toggle('u-hidden', !(tenantBuilding==='old'));
  if(nestSec)  nestSec.classList.toggle('u-hidden', !(tenantBuilding==='new'));
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
  const _bldgs = (window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest'];
  _bldgs.forEach(bld=>{
    const unsub=onSnapshot(collection(db,`tenants/${bld}/list`),snap=>{
      const all=JSON.parse(localStorage.getItem('tenant_master_data')||'{}');
      if(!all[bld])all[bld]={};
      snap.forEach(doc=>{
        const d=doc.data();
        // Bridge: if SSoT identity is empty, pull tenantName from the
        // localStorage lease record (SSoT path from getActiveLease omits it).
        if(!d.name && !d.firstName && !d.lastName &&
           typeof LeaseAgreementManager!=='undefined' &&
           typeof LeaseAgreementManager.getAllLeases==='function'){
          const all=LeaseAgreementManager.getAllLeases();
          const ls=Object.values(all).find(l=>
            l.building===bld && String(l.roomId)===String(doc.id) &&
            l.status==='active' && l.tenantName
          );
          if(ls?.tenantName) d.name=ls.tenantName;
        }
        all[bld][doc.id]=d;
      });
      localStorage.setItem('tenant_master_data',JSON.stringify(all));
      if(!document.getElementById('page-tenant')?.classList.contains('u-hidden')){
        renderTenantPage();
        renderTenantTable();
        updateTenantAlertBlock();
        updateRoomTypeCards();
      }
      if(!document.getElementById('page-property')?.classList.contains('u-hidden')){
        const nestVisible = !document.getElementById('property-nest-section')?.classList.contains('u-hidden');
        if(nestVisible && typeof initNestPage==='function') initNestPage();
        else if(typeof initRoomsPage==='function') initRoomsPage();
      }
    },err=>console.warn('tenant listener error:',err));
    _tenantListenerUnsubscribers.push(unsub);
  });
}

function _getTenantRooms(){
  if (tenantBuilding === 'old') return getActiveRoomsWithMetadata('rooms', window.ROOMS_OLD);
  if (tenantBuilding === 'new') return getActiveRoomsWithMetadata('nest', window.NEST_ROOMS);
  // Generic building — defer to _getRoomsList (RoomConfigManager + fallback).
  if (typeof window._getRoomsList === 'function') return window._getRoomsList(tenantBuilding);
  return [];
}

function _getTenantBuildingCanonical() {
  if (tenantBuilding === 'old') return 'rooms';
  if (tenantBuilding === 'new') return 'nest';
  return (window.BuildingConfig?.normalizeId?.(tenantBuilding)) || tenantBuilding;
}

function _renderTenantBuildingTabs() {
  const container = document.getElementById('tenant-building-tabs');
  if (!container || !window.BuildingRegistry) return;
  // Best-effort: trigger an async init but don't await — first render uses
  // cached/fallback list, registry changes fire `buildingRegistryChanged`
  // which we don't subscribe to here (rare event; user can switch tabs to
  // refresh). Keeps initTenantPage synchronous.
  try { window.BuildingRegistry.init?.(); } catch (_) {}
  const buildings = window.BuildingRegistry.list();
  const extras = buildings.filter(b => b.id !== 'rooms' && b.id !== 'nest');
  // Drop any previously-appended dynamic buttons so we don't double-add on
  // re-init (signature attr: data-dynamic="1").
  container.querySelectorAll('button[data-dynamic="1"]').forEach(b => b.remove());
  for (const b of extras) {
    const btn = document.createElement('button');
    btn.className = 'year-tab';
    if (tenantBuilding === b.id) btn.classList.add('active');
    btn.dataset.action = 'setTenantBuilding';
    btn.dataset.building = b.id;
    btn.dataset.dynamic = '1';
    btn.textContent = `🏘️ ${b.displayName || b.id}`;
    container.appendChild(btn);
  }
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
  // Write สัญญาใกล้หมด to the unified building KPI. Only legacy buildings have
  // pre-defined KPI ids; generic buildings carry their stats inside their own
  // section (rendered by initGenericBuildingPage) so this write is skipped.
  const soonId = tenantBuilding==='old' ? 'occupancy-soon'
               : tenantBuilding==='new' ? 'nest-occupancy-soon'
               : null;
  const soonEl = soonId ? document.getElementById(soonId) : null;
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
      <div class="compact-card-info"><span style="font-weight:600;color:var(--text);">ชื่อ</span><span class="compact-card-value">${_escTP(t.name)}</span></div>
      <div class="compact-card-info"><span>โทร</span><span style="font-size:.8rem;">${_escTP(t.phone)||'—'}</span></div>
      <div class="compact-card-info"><span>เข้าพัก</span><span style="font-size:.8rem;">${mi}</span></div>
      <div class="compact-card-info"><span>สัญญาสิ้นสุด</span><span style="font-size:.8rem;color:${expiryColor};font-weight:600;">${ce}</span></div>
      <div class="compact-card-info" style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px;">
        <span style="color:var(--text-muted);font-size:.75rem;">เหลือ</span>
        <span style="font-weight:700;color:${expiryColor};">${typeof daysLeft==='number'?daysLeft+' วัน':daysLeft}</span>
      </div>
      ${t.deposit?`<div class="compact-card-info"><span style="font-size:.75rem;color:var(--text-muted);">มัดจำ</span><span style="font-weight:700;color:var(--green-dark);">฿${Number(t.deposit).toLocaleString()}</span></div>`:''}
      `:`<div class="compact-card-info" style="text-align:center;padding:1rem 0;color:var(--text-muted);"><span>🚪 ไม่มีผู้เช่า</span></div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">
        <button onclick="openTenantModal('${_getTenantBuildingCanonical()}','${r.id}')" style="background:#e3f2fd;color:#1976d2;border:1px solid #1976d2;padding:6px;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">📄 สัญญา</button>
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
      <td style="padding:10px;">${isOcc?_escTP(t.name):'<span style="color:var(--text-muted);">—</span>'}</td>
      <td style="padding:10px;text-align:center;font-size:.85rem;">${_escTP(t.phone)||'—'}</td>
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
    cardsView.classList.remove('u-hidden');
    tableView.classList.add('u-hidden');
  }else{
    cardsView.classList.add('u-hidden');
    tableView.classList.remove('u-hidden');
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
    alertBlock.classList.add('u-hidden');
  }else{
    alertBlock.classList.remove('u-hidden');
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
    <div class="pm-row"><span class="pm-label">ชื่อ-นามสกุล</span><input class="pm-input" id="tm-name" style="width:185px" type="text" value="${_escTP(t.name)}" placeholder="สมชาย ใจดี"></div>
    <div class="pm-row"><span class="pm-label">Line ID</span><input class="pm-input" id="tm-line" style="width:145px" type="text" value="${t.lineId||''}" placeholder="@username"></div>
    <div class="pm-row"><span class="pm-label">วันที่เข้าอยู่</span><input class="pm-input" id="tm-moveIn" style="width:145px" type="date" value="${t.moveInDate||''}"></div>
    <div class="pm-row"><span class="pm-label">วันหมดสัญญา</span><input class="pm-input" id="tm-contractEnd" style="width:145px" type="date" value="${t.contractEnd||''}"></div>
    <div class="pm-row"><span class="pm-label">เงินมัดจำ (บาท)</span><input class="pm-input" id="tm-deposit" type="number" value="${t.deposit||0}"></div>
    <div class="pm-row"><span class="pm-label">หมายเหตุ</span><input class="pm-input" id="tm-note" style="width:185px" type="text" value="${_escTP(t.note)}" placeholder="เช่น มีสัตว์เลี้ยง..."></div>`;
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
  toast.className='u-toast-center';
  document.body.appendChild(toast);setTimeout(()=>toast.remove(),2200);
}

function deleteTenant(roomId){
  window.ghConfirm(`ลบผู้เช่าห้อง ${roomId}?`, { danger: true }).then(ok => {
    if (!ok) return;
    const tenants=loadTenants();
    delete tenants[roomId];
    saveTenants(tenants);
    closePayModal();
    renderTenantPage();
    updateDashboardLive();
  });
}

// ===== EXPENSE MANAGEMENT =====
// Firestore path: expenses/{building}/{ceYYYY-MM}/{autoId}
// building = 'rooms' | 'nest'  |  monthKey = CE year e.g. '2026-05'

function _expMonthKey(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function _expMonthKeyFromFilter(beYear, month) {
  return `${beYear - 543}-${String(month).padStart(2, '0')}`;
}

function initExpensePage() {
  const now = new Date();
  const fm = document.getElementById('exp-filter-month');
  const fy = document.getElementById('exp-filter-year');
  const ed = document.getElementById('exp-date');
  if (fm) fm.value = now.getMonth() + 1;
  if (fy) fy.value = now.getFullYear() + 543;
  if (ed && !ed.value) ed.value = now.toISOString().split('T')[0];
  renderExpensePage();
}

async function renderExpensePage() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const now = new Date();
  const filterMonth = parseInt(document.getElementById('exp-filter-month')?.value || now.getMonth() + 1);
  const filterYear  = parseInt(document.getElementById('exp-filter-year')?.value  || now.getFullYear() + 543);
  const filterBuilding = document.getElementById('exp-filter-building')?.value || 'rooms';
  const monthKey = _expMonthKeyFromFilter(filterYear, filterMonth);

  const expSum = document.getElementById('expSummary');
  const listEl = document.getElementById('expList');
  if (expSum) expSum.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:.85rem;">กำลังโหลด...</div>';
  if (listEl) listEl.innerHTML = '';

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;

  let expenses = [];
  try {
    const snap = await fs.getDocs(fs.collection(db, 'expenses', filterBuilding, monthKey));
    snap.forEach(d => expenses.push({ id: d.id, building: filterBuilding, monthKey, ...d.data() }));
  } catch (err) {
    if (expSum) expSum.innerHTML = '<div style="color:var(--red);padding:.8rem;font-size:.85rem;">โหลดข้อมูลไม่สำเร็จ</div>';
    return;
  }

  // Income from taxSummary (CF-aggregated revenue)
  let income = 0;
  let incomeLabel = 'รายรับ';
  try {
    const tsSnap = await fs.getDoc(fs.doc(db, 'taxSummary', String(filterYear)));
    if (tsSnap.exists()) {
      income = tsSnap.data()?.months?.[filterMonth]?.totalRevenue ?? 0;
    } else {
      incomeLabel = 'รายรับ (ยังไม่มีข้อมูล)';
    }
  } catch (_) {
    incomeLabel = 'รายรับ (โหลดไม่สำเร็จ)';
  }

  const total = expenses.reduce((a, e) => a + (e.amount || 0), 0);
  const profit = income - total;
  const byCat = {};
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (e.amount || 0); });
  const catLabels = { repair: 'ซ่อมแซม', utility: 'ค่าน้ำ/ไฟ', supply: 'ซื้อของ', wages: 'ค่าแรง', other: 'อื่นๆ' };
  const catCls    = { repair: 'cat-repair', utility: 'cat-utility', supply: 'cat-supply', wages: 'cat-wages', other: 'cat-other' };

  if (expSum) {
    expSum.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;margin-bottom:1rem;">
        <div style="text-align:center;padding:.75rem;background:var(--green-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--green-dark)">฿${income.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${incomeLabel}</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:var(--red-pale);border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:var(--red)">฿${total.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">รายจ่าย</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:${profit >= 0 ? 'var(--green-pale)' : 'var(--red-pale)'};border-radius:var(--radius-sm);">
          <div style="font-size:1.25rem;font-weight:800;color:${profit >= 0 ? 'var(--green-dark)' : 'var(--red)'}">${profit >= 0 ? '+' : ''}฿${profit.toLocaleString()}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${profit >= 0 ? 'กำไร' : 'ขาดทุน'}</div>
        </div>
      </div>
      ${Object.keys(byCat).length
        ? `<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;">แยกตามหมวด:</div>
           <div style="display:flex;flex-direction:column;gap:5px;">${Object.entries(byCat).map(([cat, amt]) =>
             `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);">
               <span class="exp-cat-pill ${catCls[cat] || 'cat-other'}">${catLabels[cat] || cat}</span>
               <strong>฿${amt.toLocaleString()}</strong></div>`).join('')}</div>`
        : '<div style="text-align:center;color:var(--text-muted);padding:.8rem;font-size:.84rem;">ยังไม่มีรายจ่ายเดือนนี้</div>'}`;
  }

  if (listEl) {
    if (!expenses.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้</div>';
    } else {
      const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
      listEl.innerHTML = `<div class="scroll-x"><table class="data-table">
        <thead><tr><th>วันที่</th><th>หมวด</th><th>รายการ</th><th>ห้อง</th><th>จำนวน</th><th></th></tr></thead>
        <tbody>${sorted.map(e => `<tr>
          <td style="font-size:.8rem;">${new Date(e.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</td>
          <td><span class="exp-cat-pill ${catCls[e.category] || 'cat-other'}">${catLabels[e.category] || e.category}</span></td>
          <td>${e.desc || ''}</td>
          <td style="font-size:.8rem;color:var(--text-muted)">${e.room || '—'}</td>
          <td style="font-weight:700;color:var(--red)">฿${(e.amount || 0).toLocaleString()}</td>
          <td><button data-action="deleteExpense" data-building="${e.building}" data-month-key="${e.monthKey}" data-exp-id="${e.id}" style="background:none;border:none;cursor:pointer;font-size:.9rem;" title="ลบ">🗑️</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--red-pale);"><td colspan="4" style="font-weight:700;">รวม</td>
          <td style="font-weight:800;color:var(--red)">฿${total.toLocaleString()}</td><td></td></tr></tfoot>
      </table></div>`;
    }
  }
}

async function addExpense() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'warning');
    return;
  }
  const date     = document.getElementById('exp-date')?.value;
  const building = document.getElementById('exp-building')?.value || 'rooms';
  const category = document.getElementById('exp-category')?.value;
  const desc     = document.getElementById('exp-desc')?.value.trim();
  const room     = document.getElementById('exp-room')?.value.trim();
  const amount   = parseFloat(document.getElementById('exp-amount')?.value) || 0;
  if (!date || !desc || !amount) { showToast('กรุณากรอกวันที่ รายการ และจำนวนเงิน', 'warning'); return; }

  const monthKey = _expMonthKey(date);
  const btn = document.querySelector('[data-action="addExpense"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }

  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    await fs.addDoc(fs.collection(db, 'expenses', building, monthKey), {
      date, category, desc, room: room || '', amount,
      createdAt: fs.serverTimestamp(),
    });
    document.getElementById('exp-desc').value   = '';
    document.getElementById('exp-amount').value = '';
    if (document.getElementById('exp-room')) document.getElementById('exp-room').value = '';
    // Sync filter to match what was just added so user sees it immediately
    const d = new Date(date);
    const fm = document.getElementById('exp-filter-month');
    const fy = document.getElementById('exp-filter-year');
    const fb = document.getElementById('exp-filter-building');
    if (fm) fm.value = d.getMonth() + 1;
    if (fy) fy.value = d.getFullYear() + 543;
    if (fb) fb.value = building;
    showToast(`✅ บันทึกรายจ่าย ฿${amount.toLocaleString()} เรียบร้อย`, 'success');
    renderExpensePage();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึกรายจ่าย'; }
  }
}

function deleteExpense(building, monthKey, expId) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  window.ghConfirm('ลบรายการรายจ่ายนี้?', { danger: true }).then(async ok => {
    if (!ok) return;
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      await fs.deleteDoc(fs.doc(db, 'expenses', building, monthKey, expId));
      renderExpensePage();
    } catch (err) {
      showToast('ลบไม่สำเร็จ: ' + (err.message || err), 'error');
    }
  });
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
        ${_escTP(item.description)}
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
          <div style="font-size:1.1rem;font-weight:700;color:var(--text);">${_escTP(tenant.name) || '—'}</div>
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

// Re-wire Firestore listeners whenever the building registry updates
// (new building added or archived via the Buildings admin page).
// _setupTenantRealtimeListener tears down existing listeners before
// re-iterating the current BuildingRegistry.list() — idempotent & safe.
window.addEventListener('buildingRegistryChanged', function() {
  if (typeof _setupTenantRealtimeListener === 'function') {
    _setupTenantRealtimeListener();
  }
});

