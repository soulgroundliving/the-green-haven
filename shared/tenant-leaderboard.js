// ===== LEADERBOARD + ECO POINTS + GAMIFICATION DISPLAY (Nest-only) =====
// Extracted from tenant_app.html. Exports:
//   window.loadGamificationData — called from _onLiffClaimsReady (closure), showPage, load event, etc.
//   window.updateUserPointsUI   — called from redeemReward() in inline script
//
// Shared state (var declarations in inline script → window properties):
//   window.userPoints      (var userPoints)
//   window._dailyStreak    (var _dailyStreak)
//   window._lastDailyClaim (var _lastDailyClaim)
//
// Other deps resolved via window at call time (after defer scripts run):
//   _taBuilding, _taRoom, _taLease — var globals from tenant-liff-auth.js
//   _refreshDailyBonusIfOpen — function decl in inline script (→ window property)
//   GamificationRules — from shared/gamification-rules.js
(function () {
    'use strict';

    // ── Leaderboard ─────────────────────────────────────────────────────────
    // Queries tenants/nest/list orderBy gamification.points desc limit 10.
    // Renders top 3 + current tenant row (highlighted) using DOM API (XSS-safe).
    let _leaderboardLoaded = false;
    async function _loadLeaderboard() {
        if (_leaderboardLoaded) return;
        if (window._gamificationDisabled) return; // Rooms tenants
        const cont = document.getElementById('eco-leaderboard');
        if (!cont) return;
        if (!window.firebase?.functions) return;
        try {
            const getLeaderboard = window.firebase.functions.httpsCallable('getLeaderboard');
            const result = await getLeaderboard({ building: 'nest' });
            const rows = (result.data?.leaderboard || []);
            _leaderboardLoaded = true;
            cont.innerHTML = '';
            if (!rows.length) {
                cont.innerHTML = '<div class="text-center text-xs text-gray-400 py-4">ยังไม่มีข้อมูลอันดับ — ลูกบ้าน Nest ยังไม่ได้สะสมแต้ม</div>';
                return;
            }
            const myRoom = String(_taRoom);
            const isPlayerViewer = window._isPlayerMode && window._playerProfile?.tenantId;
            const top3 = rows.slice(0, 3);
            top3.forEach((r, i) => {
                const isMe = isPlayerViewer
                    ? (r.isPlayer && r.tenantId === window._playerProfile.tenantId)
                    : (r.roomId === myRoom);
                const roomLabel = r.roomId ? `ห้อง ${r.roomId}` : '🌿 สมาชิก';
                const rank = i + 1;
                const row = document.createElement('div');
                row.className = 'flex items-center gap-3 p-3' + (rank === 1 ? ' bg-[#F0F7F2] rounded-2xl' : '') + (isMe ? ' bg-[#FFF8E7] rounded-2xl border-2 border-[#D4AF37]' : '');
                const num = document.createElement('span');
                num.className = 'text-lg font-bold w-5 text-center ' + (rank === 1 ? 'text-[#2d8653]' : 'text-gray-300');
                num.textContent = String(rank);
                const av = document.createElement('div');
                av.className = 'w-10 h-10 ' + (rank === 1 ? 'bg-white' : 'bg-[#e8f5e9]') + ' rounded-full flex items-center justify-center text-sm';
                av.textContent = r.avatar;
                const info = document.createElement('div');
                info.className = 'flex-1';
                const nameEl = document.createElement('p');
                nameEl.className = 'text-xs font-bold';
                nameEl.textContent = isMe ? `คุณ (${roomLabel})` : `คุณ${r.name} (${roomLabel})`;
                const ptsEl = document.createElement('p');
                ptsEl.className = 'text-[9px] text-gray-400';
                ptsEl.textContent = r.points.toLocaleString() + ' Pts';
                info.appendChild(nameEl); info.appendChild(ptsEl);
                row.appendChild(num); row.appendChild(av); row.appendChild(info);
                if (rank === 1) {
                    const medal = document.createElement('span');
                    medal.className = 'text-xl';
                    medal.textContent = '🥇';
                    row.appendChild(medal);
                }
                if (isMe) {
                    const tag = document.createElement('span');
                    tag.className = 'text-[10px] bg-[#D4AF37] text-white px-2 py-0.5 rounded-full font-bold';
                    tag.textContent = 'คุณ';
                    row.appendChild(tag);
                }
                cont.appendChild(row);
            });
            // Add current user row if not in top 3
            const inTop3 = isPlayerViewer
                ? top3.some(r => r.isPlayer && r.tenantId === window._playerProfile.tenantId)
                : top3.some(r => r.roomId === myRoom);
            if (!inTop3) {
                const myRank = isPlayerViewer
                    ? rows.findIndex(r => r.isPlayer && r.tenantId === window._playerProfile.tenantId)
                    : rows.findIndex(r => r.roomId === myRoom);
                const myData = myRank >= 0 ? rows[myRank] : { points: window.userPoints };
                const myLabel = isPlayerViewer ? '🌿 สมาชิก' : `ห้อง ${myRoom || '—'}`;
                const row = document.createElement('div');
                row.className = 'flex items-center gap-3 p-3 bg-[#FFF8E7] rounded-2xl border-2 border-[#D4AF37] mt-2';
                const num = document.createElement('span');
                num.className = 'text-lg font-bold text-[#D4AF37] w-5 text-center';
                num.textContent = myRank >= 0 ? String(myRank + 1) : '?';
                const av = document.createElement('div');
                av.className = 'w-10 h-10 bg-[#e8f5e9] rounded-full flex items-center justify-center text-sm';
                av.textContent = '👤';
                const info = document.createElement('div');
                info.className = 'flex-1';
                const nameEl = document.createElement('p');
                nameEl.className = 'text-xs font-bold';
                nameEl.textContent = `คุณ (${myLabel})`;
                const ptsEl = document.createElement('p');
                ptsEl.className = 'text-[9px] text-gray-400';
                ptsEl.id = 'eco-my-pts';
                ptsEl.textContent = (myData.points || window.userPoints).toLocaleString() + ' Pts';
                info.appendChild(nameEl); info.appendChild(ptsEl);
                row.appendChild(num); row.appendChild(av); row.appendChild(info);
                const tag = document.createElement('span');
                tag.className = 'text-[10px] bg-[#D4AF37] text-white px-2 py-0.5 rounded-full font-bold';
                tag.textContent = 'คุณ';
                row.appendChild(tag);
                cont.appendChild(row);
            }
        } catch (e) {
            console.warn('leaderboard load failed:', e.message);
            cont.innerHTML = '<div class="text-center text-xs text-gray-400 py-4">ไม่สามารถโหลดอันดับได้ในขณะนี้</div>';
        }
    }

    // ── Eco Points subscription ──────────────────────────────────────────────
    // Gamification storage is split by tenant lifecycle:
    //   - Active tenant (in a room): tenants/{building}/list/{roomId}.gamification
    //   - Player (post-tenancy, within 1-yr grace): people/{tenantId}.gamification
    // §7-U: claim-first guard + error callback resets unsub for liffLinked retry.
    // §7-KK: cached-snapshot reconciliation guard (fromCache / hasPendingWrites).
    let _ecoPointsUnsub = null;
    function _subscribeEcoPoints() {
        if (window._gamificationDisabled) return;
        if (_ecoPointsUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const fs = window.firebase.firestoreFunctions;
            const db = window.firebase.firestore();

            // ── Player branch ─────────────────────────────────────────
            if (window._isPlayerMode && window._playerProfile?.tenantId) {
                const peopleRef = fs.doc(db, 'people', window._playerProfile.tenantId);
                _ecoPointsUnsub = fs.onSnapshot(peopleRef, snap => {
                    if (!snap.exists()) return;
                    const gam = (snap.data() || {}).gamification || {};
                    window._taQuestsToday = gam.questsToday || {}; // Meaning Layer #1 checklist state
                    const pts = typeof gam.points === 'number' ? gam.points : null;
                    if (pts !== null) {
                        window.userPoints = pts;
                        loadGamificationData();
                        updateUserPointsUI();
                        const lastPts = parseInt(sessionStorage.getItem('_badgeCheckPts') || '-1');
                        if (pts !== lastPts) { sessionStorage.setItem('_badgeCheckPts', String(pts)); _checkBadgesViaFF(); }
                    }
                    window._dailyStreak    = Number(gam.dailyStreak) || 0;
                    window._lastDailyClaim = gam.lastDailyClaim || null;
                    // Reconcile stale localStorage when Firestore says no-claim. Handles
                    // admin-reset / data-rollback scenarios where the per-room/per-player
                    // gate persists across the wipe and would otherwise keep the claim
                    // button disabled despite the server allowing a fresh claim.
                    // §7-KK: skip reconciliation on cached snapshots — optimistic claim
                    // localStorage marker must survive the initial cached-snapshot fire.
                    if (!window._lastDailyClaim && !snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites) {
                        try {
                            const lsKey = `lastDailyClaim_player_${window._playerProfile.tenantId}`;
                            const today = new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10);
                            if (localStorage.getItem(lsKey) === today) localStorage.removeItem(lsKey);
                        } catch(_) {}
                    }
                    if (typeof _refreshDailyBonusIfOpen === 'function') _refreshDailyBonusIfOpen();
                    const badges = Array.isArray(gam.badges) ? gam.badges : [];
                    _lastKnownBadges = badges;
                    if (typeof _renderBadgeGrid === 'function') _renderBadgeGrid(badges);
                    if (typeof _renderProfileBadge === 'function') _renderProfileBadge(badges);
                }, err => {
                    if (err && (err.code === 'permission-denied' || /insufficient permissions/i.test(err.message || ''))) return;
                    console.warn('player eco points subscribe failed:', err.message);
                });
                return;
            }

            // ── Active tenant branch ──────────────────────────────────
            // SSoT for active tenants is tenants/{building}/list/{roomId}.gamification.
            // §7-U: wait until LIFF claims hydrate _taBuilding + _taRoom.
            if (!_taBuilding || !_taRoom) return;
            const tenantRef = fs.doc(db, 'tenants', _taBuilding, 'list', _taRoom);
            _ecoPointsUnsub = fs.onSnapshot(tenantRef, snap => {
                if (!snap.exists()) return;
                const gam = (snap.data() || {}).gamification || {};
                window._taQuestsToday = gam.questsToday || {}; // Meaning Layer #1 checklist state
                const pts = typeof gam.points === 'number' ? gam.points : null;
                if (pts !== null) {
                    window.userPoints = pts;
                    try { localStorage.setItem(`tenant_eco_points_${_taBuilding}_${_taRoom}`, String(window.userPoints)); } catch(e) {}
                    loadGamificationData();
                    updateUserPointsUI();
                    const lastPts = parseInt(sessionStorage.getItem('_badgeCheckPts') || '-1');
                    if (pts !== lastPts) { sessionStorage.setItem('_badgeCheckPts', String(pts)); _checkBadgesViaFF(); }
                }
                window._dailyStreak    = Number(gam.dailyStreak) || 0;
                window._lastDailyClaim = gam.lastDailyClaim || null;
                // §7-KK: skip reconciliation on cached snapshots.
                if (!window._lastDailyClaim && !snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites) {
                    try {
                        const lsKey = `lastDailyClaim_${_taBuilding}_${_taRoom}`;
                        const today = new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10);
                        if (localStorage.getItem(lsKey) === today) localStorage.removeItem(lsKey);
                    } catch(_) {}
                }
                if (typeof _refreshDailyBonusIfOpen === 'function') _refreshDailyBonusIfOpen();
                const badges = Array.isArray(gam.badges) ? gam.badges : [];
                _lastKnownBadges = badges;
                _renderBadgeGrid(badges);
                _renderProfileBadge(badges);
            }, err => {
                // permission-denied is expected when tenant hasn't linked LIFF auth yet —
                // fall back to localStorage silently. Other errors are surfaced.
                if (err && (err.code === 'permission-denied' || /insufficient permissions/i.test(err.message || ''))) return;
                console.warn('eco points subscribe failed:', err.message);
            });
        } catch (e) {
            if (e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''))) return;
            console.warn('eco points subscribe init failed:', e.message);
        }
    }

    // ── loadGamificationData ────────────────────────────────────────────────
    // Points are server-authoritative: Firestore gamification.points, delivered by
    // _subscribeEcoPoints and mirrored room-scoped in localStorage for the
    // pre-snapshot paint. A real balance of 0 is valid and MUST be shown as 0 —
    // never synthesize points from lease age. (The old `months * 10` fallback made
    // a freshly-reset room with a ~4-month lease display a phantom 40 Pts.)
    function loadGamificationData() {
        let pts = (typeof window.userPoints === 'number')
            ? window.userPoints
            : (parseInt(localStorage.getItem(`tenant_eco_points_${_taBuilding}_${_taRoom}`), 10) || 0);
        window.userPoints = pts;
        _subscribeEcoPoints(); // idempotent — only subscribes once
        _loadLeaderboard();    // Nest-only, idempotent
        // Level + progress from SSoT (shared/gamification-rules.js)
        const lp = window.GamificationRules.getLevelProgress(pts);
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('eco-level-name',     `${lp.tier.name} ${lp.tier.emoji}`);
        setEl('eco-points-display', pts.toLocaleString() + ' Pts');
        setEl('eco-my-pts',         pts.toLocaleString() + ' Pts');
        setEl('world-map-level',    `Lv.${lp.tier.level} ${lp.tier.name}`);
        if (lp.next) setEl('eco-next-goal', `เป้าหมายถัดไป: ${lp.next.name} (${lp.next.min.toLocaleString()} Pts)`);
        const bar = document.getElementById('eco-progress-bar');
        if (bar) bar.style.width = Math.round(lp.progress) + '%';
        _renderTierLegend(pts);
        _renderEarningGuide();
        // Meaning Layer #1: the live quest checklist owns #urgent-quests-list.
        // Fall back to the static placeholder only if tenant-quests didn't load.
        if (typeof window.renderTenantQuests === 'function') window.renderTenantQuests();
        else _renderUrgentQuests();
        if (typeof _renderBadgeGrid === 'function') _renderBadgeGrid(_lastKnownBadges || []);
    }

    // ── updateUserPointsUI ──────────────────────────────────────────────────
    // Called from redeemReward() in inline script (via window.updateUserPointsUI).
    function updateUserPointsUI() {
        const pointEl = document.getElementById('eco-points-display');
        if (pointEl) {
            pointEl.innerText = window.userPoints.toLocaleString();
        }
        const pointsEl = document.getElementById('eco-my-pts');
        if (pointsEl) {
            // ใช้ toLocaleString() เพื่อให้มีคอมม่า (เช่น 1,250)
            pointsEl.innerText = window.userPoints.toLocaleString() + ' Pts';
        }
    }

    // ── Earning guide ────────────────────────────────────────────────────────
    // Render "วิธีสะสมคะแนน" from SSoT — EARNING_SOURCES + RENT_POINT_TIERS.
    // Content is purely from constants — render once + skip rebuilds on every points update.
    let _earningGuideRendered = false;
    function _renderEarningGuide() {
        if (_earningGuideRendered) return;
        const el = document.getElementById('earning-guide-list');
        if (!el || !window.GamificationRules) return;
        const R = window.GamificationRules;
        const tierBg = { green: 'bg-green-50', yellow: 'bg-yellow-50', orange: 'bg-orange-50', gray: 'bg-gray-100' };
        const tierFg = { green: 'text-[#2d8653]', yellow: 'text-yellow-700', orange: 'text-orange-700', gray: 'text-gray-500' };
        el.innerHTML = R.EARNING_SOURCES.map(s => {
            if (s.tiered) {
                const grid = R.RENT_POINT_TIERS.map(t => {
                    const bg = tierBg[t.color] || 'bg-gray-100';
                    const fg = tierFg[t.color] || 'text-gray-500';
                    return `<div class="${bg} rounded py-1"><div class="font-bold ${fg}">+${t.points}</div><div class="text-gray-500">${t.label}</div></div>`;
                }).join('');
                return `<div class="muji-card p-3">
                    <div class="flex items-center gap-3 mb-2"><span class="text-lg">${s.emoji}</span>
                        <div class="flex-1"><p class="text-xs font-bold">${s.title}</p><p class="text-[9px] text-gray-400">${s.subtitle}</p></div>
                    </div>
                    <div class="grid grid-cols-5 gap-1 text-[9px] text-center mt-2">${grid}</div>
                </div>`;
            }
            return `<div class="muji-card p-3 flex justify-between items-center">
                <div class="flex items-center gap-3"><span class="text-lg">${s.emoji}</span>
                    <div><p class="text-xs font-bold">${s.title}</p><p class="text-[9px] text-gray-400">${s.subtitle}</p></div>
                </div>
                <span class="text-xs font-bold text-[#2d8653]">${s.display}</span>
            </div>`;
        }).join('');
        _earningGuideRendered = true;
    }

    // ── Urgent quests ────────────────────────────────────────────────────────
    // Render "ภารกิจเร่งด่วน" from SSoT URGENT_QUESTS. Static — render once.
    // Only fixed set of border colors to keep Tailwind JIT-safe.
    const URGENT_QUEST_BORDER = { orange: 'border-orange-400', green: 'border-green-400', blue: 'border-blue-400', red: 'border-red-400' };
    let _urgentQuestsRendered = false;
    function _renderUrgentQuests() {
        if (_urgentQuestsRendered) return;
        const el = document.getElementById('urgent-quests-list');
        if (!el || !window.GamificationRules) return;
        el.innerHTML = window.GamificationRules.URGENT_QUESTS.map(q => {
            const border = URGENT_QUEST_BORDER[q.borderColor] || 'border-gray-400';
            return `<div class="muji-card p-4 flex justify-between items-center border-l-4 ${border}">
                <div class="flex items-center gap-3">
                    <span class="text-xl">${q.emoji}</span>
                    <div><p class="text-xs font-bold">${q.title}</p><p class="text-[9px] text-gray-400">${q.subtitle}</p></div>
                </div>
                <button class="bg-[#2d8653] text-white text-[10px] px-4 py-1.5 rounded-full font-bold" disabled title="Coming soon">รับ ${q.points} Pts</button>
            </div>`;
        }).join('');
        _urgentQuestsRendered = true;
    }

    // ── Tier legend ──────────────────────────────────────────────────────────
    // Render "ระดับในระบบ" from SSoT LEVEL_TIERS. Re-render only when tier changes.
    let _lastRenderedTierId = null;
    function _renderTierLegend(pts) {
        const el = document.getElementById('tier-legend');
        if (!el || !window.GamificationRules) return;
        const lp = window.GamificationRules.getLevelProgress(pts);
        if (lp.tier?.id === _lastRenderedTierId) return;
        _lastRenderedTierId = lp.tier?.id || null;
        const rows = window.GamificationRules.LEVEL_TIERS.map(t => {
            const range = t.max === Infinity
                ? `${t.min.toLocaleString()}+ Pts`
                : `${t.min.toLocaleString()} – ${t.max.toLocaleString()} Pts`;
            if (t.id === lp.tier.id) {
                return `<div class="flex justify-between font-bold text-[#2d8653]"><span>⬆️ คุณอยู่ที่นี่ (${t.name})</span><span>${Number(pts).toLocaleString()} Pts</span></div>`;
            }
            return `<div class="flex justify-between text-gray-400"><span>${t.emoji} ${t.name}</span><span>${range}</span></div>`;
        });
        el.innerHTML = rows.join('');
    }

    // ── Badge grid + profile badge ───────────────────────────────────────────
    let _lastKnownBadges = null;

    // Badge catalog + helpers come from SSoT (shared/gamification-rules.js).
    const _BADGE_CATALOG = window.GamificationRules.BADGE_CATALOG;
    const _badgeId = window.GamificationRules.badgeId;

    function _renderBadgeGrid(badges) {
        const container = document.getElementById('badge-grid-container');
        if (!container) return;
        const earnedMap = new Map((badges || []).map(b => [_badgeId(b), b]));
        const frag = document.createDocumentFragment();
        for (const cat of _BADGE_CATALOG) {
            const b = earnedMap.get(cat.id);
            const card = document.createElement('div');
            card.className = 'muji-card p-3 text-center';
            if (!b) card.style.cssText = 'opacity:0.4; filter:grayscale(1);';
            const emoEl = document.createElement('div');
            emoEl.style.cssText = 'font-size:1.5rem; margin-bottom:4px;';
            emoEl.textContent = cat.emoji;
            const lblEl = document.createElement('p');
            lblEl.style.cssText = 'font-size:9px; font-weight:700; margin:0;';
            lblEl.textContent = cat.label;
            const subEl = document.createElement('p');
            subEl.style.cssText = 'font-size:8px; color:#9ca3af; margin:2px 0 0;';
            if (b && b.earnedAt) {
                const d = new Date(b.earnedAt);
                subEl.textContent = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()+543}`;
            } else if (cat.marketplace) {
                // Sprint 6 — event-based badges show their unlock hint
                // (e.g. "แจกฟรี 3 ครั้ง") instead of a Pts threshold.
                subEl.textContent = cat.hint || `${cat.marketplace} × ${cat.minCount}`;
            } else {
                subEl.textContent = cat.minPts > 0 ? cat.minPts.toLocaleString()+' Pts' : 'ย้ายเข้า';
            }
            card.appendChild(emoEl); card.appendChild(lblEl); card.appendChild(subEl);
            frag.appendChild(card);
        }
        container.replaceChildren(frag);
    }

    function _renderProfileBadge(badges) {
        const el = document.getElementById('profile-top-badge');
        if (!el) return;
        if (!badges || badges.length === 0) { el.style.display = 'none'; return; }
        const ORDER = ['master_resident','perfect_record','rising_star','loyal_resident','green_guardian','community_star','on_time','first_month','the_giver','sky_walker','pet_whisperer'];
        const earnedIds = new Set((badges || []).map(_badgeId));
        const top = ORDER.find(id => earnedIds.has(id));
        if (!top) { el.style.display = 'none'; return; }
        const def = _BADGE_CATALOG.find(c => c.id === top);
        el.textContent = def ? `${def.label} ${def.emoji}` : top;
        el.style.cssText = 'display:block; background:var(--primary-green); color:white; padding:5px 20px; border-radius:20px; font-size:var(--fs-sm); font-weight:600; text-align:center; margin-bottom:12px;';
    }

    function _checkBadgesViaFF() {
        if (!window.firebase?.functions || window._gamificationDisabled) return;
        const callable = window.firebase.functions.httpsCallable('checkAndAwardBadges');
        if (window._isPlayerMode && window._playerProfile?.tenantId) {
            callable({ tenantId: window._playerProfile.tenantId })
                .catch(e => console.warn('badge check (player) failed:', e.message));
            return;
        }
        if (!window._taBuilding || !window._taRoom) return;
        callable({ building: _taBuilding, roomId: String(_taRoom) })
            .catch(e => console.warn('badge check failed:', e.message));
    }

    // redeemReward lives here (not inline) so userPoints + updateUserPointsUI are in scope.
    // Called from _renderRewardsList event delegation in tenant-subscriptions.js.
    async function redeemReward(btnElement, rewardName, cost, rewardId) {
        if (window._gamificationDisabled) return;
        if (userPoints < cost) {
            toast(`คะแนนไม่พอ — คุณมี ${userPoints} Pts ต้องใช้ ${cost} Pts`, 'error');
            window.GhHaptic?.warning();
            return;
        }
        const ok = await window.ghConfirm(
            `แลก "${rewardName}"? แต้มจะถูกหัก ${cost} Pts`,
            { title: 'ยืนยันการแลก', confirmLabel: 'แลก' }
        );
        if (!ok) return;
        window.GhHaptic?.tap();

        const prevPoints = userPoints;
        userPoints -= cost;
        updateUserPointsUI();
        btnElement.disabled = true;
        btnElement.innerText = 'กำลังบันทึก...';

        try {
            if (!rewardId) throw new Error('Missing rewardId — refresh page to load latest rewards');
            const fns = window.firebase?.functions;
            if (!fns) throw new Error('Firebase Functions SDK not loaded');
            const callable = fns.httpsCallable('redeemReward');
            const isPlayerRedeem = window._isPlayerMode && window._playerProfile?.tenantId;
            const payload = isPlayerRedeem
                ? { tenantId: window._playerProfile.tenantId, rewardId }
                : { building: _taBuilding, roomId: String(_taRoom), rewardId };
            const resp = await callable(payload);
            if (resp.data && typeof resp.data.pointsAfter === 'number') {
                userPoints = resp.data.pointsAfter;
                updateUserPointsUI();
            }
            btnElement.innerText = 'แลกแล้ว';
            btnElement.classList.remove('bg-[#2d8653]', 'active:scale-90');
            btnElement.classList.add('bg-gray-300', 'cursor-not-allowed');
            toast(`แลกสำเร็จ! คงเหลือ ${userPoints} Pts — ทีมงานจะดำเนินการให้`, 'success');
            window.GhHaptic?.success();
        } catch (e) {
            userPoints = prevPoints;
            updateUserPointsUI();
            btnElement.disabled = false;
            btnElement.innerText = 'แลกใหม่';
            console.error('redeemReward failed:', e);
            toast('แลกไม่สำเร็จ — กรุณาลองใหม่', 'error');
            window.GhHaptic?.error();
        }
    }

    window.loadGamificationData = loadGamificationData;
    window.updateUserPointsUI   = updateUserPointsUI;
    window.redeemReward         = redeemReward;
})();
