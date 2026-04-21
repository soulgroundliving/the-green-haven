// ===== MAINTENANCE SYSTEM =====
const _escReq = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

// Auto-cleanup old completed tickets (delete after 30 days of completion)
function autoCleanupOldCompletedTickets(tickets) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const filtered = tickets.filter(ticket => {
    // Keep tickets that are not done
    if (ticket.status !== 'done') return true;

    // Keep tickets without completedAt field
    if (!ticket.completedAt) return true;

    try {
      const completedTime = new Date(ticket.completedAt).getTime();
      const ageMs = now - completedTime;

      // Keep if less than 30 days old
      if (ageMs <= THIRTY_DAYS_MS) return true;

      // Delete old completed ticket from storage
      console.log(`🗑️ Deleting old maintenance ticket: ${ticket.id} (${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days old)`);

      // Remove from Firebase if available
      if (typeof TenantFirebaseSync !== 'undefined' && TenantFirebaseSync.deleteMaintenanceTicket) {
        const building = ticket.building || 'rooms';
        const room = ticket.room;
        if (room) {
          TenantFirebaseSync.deleteMaintenanceTicket(building, room, ticket.id).catch(err =>
            console.warn('⚠️ Could not delete from Firebase:', err)
          );
        }
      }

      return false; // Remove from filtered array
    } catch (error) {
      console.warn(`⚠️ Error processing ticket ${ticket.id}:`, error);
      return true; // Keep on error
    }
  });

  // Update localStorage with filtered tickets
  if (filtered.length !== tickets.length) {
    console.log(`✅ Cleaned up ${tickets.length - filtered.length} old maintenance tickets`);
  }

  return filtered;
}

function loadMaintenance(){
  // ✅ Load from localStorage (admin dashboard primary source)
  let localData = JSON.parse(localStorage.getItem('maintenance_data')||'[]');
  console.log(`📋 Loaded ${localData.length} maintenance requests from localStorage`);

  // Auto-cleanup old completed tickets (30+ days old)
  localData = autoCleanupOldCompletedTickets(localData);

  // Update localStorage with cleaned data
  if (localData.length > 0) {
    localStorage.setItem('maintenance_data', JSON.stringify(localData));
  }

  // Note: Firebase sync would happen via tenant app → updates localStorage
  // For real-time updates, integrate Firebase listener here in future
  return localData;
}
function saveMaintenance(d){
  localStorage.setItem('maintenance_data',JSON.stringify(d));
  console.log('✅ Maintenance saved to localStorage');
}

function initMaintenancePage(){

  const now=new Date();
  const md=document.getElementById('mx-date');
  if(md&&!md.value)md.value=now.toISOString().split('T')[0];
  const hd=document.getElementById('hk-date');
  if(hd&&!hd.value)hd.value=now.toISOString().split('T')[0];
  renderMaintenancePage();
  renderHousekeepingList();
  updateMxBadge();
  updateMaintenanceBadge();
  subscribeMaintenanceRTDB();
  if(typeof subscribeHousekeepingRTDB === 'function') subscribeHousekeepingRTDB();
}

// ===== Firebase RTDB listener for maintenance (cross-device sync) =====
let _mxRTDBUnsub = null;
function subscribeMaintenanceRTDB(){
  if(_mxRTDBUnsub) return; // already subscribed
  if(!window.firebaseOnValue || !window.firebaseRef || !window.firebaseDatabase) return;
  try {
    const rootRef = window.firebaseRef(window.firebaseDatabase, 'maintenance');
    _mxRTDBUnsub = window.firebaseOnValue(rootRef, (snap) => {
      const data = snap.val() || {};
      // Flatten maintenance/{building}/{room}/{id} → list
      const fromRTDB = [];
      Object.keys(data).forEach(bld => {
        const rooms = data[bld] || {};
        Object.keys(rooms).forEach(room => {
          const tickets = rooms[room] || {};
          Object.keys(tickets).forEach(id => {
            const t = tickets[id] || {};
            fromRTDB.push({
              id: t.id || id,
              room: t.room || room,
              building: t.building || bld,
              desc: t.desc || t.description || '',
              category: t.category || 'other',
              priority: t.priority || 'normal',
              status: t.status || 'pending',
              reportedAt: t.reportedAt || t.createdAt || '',
              updatedAt: t.updatedAt || '',
              startedAt: t.startedAt || null,
              completedAt: t.completedAt || null,
              assignedTo: t.assignedTo || null,
              beforePhoto: t.beforePhoto || null,
              afterPhoto: t.afterPhoto || null,
              workNotes: t.workNotes || null,
              photoFileName: t.photoFileName || null
            });
          });
        });
      });
      // Merge with localStorage — RTDB wins on id collision
      const local = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
      const byId = new Map();
      local.forEach(t => byId.set(t.id, t));
      fromRTDB.forEach(t => byId.set(t.id, t));
      const merged = Array.from(byId.values()).sort((a,b) => (b.reportedAt||'').localeCompare(a.reportedAt||''));
      localStorage.setItem('maintenance_data', JSON.stringify(merged));
      if(typeof renderMaintenancePage === 'function') renderMaintenancePage();
      if(typeof updateMxBadge === 'function') updateMxBadge();
      if(typeof updateMaintenanceBadge === 'function') updateMaintenanceBadge();
      if(typeof updateNotificationBell === 'function') updateNotificationBell();
    });
  } catch(e) { console.warn('subscribeMaintenanceRTDB failed:', e); }
}

function updateMxBadge(){
  const badge=document.getElementById('mxBadge');
  if(!badge)return;
  const mx=loadMaintenance();
  const hk=loadHousekeeping();
  const mxPending=mx.filter(x=>x.status==='pending'||x.status==='inprogress').length;
  const hkPending=hk.filter(x=>x.status==='pending'||x.status==='inprogress').length;
  const total=mxPending+hkPending;
  if(total>0){badge.textContent=total;badge.style.display='inline-block';}
  else{badge.style.display='none';}
}

