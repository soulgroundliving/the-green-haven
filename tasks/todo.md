# Implement B — `transferTenant` CF + composite "📝 ต่อสัญญา/ย้ายห้อง" UI (Plan-First, M)

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Triggered by:** [next_session_handoff_2026_05_21_renewlease_verified_redesign_spec.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/next_session_handoff_2026_05_21_renewlease_verified_redesign_spec.md) — user surfaced mid-test that current "📝 ต่อสัญญา" modal handles same-room renewal ONLY, but real intent includes (i) custom newStartDate, (ii) toggle ห้องเดิม/ห้องใหม่, (iii) room picker, (iv) inline contract upload, (v) auto-fill new-room defaults, (vi) overall "reduce data entry".

**Previous plan:** C renewLease CF + admin UI — SHIPPED + LIVE-VERIFIED 2026-05-21 (commits `c4dcbdb` / `75212f6` / `c6e6c63` / `99868ae` / deploy `firebase deploy --only functions:renewLease`). Plan-Review section closed in prior session. This file overwrites that plan.

**Architectural Direction (LOCKED — do not re-litigate):** Direction B = 2 CFs + composite UI.
- Keep `renewLease` as-is (same-room renewal + extension modes). Verified live.
- Build NEW `transferTenant` CF — room change only, novation OR variation modes.
- Rebuild "📝 ต่อสัญญา" modal as a composite UI that routes to renewLease or transferTenant (or both, sequenced) depending on user toggle.

---

## Why now

1. **Real user request from live testing** — user verbatim: _"ลดการกรอกข้อมูล"_ + _"ทำเป็น choice ถ้าต่อสัญญาห้องเดิม หรือย้ายไปห้องใหม่"_. Direct UX gap caught while exercising the just-shipped renewLease flow.
2. **§7-DD high-risk transition (per [lifecycle_tenant_transitions.md § B](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_transitions.md))** — touches 4+ collections + Auth claims. Currently zero CF support; admin must do it manually = high drift risk.
3. **Pairs naturally with renewLease** — both surface in the same modal, both end up being the "this tenant is staying" flow with one toggle (same room vs new room).
4. **Unblocks lifecycle map B** — transitions.md prioritisation #4. After this, only A (returning tenant), G/H (forced-archive variants), and the data-model-change items remain on the missing list.

## Goal

Ship `transferTenant` CF + composite admin UI so admin can, in one modal, perform:

| Path | What user picks | CFs fired |
|---|---|---|
| Renew same room | toggle="ห้องเดิม" + new endDate | `renewLease` (existing) |
| Extend same room | toggle="ห้องเดิม" + mode="extension" + new endDate | `renewLease` extension mode (existing) |
| Move room only | toggle="ห้องใหม่" + pick room (same endDate, no rent change) | `transferTenant` (NEW) |
| Move room + renew | toggle="ห้องใหม่" + pick room + new endDate (+ optional rent change) | `transferTenant` (NEW), then `renewLease` from new-room context |

With these guarantees:
- Admin-only (custom claim gated)
- §7-DD discipline — single batched Firestore write for transferTenant
- §7-FF discipline — `setCustomUserClaims` + `revokeRefreshTokens` on `token.room` change
- Atomic-or-fail (no partial transfers); composite UI orchestrates sequential CFs with rollback messaging if step 2 fails after step 1 succeeded
- Existing renewLease is NOT modified except for ONE optional `newStartDate` parameter (backward-compatible)

## Scope decisions to confirm BEFORE coding (your call)

### Q1. Lease ID continuity on transfer (recommendation: fresh id)

- (a) **Fresh `CONTRACT_{ts}_{newRoom}` ID** for the new lease, linked to old via `priorLeaseId` + `transferredFromLeaseId`. Matches renewLease pattern. ⭐ recommended
- (b) **Keep old leaseId** under the new room key (rename). Cleaner if you think of lease-as-tenure rather than lease-as-contract, but breaks the immutable-id invariant.
- (c) **Same id, suffix with `-T1`/`-T2`** for transfer count. Visible chain but ugly.

### Q2. Combined transfer-with-endDate-change (recommendation: sequential CFs)

