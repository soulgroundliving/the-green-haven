// ===== DEPOSIT MANAGEMENT =====
// Firestore path: deposits/{building}/{roomId}
// One doc per room: { amount, status, receivedAt, returnedAt, returnedAmount, deductions[], refundBank, notes, updatedAt }

let _depositsCache = []; // flat array: { building, roomId, ...fields }
let _depositsUnsub = null;

function initDepositsPage() {
  if (_depositsUnsub) { renderDepositsPage(); return; }
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    const el = document.getElementById('depList');
    if (el) el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⚠️ Firebase ยังไม่พร้อม</div>';
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  // Seed deposits from tenant SSoT — any room with a deposit amount gets an entry if missing.
  _seedDepositsFromTenants().then(() => {
    // Live listener on the flat deposits collection
    _depositsUnsub = fs.onSnapshot(
      fs.collection(db, 'deposits'),
      snap => {
        _depositsCache = snap.docs.map(d => d.data());
        renderDepositsPage();
      },
      err => console.warn('⚠️ deposits listener:', err.message)
    );
  });
}

async function _seedDepositsFromTenants() {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  try {
    for (const building of (window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest']) {
      const snap = await fs.getDocs(fs.collection(db, `tenants/${building}/list`));
      const eligible = snap.docs.filter(d => { const t = d.data() || {}; return t.deposit && t.status !== 'vacant'; });
      if (!eligible.length) continue;
      // Batch-fetch all deposit docs to avoid N+1 round-trips
      const depSnaps = await Promise.all(eligible.map(d => fs.getDoc(fs.doc(db, 'deposits', `${building}_${d.id}`))));
      const existingIds = new Set(depSnaps.filter(s => s.exists()).map(s => s.id));
      await Promise.all(eligible
        .filter(d => !existingIds.has(`${building}_${d.id}`))
        .map(d => {
          const t = d.data();
          return fs.setDoc(fs.doc(db, 'deposits', `${building}_${d.id}`), {
            building, roomId: d.id,
            amount: Number(t.deposit) || 0,
            status: 'holding',
            receivedAt: t.moveInDate || t.createdAt || null,
            deductions: [],
            refundBank: '',
            notes: '',
            updatedAt: new Date().toISOString()
          });
        })
      );
    }
  } catch (e) {
    console.warn('⚠️ deposit seed skipped:', e.message);
  }
}

function renderDepositsPage() {
  const filterBuilding = document.getElementById('dep-filter-building')?.value || 'all';
  const filterStatus   = document.getElementById('dep-filter-status')?.value   || 'all';
  let rows = _depositsCache;
  if (filterBuilding !== 'all') rows = rows.filter(r => r.building === filterBuilding);
  if (filterStatus   !== 'all') rows = rows.filter(r => r.status === filterStatus);

  const holding  = _depositsCache.filter(r => r.status !== 'returned').length;
  const returned = _depositsCache.filter(r => r.status === 'returned').length;
  const total    = _depositsCache.filter(r => r.status !== 'returned').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const el = id => { const e = document.getElementById(id); if (e) e.textContent = String(arguments[1] ?? ''); };
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setEl('dep-kpi-holding',  String(holding));
  setEl('dep-kpi-returned', String(returned));
  setEl('dep-kpi-total', '฿' + total.toLocaleString());

  const list = document.getElementById('depList');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">ไม่มีรายการมัดจำ</div>';
    return;
  }
  const fmt = n => '฿' + (Number(n) || 0).toLocaleString();
  const statusBadge = s => s === 'returned'
    ? '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;">✅ คืนแล้ว</span>'
    : '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;">💰 ถือมัดจำ</span>';

  list.innerHTML = rows.map(r => {
    const deductTotal = (r.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const netRefund = (Number(r.amount) || 0) - deductTotal;
    const isReturned = r.status === 'returned';
    return `<div style="padding:14px 0;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;color:#334435;font-size:var(--fs-md);">ห้อง ${r.roomId} <span style="font-size:11px;color:#9ca3af;font-weight:400;">${r.building}</span></div>
          <div style="font-size:var(--fs-sm);color:${DashColors.TEXT_SECONDARY};margin-top:3px;">รับเมื่อ: ${r.receivedAt || '—'} · ${statusBadge(r.status)}</div>
          ${(r.deductions||[]).length ? `<div style="font-size:10px;color:${DashColors.TEXT_SECONDARY};margin-top:4px;">หัก: ${(r.deductions||[]).map(d=>`${d.reason} (${fmt(d.amount)})`).join(', ')}</div>` : ''}
          ${r.notes ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">หมายเหตุ: ${r.notes}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:1.15rem;font-weight:800;color:#334435;">${fmt(r.amount)}</div>
          ${deductTotal ? `<div style="font-size:11px;color:#dc2626;">หักแล้ว ${fmt(deductTotal)}</div><div style="font-size:var(--fs-sm);font-weight:700;color:#059669;">คืนสุทธิ ${fmt(netRefund)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;flex-wrap:wrap;">
            ${!isReturned ? `<button data-action="showReturnDepositModal" data-building="${r.building}" data-room="${r.roomId}" style="padding:5px 12px;background:#334435;color:white;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;">บันทึกคืนมัดจำ</button>` : ''}
            <button data-action="exportDepositReceipt" data-building="${r.building}" data-room="${r.roomId}" style="padding:5px 12px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;">📄 ใบรับเงิน</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showReturnDepositModal(building, roomId) {
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  if (!dep) return;
  const existing = document.getElementById('returnDepositModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'returnDepositModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:24px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <h3 style="margin:0 0 16px;font-size:1.1rem;color:#334435;">💰 บันทึกคืนมัดจำ — ห้อง ${roomId}</h3>
      <div style="margin-bottom:12px;">
        <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:4px;">มัดจำทั้งหมด</label>
        <div style="font-size:1.3rem;font-weight:800;color:#334435;">฿${(Number(dep.amount)||0).toLocaleString()}</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:4px;">วันที่คืนมัดจำ</label>
        <input id="dep-ret-date" type="date" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:8px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;box-sizing:border-box;">
      </div>
      <div id="dep-deductions-list" style="margin-bottom:8px;"></div>
      <button data-action="addDepDeduction" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;padding:0;margin-bottom:8px;font-family:inherit;">+ เพิ่มรายการหัก</button>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <input id="dep-deduction-reason" placeholder="เหตุผล (เช่น ค่าเสียหาย)" style="flex:1;padding:7px 10px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;font-size:var(--fs-sm);">
        <input id="dep-deduction-amount" type="number" placeholder="จำนวนเงิน" style="width:110px;padding:7px 10px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;font-size:var(--fs-sm);">
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:4px;">หมายเหตุ</label>
        <input id="dep-ret-notes" type="text" placeholder="(ไม่บังคับ)" value="${dep.notes||''}" style="width:100%;padding:8px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;box-sizing:border-box;">
      </div>
      <div style="display:flex;gap:10px;margin-top:18px;">
        <button data-action="closeReturnDepositModal" style="flex:1;padding:10px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">ยกเลิก</button>
        <button data-action="saveDepositReturn" data-id="${building}" data-arg="${roomId}" style="flex:2;padding:10px;background:#334435;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">✅ ยืนยันคืนมัดจำ</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._depPendingDeductions = (dep.deductions || []).map(d => ({...d}));
  _renderDepDeductions();
}
window.showReturnDepositModal = showReturnDepositModal;

function _renderDepDeductions() {
  const el = document.getElementById('dep-deductions-list');
  if (!el) return;
  const deductions = window._depPendingDeductions || [];
  if (!deductions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="background:#fef9ec;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
    ${deductions.map((d, i) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-sm);padding:3px 0;">
      <span>${d.reason}</span>
      <span style="display:flex;align-items:center;gap:8px;"><strong>฿${(Number(d.amount)||0).toLocaleString()}</strong>
        <button data-action="removeDepDeduction" data-index="${i}" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:14px;padding:0;font-family:inherit;">✕</button>
      </span>
    </div>`).join('')}
  </div>`;
}
window._renderDepDeductions = _renderDepDeductions;

async function _saveDepositReturn(building, roomId) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const deductions = window._depPendingDeductions || [];
  const retDate  = document.getElementById('dep-ret-date')?.value || new Date().toISOString().slice(0,10);
  const notes    = document.getElementById('dep-ret-notes')?.value || '';
  const dep      = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  const deductTotal = deductions.reduce((s, d) => s + (Number(d.amount)||0), 0);
  const returnedAmount = (Number(dep?.amount)||0) - deductTotal;
  try {
    await fs.setDoc(fs.doc(db, 'deposits', `${building}_${roomId}`), {
      building, roomId,
      amount: Number(dep?.amount) || 0,
      status: 'returned',
      receivedAt: dep?.receivedAt || null,
      returnedAt: retDate,
      returnedAmount,
      deductions,
      refundBank: dep?.refundBank || '',
      notes,
      updatedAt: new Date().toISOString()
    });
    // Mirror status to tenant SSoT so tenant profile page can show badge
    await fs.setDoc(
      fs.doc(db, `tenants/${building}/list/${roomId}`),
      { depositStatus: 'returned', depositReturnedAt: retDate },
      { merge: true }
    );
    document.getElementById('returnDepositModal')?.remove();
    if (typeof showToast === 'function') showToast('✅ บันทึกคืนมัดจำแล้ว');
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}
window._saveDepositReturn = _saveDepositReturn;

async function exportDepositReceipt(building, roomId) {
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  if (!dep) return;
  const deductTotal = (dep.deductions||[]).reduce((s,d) => s+(Number(d.amount)||0), 0);
  const netRefund = (Number(dep.amount)||0) - deductTotal;
  const fmt = n => '฿' + (Number(n)||0).toLocaleString();
  const owner = window.OwnerConfigManager?.get() || {};

  // Build receipt HTML in a hidden div
  const wrap = document.createElement('div');
  wrap.id = '_depReceiptWrap';
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;background:white;padding:28px;font-family:"IBM Plex Sans Thai Looped",sans-serif;';
  wrap.innerHTML = `
    <div style="text-align:center;margin-bottom:18px;">
      <div style="font-size:1.2rem;font-weight:800;color:#334435;">${owner.name || 'The Green Haven'}</div>
      <div style="font-size:13px;color:${DashColors.TEXT_SECONDARY};margin-top:2px;">ใบรับเงินคืนมัดจำ / Deposit Refund Receipt</div>
    </div>
    <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0;">
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">ห้อง / Room</td><td style="text-align:right;font-weight:700;">${roomId} (${building})</td></tr>
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">มัดจำ / Deposit</td><td style="text-align:right;">${fmt(dep.amount)}</td></tr>
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">วันที่รับ / Received</td><td style="text-align:right;">${dep.receivedAt||'—'}</td></tr>
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">วันที่คืน / Returned</td><td style="text-align:right;">${dep.returnedAt||'—'}</td></tr>
    </table>
    ${(dep.deductions||[]).length ? `
    <div style="margin-top:12px;padding:10px;background:#fef9ec;border-radius:8px;font-size:12px;">
      <div style="font-weight:700;color:#92400e;margin-bottom:6px;">รายการหัก / Deductions</div>
      ${(dep.deductions||[]).map(d=>`<div style="display:flex;justify-content:space-between;"><span>${d.reason}</span><span>${fmt(d.amount)}</span></div>`).join('')}
      <div style="display:flex;justify-content:space-between;font-weight:700;margin-top:6px;border-top:1px solid #fde68a;padding-top:6px;"><span>รวมหัก</span><span style="color:#dc2626;">${fmt(deductTotal)}</span></div>
    </div>` : ''}
    <div style="margin-top:14px;padding:14px;background:#f0fdf4;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:700;color:#334435;">คืนสุทธิ / Net Refund</span>
      <span style="font-size:1.3rem;font-weight:800;color:#059669;">${fmt(netRefund)}</span>
    </div>
    ${dep.notes ? `<div style="margin-top:10px;font-size:11px;color:#9ca3af;">หมายเหตุ: ${dep.notes}</div>` : ''}
    <div style="text-align:center;margin-top:20px;font-size:10px;color:#9ca3af;">สร้างโดย ${owner.name||'The Green Haven'} · ${new Date().toLocaleDateString('th-TH')}</div>`;

  document.body.appendChild(wrap);
  try {
    if (typeof window.ensureHtml2Canvas === 'function') await window.ensureHtml2Canvas();
    const html2canvas = window.html2canvas;
    const canvas = await html2canvas(wrap, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `deposit_receipt_${building}_${roomId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    if (typeof showToast === 'function') showToast('📄 ดาวน์โหลดใบรับเงินแล้ว');
  } catch (e) {
    console.error('❌ receipt export failed:', e);
    alert('ไม่สามารถสร้างใบรับเงินได้: ' + e.message);
  } finally {
    wrap.remove();
  }
}
window.exportDepositReceipt = exportDepositReceipt;
if (typeof window !== 'undefined') {
  window.initDepositsPage  = initDepositsPage;
  window.renderDepositsPage = renderDepositsPage;
}
