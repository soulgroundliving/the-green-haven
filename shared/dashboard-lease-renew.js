// shared/dashboard-lease-renew.js
//
// Admin UI for the lease-action composite flow:
//   - functions/renewLease.js  (same-room renewal/extension)
//   - functions/transferTenant.js (room change — variation/novation)
//
// Wired via tenant modal button (data-action="openRenewLeaseModal") + the
// dashboard-main.js dispatcher. Modal is built lazily on first open and
// removed on close — keeps dashboard.html surface footprint to one button.
//
// Two orthogonal toggles drive dispatch:
//
//   roomMode ∈ { 'same', 'new' }              ← "ห้องเดิม" vs "ย้ายไปห้องใหม่"
//   actionMode (same-room only) ∈ { 'renewal', 'extension' }
//
// Dispatch matrix:
//   roomMode='same', actionMode='renewal'   → renewLease  (mode='renewal')
//   roomMode='same', actionMode='extension' → renewLease  (mode='extension')
//   roomMode='new', transferOnly=true       → transferTenant only
//   roomMode='new', transferOnly=false      → transferTenant THEN renewLease@newRoom
//
// "Reduce data entry" UX guarantee (per user feedback 2026-05-21 evening 5):
//   - identity (name, phone, tenantId) carries automatically across all paths
//   - room change auto-fills rent/deposit from buildings/{b}/rooms/{newR}
//   - newStartDate defaults to today for transfers, oldEndDate for renewals
//
// On success the CF(s) run §7-DD/§7-FF batches; this script handles loading
// state, sequential dispatch (with mid-flight failure messaging), toast,
// modal close, and tenant-page refresh.
'use strict';

const _escLR = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const _LR_MODAL_ID = 'gh-renew-lease-modal';
const _LR_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches dashboard-tenant-lease

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

// Upload one contract file to Storage. Returns Storage path on success.
// Throws on too-large file or upload error — caller surfaces to UI.
async function _lrUploadContractFile(file, building, roomId, leaseId) {
  if (!file) return '';
  if (file.size > _LR_UPLOAD_MAX_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกิน 5MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  }
  const storage = window.firebase.storage();
  const { ref: sRef, uploadBytes, getDownloadURL } = window.firebase.storageFunctions;
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const fileName = `lease-renewal-${Date.now()}.${ext}`;
  const storagePath = `leases/${building}/${roomId}/${leaseId || 'pending'}/${fileName}`;
  const fileRef = sRef(storage, storagePath);
  const snapshot = await uploadBytes(fileRef, file);
  // Probe download URL to surface auth errors early (best-effort; don't fail upload)
  try { await getDownloadURL(snapshot.ref); } catch (_) { /* OK */ }
  return storagePath;
}

