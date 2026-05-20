# Refactor shared/dashboard-extra.js — Phase 2: extract 4 admin modules

**Status:** plan-first, awaiting approval. Do NOT edit code until ✅ from user.
**Triggered by:** Plan #6 Phase 2 from `next_session_handoff_2026_05_20_lease_pairing_fix.md`. Phase 1 shipped `5e0c65d` (4 stores → `dashboard-domain-stores.js`, 5,484 LOC residual). Phase 2 continues the same goal: drive `dashboard-extra.js` below ~2,000 LOC by extracting 4 focused modules.

## Why now

`dashboard-extra.js` is **5,484 LOC** (65% of soft 8,500). Phase 2 extracts ~3,550 LOC across 4 files, leaving ~1,930 LOC residual (23% of soft). Below the WARN tier with permanent headroom for future feature growth.

The handoff also flags 2 prereqs that block clean extraction and 1 cosmetic fix.

## Prereq survey — what blocks each extraction

| Risk | Severity | Current state | Phase 2 sprint |
|---|---|---|---|
| `let realtimeListeners = {}` (L759 in extra.js) is module-scoped — extracted setup helpers (`setupLeaseNotifsListener`, `setupMeterDataListener`, …) read/write it. Moving any one to a sibling file = §7-CC cross-script `let` trap → silent `undefined`. | **HIGH** — blocks #3 (tenant-lease) and #6 (admin-ops cleanup) | `let` at top-level | **S1 window-ize** |
| `_leaseRequestsUnsub`, `_docsUnsub`, `_petsUnsub`, `_rewardsAdminUnsub`, `_gamificationConfigUnsub` — 5 module-level `let`s that `cleanupAdminListeners()` (stays in extra.js) reads. Once any of them moves to a new module, the reader is cross-script → §7-CC silent `undefined` → cleanup misses listeners → §7-V leak. | **HIGH** — blocks #3/#4/#5 | `let` at top-level (except `_RequestsStoreComplaintsUnsub` which is already `window.X` from Phase 1) | **S1 window-ize** (bundled with realtimeListeners) |
| `currentEditBuilding` / `currentEditTenantId` cross-script in admin flows | Already DONE 2026-05-20 (§7-CC PDPA fix, commit `0fd7ce2`) — verified by `grep -c "^\s*let\s+currentEdit" shared/dashboard-tenant-modal.js` = 0 | — | (no work) |
| `window.updateRoomStatuses` assigned twice (L572 direct alias + L946 wrapper that captures+overwrites). Functionally correct (wrapper wins), but L572 is dead. Each extraction commit may need to touch this section, so cleaning it up first removes confusion. | **LOW** (cosmetic) | Two assigns, one is dead | **S6 cosmetic** |

After S1, every later sprint is a pure structural move with no cross-script visibility risk.

## What Phase 2 extracts (exact line ranges in current file)

After Phase 1, `dashboard-extra.js` line numbers may differ from the handoff estimates. Ranges below were re-verified 2026-05-21 against the post-Phase-1 file.

### `shared/dashboard-tenant-lease.js` (~1,365 LOC est.)

| Source range | Section | LOC |
|---|---|---|
| L624-757 | Lease Expiry Alerts (server-emitted `leaseNotifications/`) | 133 |
| L1294-1483 | LEASE REQUESTS QUEUE (`leaseRequests/{auto}` admin tab) | 189 |
| L1660-1890 | TENANT MASTER PAGE | 230 |
| L1891-2315 | LEASE AGREEMENTS PAGE | 424 |
| L2316-2543 | Document Hub — Phase 2 SSoT | 227 |
| L3263-3419 | PET REGISTRATION APPROVALS | 156 |

Plus carries the moved-along `let _leaseRequestsUnsub`, `let _petsUnsub` declarations (window-ized in S1).

### `shared/dashboard-bills.js` (~1,239 LOC est.)

| Source range | Section | LOC |
|---|---|---|
| L2544-2643 | UPLOAD REAL BILLS PAGE (admin) | 99 |
| L2644-3040 | BILL GENERATION SYSTEM | 396 |
| L3867-4611 | BILLING IMPORT FUNCTIONS (Excel→Firestore pipeline) | 744 |

No moved-along `let`s. Self-contained.