function updateNotificationBell() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  const mx = JSON.parse(localStorage.getItem('maintenance_data') || '[]');
  const hk = JSON.parse(localStorage.getItem('housekeeping_data') || '[]');
  const comp = JSON.parse(localStorage.getItem('complaints_data') || '[]');
  const pays = JSON.parse(localStorage.getItem('tenant_payments') || '[]');

  let pendingPets = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tenant_pets_')) {
      const pets = JSON.parse(localStorage.getItem(key) || '[]');
      pendingPets = pendingPets.concat(pets.filter(p => p.status === 'pending'));
    }
  }

  const counts = {
    maintenance: mx.filter(x => x.status === 'pending' || x.status === 'inprogress').length,
    housekeeping: hk.filter(x => x.status === 'pending' || x.status === 'inprogress').length,
    complaints: comp.filter(x => x.status === 'open').length,
    pets: pendingPets.length,
    payments: pays.filter(x => x.status === 'pending').length
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  badge.textContent = total > 99 ? '99+' : total;
  badge.style.display = total > 0 ? 'inline-block' : 'none';

  // Build dropdown content
  const content = document.getElementById('notifContent');
  if (!content) return;

  if (total === 0) {
    content.innerHTML = '<div class="notif-empty">✅ ไม่มีการแจ้งเตือนใหม่</div>';
    return;
  }

  const groups = [
    { key: 'maintenance', icon: '🔧', label: 'Maintenance รอดำเนินการ', page: 'requests-approvals', tab: 'maintenance' },
    { key: 'housekeeping', icon: '🧹', label: 'Housekeeping รอดำเนินการ', page: 'requests-approvals', tab: 'housekeeping' },
    { key: 'complaints', icon: '⚠️', label: 'Complaints ที่ยังเปิดอยู่', page: 'requests-approvals', tab: 'complaints' },
    { key: 'pets', icon: '🐾', label: 'Pet Approvals รอการอนุมัติ', page: 'requests-approvals', tab: 'pets' },
    { key: 'payments', icon: '💳', label: 'Payment ยังไม่ตรวจสอบ', page: 'payment-verify', tab: null }
  ];

  content.innerHTML = groups
    .filter(g => counts[g.key] > 0)
    .map(g => {
      const nav = g.tab
        ? `window.showPage('${g.page}');setTimeout(()=>switchRequestsTab('${g.tab}',document.getElementById('tab-${g.tab}-btn')),80);toggleNotifPanel();`
        : `window.showPage('${g.page}',document.querySelector('[onclick*="${g.page}"]'));toggleNotifPanel();`;
      return `<div class="notif-group-title">${g.icon} ${g.label}</div>
<div class="notif-item" onclick="${nav}">
  <span>${g.icon} ${counts[g.key]} รายการรอดำเนินการ</span>
  <span class="notif-item-count">${counts[g.key]}</span>
</div>`;
    }).join('');
}

function toggleNotifPanel() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (!isOpen) updateNotificationBell(); // refresh on open
  dd.classList.toggle('open', !isOpen);
}

document.addEventListener('click', function(e) {
  const wrapper = document.getElementById('notifBellWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.classList.remove('open');
  }
});

function updateMaintenanceBadge(){
  const banner=document.getElementById('mx-notification-banner');
  const pendingCount=document.getElementById('mx-pending-count');
  if(!banner||!pendingCount)return;
  const mx=loadMaintenance();
  const pendingTickets=mx.filter(x=>x.status==='pending').length;
  if(pendingTickets>0){
    pendingCount.textContent=pendingTickets;
    banner.style.display='block';
  }else{
    banner.style.display='none';
  }
}

// Fixed to match tenant.html category names
const MX_CAT_LABEL={
  'electric':'⚡ ไฟฟ้า',
  'electrical':'⚡ ไฟฟ้า',
  'water':'💧 น้ำ',
  'plumbing':'🚿 ประปา/น้ำ',
  'aircon':'❄️ แอร์',
  'ac':'❄️ แอร์/พัดลม',
  'furniture':'🪑 เฟอร์นิเจอร์',
  'repair':'🔧 ซ่อมแซม',
  'other':'📝 อื่นๆ'
};
const MX_STATUS_LABEL={'pending':'⏳ รอดำเนินการ','inprogress':'🔨 กำลังดำเนินการ','done':'✅ เสร็จแล้ว'};
const MX_STATUS_CLASS={'pending':'mx-pending','inprogress':'mx-inprogress','done':'mx-done'};

function addMaintenanceRequest(){
  // Validate maintenance form
  const validation = validateMaintenanceForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    return;
  }

  const room=document.getElementById('mx-room').value.trim();
  const desc=document.getElementById('mx-desc').value.trim();
  const date=document.getElementById('mx-date').value;
  const cat=document.getElementById('mx-category').value;
  const pri=document.getElementById('mx-priority').value;
  // Sanitize inputs
  const sanitizedRoom = window.SecurityUtils.sanitizeInput(room);
  const sanitizedDesc = window.SecurityUtils.sanitizeInput(desc);
  const mx=loadMaintenance();
  const ticketId='T'+Date.now();
  const newTicket={
    id:ticketId,
    room:sanitizedRoom,
    desc:sanitizedDesc,
    category:cat,
    priority:pri,
    status:'pending',
    reportedAt:date,
    updatedAt:date,
    assignedTo:null,
    startedAt:null,
    workNotes:null,
    completedAt:null,
    beforePhoto:null,
    afterPhoto:null
  };
  mx.unshift(newTicket);
  saveMaintenance(mx);

  // Also save to tenant_maintenance_tickets for realtime sync
  const tenantTickets=JSON.parse(localStorage.getItem('tenant_maintenance_tickets')||'[]');
  tenantTickets.unshift({...newTicket});
  localStorage.setItem('tenant_maintenance_tickets',JSON.stringify(tenantTickets));
  console.log('💾 Added new ticket to tenant_maintenance_tickets:', ticketId);

  // ===== AUDIT LOGGING =====
  if (window.logMaintenanceCreated) {
    window.logMaintenanceCreated(sanitizedRoom, sanitizedDesc, MX_CAT_LABEL[cat] || cat);
  }

  document.getElementById('mx-room').value='';
  document.getElementById('mx-desc').value='';
  document.getElementById('mx-priority').value='normal';
  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();
  // Dispatch event for tenant app
  window.dispatchEvent(new CustomEvent('maintenance_ticket_submitted', {detail:{room:sanitizedRoom,category:cat}}));
  // toast
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกงานซ่อมแล้ว';document.body.appendChild(t);setTimeout(()=>t.remove(),2500);
  closeAddMaintenanceModal();
}

