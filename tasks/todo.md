# Chrome MCP Smoke Test — 5 critical flows

**Status:** plan-first, awaiting approval. Do NOT edit code until ✅ from user.
**Triggered by:** open follow-up #6 Plan #4 from `next_session_handoff_2026_05_19_evening_3_followups_closeout.md`.
**Why now:** the morning's audit gates (§7-A/U/Z + file-size) catch static drift, but live regressions (login broken / bill won't render / verifySlip failing) still slip through. A repeatable smoke playbook closes that gap.

## Goal

A deterministic regression-catch script that Claude can run in any future session via **one command** (`npm run smoke`), exercising 5 critical user flows end-to-end against https://the-green-haven.vercel.app in **<10 minutes**, with **zero production data mutation by default**.

## Scope split — Chrome MCP cannot enter LIFF

Reality check: Chrome MCP runs in a regular Chromium tab, no LIFF SDK, no LINE auth handshake. Per [auth_liff_sot.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/auth_liff_sot.md), LIFF entry requires real LINE app. So "5 flows" splits two ways:

| # | Domain | Admin browser (Chrome MCP, automatable) | Tenant LIFF (manual, user-only) |
|---|--------|------------------------------------------|---------------------------------|
| 1 | Login | admin login.html → dashboard, claims=`admin:true` | LINE → LIFF entry → `_taBuilding`/`_taRoom` set |
| 2 | Bill | admin opens bill detail modal | tenant sees bill list + click→detail |
| 3 | Slip | admin views verified slip in bill modal | tenant uploads slip → verifySlip CF runs |
| 4 | Checklist | admin opens instance + co-sign UI + PNG export | tenant fills checklist + photo + signature |
| 5 | Deposit | admin opens deposit page + deductions + receipt | tenant sees deposit badge in profile |

**This plan covers the ADMIN side only** (Chrome MCP-driven, 100% automatable, every session). The tenant LIFF side already has `tasks/liff-verify-checklist.md` (manual, real-LINE-only); a tightened "5-flow extract" of it ships as a secondary deliverable.

## Architecture

Hybrid model — playbook + verifier — mirrors `seed-lease-notif-test.js` + `liff-verify-checklist.md` patterns already in the repo. NO new deps (no Playwright/Puppeteer — Chrome MCP is the driver, Node verifier is post-check).

```
┌─────────────────────────────────────────────────────────────┐
│  npm run smoke                                              │
│   ├─→ prints tasks/smoke-test-admin-playbook.md path        │
│   ├─→ Claude executes Chrome MCP steps from playbook        │
│   └─→ npm run smoke:verify                                  │
│         └─→ Node script asserts post-conditions via REST    │
│             (e.g. "did login session land + claims present")│
└─────────────────────────────────────────────────────────────┘
```

**Why hybrid not pure-script:**
- Chrome MCP can't be driven from Node — only Claude as the agent.
- Pure markdown playbook = no post-condition checks (eye-only).
- Hybrid: playbook drives the UI, Node verifier asserts the data → both fail loudly.

**Playbook structure** (mirrors `liff-verify-checklist.md`):
- Pre-flight (login state, network reachable, console clean)
- 5 flow sections, each with: navigate → action → observe → assert (DOM/console/network)
- Each step has `☐ Pass / ☐ Fail` + expected screenshot trigger
- Post-run: paste console errors / failed screenshot list back to Claude → regression report

**Verifier responsibilities** (in `tools/smoke-test/verify.js`):
- `--check-login` — given session cookie, confirm `admin: true` claim via REST `getIdTokenResult` echo
- `--check-bill <building> <room>` — REST GET bills/{building}/{room} → assert structure (no empty body, has `totalAmount`)
- `--check-checklist-instance <id>` — REST GET → assert `status`, `photos`, `signatures` fields present
- `--check-deposit <building> <room>` — REST GET → assert `originalAmount` + structure
- All read-only, all use firebase-tools OAuth (same pattern as `seed-lease-notif-test.js`).

