/**
 * Dashboard Arrears / Aging — admin per-tenant outstanding receivables view.
 *
 * Roadmap Phase 2 (per-tenant arrears / aging statement). The aggregate
 * `pendingRevenue` (aggregateMonthlyRevenue.js) answers "how much is unpaid this
 * month"; an auditor / owner also needs "WHO owes, HOW MUCH, and HOW OLD". This is
 * the per-tenant, dueDate-aged version of that same number.
 *
 * Arrears definition is pinned to aggregateMonthlyRevenue's `pendingRevenue` so the
 * two reconcile: a bill is outstanding when status ∉ {paid, refunded, void} and it
 * is not a zero/ghost stub (total<=0 && no charges). It reads RTDB bills via
 * BillStore — the SAME source aggregateMonthlyRevenue walks (bills/{b}/{room}/{id}).
 * (void never appears on an RTDB bill today — it lives on the Firestore invoices/
 * doc-of-record — so excluding it is defensive and does not break the reconcile.)
 *
 * Aging anchor = `bill.dueDate` (5th of the month after the bill month, set at
 * generation, immutable). When a legacy/manual bill carries no dueDate we derive the
 * same 5th-of-next-month so the report is robust across every write path.
 *
 * Scope = ALL outstanding as of today, every year (BillStore.subscribe loads the
 * whole bills/{building} tree into cache, so carry-forward across years is free and
 * needs no per-year load). There is no year selector — aging is "as of now".
 *
 * Lives in dashboard.html (admin) — RTDB bills/{building} is admin-read-only
 * (database.rules). computeAging() is PURE (no I/O, `asOf` injected) and exported on
 * window for unit tests; window.initAgingPage() is called by _showPageImpl on
 * showPage('aging').
 */
