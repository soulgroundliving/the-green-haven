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
        if (!window.firebase?.database) throw new Error('RTDB ยังไม่พร้อม');
        const snap = await window.firebase.database().ref('bills').once('value');
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
  // Lazy-init wrappers (called by switchDashboardTab)
  // ============================================================
  let _commInited = false, _finInited = false;
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
  }
  function refreshInsight(target) {
    if (target === 'wellness') { cacheClear('tenants_all'); renderWellnessMatrix(); }
    else if (target === 'streak') { cacheClear('tenants_all'); renderStreakLeaderboard(); }
    else if (target === 'payment') { cacheClear('payment_behavior'); renderPaymentBehavior(); }
  }

  // ============================================================
  // Action handlers (delegated via dashboard-main click router)
  // ============================================================
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'refreshInsight') { refreshInsight(el.dataset.target); return; }
    if (a === 'showWellnessRooms') { showWellnessRoomsModal(el.dataset.article); return; }
    if (a === 'showInactiveRooms') { showInactiveRoomsModal(); return; }
    if (a === 'closeInsightsModal') { closeModal(); return; }
    if (a === 'setPBSort') { _pbState.sortBy = el.value; renderPaymentBehavior(); return; }
    if (a === 'setPBBuilding') { _pbState.buildingFilter = el.value; renderPaymentBehavior(); return; }
  });
  // Also listen on change for select dropdowns (click doesn't fire for select)
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
  window.initCommunityInsights = initCommunityInsights;
  window.initFinancialInsights = initFinancialInsights;
  window.refreshInsight = refreshInsight;
})();
