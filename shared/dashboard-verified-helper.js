/**
 * dashboard-verified-helper.js
 * Trust System / Meaning Layer #7 — Verified Helper card (ผู้เช่า / tenants tab, admin-only)
 *
 * Reads the server-computed `trustScores/{tenantId}` collection (admin-read rule,
 * firestore.rules) — the SAME docs the Reputation + Kindness cards read — and ranks
 * tenants by their Verified-Helper credential (0–100): a PEER-CONFIRMED helper score
 * from their `helpRequests` job history (count of requester-confirmed done jobs +
 * distinct requesters + appreciation tags). Computed SERVER-side (computeTrustScores
 * Scheduled daily 05:40 + recomputeTrustScores admin callable, which writes the
 * reputation + kindness + verified-helper fields together) — this card never computes,
 * only displays + offers a "recompute now" trigger.
 *
 * Distinct from Kindness (#6): Kindness sums the POINTS those completions earn
 * (generosity, capped); Verified Helper counts the JOBS themselves (competence,
 * uncapped) — see functions/_verifiedHelper.js. Trust ≠ points (§6).
 *
 * Positive framing (§7/§6): never "ต่ำ"/red — a tenant with few jobs is
 * `verifiedHelperProvisional` (newcomer/seed state), shown gently.
 *
 * Compute fns are pure (no I/O) and exported on window._ins.verifiedHelper for tests.
 * Depends on window._ins.utils (dashboard-insights.js, loads first). Shares the
 * 'trust_scores' cache with the Reputation + Kindness cards (one fetch serves all).
 *
 * §7-RR/II: no injected <style>, no inline <style> — inline style="" attrs only (CSP-safe).
 * §7-I: the recompute button is an explicit admin click; the CF is admin-gated server-side.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'trust_scores'; // same docs as the Reputation + Kindness cards

  // ── PURE helpers (testable) ──────────────────────────────────────────────
  // Verified-Helper display tier from the 0–100 score. POSITIVE-only (a helper
  // credential is never "bad" — just building). Aligned with the CF enum bounds
  // (functions/_verifiedHelper.js: 70/40/10) so admin + tenant read the same rungs.
  function vhTier(score) {
    const s = score == null ? NaN : Number(score); // Number(null)===0 — guard explicitly
    if (!isFinite(s)) return { key: 'none',     emoji: '⚪', label: '—',              color: 'var(--text-muted)' };
    if (s >= 70)      return { key: 'trusted',  emoji: '🛡️', label: 'ผู้ช่วยที่ไว้ใจได้', color: 'var(--green-dark)' };
    if (s >= 40)      return { key: 'seasoned', emoji: '🤝', label: 'มากประสบการณ์',   color: 'var(--green,#2d8653)' };
    if (s >= 10)      return { key: 'helper',   emoji: '🌟', label: 'ผู้ช่วยชุมชน',    color: 'var(--green,#2d8653)' };
    if (s > 0)        return { key: 'newcomer', emoji: '🌱', label: 'กำลังสร้างชื่อ',   color: 'var(--green-dark,#3a5a44)' };
    return                   { key: 'seed',     emoji: '🌱', label: 'ยังไม่เริ่ม',     color: 'var(--text-muted)' };
  }

  /**
   * Summary over trustScores docs (verified-helper fields).
   * docs: [{ verifiedHelper, verifiedHelperProvisional, verifiedHelperFactors:{completedCount,distinctRequesters,...}, building, roomId }]
   * → { count, helpersCount, avgHelpers, totalJobs, sorted:[...helpers, score desc] }
   * "Helpers" = tenants with ≥1 confirmed done job (completedCount>0); ranking + avg
   * use helpers only so a building full of 0s doesn't drown the signal.
   */
  function computeVHStats(docs) {
    const list = (docs || []).filter(d => d && d.verifiedHelper != null && isFinite(Number(d.verifiedHelper)));
    const jobs = (d) => Number((d.verifiedHelperFactors || {}).completedCount) || 0;
    const helpers = list.filter(d => jobs(d) > 0);
    const ss = helpers.map(d => Number(d.verifiedHelper));
    const avgHelpers = ss.length ? Math.round(ss.reduce((s, n) => s + n, 0) / ss.length) : null;
    const totalJobs = list.reduce((s, d) => s + jobs(d), 0);
    const sorted = helpers.slice().sort((a, b) =>
      Number(b.verifiedHelper) - Number(a.verifiedHelper)
      || jobs(b) - jobs(a)
      || String(a.building + a.roomId).localeCompare(String(b.building + b.roomId)));
    return { count: list.length, helpersCount: helpers.length, avgHelpers, totalJobs, sorted };
  }

  // ── Impure loaders (browser-only) ────────────────────────────────────────
  async function loadTrustScores() {
    const u = window._ins.utils;
    const cached = u.cacheGet(CACHE_KEY);
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const snap = await getDocs(query(collection(db, 'trustScores'), limit(500)));
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    u.cacheSet(CACHE_KEY, out);
    return out;
  }

  async function loadNameMap() {
    try {
      const tenants = await window._ins.utils.loadAllTenantDocs();
      const map = new Map();
      tenants.forEach(t => { map.set(`${t.building}:${t.roomId}`, t.name || (t.lease && t.lease.tenantName) || ''); });
      return map;
    } catch (_) { return new Map(); }
  }

  function _tsMs(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') { const d = v.toDate(); return d ? d.getTime() : null; }
    const t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function _f(n) { return n == null ? '—' : String(n); }

  function renderVerifiedHelper() {
    const u = window._ins.utils;
    const container = document.getElementById('dashVerifiedHelper');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([loadTrustScores(), loadNameMap()]).then(([docs, nameMap]) => {
      const stats = computeVHStats(docs);
      const newestMs = docs.reduce((mx, d) => Math.max(mx, _tsMs(d.computedAt) || 0), 0);

      const recomputeBtn = `
        <button data-action="recomputeVerifiedHelper" aria-label="คำนวณคะแนนผู้ช่วยใหม่"
                style="font-size:.72rem;padding:2px 10px;background:var(--green-dark);color:#fff;border:none;border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
          ⟳ คำนวณใหม่
        </button>`;

      const header = `
        <div class="card-title u-flex-sb">
          <span>🛡️ ผู้ช่วยที่ได้รับการยืนยัน</span>
          ${recomputeBtn}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
          คะแนน 0–100 ต่อผู้เช่า — จากงานช่วยเหลือที่ผู้ขอ “ยืนยันเสร็จ” แล้ว: จำนวนงาน + จำนวนเพื่อนบ้านที่ช่วย + คำชม
        </div>`;

      if (stats.helpersCount === 0) {
        container.innerHTML = `
          <div class="card">
            ${header}
            <div style="text-align:center;padding:1.4rem 1rem;color:var(--text-muted);">
              <div style="font-size:1.6rem;margin-bottom:.4rem;">🛡️</div>
              <div style="font-size:.86rem;margin-bottom:.2rem;">ยังไม่มีงานช่วยเหลือที่ยืนยันแล้ว</div>
              <div style="font-size:.74rem;">คะแนนจะปรากฏเมื่อมีงานในกระดานช่วยเหลือที่ผู้ขอยืนยันว่าเสร็จ${stats.count ? ` (สแกน ${stats.count} ผู้เช่า)` : ''} — กด “⟳ คำนวณใหม่” หรือรอรอบอัตโนมัติ 05:40 น.</div>
            </div>
          </div>`;
        return;
      }

      const kpi = (label, value, sub) => `
        <div style="flex:1;min-width:110px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
          <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
          ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
        </div>`;
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('ผู้ช่วยที่ยืนยันแล้ว', String(stats.helpersCount), `จาก ${stats.count} ผู้เช่า`)}
          ${kpi('คะแนนเฉลี่ย', _f(stats.avgHelpers), 'เฉพาะผู้ช่วย')}
          ${kpi('งานที่ช่วยรวม', String(stats.totalJobs), 'งาน')}
        </div>`;

      const rows = stats.sorted.slice(0, 20).map(d => {
        const t = vhTier(d.verifiedHelper);
        const name = nameMap.get(`${d.building}:${d.roomId}`) || '';
        const fac = d.verifiedHelperFactors || {};
        const brk = `✅ ${_f(fac.completedCount)} งาน · 👥 ${_f(fac.distinctRequesters)} คน · 💬 ${_f(fac.totalTags)}`;
        const prov = d.verifiedHelperProvisional
          ? ` <span style="font-size:.64rem;font-weight:600;color:var(--green-dark);background:var(--green-pale);padding:1px 6px;border-radius:999px;">เริ่มต้น</span>`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .2rem;border-bottom:1px solid var(--border-subtle,${typeof DashColors !== 'undefined' ? DashColors.WARM_WHITE : '#efece6'});">
            <span style="font-variant-numeric:tabular-nums;font-weight:700;font-size:1.05rem;color:${t.color};width:38px;text-align:center;flex-shrink:0;">${d.verifiedHelper}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.esc(d.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">${u.buildingLabel(d.building)}${name ? ' · ' + u.esc(name) : ''}</span>${prov}</div>
              <div style="font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${brk}</div>
            </div>
            <span style="font-size:.68rem;font-weight:600;color:${t.color};flex-shrink:0;">${t.emoji} ${t.label}</span>
          </div>`;
      }).join('');

      container.innerHTML = `
        <div class="card">
          ${header}
          ${kpiRow}
          <div>${rows}</div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">
            ${newestMs ? u.fmtCacheAge(newestMs) : ''}
          </div>
        </div>`;
    }).catch(e => {
      console.error('[verified-helper] render failed:', e);
      container.innerHTML = u.errorHTML('verifiedHelper', e.message);
    });
  }

  // Admin "recompute now" → recomputeTrustScores callable (writes reputation +
  // kindness + verified-helper), then re-render the sibling cards. §7-I explicit click.
  let _busy = false;
  async function recompute() {
    if (_busy) return;
    const u = window._ins.utils;
    const container = document.getElementById('dashVerifiedHelper');
    const fn = window.firebase?.functions?.httpsCallable?.('recomputeTrustScores');
    if (!fn) { if (container) container.innerHTML = u.errorHTML('verifiedHelper', 'Firebase functions ยังไม่พร้อม'); return; }
    _busy = true;
    if (container) container.innerHTML = `<div class="card"><div style="text-align:center;padding:1.6rem;color:var(--text-muted);"><div class="gh-skeleton" style="height:18px;width:60%;border-radius:6px;margin:0 auto .6rem;"></div>⏳ กำลังคำนวณคะแนนผู้ช่วยจากข้อมูลล่าสุด…</div></div>`;
    try {
      const res = await fn();
      const r = (res && res.data) || {};
      u.cacheClear(CACHE_KEY);
      u.cacheClear('tenants_all');
      await renderVerifiedHelper();
      // The CF updated reputation + kindness too — refresh those cards if mounted.
      for (const sib of ['reputation', 'kindness']) {
        const m = window._ins[sib];
        const render = m && (m[`render${sib[0].toUpperCase()}${sib.slice(1)}`]);
        if (typeof render === 'function') { try { await render(); } catch (_) { /* noop */ } }
      }
      if (typeof window.showToast === 'function') {
        window.showToast(`คำนวณคะแนนแล้ว: ${r.scored || 0} ผู้เช่า`, 'success');
      }
    } catch (e) {
      console.error('[verified-helper] recompute failed:', e);
      if (container) container.innerHTML = u.errorHTML('verifiedHelper', (e && e.message) || 'recompute failed');
    } finally {
      _busy = false;
    }
  }

  // ── Register on namespace (compute fns exported for unit tests) ───────────
  window._ins = window._ins || {};
  window._ins.verifiedHelper = {
    renderVerifiedHelper,
    recompute,
    // pure (tested):
    vhTier, computeVHStats,
  };
}());