function showAddMaintenanceModal(){
  const modal=document.createElement('div');
  modal.id='mx-add-modal';
  modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;color:var(--text);">➕ แจ้งซ่อมใหม่</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ห้อง</label><input type="text" id="mx-room-modal" placeholder="เช่น 15ก, 22, Amazon" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">วันที่แจ้ง</label><input type="date" id="mx-date-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
    </div>
    <div style="margin-bottom:1.5rem;"><label style="font-weight:600;display:block;margin-bottom:6px;">รายละเอียดปัญหา</label><textarea id="mx-desc-modal" placeholder="เช่น ประตูปิดไม่สนิท, น้ำรั้ว, แอร์ไม่เย็น..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:80px;resize:vertical;"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">หมวดหมู่</label>
        <select id="mx-category-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="electrical">⚡ ไฟฟ้า</option>
          <option value="plumbing">🚿 ประปา/น้ำ</option>
          <option value="repair">🔧 ซ่อมแซมทั่วไป</option>
          <option value="ac">❄️ แอร์/พัดลม</option>
          <option value="other">📦 อื่นๆ</option>
        </select>
      </div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ความสำคัญ</label>
        <select id="mx-priority-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="normal">🟡 ปกติ</option>
          <option value="urgent">🔴 ด่วน</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="addMaintenanceRequestFromModal()" style="flex:1;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);color:#fff;border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;transition:all 0.3s;">📝 บันทึกงานซ่อม</button>
      <button onclick="closeAddMaintenanceModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target.id==='mx-add-modal')closeAddMaintenanceModal();});
  // Set today's date
  document.getElementById('mx-date-modal').valueAsDate=new Date();
}

function closeAddMaintenanceModal(){
  const modal=document.getElementById('mx-add-modal');
  if(modal)modal.remove();
}

function addMaintenanceRequestFromModal(){
  const room=document.getElementById('mx-room-modal').value.trim();
  const desc=document.getElementById('mx-desc-modal').value.trim();
  const date=document.getElementById('mx-date-modal').value;
  const cat=document.getElementById('mx-category-modal').value;
  const pri=document.getElementById('mx-priority-modal').value;

  if(!room||!desc||!date){
    showToast('กรุณากรอกข้อมูลให้ครบ', 'warning');
    return;
  }

  // Temporarily set form inputs for addMaintenanceRequest
  document.getElementById('mx-room').value=room;
  document.getElementById('mx-desc').value=desc;
  document.getElementById('mx-date').value=date;
  document.getElementById('mx-category').value=cat;
  document.getElementById('mx-priority').value=pri;

  addMaintenanceRequest();
}

function updateMaintenanceStatus(id,newStatus){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  // Direct status update with timestamps
  if(newStatus==='inprogress'){
    item.status='inprogress';
    item.startedAt=new Date().toISOString();
  } else if(newStatus==='done'){
    // Ensure startedAt exists before marking done
    if(!item.startedAt){
      item.startedAt=new Date().toISOString(); // Auto-set if missing
    }
    item.status='done';
    item.completedAt=new Date().toISOString();
  } else {
    item.status=newStatus;
  }

  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);

  // Sync to tenant's maintenance tickets
  const tenantTickets=JSON.parse(localStorage.getItem('tenant_maintenance_tickets')||'[]');
  console.log('🔍 Looking for ticket',id,'in tenant_maintenance_tickets:', tenantTickets.map(t=>t.id));
  let tenantTicket=tenantTickets.find(t=>t.id===id);

  if(tenantTicket){
    console.log('✅ Found ticket, updating status from',tenantTicket.status,'to',item.status);
    tenantTicket.status=item.status;
    tenantTicket.updatedAt=item.updatedAt;
    // Push admin data when marked as done
    if(item.status==='done'){
      tenantTicket.assignedTo=item.assignedTo;
      tenantTicket.beforePhoto=item.beforePhoto; // Keep tenant's original "before" photo
      tenantTicket.afterPhoto=item.afterPhoto;
      tenantTicket.workNotes=item.workNotes;
      tenantTicket.completedAt=item.completedAt;
      console.log('📤 Sending admin completion data to tenant:', {assignedTo: item.assignedTo, beforePhoto: !!item.beforePhoto, afterPhoto: !!item.afterPhoto, workNotes: item.workNotes});
    }
  } else {
    // If not found, add it with current data (for tickets that existed before tenant_maintenance_tickets)
    console.log('⚠️ Ticket not found in tenant_maintenance_tickets, adding it now');
    tenantTicket={
      id: item.id,
      room: item.room,
      category: item.category,
      title: item.title,
      description: item.description,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      assignedTo: item.assignedTo,
      afterPhoto: item.afterPhoto,
      workNotes: item.workNotes
    };
    tenantTickets.unshift(tenantTicket);
  }

  localStorage.setItem('tenant_maintenance_tickets',JSON.stringify(tenantTickets));
  console.log('🔄 Synced ticket',id,'to tenant_maintenance_tickets with status:',tenantTicket.status);

  // Sync to Firebase for tenant app to see
  if(window.firebaseRef && window.firebaseUpdate && window.firebaseDatabase) {
    try {
      const bld = item.building || 'rooms';
      const room = item.room;
      const maintenanceRef = window.firebaseRef(window.firebaseDatabase, `maintenance/${bld}/${room}/${id}`);
      const firebaseData = {
        status: item.status,
        updatedAt: item.updatedAt,
        startedAt: item.startedAt || null,
        completedAt: item.completedAt || null
      };
      if(item.status==='done'){
        firebaseData.assignedTo = item.assignedTo || null;
        firebaseData.afterPhoto = item.afterPhoto || null;
        firebaseData.workNotes = item.workNotes || null;
      }
      window.firebaseUpdate(maintenanceRef, firebaseData);
      console.log('🔥 Updated Firebase maintenance ticket:', id);
    } catch(e) {
      console.log('⚠️ Firebase update failed (fallback to localStorage only):', e.message);
    }
  }

  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();

  // Show success toast
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  if(newStatus==='inprogress') t.textContent='✅ เริ่มทำงานแล้ว';
  else if(newStatus==='done') t.textContent='✅ บันทึกเสร็จสิ้นแล้ว';
  else t.textContent='✅ อัปเดตสถานะแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);

  // Broadcast to tenants (tenant.html listening)
  window.dispatchEvent(new CustomEvent('maintenance_status_updated', {
    detail: { id, status: newStatus, ticket: item }
  }));
}

