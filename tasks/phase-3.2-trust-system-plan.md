# Phase 3.2 — Trust System · Design Plan

**Created:** 2026-06-06 · **Status:** 🔴 design-only (build gated on data accrual + new capture flows)
**Source:** `proptech_unicorn_living_os_blueprint.pdf` — Phase 2 "The Meaning Layer → Trust & Economy"
**Foundation verified (grep, 2026-06-06):** `pointsLedger` append-only (`functions/_pointsLedger.js`, rule `firestore.rules:754`) · `points` running total on `people/tenants` (`redeemReward.js`, `claimDailyLoginPoints.js`) · `complaintAndGamification.js` · KYC ID since #236. **No** `reputationScore`/`kindnessScore`/`verifiedHelper`/`trustScore` exists yet → Trust is **greenfield**.

---

## 1. Why this matters (business rationale, from the blueprint)
The Trust System is not a vanity feature — it is the **moat**:
- **Core Metric 3 — Switching Cost (Emotional Lock-in):** tenants don't move out because they'd forfeit their accumulated Reputation/Kindness score + rank. This is the single metric the blueprint names for pushing valuation toward unicorn.
- **Revenue Tier 2 (FinTech):** Micro-Insurance / micro-loan commissions offered to **high-Trust** tenants (bank partnership).
- **Revenue Tier 3 (Community Economy):** **Verified Helper** marketplace — fee on helper jobs; trust is the gate that makes the helper market safe.

So Trust feeds retention AND two revenue lines. It must be **tamper-proof** (server-computed) or all three collapse.

## 2. The four blueprint components
| Component | Blueprint term | One-line |
|-----------|----------------|----------|
| **Reputation** | คะแนนความน่าเชื่อถือ | Reliability: pays on time, long tenure, complaint-free, consistent engagement |
| **Kindness** | คะแนนความมีน้ำใจ | Generosity: completed help quests, gave in marketplace, shared food, silent-helper |
| **Verified Helper** | ผู้ช่วยชุมชนที่ยืนยันตัวตน | KYC-verified + track record of completed+rated help → safe to hire |
| **Resident Rank** | แรงก์/ชนชั้นตามการมีส่วนร่วม | Composite tier derived from the three above + tenure |

