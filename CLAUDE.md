# CLAUDE.md — Workflow protocol for The Green Haven

Loaded at every session start. Overrides any default behavior — follow exactly.

## How this file relates to MEMORY.md

Two docs auto-load at session start; they are **complementary, not duplicates**:

- **This file (CLAUDE.md)** — *workflow + stack + recurring anti-patterns* · in the repo · committed to git · "how to work in this codebase". Owns: protocol rules, tech stack table, build/deploy commands, **§7 anti-pattern STUBS A-LLL** (recognise + rule + detection grep — auto-load every session). Full incident/code/debugging-signature for each lives in `tasks/lessons_antipatterns.md` (repo-committed, on-demand) — the two-tier split keeps per-session context lean while the detail travels with the repo.
- **MEMORY.md** at `~/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/MEMORY.md` — *architecture + history* · user-scoped · NOT committed · "what's in this codebase + what I've learned about this user". Owns: critical rules, system lifecycles, working-style feedback, archive.

**Boundary rule for new content:**
- Workflow / build / deploy facts → here
- A system's behavior, lifecycle, schema → MEMORY.md as `lifecycle_*.md` or reference doc
- A cross-project user preference → MEMORY.md as `feedback_*.md`
- **A project-specific recurring anti-pattern** → a STUB in §7 below + the full entry in `tasks/lessons_antipatterns.md` (two-tier — see §7 intro). (Was previously `tasks/lessons.md`; archived as `tasks/lessons.md.archive` for git history)

## 1. Workflow Orchestration

### Plan-First Protocol
**Mandatory** only when ALL three apply:
- Touches **5+ files** OR involves a **schema/security/architectural** change OR spans **multiple sessions**, AND
- Is **not reversible** with a single revert (data migrations, rules changes, multi-CF deploys), AND
- Has **2+ valid approaches** with real tradeoffs.

Then: write the plan to `tasks/todo.md` BEFORE editing code (checkable items + **Why** line) → WAIT for user approval → execute → append "Review" section.

For everything else (bug fixes, single-feature additions, UX polish, doc updates), use **TodoWrite** for live tracking instead — no `tasks/todo.md` written, no approval gate, just status updates as you go. See [memory/feedback_decision_protocol.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_decision_protocol.md) for the full autonomous / choice-menu / plan-first / one-question decision tree.

**Pivot rule:** if scope grows mid-implementation past the 5-file / architectural threshold, STOP, escalate to plan-first, get approval before continuing.

### Subagent Strategy
- Use Explore subagents liberally for codebase research — keep the main context clean.
- One task per subagent. Parallel calls only when independent.
- Offload research, exploration, and parallel analysis. Don't duplicate work that a subagent is already doing.

### Verify-via-grep doctrine (writing memory/architecture docs)

When writing or editing any **architecture, lifecycle, or reference doc** in `~/.../memory/lifecycle_*.md`, `~/.../memory/firestore_schema_*.md`, or similar — every load-bearing claim (path, function name, regex, schedule, field, rule contract) must EITHER:

1. **Embed the grep command** that proves it, e.g.: `(verify: grep idempotencyKey functions/X.js)`
2. **Defer to source** with a grep advisory: `(grep <pattern> in <file>)` — when the value drifts fast (line numbers, exact regex)

Each major lifecycle doc has a `## Verification` section with {claim, grep command, expected match} triples. Re-run those at session start when in doubt; mismatch = doc is stale, code is canonical.

After writing, **run `npm run verify:memory`** (also in § 5). Exit 1 = at least one claim's grep returns 0 hits → either the claim is wrong or the code drifted; fix one of them. Don't commit until exit 0.

The full rule + incident history: [memory/feedback_verify_via_grep_doctrine.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_verify_via_grep_doctrine.md).

### Self-Improvement Loop (Lessons)
After ANY correction from the user, decide where to log it:

- **Recurring anti-pattern in THIS project** (cost 2+ sessions, will likely re-occur) → add a new letter as a **two-tier pair**: a STUB in **§7 below** (`### X. title` + 🔒-if-hook-enforced + **Rule:** 1-2 sentences + **Detect:** grep + `↳ … → tasks/lessons_antipatterns.md §X`) AND the full entry (incident, ✅/❌ code, debugging signature, family) in `tasks/lessons_antipatterns.md`. The STUB auto-loads every session; do NOT paste the full prose/code back into §7. Keep the same `### X.` header in both so the count + anchor stay aligned.
- **One-off project incident** (specific commit fix, niche edge case) → don't promote; the commit message + lifecycle doc update is enough.
- **Cross-project preference** ("user wants X always") → `~/.claude/projects/.../memory/feedback_<topic>.md`. MEMORY.md "🤝 Working style" indexes them.

**Why no more `tasks/lessons.md`:** It was append-only and rarely opened (neither by user nor agent). Promoting recurring patterns to §7 (auto-loaded) keeps the signal where it actually gets read. The 2026-06-13 two-tier split refines this — not a reversal: the **stub** (rule + detection grep) is what auto-loads and gets read; only the long incident/code detail moved to `tasks/lessons_antipatterns.md` (still repo-committed + greppable, just on-demand). This avoids the old "rarely opened" trap because recognition no longer depends on opening the detail file. Old lessons still live in `tasks/lessons.md.archive` for git-history searches.

### Verification Before Done
- Never mark a task complete without proof: tests pass, logs show success, browser verified live, etc.
- Standard: **"Would a staff engineer approve this?"**
- For UI changes: live test on https://the-green-haven.vercel.app — never localhost (Firebase Auth rejects it).

### Demand Elegance
- For non-trivial changes, pause and ask: "Is there a more elegant way?"
- If a fix feels hacky → state it clearly, then implement the elegant version.
- Challenge own work before presenting it.

### Autonomous Bug Fixing
- Bug reports: just fix. Don't ask for hand-holding.
- Identify the root cause via logs / failing tests; fix the cause, never patch a symptom.
- No temporary workarounds. No `TODO:` / `FIXME:` comments in production code.

## 2. Tech Stack & Aesthetic Guardrails

**Current architecture (verified against `package.json` + repo state, 2026-04-28):**

| Layer | What's actually used | Where |
|-------|---------------------|-------|
| Markup | Vanilla HTML | `tenant_app.html`, `dashboard.html`, `login.html`, `tax-filing.html` |
| Styling | **Tailwind CSS v3** (pre-built, NOT CDN JIT) + custom CSS variables | `shared/tailwind.input.css` → `shared/tailwind.css` (built via `npm run tailwind:build`); brand tokens in `shared/brand.css` |
| Logic | Vanilla JS modules (UMD-ish; `window.X = ...` exports) | `shared/*.js` (102 files incl. 27 `tenant-*.js` god-file extracts; verify with `ls shared/*.js \| wc -l`) |
| Backend | **Firebase** v12 — Auth · Firestore · Realtime DB · Cloud Functions · Storage (client modular SDK `firebasejs/12.10.0` via CDN; `firebase-admin@13` + `firebase-functions@7` in `functions/`) | `functions/` (Node CFs); rules in `firestore.rules`, `storage.rules`, `database.rules.json` |
| Hosting | **Vercel** (not Firebase Hosting) | `vercel.json`, `/api/*` serverless fns (e.g. `/api/config`) |
| Build | `esbuild` minify + **content-hash** `shared`/`accounting` JS **+ `shared` CSS** → `immutable` cache (renames + rewrites `<script src>` **and `<link href>`** from one manifest; `*.input.css` excluded; build-time verify-gate; Vercel-only, source keeps plain names). CSS hashing closes §7-MM (no more CSS-cache asymmetry vs JS) | `build.js` · `tools/asset-hash.js` |
| Service Worker | Custom; auto-versioned from `VERCEL_GIT_COMMIT_SHA` | `service-worker.js` |
| Other | `xlsx` (meter import); LIFF SDK + LINE Messaging API | inline via CDN |

**Frameworks the project does NOT use** (do not introduce without explicit approval):
- ❌ **React** — codebase has zero React. New features go in vanilla HTML + Tailwind classes + a `shared/<feature>.js` module. Don't propose React for incremental work.
- ❌ Vue / Svelte / Angular / Next.js / any other framework
- ❌ TypeScript (project is plain JS)
- ❌ CDN-loaded UI libraries unless already present (no jQuery, Bootstrap, MUI, etc.)

