# Active task plan — Dashboard.html multi-issue session (2026-05-17)

User reported 14 issues across dashboard.html. Investigation completed via 9 parallel Explore agents. Below = grouped by category with root cause, blast radius, and proposed fix. Per CLAUDE.md §1 Plan-First: WAIT for user approval before implementing.

---

## A. CONFIRMED BUGS — root cause identified, ready to fix (low risk)

### A1. [ ] Sidebar "เปลี่ยนรหัสผ่าน" button — modal never opens
- **Root cause:** Anti-pattern §7-C. `#changePasswordModal` (`dashboard.html:5487`) has inline `style="display:none;"`. `openChangePasswordModal()` (`shared/dashboard-extra.js:2`) only removes `.u-hidden` class — inline style wins, modal stays hidden. Button IS clickable; modal just doesn't appear.
- **Why:** Per §7-C decision rule, if no CSS rule binds `display:none` to the modal class, must explicitly set `style.display = 'flex'`/`'none'`.
- **Fix:** Update `openChangePasswordModal()` to `modal.style.display='flex'` + `classList.remove('u-hidden')`; update `closeChangePasswordModal()` to `modal.style.display='none'` + `classList.add('u-hidden')`.

### A2. [ ] Service Providers — "+เพิ่ม" form never opens
- **Root cause:** Same anti-pattern §7-C. `#addProviderForm` (`dashboard.html:4849`) has inline `style="display: none"`. `toggleAddProviderForm()` (`shared/dashboard-extra.js:3079`) toggles `.u-hidden`. Form never shows when user clicks add — that's why "cannot add phone and details" — they can't fill ANY field because form doesn't appear.
- **Fix:** Remove inline `style="display:none"` from `dashboard.html:4849`, add `class="u-hidden"` instead. Verify `editServiceProvider` flow also works.
- **Note:** A `details`/`description` field does NOT exist in this form's schema. If user wants one added, see **C6** below.

### A3. [ ] Community Events — "+เพิ่มอีเว้นต์" form never opens
- **Root cause:** Same anti-pattern §7-C. `#addEventForm` (`dashboard.html:4206`) has inline `style="display: none"`. Introduced when CSP-phase 3 commit `c7a7817` migrated JS away from inline styles but missed this HTML element.
- **Fix:** Remove inline `style="display:none"`, add `class="u-hidden"`.

### A4. [ ] Community Documents — upload silently fails
- **Root cause:** `fs.setDoc()` Promise not awaited at `shared/dashboard-extra.js:3481`. Function `saveCommunityDocument()` is not `async`. Errors silently dropped; toast says "success" while no doc exists. Anti-pattern §7-N family (silent failure).
- **Fix:** Make function `async`, add `await`, wrap in try/catch with error toast. Mirror `saveCommunityEvent()` at line 3336.

### A5. [ ] Community Events — events look greyed/archived (even active ones)
- **Root cause:** `shared/dashboard-extra.js:3283` applies `opacity:0.65` when `isPast` is true (computed at line 3265-3280: `new Date(e.date) < today` with today at midnight). Same-day events with no time component get flagged past. Stored events likely have date-only strings.
- **Fix:** Treat same-day events as future (use `<=` not `<` against start of today, OR compare end-of-day). Live-verify after deploy.

### A6. [ ] Tenant Information stats row shows 0 (KPI race condition)
- **Root cause:** `shared/dashboard-extra.js:850` calls `updateOccupancyDashboard()` on `DOMContentLoaded`, BEFORE `initializeCloudData()` (line 853) populates localStorage from Firebase. KPI elements show 0/empty until user navigates to tenant page (which triggers `_setupTenantRealtimeListener` and reloads stats). "23 ห้อง | 0 มีผู้เช่า" is the symptom.
- **Fix:** Trigger `updateOccupancyDashboard()` + `updateLeaseExpiryAlerts()` as a callback after the FIRST non-empty snapshot from `_setupTenantRealtimeListener` (`shared/dashboard-tenant-page.js:191`). Also wire to `roomconfig-updated` event. Anti-pattern §7-K cousin (defined but not wired at the right time).
- **Note on "(ต้องมี 1 คน)":** User-side observation, not in code. After fix this should show real occupied counts.

