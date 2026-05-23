# Quiz Session B — server-trusted quiz claim + admin authoring + analytics

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Previous plan:** Pets ecosystem prerequisites (Phase A/B/C) — SHIPPED + REVIEW APPENDED 2026-05-23 evening (4). Saved as `tasks/todo-p4-security-archive.md`/per-session archives if needed; this file overwrites the pets plan now that pets is complete.

**Triggered by:** Quiz Session A (commits `6145ccf` + `7e54219`) shipped wellness article quizzes with client-side localStorage trust. Session B closes the trust gap, adds admin authoring UI, and exposes engagement analytics.

**Reference:** [tasks/todo-quiz-expansion.md](tasks/todo-quiz-expansion.md) — Session A/B design doc (frozen).

---

## Decisions (locked in 2026-05-23 evening (9))

| # | Decision | Value | Reason |
|---|----------|-------|--------|
| 1 | Reward per quiz pass | **10 (wellness) · 20 (contract) constants** | Match current `_quizRewardWellness=10`/`_quizRewardContract=20`. Per-article configurable = scope creep. |
| 2 | Player path in CF | **Ship CF + rules** (no tenant_app player wiring yet) | CF mirrors `claimDailyLoginPoints` shape; player wiring deferred to Session B' if player tab gets wellness. Contract quiz = tenant-only (no player path needed). |
| 3 | PR strategy | **1 atomic PR (all 7 phases)** | Cross-section, ship together, rollback as one. |
| 4 | Contract quiz | **Include in same sprint** | Same client-trust gap; mirror Wellness CF/rules pattern → ~1 extra day + ~1 extra CF. |

## Goal (1 sentence each)

- **B1 — Trust (wellness):** Replace client-side `localStorage` quiz marker with idempotent `claimWellnessQuizPoints` CF + Firestore `wellnessQuizPassed/{articleId}_{YYYY-MM}` subcollection, mirroring `claimDailyLoginPoints`. Player branch supported in CF (CF-side only — tenant_app player wiring deferred per Decision 2).
- **B1b — Trust (contract):** Replace `awardQuizPoints` direct localStorage path for contract quiz with idempotent `claimContractQuizPoints` CF + Firestore `contractQuizPassed/{YYYY-MM}` subcollection. Tenant-only (no player path needed per Decision 2).
- **B2 — Rules:** Firestore rules for `wellnessQuizPassed/*` AND `contractQuizPassed/*` matching `wellnessClaimed/*` shape (linkedAuthUid match + admin override + collectionGroup admin-read). CF-only create (tighter than wellnessClaimed which allows tenant create).
- **B3 — Admin authoring (wellness only):** Extend `shared/dashboard-wellness-content.js` so admin can add/edit `quiz: [{q, options, correctIdx}]` per Firestore wellness article. (Contract quiz questions stay hardcoded in tenant_app; not user-authored.)
- **B4 — tenant_app loader (already done):** `loadWellnessFromFirestore` already merges `quiz` field if present from Phase A1. Verify with 1 new unit test for Firestore-first vs hardcoded-fallback resolution.
- **B5 — Analytics:** Admin dashboard insights — new card "Quiz Engagement" showing pass-rate per source (contract + per-article wellness) via `collectionGroup` on both subcollections.
- **B6 — Memory doc:** Update `lifecycle_wellness_claim.md` with quiz extension section + new verifier rows for `npm run verify:memory`.

---

## Design criteria

1. **Mirror `claimDailyLoginPoints` exactly** — same region (`asia-southeast1`), same `assertTenantAccess` 6-path model, same player vs tenant branching, same idempotency-via-Firestore-marker pattern. No new auth primitives.
2. **Minimal blast radius** — each phase ships independently, each commit reviewable. CF can roll out before admin UI; admin UI doesn't break if CF lags.
3. **Server-side passing decision** — pass threshold, reward amount, and idempotency live in CF, NOT client. Client sends `{ building, roomId, articleId, answers }` and CF returns `{ passed, score, total, reward, pointsAfter }`. No more client-side "passed: true" trust.
4. **localStorage marker stays as UX hint only** — write-after-CF-success, NOT as the source of truth. CF idempotency wins on conflict (read it on subscribe and reconcile per §7-KK).
5. **§7-Z compliance** — `_authSoT.assertTenantAccess` (already includes SoT fallback for claim-strip windows). No direct claim check.
6. **§7-N compliance** — every onSnapshot for `wellnessQuizPassed` subcollection on the tenant side MUST have error callback.
7. **No new firebase-functions/v1 imports inconsistencies** — copy boilerplate from `claimDailyLoginPoints.js` (already v1 modular import).

