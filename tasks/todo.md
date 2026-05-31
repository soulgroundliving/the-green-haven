# 9-Dimension Audit Remediation Plan
**สร้าง:** 2026-05-31 · **Audit score:** 3.12 / 4.0 (เทียบ 3.29 ครั้งก่อน)
**Source:** 9-agent parallel audit — Architecture / Security / Code Quality / Testing / DevOps / Docs / Performance / UX / Tech Debt

> Marketplace sprint plan ย้ายไป [tasks/marketplace-sprints.md](tasks/marketplace-sprints.md) (active: S0.2 คือ next step)
>
> **รอ user approval ก่อน execute** — ตาม CLAUDE.md §1 Plan-First Protocol

---

## สรุปคะแนนและเป้าหมาย

| มิติ | ปัจจุบัน | เป้าหมาย | Gap |
|------|---------|---------|-----|
| 🏛️ Architecture | 3.1 | 3.4 | window.X ceiling / dashboard god file |
| 🔐 Security | 3.2 | 3.8 | 2 XSS sites, 1 dead auth CF |
| 💎 Code Quality | 3.1 | 3.5 | oversized files, prompt(), console.info |
| 🧪 Testing | 3.1 | 3.5 | 0% frontend coverage |
| 🚀 DevOps | 3.2 | 3.7 | staging ไม่ wire, CSP CI gap |
| 📚 Docs & Memory | 3.8 | 4.0 | stale 1 claim, minor doc gaps |
| ⚡ Performance | 2.7 | 3.3 | unbounded queries, xlsx eager, no cache |
| 🎨 UX/UI | 3.3 | 3.7 | broken skip link, contrast, aria-current |
| 🧹 Tech Debt | 2.6 | 3.2 | 21 oversized modules, dead code, duplicates |

---

## P0 — ต้องแก้ก่อน deploy ครั้งถัดไป

### 🔐 Security

- [x] **[SEC-XSS-1] Escape Firestore data ใน wellness content renderer**
  - **Why:** `a.category`, `a.icon`, `a.readtime`, `a.reward` inject เข้า innerHTML โดยตรง — stored XSS สำหรับ admin ที่อาจถูก compromise
  - **ไฟล์:** `shared/dashboard-wellness-content.js:436,440,450`
  - **Fix:** wrap แต่ละ field ด้วย `_escWC(value)` ก่อน template literal
  - **Verify:** `grep -n "a\.category\|a\.icon\|a\.reward\|a\.readtime" shared/dashboard-wellness-content.js` — ทุก hit ต้องผ่าน escape

- [x] **[SEC-XSS-2] Escape CF response ใน admin-ops panel**
  - **Why:** `json.email`, `json.uid`, `json.error` จาก `setAdminClaim` CF response → innerHTML โดยตรง
  - **ไฟล์:** `shared/dashboard-admin-ops.js:74,77,108,110`
  - **Fix:** เพิ่ม local `function _esc(s){ return String(s).replace(...) }` + wrap ทุก interpolation
  - **Verify:** `grep -n "json\." shared/dashboard-admin-ops.js | grep innerHTML`

- [x] **[SEC-CLEANUP-CF] ตรวจสอบและลบ/gate cleanup CFs**
  - **Why:** `cleanupRoomData.js` + `cleanupRealtimeDB.js` auth ด้วย `req.query.token` (URL token = logs/history leak)
  - **ไฟล์:** `functions/cleanupRoomData.js:50`, `functions/cleanupRealtimeDB.js:20,93`
  - **Fix:** ยืนยัน 4 exports (`cleanupRoomData`, `analyzeRoomData`, `verifyMigrationComplete`, `deleteRealtimeDBData`) ไม่ได้อยู่ใน `functions/index.js` → ถ้าไม่ได้ deploy ให้ลบไฟล์ทิ้ง
  - **Verify:** `grep -n "cleanupRoomData\|analyzeRoomData\|verifyMigrationComplete\|deleteRealtimeDBData" functions/index.js` → ต้อง 0 hits

---

### 🎨 UX/Accessibility

