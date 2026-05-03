/**
 * dashboard-bookings.js — admin Booking sub-tab in dashboard.html.
 *
 * Reads from the top-level bookings/* collection (NOT under tenants/) populated
 * by the booking flow CFs. Renders a table with filters + actions:
 *   - View slip: opens the slip image from Firebase Storage in a new tab
 *   - Approve KYC: status=kyc_pending → kyc_approved (admin write per rules)
 *   - Convert: invokes convertBookingToTenant CF (atomic tenant doc creation)
 *   - Cancel locked: status=locked → cancelled (admin write per rules)
 *
 * Subscription is started on first tab open (lazy) and reused thereafter —
 * idempotent guard prevents double-subscribe on tab toggle.
 *
 * UMD-style global exports match dashboard-extra.js pattern (window.X = ...).
 */
(function () {
  'use strict';

  // ── Module state ──────────────────────────────────────────────────────────
  let _unsub = null;
  let _bookings = [];
  let _filterStatus = 'pending';   // 'all' | 'pending' | 'paid' | 'kyc' | 'converted' | 'cancelled' | 'expired'
  let _searchTerm = '';
  let _modalOpen = false;

  const STATUS_PILL = {
    locked:        { label: '🔒 ล็อคไว้',     bg: '#fff3e0', color: '#e65100' },
    paid:          { label: '✅ จ่ายแล้ว',     bg: '#e8f5e9', color: '#1a5c38' },
    kyc_pending:   { label: '📋 รอตรวจ KYC',  bg: '#e3f2fd', color: '#1565c0' },
    kyc_approved:  { label: '📋 KYC ผ่าน',    bg: '#e8eaf6', color: '#3f51b5' },
    converted:     { label: '✓ แปลงแล้ว',    bg: '#f3e5f5', color: '#6a1b9a' },
    cancelled:     { label: '✕ ยกเลิก',       bg: '#fafafa', color: '#9e9e9e' },
    expired:       { label: '⏰ หมดเวลา',     bg: '#ffebee', color: '#c62828' },
  };

  // ── Public entry point — called by switchTenantMainTab on tab open ────────
  window.initBookingsAdmin = function () {
    const root = document.getElementById('bookings-list-mount');
    if (!root) return;

    // Wire filter inputs once
    const statusEl = document.getElementById('bookings-filter-status');
    const searchEl = document.getElementById('bookings-filter-search');
    if (statusEl && !statusEl._wired) {
      statusEl._wired = true;
      statusEl.addEventListener('change', () => { _filterStatus = statusEl.value || 'all'; render(); });
    }
    if (searchEl && !searchEl._wired) {
      searchEl._wired = true;
      let t;
      searchEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { _searchTerm = String(searchEl.value || '').trim().toLowerCase(); render(); }, 200);
      });
    }

    if (_unsub) { render(); return; }   // already subscribed

    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      root.innerHTML = '<div style="padding:1rem;color:#c62828;">Firebase ไม่พร้อม — รีเฟรชหน้า</div>';
      return;
    }
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    try {
      const q = fs.query(fs.collection(db, 'bookings'), fs.orderBy('createdAt', 'desc'), fs.limit(200));
      _unsub = fs.onSnapshot(q, snap => {
        _bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        render();
      }, err => {
        console.error('bookings onSnapshot:', err);
        root.innerHTML = `<div style="padding:1rem;color:#c62828;">โหลด bookings ไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
      });
    } catch (e) {
      console.error('bookings subscribe failed:', e);
      root.innerHTML = `<div style="padding:1rem;color:#c62828;">โหลด bookings ไม่สำเร็จ: ${escapeHtml(e.message)}</div>`;
    }
  };

  // ── Render table ──────────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('bookings-list-mount');
    const countEl = document.getElementById('bookings-count');
    if (!root) return;

    const filtered = applyFilter(_bookings);
    if (countEl) countEl.textContent = `${filtered.length} / ${_bookings.length} รายการ`;

    if (filtered.length === 0) {
      root.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted, #666);">
        ${_bookings.length === 0 ? 'ยังไม่มีการจอง — รอลูกบ้านเปิด LIFF จองห้อง' : 'ไม่พบรายการตรงตามตัวกรอง'}
      </div>`;
      return;
    }

    let html = `<div style="overflow-x:auto;background:#fff;border-radius:8px;box-shadow:var(--shadow-sm);">
      <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
        <thead>
          <tr style="background:var(--green-pale, #e8f5e9);text-align:left;">
            <th style="padding:.6rem .8rem;">วันจอง</th>
            <th style="padding:.6rem .8rem;">ลูกบ้านที่จอง</th>
            <th style="padding:.6rem .8rem;">ห้อง</th>
            <th style="padding:.6rem .8rem;">ย้ายเข้า</th>
            <th style="padding:.6rem .8rem;text-align:right;">มัดจำ</th>
            <th style="padding:.6rem .8rem;">สถานะ</th>
            <th style="padding:.6rem .8rem;">การจัดการ</th>
          </tr>
        </thead>
        <tbody>`;
    filtered.forEach(b => {
      html += renderRow(b);
    });
    html += `</tbody></table></div>`;
    root.innerHTML = html;

    // Wire row buttons via event delegation (avoids re-binding on every render)
    if (!root._delegated) {
      root._delegated = true;
      root.addEventListener('click', handleRowClick);
    }
  }

  function applyFilter(rows) {
    return rows.filter(b => {
      // Status filter
      if (_filterStatus === 'pending') {
        if (!['locked', 'paid', 'kyc_pending', 'kyc_approved'].includes(b.status)) return false;
      } else if (_filterStatus === 'kyc') {
        if (!['kyc_pending', 'kyc_approved'].includes(b.status)) return false;
      } else if (_filterStatus !== 'all') {
        if (b.status !== _filterStatus) return false;
      }
      // Search
      if (_searchTerm) {
        const hay = [b.prospectName, b.prospectPhone, b.roomId, b.prospectLineId, b.id]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(_searchTerm)) return false;
      }
      return true;
    });
  }

  function renderRow(b) {
    const s = STATUS_PILL[b.status] || { label: b.status, bg: '#eee', color: '#666' };
    const created = b.createdAt && typeof b.createdAt.toDate === 'function'
      ? formatDateTime(b.createdAt.toDate()) : '—';
    const startDate = b.startDate && typeof b.startDate.toDate === 'function'
      ? formatDate(b.startDate.toDate()) : '—';
    const room = `${escapeHtml(b.building || '')}/${escapeHtml(b.roomId || '')}`;
    const phone = formatPhone(b.prospectPhone);

    const actions = renderActions(b);

    return `<tr style="border-top:1px solid var(--border, #e0e0e0);">
      <td style="padding:.5rem .8rem;color:var(--text-muted, #666);font-size:.8rem;">${created}</td>
      <td style="padding:.5rem .8rem;">
        <div style="font-weight:600;">${escapeHtml(b.prospectName || '—')}</div>
        <div style="color:var(--text-muted, #666);font-size:.78rem;">${phone}</div>
      </td>
      <td style="padding:.5rem .8rem;font-family:var(--font-numeric, monospace);">${room}</td>
      <td style="padding:.5rem .8rem;font-size:.85rem;">${startDate}<br><small style="color:var(--text-muted, #666);">${b.durationMonths || '?'} เดือน</small></td>
      <td style="padding:.5rem .8rem;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">฿${formatNum(b.depositAmount)}</td>
      <td style="padding:.5rem .8rem;">
        <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:.78rem;background:${s.bg};color:${s.color};">${s.label}</span>
        ${b.earlyBirdEligible ? '<div style="font-size:.7rem;color:#1a5c38;margin-top:2px;">🎁 Early Bird +500</div>' : ''}
      </td>
      <td style="padding:.5rem .8rem;">
        <div style="display:flex;flex-wrap:wrap;gap:.3rem;">${actions}</div>
      </td>
    </tr>`;
  }

  function renderActions(b) {
    const id = escapeHtml(b.id);
    const status = b.status;
    const buttons = [];
    // Always available: view details
    buttons.push(`<button data-bk-action="details" data-id="${id}" class="u-btn-tbl-edit" title="ดูรายละเอียด">📄</button>`);
    if (b.slipImagePath) {
      buttons.push(`<button data-bk-action="slip" data-id="${id}" class="u-btn-preview" style="margin:0;padding:4px 10px;">🧾 สลิป</button>`);
    }
    if (status === 'kyc_pending') {
      buttons.push(`<button data-bk-action="approveKyc" data-id="${id}" class="u-btn-tbl-edit" style="background:#bbdefb;border-color:#1976d2;color:#0d47a1;">✓ อนุมัติ KYC</button>`);
    }
    if (status === 'paid' || status === 'kyc_approved') {
      buttons.push(`<button data-bk-action="convert" data-id="${id}" class="u-btn-tbl-edit" style="background:#e1bee7;border-color:#6a1b9a;color:#4a148c;font-weight:700;">🏠 แปลงเป็นผู้เช่า</button>`);
    }
    if (status === 'locked') {
      buttons.push(`<button data-bk-action="cancel" data-id="${id}" class="u-btn-tbl-del">✕ ยกเลิก</button>`);
    }
    return buttons.join('');
  }

  // ── Event delegation for row buttons ──────────────────────────────────────
  function handleRowClick(e) {
    const btn = e.target.closest('[data-bk-action]');
    if (!btn) return;
    const action = btn.dataset.bkAction;
    const id = btn.dataset.id;
    const booking = _bookings.find(b => b.id === id);
    if (!booking) return;
    if (action === 'details') return openDetailsModal(booking);
    if (action === 'slip') return openSlipViewer(booking);
    if (action === 'approveKyc') return doApproveKyc(booking);
    if (action === 'convert') return doConvert(booking);
    if (action === 'cancel') return doCancelLock(booking);
  }

  // ── Action: details modal ─────────────────────────────────────────────────
  function openDetailsModal(b) {
    closeAnyModal();
    const overlay = document.createElement('div');
    overlay.id = 'booking-details-modal';
    overlay.className = 'u-modal-overlay';
    overlay.innerHTML = `
      <div class="u-modal-panel u-modal-panel-md">
        <div class="u-modal-title">รายละเอียดการจอง — ${escapeHtml(b.id)}</div>
        ${detailsRows(b)}
        <div class="u-btn-row">
          <button class="u-btn-cancel" data-bk-modal-close>ปิด</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _modalOpen = true;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.matches('[data-bk-modal-close]')) closeAnyModal();
    });
  }

  function detailsRows(b) {
    const rows = [
      ['Booking ID', escapeHtml(b.id)],
      ['LINE user', escapeHtml(b.prospectLineId || '—')],
      ['ชื่อ', escapeHtml(b.prospectName || '—')],
      ['เบอร์', formatPhone(b.prospectPhone)],
      ['ห้อง', `${escapeHtml(b.building)}/${escapeHtml(b.roomId)}`],
      ['ย้ายเข้า', b.startDate?.toDate ? formatDate(b.startDate.toDate()) : '—'],
      ['ระยะสัญญา', `${b.durationMonths || '?'} เดือน`],
      ['ค่าเช่า/เดือน', '฿' + formatNum(b.monthlyRent)],
      ['ค่ามัดจำ', '฿' + formatNum(b.depositAmount)],
      ['Early Bird', b.earlyBirdEligible ? '✓ +' + (b.earlyBirdPoints || 500) + ' pts' : '—'],
      ['สถานะ', escapeHtml(b.status || '—')],
      ['Slip txn ref', escapeHtml(b.slipTransactionRef || '—')],
      ['Slip verified', b.slipVerifiedAt?.toDate ? formatDateTime(b.slipVerifiedAt.toDate()) : '—'],
      ['สร้างเมื่อ', b.createdAt?.toDate ? formatDateTime(b.createdAt.toDate()) : '—'],
    ];
    if (b.tenantId) rows.push(['Tenant ID (หลัง convert)', escapeHtml(b.tenantId)]);
    if (b.contractId) rows.push(['Contract ID', escapeHtml(b.contractId)]);
    if (b.expiredAt?.toDate) rows.push(['หมดเวลาเมื่อ', formatDateTime(b.expiredAt.toDate())]);
    return `<div style="display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;font-size:.88rem;">
      ${rows.map(([k, v]) => `<div style="color:var(--text-muted, #666);">${k}</div><div style="font-family:var(--font-numeric, monospace);">${v}</div>`).join('')}
    </div>`;
  }

  // ── Action: slip viewer ───────────────────────────────────────────────────
  async function openSlipViewer(b) {
    if (!b.slipImagePath) { toastBk('ไม่มีรูปสลิป', 'warn'); return; }
    if (!window.firebase?.storage || !window.firebase?.storageFunctions?.getDownloadURL) {
      toastBk('Storage SDK ไม่พร้อม', 'error');
      return;
    }
    try {
      const sf = window.firebase.storageFunctions;
      const stg = window.firebase.storage();
      const ref = sf.ref(stg, b.slipImagePath);
      const url = await sf.getDownloadURL(ref);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('slip download URL failed:', e);
      toastBk('ดึงสลิปไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  }

  // ── Action: approve KYC ───────────────────────────────────────────────────
  async function doApproveKyc(b) {
    if (!confirm(`อนุมัติ KYC สำหรับ ${b.prospectName} (${b.building}/${b.roomId})?`)) return;
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    try {
      const ref = fs.doc(db, 'bookings', b.id);
      await fs.setDoc(ref, {
        status: 'kyc_approved',
        kycApprovedAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp(),
      }, { merge: true });
      toastBk('✓ KYC อนุมัติแล้ว', 'success');
    } catch (e) {
      console.error('approveKyc failed:', e);
      toastBk('อนุมัติไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  }

  // ── Action: convert booking → tenant ──────────────────────────────────────
  async function doConvert(b) {
    const proceed = confirm(
      `แปลงการจองนี้เป็นผู้เช่าใหม่?\n\n` +
      `ห้อง: ${b.building}/${b.roomId}\n` +
      `ลูกบ้าน: ${b.prospectName}\n` +
      `ค่าเช่า: ฿${formatNum(b.monthlyRent)}/เดือน\n` +
      `ระยะสัญญา: ${b.durationMonths} เดือน\n\n` +
      `ระบบจะสร้างเอกสารผู้เช่าและอนุมัติ LIFF ให้อัตโนมัติ`
    );
    if (!proceed) return;
    if (!window.firebase?.functions?.httpsCallable) { toastBk('Firebase functions ไม่พร้อม', 'error'); return; }
    try {
      const callable = window.firebase.functions.httpsCallable('convertBookingToTenant');
      const skipKyc = b.status === 'paid';   // status='paid' means we're skipping the optional KYC step
      const res = await callable({ bookingId: b.id, skipKyc });
      const data = res?.data || {};
      const msg = `✓ แปลงสำเร็จ! tenantId=${data.tenantId}` + (data.isReturningTenant ? ' (returning tenant)' : ' (ลูกบ้านใหม่)');
      toastBk(msg, 'success');
    } catch (e) {
      console.error('convertBookingToTenant failed:', e);
      const msg = e?.message || String(e);
      toastBk('แปลงไม่สำเร็จ: ' + msg, 'error');
    }
  }

  // ── Action: cancel locked booking ─────────────────────────────────────────
  async function doCancelLock(b) {
    if (!confirm(`ยกเลิกล็อคห้องของ ${b.prospectName}? (ห้องจะกลับมาว่าง)`)) return;
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    try {
      const ref = fs.doc(db, 'bookings', b.id);
      await fs.setDoc(ref, {
        status: 'cancelled',
        cancelledAt: fs.serverTimestamp(),
        cancelledBy: 'admin',
        updatedAt: fs.serverTimestamp(),
      }, { merge: true });
      toastBk('✓ ยกเลิกแล้ว', 'success');
    } catch (e) {
      console.error('cancel booking failed:', e);
      toastBk('ยกเลิกไม่สำเร็จ: ' + (e.message || e), 'error');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function closeAnyModal() {
    const m = document.getElementById('booking-details-modal');
    if (m) m.remove();
    _modalOpen = false;
  }
  function toastBk(msg, kind) {
    // Lean on dashboard's existing toast helper if available
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : 'success');
      return;
    }
    if (typeof window.toast === 'function') { window.toast(msg, kind); return; }
    const t = document.createElement('div');
    t.className = kind === 'error' ? 'u-toast' : 'u-toast-center';
    if (kind === 'error') t.style.background = '#c62828';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  function formatNum(n) { return Number(n || 0).toLocaleString('th-TH'); }
  function formatDate(d) {
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }
  function formatDateTime(d) {
    return formatDate(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function formatPhone(p) {
    const s = String(p || '').replace(/\D/g, '');
    if (s.length === 10) return s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6);
    return s || '—';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Expose for testing / future hot-swap
  window.dashboardBookings = {
    refresh: render,
    teardown: () => { if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; } },
  };
})();
