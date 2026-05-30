/**
 * tenant-data.js — Data integration core for tenant_app.html.
 *
 * Extracted from tenant_app.html inline script (~265 lines removed):
 *   - _hydrateTenantFromLocalStorage   (SWR sync from localStorage)
 *   - _rerenderTenantViews             (visible-first re-render scheduler)
 *   - _dedupBills                      (dedup via BillStore.dedupSynthetic)
 *   - _applyTenantBoundary             (hide prev-tenant bills/meter rows)
 *   - loadTenantAppData                (orchestrates hydrate + subscribe + Firestore refresh)
 *   - _subscribeBillsRealtime          (RTDB bill subscription with claim-backoff retry)
 *
 * All _ta* globals (_taBills, _taPayments, _taLease, _taTenant, _taBuilding, _taRoom)
 * are declared as `var` in the inline script / tenant-liff-auth.js — they live on
 * `window` and are readable/writable from this strict-mode IIFE via scope-chain lookup.
 *
 * Anti-patterns enforced (CLAUDE.md §7):
 *   §7-U: _subscribeBillsRealtime has claim-presence guard before setting _billsUnsub.
 *   §7-N: TenantFirebaseSync.subscribeBills error callback resets _billsUnsub for retry.
 *
 * Depends on globals:
 *   _taBills, _taPayments, _taLease, _taTenant, _taBuilding, _taRoom
 *   window.BillStore, window.YearUtils, window.TenantFirebaseSync
 *   window.LeaseAgreementManager, window.TenantConfigManager, window.RoomConfigManager
 *   window.firebaseAuth
 *   window.renderBillsList, window.updateNavBadges, window._renderUsageChart (render modules)
 *   window.renderHomePage, window.renderProfilePage, window.renderContractPage
 *   window._loadMeterHistoryFromFirestore  (tenant-meter.js)
 *   _onLiffClaimsReady                     (inline tenant_app.html)
 */
