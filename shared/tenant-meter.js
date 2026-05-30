/**
 * tenant-meter.js — Meter history loader for tenant_app.html.
 *
 * Extracted from tenant_app.html inline script (~100 lines removed):
 *   - _loadMeterHistoryFromFirestore  (Firestore meter_data fetch + cache)
 *   - _backfillCashLegacyBills        (synthesize past bills from meter rows)
 *
 * window._meterHistoryCache is the shared state mirror — other modules
 * (tenant-usage-chart.js, tenant-data.js) read from it.
 *
 * Anti-patterns enforced (CLAUDE.md §7):
 *   §7-U: claim-guard (_taBuilding + _taRoom) before any Firestore call.
 *
 * Depends on globals:
 *   _taBuilding, _taRoom, _taLease  (window vars from inline tenant_app.html)
 *   _taBills                         (window var from inline tenant_app.html)
 *   window.firebase.*                (Firebase module init)
 *   window.BillStore                 (shared/billing-system.js)
 *   window.YearUtils                 (shared/billing-system.js)
 *   window.RoomConfigManager         (shared/room-config.js)
 *   window._dedupBills               (tenant-data.js, loaded after this module)
 *   window.renderBillsList           (tenant-render.js)
 *   window._renderUsageChart         (tenant-usage-chart.js)
 *   _onLiffClaimsReady               (inline tenant_app.html)
 */
(function () {
    'use strict';

    // Shared cache — mirrored to window so tenant-usage-chart.js + _applyTenantBoundary
    // can read it without crossing the module boundary.
    let _meterHistoryCache = [];
    let _meterHistoryLoading = false;
    window._meterHistoryCache = _meterHistoryCache;

    // ── Meter history loader ───────────────────────────────────────────────
    // Firestore: meter_data/{building_year_month_roomId} — each doc has
    // {building, roomId, year(BE 2-digit), month, eOld, eNew, wOld, wNew, yearMonth}
    // Cache used by:
    //   1. _renderUsageChart for the 6-month usage chart
    //   2. _backfillCashLegacyBills to retroactively render past months

    async function _loadMeterHistoryFromFirestore() {
        if (!_taBuilding || !_taRoom) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        if (_meterHistoryLoading) return;
        _meterHistoryLoading = true;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();
            const q = fs.query(
                fs.collection(db, 'meter_data'),
                fs.where('building', '==', _taBuilding),
                fs.where('roomId', '==', String(_taRoom)),
                fs.limit(24)
            );
            const snap = await fs.getDocs(q);
            _meterHistoryCache = snap.docs.map(d => {
                const m = d.data() || {};
                // SSoT year normalization (handles 2-digit BE / 4-digit BE / 4-digit CE)
                const yrCE = window.YearUtils.toCE(m.year) || 0;
                const mo = Number(m.month) || 0;
                return {
                    monthKey: `${yrCE}-${String(mo).padStart(2,'0')}`, // "2026-04"
                    year: yrCE, month: mo,
                    eOld: Number(m.eOld)||0, eNew: Number(m.eNew)||0,
                    wOld: Number(m.wOld)||0, wNew: Number(m.wNew)||0,
                    createdAt: m.createdAt || m.updatedAt || null
                };
            }).sort((a,b) => b.monthKey.localeCompare(a.monthKey));
            // Hide previous tenant's meter rows — SSoT helper handles the no-lease case.
            if (window.BillStore?.filterByTenantBoundary) {
                _meterHistoryCache = window.BillStore.filterByTenantBoundary(
                    _meterHistoryCache, m => (Number(m.year)||0)*100 + (Number(m.month)||0), _taLease);
            }
            window._meterHistoryCache = _meterHistoryCache;
            try { localStorage.setItem(`meter_history_${_taBuilding}_${_taRoom}`, JSON.stringify(_meterHistoryCache)); } catch(e) {}
            _backfillCashLegacyBills();
            if (typeof window.renderBillsList === 'function') window.renderBillsList();
            if (typeof window._renderUsageChart === 'function') window._renderUsageChart();
        } catch (e) {
            console.warn('⚠️ meter history load failed:', e.message);
        } finally {
            _meterHistoryLoading = false;
        }
    }

    // ── Bill backfill from meter rows ──────────────────────────────────────
    // Synthesize bills from meter_data — meter_data is the SoT for bills.
    // Past months → status='paid' method='cash_legacy' (pre-SlipOK).
    // Current month → status='pending' (newly uploaded meter, awaiting payment).

    function _backfillCashLegacyBills() {
        if (!_meterHistoryCache.length) return;
        if (!window.BillStore?.synthesizeFromMeter) return;
        let rent = 0, eRate = 8, wRate = 20, trash = 40;
        try {
            if (typeof RoomConfigManager !== 'undefined') {
                const rc = RoomConfigManager.getRoom?.(_taBuilding, _taRoom);
                if (rc) {
                    rent  = Number(rc.rentPrice    ?? rc.rent)     || 0;
                    eRate = Number(rc.electricRate ?? rc.elecRate) || 8;
                    wRate = Number(rc.waterRate)                   || 20;
                    trash = Number(rc.trashRate    ?? rc.trashFee) || 40;
                }
            }
        } catch(e) {}
        if (!rent && _taLease?.rentAmount) rent = Number(_taLease.rentAmount) || 0;

        const synth = window.BillStore.synthesizeFromMeter({
            meterHistory: _meterHistoryCache,
            existingBills: _taBills,
            rates: { rent, eRate, wRate, trash },
            moveInDate: _taLease?.moveInDate,
            building: _taBuilding,
            room: _taRoom,
            pastOnly: false
        });
        if (synth.length) _taBills.push(...synth);
        _taBills.sort((a,b) => {
            const aCE = window.YearUtils.toCE(a.year) || 0;
            const bCE = window.YearUtils.toCE(b.year) || 0;
            return (bCE*100+Number(b.month)) - (aCE*100+Number(a.month));
        });
        if (typeof window._dedupBills === 'function') window._dedupBills();
        window._tenantAppBills = _taBills;
    }

    // ── Wiring ─────────────────────────────────────────────────────────────

    if (typeof _onLiffClaimsReady === 'function') {
        _onLiffClaimsReady(_loadMeterHistoryFromFirestore);
    }

    window._loadMeterHistoryFromFirestore = _loadMeterHistoryFromFirestore;
    window._backfillCashLegacyBills       = _backfillCashLegacyBills;
})();
