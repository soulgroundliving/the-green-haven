/**
 * dashboard-behavioral-repair.js
 * Phase 3.1 Behavioral Intelligence — Peak Repair Season (operations tab)
 *
 * Reads `maintenanceArchive` (Firestore — the lean, append-only copy of every
 * CLOSED maintenance ticket written daily by archiveMaintenanceScheduled, #270)
 * as a TIME-SERIES of repair COUNTS: how many repairs were completed per month,
 * which month/season peaks, and which category dominates. The seasonal signal the
 * blueprint calls "Peak repair season" — used to pre-stage spares/contractors and
 * to inform future building design.
 *
 * Why a separate collection: live RTDB `maintenance/{b}/{r}` is purged 30 days
 * after a ticket closes, so long-term seasonality is impossible from it. #270's
 * archive preserves the lean analytics fields (NO base64 photos) before the purge.
 * This card only starts showing signal once the archive accrues a few weeks of
 * history (it begins 2026-06-06); until then it renders a friendly "accruing" state.
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralRepair for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * Data shape (maintenanceArchive doc): { building, roomId, category, priority,
 *   createdAtMs, completedAtMs, status, ... }. completedAtMs/createdAtMs are real
 *   epoch ms (CE), so month keying uses a normal Date — NOT the 2-digit-BE meter
 *   year of the energy card. The label still shows 2-digit BE (CE+543) for parity.
 * §7-J: read is limit-only (no where/orderBy) → NO composite index required, same
 *   as the energy card's meter_data read.
 * §7-RR/II: inline style="" attrs only, no injected/inline <style> block (CSP-safe).
 */
