/**
 * dashboard-checklist-admin.js — Admin co-sign panel + PNG export (Tier 3I-9, 3I-10).
 *
 * Adds a "📋 Checklists" sub-tab to the Requests page. Admin selects a building,
 * sees live list of all `checklistInstances` for it, opens the viewer to:
 *   • read tenant-filled items + photos + tenant signature
 *   • sign on canvas → uploadAdminSignature → adminSignChecklist CF (3I-9)
 *   • download a clean PNG via html2canvas (3I-10)
 *
 * Depends on:
 *   window.ChecklistManager      — facade for Firestore/Storage/CF calls
 *   window.BuildingRegistry      — building list for dropdown
 *   window.ensureHtml2Canvas     — lazy CDN loader (added inline in dashboard.html)
 *   window.showToast             — toast helper
 *
 * Globals exposed:
 *   initChecklistAdminTab()
 *   checklistAdminFilter()
 *   openChecklistInstanceViewer(instanceId)
 *   closeChecklistInstanceViewer()
 *   clearAdminSignature()
 *   adminSignChecklistSubmit()
 *   exportChecklistPng()
 */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let _unsub = null;
  let _instances = [];
  let _currentBuilding = '';
  let _currentStatusFilter = '';
  let _viewer = null;     // { id, building, roomId, items, ... }
  let _sigCtx = null;
  let _sigDrawing = false;
  let _sigLast = null;
  let _photoUrls = {};    // itemId -> signed URL cache (per viewer session)
  let _tenantSigUrl = null;
  let _adminSigUrl = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _statusBadge(status) {
    if (status === 'admin_signed') return '<span style="background:#c8e6c9;color:#1b5e20;padding:2px 8px;border-radius:6px;font-size:.72rem;font-weight:700;">✅ เสร็จ</span>';
    if (status === 'submitted')    return '<span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:6px;font-size:.72rem;font-weight:700;">📝 รอเซ็น</span>';
    return '<span style="background:#eee;color:#555;padding:2px 8px;border-radius:6px;font-size:.72rem;font-weight:700;">⏳ รอกรอก</span>';
  }

  function _typeLabel(t) {
    return t === 'move_out' ? 'ย้ายออก' : 'ย้ายเข้า';
  }

  function _fmtDate(ts) {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : (typeof ts === 'string' ? new Date(ts) : ts);
    if (!(d instanceof Date) || isNaN(d)) return '-';
    return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  }

  // ── Tab init + filter ─────────────────────────────────────────────────────

  function initChecklistAdminTab() {
    const buildingSel = document.getElementById('checklist-admin-building');
    if (buildingSel && buildingSel.options.length === 0) {
      const buildings = (window.BuildingRegistry?.list?.() || []).filter(b => b.status !== 'archived');
      buildingSel.innerHTML = buildings.map(b =>
        `<option value="${_esc(b.id)}">${_esc(b.displayName)}</option>`
      ).join('');
      _currentBuilding = buildings[0]?.id || '';
    } else if (buildingSel) {
      _currentBuilding = buildingSel.value;
    }
    if (!_currentBuilding) {
      const list = document.getElementById('checklist-admin-list');
      if (list) list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">ไม่พบอาคาร</div>';
      return;
    }
    _subscribe();
  }

  function checklistAdminFilter() {
    const bSel = document.getElementById('checklist-admin-building');
    const sSel = document.getElementById('checklist-admin-status');
    _currentBuilding = bSel?.value || _currentBuilding;
    _currentStatusFilter = sSel?.value || '';
    _subscribe();
  }

  function _subscribe() {
    if (_unsub) { try { _unsub(); } catch (_) { /* noop */ } _unsub = null; }
    if (!_currentBuilding || !window.ChecklistManager) return;
    const list = document.getElementById('checklist-admin-list');
    if (list) list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:1.5rem;">กำลังโหลด...</div>';

    _unsub = window.ChecklistManager.subscribeAdminInstances(_currentBuilding, (rows) => {
      _instances = rows || [];
      _render();
    }, (err) => {
      const el = document.getElementById('checklist-admin-list');
      if (!el) return;
      const msg = err.code === 'failed-precondition'
        ? 'Firestore index ยังไม่พร้อม — รอสักครู่แล้วรีเฟรช'
        : _esc(err.message || 'ไม่สามารถโหลดได้');
      el.innerHTML = `<div style="color:#c62828;text-align:center;padding:1.5rem;">⚠️ ${msg}</div>`;
    });
  }

  function _render() {
    const list = document.getElementById('checklist-admin-list');
    if (!list) return;
    const filtered = _currentStatusFilter
      ? _instances.filter(i => i.status === _currentStatusFilter)
      : _instances;
    if (filtered.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">— ยังไม่มี checklist ในเงื่อนไขนี้ —</div>';
      return;
    }
    list.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:.4rem;">
        ${filtered.map(i => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem .9rem;background:#fafafa;border:1px solid #eee;border-radius:8px;gap:.5rem;flex-wrap:wrap;">
            <div style="display:flex;flex-direction:column;gap:.15rem;min-width:0;flex:1;">
              <div style="font-weight:600;font-size:.95rem;">
                ห้อง ${_esc(i.roomId || i.tenantRoom || '?')} · ${_esc(i.tenantName || '—')}
              </div>
              <div style="font-size:.78rem;color:var(--text-muted);">
                ${_typeLabel(i.type)} · ${_fmtDate(i.createdAt)}
              </div>
            </div>
            <div style="display:flex;gap:.4rem;align-items:center;">
              ${_statusBadge(i.status)}
              <button data-action="openChecklistInstanceViewer" data-id="${_esc(i.id)}" style="padding:5px 12px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:.82rem;font-weight:600;cursor:pointer;">ดู</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── Instance viewer ───────────────────────────────────────────────────────

  async function openChecklistInstanceViewer(instanceId) {
    const inst = _instances.find(i => i.id === instanceId);
    if (!inst) { window.showToast?.('ไม่พบ checklist นี้', 'error'); return; }
    _viewer = inst;
    _photoUrls = {};
    _tenantSigUrl = null;
    _adminSigUrl = null;
    _sigCtx = null;

    const modal = document.getElementById('checklist-viewer-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    _renderViewerBody();
    _renderViewerFooter();
    _resolveMediaUrls();
  }

  function closeChecklistInstanceViewer() {
    const modal = document.getElementById('checklist-viewer-modal');
    if (modal) modal.style.display = 'none';
    _viewer = null;
    _sigCtx = null;
  }

  async function _resolveMediaUrls() {
    if (!_viewer || !window.ChecklistManager) return;
    const items = _viewer.items || [];
    await Promise.all(items.map(async (it) => {
      if (it.photoPath) {
        try { _photoUrls[it.id] = await window.ChecklistManager.getSignedUrl(it.photoPath); }
        catch (_) { _photoUrls[it.id] = null; }
      }
    }));
    if (_viewer.tenantSignaturePath) {
      try { _tenantSigUrl = await window.ChecklistManager.getSignedUrl(_viewer.tenantSignaturePath); }
      catch (_) { _tenantSigUrl = null; }
    }
    if (_viewer.adminSignaturePath) {
      try { _adminSigUrl = await window.ChecklistManager.getSignedUrl(_viewer.adminSignaturePath); }
      catch (_) { _adminSigUrl = null; }
    }
    _renderViewerBody();
  }

  function _renderViewerBody() {
    const body = document.getElementById('clv-body');
    if (!body || !_viewer) return;

    const items = _viewer.items || [];
    const itemsHtml = items.length === 0
      ? '<div style="color:var(--text-muted);text-align:center;padding:1rem;">— ไม่มีรายการ —</div>'
      : items.map((it) => {
          const photoUrl = _photoUrls[it.id];
          const photoBlock = photoUrl
            ? `<a href="${_esc(photoUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:.3rem;"><img src="${_esc(photoUrl)}" alt="photo" style="max-width:120px;max-height:120px;border:1px solid #ddd;border-radius:6px;object-fit:cover;"></a>`
            : (it.photoPath ? '<div style="font-size:.75rem;color:#888;margin-top:.25rem;">⏳ โหลดรูป...</div>' : '');
          return `
            <div style="padding:.6rem .8rem;background:#fafafa;border:1px solid #eee;border-radius:8px;margin-bottom:.4rem;">
              <div style="display:flex;align-items:flex-start;gap:.5rem;">
                <span style="font-size:1.1rem;">${it.checked ? '✅' : '⬜'}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:.92rem;">${_esc(it.label || it.id)}</div>
                  ${it.note ? `<div style="font-size:.82rem;color:#555;margin-top:.2rem;">📝 ${_esc(it.note)}</div>` : ''}
                  ${photoBlock}
                </div>
              </div>
            </div>
          `;
        }).join('');

    const tenantSigBlock = _tenantSigUrl
      ? `<div style="margin-top:1rem;"><div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.3rem;">ลายเซ็นผู้เช่า:</div><img src="${_esc(_tenantSigUrl)}" alt="tenant sig" style="max-width:240px;border:1px solid #ddd;border-radius:6px;background:#fff;"></div>`
      : (_viewer.tenantSignaturePath ? '<div style="margin-top:1rem;font-size:.82rem;color:#888;">⏳ โหลดลายเซ็นผู้เช่า...</div>' : '');

    const adminSigBlock = _adminSigUrl
      ? `<div style="margin-top:.8rem;"><div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.3rem;">ลายเซ็นแอดมิน:</div><img src="${_esc(_adminSigUrl)}" alt="admin sig" style="max-width:240px;border:1px solid #ddd;border-radius:6px;background:#fff;"></div>`
      : '';

    const signPad = (_viewer.status === 'submitted' && !_adminSigUrl)
      ? `
        <div style="margin-top:1rem;padding-top:1rem;border-top:1px dashed #ddd;">
          <div style="font-size:.88rem;font-weight:600;margin-bottom:.4rem;">✍️ เซ็นที่นี่ (admin):</div>
          <canvas id="clv-admin-canvas" style="width:100%;height:160px;border:1px solid #ddd;border-radius:8px;touch-action:none;background:#fafafa;display:block;"></canvas>
          <button data-action="clearAdminSignature" style="margin-top:.4rem;font-size:.8rem;color:#888;background:none;border:none;cursor:pointer;">🔄 ล้างลายเซ็น</button>
        </div>
      `
      : '';

    body.innerHTML = `
      <div id="clv-printable" style="background:#fff;">
        <div style="margin-bottom:1rem;">
          <div style="font-weight:700;font-size:1.1rem;">📋 Checklist — ${_typeLabel(_viewer.type)}</div>
          <div style="font-size:.85rem;color:var(--text-muted);margin-top:.25rem;">
            อาคาร: ${_esc(_viewer.building)} · ห้อง: ${_esc(_viewer.roomId || '?')} · ${_esc(_viewer.tenantName || '—')}
          </div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.15rem;">
            สร้าง: ${_fmtDate(_viewer.createdAt)} · สถานะ: ${_viewer.status}
          </div>
        </div>
        <div>${itemsHtml}</div>
        ${tenantSigBlock}
        ${adminSigBlock}
      </div>
      ${signPad}
    `;

    if (_viewer.status === 'submitted' && !_adminSigUrl) {
      // Defer until DOM paints
      setTimeout(_initAdminSigCanvas, 0);
    }
  }

  function _renderViewerFooter() {
    const footer = document.getElementById('clv-footer');
    if (!footer || !_viewer) return;
    const canSign = _viewer.status === 'submitted' && !_adminSigUrl;
    const canExport = _viewer.status === 'admin_signed' || _viewer.status === 'submitted';
    footer.innerHTML = `
      <button data-action="closeChecklistInstanceViewer" style="flex:1;min-width:100px;padding:10px 16px;background:var(--border);color:var(--text);border:none;border-radius:8px;font-family:inherit;font-weight:600;cursor:pointer;">ปิด</button>
      ${canExport ? `<button data-action="exportChecklistPng" style="flex:1;min-width:120px;padding:10px 16px;background:#1565c0;color:#fff;border:none;border-radius:8px;font-family:inherit;font-weight:600;cursor:pointer;">⬇️ ดาวน์โหลด PNG</button>` : ''}
      ${canSign ? `<button id="clv-sign-btn" data-action="adminSignChecklistSubmit" style="flex:2;min-width:160px;padding:10px 16px;background:var(--green-dark);color:#fff;border:none;border-radius:8px;font-family:inherit;font-weight:700;cursor:pointer;">✍️ บันทึกลายเซ็น</button>` : ''}
    `;
  }

  // ── Admin signature canvas ────────────────────────────────────────────────

  function _initAdminSigCanvas() {
    const canvas = document.getElementById('clv-admin-canvas');
    if (!canvas || _sigCtx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    _sigCtx = canvas.getContext('2d');
    _sigCtx.scale(dpr, dpr);
    _sigCtx.strokeStyle = '#1a1a1a';
    _sigCtx.lineWidth   = 2;
    _sigCtx.lineCap     = 'round';
    _sigCtx.lineJoin    = 'round';

    function _pos(e) {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }
    function _start(e) {
      e.preventDefault();
      _sigDrawing = true;
      _sigLast = _pos(e);
      _sigCtx.beginPath();
      _sigCtx.moveTo(_sigLast.x, _sigLast.y);
    }
    function _move(e) {
      if (!_sigDrawing) return;
      e.preventDefault();
      const p = _pos(e);
      _sigCtx.lineTo(p.x, p.y);
      _sigCtx.stroke();
      _sigLast = p;
    }
    function _end() { _sigDrawing = false; }

    canvas.addEventListener('mousedown', _start);
    canvas.addEventListener('mousemove', _move);
    canvas.addEventListener('mouseup', _end);
    canvas.addEventListener('mouseleave', _end);
    canvas.addEventListener('touchstart', _start, { passive: false });
    canvas.addEventListener('touchmove',  _move,  { passive: false });
    canvas.addEventListener('touchend',   _end);
  }

  function clearAdminSignature() {
    const canvas = document.getElementById('clv-admin-canvas');
    if (canvas && _sigCtx) {
      _sigCtx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
    }
  }

  function _isSigEmpty() {
    const canvas = document.getElementById('clv-admin-canvas');
    if (!canvas || !_sigCtx) return true;
    const d = _sigCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) return false;
    }
    return true;
  }

  function _sigDataUrl() {
    const canvas = document.getElementById('clv-admin-canvas');
    return canvas ? canvas.toDataURL('image/png') : null;
  }

  // ── Co-sign action (3I-9) ─────────────────────────────────────────────────

  async function adminSignChecklistSubmit() {
    if (!_viewer || !window.ChecklistManager) return;
    if (_isSigEmpty()) { window.showToast?.('กรุณาเซ็นชื่อก่อนบันทึก', 'warning'); return; }
    const btn = document.getElementById('clv-sign-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังอัปโหลด...'; }
    try {
      const dataUrl = _sigDataUrl();
      const path = await window.ChecklistManager.uploadAdminSignature(
        _viewer.id, _viewer.building, _viewer.roomId, dataUrl
      );
      await window.ChecklistManager.adminSignChecklist(_viewer.id, path);
      window.showToast?.('✅ บันทึกลายเซ็นแอดมินสำเร็จ', 'success');
      closeChecklistInstanceViewer();
    } catch (err) {
      console.error('adminSignChecklistSubmit error:', err);
      window.showToast?.('บันทึกไม่สำเร็จ: ' + (err.message || err), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✍️ บันทึกลายเซ็น'; }
    }
  }

  // ── PNG export (3I-10) ────────────────────────────────────────────────────

  async function exportChecklistPng() {
    if (!_viewer) return;
    const src = document.getElementById('clv-printable');
    if (!src) { window.showToast?.('ไม่พบเนื้อหา', 'error'); return; }
    try { await window.ensureHtml2Canvas?.(); } catch (_) {
      window.showToast?.('โหลด html2canvas ไม่สำเร็จ', 'error');
      return;
    }
    if (typeof window.html2canvas !== 'function') {
      window.showToast?.('html2canvas ไม่พร้อม', 'error');
      return;
    }
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:2rem;width:680px;font-family:inherit;';
    tmp.innerHTML = src.innerHTML;
    document.body.appendChild(tmp);
    try {
      const canvas = await window.html2canvas(tmp, { backgroundColor: '#ffffff', scale: 2, logging: false, useCORS: true });
      const link = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      link.href = canvas.toDataURL('image/png');
      link.download = `checklist-${_viewer.building}-${_viewer.roomId}-${_viewer.type}-${ts}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.showToast?.('ดาวน์โหลดสำเร็จ', 'success');
    } catch (err) {
      console.error('exportChecklistPng error:', err);
      window.showToast?.('ดาวน์โหลดไม่สำเร็จ: ' + (err.message || err), 'error');
    } finally {
      if (tmp.parentNode) document.body.removeChild(tmp);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  window.initChecklistAdminTab         = initChecklistAdminTab;
  window.checklistAdminFilter          = checklistAdminFilter;
  window.openChecklistInstanceViewer   = openChecklistInstanceViewer;
  window.closeChecklistInstanceViewer  = closeChecklistInstanceViewer;
  window.clearAdminSignature           = clearAdminSignature;
  window.adminSignChecklistSubmit      = adminSignChecklistSubmit;
  window.exportChecklistPng            = exportChecklistPng;
})();