- [x] **[A11Y-MAIN] เพิ่ม `<main id="main-content">` ใน tenant_app.html**
  - **Why:** Skip link บรรทัด 2400 ชี้ไป `#main-content` แต่ element ไม่มีอยู่ → WCAG 2.4.1 (A) ล้มเหลว; ไม่มี landmark เลย (WCAG 1.3.1)
  - **ไฟล์:** `tenant_app.html` บรรทัด ~2420 (หลัง `#app-loading-splash`)
  - **Fix:** เพิ่ม `<main id="main-content">` ครอบ `.page-container` div และปิด `</main>` ก่อน bottom-nav
  - **Verify:** `grep -n "main-content\|<main" tenant_app.html` → ต้องมี `<main id="main-content">`

- [x] **[A11Y-ARIA] เพิ่ม `aria-current="page"` ใน admin sidebar**
  - **Why:** `showPage()` toggle แค่ `.active` class — screen reader ไม่รู้ว่า page ไหนกำลัง active (WCAG 4.1.2)
  - **ไฟล์:** `shared/dashboard-main.js:14-24` (`_showPageImpl` / `showPage`)
  - **Fix:** ใน `showPage()` — clear `aria-current` บน sidebar items ทั้งหมด แล้ว set `btn.setAttribute('aria-current','page')` บน active item
  - **Verify:** Chrome MCP → inspect sidebar button เมื่อเปลี่ยน page → `aria-current="page"` ต้องเปลี่ยนตาม

---

## P1 — Sprint ถัดไป (เน้น Performance + Code Quality)

### ⚡ Performance — Unbounded Queries

- [x] **[PERF-Q1] ปิด 7 unbounded Firestore queries ที่เหลือ**
  - **Why:** ขยายตามจำนวน user/ข้อมูล — Firestore billing + latency โตไม่มีเพดาน
  - **ไฟล์และ fix:**
    - `shared/dashboard-insights.js:284-285` — add `limit(500)` ให้ `wellnessQuizPassed` + `contractQuizPassed` collectionGroup
    - `shared/dashboard-insights.js:1209` — add `limit(500)` ให้ `complaints` getDocs
    - `shared/dashboard-insights.js:1215` — แทน `getDocs(collection(db,'liffUsers'))` ด้วย `getCountFromServer()`
    - `shared/dashboard-insights.js:1481` — add `where('building','==',selectedBuilding)` + `limit(500)` ให้ `meter_data`
    - `shared/dashboard-domain-stores.js:581` — add `orderBy('createdAt','desc'), limit(200)` ให้ complaints onSnapshot
    - `shared/dashboard-wellness-content.js:314` — add `limit(100)` ให้ `wellness_articles` subscription
    - `shared/lease-config.js:118` — add `where('status','==','active'), limit(100)` ให้ lease list
  - **Verify:** `npm run audit:size` + grep แต่ละไฟล์ยืนยัน `.limit(` อยู่ติดกัน

- [x] **[PERF-XLSX] Lazy-load xlsx.full.min.js (~300KB gzip)**
  - **Why:** โหลดทุก admin session แม้ไม่ได้ import ไฟล์ — เสีย 300KB เปล่าสำหรับทุก page ที่ไม่ใช่ meter/billing import
  - **ไฟล์:** `dashboard.html:75`, `shared/dashboard-meter-import.js`, `shared/dashboard-bills.js`
  - **Fix:** ลบ `<script defer src="...xlsx...">` จาก HTML → dynamic `import('...xlsx...')` ใน change handler ของ `#importFileInput` และ `#billingFileInput` (pattern เดียวกับ jsPDF ที่ทำแล้ว)
  - **Verify:** Chrome DevTools Network → โหลด dashboard → xlsx ไม่ควรอยู่ใน initial requests

- [x] **[PERF-CACHE] Enable Firestore persistent local cache**
  - **Why:** `tenant_app.html` เปิด/ปิดบ่อยผ่าน LIFF — persistent cache ทำให้ bill/room data โหลดจาก IndexedDB ก่อน revalidate
  - **ไฟล์:** Firebase init ใน `shared/tenant-liff-auth.js` หรือ `shared/firebase-init.js`
  - **Fix:** แทน `getFirestore(app)` ด้วย `initializeFirestore(app, { localCache: persistentLocalCache() })`
  - **Verify:** Chrome → Application → IndexedDB → `firebaseLocalStorageDb` ปรากฏหลัง first visit

