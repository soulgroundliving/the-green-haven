// ===== DAILY BONUS / Daily Login System =====
// Extracted from tenant_app.html. Exports:
//   window.checkDailyLogin        — called from initTenantApp() in tenant-liff-auth.js (load event)
//   window.claimDailyPoints       — data-action dispatcher
//   window._renderDailyBonusCards — called from _refreshDailyBonusIfOpen + openDailyModal
//   window._refreshDailyBonusIfOpen — called via typeof from tenant-leaderboard.js
//   window.openDailyModal / window.closeDailyModal — data-action dispatcher
//
// Shared state (var globals from inline script):
//   _dailyStreak, _lastDailyClaim — var declarations → same as window.*
//   userPoints, updateUserPointsUI — from tenant-leaderboard.js
(function () {
    'use strict';

    // Bangkok date string — used for same-day comparisons against CF's today value.
    function _bkkDateString(d) {
        return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    }

    // Mirror the CF's streak math: same-day = already claimed, yesterday = continue, gap/none = reset to 1.
    // Returns { cyclePos: 1-7 (today's slot in the 7-day cycle), isClaimableNow: bool }.
    //
    // Fallback chain for lastClaim: in-memory _lastDailyClaim (from Firestore snapshot)
    // → localStorage (persists across page reload before snapshot arrives). Page reload
    // resets in-memory to null/0, so without the localStorage hop a tenant who claimed
    // today and re-opened the LIFF would see the GET button enabled for ~500ms until
    // _subscribeEcoPoints round-trips.
    function _computeDailyBonusState() {
        const today = _bkkDateString(new Date());
        const yesterday = _bkkDateString(new Date(Date.now() - 86400000));
        let lastClaim = window._lastDailyClaim;
        if (!lastClaim) {
            try {
                const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
                const lsKey = isPlayer
                    ? `lastDailyClaim_player_${window._playerProfile.tenantId}`
                    : `lastDailyClaim_${_taBuilding}_${_taRoom}`;
                lastClaim = localStorage.getItem(lsKey) || null;
            } catch(_) {}
        }
        let nextStreak, isClaimableNow;
        if (lastClaim === today) {
            nextStreak = Math.max(1, window._dailyStreak || 1);
            isClaimableNow = false;
        } else if (lastClaim === yesterday) {
            nextStreak = (window._dailyStreak || 0) + 1;
            isClaimableNow = true;
        } else {
            nextStreak = 1;
            isClaimableNow = true;
        }
        const cyclePos = ((nextStreak - 1) % 7) + 1;
        return { cyclePos, isClaimableNow };
    }

    function _renderDailyBonusCards() {
        const { cyclePos, isClaimableNow } = _computeDailyBonusState();
        const grid = document.getElementById('daily-bonus-grid');
        if (grid) {
            grid.innerHTML = [1,2,3,4,5,6].map(d => {
                let cls = 'day-card', badge = '';
                if (d < cyclePos) {
                    cls = 'day-card active';
                } else if (d === cyclePos) {
                    if (isClaimableNow) { cls = 'day-card today'; badge = '<span class="get-badge">GET</span>'; }
                    else cls = 'day-card active';
                }
                return `<div class="${cls}">${badge}${d} Day${d>1?'s':''}<br>💰 1</div>`;
            }).join('');
        }
        const day7 = document.getElementById('daily-bonus-day7');
        if (day7) {
            let cls = 'day-card', badge = '';
            if (cyclePos === 7) {
                if (isClaimableNow) { cls = 'day-card today'; badge = '<span class="get-badge">GET</span>'; }
                else cls = 'day-card active';
            }
            day7.className = cls;
            day7.innerHTML = badge + '7 Days ✨ Special Bonus +3 Pts';
        }
        // Sync the claim button with the same isClaimableNow signal so peek-mode
        // (openDailyModal after claim) shows "✓ รับแล้ววันนี้" disabled instead
        // of a tap that the CF will reject with already-exists.
        const btn = document.querySelector('[data-action="claimDailyPoints"]');
        if (btn) {
            if (isClaimableNow) {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.cursor = 'pointer';
                btn.innerText = 'รับพ้อยท์วันนี้';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'default';
                btn.innerText = '✓ รับแล้ววันนี้';
            }
        }
    }

    function _refreshDailyBonusIfOpen() {
        const m = document.getElementById('daily-modal');
        if (m && m.style.display === 'flex') _renderDailyBonusCards();
    }

    // 1. ฟังก์ชันเช็ก — Nest only unless player mode
    function checkDailyLogin() {
        const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
        if (!isPlayer && window._nestOnlyDisabled) return; // Rooms tenant — skip
        // Bangkok date (UTC+7) — matches the CF's today calculation
        const bkkToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        const claimKey = isPlayer
            ? `lastDailyClaim_player_${window._playerProfile.tenantId}`
            : `lastDailyClaim_${_taBuilding}_${_taRoom}`;
        if (localStorage.getItem(claimKey) === bkkToday) return;
        const modal = document.getElementById('daily-modal');
        if (!modal) return;
        _renderDailyBonusCards();
        const nav = document.getElementById('main-nav-bar');
        if (nav) nav.style.display = 'none';
        modal.style.height = (window.innerHeight || 600) + 'px';
        modal.style.display = 'flex';
    }

    // 2. ฟังก์ชันกดรับพ้อยท์ — Nest only unless player mode
    async function claimDailyPoints() {
        const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
        if (!isPlayer && window._nestOnlyDisabled) return;

        const btn = document.querySelector('[data-action="claimDailyPoints"]');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

        const closeModal = () => {
            const modal = document.getElementById('daily-modal');
            if (modal) modal.style.display = 'none';
            const nav = document.getElementById('main-nav-bar');
            if (nav) nav.style.display = '';
            if (typeof showPage === 'function') showPage('world-map');
        };

        const claimKey = isPlayer
            ? `lastDailyClaim_player_${window._playerProfile.tenantId}`
            : `lastDailyClaim_${_taBuilding}_${_taRoom}`;

        // Optimistic close + marker write — both happen IMMEDIATELY on click.
        // Why marker-write here (not after the await): user can close LIFF before
        // the 1-3s CF round-trip completes (§7-R). If marker were only set on
        // resolve, reopen would show the modal again.
        const _bkkToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        localStorage.setItem(claimKey, _bkkToday);
        window._lastDailyClaim = _bkkToday;
        closeModal();

        try {
            const fns = window.firebase?.functions;
            if (!fns) throw new Error('Firebase Functions SDK not loaded');
            const callable = fns.httpsCallable('claimDailyLoginPoints');
            const payload = isPlayer
                ? { tenantId: window._playerProfile.tenantId }
                : { building: _taBuilding, roomId: String(_taRoom) };
            if (!isPlayer && (!_taBuilding || !_taRoom)) throw new Error('ยังไม่พบข้อมูลห้อง');
            const resp = await callable(payload);
            const r = resp.data || {};
            if (typeof r.pointsAfter === 'number') {
                window.userPoints = r.pointsAfter;
                if (typeof updateUserPointsUI === 'function') updateUserPointsUI();
            }
            const streakMsg = r.bonus > 0
                ? `รับ +${r.reward} Pts! 🔥 ครบ ${r.streak} วัน โบนัสพิเศษ +${r.bonus}`
                : `รับ +${r.reward} Pt แล้ว (สตรีค ${r.streak} วัน)`;
            if (typeof toast === 'function') toast(streakMsg, 'success');
            window.GhHaptic?.success();
            // streak update from server (in-memory mirror; localStorage marker already set above)
            if (typeof r.streak === 'number') window._dailyStreak = r.streak;
        } catch (e) {
            const code = e?.code || e?.details?.code || '';
            if (code === 'functions/already-exists' || /already/i.test(String(e?.message))) {
                // Server confirms today's claim already exists — optimistic marker correct
                if (typeof toast === 'function') toast('รับพ้อยท์ของวันนี้ไปแล้วครับ 🌿', 'warning');
                window.GhHaptic?.warning();
            } else {
                // ROLLBACK: server rejected (network/auth/etc) — clear marker so user can retry
                console.error('claimDailyPoints failed:', e);
                localStorage.removeItem(claimKey);
                window._lastDailyClaim = null;
                if (typeof toast === 'function') toast('บันทึกไม่สำเร็จ — ลองใหม่ครับ', 'error');
                window.GhHaptic?.error();
                // Modal already closed (optimistic). Re-enable button so a subsequent
                // reopen via 💰 peek lets the user retry without a stale disabled state.
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            }
        }
    }

    // Peek-mode entry for the daily bonus modal. checkDailyLogin() is the
    // automatic-on-load gate (returns early once today's claim is in localStorage);
    // openDailyModal() is the tenant-initiated reopen that bypasses the gate so
    // they can confirm streak state any time during the day.
    function openDailyModal() {
        const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
        if (!isPlayer && window._nestOnlyDisabled) return;
        const modal = document.getElementById('daily-modal');
        if (!modal) return;
        _renderDailyBonusCards();
        const nav = document.getElementById('main-nav-bar');
        if (nav) nav.style.display = 'none';
        modal.style.height = (window.innerHeight || 600) + 'px';
        modal.style.display = 'flex';
    }

    function closeDailyModal() {
        const modal = document.getElementById('daily-modal');
        if (modal) modal.style.display = 'none';
        // Intentionally NOT touching main-nav-bar here. openDailyModal/checkDailyLogin
        // can only be triggered from world-map (the 💰 chip lives inside #world-map-page
        // and disappears with the page), where showPage already set nav display:none.
        // Setting `nav.style.display = ''` would clear that inline value and fall back
        // to the CSS .nav-bar rule (display:flex) — nav flashes over the world map.
    }

    window.checkDailyLogin         = checkDailyLogin;
    window.claimDailyPoints        = claimDailyPoints;
    window._renderDailyBonusCards  = _renderDailyBonusCards;
    window._refreshDailyBonusIfOpen = _refreshDailyBonusIfOpen;
    window.openDailyModal          = openDailyModal;
    window.closeDailyModal         = closeDailyModal;
})();