- (a) **Composite UI fires 2 CFs in sequence** — `transferTenant` first (room change, same endDate), then `renewLease` against new room with newEndDate. Each CF stays single-purpose, audit trail is two clear entries. ⭐ recommended
- (b) **Single `transferTenant` accepts optional `newEndDate`** — one atomic batch but balloons transferTenant scope; cousins to "god CF".
- (c) **New `transferAndRenew` CF** — third CF that wraps both. Triples test surface for a rare path.

### Q3. Tenant LIFF session impact on `token.room` change (recommendation: verify existing handling sufficient)

After transferTenant changes `token.room`, the tenant's cached LIFF ID token still points at the old room until refresh. Per §7-FF the CF MUST call `setCustomUserClaims + revokeRefreshTokens`. Question: does tenant_app's existing fast-path (which now uses `getIdTokenResult(true)` per 2026-05-20 night handoff) gracefully re-mint claims?

- (a) **Yes — same `unlinkLiffUser` pattern works for room change.** Verify by reading tenant_app `_callLiffSignIn`. If yes, no client change needed. ⭐ likely
- (b) **No — need explicit "your room changed, please reopen LINE" client toast.** Adds 30 min UI work to P3.

Will resolve in P1 spec phase by reading `_callLiffSignIn` + checking handoff `2026-05-20_liff_unlink_gate_complete.md`.

### Q4. Old-room vacancy timing on transfer (recommendation: immediate)

- (a) **Immediate vacate** — same Firestore batch clears old-room tenant doc + ends old lease + populates new-room tenant doc. Atomicity wins. Undo = call transferTenant again old↔new. ⭐ recommended
- (b) **24-hour "ย้ายไป..." badge** before vacate — admin can undo within window. Adds a state machine; new "transferring" status; cron sweep to flip to "vacant" after 24h.

### Q5. Cleanup of test tenant ทดสอบ ห้อง15 (your call — recommendation: keep)

Production currently has `tenants/rooms/list/15 = ทดสอบ ห้อง15` with 2 leases (one renewed, one active) from the 2026-05-21 evening verification.

- (a) **Keep as fixture** — exercise transferTenant against this same tenant in P3 (transfer ห้อง 15 → some vacant ห้อง, then back). Production already had 1 pre-existing orphan lease so adding 2 more for active testing is low cost. ⭐ recommended
- (b) **Clean now (P0)** — admin UI archive → `tools/fix-orphan-leases.js` for the ended leases. Removes "ทดสอบ" from prod data. Adds ~15 min before P1 starts.
- (c) **Clean AFTER sprint** — keep through P3 verification, archive at P7.

### Q6. Sprint phasing — ship all P1-P7 in one approval cycle, or split

- (a) **Single plan, ship all 7 phases** — fastest end-to-end. ⭐ recommended for momentum
- (b) **Split: approve P1-P4 (CF + tests + deploy + verify), then plan P5-P7 (UI + lifecycle doc) separately** — safer if user wants to inspect CF outcomes before committing to UI rebuild

---

## Phasing — 7 phases, ~5-7 sessions estimated

Each phase ends with a verifiable checkpoint. Mark complete only on green checkpoint.

### Phase 1 — Spec `transferTenant` CF ✅ DONE

- [x] **P1.1** Read `_callLiffSignIn` in `tenant_app.html` + `unlinkLiffUser` handling docs → resolve Q3
  → tenant_app.html:9765-9800. Fast-path uses `getIdTokenResult(true)` force-refresh; on `auth/user-token-expired` falls through to `liffSignIn` POST which re-mints fresh custom token. **Q3=(a) — no client changes needed**, server-side §7-FF three-leg is sufficient.
- [x] **P1.2** Write CF skeleton signature `transferTenant(building, oldRoomId, newBuilding, newRoomId, opts)` — see `functions/transferTenant.js`
- [x] **P1.3** State-write matrix embedded as CF JSDoc (lines 60-95) — variation + novation legs documented
- [x] **P1.4** Default mode = `variation` (per lifecycle § B vote)
- [x] **Checkpoint:** spec embedded as JSDoc; §7-DD matrix per-mode explicit; §7-FF claim-refresh helper isolated as `_updateLiffUserAndClaims`.

### Phase 2 — Implement `transferTenant` CF + unit tests ✅ DONE

