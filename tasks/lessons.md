# Lessons — The Green Haven

Append after every correction or bug fix. Keep entries terse:
- **Mistake:** what I did wrong
- **Why:** root cause
- **Rule:** what to do instead (so this never repeats)

Read this file at the start of every session per `CLAUDE.md § 1`.

---

## 2026-05-01 — Auto-click approve ในระบบการเงิน ทำให้ข้อมูลผิดเข้า production

**Mistake:** auto-click "อนุมัติและบันทึก" ผ่าน JavaScript โดยไม่ให้ user ตรวจ preview table ก่อน — ส่งผลให้ข้อมูลผิด (ร้านใหญ่ บันทึกผิด building) เข้า Firestore production ทันที

**Why:** ต้องการ verify ว่า fix ทำงาน แต่ลืมว่า preview table มีไว้เพื่อให้ user ตรวจก่อนเสมอ

**Rule:** ห้าม auto-click ปุ่ม approve/confirm ที่มีผลต่อข้อมูลการเงินหรือ Firestore production ไม่ว่ากรณีใดทั้งสิ้น user ต้องเป็นคนกดเอง ถ้าต้องการ verify ให้ตรวจ console/Firestore หลัง user approve แทน

---

## 2026-05-01 — สร้าง wrapper function ใหม่แทนที่จะ inline call function ที่มีอยู่

**Mistake:** เห็น `approvePendingImportWithFirebase` ถูก call แต่ไม่มี definition → สร้าง wrapper function ใหม่ 35 บรรทัด แทนที่จะ inline call `FirebaseMeterHelper.saveMeterReading` (มีอยู่แล้ว) ที่ call site โดยตรง

**Why:** ไม่ได้ค้นหาก่อนว่ามี function ที่ทำงานเดิมอยู่แล้วหรือเปล่า — รีบสร้างโค้ดใหม่โดยไม่อ่าน codebase รอบข้างให้ครบ

**Rule:** เห็น undefined function call → หา existing function ใน codebase ที่ทำสิ่งเดียวกันก่อน → inline หรือ refactor call site ให้ใช้ของเดิม อย่าสร้าง wrapper ใหม่โดยไม่จำเป็น

---

## 2026-05-04 — Pre-built feature ค้นไม่เจอตั้งแต่แรก → เกือบ duplicate งาน 4 ชม.

**Mistake:** User ขอ feature "ลูกบ้านเลือก format บิล (บุคคล/นิติ)". วาง plan 4 phase (~3-4 ชม.) รวม UI form + Firestore schema + save logic + bill render switch. กำลังจะลงโค้ด Phase 2 (สร้างฟอร์ม tenant Profile) ตอนแรก พบว่า **มี receipt-type-select + company-info-display + saveCompanyInfo + getReceiptMetaForBill อยู่แล้วใน tenant_app.html line 3261+ และ 4666+** — feature ถูกสร้างไว้แล้วก่อนหน้านี้ + Firestore schema (`tenant.receiptType` + `tenant.companyInfo`) ก็มีอยู่. ต้องทำแค่ Phase 3 (wire bill render) เท่านั้น

**Why:** ตอน scan codebase ใช้ pattern `billRecipient|recipientType|invoiceFormat` (จากชื่อที่จะตั้ง) — ไม่ตรงกับ field name ที่มีอยู่ (`receiptType`, `companyInfo`). ต้องค้น "นิติบุคคล" (Thai keyword จาก mockup) ถึงจะเจอ + grep `getReceiptMetaForBill` พบว่าเป็น **orphaned public API** (defined แต่ไม่มีใครเรียกใช้ — เป็นสัญญาณว่า scope ถูก plan ไว้แล้วแต่ wiring ค้าง)

**Rule:** ก่อนวาง plan สร้าง feature ใหม่ → grep keyword **ภาษาไทย** จาก mockup/screenshot (ลูกบ้านบอกว่า "นิติบุคคล" → grep "นิติบุคคล" ก่อน grep `recipientType`) + grep public API names ที่ register บน window (`window.X = ...`) แล้วเช็คว่ามีใครเรียกใช้ — orphaned API = unfinished feature waiting to be wired. ลด scope จาก "สร้างใหม่" → "wire ของเดิม" ทันทีถ้าเจอ

---

## 2026-05-04 — Save function อ่าน DOM elements ที่ไม่ได้ render → save พังเงียบ

