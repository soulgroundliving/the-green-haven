// ===== PAYMENT VERIFICATION =====

// Navigate to bill page → ประวัติตามห้อง, pre-filtered to roomId.
window.goToRoomPayHistory = function(roomId) {
  const bld = /^[Nn]\d/.test(String(roomId)) ? 'nest' : 'rooms';
  window.showPage('bill');
  const histBtn = document.getElementById('bill-main-tab-btn-history');
  if (typeof switchBillingMainTab === 'function') switchBillingMainTab('history', histBtn);
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

// SoT: Firestore verifiedSlips/{txid} is canonical for slip submissions.
// Previously this module merged localStorage payment_status entries into the
// feed via _pvLoadManualPayments() + _pvMergeSlips() — same logical payment
// was stored in BOTH places (Firestore via verifySlip CF + localStorage via
// bill-flow mirror) with DIFFERENT txid formats, so dedupe by txid failed
// and the feed showed 1.5-2x record count (§7-T writer drift). Removed
// 2026-05-17: feed now reads verifiedSlips only.

// Augment the verifiedSlips feed with paid bills that have NO slip doc (cash / no-slip
// payments). Without this the feed lists only slip-backed payments, so "เดือนนี้" looked
// incomplete — e.g. 19 rooms paid but only 15 shown (4 cash bills 13/16/20/32 missing).
// Deduped by building|room|billingMonth so a room with both a slip and a bill isn't shown
// twice. Synthesized rows carry manualEntry:true → counted as cash in the slip/cash split.
function _pvAugmentBills(slips) {
  const out = slips.slice();
  try {
    const cache = window.BillStore && window.BillStore._cache;
    if (!cache || typeof cache !== 'object') return out;
    const SYNTH = window.BillStore.SYNTH_PREFIX || 'SYNTH-';
    const billMonthKey = s => {
      if (s.yearBE && s.month) return `${s.yearBE}|${s.month}`;
      const d = s.timestamp && s.timestamp.toDate ? s.timestamp.toDate() : new Date(s.timestamp || s.verifiedAt || Date.now());
      return `${d.getFullYear() + 543}|${d.getMonth() + 1}`;
    };
    const covered = new Set(slips.map(s => `${s.building || 'rooms'}|${String(s.room)}|${billMonthKey(s)}`));
    Object.keys(cache).forEach(bld => {
      const rooms = cache[bld] || {};
      Object.keys(rooms).forEach(rid => {
        const byId = rooms[rid] || {};
        Object.keys(byId).forEach(id => {
          const b = byId[id];
          if (!b || typeof b !== 'object') return;
          if (typeof b.billId === 'string' && b.billId.startsWith(SYNTH)) return;
          if (String(b.status || '').toLowerCase() !== 'paid' && !b.paidAt) return;
          const yBE = Number(b.year) < 2400 ? Number(b.year) + 543 : Number(b.year);
          const m = Number(b.month);
          if (covered.has(`${bld}|${String(rid)}|${yBE}|${m}`)) return;
          const amt = Number(b.totalCharge != null ? b.totalCharge : b.totalAmount) || 0;
          const when = b.paidAt ? new Date(b.paidAt) : new Date(yBE - 543, m - 1, 5, 12, 0, 0);
          out.push({
            id: `bill_${bld}_${rid}_${yBE}_${m}`, room: rid, building: bld,
            amount: amt, expectedAmount: amt, sender: 'เงินสด (ไม่มีสลิป)', bankCode: '',
            timestamp: when, verifiedAt: when, manualEntry: true, _fromBill: true, yearBE: yBE, month: m
          });
        });
      });
    });
  } catch (e) { console.warn('[pv] augment bills failed:', (e && e.message) || e); }
  return out;
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
    const slips = _pvAugmentBills(firestoreSlips || []);
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
    window._pvCachedSlips = [];
    updatePVStats([]);
    feed.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ ${err.message}</div>`;
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

// Backfilled entries store paidAt (when admin processed) as timestamp, not the billing period.
// The billing month is embedded in the docId: manual_{building}_{room}_{yearBE}_{month}.
// For filtering and display, use that encoded date; real slips use their actual timestamp.
function _pvEffectiveDate(s) {
  if (s.sender === '(backfilled from RTDB)') {
    const id = s.transactionId || s.id || '';
    const m = id.match(/_(\d{4})_(\d{1,2})$/);
    if (m) return new Date(parseInt(m[1]) - 543, parseInt(m[2]) - 1, 5, 12, 0, 0);
  }
  // The live feed is about WHEN a payment was recorded, so date it by verifiedAt. The
  // `timestamp` field is the billing-month anchor (5th) for manual entries — using it stamped
  // every payment to the 5th, so the default "today"/"week" feed showed 0 right after recording
  // (the "live payment ไม่เข้ามา" symptom). PaymentStore keys off `timestamp` separately, so the
  // billing-month anchor it relies on is untouched. Fall back to timestamp, then now.
  if (s.verifiedAt) return s.verifiedAt.toDate ? s.verifiedAt.toDate() : new Date(s.verifiedAt);
  return s.timestamp?.toDate ? s.timestamp.toDate() : new Date(s.timestamp || Date.now());
}

function _pvInRange(slip) {
  const ts = _pvEffectiveDate(slip);
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
  const todaySlips = slips.filter(s => _pvEffectiveDate(s) >= todayStart);
  const monthSlips = slips.filter(s => _pvEffectiveDate(s) >= monthStart);
  // SoT for totals: BillStore (canonical bills with status='paid') — NOT slip
  // aggregation. The slip feed contains backfill + manual + verifiedSlips for
  // the same payment with different transactionIds → dedupe by txid leaves
  // duplicates, inflating both count and amount (incident: ฿109,602 reported
  // vs canonical ฿68,272). Slip feed below the widget still shows raw activity.
  const yearBE = now.getFullYear() + 543;
  const monthNum = now.getMonth() + 1;
  let billStorePaidCount = 0;
  let billStorePaidTotal = 0;
  let billStorePaidToday = 0;
  let billStoreTotalToday = 0;
  const paidRooms = new Set();
  const paidRoomsToday = new Set();
  if (window.BillStore?._cache) {
    Object.entries(window.BillStore._cache).forEach(([bld, roomsObj]) => {
      Object.entries(roomsObj || {}).forEach(([roomId, byId]) => {
        Object.values(byId || {}).forEach(b => {
          if (!b || typeof b !== 'object') return;
          if (typeof b.billId === 'string' && b.billId.startsWith(window.BillStore.SYNTH_PREFIX || 'SYNTH-')) return;
          if (parseInt(b.year) !== yearBE || parseInt(b.month) !== monthNum) return;
          const status = String(b.status || '').toLowerCase();
          if (status !== 'paid' && !b.paidAt) return;
          const amount = b.totalCharge || b.amount || 0;
          billStorePaidCount++;
          billStorePaidTotal += amount;
          paidRooms.add(`${bld}|${roomId}`);
          // Today-bucket: when paidAt is within today's window
          const paidAt = b.paidAt ? new Date(b.paidAt) : null;
          if (paidAt && paidAt >= todayStart) {
            paidRoomsToday.add(`${bld}|${roomId}`);
            billStoreTotalToday += amount;
            billStorePaidToday++;
          }
        });
      });
    });
  }
  // BillStore bills don't always carry paidAt (SlipOK path + bills issued before the paidAt
  // fix), so paidRoomsToday/paidRooms miss real payments — "ห้องชำระวันนี้" read 0 even when a
  // slip arrived today. Union in rooms whose slip was verified in-window (deduped by room, so
  // no amount inflation — billStorePaidTotal stays BillStore-only).
  todaySlips.forEach(s => { const r = String(s.room || ''); if (r) paidRoomsToday.add(`${s.building || 'rooms'}|${r}`); });
  monthSlips.forEach(s => { const r = String(s.room || ''); if (r) paidRooms.add(`${s.building || 'rooms'}|${r}`); });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pv-today-count', paidRoomsToday.size);
  set('pv-month-count', paidRooms.size);
  set('pv-month-total', '฿' + billStorePaidTotal.toLocaleString());
  // Subtitle: break the paid-room tally into slip (SlipOK-verified) vs cash/manual. A room is
  // "slip" only if it has a non-manual verifiedSlips doc in-window; every other paid room is
  // cash/manual (admin-recorded with manualEntry, or paid with no slip record). Counted by ROOM
  // to match the big "ห้องชำระ" number. (The old "📄 N slip" counted manual entries as slips too,
  // so it read 14 when only 5 were real SlipOK slips — the rest are cash.)
  const _slipKey = s => `${s.building || 'rooms'}|${String(s.room || '')}`;
  const slipRoomsToday = new Set(todaySlips.filter(s => !s.manualEntry).map(_slipKey));
  const slipRoomsMonth = new Set(monthSlips.filter(s => !s.manualEntry).map(_slipKey));
  const setSub = (id, slipN, cashN) => {
    const el = document.getElementById(id); if (!el) return;
    const parts = [];
    if (slipN > 0) parts.push(`💳 ${slipN} สลิป`);
    if (cashN > 0) parts.push(`💵 ${cashN} เงินสด`);
    el.textContent = parts.join(' · ');
  };
  setSub('pv-today-subcount', slipRoomsToday.size, Math.max(0, paidRoomsToday.size - slipRoomsToday.size));
  setSub('pv-month-subcount', slipRoomsMonth.size, Math.max(0, paidRooms.size - slipRoomsMonth.size));
  // Update notification badge
  const badge = document.getElementById('paymentBadge');
  if (badge) { badge.classList.add('u-hidden'); }
}

function renderPVFeed(slips) {
  const feed = document.getElementById('pvFeed');
  if (!feed) return;
  // Sort newest-first by activity date. Without this the feed kept verifiedSlips' raw
  // timestamp order (billing-month 5th for manual entries → all June manual tied), so today's
  // real slip sank to the middle and "7 วันล่าสุด" looked like it excluded today.
  const filtered = slips.filter(_pvInRange).sort((a, b) => _pvEffectiveDate(b) - _pvEffectiveDate(a));
  if (filtered.length === 0) {
    feed.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--text-muted);">📭 ยังไม่มีการโอนในช่วงนี้</div>';
    return;
  }
  const bankName = code => ({'004':'กสิกรไทย','014':'ไทยพาณิชย์','025':'กรุงไทย','002':'กรุงเทพ','006':'กรุงศรี','011':'TMB','065':'ทิสโก้','069':'เกียรตินาคิน','022':'CIMB','067':'ทีทีบี'})[code] || (code || '—');
  feed.innerHTML = filtered.map(s => {
    const ts = _pvEffectiveDate(s);
    const timeStr = ts.toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const amountOk = !s.expectedAmount || Math.abs(s.amount - s.expectedAmount) < 1;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="background:${amountOk ? 'var(--green-pale)' : DashColors.ORANGE_BG};color:${amountOk ? 'var(--green-dark)' : DashColors.ORANGE_DEEP};border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${amountOk ? '✅' : '⚠️'}</div>
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
  modal.dataset.modal = 'true';
  const today = new Date().toISOString().split('T')[0];
  modal.innerHTML = `<div style="background:${DashColors.WHITE};border-radius:12px;padding:1.8rem;width:92%;max-width:520px;max-height:92vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25);">
    <div style="font-size:1.15rem;font-weight:800;margin-bottom:1rem;color:var(--text);">✍️ บันทึกการชำระด้วยตัวเอง</div>
    <div style="background:${DashColors.RED_BG};border-left:4px solid ${DashColors.RED_DEEP};border-radius:6px;padding:.7rem 1rem;margin-bottom:1rem;font-size:.82rem;color:${DashColors.RED_DARKEST};">
      <strong>⚠️ สำคัญ:</strong> อย่ากดบันทึกถ้ายังไม่ได้เช็ค bank statement จริง<br>
      สลิปอาจปลอมได้ — ต้องเปิดแอปธนาคารยืนยันว่าเงินเข้าบัญชีจริง
    </div>
    <label style="display:flex;gap:8px;align-items:flex-start;padding:.7rem;background:${DashColors.YELLOW_BG};border-radius:6px;margin-bottom:1rem;cursor:pointer;">
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
      <button data-action="submitManualVerify" style="flex:1;background:var(--green);color:${DashColors.WHITE};border:none;border-radius:8px;padding:10px;font-family:'Sarabun';font-weight:700;cursor:pointer;">💾 บันทึก</button>
      <button data-action="closeNearestDataModal" style="flex:1;background:var(--border);color:var(--text);border:none;border-radius:8px;padding:10px;font-family:'Sarabun';font-weight:700;cursor:pointer;">ยกเลิก</button>
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
    window.ghAlert('ต้องเช็ค bank statement จริงก่อน แล้วกด ✅ ยืนยัน — สลิปอาจปลอมได้ อย่าเชื่อแค่ภาพสลิป', { title: '⚠️ ตรวจ bank statement ก่อน' });
    return;
  }
  if(!building || !room || !amount || amount <= 0 || !reason){
    window.ghAlert('กรุณากรอก: ตึก, ห้อง, จำนวนเงิน, เหตุผล', { title: 'ข้อมูลไม่ครบ' });
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
    window.ghAlert('Firebase ยังไม่พร้อม — ไม่สามารถบันทึกได้', { title: 'ขัดข้อง' });
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
    window.ghAlert('บันทึกการชำระเรียบร้อย', { title: '✅ สำเร็จ' });
  } catch(e) {
    window.ghAlert('บันทึกไม่สำเร็จ: ' + e.message, { title: 'ขัดข้อง' });
  }
};