- [x] **P2.1** `functions/transferTenant.js` created (920 LOC) — `_validateInput`, `_readTransferState`, `_runVariationMode`, `_runNovationMode`, `_updateLiffUserAndClaims` (§7-FF), `_writeAuditLog`, top-level `exports.transferTenant`
- [x] **P2.2** `functions/__tests__/transferTenant.test.js` created — 51 tests across 7 sprint groups (S1 auth+validation: 17, S2 state-read: 7, S3 variation: 7, S4 novation: 5, S5 claim-refresh: 7, S6 audit: 3, S7 integration: 3, plus 2 helper subtests)
- [x] **P2.3** Wired into `functions/index.js:107` (right after renewLease)
- [x] **P2.4** transferTenant tests: 51/51 green
- [x] **P2.5** Full functions suite: 324/324 green (273 baseline + 51 new) — zero regressions
- [x] **Checkpoint:** ALL 51 transferTenant tests pass; renewLease tests + full suite untouched/green.

### Phase 3 — Deploy + live-verify `transferTenant`

- [ ] **P3.1** From the MAIN repo (NOT worktree; `functions/node_modules` lives there): `firebase deploy --only functions:transferTenant` — region SE1
- [ ] **P3.2** Live verification via Chrome MCP — playbook:
  - Login as admin on https://the-green-haven.vercel.app
  - Pick a vacant target room (recommend: pick a Nest room or rooms 14/16/17 — verify vacant first via tenant page)
  - Open DevTools console; call `transferTenant` via `window.firebase.functions.httpsCallable('transferTenant')` with `{ building: 'rooms', oldRoomId: '15', newBuilding: 'rooms', newRoomId: '<chosen>', opts: { mode: 'variation' } }`
  - Verify 11 Firestore + Auth checks (mirror the renewLease verification table):
    - old `tenants/rooms/list/15` cleared (status='vacant', name='')
    - new `tenants/rooms/list/<chosen>` populated with carried identity
    - old lease `status` (variation: still `active`, novation: `transferred` + `transferredToLeaseId`)
    - new lease created (novation only) with `priorLeaseId`
    - `amendments[]` arrayUnion entry (variation only)
    - Auth `getUser(uid).customClaims.room === '<chosen>'`
    - RTDB `audit_logs/leases/{push}` entry with `action='tenant_transferred'`
    - tenant_app — close LIFF, reopen, verify room shown is now `<chosen>` (claim refresh worked per §7-FF)
- [ ] **P3.3** If all 11 green: §7-J probation CLOSED for transferTenant. Reverse-transfer (move ทดสอบ ห้อง15 back to ห้อง 15) for next session's fixture reuse.
- [ ] **P3.4** If anything red: rollback via reverse-transfer or `tools/fix-orphan-leases.js`; debug; re-deploy; retry. Do NOT proceed to P4 until P3 green.
- [ ] **Checkpoint:** transferTenant deployed; live-verified both modes; §7-J probation closed; test fixture restored to ห้อง 15.

### Phase 4 — Add optional `newStartDate` to renewLease (backward-compat)

- [ ] **P4.1** Edit `functions/renewLease.js` `_validateInput`:
  - Add optional `newStartDate` field — accept ISO string or null/undefined
  - When omitted: behavior unchanged (start = oldEndDate). When provided: validate it's a Date, validate `oldEndDate <= newStartDate < newEndDate`
- [ ] **P4.2** Edit `_runRenewalMode`:
  - Use `input.newStartDate || oldEndDate.toISOString()` as `startIso`
  - `contractMonths` computed from `(newEndDate - resolvedStart)` instead of `(newEndDate - oldEndDate)`
- [ ] **P4.3** Add 3 tests to `renewLease.test.js`:
  - validate accepts ISO newStartDate
  - validate rejects newStartDate that is before oldEndDate (would create gap-but-overlap)
  - validate rejects newStartDate ≥ newEndDate (zero or negative term)
  - renewal mode honors explicit newStartDate
- [ ] **P4.4** Run renewLease suite → green; run full suite → green
- [ ] **P4.5** Deploy: `firebase deploy --only functions:renewLease`
- [ ] **P4.6** Live verify via Chrome MCP — single test call with `newStartDate` set; verify new lease's `contractStart` matches input, not oldEndDate
- [ ] **Checkpoint:** renewLease accepts optional newStartDate; backward-compat preserved (calls without it behave identically); deployed; live-verified.

