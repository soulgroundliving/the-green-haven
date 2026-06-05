// ===== DEPOSIT MANAGEMENT =====
// Firestore path: deposits/{building}/{roomId}
// One doc per room: { amount, paidSoFar, status, receivedAt, returnedAt, returnedAmount, deductions[], refundBank, refundSlip, notes, updatedAt }
// paidSoFar (Slice B): deposit paid so far for installments; absent = fully paid (§7-L). due = amount - paidSoFar.
// deductions (Slice C): [{ desc, amount, photo }] — move-out damage settlement. §7-L back-compat:
//   legacy rows are { reason, amount } (no photo); DepositCalc.deductionDesc() reads either. photo +
//   refundSlip are Storage paths under deposits/{building}/{roomId}/ (admin-only, storage.rules).
// refundPromptPay (Slice C follow-up): tenant PromptPay the refund was sent to (validated; QR generated
//   for the admin to scan & pay). refundBank stays as an optional free-text fallback for bank transfers.
// Audit: _saveDepositReturn fires recordAdminAction({action:'DEPOSIT_RETURNED'}) — immutable settlement trail.
// tenantId + history (Item B): the doc is stamped with its owning tenancy (tenantId). On turnover the
//   seed archives a SETTLED prior doc into deposits/{building}_{roomId}/history/{settlementId} (immutable,
//   admin/accountant read) before resetting to holding for the newcomer — so each tenant's move-out
//   evidence survives for cross-tenancy comparison. Storage files are never deleted (§7-L legacy: docs
//   without tenantId are left untouched; first holding cycle after this ship backfills the owner).
//   historyCount on the live doc counts archived prior settlements so the card can offer "ดูประวัติ (N)"
//   and the holding card surfaces a prior tenant's evidence — both without an N+1 subcollection query.

let _depositsCache = []; // flat array: { building, roomId, ...fields }
let _depositsUnsub = null;

// DepositCalc is loaded before this module (dashboard.html), but guard defensively.
const _dedDesc  = d    => window.DepositCalc ? window.DepositCalc.deductionDesc(d)     : ((d && (d.desc || d.reason)) || '');
const _dedTotal = list => window.DepositCalc ? window.DepositCalc.deductionsTotal(list) : (Array.isArray(list) ? list : []).reduce((s, d) => s + (Number(d && d.amount) || 0), 0);

// Format a deposit date for display. The seed copies tenants/{r}.createdAt — a Firestore
// Timestamp object — into receivedAt, which stringifies to "Timestamp(seconds=…)" if rendered
// raw. Handle Timestamp | ISO datetime | plain date string.
function _fmtDepDate(v) {
  if (!v) return '—';
  if (typeof v === 'object') {
    const d = typeof v.toDate === 'function' ? v.toDate()
            : (typeof v.seconds === 'number' ? new Date(v.seconds * 1000) : null);
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '—';
  }
  const s = String(v);
  return s.length > 10 ? s.slice(0, 10) : s; // trim ISO datetime → date; pass a plain date through
}

// Upload an admin-captured File (damage photo / refund slip) to Storage and return
// its path. File inputs yield File objects → uploadBytes directly (no §7-Y dataURL
// concern). Returns '' if Storage isn't ready or no file — caller treats as "no evidence".
async function _uploadDepositFile(building, roomId, file, prefix) {
  const sf = window.firebase?.storageFunctions;
  const st = window.firebase?.storage?.();
  if (!sf || !st || !file) return '';
  const ext  = (file.name && file.name.split('.').pop().toLowerCase()) || 'jpg';
  const safe = String(roomId).replace(/[^\w-]/g, '_');
  const path = `deposits/${building}/${safe}/${prefix}_${Date.now()}.${ext}`;
  await sf.uploadBytes(sf.ref(st, path), file);
  return path;
}

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
      // Per-room so one failure never blocks the others (archive→reset is
      // self-healing: a partial run re-detects the same mismatch next load).
      await Promise.all(eligible.map(async (d, i) => {
        try { await _reconcileDepositForRoom(fs, db, building, d, depSnaps[i]); }
        catch (e) { console.warn(`⚠️ deposit seed (${building}/${d.id}):`, e?.message || e); }
      }));
    }
  } catch (e) {
    console.warn('⚠️ deposit seed skipped:', e.message);
  }
}

