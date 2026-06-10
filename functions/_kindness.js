/**
 * Kindness Score — pure compute core (Meaning Layer #6, Roadmap §6).
 *
 * Server-computed generosity score (0–100) per tenant. Like Reputation (#0) this
 * file has NO I/O: the caller (the daily sweep `runTrustScoreSweep` in
 * computeTrustScoresScheduled, shared with the admin `recomputeTrustScores`
 * callable) gathers the raw `pointsLedger` events and passes them in, so the score
 * stays deterministic + unit-testable in isolation. Same stance as `_reputation.js`.
 *
 * WHAT it sums — the KIND-tagged, PEER-CONFIRMED points-ledger events:
 *   quest          (#1 Community Quests — claimQuest, verify-gated)
 *   food_share     (#4 Food sharing   — claimFood, awarded to the SHARER on a
 *                                        neighbour's claim → peer-confirmed)
 *   help_completed (#2 Helper-request — completeHelpRequest, requester-confirmed)
 * These are the three `pointsLedger` sources a tenant earns by GIVING. Trade
 * history (#5) is deliberately excluded: marketplace completion is self-attested
 * (the owner closes their own post, no peer confirm) so it would be a farm surface
 * — see meaning-layer-roadmap §6 / §5 owner decision. Add a 4th source here ONLY
 * if a peer-confirmed giving flow is ever built.
 *
 * Trust ≠ points (CLAUDE.md §6): Kindness derives from VERIFIABLE / peer-confirmed
 * giving events, never from the spendable `points` balance, never from self-claim
 * or purchase — or the retention moat collapses. Reading the kindness SUBSET of the
 * ledger (these 3 earn-sources) is the metric's definition, distinct from reading
 * the running `gamification.points` total (which Reputation must never touch).
 *
 * Score model: kindness = clamp01(totalKindnessPoints / KINDNESS_TARGET_POINTS) × 100
 *   — same cap shape as the tenure/complaint factors in `_reputation.js`. All-time
 *   cumulative (a community's accrued generosity is durable; a recency/decay weight
 *   is a possible v2 tuning). Below KINDNESS_MIN_EVENTS the score is `provisional`
 *   (seed state) — the roadmap §6 ACCRUAL gate, so an early 0/low never reads as a
 *   verdict before the data exists (mirrors Reputation's provisional path).
 *
 * All thresholds are named constants (KINDNESS_CONSTANTS) — review-tunable once
 * #1/#2/#4 accrue ~weeks of real data and the distribution is visible (the target
 * is an explicit guess until then, exactly like REPUTATION_CONSTANTS' caps).
 *
 * Run tests: node --test functions/__tests__/_kindness.test.js
 */

'use strict';

// The kind-tagged ledger sources Kindness sums. Keep in sync with the
// peer-confirmed earn-sources in functions/_pointsLedger.js VALID_SOURCES.
const KINDNESS_SOURCES = Object.freeze(['quest', 'food_share', 'help_completed']);

// Cumulative kindness points at which the score saturates to 100. A review-tunable
// guess: with the per-source anti-farm caps (help +20/cap 60·day, food +10/cap
// 50·day, quest small) 300 points represents sustained, substantial generosity
// over weeks. Re-tune once the real distribution is visible (roadmap §6 accrual).
const KINDNESS_TARGET_POINTS = 300;

// Below this many kindness events the score is provisional (seed state) — not
// enough signal to honestly distinguish "kind but new" from "not kind yet".
// Encodes the roadmap §6 ACCRUAL data-readiness gate.
const KINDNESS_MIN_EVENTS = 3;

const _clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Compute a tenant's kindness score from their already-gathered pointsLedger
 * events. Pure + deterministic.
 *
 * Only the three KINDNESS_SOURCES count, and only POSITIVE points (a kind act is
 * an earn event; a `redeem`/negative anomaly is ignored, never subtracts from
 * generosity). Events for other sources, malformed rows, or non-positive points
 * are skipped silently — an honest, defensive sum.
 *
 * @param {object}   input
 * @param {object[]} [input.events] pointsLedger rows: { source, points } (extra
 *                                  fields ignored). Caller pre-filters to one tenant.
 * @returns {{ kindness:number, provisional:boolean, factors:object }}
 */
