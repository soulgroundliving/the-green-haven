/**
 * dashboard-buildings.js — Admin UI for Multi-Property registry.
 *
 * Renders the Buildings page in dashboard.html: list cards + add/edit modal.
 * All Firestore CRUD goes through window.BuildingRegistry.
 *
 * Globals exposed:
 *   initBuildingsPage()         — entry point called by showPage('buildings')
 *   openBuildingModal(id?)      — new (no id) or edit (id given)
 *   saveBuildingForm()          — modal submit handler
 *   archiveBuildingPrompt(id)   — archive confirmation
 */
(function() {
  'use strict';

  const PAGE_ID = 'page-buildings';
  const LIST_ID = 'buildings-list';
  const MODAL_ID = 'buildingFormModal';
  let _editingId = null;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _getBuildingRooms(buildingId) {
    if (typeof getActiveRoomsWithMetadata !== 'function') return [];
    let fallback = null;
    if (buildingId === 'rooms') fallback = window.ROOMS_OLD || window.ROOMS_NEW || null;
    else if (buildingId === 'nest') fallback = window.NEST_ROOMS || null;
    try {
      return getActiveRoomsWithMetadata(buildingId, fallback) || [];
    } catch (_) {
      return [];
    }
  }

  function _renderRoomChips(buildingId, rooms) {
    if (!rooms || rooms.length === 0) {
      return `<div style="font-size:.78rem;color:var(--text-muted);font-style:italic;margin-top:.25rem;">— ยังไม่มีห้องในอาคารนี้ —</div>`;
    }
    const chips = rooms.map(r => {
      const rid = _esc(r.id);
      return `<button data-action="openRoomFromBuilding" data-building="${_esc(buildingId)}" data-room="${rid}" title="จัดการข้อมูลห้อง ${rid}" style="background:#fff8e1;color:#ef6c00;border:1px solid #ffe0b2;border-radius:8px;padding:.25rem .55rem;font-size:.78rem;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif;display:inline-flex;align-items:center;gap:.25rem;transition:all .15s;" onmouseover="this.style.background='#ffe0b2'" onmouseout="this.style.background='#fff8e1'">📄 ${rid}</button>`;
    }).join('');
    return `
      <div style="margin-top:.5rem;">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem;">ห้อง (${rooms.length}) — กดเพื่อจัดการ:</div>
        <div style="display:flex;flex-wrap:wrap;gap:.3rem;max-height:140px;overflow-y:auto;padding:.25rem;border:1px dashed #eee;border-radius:6px;">${chips}</div>
      </div>
    `;
  }

  function _renderCard(b) {
    const id = _esc(b.id);
    const status = b.status === 'archived' ? 'archived' : 'active';
    const badgeColor = status === 'archived' ? '#9e9e9e' : 'var(--green)';
    const isFallback = b._fallback;
    const rooms = _getBuildingRooms(b.id);
    return `
      <div class="card" style="padding:1.25rem;display:flex;flex-direction:column;gap:.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
          <div>
            <div style="font-weight:700;font-size:1.05rem;">${_esc(b.displayName)}</div>
            <div style="font-family:monospace;font-size:.78rem;color:var(--text-muted);margin-top:.15rem;">buildings/${id}</div>
          </div>
          <span style="font-size:.72rem;padding:.15rem .5rem;border-radius:6px;background:${badgeColor};color:#fff;">${status}</span>
        </div>
        ${b.address ? `<div style="font-size:.85rem;color:var(--text-muted);">📍 ${_esc(b.address)}</div>` : ''}
        ${b.companyName ? `<div style="font-size:.85rem;">🏢 ${_esc(b.companyName)}</div>` : ''}
        ${b.promptPayId ? `<div style="font-size:.85rem;font-family:monospace;">💰 ${_esc(b.promptPayId)}</div>` : ''}
        ${b.contact ? `<div style="font-size:.85rem;">☎️ ${_esc(b.contact)}</div>` : ''}
        ${isFallback ? `<div style="font-size:.72rem;color:#ff9800;margin-top:.25rem;">⚠️ ยังไม่ได้บันทึกใน Firestore — กด "แก้ไข" เพื่อสร้าง</div>` : ''}
        ${_renderRoomChips(b.id, rooms)}
        <div style="display:flex;gap:.5rem;margin-top:.5rem;">
          <button data-action="openBuildingModal" data-id="${id}" class="year-tab" style="padding:.4rem .8rem;font-size:.85rem;flex:1;">✏️ แก้ไข</button>
          ${status === 'active' && !isFallback ? `<button data-action="archiveBuildingPrompt" data-id="${id}" class="year-tab" style="padding:.4rem .8rem;font-size:.85rem;background:#fff;border:1px solid #f44336;color:#f44336;">🗑️ Archive</button>` : ''}
        </div>
      </div>
    `;
  }

  function openRoomFromBuilding(building, roomId) {
    if (typeof window.openTenantModal !== 'function') {
      window.showToast?.('openTenantModal not loaded', 'error');
      return;
    }
    window.openTenantModal(building, roomId);
  }

  async function initBuildingsPage() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    const listEl = document.getElementById(LIST_ID);
    if (!listEl) return;
    listEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">กำลังโหลดข้อมูลอาคาร...</div>';
    if (!window.BuildingRegistry) {
      listEl.innerHTML = '<div style="grid-column:1/-1;color:#c62828;text-align:center;padding:1rem;">BuildingRegistry not loaded</div>';
      return;
    }
    await window.BuildingRegistry.refresh();
    const buildings = window.BuildingRegistry.list();
    if (buildings.length === 0) {
      listEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีอาคาร — กด "เพิ่มอาคารใหม่"</div>';
      return;
    }
    listEl.innerHTML = buildings.map(_renderCard).join('');
  }

  function openBuildingModal(id) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) {
      console.warn('[buildings] modal not found');
      return;
    }
    _editingId = id || null;
    const existing = id ? (window.BuildingRegistry?.getById(id) || null) : null;
    document.getElementById('bld-modal-title').textContent = id ? `แก้ไขอาคาร: ${id}` : 'เพิ่มอาคารใหม่';
    document.getElementById('bld-form-id').value = existing?.id || '';
    document.getElementById('bld-form-id').disabled = !!id;
    document.getElementById('bld-form-displayName').value = existing?.displayName || '';
    document.getElementById('bld-form-address').value = existing?.address || '';
    document.getElementById('bld-form-promptpay').value = existing?.promptPayId || '';
    document.getElementById('bld-form-contact').value = existing?.contact || '';
    document.getElementById('bld-form-companyName').value = existing?.companyName || '';
    document.getElementById('bld-form-ownerName').value = existing?.ownerName || '';
    modal.style.display = 'flex';
    modal.classList.remove('u-hidden');
    setTimeout(() => document.getElementById(id ? 'bld-form-displayName' : 'bld-form-id')?.focus(), 50);
  }

  function closeBuildingModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = '';
    modal.classList.add('u-hidden');
    _editingId = null;
  }

  async function saveBuildingForm() {
    const id = document.getElementById('bld-form-id')?.value?.trim();
    const displayName = document.getElementById('bld-form-displayName')?.value?.trim();
    const address = document.getElementById('bld-form-address')?.value?.trim() || '';
    const promptPayId = document.getElementById('bld-form-promptpay')?.value?.trim() || '';
    const contact = document.getElementById('bld-form-contact')?.value?.trim() || '';
    const companyName = document.getElementById('bld-form-companyName')?.value?.trim() || '';
    const ownerName = document.getElementById('bld-form-ownerName')?.value?.trim() || '';
    if (!id) {
      window.showToast?.('กรุณากรอก Building ID (slug)', 'warning');
      return;
    }
    if (!displayName) {
      window.showToast?.('กรุณากรอกชื่ออาคาร', 'warning');
      return;
    }
    if (promptPayId && !/^\d{9,13}$/.test(promptPayId.replace(/\D/g, ''))) {
      window.showToast?.('PromptPay ต้องเป็นตัวเลข 9-13 หลัก', 'warning');
      return;
    }
    const saveBtn = document.getElementById('bld-form-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...'; }
    try {
      if (_editingId) {
        await window.BuildingRegistry.update(_editingId, { displayName, address, promptPayId, contact, companyName, ownerName });
        window.showToast?.(`อัปเดต ${_editingId} สำเร็จ`, 'success');
      } else {
        const newId = await window.BuildingRegistry.create({ id, displayName, address, promptPayId, contact, companyName, ownerName });
        window.showToast?.(`สร้างอาคาร ${newId} สำเร็จ`, 'success');
      }
      closeBuildingModal();
      await initBuildingsPage();
    } catch (err) {
      console.error('[buildings] save failed:', err);
      window.showToast?.(`บันทึกล้มเหลว: ${err.message || err}`, 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 บันทึก'; }
    }
  }

  async function archiveBuildingPrompt(id) {
    if (!id) return;
    const ok = confirm(`Archive อาคาร "${id}"?\n\nผู้เช่ายังเข้าใช้งานได้ตามปกติ แต่จะไม่ปรากฏใน selector ของแอดมินอีก\n\n(ใช้แก้ไข → เปลี่ยน status เป็น active เพื่อนำกลับมา)`);
    if (!ok) return;
    try {
      await window.BuildingRegistry.archive(id);
      window.showToast?.(`Archive ${id} สำเร็จ`, 'success');
      await initBuildingsPage();
    } catch (err) {
      console.error('[buildings] archive failed:', err);
      window.showToast?.(`Archive ล้มเหลว: ${err.message || err}`, 'error');
    }
  }

  window.initBuildingsPage = initBuildingsPage;
  window.openBuildingModal = openBuildingModal;
  window.closeBuildingModal = closeBuildingModal;
  window.saveBuildingForm = saveBuildingForm;
  window.archiveBuildingPrompt = archiveBuildingPrompt;
  window.openRoomFromBuilding = openRoomFromBuilding;
})();
