// ===== STANDARD CLEAN MONTHLY OPT-IN MODAL =====
// Extracted from tenant_app.html. Exports:
//   window._maybeOpenStandardCleanModal — called from showPage('cleaning')
//   window.dismissStandardCleanModal    — data-action dispatcher (_ta = window)
//   window.bookStandardCleanFromModal   — data-action dispatcher
// Dependencies (resolved via global scope):
//   window._cleaningCfgCache, _taBuilding, _taRoom, toast,
//   _saveCleaningBooking, _renderCleaningHistory (still inline)
(function () {
    'use strict';

    // Admin sets system/cleaningServices.activeMonth = 'YYYY-MM' to open a campaign.
    // All Nest tenants who haven't already booked or dismissed this month see the modal.
    // Rooms building tenants are skipped (Standard Clean is Nest-only facility service).
    function _maybeOpenStandardCleanModal() {
        if (!window._cleaningCfgCache) return;
        if (_taBuilding !== 'nest') return; // Nest-only
        const activeMonth = String(window._cleaningCfgCache.activeMonth || '').trim();
        if (!activeMonth) return;
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        if (activeMonth !== currentMonth) return;
        // Per-tenant per-month dismissal flag
        const seenKey = `cleaning_campaign_seen_${activeMonth}_${_taRoom}`;
        if (localStorage.getItem(seenKey)) return;
        // Already has a booking for this month? skip
        let tickets = [];
        try { tickets = JSON.parse(localStorage.getItem('tenant_cleaning_tickets') || '[]'); } catch(e) {}
        const [ay, am] = activeMonth.split('-').map(Number);
        const hasThisMonth = tickets.some(t => {
            if (!t.date) return false;
            const d = new Date(t.date);
            return d.getFullYear() === ay && (d.getMonth()+1) === am && t.service === 'standard-clean';
        });
        if (hasThisMonth) return;
        _openStandardCleanModal(activeMonth);
    }

    function _openStandardCleanModal(activeMonth) {
        const modal = document.getElementById('standard-clean-modal');
        if (!modal) return;
        // Set date input min/max to the active month range
        const [ay, am] = activeMonth.split('-').map(Number);
        const first = `${ay}-${String(am).padStart(2,'0')}-01`;
        const lastDay = new Date(ay, am, 0).getDate();
        const last = `${ay}-${String(am).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        const dateInput = document.getElementById('scm-date');
        if (dateInput) {
            dateInput.min = first;
            dateInput.max = last;
            // Default to today if in range, else the 1st of active month
            const todayStr = new Date().toISOString().split('T')[0];
            dateInput.value = (todayStr >= first && todayStr <= last) ? todayStr : first;
        }
        // Populate time slots from config (fallback to defaults)
        const sel = document.getElementById('scm-time');
        if (sel && window._cleaningCfgCache && Array.isArray(window._cleaningCfgCache.timeSlots) && window._cleaningCfgCache.timeSlots.length) {
            sel.innerHTML = '';
            window._cleaningCfgCache.timeSlots.forEach(ts => {
                const opt = document.createElement('option');
                opt.textContent = ts;
                sel.appendChild(opt);
            });
        }
        const noteEl = document.getElementById('scm-note');
        if (noteEl) noteEl.value = '';
        modal.style.display = 'flex';
    }

    function dismissStandardCleanModal() {
        const modal = document.getElementById('standard-clean-modal');
        if (modal) modal.style.display = 'none';
        const activeMonth = String(window._cleaningCfgCache?.activeMonth || '').trim();
        if (activeMonth && _taRoom) {
            try { localStorage.setItem(`cleaning_campaign_seen_${activeMonth}_${_taRoom}`, '1'); } catch(e) {}
        }
    }

    async function bookStandardCleanFromModal() {
        const date = document.getElementById('scm-date')?.value;
        const time = document.getElementById('scm-time')?.value;
        const note = document.getElementById('scm-note')?.value.trim() || '';
        if (!date) { toast('กรุณาเลือกวันที่ต้องการ', 'warning'); return; }
        const record = {
            id: 'CLN-' + Date.now().toString().slice(-5),
            type: 'Standard Clean',
            service: 'standard-clean',
            date, time, note,
            status: 'รอดำเนินการ',
            createdAt: new Date().toISOString(),
            campaign: String(window._cleaningCfgCache?.activeMonth || '')
        };
        try {
            await _saveCleaningBooking(record);
            _renderCleaningHistory();
            dismissStandardCleanModal();
            toast('จองสำเร็จ 🧹 ทีมงานจะติดต่อยืนยันเวลา', 'success');
        } catch (err) {
            console.error('standard-clean modal booking sync failed:', err);
            _renderCleaningHistory();
            toast('⚠️ บันทึกแล้วในเครื่อง แต่ส่งให้แม่บ้านไม่สำเร็จ — กรุณาตรวจอินเทอร์เน็ตและลองใหม่', 'error');
        }
    }

    window._maybeOpenStandardCleanModal = _maybeOpenStandardCleanModal;
    window.dismissStandardCleanModal    = dismissStandardCleanModal;
    window.bookStandardCleanFromModal   = bookStandardCleanFromModal;
})();