**Mistake:** `saveOwnerInfo()` ใน `shared/dashboard-extra.js:1517-1519` อ่าน `document.getElementById('ownerOperationStartDate').value.trim()` (และอีก 2 ตัว) แต่ `renderOwnerInfoPage()` ไม่ได้ render ฟิลด์เหล่านั้น → `getElementById` คืน `null` → `.value` โยน TypeError → save อบอร์ตก่อนถึง `OwnerConfigManager.saveOwnerInfoWithFirebase()` → ไม่มี toast, ไม่บันทึก, registrationStatus ที่ user ตั้งเป็น 'pending' ไม่ติด → ผลคือบิลออกชื่อบริษัทเสมอ user หาเหตุไม่เจอ

**Why:** save function กับ render function แยกคนละจุดในไฟล์เดียวกัน → เพิ่ม/ลบฟิลด์ฝั่งหนึ่งโดยไม่ sync อีกฝั่ง → ฟิลด์ company identity ด้านบน (line 1496-1499) ใช้ optional chaining `?.value?.trim() || ''` ถูกแล้ว แต่ accounting fields ด้านล่างไม่ได้ทำ — defensive coding inconsistent ภายใน function เดียวกัน

**Rule:** Form save handler ที่อ่านจาก DOM **ทุก** field → ใช้ optional chaining `el?.value?.trim() || defaultValue` เสมอ ไม่ใช่แค่บางบรรทัด. เวลา audit save function: grep ทุก `getElementById` แล้วเช็คว่า id นั้น render ใน corresponding render function หรือเปล่า. ถ้าไม่มี → ลบทิ้ง หรือ defensive read

---

## 2026-05-02 — Firebase init async race: auth undefined in load handler

**Mistake:** `initializeFirebase()` ถูก call โดยไม่ save promise → `window.addEventListener('load', ...)` callback ทำงาน → dynamic import resolves → `onAuthStateChanged(auth, ...)` โดน call ขณะ `auth` ยัง `undefined` → `TypeError: Cannot read properties of undefined (reading 'onAuthStateChanged')` เพราะ `/api/config` fetch ยังไม่ return

**Why:** `initializeFirebase()` เป็น async function ที่ `await window.loadFirebaseConfig()` (network fetch) ก่อน set `auth = getAuth(app)`. `window.load` event + dynamic import (`firebase-auth.js` ซึ่ง cached) resolve เร็วกว่า network fetch ในบางสถานการณ์ ทำให้ `auth` ยังเป็น `undefined`

**Rule:**
- บันทึก promise ไว้เสมอ: `const _fbInitPromise = initializeFirebase();`
- ใน `window.load` handler: `await _fbInitPromise;` ก่อนใช้ `auth`, `database`, `firestore` ทุกตัว
- Pattern นี้ใช้กับทุก async init function — ถ้า call ไม่ await, ต้อง save promise แล้ว await ที่จุดใช้งาน

---

## 2026-05-02 — แก้ inline script → hash เปลี่ยน → CSP violation ใหม่

**Mistake:** แก้ `dashboard.html` `<script type="module">` (เพิ่ม `await _fbInitPromise`) → เนื้อหา script เปลี่ยน → hash SHA-256 เก่า (`gaRx0y1u…`) ไม่ match อีกต่อไป → CSP Report-Only ขึ้น violation สำหรับ script block นั้น

**Why:** CSP hash ถูก compute จากเนื้อหา verbatim ของ `<script>` block — เปลี่ยนแม้แต่ 1 ตัวอักษร hash เปลี่ยนทั้งหมด

**Rule:** หลัง edit **ใดๆ** ใน `<script>` หรือ `<style>` block ของ HTML file:
1. `npm run csp:hash` → regenerate `tools/csp-hashes.json`
2. Inject ผ่าน Node script (ไม่ใช่ edit vercel.json มือ): `node -e "...generate-vercel-csp.js..."`
3. Verify: `grep '3zTK9Sf3\|<new-hash>' vercel.json` ก่อน commit

---

## 2026-05-02 — แก้ vercel.json มือ → ถูก csp:print เขียนทับ

**Mistake:** เพิ่ม `https://browser.sentry-cdn.com` โดยตรงใน `vercel.json` → session ถัดไป run `npm run csp:print` → script regenerate ทั้ง CSP string จาก `generate-vercel-csp.js` → domain หายไป

**Why:** `generate-vercel-csp.js` คือ source of truth ของ CSP domain allowlist — มัน generate string ใหม่ทั้งหมดทุกครั้ง vercel.json เป็น output, ไม่ใช่ source

