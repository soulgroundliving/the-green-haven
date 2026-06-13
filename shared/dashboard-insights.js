/**
 * dashboard-insights.js — Phase 1 Deep Analytics (orchestrator)
 *
 * Shared helpers, utils namespace, drill-down modals, lazy-init wrappers,
 * action handlers, and public exports.
 *
 * Feature rendering is delegated to sibling modules loaded after this file:
 *   dashboard-insights-community.js   → FEATURE 1, 1b, 2
 *   dashboard-insights-financial.js   → FEATURE 3, 6
 *   dashboard-insights-tenant.js      → PHASE 2 compute + FEATURE 4+5
 *   dashboard-insights-operations.js  → FEATURE 7, 9, 10
 *
 * Lazy-init pattern: render fns are called from switchDashboardTab in
 * dashboard-main.js when the relevant tab is shown. Results cached for
 * 5 minutes to avoid re-querying on every tab toggle.
 *
 * Data sources (verified):
 *   - wellness_articles (Firestore master list)
 *   - collectionGroup('wellnessClaimed') — admin-only (rule deployed 2026-04-30)
 *   - tenants/{building}/list/{room}.gamification fields
 *   - RTDB bills/{building}/{room}/{billId} — admin/accountant read
 */
(function () {
  'use strict';

  // ===== 5-minute cache =====
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const _cache = {};
  function cacheGet(key) {
    const e = _cache[key];
    if (!e) return null;
    if (Date.now() - e.at > CACHE_TTL_MS) { delete _cache[key]; return null; }
    return e.data;
  }
  function cacheSet(key, data) { _cache[key] = { at: Date.now(), data }; }
  function cacheClear(key) { delete _cache[key]; }

  // ===== UI helpers =====
  function loadingHTML(rows) {
    rows = rows || 5;
    const bars = Array.from({ length: rows }, function (_, i) {
      const w = Math.max(40, 88 - i * 11);
      return '<div class="gh-skeleton" style="height:18px;width:' + w + '%;border-radius:6px;margin-bottom:9px;"></div>';
    }).join('');
    return '<div style="padding:1rem 0 .5rem;">' + bars + '</div>';
  }
  function emptyHTML(msg) {
    return `<div class="u-empty-state">
      <div class="u-empty-icon">📭</div>
      <div class="u-empty-msg">${msg}</div>
    </div>`;
  }
  function errorHTML(target, err) {
    const safe = String(err || 'unknown').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    return `<div style="text-align:center;padding:1.5rem;">
      <div style="color:var(--alert,${DashColors.TERRACOTTA});font-size:.88rem;margin-bottom:.4rem;">⚠️ โหลดข้อมูลไม่สำเร็จ</div>
      <div style="color:var(--text-muted);font-size:.72rem;margin-bottom:.6rem;">${safe}</div>
      <button data-action="refreshInsight" data-target="${target}"
              style="font-size:.78rem;padding:4px 12px;background:var(--green-pale);color:var(--green-dark);
                     border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">
        ลองใหม่
      </button>
    </div>`;
  }
  function fmtCacheAge(at) {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'เพิ่งอัปเดต';
    return `อัปเดตล่าสุด: ${mins} นาทีที่แล้ว`;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  function buildingLabel(b) { return b === 'rooms' ? 'ห้องแถว' : b === 'nest' ? 'Nest' : b; }

  // ===== Tier classification =====
  function tierFromAvgDelta(d) {
    if (d == null || isNaN(d)) return { key: 'none', label: '—', color: 'var(--text-muted)', stars: 0 };
    if (d < -2) return { key: 'excellent', label: 'จ่ายเร็ว', color: 'var(--green)', stars: 4 };
    if (d <= 2) return { key: 'good',      label: 'ตรงเวลา', color: 'var(--blue)', stars: 3 };
    if (d <= 7) return { key: 'late',      label: 'ช้าเล็กน้อย', color: `var(--accent,${DashColors.ORANGE_MED})`, stars: 2 };
    return { key: 'chronic', label: 'ช้าเรื้อรัง', color: `var(--alert,${DashColors.TERRACOTTA})`, stars: 1 };
  }
  function streakFire(days) {
    if (!days || days < 7) return '';
    if (days < 14) return '🔥';
    if (days < 30) return '🔥🔥';
    return '🔥🔥🔥';
  }

  // ===== Bill helpers =====
  // Derive due date from month+year when the dueDate field is absent (slip-paid bills).
  // b.year is BE (e.g. 2569); month is 1-12.
  function deriveDueDate(b) {
    if (b.dueDate) return b.dueDate;
    if (!b.month || !b.year) return null;
    const ceYear = b.year > 2500 ? b.year - 543 : b.year;
    const m = Number(b.month);
    const dueM = m === 12 ? 1 : m + 1;
    const dueY = m === 12 ? ceYear + 1 : ceYear;
    return `${dueY}-${String(dueM).padStart(2, '0')}-05`;
  }
  // A bill counts as paid if status==='paid' OR paidAt is set (mirrors billing-system isPaid).
  function billIsPaid(b) { return b.status === 'paid' || !!b.paidAt; }

  // ===== Firestore tenant doc loader (shared) =====
  async function loadAllTenantDocs() {
    const cached = cacheGet('tenants_all');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firebase ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const all = [];
    for (const building of (window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest']) {
      try {
        const snap = await getDocs(query(collection(db, `tenants/${building}/list`), limit(500)));
        snap.forEach(d => all.push({ building, roomId: d.id, ...d.data() }));
      } catch (e) {
        console.warn('[insights] failed to load tenants for', building, e);
      }
    }
    cacheSet('tenants_all', all);
    return all;
  }

  // ===== Shared utils namespace (consumed by sibling modules) =====
  window._ins = window._ins || {};
  window._ins.utils = {
    cacheGet, cacheSet, cacheClear,
    loadingHTML, emptyHTML, errorHTML, fmtCacheAge,
    esc, buildingLabel,
    tierFromAvgDelta, streakFire,
    deriveDueDate, billIsPaid,
    loadAllTenantDocs,
  };

  // ============================================================
  // Drill-down modals (stay in orchestrator — used by action handlers)
  // ============================================================
  function openModal(title, bodyHTML) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.id = '_insightsModal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(31,31,28,.55);z-index:1500;display:flex;align-items:center;justify-content:center;padding:20px;';
    wrap.innerHTML = `
      <div style="background:${DashColors.WHITE};border-radius:16px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:1.5rem;font-family:'Sarabun',sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <strong style="font-size:1rem;color:var(--green-dark);">${esc(title)}</strong>
          <button data-action="closeInsightsModal" aria-label="ปิด"
                  style="background:transparent;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div>${bodyHTML}</div>
      </div>
    `;
    wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
  }
  function closeModal() {
    const m = document.getElementById('_insightsModal');
    if (m) m.remove();
  }

  function showWellnessRoomsModal(articleId) {
    const cache = window._insightsCache || {};
    const claims = (cache.wellnessClaims || []).filter(c => c.articleId === articleId);
    const article = cache.wellnessArticles?.get(articleId);
    if (claims.length === 0) {
      openModal(article?.title || 'บทความ', emptyHTML('ยังไม่มีห้องไหนกดรับ'));
      return;
    }
    claims.sort((a, b) => String(b.claimedAt || '').localeCompare(String(a.claimedAt || '')));
    const rows = claims.map(c => {
      const dt = c.claimedAt ? new Date(c.claimedAt) : null;
      const dateStr = dt && !isNaN(dt) ? dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
      return `<li style="display:flex;justify-content:space-between;padding:.5rem .25rem;border-bottom:1px solid var(--border-subtle,${DashColors.WARM_WHITE});">
        <span><strong>${esc(c.room)}</strong> <span style="color:var(--text-muted);font-size:.78rem;">(${buildingLabel(c.building)})</span></span>
        <span style="color:var(--text-muted);font-size:.82rem;">${esc(dateStr)}</span>
      </li>`;
    }).join('');
    openModal(`📚 ${article?.title || 'บทความ'} — ${claims.length} ห้อง`,
      `<ul class="u-list-reset">${rows}</ul>`);
  }

  function showHealthDetailModal(key) {
    const r = window._insightsCache?.healthRecords?.[key];
    if (!r) { openModal('Health Detail', emptyHTML('ไม่พบข้อมูลห้องนี้')); return; }
    const sub = (label, value, max, color) => {
      if (value == null) {
        return `<div style="margin-bottom:.6rem;">
          <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.2rem;">
            <span>${label}</span>
            <span style="color:var(--text-muted);font-style:italic;">— ไม่มีข้อมูล</span>
          </div>
          <div style="height:8px;background:var(--mist,#f2f1ec);border-radius:4px;overflow:hidden;opacity:.35;"></div>
        </div>`;
      }
      const pct = max ? Math.round(value / max * 100) : 0;
      return `<div style="margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.2rem;">
          <span>${label}</span>
          <span style="font-variant-numeric:tabular-nums;color:${color};font-weight:600;">${value}/${max}</span>
        </div>
        <div style="height:8px;background:var(--mist,#f2f1ec);border-radius:4px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};"></div>
        </div>
      </div>`;
    };
    const fmtDate = d => d ? new Date(d).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }) : '—';
    const body = `
      <div style="margin-bottom:1rem;padding:.7rem 1rem;background:var(--green-pale);border-radius:12px;text-align:center;">
        <div style="font-size:2rem;font-weight:700;color:${r.tier.color};font-variant-numeric:tabular-nums;">${r.score.total}<span style="font-size:1rem;color:var(--text-muted);font-weight:400;">/100</span></div>
        <div style="color:${r.tier.color};font-weight:600;">${r.tier.emoji} ${r.tier.label}</div>
      </div>
      <div style="margin-bottom:1rem;">
        ${sub('💳 ชำระเงิน',  r.score.payment,    25, 'var(--green)')}
        ${sub('🔥 กิจกรรม',   r.score.engagement, 25, 'var(--accent-gold,#D4AF37)')}
        ${sub('⚠️ ปัญหา/ร้องเรียน', r.score.issues, 25, 'var(--blue)')}
        ${sub('📅 ระยะเวลาเช่า', r.score.tenure,   25, 'var(--moss,#5a7a5a)')}
      </div>
      <div style="font-size:.82rem;color:var(--text-muted);border-top:1px dashed var(--border-subtle,${DashColors.WARM_WHITE});padding-top:.7rem;">
        <div style="margin-bottom:.3rem;">📅 เริ่มเช่า: <strong style="color:var(--ink,#1f1f1c);">${esc(fmtDate(r.startDate))}</strong>${r.monthsTenure!=null?` <span style="color:var(--text-muted);">(${r.monthsTenure} เดือน)</span>`:''}</div>
        ${r.endDate ? `<div style="margin-bottom:.3rem;">📅 หมดสัญญา: <strong style="color:var(--ink);">${esc(fmtDate(r.endDate))}</strong>${r.daysToEnd!=null?` <span style="color:${r.daysToEnd<=90?`var(--alert,${DashColors.TERRACOTTA})`:'var(--text-muted)'};">(${r.daysToEnd>=0?`อีก ${r.daysToEnd} วัน`:`เลย ${-r.daysToEnd} วัน`})</span>`:''}</div>` : ''}
        <div style="margin-bottom:.3rem;">💳 เฉลี่ยจ่าย: <strong style="color:var(--ink);">${r.paymentDelta!=null?(r.paymentDelta>=0?'+':'')+r.paymentDelta.toFixed(1)+' วัน':'—'}</strong> (ค้าง ${r.paymentLateCount} ครั้ง)</div>
        <div style="margin-bottom:.3rem;">🔥 Streak: <strong style="color:var(--ink);">${r.streak} วัน</strong>${r.lastClaim?` <span style="color:var(--text-muted);">(last: ${esc(r.lastClaim)})</span>`:''}</div>
        <div>⚠️ Complaints (90d): <strong style="color:var(--ink);">${r.complaintCount} ครั้ง</strong></div>
      </div>
    `;
    openModal(`🩺 ${esc(r.roomId)} (${buildingLabel(r.building)}) ${r.tenantName?'· '+esc(r.tenantName):''}`, body);
  }

  function showInactiveRoomsModal() {
    const inactive = window._insightsCache?.inactiveRooms || [];
    if (inactive.length === 0) {
      openModal('💤 Inactive Rooms', emptyHTML('ทุกห้องยัง active ใน 7 วัน'));
      return;
    }
    inactive.sort((a, b) => (a.lastClaim || '').localeCompare(b.lastClaim || ''));
    const rows = inactive.map(r => `<li style="display:flex;justify-content:space-between;padding:.5rem .25rem;border-bottom:1px solid var(--border-subtle,${DashColors.WARM_WHITE});">
      <span><strong>${esc(r.roomId)}</strong> <span style="color:var(--text-muted);font-size:.78rem;">(${buildingLabel(r.building)})</span></span>
      <span style="color:var(--alert,${DashColors.TERRACOTTA});font-size:.82rem;">last: ${esc(r.lastClaim || '—')}</span>
    </li>`).join('');
    openModal(`💤 Inactive >7 days — ${inactive.length} ห้อง`,
      `<ul class="u-list-reset">${rows}</ul>`);
  }

  // ============================================================
  // Lazy-init wrappers (called by switchDashboardTab)
  // ============================================================
  let _commInited = false, _finInited = false, _tenInited = false, _opsInited = false;
  function initCommunityInsights() {
    if (_commInited) return;
    _commInited = true;
    window._ins.community.renderWellnessMatrix();
    window._ins.community.renderQuizEngagement();
    window._ins.community.renderStreakLeaderboard();
    // Phase 3.1 Behavioral Intelligence — community engagement trend (pointsLedger).
    if (window._ins.behavioralEngagement) window._ins.behavioralEngagement.renderEngagementTrend();
    // Behavioral Analytics Phase 0 — activity timing heatmap (same pointsLedger 90d window, aggregate-only).
    if (window._ins.behavioralTiming) window._ins.behavioralTiming.renderTimingHeatmap();
    // Phase 3.1 Behavioral Intelligence — pet patterns & vaccine compliance (collectionGroup pets).
    if (window._ins.behavioralPets) window._ins.behavioralPets.renderPetPatterns();
  }
  function initFinancialInsights() {
    if (_finInited) return;
    _finInited = true;
    window._ins.financial.renderPaymentBehavior();
  }
  async function renderTenantDashSummary() {
    const expEl  = document.getElementById('tenSum-exp');
    // tenSum-alert card removed 2026-05-19 — the 'แจ้งเตือน' tab it deep-linked to
    // was superseded by the leaseNotifications/ auto-notifier (see lifecycle_lease_action.md).
    const reqEl  = document.getElementById('tenSum-req');
    const bookEl = document.getElementById('tenSum-book');
    if (!expEl) return;

    // Synchronous: contract expiry counts from localStorage
    const today = new Date();
    try {
      if (typeof loadTenants === 'function') {
        const tenants = loadTenants();
        let exp30 = 0;
        Object.values(tenants).forEach(t => {
          if (!t.name || !t.contractEnd) return;
          const diff = (new Date(t.contractEnd) - today) / 86400000;
          if (diff >= 0 && diff <= 30) exp30++;
        });
        if (expEl) { expEl.textContent = String(exp30); if (!exp30) expEl.classList.remove('c-amber'); }
      }
    } catch(e) { /* silent */ }

    // Async: Firestore counts for requests + bookings
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    try {
      const db = window.firebase.firestore();
      const { collection, getDocs, query, where } = window.firebase.firestoreFunctions;
      const [reqSnap, bookSnap] = await Promise.all([
        getDocs(query(collection(db, 'leaseRequests'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'bookings'), where('status', 'in', ['locked', 'paid', 'kyc'])))
      ]);
      if (reqEl)  { reqEl.textContent  = String(reqSnap.size);  if (reqSnap.size > 0)  reqEl.classList.add('c-red'); }
      if (bookEl) { bookEl.textContent = String(bookSnap.size); }
    } catch(e) { console.warn('[tenantSummary]', e); }
  }

  function initTenantInsights() {
    if (_tenInited) return;
    _tenInited = true;
    renderTenantDashSummary();
    window._ins.tenant.renderTenantInsights();
    // Phase 3.1 Behavioral Intelligence — tenure & move-out propensity card.
    // Rendered after the Health card so it can reuse the warmed payment/complaint
    // caches for propensity enrichment (best-effort; degrades without them).
    if (window._ins.behavioralTenure) window._ins.behavioralTenure.renderTenureInsights();
    // Trust System Phase 3.2a — Reputation score card (reads server-computed trustScores/*).
    if (window._ins.reputation) window._ins.reputation.renderReputation();
    // Meaning Layer #6 — Kindness score card (same trustScores/* docs as Reputation).
    if (window._ins.kindness) window._ins.kindness.renderKindness();
    // Meaning Layer #7 — Verified Helper credential card (same trustScores/* docs).
    if (window._ins.verifiedHelper) window._ins.verifiedHelper.renderVerifiedHelper();
    // Meaning Layer #8 — Resident Rank composite card (same trustScores/* docs).
    if (window._ins.residentRank) window._ins.residentRank.renderResidentRank();
  }
  function initOperationsInsights() {
    if (_opsInited) return;
    _opsInited = true;
    window._ins.operations.renderOperationsInsights();
    window._ins.operations.renderMeterSpike();
    // Phase 3.1 Behavioral Intelligence — energy & water pattern (meter_data time-series).
    if (window._ins.behavioralEnergy) window._ins.behavioralEnergy.renderEnergyTrend();
    // Phase 3.1 Behavioral Intelligence — peak repair season (maintenanceArchive #270).
    if (window._ins.behavioralRepair) window._ins.behavioralRepair.renderRepairSeason();
    // Behavioral Analytics Phase 1c — dead-feature detector (behavioralRollup/adoption).
    if (window._ins.behavioralAdoption) window._ins.behavioralAdoption.renderAdoption();
    window._ins.operations.renderProviderScore();
  }
  function refreshInsight(target) {
    if (target === 'wellness') { cacheClear('tenants_all'); window._ins.community.renderWellnessMatrix(); }
    else if (target === 'quizEngagement') { window._ins.community.renderQuizEngagement(); }
    else if (target === 'streak') { cacheClear('tenants_all'); window._ins.community.renderStreakLeaderboard(); }
    else if (target === 'payment') { cacheClear('payment_behavior'); window._ins.financial.renderPaymentBehavior(); }
    else if (target === 'overdue') { cacheClear('bills_raw'); window._ins.financial.renderOverdueBills(); }
    else if (target === 'tenant' || target === 'health' || target === 'churn') {
      cacheClear('tenants_all'); cacheClear('payment_deltas'); cacheClear('complaints_90d');
      window._ins.tenant.renderTenantInsights();
    }
    else if (target === 'behavioralTenure') { cacheClear('behavioral_archives'); window._ins.behavioralTenure.renderTenureInsights(); }
    else if (target === 'reputation') { cacheClear('trust_scores'); window._ins.reputation.renderReputation(); }
    else if (target === 'kindness') { cacheClear('trust_scores'); window._ins.kindness.renderKindness(); }
    else if (target === 'verifiedHelper') { cacheClear('trust_scores'); window._ins.verifiedHelper.renderVerifiedHelper(); }
    else if (target === 'residentRank') { cacheClear('trust_scores'); window._ins.residentRank.renderResidentRank(); }
    else if (target === 'engagementTrend') { cacheClear('engagement_ledger'); window._ins.behavioralEngagement.renderEngagementTrend(); }
    else if (target === 'behavioralTiming') { cacheClear('engagement_ledger'); window._ins.behavioralTiming.renderTimingHeatmap(); }
    else if (target === 'energyPattern') { cacheClear('behavioral_energy'); window._ins.behavioralEnergy.renderEnergyTrend(); }
    else if (target === 'repairSeason') { cacheClear('behavioral_repair'); window._ins.behavioralRepair.renderRepairSeason(); }
    else if (target === 'behavioralAdoption') { cacheClear('behavioral_adoption'); window._ins.behavioralAdoption.renderAdoption(); }
    else if (target === 'petPatterns') { cacheClear('behavioral_pets'); window._ins.behavioralPets.renderPetPatterns(); }
    else if (target === 'operations') { cacheClear('ops_insights'); window._ins.operations.renderOperationsInsights(); }
    else if (target === 'meterSpike') { cacheClear('meter_spike'); window._ins.operations.renderMeterSpike(); }
    else if (target === 'providerScore') { window._ins.operations.renderProviderScore(); }
  }

  // ============================================================
  // Action handlers (delegated via dashboard-main click router)
  // ============================================================
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Skip SELECT — handled by 'change' event below; intercepting 'click'
    // re-renders the card while the dropdown is opening, collapsing it.
    if (el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'refreshInsight') { refreshInsight(el.dataset.target); return; }
    if (a === 'recomputeTrust') { if (window._ins.reputation) window._ins.reputation.recompute(); return; }
    if (a === 'recomputeKindness') { if (window._ins.kindness) window._ins.kindness.recompute(); return; }
    if (a === 'recomputeVerifiedHelper') { if (window._ins.verifiedHelper) window._ins.verifiedHelper.recompute(); return; }
    if (a === 'recomputeResidentRank') { if (window._ins.residentRank) window._ins.residentRank.recompute(); return; }
    if (a === 'showWellnessRooms') { showWellnessRoomsModal(el.dataset.article); return; }
    if (a === 'showInactiveRooms') { showInactiveRoomsModal(); return; }
    if (a === 'showHealthDetail') { showHealthDetailModal(el.dataset.key); return; }
    if (a === 'setHSFilter') { window._ins.tenant.setHSFilter(el.dataset.tier); return; }
    if (a === 'closeInsightsModal') { closeModal(); return; }
  });
  // Select dropdowns: react on 'change' only
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName !== 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'setPBSort') { window._ins.financial.setPBSort(el.value); }
    else if (a === 'setPBBuilding') { window._ins.financial.setPBBuilding(el.value); }
  });

  // ============================================================
  // Exports
  // ============================================================
  window.initCommunityInsights  = initCommunityInsights;
  window.initFinancialInsights  = initFinancialInsights;
  window.initTenantInsights     = initTenantInsights;
  window.initOperationsInsights = initOperationsInsights;
  window.refreshInsight         = refreshInsight;
})();
