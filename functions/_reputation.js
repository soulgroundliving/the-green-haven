/**
 * Reputation Score — pure compute core (Roadmap Phase 3.2a v1).
 *
 * Server-computed, tamper-proof reliability score (0–100) per tenant from three
 * back-historical signals. This file has NO I/O: the callers (the daily
 * scheduled CF `computeTrustScoresScheduled` + the admin `recomputeTrustScores`
 * callable) gather the raw bills / lease / complaints and pass them in, so the
 * investor-scrutinised number is deterministic and unit-testable in isolation.
 *
 * Trust ≠ points (CLAUDE.md §6 / phase-3.2 plan): this NEVER reads the spendable
 * `points` balance — only verifiable events (paid bills, lease tenure, complaint
 * record). Reputation must not be buyable or the moat collapses.
 *
 * Factor model (each → 0–100, then weighted):
 *   payment   60%  on-time-payment ratio  (paidAt ≤ dueDate cutoff)
 *   tenure    25%  min(tenureMonths / 24, 1)
 *   complaint 15%  min(complaintFreeMonths / 12, 1)
 * 0 ratable bills → paymentScore null + provisional:true + the surviving
 * weights renormalised so reputation still spans 0–100.
 *
 * All thresholds are named constants (REPUTATION_CONSTANTS) — tunable at review
 * once the real distribution is visible. `now` is injected, never Date.now(),
 * so the function stays pure + reproducible (a journal/resume requirement too).
 *
 * Run tests: node --test functions/__tests__/_reputation.test.js
 */

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
// Average Gregorian month (365.25 / 12 days). Tenure + complaint streaks are
// scored against whole-month caps, so an approximate-but-stable month length is
// intentional — calendar-exact month diffs add complexity with no scoring gain.
const MONTH_MS = 30.4375 * DAY_MS;

const WEIGHT_PAYMENT = 0.60;
const WEIGHT_TENURE = 0.25;
const WEIGHT_COMPLAINT = 0.15;

const TENURE_MAX_MONTHS = 24;          // 2yr tenure → full tenure score
const COMPLAINT_CLEAN_MAX_MONTHS = 12; // 1yr complaint-free → full complaint score
const PAYMENT_GRACE_DAYS = 0;          // days after dueDate still counted on-time

// Bill statuses that carry no punctuality signal → excluded from the ratio.
const NON_RATABLE_STATUSES = new Set(['refunded', 'void', 'voided', 'cancelled', 'canceled']);

// ─── Coercion helpers ─────────────────────────────────────────────────────────

/**
 * Coerce a timestamp-ish value to epoch ms. Accepts epoch number, ISO string,
 * Date, or a Firestore Timestamp ({seconds,nanoseconds} / {_seconds} / toMillis()).
 * Returns NaN when it can't be parsed — every caller guards with Number.isFinite,
 * so an unparseable date degrades gracefully (factor → 0) instead of throwing.
 */
function _ms(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? NaN : t; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch { return NaN; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (typeof v._seconds === 'number') return v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
  }
  return NaN;
}

const _round1 = (x) => Math.round(x * 10) / 10;
const _round4 = (x) => Math.round(x * 1e4) / 1e4;
const _clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Inclusive due-day cutoff in epoch ms. A bill due "2026-07-05" is on-time when
 * paid any time up to the end of 2026-07-05 (+ grace days). dueDate is the
 * date-only "YYYY-MM-DD" the billing pipeline writes (_billFlex computeBill),
 * parsed as UTC midnight; +1 day −1ms makes the whole due day count as on-time.
 */
function _dueCutoffMs(dueDate, graceDays) {
  const base = _ms(dueDate);
  if (!Number.isFinite(base)) return NaN;
  return base + DAY_MS - 1 + (graceDays || 0) * DAY_MS;
}

// ─── Payment punctuality ──────────────────────────────────────────────────────

/**
 * Classify each bill as on-time / late / not-ratable.
 *   on-time = paid AND paidAt ≤ due cutoff
 *   late    = (paid AND paidAt > due cutoff) OR (unpaid AND now > due cutoff)
 * Excluded (not ratable): refunded/void, paid-without-paidAt (can't judge
 * timeliness — honest metric), unpaid-not-yet-due, missing/invalid dueDate.
 *
 * @returns {{ onTimeBills:number, lateBills:number, onTimeRatio:(number|null) }}
 */