**Rule:** เพิ่ม CDN domain ใหม่ใน `tools/generate-vercel-csp.js` `SCRIPT_SRC_EXTERNAL` array (หรือ `STYLE_SRC_EXTERNAL`) เท่านั้น อย่าแตะ vercel.json โดยตรง. Sentry ต้องการ 2 domains: `https://js.sentry-cdn.com` (loader stub) + `https://browser.sentry-cdn.com` (full SDK lazy-loaded)

---

## 2026-05-02 — Node `shell: 'bash'` บน Windows resolve ไป WSL ไม่ใช่ Git Bash

**Mistake:** `tools/verify-memory.js` ใช้ `execSync(cmd, { shell: 'bash' })` — เมื่อ user run `npm run verify:memory` จาก cmd.exe / PowerShell มันแสดง 173/173 RED (ทุก grep "not in code") ทั้งที่ doc ตรงโค้ดทุก claim. แต่ถ้า run จาก Git Bash → 173/173 GREEN

**Why:** บน Windows ที่มี WSL ติดตั้ง, bare `bash` ใน PATH resolve ไป `C:\Windows\System32\bash.exe` (WSL launcher) ก่อน Git Bash. WSL มี filesystem mapping ของตัวเอง — Windows-style cwd ที่ Node ส่งไป (`C:\Users\...`) ทำให้ grep หาไฟล์ไม่เจอเลย แต่ไม่ throw error (exit 1 + empty stdout = ตรงกับ grep-no-match path) → verifier รายงาน "claim not in code" หมดทุกข้อ. จาก Git Bash, PATH order ทำให้ `/usr/bin/bash` เจอก่อน → ทำงานปกติ

**Rule:**
- เมื่อ Node spawn shell บน Windows อย่าใช้ `shell: 'bash'` เปล่าๆ — pin ไปที่ Git Bash ตรงๆ:
  ```js
  const BASH = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';
  ```
- ถ้า tool ทำงานข้าม shell ได้ (ไม่ผูกกับ bash syntax) → ทำ native-Node implementation แทน, อย่าพึ่ง shell
- เวลา debug "ทำไม run จาก terminal X ผ่าน, จาก terminal Y RED ทั้งหมด" → ตรวจ `where bash` (cmd.exe) vs `which bash` (bash) ทันที

---

## 2026-05-02 — ลบ memory doc โดยไม่ grep cross-refs ก่อน

**Mistake (almost made):** เกือบลบ `gamification_live_flag.md` + `point_economy_rules.md` ทันที แต่ grep ก่อนพบว่า 9 active lifecycle docs อ้างถึงไฟล์เหล่านั้น (`brand_living_os`, `lifecycle_complaints_award`, `lifecycle_daily_login`, `lifecycle_marketplace`, `lifecycle_thin_surfaces_catalog`, `lifecycle_tenant_ssot`, `lifecycle_wellness_claim`, `lifecycle_reward_redemption`, `tenant_app_architecture`)

**Why:** memory tree มี cross-link มากกว่าที่คิด — ลบโดยไม่ตรวจ = สร้าง broken link เงียบๆ ใน 9 docs

**Rule:** ลบ memory file ทุกครั้ง:
1. `Grep` filename across memory dir ก่อน
2. แยก hits เป็น 2 กลุ่ม: **active** (`lifecycle_*.md`, `*_*.md` reference, `MEMORY.md`) → ต้อง update ก่อนลบ; **historical** (`session_*.md`, `archive_*.md`, handoffs) → leave frozen (intentional snapshots)
3. Update active refs → point to merged location
4. ลบไฟล์
5. Run `npm run verify:memory` to confirm no breakage

---

## 2026-05-02 — Flatten nested tabs: ลืม `display:none` panel แรกหลังแกะ wrapper

**Mistake:** ตอน flatten 3 sub-tabs (Live Feed | ประวัติตามห้อง | สถานะชำระรายเดือน) ออกจาก `bill-main-tab-verify` wrapper → `pv-tab-history` กับ `pv-tab-monthly` มี inline `style="display:none"` อยู่แล้ว แต่ `pv-tab-live` ไม่มี (เป็น "active" panel ของกลุ่มเดิม) เลยโผล่มาเลยเมื่อ user เปิดหน้า bill ครั้งแรก (default tab = ออกบิล แต่ Live Feed โผล่ค้างใต้ form)

**Why:** wrapper เดิมมี `display:none` ครอบทั้งสามตัว — sub-panel ที่ "active" จึง implicit hidden. พอแกะ wrapper ออก visibility เปลี่ยน

