/**
 * dashboard-behavioral-tenure.js
 * Phase 3.1 Behavioral Intelligence — Tenure & Move-out Propensity (tenants tab)
 *
 * The FIRST analytics surface to read the historical move-out substrate:
 *   - Current tenure: from already-loaded tenant docs (shared 'tenants_all'
 *     cache via _ins.utils.loadAllTenantDocs — NO extra read).
 *   - Completed tenancies / turnover: from `tenants/{building}/archive/{contractId}`
 *     parent docs (clone of the live tenant doc + archivedAt). One query per
 *     building (admin-read, firestore.rules:461), index-free. Archive is THE
 *     canonical move-out record (archiveTenantOnMoveOut), so a parent doc gives
 *     move-in (cloned lease.startDate) + move-out (archivedAt) in one read —
 *     cheaper + cleaner than pairing per-room occupancyLog events.
 *
 * Differentiator vs the existing Tenant Health card (FEATURE 4+5): that card
 * COUNTS flagged rooms point-in-time; this one RANKS move-out propensity and
 * grounds it in the building's REAL historical turnover (avg completed stay).
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralTenure for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-RR/II: no injected <style>, no inline <style> block — inline style="" attrs
 * only (same as every sibling insights card; CSP-safe). §7-E: dates parsed via
 * Date(); tenure is month math, no BE/CE year fields involved.
 */
