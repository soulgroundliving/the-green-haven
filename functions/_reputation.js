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
 * Factor model (each → 0–100, then weighted) — the v1 base:
 *   payment   60%  on-time-payment ratio  (paidAt ≤ dueDate cutoff)
 *   tenure    25%  min(tenureMonths / 24, 1)
 *   complaint 15%  min(complaintFreeMonths / 12, 1)
 * 0 ratable bills → paymentScore null + provisional:true + the surviving
 * weights renormalised so reputation still spans 0–100.
 *
 * v2 — engagement consistency (Roadmap Phase 3.2a v2, owner "additive bonus"
 * 2026-06-13): an ADDITIVE, positive-only bonus on top of the v1 base —
 *   reputation = min(100, round(v1) + engagementBonus)
 * where engagementBonus = round(engagementScore/100 · ENGAGEMENT_BONUS_MAX) and
 * engagementScore = activeWeeks / ENGAGEMENT_WINDOW_WEEKS · 100 (distinct weeks in
 * the last N with ≥1 engagement event). The bonus can only RAISE reputation, never
 * lower it — so the live investor metric + tenant tiers are safe, and a tenant with
 * no engagement history (or a young pointsLedger) simply gets bonus 0 = the v1
 * score (the additive model is self-safe for the data-readiness gate — no special
 * case needed). §6 (Trust ≠ points): engagement counts PRESENCE per week (cadence),
 * NEVER the points VALUE — it is not buyable/farmable (volume in one week earns the
 * same single active-week as one event).
 *
 * All thresholds are named constants (REPUTATION_CONSTANTS) — tunable at review
 * once the real distribution is visible. `now` is injected, never Date.now(),
 * so the function stays pure + reproducible (a journal/resume requirement too).
 *
 * Run tests: node --test functions/__tests__/_reputation.test.js
 */

'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// Average Gregorian month (365.25 / 12 days). Tenure + complaint streaks are
// scored against whole-month caps, so an approximate-but-stable month length is
// intentional — calendar-exact month diffs add complexity with no scoring gain.
const MONTH_MS = 30.4375 * DAY_MS;

const WEIGHT_PAYMENT = 0.60;
const WEIGHT_TENURE = 0.25;
const WEIGHT_COMPLAINT = 0.15;

// v2 engagement-consistency bonus (additive, positive-only). Rolling cadence
// window in weeks + the max bonus (points added at full consistency). The bonus is
// applied ON TOP of the v1 weighted base and clamped to 100 — review-tunable.
const ENGAGEMENT_WINDOW_WEEKS = 8;     // count distinct active weeks in the last 8
const ENGAGEMENT_BONUS_MAX = 10;       // full consistency → +10 reputation (never penalises)

// pointsLedger `source` values that signal a tenant SHOWED UP (a presence/cadence
// signal for the v2 engagement bonus). Tenant-ACTION sources only: excludes
// `payment` (Trust ≠ points), `redeem` (spending), and `complaint_free_month`
// (system-awarded monthly, not a tenant action). The sweep reads these with their
// `at` timestamps and passes them to computeReputation as `engagementEvents`.
const ENGAGEMENT_SOURCES = ['daily_login', 'wellness_quiz', 'contract_quiz', 'quest', 'help_completed', 'food_share'];

const TENURE_MAX_MONTHS = 24;          // 2yr tenure → full tenure score
const COMPLAINT_CLEAN_MAX_MONTHS = 12; // 1yr complaint-free → full complaint score
const PAYMENT_GRACE_DAYS = 0;          // days after dueDate still counted on-time

// Tenant-facing tier cut points (Phase 3.2a v1.x). Reuse the admin card's
// 80/60/40 boundaries (shared/dashboard-reputation.js repTier) so admin + tenant
// share ONE mental model. The CF writes only the resulting ENUM to the
// tenant-readable doc; the client maps enum→label/emoji, so the raw 0–100 number
// never reaches the tenant (decision 2026-06-07: tier-only).
const TIER_BOUND_HIGH = 80;            // ≥80 → 'high'
const TIER_BOUND_GOOD = 60;            // ≥60 → 'good'
const TIER_BOUND_FAIR = 40;            // ≥40 → 'fair'; <40 → 'low'

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

// ─── Engagement consistency (v2) ────────────────────────────────────────────────

/**
 * Compute the engagement-consistency bonus from a tenant's already-gathered
 * pointsLedger engagement events. Pure + deterministic.
 *
 * §6 (Trust ≠ points): this counts PRESENCE — the number of DISTINCT weeks (in the
 * last ENGAGEMENT_WINDOW_WEEKS) that have ≥1 engagement event — NEVER the points
 * value or event count. 100 events in one week and 1 event in one week both score
 * that single week, so the signal is consistency-of-showing-up, not volume — it is
 * not buyable/farmable. The caller filters `events` to engagement sources
 * (daily_login / quizzes / quest / help / food — tenant-action signals; excludes
 * payment, redeem, system-awarded complaint_free_month).
 *
 * @param {object}   input
 * @param {object[]} [input.events] engagement events: [{ at }] (epoch | ISO | Date | Timestamp)
 * @param {*}         input.now     "now" reference (injected for determinism)
 * @returns {{ engagementScore:number, activeWeeks:number, windowWeeks:number, bonus:number }}
 */
