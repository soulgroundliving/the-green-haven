/**
 * Dashboard Payment Reconciliation — admin slip↔bill matched / unmatched view.
 *
 * Roadmap Phase 2 (reconcile report). Basis for bank-statement reconciliation:
 * cross-references RTDB bills, Firestore verifiedSlips, and Firestore manualReceipts
 * for a chosen BE year and surfaces what does NOT line up.
 *
 * Lives in dashboard.html (admin) — NOT tax-filing.html — because verifiedSlips +
 * manualReceipts are admin-read-only (firestore.rules:235/788); the accountant page
 * would need a rules grant. (§7-rule-tighten: don't loosen rules just to host a view.)
 *
 * Matching reality (verified): a slip has NO billId, but a PAID bill carries
 * `paidRef` = the slip transactionId (verifySlip.js:348-353), and manualReceipts carry
 * an explicit `billId`. So matching is: bill.paidRef → slip, OR manualReceipts[billId],
 * OR a heuristic building+room+month+amount fallback for legacy paid bills.
 *
 * computeReconciliation() is PURE (no I/O) and is exported on window for unit tests.
 * window.initReconcilePage() is called by _showPageImpl on showPage('reconcile').
 */
(function () {
  'use strict';

  const AMOUNT_TOLERANCE = 1; // ฿ — matches verifySlip's |diff|<=1 hard-reject band
  const SLIP_LIMIT = 1000;    // bound the verifiedSlips read; log if we hit it (no silent cap)

  // ── BE/CE year helpers (bills use mixed 2-digit BE / 4-digit BE / CE — §7-E) ──
  function toBE(y) {
    const n = Number(y) || 0;
    if (n < 100) return 2500 + n;       // 2-digit BE (69 → 2569)
    if (n < 2400) return n + 543;       // CE (2026 → 2569)
    return n;                           // already 4-digit BE
  }

  // ── PURE: cross-reference normalized bills/slips/receipts → reconciliation buckets ──
  // bills:        [{ id, building, room, month, beYear, total, status, paidRef, receiptNo }]
  // slips:        [{ transactionId, building, room, amount, beYear, month, receiptNo }]
  // manualReceipts:[{ billId, building, room, receiptNo }]
  function computeReconciliation({ bills = [], slips = [], manualReceipts = [] } = {}) {
    const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
    const slipById = new Map();
    slips.forEach(s => { if (s && s.transactionId != null) slipById.set(String(s.transactionId), s); });
    const receiptByBillId = new Map();
    manualReceipts.forEach(r => { if (r && r.billId != null) receiptByBillId.set(String(r.billId), r); });

    // Index slips by building|room|month for the heuristic fallback.
    const slipsByRoomMonth = new Map();
    const rmKey = (b, r, m) => `${norm(b)}|${norm(r)}|${Number(m) || 0}`;
    slips.forEach(s => {
      const k = rmKey(s.building, s.room, s.month);
      if (!slipsByRoomMonth.has(k)) slipsByRoomMonth.set(k, []);
      slipsByRoomMonth.get(k).push(s);
    });

    const matched = [];          // { bill, slip|null, via, receiptNo }
    const unmatchedPaidBills = []; // paid bill with no slip + no manual receipt
    const mismatches = [];       // matched bill where |slip.amount - bill.total| > tolerance
    const refundedBills = [];    // refunded bill (money returned) + its original slip, if any
    const linkedSlipIds = new Set();

    for (const bill of bills) {
      const st = norm(bill.status);
      // Refunded bills (Roadmap Phase 2 — money returned) are reversed. Pair the
      // original slip via paidRef so it is NOT flagged as an orphan "received money with
      // no bill", and bucket it separately so the reversal is visible to the accountant.
      if (st === 'refunded') {
        let rslip = null;
        if (bill.paidRef && slipById.has(String(bill.paidRef))) {
          rslip = slipById.get(String(bill.paidRef));
          linkedSlipIds.add(String(rslip.transactionId));
        }
        refundedBills.push({ bill, slip: rslip, receiptNo: bill.receiptNo || (rslip && rslip.receiptNo) || null });
        continue;
      }
      if (st !== 'paid') continue; // reconcile only settled bills
      let slip = null, via = null, receiptNo = bill.receiptNo || null;

      // 1) explicit bill → slip link
      if (bill.paidRef && slipById.has(String(bill.paidRef))) {
        slip = slipById.get(String(bill.paidRef)); via = 'paidRef';
      }
      // 2) explicit cash receipt by billId
      else if (bill.id != null && receiptByBillId.has(String(bill.id))) {
        const mr = receiptByBillId.get(String(bill.id)); via = 'manualReceipt';
        receiptNo = receiptNo || mr.receiptNo || null;
      }
      // 3) heuristic building+room+month, amount within tolerance
      else {
        const cands = slipsByRoomMonth.get(rmKey(bill.building, bill.room, bill.month)) || [];
        const hit = cands.find(s => Math.abs((Number(s.amount) || 0) - (Number(bill.total) || 0)) <= AMOUNT_TOLERANCE && !linkedSlipIds.has(String(s.transactionId)))
          || cands.find(s => !linkedSlipIds.has(String(s.transactionId)));
        if (hit) { slip = hit; via = 'heuristic'; }
      }

      if (slip) {
        linkedSlipIds.add(String(slip.transactionId));
        receiptNo = receiptNo || slip.receiptNo || null;
        const diff = (Number(slip.amount) || 0) - (Number(bill.total) || 0);
        const row = { bill, slip, via, receiptNo, amountDiff: Math.round(diff * 100) / 100 };
        matched.push(row);
        if (Math.abs(diff) > AMOUNT_TOLERANCE) mismatches.push(row);
      } else if (via === 'manualReceipt') {
        matched.push({ bill, slip: null, via, receiptNo, amountDiff: 0 });
      } else {
        unmatchedPaidBills.push({ bill, receiptNo });
      }
    }

    // Slips not linked to any paid bill = received money with no settled bill.
    const unmatchedSlips = slips.filter(s => !linkedSlipIds.has(String(s.transactionId)));

    const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
    const summary = {
      paidBills: matched.length + unmatchedPaidBills.length,
      slips: slips.length,
      matched: matched.length,
      unmatchedSlips: unmatchedSlips.length,
      unmatchedPaidBills: unmatchedPaidBills.length,
      mismatches: mismatches.length,
      refunded: refundedBills.length,
      matchedAmount: Math.round(sum(matched, r => r.slip ? r.slip.amount : r.bill.total) * 100) / 100,
      unmatchedSlipAmount: Math.round(sum(unmatchedSlips, s => s.amount) * 100) / 100,
      refundedAmount: Math.round(sum(refundedBills, r => r.bill.total) * 100) / 100,
    };
    return { matched, unmatchedSlips, unmatchedPaidBills, mismatches, refundedBills, summary };
  }
  window.computeReconciliation = computeReconciliation;

  // ── Normalizers: raw store/Firestore shapes → the pure fn's input shapes ──
  function _slipMonthBE(slip) {
    // verifiedSlips carry `date` (slip date) — derive month + BE year from it.
    const d = slip.date ? new Date(slip.date) : null;
    if (d && !isNaN(d)) return { month: d.getMonth() + 1, beYear: d.getFullYear() + 543 };
    return { month: 0, beYear: 0 };
  }
  function _normBill(b) {
    return {
      id: b.billId || b.id || null,
      building: b.building || '', room: String(b.roomId || b.room || ''),
      month: Number(b.month) || 0, beYear: toBE(b.year),
      total: Number(b.totalCharge != null ? b.totalCharge : (b.totalAmount != null ? b.totalAmount : b.total)) || 0,
      status: b.status || '', paidRef: b.paidRef || b.transactionId || null, receiptNo: b.receiptNo || null,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  const MOUNT_ID = 'reconcile-mount';
  const YEAR_ID = 'reconcile-year';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const baht = (n) => '฿' + (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function renderError(msg) {
    const root = document.getElementById(MOUNT_ID);
    if (root) root.innerHTML = `<div style="padding:1.5rem;color:var(--red,#c62828);">⚠️ กระทบยอดไม่สำเร็จ: ${esc(msg)}</div>`;
  }

  function render(result, beYear) {
    const root = document.getElementById(MOUNT_ID);
    if (!root) return;
    const s = result.summary;
    const card = (label, val, color) =>
      `<div style="flex:1;min-width:120px;background:var(--surface,#fff);border:1px solid var(--border,#e0e6ed);border-left:4px solid ${color};border-radius:8px;padding:.8rem 1rem;">
        <div style="font-size:1.4rem;font-weight:700;">${val}</div>
        <div style="font-size:.8rem;color:var(--text-muted,#6b7a8d);">${esc(label)}</div></div>`;

    const billRoom = (b) => `${esc(b.building)}/${esc(b.room)} · เดือน ${b.month || '—'}`;
    const slipRow = (sl) => `<tr><td style="padding:.4rem .6rem;">${esc(sl.building)}/${esc(sl.room)}</td>
      <td style="padding:.4rem .6rem;">เดือน ${sl.month || '—'}/${sl.beYear || '—'}</td>
      <td style="padding:.4rem .6rem;text-align:right;">${baht(sl.amount)}</td>
      <td style="padding:.4rem .6rem;">${esc(sl.receiptNo || '—')}</td>
      <td style="padding:.4rem .6rem;font-family:monospace;font-size:.75rem;">${esc(sl.transactionId)}</td></tr>`;
    const billPaidRow = (x) => `<tr><td style="padding:.4rem .6rem;">${billRoom(x.bill)}</td>
      <td style="padding:.4rem .6rem;text-align:right;">${baht(x.bill.total)}</td>
      <td style="padding:.4rem .6rem;">${esc(x.receiptNo || '—')}</td></tr>`;
    const mismatchRow = (r) => `<tr><td style="padding:.4rem .6rem;">${billRoom(r.bill)}</td>
      <td style="padding:.4rem .6rem;text-align:right;">${baht(r.bill.total)}</td>
      <td style="padding:.4rem .6rem;text-align:right;">${baht(r.slip ? r.slip.amount : 0)}</td>
      <td style="padding:.4rem .6rem;text-align:right;color:var(--red,#c62828);">${baht(r.amountDiff)}</td></tr>`;
    const refundedRow = (r) => `<tr><td style="padding:.4rem .6rem;">${billRoom(r.bill)}</td>
      <td style="padding:.4rem .6rem;text-align:right;">${baht(r.bill.total)}</td>
      <td style="padding:.4rem .6rem;">${esc(r.receiptNo || '—')}</td>
      <td style="padding:.4rem .6rem;">${r.slip ? '✓ สลิปเดิม' : '—'}</td></tr>`;

    const section = (title, color, head, rowsHtml, empty) => `
      <h3 style="margin:1.4rem 0 .5rem;font-size:1rem;border-left:4px solid ${color};padding-left:.6rem;">${esc(title)}</h3>
      ${rowsHtml ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.85rem;">
        <thead><tr style="text-align:left;border-bottom:2px solid var(--border,#e0e6ed);">${head}</tr></thead>
        <tbody>${rowsHtml}</tbody></table></div>`
        : `<div style="padding:.8rem;color:var(--text-muted,#6b7a8d);">${esc(empty)}</div>`}`;

    root.innerHTML = `
      <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.5rem;">
        ${card('บิลที่ชำระแล้ว', s.paidBills, 'var(--brand-primary,#2d8653)')}
        ${card('สลิปทั้งหมด', s.slips, '#1976d2')}
        ${card('จับคู่สำเร็จ', s.matched, 'var(--brand-primary,#2d8653)')}
        ${card('สลิปไม่มีบิล', s.unmatchedSlips, '#f59e0b')}
        ${card('บิลจ่ายแล้วไม่มีสลิป', s.unmatchedPaidBills, '#f59e0b')}
        ${card('ยอดไม่ตรง', s.mismatches, 'var(--red,#c62828)')}
        ${card('คืนเงินแล้ว', s.refunded, '#7c3aed')}
      </div>
      <div style="font-size:.8rem;color:var(--text-muted,#6b7a8d);margin-bottom:.5rem;">
        ปี ${beYear} · จับคู่ ${baht(s.matchedAmount)} · สลิปค้างจับคู่ ${baht(s.unmatchedSlipAmount)}</div>
      ${section('🟠 สลิปที่ไม่มีบิลรองรับ (รับเงินแต่ไม่มีบิลที่ชำระ)', '#f59e0b',
        '<th style="padding:.4rem .6rem;">ห้อง</th><th style="padding:.4rem .6rem;">งวด</th><th style="padding:.4rem .6rem;text-align:right;">จำนวน</th><th style="padding:.4rem .6rem;">เลขใบเสร็จ</th><th style="padding:.4rem .6rem;">Transaction</th>',
        result.unmatchedSlips.map(slipRow).join(''), 'ไม่มี — สลิปทุกใบจับคู่บิลได้')}
      ${section('🟠 บิลที่ชำระแล้วแต่ไม่มีสลิป/ใบเสร็จ (เงินสด?)', '#f59e0b',
        '<th style="padding:.4rem .6rem;">บิล</th><th style="padding:.4rem .6rem;text-align:right;">ยอด</th><th style="padding:.4rem .6rem;">เลขใบเสร็จ</th>',
        result.unmatchedPaidBills.map(billPaidRow).join(''), 'ไม่มี — บิลที่ชำระทุกใบมีหลักฐาน')}
      ${section('🔴 ยอดสลิปไม่ตรงกับบิล (เกิน ฿1)', 'var(--red,#c62828)',
        '<th style="padding:.4rem .6rem;">บิล</th><th style="padding:.4rem .6rem;text-align:right;">ยอดบิล</th><th style="padding:.4rem .6rem;text-align:right;">ยอดสลิป</th><th style="padding:.4rem .6rem;text-align:right;">ส่วนต่าง</th>',
        result.mismatches.map(mismatchRow).join(''), 'ไม่มี — ยอดตรงทุกใบ')}
      ${section('🟣 บิลที่คืนเงินแล้ว (กลับรายการ — ตัดออกจากรายได้)', '#7c3aed',
        '<th style="padding:.4rem .6rem;">บิล</th><th style="padding:.4rem .6rem;text-align:right;">ยอดคืน</th><th style="padding:.4rem .6rem;">เลขใบเสร็จ</th><th style="padding:.4rem .6rem;">สลิปเดิม</th>',
        result.refundedBills.map(refundedRow).join(''), 'ไม่มี — ไม่มีบิลที่คืนเงิน')}`;
  }

  async function loadManualReceipts(db, fs) {
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'manualReceipts'), fs.limit(SLIP_LIMIT)));
      return snap.docs.map(d => { const x = d.data() || {}; return { billId: x.billId, building: x.building, room: String(x.roomId || x.room || ''), receiptNo: x.receiptNo }; });
    } catch (e) { console.warn('[reconcile] manualReceipts read failed (non-fatal):', e && e.message); return []; }
  }

  async function loadSlips(db, fs, beYear) {
    const q = fs.query(fs.collection(db, 'verifiedSlips'), fs.orderBy('verifiedAt', 'desc'), fs.limit(SLIP_LIMIT));
    const snap = await fs.getDocs(q);
    if (snap.size >= SLIP_LIMIT) console.warn(`[reconcile] verifiedSlips hit the ${SLIP_LIMIT} cap — older slips not loaded`);
    return snap.docs.map(d => {
      const x = d.data() || {}; const my = _slipMonthBE(x);
      return { transactionId: d.id, building: x.building || '', room: String(x.room || ''), amount: Number(x.amount) || 0, month: my.month, beYear: my.beYear, receiptNo: x.receiptNo || null };
    }).filter(s => s.beYear === beYear);
  }

  window.initReconcilePage = async function () {
    const root = document.getElementById(MOUNT_ID);
    if (!root) return;
    root.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted,#6b7a8d);">⏳ กำลังกระทบยอด…</div>';

    const yearEl = document.getElementById(YEAR_ID);
    if (yearEl && !yearEl.options.length) {
      const cur = new Date().getFullYear() + 543;
      for (let y = cur; y >= cur - 4; y--) { const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); yearEl.appendChild(o); }
    }
    const beYear = toBE(parseInt(yearEl && yearEl.value, 10) || (new Date().getFullYear() + 543));
    if (yearEl && !yearEl.dataset.wired) { yearEl.onchange = () => window.initReconcilePage(); yearEl.dataset.wired = '1'; }

    if (!window.firebase || !window.firebase.firestore || !window.firebase.firestoreFunctions || !window.BillStore) {
      renderError('Firebase/BillStore ยังไม่พร้อม'); return; // §7-N: surface, don't spin
    }
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      const ceYear = beYear - 543;
      const bills = (window.BillStore.listAllForYear(ceYear) || []).map(_normBill);
      const [slips, manualReceipts] = await Promise.all([loadSlips(db, fs, beYear), loadManualReceipts(db, fs)]);
      render(computeReconciliation({ bills, slips, manualReceipts }), beYear);
    } catch (e) {
      console.error('[reconcile] init failed:', e);
      renderError(e && (e.code || e.message) || 'unknown');
    }
  };
})();
