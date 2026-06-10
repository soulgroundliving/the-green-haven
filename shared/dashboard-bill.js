// ===== BILL PAGE =====
window.currentBuilding = 'rooms';
window.invoiceData = null;

// Helper: Resolve building id (canonical or legacy alias) → Firebase config + metadata.
// Accepts canonical ids ('rooms', 'nest', 'test1', any Tier-3F id) and legacy aliases
// ('old'→rooms, 'new'→nest, 'RentRoom'→rooms). New buildings without a hardcoded
// metadata array render an empty room list — admin should seed rooms via Room Config
// or Tenant Information page first.
function getBuildingInfo(buildingId) {
  const firebaseBuilding = window.CONFIG?.getBuildingConfig?.(buildingId) || 'rooms';
  let metadataArray = [];
  if (firebaseBuilding === 'rooms') metadataArray = window.ROOMS_OLD || [];
  else if (firebaseBuilding === 'nest') metadataArray = window.NEST_ROOMS || window.ROOMS_NEW || [];
  const fromRegistry = window.BuildingRegistry?.getById?.(firebaseBuilding)?.displayName;
  const displayName = fromRegistry
    || (firebaseBuilding === 'rooms' ? 'เดอะ กรีน เฮฟเว่น'
        : firebaseBuilding === 'nest' ? 'Nest · เดอะ กรีน เฮฟเว่น'
        : firebaseBuilding);
  return { firebaseBuilding, metadataArray, displayName };
}

// Manual per-bill extras (late fee / other charge / note) are NOT derived from room
// config, so a room/building switch must zero them. Otherwise they carry over to the
// next room and silently inflate its total, QR and slip expectedAmount — and get
// recorded as paid (live 2026-06-10: ห้อง 19 inherited the previous room's ค่าปรับ).
function _resetBillExtras(){
  const lf=document.getElementById('f-latefee'); if(lf) lf.value=0;
  const ot=document.getElementById('f-other');   if(ot) ot.value=0;
  const nt=document.getElementById('f-note');     if(nt) nt.value='';
}

function onBuildingChange(){
  window.currentBuilding=document.getElementById('f-building').value;
  populateRoomDropdown();
  const canonical = window.CONFIG?.getBuildingConfig?.(currentBuilding) || 'rooms';
  document.getElementById('f-trash').value = canonical === 'nest' ? 40 : 20;
  document.getElementById('f-elec-rate').value=8;
  _resetBillExtras();
  renderPaymentStatus();
  if (typeof _refreshPromptPayDisplay === 'function') _refreshPromptPayDisplay();
  calcBill(); resetBillFlow(); _updateBillActionPaidState();
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
  const _elecRate=opt.dataset.elec||8;
  document.getElementById('f-elec-rate').value=_elecRate;
  document.getElementById('f-trash').value=opt.dataset.trash||20;
  _resetBillExtras(); // a new room must not inherit the previous room's ค่าปรับ/extras
  // Update rate chip display labels
  const _dER=document.getElementById('d-elec-rate-lbl'); if(_dER) _dER.textContent='฿'+_elecRate+'/u';
  const _dWR=document.getElementById('d-water-rate-lbl'); if(_dWR) _dWR.textContent='฿'+(opt.dataset.water||20)+'/u';

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
  autoFillMeters().then(()=>{ renderPaymentStatus(); resetBillFlow(); _updateBillActionPaidState(); _updateBillRoomHeader(); });
  renderPaymentStatus();
  _updateBillActionPaidState();
  _updateBillRoomHeader();
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
    vacant.forEach(({r})=>{ html+=pill(r,`background:${DashColors.RED_BG};color:var(--red);border:1px solid #ffcdd2;`); });
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
    // Update static display labels (old + new readings shown as labels, not inputs)
    const dEO=document.getElementById('d-elec-old'); if(dEO) dEO.textContent=(meterData.eOld!=null&&meterData.eOld!=='') ? meterData.eOld : '—';
    const dWO=document.getElementById('d-water-old'); if(dWO) dWO.textContent=(meterData.wOld!=null&&meterData.wOld!=='') ? meterData.wOld : '—';
    const dEN=document.getElementById('d-elec-new'); if(dEN) dEN.textContent=(meterData.eNew!=null&&meterData.eNew!=='') ? meterData.eNew : '—';
    const dWN=document.getElementById('d-water-new'); if(dWN) dWN.textContent=(meterData.wNew!=null&&meterData.wNew!=='') ? meterData.wNew : '—';
  } else {
    document.getElementById('f-elec-new').value='';
    document.getElementById('f-elec-old').value='';
    document.getElementById('f-water-new').value='';
    document.getElementById('f-water-old').value='';
    const dEO=document.getElementById('d-elec-old'); if(dEO) dEO.textContent='—';
    const dWO=document.getElementById('d-water-old'); if(dWO) dWO.textContent='—';
    const dEN=document.getElementById('d-elec-new'); if(dEN) dEN.textContent='—';
    const dWN=document.getElementById('d-water-new'); if(dWN) dWN.textContent='—';
    // Retry once after 1.2s if METER_DATA was still empty (Firebase not ready yet)
    const isMDEmpty = !window.METER_DATA || (
      Object.keys(window.METER_DATA.rooms||{}).length === 0 &&
      Object.keys(window.METER_DATA.nest||{}).length === 0
    );
    if (isMDEmpty && !autoFillMeters._retried) {
      autoFillMeters._retried = true;
      console.info('⏳ METER_DATA empty — retrying autoFillMeters in 1.2s...');
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
  // Update units-label inside meter cards
  const _eUL=document.getElementById('d-elec-units-lbl'); if(_eUL) _eUL.textContent=eUnits>0?`${eUnits} หน่วย × ฿${eRate} = ฿${eCost.toLocaleString()}`:'';
  const _wUL=document.getElementById('d-water-units-lbl'); if(_wUL) _wUL.textContent=wUnits>0?`${wUnits} หน่วย × ฿${wRate} = ฿${wCost.toLocaleString()}`:'';
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
  // Once the invoice was sent (ส่งใบวางบิล snapshots window.invoiceData), a later edit
  // here — most often ค่าปรับ — must flow back into that snapshot, the re-rendered doc,
  // AND the QR. Otherwise slip verification keeps the STALE total as expectedAmount and
  // SlipOK rejects a correct slip "ยอดไม่ตรง" by exactly the late-fee delta (e.g. ฿2512
  // paid vs stale ฿1712 expected). markRoomPaid/generateReceipt read invoiceData too.
  if (window.invoiceData) {
    Object.assign(window.invoiceData, { rent, eNew, eOld, eUnits, eRate, eCost, wNew, wOld, wUnits, wRate, wCost, trash, other, lateFee, total });
    try {
      const _inv = document.getElementById('invoicePanel');
      if (_inv && !_inv.classList.contains('u-hidden')) {
        const _now = window.invoiceData.now instanceof Date ? window.invoiceData.now : new Date();
        const _due = new Date(_now); _due.setDate(5); if (_due <= _now) _due.setMonth(_due.getMonth()+1);
        _inv.innerHTML = buildDocHTML(window.invoiceData, 'invoice', _due.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}));
      }
    } catch (e) { console.warn('invoice re-render skipped:', e); }
  }
  // Live-update QR when invoice panel is already visible (e.g. admin adjusts ค่าปรับ after preview)
  renderQR('qr-payment', total);
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
    const canonical = window.CONFIG?.getBuildingConfig?.(bldg) || bldg;
    const cfg = window._buildingPaymentCache[canonical] || window._buildingPaymentCache[bldg] || {};
    // Buildings page is the only writer since 2026-05-14 consolidation.
    // All buildings/* docs are canonical-only (promptPayId) after the
    // 2026-05-18 migration of buildings/nest. localStorage cache is the
    // last-resort fallback for an admin viewing offline.
    const num = cfg.promptPayId
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

