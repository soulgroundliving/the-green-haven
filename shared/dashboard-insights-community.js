/**
 * dashboard-insights-community.js
 * FEATURE 1  — Wellness Engagement Matrix
 * FEATURE 1b — Quiz Engagement
 * FEATURE 2  — Daily Login Streak Leaderboard
 *
 * Depends on window._ins.utils being populated by dashboard-insights.js
 * (which loads first via DOM script order).
 */
(function () {
  'use strict';

  // ============================================================
  // FEATURE 1: Wellness Engagement Matrix
  // ============================================================
  async function renderWellnessMatrix() {
    const u = window._ins.utils;
    const container = document.getElementById('dashWellnessMatrix');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
        throw new Error('Firebase ยังไม่พร้อม');
      }
      const db = window.firebase.firestore();
      const { collection, collectionGroup, getDocs, query, limit } = window.firebase.firestoreFunctions;

      // Load articles + claims (parallel) + tenant total for occupancy denominator
      const [articleSnap, claimSnap, tenants] = await Promise.all([
        getDocs(query(collection(db, 'wellness_articles'), limit(200))),
        getDocs(query(collectionGroup(db, 'wellnessClaimed'), limit(1000))),
        u.loadAllTenantDocs()
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
          tableRows += `<tr data-action="showWellnessRooms" data-article="${u.esc(r.id)}" style="cursor:pointer;">
            <td class="u-td-l">${u.esc(r.title)}</td>
            <td class="u-td-num">${r.roomCount} / ${totalRooms}</td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};font-weight:600;">${rate}%</td>
            <td class="u-td-num">${r.totalReward}</td>
          </tr>`;
        });
      }

      const topPills = topRooms.length === 0
        ? '<span style="color:var(--text-muted);">—</span>'
        : topRooms.map((r, i) => `<span style="display:inline-block;padding:2px 10px;margin-right:6px;background:var(--green-pale);color:var(--green-dark);border-radius:999px;font-size:.78rem;font-weight:600;">${['🥇','🥈','🥉'][i]} ${u.esc(r.room)} (${r.count})</span>`).join('');

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--green);">
          <div class="card-title u-flex-sb">
            <span>📚 Wellness Engagement</span>
            <button data-action="refreshInsight" data-target="wellness" aria-label="รีเฟรช Wellness"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.7rem;">${summary}</div>
          <div class="u-scroll-x">
            <table class="u-table-sm">
              <thead>
                <tr style="background:var(--green-pale);color:var(--green-dark);">
                  <th class="u-th-l">บทความ</th>
                  <th class="u-th-r">ห้องอ่าน</th>
                  <th class="u-th-r">อัตรา</th>
                  <th class="u-th-r">รวมแต้ม</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--border-subtle,${DashColors.WARM_WHITE});">
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem;">🏆 ผู้เช่ากระตือรือร้น</div>
            <div>${topPills}</div>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${u.fmtCacheAge(Date.now())}</div>
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
      container.innerHTML = window._ins.utils.errorHTML('wellness', e.message);
    }
  }

  // ============================================================
  // FEATURE 1b: Quiz Engagement (Session B) — wellness + contract
  // ============================================================
  // Aggregates collectionGroup('wellnessQuizPassed') + collectionGroup(
  // 'contractQuizPassed'). Both subcollections are CF-only writes (claim*QuizPoints
  // CFs) so this is the authoritative engagement signal.
  //
  // §7-DD live-path discipline: filter out archive-path copies so move-out
  // doesn't inflate the engagement count (mirror pets/wellnessClaimed handling).
  async function renderQuizEngagement() {
    const u = window._ins.utils;
    const container = document.getElementById('dashQuizEngagement');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
        throw new Error('Firebase ยังไม่พร้อม');
      }
      const db = window.firebase.firestore();
      const { collection, collectionGroup, getDocs, query, limit } = window.firebase.firestoreFunctions;

      const [articleSnap, wqSnap, cqSnap] = await Promise.all([
        getDocs(query(collection(db, 'wellness_articles'), limit(200))),
        getDocs(query(collectionGroup(db, 'wellnessQuizPassed'), limit(1000))),
        getDocs(query(collectionGroup(db, 'contractQuizPassed'), limit(1000))),
      ]);

      const articles = new Map();
      articleSnap.forEach(d => {
        articles.set(d.id, { id: d.id, title: d.data()?.title || '(ไม่ระบุชื่อ)' });
      });

      // Live-path filter — exclude archive subcoll copies.
      const isLivePath = (ref) => {
        const parts = ref.path.split('/');
        return parts.includes('list') && !parts.includes('archive');
      };

      // Wellness aggregation: marker doc id = `{articleId}_{ym}`; strip _{ym} for grouping
      const wellnessByArticle = new Map();
      let wellnessPasses = 0;
      let wellnessAttempts = 0;
      wqSnap.forEach(d => {
        if (!isLivePath(d.ref)) return;
        const data = d.data() || {};
        wellnessAttempts++;
        if (data.passed) wellnessPasses++;
        const parts = d.id.split('_');
        if (parts.length < 2) return;
        const articleId = parts.slice(0, -1).join('_');
        if (!wellnessByArticle.has(articleId)) wellnessByArticle.set(articleId, { passes: 0, fails: 0 });
        const stat = wellnessByArticle.get(articleId);
        if (data.passed) stat.passes++; else stat.fails++;
      });

      // Contract aggregation: marker doc id = ym
      const contractByMonth = new Map();
      let contractPasses = 0;
      let contractAttempts = 0;
      cqSnap.forEach(d => {
        if (!isLivePath(d.ref)) return;
        const data = d.data() || {};
        contractAttempts++;
        if (data.passed) contractPasses++;
        const ym = d.id;
        if (!contractByMonth.has(ym)) contractByMonth.set(ym, { passes: 0, fails: 0 });
        const stat = contractByMonth.get(ym);
        if (data.passed) stat.passes++; else stat.fails++;
      });

      const wellnessRate = wellnessAttempts ? Math.round(wellnessPasses / wellnessAttempts * 100) : 0;
      const contractRate = contractAttempts ? Math.round(contractPasses / contractAttempts * 100) : 0;

      // Wellness table — sorted by total attempts desc
      const wRows = Array.from(wellnessByArticle.entries())
        .map(([id, s]) => ({
          id, title: articles.get(id)?.title || id,
          total: s.passes + s.fails, passes: s.passes, fails: s.fails,
          rate: (s.passes + s.fails) ? Math.round(s.passes / (s.passes + s.fails) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total);
      const wellnessTable = wRows.length === 0
        ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.2rem;">ยังไม่มี attempt</td></tr>`
        : wRows.map(r => {
            const rateColor = r.rate >= 70 ? 'var(--green-dark)' : r.rate >= 40 ? 'var(--moss,#5a7a5a)' : '#92400e';
            return `<tr>
              <td class="u-td-l">${u.esc(r.title)}</td>
              <td class="u-td-num">${r.passes} / ${r.total}</td>
              <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};font-weight:600;">${r.rate}%</td>
            </tr>`;
          }).join('');

      // Contract table — sorted by month desc
      const cRows = Array.from(contractByMonth.entries())
        .map(([ym, s]) => ({
          ym, total: s.passes + s.fails, passes: s.passes, fails: s.fails,
          rate: (s.passes + s.fails) ? Math.round(s.passes / (s.passes + s.fails) * 100) : 0,
        }))
        .sort((a, b) => b.ym.localeCompare(a.ym))
        .slice(0, 6); // last 6 months
      const contractTable = cRows.length === 0
        ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1.2rem;">ยังไม่มี attempt</td></tr>`
        : cRows.map(r => {
            const rateColor = r.rate >= 70 ? 'var(--green-dark)' : r.rate >= 40 ? 'var(--moss,#5a7a5a)' : '#92400e';
            return `<tr>
              <td class="u-td-l">${u.esc(r.ym)}</td>
              <td class="u-td-num">${r.passes} / ${r.total}</td>
              <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};font-weight:600;">${r.rate}%</td>
            </tr>`;
          }).join('');

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--accent-gold,#D4AF37);">
          <div class="card-title u-flex-sb">
            <span>🎯 Quiz Engagement</span>
            <button data-action="refreshInsight" data-target="quizEngagement" aria-label="รีเฟรช Quiz"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.7rem;">
            Wellness: <strong style="color:var(--green-dark);">${wellnessPasses}/${wellnessAttempts}</strong> ผ่าน (${wellnessRate}%) ·
            Contract: <strong style="color:var(--green-dark);">${contractPasses}/${contractAttempts}</strong> ผ่าน (${contractRate}%)
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:.8rem;">
            <div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.3rem;">📚 บทความ Wellness</div>
              <div class="u-scroll-x">
                <table class="u-table-sm">
                  <thead><tr style="background:var(--green-pale);color:var(--green-dark);">
                    <th class="u-th-l">บทความ</th>
                    <th class="u-th-r">ผ่าน / รวม</th>
                    <th class="u-th-r">อัตรา</th>
                  </tr></thead>
                  <tbody>${wellnessTable}</tbody>
                </table>
              </div>
            </div>
            <div>
              <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.3rem;">📜 Contract Quiz (รายเดือน)</div>
              <div class="u-scroll-x">
                <table class="u-table-sm">
                  <thead><tr style="background:var(--green-pale);color:var(--green-dark);">
                    <th class="u-th-l">เดือน</th>
                    <th class="u-th-r">ผ่าน / รวม</th>
                    <th class="u-th-r">อัตรา</th>
                  </tr></thead>
                  <tbody>${contractTable}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>
      `;

      window._insightsCache = window._insightsCache || {};
      window._insightsCache.quizEngagement = {
        wellnessAttempts, wellnessPasses, wellnessRate,
        contractAttempts, contractPasses, contractRate,
        wellnessByArticle: Object.fromEntries(wellnessByArticle),
        contractByMonth: Object.fromEntries(contractByMonth),
      };
    } catch (e) {
      console.error('[insights] quiz engagement failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('quizEngagement', e.message);
    }
  }

  // ============================================================
  // FEATURE 2: Daily Login Streak Leaderboard
  // ============================================================
  async function renderStreakLeaderboard() {
    const u = window._ins.utils;
    const container = document.getElementById('dashStreakLeaderboard');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      const tenants = await u.loadAllTenantDocs();

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
        listHTML = u.emptyHTML('ยังไม่มีผู้เช่าเริ่ม streak');
      } else {
        listHTML = '<ol style="list-style:none;padding:0;margin:0;">';
        top.forEach((r, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
          const fire = u.streakFire(r.streak);
          listHTML += `<li style="display:grid;grid-template-columns:30px 1fr 70px 60px;padding:.45rem .25rem;border-bottom:1px solid var(--border-subtle,${DashColors.WARM_WHITE});align-items:center;font-size:.86rem;">
            <span>${medal}</span>
            <span style="font-weight:600;">${u.esc(r.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">(${u.buildingLabel(r.building)})</span></span>
            <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--green-dark);font-weight:600;">${r.streak} วัน</span>
            <span style="text-align:right;">${fire}</span>
          </li>`;
        });
        listHTML += '</ol>';
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--accent-gold,#D4AF37);">
          <div class="card-title u-flex-sb">
            <span>🔥 Streak Leaderboard</span>
            <button data-action="refreshInsight" data-target="streak" aria-label="รีเฟรช Streak"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          ${listHTML}
          <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--border-subtle,${DashColors.WARM_WHITE});">
            <div style="font-size:.82rem;margin-bottom:.4rem;">
              📅 Today's logins:
              <strong style="color:var(--blue);">${todayCount} / ${totalRooms}</strong>
              <span style="color:var(--text-muted);font-size:.72rem;">(${todayPct}%)</span>
            </div>
            <div style="font-size:.82rem;">
              💤 Inactive >7d: <strong style="color:var(--alert,${DashColors.TERRACOTTA});">${inactive.length} ห้อง</strong>
              ${inactive.length > 0 ? '<button data-action="showInactiveRooms" style="margin-left:.4rem;font-size:.72rem;padding:1px 8px;background:transparent;border:none;color:var(--blue);cursor:pointer;text-decoration:underline;font-family:\'Sarabun\',sans-serif;" aria-label="ดูรายชื่อห้องที่ไม่ active">ดูรายชื่อ →</button>' : ''}
            </div>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>
      `;

      window._insightsCache = window._insightsCache || {};
      window._insightsCache.inactiveRooms = inactive;
    } catch (e) {
      console.error('[insights] streak leaderboard failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('streak', e.message);
    }
  }

  // ============================================================
  // Register on namespace
  // ============================================================
  window._ins = window._ins || {};
  window._ins.community = { renderWellnessMatrix, renderQuizEngagement, renderStreakLeaderboard };
}());
