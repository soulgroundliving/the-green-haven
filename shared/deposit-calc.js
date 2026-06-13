/**
 * deposit-calc.js — pure helpers for deposit installment math (Slice B).
 *
 * Owner spec (tasks/deposit-pet-damage-rules.md §1.1): the room deposit may be
 * paid in installments; the unpaid portion is an outstanding balance (ยอดค้าง)
 * until complete.
 *
 * `deposits/{b}_{r}` gains an optional `paidSoFar` field. §7-L back-compat:
 * legacy docs (and the common fully-paid case) have NO `paidSoFar` → treated as
 * FULLY PAID (paidSoFar = amount), so nothing changes for existing deposits.
 *
 * Dual export: window.DepositCalc (browser) + module.exports (Node test).
 */
(function () {
  function _amount(dep) { return Number(dep && dep.amount) || 0; }

  // How much of the deposit the tenant has paid. Absent paidSoFar = fully paid.
  function depositPaid(dep) {
    if (dep && dep.paidSoFar != null) return Math.max(0, Number(dep.paidSoFar) || 0);
    return _amount(dep);
  }

  // Outstanding deposit balance still owed (never negative; overpay clamps to 0).
  function depositDue(dep) {
    return Math.max(0, _amount(dep) - depositPaid(dep));
  }

  function isFullyPaid(dep) {
    return depositDue(dep) <= 0;
  }

  // ── Move-out deductions (Slice C) ───────────────────────────────────────
  // The settlement deduction shape migrated {reason, amount} → {desc, amount,
  // photo}. §7-L back-compat: a legacy `reason` reads as `desc`; a missing
  // `photo` is simply absent (optional damage evidence on rooms-building).
  function deductionDesc(d) {
    if (!d) return '';
    const v = (d.desc != null && d.desc !== '') ? d.desc : d.reason;
    return v == null ? '' : String(v);
  }

  // Sum the deduction amounts (defensive: non-array → 0, garbage amount → 0).
  function deductionsTotal(list) {
    return (Array.isArray(list) ? list : [])
      .reduce((s, d) => s + (Number(d && d.amount) || 0), 0);
  }

  // Net refund at move-out (spec §1.3): held − final/unpaid bill − damage deductions.
  // Can go negative ⇒ tenant still owes (caller surfaces it as "ค้างเพิ่ม").
  function netRefund(held, finalBillTotal, deductions) {
    return (Number(held) || 0) - (Number(finalBillTotal) || 0) - deductionsTotal(deductions);
  }

  // ── Refund destination — PromptPay (Slice C follow-up) ──────────────────
  // The deposit refund is sent to the tenant's PromptPay. Validate the target so
  // a mashed number can't pass as a "transferred-to" record (the free-text bank
  // field stays as an optional fallback for plain bank transfers).
  //   mobile     = 10 digits starting 0  (06/08/09…)
  //   nationalId = 13 digits
  function validPromptPay(s) {
    const d = String(s == null ? '' : s).replace(/[^0-9]/g, '');
    if (d.length === 10 && d[0] === '0') return { valid: true, type: 'mobile', value: d };
    if (d.length === 13) return { valid: true, type: 'nationalId', value: d };
    return { valid: false, type: null, value: d };
  }

  // EMVCo PromptPay QR payload (with CRC16-CCITT). Handles BOTH proxy types —
  // mobile (tag 01, 0066 + 9 digits) and national ID (tag 02, 13 digits). The
  // existing window.buildPromptPayPayload (dashboard-bill.js) is mobile-only, so
  // this self-contained builder is needed for the national-ID case; kept pure +
  // tested here rather than reaching into the DOM module.
  function promptPayPayload(id, amount) {
    const v = validPromptPay(id);
    if (!v.valid) return null;
    const proxyTag = v.type === 'nationalId' ? '02' : '01';
    const val = v.type === 'nationalId' ? v.value : '0066' + v.value.slice(1);
    const aid = '0016A000000677010111' + proxyTag + String(val.length).padStart(2, '0') + val;
    const a = (Number(amount) || 0).toFixed(2);
    const p = '000201' + '010212' +
      '29' + String(aid.length).padStart(2, '0') + aid +
      '5303764' + '54' + String(a.length).padStart(2, '0') + a +
      '5802TH' + '6304';
    let c = 0xFFFF;
    for (let i = 0; i < p.length; i++) {
      c ^= p.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1);
    }
    return p + (c & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  }

  // ── Pre-move-in lifecycle (Phase 1, 2026-06-13) ─────────────────────────
  // The deposit can be taken BEFORE move-in (จอง ฿500 → ส่วนที่เหลือ) and is not
  // guaranteed to convert. `depositPhase` is the doc's lifecycle state; legacy
  // docs (no `status`) read as 'holding' — the only pre-2026-06-13 non-returned
  // state, so existing data keeps working untouched (§7-L).
  function depositPhase(dep) {
    const s = dep && dep.status;
    if (s === 'reserved' || s === 'returned' || s === 'forfeited') return s;
    return 'holding';
  }

  // Record one deposit payment chunk (จอง / ส่วนที่เหลือ; method 'slip' OR 'cash').
  // Returns a NEW { paidSoFar, payments } patch — never mutates `dep` (immutable).
  // paidSoFar accrues and CLAMPS to the deposit amount. In the recording flow an
  // absent paidSoFar means "nothing recorded yet" = 0 — DISTINCT from depositPaid()
  // where absent = fully paid (§7-L legacy read). `at` is caller-supplied (pure —
  // no Date.now here, keeps the helper deterministic + unit-testable).
  function recordDepositPayment(dep, payment) {
    const amount = Math.max(0, Number(payment && payment.amount) || 0);
    const prevPaid = Math.max(0, Number(dep && dep.paidSoFar) || 0);
    const cap = _amount(dep);
    const paidSoFar = cap > 0 ? Math.min(cap, prevPaid + amount) : prevPaid + amount;
    const prior = (dep && Array.isArray(dep.payments)) ? dep.payments : [];
    const entry = {
      label: (payment && payment.label) || 'มัดจำ',
      amount,
      method: (payment && payment.method) === 'cash' ? 'cash' : 'slip',
    };
    if (payment && payment.slipPath) entry.slipPath = String(payment.slipPath);
    if (payment && payment.lumpRef) entry.lumpRef = String(payment.lumpRef);
    if (payment && payment.txid) entry.txid = String(payment.txid); // SlipOK transactionId (verified slip)
    if (payment && payment.at != null) entry.at = payment.at;
    return { paidSoFar, payments: prior.concat([entry]) };
  }

  // Validate ONE lump CASH payment split across several rooms' deposits.
  // allocations = [{ building, roomId, amount }]. valid ⇔ every row is a real room
  // with a positive amount AND Σ amounts === total (±฿1, mirrors the slip tolerance).
  function splitLumpCash(total, allocations) {
    const t = Number(total) || 0;
    const list = Array.isArray(allocations) ? allocations : [];
    const allocated = list.reduce((s, a) => s + Math.max(0, Number(a && a.amount) || 0), 0);
    const everyValid = list.length > 0 && list.every(
      (a) => a && a.building && a.roomId && (Number(a.amount) || 0) > 0
    );
    const remainder = Math.round((t - allocated) * 100) / 100;
    return { valid: everyValid && Math.abs(remainder) <= 1, total: t, allocated, remainder };
  }

  const api = { depositPaid, depositDue, isFullyPaid, deductionDesc, deductionsTotal, netRefund, validPromptPay, promptPayPayload, depositPhase, recordDepositPayment, splitLumpCash };
  if (typeof window !== 'undefined') window.DepositCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