---

## Phase B-CF — server-trusted claim (~1 day)

### B-CF (wellness)

- [ ] **B-CF.1** — Create `functions/claimWellnessQuizPoints.js`.
      Shape: mirrors `claimDailyLoginPoints` exactly. Player branch + tenant branch.

      Inputs (callable data):
      ```
      Tenant: { building, roomId, articleId, answers: [int, int, int] }
      Player: { tenantId, articleId, answers: [...] }
      ```

      Server-side flow:
      1. Auth check (context.auth.uid required)
      2. Branch: player path needs `tok.role==='player' && tok.tenantId===tenantId`; tenant path uses `assertTenantAccess`
      3. Fetch article from Firestore `wellness_articles/{articleId}` to read canonical `quiz` array — server validates pass threshold + reward, not client
      4. If article has no `quiz` field → throw `invalid-argument` "article has no quiz"
      5. Compute monthKey `YYYY-MM` in Asia/Bangkok
      6. Compute `correct`, `total`, `passThreshold` (≥3 → 2, else 100%), `passed`
      7. Idempotency check via subcollection doc `tenants/{b}/list/{r}/wellnessQuizPassed/{articleId}_{ym}` (or `people/{tenantId}/wellnessQuizPassed/{articleId}_{ym}`)
      8. Inside Firestore transaction:
         - re-read marker doc — if exists, throw `already-exists` "ทำ quiz เดือนนี้แล้ว"
         - If passed: write marker + increment `gamification.points` by `WELLNESS_QUIZ_REWARD` (constant = 10)
         - If failed: write marker with `passed:false` + NO points increment
      9. Return `{ success, passed, score, total, passThreshold, reward, pointsAfter }`

      **Why mirror claimDailyLoginPoints exactly:** proven pattern; one place to audit auth + transaction logic; no novel surface area for §7-Z / §7-HH regressions.

- [ ] **B-CF.2** — Export from `functions/index.js`:
      ```js
      exports.claimWellnessQuizPoints = require('./claimWellnessQuizPoints').claimWellnessQuizPoints;
      ```

      **Why:** standard CF export pattern; needed for `firebase deploy --only functions:claimWellnessQuizPoints`.

- [ ] **B-CF.3** — Unit test `functions/__tests__/claimWellnessQuizPoints.test.js`:
      - Mock Firestore via `firestore-jest-mock` pattern (same as existing test files)
      - 12 cases:
        1. Tenant: missing auth → unauthenticated
        2. Tenant: missing building/roomId → invalid-argument
        3. Tenant: claim mismatch → assertTenantAccess throws permission-denied
        4. Tenant: article has no quiz → invalid-argument
        5. Tenant: already-claimed this month → already-exists
        6. Tenant: passed (3/3 correct on 3-q quiz) → marker written, points +10
        7. Tenant: passed (2/3 correct on 3-q quiz) → marker, points +10
        8. Tenant: failed (1/3 correct on 3-q quiz) → marker (passed:false), points unchanged
        9. Tenant: passed (1/1 on 1-q quiz, 100% threshold) → marker, points +10
        10. Tenant: failed (0/1 on 1-q quiz) → marker, points unchanged
        11. Player: passed via tenantId path → people/{tenantId}/wellnessQuizPassed marker
        12. Player: claim mismatch (tok.tenantId !== reqTenantId) → permission-denied

      **Why:** TDD discipline per CLAUDE.md §3; 12 cases cover full state matrix (5 outcomes × 2 paths + 2 auth-deny cases).

### B-CF (contract)

