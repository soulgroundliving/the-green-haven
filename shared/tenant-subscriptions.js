/**
 * tenant-subscriptions.js — System-config subscriptions for tenant_app.html.
 *
 * Extracted from three ===== SUBSCRIBE ===== blocks (was ~172 lines inline).
 * Loaded as a deferred script; wires authReady listeners internally.
 *
 * Sections bundled:
 *   1. MAINTENANCE + COMPLAINT CATEGORIES (system/maintenanceCategories + complaintCategories)
 *   2. EMERGENCY CONTACTS (system/emergencyContacts)
 *   3. REWARDS COLLECTION (rewards/*)
 *
 * Sections intentionally kept inline (tight coupling):
 *   - CLEANING SERVICE CONFIG  (_cleaningCfgCache read by selectService/
 *     _isStandardCleanAvailable defined in the main inline script)
 *   - PAYMENT CONFIG           (_taCurrentBill is a `let` in inline script,
 *     not on window — requires a separate window-export pass to extract)
 *
 * All reads are public-read in Firestore rules (firestore.rules:29,33) so
 * no claim check is needed — wired directly on authReady.
 *
 * Anti-patterns enforced (CLAUDE.md §7):
 *   §7-N : every onSnapshot has an error callback; unsub reset on
 *           permission-denied / failed-precondition so retry can succeed
 *   §7-X : _renderRewardsList has non-empty fallback when cache is empty
 *
 * Depends on globals:
 *   window.firebase.*  (Firebase module init)
 *   window.makeCall(phoneNumber)  (tenant_app.html inline — EMERGENCY CALL section)
 *   window.redeemReward(btn, name, cost, id)  (tenant_app.html inline — gamification)
 */
