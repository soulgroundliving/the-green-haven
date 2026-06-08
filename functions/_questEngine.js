/**
 * _questEngine — pure logic for the Community Quests engine (Meaning Layer #1).
 *
 * NO I/O. The CFs (claimQuest / reviewQuestClaim) fetch the quest doc, the
 * tenant's claim record for the current period, and any auto-signal data, then
 * delegate every decision to these pure functions so the rules are unit-testable
 * and identical across the claim + review paths.
 *
 * Quest definition shape (the catalog doc, admin-authored — quests/{questId}):
 * {
 *   active:        bool,
 *   cadence:       'daily' | 'weekly' | 'once',   // how often a tenant can earn it
 *   verifyMode:    'auto'  | 'self'   | 'admin',  // how a tap-to-claim resolves
 *   rewardPoints:  number (>0),
 *   autoSignal?:   'checkin_today' | 'login_streak',  // v1 auto signals
 *   autoThreshold?: number,                       // signal-specific threshold
 *   startDate?:    ISO string | null,             // availability window (optional)
 *   endDate?:      ISO string | null,
 *   selfDailyCap?: number,                        // override the per-tenant self cap
 * }
 *
 * Claim record (questClaims/{questId}__{tenantId}__{periodKey}) status enum:
 *   'self' | 'auto' | 'approved'  → counted as CLAIMED (✓)
 *   'pending'                     → awaiting admin review (⏳)
 *   'rejected'                    → admin declined; tenant may re-claim
 *
 * Per §7-NN the CFs are callables, never Firestore triggers. Per §6 the awarded
 * balance is server-authoritative — the engine never trusts a client-sent value.
 */

'use strict';

const DEFAULT_SELF_DAILY_CAP = 10;
const DEFAULT_LOGIN_STREAK_THRESHOLD = 7;

const VALID_CADENCE = new Set(['daily', 'weekly', 'once']);
const VALID_VERIFY_MODE = new Set(['auto', 'self', 'admin']);
const VALID_AUTO_SIGNAL = new Set(['checkin_today', 'login_streak']);

// Claim statuses that mean "this period is already earned" (no re-claim).
const CLAIMED_STATUSES = new Set(['self', 'auto', 'approved']);

/** 'YYYY-MM-DD' calendar date in Asia/Bangkok (UTC+7, no DST). */
function bkkDateString(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/**
 * Week bucket key = the Monday (ISO week start) of the BKK calendar week, as a
 * 'YYYY-MM-DD' string. Deterministic and timezone-stable: we resolve the BKK
 * calendar date first, then do day-of-week math in tz-agnostic UTC space.
 */
function bkkWeekKey(d) {
  const [y, m, day] = bkkDateString(d).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const dow = dt.getUTCDay();                 // 0=Sun … 6=Sat
  const shiftToMonday = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + shiftToMonday);
  return dt.toISOString().slice(0, 10);
}

/**
 * The discriminator that scopes one earn-period for a quest. Doubles as the
 * questClaims doc-id suffix AND the pointsLedger discriminator suffix, so a
 * retried tap in the same period collapses onto the same idempotent record.
 *   daily  → BKK date string (one per day)
 *   weekly → BKK week-start date (one per week)
 *   once   → 'once' (a single lifetime earn)
 */
function periodKeyFor(quest, now) {
  const cadence = quest && quest.cadence;
  if (cadence === 'weekly') return bkkWeekKey(now);
  if (cadence === 'once') return 'once';
  return bkkDateString(now); // 'daily' default
}

/** Quest is inside its optional [startDate, endDate] availability window. */
function isWithinWindow(quest, now) {
  const t = now.getTime();
  if (quest && quest.startDate) {
    const s = Date.parse(quest.startDate);
    if (Number.isFinite(s) && t < s) return false;
  }
  if (quest && quest.endDate) {
    const e = Date.parse(quest.endDate);
    if (Number.isFinite(e) && t > e) return false;
  }
  return true;
}

/**
 * Resolve the tenant-facing state of a quest for the current period.
 * @param {object} quest        the catalog doc
 * @param {object|null} periodClaim  the questClaims doc for THIS period, or null
 * @param {Date} now
 * @returns {'inactive'|'locked'|'available'|'pending'|'claimed'|'rejected'}
 */
function resolveState(quest, periodClaim, now) {
  if (!quest || quest.active === false) return 'inactive';
  if (!isWithinWindow(quest, now)) return 'locked';
  if (periodClaim && periodClaim.status) {
    if (periodClaim.status === 'pending') return 'pending';
    if (periodClaim.status === 'rejected') return 'rejected';
    if (CLAIMED_STATUSES.has(periodClaim.status)) return 'claimed';
  }
  return 'available';
}

/** A tenant may submit a claim only from these states (rejected = retry). */
function isClaimableState(state) {
  return state === 'available' || state === 'rejected';
}

/**
 * Decide whether an `auto`-mode quest's signal is satisfied. The CF gathers
 * signalData (from the tenant gamification doc and/or meter_data) and passes it
 * in; the engine only compares — so an auto quest can never be client-spoofed.
 * @returns {{ satisfied: boolean, reason: string }}
 */
function evaluateAutoSignal(quest, signalData) {
  const sig = quest && quest.autoSignal;
  const sd = signalData || {};

  if (sig === 'checkin_today') {
    const ok = sd.checkedInToday === true;
    return { satisfied: ok, reason: ok ? 'checked-in-today' : 'not-checked-in-today' };
  }

  if (sig === 'login_streak') {
    const need = Number.isFinite(Number(quest.autoThreshold))
      ? Number(quest.autoThreshold) : DEFAULT_LOGIN_STREAK_THRESHOLD;
    const have = Number(sd.dailyStreak) || 0;
    return { satisfied: have >= need, reason: `streak ${have} vs need ${need}` };
  }

  return { satisfied: false, reason: 'unknown-signal' };
}

/**
 * Per-tenant daily cap for `self` (honor-system) claims. The tenant doc carries
 * a running same-day total (reset when the stamped day rolls over) so this is a
 * free, query-less check inside the claim transaction.
 * @returns {{ allowed: boolean, prior: number, newTotal: number, cap: number }}
 */
function selfCapCheck({ questDay, questSelfToday, today, reward, cap }) {
  const effectiveCap = Number.isFinite(Number(cap)) ? Number(cap) : DEFAULT_SELF_DAILY_CAP;
  const prior = questDay === today ? (Number(questSelfToday) || 0) : 0;
  const newTotal = prior + (Number(reward) || 0);
  return { allowed: newTotal <= effectiveCap, prior, newTotal, cap: effectiveCap };
}

/** Lightweight catalog-doc sanity for the claim path (admin writes are direct). */
function isValidCadence(c) { return VALID_CADENCE.has(c); }
function isValidVerifyMode(v) { return VALID_VERIFY_MODE.has(v); }
function isValidAutoSignal(s) { return VALID_AUTO_SIGNAL.has(s); }

module.exports = {
  DEFAULT_SELF_DAILY_CAP,
  DEFAULT_LOGIN_STREAK_THRESHOLD,
  VALID_CADENCE,
  VALID_VERIFY_MODE,
  VALID_AUTO_SIGNAL,
  bkkDateString,
  bkkWeekKey,
  periodKeyFor,
  isWithinWindow,
  resolveState,
  isClaimableState,
  evaluateAutoSignal,
  selfCapCheck,
  isValidCadence,
  isValidVerifyMode,
  isValidAutoSignal,
};