**Rule:** หลัง unwrap nested tabs:
- ตรวจทุก promoted panel ว่ามี `style="display:none"` หรือ `class="u-hidden"` initial state
- เพิ่มให้ทุก panel ที่ไม่ใช่ default-active หลังการ flatten
- Default-active panel = อันแรกของ tab order ใหม่ (ในเคสนี้คือ `bill-main-tab-billing` — ไม่ใช่ pv-tab-live)
- Verify ด้วย: เปิดหน้า → ต้องเห็นแค่ default panel เท่านั้น

---

## 2026-05-02 — "Actively maintained" ≠ "in production flow"

**Discovery:** payment.html (923 lines) อยู่ใน CSP hash list, Sentry monitoring, SRI scripts — ดูเหมือน production page เต็มตัว. แต่อ่าน code จริง: ใช้ `SecurityUtils.getSecureSession()` (NOT Firebase Auth), localStorage-only slip flow (NOT verifySlip CF), no LIFF SDK เลย → คือ standalone legacy portal ไม่ใช่ production tenant flow

**Why:** ระบบ build/security pipelines (CSP, SRI, Sentry) ไม่แยกระหว่าง "live in production" กับ "still loadable in browser" — ทุก HTML ในรากของ repo ผ่านมาตรฐานเดียวกันหมด

**Rule:** ก่อนสรุปว่า file X integrate กับ flow Y:
- อ่าน auth model จริง (Firebase Auth? SecurityUtils session? LIFF?)
- ตรวจ CF call จริง (`fetch /verifySlip`? callable httpsCallable? นั่งเขียน localStorage?)
- ดู data source จริง (Firestore? RTDB? localStorage? base64-in-doc?)
- การอยู่ใน build pipeline ไม่ได้แปลว่าใช้งาน production — ต้องเช็ค runtime behavior

---

## 2026-05-01 — BillStore.listForYear ไม่ inject room field → filter เจ๊งเงียบ

**Mistake:** `_renderPVHBillTable` ใช้ `BillStore.listForYear(building, y).filter(b => String(b.room||b.roomId) === room)` เพื่อกรองบิลตามห้อง ผลลัพธ์: ทุก row แสดง "ไม่มีบิล" ยกเว้นเดือนที่มีบิลจริง 1 เดือน

**Why:** RTDB เก็บบิลที่ path `bills/rooms/14/{billId}` — ตัว document body ไม่มี field `room` หรือ `roomId` เลย `listForYear` push `b` แบบ raw จาก RTDB ดังนั้น `b.room || b.roomId` = `undefined` → filter คืน `[]` ทุกตัวเงียบๆ ไม่มี error

**Rule:** ต้องการบิลของห้องใดห้องหนึ่งให้ใช้ `BillStore.getByRoom(building, roomId, year)` เสมอ — มันเข้าถึง `_cache[bld][room]` โดยตรงจาก path key ไม่ต้องพึ่ง field ใน document body. `listForYear` ใช้สำหรับ aggregate ทุกห้องเท่านั้น ห้าม filter by room หลังจากนั้น

---

## 2026-05-01 — BillStore.synthesizeFromMeter มี slice(0,6) สำหรับ tenant view เท่านั้น

**Mistake:** `_pvhFillMeterGaps` เรียก `BillStore.synthesizeFromMeter({ meterHistory, ... })` เพื่อสร้าง synthetic bills สำหรับตาราง 12 เดือน ผลลัพธ์: แสดงแค่ 6 เดือนล่าสุด ที่เหลือยัง "ไม่มีบิล"

**Why:** `synthesizeFromMeter` มี `meterHistory.slice(0, 6)` hardcoded — ออกแบบสำหรับ tenant app ที่แสดงแค่ 6 เดือนล่าสุด admin history table ต้องการ 12 เดือน

**Rule:** อย่าเรียก `synthesizeFromMeter` จาก admin views ที่ต้องการ > 6 เดือน ให้ generate synthetic bills แบบ inline เองจาก meterHistory array ทั้งหมด (ดู `_pvhFillMeterGaps` ใน `dashboard-payment-verify.js` commit `6611662` เป็น reference)

---

## 2026-05-01 — meter_data ใช้ 2-digit BE year, real bills ใช้ 4-digit BE year, synthesizeFromMeter ใช้ CE year

**Mistake:** เขียน year conversion ผิดหลายรอบ ทำให้ synth bills ไม่ match กับ row ในตาราง 12 เดือน

**Why:** ระบบมี 3 year format พร้อมกัน:
- `meter_data` Firestore docs: `year` = 2-digit BE (`69` = 2569 BE = 2026 CE)
- Real RTDB bills (`BillStore._cache`): `year` = 4-digit BE string (`"2569"`)
- `synthesizeFromMeter` output + meterHistory input: CE int (`2026`)
- 12-month grid ใน `_drawPVHTable`: `y` = 4-digit BE int (`2569`)

