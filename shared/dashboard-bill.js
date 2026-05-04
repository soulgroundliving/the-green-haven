// ===== BILL PAGE =====
let currentBuilding='old';
let invoiceData=null;

// Helper: Convert legacy building names to Firebase config + metadata
function getBuildingInfo(legacyBuilding) {
  const firebaseBuilding = window.CONFIG?.getBuildingConfig?.(legacyBuilding) || (legacyBuilding === 'old' ? 'rooms' : 'nest');
  // Nest building uses NEST_ROOMS (N101-N405) so bill room IDs match tenant app reads (bills/nest/N201)
  const metadataArray = legacyBuilding === 'old' ? window.ROOMS_OLD : (window.NEST_ROOMS || window.ROOMS_NEW);
  const displayName = legacyBuilding === 'old' ? 'เดอะ กรีน เฮฟเว่น' : 'Nest · เดอะ กรีน เฮฟเว่น';
  return { firebaseBuilding, metadataArray, displayName };
}

function onBuildingChange(){
  currentBuilding=document.getElementById('f-building').value;
  populateRoomDropdown();
  document.getElementById('f-trash').value=currentBuilding==='new'?40:20;
  document.getElementById('f-elec-rate').value=8;
  const lf=document.getElementById('f-latefee'); if(lf) lf.value=0;
  renderPaymentStatus();
  if (typeof _refreshPromptPayDisplay === 'function') _refreshPromptPayDisplay();
  calcBill(); resetBillFlow();
}

function populateRoomDropdown(){
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
  const sel = document.getElementById('f-room');
  sel.innerHTML = '<option value="">-- เลือกห้อง --</option>' +
    rooms.map(r => {
      const tag = r.type === 'daily' ? '📅 ' : r.type === 'pet' ? '🐾 ' : r.type === 'commercial' ? '☕ ' : '';
      const rent = r.rentPrice || 0;  // Use rentPrice from getActiveRoomsWithMetadata
      return `<option value="${r.id}" data-rent="${rent}" data-elec="${r.elecRate || 8}" data-trash="${r.trashFee || 20}" data-daily="${r.dailyRate || 0}" data-type="${r.type}">${tag}ห้อง ${r.id} — ฿${rent.toLocaleString()}/เดือน</option>`;
    }).join('');
  document.getElementById('f-rent').value = '';
}

function onRoomChange(){
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(!opt||!opt.dataset.rent)return;
  document.getElementById('f-rent').value=opt.dataset.rent;
  document.getElementById('f-elec-rate').value=opt.dataset.elec||8;
  document.getElementById('f-trash').value=opt.dataset.trash||20;

  const isDaily=opt.dataset.type==='daily';
  const ds=document.getElementById('dailySection');
  ds.classList.toggle('show',isDaily);
  if(isDaily){document.getElementById('f-rent-type').value='monthly';onRentTypeChange();}
  const roomId2 = document.getElementById('f-room').value;
  const tn = document.getElementById('f-tenant-name');
  if(tn){
    const tenants2 = loadTenants();
    const t2 = tenants2[roomId2];
    tn.textContent = t2?.name ? `👤 ${t2.name}${t2.phone?' · '+t2.phone:''}` : '';
  }
  autoFillMeters().then(()=>{ renderPaymentStatus(); resetBillFlow(); });
  renderPaymentStatus();
}

function checkVacant(){
  if(typeof METER_DATA==='undefined'){
    document.getElementById('vc-result').innerHTML='<span style="color:var(--text-muted);">ไม่พบข้อมูลมิเตอร์ (meter_data.js)</span>';
    return;
  }
  const month=parseInt(document.getElementById('vc-month').value);
  const yearFull=parseInt(document.getElementById('vc-year')?.value||(new Date().getFullYear()+543));
  const yy=yearFull%100;
  const key=`${yy}_${month}`;
  const bld = window._pvmBuilding || 'rooms';
  const md=METER_DATA[bld] && METER_DATA[bld][key];
  if(!md){
    document.getElementById('vc-result').innerHTML=`<span style="color:var(--text-muted);">ไม่มีข้อมูลเดือนนี้ในปี ${yy+2500}</span>`;
    return;
  }
  const monthNames=window.CONFIG.months.short;
  const allRooms = bld==='nest'
    ? (window.NEST_ROOMS||[]).map(r=>r.id)
    : ['15ก','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','ร้านใหญ่'];
  const vacant=[], occupied=[], noData=[];
  allRooms.forEach(r=>{
    const d=md[r];
    if(!d){noData.push(r);return;}
    const eUsed=(d.eNew!==null&&d.eOld!==null)?d.eNew-d.eOld:null;
    const wUsed=(d.wNew!==null&&d.wOld!==null)?d.wNew-d.wOld:null;
    if(eUsed===0&&(wUsed===0||wUsed===null)){vacant.push({r,eUsed,wUsed});}
    else{occupied.push({r,eUsed,wUsed});}
  });
  const pill=(r,cls,extra='')=>`<span style="display:inline-flex;align-items:center;gap:4px;margin:3px;padding:5px 12px;border-radius:20px;font-size:.82rem;font-weight:600;${cls}">${r}${extra}</span>`;
  let html=`<div style="margin-bottom:.5rem;font-size:.85rem;color:var(--text-muted);">ข้อมูลปี ${yy+2500} ${monthNames[month]} — มิเตอร์จาก Excel</div>`;
  if(vacant.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--red);margin-right:8px;">🚪 อาจว่าง (ไฟ=0) ${vacant.length} ห้อง</span>`;
    vacant.forEach(({r})=>{ html+=pill(r,'background:#ffebee;color:var(--red);border:1px solid #ffcdd2;'); });
    html+='</div>';
  }
  if(occupied.length){
    html+=`<div style="margin-bottom:.6rem;"><span style="font-size:.8rem;font-weight:700;color:var(--green);margin-right:8px;">✅ มีผู้เช่า ${occupied.length} ห้อง</span>`;
    occupied.forEach(({r,eUsed})=>{ html+=pill(r,`background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green-light);`,eUsed!==null?` <small style="opacity:.7">${eUsed}u</small>`:''); });
    html+='</div>';
  }
  if(noData.length){
    html+=`<div><span style="font-size:.8rem;color:var(--text-muted);margin-right:8px;">❓ ไม่มีข้อมูล ${noData.length} ห้อง: ${noData.join(', ')}</span></div>`;
  }
  document.getElementById('vc-result').innerHTML=html;
}

async function autoFillMeters(){
  renderPaymentStatus();
  const roomId=document.getElementById('f-room').value;
  const month=parseInt(document.getElementById('f-month').value);
  const year=parseInt(document.getElementById('f-year').value);

  if(!roomId) return;
  const yy=year%100;
  const key=`${yy}_${month}`;
  const psKey=`${year}_${month}`;
  const meterDataBuilding = getBuildingInfo(currentBuilding).firebaseBuilding;

  // Phase 1b: single facade — MeterStore handles in-memory + Firestore.
  // Falls back to legacy payment_status only if MeterStore returns null.
  let d = await MeterStore.get(meterDataBuilding, year, month, roomId);
  if (!d) {
    const ps = JSON.parse(localStorage.getItem('payment_status')||'{}');
    if (ps[psKey] && ps[psKey][roomId]) d = ps[psKey][roomId];
  }

  let meterData=null;

  if(d){
    meterData=d;
  } else {
    // No current-month reading — pull previous month as eOld/wOld baseline
    const prevMonth=month===1?12:month-1;
    const prevYear=month===1?year-1:year;
    const prevPsKey=`${prevYear}_${prevMonth}`;
    let prevD = await MeterStore.getPrev(meterDataBuilding, year, month, roomId);
    if (!prevD) {
      const ps=JSON.parse(localStorage.getItem('payment_status')||'{}');
      if (ps[prevPsKey] && ps[prevPsKey][roomId]) prevD = ps[prevPsKey][roomId];
    }
    if(prevD){
      meterData={eNew:'',eOld:prevD.eNew,wNew:'',wOld:prevD.wNew};
    }
  }

  if(meterData){
    document.getElementById('f-elec-new').value=(meterData.eNew!=null?meterData.eNew:'');
    document.getElementById('f-elec-old').value=(meterData.eOld!=null?meterData.eOld:'');
    document.getElementById('f-water-new').value=(meterData.wNew!=null?meterData.wNew:'');
    document.getElementById('f-water-old').value=(meterData.wOld!=null?meterData.wOld:'');
  } else {
    document.getElementById('f-elec-new').value='';
    document.getElementById('f-elec-old').value='';
    document.getElementById('f-water-new').value='';
    document.getElementById('f-water-old').value='';
    // Retry once after 1.2s if METER_DATA was still empty (Firebase not ready yet)
    const isMDEmpty = !window.METER_DATA || (
      Object.keys(window.METER_DATA.rooms||{}).length === 0 &&
      Object.keys(window.METER_DATA.nest||{}).length === 0
    );
    if (isMDEmpty && !autoFillMeters._retried) {
      autoFillMeters._retried = true;
      console.log('⏳ METER_DATA empty — retrying autoFillMeters in 1.2s...');
      setTimeout(() => { autoFillMeters._retried = false; autoFillMeters(); }, 1200);
    }
  }

  calcBill();
}

function onRentTypeChange(){
  const isDaily=document.getElementById('f-rent-type').value==='daily';
  document.getElementById('dailyNightsField').classList.toggle('u-hidden', !(isDaily));
  document.getElementById('dailyRateField').classList.toggle('u-hidden', !(isDaily));
  const opt=document.getElementById('f-room').selectedOptions[0];
  if(isDaily){
    const rate=parseFloat(opt?.dataset?.daily)||400;
    document.getElementById('f-daily-rate').value=rate;
    document.getElementById('f-rent').value=0;
  } else {
    document.getElementById('f-rent').value=opt?.dataset?.rent||0;
  }
  calcBill();
}

