/**
 * dashboard-insights-operations.js
 * FEATURE 7  — Operations Summary (ปฏิบัติการ tab)
 * FEATURE 9  — Meter Usage Spike (ปฏิบัติการ tab)
 * FEATURE 10 — Provider Scorecard (ปฏิบัติการ tab)
 *
 * Depends on window._ins.utils being populated by dashboard-insights.js
 * (which loads first via DOM script order).
 */
(function () {
  'use strict';

  // ============================================================
  // FEATURE 7: Operations Summary (ปฏิบัติการ tab)
  // ============================================================
  async function renderOperationsInsights() {
    const u = window._ins.utils;
    const complaintsRow = document.getElementById('dashOpsComplaintsRow');
    const miniCardsCol  = document.getElementById('dashMiniCardsCol');
    const container = complaintsRow || document.getElementById('dashComplaintsCol') || document.getElementById('dashOperationsInsights');
    if (!container) return;
    if (complaintsRow) complaintsRow.innerHTML = u.loadingHTML();
    if (miniCardsCol)  miniCardsCol.innerHTML  = u.loadingHTML();
    else if (!complaintsRow) container.innerHTML = u.loadingHTML();
    try {
      if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions)
        throw new Error('Firestore ยังไม่พร้อม');
      const db = window.firebase.firestore();
      const { collection, collectionGroup, getDocs, query, limit } = window.firebase.firestoreFunctions;

      const [complaintsSnap, maintSnap, houseSnap, petsSnap, liffSnap] = await Promise.all([
        getDocs(query(collection(db, 'complaints'), limit(1000))),
        window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'maintenance'))
          .catch(() => ({ val: () => ({}) })),
        window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'housekeeping'))
          .catch(() => ({ val: () => ({}) })),
        getDocs(query(collectionGroup(db, 'pets'), limit(500))).catch(() => ({ forEach: () => {} })),
        getDocs(query(collection(db, 'liffUsers'), limit(2000))).catch(() => ({ forEach: () => {} }))
      ]);

      // Complaints — last 90 days
      const cutoff90 = Date.now() - 90 * 86400000;
      const cStatus = { open: 0, 'in-progress': 0, resolved: 0 };
      const cByCategory = {};
      const resolveTimes = [];

      complaintsSnap.forEach(d => {
        const data = d.data() || {};
        const ts = data.createdAt ? new Date(data.createdAt).getTime() : null;
        if (ts && ts < cutoff90) return;
        const s = data.status || 'open';
        cStatus[s] = (cStatus[s] !== undefined ? cStatus[s] : 0) + 1;
        cByCategory[data.category || 'other'] = (cByCategory[data.category || 'other'] || 0) + 1;
        if (s === 'resolved' && data.createdAt && data.updatedAt) {
          const days = (new Date(data.updatedAt) - new Date(data.createdAt)) / 86400000;
          if (days >= 0 && days < 365) resolveTimes.push(days);
        }
      });

      const totalComplaints = Object.values(cStatus).reduce((s, v) => s + v, 0);
      const avgResolve = resolveTimes.length
        ? (resolveTimes.reduce((s, v) => s + v, 0) / resolveTimes.length).toFixed(1)
        : null;
      const topCats = Object.entries(cByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);

      // Maintenance (RTDB)
      const maintAll = maintSnap.val() || {};
      const overdueThreshold = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const mStatus = { pending: 0, inprogress: 0, done: 0 };
      const mOverdue = [];

      Object.entries(maintAll).forEach(([building, rooms]) => {
        Object.entries(rooms || {}).forEach(([room, items]) => {
          Object.values(items || {}).forEach(item => {
            if (!item) return;
            const s = item.status || 'pending';
            if (s === 'pending') mStatus.pending++;
            else if (s === 'inprogress') mStatus.inprogress++;
            else if (s === 'done') mStatus.done++;
            else mStatus.pending++;
            if ((s === 'pending' || s === 'inprogress') && item.reportedAt && item.reportedAt < overdueThreshold) {
              mOverdue.push({ building, room, reportedAt: item.reportedAt });
            }
          });
        });
      });

      const totalMaint = mStatus.pending + mStatus.inprogress + mStatus.done;

      // Housekeeping (RTDB)
      const houseAll = houseSnap.val() || {};
      const hStatus = { pending: 0, inprogress: 0, done: 0 };
      Object.entries(houseAll).forEach(([building, rooms]) => {
        Object.entries(rooms || {}).forEach(([room, items]) => {
          Object.values(items || {}).forEach(item => {
            if (!item) return;
            const s = (item.status || 'pending').toLowerCase();
            if (s === 'pending' || s === 'requested') hStatus.pending++;
            else if (s === 'inprogress' || s === 'in-progress' || s === 'accepted') hStatus.inprogress++;
            else hStatus.done++;
          });
        });
      });
      const totalHouse = hStatus.pending + hStatus.inprogress + hStatus.done;

      // Pet Approvals (Firestore collectionGroup 'pets')
      // Mirror of the §7-T filter in shared/dashboard-tenant-lease.js — exclude
      // archived pets so this KPI doesn't inflate on every move-out cycle.
      const pStatus = { pending: 0, approved: 0, rejected: 0 };
      petsSnap.forEach(d => {
        // tenants/{b}/list/{r}/pets/{id}            → parts[2]==='list'    (live, count)
        // tenants/{b}/archive/{cid}/pets/{id}       → parts[2]==='archive' (skip)
        const parts = d.ref.path.split('/');
        if (parts[2] !== 'list') return;

        const s = (d.data().status || 'pending').toLowerCase();
        if (s in pStatus) pStatus[s]++; else pStatus.pending++;
      });
      const totalPets = pStatus.pending + pStatus.approved + pStatus.rejected;

      // LINE Link Requests (Firestore 'liffUsers')
      const lStatus = { pending: 0, approved: 0, rejected: 0 };
      liffSnap.forEach(d => {
        const s = (d.data().status || 'pending').toLowerCase();
        if (s in lStatus) lStatus[s]++; else lStatus.pending++;
      });
      const totalLiff = lStatus.pending + lStatus.approved + lStatus.rejected;

      // ── Overall health pulse ──
      const hasUrgent = cStatus.open > 0 || mOverdue.length > 0;
      const hasPending = cStatus['in-progress'] > 0 || mStatus.pending > 0 || hStatus.pending > 0 || pStatus.pending > 0 || lStatus.pending > 0;
      const pulseClass = hasUrgent ? 'danger' : hasPending ? 'warn' : 'ok';
      const urgentBits = [cStatus.open ? `คำร้องเรียน ${cStatus.open}` : '', mOverdue.length ? `งานซ่อมค้าง ${mOverdue.length}` : ''].filter(Boolean);
      const pendBits = [
        mStatus.pending ? `ซ่อม ${mStatus.pending}` : '',
        hStatus.pending ? `แม่บ้าน ${hStatus.pending}` : '',
        pStatus.pending ? `สัตว์เลี้ยง ${pStatus.pending}` : '',
        lStatus.pending ? `LINE ${lStatus.pending}` : '',
        cStatus['in-progress'] ? `กำลังแก้ ${cStatus['in-progress']}` : ''
      ].filter(Boolean);
      const pulseLabel = pulseClass === 'danger'
        ? `⚠️ ต้องดำเนินการด่วน — ${urgentBits.join(' · ')}`
        : pulseClass === 'warn'
        ? `⏳ มีรายการรอดำเนินการ — ${pendBits.join(' · ')}`
        : '✅ ทุกอย่างเรียบร้อย — ไม่มีรายการค้างดำเนินการ';

      // ── Flat queue strip: 5 ops queues, ONE surface, hairline columns, no per-tile box ──
      const qNumCls = (urgent, pending) => urgent ? 'red' : pending ? 'amber' : '';
      const SEP = '<span class="sep">·</span>';
      const qMeta = (parts) => { const s = parts.filter(Boolean).join(SEP); return s || '<span class="sep">—</span>'; };
      const qCol = (icon, name, num, numCls, unit, metaHTML) =>
        `<div class="ops-q">
          <div class="ops-q-head"><span class="ops-q-icon">${icon}</span><span class="ops-q-name">${name}</span></div>
          <div class="ops-q-num ${numCls}">${num}</div>
          <div class="ops-q-unit">${unit}</div>
          <div class="ops-q-meta">${metaHTML}</div>
        </div>`;

      const queueHTML = `<div class="ops-sec-label">คิวงานที่ต้องดูแล</div>
        <div class="ops-queue">
          ${qCol('⚠️', 'คำร้องเรียน', cStatus.open, qNumCls(cStatus.open > 0, cStatus['in-progress'] > 0), 'เปิดอยู่', qMeta([
            cStatus.resolved ? `<span class="ok">✓ ${cStatus.resolved} แก้แล้ว</span>` : '',
            avgResolve ? `เฉลี่ย ${avgResolve} วัน` : (totalComplaints ? `${totalComplaints} ทั้งหมด` : '')
          ]))}
          ${qCol('🔧', 'ซ่อมบำรุง', mStatus.pending, qNumCls(mOverdue.length > 0, mStatus.pending > 0), 'รอดำเนินการ', qMeta([
            mOverdue.length ? `<span class="red">ค้าง ${mOverdue.length}</span>` : '',
            mStatus.inprogress ? `${mStatus.inprogress} กำลังทำ` : '',
            mStatus.done ? `<span class="ok">✓ ${mStatus.done} เสร็จ</span>` : ''
          ]))}
          ${qCol('🧹', 'แม่บ้าน', hStatus.pending, qNumCls(false, hStatus.pending > 0), 'รอดำเนินการ', qMeta([
            hStatus.inprogress ? `${hStatus.inprogress} กำลังทำ` : '',
            hStatus.done ? `<span class="ok">✓ ${hStatus.done} เสร็จ</span>` : ''
          ]))}
          ${qCol('🐾', 'สัตว์เลี้ยง', pStatus.pending, qNumCls(false, pStatus.pending > 0), 'รออนุมัติ', qMeta([
            pStatus.approved ? `<span class="ok">✓ ${pStatus.approved} อนุมัติ</span>` : '',
            pStatus.rejected ? `${pStatus.rejected} ปฏิเสธ` : ''
          ]))}
          ${qCol('🔗', 'LINE', lStatus.pending, qNumCls(false, lStatus.pending > 0), 'รออนุมัติ', qMeta([
            lStatus.approved ? `<span class="ok">✓ ${lStatus.approved} เชื่อมแล้ว</span>` : '',
            lStatus.rejected ? `${lStatus.rejected} ปฏิเสธ` : ''
          ]))}
        </div>`;

      const summaryHTML = `<div class="ops-health ${pulseClass}">
          <div class="ops-health-msg">${pulseLabel}</div>
          <button class="ops-refresh" data-action="refreshInsight" data-target="operations" aria-label="รีเฟรช">↻ refresh</button>
        </div>
        ${queueHTML}`;

      if (complaintsRow) {
        complaintsRow.innerHTML = summaryHTML;
        if (miniCardsCol) miniCardsCol.innerHTML = '';
      } else {
        container.innerHTML = summaryHTML;
      }
    } catch (e) {
      console.error('[insights] operations failed:', e);
      if (complaintsRow) complaintsRow.innerHTML = window._ins.utils.errorHTML('operations', e.message);
      if (miniCardsCol) miniCardsCol.innerHTML = '';
      else container.innerHTML = window._ins.utils.errorHTML('operations', e.message);
    }
  }

  // ============================================================
  // FEATURE 9: Meter Usage Spike (ปฏิบัติการ tab)
  // ============================================================
  async function renderMeterSpike() {
    const u = window._ins.utils;
    const container = document.getElementById('dashMeterSpike');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      const cached = u.cacheGet('meter_spike');
      let spikes;
      if (cached) {
        spikes = cached;
      } else {
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions)
          throw new Error('Firestore ยังไม่พร้อม');
        const db = window.firebase.firestore();
        const { collection, getDocs, query, where } = window.firebase.firestoreFunctions;
        // §7-AAA: a bare limit() on meter_data returns docs doc-ID-ASCENDING (oldest
        // first), so a cap silently drops the NEWEST months — exactly the readings the
        // spike check (latest vs prior-3 median) needs. Scope to the current + previous
        // 2-digit-BE year instead (§7-E: `year` is 2-digit BE). Single-field `in` uses
        // the automatic index — no composite index, no unordered cap. String variants
        // are defensive against any legacy string-typed `year`.
        const _curBE = new Date().getFullYear() - 1957;            // 2026 → 69
        const _yearScope = [_curBE - 1, _curBE, String(_curBE - 1), String(_curBE)];
        const snap = await getDocs(query(collection(db, 'meter_data'), where('year', 'in', _yearScope)));

        const byRoom = {};
        snap.forEach(d => {
          const data = d.data() || {};
          const { building, roomId, year, month, eNew, eOld } = data;
          if (!building || !roomId || year == null || month == null) return;
          const eUsage = Number(eNew || 0) - Number(eOld || 0);
          if (eUsage < 0) return;
          const key = `${building}:${roomId}`;
          if (!byRoom[key]) byRoom[key] = { building, roomId, readings: [] };
          byRoom[key].readings.push({ year: Number(year), month: Number(month), eUsage });
        });

        const SPIKE_RATIO = 1.5;
        spikes = [];
        Object.values(byRoom).forEach(({ building, roomId, readings }) => {
          if (readings.length < 4) return;
          readings.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
          const latest = readings[readings.length - 1];
          const prior3 = readings.slice(-4, -1).map(r => r.eUsage).sort((a, b) => a - b);
          const median = prior3[1];
          if (median < 5) return;
          if (latest.eUsage > SPIKE_RATIO * median) {
            spikes.push({
              building, roomId,
              latestE: latest.eUsage,
              medianE: median,
              ratio: Math.round(latest.eUsage / median * 10) / 10,
              month: latest.month, year: latest.year
            });
          }
        });
        spikes.sort((a, b) => b.ratio - a.ratio);
        u.cacheSet('meter_spike', spikes);
      }

      let bodyHTML;
      if (spikes.length === 0) {
        bodyHTML = `<div style="color:var(--green-dark);font-size:.88rem;padding:.4rem 0;">✅ ไม่พบการใช้ไฟฟ้าผิดปกติ</div>`;
      } else {
        const TOP_N = 5;
        const rows = spikes.slice(0, TOP_N).map(s => {
          const color = s.ratio >= 2 ? `var(--alert,${DashColors.TERRACOTTA})` : `var(--accent,${DashColors.ORANGE_MED})`;
          return `<tr style="border-bottom:1px solid var(--border-subtle,${DashColors.WARM_WHITE});border-left:3px solid ${color};">
            <td style="padding:.3rem .5rem;font-weight:600;">${u.esc(s.roomId)} <span style="color:var(--text-muted);font-size:.72rem;">${u.buildingLabel(s.building)}</span></td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;">${s.latestE} <span style="color:var(--text-muted);font-size:.72rem;">หน่วย</span></td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;">${s.medianE} <span style="color:var(--text-muted);font-size:.72rem;">หน่วย</span></td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;color:${color};font-weight:600;">${s.ratio}×</td>
          </tr>`;
        }).join('');
        const moreHTML = spikes.length > TOP_N
          ? `<div style="font-size:.73rem;color:var(--text-muted);padding:.35rem .7rem;">+${spikes.length - TOP_N} ห้องเพิ่มเติม</div>`
          : '';
        bodyHTML = `<table class="u-table-sm">
            <thead><tr style="background:var(--mist,#f2f1ec);">
              <th style="padding:.3rem .5rem;text-align:left;">ห้อง</th>
              <th style="padding:.3rem .5rem;text-align:right;">ล่าสุด</th>
              <th style="padding:.3rem .5rem;text-align:right;">median</th>
              <th style="padding:.3rem .5rem;text-align:right;">×</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${moreHTML}`;
      }

      const _spikeBorderColor = spikes.length > 0 ? 'var(--alert,#dc2626)' : 'var(--ok,#14b8a6)';
      container.innerHTML = `<div class="card" style="border-top:3px solid ${_spikeBorderColor};">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;">
          <span>⚡ Meter Usage Spike</span>
          <button data-action="refreshInsight" data-target="meterSpike" aria-label="รีเฟรช Meter Spike"
                  style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;">↻ refresh</button>
        </div>
        ${bodyHTML}
      </div>`;
    } catch (e) {
      console.error('[insights] meter spike failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('meterSpike', e.message);
    }
  }

  // ============================================================
  // FEATURE 10: Provider Scorecard (ปฏิบัติการ tab)
  // ============================================================
  function renderProviderScore() {
    const u = window._ins.utils;
    const container = document.getElementById('dashProviderScore');
    if (!container) return;
    try {
      let tickets = [];
      try { tickets = JSON.parse(localStorage.getItem('maintenance_data') || '[]'); } catch (e) {}

      const providers = (typeof window.ServiceProvidersStore !== 'undefined' && window.ServiceProvidersStore.getAll)
        ? window.ServiceProvidersStore.getAll()
        : (JSON.parse(localStorage.getItem('service_providers_data') || '[]'));
      const provMap = {};
      providers.forEach(p => { provMap[p.id] = p; });

      const byProvider = {};
      tickets.forEach(t => {
        if (!t.assignedProviderId) return;
        const pid = t.assignedProviderId;
        if (!byProvider[pid]) byProvider[pid] = { tickets: [], totalCost: 0, costCount: 0, resolveTimes: [] };
        byProvider[pid].tickets.push(t);
        if (t.costThb && Number(t.costThb) > 0) {
          byProvider[pid].totalCost += Number(t.costThb);
          byProvider[pid].costCount++;
        }
        if (t.status === 'done' && t.reportedAt && t.completedAt) {
          const days = (new Date(t.completedAt) - new Date(t.reportedAt)) / 86400000;
          if (days >= 0 && days < 365) byProvider[pid].resolveTimes.push(days);
        }
      });

      let bodyHTML;
      if (Object.keys(byProvider).length === 0) {
        bodyHTML = `<div style="text-align:center;color:var(--text-muted);padding:1.5rem;">
          <div style="font-size:2rem;opacity:.35;margin-bottom:.5rem;">🔧</div>
          <div style="font-size:.85rem;">ยังไม่มีงานซ่อมที่กำหนดผู้รับเหมา</div>
          <div style="font-size:.75rem;margin-top:.3rem;">เพิ่ม "ผู้รับเหมา" เมื่อสร้างงานซ่อมแซม</div>
        </div>`;
      } else {
        const rows = Object.entries(byProvider).map(([pid, d]) => {
          const prov = provMap[pid] || { name: pid, type: '' };
          const total = d.tickets.length;
          const done = d.tickets.filter(t => t.status === 'done').length;
          const completionRate = total ? Math.round(done / total * 100) : 0;
          const avgCost = d.costCount > 0 ? Math.round(d.totalCost / d.costCount) : null;
          const avgDays = d.resolveTimes.length > 0
            ? (d.resolveTimes.reduce((s, v) => s + v, 0) / d.resolveTimes.length).toFixed(1)
            : null;
          return { prov, total, done, completionRate, avgCost, avgDays };
        }).sort((a, b) => b.total - a.total);

        const tableRows = rows.map(r => {
          const rateColor = r.completionRate >= 80 ? 'var(--green)' : r.completionRate >= 50 ? 'var(--blue)' : `var(--accent,${DashColors.ORANGE_MED})`;
          return `<tr style="border-bottom:1px solid var(--border-subtle,${DashColors.WARM_WHITE});">
            <td style="padding:.3rem .5rem;max-width:110px;">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${u.esc(r.prov.name)}">${u.esc(r.prov.name)}</div>
              ${r.prov.type ? `<div style="font-size:.7rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.esc(r.prov.type)}</div>` : ''}
            </td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;">${r.total}</td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};font-weight:600;">${r.completionRate}%</td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;">${r.avgCost != null ? '฿' + r.avgCost.toLocaleString() : '—'}</td>
            <td style="padding:.3rem .5rem;text-align:right;font-variant-numeric:tabular-nums;">${r.avgDays != null ? r.avgDays + ' วัน' : '—'}</td>
          </tr>`;
        }).join('');
        bodyHTML = `<table class="u-table-sm">
            <thead><tr style="background:var(--mist,#f2f1ec);">
              <th style="padding:.3rem .5rem;text-align:left;">ผู้รับเหมา</th>
              <th style="padding:.3rem .5rem;text-align:right;">งาน</th>
              <th style="padding:.3rem .5rem;text-align:right;">เสร็จ %</th>
              <th style="padding:.3rem .5rem;text-align:right;">ค่าเฉลี่ย</th>
              <th style="padding:.3rem .5rem;text-align:right;">เวลา</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>`;
      }

      container.innerHTML = `<div class="card" style="border-top:3px solid var(--brand-primary,${DashColors.TEAL});">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;">
          <span>🏗️ Provider Scorecard</span>
          <button data-action="refreshInsight" data-target="providerScore" aria-label="รีเฟรช Provider Scorecard"
                  style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;">↻ refresh</button>
        </div>
        ${bodyHTML}
      </div>`;
    } catch (e) {
      console.error('[insights] provider scorecard failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('providerScore', e.message);
    }
  }

  // ============================================================
  // Register on namespace
  // ============================================================
  window._ins = window._ins || {};
  window._ins.operations = { renderOperationsInsights, renderMeterSpike, renderProviderScore };
}());