(function () {
  'use strict';

  const WINDOW_MONTHS = 12;  // a full year so all three Thai seasons are visible
  const READ_LIMIT = 5000;   // bound the maintenanceArchive read (mirrors energy)
  const TOP_CATEGORIES = 5;  // categories shown in the breakdown

  const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // Maintenance categories — mirror the tenant_app.html report form options.
  const CAT_LABELS = {
    electric: '⚡ ไฟฟ้า',
    water: '💧 น้ำ/ประปา',
    aircon: '❄️ แอร์',
    furniture: '🪑 เฟอร์นิเจอร์',
    door: '🚪 ประตู/หน้าต่าง',
    internet: '📶 อินเทอร์เน็ต',
    other: '📝 อื่นๆ',
  };
  function catLabel(key) {
    if (key == null || key === '') return CAT_LABELS.other;
    return CAT_LABELS[key] || String(key);
  }

  // Thai seasons (เมือง: hot Mar–May / rainy Jun–Oct / cool Nov–Feb).
  const SEASON_LABELS = { hot: '☀️ ฤดูร้อน', rainy: '🌧️ ฤดูฝน', cool: '🍃 ฤดูหนาว' };
  function seasonOfMonth(month) {
    const m = Number(month);
    if (!isFinite(m) || m < 1 || m > 12) return null;
    if (m >= 3 && m <= 5) return 'hot';
    if (m >= 6 && m <= 10) return 'rainy';
    return 'cool'; // 11, 12, 1, 2
  }

  // ── PURE helpers (testable) ─────────────────────────────────────────────
  // Sortable month key from an epoch-ms timestamp (CE). Monotonic across years.
  function monthKeyFromMs(ms) {
    const n = Number(ms);
    if (!isFinite(n) || n <= 0) return null;
    const d = new Date(n);
    const y = d.getFullYear();
    if (!isFinite(y)) return null;
    return y * 12 + d.getMonth(); // getMonth: 0–11
  }

  // Thai month abbrev + 2-digit BE year from an epoch-ms timestamp.
  function monthLabelFromMs(ms) {
    const n = Number(ms);
    if (!isFinite(n) || n <= 0) return null;
    const d = new Date(n);
    const be2 = (d.getFullYear() + 543) % 100;
    return `${TH_MON[d.getMonth()]} ${be2}`;
  }

  function round(n) { return Math.round(n); }
  function pct(part, total) { return total > 0 ? round(part / total * 100) : 0; }

  /**
   * Aggregate closed tickets into a trailing-window monthly repair-count trend
   * plus season + category breakdowns.
   * tickets: [{ completedAtMs?, createdAtMs?, category?, building?, roomId? }]
   * lastN: trailing months to keep (default WINDOW_MONTHS)
   * → {
   *     months:    [{ key, month, label, count, top:[{label,count}] }] (oldest→newest),
   *     seasons:   [{ key, name, count, pct }] (hot/rainy/cool, count desc),
   *     categories:[{ key, label, count, pct }] (count desc, capped),
   *     summary: { total, monthsTracked, peakMonthLabel|null, peakMonthCount,
   *                peakSeasonKey|null, peakSeasonName|null, peakSeasonCount,
   *                topCategoryKey|null, topCategoryLabel|null, topCategoryCount }
   *   }
   */
  function computeRepairSeasonality(tickets, lastN) {
    const n = lastN || WINDOW_MONTHS;
    const byMonth = new Map(); // key → { key, month, count, cats:Map }

    (tickets || []).forEach(t => {
      if (!t) return;
      const ms = (t.completedAtMs != null && Number(t.completedAtMs) > 0)
        ? Number(t.completedAtMs)
        : Number(t.createdAtMs);
      const k = monthKeyFromMs(ms);
      if (k == null) return;
      let m = byMonth.get(k);
      if (!m) {
        const d = new Date(ms);
        m = { key: k, month: d.getMonth() + 1, label: monthLabelFromMs(ms), count: 0, cats: new Map() };
        byMonth.set(k, m);
      }
      m.count += 1;
      const cat = (t.category == null || t.category === '') ? 'other' : String(t.category);
      m.cats.set(cat, (m.cats.get(cat) || 0) + 1);
    });

    const ordered = Array.from(byMonth.values()).sort((a, b) => a.key - b.key);
    const windowed = ordered.slice(-n);

    // Per-month shape + per-month top categories.
    const months = windowed.map(m => {
      const top = Array.from(m.cats.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([key, count]) => ({ label: catLabel(key), count }));
      return { key: m.key, month: m.month, label: m.label, count: m.count, top };
    });

    // Window-wide aggregates (only over the kept months).
    const total = months.reduce((s, m) => s + m.count, 0);

    const seasonCounts = { hot: 0, rainy: 0, cool: 0 };
    const catCounts = new Map();
    windowed.forEach(m => {
      const s = seasonOfMonth(m.month);
      if (s) seasonCounts[s] += m.count;
      m.cats.forEach((c, key) => catCounts.set(key, (catCounts.get(key) || 0) + c));
    });

    const seasons = Object.keys(seasonCounts)
      .map(key => ({ key, name: SEASON_LABELS[key], count: seasonCounts[key], pct: pct(seasonCounts[key], total) }))
      .sort((a, b) => b.count - a.count);

    const categories = Array.from(catCounts.entries())
      .map(([key, count]) => ({ key, label: catLabel(key), count, pct: pct(count, total) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_CATEGORIES);

    let peakMonth = null;
    months.forEach(m => { if (!peakMonth || m.count > peakMonth.count) peakMonth = m; });
    const peakSeason = seasons.length && seasons[0].count > 0 ? seasons[0] : null;
    const topCat = categories.length && categories[0].count > 0 ? categories[0] : null;

    return {
      months,
      seasons,
      categories,
      summary: {
        total,
        monthsTracked: months.length,
        peakMonthLabel: peakMonth && peakMonth.count > 0 ? peakMonth.label : null,
        peakMonthCount: peakMonth ? peakMonth.count : 0,
        peakSeasonKey: peakSeason ? peakSeason.key : null,
        peakSeasonName: peakSeason ? peakSeason.name : null,
        peakSeasonCount: peakSeason ? peakSeason.count : 0,
        topCategoryKey: topCat ? topCat.key : null,
        topCategoryLabel: topCat ? topCat.label : null,
        topCategoryCount: topCat ? topCat.count : 0,
      },
    };
  }

  // ── Impure loader (browser-only; not exercised by unit tests) ────────────
  async function loadTickets() {
    const u = window._ins.utils;
    const cached = u.cacheGet('behavioral_repair');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firestore ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const snap = await getDocs(query(collection(db, 'maintenanceArchive'), limit(READ_LIMIT)));
    if (snap.size >= READ_LIMIT) {
      console.warn(`[behavioral-repair] maintenanceArchive read hit the ${READ_LIMIT} cap — older months may be excluded this render.`);
    }
    const tickets = [];
    snap.forEach(d => {
      const data = d.data() || {};
      tickets.push({
        building: data.building,
        roomId: data.roomId,
        category: data.category,
        completedAtMs: data.completedAtMs,
        createdAtMs: data.createdAtMs,
      });
    });
    u.cacheSet('behavioral_repair', tickets);
    return tickets;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderRepairSeason() {
    const u = window._ins.utils;
    const container = document.getElementById('dashRepairSeason');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return loadTickets().then(tickets => {
      const { months, seasons, categories, summary } = computeRepairSeasonality(tickets, WINDOW_MONTHS);
      const C = (typeof DashColors !== 'undefined') ? DashColors : {};
      const TERRA = C.TERRACOTTA || '#c0563f';
      const ORANGE = C.ORANGE_MED || '#d99a3f';

      const refreshBtn = `
        <button data-action="refreshInsight" data-target="repairSeason" aria-label="รีเฟรช"
                style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>`;

      if (summary.total === 0) {
        container.innerHTML = `
          <div class="card" style="border-top:3px solid var(--accent,${ORANGE});">
            <div class="card-title u-flex-sb"><span>🔧 ฤดูกาลงานซ่อม</span>${refreshBtn}</div>
            <div style="color:var(--text-muted);font-size:.85rem;padding:.6rem 0;line-height:1.5;">
              กำลังสะสมประวัติงานซ่อม — การ์ดจะแสดงรูปแบบตามฤดูกาลเมื่อมีข้อมูลพอ<br>
              <span style="font-size:.72rem;">ระบบเริ่มเก็บประวัติงานซ่อมที่ปิดแล้วตั้งแต่ 6 มิ.ย. 69 (ก่อนหน้านี้ตั๋วถูกลบทุก 30 วัน)</span>
            </div>
          </div>`;
        return;
      }

      // KPI row
      const kpi = (label, value, sub) => `
        <div style="flex:1;min-width:120px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
          <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
          ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
        </div>`;
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('งานซ่อมรวม', summary.total.toLocaleString(), `${summary.monthsTracked} เดือนล่าสุด`)}
          ${kpi('เดือนซ่อมมากสุด', summary.peakMonthLabel || '—', summary.peakMonthCount ? `${summary.peakMonthCount} งาน` : '')}
          ${kpi('ฤดูซ่อมมากสุด', summary.peakSeasonName || '—', summary.peakSeasonCount ? `${summary.peakSeasonCount} งาน` : '')}
        </div>`;

      // Monthly repair-count bars (peak month highlighted — the seasonal signal)
      const maxCount = Math.max(1, ...months.map(m => m.count));
      const bars = months.map(m => {
        const isPeak = summary.peakMonthLabel === m.label && m.count > 0;
        const col = isPeak ? `var(--alert,${TERRA})` : `var(--accent,${ORANGE})`;
        const topCat = m.top.length ? ` · ${u.esc(m.top[0].label)}` : '';
        return `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
            <span style="width:54px;font-size:.72rem;color:var(--text-muted);flex-shrink:0;">${u.esc(m.label)}</span>
            <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;" title="${u.esc(m.label)}${topCat}">
              <div style="width:${Math.round(m.count / maxCount * 100)}%;height:100%;background:${col};"></div>
            </div>
            <span style="width:34px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;">${m.count}</span>
          </div>`;
      }).join('');
      const barsHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">จำนวนงานซ่อมรายเดือน</div>
          ${bars}
        </div>`;

      // Category breakdown (what breaks most — actionable for stocking spares)
      const catRows = categories.map(c => `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
            <span style="width:120px;font-size:.74rem;color:var(--ink,#1f1f1c);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.esc(c.label)}</span>
            <div style="flex:1;height:10px;background:var(--mist,#f2f1ec);border-radius:5px;overflow:hidden;">
              <div style="width:${c.pct}%;height:100%;background:var(--green,#6b8f71);"></div>
            </div>
            <span style="width:54px;text-align:right;font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums;">${c.count} · ${c.pct}%</span>
          </div>`).join('');
      const catHTML = `
        <div>
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">ประเภทที่ซ่อมบ่อย</div>
          ${catRows}
        </div>`;

      container.innerHTML = `
        <div class="card" style="border-top:3px solid var(--accent,${ORANGE});">
          <div class="card-title u-flex-sb">
            <span>🔧 ฤดูกาลงานซ่อม</span>
            ${refreshBtn}
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
            รูปแบบงานซ่อมตามเดือน/ฤดูกาล · ${summary.monthsTracked} เดือนล่าสุด${summary.topCategoryLabel ? ` · ซ่อมบ่อยสุด: ${u.esc(summary.topCategoryLabel)}` : ''}
          </div>
          ${kpiRow}
          ${barsHTML}
          ${catHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>`;
    }).catch(e => {
      console.error('[behavioral-repair] render failed:', e);
      container.innerHTML = u.errorHTML('repairSeason', e.message);
    });
  }

  // ── Register on namespace (compute fns exported for unit tests) ──────────
  window._ins = window._ins || {};
  window._ins.behavioralRepair = {
    renderRepairSeason,
    // pure (tested):
    monthKeyFromMs, monthLabelFromMs, seasonOfMonth, catLabel, computeRepairSeasonality,
  };
}());