function calcBill(){
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0;
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const lateFee=parseFloat(document.getElementById('f-latefee')?.value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate;
  const wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other+lateFee;

  document.getElementById('f-elec-units').value=eUnits;
  document.getElementById('f-water-units').value=wUnits;
  document.getElementById('c-rent').textContent='฿'+rent.toLocaleString();
  document.getElementById('c-elec-label').textContent=`ค่าไฟ (${eUnits} หน่วย × ฿${eRate})`;
  document.getElementById('c-elec').textContent='฿'+eCost.toLocaleString();
  document.getElementById('c-water-label').textContent=`ค่าน้ำ (${wUnits} หน่วย × ฿${wRate})`;
  document.getElementById('c-water').textContent='฿'+wCost.toLocaleString();
  document.getElementById('c-trash').textContent='฿'+trash.toLocaleString();
  const ot=document.getElementById('c-other-row');
  ot.classList.toggle('u-hidden', !(other>0));
  document.getElementById('c-other').textContent='฿'+other.toLocaleString();
  const lfRow=document.getElementById('c-latefee-row');
  if(lfRow) lfRow.classList.toggle('u-hidden', !(lateFee>0));
  const lfEl=document.getElementById('c-latefee');
  if(lfEl) lfEl.textContent='฿'+lateFee.toLocaleString();
  document.getElementById('c-total').textContent='฿'+total.toLocaleString();
}

// ===== FORM VALIDATION FUNCTIONS =====

/**
 * Validate bill form before generating invoice
 */
function validateBillForm() {
  const errors = [];

  // Validate room selection
  const room = document.getElementById('f-room').value;
  if (!room) {
    errors.push('❌ กรุณาเลือกห้อง');
  } else if (room.length > 20) {
    errors.push('❌ เลขห้องต้องไม่เกิน 20 ตัวอักษร');
  }

  // Validate rent amount
  const isDaily = document.getElementById('f-rent-type')?.value === 'daily' &&
                  document.getElementById('dailySection').classList.contains('show');

  if (isDaily) {
    const nights = parseFloat(document.getElementById('f-nights').value) || 0;
    const dailyRate = parseFloat(document.getElementById('f-daily-rate').value) || 0;
    if (nights <= 0) errors.push('❌ จำนวนคืนต้องมากกว่า 0');
    if (dailyRate <= 0) errors.push('❌ ราคารายวันต้องมากกว่า 0');
  } else {
    const rent = parseFloat(document.getElementById('f-rent').value) || 0;
    if (rent <= 0) errors.push('❌ ค่าเช่าต้องมากกว่า 0');
  }

  // Validate electricity readings
  const eNewVal = document.getElementById('f-elec-new').value;
  const eOldVal = document.getElementById('f-elec-old').value;
  const eNew = eNewVal && eNewVal !== '-' ? parseFloat(eNewVal) || 0 : 0;
  const eOld = eOldVal && eOldVal !== '-' ? parseFloat(eOldVal) || 0 : 0;
  const eRate = parseFloat(document.getElementById('f-elec-rate').value) || 0;
  if (eNew < 0 || eOld < 0) errors.push('❌ เลขมิเตอร์ไฟต้องเป็นจำนวนบวก');
  if (eRate < 0) errors.push('❌ ราคาไฟต้องเป็นจำนวนบวก');
  if (eNew < eOld && eNew > 0) errors.push('⚠️ เลขมิเตอร์ไฟล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate water readings
  const wNewVal = document.getElementById('f-water-new').value;
  const wOldVal = document.getElementById('f-water-old').value;
  const wNew = wNewVal && wNewVal !== '-' ? parseFloat(wNewVal) || 0 : 0;
  const wOld = wOldVal && wOldVal !== '-' ? parseFloat(wOldVal) || 0 : 0;
  const wRate = parseFloat(document.getElementById('f-water-rate').value) || 0;
  if (wNew < 0 || wOld < 0) errors.push('❌ เลขมิเตอร์น้ำต้องเป็นจำนวนบวก');
  if (wRate < 0) errors.push('❌ ราคาน้ำต้องเป็นจำนวนบวก');
  if (wNew < wOld && wNew > 0) errors.push('⚠️ เลขมิเตอร์น้ำล่าสุด < เดิม (เซเรสหรือป้อนผิด?)');

  // Validate other charges
  const trash = parseFloat(document.getElementById('f-trash').value) || 0;
  const other = parseFloat(document.getElementById('f-other').value) || 0;
  if (trash < 0) errors.push('❌ ค่าขยะต้องเป็นจำนวนบวก');
  if (other < 0) errors.push('❌ ค่าบริการต้องเป็นจำนวนบวก');

  // Validate year
  const year = parseInt(document.getElementById('f-year').value);
  if (year < 2560 || year > 2590) errors.push('❌ ปีต้องอยู่ระหว่าง 2560-2590');

  // Validate note length
  const note = document.getElementById('f-note').value;
  if (note.length > 500) errors.push('❌ หมายเหตุต้องไม่เกิน 500 ตัวอักษร');

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate maintenance request form
 */
function validateMaintenanceForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('mx-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้อง');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate date
  const date = document.getElementById('mx-date').value;
  if (!date) {
    errors.push('❌ กรุณาเลือกวันที่แจ้ง');
  } else {
    const selectedDate = new Date(date);
    const today = new Date();
    if (selectedDate > today) {
      errors.push('❌ ไม่สามารถเลือกวันที่ในอนาคตได้');
    }
  }

  // Validate description
  const desc = document.getElementById('mx-desc').value.trim();
  if (!desc) {
    errors.push('❌ กรุณากรอกรายละเอียดปัญหา');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  // Validate category and priority (they have default values so always valid)

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate tenant maintenance form
 */
function validateTenantForm() {
  const errors = [];

  // Validate room
  const room = document.getElementById('tp-room').value.trim();
  if (!room) {
    errors.push('❌ กรุณากรอกเลขห้องของคุณ');
  } else if (room.length > 10) {
    errors.push('❌ เลขห้องต้องไม่เกิน 10 ตัวอักษร');
  }

  // Validate description
  const desc = document.getElementById('tp-description').value.trim();
  if (!desc) {
    errors.push('❌ กรุณาอธิบายปัญหาของคุณ');
  } else if (desc.length < 5) {
    errors.push('❌ รายละเอียดต้องมีอย่างน้อย 5 ตัวอักษร');
  } else if (desc.length > 500) {
    errors.push('❌ รายละเอียดต้องไม่เกิน 500 ตัวอักษร');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Show validation errors in alert
 */
function showValidationErrors(errors) {
  if (errors.length === 0) return false;
  showToast('ข้อมูลไม่ครบถ้วน:\n\n' + errors.join('\n'), 'warning');
  return true;
}

function getBillData(){
  const room=document.getElementById('f-room').value;
  const isDaily=document.getElementById('f-rent-type')?.value==='daily' && document.getElementById('dailySection').classList.contains('show');
  let rent=0,rentLabel='ค่าเช่าห้อง';
  if(isDaily){
    const nights=parseFloat(document.getElementById('f-nights').value)||0;
    const rate=parseFloat(document.getElementById('f-daily-rate').value)||400;
    rent=nights*rate; rentLabel=`ค่าเช่ารายวัน (${nights} คืน × ฿${rate})`;
  } else {
    rent=parseFloat(document.getElementById('f-rent').value)||0;
  }
  const eNew=parseFloat(document.getElementById('f-elec-new').value)||0;
  const eOld=parseFloat(document.getElementById('f-elec-old').value)||0;
  const eRate=parseFloat(document.getElementById('f-elec-rate').value)||8;
  const wNew=parseFloat(document.getElementById('f-water-new').value)||0;
  const wOld=parseFloat(document.getElementById('f-water-old').value)||0;
  const wRate=parseFloat(document.getElementById('f-water-rate').value)||20;
  const trash=parseFloat(document.getElementById('f-trash').value)||0;
  const other=parseFloat(document.getElementById('f-other').value)||0;
  const lateFee=parseFloat(document.getElementById('f-latefee')?.value)||0;
  const eUnits=Math.max(0,eNew-eOld);
  const wUnits=Math.max(0,wNew-wOld);
  const eCost=eUnits*eRate, wCost=wUnits*wRate;
  const total=rent+eCost+wCost+trash+other+lateFee;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  const note=document.getElementById('f-note').value;
  const building=getBuildingInfo(currentBuilding).firebaseBuilding;
  const now=new Date();
  const no=`TGH-${year}${String(month).padStart(2,'0')}-${room.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const dateStr=now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
  return{room,building,rent,rentLabel,eNew,eOld,eUnits,eRate,eCost,wNew,wOld,wUnits,wRate,wCost,trash,other,lateFee,total,month,year,note,no,dateStr,now};
}

// ===== SLIPOK VERIFICATION =====
// ✅ SlipOK API keys are now secured in Firebase Cloud Functions
// Client no longer exposes API credentials - all calls go through secure backend
let slipVerified = false;
let slipData = null;

// === RATE LIMITING (Dashboard) ===
const DASHBOARD_RATE_LIMIT_CONFIG = {
  slipVerification: { maxRequests: 3, windowMs: 60000 }, // 3 requests per minute
  billUpload: { maxRequests: 5, windowMs: 3600000 }       // 5 uploads per hour
};
const dashboardRateLimitTracker = {};

function checkDashboardRateLimit(key) {
  const now = Date.now();
  const config = DASHBOARD_RATE_LIMIT_CONFIG[key];
  if (!config) return true;

  if (!dashboardRateLimitTracker[key]) {
    dashboardRateLimitTracker[key] = [];
  }

  // Remove old requests outside the window
  dashboardRateLimitTracker[key] = dashboardRateLimitTracker[key].filter(time => now - time < config.windowMs);

  if (dashboardRateLimitTracker[key].length >= config.maxRequests) {
    return false;
  }

  dashboardRateLimitTracker[key].push(now);
  return true;
}

function validateSlipFileAdmin(file) {
  const errors = [];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`❌ ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push('❌ รูปแบบไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }

  return errors;
}

function handleSlipDrop(e){
  e.preventDefault();
  document.getElementById('slipDropArea').classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if(file) verifySlip(file);
}

async function verifySlip(file){
  if(!file) return;

  // Validate file
  const validationErrors = validateSlipFileAdmin(file);
  if (validationErrors.length > 0) {
    const resultEl = document.getElementById('slipResult');
    resultEl.innerHTML = `<div style="color: #d32f2f; padding: 1rem; background: #ffebee; border-radius: 6px;">${validationErrors.join('<br>')}</div>`;
    return;
  }

  const resultEl = document.getElementById('slipResult');
  const dropText = document.getElementById('slipDropText');

  // Show image preview + loading state
  const reader = new FileReader();
  reader.onload = ev => {
    dropText.innerHTML = `\x3cimg src="${ev.target.result}" style="max-height:90px;border-radius:6px;object-fit:contain;margin-bottom:4px;">\x3cbr>\x3csmall style="color:var(--text-muted);">⏳ กำลังตรวจสอบกับ SlipOK...\x3c/small>`;
  };
  reader.readAsDataURL(file);
  resultEl.innerHTML = '';

  try {
    // Check rate limit
    if (!checkDashboardRateLimit('slipVerification')) {
      throw new Error('⏱️ คำขอมากเกินไป โปรดลองใหม่ในเวลาไม่กี่วินาที');
    }
    // Perf #2: compress slip image before sending to SlipOK. Slips only need
    // text legibility for OCR, so 1200px / q=0.8 is plenty and cuts the
    // base64 payload (and SlipOK bandwidth) typically by 60–80% for phone
    // photos. Files already under 800KB pass through untouched.
    let slipFile = file;
    if (typeof window._compressImageIfLarge === 'function') {
      try {
        slipFile = await window._compressImageIfLarge(file, {
          threshold: 800 * 1024,
          maxPx: 1200,
          quality: 0.8
        });
        if (slipFile !== file) {
          const saved = ((file.size - slipFile.size) / 1024).toFixed(0);
          console.log(`🗜️ Slip compressed: saved ${saved}KB`);
        }
      } catch(e) { /* fall through with original file */ slipFile = file; }
    }
    // Convert file to base64 for Cloud Function
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(slipFile);
    });
    const billTotal = invoiceData?.total || 0;
    const room = invoiceData?.room || 'unknown';
    // invoiceData.building is a display name — map to 'rooms' or 'nest' for Cloud Function
    const buildingRaw = (currentBuilding === 'nest') ? 'nest' : 'rooms';
    // Get Firebase ID token so the CF can verify this is a signed-in admin.
    // dashboard.html exposes auth as window.firebaseAuth; login.html as window.auth.
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) {
      throw new Error('กรุณาเข้าสู่ระบบใหม่ก่อนตรวจสลิป (Session หมดอายุ)');
    }
    // Call Firebase Cloud Function (API key secured server-side)
    const res = await fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/verifySlip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify({ file: base64, expectedAmount: billTotal || 1, building: buildingRaw, room })
    });
    if (!res.ok && res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Cloud Function error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = await res.json();

    if(json.success && json.data){
      const d = json.data;
      const amount  = d.amount ?? 0;
      const sender  = d.sender?.displayName || d.sender?.name || '—';
      const receiver= d.receiver?.displayName || d.receiver?.name || '—';
      const ref     = d.transRef || d.transactionId || '—';
      // SlipOK returns transTimestamp (ISO) + transDate (YYYYMMDD) + transTime (HH:MM:SS)
      const transferDate = d.transTimestamp || null;
      const tDate   = transferDate ? new Date(transferDate).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : '—';
      const amountOk  = json.amountValid !== undefined ? json.amountValid : (billTotal <= 0 || Math.abs(amount - billTotal) < 1);

      slipVerified = true;
      slipData = {amount, sender, receiver, ref, tDate, transferDate, amountOk};

      const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      resultEl.innerHTML = `
        <div class="slip-result-ok">
          <div style="font-weight:700;font-size:.88rem;color:var(--green-dark);margin-bottom:6px;">✅ สลิปผ่านการตรวจสอบ!</div>
          <div class="slip-result-row"><span>ผู้โอน</span><span><strong>${_escBill(sender)}</strong></span></div>
          <div class="slip-result-row"><span>ผู้รับ</span><span>${_escBill(receiver)}</span></div>
          <div class="slip-result-row"><span>จำนวนเงิน</span>
            <span class="${amountOk?'slip-amount-ok':'slip-amount-warn'}">฿${amount.toLocaleString()} ${amountOk?'✅':'⚠️ ยอดไม่ตรงกับบิล'}</span></div>
          <div class="slip-result-row"><span>วันเวลา</span><span>${_escBill(tDate)}</span></div>
          <div class="slip-result-row"><span>เลขอ้างอิง</span><span style="font-size:.75rem;word-break:break-all;">${_escBill(ref)}</span></div>
        </div>`;
      enableReceiptBtn();
    } else {
      const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      const msg = _escBill(json.message || json.data?.message || 'ไม่ทราบสาเหตุ');
      resultEl.innerHTML = `<div class="slip-result-err">❌ <strong>สลิปไม่ผ่าน:</strong> ${msg}<br><small>ลองถ่ายรูปใหม่ให้คมชัดขึ้น หรือตรวจว่าสลิปถูกต้อง</small></div>`;
    }
  } catch(err){
    console.error('❌ verifySlip error:', err);
    const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    resultEl.innerHTML = `<div class="slip-result-err">⚠️ เชื่อมต่อ Cloud Function ไม่ได้<br>
      <small>${_escBill(err.message || 'Network error')}</small><br>
      <button onclick="skipSlipVerify()" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:#fff;">ออกใบเสร็จโดยไม่ตรวจสลิป</button>
    </div>`;
  }
}

function skipSlipVerify(){
  slipVerified = false;
  slipData = null;
  document.getElementById('slipResult').innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0;">ข้ามการตรวจสลิป (รับเงินสด) — กดออกใบเสร็จได้เลย ✅</div>';
  enableReceiptBtn();
}

function enableReceiptBtn(){
  const btn = document.getElementById('btnReceipt');
  btn.disabled = false;
  btn.style.opacity = '';
  btn.style.cursor = '';
  btn.classList.remove('u-op40', 'u-op50', 'u-no-ptr');
  const hint = document.getElementById('billHint');

  // Auto-issue: when QR-locked amount + SlipOK both pass, the receipt is
  // safe to issue without manual click. amountOk=false (partial/wrong)
  // falls through to manual mode so admin reviews edge cases.
  if (slipVerified && slipData && slipData.amountOk) {
    hint.textContent = `✅ ตรวจสลิปผ่าน ฿${slipData.amount.toLocaleString()} (${slipData.sender}) — กำลังออกใบเสร็จอัตโนมัติ...`;
    setTimeout(() => { if (typeof generateReceipt === 'function') generateReceipt(); }, 800);
    return;
  }
  hint.textContent = slipVerified
    ? `⚠️ ตรวจสลิปผ่าน แต่ยอด ฿${slipData.amount.toLocaleString()} ไม่ตรงกับบิล — กดออกใบเสร็จเองหากยอมรับ`
    : '✅ พร้อมออกใบเสร็จ — กดปุ่มด้านบน';
}

// ===== PROMPTPAY QR (per-building, sourced from Firestore buildings/{id}) =====
// Legacy localStorage key ('promptpay') kept as cross-page cache — tenant_app.html
// reads it; dashboard mirrors the Firestore per-building value into it on each
// building change (see below).
let PROMPTPAY_NUMBER = localStorage.getItem('promptpay') || '';
window._buildingPaymentCache = window._buildingPaymentCache || { rooms: {}, nest: {} };

// Refresh PromptPay display on bill page based on currently selected building
function _refreshPromptPayDisplay(){
  try {
    const bldg = document.getElementById('f-building')?.value;
    if (!bldg) return;
    const canonical = (bldg === 'new' || bldg === 'nest') ? 'nest' : 'rooms';
    const cfg = window._buildingPaymentCache[canonical] || {};
    // Fallback chain: Firestore per-building → legacy localStorage.promptpay → empty
    const num = cfg.promptpayNumber || cfg.payment?.promptpayNumber
                || localStorage.getItem('promptpay') || '';
    const ownerInfo = (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};
    const payee = cfg.companyName || cfg.payment?.companyName
                || ownerInfo.companyLegalNameTH || '';
    PROMPTPAY_NUMBER = num;
    localStorage.setItem('promptpay', num); // mirror for legacy code paths
    const numEl = document.getElementById('pp-display-number');
    const payeeEl = document.getElementById('pp-display-payee');
    if (numEl) numEl.textContent = num ? num.replace(/(\d{3})(\d{3})(\d+)/, '$1-$2-$3') : '— (ยังไม่ตั้ง)';
    if (payeeEl) payeeEl.textContent = payee ? `· ${payee}` : '';
  } catch(e) { console.warn('_refreshPromptPayDisplay:', e); }
}

// Subscribe Firestore buildings/{RentRoom|nest} once Firebase ready
function _subscribeBuildingPaymentForBill(){
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeBuildingPaymentForBill, 1000);
    return;
  }
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const map = { rooms: 'RentRoom', nest: 'nest' };
  Object.entries(map).forEach(([canonical, fsId]) => {
    try {
      fs.onSnapshot(fs.doc(db, 'buildings', fsId), snap => {
        window._buildingPaymentCache[canonical] = snap.exists ? snap.data() : {};
        _refreshPromptPayDisplay();
      }, err => console.warn('buildings/'+fsId+' listen:', err?.message));
    } catch(e) { console.warn('buildings subscribe error:', e); }
  });
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_subscribeBuildingPaymentForBill, 500));