// ===== MODAL FUNCTIONS FOR MAINTENANCE =====
function showAssignModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-assign-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:450px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">👤 อัปเดตผู้รับผิดชอบ</h2>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">ชื่อช่าง/ชื่อคน</label>
      <input type="text" id="assigned-name" placeholder="เช่น สมชาย, นายช่างสมบูรณ์" value="${_escReq(item.assignedTo||'')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:'Sarabun',sans-serif;">
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="assignMaintenanceWorker('${id}')" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ ยืนยัน</button>
      <button onclick="closeAssignModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">❌ ยกเลิก</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closeAssignModal();
  };
  document.body.appendChild(modal);
}

function showNotesModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-notes-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;overflow-y:auto;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;margin:20px auto;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">📝 หมายเหตุการทำงาน</h2>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">รายละเอียดการทำงาน</label>
      <textarea id="work-notes" placeholder="อธิบายสิ่งที่ทำแล้ว เช่น ซ่อมแซมไฟฟ้า เปลี่ยนสวิตช์..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;font-family:'Sarabun',sans-serif;resize:vertical;min-height:100px;">${_escReq(item.workNotes||'')}</textarea>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="saveWorkNotes('${id}')" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ บันทึก</button>
      <button onclick="closeNotesModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">❌ ยกเลิก</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closeNotesModal();
  };
  document.body.appendChild(modal);
}

function showPhotosModal(id){
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;

  const modal=document.createElement('div');
  modal.id='mx-photos-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;overflow-y:auto;';

  const content=document.createElement('div');
  content.style.cssText='background:#fff;border-radius:12px;padding:24px;width:90%;max-width:500px;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:"Sarabun",sans-serif;margin:20px auto;';
  content.innerHTML=`
    <h2 style="margin:0 0 20px 0;font-size:1.2rem;color:var(--text);">📷 แนบรูปภาพ</h2>
    <div style="margin-bottom:16px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">📸 ถ่ายรูปก่อน (Before)</label>
      <input type="file" id="before-photo-input" accept="image/*" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
      ${(item.beforePhoto && (item.beforePhoto.startsWith('data:') || item.beforePhoto.startsWith('https://')))?'<div style="margin-top:8px;">\x3cimg src="'+item.beforePhoto+'" style="max-width:100%;height:120px;object-fit:cover;border-radius:6px;"></div>':''}
    </div>
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:.95rem;">📸 ถ่ายรูปหลัง (After)</label>
      <input type="file" id="after-photo-input" accept="image/*" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
      ${(item.afterPhoto && (item.afterPhoto.startsWith('data:') || item.afterPhoto.startsWith('https://')))?'<div style="margin-top:8px;">\x3cimg src="'+item.afterPhoto+'" style="max-width:100%;height:120px;object-fit:cover;border-radius:6px;"></div>':''}
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="closePhotosModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:6px;padding:10px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;">✅ เสร็จ</button>
    </div>
  `;

  modal.appendChild(content);
  modal.onclick=function(e){
    if(e.target===modal)closePhotosModal();
  };
  document.body.appendChild(modal);

  const beforeInput=document.getElementById('before-photo-input');
  if(beforeInput){
    beforeInput.onchange=function(e){
      const file=e.target.files[0];
      if(file)handlePhotoUpload(file,'beforePhoto',id);
    };
  }

  const afterInput=document.getElementById('after-photo-input');
  if(afterInput){
    afterInput.onchange=function(e){
      const file=e.target.files[0];
      if(file)handlePhotoUpload(file,'afterPhoto',id);
    };
  }
}


function handlePhotoUpload(file, fieldName, id){
  const reader=new FileReader();
  reader.onload=function(e){
    const base64=e.target.result;
    const mx=loadMaintenance();
    const item=mx.find(x=>x.id===id);
    if(!item)return;
    item[fieldName]=base64;
    saveMaintenance(mx);
    renderMaintenancePage();
  };
  reader.readAsDataURL(file);
}

function assignMaintenanceWorker(id){
  const assignedName=document.getElementById('assigned-name').value.trim();
  if(!assignedName){
    showToast('กรุณากรอกชื่อผู้รับผิดชอบ', 'warning');
    return;
  }
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;
  item.assignedTo=assignedName;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);
  closeAssignModal();
  renderMaintenancePage();
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกผู้รับผิดชอบแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}

function saveWorkNotes(id){
  const workNotes=document.getElementById('work-notes').value.trim();
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  if(!item)return;
  item.workNotes=workNotes;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveMaintenance(mx);
  closeNotesModal();
  renderMaintenancePage();
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกหมายเหตุแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
}

function editMaintenance(id, field){
  if(field==='assign'){
    showAssignModal(id);
  } else if(field==='notes'){
    showNotesModal(id);
  } else if(field==='photos'){
    showPhotosModal(id);
  }
}

function closeAssignModal(){
  const modal=document.getElementById('mx-assign-modal');
  if(modal)modal.remove();
}

function closeNotesModal(){
  const modal=document.getElementById('mx-notes-modal');
  if(modal)modal.remove();
}

function closePhotosModal(){
  const modal=document.getElementById('mx-photos-modal');
  if(modal)modal.remove();
}

function deleteMaintenanceRequest(id){
  if(!confirm('ลบรายการนี้?'))return;
  const mx=loadMaintenance();
  const item=mx.find(x=>x.id===id);
  saveMaintenance(mx.filter(x=>x.id!==id));
  // Remove from RTDB so tenant app no longer sees it
  if(item && window.firebaseRef && window.firebaseRemove && window.firebaseDatabase){
    try {
      const bld = item.building || 'rooms';
      const path = `maintenance/${bld}/${item.room}/${id}`;
      window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, path));
    } catch(e) { console.warn('RTDB delete failed:', e); }
  }
  renderMaintenancePage();
  updateMxBadge();
  updateMaintenanceBadge();
}

function calculateDuration(startedAt, completedAt){
  if(!startedAt||!completedAt)return null;
  const start=new Date(startedAt);
  const end=new Date(completedAt);
  let ms=end-start;

  // Fix negative duration (from timezone or wrong order)
  if(ms<0)ms=0;

  const mins=Math.floor(ms/60000);
  const hours=Math.floor(mins/60);
  const remMins=mins%60;
  if(hours===0)return`${remMins} นาที`;
  if(remMins===0)return`${hours} ชั่วโมง`;
  return`${hours} ชั่วโมง ${remMins} นาที`;
}

