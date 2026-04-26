// ===== ANNOUNCEMENTS MANAGEMENT =====
// 'all' = broadcast to both buildings (default). 'rooms' / 'nest' = building-specific.
// Tenants in either building see announcements where building === 'all' OR matches their own.
const _escCF = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
let announcementBuilding = 'all';

function setAnnouncementBuilding(bld, btn) {
  document.querySelectorAll('#page-announcements .year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  announcementBuilding = bld;
  renderAnnouncementsList();
}

function initAnnouncementsPage() {
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('ann-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = today;
  }

  // Set up real-time Firebase listeners for announcements
  setupAnnouncementListener();
  console.log('✅ Real-time announcement listeners activated');

  renderAnnouncementsList();
}

function loadAnnouncements() {
  return JSON.parse(localStorage.getItem('announcements_data') || '[]');
}

function saveAnnouncementsData(data) {
  localStorage.setItem('announcements_data', JSON.stringify(data));
  console.log('✅ Announcements saved to localStorage');
}

function saveAnnouncement() {
  const title = document.getElementById('ann-title')?.value?.trim();
  const content = document.getElementById('ann-content')?.value?.trim();
  const icon = document.getElementById('ann-icon')?.value?.trim() || '📢';
  const date = document.getElementById('ann-date')?.value || new Date().toISOString().split('T')[0];
  const time = document.getElementById('ann-time')?.value?.trim() || '';

  if (!title || !content) {
    showToast('กรุณากรอกหัวข้อและเนื้อหา', 'warning');
    return;
  }

  const announcement = {
    id: `ANN${Date.now()}`,
    building: announcementBuilding,
    title: title,
    content: content,
    icon: icon,
    date: date,
    time: time,
    createdAt: new Date().toISOString(),
    createdBy: window.SecurityUtils?.getSecureSession()?.name || window.SecurityUtils?.getSecureSession()?.email || '📌 Admin'
  };

  // Save to localStorage
  let announcements = loadAnnouncements();
  announcements.unshift(announcement);
  saveAnnouncementsData(announcements);

  // Save to Firestore (modular SDK)
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      fs.setDoc(fs.doc(fs.collection(db, 'announcements'), announcement.id), announcement);
    } catch (err) {
      console.warn('⚠️ Firestore announcement save failed:', err);
    }
  }

  console.log('📢 Announcement saved:', announcement);

  // Clear form
  document.getElementById('ann-title').value = '';
  document.getElementById('ann-content').value = '';
  document.getElementById('ann-icon').value = '📢';
  document.getElementById('ann-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ann-time').value = '';

  // Show toast
  const toast = document.createElement('div');
  toast.className = 'u-toast';
  toast.textContent = '✅ สร้างประกาศแล้ว';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);

  renderAnnouncementsList();
}

function deleteAnnouncement(id) {
  if (!confirm('ลบประกาศนี้?')) return;

  let announcements = loadAnnouncements();
  const announcement = announcements.find(a => a.id === id);
  announcements = announcements.filter(a => a.id !== id);
  saveAnnouncementsData(announcements);

  // Delete from Firestore (modular SDK)
  if (window.firebase?.firestore && announcement) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      fs.deleteDoc(fs.doc(fs.collection(db, 'announcements'), id));
    } catch (err) {
      console.warn('⚠️ Firestore announcement delete failed:', err);
    }
  }

  renderAnnouncementsList();
}

function renderAnnouncementsList() {
  const announcements = loadAnnouncements();
  // 'all' filter shows everything. Building-specific filters show that building + global ('all') announcements.
  const filtered = announcements.filter(a =>
    announcementBuilding === 'all' || a.building === 'all' || a.building === announcementBuilding
  );

  const container = document.getElementById('announcementsList');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 32px; color: var(--text-muted);">ไม่มีประกาศ</div>';
    return;
  }

  const monthNames = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const fmtDate = d => {
    if (!d) return '';
    const parts = d.split('-');
    const year = parseInt(parts[0]) + 543;
    const month = monthNames[parseInt(parts[1])];
    const day = parts[2];
    return `${day} ${month} ${year}`;
  };

  container.innerHTML = filtered
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(ann => `
      <div style="padding: 1.5rem; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-size: 1.3rem; margin-bottom: 0.5rem;">${ann.icon}</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem;">${_escCF(ann.title)}</div>
            <div style="color: var(--text-muted); margin-bottom: 0.5rem; font-size: 0.85rem;">
              📅 ${fmtDate(ann.date)} ${ann.time ? '⏰ ' + ann.time : ''}
            </div>
            <div style="color: var(--text); line-height: 1.6; white-space: pre-wrap;">${_escCF(ann.content)}</div>
          </div>
          <button onclick="deleteAnnouncement('${ann.id}')" style="padding: 6px 12px; background: #ffebee; color: var(--red); border: 1px solid var(--red); border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 0.85rem;">🗑️ ลบ</button>
        </div>
      </div>
    `)
    .join('');
}