// ===== PaymentStore — single facade for payment lookups (Phase 2b 2026-04-19) =====
// Single Source of Truth: Firestore verifiedSlips (CF-written by SlipOK).
//   In-memory cache keyed [yearBE_month][room] — populated by the global
//   onSnapshot below. Falls back to legacy localStorage payment_status for
//   admin manual entries that never flowed through SlipOK.
//   Use PaymentStore.isPaid / .getSlip / .onChange instead of touching
//   loadPS()/payment_status directly.
window.PaymentStore = window.PaymentStore || (function(){
  const cache = {};       // {yearBE_month: {room: paymentEntry}}
  const listeners = new Set();
  function _key(year, month) {
    const beYear = Number(year) < 2400 ? Number(year) + 543 : Number(year);
    return `${beYear}_${Number(month)}`;
  }
  function _readLegacy() {
    try { return JSON.parse(localStorage.getItem('payment_status')||'{}'); }
    catch(e) { return {}; }
  }
  function isPaid(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    if (cache[k]?.[r]?.status === 'paid') return true;
    const legacy = _readLegacy();
    return legacy[k]?.[r]?.status === 'paid';
  }
  function getSlip(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    return cache[k]?.[r] || _readLegacy()[k]?.[r] || null;
  }
  function listForMonth(year, month) {
    const k = _key(year, month);
    return { ...(_readLegacy()[k] || {}), ...(cache[k] || {}) };
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function _ingest(yearBE, month, room, entry) {
    const k = `${yearBE}_${month}`;
    if (!cache[k]) cache[k] = {};
    cache[k][room] = entry;
  }
  function _notify() { listeners.forEach(fn => { try { fn(); } catch(e){} }); }
  return { isPaid, getSlip, listForMonth, onChange, _ingest, _notify };
})();

// ===== GLOBAL verifiedSlips SYNC → PaymentStore + payment_status + bill pills =====
// Runs once on load; when tenant pays via tenant_app, the slip arrives here and
// flips the bill-page pill to ✅ in real-time (ครอบคลุมทั้ง Rooms + Nest)
window._globalSlipsUnsub = null;
let _slipSnapshotInitDone = false; // true once initial replay is done; guards RTDB fallback
function _subscribeGlobalVerifiedSlips(){
  if (window._globalSlipsUnsub) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeGlobalVerifiedSlips, 1500);
    return;
  }
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const q = fs.query(fs.collection(db, 'verifiedSlips'), fs.orderBy('timestamp','desc'), fs.limit(300));
    window._globalSlipsUnsub = fs.onSnapshot(q, snap => {
      const ps = loadPS();
      let changed = false;
      snap.docChanges().forEach(ch => {
        if (ch.type === 'removed') return;
        const s = ch.doc.data();
        if (!s || s.verified === false) return;
        const room = String(s.room || '');
        if (!room) return;
        // Derive year_month (BE year) from slip timestamp
        const ts = s.timestamp?.toDate ? s.timestamp.toDate()
                 : (s.transTimestamp ? new Date(s.transTimestamp)
                 : (s.date ? new Date(s.date) : new Date()));
        const yearBE = ts.getFullYear() + 543;
        const month = ts.getMonth() + 1;
        const key = `${yearBE}_${month}`;
        const entry = {
          status: 'paid',
          amount: s.amount || 0,
          date: ts.toISOString(),
          receiptNo: s.transactionId || s.transRef || ch.doc.id,
          fromTenantApp: true,
          building: s.building || null,
          slip: {
            amount: s.amount || 0,
            sender: s.sender || '',
            bankCode: s.bankCode || '',
            ref: s.transactionId || s.transRef || '',
            transferDate: ts.toISOString()
          }
        };
        // Always feed PaymentStore in-memory cache (idempotent)
        try { window.PaymentStore._ingest(yearBE, month, room, entry); } catch(e){}
        // RTDB fallback: mark bill paid — resilience if CF markBillPaidInRTDB was slow/failed.
        // Guarded by _slipSnapshotInitDone so initial replay doesn't spam RTDB writes.
        if (_slipSnapshotInitDone && ch.type === 'added' &&
            window.BillStore && window.firebaseUpdate && window.firebaseRef && window.firebaseDatabase) {
          try {
            const bld = s.building || (/^[Nn]\d/.test(room) ? 'nest' : 'rooms');
            const roomBills = window.BillStore._cache[bld]?.[room] || {};
            const billEntry = Object.entries(roomBills).find(([, b]) =>
              Number(b.month) === month && Number(b.year) === yearBE && b.status !== 'paid'
            );
            if (billEntry) {
              const [billId] = billEntry;
              window.firebaseUpdate(
                window.firebaseRef(window.firebaseDatabase, `bills/${bld}/${room}/${billId}`),
                { status: 'paid', paidAt: ts.toISOString() }
              ).catch(e => console.warn('[billing] RTDB bill mark-paid fallback:', e));
            }
          } catch(e) { console.warn('[billing] RTDB bill mark-paid fallback:', e); }
        }
        // Mirror to legacy payment_status (skip if already paid there)
        if (ps[key]?.[room]?.status === 'paid') return;
        if (!ps[key]) ps[key] = {};
        ps[key][room] = entry;
        changed = true;
      });
      _slipSnapshotInitDone = true; // initial replay done; next 'added' events are genuine new slips
      if (changed) {
        savePS(ps);
        try { window.PaymentStore._notify(); } catch(e){}
        // Re-render bill page pills if open
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){}
        }
        console.log('💸 Synced tenant-app payment → PaymentStore + payment_status');
      } else {
        // Even when no new slips, fire ingestion of the snapshot's full state
        // so PaymentStore cache is populated at startup
        try { window.PaymentStore._notify(); } catch(e){}
      }
      // Perf #1: expose the full slip list so Payment Verify tab can render
      // from this cache instead of opening its own onSnapshot listener.
      try {
        const allSlips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window._verifiedSlipsRawCache = allSlips;
        window.dispatchEvent(new CustomEvent('verified-slips-updated', { detail: allSlips }));
      } catch(e){}
    }, err => console.warn('global verifiedSlips listen:', err?.message));
  } catch(e) { console.warn('subscribeGlobalVerifiedSlips:', e); }
}
document.addEventListener('DOMContentLoaded', () => setTimeout(_subscribeGlobalVerifiedSlips, 800));

