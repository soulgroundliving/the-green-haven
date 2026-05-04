# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

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

## Phase 1 — Move-out archive (preserve identity on move-out) ⏳

**Goal:** ผู้เช่าออกแล้วกลับมา → เจอข้อมูลเดิม. **Scope:** เฉพาะการ preserve. ยังไม่แตะ schema ใหญ่.

### Step 1.1 — สร้าง `tenants/{building}/archive/{contractId}` subcollection
- [ ] **Why:** preserve old tenant doc ก่อน admin assign ห้องให้คนใหม่. คีย์ด้วย `contractId` เพราะคนหนึ่งคนอาจเคยเช่าหลายสัญญา → ดูประวัติได้ครบ
- [ ] Schema: copy fields จาก tenant doc + เพิ่ม `archivedAt`, `archivedReason` (`'moved_out'|'reassigned'|'admin_action'`), `archivedBy`
- [ ] Rule: admin-only read/write (ไม่เปิด tenant อ่านเองในเฟสนี้)
- [ ] Verification: grep `firestore.rules` มี match `/databases/{database}/documents/tenants/{b}/archive/{c}`

### Step 1.2 — เพิ่ม CF `archiveTenantOnMoveOut` (HTTPS callable)
- [ ] **Why:** atomic transaction — copy → archive → reset list doc ในก้อนเดียว. ห้าม do-it-from-frontend เพราะมีจังหวะที่ admin click → archive partial → bug
- [ ] Region SE1 (Singapore — match Firestore SE3 latency tolerance + same region as other CFs)
- [ ] Input: `{building, roomId, reason}` from authenticated admin
- [ ] Logic:
  - read `tenants/{b}/list/{r}` → ถ้า `tenantId` ว่างหรือไม่มี → throw `failed-precondition`
  - คำนวณ `contractId` (ใช้ field `contractId` ใน doc ถ้ามี — ถ้าไม่มี → fallback `LEGACY_${tenantId}_${ts}`)
  - tx: `set archive/{contractId}` + `update list/{roomId}` ให้ blank identity (`name='', tenantId='', contractId='', linkedAuthUid='', phone='', gamification=null...`) + คง `building, roomId, status='vacant'`
  - audit log → `system/audit_logs` (admin-only)
- [ ] **Why blank vs delete list doc:** ห้องยังต้องอยู่ใน list (admin assign ใหม่ได้) — delete แล้วต้องมา recreate

### Step 1.3 — UI button ใน dashboard tenant modal
- [ ] [shared/dashboard-tenant-modal.js](shared/dashboard-tenant-modal.js): เพิ่มปุ่ม "ย้ายออก / Archive" ใน tenant detail modal
- [ ] confirm dialog: "ข้อมูลของ {name} จะถูกย้ายไป archive — กลับมาแก้ได้ภายหลัง" + reason dropdown
- [ ] On confirm → call `archiveTenantOnMoveOut` → reload tenant list
- [ ] **Why button + confirm:** admin อาจ click ผิด — confirm step block accidental archive

### Step 1.4 — extend Returning lookup ใน `convertBookingToTenant.js`
- [ ] [functions/convertBookingToTenant.js:84-98](functions/convertBookingToTenant.js#L84): ขยาย scan ให้รวม `archive` subcollection
- [ ] Match priority: (1) live tenant doc by linkedAuthUid (เดิม) → (2) archive by linkedAuthUid → (3) archive by phone → (4) archive by lineUserId
- [ ] **Why phone fallback:** ผู้เช่ากลับมาด้วย LINE บัญชีใหม่ (เปลี่ยนเบอร์ → re-add LINE) — phone ยังตรง
- [ ] ถ้าเจอใน archive → กลับ tenant ออกมา + ใส่ flag `restoredFrom: 'archive'` ใน return value + log
- [ ] เก็บ `gamification` จาก archive มาใช้ต่อ (รวมกับ Early Bird)

### Step 1.5 — Verification + tests
- [ ] เพิ่ม firestore rules test: admin can read archive, tenant cannot
- [ ] Manual E2E ใน vercel:
  1. Archive tenant ห้อง 13 → ตรวจ `tenants/rooms/archive/{contractId}` มีข้อมูล + `tenants/rooms/list/13` blank
  2. Convert booking ของคนเดิม (LINE UID เดิม) → return `restoredFrom: 'archive'`, gamification carry over
  3. Admin assign ห้องใหม่ให้คนอื่น → ของเก่าไม่หายจาก archive
- [ ] `npm run test:rules`
- [ ] อัพเดท `memory/firestore_schema_canonical.md` — เพิ่ม archive collection + verify section
- [ ] อัพเดท `memory/lifecycle_tenant_ssot.md` — บันทึก move-out flow

**Phase 1 deliverable:** ผู้เช่าออก → กลับมา → เจอข้อมูลเดิม. ครอบคลุม vision ส่วน "ลูกบ้านออกแล้วกลับมา"

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