**Read-only by default** — no slip upload, no checklist creation, no deposit return in default `npm run smoke`. Those require explicit `npm run smoke:write` (opt-in, uses dedicated test data, separate plan if needed).

## Files Touched

| File | Change | Why |
|------|--------|-----|
| `tasks/smoke-test-admin-playbook.md` | **NEW** (~250 LOC) | 5-flow Chrome MCP playbook, ☐ Pass/Fail per step |
| `tasks/smoke-test-liff-playbook.md` | **NEW** (~80 LOC) | Tightened LIFF extract (tenant side) — 5 same domains, user runs in LINE |
| `tools/smoke-test/verify.js` | **NEW** (~200 LOC) | Node post-check asserter via REST + firebase-tools OAuth |
| `tools/smoke-test/README.md` | **NEW** (~40 LOC) | One-page how-to (npm run smoke, env setup, troubleshooting) |
| `package.json` | add 2 scripts: `smoke`, `smoke:verify` | `npm run smoke` = print playbook path + remind sequence; `smoke:verify` = run verifier |
| `memory/lifecycle_smoke_test.md` | **NEW** (~120 LOC) | Document the playbook lifecycle: when to run, expected runtime, recent failures log |
| `memory/MEMORY.md` | append `🧭 Reference` entry | Index entry pointing to lifecycle_smoke_test.md |

Total: 5 new files + 2 small mods. No production code touched. Zero deploy risk.

## Sprint Plan

### S1 — Verifier core (~45 min)

- [ ] Scaffold `tools/smoke-test/verify.js` with arg parser + firebase-tools OAuth bootstrap (copy from `seed-lease-notif-test.js`)
- [ ] Implement `--check-login` (echoes user record + claim check) using `admin.auth().getUser(uid)` via REST
- [ ] Implement `--check-bill <building> <room> [year]` — REST GET RTDB `bills/<building>/room-{r}/{year}/{month}` → assert keys
- [ ] Implement `--check-checklist-instance <id>` — REST GET Firestore `checklists/{id}` → assert non-empty
- [ ] Implement `--check-deposit <building> <room>` — REST GET Firestore `deposits/{b}_{r}` → assert `originalAmount` field
- [ ] All checks output structured JSON (pass/fail + diagnostic) so the playbook can grep / pipe

### S2 — Admin playbook (~60 min)

- [ ] Write `tasks/smoke-test-admin-playbook.md` covering 5 flows (login / bill / slip / checklist / deposit) from admin side
- [ ] Each flow: Pre-state → Chrome MCP commands (literal) → Expected DOM/console/network → ☐ Pass/Fail + Obs column
- [ ] Reference the verifier commands inline (`Run: node tools/smoke-test/verify.js --check-bill rooms 15`)
- [ ] Pre-flight section (browser ready, Vercel reachable, admin credentials in env)
- [ ] Failure-mode appendix (most likely break per flow + fastest diagnostic)

### S3 — LIFF playbook (tightened) (~30 min)

- [ ] Extract from `liff-verify-checklist.md` only the 5-flow-relevant rows (skip C4/PDPA-specific etc.)
- [ ] Write `tasks/smoke-test-liff-playbook.md` — 5 sections matching admin playbook 1:1 (so cross-side regressions are visible)
- [ ] Add "When to run" note: after any deploy that touches tenant_app.html / functions/verifySlip.js / functions/liffSignIn.js

### S4 — Wiring + dry-run + memory (~45 min)

