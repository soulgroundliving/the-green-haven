(function() {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────
  let _fbBuilding = null;
  let _fbRoom     = null;
  let _fbUid      = null;
  let _fbDate     = new Date();                     // JS Date (today)
  let _fbType     = 'parking';                      // active facility type
  let _fbConfirmPayload = null;                     // pending booking data
  let _fbConfigs  = [];                             // facilityConfig docs

  // ── Helpers ─────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function _dateStr(d) {
    // CE YYYY-MM-DD
    return d.toISOString().slice(0, 10);
  }

  function _dateLabelThai(d) {
    const days  = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d); target.setHours(0,0,0,0);
    const diff = Math.round((target - today) / 86400000);
    const prefix = diff === 0 ? 'วันนี้ · ' : diff === 1 ? 'พรุ่งนี้ · ' : '';
    return `${prefix}${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  function _timeSlotLabel(id) {
    const map = { morning:'เช้า (08:00–12:00)', afternoon:'บ่าย (12:00–17:00)',
                  evening:'เย็น (17:00–21:00)', fullday:'ทั้งวัน' };
    return map[id] || id;
  }

  // ── Init page ────────────────────────────────────────────────────────────
  async function _initFacilityPage() {
    if (!window.FacilityBookingManager) {
      document.getElementById('fb-slot-grid').innerHTML =
        '<div style="color:#c62828;text-align:center;padding:2rem;">FacilityBookingManager not loaded</div>';
      return;
    }

    // Load configs for this building
    _fbConfigs = await window.FacilityBookingManager.listConfig(_fbBuilding);

    // If no configs yet, show helpful message
    if (_fbConfigs.length === 0) {
      document.getElementById('fb-type-tabs').innerHTML = '';
      document.getElementById('fb-slot-grid').innerHTML =
        '<div style="text-align:center;color:var(--text-muted);padding:2rem;">ยังไม่มีสิ่งอำนวยความสะดวกที่เปิดให้จอง<br><small>ผู้ดูแลจะเปิดใช้งานเร็ว ๆ นี้</small></div>';
      _loadMyBookings();
      return;
    }

    // Set active type to first available if current isn't configured
    if (!_fbConfigs.find(c => c.type === _fbType)) {
      _fbType = _fbConfigs[0].type;
    }

    _renderTypeTabs();
    _renderDateLabel();
    await _renderSlotGrid();
    _loadMyBookings();
  }

  function _renderTypeTabs() {
    const container = document.getElementById('fb-type-tabs');
    if (!container) return;
    container.innerHTML = _fbConfigs.map(c => {
      const active = c.type === _fbType;
      return `<button data-action="fbSelectType" data-type="${_esc(c.type)}"
        style="padding:.5rem 1rem;border-radius:20px;font-family:var(--font-brand);font-size:.88rem;font-weight:600;cursor:pointer;border:1px solid ${active ? 'var(--primary-green)' : 'var(--border)'};background:${active ? 'var(--primary-green)' : '#fff'};color:${active ? '#fff' : 'var(--text)'};">
        ${_esc(window.FacilityBookingManager.getFacilityEmoji(c.type))} ${_esc(c.displayName || window.FacilityBookingManager.getFacilityLabel(c.type))}
      </button>`;
    }).join('');
  }

  function _renderDateLabel() {
    const el = document.getElementById('fb-date-label');
    if (el) el.textContent = _dateLabelThai(_fbDate);
  }

  async function _renderSlotGrid() {
    const grid = document.getElementById('fb-slot-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="gh-skeleton" style="height:56px; border-radius:12px; margin-bottom:10px;"></div>'
                   + '<div class="gh-skeleton" style="height:56px; border-radius:12px; margin-bottom:10px;"></div>'
                   + '<div class="gh-skeleton" style="height:56px; border-radius:12px;"></div>';

    const config = _fbConfigs.find(c => c.type === _fbType);
    if (!config) {
      grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">— ไม่พบข้อมูล —</div>';
      return;
    }

    const dateStr = _dateStr(_fbDate);
    const bookings = await window.FacilityBookingManager.listBookingsByDate(_fbBuilding, _fbType, dateStr);

    // Build a Set of occupied slot+timeSlot keys
    const occupied = new Set(bookings.map(b => `${b.slot}::${b.timeSlot}`));

    const slots = Array.isArray(config.slots) ? config.slots.filter(s => s.enabled !== false) : [];
    const timeSlots = Array.isArray(config.timeSlots) && config.timeSlots.length > 0
      ? config.timeSlots
      : [
          { id: 'morning',   label: _timeSlotLabel('morning') },
          { id: 'afternoon', label: _timeSlotLabel('afternoon') },
          { id: 'evening',   label: _timeSlotLabel('evening') }
        ];

    if (slots.length === 0) {
      grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">ยังไม่มี slot ที่เปิดให้จอง</div>';
      return;
    }

    const rows = slots.map(sl => {
      const tsCells = timeSlots.map(ts => {
        const key = `${sl.id}::${ts.id}`;
        const isOccupied = occupied.has(key);
        const isOwn = bookings.find(b => b.slot === sl.id && b.timeSlot === ts.id && b.tenantUid === _fbUid);
        const bg    = isOwn ? '#e8f5e9' : isOccupied ? '#fafafa' : '#fff';
        const color = isOwn ? 'var(--primary-green)' : isOccupied ? '#bbb' : 'var(--text)';
        const border = isOwn ? '2px solid var(--primary-green)' : '1px solid var(--border)';
        const cursor = isOccupied ? 'default' : 'pointer';
        const label  = isOwn ? '✅ ของคุณ' : isOccupied ? '🔒 เต็ม' : ts.label;
        const action = (!isOccupied && !isOwn)
          ? `data-action="fbSlotPick" data-slot="${_esc(sl.id)}" data-timeslot="${_esc(ts.id)}"` : '';
        return `<td style="padding:.4rem .6rem;border:${border};border-radius:6px;background:${bg};color:${color};font-size:.78rem;text-align:center;cursor:${cursor};font-weight:600;" ${action}>${_esc(label)}</td>`;
      }).join('');

      return `<tr>
        <td style="padding:.4rem .6rem;font-size:.82rem;font-weight:700;white-space:nowrap;">${_esc(sl.label || sl.id)}</td>
        ${tsCells}
      </tr>`;
    }).join('');

    const headerCells = timeSlots.map(ts =>
      `<th style="padding:.3rem .5rem;font-size:.78rem;color:var(--text-muted);font-weight:600;">${_esc(ts.label)}</th>`
    ).join('');

    grid.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:separate;border-spacing:4px;">
          <thead><tr><th></th>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  async function _loadMyBookings() {
    const container = document.getElementById('fb-my-bookings');
    if (!container || !_fbUid) return;
    const bookings = await window.FacilityBookingManager.listMyBookings(_fbUid);
    if (bookings.length === 0) {
      container.innerHTML = window.GhEmptyState
          ? window.GhEmptyState.html('tasks', { title:'ยังไม่มีการจอง', text:'เลือกพื้นที่ส่วนกลางและจองได้เลยครับ' })
          : '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:.75rem;">ยังไม่มีการจอง</div>';
      return;
    }
    container.innerHTML = bookings.slice(0, 5).map(b => {
      const emoji = window.FacilityBookingManager.getFacilityEmoji(b.facilityType);
      const label = window.FacilityBookingManager.getFacilityLabel(b.facilityType);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .8rem;background:#f9f9f9;border-radius:10px;gap:.5rem;">
        <div style="font-size:.88rem;">
          <span style="font-weight:700;">${_esc(emoji)} ${_esc(label)}</span> · ${_esc(b.slot)}<br>
          <small style="color:var(--text-muted);">${_esc(b.date)} · ${_esc(_timeSlotLabel(b.timeSlot))}</small>
        </div>
        <button data-action="fbCancelMyBooking" data-bid="${_esc(b.id)}"
          style="padding:.3rem .65rem;border-radius:8px;border:1px solid #f44336;background:#fff;color:#f44336;font-size:.78rem;cursor:pointer;font-weight:600;white-space:nowrap;">
          ยกเลิก
        </button>
      </div>`;
    }).join('');
  }

  // ── Action handlers (wired to window.* for _ta dispatch) ─────────────────

  window.fbSelectType = async function(el) {
    _fbType = el.dataset.type || _fbType;
    _renderTypeTabs();
    await _renderSlotGrid();
  };

  window.fbPrevDate = async function() {
    const d = new Date(_fbDate);
    d.setDate(d.getDate() - 1);
    const today = new Date(); today.setHours(0,0,0,0);
    if (d < today) return;           // don't go to the past
    _fbDate = d;
    _renderDateLabel();
    await _renderSlotGrid();
  };

  window.fbNextDate = async function() {
    _fbDate = new Date(_fbDate);
    _fbDate.setDate(_fbDate.getDate() + 1);
    _renderDateLabel();
    await _renderSlotGrid();
  };

  window.fbSlotPick = function(el) {
    const slot     = el.dataset.slot;
    const timeSlot = el.dataset.timeslot;
    if (!slot || !timeSlot) return;

    const config = _fbConfigs.find(c => c.type === _fbType);
    const slotCfg = (config?.slots || []).find(s => s.id === slot);
    _fbConfirmPayload = {
      building: _fbBuilding,
      facilityType: _fbType,
      slot,
      date: _dateStr(_fbDate),
      timeSlot
    };

    const emoji = window.FacilityBookingManager.getFacilityEmoji(_fbType);
    const facilityLabel = config?.displayName || window.FacilityBookingManager.getFacilityLabel(_fbType);
    document.getElementById('fb-confirm-title').textContent = `ยืนยันจอง ${emoji} ${facilityLabel}`;
    document.getElementById('fb-confirm-detail').textContent =
      `${slotCfg?.label || slot} · ${_dateLabelThai(_fbDate)} · ${_timeSlotLabel(timeSlot)}`;

    const modal = document.getElementById('fb-confirm-modal');
    modal.style.display = 'flex';
  };

  window.fbCancelModal = function() {
    const modal = document.getElementById('fb-confirm-modal');
    if (modal) modal.style.display = '';
    _fbConfirmPayload = null;
  };

  window.fbConfirmBooking = async function() {
    if (!_fbConfirmPayload) return;
    const btn = document.getElementById('fb-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังจอง...'; }
    try {
      await window.FacilityBookingManager.createBooking(_fbConfirmPayload);
      window.fbCancelModal();
      window.showToast?.('จองสำเร็จ ✅', 'success');
      await _renderSlotGrid();
      _loadMyBookings();
    } catch (err) {
      const msg = err?.message || 'จองล้มเหลว';
      window.showToast?.(msg, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✅ จอง'; }
    }
  };

  window.fbCancelMyBooking = async function(el) {
    const bookingId = el.dataset.bid;
    if (!bookingId) return;
    if (!confirm('ยืนยันยกเลิกการจอง?')) return;
    try {
      await window.FacilityBookingManager.cancelBooking(bookingId);
      window.showToast?.('ยกเลิกการจองแล้ว', 'success');
      _loadMyBookings();
      await _renderSlotGrid();
    } catch (err) {
      window.showToast?.(err?.message || 'ยกเลิกล้มเหลว', 'error');
    }
  };

  // ── Hook into showSubPage for 'facility-booking' ─────────────────────────
  const _origShowSubPage = window.showSubPage;
  window.showSubPage = function(page) {
    if (page === 'facility-booking') {
      // Show the page first
      if (_origShowSubPage) _origShowSubPage(page);
      else {
        document.querySelectorAll('.page').forEach(p => p.classList.add('u-hidden'));
        const target = document.getElementById('facility-booking');
        if (target) target.classList.remove('u-hidden');
      }

      // Init with current auth claims — read canonical window globals set by
      // detectRoomBuilding() + linkAuthUid() in the main script block.
      _fbBuilding = window._tenantAppBuilding || 'rooms';
      _fbRoom     = window._tenantAppRoom     || '';
      _fbUid      = window._authUid || '';
      _fbDate     = new Date();
      _initFacilityPage();
      return;
    }
    if (_origShowSubPage) _origShowSubPage(page);
  };

  // Also expose for _onLiffClaimsReady warm-up (no-op if page not visible)
  window._initFacilityPage = _initFacilityPage;

  // Warm-up: prime building/room/uid so _initFacilityPage has correct context
  // when called before showSubPage('facility-booking') is tapped.
  window._onLiffClaimsReady(function() {
    _fbBuilding = window._tenantAppBuilding || 'rooms';
    _fbRoom     = window._tenantAppRoom     || '';
    _fbUid      = window._authUid || '';
  });
})();

