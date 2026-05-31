# CLAUDE.md — Workflow protocol for The Green Haven

Loaded at every session start. Overrides any default behavior — follow exactly.

## How this file relates to MEMORY.md

Two docs auto-load at session start; they are **complementary, not duplicates**:

- **This file (CLAUDE.md)** — *workflow + stack + recurring anti-patterns* · in the repo · committed to git · "how to work in this codebase". Owns: protocol rules, tech stack table, build/deploy commands, **§7 anti-patterns A-RR** (project-specific lessons that auto-load every session).
- **MEMORY.md** at `~/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/MEMORY.md` — *architecture + history* · user-scoped · NOT committed · "what's in this codebase + what I've learned about this user". Owns: critical rules, system lifecycles, working-style feedback, archive.

**Boundary rule for new content:**
- Workflow / build / deploy facts → here
- A system's behavior, lifecycle, schema → MEMORY.md as `lifecycle_*.md` or reference doc
- A cross-project user preference → MEMORY.md as `feedback_*.md`
- **A project-specific recurring anti-pattern** → §7 below (was previously `tasks/lessons.md`; that file is now archived as `tasks/lessons.md.archive` for git history)

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

- **Recurring anti-pattern in THIS project** (cost 2+ sessions, will likely re-occur) → add to **§7 below** as a new letter (J, K, L...). These are auto-loaded with this file every session. Format: short title · 1-2 sentence rule · code example or grep command.
- **One-off project incident** (specific commit fix, niche edge case) → don't promote; the commit message + lifecycle doc update is enough.
- **Cross-project preference** ("user wants X always") → `~/.claude/projects/.../memory/feedback_<topic>.md`. MEMORY.md "🤝 Working style" indexes them.