// PaymentStore listener: auto-rerender payment grid when a new slip arrives
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof window.PaymentStore !== 'undefined') {
      window.PaymentStore.onChange(() => {
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){}
        }
      });
    }
  }, 1000);
});

function buildPromptPayPayload(phone,amount){
  const s=phone.replace(/[^0-9]/g,'');
  const t=s.startsWith('0')?'0066'+s.slice(1):s;
  const aid='0016A000000677010111'+'01'+String(t.length).padStart(2,'0')+t;
  const a=amount.toFixed(2);
  let p='000201'+'010212'+'29'+String(aid.length).padStart(2,'0')+aid+'5303764'+'54'+String(a.length).padStart(2,'0')+a+'5802TH'+'6304';
  let c=0xFFFF;
  for(let i=0;i<p.length;i++){c^=p.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=(c&0x8000)?((c<<1)^0x1021):(c<<1);}
  return p+(c&0xFFFF).toString(16).toUpperCase().padStart(4,'0');
}

function renderQR(elementId,amount){
  const el=document.getElementById(elementId);
  if(!el)return;
  if(!PROMPTPAY_NUMBER){el.classList.add('u-hidden');return;}
  try{
    const payload=buildPromptPayPayload(PROMPTPAY_NUMBER,amount);
    const wrap=document.createElement('div');
    new QRCode(wrap,{text:payload,width:160,height:160,correctLevel:QRCode.CorrectLevel.M});
    setTimeout(()=>{
      const src=wrap.querySelector('canvas')?.toDataURL()||wrap.querySelector('img')?.src||'';
      el.src=src; el.classList.toggle('u-hidden', !(src));
    },120);
  }catch(e){console.warn('QR generation failed:',e);el.classList.add('u-hidden');}
}

