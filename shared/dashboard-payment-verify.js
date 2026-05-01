// ===== PAYMENT VERIFICATION =====

// Navigate to bill page → ตรวจสลิป → ประวัติตามห้อง, pre-filtered to roomId
window.goToRoomPayHistory = function(roomId) {
  const bld = /^[Nn]\d/.test(String(roomId)) ? 'nest' : 'rooms';
  window.showPage('bill');
  const verifyBtn = document.getElementById('bill-main-tab-btn-verify');
  if (typeof switchBillingMainTab === 'function') switchBillingMainTab('verify', verifyBtn);
  const histBtn = document.getElementById('pv-tab-history-btn');
  if (typeof switchPVTab === 'function') switchPVTab('history', histBtn);
  setTimeout(() => {
    const bldSel = document.getElementById('pvh-building');
    if (bldSel) { bldSel.value = bld; }
    if (typeof window.loadPVHistoryRooms === 'function') window.loadPVHistoryRooms();
    setTimeout(() => {
      const roomSel = document.getElementById('pvh-room');
      if (roomSel) roomSel.value = String(roomId);
      if (typeof window.renderPVHistory === 'function') window.renderPVHistory();
    }, 60);
  }, 80);
};

function loadTenantPayments(){
  return JSON.parse(localStorage.getItem('tenant_payments')||'[]');
}

function saveTenantPayments(data){
  localStorage.setItem('tenant_payments',JSON.stringify(data));
}

// ===== PAYMENT VERIFICATION — Firestore real-time feed =====
let _pvUnsubscribe = null;
window._pvFilter = 'today';

window._pvCachedSlips = [];

// Flatten payment_status (manual "paid" entries from bill flow) into slip-like objects
function _pvLoadManualPayments(){
  const ps = loadPS();
  const out = [];
  Object.keys(ps).forEach(yearMonth => {
    const [year, month] = yearMonth.split('_').map(Number);
    const byRoom = ps[yearMonth] || {};
    Object.keys(byRoom).forEach(room => {
      const p = byRoom[room];
      if(!p || p.status !== 'paid') return;
      const bld = detectBuildingFromRoomId(room);
      const tsSource = p.slip?.transferDate || p.date || `${year}-${String(month).padStart(2,'0')}-05`;
      out.push({
        id: `ps_${yearMonth}_${room}`,
        building: bld,
        room: String(room),
        amount: p.amount || p.slip?.amount || 0,
        expectedAmount: p.amount || 0,
        sender: p.slip?.sender || '(บันทึกโดย admin)',
        receiver: p.slip?.receiver || '',
        bankCode: p.slip?.bankCode || '',
        transactionId: p.receiptNo || p.slip?.ref || '',
        timestamp: new Date(tsSource),
        verifiedAt: new Date(p.date || tsSource),
        source: 'manual'
      });
    });
  });
  return out;
}

function _pvMergeSlips(firestoreSlips){
  const manual = _pvLoadManualPayments();
  const byKey = new Map();
  // Firestore wins (has the real slip data). Dedupe by transactionId + room + amount + approximate time.
  firestoreSlips.forEach(s => {
    const k = `${s.building}|${s.room}|${s.transactionId || s.id}`;
    byKey.set(k, s);
  });
  manual.forEach(s => {
    const k = `${s.building}|${s.room}|${s.transactionId || s.id}`;
    if(!byKey.has(k)) byKey.set(k, s);
  });
  return Array.from(byKey.values());
}