**Why no more `tasks/lessons.md`:** It was append-only and rarely opened (neither by user nor agent). Promoting recurring patterns to §7 (which IS auto-loaded) and routing one-offs to commit messages keeps the signal where it actually gets read. Old lessons still live in `tasks/lessons.md.archive` for git-history searches.

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
| Logic | Vanilla JS modules (UMD-ish; `window.X = ...` exports) | `shared/*.js` (~92 files incl. 25 `tenant-*.js` god-file extracts; verify with `ls shared/*.js \| wc -l`) |
| Backend | **Firebase** v11 — Auth · Firestore · Realtime DB · Cloud Functions · Storage | `functions/` (Node CFs); rules in `firestore.rules`, `storage.rules`, `database.rules.json` |
| Hosting | **Vercel** (not Firebase Hosting) | `vercel.json`, `/api/*` serverless fns (e.g. `/api/config`) |
| Build | `esbuild` (bundle minify) | `build.js` |
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
| `npm run test:rules` | Firestore rules CI tests (~70 cases as of 2026-04-28) | Before deploying any `firestore.rules` change |
| `npm run verify:memory` | Mechanical re-verification of every load-bearing claim in `~/.claude/.../memory/lifecycle_*.md` against current code. Fails (exit 1) if any claim's grep returns 0 hits. | **Pre-commit hook calls this automatically.** Fast (~2 sec). Replaces "I think the memory is current" with proof. |
| `npm run verify:memory:coverage` | Above PLUS coverage check — flags code-tick `quoted` identifiers in prose that have no matching verifier (cross-doc). Use `--strict` to fail on coverage gaps too. | When editing a lifecycle doc; before pushing big memory restructures. |
| `npm run verify:memory:all` | Above PLUS fabricated-path scan over handoff/journal/feedback files. Catches wrong template paths (e.g. `wellnessClaimed/{roomId}_2026-04`) whose stripped shape doesn't appear in any lifecycle doc or rules file. Warn-only; `--strict` to block. | At the end of any session that edited a non-lifecycle memory file. |
| `npm run install:hooks` | Installs the committed git hooks (`tools/git-hooks/*`) into `.git/hooks/`. Runs automatically as `postinstall` after `npm install`. | Only if you bypass `npm install` for some reason. |
| `npm run deploy:worktree:prep` / `:cleanup` / `:status` | Copy `functions/.env` from main + `npm install` in `functions/` (worktrees don't inherit either). `cleanup` removes the worktree-local `.env` after deploy; `status` is read-only. Never displays `.env` contents — only key-line counts. | Before `firebase deploy --only functions:<name>` from inside a `.claude/worktrees/*` checkout. |
| `npm run smoke:transfer-tenant -- --building <b> --old <r> --new <r2> --mode variation` | Live E2E smoke for `transferTenant` CF. Dry-run by default — reads source + target rooms, prints expected post-state, verifies pre-conditions. Add `:apply` (or append `--apply`) to invoke `_runVariationMode` / `_runNovationMode` directly via Admin SDK (avoids §7-JJ-fragile dashboard UI). Re-reads post-state and asserts the 6-field contract. **Production-data write** under `--apply` per §7-I. | Closing carryover item from 2026-05-23 daily-bonus session. Run when verifying after CF code changes that touch the carry-over contract. |
| `npm run csp:hash` / `csp:print` | CSP hash regen / print Vercel CSP | If/when CSP comes back from report-only |
| `firebase deploy --only functions:<name>` | Deploy a single CF | After editing `functions/<name>.js` |
| `firebase deploy --only firestore:rules,storage,database` | Deploy rules without CFs | After editing rules files |
| **Service account key** | Rotate annually. **Next rotation: 2027-05.** Frozen CF `generateBillsOnMeterUpdate` is on Node 20 — see `memory/generate_bills_cf_frozen.md` for manual mitigation steps if Node 20 reaches EOL before rotation. | Annual reminder |

Service Worker auto-versions from `VERCEL_GIT_COMMIT_SHA` — no manual `CACHE_VERSION` bump needed.

## 7. Recurring Anti-Patterns — Read Before Touching These Areas

Each pattern cost 2–5 sessions to debug. Check the relevant one BEFORE writing code, not after. Append new patterns here directly when a recurring issue surfaces — see §1 Self-Improvement Loop for routing.

### A. Auth-gated reads in `tenant_app.html`
ANY Firestore/RTDB read that needs `token.room`/`token.building`/`token.admin` claims:
```js
// ✅ CORRECT — always
_onLiffClaimsReady(_subscribeX);

// ❌ WRONG — causes bills/meter to show "ไม่มีข้อมูล" in real LIFF (admin preview works fine)
window.addEventListener('liffLinked', _subscribeX);
window.addEventListener('authReady', _subscribeX);
```
5+ sessions were lost to this. Admin preview bypasses room checks → bug invisible until LIFF test.

### B. Firebase SDK — modular only, no compat API
```js
// ✅ CORRECT
const ref = window.firebaseRef(window.firebaseDatabase, 'bills/rooms/15');
const snap = await window.firebaseGet(ref);

// ❌ WRONG — firebase.database is undefined (v11 modular, no compat layer)
await window.firebase.database().ref('bills').once('value');
```
When in doubt: `grep "firebaseRef\|firebaseGet\|firebaseSet" dashboard.html` for the actual globals.

### C. Modal display — inline style wins over class, AND `''` ≠ `'none'`
```js
// ✅ Modal with a CSS class binding display:none (e.g. .modal, .u-hidden)
modal.style.display = 'flex';   // open
modal.style.display = '';       // close — CSS class fallback wins → none

// ✅ Modal that ONLY has inline style="display:none;..." (no CSS rule!)
modal.style.display = 'flex';   // open
modal.style.display = 'none';   // close — MUST be explicit; '' falls back to block

// ❌ classList alone fails if element has inline style="display:none"
modal.classList.remove('u-hidden');
```
**Decision rule:** before close handler, grep the modal's class in stylesheets. No CSS rule binding `display:none` → `= 'none'` explicit. CSS rule exists → `= ''` is fine.

Debug one-liner: `({inline: m.style.display, computed: getComputedStyle(m).display})` — computed `block` after close = inline-only fallback bug.

2026-05-13 incident: `checklist-template-modal` + `facility-config-modal` were inline-only `display:none` → close handlers cleared display → fell back to `block` (still visible, ปุ่มยกเลิกดู "ไม่ทำงาน"). Fixed in `32902be`.

### D. BillStore — getByRoom not listForYear for single-room queries
```js
// ✅ CORRECT — RTDB bill docs have no 'room' field in the body; filter by path key
BillStore.getByRoom(building, roomId, year)

// ❌ WRONG — b.room is always undefined → returns [] silently
BillStore.listForYear(building, y).filter(b => b.room === roomId)
```

### E. Year formats — 3 different formats coexist
| Source | Format | Example |
|--------|--------|---------|
| `meter_data` Firestore | 2-digit BE | `69` |
| RTDB bills (`BillStore._cache`) | 4-digit BE string | `"2569"` |
| `synthesizeFromMeter` + grid row `y` | 4-digit BE int | `2569` |
Convert: 2-digit BE → CE: `1957 + shortYear`. Always use `BillStore._be(b.year)` to compare.

### F. Recurring symptom → demand state FIRST, propose fix SECOND
If a symptom has appeared before (bills, modals, auth): **stop, ask for ONE observation** before proposing a fix.
```
✅ "ช่วยเปิด DevTools แล้วบอก: currentUser?.email, token claims, network 4xx ที่เห็น"
❌ "ลอง fix X... ถ้าไม่ได้ ลอง fix Y... ถ้าไม่ได้ ลอง fix Z..."
```
1 observation ตัดสาเหตุได้ 80% ของ hypothesis tree ทันที.

### G. Cross-session self-conflict check
After touching 2+ files in the same user flow: re-read ALL diffs from this session end-to-end before saying done. Two individually correct changes can conflict (happened: auth gate blocked URL that same session's login redirect was generating).

### H. Memory identifiers — grep before typing
When writing ANY memory file (handoff, journal, lifecycle): every backtick-quoted path/function/field name must be grep-verified BEFORE typing — not after. Paraphrasing from memory produced 19 errors in one session.
```bash
# Template: before writing `path/to/doc` in a memory file
grep -r "path/to/doc" functions/ shared/ *.html | head -3
```

### I. Production data actions — never automate
Before any action that touches:
- Financial approval (approve meter import, mark bill paid, batch writes to RTDB bills/)
- Bulk Firestore/RTDB write outside a single user's own document
- Admin-only CF trigger via `.click()` or `dispatchEvent`

**Always**: show preview → wait for explicit user click. Never call `.click()` programmatically on approve/confirm buttons.
```
✅ Show the data to be written, wait for user to press the button
❌ document.querySelector('#approveMeterBtn').click()   // blocked by pre-commit hook
```
Root incident (2026-05-01): auto-clicked "อนุมัติและบันทึก" → wrong building data entered Firestore production. Required manual rollback.

### J. Static deploy ≠ live-data verified
Vercel "deploy succeeded" + HTTP smoke test + unit tests + fallback list working — none of these prove a Firestore-dependent feature works for a real signed-in user. Tier 3F (2026-05-13) shipped "verified" only to fail on first admin login because a legacy `RentRoom` doc was returned instead of canonical `rooms`.

**Rule:** Before claiming done on any feature that reads Firestore at runtime:
1. Trigger an authenticated read path (Chrome MCP login → call the read).
2. Log/inspect the actual returned data (canonical IDs, displayName, expected fields).
3. Cross-check vs the assumption — fallbacks/mocks hide drift silently.

**Sub-lesson — empty-collection composite-index verify is trivially-passing.** 2026-05-21 (9): prior session's `firebase deploy --only firestore:indexes` was missing from production, but `OccupancyLog.getByTenant()` returned `[]` (looked "working") because the collection had zero docs and Firestore short-circuits empty queries WITHOUT consulting any composite index. After `--apply` wrote 15 docs, same query threw `failed-precondition: query requires an index`. Verify composite indexes by **state**, not by running the query: `gcloud firestore indexes composite list --format="value(name,state)"` — only `READY` counts as serving. Or seed ≥1 doc that exercises the exact `WHERE field == X` + `ORDER BY field DESC` combo before claiming the index is live.

### K. Defined ≠ wired — grep for callers
A function existing in the codebase doesn't mean it runs. Phase 6 audit caught `prefetchAllPeople()` defined in `shared/tenant-lookup.js:238` but with **zero callers anywhere** — slim tenant docs would have rendered "—" for every name on the admin dashboard.

**Rule:** When a method looks load-bearing (cache-warming helper, prefetch, init function), grep for callers before assuming it's active. "X is defined" ≠ "X runs". Wire bulk-prefetch / cache-warming helpers in the SAME commit they're added.
```bash
grep -rn "prefetchAllPeople\|getPersonSync" shared/ *.html  # who actually calls it?
```

### L. Code-only cleanup ≠ data migrated
`setDoc(..., { merge: true })` only WRITES the fields you specify; it never DELETES old ones. After the Phase 6 "slim tenant doc" code shipped, existing `rooms/15` still had all 40+ duplicate fields because there was no migration.

**Rule:** In handoffs, separate "code-only" from "code + data migration":
- "Future writes are slim; existing docs preserve legacy fields (reader fallback handles this) until one-shot migration runs."
- This is intentional graceful-degradation, not a bug — readers transition cleanly.
- For destructive cleanup, use `FieldValue.delete()` in an explicit migration script (see `tools/migrate-tenant-doc-to-slim.js` template).

### M. "Loadable in browser" ≠ "in production flow"
`payment.html` (923 lines) is in the CSP hash list, has Sentry monitoring, has SRI scripts — looks like a production page. Reading the code: uses `SecurityUtils.getSecureSession()` (NOT Firebase Auth), localStorage-only slip flow (NOT verifySlip CF), no LIFF SDK at all. It's a standalone legacy portal.

**Rule:** Build pipelines (CSP, SRI, Sentry, bundling) don't distinguish "live in production" from "still loadable in browser". Before claiming file X integrates with flow Y:
- Read auth model: Firebase Auth? SecurityUtils? LIFF?
- Check CF calls: `httpsCallable`? `fetch /verifySlip`? localStorage only?
- Verify data source: Firestore? RTDB? base64-in-doc?
- Build-pipeline membership ≠ runtime use.

### N. onSnapshot must have error callback
`onSnapshot(query, onNext)` swallows errors silently. Tier 3I-9 spent ~30 min debugging "stuck loading" — turned out `failed-precondition: query requires an index` was thrown but no callback received it. UI sat at "กำลังโหลด..." forever with zero console output.

**Rule:**
```js
// ❌ silent failure
fs.onSnapshot(q, (snap) => { ... });

// ✅ surfaces errors to console + UI
fs.onSnapshot(q, (snap) => { ... }, (err) => {
  console.error('[ModuleName] subscription failed:', err);
  // also surface to UI: render error state instead of "loading..."
});
```
Debug recipe when subscription doesn't fire: try `getDocs(q)` directly — `getDocs` throws visibly, `onSnapshot` swallows. Composite query needs index → add to `firestore.indexes.json` + `firebase deploy --only firestore:indexes` BEFORE UI deploy (build takes 1-5 min).

### O. Pre-built feature search — Thai keywords + orphaned APIs
Almost wrote 3-4 hours of new code for "tenant chooses bill format (personal/นิติบุคคล)" — feature was already built (`receipt-type-select` + `getReceiptMetaForBill` in `tenant_app.html`). Missed it because grepped English identifiers (`billRecipient|recipientType`) instead of the Thai keyword from the mockup.

**Rule:** Before planning any new feature, search:
1. **Thai keywords** from mockup/screenshot — user said "นิติบุคคล" → `grep "นิติบุคคล"` BEFORE `grep "recipientType"`.
2. **Orphaned `window.X = ...` APIs** — defined but uncalled = unfinished feature waiting to be wired. Often you only need to wire it, not rebuild.
```bash
grep -rn "นิติบุคคล\|บุคคลธรรมดา" tenant_app.html dashboard.html shared/  # Thai-first
grep -rn "window\.getReceiptMeta\|window\.saveCompany" shared/ *.html  # orphaned APIs?
```

### P. UID-drift fixes must traverse EVERY rule layer (Firestore + Storage + CF guards)

Tier 3I checklist debugging (2026-05-14) cost 4 rounds because the same UID-drift bug showed up in three different security layers and each fix only unblocked the next failure:

1. Tenant queries `where tenantUid == authUid` → empty → "ยังไม่มี checklist" (Firestore rule + client query path)
2. Tenant submits photo → permission_denied (storage.rules has same `instance.tenantUid == auth.uid` check)
3. Admin viewer reads photo via `getDownloadURL` → tokenised URL bypasses rules so it works, but the *token itself* is the leak risk (separate concern, same root)

`signInAnonymously` mints a NEW anon UID on every fresh LIFF session, so `instance.tenantUid` (frozen at admin-create time) drifts away from the current `auth.uid` quickly. Any auth check that ties `resource.data.tenantUid == request.auth.uid` will break.

**Rule:** When you fix a "no permission to X" issue with the `claim-match-not-uid-match` pattern in ONE place, grep for the same `tenantUid == auth.uid` pattern in EVERY rule + CF file before declaring it fixed. The pattern lives in:

```bash
grep -rn "tenantUid == request.auth.uid\|tenantUid.*request.auth.uid" firestore.rules storage.rules functions/
```

Canonical replacement: gate by token claims (`request.auth.token.room`, `request.auth.token.building`) matching the path/doc, NOT by uid match. Custom claims survive UID rotation.

### Q. Native dialogs (`confirm`, `alert`, `prompt`) don't render in Chrome MCP screenshots

When the user asks "show me what the dialog looks like", `confirm('...')` returns immediately (Chrome's automation API auto-dismisses it without rendering). Don't try to screenshot the native one — build a styled `<div>` overlay that mimics the OS look, screenshot that, then clean up. See the iOS-style mock-up pattern used 2026-05-14 (`#mock-dialog` injected, screenshotted, removed). The user only needs the LAYOUT preview, not a literal native screenshot.

### R. `fetch()` from LIFF webview must always have AbortController + timeout

LINE's in-app browser caches TLS connections aggressively. A stale cached connection can leave a `fetch()` hanging indefinitely (minutes) before failing, leaving the user staring at a loading overlay. Native `signInWithCustomToken` retry loops (e.g. the 5×backoff one in `_callLiffSignIn`) don't help — the fetch is upstream of them. Every fetch in tenant_app/booking inside the LIFF entry flow must be wrapped:

```js
const ctrl = new AbortController();
const to = setTimeout(() => ctrl.abort(), 12000);  // 12s per attempt
try {
  const resp = await fetch(url, { ..., signal: ctrl.signal });
  ...
} finally { clearTimeout(to); }
```

Specific surfaces with this risk: `_callLiffSignIn`, `verifySlip`, any direct CF HTTPS call (vs httpsCallable, which already has a timeout).

### S. Multiple LIFF apps from the same LINE account share the auth handshake — second open hangs the first

Opening a second LIFF app (e.g. booking) while the first (e.g. tenant_app) is still inside `liff.init` / awaiting `getIDToken` leaves the first tab stuck at "ตั้งค่าสิทธิ์" forever. The second LIFF steals the auth state the first was waiting on. This is a LINE platform constraint, not a code bug — no client retry recovers cleanly because `liff.init` never rejects, it just sits.

Incident 2026-05-14: user opened booking LIFF while tenant_app LIFF was still completing auth → tenant tab hung indefinitely at "ตั้งค่าสิทธิ์".

**Rule:** treat `liff.init` as *can-hang-forever* in multi-LIFF flows. Mitigations (already partly applied in `_callLiffSignIn` via the 12s fetch timeout):

1. Ceiling timer around the whole init flow (e.g. 30s) that surfaces a styled "เปิด LIFF หลายแอปพร้อมกัน — กรุณาปิดแอปอื่นแล้ว Reload" overlay with a Reload button. Never silent-spin.
2. When adding a NEW LIFF entrypoint (booking, future facility-booking-as-LIFF, etc.), call out the conflict in the user-facing instructions ("ปิด LIFF อื่นก่อนเปิด").
3. Don't auto-redirect users between LIFF apps inside one session — force a sign-out → reopen via menu cycle so the prior auth state is cleanly torn down.

Detection during debugging: if a user reports the "ตั้งค่าสิทธิ์" overlay stuck and **no** network errors / no timeouts fired, ask "เปิด LINE LIFF อื่นในเวลาใกล้กันไหม?" before chasing TLS / claim / index theories.

### T. Two admin UIs writing the same Firestore doc with different field names — reader pinned to one of them

When two admin UIs edit the same `buildings/{id}` (or any shared) Firestore doc but choose different field names for the same value (one canonical, one legacy), a downstream consumer that reads only one of those names is invisibly broken from the OTHER UI's perspective. The admin "saves" but the consumer never updates.

Incident 2026-05-14: `buildings/{id}.promptPayId` (written by `building-registry.js:140` Buildings page form) vs `buildings/{id}.promptpayNumber` (written by `dashboard-extra.js:1158` People Mgmt → Owner UI). Bill page (`dashboard-bill.js:655`) read only `promptpayNumber`. After re-seeding `buildings/rooms` via Buildings form, Bill page kept showing `— (ยังไม่ตั้ง)` for ห้องแถว until the user wrote `promptpayNumber` via the OTHER UI. **RESOLVED 2026-05-14** in two stages: (1) `01e88df` made all readers canonical-first + dual-wrote from People-Mgmt UI; (2) `76789c1` eliminated the root cause by deleting the duplicate writer entirely — the vestigial "ข้อมูลการชำระเงิน (ต่อตึก)" section in People Mgmt → Owner is gone, Buildings page is the sole writer. tenant_app reader also migrated to canonical-first.

**Rule:** before adding a new admin UI that edits an existing Firestore doc, grep both for every WRITER of that doc AND every READER. If writer field name doesn't match reader field name, you've just created field drift.

```bash
# Template — replace YOUR_FIELD with the field your new UI is about to write
grep -rn "YOUR_FIELD\|legacy_name_if_known" shared/ functions/ dashboard.html tenant_app.html booking.html
# Confirm there's only ONE writer pattern and ALL readers see it.
```

Fix pattern when drift is already shipped:
1. **Reader fix first** — extend the consumer to read BOTH (`data.canonical || data.legacy || ...`). Safe, additive.
2. **Writer fix** — make the legacy-name writer ALSO write the canonical name (dual-write). Don't drop legacy yet.
3. After ≥1 user-visible cycle of stable dual-write, deprecate: one-off migration `setDoc({canonical: data.legacy}, {merge:true}) + updateDoc({legacy: FieldValue.delete()})`, then drop legacy from reader + writer.

Anti-pattern K (defined ≠ wired) is the function-level cousin of this. Same instinct: grep for callers/readers before assuming a value/function flows where you expect.

### U. `_onLiffClaimsReady(fn)` + idempotency guard + claims-not-yet-set = stale subscription forever

`_onLiffClaimsReady(fn)` registers `fn` on BOTH `authReady` AND `liffLinked` events (plus immediate if already ready). The `authReady` event fires TWICE in LIFF:
1. First when `signInAnonymously` completes — **NO** `token.building` / `token.room` claims yet
2. Second after `signInWithCustomToken` from `liffSignIn` CF — claims now present

`liffLinked` fires once, after the 2nd `authReady`. The whole point of registering on both is to catch whichever fires last and re-run with proper claims.

**The trap:** subscribe functions typically self-guard with `if (_xxxUnsub) return;` for idempotency. But when:
1. First `authReady` (anonymous) fires → `_xxxUnsub = null`, function proceeds with `_taBuilding = ''`
2. `_xxxUnsub` is SET to a stale subscription (wrong building, may even fail with `permission-denied`)
3. `liffLinked` fires with real claims → guard `if (_xxxUnsub) return;` skips re-subscription
4. Stale subscription persists for entire session

This bit twice:
- `_subscribeBroadcasts` (2026-05-15, `95dc4a1`) — bell never showed in LIFF
- `_subscribePaymentConfig` (2026-05-15, `ade5648`) — Nest tenants got `buildings/rooms` PromptPay data

**Rule:** every subscribe function wired through `_onLiffClaimsReady` MUST guard claim presence as the FIRST check, BEFORE setting its `_xxxUnsub`:

```js
function _subscribeXxx() {
    if (_xxxUnsub) return;                  // idempotency
    if (!window.firebase?.firestore) return; // SDK readiness
    if (!_taBuilding) return;                // ← REQUIRED — wait for claims
    // ... only NOW can we set _xxxUnsub
    _xxxUnsub = fs.onSnapshot(query, ..., err => {
        console.warn('[xxx] subscribe failed:', err?.message || err);
        // Reset on permission-denied so liffLinked retry can resubscribe
        if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
            _xxxUnsub = null;
        }
    });
}
```

Audit recipe — find every `_onLiffClaimsReady` wiring and verify each callee has the guard:

```bash
grep -n "_onLiffClaimsReady(" tenant_app.html | grep -v "function _onLiff"
# For each callee, open the function — it MUST have `if (!_taBuilding) return;`
# OR equivalent claim guard (some need _taRoom, some need _taLease, etc.)
```

Related anti-pattern: this is a cousin of N (onSnapshot must have error callback). The error callback's job here is double — surface failures AND reset the unsub so retry can succeed. A bare `console.warn` swallows both halves of the recovery.

### V. `setupXxxListener` that reruns must call the prior unsub before overwriting it

Dashboard `setupMeterDataListener` (and any setup function that stores its unsub in `realtimeListeners.X`) is called every time `initRoomsPage`/`initNestPage` runs — which is on every `roomconfig-updated` event (debounced 250ms, but still fires repeatedly across a session). The original implementation just did `realtimeListeners.meter = onSnapshot(...)`. The OLD unsub function was dropped on the floor, the listener it referenced stayed live in Firestore, AND a fresh listener was added. After 10 rerenders the page had 11 live `meter_data` subscriptions; every real meter write fanned out N times.

Incident 2026-05-15 (`bccabdc`): user reported `✅ Real-time listeners activated for Nest page` + `✅ Meter data updated in real-time` repeating in pairs in the dashboard console. Two diagnostics from the same root cause — repeat init logs + collection-replay running once per stacked listener.

**Rule:** every `setupXxxListener` that assigns into a stable slot (`realtimeListeners.X`, module-level `_xxxUnsub`, etc.) MUST tear down the prior listener first:

```js
function setupMeterDataListener() {
    // …readiness guards…
    if (typeof realtimeListeners.meter === 'function') {
        try { realtimeListeners.meter(); } catch (_) { /* noop */ }
        realtimeListeners.meter = null;
    }
    realtimeListeners.meter = onSnapshot(query, onNext, onError);
}
```

Audit recipe:

```bash
# Any place that assigns into realtimeListeners.X — each must have a prior-unsub guard
grep -n "realtimeListeners\.\w\+ *=" shared/dashboard*.js
# Any setupXxx that returns from onSnapshot without checking — same hazard
grep -rn "= onSnapshot\b" shared/dashboard*.js shared/checklist-manager.js
```

**Difference from U:** U is about `_onLiffClaimsReady` callbacks WANTING idempotent re-entry (`if (_xxxUnsub) return`) but failing because claims weren't ready yet on the first fire. V is about callbacks that genuinely SHOULD rebind (claims now correct, building changed, page reopened) but leak the old listener. The fix in U is "guard claim presence first"; the fix in V is "unsub before rebind".

**Sibling diagnostic:** noisy `console.log` inside the onSnapshot handler made the leak visible. Once the leak was fixed, the per-event log added no diagnostic value (only fired on real changes which the UI already reflects). Per-init/per-snapshot logs in setupXxx functions are usually the *tail* of a stacking bug — drop them once the stacking is closed, not before.

### W. `!important` doesn't beat higher specificity — check the cascade, don't just stamp `!important`

Two cascade conflicts in tenant_app.html (2026-05-15 evening (4)) shipped through static review and were only caught by live `getComputedStyle()` on the deployed page:

1. P1.5 typography — `.page-title-top { font-size: var(--fs-xl) !important }` (specificity 0,1,0) lost to existing `.app-bar h1, .app-bar h2 { font-size: var(--fs-lg) !important }` (specificity 0,1,1). Both had `!important`, so higher specificity won. Result: top-level h1s stayed at 20px instead of 24px. Fix: qualify the selector to `.app-bar h1.page-title-top` (0,2,1) so it actually beats the legacy rule.
2. P2.13 power-card — inline `style="border-left: 4px solid var(--clay)"` (no `!important`) lost to `.card { border-left: 1px solid rgba(0,0,0,0.04) !important }`. Clay accent stripe never showed; only the 1px rgba border. Fix: add `!important` to the inline declaration too — inline styles only win when there are no `!important` rules at all.

**Rule:** when adding a new style that overrides an existing one in this codebase, `!important` is a starting move, not a finishing one. Always verify on the deployed page with:

```js
// In Chrome MCP / DevTools after page load:
getComputedStyle(document.querySelector('YOUR_SELECTOR')).propertyName
// Then if wrong:
[...document.styleSheets]
  .flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
  .filter(r => r.selectorText && el.matches(r.selectorText) && r.style[propertyName])
  .map(r => ({ sel: r.selectorText, val: r.style[propertyName], imp: r.style.getPropertyPriority(propertyName) }))
```

This trace tells you the cascade order. If multiple `!important` rules match, the one with HIGHER selector specificity wins. Specificity primer: inline > id-selector > class/attribute/pseudo-class > element. `.a .b` beats `.b !important`. `.a h1` beats `.h1-class !important`.

**Pre-commit habit:** for any new style rule meant to override an existing one, predict the live computed value out loud before pushing. If the prediction is "well, I added !important so it should win" — that's a yellow flag. Specificity check first.

Related: anti-pattern Q (native dialogs don't screenshot) and S (LIFF multi-tab) — all of these only surface when the deployed page is actually loaded and inspected, not from source review.

### X. `innerHTML = ""` is a footgun — every assignment needs a non-empty fallback

Three independent dead-zone bugs in tenant_app.html (2026-05-15 evening (4) scroll-reduction batch) all traced to the same root pattern: code wrote `el.innerHTML = ""` (or equivalent: `array.map(...).join("")` with empty array, or string-concat of optional values that all turned out empty) and the slot went dark with no fallback.

Three sites caught:

1. `renderBillsList` else branch: `if (window.GhEmptyState) { el.innerHTML = ... } else { el.innerHTML = ''; }` — race during init when GhEmptyState helper hadn't loaded yet (script tag order) → empty slot forever.
2. `renderBillsList` main render path: `el.innerHTML = validBills.slice(0,12).map(b => ...).join('')` — when `_taBills` had items but all were orphan stubs (no `totalAmount` / no charges / no meter), `validBills` was `[]` and the join returned `""`.
3. `showBillsSkeleton`: unconditionally overwrote the static empty-state markup in the HTML with 3 `gh-skeleton` cards, even when no fetch was about to fire (e.g. admin preview path that never gets LIFF claims). The skeletons then sat there forever with no real data to replace them — animated dead-zone.

**Rule:** every `el.innerHTML = X` is a contract that says "I am now responsible for this slot's content." If `X` can be empty, you must EITHER:

a. Branch before the assignment and render an empty state instead of an empty string.
b. Guard the function with `if (!list.children.length)` so you don't wipe content that's still good (idempotent overwrite).
c. Chain a fallback in the assignment: `el.innerHTML = primaryMarkup || fallbackMarkup` where fallback is a literal non-empty string of empty-state HTML.

Detection recipe — anywhere you find `el.innerHTML = ...` in code, ask:

- Can the right-hand side resolve to an empty string?
- If the function runs before the helper it depends on is loaded?
- If the data array is non-empty but filters down to empty?
- If the function runs more than once (idempotency)?

If any "yes", you need a fallback.

**Detection signal in QA:** a card with no border-bottom-content, header above but blank below, or a UI element that vanishes after page reload but came back on force-refresh — all classic `innerHTML = ''` symptoms. Walk every assignment in the relevant render function before declaring it fixed.

Related: anti-pattern N (onSnapshot must have error callback) — same family of "silent failure leaves slot dark" bugs. Both are visible only on the deployed page, not in source.

### Y. `fetch('data:...')` is a network call under CSP — use atob, never fetch, for canvas/file dataURL → Blob

The common cookbook recipe `const blob = await (await fetch(canvas.toDataURL('image/png'))).blob()` works on pages with no CSP. On this app it FAILS because `connect-src 'self' https: wss:` does not include `data:`, and Chromium evaluates `fetch('data:...')` against `connect-src` (treats data URLs as network destinations). The thrown error is the generic `TypeError: Failed to fetch` — same message you'd see for a real network outage, DNS failure, CORS preflight reject, or extension content-blocking. The first instinct is to chase Storage rules, IAM scopes, bucket region, CORS configuration — none of those are the cause.

Incident 2026-05-18: `uploadAdminSignature` failed silently after admin clicked "บันทึกลายเซ็น" — toast "บันทึกไม่สำเร็จ", no rule denial in logs, no upload network request fired. Probe with `uploadBytes(ref, tinyBlob)` from console succeeded (proving rules + auth + bucket all fine). Root cause was the `await fetch(dataUrl)` line ABOVE the upload. Same latent bug existed in `uploadSignature` (tenant); LIFF webview seemed to tolerate it, but it's wrong-by-design either way. Fixed in `cd7f26f` by introducing `_dataUrlToBlob()` helper.

**Rule:** never convert a `data:` URL to a Blob via `fetch()`. Decode the base64 payload directly:

```js
function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid data URL');
  const bin = atob(m[2]);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] });
}
```

Synchronous, no network call, no CSP exposure. Works regardless of `connect-src`.

**Do NOT** "fix" by widening `connect-src` to include `data:`. That lets any script materialise arbitrary content via `fetch('data:...')` (silent data-URL handler bypass) and weakens CSP for every page. The source-side fix is one helper function — the CSP-side fix would touch every HTML in the repo.

Detection recipe:
```bash
grep -rn "fetch(.*toDataURL\|fetch(.*dataUrl\|fetch(.*dataURL" shared/ tenant_app.html dashboard.html
```
Every hit is a latent bug. Inspect each — if the source is a `data:` URL, replace with the helper above.

**Debugging signature for this bug class** (helps recognise it next time):
1. Toast / error says generic "failed to save / upload / process" — no specific code
2. Console shows `TypeError: Failed to fetch` originating from your `await fetch(...)` line
3. Storage / API endpoint shows ZERO requests (not even a failed one) in Network panel — the fetch dies before it hits the wire
4. Direct probe of the downstream call with hand-built Blob succeeds

When you see (3) — no network request fired at all despite calling `fetch()` — CSP `connect-src` is almost always the gate. Check the request's URL scheme (`data:`, `blob:`, `chrome-extension:`) and the document CSP.

### Z. `createCustomToken(uid, claims)` developer-claims are EPHEMERAL — also call `setCustomUserClaims` to persist

`admin.auth().createCustomToken(uid, { room, building, tenantId })` embeds the claims in the FIRST ID token that `signInWithCustomToken` returns. They are NOT written to the user record. Firebase auto-refreshes ID tokens roughly every hour; the new token is minted from the user record, **without** these claims unless `setCustomUserClaims` was also called for them. After that point every server-side rule check on `request.auth.token.<claim>` evaluates to `undefined` and silently rejects the read.

Incident 2026-05-18: `liffSignIn` minted `{ room, building, tenantId }` claims via `createCustomToken` and trusted them. Worked perfectly for ~1 h after sign-in, then every claim-gated feature (checklist, bills, maintenance, deposits, lease, storage) returned `permission-denied` until the user closed/reopened LINE (which re-ran `liffSignIn` and minted a fresh custom token). Fixed in `a5f4e5a` by adding a fire-and-forget `setCustomUserClaims(uid, claims)` right after `createCustomToken`.

**Rule:** any CF that mints a custom token with developer claims MUST also call `setCustomUserClaims`. They're complementary, not alternatives.

```js
// Mint immediate token (so signInWithCustomToken gets claims on the first ID token)
const customToken = await admin.auth().createCustomToken(uid, claims);

// Persist on the user record so EVERY future ID-token refresh re-includes them
admin.auth().setCustomUserClaims(uid, claims)
  .catch(e => console.warn('setCustomUserClaims failed (non-fatal):', e.message));

return { customToken };
```

The `.catch` keeps it non-blocking — the initial token already has the claims, so a transient `setCustomUserClaims` failure doesn't break this session. The next sign-in retries.

**Detection recipe:**
```bash
# Every createCustomToken call must have a setCustomUserClaims twin
grep -rnE "createCustomToken\([^)]*,\s*\{" functions/
# Cross-check each hit against:
grep -rn "setCustomUserClaims" functions/
```
Every CF that appears in the first grep but NOT the second is a latent ~1 h bomb. The failure mode is "works for an hour, then mysteriously breaks for everyone, fixed by re-opening LINE" — extremely hard to root-cause without knowing this pattern.

**Debugging signature** (this bug class is sneaky because it's time-dependent):
1. Feature was working an hour ago for the same user
2. No code changed; user did nothing unusual
3. Now: `permission-denied` on Firestore/RTDB/Storage reads gated by `request.auth.token.<claim>`
4. Closing the LIFF / re-signing-in temporarily fixes it (until next ~1 h refresh)
5. Hardcoded admin paths still work (admin: true IS persistent — admins use the proper SDK flow)

Cousin pattern to §7-P (UID-drift fixes must traverse every rule layer) and §7-U (claim-first guard in subscribe) — all three are about claims not arriving where rule eval expects them.

### AA. Pre-existing CF search — grep `functions/` before writing a new scheduled CF

Mid-S1 of the 2026-05-19 lease auto-notifier sprint, I wrote ~120 LOC of a brand-new `leaseExpiryNotifier` CF (daily-scheduled, scans tenants, writes notifications) — then discovered `functions/remindLeaseExpiry.js` already ran daily 08:00 BKK with the exact same 4 tiers (60/30/14/expired) + anti-spam + region. The new file was deleted; the sprint pivoted to **augmenting the existing CF** (added `ensureLeaseNotificationDoc()` write inside the existing fire block). Wasted ~10 min + a confusing dead-end commit before the architectural pivot.

Root cause: planned from the feature name ("lease expiry notifier") without grepping `functions/` for related domain words first. The existing CF used the verb "remind" not "notify"; the doc index in MEMORY.md (`lifecycle_scheduled_jobs.md`) DID list it but I didn't read that file in the planning phase.

**Rule:** before writing a new scheduled CF (or any CF in an existing feature area), grep `functions/` for related domain keywords AND read the relevant lifecycle doc. Especially:

| Domain | Grep targets |
|--------|--------------|
| Reminders / notifications | `remind*`, `notify*` |
| Cleanup / archival | `cleanup*`, `archive*` |
| Sweeps / batches | filename suffix `Scheduled` |
| Domain keywords | lease, bill, slip, expir, etc. |

Detection recipe (run BEFORE writing functions/<newCF>.js):

```bash
# Tier 1: existing files in the domain
ls functions/ | grep -iE "lease|expir|notif|remind"

# Tier 2: any CF that matches the domain keyword
grep -rln "pubsub.schedule" functions/ | xargs grep -l "<domain keyword>"

# Tier 3: lifecycle doc — read it end-to-end if it exists
grep -l "<feature name>" ~/.claude/projects/*/memory/lifecycle_*.md
```

If anything matches, READ those CFs end-to-end before designing the new one. 80% of the time you'll augment instead of duplicate.

**Why this is its own anti-pattern (not just a workflow rule):** the cost is invisible until it bites. Writing 100 LOC of new code, getting halfway through deploy, then realizing you duplicated an existing CF means: revert the new file, untangle the test data, ask the user about scope, replan. The frontend cousin (anti-pattern O) catches the same class of mistake on the HTML side; this one closes the loop on the CF side.

Related: §7-K (defined ≠ wired) is also about discovery — what's in the code vs what runs. §7-K assumes you found the function; this one is about finding it in the first place.

### BB. `window._liffClaims` is a phantom — always use `_taBuilding` / `_taRoom` globals

`window._liffClaims` is never assigned anywhere in this codebase. Any code that reads it gets `{}` every time, silently producing empty strings instead of real claims — causing auth-gated pages to appear stuck (⏳ forever) with no console error.

```js
// ❌ WRONG — window._liffClaims is never set; tok is always {}
const tok = window._liffClaims || {};
_clBuilding = tok.building || 'rooms';  // always 'rooms'
_clRoomId   = tok.room     || '';       // always ''

// ✅ CORRECT — same source every other auth-gated subscriber uses
_clBuilding = _taBuilding || 'rooms';
_clRoomId   = _taRoom     || '';
```

The canonical source of room and building for auth-gated code is:
- `_taBuilding` / `_taRoom` — module-level globals in `tenant_app.html`, set by `detectRoomBuilding()` (from localStorage/sessionStorage) and overwritten with real values at `linkAuthUid()` BEFORE `liffLinked` fires (lines 9257-9258)
- `window._tenantAppBuilding` / `window._tenantAppRoom` — same values exposed globally

Audit recipe — grep for any remaining phantom reads before adding new auth-gated code:
```bash
grep -n "_liffClaims" tenant_app.html
# Should return 0 results. Any hit = bug.
```

2026-05-17: fixed in `_clInitOnce`, warm-up callback, and facility-booking `showSubPage` handler (commit `55f6295`). Checklist page was stuck at ⏳ forever; facility-booking read the same phantom object. Same class as §7-A (wrong auth hook) but specifically about a non-existent object rather than a wrong event.

### CC. `let X` at script top-level is NOT on `window` — cross-script readers see `undefined`

Multiple `<script>` tags share the global scope ONLY for `var` and `function` declarations. `let` and `const` at script top-level are **block-scoped to that one `<script>` tag** — sibling scripts cannot see them via `window.X` OR via bareword lookup.

```html
<!-- script-A.js -->
let currentEditTenantId = null;            // block-scoped to THIS script
function setIt() { currentEditTenantId = 'abc'; }  // implicit-global write IF non-strict — silently DIFFERENT variable from above

<!-- script-B.js (sibling) -->
console.log(window.currentEditTenantId);   // undefined — the `let` is invisible here
```

Incident 2026-05-19: PDPA §32 erasure (`dashboard-pdpa-erasure.js`) reads `window.currentEditTenantId`. The value is declared `let currentEditTenantId = null;` in `dashboard-tenant-modal.js`. Cross-script read → `undefined` → toast "ห้องนี้ยังไม่มี tenantId" even though tenant modal clearly showed สมชาย สิบห้า ห้อง 15. Latent since the PDPA admin UI shipped 2026-05-14. Fixed in `shared/dashboard-tenant-modal.js` by converting the 3 declarations + 5 assignment sites to explicit `window.X = ...`.

**Rule:** anything that needs to be visible across `<script>` tags MUST be either:
- `window.X = ...` at top-level declaration AND at each assignment site (explicit, recommended)
- `var X = ...` (works via hoisting but easy to miss; non-strict-mode-only)
- NEVER `let X = ...` at top level if a sibling script reads it

Audit recipe — before adding a new file that reads `window.X` from a sibling file:
```bash
# Find the WRITER of X
grep -rn "^\s*\(let\|const\|var\|window\.\)\s*X\b" shared/
# If it's `let`, the read won't work. Convert writer to `window.X` first.
```

Closely related to §7-T (two writers, one reader — field-name drift) and §7-BB (phantom window object). All three are "data flows differently than the code suggests" patterns. The §1 verify-via-grep doctrine catches drift in memory docs; this anti-pattern catches it in JS module boundaries.

### DD. Lifecycle CFs that touch one collection must also update sibling collections — UI readers fall through

A specialized form of §7-L (code-only cleanup ≠ data migrated). When a CF performs a state-transition (archive, transition, revert), it must update EVERY collection that downstream readers might fall through to. Missing one ⇒ orphan rows that UI reads as if the transition never happened.

Incident 2026-05-20: user reported "ห้อง 15 ยังโชว์ผู้เช่า" after `archiveTenantOnMoveOut` returned success. Investigation:

1. `archiveTenantOnMoveOut.js` clears `tenants/{b}/list/{r}` (sets `name=''`, `tenantId=''`, deletes `.lease` subobject, `status='vacant'`) ✓
2. `archiveTenantOnMoveOut.js` does **NOT** touch `leases/{b}/list/{leaseId}.status` — stays `'active'`
3. `LeaseAgreementManager.getActiveLease(b, r)` in `shared/lease-config.js`:
   - L62: Phase 4 SSoT path checks `ssotDoc.lease?.leaseId` — fails (lease subobject deleted) ✓
   - L88-94: Legacy fallback iterates `getAllLeases()` and finds the orphan `status='active'` row → returns lease with tenant info
4. `TenantLookup.getTenantByRoom(b, r)` calls `getActiveLease` → gets orphan → returns fake tenant data
5. UI tenant modal shows "สมชาย สิบห้า · 🟢 มีผู้เช่า" even though tenant was archived

Same bug present in `transitionToPlayer.js` (player transition) and `revertTransitionToPlayer.js` (kin restore — should re-activate the lease).

**Rule:** every lifecycle CF must update **all collections that UI fall-through chains depend on**, not just the "main" doc it owns. For tenants the fall-through pairs are:

| Primary write | Sibling that MUST also be updated |
|---|---|
| `tenants/{b}/list/{r}` cleared | `leases/{b}/list/{leaseId}.status` → `'ended'` |
| `tenants/{b}/list/{r}` restored | `leases/{b}/list/{leaseId}.status` → `'active'` + delete `endedAt`/`endReason` |
| `people/{tenantId}` upserted | `liffUsers/{lineUserId}.role` set (transitionToPlayer already does this) |

Detection recipe (run when reviewing or writing a new state-transition CF):
```bash
# 1. Identify all places UI readers fall through to in this domain
grep -rn "filter.*status === 'active'\|getActive\|status: 'active'" shared/

# 2. For each fall-through source collection, the CF must update it.
#    Specifically for tenant lifecycle:
grep -nE "leases/|leaseRef|LeaseAgreement|liffUsers" functions/archiveTenantOnMoveOut.js functions/transitionToPlayer.js functions/revertTransitionToPlayer.js
# Each CF must touch leases/{b}/list/{leaseId} — if grep returns 0 hits in a CF, the bug is back.
```

Fix shipped 2026-05-20: all 3 CFs now `batch.update` the lease doc in the SAME batch as the tenant doc clear/restore. Plus `tools/fix-orphan-leases.js` one-shot — finds existing orphans (active lease whose `tenants/{b}/list/{r}.tenantId` is empty or mismatched) and marks them `status='ended'`.

Closely related to §7-L (data migration vs code cleanup), §7-T (writer/reader drift), §7-CC (cross-script identifier resolution). Family: "the write looked right, but a downstream reader sees something different than you intended."

### EE. Top-level `function X()` + `window.X = wrapper` self-recursion — capture-before-reassign required

Classic script-mode trap. In a regular `<script>` tag, top-level `function X()` only creates a property on `window` — it does NOT create a separate lexical binding. Reassigning `window.X = function() { X(); ...}` overwrites that property; the bareword `X()` inside the wrapper looks up via the global object and finds the wrapper itself → infinite recursion.

Incident 2026-05-20 (Phase 2 S6 commit `48b47ed`): commit "collapsed" what it called a redundant double-assign:

```js
// BEFORE (working — captures original BEFORE reassign):
function updateRoomStatuses() { /* repaint room pills */ }
window.updateRoomStatuses = updateRoomStatuses;            // L572 — looked "dead"
const originalUpdateRoomStatuses = window.updateRoomStatuses;  // freeze reference
window.updateRoomStatuses = function() {
  originalUpdateRoomStatuses();   // ← captured = inner fn, safe
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();
};

// AFTER S6 (broken — relied on bogus "JS scope precedence"):
function updateRoomStatuses() { /* repaint room pills */ }
window.updateRoomStatuses = function() {
  updateRoomStatuses();           // ← bareword → global → wrapper → ∞
  updateOccupancyDashboard();
  updateLeaseExpiryAlerts();
};
```

The S6 commit message claimed "Local bareword references inside this file still hit the inner `updateRoomStatuses()` function via JS scope precedence (no recursion)" — that's wrong. Top-level `function` decl in a classic script populates the global object; there is no separate "inner" lexical binding to fall back to. `RangeError: Maximum call stack size exceeded` fires on first call (DOMContentLoaded handler) → dashboard skeletons never resolve → user sees blank cards.

**Rule:** any wrapper that reassigns `window.X` while wanting to call the original MUST capture the reference first:

```js
const _innerX = window.X;        // freeze the current value BEFORE the next line
window.X = function (...args) {
  _innerX(...args);              // captured reference — no recursion
  /* extra work */
};
```

The capture name should be obviously distinct (`_innerX`, `_origX`) to telegraph the pattern. `const` (not `let`) emphasises immutability.

**Detection recipe** — grep for the trap shape before committing:

```bash
# Any window.X = function(){...} that calls X() inside via bareword
grep -rnE "^window\.\w+\s*=\s*function" shared/ tenant_app.html dashboard.html | while read line; do
  # If the wrapper body contains the same bareword as the assigned property → suspect
  : # manual review — automated detection here is messy because the body spans lines
done
```

Real-world test: load the deployed bundle in Chrome MCP and trigger every code path that calls the wrapper. RangeError will fire on the first invocation; "static analysis passed" + "git push succeeded" + "static smoke walked the page" all proved insufficient for S6 — the page rendered when the wrapper wasn't called, broke the moment it was.

Closely related: §7-CC (`let X` at top-level isn't on `window`) is the inverse pattern. `let` creates a lexical binding but no window property; `function` declaration creates a window property but no separate lexical binding. Both cause silent cross-script breakage.

### FF. Reversing custom claims — `setCustomUserClaims({})` alone leaves a ~1h leak

§7-Z established the FORWARD direction: minting a token without also calling `setCustomUserClaims` is ephemeral (claims gone after ~1h). The REVERSE direction has its own three-part contract that all sites must observe together:

1. **Server (CF):** `admin.auth().setCustomUserClaims(uid, {})` strips claims from the user record. Required, but insufficient alone.
2. **Server (CF):** `admin.auth().revokeRefreshTokens(uid)` updates `tokensValidAfterTime`. Without this, the SDK's next refresh succeeds and mints a new token from the record state (now claim-less) — but the SDK only refreshes when it decides to, typically every ~50 min.
3. **Client (fast-path):** `user.getIdTokenResult(true)` — force-refresh — on session-restore paths. Without it, the client SDK serves the CACHED ID token (still has claims) until the token's natural ~1h expiry. The user can keep walking back into authenticated surfaces with stale claims for nearly an hour.

Incident 2026-05-20: `unlinkLiffUser` shipped (1) and (2) in commit `ba084ef` but the tenant_app `_callLiffSignIn` fast-path still used `getIdTokenResult()` cached. Result: admin clicks 🔌 ยกเลิกการเชื่อม, server says "claims gone", but the user's open LIFF tab returns `linked: true` from the fast-path (cached token has full claims) → ลูกบ้านยังเข้าห้องได้. User reported it. Fix in `3e159ff` switched fast-path to `getIdTokenResult(true)` + signOut on throw + fall through to liffSignIn POST → 403 unlinked → S2 mode.

**Rule:** every claim-reversal CF (unlinkLiffUser, archiveTenantOnMoveOut, transitionToPlayer when it removes a role, future kin-removal flows) must do ALL THREE legs:

```js
// In the CF, AFTER batch.commit:
const uids = [deterministicUid];
if (legacyUid && legacyUid !== deterministicUid) uids.push(legacyUid);
await Promise.allSettled(uids.map(async u => {
  try {
    await admin.auth().setCustomUserClaims(u, {});
    await admin.auth().revokeRefreshTokens(u);
  } catch (e) {
    // user-not-found expected when legacy anon UID was cleaned up earlier
    if (e?.code !== 'auth/user-not-found') console.warn(...);
  }
}));
```

```js
// In any client "is the cached session still valid?" fast-path:
const tr = await auth.currentUser.getIdTokenResult(true);  // force network refresh
// On throw (auth/user-token-expired post-revoke): signOut + fall through to fresh sign-in.
```

**Detection recipe:**

```bash
# Every claim-reversal CF must call BOTH setCustomUserClaims + revokeRefreshTokens
grep -rln "setCustomUserClaims\s*(\s*\w\+\s*,\s*{}" functions/  # claim strippers
grep -rln "revokeRefreshTokens" functions/                       # token revokers
# Diff the two lists. Anything in the first but not the second is half-finished.

# Every client fast-path that trusts a cached ID token for auth-gated rendering
grep -rn "getIdTokenResult()" tenant_app.html dashboard.html shared/
# Each hit needs justification — for unlinked-tolerant paths it should be (true).
```

**Backfill required when shipping this pattern late:** if a CF was deployed in the (1)-only state, run a one-shot script that walks the relevant Firestore status field and applies (1)+(2) to every existing record. Template: `tools/backfill-unlinked-claims.js` (mirror of `tools/backfill-liff-claims.js`). Without the backfill, the existing N records keep stale claims until manually re-unlinked. Cost is one Firebase Admin pass per record.

Closely related to §7-Z (forward minting also needs the persistent-claims dual-write). Family: "Firebase Auth state has two halves — the user record and the cached ID token — and you must explicitly invalidate both, or one will leak."

### GG. LIFF redirect strips URL `?query=params` — use localStorage for sticky toggles

When the user opens `https://liff.line.me/<channelId>?debug=1` (or any LIFF endpoint URL with a query param), LINE's redirect to the configured webview endpoint can DROP the query string. `?debug=1`, `?next=/dashboard`, `?coupon=abc`, custom feature-flag toggles — none of these are reliable in LIFF. The same URL works perfectly in Safari/Chrome (because there's no LIFF redirect involved), so the bug is invisible during desktop testing.

Incident 2026-05-21: `booking.html` shipped an on-screen debug panel gated on `/[?&]debug=1/.test(location.search)`. Tester appended `?debug=1` to the LIFF URL → LINE webview opened the page but the query param wasn't in `location.search` → panel never showed. We thought the panel was broken (`DOMContentLoaded` timing issue was a separate cousin bug also fixed in the same session) when in fact the trigger never fired.

**Rule:** any URL-driven toggle that must survive LIFF redirect MUST persist to `localStorage` on first detection, then read from BOTH `location.search` AND storage on every subsequent visit:

```js
let _toggleOn = /[?&]foo=1/.test(location.search);
const _toggleOff = /[?&]foo=0/.test(location.search);
try {
  if (_toggleOff) localStorage.removeItem('toggle_foo');
  else if (_toggleOn) localStorage.setItem('toggle_foo', '1');
  else if (localStorage.getItem('toggle_foo') === '1') _toggleOn = true;
} catch (_) { /* storage disabled — non-fatal */ }
```

Always provide an explicit OFF trigger (`?foo=0` here) — otherwise the toggle is sticky forever once set.

**Affects:** `tenant_app.html`, `booking.html`, any future LIFF entrypoint. Especially relevant for QA / debug flags, deep-link parameters, and feature-flag overrides.

**Detection recipe:** any new `URLSearchParams`/`location.search` lookup added to a LIFF-entry HTML must have a sibling localStorage persistence path, OR a comment explaining why ephemeral-only is intentional.

```bash
grep -rn "location.search\|URLSearchParams" tenant_app.html booking.html
# Every hit on a LIFF-loaded page is a candidate for query-strip bug.
```

Family with §7-S (LIFF auth multi-instance) and §7-R (LIFF webview TLS stale): all are "LIFF behaves differently from a normal browser, and the difference is invisible until you test on LINE itself."

**Related extension to §7-R:** the original §7-R was scoped to `fetch()` in LIFF webview. Same session (2026-05-21) confirmed it applies equally to `firebase-database`'s `get()` — `loadRoomsConfig` hung at "🌿 กำลังโหลดข้อมูลห้อง…" indefinitely waiting on `firebaseDatabaseGet(ref(db, 'rooms_config/rooms'))` until the user gave up. Fix is identical: `Promise.race([get(ref), new Promise((_, rej) => setTimeout(() => rej(new Error('rtdb-timeout')), 5000))])`. So §7-R's rule should be read as "any await on Firebase SDK that goes over the wire (fetch, RTDB get, Firestore getDoc, getDocs, storage uploadBytes) in LIFF webview must have a Promise.race timeout" — not just fetch.

### HH. Global `onAuthStateChanged` anon fallback races with deliberate `signOut → signInWithCustomToken` swap on LIFF pages

Classic recurring auth-race trap that ate ~3 sessions before root cause was found. A LIFF-entry page (tenant_app.html) had an old global handler that auto-called `signInAnonymously()` whenever `currentUser` became null — vestigial from the pre-`liffSignIn` flow but never removed. The `_callLiffSignIn` swap path deliberately calls `auth.signOut()` (to wipe a stale admin/email session from IndexedDB before installing the new `line:Uxxx` identity), which fires the global handler → kicks off `signInAnonymously()` asynchronously → races the awaited `signInWithCustomToken()`. Whichever network call resolves LAST wins. When anon wins (~20-40% of opens, depends on TLS cache state and network), the user ends up with a random Firebase anonymous UID instead of `line:Uxxx`. Every server gate keyed on `auth.uid` then sees the wrong UID — checkable via `auth.uid` not starting with `line:` or `book:` AND no useful claims.

Symptoms (very specific signature — recognise this and check the global handler FIRST):
1. Tenant works inside LIFF for one session, suddenly hits permission-denied on a feature gated by `request.auth.uid == resource.data.linkedAuthUid` (lease doc, checklist photo, custom CF SoT check)
2. `console.log(auth.currentUser.uid)` shows a random alphanumeric UID, NOT `line:Uxxx`
3. `getIdTokenResult()` returns claims with NO room/building/admin/role
4. CF logs show `caller.uid=<random>` not matching `linkedAuthUid=line:Uxxx`
5. Closing LINE + reopen sometimes fixes it (because the race resolves differently on second try)

**Rule:** any page that drives auth via `signOut → signInWithCustomToken` (LIFF pages) MUST NOT have an unconditional `signInAnonymously` fallback in a global `onAuthStateChanged` handler. Either:

a. **Remove the anon fallback entirely** if the page is LIFF-only (booking.html pattern — just `_authUid = user?.uid || null;`).
b. **Gate the anon fallback on `!/Line\//i.test(navigator.userAgent)`** if the page also serves non-LIFF visitors needing isSignedIn() reads (marketplace, community feeds).

```js
// ✅ CORRECT — LIFF gate prevents the race
onAuthStateChanged(auth, async (user) => {
  if (user) { window._authUid = user.uid; dispatchEvent(new Event('authReady')); return; }
  const inLine = /Line\//i.test(navigator.userAgent);
  if (inLine) { dispatchEvent(new Event('authReady')); return; }  // _callLiffSignIn owns auth here
  try { await signInAnonymously(auth); } catch (err) { ... }
});

// ❌ WRONG — global anon fallback races signInWithCustomToken
onAuthStateChanged(auth, async (user) => {
  if (user) { ... return; }
  try { await signInAnonymously(auth); } catch (err) { ... }
});
```

**Detection recipe** — audit every LIFF-entry HTML for this pattern:

```bash
# Find pages that call signInAnonymously
grep -rn "signInAnonymously" tenant_app.html booking.html login.html dashboard.html
# Cross-check against pages that also call signInWithCustomToken
grep -rn "signInWithCustomToken" tenant_app.html booking.html login.html dashboard.html
# Any file in BOTH lists is suspect — if its onAuthStateChanged has an unconditional
# anon fallback, the race is latent.
```

**Why it's hard to spot in code review:**
- The global handler and `_callLiffSignIn` are 9,000+ lines apart in tenant_app.html. Reading either in isolation looks fine.
- The race is intermittent (depends on network timing). "Works on my machine" + "works when I reload" hide it.
- The comment on the legacy anon fallback claimed "Anonymous MUST stay enabled" — anchoring to a constraint that no longer applied (linkAuthUid had been replaced by liffSignIn long ago, but nobody updated the comment).
- The symptom (random anon UID) looks superficially like "user not signed in yet" — easy to attribute to a different bug class.

**Lesson on vestigial code:** when an architectural change replaces an old auth flow (linkAuthUid → liffSignIn), grep for EVERY use of the old primitives (`signInAnonymously`, `signInAnonymously(auth)`) and either delete them or document why they must stay. The half-removed migration leaves race-prone hybrids that bite later. Comments that say "X is required because Y" become time bombs when Y goes away.

**Sibling patterns:**
- §7-Z (custom-token claims are ephemeral without `setCustomUserClaims`) — same "auth half-fixed during refactor" family. Both bugs ate a session before root cause was found, both fixes were 5 lines, both vestigial issues from incomplete migrations.
- §7-P (UID-drift fixes must traverse every rule layer) — when the UID flips unexpectedly, every place that checks UID breaks. Same root cause class: the UID didn't end up where the system expects.
- §7-U (claim-first guard in subscribe) — different bug, same lesson on multiple-auth-events-firing.

Fix landed 2026-05-22 (commit `4d40328`) by gating the anon fallback at [tenant_app.html:177](tenant_app.html:177) on `!/Line\//i.test(navigator.userAgent)`. Auto-recovery in `_getLeaseSignedUrl` (§Stale LIFF webview session in auth_liff_sot.md) retained as belt-and-suspenders for one release cycle.

### II. CSP hash drift accumulates silently during Report-Only era, bombs on enforce flip

CSP hashes in `vercel.json` for inline `<style>` and `<script>` blocks must be regenerated **every time** the inline content changes. While `Content-Security-Policy-Report-Only` is the active header, drift is invisible — browsers log a CSP report (often nowhere visible) and render the page anyway. The instant the header flips to enforce mode (`Content-Security-Policy`), all accumulated drift becomes simultaneous blockers — pages render with no `<style>` applied (native browser defaults), or inline `<script>` handlers stop firing.

Incident 2026-05-23: fervent-kare merged with `Content-Security-Policy` enforce flip. Login.html (commit `4ad53ce fix(login): pin input text color`), dashboard.html, tenant_app.html, tax-filing.html, audit-log-viewer.html, payment.html, booking.html, index.html — all 8 had `<style>` and/or `<script>` edits since `54ce1cb fix(csp): roll back to Report-Only mode`. None regenerated CSP hashes. Result: production-wide CSS failure on first user load after the enforce flip. User sent a before/after screenshot of login.html with "page broken" symptoms — root cause took ~3 minutes to find once the verify-via-grep doctrine pointed at `vercel.json` history.

**Rule:** ANY edit to an inline `<style>` or `<script>` block in ANY tracked HTML (8 files: `index/login/dashboard/tenant_app/tax-filing/audit-log-viewer/payment/booking.html`) MUST be followed by hash regen in the same commit:

```bash
npm run csp:hash                     # rebuilds tools/csp-hashes.json
node tools/update-vercel-csp.js      # writes the new CSP value into vercel.json (added 2026-05-23 in commit 9f29338)
git add vercel.json tools/csp-hashes.json
```

The 2-tool sequence is mandatory because `csp:hash` only updates `tools/csp-hashes.json`; `csp:print` only prints to stdout (was designed for hand-pasting); only `update-vercel-csp.js` writes to vercel.json. Pre-2026-05-23 instructions said "copy from csp:print into vercel.json" — that's error-prone, and the error mode is silent under Report-Only.

**Detection recipe — pre-commit check:**

```bash
# If you edited any of these files, regen is mandatory:
git diff --name-only HEAD | grep -E "^(index|login|dashboard|tenant_app|tax-filing|audit-log-viewer|payment|booking)\.html$"

# Then verify CSP is in sync:
node tools/compute-csp-hashes.js > /tmp/new.json
diff <(jq -S . tools/csp-hashes.json) <(jq -S . /tmp/new.json)
# Non-empty diff = hashes drifted → run update-vercel-csp.js
```

**Pre-commit hook (landed 2026-05-23):** `tools/git-hooks/pre-commit` §G now detects this automatically — staging any of the 8 tracked HTMLs triggers a regen + drift compare against current `tools/csp-hashes.json` and `vercel.json`. Drift blocks the commit with the exact regen instructions. The hook backs up + restores both files so a blocked commit leaves no mutation behind. Re-installed via `npm run install:hooks` (also runs on `npm install` postinstall).

**Debugging signature** (this bug class is sneaky because the symptom looks like a CSS file failure, not a CSP problem):

1. Production page renders with **NATIVE browser styling** — no card layouts, no rounded corners, no brand fonts. Form elements look unstyled.
2. CSS files (`shared/brand.css`, `shared/components.css`) load with status 200 and have rules. JS `document.styleSheets[0].cssRules.length` returns >0.
3. `document.body.classList = ""` and `getComputedStyle(document.body).backgroundColor` returns `rgba(0,0,0,0)` (transparent default).
4. **The inline `<style>` block exists in the HTML source** but rules from it don't apply.
5. **No obvious console error** about CSP — the violation log lives in the dev tools "Issues" panel, NOT the console by default. Chrome MCP `read_console_messages` won't see it without explicit pattern matching `Refused to apply|Content Security Policy`.
6. Filter network requests for the CSS files — they're 200 with content. So the page CAN load CSS, but inline `<style>` defining the page-specific classes (`.login-container`, `.user-type-btn`, etc.) is being **stripped silently by CSP**.

When you see (1) + (2) + (4) simultaneously: hash drift is the first hypothesis. Run `openssl dgst -sha256 -binary <<< "$(awk '/<style>/,/<\/style>/' page.html | sed '1d;$d')" | openssl base64` and compare against vercel.json. Mismatch confirms it. (Note: the `tools/compute-csp-hashes.js` script normalizes CRLF→LF per feedback_hash_tools_lf_normalize.md; manual openssl will give a different hash on Windows checkout — trust the tool's output.)

**Why "ห้องแถว" / "Nest" labels lied during this incident:** when verifying booking.html anon-prospect read of `buildings/*`, page text showed `displayName` strings → I declared "Firestore read works." False positive — those strings are HARDCODED at [booking.html:779,781](booking.html:779) ("ห้องแถว" + "Nest" appear in literal HTML as building-tab labels, NOT pulled from Firestore until the LIFF flow continues). Anti-pattern lesson: when verifying live data, never trust visible text alone — confirm via either (a) a Firestore network request to `firestore.googleapis.com/v1/projects/.../buildings/X`, OR (b) a JS dump of the in-memory state object (e.g. `state.buildings`, `window._buildingsList`). Reading the page is the WRONG primitive when content is also serveable from cached HTML.

**Family:**
- §7-W (`!important` doesn't beat higher specificity) — same family of "CSS appears to work but doesn't; needs deployed-page inspection." Both only surface on real Vercel deployments.
- §7-G (cross-session self-conflict check) — applies here: I should have re-read all session diffs (fervent-kare's `vercel.json` change PLUS the chain of recent inline-style edits) end-to-end before declaring "deploy + verify done." A 30-second `git log -10 --oneline -- '*.html'` would have flagged the open CSP-enforce-vs-hash-drift question.
- §7-J (static deploy ≠ live-data verified) — extension: static deploy ≠ live-page-render verified. Vercel showed "deploy succeeded" on every pre-2026-05-23 fervent-kare push. Production was broken.

Fix landed 2026-05-23 (commit `9f29338`) by `npm run csp:hash && node tools/update-vercel-csp.js && git commit vercel.json tools/csp-hashes.json tools/update-vercel-csp.js` → push → Vercel redeploy → login.html visually verified back to the intended dark-green-gradient + 450px white card design.

### JJ. `btn.click()` timing race — event delegation hub not registered at 900ms checkpoint

`btn.click()` routes through the event delegation hub in `shared/dashboard-main.js`. That hub is registered **inside** a `DOMContentLoaded` callback that first `await`s Firebase ready (up to 2s). Any programmatic click fired before that await resolves silently drops — no handler is listening yet.

Incident 2026-05-23 (commit `c32a5d9`): the 900ms DOMContentLoaded timer in `dashboard-home-live.js` called `btn.click()` to trigger `setYear → initDashboardCharts`. On cold loads, Firebase was still initializing so the delegation hub wasn't registered yet. Click fired, nothing handled it, `initDashboardCharts` never ran, `dash-cold-skeleton` persisted indefinitely. `_initialDashboardYear = true` (timer fired) AND `_dashRenderCooldownUntil` set — so the `_waitForHistStore` onChange rerender was blocked within the 1s cooldown window. No subsequent trigger. Skeleton stuck forever.

**Rule:** never use `btn.click()` for programmatic initialization that races DOMContentLoaded. Call the target function directly. Pass `btn` as an argument if the function needs it for UI highlighting.

```js
// ❌ WRONG — relies on event delegation hub being registered (may not be at 900ms)
if (btn) btn.click();
else if (typeof setYear === 'function') setYear(beYear, null);  // fallback never reached when btn exists

// ✅ CORRECT — direct call, always works; btn passed for active-tab highlight
setYear(beYear, btn || null);
```

Detection recipe:
```bash
# Timer-triggered programmatic clicks on data-action elements — potential race
grep -rn "setTimeout" shared/ dashboard.html | grep "\.click()"
# Cross-check: is the target function's event delegation hub registered in a DOMContentLoaded async callback?
grep -n "DOMContentLoaded.*async\|addEventListener.*click" shared/dashboard-main.js | head -5
```

Sibling patterns: §7-A (wrong event timing for auth-gated reads), §7-U (claims not ready on first auth event fire). All three are "the trigger fired but the handler wasn't ready yet" variations.

### KK. Optimistic local write vs cached onSnapshot reconciliation race

When a UI optimistically writes localStorage (set marker, close modal) on user action, and a parallel `onSnapshot` reconciliation block "fixes stale local state" by clearing localStorage when the server snapshot says no — there's a race window where the FIRST onSnapshot fire is from local cache (still has pre-action state). The reconciliation then ERASES the optimistic write before the second server-confirmed snapshot can deliver the new state.

Symptoms:
1. User clicks claim/bookmark/etc. → state appears applied
2. Toast/feedback may have shown "success"
3. On next session (or even seconds later), state is gone — appears as if action never happened
4. localStorage marker silently vanishes — no console error

Root cause timeline:
```
T=0       User action → optimistic localStorage write + UI feedback (modal close, toast)
T=0+1ms   onSnapshot fires from CACHE (stale)
          → snapshot.field is empty (pre-action state)
          → reconciliation: "Firestore says no → clear local marker"
          → optimistic write ERASED 💀
T=1s      CF write completes server-side
T=1.5s    onSnapshot fires from SERVER (fresh)
          → snapshot.field now has today's value
          → but local was already cleared — too late
```

**Rule:** Any onSnapshot reconciliation that CLEARS local state when server says no MUST gate on snapshot freshness:

```js
fs.onSnapshot(ref, snap => {
  const fresh = (snap.data() || {}).someField || null;
  // SKIP reconciliation when snapshot is from local cache OR has pending writes —
  // cached snapshot is stale relative to optimistic write that just happened.
  if (!fresh && !snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites) {
    if (localStorage.getItem(lsKey) === today) localStorage.removeItem(lsKey);
  }
});
```

Detection: grep for `localStorage.removeItem` inside onSnapshot callbacks. Each should have a `snap.metadata.fromCache` / `hasPendingWrites` guard.

```bash
# Find onSnapshot callbacks that clear localStorage — each needs a metadata guard
grep -B1 -A20 "onSnapshot" tenant_app.html shared/*.js | grep -B5 -A5 "localStorage.removeItem"
```

Admin-reset case still works correctly: when admin clears Firestore, the server-confirmed snapshot (fromCache=false) fires → reconciliation runs → local cleared. Only the CACHED initial snapshot is skipped.

Family: §7-N (onSnapshot must have error callback), §7-V (cleanup before re-attach) — same family of "silent onSnapshot lifecycle bug." Subtler than missing-callback bugs because it manifests only in the OPTIMISTIC-write + CACHED-snapshot race.

Incident (2026-05-23 late evening (8)): daily-bonus modal appearing on every LIFF reopen after successful claim. Optimistic close + sync localStorage marker was correct, but `_subscribeEcoPoints` reconciliation block cleared it during the cached-snapshot fire (sub-millisecond after the marker write). Fix in commit `2dfc440` — added `!snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites` to both player + tenant branches.

### LL. Firebase RTDB JSONP fallback hits BOTH `script-src-elem` AND `frame-src` — fix in one commit

Firebase RTDB SDK opens a WebSocket by default. When that fails — even momentarily (intermittent network, restrictive proxy, NAT/firewall, single CONNECTION_RESET) — the SDK silently falls back to JSONP long-polling. The fallback creates TWO different DOM elements pointing at the RTDB origin:

1. `<script src="https://<project>-default-rtdb.<region>.firebasedatabase.app/...">` — JSONP payload delivery → hits **`script-src-elem`**
2. `<iframe src="https://<gke-host>.<region>.firebasedatabase.app">` — cross-origin event channel → hits **`frame-src`** (different subdomain than the script path!)

`connect-src 'self' https: wss:` does NOT matter — `connect-src` gates fetch/XHR/WebSocket, not `<script>` or `<iframe>`. So `connect-src` looking permissive misleads you into thinking RTDB is whitelisted when it isn't.

**Symptom signature** (recognise this fast):
1. DevTools Issues panel shows 10+ CSP violations per second, growing continuously
2. Each violation says "Loading the script '<URL>'..." or "Refused to frame ..." where `<URL>` is `https://<project>-default-rtdb.<region>.firebasedatabase.app/...`
3. Page still works (SDK has internal retry) but DevTools UI slows and the report queue fills
4. Closing/reopening DevTools doesn't reset the count — violations keep coming until WebSocket re-establishes

**Fix:** in `tools/generate-vercel-csp.js`, add to **BOTH** `SCRIPT_SRC_EXTERNAL` and `FRAME_SRC`:

```js
'https://*.firebasedatabase.app',   // current multi-region RTDB
'https://*.firebaseio.com',         // legacy US-region (defensive)
```

Then `npm run csp:hash && node tools/update-vercel-csp.js`.

**Why this is its own anti-pattern (not just a one-off):** PRs #32→#34 (2026-05-24) shipped the script-src-elem fix first, saw the 10/sec flood disappear, looked done — but a single residual violation surfaced for `s-gke-apse1-nssi2-1.asia-southeast1.firebasedatabase.app` under `frame-src` because the iframe path uses a different subdomain. Took a second deploy cycle to close. When adding an origin for RTDB JSONP fallback, ALWAYS mirror the change in BOTH directives in the same commit — partial fix burns a deploy and looks like the fix didn't land.

**Detection recipe (run before tightening CSP or removing any RTDB-related directive):**

```bash
grep -oE "script-src-elem [^;]+" vercel.json | grep -c "firebasedatabase\|firebaseio"
grep -oE "frame-src [^;]+"       vercel.json | grep -c "firebasedatabase\|firebaseio"
# Both must return >=1
```

**Family with §7-II (CSP hash drift bombs on enforce flip)** — both are "CSP directive doesn't include something the runtime actually needs, only visible on the deployed page under specific conditions." II is about hashes drifting; LL is about origins being silently missing despite `connect-src` looking permissive. Always test CSP changes on a deploy where the actual SDK runs — static review can't see this class of bug.

### MM. Service worker cache serves stale `function X()` even after deploy — clear SW + caches before in-browser verification

When verifying a JS-level fix on Vercel via Chrome MCP, the page can load fresh HTML but the service worker (`shared/service-worker.js`) keeps the OLD `shared/*.js` in cache. The trap is that `fetch('/shared/X.js?cb=' + Date.now())` returns the NEW file content correctly — yet `(window.X || X).toString()` shows the OLD function body. The function reference in memory was bound at original parse time and isn't refreshed by a plain reload.

**Symptom signature** (recognise this fast — easy to lose 20+ min):
1. Deploy SHA matches latest (`gh api /repos/.../deployments?per_page=1` confirms)
2. `fetch('/shared/X.js?cb=...')` returns NEW source (with your fix)
3. `(window.X || X).toString()` returns OLD source (without your fix)
4. Live UI behaves like OLD code — toast doesn't show, fix appears not deployed
5. You start patching `window.X`, adding MutationObservers, inspecting CSS specificity — chasing the wrong layer

**Recovery (run BEFORE the verification flow):**
```js
navigator.serviceWorker.getRegistrations()
  .then(rs => Promise.all(rs.map(r => r.unregister())))
  .then(() => caches.keys())
  .then(ks => Promise.all(ks.map(k => caches.delete(k))))
  .then(() => location.reload());
```

Plain `location.reload(true)` is NOT enough — the SW intercepts the request and may still serve stale. For Chrome MCP verification specifically, run the snippet above first, then wait for the reload to complete, THEN trigger your test flow.

End users don't hit this — `CACHE_VERSION` in `service-worker.js` auto-bumps from `VERCEL_GIT_COMMIT_SHA` per build.js, so the SW invalidates itself on next user visit. The trap is exclusive to the DEBUGGER who has a tab open across deploys.

**Detection during debugging**: when "the patch shows in the fetched file but the behavior doesn't match," check `window.functionName.toString()` first — if it's not what you shipped, it's the SW cache. Don't keep chasing other layers.

Related: §7-J (static deploy ≠ live-data verified) is the dependency-direction sibling — deploy success ≠ feature works because of real data. This MM is "deploy success ≠ in-memory code matches deploy" because of SW cache.

### NN. Firestore triggers (any Gen, any region) cannot watch SE3-hosted Firestore — use HTTPS callable + client invocation

Eventarc — the trigger backbone for BOTH Gen1 `firebase-functions/v1` AND Gen2 `firebase-functions/v2/firestore` Firestore triggers — does NOT support `asia-southeast3` (Jakarta), which is where this project's Firestore lives. Any new CF that needs to react to a Firestore write WILL fail at deploy time with:

```
Resource projects/the-green-haven/databases/(default)/documents/<path> is in region asia-southeast3 which is not supported.
```

The project pattern is **HTTPS callable invoked from client AFTER the Firestore write** — modeled on `functions/notifyTenantOnMeterUpload.js` (see its 13-line comment block at the top explaining the same constraint). The callable lives in SE1 (no Eventarc requirement); the client calls it as a follow-up step. Auth gates inside the CF verify the caller has permission to trigger the work (e.g. participant of the chat, owner of the post).

Incident 2026-05-24: Sprint 1 + Sprint 2 marketplace-chat CFs (`cleanupMarketplaceChat` Firestore.onWrite + `notifyMarketplaceChat` Firestore.onCreate) BOTH shipped in PR #36 as triggers. Deploy after merge failed on the first attempt; full refactor to v2 `onCall` in PR #37 + 7 new client invocation sites in tenant_app.html. ~30 min lost, plus a forced `firebase functions:delete cleanupMarketplaceChat --region asia-southeast1 --force` to clear the stale "background-triggered" registration (which Firebase recorded even though the deploy itself errored — re-deploy as callable was then blocked by "Changing from a background triggered function to a callable function is not allowed").

**Rule:** before writing ANY new Firestore-triggered CF in this project, stop and use a callable instead. Detection:

```bash
# Find every Firestore-trigger CF in the repo. Each is either FROZEN
# (predates the SE3 migration — see lifecycle_marketplace.md and
# generate_bills_cf_frozen.md) OR needs to be refactored to callable.
grep -rn "\.firestore\.document(\|firebase-functions/v2/firestore" functions/
```

The only Firestore-trigger CF that's allowed to exist (and shouldn't be touched) is `generateBillsOnMeterUpdate` — it was deployed pre-migration and is now FROZEN per [generate_bills_cf_frozen.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\generate_bills_cf_frozen.md). Any new trigger fails at deploy.

**When client invocation isn't enough (rare):** scheduled CF sweeping the Firestore collection on a cron is the only Eventarc-free fallback. Adds latency (1-15 min) but works cross-region. Used by `cleanupChecklistsScheduled.js`, `cleanupOldDocs.js`, etc.

**Hotfix recipe when you discover a trigger CF in your in-flight PR:**

1. Refactor the CF: `firebase-functions/v1` → `firebase-functions/v2/https`; `functions.region().firestore.document(path).onWrite/onCreate(...)` → `onCall({ region: 'asia-southeast1', secrets: [...] }, async (request) => ...)`.
2. Move the trigger's auth gate INTO the callable body (`request.auth.uid` required; participant / owner / admin check; sender == auth.uid for spoofing protection).
3. Wire client to invoke after the Firestore write that USED to trigger it. Order matters for cleanup-style CFs where the auth check needs the source doc to still exist (e.g. `deleteMarketItem` must call `cleanupMarketplaceChat` BEFORE `deleteDoc`, not after).
4. Rewrite the unit test to mock `firebase-functions/v2/https.onCall` + `firebase-functions/params.defineSecret` (intercept via `Module._load`); call the handler directly with `{ auth, data }` shape.
5. **If the trigger version already attempted to deploy** (even if it errored): run `firebase functions:delete <name> --region asia-southeast1 --force` BEFORE the new deploy. Otherwise Firebase blocks the deploy with "Changing from a background triggered function to a callable function is not allowed." The CLI lets the function exist as a stale shadow registration even after a failed deploy.
6. Lifecycle doc must explicitly state "HTTPS callable, NOT a Firestore trigger" with a link to this anti-pattern, so future sessions don't undo the refactor.

**Family with §7-K (defined ≠ wired)** — both are about discovering invariants the code suggests but reality violates. K is "X is defined doesn't mean X runs"; NN is "X.onWrite exists in the v1 SDK doesn't mean X.onWrite works in your project's region." Same instinct: don't trust the API surface — grep for project precedent first.

### OO. `html-minifier-terser collapseWhitespace:true` strips inline script whitespace → CSP hash mismatch in production

`build.js` runs html-minifier-terser at deploy time (Vercel-only, guarded by `VERCEL` env var). With `collapseWhitespace: true` + `minifyJS: false`, the minifier strips the **leading newline+indentation** and **trailing newline+indentation** from every multi-line inline `<script>` and `<style>` block. Single-line scripts (no surrounding whitespace) are unaffected.

The CSP hash tool (`tools/compute-csp-hashes.js`) was hashing the **un-trimmed** source content — so the stored hashes matched the source but NOT the minified deployed output. Browsers compute the hash of exactly what they receive → CSP violation on every multi-line script.

Incident (2026-05-31): login.html showed "Executing inline script violates CSP directive" for its `<script type="module">` (multi-line, 3077 chars in source → 3069 in deployed = 8-char difference from stripped `\n    `prefix/suffix). The pre-commit hook PASSED (both sides consistent at source-hash level) while production was broken.

**Fix already applied:** `compute-csp-hashes.js` now calls `.trim()` on script/style body before hashing. Hash counts are still correct (script 0 was single-line, trim was a no-op for it):

```bash
# Verify the fix is in place:
grep "m[2].trim()" tools/compute-csp-hashes.js  # must return both extractInlineScripts and extractInlineStyles
```

**Detection recipe** (when CSP errors appear on a page that "should be fine"):
1. In Chrome DevTools → Console → filter "CSP" / "Content-Security-Policy"
2. If the error says `login:637` or `tenant_app:NNN` (multi-line inline script) and no JavaScript changed recently — suspect hash drift
3. In Chrome: compute `script.textContent.trim()` hash vs what's in vercel.json:
   ```js
   const ss=[...document.scripts].filter(s=>!s.src);
   (async()=>{for(const s of ss){const e=new TextEncoder().encode(s.textContent.trim()),b=await crypto.subtle.digest('SHA-256',e);console.log(btoa(String.fromCharCode(...new Uint8Array(b))));}})()
   ```
4. Compare output hashes against `script-src-elem` in `vercel.json`
5. If mismatch: run `npm run csp:hash && node tools/update-vercel-csp.js && git add vercel.json tools/csp-hashes.json && git commit`

**Other pages affected:** dashboard.html (6 inline scripts) and tenant_app.html (6 inline scripts) were also at risk; verified correct after the trim fix.

**Why the pre-commit hook didn't catch it:** the hook computes hashes from LOCAL source files and compares to `tools/csp-hashes.json`. Both sides were consistently using un-trimmed content, so the hook always passed — while the live site always failed. The fix makes both sides use `.trim()`.

### PP. `defer` + DOM order matters — adding `defer` to a script that other deferred scripts depend on breaks load order

All `<script defer>` tags execute in DOM order (the order they appear in the HTML), regardless of individual load times. Adding `defer` to a script that other earlier-appearing deferred scripts depend on will cause those earlier scripts to run before the newly-deferred one.

Incident (2026-05-31): added `defer` to `gamification-rules.js` (line ~136 in tenant_app.html) — but `tenant-leaderboard.js` (line ~124) appears EARLIER in the HTML and uses `window.GamificationRules.BADGE_CATALOG`. After adding `defer`, `tenant-leaderboard.js` executed before `gamification-rules.js` had defined `window.GamificationRules` → ReferenceError.

**Rule:** when adding `defer` to any script, check which earlier-appearing deferred scripts depend on it. If any do, move the newly-deferred script to appear BEFORE its consumers in the HTML.

```bash
# Find load order for related scripts in tenant_app.html:
grep -n "gamification-rules\|tenant-leaderboard" tenant_app.html
# gamification-rules MUST appear at a LOWER line number than tenant-leaderboard
```

**Detection recipe** (ReferenceError on page load after adding defer):
1. Error: `ReferenceError: X is not defined` on first page load
2. BUT: `typeof window.X` returns `'object'` AFTER the page finishes loading
3. Root cause: `X` was defined by a script that appears LATER in HTML (executes later) than the script that reads it
4. Fix: swap the script order in HTML — the definer before the consumer

**Sibling:** §7-EE (self-recursion with `window.X = wrapper`) — same family of "script ordering in a non-module world produces subtle bugs." §7-CC (`let X` at top-level ≠ on window) is the scope-level cousin.

### QQ. God-file extraction silently drops `function X()` from global scope — always export as `window.X`

A top-level `function X()` inside a `<script>` tag is automatically on `window` (in non-strict mode, function declarations hoist to global). When refactoring that script into a separate `shared/*.js` file, the function is NO LONGER global unless you add an explicit `window.X = X` (or define it as `window.X = function() {...}` directly). There is no compiler error, no lint warning, and no test failure — the function is simply absent from `window` at runtime. Callers that check `if (_ta.X)` silently skip. Callers that use the bareword `X()` throw `ReferenceError` only at runtime.

Incident (2026-05-31): god-file refactor (PRs #158–#185) slimmed `tenant_app.html` from 13,911 → 5,930 lines. `function showPage(id, element)` at line 3038 of the original was never moved to any module. All navigation buttons silently failed; `showPage('world-map-page')` in the `load` event threw `ReferenceError`. Discovered only after the refactor was complete and pushed — no automated check caught it. Fix: created `shared/tenant-navigation.js` with explicit `window.showPage = function(...)`.

**Rule:** when extracting any function from an inline `<script>` to a `shared/*.js` module, IMMEDIATELY add `window.X = X` at the bottom of the new file. If the function is also called by bareword inside the SAME `<script>`, change those callers to `window.X(...)` at the same time.

```bash
# Audit recipe — find any function that the delegation hub expects on _ta (= window)
# but is not explicitly exported as window.X in any module:
grep -h "if (a === '\|_ta\." tenant_app.html | grep -oE "'[a-zA-Z]+'" | sort -u > /tmp/expected.txt
grep -rh "window\." shared/tenant-*.js | grep -oE "window\.[a-zA-Z]+" | sort -u > /tmp/exported.txt
# Names in expected but not in exported are candidates for missing window.X
```

**Pre-extract checklist** (run BEFORE removing any function from an inline `<script>`):
1. `grep -n "functionName" tenant_app.html` — find every call site (delegation hub, event handlers, load callback, other inline calls)
2. Decide which module the function belongs in
3. Add `window.functionName = function(...) {...}` to that module
4. Change any remaining bareword calls in the inline `<script>` to `window.functionName(...)`
5. Push and verify live: `typeof window.functionName` must return `'function'` before marking done

**Difference from §7-K (defined ≠ wired):** §7-K is "function exists in codebase but 0 callers." QQ is "function had callers and worked, then was deleted during refactor while callers remained." §7-CC (`let X` at top-level ≠ on window) is the scope-sibling — different mistake, same consequence.

### RR. `document.createElement('style')` is blocked by CSP `style-src-elem` — CSS must live in a static file

Any JS module that injects its own styles via `document.createElement('style') + appendChild` is blocked silently when `style-src-elem` is in enforced CSP mode with only specific hashes whitelisted. The dynamically created `<style>` tag has no hash, so the browser silently discards it. The JS runs without errors, the code appears to succeed (no exception), and a `_stylesInjected = true` flag says "done" — but `getComputedStyle()` returns 0 / transparent for every affected element.

Incident (2026-05-31): `rich-text-policy.js` injected `.rt-wrap / .rt-toolbar / .rt-content` CSS via `document.createElement('style')`. After CSP was enforced (2026-05-23), the editor in the Policy page lost all visual styling — no border, no gray toolbar background, no padding. The page "worked" functionally but looked broken. Root cause took a full diagnostic cycle to find because the failure is invisible: `_stylesInjected = true`, no console error, no CSP violation shown in console (only in DevTools Issues panel).

**Rule:** never use `document.createElement('style')` for CSS that must survive CSP. Put the CSS in `shared/components.css` (or another static `.css` file that's already loaded). External `.css` files don't require `style-src-elem` hashes — only inline `<style>` blocks and `style=""` attributes do.

```js
// ❌ WRONG — silently blocked by CSP style-src-elem
const style = document.createElement('style');
style.textContent = '.my-widget { border: 1px solid #d1d5db; }';
document.head.appendChild(style);

// ✅ CORRECT — add CSS to shared/components.css instead
// .my-widget { border: 1px solid var(--border, #d1d5db); }
```

**Detection recipe:**
1. `getComputedStyle(el).border` returns `'0px none'` even though the element has the expected CSS class
2. `document.styleSheets` has no rule for `.my-class` — the style tag was either never inserted or silently removed
3. DevTools → Issues panel (NOT console) shows "Refused to apply inline style" CSP violation

```bash
# Audit all JS files for dynamic style injection:
grep -rn "createElement.*'style'\|createElement.*\"style\"" shared/ --include="*.js"
# Each hit must be replaced with a static CSS rule in components.css
```

**Affected pages when CSP is enforced:** any page that loads the offending JS module. This project has `style-src-elem` with explicit hashes for tracked HTML files since 2026-05-23.

**Sibling:** §7-II (CSP hash drift kills inline `<style>` blocks on deploy). Both are "CSP kills styles silently" — II is about pre-existing inline blocks whose hash went stale; RR is about JS-injected blocks that never had a hash.

---

## 6. Cross-references — where to look in MEMORY.md

[MEMORY.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\MEMORY.md) is the architecture + history index. Read these sections by purpose:

- **⛔ Critical rules** → before touching any rule, auth, or LIFF code. Each entry is a real incident with its lesson.
- **🏛️ System lifecycles** → "how does X work end-to-end". ~28 docs split into Core/Tenant-facing/Admin sections. Includes the recent Tier 1B/2D/3F/3I features (expense, deposit, building registry, checklist).
- **🧭 Reference** → durable narrow-scope docs: Firebase SDK gotchas (admin + client v11 + functions v7), region split (SE1 vs SE3), `generateBillsOnMeterUpdate` frozen, brand OS, etc.
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
