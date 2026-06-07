/* shared/tenant-usage-chart.js
 * 6-month Usage Chart (elec + water tab toggle, tap-for-detail) —
 * extracted from tenant_app.html for maintainability.
 *
 * Dependencies:
 *   window._tenantAppBills    — let _taBills mirrored in inline script at every write site.
 *   window._meterHistoryCache — let _meterHistoryCache mirrored in inline script at every write site.
 *   _taBuilding, _taRoom, _taLease — var globals from tenant-liff-auth.js (accessible as barewords).
 *   window.YearUtils, window.BillStore — global SDK helpers.
 *
 * Exports (window.*):
 *   window.switchUsageChartTab    — action hub (data-action="switchUsageChartTab")
 *   window._renderUsageChart      — called from bill/meter subscribe callbacks in inline script
 *   window._showUsageMonthDetail  — action hub (data-action="_showUsageMonthDetail")
 */
(function () {
    'use strict';

    let _usageChartType = 'elec';
    const _MONTHS_TH_SHORT = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

    function _getMeterHistory(type) {
        // SSoT with past 6 months bills — chart reads from window._tenantAppBills (real +
        // cash_legacy synth) so each chart point matches the meter readings + cost that the
        // user sees on the corresponding bill row. Falls back to raw meter cache (and its
        // localStorage mirror) only if bills haven't loaded yet — uses default rates
        // 8/20 in that cold-start fallback, matching the synth defaults.
        const key = type === 'elec' ? 'electric' : 'water';
        const ceOf = (y) => (window.YearUtils?.toCE?.(y)) || Number(y) || 0;
        const taBills = window._tenantAppBills || [];
        if (Array.isArray(taBills) && taBills.length) {
            const out = [];
            taBills.slice(0, 6).forEach(b => {
                const mr = b.meterReadings?.[key];
                if (!mr) return;
                const ch = b.charges?.[key];
                const ce = ceOf(b.year);
                const units = Number(mr.units) || Math.max(0, (Number(mr.new) || 0) - (Number(mr.old) || 0));
                out.push({
                    month: `${ce}-${String(b.month).padStart(2,'0')}`,
                    old:   Number(mr.old) || 0,
                    new:   Number(mr.new) || 0,
                    units,
                    cost:  Number(ch?.cost) || 0
                });
            });
            if (out.length) return out;
        }
        // Cold-start fallback: raw meter cache (or its localStorage mirror)
        let source = window._meterHistoryCache || [];
        if (!source.length) {
            try { source = JSON.parse(localStorage.getItem(`meter_history_${_taBuilding}_${_taRoom}`) || '[]'); } catch(e) {}
            // localStorage may hold rows from before the boundary filter shipped
            if (window.BillStore?.filterByTenantBoundary) {
                source = window.BillStore.filterByTenantBoundary(
                    source, m => (Number(m.year)||0)*100 + (Number(m.month)||0), _taLease);
            }
        }
        if (!source.length) return [];
        return source.slice(0, 6).map(m => {
            const units = Math.max(0, type === 'elec' ? (m.eNew - m.eOld) : (m.wNew - m.wOld));
            return {
                month: m.monthKey,
                old:   type === 'elec' ? m.eOld : m.wOld,
                new:   type === 'elec' ? m.eNew : m.wNew,
                units,
                cost:  units * (type === 'elec' ? 8 : 20)
            };
        });
    }

    // ===== 6-month Usage Chart (combined elec+water, tab toggle, tap-for-detail) =====
    function switchUsageChartTab(type) {
        _usageChartType = type;
        document.querySelectorAll('.usage-chart-tab').forEach(btn => {
            const active = btn.dataset.type === type;
            btn.style.background = active ? 'white' : 'transparent';
            btn.style.color = active ? (type === 'elec' ? '#d97706' : '#0369a1') : '#64748b';
            btn.style.boxShadow = active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none';
        });
        const detail = document.getElementById('usage-chart-detail');
        if (detail) detail.style.display = 'none';
        _renderUsageChart();
    }

    function _renderUsageChart() {
        const card = document.getElementById('usage-chart-card');
        const wrap = document.getElementById('usage-chart-svg-wrap');
        if (!card || !wrap) return;
        const rows = _getMeterHistory(_usageChartType);
        if (!rows.length) { card.style.display = 'none'; return; }
        card.style.display = '';

        // rows are newest first; reverse for left-to-right timeline
        const data = [...rows].reverse();
        const maxUnits = Math.max(...data.map(r => r.units), 1);
        const H = 170, PAD_X = 20, PAD_TOP = 14, PAD_BOTTOM = 24;
        const W = Math.max(260, wrap.clientWidth || 300);
        const PLOT_W = W - 2 * PAD_X;
        const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
        const isElec = _usageChartType === 'elec';
        const stroke = isElec ? '#f97316' : '#3b82f6';
        const fill   = isElec ? '#fef3c7' : '#dbeafe';

        const points = data.map((r, i) => {
            const x = PAD_X + (PLOT_W * i) / Math.max(1, data.length - 1);
            const y = PAD_TOP + PLOT_H - (PLOT_H * r.units / maxUnits);
            return { x, y, r };
        });
        const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
        const areaPath = linePath + ` L${points[points.length-1].x.toFixed(1)},${PAD_TOP+PLOT_H} L${points[0].x.toFixed(1)},${PAD_TOP+PLOT_H} Z`;

        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:170px; display:block;">`;
        // 3 horizontal gridlines
        for (let k = 0; k <= 2; k++) {
            const gy = PAD_TOP + (PLOT_H * k / 2);
            svg += `<line x1="${PAD_X}" y1="${gy}" x2="${W-PAD_X}" y2="${gy}" stroke="#f1f5f9" stroke-width="1"/>`;
        }
        svg += `<path d="${areaPath}" fill="${fill}" opacity="0.65"/>`;
        svg += `<path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
        points.forEach(p => {
            const [, mo] = p.r.month.split('-');
            const label = _MONTHS_TH_SHORT[parseInt(mo)] || '';
            const safeMonth = (p.r.month || '').replace(/[^0-9-]/g, '');
            svg += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="white" stroke="${stroke}" stroke-width="2.5" style="cursor:pointer;" data-action="_showUsageMonthDetail" data-arg="${safeMonth}"/>`;
            svg += `<text x="${p.x}" y="${H-6}" text-anchor="middle" font-size="10" fill="#6b7280" font-family="inherit">${label}</text>`;
        });
        svg += '</svg>';
        wrap.innerHTML = svg;
    }

    function _showUsageMonthDetail(monthKey) {
        const rows = _getMeterHistory(_usageChartType);
        const idx = rows.findIndex(r => r.month === monthKey);
        if (idx < 0) return;
        const row = rows[idx];
        const prev = rows[idx + 1]; // rows[0] is newest, prev = older
        const detail = document.getElementById('usage-chart-detail');
        if (!detail) return;

        const [yr, mo] = monthKey.split('-');
        const monthLabel = `${_MONTHS_TH_SHORT[parseInt(mo)]} ${parseInt(yr) + 543}`;
        const isElec = _usageChartType === 'elec';
        const unit = isElec ? 'kWh' : 'ลบ.ม.';
        const icon = isElec ? '⚡' : '💧';
        const color = isElec ? '#d97706' : '#0369a1';

        let diffHtml = '';
        if (prev && prev.units > 0) {
            const diff = Math.round((row.units - prev.units) / prev.units * 100);
            diffHtml = diff > 0
                ? `<span style="color:#dc2626; font-weight:700;">+${diff}% จากเดือนก่อน</span>`
                : diff < 0
                    ? `<span style="color:#059669; font-weight:700;">${diff}% จากเดือนก่อน ✨</span>`
                    : `<span style="color:#6b7280;">เท่ากับเดือนก่อน</span>`;
        }

        const daysInMonth = new Date(window.YearUtils.toCE(yr) || parseInt(yr), parseInt(mo), 0).getDate() || 30;
        const avgPerDay = (row.units / daysInMonth).toFixed(1);
        const dailyNote = isElec
            ? `เฉลี่ย ${avgPerDay} ${unit}/วัน <span class="u-color-lighter">(ประมาณ — รอ Smart Home)</span>`
            : `เฉลี่ย ${avgPerDay} ${unit}/วัน <span class="u-color-lighter">(ค่าเฉลี่ยจากยอดเดือน)</span>`;

        detail.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div>
                    <div style="font-size:var(--fs-md); font-weight:700; color:#334435;">${icon} ${monthLabel}</div>
                    ${row.old != null && row.new != null ? `<div style="font-size:10px; color:#9ca3af; margin-top:3px;">มิเตอร์ ${row.old} → ${row.new}</div>` : ''}
                </div>
                <div class="u-text-right">
                    <div style="font-size:1.3rem; font-weight:800; color:${color}; line-height:1.1;">${Number(row.units).toLocaleString()}<span style="font-size:var(--fs-sm); color:#888; font-weight:600; margin-left:4px;">${unit}</span></div>
                    <div style="font-size:var(--fs-sm); font-weight:700; color:#555;">฿ ${Number(row.cost).toLocaleString()}</div>
                </div>
            </div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #e5e7eb; font-size:10px; color:#6b7280; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <span>${dailyNote}</span>
                <span>${diffHtml}</span>
            </div>`;
        detail.style.display = '';
    }

    window.switchUsageChartTab   = switchUsageChartTab;
    window._renderUsageChart     = _renderUsageChart;
    window._showUsageMonthDetail = _showUsageMonthDetail;
})();
