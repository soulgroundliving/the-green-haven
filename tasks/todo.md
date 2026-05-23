# Pet ecosystem prerequisites — Storage cleanup + collectionGroup filter

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Previous plan:** Plan B' (per-room occupancyLog) — SHIPPED + LIVE-VERIFIED 2026-05-21 evening (7).
This file overwrites that plan.

**Triggered by:** Pet ecosystem feature exploration 2026-05-23 (turn 1-4). User asked to
audit the existing pets feature before extending it. The audit (turn 4) discovered the
real prerequisite gaps — smaller than my turn-3 framing claimed.

---

## Context revision (mea culpa, transparency)

**Turn 3 claim that was WRONG:** "§7-DD orphan pets bug is LIVE — `archiveTenantOnMoveOut`
doesn't touch the `pets` subcollection, new tenants will see old tenant's pets."

**Reality (verified turn 4 by Reading the 3 CFs end-to-end):**
- `'pets'` IS in `ARCHIVED_SUBCOLLECTIONS` for [archiveTenantOnMoveOut.js:65-71](functions/archiveTenantOnMoveOut.js:65), [transitionToPlayer.js:37-39](functions/transitionToPlayer.js:37), [revertTransitionToPlayer.js:50-52](functions/revertTransitionToPlayer.js:50)
- The §7-DD fix shipped 2026-05-20 (commit `7fb9bfc`) already migrates pet Firestore
  docs to `tenants/{b}/archive/{contractId}/pets/{petId}` on archive

**What actually remains broken (verified via grep + Read):**

| Gap | Evidence | Impact |
|-----|----------|--------|
| Storage files orphan forever | [tenant_app.html:6678](tenant_app.html:6678) writes `pets/{b}/{r}/{petId}/{kind}_{ts}.{ext}`; no 3 CF reads `admin.storage()` | Quota cost + PDPA |
| collectionGroup('pets') picks up archived pets | [shared/dashboard-tenant-lease.js:1210](shared/dashboard-tenant-lease.js:1210) `fs.collectionGroup(db, 'pets')` with NO path filter; [firestore.rules:305-316](firestore.rules:305) allows admin read of archive subcoll | Admin queue noise + insights overcount |
| Insights pet count inflates each move-out | [shared/dashboard-insights.js:1033](shared/dashboard-insights.js:1033) same collectionGroup, no filter, line 1108 sums all statuses | Wrong KPI |
| Storage read = any signed-in user | [storage.rules:28](storage.rules:28) `allow read: if isSignedIn();` | PII leak: new tenant of room 15 → reads old tenant's pet vaccine book if they enumerate petId |
| `removePetApproval` doesn't clean Storage | [shared/dashboard-tenant-lease.js:1314-1322](shared/dashboard-tenant-lease.js:1314) `_deletePetFromFirestore` deletes doc only | Admin manual delete leaks Storage |

**These are NOT showstoppers for Phase 1 pet features.** They're hygiene/cost/privacy gaps
that compound over time. Acceptable to defer if user wants velocity > cleanliness — but
shipping vaccine reminder now and leaving Storage leak means more orphans to clean up later.

---

## Design criteria

1. **Minimal blast radius** — each phase ships independently, each commit reviewable
2. **No production data action without user click** — migration script has `--apply` gate per §7-I
3. **§7-DD analogue for Storage** — every lifecycle CF that archives Firestore pet docs must
   also handle Storage symmetrically
4. **§7-T discipline** — every collectionGroup reader must agree with the writer on what
   counts as "live"

---

## Phase A — Storage cleanup on lifecycle transitions (~2 days) ✅ COMPLETE