### `shared/dashboard-config.js` (~1,079 LOC est.)

| Source range | Section | LOC |
|---|---|---|
| L1016-1208 | OWNER INFO PAGE | 192 |
| L1209-1293 | BUILDING INTERNET CONFIG (per-building ISP/status/speed) | 84 |
| L1484-1659 | APARTMENT LOGO | 175 |
| L3076-3262 | COMMUNITY DOCUMENTS MANAGEMENT | 186 |
| L3420-3523 | GAMIFICATION PAGE | 103 |
| L3524-3607 | GAMIFICATION LIVE TOGGLE | 83 |
| L3608-3704 | POLICY ADMIN CRUD (`system/policies`) | 96 |
| L3705-3864 | REWARDS ADMIN CRUD (`rewards/` collection) | 159 |

Plus carries `let _docsUnsub`, `let _rewardsAdminUnsub`, `let _gamificationConfigUnsub` (window-ized in S1).

### `shared/dashboard-admin-ops.js` (~145 LOC est.)

| Source range | Section | LOC |
|---|---|---|
| L3041-3075 | DEBUG CONSOLE HELPERS | 34 |
| L5385-5417 (approx) | `grantAdminRole` / `cleanupAnonUsers` / `runAwardComplaintFreeMonthDryRun` admin utilities | ~85 |

**NOT extracted** (deliberate):
- `cleanupAdminListeners` + `beforeunload` (L5465+, ~30 LOC) — STAYS in `dashboard-extra.js`. It reads `_insightsUnsubs` (which stays with Insights) and references the 5 unsub vars (which move out but are window-ized in S1). Keeping it in extra.js preserves the single-source-of-truth for "what listeners does the admin dashboard own".

### What stays in `dashboard-extra.js` (~1,930 LOC residual)

- L1-572: Password modal + room/payment status helpers + `updateRoomStatuses` body (cross-script callers in `dashboard-tenant-modal.js`/`dashboard-pdpa-erasure.js`)
- L573-623: `calculateOccupancy` + `updateOccupancyDashboard` (called by lease-listener fix from prior commit, by S2 lease-alerts module, by L946 wrapper)
- L758-944: REAL-TIME FIREBASE LISTENERS section (`realtimeListeners` global lives here as window-attached) + FIREBASE CLOUD DATA INITIALIZATION
- L945-955: `window.updateRoomStatuses` wrapper (simplified by S6)
- L4612-5417: OWNER INSIGHTS PAGE (805 LOC — explicitly out of Phase 2 scope per handoff)
- L5465-5483: `cleanupAdminListeners` + beforeunload registration

## Architecture — destination after Phase 2

```
shared/
├── dashboard-extra.js          (~1,930 LOC, was 5,484) — UI helpers, listeners global, insights, cleanup
├── dashboard-domain-stores.js  (~1,118 LOC, Phase 1)   — ServiceProviders/CommunityEvents/Requests/Historical
├── dashboard-tenant-lease.js   (~1,365 LOC, NEW)       — Tenant + lease + document hub + pet approvals
├── dashboard-bills.js          (~1,239 LOC, NEW)       — Bill upload + generation + Excel import
├── dashboard-config.js         (~1,079 LOC, NEW)       — Owner/internet/logo/community/policies/rewards/gamification
└── dashboard-admin-ops.js      (~145 LOC, NEW)         — Debug helpers + admin utility CFs
```

All new files < 2k LOC, the original Plan #6 destination. `dashboard-extra.js` ends at 23% of soft limit.

## Script load order in `dashboard.html`

```html
<!-- Phase 2 load order (domain-stores already in place from Phase 1) -->
<script src="./shared/dashboard-domain-stores.js"></script>  <!-- Phase 1 -->
<script src="./shared/dashboard-tenant-lease.js"></script>   <!-- NEW S2 -->
<script src="./shared/dashboard-bills.js"></script>          <!-- NEW S3 -->
<script src="./shared/dashboard-config.js"></script>         <!-- NEW S4 -->
<script src="./shared/dashboard-admin-ops.js"></script>      <!-- NEW S5 -->
<script src="./shared/dashboard-extra.js"></script>          <!-- AFTER all extracted modules -->
<script src="./shared/dashboard-insights.js"></script>
```

