/**
 * dashboard-insights.js — Phase 1 Deep Analytics
 *
 * Three insights surfaced inside the category-tab dashboard:
 *   1. Wellness Engagement Matrix    → ชุมชน tab
 *   2. Daily Login Streak Leaderboard → ชุมชน tab
 *   3. Per-Tenant Payment Behavior   → การเงิน tab
 *
 * Lazy-init pattern: render fns are called from switchDashboardTab in
 * dashboard-main.js when the relevant tab is shown. Results cached for
 * 5 minutes to avoid re-querying on every tab toggle.
 *
 * Data sources (verified):
 *   - wellness_articles (Firestore master list)
 *   - collectionGroup('wellnessClaimed') — admin-only (rule deployed 2026-04-30)
 *   - tenants/{building}/list/{room}.gamification fields
 *   - RTDB bills/{building}/{room}/{billId} — admin/accountant read
 */
(function () {
  'use strict';

  // ===== 5-minute cache =====
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const _cache = {};
  function cacheGet(key) {
    const e = _cache[key];
    if (!e) return null;
    if (Date.now() - e.at > CACHE_TTL_MS) { delete _cache[key]; return null; }
    return e.data;
  }
  function cacheSet(key, data) { _cache[key] = { at: Date.now(), data }; }
  function cacheClear(key) { delete _cache[key]; }

  // ===== UI helpers =====
  function loadingHTML() {
    return `<div style="text-align:center;color:var(--text-muted);padding:2rem;font-size:.85rem;">
      <span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span>
      กำลังโหลด...
    </div>`;
  }
  function emptyHTML(msg) {
    return `<div style="text-align:center;color:var(--text-muted);padding:2rem;">
      <div style="font-size:2rem;opacity:.4;margin-bottom:.5rem;">📭</div>
      <div style="font-size:.85rem;">${msg}</div>
    </div>`;
  }
  function errorHTML(target, err) {
    const safe = String(err || 'unknown').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    return `<div style="text-align:center;padding:1.5rem;">
      <div style="color:var(--alert,#c06458);font-size:.88rem;margin-bottom:.4rem;">⚠️ โหลดข้อมูลไม่สำเร็จ</div>
      <div style="color:var(--text-muted);font-size:.72rem;margin-bottom:.6rem;">${safe}</div>
      <button data-action="refreshInsight" data-target="${target}"
              style="font-size:.78rem;padding:4px 12px;background:var(--green-pale);color:var(--green-dark);
                     border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
        ลองใหม่
      </button>
    </div>`;
  }
  function fmtCacheAge(at) {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'เพิ่งอัปเดต';
    return `อัปเดตล่าสุด: ${mins} นาทีที่แล้ว`;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  function buildingLabel(b) { return b === 'rooms' ? 'ห้องแถว' : b === 'nest' ? 'Nest' : b; }

  // ===== Tier classification =====
  function tierFromAvgDelta(d) {
    if (d == null || isNaN(d)) return { key: 'none', label: '—', color: 'var(--text-muted)', stars: 0 };
    if (d < -2) return { key: 'excellent', label: 'จ่ายเร็ว', color: 'var(--green)', stars: 4 };
    if (d <= 2) return { key: 'good',      label: 'ตรงเวลา', color: 'var(--blue)', stars: 3 };
    if (d <= 7) return { key: 'late',      label: 'ช้าเล็กน้อย', color: 'var(--accent,#ff9800)', stars: 2 };
    return { key: 'chronic', label: 'ช้าเรื้อรัง', color: 'var(--alert,#c06458)', stars: 1 };
  }
  function streakFire(days) {
    if (!days || days < 7) return '';
    if (days < 14) return '🔥';
    if (days < 30) return '🔥🔥';
    return '🔥🔥🔥';
  }

  // ===== Firestore tenant doc loader (shared) =====
  async function loadAllTenantDocs() {
    const cached = cacheGet('tenants_all');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs } = window.firebase.firestoreFunctions;
    const all = [];
    for (const building of ['rooms', 'nest']) {
      try {
        const snap = await getDocs(collection(db, `tenants/${building}/list`));
        snap.forEach(d => all.push({ building, roomId: d.id, ...d.data() }));
      } catch (e) {
        console.warn('[insights] failed to load tenants for', building, e);
      }
    }
    cacheSet('tenants_all', all);
    return all;
  }

  // ============================================================
  // FEATURE 1: Wellness Engagement Matrix
  // ============================================================
  async function renderWellnessMatrix() {
    const container = document.getElementById('dashWellnessMatrix');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
        throw new Error('Firebase ยังไม่พร้อม');
      }
      const db = window.firebase.firestore();
      const { collection, collectionGroup, getDocs, query } = window.firebase.firestoreFunctions;

      // Load articles + claims (parallel) + tenant total for occupancy denominator
      const [articleSnap, claimSnap, tenants] = await Promise.all([
        getDocs(collection(db, 'wellness_articles')),
        getDocs(query(collectionGroup(db, 'wellnessClaimed'))),
        loadAllTenantDocs()
      ]);

      // Master article map
      const articles = new Map();
      articleSnap.forEach(d => {
        const data = d.data() || {};
        articles.set(d.id, { id: d.id, title: data.title || '(ไม่ระบุชื่อ)', reward: Number(data.reward) || 0 });
      });

      // Aggregate claims
      const byArticle = new Map();
      const byRoom = new Map();
      let totalClaims = 0;
      claimSnap.forEach(c => {
        totalClaims++;
        const room = c.ref.parent.parent.id;
        // wellnessClaimed → list → {building} → tenants — parent.parent.parent.parent.id
        const building = c.ref.parent.parent.parent.parent.id;
        const articleId = c.id;
        const reward = Number(c.data().reward) || (articles.get(articleId)?.reward || 0);

        if (!byArticle.has(articleId)) byArticle.set(articleId, { rooms: new Set(), totalReward: 0 });
        byArticle.get(articleId).rooms.add(`${building}:${room}`);
        byArticle.get(articleId).totalReward += reward;

        const roomKey = `${building}:${room}`;
        if (!byRoom.has(roomKey)) byRoom.set(roomKey, 0);
        byRoom.set(roomKey, byRoom.get(roomKey) + 1);
      });

      // Active rooms = rooms with at least 1 claim
      const activeRooms = byRoom.size;
      const totalRooms = tenants.length;

      // Sort articles by read count
      const articleRows = [];
      articles.forEach((art, id) => {
        const stats = byArticle.get(id) || { rooms: new Set(), totalReward: 0 };
        articleRows.push({
          id, title: art.title, reward: art.reward,
          roomCount: stats.rooms.size, totalReward: stats.totalReward
        });
      });
      articleRows.sort((a, b) => b.roomCount - a.roomCount);

      // Top 3 active rooms
      const topRooms = Array.from(byRoom.entries())
        .map(([key, count]) => ({ key, count, room: key.split(':')[1] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Render
      const summary = `รวม <strong style="color:var(--green-dark);">${totalClaims}</strong> claims · <strong>${activeRooms}/${totalRooms}</strong> ห้อง active (${totalRooms ? Math.round(activeRooms / totalRooms * 100) : 0}%)`;

      let tableRows = '';
      if (articleRows.length === 0) {
        tableRows = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.2rem;">ยังไม่มีบทความ</td></tr>`;
      } else {
        articleRows.forEach(r => {
          const rate = totalRooms ? Math.round(r.roomCount / totalRooms * 100) : 0;
          const rateColor = rate >= 40 ? 'var(--green-dark)' : rate >= 20 ? 'var(--moss,#5a7a5a)' : 'var(--text-muted)';
          tableRows += `<tr data-action="showWellnessRooms" data-article="${esc(r.id)}" style="cursor:pointer;">
            <td style="padding:.5rem .7rem;">${esc(r.title)}</td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;">${r.roomCount} / ${totalRooms}</td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};font-weight:600;">${rate}%</td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;">${r.totalReward}</td>
          </tr>`;
        });
      }

      const topPills = topRooms.length === 0
        ? '<span style="color:var(--text-muted);">—</span>'
        : topRooms.map((r, i) => `<span style="display:inline-block;padding:2px 10px;margin-right:6px;background:var(--green-pale);color:var(--green-dark);border-radius:999px;font-size:.78rem;font-weight:600;">${['🥇','🥈','🥉'][i]} ${esc(r.room)} (${r.count})</span>`).join('');

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--green);">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📚 Wellness Engagement</span>
            <button data-action="refreshInsight" data-target="wellness" aria-label="รีเฟรช Wellness"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.7rem;">${summary}</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
              <thead>
                <tr style="background:var(--green-pale);color:var(--green-dark);">
                  <th style="padding:.55rem .7rem;text-align:left;font-weight:700;">บทความ</th>
                  <th style="padding:.55rem .7rem;text-align:right;font-weight:700;">ห้องอ่าน</th>
                  <th style="padding:.55rem .7rem;text-align:right;font-weight:700;">อัตรา</th>
                  <th style="padding:.55rem .7rem;text-align:right;font-weight:700;">รวมแต้ม</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--border-subtle,#ebe9e2);">
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem;">🏆 ผู้เช่ากระตือรือร้น</div>
            <div>${topPills}</div>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${fmtCacheAge(Date.now())}</div>
        </div>
      `;

      // Stash data for drill-down
      window._insightsCache = window._insightsCache || {};
      window._insightsCache.wellnessClaims = [];
      claimSnap.forEach(c => {
        window._insightsCache.wellnessClaims.push({
          articleId: c.id,
          building: c.ref.parent.parent.parent.parent.id,
          room: c.ref.parent.parent.id,
          claimedAt: c.data().claimedAt,
          reward: c.data().reward
        });
      });
      window._insightsCache.wellnessArticles = articles;
    } catch (e) {
      console.error('[insights] wellness matrix failed:', e);
      container.innerHTML = errorHTML('wellness', e.message);
    }
  }

  // ============================================================
  // FEATURE 2: Daily Login Streak Leaderboard
  // ============================================================
  async function renderStreakLeaderboard() {
    const container = document.getElementById('dashStreakLeaderboard');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      const tenants = await loadAllTenantDocs();

      // Bangkok TZ today as YYYY-MM-DD
      const todayBKK = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const sevenDaysAgoBKK = new Date(Date.now() + 7 * 3600000 - 7 * 86400000).toISOString().slice(0, 10);

      const rows = tenants
        .map(t => {
          const g = t.gamification || {};
          return {
            building: t.building,
            roomId: t.roomId,
            streak: Number(g.dailyStreak) || 0,
            lastClaim: g.lastDailyClaim || null,
            points: Number(g.points) || 0
          };
        })
        .filter(r => r.streak > 0 || r.lastClaim);

      rows.sort((a, b) => b.streak - a.streak);
      const top = rows.slice(0, 10);

      const todayCount = rows.filter(r => r.lastClaim === todayBKK).length;
      const inactive = rows.filter(r => r.lastClaim && r.lastClaim < sevenDaysAgoBKK);
      const totalRooms = tenants.length;
      const todayPct = totalRooms ? Math.round(todayCount / totalRooms * 100) : 0;

      let listHTML = '';
      if (top.length === 0) {
        listHTML = emptyHTML('ยังไม่มีผู้เช่าเริ่ม streak');
      } else {
        listHTML = '<ol style="list-style:none;padding:0;margin:0;">';
        top.forEach((r, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
          const fire = streakFire(r.streak);
          listHTML += `<li style="display:grid;grid-template-columns:30px 1fr 70px 60px;padding:.45rem .25rem;border-bottom:1px solid var(--border-subtle,#ebe9e2);align-items:center;font-size:.86rem;">
            <span>${medal}</span>
            <span style="font-weight:600;">${esc(r.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">(${buildingLabel(r.building)})</span></span>
            <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--green-dark);font-weight:600;">${r.streak} วัน</span>
            <span style="text-align:right;">${fire}</span>
          </li>`;
        });
        listHTML += '</ol>';
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--accent-gold,#D4AF37);">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>🔥 Streak Leaderboard</span>
            <button data-action="refreshInsight" data-target="streak" aria-label="รีเฟรช Streak"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          ${listHTML}
          <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--border-subtle,#ebe9e2);">
            <div style="font-size:.82rem;margin-bottom:.4rem;">
              📅 Today's logins:
              <strong style="color:var(--blue);">${todayCount} / ${totalRooms}</strong>
              <span style="color:var(--text-muted);font-size:.72rem;">(${todayPct}%)</span>
            </div>
            <div style="font-size:.82rem;">
              💤 Inactive >7d: <strong style="color:var(--alert,#c06458);">${inactive.length} ห้อง</strong>
              ${inactive.length > 0 ? '<button data-action="showInactiveRooms" style="margin-left:.4rem;font-size:.72rem;padding:1px 8px;background:transparent;border:none;color:var(--blue);cursor:pointer;text-decoration:underline;font-family:\'Sarabun\',sans-serif;" aria-label="ดูรายชื่อห้องที่ไม่ active">ดูรายชื่อ →</button>' : ''}
            </div>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${fmtCacheAge(Date.now())}</div>
        </div>
      `;

      window._insightsCache = window._insightsCache || {};
      window._insightsCache.inactiveRooms = inactive;
    } catch (e) {
      console.error('[insights] streak leaderboard failed:', e);
      container.innerHTML = errorHTML('streak', e.message);
    }
  }

  // ============================================================
  // FEATURE 3: Per-Tenant Payment Behavior
  // ============================================================
  let _pbState = { sortBy: 'avg_desc', buildingFilter: 'all' };

  async function renderPaymentBehavior() {
    const container = document.getElementById('dashPaymentBehavior');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      const cached = cacheGet('payment_behavior');
      let perRoom;
      if (cached) {
        perRoom = cached;
      } else {
        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet) {
          throw new Error('RTDB ยังไม่พร้อม');
        }
        const billsRef = window.firebaseRef(window.firebaseDatabase, 'bills');
        const snap = await window.firebaseGet(billsRef);
        const all = snap.val() || {};
        const cutoff = Date.now() - 180 * 86400000; // 6 months back
        perRoom = {};
        Object.entries(all).forEach(([building, rooms]) => {
          Object.entries(rooms || {}).forEach(([room, bills]) => {
            const key = `${building}:${room}`;
            perRoom[key] = perRoom[key] || { building, room, deltas: [], paidCount: 0 };
            Object.values(bills || {}).forEach(b => {
              if (!b || b.status !== 'paid' || !b.paidAt || !b.dueDate) return;
              if (b.paidAt < cutoff) return;
              const due = new Date(b.dueDate).getTime();
              if (!isFinite(due)) return;
              const delta = (b.paidAt - due) / 86400000;
              perRoom[key].deltas.push(delta);
              perRoom[key].paidCount++;
            });
          });
        });
        cacheSet('payment_behavior', perRoom);
      }

      // Compute aggregates
      const list = Object.values(perRoom).filter(r => r.deltas.length > 0).map(r => {
        const avg = r.deltas.reduce((s, d) => s + d, 0) / r.deltas.length;
        const tier = tierFromAvgDelta(avg);
        return { ...r, avg, tier };
      });

      // Apply filter
      let filtered = list;
      if (_pbState.buildingFilter !== 'all') {
        filtered = list.filter(r => r.building === _pbState.buildingFilter);
      }
      // Apply sort
      filtered.sort((a, b) => {
        if (_pbState.sortBy === 'avg_desc') return b.avg - a.avg;
        if (_pbState.sortBy === 'avg_asc') return a.avg - b.avg;
        if (_pbState.sortBy === 'count_desc') return b.paidCount - a.paidCount;
        return 0;
      });

      let tableRows = '';
      if (filtered.length === 0) {
        tableRows = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.2rem;">ยังไม่มีบิลที่ชำระในช่วง 6 เดือน</td></tr>`;
      } else {
        filtered.forEach(r => {
          const sign = r.avg < 0 ? '−' : r.avg > 0 ? '+' : '';
          const avgStr = `${sign}${Math.abs(r.avg).toFixed(1)} วัน`;
          // Bar viz: 6 boxes (or paidCount up to 6)
          const boxCount = Math.min(r.paidCount, 6);
          let bars = '<div style="display:inline-flex;gap:2px;vertical-align:middle;">';
          for (let i = 0; i < 6; i++) {
            const bg = i < boxCount ? r.tier.color : 'var(--mist,#f2f1ec)';
            bars += `<div style="width:10px;height:14px;background:${bg};border-radius:2px;"></div>`;
          }
          bars += '</div>';
          const stars = '⭐'.repeat(r.tier.stars) + (r.tier.stars > 0 ? '' : '—');
          tableRows += `<tr style="border-left:3px solid ${r.tier.color};">
            <td style="padding:.5rem .7rem;font-weight:600;">${esc(r.room)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">(${buildingLabel(r.building)})</span></td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${r.tier.color};font-weight:600;">${avgStr}</td>
            <td style="padding:.5rem .7rem;">${bars} <span style="color:var(--text-muted);font-size:.72rem;margin-left:6px;">${r.paidCount}/6</span></td>
            <td style="padding:.5rem .7rem;text-align:center;">${stars}</td>
            <td style="padding:.5rem .7rem;color:${r.tier.color};font-size:.78rem;font-weight:600;">${r.tier.label}</td>
          </tr>`;
        });
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--green);">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>💳 พฤติกรรมการชำระเงิน (6 เดือนล่าสุด)</span>
            <button data-action="refreshInsight" data-target="payment" aria-label="รีเฟรช Payment Behavior"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="display:flex;gap:.5rem;margin-bottom:.7rem;flex-wrap:wrap;align-items:center;">
            <span style="font-size:.78rem;color:var(--text-muted);">เรียง:</span>
            <select data-action="setPBSort" style="padding:4px 10px;border-radius:999px;border:1.5px solid var(--border-base,#dcdbd4);background:#fff;font-family:'Sarabun',sans-serif;font-size:.78rem;cursor:pointer;">
              <option value="avg_desc" ${_pbState.sortBy==='avg_desc'?'selected':''}>จ่ายช้าสุด ▼</option>
              <option value="avg_asc" ${_pbState.sortBy==='avg_asc'?'selected':''}>จ่ายเร็วสุด ▼</option>
              <option value="count_desc" ${_pbState.sortBy==='count_desc'?'selected':''}>บิลมากสุด ▼</option>
            </select>
            <span style="font-size:.78rem;color:var(--text-muted);">ตึก:</span>
            <select data-action="setPBBuilding" style="padding:4px 10px;border-radius:999px;border:1.5px solid var(--border-base,#dcdbd4);background:#fff;font-family:'Sarabun',sans-serif;font-size:.78rem;cursor:pointer;">
              <option value="all" ${_pbState.buildingFilter==='all'?'selected':''}>ทั้งหมด</option>
              <option value="rooms" ${_pbState.buildingFilter==='rooms'?'selected':''}>🏠 ห้องแถว</option>
              <option value="nest" ${_pbState.buildingFilter==='nest'?'selected':''}>🏢 Nest</option>
            </select>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
              <thead>
                <tr style="background:var(--green-pale);color:var(--green-dark);">
                  <th style="padding:.55rem .7rem;text-align:left;font-weight:700;">ห้อง</th>
                  <th style="padding:.55rem .7rem;text-align:right;font-weight:700;">เฉลี่ย</th>
                  <th style="padding:.55rem .7rem;text-align:left;font-weight:700;">ประวัติ</th>
                  <th style="padding:.55rem .7rem;text-align:center;font-weight:700;">Tier</th>
                  <th style="padding:.55rem .7rem;text-align:left;font-weight:700;">สถานะ</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${fmtCacheAge(Date.now())}</div>
        </div>
      `;
    } catch (e) {
      console.error('[insights] payment behavior failed:', e);
      container.innerHTML = errorHTML('payment', e.message);
    }
  }

  // ============================================================
  // Drill-down modals
  // ============================================================
  function openModal(title, bodyHTML) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.id = '_insightsModal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(31,31,28,.55);z-index:1500;display:flex;align-items:center;justify-content:center;padding:20px;';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:1.5rem;font-family:'Sarabun',sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <strong style="font-size:1rem;color:var(--green-dark);">${esc(title)}</strong>
          <button data-action="closeInsightsModal" aria-label="ปิด"
                  style="background:transparent;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div>${bodyHTML}</div>
      </div>
    `;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
  }
  function closeModal() {
    const m = document.getElementById('_insightsModal');
    if (m) m.remove();
  }

  function showWellnessRoomsModal(articleId) {
    const cache = window._insightsCache || {};
    const claims = (cache.wellnessClaims || []).filter(c => c.articleId === articleId);
    const article = cache.wellnessArticles?.get(articleId);
    if (claims.length === 0) {
      openModal(article?.title || 'บทความ', emptyHTML('ยังไม่มีห้องไหนกดรับ'));
      return;
    }
    claims.sort((a, b) => String(b.claimedAt || '').localeCompare(String(a.claimedAt || '')));
    const rows = claims.map(c => {
      const dt = c.claimedAt ? new Date(c.claimedAt) : null;
      const dateStr = dt && !isNaN(dt) ? dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
      return `<li style="display:flex;justify-content:space-between;padding:.5rem .25rem;border-bottom:1px solid var(--border-subtle,#ebe9e2);">
        <span><strong>${esc(c.room)}</strong> <span style="color:var(--text-muted);font-size:.78rem;">(${buildingLabel(c.building)})</span></span>
        <span style="color:var(--text-muted);font-size:.82rem;">${esc(dateStr)}</span>
      </li>`;
    }).join('');
    openModal(`📚 ${article?.title || 'บทความ'} — ${claims.length} ห้อง`,
      `<ul style="list-style:none;padding:0;margin:0;">${rows}</ul>`);
  }

  function showHealthDetailModal(key) {
    const r = window._insightsCache?.healthRecords?.[key];
    if (!r) { openModal('Health Detail', emptyHTML('ไม่พบข้อมูลห้องนี้')); return; }
    const sub = (label, value, max, color) => {
      const pct = max ? Math.round(value / max * 100) : 0;
      return `<div style="margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.2rem;">
          <span>${label}</span>
          <span style="font-variant-numeric:tabular-nums;color:${color};font-weight:600;">${value}/${max}</span>
        </div>
        <div style="height:8px;background:var(--mist,#f2f1ec);border-radius:4px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};"></div>
        </div>
      </div>`;
    };
    const fmtDate = d => d ? new Date(d).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }) : '—';
    const body = `
      <div style="margin-bottom:1rem;padding:.7rem 1rem;background:var(--green-pale);border-radius:12px;text-align:center;">
        <div style="font-size:2rem;font-weight:700;color:${r.tier.color};font-variant-numeric:tabular-nums;">${r.score.total}<span style="font-size:1rem;color:var(--text-muted);font-weight:400;">/100</span></div>
        <div style="color:${r.tier.color};font-weight:600;">${r.tier.emoji} ${r.tier.label}</div>
      </div>
      <div style="margin-bottom:1rem;">
        ${sub('💳 ชำระเงิน',  r.score.payment,    25, 'var(--green)')}
        ${sub('🔥 กิจกรรม',   r.score.engagement, 25, 'var(--accent-gold,#D4AF37)')}
        ${sub('⚠️ ปัญหา/ร้องเรียน', r.score.issues, 25, 'var(--blue)')}
        ${sub('📅 ระยะเวลาเช่า', r.score.tenure,   25, 'var(--moss,#5a7a5a)')}
      </div>
      <div style="font-size:.82rem;color:var(--text-muted);border-top:1px dashed var(--border-subtle,#ebe9e2);padding-top:.7rem;">
        <div style="margin-bottom:.3rem;">📅 เริ่มเช่า: <strong style="color:var(--ink,#1f1f1c);">${esc(fmtDate(r.startDate))}</strong>${r.monthsTenure!=null?` <span style="color:var(--text-muted);">(${r.monthsTenure} เดือน)</span>`:''}</div>
        ${r.endDate ? `<div style="margin-bottom:.3rem;">📅 หมดสัญญา: <strong style="color:var(--ink);">${esc(fmtDate(r.endDate))}</strong>${r.daysToEnd!=null?` <span style="color:${r.daysToEnd<=90?'var(--alert,#c06458)':'var(--text-muted)'};">(${r.daysToEnd>=0?`อีก ${r.daysToEnd} วัน`:`เลย ${-r.daysToEnd} วัน`})</span>`:''}</div>` : ''}
        <div style="margin-bottom:.3rem;">💳 เฉลี่ยจ่าย: <strong style="color:var(--ink);">${r.paymentDelta!=null?(r.paymentDelta>=0?'+':'')+r.paymentDelta.toFixed(1)+' วัน':'—'}</strong> (ค้าง ${r.paymentLateCount} ครั้ง)</div>
        <div style="margin-bottom:.3rem;">🔥 Streak: <strong style="color:var(--ink);">${r.streak} วัน</strong>${r.lastClaim?` <span style="color:var(--text-muted);">(last: ${esc(r.lastClaim)})</span>`:''}</div>
        <div>⚠️ Complaints (90d): <strong style="color:var(--ink);">${r.complaintCount} ครั้ง</strong></div>
      </div>
    `;
    openModal(`🩺 ${esc(r.roomId)} (${buildingLabel(r.building)}) ${r.tenantName?'· '+esc(r.tenantName):''}`, body);
  }

  function showInactiveRoomsModal() {
    const inactive = window._insightsCache?.inactiveRooms || [];
    if (inactive.length === 0) {
      openModal('💤 Inactive Rooms', emptyHTML('ทุกห้องยัง active ใน 7 วัน'));
      return;
    }
    inactive.sort((a, b) => (a.lastClaim || '').localeCompare(b.lastClaim || ''));
    const rows = inactive.map(r => `<li style="display:flex;justify-content:space-between;padding:.5rem .25rem;border-bottom:1px solid var(--border-subtle,#ebe9e2);">
      <span><strong>${esc(r.roomId)}</strong> <span style="color:var(--text-muted);font-size:.78rem;">(${buildingLabel(r.building)})</span></span>
      <span style="color:var(--alert,#c06458);font-size:.82rem;">last: ${esc(r.lastClaim || '—')}</span>
    </li>`).join('');
    openModal(`💤 Inactive >7 days — ${inactive.length} ห้อง`,
      `<ul style="list-style:none;padding:0;margin:0;">${rows}</ul>`);
  }

  // ============================================================
  // PHASE 2: Tenant Health Score + Churn Risk shared compute
  // ============================================================

  // Compute composite 0-100 health score for a single tenant
  // Inputs: paymentDelta (avg days from due, null if no history), gamification, complaintCount90d, monthsTenure
  function computeHealthScore({ paymentDelta, streak, complaintCount90d, monthsTenure }) {
    // Payment sub-score (25 pts max)
    let payment;
    if (paymentDelta == null) payment = 15;       // neutral when no data
    else if (paymentDelta < -2) payment = 25;
    else if (paymentDelta <= 2) payment = 20;
    else if (paymentDelta <= 7) payment = 12;
    else payment = 5;

    // Engagement sub-score (25 pts max)
    let engagement;
    if (!streak || streak <= 0) engagement = 0;
    else if (streak < 7) engagement = 5;
    else if (streak < 14) engagement = 10;
    else if (streak < 30) engagement = 18;
    else engagement = 25;

    // Issues sub-score (25 pts max — inverse of complaint count last 90d)
    let issues;
    if (complaintCount90d === 0) issues = 25;
    else if (complaintCount90d === 1) issues = 18;
    else if (complaintCount90d === 2) issues = 12;
    else issues = 5;

    // Tenure sub-score (25 pts max)
    let tenure;
    if (monthsTenure == null) tenure = 12;       // neutral when unknown
    else if (monthsTenure <= 3) tenure = 8;
    else if (monthsTenure <= 6) tenure = 14;
    else if (monthsTenure <= 12) tenure = 20;
    else tenure = 25;

    const total = payment + engagement + issues + tenure;
    return { total, payment, engagement, issues, tenure };
  }

  function healthTier(total) {
    if (total >= 80) return { key: 'healthy',  emoji: '🟢', label: 'Healthy', color: 'var(--green)' };
    if (total >= 60) return { key: 'steady',   emoji: '🟡', label: 'Steady',  color: 'var(--blue)' };
    if (total >= 40) return { key: 'at-risk',  emoji: '🟠', label: 'At Risk', color: 'var(--accent,#ff9800)' };
    return                  { key: 'critical', emoji: '🔴', label: 'Critical',color: 'var(--alert,#c06458)' };
  }

  // Months between a date string/Date and now
  function monthsSince(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const ms = Date.now() - d.getTime();
    return Math.floor(ms / (30 * 86400000));
  }

  // Days until a date string/Date (negative if past)
  function daysUntil(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return Math.floor((d.getTime() - Date.now()) / 86400000);
  }

  // Aggregate complaints per room from flat 'complaints' collection
  async function loadComplaintCounts() {
    const cached = cacheGet('complaints_90d');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firestore ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs } = window.firebase.firestoreFunctions;
    const snap = await getDocs(collection(db, 'complaints'));
    const cutoff = Date.now() - 90 * 86400000;
    const byRoom = {};
    snap.forEach(d => {
      const data = d.data() || {};
      const ts = data.createdAt?.toMillis ? data.createdAt.toMillis()
               : data.createdAt ? new Date(data.createdAt).getTime()
               : data.timestamp ? new Date(data.timestamp).getTime()
               : null;
      if (ts == null || ts < cutoff) return;
      const building = data.building;
      const room = data.room;
      if (!building || !room) return;
      const key = `${building}:${room}`;
      byRoom[key] = (byRoom[key] || 0) + 1;
    });
    cacheSet('complaints_90d', byRoom);
    return byRoom;
  }

  // Load + cache payment-delta (reuses RTDB bills query from F3)
  async function loadPaymentDeltas() {
    const cached = cacheGet('payment_deltas');
    if (cached) return cached;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet) {
      throw new Error('RTDB ยังไม่พร้อม');
    }
    const billsRef = window.firebaseRef(window.firebaseDatabase, 'bills');
    const snap = await window.firebaseGet(billsRef);
    const all = snap.val() || {};
    const cutoff = Date.now() - 180 * 86400000;
    const byRoom = {};
    Object.entries(all).forEach(([building, rooms]) => {
      Object.entries(rooms || {}).forEach(([room, bills]) => {
        const key = `${building}:${room}`;
        const deltas = [];
        let lastLate = false;
        let lateCount = 0;
        Object.values(bills || {}).forEach(b => {
          if (!b || b.status !== 'paid' || !b.paidAt || !b.dueDate) return;
          if (b.paidAt < cutoff) return;
          const due = new Date(b.dueDate).getTime();
          if (!isFinite(due)) return;
          const delta = (b.paidAt - due) / 86400000;
          deltas.push(delta);
          if (delta > 2) lateCount++;
        });
        if (deltas.length > 0) {
          const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
          byRoom[key] = { avg, count: deltas.length, lateCount };
        }
      });
    });
    cacheSet('payment_deltas', byRoom);
    return byRoom;
  }

  // Build per-room health record list (used by both Health Score table + Churn Risk)
  async function buildHealthRecords() {
    const [tenants, paymentDeltas, complaints] = await Promise.all([
      loadAllTenantDocs(),
      loadPaymentDeltas().catch(e => { console.warn('[insights] payment deltas load failed:', e); return {}; }),
      loadComplaintCounts().catch(e => { console.warn('[insights] complaints load failed:', e); return {}; })
    ]);

    return tenants.map(t => {
      const key = `${t.building}:${t.roomId}`;
      const g = t.gamification || {};
      const lease = t.lease || {};
      const startDate = lease.startDate || lease.moveInDate || t.moveInDate || null;
      const endDate = lease.endDate || lease.moveOutDate || null;
      const monthsTenure = monthsSince(startDate);
      const daysToEnd = daysUntil(endDate);
      const pd = paymentDeltas[key] || null;

      const inputs = {
        paymentDelta: pd ? pd.avg : null,
        streak: Number(g.dailyStreak) || 0,
        complaintCount90d: complaints[key] || 0,
        monthsTenure
      };
      const score = computeHealthScore(inputs);
      const tier = healthTier(score.total);

      return {
        building: t.building,
        roomId: t.roomId,
        tenantName: t.name || lease.tenantName || '',
        startDate, endDate, monthsTenure, daysToEnd,
        streak: inputs.streak,
        lastClaim: g.lastDailyClaim || null,
        paymentDelta: inputs.paymentDelta,
        paymentLateCount: pd ? pd.lateCount : 0,
        complaintCount: inputs.complaintCount90d,
        score, tier
      };
    });
  }

  // ============================================================
  // FEATURE 4+5: Tenant Health Score + Churn Risk (combined card)
  // ============================================================
  let _hsState = { tierFilter: 'all', sortBy: 'score_asc' };

  async function renderTenantInsights() {
    const container = document.getElementById('dashTenantInsights');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      const records = await buildHealthRecords();

      // Stash for drill-down modal
      window._insightsCache = window._insightsCache || {};
      window._insightsCache.healthRecords = {};
      records.forEach(r => { window._insightsCache.healthRecords[`${r.building}:${r.roomId}`] = r; });

      // Annotate every record with churn flags (used for count + tile display)
      const todayBKK = new Date(Date.now() + 7*3600000).toISOString().slice(0,10);
      const annotated = records.map(r => {
        const flags = [];
        let recommend = null;
        if (r.daysToEnd != null && r.daysToEnd >= 0 && r.daysToEnd <= 90) {
          flags.push(`สัญญาเหลือ ${r.daysToEnd} วัน`);
          recommend = 'ติดต่อต่อสัญญา';
        }
        if (r.score.total < 60) flags.push(`Health ${r.score.total}/100`);
        if (r.paymentLateCount >= 3) {
          flags.push(`ค้างชำระ ${r.paymentLateCount} ครั้ง`);
          if (!recommend) recommend = 'ติดตามค่าเช่า';
        }
        if (r.complaintCount >= 2) {
          flags.push(`Complaints ${r.complaintCount} ครั้ง (90d)`);
          if (!recommend) recommend = 'ติดต่อสอบถาม';
        }
        const inactiveDays = r.lastClaim
          ? Math.floor((new Date(todayBKK) - new Date(r.lastClaim)) / 86400000)
          : null;
        if (inactiveDays != null && inactiveDays >= 14) {
          flags.push(`ไม่ active ${inactiveDays} วัน`);
          if (!recommend) recommend = 'ส่งข้อความ check-in';
        }
        return { ...r, flags, recommend };
      });

      const churnCount = annotated.filter(r => r.flags.length > 0).length;

      // Filter + sort for display
      let rows = annotated;
      if (_hsState.tierFilter !== 'all') rows = annotated.filter(r => r.tier.key === _hsState.tierFilter);
      rows.sort((a, b) => {
        const order = { critical: 0, 'at-risk': 1, steady: 2, healthy: 3 };
        if ((order[a.tier.key] ?? 99) !== (order[b.tier.key] ?? 99))
          return (order[a.tier.key] ?? 99) - (order[b.tier.key] ?? 99);
        return a.score.total - b.score.total;
      });

      // Distribution for filter chips
      const dist = { healthy: 0, steady: 0, 'at-risk': 0, critical: 0 };
      annotated.forEach(r => { dist[r.tier.key]++; });

      const chipStyle = (active, color) =>
        `display:inline-block;padding:4px 12px;margin-right:6px;margin-bottom:4px;background:${active ? color : '#fff'};border:1.5px solid ${color};color:${active ? '#fff' : color};border-radius:999px;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit;`;
      const f = _hsState.tierFilter;
      const chips = `
        <button data-action="setHSFilter" data-tier="all" style="${chipStyle(f === 'all', 'var(--text-muted)')}">ทั้งหมด (${annotated.length})</button>
        <button data-action="setHSFilter" data-tier="healthy" style="${chipStyle(f === 'healthy', 'var(--green)')}">🟢 ${dist.healthy}</button>
        <button data-action="setHSFilter" data-tier="steady" style="${chipStyle(f === 'steady', 'var(--blue)')}">🟡 ${dist.steady}</button>
        <button data-action="setHSFilter" data-tier="at-risk" style="${chipStyle(f === 'at-risk', 'var(--accent,#ff9800)')}">🟠 ${dist['at-risk']}</button>
        <button data-action="setHSFilter" data-tier="critical" style="${chipStyle(f === 'critical', 'var(--alert,#c06458)')}">🔴 ${dist.critical}</button>
      `;

      const tilesHTML = rows.length === 0
        ? `<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.85rem;grid-column:1/-1;">ไม่มีห้องในกลุ่มนี้</div>`
        : rows.map(r => `
          <div data-action="showHealthDetail" data-key="${esc(r.building)}:${esc(r.roomId)}"
               style="cursor:pointer;background:#fff;border:1px solid var(--border-subtle,#ebe9e2);border-left:4px solid ${r.tier.color};border-radius:10px;padding:.7rem .8rem;transition:transform .1s,box-shadow .1s;"
               onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 2px 8px rgba(31,31,28,.08)';"
               onmouseout="this.style.transform='';this.style.boxShadow='';">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.2rem;">
              <span style="font-weight:700;font-size:.92rem;">${esc(r.roomId)} <span style="color:var(--text-muted);font-size:.7rem;font-weight:400;">${buildingLabel(r.building)}</span></span>
              <span style="font-variant-numeric:tabular-nums;color:${r.tier.color};font-weight:700;font-size:1.1rem;">${r.score.total}<span style="font-size:.7rem;color:var(--text-muted);font-weight:400;">/100</span></span>
            </div>
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.tenantName || '—')}</div>
            <div style="height:5px;background:var(--mist,#f2f1ec);border-radius:3px;overflow:hidden;margin-bottom:.3rem;">
              <div style="width:${r.score.total}%;height:100%;background:${r.tier.color};"></div>
            </div>
            <div style="font-size:.72rem;color:${r.tier.color};font-weight:600;margin-bottom:${r.flags.length ? '.4rem' : '0'};">${r.tier.emoji} ${r.tier.label}</div>
            ${r.flags.length ? `
            <div style="border-top:1px dashed var(--border-subtle,#ebe9e2);padding-top:.35rem;">
              <div style="font-size:.68rem;color:var(--text-muted);line-height:1.4;" title="${esc(r.flags.join(' · '))}">⚠️ ${esc(r.flags[0])}${r.flags.length > 1 ? ` <span style="color:var(--alert,#c06458);">+${r.flags.length - 1}</span>` : ''}</div>
              ${r.recommend ? `<div style="font-size:.68rem;color:var(--green-dark);font-weight:600;margin-top:.2rem;">💡 ${esc(r.recommend)}</div>` : ''}
            </div>` : ''}
          </div>`).join('');

      const statusLine = churnCount === 0
        ? `<span style="color:var(--green-dark);">✅ ทุกห้องอยู่ในเกณฑ์ปกติ</span>`
        : `<span style="color:var(--alert,#c06458);">⚠️ ${churnCount} ห้องต้องการความสนใจ</span>`;

      container.innerHTML = `
        <div class="card">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>👥 Tenant Health</span>
            <button data-action="refreshInsight" data-target="tenant" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem;">
            คะแนน 0–100 จาก: ชำระเงิน · กิจกรรม · ร้องเรียน · ระยะเวลาเช่า &nbsp;·&nbsp; ${statusLine} &nbsp;·&nbsp; คลิกเพื่อดูรายละเอียด
          </div>
          <div style="margin-bottom:.8rem;">${chips}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.5rem;align-items:start;">${tilesHTML}</div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${fmtCacheAge(Date.now())}</div>
        </div>
      `;
    } catch (e) {
      console.error('[insights] tenant insights failed:', e);
      container.innerHTML = errorHTML('tenant', e.message);
    }
  }

  // ============================================================
  // FEATURE 6: Overdue Bills (การเงิน tab)
  // ============================================================
  async function loadAllBillsRaw() {
    const cached = cacheGet('bills_raw');
    if (cached) return cached;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet)
      throw new Error('RTDB ยังไม่พร้อม');
    const snap = await window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'bills'));
    const data = snap.val() || {};
    cacheSet('bills_raw', data);
    return data;
  }

  async function renderOverdueBills() {
    const container = document.getElementById('dashOverdueBills');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      const all = await loadAllBillsRaw();
      const todayStr = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

      // Aggregate overdue bills by room (sum all unpaid overdue bills per room)
      const byRoom = {};
      Object.entries(all).forEach(([building, rooms]) => {
        Object.entries(rooms || {}).forEach(([room, bills]) => {
          Object.values(bills || {}).forEach(b => {
            if (!b || b.status === 'paid' || !b.dueDate || !b.total) return;
            if (b.dueDate >= todayStr) return;
            const key = `${building}:${room}`;
            if (!byRoom[key]) byRoom[key] = { building, room, totalOwed: 0, oldestDue: b.dueDate, count: 0 };
            byRoom[key].totalOwed += (Number(b.total) || 0);
            byRoom[key].count++;
            if (b.dueDate < byRoom[key].oldestDue) byRoom[key].oldestDue = b.dueDate;
          });
        });
      });

      const rows = Object.values(byRoom)
        .map(r => ({ ...r, daysOverdue: Math.floor((Date.now() - new Date(r.oldestDue).getTime()) / 86400000) }))
        .filter(r => r.daysOverdue > 0)
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);

      let bodyHTML;
      if (rows.length === 0) {
        bodyHTML = `<div style="color:var(--green-dark);font-size:.9rem;padding:.4rem 0;">✅ ไม่มีบิลค้างชำระ</div>`;
      } else {
        const tileColor = r => r.daysOverdue > 14 ? 'var(--alert,#c06458)' : r.daysOverdue > 7 ? 'var(--accent,#ff9800)' : 'var(--blue)';
        bodyHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.5rem;margin-bottom:.7rem;">
            ${rows.map(r => `
              <div style="background:#fff;border:1px solid var(--border-subtle,#ebe9e2);border-left:4px solid ${tileColor(r)};border-radius:10px;padding:.65rem .75rem;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.15rem;">
                  <span style="font-weight:700;font-size:.9rem;">${esc(r.room)} <span style="color:var(--text-muted);font-size:.68rem;font-weight:400;">${buildingLabel(r.building)}</span></span>
                  <span style="color:${tileColor(r)};font-weight:700;font-size:.88rem;font-variant-numeric:tabular-nums;">฿${r.totalOwed.toLocaleString()}</span>
                </div>
                <div style="font-size:.7rem;color:${tileColor(r)};font-weight:600;">เกิน ${r.daysOverdue} วัน${r.count > 1 ? ` · ${r.count} บิล` : ''}</div>
                <div style="font-size:.68rem;color:var(--text-muted);">due: ${r.oldestDue}</div>
              </div>`).join('')}
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);">
            รวม <strong style="color:var(--alert,#c06458);">${rows.length} ห้อง</strong> ·
            ยอดค้างรวม <strong style="color:var(--alert,#c06458);">฿${totalOwed.toLocaleString()}</strong>
          </div>`;
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--alert,#c06458);">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📌 ค่าเช่าค้างชำระ</span>
            <button data-action="refreshInsight" data-target="overdue" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem;">บิลที่เลยกำหนดชำระและยังไม่ได้ชำระ · คำนวณจากวันนี้ (BKK)</div>
          ${bodyHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${fmtCacheAge(Date.now())}</div>
        </div>`;
    } catch (e) {
      console.error('[insights] overdue bills failed:', e);
      container.innerHTML = errorHTML('overdue', e.message);
    }
  }

  // ============================================================
  // FEATURE 7: Operations Summary (ปฏิบัติการ tab)
  // ============================================================
  async function renderOperationsInsights() {
    const container = document.getElementById('dashOperationsInsights');
    if (!container) return;
    container.innerHTML = loadingHTML();
    try {
      if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions)
        throw new Error('Firestore ยังไม่พร้อม');
      const db = window.firebase.firestore();
      const { collection, getDocs } = window.firebase.firestoreFunctions;

      const [complaintsSnap, maintSnap] = await Promise.all([
        getDocs(collection(db, 'complaints')),
        window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'maintenance'))
          .catch(() => ({ val: () => ({}) }))
      ]);

      // Complaints — last 90 days
      const cutoff90 = Date.now() - 90 * 86400000;
      const cStatus = { open: 0, 'in-progress': 0, resolved: 0 };
      const cByCategory = {};
      const resolveTimes = [];

      complaintsSnap.forEach(d => {
        const data = d.data() || {};
        const ts = data.createdAt ? new Date(data.createdAt).getTime() : null;
        if (ts && ts < cutoff90) return;
        const s = data.status || 'open';
        cStatus[s] = (cStatus[s] !== undefined ? cStatus[s] : 0) + 1;
        cByCategory[data.category || 'other'] = (cByCategory[data.category || 'other'] || 0) + 1;
        if (s === 'resolved' && data.createdAt && data.updatedAt) {
          const days = (new Date(data.updatedAt) - new Date(data.createdAt)) / 86400000;
          if (days >= 0 && days < 365) resolveTimes.push(days);
        }
      });

      const totalComplaints = Object.values(cStatus).reduce((s, v) => s + v, 0);
      const avgResolve = resolveTimes.length
        ? (resolveTimes.reduce((s, v) => s + v, 0) / resolveTimes.length).toFixed(1)
        : null;
      const topCats = Object.entries(cByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);

      // Maintenance (RTDB)
      const maintAll = maintSnap.val() || {};
      const overdueThreshold = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const mStatus = { pending: 0, inprogress: 0, done: 0 };
      const mOverdue = [];

      Object.entries(maintAll).forEach(([building, rooms]) => {
        Object.entries(rooms || {}).forEach(([room, items]) => {
          Object.values(items || {}).forEach(item => {
            if (!item) return;
            const s = item.status || 'pending';
            if (s === 'pending') mStatus.pending++;
            else if (s === 'inprogress') mStatus.inprogress++;
            else if (s === 'done') mStatus.done++;
            else mStatus.pending++;
            if ((s === 'pending' || s === 'inprogress') && item.reportedAt && item.reportedAt < overdueThreshold) {
              mOverdue.push({ building, room, reportedAt: item.reportedAt });
            }
          });
        });
      });

      const totalMaint = mStatus.pending + mStatus.inprogress + mStatus.done;

      // Build UI pieces
      const pill = (label, count, color) => count === 0 ? '' :
        `<span style="display:inline-block;padding:3px 10px;margin:2px 4px 2px 0;background:${color}22;border:1.5px solid ${color};color:${color};border-radius:999px;font-size:.75rem;font-weight:600;">${label} ${count}</span>`;

      const cStatusHTML = [
        pill('open', cStatus.open, 'var(--alert,#c06458)'),
        pill('กำลังดำเนินการ', cStatus['in-progress'], 'var(--accent,#ff9800)'),
        pill('resolved', cStatus.resolved, 'var(--green)'),
      ].join('') || `<span style="font-size:.8rem;color:var(--text-muted);">ยังไม่มีข้อมูล (90 วัน)</span>`;

      const mStatusHTML = [
        pill('pending', mStatus.pending, 'var(--alert,#c06458)'),
        pill('กำลังดำเนินการ', mStatus.inprogress, 'var(--accent,#ff9800)'),
        pill('เสร็จแล้ว', mStatus.done, 'var(--green)'),
      ].join('') || `<span style="font-size:.8rem;color:var(--text-muted);">ยังไม่มีข้อมูล</span>`;

      const catChipsHTML = topCats.map(([cat, count]) =>
        `<span style="display:inline-block;padding:2px 9px;margin:2px;background:var(--mist,#f2f1ec);border-radius:999px;font-size:.73rem;color:var(--ink);">${esc(cat)} <strong>${count}</strong></span>`
      ).join('');

      const mOverdueHTML = mOverdue.length === 0
        ? `<span style="color:var(--green-dark);font-size:.78rem;">✅ ไม่มีงานค้าง</span>`
        : mOverdue.slice(0, 8).map(m =>
            `<span style="display:inline-block;padding:2px 8px;margin:2px;background:#fce4ec;border-radius:999px;font-size:.7rem;color:var(--alert,#c06458);">ห้อง ${esc(m.room)} ${buildingLabel(m.building)}</span>`
          ).join('') + (mOverdue.length > 8 ? ` <span style="font-size:.7rem;color:var(--alert,#c06458);">+${mOverdue.length - 8}</span>` : '');

      container.innerHTML = `
        <div class="card">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📋 Operations Summary</span>
            <button data-action="refreshInsight" data-target="operations" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>

          <div style="margin-bottom:1rem;">
            <div style="font-size:.8rem;font-weight:700;color:var(--ink);margin-bottom:.45rem;">
              ⚠️ Complaints (90 วัน) · <span style="font-weight:400;">${totalComplaints} เรื่อง${avgResolve ? ` · เฉลี่ยแก้ไข ${avgResolve} วัน` : ''}</span>
            </div>
            <div style="margin-bottom:.5rem;">${cStatusHTML}</div>
            ${topCats.length ? `<div style="font-size:.73rem;color:var(--text-muted);margin-bottom:.25rem;">หมวดหมู่:</div><div>${catChipsHTML}</div>` : ''}
          </div>

          <div style="border-top:1px solid var(--border-subtle,#ebe9e2);padding-top:.8rem;">
            <div style="font-size:.8rem;font-weight:700;color:var(--ink);margin-bottom:.45rem;">
              🔧 Maintenance · <span style="font-weight:400;">${totalMaint} รายการ${mOverdue.length ? ` · <span style="color:var(--alert,#c06458);">⏰ ค้าง ${mOverdue.length} รายการ</span>` : ''}</span>
            </div>
            <div style="margin-bottom:.5rem;">${mStatusHTML}</div>
            <div style="font-size:.73rem;color:var(--text-muted);margin-bottom:.3rem;">ค้างเกิน 7 วัน:</div>
            <div>${mOverdueHTML}</div>
          </div>

          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${fmtCacheAge(Date.now())}</div>
        </div>`;
    } catch (e) {
      console.error('[insights] operations failed:', e);
      container.innerHTML = errorHTML('operations', e.message);
    }
  }

  // ============================================================
  // Lazy-init wrappers (called by switchDashboardTab)
  // ============================================================
  let _commInited = false, _finInited = false, _tenInited = false, _opsInited = false;
  function initCommunityInsights() {
    if (_commInited) return;
    _commInited = true;
    renderWellnessMatrix();
    renderStreakLeaderboard();
  }
  function initFinancialInsights() {
    if (_finInited) return;
    _finInited = true;
    renderPaymentBehavior();
    renderOverdueBills();
  }
  function initTenantInsights() {
    if (_tenInited) return;
    _tenInited = true;
    renderTenantInsights();
  }
  function initOperationsInsights() {
    if (_opsInited) return;
    _opsInited = true;
    renderOperationsInsights();
  }
  function refreshInsight(target) {
    if (target === 'wellness') { cacheClear('tenants_all'); renderWellnessMatrix(); }
    else if (target === 'streak') { cacheClear('tenants_all'); renderStreakLeaderboard(); }
    else if (target === 'payment') { cacheClear('payment_behavior'); renderPaymentBehavior(); }
    else if (target === 'tenant' || target === 'health' || target === 'churn') {
      cacheClear('tenants_all'); cacheClear('payment_deltas'); cacheClear('complaints_90d');
      renderTenantInsights();
    }
    else if (target === 'overdue') { cacheClear('bills_raw'); renderOverdueBills(); }
    else if (target === 'operations') { cacheClear('ops_insights'); renderOperationsInsights(); }
  }

  // ============================================================
  // Action handlers (delegated via dashboard-main click router)
  // ============================================================
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Skip SELECT — handled by 'change' event below; intercepting 'click'
    // re-renders the card while the dropdown is opening, collapsing it.
    if (el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'refreshInsight') { refreshInsight(el.dataset.target); return; }
    if (a === 'showWellnessRooms') { showWellnessRoomsModal(el.dataset.article); return; }
    if (a === 'showInactiveRooms') { showInactiveRoomsModal(); return; }
    if (a === 'showHealthDetail') { showHealthDetailModal(el.dataset.key); return; }
    if (a === 'setHSFilter') { _hsState.tierFilter = el.dataset.tier; renderTenantInsights(); return; }
    if (a === 'closeInsightsModal') { closeModal(); return; }
  });
  // Select dropdowns: react on 'change' only
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName !== 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'setPBSort') { _pbState.sortBy = el.value; renderPaymentBehavior(); }
    else if (a === 'setPBBuilding') { _pbState.buildingFilter = el.value; renderPaymentBehavior(); }
  });

  // ============================================================
  // Exports
  // ============================================================
  window.initCommunityInsights  = initCommunityInsights;
  window.initFinancialInsights  = initFinancialInsights;
  window.initTenantInsights     = initTenantInsights;
  window.initOperationsInsights = initOperationsInsights;
  window.refreshInsight         = refreshInsight;
})();
