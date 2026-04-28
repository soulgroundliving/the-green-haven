# CLAUDE.md — Workflow protocol for The Green Haven

Loaded at every session start. Overrides any default behavior — follow exactly.

## How this file relates to MEMORY.md

Two docs auto-load at session start; they are **complementary, not duplicates**:

- **This file (CLAUDE.md)** — *workflow + stack* · in the repo · committed to git · "how to work in this codebase". Owns: protocol rules, tech stack table, build/deploy commands, pointers to `tasks/*`.
- **MEMORY.md** at `~/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/MEMORY.md` — *architecture + history* · user-scoped · NOT committed · "what's in this codebase + what I've learned about this user". Owns: critical rules, system lifecycles, working-style feedback, session journals, archive.

**Boundary rule for new content:** if it's about a workflow/process or a build/deploy fact → here. If it's about a system's behavior, an incident pattern, or a user preference that survives across projects → MEMORY.md. Project-specific incidents go to `tasks/lessons.md` (see § 1 Self-Improvement Loop).

## 1. Workflow Orchestration

### Plan-First Protocol
- **Mandatory** for any non-trivial task (3+ steps OR architectural decisions): write the plan to `tasks/todo.md` BEFORE editing code.
- Plan format: checkable items, sub-tasks nested. Architectural decisions include a **Why** line explaining the approach.
- **WAIT for user approval** before implementing.
- **Pivot rule:** if something goes sideways mid-implementation, STOP, re-plan, get approval again.

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
After ANY correction from the user, decide where to log it using this rule:

- **Project incident** (e.g. "I shipped wrong UI text in `cleanupAnonymousUsers` → all LIFF tenants locked out") → `tasks/lessons.md` in this repo. Format: **Mistake** · **Why** · **Rule**.
- **Cross-project preference** (e.g. "user wants minimal changes, no surrounding cleanup") → `~/.claude/projects/.../memory/feedback_<topic>.md`. The auto-memory MEMORY.md index lists them under "🤝 Working style".

**Decision rule:** if the lesson could apply to a different codebase → `feedback_*.md`. If it's about THIS project's bugs, architecture, or wrong claims I made about it → `tasks/lessons.md`.

Read both at the start of every session. `tasks/lessons.md` first (it's where the most recent project-specific corrections live).

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

## 3. Task Management

1. **Plan first** — write plan to `tasks/todo.md` with checkable items.
2. **Verify plan** — get user check-in before starting implementation.
3. **Track progress** — mark items complete as you go (use TodoWrite tool in parallel for live status).
4. **Explain changes** — at each step, give a high-level *What* and *Why* summary.
5. **Document results** — at the end, append a "Review" section to `tasks/todo.md` (what shipped, what was deferred, follow-ups).
6. **Capture lessons** — update `tasks/lessons.md` after every correction or bug fix.

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

## 6. Cross-references — where to look in MEMORY.md

[MEMORY.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\MEMORY.md) is the architecture + history index. Read these sections by purpose:

- **⛔ Critical rules** → before touching any rule, auth, or LIFF code. Each entry is a real incident with its lesson.
- **🏛️ System lifecycles** → "how does X work end-to-end". 11 docs: LIFF onboarding, auth/login/gate, Stores facade (7 stores), tenant SSoT, Storage uploads, LINE notification, monthly billing, gamification, tenant_app architecture, Firestore schema (canonical + gotchas).
- **🧭 Reference** → durable narrow-scope docs: Firebase Admin SDK gotchas, region split (SE1 vs SE3), the frozen `generateBillsOnMeterUpdate` CF, the `GAMIFICATION_LIVE` flag, etc.
- **🤝 Working style** → cross-project user preferences (`feedback_*.md`). Apply these to every project, not just this one.
- **🎯 Current state** → latest `next_session_handoff_*.md` for what shipped and what's pending.
- **📔 Session journals** → dated snapshots; scan only when debugging something within a date range.
- **🗄️ Archive** → superseded docs; do NOT rely on (kept for git-blame style traceability).
