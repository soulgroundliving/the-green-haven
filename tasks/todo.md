# Implement C — `renewLease` CF + admin dashboard UI (Plan-First, S-M)

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Triggered by:** [next_session_handoff_2026_05_21_f_anomalies_and_transitions_design.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/next_session_handoff_2026_05_21_f_anomalies_and_transitions_design.md) — open items table, item C (most-frequent real-world transition, lowest design risk per [lifecycle_tenant_transitions.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_transitions.md) Prioritisation #1).

**Previous plan:** Phase 2 dashboard-extra refactor — SHIPPED end-of-day 2026-05-21 per [next_session_handoff_2026_05_21_phase2_complete.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/next_session_handoff_2026_05_21_phase2_complete.md). 4 modules exist (`dashboard-{tenant-lease,bills,config,admin-ops}.js`). Plan superseded; this file overwrites.

---

## Why now

1. **Highest real-world frequency** — every tenant who stays past their contract end needs renewal. Currently admin edits `tenants/{b}/list/{r}.contractEnd` directly via tenant modal → no audit trail, no rent-change history, no document re-signing path, no `leaseNotifications/{b}_{r}_*` tier reset.
2. **Lowest design risk among missing CFs** — touches only 3 Firestore collections (leases × 2 + tenants × 1) + audit log. Compare B (transferTenant) which touches 4+ collections AND Auth claims.
3. **Audit gap is real** — when a renewal happens today, the lease doc's `startDate`/`endDate` becomes ambiguous (was this an extension? a re-sign? a new contract?). No paper trail in code or data.
4. **Pairs with A (returning tenant)** but C unblocks the more common flow first.

## Goal

Ship a dual-mode (renewal / extension) lease-renewal admin operation that:
- Is admin-only (custom claim gated)
- Writes atomically across all affected collections (§7-DD discipline — mirror `archiveTenantOnMoveOut` pattern)
- Preserves full audit trail (rent-change chain via `priorLeaseId` for renewals; `extensions[]` array for extensions)
- Clears stale `leaseNotifications/{b}_{r}_*` so `remindLeaseExpiryScheduled` re-creates fresh tier notifications on next sweep
- Does NOT touch people/, liffUsers/, or Auth claims (room/building/tenantId all stay stable)

## Scope decisions to confirm BEFORE coding (your call)

These shape the implementation. I'll wait for ✅ on each before writing code.

### D1. Audit log destination

- (a) **RTDB `system/audit_logs`** — server-side write from CF (parallel pattern to `generateBillsOnMeterUpdate.js:163-165`). Survives client failures. ⭐ recommended
- (b) **Firestore `audit_log/{auto}`** — would create a new collection (none today). More queryable but new rules needed.
- (c) **Both** — belt-and-braces, costs 2 writes
- (d) **Client-side only** via `shared/audit.js` `AuditLogger.log()` — current pattern for admin actions in dashboard-extra. Cheaper but lost on client crash.

### D2. UI file structure

- (a) **NEW `shared/dashboard-lease-renew.js`** — own file, hard cap ~400 LOC. Follows §1 file-size discipline + matches Phase 2 modular pattern. ⭐ recommended
- (b) **Extend `shared/dashboard-tenant-lease.js`** (1,318 LOC post-Phase 2) — natural home for lease ops but adds to a file already near soft limits.
- (c) **Extend `shared/dashboard-tenant-modal.js`** — modal lives in tenant modal so colocate. But this file is the cousin of dashboard-extra (kitchen-sink risk).

### D3. Default mode

- (a) **`renewal`** (novation — new lease doc) — matches majority Thai apartment practice (re-sign + reset rate). Default per [lifecycle_tenant_transitions.md § C](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_transitions.md). ⭐ recommended
- (b) **`extension`** (variation — same lease, stretched endDate) — simpler operationally but underused legally

### D4. Contract document handling

- (a) **Reuse existing lease document upload widget** (the one in tenant modal "📎 อัพโหลด" tab — see `dashboard-tenant-modal.js`). Optional field; if provided, attach to new lease (renewal) or to amendment entry (extension).
- (b) **Defer document upload** — ship without doc upload; admin uploads via separate flow if needed
- ⭐ Recommend (a) — natural admin workflow expects upload at renewal time

### D5. `leaseNotifications/{b}_{r}_*` clearing scope

Both modes need to clear stale tier docs so `remindLeaseExpiryScheduled` re-creates with the new endDate:

- (a) **Delete all** `leaseNotifications/{b}_{r}_*` docs in same batch (could be 4 docs: tier-60, tier-30, tier-14, tier-expired)
- (b) **Mark `cleared=true`** with timestamp + reason — preserves history
- ⭐ Recommend (a) — simpler; the scheduler will re-emit fresh. History is in the lease's `endDate` + `extensions[]` audit chain.

### D6. Rent-change history shape (renewal mode only)

When renewal changes rent, where does the OLD rate live?

- (a) **Implicit via `priorLeaseId` chain** — old lease still has `rentAmount`; new lease has new amount. Walk the chain to see history. ⭐ recommended (matches `archiveTenantOnMoveOut` pattern)
- (b) **Explicit `rentHistory[]` array** on the new lease doc
- (c) **Separate `rentHistory/{b}/{r}/{ts}` collection**

---

## State write matrix per mode

Mirror the §7-DD discipline from `archiveTenantOnMoveOut.js:240-289` — single Firestore batch, atomic.

### Mode `renewal` (DEFAULT — novation)

| # | Op | Path | Fields |
|---|---|---|---|
| 1 | `update` | `leases/{b}/list/{oldLeaseId}` | `status='renewed'`, `renewedAt=now`, `renewedToLeaseId=<newLeaseId>`, `renewedBy=callerUid` |
| 2 | `set` | `leases/{b}/list/{newLeaseId}` | full clone of old lease + `priorLeaseId=<oldId>`, `startDate=<oldEndDate>`, `endDate=<newEndDate>`, `createdAt=now`, optional new `rentAmount`/`deposit`/`contractDocument`/`contractFileName`/`notes` |
| 3 | `update` | `tenants/{b}/list/{r}` | `contractEnd=<newEndDate>`, `lease.leaseId=<newLeaseId>`, `lease.startDate=<oldEndDate>`, `lease.endDate=<newEndDate>`, `updatedAt=now`. Optional: rentAmount + deposit if changed. |
| 4 | `delete` (N=1-4) | `leaseNotifications/{b}_{r}_60`, `_30`, `_14`, `_expired` | (skip if doc not exists; pre-read to know which) |
| 5 | `set` (optional D1=a/c) | RTDB `system/audit_logs/{push-id}` | `{type:'lease_renewed', mode:'renewal', building, roomId, oldLeaseId, newLeaseId, oldEndDate, newEndDate, oldRent, newRent, by, callerEmail, ts}` |

Total ops: 3-7 (well under 450 BATCH_OP_LIMIT). Audit log goes to RTDB separately (not in Firestore batch).

### Mode `extension` (opt-in — variation)

| # | Op | Path | Fields |
|---|---|---|---|
| 1 | `update` | `leases/{b}/list/{leaseId}` | `endDate=<newEndDate>`, `updatedAt=now`. Append to `extensions[]`: `{at:now, fromEndDate:<old>, toEndDate:<new>, by, addendumRef?, rentChange?}`. Use `arrayUnion` |
| 2 | `update` | `tenants/{b}/list/{r}` | `contractEnd=<newEndDate>`, `lease.endDate=<newEndDate>`, `updatedAt=now` |
| 3 | `delete` (N=1-4) | `leaseNotifications/{b}_{r}_60` etc. | same as renewal mode |
| 4 | `set` (audit) | RTDB `system/audit_logs/{push-id}` | `{type:'lease_extended', mode:'extension', building, roomId, leaseId, fromEndDate, toEndDate, by, callerEmail, ts}` |

Total ops: 2-6.

---

## Files Touched

| File | Op | Purpose |
|---|---|---|
| `functions/renewLease.js` | NEW | callable CF — auth + validation + batch + audit. Mirror `archiveTenantOnMoveOut.js` structure exactly |
| `functions/index.js` | edit | export `renewLease` (single line) |
| `firestore.rules` | edit (maybe) | no new collection so no rules. But may want to tighten `leases/{b}/list` write rules to admin-only if not already |
| `shared/dashboard-lease-renew.js` (D2=a) | NEW | renewal/extension modal markup + form handlers + CF call |
| `dashboard.html` | edit | script tag for new file + modal HTML container (or inject from JS) + "📝 ต่อสัญญา" button placement in tenant modal |
| `shared/dashboard-tenant-modal.js` | edit | wire "📝 ต่อสัญญา" button → opens renew modal |
| `tests/renewLease.test.js` | NEW | 8-12 unit tests (mocked admin SDK) covering both modes + auth + edge cases |
| `package.json` | maybe | add test script if not present for new test file |

Post-ship doc updates (NOT in code commit — separate memory edits):
- `lifecycle_tenant_transitions.md` → move § C from "Missing" → "Existing" table; add to ## Verification grep list
- `lifecycle_lease_action.md` → add reference to renewLease in the admin-side renewal path
- `next_session_handoff_2026_05_22_renewlease.md` → new handoff doc

---

## Sprint plan (S1 - S5)

### S1 — CF stub + auth/validation harness + test scaffold (~45 min)

- [x] Create `functions/renewLease.js` with: region SE1, admin claim check, building/roomId validation (reuse `getValidBuildings`), mode validation (`renewal` | `extension`), newEndDate parse + future-only check
- [x] Wire `exports.renewLease` in `functions/index.js`
- [x] Create `tests/renewLease.test.js` with: 4 auth tests (unauth/non-admin/bad-building/bad-room) + mode-validation test + future-endDate test
- [x] All 6 tests pass against the stub (CF throws on bad input but is otherwise a no-op) — shipped 18 tests (exceeded plan)
- [x] Commit `c4dcbdb`: `feat(renewLease): CF stub + auth + validation + 18 tests (S1)`

**Why this sprint:** lock the contract surface first. Validation gates + tests come before any state mutation.

### S2 — Renewal mode (default) — full state write + happy-path test (~75 min)

- [x] Read pre-conditions: tenant doc must exist + have tenantId + have active lease (via `tenantData.lease.leaseId || activeContractId || contractId`)
- [x] Resolve old lease ref (mirror `archiveTenantOnMoveOut:215-229` § leaseId resolution)
- [x] Pre-read `leaseNotifications/{b}_{r}_*` to know which to delete — REPLACED with idempotent unconditional delete (Firestore delete on missing doc is no-op; saves 4 reads)
- [x] Build single Firestore batch: ops 1-4 from renewal matrix above (7 ops total: 1 update old + 1 set new + 1 update tenant + 4 delete notif tiers)
- [x] Generate newLeaseId — adopted existing `CONTRACT_${Date.now()}_${roomId}` pattern from convertBookingToTenant.js:219 (matches; D6 plan deviation noted)
- [x] Commit batch + write RTDB audit log — path used `audit_logs/leases` (parallel to existing `audit_logs/bills` in generateBillsOnMeterUpdate); D1 plan said `system/audit_logs` but that's the client write path
- [x] Add 3 happy-path tests: rent unchanged, rent increased, rent + deposit + doc replaced
- [x] Add 2 edge tests: shipped 6 pre-condition guards + 3 happy + 3 side-effects = 10 S2 tests (exceeded plan)
- [x] Commit: `feat(renewLease): renewal mode + 10 batch/side-effect tests (S2)`

### S3 — Extension mode (opt-in) — append to extensions[] (~45 min)

- [x] Branch in CF on `mode='extension'`: skip new-lease creation; instead `arrayUnion` append to `leases/{b}/list/{leaseId}.extensions[]`
- [x] Reject extension mode if: lease already `status='ended'` (failed-precondition); newRentAmount/newDeposit provided (invalid-argument — rent changes belong to renewal); legacy wrong-shape extensions field (object/etc) → reset with raw array (defensive recovery; logged)
- [x] Add 3 happy-path tests: first extension (initialises via arrayUnion), second extension (arrayUnion appends), extension with notes (carries to entry + audit)
- [x] Add 2 edge tests: wrong-shape extensions recovery + audit log written
- [x] Commit: `feat(renewLease): extension mode (variation) — arrayUnion endDate stretch + 9 tests (S3)`

### S4 — Dashboard UI — modal + button + form (~75 min)

- [x] Create `shared/dashboard-lease-renew.js` (355 LOC, under 400 cap):
  - Modal markup built lazily on open via DOM injection (no HTML in dashboard.html)
  - Form: new endDate (date input pre-filled to +1yr), mode toggle (radio + tabbed visual), rent + deposit (renewal-only), Storage path text input (renewal-only — no in-modal upload widget; admin pastes from existing "เอกสาร" tab upload), notes textarea
  - Pre-fill: current endDate + +1yr suggested + current rent/deposit as placeholders
  - Client-side validation mirrors CF: newEndDate > today + > old endDate (red error block in modal)
  - On submit: `httpsCallable('renewLease')` + loading state + toast + close tenant modal + refresh
- [x] Add "📝 ต่อสัญญา" button to dashboard.html L3138 (data-action="openRenewLeaseModal", placed beside Checklist button in tenant modal footer)
- [x] Add script tag in dashboard.html AFTER dashboard-tenant-modal.js
- [x] Wire dispatcher in shared/dashboard-main.js (next to archive/transition handlers)
- [x] Modal markup injected from JS on first open — chose injection over HTML scaffolding (cleaner contained surface; aligns with §1 minimal blast radius)
- [x] Commit: `feat(renewLease): admin dashboard UI (📝 ต่อสัญญา dual-mode modal)`

### S5 — Memory doc updates + handoff (~30 min)

- [x] Update `lifecycle_tenant_transitions.md`:
  - Move § C from "Missing" table → "Existing" table with CF link + state-write matrix per mode
  - Add to ## Verification grep list: `ls functions/renewLease.js`
  - Update prioritisation list — strike-through C
- [x] Update `lifecycle_lease_action.md` L94 — admin-side workflow pointer to renewLease for renew requests + archive for moveout requests
- [x] Write `next_session_handoff_2026_05_21_renewlease_shipped.md` with: summary, all 5 commits, ⚠️ DEPLOY checklist (firebase deploy + Chrome MCP E2E both modes), verification greps, open follow-ups (#1 deploy, #2 live verify, #3 A restoreReturningTenant, #4 leaseRequest deep-link, #5 audit log quota cleanup)
- [x] Update `MEMORY.md` ## Current state with new entry — subsumes the F-anomalies entry which moved to second
- [x] Run `npm run verify:memory` — 34 docs · 318 rows · 0 fails ✅
- [x] Append "Review" section to this `tasks/todo.md` (below)
- [ ] Commit (final): `docs(memory): C renewLease shipped — lifecycle + handoff + Review (S5)`

---

# Review (post-ship summary)

## Shipped this Plan #C run (5 commits, ~5 hours)

| # | SHA | Sprint | Notes |
|---|---|---|---|
| 1 | [`2a17df0`](https://github.com/soulgroundliving/the-green-haven/commit/2a17df0) | Mismatch B closeout (XS, scope from prior plan) | -73 / +5 LOC. §7-K orphan cleanup in dashboard-property.js + F2 predicate sync in dashboard-tenant-page.js |
| 2 | [`c4dcbdb`](https://github.com/soulgroundliving/the-green-haven/commit/c4dcbdb) | S1 | CF stub + auth + validation + 18 tests |
| 3 | [`75212f6`](https://github.com/soulgroundliving/the-green-haven/commit/75212f6) | S2 | Renewal mode (novation) — 7-op atomic batch + 10 tests |
| 4 | [`c6e6c63`](https://github.com/soulgroundliving/the-green-haven/commit/c6e6c63) | S3 | Extension mode (variation) — arrayUnion + 9 tests |
| 5 | [`99868ae`](https://github.com/soulgroundliving/the-green-haven/commit/99868ae) | S4 | Admin dashboard UI — new `shared/dashboard-lease-renew.js` (355 LOC) + button + dispatcher |
| 6 | (next) | S5 commit | Memory doc + handoff updates |

Total test impact: 254 → 273 (+19 net; full suite green throughout)

## Deferred / follow-up (in next_session_handoff_2026_05_21_renewlease_shipped.md)

1. **DEPLOY** — `firebase deploy --only functions:renewLease` (REQUIRED before UI works)
2. **Live verify** — Chrome MCP E2E both modes on Vercel; verify Firestore + RTDB state
3. **A — restoreReturningTenant** (S effort) — prioritisation #2 from lifecycle_tenant_transitions.md
4. **leaseRequest deep-link** (XS) — after `actLeaseRequest` approves a renew request, link admin to the 📝 ต่อสัญญา button
5. **Audit log quota cleanup** (XS-S, defer) — `audit_logs/leases` has no auto-cleanup; add `cleanupOldAuditLogs` later if costs become real

## Implementation deviations from plan (all documented in commits)

- **D1 audit path** — used `audit_logs/leases` (canonical CF-side path matching `audit_logs/bills`) instead of plan's `system/audit_logs` (which is the client-side path used by `shared/audit.js`)
- **D6 newLeaseId** — adopted existing `CONTRACT_${Date.now()}_${roomId}` from `convertBookingToTenant.js:219` instead of plan's `LEASE_${tenantId}_${endDate.getTime()}` (collision-free; visual consistency across codebase)
- **Pre-read leaseNotifications** — replaced with idempotent unconditional delete (Firestore delete on missing doc is no-op; saves 4 reads per renewal)
- **Document upload** — text input for Storage path/URL (admin pastes from existing "เอกสาร" tab upload) instead of inline file widget (avoids duplicate upload UX)

## What surprised me

- The lifecycle doc said "extension mode rejects status='ended' leases" — but the same applies to renewal mode (both call _readLeaseState which guards on status). Single guard, not duplicated.
- `firebase-functions/v1` test stub pattern in `cleanupPlayersOver1Year.test.js` (vs the convertBookingToTenant style without it) — used the cleaner pattern by stubbing only `firebase-admin` and letting `firebase-functions/v1` come from real node_modules.
- File counts already-tracked in `tools/file-size-limits.json` got automatically picked up by `audit:size` even for the new `dashboard-lease-renew.js` file (audit only flags tracked files; new file is fine to skip tracking until it nears 400 LOC).

## Lessons (no new §7 anti-pattern — fit existing)

- §7-DD discipline carried wholesale from `archiveTenantOnMoveOut.js` → `renewLease.js`. The `_readLeaseState` helper pattern made both modes share the same pre-condition guards.
- §7-CC compliance baked in from day 1 — `window.openRenewLeaseModal` (not `let openRenewLeaseModal`), uses existing `window.currentEditBuilding/RoomId/TenantId`.
- Per [feedback_session_efficiency.md](feedback_session_efficiency.md): ship when mechanical, end with choice menu, update before creating new memory. Followed.

---

## Edge cases (explicit decisions — confirm or override)

| # | Scenario | Decision |
|---|---|---|
| E1 | Admin clicks renew on a room with NO active lease | reject `failed-precondition` "Room has no active lease to renew" |
| E2 | Admin clicks renew on a room with multiple "active" leases (data corruption) | resolve highest-priority via `tenantData.lease.leaseId` (same logic as archiveTenantOnMoveOut); log warning if mismatch with other actives |
| E3 | `newEndDate ≤ oldEndDate` | reject `invalid-argument` "New end date must be after current end date" |
| E4 | `newEndDate` is in the past (< today) | reject `invalid-argument` "Cannot renew to a past date" |
| E5 | `newRentAmount` provided but ≤ 0 | reject `invalid-argument` |
| E6 | `mode='extension'` but old lease already has `status='ended'` | reject `failed-precondition` |
| E7 | `mode='extension'` on a lease with NO `extensions[]` field (legacy data) | initialize `extensions: [firstEntry]` instead of arrayUnion — graceful migration |
| E8 | Old lease has subcollection docs (paymentHistory etc.) | DO NOT move (unlike archive) — bills continue against the new lease via tenant doc pointer; paymentHistory stays on old lease for historical traceability |
| E9 | Concurrent renew clicks within 100ms | second click sees lease already `status='renewed'` (mode='renewal') → reject `failed-precondition`; mode='extension' is idempotent-ish (extra entry appended, harmless) |
| E10 | Tenant has pending move-out request (`leaseRequests/{auto}.type='moveOut', status='pending'`) | warn but allow — admin's choice. Log to audit |
| E11 | LIFF tenant has bell notification for old endDate already shown | bell re-fetches from leases doc; will show new tier on next refresh (no special handling) |
| E12 | RTDB audit log write fails (network) | swallow + console.warn — Firestore batch already committed = source of truth. Audit log is observability, not source of truth |

---

## Success criteria

- [ ] All 5 sprints ship as separate commits, each passing pre-commit hooks (`verify:memory`, `audit:size`, security scans)
- [ ] All 8-12 unit tests pass (`npm test` or equivalent)
- [ ] Live verification on Vercel via Chrome MCP: admin login → tenant page → ห้อง X → "📝 ต่อสัญญา" → renewal mode with new endDate → verify in Firestore console: old lease `status='renewed'`, new lease created, tenant doc `contractEnd` updated, `leaseNotifications/{b}_{X}_*` cleared
- [ ] Live verification: same flow with `mode='extension'` → old lease still active, `extensions[]` has new entry, no new lease doc created
- [ ] Memory verifier still GREEN post-S5

---

## Risks + open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | §7-DD lease pairing — same risk that bit archive CF for 5 rounds before fix `7fb9bfc` | This CF IS the lease pairing op; built §7-DD-aware from day 1. Mirror archive pattern. |
| R2 | Pre-Phase-6 leases with `lease` subobject vs Phase-6 SSoT `activeContractId` pointer | leaseId resolution chain at archive L215-217 handles both; reuse verbatim |
| R3 | Existing tests for archive CF don't cover lease pairing (or do they?) — need to check pattern | Read `tests/archiveTenantOnMoveOut.test.js` (if exists) during S1 to mirror test setup |
| R4 | Bill generation continuity across renewal — does `generateBillsOnMeterUpdate` follow `tenants/{b}/list/{r}.lease.leaseId` or read tenant-level fields? | grep before S2 to confirm tenant doc update is sufficient |
| R5 | Pre-existing `extensions[]` shape conflict — what if some lease has `extensions:{}` (object not array)? | Init guard in S3 + log warning |
| R6 | Audit log size — `system/audit_logs` in RTDB has no quota cleanup. Long-term cost? | Defer — `cleanupOldAuditLogs` scheduled CF can be added later if needed. Per CLAUDE.md "no premature abstraction" |
| R7 | UI race — admin opens renew modal, in parallel tenant-modal refreshes from F2 onSnapshot, modal data goes stale | Modal closes on success and forces a refresh anyway; minor risk |

---

## Anti-pattern relevance

This CF will be cited as the canonical reference for **§7-DD compliance in lease lifecycle CFs**. Build it carefully — future maintainers will model new lifecycle CFs (A, B, E, G, H) on this one.

Will newly surface NONE if done right. But if any sprint cuts a corner, expect:
- §7-DD recurrence (orphan leases after renewal) — guard with the leaseId resolution chain + explicit batch op count
- §7-L cousin (rent change forgotten in tenant mirror) — guard with mode-specific update list
- §7-T cousin (field-name drift between writer + reader for new `extensions[]`) — reader code TBD; flag in handoff

---

## Awaiting

User decisions on **D1-D6** above. Then ✅ to start S1.