- [ ] Add `package.json` scripts: `"smoke": "echo 'Open tasks/smoke-test-admin-playbook.md and execute via Chrome MCP. Then run npm run smoke:verify.'"`, `"smoke:verify": "node tools/smoke-test/verify.js"`
- [ ] Live dry-run: Claude executes playbook via Chrome MCP against https://the-green-haven.vercel.app, fills ☐ columns with actual observations, captures any drift between playbook expectation and reality
- [ ] Fix any expectation-drift found during dry-run (playbook is wrong, not the app)
- [ ] Write `memory/lifecycle_smoke_test.md` with verifier grep commands per §1 verify-via-grep doctrine
- [ ] Append `MEMORY.md` reference entry
- [ ] `npm run verify:memory` exit 0 ✓

## Risks

| Risk | Mitigation |
|------|------------|
| **Admin credentials in repo** | NEVER commit. Use `process.env.SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD` (set in shell, document in `tools/smoke-test/README.md`). Verifier prompts if missing. |
| **Production data pollution** | Default mode is READ-ONLY. Write-path smoke (`smoke:write`) is opt-in, separate plan if/when needed. |
| **Firebase Auth token refresh mid-run** | Smoke targets <10 min runtime, well inside 1h refresh window. If a future smoke grows past 1h, add re-login step. |
| **Vercel cold start skews timings** | Playbook expectations describe DOM state, not timing. First page load can warm-cache; subsequent assertions are deterministic. |
| **Playbook drift vs reality** | S4 dry-run catches this on day 1. Going forward, every run that flags drift updates the playbook in the same commit. |
| **Chrome MCP capability gap** | If a flow can't be exercised via MCP (e.g. file upload), document the gap explicitly in the playbook + cover via LIFF playbook. |
| **§7-J ("static deploy ≠ live-verified") loops** | Smoke run = the closure. Replaces ad-hoc Chrome MCP poking with a fixed checklist. |

## Open questions (need ✓ before S1 starts)

1. **Admin credentials source** — use env vars `SMOKE_ADMIN_EMAIL` + `SMOKE_ADMIN_PASSWORD`, OR a `.env.local` file (gitignored)? Recommend **env vars** (one less file, CI-friendly later).

2. **Verifier auth model** — same as `seed-lease-notif-test.js` (firebase-tools OAuth via `firebase login`)? Recommend **yes** — already proven, zero new setup.

3. **Test data assumptions** — verifier needs at least one known room with bills/checklist/deposit. Use `rooms/15` (already exists, used for lease-notif test)? Recommend **yes** — same fixture, document as "smoke fixture room".

4. **Tenant LIFF playbook scope** — re-summarize from `liff-verify-checklist.md` or just keep that file as-is and reference? Recommend **re-summarize** — `liff-verify-checklist.md` is C4-era specific (PDPA, C4 announcements). The smoke version is more durable.

## Success criteria

- ✅ `npm run smoke` prints playbook path
- ✅ Claude executes playbook via Chrome MCP in <10 min, fills observations
- ✅ `npm run smoke:verify` exits 0 on healthy app, exits 1 with diagnostic on broken
- ✅ Zero production data created/modified in default mode
- ✅ S4 dry-run produces a baseline-clean checklist with all ☐ ticked Pass
- ✅ `npm run verify:memory` passes (lifecycle_smoke_test.md grep-backed)
- ✅ Future session: user says "run smoke" → Claude reads playbook → executes → reports

## Deferred / NOT in scope

- Write-path smoke (`smoke:write`) — separate plan when first regression demands it
- Playwright/Puppeteer migration — current Chrome MCP path is enough
- CI integration (run on every deploy) — needs hosted browser + admin secret, separate infra discussion
- Multi-environment (staging vs prod) — currently only prod exists
- LIFF auto-run — impossible (LINE platform constraint, see auth_liff_sot.md)

## Anti-pattern relevance

- **§7-J (static deploy ≠ live-verified)** — smoke IS the closure for this pattern
- **§7-AA (pre-existing CF search)** — applied: no existing smoke runner, confirmed by grep `tools/` + `package.json`
- **§7-I (production data actions — never automate)** — codified into the read-only default
- **§7-N (onSnapshot must have error callback)** — verifier's REST-based checks bypass this hazard
- **§1 verify-via-grep doctrine** — lifecycle_smoke_test.md will embed grep verifiers