// ===== Payment Verify — monthly tab prefill helper =====
window._pvPrefillMonthly = function(){
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
    // Fallback to hardcoded room lists ONLY for the two legacy buildings.
    // Tier-3F buildings without RoomConfig entries render an empty selector
    // (admin must seed via Room Config first) — better than misattributing
    // them to Nest's room list.
    if (building === 'rooms') {
      roomNumbers = (window.ROOMS_OLD || []).map(r => typeof r === 'object' ? r.id : String(r));
    } else if (building === 'nest') {
      roomNumbers = (window.ROOMS_NEW || window.NEST_ROOMS || []).map(r => typeof r === 'object' ? r.id : String(r));
    }
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

// ── inner renderer: builds the 12-month table from a merged bills+slips set ──
function _drawPVHTable(tbl, allBills, effectiveSlips, now, beYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ m: d.getMonth() + 1, y: d.getFullYear() + 543 });
  }

  // Index slips by BE month-year key for O(1) lookup per row
  const slipsByMonth = {};
  effectiveSlips.forEach(s => {
    const ts = s.timestamp?.toDate ? s.timestamp.toDate()
      : (s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp || s.verifiedAt || 0));
    const key = `${ts.getFullYear() + 543}_${ts.getMonth() + 1}`;
    if (!slipsByMonth[key]) slipsByMonth[key] = [];
    slipsByMonth[key].push({ ...s, _ts: ts });
  });

  const curM = now.getMonth() + 1;
  const _fmt = d => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  // Normalize year to BE — real RTDB bills use BE string "2569", synthetic use CE int 2026
  const _toBE = y => typeof window.BillStore !== 'undefined'
    ? window.BillStore._be(y) : (Number(y) < 2400 ? Number(y) + 543 : Number(y));

  const rows = months.map(({m, y}) => {
    const bill = allBills.find(b => Number(b.month) === m && _toBE(b.year) === y);
    const monthSlips = (slipsByMonth[`${y}_${m}`] || []).sort((a, b) => b._ts - a._ts);
    const slip = monthSlips[0] || null;

    if (!bill && !slip) {
      return `<tr>
        <td style="padding:6px 8px;font-weight:600;">${_MONTHS_TH[m]} ${String(y).slice(-2)}</td>
        <td colspan="6" style="padding:6px 8px;color:var(--text-muted);text-align:center;font-size:.8rem;">ไม่มีบิล</td>
      </tr>`;
    }

    const isPast = (y < beYear) || (y === beYear && m < curM);
    const isPaid = (bill?.status === 'paid') || !!slip || isPast;
    const rent    = Number(bill?.charges?.rent           || 0);
    const water   = Number(bill?.charges?.water?.cost    || 0);
    const electric= Number(bill?.charges?.electric?.cost || 0);
    const trash   = Number(bill?.charges?.trash          || 0);
    const total   = Number(bill?.totalCharge || (rent + water + electric + trash) || slip?.amount || 0);

    const statusHtml = isPaid
      ? `<span style="color:${DashColors.GREEN_MED};font-weight:700;">✅ ชำระแล้ว</span>`
      : `<span style="color:${DashColors.ORANGE_DARK};font-weight:700;">⏳ ค้างชำระ</span>`;

    return `<tr style="background:${isPaid ? 'var(--green-pale)' : '#fff8e1'};">
      <td style="padding:6px 8px;font-weight:600;">${_MONTHS_TH[m]} ${String(y).slice(-2)}</td>
      <td style="padding:6px 8px;text-align:right;">฿${rent.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;">฿${water.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;">฿${electric.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;">฿${trash.toLocaleString()}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;color:var(--green-dark);">฿${total.toLocaleString()}</td>
      <td style="padding:6px 8px;">${statusHtml}</td>
    </tr>`;
  }).join('');

  tbl.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:var(--green-pale);font-size:.78rem;color:var(--text-muted);">
      <th style="padding:6px 8px;text-align:left;">เดือน</th>
      <th style="padding:6px 8px;text-align:right;">ค่าเช่า</th>
      <th style="padding:6px 8px;text-align:right;">ค่าน้ำ</th>
      <th style="padding:6px 8px;text-align:right;">ค่าไฟ</th>
      <th style="padding:6px 8px;text-align:right;">ค่าขยะ</th>
      <th style="padding:6px 8px;text-align:right;">รวม</th>
      <th style="padding:6px 8px;">สถานะ</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── async: fetch meter_data → synthesize bills for months that have no real bill ──