// Subscribe Firestore buildings/{rooms|nest} once Firebase ready
// Lazy: triggered on first showPage('bill') — see dashboard-main.js. The
// `_buildingPaymentSubscribed` guard makes this idempotent across re-entry.
window._buildingPaymentSubscribed = window._buildingPaymentSubscribed || false;
function _subscribeBuildingPaymentForBill(){
  if (window._buildingPaymentSubscribed) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeBuildingPaymentForBill, 1000);
    return;
  }
  window._buildingPaymentSubscribed = true;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  // Subscribe to every known building (canonical IDs from BuildingRegistry,
  // plus rooms/nest as the safe fallback for the cold-start case).
  const ids = new Set(['rooms', 'nest']);
  (window.BuildingRegistry?.list?.() || []).forEach(b => ids.add(b.id));
  ids.forEach(id => {
    try {
      fs.onSnapshot(fs.doc(db, 'buildings', id), snap => {
        window._buildingPaymentCache[id] = snap.exists ? snap.data() : {};
        _refreshPromptPayDisplay();
      }, err => console.warn('buildings/'+id+' listen:', err?.message));
    } catch(e) { console.warn('buildings subscribe error:', e); }
  });
}
window._subscribeBuildingPaymentForBill = _subscribeBuildingPaymentForBill;

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
  // §7-T reader-fix (2026-06-08): the RTDB bill's own status:'paid' is the canonical
  // paid signal post-Option-C. verifiedSlips may be ABSENT while the bill IS paid —
  // e.g. a backfilled bill (tools/backfill-synth-bills.js) or a slip whose verifiedSlips
  // write failed (the old userId bug). Without this, the ออกบิล grid (reads verifiedSlips)
  // showed a tenant-paid room as ⏳ while the tenant app + home dashboard widget (both read
  // BillStore RTDB) showed ✅. Mirror those: merge BillStore-paid rooms as a low-precedence
  // fallback so all admin views agree. Returns { room: {status:'paid', amount, ...} }.
  function _billStorePaidForMonth(building, year, month) {
    const out = {};
    try {
      const byBuilding = window.BillStore?._cache?.[building];
      if (!byBuilding) return out;
      const beYear = Number(year) < 2400 ? Number(year) + 543 : Number(year);
      const m = Number(month);
      for (const room of Object.keys(byBuilding)) {
        const bills = byBuilding[room] || {};
        for (const billId of Object.keys(bills)) {
          const b = bills[billId];
          if (!b || String(b.status).toLowerCase() !== 'paid') continue;
          const by = Number(b.year) < 2400 ? Number(b.year) + 543 : Number(b.year);
          if (by === beYear && Number(b.month) === m) {
            out[String(room)] = {
              status: 'paid',
              amount: Number(b.totalCharge ?? b.totalAmount) || 0,
              date: b.paidAt ? new Date(b.paidAt).toISOString() : null,
              receiptNo: b.receiptNo || b.paidRef || null,
              fromBill: true, billId,
            };
            break;
          }
        }
      }
    } catch(e) { /* BillStore not ready — verifiedSlips/legacy still apply */ }
    return out;
  }
  function isPaid(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    if (cache[k]?.[r]?.status === 'paid') return true;
    if (_readLegacy()[k]?.[r]?.status === 'paid') return true;
    if (building && _billStorePaidForMonth(building, year, month)[r]) return true;
    return false;
  }
  function getSlip(building, room, year, month) {
    const k = _key(year, month);
    const r = String(room);
    return cache[k]?.[r] || _readLegacy()[k]?.[r]
      || (building ? _billStorePaidForMonth(building, year, month)[r] : null) || null;
  }
  // `building` optional + last for back-compat. When provided, BillStore-paid rooms
  // are merged at LOWEST precedence (verifiedSlips/legacy win — they carry slip detail).
  function listForMonth(year, month, building) {
    const k = _key(year, month);
    const billPaid = building ? _billStorePaidForMonth(building, year, month) : {};
    return { ...billPaid, ...(_readLegacy()[k] || {}), ...(cache[k] || {}) };
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
  // Drop a room's cached paid-signal — used when a verifiedSlips doc is deleted
  // (reset/refund) so the ออกบิล grid stops showing it as paid without a reload.
  function _remove(year, month, room) {
    const k = _key(year, month);
    if (cache[k]) delete cache[k][String(room)];
  }
  function _notify() { listeners.forEach(fn => { try { fn(); } catch(e){} }); }
  return { isPaid, getSlip, listForMonth, onChange, _ingest, _remove, _notify };
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
        const s = ch.doc.data();
        if (ch.type === 'removed') {
          // A reset/refund deleted this slip — drop it from the PaymentStore cache + the
          // legacy payment_status mirror so the ออกบิล grid reflects it WITHOUT a reload.
          // (Previously ignored → a reset left the room showing ✅ because the cache held it.)
          try {
            const room0 = String(s?.room || '');
            const ts0 = s?.timestamp?.toDate ? s.timestamp.toDate() : (s?.date ? new Date(s.date) : null);
            if (room0 && ts0) {
              const yBE0 = ts0.getFullYear() + 543, m0 = ts0.getMonth() + 1, k0 = `${yBE0}_${m0}`;
              window.PaymentStore?._remove?.(yBE0, m0, room0);
              if (ps[k0]?.[room0]) { delete ps[k0][room0]; changed = true; }
            }
          } catch (e) { console.warn('[billing] verifiedSlips removed-handler:', e?.message || e); }
          return;
        }
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
        try { window.PaymentStore._ingest(yearBE, month, room, entry); } catch(e){ console.warn('[billing] PaymentStore._ingest failed:', e?.message || e); }
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
        try { window.PaymentStore._notify(); } catch(e){ console.warn('[billing] PaymentStore._notify failed:', e?.message || e); }
        // Re-render bill page pills if open
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){ console.warn('[billing] renderPaymentStatus failed:', e?.message || e); }
        }
        console.info('💸 Synced tenant-app payment → PaymentStore + payment_status');
      } else {
        // Even when no new slips, fire ingestion of the snapshot's full state
        // so PaymentStore cache is populated at startup
        try { window.PaymentStore._notify(); } catch(e){ console.warn('[billing] PaymentStore._notify failed:', e?.message || e); }
      }
      // Perf #1: expose the full slip list so Payment Verify tab can render
      // from this cache instead of opening its own onSnapshot listener.
      try {
        const allSlips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window._verifiedSlipsRawCache = allSlips;
        window.dispatchEvent(new CustomEvent('verified-slips-updated', { detail: allSlips }));
      } catch(e){ console.warn('[billing] verified-slips cache update failed:', e?.message || e); }
    }, err => console.warn('global verifiedSlips listen:', err?.message));
  } catch(e) { console.warn('subscribeGlobalVerifiedSlips:', e); }
}
// Lazy: triggered on first showPage('bill') — see dashboard-main.js. The
// `window._globalSlipsUnsub` guard inside the function makes this idempotent.
// Consumers (PaymentStore.isPaid grid + dashboard-payment-verify.js fallback)
// only need the data once the bill page is visible; the home dashboard
// payment widget reads from BillStore (RTDB), not verifiedSlips Firestore.
window._subscribeGlobalVerifiedSlips = _subscribeGlobalVerifiedSlips;