- [x] **[PERF-N1] แก้ N+1 deposit check ใน requests-admin**
  - **Why:** `getDoc` per tenant ใน loop สำหรับ building ที่มี 50 ห้อง = 50 round-trips
  - **ไฟล์:** `shared/dashboard-requests-admin.js:1438-1445`
  - **Fix:** batch-fetch ทุก `deposits` docs ของ building ใน getDocs เดียว → build Map → `Map.has(key)` แทน
  - **Verify:** Network panel → `getDocs` 1 call แทน N calls

- [x] **[PERF-LEAK] แก้ interval leak ใน facility-booking-ui.js**
  - **Why:** `setInterval(_writePresence, 60000)` ที่บรรทัด 344 ไม่มี `clearInterval` เลย — fire ทุก 60s ตลอด session
  - **ไฟล์:** `shared/facility-booking-ui.js:344,347`
  - **Fix:** `const _presenceInterval = setInterval(...)` → เพิ่ม `pagehide`/`visibilitychange` handler ที่ call `clearInterval(_presenceInterval)` และ `document.removeEventListener(...)` เมื่อ hidden
  - **Verify:** console → เปิด facility booking → navigate away → ไม่ควรมี presence write ใหม่

---

### 💎 Code Quality

- [x] **[CQ-PROMPT] แทน `prompt()` 3 จุดด้วย `window.ghPrompt` (added to modal.js)**
  - **Why:** `prompt()` block event loop, style ไม่ได้, §7-Q ระบุชัดว่าต้องแทน
  - **ไฟล์:** `shared/dashboard-main.js:427` (evidence input), `shared/dashboard-main.js:485` (reject reason), `shared/dashboard-tenant-modal.js:992` (type label)
  - **Fix:** แทนด้วย `window.ghConfirm(message, { input: true })` pattern ที่ไฟล์เดียวกันใช้อยู่แล้ว (ดู line 467, 506)
  - **Verify:** `grep -rn "= prompt(" shared/ dashboard.html` → 0 hits

- [x] **[CQ-CONSOLE] ลบ console.info 43 calls ใน tenant-system.js**
  - **Why:** debug logging ที่ fire ทุก tenant operation — banned by project standards
  - **ไฟล์:** `shared/tenant-system.js` (239 instances)
  - **Fix:** `sed`-style bulk remove all `console.info(...)` calls in the file
  - **Verify:** `grep -c "console\.info" shared/tenant-system.js` → 0

- [x] **[CQ-MUTATE] แก้ mutation pattern ใน TenantConfigManager**
  - **Why:** `delete tenants[tenantId]` + `tenants[tenantId] = {...}` mutate object in-place — violates immutability rule
  - **ไฟล์:** `shared/tenant-system.js:82,96`
  - **Fix:**
    - delete: `const updated = Object.fromEntries(Object.entries(tenants).filter(([k]) => k !== tenantId))`
    - update: `const updated = { ...tenants, [tenantId]: { ...tenants[tenantId], ...changes } }`
  - **Verify:** `grep -n "delete tenants\[" shared/tenant-system.js` → 0 hits

- [x] **[CQ-ONSNAPSHOT] เพิ่ม error callback ใน 2 onSnapshot ที่ขาด** (already done in prior session)
  - **Why:** §7-N — silent failure เมื่อ index ขาด หรือ permission-denied
  - **ไฟล์:**
    - `shared/dashboard-extra.js:770` — `setupAnnouncementListener` inner onSnapshot
    - `shared/billing-system.js:458` — `createBillListener`
  - **Fix:** เพิ่ม `(err) => { console.warn('[module] subscription failed:', err); _xxxUnsub = null; }` เป็น 3rd argument
  - **Verify:** `grep -A5 "onSnapshot" shared/dashboard-extra.js | grep -c "err =>"` ≥ 1

---

### 🚀 DevOps

- [x] **[DEVOPS-STAGING] Wire staging environment เข้า CI/CD**
  - **Why:** `.firebaserc` มี staging alias แต่ทุก CI deploy ไป production ตรง — ไม่มี safety gate
  - **Fix:** สร้าง `.github/workflows/deploy-staging.yml` — triggered on PR → staging branch: run unit tests → deploy CFs ไป `the-green-haven-staging` → run E2E กับ staging URL → require manual approval ก่อน production
  - **Verify:** PR ไปยัง main → GitHub Actions แสดง staging deploy step ก่อน production

