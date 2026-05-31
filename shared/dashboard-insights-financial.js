/**
 * dashboard-insights-financial.js
 * FEATURE 3 — Per-Tenant Payment Behavior
 * FEATURE 6 — Overdue Bills
 *
 * Depends on window._ins.utils being populated by dashboard-insights.js
 * (which loads first via DOM script order).
 */
(function () {
  'use strict';

  // ============================================================
  // FEATURE 3: Per-Tenant Payment Behavior
  // ============================================================
  let _pbState = { sortBy: 'avg_desc', buildingFilter: 'all' };

  async function renderPaymentBehavior() {
    const u = window._ins.utils;
    const container = document.getElementById('dashPaymentBehavior');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      const cached = u.cacheGet('payment_behavior');
      let perRoom;
      if (cached) {
        perRoom = cached;
      } else {
        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet) {
          throw new Error('RTDB ยังไม่พร้อม');
        }
        const billsRef = window.firebaseRef(window.firebaseDatabase, 'bills');
        const snap = await window.firebaseGet(billsRef);
        const all = snap.val() || {};
        const cutoff = Date.now() - 180 * 86400000; // 6 months back
        perRoom = {};
        Object.entries(all).forEach(([building, rooms]) => {
          Object.entries(rooms || {}).forEach(([room, bills]) => {
            const key = `${building}:${room}`;
            perRoom[key] = perRoom[key] || { building, room, deltas: [], paidCount: 0 };
            Object.values(bills || {}).forEach(b => {
              if (!b || !u.billIsPaid(b)) return;
              const dueDate = u.deriveDueDate(b);
              if (!dueDate) return;
              const due = new Date(dueDate).getTime();
              if (!isFinite(due)) return;
              const paidTs = b.paidAt ? new Date(b.paidAt).getTime() : null;
              // Cutoff: use paidAt if known, else due date as proxy
              const refTs = paidTs !== null && isFinite(paidTs) ? paidTs : due;
              if (refTs < cutoff) return;
              // Delta: 0 = assumed on-time when paidAt missing (slip-paid bills)
              const delta = (paidTs !== null && isFinite(paidTs)) ? (paidTs - due) / 86400000 : 0;
              perRoom[key].deltas.push(delta);
              perRoom[key].paidCount++;
            });
          });
        });
        u.cacheSet('payment_behavior', perRoom);
      }

      // Compute aggregates
      const list = Object.values(perRoom).filter(r => r.deltas.length > 0).map(r => {
        const avg = r.deltas.reduce((s, d) => s + d, 0) / r.deltas.length;
        const tier = u.tierFromAvgDelta(avg);
        return { ...r, avg, tier };
      });

      // Apply filter
      let filtered = list;
      if (_pbState.buildingFilter !== 'all') {
        filtered = list.filter(r => r.building === _pbState.buildingFilter);
      }
      // Apply sort
      filtered.sort((a, b) => {
        if (_pbState.sortBy === 'avg_desc') return b.avg - a.avg;
        if (_pbState.sortBy === 'avg_asc') return a.avg - b.avg;
        if (_pbState.sortBy === 'count_desc') return b.paidCount - a.paidCount;
        return 0;
      });

      let tableRows = '';
      if (filtered.length === 0) {
        tableRows = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.2rem;">ยังไม่มีบิลที่ชำระในช่วง 6 เดือน</td></tr>`;
      } else {
        filtered.forEach(r => {
          const sign = r.avg < 0 ? '−' : r.avg > 0 ? '+' : '';
          const avgStr = `${sign}${Math.abs(r.avg).toFixed(1)} วัน`;
          // Bar viz: 6 boxes (or paidCount up to 6)
          const boxCount = Math.min(r.paidCount, 6);
          let bars = '<div style="display:inline-flex;gap:2px;vertical-align:middle;">';
          for (let i = 0; i < 6; i++) {
            const bg = i < boxCount ? r.tier.color : 'var(--mist,#f2f1ec)';
            bars += `<div style="width:10px;height:14px;background:${bg};border-radius:2px;"></div>`;
          }
          bars += '</div>';
          const stars = '⭐'.repeat(r.tier.stars) + (r.tier.stars > 0 ? '' : '—');
          tableRows += `<tr style="border-left:3px solid ${r.tier.color};">
            <td style="padding:.5rem .7rem;font-weight:600;">${u.esc(r.room)} <span style="color:var(--text-muted);font-size:.72rem;font-weight:400;">(${u.buildingLabel(r.building)})</span></td>
            <td style="padding:.5rem .7rem;text-align:right;font-variant-numeric:tabular-nums;color:${r.tier.color};font-weight:600;">${avgStr}</td>
            <td class="u-td-l">${bars} <span style="color:var(--text-muted);font-size:.72rem;margin-left:6px;">${r.paidCount}/6</span></td>
            <td style="padding:.5rem .7rem;text-align:center;">${stars}</td>
            <td style="padding:.5rem .7rem;color:${r.tier.color};font-size:.78rem;font-weight:600;">${r.tier.label}</td>
          </tr>`;
        });
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--green);">
          <div class="card-title u-flex-sb">
            <span>💳 พฤติกรรมการชำระเงิน (6 เดือนล่าสุด)</span>
            <button data-action="refreshInsight" data-target="payment" aria-label="รีเฟรช Payment Behavior"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="display:flex;gap:.5rem;margin-bottom:.7rem;flex-wrap:wrap;align-items:center;">
            <span style="font-size:.78rem;color:var(--text-muted);">เรียง:</span>
            <select data-action="setPBSort" style="padding:4px 10px;border-radius:999px;border:1.5px solid var(--border-base,#dcdbd4);background:${DashColors.WHITE};font-family:'Sarabun',sans-serif;font-size:.78rem;cursor:pointer;">
              <option value="avg_desc" ${_pbState.sortBy==='avg_desc'?'selected':''}>จ่ายช้าสุด ▼</option>
              <option value="avg_asc" ${_pbState.sortBy==='avg_asc'?'selected':''}>จ่ายเร็วสุด ▼</option>
              <option value="count_desc" ${_pbState.sortBy==='count_desc'?'selected':''}>บิลมากสุด ▼</option>
            </select>
            <span style="font-size:.78rem;color:var(--text-muted);">ตึก:</span>
            <select data-action="setPBBuilding" style="padding:4px 10px;border-radius:999px;border:1.5px solid var(--border-base,#dcdbd4);background:${DashColors.WHITE};font-family:'Sarabun',sans-serif;font-size:.78rem;cursor:pointer;">
              <option value="all" ${_pbState.buildingFilter==='all'?'selected':''}>ทั้งหมด</option>
              <option value="rooms" ${_pbState.buildingFilter==='rooms'?'selected':''}>🏠 ห้องแถว</option>
              <option value="nest" ${_pbState.buildingFilter==='nest'?'selected':''}>🏢 Nest</option>
            </select>
          </div>
          <div class="u-scroll-x">
            <table class="u-table-sm">
              <thead>
                <tr style="background:var(--green-pale);color:var(--green-dark);">
                  <th class="u-th-l">ห้อง</th>
                  <th class="u-th-r">เฉลี่ย</th>
                  <th class="u-th-l">ประวัติ</th>
                  <th style="padding:.55rem .7rem;text-align:center;font-weight:700;">Tier</th>
                  <th class="u-th-l">สถานะ</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>
      `;
    } catch (e) {
      console.error('[insights] payment behavior failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('payment', e.message);
    }
  }

  // ============================================================
  // FEATURE 6: Overdue Bills (การเงิน tab)
  // ============================================================
  async function loadAllBillsRaw() {
    const u = window._ins.utils;
    const cached = u.cacheGet('bills_raw');
    if (cached) return cached;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseGet)
      throw new Error('RTDB ยังไม่พร้อม');
    const snap = await window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'bills'));
    const data = snap.val() || {};
    u.cacheSet('bills_raw', data);
    return data;
  }

  async function renderOverdueBills() {
    const u = window._ins.utils;
    const container = document.getElementById('dashOverdueBills');
    if (!container) return;
    container.innerHTML = u.loadingHTML();
    try {
      const all = await loadAllBillsRaw();
      const todayStr = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

      // Aggregate overdue bills by room (sum all unpaid overdue bills per room)
      const byRoom = {};
      Object.entries(all).forEach(([building, rooms]) => {
        Object.entries(rooms || {}).forEach(([room, bills]) => {
          Object.values(bills || {}).forEach(b => {
            if (!b || u.billIsPaid(b)) return;
            const dueDate = u.deriveDueDate(b);
            if (!dueDate || dueDate >= todayStr) return;
            const amount = b.totalCharge || b.totalAmount || b.total || 0;
            if (!amount) return;
            const key = `${building}:${room}`;
            if (!byRoom[key]) byRoom[key] = { building, room, totalOwed: 0, oldestDue: dueDate, count: 0 };
            byRoom[key].totalOwed += Number(amount);
            byRoom[key].count++;
            if (dueDate < byRoom[key].oldestDue) byRoom[key].oldestDue = dueDate;
          });
        });
      });

      const rows = Object.values(byRoom)
        .map(r => ({ ...r, daysOverdue: Math.floor((Date.now() - new Date(r.oldestDue).getTime()) / 86400000) }))
        .filter(r => r.daysOverdue > 0)
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      const totalOwed = rows.reduce((s, r) => s + r.totalOwed, 0);

      let bodyHTML;
      if (rows.length === 0) {
        bodyHTML = `<div style="color:var(--green-dark);font-size:.9rem;padding:.4rem 0;">✅ ไม่มีบิลค้างชำระ</div>`;
      } else {
        const tileColor = r => r.daysOverdue > 14 ? `var(--alert,${DashColors.TERRACOTTA})` : r.daysOverdue > 7 ? `var(--accent,${DashColors.ORANGE_MED})` : 'var(--blue)';
        bodyHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.5rem;margin-bottom:.7rem;">
            ${rows.map(r => `
              <div style="background:${DashColors.WHITE};border:1px solid var(--border-subtle,${DashColors.WARM_WHITE});border-left:4px solid ${tileColor(r)};border-radius:10px;padding:.65rem .75rem;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.15rem;">
                  <span style="font-weight:700;font-size:.9rem;">${u.esc(r.room)} <span style="color:var(--text-muted);font-size:.68rem;font-weight:400;">${u.buildingLabel(r.building)}</span></span>
                  <span style="color:${tileColor(r)};font-weight:700;font-size:.88rem;font-variant-numeric:tabular-nums;">฿${r.totalOwed.toLocaleString()}</span>
                </div>
                <div style="font-size:.7rem;color:${tileColor(r)};font-weight:600;">เกิน ${r.daysOverdue} วัน${r.count > 1 ? ` · ${r.count} บิล` : ''}</div>
                <div style="font-size:.68rem;color:var(--text-muted);">due: ${r.oldestDue}</div>
              </div>`).join('')}
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);">
            รวม <strong style="color:var(--alert,${DashColors.TERRACOTTA});">${rows.length} ห้อง</strong> ·
            ยอดค้างรวม <strong style="color:var(--alert,${DashColors.TERRACOTTA});">฿${totalOwed.toLocaleString()}</strong>
          </div>`;
      }

      container.innerHTML = `
        <div class="card" style="border-left:4px solid var(--alert,${DashColors.TERRACOTTA});">
          <div class="card-title u-flex-sb">
            <span>📌 ค่าเช่าค้างชำระ</span>
            <button data-action="refreshInsight" data-target="overdue" aria-label="รีเฟรช"
                    style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);color:var(--green-dark);border:1px solid var(--green);border-radius:999px;cursor:pointer;font-family:'Sarabun',sans-serif;">↻ refresh</button>
          </div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem;">บิลที่เลยกำหนดชำระและยังไม่ได้ชำระ · คำนวณจากวันนี้ (BKK)</div>
          ${bodyHTML}
          <div style="font-size:.7rem;color:var(--text-muted);text-align:right;margin-top:.5rem;">${u.fmtCacheAge(Date.now())}</div>
        </div>`;
    } catch (e) {
      console.error('[insights] overdue bills failed:', e);
      container.innerHTML = window._ins.utils.errorHTML('overdue', e.message);
    }
  }

  // ============================================================
  // Register on namespace — expose setters for action handlers
  // ============================================================
  window._ins = window._ins || {};
  window._ins.financial = {
    renderPaymentBehavior,
    renderOverdueBills,
    setPBSort:     function (v) { _pbState.sortBy          = v; renderPaymentBehavior(); },
    setPBBuilding: function (v) { _pbState.buildingFilter  = v; renderPaymentBehavior(); },
  };
}());
