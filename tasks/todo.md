# Refactor shared/dashboard-extra.js — Phase 1: extract domain stores

**Status:** plan-first, awaiting approval. Do NOT edit code until ✅ from user.
**Triggered by:** Plan #6 from `next_session_handoff_2026_05_19_evening_4_smoke_test.md` (last remaining follow-up from evening-3 closeout).
**Why now:** `dashboard-extra.js` is currently **6,555 lines** — 77% of soft limit (8,500) per `tools/file-size-limits.json`. Recent growth (lease alerts, C4 merge) is pushing it toward the WARN tier. Splitting NOW is cheaper than splitting after the next 2 features.

## Goal (this session)

Extract the **4 domain-store IIFEs** from `dashboard-extra.js` into a single new module `shared/dashboard-domain-stores.js` (~1,000 LOC). Result:
- `dashboard-extra.js` shrinks from 6,555 → ~5,500 LOC (16% reduction, drops back below 65% of soft limit)
- `dashboard-domain-stores.js` is a single self-contained module with the 4 stores all admin code already depends on
- All `window.X` UMD exports preserved verbatim — zero changes to public API surface
- Smoke test (Plan #4, shipped commit `67b0b26`) gives regression-catch coverage for the change

## Why staged (Phase 1 only, not big-bang)

Per CLAUDE.md §1 Plan-First criteria, refactoring 6,555 lines in one go fails ALL three reversibility/risk thresholds. The handoff goal "3-4 focused modules each <2k lines" is the **destination**, not a one-session ask. Survey found:

| Refactor obstacle | Severity | Phase-1 impact |
|---|---|---|
| `let realtimeListeners = {}` (L759) — module-level state used by 13 call sites across init/listeners/lease alerts | HIGH — naive split breaks all real-time listeners | **Avoided** — Phase 1 doesn't touch these lines |
| `currentEditBuilding` / `currentEditTenantId` — referenced from 3 OTHER shared/*.js files (`dashboard-tenant-modal.js`, `dashboard-pdpa-erasure.js`, `dashboard-main.js`) | HIGH — they must already exist as globals OR refactor needs a window-ize pass first | **Avoided** — Phase 1 doesn't touch lease/tenant sections |
| `_leaseRequestsUnsub`, `_eventsUnsub`, `_docsUnsub`, etc. — 18+ module-level lets, one per feature section | LOW — each is naturally section-scoped already | **Phase 1 moves only the 4 IIFE-wrapped stores; their `let` siblings come with them as a clean unit** |
| Double-assignment bug: `window.updateRoomStatuses` is set at BOTH L572 and L946 (the second one wins, the first is dead code) | LOW (cosmetic) | **Not touched** — not in scope; a separate `chore:` commit |

The 4 stores being extracted are ALL standalone IIFEs (`window.Store = window.Store || (function(){...})()`) — self-contained, no shared lets with other sections, idempotent declaration. Lowest possible split risk.

## What Phase 1 extracts (exact line ranges in current file)

| Source range | Section | LOC | What |
|---|---|---|---|
| L3074-3331 | ServiceProvidersStore + UI helpers | 258 | `window.ServiceProvidersStore = ...` IIFE + supporting render fns |
| L3332-3598 | CommunityEventsStore + C4 merge | 267 | `_newAnnouncementsEventCache/Unsub` globals + `window.CommunityEventsStore` IIFE |
| L3942-4095 | RequestsStore (complaints/maint/hk) | 154 | `_RequestsStoreComplaintsUnsub` + `window.RequestsStore` IIFE |
| L5287-5682 | HistoricalDataStore | 396 | `window.HistoricalDataStore` IIFE |
| **Total extracted** | | **1,075** | Single new file `shared/dashboard-domain-stores.js` |

Note: gaps in the line ranges (L3599-3941, L4096-5286) STAY in `dashboard-extra.js` — they're separate domains (community docs, pet approvals, gamification, policy/rewards, reports, billing import). Those go in future phases.

## Architecture — destination after Phase 1

```
shared/
├── dashboard-extra.js          (~5,500 LOC, was 6,555) — everything except the 4 stores
└── dashboard-domain-stores.js  (~1,075 LOC, NEW)       — 4 stores + their unsub vars
```

**Script load order in `dashboard.html`** (currently L5561):

```html
<!-- BEFORE Phase 1 -->
<script src="./shared/dashboard-extra.js"></script>
<script src="./shared/dashboard-insights.js"></script>

<!-- AFTER Phase 1 -->
<script src="./shared/dashboard-domain-stores.js"></script>  <!-- NEW, must load first -->
<script src="./shared/dashboard-extra.js"></script>
<script src="./shared/dashboard-insights.js"></script>
```

Order requirement: domain-stores BEFORE dashboard-extra, because `dashboard-extra` calls into these stores (e.g. `RequestsStore.subscribeComplaints()`). Putting domain-stores AFTER would mean `window.RequestsStore` is `undefined` at the moment dashboard-extra tries to use it during init.

## Files Touched (Phase 1)

| File | Change | Why |
|------|--------|-----|
| `shared/dashboard-domain-stores.js` | **NEW** (~1,075 LOC) | The 4 IIFEs moved verbatim + their let-decl siblings |
| `shared/dashboard-extra.js` | DELETE the 4 extracted ranges + add 1-line header comment noting the extraction | Shrink + breadcrumb for next reader |
| `dashboard.html` | Add 1 `<script>` tag before existing `dashboard-extra.js` | Load order |
| `tools/file-size-limits.json` | Update `dashboard-extra.js` line-count baseline + register `dashboard-domain-stores.js` | Audit gate needs to know new file |
| `memory/lifecycle_stores_facade.md` | Note that the 4 stores moved to their own file | Architecture doc sync |
| `memory/MEMORY.md` | One-line update on lifecycle_stores_facade entry | Index sync |

Total: 1 new file, 4 mods. No production code logic changes — pure structural move.

## Sprint Plan

### S1 — Extract domain-stores.js (~60 min)

- [ ] Create `shared/dashboard-domain-stores.js` with file header (purpose + extracted-from breadcrumb + load-order requirement)
- [ ] Copy L3074-3331 (ServiceProvidersStore) — verbatim, no edits
- [ ] Copy L3332-3598 (CommunityEventsStore + C4 cache vars) — verbatim
- [ ] Copy L3942-4095 (RequestsStore) — verbatim, including outer `_RequestsStoreComplaintsUnsub` let
- [ ] Copy L5287-5682 (HistoricalDataStore) — verbatim
- [ ] Verify line count of new file ≤ 1,100 (margin for header)

### S2 — Trim dashboard-extra.js (~30 min)

- [ ] Delete L3074-3331 (replace with 1-line `// Moved to shared/dashboard-domain-stores.js (commit <SHA>)` breadcrumb)
- [ ] Delete L3332-3598 (same breadcrumb)
- [ ] Delete L3942-4095 (same breadcrumb)
- [ ] Delete L5287-5682 (same breadcrumb)
- [ ] Verify line count: 6,555 − 1,075 ≈ 5,480

### S3 — Wire + verify (~30 min)

- [ ] Update `dashboard.html` L5561 — add `<script src="./shared/dashboard-domain-stores.js"></script>` BEFORE `dashboard-extra.js`
- [ ] Update `tools/file-size-limits.json` — update `dashboard-extra.js` baseline and register the new file
- [ ] Run `npm run audit:size` — confirm both files pass file-size gate
- [ ] Run `npm run audit:auth` — confirm no auth callback regressions
- [ ] `curl https://the-green-haven.vercel.app/dashboard` after push — confirm both `<script>` tags present in HTML
- [ ] Run `node tools/smoke-test/verify.js bill --building rooms --room 15` post-deploy — confirm verifier still passes (regression check for Plan #4 wiring)

### S4 — Live UI verify + memory docs (~30 min)

- [ ] Open admin dashboard via Chrome MCP on Vercel post-deploy
- [ ] Navigate to People Mgmt → confirm RequestsStore-backed complaints panel renders (not stuck loading)
- [ ] Navigate to Content Mgmt → confirm CommunityEventsStore-backed events list renders
- [ ] Navigate to Service Providers section → confirm ServiceProvidersStore-backed list renders
- [ ] Navigate to Reports/HistoricalData area → confirm HistoricalDataStore-backed years render
- [ ] If any store fails to render, REVERT the commit — Phase 1 must be invisible to the user
- [ ] Update `memory/lifecycle_stores_facade.md` + grep-verifier in `## Verification`
- [ ] Update `memory/MEMORY.md` index line for lifecycle_stores_facade
- [ ] `npm run verify:memory` exit 0
- [ ] Write `memory/next_session_handoff_2026_05_19_evening_5_phase1.md` with Phase 2 roadmap

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **Load-order mistake** — domain-stores loaded AFTER dashboard-extra → undefined references at init | LOW | S3 step explicitly orders the `<script>` tags; S4 live verify catches in seconds |
| **Missed cross-reference** — some closure inside dashboard-extra references `_RequestsStoreComplaintsUnsub` or other extracted let | MEDIUM | grep-audit each extracted let name in dashboard-extra.js AFTER the trim (S2); if found, move the caller too |
| **Auth audit gate flags the new file** — pre-commit hook complains about §7-A/U/Z patterns in extracted code | LOW (none of the stores touch auth) | `npm run audit:auth` in S3 catches this before commit |
| **File-size gate trips** — `dashboard-extra.js` still over WARN even after trim | LOW (5,480 LOC is below 8,500 soft limit) | S3 audit:size confirms |
| **§7-K (defined ≠ wired)** — forget to add `<script>` tag in dashboard.html | MEDIUM | Wired into the S3 sprint as the FIRST thing to check; S4 live verify is the catch-all |
| **§7-V (setupXxx listener leak)** — none of the extracted stores set up listeners in `setupXxx` patterns; they own their unsub | LOW | None of the 4 stores fit the §7-V pattern (they're not invoked re-entrantly per page nav) |
| **A user is mid-session when the change deploys** | LOW (smoke runs <10 min) + the change is structurally invisible | Vercel rolling deploy makes this an N-second seam, no worse than any other deploy |

## Smoke test as the verifier

Plan #4 (shipped same day, commit `67b0b26`) gives exactly the regression coverage this refactor needs:

```bash
# Pre-deploy baseline:
node tools/smoke-test/verify.js bill --building rooms --room 15
# Expected: {"check":"bill","target":"rooms/15","pass":true,...}

# Post-deploy baseline (should be identical):
# Same command, same expected result. If it differs, deploy broke RTDB pipeline → revert.

# Admin smoke playbook flows 2, 4 (bill + checklist views via Chrome MCP) exercise:
# - dashboard.html script load order is intact
# - RequestsStore-backed admin surfaces still render
# - CommunityEventsStore-backed announcements still render
```

This is the first non-trivial use of the smoke system after shipping it — closes the validation loop on `lifecycle_smoke_test.md`.

## Phase 2 — what's deferred (NOT this session)

Captured for next handoff:

1. **Window-ize cross-module state** — `currentEditBuilding` / `currentEditTenantId` / `currentEditRoom` need to become explicit `window.X` exports (or get moved to `dashboard-main.js` as the canonical owner). Pre-req for Tenant/Lease module extraction.
2. **Window-ize `realtimeListeners`** — convert `let realtimeListeners` → `window.realtimeListeners`. Pre-req for splitting init/listeners from real-time consumers.
3. **Extract Tenant + Lease module** — L1294-2543 (lease requests + tenant master + lease agreements + document hub) → `shared/dashboard-tenant-lease.js`. ~1,250 LOC. Depends on (1).
4. **Extract Bills module** — L2544-3040 + L4541-5286 (bill generation + billing import) → `shared/dashboard-bills.js`. ~1,200 LOC. Depends on `_resolveBillRecipient` careful relocation.
5. **Extract Config module** — L1016-1659 (owner info + building internet + apartment logo) + L4284-4540 (policy/rewards CRUD) → `shared/dashboard-config.js`. ~1,000 LOC.
6. **Extract Admin Ops module** — L6456-6555 (grantAdminRole, cleanupAnonUsers, runAwardComplaintFreeMonthDryRun, cleanupAdminListeners) → `shared/dashboard-admin-ops.js`. ~100 LOC.
7. **Fix double-assignment bug** — `window.updateRoomStatuses` at L572 vs L946; keep the one in `init` section, delete the other. Cosmetic but worth a clean-up commit.

Final destination after Phase 1 + Phase 2:

```
shared/
├── dashboard-extra.js          (~800 LOC) — core init only (password modal, listeners, debug)
├── dashboard-domain-stores.js  (~1,075 LOC)
├── dashboard-tenant-lease.js   (~1,250 LOC)
├── dashboard-bills.js          (~1,200 LOC)
├── dashboard-config.js         (~1,000 LOC)
└── dashboard-admin-ops.js      (~100 LOC)
```

All files <2k LOC, the original target.

## Success criteria for Phase 1

- ✅ `shared/dashboard-domain-stores.js` exists with the 4 stores moved verbatim
- ✅ `shared/dashboard-extra.js` shrunk to ~5,480 LOC
- ✅ `dashboard.html` loads both files in correct order
- ✅ `npm run audit:size` + `audit:auth` exit 0
- ✅ Post-deploy `verify.js bill` returns `pass: true` (regression catch)
- ✅ Live admin UI: complaints, events, providers, history pages all render
- ✅ `npm run verify:memory` exit 0 with updated `lifecycle_stores_facade.md`
- ✅ `next_session_handoff` doc covers Phase 2 roadmap

## Anti-pattern relevance

- **§7-K (defined ≠ wired)** — directly applicable; pre-commit hook + S3 audit catches
- **§7-V (setupXxx listener leak)** — none of the extracted stores fit; verified by survey
- **§7-AA (pre-existing search)** — applied: confirmed no existing extracted dashboard module file via `ls shared/dashboard-*.js`
- **§1 verify-via-grep doctrine** — Phase 1 memory updates will embed grep verifiers
- **§7-J (static deploy ≠ live-verified)** — closed by Plan #4 smoke playbook + S4 live UI verify

---

**Ready for review.** Reply ✅ to start S1, or note any scope change. Especially: do you want Phase 1 only this session, or include the double-assignment bug fix (anti-pattern would say "no — separate concern")?