- [x] **[DEVOPS-CSP-CI] เพิ่ม CSP hash validation ใน GitHub Actions**
  - **Why:** pre-commit hook bypass ได้ (`--no-verify`) — drift จะไม่ถูกจับจนกว่าจะ deploy แล้ว production เสีย (§7-II incident)
  - **ไฟล์:** `.github/workflows/validate.yml` (เพิ่ม step)
  - **Fix:** เพิ่ม step: `node tools/compute-csp-hashes.js && diff tools/csp-hashes.json <(git show HEAD:tools/csp-hashes.json) || (echo "CSP drift detected" && exit 1)`
  - **Verify:** แก้ inline style ใน HTML โดยไม่ regen → CI fail

---

## P2 — ภายใน 2-3 Sprint

### 🎨 UX/Accessibility

- [x] **[UX-CONTRAST] แก้ badge + placeholder contrast**
  - **Why:** `--warn` badge = 2.81:1, `--info` = 3.15:1 (ต้องการ 4.5:1 — WCAG 1.4.3 AA ล้มเหลว)
  - **ไฟล์:** `shared/components.css:249-264`, `shared/brand.css:273-278`
  - **Fix:**
    - เพิ่ม `--warn-text: #b45309` (≥4.5:1 บน amber tint) + `--info-text: #1d4ed8` (≥4.5:1 บน blue tint)
    - แก้ `--pebble` placeholder light mode จาก `#a8b5b0` → `#798c87` (≥4.5:1 บน white)
  - **Verify:** Chrome DevTools → color contrast checker บน badge elements → ≥4.5:1

- [x] **[UX-DARK] Tokenize overlay/modal inline hex สำหรับ dark mode**
  - **Why:** hardcoded `#fff`, `#f0fdf4`, `#1a5c38`, `#666` ใน overlays ไม่ flip เมื่อ dark mode toggle
  - **ไฟล์:** `tenant_app.html:2402-2422` (`#liff-link-overlay`, `#app-loading-splash`), JS-built modal panels
  - **Fix:** แทน hardcoded hex ด้วย `var(--surface-card)`, `var(--surface-page)`, `var(--muted)`, `var(--brand-primary)`
  - **Verify:** toggle dark mode → overlays/modals ต้อง flip สี

- [x] **[UX-THEME] แก้ `theme-color` meta + รัน dark mode gap audit**
  - **Why:** `<meta name="theme-color" content="#2d8653">` เป็น old green, ไม่ใช่ current teal `#0f766e`
  - **ไฟล์:** `tenant_app.html:11`, `booking.html:11`
  - **Fix:** update เป็น `content="#0f766e"`; update `memory/dark_mode_audit_state.md` ว่า `night-mode` mechanism migrate แล้ว เหลือแค่ `data-theme`
  - **Verify:** Chrome → Application → Manifest → theme_color แสดง teal

- [x] **[UX-LOADING] เพิ่ม `role="status"` บน loading splash + `role="alert"` บน error boxes**
  - **Why:** ผู้ใช้ screen reader ไม่ได้รับ announcement ระหว่าง LIFF auth wait
  - **ไฟล์:** `tenant_app.html:2415` (`#app-loading-splash`), inline error boxes
  - **Fix:** `<div id="app-loading-splash" role="status" aria-live="polite" aria-label="กำลังโหลด...">`
  - **Verify:** macOS VoiceOver → เปิด LIFF → ต้องได้ยิน "กำลังโหลด"

---

### 💎 Code Quality

- [x] **[CQ-SPLIT-AUTH] Split `_callLiffSignIn` (178 บรรทัด) เป็น 4 functions**
  - **Why:** 178 บรรทัดผสม 4 responsibilities — เกิน 50-line rule, test ยาก
  - **ไฟล์:** `shared/tenant-liff-auth.js:247`
  - **Fix:** extract → `_getFastPathToken()`, `_fetchWithAbort(url, timeout)`, `_handleLiffSignInResponse(resp)`, `_callLiffSignIn()` เป็น orchestrator เรียก 3 อัน
  - **Verify:** `wc -l` แต่ละ function ≤ 50; unit test `_fetchWithAbort` แยกได้

