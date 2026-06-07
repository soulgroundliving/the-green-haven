/**
 * dashboard-behavioral-energy.js
 * Phase 3.1 Behavioral Intelligence — Energy & Water Pattern (operations tab)
 *
 * Reads `meter_data` (Firestore, the billing SoT) as a building-wide TIME-SERIES:
 * monthly electricity + water consumption, the trajectory vs last month, and the
 * peak-consumption month in the window (the seasonal signal). One bounded read,
 * cached; reuses the same `meter_data` shape the meter-spike card already loads.
 *
 * Differentiator vs the existing Meter Usage Spike card (operations): that card
 * flags per-room OUTLIERS point-in-time (latest vs prior-3 median, ratio >1.5×).
 * This one is the aggregate TREND — total/avg usage per month across the building,
 * so seasonal peaks and a rising/falling trajectory are visible at a glance.
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralEnergy for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-E: meter_data `year` is 2-digit BE (e.g. 69) + `month` is 1–12; a sortable
 *   key is `year*12 + month` (monotonic, no CE conversion needed) and the label is
 *   a Thai month abbrev + the 2-digit BE year. eUsage/wUsage = new − old; a
 *   negative delta is a meter reset/replacement → skipped (same as meter-spike).
 * §7-RR/II: inline style="" attrs only, no injected/inline <style> block (CSP-safe).
 */