// ===== CONTRACT MANAGEMENT =====
let contractBuilding='old';

function setContractBuilding(bld,btn){
  document.querySelectorAll('#page-contract .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  contractBuilding=bld;
  renderContractPage();
}

function initContractPage(){renderContractPage();}

function getContractStatus(t,now){
  if(!t?.name)return'vacant';
  if(!t.contractEnd)return'active';
  const exp=new Date(t.contractEnd);
  const diff=exp-now;
  if(diff<0)return'expired';
  if(diff<60*86400000)return'expiring';
  return'active';
}

function renderContractPage(){
  const rooms=getBuildingInfo(contractBuilding).metadataArray;
  const tenants=loadTenants();
  const now=new Date();
  const monthNames=window.CONFIG.months.short.slice(1);
  const fmtDate=d=>{if(!d)return'—';const p=new Date(d);return`${p.getDate()} ${monthNames[p.getMonth()]} ${p.getFullYear()+543}`;};

  // KPIs
  let nActive=0,nExpiring=0,nExpired=0,nVacant=0;
  rooms.forEach(r=>{
    const s=getContractStatus(tenants[r.id],now);
    if(s==='active')nActive++;else if(s==='expiring')nExpiring++;else if(s==='expired')nExpired++;else nVacant++;
  });
  document.getElementById('ct-kpi-active').textContent=nActive;
  document.getElementById('ct-kpi-expiring').textContent=nExpiring;
  document.getElementById('ct-kpi-expired').textContent=nExpired;
  document.getElementById('ct-kpi-vacant').textContent=nVacant;

  // Filter
  const fs=document.getElementById('ct-filter-status')?.value||'all';
  const search=(document.getElementById('ct-filter-search')?.value||'').toLowerCase();
  const filtered=rooms.filter(r=>{
    const t=tenants[r.id];
    const s=getContractStatus(t,now);
    if(fs!=='all'&&s!==fs)return false;
    if(search&&!r.id.toLowerCase().includes(search)&&!(t?.name||'').toLowerCase().includes(search))return false;
    return true;
  });

  const grid=document.getElementById('ctGrid');
  if(!grid)return;
  if(!filtered.length){grid.innerHTML='<div style="color:var(--text-muted);padding:24px;font-size:.9rem;">ไม่พบรายการ</div>';return;}

  grid.innerHTML=filtered.map(r=>{
    const t=tenants[r.id];
    const s=getContractStatus(t,now);
    const cardClass={active:'',expiring:'expiring',expired:'expired',vacant:'vacant'}[s];
    const badgeClass={active:'ct-active',expiring:'ct-expiring',expired:'ct-expired',vacant:'ct-vacant-badge'}[s];
    const badgeText={active:'✅ ใช้งานอยู่',expiring:'⚠️ ใกล้หมดอายุ',expired:'❌ หมดอายุแล้ว',vacant:'🚪 ห้องว่าง'}[s];
    const daysLeft=t?.contractEnd?Math.ceil((new Date(t.contractEnd)-now)/86400000):null;
    return`<div class="ct-card ${cardClass}">
      <div class="ct-card-room">ห้อง ${r.id}${r.label?' · '+r.label:''}</div>
      <div class="ct-card-name">${t?.name||'<span style="color:var(--text-muted);font-weight:400;">ห้องว่าง</span>'}</div>
      <span class="ct-badge ${badgeClass}">${badgeText}${daysLeft!==null&&daysLeft>=0?' (เหลือ '+daysLeft+' วัน)':''}</span>
      ${t?.phone?`<div class="ct-card-info">📞 ${t.phone}${t.lineId?' · LINE: '+t.lineId:''}</div>`:''}
      ${(t?.moveInDate||t?.moveIn)?`<div class="ct-card-info">📅 เข้าอยู่: ${fmtDate(t.moveInDate||t.moveIn)}</div>`:''}
      ${t?.contractEnd?`<div class="ct-card-info">⏰ หมดสัญญา: <strong>${fmtDate(t.contractEnd)}</strong></div>`:''}
      ${t?.deposit?`<div class="ct-card-info">💰 มัดจำ: ฿${Number(t.deposit).toLocaleString()}</div>`:''}
      ${t?.note?`<div class="ct-card-info" style="color:var(--text-muted);font-style:italic;">📝 ${_escCF(t.note)}</div>`:''}
      <div class="ct-actions">
        ${t?.name?`<button class="ct-btn ct-btn-view" onclick="showTenantModal('${r.id}')">✏️ แก้ไข</button>
        <button class="ct-btn ct-btn-print" onclick="printContract('${r.id}')">🖨️ พิมพ์สัญญา</button>
        ${s==='expiring'||s==='expired'?`<button class="ct-btn ct-btn-renew" onclick="renewContract('${r.id}')">🔄 ต่อสัญญา</button>`:''}
        `:`<button class="ct-btn ct-btn-view" onclick="showTenantModal('${r.id}')">➕ เพิ่มผู้เช่า</button>`}
      </div>
    </div>`;
  }).join('');
}

function renewContract(roomId){
  const t=loadTenants();
  const tenant=t[roomId];
  if(!tenant)return;
  // Pre-fill modal with existing data, user can update contractEnd
  showTenantModal(roomId);
  setTimeout(()=>{
    const msg=document.getElementById('payModalBody');
    if(msg){
      const note=document.createElement('div');
      note.className = 'u-note-blue';
      note.textContent='🔄 ต่อสัญญา — กรุณาอัปเดตวันหมดสัญญาใหม่';
      msg.insertBefore(note,msg.firstChild);
    }
  },100);
}

function printContract(roomId){
  const t=loadTenants()[roomId];
  if(!t?.name){showToast('ไม่พบข้อมูลผู้เช่า', 'warning');return;}
  const bldgInfo=getBuildingInfo(contractBuilding);
  const room=bldgInfo.metadataArray.find(r=>r.id===roomId)||{id:roomId};
  const building=bldgInfo.displayName;
  const monthNames=window.CONFIG.months.short.slice(1);
  const fmtDate=d=>{if(!d)return'—';const p=new Date(d);return`${p.getDate()} ${monthNames[p.getMonth()]} ${p.getFullYear()+543}`;};
  const w=window.open('','_blank','width=720,height=900,scrollbars=yes');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>สัญญาเช่า ห้อง ${roomId}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Sarabun',sans-serif;font-size:14px;padding:40px;color:#222;line-height:1.7;}
  h2{text-align:center;font-size:18px;margin-bottom:4px;}
  .sub{text-align:center;color:#666;font-size:13px;margin-bottom:30px;}
  .section{margin-bottom:18px;} .section-title{font-weight:700;font-size:14px;border-bottom:1.5px solid #222;padding-bottom:4px;margin-bottom:10px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td{padding:6px 10px;border:1px solid #ddd;} td:first-child{font-weight:600;background:#f8f8f8;width:40%;}
  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px;}
  .sig-box{border-top:1.5px solid #222;padding-top:6px;text-align:center;font-size:13px;}
  @media print{body{padding:20px;}}
  </style></head><body>
  <h2>สัญญาเช่าห้องพัก</h2>
  <div class="sub">${building}</div>
  <div class="section"><div class="section-title">ข้อมูลห้องและผู้เช่า</div>
  <table>
    <tr><td>ห้องเลขที่</td><td>${room.id}${room.label?' ('+room.label+')':''}</td></tr>
    <tr><td>ชื่อ-นามสกุลผู้เช่า</td><td>${t.name}</td></tr>
    <tr><td>เบอร์โทรศัพท์</td><td>${t.phone||'—'}</td></tr>
    <tr><td>Line ID</td><td>${t.lineId||'—'}</td></tr>
    <tr><td>วันที่เข้าอยู่</td><td>${fmtDate(t.moveInDate||t.moveIn)}</td></tr>
    <tr><td>วันหมดสัญญา</td><td>${fmtDate(t.contractEnd)}</td></tr>
    <tr><td>เงินมัดจำ</td><td>฿${Number(t.deposit||0).toLocaleString()} บาท</td></tr>
  </table></div>
  <div class="section"><div class="section-title">เงื่อนไขการเช่า</div>
  <ol style="margin:0;padding-left:20px;font-size:13px;">
    <li>ผู้เช่าตกลงชำระค่าเช่าและค่าสาธารณูปโภคภายในวันที่ 5 ของทุกเดือน</li>
    <li>ห้ามดัดแปลงหรือต่อเติมห้องโดยไม่ได้รับอนุญาต</li>
    <li>ผู้เช่าต้องรักษาความสะอาดและดูแลทรัพย์สินของผู้ให้เช่า</li>
    <li>ห้ามนำสัตว์เลี้ยงเข้าพักในห้อง (เว้นแต่ได้รับอนุญาตเป็นลายลักษณ์อักษร)</li>
    <li>หากผิดสัญญา ผู้ให้เช่ามีสิทธิ์บอกเลิกสัญญาโดยแจ้งล่วงหน้า 30 วัน</li>
    ${t.note?`<li>หมายเหตุพิเศษ: ${t.note}</li>`:''}
  </ol></div>
  ${t.note?`<div class="section"><div class="section-title">บันทึกเพิ่มเติม</div><p style="font-size:13px;">${t.note}</p></div>`:''}
  <div class="sig-row">
    <div class="sig-box">ลายมือชื่อผู้เช่า<br>${t.name}<br><small>วันที่ ........../........../..........ิ</small></div>
    <div class="sig-box">ลายมือชื่อผู้ให้เช่า<br>${building}<br><small>วันที่ ........../........../..........ิ</small></div>
  </div>
  <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  w.document.close();
}

// ===== OCCUPANCY ANALYTICS =====
let analyticsBuilding='old';
let chartOccMonthly=null, chartRevRoom=null;

function setAnalyticsBuilding(bld,btn){
  document.querySelectorAll('#page-analytics .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  analyticsBuilding=bld;
  renderAnalyticsPage();
}

function initAnalyticsPage(){
  renderAnalyticsPage();
}

function renderAnalyticsPage(){
  const rooms=analyticsBuilding==='old'?window.ROOMS_OLD:window.ROOMS_NEW;
  const tenants=loadTenants();
  const ps=loadPS();
  const now=new Date();
  const thYear=now.getFullYear()+543; // e.g. 2569

  // ---- KPIs ----
  const occupiedRooms=rooms.filter(r=>tenants[r.id]?.name);
  const vacantCount=rooms.length-occupiedRooms.length;
  document.getElementById('ana-occupancy-rate').textContent=
    rooms.length?Math.round(occupiedRooms.length/rooms.length*100)+'%':'0%';
  document.getElementById('ana-vacant-count').textContent=vacantCount;

  // Avg monthly revenue this year (sum of all paid months / count of months with data)
  let totalRevYear=0, monthsWithData=0;
  for(let m=1;m<=12;m++){
    const key=`${thYear}_${m}`;
    const monthData=ps[key]||{};
    const rev=Object.values(monthData).reduce((s,p)=>s+(p.amount||p.total||0),0);
    if(rev>0){totalRevYear+=rev;monthsWithData++;}
  }
  const avgRev=monthsWithData?Math.round(totalRevYear/monthsWithData):0;
  document.getElementById('ana-avg-revenue').textContent=avgRev?'฿'+avgRev.toLocaleString():'—';

  // Expiring contracts within 60 days
  const in60=now.getTime()+60*86400000;
  const expiringRooms=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const exp=new Date(t.contractEnd).getTime();
    return exp>now.getTime()&&exp<=in60;
  });
  document.getElementById('ana-expiring').textContent=expiringRooms.length;

  // ---- Monthly occupancy chart ----
  const monthLabels = window.CONFIG.months.short.slice(1);
  const roomIds=rooms.map(r=>r.id);
  const paidCountByMonth=Array.from({length:12},(_,i)=>{
    const key=`${thYear}_${i+1}`;
    const monthData=ps[key]||{};
    return roomIds.filter(id=>monthData[id]).length;
  });
  const revenueByMonth=Array.from({length:12},(_,i)=>{
    const key=`${thYear}_${i+1}`;
    const monthData=ps[key]||{};
    return roomIds.reduce((s,id)=>{const p=monthData[id];return s+(p?(p.amount||p.total||0):0);},0);
  });

  const ctx1=document.getElementById('chartOccupancyMonthly');
  if(ctx1){
    if(chartOccMonthly)chartOccMonthly.destroy();
    chartOccMonthly=new Chart(ctx1,{
      type:'bar',
      data:{
        labels:monthLabels,
        datasets:[
          {label:'จำนวนห้องที่ชำระ',data:paidCountByMonth,backgroundColor:'rgba(45,136,45,0.75)',borderRadius:5,yAxisID:'y'},
          {label:'รายรับรวม (บาท)',data:revenueByMonth,type:'line',borderColor:'#e65100',backgroundColor:'transparent',pointBackgroundColor:'#e65100',tension:.4,yAxisID:'y1'}
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index'},
        scales:{
          y:{position:'left',title:{display:true,text:'ห้อง'},max:rooms.length,grid:{color:'#f0f0f0'}},
          y1:{position:'right',title:{display:true,text:'บาท'},grid:{drawOnChartArea:false},ticks:{callback:v=>'฿'+v.toLocaleString()}}
        },
        plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}
      }
    });
  }

  // ---- Room status list ----
  const anaEl=document.getElementById('anaRoomStatus');
  if(anaEl){
    anaEl.innerHTML=`
      <div class="ana-room-row ana-room-head"><div>ห้อง</div><div>ผู้เช่า</div><div>สถานะ</div><div>หมดสัญญา</div></div>
      ${rooms.map(r=>{
        const t=tenants[r.id];
        const occ=!!t?.name;
        const exp=t?.contractEnd?new Date(t.contractEnd):null;
        const expFmt=exp?`${exp.getDate()} ${monthLabels[exp.getMonth()]}`:'—';
        const expWarn=exp&&(exp.getTime()-now.getTime()<60*86400000)&&exp>now?'color:var(--red);font-weight:700;':'';
        return`<div class="ana-room-row">
          <div><strong>${r.id}</strong></div>
          <div style="font-size:.81rem;">${t?.name ? _escCF(t.name) : '<span style="color:var(--text-muted)">ว่าง</span>'}</div>
          <div>${occ?'<span class="ana-occ-tag">เช่าอยู่</span>':'<span class="ana-vacant-tag">ว่าง</span>'}</div>
          <div style="${expWarn}font-size:.8rem;">${expFmt}</div>
        </div>`;
      }).join('')}`;
  }

  // ---- Revenue per room chart ----
  const revPerRoom=rooms.map(r=>{
    let total=0;
    for(let m=1;m<=12;m++){const key=`${thYear}_${m}`;const p=(ps[key]||{})[r.id];total+=p?(p.amount||p.total||0):0;}
    return total;
  });
  const ctx2=document.getElementById('chartRevenuePerRoom');
  if(ctx2){
    if(chartRevRoom)chartRevRoom.destroy();
    chartRevRoom=new Chart(ctx2,{
      type:'bar',
      data:{
        labels:rooms.map(r=>r.id),
        datasets:[{label:'รายรับรวมปีนี้ (บาท)',data:revPerRoom,
          backgroundColor:revPerRoom.map(v=>v>0?'rgba(45,136,45,0.7)':'rgba(200,200,200,0.5)'),borderRadius:4}]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{y:{ticks:{callback:v=>'฿'+v.toLocaleString()},grid:{color:'#f0f0f0'}},x:{ticks:{font:{size:10}}}}
      }
    });
  }

  // ---- Contract expiry section ----
  const contractCard=document.getElementById('anaContractCard');
  const contractList=document.getElementById('anaContractList');
  const in90=now.getTime()+90*86400000;
  const expiring90=rooms.filter(r=>{
    const t=tenants[r.id];
    if(!t?.contractEnd)return false;
    const exp=new Date(t.contractEnd).getTime();
    return exp>now.getTime()&&exp<=in90;
  }).sort((a,b)=>new Date(tenants[a.id].contractEnd)-new Date(tenants[b.id].contractEnd));
  if(contractCard&&contractList){
    if(expiring90.length){
      contractCard.classList.remove('u-hidden');
      contractList.innerHTML=expiring90.map(r=>{
        const t=tenants[r.id];
        const exp=new Date(t.contractEnd);
        const daysLeft=Math.ceil((exp-now)/86400000);
        return`<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border);font-size:.85rem;">
          <strong style="min-width:60px;">${r.id}</strong>
          <span>${t.name}</span>
          <span style="color:var(--text-muted);">${t.phone||''}</span>
          <span style="margin-left:auto;color:${daysLeft<=30?'var(--red)':'var(--orange)'};font-weight:700;">เหลือ ${daysLeft} วัน</span>
        </div>`;
      }).join('');
    } else {
      contractCard.classList.add('u-hidden');
    }
  }
}