// Bring one room's deposit doc in line with its current tenant:
//  • no doc                → create a fresh holding (stamped with the tenant).
//  • holding, no owner     → backfill tenantId (safe: a holding deposit is the
//                            current occupant's) so turnover is detectable next cycle.
//  • returned + tenant changed (both ids known) → archive the prior settlement to
//                            deposits/{id}/history/ (its evidence Storage paths
//                            survive) THEN reset to holding for the newcomer.
//                            Archive FIRST so a failed reset never loses the proof.
//  • else (same tenant / legacy empty tenantId / still holding) → leave as-is.
// Storage evidence files are never deleted, so an archived settlement's photos +
// refund slip stay resolvable — the basis for comparing a room across tenancies.
async function _reconcileDepositForRoom(fs, db, building, d, depSnap) {
  const t = d.data() || {};
  const docId = `${building}_${d.id}`;
  const curTenantId = t.tenantId || '';
  const freshHolding = (historyCount = 0) => ({
    building, roomId: d.id,
    tenantId: curTenantId,
    amount: Number(t.deposit) || 0,
    paidSoFar: Number(t.deposit) || 0, // seed = fully paid; admin lowers it via ผ่อนมัดจำ for installment tenants
    status: 'holding',
    receivedAt: t.moveInDate || t.createdAt || null,
    deductions: [],
    refundBank: '',
    historyCount,                       // # of archived prior settlements (Item B step 4) — drives the card's "ดูประวัติ (N)"
    notes: '',
    updatedAt: new Date().toISOString()
  });

  if (!depSnap.exists()) {
    await fs.setDoc(fs.doc(db, 'deposits', docId), freshHolding());
    return;
  }
  const dd = depSnap.data() || {};

  // Backfill tenantId onto a holding doc that predates tenant-awareness.
  if (dd.status !== 'returned' && !dd.tenantId && curTenantId) {
    await fs.setDoc(fs.doc(db, 'deposits', docId), { tenantId: curTenantId }, { merge: true });
    return;
  }

  // Turnover: a SETTLED deposit whose owner differs from the room's current
  // tenant. Both ids must be non-empty so legacy docs (no tenantId) are never
  // archived spuriously and a live holding deposit is never reset.
  if (dd.status === 'returned' && dd.tenantId && curTenantId && dd.tenantId !== curTenantId) {
    const settlementId = `${dd.returnedAt || 'unknown'}_${dd.tenantId}`.replace(/[^\w-]/g, '_');
    await fs.setDoc(fs.doc(db, `deposits/${docId}/history/${settlementId}`), {
      tenantId: dd.tenantId,
      returnedAt: dd.returnedAt || null,
      returnedAmount: Number(dd.returnedAmount) || 0,
      finalBillTotal: Number(dd.finalBillTotal) || 0,
      deductions: dd.deductions || [],
      settledBills: dd.settledBills || [],
      refundBank: dd.refundBank || '',
      refundPromptPay: dd.refundPromptPay || '',
      refundSlip: dd.refundSlip || '',
      notes: dd.notes || '',
      archivedAt: new Date().toISOString()
    });
    await fs.setDoc(fs.doc(db, 'deposits', docId), freshHolding((dd.historyCount || 0) + 1));
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
  const outstandingDue = _depositsCache.filter(r => r.status !== 'returned')
    .reduce((s, r) => s + (window.DepositCalc ? window.DepositCalc.depositDue(r) : 0), 0);
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setEl('dep-kpi-holding',  String(holding));
  setEl('dep-kpi-returned', String(returned));
  setEl('dep-kpi-total', '฿' + total.toLocaleString());
  setEl('dep-kpi-due', outstandingDue > 0 ? 'ค้างรับ ฿' + outstandingDue.toLocaleString() : '');

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
    const deductTotal = _dedTotal(r.deductions);
    const finalBillTotal = Number(r.finalBillTotal) || 0; // absorbed final/unpaid bill (spec §1.3)
    const isReturned = r.status === 'returned';
    const hasEvidence = (r.deductions || []).some(d => d.photo) || !!r.refundSlip; // any stored damage photo / refund slip
    const hasHistory = (Number(r.historyCount) || 0) > 0; // archived prior tenancies (Item B step 4) — viewable on holding rooms too
    const evLabel = (isReturned && hasEvidence ? 'ดูหลักฐาน' : 'ดูประวัติ') + (hasHistory ? ` (${r.historyCount})` : '');
    const depDue  = window.DepositCalc ? window.DepositCalc.depositDue(r) : 0;
    const depPaid = window.DepositCalc ? window.DepositCalc.depositPaid(r) : (Number(r.amount) || 0);
    const netRefund = depPaid - finalBillTotal - deductTotal; // held − final bill − damage
    return `<div style="padding:14px 0;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;color:#334435;font-size:var(--fs-md);">ห้อง ${r.roomId} <span style="font-size:11px;color:#9ca3af;font-weight:400;">${r.building}</span></div>
          <div style="font-size:var(--fs-sm);color:${DashColors.TEXT_SECONDARY};margin-top:3px;">รับเมื่อ: ${_fmtDepDate(r.receivedAt)} · ${statusBadge(r.status)}${!isReturned && depDue > 0 ? ` <span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;">ค้างมัดจำ ${fmt(depDue)}</span>` : ''}</div>
          ${(r.deductions||[]).length ? `<div style="font-size:10px;color:${DashColors.TEXT_SECONDARY};margin-top:4px;">หัก: ${(r.deductions||[]).map(d=>`${_dedDesc(d)}${d.photo?' 📎':''} (${fmt(d.amount)})`).join(', ')}</div>` : ''}
          ${r.notes ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">หมายเหตุ: ${r.notes}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:1.15rem;font-weight:800;color:#334435;">${fmt(r.amount)}</div>
          ${!isReturned && depDue > 0 ? `<div style="font-size:10px;color:${DashColors.TEXT_SECONDARY};">ชำระแล้ว ${fmt(depPaid)} · ค้าง <strong style="color:#dc2626;">${fmt(depDue)}</strong></div>` : ''}
          ${(deductTotal || finalBillTotal) ? `${finalBillTotal ? `<div style="font-size:11px;color:#dc2626;">บิลเดือนสุดท้าย ${fmt(finalBillTotal)}</div>` : ''}${deductTotal ? `<div style="font-size:11px;color:#dc2626;">หักเสียหาย ${fmt(deductTotal)}</div>` : ''}<div style="font-size:var(--fs-sm);font-weight:700;color:#059669;">คืนสุทธิ ${fmt(netRefund)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;flex-wrap:wrap;">
            ${!isReturned ? `<button data-action="showReturnDepositModal" data-building="${r.building}" data-room="${r.roomId}" style="padding:5px 12px;background:#334435;color:white;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;">บันทึกคืนมัดจำ</button>` : ''}
            ${(isReturned && hasEvidence) || hasHistory ? `<button data-action="showDepositEvidence" data-building="${r.building}" data-room="${r.roomId}" style="padding:5px 12px;background:#eef2f6;color:#334435;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;">📎 ${evLabel}</button>` : ''}
            ${isReturned ? `<button data-action="exportDepositReceipt" data-building="${r.building}" data-room="${r.roomId}" style="padding:5px 12px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;">📄 ใบรับเงิน</button>` : ''}
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
    <div style="background:#fff;border-radius:16px;width:100%;max-width:440px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.28);">
      <div style="flex-shrink:0;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 22px 14px;border-bottom:1px solid #eef0ee;">
        <div>
          <h3 style="margin:0;font-size:1.05rem;color:#334435;font-weight:800;line-height:1.3;">💰 คืนมัดจำ</h3>
          <div style="font-size:var(--fs-sm);color:#6b7280;margin-top:2px;">ห้อง ${roomId} <span style="color:#9ca3af;">· ${building}</span></div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:#9ca3af;">มัดจำที่ถือไว้</div>
          <div style="font-size:1.25rem;font-weight:800;color:#334435;">฿${(window.DepositCalc ? window.DepositCalc.depositPaid(dep) : (Number(dep.amount)||0)).toLocaleString()}</div>
        </div>
      </div>

      <div style="flex:1 1 auto;overflow-y:auto;padding:16px 22px;">
        <div style="margin-bottom:14px;">
          <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:5px;">วันที่คืนมัดจำ</label>
          <input id="dep-ret-date" type="date" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:9px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:9px;font-family:inherit;box-sizing:border-box;">
        </div>

        <div id="dep-deductions-list" style="margin-bottom:8px;"></div>
        <div style="background:#fafaf9;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:10px;padding:10px 12px;margin-bottom:14px;">
          <div style="font-size:11px;color:#6b7280;font-weight:700;margin-bottom:8px;">หักความเสียหายจากผู้เช่า</div>
          <div style="display:flex;gap:8px;margin-bottom:6px;">
            <input id="dep-deduction-desc" placeholder="รายละเอียด (เช่น ค่าทำความสะอาด)" style="flex:1;min-width:0;padding:8px 10px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;font-size:var(--fs-sm);box-sizing:border-box;">
            <input id="dep-deduction-amount" type="number" min="0" placeholder="บาท" style="width:80px;flex-shrink:0;padding:8px 10px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;font-size:var(--fs-sm);box-sizing:border-box;">
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="dep-deduction-photo" type="file" accept="image/*,application/pdf" style="flex:1;min-width:0;font-size:10px;font-family:inherit;color:#6b7280;">
            <button data-action="addDepDeduction" style="padding:7px 14px;background:#334435;color:white;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">+ เพิ่ม</button>
          </div>
          <div style="font-size:10px;color:#9ca3af;margin-top:6px;">📎 แนบรูปหลักฐานต่อรายการ (ไม่บังคับ) — เพื่อความโปร่งใส</div>
        </div>

        <div id="dep-ret-finalbill" style="margin-bottom:8px;"></div>
        <div id="dep-ret-summary" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;margin-bottom:8px;"></div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px dashed #e5e7eb;font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.03em;margin-bottom:12px;">ช่องทางคืนเงิน</div>

        <div style="margin-bottom:14px;">
          <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:5px;">สลิปโอนคืน <span style="font-weight:400;color:#9ca3af;">(ไม่บังคับ — เก็บเป็นหลักฐาน)</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input id="dep-ret-slip" type="file" accept="image/*,application/pdf" style="flex:1;min-width:0;font-size:11px;font-family:inherit;color:#6b7280;">
            <button data-action="previewRefundSlip" title="ดูรูปสลิปที่เลือก" style="padding:8px 11px;background:#f3f4f6;color:#374151;border:none;border-radius:8px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">👁 ดู</button>
          </div>
          <div id="dep-ret-slip-result" style="margin-top:8px;"></div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:5px;">พร้อมเพย์ผู้เช่า <span style="font-weight:400;color:#9ca3af;">(ปลายทางคืนเงิน)</span></label>
          <div style="display:flex;gap:8px;">
            <input id="dep-ret-promptpay" type="text" inputmode="numeric" placeholder="เบอร์ 10 หลัก / เลขบัตร ปชช. 13 หลัก" value="${dep.refundPromptPay||''}" style="flex:1;min-width:0;padding:9px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:9px;font-family:inherit;box-sizing:border-box;font-size:var(--fs-sm);">
            <button data-action="genRefundQR" style="padding:9px 14px;background:#e0f2fe;color:#075985;border:none;border-radius:9px;font-size:var(--fs-sm);font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">⬛ QR</button>
          </div>
          <div id="dep-ret-qr" style="margin-top:10px;text-align:center;"></div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:5px;">บัญชีธนาคาร <span style="font-weight:400;color:#9ca3af;">(ถ้าไม่ใช้พร้อมเพย์)</span></label>
          <input id="dep-ret-bank" type="text" placeholder="ธนาคาร / เลขบัญชี" value="${dep.refundBank||''}" style="width:100%;padding:9px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:9px;font-family:inherit;box-sizing:border-box;font-size:var(--fs-sm);">
        </div>

        <div>
          <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:5px;">หมายเหตุ</label>
          <input id="dep-ret-notes" type="text" placeholder="(ไม่บังคับ)" value="${dep.notes||''}" style="width:100%;padding:9px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:9px;font-family:inherit;box-sizing:border-box;font-size:var(--fs-sm);">
        </div>
      </div>

      <div style="flex-shrink:0;display:flex;gap:10px;padding:14px 22px;border-top:1px solid #eef0ee;background:#fff;">
        <button data-action="closeReturnDepositModal" style="flex:1;padding:11px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">ยกเลิก</button>
        <button data-action="saveDepositReturn" data-id="${building}" data-arg="${roomId}" style="flex:2;padding:11px;background:#334435;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">✅ ยืนยันคืนมัดจำ</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  window._depPendingDeductions = (dep.deductions || []).map(d => ({...d}));
  window._depReturnCtx = { building, roomId };
  // Final/unpaid bill of the room — auto-deducted from the deposit (spec §1.3).
  // rooms-building only; Nest has no bills → { total: 0 } → block hidden, no-op.
  window._depFinalBills = (typeof window.outstandingBillsForRoom === 'function')
    ? window.outstandingBillsForRoom(building, roomId) : { bills: [], total: 0 };
  _renderFinalBillBlock();
  _renderDepDeductions();
}
window.showReturnDepositModal = showReturnDepositModal;

// Read-only display of the room's outstanding bill(s) that will be deducted from the
// deposit + marked paid-from-deposit on confirm. Static for the session (bills don't
// change in-modal); the net in _updateRefundSummary subtracts this total.
function _renderFinalBillBlock() {
  const el = document.getElementById('dep-ret-finalbill');
  if (!el) return;
  const fb = window._depFinalBills || { bills: [], total: 0 };
  if (!fb.total) { el.innerHTML = ''; return; }
  const fmt = n => '฿' + (Number(n) || 0).toLocaleString();
  el.innerHTML = `<div style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;">
    <div style="font-size:11px;color:#92400e;font-weight:700;margin-bottom:6px;">บิลค้างชำระ (หักจากมัดจำ → ทำเครื่องหมายจ่ายแล้ว)</div>
    ${fb.bills.map(b => `<div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);padding:2px 0;">
      <span style="color:#6b7280;">บิลเดือน ${b.month}/${b.beYear}</span><span>${fmt(b.total)}</span></div>`).join('')}
    <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);font-weight:700;margin-top:4px;padding-top:4px;border-top:1px solid #fde68a;">
      <span>รวมบิลค้าง</span><span style="color:#92400e;">${fmt(fb.total)}</span></div>
  </div>`;
}
window._renderFinalBillBlock = _renderFinalBillBlock;

// Render a PromptPay QR for the CURRENT net refund (held − pending deductions) so the
// admin can scan & pay the tenant the exact amount. Validates the PromptPay first.
function _genRefundQR() {
  const el = document.getElementById('dep-ret-qr');
  if (!el) return;
  const raw = document.getElementById('dep-ret-promptpay')?.value || '';
  const v = window.DepositCalc ? window.DepositCalc.validPromptPay(raw) : { valid: false };
  if (!v.valid) {
    el.innerHTML = '<div style="font-size:11px;color:#dc2626;">พร้อมเพย์ไม่ถูกต้อง — เบอร์มือถือ 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก</div>';
    return;
  }
  const ctx = window._depReturnCtx || {};
  const dep = _depositsCache.find(r => r.building === ctx.building && r.roomId === ctx.roomId);
  const held = window.DepositCalc ? window.DepositCalc.depositPaid(dep) : (Number(dep?.amount) || 0);
  const finalBillTotal = Number(window._depFinalBills?.total) || 0;
  const deductions = window._depPendingDeductions || [];
  const net = Math.max(0, window.DepositCalc
    ? window.DepositCalc.netRefund(held, finalBillTotal, deductions)
    : (held - finalBillTotal - _dedTotal(deductions)));
  const payload = window.DepositCalc ? window.DepositCalc.promptPayPayload(v.value, net) : null;
  if (!payload || typeof QRCode === 'undefined') {
    el.innerHTML = '<div style="font-size:11px;color:#9ca3af;">สร้าง QR ไม่ได้ (โหลด QR library ไม่สำเร็จ)</div>';
    return;
  }
  el.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'display:inline-block;padding:8px;background:white;border-radius:8px;';
  el.appendChild(box);
  try {
    new QRCode(box, { text: payload, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    el.innerHTML = '<div style="font-size:11px;color:#9ca3af;">สร้าง QR ไม่ได้</div>';
    return;
  }
  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;color:#059669;font-weight:700;margin-top:6px;';
  label.textContent = 'สแกนเพื่อโอนคืน ฿' + net.toLocaleString();
  el.appendChild(label);
}
window._genRefundQR = _genRefundQR;

function _renderDepDeductions() {
  _updateRefundSummary(); // keep the live net refund in sync on every add/remove (and 0-deduction state)
  const el = document.getElementById('dep-deductions-list');
  if (!el) return;
  const deductions = window._depPendingDeductions || [];
  if (!deductions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="background:#fef9ec;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
    ${deductions.map((d, i) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-sm);padding:3px 0;">
      <span>${_dedDesc(d)}${(d._file || d.photo) ? ` <button data-action="viewDepPendingPhoto" data-index="${i}" title="ดูรูปหลักฐาน" style="background:none;border:none;cursor:pointer;padding:0 2px;font-size:13px;line-height:1;">📎</button>` : ''}</span>
      <span style="display:flex;align-items:center;gap:8px;"><strong>฿${(Number(d.amount)||0).toLocaleString()}</strong>
        <button data-action="removeDepDeduction" data-index="${i}" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:14px;padding:0;font-family:inherit;">✕</button>
      </span>
    </div>`).join('')}
  </div>`;
}
window._renderDepDeductions = _renderDepDeductions;

// Live net-refund summary in the return modal: held − Σdeductions = what's actually paid.
// Recomputed on every add/remove so the admin sees the real payout BEFORE confirming,
// not only on the receipt afterwards. Negative net (deductions > held) = tenant still owes.
function _updateRefundSummary() {
  const el = document.getElementById('dep-ret-summary');
  if (!el) return;
  const ctx = window._depReturnCtx || {};
  const dep = _depositsCache.find(r => r.building === ctx.building && r.roomId === ctx.roomId);
  const held = window.DepositCalc ? window.DepositCalc.depositPaid(dep) : (Number(dep?.amount) || 0);
  const finalBillTotal = Number(window._depFinalBills?.total) || 0;
  const deductions = window._depPendingDeductions || [];
  const deductTotal = _dedTotal(deductions);
  const net = window.DepositCalc
    ? window.DepositCalc.netRefund(held, finalBillTotal, deductions)
    : (held - finalBillTotal - deductTotal);
  const owes = net < 0;
  const fmt = n => '฿' + (Number(n) || 0).toLocaleString();
  el.style.background = owes ? '#fef2f2' : '#f0fdf4';
  el.innerHTML = `
    ${finalBillTotal ? `<div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);">
      <span style="color:#6b7280;">บิลเดือนสุดท้าย</span><span style="color:#dc2626;">−${fmt(finalBillTotal)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);${finalBillTotal ? 'margin-top:2px;' : ''}">
      <span style="color:#6b7280;">หักความเสียหาย</span><span style="color:${deductTotal ? '#dc2626' : '#9ca3af'};">${deductTotal ? '−' : ''}${fmt(deductTotal)}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;padding-top:6px;border-top:1px solid ${owes ? '#fecaca' : '#d1fae5'};font-weight:800;">
      <span style="color:#334435;">${owes ? 'ผู้เช่าค้างเพิ่ม' : 'คืนสุทธิที่จะจ่าย'}</span>
      <span style="font-size:1.3rem;color:${owes ? '#dc2626' : '#059669'};">${fmt(Math.abs(net))}</span></div>`;
}
window._updateRefundSummary = _updateRefundSummary;

// ── Installments (Slice B): record how much of the deposit the tenant has paid ──
function showDepositInstallmentModal(building, roomId) {
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  if (!dep) return;
  const amount = Number(dep.amount) || 0;
  const paid = window.DepositCalc ? window.DepositCalc.depositPaid(dep) : amount;
  const due  = window.DepositCalc ? window.DepositCalc.depositDue(dep)  : 0;
  const fmt = n => '฿' + (Number(n) || 0).toLocaleString();
  document.getElementById('depositInstallmentModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'depositInstallmentModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
      <h3 style="margin:0 0 6px;font-size:1.1rem;color:#334435;">📝 ผ่อนมัดจำ — ห้อง ${roomId}</h3>
      <p style="margin:0 0 16px;font-size:11px;color:#9ca3af;">บันทึกยอดมัดจำที่ผู้เช่าชำระแล้วทั้งหมด — ส่วนที่เหลือถือเป็นยอดค้าง</p>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);margin-bottom:6px;"><span style="color:#6b7280;">มัดจำทั้งหมด</span><strong>${fmt(amount)}</strong></div>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);margin-bottom:14px;"><span style="color:#6b7280;">ค้างปัจจุบัน</span><strong style="color:${due>0?'#dc2626':'#059669'};">${fmt(due)}</strong></div>
      <label style="font-size:var(--fs-sm);font-weight:600;color:#374151;display:block;margin-bottom:4px;">ชำระแล้วทั้งหมด (บาท)</label>
      <input id="dep-inst-paid" type="number" min="0" max="${amount}" value="${paid}" style="width:100%;padding:9px 12px;border:1px solid ${DashColors.BORDER_LIGHT};border-radius:8px;font-family:inherit;box-sizing:border-box;font-size:1rem;">
      <div style="display:flex;gap:10px;margin-top:18px;">
        <button data-action="closeDepositInstallmentModal" style="flex:1;padding:10px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">ยกเลิก</button>
        <button data-action="saveDepositInstallment" data-id="${building}" data-arg="${roomId}" style="flex:2;padding:10px;background:#334435;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;">✅ บันทึก</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
window.showDepositInstallmentModal = showDepositInstallmentModal;

async function _saveDepositInstallment(building, roomId) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  const amount = Number(dep?.amount) || 0;
  let paidSoFar = Number(document.getElementById('dep-inst-paid')?.value);
  if (!Number.isFinite(paidSoFar) || paidSoFar < 0) paidSoFar = 0;
  if (paidSoFar > amount) paidSoFar = amount; // can't pay more than the deposit owed
  try {
    await fs.setDoc(fs.doc(db, 'deposits', `${building}_${roomId}`),
      { paidSoFar, updatedAt: new Date().toISOString() }, { merge: true });
    // Mirror to tenant SSoT so the tenant profile can surface installment progress.
    await fs.setDoc(fs.doc(db, `tenants/${building}/list/${roomId}`),
      { depositPaidSoFar: paidSoFar }, { merge: true });
    document.getElementById('depositInstallmentModal')?.remove();
    if (typeof showToast === 'function') showToast('✅ บันทึกยอดผ่อนมัดจำแล้ว');
  } catch (e) {
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}
window._saveDepositInstallment = _saveDepositInstallment;

async function _saveDepositReturn(building, roomId) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const pending    = window._depPendingDeductions || [];
  const retDate    = document.getElementById('dep-ret-date')?.value || new Date().toISOString().slice(0,10);
  const notes      = document.getElementById('dep-ret-notes')?.value || '';
  const refundBank = document.getElementById('dep-ret-bank')?.value || '';
  const ppRaw      = document.getElementById('dep-ret-promptpay')?.value || '';
  const slipFile   = document.getElementById('dep-ret-slip')?.files?.[0] || null;
  const dep        = _depositsCache.find(r => r.building === building && r.roomId === roomId);

  // PromptPay is optional, but if entered it must be a real target — a mashed number
  // must not pass as a "refunded-to" record. Validate BEFORE any write (early return).
  let refundPromptPay = '';
  if (ppRaw.trim()) {
    const v = window.DepositCalc ? window.DepositCalc.validPromptPay(ppRaw) : { valid: true, value: ppRaw.trim() };
    if (!v.valid) { alert('พร้อมเพย์ไม่ถูกต้อง — กรอกเบอร์มือถือ 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก (หรือเว้นว่างถ้าโอนผ่านบัญชีธนาคาร)'); return; }
    refundPromptPay = v.value;
  }

  // Lock the button: uploads are async, prevent a double-settle on impatient clicks.
  const saveBtn = document.querySelector('#returnDepositModal [data-action="saveDepositReturn"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก…'; }

  // Upload damage photos (optional, best-effort) → normalize to {desc, amount, photo}.
  // A flaky photo upload must NOT lose the financial settlement — record desc+amount
  // regardless, warn if any evidence upload failed.
  let uploadWarn = false;
  const deductions = [];
  for (const d of pending) {
    let photo = d.photo || '';
    if (d._file) {
      try { photo = await _uploadDepositFile(building, roomId, d._file, 'damage'); }
      catch (e) { uploadWarn = true; console.warn('[deposit] damage photo upload failed:', e?.message || e); }
    }
    deductions.push({ desc: _dedDesc(d), amount: Number(d.amount) || 0, photo: photo || '' });
  }

  // Upload refund transfer slip (optional, best-effort) — closes the "ไม่ได้คืน" dispute.
  let refundSlip = dep?.refundSlip || '';
  if (slipFile) {
    try { refundSlip = await _uploadDepositFile(building, roomId, slipFile, 'slip'); }
    catch (e) { uploadWarn = true; console.warn('[deposit] refund slip upload failed:', e?.message || e); }
  }

  const deductTotal    = _dedTotal(deductions);
  const held           = window.DepositCalc ? window.DepositCalc.depositPaid(dep) : (Number(dep?.amount)||0);
  const finalBills     = window._depFinalBills || { bills: [], total: 0 };
  const finalBillTotal = Number(finalBills.total) || 0;
  const returnedAmount = window.DepositCalc
    ? window.DepositCalc.netRefund(held, finalBillTotal, deductions)
    : (held - finalBillTotal - deductTotal); // spec §1.3: held − final bill − damage
  const settledBills   = (finalBills.bills || []).map(b => ({ key: b.key, billId: b.billId, total: b.total }));
  try {
    await fs.setDoc(fs.doc(db, 'deposits', `${building}_${roomId}`), {
      building, roomId,
      tenantId: dep?.tenantId || '',   // preserve the owning tenancy → archived to history/ on the next turnover
      amount: Number(dep?.amount) || 0,
      paidSoFar: held,                 // preserve the installment-held amount on the settled record
      status: 'returned',
      receivedAt: dep?.receivedAt || null,
      returnedAt: retDate,
      returnedAmount,
      deductions,
      finalBillTotal,                  // spec §1.3: last/unpaid bill absorbed by the deposit
      settledBills,                    // which bills were marked paid-from-deposit
      refundBank,
      refundPromptPay,
      refundSlip,                      // Storage path — kept as move-out evidence (viewable in the gallery)
      notes,
      updatedAt: new Date().toISOString()
    });
    // Mirror status to tenant SSoT so tenant profile page can show badge
    await fs.setDoc(
      fs.doc(db, `tenants/${building}/list/${roomId}`),
      { depositStatus: 'returned', depositReturnedAt: retDate },
      { merge: true }
    );

    // Mark the room's final/unpaid bills paid-from-deposit (spec §1.3 — the deposit
    // absorbs them). Partial firebaseUpdate preserves charges; flips status + paidVia
    // so arrears clears + revenue counts them collected. Best-effort per bill: a failed
    // one warns but never loses the settlement (§7-DD deposit+bills cross-write).
    let billWarn = false;
    if (finalBills.bills.length && window.firebaseUpdate && window.firebaseRef && window.firebaseDatabase) {
      const paidAt = new Date().toISOString();
      for (const b of finalBills.bills) {
        try {
          await window.firebaseUpdate(window.firebaseRef(window.firebaseDatabase, b.path), {
            status: 'paid', paidVia: 'deposit_settlement', paidAt, paidRef: `deposit_${building}_${roomId}`,
          });
        } catch (e) { billWarn = true; console.warn('[deposit] mark final bill paid failed:', b.path, e?.message || e); }
      }
    }

    // Immutable settlement audit row — a deposit return is a financial mutation an
    // auditor must trace. recordAdminAction stamps actor/role/ip/time server-side;
    // fired AFTER the write, non-blocking (§7-I observe-only). +DEPOSIT_RETURNED in
    // _actionAudit.js VALID_ACTIONS (redeploy recordAdminAction).
    try {
      const _recordAudit = window.firebase?.functions?.httpsCallable?.('recordAdminAction');
      if (_recordAudit) {
        _recordAudit({
          action: 'DEPOSIT_RETURNED',
          targetType: 'deposit',
          targetId: `${building}_${roomId}`,
          building, roomId,
          after: { returnedAmount, finalBillTotal, settledBillIds: settledBills.map(b => b.billId || b.key), deductionTotal: deductTotal, deductionCount: deductions.length, refundBank: refundBank || null },
          note: notes || null,
        }).catch((e) => console.warn('[audit] recordAdminAction failed:', e?.message || e));
      }
    } catch (e) { console.warn('[audit] recordAdminAction skipped:', e?.message || e); }

    document.getElementById('returnDepositModal')?.remove();
    if (typeof showToast === 'function') {
      showToast((uploadWarn || billWarn) ? '✅ บันทึกคืนมัดจำแล้ว (บางรายการอัปโหลด/อัปเดตบิลไม่สำเร็จ)' : '✅ บันทึกคืนมัดจำแล้ว');
    }
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✅ ยืนยันคืนมัดจำ'; }
    alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}
window._saveDepositReturn = _saveDepositReturn;

// ── Evidence viewing ────────────────────────────────────────────────────────
// The settlement evidence (damage photos + refund slip) is the whole point of
// keeping it: an admin must be able to review it retrospectively and compare a
// room's move-out condition against the next tenant. Upload alone is useless if
// it can't be opened again.

// Inline lightbox for a freshly-picked (not-yet-uploaded) evidence File. Reads
// it as a data: URL — the DEPLOYED dashboard CSP allows `img-src data:` but NOT
// `blob:` (the live header is set in Vercel project settings and omits blob:,
// even though vercel.json lists it — §7-XX). A `blob:` <img> is blocked live.
// PDFs can't preview inline here (Chrome blocks top-level data: navigation and
// frame-src lacks data:) → settled-evidence gallery shows them post-save.
function _previewDepFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (isPdf) {
    if (typeof showToast === 'function') showToast('ไฟล์ PDF ดูได้หลังบันทึก (ปุ่ม 📎 ดูหลักฐาน)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    if (!dataUrl) return;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out;';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);';
    ov.appendChild(img);
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  };
  reader.onerror = () => { if (typeof showToast === 'function') showToast('เปิดรูปไม่สำเร็จ'); };
  reader.readAsDataURL(file);
}
window._previewDepFile = _previewDepFile;

// View a pending deduction's attached evidence — a local File preview (common
// case: admin just picked it and wants to confirm) or, defensively, an already-
// saved Storage path if the row carried one.
async function _viewDepPendingPhoto(idx) {
  const d = (window._depPendingDeductions || [])[idx];
  if (!d) return;
  if (d._file) { _previewDepFile(d._file); return; }
  if (d.photo) {
    const sf = window.firebase?.storageFunctions, st = window.firebase?.storage?.();
    if (!sf || !st) return;
    try { window.open(await sf.getDownloadURL(sf.ref(st, d.photo)), '_blank', 'noopener,noreferrer'); }
    catch (e) { console.warn('[deposit] evidence load failed:', e?.message || e); }
  }
}
window._viewDepPendingPhoto = _viewDepPendingPhoto;

// Preview the currently-selected refund slip File before upload — same lightbox
// as the damage photos. Lets the admin confirm the right slip was picked.
function _previewRefundSlipFile() {
  const f = document.getElementById('dep-ret-slip')?.files?.[0] || null;
  if (!f) {
    const el = document.getElementById('dep-ret-slip-result');
    if (el) el.innerHTML = '<div style="font-size:11px;color:#9ca3af;">เลือกไฟล์สลิปก่อนกดดู</div>';
    return;
  }
  _previewDepFile(f);
}
window._previewRefundSlipFile = _previewRefundSlipFile;

// Retrospective evidence gallery for a deposit — the latest settlement's damage
// photos + refund slip, PLUS a collapsible sub-gallery per archived prior tenancy
// (deposits/{building}_{roomId}/history/, Item B step 4) so a room's move-out
// condition can be compared across successive tenants. Storage paths resolve to
// download URLs (admin read grant on storage.rules); images load lazily, PDFs open
// in a tab. History reads degrade silently if its rules aren't deployed yet (#260) —
// no turnover has archived anything until then anyway.
async function showDepositEvidence(building, roomId) {
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  if (!dep) return;
  document.getElementById('depEvidenceModal')?.remove();
  const _esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const fmt = n => '฿' + (Number(n) || 0).toLocaleString();
  const subtitle = dep.status === 'returned' ? `คืนเมื่อ ${_fmtDepDate(dep.returnedAt)}` : 'ปัจจุบัน: ถือมัดจำอยู่';

  const modal = document.createElement('div');
  modal.id = 'depEvidenceModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:460px;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.28);">
      <div style="flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 22px 14px;border-bottom:1px solid #eef0ee;">
        <div>
          <h3 style="margin:0;font-size:1.05rem;color:#334435;font-weight:800;">📎 หลักฐานมัดจำ</h3>
          <div style="font-size:var(--fs-sm);color:#6b7280;margin-top:2px;">ห้อง ${_esc(roomId)} <span style="color:#9ca3af;">· ${_esc(building)}</span> · ${subtitle}</div>
        </div>
        <button data-action="closeDepEvidenceModal" title="ปิด" style="background:none;border:none;font-size:24px;cursor:pointer;color:#9ca3af;line-height:1;padding:0;flex-shrink:0;">×</button>
      </div>
      <div id="dep-evidence-body" style="flex:1 1 auto;overflow-y:auto;padding:16px 22px;min-height:120px;">
        <div style="text-align:center;color:#9ca3af;font-size:var(--fs-sm);padding:1.5rem;">⏳ กำลังโหลดหลักฐาน…</div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); }); // backdrop close

  const body = document.getElementById('dep-evidence-body');
  const sf = window.firebase?.storageFunctions;
  const st = window.firebase?.storage?.();
  if (!sf || !st) { if (body) body.innerHTML = '<div style="color:#dc2626;font-size:var(--fs-sm);">Firebase Storage ยังไม่พร้อม</div>'; return; }

  // Pull every damage photo + refund slip off a settlement-shaped object — the live
  // doc OR a history snapshot (both carry deductions[] + refundSlip).
  const collect = s => {
    const items = [];
    (s.deductions || []).forEach(d => { if (d.photo) items.push({ kind: 'deduction', label: _dedDesc(d), amount: d.amount, path: d.photo }); });
    if (s.refundSlip) items.push({ kind: 'slip', label: 'สลิปโอนคืน', path: s.refundSlip });
    return items;
  };
  const resolve = items => Promise.all(items.map(async it => {
    try { return { ...it, url: await sf.getDownloadURL(sf.ref(st, it.path)), isPdf: /\.pdf($|\?)/i.test(it.path) }; }
    catch (e) { return { ...it, url: null, err: e?.message || 'load failed' }; }
  }));
  const card = it => {
    const head = it.kind === 'slip'
      ? `<span style="font-weight:700;color:#065f46;">🧾 ${_esc(it.label)}</span>`
      : `<span style="font-weight:600;color:#374151;">${_esc(it.label)}</span>${it.amount != null ? `<span style="color:#dc2626;font-weight:700;margin-left:6px;">${fmt(it.amount)}</span>` : ''}`;
    let media;
    if (!it.url) media = `<div style="color:#dc2626;font-size:11px;">โหลดไม่สำเร็จ${it.err ? ': ' + _esc(it.err) : ''}</div>`;
    else if (it.isPdf) media = `<a href="${_esc(it.url)}" target="_blank" rel="noopener noreferrer" style="color:#2d8653;font-weight:600;font-size:var(--fs-sm);">📄 เปิดไฟล์ PDF →</a>`;
    else media = `<a href="${_esc(it.url)}" target="_blank" rel="noopener noreferrer"><img src="${_esc(it.url)}" loading="lazy" alt="${_esc(it.label)}" style="width:100%;max-height:260px;object-fit:contain;background:#f8fafc;border-radius:8px;border:1px solid #eef0ee;display:block;"></a>`;
    return `<div style="margin-bottom:14px;"><div style="font-size:var(--fs-sm);margin-bottom:6px;">${head}</div>${media}</div>`;
  };
  const gallery = resolved => resolved.length ? resolved.map(card).join('') : '<div style="color:#9ca3af;font-size:11px;padding:4px 0 10px;">ไม่มีรูปหลักฐานในรอบนี้</div>';

  // 1) Latest settlement on the live doc (empty for a fresh holding — that's fine,
  //    the history section below still renders for a turned-over room).
  const curResolved = await resolve(collect(dep));

  // 2) Archived prior tenancies. Degrades silently if the history rules aren't live
  //    yet (#260) or none exist; each prior settlement is its own collapsible gallery.
  let histHtml = '';
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    const docId = `${building}_${roomId}`;
    const hsnap = await fs.getDocs(fs.collection(db, `deposits/${docId}/history`));
    const hist = hsnap.docs.map(hd => hd.data())
      .sort((a, b) => String(b.returnedAt || b.archivedAt || '').localeCompare(String(a.returnedAt || a.archivedAt || '')));
    if (hist.length) {
      const blocks = await Promise.all(hist.map(async h => {
        let name = '';
        try { const p = await window.PersonManager?.getPerson?.(h.tenantId); name = (p && (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim())) || ''; }
        catch (_) { /* person fetch failed — label by truncated id */ }
        const who = name || ('ผู้เช่าเดิม #' + String(h.tenantId || '').slice(0, 6));
        const resolved = await resolve(collect(h));
        return `<details style="border:1px solid #eef0ee;border-radius:10px;margin-bottom:10px;background:#fafbfa;">
          <summary style="cursor:pointer;padding:10px 12px;font-size:var(--fs-sm);font-weight:700;color:#334435;">👤 ${_esc(who)} <span style="color:#9ca3af;font-weight:400;">· คืน ${_fmtDepDate(h.returnedAt)} · สุทธิ ${fmt(h.returnedAmount)}</span></summary>
          <div style="padding:4px 12px 8px;">${gallery(resolved)}</div>
        </details>`;
      }));
      histHtml = `<div style="margin-top:8px;border-top:1px dashed #e5e7eb;padding-top:14px;">
        <div style="font-size:var(--fs-sm);font-weight:800;color:#6b7280;margin-bottom:10px;">📜 ประวัติผู้เช่าก่อนหน้า (${hist.length})</div>
        ${blocks.join('')}</div>`;
    }
  } catch (e) { console.warn('[deposit] history load skipped:', e?.message || e); }

  if (!document.getElementById('depEvidenceModal')) return; // closed while loading
  let html = '';
  if (curResolved.length) {
    if (histHtml) html += '<div style="font-size:var(--fs-sm);font-weight:800;color:#334435;margin-bottom:10px;">การคืนล่าสุด</div>';
    html += curResolved.map(card).join('');
  }
  html += histHtml;
  if (!html) html = '<div style="color:#9ca3af;font-size:var(--fs-sm);text-align:center;padding:1rem;">ไม่มีรูปหลักฐานแนบไว้สำหรับห้องนี้</div>';
  if (body) body.innerHTML = html;
}
window.showDepositEvidence = showDepositEvidence;