- [x] **[CQ-OVERSIZED] Split shared modules ที่ใหญ่สุด 3 อันดับ** _(partial — TenantFirebaseSync→687L, deposits→269L, facility→258L extracted; dashboard-insights.js split deferred to P3)_
  - **Why:** 21 ไฟล์เกิน 800 บรรทัด — ทำให้ review/test ยาก; เป็น god file แบบใหม่
  - **Priority:**
    - `shared/dashboard-requests-admin.js` (1,928 บรรทัด) → แยก `dashboard-pets-admin.js`, `dashboard-deposits-admin.js`, `dashboard-facility-admin.js`
    - `shared/dashboard-insights.js` (1,767 บรรทัด) → แยก insights เป็น per-card modules
    - `shared/tenant-system.js` (1,583 บรรทัด) → แยก `TenantFirebaseSync` ออก
  - **Verify:** `npm run audit:size` → ทุกไฟล์ที่แยกออกมา ≤ 800 บรรทัด

---

### 📚 Docs & Memory

- [x] **[DOC-DASHBOARD] แก้ MEMORY.md: dashboard.html = 5,621 บรรทัด (ไม่ใช่ ~4,100)** _(already correct in memory)_
  - **Why:** claim ใน MEMORY.md ผิด — agent วัดจริงได้ 5,621 บรรทัด ทำให้ประเมิน debt ต่ำเกินไป
  - **ไฟล์:** `~/.claude/projects/.../memory/MEMORY.md` + `dashboard_architecture.md`
  - **Fix:** อัปเดต "~4,100 lines" → "5,621 lines" ใน dashboard_architecture.md + verify grep
  - **Verify:** `wc -l dashboard.html` → ตรงกับ doc

- [x] **[DOC-DARKMODE] อัปเดต dark_mode_audit_state.md**
  - **Why:** doc บอกว่า "dual mechanism (body.night-mode + html[data-theme])" แต่ `night-mode` migrate แล้ว — เหลือแค่ `data-theme`
  - **ไฟล์:** `~/.../memory/dark_mode_audit_state.md`
  - **Fix:** แก้ให้ระบุว่า `data-theme` เป็น canonical เพียงตัวเดียว, `night-mode` เป็น comment เก่าเท่านั้น
  - **Verify:** `grep -c "night-mode" tenant_app.html` → เหลือแค่ comment ไม่มี live styling

- [x] **[DOC-SA-KEY] เพิ่ม SA key rotation SLA + frozen CF guide ใน CLAUDE.md §5**
  - **Why:** Service account key ไม่มี rotation schedule — long-lived credential risk
  - **Fix:** เพิ่มใน CLAUDE.md §5 (Commands table): "Service account key: rotate annually (next: 2027-05). Frozen CF `generateBillsOnMeterUpdate` on Node 20 — see `generate_bills_cf_frozen.md` for manual mitigation steps"

---

## P3 — Tech Debt (ทยอยทำ)

### 🧹 Tech Debt — Quick Wins

- [x] **[DEBT-SMOKE] ลบ smoke HTML files ที่ commit เข้า repo (906KB)** _(smoke_login.html was never committed — already in .gitignore)_
  - **Why:** `smoke_tenant.html` (10,566 บรรทัด) + `smoke_dashboard.html` (4,143 บรรทัด) เป็น test artifacts ที่ไม่มี runtime use
  - **Fix:** `git rm smoke_tenant.html smoke_dashboard.html` + เพิ่มบรรทัดใน `.gitignore`: `smoke_*.html`
  - **Verify:** `ls smoke_*.html` → no such file

- [x] **[DEBT-DEAD1] ลบ `window.generateInvoiceWithDetails` (zero callers)**
  - **Why:** function 40+ บรรทัดใน `shared/tenant-legacy.js:627` — §7-K pattern, ไม่มีใครเรียกเลย
  - **Fix:** `grep -rn "generateInvoiceWithDetails" shared/ *.html` ยืนยัน 0 callers → ลบ function + window assignment
  - **Verify:** grep returns 0 hits after deletion

- [x] **[DEBT-FIELD] แก้ `invoice-pdf-generator.js:34` ยังอ่าน `promptpayNumber` (legacy field)**
  - **Why:** §7-T fix ทำ canonical writer เป็น `promptPayId` แล้ว แต่ generator.js ยังอ่าน legacy name + hardcode `'089-1234567'` เป็น fallback
  - **Fix:** `_owner.promptPayId || _owner.promptpayNumber || ''` (dual-read ระหว่าง migration) แล้วลบ hardcoded phone
  - **Verify:** Invoice PDF แสดง PromptPay จริงจาก Firestore ไม่ใช่ `089-1234567`