(function () {
    'use strict';

    // ── CE year helper ─────────────────────────────────────────────────────
    // Normalises 2-digit BE / 4-digit BE / 4-digit CE to CE so year sorts
    // are monotonic across all three formats stored in the bill cache.

    function _ce(y) { return window.YearUtils?.toCE?.(y) || Number(y) || 0; }

    // ── 1. SWR hydration from localStorage ────────────────────────────────
    // Sync part of the SWR pattern — instant first paint from cache before
    // any Firestore round-trip starts.

    function _hydrateTenantFromLocalStorage() {
        if (!_taLease && typeof LeaseAgreementManager !== 'undefined') {
            try { _taLease = LeaseAgreementManager.getActiveLease(_taBuilding, _taRoom); } catch(e) {}
        }
        if (!_taTenant && typeof TenantConfigManager !== 'undefined') {
            try { _taTenant = TenantConfigManager.getTenant(_taBuilding, _taRoom); } catch(e) {}
        }
        if (!_taTenant) {
            try { _taTenant = JSON.parse(localStorage.getItem('tenant_data') || 'null'); } catch(e) {}
        }
        if (!_taBills.length) {
            [2567,2568,2569,2570].forEach(y => {
                try {
                    const raw = JSON.parse(localStorage.getItem(`bills_${y}`) || '[]');
                    const normBld = b => { const s = String(b||'').toLowerCase(); return (s==='nest'||s.includes('nest')) ? 'nest' : 'rooms'; };
                    _taBills.push(...raw.filter(b => normBld(b.building) === _taBuilding && String(b.room) === String(_taRoom)));
                } catch(e) {}
            });
        }
        _taBills.sort((a,b) => ((b.year||0)-(a.year||0)) || ((b.month||0)-(a.month||0)));
        if (!_taPayments.length) {
            try { _taPayments = JSON.parse(localStorage.getItem(`payment_${_taBuilding}_${_taRoom}`) || '[]'); } catch(e) {}
        }
        // Filter AFTER bills/payments are hydrated from localStorage — the cache
        // may contain previous tenant's bills written before the boundary filter
        // shipped (or by an earlier subscribe firing before _taLease was known).
        if (_taLease) _applyTenantBoundary();
        window._tenantAppLease    = _taLease;
        window._tenantAppTenant   = _taTenant;
        window._tenantAppBills    = _taBills;
        window._tenantAppPayments = _taPayments;
    }

    // ── 2. Deferred view re-render ─────────────────────────────────────────
    // Visible page re-renders synchronously; off-screen pages deferred to idle.

    function _rerenderTenantViews() {
        const visibleId = window._currentPageEl?.id || '';

        if (typeof updateNavBadges === 'function') updateNavBadges();

        const renderHome     = () => typeof renderHomePage     === 'function' && renderHomePage();
        const renderBills    = () => typeof renderBillsList    === 'function' && renderBillsList();
        const renderProfile  = () => typeof renderProfilePage  === 'function' && renderProfilePage();
        const renderContract = () => typeof renderContractPage === 'function' && renderContractPage();
        const renderChart    = () => typeof _renderUsageChart  === 'function' && _renderUsageChart();

        if (visibleId === 'home-page')          renderHome();
        else if (visibleId === 'usage-page')  { renderBills(); renderChart(); }
        else if (visibleId === 'profile' || visibleId === 'quest-page') renderProfile();
        else if (visibleId === 'contract-page') renderContract();

        const idleCb = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
        idleCb(() => {
            if (visibleId !== 'home-page')     renderHome();
            if (visibleId !== 'usage-page')  { renderBills(); renderChart(); }
            if (visibleId !== 'profile' && visibleId !== 'quest-page') renderProfile();
            if (visibleId !== 'contract-page') renderContract();
        });
    }

    // ── 3. Bill helpers ────────────────────────────────────────────────────
    // SSoT delegation: dedup + boundary-filter logic lives in BillStore.

    function _dedupBills() {
        if (!window.BillStore?.dedupSynthetic) return;
        const before = _taBills.length;
        _taBills = window.BillStore.dedupSynthetic(_taBills);
        if (_taBills.length !== before) window._tenantAppBills = _taBills;
    }

    function _applyTenantBoundary() {
        if (!window.BillStore?.filterByTenantBoundary) return;
        const billYM  = b => (Number(b.year) || 0) * 100 + (Number(b.month) || 0);
        const meterYM = m => (Number(m.year) || 0) * 100 + (Number(m.month) || 0);
        _taBills = window.BillStore.filterByTenantBoundary(_taBills, billYM, _taLease);
        window._meterHistoryCache = window.BillStore.filterByTenantBoundary(window._meterHistoryCache || [], meterYM, _taLease);
        window._tenantAppBills = _taBills;
    }

    // ── 4. Data orchestrator ───────────────────────────────────────────────

    async function loadTenantAppData() {
        if (!_taRoom) return;

        // 1. SYNC: hydrate from localStorage (instant first paint, no Firestore round-trip).
        _hydrateTenantFromLocalStorage();

        // 2. SUBSCRIBE: idempotent, safe before Firebase is ready — retries via listeners.
        _subscribeBillsRealtime();
        if (typeof window._loadMeterHistoryFromFirestore === 'function') window._loadMeterHistoryFromFirestore();

        // 3. BACKGROUND: Firestore refresh. If Firebase isn't ready, retry once it is.
        if (typeof TenantFirebaseSync !== 'undefined' && window.firebaseReady) {
            try {
                const userStr = sessionStorage.getItem('user');
                const user = userStr ? JSON.parse(userStr) : { roomNumber: _taRoom };
                TenantFirebaseSync.initialize(user, _taBuilding, _taRoom);
                TenantFirebaseSync.loadAllData().then(data => {
                    if (data.lease) _taLease = data.lease;
                    if (data.tenant) _taTenant = data.tenant;
                    if (data.bills && data.bills.length) {
                        // Merge: Firestore wins on billId collision, otherwise keep cached.
                        const byId = new Map();
                        _taBills.forEach(b => byId.set(b.billId || b.id, b));
                        data.bills.forEach(b => byId.set(b.billId || b.id, b));
                        // toCE normalises 2-digit/4-digit BE and CE so sort is monotonic.
                        _taBills = Array.from(byId.values()).sort((a,b) =>
                            (_ce(b.year)*100+Number(b.month||0)) - (_ce(a.year)*100+Number(a.month||0)));
                        _dedupBills();
                    }
                    if (data.payments && data.payments.length) _taPayments = data.payments;
                    _applyTenantBoundary();
                    window._tenantAppLease    = _taLease;
                    window._tenantAppTenant   = _taTenant;
                    window._tenantAppBills    = _taBills;
                    window._tenantAppPayments = _taPayments;
                    _rerenderTenantViews();
                    // Retry subscription now that claims may be present
                    _subscribeBillsRealtime();
                }).catch(e => console.warn('tenant data refresh failed:', e?.message));
            } catch(e) { console.warn('tenant data init failed:', e?.message); }
        } else {
            window.addEventListener('firebaseInitialized', () => loadTenantAppData(), { once: true });
        }
    }

    // ── 5. RTDB bill subscription ──────────────────────────────────────────
    // Phase 4C: RTDB rule requires {room,building} claims. Back-off retry (5×)
    // covers the LIFF + linkAuthUid + token-refresh window (~30s). Per §7-U
    // the claim guard runs BEFORE _billsUnsub is set so liffLinked can retry.

    let _billsUnsub = null;
    let _billsRetryCount = 0;

    async function _subscribeBillsRealtime() {
        if (_billsUnsub) return;
        if (typeof TenantFirebaseSync === 'undefined') return;
        try {
            const user = window.firebaseAuth?.currentUser;
            if (!user) {
                if (_billsRetryCount < 5) {
                    _billsRetryCount++;
                    setTimeout(_subscribeBillsRealtime, 2000 * _billsRetryCount);
                } else {
                    console.warn('⛔ Bills subscription gave up — no Firebase user after 5 retries');
                }
                return;
            }
            const tr = await user.getIdTokenResult();
            if (!tr.claims.admin && !(tr.claims.room && tr.claims.building)) {
                if (_billsRetryCount < 5) {
                    _billsRetryCount++;
                    setTimeout(_subscribeBillsRealtime, 2000 * _billsRetryCount);
                } else {
                    console.warn('⛔ Bills subscription gave up — claims not set after 5 retries. Check linkAuthUid CF.');
                }
                return;
            }
            _billsRetryCount = 0;
        } catch (_) { return; }
        try {
            const userStr = sessionStorage.getItem('user');
            const u = userStr ? JSON.parse(userStr) : { roomNumber: _taRoom };
            TenantFirebaseSync.initialize(u, _taBuilding, _taRoom);
            _billsUnsub = TenantFirebaseSync.subscribeBills((bills) => {
                if (!Array.isArray(bills)) return;
                // Hide prev-tenant bills BEFORE merge — RTDB returns all bills at path.
                if (window.BillStore?.filterByTenantBoundary) {
                    bills = window.BillStore.filterByTenantBoundary(
                        bills, b => (Number(b.year)||0)*100 + (Number(b.month)||0), _taLease);
                }
                const byId = new Map();
                _taBills.forEach(b => byId.set(b.billId || b.id, b));
                bills.forEach(b => byId.set(b.billId || b.id, b));
                _taBills = Array.from(byId.values()).sort((a, b) =>
                    (_ce(b.year)*100+Number(b.month||0)) - (_ce(a.year)*100+Number(a.month||0))
                );
                _dedupBills();
                _applyTenantBoundary();
                window._tenantAppBills = _taBills;
                if (typeof renderBillsList === 'function') renderBillsList();
                if (typeof updateNavBadges === 'function') updateNavBadges();
                if (typeof _renderUsageChart === 'function') _renderUsageChart();
                // Persist to localStorage so data survives reloads before subscription fires.
                try {
                    const byYr = {};
                    bills.forEach(b => {
                        const yr = Number(b.year) || 0; if (!yr) return;
                        (byYr[yr] = byYr[yr] || []).push({...b, building: _taBuilding});
                    });
                    Object.entries(byYr).forEach(([yr, bs]) => {
                        const key = `bills_${yr}`;
                        const existing = JSON.parse(localStorage.getItem(key) || '[]');
                        const cache = new Map();
                        existing.forEach(b => cache.set(b.billId || b.id, b));
                        bs.forEach(b => cache.set(b.billId || b.id, b));
                        localStorage.setItem(key, JSON.stringify(Array.from(cache.values())));
                    });
                } catch(_) {}
            }, async () => {
                // permission_denied during LIFF auth transition — self-heals via 2s retry.
                _billsUnsub = null;
                try {
                    const u = window.firebaseAuth?.currentUser;
                    const fresh = u ? await u.getIdTokenResult(true).catch(() => null) : null;
                    console.warn('[bills] permission_denied — silent retry in 2s', {
                        path: `bills/${_taBuilding}/${_taRoom}`,
                        claimRoom: fresh?.claims?.room || '(none)',
                        claimBuilding: fresh?.claims?.building || '(none)',
                        uid: u?.uid?.slice(0, 14),
                        isAnon: u?.isAnonymous,
                    });
                } catch (_) {}
                setTimeout(_subscribeBillsRealtime, 2000);
            });
        } catch (e) { console.warn('subscribeBillsRealtime failed:', e.message); }
    }

    // ── Wiring ─────────────────────────────────────────────────────────────

    if (typeof _onLiffClaimsReady === 'function') {
        _onLiffClaimsReady(_subscribeBillsRealtime);
        _onLiffClaimsReady(loadTenantAppData);
    }

    window.loadTenantAppData       = loadTenantAppData;
    window._subscribeBillsRealtime = _subscribeBillsRealtime;
    window._rerenderTenantViews    = _rerenderTenantViews;
    window._dedupBills             = _dedupBills;
    window._applyTenantBoundary    = _applyTenantBoundary;
})();