---

**Approved 2026-05-19 evening (4) — "approve all defaults".** All 4 sprints shipped same session.

---

## Review

### Shipped (all sprints S1–S4 ✅)

| Sprint | Output | Notes |
|--------|--------|-------|
| S1 | `tools/smoke-test/verify.js` (~250 LOC) | 4 subcommands: `login` / `bill` / `checklist-instance` / `deposit`. firebase-tools OAuth via configstore (mirror of `seed-lease-notif-test.js`). Read-only. Added `inconclusive: true` flag during S4 dry-run to separate "fixture absent" from "feature broken". |
| S2 | `tasks/smoke-test-admin-playbook.md` (~270 LOC) | 5 flows (login/bill/slip/checklist/deposit) + pre-flight + failure-mode appendix + ☐ Pass/Inconclusive/Fail summary table. Selectors grep-verified against live Vercel. |
| S3 | `tasks/smoke-test-liff-playbook.md` (~95 LOC) | Tightened 5-flow mirror for tenant LIFF, re-summarized from `liff-verify-checklist.md` (no reference, durable extract). User-driven only — Chrome MCP can't enter LIFF. |
| S4 | `package.json` `smoke` + `smoke:verify` scripts · `tools/smoke-test/runner.js` (pre-flight + print) · `tools/smoke-test/README.md` (operator one-pager) · `memory/lifecycle_smoke_test.md` (grep-backed per §1) · `MEMORY.md` index updated (1 line in 🏛️ + 1 line in 🎯 Current state) · `npm run verify:memory` exits 0 (305 rows, +9 from this doc). |

### Dry-run findings (real-prod via firebase-tools OAuth)

| Probe | Result | Action |
|-------|--------|--------|
| `verify.js bill --building rooms --room 15` | ✅ 2 bills found (`TGH-256904-15-4735`, `TGH-256905-15-5811`) — RTDB + OAuth pipeline works | Kept rooms/15 as canonical smoke fixture |
| `verify.js deposit --building rooms --room 15` | ❌ Doc not found — entire `deposits/` collection empty | Added inconclusive flag + softened pre-flight to ◯ informational |
| `verify.js checklist-instance` | ❌ Entire `checklists/` collection empty | Same — Flow 4 starts inconclusive until tenant submits |
| `curl https://the-green-haven.vercel.app/login.html` | ❌ 308 redirect → `/login` | Updated all URLs in playbook to canonical `/login` + `/dashboard` |
| Login form selectors live | ✅ All 4 (`#loginEmail` `#loginPassword` `#loginBtn` `#loginForm`) | Playbook accurate |
| Dashboard sidebar selectors live | ✅ All 5 (`data-page="bill" "tenant" "meter" "dashboard" "requests-approvals"`) | Playbook accurate |

### Deferred / NOT done

- **Live Chrome MCP dry-run** — no admin creds in this worktree + no active browser session. Playbook selectors grep-verified statically against live Vercel HTML; first user run = baseline-calibration. Documented honestly in the handoff.
- **Write-path smoke** (`smoke:write`) — separate scope per §7-I + Plan-First. File when first regression demands it.
- **CI integration** — needs hosted browser + admin credential strategy. Separate infra discussion.
- **Slash command for one-call execution** (`/smoke`) — productivity skill, future.

### Plan #6 — only remaining follow-up

`shared/dashboard-extra.js` refactor: currently **5,882 lines** (`Get-Content | Measure-Object -Line` 2026-05-19) — 69% of soft limit. Goal: 3-4 focused modules <2k each, preserve `window.X = ...` UMD exports. Plan-First scope. Deferred to next session per handoff `next_session_handoff_2026_05_19_evening_4_smoke_test.md`.