**Why dashboard-extra.js loads LAST among them:** `cleanupAdminListeners` (stays in extra.js) reads window-ized vars like `window._leaseRequestsUnsub` set by the extracted modules. If extra.js loaded first, those would be `undefined` at parse time — fine because the reads happen INSIDE `cleanupAdminListeners()` body (called on beforeunload), not at parse time. So order is fine either way, but loading extras LAST is more intuitive (depends-on order).

## Files Touched (per sprint)

| Sprint | Files | Touch type |
|---|---|---|
| S1 (window-ize) | `shared/dashboard-extra.js` | 6 `let X` → `window.X` conversions + ~12 cleanup reads → window-ized |
| S2 (tenant-lease) | NEW `shared/dashboard-tenant-lease.js`, `shared/dashboard-extra.js`, `dashboard.html`, `tools/file-size-limits.json`, `memory/lifecycle_*.md` (lease/tenant docs) | ~5 files |
| S3 (bills) | NEW `shared/dashboard-bills.js`, `shared/dashboard-extra.js`, `dashboard.html`, `tools/file-size-limits.json`, `memory/billing_monthly_flow.md` | ~5 files |
| S4 (config) | NEW `shared/dashboard-config.js`, `shared/dashboard-extra.js`, `dashboard.html`, `tools/file-size-limits.json`, `memory/owner_config.md`, `memory/gamification_ssot.md` | ~6 files |
| S5 (admin-ops) | NEW `shared/dashboard-admin-ops.js`, `shared/dashboard-extra.js`, `dashboard.html`, `tools/file-size-limits.json` | ~4 files |
| S6 (cosmetic) | `shared/dashboard-extra.js` | 1 file |

Total commits: **6** (one per sprint — clean revert points). Each commit independently passes `npm run verify:memory` + audit gates.

## Sprint Plan

### S1 — Window-ize listener globals (prereq, ~30 min)

**Why:** Required before any extraction touches sections that reference `realtimeListeners` or `_xxxUnsub` lets. Pure refactor: zero behavior change.

- [ ] `let realtimeListeners = {}` (L759) → `window.realtimeListeners = window.realtimeListeners || {}`
- [ ] `realtimeListeners = {}` reassignment in `stopRealtimeListeners` (L835) → `window.realtimeListeners = {}`
- [ ] `let _leaseRequestsUnsub = null` (L1295 area) → `window._leaseRequestsUnsub = null`; update 3-4 internal writes
- [ ] `let _docsUnsub` (in Document Hub section) → `window._docsUnsub`
- [ ] `let _petsUnsub` (in Pet Approvals section) → `window._petsUnsub`
- [ ] `let _rewardsAdminUnsub` (in Rewards Admin section) → `window._rewardsAdminUnsub`
- [ ] `let _gamificationConfigUnsub` (in Gamification Live Toggle) → `window._gamificationConfigUnsub`
- [ ] Update `cleanupAdminListeners()` body to read all 6 vars via `window.X` explicitly (no implicit bareword) for clarity
- [ ] Verify `npm run verify:memory` still green
- [ ] Live grep: `grep -nE "^\s*let\s+_\w+Unsub" shared/dashboard-extra.js` should return only `_insightsUnsubs` (which stays)
- [ ] Commit: `refactor(dashboard-extra): window-ize realtimeListeners + 5 listener-unsub vars (Phase 2 prereq)`

### S2 — Extract `dashboard-tenant-lease.js` (~75 min)

