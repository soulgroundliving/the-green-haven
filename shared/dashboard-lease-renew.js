// shared/dashboard-lease-renew.js
//
// Admin UI for the renewLease CF (functions/renewLease.js — S1-S3).
//
// Wired via tenant modal button (data-action="openRenewLeaseModal") + the
// dashboard-main.js dispatcher. Modal is built lazily on first open and
// removed on close — keeps dashboard.html surface footprint to one button.
//
// Dual mode:
//   - 'renewal'  (DEFAULT) — re-sign + new lease doc. Rent/deposit + document
//                            fields are shown. Maps to CF's novation branch.
//   - 'extension' (toggle) — same lease, stretched endDate via arrayUnion.
//                            Hides rent/deposit/document fields (CF rejects
//                            them in this mode). Notes still allowed.
//
// On submit the CF runs the §7-DD batch; this script handles loading state,
// toast, modal close, and tenant-page refresh.
//
// See tasks/todo.md ## Files Touched · D2 = (a) NEW shared/dashboard-lease-renew.js
'use strict';

const _escLR = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const _LR_MODAL_ID = 'gh-renew-lease-modal';

// Resolve the current edit context + active lease for prefill. Returns null
// (with toast surfaced) if anything is missing — caller bails.
function _lrResolveContext() {
  const building = window.currentEditBuilding;
  const roomId = window.currentEditRoomId;
  if (!building || !roomId) {
    if (typeof showToast === 'function') {
      showToast('ไม่พบข้อมูลห้อง — เปิด tenant modal ก่อนแล้วลองใหม่', 'error');
    }
    return null;
  }
  if (typeof TenantLookup === 'undefined' || typeof LeaseAgreementManager === 'undefined') {
    if (typeof showToast === 'function') {
      showToast('โหลด tenant/lease modules ไม่สำเร็จ — รีโหลดหน้า', 'error');
    }
    return null;
  }
  const tenant = TenantLookup.getTenantByRoom(building, roomId) || {};
  const lease = LeaseAgreementManager.getActiveLease(building, roomId);
  if (!lease) {
    if (typeof showToast === 'function') {
      showToast(`ห้อง ${roomId} ไม่มีสัญญา active — ต่อไม่ได้`, 'info');
    }
    return null;
  }
  const tenantName = String(tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`).trim()
    || lease.tenantName || '(ไม่ระบุชื่อ)';
  return { building, roomId, tenant, tenantName, lease };
}

// ISO date string in input[type=date] format (yyyy-mm-dd). Falls back to '' if
// the source is unparseable.
function _lrDateInputValue(d) {
  if (!d) return '';
  const dt = (typeof d.toDate === 'function') ? d.toDate() : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

// Default new end date — 1 year after current end. Used to prefill the date
// input so the common case (admin extending +1yr) is a 1-click flow.
function _lrSuggestNewEndDate(currentEnd) {
  const base = currentEnd ? new Date(currentEnd) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  const next = new Date(base);
  next.setFullYear(next.getFullYear() + 1);
  return next.toISOString().slice(0, 10);
}

function _lrBuildModalHtml(ctx) {
  const { building, roomId, tenantName, lease } = ctx;
  const oldEndIso = _lrDateInputValue(lease.moveOutDate || lease.endDate);
  const suggested = _lrSuggestNewEndDate(lease.moveOutDate || lease.endDate);
  const oldRent = Number(lease.rentAmount) || 0;
  const oldDeposit = Number(lease.deposit) || 0;
  const buildingLabel = building === 'rooms' ? 'Rooms' : building === 'nest' ? 'Nest' : _escLR(building);

  return `
  <div id="${_LR_MODAL_ID}" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;">
    <div style="background:#fff;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;border-radius:var(--radius,12px);box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:var(--font-brand);display:flex;flex-direction:column;">
      <div style="padding:1.5rem 2rem;background:linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);color:#fff;border-radius:var(--radius,12px) var(--radius,12px) 0 0;">
        <h2 style="margin:0;font-size:1.15rem;font-weight:700;">📝 ต่อสัญญา</h2>
        <div style="margin-top:6px;font-size:.85rem;opacity:.92;">${_escLR(buildingLabel)} · ห้อง ${_escLR(roomId)} · ${_escLR(tenantName)}</div>
      </div>

      <div style="padding:1.25rem 2rem;background:#fafafa;border-bottom:1px solid var(--border,#e5e7eb);">
        <div style="font-size:.78rem;color:var(--text-muted,#6b7280);font-weight:600;margin-bottom:6px;">สัญญาปัจจุบัน</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.88rem;">
          <div><strong>สิ้นสุด:</strong> ${oldEndIso || '—'}</div>
          <div><strong>ค่าเช่า:</strong> ฿${oldRent.toLocaleString()}</div>
          <div><strong>มัดจำ:</strong> ฿${oldDeposit.toLocaleString()}</div>
          <div style="font-size:.78rem;color:var(--text-muted,#6b7280);">leaseId: ${_escLR(lease.id || lease.leaseId || '')}</div>
        </div>
      </div>

      <form id="gh-lr-form" style="padding:1.5rem 2rem;display:flex;flex-direction:column;gap:1rem;flex:1;">
        <div>
          <label style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">รูปแบบการต่อสัญญา</label>
          <div role="radiogroup" style="display:flex;gap:0;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);overflow:hidden;">
            <label style="flex:1;cursor:pointer;">
              <input type="radio" name="gh-lr-mode" value="renewal" checked style="display:none;">
              <div data-mode-tab="renewal" style="padding:10px 12px;text-align:center;background:var(--green-pale,#e8f5e9);color:var(--green-dark,#1b5e20);font-weight:700;font-size:.85rem;transition:all .15s;">📄 ต่อสัญญาใหม่<br><span style="font-weight:400;font-size:.72rem;opacity:.8;">เซ็นสัญญาใหม่ · เปลี่ยนค่าเช่า/มัดจำได้</span></div>
            </label>
            <label style="flex:1;cursor:pointer;border-left:1px solid var(--border,#e5e7eb);">
              <input type="radio" name="gh-lr-mode" value="extension" style="display:none;">
              <div data-mode-tab="extension" style="padding:10px 12px;text-align:center;background:#fff;color:var(--text-muted,#6b7280);font-weight:600;font-size:.85rem;transition:all .15s;">⏩ ขยายระยะเวลา<br><span style="font-weight:400;font-size:.72rem;opacity:.8;">สัญญาเดิม · ขยาย endDate เท่านั้น</span></div>
            </label>
          </div>
        </div>

        <div>
          <label for="gh-lr-end" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">วันสิ้นสุดสัญญาใหม่ <span style="color:var(--red,#c62828);">*</span></label>
          <input type="date" id="gh-lr-end" required value="${_escLR(suggested)}"
            min="${_escLR(oldEndIso)}"
            style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
          <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">ต้องเป็นวันหลังจาก ${oldEndIso || 'วันสิ้นสุดเดิม'}</div>
        </div>

        <div data-renewal-only style="display:flex;flex-direction:column;gap:1rem;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div>
              <label for="gh-lr-rent" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">ค่าเช่าใหม่ (฿)</label>
              <input type="number" id="gh-lr-rent" placeholder="${oldRent}" min="1"
                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
              <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">เว้นว่างหากไม่เปลี่ยน</div>
            </div>
            <div>
              <label for="gh-lr-deposit" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">มัดจำใหม่ (฿)</label>
              <input type="number" id="gh-lr-deposit" placeholder="${oldDeposit}" min="0"
                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
              <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">เว้นว่างหากไม่เปลี่ยน</div>
            </div>
          </div>

          <div>
            <label for="gh-lr-doc" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">เอกสารสัญญาใหม่ (Storage path / URL)</label>
            <input type="text" id="gh-lr-doc" placeholder="gs://... หรือ https://..."
              style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.85rem;">
            <div style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">อัพโหลดไฟล์ผ่าน tab "เอกสาร" ของผู้เช่าก่อน แล้ววางลิงก์ตรงนี้</div>
          </div>
        </div>

        <div>
          <label for="gh-lr-notes" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">หมายเหตุ</label>
          <textarea id="gh-lr-notes" rows="2" placeholder="เช่น ตกลงค่าเช่าใหม่กับผู้เช่าแล้ว, แนบใบเสร็จมัดจำเพิ่ม..."
            style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.85rem;resize:vertical;"></textarea>
        </div>

        <div id="gh-lr-error" style="display:none;color:var(--red-dark,#b71c1c);font-size:.85rem;font-weight:600;padding:8px 12px;background:#ffebee;border-radius:var(--radius-sm,8px);"></div>
      </form>

      <div style="padding:1rem 2rem;background:#f9fafb;border-top:1px solid var(--border,#e5e7eb);display:flex;gap:12px;flex-shrink:0;">
        <button type="button" data-lr-cancel style="flex:1;padding:12px 20px;background:var(--border,#e5e7eb);color:var(--text,#1f2937);border:none;border-radius:var(--radius-sm,8px);font-family:inherit;font-weight:700;cursor:pointer;font-size:.92rem;">ยกเลิก</button>
        <button type="button" data-lr-submit style="flex:2;padding:12px 20px;background:linear-gradient(135deg, var(--green,#2d8653) 0%, var(--green-dark,#1b5e20) 100%);color:#fff;border:none;border-radius:var(--radius-sm,8px);font-family:inherit;font-weight:700;cursor:pointer;font-size:.92rem;">📝 ต่อสัญญา</button>
      </div>
    </div>
  </div>`;
}

function _lrClose() {
  const modal = document.getElementById(_LR_MODAL_ID);
  if (modal) modal.remove();
}

function _lrSwitchModeUi(modal, mode) {
  modal.querySelectorAll('[data-mode-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-mode-tab') === mode;
    tab.style.background = active ? 'var(--green-pale, #e8f5e9)' : '#fff';
    tab.style.color = active ? 'var(--green-dark, #1b5e20)' : 'var(--text-muted, #6b7280)';
    tab.style.fontWeight = active ? '700' : '600';
  });
  // Hide rent/deposit/document in extension mode (CF rejects them there)
  const renewalOnly = modal.querySelector('[data-renewal-only]');
  if (renewalOnly) renewalOnly.style.display = (mode === 'extension') ? 'none' : 'flex';

  // Update submit button label to match action
  const btn = modal.querySelector('[data-lr-submit]');
  if (btn) btn.textContent = (mode === 'extension') ? '⏩ ขยายระยะเวลา' : '📝 ต่อสัญญา';
}

function _lrShowError(modal, msg) {
  const el = modal.querySelector('#gh-lr-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function _lrCollectInputs(modal) {
  const mode = (modal.querySelector('input[name="gh-lr-mode"]:checked') || {}).value || 'renewal';
  const newEndDate = (modal.querySelector('#gh-lr-end') || {}).value || '';
  const rentRaw = (modal.querySelector('#gh-lr-rent') || {}).value || '';
  const depositRaw = (modal.querySelector('#gh-lr-deposit') || {}).value || '';
  const docRaw = (modal.querySelector('#gh-lr-doc') || {}).value || '';
  const notes = (modal.querySelector('#gh-lr-notes') || {}).value || '';
  return { mode, newEndDate, rentRaw, depositRaw, docRaw, notes };
}

async function _lrSubmit(ctx) {
  const modal = document.getElementById(_LR_MODAL_ID);
  if (!modal) return;
  _lrShowError(modal, '');

  const { mode, newEndDate, rentRaw, depositRaw, docRaw, notes } = _lrCollectInputs(modal);
  const { building, roomId, lease } = ctx;

  // Client-side validation — mirror CF rules so admin sees the error
  // immediately without the network round-trip.
  if (!newEndDate) {
    _lrShowError(modal, 'กรุณากรอกวันสิ้นสุดใหม่');
    return;
  }
  const parsed = new Date(newEndDate);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    _lrShowError(modal, 'วันสิ้นสุดใหม่ต้องอยู่ในอนาคต');
    return;
  }
  const oldEnd = new Date(lease.moveOutDate || lease.endDate || 0);
  if (!Number.isNaN(oldEnd.getTime()) && parsed.getTime() <= oldEnd.getTime()) {
    _lrShowError(modal, `วันสิ้นสุดใหม่ต้องอยู่หลังวันสิ้นสุดเดิม (${oldEnd.toISOString().slice(0, 10)})`);
    return;
  }

  const payload = {
    building, roomId, mode,
    newEndDate: parsed.toISOString(),
    notes: notes.trim(),
  };
  if (mode === 'renewal') {
    if (rentRaw !== '') {
      const n = Number(rentRaw);
      if (!Number.isFinite(n) || n <= 0) {
        _lrShowError(modal, 'ค่าเช่าใหม่ต้องเป็นตัวเลขมากกว่า 0');
        return;
      }
      payload.newRentAmount = n;
    }
    if (depositRaw !== '') {
      const n = Number(depositRaw);
      if (!Number.isFinite(n) || n < 0) {
        _lrShowError(modal, 'มัดจำใหม่ต้องเป็นตัวเลข >= 0');
        return;
      }
      payload.newDeposit = n;
    }
    if (docRaw.trim()) {
      payload.contractDocument = docRaw.trim();
    }
  }

  if (!window.firebase?.functions?.httpsCallable) {
    _lrShowError(modal, 'Firebase functions ไม่พร้อม — รีโหลดหน้า');
    return;
  }

  // Loading state
  const submitBtn = modal.querySelector('[data-lr-submit]');
  const cancelBtn = modal.querySelector('[data-lr-cancel]');
  const originalLabel = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก…';
    submitBtn.style.opacity = '.7';
    submitBtn.style.cursor = 'wait';
  }
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const callable = window.firebase.functions.httpsCallable('renewLease');
    const res = await callable(payload);
    const data = res?.data || {};

    if (typeof showToast === 'function') {
      const msg = (mode === 'renewal')
        ? `✓ ต่อสัญญา (ใหม่) สำเร็จ — leaseId=${data.newLeaseId || ''}`
        : `✓ ขยายระยะเวลาสำเร็จ — entry #${data.extensionCountAfter || ''}`;
      showToast(msg, 'success');
    }

    _lrClose();
    if (typeof closeTenantModal === 'function') closeTenantModal();

    // Refresh tenant page so admin sees the new endDate
    if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
    if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
    if (typeof renderTenantPage === 'function') renderTenantPage();
    if (typeof refreshLeasesFromFirestore === 'function') {
      try { await refreshLeasesFromFirestore(); } catch (_) { /* best-effort */ }
    }
  } catch (e) {
    console.error('renewLease call failed:', e);
    const msg = (e && (e.message || e.code)) || String(e);
    _lrShowError(modal, 'ต่อสัญญาไม่สำเร็จ: ' + msg);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel || '📝 ต่อสัญญา';
      submitBtn.style.opacity = '';
      submitBtn.style.cursor = '';
    }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function _lrAttachHandlers(modal, ctx) {
  // Backdrop click = cancel
  modal.addEventListener('click', (e) => {
    if (e.target === modal) _lrClose();
  });
  // Cancel button
  const cancelBtn = modal.querySelector('[data-lr-cancel]');
  if (cancelBtn) cancelBtn.addEventListener('click', _lrClose);
  // Mode toggle
  modal.querySelectorAll('input[name="gh-lr-mode"]').forEach((input) => {
    input.addEventListener('change', (e) => _lrSwitchModeUi(modal, e.target.value));
  });
  // Submit
  const submitBtn = modal.querySelector('[data-lr-submit]');
  if (submitBtn) submitBtn.addEventListener('click', () => _lrSubmit(ctx));
  // Enter key in form fields submits (except in textarea)
  const form = modal.querySelector('#gh-lr-form');
  if (form) {
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        _lrSubmit(ctx);
      }
    });
  }
}

function openRenewLeaseModal() {
  // Already open? noop
  if (document.getElementById(_LR_MODAL_ID)) return;
  const ctx = _lrResolveContext();
  if (!ctx) return;

  const html = _lrBuildModalHtml(ctx);
  const container = document.createElement('div');
  container.innerHTML = html;
  const modal = container.firstElementChild;
  document.body.appendChild(modal);
  _lrAttachHandlers(modal, ctx);

  // Focus the end-date input after mount
  const endInput = modal.querySelector('#gh-lr-end');
  if (endInput) setTimeout(() => endInput.focus(), 50);
}

window.openRenewLeaseModal = openRenewLeaseModal;