(function () {
  'use strict';

  const WINDOW_MONTHS = 6;   // trailing months shown in the trend

  const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // ── PURE helpers (testable) ─────────────────────────────────────────────
  // Sortable month key from 2-digit-BE year + 1–12 month. Monotonic across years.
  function monthKey(year, month) {
    const y = Number(year), m = Number(month);
    if (!isFinite(y) || !isFinite(m) || m < 1 || m > 12) return null;
    return y * 12 + (m - 1);
  }

  function monthLabel(year, month) {
    const m = Number(month);
    const lab = (m >= 1 && m <= 12) ? TH_MON[m - 1] : String(month);
    return `${lab} ${year}`;
  }

  function round(n) { return Math.round(n); }

  /**
   * Aggregate readings into a trailing-window monthly trend.
   * readings: [{ year, month, eUsage, wUsage, roomId, building }]
   *   (eUsage/wUsage already computed + non-negative; roomId for the room count)
   * lastN: trailing months to keep (default WINDOW_MONTHS)
   * → {
   *     months: [{ year, month, label, totalE, totalW, rooms, avgE, avgW }] (oldest→newest),
   *     summary: { latestAvgE, prevAvgE, deltaPct|null, peakLabel|null, peakAvgE,
   *                latestTotalE, latestTotalW, latestRooms, monthsTracked }
   *   }
   */
  function computeEnergyTrend(readings, lastN) {
    const n = lastN || WINDOW_MONTHS;
    const byMonth = new Map(); // key → { year, month, totalE, totalW, rooms:Set }
    (readings || []).forEach(r => {
      if (!r) return;
      const k = monthKey(r.year, r.month);
      if (k == null) return;
      let m = byMonth.get(k);
      if (!m) { m = { key: k, year: Number(r.year), month: Number(r.month), totalE: 0, totalW: 0, rooms: new Set() }; byMonth.set(k, m); }
      const e = Number(r.eUsage); if (isFinite(e) && e >= 0) m.totalE += e;
      const w = Number(r.wUsage); if (isFinite(w) && w >= 0) m.totalW += w;
      const rk = `${r.building}:${r.roomId}`;
      if (r.roomId != null) m.rooms.add(rk);
    });

    const ordered = Array.from(byMonth.values()).sort((a, b) => a.key - b.key);
    const windowed = ordered.slice(-n);
    const months = windowed.map(m => {
      const rooms = m.rooms.size;
      return {
        year: m.year, month: m.month, label: monthLabel(m.year, m.month),
        totalE: round(m.totalE), totalW: round(m.totalW), rooms,
        avgE: rooms > 0 ? round(m.totalE / rooms) : 0,
        avgW: rooms > 0 ? round(m.totalW / rooms) : 0,
      };
    });

    const latest = months.length ? months[months.length - 1] : null;
    const prev = months.length > 1 ? months[months.length - 2] : null;
    let deltaPct = null;
    if (latest && prev && prev.avgE > 0) {
      deltaPct = round((latest.avgE - prev.avgE) / prev.avgE * 100);
    }
    let peak = null;
    months.forEach(m => { if (!peak || m.avgE > peak.avgE) peak = m; });

    return {
      months,
      summary: {
        latestAvgE: latest ? latest.avgE : 0,
        prevAvgE: prev ? prev.avgE : 0,
        deltaPct,
        peakLabel: peak ? peak.label : null,
        peakAvgE: peak ? peak.avgE : 0,
        latestTotalE: latest ? latest.totalE : 0,
        latestTotalW: latest ? latest.totalW : 0,
        latestRooms: latest ? latest.rooms : 0,
        monthsTracked: months.length,
      },
    };
  }

  // ── Impure loader (browser-only; not exercised by unit tests) ────────────
  async function loadReadings() {
    const u = window._ins.utils;
    const cached = u.cacheGet('behavioral_energy');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firestore ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, where } = window.firebase.firestoreFunctions;
    // §7-AAA: a bare limit() on meter_data returns docs in doc-ID-ASCENDING order
    // (rooms_67_* < _68_* < _69_*), so a row cap silently drops the NEWEST months once
    // the collection outgrows it. This card only needs the trailing WINDOW_MONTHS, so
    // scope the read to the current + previous 2-digit-BE year instead (§7-E: meter_data
    // `year` is 2-digit BE, e.g. 69). A single-field `in` is served by the automatic
    // index — no composite index, no unordered cap. String variants are defensive in
    // case any legacy doc stored `year` as a string.
    const _curBE = new Date().getFullYear() - 1957;            // 2026 → 69
    const _yearScope = [_curBE - 1, _curBE, String(_curBE - 1), String(_curBE)];
    const snap = await getDocs(query(collection(db, 'meter_data'), where('year', 'in', _yearScope)));
    const readings = [];
    snap.forEach(d => {
      const data = d.data() || {};
      const { building, roomId, year, month, eNew, eOld, wNew, wOld } = data;
      if (!building || roomId == null || year == null || month == null) return;
      readings.push({
        building, roomId, year: Number(year), month: Number(month),
        eUsage: Number(eNew || 0) - Number(eOld || 0),
        wUsage: Number(wNew || 0) - Number(wOld || 0),
      });
    });
    u.cacheSet('behavioral_energy', readings);
    return readings;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderEnergyTrend() {
    const u = window._ins.utils;
    const container = document.getElementById('dashEnergyPattern');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return loadReadings().then(readings => {
      const { months, summary } = computeEnergyTrend(readings, WINDOW_MONTHS);
      const C = (typeof DashColors !== 'undefined') ? DashColors : {};
      const TERRA = C.TERRACOTTA || '#c0563f';
      const ORANGE = C.ORANGE_MED || '#d99a3f';
      const BLUE = 'var(--blue,#5b8def)';

      if (months.length === 0) {
        container.innerHTML = `
          <div class="card">
            <div class="card-title u-flex-sb"><span>⚡ แนวโน้มการใช้ไฟ–น้ำ</span></div>
            <div style="color:var(--text-muted);font-size:.85rem;padding:.6rem 0;">ยังไม่มีข้อมูลมิเตอร์</div>
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
      const dp = summary.deltaPct;
      const trendSub = dp == null ? 'เทียบเดือนก่อน —'
        : dp > 0 ? `<span style="color:var(--alert,${TERRA});">▲ ${dp}% จากเดือนก่อน</span>`
        : dp < 0 ? `<span style="color:var(--green-dark);">▼ ${-dp}% จากเดือนก่อน</span>`
        : 'เท่าเดือนก่อน';
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('ไฟเฉลี่ย/ห้อง (ล่าสุด)', `${summary.latestAvgE} <span style="font-size:.8rem;font-weight:400;color:var(--text-muted);">หน่วย</span>`, trendSub)}
          ${kpi('ไฟรวม (ล่าสุด)', summary.latestTotalE.toLocaleString(), `${summary.latestRooms} ห้อง`)}
          ${kpi('เดือนใช้ไฟสูงสุด', summary.peakLabel || '—', summary.peakAvgE ? `${summary.peakAvgE} หน่วย/ห้อง` : '')}
        </div>`;

      // Monthly trend bars (electricity avg/room — the seasonal signal)
      const maxAvgE = Math.max(1, ...months.map(m => m.avgE));
      const eBars = months.map(m => {
        const isPeak = summary.peakLabel === m.label;
        const col = isPeak ? `var(--alert,${TERRA})` : `var(--accent,${ORANGE})`;
        return `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
            <span style="width:62px;font-size:.72rem;color:var(--text-muted);flex-shrink:0;">${u.esc(m.label)}</span>
            <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;">
              <div style="width:${Math.round(m.avgE / maxAvgE * 100)}%;height:100%;background:${col};"></div>
            </div>
            <span style="width:48px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;">${m.avgE}</span>
          </div>`;
      }).join('');
      const eHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">ไฟฟ้าเฉลี่ย/ห้อง รายเดือน (หน่วย)</div>
          ${eBars}
        </div>`;

      // Water avg/room — compact secondary trend
      const maxAvgW = Math.max(1, ...months.map(m => m.avgW));
      const wBars = months.map(m => `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
            <span style="width:62px;font-size:.72rem;color:var(--text-muted);flex-shrink:0;">${u.esc(m.label)}</span>
            <div style="flex:1;height:10px;background:var(--mist,#f2f1ec);border-radius:5px;overflow:hidden;">
              <div style="width:${Math.round(m.avgW / maxAvgW * 100)}%;height:100%;background:${BLUE};"></div>
            </div>
            <span style="width:48px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;">${m.avgW}</span>
          </div>`).join('');
      const wHTML = `
        <div>
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">น้ำเฉลี่ย/ห้อง รายเดือน (หน่วย)</div>
          ${wBars}
        </div>`;

      container.innerHTML = `
        <div class="card" style="border-top:3px solid var(--accent,${ORANGE});">
          <div class="card-title u-flex-sb">
            <span>⚡ แนวโน้มการใช้ไฟ–น้ำ</span>
            <button data-action="refreshInsight" data-target="energyPattern" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
            การใช้ไฟ–น้ำเฉลี่ยต่อห้องรายเดือน · ${summary.monthsTracked} เดือนล่าสุด · เน้นเดือนพีค
          </div>
          ${kpiRow}
          ${eHTML}
          ${wHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>`;
    }).catch(e => {
      console.error('[behavioral-energy] render failed:', e);
      container.innerHTML = u.errorHTML('energyPattern', e.message);
    });
  }

  // ── Register on namespace (compute fns exported for unit tests) ──────────
  window._ins = window._ins || {};
  window._ins.behavioralEnergy = {
    renderEnergyTrend,
    // pure (tested):
    monthKey, monthLabel, computeEnergyTrend,
  };
}());
