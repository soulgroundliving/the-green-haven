/**
 * dashboard-resident-rank.js
 * Trust System / Meaning Layer #8 — Resident Rank card (ผู้เช่า / tenants tab, admin-only)
 *
 * Reads the server-computed `trustScores/{tenantId}` collection (admin-read rule,
 * firestore.rules) — the SAME docs the Reputation + Kindness + Verified-Helper cards
 * read — and ranks tenants by their composite Resident Rank (0–100): a DERIVED blend
 * of the three Trust dimensions (reputation 40% / kindness 30% / verifiedHelper 30%,
 * owner "สมดุล"). Computed SERVER-side (computeTrustScoresScheduled daily 05:40 +
 * recomputeTrustScores admin callable, which writes all four trust fields together)
 * — this card never computes, only displays + offers a "recompute now" trigger.
 *
 * This is the blueprint Core Metric 3 "Emotional Lock-in" surface: the single
 * growth-ladder rung (เมล็ดใหม่ → ต้นกล้า → ไม้ประจำถิ่น → ร่มเงาของตึก → รากแก้วชุมชน)
 * a resident builds and would lose by leaving. The top two rungs require real
 * community participation (reputation alone caps the composite at 40 — see
 * functions/_residentRank.js).
 *
 * Positive framing (§8/§6): never "ต่ำ"/red — the bottom rung is the gentle 🌱
 * "เมล็ดใหม่" growth state, not a verdict. Trust ≠ points (§6).
 *
 * Compute fns are pure (no I/O) and exported on window._ins.residentRank for tests.
 * Depends on window._ins.utils (dashboard-insights.js, loads first). Shares the
 * 'trust_scores' cache with the Reputation + Kindness + Verified-Helper cards.
 *
 * §7-RR/II: no injected <style>, no inline <style> — inline style="" attrs only (CSP-safe).
 * §7-I: the recompute button is an explicit admin click; the CF is admin-gated server-side.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'trust_scores'; // same docs as the Reputation + Kindness + VH cards

  // Score at/above which a resident counts as a community "pillar" (canopy+taproot).
  // Mirrors the _residentRank.js RANK_BOUND_CANOPY bound (the participation rungs).
  const PILLAR_MIN = 55;

  // ── PURE helpers (testable) ──────────────────────────────────────────────
  // Resident-Rank display rung from the 0–100 composite. POSITIVE-only growth
  // ladder. Bounds aligned with the CF (functions/_residentRank.js: 75/55/35/15)
  // so admin + tenant read the same rungs. null/NaN (a doc predating #8) → 'none'.
  function rrTier(score) {
    const s = score == null ? NaN : Number(score); // Number(null)===0 — guard explicitly
    if (!isFinite(s)) return { key: 'none',    emoji: '⚪', label: '—',             color: 'var(--text-muted)' };
    if (s >= 75)      return { key: 'taproot', emoji: '🌲', label: 'รากแก้วชุมชน',  color: 'var(--green-dark,#1a5c38)' };
    if (s >= 55)      return { key: 'canopy',  emoji: '🌳', label: 'ร่มเงาของตึก',  color: 'var(--green-dark,#1a5c38)' };
    if (s >= 35)      return { key: 'rooted',  emoji: '🪴', label: 'ไม้ประจำถิ่น',   color: 'var(--green,#2d8653)' };
    if (s >= 15)      return { key: 'sprout',  emoji: '🌿', label: 'ต้นกล้า',        color: 'var(--green,#2d8653)' };
    return                   { key: 'seed',    emoji: '🌱', label: 'เมล็ดใหม่',      color: 'var(--green-dark,#3a5a44)' };
  }

  /**
   * Summary over trustScores docs (resident-rank fields). EVERY active tenant has a
   * rank, so unlike the Verified-Helper card we rank ALL finite-score docs.
   * docs: [{ residentRank, residentRankProvisional, residentRankFactors:{reputation,kindness,verifiedHelper}, building, roomId }]
   * → { count, avg, pillars, sorted:[...all, score desc] }
   * "pillars" = residents at the canopy/taproot rungs (≥PILLAR_MIN) — the lock-in core.
   */
  function computeRRStats(docs) {
    const list = (docs || []).filter(d => d && d.residentRank != null && isFinite(Number(d.residentRank)));
    const ss = list.map(d => Number(d.residentRank));
    const avg = ss.length ? Math.round(ss.reduce((s, n) => s + n, 0) / ss.length) : null;
    const pillars = list.filter(d => Number(d.residentRank) >= PILLAR_MIN).length;
    const sorted = list.slice().sort((a, b) =>
      Number(b.residentRank) - Number(a.residentRank)
      || String(a.building + a.roomId).localeCompare(String(b.building + b.roomId)));
    return { count: list.length, avg, pillars, sorted };
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

  function renderResidentRank() {
    const u = window._ins.utils;
    const container = document.getElementById('dashResidentRank');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    return Promise.all([loadTrustScores(), loadNameMap()]).then(([docs, nameMap]) => {
      const stats = computeRRStats(docs);
      const newestMs = docs.reduce((mx, d) => Math.max(mx, _tsMs(d.computedAt) || 0), 0);

      const recomputeBtn = `
        <button data-action="recomputeResidentRank" aria-label="คำนวณแรงก์ผู้อยู่อาศัยใหม่"
                style="font-size:.72rem;padding:2px 10px;background:var(--green-dark);color:#fff;border:none;border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
          ⟳ คำนวณใหม่
        </button>`;

      const header = `
        <div class="card-title u-flex-sb">
          <span>🌳 แรงก์ผู้อยู่อาศัย</span>
          ${recomputeBtn}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.8rem;">
          ชั้นการมีส่วนร่วม 0–100 ต่อผู้เช่า — ผสมจากความน่าเชื่อถือ 40% · น้ำใจ 30% · ผู้ช่วยที่ยืนยัน 30% (ชั้นบนสุดต้องมีส่วนร่วมในชุมชนจริง)
        </div>`;

      if (stats.count === 0) {
        container.innerHTML = `
          <div class="card">
            ${header}
            <div style="text-align:center;padding:1.4rem 1rem;color:var(--text-muted);">
              <div style="font-size:1.6rem;margin-bottom:.4rem;">🌳</div>
              <div style="font-size:.86rem;margin-bottom:.2rem;">ยังไม่มีการจัดอันดับ</div>
              <div style="font-size:.74rem;">แรงก์จะปรากฏหลังรอบคำนวณ Trust — กด “⟳ คำนวณใหม่” หรือรอรอบอัตโนมัติ 05:40 น.</div>
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
          ${kpi('จัดอันดับแล้ว', String(stats.count), 'ผู้เช่า')}
          ${kpi('คะแนนเฉลี่ย', _f(stats.avg), 'ทั้งหมด')}
          ${kpi('แกนนำชุมชน', String(stats.pillars), 'ร่มเงา+รากแก้ว')}
        </div>`;

      const rows = stats.sorted.slice(0, 20).map(d => {
        const t = rrTier(d.residentRank);
        const name = nameMap.get(`${d.building}:${d.roomId}`) || '';
        const fac = d.residentRankFactors || {};
        const brk = `น่าเชื่อถือ ${_f(fac.reputation)} · น้ำใจ ${_f(fac.kindness)} · ผู้ช่วย ${_f(fac.verifiedHelper)}`;
        const prov = d.residentRankProvisional
          ? ` <span style="font-size:.64rem;font-weight:600;color:var(--green-dark);background:var(--green-pale);padding:1px 6px;border-radius:999px;">เริ่มต้น</span>`
          : '';
        return `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .2rem;border-bottom:1px solid var(--border-subtle,${typeof DashColors !== 'undefined' ? DashColors.WARM_WHITE : '#efece6'});">
            <span style="font-variant-numeric:tabular-nums;font-weight:700;font-size:1.05rem;color:${t.color};width:38px;text-align:center;flex-shrink:0;">${d.residentRank}</span>
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
      console.error('[resident-rank] render failed:', e);
      container.innerHTML = u.errorHTML('residentRank', e.message);
    });
  }

  // Admin "recompute now" → recomputeTrustScores callable (writes reputation +
  // kindness + verified-helper + resident-rank), then re-render the sibling cards.
  // §7-I explicit click.
  let _busy = false;
  async function recompute() {
    if (_busy) return;
    const u = window._ins.utils;
    const container = document.getElementById('dashResidentRank');
    const fn = window.firebase?.functions?.httpsCallable?.('recomputeTrustScores');
    if (!fn) { if (container) container.innerHTML = u.errorHTML('residentRank', 'Firebase functions ยังไม่พร้อม'); return; }
    _busy = true;
    if (container) container.innerHTML = `<div class="card"><div style="text-align:center;padding:1.6rem;color:var(--text-muted);"><div class="gh-skeleton" style="height:18px;width:60%;border-radius:6px;margin:0 auto .6rem;"></div>⏳ กำลังคำนวณแรงก์จากข้อมูลล่าสุด…</div></div>`;
    try {
      const res = await fn();
      const r = (res && res.data) || {};
      u.cacheClear(CACHE_KEY);
      u.cacheClear('tenants_all');
      await renderResidentRank();
      // The CF updated reputation + kindness + verified-helper too — refresh those cards if mounted.
      for (const sib of ['reputation', 'kindness', 'verifiedHelper']) {
        const m = window._ins[sib];
        const render = m && (m[`render${sib[0].toUpperCase()}${sib.slice(1)}`]);
        if (typeof render === 'function') { try { await render(); } catch (_) { /* noop */ } }
      }
      if (typeof window.showToast === 'function') {
        window.showToast(`คำนวณแรงก์แล้ว: ${r.scored || 0} ผู้เช่า`, 'success');
      }
    } catch (e) {
      console.error('[resident-rank] recompute failed:', e);
      if (container) container.innerHTML = u.errorHTML('residentRank', (e && e.message) || 'recompute failed');
    } finally {
      _busy = false;
    }
  }

  // ── Register on namespace (compute fns exported for unit tests) ───────────
  window._ins = window._ins || {};
  window._ins.residentRank = {
    renderResidentRank,
    recompute,
    // pure (tested):
    rrTier, computeRRStats,
  };
}());
