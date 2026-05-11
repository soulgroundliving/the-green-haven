# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Plan C4 — Dashboard lazy-subscribe (2026-05-11)

## Recon (grep-verified, no DevTools needed)

19 `onSnapshot` listeners in dashboard/* scripts. Categorized by trigger:

### Tier A — Cold-start eager (fire on `DOMContentLoaded`, regardless of tab)
1. **`dashboard-bill.js:660`** × 2 — `buildings/{RentRoom|nest}` doc — `_subscribeBuildingPaymentForBill` at DOMContentLoaded+500ms. **Only consumed by bill page.**
2. **`dashboard-bill.js:731`** — `verifiedSlips` (limit 300, orderBy timestamp) — `_subscribeGlobalVerifiedSlips` at DOMContentLoaded+800ms. **Marks PaymentStore cache; consumed by Bill + Payment Verify pages.** 300-doc initial replay is the heaviest.

### Tier B — Already tab-lazy (subscribe inside `initXxxPage()` called from `showPage`)
- announcements (`dashboard-extra.js:778`) → `initAnnouncementsPage`
- communityEvents (`:3301`) → `initCommunityEventsPage`
- communityDocuments (`:3463`) → `initCommunityDocsPage`
- serviceProviders (`:3090`) → `initServiceProvidersPage`
- leaseRequests (`:1276`) → `initLeaseRequestsPage` (tenant→requests sub-tab)
- historicalRevenue (`:5265`) → Insights page
- wellness_articles (`dashboard-wellness-content.js:315`) → wellness tab
- bookings (`dashboard-bookings.js:67`) → `initBookingsAdmin` (tenant→bookings sub-tab)
- payment-verify verifiedSlips (`dashboard-payment-verify.js:116`) → ⚠️ duplicate of Tier A #2

### Tier C — Trace results (2026-05-11 Phase 1)
All 8 Tier-C listeners verified lazy ✅ — except one:

| Listener | Triggered by | Verdict |
|---|---|---|
| liffUsers (`dashboard-main.js:281`) | `initLiffRequestsPage` ← `switchRequestsTab('liff')` | ✅ lazy |
| meter_data (`dashboard-extra.js:724`) | `setupMeterDataListener` ← `initRoomsPage`/`initNestPage` ← `showPage('property')` | ✅ lazy |
| **complaints (`:3902`)** | **`setTimeout(subscribeComplaints, 800)` at module load** | ⚠️ **EAGER** — but powers home `dashComplaintsStatus` widget for realtime updates. **Defensibly eager** — keep. |
| rewards (`:4290`) | `loadRewardsAdmin` ← `switchGamificationTab('rewards')` | ✅ lazy |
| pets (`:3607`) | `initPetApprovalsPage` ← `switchRequestsTab('pets')` | ✅ lazy |
| gamificationConfig (`:4107`) | `subscribeGamificationConfig` ← `initGamificationPage` ← `showPage('gamification')` | ✅ lazy |
| cleaningServices (`:979`) | `subscribeCleaningCampaign` ← `initHousekeepingPage` ← `switchRequestsTab('housekeeping')` | ✅ lazy |
| tenants/{rooms\|nest}/list (`dashboard-tenant-page.js:142`) | `_setupTenantRealtimeListener` ← `initTenantPage` ← `showPage('tenant')` | ✅ lazy |

### Duplicate check — `dashboard-bill.js:731` vs `dashboard-payment-verify.js:116`
**Not a dup.** `dashboard-payment-verify.js:100-105` reuses `window._verifiedSlipsRawCache` via custom event when global subscriber is warm; falls through to its own listener only if user opens Payment Verify within the first 800ms (rare race). Once Tier-A2 migrates global to lazy on `showPage('bill'|'payment-verify')`, the fallback covers the gap.

### Home-widget consumer check — does Tier-A migration break the home dashboard?
- `updatePaymentStatusWidget` (`dashboard-home-live.js:814`) reads from **BillStore (RTDB)**, NOT verifiedSlips Firestore. ✅ Safe.
- `updateComplaintsWidget` reads from `localStorage.complaints_data` populated by `RequestsStore._ingest`. ✅ Safe (complaints stays eager).
- `_subscribeBuildingPaymentForBill` only consumed by `_refreshPromptPayDisplay` on bill page (plus a localStorage.promptpay mirror for tenant_app.html, which is a separate page and doesn't share JS context). ✅ Safe.

### Phase 2 — Fix the two high-confidence wins (Tier A)
- [ ] **A1: Building payment cache lazy-subscribe** — move `_subscribeBuildingPaymentForBill` from DOMContentLoaded into `initBillPage()` (or first `showPage('bill')`). Verification: open dashboard → switch directly to People Mgmt without visiting bill → confirm no `buildings/RentRoom` listener in Firestore IndexedDB.
- [ ] **A2: Global verifiedSlips lazy-subscribe** — gate `_subscribeGlobalVerifiedSlips` on first `showPage('bill')` OR `showPage('payment-verify')`. 300-doc initial replay only fires when needed.
- [ ] If `dashboard-payment-verify.js:116` is dup → remove the duplicate; let A2 cover both.

### Phase 3 — Tier C fixes (after Phase 1 triage)
- [ ] Migrate any Tier-C subscribers that fire on DOMContentLoaded but only feed admin sub-pages
- [ ] Skip ones that need to stay always-on (gamificationConfig flag, tenants list — these inform global UI)

### Phase 4 — Verify cold-start cost
- [ ] Push to Vercel → open `Network` tab → reload dashboard → count Firestore Listen-channel connections in first 3 sec
- [ ] Expected: drop from ~10–12 listeners on cold-start to ~3–4 (gamificationConfig + tenants + verifiedSlips-now-deferred)

## Why this is safe
- All migrations: move a `subscribe()` call from DOMContentLoaded to first `showPage()`. The render functions already handle empty-cache start (`renderPaymentStatus`, `renderBillPage`).
- Easy rollback: revert one commit.
- No new code, no rule changes, no CF changes — pure listener relocation.

## Out-of-scope for C4
- `dashboard-home-live.js` snapshots (dashboard home is the default tab anyway — eager is correct)
- Tenant SSoT listener (`dashboard-tenant-page.js:142`) — cross-tab caching, needs separate analysis

---

# Plan C-F — Continue Audit (2026-05-09b)

## Recon vs audit map (real numbers)

Ran grep + `npm run verify:memory:all` before planning. Several audit-map claims are stale:

| Item | Map said | Real |
|---|---|---|
| F1 lifecycle docs | (unknown) | **0 fails ✅** (216 verifier rows green) |
| F1 fabricated paths | (warn-only) | **58 warnings across 14 files** — mostly legitimate template `{...}` placeholders that the regex strips into empty shapes |
| F2 booking flow doc | "may be stale after KYC" | **Already has Phase 5 KYC + Phase 6 Early Bird** (lines 181-241). DONE ✓ |
| F3 gamification doc | "player mode not reflected" | **Confirmed**: `gamification_ssot.md` has 0 mentions of `people/`, `role:'player'`, `_subscribeEcoPoints` player branch. Real drift. |
| D3 Sarabun in dashboard | "~40 hardcoded" | **1 occurrence** (line 728, legitimate fallback inside `var(--font-brand,...)`). DONE ✓ |
| D1 console.log | (unknown) | 16 in tenant_app.html + 18 in dashboard.html = **34 total** |
| C3 minInstances | "only liffSignIn + liffBookingSignIn" | Confirmed (+ `keepLiffWarm` scheduled CF) |
| shared/*.js count | "43" | 42 |

## Items dropped from scope (not pending)

- **F2** — booking flow doc current (Phases 5+6 already documented)
- **D3** — Sarabun migration already done; fallback at line 728 is correct CSS

## Phases (priority = ROI × low risk first)

### Phase 1 — Doc hygiene (~15 min, doc-only, no deploy) ✅ DONE

#### F3 — Update `gamification_ssot.md` for player mode ✅
- [x] Added "Player mode" section: `people/{tenantId}` schema, CFs table (5 player CFs), surfaces table, client gating pattern, Firestore rules block, what-is-NOT-awarded
- [x] Updated "Scope" line — clarified Nest-only for tenants + players keep gamification cross-building
- [x] Added `_subscribeEcoPoints` player branch + `getLeaderboard` merge to Consumers section
- [x] Added Verification section (16 grep checks — all hit)

#### Update `dark_mode_audit_state.md` (correct stale claim) ✅
- [x] Replaced "~40 hardcoded `font-family:'Sarabun'`" with corrected note pointing at dashboard.html:728 (legitimate fallback inside `var(--font-brand, ...)`)

### Phase 2 — Code quality quick wins (~30 min, small edits) ✅ DONE

#### D1 — console.log cleanup → NO-OP (with finding) ✅
- [x] Inventoried all 34 lines (16 tenant_app + 18 dashboard)
- [x] Finding: ALL 34 are intentional diagnostic. Project follows `[LIFF]`/`[OTP]`/`✅`/`⚠️`/`⏳` prefix convention; logs are load-bearing for live triage per "Stop guessing — demand state" rule.
- **Decision:** no removals. Even the chatty path-trace lines (dashboard.html 298/313/316/348) provide signal during admin "did it save" triage.

#### F1 — Tighten `verify-memory:all` ✅
- [x] Located fabricated-path scanner in `tools/verify-memory.js:431` `templatePathReport`
- [x] Edits to `tools/verify-memory.js`:
  - Skip `session_*.md` from scan (frozen point-in-time history; refactored paths legitimately appear there)
  - Skip regex literals (`/^...$/`)
  - Skip URLs (`http://`, `promptpay://`, `gs://`)
  - Skip JSX/HTML markup (`<Foo bar={baz}>`)
  - Skip function-call shape (`getDoc(liffUsers/{x})`)
  - Add `node|npm|firebase|jq|curl|cat` to shell-command skip list
  - Strip JS template-literal `${...}` (was leaving stray `$`)
  - Strip trailing field accessors (`.lease.moveInDate`, `.{paidAt,dueDate}`)
  - Expand union blob to include 11 canonical non-lifecycle architecture docs (`gamification_ssot.md`, `auth_liff_sot.md`, etc.)
- [x] Result: **58 → 8 warnings**. Remaining 8 are REAL signal (5 historical-path refs to `meter_data/{building}/{yearMonth}/data` orphaned docs + 1 doctrine teaching example + 2 unindexed paths). Lifecycle verification still 100% green (216 rows, 0 fails).

### Phase 3 — Performance investigation ✅ DONE (read-only reports)

#### C3 — CF cold start cost-benefit ✅
**Inventory:** 41 CFs total. 3 already warm via `minInstances:1` (`liffSignIn`, `liffBookingSignIn`, `keepLiffWarm` scheduled).

**Hot tenant-facing CFs still cold:**
| CF | Frequency | UX impact of cold-start | Worth warming? |
|---|---|---|---|
| `verifySlip` | ~12-15 rent slips/month + retries | +2-3s on critical "did my payment work" loop | **YES — high UX value** |
| `claimDailyLoginPoints` | ~12-25/day (Nest tenants + players) | +2-3s on daily modal open | **YES — fires daily for every active tenant** |
| `notifyTenantOnMeterUpload` | ~12/month (admin-triggered) | Admin-side delay — non-blocking | NO |
| `getRoomAvailability` | low pre-launch, could grow | +2-3s on prospect first visit | DEFER — wait for traffic |
| `redeemReward` | rare | +2-3s on redemption | NO — rare event |
| `getLeaderboard` | unclear; possibly per-page-view | depends on call frequency | INVESTIGATE before deciding |

**Cost calc:** ~$0.40/CF/month per `minInstances:1` instance (idle baseline = 1 × 730hr × $0.0000005/MB-sec × 256MB).

**Recommendation:** Add `verifySlip` + `claimDailyLoginPoints` → +$0.80/month. **Awaiting your approval before deploying.**

#### C2 — Bundle size audit ✅
**Total shared/*.js:** 1,286 KB across 42 files (uncompressed).

**Top 5 contributors (49% of bundle):**
| File | Size | Notes |
|---|---|---|
| `dashboard-extra.js` | 308 KB | The catch-all admin module — 6,300 lines. Largest single file. Splittable by subsystem. |
| `dashboard-insights.js` | 87 KB | Deep analytics — 8 render functions across 5 tabs. |
| `dashboard-bill.js` | 84 KB | Billing tab + PaymentStore + global verifiedSlips listener. |
| `dashboard-requests-admin.js` | 70 KB | Maintenance/housekeeping/complaints admin queue. |
| `dashboard-meter-import.js` | 65 KB | xlsx import + meter saving + LINE notify. |

**Build:** `build.js` runs esbuild on Vercel (whitespace + comment strip only, NO identifier renaming). Expected output ≈ 75-80% of source.

**Real opportunity:** `dashboard-extra.js` could be split (e.g., extract `_insights*` cards, ServiceProvidersStore, RequestsStore into separate files). Not urgent — admin-only, loads once per session.

**Dead-export candidates** → see D2 below.

#### C1 — LCP/image opportunities ✅
**tenant_app.html:** 10 `<img>` tags. Of these:
- 8 are dynamic content (slip/photo/QR/article cover) sized via inline `max-width/max-height` — width/height attrs would be wrong for variable content
- 2 are placeholder/sample images
- **None benefit from `loading="lazy"`** — they're all inside modals or article cards already deferred via `display:none` until interaction

**dashboard.html:** 1 `<img>` only.

**Real opportunity — `shared/bg/nest-*.jpg` background images:**
- 11 weather/seasonal background JPGs in `shared/bg/`
- Total: **2,452 KB** (200-300 KB each)
- Currently loaded one at a time via `tenant_app.html:4856` based on time + weather mode
- WebP conversion would cut each from ~250KB → ~100KB (60% saving)
- Comment at line 4772 already mentions `.webp` paths (intent was there, files are still `.jpg`)

**Recommendation:** Convert nest-*.jpg → nest-*.webp (offline batch). Update line 4856 selector. Add `.jpg` fallback `<picture>` element for browsers without WebP support. Estimated dev: 30 min + WebP tooling. Defer to dedicated session.

#### C4 — Dashboard 900ms init phase identification ✅
**Architecture:** 35 script tags in `<head>` load order (per `dashboard_architecture.md`). DOMContentLoaded handler at `dashboard-main.js:518` is the orchestrator. KPI + charts render at +600ms (per inline comment at `dashboard-main.js:562`).

**Candidate bottleneck:** **84 onSnapshot subscriptions opened at boot** (71 in dashboard-extra.js, 12 in dashboard-bill.js, 1 in dashboard-home-live.js). Each opens a Firestore long-poll stream — even with parallelism, 80+ first-snapshot replays takes time.

**Real profiling needs Chrome DevTools Performance tab on a cold cache** — can't profile via grep. The existing 900ms shimmer skeleton (commit 7e9f... per recent handoffs) covers this UX-wise. Real fix would be lazy-subscribing per active tab (open dashboard-home subscriptions on boot, defer tenant/bill/meter subscriptions until user clicks tab).

**No edits this session** — needs DevTools profiling first.

### Phase 4 — UX gaps ✅ DONE (E2 only)

#### E2 — KPI grid mobile reflow ✅
**Audit:** dashboard.html has 3 separate KPI grid systems:
| Grid | Default | Existing breakpoints | Mobile reflow? |
|---|---|---|---|
| `.kpi-grid` (home) | 4 cols | 2 @1100, 2 @700, 1 @480 | ✅ already reflows |
| `.mx-kpi-grid` (Maintenance/Housekeeping) | 3 cols | 1 @600 | ✅ already reflows |
| `.ana-kpi-grid` (Analytics) | 4 cols | 2 @900 | ❌ **never went to 1 col** |

**Fix shipped:** added `@media(max-width:480px){.ana-kpi-grid{grid-template-columns:1fr;}}` at `dashboard.html:1372` next to the existing 900px rule.

**Why minimal:** the audit-map item said "KPI grid never reflows on mobile" — partially true. Only Analytics was the gap; home + Maintenance already had small-screen rules.

#### E1 — Dark mode unify (DEFERRED — needs dedicated session)
#### E3 — Dark mode automated screenshot test (DEFERRED — Playwright baseline)
#### E4 — Booking flow live E2E (DEFERRED — needs your LINE account)

### Phase 5 — Code quality larger sweeps ✅ DONE (read-only reports)

#### D2 — Dead code in shared/*.js ✅ (CANDIDATE LIST — needs verification)

**Caveat first:** the scan flags `window.X` exports with no external grep references — but these may still be live via:
- `data-action="X"` event delegation (string lookup, won't grep)
- Inline `onclick="X(...)"` handlers (would grep, but worth double-check)
- Dynamic dispatch (`window[name]()`)

**Candidates from first-pass scan (top 20):**
| Export | Source file | Likely real-dead? |
|---|---|---|
| `window.logError` | audit.js | Audit logger entry point — needs grep across HTML for `data-action` |
| `window.logPaymentVerified` | audit.js | Same — audit entry point |
| `window.logSecurityAlert` | audit.js | Same |
| `window.AutoBillCalculator` | billing-system.js | Bill calc — likely dead, MeterStore replaced it |
| `window.SecureConfig` | config-unified.js | Old config indirection? |
| `window.PaymentStore` | dashboard-bill.js | Likely live — used by dashboard-payment-verify |
| `window.dashboardBookings` | dashboard-bookings.js | Booking admin tab — verify via dashboard-main.js |
| `window._gamificationScored` | dashboard-extra.js | Internal flag (`_` prefix = private) — fine being unreferenced |
| `window.calculateOccupancy` | dashboard-extra.js | Likely live — check property page |
| `window.actLeaseRequest` | dashboard-extra.js | Lease action handler — check tenant tab |
| `window._updateLeasePreview` | dashboard-extra.js | Internal `_` |
| `window._resolveBillRecipient` | dashboard-extra.js | Internal `_` |
| `window.RequestsStore` | dashboard-extra.js | Likely live — used by requests admin |
| `window.CommunityEventsStore` | dashboard-extra.js | Likely live — community events |
| `window._spRendererSubscribed` | dashboard-extra.js | Internal flag |
| `window._histStoreSubscribed` | dashboard-extra.js | Internal flag |
| `window._eventsRendererSubscribed` | dashboard-extra.js | Internal flag |
| `window._complaintsRendererSubscribed` | dashboard-extra.js | Internal flag |
| `window._buildingPaymentCache` | dashboard-bill.js | Internal cache |
| `window._globalSlipsUnsub` | dashboard-bill.js | Internal subscription handle |

**Real dead-code candidates worth investigating** (drop the `_` internal-flag ones):
- `window.AutoBillCalculator` — likely superseded by MeterStore
- `window.SecureConfig` — likely superseded by `firebase-config-loader.js`
- `window.logError` / `logPaymentVerified` / `logSecurityAlert` — audit entries; verify they're not data-action targets

**No removals this session.** Per `feedback_minimal_changes` — user picks which to verify+drop.

#### D4 — Function size audit (tenant_app.html) ✅

**Top 15 functions > 50 lines:**
| Lines | Function | Start | Why long |
|---|---|---|---|
| 133 | `_callLiffSignIn` | 8395 | Player + tenant + error branches + token validation |
| 114 | `renderBillsList` | 8906 | Multiple states (paid/unpaid/synthetic/empty) |
| 109 | `saveNewPet` | 6143 | Pet form + photo upload + Firestore + validation |
| 105 | `confirmPhoneOtp` | 7101 | OTP confirm + linkWithCredential + tenant doc + setVerifiedPhone CF |
| 99 | `renderMarketFeed` | 5753 | Marketplace listing render |
| 97 | `_loadLeaderboard` | 7624 | Fetch + player merge + render |
| 82 | `_subscribeBillsRealtime` | 8273 | Auth-gated bills subscription |
| 79 | `renderProfilePage` | 9484 | Profile tab render |
| 78 | `renderPaymentReceipt` | 10175 | Receipt generation |
| 72 | `confirmCleaningPayment` | 5185 | Cleaning payment flow |
| 69 | `initTenantApp` | 8772 | App init orchestrator |
| 68 | `initLiffAndLink` | 8579 | LIFF init + claim refresh |
| 67 | `renderCommunityFeed` | 9030 | Community events render |
| 67 | `_subscribeEcoPoints` | 7723 | Tenant + player branches subscription |
| 62 | `sendPhoneOtp` | 7039 | OTP send + reCAPTCHA + Firebase |

**Observation:** All 15 are "orchestration" functions — long because they handle multiple concerns end-to-end (form → upload → save → notify). Refactoring would mean extracting helpers, which adds indirection without simplifying logic. Per `feedback_minimal_changes` — no refactor without explicit ask.

**If a refactor is wanted:** `_callLiffSignIn` and `confirmPhoneOtp` are best candidates — they have clear sub-stages that could become named helpers.

---

## Final Review — what shipped this session

| Phase | Item | Status | Output |
|---|---|---|---|
| 1 | F3 gamification_ssot player mode | ✅ Shipped | Player section + 16 grep verifiers (all hit) in `~/.claude/.../memory/gamification_ssot.md` |
| 1 | dark_mode memo correction | ✅ Shipped | Stale "~40 Sarabun" claim corrected |
| 2 | D1 console.log cleanup | ✅ No-op (justified) | All 34 logs are intentional diagnostic |
| 2 | F1 verifier tightening | ✅ Shipped (commit `b4c2f08`) | 58 → 8 warnings; 9 detector improvements; lifecycle still 100% green |
| 3 | C3 cold-start cost-benefit | ✅ Report | Recommend `verifySlip` + `claimDailyLoginPoints` (+$0.80/mo) — awaiting approval |
| 3 | C2 bundle audit | ✅ Report | dashboard-extra.js (308KB) is largest single file; splittable but admin-only |
| 3 | C1 image scan | ✅ Report | Real opportunity is `shared/bg/nest-*.jpg` (2.45 MB) → WebP. Not tenant_app `<img>` tags. |
| 3 | C4 dashboard 900ms | ✅ Report | 84 onSnapshot at boot is candidate; needs DevTools profile to confirm |
| 4 | E2 KPI mobile reflow | ✅ Shipped | Single CSS line — `.ana-kpi-grid` 1-col @480px |
| 5 | D2 dead code | ✅ Report | ~20 candidate exports — needs `data-action` cross-check before removal |
| 5 | D4 function size | ✅ Report | Top 15 listed; `_callLiffSignIn` (133) + `confirmPhoneOtp` (105) best refactor candidates |

**Deferred (out of scope this session):**
- E1 (dark mode unify) — dedicated session
- E3 (Playwright baseline) — lower priority
- E4 (booking E2E live) — needs your LINE account on production
- F2 (booking flow doc), D3 (Sarabun) — already done before this session
- C1 WebP migration, C3 deploys, C4 lazy-subscribe — pending your decision

**Pending your decision before further action:**
- Approve adding `minInstances:1` to `verifySlip` + `claimDailyLoginPoints` (+$0.80/mo)? **Deploy needed.**
- Want me to start C1 WebP conversion next session?
- Want me to verify D2 dead-code candidates against `data-action`/`onclick` and propose removals?

---

## Suggested session order

```
Phase 1 (F3 + dark_mode memo)            ~15 min  doc-only
Phase 2 (D1 inventory + F1 verifier fix) ~30 min  small code
Phase 3 (C1-C4 read-only reports)        ~30 min  no edits
Phase 4 (E2 KPI mobile only)             ~20 min  small CSS
Phase 5 (D2/D4 read-only reports)        ~30 min  no edits

Skipped (defer): E1, E3, E4, F2, D3 (E1+E3 dedicated; E4 user action; F2+D3 already done)
```

## Approval check

Want me to start?
- **Recommend:** Phase 1 (doc fix — pure win) + Phase 2 (code quick wins — show data first) immediately
- Phase 3+5 are reports-only — generate then user picks
- Phase 4 = E2 only this session (E1 too big, E3 deferred, E4 needs you)
- Or pick a different subset

---

# Project-Wide Audit Map (2026-05-09)

แผนตรวจสอบโปรเจ็คแบบ end-to-end แยกตามมิติ — เลือกทำเป็นกลุ่ม หรือทีละ item ก็ได้

---

## 🟥 A — Gameplay ที่ยังไม่ครบ (Player mode gaps)
> ดึงจาก handoff 2026-05-08 — shipped player mode แต่ยังมี 4 path ที่ยังไม่ทำ

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| A1 | **Player live E2E test** — ยังไม่มี LINE account จริงที่ถูก `transitionToPlayer` แล้วทดสอบ LIFF | HIGH | S |
| A2 | **Wellness claim สำหรับ player** — `wellnessClaimed` subcollection อยู่ใน tenant doc; player ต้องการ path บน `people/{tenantId}/wellnessClaimed` | HIGH | M |
| A3 | **Reward redemption สำหรับ player** — `redeemReward` CF ใช้ `tenants/{building}/list/{roomId}` ซึ่ง player ไม่มีแล้ว | HIGH | M |
| A4 | **Leaderboard สำหรับ player** — อ่าน `tenants/nest/list/*` เท่านั้น; player ที่ transition ออกไปแล้วหายจาก leaderboard | MED | M |

---

## 🟧 B — Security ที่ pending อยู่
> จาก handoff 2026-04-29 (CSP) + 2026-05-02 (inline handlers)

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| B1 | **CSP enforcement flip** — CSP ยังอยู่ใน report-only mode มา 2 สัปดาห์ (target 2026-05-13) ถึงเวลาแล้ว | HIGH | S |
| B2 | **32 inline event handlers → addEventListener** — prerequisite ก่อน flip CSP enforce | HIGH | L |
| B3 | **Security audit checklist** (`memory/security_audit_checklist.md`) — รัน on-demand, ยังไม่ได้รันหลัง booking flow + player mode ship | MED | M |

---

## 🟨 C — Performance
> ยังไม่เคย audit อย่างจริงจัง

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| C1 | **LCP / image optimization** — `sustainability-solar.jpg` (232KB), `location-area-map.jpg` (270KB) ใน landing site เกิน budget; tenant_app ก็ยังไม่มี WebP/lazy | MED | M |
| C2 | **bundle size audit** — tenant_app.html เป็น single 11,459-line file; shared/*.js 43 ไฟล์; ดูว่า esbuild tree-shake ได้ดีแค่ไหน | MED | S |
| C3 | **CF cold start** — `minInstances:1` ใส่แล้วแค่ liffSignIn + liffBookingSignIn; CF อื่นที่ tenant เรียกบ่อย (verifySlip, claimDailyLoginPoints) ยังเย็นอยู่ | MED | S |
| C4 | **Dashboard 900ms cold start** — shimmer ทำแล้ว แต่ยังไม่ได้ profile ว่า slowest query คือตัวไหน | LOW | M |

---

## 🟦 D — Code quality
> ตรวจเฉพาะจุด — ไม่ใช่ full refactor

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| D1 | **console.log cleanup** — tenant_app.html + dashboard.html ยังมี diagnostic logs (บางอันตั้งใจ เช่น `[OTP]`, `[LIFF]`; บางอันอาจลบได้) | LOW | S |
| D2 | **Dead code ใน shared/*.js** — 43 ไฟล์; ยังไม่เคย audit ว่ามีฟังก์ชันที่ไม่มีใครเรียกแล้ว | LOW | M |
| D3 | **~40 hardcoded `font-family:'Sarabun'` ใน dashboard.html** — ควรเป็น CSS variable; ยังไม่ได้ทำ (จาก dark mode audit doc) | LOW | S |
| D4 | **Function size audit** — ค้นหาฟังก์ชัน >50 บรรทัดใน tenant_app.html ที่แยกได้ | LOW | M |

---

## 🟩 E — UX / UI gaps ที่รู้อยู่
> จาก dark_mode_audit_state.md + UX audit handoffs

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| E1 | **Dark mode dual mechanism unify** — `body.night-mode` (legacy) vs `html[data-theme="dark"]` ยังอยู่คู่กัน; ควร consolidate เป็น attribute เดียว | MED | L |
| E2 | **KPI grid mobile** — dashboard.html KPI grid ไม่ reflow บน mobile; tenant ที่แอดมินใช้มือถือเห็นตัดขอบ | MED | M |
| E3 | **Dark mode automated screenshot test** — verify ด้วยตามือ ทุก session; ควรมี Playwright screenshot baseline | LOW | M |
| E4 | **Booking flow live E2E** — ship แล้ว (2026-05-04) แต่ visual verify ยังเป็น localhost placeholder; ยังไม่ได้ทดสอบ Vercel live จริง | MED | S |

---

## 🔵 F — Docs / Memory drift
> เป็นงาน hygiene — ไม่ urgent แต่ป้องกัน wrong fix ในอนาคต

| # | รายการ | Impact | Effort |
|---|-------|--------|--------|
| F1 | **verify-memory:all** — scan handoff/journal/feedback files สำหรับ fabricated path patterns | LOW | S |
| F2 | **lifecycle_booking_flow.md** — อัปเดต state machine หลัง KYC path ship; doc อาจ stale | LOW | S |
| F3 | **lifecycle_gamification.md** — player mode เปลี่ยน architecture (people/ collection) แต่ doc ยังไม่ reflect | MED | S |

---

## แนะนำ order ถ้าจะเริ่ม

```
Priority 1 (blocking / ใกล้ deadline):
  B1 + B2 — CSP enforce (ถ้าจะทำก่อน 2026-05-13)

Priority 2 (gameplay ยังไม่สมบูรณ์):
  A2 + A3 — wellness + redemption สำหรับ player

Priority 3 (hygiene, เร็ว):
  D1 → D3 → F1 → F3

Priority 4 (nice to have):
  C1 → E2 → E1
```

> **Approval needed:** เลือก group ที่อยากทำก่อน แล้วจะ expand เป็น checkable plan พร้อม Why

---

# Plan A+B — Player Gameplay Completion + Security (2026-05-09)

## Scope realities (จาก grep จริง)

| ข้อ | ประมาณใน audit map | จริง (grep) |
|----|------------------|------------|
| B2 inline handlers | "32" (จาก handoff 2026-05-02) | **181 ใน tenant_app.html + 24 ใน dashboard.html = 205** |
| A2 wellness client | "M" | ~40 lines — 2 ฟังก์ชัน (`_setupWellnessClaimUI` + `claimWellnessReward`) |
| A3 redemption CF | "M" | ~50 lines — `redeemReward.js` + ~20 lines client |
| A4 leaderboard CF | "M" | ~30 lines — `complaintAndGamification.js` + client display |

---

## Phase 1 — A2 + A3: Player wellness claim + reward redemption

### Why
Player ที่ transition ออกจากห้องแล้ว ยังมีหน้า wellness + หน้า rewards ใน tenant_app แต่ทั้งสองหน้าอ่าน/เขียน `tenants/{building}/list/{roomId}` ซึ่ง player ไม่มีแล้ว → ปุ่มพัง, points ไม่ขึ้น

### A2 — Wellness claim (client-only change)

`_setupWellnessClaimUI()` + `claimWellnessReward()` ที่ `tenant_app.html:~9712-9804`

ปัจจุบัน:
```js
const ref = fns.doc(db, `tenants/${_taBuilding}/list/${_taRoom}/wellnessClaimed/${a.id}`);
const tenantRef = fns.doc(db, `tenants/${_taBuilding}/list/${_taRoom}`);
```

Player branch (เพิ่ม):
```js
const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
const claimPath = isPlayer
    ? `people/${window._playerProfile.tenantId}/wellnessClaimed/${a.id}`
    : `tenants/${_taBuilding}/list/${_taRoom}/wellnessClaimed/${a.id}`;
const pointsPath = isPlayer
    ? `people/${window._playerProfile.tenantId}`
    : `tenants/${_taBuilding}/list/${_taRoom}`;
```

- [ ] เพิ่ม `isPlayer` guard ใน `_setupWellnessClaimUI` (อ่าน claim path ที่ถูกต้อง)
- [ ] เพิ่ม `isPlayer` guard ใน `claimWellnessReward` (เขียน claim + increment points)
- [ ] เพิ่ม early-return สำหรับ player ที่ยังไม่มี tenantId (defensive)
- [ ] **Firestore rules** — เพิ่ม rule ให้ player เขียน `people/{tenantId}/wellnessClaimed/{articleId}` ได้

### A3 — Reward redemption (CF + client)

**CF: `functions/redeemReward.js`** — เพิ่ม player branch ก่อน tenant logic (~50 lines):
```js
// Player branch — tok.role === 'player', tok.tenantId
if (tok.role === 'player') {
    const { tenantId, rewardId } = data || {};
    // validate tok.tenantId === tenantId
    // transaction: read people/{tenantId}, check points, write redemptions subcollection, update points
}
```

**Client: `tenant_app.html:~6380` `redeemReward()` function** — เพิ่ม player payload:
```js
const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
const payload = isPlayer
    ? { tenantId: window._playerProfile.tenantId, rewardId }
    : { building: _taBuilding, roomId: String(_taRoom), rewardId };
```

- [ ] `redeemReward.js` — เพิ่ม player branch (validate, transaction บน `people/{tenantId}`)
- [ ] Client `redeemReward()` — เพิ่ม player payload branch
- [ ] Firestore rules — `people/{tenantId}/redemptions` write สำหรับ player
- [ ] Deploy CF: `firebase deploy --only functions:redeemReward`

---

## Phase 2 — A4: Leaderboard แสดง player

### Why
player ที่ transition ออกยังมีแต้ม แต่ไม่โผล่ใน leaderboard เพราะ CF อ่านแค่ `tenants/nest/list/*`

**CF: `complaintAndGamification.js:~399` `getLeaderboard`:**
- เพิ่ม read `people/` collection คู่ขนาน
- Merge + sort ทั้งสองชุด
- Return format เดิม (แค่ name + points + rank) ไม่โชว์ room สำหรับ player

**Client: `tenant_app.html:~7627` leaderboard render:**
- ปัจจุบัน render `r.room` — player ไม่มี room → แสดง "🌿 สมาชิก" แทน

- [ ] `complaintAndGamification.js` — merge `people/` + `tenants/nest/list/*` ใน `getLeaderboard`
- [ ] Client leaderboard render — fallback "🌿 สมาชิก" ถ้าไม่มี `r.room`
- [ ] Deploy CF: `firebase deploy --only functions:complaintAndGamification`

---

## Phase 3 — B3: Security checklist run (audit only)

รัน `memory/security_audit_checklist.md` ทุก domain ต่อ commit ล่าสุด (booking + player mode ship แล้ว):
- [ ] Auth + LIFF scope (new: player claims, booking claims)
- [ ] Firestore rules coverage (new: `people/`, `bookings/`)
- [ ] CF input validation (new: player branch ใน redeemReward หลัง A3)
- [ ] CSP violations (ดู report-only log จริงใน Vercel)
- [ ] Storage rules (booking KYC docs)

ไม่มี code changes — output คือ list ของ gaps ที่เหลือ

---

## Phase 4 — B2 → B1: Inline handlers + CSP enforce

### ⚠️ Scope alert
memory บันทึก "32 inline handlers" — จริงๆ คือ **205 handlers** (181 tenant_app + 24 dashboard)

**Strategy:** Event delegation แทนการ rename ทีละตัว
- เพิ่ม `data-action="funcName"` + `data-action-args="..."` แทน `onclick="funcName(arg)"`
- Single `document.addEventListener('click', e => { ... })` delegator ใน `<script>`
- ลด 205 changes → 1 delegator + 205 attribute renames (safer, ไม่ต้องเพิ่ม id)

ขนาด: ใหญ่มาก (~4-6 ชั่วโมง) — แนะนำทำเป็น sub-session แยก

- [ ] **B2a** — inventory handlers ที่ยาก (pass args, use `this`) vs ง่าย (no-arg)
- [ ] **B2b** — implement delegator + replace handlers ทีละ page
- [ ] **B2c** — verify CSP report-only log = 0 violations
- [ ] **B1** — flip `Content-Security-Policy-Report-Only` → `Content-Security-Policy` ใน `vercel.json`

---

## A1 — Live E2E (user action)
ต้องใช้ LINE account จริงที่ถูก transition: Settings → "ย้ายเป็นสมาชิก" → verify LIFF player flow

---

## Suggested order

```
รอบนี้: Phase 1 (A2+A3) + Phase 2 (A4)  ← gameplay complete
รอบหน้า: Phase 3 (B3 audit) → scope B2 → flip B1
```

## Approval check
- Phase 1+2 เริ่มได้เลย ใช่ไหม?
- B2 ต้องการทำในรอบนี้ด้วยไหม หรือ defer?

---

# FAQ for tenant_app — `page-faq` (2026-05-06)

## Goal
เพิ่มหน้า FAQ ใน tenant_app ตอบคำถาม 5 ข้อที่ลูกบ้านถามซ้ำบ่อย (อิงจาก recurring failure modes ใน memory)

## Why
- `page-terms` (คู่มือการใช้งาน) เป็น tutorial — สอนว่าใช้ยังไง แต่ไม่ช่วยตอน "ติดปัญหา"
- 4 อาการที่ user ถาม (โหลดไม่ขึ้น / ค้าง / login เด้ง / ชื่อขึ้นแต่ข้อมูลไม่ขึ้น) ตรงกับ memory ที่บันทึกไว้:
  - `bills_not_showing_diagnostic.md` — recurring 5+ ครั้ง
  - `feedback_firebase_auth_timing.md` — auth restore race
  - `auth_liff_sot.md` — claims race
  - `next_session_handoff_2026_05_04_auth_speed_liff_regression.md` — cold-start
- ลด ping admin ทาง LINE สำหรับเรื่องที่ตอบเองได้

## Decisions
- **Placement:** หน้าใหม่ `#page-faq` ลิงก์จาก Settings menu — ไม่แทรกใน `page-terms` (tutorial vs FAQ คนละหน้าที่ ตามที่คุยกัน)
- **Pattern:** Native `<details>/<summary>` accordion — ไม่ต้อง JS, accessible โดย default, match Muji minimal
- **โทน:** ภาษาธรรมดา, action-first ("ปิด LINE → เปิดใหม่"), ไม่ใช้ศัพท์ technical
- **Brand tokens:** `var(--primary-green)`, `var(--soft-green)`, `var(--fs-sm)`, `var(--text-muted)` — ไม่ hardcode hex

## Plan

### Step 1 — Add FAQ page DOM
- [ ] แทรก `<div id="page-faq" class="page">` ต่อจาก `#page-terms` (~บรรทัด 4068)
- [ ] App bar: ปุ่ม back chevron (เหมือน page อื่น) + title "คำถามที่พบบ่อย"
- [ ] Card ครอบ 5 `<details>` items
- [ ] **Why:** match `#page-terms`/`#page-privacy` pattern → ไม่ต้องเรียน convention ใหม่

### Step 2 — Wire menu entry in settings
- [ ] เพิ่ม menu-item ใน `#settings` menu-list ก่อน "คู่มือการใช้งาน"
- [ ] Icon: `fa-question-circle`, label "คำถามที่พบบ่อย (FAQ)"
- [ ] `onclick="showPage('page-faq')"`
- [ ] **Why:** วาง FAQ ก่อน User Manual เพราะคนเปิดมาตอนติดปัญหา (urgent) ก่อนอ่าน manual (browse)

### Step 3 — Style accordion (`<style>` ใน head)
- [ ] `.faq-details` wrapper + summary cursor + hover bg = `var(--soft-green)` opacity
- [ ] `details[open] summary` border-bottom + spacing
- [ ] Hide native marker (`::-webkit-details-marker { display:none }` + `details > summary { list-style: none }`) → custom `+`/`−` indicator
- [ ] Reduced-motion guard ตัด transition

### Step 4 — Content (5 Q&A — confirmed)
- [ ] Q1: หน้าโหลดไม่ขึ้น / ค้างที่ spinner → ปิดแอปใน LINE → เปิดใหม่ / รอ 1-2 นาที
- [ ] Q2: บิลเดือนนี้ไม่โผล่ → รอแอดมินอัพมิเตอร์ (ต้นเดือน) / ผ่านวันที่ X แล้วยังไม่มี = แจ้งแอดมิน
- [ ] Q3: login เด้งกลับมาตลอด → เน็ตมีปัญหา / session หมด → ปิด LINE เปิดใหม่
- [ ] Q4: ชื่อขึ้นแต่ข้อมูลห้องไม่ขึ้น → รอ 5 วิ → refresh / ยังไม่ได้ = แจ้งแอดมิน
- [ ] Q5: จ่ายแล้วระบบไม่อัปเดต → สลิปกำลังตรวจ 1-2 นาที / เกิน 5 นาที ตรวจยอดให้ตรงบิล

### Step 5 — Verify on live
- [ ] `git push origin main` → รอ Vercel deploy
- [ ] เปิด https://the-green-haven.vercel.app บน LIFF/desktop → Settings → FAQ → expand แต่ละข้อ
- [ ] Back button กลับ Settings ได้
- [ ] Dark mode (Settings → toggle theme) ดูได้ปกติ

## Out of scope (เลื่อนไว้)
- Search/filter ใน FAQ — แค่ 5 ข้อยังไม่ต้อง
- Tracking ว่าข้อไหนถูกเปิดบ่อย — ค่อยใส่ตอนคำถามเยอะขึ้น
- Auto-link จาก toast errors → FAQ — feature ใหญ่กว่านี้ ค่อยทำรอบหน้า
- Expand FAQ เป็นเรื่องอื่น (จ่ายเงิน / แจ้งซ่อม / แต้ม / สัญญา) — รอ user ส่งคำถามจริงมาก่อน (empirical, ไม่เดา)

## Approval needed before Step 1
ยืนยัน: เลือก placement = new `#page-faq` (ไม่รวมใน page-terms), pattern = native details, 5 Q&A ตามที่ตกลง — ใช่หรือเปล่า?

---

# Nature Haven Landing Page — `naturehaven-living.vercel.app` (2026-05-06) ✅ SHIPPED

## Review (final state 2026-05-06)

🟢 **Live at https://naturehaven-living.vercel.app/** — separate repo, separate Vercel project, React/Vite/TS source.

### What shipped (vs original plan)
- ❌ A1 (subfolder monorepo) — abandoned. Found `naturehaven.vercel.app` was taken globally → renamed to `naturehaven-living.vercel.app`. Then user pivoted to a completely separate repo.
- ❌ Subfolder + brand.css copy — abandoned when we moved to the separate-repo approach.
- ✅ **Separate GitHub repo** `soulgroundliving/naturehaven` (note: account `soulgroundliving` ≠ main repo's `soulgroundliviing`).
- ✅ **Separate Vercel project** `naturehaven-living` with auto-deploy from `main` branch.
- ✅ **Stack: React 19 + Vite 7 + TypeScript + Tailwind v3 + GSAP + Lenis + shadcn/ui** (Kimi-Agent built source).
- ✅ **9 sections**: Hero, About, Residences (5,800/6,200 THB), Amenities, Location, Design, Smart Living, Contact, Footer.
- ✅ **7 real photos** in `public/assets/` (hero-living-space, about-minimal-room, design-philosophy/materials, smart-living-app, sustainability-solar, location-area-map).

### Iteration history (3 design generations in one session)
1. **Gen 1** — vanilla HTML + Tailwind in `landing/` subfolder. Built but never deployed live as production.
2. **Gen 2** — Claude design's static HTML/CSS export. Deployed briefly (~30 min). CSS gradient placeholders only, no real photos.
3. **Gen 3 (final)** — Kimi-Agent React/Vite/TS source from `Kimi_Agent_Nature Haven Quiet Luxury.zip`. Real photos, GSAP animations, Lenis smooth scroll. Live now.

### Memory written
- [`lifecycle_naturehaven_landing_site.md`](../../../C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_naturehaven_landing_site.md) — full architecture + edit flow + gotchas
- [`next_session_handoff_2026_05_06_naturehaven_landing.md`](../../../C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/next_session_handoff_2026_05_06_naturehaven_landing.md) — session-specific handoff
- [`feedback_vercel_ui_overrides_json.md`](../../../C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/feedback_vercel_ui_overrides_json.md) — cross-project Vercel lesson
- MEMORY.md index updated with all 3 entries

### Lessons learned (this session)
1. **`*.vercel.app` is global namespace** — plain `naturehaven` was taken, fell back to `naturehaven-living`.
2. **Vercel UI Build settings override `vercel.json`** — pushing `"framework": "vite"` alone isn't enough if UI has explicit override; user must manually set Framework Preset = Vite. ([feedback doc written](../../../C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/feedback_vercel_ui_overrides_json.md))
3. **Vercel doesn't auto-build on Git connection swap** — need empty commit or manual Redeploy.
4. **Design tool previews ≠ exports** — Claude design's preview showed photos that weren't in the zip; Kimi did include real `.jpg` files.

### Pending for next session (out of scope today)
- [ ] Custom domain (`naturehaven.co.th` / similar)
- [ ] Cross-link CTAs to `the-green-haven.vercel.app/login` (resident sign-in) and `/booking` (LIFF prospect flow)
- [ ] Form backend for ContactSection (currently presentational)
- [ ] Verify LINE link `lin.ee/Z0ujovB6` is correct in source — replace if needed
- [ ] LCP perf optimization (`sustainability-solar.jpg` + `location-area-map.jpg` are >200KB → WebP + lazy-load)
- [ ] Cleanup unused 50+ shadcn components in `src/components/ui/`
- [ ] Analytics (Vercel Analytics or GA)
- [ ] i18n (Thai/English toggle)

---

# (Original plan kept below for traceability — superseded by Review above)

## Context
ลูกบ้าน (resident community) ของ Nature Haven ยังไม่มีหน้า landing สาธารณะ. มีแค่ `tenant_app.html` (LIFF webview) + `booking.html` (prospect flow) + `dashboard.html` (admin). ต้องการสร้าง public marketing/portal landing ที่ `naturehaven.vercel.app` — ตรงตาม two-name rule (Nature Haven = project tenant-facing, ใน [memory/brand_two_names_rule.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\brand_two_names_rule.md)).

## Decisions ที่ต้องเลือกก่อนลงมือ

### A. Repo strategy — **เลือก 1**

- [ ] **A1 (แนะนำ)** — Subfolder ในรีโปนี้ + Vercel monorepo
  - สร้าง `landing/` ในรีโปปัจจุบัน
  - User สร้าง Vercel project ใหม่ใน dashboard, set Root Directory = `landing/`, Project Name = `naturehaven` → ได้ `naturehaven.vercel.app`
  - **Pro:** repo เดียว, ใช้ git+vercel ที่เชื่อมไว้แล้ว, share brand.css ได้ผ่าน symlink/copy
  - **Con:** User ต้องไปกด UI Vercel ครั้งเดียวเพื่อ create project (ผมทำให้ไม่ได้)

- [ ] **A2** — Repo ใหม่แยก (`naturehaven-landing` หรือชื่ออื่น)
  - **Pro:** isolation สมบูรณ์, build/deploy lifecycle แยก 100%
  - **Con:** ต้องสร้าง GitHub repo ใหม่ + push + connect Vercel ใหม่ทั้งหมด, ต้องคัดลอก brand.css/font ข้ามไป

- [ ] **A3** — เก็บใน path เดียวกับ main project แล้ว alias domain
  - เช่น add path `/landing/` บน `the-green-haven.vercel.app` แล้วใช้ Vercel alias เพิ่ม `naturehaven.vercel.app`
  - **Pro:** ไม่ต้อง create project ใหม่
  - **Con:** สอง URL ชี้คอนเทนต์เดียวกัน (SEO ซ้อน) — และ alias `naturehaven.vercel.app` มักไม่ว่างเพราะ vercel.app เป็น shared subdomain

> 👉 ส่วนตัวแนะนำ **A1**: เร็วสุด, share brand token ได้, เปลี่ยน mind ทีหลังย้ายเป็น A2 ก็ง่าย

### B. Audience — **เลือก 1 หรือผสม**

- [ ] **B1** — Marketing สำหรับ prospect (คนยังไม่ได้อยู่)
  - Hero + about ชุมชน + รูปห้อง + ราคา + CTA "จองห้อง" → booking.html
- [ ] **B2** — Portal entry สำหรับ resident (ลูกบ้านปัจจุบัน)
  - Hero + ประกาศชุมชน + ปุ่ม "เข้าระบบลูกบ้าน" → LIFF / tenant_app
- [ ] **B3 (แนะนำ)** — Hybrid: ใครเข้ามาก็ใช้ได้
  - Hero ขายชุมชน + 2 CTA (resident sign-in / book a room) + about + amenities + contact

### C. Visual direction — **เลือก 1**

- [ ] **C1 (แนะนำ)** — Muji minimal continuation
  - ใช้ `shared/brand.css` token ตรงๆ, IBM Plex Sans Thai Looped, teal `#0f766e`, สีพื้น cream/cloud
  - Layout: full-bleed hero photo + restrained type + lots of whitespace
  - Reference: muji.com, kinfolk.com, airbnb plus
- [ ] **C2** — Editorial (warmer, photo-heavy)
  - Bold typography, magazine-style grid, larger imagery
- [ ] **C3** — Brutalist/hand-crafted (โดดเด่นกว่า)
  - มากเกินสำหรับ "quiet living" brand — น่าจะข้ามไป

### D. Content sections (B3 + C1) — confirm

- [ ] Hero: brand name "Nature Haven" (Thai+EN), tagline "ทางสายกลาง", primary photo, 2 CTA
- [ ] About: 3-line philosophy + photo collage (3 รูป)
- [ ] Amenities: 6 cards (Wi-Fi, parking, cleaning, security, community events, gamification rewards)
- [ ] Resident testimonial: 1-2 quote cards (จะใส่ placeholder ก่อน)
- [ ] CTA section: "ลูกบ้านปัจจุบัน → เข้าระบบ" / "สนใจอยู่อาศัย → จองห้อง" — link ไปที่ tenant LIFF + booking.html
- [ ] Contact + footer: The Green Haven Co Ltd, address, LINE official, email

## Plan (สมมติเลือก A1 + B3 + C1)

### Step 1 — Scaffold `landing/` directory
- [ ] mkdir `landing/` ในรีโปนี้
- [ ] `landing/index.html` — single page, vanilla HTML + Tailwind classes + brand.css
- [ ] `landing/vercel.json` — minimal: clean URLs + security headers (mirror หลักจาก root vercel.json)
- [ ] `landing/.vercelignore` — กันไม่ให้ root project deploy `landing/` ออก domain เดิม
- [ ] เพิ่ม `landing/` ลง root `.vercelignore` (สร้างถ้ายังไม่มี) — กันไม่ให้ `the-green-haven.vercel.app/landing/` ขึ้น
- [ ] **Why:** isolation ที่ filesystem level → 2 projects แชร์ git แต่ deploy แยกกันชัดเจน

### Step 2 — Style & assets
- [ ] copy `shared/brand.css` → `landing/styles/brand.css` (snapshot — แก้แยกได้ภายหลัง)
- [ ] หรือ symlink — Vercel build deref symlink อยู่แล้ว (ต้อง verify บน Windows ก่อน)
- [ ] ใช้ Tailwind CDN ตอน prototyping; ถ้า production เพิ่ม Tailwind build pipeline แยก
- [ ] Font: load IBM Plex Sans Thai Looped จาก Google Fonts (เหมือน main app)
- [ ] **Why:** brand consistency — ลูกบ้านเข้า landing แล้วเห็น tenant_app ต่อ จะรู้สึก seamless

### Step 3 — Build content (single index.html)
- [ ] Hero section + 2 CTA buttons
- [ ] About philosophy section
- [ ] Amenities grid (responsive: 3-col desktop / 2-col tablet / 1-col mobile)
- [ ] Testimonial placeholder (ไม่ใส่รูปคนจริงจนกว่าจะมี consent)
- [ ] Final CTA + footer
- [ ] Skip-link + semantic HTML (header, nav, main, section, footer) per `web/coding-style.md`
- [ ] Reduced-motion guard ใน CSS

### Step 4 — Performance & SEO baseline
- [ ] `<meta name="description">` + Open Graph tags + Twitter card
- [ ] `<link rel="canonical">` → `https://naturehaven.vercel.app/`
- [ ] `loading="lazy"` ทุกรูปยกเว้น hero
- [ ] Hero image: `fetchpriority="high"` + explicit width/height (กัน CLS)
- [ ] Preload font subset เฉพาะ weight 400 + 600
- [ ] sitemap.xml + robots.txt (allow all)

### Step 5 — Deployment (manual user steps)
- [ ] User เปิด vercel.com dashboard → New Project → import `the-green-haven` repo อีกครั้ง
- [ ] Project Name: `naturehaven` (ต้องไม่ซ้ำใน vercel ทั้งหมด — ถ้าซ้ำ Vercel จะแนะนำ suffix)
- [ ] Root Directory: `landing/`
- [ ] Framework Preset: Other (static)
- [ ] Build Command: leave blank (or `echo "static"`)
- [ ] Output Directory: `.`
- [ ] Deploy → ได้ `naturehaven.vercel.app`
- [ ] **ผมเขียน checklist screenshot-by-screenshot ให้** หลัง file commit เสร็จ

### Step 6 — Verification
- [ ] เปิด `naturehaven.vercel.app` บน Chrome desktop + iOS Safari
- [ ] ทุก link ใช้งานได้ (resident sign-in → LIFF, booking → booking.html ของ main project)
- [ ] Lighthouse: Performance ≥ 95, A11y ≥ 95, SEO ≥ 95 (per `web/performance.md` + `web/testing.md`)
- [ ] Reduced-motion: เปิดใน OS แล้ว transition ทั้งหมดต้อง ≤ 0.01ms
- [ ] Mobile responsive: 320, 375, 768, 1024 viewports
- [ ] Verify CSP no violations
- [ ] เปิด `the-green-haven.vercel.app/landing/` → ต้อง 404 (ยืนยัน .vercelignore ทำงาน)

## Out of scope (Phase 1 — landing เท่านั้น)
- ❌ Custom domain (เช่น naturehaven.com) — ใช้ vercel.app subdomain ก่อน
- ❌ CMS/admin สำหรับแก้ content — แก้ HTML ตรงๆ
- ❌ Form submission/contact form — ใช้ LINE official link แทน (ไม่ต้อง backend)
- ❌ i18n (EN/TH) — Thai-first, EN พอเหมือน tagline
- ❌ Analytics — เพิ่มภายหลังเมื่อ deploy เสร็จ
- ❌ Booking flow integration ลึก — แค่ link ไป `booking.html` ของ main project

## ⚠️ ขอ confirm 3 ข้อก่อนลงมือ

1. **Repo strategy** = **A1** (subfolder + Vercel monorepo) ใช่ไหม?
2. **Audience** = **B3** (hybrid) ใช่ไหม?
3. **Visual direction** = **C1** (muji minimal ต่อจาก brand เดิม) ใช่ไหม?

ถ้าตอบ "OK ทั้ง 3 ข้อ" หรือ "ลุย A1 B3 C1" → ผมจะเริ่ม Step 1 ทันทีและไม่ถามอีก

ถ้าอยากเปลี่ยน → บอกตัวเลือกใหม่ (เช่น "A2 + B1" — ผมจะปรับแผนแล้วถาม confirm รอบใหม่)

---

# UI/UX Foundation Migration — Phase 1 (audit 2026-05-04)

## Context
Senior UI/UX audit พบว่า design system มี (`shared/brand.css`) แต่ใช้จริงแค่ `booking.html` (19 token). 4 surface ใหญ่ (`dashboard.html`, `tenant_app.html`, `login.html`, `tax-filing.html`) ยัง bypass token + hardcode hex 1083 จุดรวม. User เลือก "เอา palette ของ tenant_app เป็น brand ใหม่" (teal-based แทน emerald/shamrock).

## Approach
Phase 1 = foundation only (ไม่ใช่ visual overhaul). Migrate token + เพิ่ม a11y พื้นฐาน + สร้าง component library กลางที่ทุก surface เรียกได้. Visual ไม่ควรเปลี่ยน drastically — แค่ cleanup + standardize.

## Step 1 — Migrate brand.css palette (teal) ⏳
- [ ] เก็บ token จาก [tenant_app.html:178-200](tenant_app.html:178) เป็น brand SoT
- [ ] [shared/brand.css:42-65](shared/brand.css:42): swap emerald `#2d8653` → teal `#0f766e` family
  - `--brand-primary: #0f766e` (was #2d8653)
  - `--brand-primary-dark: #0d5c4e` (was #1f6b3f)
  - `--brand-primary-soft: #ecfdf5` (was #d4e8dc)
  - `--brand-primary-wash: #f2f7f5` (was #f0f7f2)
  - เพิ่ม `--brand-primary-light: #14b8a6` (ใหม่ — สำหรับ success/highlight)
- [ ] อัพเดท `--ok` ให้ตรงกับ teal family
- [ ] **Why:** ลด parallel system. tenant_app comment เขียนว่า "Unified with dashboard brand" อยู่แล้ว → token แท้จริงตรงกัน
- [ ] Verification: ดู booking.html บน vercel — สีน่าจะเปลี่ยน (booking ใช้ token จริง)

## Step 2 — Add `:focus-visible` global ring
- [ ] [shared/brand.css](shared/brand.css): เพิ่ม rule ครอบ `button, a, input, select, textarea, [tabindex], [role="button"]`
- [ ] ใช้ 2px outline + offset 2px + token color `--brand-primary`
- [ ] **Why:** Keyboard user มองไม่เห็นว่ากำลังอยู่ตรงไหน — quick win 1 rule แต่แก้ทุก surface
- [ ] Verification: tab ผ่านปุ่มใน booking.html / tenant_app บน vercel — มีกรอบเขียวขึ้น

## Step 3 — Component library กลาง (`shared/components.css`)
- [ ] สร้างไฟล์ใหม่ `shared/components.css` — load หลัง brand.css
- [ ] `.gh-btn` family: `--primary`, `--ghost`, `--danger`, `--icon`, `--small/--large` size
- [ ] `.gh-card` + `.gh-card--raised` + `.gh-card--inset`
- [ ] `.gh-input` + `.gh-input--invalid` + `.gh-label` + `.gh-helper-text` + `.gh-required-mark`
- [ ] `.gh-badge` family: `--success`, `--warning`, `--danger`, `--info`, `--neutral`
- [ ] `.gh-skeleton` + animation (สำหรับ loading state)
- [ ] **Why:** ทุก surface ใหม่ใช้ class นี้ — surface เก่า migrate ทีละหน้า
- [ ] **Constraint:** token-only, ZERO hex inside

## Step 4 — Modal helper (`shared/modal.js`)
- [ ] สร้าง module เดียว — wrapper รอบ `<dialog>` element หรือ overlay div
- [ ] รับผิดชอบ: ESC-to-close, focus trap, backdrop click, aria-modal, aria-labelledby, scroll lock
- [ ] API: `Modal.open({ title, body, actions, onClose })` + `.close()`
- [ ] **Why:** 5+ modal pattern ทุกวันนี้ ไม่มีตัวไหนมี ESC/focus trap. Helper เดียวแก้ทั้งโปรเจ็ค
- [ ] **Migration path:** ไม่ rewrite modal เก่าใน step นี้ — แค่สร้าง helper. Modal เก่า migrate ใน Phase 2

## Step 5 — Migrate dashboard.html (token-ize)
- [ ] เป้า: ลด hardcoded hex จาก 342 → < 50 (เหลือไว้แค่ chart color, status indicator เฉพาะ)
- [ ] swap `#2d8653` → `var(--brand-primary)` (ทั้งไฟล์ — ถูกอยู่แล้วเพราะ teal เป็น primary ใหม่ ไม่ต้องลำบาก)
- [ ] swap `#1a5c38` → `var(--brand-primary-dark)`
- [ ] swap `#e8f5e9` → `var(--brand-primary-soft)`
- [ ] อ่านตาราง breakpoint [1661-1718](dashboard.html:1661): font 11-12px ที่ <900px → ขยายเป็น 13px ขั้นต่ำ
- [ ] **Why:** ZERO token + 342 hex = visual debt สูงสุดในโปรเจ็ค
- [ ] Verification: เปิด dashboard บน vercel ดูทั้ง 10 หน้า — visual diff ควรน้อย (สี close enough)

## Step 6 — Migrate login.html
- [ ] [login.html:23,41](login.html:23): hardcoded gradient → token
- [ ] เอา `font-family: 'Sarabun'` inline 30+ ออก — inherit จาก html
- [ ] เพิ่ม `aria-label` บน 3 role button + password toggle (`aria-pressed`)
- [ ] เพิ่ม `aria-describedby` link error message ↔ input
- [ ] Spinner: `role="status" aria-live="polite"`
- [ ] **Why:** ZERO aria + bypass brand. Auth gate ของ admin ต้อง accessible

## Step 7 — Migrate tax-filing.html
- [ ] [tax-filing.html:36-59](tax-filing.html:36): ลบ duplicate `:root` ทั้ง block — brand.css cover แล้ว
- [ ] เพิ่ม `@media (max-width: 768px)`: sidebar collapse, body margin-left: 0, KPI grid 2-col
- [ ] เพิ่ม `aria-label` บน sidebar button + `<canvas>` `aria-label` หรือ `<figcaption>`
- [ ] **Why:** mobile broken + zero a11y สำหรับบัญชีที่ใช้ tablet

## Step 8 — Spot fixes tenant_app.html
- [ ] [3786-3801](tenant_app.html:3786): bottom nav `<div onclick>` → `<nav role="navigation">` + `<button aria-label>`
- [ ] [1192](tenant_app.html:1192): `.btn-receipt` padding 13px → 16px (44px target)
- [ ] เพิ่ม global ESC handler ผูกกับ Modal.close() ของ shared/modal.js (จาก Step 4)
- [ ] เพิ่ม `@media print` สำหรับ receipt section — ตัด nav, ตัด button
- [ ] **Why:** spot fix red flags. ไม่ rewrite tenant_app ทั้งหมด — ของใหญ่เกินไป (10k LOC) เก็บไว้ Phase 2

## Phase 2 (deferred — confirm later)
- Loading skeleton ในหน้า bills/rewards/insights
- Empty state illustrations (muji-style)
- Confirmation dialog แทน native `confirm()` ใน dashboard
- Migrate modal เก่าใน tenant_app + dashboard เข้า Modal helper
- Dark mode

## Verification protocol (ทุกขั้น)
1. `npm run tailwind:build` (ถ้าแตะ Tailwind input)
2. `git push origin main` → vercel auto-deploy
3. เปิด https://the-green-haven.vercel.app บน Chrome + iOS Safari mobile
4. Smoke test surface ที่แก้ + 1 surface ที่ไม่ได้แก้ (regression check)
5. `npm run verify:memory` ก่อน commit

## Out of scope
- ไม่ rewrite tenant_app.html ทั้งไฟล์ (10k LOC)
- ไม่เปลี่ยน visual identity (สียังเป็น green family)
- ไม่ใส่ illustration ใหม่ (รอ Phase 2)
- ไม่แตะ payment.html (legacy, มี SecurityUtils session แยก)

## Review (shipped 2026-05-04)

### Steps completed (8/8)
- [x] Step 1 — brand.css palette swap to teal (`#0f766e` family) + new `--brand-primary-light: #14b8a6`
- [x] Step 2 — `:focus-visible` global ring (2px outline, brand color, kbd-only)
- [x] Step 3 — `shared/components.css` ใหม่ — `.gh-btn`, `.gh-card`, `.gh-input`, `.gh-badge`, `.gh-skeleton`, `.gh-modal-*` (token-only, ZERO hex)
- [x] Step 4 — `shared/modal.js` UMD-ish helper — ESC-to-close, focus trap, backdrop click, aria-modal, scroll lock, restore-focus, `GhModal.open/.confirm/.alert`
- [x] Step 5 — dashboard.html — `:root` aliased to brand tokens, 10 high-frequency hex → token, 101 `font-family: 'Sarabun'` → `var(--font-brand)`
- [x] Step 6 — login.html — gradient + 35 hex → token, 8 instances Sarabun → brand font, 18 ARIA additions (radiogroup, alert/status live regions, label-for, password toggle aria-pressed, inputmode)
- [x] Step 7 — tax-filing.html — `:root` aliased, hamburger toggle + backdrop + JS handlers (`toggle-sidebar`, `close-sidebar`), canvas `aria-label`
- [x] Step 8 — tenant_app.html — bottom nav `<div onclick>` → `<nav role="navigation"><button>`, `aria-current="page"` flip in showPage(), `.btn-receipt` 13px→14px+min-height 44px, `@media print` for receipts

### Stats (final grep counts)

| Surface       | brand tokens | hardcoded hex |   ARIA |
|---------------|-------------:|--------------:|-------:|
| tenant_app    |  2 → 2       |  601 → 605¹   |  9 → **25** |
| dashboard     |  **0 → 5**   |  **342 → 258** |  9 → 9 |
| booking (gold)|  19 → 19     |    6 → 6      |  3 → 3 |
| login         |  **0 → 14**  |   **35 → 15** |  **0 → 18** |
| tax-filing    |  **0 → 5**   |  **105 → 93** |  **0 → 7** |
| **total**     | **21 → 45**  | **1089 → 977** | **21 → 62** |

¹ tenant_app uptick: print stylesheet adds `#fff #999 #ccc` (intentionally hardcoded for print neutrals)

### Verification
- [x] `node -c shared/modal.js` → OK
- [x] `npm run verify:memory` → 22 docs, 212 rows, 0 fails (ALL GREEN)
- [ ] `git push origin main` → vercel deploy → smoke test 5 surfaces
- [ ] iOS Safari mobile test for tax-filing hamburger
- [ ] Test print preview ของ receipt บน tenant_app

### Phase 2 — shipped 2026-05-04 (same session)

- [x] **Step 1** — `shared/modal-a11y-bridge.js` (UMD, ~150 LOC). ESC-to-close + backdrop click + focus restore + auto-focus first focusable. Loaded into 5 surfaces (tenant_app, dashboard, login, tax-filing, booking) — applies to ALL existing `[role="dialog"][aria-modal="true"]` modals without rewrites
- [x] **Step 2** — `window.ghConfirm()` helper added to `shared/modal.js`. Migrated 6 critical destructive confirms: dashboard logout (dashboard.html:527), delete contract file, clear owner info, end lease, delete lease, clear payment notifications. Pattern: `ghConfirm('msg', { danger: true }).then(ok => { if (!ok) return; ... })`. ~14 lower-priority confirms left in place for follow-up
- [x] **Step 3** — `showBillsSkeleton()` in tenant_app.html (~20 LOC). Wired into `showPage('usage')` so users see 3 skeleton cards while bills load instead of blank section
- [x] **Step 4** — `shared/empty-states.js` (UMD) + `.gh-empty-state*` classes. 5 stock SVG illustrations (bills, marketplace, messages, tasks, generic — single-stroke muji line art). 3 spots upgraded in tenant_app: community feed, marketplace, rewards modal. Replaces emoji + plain text with proper illustration + title + helper text + optional CTA
- [x] **Step 5** — Dark mode tokens in `shared/brand.css`. Auto via `prefers-color-scheme: dark` + manual opt-in via `<html data-theme="dark">`. tenant_app.html `:root` aliased to brand tokens so dark mode propagates without rewriting individual styles. ZERO visual change in light mode (intentional)

### Files created in Phase 2
- `shared/modal-a11y-bridge.js` (legacy modal upgrade, no rewrites needed)
- `shared/empty-states.js` (5 muji SVG illustrations + JS API)

### Files modified in Phase 2
- `shared/modal.js` (+ `window.ghConfirm` helper)
- `shared/components.css` (+ `.gh-empty-state*` family)
- `shared/brand.css` (+ dark mode token block)
- `shared/dashboard-extra.js` (5 confirm migrations)
- `dashboard.html` (logout confirm + script loads)
- `tenant_app.html` (script loads + skeleton + 3 empty states + brand alias for dark mode)
- `login.html`, `tax-filing.html`, `booking.html` (script loads)

### Phase 2 Verification
- [x] `node -c` on 4 modified JS files → ALL OK
- [x] `npm run verify:memory` → 22 docs, 212 rows, 0 fails (ALL GREEN)
- [ ] `git push origin main` → vercel deploy → verify on https://the-green-haven.vercel.app
- [ ] Test dark mode by setting `prefers-color-scheme: dark` in DevTools
- [ ] Test ESC-to-close on quiz-modal, daily-modal, rewards-modal in tenant_app
- [ ] Test `ghConfirm` flow on dashboard logout

### Phase 3 — shipped 2026-05-04 (same session)

- [x] **Step 1** — Dark mode toggle UI. New `shared/theme-toggle.js` (UMD) — auto/light/dark cycling, persists in `localStorage.gh_theme`, applies before first paint to avoid FOUC. Loaded into 5 surfaces. Theme toggle button added to: tenant_app Settings page (between Theme + Night Mode rows) and dashboard sidebar footer (icon-only variant). New `.gh-theme-toggle` + `.gh-theme-toggle--icon` classes in components.css. Icons: 🌓 auto / ☀️ light / 🌙 dark
- [x] **Step 2** — Migrated 12 destructive `confirm()` → `ghConfirm()`:
  - `dashboard-content-features.js` × 1 (deleteAnnouncement)
  - `dashboard-extra.js` × 8 (removeOwnerLogo, removeApartmentLogo, removeOwnerFavicon, deleteServiceProvider, deleteEvent, deleteDocument, rejectPet, removePetApproval, deleteReward, cleanupAnonUsers, gamification toggle)
  - `dashboard-bookings.js` × 1 (doCancelLock)
  - `dashboard-bill.js` × 1 (resetRoomPayment)
  - `dashboard-requests-admin.js` × 3 (deleteMaintenanceRequest, stopCleaningCampaign, deleteHousekeepingRequest)
  - `dashboard-room-config.js` × 1 (deleteRoom)
  - `dashboard-tenant-page.js` × 2 (deleteTenant, deleteExpense)
  - `dashboard-wellness-content.js` × 1 (deleteWellnessArticle)
  - **3 informational confirms left** (KYC approval, start cleaning campaign, import sample articles) — positive flows, lower priority
- [x] **Step 3** — Bills empty state in tenant_app. Replaced "hide section when no bills" behavior with `GhEmptyState.html('bills', ...)` — shows muji line-art illustration + "ยังไม่มีบิล" title + helper text instead of blank screen

### Files created in Phase 3
- `shared/theme-toggle.js` — auto/light/dark cycling with persistence (UMD)

### Files modified in Phase 3
- `shared/components.css` (+ `.gh-theme-toggle` + `.gh-theme-toggle--icon`)
- `tenant_app.html` (theme-toggle script load + Theme row in Settings + bills empty state)
- `dashboard.html` (theme-toggle script load + icon button in sidebar footer)
- `login.html`, `tax-filing.html`, `booking.html` (theme-toggle script load)
- 8 dashboard-*.js files (12 confirm migrations)

### Phase 3 Verification
- [x] `node -c` × 12 JS files → ALL OK
- [x] `npm run verify:memory` → 22 docs, 212 rows, 0 fails (ALL GREEN)
- [ ] `git push origin main` → vercel deploy → verify live
- [ ] Test theme toggle: cycle auto → light → dark → auto on tenant_app Settings + dashboard sidebar
- [ ] Test 12 destructive flows on dashboard — confirm modal appears with red ลบ button
- [ ] Test bills empty state for new tenant (no bills yet)

### Total stats across Phase 1+2+3 (this session)

| File | Created | Description |
|------|---|---|
| `shared/components.css` | Phase 1 | `.gh-btn` `.gh-card` `.gh-input` `.gh-badge` `.gh-skeleton` `.gh-modal-*` `.gh-empty-state*` `.gh-theme-toggle*` |
| `shared/modal.js` | Phase 1 | `GhModal.open/.confirm/.alert` + `window.ghConfirm` |
| `shared/modal-a11y-bridge.js` | Phase 2 | ESC + backdrop + focus restore for legacy modals (no rewrite needed) |
| `shared/empty-states.js` | Phase 2 | 5 muji line-art SVGs + `GhEmptyState.render/html` |
| `shared/theme-toggle.js` | Phase 3 | Auto/light/dark cycling with persistence |

| Stat | Before | After |
|---|---:|---:|
| Brand tokens used (5 surfaces) | 21 | 45+ |
| Hardcoded hex (5 surfaces) | 1089 | 977 |
| ARIA attributes (5 surfaces) | 21 | 62+ |
| `:focus-visible` ring | none | global, all interactive |
| Modal ESC + backdrop close | 0 modals | ALL legacy + new modals |
| `confirm()` migrations | 0 | **18** destructive calls |
| Dark mode | none | auto + manual toggle |
| Empty state illustrations | 0 | 4 spots |
| Loading skeleton | none | bills page |
| Print stylesheet | none | tenant_app receipts |

### Phase 4 — shipped 2026-05-04 (same session)

- [x] **Step 1** — `shared/haptics.js` (UMD, ~80 LOC). LIFF-first → Web Vibration fallback → silent on desktop. 5 patterns (tap/select/success/warning/error). Respects `prefers-reduced-motion`. Wired to 4 LIFF actions in tenant_app: claimDailyPoints (success/warning/error), redeemReward (tap+success+error), claimWellnessReward (success/error), cleaning slip verify (success/error)
- [x] **Step 2** — Migrated 3 remaining informational `confirm()`: doApproveKyc, startCleaningCampaign, seedWellnessStarters
- [x] **Step 3** — `window.ghAlert()` helper added to modal.js. Migrated 13 alert() across 4 files: dashboard-extra.js (4), dashboard-payment-verify.js (5), dashboard-main.js (3 + 1 inline confirm bonus), dashboard-home-live.js (1)
- [x] **Step 4** — Rewards modal skeleton in tenant_app. `openRewardsShop()` pre-fills 3 skeleton cards before first onSnapshot lands
- [x] **Step 5** — `shared/onboarding-tour.js` (UMD, ~200 LOC) + CSS. Spotlight + tooltip + smart placement. 4-step tour for first-time tenant: welcome → bottom nav → bills tab → ready. Gated by `localStorage.gh_tour_done_tenant_v1`. Auto-fires 800ms after splash removal when `hasRoom`. ESC dismisses + responds to viewport resize

### Files created in Phase 4
- `shared/haptics.js` — `GhHaptic.{tap,success,warning,error,select}`
- `shared/onboarding-tour.js` — `GhTour.{start,reset,hasSeen}`

### Files modified in Phase 4
- `shared/modal.js` (+ `window.ghAlert` helper)
- `shared/components.css` (+ `.gh-tour-*` family)
- `tenant_app.html` (haptics + tour scripts loaded + 4 haptic call sites + redeemReward → ghConfirm + tour trigger after splash + rewards skeleton in openRewardsShop)
- 7 `dashboard-*.js` files (13 alert→ghAlert + 4 confirm→ghConfirm)

### Phase 4 Verification
- [x] `node -c` × 10 JS files → ALL OK
- [x] `npm run verify:memory` → 22 docs, 212 rows, 0 fails (ALL GREEN)
- [ ] `git push origin main` → vercel deploy → verify live
- [ ] Test haptic on actual LIFF device (feel vibration on claim/redeem)
- [ ] Test onboarding tour: `localStorage.removeItem('gh_tour_done_tenant_v1')` then reload → 4-step tour appears
- [ ] Test 13 alert dialogs surface as GhModal (not native)

### Cumulative stats — Phase 1+2+3+4 (this session)

| File | Phase | Description |
|------|---|---|
| `shared/components.css` | 1 | `.gh-btn` `.gh-card` `.gh-input` `.gh-badge` `.gh-skeleton` `.gh-modal-*` `.gh-empty-state*` `.gh-theme-toggle*` `.gh-tour-*` |
| `shared/modal.js` | 1 | `GhModal.{open,confirm,alert}` + `window.ghConfirm` + `window.ghAlert` |
| `shared/modal-a11y-bridge.js` | 2 | ESC + backdrop + focus restore for legacy modals |
| `shared/empty-states.js` | 2 | 5 muji line-art SVGs + `GhEmptyState.{render,html}` |
| `shared/theme-toggle.js` | 3 | Auto/light/dark cycling with persistence |
| `shared/haptics.js` | 4 | `GhHaptic.{tap,success,warning,error,select}` |
| `shared/onboarding-tour.js` | 4 | `GhTour.{start,reset,hasSeen}` |

| Stat | Before (start of session) | After Phase 4 |
|---|---:|---:|
| Brand tokens (5 surfaces) | 21 | 45+ |
| Hardcoded hex | 1089 | 977 |
| ARIA attributes | 21 | 62+ |
| `:focus-visible` ring | none | global |
| Modal ESC + backdrop | 0 modals | ALL |
| `confirm()` migrations | 0 | **21** |
| `alert()` migrations | 0 | **13** |
| Dark mode | none | auto + toggle UI |
| Empty state illustrations | 0 | 4 spots |
| Loading skeleton | 0 | bills + rewards |
| Print stylesheet | none | tenant_app receipts |
| Haptic feedback | none | 4 LIFF action sites |
| Onboarding tour | none | 4-step first-run guide |

### Known follow-ups (Phase 5+)
- Migrate dashboard's 5+ modal patterns (`.ui-modal`, `.pay-modal-overlay`, `.photo-modal`) to GhModal directly
- Loading skeleton for insights cards on dashboard (already has loading state but could be unified to `.gh-skeleton`)
- Thai date picker (พ.ศ./ค.ศ.) for tax forms + lease forms — biggest remaining feature gap
- Migrate `--primary-green` to direct `--brand-primary` references (cleanup; currently aliased one level deep — no functional issue)
- Add "quiet hours" feature for haptic (auto-suppress 22:00-07:00)
- Onboarding tours for dashboard admin + tax-filing (separate keys, separate content)
- Replace remaining 1 alert() in dashboard-extra.js:5295 (deeper nesting — left intentionally)

---

# Bill Format Customization — Tenant chooses recipient entity (personal/company)

## Goal (user approved 2026-05-04)
ลูกบ้านเลือก format บิลของตัวเอง: บุคคลธรรมดา (default, brand-friendly) หรือ นิติบุคคล (สำหรับเบิกบริษัท). Bill rendering swaps **logo + recipient block** ตาม `tenant.billRecipient.entityType` — single trigger, no separate switch.

## Architecture
- **Issuer** (Owner Info): admin อัพ 2 logos — `logoDataUrl` (โลโก้บริษัท, B2B) + `apartmentLogoDataUrl` (โลโก้อพาร์ทเม้น, B2C default)
- **Recipient** (per tenant): Firestore `tenants/{building}/list/{roomId}.billRecipient = { entityType, companyName?, taxId?, address? }`
- **Render**: state-driven, no explicit trigger. Bill code อ่าน billRecipient → switch logo + recipient block
- **Snapshot**: skip ใน MVP — render live จาก tenant.billRecipient. v2 ค่อยเพิ่ม snapshot เวลา verifySlip
- **Tax ID**: validate 13-digit + checksum, warning only (ไม่บล็อก save)
- **Header**: "ใบเสร็จรับเงิน / Receipt" ทั้งสอง entityType (issuer ยังไม่ VAT — ออกใบกำกับภาษีไม่ได้)

## Phase 1 — Owner Info (admin uploads dual logo) ✅
- [x] `shared/owner-config.js`: เพิ่ม `apartmentLogoDataUrl: ''` ใน DEFAULT_OWNER_CONFIG
- [x] `shared/dashboard-extra.js`: update label โลโก้บริษัท → "โลโก้บริษัท (ใช้บนบิลนิติบุคคล + รายงานภาษี)"
- [x] `shared/dashboard-extra.js`: เพิ่ม UI block ใหม่ "โลโก้อพาร์ทเม้น (ใช้บนบิลบุคคลธรรมดา — default)" ใต้โลโก้บริษัท
- [x] เพิ่ม `_writeApartmentLogo`, `uploadApartmentLogo`, `removeApartmentLogo` (mirror existing pattern)

## Phase 2 — Tenant Profile (recipient form) ✅ ALREADY EXISTS
**Discovery 2026-05-04:** Feature นี้ถูกสร้างไว้แล้วใน tenant_app.html ตั้งแต่ก่อน — ไม่ต้องสร้างใหม่:
- [x] HTML section "ตั้งค่าการออกใบเสร็จ" — line 3261-3287 (dropdown + company info form + save button + confirm message)
- [x] JS `loadReceiptSettings()` — line 4666 (read from `_taTenant.receiptType` + `_taTenant.companyInfo`)
- [x] JS `saveCompanyInfo()` — line 4689 (Tax ID validate 13 digit, write Firestore via TenantFirebaseSync)
- [x] JS `onReceiptTypeChange()` — line 4743 (handle dropdown switch, persist localStorage + Firestore)
- [x] JS `applyReceiptUI(type, co)` — line 4761 (show/hide company info block)
- [x] JS `window.getReceiptMetaForBill()` — line 4776 (public API for bill rendering — was orphaned!)
- [x] Bill detail block — line 2659 `receipt-company-info-block` shows recipient on tenant_app receipt

**Schema in use:** `tenants/{building}/list/{roomId}.receiptType` ('personal'|'company') + `.companyInfo = { name, taxId, address }`. Firestore rule already allows tenant update (rule line 179 excludes only protected fields, receiptType+companyInfo fine ✓)

## Phase 3 — Bill rendering switch ✅
- [x] `shared/dashboard-bill.js` `buildDocHTML`: lookup `TenantConfigManager.getTenant(d.building, d.room).receiptType` + `companyInfo` → choose logo (apartmentLogo for personal, companyLogo for company) + recipient block at top of doc-content
- [x] `shared/invoice-pdf-generator.js` `generateInvoicePDF`: read `invoiceData.recipient`, switch header emoji+name + add recipient block (จุดอยู่หลัง "Room & Invoice Details")
- [x] `shared/invoice-pdf-generator.js` `generateReceiptPDF`: เหมือนกัน (header swap + recipient block หลัง verification info)
- [x] `shared/dashboard-extra.js` caller: เพิ่ม helper `_resolveBillRecipient(building, roomId)` + enrich invoice ก่อน pass เข้า PDF generator

## Phase 4 — Firestore rules + verification ✅
- [x] Firestore rules: ตรวจแล้ว ไม่ต้องแก้ — `receiptType` + `companyInfo` ไม่ได้อยู่ใน excluded keys
- [x] `npm run verify:memory` → ALL GREEN (212 rows, 0 fails)
- [x] Syntax check 4 modified files (`node -c`) → ALL OK
- [ ] Live test: tenant_app → Profile/Settings → ตั้งนิติบุคคล → save → admin doc preview → ดู logo+recipient ตรงกัน
- [ ] Update lessons.md ถ้ามี gotcha (จะเพิ่มหลัง live test)

## Scope deferred to v2
- **Tenant_app brand header logo swap** — line 2533-2538 (STEP 1) + 2624-2628 (STEP 3) ยังเป็น hardcoded "🌿 The Green Haven". รอดู v1 จริงก่อนค่อยตัดสินใจว่าควร swap ตาม receiptType หรือไม่. recipient-info-block (line 2659) แสดงข้อมูลถูกอยู่แล้ว
- **Snapshot recipient on paid bill** — ตอนนี้ render live จาก tenant.companyInfo. ถ้าลูกบ้านแก้ทีหลัง บิลเก่าโชว์ของใหม่. v2 ค่อย snapshot ใน verifySlip CF

---

# Owner Info — Save bug + Bills respect "อยู่ระหว่างจดทะเบียน" status

## Symptom (user report 2026-05-04)
- Owner Info form ใน people management → set "สถานะการจดทะเบียน = อยู่ระหว่างจดทะเบียน" → กดบันทึก → toast ไม่ขึ้น
- บิล/ใบเสร็จที่ออกให้ลูกบ้านยังขึ้น "บริษัท เดอะ กรีนเฮฟเว่น จำกัด" เต็ม ๆ ไม่บอกว่าอยู่ระหว่างจดทะเบียน

## Root cause
1. **Save broken:** [shared/dashboard-extra.js:1517-1519](shared/dashboard-extra.js:1517) อ่านจาก 3 element ที่ `renderOwnerInfoPage()` ไม่ได้ render — `getElementById` คืน null → `.value` โยน TypeError → save อบอร์ตเงียบ
2. **Bill ignores status:** [invoice-pdf-generator.js:25,196](shared/invoice-pdf-generator.js:25) + [dashboard-bill.js:954](shared/dashboard-bill.js:954) ดึง `companyLegalNameTH` ตรง ๆ ไม่เช็ค `registrationStatus` (ต่างจาก [tax-filing.html:1401](tax-filing.html:1401) ที่เช็คแล้ว)

## Plan (user approved option ก — append " (อยู่ระหว่างจดทะเบียน)")
- [x] Fix save: ใช้ optional chaining ใน 3 บรรทัด (pattern เดียวกับ company identity ด้านบน)
- [x] Append suffix when `registrationStatus === 'pending'` ที่ 3 ฝั่ง:
  - [x] `shared/invoice-pdf-generator.js:25` (invoice PDF header)
  - [x] `shared/invoice-pdf-generator.js:196` (receipt PDF header)
  - [x] `shared/dashboard-bill.js:954` (admin doc preview / PNG export)
- [x] **Leave alone:** `dashboard-bill.js:638` (admin PromptPay payee reference) — financial transfer destination, suffix ไม่เหมาะ

## Review (2026-05-04)
**Shipped:** 4 mechanical edits across 3 files. `npm run verify:memory` ALL GREEN (212 rows, 0 fails). No Tailwind/build needed.

**What changed:**
- `shared/dashboard-extra.js:1517-1519` — defensive optional chaining (3 บรรทัด) → save function ทนต่อ DOM ที่ไม่ render แล้ว
- `shared/invoice-pdf-generator.js:25, 196` — invoice + receipt PDF header เช็ค registrationStatus
- `shared/dashboard-bill.js:954` — admin doc preview (logo subtitle) ที่ใช้ html2canvas → PNG export ก็ติด suffix ด้วย

**Live verification (after `git push origin main`):**
1. https://the-green-haven.vercel.app/dashboard.html → People Management → Owner Info
2. Set "สถานะการจดทะเบียน = ⏳ อยู่ระหว่างจดทะเบียน" → กด 💾 บันทึกข้อมูล
3. ✅ Toast "บันทึกข้อมูลเจ้าของสำเร็จ" ขึ้น
4. F12 → `localStorage.getItem('owner_info')` → JSON parse → `registrationStatus: 'pending'` ติด
5. Bills tab → preview ใบเสร็จ/ใบวางบิล → header แสดง "บริษัท เดอะ กรีนเฮฟเว่น จำกัด (อยู่ระหว่างจดทะเบียน)"
6. Export PNG → ตรวจว่า suffix ติดด้วย
7. หลังจดเสร็จ: เปลี่ยน status เป็น "✅ จดทะเบียนแล้ว" → suffix หายอัตโนมัติ

**Follow-up (none required):** PromptPay payee แสดง (`pp-display-payee` ใน admin) ไม่ได้แตะ — เป็น financial transfer reference, suffix ไม่เหมาะ

## Why option ก
Consistent with tax-filing.html pattern (ใช้แล้ว) → ลูกบ้านเห็นชัดว่ายังจดทะเบียนไม่เสร็จ → โปร่งใส, ตรงกับเอกสารภาษีที่ admin ใช้

## Verification
- Build: ไม่มีการเปลี่ยน Tailwind class → ไม่ต้อง `npm run tailwind:build`
- Memory: ไม่กระทบ load-bearing claims → ไม่ต้อง `npm run verify:memory`
- Live: push → vercel → admin หน้า Owner Info → set pending → save → ดู toast → ตรวจ localStorage `owner_info` → render บิลใหม่ใน Bills tab

---

# LIFF Booking Site — Real-time Availability + Auto-Verified Deposit + Bookings SoT

## Goal

ระบบจองห้องผ่าน LINE LIFF ที่ end-to-end เริ่มจากเลือกห้องบนปฏิทิน → ล็อคห้อง → จ่ายมัดจำผ่าน PromptPay QR → auto-verify slip → ออกใบรับเงินชั่วคราว → (ภายหลัง) แปลงเป็นสัญญา/Tenant จริง

3 เสาหลักจาก brief:
1. **Real-time Availability (Calendar View)** — สถานะสีเทาอัตโนมัติ + filter ประเภท/ชั้น + lock 15-30 นาที กัน race condition
2. **Payment Integration** — Instant invoice + PromptPay QR + auto-verify slip → "Booked" state ไม่ต้องรอแอดมิน
3. **Database Structure** — Bookings collection แยกจาก Contracts; flow โอนข้อมูลเมื่อทำสัญญาจริง

ของเสริม (Phase 5+, ทำหลัง MVP เสร็จ): Pre-Check-in KYC, Gamification Early Bird

---

## ⚠️ Design decisions — ขอ confirm ก่อนลงโค้ด

ทุกข้อมี **default ที่แนะนำ** + **เหตุผล**. ตอบ "OK" / "เปลี่ยนเป็น X" ก่อนเริ่ม Phase 1

| # | Decision | Recommended default | Why |
|---|----------|---------------------|-----|
| 1 | LIFF channel ID | **ใช้ตัวเดิม `2009790149-Db7T76sd` + route-based start URL** (`https://the-green-haven.vercel.app/booking.html`) | ประหยัดต้นทุน LINE channel, ไม่ต้องตั้งค่า LIFF ใหม่; การแยก endpoint URL พอแล้ว |
| 2 | New page or section in tenant_app.html | **Standalone `booking.html`** (วาง `/booking.html`) | tenant_app.html ใหญ่มาก (25 pages), prospects ไม่ควรเห็น tenant flows; แยกชัด, bundle เบา |
| 3 | Auth strategy สำหรับ prospect | **New CF `liffBookingSignIn`** mint custom token with `claims: { role: 'prospect', lineUserId }` (ไม่มี room/building) | กันใช้ anonymous (เพิ่ม security risk + memory rule §⛔ NEVER tighten rules); ใช้ pattern เดียวกับ liffSignIn.js |
| 4 | Source of "available" rooms | **`shared/room-config.js` ลบด้วย active rooms ใน `tenants/{b}/list/*` ลบด้วย active bookings** | ไม่ต้อง schema migration, room-config มีอยู่แล้ว, ทุก source ตรงกับโค้ดเดิม |
| 5 | Lock duration | **20 นาที** (กึ่งกลาง 15-30) | นานพอเปิด LINE Pay app, สั้นพอไม่ block ห้องนาน |
| 6 | Deposit amount source | **`room-config.deposit` ถ้ามี (Nest); Rooms ใช้ค่า default 1 เดือนเช่า**; admin override ได้ใน booking doc | room-config.js มีอยู่แล้ว, ลด UX ตั้งค่าซ้ำ |
| 7 | PromptPay receiver | **`OwnerConfigManager.getOwnerInfo().phone`** (เจ้าของบัญชีคนเดิมกับบิลรายเดือน) | source of truth เดียว, ไม่มี config เพิ่ม |
| 8 | verifySlip reuse | **New CF `verifyBookingSlip`** (clone โครง verifySlip.js) | verifySlip ปัจจุบัน hard-code path bills/* + Nest gamification; clone สะอาดกว่าใส่ branch |
| 9 | Pre-Check-in KYC | **หลังจ่ายเงินยืนยันแล้ว, optional** (ลูกบ้านอัปได้, แต่ admin อนุมัติ KYC แยก) | กันการล้มเลิกระหว่างกรอกฟอร์ม, prospect ใส่เอกสารที ผ่อนคลายกว่า |
| 10 | Early Bird threshold | **จองล่วงหน้า ≥ 30 วันก่อน move-in → 500 pts**, เก็บใน booking doc, transfer ไปยัง gamification เมื่อ contract สร้าง | brief เสนอ 500, สอดคล้องกับ gamification economy (10pts=1฿) → 50บ ส่วนลด, ไม่ over |
| 11 | Admin UI location | **เพิ่ม Booking sub-tab ใน dashboard.html → Tenant section** | dashboard เป็น admin SPA หลัก, เปิดแล้ว, อยู่ใกล้ Contract management |
| 12 | Booking → Contract conversion | **Manual: admin กดปุ่ม "Convert to Tenant"** ใน Booking sub-tab → mint `tenants/{b}/list/{roomId}` doc + ลิงก์ tenantId | ปลอดภัยกว่า auto, admin ต้องดู KYC ก่อน |
| 13 | Existing vs new tenant | **เก็บ `lineUserId` บน booking; เมื่อ admin convert, ค้นใน tenants/* ว่าเคยมี linkedAuthUid ตรงกับ `line:{userId}` ไหม** → ถ้ามีใช้ tenantId เดิม, ไม่งั้นสร้างใหม่ | ใช้ pattern linkedAuthUid ที่มีอยู่ |
| 14 | Cancellation policy | **ก่อนชำระ → ยกเลิกฟรี (auto-expire 20 นาที); หลังชำระ → admin manual refund** | กันโค้ดยุ่งกับ refund automation; brief ไม่ระบุ |

---

## Phase 0 — Pre-flight grep verification (do this myself before coding)

ก่อนตอบ Decision questions ข้างบน user อยากให้เช็คก่อน — เลยไม่ใช่ user task

- [ ] Verify `OwnerConfigManager.getOwnerInfo()` schema (มี `.phone` ไหม) — `shared/owner-config.js`
- [ ] Verify `tenants/{building}/list/{roomId}.linkedAuthUid` field มีจริง + format `line:{lineUserId}` — `lifecycle_auth_liff_sot.md` กับ `firestore_schema_canonical.md`
- [ ] Confirm `room-config.js` ครบทุกห้อง + มี deposit เฉพาะ Nest (ตามที่ inventory บอก)
- [ ] เช็คว่า dashboard.html "Tenant section" มี sub-tab structure ไหม → หา insertion point
- [ ] Confirm gamification rules engine รับ event `booking_early_bird` ได้ (หรือต้องเพิ่ม rule)

**Why:** memory rule "Verify-via-grep doctrine" — ทุก claim ต้องมี grep proof ก่อนใช้ในโค้ด

---

## Phase 1 — Bookings Schema + Firestore Rules + CF skeleton

### Files
- `firestore.rules` — เพิ่ม `bookings/{bookingId}` rule block
- `firestore.rules.test.js` — เพิ่ม test cases
- `functions/index.js` — export new CFs
- `functions/liffBookingSignIn.js` — NEW (clone liffSignIn pattern, no room claim)
- `functions/createBookingLock.js` — NEW (HTTPS callable; transaction-based lock)
- `functions/expireBookingLocks.js` — NEW (scheduled CF, every 5 min, mark expired)

### Bookings collection schema (top-level, NOT under tenants/)

```
bookings/{bookingId}
  prospectUid: string         // line:lineUserId (from custom claim)
  prospectLineId: string      // for admin reference
  prospectName: string        // from liff.getProfile()
  prospectPhone: string       // user-entered
  building: 'rooms' | 'nest'
  roomId: string              // matches room-config.js id
  startDate: timestamp        // move-in date
  durationMonths: number      // 6 | 12 | etc.
  monthlyRent: number         // copied from room-config at lock time
  depositAmount: number       // copied from room-config OR 1 month rent
  earlyBirdEligible: boolean  // computed: (startDate - createdAt) >= 30 days
  earlyBirdPoints: number     // 0 or 500
  status: 'locked' | 'paid' | 'kyc_pending' | 'kyc_approved' | 'converted' | 'cancelled' | 'expired'
  lockedUntil: timestamp      // status=locked → +20min from createdAt
  promptPayPayload: string    // generated server-side
  qrAmount: number            // = depositAmount
  slipVerifiedAt: timestamp?
  slipTransactionRef: string?
  slipImagePath: string?      // Storage path
  kycDocsPath: string?        // Storage path prefix
  contractId: string?         // filled on convert
  tenantId: string?           // filled on convert (linked or new)
  createdAt: serverTimestamp
  updatedAt: serverTimestamp
```

### Rules

```javascript
// bookings/{bookingId}
match /bookings/{bookingId} {
  // Prospect can read own; admin can read all
  allow read: if isAdmin() ||
              (isSignedIn() && resource.data.prospectUid == request.auth.uid);
  // CF-only writes (createBookingLock + verifyBookingSlip + scheduled expire + admin convert)
  allow write: if isAdmin();
}
```

**Why CF-only write:** สำคัญสำหรับ race-condition prevention (lock ต้องเป็น atomic Firestore transaction). ถ้าเปิด client write จะมีคนสร้าง lock ซ้อน

### `liffBookingSignIn` CF — pattern

- Region SE1, `https.onRequest`
- Body: `{ idToken }` (LIFF ID token จาก `liff.getAccessToken()` หรือ `liff.getIDToken()`)
- Verify ผ่าน LINE `/verify` endpoint (เหมือน liffSignIn.js:32+)
- Mint custom token: `admin.auth().createCustomToken('line:'+lineUserId, { role: 'prospect', lineUserId })`
- Return `{ customToken }` → client ใช้ `signInWithCustomToken`

### `createBookingLock` CF — atomic lock

- `https.onCall`, must have `auth.token.role === 'prospect'`
- Body: `{ building, roomId, startDate, durationMonths, prospectName, prospectPhone }`
- **Transaction:**
  1. Read all bookings WHERE `building == X AND roomId == Y AND status IN ('locked','paid','kyc_pending','kyc_approved') AND lockedUntil > now`
  2. ถ้าเจอ → throw `failed-precondition: room-already-locked`
  3. Read `tenants/{building}/list/{roomId}` — ถ้ามี active tenant + endDate > startDate → throw `failed-precondition: room-occupied`
  4. Compute `depositAmount` (room-config.deposit OR monthlyRent * 1)
  5. Generate PromptPay payload server-side (port `buildPromptPayPayload` จาก tenant_app.html:9533 → `functions/promptpay.js`)
  6. `transaction.create(bookings/{auto})` with status='locked', lockedUntil=now+20min
- Return `{ bookingId, qrPayload, qrAmount, lockedUntil }`

### `expireBookingLocks` CF — scheduled

- `pubsub.schedule('every 5 minutes')`, region SE1, BKK timezone
- Query `bookings WHERE status='locked' AND lockedUntil < now`
- Batch update status='expired' (max 500/run)

### Tasks
- [ ] Phase 0 grep checks complete
- [ ] Add `bookings/*` rule block + test
- [ ] Implement `liffBookingSignIn` CF + unit smoke test
- [ ] Implement `createBookingLock` CF (transaction-based)
- [ ] Implement `expireBookingLocks` CF
- [ ] Extract `buildPromptPayPayload` to `functions/promptpay.js` (server-side mirror)
- [ ] Wire all into `functions/index.js`
- [ ] `npm run test:rules` ผ่าน
- [ ] Deploy: `firebase deploy --only functions:liffBookingSignIn,functions:createBookingLock,functions:expireBookingLocks,firestore:rules`
- [ ] Manual test: lock → wait 20min → confirm auto-expire

**Verification (memory doctrine):** end of phase, write `lifecycle_booking_flow.md` with `## Verification` section grep-backing every claim (collection path, rule line, CF region, lock duration, etc.)

---

## Phase 2 — Slip Verify CF + KYC Storage rules

### Files
- `functions/verifyBookingSlip.js` — NEW (clone verifySlip.js, write to bookings/*)
- `storage.rules` — add `/bookings/{bookingId}/slips/*` + `/bookings/{bookingId}/kyc/*` paths

### `verifyBookingSlip` CF
- Clone `functions/verifySlip.js` minus tenant-specific gamification + bills RTDB write
- Input: `{ bookingId, file (base64), expectedAmount }` + auth.uid must match booking.prospectUid
- Validates: file size, dimension, SlipOK API call, amount match (hard reject if mismatch), atomic dedup via `verifiedSlips/{transRef}.create()` (gRPC-6 pattern from existing CF)
- On success:
  - Upload slip image to Storage `bookings/{bookingId}/slips/{transRef}.jpg`
  - Update `bookings/{bookingId}` → status='paid', slipVerifiedAt, slipTransactionRef, slipImagePath
- Return `{ success, status: 'paid' }` หรือ `{ retryable: true, code: 'scb_delay' }` (เหมือน verifySlip)
- Rate limit: 50/day per `prospectUid` (port logic จาก verifySlip)

### Storage rules
```
match /bookings/{bookingId}/slips/{file} {
  allow read: if isAdmin() ||
              (isSignedIn() && firestore.exists(/databases/(default)/documents/bookings/$(bookingId)) &&
               firestore.get(/databases/(default)/documents/bookings/$(bookingId)).data.prospectUid == request.auth.uid);
  allow write: if false;  // CF-only
}
match /bookings/{bookingId}/kyc/{file} {
  allow read: if isAdmin() || /* same prospectUid check */ ;
  allow write: if isSignedIn() && /* same check */ &&
               request.resource.size < 5 * 1024 * 1024 &&
               request.resource.contentType.matches('image/.*');
}
```

### Tasks
- [ ] Implement `verifyBookingSlip` CF
- [ ] Add storage rules + test (smoke)
- [ ] Deploy: `firebase deploy --only functions:verifyBookingSlip,storage`
- [ ] Manual test: lock → upload real slip → status flips to paid

---

## Phase 3 — `booking.html` LIFF page (MVP UI)

### File: `booking.html` (new, ~600 lines target)

Sections (single-page, stepwise reveal):

1. **Loading / LIFF init** — `liff.init` → `liff.isLoggedIn()` → `liffBookingSignIn` CF → `signInWithCustomToken`
2. **Calendar / Room Picker** (main view)
   - Building tabs: Rooms / Nest (uses room-config.js)
   - Filter row: Floor (Nest only), Type (studio/pet-allowed for Nest), Max Rent slider
   - Month navigation (←/→ + month label)
   - Grid: รายชื่อห้องในแถวซ้าย, วันในเดือนเป็นคอลัมน์ → ช่องสีเขียว=ว่าง, เทา=มีคนอยู่/จองแล้ว, เหลือง=ของฉันที่ล็อคไว้
   - Click ช่อง → modal step 3
3. **Booking detail modal**
   - Show: ห้อง, วัน move-in, ระยะสัญญา (dropdown: 6/12/24 เดือน), monthly rent, deposit
   - Form: ชื่อ-นามสกุล, เบอร์โทร (10 หลัก validation)
   - "Lock & Pay" button → call `createBookingLock` CF → show step 4
4. **Payment step**
   - QR code render (qrcodejs จาก CDN — เหมือน tenant_app.html:9269)
   - Amount + countdown timer (20 min)
   - Slip upload (file input → base64) → `verifyBookingSlip` CF
   - Polling/listener: `onSnapshot(bookings/{id})` → status='paid' → step 5
5. **Confirmation step** — ใบรับเงินชั่วคราว, "อัปโหลด KYC ตอนนี้" button (Phase 5)

### Data fetching strategy

- Cache room-config.js (already client-bundled)
- onSnapshot ของ `bookings WHERE building == X AND status IN ('locked','paid','kyc_pending','kyc_approved') AND lockedUntil > now` → ใช้คำนวณช่องเทา
- onSnapshot ของ `tenants/{b}/list/*` ดูช่อง active tenant
- Avoid loading 1000s of docs — limit query to current month +/- 3 months

### Tailwind classes
- ใช้ tailwind v3 ตามเดิม (per CLAUDE.md), build ผ่าน `npm run tailwind:build`
- ใช้ `shared/brand.css` tokens (Muji minimal — `var(--color-text)`, etc.)

### Service Worker
- Add `booking.html` to SW cache list (auto via `VERCEL_GIT_COMMIT_SHA`)

### Tasks
- [ ] Build `booking.html` skeleton + LIFF init + auth wiring
- [ ] Build calendar grid component (vanilla)
- [ ] Build filter row
- [ ] Build booking modal + form validation
- [ ] Build payment step + QR render + slip upload
- [ ] Build confirmation step
- [ ] Add to SW cache
- [ ] Run `npm run tailwind:build`
- [ ] Push → verify on Vercel (NOT localhost — per ⛔ rule)
- [ ] Test E2E with real LINE account: book → pay → confirm

---

## Phase 4 — Admin Booking sub-tab in dashboard.html

### Files
- `dashboard.html` — add "Booking" sub-tab inside Tenant section
- `shared/dashboard-bookings.js` — NEW (~300 lines, follow dashboard-extra.js pattern)
- `functions/convertBookingToTenant.js` — NEW (HTTPS callable, admin only)

### `convertBookingToTenant` CF
- `auth.token.role === 'admin'` (custom claim)
- Body: `{ bookingId }`
- Transaction:
  1. Read booking → must status='kyc_approved' (or status='paid' if KYC skipped)
  2. Lookup existing tenant by `linkedAuthUid == 'line:'+booking.prospectLineId` in `tenants/{building}/list/*` → tenantId เดิม OR mint new
  3. Create `tenants/{building}/list/{roomId}` doc with: tenantId, contractStart=startDate, contractMonths, monthlyRent, deposit (paid), linkedAuthUid
  4. Update booking → status='converted', contractId, tenantId
  5. Award `earlyBirdPoints` to gamification (+500 if eligible)

### Admin UI
- Table: pending bookings (status IN ['paid','kyc_pending','kyc_approved'])
- Per-row: view details, view slip image, view KYC docs, Approve KYC button, Convert button
- Filter by status, date range
- Search by phone/name

### Tasks
- [ ] Implement `convertBookingToTenant` CF
- [ ] Build dashboard sub-tab UI
- [ ] Build `dashboard-bookings.js` module
- [ ] Add to dashboard.html script load order
- [ ] Manual test: admin → approve KYC → convert → verify tenant doc created + gamification points awarded

---

## Phase 5 — Pre-Check-in KYC (after MVP)

- KYC upload UI inside booking.html confirmation step
- Doc types: ID card (front+back), house registration (optional), employment letter (optional)
- Storage path: `bookings/{bookingId}/kyc/{type}_{timestamp}.jpg`
- After upload: status='kyc_pending' → admin reviews → status='kyc_approved'

---

## Phase 6 — Gamification Early Bird (after MVP)

- เก็บ `earlyBirdPoints` ใน booking doc แล้ว (Phase 1)
- Award trigger: ใน `convertBookingToTenant` CF — ถ้า earlyBirdEligible → award via gamification rules engine (`shared/gamification-rules.js`) event `booking_early_bird`
- ต้องเพิ่ม rule ใน rules engine: 500 pts, max 1/booking
- Verify หลัง launch ใน `gamification_ssot.md`

---

## Out of scope (explicit — do NOT do)

- ❌ Auto-cancellation refund flow (manual admin process, brief ไม่ระบุ)
- ❌ Multi-room booking ในครั้งเดียว (1 booking = 1 room)
- ❌ Walk-in booking (LIFF only, dashboard admin manual createBookingLock เป็น escape hatch)
- ❌ External payment gateway (PromptPay only, ตรงกับสิ่งที่มีอยู่)
- ❌ Internationalization (Thai only)
- ❌ React/Vue/TS — stays vanilla JS per CLAUDE.md tech-stack guardrail

---

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Race condition: 2 prospects lock พร้อมกัน | Firestore transaction in `createBookingLock` CF (atomic check-then-create) |
| LIFF ID token expiry mid-booking | Refresh token before each CF call; show retry UI |
| Slip auto-verify false positive (mismatch amount) | verifyBookingSlip hard-rejects mismatch (port from verifySlip pattern) |
| Lock blocks ห้องนาน + lock CF crash | `expireBookingLocks` scheduled every 5 min as safety net + Firestore TTL ทบ |
| New CF region ผิด (SE3 ผิด, ต้อง SE1) | All booking CFs `region('asia-southeast1')` เหมือนของเดิม |
| `booking.html` bundle ใหญ่เกิน 150kb | Lazy-load qrcodejs (CDN, current pattern); no extra libs |
| Existing tenant double-booked เป็น prospect | `convertBookingToTenant` CF tries lookup linkedAuthUid first → reuses tenantId |

---

## Memory updates after ship

- New lifecycle doc: `lifecycle_booking_flow.md` with full `## Verification` section
- Update `MEMORY.md` index — add to "🏛️ System Lifecycles → Tenant-facing"
- Update `tasks/lessons.md` after every correction during dev
- Update `firestore_schema_canonical.md` — new `bookings/*` collection
- Update CSP if booking.html needs new domains (LINE Pay maybe — check during Phase 3)

---

## Phasing recommendation

**Sprint 1 (MVP, ~3-5 sessions):** Phases 0-3 → standalone booking site live, no admin UI yet (admin uses Firestore console temporarily)

**Sprint 2 (~1-2 sessions):** Phase 4 → admin UI, conversion flow

**Sprint 3 (optional):** Phases 5+6 → KYC + gamification

**Recommend ship Sprint 1 first**, validate with 1-2 real prospects, then Sprint 2.

---

## Review — Phase 1 shipped 2026-05-04

### Files added (5 new CFs)
- [functions/promptpay.js](functions/promptpay.js) — server-side mirror of `tenant_app.html:9533` `buildPromptPayPayload`. Same EMV tags + CRC16-CCITT polynomial as client. With input validation.
- [functions/liffBookingSignIn.js](functions/liffBookingSignIn.js) — exchanges LIFF ID token for Firebase custom token. UID prefix `book:` + claim `role:'prospect'`. **Why separate from `liffSignIn`:** prospects don't have a `liffUsers/{lineUserId}` doc; tenants do. Different namespace prevents claim collision when same LINE account uses both apps.
- [functions/createBookingLock.js](functions/createBookingLock.js) — HTTPS callable, atomic Firestore transaction. Reads room rate from `rooms_config/{building}/{roomId}` (RTDB), receiver phone from `owner_info/main` (Firestore). Locks for 20 minutes. Computes Early Bird eligibility (≥30 days = 500 pts).
- [functions/getRoomAvailability.js](functions/getRoomAvailability.js) — HTTPS callable, returns `{occupied: [roomIds], activeBookings: [{roomId,status,lockedUntil}]}` for the calendar UI. **Why this CF exists:** prospects can't read `tenants/{b}/list/*` directly (rules block cross-room PII reads). Admin SDK aggregates server-side, returning only non-PII fields.
- [functions/expireBookingLocks.js](functions/expireBookingLocks.js) — scheduled every 5 minutes, BKK timezone. Flips abandoned `status='locked'` rows to `status='expired'`. Worst-case lock duration ~25min (20 lock + 5 sweep gap).

### Files modified (3)
- [firestore.rules](firestore.rules) — added `bookings/{bookingId}` block. CF-only writes (admin SDK bypasses); read = own + admin.
- [firestore.rules.test.js](firestore.rules.test.js) — added `PROSPECT()` auth helper + 12-test booking suite. **All 12 pass.**
- [functions/index.js](functions/index.js) — wired 4 new CFs (one is a pure helper).

### Test results
- `firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'`
- **97/98 pass** — the 1 failure (`anon tenant can create claim doc` in wellnessClaimed suite) is **pre-existing** (rule requires parent tenant doc with `linkedAuthUid` to exist, test seeds the claim without seeding the parent). NOT touched by this work. Flagged for follow-up.
- All 5 CF files pass `node --check`.

### Deferred (to next sessions, by design)
- **Deploy** — held until user OK. Command:
  ```
  firebase deploy --only functions:liffBookingSignIn,functions:createBookingLock,functions:getRoomAvailability,functions:expireBookingLocks,firestore:rules
  ```
- **Memory doc** — `lifecycle_booking_flow.md` with `## Verification` section (per CLAUDE.md verify-via-grep doctrine). Will write at end of Sprint 1 (or after Phase 2 ships) so it can describe the full lock → pay → verify flow at once.
- **Phase 2** — `verifyBookingSlip` CF + Storage rules for slip/KYC paths.
- **Phase 3** — `booking.html` LIFF page (the part that's actually browser-observable).

### Verification commands for next session
```bash
# Rules tests still green:
export JAVA_HOME="/c/Users/usEr/jdk21/jdk-21.0.5+11-jre" && export PATH="$JAVA_HOME/bin:$PATH"
firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'

# All booking CFs syntax-clean:
for f in functions/promptpay.js functions/liffBookingSignIn.js functions/createBookingLock.js functions/getRoomAvailability.js functions/expireBookingLocks.js; do node --check "$f" && echo "✓ $f"; done
```

### Lessons for `tasks/lessons.md` (none yet)
No corrections from user, no production bugs hit. Phase 1 went per plan.

### Notes / drift from original plan
- Added a 5th CF (`getRoomAvailability`) that wasn't in the original plan — discovered during rule design that prospects can't read `tenants/*` directly (PII gate). This CF is the privacy-safe aggregator. Documented in plan above.
- Lock duration confirmed at 20 minutes (decision #5 from "Design decisions" table).
- UID prefix `book:` (not `line:`) confirmed prevents claim collision with tenant flow.

---

## Review — Phase 2 shipped 2026-05-04

### Files added (1 new CF)
- [functions/verifyBookingSlip.js](functions/verifyBookingSlip.js) — SlipOK-backed deposit verification. **Clones** the SlipOK API call + atomic dedup pattern from `verifySlip.js` but:
  - Uses `https.onCall` (auth via `context.auth`) instead of `onRequest+requireAdmin` — matches `createBookingLock` pattern
  - Drops bill-marking RTDB write (booking is not a bill)
  - Drops Nest gamification + `paymentHistory` writes (those are tenant-flow concerns)
  - Adds Storage upload at `bookings/{bookingId}/slips/{txid}.jpg` (verifySlip skips this; bookings need image trail for admin disputes)
  - Reuses `verifiedSlips/{txid}.create()` atomic dedup (gRPC code 6) — same SlipOK quota, same race fence
  - Per-prospect rate limit (10/day) via separate `rateLimits/booking_{uid}_{window}` keyspace — no collision with tenant rate limits

### Files modified (2)
- [storage.rules](storage.rules) — added `bookings/{bookingId}/slips/*` (read-only for admin/owner; CF-only writes) and `bookings/{bookingId}/kyc/*` (admin OR owner with status=='paid'|'kyc_pending', 5MB cap, image+PDF only). 31 lines added.
- [functions/index.js](functions/index.js) — wired `verifyBookingSlip` export.

### Verification
- `node --check functions/verifyBookingSlip.js` ✓
- `git diff --stat` confirms scope: 53 lines across 2 modified files + 1 new CF (no unintended changes)
- Rule tests still green from Phase 1 (no firestore.rules changes in Phase 2)
- **Storage rule tests skipped** — project has no Storage emulator test infra; existing storage rules also untested. Real validation will happen at deploy + browser flow in Phase 3.

### Behavioral choices to flag
- **Hard reject on amount mismatch** — same as `verifySlip` (data poisoning prevention). A ฿1 slip against ฿3000 deposit fails fast.
- **SCB delay returns retryable shape** — `{ success: false, retryable: true, code: 'scb_delay', retryAfterSec: 120 }`. Client should wait 2 min and retry, not show error. Same shape as `verifySlip`.
- **Atomic `verifiedSlips/{txid}.create()` shared with rent flow** — a slip already used to pay rent CANNOT be re-submitted as a booking deposit, and vice versa. Cross-flow replay is blocked by Firestore doc-id uniqueness.
- **Storage upload is non-fatal** — if Storage upload fails, the booking still flips to `paid` (slip is verified by SlipOK + recorded in `verifiedSlips`). Logged for admin to recover. Phase 4 admin UI can re-fetch image from `verifiedSlips` collection if needed.
- **Bookings status update post-slip is logged loudly on failure** — slip is verified but booking didn't flip. Admin must intervene. Acceptable: this is rare (Firestore single-doc update is reliable).

### Sprint 1 backend complete

Phase 1 + Phase 2 ship together:
- 6 new CFs total: `liffBookingSignIn`, `createBookingLock`, `getRoomAvailability`, `expireBookingLocks`, `verifyBookingSlip`, plus `promptpay.js` helper
- 1 new Firestore rule block (`bookings/*`)
- 2 new Storage rule blocks (`bookings/{}/slips/*`, `bookings/{}/kyc/*`)
- 12 rule tests pass (97/98 total — 1 pre-existing wellnessClaimed failure unrelated)

**Deploy command** (when user OKs):
```bash
firebase deploy --only \
  functions:liffBookingSignIn,\
functions:createBookingLock,\
functions:getRoomAvailability,\
functions:expireBookingLocks,\
functions:verifyBookingSlip,\
firestore:rules,\
storage
```

Pre-deploy checklist:
- [ ] `SLIPOK_API_KEY` secret set (already exists from rent flow — no action)
- [ ] `SLIPOK_API_URL` defineString set in `functions/.env` (already exists — no action)
- [ ] `owner_info/main.phone` populated in Firestore (admin must set via dashboard before first booking)
- [ ] `rooms_config/{building}/{roomId}` populated in RTDB (already auto-synced from `room-config.js`)

**Phase 3 next** — `booking.html` LIFF page (preview-verifiable) + admin will be able to test end-to-end.

---

## Review — Phase 3 shipped 2026-05-04

### Files added (1)
- [booking.html](booking.html) — standalone LIFF page (~1,400 lines). Single-file SPA, 4 stepwise sections (calendar/picker, booking modal, payment, confirmation). Vanilla JS + Tailwind v3 + brand.css tokens. Muji minimal aesthetic, IBM Plex Sans Thai Looped, mobile-first. No React/Vue/TS per CLAUDE.md tech-stack guardrail.

### Files modified (4)
- [service-worker.js](service-worker.js) — added `/booking.html` to PRECACHE_URLS so the LIFF page works offline (LINE webview offline state).
- [vercel.json](vercel.json) — added `booking` to the no-cache HTML route regex (deploys publish without 1-hour CDN delay).
- [tools/compute-csp-hashes.js](tools/compute-csp-hashes.js) — added `booking.html` to the FILES list. **Hashes regenerated:** `npm run csp:hash` ran clean (booking.html: 4 scripts + 1 style hashed). Total now 25 script + 9 style hashes (was 21+8).
- [shared/tailwind.css](shared/tailwind.css) — `npm run tailwind:build` ran clean, output committed.

### What's in booking.html
- **Boot overlay** — LIFF init + Firebase init + `liffBookingSignIn` CF + `signInWithCustomToken` with 3-attempt retry on network errors (LIFF webview quirk pattern from `tenant_app.html`).
- **Building tabs** — Rooms / Nest with live "X ห้องว่าง" counts.
- **Filters** — floor (Nest only), type (studio / pet-allowed), max rent (5 brackets).
- **Date strip** — 60-day horizontal scroll, defaults to "Early Bird threshold" (today + 30) so prospects naturally hit the bonus.
- **Rooms list** — cards with status pills (ว่าง / มีคนอยู่ / ล็อคไว้ / จองแล้ว). Available cards click → modal.
- **Booking modal** — duration (3/6/12/24), name, phone (10-digit Thai validation), early-bird hint (≥30 days). "Lock & Pay" calls `createBookingLock` CF → returns `qrPayload`.
- **Payment step** — PromptPay QR via qrcodejs (CDN), 20-minute countdown timer with warning/danger color shifts at 5min/1min, slip upload (drag-drop / tap to pick), AVIF/HEIC → JPEG canvas conversion, `verifyBookingSlip` CF call with friendly error mapping (amount mismatch, duplicate slip, lock expired, rate-limited).
- **Confirmation step** — auto-revealed via Firestore `onSnapshot` on the booking doc (status=='paid'). Shows booking ID, room, deposit amount, transaction ref, optional Early Bird +500 hint.
- **Cancel button** — closes the booking flow without server-side write; `expireBookingLocks` scheduled CF cleans up after lock TTL.

### Browser preview verification
- Server: `python -m http.server 8000` via `.claude/launch.json` config "green-haven-test"
- LIFF init **legitimately fails on localhost** (LINE security — endpoint URL must be `https://the-green-haven.vercel.app/...`) → user lands on the boot-overlay error state with "ลองอีกครั้ง" button. Verified: button now properly sized (was stretched to fill flex column before fix).
- `/api/config` 404s on python server (Vercel serverless function only) — logged as expected error in console; doesn't block static layout.
- Manually seeded sample DOM via `preview_eval` to verify: building tabs render with "X ห้องว่าง" counts, filter dropdowns work, date strip horizontal-scrolls with active state on selected day, rooms list renders 4 sample cards (available/occupied/locked/paid) with correct status pills + grayscale on unavailable. Layout is clean Muji minimal.
- 2 bugs fixed during preview verification: (a) retry button stretch in boot overlay (added `flex: 0 0 auto` inline override), (b) duplicate click listener on available cards (was adding listener both before and after `card.innerHTML = ...`).

### What can NOT be verified outside of LINE LIFF
- Full LIFF init success (requires LINE webview)
- `liffBookingSignIn` CF call (requires real LIFF ID token)
- `createBookingLock` / `verifyBookingSlip` CF calls (require Firebase auth from LIFF sign-in)
- onSnapshot booking subscription (requires Firestore + auth)
- Real PromptPay QR scan + slip upload + auto-verify

End-to-end testing requires deploy to Vercel + open the LIFF URL in LINE app on a real device.

### Sprint 1 fully complete

**6 new Cloud Functions + 1 new HTML page + 5 config edits:**

| File | Status |
|---|---|
| `functions/promptpay.js` | ✅ NEW |
| `functions/liffBookingSignIn.js` | ✅ NEW |
| `functions/createBookingLock.js` | ✅ NEW |
| `functions/getRoomAvailability.js` | ✅ NEW |
| `functions/expireBookingLocks.js` | ✅ NEW |
| `functions/verifyBookingSlip.js` | ✅ NEW |
| `functions/index.js` | ✅ wired |
| `firestore.rules` | ✅ booking block |
| `firestore.rules.test.js` | ✅ 12 new tests pass |
| `storage.rules` | ✅ booking paths |
| `booking.html` | ✅ NEW |
| `service-worker.js` | ✅ precache |
| `vercel.json` | ✅ no-cache |
| `tools/compute-csp-hashes.js` | ✅ listed |
| `tools/csp-hashes.json` | ✅ regenerated |
| `shared/tailwind.css` | ✅ rebuilt |

**Pre-deploy checklist** (must complete before deploy):
- [x] All `node --check` syntax checks pass
- [x] `npm run test:rules` 97/98 pass (1 pre-existing failure in wellnessClaimed unrelated to this work)
- [x] `npm run csp:hash` clean
- [x] `npm run tailwind:build` clean
- [x] booking.html static layout verified in browser preview
- [ ] **`owner_info/main.phone` populated in Firestore** (admin must set via dashboard before first booking — required for QR generation)

**Deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,\
functions:createBookingLock,\
functions:getRoomAvailability,\
functions:expireBookingLocks,\
functions:verifyBookingSlip,\
firestore:rules,\
storage
```

After deploy, the booking site is live at: `https://the-green-haven.vercel.app/booking.html`

To register the URL with LINE: LINE Developers Console → LIFF tab → optionally add a new LIFF entry that points at `/booking.html` (or reuse existing channel since same `LIFF_ID`). For prospects to access, share the LIFF URL e.g. via QR code or LINE Official Account.

### Phase 4 next (admin Booking sub-tab)

Sprint 2 work:
- `functions/convertBookingToTenant.js` — admin-triggered conversion CF
- `dashboard.html` — new "Booking" sub-tab in Tenant section
- `shared/dashboard-bookings.js` — admin UI module (table, slip viewer, KYC view, approve/convert buttons)

Sprint 3 (optional):
- Phase 5: Pre-Check-in KYC upload UI (storage rules already in place)
- Phase 6: Gamification Early Bird award on contract creation

### Memory doc lifecycle

To be written at end of Sprint 1 (per CLAUDE.md verify-via-grep doctrine):
- `lifecycle_booking_flow.md` with `## Verification` section grep-backing every claim (collection paths, rule lines, CF region, lock duration, Early Bird threshold, etc.)
- Add to `MEMORY.md` index under "🏛️ System Lifecycles → Tenant-facing"
- Update `firestore_schema_canonical.md` with new `bookings/*` collection

---

## Review — Phase 4 shipped 2026-05-04

### Files added (2)
- [functions/convertBookingToTenant.js](functions/convertBookingToTenant.js) — admin-only HTTPS callable, ~180 lines. Atomic Firestore transaction creates tenant doc + approves liffUsers + flips booking status='converted'. Pre-tx queries both buildings for `linkedAuthUid` match → reuses `tenantId` for returning LINE users (cross-room continuity), mints fresh `TENANT_${ts}_${roomId}` otherwise (matches existing pattern in `dashboard-tenant-modal.js:499`).
- [shared/dashboard-bookings.js](shared/dashboard-bookings.js) — admin module, ~330 lines. IIFE with `window.initBookingsAdmin` + `window.dashboardBookings` exports (UMD pattern). Idempotent onSnapshot subscription to `bookings/* orderBy createdAt desc limit 200`. Filterable table with status pills, search across name/phone/room/lineId/bookingId, per-row actions: 📄 details modal · 🧾 slip viewer (Storage `getDownloadURL` → new tab) · ✓ approve KYC (admin direct write) · 🏠 convert (calls CF) · ✕ cancel locked (admin direct write).

### Files modified (3)
- [dashboard.html](dashboard.html) — added 5th sub-tab button `🗓️ จอง` in Tenant section + new tab content card (`tenant-main-tab-bookings`) with filter row + mount point + footer hint, + `<script src="./shared/dashboard-bookings.js">` in script load order (after `dashboard-tenant-modal.js`).
- [shared/dashboard-main.js](shared/dashboard-main.js) — `switchTenantMainTab` array updated `['tenants','leases','requests','alerts'] → ['tenants','leases','requests','alerts','bookings']`; button selector updated; `initBookingsAdmin()` call added when tab='bookings'.
- [functions/index.js](functions/index.js) — wired `convertBookingToTenant` export.

### Behavioral choices

**Why admin-only convert (not auto):** the original plan bullet (#12 in Design decisions) specified manual convert so admin can review KYC + slip before promoting prospect to tenant. Skipping auto-convert prevents "I paid → I'm a tenant" race in case of fraud / failed KYC. Admin sees full booking detail, slip image, KYC docs (when Phase 5 ships) before clicking the button.

**Why pre-transaction tenant lookup (not inside the tx):** the cross-building `linkedAuthUid` query needs to scan two collections (no Firestore index spans collection paths). Doing this inside the transaction would conflict on every tenants/* read, ballooning retry rate. `linkedAuthUid` is set-once per LINE account by `liffSignIn` — it doesn't drift mid-conversion, so the read-then-tx pattern is safe.

**Why atomic tx for tenant + liffUsers + booking update:** if any of the three writes fails partway, admins would need manual cleanup (e.g., booking marked converted but no tenant doc). Single transaction = all three commit together or none do.

**Why direct setDoc (not CF) for approve KYC + cancel locked:** these are simple status flips with no race-condition concerns and no cross-doc writes. Admin already has full write access to `bookings/*` per rules. Adding a CF for a 1-field flip would be over-engineering. Convert is the only action that needs a CF (atomic multi-doc write).

**`liffUsers/{lineUserId}` auto-approval after convert:** this means the new tenant can open `tenant_app.html` immediately after admin clicks Convert and the existing `liffSignIn` CF will mint their tenant token without a second admin approval step. Keeps the flow: lock → pay → admin convert → tenant signs into app.

### Verification
- `node --check functions/convertBookingToTenant.js` ✓
- `node --check shared/dashboard-bookings.js` ✓
- `npm run csp:hash` clean (dashboard.html script count unchanged — no new inline `<script>` blocks, just markup changes)
- `npm run verify:memory` — **31/31 booking verifier rows GREEN** (added 7 Phase 4 verifiers; still 22 docs / 0 fails total)
- Browser preview DOM verification: all 5 tenant tab buttons load, `dashboard-bookings.js` script tag present, `initBookingsAdmin` function exposed, switchTenantMainTab updated. Visual UI verification deferred to Vercel deploy (localhost dashboard auth + Firebase init both fail without /api/config + admin custom claim).

### What can NOT be verified outside production
- End-to-end convert flow (requires admin custom claim + real bookings docs)
- Slip image viewer (requires real Storage upload from `verifyBookingSlip` CF run)
- Returning-tenant detection (requires existing tenant with matching `linkedAuthUid`)
- Auto-approval of liffUsers leading to successful tenant_app sign-in

### Sprint 2 (Phase 4) complete

**8 booking files modified/added across Sprint 1 + Sprint 2:**

| File | Sprint | Status |
|---|---|---|
| `functions/promptpay.js` | 1 | ✅ |
| `functions/liffBookingSignIn.js` | 1 | ✅ |
| `functions/createBookingLock.js` | 1 | ✅ |
| `functions/getRoomAvailability.js` | 1 | ✅ |
| `functions/expireBookingLocks.js` | 1 | ✅ |
| `functions/verifyBookingSlip.js` | 1 | ✅ |
| **`functions/convertBookingToTenant.js`** | **2** | ✅ NEW |
| `booking.html` | 1 | ✅ |
| **`shared/dashboard-bookings.js`** | **2** | ✅ NEW |
| `dashboard.html` | 2 | ✅ +5th tab |
| `shared/dashboard-main.js` | 2 | ✅ +bookings handler |

**Updated deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,functions:createBookingLock,\
functions:getRoomAvailability,functions:expireBookingLocks,\
functions:verifyBookingSlip,functions:convertBookingToTenant,\
firestore:rules,storage
```

### Phase 5 + 6 (Sprint 3, optional)

- **Phase 5**: Pre-Check-in KYC upload UI in `booking.html` confirmation step (storage rules already in place from Sprint 1).
- **Phase 6**: Gamification Early Bird award trigger inside `convertBookingToTenant` — port from `gamification-rules.js` rules engine, gated on `GAMIFICATION_LIVE` flag, +500 pts when `booking.earlyBirdEligible == true`. Currently `convertBookingToTenant` already preserves `gamification` subobject from any returning tenant; the new-room write would need to seed `gamification.points = earlyBirdPoints`.

---

## Review — Phase 5 + 6 shipped 2026-05-04

### Phase 5: Pre-Check-in KYC

#### Files added (1)
- [functions/submitBookingKyc.js](functions/submitBookingKyc.js) — HTTPS callable, ~110 lines. Server-verified KYC submission. Lists `bookings/{id}/kyc/*` via admin SDK to confirm required uploads exist (don't trust client-provided file list), validates required types (`idCardFront` + `idCardBack`), updates booking → status='paid' → 'kyc_pending' + records `kycDocsTypes`, `kycDocsPath`, `kycSubmittedAt`. Status guard allows re-submission while `kyc_pending` so admin can ask for re-upload.

#### Files modified (1)
- [booking.html](booking.html) — added Storage SDK import to Firebase init module + `window.bookingFirebase.uploadKyc()` helper; replaced "เปิดใช้งานเร็วๆ นี้" placeholder in `#stepConfirm` with full KYC upload UI:
  - 4 file picker tiles (`idCardFront`, `idCardBack`, `houseReg`, `employmentLetter`) with deterministic filenames so re-uploads overwrite
  - Per-tile state classes: `.uploaded` / `.uploading` / `.error` for visual feedback (green/amber/red)
  - 5MB cap + image|PDF MIME check + AVIF/HEIC→JPEG canvas conversion (matches slip flow)
  - Submit button gated on required-types-uploaded; calls `submitBookingKyc` CF on click
  - Success state (`#kycDone`) replaces upload section after server confirms

#### Why server-verified (not client-trusted)
A client could call `submitBookingKyc({bookingId})` claiming uploads exist when they don't. CF lists Storage server-side via `bucket.getFiles({prefix})` and matches filename stems against the type whitelist before flipping booking status. Required types missing → throws `failed-precondition` with friendly Thai error message.

#### Why deterministic filenames (not timestamp-based like slips)
Re-uploading the same KYC type overwrites — admin sees only the latest version per type, prospects can re-upload bad photos without admin intervention. Slip uploads use timestamp-based filenames because slip provenance matters for audit + dedup; KYC docs are admin-reviewed live, latest-wins is fine.

### Phase 6: Early Bird gamification

#### Files modified (3)
- [functions/createBookingLock.js](functions/createBookingLock.js) — `earlyBirdEligible` now requires `building === 'nest'` AND `daysUntilStart >= 30`. Rooms prospects don't see misleading "+500 pts" hints in `booking.html` that would never materialize.
- [functions/convertBookingToTenant.js](functions/convertBookingToTenant.js) — when converting an `earlyBirdEligible` booking, mergedGamification adds `+500 pts` to existing `gamification.points` (or seeds 500 from 0 for new tenants), records `earlyBirdAwardedAt` + `earlyBirdPoints` audit fields, writes a `paymentHistory/booking_early_bird_{YYYY-MM}` ledger marker (mirrors verifySlip's payment-history pattern), and stamps `earlyBirdAwarded: true` + `earlyBirdAwardedPoints: 500` on the booking doc for admin dashboard visibility. All inside the same atomic transaction.
- [booking.html](booking.html) — modal Early Bird hint now also gates on `state.building === 'nest'` (was time-only). Server-side gate matches: hint is only shown when actually awardable.

#### Why Nest-only

Per `gamification_ssot.md`: the gamification system (points, badges, leaderboard, redemption) is Nest-building-only. Awarding points to a Rooms tenant doc would be dead data — the tenant_app.html points display + leaderboard + redemption UI all gate on `building === 'nest'`. Keeping the gate in `createBookingLock` is the **single source of truth**: `earlyBirdEligible` and `earlyBirdPoints` fields on the booking doc are reliable; downstream code (UI, convert CF) can trust them without re-checking building.

#### Idempotency

`convertBookingToTenant` runs once per booking — the status guard rejects subsequent calls (`booking.status === 'converted'` is not in `CONVERT_ELIGIBLE_STATUSES`). Within the transaction, gamification points + paymentHistory ledger marker + booking flip all commit together or none do. No "re-award" path exists, so double-award is structurally impossible.

#### Returning-tenant case

If the prospect was already a Nest tenant before (linkedAuthUid match), their existing `gamification` subobject is preserved AND has earlyBirdPoints added. A Nest tenant moving from N101 to N301 with eligible booking → +500 on top of their existing balance, in the new room's tenant doc. (The original room's tenant doc is untouched — admin chooses whether to mark it moved-out separately.)

### Verification
- `node --check` all 3 modified/new CF files ✓
- `npm run csp:hash` — clean. booking.html still 4 scripts + 1 style (no new inline blocks; existing module script body changed → new hash, recorded).
- `npm run verify:memory` — **39/39 booking verifier rows GREEN** (was 31, added 8 Phase 5+6 verifiers). 22 docs / 197+ rows / 0 fails total.
- Browser preview DOM: KYC section present in `#stepConfirm`, 4 tiles with correct `data-kyc-type` values, submit button starts disabled, kycDone (success state) ready to replace upload section. (Screenshot tool stuck on localhost — visual verification deferred to Vercel deploy.)

### What can NOT be verified outside production
- End-to-end KYC upload flow (requires LIFF auth + booking doc in `paid` state)
- Storage rule guard on KYC writes (requires real prospect token)
- `submitBookingKyc` server-side file verification (requires actual Storage uploads)
- Early Bird points landing in tenant_app.html UI (requires `GAMIFICATION_LIVE` flag flip + Nest tenant signed in)

### Sprint 3 complete

**3 booking phases shipped today (2026-05-04):** Phase 4 admin UI + Phase 5 KYC + Phase 6 Early Bird.

**Final Sprint 1+2+3 file inventory:**

| File | Status |
|---|---|
| `functions/promptpay.js` (Phase 1) | ✅ |
| `functions/liffBookingSignIn.js` (Phase 1) | ✅ |
| `functions/createBookingLock.js` (Phase 1, modified Phase 6) | ✅ |
| `functions/getRoomAvailability.js` (Phase 1) | ✅ |
| `functions/expireBookingLocks.js` (Phase 1) | ✅ |
| `functions/verifyBookingSlip.js` (Phase 2) | ✅ |
| `functions/convertBookingToTenant.js` (Phase 4, modified Phase 6) | ✅ |
| `functions/submitBookingKyc.js` (Phase 5) | ✅ |
| `booking.html` (Phase 3, modified Phase 5+6) | ✅ |
| `shared/dashboard-bookings.js` (Phase 4) | ✅ |
| `dashboard.html` (Phase 4) | ✅ |
| `shared/dashboard-main.js` (Phase 4) | ✅ |
| `firestore.rules` + `firestore.rules.test.js` (Phase 1) | ✅ |
| `storage.rules` (Phase 2) | ✅ |
| `service-worker.js` + `vercel.json` + `tools/compute-csp-hashes.js` + `tools/csp-hashes.json` + `shared/tailwind.css` (Phase 3) | ✅ |
| `lifecycle_booking_flow.md` + `MEMORY.md` + `firestore_schema_canonical.md` (Phase 3-6) | ✅ |

**Final deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,functions:createBookingLock,\
functions:getRoomAvailability,functions:expireBookingLocks,\
functions:verifyBookingSlip,functions:convertBookingToTenant,\
functions:submitBookingKyc,\
firestore:rules,storage
```

Pre-deploy gate: `owner_info/main.phone` must be set in Firestore (admin sets via dashboard before first booking).

### What's NOT in scope (intentional, per Sprint 1 design decisions)

- ❌ Auto-cancellation refund flow (manual admin process)
- ❌ Multi-room booking in one transaction (1 booking = 1 room)
- ❌ Walk-in booking (LIFF only; admin can manually create via Firestore Console as escape hatch)
- ❌ External payment gateway (PromptPay only)
- ❌ Booking-flow English/multi-lang (Thai only)
- ❌ Booking site hosted on a separate LIFF channel (reuses tenant LIFF channel; route-based separation via URL)

---

# Person-Centric Identity (tenantId / contractId / people SoT) — plan 2026-05-04

## Vision (จาก user)
- `tenantId` = identity ถาวรของคน — ลูกบ้านออกแล้วกลับมาเช่าใหม่ ต้องเจอข้อมูลเดิม
- `contractId` = unique per lease — แต่ละสัญญาเช่ามี id ตัวเอง (ของถาวรไหลตามคน, ของเฉพาะกาลไหลตามสัญญา)
- Community member ที่ไม่ใช่ลูกบ้านปัจจุบัน → ต้องมีข้อมูล + ร่วมกิจกรรมได้

## Current state (verified 2026-05-04)
- ✅ `convertBookingToTenant.js:84-98` ค้นหา prior tenancy โดย `linkedAuthUid == 'line:'+prospectLineId` — match แล้ว reuse `tenantId` (Returning tenant flag กลับมาใน response)
- ✅ `contractId = CONTRACT_${Date.now()}_${roomId}` generate ใหม่ทุกครั้ง — pattern ถูกต้องแล้ว
- ❌ **ไม่มี move-out archive flow** — `cleanupRoomData.js` แค่ cleanup RTDB fields ไม่ได้เก็บ identity. ถ้า admin assign ห้องให้คนใหม่ → ข้อมูลคนเก่าทับทันที
- ❌ Schema เป็น **room-centric** — `tenants/{building}/list/{roomId}` คีย์ด้วยห้อง. คนออกจากห้อง = ข้อมูลหาย
- ❌ Gamification points / redemptions / badges อยู่ใน `tenants.../{roomId}.gamification` → ผูกกับห้อง ไม่ใช่คน
- ❌ Returning lookup match แค่ LINE UID — ผู้เช่าที่ admin สร้างเอง (ไม่ผ่าน LIFF) หรือมาด้วยบัญชี LINE ใหม่ ไม่เจอ

## Approach: 3 phase incremental
ไม่ refactor ทีเดียว — แต่ละ phase ตอบโจทย์ vision ทีละชั้น และใช้งานได้จริงทันที

---

## Phase 1 — Move-out archive (preserve identity on move-out) ✅

**Goal:** ผู้เช่าออกแล้วกลับมา → เจอข้อมูลเดิม. **Scope:** เฉพาะการ preserve. ยังไม่แตะ schema ใหญ่.

### Step 1.1 — สร้าง `tenants/{building}/archive/{contractId}` subcollection ✅
- [x] **Why:** preserve old tenant doc ก่อน admin assign ห้องให้คนใหม่. คีย์ด้วย `contractId` เพราะคนหนึ่งคนอาจเคยเช่าหลายสัญญา → ดูประวัติได้ครบ
- [x] Schema: copy fields จาก tenant doc + เพิ่ม `archivedAt`, `archivedReason` (`'moved_out'|'reassigned'|'admin_action'`), `archivedBy`, `archivedByEmail`, `sourceRoom`
- [x] Rule: admin-only read/write (`firestore.rules` — added `match /tenants/{building}/archive/{contractId}` block + recursive `match /{subPath=**}` for subcollections)
- [x] Verification: `grep "tenants/{building}/archive" firestore.rules` ✓

### Step 1.2 — เพิ่ม CF `archiveTenantOnMoveOut` (HTTPS callable) ✅
- [x] **Why:** atomic batch — copy parent + subcolls + delete + blank live doc ในก้อนเดียว. ห้าม do-it-from-frontend
- [x] Region SE1 (Singapore — match other tenant-flow CFs)
- [x] Input: `{building, roomId, reason}` from authenticated admin (admin claim required)
- [x] Logic implemented at [functions/archiveTenantOnMoveOut.js](functions/archiveTenantOnMoveOut.js):
  - reads `tenants/{b}/list/{r}` → throws if no `tenantId` or no `name|firstName`
  - computes contractId (live `contractId` field, or `LEGACY_${tenantId}_${ts}`)
  - reads 5 subcollections (paymentHistory, redemptions, wellnessClaimed, pets, complaintFreeMonthAwarded)
  - one batch: archive parent + all subdocs + delete originals + blank list doc + status='vacant'
  - 450-op safety cap (Firestore batch limit 500)
  - refuses overwrite of existing archive doc
- [x] Registered in [functions/index.js](functions/index.js)
- [x] **Why batch (not transaction):** subcollection lists need queries; concurrent archives are idempotent

### Step 1.3 — UI button ใน dashboard tenant modal ✅
- [x] [shared/dashboard-tenant-modal.js](shared/dashboard-tenant-modal.js): added `archiveTenantOnMoveOut()` function (~70 LOC) + global window export
- [x] Confirm via `window.ghConfirm` with danger styling — message lists what will happen + reassurance about returning-tenant restore
- [x] Reason hardcoded to `'moved_out'` (Phase 1 simplification — CF accepts moved_out|reassigned|admin_action; reason picker can be added later)
- [x] On success → close modal, refresh room/occupancy displays, toast with contractId + subdoc count
- [x] [dashboard.html:2298](dashboard.html#L2298) — added `📦 ย้ายไป Archive` button (red outline) between Save and Close in modal footer
- [x] [shared/dashboard-main.js](shared/dashboard-main.js) — wired `data-action="archiveTenantOnMoveOut"` dispatch

### Step 1.4 — extend Returning lookup ใน `convertBookingToTenant.js` ✅
- [x] [functions/convertBookingToTenant.js:84-158](functions/convertBookingToTenant.js#L84): replaced single-pass live-doc lookup with **4-pass cascade**:
  - Pass 1: live tenant by `linkedAuthUid` (existing behavior)
  - Pass 2: archive by `linkedAuthUid` (orderBy archivedAt desc, limit 1)
  - Pass 3: archive by `lineID == prospectLineId`
  - Pass 4: archive by `phone == prospectPhone` ← key Phase 1 capability (returning with new LINE account)
- [x] `priorGamificationFromArchive` carried into `mergedGamification` so points/streaks/badges restore
- [x] Response includes `restoredFrom: 'live'|'archive_uid'|'archive_lineid'|'archive_phone'|null`
- [x] [shared/dashboard-bookings.js:308](shared/dashboard-bookings.js#L308) — admin convert toast displays Thai label per restoredFrom value
- [x] [firestore.indexes.json](firestore.indexes.json): 3 composite indexes added for archive scan: `(linkedAuthUid, archivedAt desc)`, `(lineID, archivedAt desc)`, `(phone, archivedAt desc)`

### Step 1.5 — Verification + tests ✅
- [x] [firestore.rules.test.js](firestore.rules.test.js) — 10 new tests for archive: admin read/write OK, LIFF tenant + anon + unauth all denied, recursive wildcard for subcoll docs verified
- [x] `npm run test:rules` cannot run locally (Java not installed for Firebase emulator); tests will execute via [.github/workflows/firestore-rules.yml](.github/workflows/firestore-rules.yml) on push
- [x] All edited JS files pass `node --check` (syntax clean)
- [x] [memory/firestore_schema_canonical.md](C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/firestore_schema_canonical.md) — added archive collection block above tenants/list (with `Composite indexes required` callout)
- [x] [memory/lifecycle_tenant_ssot.md](C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_ssot.md) — added "Move-out flow + archive" section + 4 new verification grep entries
- [x] `npm run verify:memory` ✅ ALL GREEN (22 docs, 216 verifier rows, 0 fails)
- [ ] **PENDING — manual E2E on Vercel after push:**
  1. Archive an existing tenant via dashboard → check Firestore `tenants/rooms/archive/{contractId}` has clone + subcolls
  2. Verify list doc at that room is blank with status='vacant'
  3. Create a new booking for same LINE user → convert → toast shows "ลูกบ้านเก่ากลับมา (LINE เดิม)" + tenantId reused

**Phase 1 deliverable:** ✅ ผู้เช่าออก → กลับมา → เจอข้อมูลเดิม. ครอบคลุม vision ส่วน "ลูกบ้านออกแล้วกลับมา"

## Review (Phase 1)

### What shipped (8 file edits, 1 new file)

| File | Type | Change |
|---|---|---|
| [functions/archiveTenantOnMoveOut.js](functions/archiveTenantOnMoveOut.js) | NEW | Admin callable — atomic batch archive + blank live doc + preserve 5 subcollections |
| [functions/index.js](functions/index.js) | edit | Register `archiveTenantOnMoveOut` export |
| [functions/convertBookingToTenant.js](functions/convertBookingToTenant.js) | edit | 4-pass returning-tenant cascade (live → archive_uid → archive_lineid → archive_phone); restore gamification from archive; surface `restoredFrom` |
| [firestore.rules](firestore.rules) | edit | New `tenants/{b}/archive/{c}` block + recursive subcoll wildcard |
| [firestore.rules.test.js](firestore.rules.test.js) | edit | +10 tests for archive admin-only access |
| [firestore.indexes.json](firestore.indexes.json) | edit | +3 composite indexes for archive scan |
| [dashboard.html](dashboard.html) | edit | "📦 ย้ายไป Archive" button in tenant modal footer |
| [shared/dashboard-tenant-modal.js](shared/dashboard-tenant-modal.js) | edit | `archiveTenantOnMoveOut()` UI function + ghConfirm dialog |
| [shared/dashboard-main.js](shared/dashboard-main.js) | edit | data-action dispatch for archive button |
| [shared/dashboard-bookings.js](shared/dashboard-bookings.js) | edit | Convert-success toast labels per restoredFrom |
| [memory/firestore_schema_canonical.md](C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/firestore_schema_canonical.md) | edit | Archive collection schema + composite-index requirement |
| [memory/lifecycle_tenant_ssot.md](C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_tenant_ssot.md) | edit | Move-out flow section + 4 new verifier greps |

### Deploy commands

```bash
# Functions (new + modified)
firebase deploy --only functions:archiveTenantOnMoveOut,functions:convertBookingToTenant

# Rules + indexes (new collection + composite indexes)
firebase deploy --only firestore:rules,firestore:indexes
```

⚠️ **Composite indexes take a few minutes to build.** Pass 2-4 of the returning-tenant lookup will throw `FAILED_PRECONDITION` until indexes finish — ride that out before live-testing the convert flow.

### Deferred / not in Phase 1
- ❌ Reason picker UI (CF accepts 3 reasons; UI hardcodes `'moved_out'`)
- ❌ Audit log to `system/audit_logs` (the archive doc IS the audit trail — `archivedAt`/`archivedReason`/`archivedBy`)
- ❌ Tenant-side "see my history" view (Phase 2 with people/{tenantId})
- ❌ Removing the old single-pass live lookup (kept; Phase 2 may consolidate when migrating to people/)
- ❌ Migration script for existing pre-archive tenants (Phase 2 will handle bulk via `people/` migration)
- ❌ Java/emulator-based local rules tests (CI runs them on push)

### Follow-ups before Phase 2
- Watch live archive flow for 1-2 weeks — confirm composite indexes don't blow read budget
- If admin needs reason picker (some archive aren't move-outs), add reason dropdown to confirm dialog
- Check whether `complaintFreeMonthAwarded` subcollection is actually used anywhere (CF only?) — if dead, drop from ARCHIVED_SUBCOLLECTIONS list

---

## Phase 2 — `people/{tenantId}` as person SoT (decouple identity from room) ⏳

**Goal:** ข้อมูล "คน" แยกออกจากข้อมูล "ห้อง". ตอบโจทย์ "ของถาวรไหลตามคน". **Scope ใหญ่** — กระทบ tenant_app, dashboard, gamification, rules.

### Step 2.1 — Schema design
- [ ] สร้าง `people/{tenantId}` top-level collection
- [ ] Fields:
  - identity: `tenantId, name, firstName, lastName, phone, email, lineUserId, lineDisplayName, idCardNumber`
  - link: `linkedAuthUid` (LINE UID ปัจจุบัน — change ได้ถ้าเปลี่ยน LINE), `linkedAuthUidHistory[]` (audit)
  - gamification: `gamification: {points, paymentPoints, onTimeCount, lateCount, currentStreak, longestStreak, badges, lastDailyClaim, dailyStreak, lastDailyClaimAt}` ← ย้ายจาก tenant doc
  - status: `currentLease: {building, roomId, contractId} | null` (null = community member ที่ไม่ได้เช่าอยู่)
  - history: `contractHistory: [{contractId, building, roomId, startDate, endDate, status}]`
  - meta: `createdAt, updatedAt, joinedCommunityAt`
- [ ] subcollection `redemptions/{auto}` — ย้ายจาก `tenants/.../{roomId}/redemptions`
- [ ] subcollection `paymentHistory/{YYYY-MM}` — ย้ายจาก tenant
- [ ] subcollection `wellnessClaimed/{articleId}` — ย้ายจาก tenant
- [ ] **Why top-level (ไม่ใช่ subcollection):** ตอบ vision "ไม่ใช่ลูกบ้าน" — คนที่ออกจากห้องแล้วยังเป็น community member ได้ → ไม่ควรอยู่ใน `tenants/...` path

### Step 2.2 — Migration script (one-shot CF)
- [ ] `functions/migrateTenantsToPeople.js` — admin-only HTTPS, runs once
- [ ] อ่านทุก tenant doc จาก `tenants/{rooms,nest}/list/*`
- [ ] สำหรับแต่ละคน:
  - ถ้ามี `tenantId` → ใช้เป็น people doc id
  - ถ้าไม่มี → generate `LEGACY_TENANT_${roomId}_${ts}` + write กลับใส่ list doc
  - copy gamification + identity fields → `people/{tenantId}`
  - set `currentLease: {building, roomId, contractId}` ใน people doc
- [ ] dry-run flag (`?dryRun=1`) — log เฉยๆ ไม่ commit
- [ ] idempotency: ถ้า `people/{tenantId}` มีอยู่แล้ว → skip
- [ ] **Why one-shot CF (ไม่ใช่ trigger):** migration เกิดครั้งเดียวต่อ environment — trigger จะกินค่าใช้จ่ายตลอดไป
- [ ] เก็บ tombstone marker `system/migrations/people_v1` ที่ run แล้ว

### Step 2.3 — Update read sites
- [ ] [tenant_app.html](tenant_app.html): `_subscribeEcoPoints` + redemption read → อ่านจาก `people/{tenantId}` แทน `tenants/.../{roomId}.gamification`
- [ ] [shared/dashboard-extra.js](shared/dashboard-extra.js): leaderboard, points display → อ่านจาก `people/*`
- [ ] [shared/lease-config.js](shared/lease-config.js) + tenant-system.js: เมื่อ load tenant → join people doc ผ่าน tenantId
- [ ] **Why join (ไม่ duplicate ลง tenant doc):** ป้องกัน drift. SSoT ต้องเดียว — gamification อยู่ที่ people เท่านั้น

### Step 2.4 — Update write sites
- [ ] `verifySlip.js` (rent gamification award) → write `people/{tenantId}.gamification.points` แทน tenant doc
- [ ] `claimDailyLoginPoints.js`, `redeemReward.js`, `awardComplaintFreeMonth.js`, wellness claim → ทุกที่ที่เขียน gamification → ชี้ที่ people
- [ ] `convertBookingToTenant.js` → สร้าง / update people doc ด้วย (ไม่ใช่แค่ tenant doc)
- [ ] `archiveTenantOnMoveOut` (จาก Phase 1) → set `people/{tenantId}.currentLease = null` + push `contractHistory[]`

### Step 2.5 — Rules
- [ ] `firestore.rules`: เพิ่ม
  ```
  match /people/{tenantId} {
    allow read: if isAdmin() ||
      (isSignedIn() && resource.data.linkedAuthUid == request.auth.uid);
    allow write: if isAdmin();  // เขียนผ่าน CF only (admin SDK bypass)
  }
  ```
- [ ] เพิ่ม rule tests

### Step 2.6 — Verification
- [ ] Migration dry-run → ดู log ครบทุก tenant
- [ ] Migration live → spot-check 3 tenant
- [ ] Tenant_app เปิดได้, points display ตรง, redemption ใช้ได้
- [ ] Dashboard leaderboard ทำงาน
- [ ] อัพเดท `memory/firestore_schema_canonical.md` + `lifecycle_tenant_ssot.md` + `gamification_ssot.md`
- [ ] อัพเดท `memory/MEMORY.md` index

**Phase 2 deliverable:** Identity แยกจากห้อง. คนเปลี่ยนห้องได้, ออกจากห้องได้ — ข้อมูลตามไป

---

## Phase 3 — Community participation for non-tenants ⏳

**Goal:** คนที่ไม่ได้เช่า (เคยเป็นลูกบ้าน หรือ external community) → ร่วมกิจกรรม / ดู feed / ใช้ wellness ได้

### Step 3.1 — Decide scope (ต้อง user input ก่อนทำ)
- [ ] Q1: external community member สมัครยังไง? (LINE Add Friend → admin approve? หรือ public sign-up?)
- [ ] Q2: feature ไหนเปิด non-tenant? (เสนอ: wellness ✅, daily-bonus ✅, marketplace ✅, community feed ✅ / bills ❌, complaints ❌, maintenance ❌, housekeeping ❌)
- [ ] Q3: redemption rewards — non-tenant แลกได้ไหม? (เสนอ: ได้ — เก็บ point ผ่าน wellness/daily ก็ใช้ได้)

### Step 3.2 — Implement (รอ Phase 3.1)
- [ ] tenant_app.html init flow → ถ้า people doc มี `currentLease == null` → load community-only views
- [ ] Hide tabs ที่ไม่ available (bills, complaints) สำหรับ community member
- [ ] แต่ tab community / wellness / marketplace / rewards ยังเปิด

### Step 3.3 — Optional admin UI สำหรับ approve community member
- [ ] Dashboard tab "Community Members" — list `people/*` ที่ `currentLease == null`
- [ ] Approve / promote เป็น tenant ภายหลังได้

**Phase 3 deliverable:** Vision เต็ม — community participation ไม่ผูกกับสัญญาเช่า

---

## Suggested execution order
1. **Phase 1 ก่อน** (low-risk, ไม่ refactor schema) — ส่ง value เร็ว: returning tenant ใช้งานได้ทันที. Estimate: 1 session
2. **Phase 2** (กลาง — ต้องระวัง migration) — รอ user OK Phase 1 แล้วค่อยขยับ. Estimate: 2-3 session
3. **Phase 3** (ต้องการ product decision ก่อน) — รอ Phase 2 settle + ตอบคำถาม Step 3.1

## Out of scope (เฟสนี้)
- ❌ Multi-room single tenant (1 คนเช่า 2 ห้องพร้อมกัน) — schema รองรับไม่ได้ตอนนี้, ต้อง refactor `currentLease` เป็น array
- ❌ Family / household grouping (พ่อแม่ลูกร่วมห้อง) — แต่ละคนคน people doc ของตัวเอง
- ❌ Cross-property: ถ้ามี Nature Haven 2 ในอนาคต — schema นี้ใช้ได้ แต่ต้องเพิ่ม property field
- ❌ GDPR / data deletion request — ตอนนี้ archive ไม่มี TTL. ค่อยเพิ่มถ้ากฎหมายไทยกำหนด

## Open questions (ขอ user ตอบก่อนเริ่ม)
1. **เริ่ม Phase 1 อย่างเดียวก่อน หรือไป Phase 2 เลย?** (Phase 1 = solid foundation, Phase 2 = full vision but riskier)
2. **`contractId` ของ legacy tenant (pre-2026-05-04) จะ generate ตอน archive หรือ ตอน migration?** เสนอ: ตอน archive (lazy — ไม่กระทบ live tenant ตอนนี้)
3. **Community member ในอนาคตจะ sign up ทางไหน?** (ผูก Phase 3 design)

---

# Phase 5 — Senior UI/UX Audit Fixes (2026-05-05)

## Context
Senior UI/UX audit ทำขึ้นหลัง dark mode ครบ. พบ 10 จุดที่มีผลกับ usability / accessibility / performance จริง.
แบ่งเป็น 4 กลุ่มตาม effort จากน้อยไปมาก แต่ละจุดอิสระจากกัน (ทำแยกได้).

---

## กลุ่ม A — Quick UX wins (effort: เล็ก, 1-2 ไฟล์ต่อจุด)

### A1 — Login forgot-password: `prompt()` → GhModal form
- **ปัญหา:** `prompt('กรุณาใส่อีเมล')` ใน `login.html` เป็น browser native dialog — ดีไซน์ไม่ได้, ไม่ validate, block UI, บางเบราว์เซอร์ (brave) block
- **ไฟล์:** `login.html`
- **Fix:**
  - เปลี่ยน call `prompt()` → `GhModal.open({ title: 'รีเซ็ตรหัสผ่าน', body: '<input type="email"...>' })`
  - จาก callback ของ OK button → เรียก `sendPasswordResetEmail(auth, email)`
  - ใส่ email validation + loading state บนปุ่ม OK
- **Why:** UX ปี 2026 ไม่ใช้ `prompt()`. User trust + cross-browser consistency
- **Verification:** คลิก "ลืมรหัสผ่าน" → modal style เดียวกับ ghAlert → ส่งอีเมลได้

### A2 — Dashboard KPI grid: fixed 4-col → responsive auto-fit
- **ปัญหา:** `grid-template-columns: repeat(4, 1fr)` บน `.kpi-grid` — บนหน้าจอ <900px truncate, admin ใช้ tablet/มือถือตอน property walk-through
- **ไฟล์:** `dashboard.html` (CSS block ประมาณ `.kpi-grid` class)
- **Fix:** `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))`
- **Why:** Single-line change แต่แก้ทุก screen size. KPI ยังเต็มแถวบน desktop
- **Verification:** resize browser ถึง 600px → KPI เปลี่ยนเป็น 2-col หรือ 1-col เองโดยไม่ truncate

### A3 — Dashboard bill layout: sticky 2-col → stack on mobile
- **ปัญหา:** Bill/payment section ใช้ `grid-template-columns: 1fr 1fr` + `position: sticky` sidebar — ใช้ไม่ได้บน mobile
- **ไฟล์:** `dashboard.html` (CSS block, bill section)
- **Fix:** เพิ่ม `@media (max-width: 768px)` → `grid-template-columns: 1fr; position: static`
- **Why:** Admin อาจดูบิลบนมือถือขณะ inspect ห้อง
- **Verification:** mobile emulation → bill tab layout stack ได้

### A4 — Dashboard form 2-col: เพิ่ม mobile breakpoint
- **ปัญหา:** Form sections ใน Owner/Settings ใช้ `grid-template-columns: 1fr 1fr` — ไม่มี media query stack
- **ไฟล์:** `dashboard.html` (CSS)
- **Fix:** `@media (max-width: 600px)` → `grid-template-columns: 1fr` สำหรับ form grid
- **Verification:** mobile → form inputs เต็ม width

---

## กลุ่ม B — Accessibility (effort: เล็ก-กลาง)

### B1 — Tenant app world map tiles: `<div onclick>` → `<button>`
- **ปัญหา:** World map tiles (หน้าสำรวจ) ใช้ `<div class="world-item animate-bounce" onclick="...">` — ไม่ keyboard accessible, ไม่ screen reader friendly
- **ไฟล์:** `tenant_app.html` (world map section)
- **Fix:** เปลี่ยนจาก `<div onclick>` → `<button type="button" class="world-item animate-bounce" aria-label="ไปหน้า...">` หรือเพิ่ม `role="button" tabindex="0"` + `keydown` handler (Enter/Space)
- **Why:** A11y + iOS Safari บางเวอร์ชัน click event บน div ไม่ reliable
- **Verification:** Tab ผ่าน world map → focus visible, Enter กด → navigate ได้

### B2 — Emergency accordion: inline `onclick` → `<button>` + aria-expanded
- **ปัญหา:** Emergency procedure accordion header ใช้ `onclick="toggleAccordion(this)"` บน div — ไม่ semantic
- **ไฟล์:** `tenant_app.html` (emergency section)
- **Fix:**
  - เปลี่ยน element เป็น `<button>` หรือ เพิ่ม `role="button" tabindex="0" aria-expanded="false"`
  - `toggleAccordion()` toggle `aria-expanded` ด้วย
  - `aria-controls` ชี้ไปที่ panel id
- **Why:** Screen reader จะประกาศ "expanded/collapsed" ให้ user รู้สถานะ
- **Verification:** Toggle accordion → aria-expanded ใน DevTools เปลี่ยนตาม

---

## กลุ่ม C — Performance (effort: กลาง)

### C1 — Font Awesome: async load แทน render-blocking
- **ปัญหา:** `<link rel="stylesheet" href="cdnjs...font-awesome...all.min.css">` โหลด eager (~160KB CSS) บน tenant_app + dashboard — block first paint
- **ไฟล์:** `tenant_app.html`, `dashboard.html`
- **Fix:** เปลี่ยนเป็น async pattern:
  ```html
  <link rel="stylesheet" href="...all.min.css" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="...all.min.css"></noscript>
  ```
- **Why:** Icon ไม่ใช่ critical content — defer ได้ โดยไม่มี layout shift (ตัวหนังสือ fallback ระหว่างรอ)
- **Verification:** Lighthouse → Eliminate render-blocking resources ลดลง

### C2 — QRCode.js: lazy-load เฉพาะหน้า payment
- **ปัญหา:** `<script src="cdnjs...qrcode.min.js">` โหลด eager บน tenant_app — ส่วนใหญ่ user ไม่เข้าหน้า payment ทุกครั้ง
- **ไฟล์:** `tenant_app.html`
- **Fix:**
  - ลบ `<script>` ออกจาก head
  - ใน `showPage('payment')` handler → `if (!window.QRCode) await loadScript('/path/qrcode.min.js')`
  - ใช้ pattern เดียวกับ `window.ensureHtml2Canvas` ที่มีอยู่แล้ว
- **Why:** ประหยัด parse time (QRCode.js ~18KB) บน first load
- **Verification:** DevTools Network → qrcode.js โหลดเฉพาะเมื่อเปิด payment tab

---

## กลุ่ม D — Structural (effort: กลาง-ใหญ่, แนะนำทำแยก session)

### D1 — Unify dark mode: ลบ `body.night-mode` ออกจาก tenant_app
- **ปัญหา:** `tenant_app.html` มี CSS block ใหญ่ใช้ `body.night-mode` selector (legacy) ขนานไปกับ `html[data-theme="dark"]` (ใหม่) — mechanism สองชั้น, ค่าอาจต่างกัน, เวลา debug สับสน
- **ไฟล์:** `tenant_app.html` (CSS dark mode block), `shared/theme-toggle.js`
- **Fix:**
  - Map ทุก rule `body.night-mode X` → `html[data-theme="dark"] X`
  - ลบ `body.classList.add('night-mode')` ออกจาก `theme-toggle.js`
  - ทดสอบ dark mode ทุกหน้า
- **Why:** Single mechanism → easier debug, ลด CSS size, ไม่มี specificity conflict
- **Risk:** MEDIUM — ต้อง map ทุก rule อย่างถูกต้อง ก่อน deploy ต้อง verify visual ทุก page
- **Verification:** dark mode บน tenant_app ทุก 25 pages ดูเหมือนกัน

### D2 — dashboard-extra.js: CSS class แทน inline hex ใน dynamic HTML
- **ปัญหา:** JS-generated HTML ใน `dashboard-extra.js` ใช้ inline style hex (เช่น `style="background:#fafafa; border:1px solid #ddd"`) — dark mode ต้องเพิ่ม attribute selector ใหม่ทุกครั้ง ไม่ scale
- **ไฟล์:** `shared/dashboard-extra.js`, `dashboard.html` (เพิ่ม class definitions)
- **Fix:**
  - สร้าง CSS classes เช่น `.owner-card`, `.payment-config-card`, `.bill-table-header` ใน dashboard.html
  - เปลี่ยน template strings ใน JS → ใช้ class แทน inline style
  - Dark mode จะ cover อัตโนมัติผ่าน `.owner-card { background: var(--surface-card) }`
- **Why:** Sustainable — dark mode สำหรับ element ใหม่ใน JS ไม่ต้อง touch CSS อีกต่อไป
- **Risk:** MEDIUM — เยอะมาก ทำค่อย ๆ ทีละ function
- **Verification:** เพิ่ม CSS class ใหม่ใน JS → ไม่ต้องเพิ่ม CSS rule ใหม่สำหรับ dark mode

---

## Priority แนะนำ

| จุด | Impact | Effort | แนะนำ |
|-----|--------|--------|--------|
| A1 — Login forgot-password | สูง (trust) | เล็ก | ✅ ทำก่อน |
| A2 — KPI responsive | สูง (usability) | เล็กมาก | ✅ ทำก่อน |
| A3 — Bill layout mobile | กลาง | เล็ก | ✅ ทำก่อน |
| A4 — Form grid mobile | กลาง | เล็กมาก | ✅ ทำก่อน |
| B1 — World map button | สูง (a11y) | เล็ก | ✅ ทำก่อน |
| B2 — Emergency accordion | กลาง (a11y) | เล็ก | ควรทำ |
| C1 — FA async | กลาง (perf) | เล็ก | ควรทำ |
| C2 — QRCode lazy | กลาง (perf) | เล็ก | ควรทำ |
| D1 — Dark mode unify | ต่ำ-กลาง (debt) | ใหญ่ | เก็บไว้ |
| D2 — JS hex → CSS class | กลาง (debt) | ใหญ่ | เก็บไว้ |

## รอ User Approval ก่อนเริ่ม
- [x] เริ่ม Group A ทั้ง 4 จุดก่อน? (low-risk, quick wins)
- [x] ทำ Group B (a11y) ในรอบเดียวกัน?
- [x] Group C (perf) แยก session?
- [x] Group D (structural) เลื่อนไปก่อน?

---

## Review — Phase 5 ครบทุก Group (2026-05-06)

**Commit:** `4d7962c` (Group A+B, 2026-05-05) + `eff3fbd` (Group C+D, 2026-05-06)

### Shipped
- [x] **A1** `login.html` — `prompt()` → `GhModal.open()` with email input + validation + Firebase reset
- [x] **A2** `dashboard.html` — KPI grid `repeat(4,1fr)` → `repeat(auto-fit, minmax(190px,1fr))`
- [x] **A3** `dashboard.html` — bill layout sticky sidebar → `position:static` + 1-col stack at ≤1100px
- [x] **A4** `dashboard.html` — form-grid / bill-actions / exp-form / mx-form → 1-col at ≤600px
- [x] **B1** `tenant_app.html` — world map 4 tiles `<div onclick>` → `<button type="button" aria-label>`
- [x] **B2** `tenant_app.html` — `toggleAccordion` sets `aria-expanded`; JS enhancer adds `tabindex=0 role=button keydown` to all 13 accordion headers
- [x] **C1** `tenant_app.html`, `dashboard.html` — FA CSS async (`media="print" onload`), 160 KB off render-blocking path
- [x] **C2** `tenant_app.html` — QRCode.js lazy via `ensureQRCode()` IIFE; SRI hash preserved; payment functions made async
- [x] **D1** `tenant_app.html`, `theme-toggle.js` — `body.night-mode` 107 lines → `html[data-theme="dark"]` 22 lines; legacy localStorage key migrated at parse time
- [x] **D2** `dashboard-extra.js`, `dashboard.html` — 17 inline style patterns → `dx-*` CSS utility classes; dark mode overrides added for all classes

### Deferred
- ไม่มี — Phase 5 ทำครบทุกจุด

---

# Senior UI/UX Audit — P0 Color + a11y (2026-05-06)

## Context
Senior UI/UX วิเคราะห์โปรเจ็คหลัง Phase 5 และพบปัญหา P0 สองตัว:
1. **Color fragmentation** — มี 3 "green" hex คนละตัวอยู่ในโค้ดเดียวกัน (`#0f766e` brand, `#2d8653` Material, `#4caf50` Material lighter). Hardcoded hex ไม่ adapt ตาม dark mode token.
2. **a11y desert บน payment.html** — หน้าทำธุรกรรมเงินมี ARIA roles 0 ตัว, attributes 0 ตัว — ผิด WCAG 2.1 AA ชัด

User: "แก้ทันที"

## Step 1 — Color Consolidation (brand.css)
- [x] เพิ่ม legacy aliases ที่ `:root`: `--green` / `--green-dark` / `--green-light` / `--green-pale` → `var(--brand-primary*)`
  - **Why:** `.u-*` utilities ใช้ pattern `var(--green, #2d8653)` — fallback อยู่แล้ว เพิ่ม var ที่ `:root` = global fix + dark mode adapt อัตโนมัติ ผ่าน brand-primary-soft override (line 175)
  - **How to apply:** ทุกหน้าที่ใช้ class `.u-bill-paid-badge`, `.year-tab`, `.filter-btn.active`, `.u-icon-sel`, `.property-tab.active`, `.people-mgmt-tab.active` etc. จะเปลี่ยนเป็นสี teal ทันที
- [x] แทน hardcoded hex literals 8 จุด → brand tokens:
  - `.u-toast-center` → `var(--brand-primary-dark)`
  - `.u-btn-confirm-ok` + hover → `var(--brand-primary)` / `--brand-primary-dark`
  - `.u-notif-success` → `var(--brand-primary)`
  - `.payment-notification-item` → `var(--brand-primary-soft)` + `var(--brand-primary)`
  - `.u-bill-paid-badge` (incl. `:hover` filter approach) → tokens
  - `.u-msg-ok` → tokens
  - `.u-gamification-tab.active` → `var(--brand-primary)`
  - `.u-input-valid` border + shadow → tokens

## Step 2 — payment.html: alias local CSS vars
- [x] [payment.html:17-23](payment.html:17): local `:root --green` family ตอนนี้ `var(--brand-primary*)` แทน hex
- [x] [payment.html:7](payment.html:7) `<meta name="theme-color">` `#2d8653` → `#0f766e`
- [x] [payment.html:8](payment.html:8) SVG favicon `fill='%232d8653'` → `fill='%230f766e'`
  - **Why:** PWA color บนแถบ status mobile + favicon ตรง brand
  - **How to apply:** หลัง deploy บน Vercel แท็บเบราว์เซอร์ + เครื่อง iOS standalone จะเห็น teal แทน Material green

## Step 3 — payment.html: semantic HTML + ARIA
- [x] เพิ่ม skip-link (`<a class="skip-link" href="#main-content">`) + CSS `:focus` reveal
- [x] `<div class="app-header">` → `<header role="banner">`
- [x] `<div class="app-content">` → `<main id="main-content">`
- [x] `<div class="app-footer">` → `<div role="toolbar" aria-label>`
- [x] `<div class="footer">` → `<footer role="contentinfo">`
- [x] icon-only buttons ได้ `aria-label`: ย้อนกลับ, ติดตั้งแอป, ออกจากระบบ, รีเฟรชหน้า, แชร์หน้านี้
- [x] `<button>` ทั้งหมดเพิ่ม `type="button"` (ป้องกัน implicit submit)
- [x] `#billContent` → `role="status" aria-live="polite" aria-busy="true"`
- [x] `#paymentStatus` → `aria-live="polite" aria-labelledby`
- [x] `#successMessage` → `role="status" aria-live="polite"`
- [x] `#paymentHistory` → `aria-labelledby="historyCardTitle"`
- [x] `#uploadStatus` + `#alreadyUploadedStatus` → `role="status" aria-live="polite"`
- [x] error card body (room ID invalid) → `role="alert"` (สำหรับ AT แจ้งทันที)
  - **Why:** Screen reader users + keyboard users ตอนนี้ navigate ได้ถูก, รู้ว่าหน้ากำลัง load หรือ error
  - **How to apply:** WCAG 2.1 AA compliance + lighthouse a11y score น่าจะขึ้นเกิน 90

## Verification
- [x] `npm run verify:memory` → ALL GREEN (22 docs, 216 verifier rows, 0 fails)
- [x] `grep #2d8653|#1a5c38 payment.html` → 0 matches
- [x] `grep` ใน brand.css: hex ที่เหลือทั้งหมดเป็น **fallback defaults** ใน `var(--green, #2d8653)` pattern เท่านั้น (ไม่ active เพราะ `--green` define ที่ `:root` แล้ว)
- [ ] **Pending live verify:** push → vercel → check teal บน:
  - tenant_app `.u-icon-sel`, badges, year-tab
  - dashboard `.filter-btn.active`, `.view-btn.active`, gamification tab
  - payment.html keyboard tab order + Tab Esc Enter behavior + screen reader smoke test

## Files Changed
- `shared/brand.css` (+13/-9 lines: aliases + 8 hex→token swaps)
- `payment.html` (+22/-9 lines: meta + favicon + CSS aliases + skip-link CSS + semantic + 12 ARIA additions)

## Risk Assessment
- **Color change:** Visual diff คือ legacy `.u-*` classes เปลี่ยนจาก Material green (`#2d8653`) → brand teal (`#0f766e`) — เป็นสิ่งที่ตั้งใจให้เกิด (color consolidation)
- **a11y:** ไม่เปลี่ยน UX ปัจจุบัน — เพิ่ม metadata อย่างเดียว (no breaking change)
- **Dark mode:** ตอนนี้ `.u-*` ทุกตัว adapt ตาม theme เพราะ brand-primary-soft override อยู่ที่ line 175 ของ brand.css

# P1 — Dashboard Cold-Start Skeleton (2026-05-07)

## Context
Dashboard หน้า Dashboard (การเงิน tab) ใช้เวลา 900ms หลัง DOMContentLoaded ก่อนที่ `setYear('69')` จะ fire และ `initDashboardCharts()` populate KPI cards + charts — ระหว่างนั้น user เห็น "฿0" + canvas ว่างเปล่า

## Implementation

- [x] **`shared/brand.css`** — เพิ่ม `.gh-skeleton` utility + `@keyframes skeleton-shimmer`. Shimmer animation 1.4s ease-in-out, ใช้ `--surface-card` / `--border-subtle` tokens → light/dark mode ทั้งคู่ทำงาน
- [x] **`dashboard.html` CSS** — `#dash-cat-financial { position: relative }` + `#dash-cold-skeleton` absolute overlay (inset:0, z-index:5, background: var(--bg), pointer-events:none). Responsive grids for skeleton rows match real layout: 4-col→2-col→1-1→1, 2fr-1fr→1fr, 3-col→2-col→1-col
- [x] **`dashboard.html` HTML** — `<div id="dash-cold-skeleton" aria-hidden="true">` เป็น first child ของ `#dash-cat-financial`. มี 3 skeleton rows: 4 KPI cards + 2 chart areas + 3 insight cards — ใช้ `.kpi-card`/`.card`/`.insight-card` classes จริงเพื่อ margin/padding ตรงกับ layout จริง
- [x] **`shared/dashboard-home-live.js`** — 2 lines เพิ่มท้าย `initDashboardCharts()`: `const _skel = document.getElementById('dash-cold-skeleton'); if (_skel) _skel.remove();` — safe to call multiple times (null check prevents error on subsequent year-clicks)

## Commit
`02114d1` — feat(ux): dashboard cold-start skeleton — hide 900ms blank state with shimmer overlay

## Verification
- [x] git push → Vercel deploy triggered
- [ ] Live verify: เปิด dashboard บน https://the-green-haven.vercel.app → เห็น shimmer skeleton ตอน load → disappears เมื่อ KPI data arrive

---

# Maximum UI/UX Improvement Plan — Score 71 → 90+ (2026-05-07)

## Baseline audit (2026-05-07)

| Dimension | Score | Biggest gap |
|---|---:|---|
| Navigation & IA | 8/10 | — strong |
| Loading & Empty States | 8/10 | — strong |
| Color & Brand | 7.5/10 | gamification tab was broken (fixed this session) |
| Component Quality | 7.5/10 | — |
| Accessibility | 7/10 | emoji aria-hidden, autofill border |
| Typography & Hierarchy | 7/10 | chart axis 8px, table emoji columns |
| Layout & Spacing | 7/10 | — |
| Data Visualization | 6.5/10 | axis ticks unreadable, table hard to scan |
| Interaction States | 6/10 | hover not standard, disabled cursor missing |
| Responsive / Mobile | 6/10 | sidebar no collapse, tenant card crushes |
| **TOTAL** | **71/100** | |

**Why:** Responsive + Interaction are the lowest scores and highest user-impact — address them first.

---

## Phase A — Quick wins (71 → ~75, low-risk, 1 session)

Small isolated fixes, each in 1-2 files. Tackle these first — immediate visible improvement.

### A1 — Emoji icons: add `aria-hidden="true"` sitewide
- **Problem:** Emoji used as UI icons (💰 🗒️ 📊 etc.) are announced by screen readers as "money bag emoji"
- **Files:** `tenant_app.html`, `dashboard.html` — scan all `<span>` / raw emoji in nav + buttons + headings
- **Fix:** Add `aria-hidden="true"` to every emoji that is decorative (beside visible text). For icon-only emoji buttons, keep it visible but wrap in `<span aria-hidden="true">` + add `aria-label` on the `<button>`
- **Why:** WCAG 2.1 SC 1.1.1 — non-text content needs text alternative or hidden decoration
- **Verification:** VoiceOver / NVDA smoke test — nav items read as "ภาพรวม" not "house emoji ภาพรวม"

### A2 — Autofill red border bug on login
- **Problem:** Browser autofill triggers `:invalid` CSS on inputs that ARE valid — shows red border on correct pre-filled email/password
- **Files:** `login.html`
- **Fix:** Change validation CSS from `:invalid` pseudo-class to `.is-invalid` class set only on explicit JS validation failure. Remove `required` attribute (or use `novalidate` on `<form>`) to prevent browser-native invalid state from firing before user submits
- **Why:** Red border on pre-filled valid inputs destroys trust / looks broken on first sight

### A3 — Disabled state cursor missing
- **Problem:** Disabled buttons show pointer cursor (or default) — not `cursor: not-allowed`
- **Files:** `shared/brand.css`, `shared/components.css`
- **Fix:** Add to `shared/brand.css`: `button:disabled, [aria-disabled="true"] { cursor: not-allowed; opacity: .5; }`
- **Why:** Core interactive affordance — user needs to understand why click does nothing

### A4 — Chart axis tick font floor
- **Problem:** Chart.js axis labels render at 8-9px — unreadable on mobile
- **Files:** `shared/dashboard-home-live.js` (Chart.js config), `shared/dashboard-extra.js`
- **Fix:** In every `Chart()` constructor config, add `ticks: { font: { size: 11 } }` to both `xAxis` and `yAxis` scales. 11px is the minimum readable size per WCAG contrast guidance
- **Why:** Current 8px axis labels fail readability at arm's length (typical tablet use by admin)

---

## Phase B — Mobile-first overhaul (75 → ~83, highest ROI, 2 sessions)

Dashboard sidebar and tenant card are the two biggest mobile UX failures. These are the highest-leverage fixes.

### B1 — Dashboard sidebar: collapsible on mobile (hamburger toggle)
- **Problem:** Sidebar is `position: fixed; width: 220px` always visible — on ≤768px it eats 220px of 390px screen, leaving 170px for content. There is no hamburger button. Admin cannot use dashboard on phone
- **Files:** `dashboard.html` (CSS + HTML), `shared/dashboard-main.js`
- **Fix:**
  - Add `<button id="sidebar-toggle" class="gh-btn gh-btn--icon" aria-label="เปิด/ปิดเมนู" aria-expanded="false" aria-controls="sidebar">` in the top bar (visible only at ≤768px via `display:none` → `display:flex`)
  - At `@media (max-width: 768px)`: sidebar default `transform: translateX(-100%)`, when `.sidebar-open` class on `<body>`: `transform: translateX(0)`. Backdrop overlay (similar to modal-a11y-bridge pattern already in codebase)
  - `dashboard-main.js`: toggle `body.classList.toggle('sidebar-open')` + update `aria-expanded` + close on nav-item click + close on backdrop click
- **Why:** Admin walks the property with phone/tablet — dashboard must work on mobile
- **Verification:** Chrome DevTools 390px → sidebar hidden → hamburger appears → tap → sidebar slides in → tap nav item → sidebar closes

### B2 — Tenant card action grid: responsive 2×2 → single-column stack
- **Problem:** `tenant_app.html` action buttons render as 2×2 grid on profile/home — at 390px (iPhone 14) the buttons crush to ~175px wide, text truncates
- **Files:** `tenant_app.html`
- **Fix:** Add `@media (max-width: 480px)` → action grid `grid-template-columns: 1fr` (single column). Ensure each button has `min-height: 44px` (already in checklist for A11y, confirms here)
- **Why:** Primary CTA grid must be tap-able. Crushed buttons = abandonment

### B3 — Horizontal tab overflow: add scroll instead of wrap/overflow-hidden
- **Problem:** Dashboard category tabs (Financial / Operations / People / etc.) and tenant_app bottom row tabs wrap or get clipped on narrow screens
- **Files:** `dashboard.html` (tab row CSS), `tenant_app.html` (tab bar CSS)
- **Fix:** On tab row containers: `display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;` + `::-webkit-scrollbar { display: none; }`. Prevents wrap or clipping — user can scroll horizontally
- **Why:** All tabs must be reachable without layout breakage

### B4 — Tax-filing sidebar: hamburger collapse (already planned, verify shipped)
- **Status:** Was shipped in Phase 1 Step 7. Verify it still works after D1 dark mode unification
- **Files:** `tax-filing.html`
- **Verification:** mobile emulation → hamburger visible → sidebar slides

---

## Phase C — Data visualization polish (83 → ~87, 1-2 sessions)

### C1 — 12-month bill table: replace emoji column headers with text + icon
- **Problem:** Table columns using emoji (💡 🚰 🔥) are hard to scan at a glance and screen reader announces emoji name
- **Files:** `tenant_app.html` (bill history table), `dashboard.html` (bill tables)
- **Fix:** Replace raw emoji headers with `<abbr title="ไฟฟ้า">⚡</abbr>` pattern + `aria-hidden="true"` on the emoji span + visible text abbreviation. OR replace with short Thai text labels (ไฟ / น้ำ / ค่าเช่า)
- **Why:** Improves scannability and a11y simultaneously

### C2 — Dashboard charts: consistent color palette + chart legend
- **Problem:** Charts use ad-hoc colors that don't match the brand token system. No chart-level legend explaining what each dataset represents (relies on axis labels alone)
- **Files:** `shared/dashboard-home-live.js`, `shared/dashboard-extra.js`
- **Fix:** Define `const CHART_PALETTE = [getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(), ...]` and apply consistently. Enable `plugins.legend.display: true` on charts that have multiple datasets
- **Why:** Consistent brand color in charts + legend = professional finish and interpretability

### C3 — Insight cards: add micro-sparkline trend indicators
- **Problem:** KPI cards show a single number with no trend direction. Admin can't tell if occupancy rate is going up or down without switching tabs
- **Files:** `shared/dashboard-home-live.js` (after data loads, post-skeleton removal)
- **Fix:** After Firebase data loads, compute last-month vs this-month delta. Add a `<span class="trend-up">▲ 2%</span>` or `<span class="trend-down">▼ 3%</span>` under each KPI number. CSS colors: `var(--ok)` for up, `var(--danger)` for down
- **Why:** Trend is the single most useful addition to a KPI card — zero-cost to compute once data is loaded

---

## Phase D — Interaction states (87 → ~91, 1 session)

### D1 — Audit and standardize hover states
- **Problem:** Some buttons have hover (`.gh-btn`), but raw `<button>` elements in tenant_app / dashboard don't consistently show hover feedback. Some cards have hover, some don't
- **Files:** `shared/brand.css`, `shared/components.css`
- **Fix:** 
  - Add a single rule: `button:not(:disabled):hover { filter: brightness(0.92); }` as a global fallback for any button not already in the `gh-btn` system
  - Card hover: `.kpi-card:hover, .insight-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,.1)); transition: transform .15s, box-shadow .15s; }`
- **Why:** Consistent hover feedback across the app (admin + tenant) signals that elements are interactive

### D2 — Transition timing: unify to 150ms–200ms
- **Problem:** Some components use `transition: .3s`, others use `0.15s`, others `0.4s`. Inconsistent timing feels jarring on fast actions
- **Files:** `shared/brand.css` — add CSS custom properties for timing
- **Fix:** Add to `:root`: `--duration-fast: 150ms; --duration-normal: 200ms; --ease-default: cubic-bezier(0.4,0,0.2,1);`. Replace scattered `transition: X` values with token-based `transition: var(--duration-fast) var(--ease-default)`
- **Why:** Consistent motion timing = polished, deliberate feel. Single change that touches everything

### D3 — Focus-visible ring: verify all surfaces work
- **Problem:** Focus ring was added in Phase 1 Step 2 but some dynamic elements created by JS (`modal.js` injected content, `GhTour` spotlight) may bypass the rule
- **Files:** `shared/brand.css` (existing rule), `shared/modal.js`, `shared/onboarding-tour.js`
- **Fix:** In devtools, tab through every modal and tour step — confirm blue ring appears on all focusable elements. Fix any that use `outline: none` without a replacement
- **Why:** Keyboard accessibility baseline — must work for every interactive element

---

## Phase E — Typography & hierarchy (91 → ~93, 1 session)

### E1 — Font size floor: enforce 12px minimum everywhere
- **Problem:** Some labels, table cells, and metadata text drop to 10-11px (especially at breakpoints in dashboard). Below 12px is generally inaccessible
- **Files:** `dashboard.html` (CSS), `shared/brand.css`
- **Fix:** Audit all `font-size` rules below 12px. Replace with `clamp(12px, ...)` or set `min-font-size: 12px`. Pay special attention to `@media` blocks that reduce font size at small breakpoints
- **Why:** WCAG SC 1.4.4 Resize Text — content must remain readable; 10px fails at arm's length

### E2 — Heading hierarchy: ensure h1 > h2 > h3 on every page
- **Problem:** Some pages use `<div class="section-title">` instead of actual `<h2>` — screen reader can't navigate by heading
- **Files:** `dashboard.html`, `tenant_app.html` (scan for `class="section-title|card-title|tab-title"` patterns)
- **Fix:** Where a div functions as a section heading, change to the appropriate `<h2>` / `<h3>` element. Add `class="sr-only"` if visual design doesn't want a visible heading
- **Why:** Screen reader users navigate by headings — correct hierarchy is essential

### E3 — Line height for Thai text: set 1.6 minimum
- **Problem:** Thai script has ascenders and descenders that collide at `line-height: 1.4` (the CSS default). Several Thai paragraphs feel cramped
- **Files:** `shared/brand.css`
- **Fix:** Add to base styles: `p, li, .gh-card, label, .info-text { line-height: 1.6; }`. Keep headings at 1.2-1.3 (correct for display sizes)
- **Why:** IBM Plex Sans Thai Looped is already specified — Thai text needs breathing room

---

## Phase F — Visual elevation (93 → ~95, 1-2 sessions)

### F1 — Sidebar depth: add subtle gradient + dividers
- **Problem:** Dashboard sidebar is flat background with no depth cues — feels like a prototype, not a finished product
- **Files:** `dashboard.html` (CSS for `#sidebar`, `.nav-section`)
- **Fix:** Sidebar background: `background: linear-gradient(180deg, var(--surface-card) 0%, var(--bg) 100%)`. Add `border-right: 1px solid var(--border-subtle)`. Section dividers: `<hr class="nav-divider">` with 1px token border between nav groups
- **Why:** Depth and definition without adding weight — Muji philosophy (functional detail)

### F2 — Avatar initials for tenants without photos
- **Problem:** Tenant cards and the LIFF profile fallback show a generic gray avatar `<div>` with no content — looks unfinished
- **Files:** `tenant_app.html`, `shared/dashboard-tenant-modal.js`
- **Fix:** When no photo URL, render initials `<div class="gh-avatar-initials" aria-hidden="true">สม</div>` (first 2 chars of name). CSS: `border-radius: 50%; background: var(--brand-primary-soft); color: var(--brand-primary); font-weight: 600; font-size: 1rem; display: flex; align-items: center; justify-content: center;`
- **Why:** Initials avatars are a professional pattern (used in Gmail, Slack, Linear). Eliminates the "not yet designed" feeling

### F3 — Card elevation system: 3 tiers
- **Problem:** `.card` / `.kpi-card` / `.insight-card` all have the same box-shadow. No elevation hierarchy — everything feels flat
- **Files:** `shared/brand.css`, `shared/components.css`
- **Fix:** Define 3 shadow tokens: `--shadow-sm: 0 1px 3px rgba(0,0,0,.08)`, `--shadow-md: 0 4px 12px rgba(0,0,0,.1)`, `--shadow-lg: 0 8px 24px rgba(0,0,0,.12)`. Apply: KPI cards → `sm`, modals → `md`, overlays/dropdowns → `lg`
- **Why:** Shadow hierarchy communicates z-depth and information priority — core design principle

### F4 — Page background texture: subtle noise on surface-card
- **Problem:** Page backgrounds are solid white / solid dark — no texture or depth. Muji aesthetic allows subtle material quality
- **Files:** `shared/brand.css`
- **Fix:** Add to `.gh-card, .kpi-card` (light mode only): `background-image: url("data:image/svg+xml,...")` with 1-2% opacity grain (inline SVG noise filter). Dark mode: omit (dark surfaces already have depth through contrast)
- **Why:** Micro-texture adds material quality without changing the visual language. Subtle enough to be subconscious

---

## Execution order and score projection

| Phase | Key deliverable | Sessions | Score after |
|---|---|---:|---:|
| A — Quick wins | emoji a11y, autofill fix, disabled cursor, chart ticks | 1 | ~75 |
| B — Mobile overhaul | sidebar hamburger, card responsive, tab scroll | 2 | ~83 |
| C — Data viz | table headers, chart palette, KPI trends | 1-2 | ~87 |
| D — Interaction | hover standard, transition tokens, focus-visible audit | 1 | ~91 |
| E — Typography | font floor, heading hierarchy, line-height Thai | 1 | ~93 |
| F — Visual elevation | sidebar depth, initials avatars, shadow system, texture | 1-2 | ~95 |

**Total: ~6-9 sessions to go from 71 → 95.**

## What NOT to do (scope boundaries)

- ❌ Don't replace Chart.js with a different library — migration cost exceeds benefit
- ❌ Don't redesign page layout/navigation — IA is already strong (8/10)
- ❌ Don't add illustration or illustration-heavy empty states — already have GhEmptyState system
- ❌ Don't touch payment.html UI — legacy SecurityUtils session, separate concern
- ❌ Don't add new fonts — IBM Plex Sans Thai Looped is already correct

## Phase A — SHIPPED `e7bd82b` (2026-05-07) ✅

- [x] A1 — emoji aria-hidden: 13/13 sidebar icons, 4/4 KPI divs, tab buttons, login h1/role btns/pw-toggle
- [x] A2 — autofill red-border: `:not(:-webkit-autofill)` guard confirmed in live CSS
- [x] A3 — disabled cursor: `not-allowed` confirmed on live disabled button
- [x] A4 — chart axis tick font floor 11px: `size:8→11` + `size:9→11` in `dashboard-home-live.js`

---

## Phase B — SHIPPED `5eb3cfd` (2026-05-07) ✅

- [x] B1 — Sidebar collapse breakpoint 600→768px: CSS `@media (max-width:768px)` + JS guard updated in `dashboard-main.js`
- [x] B2 — Action grid 1-col at ≤480px: `@media (max-width:480px) { .action-buttons { grid-template-columns:1fr } }` in `tenant_app.html`
- [x] B3 — Year-tabs overflow scroll: `overflow-x:auto; flex-wrap:nowrap; scrollbar-width:none` — confirmed live

---

## Phase C — Data visualization polish — SHIPPED `5eb3cfd` + `ff9ee35` (2026-05-07) ✅

- [x] C1 — Bill table emoji aria-hidden in JS template string (`tenant_app.html`)
- [x] C2 — Chart palette: all `#2d8653` / `rgba(45,134,83)` → `#0f766e` / `rgba(15,118,110)` brand teal in `dashboard-home-live.js` (charts + inline text colors)
- [x] C3 — KPI monthly-sub trend: `totalsTrend = trendArrow(totals)` appended after insight-card trends — confirmed `kpi-monthly-sub` updated with `⬆️/⬇️ จากเดือนก่อน`

---

## Phase D — SHIPPED `06bffc7` (2026-05-07) ✅

- [x] D1 — Global button hover: `button:not(:disabled):hover { filter: brightness(0.92) }` in `shared/brand.css`
- [x] D1 — Card hover lift: `.kpi-card/.insight-card/.gh-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md) }` + transition
- [x] D2 — Motion timing tokens: `--duration-fast:150ms`, `--duration-normal`, `--ease-default:cubic-bezier(0.4,0,0.2,1)` added to `:root`
- [x] D3 — `outline:none` audit: all 10 usages paired with visible border+shadow replacement — no bare removals found

---

## Phase E — SHIPPED `f3593cd` (2026-05-07) ✅

- [x] E1 — Font-size floor 12px: 14 CSS class rules in `dashboard.html` raised to `.75rem`; `.u-img-thumb-label` in `brand.css` raised to `.75rem`. Inline styles and media-query responsive reductions left (high blast radius in dense admin views)
- [x] E2 — Heading roles: `role="heading" aria-level="2"` on all 13 `div.section-title` in dashboard + 20 in tenant_app; `aria-level="3"` on 21 `div.card-title` + 3 `div.form-section-title` in dashboard. `emergency-section-header` skipped (onclick accordion — already role=button semantic)
- [x] E3 — Thai line-height: `--leading-normal` 1.55→1.6; `p, li, label` share the token in `brand.css`

---

## Phase F — SHIPPED `6f495f8` (2026-05-07) ✅

- [x] F1 — Sidebar depth: `border-right: 1px solid rgba(255,255,255,.12)` added to `.sidebar`; `.sidebar-group-title` 0.7rem→0.75rem (gradient + group dividers already present)
- [x] F2 — `.gh-avatar-initials` CSS class in `brand.css` — `50% radius, brand-primary-soft bg, brand-primary text, semibold` — ready to apply wherever initials avatars are needed
- [x] F3 — 3-tier shadow: `--shadow` (tier-1 cards), `--shadow-hover` (tier-2 lift), `--shadow-overlay: 0 12px 40px rgba(0,0,0,.22)` (tier-3 modals). `.pay-modal` + `#notifDropdown` migrated to token
- [x] F4 — Card micro-texture: `radial-gradient(ellipse at 12% 12%, rgba(15,118,110,.04) 0%, transparent 55%)` on `.kpi-card/.insight-card/.gh-card`; `background-image:none` in dark mode

---

# Community Member / Player Role (ผู้เล่น) — plan 2026-05-07

## Goal
ex-tenant (สัญญาหมด) → admin กด "🎮 ย้ายเป็น Community Member" → ยังอยู่ใน LINE → ใช้ community / wellness / gamification / marketplace ได้ → billing / meter / maintenance / housekeeping ซ่อน → ย้อนกลับได้ (new booking → convert via 4-pass cascade เดิม)

## Open questions answered (from session 2026-05-07)
- Q1: Sign-up path = admin-only manual transition เท่านั้น (ไม่มี external sign-up ตอนนี้)
- Q2: Open features: community feed ✅ | wellness ✅ | daily-bonus ✅ | marketplace ✅ | gamification/rewards ✅ | billing ❌ | meter ❌ | maintenance ❌ | housekeeping ❌ | complaints ❌
- Q3: Redemption ✅ — ex-tenant แลกได้

## Architecture

```
tenant doc (เช่าอยู่)
    ↓ admin กด "🎮 ย้ายเป็น Community Member"
[A] archive contract (archiveTenantOnMoveOut batch logic เดิม)
[B] upsert people/{tenantId}  { currentLease: null, gamification: {...} }
[C] Firebase Auth claim → role: 'player'  (revoke building/room claims)
    ↓
person stays in LINE → community-only view in tenant_app
```

Reversibility (เมื่อกลับมาเช่าใหม่):
```
booking → admin "Convert to Tenant" → convertBookingToTenant 4-pass + people/ lookup
    ↓ restore gamification from people/{tenantId}
    ↓ update people/{tenantId}.currentLease = {building, roomId, contractId}
    ↓ revoke role:'player' → issue tenant claims
```

## Task breakdown

### A — Firestore collection `people/{tenantId}` ✅
- [x] `firestore.rules`: `match /people/{tenantId}` — owner read (linkedAuthUid), admin write

### B — CF `transitionToPlayer` (NEW) ✅
- [x] `functions/transitionToPlayer.js` — archive batch + people/ upsert + role:'player' claim + liffUsers.role update
- [x] Registered in `functions/index.js`

### C — Admin UI button ✅
- [x] `dashboard.html`: "🎮 ย้ายเป็น Community" button (teal outline, next to 📦 Archive)
- [x] `shared/dashboard-tenant-modal.js`: `transitionToPlayer()` — ghConfirm + CF call + toast + refresh

### D — `liffSignIn` CF update ✅
- [x] `functions/liffSignIn.js`: if `liffData.role === 'player'` → mint token `{role:'player'}` → return `{customToken, role:'player'}`

### E — `tenant_app.html` community view ✅
- [x] `_applyPlayerMode()` — hides "บิล" nav button, wraps `showPage()` to block room-specific pages
- [x] Fast-path: `tr.claims.role === 'player'` → player mode + dispatch liffLinked
- [x] After sign-in: `data.role === 'player'` → player mode + dispatch liffLinked

### F — `convertBookingToTenant` — restore from `people/` ✅
- [x] Pass 5: query `people/` by `linkedAuthUid + currentLease==null` → restore gamification, `restoredFrom: 'people_player'`
- [x] Post-convert: update `people/{tenantId}.currentLease`, revoke `role:'player'` claim, clear `liffUsers.role`
- [x] `dashboard-bookings.js` toast: `people_player` → "Community Member กลับมาเช่า"

## Execution order
1. A (Firestore rules) → B (CF) → C (admin UI) — admin side; verify via Firestore console + dashboard
2. D (liffSignIn) → E (tenant_app) — LIFF side; push to Vercel to test
3. F (convertBookingToTenant) — reversibility; test by transitioning → re-booking

## Out of scope (this phase)
- ❌ External sign-up flow (LINE LIFF for non-tenants to self-register)
- ❌ Full `people/` migration for existing active tenants — they stay in `tenants/list/{roomId}`
- ❌ Community-specific leaderboard or features beyond existing gamification UI
- ❌ Automatic transition on lease expiry — admin manual only