function computeKindness({ events } = {}) {
  const list = Array.isArray(events) ? events : [];

  const acc = {
    quest:          { points: 0, count: 0 },
    food_share:     { points: 0, count: 0 },
    help_completed: { points: 0, count: 0 },
  };

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const bucket = acc[ev.source];
    if (!bucket) continue;                 // only the 3 kindness sources
    const pts = Number(ev.points);
    if (!Number.isFinite(pts) || pts <= 0) continue; // kind acts are positive earns
    bucket.points += pts;
    bucket.count += 1;
  }

  const totalPoints = acc.quest.points + acc.food_share.points + acc.help_completed.points;
  const totalEvents = acc.quest.count + acc.food_share.count + acc.help_completed.count;

  const provisional = totalEvents < KINDNESS_MIN_EVENTS;
  const ratio = KINDNESS_TARGET_POINTS > 0 ? totalPoints / KINDNESS_TARGET_POINTS : 0;
  const kindness = Math.max(0, Math.min(100, Math.round(_clamp01(ratio) * 100)));

  return {
    kindness,
    provisional,
    factors: {
      questPoints:         acc.quest.points,
      foodSharePoints:     acc.food_share.points,
      helpCompletedPoints: acc.help_completed.points,
      totalPoints,
      questCount:          acc.quest.count,
      foodShareCount:      acc.food_share.count,
      helpCompletedCount:  acc.help_completed.count,
      totalEvents,
    },
  };
}

// Tier bounds for the tenant-facing badge (Meaning Layer #6 v1.x). The tenant
// sees a positive-framed TIER LABEL only — never the 0–100 number — so the daily
// sweep maps (kindness, provisional) → this coarse enum via kindnessTier() and
// mirrors ONLY the enum onto the tenant-readable roster doc. Bounds align with
// the admin card's display ladder (shared/dashboard-kindness.js kindTier:
// 70/40/10) so admin + tenant read the same rungs.
const KIND_TIER_BOUND_RADIANT = 70;   // ≥70 → 'radiant'
const KIND_TIER_BOUND_WARM    = 40;   // ≥40 → 'warm'
const KIND_TIER_BOUND_KIND    = 10;   // ≥10 → 'kind'; below (or provisional) → 'seed'

/**
 * Map a kindness score → a coarse, positive-framed tier enum for the tenant badge.
 * Pure — mirrors `reputationTier()` in _reputation.js. `provisional` (below the
 * accrual gate) collapses into the gentle seed state, exactly like reputation's
 * provisional→seed. There is intentionally NO low/negative tier: kindness is
 * positive-only, never a "ต่ำ"/red verdict (roadmap §6).
 *
 * @param {number}  kindness    0–100
 * @param {boolean} provisional true below KINDNESS_MIN_EVENTS kind acts
 * @returns {'radiant'|'warm'|'kind'|'seed'}
 */
function kindnessTier(kindness, provisional) {
  if (provisional) return 'seed';
  const s = Number(kindness);
  if (!Number.isFinite(s)) return 'seed';
  if (s >= KIND_TIER_BOUND_RADIANT) return 'radiant';
  if (s >= KIND_TIER_BOUND_WARM) return 'warm';
  if (s >= KIND_TIER_BOUND_KIND) return 'kind';
  return 'seed';
}

module.exports = {
  computeKindness,
  kindnessTier,
  KINDNESS_SOURCES,
  KINDNESS_CONSTANTS: {
    KINDNESS_TARGET_POINTS,
    KINDNESS_MIN_EVENTS,
    KIND_TIER_BOUND_RADIANT,
    KIND_TIER_BOUND_WARM,
    KIND_TIER_BOUND_KIND,
  },
};
