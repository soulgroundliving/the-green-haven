// ===== PDPA §32 Right to Erasure — Admin Tool =====
//
// Admin-triggered cascade erasure for tenant data. CF refuses active tenants
// (admin must run transitionToPlayer / archiveTenantOnMoveOut first). Two-step
// modal: disclosure + typed-phrase friction. Target pre-filled from the open
// tenant modal context. CSP-safe (no inline handlers; listeners attached
// programmatically + data-action dispatcher in dashboard-main.js).
//
// Cascade (per requestDataDeletion CF):
//   DELETE: checklistInstances + photos, consents, liffUsers, RTDB
//           complaints/maintenance, bookings (+KYC images, slips),
//           lineRetryQueue pending pushes, rateLimits, all archive docs
//           with this tenantId, people/{tenantId} recursive.
//   RETAIN: RTDB bills (Revenue Code §87 5yr), leases (Civil Code §193/34
//           5yr), paymentHistory, BigQuery auth_events + slipLogs (PDPA
//           §32(2)(e) legitimate interest, IAM-locked).

(function () {
  'use strict';

  const CONFIRM_PHRASE = 'ลบข้อมูลของฉัน';
  let _ctx = null; // current erasure target context

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── Modal open/close — anti-pattern C: class binds display:none, so
  //    close clears inline display to let the class win again. ──
  function _show(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('u-hidden');
    m.style.display = 'flex';
  }
  function _hide(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('u-hidden');
    m.style.display = '';
  }

  function openErasureModal() {
    const building = window.currentEditBuilding || '';
    const roomId   = window.currentEditRoomId   || '';
    const tenantId = window.currentEditTenantId || '';

    if (!tenantId) {
      window.showToast?.('ห้องนี้ยังไม่มี tenantId — เปิด tenant modal ของห้องที่มีผู้เช่าก่อน', 'error');
      return;
    }

    // Pull authUid + lineUserId from current tenant snapshot
    const occ = window.TenantLookup?.getRoomOccupancyInfo(building, roomId) || {};
    const tenant = occ.tenant || {};
    const authUid = tenant.linkedAuthUid || '';
    const lineUserId = tenant.lineUserId
      || (authUid.startsWith('line:') ? authUid.slice(5) : '');
    const tenantName = String(
      tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim()
    ).trim();

    if (!authUid) {
      window.showToast?.(
        'ขาด linkedAuthUid — ผู้เช่ายังไม่ link LIFF (CF จะ revoke token ไม่ได้). หากต้องการลบจริง โปรด link หรือใช้ admin tool แยก',
        'error'
      );
      return;
    }

    _ctx = { building, roomId, tenantId, authUid, lineUserId, tenantName };

    // Render target summary in Step 1
    const elTarget = document.getElementById('pdpaAdmTarget');
    if (elTarget) {
      elTarget.innerHTML =
        `<div><b>ผู้เช่า:</b> ${_esc(_ctx.tenantName || '(ไม่ระบุ)')}</div>` +
        `<div><b>tenantId:</b> <code style="font-size:.78rem;">${_esc(_ctx.tenantId)}</code></div>` +
        `<div><b>authUid:</b> <code style="font-size:.78rem;">${_esc(_ctx.authUid)}</code></div>` +
        `<div><b>ห้อง:</b> <code style="font-size:.78rem;">${_esc(_ctx.building)} / ${_esc(_ctx.roomId)}</code></div>` +
        (_ctx.lineUserId
          ? `<div><b>lineUserId:</b> <code style="font-size:.78rem;">${_esc(_ctx.lineUserId)}</code></div>`
          : '');
    }

    // Reset checkboxes + reason
    ['pdpaAdmAckActive', 'pdpaAdmAckRetention'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    const reason = document.getElementById('pdpaAdmReason');
    if (reason) reason.value = '';

    _updateStep1Button();
    _show('pdpaAdmStep1Modal');
  }

  function _updateStep1Button() {
    const ack1 = document.getElementById('pdpaAdmAckActive')?.checked;
    const ack2 = document.getElementById('pdpaAdmAckRetention')?.checked;
    const btn  = document.getElementById('pdpaAdmStep1Continue');
    if (!btn) return;
    const ready = !!(ack1 && ack2);
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.5';
    btn.style.cursor  = ready ? 'pointer' : 'not-allowed';
  }

  function _updateStep2Button() {
    const v = (document.getElementById('pdpaAdmPhrase')?.value || '').trim();
    const btn = document.getElementById('pdpaAdmStep2Confirm');
    if (!btn) return;
    const ready = v === CONFIRM_PHRASE;
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.5';
    btn.style.cursor  = ready ? 'pointer' : 'not-allowed';
  }

  async function _confirmStep2() {
    if (!_ctx?.tenantId || !_ctx?.authUid) {
      window.showToast?.('Context หาย — ปิดและเปิด tenant modal ใหม่', 'error');
      return;
    }
    const phrase = (document.getElementById('pdpaAdmPhrase')?.value || '').trim();
    if (phrase !== CONFIRM_PHRASE) return;

    const reason = (document.getElementById('pdpaAdmReason')?.value || '').slice(0, 500);
    const btn = document.getElementById('pdpaAdmStep2Confirm');
    const origLabel = btn?.textContent || '✅ ลบข้อมูล';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังลบ...'; btn.style.cursor = 'wait'; }

    if (!window.firebase?.functions?.httpsCallable) {
      window.showToast?.('Firebase functions ไม่พร้อม — รีโหลดหน้า', 'error');
      if (btn) { btn.disabled = false; btn.textContent = origLabel; }
      return;
    }

    try {
      const callable = window.firebase.functions.httpsCallable('requestDataDeletion');
      const res = await callable({
        targetTenantId:   _ctx.tenantId,
        targetAuthUid:    _ctx.authUid,
        targetRoom:       _ctx.roomId || '',
        targetBuilding:   _ctx.building || '',
        targetLineUserId: _ctx.lineUserId || '',
        reason,
        confirmationPhrase: CONFIRM_PHRASE,
      });
      _hide('pdpaAdmStep2Modal');
      _renderSummary(res?.data || {});
      _show('pdpaAdmSummaryModal');
    } catch (e) {
      console.error('[pdpa-admin] requestDataDeletion failed:', e);
      const code = e?.code || '';
      let msg = e?.message || String(e);
      if (/still an active tenant/i.test(msg)) {
        msg = '⚠️ ผู้เช่ายังเป็น active tenant — กด "🎮 ย้ายเป็น Community" หรือ "📦 ย้ายไป Archive" ก่อน';
      } else if (code === 'resource-exhausted' || /within 7 days|cooldown/i.test(msg)) {
        msg = '⏳ ลบไปแล้วภายใน 7 วัน — รอ cooldown ก่อน';
      } else if (code === 'permission-denied') {
        msg = '🔒 ต้องเป็น admin (custom claim) เท่านั้น';
      } else if (code === 'failed-precondition') {
        msg = '⚠️ เงื่อนไขไม่ผ่าน: ' + msg;
      }
      window.showToast?.('ลบไม่สำเร็จ: ' + msg, 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = origLabel;
        btn.style.cursor = 'pointer';
      }
    }
  }

  function _renderSummary(data) {
    const body = document.getElementById('pdpaAdmSummaryBody');
    if (!body) return;
    const summary  = data?.summary  || {};
    const deleted  = summary.deleted  || {};
    const retained = summary.retained || {};
    const errors   = summary.errors   || [];
    const status   = data?.status     || 'completed';
    const requestId = data?.requestId  || '(unknown)';

    let html = '';
    const statusColor = status === 'completed' ? '#166534' : '#92400e';
    html += `<div style="margin-bottom:10px;"><b>สถานะ:</b> <span style="color:${statusColor};font-weight:600;">${_esc(status)}</span></div>`;
    html += `<div style="margin-bottom:10px; font-size:.78rem; color:${DashColors.TEXT_SECONDARY};">requestId: <code>${_esc(requestId)}</code></div>`;

    if (Object.keys(deleted).length) {
      html += '<div style="margin-top:10px; padding:10px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px;">';
      html += '<div style="font-weight:600; color:#166534; margin-bottom:6px;">✅ ลบแล้ว:</div>';
      html += '<ul style="margin:0; padding-left:18px; font-size:.85rem; line-height:1.7;">';
      Object.entries(deleted).forEach(([k, v]) => {
        const display = Array.isArray(v) ? `${v.length} รายการ` : String(v);
        html += `<li><b>${_esc(k)}:</b> ${_esc(display)}</li>`;
      });
      html += '</ul></div>';
    }

    if (Object.keys(retained).length) {
      html += '<div style="margin-top:10px; padding:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px;">';
      html += '<div style="font-weight:600; color:#92400e; margin-bottom:6px;">⚠️ เก็บไว้ (ตามกฎหมาย):</div>';
      html += '<ul style="margin:0; padding-left:18px; font-size:.82rem; line-height:1.6;">';
      Object.entries(retained).forEach(([k, v]) => {
        html += `<li><b>${_esc(k)}:</b> ${_esc(String(v))}</li>`;
      });
      html += '</ul></div>';
    }

    if (errors.length) {
      html += '<div style="margin-top:10px; padding:10px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px;">';
      html += `<div style="font-weight:600; color:#b91c1c; margin-bottom:6px;">⚠️ ขั้นตอนที่ผิดพลาดบางส่วน (${errors.length}):</div>`;
      html += '<ul style="margin:0; padding-left:18px; font-size:.78rem; color:#7f1d1d; line-height:1.6;">';
      errors.forEach(e => {
        html += `<li><b>${_esc(e.step || '?')}:</b> ${_esc(e.error || '?')}</li>`;
      });
      html += '</ul></div>';
    }

    body.innerHTML = html;
  }

  // ── Attach realtime listeners after DOM is ready ───────────────────────
  function _attachListeners() {
    const ack1 = document.getElementById('pdpaAdmAckActive');
    const ack2 = document.getElementById('pdpaAdmAckRetention');
    if (ack1) ack1.addEventListener('change', _updateStep1Button);
    if (ack2) ack2.addEventListener('change', _updateStep1Button);
    const phrase = document.getElementById('pdpaAdmPhrase');
    if (phrase) phrase.addEventListener('input', _updateStep2Button);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attachListeners);
  } else {
    _attachListeners();
  }

  // ── Public action handlers — dispatched by data-action in dashboard-main.js ──
  window.confirmAdminDataDeletion = openErasureModal;
  window._pdpaAdmCancel = function () {
    _hide('pdpaAdmStep1Modal');
    _hide('pdpaAdmStep2Modal');
    _ctx = null;
  };
  window._pdpaAdmStep1Continue = function () {
    const ack1 = document.getElementById('pdpaAdmAckActive')?.checked;
    const ack2 = document.getElementById('pdpaAdmAckRetention')?.checked;
    if (!(ack1 && ack2)) return;
    _hide('pdpaAdmStep1Modal');
    _show('pdpaAdmStep2Modal');
    const inp = document.getElementById('pdpaAdmPhrase');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 50); }
    _updateStep2Button();
  };
  window._pdpaAdmBackToStep1 = function () {
    _hide('pdpaAdmStep2Modal');
    _show('pdpaAdmStep1Modal');
  };
  window._pdpaAdmConfirm = function () { _confirmStep2(); };
  window._pdpaAdmCloseSummary = function () {
    _hide('pdpaAdmSummaryModal');
    _ctx = null;
    if (typeof closeTenantModal === 'function') closeTenantModal();
    // Refresh room grid since erased player/tenant may have changed occupancy
    if (typeof updateRoomStatuses === 'function') updateRoomStatuses();
    if (typeof updateOccupancyDashboard === 'function') updateOccupancyDashboard();
  };
})();