async function exportDepositReceipt(building, roomId) {
  const dep = _depositsCache.find(r => r.building === building && r.roomId === roomId);
  if (!dep) return;
  const deductTotal = _dedTotal(dep.deductions);
  const finalBillTotal = Number(dep.finalBillTotal) || 0;
  const held = window.DepositCalc ? window.DepositCalc.depositPaid(dep) : (Number(dep.amount)||0);
  const netRefund = held - finalBillTotal - deductTotal;
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
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">วันที่รับ / Received</td><td style="text-align:right;">${_fmtDepDate(dep.receivedAt)}</td></tr>
      <tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">วันที่คืน / Returned</td><td style="text-align:right;">${_fmtDepDate(dep.returnedAt)}</td></tr>
      ${dep.refundPromptPay ? `<tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">พร้อมเพย์ / PromptPay</td><td style="text-align:right;">${dep.refundPromptPay}</td></tr>` : ''}
      ${dep.refundBank ? `<tr><td style="padding:4px 0;color:${DashColors.TEXT_SECONDARY};">บัญชี / Account</td><td style="text-align:right;">${dep.refundBank}</td></tr>` : ''}
    </table>
    ${finalBillTotal ? `
    <div style="margin-top:12px;padding:10px;background:#fef9ec;border-radius:8px;font-size:12px;display:flex;justify-content:space-between;font-weight:700;">
      <span style="color:#92400e;">บิลเดือนสุดท้าย / Final bill</span><span style="color:#dc2626;">−${fmt(finalBillTotal)}</span>
    </div>` : ''}
    ${(dep.deductions||[]).length ? `
    <div style="margin-top:12px;padding:10px;background:#fef9ec;border-radius:8px;font-size:12px;">
      <div style="font-weight:700;color:#92400e;margin-bottom:6px;">รายการหัก / Deductions</div>
      ${(dep.deductions||[]).map(d=>`<div style="display:flex;justify-content:space-between;"><span>${_dedDesc(d)}</span><span>${fmt(d.amount)}</span></div>`).join('')}
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
    // html2canvas clones the WHOLE dashboard to resolve styles, producing two kinds of
    // console noise under the enforced CSP:
    //   1. it clones the dashboard's tainted Chart.js canvas (`chartYears`) → "Unable to
    //      clone canvas as it is tainted". The receipt has NO canvas of its own →
    //      `ignoreElements` skips all canvases.
    //   2. it re-injects the cloned page <style> blocks + a pseudoelement-reset <style>
    //      into its render iframe → blocked by `style-src-elem`. Verified via a real-
    //      html2canvas harness: stripping <style>/<link> from the clone in `onclone`
    //      removes BOTH injected styles (0 left) → zero CSP violations, and the receipt
    //      still renders identically (it is 100% inline style="", so the page stylesheets
    //      are not needed to paint it). Robust — no fragile per-version hash to maintain.
    const canvas = await html2canvas(wrap, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff',
      ignoreElements: (el) => el.nodeName === 'CANVAS',
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => n.remove());
      },
    });
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