- [x] **[DEBT-ESC] Extract shared `_esc()` utility (12 identical copies)**
  - **Why:** DRY violation ที่ใหญ่ที่สุดใน codebase — function เหมือนกัน 12 ไฟล์
  - **ไฟล์:** `shared/utils.js` (สร้างใหม่) หรือเพิ่มใน `shared/brand-utils.js`
  - **Fix:** สร้าง `window._esc = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }` ใน utils → ลบทั้ง 12 local copies
  - **Files affected:** `shared/checklist-page.js`, `dashboard-buildings.js`, `dashboard-checklist-admin.js`, `dashboard-lease-renew-roompicker.js`, `dashboard-pdpa-erasure.js`, `dashboard-property.js`, `dashboard-tenant-lease.js`, `facility-booking-ui.js`, `marketplace-chat.js`, `tenant-maintenance.js`, `tenant-marketplace.js`, `tenant-subscriptions.js`
  - **Verify:** `grep -rn "function _esc(" shared/` → เหลือ 1 (ใน utils)

- [x] **[DEBT-FETCH] แทน `node-fetch` v2 ด้วย native `fetch` ใน 7 CFs**
  - **Why:** `node-fetch@2` เป็น legacy CJS; Node 22 runtime มี `globalThis.fetch` built-in — ไม่ต้องใช้ dependency
  - **ไฟล์:** `liffSignIn.js`, `verifySlip.js`, `verifyBookingSlip.js`, `liffBookingSignIn.js`, `requestRoomRelink.js`, `keepLiffWarm.js`, `adminApprovedLink.js`
  - **Fix:** ลบ `const fetch = require('node-fetch')` → ใช้ global `fetch` แทน → ลบ `node-fetch` จาก `functions/package.json`
  - **Verify:** `npm run test:unit` ผ่าน + `grep -rn "node-fetch" functions/` → 0 hits

- [x] **[DEBT-PLAN] แก้ tasks/marketplace-sprints.md S1.5 + S2.1 ที่ plan เป็น Firestore trigger**
  - **Why:** S1.5 `cleanupMarketplaceChat` + S2.1 `notifyMarketplaceChat` ถูก plan เป็น Firestore triggers — จะล้ม deploy เพราะ SE3 region constraint (§7-NN)
  - **Fix:** update แต่ละ task ให้ระบุว่าเป็น HTTPS callable (Gen2 onCall) ไม่ใช่ Firestore trigger + เพิ่มลิงก์ §7-NN
  - **Verify:** grep plan ไม่มี `onWrite` / `onCreate` ใน S1.5/S2.1

---

### ⚡ Performance — Minor

- [x] **[PERF-FONT] เพิ่ม preload hint สำหรับ IBM Plex Sans Thai Looped 400**
  - **Why:** Google Fonts ต้องผ่าน 2 waterfall hops (CSS → font file) — preload ลด 1 hop
  - **ไฟล์:** `tenant_app.html:32-33`, `booking.html` head
  - **Fix:** เพิ่ม `<link rel="preload" as="font" crossorigin href="https://fonts.gstatic.com/s/ibmplexsansthailooped/...wght@400.woff2">` (ต้องหา URL จริงจาก Google Fonts response)

- [x] **[PERF-TRANSITION] แทน `transition: all` ด้วย specific properties (5 occurrences)**
  - **Why:** `transition: all` evaluate ทุก animatable property ทุกครั้ง style เปลี่ยน
  - **ไฟล์:** `shared/components.css:636,672,713`, `shared/brand.css:440,467`
  - **Fix:** `transition: color 0.2s, background-color 0.2s, border-color 0.2s, box-shadow 0.2s`
  - **Verify:** `grep -n "transition: all" shared/brand.css shared/components.css` → 0 hits

- [x] **[PERF-BLOCKING] เพิ่ม `defer` ให้ `gamification-rules.js`**
  - **Why:** โหลดโดยไม่มี `defer` ที่ `tenant_app.html:129` — block HTML parsing 9KB
  - **ไฟล์:** `tenant_app.html:129`
  - **Fix:** ย้าย `GamificationRules` reference ใน inline script เข้า `DOMContentLoaded` callback → เพิ่ม `defer` ให้ script tag
  - **Verify:** Lighthouse → no parser-blocking scripts

