# CLAUDE.md — Workflow protocol for The Green Haven

Loaded at every session start. Overrides any default behavior — follow exactly.

## How this file relates to MEMORY.md

Two docs auto-load at session start; they are **complementary, not duplicates**:

- **This file (CLAUDE.md)** — *workflow + stack + recurring anti-patterns* · in the repo · committed to git · "how to work in this codebase". Owns: protocol rules, tech stack table, build/deploy commands, **§7 anti-patterns A-T** (project-specific lessons that auto-load every session).
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
| Logic | Vanilla JS modules (UMD-ish; `window.X = ...` exports) | `shared/*.js` (~29 files; verify with `ls shared/*.js \| wc -l`) |
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
| `npm run csp:hash` / `csp:print` | CSP hash regen / print Vercel CSP | If/when CSP comes back from report-only |
| `firebase deploy --only functions:<name>` | Deploy a single CF | After editing `functions/<name>.js` |
| `firebase deploy --only firestore:rules,storage,database` | Deploy rules without CFs | After editing rules files |

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