function _scorePayment(bills, nowMs) {
  let onTimeBills = 0;
  let lateBills = 0;
  const list = Array.isArray(bills) ? bills : [];
  for (const bill of list) {
    if (!bill || typeof bill !== 'object') continue;
    const status = String(bill.status || '').toLowerCase();
    if (NON_RATABLE_STATUSES.has(status)) continue;

    const cutoff = _dueCutoffMs(bill.dueDate, PAYMENT_GRACE_DAYS);
    if (!Number.isFinite(cutoff)) continue; // can't judge timeliness without a due date

    if (status === 'paid') {
      const paidAt = _ms(bill.paidAt);
      if (!Number.isFinite(paidAt)) continue; // paid but no timestamp → excluded (honest)
      if (paidAt <= cutoff) onTimeBills++; else lateBills++;
    } else {
      // unpaid / pending / overdue / missing — only a late signal once overdue
      if (Number.isFinite(nowMs) && nowMs > cutoff) lateBills++;
      // else not yet due → not counted
    }
  }
  const ratable = onTimeBills + lateBills;
  const onTimeRatio = ratable > 0 ? onTimeBills / ratable : null;
  return { onTimeBills, lateBills, onTimeRatio };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a tenant's reputation from already-gathered signals. Pure + deterministic.
 *
 * @param {object}   input
 * @param {object[]} [input.bills]      RTDB bill objects: { status, dueDate, paidAt }
 * @param {*}        [input.moveInDate] lease move-in (epoch ms | ISO | Date | Timestamp)
 * @param {object[]} [input.complaints] complaint objects: { createdAt }
 * @param {*}         input.now         "now" reference (injected for determinism)
 * @returns {{ reputation:number, factors:object, provisional:boolean }}
 */
function computeReputation({ bills, moveInDate, complaints, now } = {}) {
  const nowMs = _ms(now);

  // — payment punctuality —
  const { onTimeBills, lateBills, onTimeRatio } = _scorePayment(bills, nowMs);
  const rawPayment = onTimeRatio === null ? null : onTimeRatio * 100;

  // — lease tenure —
  const moveInMs = _ms(moveInDate);
  let tenureMonths = 0;
  if (Number.isFinite(moveInMs) && Number.isFinite(nowMs)) {
    tenureMonths = Math.max(0, (nowMs - moveInMs) / MONTH_MS);
  }
  const rawTenure = _clamp01(tenureMonths / TENURE_MAX_MONTHS) * 100;

  // — complaint-free streak —
  // streak start = most-recent complaint, else tenure start, else now (→ 0 streak)
  let lastComplaintMs = NaN;
  const complaintList = Array.isArray(complaints) ? complaints : [];
  for (const c of complaintList) {
    if (!c || typeof c !== 'object') continue;
    const t = _ms(c.createdAt);
    if (Number.isFinite(t) && (!Number.isFinite(lastComplaintMs) || t > lastComplaintMs)) {
      lastComplaintMs = t;
    }
  }
  const streakStart = Number.isFinite(lastComplaintMs)
    ? lastComplaintMs
    : (Number.isFinite(moveInMs) ? moveInMs : nowMs);
  let complaintFreeMonths = 0;
  if (Number.isFinite(streakStart) && Number.isFinite(nowMs)) {
    complaintFreeMonths = Math.max(0, (nowMs - streakStart) / MONTH_MS);
  }
  const rawComplaint = _clamp01(complaintFreeMonths / COMPLAINT_CLEAN_MAX_MONTHS) * 100;

  // — weighted reputation (renormalise the surviving weights when payment absent) —
  let provisional = false;
  let reputation;
  if (rawPayment === null) {
    provisional = true;
    const denom = WEIGHT_TENURE + WEIGHT_COMPLAINT;
    reputation = denom > 0
      ? (WEIGHT_TENURE * rawTenure + WEIGHT_COMPLAINT * rawComplaint) / denom
      : 0;
  } else {
    reputation = WEIGHT_PAYMENT * rawPayment + WEIGHT_TENURE * rawTenure + WEIGHT_COMPLAINT * rawComplaint;
  }
  reputation = Math.max(0, Math.min(100, Math.round(reputation)));

  return {
    reputation,
    provisional,
    factors: {
      paymentScore: rawPayment === null ? null : _round1(rawPayment),
      tenureScore: _round1(rawTenure),
      complaintScore: _round1(rawComplaint),
      onTimeRatio: onTimeRatio === null ? null : _round4(onTimeRatio),
      onTimeBills,
      lateBills,
      tenureMonths: _round1(tenureMonths),
      complaintFreeMonths: _round1(complaintFreeMonths),
    },
  };
}

module.exports = {
  computeReputation,
  REPUTATION_CONSTANTS: {
    WEIGHT_PAYMENT, WEIGHT_TENURE, WEIGHT_COMPLAINT,
    TENURE_MAX_MONTHS, COMPLAINT_CLEAN_MAX_MONTHS, PAYMENT_GRACE_DAYS,
    DAY_MS, MONTH_MS,
  },
};