function _lrBuildModalHtml(ctx) {
  const { building, roomId, tenantName, lease } = ctx;
  const oldEndIso = _lrDateInputValue(lease.moveOutDate || lease.endDate);
  const suggestedEnd = _lrSuggestNewEndDate(lease.moveOutDate || lease.endDate);
  const oldStartIso = _lrDateInputValue(lease.contractStart || lease.moveInDate);
  const oldRent = Number(lease.rentAmount) || 0;
  const oldDeposit = Number(lease.deposit) || 0;
  const buildings = window.LRRoomPicker.loadBuildings();
  const buildingLabel = (buildings.find((b) => b.id === building) || {}).label || building;

  const buildingOpts = buildings
    .map((b) => `<option value="${_escLR(b.id)}"${b.id === building ? ' selected' : ''}>${_escLR(b.label)}</option>`)
    .join('');

  return `
  <div id="${_LR_MODAL_ID}" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;">
    <div style="background:#fff;width:100%;max-width:620px;max-height:92vh;overflow-y:auto;border-radius:var(--radius,12px);box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:var(--font-brand);display:flex;flex-direction:column;">
      <div style="padding:1.5rem 2rem;background:linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);color:#fff;border-radius:var(--radius,12px) var(--radius,12px) 0 0;">
        <h2 style="margin:0;font-size:1.15rem;font-weight:700;">📝 ต่อสัญญา / ย้ายห้อง</h2>
        <div style="margin-top:6px;font-size:.85rem;opacity:.92;">${_escLR(buildingLabel)} · ห้อง ${_escLR(roomId)} · ${_escLR(tenantName)}</div>
      </div>

      <div style="padding:1.25rem 2rem;background:#fafafa;border-bottom:1px solid var(--border,#e5e7eb);">
        <div style="font-size:.78rem;color:var(--text-muted,#6b7280);font-weight:600;margin-bottom:6px;">สัญญาปัจจุบัน</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.88rem;">
          <div><strong>เริ่ม:</strong> ${oldStartIso || '—'}</div>
          <div><strong>สิ้นสุด:</strong> ${oldEndIso || '—'}</div>
          <div><strong>ค่าเช่า:</strong> ฿${oldRent.toLocaleString()}</div>
          <div><strong>มัดจำ:</strong> ฿${oldDeposit.toLocaleString()}</div>
          <div style="grid-column:1/-1;font-size:.72rem;color:var(--text-muted,#6b7280);">leaseId: ${_escLR(lease.id || lease.leaseId || '')}</div>
        </div>
      </div>

      <form id="gh-lr-form" style="padding:1.25rem 2rem;display:flex;flex-direction:column;gap:1rem;flex:1;">

        <div>
          <label style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">ห้องที่จะอยู่ต่อ</label>
          <div role="radiogroup" style="display:flex;gap:0;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);overflow:hidden;">
            <label style="flex:1;cursor:pointer;">
              <input type="radio" name="gh-lr-room-mode" value="same" checked style="display:none;">
              <div data-room-tab="same" style="padding:10px 12px;text-align:center;background:var(--green-pale,#e8f5e9);color:var(--green-dark,#1b5e20);font-weight:700;font-size:.85rem;">📄 ห้องเดิม<br><span style="font-weight:400;font-size:.72rem;opacity:.8;">ต่อสัญญาห้อง ${_escLR(roomId)}</span></div>
            </label>
            <label style="flex:1;cursor:pointer;border-left:1px solid var(--border,#e5e7eb);">
              <input type="radio" name="gh-lr-room-mode" value="new" style="display:none;">
              <div data-room-tab="new" style="padding:10px 12px;text-align:center;background:#fff;color:var(--text-muted,#6b7280);font-weight:600;font-size:.85rem;">🚪 ย้ายไปห้องใหม่<br><span style="font-weight:400;font-size:.72rem;opacity:.8;">เลือกห้องว่างในระบบ</span></div>
            </label>
          </div>
        </div>

        <div data-same-room-only>
          <label style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">รูปแบบ</label>
          <div role="radiogroup" style="display:flex;gap:0;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);overflow:hidden;">
            <label style="flex:1;cursor:pointer;">
              <input type="radio" name="gh-lr-action-mode" value="renewal" checked style="display:none;">
              <div data-mode-tab="renewal" style="padding:8px 10px;text-align:center;background:var(--green-pale,#e8f5e9);color:var(--green-dark,#1b5e20);font-weight:700;font-size:.82rem;">📄 ต่อสัญญาใหม่<br><span style="font-weight:400;font-size:.7rem;opacity:.8;">เซ็นใหม่ · เปลี่ยนค่าเช่า/มัดจำได้</span></div>
            </label>
            <label style="flex:1;cursor:pointer;border-left:1px solid var(--border,#e5e7eb);">
              <input type="radio" name="gh-lr-action-mode" value="extension" style="display:none;">
              <div data-mode-tab="extension" style="padding:8px 10px;text-align:center;background:#fff;color:var(--text-muted,#6b7280);font-weight:600;font-size:.82rem;">⏩ ขยายระยะเวลา<br><span style="font-weight:400;font-size:.7rem;opacity:.8;">สัญญาเดิม · ขยาย endDate เท่านั้น</span></div>
            </label>
          </div>
        </div>

        <div data-new-room-only style="display:none;flex-direction:column;gap:.75rem;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
            <div>
              <label for="gh-lr-new-building" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">อาคารใหม่</label>
              <select id="gh-lr-new-building" style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.92rem;background:#fff;">
                ${buildingOpts}
              </select>
            </div>
            <div>
              <label for="gh-lr-new-room" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">ห้องใหม่</label>
              <select id="gh-lr-new-room" style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.92rem;background:#fff;">
                <option value="">กำลังโหลด…</option>
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.86rem;cursor:pointer;padding:8px 10px;background:#fef9e7;border-radius:var(--radius-sm,8px);border:1px solid #fde68a;">
            <input type="checkbox" id="gh-lr-transfer-only" style="margin:0;">
            <span>🎯 <strong>ย้ายอย่างเดียว</strong> — ไม่เปลี่ยนวันสิ้นสุดสัญญา (สัญญาตามเดิม)</span>
          </label>
        </div>

        <div data-dates-area style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
          <div data-start-area>
            <label for="gh-lr-start" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">วันเริ่มสัญญาใหม่</label>
            <input type="date" id="gh-lr-start" value="${_escLR(oldEndIso)}"
              style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
            <div data-start-hint style="font-size:.7rem;color:var(--text-muted,#6b7280);margin-top:4px;">เว้นว่าง = ใช้วันสิ้นสุดเดิม</div>
          </div>
          <div data-end-area>
            <label for="gh-lr-end" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">วันสิ้นสุดสัญญาใหม่ <span style="color:var(--red,#c62828);">*</span></label>
            <input type="date" id="gh-lr-end" required value="${_escLR(suggestedEnd)}"
              min="${_escLR(oldEndIso)}"
              style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
          </div>
        </div>

        <div data-renewal-only style="display:flex;flex-direction:column;gap:1rem;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div>
              <label for="gh-lr-rent" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">ค่าเช่าใหม่ (฿)</label>
              <input type="number" id="gh-lr-rent" placeholder="${oldRent}" min="1"
                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
              <div data-rent-hint style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">เว้นว่างหากไม่เปลี่ยน</div>
            </div>
            <div>
              <label for="gh-lr-deposit" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">มัดจำใหม่ (฿)</label>
              <input type="number" id="gh-lr-deposit" placeholder="${oldDeposit}" min="0"
                style="width:100%;padding:10px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.95rem;">
              <div data-deposit-hint style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">เว้นว่างหากไม่เปลี่ยน</div>
            </div>
          </div>

          <div>
            <label for="gh-lr-doc-file" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:6px;">เอกสารสัญญาใหม่ (PDF / JPG / PNG)</label>
            <input type="file" id="gh-lr-doc-file" accept=".pdf,.jpg,.jpeg,.png"
              style="width:100%;padding:8px;border:1.5px dashed var(--border,#e5e7eb);border-radius:var(--radius-sm,8px);font-family:inherit;font-size:.85rem;background:#fafafa;">
            <div id="gh-lr-doc-status" style="font-size:.72rem;color:var(--text-muted,#6b7280);margin-top:4px;">เลือกไฟล์เพื่ออัพโหลด (ไม่เกิน 5MB) — หรือเว้นว่างเพื่อใช้สัญญาเดิม</div>
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

// Toggle visibility for same-room vs new-room sections + update submit label
function _lrSwitchRoomMode(modal, roomMode) {
  modal.querySelectorAll('[data-room-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-room-tab') === roomMode;
    tab.style.background = active ? 'var(--green-pale, #e8f5e9)' : '#fff';
    tab.style.color = active ? 'var(--green-dark, #1b5e20)' : 'var(--text-muted, #6b7280)';
    tab.style.fontWeight = active ? '700' : '600';
  });
  const sameOnly = modal.querySelector('[data-same-room-only]');
  const newOnly = modal.querySelector('[data-new-room-only]');
  if (sameOnly) sameOnly.style.display = (roomMode === 'new') ? 'none' : '';
  if (newOnly)  newOnly.style.display  = (roomMode === 'new') ? 'flex' : 'none';
  _lrUpdateDispatchLabel(modal);
  _lrUpdateDatesVisibility(modal);
}

// Toggle renewal/extension UI (same-room only)
function _lrSwitchActionMode(modal, actionMode) {
  modal.querySelectorAll('[data-mode-tab]').forEach((tab) => {
    const active = tab.getAttribute('data-mode-tab') === actionMode;
    tab.style.background = active ? 'var(--green-pale, #e8f5e9)' : '#fff';
    tab.style.color = active ? 'var(--green-dark, #1b5e20)' : 'var(--text-muted, #6b7280)';
    tab.style.fontWeight = active ? '700' : '600';
  });
  const renewalOnly = modal.querySelector('[data-renewal-only]');
  if (renewalOnly) renewalOnly.style.display = (actionMode === 'extension') ? 'none' : 'flex';
  _lrUpdateDispatchLabel(modal);
}

// Hide newStartDate + newEndDate when "ย้ายอย่างเดียว" is checked
function _lrUpdateDatesVisibility(modal) {
  const roomMode = (modal.querySelector('input[name="gh-lr-room-mode"]:checked') || {}).value || 'same';
  const transferOnly = (modal.querySelector('#gh-lr-transfer-only') || {}).checked;
  const datesArea = modal.querySelector('[data-dates-area]');
  if (!datesArea) return;
  // Transfer-only ⇒ hide dates entirely (lease keeps its term); else show
  datesArea.style.display = (roomMode === 'new' && transferOnly) ? 'none' : 'grid';

  // newRoom + financial changes go through transferTenant(novation) ELSE renewLease.
  // In transferTenant(variation) rent stays same — hide rent/deposit edits.
  const renewalOnly = modal.querySelector('[data-renewal-only]');
  if (renewalOnly) {
    if (roomMode === 'new' && transferOnly) {
      renewalOnly.style.display = 'none';
    } else if (roomMode === 'new') {
      renewalOnly.style.display = 'flex';
    }
  }
}

function _lrUpdateDispatchLabel(modal) {
  const btn = modal.querySelector('[data-lr-submit]');
  if (!btn) return;
  const roomMode = (modal.querySelector('input[name="gh-lr-room-mode"]:checked') || {}).value || 'same';
  const actionMode = (modal.querySelector('input[name="gh-lr-action-mode"]:checked') || {}).value || 'renewal';
  const transferOnly = (modal.querySelector('#gh-lr-transfer-only') || {}).checked;
  if (roomMode === 'new' && transferOnly) {
    btn.textContent = '🚪 ย้ายห้อง';
  } else if (roomMode === 'new') {
    btn.textContent = '🚪 ย้าย + ต่อสัญญา';
  } else if (actionMode === 'extension') {
    btn.textContent = '⏩ ขยายระยะเวลา';
  } else {
    btn.textContent = '📝 ต่อสัญญา';
  }
}

function _lrShowError(modal, msg) {
  const el = modal.querySelector('#gh-lr-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Thin wrappers — Plan B P5.6 extracted core logic to LRRoomPicker module.
async function _lrPopulateRoomPicker(modal, newBuilding, currentBuilding, currentRoomId) {
  const sel = modal.querySelector('#gh-lr-new-room');
  if (!sel) return;
  sel.innerHTML = '<option value="">กำลังโหลด…</option>';
  const excludeId = (newBuilding === currentBuilding) ? currentRoomId : null;
  const vacant = await window.LRRoomPicker.loadVacantRooms(newBuilding, excludeId);
  window.LRRoomPicker.populate(sel, vacant);
}

async function _lrAutoFillNewRoomDefaults(modal, newBuilding, newRoomId) {
  if (!newRoomId) return;
  const defaults = await window.LRRoomPicker.loadRoomDefaults(newBuilding, newRoomId);
  window.LRRoomPicker.autoFill(modal, defaults);
}

function _lrCollectInputs(modal) {
  return {
    roomMode: (modal.querySelector('input[name="gh-lr-room-mode"]:checked') || {}).value || 'same',
    actionMode: (modal.querySelector('input[name="gh-lr-action-mode"]:checked') || {}).value || 'renewal',
    newBuilding: (modal.querySelector('#gh-lr-new-building') || {}).value || '',
    newRoomId: (modal.querySelector('#gh-lr-new-room') || {}).value || '',
    transferOnly: !!(modal.querySelector('#gh-lr-transfer-only') || {}).checked,
    newStartDate: (modal.querySelector('#gh-lr-start') || {}).value || '',
    newEndDate: (modal.querySelector('#gh-lr-end') || {}).value || '',
    rentRaw: (modal.querySelector('#gh-lr-rent') || {}).value || '',
    depositRaw: (modal.querySelector('#gh-lr-deposit') || {}).value || '',
    docFile: ((modal.querySelector('#gh-lr-doc-file') || {}).files || [])[0] || null,
    notes: (modal.querySelector('#gh-lr-notes') || {}).value || '',
  };
}

// Throws on bad number — caller catches and surfaces.
function _lrApplyFinancialFields(payload, inputs, contractDocPath, contractFileName) {
  if (inputs.rentRaw !== '') {
    const n = Number(inputs.rentRaw);
    if (!Number.isFinite(n) || n <= 0) throw new Error('ค่าเช่าใหม่ต้องเป็นตัวเลข > 0');
    payload.newRentAmount = n;
  }
  if (inputs.depositRaw !== '') {
    const n = Number(inputs.depositRaw);
    if (!Number.isFinite(n) || n < 0) throw new Error('มัดจำใหม่ต้องเป็นตัวเลข >= 0');
    payload.newDeposit = n;
  }
  if (contractDocPath) {
    payload.contractDocument = contractDocPath;
    payload.contractFileName = contractFileName;
  }
}

function _lrSetSubmitBusy(modal, busy, label) {
  const submitBtn = modal.querySelector('[data-lr-submit]');
  const cancelBtn = modal.querySelector('[data-lr-cancel]');
  if (submitBtn) {
    submitBtn.disabled = !!busy;
    if (label) submitBtn.textContent = label;
    submitBtn.style.opacity = busy ? '.7' : '';
    submitBtn.style.cursor = busy ? 'wait' : '';
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

async function _lrSubmit(ctx) {
  const modal = document.getElementById(_LR_MODAL_ID);
  if (!modal) return;
  _lrShowError(modal, '');

  const inputs = _lrCollectInputs(modal);
  const { building, roomId, lease } = ctx;
  const { roomMode, actionMode, newBuilding, newRoomId, transferOnly,
          newStartDate, newEndDate, rentRaw, depositRaw, docFile, notes } = inputs;

  // ── Room-picker required when moving ──────────────────────────────────────
  if (roomMode === 'new') {
    if (!newBuilding || !newRoomId) {
      _lrShowError(modal, 'กรุณาเลือกห้องใหม่');
      return;
    }
    if (newBuilding === building && newRoomId === roomId) {
      _lrShowError(modal, 'ห้องใหม่ต้องไม่ใช่ห้องเดิม');
      return;
    }
  }

  // ── End date required when changing the lease term ────────────────────────
  const needsEndDate = !(roomMode === 'new' && transferOnly);
  let parsedEnd = null;
  if (needsEndDate) {
    if (!newEndDate) {
      _lrShowError(modal, 'กรุณากรอกวันสิ้นสุดใหม่');
      return;
    }
    parsedEnd = new Date(newEndDate);
    if (Number.isNaN(parsedEnd.getTime()) || parsedEnd.getTime() <= Date.now()) {
      _lrShowError(modal, 'วันสิ้นสุดใหม่ต้องอยู่ในอนาคต');
      return;
    }
    const oldEnd = new Date(lease.moveOutDate || lease.endDate || 0);
    if (!Number.isNaN(oldEnd.getTime()) && parsedEnd.getTime() <= oldEnd.getTime()) {
      _lrShowError(modal, `วันสิ้นสุดใหม่ต้องอยู่หลังวันสิ้นสุดเดิม (${oldEnd.toISOString().slice(0, 10)})`);
      return;
    }
  }

  let parsedStart = null;
  if (newStartDate && needsEndDate) {
    parsedStart = new Date(newStartDate);
    if (Number.isNaN(parsedStart.getTime())) {
      _lrShowError(modal, 'วันเริ่มสัญญาใหม่ไม่ถูกต้อง');
      return;
    }
    if (parsedEnd && parsedStart.getTime() >= parsedEnd.getTime()) {
      _lrShowError(modal, 'วันเริ่มสัญญาใหม่ต้องอยู่ก่อนวันสิ้นสุด');
      return;
    }
  }

  if (!window.firebase?.functions?.httpsCallable) {
    _lrShowError(modal, 'Firebase functions ไม่พร้อม — รีโหลดหน้า');
    return;
  }

  // ── Optional file upload (renewal/extension paths only — transfer-only skips) ─
  let contractDocumentPath = '';
  let contractFileName = '';
  if (docFile && needsEndDate) {
    _lrSetSubmitBusy(modal, true, 'กำลังอัพโหลดสัญญา…');
    try {
      contractDocumentPath = await _lrUploadContractFile(docFile, roomMode === 'new' ? newBuilding : building, roomMode === 'new' ? newRoomId : roomId, lease.id || lease.leaseId);
      contractFileName = docFile.name;
    } catch (e) {
      _lrSetSubmitBusy(modal, false);
      _lrShowError(modal, 'อัพโหลดสัญญาไม่สำเร็จ: ' + (e?.message || String(e)));
      return;
    }
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  try {
    if (roomMode === 'same') {
      // Path 1 — renewLease (renewal or extension)
      _lrSetSubmitBusy(modal, true, 'กำลังบันทึก…');
      const payload = { building, roomId, mode: actionMode, newEndDate: parsedEnd.toISOString(), notes: notes.trim() };
      if (parsedStart) payload.newStartDate = parsedStart.toISOString();
      if (actionMode === 'renewal') {
        _lrApplyFinancialFields(payload, inputs, contractDocumentPath, contractFileName);
      }
      const callable = window.firebase.functions.httpsCallable('renewLease');
      const res = await callable(payload);
      if (typeof showToast === 'function') {
        showToast(`✓ ${actionMode === 'extension' ? 'ขยายระยะเวลา' : 'ต่อสัญญา'} สำเร็จ`, 'success');
      }
      _lrFinishAndRefresh(res?.data);
      return;
    }

    // roomMode === 'new'
    // Path 2 — transferTenant (variation default; novation if rent/deposit change)
    const wantsFinancialChange = (rentRaw !== '' || depositRaw !== '');
    const transferMode = wantsFinancialChange ? 'novation' : 'variation';
    _lrSetSubmitBusy(modal, true, 'กำลังย้ายห้อง…');
    const transferPayload = {
      building, oldRoomId: roomId, newBuilding, newRoomId, mode: transferMode,
      notes: transferOnly ? `${notes.trim()} | ย้ายอย่างเดียว` : `${notes.trim()} | ย้าย+ต่อ`,
    };
    if (transferMode === 'novation') {
      _lrApplyFinancialFields(transferPayload, inputs, contractDocumentPath, contractFileName);
    }
    const xferCallable = window.firebase.functions.httpsCallable('transferTenant');
    const xferRes = await xferCallable(transferPayload);

    if (transferOnly || !parsedEnd) {
      if (typeof showToast === 'function') showToast('✓ ย้ายห้องสำเร็จ', 'success');
      _lrFinishAndRefresh(xferRes?.data);
      return;
    }

    // Path 3 — transfer + renew. Second leg targets the NEW room.
    _lrSetSubmitBusy(modal, true, 'กำลังต่อสัญญาห้องใหม่…');
    const renewPayload = {
      building: newBuilding, roomId: newRoomId, mode: 'renewal',
      newEndDate: parsedEnd.toISOString(), notes: notes.trim(),
    };
    if (parsedStart) renewPayload.newStartDate = parsedStart.toISOString();
    if (contractDocumentPath && transferMode === 'variation') {
      renewPayload.contractDocument = contractDocumentPath;
      renewPayload.contractFileName = contractFileName;
    }
    try {
      const renewCallable = window.firebase.functions.httpsCallable('renewLease');
      await renewCallable(renewPayload);
      if (typeof showToast === 'function') showToast('✓ ย้ายห้อง + ต่อสัญญาสำเร็จ', 'success');
      _lrFinishAndRefresh(xferRes?.data);
    } catch (renewErr) {
      console.error('[lease-renew] post-transfer renewLease failed:', renewErr);
      // Transfer is the atomic op; the renewal is the second leg. Surface the
      // half-completed state so admin can finish manually from new room's modal.
      if (typeof showToast === 'function') {
        showToast('ย้ายห้องสำเร็จแต่ต่อสัญญาไม่สำเร็จ — เปิด tenant modal ของห้องใหม่แล้วลองต่อสัญญาอีกครั้ง', 'warning');
      }
      _lrShowError(modal, 'ย้ายห้องสำเร็จ — ต่อสัญญาไม่สำเร็จ: ' + (renewErr?.message || String(renewErr)));
      _lrSetSubmitBusy(modal, false);
      return;
    }
  } catch (e) {
    console.error('[lease-renew] dispatch failed:', e);
    _lrShowError(modal, 'บันทึกไม่สำเร็จ: ' + (e?.message || e?.code || String(e)));
    _lrSetSubmitBusy(modal, false);
  }
}

function _lrFinishAndRefresh(_data) {
  _lrClose();
  if (typeof closeTenantModal === 'function') closeTenantModal();
  if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
  if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
  if (typeof renderTenantPage === 'function') renderTenantPage();
  if (typeof refreshLeasesFromFirestore === 'function') {
    Promise.resolve(refreshLeasesFromFirestore()).catch(() => {});
  }
}

function _lrAttachHandlers(modal, ctx) {
  modal.addEventListener('click', (e) => { if (e.target === modal) _lrClose(); });
  const cancelBtn = modal.querySelector('[data-lr-cancel]');
  if (cancelBtn) cancelBtn.addEventListener('click', _lrClose);

  // Room-mode toggle
  modal.querySelectorAll('input[name="gh-lr-room-mode"]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const mode = e.target.value;
      _lrSwitchRoomMode(modal, mode);
      if (mode === 'new') {
        const sel = modal.querySelector('#gh-lr-new-building');
        const b = sel ? sel.value : ctx.building;
        await _lrPopulateRoomPicker(modal, b, ctx.building, ctx.roomId);
        const start = modal.querySelector('#gh-lr-start');
        if (start && !start.value) start.value = new Date().toISOString().slice(0, 10);
      }
    });
  });

  // Action-mode toggle (same-room only)
  modal.querySelectorAll('input[name="gh-lr-action-mode"]').forEach((input) => {
    input.addEventListener('change', (e) => _lrSwitchActionMode(modal, e.target.value));
  });

  // Transfer-only checkbox — affects BOTH date visibility AND submit label
  const transferOnlyCheck = modal.querySelector('#gh-lr-transfer-only');
  if (transferOnlyCheck) transferOnlyCheck.addEventListener('change', () => {
    _lrUpdateDatesVisibility(modal);
    _lrUpdateDispatchLabel(modal);
  });

  // Building change repopulates room picker
  const newBuildingSel = modal.querySelector('#gh-lr-new-building');
  if (newBuildingSel) newBuildingSel.addEventListener('change', async (e) => {
    await _lrPopulateRoomPicker(modal, e.target.value, ctx.building, ctx.roomId);
  });

  // New-room change auto-fills rent/deposit
  const newRoomSel = modal.querySelector('#gh-lr-new-room');
  if (newRoomSel) newRoomSel.addEventListener('change', async (e) => {
    const b = newBuildingSel ? newBuildingSel.value : ctx.building;
    await _lrAutoFillNewRoomDefaults(modal, b, e.target.value);
  });

  // File input — show file name in hint
  const docInput = modal.querySelector('#gh-lr-doc-file');
  const docStatus = modal.querySelector('#gh-lr-doc-status');
  if (docInput && docStatus) docInput.addEventListener('change', () => {
    const f = docInput.files?.[0];
    docStatus.textContent = f
      ? `เลือกไฟล์: ${f.name} (${(f.size / 1024).toFixed(0)} KB) — จะอัพโหลดเมื่อกดต่อสัญญา`
      : 'เลือกไฟล์เพื่ออัพโหลด (ไม่เกิน 5MB) — หรือเว้นว่างเพื่อใช้สัญญาเดิม';
  });

  // Submit
  const submitBtn = modal.querySelector('[data-lr-submit]');
  if (submitBtn) submitBtn.addEventListener('click', () => _lrSubmit(ctx));

  // Enter submits unless in textarea
  const form = modal.querySelector('#gh-lr-form');
  if (form) form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      _lrSubmit(ctx);
    }
  });
}

function openRenewLeaseModal() {
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