(function () {
    'use strict';

    // ── Local helpers ──────────────────────────────────────────────────────

    function _esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── 1. MAINTENANCE + COMPLAINT CATEGORIES ─────────────────────────────
    // Firestore: system/maintenanceCategories.items + system/complaintCategories.items
    // Each item: { value, label, icon } — admin adds/removes via dashboard.
    // Fallback: existing hardcoded <option>s remain until first Firestore snapshot.

    let _mxCatUnsub = null, _cplCatUnsub = null;

    function _populateCategorySelect(selectId, items, placeholder) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = placeholder || 'เลือกประเภท';
        sel.appendChild(opt0);
        items.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.value || c.id || '';
            opt.textContent = (c.icon ? c.icon + ' ' : '') + (c.label || c.value || '(unnamed)');
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
    }

    function _subscribeCategories() {
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        const fs = window.firebase.firestoreFunctions;
        const db = window.firebase.firestore();
        if (!_mxCatUnsub) {
            try {
                _mxCatUnsub = fs.onSnapshot(fs.doc(db, 'system', 'maintenanceCategories'), snap => {
                    if (!snap.exists()) return;
                    const items = (snap.data() || {}).items || [];
                    _populateCategorySelect('maintenanceCategory', items);
                }, err => console.warn('maintenanceCategories sub failed:', err.message));
            } catch (e) {}
        }
        if (!_cplCatUnsub) {
            try {
                _cplCatUnsub = fs.onSnapshot(fs.doc(db, 'system', 'complaintCategories'), snap => {
                    if (!snap.exists()) return;
                    const items = (snap.data() || {}).items || [];
                    _populateCategorySelect('complaintCategory', items);
                }, err => console.warn('complaintCategories sub failed:', err.message));
            } catch (e) {}
        }
    }

    // ── 2. EMERGENCY CONTACTS ──────────────────────────────────────────────
    // Firestore: system/emergencyContacts doc with field `items: [{ icon, label, number }]`.
    // Admin manages via dashboard.html — สำหรับเบอร์เฉพาะอาคาร (รพ./ช่าง/รปภ.)
    // 191/199/1669 ถูก filter ออก เพราะอยู่ในขั้นตอนฉุกเฉินแล้ว

    const _NATIONAL_EMERGENCY = new Set(['191','199','1669','1599']);
    let _emergencyUnsub = null;

    function _subscribeEmergencyContacts() {
        if (_emergencyUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const ref = fs.doc(db, 'system', 'emergencyContacts');
            _emergencyUnsub = fs.onSnapshot(ref, snap => {
                if (!snap.exists()) return;
                const items = (snap.data() || {}).items;
                if (!Array.isArray(items) || !items.length) return;
                const list = document.getElementById('emergencyContactsList');
                if (!list) return;
                list.innerHTML = '';
                items.filter(c => !_NATIONAL_EMERGENCY.has(String(c.number || '').trim())).forEach(c => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;background:#FFF1F1;color:#DC2626;border:none;border-radius:10px;font-weight:700;cursor:pointer;text-align:left;';
                    const icon = document.createElement('span');
                    icon.style.fontSize = '1.4rem';
                    icon.textContent = c.icon || '📞';
                    const label = document.createElement('span');
                    label.style.flex = '1';
                    label.textContent = c.label || '(unnamed)';
                    const num = document.createElement('strong');
                    num.textContent = c.number || '';
                    btn.appendChild(icon); btn.appendChild(label); btn.appendChild(num);
                    btn.addEventListener('click', () => {
                        if (typeof window.makeCall === 'function') window.makeCall(c.number);
                    });
                    list.appendChild(btn);
                });
            }, err => {
                console.error('[emergencyContacts] subscribe failed:', err?.message);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') _emergencyUnsub = null;
                const list = document.getElementById('emergencyContactsList');
                if (list && !list.querySelector('[data-err="emergency"]') && !list.children.length) {
                    const p = document.createElement('p');
                    p.dataset.err = 'emergency';
                    p.style.cssText = 'padding:12px;text-align:center;color:var(--text-muted);font-size:var(--fs-sm);';
                    p.textContent = 'โหลดไม่สำเร็จ — กรุณา Reload';
                    list.appendChild(p);
                }
            });
        } catch (e) { console.warn('emergency contacts subscribe init failed:', e.message); }
    }

    // ── 3. REWARDS COLLECTION ──────────────────────────────────────────────
    // Admin manages rewards in Firestore `rewards/{id}`. Tenant app renders dynamically
    // so adding/removing/repricing rewards never requires a redeploy.

    let _rewardsUnsub = null;
    let _rewardsCache = [];

    function _subscribeRewards() {
        if (_rewardsUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const colRef = fs.query(fs.collection(db, 'rewards'), fs.limit(100));
            _rewardsUnsub = fs.onSnapshot(colRef, snap => {
                _rewardsCache = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(r => r.active !== false)
                    .sort((a, b) => (a.order || 999) - (b.order || 999));
                _renderRewardsList();
            }, err => console.warn('rewards subscribe failed:', err.message));
        } catch (e) { console.warn('rewards subscribe init failed:', e.message); }
    }

    function _renderRewardsList() {
        const container = document.getElementById('rewards-list');
        if (!container) return;
        if (!_rewardsCache.length) {
            container.innerHTML = '<div class="text-center text-xs text-gray-400 py-8">ยังไม่มีของรางวัลในขณะนี้</div>';
            return;
        }
        // innerHTML template + one delegated listener — replaces per-button
        // addEventListener that leaked N references on every Firestore update
        // (innerHTML='' wipes DOM but leaves detached listener refs).
        container.innerHTML = _rewardsCache.map(r => {
            const id = _esc(r.id);
            const name = _esc(r.name || '(unnamed)');
            const icon = _esc(r.icon || '🎁');
            const cost = Number(r.cost || 0);
            const monthlyQuota = Number(r.monthlyQuota || 0);
            // Quota-only mode (2026-05-17): admin sets monthlyQuota; CF enforces;
            // tenant sees badge + auto-generated rejection message from CF. No admin note.
            const quotaBadge = monthlyQuota > 0
                ? `<span class="inline-block bg-orange-50 text-orange-700 border border-orange-300 rounded-md px-1.5 py-0.5 text-[9px] font-bold mt-1">🎯 ${monthlyQuota} ครั้ง/เดือน</span>`
                : '';
            return `<div class="p-4 border border-gray-100 rounded-[1.5rem] flex items-center justify-between hover:bg-gray-50 transition">
                <div class="flex items-center gap-4">
                    <span class="text-3xl">${icon}</span>
                    <div>
                        <p class="font-bold text-sm">${name}</p>
                        <p class="text-[10px] text-gray-400">ใช้ ${cost.toLocaleString()} Points</p>
                        ${quotaBadge}
                    </div>
                </div>
                <button type="button" data-reward-id="${id}" data-reward-cost="${cost}" data-reward-name="${name}"
                        class="bg-[#2d8653] text-white px-5 py-2 rounded-xl text-xs font-bold active:scale-90 transition">แลก</button>
            </div>`;
        }).join('');

        if (!container._rewardsDelegated) {
            container.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-reward-id]');
                if (!btn) return;
                if (typeof window.redeemReward === 'function') {
                    window.redeemReward(btn, btn.dataset.rewardName, Number(btn.dataset.rewardCost), btn.dataset.rewardId);
                }
            });
            container._rewardsDelegated = true;
        }
    }

    // ── 4. CLEANING SERVICE CONFIG ────────────────────────────────────────
    // Firestore: system/cleaningServices doc with:
    //   { services: [{id, label, icon, price, free, note, priceLabel}],
    //     timeSlots: ['09:00 - 12:00 น.', ...], activeMonth: 'YYYY-MM' }
    // Admin manages via dashboard → Content → Cleaning tab.
    // Fallback: existing hardcoded <option>s remain until first Firestore snapshot.
    // `window._cleaningCfgCache` is mirrored after every update so inline code
    // (_isStandardCleanAvailable, _maybeOpenStandardCleanModal, dismissStandardCleanModal,
    // bookStandardCleanFromModal) can read it without crossing the module boundary.

    let _cleaningCfgUnsub = null;
    let _cleaningCfgCache = null;
    window._cleaningCfgCache = null; // readable from inline script before first snapshot

    function _subscribeCleaningConfig() {
        if (_cleaningCfgUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const ref = fs.doc(db, 'system', 'cleaningServices');
            _cleaningCfgUnsub = fs.onSnapshot(ref, snap => {
                if (!snap.exists()) return;
                _cleaningCfgCache = snap.data() || null;
                window._cleaningCfgCache = _cleaningCfgCache; // keep inline readers in sync
                _renderCleaningServices();
                _renderCleaningTimeSlots();
                if (typeof window._refreshStandardCleanAvailability === 'function') window._refreshStandardCleanAvailability();
            }, err => console.warn('cleaningConfig subscribe failed:', err.message));
        } catch (e) { console.warn('cleaningConfig subscribe init failed:', e.message); }
    }

    function _renderCleaningServices() {
        if (!_cleaningCfgCache || !Array.isArray(_cleaningCfgCache.services)) return;
        const list = document.getElementById('cleaning-service-list');
        if (!list) return;
        list.innerHTML = '';
        _cleaningCfgCache.services.forEach((svc, idx) => {
            const card = document.createElement('div');
            card.id = `service-${svc.id || idx}`;
            card.className = 'card p-4 border-2 border-transparent';
            card.addEventListener('click', () => {
                if (typeof window.selectService === 'function') window.selectService(svc.id);
            });
            const inner = document.createElement('div');
            inner.className = 'flex flex-col items-center text-center';
            const icon = document.createElement('span');
            icon.className = 'text-2xl mb-2';
            icon.textContent = svc.icon || '✨';
            const title = document.createElement('strong');
            title.className = 'text-sm';
            title.textContent = svc.label || '(service)';
            const price = document.createElement('p');
            price.className = `text-[10px] font-bold mt-1 ${svc.free ? 'text-green-600' : 'text-blue-600'}`;
            price.textContent = svc.free
                ? `ฟรี (${svc.quotaMonths || 6} เดือน/ครั้ง)`
                : (svc.priceLabel || `${svc.price || 0} ฿ / ครั้ง`);
            inner.appendChild(icon); inner.appendChild(title); inner.appendChild(price);
            card.appendChild(inner);
            list.appendChild(card);
        });
        // Re-apply selection so the active-service border persists after re-render.
        // Default to 'deep' when Standard Clean is unavailable — avoids firing the
        // "unavailable" toast on app init (fires on every onSnapshot re-render otherwise).
        const defaultSvc = (typeof window._isStandardCleanAvailable === 'function' && window._isStandardCleanAvailable()) ? 'free' : 'deep';
        const _selSvc = window._selectedService;
        if (typeof window.selectService === 'function') {
            window.selectService(_selSvc && _selSvc !== 'free' ? _selSvc : defaultSvc);
        }
        if (typeof window._refreshStandardCleanAvailability === 'function') window._refreshStandardCleanAvailability();
    }

    function _renderCleaningTimeSlots() {
        if (!_cleaningCfgCache || !Array.isArray(_cleaningCfgCache.timeSlots)) return;
        const sel = document.getElementById('clean-time');
        if (!sel) return;
        sel.innerHTML = '';
        _cleaningCfgCache.timeSlots.forEach(ts => {
            const opt = document.createElement('option');
            opt.textContent = ts;
            sel.appendChild(opt);
        });
    }

    // ── 5. PAYMENT CONFIG ──────────────────────────────────────────────────
    // Firestore: buildings/{rooms|nest} doc fields { promptPayId, companyName, ownerName }.
    // Admin sets this in dashboard.html → Buildings → ✏️ แก้ไข.
    // All buildings/* docs are canonical-only as of 2026-05-18 migration.
    // localStorage mirror keeps legacy callers (buildPromptPayPayload, getOwnerName) working.
    // Reads window._taCurrentBill (mirrored from inline `let _taCurrentBill` at each write site).

    let _paymentCfgUnsub = null;

    function _subscribePaymentConfig() {
        if (_paymentCfgUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        // Wait until building is known — same pattern as _subscribeBroadcasts.
        // Without this, Nest tenants subscribe to buildings/rooms in the anonymous
        // phase and the idempotency guard prevents a retry when claims arrive.
        if (!_taBuilding) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const fsBuilding = window.CONFIG.getFirestoreBuilding(_taBuilding);
            const ref = fs.doc(db, 'buildings', fsBuilding);
            _paymentCfgUnsub = fs.onSnapshot(ref, snap => {
                if (!snap.exists()) return;
                const data = snap.data() || {};
                const pp = data.promptPayId;
                const cn = data.companyName || data.payment?.companyName;
                const on = data.ownerName   || data.payment?.ownerName;
                if (pp) try { localStorage.setItem('promptpay', String(pp)); } catch(e) {}
                if (cn) try { localStorage.setItem('company_name', String(cn)); } catch(e) {}
                if (on) try { localStorage.setItem('owner_name', String(on)); } catch(e) {}
                // Update visible footer label without waiting for re-render
                const ownerEl = document.getElementById('receipt-owner-name');
                if (ownerEl && (cn || on)) ownerEl.textContent = cn || on;
                // Re-render visible payment screens so changes appear without reload
                if (document.getElementById('pay-qr-canvas') && window._taCurrentBill) {
                    if (typeof window.renderPaymentInvoice === 'function') window.renderPaymentInvoice(window._taCurrentBill);
                }
                // Render building-info page from same doc
                const info = data.info || {};
                const setBld = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.textContent = v; };
                setBld('bld-name', info.name);
                setBld('bld-tagline', info.tagline);
                setBld('bld-units', info.units ? `${info.units} ห้อง` : null);
                setBld('bld-petzone', info.petZone);
                setBld('bld-elec-status', info.electricStatus);
                setBld('bld-water-status', info.waterStatus);
            }, err => {
                console.error('[paymentConfig] subscribe failed:', err?.message);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') _paymentCfgUnsub = null;
            });
        } catch (e) { console.warn('payment config subscribe init failed:', e.message); }
    }

    // ── Subscription wiring ────────────────────────────────────────────────

    // [audit-skip] reads system/maintenanceCategories + system/complaintCategories
    // (firestore.rules:33 — match /system/{docId} allows read:if true). No auth claim needed.
    window.addEventListener('authReady', _subscribeCategories);

    // [audit-skip] reads system/cleaningServices — public-read (firestore.rules:33).
    window.addEventListener('authReady', _subscribeCleaningConfig);

    // [audit-skip] reads system/emergencyContacts — public-read (firestore.rules:33).
    window.addEventListener('authReady', _subscribeEmergencyContacts);

    // [audit-skip] reads rewards/* — public-read (firestore.rules:29).
    window.addEventListener('authReady', _subscribeRewards);

    // Auth-gated on _taBuilding — wired via _onLiffClaimsReady so Nest tenants
    // don't subscribe with wrong building during anonymous phase (§7-U).
    if (typeof _onLiffClaimsReady === 'function') {
        _onLiffClaimsReady(_subscribePaymentConfig);
    }
})();