- [ ] Create file with header: purpose, extracted-from breadcrumb (commit SHAs from Phase 1 + S1), §7-V/§7-N anti-pattern notes
- [ ] Copy L624-757 (Lease Expiry Alerts) — verbatim including `_leaseNotifsCache` + `LEASE_TIER_META` + `_LEASE_TIER_ORDER`
- [ ] Copy L1294-1483 (Lease Requests Queue) — verbatim including `window._leaseRequestsUnsub` reference, `_leaseRequestsCache`, `_leaseRequestsFilter`
- [ ] Copy L1660-1890 (Tenant Master Page)
- [ ] Copy L1891-2315 (Lease Agreements Page)
- [ ] Copy L2316-2543 (Document Hub)
- [ ] Copy L3263-3419 (Pet Registration Approvals) — verbatim including `window._petsUnsub`
- [ ] Delete copied ranges from `dashboard-extra.js`, leave 1-line breadcrumb at each spot
- [ ] Add `<script src="./shared/dashboard-tenant-lease.js"></script>` to `dashboard.html` BEFORE `dashboard-extra.js`
- [ ] Register new file in `tools/file-size-limits.json` (soft 2000, hard 2500, growthPerCommit 200 — same shape as domain-stores)
- [ ] Update `memory/lifecycle_lease_action.md` + `memory/lifecycle_tenant_ssot.md` — add Architecture/Code-location note pointing to new file
- [ ] Live verify: `npm run audit:size` + `npm run audit:auth` exit 0
- [ ] Commit: `refactor(dashboard): extract dashboard-tenant-lease.js (Phase 2 S2)`

### S3 — Extract `dashboard-bills.js` (~60 min)

- [ ] Create file header (same shape as S2)
- [ ] Copy L2544-2643 (Upload Real Bills Page)
- [ ] Copy L2644-3040 (Bill Generation System)
- [ ] Copy L3867-4611 (Billing Import Functions — Excel→Firestore pipeline)
- [ ] Delete from extra.js with breadcrumbs
- [ ] Add `<script>` tag to dashboard.html
- [ ] Register in file-size-limits.json
- [ ] Update `memory/billing_monthly_flow.md` — add code-location note
- [ ] Live verify gates + `verify:memory`
- [ ] Commit: `refactor(dashboard): extract dashboard-bills.js (Phase 2 S3)`

### S4 — Extract `dashboard-config.js` (~75 min)

- [ ] Create file header
- [ ] Copy L1016-1208 (Owner Info Page)
- [ ] Copy L1209-1293 (Building Internet Config)
- [ ] Copy L1484-1659 (Apartment Logo)
- [ ] Copy L3076-3262 (Community Documents Management) — incl. `window._docsUnsub`
- [ ] Copy L3420-3523 (Gamification Page) + L3524-3607 (Gamification Live Toggle) — incl. `window._gamificationConfigUnsub`
- [ ] Copy L3608-3704 (Policy Admin CRUD)
- [ ] Copy L3705-3864 (Rewards Admin CRUD) — incl. `window._rewardsAdminUnsub`
- [ ] Delete from extra.js with breadcrumbs
- [ ] Add `<script>` tag
- [ ] Register in file-size-limits.json (soft 2000, hard 2500)
- [ ] Update `memory/owner_config.md` + `memory/gamification_ssot.md` — add code-location notes
- [ ] Live verify gates
- [ ] Commit: `refactor(dashboard): extract dashboard-config.js (Phase 2 S4)`

### S5 — Extract `dashboard-admin-ops.js` (~30 min)

- [ ] Create file header
- [ ] Copy L3041-3075 (Debug Console Helpers)
- [ ] Copy admin utility CFs (`grantAdminRole`, `cleanupAnonUsers`, `runAwardComplaintFreeMonthDryRun`) — exact line numbers TBD after S2-S4 shift positions
- [ ] Delete from extra.js with breadcrumbs
- [ ] Add `<script>` tag
- [ ] Register in file-size-limits.json (soft 300, hard 500 — small file)
- [ ] Live verify gates
- [ ] Commit: `refactor(dashboard): extract dashboard-admin-ops.js (Phase 2 S5)`

### S6 — Cosmetic: collapse `window.updateRoomStatuses` double-assign (~15 min)

**Why:** L572 `window.updateRoomStatuses = updateRoomStatuses` is dead — L946 immediately overwrites it with a wrapper. Removing L572 + simplifying L945 reduces confusion for future readers; no functional change (wrapper still wraps the local function).

- [ ] Delete L572 (`window.updateRoomStatuses = updateRoomStatuses;`)
- [ ] Simplify L945-950 to capture `updateRoomStatuses` (local fn ref) directly instead of going through `window.updateRoomStatuses`:
  ```js
  // Before:
  const originalUpdateRoomStatuses = window.updateRoomStatuses;
  window.updateRoomStatuses = function() {
    originalUpdateRoomStatuses();
    updateOccupancyDashboard();
    updateLeaseExpiryAlerts();
  };
  // After:
  window.updateRoomStatuses = function() {
    updateRoomStatuses();
    updateOccupancyDashboard();
    updateLeaseExpiryAlerts();
  };
  ```
