// ===== CLEANING SERVICE BOOKING (selectService → submitCleaning → deep-clean payment → history) =====
// Extracted from tenant_app.html. Exports:
//   window.selectService                  — service type selector (standard / deep)
//   window._isStandardCleanAvailable     — availability check (used by tenant-standard-clean-modal.js)
//   window._refreshStandardCleanAvailability — called from tenant-subscriptions.js on config change
//   window.submitCleaning                 — booking form submit (data-action)
//   window._saveCleaningBooking           — shared by tenant-standard-clean-modal.js
//   window.closeCleaningPaymentModal      — data-action
//   window.handleCleaningSlipUpload       — slip upload handler (data-action + onchange)
//   window.confirmCleaningPayment         — payment confirm (data-action)
//   window._renderCleaningHistory         — called by tenant-standard-clean-modal.js + RTDB sub
//
// Shared state (window.* resolved at call time):
//   window._selectedService — let+mirror in inline script
//   window._cleaningCfgCache — from tenant-subscriptions.js
//   window._taBuilding, window._taRoom — var globals from tenant-liff-auth.js
//   window._esc, window.toast, window.goBackToService, window.buildPromptPayPayload
//   window._tenantRateLimit, window._imageToJpegBase64 — function decls in inline script
(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────────────────────
    // _selectedService shared via window._selectedService (let+mirror in inline script).
    let _pendingCleaningRecord = null;
    let _cleaningSlipBase64 = null;

    // ── Service selector ─────────────────────────────────────────────────────
    function selectService(type) {
        // Standard Clean only selectable when admin has opened a campaign for current month.
        // Deep Cleaning is always selectable (paid on-demand).
        if (type === 'free' && !_isStandardCleanAvailable()) {
            toast('Standard Clean จะเปิดรอบให้จองเฉพาะเดือนที่มีรอบบริการเท่านั้น 🙏', 'info');
            return;
        }
        window._selectedService = type;
        const list = document.getElementById('cleaning-service-list');
        if (list) {
            list.querySelectorAll('.card').forEach(c => {
                const isActive = c.id === 'service-' + type;
                c.classList.toggle('active-service', isActive);
            });
        }
    }

    function _isStandardCleanAvailable() {
        if (_taBuilding !== 'nest') return false;
        const activeMonth = String(window._cleaningCfgCache?.activeMonth || '').trim();
        if (!activeMonth) return false;
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        return activeMonth === currentMonth;
    }

    function _refreshStandardCleanAvailability() {
        const freeCard = document.getElementById('service-free');
        if (!freeCard) return;
        const available = _isStandardCleanAvailable();
        freeCard.classList.toggle('svc-disabled', !available);
        freeCard.querySelector('.svc-disabled-badge')?.remove();
        if (!available) {
            const badge = document.createElement('span');
            badge.className = 'svc-disabled-badge';
            badge.textContent = '🚧 ยังไม่เปิด';
            freeCard.appendChild(badge);
            if (window._selectedService === 'free') selectService('deep');
        }
    }

    // ── Booking submission ───────────────────────────────────────────────────
    async function submitCleaning() {
        const date = document.getElementById('clean-date')?.value;
        const time = document.getElementById('clean-time')?.value;
        const note = document.getElementById('clean-note')?.value.trim() || '';

        if (!document.getElementById('clean-terms-agree')?.checked) {
            toast('กรุณายอมรับข้อตกลงก่อนจองบริการ', 'warning');
            return;
        }
        if (!date) {
            toast('กรุณาเลือกวันที่ต้องการนะครับ', 'warning');
            document.getElementById('clean-date')?.focus();
            return;
        }

        const record = {
            id: 'CLN-' + Date.now().toString().slice(-5),
            type: window._selectedService === 'deep' ? 'Deep Cleaning' : 'Standard Clean',
            service: window._selectedService === 'deep' ? 'deep-clean' : 'standard-clean',
            date, time, note,
            status: window._selectedService === 'deep' ? 'pending_payment' : 'รอดำเนินการ',
            createdAt: new Date().toISOString()
        };

        if (window._selectedService === 'deep') {
            _pendingCleaningRecord = record;
            _openCleaningPaymentModal(record);
            return;
        }

        // Standard Clean — save directly (no payment required)
        try {
            await _saveCleaningBooking(record);
            toast('จองบริการทำความสะอาดเรียบร้อยแล้วครับ 🧹', 'success');
            _renderCleaningHistory();
        } catch(e) {
            toast('บันทึกในเครื่องแล้ว แต่ส่งข้อมูลไม่สำเร็จ — กรุณาตรวจอินเทอร์เน็ต', 'warning');
            _renderCleaningHistory();
        }
    }

    // ── Booking persistence ──────────────────────────────────────────────────
    async function _saveCleaningBooking(record) {
        try {
            const existing = JSON.parse(localStorage.getItem('tenant_cleaning_tickets') || '[]');
            existing.unshift(record);
            localStorage.setItem('tenant_cleaning_tickets', JSON.stringify(existing));
        } catch(e) { console.warn('localStorage cleaning_tickets save failed:', e); }
        const hkPayload = {
            id: record.id,
            room: String(_taRoom),
            building: _taBuilding,
            service: record.service,
            description: record.note || '',
            date: record.date,
            time: record.time,
            submittedAt: record.date || new Date().toISOString().split('T')[0],
            status: record.status === 'pending_payment' ? 'pending_payment' : 'pending',
            priority: 'normal',
            createdAt: record.createdAt,
            paymentSlip: record.paymentSlip || null,
            paymentVerified: !!record.paymentVerified,
            paymentTransRef: record.paymentTransRef || null,
            paymentAmount: record.service === 'deep-clean' ? 500 : 0
        };
        try {
            const hk = JSON.parse(localStorage.getItem('housekeeping_data') || '[]');
            hk.unshift(hkPayload);
            localStorage.setItem('housekeeping_data', JSON.stringify(hk));
        } catch(e) { console.warn('localStorage housekeeping_data save failed:', e); }
        if (!window.firebaseReady || !window.firebaseRef || !window.firebaseSet || !window.firebaseDatabase) {
            throw new Error('firebase_not_ready');
        }
        const path = `housekeeping/${hkPayload.building}/${hkPayload.room}/${hkPayload.id}`;
        await window.firebaseSet(window.firebaseRef(window.firebaseDatabase, path), hkPayload);
    }

    // ── Deep Cleaning payment modal ──────────────────────────────────────────
    async function _openCleaningPaymentModal(record) {
        const modal = document.getElementById('cleaning-payment-modal');
        if (!modal) return;
        document.getElementById('cpm-date').textContent = record.date || '—';
        document.getElementById('cpm-time').textContent = record.time || '—';
        const noteRow = document.getElementById('cpm-note-row');
        const noteEl = document.getElementById('cpm-note');
        if (record.note) { noteRow.style.display = 'flex'; noteEl.textContent = record.note; }
        else noteRow.style.display = 'none';
        const phone = localStorage.getItem('promptpay') || '';
        document.getElementById('cpm-promptpay').textContent = phone || '—';
        const qrBox = document.getElementById('cpm-qr-canvas');
        qrBox.innerHTML = '';
        if (phone) {
            try {
                await window.ensureQRCode();
                new QRCode(qrBox, { text: buildPromptPayPayload(phone, 500), width:170, height:170, correctLevel: QRCode.CorrectLevel.M });
            } catch(e) { qrBox.innerHTML = '<p class="ta-lighter-sm">สร้าง QR ไม่ได้</p>'; }
        } else qrBox.innerHTML = '<p class="ta-lighter-sm">ไม่มีข้อมูล PromptPay</p>';
        // Reset slip state
        _cleaningSlipBase64 = null;
        document.getElementById('cpm-slip-preview').style.display = 'none';
        document.getElementById('cpm-slip-drop').style.display = '';
        const confirmBtn = document.getElementById('cpm-confirm-btn');
        confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5';
        const statusEl = document.getElementById('cpm-status');
        statusEl.style.display = 'none'; statusEl.textContent = '';
        const slipInput = document.getElementById('cpm-slip-input');
        if (slipInput) slipInput.value = '';
        modal.style.display = 'flex';
    }

    function closeCleaningPaymentModal() {
        const modal = document.getElementById('cleaning-payment-modal');
        if (modal) modal.style.display = 'none';
        _pendingCleaningRecord = null;
        _cleaningSlipBase64 = null;
    }

    async function handleCleaningSlipUpload(input) {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 10*1024*1024) { alert('ไฟล์ต้องไม่เกิน 10MB'); input.value=''; return; }
        if (!file.type.startsWith('image/')) { alert('กรุณาเลือกไฟล์รูปภาพ'); input.value=''; return; }
        const needsConvert = !['image/jpeg','image/png','image/webp'].includes(file.type);
        try {
            if (needsConvert) _cleaningSlipBase64 = await _imageToJpegBase64(file);
            else _cleaningSlipBase64 = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = e => resolve(e.target.result);
                r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
                r.readAsDataURL(file);
            });
        } catch(e) { toast(e.message || 'อ่านไฟล์ไม่สำเร็จ', 'error'); input.value=''; return; }
        const img = document.getElementById('cpm-slip-img');
        const wrap = document.getElementById('cpm-slip-preview');
        const drop = document.getElementById('cpm-slip-drop');
        if (img) img.src = _cleaningSlipBase64;
        if (wrap) wrap.style.display = '';
        if (drop) drop.style.display = 'none';
        const btn = document.getElementById('cpm-confirm-btn');
        btn.disabled = false; btn.style.opacity = '1';
    }

    function _setCpmStatus(kind, msg) {
        const el = document.getElementById('cpm-status');
        if (!el) return;
        el.style.display = '';
        const palette = {
            loading: { bg:'#fff7ed', fg:'#b45309' },
            success: { bg:'#ecfdf5', fg:'#16a34a' },
            error:   { bg:'#fef2f2', fg:'#dc2626' },
            warning: { bg:'#fffbeb', fg:'#d97706' },
            info:    { bg:'#eff6ff', fg:'#2563eb' }
        }[kind] || { bg:'#f3f4f6', fg:'#374151' };
        el.style.background = palette.bg;
        el.style.color = palette.fg;
        el.textContent = msg;
    }

    async function confirmCleaningPayment() {
        if (!_cleaningSlipBase64 || !_pendingCleaningRecord) return;
        const btn = document.getElementById('cpm-confirm-btn');
        if (typeof _tenantRateLimit === 'function' && !_tenantRateLimit()) {
            _setCpmStatus('error', 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่');
            return;
        }
        _setCpmStatus('loading', '⏳ กำลังตรวจสอบสลิป...');
        btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'กำลังตรวจสอบ...';
        let result;
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), 12000);
            let resp;
            try {
                resp = await fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/verifySlip', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ file: _cleaningSlipBase64, expectedAmount: 500, building: _taBuilding, room: _taRoom, context: 'cleaning' }),
                    signal: ctrl.signal
                });
            } finally { clearTimeout(to); }
            result = await resp.json();
        } catch(e) {
            const isTimeout = e?.name === 'AbortError';
            console.warn('verifySlip (cleaning) network error:', e.message);
            _setCpmStatus('error', isTimeout ? 'เชื่อมต่อนานเกินไป กรุณาลองใหม่' : 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
            btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'ยืนยันชำระเงิน';
            return;
        }

        // Success → save booking with verified payment
        if (result.success || result.verified) {
            const record = _pendingCleaningRecord;
            record.paymentSlip = _cleaningSlipBase64;
            record.paymentVerified = true;
            record.paymentTransRef = result.transRef || result.transactionId || null;
            record.status = 'รอดำเนินการ';
            try {
                await _saveCleaningBooking(record);
                _renderCleaningHistory();
                _setCpmStatus('success', '✅ ชำระเงินยืนยันแล้ว — จองสำเร็จ');
                toast('จองสำเร็จ ✅ ชำระเงินยืนยันแล้ว', 'success');
                window.GhHaptic?.success();
                setTimeout(() => { closeCleaningPaymentModal(); goBackToService(); }, 1500);
            } catch (err) {
                console.error('deep-clean booking sync failed AFTER payment verified:', err);
                _renderCleaningHistory();
                _setCpmStatus('error', '⚠️ ชำระแล้ว แต่ส่งคำขอไม่สำเร็จ กรุณาแจ้งแอดมิน (transRef: ' + (record.paymentTransRef || '—') + ')');
                toast('⚠️ ชำระแล้ว แต่ส่งคำขอไม่สำเร็จ — แจ้งแอดมินด้วยเลขอ้างอิง', 'error');
                window.GhHaptic?.error();
                btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'ลองส่งใหม่';
            }
            return;
        }

        // SCB delay (bank data not yet available) → countdown + auto-enable retry
        if (result.retryable && result.code === 'scb_delay') {
            const wait = result.retryAfterSec || 120;
            _setCpmStatus('warning', result.message || `ธนาคารยังไม่ปล่อยข้อมูล กรุณารอ ${wait} วินาทีแล้วลองใหม่`);
            let remain = wait;
            btn.textContent = `⏳ รออีก ${remain} วินาที`;
            const tick = setInterval(() => {
                remain--;
                btn.textContent = `⏳ รออีก ${remain} วินาที`;
                if (remain <= 0) {
                    clearInterval(tick);
                    btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '🔄 ลองตรวจสอบอีกครั้ง';
                    _setCpmStatus('info', 'พร้อมลองใหม่ กดปุ่มด้านล่างได้เลย');
                }
            }, 1000);
            return;
        }

        // Hard failure → show error, allow retry with a new slip, do NOT save
        _setCpmStatus('error', result.message || result.error || 'ตรวจสอบไม่ผ่าน กรุณาอัปโหลดสลิปใหม่');
        btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'ยืนยันชำระเงิน';
    }

    // ── Cleaning history ─────────────────────────────────────────────────────
    function _renderCleaningHistory() {
        const container = document.getElementById('cleaning-records');
        if (!container) return;
        let tickets = [];
        try { tickets = JSON.parse(localStorage.getItem('tenant_cleaning_tickets') || '[]'); } catch(e) {}
        if (!tickets.length) {
            container.innerHTML = window.GhEmptyState
                ? window.GhEmptyState.html('messages', { title:'ยังไม่มีประวัติการจอง', text:'เมื่อจองบริการแล้ว ประวัติจะแสดงที่นี่' })
                : '<p style="text-align:center;color:#9ca3af;font-size:var(--fs-sm);padding:20px;">ยังไม่มีประวัติการจอง</p>';
            return;
        }
        const statusColor = { 'รอดำเนินการ':'#f59e0b', 'pending':'#f59e0b', 'inprogress':'#3b82f6', 'กำลังทำความสะอาด':'#3b82f6', 'done':'#22c55e', 'สำเร็จแล้ว':'#22c55e', 'รอตรวจสอบสลิป':'#6366f1', 'pending_payment':'#dc2626' };
        const statusLabel = { pending:'⏳ รอดำเนินการ', inprogress:'🧹 กำลังทำความสะอาด', done:'✅ สำเร็จแล้ว', pending_payment:'💳 รอชำระเงิน' };
        container.innerHTML = tickets.slice(0, 20).map(t => {
            const label = statusLabel[t.status] || t.status || 'รอดำเนินการ';
            const color = statusColor[t.status] || '#6b7280';
            const dateStr = t.date ? new Date(t.date).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' }) : '';
            return `<div class="bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100 flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">${_esc(dateStr)}${t.time ? ' | ' + _esc(t.time) : ''}</p>
                    <strong class="text-sm">${_esc(t.type || t.service || 'Standard Clean')}</strong>
                    ${t.note ? `<p class="text-xs text-gray-500 mt-1">${_esc(t.note)}</p>` : ''}
                </div>
                <span style="font-size:10px;background:${color}22;color:${color};padding:4px 12px;border-radius:20px;font-weight:700;white-space:nowrap;">${_esc(label)}</span>
            </div>`;
        }).join('');
    }

    // ── RTDB real-time subscription ──────────────────────────────────────────
    // Admin writes cleaning ticket status to housekeeping/{bld}/{room},
    // tenant sees updates live (same pattern as maintenance).
    // §7-U: claim-first guard + error callback.
    let _cleaningRtdbOff = null;
    async function _subscribeCleaningFromRTDB() {
        if (_cleaningRtdbOff) return;
        if (!window.firebaseReady || !window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) return;
        if (!_taBuilding || !_taRoom) return;
        // Phase 4C: RTDB rule requires {room, building} claims on token (or admin).
        // Defer quietly if claims not yet set — liffLinked event handler retries after linkAuthUid.
        try {
            const user = window.firebaseAuth?.currentUser;
            if (!user) return;
            const tr = await user.getIdTokenResult();
            if (!tr.claims.admin && !(tr.claims.room && tr.claims.building)) return;
        } catch (_) { return; }
        try {
            const path = `housekeeping/${_taBuilding}/${_taRoom}`;
            const ref = window.firebaseRef(window.firebaseDatabase, path);
            _cleaningRtdbOff = window.firebaseOnValue(ref, snap => {
                if (!snap.exists()) return;
                const rtdbMap = snap.val() || {};
                let local = [];
                try { local = JSON.parse(localStorage.getItem('tenant_cleaning_tickets') || '[]'); } catch(e) {}
                const byId = new Map(local.map(t => [t.id, t]));
                Object.values(rtdbMap).forEach(rt => {
                    if (!rt || !rt.id) return;
                    const existing = byId.get(rt.id);
                    if (existing) {
                        byId.set(rt.id, { ...existing, status: rt.status || existing.status, updatedAt: rt.updatedAt || existing.updatedAt });
                    } else {
                        byId.set(rt.id, { id: rt.id, type: rt.service === 'deep-clean' ? 'Deep Cleaning' : 'Standard Clean',
                            date: rt.date, time: rt.time, note: rt.description || '',
                            status: rt.status || 'pending', createdAt: rt.createdAt });
                    }
                });
                const merged = Array.from(byId.values()).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
                try { localStorage.setItem('tenant_cleaning_tickets', JSON.stringify(merged)); } catch(e) {}
                _renderCleaningHistory();
            }, err => console.warn('cleaning RTDB subscribe failed:', err.message));
        } catch (e) { console.warn('cleaning RTDB subscribe init failed:', e.message); }
    }
    window._onLiffClaimsReady(_subscribeCleaningFromRTDB);

    window.selectService                  = selectService;
    window._isStandardCleanAvailable     = _isStandardCleanAvailable;
    window._refreshStandardCleanAvailability = _refreshStandardCleanAvailability;
    window.submitCleaning                 = submitCleaning;
    window._saveCleaningBooking           = _saveCleaningBooking;
    window.closeCleaningPaymentModal      = closeCleaningPaymentModal;
    window.handleCleaningSlipUpload       = handleCleaningSlipUpload;
    window.confirmCleaningPayment         = confirmCleaningPayment;
    window._renderCleaningHistory         = _renderCleaningHistory;
})();