// ── Sprint 7 follow-up — presence heartbeat ────────────────────────────
// Tenant writes `presence/{lineUserId}.lastActiveAt = serverTimestamp()`
// while the tab is visible. notifyMarketplaceChat reads this and skips
// the LINE OA push when the recipient is active in-app (within 90s) —
// the in-app toast already covers them. When the user backgrounds the
// tab or closes the app, the heartbeat stops, presence goes stale, and
// LINE push fires as the fallback.
//
// Rate: every 60s + on visibility-change (visible). Skipped silently
// when auth.uid doesn't start with 'line:' (admin preview / web).
(function _setupPresenceHeartbeat() {
  function _writePresence() {
    if (document.visibilityState !== 'visible') return;
    const uid = window._authUid;
    if (!uid || !uid.startsWith('line:')) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    const lineUserId = uid.slice(5);
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      fs.setDoc(
        fs.doc(db, 'presence', lineUserId),
        { lastActiveAt: fs.serverTimestamp() },
        { merge: true }
      ).catch(function (e) {
        // Non-fatal — push fallback covers the recipient when presence
        // is stale or write failed.
        console.warn('[presence] write failed:', e?.message || e);
      });
    } catch (_) { /* noop */ }
  }
  // Initial write once claims are ready (so auth.uid is set).
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(_writePresence);
  }
  // Heartbeat: tightly-bounded interval so a single missed beat
  // doesn't immediately drop the recipient off the "active" window.
  const _hbInterval = setInterval(_writePresence, 60 * 1000);
  window.addEventListener('pagehide', function() { clearInterval(_hbInterval); }, { once: true });
  // Re-write immediately when the tab becomes visible again
  // (returning from background → resume push suppression promptly).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') _writePresence();
  });
})();