---

### 🧪 Testing

- [x] **[TEST-FRONTEND] Setup Jest/Vitest สำหรับ frontend JS**
  - **Why:** 0% frontend test coverage — UI bugs ไม่ถูกจับโดย automated tests เลย
  - **Fix:** เพิ่ม `vitest` + `jsdom` ใน root `package.json`; สร้าง `tests/shared/` directory; เริ่มด้วย:
    - `tests/shared/tenant-system.test.js` — `TenantConfigManager` CRUD + immutability
    - `tests/shared/building-registry.test.js` — cache + fallback
    - `tests/shared/gamification-rules.test.js` — badge unlock conditions
  - **Target:** ≥50% coverage บน tested files ใน pass แรก
  - **Verify:** `npm run test:frontend` → passes; coverage report แสดงตัวเลข

- [x] **[TEST-E2E-BOOKING] เพิ่ม E2E สำหรับ booking flow**
  - **Why:** booking.html เป็น critical flow แต่ไม่มี E2E เลย (24 tests ปัจจุบันไม่ครอบ)
  - **ไฟล์:** `e2e/booking.spec.js` (new)
  - **Fix:** test: room selection → date picker → confirm → payment QR render → slip upload UI

---

## Review section (กรอกหลัง execute)

_กรอกหลังจาก implement แต่ละ section_

- [x] P0 Security XSS — commit: `87bb4a3`
- [x] P0 A11y main landmark — commit: `87bb4a3`
- [x] P1 Performance (5 tasks) — commit: `7e5ef7b`
- [x] P1 Code Quality (4 tasks) — commit: `7e5ef7b`
- [x] P1 DevOps (2 tasks) — commit: `7e5ef7b`
- [x] P2 UX (4 tasks: contrast, dark tokens, theme-color, loading role) — this session
- [x] P2 CQ-SPLIT-AUTH (_callLiffSignIn → 5 functions ≤47 lines each) — this session
- [x] P2 CQ-OVERSIZED (partial: 3 files → 5 files extracted; dashboard-insights.js deferred) — this session
- [x] P2 Docs (DOC-DARKMODE, DOC-SA-KEY; DOC-DASHBOARD was already correct) — this session
- [x] P3 Tech Debt quick wins (DEBT-DEAD1, DEBT-FIELD, DEBT-ESC, DEBT-FETCH, DEBT-PLAN) — this session
- [x] P3 PERF-TRANSITION (5× transition:all → specific properties) — commit: `2cb408e`
- [x] P3 PERF-BLOCKING (gamification-rules.js defer — blocker removed by god-file refactor) — this session
- [x] P3 PERF-FONT (IBM Plex Sans Thai Looped woff2 preload — Thai + Latin subsets) — this session
- [x] P3 TEST-FRONTEND (35 tests: gamification-rules.test.js + building-registry.test.js in shared/__tests__/) — this session
- [x] P3 TEST-E2E-BOOKING (e2e/booking.spec.js — structural + LIFF-gate + tab interaction, 12 tests) — this session
- [x] P3 CQ-OVERSIZED (dashboard-insights.js 1766L → 5 files: 362/412/250/365/483L; window._ins delegation) — this session

---

## สรุปจำนวน tasks

| Priority | Security | Perf | CodeQ | DevOps | UX | Docs | Tech Debt | Testing | รวม |
|----------|----------|------|-------|--------|----|----- |-----------|---------|-----|
| P0 | 3 | — | — | — | 2 | — | — | — | **5** |
| P1 | — | 5 | 4 | 2 | — | — | — | — | **11** |
| P2 | — | — | 2 | — | 4 | 3 | — | — | **9** |
| P3 | — | 3 | — | — | — | — | 6 | 2 | **11** |
| **รวม** | **3** | **8** | **6** | **2** | **6** | **3** | **6** | **2** | **36** |

**Estimated sessions:** P0 (~1-2) + P1 (~3-4) + P2 (~4-5) + P3 (~5-6) = **13-17 sessions** รวม

> หมายเหตุ: Marketplace sprint (S0.2, S1-S6) แยกอยู่ใน [tasks/marketplace-sprints.md](tasks/marketplace-sprints.md) — ทำควบคู่ได้
