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
  let _countdownTimer = null;      // single 1s ticker for all locked-row countdowns

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

    // Spin up countdown ticker only when at least one locked row is showing
    if (root.querySelector('[data-bk-countdown]')) startCountdownTicker();
    else stopCountdownTicker();
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

    // Realtime countdown for locked rows — admin sees "เหลือ MM:SS"
    // ticking down to 0. lockedUntil is a Firestore Timestamp.
    const lockMs = b.status === 'locked' && b.lockedUntil
      ? (typeof b.lockedUntil.toMillis === 'function' ? b.lockedUntil.toMillis() : Number(b.lockedUntil))
      : 0;
    const countdownHtml = (lockMs > Date.now())
      ? `<div data-bk-countdown="${lockMs}" style="font-size:.72rem;color:#e65100;margin-top:2px;font-variant-numeric:tabular-nums;font-weight:600;">${formatCountdown(lockMs - Date.now())}</div>`
      : '';

    return `<tr style="border-top:1px solid var(--border, #e0e0e0);">
      <td style="padding:.5rem .8rem;color:var(--text-muted, #666);font-size:.8rem;">${created}</td>
      <td style="padding:.5rem .8rem;">
        <div style="font-weight:600;">${escapeHtml(b.prospectName || '—')}</div>
        <div style="color:var(--text-muted, #666);font-size:.78rem;">${phone}</div>
      </td>
      <td style="padding:.5rem .8rem;">
        <div style="font-family:var(--font-numeric, monospace);">${room}</div>
        <div style="font-size:.72rem;color:var(--text-muted, #999);margin-top:1px;">${shortBookingRef(b.id)}</div>
      </td>
      <td style="padding:.5rem .8rem;font-size:.85rem;">${startDate}<br><small style="color:var(--text-muted, #666);">${b.durationMonths || '?'} เดือน</small></td>
      <td style="padding:.5rem .8rem;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">฿${formatNum(b.depositAmount)}</td>
      <td style="padding:.5rem .8rem;">
        <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:.78rem;background:${s.bg};color:${s.color};">${s.label}</span>
        ${countdownHtml}
        ${b.earlyBirdEligible ? '<div style="font-size:.7rem;color:#1a5c38;margin-top:2px;">🎁 Early Bird +500</div>' : ''}
      </td>
      <td style="padding:.5rem .8rem;">
        <div style="display:flex;flex-wrap:wrap;gap:.3rem;">${actions}</div>
      </td>
    </tr>`;
  }

  // ── Realtime countdown ticker ─────────────────────────────────────────────
  // One setInterval ticks every 1s and updates ALL locked-row countdowns via
  // data-bk-countdown="<expireMs>". When a countdown hits 0 we freeze the cell
  // to "หมดเวลา"; the scheduled CF (every 5 min) flips the doc status to
  // 'expired' shortly after, and onSnapshot then re-renders the row's pill.
  function formatCountdown(ms) {
    if (ms <= 0) return '⏰ หมดเวลา';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `⏱ เหลือ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} นาที`;
  }
  function tickCountdowns() {
    const cells = document.querySelectorAll('[data-bk-countdown]');
    if (cells.length === 0) { stopCountdownTicker(); return; }
    const now = Date.now();
    cells.forEach(el => {
      const expireMs = Number(el.dataset.bkCountdown);
      if (!expireMs) return;
      const remain = expireMs - now;
      el.textContent = formatCountdown(remain);
      if (remain <= 0) {
        el.style.color = '#c62828';
        el.removeAttribute('data-bk-countdown');  // freeze; status will flip via onSnapshot
      }
    });
  }
  function startCountdownTicker() {
    if (_countdownTimer) return;
    _countdownTimer = setInterval(tickCountdowns, 1000);
  }
  function stopCountdownTicker() {
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
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
    if (b.kycDocsPath && (status === 'kyc_pending' || status === 'kyc_approved')) {
      buttons.push(`<button data-bk-action="viewKyc" data-id="${id}" class="u-btn-tbl-edit" style="background:#e3f2fd;border-color:#1976d2;color:#1565c0;">🪪 เอกสาร</button>`);
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
    if (action === 'viewKyc') return openKycViewer(booking);
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
        <div class="u-modal-title">รายละเอียดการจอง — ${escapeHtml(shortBookingRef(b.id))}</div>
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

  // ── Action: KYC document viewer ───────────────────────────────────────────
  async function openKycViewer(b) {
    if (!b.kycDocsPath) { toastBk('ไม่มีเอกสาร KYC', 'warn'); return; }
    if (!window.firebase?.storage || !window.firebase?.storageFunctions) {
      toastBk('Storage SDK ไม่พร้อม', 'error');
      return;
    }

    closeAnyModal();
    const overlay = document.createElement('div');
    overlay.id = 'booking-kyc-modal';
    overlay.className = 'u-modal-overlay';
    overlay.innerHTML = `
      <div class="u-modal-panel u-modal-panel-md">
        <div class="u-modal-title">🪪 เอกสาร KYC — ${escapeHtml(b.prospectName || shortBookingRef(b.id))}</div>
        <div id="kyc-docs-body" style="min-height:100px;display:flex;align-items:center;justify-content:center;">
          <span style="color:var(--text-muted);">⏳ กำลังโหลด...</span>
        </div>
        <div class="u-btn-row" style="margin-top:1rem;">
          ${b.status === 'kyc_pending'
            ? `<button id="kyc-approve-btn" class="u-btn-ok" style="background:var(--green-dark);color:#fff;border-color:var(--green-dark);">✓ อนุมัติ KYC</button>`
            : ''}
          <button class="u-btn-cancel" data-bk-kyc-close>ปิด</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _modalOpen = true;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.matches('[data-bk-kyc-close]')) closeAnyModal();
    });
    const approveBtn = overlay.querySelector('#kyc-approve-btn');
    if (approveBtn) approveBtn.addEventListener('click', async () => { closeAnyModal(); await doApproveKyc(b); });

    const DOC_LABELS = {
      idCardFront:      'บัตร ปชช. หน้า',
      idCardBack:       'บัตร ปชช. หลัง',
      houseReg:         'ทะเบียนบ้าน',
      employmentLetter: 'หนังสือรับรองเงินเดือน',
    };

    try {
      const sf = window.firebase.storageFunctions;
      const stg = window.firebase.storage();
      const folder = b.kycDocsPath.endsWith('/') ? b.kycDocsPath : b.kycDocsPath + '/';
      const listResult = await sf.listAll(sf.ref(stg, folder));
      const body = document.getElementById('kyc-docs-body');
      if (!body) return;

      if (listResult.items.length === 0) {
        body.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted);text-align:center;">ไม่พบไฟล์เอกสารใน Storage</div>';
        return;
      }

      const items = await Promise.all(listResult.items.map(async itemRef => {
        const url = await sf.getDownloadURL(itemRef);
        const name = itemRef.name;
        const docType = name.replace(/\.[^.]+$/, '');
        const label = DOC_LABELS[docType] || docType;
        const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
        return { url, name, label, isImage };
      }));

      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem;width:100%;padding:.5rem 0;">
        ${items.map(it => `
          <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer"
             style="display:block;border:1.5px solid var(--border);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;transition:box-shadow .15s;"
             onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.15)'" onmouseout="this.style.boxShadow=''">
            ${it.isImage
              ? `<img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.label)}"
                     style="width:100%;height:120px;object-fit:cover;display:block;"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                 <div style="display:none;height:120px;align-items:center;justify-content:center;font-size:2.5rem;background:var(--surface-sunken);">📄</div>`
              : `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:var(--surface-sunken);">📄</div>`
            }
            <div style="padding:.4rem .6rem .1rem;font-size:.82rem;font-weight:600;color:var(--text);">${escapeHtml(it.label)}</div>
            <div style="padding:.1rem .6rem .5rem;font-size:.72rem;color:var(--green-dark);">คลิกเพื่อเปิด ↗</div>
          </a>
        `).join('')}
      </div>`;
    } catch (e) {
      const body = document.getElementById('kyc-docs-body');
      if (body) body.innerHTML = `<div style="padding:1rem;color:#c62828;">โหลดเอกสารไม่สำเร็จ: ${escapeHtml(e.message || String(e))}</div>`;
      console.error('openKycViewer failed:', e);
    }
  }

  // ── Action: approve KYC ───────────────────────────────────────────────────
  async function doApproveKyc(b) {
    const ok = await window.ghConfirm(`อนุมัติ KYC สำหรับ ${b.prospectName} (${b.building}/${b.roomId})?`, { title: 'ยืนยันการอนุมัติ', confirmLabel: 'อนุมัติ' });
    if (!ok) return;
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
    const proceed = await ghConfirm(
      `แปลงการจองห้อง ${b.building}/${b.roomId} (${b.prospectName}) เป็นผู้เช่าใหม่?\n` +
      `ค่าเช่า ฿${formatNum(b.monthlyRent)}/เดือน · สัญญา ${b.durationMonths} เดือน\n` +
      `ระบบจะสร้างเอกสารผู้เช่าและอนุมัติ LIFF ให้อัตโนมัติ`,
      { confirmLabel: 'แปลงเป็นผู้เช่า' }
    );
    if (!proceed) return;
    if (!window.firebase?.functions?.httpsCallable) { toastBk('Firebase functions ไม่พร้อม', 'error'); return; }
    try {
      const callable = window.firebase.functions.httpsCallable('convertBookingToTenant');
      const skipKyc = b.status === 'paid';   // status='paid' means we're skipping the optional KYC step
      const res = await callable({ bookingId: b.id, skipKyc });
      const data = res?.data || {};
      const restoredLabel = {
        live: 'ลูกบ้านเดิมที่ยังเช่าอยู่',
        archive_uid: 'ลูกบ้านเก่ากลับมา (LINE เดิม)',
        archive_lineid: 'ลูกบ้านเก่ากลับมา (LINE ID เดิม)',
        archive_phone: 'ลูกบ้านเก่ากลับมา (เบอร์เดิม)',
        people_player: 'Community Member กลับมาเช่า',
      }[data.restoredFrom] || 'ลูกบ้านใหม่';
      const msg = `✓ แปลงสำเร็จ! tenantId=${data.tenantId} — ${restoredLabel}`;
      toastBk(msg, 'success');
    } catch (e) {
      console.error('convertBookingToTenant failed:', e);
      const msg = e?.message || String(e);
      toastBk('แปลงไม่สำเร็จ: ' + msg, 'error');
    }
  }

  // ── Action: cancel locked booking ─────────────────────────────────────────
  async function doCancelLock(b) {
    const ok = await window.ghConfirm(`ยกเลิกล็อคห้องของ ${b.prospectName}? ห้องจะกลับมาว่าง`, { danger: true });
    if (!ok) return;
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
    ['booking-details-modal', 'booking-kyc-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.remove();
    });
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
  function shortBookingRef(id) {
    if (!id) return '—';
    const parts = id.split('-');
    if (parts.length >= 3) {
      const roomPart = parts[2] || '';
      const suffix = id.slice(-6).toUpperCase();
      return `${parts[0]}-${roomPart}-${suffix}`;
    }
    return '#' + id.slice(-8).toUpperCase();
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
    teardown: () => {
      if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
      stopCountdownTicker();
    },
  };
})();