function initPaymentVerify() {
  if (_pvUnsubscribe) { _pvUnsubscribe(); _pvUnsubscribe = null; }

  const feed = document.getElementById('pvFeed');
  if (!feed) return;
  feed.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">🔄 กำลังโหลด...</div>';

  // Perf #1: prefer the global verifiedSlips listener (dashboard-bill.js) when
  // it's already warm — avoids opening a second Firestore onSnapshot on the
  // same collection. Falls through to direct subscribe if the global cache
  // hasn't been populated yet (rare: user opens Payment Verify within the
  // first ~800ms of page load before _subscribeGlobalVerifiedSlips runs).
  const renderFromList = (firestoreSlips) => {
    const slips = _pvMergeSlips(firestoreSlips || []);
    window._pvCachedSlips = slips;
    updatePVStats(slips);
    renderPVFeed(slips);
  };

  if (Array.isArray(window._verifiedSlipsRawCache)) {
    renderFromList(window._verifiedSlipsRawCache);
    const handler = (e) => renderFromList(e.detail);
    window.addEventListener('verified-slips-updated', handler);
    _pvUnsubscribe = () => window.removeEventListener('verified-slips-updated', handler);
    return;
  }

  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    feed.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ Firebase ยังไม่พร้อม</div>';
    return;
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const q = fs.query(fs.collection(db, 'verifiedSlips'), fs.orderBy('timestamp', 'desc'), fs.limit(300));
  _pvUnsubscribe = fs.onSnapshot(q, snapshot => {
    renderFromList(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => {
    console.error('pv onSnapshot:', err);
    const manual = _pvLoadManualPayments();
    window._pvCachedSlips = manual;
    updatePVStats(manual);
    renderPVFeed(manual);
    if(!manual.length) feed.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ ${err.message}</div>`;
  });
}

function setPVFilter(filter, btn) {
  window._pvFilter = filter;
  // Only clear active on date-filter row (keep tab active state)
  document.querySelectorAll('#pv-tab-live .year-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const slips = window._pvCachedSlips || [];
  updatePVStats(slips);
  renderPVFeed(slips);
}

function _pvEscape(text) {
  const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
  return String(text == null ? '' : text).replace(/[&<>"']/g, m => map[m]);
}

function _pvInRange(slip) {
  const ts = slip.timestamp?.toDate ? slip.timestamp.toDate() : new Date(slip.timestamp || slip.verifiedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart - 6 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const f = window._pvFilter || 'today';
  if (f === 'today')  return ts >= todayStart;
  if (f === 'week')   return ts >= weekStart;
  if (f === 'month')  return ts >= monthStart;
  return true; // 'all'
}

function updatePVStats(slips) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = s => s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.verifiedAt);
  const todaySlips = slips.filter(s => toDate(s) >= todayStart);
  const monthSlips = slips.filter(s => toDate(s) >= monthStart);
  const monthTotal = monthSlips.reduce((sum, s) => sum + (s.amount || 0), 0);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pv-today-count', todaySlips.length);
  set('pv-month-count', monthSlips.length);
  set('pv-month-total', '฿' + monthTotal.toLocaleString());
  // Update notification badge
  const badge = document.getElementById('paymentBadge');
  if (badge) { badge.classList.add('u-hidden'); }
}

function renderPVFeed(slips) {
  const feed = document.getElementById('pvFeed');
  if (!feed) return;
  const filtered = slips.filter(_pvInRange);
  if (filtered.length === 0) {
    feed.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--text-muted);">📭 ยังไม่มีการโอนในช่วงนี้</div>';
    return;
  }
  const bankName = code => ({'004':'กสิกรไทย','014':'ไทยพาณิชย์','025':'กรุงไทย','002':'กรุงเทพ','006':'กรุงศรี','011':'TMB','065':'ทิสโก้','069':'เกียรตินาคิน','022':'CIMB','067':'ทีทีบี'})[code] || (code || '—');
  feed.innerHTML = filtered.map(s => {
    const ts = s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.verifiedAt);
    const timeStr = ts.toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const amountOk = !s.expectedAmount || Math.abs(s.amount - s.expectedAmount) < 1;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="background:${amountOk ? 'var(--green-pale)' : '#fff3e0'};color:${amountOk ? 'var(--green-dark)' : '#e65100'};border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${amountOk ? '✅' : '⚠️'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.9rem;">ห้อง <span style="color:var(--green-dark);">${_pvEscape(s.room || '—')}</span> <span style="color:var(--text-muted);font-size:.78rem;">${_pvEscape(s.building || '')}</span></div>
        <div style="font-size:.78rem;color:var(--text-muted);">โดย ${_pvEscape(s.sender || '—')} · ${_pvEscape(bankName(s.bankCode))}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-weight:800;color:var(--green-dark);font-size:.95rem;">฿${(s.amount||0).toLocaleString()}</div>
        <div style="font-size:.72rem;color:var(--text-muted);">${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

// ===== Payment Verify — Manual verify override =====
window.openManualVerifyModal = function(){
  if(document.getElementById('mv-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'mv-modal';
  modal.className = 'u-modal-overlay';
  const today = new Date().toISOString().split('T')[0];
  modal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:1.8rem;width:92%;max-width:520px;max-height:92vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.15rem;font-weight:800;margin-bottom:1rem;color:var(--text);">✍️ บันทึกการชำระด้วยตัวเอง</div>
    <div style="background:#ffebee;border-left:4px solid #c62828;border-radius:6px;padding:.7rem 1rem;margin-bottom:1rem;font-size:.82rem;color:#b71c1c;">
      <strong>⚠️ สำคัญ:</strong> อย่ากดบันทึกถ้ายังไม่ได้เช็ค bank statement จริง<br>
      สลิปอาจปลอมได้ — ต้องเปิดแอปธนาคารยืนยันว่าเงินเข้าบัญชีจริง
    </div>
    <label style="display:flex;gap:8px;align-items:flex-start;padding:.7rem;background:#fff9c4;border-radius:6px;margin-bottom:1rem;cursor:pointer;">
      <input type="checkbox" id="mv-bank-confirmed" style="margin-top:3px;flex-shrink:0;">
      <span style="font-size:.82rem;color:#5d4037;font-weight:600;">
        ✅ ผมได้เปิดแอปธนาคาร/bank statement แล้วว่าเงินเข้าบัญชีจริง
        (ตรวจ amount, วันที่, ชื่อผู้โอน ตรงกับสลิป)
      </span>
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem;">
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">ตึก</label>
        <select id="mv-building" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';">
          <option value="rooms">🏠 ห้องแถว</option><option value="nest">🏢 Nest</option>
        </select></div>
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">ห้อง</label>
        <input type="text" id="mv-room" placeholder="เช่น 15, N101" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem;">
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">จำนวนเงิน (บาท)</label>
        <input type="number" id="mv-amount" placeholder="0" min="0" step="0.01" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">วันที่โอน</label>
        <input type="date" id="mv-date" value="${today}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem;">
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">ผู้โอน</label>
        <input type="text" id="mv-sender" placeholder="ชื่อ-นามสกุล" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
      <div><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">ธนาคาร</label>
        <select id="mv-bank" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';">
          <option value="">— เลือก —</option>
          <option value="014">ไทยพาณิชย์ (SCB)</option>
          <option value="004">กสิกรไทย (KBANK)</option>
          <option value="025">กรุงไทย (KTB)</option>
          <option value="002">กรุงเทพ (BBL)</option>
          <option value="006">กรุงศรี (BAY)</option>
          <option value="067">ทีทีบี (TTB)</option>
          <option value="">อื่นๆ</option>
        </select></div>
    </div>
    <div style="margin-bottom:.7rem;"><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">เลขอ้างอิงสลิป (ถ้าอ่านได้)</label>
      <input type="text" id="mv-txid" placeholder="เช่น 2024...หรือ ref number" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
    <div style="margin-bottom:1.2rem;"><label style="font-weight:600;font-size:.82rem;display:block;margin-bottom:4px;">เหตุผลการยืนยันเอง <span style="color:var(--red);">*</span></label>
      <input type="text" id="mv-reason" placeholder="เช่น SlipOK SCB delay ยาว, สลิปไม่คมชัด, มีค่าปรับที่ไม่ได้บันทึก..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:'Sarabun';"></div>
    <div style="display:flex;gap:.6rem;">
      <button onclick="submitManualVerify()" style="flex:1;background:var(--green);color:#fff;border:none;border-radius:8px;padding:10px;font-family:'Sarabun';font-weight:700;cursor:pointer;">💾 บันทึก</button>
      <button onclick="document.getElementById('mv-modal').remove()" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:8px;padding:10px;font-family:'Sarabun';font-weight:700;cursor:pointer;">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target.id==='mv-modal') modal.remove(); });
};

window.submitManualVerify = async function(){
  const building = document.getElementById('mv-building').value;
  const room = document.getElementById('mv-room').value.trim();
  const amount = parseFloat(document.getElementById('mv-amount').value);
  const dateStr = document.getElementById('mv-date').value;
  const sender = document.getElementById('mv-sender').value.trim();
  const bankCode = document.getElementById('mv-bank').value;
  const txid = document.getElementById('mv-txid').value.trim();
  const reason = document.getElementById('mv-reason').value.trim();
  const bankConfirmed = document.getElementById('mv-bank-confirmed')?.checked;
  if(!bankConfirmed){
    alert('⚠️ ต้องเช็ค bank statement จริงก่อน แล้วกด ✅ ยืนยัน\nสลิปอาจปลอมได้ — อย่าเชื่อแค่ภาพสลิป');
    return;
  }
  if(!building || !room || !amount || amount <= 0 || !reason){
    alert('กรุณากรอก: ตึก, ห้อง, จำนวนเงิน, เหตุผล');
    return;
  }
  const adminName = window.SecurityUtils?.getSecureSession()?.name || 'Admin';
  const id = 'mv_' + Date.now();
  const slipDoc = {
    transactionId: txid || id,
    building, room: String(room),
    amount, expectedAmount: amount,
    sender: sender || '(บันทึกโดย admin)',
    receiver: '',
    date: dateStr,
    bankCode: bankCode || '',
    timestamp: new Date(dateStr + 'T12:00:00'),
    verifiedAt: new Date(),
    verified: true,
    manualOverride: true,
    bankStatementConfirmed: true,
    verifiedBy: adminName,
    overrideReason: reason
  };
  if(!window.firebase?.firestore){
    alert('Firebase ยังไม่พร้อม — ไม่สามารถบันทึกได้');
    return;
  }
  try {
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    await fs.setDoc(fs.doc(fs.collection(db, 'verifiedSlips'), id), slipDoc);
    // Also mark payment_status for that month (so สถานะชำระรายเดือน shows ✅)
    const d = new Date(dateStr);
    const year = d.getFullYear() + 543;
    const month = d.getMonth() + 1;
    const ps = loadPS();
    const key = `${year}_${month}`;
    if(!ps[key]) ps[key] = {};
    ps[key][room] = {
      status: 'paid', amount, date: new Date().toISOString(),
      receiptNo: id, manualOverride: true, overrideReason: reason,
      slip: { amount, sender, bankCode, ref: txid, transferDate: d.toISOString() }
    };
    savePS(ps);
    document.getElementById('mv-modal').remove();
    alert('✅ บันทึกการชำระเรียบร้อย');
  } catch(e) {
    alert('❌ บันทึกไม่สำเร็จ: ' + e.message);
  }
};

// ===== Payment Verify — ประวัติตามห้อง =====
window.switchPVTab = function(tab, btn){
  document.querySelectorAll('#bill-main-tab-verify .year-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const live    = document.getElementById('pv-tab-live');
  const hist    = document.getElementById('pv-tab-history');
  const monthly = document.getElementById('pv-tab-monthly');
  // Static HTML ships hist/monthly with inline display:none. Clear it so the class wins.
  [live, hist, monthly].forEach(el => { if (el && el.style.display) el.style.display = ''; });
  if(live)    live.classList.toggle('u-hidden', !((tab==='live')));
  if(hist)    hist.classList.toggle('u-hidden', !((tab==='history')));
  if(monthly) monthly.classList.toggle('u-hidden', !((tab==='monthly')));
  if(tab==='monthly'){
    const now = new Date();
    const mm = document.getElementById('mt-month');
    const my = document.getElementById('mt-year');
    const vm = document.getElementById('vc-month');
    const vy = document.getElementById('vc-year');
    if (mm && !mm.value) mm.value = now.getMonth() + 1;
    if (my && !my.value) my.value = now.getFullYear() + 543;
    if (vm && !vm.value) vm.value = now.getMonth() + 1;
    if (vy && !vy.value) vy.value = now.getFullYear() + 543;
    // Prefill tracking-start UI
    const t = window.loadTrackingStart?.();
    const tm = document.getElementById('tracking-start-month');
    const ty = document.getElementById('tracking-start-year');
    const info = document.getElementById('tracking-start-info');
    if (tm && ty) {
      if (t) {
        tm.value = t.month;
        ty.value = t.year;
        if (info) info.textContent = `บันทึกล่าสุด: ${t.month}/${t.year}`;
      } else {
        tm.value = now.getMonth() + 1;
        ty.value = now.getFullYear() + 543;
        if (info) info.textContent = 'ยังไม่ได้ตั้งค่า';
      }
    }
    if (typeof renderMeterTable === 'function') setTimeout(renderMeterTable, 50);
  }
};

window.loadPVHistoryRooms = function(){
  const building = document.getElementById('pvh-building').value;
  const roomSel = document.getElementById('pvh-room');
  roomSel.innerHTML = '<option value="">-- เลือกห้อง --</option>';
  if(!building) return;
  let roomNumbers = [];
  try {
    if(window.RoomConfigManager?.getAllRooms){
      const rooms = window.RoomConfigManager.getAllRooms(building) || {};
      roomNumbers = Object.keys(rooms).sort((a,b)=>parseInt(a)-parseInt(b));
    }
  } catch(e){}
  if(roomNumbers.length===0){
    const list = (building==='rooms') ? (window.ROOMS_OLD||[]) : (window.ROOMS_NEW||[]);
    roomNumbers = list.map(r => typeof r === 'object' ? r.id : String(r));
  }
  roomNumbers.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = 'ห้อง '+r;
    roomSel.appendChild(opt);
  });
};

// ─── Unified Bill + Slip History Table (BillStore / RTDB + verifiedSlips) ────
const _MONTHS_TH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
let _pvhBillStoreUnsub = null;
let _pvhLastSlips = [];  // cache so BillStore.onChange re-renders with same slips

function _renderPVHBillTable(building, room, slips) {
  // Cache slips so BillStore.onChange re-renders reuse the last known set
  if (slips !== undefined) _pvhLastSlips = slips;
  const effectiveSlips = _pvhLastSlips;

  const tbl = document.getElementById('pvhBillTable');
  if (!tbl) return;

  if (!building || !room) {
    tbl.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--text-muted);">กรุณาเลือกห้อง</div>';
    return;
  }

  // Subscribe BillStore once so RTDB data triggers a re-render
  if (typeof window.BillStore !== 'undefined' && !_pvhBillStoreUnsub) {
    _pvhBillStoreUnsub = window.BillStore.onChange(() => _renderPVHBillTable(
      document.getElementById('pvh-building')?.value,
      document.getElementById('pvh-room')?.value
    ));
  }

  const now = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ m: d.getMonth() + 1, y: d.getFullYear() + 543 });
  }

  const beYear = now.getFullYear() + 543;
  let allBills = [];
  if (typeof window.BillStore !== 'undefined') {
    // getByRoom uses _cache[bld][room] directly — bill docs in RTDB have no 'room' field
    // so listForYear + filter would always return [] (filter on undefined)
    [beYear, beYear - 1].forEach(y => {
      allBills.push(...(window.BillStore.getByRoom(building, room, String(y)) || []));
    });
  }

  if (allBills.length === 0 && typeof window.BillStore === 'undefined') {
    tbl.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--text-muted);">⚠️ BillStore ยังไม่พร้อม</div>';
    return;
  }

  // Index slips by BE month-year so each row can show its payment evidence
  const slipsByMonth = {};
  effectiveSlips.forEach(s => {
    const ts = s.timestamp?.toDate ? s.timestamp.toDate()
      : (s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp || s.verifiedAt || 0));
    const sm = ts.getMonth() + 1;
    const sy = ts.getFullYear() + 543;
    const key = `${sy}_${sm}`;
    if (!slipsByMonth[key]) slipsByMonth[key] = [];
    slipsByMonth[key].push({ ...s, _ts: ts });
  });

  const curM = now.getMonth() + 1;
  const _fmtDate = d => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

  const rows = months.map(({m, y}) => {
    const bill = allBills.find(b => Number(b.month) === m && Number(b.year) === y);
    const monthSlips = (slipsByMonth[`${y}_${m}`] || []).sort((a, b) => b._ts - a._ts);
    const slip = monthSlips[0] || null;

    if (!bill && !slip) {
      return `<tr>
        <td style="padding:6px 8px;font-weight:600;">${_MONTHS_TH[m]} ${String(y).slice(-2)}</td>
        <td colspan="5" style="padding:6px 8px;color:var(--text-muted);text-align:center;font-size:.8rem;">ไม่มีบิล</td>
      </tr>`;
    }

    // Past months default to paid — meter data exists means billing was processed
    const isPast = (y < beYear) || (y === beYear && m < curM);
    const isPaid = (bill?.status === 'paid') || !!slip || isPast;
    const rent  = Number(bill?.charges?.rent || 0);
    const utils = Number((bill?.charges?.electric?.cost || 0) + (bill?.charges?.water?.cost || 0));
    const total = Number(bill?.totalCharge || (rent + utils) || slip?.amount || 0);

    const statusHtml = isPaid
      ? '<span style="color:#388e3c;font-weight:700;">✅ ชำระแล้ว</span>'
      : '<span style="color:#f57c00;font-weight:700;">⏳ ค้างชำระ</span>';

    const evidenceHtml = slip
      ? `<div style="font-size:.76rem;color:#388e3c;font-weight:600;">${_pvEscape(slip.sender || '—')}</div>
         <div style="font-size:.7rem;color:var(--text-muted);">${_fmtDate(slip._ts)}</div>`
      : '';

    return `<tr style="background:${isPaid ? 'var(--green-pale)' : '#fff8e1'};">
      <td style="padding:6px 8px;font-weight:600;">${_MONTHS_TH[m]} ${String(y).slice(-2)}</td>
      <td style="padding:6px 8px;text-align:right;">฿${rent.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;">฿${utils.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;color:var(--green-dark);">฿${total.toLocaleString()}</td>
      <td style="padding:6px 8px;">${statusHtml}</td>
      <td style="padding:6px 8px;line-height:1.4;">${evidenceHtml}</td>
    </tr>`;
  }).join('');

  tbl.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:var(--green-pale);font-size:.78rem;color:var(--text-muted);">
      <th style="padding:6px 8px;text-align:left;">เดือน</th>
      <th style="padding:6px 8px;text-align:right;">ค่าเช่า</th>
      <th style="padding:6px 8px;text-align:right;">น้ำ/ไฟ</th>
      <th style="padding:6px 8px;text-align:right;">รวม</th>
      <th style="padding:6px 8px;">สถานะ</th>
      <th style="padding:6px 8px;">หลักฐาน</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

window.renderPVHistory = function(){
  const building = document.getElementById('pvh-building').value;
  const room     = document.getElementById('pvh-room').value;
  const setTxt   = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Render bill table immediately (BillStore is sync after initial RTDB load)
  _renderPVHBillTable(building, room);

  if (!building || !room) {
    setTxt('pvh-total-count','—'); setTxt('pvh-total-amount','฿—'); setTxt('pvh-last-paid','—');
    return;
  }

  const _ts = s => s.timestamp?.toDate ? s.timestamp.toDate()
    : (s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp || s.verifiedAt || 0));

  // Collect, filter, dedupe slips then merge into the bill table
  const processSlips = (slipsSource) => {
    const roomVals = new Set([String(room), String(Number(room))].filter(v => v !== 'NaN'));
    const fromSource = slipsSource.filter(s => {
      if (!roomVals.has(String(s.room))) return false;
      if (s.building && s.building !== building) return false;
      return true;
    });
    const manual = _pvLoadManualPayments().filter(s => s.building === building && s.room === String(room));

    const byKey = new Map();
    fromSource.forEach(s => byKey.set(s.transactionId || s.id || `s_${_ts(s).getTime()}`, s));
    manual.forEach(s => { const k = s.transactionId || s.id || `m_${_ts(s).getTime()}`; if (!byKey.has(k)) byKey.set(k, s); });
    const slips = Array.from(byKey.values()).sort((a, b) => _ts(b) - _ts(a));

    // Update summary stats from slip records
    const total = slips.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    setTxt('pvh-total-count', slips.length || 0);
    setTxt('pvh-total-amount', slips.length ? '฿' + total.toLocaleString() : '฿—');
    setTxt('pvh-last-paid', slips.length
      ? _ts(slips[0]).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
      : '—');

    // Re-render table with slip evidence per month
    _renderPVHBillTable(building, room, slips);
  };

  // Fast path: global in-memory cache from _subscribeGlobalVerifiedSlips
  if (Array.isArray(window._verifiedSlipsRawCache) && window._verifiedSlipsRawCache.length > 0) {
    processSlips(window._verifiedSlipsRawCache);
    return;
  }

  // Fallback: Firestore — filter by room only (not building — null field causes exclusion)
  if (!window.firebase?.firestore) { return; }
  const db    = window.firebase.firestore();
  const fsLib = window.firebase.firestoreFunctions;
  const roomVals = [String(room), Number(room)].filter(v => !Number.isNaN(Number(v)));
  const q = fsLib.query(
    fsLib.collection(db, 'verifiedSlips'),
    fsLib.where('room', 'in', roomVals),
    fsLib.limit(500)
  );
  fsLib.getDocs(q)
    .then(snap => processSlips(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    .catch(() => processSlips([]));
};

function updateLinkPreview(){
  const room = document.getElementById('linkRoomSelect').value;
  if(!room){
    document.getElementById('linkPreview').innerHTML = '';
    return;
  }

  const paymentLink = `${window.location.origin}/payment?room=${room}`;
  const qrId = 'qr-' + room;

  document.getElementById('linkPreview').innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:1.5rem;margin-top:1rem;">
      <div style="margin-bottom:1.5rem;">
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📱 ลิ้งค์ชำระเงิน:</label>
        <div style="background:#f5f5f5;padding:10px;border-radius:6px;word-break:break-all;font-size:.9rem;font-family:monospace;margin-bottom:10px;">
          ${paymentLink}
        </div>
        <button onclick="copyToClipboard('${paymentLink}')" style="padding:8px 16px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">📋 คัดลอก</button>
      </div>

      <div>
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📲 QR Code:</label>
        <div style="background:#f5f5f5;border-radius:6px;padding:1rem;text-align:center;" id="${qrId}"></div>
        <button onclick="downloadQRCode('${qrId}', 'payment-room-${room}')" style="width:100%;margin-top:10px;padding:8px 16px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">⬇️ ดาวน์โหลด QR Code</button>
      </div>
    </div>
  `;

  setTimeout(() => {
    new QRCode(document.getElementById(qrId), {
      text: paymentLink,
      width: 180,
      height: 180,
      colorDark: '#000',
      colorLight: '#fff'
    });
  }, 50);
}

function copyToClipboard(text){
  navigator.clipboard.writeText(text).then(() => {
    showToast('คัดลอกลิ้งค์เรียบร้อย', 'success');
  });
}

function downloadQRCode(elementId, filename){
  const canvas = document.querySelector(`#${elementId} canvas`);
  if(!canvas){
    showToast('QR Code ยังสร้างไม่เสร็จ', 'warning');
    return;
  }
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename + '.png';
  link.click();
}