**Muji Minimal aesthetic:** ทางสายกลาง · functional simplicity · use `shared/brand.css` tokens, not hardcoded hex. Full brand spec — fonts, color tokens, type scale, weight rules — lives in [memory/brand_living_os.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\brand_living_os.md). Plus the two-name rule in [memory/brand_two_names_rule.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\brand_two_names_rule.md): "Nature Haven" = project (tenant-facing), "The Green Haven" = company (tax/legal/infra). Do not consolidate.

**No bloat** — avoid unneeded libraries; keep the bundle light. Tailwind output stays small via JIT purge through the input file.

**File-size discipline** — 3-tier gate via [tools/file-size-limits.json](tools/file-size-limits.json) (INFO/WARN/BLOCK), enforced by pre-commit hook section F. Hard limits are headroom-generous (~50% above current) so they only trigger on real drift, not normal work. New features ≥200 lines → extract to `shared/<feature>.js` and expose via `window.X = ...` (precedent: `checklist-manager.js`, `building-registry.js`). Run `npm run audit:size` to see current usage and headroom for every tracked file.

## 3. Task Management

**For tasks above the Plan-First threshold (§1):**
1. Write plan to `tasks/todo.md` (checkable items + Why) → wait for user check-in
2. Implement, marking items complete as you go (TodoWrite in parallel for live status)
3. At each phase: brief *What* + *Why* summary to user
4. At end: append "Review" section to `tasks/todo.md` (shipped / deferred / follow-ups)

**For everything else (default):**
- Skip `tasks/todo.md`, use **TodoWrite** for tracking
- One sentence at the start ("Going to do X by Y"), one at the end (what changed)
- No mid-flight summaries unless the user asks

**After every correction:** decide where to log it per §1 Self-Improvement Loop (§7 anti-pattern for recurring project issues, `feedback_*.md` for cross-project preferences, commit message only for one-offs).

## 4. Core Principles

- **Simplicity first** — every change as minimal as possible. Impact minimal code.
- **Muji philosophy** — beauty in functionality. Remove anything that doesn't serve a purpose.
- **No laziness** — senior developer standards only. No `TODO:` in production.
- **Minimal blast radius** — touch only what's necessary; ensure zero side effects.

## 5. Build / Deploy / Test commands

