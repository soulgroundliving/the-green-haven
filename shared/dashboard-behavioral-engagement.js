/**
 * dashboard-behavioral-engagement.js
 * Phase 3.1 Behavioral Intelligence — Community Engagement Trend (community tab)
 *
 * The FIRST card to read `pointsLedger` (Core Readiness Phase 0) as a TIME-SERIES.
 * The ledger is the append-only log of every gamification point movement
 * ({tenantId, source, points (signed), at}); before it existed only "who has the
 * most points NOW" was answerable. This card answers "whose engagement rose or
 * fell over time" — the roadmap's headline unlock.
 *
 * Read: one admin query `where at >= now-90d, orderBy at desc, limit N` (rules:755).
 * Single-field `at` index (auto) — no composite needed. Bounded + logged (no silent
 * cap). occupiedCount + name map reuse the warmed 'tenants_all' cache (0 extra reads).
 *
 * Compute fns are pure (no I/O) and exported on window._ins.behavioralEngagement for
 * unit tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-RR/II: inline style="" attrs only, no injected/inline <style> block (CSP-safe).
 */
(function () {
  'use strict';

  const MS_PER_DAY = 86400000;
  const LEDGER_LIMIT = 3000;      // bound the read; log if hit (no silent cap)
  const TOP_N = 5;

  // Earning sources (positive points). 'redeem' is a spend → tracked separately,
  // never counted as engagement. Mirrors _pointsLedger.js VALID_SOURCES.
  const SOURCE_LABEL = {
    daily_login: 'เช็คอินรายวัน',
    wellness_quiz: 'ควิซสุขภาพ',
    contract_quiz: 'ควิซสัญญา',
    complaint_free_month: 'เดือนไร้ร้องเรียน',
    payment: 'จ่ายตรงเวลา',
    redeem: 'แลกรางวัล',
    quest: 'เควสต์',
    help_completed: 'น้ำใจ',
  };

  // ── PURE compute (testable) ─────────────────────────────────────────────
  /**
   * events: [{ tenantId, source, points (signed), atMs }]
   * → engagement aggregates over a recent vs prior 30-day window + 90-day totals.
   * opts: { occupiedCount }
   */
  function computeEngagement(events, nowMs, opts) {
    const occupiedCount = (opts && opts.occupiedCount) || 0;
    const now = nowMs || 0;
    const cut30 = now - 30 * MS_PER_DAY;
    const cut60 = now - 60 * MS_PER_DAY;
    const cut90 = now - 90 * MS_PER_DAY;

    const perTenant = new Map(); // tenantId → { recent, prior }
    const bySource = new Map();  // source → points (recent 30d, earning only)
    let totalEarned30 = 0, totalEarned90 = 0, redeemed30 = 0;

    (events || []).forEach(e => {
      if (!e || e.atMs == null || !isFinite(e.atMs) || e.atMs < cut90) return;
      const pts = Number(e.points) || 0;
      const tid = e.tenantId != null ? String(e.tenantId) : '';
      if (pts < 0) {
        if (e.atMs >= cut30) redeemed30 += -pts;
        return; // spend — not engagement
      }
      if (pts === 0) return;
      // earning
      totalEarned90 += pts;
      if (e.atMs >= cut30) {
        totalEarned30 += pts;
        bySource.set(e.source, (bySource.get(e.source) || 0) + pts);
      }
      if (!tid) return;
      let rec = perTenant.get(tid);
      if (!rec) { rec = { recent: 0, prior: 0 }; perTenant.set(tid, rec); }
      if (e.atMs >= cut30) rec.recent += pts;
      else if (e.atMs >= cut60) rec.prior += pts;
    });

    const activeParticipants30 = Array.from(perTenant.values()).filter(r => r.recent > 0).length;
    const participationPct = occupiedCount > 0
      ? Math.round(activeParticipants30 / occupiedCount * 100)
      : null;
    const avgPerActive = activeParticipants30 > 0
      ? Math.round(totalEarned30 / activeParticipants30)
      : 0;

    const sourceTotal = Array.from(bySource.values()).reduce((s, n) => s + n, 0);
    const bySource30 = Array.from(bySource.entries())
      .map(([source, points]) => ({ source, points, pct: sourceTotal ? Math.round(points / sourceTotal * 100) : 0 }))
      .sort((a, b) => b.points - a.points);

    // Movers: Δ = recent − prior. Risers: Δ>0. Fallers: had prior activity, Δ<0.
    const deltas = Array.from(perTenant.entries())
      .map(([tenantId, r]) => ({ tenantId, recent: r.recent, prior: r.prior, delta: r.recent - r.prior }));
    const risers = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, TOP_N);
    const fallers = deltas.filter(d => d.delta < 0 && d.prior > 0).sort((a, b) => a.delta - b.delta).slice(0, TOP_N);

    return {
      activeParticipants30, participationPct, avgPerActive,
      totalEarned30, totalEarned90, redeemed30,
      bySource30, movers: { risers, fallers },
    };
  }

  // ── Impure loaders (browser-only) ───────────────────────────────────────
  function _ms(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') { const d = v.toDate(); return d ? d.getTime() : null; }
    const t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  async function loadLedger() {
    const u = window._ins.utils;
    const cached = u.cacheGet('engagement_ledger');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, where, orderBy, limit } = window.firebase.firestoreFunctions;
    const cutoff = new Date(Date.now() - 90 * MS_PER_DAY);
    const snap = await getDocs(query(
      collection(db, 'pointsLedger'),
      where('at', '>=', cutoff),
      orderBy('at', 'desc'),
      limit(LEDGER_LIMIT)
    ));
    if (snap.size >= LEDGER_LIMIT) {
      console.warn(`[behavioral-engagement] ledger read hit the ${LEDGER_LIMIT} cap — older events in the 90d window are not included this render.`);
    }
    const events = [];
    snap.forEach(d => {
      const data = d.data() || {};
      events.push({ tenantId: data.tenantId, source: data.source, points: data.points, atMs: _ms(data.at) });
    });
    u.cacheSet('engagement_ledger', events);
    return events;
  }

  // tenantId → { name, roomId, building } from current tenant docs. Ledger tenantId
  // is `tenant.tenantId` OR synthetic `${building}_${roomId}` (claimDailyLoginPoints).
  async function loadContext() {
    const u = window._ins.utils;
    const tenants = await u.loadAllTenantDocs();
    const nameMap = new Map();
    let occupiedCount = 0;
    tenants.forEach(t => {
      const lease = t.lease || {};
      const name = t.name || lease.tenantName || '';
      const hasTenant = !!(name || t.phone);
      if (!hasTenant) return;
      occupiedCount++;
      const info = { name, roomId: t.roomId, building: t.building };
      const tid = t.tenantId || lease.tenantId;
      if (tid) nameMap.set(String(tid), info);
      nameMap.set(`${t.building}_${t.roomId}`, info); // synthetic fallback key
    });
    return { nameMap, occupiedCount };
  }

  function _resolveName(tenantId, nameMap) {
    const info = nameMap.get(String(tenantId));
    if (info) return { label: info.roomId, name: info.name };
    // people/ id → PersonManager sync cache, else a short id
    const p = window.PersonManager?.getPersonSync?.(tenantId);
    const pname = p && (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim());
    if (pname) return { label: pname, name: '' };
    const s = String(tenantId || '');
    return { label: s.length > 10 ? s.slice(0, 8) + '…' : (s || '—'), name: '' };
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function renderEngagementTrend() {
    const u = window._ins.utils;
    const container = document.getElementById('dashEngagementTrend');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([loadLedger(), loadContext()])
      .then(([events, ctx]) => {
        const e = computeEngagement(events, Date.now(), { occupiedCount: ctx.occupiedCount });
        const GOLD = 'var(--accent-gold,#D4AF37)';

        const kpi = (label, value, sub) => `
          <div style="flex:1;min-width:120px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
            <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
            ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
          </div>`;
        const kpiRow = `
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
            ${kpi('มีส่วนร่วม (30 วัน)', String(e.activeParticipants30),
                  e.participationPct != null ? `${e.participationPct}% ของผู้เช่า` : 'แต้มที่ได้รับ')}
            ${kpi('แต้มสะสมรวม (30 วัน)', e.totalEarned30.toLocaleString(), `เฉลี่ย ${e.avgPerActive.toLocaleString()}/คน`)}
            ${kpi('แลกรางวัล (30 วัน)', e.redeemed30.toLocaleString(), `90 วัน: ${e.totalEarned90.toLocaleString()} แต้ม`)}
          </div>`;

        // Source breakdown
        const srcMax = Math.max(1, ...e.bySource30.map(s => s.points));
        const srcBars = e.bySource30.length === 0
          ? `<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem 0;">ยังไม่มีการได้รับแต้มใน 30 วัน</div>`
          : e.bySource30.map(s => `
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
              <span style="width:110px;font-size:.74rem;color:var(--text-muted);flex-shrink:0;">${u.esc(SOURCE_LABEL[s.source] || s.source)}</span>
              <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;">
                <div style="width:${Math.round(s.points / srcMax * 100)}%;height:100%;background:${GOLD};"></div>
              </div>
              <span style="width:54px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;">${s.points.toLocaleString()}</span>
            </div>`).join('');
        const srcHTML = `
          <div style="margin-bottom:1rem;">
            <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">แต้มมาจากไหน (30 วัน)</div>
            ${srcBars}
          </div>`;

        // Movers
        const moverRow = (m, arrow, color) => {
          const r = _resolveName(m.tenantId, ctx.nameMap);
          const who = r.name ? `${u.esc(r.label)} <span style="color:var(--text-muted);font-size:.72rem;">${u.esc(r.name)}</span>` : u.esc(r.label);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem .2rem;border-bottom:1px solid var(--border-subtle,#efece6);">
            <span style="font-size:.82rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${who}</span>
            <span style="font-size:.8rem;font-weight:700;color:${color};font-variant-numeric:tabular-nums;flex-shrink:0;">${arrow} ${m.delta > 0 ? '+' : ''}${m.delta.toLocaleString()}</span>
          </div>`;
        };
        const risersHTML = e.movers.risers.length
          ? e.movers.risers.map(m => moverRow(m, '📈', 'var(--green-dark)')).join('')
          : `<div style="color:var(--text-muted);font-size:.78rem;padding:.4rem 0;">—</div>`;
        const fallersHTML = e.movers.fallers.length
          ? e.movers.fallers.map(m => moverRow(m, '📉', `var(--alert,${typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f'})`)).join('')
          : `<div style="color:var(--text-muted);font-size:.78rem;padding:.4rem 0;">—</div>`;
        const moversHTML = `
          <div style="display:grid;grid-template-columns:1fr;gap:.8rem;">
            <div>
              <div style="font-size:.78rem;font-weight:600;color:var(--green-dark);margin-bottom:.3rem;">📈 มีส่วนร่วมเพิ่มขึ้น <span style="color:var(--text-muted);font-weight:400;font-size:.72rem;">(เทียบ 30 วันก่อน)</span></div>
              ${risersHTML}
            </div>
            <div>
              <div style="font-size:.78rem;font-weight:600;color:var(--alert,${typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f'});margin-bottom:.3rem;">📉 มีส่วนร่วมลดลง</div>
              ${fallersHTML}
            </div>
          </div>`;

        container.innerHTML = `
          <div class="card" style="border-left:4px solid var(--accent-gold,#D4AF37);">
            <div class="card-title u-flex-sb">
              <span>📊 แนวโน้มการมีส่วนร่วม</span>
              <button data-action="refreshInsight" data-target="engagementTrend" aria-label="รีเฟรช"
                      style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
            </div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
              การมีส่วนร่วมของผู้เช่าจาก pointsLedger · ใครขยับขึ้น/ลงเทียบกับช่วงก่อน
            </div>
            ${kpiRow}
            ${srcHTML}
            ${moversHTML}
            <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
          </div>`;
      })
      .catch(err => {
        console.error('[behavioral-engagement] render failed:', err);
        container.innerHTML = u.errorHTML('engagementTrend', err.message);
      });
  }

  // ── Register on namespace (compute exported for unit tests) ──────────────
  window._ins = window._ins || {};
  window._ins.behavioralEngagement = {
    renderEngagementTrend,
    computeEngagement,
    SOURCE_LABEL,
  };
}());