function _pvhFillMeterGaps(building, room, realBills, slips, tbl, now, beYear) {
  if (!window.firebase?.firestore || typeof window.BillStore?.synthesizeFromMeter !== 'function') return;
  const db    = window.firebase.firestore();
  const fsLib = window.firebase.firestoreFunctions;

  // meter_data stores 2-digit BE years (69 = 2569 BE = 2026 CE)
  // CE year = 1957 + shortYear  (e.g. 1957+69=2026, 1957+68=2025)
  const shortYears = [beYear % 100, (beYear - 1) % 100];

  Promise.all(shortYears.map(shortY =>
    fsLib.getDocs(fsLib.query(
      fsLib.collection(db, 'meter_data'),
      fsLib.where('building', '==', building),
      fsLib.where('roomId',   '==', String(room)),
      fsLib.where('year',     '==', shortY)
    )).then(snap => snap.docs.map(d => d.data()))
  ))
  .then(results => {
    const meterDocs = results.flat();
    if (!meterDocs.length) return;

    // Convert 2-digit BE → CE year for synthesizeFromMeter (expects CE)
    const meterHistory = meterDocs.map(m => ({
      year: 1957 + Number(m.year),
      month: Number(m.month),
      eOld: m.eOld || 0, eNew: m.eNew || 0,
      wOld: m.wOld || 0, wNew: m.wNew || 0,
      createdAt: m.updatedAt || m.createdAt
    })).sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));

    // Extract rates from the most recent real bill; fall back to common defaults
    const refBill = realBills[0] || {};
    const rates = {
      rent:  Number(refBill.charges?.rent  || 0),
      eRate: Number(refBill.charges?.electric?.rate || 8),
      wRate: Number(refBill.charges?.water?.rate    || 20),
      trash: Number(refBill.charges?.trash          || 40)
    };

    // Build synthetic bills inline — synthesizeFromMeter has a tenant-side slice(0,6)
    // limit that would cut off months 7-12. We need all 12 months for the admin view.
    const currentYM = now.getFullYear() * 100 + (now.getMonth() + 1);
    const existingByYM = new Set();
    realBills.forEach(b => {
      const beY = window.BillStore._be(b.year);
      existingByYM.add(`${beY - 543}-${Number(b.month)}`); // store as CE-year key
    });

    const synthBills = meterHistory
      .filter(m => !existingByYM.has(`${m.year}-${m.month}`))
      .map(m => {
        const isPast = (m.year * 100 + m.month) < currentYM;
        const eUnits = Math.max(0, m.eNew - m.eOld);
        const wUnits = Math.max(0, m.wNew - m.wOld);
        const eCost  = eUnits * rates.eRate;
        const wCost  = wUnits * rates.wRate;
        const total  = rates.rent + eCost + wCost + rates.trash;
        return {
          billId: `SYNTH-${building}-${room}-${m.year}${String(m.month).padStart(2,'0')}`,
          synthetic: true, building, room: String(room),
          month: m.month, year: m.year + 543,  // store as BE 4-digit so _toBE matches correctly
          status: isPast ? 'paid' : 'pending',
          totalCharge: total,
          charges: {
            rent: rates.rent,
            electric: { cost: eCost, rate: rates.eRate, old: m.eOld, new: m.eNew, units: eUnits },
            water:    { cost: wCost, rate: rates.wRate, old: m.wOld, new: m.wNew, units: wUnits },
            trash: rates.trash
          }
        };
      });
    if (!synthBills.length) return;

    // Merge: real bills win; synthetic fills months with no real bill
    const allBills = [...realBills, ...synthBills];

    // Guard: user may have switched room while Firestore was fetching
    if (document.getElementById('pvh-building')?.value !== building ||
        document.getElementById('pvh-room')?.value      !== String(room)) return;

    _drawPVHTable(tbl, allBills, slips, now, beYear);
  })
  .catch(e => console.warn('pvh meter gaps:', e));
}

