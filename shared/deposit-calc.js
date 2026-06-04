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

  const api = { depositPaid, depositDue, isFullyPaid, deductionDesc, deductionsTotal };
  if (typeof window !== 'undefined') window.DepositCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