| Command | What it does | When to run |
|---------|--------------|-------------|
| `git push origin main` | Vercel auto-deploys to https://the-green-haven.vercel.app | Only verification path — never localhost |
| `npm run build` | esbuild bundle minify (output to repo) | Pre-deploy if shared/*.js changes; usually Vercel handles via build hook |
| `npm run tailwind:build` | Compiles `shared/tailwind.input.css` → `shared/tailwind.css` (committed) | Whenever Tailwind classes change in HTML or input file |
| `npm run test:rules` | Firestore rules CI tests (220 cases as of 2026-06-01) | Before deploying any `firestore.rules` change |
| `npm run verify:memory` | Mechanical re-verification of every load-bearing claim in `~/.claude/.../memory/lifecycle_*.md` against current code. Fails (exit 1) if any claim's grep returns 0 hits. | **Pre-commit hook calls this automatically.** Fast (~2 sec). Replaces "I think the memory is current" with proof. |
| `npm run verify:memory:coverage` | Above PLUS coverage check — flags code-tick `quoted` identifiers in prose that have no matching verifier (cross-doc). Use `--strict` to fail on coverage gaps too. | When editing a lifecycle doc; before pushing big memory restructures. |
| `npm run verify:memory:all` | Above PLUS fabricated-path scan over handoff/journal/feedback files. Catches wrong template paths (e.g. `wellnessClaimed/{roomId}_2026-04`) whose stripped shape doesn't appear in any lifecycle doc or rules file. Warn-only; `--strict` to block. | At the end of any session that edited a non-lifecycle memory file. |
| `npm run install:hooks` | Installs the committed git hooks (`tools/git-hooks/*`) into `.git/hooks/`. Runs automatically as `postinstall` after `npm install`. | Only if you bypass `npm install` for some reason. |
| `npm run deploy:worktree:prep` / `:cleanup` / `:status` | Copy `functions/.env` from main + `npm install` in `functions/` (worktrees don't inherit either). `cleanup` removes the worktree-local `.env` after deploy; `status` is read-only. Never displays `.env` contents — only key-line counts. | Before `firebase deploy --only functions:<name>` from inside a `.claude/worktrees/*` checkout. |
| `npm run preview:deposit-settlement -- --building <b> --room <r>` (no args = `--scan`) | **Read-only #253 preflight** — prints what the move-out deposit settlement would deduct/refund on REAL data (held − บิลค้างชำระ − หักเสียหาย = คืนสุทธิ) WITHOUT writing; `--scan` flags which holding rooms have an outstanding bill (where #253 can be exercised live now). Reuses `DepositCalc.netRefund` + mirrors `_bld`/`toBE`(§7-E)/`_isArrears`. Firebase CLI configstore token (run any `firebase` cmd first to refresh). De-risks the §7-I-sensitive live-verify. | Before a real move-out settlement, or to find a testable room. |
| `npm run preview:pet-social` (no args = scan all; `--building <b>` / `--tenant <tid>`) | **Read-only #10 Pet Social asserter** — reads `petProfiles`/`petLinks`/`consents` on REAL Firestore WITHOUT writing and checks the invariants the owner can't see by eye: INV1 privacy (no health/vaccine/status leak into the public mirror), INV2 consent (every published pet has `consents/{tid}_pet_profile_v1` — a miss = §7-LLL race), INV3 link integrity. Same CLI-token/REST pattern as the #253 preflight. Pair with [tasks/pet-social-verify-playbook.md](tasks/pet-social-verify-playbook.md) to verify the LIFF cycle step-by-step. | After each step of the owner real-LINE pet-social cycle. |
| `npm run smoke:transfer-tenant -- --building <b> --old <r> --new <r2> --mode variation` | Live E2E smoke for `transferTenant` CF. Dry-run by default — reads source + target rooms, prints expected post-state, verifies pre-conditions. Add `:apply` (or append `--apply`) to invoke `_runVariationMode` / `_runNovationMode` directly via Admin SDK (avoids §7-JJ-fragile dashboard UI). Re-reads post-state and asserts the 6-field contract. **Production-data write** under `--apply` per §7-I. | Closing carryover item from 2026-05-23 daily-bonus session. Run when verifying after CF code changes that touch the carry-over contract. |
| `npm run csp:hash` / `csp:print` | CSP hash regen / print Vercel CSP | If/when CSP comes back from report-only |
| `firebase deploy --only functions:<name>` | Deploy a single CF | After editing `functions/<name>.js` |
| `firebase deploy --only firestore:rules,storage,database` | Deploy rules without CFs | After editing rules files |
| **Service account key** | Rotate annually. **Next rotation: 2027-05.** Frozen CF `generateBillsOnMeterUpdate` is on Node 20 — see `memory/generate_bills_cf_frozen.md` for manual mitigation steps if Node 20 reaches EOL before rotation. | Annual reminder |

Service Worker auto-versions from `VERCEL_GIT_COMMIT_SHA` — no manual `CACHE_VERSION` bump needed.

**Branch protection on `main`** (set 2026-06-01): requires the `validate` check to pass before a non-admin PR can merge; `enforce_admins: false` (admin bypass) so the owner can still `git push origin main` for emergencies (preserves the documented deploy path); force-push + branch deletion blocked. Reconfigure via `gh api -X PUT repos/{owner}/{repo}/branches/main/protection`.

## 7. Recurring Anti-Patterns — Read Before Touching These Areas

Each pattern cost 2–5 sessions to debug. Check the relevant one BEFORE writing code, not after. New pattern? Add a STUB here + a full entry in `tasks/lessons_antipatterns.md` (two-tier note below) — see §1 Self-Improvement Loop for routing.

**Two-tier:** every entry here is a **stub** — recognise + rule + detection grep (what you need at every load) — with a `↳ tasks/lessons_antipatterns.md §X` pointer to the full incident, code, and debugging signature (pull only when working in that area). `🔒` on a stub = a pre-commit hook mechanically blocks the regression, so the stub is the guardrail's label, not its enforcer. To read a full entry: `grep -n "^### HH\." tasks/lessons_antipatterns.md` then read its block.

### A. Auth-gated reads in `tenant_app.html`

🔒 **pre-commit WARNs** on `addEventListener('liffLinked')` in tenant_app; `audit:auth` BLOCKS auth-callback drift.
**Rule:** ANY Firestore/RTDB read needing `token.room`/`token.building`/`token.admin` MUST wire through `_onLiffClaimsReady(_subscribeX)` — NOT `addEventListener('liffLinked'|'authReady')`. Admin preview bypasses room checks, so the bug is invisible until a real LIFF test ("ไม่มีข้อมูล").
**Detect:** `grep -n "addEventListener('liffLinked'\|addEventListener('authReady'" tenant_app.html` → each should be `_onLiffClaimsReady`. Family: §7-U, §7-BB.
↳ 5-session incident + correct/wrong code → `tasks/lessons_antipatterns.md` §A

### B. Firebase SDK — modular only, no compat API

🔒 **pre-commit BLOCKS** `firebase.{database,auth,storage,functions}().xxx` compat chains.
**Rule:** v12 modular only, no compat layer. Use `window.firebaseGet(window.firebaseRef(window.firebaseDatabase, path))`, NOT `firebase.database().ref(...).once()` (`firebase.database` is undefined).
**Detect:** `grep -n "firebaseRef\|firebaseGet\|firebaseSet" dashboard.html` for the real globals; see [[firebase_client_sdk_v11_modular]].
↳ examples → `tasks/lessons_antipatterns.md` §B

### C. Modal display — inline style wins over class, AND `''` ≠ `'none'`

**Rule:** before a modal close handler, grep the modal's class in stylesheets. A CSS rule binding `display:none` → `m.style.display = ''` is fine. Inline-only `style="display:none"` (no CSS rule) → MUST be explicit `= 'none'` (`''` falls back to `block`). `classList` alone fails against an inline style.
**Detect debug:** `({inline:m.style.display, computed:getComputedStyle(m).display})` — computed `block` after close = inline-only fallback bug. Cousin: §7-SS.
↳ incident `32902be` (checklist/facility modals) → `tasks/lessons_antipatterns.md` §C

### D. BillStore — getByRoom not listForYear for single-room queries

🔒 **pre-commit BLOCKS** `BillStore.listForYear().filter(b => b.room)`.
**Rule:** RTDB bill docs have no `room` field in the body — use `BillStore.getByRoom(building, roomId, year)`. `listForYear(...).filter(b => b.room === roomId)` silently returns `[]` (`b.room` always undefined).
**Detect:** `grep -rn "listForYear" shared/ | grep "\.room"`. See [[lifecycle_stores_facade]].
↳ `tasks/lessons_antipatterns.md` §D

### E. Year formats — 3 different formats coexist

**Rule:** 3 year formats coexist — `meter_data` Firestore = 2-digit BE (`69`); RTDB bills = 4-digit BE string (`"2569"`); `synthesizeFromMeter`/grid `y` = 4-digit BE int (`2569`). Convert 2-digit BE→CE via `1957 + shortYear`. Always compare through `BillStore._be(b.year)`.
**Detect:** any raw `b.year ===` comparison in billing code is suspect — route through `_be()`. Family: §7-D, §7-AAA, §7-BBB.
↳ format table → `tasks/lessons_antipatterns.md` §E

### F. Recurring symptom → demand state FIRST, propose fix SECOND

**Rule:** if a symptom has appeared before (bills, modals, auth), STOP and ask for ONE diagnostic observation before proposing a fix — 1 observation cuts ~80% of the hypothesis tree. Never propose fix X→Y→Z in a row.
**Detect:** you're typing a second consecutive "try this" without a new observation. See [[feedback_stop_guessing_demand_state]].
↳ example prompts → `tasks/lessons_antipatterns.md` §F

### G. Cross-session self-conflict check

**Rule:** after touching 2+ files in the same user flow, re-read ALL session diffs end-to-end before saying done — two individually-correct changes can conflict (e.g. an auth gate blocking a URL the same session's login redirect generates).
**Detect:** `git diff` the whole session, trace the shared flow. See [[feedback_self_conflict_check_my_own_changes]].
↳ `tasks/lessons_antipatterns.md` §G

### H. Memory identifiers — grep before typing

**Rule:** when writing ANY memory/handoff/lifecycle file, every backtick-quoted path/function/field MUST be grep-verified BEFORE typing, not after (paraphrasing from memory produced 19 errors in one session).
**Detect:** `grep -r "path/to/doc" functions/ shared/ *.html` before writing it. See [[feedback_verify_via_grep_doctrine]].
↳ `tasks/lessons_antipatterns.md` §H

### I. Production data actions — never automate

🔒 **pre-commit BLOCKS** auto-clicking approve/confirm in admin code (`.click()` on approve/confirm).
**Rule:** any financial approval / bulk Firestore-RTDB write outside one user's own doc / admin-only CF trigger MUST show a preview and WAIT for an explicit user click. Never `.click()`/`dispatchEvent` programmatically on approve/confirm.
**Detect:** `grep -rn "querySelector.*click()\|approveMeterBtn\|dispatchEvent" shared/ *.html`. Root incident 2026-05-01 (wrong-building data → prod, manual rollback).
↳ `tasks/lessons_antipatterns.md` §I

### J. Static deploy ≠ live-data verified

**Rule:** "deploy succeeded" + HTTP smoke + unit tests ≠ a Firestore-dependent feature works for a real signed-in user. Before claiming done: trigger an authenticated read path, inspect the ACTUAL returned data (canonical IDs, fields), cross-check vs assumptions (fallbacks/mocks hide drift).
**Sub-lesson:** an empty-collection composite-index verify trivially passes — verify indexes by STATE (`gcloud firestore indexes composite list`), not by running the query. Family: §7-N, §7-M, §7-HHH.
↳ both incidents → `tasks/lessons_antipatterns.md` §J

### K. Defined ≠ wired — grep for callers

**Rule:** a function existing ≠ it runs. When a method looks load-bearing (cache-warm, prefetch, init), grep for callers before assuming it's active; wire bulk-prefetch helpers in the SAME commit they're added.
**Detect:** `grep -rn "funcName" shared/ *.html` — who actually calls it? Cousins: §7-AA, §7-QQ, §7-T.
↳ `prefetchAllPeople` (0 callers) → `tasks/lessons_antipatterns.md` §K

### L. Code-only cleanup ≠ data migrated

**Rule:** `setDoc(..., {merge:true})` only WRITES the named fields — never DELETES old ones. "Slim doc" code leaves existing docs fat until a one-shot migration. In handoffs separate "code-only" from "code + data migration"; destructive cleanup needs `FieldValue.delete()` in an explicit script.
**Detect:** shipped a doc-shape change? grep for a migration script; if none, existing docs keep legacy fields (reader fallback handles it). Family: §7-DD, §7-T. See `tools/migrate-tenant-doc-to-slim.js`.
↳ `tasks/lessons_antipatterns.md` §L

### M. "Loadable in browser" ≠ "in production flow"

**Rule:** build-pipeline membership (CSP/SRI/Sentry/bundle) doesn't prove a file is live in production. Before claiming file X integrates with flow Y, read its auth model (Firebase Auth? SecurityUtils? LIFF?), CF calls, and data source — `payment.html` looks production but is a standalone legacy localStorage portal.
**Detect:** check auth + CF + data-source primitives, not the build list. See [[payment_html_legacy]].
↳ `tasks/lessons_antipatterns.md` §M

### N. onSnapshot must have error callback

🔒 **pre-commit WARNs** on a new `.onSnapshot()` missing an error callback.
**Rule:** `onSnapshot(q, onNext)` swallows errors silently (UI stuck "กำลังโหลด..." forever on a missing index). Always pass the 3rd error cb; surface to console + render an error state. A composite query → add the index BEFORE the UI deploy.
**Detect debug:** try `getDocs(q)` directly — it throws visibly where `onSnapshot` swallows. Family: §7-V, §7-KK.
↳ `tasks/lessons_antipatterns.md` §N

### O. Pre-built feature search — Thai keywords + orphaned APIs

**Rule:** before planning any new feature, grep (1) the Thai keyword from the mockup ("นิติบุคคล") BEFORE English identifiers, and (2) orphaned `window.X =` APIs (defined-but-uncalled = unfinished feature waiting to be wired — often just needs wiring, not rebuilding).
**Detect:** `grep -rn "นิติบุคคล\|<thai-kw>" *.html shared/` then `grep -rn "window\.getReceiptMeta" shared/`. Cousin: §7-K, §7-AA.
↳ receipt-type already-built → `tasks/lessons_antipatterns.md` §O

### P. UID-drift fixes must traverse EVERY rule layer (Firestore + Storage + CF guards)

**Rule:** `signInAnonymously` mints a NEW UID per fresh LIFF session, so any rule gating `resource.data.tenantUid == request.auth.uid` drifts and breaks. When you fix one "no permission to X" with claim-match-not-uid-match, grep the SAME pattern across Firestore + Storage + CF before declaring fixed. Gate by token claims (`request.auth.token.room/building`), not uid.
**Detect:** `grep -rn "tenantUid == request.auth.uid\|tenantUid.*request.auth.uid" firestore.rules storage.rules functions/`. Family: §7-Z, §7-U, §7-HH.
↳ Tier 3I checklist (4 rounds) → `tasks/lessons_antipatterns.md` §P

### Q. Native dialogs (`confirm`, `alert`, `prompt`) don't render in Chrome MCP screenshots

**Rule:** `confirm`/`alert`/`prompt` auto-dismiss in Chrome automation (no render). To screenshot "what the dialog looks like", build a styled `<div>` overlay mimicking the OS look, screenshot it, then remove. The user wants the LAYOUT, not a literal native screenshot.
↳ iOS-mock pattern 2026-05-14 → `tasks/lessons_antipatterns.md` §Q

### R. `fetch()` from LIFF webview must always have AbortController + timeout

**Rule:** LINE's webview caches TLS aggressively — any await over the wire in the LIFF entry flow (`fetch`, RTDB `get`, Firestore `getDoc/getDocs`, storage `uploadBytes`) can hang indefinitely. Wrap each in `AbortController`+timeout or `Promise.race([op, timeout(5-12s)])`.
**Detect:** `grep -n "_callLiffSignIn\|verifySlip\|firebaseDatabaseGet\|getDocs" tenant_app.html booking.html` — each LIFF-path await needs a timeout. Family: §7-S, §7-GG.
↳ `_callLiffSignIn` + `loadRoomsConfig` hangs → `tasks/lessons_antipatterns.md` §R

### S. Multiple LIFF apps from the same LINE account share the auth handshake — second open hangs the first

**Rule:** opening a 2nd LIFF app while the 1st is mid-`liff.init`/`getIDToken` hangs the 1st at "ตั้งค่าสิทธิ์" forever (LINE platform constraint; `liff.init` never rejects). Add a ceiling timer (~30s) → styled "ปิดแอปอื่นแล้ว Reload" overlay; never auto-redirect between LIFF apps in one session.
**Detect during debug:** user stuck at "ตั้งค่าสิทธิ์" with NO network errors/timeouts → ask "เปิด LIFF อื่นใกล้กันไหม?" before chasing TLS/claims/index. Family: §7-R, §7-GG.
↳ 2026-05-14 incident → `tasks/lessons_antipatterns.md` §S

### T. Two admin UIs writing the same Firestore doc with different field names — reader pinned to one of them

**Rule:** before adding a new admin UI that edits an existing Firestore doc, grep EVERY writer AND reader of that doc. Two UIs writing the same value under different field names (`promptPayId` vs `promptpayNumber`) + a reader pinned to one = silent drift ("saved" but consumer never updates). Fix: reader reads BOTH → dual-write → migrate → drop legacy.
**Detect:** `grep -rn "YOUR_FIELD\|legacy_name" shared/ functions/ *.html` — confirm one writer pattern, all readers see it. Cousin: §7-K, §7-CC, §7-DD.
↳ promptPay drift (`01e88df`/`76789c1`) → `tasks/lessons_antipatterns.md` §T

### U. `_onLiffClaimsReady(fn)` + idempotency guard + claims-not-yet-set = stale subscription forever

🔒 **pre-commit BLOCKS** via `audit:auth` (the §7-A/U/Z auth-callback audit).
**Rule:** every subscribe wired through `_onLiffClaimsReady` MUST guard claim presence FIRST (`if (!_taBuilding) return;`) BEFORE setting its `_xxxUnsub` — else the anonymous first `authReady` sets a stale sub and the idempotency guard (`if (_xxxUnsub) return`) skips the real re-subscribe. Reset `_xxxUnsub=null` on permission-denied/failed-precondition.
**Detect:** `grep -n "_onLiffClaimsReady(" tenant_app.html` → each callee needs the claim guard. Difference from §7-V ("unsub before rebind"). Family: §7-A, §7-N.
↳ `_subscribeBroadcasts`/`_subscribePaymentConfig` (`95dc4a1`/`ade5648`) → `tasks/lessons_antipatterns.md` §U

### V. `setupXxxListener` that reruns must call the prior unsub before overwriting it

**Rule:** every `setupXxxListener` that stores its unsub in a stable slot (`realtimeListeners.X`, `_xxxUnsub`) MUST call the prior unsub before reassigning — else each rerun (e.g. `roomconfig-updated`) stacks a live listener (N rerenders → N+1 subs, each write fans out N×).
**Detect:** `grep -n "realtimeListeners\.\w\+ *=" shared/dashboard*.js` + `grep -rn "= onSnapshot" shared/dashboard*.js` — each needs a prior-unsub guard. Difference from §7-U. Family: §7-N, §7-KK.
↳ `bccabdc` meter-listener stacking → `tasks/lessons_antipatterns.md` §V

### W. `!important` doesn't beat higher specificity — check the cascade, don't just stamp `!important`

**Rule:** when a new style overrides an existing one, `!important` is a starting move not a finishing one — among `!important` rules the HIGHER specificity wins (`.app-bar h1.x` beats `.x`); an inline style only wins when NO `!important` rule matches. Predict the live computed value before pushing; "I added !important so it wins" is a yellow flag.
**Detect:** `getComputedStyle(el).prop` on the DEPLOYED page + trace matching rules. Family: §7-II, §7-RR, §7-SS, §7-III.
↳ P1.5/P2.13 cascade losses → `tasks/lessons_antipatterns.md` §W

### X. `innerHTML = ""` is a footgun — every assignment needs a non-empty fallback

**Rule:** every `el.innerHTML = X` is a contract — if X can be empty (empty array `.map().join('')`, a helper not loaded yet, all items filtered out, or an idempotent re-run), you MUST branch to an empty-state, guard `if (!list.children.length)`, or chain `|| fallbackMarkup`. A bare `innerHTML = ''` leaves a dark slot.
**Detect:** for every `innerHTML =` — can the RHS be ''? run before its helper? data filter to empty? run twice? Any yes → needs a fallback. Family: §7-N.
↳ 3 `renderBillsList`/`showBillsSkeleton` sites → `tasks/lessons_antipatterns.md` §X

### Y. `fetch('data:...')` is a network call under CSP — use atob, never fetch, for canvas/file dataURL → Blob

**Rule:** `fetch('data:...')` is blocked by CSP `connect-src` (Chromium treats `data:` as a network dest) → generic `TypeError: Failed to fetch`. To turn a canvas/file dataURL into a Blob, decode the base64 directly with `atob` (synchronous, no network), never `fetch`. Do NOT widen `connect-src` to `data:`.
**Detect:** `grep -rn "fetch(.*toDataURL\|fetch(.*dataUrl" shared/ *.html` — each is a latent bug. Signature: `TypeError: Failed to fetch` + ZERO network requests fired. Cousin: §7-XX, §7-EEE.
↳ `uploadAdminSignature` + `_dataUrlToBlob` → `tasks/lessons_antipatterns.md` §Y

### Z. `createCustomToken(uid, claims)` developer-claims are EPHEMERAL — also call `setCustomUserClaims` to persist

🔒 **pre-commit BLOCKS** a `createCustomToken(uid,{…})` with no `setCustomUserClaims` twin (hook §3 + `audit:auth`).
**Rule:** any CF minting a custom token with developer claims MUST also `setCustomUserClaims(uid, claims)` (fire-and-forget `.catch`). The token carries claims for the first ID token (~1h); the user record carries them across every refresh after. Miss it → works ~1h, then `permission-denied` for everyone until LINE reopen.
**Detect:** `grep -rnE "createCustomToken\([^)]*,\s*\{" functions/` — every hit needs a `setCustomUserClaims` twin. Cousins: §7-P, §7-U, §7-FF (reverse direction).
↳ incident `a5f4e5a` + code + time-dependent debugging signature → `tasks/lessons_antipatterns.md` §Z

### AA. Pre-existing CF search — grep `functions/` before writing a new scheduled CF

**Rule:** before writing a new scheduled/feature CF, grep `functions/` for domain keywords AND read the relevant lifecycle doc — 80% of the time you'll augment an existing CF (e.g. `remindLeaseExpiry` already did 60/30/14/expired) instead of duplicating. "notify" vs "remind" naming hides dupes.
**Detect:** `ls functions/ | grep -iE "<domain>"` + `grep -rln "pubsub.schedule" functions/`. Cousin: §7-K, §7-NN.
↳ `leaseExpiryNotifier` dup → `tasks/lessons_antipatterns.md` §AA

### BB. `window._liffClaims` is a phantom — always use `_taBuilding` / `_taRoom` globals

**Rule:** `window._liffClaims` is NEVER assigned — reading it gives `{}` every time (silent empty claims → page stuck ⏳). Use the canonical globals `_taBuilding`/`_taRoom` (set by `detectRoomBuilding()`+`linkAuthUid()`) or `window._tenantAppBuilding`/`_tenantAppRoom`.
**Detect:** `grep -n "_liffClaims" tenant_app.html` must return 0. Cousin: §7-A, §7-CC.
↳ `55f6295` checklist ⏳ → `tasks/lessons_antipatterns.md` §BB

### CC. `let X` at script top-level is NOT on `window` — cross-script readers see `undefined`

**Rule:** across `<script>` tags only `var` + `function` share global scope; top-level `let`/`const` are block-scoped to that one tag — a sibling reading `window.X` (or bareword) sees `undefined`. Anything cross-script MUST be `window.X = ...` at declaration AND each assignment.
**Detect:** `grep -rn "^\s*let X\b" shared/` for a value a sibling reads via `window.X`. Inverse of §7-EE; family §7-T, §7-BB.
↳ PDPA `currentEditTenantId` → `tasks/lessons_antipatterns.md` §CC

### DD. Lifecycle CFs that touch one collection must also update sibling collections — UI readers fall through

**Rule:** a state-transition CF (archive/transition/revert) must update EVERY collection a UI fall-through reads, not just its "main" doc. A tenant clear must also set `leases/{b}/list/{leaseId}.status='ended'` (else `getActiveLease`'s legacy fallback finds the orphan active lease → ghost tenant). Update siblings in the SAME batch.
**Detect:** `grep -rn "getActive\|status === 'active'" shared/` for fall-throughs; each transition CF must touch `leases/`. See `tools/fix-orphan-leases.js`. Family: §7-L, §7-T, §7-CCC.
↳ archive/transition/revert (2026-05-20) → `tasks/lessons_antipatterns.md` §DD

### EE. Top-level `function X()` + `window.X = wrapper` self-recursion — capture-before-reassign required

**Rule:** in a classic `<script>`, top-level `function X(){}` is only a `window` property, not a separate lexical binding — so `window.X = function(){ X()… }` makes the bareword `X()` resolve to the wrapper → ∞ recursion (`RangeError`, blank dashboard cards). Capture FIRST: `const _innerX = window.X;` then call `_innerX(...)` inside the wrapper.
**Detect:** `grep -rnE "^window\.\w+\s*=\s*function" shared/ tenant_app.html dashboard.html` → review each for a bareword self-call. Inverse of §7-CC (`let` at top-level isn't on `window`).
↳ incident `48b47ed` (S6) + before/after code → `tasks/lessons_antipatterns.md` §EE

### FF. Reversing custom claims — `setCustomUserClaims({})` alone leaves a ~1h leak

**Rule:** reversing claims needs ALL THREE: server `setCustomUserClaims(uid,{})` + `revokeRefreshTokens(uid)`, AND client force-refresh `getIdTokenResult(true)` on session-restore paths. Skip the force-refresh → the cached ID token (still has claims) lets the user back in for ~1h. Backfill existing records when shipping this late.
**Detect:** `grep -rln "setCustomUserClaims.*{}" functions/` vs `grep -rln "revokeRefreshTokens" functions/` — diff = half-finished; `grep -rn "getIdTokenResult()" shared/ *.html` (no `true`). Reverse of §7-Z.
↳ `unlinkLiffUser` (`ba084ef`/`3e159ff`) → `tasks/lessons_antipatterns.md` §FF

### GG. LIFF redirect strips URL `?query=params` — use localStorage for sticky toggles

**Rule:** LINE's LIFF redirect can DROP `?query=params` (works in Safari/Chrome, not LIFF). Any URL-driven toggle that must survive LIFF MUST persist to localStorage on first detection + read from BOTH `location.search` and storage after; always provide an explicit OFF trigger (`?foo=0`).
**Detect:** `grep -rn "location.search\|URLSearchParams" tenant_app.html booking.html` — each needs a localStorage sibling. Family: §7-R, §7-S.
↳ booking debug panel → `tasks/lessons_antipatterns.md` §GG

### HH. Global `onAuthStateChanged` anon fallback races with deliberate `signOut → signInWithCustomToken` swap on LIFF pages

**Rule:** a LIFF-entry page driving auth via `signOut → signInWithCustomToken` MUST NOT keep an unconditional `signInAnonymously()` fallback in its global `onAuthStateChanged` — the swap's `signOut()` fires it and it races the awaited custom-token sign-in (~20-40% of opens → random anon UID; every `auth.uid` gate breaks). Gate on `!/Line\//i.test(navigator.userAgent)`, or drop it on LIFF-only pages.
**Detect:** a file in BOTH `grep -rn signInAnonymously` and `grep -rn signInWithCustomToken` is suspect. Signature: `auth.uid` not `line:`/`book:` + no claims + reopen-sometimes-fixes. Siblings: §7-Z, §7-P, §7-U.
↳ 3-session incident `4d40328` + full symptom list + why-hard-to-spot → `tasks/lessons_antipatterns.md` §HH

### II. CSP hash drift accumulates silently during Report-Only era, bombs on enforce flip

🔒 **pre-commit §G BLOCKS** this: staging any of the 8 tracked HTMLs regen-compares CSP hashes.
**Rule:** ANY edit to an inline `<style>`/`<script>` in the 8 tracked HTMLs (index/login/dashboard/tenant_app/tax-filing/audit-log-viewer/payment/booking) needs hash regen in the SAME commit: `npm run csp:hash && node tools/update-vercel-csp.js && git add vercel.json tools/csp-hashes.json`.
**Signature:** the deployed page renders with NATIVE browser styling (CSS files 200; inline `<style>` present in source but not applied); the violation shows only in DevTools → Issues, not console. Family: §7-W, §7-RR, §7-OO, §7-J.
↳ incident `9f29338` + 6-point debugging signature + "ห้องแถว labels lied" lesson → `tasks/lessons_antipatterns.md` §II

### JJ. `btn.click()` timing race — event delegation hub not registered at 900ms checkpoint

**Rule:** never `btn.click()` for programmatic init that races DOMContentLoaded — the event-delegation hub (`dashboard-main.js`) registers inside a `DOMContentLoaded` async cb that awaits Firebase (up to 2s); a click before that silently drops. Call the target function directly, pass `btn` as an arg for highlighting.
**Detect:** `grep -rn "setTimeout" shared/ dashboard.html | grep "\.click()"`. Family: §7-A, §7-U.
↳ `c32a5d9` dashboard skeleton stuck → `tasks/lessons_antipatterns.md` §JJ

### KK. Optimistic local write vs cached onSnapshot reconciliation race

**Rule:** ANY onSnapshot handler doing something NON-IDEMPOTENT / hard-to-undo (clear localStorage, `location.reload()`, navigate, write, trap-overlay) MUST gate on `!snap.metadata?.fromCache` (+ `!hasPendingWrites` when optimistic local writes are in play). The first tick is usually stale cache — acting on it erases the optimistic write or loops the page. Pure UI reads don't need the guard; side effects do.
**Detect:** `grep -B1 -A20 "onSnapshot" tenant_app.html shared/*.js | grep -B5 -A5 "localStorage.removeItem\|location.reload"` → each needs a fromCache guard. Family: §7-N, §7-V.
↳ both incidents (`2dfc440` daily-bonus, `bcf0ac9` reload-loop) + timeline diagram → `tasks/lessons_antipatterns.md` §KK

### LL. Firebase RTDB JSONP fallback hits BOTH `script-src-elem` AND `frame-src` — fix in one commit

**Rule:** when RTDB's WebSocket fails it falls back to JSONP → a `<script>` (hits `script-src-elem`) AND an `<iframe>` on a DIFFERENT subdomain (hits `frame-src`); `connect-src` is irrelevant. Add `https://*.firebasedatabase.app` + `https://*.firebaseio.com` to BOTH directives in `generate-vercel-csp.js` in one commit.
**Detect:** `grep -oE "script-src-elem [^;]+" vercel.json | grep -c firebasedatabase` AND the same for `frame-src` — both must be ≥1. Family: §7-II.
↳ PRs #32→#34 (two deploy cycles) → `tasks/lessons_antipatterns.md` §LL

### MM. Service worker cache serves stale `function X()` even after deploy — clear SW + caches before in-browser verification

**Rule:** when verifying a JS fix on Vercel via Chrome MCP, the service worker can serve OLD `shared/*.js` even though a cache-busted `fetch` returns NEW source — `window.X.toString()` shows the OLD body. Clear SW + caches before verifying (unregister + `caches.delete` + reload); plain `reload(true)` isn't enough. End users auto-invalidate via `CACHE_VERSION`.
**Detect during debug:** patch shows in the fetched file but behavior doesn't match → check `window.fn.toString()` FIRST, don't chase other layers. Cousin: §7-J, [[feedback_frontend_fix_hardreload_before_done]].
↳ `tasks/lessons_antipatterns.md` §MM

### NN. Firestore triggers (any Gen, any region) cannot watch SE3-hosted Firestore — use HTTPS callable + client invocation

**Rule:** Eventarc (both Gen1 + Gen2 Firestore triggers) does NOT support `asia-southeast3` (this project's Firestore) — any new Firestore-trigger CF FAILS at deploy. Use an HTTPS `onCall` (SE1) invoked from the client AFTER the write (model: `notifyTenantOnMeterUpload`). Only `generateBillsOnMeterUpdate` is grandfathered (FROZEN).
**Detect:** `grep -rn "\.firestore\.document(\|firebase-functions/v2/firestore" functions/` — each is frozen or must be refactored. If a trigger already attempted deploy, `firebase functions:delete <name>` before redeploy as callable. Family: §7-AA, §7-K.
↳ marketplace-chat refactor (PR #36→#37) → `tasks/lessons_antipatterns.md` §NN

### OO. `html-minifier-terser collapseWhitespace:true` strips inline script whitespace → CSP hash mismatch in production

**Rule:** `build.js`'s minifier (Vercel-only) trims the leading/trailing whitespace of multi-line inline `<script>`/`<style>` — so CSP hashes must be computed on `.trim()`-ed content (already fixed in `compute-csp-hashes.js`). Single-line scripts are unaffected.
**Detect:** `grep "m[2].trim()" tools/compute-csp-hashes.js` (must hit both extractors). Signature: a CSP error on a multi-line inline script with no JS change. Family: §7-II.
↳ login.html 2026-05-31 → `tasks/lessons_antipatterns.md` §OO

### PP. `defer` + DOM order matters — adding `defer` to a script that other deferred scripts depend on breaks load order

**Rule:** all `<script defer>` run in DOM order regardless of load time. Adding `defer` to a script an earlier-appearing deferred script depends on (`gamification-rules` ← `tenant-leaderboard`) breaks load order → `ReferenceError`. Move the definer BEFORE its consumers in the HTML.
**Detect:** `grep -n "<definer>\|<consumer>" tenant_app.html` — the definer must be at a LOWER line number. Signature: `ReferenceError` on load but `typeof window.X` is fine after. Family: §7-EE, §7-CC.
↳ defer load-order break → `tasks/lessons_antipatterns.md` §PP

### QQ. God-file extraction silently drops `function X()` from global scope — always export as `window.X`

**Rule:** a top-level `function X(){}` inside a `<script>` is auto on `window`; moving it to a `shared/*.js` module is NOT — add `window.X = ...` immediately + change same-script bareword callers to `window.X(...)`. No compiler/lint/test catches the omission (silent absence at runtime).
**Detect:** after extracting, `typeof window.X` must be `'function'` on the live page. Difference from §7-K (had callers, deleted in refactor). Family: §7-CC, §7-JJJ.
↳ `showPage` god-file extraction → `tasks/lessons_antipatterns.md` §QQ

### SS. CSS migration from `style="display:none"` to `u-init-hide` breaks tab switchers that clear inline style to show panels

**Rule:** a tab switcher that shows a panel by clearing inline style (`el.style.display=''`) breaks when the panel migrates to class `u-init-hide` (no `!important`, stays hidden). The show step must SET `el.style.display='block'`; the hide step adds `u-hidden` + clears inline. NOTE: `switchDashboardTab` (toggleable `u-hidden`) is CORRECT — don't "fix" it.
**Detect:** `grep -n "u-init-hide" dashboard.html` + `grep -n "if.*style.display.*style.display" shared/dashboard-*.js`. Cousin: §7-C.
↳ 7 switchers (2026-05-31) → `tasks/lessons_antipatterns.md` §SS

### RR. `document.createElement('style')` is blocked by CSP `style-src-elem` — CSS must live in a static file

**Rule:** a JS-injected `<style>` tag has no CSP hash → silently discarded under enforced `style-src-elem` (code runs, no error, `_stylesInjected=true`, but `getComputedStyle` returns 0). Put CSS in a static `.css` file (`shared/components.css`) — external sheets need no hash.
**Detect:** `grep -rn "createElement.*'style'" shared/ --include=*.js` — each is a latent block. Violation only in DevTools → Issues. Sibling: §7-II.
↳ `rich-text-policy.js` editor → `tasks/lessons_antipatterns.md` §RR

### TT. Bulk `sed`/regex edits across UTF-8 Thai files can silently double-encode the file — verify encoding after, never trust "it still parses"

**Rule:** a bulk/scripted edit of a non-ASCII file (Thai UI strings in `shared/tenant-*.js`, `dashboard-*.js`, `*.html`) can re-save through codepage 874 → double-encoded mojibake (`ผ`→`เธ`); it still parses + lints clean. Prefer the Edit tool / explicit-utf8 Node over shell `sed -i` on Windows; verify ENCODING after, not just syntax. NOT a CRLF issue.
**Detect:** scan for `เธ`×3+ per line or `โ€"` after any bulk pass (see `tools/fix-thai-mojibake.js`). Recovery: source byte-exact from the last-clean commit, never retype Thai. Family: §7-H, §7-QQ.
↳ `7e5ef7b` console-strip → `tasks/lessons_antipatterns.md` §TT

### UU. Copying page CSS into a print/popup window — keep each `<style>` separate + `<link>` external sheets; never join them into one `<style>`

**Rule:** in a print/export popup (`window.open`+`document.write`), do NOT join all inline `<style>` innerHTML into ONE block (a parse quirk in one eats every later rule → collapsed invoice rows). Emit each `<style>` as its own tag + external sheets as `<link>` (absolute href); set `data-theme="light"`, wait for load before `print()`, close on `afterprint`.
**Detect:** `grep -nE "querySelectorAll\('style'\).*join|map\(s=>s\.innerHTML\)" shared/*.js *.html`. Verify via a throwaway iframe of the EXACT output + getComputedStyle. Family: §7-W, §7-RR.
↳ `printDoc` (PR #207/#208) → `tasks/lessons_antipatterns.md` §UU

### VV. Page auth gates must `await auth.authStateReady()` — never a fixed `setTimeout` redirect (it races cold-start session restore)

**Rule:** a client auth gate that redirects on "no user" MUST `await auth.authStateReady()` then decide off `currentUser` (a long ≥10s timer only as fallback) — a fixed 4s `setTimeout` redirect races cold-start IndexedDB session restore and bounces a signed-in admin to /login (a flap). Both dashboard + tax-filing gates now use this.
**Detect:** `grep -nE "setTimeout.*(login|redirect)|authStateReady" *.html` — any NEW client gate must follow. Family: §7-A, §7-U, §7-Z, §7-HH.
↳ PR #209/#211 → `tasks/lessons_antipatterns.md` §VV

### WW. Migrating a CF to `defineSecret` — verify the secret in the EXACT deploy project (pin `--project`) + test-deploy ONE CF first; one bad binding blocks ALL CF deploys

**Rule:** a `defineSecret` CF migration is an IAM/project-setup task: verify the secret exists in the DEPLOY project (pin `--project` — the no-flag check reads the wrong project) + the SA can read it, and test-deploy ONE CF before merging. CI deploys all CFs in one command → one bad secret binding blocks EVERY CF deploy (pipeline outage). `.env` (CI-injected) is acceptable for non-critical tokens.
**Detect:** `firebase functions:secrets:get X --project the-green-haven` (metadata only, never `:access`) + `gcloud secrets describe`. Can't run gcloud in-session → don't merge, hand to user. Family: §7-Z, §7-FF, §7-NN.
↳ IQAIR revert `adae1cc` (PR #216) → `tasks/lessons_antipatterns.md` §WW

### XX. Preview a local File via `data:` (FileReader), not `blob:` (createObjectURL) — and verify the LIVE CSP, not vercel.json

**Rule:** preview a just-picked File as `<img>` via `FileReader.readAsDataURL` (`data:`), never `URL.createObjectURL` (`blob:`) — `data:` is the narrower grant and survives a CSP `img-src` that omits `blob:`. `blob:` stays fine for downloads/canvas. PDFs can't preview inline → defer to the stored-evidence view (https: `getDownloadURL`).
**Verify LIVE, not vercel.json:** a Vercel-UI *header* override CAN diverge from vercel.json — it did 2026-06-04 (live `img-src` omitted `blob:`). *2026-06-13 re-audit: live === vercel.json byte-identical (incl. `blob:` + all 24 hashes) on login/dashboard/tenant_app → that override is DORMANT + the CSP hash pipeline IS effective live. Still verify, don't assume.*
**Detect:** `grep -rn "createObjectURL" shared/ *.html` + `curl -sSIL <url> | grep -i content-security` (the REAL img-src). Family: §7-Y, §7-II, [[feedback_vercel_ui_overrides_json]].
↳ #259 + 2026-06-13 header-drift audit → `tasks/lessons_antipatterns.md` §XX

### YY. Node 22 undici `fetch` can't serialize the `form-data` npm package — multipart uploads must use **global `FormData` + `Blob`**

**Rule:** the CF runtime is Node 22 (undici global `fetch`) — the `form-data` npm package serializes to `"[object FormData]"` (17 bytes, text/plain). Multipart uploads MUST use the GLOBAL `FormData` + `Blob` and NOT set `Content-Type` (undici sets the boundary). `form.getHeaders()` does not rescue it. The `timeout` option is a no-op → use `AbortSignal.timeout`.
**Detect:** `grep -rn "require('form-data')" functions/` must be 0 (all migrated; dep removed 2026-06-12). Lock with a test asserting `body instanceof FormData`. Family: §7-WW, §7-NN, §7-Y.
↳ `verifySlip`/`verifyBookingSlip` migration → `tasks/lessons_antipatterns.md` §YY

### ZZ. Never transcribe a tool-produced hash/ID from a screenshot — capture it programmatically. And for html2canvas+CSP, strip the clone (`onclone`), don't chase the hash.

**Rule:** (1) never read an opaque case-sensitive value (CSP hash, base64, token) off a screenshot — reproduce it in a harness and COMPUTE it (a misread `V`/`v` burned a deploy). (2) html2canvas under enforced CSP: don't allowlist its injected-style hash (it drifts with page CSS) — strip the clone in `onclone` (`doc.querySelectorAll('style,link').forEach(s=>s.remove())`) + `ignoreElements` for canvases.
**Detect:** for an injected `<style>` hash, run the real lib with `removeContainer:false` 3× + `crypto.subtle.digest`. Family: §7-RR, §7-II, [[feedback_empirical_check]].
↳ deposit receipt PRs #271-274 → `tasks/lessons_antipatterns.md` §ZZ

### AAA. Unordered Firestore `limit()` returns the OLDEST docs — a row cap silently drops the NEWEST rows

**Rule:** `limit(N)` with NO `orderBy` returns docs in `__name__` ASC — so on a growing collection it keeps the lowest doc IDs and drops the NEWEST. Pair every `limit()` with `orderBy(<chrono> desc)` (+ composite index, §7-N), or for a naturally-bounded single-room scope drop the limit and sort/filter in JS.
**Detect:** `grep -rnE "\.limit\([0-9]+\)" shared/*.js | grep -iv orderBy`. (`meter_data` `year` is int 2-digit BE, §7-E.) Family: §7-N, §7-D, §7-K.
↳ tenant meter `limit(24)` (`d89b7cd`) → `tasks/lessons_antipatterns.md` §AAA

### BBB. Lifecycle CFs that write an embedded `.lease` subobject the tenant app reads MUST carry `moveInDate` — a future/missing boundary date hides ALL current meter rows + starves the synthesized current-month bill

**Rule:** the tenant app's meter/bill boundary reads `_taLease.moveInDate` then `startDate` — a `.lease` subobject written by a lifecycle CF (e.g. `transferTenant` variation mode) MUST carry `moveInDate` (occupancy), never just a contract-TERM `startDate`/`contractStart` (legitimately future for renewals → boundary in the future → ALL current meter rows hidden → current-month bill never synthesizes). Client guard: a future boundary → skip filtering.
**Detect:** `grep -n "lease: {" functions/*.js` — each must include `moveInDate`; `grep -rn "tenantBoundaryYM\|filterByTenantBoundary" shared/billing-system.js`. Family: §7-T, §7-DD, §7-L, §7-AAA.
↳ transfer 15→13 (2026-06-07) → `tasks/lessons_antipatterns.md` §BBB

### CCC. CI auto-deploy regex skips INDENTED/conditional `exports.X` → pushed CF fixes silently never deploy

**Rule:** the CI deploy-list builder must match `exports.X` at ANY indentation (`grep -oP '^\s*exports\.\K\w+'`) — a `^exports\.`-anchored grep silently drops CFs exported indented inside `try{ if(mod.x){ exports.x=... }}` guards (verifySlip, notifyLiffRequest…), so a pushed fix goes green in CI but never deploys.
**Detect:** `grep -nE "^[[:space:]]+exports\.[A-Za-z0-9_]+" functions/index.js`. Confirm a CF deployed via the CI `updating … <name>` log or `gcloud functions describe`. Family: §7-AA, §7-K.
↳ `1576017` → `tasks/lessons_antipatterns.md` §CCC

### DDD. An "extracted-helper" file that's actually DEAD — `grep require` BEFORE editing it

**Rule:** before editing any `_helper.js`/"extracted"/"split" file, confirm it's actually `require`d — `_verifySlipWrite.js` looked like verifySlip's helpers but was never imported (verifySlip defines its own copies inline), so 2 commits of edits ran nothing.
**Detect:** `grep -rnE "require\(.*<basename>" functions/` — 0 hits = DEAD. If a name exists in 2 files, find which the entry point uses. Sibling: §7-K, §7-QQ.
↳ `a782797` (ported to live verifySlip) → `tasks/lessons_antipatterns.md` §DDD

### EEE. Tenant `FileReader.readAsDataURL` sends a FULL `data:` URL — CF base64-decode must strip the prefix

**Rule:** `FileReader.readAsDataURL` yields `"data:image/...;base64,<payload>"` (prefix included, needed for `<img src>` preview). A CF doing `Buffer.from(file,'base64')` corrupts it → SlipOK 400 `code:1005`. Strip at the CF boundary: `file.startsWith('data:') ? file.slice(file.indexOf(',')+1) : file` (covers both admin-stripped and tenant-full forms).
**Detect:** `grep -rn "readAsDataURL" shared/*.js` — each result either `.split(',')[1]` client-side or the CF strips. Also `params.userId || params.room || null` (undefined → Firestore reject). Cousin: §7-Y.
↳ `7d93a83`/`a782797` → `tasks/lessons_antipatterns.md` §EEE

### FFF. Client "is this mine?" buckets must key off stable identity (room/tenantId), NOT auth uid

**Rule:** a client "mine vs others" filter keying off `item.ownerUid === window._authUid` mis-buckets before auth uid loads (`''` → all "others") AND in admin preview (admin's uid). Bucket by the durable identity the doc stores (tenantId, `building_room`), not live `auth.uid`; early-return render until that identity is ready. uid stays for SERVER auth gates.
**Detect:** `grep -rn "=== _authUid\|Uid === .*_authUid" shared/*.js`. Family: §7-U, §7-BB, §7-Z, §7-HH.
↳ food-share #318 → `tasks/lessons_antipatterns.md` §FFF

### GGG. E2E login helpers MUST gate the submit on `window.firebaseReady` — raising the timeout does NOT fix the cold-deploy race

**Rule:** `login.html handleLogin()` returns early (no sign-in) while `window.firebaseReady` is false (awaits `/api/config` serverless fn). E2E is triggered on `deployment_status` (the coldest moment) — a helper that fills+clicks `#loginBtn` immediately races it → silent no-op → `waitForURL(/dashboard/)` times out. Gate the submit on `await page.waitForFunction(()=>window.firebaseReady===true)`. Raising the timeout alone CANNOT fix it.
**Detect:** `grep -rn "click('#loginBtn')" e2e/` — each preceded by a firebaseReady wait; `grep -rn "firebaseReady" e2e/`. Cousin: §7-A. See [[lifecycle_smoke_test]].
↳ `ddc5560` (E2E red #319-325) → `tasks/lessons_antipatterns.md` §GGG

### HHH. Verify a UI behavior EXISTS in the surface BEFORE writing an E2E/playbook assertion about it — an assertion on an assumed behavior flakes like a data/timing bug

**Rule:** before writing/un-quarantining an E2E or playbook assertion about a RENDERED behavior, grep the render path to confirm the surface actually emits it. The admin bill UI shows a slip as a TEXT row, not an `<img>` from a signed URL — a test asserting the image times out like a data/timing flake while the premise is just wrong. A paid bill-grid card fires `showPayDetail` (modal `#payModalOverlay`), NOT `#billActiveRoom`.
**Detect:** `grep -n "showPayDetail\|slipResult\|<img" shared/dashboard-bill*.js` before asserting. Family: §7-K, §7-M, §7-J.
↳ `signed-url.spec.js` (2026-06-10) → `tasks/lessons_antipatterns.md` §HHH

### III. A dark-mode page that loads `components.css` MUST define the generic `--card`/`--text` aliases in `:root` — else its cards render LIGHT in dark mode

**Rule:** `components.css` styles many cards via `var(--card,#fff)`/`var(--text,…)` — generic names `brand.css` never defines (it flips `--surface-card`/`--ink`). A dark-themed HTML loading components.css MUST alias in `:root`: `--card:var(--surface-card); --text:var(--ink); --text-muted:var(--muted); --border:var(--stone);` (they auto-flip, no dark override needed) — else cards render LIGHT in dark mode.
**Detect:** a `components.css` consumer with a dark theme but `--card=0` is buggy (booking/login/privacy/terms are light-only → latent). Family: §7-W, §7-T, §7-II/RR.
↳ tenant_app dark cards (2026-06-10) → `tasks/lessons_antipatterns.md` §III

### JJJ. A `data-action` whose handler takes an arg MUST have an explicit dispatcher case — the generic fallback passes `(el, e)`, not `data-arg`

**Rule:** `_dispatch` passes `arg` (`el.dataset.arg`) only to explicitly-cased actions; the generic fallback passes `(el, e)`. So a `data-action="openPetHealth"` handler written `openPetHealth(petId)` with NO explicit case receives the `<button>` element → cryptic `i.indexOf is not a function` deep in the Firestore SDK. Add an explicit case passing `arg`.
**Detect:** `grep -oE "data-action=\"[a-zA-Z]+\"" tenant_app.html | sort -u` then confirm each arg-taking one has `=== '<action>'`. The cure for the cryptic symptom = §7-N (surface the real error code). Family: §7-QQ, §7-K.
↳ `a93f05d` pet health → `tasks/lessons_antipatterns.md` §JJJ

### KKK. Billing "paid" state spans 4 stores + 3 date semantics — reconcile ALL on every read / write / reset

**Rule:** "paid" lives in 4 stores (RTDB `bills/`+`paidAt`, Firestore `verifiedSlips`, localStorage `payment_status`, `bills_YYYY`) dated by 3 fields (`timestamp`=billing-month anchor, `verifiedAt`=activity, `paidAt`=marked-paid). Reconcile ALL on every read/write/RESET (a reset must delete every signal incl. duplicate RTDB bills + verifiedSlips). The verifiedSlips `onSnapshot` MUST handle `'removed'`. Feed dates by `verifiedAt`; "today" by `paidAt`; the complete list unions cash (BillStore-paid-no-slip).
**Detect:** `grep -rn "verifiedSlips\|payment_status\|saveBillToFirebase\|_pvAugmentBills" shared/dashboard-bill*.js shared/dashboard-payment-verify.js`. Family: §7-T, §7-DD, §7-E, §7-N/V/KK.
↳ QA cluster `9e68fb0`→`9bf6257` → `tasks/lessons_antipatterns.md` §KKK

### LLL. Fire-and-forget consent/prerequisite write that a CF GATES on must be `await`ed before the gated call — else a `failed-precondition` race

**Rule:** `recordChecklistConsent` is fire-and-forget where nothing downstream gates on it (kindness/reputation — keep those). But where a CF server-gates on the consent doc existing (`upsertPetProfile` reads `consents/{tid}_pet_profile_v1` → `failed-precondition` if absent), the consent write MUST be `await`ed BEFORE the gated call — else the publish races the write and the pet stays unpublished.
**Detect:** `grep -rn "recordChecklistConsent" shared/*.js` (awaited or not?) × `grep -rln "consents/" functions/` (read as a gate?). Tripwire: `npm run preview:pet-social` INV2. Family: §7-Z, §7-FF, §7-KK, §7-DD.
↳ #10 pet publish (`afc00c0`) → `tasks/lessons_antipatterns.md` §LLL

## 6. Cross-references — where to look in MEMORY.md

[MEMORY.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\MEMORY.md) is the architecture + history index. Read these sections by purpose:

- **⛔ Critical rules** → before touching any rule, auth, or LIFF code. Each entry is a real incident with its lesson.
- **🏛️ System lifecycles** → "how does X work end-to-end". ~28 docs split into Core/Tenant-facing/Admin sections. Includes the recent Tier 1B/2D/3F/3I features (expense, deposit, building registry, checklist).
- **🧭 Reference** → durable narrow-scope docs: Firebase SDK gotchas (admin + client v12 + functions v7), region split (SE1 vs SE3), `generateBillsOnMeterUpdate` frozen, brand OS, etc.
- **🤝 Working style** → cross-project user preferences (`feedback_*.md`) including the new [decision protocol](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_decision_protocol.md). Apply to every project.
- **🎯 Current state** → latest 2026-05-13 handoffs only. Older handoffs archived.
- **🗄️ Archive** → superseded docs; do NOT rely on (kept for git-blame style traceability).

For **multi-repo workflows** (Green Haven ↔ Naturehaven landing site), see [memory/multi_repo_protocol.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\multi_repo_protocol.md).

## 8. Session Lifecycle — checkpoints

Every session has three phases. Don't skip the end phase — it's where memory drift gets caught.

### Session start
1. Auto-loaded: `CLAUDE.md` + `MEMORY.md`. Both already in context — no need to re-read.
2. Run `git status` + `git log -5 --oneline` to see prior-session state (per [feedback_git_status_before_add.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_git_status_before_add.md)).
3. If user references a feature → check the matching `lifecycle_*.md` in MEMORY.md index BEFORE writing code.
4. Pick decision mode per [feedback_decision_protocol.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_decision_protocol.md): autonomous / choice menu / plan-first / one-question.

### Session middle
- Use **TodoWrite** for live tracking (not `tasks/todo.md` unless above Plan-First threshold).
- Verify load-bearing claims with `grep` before typing them in memory files (per §7-H).
- For UI changes: `git push origin main` → verify on Vercel via Chrome MCP. Never localhost.
- For production data actions: preview → wait for user click. Never auto-`.click()` (per §7-I).

### Session end (CHECKPOINT — easy to skip, costly when missed)
Before saying "done" or stopping work:

| Did you... | Then... |
|------------|---------|
| Edit a `lifecycle_*.md` or `firestore_schema_*.md`? | Run `npm run verify:memory` — exit 1 = stop, fix the claim or the code. |
| Touch architecture (schema/CF/rules)? | Update the matching `lifecycle_*.md` SAME session — don't defer. Stale architecture docs cost the next session. |
| Touch 2+ files in one user flow? | Re-read all session diffs end-to-end (per [feedback_self_conflict_check_my_own_changes.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_self_conflict_check_my_own_changes.md)) before claiming done. |
| Get a correction from the user? | Log per §1 Self-Improvement Loop — §7 for recurring project anti-patterns, `feedback_*.md` for cross-project. One-offs stay in commit message. |
| Ship a non-trivial feature OR architectural change? | Write a `next_session_handoff_<date>_<topic>.md` summarizing what shipped + what's pending + verification grep. Add to MEMORY.md 🎯 Current state. |
| Make ANY commit? | Pre-commit hook runs `npm run verify:memory` automatically — don't bypass with `--no-verify`. |

If you only fixed a typo / one-line config / single-file UX tweak, end-checklist boils down to: did you push? did the user verify? Done.