// PaymentStore listener: auto-rerender payment grid when a new slip arrives
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof window.PaymentStore !== 'undefined') {
      window.PaymentStore.onChange(() => {
        if (typeof renderPaymentStatus === 'function' &&
            document.getElementById('page-bill')?.classList.contains('active')) {
          try { renderPaymentStatus(); } catch(e){ console.warn('[billing] renderPaymentStatus failed:', e?.message || e); }
          try { _updateBillActionPaidState(); } catch(e){ console.warn('[billing] _updateBillActionPaidState failed:', e?.message || e); }
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
  window.invoiceData=d;

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
  window.slipVerified=false; window.slipData=null;
  document.getElementById('slipResult').innerHTML='';
  document.getElementById('slipDropText').innerHTML='🖼️ แตะเพื่ออัปโหลดสลิป หรือลากมาวางที่นี่<br><small>SlipOK ตรวจสอบชื่อ ยอด วันเวลา สลิปซ้ำ ภายใน 3 วินาที</small>';
  document.getElementById('slipFileInput').value='';
  document.getElementById('slipVerifySection').classList.add('show');
  document.getElementById('billHint').textContent='📲 อัปโหลดสลิปเพื่อตรวจสอบ → จากนั้นออกใบเสร็จได้เลย';
  document.getElementById('step1').className='step done';
  const _sn1 = document.getElementById('step1').querySelector('.step-num');
  if(_sn1) _sn1.textContent='✓';
  document.getElementById('step2').className='step active';
  // Mark invoice button as sent
  const _invBtn = document.querySelector('[data-action="generateInvoice"]');
  if(_invBtn){ _invBtn.textContent='✅ ส่งแล้ว'; _invBtn.disabled=true; _invBtn.classList.add('u-op40','u-no-ptr'); }
  // Reveal doc panels (hidden by default until first invoice generated)
  document.getElementById('billDocPanels')?.classList.remove('u-hidden');
  setTimeout(()=>{ document.getElementById('billDocPanels')?.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 100);
  // Reveal "next unpaid room" button and update its label with remaining count
  const _nextBtn = document.getElementById('btnNextUnpaidRoom');
  if(_nextBtn){
    const _paidMap = typeof PaymentStore!=='undefined' ? PaymentStore.listForMonth(parseInt(document.getElementById('f-year')?.value), parseInt(document.getElementById('f-month')?.value)) : {};
    const _bldgInfo = getBuildingInfo(currentBuilding);
    const _rooms = typeof getActiveRoomsWithMetadata==='function' ? getActiveRoomsWithMetadata(_bldgInfo.firebaseBuilding, _bldgInfo.metadataArray) : [];
    const _remaining = _rooms.filter(r=>!_paidMap[r.id] && r.id !== (document.getElementById('f-room')?.value||'')).length;
    _nextBtn.textContent = _remaining > 0 ? `→ ห้องถัดไปที่ยังไม่ชำระ (${_remaining} ห้อง)` : '🎉 ทุกห้องชำระแล้ว';
    _nextBtn.classList.remove('u-hidden');
  }
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
    ? `<div style="margin-top:10px;padding:8px;background:${DashColors.GREEN_BG};border-radius:6px;font-size:.78rem;color:var(--green-dark);">✅ ยืนยันด้วย SlipOK · ผู้โอน: ${slipData.sender} · ฿${slipData.amount.toLocaleString()} · ${slipData.tDate}</div>`
    : '';
  document.getElementById('receiptPanel').innerHTML=buildDocHTML(d,'receipt',null,payDate)+slipNote;
  document.getElementById('step2').className='step done';
  const _sn2 = document.getElementById('step2').querySelector('.step-num');
  if(_sn2) _sn2.textContent='✓';
  document.getElementById('slipVerifySection').classList.remove('show');
  markRoomPaid(d); // บันทึกสถานะห้องนี้ว่าชำระแล้ว
  // Update next-room button with specific next unpaid room id
  setTimeout(()=>{
    const _nextBtn = document.getElementById('btnNextUnpaidRoom');
    if(!_nextBtn || _nextBtn.classList.contains('u-hidden')) return;
    const _paidMap = typeof PaymentStore!=='undefined' ? PaymentStore.listForMonth(parseInt(document.getElementById('f-year')?.value), parseInt(document.getElementById('f-month')?.value)) : {};
    const _bldgInfo = getBuildingInfo(currentBuilding);
    const _rooms = typeof getActiveRoomsWithMetadata==='function' ? getActiveRoomsWithMetadata(_bldgInfo.firebaseBuilding, _bldgInfo.metadataArray) : [];
    const _curIdx = _rooms.findIndex(r=>r.id===d.room);
    const _next = _rooms.slice(_curIdx+1).find(r=>!_paidMap[r.id]) || _rooms.slice(0,_curIdx).find(r=>!_paidMap[r.id]);
    const _rem = _rooms.filter(r=>!_paidMap[r.id]).length;
    _nextBtn.textContent = _next ? `→ ห้อง ${_next.id} (ยังค้าง ${_rem} ห้อง)` : '🎉 ทุกห้องชำระแล้ว';
  }, 200);
  const _hint = document.getElementById('billHint');
  if (_hint) {
    _hint.textContent = slipVerified && slipData
      ? `✅ ออกใบเสร็จแล้ว · ยืนยันสลิป ฿${slipData.amount.toLocaleString()} (${slipData.sender})`
      : '✅ ออกใบเสร็จเรียบร้อย';
  }
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
      <img id="qr-payment" src="" alt="QR PromptPay" style="width:160px;height:160px;border-radius:8px;border:4px solid ${DashColors.WHITE};box-shadow:0 3px 10px rgba(0,0,0,.15);">
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
    ? `<div style="margin:10px 0;padding:10px;background:#f8faf9;border:1px dashed ${DashColors.GREEN_BORDER};border-radius:6px;font-size:.85rem;">
         <div style="font-weight:600;color:var(--green-dark);margin-bottom:6px;">📄 ออกในนาม (นิติบุคคล)</div>
         <div class="d-row"><span>ชื่อบริษัท:</span><strong>${window._esc(_recipientCo.name || '-')}</strong></div>
         <div class="d-row"><span>เลขผู้เสียภาษี:</span><strong>${window._esc(_recipientCo.taxId || '-')}</strong></div>
         ${_recipientCo.address ? `<div class="d-row"><span>ที่อยู่:</span><span style="text-align:right;">${window._esc(_recipientCo.address)}</span></div>` : ''}
       </div>`
    : '';
  return`
  <div id="${docId}" class="doc-body" data-room="${d.room}" data-month="${d.month}" data-year="${d.year}">
    <div class="doc-header">
      <div class="doc-logo">${logoHTML}</div>
      <div class="doc-sub">${window._esc(d.building)}</div>
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
      ${d.lateFee>0?`<div class="d-row" style="color:${DashColors.RED_DEEP};"><span>⚠️ ค่าปรับ</span><span>฿${d.lateFee.toLocaleString()}</span></div>`:''}
      ${d.note?`<div class="d-row" style="font-size:.78rem;color:var(--accent);"><span>หมายเหตุ:</span><span>${window._esc(d.note)}</span></div>`:''}
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
    <button class="btn-doc-action ${isInvoice?'blue':'green'}" data-action="printDoc" data-id="${docId}">🖨️ พิมพ์ / บันทึก PDF</button>
  </div>`;
}

function resetBillFlow(){
  window.invoiceData=null; window.slipVerified=false; window.slipData=null;
  document.getElementById('invoicePanel').innerHTML=`<div class="doc-placeholder"><div class="icon">📄</div><div style="font-size:.9rem;font-weight:600;">กรอกข้อมูลและกด "ส่งใบวางบิล"</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 1 — แจ้งยอดก่อนชำระ</div></div>`;
  document.getElementById('receiptPanel').innerHTML=`<div class="doc-placeholder"><div class="icon">✅</div><div style="font-size:.9rem;font-weight:600;">กด "ออกใบเสร็จรับเงิน" หลังรับเงินแล้ว</div><div style="font-size:.77rem;margin-top:5px;">ขั้นตอนที่ 2 — ยืนยันการชำระเงิน</div></div>`;
  document.getElementById('btnReceipt').disabled=true;
  document.getElementById('btnReceipt').classList.add('u-op40');
  document.getElementById('btnReceipt').classList.add('u-no-ptr');
  const _invBtnR = document.querySelector('[data-action="generateInvoice"]');
  if(_invBtnR){ _invBtnR.textContent='📄 ส่งใบวางบิล'; _invBtnR.disabled=false; _invBtnR.classList.remove('u-op40','u-no-ptr'); }
  document.getElementById('billHint').textContent='ส่งใบวางบิลก่อน → อัปโหลดสลิป → ออกใบเสร็จรับเงิน';
  document.getElementById('step1').className='step active';
  const _sn1r = document.getElementById('step1').querySelector('.step-num');
  if(_sn1r) _sn1r.textContent='1';
  document.getElementById('step2').className='step pending';
  const _sn2r = document.getElementById('step2').querySelector('.step-num');
  if(_sn2r) _sn2r.textContent='2';
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
  // Carry the page's CSS into the popup. CRITICAL: keep each <style> block as its
  // OWN <style> tag, and bring external sheets (brand.css/components.css) as their
  // own <link>. Joining every inline <style> into ONE <style> corrupts parsing and
  // silently drops later rules — e.g. .d-row{display:flex} stops applying, so the
  // invoice "label … value" rows collapse together (verified: separate=flex,
  // joined=block). The external <link>s restore brand-token colours; data-theme
  // ="light" forces print-correct light tokens regardless of OS dark mode.
  const links=[...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>`<link rel="stylesheet" href="${l.href}">`).join('\n');
  const styles=[...document.querySelectorAll('style')].map(s=>`<style>${s.innerHTML}</style>`).join('\n');
  const fonts='<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
  const content=el.outerHTML;
  // Save-as-PDF default filename = room-MM-YY (2-digit BE year): e.g. 30-06-69,
  // N101-08-69. Chrome uses the print document's <title> as the suggested name.
  const _mm=String(el.dataset.month||'').padStart(2,'0');
  const _yy=String(el.dataset.year||'').slice(-2);
  const _docName=[el.dataset.room,_mm,_yy].filter(Boolean).join('-').replace(/[\/\\:*?"<>|]/g,'')||'document';
  const html=`<!DOCTYPE html><html lang="th" data-theme="light"><head><meta charset="UTF-8"><title>${_docName}</title>${fonts}
${links}
${styles}
<style>
/* Print overrides - let browser print dialog handle page size */
@page{margin:10mm;}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{background:${DashColors.WHITE}!important;padding:0;margin:0;}
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
    // Close the popup the moment the print dialog is dismissed. `afterprint` fires
    // for BOTH Save and Cancel — the browser never reveals which the user chose, so
    // closing on either is correct for a throwaway print popup (also fixes it
    // lingering after Cancel/Save). The OLD fixed 1s timer fired WHILE the dialog
    // was still open, so close() was blocked and the window then stayed open.
    let done=false;
    const closePopup=()=>{ if(done)return; done=true; try{ if(printWindow && !printWindow.closed) printWindow.close(); }catch(e){} printWindow=null; };
    try{ printWindow.onafterprint=closePopup; }catch(e){}
    try{printWindow.focus();printWindow.print();}catch(e){}
    setTimeout(closePopup, 120000); // safety net only — long enough to never fire mid-dialog
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

  const isRefunded = bill ? bill.status === 'refunded' : false;
  const isPaid = bill ? bill.status === 'paid' : !!(payEntry || legacyEntry);
  const p = payEntry || legacyEntry;
  const monthName=MONTHS_FULL[month2]||month2;

  document.getElementById('payModalTitle').textContent=`📋 ห้อง ${roomId} — ${monthName} ${year2}`;
  const body=document.getElementById('payModalBody');
  const footer=document.getElementById('payModalFooter');

  if(isRefunded){
    const refDate = bill.refundedAt
      ? new Date(bill.refundedAt).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'})
      : '—';
    body.innerHTML=`
      <div style="background:#f3e8ff;border:1px solid #d8b4fe;border-radius:8px;padding:.7rem .85rem;font-size:.84rem;line-height:1.7;color:#6b21a8;">
        ↩️ คืนเงินแล้ว · ${refDate}${bill.refundReason?`<br>เหตุผล: ${bill.refundReason}`:''}<br>
        ยอดที่คืน ฿${(bill.totalCharge||0).toLocaleString()}
      </div>
      <div style="font-size:.78rem;color:var(--text-muted);margin-top:.5rem;">บิลนี้ถูกกลับรายการ — ตัดออกจากรายได้แล้ว (ดูประวัติใน Audit log)</div>`;
    footer.innerHTML=`<button class="pm-btn gray" data-action="closePayModal">ปิด</button>`;
  } else if(isPaid){
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
      <button class="pm-btn green" data-action="savePayEdit">💾 บันทึกมิเตอร์</button>
      <button class="pm-btn red" data-action="resetRoomPayment">🔄 รีเซ็ตกลับ "ยังไม่จ่าย"</button>
      <button class="pm-btn" style="background:#7c3aed;color:#fff;" data-action="refundBill" data-id="${roomId}" data-year="${year2}" data-month="${month2}">↩️ คืนเงิน</button>
      <button class="pm-btn gray" data-action="closePayModal">ปิด</button>`;
  } else {
    body.innerHTML=`
      <div style="background:${DashColors.ORANGE_BG};border-radius:8px;padding:.75rem;font-size:.84rem;color:${DashColors.ORANGE_DEEP};margin-bottom:.5rem;">
        ⏳ ยังไม่ได้ชำระ — ${monthName} ${year2}
      </div>
      <div style="font-size:.86rem;color:var(--text-muted);text-align:center;padding:.9rem 0;">
        คลิก "ออกบิล" เพื่อเปิดฟอร์มออกใบวางบิลห้องนี้
      </div>`;
    footer.innerHTML=`
      <button class="pm-btn blue" data-action="goBillFromTable" data-id="${roomId}" data-year="${year2}" data-month="${month2}">📄 ออกบิลห้อง ${roomId}</button>
      <button class="pm-btn gray" data-action="closePayModal">ปิด</button>`;
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
  window.ghConfirm(`รีเซ็ตห้อง ${payModalRoomId} กลับเป็น "ยังไม่ชำระ"? ข้อมูลใบเสร็จจะถูกลบออก`, { danger: true }).then(ok => {
    if (!ok) return;
    _doResetRoomPayment();
  });
}

function _doResetRoomPayment() {
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
  // The ออกบิล grid + PaymentStore read verifiedSlips (Firestore) as SoT — flipping the RTDB
  // bill + clearing localStorage isn't enough: the global subscription re-ingests the slip
  // (and re-mirrors it into payment_status), so the room re-appears as ✅. Delete the
  // verifiedSlips doc(s) too. Args captured now so closePayModal()'s state reset can't blank them.
  _deleteVerifiedSlipsForRoomMonth(/^[Nn]\d/.test(payModalRoomId) ? 'nest' : 'rooms', String(payModalRoomId), payModalYear, payModalMonth);
  closePayModal();
  renderPaymentStatus();
  renderMeterTable();
}

// Delete every verifiedSlips doc for a room+month — the manual/cash deterministic id AND any
// SlipOK doc (transactionId id) whose timestamp falls in that month — then drop the
// PaymentStore cache + legacy mirror and re-render. Lets a reset truly clear the paid signal.
async function _deleteVerifiedSlipsForRoomMonth(bld, room, year, month) {
  try {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    const yBE = Number(year) < 2400 ? Number(year) + 543 : Number(year);
    const m = Number(month);
    const ids = new Set([
      `manual_${bld}_${room}_${year}_${month}`,
      `manual_${bld}_${room}_${yBE}_${m}`,
    ]);
    // SlipOK docs key on the transactionId — find them by room + the month derived from timestamp.
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'verifiedSlips'), fs.where('room', '==', room)));
      snap.forEach(docSnap => {
        const s = docSnap.data() || {};
        const ts = s.timestamp?.toDate ? s.timestamp.toDate() : (s.date ? new Date(s.date) : null);
        if (ts && (ts.getFullYear() + 543) === yBE && (ts.getMonth() + 1) === m) ids.add(docSnap.id);
      });
    } catch (e) { console.warn('[resetRoomPayment] verifiedSlips query failed:', e?.message || e); }
    await Promise.allSettled([...ids].map(id => fs.deleteDoc(fs.doc(fs.collection(db, 'verifiedSlips'), id))));
    // Update the in-memory cache + legacy mirror immediately so the grid refreshes without a reload.
    try { window.PaymentStore?._remove?.(yBE, m, room); } catch (_) {}
    try {
      const ps = loadPS();
      [`${year}_${month}`, `${yBE}_${m}`].forEach(kk => {
        if (ps[kk]?.[room]) { delete ps[kk][room]; if (!Object.keys(ps[kk]).length) delete ps[kk]; }
      });
      savePS(ps);
    } catch (_) {}
    try { window.PaymentStore?._notify?.(); } catch (_) {}
    if (typeof renderPaymentStatus === 'function') renderPaymentStatus();
  } catch (e) { console.warn('[resetRoomPayment] verifiedSlips cleanup failed:', e?.message || e); }
}

// ── P1 UX: Filter + Batch invoice ─────────────────────────────────────────────

/** Toggle grid to show only unpaid rooms */
let _billFilterUnpaid = false;
function toggleUnpaidFilter(){
  _billFilterUnpaid = !_billFilterUnpaid;
  const grid = document.getElementById('billRoomGrid');
  const btn  = document.getElementById('btnFilterUnpaid');
  if(grid) grid.dataset.filter = _billFilterUnpaid ? 'unpaid' : '';
  if(btn){
    btn.textContent = _billFilterUnpaid ? '⏳ ยังไม่ชำระ' : 'ทั้งหมด';
    btn.classList.toggle('active', _billFilterUnpaid);
  }
}
window.toggleUnpaidFilter = toggleUnpaidFilter;

/** Build bill data for a room purely from in-memory data (no DOM reads) */
async function _buildBillDataForRoom(room, month, year){
  const bldgInfo = getBuildingInfo(currentBuilding);
  const fbBld    = bldgInfo.firebaseBuilding;

  // Meter data via MeterStore
  let md = await MeterStore.get(fbBld, year, month, room.id);
  if(!md){
    // fallback: try previous month as eOld baseline
    const prevD = await MeterStore.getPrev(fbBld, year, month, room.id);
    if(prevD) md = { eNew:'', eOld:prevD.eNew, wNew:'', wOld:prevD.wNew };
  }

  const eOld  = md ? (md.eOld ?? 0) : 0;
  const eNew  = md ? (md.eNew ?? 0) : 0;
  const wOld  = md ? (md.wOld ?? 0) : 0;
  const wNew  = md ? (md.wNew ?? 0) : 0;
  const eRate = room.elecRate || 8;
  const wRate = 20;
  const rent  = room.rentPrice || 0;
  const trash = room.trashFee || 20;

  const eUnits = Math.max(0, eNew - eOld);
  const wUnits = Math.max(0, wNew - wOld);
  const eCost  = eUnits * eRate;
  const wCost  = wUnits * wRate;
  const total  = rent + eCost + wCost + trash;

  // Skip rooms with no new meter reading yet
  if(!md || (eNew === 0 && wNew === 0 && eOld === 0)) return null;

  const now     = new Date();
  const dateStr = now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
  const no      = `TGH-${year}${String(month).padStart(2,'0')}-${room.id.replace(/[^0-9ก-๙A-Za-z]/g,'')}-${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

  return { room:room.id, building:fbBld, rent, rentLabel:'ค่าเช่าห้อง',
    eNew, eOld, eUnits, eRate, eCost, wNew, wOld, wUnits, wRate, wCost,
    trash, other:0, lateFee:0, total, month, year:String(year), note:'', no, dateStr, now };
}

/** Batch-send invoices for all unpaid rooms that have meter data */
let _batchRunning = false;
async function batchSendInvoices(){
  if(_batchRunning){ showToast('กำลังส่งอยู่ กรุณารอ...','warning'); return; }

  const month    = parseInt(document.getElementById('f-month').value);
  const year     = parseInt(document.getElementById('f-year').value);
  const bldgInfo = getBuildingInfo(currentBuilding);
  const fbBld    = bldgInfo.firebaseBuilding;
  const rooms    = typeof getActiveRoomsWithMetadata==='function'
    ? getActiveRoomsWithMetadata(fbBld, bldgInfo.metadataArray) : [];
  const paidMap  = typeof PaymentStore!=='undefined' ? PaymentStore.listForMonth(year, month) : {};
  const unpaid   = rooms.filter(r => !paidMap[r.id]);

  if(!unpaid.length){ showToast('ทุกห้องชำระแล้ว 🎉','success'); return; }

  _batchRunning = true;
  const btn = document.getElementById('btnBatchInvoice');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }

  let sent = 0, skipped = 0;
  for(const room of unpaid){
    const d = await _buildBillDataForRoom(room, month, year);
    if(!d || d.total === 0){ skipped++; continue; }

    // Audit log (same as single invoice)
    if(window.logBillGenerated){
      window.logBillGenerated(d.room, d.total, { invoiceNumber:d.no, building:d.building, month:d.month, year:d.year });
    }
    sent++;
    if(btn) btn.textContent = `⏳ ส่งแล้ว ${sent}/${unpaid.length - skipped} ห้อง...`;
    await new Promise(r => setTimeout(r, 120)); // small stagger for audit writes
  }

  _batchRunning = false;
  if(btn){ btn.disabled = false; btn.textContent = '📤 ส่งใบวางบิลทั้งหมด (ห้องค้างชำระ)'; }

  const msg = skipped
    ? `✅ บันทึกแล้ว ${sent} ห้อง (ข้าม ${skipped} ห้องที่ไม่มีข้อมูลมิเตอร์)`
    : `✅ บันทึกใบวางบิลครบ ${sent} ห้อง`;
  showToast(msg, 'success');
}
window.batchSendInvoices = batchSendInvoices;

// ── P2 UX: Auto-on unpaid filter on page load ─────────────────────────────────
// Start every session in "ยังไม่ชำระ" mode so admin sees outstanding rooms first
(function _autoEnableUnpaidFilter(){
  function _try(){
    if(!document.getElementById('billRoomGrid')) return; // billing section not in DOM yet
    if(!_billFilterUnpaid) toggleUnpaidFilter();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(_try, 900));
  } else {
    setTimeout(_try, 900);
  }
})();

// Keyboard Enter flow removed — meter readings are read-only from database

// ── P0 UX: Rate field toggle (⚙️ แก้อัตรา) ──────────────────────────────────
function toggleRateEdit(){
  const cards=document.querySelectorAll('.bill-meter-card');
  cards.forEach(card=>{
    const chip=card.querySelector('.bm-rate-chip');
    const input=card.querySelector('.bm-rate-input');
    if(!chip||!input) return;
    const opening=!chip.classList.contains('u-hidden');
    // toggle: chip ↔ input
    chip.classList.toggle('u-hidden', opening);
    input.classList.toggle('u-hidden', !opening);
    if(opening){ input.removeAttribute('tabindex'); setTimeout(()=>input.focus(),50); }
    else input.setAttribute('tabindex','-1');
  });
}
window.toggleRateEdit=toggleRateEdit;

// ── Keyboard accessibility ────────────────────────────────────────────────
document.addEventListener('keydown', function(e){
  // Space on room card → click it
  if(e.key === ' '){
    const card = e.target.closest('.bill-room-card');
    if(card){ e.preventDefault(); card.click(); return; }
  }
  // Enter in extras inputs → move to next field, last one focuses invoice btn
  if(e.key === 'Enter'){
    const ORDER = ['f-trash','f-other','f-latefee'];
    const idx = ORDER.indexOf(e.target.id);
    if(idx !== -1){
      e.preventDefault();
      const nextId = ORDER[idx+1];
      if(nextId) document.getElementById(nextId)?.focus();
      else document.querySelector('[data-action="generateInvoice"]:not([disabled])')?.focus();
    }
  }
});