**Rule:**
- Convert 2-digit BE → CE: `1957 + shortYear` (e.g. 1957+69=2026 ✓, 1957+68=2025 ✓)
- Store synth bills year as 4-digit BE (`ceYear + 543`) ไม่ใช่ CE เพื่อให้ match กับ real bills
- ใช้ `BillStore._be(b.year)` เสมอตอน compare กับ grid row's `y` (BE) เพราะ `_be()` handle 2-digit / 4-digit BE / CE ครบ
- ห้าม hardcode assume year format — ตรวจจาก source (meter_data doc vs bill doc vs grid row)

---

## 2026-04-30 — Firebase v11 modular SDK, NOT compat (`firebase.database()` is undefined)

**Mistake:** In Phase 1 deep analytics (`shared/dashboard-insights.js` commit `21316b8`), I wrote `await window.firebase.database().ref('bills').once('value')` for the Per-Tenant Payment Behavior card. On live the card showed **"⚠️ โหลดข้อมูลไม่สำเร็จ — RTDB ยังไม่พร้อม"** because `window.firebase.database` is `undefined`. Fix shipped in commit `68890f5`.

**Why:** The project initializes Firebase using v11 **modular** SDK (`initializeApp`, `getDatabase`, `getFirestore`, etc.) and exposes pre-resolved instances + named functions on `window`. The compat namespace (`firebase.database()`, `firebase.firestore()`, `.ref().once()`) does not exist here. I autopiloted to compat-style chained calls because that's the snippet pattern in most Firebase docs/blogs, without checking how `dashboard.html` actually wires Firebase.

**The actual API surface in this project** (verified `dashboard.html:106-180`):
- RTDB instance: `window.firebaseDatabase` (already a `Database` ref)
- Auth instance: `window.firebaseAuth`
- Firestore: `window.firebase.firestore()` exists in some modules via `window.firebase.firestoreFunctions` (modular fns are stashed under that key) — read access pattern: `getDocs(collection(db, ...))` from `firestoreFunctions`
- Storage: `window.firebaseStorage`
- RTDB modular fns exposed: `window.firebaseRef`, `firebaseGet`, `firebaseSet`, `firebaseUpdate`, `firebaseRemove`, `firebaseOnValue`, `firebasePush`, `firebaseChild`

**Correct RTDB read pattern:**
```javascript
const billsRef = window.firebaseRef(window.firebaseDatabase, 'bills');
const snap = await window.firebaseGet(billsRef);
const all = snap.val() || {};
```
Not `firebase.database().ref('bills').once('value')` — that throws TypeError "Cannot read properties of undefined".

**Correct Firestore read pattern (already used in dashboard-extra.js, dashboard-wellness-content.js, etc):**
```javascript
const db = window.firebase.firestore();   // this DOES work — see line 749 dashboard-extra.js
const { collection, getDocs, collectionGroup, query } = window.firebase.firestoreFunctions;
const snap = await getDocs(collection(db, 'wellness_articles'));
```
Note: `window.firebase.firestore()` returns the modular instance — confusingly named the same as compat. The methods on that instance are NOT chainable compat methods; you must use the modular fns via `firestoreFunctions`.