## 3. What's already live (build ON these — don't duplicate)
| Signal | Source | Feeds |
|--------|--------|-------|
| Engagement events over time | `pointsLedger/{idempotencyKey}` (since #227) | Reputation (consistency), Kindness (which events) |
| Spendable points balance | `people/tenants.points` (10pts=1฿) | **Separate** from trust — see §6 anti-gaming |
| Payment punctuality | RTDB bills (`paidAt` vs `dueDate`) + reconcile (#244) + aging (#246) | Reputation (biggest weight) |
| Lease tenure | `leases/{b}/list/{leaseId}` (start → now) | Reputation + Rank |
| Complaint record | `complaintAndGamification.js` (complaint-free award) | Reputation (negative signal) |
| KYC identity | ID upload since #236 | Verified Helper gate |
| Marketplace + chat | `lifecycle_marketplace*` | Kindness (giveaways), Verified Helper (job history) |

## 4. Sequenced build plan (each = its own PR, callable CF not trigger §7-NN)

### 3.2a — Reputation Score · 🟡 mostly buildable, one dimension data-gated
**Inputs (all server-verifiable):** on-time-payment ratio · tenure months · complaint-free streak · account standing · engagement consistency (pointsLedger event cadence).
- v1 (buildable **soon**): payment + tenure + complaint-free — these have **back-history today** (bills/leases/complaints aren't purged). Ship a `computeReputation` callable + daily recompute → store `trustScores/{tenantId}.reputation` (0–100) + factor breakdown.
- v2: add the engagement-consistency dimension once `pointsLedger` has **~1–3 mo** of accrual (the only data-gated part).
- **Compute = CF, never client** (mirror `redeemReward` never trusting client balance). Read path: admin dashboard card + tenant_app badge (claim-gated, `_onLiffClaimsReady` §7-A/U).

### 3.2b — Kindness Score + Verified Helper · 🔴 needs NEW capture first
These can't be derived from existing data — the helping ACTIONS aren't recorded yet. **Prerequisite features:**
1. **Community Quests** write path — quests ("ช่วยยกของ", "ปิดไฟ/แอร์ครบ 7 วัน", "รดน้ำต้นไม้ส่วนกลาง", "Silent Helper") → completion logged to `pointsLedger` with a `kind:'quest'` tag so Kindness can sum them. (Energy-saver quests can reuse the `meter_data` signal the #276 energy card already reads.)
2. **Helper-request lifecycle** — request → accept → complete → **peer rating**. `helpRequests/{id}` (status enum, §7-T writer/reader) + a callable per transition (§7-NN). Completed+rated jobs feed both Kindness (helper side) and Verified-Helper eligibility.
- **Verified Helper** = KYC-verified (#236) AND ≥ N completed jobs AND avg rating ≥ threshold → boolean + tier on `trustScores/{tenantId}.verifiedHelper`. Gate marketplace helper-hire on it (Tier 3 revenue).

### 3.2c — Resident Rank · 🟢 derived, build last
Composite: weighted(reputation, kindness, tenure) → tier ladder (e.g. ผู้มาเยือน → สมาชิก → คนสนิท → แกนนำชุมชน → ตำนานของตึก). Pure function over 3.2a+b outputs; recomputed in the same daily CF. Drives the Emotional-Lock-in display (tenant sees "you'd lose แกนนำ rank if you leave").

## 5. Storage + read shape (proposed)
- `trustScores/{tenantId}` — server-write-only doc: `{ reputation, kindness, rank, rankLabel, verifiedHelper, factors:{...}, computedAt }`. Rule: `read: if isAdmin() || own-claim; write: if false` (CF via Admin SDK). Mirror `actionAudit`/`pointsLedger` immutability stance.
- Recompute: one **daily scheduled CF** (`computeTrustScoresScheduled`) reading the signals in §3 → batch-writes `trustScores/*`. Idempotent; cheap at this scale. (Stagger outside the 02:00–04:10 backup/cleanup window per `lifecycle_scheduled_jobs` editing rules.)
- Tenant read: claim-gated badge in tenant_app (§7-A `_onLiffClaimsReady`, §7-U claim guard). Admin read: Insights card.

## 6. Guardrails (apply to every sub-PR)
- **Trust ≠ points.** Points are spendable currency; Trust is **non-spendable reputation**. Never let trust be bought with points or money → that destroys the moat. Both may READ `pointsLedger`, but trust derives only from *verifiable* events (paid bills, completed+rated help), never self-claimed.
- **Server-computed only** (§ like `redeemReward`): client never writes its own score.
- **Anti-gaming:** Kindness from peer-confirmed/audited actions only; cap per-day quest credit; rate-limit help-request creation.
- **PDPA:** trust scores are derived personal data → consent (existing #236/#238 gate), include in DSR export, retention policy (mirror `lifecycle_pdpa_checklist`).
- **§7-NN** callable not Firestore trigger (SE3) · **§7-Z** any claim mint pairs `setCustomUserClaims` · **§7-T** grep writer+reader for every new field · **§7-J** composite index READY before any `where+orderBy` query.

## 7. Data-readiness gate (when to start)
| Sub-phase | Blocker | Earliest |
|-----------|---------|----------|
| 3.2a v1 (pay+tenure+complaint) | none — history exists | **now-ish** (next core sprint) |
| 3.2a v2 (engagement dim) | ~1–3 mo `pointsLedger` accrual | ~2026-08+ |
| 3.2b (Kindness + Verified Helper) | build Community Quests + Helper lifecycle first | after 3.2a |
| 3.2c (Resident Rank) | needs 3.2a + 3.2b live | after 3.2b |

## 8. Open questions for the owner (decide before 3.2a build)
1. **Tenant-visible or admin-only first?** A visible reputation badge is the lock-in driver but invites "why is mine low?" support load. Suggest admin-only v1, tenant-visible once the formula is trusted.
2. **Rank ladder naming + thresholds** — needs a brand pass (muji tone; the two-name rule doesn't apply but tone does).
3. **Reputation factor weights** — payment punctuality should dominate; confirm the weighting with the accountant lens (this is the number an investor will scrutinize).
4. **Verified-Helper liability** — does the platform vouch for helpers? Affects KYC depth + ToS (legal, ties to #236 consent text).

---
*Linked from `core-readiness-roadmap.md` Phase 3.2. This is a design sketch — no code until §7 gates clear. When 3.2a v1 starts, convert to a `tasks/todo.md` plan-first per CLAUDE.md §1 (touches rules + new CF + new collection → above threshold).*