let isGeneratingInvoice = false; // Prevent rapid clicks
function generateInvoice(){
  // Prevent rapid button clicks
  if(isGeneratingInvoice) return;
  isGeneratingInvoice = true;
  setTimeout(() => { isGeneratingInvoice = false; }, 1500);

  // Validate bill form before processing
  const validation = validateBillForm();
  if (!validation.isValid) {
    showValidationErrors(validation.errors);
    isGeneratingInvoice = false;
    return;
  }

  const d=getBillData();
  if(!d.room||d.total===0){showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');return;}
  invoiceData=d;

  // Due date = 5th of next month
  const due=new Date(d.now); due.setDate(5); if(due<=d.now)due.setMonth(due.getMonth()+1);
  const dueStr=due.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide receipt panel to show only invoice
  document.getElementById('receiptPanel').classList.add('u-hidden');
  document.getElementById('invoicePanel').classList.remove('u-hidden');

  document.getElementById('invoicePanel').innerHTML=buildDocHTML(d,'invoice',dueStr);
  renderQR('qr-payment', d.total); // generate PromptPay QR with bill amount

  // ===== AUDIT LOGGING =====
  if (window.logBillGenerated) {
    window.logBillGenerated(d.room, d.total, { invoiceNumber: d.no, building: d.building, month: d.month, year: d.year });
  }

  // Show slip verification section (instead of auto-enabling receipt)
  slipVerified=false; slipData=null;
  document.getElementById('slipResult').innerHTML='';
  document.getElementById('slipDropText').innerHTML='🖼️ แตะเพื่ออัปโหลดสลิป หรือลากมาวางที่นี่<br><small>SlipOK ตรวจสอบชื่อ ยอด วันเวลา สลิปซ้ำ ภายใน 3 วินาที</small>';
  document.getElementById('slipFileInput').value='';
  document.getElementById('slipVerifySection').classList.add('show');
  document.getElementById('billHint').textContent='📲 อัปโหลดสลิปเพื่อตรวจสอบ → จากนั้นออกใบเสร็จได้เลย';
  document.getElementById('step1').className='step done';
  document.getElementById('step2').className='step active';
  document.getElementById('invoicePanel').scrollIntoView({behavior:'smooth'});
}

let isGeneratingReceipt = false; // Prevent rapid clicks
function generateReceipt(){
  if(isGeneratingReceipt) return;
  isGeneratingReceipt = true;
  setTimeout(() => { isGeneratingReceipt = false; }, 1500);

  if(!invoiceData){showToast('กรุณาส่งใบวางบิลก่อน', 'warning');isGeneratingReceipt = false;return;}
  const d=invoiceData;
  const payDate=new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});

  // Hide invoice panel to show only receipt
  document.getElementById('invoicePanel').classList.add('u-hidden');
  document.getElementById('receiptPanel').classList.remove('u-hidden');

  // ===== AUDIT LOGGING =====
  if (window.AuditLogger) {
    window.AuditLogger.log(
      window.AuditActionTypes.RECEIPT_GENERATED,
      `Generated receipt for room ${d.room}: ฿${d.total.toLocaleString()}`,
      { room: d.room, amount: d.total, receiptNumber: d.no, slipVerified: slipVerified }
    );
  }
  // Attach slip verification result if available
  const slipNote = slipVerified && slipData
    ? `<div style="margin-top:10px;padding:8px;background:#e8f5e9;border-radius:6px;font-size:.78rem;color:var(--green-dark);">✅ ยืนยันด้วย SlipOK · ผู้โอน: ${slipData.sender} · ฿${slipData.amount.toLocaleString()} · ${slipData.tDate}</div>`
    : '';
  document.getElementById('receiptPanel').innerHTML=buildDocHTML(d,'receipt',null,payDate)+slipNote;
  document.getElementById('step2').className='step done';
  document.getElementById('slipVerifySection').classList.remove('show');
  markRoomPaid(d); // บันทึกสถานะห้องนี้ว่าชำระแล้ว
  document.getElementById('receiptPanel').scrollIntoView({behavior:'smooth'});
}