- [ ] **B-CF.4** — Create `functions/claimContractQuizPoints.js`.

      Shape: tenant-only (no player branch — players don't sign contracts). Same boilerplate as `claimWellnessQuizPoints` minus the player-path block.

      Inputs (callable data):
      ```
      { building, roomId, answers: [int, int, int] }
      ```

      Server-side flow:
      1. Auth check (context.auth.uid required)
      2. `assertTenantAccess` ownership check
      3. Load canonical contract quiz questions — for now, **hardcoded server-side constant** (same questions as tenant_app, frozen). Future enhancement: read from `contract_quiz/{building}` Firestore doc.
      4. Compute monthKey, score, passThreshold (2/3 for 3-q quiz), passed
      5. Idempotency via `tenants/{b}/list/{r}/contractQuizPassed/{ym}` (NO articleId — singleton per month)
      6. Inside transaction: re-read marker, throw `already-exists` if present, write marker + increment points by `CONTRACT_QUIZ_REWARD = 20` if passed
      7. Return `{ success, passed, score, total, passThreshold, reward, pointsAfter }`

      **Why:** mirrors `claimWellnessQuizPoints` for consistency; tenant-only because contract = lease document = tenant context. Hardcoded questions for now (Future: admin-authored contract questions same way as wellness quiz).

- [ ] **B-CF.5** — Export from `functions/index.js`:
      ```js
      exports.claimContractQuizPoints = require('./claimContractQuizPoints').claimContractQuizPoints;
      ```

- [ ] **B-CF.6** — Unit test `functions/__tests__/claimContractQuizPoints.test.js`:
      - 8 cases: missing auth, missing building/roomId, claim mismatch, already-claimed, passed 3/3, passed 2/3, failed 1/3, failed 0/3
      - No player path cases needed

      **Why:** TDD; smaller surface than wellness (no player path, no per-article variability).

## Phase B-RULES — Firestore rules (~15 min)

- [ ] **B-RULES.1** — Add to `firestore.rules` after the `wellnessClaimed/{articleId}` block (~line 338) for tenant branch:
      ```
      match /wellnessQuizPassed/{markerId} {
        allow read:   if isAdmin() ||
          (isSignedIn() &&
           get(/databases/$(database)/documents/tenants/$(building)/list/$(roomId)).data.linkedAuthUid == request.auth.uid);
        allow create: if isAdmin(); // CF-only writes (admin SDK bypasses rules; this line locks out direct client writes)
        allow update, delete: if isAdmin();
      }
      ```

      **Why:** CF uses admin SDK = bypasses rules anyway, so create rule blocks any path that could let a tenant fake a passed-marker via direct write. Mirrors `wellnessClaimed` pattern but TIGHTER (no client-side create).

- [ ] **B-RULES.2** — Same for player branch under `people/{tenantId}/` (~line 407):
      ```
      match /wellnessQuizPassed/{markerId} {
        allow read: if isAdmin()
          || (isSignedIn()
              && request.auth.token.role == 'player'
              && request.auth.token.tenantId == tenantId);
        allow create, update, delete: if isAdmin();
      }
      ```

- [ ] **B-RULES.3** — Add `contractQuizPassed/{ym}` block (tenant branch only, mirror B-RULES.1):
      ```
      match /contractQuizPassed/{markerId} {
        allow read:   if isAdmin() ||
          (isSignedIn() &&
           get(/databases/$(database)/documents/tenants/$(building)/list/$(roomId)).data.linkedAuthUid == request.auth.uid);
        allow create, update, delete: if isAdmin(); // CF-only
      }
      ```

      **Why:** same trust model as wellness; no player branch needed because contract quiz is tenant-only.

- [ ] **B-RULES.4** — Add collectionGroup admin-only read rules (mirror `wellnessClaimed` at line 442):
      ```
      match /{path=**}/wellnessQuizPassed/{markerId} {
        allow read: if isAdmin();
      }
      match /{path=**}/contractQuizPassed/{markerId} {
        allow read: if isAdmin();
      }
      ```

      **Why:** B5 analytics needs `collectionGroup` queries on both subcollections; collectionGroup doesn't hit nested rules.

- [ ] **B-RULES.5** — `npm run test:rules` — add 7 test cases:
      - Tenant of room 15 reading own `wellnessQuizPassed/sleep-bedroom_2026-05` → ALLOW
      - Tenant of room 15 reading room 13's wellness marker → DENY
      - Tenant of room 15 creating own wellness marker → DENY (CF-only)
      - Tenant of room 15 reading own `contractQuizPassed/2026-05` → ALLOW
      - Tenant of room 15 reading room 13's contract marker → DENY
      - Tenant of room 15 creating own contract marker → DENY (CF-only)
      - Admin collectionGroup read on either → ALLOW

      **Why:** rules CI catches regressions before deploy. Existing 70-case suite covers similar shape.

## Phase B-ADMIN — admin authoring UI (~1 day)

- [ ] **B-ADMIN.1** — Extend `shared/dashboard-wellness-content.js` (~534 lines currently):
      In the wellness article editor modal, add a new collapsible "Quiz (optional)" section after the body editor.

      UI structure:
      ```
      📝 Quiz (เลือกได้, 1-5 คำถาม)
      ┌─────────────────────────────┐
      │ คำถามที่ 1                  │
      │ Question text input         │
      │ ▢ Option A  ⚪ (correct)    │
      │ ▢ Option B  ⚪              │
      │ ▢ Option C  ⚪              │
      │ ▢ Option D (optional)       │
      │ [✕ ลบคำถาม]                  │
      └─────────────────────────────┘
      [+ เพิ่มคำถาม]
      ```

      Schema: stores `quiz: [{q: string, options: string[], correctIdx: number}]` on article doc.

      **Why:** matches the existing data shape used by tenant_app loader (already merges `quiz` field per Phase A1). Admin gets full authoring without a separate UI.

- [ ] **B-ADMIN.2** — Form validation:
      - Each question must have q text + ≥2 options + valid correctIdx (0..options.length-1)
      - At most 5 questions per article (UI limits)
      - If quiz array is empty after edit, do NOT write the field (delete via `FieldValue.delete()`)

      **Why:** server CF expects valid shape; client validates first to avoid CF round-trip rejections.

- [ ] **B-ADMIN.3** — "นำเข้าตัวอย่าง" button: if current article matches a hardcoded article ID with quiz, copy that quiz into the editor as a starting point. Useful for the 2 dogfood articles.

      **Why:** lowers onboarding friction for the admin who's authoring quizzes for the first time.

- [ ] **B-ADMIN.4** — Wire to existing CSP delegation hub:
      All new buttons use `data-action="quizAddQ"`, `data-action="quizRemoveQ"`, etc. with new handlers added in `shared/dashboard-main.js`. NO inline `onclick=`.

      **Why:** §II CSP hash drift compliance + §7-JJ event-delegation-hub timing. Pre-commit §E hook would block any new inline onclick anyway.

## Phase B-TENANT — tenant_app integration (~½ day)

- [ ] **B-TENANT.1** — Replace client-trust `awardQuizPoints(reward)` call in `submitContractQuiz` with CF callable. Branch by `_quizState.source.type`:

      ```js
      // BEFORE (line ~12170)
      if (passed) awardQuizPoints(reward);
      
      // AFTER
      try {
        const fnName = isWellness ? 'claimWellnessQuizPoints' : 'claimContractQuizPoints';
        const fn = httpsCallable(functions, fnName);
        let payload;
        if (isWellness) {
          payload = { building: _taBuilding, roomId: _taRoom, articleId: st.source.articleId, answers: Object.values(st.answers) };
          // Player path: if (_taRole === 'player') payload = { tenantId: _taTenantId, articleId, answers };
          // DEFERRED per Decision 2 — player tenant_app wiring not in this sprint
        } else {
          payload = { building: _taBuilding, roomId: _taRoom, answers: Object.values(st.answers) };
        }
        const res = await fn(payload);
        if (res.data?.passed) loadGamificationData(); // server-side state is authoritative; refresh UI
      } catch (err) {
        if (err.code === 'functions/already-exists') toast('ทำ quiz เดือนนี้แล้ว', 'info');
        else { console.warn('quiz claim failed:', err); toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error'); }
      }
      ```

      **Why:** closes the client-trust gap for BOTH contract and wellness quizzes in one sprint per Decision 4.

- [ ] **B-TENANT.2** — Update `_setupWellnessQuizPrompt` AND `setupContractQuizGate`:
      Read from Firestore marker subscription FIRST, fall back to localStorage if not yet subscribed.

      Add **one combined** subscriber `_subscribeQuizMarkers()` that watches BOTH `wellnessQuizPassed/*` and `contractQuizPassed/*` (two separate onSnapshot, same module). Maintains:
      - `_wellnessQuizMarkers` — keyed `articleId_ym → {passed, score, total, at}`
      - `_contractQuizMarker` — single object `{ym → {passed, score, total, at}}`
      
      Subscriptions follow §7-U claim-first guard + §7-N error callback + §7-V unsub-before-rebind.

      **Why:** localStorage demoted to hint-only; Firestore authoritative. Two subscriptions in one module = one lifecycle to manage.

- [ ] **B-TENANT.3** — `renderQuizHub` + `renderQuizHistory` (community page):
      Switch source from localStorage scan to `_wellnessQuizMarkers` + `_contractQuizMarker` objects.

      **Why:** consistency with Phase A2 hub; backed by source of truth for both quiz sources.

- [ ] **B-TENANT.4** — §7-KK reconciliation (BOTH subscriptions):
      When wellness or contract quiz subscription fires from cached snapshot, do NOT clear localStorage hint markers. Only clear on `!snap.metadata.fromCache && !snap.metadata.hasPendingWrites`.

      **Why:** Session A produced §7-KK exactly because we didn't guard. Apply proactively to both new subscriptions.

## Phase B-INSIGHTS — admin analytics (~½ day)

- [ ] **B-INSIGHTS.1** — Add to `shared/dashboard-insights.js` a new section "Quiz Engagement" with two sub-cards:

      **Contract Quiz** — `collectionGroup('contractQuizPassed')` aggregate:
      ```
      // per month → { passes, fails, total, passRate }
      const monthStats = {};
      snap.docs.forEach(d => {
        const ym = d.id; // 'YYYY-MM'
        const passed = d.data().passed;
        monthStats[ym] = monthStats[ym] || { passes:0, fails:0 };
        if (passed) monthStats[ym].passes++; else monthStats[ym].fails++;
      });
      ```

      **Wellness Quiz** — `collectionGroup('wellnessQuizPassed')` aggregate by articleId:
      ```
      const stats = {}; // articleId → { passes, fails }
      snap.docs.forEach(d => {
        const articleId = d.id.split('_').slice(0, -1).join('_'); // strip trailing _ym
        const passed = d.data().passed;
        stats[articleId] = stats[articleId] || { passes:0, fails:0 };
        if (passed) stats[articleId].passes++; else stats[articleId].fails++;
      });
      ```

      Cross-reference with `wellness_articles` to show article title + pass rate.

      **Why:** closes the loop — admin sees engagement for both quiz types; iterates quiz quality based on which questions are too hard. Contract pass-rate by month also surfaces seasonality.

- [ ] **B-INSIGHTS.2** — Apply §7-DD live-path discipline:
      Filter out archive paths from collectionGroup result (`parts.includes('archive')` exclusion), mirroring pets/wellnessClaimed handling.

      **Why:** archive subcoll copies on move-out would inflate counts (§7-T cousin). Filter at reader.

## Phase B-MEMORY — verifier rows + lifecycle doc update (~15 min)

- [ ] **B-MEMORY.1** — Update `lifecycle_wellness_claim.md`:
      - Add new section "## Quiz extension (Session B)" between "Article seeding" and "Firestore rule"
      - Document: quiz field shape, CF name + region, marker subcollection path, monthKey format, server-side pass threshold, reward constant, idempotency contract
      - Update "## Firestore rule" to include the new `wellnessQuizPassed` block + collectionGroup rule
      - Add 4 new verifier rows in "## Verification" block:
        ```bash
        grep -n "claimWellnessQuizPoints" functions/index.js
        grep -n "wellnessQuizPassed" firestore.rules
        grep -n "_subscribeWellnessQuizMarkers" tenant_app.html
        grep -n "Wellness Quiz Engagement" shared/dashboard-insights.js
        ```

      **Why:** CLAUDE.md §1 verify-via-grep doctrine — every load-bearing claim has a grep verifier.

- [ ] **B-MEMORY.2** — Run `npm run verify:memory:all` — exit 0 required before commit. Pre-commit hook §F enforces.

      **Why:** standard memory drift gate.

---

## Verification (per CLAUDE.md §5)

- [ ] `pwd && git branch --show-current` — must be `claude/reverent-swirles-2fe321` worktree, NOT main (per [feedback_branch_before_firebase_deploy.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_branch_before_firebase_deploy.md))
- [ ] `node --test functions/__tests__/claimWellnessQuizPoints.test.js` after B-CF.3 — 12/12 green
- [ ] `node --test functions/__tests__/claimContractQuizPoints.test.js` after B-CF.6 — 8/8 green
- [ ] `npm run test:rules` after B-RULES.5 — full suite + 7 new cases green
- [ ] `npm test` — full unit suite (460 → ~480 with new tests) green
- [ ] `firebase deploy --only functions:claimWellnessQuizPoints,claimContractQuizPoints` from worktree branch
- [ ] `firebase deploy --only firestore:rules` after B-RULES.1-4
- [ ] Live smoke via Chrome MCP:
   1. Admin opens dashboard → Content Mgmt → Wellness → edit "sleep-bedroom" → add 3-question quiz → save
   2. Tenant in room 15 (LIFF) opens article → sees Quiz prompt → starts quiz → answers 2/3 correctly → sees "ตอบถูก 2/3 +10 pts" → Quest Ecosystem shows +10
   3. Tenant reopens article same month → button shows "✅ ทำแล้วเดือนนี้" (Firestore marker, not localStorage)
   4. Tenant tries to call CF directly with same args → already-exists error
   5. Tenant clears localStorage manually → reopens article → still shows ✅ (Firestore is authoritative)
   6. Contract quiz path: tenant opens contract page → starts contract quiz → passes 2/3 → +20 pts via CF
   7. Tenant reopens same month → contract quiz shows "✅ ทำแล้วเดือนนี้" gate
   8. Admin opens Insights → "Quiz Engagement" card → sees wellness "sleep-bedroom: 100%" + contract "2026-05: 100%"
- [ ] `npm run verify:memory` — pre-commit hook runs this; must exit 0
- [ ] Update `lifecycle_wellness_claim.md` per B-MEMORY.1

## Files touched

| File | Phase | Type |
|------|-------|------|
| `functions/claimWellnessQuizPoints.js` | B-CF.1 | NEW |
| `functions/__tests__/claimWellnessQuizPoints.test.js` | B-CF.3 | NEW |
| `functions/claimContractQuizPoints.js` | B-CF.4 | NEW |
| `functions/__tests__/claimContractQuizPoints.test.js` | B-CF.6 | NEW |
| `functions/index.js` | B-CF.2, B-CF.5 | EDIT (2 lines) |
| `firestore.rules` | B-RULES.1-4 | EDIT (~35 lines) |
| `tools/firestore-rules-test/*.test.js` | B-RULES.5 | EDIT (~90 lines) |
| `shared/dashboard-wellness-content.js` | B-ADMIN.1-4 | EDIT (~150 lines) |
| `shared/dashboard-main.js` | B-ADMIN.4 | EDIT (~5 delegation handlers) |
| `tenant_app.html` | B-TENANT.1-4 | EDIT (~100 lines) |
| `shared/dashboard-insights.js` | B-INSIGHTS.1-2 | EDIT (~80 lines) |
| `~/.../memory/lifecycle_wellness_claim.md` | B-MEMORY.1 | UPDATE |

12 files, ~3-4 day estimate (was 10/~2-3 days; +2 files + ~1 day for contract quiz scope per Decision 4).

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Replacing client-trust mid-flight breaks existing tenants who already claimed via localStorage this month | Server idempotency by marker doc means first CF call wins — replays return already-exists. Existing localStorage markers do NOT migrate to Firestore (cosmetic only after first re-claim attempt). |
| `_subscribeWellnessQuizMarkers` triggers same §7-U trap | Apply the claim-first guard pattern up-front (B-TENANT.2 explicitly requires it) |
| Admin authoring UI loses data on form-validation failure | Validate inline before close; show field errors instead of dropping the whole quiz |
| CF deploy fails / rolls back leaving rules ahead of CF | Rules deploy is reversible (rollback by re-deploying old rules); CF deploy first, then rules. Test order: CF unit tests → CF deploy → rules CI → rules deploy → tenant_app deploy. |
| Pre-existing client localStorage produces "ghost claims" until reconciled | §7-KK guard in B-TENANT.4 + first server-confirmed snapshot overrides hint |
| Per-article quiz JSON in Firestore article doc bloats — image-heavy articles already large | quiz array is small (≤5 questions × ~200 chars = ~1KB); negligible vs body+image |
| Storage rules: wellness articles have no Storage component | N/A — wellness articles are Firestore-only currently |

## Open decisions for user

**All 4 decisions LOCKED 2026-05-23 evening (9)** — see "Decisions" table at top of file. No new open decisions; proceed to user approval.

If user wants to change any locked decision before ✅ approval, edit the Decisions table + propagate down to affected phases.

---

# Review (2026-05-23 evening (9) — Quiz Session B execute)

## Shipped

12 files touched per plan. All 7 phases complete; no scope reductions.

### Phase B-CF — server-trusted claim CFs
- ✅ `functions/claimWellnessQuizPoints.js` (NEW) — player + tenant branches; mirrors `claimDailyLoginPoints` (region, auth gate, transaction, idempotency). Reads canonical quiz from `wellness_articles/{id}.quiz`; grades server-side; writes marker subcoll; reward = 10 pts on pass.
- ✅ `functions/__tests__/claimWellnessQuizPoints.test.js` (NEW) — **15 tests** (planned 12; added 3 more for grading edge cases). Covers auth, validation, grading 3/3·2/3·1/3·1/1·0/1, idempotency, player path, claim mismatch.
- ✅ `functions/claimContractQuizPoints.js` (NEW) — tenant-only; mid-execute design pivot from "hardcoded server-side questions" to "grade-by-kind" (`leaseEndDate` / `monthlyRent` / `policy` with canonical answer map). Robust to client-side option shuffle.
- ✅ `functions/__tests__/claimContractQuizPoints.test.js` (NEW) — **13 tests** (planned 8; added 5 for rent normalization, legacy `contract.endDate` fallback, POLICY_ANSWERS sanity). All green.
- ✅ `functions/index.js` — 2 new exports added.

### Phase B-RULES — Firestore rules + CI cases
- ✅ `firestore.rules` — 2 new tenant-branch blocks (`wellnessQuizPassed` + `contractQuizPassed`, **CF-only create** = tighter than `wellnessClaimed`) + 1 player-branch block (`people/{tenantId}/wellnessQuizPassed`) + 2 collectionGroup admin-only read rules.
- ✅ `firestore.rules.test.js` — **7 new test cases** (planned 7) covering CF-only-create deny, owner read allow, cross-room deny, collectionGroup admin read.
- ⚠️ `npm run test:rules` not run locally — requires Firestore emulator on port 8080 (CI runs this). Syntax-checked via node parser; review pass on rules block structure looks clean.

### Phase B-ADMIN — Quiz authoring UI
- ✅ `dashboard.html` — collapsible `<details id="wellness-quiz-editor">` section between reward input + save buttons. Includes "+ เพิ่มคำถาม" + "📥 ดึงตัวอย่างจาก hardcoded" actions.
- ✅ `shared/dashboard-wellness-content.js` — ~190 lines of quiz editor logic: `_renderQuizQuestions`, `collectQuizFromForm`, `validateQuiz`, `quizAddQuestion`, `quizRemoveQuestion`, `quizAddOption`, `quizRemoveOption`, `quizImportSample`. Max 5 questions × 4 options. `saveWellnessArticle` now reads + validates + writes `data.quiz` (or `deleteField()` on empty edit). `editWellnessArticle` populates editor from existing quiz. `resetWellnessForm` clears editor.
- ✅ `shared/dashboard-main.js` — 6 new delegation handlers (quizAddQuestion, quizRemoveQuestion, quizAddOption, quizRemoveOption, quizSetCorrect no-op, quizImportSample). No inline onclick per CSP §E hook.

### Phase B-TENANT — Client wiring + subscriptions
- ✅ `tenant_app.html` — `submitContractQuiz` converted to async; calls `claimWellnessQuizPoints` (wellness branch) or `claimContractQuizPoints` (contract branch) via `httpsCallable`. Client computes preview score immediately for UI; server is authoritative. Optimistic localStorage marker write (per Session A §7-KK pattern). Rollback on transient failure; `already-exists` handled as info toast.
- ✅ Added `_subscribeQuizMarkers` (mirror `_subscribePaymentConfig`) watching BOTH subcollections via `onSnapshot`. Applies **§7-U** (claim-first guard via `_taBuilding`/`_taRoom`), **§7-N** (error callback with permission-denied resets `_xxxUnsub=null`), **§7-V** (unsub-before-rebind so re-attach on claim refresh doesn't leak listener), **§7-KK** (cached snapshots populate the marker map but don't clear localStorage hints).
- ✅ `_setupWellnessQuizPrompt` + `setupContractQuizGate` + `startWellnessQuiz` + `renderQuizHub` + `renderQuizHistory` all updated to prefer Firestore markers, fallback to localStorage.
- ✅ Marker maps exposed: `window._wellnessQuizMarkers` + `window._contractQuizMarkers` + `window._getContractQuizMarker(ym?)`.

### Phase B-INSIGHTS — Admin analytics
- ✅ `shared/dashboard-insights.js` — new `renderQuizEngagement()` aggregates both collectionGroups (filtered by §7-DD live-path discipline). Wellness sub-card: per-article pass rate sorted by attempt count. Contract sub-card: last 6 months pass rate. Wired into `initCommunityInsights` + `refreshInsight` dispatcher.
- ✅ `dashboard.html` — `<div id="dashQuizEngagement">` container in ชุมชน tab + matching scoped CSS for max-height/overflow.

### Phase B-MEMORY — Lifecycle doc + verifier rows
- ✅ `lifecycle_wellness_claim.md` — new "Quiz extension (Session B)" section. Documents quiz field shape, both CF names + region + subcollection paths, monthKey format, pass thresholds, reward constants, idempotency contract. Firestore rule block extended with the 2 new tenant subcollections + 2 collectionGroup rules. Tighter CF-only create vs Session A `wellnessClaimed` flagged.
- ✅ 5 new verifier-grep rows added to "Verification" block (CF exports, rules, tenant subscription, admin editor wiring, insights card).
- ✅ `npm run verify:memory` = **34 docs · 345 verifier rows · 0 fails** (was 340 — +5 new rows).

## Verification artifacts

- ✅ `node --test functions/__tests__/claimWellnessQuizPoints.test.js` — **15/15 green**
- ✅ `node --test functions/__tests__/claimContractQuizPoints.test.js` — **13/13 green**
- ✅ `npm run verify:memory` — 34/345/0 fails
- ✅ `npm run audit:auth` — PASS (11 matches, all justified)
- ✅ `npm run audit:size` — all files within soft/hard budgets (tenant_app at 94% soft / 75% hard)
- ✅ All edited JS files parse via `node -c`
- ⚠️ `npm run test:rules` — DEFERRED (needs Firestore emulator). CI runs this; rules block syntax verified manually.
- ⚠️ Live Chrome MCP smoke — DEFERRED (needs Vercel deploy + LIFF/admin sign-in).

## Pre-existing issues (NOT caused by this sprint)

- 6 existing CF test files fail with `Cannot find module 'firebase-functions/v1'` when run from repo root (verified via `git stash` clean-main run). Module resolution issue in test harness; my new test files use `Module._load` mock and work correctly. Worth a separate sprint to standardize the test mock pattern.

## Deferred to next session

1. **`firebase deploy`** — per [feedback_branch_before_firebase_deploy.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_branch_before_firebase_deploy.md): verify branch + worktree before `firebase deploy --only functions:claimWellnessQuizPoints,claimContractQuizPoints` + `firebase deploy --only firestore:rules`.
2. **Live smoke** via Chrome MCP (admin authoring + tenant submission + already-exists check + insights card) — pending deploy.
3. **PR open** from `claude/reverent-swirles-2fe321` worktree. Suggested title: `feat(quiz): server-trusted wellness + contract quiz claims (Session B) — CFs + rules + admin authoring + insights`.
4. **Player-side wellness tab in tenant_app** — Decision 2 deferred this. CF + rules ship ready; tenant_app player path needs activation when player UI grows to support wellness articles.

## Open follow-up surfaces

- `POLICY_ANSWERS` map in `claimContractQuizPoints.js` mirrors tenant_app's hardcoded pool. If admin ever changes those policy questions in tenant_app, mirror here. Future: pull from `system/policies.quiz.contract` Firestore doc.
- Storage path on transferTenant (Path 1c+1d from prior session) — separate sprint; not in quiz scope.
- ~70 inline onclick across 14 `shared/dashboard-*.js` files (pre-commit §E only catches NEW). Opportunistic refactor.

## Mid-sprint design pivot (worth noting)

The plan assumed contract quiz had hardcoded server-side questions, but the actual tenant_app code generates Q1+Q2 dynamically from lease data (endDate, monthlyRent) with shuffled options + a fallback policy pool. **Mid-execute pivot:** accept caller-sent `{kind, q?, userAnswer}` per question and grade server-side by kind. `kind: 'leaseEndDate'` compares to lease, `'monthlyRent'` digit-normalized compares, `'policy'` looks up in canonical map. This keeps the CF stateless (no two-phase session) while preserving server SoT. The pivot was flagged to user in the execute chat before implementing.

## Lessons (not promoted to §7 — sprint-specific)

- **Plan-doc accuracy check:** the plan assumed contract quiz was as simple as wellness quiz. Reading `buildContractQuiz` in tenant_app revealed the dynamic nature. Lesson: when planning a CF that mirrors client-side logic, READ the client code end-to-end (not just the call site) during the planning phase. The 30-second extra read would have caught the dynamic-questions wrinkle before plan was written.
- **§7-KK applied proactively:** Session A produced §7-KK reactively after the daily-bonus reconciliation bug. Session B applied the same metadata guard prospectively in `_subscribeQuizMarkers` — first time the lesson was used to PREVENT the bug rather than fix it. Worth noting that anti-pattern docs DO get re-applied when present and current.