### Phase 5 — Composite UI: rebuild `shared/dashboard-lease-renew.js`

- [ ] **P5.1** Add room-toggle radio group at top of modal (above all existing inputs):
  - "📄 ต่อสัญญาห้องเดิม" (default — keeps existing renewLease flow)
  - "🚪 ย้ายไปห้องใหม่" (new — reveals room picker)
- [ ] **P5.2** Room picker (revealed when "ย้ายไปห้องใหม่" selected):
  - Building dropdown (sourced from `BuildingRegistry.list()`)
  - Room dropdown (sourced from `tenants/{building}/list/*` filtered by `status === 'vacant'` — pattern from `shared/dashboard-requests-admin.js:1445`)
  - Show selected room's rent/deposit/address as auto-fill preview (sourced from `buildings/{building}/rooms/{roomId}` registry where present, else lease-default)
  - Move-only checkbox: "🎯 ย้ายอย่างเดียว (ไม่เปลี่ยนวันสิ้นสุดสัญญา)" — if checked, hide newEndDate field + fire transferTenant ONLY
- [ ] **P5.3** Custom `newStartDate` field (always visible):
  - Default = oldEndDate (matches renewLease's current implicit behavior)
  - In transfer mode, defaults to `effectiveDate=today` and labeled "วันเริ่มที่ห้องใหม่"
- [ ] **P5.4** Inline contract upload widget (replaces existing text URL field):
  - File input → `<input type="file" accept=".pdf,.jpg,.png">`
  - On change: upload to `gs://...firebasestorage.../leaseDocuments/{building}/{roomId}/{timestamp}_{filename}` using existing pattern from `shared/dashboard-tenant-lease.js:859`
  - On success: store `contractDocument` (Storage path) + `contractFileName` for CF payload
  - Show upload progress + filename + 🗑️ remove button
- [ ] **P5.5** Submit handler dispatch:
  - Mode = "ห้องเดิม" (renewal/extension) → fire `renewLease` (existing path, with `newStartDate` if set)
  - Mode = "ห้องใหม่" + move-only → fire `transferTenant` only
  - Mode = "ห้องใหม่" + endDate changed → fire `transferTenant` first; on success, fire `renewLease` against `{building: newBuilding, roomId: newRoomId}`; on transferTenant failure → toast + abort; on renewLease-after-transfer failure → toast WITH NOTICE "ย้ายห้องสำเร็จแต่ต่อสัญญาไม่สำเร็จ — แก้ไขใน tenant modal" (transfer is the atomic op; the renewal is the second leg)
- [ ] **P5.6** Hard cap target: ≤ 600 LOC for `shared/dashboard-lease-renew.js` (currently 355). If exceeds, extract `_lrRoomPicker.js` helper. **No file-size override.**
- [ ] **P5.7** Pre-commit hook check: `npm run audit:size` shows the file within hard limits.
- [ ] **Checkpoint:** Modal opens; toggle works; room picker populates from vacant rooms; upload widget round-trips a file; both single-CF and dual-CF paths fire correctly on submit.

### Phase 6 — E2E: cover all 4 user paths against `ทดสอบ ห้อง15`

Use Chrome MCP. Each path is one verification cycle.

- [ ] **P6.1** Path A: Renew-same — open modal on ห้อง 15, leave toggle="ห้องเดิม", change endDate to 2029, submit → verify renewLease ran (new leaseId), tenant doc updated, audit log entry. Expected: §7-J test pattern from prior session.
- [ ] **P6.2** Path B: Extend-same — open modal, switch mode-radio to "extension", change endDate to 2029, submit → verify `extensions[]` arrayUnion entry, same leaseId, no new lease doc.
- [ ] **P6.3** Path C: Transfer-only — open modal, toggle="ย้ายไปห้องใหม่", pick vacant room (e.g. ห้อง 17), check "ย้ายอย่างเดียว", submit → verify transferTenant ran, old room cleared, new room populated, claims re-minted (admin tab inspect), NO new lease (variation).
- [ ] **P6.4** Path D: Transfer+renew — start from path-C end state, open modal on ห้อง 17, toggle="ย้ายไปห้องใหม่", pick ห้อง 15 (now vacant), change endDate to 2030, submit → verify transferTenant ran first (audit entry), then renewLease ran against ห้อง 15 (audit entry), both legs visible in `audit_logs/leases/`.
- [ ] **Checkpoint:** all 4 paths verified live. Each Firestore + Auth + RTDB write inspected via Chrome MCP javascript_tool. Zero console errors.

### Phase 7 — Memory + doc updates

- [ ] **P7.1** Update [lifecycle_tenant_transitions.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_transitions.md):
  - Move § B from "Missing transitions" → "Existing transitions" table
  - Update Prioritisation list (B done; A becomes next #1)
  - Add `transferTenant` verifier to ## Verification grep block
- [ ] **P7.2** Update MEMORY.md 🎯 Current state — add a `next_session_handoff_2026_05_<date>_transfertenant_shipped.md` entry; demote 2026-05-21 evening (5) entry one slot
- [ ] **P7.3** If §7-J probation closed for transferTenant via P3.3 — link in `next_session_handoff_*.md`
- [ ] **P7.4** Run `npm run verify:memory` — must exit 0 before commit
- [ ] **P7.5** Pre-commit hook self-test on the touched memory files: passes
- [ ] **P7.6** Commit per type: `feat(transferTenant): CF + admin UI for room-change (Plan B)` — one commit per phase if granularity helps, else single bundle
- [ ] **P7.7** Push to origin/main; Vercel auto-deploys
- [ ] **Checkpoint:** docs + memory in sync; verify:memory green; everything pushed.

---

## Files Touched (estimated)

| File | Action | Est LOC |
|---|---|---|
| `functions/transferTenant.js` | NEW | ~450 |
| `functions/__tests__/transferTenant.test.js` | NEW | ~600 (25 tests) |
| `functions/renewLease.js` | MODIFY (add optional newStartDate) | +~40 |
| `functions/__tests__/renewLease.test.js` | MODIFY (+3 tests) | +~80 |
| `functions/index.js` | MODIFY (add transferTenant export) | +1 |
| `shared/dashboard-lease-renew.js` | REWRITE (composite UI) | 355 → ~600 |
| `shared/building-registry.js` | LIKELY-NO-CHANGE (read-only consumer) | 0 |
| `lifecycle_tenant_transitions.md` | MODIFY (move B; update verifier) | +~30 |
| `MEMORY.md` | MODIFY (1 line in 🎯 + entry in handoff index) | +2 |
| NEW handoff | NEW `next_session_handoff_*.md` | ~80 |

Total: ~7 files, ~1,800 LOC net new + modified. Beyond the §1 Plan-First threshold of 5 files. **Plan-First mandatory** (already in plan-first per this file).

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Auth claim refresh fails silently after transfer | §7-FF three-leg in P2.1: `setCustomUserClaims` + `revokeRefreshTokens` + client `getIdTokenResult(true)` in P3.2 verification |
| §7-DD orphan lease drift | P2.1 batch includes lease-doc updates for both modes; P2.2 test asserts old-lease + new-lease state |
| Composite UI race when renewLease-after-transferTenant fails | P5.5 explicit toast distinguishes "ย้ายห้องสำเร็จแต่ต่อสัญญาไม่สำเร็จ" — admin can re-run renewLease against new room from tenant modal |
| File-size pre-commit hook blocks P5 | P5.6 hard cap 600 LOC; extract helper if exceeded |
| Production data left in inconsistent state by botched P3 | P3.4 explicit rollback via reverse-transfer + `tools/fix-orphan-leases.js` |
| Test data `ทดสอบ ห้อง15` polluted further | Q5 default keeps as fixture; final cleanup in P7 if desired |
| `_callLiffSignIn` doesn't gracefully handle room-change | P1.1 reads it before P2 implementation; if not, P3 adds explicit client refresh prompt |

## Pre-flight (before approving)

- [ ] User picks defaults for Q1-Q6 (or confirms recommendations)
- [ ] User confirms test data fixture decision (Q5)
- [ ] User confirms single approval vs split (Q6)

## Review

(To be filled at end of sprint per CLAUDE.md §1 Plan-First Protocol)
