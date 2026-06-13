/**
 * dashboard-behavioral-timing.js
 * Behavioral Analytics Phase 0 — Activity Timing Heatmap (community tab)
 *
 * Answers "active กี่โมง / วันไหน" — the one engagement question the existing
 * behavioral cards don't surface. Reads the SAME pointsLedger 90-day window as
 * dashboard-behavioral-engagement.js via the shared 'engagement_ledger' cache
 * (→ 0 extra Firestore reads when either card already loaded it) and buckets
 * every point-earning event by BKK (UTC+7) hour-of-day × day-of-week.
 *
 * AGGREGATE-ONLY by design (Behavioral Analytics plan, Fork #1 = aggregate-only):
 * the compute consumes ONLY event timestamps — no tenantId / name / room ever
 * enters this card — so there is zero PDPA surface AND zero XSS surface (nothing
 * from Firestore reaches innerHTML; every rendered value is a number or a static
 * Thai label).
 *
 * HONEST SCOPE: pointsLedger logs only the 9 point-earning sources (check-in,
 * payment, quiz, quest, help, food-share, …), NOT raw page views / taps. So this
 * is "when do tenants EARN points", a proxy for engagement timing — not full
 * activity. Full page/tap timing is Phase 1 (tenant-app instrumentation).
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralTiming for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-RR/II: inline style="" attrs only, no injected/inline <style> block (CSP-safe).
 * §7-E:  BKK bucketing via a fixed +7h offset (Thailand has no DST) — never the
 *        runtime local TZ, which differs server vs browser.
 * §7-AAA: the ledger query is orderBy('at','desc') + limit, so the cap keeps the
 *        NEWEST events (not the oldest) — mirrors the engagement card exactly.
 */