**Rule:** Before writing any new file that touches Firebase in this project, **grep `dashboard.html` for `window.firebase` and `firebaseRef`** to copy the exact globals exposed. Never assume compat API from generic Firebase docs. Same applies to any other shared/*.js file — confirm the modular pattern by reading 1-2 existing modules first (`dashboard-extra.js`, `dashboard-wellness-content.js` are good references). When in doubt, the canonical fact is `dashboard.html:95-180` initialization block.

---

## 2026-04-28 — 3-round security audit campaign — accepted residuals

**Context:** User asked "if a hacker were hired to attack us, what could they do?" Three audit rounds shipped 14 fixes (commits 474514d → b29d6bc). Two remaining items were evaluated and **deliberately not fixed** — capturing the reasoning here so a future session doesn't re-open them as "TODO".

**Residual #1 — `complaints` / `liffUsers` Firestore-create has no rate limit.**
Adding rule-based per-tenant counts requires a counter doc + Firestore trigger or routing the write through a callable CF (like `redeemReward`). Both involve frontend changes (the tenant_app currently writes Firestore directly). The actual exploit cost is low: complaints spam fills admin queue but doesn't leak data; liffUsers spam requires LIFF tokens (rate-limited upstream by LINE). **Accepted as residual — admin queue monitoring is the safeguard**. Promote to a fix only if anomalous activity is observed.

**Residual #2 — 14 CFs use `Access-Control-Allow-Origin: *`.**
CORS allowlist would block in-browser cross-origin POST from a malicious site, but does **not** block server-to-server token replay (the harder-to-trace path). The real defense is the Bearer token check in `_auth.js requireAdmin`. Vercel preview URL pattern (`*-the-green-haven.vercel.app`) makes a strict allowlist brittle. **Net assessment: marginal layer-3 defense, high churn cost (14 files), possible breakage of preview deploys. Accepted as residual** — Bearer + setAdminClaim INIT_TOKEN-lockdown + per-CF requireAdmin gates carry the security weight.

**Rule for future audits:** When a finding's mitigation has limited security gain *AND* the existing layers already block the same threat class, document the reasoning here rather than shipping defense-in-depth-for-its-own-sake. Each new layer is only worth its operational cost if it closes a path the existing layers leave open.

---

## 2026-04-28 (evening) — Two wrong claims in 24h, both in non-verifier-covered memory files

**Mistake #1 (session journal → almost deferred real work):** `session_2026_04_27_evening_insights_ops_incident.md` claimed `meter_data/{docId}` was a "single doc holding all rooms in `data` map keyed by roomId" and that per-room scoping needed a "storage refactor". Today's handoff inherited the claim. When the user asked me to assess the meter_data rule (tentative — "ลองดู"), my first instinct was to confirm "needs schema refactor, defer". Real schema (per `firestore_schema_canonical.md`): `meter_data/{building_yy_m_roomId}` — already per-room flat docs. Fix took 2 lines.

**Mistake #2 (re-occurred while writing the lesson about #1):** While updating the handoff to mark the May 1 dry-run as done, I wrote "look for `wellnessClaimed/{roomId}_2026-04` docs" as the post-cron marker check. **The real path is `tenants/nest/list/{roomId}/complaintFreeMonthAwarded/{YYYY-MM}`** — I conflated wellness-articles with complaint-free-month-award (two unrelated features) and paraphrased the path from short-term memory. Caught only because the user asked me to re-audit. Both `firestore_schema_canonical.md:69` and `lifecycle_complaints_award.md` had the correct path; I just didn't open either.

**Why:** Both errors lived in memory files NOT covered by `verify:memory` (which only scans `lifecycle_*.md` Verification blocks). Handoffs and session journals get edited freely without a gate. The verify-via-grep doctrine *as I had written it* targeted lifecycle docs explicitly, leaving handoffs/journals as a coverage hole. So I confidently wrote "fixed" while creating fresh drift in the same session.

The deeper failure mode: when editing memory, I treat code identifiers (paths, CF names, doc IDs, fields) as English text I can paraphrase. They aren't — they're verbatim contracts with code, and a single wrong path can mean "you'll never find the doc" (mistake #2) or "we'll defer real work indefinitely" (mistake #1).

**Rule (generalized + applied to doctrine):** When editing **any** memory file — handoff, session journal, feedback doc, reference doc — every backtick-quoted code identifier must be **grep-verified BEFORE typing it**, not after. Don't paraphrase paths from memory. Don't trust "I remember it as ..." Open the source file or the canonical schema doc, copy the literal value. Promoted into [feedback_verify_via_grep_doctrine.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_verify_via_grep_doctrine.md) under new "Files outside verifier coverage" section — extends the original rule from "lifecycle docs only" to "all memory files with code identifiers".

---

## 2026-04-28 — 19 doc errors across 6 audit rounds → "Verify-via-grep doctrine" promoted to memory rule

**Mistake:** Across the day's structural session, my lifecycle docs accumulated **19 factual errors** that took 6 audit rounds to surface. Each round caught what the previous one missed. After Round 3, more errors still might exist — I can't prove the docs are clean, only that my audits caught these.

The 3 sub-patterns inside the meta-pattern:

1. **Selector bias.** `grep 'class="page"'` returned 24 pages. The actual count was 25, because `class="page active"` doesn't match a literal grep. I trusted my own grep without considering CSS class concatenation. Lesson: a grep is one slice; consider the regex shape before declaring "verified".

2. **Structure-as-correctness.** Tables + Failure Modes sections + "verified 2026-04-28" stamps → felt rigorous → trusted. The structure is just a *container*. Inside the container were paraphrased facts I'd never grepped. Lesson: structure is presentation, not proof.

3. **Re-check bias.** My re-checks gravitated toward the things I had just edited. Untouched parts of the docs stayed untouched even when stale. Lesson: re-checks must include random spot-checks of *un-edited* content too, or the audit converges on the suspects you already named instead of the ones you didn't.

**Why:** Confidence and effort were correlated with structure (tables, sections), not with empirical grounding. Each round I felt "now it's right" — six times in a row that felt the same way and was wrong each time.

**Rule:** Promoted to memory as `feedback_verify_via_grep_doctrine.md`. Summary: every load-bearing claim in a lifecycle/architecture doc must EITHER embed the grep command that proves it OR defer to source with a grep advisory. Add a `## Verification` section to each major doc with {claim, grep command, expected} triples so a future session can re-verify in seconds. After writing, re-grep at least 3 random claims; any 0-hit grep means a fabricated claim.

This doctrine is now the SSoT pattern for any new memory doc.

---

## 2026-04-28 — Wrote 6 lifecycle docs from memory; deep audit caught 8 factual errors

**Mistake:** Earlier in the same session I wrote 6 lifecycle docs (LIFF, auth, stores, tenant SSoT, storage, LINE notification). They looked thorough — each ended with a Failure Modes table. User asked me to verify before commit. Two Explore agent passes + my own rechecks caught **8 factual errors** I had typed confidently from memory:

- Storage: `lease-docs/{roomId}` (real: `leases/{building}/{roomId}/{leaseId}/{fileName}`)
- Storage: `pets/{room}/{petId}/photo.jpg` (real: `pets/{building}/{room}/{petId}/{kind}_{ts}.{ext}`)
- Storage rules: fabricated `auth.token.room == room` scoping (real: `isSignedIn() + fitsSizeLimit() + isImageOrPdf()`)
- Auth: session TTL "2 hours" (real: 24h)
- Auth: collection `audit_events` w/ 7 fields (real: `auth_events` w/ 4 fields `maskedEmail/ua/errorCode/ts`)
- LINE: idempotency key `bill:{building}:{roomId}:{billId}` (real: `bill-${building}-${roomId}-${billId}-${userId}` — hyphens, includes userId)
- LINE: CF names `notifyLatePayment` / `notifyLeaseExpiry` (real: `remindLatePayments` / `remindLeaseExpiry` with `Scheduled` cron pairs)
- LINE: backoff "1m → 5m → 15m → 1h → 4h" (real: `5m → 10m → 20m → 40m → abandoned`)

The first audit (Explore agent #1) only caught Storage path mismatches. The second deep audit (paranoid claim-by-claim) caught the rest. The recheck round AFTER fixing also caught a leftover example with the old colon format.

**Why:** "Failure Modes table" looks thorough, but the table itself isn't proof of correctness — it's just structure. I wrote the *content* (paths, regex, field names, schedules) from memory, then dressed it up in a structured table. The structure tricked me into thinking I'd verified things.

**Rule:** When writing or editing **any architecture documentation** that names a path, function, regex, schedule, field, or rule contract:

1. **Grep or Read the actual code FIRST**, before opening the doc to type.
2. **Quote verbatim** from the code (path strings, field names, line numbers via grep, schedule cron) — don't paraphrase.
3. After writing, **re-grep your own claims** in the doc against the source. If a claim doesn't show a match, it's wrong or fabricated.
4. **Failure Modes tables don't prove correctness** — they prove the failure-mapping is plausible. The technical details still need empirical backing.
5. The "looks plausible from memory" check is the same trap as the Tailwind misread (lesson below) and the Anonymous-auth UI text (incident below). It's a recurring class. Always grep.

---

## 2026-04-28 — Wrote CLAUDE.md stack section without checking package.json

**Mistake:** When asked to update CLAUDE.md with the workflow protocol, I wrote "the existing codebase is vanilla HTML + JS" implying Tailwind was NOT used. User pushed back ("treat this command as the current architecture, fix what doesn't match"). On `cat package.json` I found `tailwindcss: ^3.4.19` in devDeps + a `tailwind:build` script, plus `<link rel="stylesheet" href="/shared/tailwind.css">` in tenant_app.html. Tailwind IS the styling layer.

**Why:** I leaned on a fast-glance impression of the HTML files instead of reading `package.json` first. The "no React" half of my disambiguation was right; the "no Tailwind by extension" half was a guess that bled into the doc as fact.

**Rule:** Before stating *what's in the stack* — even casually, even in docs — read `package.json` (deps + devDeps + scripts) and at least one HTML `<head>` for `<link>`/`<script>` tags. "Vanilla HTML + JS" is a 2-second claim that takes 30 seconds of facts to back. Apply the same standard as to bug fixes: empirical check before writing.

---

## 2026-04-28 — Misled user into disabling Anonymous auth → all LIFF tenants locked out

**Mistake:** I wrote UI text in the `cleanupAnonymousUsers` Insights card that said "ปิด Anonymous auth ใน Firebase Console" as a pre-step, and the CF JSDoc said "Anonymous sign-in must already be disabled". User followed it. Every LIFF tenant got `Missing or insufficient permissions` on the next session. Fixed in commit `99d6788`.

**Why:** I treated `cleanupAnonymousUsers` as a standalone feature without tracing the LIFF UID lifecycle. LIFF-linked tenants are **anonymous UIDs WITH custom claims** — not non-anonymous users with provider data, as my JSDoc wrongly claimed. Disabling Anonymous auth removes the seat that `linkAuthUid` attaches `{room, building}` claims to.

**Rule:** Before writing user-facing instructions for any feature that touches Firebase Auth providers (anonymous, email, phone, OAuth), trace the full UID lifecycle of every consumer first. Reference `~/.../memory/lifecycle_liff_onboarding.md`. Do not infer architecture from one CF in isolation.

---

## 2026-04-28 — Shipped a gate that blocked the URL another change in the same session was generating

**Mistake:** I added a hard access gate in `tenant_app.html` requiring an admin claim for `?room=&building=` URLs, then later in the same session changed `login.html` to redirect tenants to `/tenant_app?room=15&building=rooms`. The gate blocked the path the redirect was creating.

**Why:** I evaluated each change against the file it was edited in, not against the cross-cutting flow. Two correct-in-isolation changes can produce a broken-as-a-pair flow.

**Rule:** Before saying "done" on any session that touched 2+ files in the same user flow, re-read all session diffs against each other. Trace the user's path end-to-end on the new code, not just the changed file. (Codified as `feedback_self_conflict_check_my_own_changes.md` in user memory.)

---

## 2026-04-28 — Restated 5+ wrong fixes for the same bill bug without ever asking for live state

**Mistake:** Bills-not-showing symptom recurred across 5+ turns. Each turn I proposed a different fix without confirming the actual failure mode. Wasted hours patching downstream symptoms while the root cause (GCP API key restrictions blocking Token Service API) sat unobserved.

**Why:** I rewarded hypothesis over observation. When a symptom recurs, the next fix has lower expected value than asking for one piece of state.

**Rule:** When a symptom recurs across turns or sessions, change tactics: stop proposing fixes, ask for ONE concrete observation (currentUser email, claims, RTDB doc screenshot, network 4xx). One real observation kills the entire hypothesis tree. (Codified as `feedback_stop_guessing_demand_state.md` in user memory; bills playbook in `bills_not_showing_diagnostic.md`.)

---

## 2026-04-28 (late) — Chased function-arg theory for tenantModal; real bug was inline display:none vs class toggle (already documented)

**Mistake:** User reported "ปุ่ม สัญญา ไม่ขึ้นให้แก้ข้อมูล" on dashboard's room-management cards. I grepped, saw `editRoom(roomId){openTenantModal(roomId)}` calling with one arg while another caller (`dashboard-tenant-page.js:246`) used two args, declared "missing building arg" the bug, fixed with `_bldFromRoom` helper, pushed `f9722b4`. User tested → still broken. Real cause: `dashboard.html:2034` ships `<div id="tenantModal" style="display:none;">`. `openTenantModal` removed `.u-hidden` but inline `display:none` always wins over external CSS — modal stayed invisible while the form populated correctly behind it. Fixed in `9133acd` by setting `modal.style.display = 'flex'` on open.

**Why:** I skipped the DOM-state check. `openTenantModal:74` already had a 1-arg fallback (`detectBuildingFromRoomId`) so my "fix" was a no-op semantically. The exact pattern was already documented in `feedback_inline_style_class_toggle.md` (loaded at session start, ignored).

**Rule:** When a button "doesn't open a modal," inspect the modal element's state before patching the click path. One-liner: `({inline: m.getAttribute('style'), classes: [...m.classList], computed: getComputedStyle(m).display})`. If `inline === "display:none;"` and `computed === "none"` → it's the inline-vs-class bug (this codebase's pet bug). Patch JS to set inline `display='flex'` on open + clear on close, not the click path. (Memory updated with this debug heuristic + a "wrong-cause trap" note tying back to commit `f9722b4` → `9133acd`.)
