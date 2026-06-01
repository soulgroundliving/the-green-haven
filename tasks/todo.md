# 9-Dimension Re-Audit Remediation Plan (run 2)

**Created:** 2026-05-31 · **Audit score:** 3.04 / 4.0 (B) — adversarial re-audit, 9 parallel agents
**Supersedes:** the earlier 2026-05-31 plan (score 3.12, all 36 tasks completed — commits `87bb4a3` / `7e5ef7b` / `2cb408e`; preserved in git history).

> This run was more adversarial and surfaced **net-new** latent issues (the prior pass fixed wellness/admin-ops XSS; this pass found 4 *different* sinks; prior PERF-Q1 capped insights queries but missed the `dashboard-extra` meter watch).

---

## ▶ ACTIVE PLAN (2026-06-02 PM): P2 plan-first — verifySlip→onCall (#1) · defer tenant-liff-auth (#2)

**Status:** ⏳ AWAITING APPROVAL. The two remaining P2 plan-first items (todo lines ~107 + ~109). User decision taken (choice menu): verifySlip auth model = **Admin + owning tenant** (onCall + `_authSoT`).

### ⚠️ Key discovery — scope is bigger than the audit one-liner
Deployed verifySlip returns **401** to POST-without-auth → `requireAdmin` (added 2026-04-24, commit `1176e46` "security hardening") is live. The admin caller (`dashboard-bill-slip-verify.js:128`) sends `Authorization: Bearer <idToken>` and works. But **both tenant callers** (`tenant-slip-verify.js:95` rent · `tenant-cleaning.js:243` ฿500 cleaning) send **no** auth header → **tenant self-slip-verify has 401'd for ~6 weeks**. `verifyTenantSlip` IS fully wired (`tenant_app.html:3587` button → hub `:5361` → module). Option A fixes this as a side effect by gating on admin-OR-owning-tenant via `_authSoT.assertTenantAccess` (same helper 7 other tenant CFs use).

---

### Phase 1 — verifySlip `onRequest` → `onCall` (Option A)

**Why:** (1) transport-layer auth consistency (audit goal) — align with the 7 `_authSoT` onCall CFs, drop manual `Authorization: Bearer` parse + manual CORS; (2) fixes the 6-week-broken tenant self-verify (gamification early_bird/on_time tiers are computed from the tenant's OWN slip date → self-verify was the intended design); (3) defense is **unchanged** — SlipOK cryptographic verify + amount hard-reject (|diff|>1) + atomic `.create()` dedup still gate every call. onCall only changes WHO may call (admin + that room's tenant) and HOW the token is transported.

**Server — `functions/verifySlip.js`**
- [ ] **Trigger swap:** `.https.onRequest(async (req,res)=>…)` → `.https.onCall(async (data, context)=>…)`. *Why:* callable auto-verifies the ID token into `context.auth` + auto-CORS.
- [ ] **Delete** CORS-header block + `OPTIONS`/`GET`/method branches. *Why:* onCall owns transport; keepLiffWarm still warms via GET→4xx (see keepLiffWarm step).
- [ ] **Auth gate:** remove `requireAdmin(req,res)`; move validation up so building+room are known, then `await assertTenantAccess({ building, roomId:String(room), context, firestore: db, HttpsError: functions.https.HttpsError })`. *Why:* admin = Path 0; owning tenant = Path 1 (claim) / 1b (tenantId) / 2a (linkedAuthUid) → survives §7-Z claim-strip + §7-HH stale-UID.
- [ ] **Input:** `req.body` → `data` for `{file, expectedAmount, building, room, userId}`.
- [ ] **Error mapping — THROW vs RETURN (deliberate, minimizes client churn):**
  - **THROW** `functions.https.HttpsError`: `unauthenticated`/`permission-denied` (from `_authSoT`), `invalid-argument` (missing fields · bad base64 · payload >5MB), `resource-exhausted` (rate-limit, keep `retryAfter:60` detail), `internal` (unexpected catch).
  - **RETURN** `{success:false, …}` (NOT throw) for business outcomes shown inline: `scb_delay` (retryable), `amount_mismatch` (+slipAmount/expectedAmount), `isDuplicate`, generic SlipOK fail. *Why:* keeps client branching on `result.success`/`result.code` like today; "slip didn't pass" is not an exception.
  - **RETURN** `{success:true, data:slipData, amountValid:true, amountDiff}` on success.
