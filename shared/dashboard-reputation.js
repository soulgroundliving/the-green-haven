/**
 * dashboard-reputation.js
 * Trust System Phase 3.2a — Reputation card (ผู้เช่า / tenants tab, admin-only)
 *
 * Reads the server-computed `trustScores/{tenantId}` collection (admin-read rule,
 * firestore.rules) and ranks active tenants by reputation (0–100) with a factor
 * breakdown + provisional badge. Trust is computed SERVER-side (computeTrustScores
 * Scheduled daily 05:40 + recomputeTrustScores admin callable) — this card never
 * computes a score, only displays + offers a "recompute now" trigger.
 *
 * Names are joined from the shared 'tenants_all' cache (the Health card warms it on
 * this tab) — trustScores docs carry building/roomId but not the name.
 *
 * Compute fns are pure (no I/O) and exported on window._ins.reputation for unit
 * tests. Depends on window._ins.utils (dashboard-insights.js, loads first).
 *
 * §7-RR/II: no injected <style>, no inline <style> — inline style="" attrs only,
 * same as every sibling insights card (CSP-safe). §7-I: the recompute button is an
 * explicit admin click (never auto-fired); the CF is admin-gated server-side too.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'trust_scores';

  // ── PURE helpers (testable) ──────────────────────────────────────────────
  // Reputation tier from the 0–100 score. Thresholds are display-only (the score
  // itself is authoritative); keep them obvious so the chip colour reads at a glance.
  function repTier(score) {
    const s = score == null ? NaN : Number(score); // Number(null)===0 — guard null/undefined explicitly
    if (!isFinite(s)) return { key: 'none',  emoji: '⚪', label: '—',        color: 'var(--text-muted)' };
    if (s >= 80)      return { key: 'high',   emoji: '🟢', label: 'ดีเยี่ยม',  color: 'var(--green-dark)' };
    if (s >= 60)      return { key: 'good',   emoji: '🔵', label: 'ดี',        color: 'var(--blue)' };
    if (s >= 40)      return { key: 'fair',   emoji: '🟠', label: 'พอใช้',     color: `var(--accent,${typeof DashColors !== 'undefined' ? DashColors.ORANGE_MED : '#d99a3f'})` };
    return                   { key: 'low',    emoji: '🔴', label: 'ต่ำ',       color: `var(--alert,${typeof DashColors !== 'undefined' ? DashColors.TERRACOTTA : '#c0563f'})` };
  }

  /**
   * Summary over trustScores docs.
   * docs: [{ reputation, provisional, factors, building, roomId, tenantId }]
   * → { count, avg, provisionalCount, ratedCount, sorted:[...] (rep desc) }
   */
  function computeRepStats(docs) {
    const list = (docs || []).filter(d => d && d.reputation != null && isFinite(Number(d.reputation)));
    const reps = list.map(d => Number(d.reputation));
    const avg = reps.length ? Math.round(reps.reduce((s, n) => s + n, 0) / reps.length) : null;
    const provisionalCount = list.filter(d => d.provisional).length;
    const sorted = list.slice().sort((a, b) =>
      Number(b.reputation) - Number(a.reputation)
      || String(a.building + a.roomId).localeCompare(String(b.building + b.roomId)));
    return { count: list.length, avg, provisionalCount, ratedCount: list.length - provisionalCount, sorted };
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

  // building+roomId → tenant name, from the shared cache (best-effort).
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

  function renderReputation() {
    const u = window._ins.utils;
    const container = document.getElementById('dashReputation');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([loadTrustScores(), loadNameMap()]).then(([docs, nameMap]) => {
      const stats = computeRepStats(docs);
      const newestMs = docs.reduce((mx, d) => Math.max(mx, _tsMs(d.computedAt) || 0), 0);

      const recomputeBtn = `
        <button data-action="recomputeTrust" aria-label="คำนวณคะแนนใหม่"
                style="font-size:.72rem;padding:2px 10px;background:var(--green-dark);color:#fff;border:none;border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
          ⟳ คำนวณใหม่
        </button>`;

      const header = `
        <div class="card-title u-flex-sb">
          <span>🏅 คะแนนความน่าเชื่อถือ</span>
          ${recomputeBtn}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
          คะแนน 0–100 ต่อผู้เช่า — คำนวณฝั่งเซิร์ฟเวอร์จากการชำระตรงเวลา (60%) · ระยะเวลาเช่า (25%) · ไม่มีเรื่องร้องเรียน (15%)
        </div>`;

      if (stats.count === 0) {
        container.innerHTML = `
          <div class="card">
            ${header}
            <div style="text-align:center;padding:1.4rem 1rem;color:var(--text-muted);">
              <div style="font-size:1.6rem;margin-bottom:.4rem;">🏅</div>
              <div style="font-size:.86rem;margin-bottom:.2rem;">ยังไม่มีคะแนน</div>
              <div style="font-size:.74rem;">กด “⟳ คำนวณใหม่” เพื่อสร้างคะแนนจากข้อมูลปัจจุบัน (หรือรอรอบอัตโนมัติ 05:40 น.)</div>
            </div>
          </div>`;
        return;
      }

      // KPI row
      const kpi = (label, value, sub) => `
        <div style="flex:1;min-width:110px;background:var(--green-pale);border-radius:12px;padding:.6rem .8rem;">
          <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.15rem;">${label}</div>
          <div style="font-size:1.35rem;font-weight:700;color:var(--green-dark);font-variant-numeric:tabular-nums;">${value}</div>
          ${sub ? `<div style="font-size:.68rem;color:var(--text-muted);">${sub}</div>` : ''}
        </div>`;
      const kpiRow = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.9rem;">
          ${kpi('คะแนนเฉลี่ย', _f(stats.avg), `${stats.count} ผู้เช่า`)}
          ${kpi('คำนวณเต็มสูตร', String(stats.ratedCount), 'มีบิลให้ประเมิน')}
          ${kpi('คะแนนชั่วคราว', String(stats.provisionalCount), 'ยังไม่มีบิล')}
        </div>`;

      // Ranked tenant rows
      const rows = stats.sorted.slice(0, 20).map(d => {
        const t = repTier(d.reputation);
        const name = nameMap.get(`${d.building}:${d.roomId}`) || '';
        const fac = d.factors || {};
        const pay = d.provisional || fac.paymentScore == null
          ? `<span style="color:var(--text-muted);">💳 — (${_f(fac.onTimeBills)}✓/${_f(fac.lateBills)}✗)</span>`
          : `💳 ${fac.paymentScore} (${fac.onTimeBills}✓/${fac.lateBills}✗)`;
        const tenure = `📅 ${fac.tenureScore == null ? '—' : fac.tenureScore}`;
        const comp = `🙂 ${fac.complaintScore == null ? '—' : fac.complaintScore}`;
        // v2 engagement-consistency bonus — shown only when earned (additive, +N).
        const eng = Number(fac.engagementBonus) > 0
          ? ` · <span style="color:var(--green,#2d8653);font-weight:600;" title="โบนัสความสม่ำเสมอ: ใช้งาน ${_f(fac.engagementActiveWeeks)}/${_f(fac.engagementWindowWeeks)} สัปดาห์">⚡ +${fac.engagementBonus}</span>`
          : '';
        const prov = d.provisional
          ? ` <span style="font-size:.64rem;font-weight:600;color:var(--accent,${typeof DashColors !== 'undefined' ? DashColors.ORANGE_MED : '#d99a3f'});background:var(--green-pale);padding:1px 6px;border-radius:999px;">ชั่วคราว</span>`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .2rem;border-bottom:1px solid var(--border-subtle,${typeof DashColors !== 'undefined' ? DashColors.WARM_WHITE : '#efece6'});">
            <span style="font-variant-numeric:tabular-nums;font-weight:700;font-size:1.05rem;color:${t.color};width:38px;text-align:center;flex-shrink:0;">${d.reputation}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.esc(d.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">${u.buildingLabel(d.building)}${name ? ' · ' + u.esc(name) : ''}</span>${prov}</div>
              <div style="font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${pay} · ${tenure} · ${comp}${eng}</div>
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
      console.error('[reputation] render failed:', e);
      container.innerHTML = u.errorHTML('reputation', e.message);
    });
  }

  // Admin "recompute now" → the deployed recomputeTrustScores callable, then re-render.
  // §7-I: fired ONLY by an explicit admin button click; the CF re-checks admin claim.
  let _busy = false;
  async function recompute() {
    if (_busy) return;
    const u = window._ins.utils;
    const container = document.getElementById('dashReputation');
    const fn = window.firebase?.functions?.httpsCallable?.('recomputeTrustScores');
    if (!fn) { if (container) container.innerHTML = u.errorHTML('reputation', 'Firebase functions ยังไม่พร้อม'); return; }
    _busy = true;
    if (container) container.innerHTML = `<div class="card"><div style="text-align:center;padding:1.6rem;color:var(--text-muted);"><div class="gh-skeleton" style="height:18px;width:60%;border-radius:6px;margin:0 auto .6rem;"></div>⏳ กำลังคำนวณคะแนนจากข้อมูลล่าสุด…</div></div>`;
    try {
      const res = await fn();
      const r = (res && res.data) || {};
      u.cacheClear(CACHE_KEY);
      u.cacheClear('tenants_all');
      await renderReputation();
      if (typeof window.showToast === 'function') {
        window.showToast(`คำนวณคะแนนแล้ว: ${r.scored || 0} ผู้เช่า${r.provisional ? ` (ชั่วคราว ${r.provisional})` : ''}`, 'success');
      }
    } catch (e) {
      console.error('[reputation] recompute failed:', e);
      if (container) container.innerHTML = u.errorHTML('reputation', (e && e.message) || 'recompute failed');
    } finally {
      _busy = false;
    }
  }

  // ── Register on namespace (compute fns exported for unit tests) ───────────
  window._ins = window._ins || {};
  window._ins.reputation = {
    renderReputation,
    recompute,
    // pure (tested):
    repTier, computeRepStats,
  };
}());