function buildDocHTML(d,type,dueDate,payDate){
  const isInvoice=type==='invoice';
  const color=isInvoice?'var(--blue)':'var(--green-dark)';
  const titleText=isInvoice?'ใบวางบิล / Invoice':'ใบเสร็จรับเงิน / Receipt';
  const stamp=isInvoice?`<div class="doc-stamp stamp-pending">⏳ รอชำระ</div>`:`<div class="doc-stamp stamp-paid">✅ ชำระแล้ว</div>`;
  const due=isInvoice?`<div class="due-box">⏰ กรุณาชำระภายใน ${dueDate}</div>`:'';

  // QR PromptPay section — แสดงในใบวางบิลเท่านั้น (ก่อนชำระ)
  const qrSection = PROMPTPAY_NUMBER ? `
    <div class="qr-section">
      <div class="qr-title">📲 สแกน QR เพื่อชำระเงิน</div>
      <img id="qr-payment" src="" alt="QR PromptPay" style="width:160px;height:160px;border-radius:8px;border:4px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.15);">
      <div><div class="qr-amount-badge">฿${d.total.toLocaleString()}</div></div>
      <div class="qr-footer-text">พร้อมเพย์: ${PROMPTPAY_NUMBER}<br>สแกนแล้วยอดขึ้นอัตโนมัติ ไม่ต้องพิมพ์ตัวเลข</div>
    </div>` : '';

  const docId = isInvoice ? 'doc-invoice' : 'doc-receipt';
  const _ownerForDoc = (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};

  // Resolve tenant's receipt format choice (default: personal). When tenant chose
  // 'company' AND filled in company info, the bill switches to:
  //   • company logo (B2B authoritative branding)
  //   • recipient block with their company name + Tax ID + address (for เบิกบริษัท)
  // Personal default keeps the apartment/Nature Haven brand vibe for tenant-facing bills.
  let _tenantForBill = null;
  try {
    if (typeof TenantConfigManager !== 'undefined' && d.building && d.room) {
      _tenantForBill = TenantConfigManager.getTenant(d.building, d.room) || null;
    }
  } catch(_) {}
  const _recipientType = _tenantForBill?.receiptType || 'personal';
  const _recipientCo = _tenantForBill?.companyInfo || _tenantForBill?.company || {};
  const _useCompanyLogo = _recipientType === 'company' && (_recipientCo.name || _recipientCo.taxId);

  const _baseCompanyName = _ownerForDoc.companyLegalNameTH || 'Nature Haven';
  const _companyLogoName = _ownerForDoc.registrationStatus === 'pending'
    ? `${_baseCompanyName} (อยู่ระหว่างจดทะเบียน)`
    : _baseCompanyName;
  const _apartmentLogoName = 'Nature Haven';

  const logoSrc = _useCompanyLogo ? _ownerForDoc.logoDataUrl : _ownerForDoc.apartmentLogoDataUrl;
  const logoName = _useCompanyLogo ? _companyLogoName : _apartmentLogoName;
  const logoHTML = logoSrc
    ? `<img src="${logoSrc}" alt="logo" style="max-height:56px;max-width:180px;object-fit:contain;vertical-align:middle;"><div style="font-size:.85rem;color:var(--text-muted);margin-top:4px;">${logoName}</div>`
    : `🌿 ${logoName}`;

  // Recipient block — only shown when tenant opted for company format with filled info
  const recipientBlockHTML = _useCompanyLogo
    ? `<div style="margin:10px 0;padding:10px;background:#f8faf9;border:1px dashed #c8e6c9;border-radius:6px;font-size:.85rem;">
         <div style="font-weight:600;color:var(--green-dark);margin-bottom:6px;">📄 ออกในนาม (นิติบุคคล)</div>
         <div class="d-row"><span>ชื่อบริษัท:</span><strong>${_recipientCo.name || '-'}</strong></div>
         <div class="d-row"><span>เลขผู้เสียภาษี:</span><strong>${_recipientCo.taxId || '-'}</strong></div>
         ${_recipientCo.address ? `<div class="d-row"><span>ที่อยู่:</span><span style="text-align:right;">${_recipientCo.address}</span></div>` : ''}
       </div>`
    : '';
  return`
  <div id="${docId}" class="doc-body">
    <div class="doc-header">
      <div class="doc-logo">${logoHTML}</div>
      <div class="doc-sub">${d.building}</div>
      <div class="doc-title ${type}">${titleText}</div>
      <div class="doc-no">เลขที่: ${d.no}</div>
    </div>
    <div class="doc-content">
      ${recipientBlockHTML}
      <div class="d-row"><span>ห้องเลขที่:</span><strong>ห้อง ${d.room}</strong></div>
      <div class="d-row"><span>ประจำเดือน:</span><strong>${MONTHS_FULL[d.month]} ${d.year}</strong></div>
      <div class="d-row"><span>${isInvoice?'วันที่ออกบิล':'วันที่ชำระ'}:</span><span>${isInvoice?d.dateStr:payDate}</span></div>
      <hr class="d-divider">
      <div class="d-row"><span>${d.rentLabel}</span><span>฿${d.rent.toLocaleString()}</span></div>
      ${d.eOld!=null||d.eNew!=null?`<div class="d-row"><span>ค่าไฟฟ้า</span><span>฿${(d.eCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์ไฟ: ${d.eOld||0} → ${d.eNew||0} (${d.eUnits||0} หน่วย × ฿${d.eRate||0})</span></div>`:''}
      ${d.wOld!=null||d.wNew!=null?`<div class="d-row"><span>ค่าน้ำประปา</span><span>฿${(d.wCost||0).toLocaleString()}</span></div>
      <div class="d-row" style="font-size:.8rem;color:var(--text-muted);padding-left:10px;"><span>มิเตอร์น้ำ: ${d.wOld||0} → ${d.wNew||0} (${d.wUnits||0} หน่วย × ฿${d.wRate||0})</span></div>`:''}
      ${d.trash>0?`<div class="d-row"><span>ค่าขยะ</span><span>฿${d.trash.toLocaleString()}</span></div>`:''}
      ${d.other>0?`<div class="d-row"><span>ค่าบริการอื่นๆ</span><span>฿${d.other.toLocaleString()}</span></div>`:''}
      ${d.lateFee>0?`<div class="d-row" style="color:#c62828;"><span>⚠️ ค่าปรับ</span><span>฿${d.lateFee.toLocaleString()}</span></div>`:''}
      ${d.note?`<div class="d-row" style="font-size:.78rem;color:var(--accent);"><span>หมายเหตุ:</span><span>${d.note}</span></div>`:''}
      <div class="d-total ${type}"><span>รวมทั้งสิ้น</span><span>฿${d.total.toLocaleString()}</span></div>
    </div>
    ${isInvoice ? qrSection : ''}
    <div class="doc-footer">
      ${due}${stamp}
      <div>ขอบคุณที่ใช้บริการ ${logoName}</div>
      ${!isInvoice?'<div>กรุณาเก็บใบเสร็จไว้เป็นหลักฐาน</div>':''}
    </div>
  </div>
  <div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
    <button class="btn-doc-action ${isInvoice?'blue':'green'}" onclick="printDoc('${docId}')">🖨️ พิมพ์ / บันทึก PDF</button>
  </div>`;
}

function resetBillFlow(){
  invoiceData=null; slipVerified=false; slipData=null;
  document.getElementById('invoicePanel').innerHTML=`<div class="doc-placeholder"><div class="icon">📄</div><div style="font-size:.9rem;font-weight:600;">กรอกข้อมูลและกด "ส่งใบวางบิล"</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 1 — แจ้งยอดก่อนชำระ</div></div>`;
  document.getElementById('receiptPanel').innerHTML=`<div class="doc-placeholder"><div class="icon">✅</div><div style="font-size:.9rem;font-weight:600;">กด "ออกใบเสร็จรับเงิน" หลังรับเงินแล้ว</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 2 — ยืนยันการชำระเงิน</div></div>`;
  document.getElementById('btnReceipt').disabled=true;
  document.getElementById('btnReceipt').classList.add('u-op40');
  document.getElementById('btnReceipt').classList.add('u-no-ptr');
  document.getElementById('billHint').textContent='ส่งใบวางบิลก่อน → อัปโหลดสลิป → ออกใบเสร็จรับเงิน';
  document.getElementById('step1').className='step active';
  document.getElementById('step2').className='step pending';
  document.getElementById('slipVerifySection').classList.remove('show');
  document.getElementById('slipResult').innerHTML='';
}

// ===== PRINT DOC — popup หน้าเดียว ไม่มี header/footer ของ browser =====
let printWindow = null; // Track print window to prevent accumulation

let isPrinting = false; // Prevent rapid print requests
function printDoc(docId){
  // Prevent rapid print requests
  if(isPrinting) return;
  isPrinting = true;
  setTimeout(() => { isPrinting = false; }, 2000);

  // Close previous print window if still open
  if(printWindow && !printWindow.closed){
    try{printWindow.close();}catch(e){}
  }

  const el=document.getElementById(docId);
  if(!el){showToast('ไม่พบเอกสาร', 'error');return;}
  // รวม styles ทั้งหมดจากหน้าหลัก
  const styles=[...document.querySelectorAll('style')].map(s=>s.innerHTML).join('\n');
  const fonts='<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
  const content=el.outerHTML;
  const html=`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">${fonts}
<style>
${styles}
/* Print overrides - let browser print dialog handle page size */
@page{margin:10mm;}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:#fff!important;padding:0;margin:0;}
  .doc-body{max-width:100%!important;box-shadow:none!important;padding:15mm;}
  .btn-doc-action{display:none!important;}
}
</style></head>
<body>${content}</body></html>`;

  printWindow=window.open('','_blank','width=420,height=700,toolbar=0,menubar=0,scrollbars=1');
  if(!printWindow){showToast('Pop-up ถูกบล็อก — กรุณาอนุญาต pop-up สำหรับ localhost', 'warning');return;}

  // ตั้งให้ปิดเมื่อ unload
  printWindow.onunload = () => { printWindow = null; };

  printWindow.document.write(html);
  printWindow.document.close();

  // รอ QR image โหลดก่อน print
  const imgs=printWindow.document.querySelectorAll('img');
  const doPrint=()=>{
    try{printWindow.focus();printWindow.print();}catch(e){}
    // Force close window หลัง print dialog (รอเพื่อให้ user กด Save/Cancel)
    setTimeout(()=>{
      if(printWindow && !printWindow.closed){
        try{printWindow.close();}catch(e){}
      }
      printWindow = null; // Clear reference completely
    }, 1000);
  };

  if(imgs.length===0){
    setTimeout(doPrint,400);
  } else {
    let done=0;
    const tryPrint=()=>{if(++done>=imgs.length)setTimeout(doPrint,200);};
    imgs.forEach(img=>{img.complete?tryPrint():(img.onload=tryPrint,img.onerror=tryPrint);});
    setTimeout(doPrint,3000); // fallback 3 วิ
  }
}

// ===== PAYMENT STATUS TRACKING =====
function loadPS(){return JSON.parse(localStorage.getItem('payment_status')||'{}');}
function savePS(ps){localStorage.setItem('payment_status',JSON.stringify(ps));}

function markRoomPaid(d){
  const ps=loadPS();
  const key=`${d.year}_${d.month}`;
  if(!ps[key])ps[key]={};
  ps[key][d.room]={
    status:'paid', amount:d.total, date:new Date().toISOString(),
    receiptNo:d.no, eNew:d.eNew, eOld:d.eOld, wNew:d.wNew, wOld:d.wOld,
    slip:slipVerified?{
      amount:slipData.amount,
      sender:slipData.sender,
      receiver:slipData.receiver,
      ref:slipData.ref,
      tDate:slipData.tDate,
      transferDate:slipData.transferDate,  // ISO datetime — for on-time gamification
      dueDate:`${d.year}-${String(d.month).padStart(2,'0')}-05`,  // 5th of billing month
      amountOk:slipData.amountOk
    }:null
  };
  savePS(ps);
  renderPaymentStatus();

  // ===== Mirror to Firestore verifiedSlips so PaymentStore picks up + survives cache clear.
  // SlipOK case: CF already wrote at functions/verifySlip.js:248. Our setDoc+merge with the
  // same transactionId is idempotent. Manual case: synthetic deterministic docId
  // `manual_<building>_<room>_<year>_<month>` so re-marking same month overwrites cleanly.
  _mirrorPaymentToVerifiedSlips(d).catch(e =>
    console.warn('[billing] verifiedSlips mirror failed:', e?.message));

  // ===== SYNC BILL STATUS → bills_YYYY (tenant app reads this) =====
  if (typeof BillingSystem !== 'undefined') {
    const yr = parseInt(d.year);
    const bill = BillingSystem.getBillByMonthYear(d.room, d.month, yr);
    if (bill) {
      BillingSystem.updateBillStatus(bill.billId, 'paid', yr);
      console.log(`🔄 Synced bill status to bills_${yr}: room ${d.room} month ${d.month} → paid`);
    }
  }

  // ===== SYNC PAYMENT RECORD → payment_{building}_{room} (tenant history) =====
  try {
    const fbBuilding = (typeof getBuildingInfo === 'function')
      ? getBuildingInfo(currentBuilding).firebaseBuilding
      : (currentBuilding === 'old' ? 'rooms' : 'nest');
    const phKey = `payment_${fbBuilding}_${d.room}`;
    const history = JSON.parse(localStorage.getItem(phKey) || '[]');
    history.unshift({
      billId: d.no,
      month: d.month,
      year: parseInt(d.year),
      amount: d.total,
      paidAt: new Date().toISOString(),
      method: slipVerified ? 'PromptPay' : 'Cash',
      slipOkVerified: !!slipVerified
    });
    localStorage.setItem(phKey, JSON.stringify(history));
    console.log(`💾 Synced payment history → ${phKey}`);
  } catch(e) { console.warn('payment history sync failed', e); }

  // ===== SAVE BILL TO FIREBASE FOR TENANT APP =====
  saveBillToFirebase(d);
}

// Mirror admin manual paid-mark to Firestore verifiedSlips so PaymentStore subscription
// (Phase 2b SoT) picks it up — survives localStorage cache clear. Idempotent:
//   • SlipOK case: real transactionId; setDoc+merge no-ops if CF already wrote.
//   • Manual case: deterministic synthetic ID; re-marking same month overwrites.
// Doc shape mirrors functions/verifySlip.js:248 so PaymentStore subscription parses uniformly.
async function _mirrorPaymentToVerifiedSlips(d) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    console.warn('[billing] Firebase not ready — skipping verifiedSlips mirror');
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const isSlipOk = !!(slipVerified && slipData?.ref);
  const docId = isSlipOk
    ? String(slipData.ref)
    : `manual_${d.building}_${d.room}_${d.year}_${d.month}`;
  // Construct timestamp inside the billing month (CE year, 5th @ noon BKK) so PaymentStore
  // subscription's yearBE/month derivation (timestamp.year/month → +543) keys correctly,
  // even when admin marks paid in a different calendar month than the bill belongs to.
  const yearCE = parseInt(d.year) - 543;
  const billingTs = new Date(yearCE, parseInt(d.month) - 1, 5, 12, 0, 0);
  const ref = fs.doc(fs.collection(db, 'verifiedSlips'), docId);
  await fs.setDoc(ref, {
    transactionId: docId,
    building: d.building,
    room: String(d.room),
    amount: d.total,
    expectedAmount: d.total,
    sender: isSlipOk ? slipData.sender : '(บันทึกโดย admin)',
    receiver: isSlipOk ? (slipData.receiver || '') : '',
    bankCode: isSlipOk ? (slipData.bankCode || '') : '',
    date: isSlipOk && slipData.tDate ? slipData.tDate : billingTs.toISOString(),
    timestamp: billingTs,
    verifiedAt: new Date(),
    verified: true,
    receiptNo: d.no,
    manualEntry: !isSlipOk,
    yearBE: parseInt(d.year),
    month: parseInt(d.month)
  }, { merge: true });
  console.log(`💸 Mirrored payment → verifiedSlips/${docId} (${isSlipOk ? 'SlipOK' : 'manual'})`);
}

async function saveBillToFirebase(d){
  try {
    if (!window.firebaseDatabase || !window.firebaseSet) {
      console.warn('⚠️ Firebase not initialized, skipping bill save');
      return;
    }

    // Create bill object with all necessary data for tenant app
    const billObject = {
      billId: d.no,
      room: d.room,
      building: d.building,
      month: d.month,
      year: d.year,
      status: 'paid',
      billDate: d.dateStr,
      totalCharge: d.total,
      charges: {
        rent: d.rent,
        rentLabel: d.rentLabel,
        electric: {
          cost: d.eCost || 0,
          old: d.eOld || 0,
          new: d.eNew || 0,
          units: d.eUnits || 0,
          rate: d.eRate || 8
        },
        water: {
          cost: d.wCost || 0,
          old: d.wOld || 0,
          new: d.wNew || 0,
          units: d.wUnits || 0,
          rate: d.wRate || 20
        },
        trash: d.trash || 0,
        common: d.other || 0
      },
      meterReadings: {
        electric: { old: d.eOld || 0, new: d.eNew || 0, units: d.eUnits || 0 },
        water: { old: d.wOld || 0, new: d.wNew || 0, units: d.wUnits || 0 }
      },
      note: d.note || '',
      createdAt: new Date().toISOString(),
      slipVerified: slipVerified,
      slipData: slipVerified && slipData ? {
        amount: slipData.amount,
        sender: slipData.sender,
        receiver: slipData.receiver,
        ref: slipData.ref,
        tDate: slipData.tDate,
        transferDate: slipData.transferDate,  // ISO — actual transfer time
        dueDate: `${d.year}-${String(d.month).padStart(2,'0')}-05`,
        paidOnTime: slipData.transferDate
          ? new Date(slipData.transferDate) <= new Date(`${d.year}-${String(d.month).padStart(2,'0')}-05T23:59:59`)
          : null
      } : null
    };

    // Save to Firebase: bills/{building}/{roomId}/{billId}
    // Tenant app expects: bills/{building}/{room} as an object with billIds as keys
    const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');

    // Determine Firebase building ID using proper conversion
    // currentBuilding is 'old' or 'new', need to convert to 'rooms' or 'nest'
    const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);

    // Idempotent path: reuse existing bill's RTDB key for same room/month/year
    // so re-issue (auto then manual click, or admin re-generates) overwrites
    // in-place. Falls back to d.no when no bill exists (first issue, or
    // admin deleted a bill that needs regenerating).
    let targetBillId = d.no;
    const cached = window.BillStore?._cache?.[fbBuildingId]?.[d.room];
    if (cached) {
      const match = Object.entries(cached).find(([, b]) =>
        Number(b.month) === Number(d.month) && String(b.year) === String(d.year)
      );
      if (match) {
        targetBillId = match[0];
        billObject.billId = targetBillId;  // keep field aligned with path
        console.log(`🔁 Reusing existing billId ${targetBillId} for ${fbBuildingId}/${d.room} ${d.month}/${d.year}`);
      }
    }

    // Save bill at bills/{building}/{room}/{billId}
    const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${d.room}/${targetBillId}`);
    await window.firebaseSet(billsRef, billObject);

    console.log(`✅ Bill saved to Firebase: bills/${fbBuildingId}/${d.room}/${targetBillId}`);
  } catch (error) {
    console.error('❌ Error saving bill to Firebase:', error);
  }
}

// ===== AUTO-GENERATE BILLS FROM FIREBASE METER DATA =====
async function autoGenerateAllBills() {
  const month = parseInt(document.getElementById('f-month').value);
  const year = document.getElementById('f-year').value;
  const bldgInfo = getBuildingInfo(currentBuilding);
  const fbBuildingId = window.CONFIG.getBuildingConfig(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);

  // VERIFICATION #1: Check room count before generation
  const expectedRoomCount = fbBuildingId === 'rooms' ? 23 : 10; // 23 for Rooms, 10 for Nest
  const actualRoomCount = rooms.length;

  if (actualRoomCount !== expectedRoomCount) {
    const proceed = confirm(
      `⚠️ Warning: Expected ${expectedRoomCount} rooms but found ${actualRoomCount}.\n\n` +
      `This may result in incomplete bill generation.\n\n` +
      `Continue anyway?`
    );
    if (!proceed) {
      console.log('❌ Bill generation cancelled by user');
      return;
    }
  }

  console.log(`🚀 Auto-generating bills for ${fbBuildingId}/${month}/${year}... (${actualRoomCount} rooms)`);

  try {
    // Get meter data from Firebase for this month
    const yearMonth = `${year % 100}_${String(month).padStart(2, '0')}`;
    const meterData = await FirebaseMeterHelper.getMeterDataForMonth(fbBuildingId, yearMonth);

    if (!meterData) {
      showToast(`ไม่พบข้อมูลมิเตอร์สำหรับ ${MONTHS_FULL[month]} ${year + 543}`, 'error');
      return;
    }

    let generatedCount = 0;
    const generatedBills = [];
    const totalMeterEntries = Object.entries(meterData).length;

    // Generate bill for each room with meter data
    for (const [roomId, meterReadings] of Object.entries(meterData)) {
      // Show progress
      const progressPercent = Math.round((generatedCount / totalMeterEntries) * 100);
      console.log(`📊 Generating bills... ${generatedCount}/${totalMeterEntries} (${progressPercent}%)`);
      // Get room config
      const roomConfig = rooms.find(r => r.id === roomId);
      if (!roomConfig) continue;

      const rent = roomConfig.rentPrice || roomConfig.rent || 0;
      const eRate = roomConfig.electricRate || roomConfig.elecRate || 8;
      const wRate = roomConfig.waterRate || 20;
      const trash = roomConfig.trashRate || roomConfig.trashFee || 20;

      // Calculate costs from meter data
      const eUnits = Math.max(0, (meterReadings.eNew || 0) - (meterReadings.eOld || 0));
      const wUnits = Math.max(0, (meterReadings.wNew || 0) - (meterReadings.wOld || 0));
      const eCost = eUnits * eRate;
      const wCost = wUnits * wRate;
      const total = rent + eCost + wCost + trash;

      // Create bill object
      const now = new Date();
      const billObject = {
        billId: `TGH-${year}${String(month).padStart(2,'0')}-${roomId.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`,
        room: roomId,
        building: fbBuildingId,
        month: month,
        year: year,
        status: 'pending',
        billDate: now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}),
        totalCharge: total,
        charges: {
          rent: rent,
          rentLabel: 'ค่าเช่าห้อง',
          electric: {
            cost: eCost || 0,
            old: meterReadings.eOld || 0,
            new: meterReadings.eNew || 0,
            units: eUnits || 0,
            rate: eRate || 8
          },
          water: {
            cost: wCost || 0,
            old: meterReadings.wOld || 0,
            new: meterReadings.wNew || 0,
            units: wUnits || 0,
            rate: wRate || 20
          },
          trash: trash || 0,
          common: 0
        },
        meterReadings: {
          electric: { old: meterReadings.eOld || 0, new: meterReadings.eNew || 0, units: eUnits || 0 },
          water: { old: meterReadings.wOld || 0, new: meterReadings.wNew || 0, units: wUnits || 0 }
        },
        note: '',
        createdAt: new Date().toISOString()
      };

      // Save to Firebase
      try {
        const { ref: firebaseRef } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');
        const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${roomId}/${billObject.billId}`);
        await window.firebaseSet(billsRef, billObject);

        generatedCount++;
        generatedBills.push(`${roomId}: ฿${total.toLocaleString()}`);
        console.log(`✅ Bill generated: ${fbBuildingId}/${roomId}/${billObject.billId}`);
      } catch (e) {
        console.error(`❌ Error saving bill for ${roomId}:`, e);
      }
    }

    // VERIFICATION #2: Check if all expected bills were generated
    const missingRooms = rooms.filter(r => !generatedBills.some(b => b.includes(r.id)));

    if (generatedCount === 0) {
      showToast(`ไม่มีบิลที่สร้างได้ (ตรวจสอบข้อมูลมิเตอร์)`, 'warning');
      return;
    }

    let message = `✅ สร้างบิลสำเร็จ ${generatedCount}/${actualRoomCount} ห้อง\n\n${generatedBills.join('\n')}`;

    if (generatedCount < actualRoomCount) {
      const missingRoomIds = missingRooms.map(r => r.id).join(', ');
      message += `\n\n⚠️ ไม่พบข้อมูลมิเตอร์สำหรับ: ${missingRoomIds}`;
    }

    if (generatedCount === actualRoomCount) {
      message = `✅ สร้างบิลครบทั้ง ${generatedCount} ห้องแล้ว!\n\n${generatedBills.join('\n')}`;
    }

    showToast(message, 'success');
    console.log(`📊 Auto-generated ${generatedCount}/${actualRoomCount} bills for ${MONTHS_FULL[month]} ${year + 543}`);
  } catch (error) {
    console.error('❌ Error in auto-generate bills:', error);
    showToast(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
  }
}