(function () {
  'use strict';

  // ── Tunables (mirror the churn thresholds in dashboard-insights-tenant.js
  //    so propensity factors stay consistent with the Health card's flags) ──
  const MS_PER_DAY = 86400000;
  const MS_PER_MONTH = 30 * MS_PER_DAY;
  const PROPENSITY = {
    EXPIRY_30: 40, EXPIRY_60: 28, EXPIRY_90: 18, EXPIRED: 35,
    NEW_TENANT: 12,        // <=3 months in = not yet settled
    INACTIVE_14D: 10,
    LATE_PAY_3X: 20,       // enrichment (only if Health card cache is warm)
    COMPLAINTS_2X: 15,     // enrichment
  };

  // ── PURE helpers (testable) ────────────────────────────────────────────
  function monthsBetween(aMs, bMs) {
    if (aMs == null || bMs == null || !isFinite(aMs) || !isFinite(bMs)) return null;
    return Math.floor((bMs - aMs) / MS_PER_MONTH);
  }

  function median(nums) {
    const xs = (nums || []).filter(n => n != null && isFinite(n)).slice().sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
  }

  function avg(nums) {
    const xs = (nums || []).filter(n => n != null && isFinite(n));
    if (xs.length === 0) return null;
    return Math.round(xs.reduce((s, n) => s + n, 0) / xs.length);
  }

  /**
   * Current-tenant tenure distribution.
   * records: [{ building, roomId, tenantName, tenureMonths|null }]
   * → { count, avgMonths, medianMonths, buckets:{le3,le6,le12,gt12,unknown}, longest:[...] }
   */
  function computeTenureStats(records) {
    const occ = (records || []);
    const months = occ.map(r => r.tenureMonths);
    const buckets = { le3: 0, le6: 0, le12: 0, gt12: 0, unknown: 0 };
    occ.forEach(r => {
      const m = r.tenureMonths;
      if (m == null) buckets.unknown++;
      else if (m <= 3) buckets.le3++;
      else if (m <= 6) buckets.le6++;
      else if (m <= 12) buckets.le12++;
      else buckets.gt12++;
    });
    const longest = occ
      .filter(r => r.tenureMonths != null)
      .sort((a, b) => b.tenureMonths - a.tenureMonths)
      .slice(0, 5);
    return {
      count: occ.length,
      avgMonths: avg(months),
      medianMonths: median(months),
      buckets,
      longest,
    };
  }

  /**
   * Historical turnover from archive entries.
   * entries: [{ building, roomId, moveInMs|null, archivedMs|null, reason }]
   * → { total, completed12mo, avgCompletedMonths, medianCompletedMonths,
   *     byMonth:[{ ym, count }] (last 6 calendar months, oldest→newest) }
   */
  function computeTurnover(entries, nowMs) {
    const now = nowMs != null ? nowMs : 0;
    const list = (entries || []).filter(e => e && e.archivedMs != null && isFinite(e.archivedMs));
    const cutoff12 = now - 365 * MS_PER_DAY;
    let completed12mo = 0;
    const durations = [];
    list.forEach(e => {
      if (e.archivedMs >= cutoff12) completed12mo++;
      const d = monthsBetween(e.moveInMs, e.archivedMs);
      if (d != null && d >= 0) durations.push(d);
    });

    // Last 6 calendar months, keyed YYYY-MM (UTC), oldest → newest.
    const byMonth = [];
    if (now > 0) {
      const base = new Date(now);
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        byMonth.push({ ym, count: 0 });
      }
      const idx = new Map(byMonth.map((b, i) => [b.ym, i]));
      list.forEach(e => {
        const d = new Date(e.archivedMs);
        const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (idx.has(ym)) byMonth[idx.get(ym)].count++;
      });
    }

    return {
      total: list.length,
      completed12mo,
      avgCompletedMonths: avg(durations),
      medianCompletedMonths: median(durations),
      byMonth,
    };
  }

  /**
   * Move-out propensity for one current tenant. Higher = more likely to leave.
   * rec: { daysToEnd|null, tenureMonths|null, inactiveDays|null,
   *        paymentLateCount|null, complaintCount90d|null }
   * → { score (0-100), tier:'high'|'watch'|'stable', factors:[strings] }
   */
  function computeMovePropensity(rec) {
    const r = rec || {};
    let score = 0;
    const factors = [];

    if (r.daysToEnd != null) {
      if (r.daysToEnd < 0) { score += PROPENSITY.EXPIRED; factors.push(`สัญญาหมดแล้ว ${-r.daysToEnd} วัน`); }
      else if (r.daysToEnd <= 30) { score += PROPENSITY.EXPIRY_30; factors.push(`สัญญาเหลือ ${r.daysToEnd} วัน`); }
      else if (r.daysToEnd <= 60) { score += PROPENSITY.EXPIRY_60; factors.push(`สัญญาเหลือ ${r.daysToEnd} วัน`); }
      else if (r.daysToEnd <= 90) { score += PROPENSITY.EXPIRY_90; factors.push(`สัญญาเหลือ ${r.daysToEnd} วัน`); }
    }
    if (r.tenureMonths != null && r.tenureMonths <= 3) {
      score += PROPENSITY.NEW_TENANT; factors.push('เพิ่งเข้า ≤3 เดือน');
    }
    if (r.inactiveDays != null && r.inactiveDays >= 14) {
      score += PROPENSITY.INACTIVE_14D; factors.push(`ไม่ active ${r.inactiveDays} วัน`);
    }
    if (r.paymentLateCount != null && r.paymentLateCount >= 3) {
      score += PROPENSITY.LATE_PAY_3X; factors.push(`ค้างชำระ ${r.paymentLateCount} ครั้ง`);
    }
    if (r.complaintCount90d != null && r.complaintCount90d >= 2) {
      score += PROPENSITY.COMPLAINTS_2X; factors.push(`ร้องเรียน ${r.complaintCount90d} ครั้ง`);
    }

    score = Math.min(100, score);
    const tier = score >= 50 ? 'high' : score >= 25 ? 'watch' : 'stable';
    return { score, tier, factors };
  }

  /** Rank current tenants by propensity, descending. Returns annotated copies. */
  function rankPropensity(records) {
    return (records || [])
      .map(r => ({ ...r, propensity: computeMovePropensity(r) }))
      .sort((a, b) => b.propensity.score - a.propensity.score);
  }

  // ── Impure loaders (browser-only; not exercised by unit tests) ──────────
  function _ms(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') { const d = v.toDate(); return d ? d.getTime() : null; }
    const t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  // Current occupied tenants → propensity-ready records. Reuses the shared
  // 'tenants_all' cache (Health card already warmed it on this tab) + best-effort
  // 'payment_deltas'/'complaints_90d' caches for the enrichment factors.
  async function loadCurrentRecords() {
    const u = window._ins.utils;
    const tenants = await u.loadAllTenantDocs();
    const pd = u.cacheGet('payment_deltas') || {};
    const cc = u.cacheGet('complaints_90d') || {};
    const nowMs = Date.now();
    const records = [];
    tenants.forEach(t => {
      const lease = t.lease || {};
      const name = t.name || lease.tenantName || '';
      const hasTenant = !!(name || t.phone);
      if (!hasTenant) return; // occupied rooms only
      const startMs = _ms(lease.startDate || lease.moveInDate || t.moveInDate);
      const endMs = _ms(lease.endDate || lease.moveOutDate);
      const g = t.gamification || {};
      const lastClaimMs = _ms(g.lastDailyClaim);
      const key = `${t.building}:${t.roomId}`;
      records.push({
        building: t.building,
        roomId: t.roomId,
        tenantName: name,
        tenureMonths: monthsBetween(startMs, nowMs),
        daysToEnd: endMs != null ? Math.floor((endMs - nowMs) / MS_PER_DAY) : null,
        inactiveDays: lastClaimMs != null ? Math.floor((nowMs - lastClaimMs) / MS_PER_DAY) : null,
        paymentLateCount: pd[key] ? pd[key].lateCount : null,
        complaintCount90d: (key in cc) ? cc[key] : null,
      });
    });
    return records;
  }

  // Archive parent docs → turnover entries. One query per building (admin read,
  // index-free). Cached separately from the Health card's reads.
  async function loadArchiveEntries() {
    const u = window._ins.utils;
    const cached = u.cacheGet('behavioral_archives');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const buildings = (window.BuildingRegistry?.list()?.map(b => b.id)) || ['rooms', 'nest'];
    const out = [];
    for (const building of buildings) {
      try {
        const snap = await getDocs(query(collection(db, `tenants/${building}/archive`), limit(500)));
        snap.forEach(d => {
          const data = d.data() || {};
          const lease = data.lease || {};
          out.push({
            building,
            roomId: data.sourceRoom?.roomId || data.roomId || d.id,
            moveInMs: _ms(lease.startDate || lease.moveInDate || data.moveInDate),
            archivedMs: _ms(data.archivedAt),
            reason: data.archivedReason || null,
          });
        });
      } catch (e) {
        console.warn('[behavioral-tenure] archive load failed for', building, e?.message || e);
      }
    }
    u.cacheSet('behavioral_archives', out);
    return out;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const TIER_META = {
    high:   { emoji: '🔴', label: 'เสี่ยงสูง',  color: `var(--alert,${typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f'})` },
    watch:  { emoji: '🟠', label: 'เฝ้าระวัง',  color: `var(--accent,${typeof DashColors !== 'undefined' ? DashColors.ORANGE_MED : '#d99a3f'})` },
    stable: { emoji: '🟢', label: 'อยู่ต่อ',    color: 'var(--green)' },
  };

  function _mo(m) { return m == null ? '—' : `${m} เดือน`; }

  function renderTenureInsights() {
    const u = window._ins.utils;
    const container = document.getElementById('dashBehavioralTenure');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([
      loadCurrentRecords(),
      loadArchiveEntries().catch(e => { console.warn('[behavioral-tenure] archives:', e); return []; }),
    ]).then(([records, archives]) => {
      const stats = computeTenureStats(records);
      const turnover = computeTurnover(archives, Date.now());
      const ranked = rankPropensity(records);
      const atRisk = ranked.filter(r => r.propensity.tier !== 'stable');

      const WHITE = typeof DashColors !== 'undefined' ? DashColors.WHITE : '#fff';
      const WARM = typeof DashColors !== 'undefined' ? DashColors.WARM_WHITE : '#efece6';

      // KPI row
      const kpi = (label, value, sub) => `
        <div style="flex:1;min-width:120px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
          <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
          ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
        </div>`;
      const turnoverRate = stats.count > 0
        ? Math.round(turnover.completed12mo / stats.count * 100)
        : 0;
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('อายุเช่าเฉลี่ย (ปัจจุบัน)', _mo(stats.avgMonths), `กลาง ${_mo(stats.medianMonths)}`)}
          ${kpi('อยู่ครบสัญญาเฉลี่ย', _mo(turnover.avgCompletedMonths), `จาก ${turnover.total} ครั้งที่ย้ายออก`)}
          ${kpi('ย้ายออก 12 เดือน', String(turnover.completed12mo), `≈ ${turnoverRate}% ของห้องที่มีผู้เช่า`)}
        </div>`;

      // Tenure distribution bars
      const b = stats.buckets;
      const distMax = Math.max(1, b.le3, b.le6, b.le12, b.gt12, b.unknown);
      const bar = (label, n, color) => `
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
          <span style="width:78px;font-size:.74rem;color:var(--text-muted);flex-shrink:0;">${label}</span>
          <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;">
            <div style="width:${Math.round(n / distMax * 100)}%;height:100%;background:${color};"></div>
          </div>
          <span style="width:24px;text-align:right;font-size:.76rem;font-weight:600;font-variant-numeric:tabular-nums;">${n}</span>
        </div>`;
      const distHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">การกระจายอายุการเช่า (ผู้เช่าปัจจุบัน)</div>
          ${bar('≤ 3 เดือน', b.le3, `var(--accent,${typeof DashColors !== 'undefined' ? DashColors.ORANGE_MED : '#d99a3f'})`)}
          ${bar('3–6 เดือน', b.le6, 'var(--blue)')}
          ${bar('6–12 เดือน', b.le12, 'var(--green)')}
          ${bar('> 12 เดือน', b.gt12, 'var(--green-dark)')}
          ${b.unknown ? bar('ไม่ทราบ', b.unknown, '#9ca3af') : ''}
        </div>`;

      // Propensity ranking (high + watch only)
      const propItems = atRisk.slice(0, 8).map(r => {
        const m = TIER_META[r.propensity.tier];
        const top = r.propensity.factors[0] || '';
        const more = r.propensity.factors.length > 1 ? ` <span style="color:var(--text-muted);">+${r.propensity.factors.length - 1}</span>` : '';
        return `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .2rem;border-bottom:1px solid var(--border-subtle,${WARM});">
            <span style="font-variant-numeric:tabular-nums;font-weight:700;color:${m.color};width:34px;text-align:center;flex-shrink:0;">${r.propensity.score}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.esc(r.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">${u.buildingLabel(r.building)}${r.tenantName ? ' · ' + u.esc(r.tenantName) : ''}</span></div>
              <div style="font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${u.esc(r.propensity.factors.join(' · '))}">${u.esc(top)}${more}</div>
            </div>
            <span style="font-size:.68rem;font-weight:600;color:${m.color};flex-shrink:0;">${m.emoji} ${m.label}</span>
          </div>`;
      }).join('');
      const propHTML = `
        <div>
          <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.4rem;">
            แนวโน้มย้ายออก ${atRisk.length > 0 ? `<span style="color:var(--alert,${typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f'});">(${atRisk.length} ห้อง)</span>` : ''}
          </div>
          ${atRisk.length === 0
            ? `<div style="text-align:center;color:var(--green-dark);padding:1rem;font-size:.82rem;">✅ ทุกห้องมีแนวโน้มอยู่ต่อ</div>`
            : propItems}
        </div>`;

      container.innerHTML = `
        <div class="card">
          <div class="card-title u-flex-sb">
            <span>📈 อายุการเช่า &amp; แนวโน้มย้ายออก</span>
            <button data-action="refreshInsight" data-target="behavioralTenure" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
            อายุการเช่าปัจจุบัน · สถิติการย้ายออกจริง (จากประวัติ) · จัดอันดับห้องที่มีแนวโน้มย้ายออก
          </div>
          ${kpiRow}
          ${distHTML}
          ${propHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>`;
    }).catch(e => {
      console.error('[behavioral-tenure] render failed:', e);
      container.innerHTML = u.errorHTML('behavioralTenure', e.message);
    });
  }

  // ── Register on namespace (compute fns exported for unit tests) ──────────
  window._ins = window._ins || {};
  window._ins.behavioralTenure = {
    renderTenureInsights,
    // pure (tested):
    monthsBetween, median, avg,
    computeTenureStats, computeTurnover, computeMovePropensity, rankPropensity,
  };
}());
