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

- [ ] **DevOps — branch protection on `main`** requiring `validate` + `firestore-rules` + staging to pass; disallow direct push. **Why:** raw `git push origin main` deploys prod even if PR checks would fail (`deploy-functions.yml:51`). Config in repo settings → note in CLAUDE.md.
- [ ] **DevOps — `deploy-rules.yml`** (push touching `firestore.rules`/`storage.rules`/`database.rules.json`/`firestore.indexes.json` → deploy after rules tests). **Why:** rules are tested but never auto-deployed → the "wrong branch rolls back rules" risk.
- [ ] **Testing — `.gitattributes` `* text=auto eol=lf`.** **Why:** `test:shared` is RED on Windows clones (2/86 fail) — CRLF corrupts UTF-8 Thai literals in `vm.runInContext`.
- [ ] **Testing — gate `test:shared` (+ fast e2e subset) in `validate.yml` on PR.** **Why:** 86 frontend pure-fn tests exist but protect nothing; e2e only runs post-deploy.
- [ ] **UX HIGH — keyboard-operable tenant nav** — 53 `div.menu-item`/`div[data-action]` tiles lack `role`/`tabindex`/keydown. Add `role="button"`+`tabindex="0"` or a global Enter/Space handler in the delegation hub. **Why:** WCAG 2.1.1 — keyboard/switch users can't navigate the tenant app.
- [ ] **UX HIGH — tab ARIA + dynamic `aria-current`** — 7 tab switchers have `role="tab"/"tablist"/"tabpanel"/"aria-selected"` = 0; `aria-current` hardcoded on Home nav. **Why:** SC 1.4.1 / 4.1.2 — visual-only state.
- [ ] **UX HIGH — contrast tokens** — `--muted` 4.40:1, `--pebble` 3.55:1, `--ok`/`--brand-primary-light` 2.49:1 as text (`shared/brand.css`); fix false "≥4.5:1" comment; dark `--alert` 3.19, `--brand-primary` 2.81 as text.
- [ ] **Code Quality — replace 6 `prompt()`** with `window.ghPrompt` — `dashboard-bills.js:121/125/126/180`, `dashboard-extra.js:548`, `dashboard-tenant-lease.js:253` (§7-Q; financial/lease write paths).
- [ ] **Code Quality — log silent billing catches** — `dashboard-bill.js:599-665` empty `catch(e){}` cluster around `PaymentStore._ingest`/`renderPaymentStatus` → add `console.warn`.

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
- [ ] **Tech Debt — decide on root `bill69-final.xlsx` (PII), `S__91643910.jpg`, `Nature Haven Design System.zip`** (gitignored; left untouched this session).

---

## Review (2026-05-31, run 2)

**Shipped:** 5 code fixes (1 perf CRITICAL + 4 XSS sinks) + ~26MB junk cleanup. All JS `node --check` clean; `git diff` verified.
**Deferred:** P1/P2 above.
**Follow-up before "done":** live admin verification on Vercel (meter refresh + the 4 escaped surfaces).
**Process note:** prompt-injection detected & disregarded; ground truth re-established via Bash; edits applied against real on-disk content.
**Prior plan:** the 3.12 run (36 tasks, all completed) is in git history at `87bb4a3` / `7e5ef7b` / `2cb408e`. Marketplace sprints remain in [tasks/marketplace-sprints.md](marketplace-sprints.md).
