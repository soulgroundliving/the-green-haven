/**
 * Resident Rank — pure compute core (Meaning Layer #8, Roadmap §8, Trust 3.2c).
 *
 * Server-computed COMPOSITE community standing per active tenant: a single
 * growth-ladder tier derived from the three Trust dimensions already on the
 * write-locked `trustScores/{tenantId}` doc — Reputation (#0), Kindness (#6) and
 * Verified Helper (#7). Like the dimensions it composes, this file has NO I/O:
 * the caller (the daily sweep `runTrustScoreSweep` in computeTrustScoresScheduled,
 * shared with the admin `recomputeTrustScores` callable) computes the three
 * sub-scores first and passes them in, so the rank stays deterministic +
 * unit-testable. Same stance as `_reputation.js` / `_kindness.js` /
 * `_verifiedHelper.js`.
 *
 * WHY it's its OWN dimension and not just one of the three: this is the blueprint
 * Core Metric 3 "Emotional Lock-in" display — the single rung a tenant identifies
 * with ("you'd lose แกนนำ rank if you leave"). It is DERIVED, capturing nothing
 * new: a weighted blend of the three, mapped to a 5-rung growth ladder. Roadmap
 * §8: "pure derived weighted(reputation, kindness, verifiedHelper) → rank".
 *
 * Trust ≠ points (CLAUDE.md §6): the inputs are themselves server-computed from
 * verifiable events; this never reads the spendable `points` balance.
 *
 * Weighting (owner decision 2026-06-12 — "สมดุล" / balanced):
 *   reputation 40% · kindness 30% · verifiedHelper 30%.
 * Tenure is NOT a separate term — it already lives INSIDE reputation (25% of it,
 * REPUTATION_CONSTANTS.WEIGHT_TENURE), so adding it again would double-count. The
 * 40% reputation weight therefore already carries the tenure/lock-in signal.
 *
 * The 40% reputation cap is also what makes the TOP rungs require real community
 * participation: reputation alone maxes the composite at 0.40·100 = 40 (the
 * `rooted` floor), so `canopy`/`taproot` are unreachable without kindness +
 * verifiedHelper — exactly the participation lock-in the rank is meant to reward.
 *
 * The 5 rungs (owner ladder choice — the growth metaphor, on-brand with the 🌱
 * Trust badges + Nature Haven):
 *   seed → sprout → rooted → canopy → taproot
 *   (เมล็ดใหม่ → ต้นกล้า → ไม้ประจำถิ่น → ร่มเงาของตึก → รากแก้วชุมชน)
 * Positive-only, like every Trust badge: the bottom rung is a gentle "new seed"
 * growth state, never a "ต่ำ/low" verdict.
 *
 * All thresholds are named constants (RANK_CONSTANTS) — review-tunable once #6/#7
 * accrue weeks of real data (explicit guesses until then, exactly like
 * REPUTATION_CONSTANTS / KINDNESS_CONSTANTS / VH_CONSTANTS).
 *
 * Run tests: node --test functions/__tests__/_residentRank.test.js
 */

'use strict';

// Composite weights (owner "สมดุล" 2026-06-12). Sum to 1.0 → a tenant maxed on
// all three dims reaches 100. Tenure rides inside reputation (no separate term).
const W_REPUTATION = 0.40;
const W_KINDNESS = 0.30;
const W_VERIFIED_HELPER = 0.30;

// 5-rung growth ladder bounds over the 0–100 composite. Spaced below a linear
// 20/40/60/80 because early community data (kindness/helper) is thin — the lower
// rungs must feel reachable while the top two still demand genuine participation
// (reputation alone caps the composite at 40 = the `rooted` floor, so canopy 55 /
// taproot 75 are impossible without kindness + verifiedHelper). Review-tunable.
const RANK_BOUND_TAPROOT = 75; // ≥75 → taproot  (รากแก้วชุมชน — community legend)
const RANK_BOUND_CANOPY = 55;  // ≥55 → canopy   (ร่มเงาของตึก — community pillar)
const RANK_BOUND_ROOTED = 35;  // ≥35 → rooted   (ไม้ประจำถิ่น — settled resident)
const RANK_BOUND_SPROUT = 15;  // ≥15 → sprout   (ต้นกล้า — growing); below → seed (เมล็ดใหม่)

const _num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

/**
 * Compute a tenant's Resident Rank from their three Trust sub-scores (each 0–100,
 * already computed by the caller via _reputation / _kindness / _verifiedHelper).
 * Pure + deterministic.
 *
 * `provisional` is true ONLY when none of the three dimensions has real signal yet
 * (a brand-new resident — all three sub-scores provisional). It is informational
 * for the admin card; it does NOT force the tier, because the weighted score
 * already reflects thin data (kindness/helper near 0 → low composite → seed). A
 * reliable long-tenure tenant with a real reputation is NOT provisional even with
 * zero community activity — their reputation contribution is honest.
 *
 * @param {object}  input
 * @param {number}  [input.reputation]               0–100 (#0)
 * @param {number}  [input.kindness]                 0–100 (#6)
 * @param {number}  [input.verifiedHelper]           0–100 (#7)
 * @param {boolean} [input.reputationProvisional]
 * @param {boolean} [input.kindnessProvisional]
 * @param {boolean} [input.verifiedHelperProvisional]
 * @returns {{ score:number, tier:string, provisional:boolean, factors:object }}
 */
function computeResidentRank({
  reputation, kindness, verifiedHelper,
  reputationProvisional, kindnessProvisional, verifiedHelperProvisional,
} = {}) {
  const rep = _num(reputation);
  const kind = _num(kindness);
  const vh = _num(verifiedHelper);

  const score = Math.max(0, Math.min(100, Math.round(
    W_REPUTATION * rep + W_KINDNESS * kind + W_VERIFIED_HELPER * vh
  )));

  const provisional =
    !!reputationProvisional && !!kindnessProvisional && !!verifiedHelperProvisional;

  return {
    score,
    tier: residentRankTier(score),
    provisional,
    factors: {
      reputation: rep,
      kindness: kind,
      verifiedHelper: vh,
      weights: {
        reputation: W_REPUTATION,
        kindness: W_KINDNESS,
        verifiedHelper: W_VERIFIED_HELPER,
      },
    },
  };
}

/**
 * Map a 0–100 composite → the 5-rung growth-ladder enum for the tenant badge +
 * admin card. Pure — mirrors `reputationTier()` / `kindnessTier()` /
 * `verifiedHelperTier()`. POSITIVE-ONLY: the bottom rung `seed` is the gentle
 * newcomer growth state, never a "ต่ำ/low" verdict. A non-finite score → `seed`.
 *
 * @param {number} score 0–100
 * @returns {'taproot'|'canopy'|'rooted'|'sprout'|'seed'}
 */
function residentRankTier(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'seed';
  if (s >= RANK_BOUND_TAPROOT) return 'taproot';
  if (s >= RANK_BOUND_CANOPY) return 'canopy';
  if (s >= RANK_BOUND_ROOTED) return 'rooted';
  if (s >= RANK_BOUND_SPROUT) return 'sprout';
  return 'seed';
}

module.exports = {
  computeResidentRank,
  residentRankTier,
  RANK_CONSTANTS: {
    W_REPUTATION,
    W_KINDNESS,
    W_VERIFIED_HELPER,
    RANK_BOUND_TAPROOT,
    RANK_BOUND_CANOPY,
    RANK_BOUND_ROOTED,
    RANK_BOUND_SPROUT,
  },
};
