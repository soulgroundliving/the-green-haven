/**
 * dashboard-insights-tenant.js
 * PHASE 2 shared compute — health score helpers, complaint/payment loaders
 * FEATURE 4+5 — Tenant Health Score + Churn Risk (combined card)
 *
 * Depends on window._ins.utils being populated by dashboard-insights.js
 * (which loads first via DOM script order).
 */
(function () {
  'use strict';

  // ============================================================
  // PHASE 2: Tenant Health Score + Churn Risk shared compute
  // ============================================================

  // Compute composite 0-100 health score for a single tenant
  // Inputs: paymentDelta (avg days from due, null if no history), gamification, complaintCount90d, monthsTenure
  function computeHealthScore({ paymentDelta, streak, complaintCount90d, monthsTenure }) {
    // Payment sub-score (25 pts max) — null = no paid bills yet; excluded from total
    let payment;
    if (paymentDelta == null) payment = null;
    else if (paymentDelta < -2) payment = 25;
    else if (paymentDelta <= 2) payment = 20;
    else if (paymentDelta <= 7) payment = 12;
    else payment = 5;

    // Engagement sub-score (25 pts max)
    let engagement;
    if (!streak || streak <= 0) engagement = 0;
    else if (streak < 7) engagement = 5;
    else if (streak < 14) engagement = 10;
    else if (streak < 30) engagement = 18;
    else engagement = 25;

    // Issues sub-score (25 pts max — inverse of complaint count last 90d)
    let issues;
    if (complaintCount90d === 0) issues = 25;
    else if (complaintCount90d === 1) issues = 18;
    else if (complaintCount90d === 2) issues = 12;
    else issues = 5;

    // Tenure sub-score (25 pts max)
    let tenure;
    if (monthsTenure == null) tenure = 12;       // neutral when unknown
    else if (monthsTenure <= 3) tenure = 8;
    else if (monthsTenure <= 6) tenure = 14;
    else if (monthsTenure <= 12) tenure = 20;
    else tenure = 25;

    // Total scaled to /100 over only the sub-scores we have data for —
    // a new tenant with no paid bills scores from 3 sub-scores × 25 = 75 max,
    // re-scaled to /100 so tier thresholds (80/60/40) still apply uniformly.
    const subs = [payment, engagement, issues, tenure].filter(s => s != null);
    const sum = subs.reduce((a, b) => a + b, 0);
    const max = subs.length * 25;
    const total = max > 0 ? Math.round(sum / max * 100) : 0;
    return { total, payment, engagement, issues, tenure };
  }

  function healthTier(total) {
    if (total >= 80) return { key: 'healthy',  emoji: '🟢', label: 'Healthy', color: 'var(--green)' };
    if (total >= 60) return { key: 'steady',   emoji: '🟡', label: 'Steady',  color: 'var(--blue)' };
    if (total >= 40) return { key: 'at-risk',  emoji: '🟠', label: 'At Risk', color: `var(--accent,${DashColors.ORANGE_MED})` };
    return                  { key: 'critical', emoji: '🔴', label: 'Critical',color: `var(--alert,${DashColors.TERRACOTTA})` };
  }

  // Months between a date string/Date and now
  function monthsSince(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const ms = Date.now() - d.getTime();
    return Math.floor(ms / (30 * 86400000));
  }

  // Days until a date string/Date (negative if past)
  function daysUntil(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return Math.floor((d.getTime() - Date.now()) / 86400000);
  }

  // Aggregate complaints per room from flat 'complaints' collection
  async function loadComplaintCounts() {
    const u = window._ins.utils;
    const cached = u.cacheGet('complaints_90d');
    if (cached) return cached;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      throw new Error('Firestore ยังไม่พร้อม');
    }
    const db = window.firebase.firestore();
    const { collection, getDocs, query, limit } = window.firebase.firestoreFunctions;
    const snap = await getDocs(query(collection(db, 'complaints'), limit(500)));
    const cutoff = Date.now() - 90 * 86400000;
    const byRoom = {};
    snap.forEach(d => {
      const data = d.data() || {};
      const ts = data.createdAt?.toMillis ? data.createdAt.toMillis()
               : data.createdAt ? new Date(data.createdAt).getTime()
               : data.timestamp ? new Date(data.timestamp).getTime()
               : null;
      if (ts == null || ts < cutoff) return;
      const building = data.building;
      const room = data.room;
      if (!building || !room) return;
      const key = `${building}:${room}`;
      byRoom[key] = (byRoom[key] || 0) + 1;
    });
    u.cacheSet('complaints_90d', byRoom);
    return byRoom;
  }

  // Load + cache payment-delta (reuses RTDB bills query from F3)
  async function loadPaymentDeltas() {
    const u = window._ins.utils;
    const cached = u.cacheGet('payment_deltas');
    if (cached) return cached;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet) {
      throw new Error('RTDB ยังไม่พร้อม');
    }
    const billsRef = window.firebaseRef(window.firebaseDatabase, 'bills');
    const snap = await window.firebaseGet(billsRef);
    const all = snap.val() || {};
    const cutoff = Date.now() - 180 * 86400000;
    const byRoom = {};
    Object.entries(all).forEach(([building, rooms]) => {
      Object.entries(rooms || {}).forEach(([room, bills]) => {
        const key = `${building}:${room}`;
        const deltas = [];
        let lateCount = 0;
        Object.values(bills || {}).forEach(b => {
          if (!b || !u.billIsPaid(b)) return;
          const dueDate = u.deriveDueDate(b);
          if (!dueDate) return;
          const due = new Date(dueDate).getTime();
          if (!isFinite(due)) return;
          const paidTs = b.paidAt ? new Date(b.paidAt).getTime() : null;
          const refTs = paidTs !== null && isFinite(paidTs) ? paidTs : due;
          if (refTs < cutoff) return;
          const delta = (paidTs !== null && isFinite(paidTs)) ? (paidTs - due) / 86400000 : 0;
          deltas.push(delta);
          if (delta > 2) lateCount++;
        });
        if (deltas.length > 0) {
          const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
          byRoom[key] = { avg, count: deltas.length, lateCount };
        }
      });
    });
    u.cacheSet('payment_deltas', byRoom);
    return byRoom;
  }

  // Build per-room health record list (used by both Health Score table + Churn Risk)
  async function buildHealthRecords() {
    const u = window._ins.utils;
    const [tenants, paymentDeltas, complaints] = await Promise.all([
      u.loadAllTenantDocs(),
      loadPaymentDeltas().catch(e => { console.warn('[insights] payment deltas load failed:', e); return {}; }),
      loadComplaintCounts().catch(e => { console.warn('[insights] complaints load failed:', e); return {}; })
    ]);

    // Index tenant docs for O(1) lookup
    const tenantMap = {};
    tenants.forEach(t => { tenantMap[`${t.building}:${t.roomId}`] = t; });

    // Master room list from จัดการห้องพัก (RoomConfigManager) — same source as the admin room config page
    const allRooms = [];
    for (const building of (window.BuildingRegistry?.list()?.map(b=>b.id)) || ['rooms','nest']) {
      const cfg = (typeof RoomConfigManager !== 'undefined') ? RoomConfigManager.getRoomsConfig(building) : null;
      if (cfg?.rooms) {
        cfg.rooms.filter(r => !r.deleted).forEach(r => {
          allRooms.push({ building, roomId: r.id, roomName: r.name || r.id });
        });
      }
    }

    // Fallback to tenant docs if RoomConfigManager not loaded
    const rooms = allRooms.length > 0 ? allRooms
      : tenants.map(t => ({ building: t.building, roomId: t.roomId, roomName: t.name || t.roomId }));

    return rooms.map(room => {
      const key = `${room.building}:${room.roomId}`;
      const t = tenantMap[key];
      // A room is vacant if no tenant doc exists, or the doc is an empty shell (no name & no lease tenant)
      const hasTenant = !!(t?.name || t?.lease?.tenantName || t?.phone);
      const isVacant = !hasTenant;
      const g = t?.gamification || {};
      const lease = t?.lease || {};
      const startDate = lease.startDate || lease.moveInDate || t?.moveInDate || null;
      const endDate = lease.endDate || lease.moveOutDate || null;
      const monthsTenure = monthsSince(startDate);
      const daysToEnd = daysUntil(endDate);
      const pd = paymentDeltas[key] || null;

      const inputs = {
        paymentDelta: pd ? pd.avg : null,
        streak: Number(g.dailyStreak) || 0,
        complaintCount90d: complaints[key] || 0,
        monthsTenure
      };
      const score = isVacant
        ? { total: 0, payment: 0, engagement: 0, issues: 0, tenure: 0 }
        : computeHealthScore(inputs);
      const tier = isVacant
        ? { key: 'vacant', emoji: '🔑', label: 'ว่าง', color: '#9ca3af' }
        : healthTier(score.total);

      return {
        building: room.building,
        roomId: room.roomId,
        roomName: room.roomName,
        tenantName: t?.name || lease.tenantName || '',
        isVacant,
        startDate, endDate, monthsTenure, daysToEnd,
        streak: inputs.streak,
        lastClaim: g.lastDailyClaim || null,
        paymentDelta: inputs.paymentDelta,
        paymentLateCount: pd ? pd.lateCount : 0,
        complaintCount: inputs.complaintCount90d,
        score, tier
      };
    });
  }

  // ============================================================
  // FEATURE 4+5: Tenant Health Score + Churn Risk (combined card)
  // ============================================================
  let _hsState = { tierFilter: 'all', sortBy: 'score_asc' };

  async function renderTenantInsights() {
    const u = window._ins.utils;
    const container = document.getElementById('dashTenantInsights');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      const records = await buildHealthRecords();

      // Stash for drill-down modal
      window._insightsCache = window._insightsCache || {};
      window._insightsCache.healthRecords = {};
      records.forEach(r => { window._insightsCache.healthRecords[`${r.building}:${r.roomId}`] = r; });

      // Annotate every record with churn flags (used for count + tile display)
      const todayBKK = new Date(Date.now() + 7*3600000).toISOString().slice(0,10);
      const annotated = records.map(r => {
        if (r.isVacant) return { ...r, flags: [], recommend: null };
        const flags = [];
        let recommend = null;
        if (r.daysToEnd != null && r.daysToEnd >= 0 && r.daysToEnd <= 90) {
          flags.push(`สัญญาเหลือ ${r.daysToEnd} วัน`);
          recommend = 'ติดต่อต่อสัญญา';
        }
        if (r.score.total < 60) flags.push(`Health ${r.score.total}/100`);
        if (r.paymentLateCount >= 3) {
          flags.push(`ค้างชำระ ${r.paymentLateCount} ครั้ง`);
          if (!recommend) recommend = 'ติดตามค่าเช่า';
        }
        if (r.complaintCount >= 2) {
          flags.push(`Complaints ${r.complaintCount} ครั้ง (90d)`);
          if (!recommend) recommend = 'ติดต่อสอบถาม';
        }
        const inactiveDays = r.lastClaim
          ? Math.floor((new Date(todayBKK) - new Date(r.lastClaim)) / 86400000)
          : null;
        if (inactiveDays != null && inactiveDays >= 14) {
          flags.push(`ไม่ active ${inactiveDays} วัน`);
          if (!recommend) recommend = 'ส่งข้อความ check-in';
        }
        return { ...r, flags, recommend };
      });

      // Vacant rooms: exclude from flags/churn count
      const occupied = annotated.filter(r => !r.isVacant);
      const churnCount = occupied.filter(r => r.flags.length > 0).length;

      // Filter + sort — vacant always last
      let rows = annotated;
      if (_hsState.tierFilter === 'vacant') rows = annotated.filter(r => r.isVacant);
      else if (_hsState.tierFilter !== 'all') rows = annotated.filter(r => !r.isVacant && r.tier.key === _hsState.tierFilter);
      rows.sort((a, b) => {
        if (a.isVacant !== b.isVacant) return a.isVacant ? 1 : -1;
        const order = { critical: 0, 'at-risk': 1, steady: 2, healthy: 3 };
        if ((order[a.tier.key] ?? 99) !== (order[b.tier.key] ?? 99))
          return (order[a.tier.key] ?? 99) - (order[b.tier.key] ?? 99);
        return a.score.total - b.score.total;
      });

      // Distribution for filter chips (occupied only)
      const dist = { healthy: 0, steady: 0, 'at-risk': 0, critical: 0 };
      occupied.forEach(r => { dist[r.tier.key]++; });
      const vacantCount = annotated.length - occupied.length;

      const chipStyle = (active, color) =>
        `display:inline-block;padding:4px 12px;margin-right:6px;margin-bottom:4px;background:${active ? color : DashColors.WHITE};border:1.5px solid ${color};color:${active ? DashColors.WHITE : color};border-radius:999px;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit;`;
      const f = _hsState.tierFilter;
      const chips = `
        <button data-action="setHSFilter" data-tier="all" style="${chipStyle(f === 'all', 'var(--text-muted)')}">ทั้งหมด (${annotated.length})</button>
        <button data-action="setHSFilter" data-tier="healthy" style="${chipStyle(f === 'healthy', 'var(--green)')}">🟢 ${dist.healthy}</button>
        <button data-action="setHSFilter" data-tier="steady" style="${chipStyle(f === 'steady', 'var(--blue)')}">🟡 ${dist.steady}</button>
        <button data-action="setHSFilter" data-tier="at-risk" style="${chipStyle(f === 'at-risk', `var(--accent,${DashColors.ORANGE_MED})`)}">🟠 ${dist['at-risk']}</button>
        <button data-action="setHSFilter" data-tier="critical" style="${chipStyle(f === 'critical', `var(--alert,${DashColors.TERRACOTTA})`)}">🔴 ${dist.critical}</button>
        ${vacantCount > 0 ? `<button data-action="setHSFilter" data-tier="vacant" style="${chipStyle(f === 'vacant', '#9ca3af')}">🔑 ${vacantCount}</button>` : ''}
      `;

      const tilesHTML = rows.length === 0
        ? `<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.85rem;grid-column:1/-1;">ไม่มีห้องในกลุ่มนี้</div>`
        : rows.map(r => `
          <div data-action="${r.isVacant ? '' : 'showHealthDetail'}" data-key="${u.esc(r.building)}:${u.esc(r.roomId)}"
               class="health-tile${r.isVacant ? '' : ' health-tile--interactive'}"
               style="cursor:${r.isVacant ? 'default' : 'pointer'};background:${r.isVacant ? 'var(--mist,#f7f6f3)' : DashColors.WHITE};border:1px solid var(--border-subtle,${DashColors.WARM_WHITE});border-left:4px solid ${r.tier.color};border-radius:10px;padding:.7rem .8rem;transition:transform .1s,box-shadow .1s;opacity:${r.isVacant ? '.7' : '1'};">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.2rem;">
              <span style="font-weight:700;font-size:.92rem;">${u.esc(r.roomName || r.roomId)} <span style="color:var(--text-muted);font-size:.7rem;font-weight:400;">${u.buildingLabel(r.building)}</span></span>
              ${r.isVacant
                ? `<span style="font-size:.68rem;font-weight:600;color:#9ca3af;background:#f3f4f6;padding:1px 7px;border-radius:99px;">ว่าง</span>`
                : `<span style="font-variant-numeric:tabular-nums;color:${r.tier.color};font-weight:700;font-size:1.1rem;">${r.score.total}<span style="font-size:.7rem;color:var(--text-muted);font-weight:400;">/100</span></span>`}
            </div>
            <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.isVacant ? '—' : u.esc(r.tenantName || '—')}</div>
            ${r.isVacant ? '' : `
            <div style="height:5px;background:var(--mist,#f2f1ec);border-radius:3px;overflow:hidden;margin-bottom:.3rem;">
              <div style="width:${r.score.total}%;height:100%;background:${r.tier.color};"></div>
            </div>
            <div style="font-size:.72rem;color:${r.tier.color};font-weight:600;margin-bottom:${r.flags.length ? '.4rem' : '0'};">${r.tier.emoji} ${r.tier.label}</div>
            ${r.flags.length ? `
            <div style="border-top:1px dashed var(--border-subtle,${DashColors.WARM_WHITE});padding-top:.35rem;">
              <div style="font-size:.68rem;color:var(--text-muted);line-height:1.4;" title="${u.esc(r.flags.join(' · '))}">⚠️ ${u.esc(r.flags[0])}${r.flags.length > 1 ? ` <span style="color:var(--alert,${DashColors.TERRACOTTA});">+${r.flags.length - 1}</span>` : ''}</div>
              ${r.recommend ? `<div style="font-size:.68rem;color:var(--green-dark);font-weight:600;margin-top:.2rem;">💡 ${u.esc(r.recommend)}</div>` : ''}
            </div>` : ''}`}
          </div>`).join('');

      const statusLine = churnCount === 0
        ? `<span style="color:var(--green-dark);">✅ ทุกห้องอยู่ในเกณฑ์ปกติ</span>`
        : `<span style="color:var(--alert,${DashColors.TERRACOTTA});">⚠️ ${churnCount} ห้องต้องการความสนใจ</span>`;

      container.innerHTML = `
        <div class="card">
          <div class="card-title u-flex-sb">
            <span>👥 Tenant Health</span>
            <button data-action="refreshInsight" data-target="tenant" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem;">
            คะแนน 0–100 จาก: ชำระเงิน · กิจกรรม · ร้องเรียน · ระยะเวลาเช่า &nbsp;·&nbsp; ${statusLine} &nbsp;·&nbsp; คลิกเพื่อดูรายละเอียด
          </div>
          <div style="margin-bottom:.8rem;">${chips}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.5rem;align-items:start;">${tilesHTML}</div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.7rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>
      `;
    } catch (e) {
      console.error('[insights] tenant insights failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('tenant', e.message);
    }
  }

  // ============================================================
  // Register on namespace — expose setters for action handlers
  // ============================================================
  window._ins = window._ins || {};
  window._ins.tenant = {
    renderTenantInsights,
    setHSFilter: function (v) { _hsState.tierFilter = v; renderTenantInsights(); },
  };
}());