function renderPaymentStatus(){
  const el=document.getElementById('payStatusGrid');if(!el)return;
  const month=parseInt(document.getElementById('f-month').value);
  const year=document.getElementById('f-year').value;
  // Phase 2b: PaymentStore unifies verifiedSlips (Firestore) + payment_status (legacy)
  const paid = (typeof PaymentStore !== 'undefined')
    ? PaymentStore.listForMonth(year, month)
    : (loadPS()[`${year}_${month}`] || {});
  // Map building names and get active rooms
  const bldgInfo = getBuildingInfo(currentBuilding);
  const rooms = getActiveRoomsWithMetadata(bldgInfo.firebaseBuilding, bldgInfo.metadataArray);
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
    if(p){
      return`<span onclick="showPayDetail('${r.id}')" title="คลิกดูรายละเอียด / แก้ไข" class="u-bill-paid-badge">✅ ${r.id}</span>`;
    } else {
      return`<span onclick="selectRoomForBill('${r.id}')" title="คลิกเพื่อออกบิล" class="u-bill-pending-badge">⏳ ${r.id}</span>`;
    }
  }).join('')}
  </div>`;
}

function selectRoomForBill(roomId){
  // เปลี่ยนไปหน้า ออกบิล แล้วเลือกห้องนั้นเลย
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-bill').classList.add('active');
  document.querySelector('[onclick*="showPage(\'bill\'"]')?.classList.add('active');
  document.getElementById('f-room').value=roomId;
  onRoomChange();
  document.getElementById('f-room').scrollIntoView({behavior:'smooth'});
}

// ===== PAYMENT DETAIL MODAL =====
let payModalRoomId=null, payModalYear=null, payModalMonth=null;

function showPayDetail(roomId, year, month){
  const month2 = month ?? parseInt(document.getElementById('f-month')?.value||new Date().getMonth()+1);
  const year2  = year  ?? (document.getElementById('f-year')?.value||String(new Date().getFullYear()+543));
  payModalRoomId=roomId; payModalYear=String(year2); payModalMonth=month2;

  // Primary sources: BillStore (RTDB) + PaymentStore (verifiedSlips)
  const bld = /^[Nn]\d/.test(roomId) ? 'nest' : 'rooms';
  const bill = typeof window.BillStore !== 'undefined'
    ? window.BillStore.getByMonth(bld, roomId, String(year2), month2)
    : null;
  const payEntry = typeof window.PaymentStore !== 'undefined'
    ? window.PaymentStore.listForMonth(year2, month2)?.[roomId]
    : null;
  // Fallback: legacy localStorage (for older records not yet in RTDB/Firestore)
  const legacyEntry = (!bill && !payEntry)
    ? (loadPS()[`${year2}_${month2}`]?.[roomId] ?? null)
    : null;

  const isPaid = bill ? bill.status === 'paid' : !!(payEntry || legacyEntry);
  const p = payEntry || legacyEntry;
  const monthName=MONTHS_FULL[month2]||month2;

  document.getElementById('payModalTitle').textContent=`📋 ห้อง ${roomId} — ${monthName} ${year2}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');

  if(isPaid){
    const paidDateStr = bill?.paidAt || p?.date;
    const paidDate = paidDateStr
      ? new Date(paidDateStr).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})
      : '—';
    const receiptNo = p?.receiptNo || '—';
    const editedBadge = p?.editedAt
      ? `<span style="font-size:.73rem;color:var(--accent)"> · แก้ไขล่าสุด ${new Date(p.editedAt).toLocaleDateString('th-TH')}</span>`
      : '';
    const slip = p?.slip;
    // BillStore has meterReadings.electric/water; legacy has eNew/eOld/wNew/wOld flat
    const eNew = bill?.meterReadings?.electric?.new ?? p?.eNew ?? 0;
    const eOld = bill?.meterReadings?.electric?.old ?? p?.eOld ?? 0;
    const wNew = bill?.meterReadings?.water?.new    ?? p?.wNew ?? 0;
    const wOld = bill?.meterReadings?.water?.old    ?? p?.wOld ?? 0;
    const amount = bill?.totalCharge ?? p?.amount ?? 0;
    body.innerHTML=`
      <div style="background:var(--green-pale);border-radius:8px;padding:.65rem .85rem;font-size:.82rem;line-height:1.7;">
        ✅ ชำระแล้ว · <strong>${receiptNo}</strong> · ${paidDate}${editedBadge}
        ${slip?`<br>💳 SlipOK: ${slip.sender||'—'} · ฿${(slip.amount||0).toLocaleString()}`:''}
      </div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.4rem 0 2px;">✏️ แก้ไขมิเตอร์ (ถ้ากรอกผิด)</div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ ล่าสุด (eNew)</span><input class="pm-input" id="pm-eNew" type="number" value="${eNew}"></div>
      <div class="pm-row"><span class="pm-label">⚡ มิเตอร์ไฟ เดิม (eOld)</span><input class="pm-input" id="pm-eOld" type="number" value="${eOld}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ ล่าสุด (wNew)</span><input class="pm-input" id="pm-wNew" type="number" value="${wNew}"></div>
      <div class="pm-row"><span class="pm-label">💧 มิเตอร์น้ำ เดิม (wOld)</span><input class="pm-input" id="pm-wOld" type="number" value="${wOld}"></div>
      <div class="pm-row"><span class="pm-label">💰 ยอดรวม</span><strong style="color:var(--green-dark);font-size:.95rem;">฿${amount.toLocaleString()}</strong></div>`;
    footer.innerHTML=`
      <button class="pm-btn green" onclick="savePayEdit()">💾 บันทึกมิเตอร์</button>
      <button class="pm-btn red" onclick="resetRoomPayment()">🔄 รีเซ็ตกลับ "ยังไม่จ่าย"</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  } else {
    body.innerHTML=`
      <div style="background:#fff3e0;border-radius:8px;padding:.75rem;font-size:.84rem;color:#e65100;margin-bottom:.5rem;">
        ⏳ ยังไม่ได้ชำระ — ${monthName} ${year2}
      </div>
      <div style="font-size:.86rem;color:var(--text-muted);text-align:center;padding:.9rem 0;">
        คลิก "ออกบิล" เพื่อเปิดฟอร์มออกใบวางบิลห้องนี้
      </div>`;
    footer.innerHTML=`
      <button class="pm-btn blue" onclick="closePayModal();goBillFromTable('${roomId}',${year2},${month2})">📄 ออกบิลห้อง ${roomId}</button>
      <button class="pm-btn gray" onclick="closePayModal()">ปิด</button>`;
  }
  document.getElementById('payModalOverlay').classList.add('show');
}

function closePayModal(){
  document.getElementById('payModalOverlay').classList.remove('show');
  payModalRoomId=null;
}

function savePayEdit(){
  if(!payModalRoomId)return;
  const eNew=parseFloat(document.getElementById('pm-eNew').value)||0;
  const eOld=parseFloat(document.getElementById('pm-eOld').value)||0;
  const wNew=parseFloat(document.getElementById('pm-wNew').value)||0;
  const wOld=parseFloat(document.getElementById('pm-wOld').value)||0;
  const editedAt=new Date().toISOString();

  // Primary: write meter corrections to RTDB bill
  if(window.BillStore && window.firebaseUpdate && window.firebaseRef && window.firebaseDatabase){
    try {
      const bld = /^[Nn]\d/.test(payModalRoomId) ? 'nest' : 'rooms';
      const roomBills = window.BillStore._cache[bld]?.[payModalRoomId] || {};
      const billEntry = Object.entries(roomBills).find(([, b]) =>
        Number(b.month) === Number(payModalMonth) && String(b.year) === String(payModalYear)
      );
      if(billEntry){
        const [billId] = billEntry;
        window.firebaseUpdate(
          window.firebaseRef(window.firebaseDatabase, `bills/${bld}/${payModalRoomId}/${billId}`),
          { 'meterReadings/electric/new': eNew, 'meterReadings/electric/old': eOld,
            'meterReadings/water/new': wNew, 'meterReadings/water/old': wOld,
            editedAt }
        ).catch(e => console.warn('[savePayEdit] RTDB update failed:', e));
      }
    } catch(e){ console.warn('[savePayEdit] RTDB update failed:', e); }
  }

  // Mirror to legacy localStorage
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(ps[key]?.[payModalRoomId]){
    Object.assign(ps[key][payModalRoomId], { eNew, eOld, wNew, wOld, editedAt });
    savePS(ps);
  }

  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
  const t=document.createElement('div');
  t.textContent='✅ บันทึกมิเตอร์เรียบร้อย';
  t.className='u-toast-center';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2200);
}

function resetRoomPayment(){
  if(!payModalRoomId)return;
  if(!confirm(`ยืนยันรีเซ็ตห้อง ${payModalRoomId} กลับเป็น "ยังไม่ชำระ"?\n(ข้อมูลใบเสร็จจะถูกลบออก)`))return;

  // Primary: flip RTDB bill back to pending
  if(window.BillStore && window.firebaseUpdate && window.firebaseRef && window.firebaseDatabase){
    try {
      const bld = /^[Nn]\d/.test(payModalRoomId) ? 'nest' : 'rooms';
      const roomBills = window.BillStore._cache[bld]?.[payModalRoomId] || {};
      const billEntry = Object.entries(roomBills).find(([, b]) =>
        Number(b.month) === Number(payModalMonth) && String(b.year) === String(payModalYear)
      );
      if(billEntry){
        const [billId] = billEntry;
        window.firebaseUpdate(
          window.firebaseRef(window.firebaseDatabase, `bills/${bld}/${payModalRoomId}/${billId}`),
          { status: 'pending', paidAt: null }
        ).catch(e => console.warn('[resetRoomPayment] RTDB update failed:', e));
      }
    } catch(e){ console.warn('[resetRoomPayment] RTDB update failed:', e); }
  }

  // Remove from legacy localStorage
  const ps=loadPS();
  const key=`${payModalYear}_${payModalMonth}`;
  if(ps[key]){
    delete ps[key][payModalRoomId];
    if(Object.keys(ps[key]).length===0)delete ps[key];
  }
  savePS(ps);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
}