function computeEngagement({ events, now } = {}) {
  const nowMs = _ms(now);
  const windowWeeks = ENGAGEMENT_WINDOW_WEEKS;
  const list = Array.isArray(events) ? events : [];

  // Distinct week-buckets (0 = the current week, windowWeeks-1 = oldest counted)
  // relative to now. A bucket is "active" if any event fell in it. Future events
  // (at > now) and events older than the window are ignored.
  const activeWeekBuckets = new Set();
  if (Number.isFinite(nowMs)) {
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const t = _ms(e.at);
      if (!Number.isFinite(t)) continue;
      const ageMs = nowMs - t;
      if (ageMs < 0) continue;                         // future event — skip
      const wk = Math.floor(ageMs / WEEK_MS);
      if (wk >= 0 && wk < windowWeeks) activeWeekBuckets.add(wk);
    }
  }

  const activeWeeks = activeWeekBuckets.size;
  const engagementScore = windowWeeks > 0 ? _clamp01(activeWeeks / windowWeeks) * 100 : 0;
  const bonus = Math.round((engagementScore / 100) * ENGAGEMENT_BONUS_MAX);
  return { engagementScore: _round1(engagementScore), activeWeeks, windowWeeks, bonus };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a tenant's reputation from already-gathered signals. Pure + deterministic.
 *
 * @param {object}   input
 * @param {object[]} [input.bills]            RTDB bill objects: { status, dueDate, paidAt }
 * @param {*}        [input.moveInDate]       lease move-in (epoch ms | ISO | Date | Timestamp)
 * @param {object[]} [input.complaints]       complaint objects: { createdAt }
 * @param {object[]} [input.engagementEvents] v2 engagement events: [{ at }] (additive bonus; omit → bonus 0 = v1 score)
 * @param {*}         input.now               "now" reference (injected for determinism)
 * @returns {{ reputation:number, factors:object, provisional:boolean }}
 */
function computeReputation({ bills, moveInDate, complaints, engagementEvents, now } = {}) {
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
  const baseReputation = Math.max(0, Math.min(100, Math.round(reputation)));

  // — v2 engagement-consistency bonus (additive, positive-only; clamps to 100) —
  // Applied AFTER the v1 base so it can only RAISE the score. No engagement events
  // → bonus 0 → reputation === the v1 base (data-readiness-safe by construction).
  const eng = computeEngagement({ events: engagementEvents, now });
  reputation = Math.max(0, Math.min(100, baseReputation + eng.bonus));

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
      // v2 engagement (additive bonus). baseReputation = the pre-bonus v1 score.
      baseReputation,
      engagementScore: eng.engagementScore,
      engagementActiveWeeks: eng.activeWeeks,
      engagementWindowWeeks: eng.windowWeeks,
      engagementBonus: eng.bonus,
    },
  };
}

/**
 * Map a reputation result to a coarse TIER enum for the tenant-facing badge
 * (Phase 3.2a v1.x). The tenant sees ONLY this enum (the client maps it to a
 * positive label/emoji) — never the raw 0–100 number or the factor breakdown
 * (decision 2026-06-07: tier-only, avoids credit-score anxiety + support load).
 * Computed server-side and mirrored onto the tenant-readable roster doc so the
 * tier stays tamper-proof (§6) — same rationale as the score itself.
 *
 * Enum aligns with the admin card keys (dashboard-reputation.js repTier:
 * high/good/fair/low) + a distinct 'provisional' for the 0-ratable-bills case.
 * The client collapses provisional + low into one gentle "กำลังสร้างคะแนน" face,
 * but the enum keeps them distinct for analytics.
 *
 * @param {number}  reputation    0–100 score from computeReputation
 * @param {boolean} [provisional] true when the score is provisional (0 ratable bills)
 * @returns {('provisional'|'high'|'good'|'fair'|'low')} tier enum
 */
function reputationTier(reputation, provisional) {
  if (provisional) return 'provisional';
  const s = Number(reputation);
  if (!Number.isFinite(s)) return 'low';
  if (s >= TIER_BOUND_HIGH) return 'high';
  if (s >= TIER_BOUND_GOOD) return 'good';
  if (s >= TIER_BOUND_FAIR) return 'fair';
  return 'low';
}

module.exports = {
  computeReputation,
  computeEngagement,
  reputationTier,
  ENGAGEMENT_SOURCES,
  REPUTATION_CONSTANTS: {
    WEIGHT_PAYMENT, WEIGHT_TENURE, WEIGHT_COMPLAINT,
    TENURE_MAX_MONTHS, COMPLAINT_CLEAN_MAX_MONTHS, PAYMENT_GRACE_DAYS,
    TIER_BOUND_HIGH, TIER_BOUND_GOOD, TIER_BOUND_FAIR,
    ENGAGEMENT_WINDOW_WEEKS, ENGAGEMENT_BONUS_MAX,
    DAY_MS, WEEK_MS, MONTH_MS,
  },
};