- [ ] **Req metadata:** `req.ip`/`req.get('user-agent')` → `context.rawRequest?.ip` / `context.rawRequest?.get?.('user-agent')` in `logVerificationAttempt` calls (preserve audit trail). *Why:* v1 onCall exposes raw req under `context.rawRequest`.
- [ ] **Unchanged:** rate-limit (fail-closed), SlipOK call, amount hard-reject, atomic dedup, markBillPaidInRTDB, sendReceiptNotification, recordPaymentAndAwardPoints, region `asia-southeast1`, secrets `[SLIPOK_API_KEY, LINE_CHANNEL_ACCESS_TOKEN]`. *Why:* behavior-preserving — only the transport+auth shell changes.

**Client — 3 callers: `fetch` → `httpsCallable`** (`window.firebase.functions.httpsCallable('verifySlip')(data)` → `{data: result}`)
- [ ] **`shared/dashboard-bill-slip-verify.js`** (admin): drop `getIdToken()`+`fetch(...Authorization...)`; use httpsCallable; read `res.data`; map thrown HttpsError → existing error UI (`err.message`/`err.details`); keep `skipSlipVerify` fallback. *Why:* SDK auto-attaches admin token.
- [ ] **`shared/tenant-slip-verify.js`** (rent): swap `fetch`→httpsCallable; read `res.data`; keep `scb_delay` countdown + success→`goToPaymentStep(3)`. *Why:* tenant signed-in via LIFF custom token → auto-attached → fixes 401. **Verify** whether the `window.firebase.functions.httpsCallable` wrapper forwards a `{timeout}` option; if yes pass `{timeout:12000}` (§7-R), if not rely on SDK default (httpsCallable has a built-in timeout unlike raw fetch — AbortController becomes unnecessary).
- [ ] **`shared/tenant-cleaning.js`** (฿500): same swap; `{file, expectedAmount:500, building, room}` (CF ignores the `context:'cleaning'` field — drop or keep). *Why:* same 401 fix.
- [ ] **CSP:** none expected — callable POSTs to `…cloudfunctions.net` (https:) already allowed by `connect-src 'self' https: wss:`. *(verify on deploy, don't assume.)*

**keepLiffWarm**
- [ ] **`functions/keepLiffWarm.js`** — `verifySlip` `callable:false` → `callable:true`. *Why:* onCall returns 4xx (not 200) to the warm GET; the `callable:true` branch already treats that as expected-warm → no warn-log noise.

**Tests**
- [ ] **Rewrite `functions/__tests__/verifySlip.test.js`** — stub `https.onCall` (capture handler); call `handler(data, context)` for: admin (`context.auth.token.admin=true`), owning tenant (`context.auth.token={room,building}` Path 1), no-auth (expect `unauthenticated`). Assert invalid-argument / resource-exhausted / amount_mismatch RETURN / duplicate RETURN / success shapes. *Why:* current test stubs `onRequest`+`requireAdmin`+`x-no-auth` — all obsolete.
- [ ] **Check `verifySlipReceipt.test.js`** (stubs `onRequest:(fn)=>fn`) + `verifySlipLogic.test.js` — update trigger stub to `onCall` where they load the module; pure-logic tests may be untouched. *Why:* suite is now a PR gate (validate.yml).
- [ ] **Gate:** `npm test` (functions) green before deploy.

**Deploy (⚠️ user-confirmed, coordinated — money-adjacent core flow)**
- [ ] **Sequencing risk:** onCall server + httpsCallable client are NOT compatible with the old shape — deploying one side alone breaks slip verify until the other lands. Plan: merge client PR + `firebase deploy --only functions:verifySlip` back-to-back, low-traffic time. Volume is low (≤50/room/day) — a short window is acceptable.
- [ ] **§branch-before-deploy:** `pwd && git branch --show-current && git log -3 functions/verifySlip.js` first (wrong-branch deploy silently rolls back prod).
- [ ] **Deploy-shape:** onRequest→onCall is https→https (NOT the §7-NN background→callable block) → expected in-place. Fallback if Firebase refuses: `firebase functions:delete verifySlip --region asia-southeast1 --force` then redeploy (brief outage). Secrets already bound → no Secret Manager setup (§7-WW N/A).
- [ ] **Live-verify (§7-J):** admin ตรวจสลิป on Vercel (agent via Chrome MCP) + **user** confirms tenant LIFF rent-slip + cleaning-slip self-verify now succeed (were 401).

**Rollback:** `git revert` client commit → redeploy Vercel **AND** `git revert` CF commit → `firebase deploy --only functions:verifySlip`. Must revert BOTH (matched pair).

---

### Phase 2 — defer parser-blocking JS (todo line ~107)

**2a. async Sentry CDN (4 pages — low risk, clear win)**
- [ ] Add `async` to `<script src="…sentry-cdn.com…">` on `booking.html:47`, `dashboard.html:18`, `tax-filing.html:19`, `tenant_app.html:47` (audit said 3; it's 4). *Why:* Sentry is an independent reporter, nothing calls it at parse-time → safe to unblock the parser. **CSP:** `async` doesn't change anything (external `src`, not an inline hash) → no regen.

**2b. defer `tenant-liff-auth.js` (47KB, `tenant_app.html:5199` — HIGHER risk, §7-PP/§7-A/§7-HH)**
- [ ] **AUDIT FIRST (gate):** module defines the auth spine (`_taBuilding`/`_taRoom`/`_callLiffSignIn`/`_onLiffClaimsReady`). Grep every `<script>` (inline + src) AFTER line 5199 and every deferred script BEFORE it for **parse-time** calls to its exports. *Why §7-PP:* deferred scripts run at DOMContentLoaded in DOM order; an inline script calling these at parse-time runs first → ReferenceError. Most usage is in the delegation hub / event handlers / `_onLiffClaimsReady` callbacks (later) — must be PROVEN, not assumed.
- [ ] If clean → add `defer`, keep tenant-liff-auth positioned before any deferred dependents. If parse-time deps found → **STOP, report, don't force** (breadth-trap: a perf tweak must not risk the auth spine).
- [ ] **Live-verify (mandatory, §7-A/§7-U/§7-HH):** full LIFF auth on real LINE — sign-in → claims arrive → bills/meter/checklist load. Agent can't drive LIFF → **user** verifies. Treat any "stuck at ตั้งค่าสิทธิ์" as a defer-order regression.

**Why 2a/2b split:** 2a is independent + safe → ship freely. 2b touches the most incident-prone file in the repo → gated on an audit + user LIFF verification. Independent of each other and of Phase 1.

---

### Out of scope (named, not silently dropped)
- CSS hashing; identifier-rename minify (build.js Phase B); the audit's already-closed items.
- Removing client-side rate limiters (`_tenantRateLimit`, `checkDashboardRateLimit`) — keep as cheap pre-flight; server rate-limit is the real gate.
- Re-architecting the tenant payment UX — only the auth/transport changes here.

### Review (2026-06-02 PM) — SHIPPED + DEPLOYED
- **Phase 1 (verifySlip onCall)** ✅ PR #224 (squash `ec6330b`) merged + **deployed to PROD** (`firebase deploy --only functions:verifySlip --project the-green-haven` → Successful update; onRequest→onCall in-place, no delete-first needed). Prod probe confirms onCall + handler runs (`{data:{}}` → "File is required"). Restores the ~6-week-broken tenant self-verify.
- **Phase 2a (Sentry defer)** ✅ in #224, live on prod (`sentry-cdn…defer` + `sentry-init.<hash>.js defer` served; 0 CSP drift).
- **Phase 2b (defer tenant-liff-auth)** ❌ AUDITED → SKIPPED — auth spine with a documented synchronous dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). Not forced (breadth-trap).
- **Process note:** first deploy accidentally hit `the-green-haven-staging` (stale `firebase use` alias) — caught from the `Project Console:` URL, re-deployed to prod with pinned `--project`. Lesson added to `feedback_branch_before_firebase_deploy.md` (check `firebase use` before deploy).
- **Follow-up (user):** functional smoke — admin ตรวจสลิป (dashboard) + tenant LIFF rent-slip + ฿500 cleaning-slip now succeed (were 401). Tests: functions 1791 · test:shared 319 · verify:memory green.

---

## ▶ ACTIVE PLAN (2026-06-02): Content-hash caching for `shared/*.js` (P2 item, line ~61)

**Status:** ✅ SHIPPED + PROD-VERIFIED (2026-06-02, PR #223 `d393f35`). Unit 18/18 + full `build.js` temp smoke + **Vercel prod build SUCCESS** + **live curl on prod**: hashed JS 200 w/ `public, max-age=31536000, immutable`; dashboard HTML `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200. Only optional remnant: owner in-app *visual* render (doesn't affect caching — all scripts load 200).

### Goal & Why
Non-SW pages (dashboard, tax-filing, login, booking, index, audit-log-viewer, privacy) currently re-fetch **every** `shared/*.js` on every navigation — `vercel.json` sets `no-cache, no-store, must-revalidate` on `/shared/(.*)\.js`. Dashboard alone pulls **71** local scripts per load. **Why it matters:** biggest LCP/TTI win available; a returning admin re-downloads ~70 files that never changed. **Why it's currently no-cache:** to guarantee freshness after deploy without `?v=` (decision 2026-04-28, [[feedback_vercel_verification]]). Content-hashed filenames make immutable caching *strictly safer* than no-cache (new bytes → new URL → staleness is impossible) **and** faster.

### Research facts that de-risk this (verified 2026-06-02, grep-backed)
- **100% of local JS loads are static `<script src>`** — only dynamic `createElement('script')` is the CDN xlsx (`dashboard-meter-import.js:10`, unpkg). → a build-time `src=` rewrite covers every load; nothing resolves a `shared/` path at runtime.
- **0 SRI** on local scripts (minify already changes bytes) → rename needs no integrity update.
- **CSP** `script-src`/`script-src-elem` use `'self'` for external files (sha256 only for inline) → renaming files = **no CSP change** ([[csp_pipeline]] untouched).
- Ref shapes to rewrite: `./shared/X.js` ×137 · bare `shared/X.js` ×6 · `./accounting/X.js` ×2. (`index.html` 0 local JS.)
- esbuild minify is **deterministic** → unchanged source ⇒ identical hash ⇒ same URL across deploys ⇒ browser keeps the cache (the entire point).
- **Scope = the exact set `build.js` already minifies:** `shared/**/*.js` + `accounting/**/*.js` (102 + 2). CSS (`brand.css`/`components.css`/`tailwind.css`) **out of scope** this round — only 3 files, and `brand.css` is hardcoded in the SW `PRECACHE_URLS`; keep its current header.

### Decision needed — which approach? (recommend A)
- **[A] Build-time content-hash + immutable (RECOMMENDED — the todo's intent).** `build.js` (Vercel-only) renames each minified `shared/X.js`→`shared/X.<hash8>.js`, rewrites all refs from a manifest, then a **build-time verify gate fails the deploy (red) if any ref is dangling** — so a missed reference is a failed build, never a prod 404. Source files keep plain names (local dev untouched). Full win, contained risk. ~1 deploy to revert (HTML is no-cache → always points at current hashes).
- **[C] Fallback — just relax the header.** Change `/shared/(.*)\.js` to `public, max-age=300, stale-while-revalidate=86400`. 1-line, near-zero risk, **partial** win (within-session only) and **reintroduces a small staleness window** the no-cache was chosen to avoid. Offer if A feels too heavy.
- (Rejected: `?v=hash` query strings — Vercel header `source` matches pathname not query, so can't cleanly set immutable; and reverses the explicit "no `?v=`" decision for a worse-caching mechanism.)

### Implementation steps — Approach A (✅ all done 2026-06-02)
- [x] **build.js — hashing pass.** After the JS-minify loop, for each emitted `shared|accounting/*.js`: sha256 of the **minified** bytes → 8-char hash → rename to `<base>.<hash>.js`; record `{ 'shared/X.js': 'shared/X.<hash>.js' }` manifest. **Why:** hash the bytes the browser actually caches; deterministic across unchanged deploys.
- [x] **build.js — ref rewrite.** One pass over all `*.html` (+ SW if it ever refs a hashed asset — it doesn't, JS-only) replacing every `(\./|/)?(shared|accounting)/<name>\.js` with the manifest value, preserving the original prefix (`./` / bare / `/`) + `defer`. **Why:** all 3 prefix shapes exist; must not change load semantics (§7-PP defer-order untouched — order in HTML is preserved, only the filename token changes).
- [x] **build.js — verify gate (the safety net).** After rewrite: assert every remaining `(shared|accounting)/...\.js` ref in HTML maps to an on-disk emitted file, AND no referenced plain name survives. Mismatch → `console.error` + `process.exit(1)`. **Why:** converts "missed ref = silent prod 404" into "failed Vercel build" (§7-J / breadth-trap containment).
- [x] **build.js — ordering.** Run hashing+manifest BEFORE the HTML-minify/rewrite stage so the manifest exists when HTML is processed. **Why:** rewrite needs the final names.
- [x] **vercel.json — headers.** `/shared/(.*)\.js` and add `/accounting/(.*)\.js` → `public, max-age=31536000, immutable`. Leave HTML (`/`, page list) + `service-worker.js` + `manifest.json` + `*.css` on **no-cache** (unchanged). **Why:** hashed JS is safe to pin forever; HTML must stay fresh so it always emits current hashes. (`(.*)\.js` already matches `X.<hash>.js` — greedy.)
- [x] **Pure-function extraction + unit tests (gate).** (`tools/asset-hash.js` + `shared/__tests__/asset-hash.test.js`, 18 tests) Extract `computeAssetManifest(files, readBytes)` + `rewriteHtmlRefs(html, manifest)` + `verifyNoDanglingRefs(htmls, emittedSet)` into a testable module (e.g. `tools/asset-hash.js`); `shared/__tests__/asset-hash.test.js`: hash determinism, all-3-prefix rewrite, defer preserved, dangling-ref → throws, unchanged-file → stable hash. **Why:** matches the project's "extract pure fn + test" gate pattern (#220/#221); lets me prove logic without running the in-place build against the real repo.
- [x] **SW sanity.** (confirmed: no `shared/*.js` in PRECACHE_URLS; cache-first ext-regex matches hashed names; CACHE_VERSION purge unchanged — SW needs no edit) Confirm `service-worker.js` needs **no** change: cache-first matches `.js` by extension regex (works for hashed names); `PRECACHE_URLS` has no `shared/*.js`; CACHE_VERSION bump still purges per deploy. **Why:** §7-MM — verify hashing doesn't worsen the SW-stale-debug trap (it improves it: changed files get new URLs).

### Verification (what I can prove vs what needs the owner)
- [x] **Local (done):** 18/18 unit tests; integration smoke on real files (104 hashable, 10 HTML, 0 dangling, negative case flags bogus ref); **full `build.js` on a throwaway temp working-tree copy** (`FORCE_BUILD=1`, NODE_PATH→real node_modules, tailwind execSync neutralized) → exit 0, `🔗 Content-hashed 104 JS assets; all HTML refs rewritten + verified`, `shared/utils.8708c263.js` emitted + dashboard ref rewritten + 0 plain refs.
- [x] **Headers/refs (done by agent via curl — public static, no auth):** prod `shared/<hashed>.js` → 200 + `public, max-age=31536000, immutable`; dashboard HTML → `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200.
- [ ] **Owner in-app (optional, §7-I — agent can't auth):** hard-reload (clear SW+cache, §7-MM) → dashboard/tenant_app render fine + `(disk cache)` on 2nd navigation + no CSP/console errors + tenant_app (SW page) boots. Not blocking — caching change doesn't alter render; all scripts already proven 200.

### Rollback
`git revert` the build.js + vercel.json commit → redeploy. HTML is no-cache → next load points back at plain names + header returns to no-cache. One deploy cycle, clean.

### Out of scope (named, not silently dropped)
CSS hashing (3 files, SW-precache coupling); identifier-renaming minify (build.js Phase B, separate); the other 2 plan-first P2 items (verifySlip onCall, defer tenant-liff-auth).

---

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

- [x] **Performance — content-hash caching for `shared/*.js`** — ✅ SHIPPED 2026-06-02 (PR #223 `d393f35`, Approach A — see "▶ ACTIVE PLAN" at top). `build.js` content-hashes `shared/*.js`+`accounting/*.js` (104 files) → `immutable`; HTML/CSS/SW stay no-cache. `tools/asset-hash.js` + 18 tests + build-time verify gate. **Prod-verified live** via curl (hashed JS 200+immutable, dashboard no-cache, 0 plain refs, all pages 200).
- [x] **Performance — analytics aggregation** — DONE 2026-06-02 (the actionable remnant). **`lineRetryQueue`** unbounded `getDocs(collection)` → `query(orderBy('firstFailureAt','desc'), limit(500))` (`dashboard-owner-insights.js`). Found + fixed a **latent bug while there**: the CF-health board read `i.createdAt`, but queue docs only carry `firstFailureAt` (enqueue, `merge:false`) → 7-day success-rate/abandoned/avg-attempts were dead and oldest-pending age showed `NaN`. Extracted pure `_computeCFHealthStats` + **+11 tests** (gate 281→292) incl. a `reads firstFailureAt not createdAt` regression guard. **N/A / already-done (per 2026-06-01 handoff):** `meter_data`/`complaints`/`pets`/`liffUsers` can't use `count()`/`sum()` (per-row processing; `liffUsers` count would undercount status-less docs); `announcements`/`wellness_articles` already bounded. ⚠️ Live-verify (owner): admin dashboard → Owner Insights → CF Health card now shows real %/age, not —/NaN.
- [x] **Performance — defer parser-blocking JS** — ✅ async/defer Sentry loader+init ×4 pages (#224). `tenant-liff-auth.js` defer **SKIPPED** — auth spine, documented sync dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). See Review at top.
- [x] **Security — move WAQI/IQAir tokens → Secret Manager** — ❌ DROPPED 2026-06-01 (won't do). Attempted (PR #216) → broke prod CF deploy because the secrets weren't in the prod project (`the-green-haven` 404; my `:get` had checked the wrong project) → reverted `adae1cc`. **Decision: keep `.env`** — it's gitignored + CI-injected from a GitHub Actions secret (not a leak), and Secret Manager was pure hardening not worth the per-project secret-creation + SA-accessor + test-deploy friction for non-critical AQ tokens. Lesson captured in §7-WW. Re-open only if these tokens ever become sensitive.
- [x] **Security — refactor `verifySlip` `onRequest` → `onCall`** — ✅ DONE #224 (admin OR owning-tenant via `_authSoT`); deployed + prod-verified. Restored the ~6-week-broken tenant self-verify (401). See Review at top.
- [x] **Docs — fix count drift** — DONE 2026-06-01. README.md (CF tests 39→86, firestore rules 304→220, added database 48), CLAUDE.md §2 (101→102 files, 26→27 tenant-*.js) + §5 (~70→220 rules cases), MEMORY god-file entry (101→102 shared). Ground truth: 86 CF tests, 83 exported CFs, 220/36/48 firestore/storage/rtdb rules. **`verify:memory` README-count assertion DONE 2026-06-02:** new `runReadmeCountAssertions()` checks 5 in-repo README claims against live counts (firestore 220 / storage 36 / database 48 rule tests · 86 CF unit-test **files** · §7 anti-pattern range+count A–WW/49 vs `### <Letter>.` headings in CLAUDE.md), every occurrence checked so a half-updated README is RED. It immediately caught 3 live drifts → fixed: README commands-table still said firestore "(304 cases)" (the 2026-06-01 fix only touched the layout block — exactly the duplicate-occurrence miss this guards), "86 CF unit tests" relabeled "…files" (the 86 is a file count; ~1.8k `it(` cases), and "§7 A–NN, ~40 patterns" → "A–WW, 49 patterns" (×2 lines). verify:memory green (459 rows, 0 fail).
- [x] **Docs — trim MEMORY.md <24.4KB** — DONE 2026-06-01. 26.2KB → 24.21KiB (197 bytes margin) by compressing Current-state handoff entries + verbose index lines (detail already in linked docs). Fixed stale "checklist-manager skipped / gate 248" → "281, PR #213". `verify:memory` green.
- [x] **Docs — rewrite stale `docs/README.md`** — DONE 2026-06-01. Was a localStorage-era doc (localStorage persistence, localhost:8080, nonexistent tenant-payment.html, © 2024, PII phone) → accurate index of `docs/` runbooks + pointers to root README / CLAUDE.md. **`SECURITY.md` rewritten** as a disclosure policy; removed 3 in-clear API keys (Firebase web, SlipOK, secondary Firebase). ⚠️ Key-rotation status raised with user.
- [x] **Testing — frontend unit tests** — DONE. checklist-manager.js added 2026-06-01 (PR #213, +33 tests, gate 248→281); billing-system / bill-generator / lease-config already covered (prior session). All 4 target modules now have coverage.
- [x] **Architecture — collapse `detectBuilding`** — DONE 2026-06-02. `BuildingConfig.getBuildingForRoom` (`building-config.js`) is now the single source (N-prefix OR named legacy range `NEST_LEGACY_NUMERIC_MIN/MAX` 101-405). `BillingSystem.detectBuilding` + `detectBuildingFromRoomId` + `_taDetectBuilding` all delegate to it (thin defensive inline mirrors kept for pre-load / auth-critical safety). **Latent bug fixed while there:** `getBuildingForRoom` was N-prefix-only AND had 0 callers (§7-K) → it would have returned `'rooms'` for numeric 101-405, disagreeing with the real detector (§7-T landmine); now correct. `detectBuildingFromRooms` (meter-import, array/batch, N-prefix only) intentionally left — different signature + semantics. +9 tests (`building-config.test.js`); behavior-preserving (billing-system's 8 detectBuilding cases still green = fallback === SoT). Gate 292→301.
- [~] **Tech Debt — archive 28 one-shot migration scripts** → `tools/migrations/done/`. ⚠️ **Re-scoped 2026-06-02:** NOT low-blast — only **7** of ~33 one-shots are truly orphan. **7-orphan move DONE 2026-06-02:** `git mv` the 7 (`migrate-lease-duplicates`, `migrate-rewards-strip-note`, `migrate-service-providers-clean-internet`, `backfill-verifiedSlips-from-rtdb`, `fix-csp-styles-p2`, `fix-csp-styles-p3`, `sweep-hex-colors`) → `tools/migrations/done/` + a `README.md` there (archive rationale + per-script purpose/add-date + §7-I do-not-re-run + list of the live templates that stay). Re-verified 0 refs before moving (only self-refs + this todo + handoff). **Still deferred (plan-first):** the other 26 are cited in CLAUDE.md §7 + memory as templates/history → a full archive = doc-repointing sweep past Plan-First threshold (breadth-trap: freeze). Don't blind `git mv *`.
- [x] **Tech Debt — orphaned bill-gen UI** — RESOLVED. `generateMonthlyBillsUI` + `downloadInvoicesPDF` were already deleted by **#202** (a11y session) — grep 2026-06-02 returns 0 definitions. This todo line was stale (written off the PR #197 note). Nothing to do; `BillGenerator.generateMonthlyBills` remains the real entry.
- [x] **Tech Debt — root junk files** — DELETED 2026-06-02 (`bill69-final.xlsx` PII 324K, `S__91643910.jpg` 192K, `Nature Haven Design System.zip` 20K). All were untracked + unreferenced; removed from disk (no commit — never tracked).

---

## Review (2026-05-31, run 2)

**Shipped:** 5 code fixes (1 perf CRITICAL + 4 XSS sinks) + ~26MB junk cleanup. All JS `node --check` clean; `git diff` verified.
**Deferred:** P1/P2 above.
**Follow-up before "done":** live admin verification on Vercel (meter refresh + the 4 escaped surfaces).
**Process note:** prompt-injection detected & disregarded; ground truth re-established via Bash; edits applied against real on-disk content.
**Prior plan:** the 3.12 run (36 tasks, all completed) is in git history at `87bb4a3` / `7e5ef7b` / `2cb408e`. Marketplace sprints remain in [tasks/marketplace-sprints.md](marketplace-sprints.md).