(function () {
  'use strict';

  const DAY_MS = 86400000;
  const MOUNT_ID = 'aging-mount';
  const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90'];
  let _lastResult = null; // last computeAging() result, for the CSV export handler

  // ── BE/CE helpers (bills use mixed 2-digit BE / 4-digit BE / CE — §7-E) ──
  function toBE(y) {
    const n = Number(y) || 0;
    if (n < 100) return 2500 + n;   // 2-digit BE (69 → 2569)
    if (n < 2400) return n + 543;   // CE (2026 → 2569)
    return n;                       // already 4-digit BE
  }

  // ── Due date → ms. Prefer the persisted ISO dueDate; otherwise derive the
  //    documented convention (5th of the month AFTER the bill month). Exported
  //    for tests — the date math is the most error-prone part. ──
  function _agingDueMs(rawDueDate, month, beYear) {
    if (typeof rawDueDate === 'string' && rawDueDate) {
      const iso = rawDueDate.length <= 10 ? rawDueDate + 'T00:00:00' : rawDueDate;
      const t = Date.parse(iso);
      if (!isNaN(t)) return t;
    }
    const ce = (Number(beYear) || 0) - 543;
    let m = Number(month) || 0; // 1..12
    if (!m || ce <= 0) return NaN;
    m += 1;
    let y = ce;
    if (m > 12) { m = 1; y += 1; } // December bill → due 5th of next January
    return new Date(y, m - 1, 5).getTime(); // 5th of next month, local midnight
  }
  window._agingDueMs = _agingDueMs;

  function _bucketKey(daysOverdue) {
    if (daysOverdue <= 0) return 'current'; // not yet past due
    if (daysOverdue <= 30) return 'd1_30';
    if (daysOverdue <= 60) return 'd31_60';
    if (daysOverdue <= 90) return 'd61_90';
    return 'd90';
  }

  // ── Arrears predicate — mirrors aggregateMonthlyRevenue.js pending definition
  //    (status !== 'paid', refunded skipped, orphan stubs skipped) + void guard. ──
  function _isArrears(b) {
    const st = String((b && b.status) || '').toLowerCase();
    if (st === 'paid' || st === 'refunded' || st === 'void') return false;
    const total = Number(b && b.total) || 0;
    if (total <= 0 && !(b && b.hasCharges)) return false; // ghost/zero stub
    return true;
  }
  window._agingIsArrears = _isArrears;

  // ── PURE: age already-outstanding bills as of `asOf`, group by building+room ──
  // bills: [{ id, building, room, month, beYear, total, dueMs, name? }]
  // asOf:  ms timestamp (local midnight today) — injected so the fn stays pure
  function computeAging({ bills = [], asOf = 0 } = {}) {
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const byRoom = new Map();
    const grand = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0, overdueBills: 0, billCount: 0 };

    for (const b of bills) {
      const total = Number(b.total) || 0;
      if (total <= 0) continue; // a zero amount is never an arrears figure
      const dueMs = Number(b.dueMs);
      const daysOverdue = isNaN(dueMs) ? 0 : Math.floor((asOf - dueMs) / DAY_MS);
      const bk = _bucketKey(daysOverdue);
      const key = String(b.building) + '|' + String(b.room);
      let row = byRoom.get(key);
      if (!row) {
        row = {
          building: b.building, room: b.room, name: b.name || '',
          current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0,
          total: 0, billCount: 0, oldestDays: null, bills: [],
        };
        byRoom.set(key, row);
      }
      if (!row.name && b.name) row.name = b.name;
      row[bk] += total;
      row.total += total;
      row.billCount += 1;
      if (row.oldestDays === null || daysOverdue > row.oldestDays) row.oldestDays = daysOverdue;
      row.bills.push({ id: b.id, month: b.month, beYear: b.beYear, total: round2(total), daysOverdue, bucket: bk });
      grand[bk] += total;
      grand.total += total;
      grand.billCount += 1;
      if (daysOverdue > 0) grand.overdueBills += 1;
    }

    const tenants = Array.from(byRoom.values());
    tenants.forEach((t) => { BUCKETS.forEach((k) => { t[k] = round2(t[k]); }); t.total = round2(t.total); });
    tenants.sort((a, b) => b.total - a.total); // biggest debtors first
    BUCKETS.forEach((k) => { grand[k] = round2(grand[k]); });
    grand.total = round2(grand.total);

    const summary = {
      totalOutstanding: grand.total,
      tenantsInArrears: tenants.length,
      overdueBills: grand.overdueBills,
      billCount: grand.billCount,
      current: grand.current, d1_30: grand.d1_30, d31_60: grand.d31_60, d61_90: grand.d61_90, d90: grand.d90,
      overdueAmount: round2(grand.total - grand.current),
    };
    return { tenants, summary };
  }
  window.computeAging = computeAging;

  // ── Normalizer: raw RTDB bill → the pure fn's input shape ──
  function _normBill(b) {
    const beYear = toBE(b.year);
    const month = Number(b.month) || 0;
    return {
      id: b.billId || b.id || null,
      building: b.building || '',
      room: String(b.roomId || b.room || ''),
      month, beYear,
      total: Number(b.totalCharge != null ? b.totalCharge : (b.totalAmount != null ? b.totalAmount : b.total)) || 0,
      status: b.status || '',
      hasCharges: !!b.charges,
      dueMs: _agingDueMs(b.dueDate, month, beYear),
    };
  }

  // Outstanding (unpaid) bills for ONE room, WITH their real RTDB path keys — for the
  // deposit move-out settlement (spec §1.3: deduct the final/unpaid bill from the deposit,
  // then mark those bills paid-from-deposit). Reuses _normBill + _isArrears so the §7-D/E
  // room+year normalisation lives in one place. Returns the _cache KEY (not the billId
  // field, which isn't guaranteed equal) + the full `path` so the caller can firebaseUpdate
  // the exact bills/{b}/{r}/{key} node. Nest (no bills) → { bills: [], total: 0 } (no-op).
  function outstandingBillsForRoom(building, room) {
    const empty = { bills: [], total: 0 };
    const BS = window.BillStore;
    if (!BS || typeof BS.subscribe !== 'function') return empty;
    BS.subscribe();
    const bld = (typeof BS._bld === 'function') ? BS._bld(building) : String(building);
    const rm = String(room);
    const roomBills = (BS._cache && BS._cache[bld] && BS._cache[bld][rm]) || {};
    const bills = [];
    let total = 0;
    for (const [key, raw] of Object.entries(roomBills)) {
      if (!raw || typeof raw !== 'object') continue;
      const n = _normBill(raw);
      if (!_isArrears(n)) continue;
      bills.push({ key, billId: n.id, month: n.month, beYear: n.beYear, total: n.total, path: `bills/${bld}/${rm}/${key}` });
      total += n.total;
    }
    return { bills, total: Math.round(total * 100) / 100 };
  }
  window.outstandingBillsForRoom = outstandingBillsForRoom;

  // Resolve a room to its current tenant display name (arrears may belong to a
  // moved-out tenant → empty name is fine, the row still shows by room).
  function _tenantName(building, room) {
    try {
      if (window.TenantLookup && typeof window.TenantLookup.getTenantByRoom === 'function') {
        const t = window.TenantLookup.getTenantByRoom(building, room);
        if (t) {
          const nm = t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim();
          if (nm) return nm;
        }
      }
    } catch (_) { /* lookup not ready — render by room only */ }
    return '';
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const baht = (n) => '฿' + (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function renderError(msg) {
    const root = document.getElementById(MOUNT_ID);
    if (root) root.innerHTML = `<div style="padding:1.5rem;color:var(--red,#c62828);">⚠️ คำนวณยอดค้างไม่สำเร็จ: ${esc(msg)}</div>`;
  }

  function _renderAsOf(asOf) {
    const el = document.getElementById('aging-asof');
    if (!el) return;
    try {
      el.textContent = 'ณ วันที่ ' + new Date(asOf).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { el.textContent = ''; }
  }

  function render(result, asOf) {
    const root = document.getElementById(MOUNT_ID);
    if (!root) return;
    const s = result.summary;
    if (!result.tenants.length) {
      root.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted,#6b7a8d);">🎉 ไม่มียอดค้างชำระ — บิลทุกใบชำระครบแล้ว</div>`;
      return;
    }

    const card = (label, val, color) =>
      `<div style="flex:1;min-width:130px;background:var(--surface,#fff);border:1px solid var(--border,#e0e6ed);border-left:4px solid ${color};border-radius:8px;padding:.8rem 1rem;">
        <div style="font-size:1.35rem;font-weight:700;">${val}</div>
        <div style="font-size:.78rem;color:var(--text-muted,#6b7a8d);">${esc(label)}</div></div>`;

    const th = (label, right) => `<th style="padding:.4rem .6rem;text-align:${right ? 'right' : 'left'};white-space:nowrap;">${esc(label)}</th>`;
    const cell = (v, color) => `<td style="padding:.45rem .6rem;text-align:right;${v > 0 && color ? 'color:' + color + ';font-weight:600;' : 'color:var(--text-muted,#9aa7b4);'}">${v > 0 ? baht(v) : '—'}</td>`;
    const tenantRow = (t) => `<tr style="border-bottom:1px solid var(--border,#eef2f6);">
        <td style="padding:.45rem .6rem;white-space:nowrap;">${esc(t.building)}/${esc(t.room)}</td>
        <td style="padding:.45rem .6rem;">${esc(t.name || '—')}</td>
        ${cell(t.current, null)}${cell(t.d1_30, '#b45309')}${cell(t.d31_60, '#b45309')}${cell(t.d61_90, '#c2410c')}${cell(t.d90, 'var(--red,#c62828)')}
        <td style="padding:.45rem .6rem;text-align:right;font-weight:700;">${baht(t.total)}</td>
        <td style="padding:.45rem .6rem;text-align:right;color:${t.oldestDays > 90 ? 'var(--red,#c62828)' : 'var(--text-muted,#6b7a8d)'};">${t.oldestDays > 0 ? (t.oldestDays + ' วัน') : '—'}</td>
      </tr>`;
    const totalRow = `<tr style="border-top:2px solid var(--border,#cdd7e0);font-weight:700;background:var(--surface-alt,#f7f9fb);">
        <td style="padding:.5rem .6rem;" colspan="2">รวมทั้งหมด (${s.tenantsInArrears} ห้อง · ${s.billCount} บิล)</td>
        <td style="padding:.5rem .6rem;text-align:right;">${baht(s.current)}</td>
        <td style="padding:.5rem .6rem;text-align:right;">${baht(s.d1_30)}</td>
        <td style="padding:.5rem .6rem;text-align:right;">${baht(s.d31_60)}</td>
        <td style="padding:.5rem .6rem;text-align:right;">${baht(s.d61_90)}</td>
        <td style="padding:.5rem .6rem;text-align:right;color:var(--red,#c62828);">${baht(s.d90)}</td>
        <td style="padding:.5rem .6rem;text-align:right;">${baht(s.totalOutstanding)}</td>
        <td style="padding:.5rem .6rem;"></td>
      </tr>`;

    root.innerHTML = `
      <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem;">
        ${card('ยอดค้างทั้งหมด', baht(s.totalOutstanding), 'var(--red,#c62828)')}
        ${card('ห้องที่ค้างชำระ', s.tenantsInArrears, 'var(--brand-primary,#2d8653)')}
        ${card('บิลเกินกำหนด', s.overdueBills + ' / ' + s.billCount, '#b45309')}
        ${card('ยอดเกินกำหนด', baht(s.overdueAmount), '#c2410c')}
        ${card('ค้างเกิน 90 วัน', baht(s.d90), 'var(--red,#c62828)')}
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          <thead><tr style="border-bottom:2px solid var(--border,#e0e6ed);">
            ${th('ห้อง')}${th('ผู้เช่า')}${th('ยังไม่ถึงกำหนด', true)}${th('1–30 วัน', true)}${th('31–60 วัน', true)}${th('61–90 วัน', true)}${th('เกิน 90 วัน', true)}${th('รวมค้าง', true)}${th('ค้างนานสุด', true)}
          </tr></thead>
          <tbody>${result.tenants.map(tenantRow).join('')}${totalRow}</tbody>
        </table>
      </div>`;
  }

  // ── CSV export (accountant statement). Mirror of accounting/tax-export.js
  //    download idiom: Blob + object URL + anchor click (hook-safe — no "approve"). ──
  function _csvCell(v) {
    const str = String(v == null ? '' : v);
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  function _exportCsv() {
    if (!_lastResult || !_lastResult.tenants.length) return;
    const head = ['ห้อง', 'ผู้เช่า', 'ยังไม่ถึงกำหนด', '1-30 วัน', '31-60 วัน', '61-90 วัน', 'เกิน 90 วัน', 'รวมค้าง', 'ค้างนานสุด(วัน)'];
    const rows = [head];
    _lastResult.tenants.forEach((t) => {
      rows.push([`${t.building}/${t.room}`, t.name || '', t.current, t.d1_30, t.d31_60, t.d61_90, t.d90, t.total, t.oldestDays > 0 ? t.oldestDays : 0]);
    });
    const s = _lastResult.summary;
    rows.push(['รวมทั้งหมด', '', s.current, s.d1_30, s.d31_60, s.d61_90, s.d90, s.totalOutstanding, '']);
    // Lead with a UTF-8 BOM (U+FEFF) so Excel reads the Thai headers as UTF-8.
    const csv = String.fromCharCode(0xFEFF) + rows.map((r) => r.map(_csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `aging_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch (_) {} }, 1000);
  }

  window.initAgingPage = function () {
    const root = document.getElementById(MOUNT_ID);
    if (!root) return;

    // Wire the CSV button once (the button is static page markup).
    const csvBtn = document.getElementById('aging-csv-btn');
    if (csvBtn && !csvBtn.dataset.wired) { csvBtn.onclick = _exportCsv; csvBtn.dataset.wired = '1'; }

    if (!window.BillStore) { renderError('BillStore ยังไม่พร้อม'); return; } // §7-N: surface, don't spin

    // Cold-entry guard: if the RTDB bills cache hasn't landed yet, listAll() would
    // return [] and we'd render a false "no arrears". Wait for the first snapshot
    // then re-run once (§7-X: never an empty slot that's actually "not loaded").
    if (!window.BillStore.isReady && typeof window.BillStore.onChange === 'function') {
      root.innerHTML = `<div style="padding:1.5rem;color:var(--text-muted,#6b7a8d);">⏳ กำลังโหลดข้อมูลบิล…</div>`;
      const off = window.BillStore.onChange(() => { try { off(); } catch (_) {} window.initAgingPage(); });
      return;
    }

    root.innerHTML = `<div style="padding:1.5rem;color:var(--text-muted,#6b7a8d);">⏳ กำลังคำนวณยอดค้าง…</div>`;
    try {
      const now = new Date();
      const asOf = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); // local midnight today
      const nameCache = new Map();
      const outstanding = (window.BillStore.listAll() || [])
        .map(_normBill)
        .filter(_isArrears)
        .map((b) => {
          const k = b.building + '|' + b.room;
          if (!nameCache.has(k)) nameCache.set(k, _tenantName(b.building, b.room));
          return Object.assign(b, { name: nameCache.get(k) });
        });
      _lastResult = computeAging({ bills: outstanding, asOf });
      _renderAsOf(asOf);
      render(_lastResult, asOf);
    } catch (e) {
      console.error('[aging] init failed:', e);
      renderError((e && (e.code || e.message)) || 'unknown');
    }
  };
})();