- [x] **A1.** Create `functions/_petStorage.js` — helper module exporting
      `async function deletePetStorageForRoom(building, roomId, { reason })`.
      Lists `pets/{building}/{roomId}/` prefix via Admin Storage SDK `getFiles({ prefix })`,
      bulk-deletes via `bucket.deleteFiles({ prefix, force: true })`. Returns
      `{ deletedCount, errors }`. Logs each deletion + accumulates non-fatal errors.

      **Why:** all 3 CFs need it; centralizing matches `_occupancyLog.js` extraction pattern (Plan B' precedent). No CFs currently touch Storage — helper is greenfield.

- [x] **A2.** Call helper from [archiveTenantOnMoveOut.js](functions/archiveTenantOnMoveOut.js) **AFTER** `batch.commit()` succeeds.
      Fire-and-forget with `.catch(e => console.error(...))`. Append `storageDeleted: count`
      to the return object.

      **Why:** Storage isn't part of Firestore batch — must be post-batch. Archive batch is the
      canonical record; transient Storage error must not lose the Firestore archive (§7-DD
      lesson: don't let a sibling system's failure block the main transaction).

- [x] **A3.** Decide: call helper from [transitionToPlayer.js](functions/transitionToPlayer.js)?

      **Recommendation: NO.** Reasons:
      - `transitionToPlayer` is reversible via `revertTransitionToPlayer` — deleting Storage
        on transition means revert can't restore pet photos
      - Player → tenant revert flow is the kin operation; Storage stays = round-trip works
      - PII concern (new tenant of same room reads old player's photos) is solved by Phase C
        Storage rule tightening, not by deletion

      **Alternative (if reverse risk preferred):** delete on transition too, accept that revert
      shows "📷 รูปถูกลบในตอน archive" placeholder. Need user input.

- [x] **A4.** `revertTransitionToPlayer.js` — no change needed (Storage was kept on transition,
      Firestore restore from archive subcoll already works). Add comment noting the asymmetry
      so a future contributor doesn't "fix" it.

      **Why:** §7-DD code comment discipline — preserve the WHY for next session.

- [x] **A5.** Unit test in `functions/__tests__/_petStorage.test.js` — mock `admin.storage()`,
      assert prefix matches `pets/{b}/{r}/` exactly (no leakage to other rooms via partial-
      prefix match like `pets/rooms/1/` matching `pets/rooms/15/`).

      **Why:** §7-DD analogue test. Prefix-bug class is real (`pets/rooms/1` is a prefix of
      `pets/rooms/15`); must use trailing-slash terminator.

## Phase B — collectionGroup filter (~½ day) ✅ COMPLETE

- [x] **B1.** [shared/dashboard-tenant-lease.js:1212-1216](shared/dashboard-tenant-lease.js:1212) — filter `snap.docs` to exclude paths containing
      `/archive/` segment. Add explicit reject log so future drift is visible:

      ```js
      _petsFromFirestore = snap.docs
        .filter(d => {
          const parts = d.ref.path.split('/');
          // tenants/{b}/list/{r}/pets/{id} → parts[2] === 'list' (live)
          // tenants/{b}/archive/{cid}/pets/{id} → parts[2] === 'archive' (skip)
          return parts[2] === 'list';
        })
        .map(d => { /* existing */ });
      ```

      **Why:** §7-T (writer/reader drift) — admin queue current behaviour shows archived pets
      with `room: contractId` because parts[3] is contractId in archive path. Filter by path
      segment is more robust than filter by status field (status survives archive intact).

- [x] **B2.** [shared/dashboard-insights.js:1102-1108](shared/dashboard-insights.js:1102) — same path filter applied to `petsSnap.forEach`.

      **Why:** "totalPets" KPI currently inflates by every move-out. Insights MUST agree with
      admin queue on what counts as live.

- [x] **B3.** [shared/dashboard-tenant-lease.js:1314-1322](shared/dashboard-tenant-lease.js:1314) `_deletePetFromFirestore` — also call a new
      `_deletePetStorage(building, room, id)` client-side helper that calls a new CF
      `deletePetMedia` (admin-only callable) that wraps the same `_petStorage.js` helper
      scoped to one petId.

      **Why:** §7-K (defined ≠ wired) — admin "🗑️ Remove" deletes Firestore doc but leaks
      Storage. Symmetric cleanup. CF wrapper because Storage delete from client can't be
      claim-scoped reliably (rules can't gate by petId existence in Firestore).

## Phase C — Storage rule tightening + migration (~1 day) ✅ COMPLETE (C3 downgraded)

- [x] **C1.** [storage.rules:28](storage.rules:28) — tighten read from `allow read: if isSignedIn()` to
      claim-matched:

      ```
      allow read: if isAdmin() || (isSignedIn() &&
        request.auth.token.room == room &&
        request.auth.token.building == building);
      ```

      Tenant SDK does not need cross-room pet read — they only render their own. Admin queue
      uses Firestore `photoURL` field (download tokens), not direct Storage access.

      **Why:** prevents new-tenant-of-room-15 enumerating old tenant's vaccine book PDF.
      Storage rules can't do Firestore lookup — token claims directly is the only option.

- [x] **C2.** New `tools/cleanup-orphan-pet-storage.js` — template = [tools/cleanup-test-leases.js](tools/cleanup-test-leases.js).
      - Lists ALL Storage objects under `pets/` prefix via Admin SDK
      - Cross-references with live `collectionGroup('pets')` Firestore query (live path only)
      - Reports orphans: `{building, room, petId, files[], sizeBytes}`
      - Dry-run by default; prints preview table + total bytes to reclaim
      - `--apply` gate per §7-I — exits with `Skipping. Re-run with --apply.` unless flag set
      - When applied: deletes one room's prefix per call, prints `[deleted] pets/{b}/{r}/{petId}/`
        for each + final summary

      **Why:** existing accumulated orphans from past archives (before A1-A2 ships) need
      one-shot cleanup. Will not run automatically — user invokes with `--apply` after
      reviewing dry-run output.

- [~] **C3.** ~~`npm run test:rules` — verify Storage rule tightening~~ **DOWNGRADED**:
      `firestore.rules.test.js` covers Firestore rules only; no `storage.rules.test.js`
      infrastructure exists. Adding new test infrastructure was out of scope for the
      "minimal blast radius" approach. Instead:
      - Firestore rules test still runs unchanged (no regression risk)
      - Storage rule verified via the Verification block below (Chrome MCP live smoke)
      - If a future sprint adds `@firebase/rules-unit-testing` for Storage, port the
        recommended cases: (a) tenant of room 13 reading `pets/rooms/15/...` → DENY,
        (b) admin reading any → ALLOW, (c) tenant reading own room → ALLOW.

## Verification (per CLAUDE.md §5)

- [ ] `pwd && git branch --show-current` — must be `claude/elated-swirles-c51815` worktree, NOT main (per [feedback_branch_before_firebase_deploy.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_branch_before_firebase_deploy.md))
- [ ] `npm run test:rules` after C1 — rules CI green
- [ ] `npm test functions/__tests__/_petStorage.test.js` after A5 — unit test green
- [ ] `firebase deploy --only functions:archiveTenantOnMoveOut` from worktree branch
- [ ] `firebase deploy --only storage` after C1
- [ ] Live smoke test via Chrome MCP (per [feedback_use_chrome_mcp.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_use_chrome_mcp.md)):
   1. Tenant in room 15 (LIFF) uploads test pet → see in admin queue
   2. Admin approves → tenant sees ✅ status
   3. Admin archives tenant → pet disappears from queue + Storage files gone (check Firebase Console > Storage > `pets/rooms/15/{petId}/`)
   4. New tenant moves into room 15 → pet list empty in their tenant_app
   5. Admin tries to enumerate old petId via direct Storage URL → 403 (Phase C in effect)
- [ ] `npm run verify:memory` — pre-commit hook runs this; must exit 0
- [ ] Update [lifecycle_pets_registration.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_pets_registration.md) — add Storage cleanup section + collectionGroup
      live-path-only contract + update Failure modes table

## Deferred to future sprints (NOT in this Plan)

- **Phase 1 pet features** (vaccine reminder CF, pet profile expansion, building petPolicy
  metadata, admin queue UX polish) — waiting on prerequisites
- **Phase 2** (lost & found, incident report tag, pet policy in lease signing)
- **Phase 3** (pet zone booking, partner directory)

## Files touched

| File | Phase | Type |
|------|-------|------|
| `functions/_petStorage.js` | A1 | NEW |
| `functions/__tests__/_petStorage.test.js` | A5 | NEW |
| `functions/archiveTenantOnMoveOut.js` | A2 | EDIT (~10 lines) |
| `functions/transitionToPlayer.js` | A4 | EDIT (comment only) |
| `functions/deletePetMedia.js` | B3 | NEW (small CF) |
| `functions/index.js` | A1,B3 | EDIT (exports) |
| `shared/dashboard-tenant-lease.js` | B1,B3 | EDIT (~15 lines) |
| `shared/dashboard-insights.js` | B2 | EDIT (~5 lines) |
| `storage.rules` | C1 | EDIT (3 lines) |
| `tools/cleanup-orphan-pet-storage.js` | C2 | NEW |
| `~/.../memory/lifecycle_pets_registration.md` | Verify | UPDATE |

11 files, ~3.5 days estimated.

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Storage delete irreversible | Migration script `--apply` gate + dry-run shows full list (§7-I); A2/A3 fire-and-forget so a Storage hiccup doesn't lose Firestore archive |
| Storage rule tightening breaks LIFF claim shape | Run `npm run test:rules` BEFORE deploy; existing tenant upload already uses these claims for write rule (line 31-32) so read uses same shape |
| collectionGroup filter masks future legit drift | Add `console.warn` if `parts[2] !== 'list' && parts[2] !== 'archive'` — surfaces unexpected paths |
| Prefix bug (`pets/rooms/1` matches `pets/rooms/15`) | A5 test explicitly asserts trailing-slash; helper signature takes `(building, roomId)` not raw prefix |
| Memory doc drift | Verify step updates `lifecycle_pets_registration.md` same session as code change |

## Open decisions for user

1. **A3 — Storage cleanup on `transitionToPlayer`?** Recommend NO (preserves revert
   round-trip), but if you prefer full PII cleanup on every archive path, say so.
2. **Sprint sequencing** — A → B → C as written, or B first (smallest, lowest risk,
   ships filter immediately to stop insights drift), then A, then C?
3. **Deploy timing** — ship all 3 phases as one PR + one deploy window, or 3 separate
   commits + 3 deploys for safer rollback?

---

# Review (2026-05-23 evening)

## Shipped

12 files touched per the plan's "Files touched" table. All Phase A + B items + C1 + C2 complete; C3 downgraded (no Storage rules test infrastructure existed — not in scope per "minimal blast radius").

### Phase A — Storage cleanup on archive
- ✅ `functions/_petStorage.js` (NEW) — exports `deletePetStorageForRoom` + `deletePetStorageForPet`. Trailing-slash prefix discipline + per-file `Promise.allSettled` + shape guards
- ✅ `functions/__tests__/_petStorage.test.js` (NEW) — 11 tests, all green (prefix discipline, partial failure tolerance, programmer-error guards)
- ✅ `functions/archiveTenantOnMoveOut.js` — post-batch fire-and-forget call to helper; new return fields `archivedPetStorageFiles` + `petStorageErrors`
- ✅ `functions/transitionToPlayer.js` — comment-only (intentional NOT-called, see §7-DD comment)
- ✅ `functions/revertTransitionToPlayer.js` — comment-only (asymmetry explained)

### Phase B — collectionGroup live-path filter
- ✅ `shared/dashboard-tenant-lease.js:1210` — `.filter()` excludes archive paths; unexpected paths logged via `console.warn`
- ✅ `shared/dashboard-insights.js:1102` — same path filter on KPI counter
- ✅ `functions/deletePetMedia.js` (NEW) — admin-only callable, Firestore doc + Storage cleanup in one call
- ✅ `functions/index.js` — exports `deletePetMedia`
- ✅ `shared/dashboard-tenant-lease.js` — `removePetApproval` rewired to call CF via `httpsCallable`; dead `_deletePetFromFirestore` removed (§7-K cleanup)

### Phase C — Rule tighten + migration
- ✅ `storage.rules:27-35` — pets read tightened from `isSignedIn()` to claim-match (`token.room` + `token.building`)
- ✅ `tools/cleanup-orphan-pet-storage.js` (NEW) — Firebase Admin SDK script; lists Storage `pets/**`, cross-refs `collectionGroup('pets')` LIVE-only, prints orphan table by group, dry-run default, `--apply` gate per §7-I

### Verification artifacts (per CLAUDE.md §5)
- ✅ `npm test` — 387/387 pass
- ✅ `npm run verify:memory` — 34 docs / 332 verifier rows / 0 fails
- ✅ `lifecycle_pets_registration.md` updated: Storage trust boundary table, lifecycle cleanup matrix, live-path discipline section, 4 new failure-mode rows, 4 new verifier-row grep commands

## Deferred (NOT in this sprint)

- **`firebase deploy`** — pending user TIER-1 review of the diff before deploy. Per [feedback_branch_before_firebase_deploy.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_branch_before_firebase_deploy.md): MUST verify branch + worktree before `firebase deploy --only functions:archiveTenantOnMoveOut,deletePetMedia` + `firebase deploy --only storage`
- **Live Chrome MCP smoke test** — pending deploy. Steps in tasks/todo.md "Verification" block above
- **`tools/cleanup-orphan-pet-storage.js --apply`** — pending dry-run review then user-triggered (§7-I)
- **Storage rules CI infrastructure** — if a future sprint adds `@firebase/rules-unit-testing` for Storage, port the 3 test cases from C3 downgrade note
- **Phase 1 pet features** (vaccine reminder, pet profile expansion, building petPolicy) — prerequisites now landed; these can proceed in their own sprint

## Follow-ups for next session

1. **Open PR** from `claude/elated-swirles-c51815` worktree branch. Title suggestion: `feat(pets): Storage cleanup on archive + collectionGroup live-path filter + read rule tighten`. The PR description should pull the "Why" from each Phase + link the failure-mode table additions in lifecycle_pets_registration.md
2. **Deploy sequence** (after PR merge):
   - `firebase deploy --only functions:archiveTenantOnMoveOut,deletePetMedia` (asia-southeast1)
   - `firebase deploy --only storage` (rule tightening)
3. **Live smoke** via Chrome MCP — 5-step test in Verification block of this file
4. **Run orphan cleanup** — `node tools/cleanup-orphan-pet-storage.js` (dry-run), show output to user, then `--apply` after approval
5. **Phase 1 pet features sprint** — vaccine reminder CF + pet profile expansion + petPolicy metadata can start once orphan cleanup + smoke test sign off

## Lessons logged this session

- **Mea culpa on turn 3** — claimed §7-DD orphan-pets bug LIVE without reading the 3 CFs. Actual gap was Storage-side, smaller. The audit step (turn 4) caught it before any code change. Reinforces §7-O / verify-via-grep / "audit feature ที่มีก่อน" as the discipline. Already captured in CLAUDE.md §7-K wording; no new anti-pattern needed.
- **`collectionGroup` cousin of §7-T** — sub-collection name match across live + archive paths is a writer/reader drift class. Documented in `lifecycle_pets_registration.md` "live-path discipline" section. May warrant promotion to CLAUDE.md §7-II if it recurs in another collection (e.g. `redemptions/` if ever archived).

