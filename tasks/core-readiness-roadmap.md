# Core Readiness Roadmap — "เปิดตรวจจริง" + 3 Future Features

**Created:** 2026-06-02 · **RECONCILED:** 2026-06-06 (against `git log` + live code — every ✅ has a PR cite; this doc had drifted, listing shipped phases as "awaiting approval").
**Basis:** evidence-grounded gap analysis (Phase 0 → 3). Goal = make the project presentable to **accountant / สรรพากร / investor**, then build the blueprint's 3 future features on a solid base.

> ⚠️ **Doc-drift note (§7-K / feature_state_canonical):** the original plan below was written 2026-06-02 with everything un-started. Phases 0, 1.1–1.4, and most of Phase 2 were executed *afterward* (PRs #227–#275) but this file was never updated, so a later session nearly re-built the already-shipped Phase 1.4 consent gate. This reconciliation fixes that. **When you ship a roadmap item, flip its checkbox + add the PR here in the same session.**

---

## ✅ RECONCILED STATUS (2026-06-06)

| Phase | Item | Status | Evidence |
|-------|------|--------|----------|
| **0** | pointsLedger append-only event log | ✅ SHIPPED | #227 · `firestore.rules:754` · in-tx writes in points CFs |
| **1.1** | Server-side immutable audit trail | ✅ SHIPPED | #229 (callable+`actionAudit`) · #230 (panel) · #231/#232 (write points) · [[lifecycle_audit_trail]] |
| **1.2** | Gapless running document number | ✅ SHIPPED | #233/#234 (RCP-) · #235 (INV-) · [[lifecycle_invoice_numbering]] |
| **1.3** | Void / cancel issued bill with trail | ✅ SHIPPED | #235 (`voidInvoice`) · [[lifecycle_invoice_numbering]] |
| **1.4** | ToS + Privacy consent + DSR | ✅ SHIPPED | #236 (links+ToS+KYC ID) · #237 (DSR) · #238 (tenant gate) · #239 (booking gate) · owner: legal text + live-verify only |
| **2** | Refund flow (paid-bill reversal) | ✅ SHIPPED | #245 · [[lifecycle_refund_flow]] |
| **2** | Per-tenant arrears / aging | ✅ SHIPPED | #246 · [[lifecycle_arrears_aging]] |
| **2** | Reconcile report (slip↔bill) | ✅ SHIPPED | #244 (+#258 deposit-settled bucket) |
| **2** | otherIncome revenue category | ✅ SHIPPED | #243 |
| **2** | pet-fee revenue category | ✅ SHIPPED (inert) | #247/#248 — wired but $0 until Nest goes live (~Aug); §7-T |
| **2** | marketplace fee category | ✅ N/A | marketplace = free classifieds, no fee into bills/revenue |
| **2** | Thai-font PDF | ✅ N/A | monthly PDF is html2canvas-raster→`addImage` (no jsPDF `.text()`), Excel = ExcelJS → no tofu |
| **2** | Remove dead 15%-corporate path | ✅ SHIPPED | #240 + #275 (→ ภ.ง.ด.90 personal model) |
| **2** | **fine / lateFee revenue category split** | ✅ SHIPPED #277 | merged + CF deployed (`aggregateMonthlyRevenue`); `lateFeeIncome` backfills next scheduled run / HTTP re-aggregate |
| **3.1** | Move-out propensity / tenure card | ✅ SHIPPED | #268 |
| **3.1** | Community engagement trend card | ✅ SHIPPED | #269 (first `pointsLedger` time-series reader) |
| **3.1** | Energy-pattern card | ✅ SHIPPED #276 (merged + live) | `dashboard-behavioral-energy.js` (11 tests) · operations tab · meter_data trend |
| **3.1** | Pet-patterns card | ✅ SHIPPED #276 (merged + live) | `dashboard-behavioral-pets.js` (11 tests) · community tab · vaccine compliance |
| **3.1** | Peak-repair-season card | ✅ SHIPPED #278 (merged + live) | `dashboard-behavioral-repair.js` (17 tests, harness-verified) reads `maintenanceArchive` (#270): monthly repair count + peak Thai season + category breakdown. Graceful "accruing" empty state until archive accrues (~weeks from 2026-06-06). ALL 5 Phase-3.1 cards now shipped |
| **3.2** | Trust System | 🔴 design-ready, build-gated | **Design plan: [phase-3.2-trust-system-plan.md](phase-3.2-trust-system-plan.md)** (2026-06-06). 3.2a Reputation v1 buildable soon (pay+tenure+complaint history exists); Kindness/Verified-Helper need new capture flows + ~1–3 mo `pointsLedger` |
| **3.3** | Autonomous Operations | 🟠 furthest out | needs Phase 1+2 + 3.1 data solid |

**Net:** core-readiness ("เปิดตรวจจริง") is essentially COMPLETE. Phase 3.1 energy + pet cards now built + tested (#276). Remaining agent-buildable feature work = none until #270 unblocks peak-repair, or Phase 3.2 Trust once `pointsLedger` accrues data. Everything else is owner-gated (CF deploys, live-verify, legal text) or future (3.2/3.3).

### Owner-gated carry-overs (not agent-doable)
- ~~**#270** maintenance-archive CF~~ — ✅ MERGED + CF deployed 2026-06-06; [[lifecycle_scheduled_jobs]] bumped 11→12. Peak-repair card now unblocked (awaiting ~weeks of `maintenanceArchive` accrual).
- **#263 / SlipOK** — verifySlip/verifyBookingSlip §7-YY FormData fix, blocked on owner renewing the EXPIRED SlipOK package.
- **1.4 owner actions** — fill `terms.html` `[รอข้อความจริง]` legal text (lawyer), mirror disclosures into `system/policies` via dashboard, live-verify consent + DSR on real LINE.

---

## ⏳ REMAINING — full detail (act on these)

### Phase 2 — fine / lateFee revenue category split  · ✅ SHIPPED #277 (merged, CF deployed 2026-06-06)
**Why:** `lateFee` IS already in each bill's `total` (`dashboard-bill.js`), but `aggregateMonthlyRevenue.js` folds it into the `other` bucket → P&L can't show penalty income as its own line, which an accountant expects separated. Splitting it is the last Phase-2 accountant-FAQ gap.

- [ ] **Grep the fold site first** — confirm exactly where `lateFee`/`fine` collapse into `other` in `aggregateMonthlyRevenue.js` (+ any `taxSummary` consumer).
- [ ] **Add `fineIncome` / `lateFeeIncome`** as their own category in the aggregation + `taxSummary/{BE}` shape (mirror the `petFeeIncome` precedent #247).
- [ ] **Reader check (§7-T):** grep every reader of `taxSummary` revenue categories (tax-filing P&L, dashboard insights) — extend them to show the new line; canonical-first fallback so old summaries don't break.
- [ ] **Unit test** the aggregation: a bill with `lateFee` produces a `fineIncome` row, not `other`.
- [ ] **§7-NN:** touch only the existing scheduled/callable aggregation CF — no new Firestore trigger.
- [ ] **Deploy (OWNER):** `firebase deploy --only functions:<aggregation CF>` (branch-check prod first). User paused here — confirm before deploy.

### Phase 3.1 — Behavioral Intelligence (remaining cards)  · client-on-read, no CF/schema/rules
Mirror the as-built pattern of #268/#269: new `shared/dashboard-behavioral-*.js` module + unit tests + node smoke + static-harness screenshot; admin live-verify deferred to owner (§7-I).
- [x] **Energy-pattern card** ✅ 2026-06-06 (#276, merged + live) — `dashboard-behavioral-energy.js`: monthly avg/room electric+water trend + trajectory + peak-season month (differentiates from MeterSpike point-anomaly). 11 unit tests.
- [x] **Pet-patterns card** ✅ 2026-06-06 (#276, merged + live) — `dashboard-behavioral-pets.js`: type breakdown + vaccine compliance + approval pipeline + room penetration (Firestore collectionGroup; supersedes the localStorage `updatePetAnalyticsWidget`). 11 unit tests.
- [x] **Peak-repair-season card** — ✅ SHIPPED #278 (merged + live 2026-06-06). `dashboard-behavioral-repair.js` (operations tab `#dashRepairSeason`): monthly repair-count time-series + peak Thai season (hot/rainy/cool) + category breakdown, from `maintenanceArchive` (#270). 17 unit tests, static-harness render-verified. Graceful "accruing" empty state until ~weeks of `archiveMaintenanceScheduled` history (begins 2026-06-06). Owner: live-verify once data exists. → folded into [[lifecycle_insights_analytics]] (5 cards).

### Phase 3.2 — Trust System  · 🔴 design-ready, build-gated → **[phase-3.2-trust-system-plan.md](phase-3.2-trust-system-plan.md)**
reputation / kindness / verified-helper / resident rank — the **Emotional Lock-in moat** (blueprint Core Metric 3) + feeds revenue Tier 2 (Micro-Insurance) & Tier 3 (Verified-Helper). Full sequenced design in the plan doc. Summary: **3.2a Reputation v1** (payment+tenure+complaint — history exists, buildable in next core sprint, server-computed CF) → **3.2b Kindness + Verified-Helper** (needs NEW capture: Community Quests + helper-request lifecycle, + ~1–3 mo `pointsLedger`) → **3.2c Resident Rank** (derived). Trust ≠ spendable points (anti-gaming). Owner decisions pending: tenant-visible vs admin-first, rank ladder naming, reputation weights, helper liability.

### Phase 3.3 — Autonomous Operations  · 🟠 furthest out
auto-late-fee / auto-tax / auto-contract layer on the audit-grade document-of-record (Phase 1.1/1.2/1.3, all shipped). AI maintenance triage / support / analytics layer on Phase 3.1 data.

---

## Cross-cutting guardrails (apply to every item)
- Each item = its own PR, behind `validate.yml`; add tests for the surface BEFORE/with the change.
- Backend = `onCall` not Firestore trigger (§7-NN, SE3). `createCustomToken`→`setCustomUserClaims` twin (§7-Z).
- New field/UI → grep writer+reader first (§7-T). Composite index READY before query (§7-J).
- Tenant LIFF reads → `_onLiffClaimsReady` + claim guard (§7-A/U); live-verify on real LINE, not admin preview.
- Production data actions → preview, never auto-`.click()` (§7-I).
- **Sequencing principle:** gate-first, one surface per PR. No broad mechanical sweeps (breadth-trap: §7-SS/RR/QQ/TT were all self-inflicted by sweeps).

## Out of scope (named, not dropped)
- Multi-building scale-out / new tenant surfaces beyond the above.
- Migrating off vanilla JS (no framework — intentional).

---

## ARCHIVE — original plan rationale (2026-06-02, pre-execution)

The detailed "Why + sub-steps" for the now-shipped phases is preserved in git history and in the per-phase lifecycle docs (cited in the status table above). Key irreversible-first decision that drove sequencing: **Phase 0 `pointsLedger` was done first** because engagement history is permanently lost each day it isn't logged — shipped #227, now feeding the #269 engagement card and the future Trust System.

## Review
- **2026-06-06:** reconciled doc to ground truth (this rewrite). Confirmed Phase 0/1.1–1.4 + Phase 2 (refund/aging/reconcile/otherIncome/petfee/dead-VAT) + 3.1 A+B all SHIPPED. Sole remaining core item = fine/lateFee split (owner-gated, paused). Next agent-buildable = 3.1 energy + pet cards.
- **2026-06-06 (same session):** built + tested Phase 3.1 ⚡ energy-pattern + 🐾 pet-patterns cards (`dashboard-behavioral-energy.js` / `dashboard-behavioral-pets.js`, 22 unit tests, full shared suite 437/437, harness render-verified). #276 (open, awaiting owner sign-off + live-verify). Folded into [[lifecycle_insights_analytics]] (4 behavioral cards). Remaining 3.1 card (peak-repair) still blocked on #270.
- **2026-06-06 (merge session):** merged #276 (energy + pet cards + localStorage pet-widget removal → Vercel live) + #277 (fine/lateFee split → CF deployed). verify:memory green; lifecycle_insights (4 cards) + lifecycle_tax_filing (lateFeeIncome) reconciled. Core-readiness roadmap COMPLETE; only Phase 3.2/3.3 + owner live-verify remain.
- **2026-06-06 (#270 merge):** merged #270 (`archiveMaintenanceScheduled` — daily 03:50 archive of closed maintenance tickets → `maintenanceArchive` before the 04:10 RTDB purge) → CF auto-deployed to prod. [[lifecycle_scheduled_jobs]] bumped 11→12 + timeline row + §5 "4 schedules"; verify:memory GREEN. Peak-repair-season card now unblocked but gated on ~weeks of archive accrual (the only remaining 3.1 card). Net: all 5 Phase-3.1 cards now built or unblocked; remaining work = Phase 3.2/3.3 (data-blocked) + owner live-verifies + #263 (SlipOK pkg renewal).
- **2026-06-06 (#278 merge + 3.2 plan):** built + **merged + deployed #278** peak-repair-season card (`dashboard-behavioral-repair.js`, 17 tests, static-harness render-verified) → **ALL 5 Phase-3.1 behavioral cards now shipped.** Folded into [[lifecycle_insights_analytics]] (5 cards + grep verifiers). Wrote the **Phase 3.2 Trust System design plan** ([phase-3.2-trust-system-plan.md](phase-3.2-trust-system-plan.md)) — sequenced 3.2a Reputation-v1 (buildable next sprint) → 3.2b Kindness+Verified-Helper (needs new capture) → 3.2c Resident Rank. Roadmap status: **Phase 0/1/2/3.1 ALL COMPLETE**; only 3.2 (design-ready, data-gated) + 3.3 (future) + owner live-verifies/#263 remain.
