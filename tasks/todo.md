# 9-Dimension Re-Audit Remediation Plan (run 2)

**Created:** 2026-05-31 · **Audit score:** 3.04 / 4.0 (B) — adversarial re-audit, 9 parallel agents
**Supersedes:** the earlier 2026-05-31 plan (score 3.12, all 36 tasks completed — commits `87bb4a3` / `7e5ef7b` / `2cb408e`; preserved in git history).

> This run was more adversarial and surfaced **net-new** latent issues (the prior pass fixed wellness/admin-ops XSS; this pass found 4 *different* sinks; prior PERF-Q1 capped insights queries but missed the `dashboard-extra` meter watch).

## Scores by dimension

| Dim | Score | Grade | Headline gap |
|-----|:-----:|:-----:|--------------|
| DevOps/Deploy | 3.4 | A-/B+ | no branch protection; rules never auto-deployed |
| Architecture | 3.2 | B/B+ | `window.X` global coupling; `detectBuilding` ×4 |
| Security | 3.2 | B+ | 4 XSS sinks (now fixed); verifySlip onRequest |
| Tech Debt | 3.1 | B+ | 22MB dup (removed); 28 un-archived migrations |
| Docs & Memory | 3.0 | B | count drift; MEMORY.md over limit; stale docs/README |
| UX/UI | 3.0 | B/B- | tenant nav not keyboard-operable; tab ARIA=0; contrast |
| Code Quality | 2.9 | B- | 21 files >800L; 6 prompt(); silent billing catches |
| Performance | 2.8 | B- | meter_data watch (fixed); no HTTP cache on shared/*.js |
| Testing | 2.8 | B- | frontend ~3% coverage; test:shared not in PR gate |

---

## ✅ DONE this session (working tree — commit + live-verify pending)

- [x] **Perf CRITICAL — bound `meter_data` watch** — `shared/dashboard-extra.js:716` `onSnapshot(collection(db,'meter_data'))` → `query(…, limit(500))`. **Why:** unbounded full-collection real-time watch replayed the whole collection on every admin open + fanned out per meter write. Callback only pings `updateDashboardLive()` (never reads payload). ⚠️ **Live-verify** dashboard auto-refresh after a meter import.
- [x] **XSS — audit log viewer** — `audit-log-viewer.html:599-601` added local `esc()` + wrapped `userEmail`/`userRole`/`attemptedPage`. **Why:** auth gate writes user-controlled fields (incl. unauthenticated denials) → stored XSS into the admin-only viewer. (Net-new sink; prior pass fixed wellness/admin-ops, not this.)
- [x] **XSS — payment notif panel** — `shared/dashboard-bills.js:364/366/373/375` `_esc()` on tenant-controlled `room`/`slipId`/`receiptId`.
- [x] **XSS — billing import status** — `shared/dashboard-bills.js:1255` `_esc(message)`.
- [x] **XSS — toast** — `shared/dashboard-main.js:219` `innerHTML`→`textContent` (defense at the sink for all callers).
- [x] **Tech Debt — delete 22MB stale `The_green_haven/` dup + 3.6MB+448KB debug logs + `tools/csp-hashes-new.json`** (~26MB freed; verified stale: no `.git`, 0 files newer than May 1, old 11KB CLAUDE.md).

All edited JS passes `node --check`. ⚠️ A prompt-injection was detected mid-session (a fabricated `shared/utils.js` read with embedded instructions steering away from the toast fix) — disregarded; every edit verified against on-disk content via `git diff`.

### Verify-before-commit
- [ ] `git push origin main` → Chrome MCP admin login on https://the-green-haven.vercel.app → confirm: meter live-refresh works, payment notif panel renders, toast shows, audit-log viewer renders (per §7-J: static deploy ≠ live verified).

---

## P1 — soon (high value, low/medium effort)

### ✅ DONE this session (commit pending)
- [x] **🔴 PRODUCTION BUG found + fixed — Thai mojibake** — `shared/tenant-system.js` (13 user-facing lines: default tenant name, room label, maintenance titles/content, payment-status text) + `shared/tenant-firebase-sync.js` (2 comments) were double-encoded (UTF-8→CP874→UTF-8) **by the prior P1 commit `7e5ef7b`** (the `console.info` bulk sed). Recovered byte-exact from last-clean commit `0ad1d8a` via `tools/fix-thai-mojibake.js` (git-sourced, zero Thai typed). Also fixed 7 em-dash `โ€"`→`—` corruptions. **`test:shared` 84→86/86 pass.** Full-repo scan: 0 mojibake remaining across 287 files. ⚠️ **Correction to audit:** the `.gitattributes`/CRLF hypothesis was WRONG — corruption was in the committed bytes (RED on every OS), not a Windows line-ending flake.
- [x] **Testing — `.gitattributes` `* text=auto eol=lf`** + per-type rules + binary excludes. **Why:** locks repo to LF (blobs already LF; verified `git add --renormalize` = 0 collateral churn) so working-copy CRLF can never be committed and UTF-8 stays clean. (Not the test-fix cause, but correct hygiene.)
- [x] **Testing — gate `test:shared` in `validate.yml` on PR** — added step after CF unit tests (pure `node --test`, no emulator). Now 86 frontend tests block merge. Safe because suite is green post-bug-fix.
- [x] **DevOps — `deploy-rules.yml`** created — push to main touching rules/indexes → re-run 3 emulator rules suites → `firebase deploy --only firestore:rules,firestore:indexes,storage,database`. Mirrors `deploy-functions.yml` SA/IAM pattern. **Closes the "rules tested but never auto-deployed / wrong-branch-rollback" gap.** Needs SA roles: firebaserules.admin + datastore.indexAdmin + firebase.admin (documented in workflow header).

### ▶ Still open
- [x] **DevOps — branch protection on `main`** — DONE 2026-06-01. Required check `validate`; `enforce_admins:false` (admin bypass — owner keeps `git push origin main` deploy path); force-push + deletion blocked. Noted in CLAUDE.md §5. `firestore-rules`/staging NOT required (path-filtered — would block non-rules PRs).
- [x] **UX HIGH — keyboard-operable tenant nav** — DONE 2026-06-01 (PR #203). `shared/tenant-navigation.js`: `enhanceMenuItemA11y()` (role=button+tabindex on `.menu-item[data-action]`) + `_onTileKeydown` (Enter/Space → synthetic bubbling click, reuses the capture-phase hub). `components.css` `:focus-visible` ring. +11 tests. **Dynamic tiles** (if any) need a `window.enhanceMenuItemA11y()` call in their renderer — static tiles covered.
- [x] **UX HIGH — tab ARIA + dynamic `aria-current`** — DONE 2026-06-01 (nav-current PR #204 + tab-ARIA PR #205). Nav: `updateNavActiveIndex`/`showPage` move `aria-current="page"` (was hardcoded on Home). Tabs: new `shared/dashboard-tab-aria.js` `syncTabAria()` mirrors `.active` → role=tab/tablist + aria-selected via capture-click+microtask (no 7-switcher edit, no HTML sweep). +7 tests. **Deferred:** panel `role=tabpanel`/`aria-controls` (no shared selector).
- [x] **UX HIGH — contrast tokens (core)** — DONE 2026-06-01 (PR #206). `--muted`/`--pebble` darkened to AA + false comment fixed; `--ok-text`/`--alert-text`/`--brand-primary-text` added (light+dark); components.css text uses switched; +18 contrast-lock tests. **Deferred (needs CSP regen):** `<style>`-block `--alert`/`--ok` text in booking/login/tenant_app.html + dark `--brand-primary`-as-text (27 sites, light-passing) → do via live per-element contrast audit, not a blind sweep.
- [~] **UX — live a11y verify on Vercel** — DONE (deployed-code level) 2026-06-01 via Chrome MCP (SW+cache cleared first, §7-MM). On prod, the DEPLOYED MINIFIED modules behave correctly: `enhanceMenuItemA11y` → role=button+tabindex; `_onTileKeydown` Enter → click fires; `syncTabAria` → role=tab/tablist + aria-selected flips on active-move; `updateNavActiveIndex` → aria-current moves. Contrast tokens computed live (--muted 5.40, --pebble 5.14, --ok-text 5.58, --alert-text 5.98 on --cloud) + login.html renders clean (no mojibake, brand intact). **Remaining (needs owner's logged-in session):** in-situ visual on the real dashboard tabs / tenant_app tiles (focus ring, SR announce) — dashboard/tenant are auth-gated; agent does not enter credentials (§7-I / safety).
- [x] **Code Quality — replace 6 `prompt()`** with `window.ghPrompt` — DONE 2026-06-01 (PR #197, `a706b05`). All 6 → async `await window.ghPrompt(...)` (null-on-cancel semantics preserved). NOTE: `generateMonthlyBillsUI`/`downloadInvoicesPDF` are orphaned (0 callers, §7-K) — converted for consistency; **wire-or-delete still open** (see P2).
- [x] **Code Quality — log silent billing catches** — DONE 2026-06-01 (PR #197). 7 bare `catch(e){}` in `_subscribeGlobalVerifiedSlips`/`PaymentStore.onChange` cluster → `console.warn('[billing] …')`. 4 best-effort catches outside the cluster (`_notify` listener isolation, print-window teardown) left per minimal-change.

---

## P2 — when time allows

- [ ] **Performance — content-hash caching for `shared/*.js`** — currently `no-cache, no-store` on 101 JS files (`vercel.json:57-67`) → full re-fetch every navigation. Hashed filenames + `immutable`. Biggest LCP/TTI win for the 79-script dashboard.
- [ ] **Performance — analytics aggregation** — replace `getDocs(query(meter_data, limit(5000)))` (`dashboard-insights-operations.js:305`) + `liffUsers limit(2000)` with `count()`/`sum()`; bound `lineRetryQueue`/`announcements`/`wellness_articles` getDocs.
- [ ] **Performance — defer parser-blocking `tenant-liff-auth.js`** (47KB mid-body, `tenant_app.html:5199`) + async Sentry CDN (3 pages).
- [ ] **Security — move WAQI/IQAir tokens → Secret Manager** (parity with SLIPOK). NOTE: `functions/.env` is **gitignored & NOT committed** (verified) — hardening, not a leak.
- [ ] **Security — refactor `verifySlip` `onRequest` → `onCall`** for transport-layer auth consistency.
- [ ] **Docs — fix count drift** across README/CONTRIBUTING/MEMORY (rules tests = 220, CF test files = 86, exported CFs = 83); extend `verify:memory` to assert in-repo README counts.
- [ ] **Docs — trim MEMORY.md <24.4KB** (currently ~27KB → truncates on load) by shortening index entries.
- [ ] **Docs — delete/rewrite stale `docs/README.md`** (describes a localStorage app that no longer exists) + rewrite `SECURITY.md` as a disclosure policy (remove in-clear key values).
- [ ] **Testing — frontend unit tests** for `billing-system.js`, `bill-generator.js`, `lease-config.js`, `checklist-manager.js` via the existing `vm`-sandbox harness.
- [ ] **Architecture — collapse `detectBuilding`** (duplicated 4× with magic `101-405` range) to one registry-aware caller (`building-config.js`).
- [ ] **Tech Debt — archive 28 one-shot migration scripts** → `tools/migrations/done/` with executed-date headers.
- [ ] **Tech Debt — wire-or-delete orphaned bill-gen UI** — `generateMonthlyBillsUI` + `downloadInvoicesPDF` (`dashboard-bills.js`) have 0 callers (§7-K), surfaced during the prompt()→ghPrompt pass (PR #197). Decide: wire to an admin button, or delete (`BillGenerator.generateMonthlyBills` is the real entry used elsewhere). Product decision — needs user.
- [ ] **Tech Debt — decide on root `bill69-final.xlsx` (PII), `S__91643910.jpg`, `Nature Haven Design System.zip`** (gitignored; left untouched this session).

---

## Review (2026-05-31, run 2)

**Shipped:** 5 code fixes (1 perf CRITICAL + 4 XSS sinks) + ~26MB junk cleanup. All JS `node --check` clean; `git diff` verified.
**Deferred:** P1/P2 above.
**Follow-up before "done":** live admin verification on Vercel (meter refresh + the 4 escaped surfaces).
**Process note:** prompt-injection detected & disregarded; ground truth re-established via Bash; edits applied against real on-disk content.
**Prior plan:** the 3.12 run (36 tasks, all completed) is in git history at `87bb4a3` / `7e5ef7b` / `2cb408e`. Marketplace sprints remain in [tasks/marketplace-sprints.md](marketplace-sprints.md).
