/**
 * Verified Helper — pure compute core (Meaning Layer #7, Roadmap §7, Trust 3.2b/c).
 *
 * Server-computed PEER-CONFIRMED helper credential (0–100) per tenant. Like
 * Reputation (#0) and Kindness (#6) this file has NO I/O: the caller (the daily
 * sweep `runTrustScoreSweep` in computeTrustScoresScheduled, shared with the admin
 * `recomputeTrustScores` callable) gathers the raw `helpRequests` job docs and
 * passes them in, so the score stays deterministic + unit-testable. Same stance
 * as `_reputation.js` / `_kindness.js`.
 *
 * WHAT it scores — the tenant's HELPER job history: `helpRequests` docs where
 * `status === 'done'` and the tenant was the HELPER (requester-confirmed
 * completion — the requester, not the helper, marks done in completeHelpRequest,
 * so the credit is honest; §6 "never self-claim"). This is the JOB-HISTORY
 * signal, deliberately DISTINCT from #6 Kindness (which sums the `pointsLedger`
 * POINTS those same completions write). Roadmap §2: "the help_completed ledger
 * events feed #6 Kindness; the helpRequests job-history + ratings feed #7
 * Verified Helper." So this is NOT points-derived and is NOT subject to the
 * kindness daily points cap — it counts confirmed JOBS, not money.
 *
 * Trust ≠ points (CLAUDE.md §6): never reads the spendable `points` balance.
 *
 * Score model (owner D2, 2026-06-12) — volume + DISTINCT requesters (the
 * anti-farm core: you can't grind a "verified" credential with one buddy), plus
 * a SMALL appreciation-tag bonus (rewards quality without dominating):
 *   base     = clamp01( completedCount/TARGET_JOBS·W_VOLUME
 *                       + distinctRequesters/TARGET_DISTINCT·W_DISTINCT )   // W 0.6/0.4
 *   tagBonus = clamp01( avgTagsPerJob / TAGS_PER_JOB_TARGET ) · TAG_BONUS_WEIGHT
 *   score    = round( clamp01(base + tagBonus) · 100 )
 * Below VH_MIN_JOBS confirmed jobs the score is `provisional` (newcomer/seed
 * state) — the roadmap §7 accrual gate, mirroring Kindness's KINDNESS_MIN_EVENTS.
 *
 * All thresholds are named constants (VH_CONSTANTS) — review-tunable once #2
 * accrues weeks of real data (the targets are explicit guesses until then,
 * exactly like REPUTATION_CONSTANTS / KINDNESS_CONSTANTS).
 *
 * Run tests: node --test functions/__tests__/_verifiedHelper.test.js
 */

'use strict';

// Confirmed-done jobs at which the volume factor saturates. Review-tunable guess.
const TARGET_JOBS = 8;
// Distinct requesters helped at which the breadth factor saturates. The anti-farm
// signal — a wide helper credential needs many neighbours, not repeat favours.
const TARGET_DISTINCT = 4;
// Volume / breadth weights (sum to 1.0 → base reaches 1.0 on a broad, active helper).
const W_VOLUME = 0.6;
const W_DISTINCT = 0.4;
// Appreciation-tag bonus: avg tags/job at which the bonus saturates, and its cap.
// A SMALL additive (≤ +TAG_BONUS_WEIGHT of the 0–1 scale) so quality nudges the
// score without overriding the volume+breadth core.
const TAGS_PER_JOB_TARGET = 2;
const TAG_BONUS_WEIGHT = 0.10;
// Below this many confirmed jobs the credential is provisional (seed) — not
// enough signal to honestly distinguish "trusted helper" from "new helper".
const VH_MIN_JOBS = 3;

// Tier bounds for the tenant-facing badge — align with the kindness/reputation
// ladders (70/40/10) so all three Trust badges read the same rungs.
const VH_TIER_BOUND_TRUSTED = 70;   // ≥70 → 'trusted'
const VH_TIER_BOUND_SEASONED = 40;  // ≥40 → 'seasoned'
const VH_TIER_BOUND_HELPER = 10;    // ≥10 → 'helper'; below (or provisional) → 'newcomer'