- [ ] Verify cross-script callers still resolve: `grep -n "updateRoomStatuses(" shared/dashboard-pdpa-erasure.js shared/dashboard-tenant-modal.js` should be unchanged
- [ ] Commit: `chore(dashboard-extra): collapse window.updateRoomStatuses double-assign`

## Success criteria for Phase 2

- ✅ Each of S1-S6 ships as a separate commit; each independently passes pre-commit hooks (`verify:memory` + `audit:size` + `audit:auth` + security)
- ✅ Final `dashboard-extra.js` line count between 1,800-2,100 LOC (~21-25% of soft)
- ✅ All 4 new files < 1,500 LOC each (under soft caps in file-size-limits.json)
- ✅ `dashboard.html` script load order has all 5 extracted modules + extra.js + insights, no breakage
- ✅ Live admin UI smoke (Plan #4 `npm run smoke:verify` from main): bill + checklist + deposit flows all read correctly
- ✅ Live admin UI manual verify (Chrome MCP, post-S6 deploy): tenant page, lease tab, bill upload, owner info, gamification config, debug helpers — all functional
- ✅ Memory docs updated: `lifecycle_lease_action.md`, `lifecycle_tenant_ssot.md`, `billing_monthly_flow.md`, `owner_config.md`, `gamification_ssot.md` carry code-location notes
- ✅ Phase 2 handoff written: `next_session_handoff_2026_05_2X_phase2_extraction.md`

## Anti-pattern relevance

- **§7-CC (`let X` at script top-level is NOT on window)** — DIRECT TRIGGER for S1. The whole prereq exists to close this trap before extraction.
- **§7-V (setupXxx listener leak)** — S2 carries `setupLeaseNotifsListener` which already follows §7-V (prior-unsub teardown). Must preserve verbatim during extraction.
- **§7-N (onSnapshot must have error callback)** — same; existing listeners already have callbacks per Phase 1 audit. Preserve verbatim.
- **§7-K (defined ≠ wired)** — S2-S5 must verify every `window.X = ...` in the extracted module has an actual caller in the new load order. Pre-commit audit-auth gate enforces.
- **§7-J (static deploy ≠ live-verified)** — Plan #4 smoke playbook (admin) catches regressions in bill / checklist / deposit reads. Manual Chrome MCP verify catches everything else.
- **§7-AA (pre-existing CF/feature search)** — N/A for refactor; no new features.
- **§1 verify-via-grep doctrine** — every memory doc updated in S2-S5 embeds a grep verifier for the new file path.

## Risks + open questions

| Risk | Likelihood | Mitigation |
|---|---|---|
| Extracted module needs a `let` that I missed in S1 prereq → §7-CC trap silently | Low (survey done) | Live-verify gates + pre-commit hook + manual Chrome MCP after each S |
| Line-number drift between sprints — S3 ranges shift after S2 deletes lines | Certain | Re-grep section markers at start of each S (commands in sprint check items) |
| `cleanupAdminListeners` reads vars in inconsistent order (some bareword, some `window.X`) after S1 | Low | S1 explicitly normalizes ALL 6 reads to `window.X` form |
| Insights page (L4613+) references something I extract | Low (Insights is self-contained per Phase 1 survey) | Re-grep before each S; if hit, leave shared dep in extra.js |
| LIFF / tenant_app side affected | Zero | Phase 2 only touches admin-dashboard files |

**Open question:** should `cleanupAdminListeners` move to `dashboard-admin-ops.js` (it'd add ~30 LOC there, growing to ~175 LOC)? **Recommendation: NO** — keeping cleanup in extra.js preserves "single owner of admin listener lifecycle" mental model. Also: cleanup touches `_insightsUnsubs` which stays in extra.js with the Insights section, so colocating cleanup with that side is cleaner.

---

**Ready for review.** Reply with ✅ to start S1, or note scope changes / sprint reordering. Especially worth your call on:
1. **Sprint ordering** — recommended S1→S2→S3→S4→S5→S6 (prereq first, then extractions, cosmetic last). Alternative: do S6 first (it's smallest, builds confidence). Both are safe.
2. **Single PR or per-sprint pushes** — recommended: push after each S so Vercel deploys incrementally and any regression is caught early. Alternative: hold all 6 commits locally, push once after S6. Speeds iteration but defers smoke verification.
3. **`cleanupAdminListeners` placement** — confirm "stays in extra.js" or move to admin-ops.

---

# Review (2026-05-21 — Phase 2 SHIPPED)

All 6 sprints landed + pushed to main, 6 commits + 2 sub-bug commits before them. End-state matches plan.

## What shipped

| Commit | SHA | Δ extra.js | Notes |
|---|---|---|---|
| feat(leases): add Firestore onSnapshot listener | `7e3df34` | — | Sub-bug #1, dashboard-tenant-page.js |
| refactor(tenant-page): remove §7-DD-redundant bridge | `e06d378` | — | Sub-bug #2, dashboard-tenant-page.js |
| S1 — window-ize realtimeListeners + 5 unsub vars | `9c79c0e` | 5,484 → 5,497 (+13 comments) | Prereq, no behavior change |
| S2 — extract dashboard-tenant-lease.js | `84f1911` | 5,497 → 4,210 (-23%) | 1,318 LOC new file |
| S3 — extract dashboard-bills.js | `0b81ad6` | 4,210 → 2,971 (-29%) | 1,257 LOC new file |
| S4 — extract dashboard-config.js | `fda35e0` | 2,971 → 1,817 (-39%) | 1,181 LOC new file |
| S5 — extract dashboard-admin-ops.js | `7659cca` | 1,817 → 1,673 (-8%) | 165 LOC new file |
| S6 — collapse window.updateRoomStatuses double-assign | `48b47ed` | 1,673 → 1,675 (+net 2 — comment) | cosmetic |

**dashboard-extra.js**: 5,484 → **1,675 LOC** (-69%, 65% → 20% of soft 8,500). All 5 new modules <66% of their soft 2,000.

## Files NOT touched (deliberate, per plan)

- `cleanupAdminListeners` + beforeunload — stayed in dashboard-extra.js per user decision (Q3 of plan approval)
- OWNER INSIGHTS PAGE (L4612-5417 of original) — explicitly out of Phase 2 scope; ~800 LOC stays in extra.js residual
- `loadOwnerInfoFromFirebase` call sites — only the calls live in extra.js; the implementation is in shared/owner-config.js (untouched)

## Deferred / follow-up candidates

- **Insights extraction** (dashboard-insights.js OR dashboard-insights-old.js for the OLD `_insights*` block in extra.js residual) — would drop extra.js to ~860 LOC. Not Plan-First-required at current size; can defer indefinitely.
- **Misplaced functions cleanup** — the orphan logo helpers (was at L1421-1486 of pre-S1 extra.js) are now in dashboard-config.js inside the LOGO block. Naming convention could be improved (`uploadOwnerLogo` vs `uploadApartmentLogo`) but pure rename; defer.
- **Live admin UI verification via Chrome MCP** — Phase 2 verifications were pre-commit-gates (audit:size + audit:auth + verify:memory + Node --check syntax). Real-data verification (open dashboard → click each extracted page → verify renders) was NOT done. **Recommend as first action next session before any new work.**

## Anti-pattern verification

- §7-CC closed for all 5 extracted modules' shared globals (S1 prereq)
- §7-V preserved verbatim in moved listeners (each has prior-unsub teardown)
- §7-N preserved verbatim (each onSnapshot has error callback)
- §7-K (defined ≠ wired) — every `window.X = ...` in new files has at least one caller; verified via syntactic re-parse passing
- §7-J (static deploy ≠ live-verified) — open; see "Deferred" above

## Memory docs updated (user-scoped, NOT in commits)

- lifecycle_pets_registration.md (S2)
- lifecycle_storage_uploads.md (S2)
- lifecycle_tenant_ssot.md (S2 + S4)
- lifecycle_lease_action.md (S2)
- lifecycle_stores_facade.md (S3 stale-claim fix)
- lifecycle_insights_analytics.md (S5)
- owner_config.md (S4)
- gamification_ssot.md (S4)