### A7. [ ] Lease list — room 15 latest contract rent = 0 baht
- **Root cause:** `lease.rentAmount` is FROZEN at lease creation (`shared/dashboard-extra.js:1932`). When lease was created for room 15, `RoomConfigManager.getRentPrice('rooms','15')` returned 0 (rent wasn't configured at THAT moment). Subsequent rent updates in "จัดการห้อง" don't propagate to existing leases. The display at `shared/dashboard-extra.js:1884` reads `lease.rentAmount` directly.
- **DECISION NEEDED → C4 below.**

### A8. [ ] Live Feed — "amazon" / ร้านใหญ่ double-counted in HISTORICAL_DATA aggregates
- **Suspected root cause:** `shared/dashboard-home-live.js:312` sums `m.rooms[4] + m.nest[4] + m.amazon[4]`. Per `feedback_naming_amazon_raan_yai.md` + MEMORY.md, "amazon" is NOT a building — it's tenant unit ร้านใหญ่ INSIDE `rooms` building. If meter-import code wrote separate `amazon` totals AND included ร้านใหญ่ in `rooms` totals, the sum double-counts.
- **Sub-issue:** legacy localStorage may still hold pre-Tier-3F bills under old paths.
- **Action:** Need user to point us to the exact "36 ห้อง" widget (screenshot). Then fix the specific count path. See **B1** below.

---

## B. CLARIFICATIONS NEEDED — questions for user

### B1. Live Feed: WHERE exactly does "36 ห้อง" appear?
- Meter table row count is bounded by `_getRoomsList(bld)` which returns 23 for `rooms`. So the "36" must be from a different widget — likely a HISTORICAL_DATA-driven trend, or paid-rooms aggregator summing both buildings.
- **Ask:** Screenshot the widget showing "36" so we target the exact code line.

### B2. Live Feed: month showing "พฤษภาคม" (May) — should be "สิงหาคม" (August)?
- Code is `now.getMonth()+1` → returns whatever the user's clock reports. System date here is 2026-05-17 → May is correct.
- **Ask:**
  - (a) นาฬิกาเครื่องผู้ใช้บอกเดือนอะไรจริงๆ?
  - (b) ถ้าบอก May แต่ user อยากเห็น August หมายถึง business logic เลื่อนไป 3 เดือน (e.g., สั่งจองสิงหา) หรือเปล่า?
  - (c) หรือเป็น cached value ของระบบที่ stale ไม่ refresh?

---

## C. DECISIONS — needed before feature implementation

### C1. Owner page redesign scope
- (a) **light polish** — typography sizing up for seniors, better grouping, no structural change
- (b) **restructure** — split into separate pages: Owner Profile / Branding / Building Internet
- (c) **full senior-UX redesign** — bento layout, larger touch targets, simplified wording, mobile-first

### C2. Owner > Per-room WiFi config (Nest tenants)
- (a) **status quo** — no per-room WiFi field. Tenant only sees realtime device measurement
- (b) **admin enters per-room SSID + connection notes** — adds field to Nest room config; security concern if storing WiFi password
- (c) **tenant self-reports** — tenant_app gets a field for them to save their room's WiFi info locally (for self-reference)

### C3. Lease list rent — LIVE vs FROZEN display
- (a) **live** — always read `RoomConfigManager.getRentPrice()`; cleanest but loses historical accuracy
- (b) **frozen + refresh button** — keep frozen, add "🔄 ดึงราคาปัจจุบัน" per row
- (c) **one-shot backfill** — migration script scans leases, fills `rentAmount` where currently 0 from current Room Mgmt. Future leases use the at-creation value (unchanged behavior).

### C4. Merge ประกาศ + events strategy
- (a) **light** — keep collections, cross-link in admin UI only, label them clearly
- (b) **schema unification** — new `announcements/{id}` collection with `type: 'event'|'broadcast'`, new `publishAnnouncement` CF, deprecate `broadcastMessage` CF + `communityEvents` writes (2-3 sessions, significant change)
- (c) **defer** — flag for future planning; ship A bug fixes first

### C5. Gamification — monthly quota scope
- (a) **per-reward `monthlyQuota`** — admin sets max claims/month per reward item
- (b) **per-reward + global** — also a tenant-wide cap (max total claims/month across all rewards)
- (c) **with stock count** — also `totalStock` field for one-time rewards
- All include: replace plain-text "note" with structured alert that auto-renders when quota gets low (e.g., 80%).

### C6. LINE unlink — soft vs hard delete
- (a) **soft** — set `status='unlinked'`, `unlinkedAt`, `unlinkedBy` on `liffUsers/{id}` (keep doc for audit)
- (b) **hard delete + separate audit log** — delete `liffUsers/{id}`, write to `audit/lineLinks`
- (c) **soft + tenant doc cleanup** — soft on liffUsers + clear `linkedAuthUid` from `tenants/{b}/list/{r}` + clear `lineUserId`/`linkedAuthUid`/`lineDisplayName` from `people/{tenantId}` (recommended — otherwise tenant_app may still think they're linked)

### C7. Service Providers — add new "details/description" field?
- (a) **add textarea** — admin writes multi-line description (specializations, address, hours)
- (b) **skip** — user may have meant existing fields; confirm and move on

---

## D. CONFIRMED ANSWERS (informational, no work required)

### D1. Buildings (Multi-Property) → Rooms flow
**Answer:** เพิ่ม Building ใหม่ → Dropdown ในหน้า "จัดการห้องพัก" อัพเดตอัตโนมัติ via `buildingRegistryChanged` event (`shared/dashboard-building-selects.js:100`). **แต่ห้องไม่สร้างอัตโนมัติ** — admin ต้องเข้าหน้า "จัดการห้องพัก" → เลือก Building ใหม่ → เพิ่มห้องทีละห้องเอง (Room ID + ชื่อ + ราคา + อัตราค่าน้ำไฟ).

### D2. Internet Status scope (intro to B/C2)
**Answer:** "สถานะอินเตอร์เน็ตอาคาร" คือเน็ตส่วนกลางของอาคาร เก็บที่ `buildings/{id}.internet` (ISP, ความเร็ว, status). **ไม่มี per-room WiFi config ในระบบตอนนี้** — ลูกบ้านดูแค่ realtime ของ device ผ่าน `navigator.connection`. Browser ไม่ยอมให้อ่าน SSID/password ของ WiFi (security restriction).

---

## E. UI/UX TWEAKS

### E1. [ ] Move "ตรวจสอบห้องว่าง" widget above the meter table
- File: `dashboard.html` Live Feed section. Should be straightforward DOM reorder.

### E2. [?] Plan for "vacant room with pending unpaid meter/bill"
**Sub-decision:**
- (a) Show as "ห้องว่าง — มีค้าง" with badge in meter table
- (b) Leave pending bill; admin clears manually
- (c) Auto-cancel all bills when room status = vacated

### E3. [ ] LINE Link Requests — Unlink button (depends on C6)

---

## EXECUTION ORDER (proposed)

**Phase 1 — bug fixes, low risk, ship together (anti-pattern §7-C trio + async + race):**
A1 + A2 + A3 + A4 + A5 + A6 + E1 → single commit/PR, live-verify on Vercel.

**Phase 2 — gather clarifications:**
User answers B1, B2, plus chooses options in C1-C7 + E2.

**Phase 3 — feature work driven by decisions:**
C-series + E2 + E3 + A7 (per C3 choice) + A8 (per B1 evidence).

---

## REVIEW (2026-05-17 session shipped)

**Shipped to main (5 commits):**

| Commit | Scope | Files |
|---|---|---|
| `43be065` | Phase 1 bundle — A1-A6 + E1 | dashboard.html · shared/dashboard-extra.js · shared/dashboard-tenant-page.js |
| `7897dec` | C7 + E2 — provider details + vacant badge | dashboard.html · shared/dashboard-extra.js · shared/dashboard-home-live.js |
| `febde77` | C1 — Owner page light polish | shared/dashboard-extra.js |
| `13f7a82` | C6 — LINE unlink CF + admin button | functions/unlinkLiffUser.js (NEW) · functions/index.js · shared/dashboard-main.js · dashboard.html |
| `2f70c80` | C5 — Gamification monthly quota + alert | functions/redeemReward.js · dashboard.html · shared/dashboard-extra.js · tenant_app.html |

### Phase 1 fixes (anti-pattern §7-C trio + 4 more)
- A1 ✅ Change password modal — explicit display:flex/none (modal had inline style + class toggle mismatch)
- A2 ✅ Service Providers form — removed inline style:display:none, added u-hidden class
- A3 ✅ Community Events add form — same §7-C fix
- A4 ✅ Documents upload — async/await + rollback toast; also fixed addDocForm §7-C
- A5 ✅ Events archived greyed-out — removed opacity:0.65, kept (ผ่านแล้ว) tag
- A6 ✅ Tenant stats race — wired updateOccupancyDashboard + updateLeaseExpiryAlerts to tenant-realtime snapshot
- A7 ✅ Lease list rent — read live from RoomConfigManager.getRentPrice (decision C3)
- E1 ✅ Live Feed — vacant card moved above meter table + duplicate class attr fix

### Phase 2 features (per user decisions)
- C7 ✅ Service Providers — new "รายละเอียด/Details" textarea (HTML + save/edit/render)
- E2 ✅ Live Feed — "🟡 ว่าง — มีค้าง" orange badge for vacant rooms with meter usage + tinted row + summary pill
- C1 ✅ Owner page — light polish: 3 section cards (Owner / Address / Bank+Tax), labels 1rem, auto-fit responsive grid, Save vs Delete distinct
- C6 ✅ LINE unlink — atomic CF `unlinkLiffUser` (admin SDK): soft-delete liffUsers + clear linkedAuthUid from tenants/{b}/list/{r} + clear LINE fields from people/{tenantId}. Admin UI: outlined-red button on approved entries + 4th "🔌 ยกเลิกแล้ว" count card
- C5 ✅ Gamification monthly quota — `monthlyQuota` per reward (admin), enforced in `redeemReward` CF transaction (both tenant + player branches). Tenant sees "🎯 N ครั้ง/เดือน" badge; admin's note becomes alert text (orange) when quota set. Quota=0 = unlimited (back-compat)

### Decisions confirmed (no work needed)
- **D1** Buildings → Rooms: Dropdown auto-updates via `buildingRegistryChanged` event; rooms must be added manually in Room Management
- **D2 / C2** Internet status: Building-wide only, status quo; per-room WiFi NOT in scope (browser security blocks reading SSID/password)
- **C4** Merge ประกาศ + events: Deferred — bug fixes priority

### ⚠️ Pending CF deploys (user must run interactively)
Both new CFs are CODE-shipped but require user to run from interactive terminal (SLIPOK_API_URL env var requires interactive prompt):

```bash
firebase deploy --only functions:unlinkLiffUser,functions:redeemReward
```

Until deployed:
- 🔌 ยกเลิกการเชื่อม button visible but will fail
- Monthly quota field saved by admin but NOT enforced — tenants can over-claim

### ⏳ Awaiting user input
- **B1**: Screenshot of "36 ห้อง" widget — need exact location to debug data redundancy. Code paths checked: meter table is bounded by `_getRoomsList(bld)` returning ~23, so the 36 must be in a HISTORICAL_DATA aggregator (`dashboard-home-live.js:312` sums `m.rooms[4]+m.nest[4]+m.amazon[4]` which can double-count ร้านใหญ่)
- **B2**: Clarify whether dashboard month should be August vs May — code uses `now.getMonth()+1`; system date is 2026-05-17. Need to confirm whether user's local clock differs OR business logic needs change

### Followup candidates (not in scope this session)
- C4 announcement+events unification (architectural — 2-3 sessions)
- E3 same as C6, shipped
- Real-time remaining-quota counter for tenant rewards page (currently shows max only)
- Cleanup HISTORICAL_DATA `m.amazon` double-count (depends on B1 confirmation)

---

## WHY (overall)

Three of the bugs share the SAME anti-pattern (§7-C: inline `style="display:none"` vs class `u-hidden`). Fixing them in one commit is efficient and showcases the recurring CSP-migration pattern. The CSP-phase-3 commit `c7a7817` migrated JS away from inline styles but missed updating HTML attributes — that's the common origin.

The tenant stats race (A6) and rent-frozen issue (A7) are SoT-coherency bugs that the user explicitly flagged as "ข้อมูลส่วนนี้ยังไม่เชื่อมจริงๆเลย" — fixing them rebuilds trust in dashboard accuracy before any redesign work begins.

LINE unlink (E3) and announcement merge (C4) are architectural ADDITIONS not bug fixes — they need user decision on scope before code is written.