(function () {
  'use strict';

  const MS_PER_DAY = 86400000;
  const BKK_OFFSET_MS = 7 * 3600 * 1000;   // UTC+7, no DST
  const WINDOW_DAYS = 90;
  const LEDGER_LIMIT = 3000;               // MUST match engagement card (shared cache)
  const HOURS = 24;
  const DOW = 7;
  const GOLD_RGB = '212,175,55';           // var(--accent-gold) #D4AF37 — alpha-able
  // Day-of-week labels, Monday-first. JS getUTCDay() is 0=Sun..6=Sat; we re-index
  // to 0=Mon..6=Sun for display (Thai calendar reading order).
  const DOW_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
  const DOW_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

  // ── PURE compute (testable) ─────────────────────────────────────────────
  /**
   * events: [{ atMs }]  — ONLY the timestamp is consumed (aggregate-only).
   * Buckets each event in the recent WINDOW_DAYS by BKK hour-of-day × day-of-week.
   * @returns {{
   *   grid:number[7][24], byHour:number[24], byDow:number[7],
   *   total:number, peak:{dow,hour,count}, peakHour:{hour,count},
   *   peakDow:{dow,count}, weekdayCount:number, weekendCount:number
   * }}  grid/byDow are Mon-first.
   */
  function computeTiming(events, nowMs) {
    const now = nowMs || 0;
    const cut = now - WINDOW_DAYS * MS_PER_DAY;
    const grid = Array.from({ length: DOW }, () => new Array(HOURS).fill(0));
    const byHour = new Array(HOURS).fill(0);
    const byDow = new Array(DOW).fill(0);
    let total = 0, weekdayCount = 0, weekendCount = 0;

    (events || []).forEach(e => {
      const atMs = e == null ? NaN : Number(e.atMs);
      if (!isFinite(atMs) || atMs < cut) return;
      const bkk = new Date(atMs + BKK_OFFSET_MS);
      const hour = bkk.getUTCHours();        // 0..23 in BKK
      const dow = (bkk.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
      grid[dow][hour] += 1;
      byHour[hour] += 1;
      byDow[dow] += 1;
      total += 1;
      if (dow >= 5) weekendCount += 1; else weekdayCount += 1; // 5=Sat,6=Sun
    });

    let peak = { dow: 0, hour: 0, count: 0 };
    for (let d = 0; d < DOW; d++) {
      for (let h = 0; h < HOURS; h++) {
        if (grid[d][h] > peak.count) peak = { dow: d, hour: h, count: grid[d][h] };
      }
    }
    let peakHour = { hour: 0, count: 0 };
    for (let h = 0; h < HOURS; h++) if (byHour[h] > peakHour.count) peakHour = { hour: h, count: byHour[h] };
    let peakDow = { dow: 0, count: 0 };
    for (let d = 0; d < DOW; d++) if (byDow[d] > peakDow.count) peakDow = { dow: d, count: byDow[d] };

    return { grid, byHour, byDow, total, peak, peakHour, peakDow, weekdayCount, weekendCount };
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function _hh(h) { return String(h).padStart(2, '0') + ':00'; }
  function _ms(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') { const d = v.toDate(); return d ? d.getTime() : null; }
    const t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }
  function _cellBg(count, max) {
    if (!count) return 'background:var(--mist,#f4f3ee);';
    const a = 0.14 + 0.86 * (count / max);   // floor so a single event is still visible
    return `background:rgba(${GOLD_RGB},${a.toFixed(3)});`;
  }

  // ── Impure loader (browser-only) ──────────────────────────────────────────
  // Mirrors dashboard-behavioral-engagement.js loadLedger so the shared
  // 'engagement_ledger' cache holds one identical event shape regardless of which
  // card renders first ({tenantId, source, points, atMs}). This card reads only
  // .atMs, but caches the full shape so the engagement card can reuse it too.
  async function loadLedger() {
    const u = window._ins.utils;
    const cached = u.cacheGet('engagement_ledger');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, where, orderBy, limit } = window.firebase.firestoreFunctions;
    const cutoff = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY);
    const snap = await getDocs(query(
      collection(db, 'pointsLedger'),
      where('at', '>=', cutoff),
      orderBy('at', 'desc'),
      limit(LEDGER_LIMIT)
    ));
    if (snap.size >= LEDGER_LIMIT) {
      console.warn(`[behavioral-timing] ledger read hit the ${LEDGER_LIMIT} cap — older events in the ${WINDOW_DAYS}d window are not included this render.`);
    }
    const events = [];
    snap.forEach(d => {
      const data = d.data() || {};
      events.push({ tenantId: data.tenantId, source: data.source, points: data.points, atMs: _ms(data.at) });
    });
    u.cacheSet('engagement_ledger', events);
    return events;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function _heatmapHTML(e) {
    const max = e.peak.count || 1;
    let rows = '';
    for (let d = 0; d < DOW; d++) {
      let cells = `<div style="font-size:.62rem;color:var(--text-muted);display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">${DOW_SHORT[d]}</div>`;
      for (let h = 0; h < HOURS; h++) {
        const c = e.grid[d][h];
        cells += `<div title="${DOW_FULL[d]} ${_hh(h)} — ${c} ครั้ง" style="height:13px;border-radius:2px;${_cellBg(c, max)}"></div>`;
      }
      rows += cells;
    }
    // Hour axis: tick labels under 00 / 06 / 12 / 18.
    let axis = '<div></div>';
    for (let h = 0; h < HOURS; h++) {
      const show = (h % 6 === 0);
      axis += `<div style="font-size:.55rem;color:var(--text-muted);text-align:left;overflow:visible;white-space:nowrap;">${show ? String(h).padStart(2, '0') : ''}</div>`;
    }
    return `
      <div style="display:grid;grid-template-columns:26px repeat(${HOURS},1fr);gap:2px;align-items:center;">
        ${rows}
        ${axis}
      </div>`;
  }

  function renderTimingHeatmap() {
    const u = window._ins.utils;
    const container = document.getElementById('dashBehavioralTiming');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return loadLedger()
      .then(events => {
        const e = computeTiming(events, Date.now());
        const GOLD = 'var(--accent-gold,#D4AF37)';

        if (e.total === 0) {
          container.innerHTML = `
            <div class="card" style="border-left:4px solid ${GOLD};">
              <div class="card-title u-flex-sb">
                <span>🕐 ช่วงเวลาที่ active</span>
                <button data-action="refreshInsight" data-target="behavioralTiming" aria-label="รีเฟรช"
                        style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
              </div>
              <div style="color:var(--text-muted);font-size:.82rem;padding:.8rem 0;">ยังไม่มีกิจกรรมที่ได้รับแต้มใน ${WINDOW_DAYS} วันที่ผ่านมา</div>
            </div>`;
          return;
        }

        const kpi = (label, value, sub) => `
          <div style="flex:1;min-width:104px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
            <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
            ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
          </div>`;
        const kpiRow = `
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
            ${kpi('ชั่วโมงพีค', _hh(e.peakHour.hour), `${e.peakHour.count.toLocaleString()} ครั้ง`)}
            ${kpi('วันพีค', DOW_FULL[e.peakDow.dow], `${e.peakDow.count.toLocaleString()} ครั้ง`)}
            ${kpi('กิจกรรมรวม', e.total.toLocaleString(), `${WINDOW_DAYS} วัน · เสาร์-อาทิตย์ ${e.weekendCount.toLocaleString()}`)}
          </div>`;

        const legend = `
          <div style="display:flex;align-items:center;gap:.4rem;margin-top:.6rem;font-size:.62rem;color:var(--text-muted);">
            <span>น้อย</span>
            <div style="flex:1;max-width:120px;height:8px;border-radius:4px;background:linear-gradient(90deg,var(--mist,#f4f3ee),rgba(${GOLD_RGB},1));"></div>
            <span>มาก</span>
          </div>`;

        container.innerHTML = `
          <div class="card" style="border-left:4px solid ${GOLD};">
            <div class="card-title u-flex-sb">
              <span>🕐 ช่วงเวลาที่ active</span>
              <button data-action="refreshInsight" data-target="behavioralTiming" aria-label="รีเฟรช"
                      style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
            </div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
              ผู้เช่าได้รับแต้มช่วงเวลาไหนมากสุด (เช็คอิน/จ่ายบิล/ควิซ/เควสต์ ฯลฯ) · เวลา GMT+7
            </div>
            ${kpiRow}
            ${_heatmapHTML(e)}
            ${legend}
            <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
          </div>`;
      })
      .catch(err => {
        console.error('[behavioral-timing] render failed:', err);
        container.innerHTML = u.errorHTML('behavioralTiming', err.message);
      });
  }

  // ── Register on namespace (compute exported for unit tests) ──────────────
  window._ins = window._ins || {};
  window._ins.behavioralTiming = {
    renderTimingHeatmap,
    computeTiming,
    DOW_SHORT,
    DOW_FULL,
  };
}());