// Open photo modal to view before/after images
function openPhotoModal(beforePhoto, afterPhoto) {
  const modal = document.getElementById('photoModal');
  const photosContainer = document.getElementById('photoModalPhotos');

  let html = '';

  const isValidPhoto = (url) => url && (url.startsWith('data:') || url.startsWith('https://'));

  if (isValidPhoto(beforePhoto)) {
    html += `
      <div class="photo-modal-item">
        <span class="photo-modal-item-label">ก่อนซ่อม (Before)</span>
        \x3cimg src="${beforePhoto}" alt="Before repair">
      </div>
    `;
  }

  if (isValidPhoto(afterPhoto)) {
    html += `
      <div class="photo-modal-item">
        <span class="photo-modal-item-label">หลังซ่อม (After)</span>
        \x3cimg src="${afterPhoto}" alt="After repair">
      </div>
    `;
  }

  photosContainer.innerHTML = html;
  modal.classList.add('active');
}

// Close photo modal
function closePhotoModal() {
  const modal = document.getElementById('photoModal');
  modal.classList.remove('active');
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('photoModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closePhotoModal();
      }
    });
  }
});

function renderMaintenancePage(){
  const mx=loadMaintenance();
  // Update KPIs
  document.getElementById('mx-kpi-pending').textContent=mx.filter(x=>x.status==='pending').length;
  document.getElementById('mx-kpi-inprogress').textContent=mx.filter(x=>x.status==='inprogress').length;
  document.getElementById('mx-kpi-done').textContent=mx.filter(x=>x.status==='done').length;
  // Update notification banner
  updateMaintenanceBadge();
  // Filter
  const fs=document.getElementById('mx-filter-status')?.value||'all';
  const fr=(document.getElementById('mx-filter-room')?.value||'').toLowerCase();
  let filtered=mx;
  if(fs!=='all')filtered=filtered.filter(x=>x.status===fs);
  if(fr)filtered=filtered.filter(x=>x.room.toLowerCase().includes(fr));
  const el=document.getElementById('mxList');
  if(!el)return;
  if(!filtered.length){el.innerHTML='<div style="text-align:center;padding:40px 32px;color:var(--text-muted);font-size:.95rem;">ไม่มีรายการ</div>';return;}
  const fmt=d=>{if(!d)return'—';const p=d.split('-');return`${parseInt(p[2])} ${['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(p[1])]}`;};
  el.innerHTML=filtered.map(x=>`
    <div class="mx-row" style="${x.status==='done'?'opacity:.7;':''}">
      <div>
        <div style="width:60px;height:60px;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;box-shadow:0 2px 8px rgba(76, 175, 80, 0.3);">
          ${x.room.substring(0,2)}
        </div>
        <div>
          <div style="font-weight: 700; font-size: 1rem; color: var(--green); margin-bottom: 0.5rem; padding: 0.4rem 0.8rem; background: #f0f9f0; border-radius: 4px; border-left: 4px solid var(--green); display: inline-block;">🎟️ ${x.id}</div>
          <div class="mx-row-header">${x.room} ${x.priority==='urgent'?'<span class="mx-urgent">ด่วน!</span>':''}</div>
          <div style="font-size:.85rem;color:#555;line-height:1.5;margin-bottom:6px;">${_escReq(x.desc||'')}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="mx-status-pill ${MX_STATUS_CLASS[x.status]||'mx-pending'}">${MX_STATUS_LABEL[x.status]||x.status}</span>
            ${x.photoUrl||x.photo||x.beforePhoto||x.afterPhoto?'<span style="font-size:.75rem;color:var(--blue);background:#e3f2fd;padding:4px 10px;border-radius:20px;">📸 มีรูปภาพ</span>':''}
            ${x.assignedTo?'<span style="font-size:.75rem;color:#5e35b1;background:#e8e4f3;padding:4px 10px;border-radius:20px;">👤 '+_escReq(x.assignedTo)+'</span>':''}
          </div>
          ${x.photoUrl||x.photo||x.beforePhoto||x.afterPhoto?`<div style="margin-top:8px;"><button class="photo-viewer-btn" onclick="openPhotoModal('${x.beforePhoto||x.photoUrl||x.photo||''}', '${x.afterPhoto||''}')">📸 รูปภาพ</button></div>`:''}

          <div class="mx-row-meta">
            <div><strong>หมวด:</strong> ${MX_CAT_LABEL[x.category]||x.category}</div>
            <div><strong>วันที่แจ้ง:</strong> ${fmt(x.reportedAt)}</div>
            <div><strong>เวลาทำงาน:</strong> ${(() => {
              if(!x.startedAt||!x.completedAt)return'—';
              const dur = calculateDuration(x.startedAt,x.completedAt);
              return dur==='0 นาที'?'ภายใน 1-2 วัน':'⏱️ '+dur;
            })()}</div>
          </div>
          <div class="mx-row-actions">
            ${x.status==='pending'?`<button class="mx-btn mx-btn-next" onclick="updateMaintenanceStatus('${x.id}','inprogress')">🔨 รับงาน</button>`:''}
            ${x.status==='inprogress'?`<button class="mx-btn mx-btn-done" onclick="updateMaintenanceStatus('${x.id}','done')">✅ เสร็จ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','assign')">📝 ผู้รับผิดชอบ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','notes')">📋 หมายเหตุ</button><button class="mx-btn mx-btn-next" onclick="editMaintenance('${x.id}','photos')">📷 รูปภาพ</button>`:''}
            ${x.status==='done'?`<button class="mx-btn mx-btn-reopen" onclick="updateMaintenanceStatus('${x.id}','pending')">↩ เปิดใหม่</button>`:''}
            <button class="mx-btn mx-btn-del" onclick="deleteMaintenanceRequest('${x.id}')">🗑️ ลบ</button>
          </div>
        </div>
      </div>
    </div>`).join('');
}

// ===== HOUSEKEEPING REQUEST MANAGEMENT =====
function loadHousekeeping(){return JSON.parse(localStorage.getItem('housekeeping_data')||'[]');}
function saveHousekeeping(d){localStorage.setItem('housekeeping_data',JSON.stringify(d));}

function initHousekeepingPage(){
  const now=new Date();
  const hd=document.getElementById('hk-date');
  if(hd&&!hd.value)hd.value=now.toISOString().split('T')[0];
  renderHousekeepingList();
  updateMxBadge();
  subscribeHousekeepingRTDB();
  subscribeCleaningCampaign();
}

// ===== STANDARD CLEAN CAMPAIGN — one-button push to all Nest tenants =====
// Writes system/cleaningServices.activeMonth = 'YYYY-MM'. Tenant app subscribes
// via onSnapshot and auto-pops modal asking which rooms want the free service.
let _campaignUnsub = null;
function subscribeCleaningCampaign(){
  if(_campaignUnsub) return;
  if(!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    const ref = fs.doc(db, 'system', 'cleaningServices');
    _campaignUnsub = fs.onSnapshot(ref, snap => {
      const data = snap.exists() ? (snap.data() || {}) : {};
      renderCampaignStatus(data.activeMonth || '');
    }, err => console.warn('campaign subscribe failed:', err.message));
  } catch(e) { console.warn('campaign subscribe init failed:', e.message); }
}
function renderCampaignStatus(activeMonth){
  const statusEl = document.getElementById('hkCampaignStatus');
  const startBtn = document.getElementById('hkCampaignStartBtn');
  const stopBtn = document.getElementById('hkCampaignStopBtn');
  if(!statusEl) return;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if(activeMonth === currentMonth){
    statusEl.textContent = `✅ เปิดรอบอยู่ (${activeMonth}) — ทุกห้อง Nest เห็นป๊อปอัพให้จองภายใน ~1 นาที`;
    statusEl.style.color = 'var(--green-dark)';
    if(startBtn) startBtn.style.display = 'none';
    if(stopBtn) stopBtn.style.display = '';
  } else if(activeMonth){
    statusEl.textContent = `⏸ รอบที่ตั้งไว้: ${activeMonth} (ไม่ใช่เดือนปัจจุบัน ${currentMonth})`;
    statusEl.style.color = '#b45309';
    if(startBtn) { startBtn.style.display = ''; startBtn.textContent = `🚀 เริ่มรอบ ${currentMonth}`; }
    if(stopBtn) stopBtn.style.display = '';
  } else {
    statusEl.textContent = `ยังไม่ได้เปิดรอบ — กดเพื่อส่งป๊อปอัพให้ทุกห้อง Nest`;
    statusEl.style.color = 'var(--text-muted)';
    if(startBtn) { startBtn.style.display = ''; startBtn.textContent = `🚀 เริ่มรอบ ${currentMonth}`; }
    if(stopBtn) stopBtn.style.display = 'none';
  }
}
async function startCleaningCampaign(){
  if(!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    if(typeof showToast==='function') showToast('Firestore ไม่พร้อม','error');
    return;
  }
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if(!confirm(`เริ่มรอบเก็บคำขอ Standard Clean สำหรับ ${currentMonth}?\nทุกห้อง Nest จะเห็นป๊อปอัพให้จอง`)) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'cleaningServices'), { activeMonth: currentMonth, activeStartedAt: new Date().toISOString() }, { merge: true });
    if(typeof showToast==='function') showToast('✅ เริ่มรอบแล้ว — ป๊อปอัพจะไปถึงลูกบ้านภายใน ~1 นาที','success');
  } catch(e) {
    console.error('startCleaningCampaign failed:', e);
    if(typeof showToast==='function') showToast('เริ่มรอบไม่สำเร็จ: '+e.message,'error');
  }
}
async function stopCleaningCampaign(){
  if(!confirm('หยุดรอบเก็บคำขอ? ลูกบ้านจะไม่เห็นป๊อปอัพอีก')) return;
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    await fs.setDoc(fs.doc(db, 'system', 'cleaningServices'), { activeMonth: '', activeEndedAt: new Date().toISOString() }, { merge: true });
    if(typeof showToast==='function') showToast('⏹ หยุดรอบแล้ว','success');
  } catch(e) {
    console.error('stopCleaningCampaign failed:', e);
    if(typeof showToast==='function') showToast('หยุดรอบไม่สำเร็จ: '+e.message,'error');
  }
}
if (typeof window !== 'undefined') {
  window.startCleaningCampaign = startCleaningCampaign;
  window.stopCleaningCampaign = stopCleaningCampaign;
}

let _hkRTDBUnsub = null;
function subscribeHousekeepingRTDB(){
  if(_hkRTDBUnsub) return;
  if(!window.firebaseOnValue || !window.firebaseRef || !window.firebaseDatabase) {
    console.warn('⚠️ subscribeHousekeepingRTDB skipped — firebase not ready', {
      onValue: !!window.firebaseOnValue, ref: !!window.firebaseRef, db: !!window.firebaseDatabase
    });
    return;
  }
  try {
    const rootRef = window.firebaseRef(window.firebaseDatabase, 'housekeeping');
    _hkRTDBUnsub = window.firebaseOnValue(rootRef, (snap) => {
      const data = snap.val() || {};
      const fromRTDB = [];
      Object.keys(data).forEach(bld => {
        const rooms = data[bld] || {};
        Object.keys(rooms).forEach(room => {
          const items = rooms[room] || {};
          Object.keys(items).forEach(id => {
            const x = items[id] || {};
            fromRTDB.push({
              id: x.id || id,
              room: x.room || room,
              building: x.building || bld,
              service: x.service || 'standard',
              priority: x.priority || 'normal',
              description: x.description || x.desc || '',
              status: x.status || 'pending',
              submittedAt: x.submittedAt || x.date || x.createdAt || '',
              date: x.date || null,
              time: x.time || null,
              updatedAt: x.updatedAt || '',
              // Payment fields (Deep Cleaning slip flow)
              paymentSlip: x.paymentSlip || null,
              paymentVerified: !!x.paymentVerified,
              paymentTransRef: x.paymentTransRef || null,
              paymentAmount: Number(x.paymentAmount || 0),
              // Campaign linkage
              campaign: x.campaign || null,
              createdAt: x.createdAt || null
            });
          });
        });
      });
      console.log(`📥 RTDB housekeeping snapshot: ${fromRTDB.length} items`);
      const local = loadHousekeeping();
      const byId = new Map();
      local.forEach(t => byId.set(t.id, t));
      fromRTDB.forEach(t => byId.set(t.id, t));
      const merged = Array.from(byId.values()).sort((a,b) => (b.submittedAt||'').localeCompare(a.submittedAt||''));
      saveHousekeeping(merged);
      if(typeof renderHousekeepingList === 'function') renderHousekeepingList();
      if(typeof updateMxBadge === 'function') updateMxBadge();
      if(typeof updateNotificationBell === 'function') updateNotificationBell();
    }, (err) => {
      console.error('❌ subscribeHousekeepingRTDB onValue error:', err?.message || err);
    });
  } catch(e) { console.error('❌ subscribeHousekeepingRTDB threw:', e); }
}

const HK_SERVICE_LABEL={
  'standard':'🧹 Standard (ทำความสะอาดมาตรฐาน)',
  'standard-clean':'🧹 Standard (ทำความสะอาดมาตรฐาน)',
  'deep-clean':'🧼 Deep-Clean (ทำความสะอาดเชิงลึก)',
  'linen-change':'🛏️ Linen Change (เปลี่ยนผ้านวม/หมอน)',
  'urgent':'⚡ Urgent (ด่วนพิเศษ)'
};
const HK_STATUS_LABEL={
  'pending':'⏳ รอดำเนินการ',
  'inprogress':'🔨 กำลังดำเนินการ',
  'done':'✅ เสร็จแล้ว',
  'pending_payment':'💳 รอชำระเงิน'
};
const HK_STATUS_CLASS={
  'pending':'mx-pending',
  'inprogress':'mx-inprogress',
  'done':'mx-done',
  'pending_payment':'mx-pending'
};

function showAddHousekeepingModal(){
  const modal=document.createElement('div');
  modal.id='hk-add-modal';
  modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;color:var(--text);">➕ ขอบริการทำความสะอาดใหม่</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ห้อง</label><input type="text" id="hk-room-modal" placeholder="เช่น 15ก, 22, Amazon" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">วันที่ขอ</label><input type="date" id="hk-date-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;"></div>
    </div>
    <div style="margin-bottom:1.5rem;"><label style="font-weight:600;display:block;margin-bottom:6px;">หมายเหตุพิเศษ</label><textarea id="hk-desc-modal" placeholder="เช่น ฝังหนามความสะอาด, บริเวณให้ความสำคัญ..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;min-height:80px;resize:vertical;"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ประเภทบริการ</label>
        <select id="hk-service-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="standard">🧹 Standard</option>
          <option value="deep-clean">🧼 Deep-Clean</option>
          <option value="linen-change">🛏️ Linen Change</option>
          <option value="urgent">⚡ Urgent</option>
        </select>
      </div>
      <div><label style="font-weight:600;display:block;margin-bottom:6px;">ความสำคัญ</label>
        <select id="hk-priority-modal" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;">
          <option value="normal">🟡 ปกติ</option>
          <option value="urgent">🔴 ด่วน</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button onclick="addHousekeepingRequestFromModal()" style="flex:1;background:linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);color:#fff;border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;transition:all 0.3s;">📝 บันทึกการขอบริการ</button>
      <button onclick="closeAddHousekeepingModal()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:10px;padding:12px;font-family:'Sarabun',sans-serif;font-weight:700;cursor:pointer;">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',e=>{if(e.target.id==='hk-add-modal')closeAddHousekeepingModal();});
  // Set today's date
  document.getElementById('hk-date-modal').valueAsDate=new Date();
}

function closeAddHousekeepingModal(){
  const modal=document.getElementById('hk-add-modal');
  if(modal)modal.remove();
}

function addHousekeepingRequestFromModal(){
  const room=document.getElementById('hk-room-modal').value.trim();
  const desc=document.getElementById('hk-desc-modal').value.trim();
  const date=document.getElementById('hk-date-modal').value;
  const service=document.getElementById('hk-service-modal').value;
  const priority=document.getElementById('hk-priority-modal').value;

  if(!room||!date){
    showToast('กรุณากรอกข้อมูลให้ครบ', 'warning');
    return;
  }

  // Temporarily set form inputs for addHousekeepingRequest
  document.getElementById('hk-room').value=room;
  document.getElementById('hk-desc').value=desc;
  document.getElementById('hk-date').value=date;
  document.getElementById('hk-service').value=service;
  document.getElementById('hk-priority').value=priority;

  addHousekeepingRequest();
}

function addHousekeepingRequest(){
  // Validate housekeeping form
  const room=document.getElementById('hk-room')?.value?.trim()||'';
  const service=document.getElementById('hk-service')?.value||'standard';
  const priority=document.getElementById('hk-priority')?.value||'normal';
  const desc=document.getElementById('hk-desc')?.value?.trim()||'';
  const date=document.getElementById('hk-date')?.value||'';

  // Validation
  if(!room||room.length>10){showToast('กรุณาป้อนหมายเลขห้องให้ถูกต้อง (สูงสุด 10 ตัว)', 'warning');return;}
  if(!date){showToast('กรุณาเลือกวันที่', 'warning');return;}
  if(new Date(date)>new Date()){showToast('ไม่สามารถเลือกวันในอนาคต', 'warning');return;}
  if(desc.length>200){showToast('หมายเหตุต้องไม่เกิน 200 ตัวอักษร', 'warning');return;}

  // Sanitize inputs
  const sanitizedRoom=window.SecurityUtils.sanitizeInput(room);
  const sanitizedDesc=window.SecurityUtils.sanitizeInput(desc);

  const hk=loadHousekeeping();
  const newItem={
    id:'HK'+Date.now(),
    room:sanitizedRoom,
    building:'rooms',
    service:service,
    priority:priority,
    description:sanitizedDesc,
    status:'pending',
    submittedAt:date,
    updatedAt:date
  };
  hk.unshift(newItem);
  saveHousekeeping(hk);
  // Sync to RTDB
  if(window.firebaseRef && window.firebaseSet && window.firebaseDatabase){
    try {
      const path = `housekeeping/${newItem.building}/${newItem.room}/${newItem.id}`;
      window.firebaseSet(window.firebaseRef(window.firebaseDatabase, path), newItem);
    } catch(e) { console.warn('RTDB housekeeping add failed:', e); }
  }

  // Clear form
  document.getElementById('hk-room').value='';
  document.getElementById('hk-desc').value='';
  document.getElementById('hk-service').value='standard';
  document.getElementById('hk-priority').value='normal';

  renderHousekeepingList();
  updateMxBadge(); // Update combined badge

  // Toast notification
  const t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:28px;right:28px;background:var(--green);color:#fff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:.92rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18);';
  t.textContent='✅ บันทึกการขอบริการแล้ว';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2500);
  closeAddHousekeepingModal();
}

function updateHousekeepingStatus(id,newStatus){
  const hk=loadHousekeeping();
  const item=hk.find(x=>x.id===id);
  if(!item)return;
  item.status=newStatus;
  item.updatedAt=new Date().toISOString().split('T')[0];
  saveHousekeeping(hk);

  // Sync to RTDB
  if(window.firebaseRef && window.firebaseUpdate && window.firebaseDatabase){
    try {
      const bld = item.building || 'rooms';
      const path = `housekeeping/${bld}/${item.room}/${id}`;
      window.firebaseUpdate(window.firebaseRef(window.firebaseDatabase, path), {
        status: item.status, updatedAt: item.updatedAt
      });
    } catch(e) { console.warn('RTDB housekeeping update failed:', e); }
  }

  window.dispatchEvent(new CustomEvent('housekeeping_status_updated', {
    detail: { id, status: newStatus, ticket: item }
  }));

  renderHousekeepingList();
  updateMxBadge();
}

function deleteHousekeepingRequest(id){
  if(!confirm('ลบรายการนี้?'))return;
  const hk=loadHousekeeping();
  const item=hk.find(x=>x.id===id);
  saveHousekeeping(hk.filter(x=>x.id!==id));
  if(item && window.firebaseRef && window.firebaseRemove && window.firebaseDatabase){
    try {
      const bld = item.building || 'rooms';
      window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, `housekeeping/${bld}/${item.room}/${id}`));
    } catch(e) { console.warn('RTDB housekeeping delete failed:', e); }
  }
  renderHousekeepingList();
  updateMxBadge();
}

function renderHousekeepingList(){
  const hk=loadHousekeeping();
  // Update KPIs
  document.getElementById('hk-kpi-pending').textContent=hk.filter(x=>x.status==='pending').length;
  document.getElementById('hk-kpi-inprogress').textContent=hk.filter(x=>x.status==='inprogress').length;
  document.getElementById('hk-kpi-done').textContent=hk.filter(x=>x.status==='done').length;

  // Filter
  const fs=document.getElementById('hk-filter-status')?.value||'all';
  const fr=(document.getElementById('hk-filter-room')?.value||'').toLowerCase();
  let filtered=hk;
  if(fs!=='all')filtered=filtered.filter(x=>x.status===fs);
  if(fr)filtered=filtered.filter(x=>x.room.toLowerCase().includes(fr));

  const el=document.getElementById('hkList');
  if(!el)return;
  if(!filtered.length){
    el.innerHTML='<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:.9rem;">ไม่มีรายการ</div>';
    return;
  }

  const fmt=d=>{
    if(!d)return'—';
    const p=d.split('-');
    return`${parseInt(p[2])} ${['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(p[1])]}`;
  };

  el.innerHTML=filtered.map(x=>{
    const pay = x.paymentAmount ? `<div style="font-size:.78rem;margin-bottom:4px;">
      💰 ชำระแล้ว ฿${Number(x.paymentAmount).toLocaleString()}
      ${x.paymentVerified?'<span style="color:var(--green-dark);font-weight:700;">· ✅ SlipOK ยืนยัน</span>':'<span style="color:#b45309;font-weight:700;">· ⏳ รอตรวจ</span>'}
      ${x.paymentTransRef?'<span style="color:var(--text-muted);"> · '+_escReq(x.paymentTransRef)+'</span>':''}
      ${x.paymentSlip?` <button onclick="viewHousekeepingSlip('${_escReq(x.id)}')" style="margin-left:6px;padding:2px 8px;background:#eff6ff;color:#2563eb;border:1px solid #93c5fd;border-radius:10px;cursor:pointer;font-size:.72rem;font-family:inherit;">📎 ดูสลิป</button>`:''}
    </div>` : '';
    return `
    <div class="mx-row" style="${x.status==='done'?'opacity:.7;':''}">
      <div>
        <div style="width:60px;height:60px;background:linear-gradient(135deg, #2196f3 0%, #1976d2 100%);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;box-shadow:0 2px 8px rgba(33, 150, 243, 0.3);">
          ${_escReq(String(x.room||'').substring(0,2))}
        </div>
        <div>
          <div class="mx-row-header">${_escReq(x.room)} ${x.priority==='urgent'?'<span class="mx-urgent">ด่วน!</span>':''}</div>
          <div style="font-size:.85rem;color:#555;line-height:1.5;margin-bottom:6px;">${HK_SERVICE_LABEL[x.service]||_escReq(x.service)}</div>
          ${pay}
          ${x.description?'<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px;">หมายเหตุ: '+_escReq(x.description)+'</div>':''}
          ${x.time?'<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px;">⏰ ช่วงเวลา: '+_escReq(x.time)+'</div>':''}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="mx-status-pill ${HK_STATUS_CLASS[x.status]||'mx-pending'}">${HK_STATUS_LABEL[x.status]||_escReq(x.status)}</span>
          </div>
          <div class="mx-row-meta">
            <div><strong>วันที่ขอ:</strong> ${fmt(x.submittedAt)}</div>
            <div><strong>ประเภท:</strong> ${_escReq(x.service)}</div>
            <div><strong>สถานะ:</strong> ${HK_STATUS_LABEL[x.status]||_escReq(x.status)}</div>
          </div>
          <div class="mx-row-actions">
            ${x.status==='pending'?`<button class="mx-btn mx-btn-next" onclick="updateHousekeepingStatus('${_escReq(x.id)}','inprogress')">🔨 เริ่มทำความสะอาด</button>`:''}
            ${x.status==='inprogress'?`<button class="mx-btn mx-btn-done" onclick="updateHousekeepingStatus('${_escReq(x.id)}','done')">✅ เสร็จสิ้น</button>`:''}
            ${x.status==='done'?`<button class="mx-btn mx-btn-reopen" onclick="updateHousekeepingStatus('${_escReq(x.id)}','pending')">↩ เปิดใหม่</button>`:''}
            <button class="mx-btn mx-btn-del" onclick="deleteHousekeepingRequest('${_escReq(x.id)}')">🗑️ ลบ</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// View payment slip attached to a Deep Cleaning booking
function viewHousekeepingSlip(id){
  const hk = loadHousekeeping();
  const item = hk.find(x => x.id === id);
  if(!item || !item.paymentSlip) { if(typeof showToast==='function') showToast('ไม่พบสลิป','warning'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.onclick = e => { if(e.target === modal) modal.remove(); };
  const img = document.createElement('img');
  img.src = item.paymentSlip;
  img.style.cssText = 'max-width:100%;max-height:90vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  modal.appendChild(img);
  document.body.appendChild(modal);
}
if (typeof window !== 'undefined') window.viewHousekeepingSlip = viewHousekeepingSlip;

function switchMaintenanceTab(tabName, btn) {
  // Shim: redirect to unified switchRequestsTab
  const tabBtn = btn || document.getElementById('tab-' + tabName + '-btn');
  switchRequestsTab(tabName, tabBtn);
}
