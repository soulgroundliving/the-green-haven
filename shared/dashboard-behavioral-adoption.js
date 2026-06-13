/**
 * dashboard-behavioral-adoption.js
 * Behavioral Analytics Phase 1c — Dead-feature detector (operations tab)
 *
 * Reads the identity-free `behavioralRollup/adoption` aggregate (written daily by
 * rollupBehaviorEventsScheduled, Phase 1b) and shows which tenant features/pages are
 * actually used: adoption % (distinct rooms / occupied) per page + top actions,
 * flagging near-zero-adoption pages as DEAD ("เงียบ"). The killer use case — "we
 * shipped #X; do tenants touch it?".
 *
 * The doc carries COUNTS only (no room ids) → zero PII. Reads one doc (getDoc),
 * cached via window._ins.utils (mirrors dashboard-reputation.js).
 *
 * §7-RR/II: inline style="" attrs only, no injected <style> (CSP-safe).
 * §7-X: every innerHTML has an empty-state branch.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'behavioral_adoption';
  const DEAD_PCT = 10;       // < this % of occupied rooms in the window = a "dead" feature
  const TOP_ACTIONS = 12;

  // ── PURE (testable) ────────────────────────────────────────────────────────
  // items: [{k,count,rooms,pct}] (already sorted by the rollup). Split live vs dead.
  function splitByAdoption(items, deadPct) {
    const live = [], dead = [];
    (items || []).forEach((it) => {
      if (it && it.pct != null && it.pct < deadPct) dead.push(it);
      else live.push(it);
    });
    return { live, dead };
  }

  // ── load (single aggregate doc, cached) ────────────────────────────────────
  async function loadRollup() {
    const u = window._ins.utils;
    const cached = u.cacheGet(CACHE_KEY);
    if (cached) return cached;            // real data OR the {_missing:true} sentinel
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { doc, getDoc } = window.firebase.firestoreFunctions;
    const snap = await getDoc(doc(db, 'behavioralRollup', 'adoption'));
    const data = snap.exists() ? snap.data() : { _missing: true };
    u.cacheSet(CACHE_KEY, data);
    return data;
  }

  // ── render ──────────────────────────────────────────────────────────────────
  function renderAdoption() {
    const u = window._ins.utils;
    const container = document.getElementById('dashBehavioralAdoption');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    const GOLD = 'var(--accent-gold,#D4AF37)';
    const TERRA = 'var(--alert,' + (typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f') + ')';
    const refreshBtn = `<button data-action="refreshInsight" data-target="behavioralAdoption" aria-label="รีเฟรช"
        style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>`;

    return loadRollup()
      .then((data) => {
        if (!data || data._missing || !data.totalEvents) {
          container.innerHTML = `
            <div class="card" style="border-left:4px solid ${GOLD};">
              <div class="card-title u-flex-sb"><span>🔍 ฟีเจอร์ที่คนใช้ / เงียบ</span>${refreshBtn}</div>
              <div style="color:var(--text-muted);font-size:.82rem;padding:.8rem 0;">ยังไม่มีข้อมูลพฤติกรรม — รอ rollup รอบแรก (รายวัน 05:20) หลังผู้เช่าเริ่มใช้แอป</div>
            </div>`;
          return;
        }

        const occ = data.occupiedRooms || 0;
        const pages = Array.isArray(data.pages) ? data.pages : [];
        const actions = Array.isArray(data.actions) ? data.actions : [];
        const dead = splitByAdoption(pages, DEAD_PCT).dead;

        const kpi = (label, value, sub) => `
          <div style="flex:1;min-width:104px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
            <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
            ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
          </div>`;
        const kpiRow = `
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
            ${kpi('ห้องที่ active', `${data.activeRooms || 0}${occ ? '/' + occ : ''}`, 'ใน ' + (data.windowDays || 30) + ' วัน')}
            ${kpi('ฟีเจอร์ที่มีคนเปิด', String(pages.length), `${data.totalEvents.toLocaleString()} events`)}
            ${kpi('ฟีเจอร์ที่เงียบ', String(dead.length), `< ${DEAD_PCT}% ของห้อง`)}
          </div>`;

        // Page adoption — all pages, sorted by the rollup (highest first); dead flagged.
        const pageRow = (it) => {
          const isDead = it.pct != null && it.pct < DEAD_PCT;
          const pct = it.pct == null ? 0 : it.pct;
          const color = isDead ? TERRA : GOLD;
          return `
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">
              <span style="width:120px;font-size:.74rem;color:var(--ink,#1f1f1c);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.esc(it.k)}</span>
              <div style="flex:1;height:14px;background:var(--mist,#f2f1ec);border-radius:7px;overflow:hidden;">
                <div style="width:${Math.min(100, pct)}%;height:100%;background:${color};"></div>
              </div>
              <span style="width:74px;text-align:right;font-size:.74rem;font-weight:600;font-variant-numeric:tabular-nums;color:${isDead ? TERRA : 'inherit'};">${it.pct == null ? '—' : it.pct + '%'} <span style="color:var(--text-muted);font-weight:400;">(${it.rooms})</span></span>
            </div>`;
        };
        const pagesHTML = pages.length === 0
          ? `<div style="color:var(--text-muted);font-size:.8rem;padding:.4rem 0;">ยังไม่มี page view</div>`
          : pages.map(pageRow).join('');

        const actionRows = actions.slice(0, TOP_ACTIONS).map((a) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:.28rem .2rem;border-bottom:1px solid var(--border-subtle,#efece6);">
            <span style="font-size:.78rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.esc(a.k)}</span>
            <span style="font-size:.76rem;font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0;">${a.count.toLocaleString()} <span style="color:var(--text-muted);font-weight:400;">· ${a.rooms} ห้อง</span></span>
          </div>`).join('');
        const actionsHTML = actions.length === 0
          ? `<div style="color:var(--text-muted);font-size:.78rem;padding:.4rem 0;">—</div>`
          : actionRows;

        container.innerHTML = `
          <div class="card" style="border-left:4px solid ${GOLD};">
            <div class="card-title u-flex-sb"><span>🔍 ฟีเจอร์ที่คนใช้ / เงียบ</span>${refreshBtn}</div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
              ผู้เช่าเปิดหน้าไหน/กดอะไรจริง · adoption = ห้องที่ใช้ ÷ ห้องที่มีผู้เช่า (${data.windowDays || 30} วัน)
            </div>
            ${kpiRow}
            <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin-bottom:.5rem;">หน้าที่คนเปิด (adoption %)</div>
            ${pagesHTML}
            <div style="font-size:.78rem;font-weight:600;color:var(--ink,#1f1f1c);margin:1rem 0 .4rem;">การกระทำยอดนิยม</div>
            ${actionsHTML}
            <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
          </div>`;
      })
      .catch((err) => {
        console.error('[behavioral-adoption] render failed:', err);
        container.innerHTML = u.errorHTML('behavioralAdoption', err.message);
      });
  }

  // ── register (compute exported for unit tests) ──────────────────────────────
  window._ins = window._ins || {};
  window._ins.behavioralAdoption = {
    renderAdoption,
    splitByAdoption,
    DEAD_PCT,
  };
}());
