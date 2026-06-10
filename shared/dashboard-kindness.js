/**
 * dashboard-kindness.js
 * Trust System / Meaning Layer #6 — Kindness card (ผู้เช่า / tenants tab, admin-only)
 *
 * Reads the server-computed `trustScores/{tenantId}` collection (admin-read rule,
 * firestore.rules) — the SAME docs the Reputation card reads — and ranks tenants by
 * their kindness (0–100): generosity summed from peer-confirmed giving (quests,
 * food-share, helper-requests). Kindness is computed SERVER-side (computeTrustScores
 * Scheduled daily 05:40 + recomputeTrustScores admin callable, which writes BOTH the
 * reputation AND kindness fields) — this card never computes a score, only displays +
 * offers a "recompute now" trigger.
 *
 * Positive framing (§6): kindness is never "ต่ำ"/red — only "more" or "building". A
 * tenant with few kind acts is `kindnessProvisional` (seed state), shown gently.
 *
 * Compute fns are pure (no I/O) and exported on window._ins.kindness for unit tests.
 * Depends on window._ins.utils (dashboard-insights.js, loads first). Shares the
 * 'trust_scores' cache with the Reputation card (one fetch serves both).
 *
 * §7-RR/II: no injected <style>, no inline <style> — inline style="" attrs only (CSP-safe).
 * §7-I: the recompute button is an explicit admin click; the CF is admin-gated server-side.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'trust_scores'; // same docs as the Reputation card → shared cache

  // ── PURE helpers (testable) ──────────────────────────────────────────────
  // Kindness tier from the 0–100 score. POSITIVE-only palette (generosity is never
  // "bad" — just building). Thresholds are display-only; the score is authoritative.
  function kindTier(score) {
    const s = score == null ? NaN : Number(score); // Number(null)===0 — guard explicitly
    if (!isFinite(s)) return { key: 'none', emoji: '⚪', label: '—',           color: 'var(--text-muted)' };
    if (s >= 70)      return { key: 'radiant', emoji: '💚', label: 'น้ำใจล้น',  color: 'var(--green-dark)' };
    if (s >= 40)      return { key: 'warm',    emoji: '🌿', label: 'ใจดี',      color: 'var(--green,#2d8653)' };
    if (s >= 10)      return { key: 'kind',    emoji: '🤲', label: 'มีน้ำใจ',   color: 'var(--green,#2d8653)' };
    if (s > 0)        return { key: 'budding', emoji: '🌱', label: 'เริ่มแบ่งปัน', color: 'var(--green-dark,#3a5a44)' };
    return                   { key: 'seed',    emoji: '🌱', label: 'ยังไม่เริ่ม', color: 'var(--text-muted)' };
  }

  /**
   * Summary over trustScores docs (kindness fields).
   * docs: [{ kindness, kindnessProvisional, kindnessFactors:{totalEvents,...}, building, roomId }]
   * → { count, giversCount, avgGivers, totalActs, sorted:[...givers, kindness desc] }
   * "Givers" = tenants with ≥1 kind act (totalEvents>0); ranking + avg use givers only
   * so a building full of 0s doesn't drown the signal (avg over all 0s is meaningless).
   */
  function computeKindStats(docs) {
    const list = (docs || []).filter(d => d && d.kindness != null && isFinite(Number(d.kindness)));
    const acts = (d) => Number((d.kindnessFactors || {}).totalEvents) || 0;
    const givers = list.filter(d => acts(d) > 0);
    const ks = givers.map(d => Number(d.kindness));
    const avgGivers = ks.length ? Math.round(ks.reduce((s, n) => s + n, 0) / ks.length) : null;
    const totalActs = list.reduce((s, d) => s + acts(d), 0);
    const sorted = givers.slice().sort((a, b) =>
      Number(b.kindness) - Number(a.kindness)
      || acts(b) - acts(a)
      || String(a.building + a.roomId).localeCompare(String(b.building + b.roomId)));
    return { count: list.length, giversCount: givers.length, avgGivers, totalActs, sorted };
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

  function renderKindness() {
    const u = window._ins.utils;
    const container = document.getElementById('dashKindness');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([loadTrustScores(), loadNameMap()]).then(([docs, nameMap]) => {
      const stats = computeKindStats(docs);
      const newestMs = docs.reduce((mx, d) => Math.max(mx, _tsMs(d.computedAt) || 0), 0);

      const recomputeBtn = `
        <button data-action="recomputeKindness" aria-label="คำนวณคะแนนน้ำใจใหม่"
                style="font-size:.72rem;padding:2px 10px;background:var(--green-dark);color:#fff;border:none;border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
          ⟳ คำนวณใหม่
        </button>`;

      const header = `
        <div class="card-title u-flex-sb">
          <span>💚 คะแนนน้ำใจ</span>
          ${recomputeBtn}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
          คะแนน 0–100 ต่อผู้เช่า — รวมการกระทำมีน้ำใจที่เพื่อนบ้านยืนยัน: เควส · แบ่งปันอาหาร · ช่วยเหลือเพื่อนบ้าน
        </div>`;

      if (stats.giversCount === 0) {
        container.innerHTML = `
          <div class="card">
            ${header}
            <div style="text-align:center;padding:1.4rem 1rem;color:var(--text-muted);">
              <div style="font-size:1.6rem;margin-bottom:.4rem;">💚</div>
              <div style="font-size:.86rem;margin-bottom:.2rem;">ยังไม่มีกิจกรรมน้ำใจ</div>
              <div style="font-size:.74rem;">คะแนนจะปรากฏเมื่อมีเควส / แบ่งปันอาหาร / ช่วยเหลือที่ยืนยันแล้ว${stats.count ? ` (สแกน ${stats.count} ผู้เช่า)` : ''} — กด “⟳ คำนวณใหม่” หรือรอรอบอัตโนมัติ 05:40 น.</div>
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
          ${kpi('ผู้มีน้ำใจ', String(stats.giversCount), `จาก ${stats.count} ผู้เช่า`)}
          ${kpi('คะแนนเฉลี่ย', _f(stats.avgGivers), 'เฉพาะผู้ให้')}
          ${kpi('กิจกรรมน้ำใจรวม', String(stats.totalActs), 'ครั้ง')}
        </div>`;

      // Ranked giver rows (kindness desc)
      const rows = stats.sorted.slice(0, 20).map(d => {
        const t = kindTier(d.kindness);
        const name = nameMap.get(`${d.building}:${d.roomId}`) || '';
        const fac = d.kindnessFactors || {};
        const brk = `🎯 ${_f(fac.questCount)} · 🍲 ${_f(fac.foodShareCount)} · 🤝 ${_f(fac.helpCompletedCount)}`;
        const prov = d.kindnessProvisional
          ? ` <span style="font-size:.64rem;font-weight:600;color:var(--green-dark);background:var(--green-pale);padding:1px 6px;border-radius:999px;">เริ่มต้น</span>`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .2rem;border-bottom:1px solid var(--border-subtle,${typeof DashColors !== 'undefined' ? DashColors.WARM_WHITE : '#efece6'});">
            <span style="font-variant-numeric:tabular-nums;font-weight:700;font-size:1.05rem;color:${t.color};width:38px;text-align:center;flex-shrink:0;">${d.kindness}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.esc(d.roomId)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">${u.buildingLabel(d.building)}${name ? ' · ' + u.esc(name) : ''}</span>${prov}</div>
              <div style="font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${brk} · รวม ${_f(fac.totalEvents)} ครั้ง</div>
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
      console.error('[kindness] render failed:', e);
      container.innerHTML = u.errorHTML('kindness', e.message);
    });
  }

  // Admin "recompute now" → recomputeTrustScores callable (writes BOTH reputation +
  // kindness), then re-render BOTH cards. §7-I: explicit admin click; CF re-checks claim.
  let _busy = false;
  async function recompute() {
    if (_busy) return;
    const u = window._ins.utils;
    const container = document.getElementById('dashKindness');
    const fn = window.firebase?.functions?.httpsCallable?.('recomputeTrustScores');
    if (!fn) { if (container) container.innerHTML = u.errorHTML('kindness', 'Firebase functions ยังไม่พร้อม'); return; }
    _busy = true;
    if (container) container.innerHTML = `<div class="card"><div style="text-align:center;padding:1.6rem;color:var(--text-muted);"><div class="gh-skeleton" style="height:18px;width:60%;border-radius:6px;margin:0 auto .6rem;"></div>⏳ กำลังคำนวณคะแนนน้ำใจจากข้อมูลล่าสุด…</div></div>`;
    try {
      const res = await fn();
      const r = (res && res.data) || {};
      u.cacheClear(CACHE_KEY);
      u.cacheClear('tenants_all');
      await renderKindness();
      // The CF updated reputation too — refresh that card if it's mounted.
      if (window._ins.reputation && typeof window._ins.reputation.renderReputation === 'function') {
        try { await window._ins.reputation.renderReputation(); } catch (_) { /* noop */ }
      }
      if (typeof window.showToast === 'function') {
        const kp = r.kindnessProvisional != null ? ` (เริ่มต้น ${r.kindnessProvisional})` : '';
        window.showToast(`คำนวณคะแนนแล้ว: ${r.scored || 0} ผู้เช่า${kp}`, 'success');
      }
    } catch (e) {
      console.error('[kindness] recompute failed:', e);
      if (container) container.innerHTML = u.errorHTML('kindness', (e && e.message) || 'recompute failed');
    } finally {
      _busy = false;
    }
  }

  // ── Register on namespace (compute fns exported for unit tests) ───────────
  window._ins = window._ins || {};
  window._ins.kindness = {
    renderKindness,
    recompute,
    // pure (tested):
    kindTier, computeKindStats,
  };
}());