const _clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Compute a tenant's Verified-Helper score from their already-gathered
 * helpRequests job docs (the caller filters to status==='done' + this helper).
 * Pure + deterministic.
 *
 * Each job contributes to: volume (count), breadth (distinct requester), and the
 * small tag bonus (its appreciationTags). Malformed rows are skipped silently.
 * Distinct requester key = requesterTenantId (fallback requesterRoom) — help is
 * building-scoped so a room is unique-enough within the helper's building.
 *
 * @param {object}   input
 * @param {object[]} [input.jobs] helpRequests rows already filtered to this
 *   helper's done jobs: { requesterTenantId?, requesterRoom?, appreciationTags?[], completedAt? }
 * @returns {{ score:number, tier:string, provisional:boolean, factors:object }}
 */
function computeVerifiedHelper({ jobs } = {}) {
  const list = Array.isArray(jobs) ? jobs : [];

  const requesters = new Set();
  const tagCounts = {};
  let completedCount = 0;
  let totalTags = 0;
  let lastCompletedAt = null;

  for (const job of list) {
    if (!job || typeof job !== 'object') continue;
    completedCount += 1;
    const reqKey = job.requesterTenantId || job.requesterRoom;
    if (reqKey) requesters.add(String(reqKey));
    const tags = Array.isArray(job.appreciationTags) ? job.appreciationTags : [];
    for (const t of tags) {
      if (!t) continue;
      tagCounts[t] = (tagCounts[t] || 0) + 1;
      totalTags += 1;
    }
    if (job.completedAt && (!lastCompletedAt || String(job.completedAt) > String(lastCompletedAt))) {
      lastCompletedAt = job.completedAt;
    }
  }

  const distinctRequesters = requesters.size;
  const provisional = completedCount < VH_MIN_JOBS;

  const base = _clamp01(
    (TARGET_JOBS > 0 ? completedCount / TARGET_JOBS : 0) * W_VOLUME +
    (TARGET_DISTINCT > 0 ? distinctRequesters / TARGET_DISTINCT : 0) * W_DISTINCT
  );
  const avgTagsPerJob = completedCount > 0 ? totalTags / completedCount : 0;
  const tagBonus = _clamp01(TAGS_PER_JOB_TARGET > 0 ? avgTagsPerJob / TAGS_PER_JOB_TARGET : 0) * TAG_BONUS_WEIGHT;
  const score = Math.max(0, Math.min(100, Math.round(_clamp01(base + tagBonus) * 100)));

  return {
    score,
    tier: verifiedHelperTier(score, provisional),
    provisional,
    factors: {
      completedCount,
      distinctRequesters,
      totalTags,
      tagCounts,
      lastCompletedAt,
    },
  };
}

/**
 * Map a Verified-Helper score → a coarse, positive-framed tier enum for the
 * tenant badge. Pure — mirrors `kindnessTier()` / `reputationTier()`.
 * `provisional` (below the accrual gate) collapses into the gentle newcomer
 * state. Intentionally NO low/negative tier — a helper credential is
 * positive-only, never a "ต่ำ"/red verdict (roadmap §7, mirror §6).
 *
 * @param {number}  score       0–100
 * @param {boolean} provisional true below VH_MIN_JOBS confirmed jobs
 * @returns {'trusted'|'seasoned'|'helper'|'newcomer'}
 */
function verifiedHelperTier(score, provisional) {
  if (provisional) return 'newcomer';
  const s = Number(score);
  if (!Number.isFinite(s)) return 'newcomer';
  if (s >= VH_TIER_BOUND_TRUSTED) return 'trusted';
  if (s >= VH_TIER_BOUND_SEASONED) return 'seasoned';
  if (s >= VH_TIER_BOUND_HELPER) return 'helper';
  return 'newcomer';
}

module.exports = {
  computeVerifiedHelper,
  verifiedHelperTier,
  VH_CONSTANTS: {
    TARGET_JOBS,
    TARGET_DISTINCT,
    W_VOLUME,
    W_DISTINCT,
    TAGS_PER_JOB_TARGET,
    TAG_BONUS_WEIGHT,
    VH_MIN_JOBS,
    VH_TIER_BOUND_TRUSTED,
    VH_TIER_BOUND_SEASONED,
    VH_TIER_BOUND_HELPER,
  },
};