function _renderPVHBillTable(building, room, slips) {
  if (slips !== undefined) _pvhLastSlips = slips;
  const effectiveSlips = _pvhLastSlips;

  const tbl = document.getElementById('pvhBillTable');
  if (!tbl) return;

  if (!building || !room) {
    tbl.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--text-muted);">กรุณาเลือกห้อง</div>';
    return;
  }

  // Subscribe BillStore once so RTDB changes trigger a re-render
  if (typeof window.BillStore !== 'undefined' && !_pvhBillStoreUnsub) {
    _pvhBillStoreUnsub = window.BillStore.onChange(() => _renderPVHBillTable(
      document.getElementById('pvh-building')?.value,
      document.getElementById('pvh-room')?.value
    ));
  }

  const now    = new Date();
  const beYear = now.getFullYear() + 543;

  // 1. Get real RTDB bills (synchronous — BillStore._cache is already populated)
  let realBills = [];
  if (typeof window.BillStore !== 'undefined') {
    [beYear, beYear - 1].forEach(y => {
      realBills.push(...(window.BillStore.getByRoom(building, room, String(y)) || []));
    });
  } else {
    tbl.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--text-muted);">⚠️ BillStore ยังไม่พร้อม</div>';
    return;
  }

  // 2. Render immediately with real bills (no flicker)
  _drawPVHTable(tbl, realBills, effectiveSlips, now, beYear);

  // 3. Async: fill months without real bills using meter_data → synthetic bills
  _pvhFillMeterGaps(building, room, realBills, effectiveSlips, tbl, now, beYear);
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
    const byKey = new Map();
    fromSource.forEach(s => byKey.set(s.transactionId || s.id || `s_${_ts(s).getTime()}`, s));
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
    <div style="background:${DashColors.WHITE};border-radius:8px;padding:1.5rem;margin-top:1rem;">
      <div style="margin-bottom:1.5rem;">
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📱 ลิ้งค์ชำระเงิน:</label>
        <div style="background:#f5f5f5;padding:10px;border-radius:6px;word-break:break-all;font-size:.9rem;font-family:monospace;margin-bottom:10px;">
          ${paymentLink}
        </div>
        <button data-action="copyToClipboard" data-id="${paymentLink}" style="padding:8px 16px;background:var(--blue);color:${DashColors.WHITE};border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">📋 คัดลอก</button>
      </div>

      <div>
        <label style="display:block;margin-bottom:.5rem;font-weight:700;color:var(--text);">📲 QR Code:</label>
        <div style="background:#f5f5f5;border-radius:6px;padding:1rem;text-align:center;" id="${qrId}"></div>
        <button data-action="downloadQRCode" data-id="${qrId}" data-arg="payment-room-${room}" style="width:100%;margin-top:10px;padding:8px 16px;background:var(--green);color:${DashColors.WHITE};border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:.9rem;">⬇️ ดาวน์โหลด QR Code</button>
      </div>
    </div>
  `;

  setTimeout(() => {
    new QRCode(document.getElementById(qrId), {
      text: paymentLink,
      width: 180,
      height: 180,
      colorDark: '#000',
      colorLight: DashColors.WHITE
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


