# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Plan — Tier 3c + 3G + 3I (2026-05-13)

## Overview & priority order

Three independent features. Tier 3c is smallest (one session); 3G and 3I are each one full session.
Proposed execution order: **3c → 3G → 3I**.

---

## TIER 3C — Dynamic listener iteration + per-building auth scoping

### Why
- 6 dashboard modules still hardcode `['rooms','nest']` → new buildings get no realtime updates, no insights, no request-admin queries.
- `liffSignIn.js:146` hardcodes the same set → tenants in new buildings cannot sign in via LIFF (CF rejects their token).
- Per-building auth scoping (SaaS prep): a property manager should log in and see only their building — requires `managedBuildings` custom claim + Firestore rules helper.

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Dynamic listener rebuild trigger | re-call `_setupTenantRealtimeListener` on `buildingRegistryChanged` event | registry already fires this on refresh; zero extra polling |
| Fallback when registry not yet loaded | `BuildingRegistry.list()` returns FALLBACK `['rooms','nest']` synchronously | existing guard in building-registry.js:list() |
| liffSignIn building validation | swap hardcoded `includes` for `await getValidBuildings(db)` (5-min cache already exists in buildingRegistry.js helper) | consistent with CF pattern; safe for prod |
| Per-building auth claims | new `managedBuildings: string[]` custom claim; granted via `grantBuildingManager` HTTPS-callable CF (admin-only) | mirrors existing `admin: true` claim pattern |
| Firestore rules scoping | add `isBuildingManager(building)` helper; apply to `tenants/{building}/**` and `bills/*` RTDB paths for read | write still requires global admin; manager = read + limited update |
| Dashboard UI for manager role | "My Buildings" filter on dashboard nav (hide other buildings when `managedBuildings` claim present) | minimal footprint; full manager dashboard is Tier 3d |

### Files changed

| File | Change |
|---|---|
| `shared/dashboard-tenant-page.js:189` | Replace `['rooms','nest'].forEach` with `BuildingRegistry.list().map(b=>b.id).forEach` |
| `shared/dashboard-extra.js:1871` | Same dynamic swap |
| `shared/dashboard-extra.js:2068` | Same dynamic swap |
| `shared/dashboard-insights.js:109` | Same dynamic swap |
| `shared/dashboard-insights.js:735` | Same dynamic swap |
| `shared/dashboard-requests-admin.js:1433` | Same dynamic swap |
| `shared/dashboard-tenant-page.js` | Add `buildingRegistryChanged` event listener → re-call `_setupTenantRealtimeListener` |
| `functions/liffSignIn.js:146` | Swap hardcoded `['rooms','nest'].includes(building)` → `(await getValidBuildings(admin.firestore())).has(building)` |
| `functions/liffSignIn.js` | Add `require('./buildingRegistry')` import (already in repo) |
| `shared/dashboard-buildings.js` | Add `ownerEmail` + `ownerUid` fields to building form + card display |
| `functions/grantBuildingManager.js` | NEW: `onCall` CF (admin only); sets `managedBuildings` custom claim on target user UID |
| `firestore.rules` | Add `isBuildingManager(building)` helper; apply read permission on `tenants/{building}/list/**` |
| `firestore.rules.test.js` | Add `describe('building manager — scoped read, no write')` block |
| `tools/grant-building-manager.js` | NEW: CLI script (mirrors grant-admin-claim.js) |

### Phases

- [ ] **3c-1 — Dynamic arrays (6 files):** Swap all hardcoded `['rooms','nest']` in dashboard JS to `BuildingRegistry.list().map(b=>b.id)`. Add `buildingRegistryChanged` re-trigger in `dashboard-tenant-page.js`.
- [ ] **3c-2 — liffSignIn dynamic validation:** Import `buildingRegistry` helper; replace hardcoded `includes` with `getValidBuildings` async check. Deploy this CF before seeding new buildings.
- [ ] **3c-3 — Building doc: ownerEmail/ownerUid fields:** Extend building form + card in `dashboard-buildings.js`; add fields to building schema comment in `building-registry.js`.
- [ ] **3c-4 — `grantBuildingManager` CF + tool script:** `onCall` that takes `{ targetUid, buildings: string[] }`; verifies caller is admin; sets `managedBuildings` custom claim; mirrors `grant-admin-claim.js` tool.
- [ ] **3c-5 — Firestore rules `isBuildingManager`:** Helper + apply to `tenants/{building}/list/**` read path. Verify existing rules tests still pass.
- [ ] **3c-6 — Tests + verify:** Add building-manager test cases. Push → verify LIFF sign-in still works for `rooms`/`nest` on Vercel.

---

## TIER 3G — Facility Booking (parking / laundry / rooftop)

### Why
Tenants currently have no self-service way to reserve shared facilities. Admin manages ad-hoc. Atomic slot booking prevents double-booking and creates an audit trail.

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Separate collection from room `bookings/` | `facilityBookings/{bookingId}` | different lifecycle, different actors; room bookings are prospect-facing, facility bookings are tenant-facing |
| Slot granularity | daily time-slot (morning/afternoon/evening/fullday) | matches Thai apartment patterns; hourly adds UX complexity without benefit for MVP |
| Facility config location | `facilityConfig/{building}_{facilityType}` Firestore doc | building-scoped; admin edits; client reads |
| Atomic lock pattern | Firestore transaction in `createFacilityBooking` CF (same pattern as `createBookingLock`) | proven, idempotent |
| LINE notification | Fire-and-forget via `enqueueLineRetry` on confirmation (admin gets notified) | reuse existing notification pipeline |
| Tenant UI location | New page `data-page="facility-booking"` in `tenant_app.html` | consistent with existing page architecture |
| Admin UI location | Sub-tab inside existing "Requests" admin page | low footprint; requests is the natural admin triage hub |

### Firestore schema

```
facilityBookings/{bookingId}
  building:       string
  facilityType:   'parking' | 'laundry' | 'rooftop' | 'other'
  slot:           string        // e.g. 'A1', 'machine-1', 'rooftop'
  date:           string        // 'YYYY-MM-DD' (BE)
  timeSlot:       string        // 'morning'|'afternoon'|'evening'|'fullday'
  tenantUid:      string
  tenantRoom:     string
  tenantBuilding: string
  tenantName:     string
  status:         'confirmed' | 'cancelled' | 'no_show'
  cancelledBy:    'tenant' | 'admin' | null
  createdAt:      Timestamp
  updatedAt:      Timestamp

facilityConfig/{building}_{facilityType}
  building:       string
  type:           'parking' | 'laundry' | 'rooftop' | 'other'
  displayName:    string        // 'ที่จอดรถ'
  slots:          [{id, label, enabled}]
  timeSlots:      [{id, label}] // e.g. [{id:'morning',label:'เช้า (08-12)'}]
  maxAdvanceDays: number        // how far ahead tenants can book
  active:         boolean
  updatedAt:      Timestamp
```

### Files changed

| File | Change |
|---|---|
| `shared/facility-booking.js` | NEW: `FacilityBookingManager` — `listConfig(building)`, `listBookings(building,date)`, `createBooking(data)`, `cancelBooking(bookingId)`, `_subscribeBookings(cb)` |
| `tenant_app.html` | New page `facility-booking`: facility type selector → date picker → slot grid → confirm modal. Subscribe live updates via `FacilityBookingManager`. Uses `_onLiffClaimsReady`. |
| `dashboard.html` | Facility sub-tab in Requests page: calendar view by facility type + building; config panel (add/edit slots per facility). |
| `shared/dashboard-requests-admin.js` | Add `initFacilityBookingsTab()` + `initFacilityConfigPanel()` |
| `functions/createFacilityBooking.js` | NEW: onCall — validates building (getValidBuildings), checks slot availability in Firestore tx, writes `facilityBookings/{id}`, fires LINE notification to admin |
| `functions/cancelFacilityBooking.js` | NEW: onCall — tenant may cancel own future booking; admin may cancel any |
| `firestore.rules` | `facilityBookings` (tenant write own building, admin all) + `facilityConfig` (admin write, signed-in read) |
| `firestore.rules.test.js` | Facility booking rules tests |
| `dashboard.html` | Script tag for `facility-booking.js` |

### Phases

- [ ] **3G-1 — Firestore schema + rules:** Add `facilityBookings` + `facilityConfig` rules + tests. Run `npm run test:rules`.
- [ ] **3G-2 — `shared/facility-booking.js`:** Client module with CRUD + live subscription.
- [ ] **3G-3 — `createFacilityBooking` CF:** Atomic slot check + write + LINE notify.
- [ ] **3G-4 — `cancelFacilityBooking` CF:** Status update + auth guard.
- [ ] **3G-5 — Tenant UI in `tenant_app.html`:** Facility type selector → calendar → slot grid → confirm flow.
- [ ] **3G-6 — Admin UI in `dashboard.html`:** Facility tab in Requests: bookings view + config panel.
- [ ] **3G-7 — Seed facility config docs:** Admin UI → seed parking/laundry/rooftop config for `rooms` + `nest`.
- [ ] **3G-8 — Verify on Vercel:** Tenant books a slot → appears in admin view → admin cancels → tenant sees cancelled state.

---

## TIER 3I — Digital Move-In/Out Checklist (photos + e-signature + Storage)

### Why
No formal room-condition record exists at move-in/out. Without it, deposit disputes are unresolvable and the platform has legal exposure. This creates a timestamped, multi-party-signed document stored in Storage.

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Template model | Per-building Firestore doc `checklistTemplates/{building}` with `items[]` array | simple; building-level customization; no versioning needed for MVP |
| Instance lifecycle | `pending → tenant_signed → admin_signed → completed` | two-party sign-off matches Thai lease law; tenant confirms condition, admin co-signs |
| E-signature | HTML Canvas (`<canvas>`) with touchmove/mousemove draw → save as PNG to Storage | no third-party lib needed; proven pattern (similar to receipt canvas) |
| Photo upload | Tenant photographs each checklist area via `<input type="file" capture="environment">` → compress to JPEG → Storage | reuses existing upload pattern from pets/leases |
| Photo Storage path | `checklists/{building}/{roomId}/{instanceId}/photos/{photoId}` | consistent with existing per-room Storage hierarchy |
| Signature Storage path | `checklists/{building}/{roomId}/{instanceId}/signatures/{role}.png` | `role` = `tenant` or `admin` |
| PDF export | html2canvas of the completed instance → canvas toDataURL → download PNG (same as receipt) | no jsPDF needed; PNG legally acceptable for internal records |
| Trigger | Admin creates instance from Tenant modal (move-in/out action); link to leaseId | natural entry point; admin already opens tenant modal for these actions |
| Tenant access | `tenant_app.html` — "เช็คลิสต์" page; lists pending checklists; tenant fills + signs | uses `_onLiffClaimsReady`, scoped to `token.building/room` |

### Firestore schema

```
checklistTemplates/{building}
  items: [{
    id:       string,
    area:     string,    // 'ห้องนอน', 'ห้องน้ำ', 'ครัว', ...
    label:    string,    // 'พัดลมเพดาน'
    type:     'checkbox' | 'rating' | 'text',
    required: boolean
  }]
  updatedAt: Timestamp
  updatedBy: string

checklistInstances/{instanceId}
  building:          string
  roomId:            string
  tenantId:          string
  tenantName:        string
  type:              'move_in' | 'move_out'
  status:            'pending' | 'tenant_signed' | 'admin_signed' | 'completed'
  leaseId:           string
  items: [{
    id:        string,
    value:     any,      // bool / 1-5 / text
    notes:     string,
    photoUrls: string[]
  }]
  tenantSignatureUrl:  string | null
  adminSignatureUrl:   string | null
  tenantSignedAt:      Timestamp | null
  adminSignedAt:       Timestamp | null
  createdAt:           Timestamp
  completedAt:         Timestamp | null
```

### Files changed

| File | Change |
|---|---|
| `shared/checklist-manager.js` | NEW: `ChecklistManager` — `getTemplate(building)`, `saveTemplate(building, items)`, `getInstance(id)`, `listPending(building,room)`, `_subscribe(cb)` |
| `tenant_app.html` | New page `checklist`: list pending instances → fill items (per area) → photo upload per item → signature canvas → submit |
| `dashboard.html` | Checklist sub-tab in Tenant modal: "สร้างเช็คลิสต์" button → trigger move-in/out instance. Template editor tab in Buildings page. |
| `shared/dashboard-tenant-page.js` | Add checklist trigger button + `openChecklistInstanceViewer(instanceId)` in tenant modal |
| `shared/dashboard-buildings.js` | Template editor: item CRUD for `checklistTemplates/{building}` |
| `functions/createChecklistInstance.js` | NEW: onCall (admin) — validates building/room/type/leaseId; writes instance with `status:'pending'` |
| `functions/submitChecklist.js` | NEW: onCall (tenant, auth-gated to own building+room) — validates items completeness; sets `tenantSignatureUrl`; advances status to `tenant_signed`; notifies admin via LINE |
| `functions/adminSignChecklist.js` | NEW: onCall (admin) — sets `adminSignatureUrl`; sets `status:'completed'`; sets `completedAt` |
| `storage.rules` | New `checklists/{building}/{roomId}/{instanceId}/{path=**}` path — tenant write own building+room, admin all, signed-in read |
| `firestore.rules` | `checklistTemplates` (admin write, signed-in read) + `checklistInstances` (admin create, tenant update own when pending/tenant_signed, admin update always) |
| `firestore.rules.test.js` | Checklist rules tests |

### Phases

- [ ] **3I-1 — Firestore + Storage rules:** `checklistTemplates` + `checklistInstances` + `checklists/` Storage path. Tests.
- [ ] **3I-2 — `shared/checklist-manager.js`:** Client module.
- [ ] **3I-3 — `createChecklistInstance` CF:** Admin-callable; validates + writes.
- [ ] **3I-4 — `submitChecklist` CF:** Tenant-callable; validates items + signature URL; advances status.
- [ ] **3I-5 — `adminSignChecklist` CF:** Admin-callable; co-signs + completes.
- [ ] **3I-6 — Template editor in `dashboard.html`/`dashboard-buildings.js`:** Admin CRUD for `checklistTemplates/{building}`.
- [ ] **3I-7 — Instance trigger in Tenant modal:** "สร้างเช็คลิสต์" button wired to `createChecklistInstance` CF; instance viewer reads live status.
- [ ] **3I-8 — Tenant app checklist page:** Pending list → fill form (per area) → photo upload → signature canvas → submit.
- [ ] **3I-9 — Admin co-sign panel:** View completed tenant form + photos + tenant signature → admin signs canvas → `adminSignChecklist` CF.
- [ ] **3I-10 — PNG export:** html2canvas of completed instance → download.
- [ ] **3I-11 — Verify on Vercel:** Admin creates instance → tenant fills + signs → admin sees in dashboard → admin co-signs → instance `completed` → PNG export works.

---

## Out of scope (Tier 3d+)

- Per-building LIFF IDs / per-building LINE OA (needs LINE Developer setup per owner)
- Full manager dashboard (building manager logs in, sees only their building — currently global admin only)
- SaaS billing / subscription gating
- Facility booking LINE push to tenant (Tier 3G+: low priority, admin gets notified for MVP)
- Checklist versioning (template edits don't affect in-flight instances)
- Offline checklist mode (PWA camera + offline sync)

---

# Plan — Feature F: Multi-Property Support (Tier 3)

## Why

Adding a new building today requires changes in 9+ Cloud Function files, 3 shared JS modules,
and dashboard.html. After this session, a new property is onboarded entirely from the admin UI —
no code changes needed.

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Registry | `buildings/{id}` root Firestore doc | Collection + rules already exist; admin write, signed-in read |
| Room config | RTDB `rooms_config/{building}/{roomId}` (existing RoomConfigManager) | Proven pattern; no migration needed |
| CF validation | `functions/buildingRegistry.js` with 5-min in-memory cache | Avoids Firestore read on every CF invocation |
| Dashboard selector | Dynamic from Firestore; fallback to `rooms`/`nest` if empty | Zero breakage if docs don't exist yet |
| LINE OA / LIFF | Out of scope | Single OA serves all buildings via claims; per-OA needs LINE Developer setup |
| Multi-owner auth | Out of scope | Tier 3b |

## Building root-doc schema (`buildings/{id}`)

```json
{
  "displayName": "Nature Haven",
  "address":     "...",
  "promptPayId": "...",
  "contact":     "...",
  "status":      "active",
  "createdAt":   serverTimestamp(),
  "createdBy":   "uid"
}
```

Room config stays in RTDB `rooms_config/{building}/{roomId}` via RoomConfigManager (unchanged).

## Files

| File | Change |
|------|--------|
| `shared/building-registry.js` | NEW — client module, loads buildings from Firestore |
| `dashboard.html` | Add script tag; replace 3 hardcoded button sets with dynamic render; add Buildings page + nav |
| `functions/buildingRegistry.js` | NEW — CF helper, `getValidBuildings()` + `getAllBuildings()` with 5-min cache |
| `functions/aggregateMonthlyRevenue.js` | Replace `BUILDINGS = ['rooms','nest']` with `await getAllBuildings(db)` |
| `functions/cleanupOldDocs.js` | Same |
| `functions/remindLatePayments.js` | Same |
| `functions/remindLeaseExpiry.js` | Same |
| `functions/archiveTenantOnMoveOut.js` | Replace `VALID_BUILDINGS = new Set([...])` with `await getValidBuildings(db)` |
| `functions/createBookingLock.js` | Same |
| `functions/getRoomAvailability.js` | Same |
| `functions/transitionToPlayer.js` | Same |
| `functions/revertTransitionToPlayer.js` | Same |
| `firestore.rules` | No change — buildings rules already correct |
| `firestore.rules.test.js` | Add buildings CRUD describe block |

## Phases

- [ ] **Phase 1 — `shared/building-registry.js`**: Loads `buildings` collection (status=='active') from Firestore. Exports `window.BuildingRegistry` with `list()`, `getById(id)`. Fallback to hardcoded `rooms`/`nest` if collection empty.

- [ ] **Phase 2 — Admin Buildings page in `dashboard.html`**: New page section (id=`page-buildings`): building cards (id, displayName, address, status) + "เพิ่มอาคาร" button → modal form (slug, displayName, address, promptPayId, contact) → Firestore `addDoc`. Edit building via same modal pre-filled. Sidebar nav entry.

- [ ] **Phase 3 — Dynamic building selectors**: Replace 3 sets of hardcoded buttons (Tenant tab, Announcements tab, PVM tab) with `BuildingRegistry.list()` rendered on init. "ทุกตึก" option added where appropriate.

- [ ] **Phase 4 — `functions/buildingRegistry.js`**: Helper module: `getValidBuildings(db)` → `Promise<Set<string>>`, `getAllBuildings(db)` → `Promise<string[]>`. In-memory cache, 5-min TTL. Falls back to `['rooms','nest']` if Firestore unavailable (safety net for seeding lag).

- [ ] **Phase 5 — Update 9 CFs**: Iteration CFs get `await getAllBuildings(db)`. Validation CFs get `await getValidBuildings(db)`. Remove hardcoded arrays.

- [ ] **Phase 6 — Firestore rules test**: Add `describe('buildings — admin CRUD, tenant read, anon denied')` block. Run `npm run test:rules`.

- [ ] **Phase 7 — Seed `buildings/rooms` + `buildings/nest`**: Use the admin UI to create both buildings as proper Firestore docs so the dynamic selectors work on live.

- [ ] **Phase 8 — Verify on Vercel**: Push → dashboard Buildings page visible → create test building → appears in all selectors → add a test tenant doc for that building → CF doesn't reject → delete test building.

## Out of scope

- Per-building LIFF IDs
- Per-building LINE OA
- Multi-owner auth / SaaS billing
- Migrating NEST_ROOMS / ROOMS_NEW to Firestore (stay as static fallback)
- Changing `tenant_app.html` (LIFF claims already carry building info)

---

## Review

### Shipped (commit `0fdc0d2`, merge `355edcf` → main)

**Phase 1 ✅** `shared/building-registry.js` — client module exposes `window.BuildingRegistry` with `init/list/getById/create/update/archive/refresh`. Reads `buildings` collection from Firestore; falls back to hardcoded `['rooms','nest']` when collection is empty or Firestore unavailable.

**Phase 2 ✅** Admin Buildings page in `dashboard.html` — sidebar nav "🏘️ Buildings", `page-buildings` cards grid, `buildingFormModal` (slug, displayName, address, promptPayId, contact, companyName, ownerName). All CRUD goes through `BuildingRegistry`. `shared/dashboard-buildings.js` owns the page logic (`initBuildingsPage/openBuildingModal/saveBuildingForm/archiveBuildingPrompt`).

**Phase 3 ✅** Announcements building selector now dynamically renders from `BuildingRegistry.list()` on page init (`_renderAnnouncementBuildingTabs` in `dashboard-content-features.js`). **Deferred to Tier 3b:** Tenant tab + PVM tab selectors — their handlers (`setTenantBuilding`, `setPVMBuilding`) have hardcoded `bld==='old'/'new'/'nest'` branches that call building-specific init functions (`initRoomsPage`/`initNestPage`). Truly dynamic selectors need those handlers refactored into generic per-building inits, which is its own session.

**Phase 4 ✅** `functions/buildingRegistry.js` — CF helper with 5-min in-memory cache. Exports `getAllBuildings()` (Promise<string[]>) for iteration CFs and `getValidBuildings()` (Promise<Set>) for validation CFs. Falls back to `['rooms','nest']` if Firestore read fails.

**Phase 5 ✅** 9 CFs migrated off hardcoded constants:
- Iteration: `aggregateMonthlyRevenue` (`EMPTY_MONTH().byBuilding` now built dynamically too), `cleanupOldDocs`, `remindLatePayments`, `remindLeaseExpiry`
- Validation: `archiveTenantOnMoveOut`, `createBookingLock`, `getRoomAvailability`, `transitionToPlayer`, `revertTransitionToPlayer`

All 97/97 unit tests pass.

**Phase 6 ✅ (with caveat)** Added `describe('buildings — admin CRUD, signed-in read')` block to `firestore.rules.test.js` with 11 test cases (admin create/update/archive/read, LIFF-tenant read/deny-write, accountant read/deny-write, anon deny). **Caveat:** Java not installed in this environment, so emulator-based rules tests can't run locally. Rules themselves are unchanged (existing `buildings/{id}` rule already allows admin write, signed-in read). Tests will run in CI / Java-enabled developer envs.

**Phase 7+8 ✅ (static deploy verified, functional needs admin login)**
Vercel deploy verified live on https://the-green-haven.vercel.app/dashboard:
- `building-registry.js` + `dashboard-buildings.js` both load (3.3KB + 8.0KB)
- Sidebar shows "🏘️ Buildings" entry
- `page-buildings` + `buildingFormModal` present in DOM
- `window.BuildingRegistry` populated; `list()` returns fallback `['rooms','nest']` correctly when unauthenticated
- No console errors

### Pending — needs user action

1. **Admin login + seed:** Log in to https://the-green-haven.vercel.app/dashboard → click "🏘️ Buildings" sidebar → for each of the 2 fallback cards (rooms, nest), click "✏️ แก้ไข", fill payment/contact details, save. This creates the canonical `buildings/rooms` and `buildings/nest` Firestore docs.

2. **CF deploy:** `firebase deploy --only functions:aggregateMonthlyRevenue,cleanupOldDocs,createBookingLock,getRoomAvailability,archiveTenantOnMoveOut,transitionToPlayer,revertTransitionToPlayer,remindLatePayments,remindLeaseExpiry`. Until deployed, CFs keep using their OLD hardcoded `['rooms','nest']` arrays. New buildings created via admin UI won't be CF-accepted until this deploys.

3. **End-to-end test (after CF deploy):** Create a test building (slug=`test_b1`) via Buildings UI → confirm card shows → confirm it appears in Announcements selector → test a CF that takes a `building` arg with `test_b1` → confirm it doesn't reject → archive the test building.

### Out of scope (deferred to Tier 3b)

- Per-building LIFF IDs and per-building LINE OA (each needs LINE Developer setup per property owner)
- Multi-owner authentication (custom claims `building` scoping for non-super-admins)
- Refactor of `setTenantBuilding` + `setPVMBuilding` + `initRoomsPage`/`initNestPage` to be building-generic so all dashboard selectors become dynamic
- Tenant-facing property switcher (current tenant_app already gets `building` from LIFF claims, so this is for tenants who own units in multiple properties)
- SaaS billing / subscription gating

---

# Review — Tier 3I-9 + 3I-10 session (2026-05-13)

## ✅ Shipped

| Commit | สรุป |
|--------|------|
| `a4551b6` | Toast fix — `openChecklistModal` แสดง "✅ สร้าง checklist {type} แล้ว — ผู้เช่าจะเห็นใน app" |
| `fcb8b00` | **3I-9 + 3I-10**: Admin co-sign panel + PNG export (3 files, +470 lines) |
| `7fc7764` | Firestore composite indexes สำหรับ `checklistInstances` (deploy ด้วย `firebase deploy --only firestore:indexes`) |

**Files touched:**
- `dashboard.html` — `📋 Checklists` tab button + tab content (filters + list) + viewer modal + `ensureHtml2Canvas` lazy loader + script tag
- `shared/dashboard-checklist-admin.js` (NEW) — list/viewer/co-sign/PNG export
- `shared/dashboard-main.js` — wire actions (click + change) + `initChecklistAdminTab` dispatch
- `firestore.indexes.json` — 2 composite indexes

**Seeded ผ่าน live admin UI:**
- `checklistTemplates/nest` — 15 items (Nest-specific equipment)
- `checklistTemplates/rooms` — 6 items (legacy, can expand later)
- `facilityConfig/{rooms,nest}_{parking,laundry,rooftop}` — 6 docs ผ่าน `saveConfig()` (API path เดียวกับ UI)

## 🧪 Live verification (Vercel)

- ✅ Build deployed (toastFresh = LATEST after SW cache clear)
- ✅ Tab "📋 Checklists" รับ click + dispatch `initChecklistAdminTab`
- ✅ Building dropdown populated จาก BuildingRegistry
- ✅ Firestore index `(building asc + createdAt desc)` built (~3 นาที)
- ✅ Subscription callback fires → empty state "— ยังไม่มี checklist ในเงื่อนไขนี้ —"
- ✅ html2canvas lazy-loaded จาก CDN
- ✅ All 6 actions wired (filter / openViewer / close / sign / export / clearSig)

## 🚧 End-to-end test ที่เหลือ (manual — production data)

ตาม CLAUDE.md §7-I:
1. Tenant modal ห้องจริง → 🗒️ Checklist ห้อง → `in`/`out` → toast
2. ผู้เช่าเปิด LIFF → กรอก checklist + ถ่ายรูป + เซ็น → submit
3. Admin: Requests → 📋 Checklists → คลิก "ดู" → review → เซ็น canvas → บันทึก
4. Admin: คลิก "⬇️ ดาวน์โหลด PNG"

## 📌 Follow-up (deferred)

- **Silent subscription failure** — `subscribeAdminInstances` ใน `checklist-manager.js` ไม่ส่ง error callback ไปยัง `onSnapshot` → ถ้า rules/index พลาด, UI ค้าง "กำลังโหลด..." เงียบ. แนะนำเพิ่ม `(snap, err) => { if (err) console.error(...); }` (ดู lesson 2026-05-13 ใน lessons.md)
- `checklistTemplates/rooms` ยังมีแค่ 6 items (อาจจะเก่า) — admin อาจอยากเสริมให้เทียบเท่า nest (15 items)
- รวม 3I-9 admin co-sign panel + 3I-10 PNG export เข้า lifecycle doc (`lifecycle_checklist.md`?)

## 🗂️ Tier 3I phases — สถานะรวม

- [x] 3I-1 — Firestore + Storage rules
- [x] 3I-2 — `shared/checklist-manager.js`
- [x] 3I-3 — `createChecklistInstance` CF
- [x] 3I-4 — `submitChecklist` CF
- [x] 3I-5 — `adminSignChecklist` CF
- [x] 3I-6 — Template editor in Buildings page
- [x] 3I-7 — Instance trigger in Tenant modal
- [x] 3I-8 — Tenant app checklist page
- [x] **3I-9 — Admin co-sign panel** (this session)
- [x] **3I-10 — PNG export** (this session)
- [ ] 3I-11 — E2E verify on Vercel (manual, production data — pending)

---

# Plan — PDPA §32 Right to Erasure (2026-05-14, V2 — layered)

> Continues the PDPA framework shipped in `4004f77` (retention + signed URLs + consent ledger + DSR export). This is the 5th piece: data-subject DELETE.
>
> **V2 supersedes V1** — deep-research surfaced 6 critical issues V1 didn't address. See "What changed from V1" at the bottom.

## User decisions (locked in, 2026-05-14)

1. **Active tenant**: REFUSED. Throw `failed-precondition` "ต้องสิ้นสุดสัญญาก่อนถึงจะลบข้อมูลได้ — โปรดติดต่อแอดมิน". Only PLAYERS can run the cascade. → §3.3 conditional logic SIMPLIFIES: D11 = skip always; D12 = always `recursiveDelete`. The cascade becomes the player path only.
2. **Modal**: 2-step (disclosure + 2 checkboxes → typed phrase)
3. **Cooldown**: 7 days
4. **Detection of active tenant** (refusal trigger): `tenantId` claim present AND `tenants/{b}/list/{r}` exists with same `tenantId` AND `linkedAuthUid === auth.uid` → REFUSE.

---

## §1 Legal framework — what we can/must/cannot delete

### §1.1 PDPA §32 is NOT unconditional
Two carve-outs apply directly to this project:
- **§32(2)(b)** "for compliance with a legal obligation" → bills/payments (Revenue Code §87 = 5yr tax retention)
- **§32(2)(c)** "for the establishment, exercise or defence of legal claims" → leases (Civil Code §193/34 = 5yr rent prescription)
- **§32(2)(e)** "for legitimate interests of the controller, with regard to fraud prevention" → `auth_events` + `slipLogs` BigQuery archives (restricted-write IAM by design)

### §1.2 Three tenant lifecycle states → three cascade behaviors

| State | Detection | Cascade behavior |
|-------|-----------|------------------|
| **Active tenant** | `tenants/{b}/list/{r}.tenantId === token.tenantId AND linkedAuthUid === auth.uid` | Zero-out PII fields in tenants doc + people doc; cannot fully delete (active relationship) |
| **Player** (post-lease, in `people/` for 1yr) | `people/{tenantId}` exists, NO matching active `tenants/*/list/*` for this tenantId | `firestore.recursiveDelete(people/{tenantId})` whole tree |
| **Returning tenant** | active tenant doc AND archive(s) `tenants/{b}/archive/*` with same tenantId | Active path + delete all matching archive docs (with subcollections) |

### §1.3 What MUST be disclosed to the user (consent dialog)

The user must SEE before clicking confirm:
1. ✅ Will delete: 7 categories (see §3 below)
2. ⚠️ Retained for legal compliance: bills (5yr tax), leases (5yr Civil Code), payment history
3. 🔒 Retained in security archives (cannot delete, IAM-locked): `auth_events` (90d+ in BigQuery), `slipLogs` (30d+ in BigQuery) — for fraud prevention per §32(2)(e)
4. 🚫 **liffUsers deletion is TERMINAL** — cannot re-sign-in without admin re-approval (this is the most surprising consequence; must be explicit)
5. 🕐 7-day cooldown after request

---

## §2 The 6 critical surprises from deep research

| # | Issue | Mitigation |
|---|-------|------------|
| **S1** | **Cached ID tokens survive ~1 hour** after `setCustomUserClaims({})`. Tenant could still write via stale claims during this window. | Add `admin.auth().revokeRefreshTokens(uid)` immediately AFTER claim clear. This force-invalidates all existing tokens. |
| **S2** | **liffUsers deletion is TERMINAL** — `liffSignIn.js:93-94` returns 404 if doc not found. No auto-create. | Disclose explicitly in modal. Add `liffUsers/{lineUserId}.pdpaErasedAt` marker (not deletion) — but no, this leaks lineUserId. Stick with full deletion + clear UX warning. |
| **S3** | **`tenants/{b}/archive/{contractId}` has full PII clones** from prior move-outs (returning tenants). V1 missed these. | Query `tenants/{building}/archive where tenantId == X` for every building; cascade-delete each. |
| **S4** | **Storage paths beyond checklists/**: `bookings/{bId}/kyc/*` (ID cards!), `bookings/{bId}/slips/*`, `leases/{b}/{r}/{lId}/`, `pets/{b}/{r}/{pId}/*` all hold tenant PII. V1 missed these. | Add to cascade. Find KYC via `bookings where prospectUid == authUid OR prospectLineId == lineUserId`. |
| **S5** | **BigQuery audit archives have restricted-write IAM** — even compromised CF cannot delete. PDPA §32(2)(e) covers this but MUST disclose. | Disclose in consent modal. Optionally: write a `dataDeletionRequests` row to BigQuery so auditors can correlate. |
| **S6** | **Anti-pattern P** — never gate this CF on `tenantUid == auth.uid`. UID drifts across LIFF sessions. | Gate by `token.tenantId` + verify against `tenants/{b}/list/{r}.tenantId` (which is stable). |

---

## §3 Complete cascade specification

### §3.1 DELETE (no legal basis to keep)

| # | Resource | Path | Key | Storage cascade |
|---|----------|------|-----|-----------------|
| D1 | checklistInstances | Firestore `checklistInstances/*` where `building+roomId` match | composite query | `checklists/{b}/{r}/{instanceId}/*` |
| D2 | consents | Firestore `consents/*` where `tenantId` matches | tenantId query | none |
| D3 | liffUsers | Firestore `liffUsers/{lineUserId}` | direct doc | none |
| D4 | RTDB complaints | RTDB `complaints/{building}/{room}` | path | none |
| D5 | RTDB maintenance | RTDB `maintenance/{building}/{room}` | path | none |
| D6 | bookings (player KYC) | Firestore `bookings/*` where `prospectUid == authUid OR prospectLineId == lineUserId` | composite | `bookings/{bId}/kyc/*`, `bookings/{bId}/slips/*` |
| D7 | pets | Firestore `tenants/{b}/list/{r}/pets/*` subcollection | subcoll | `pets/{b}/{r}/{petId}/*` |
| D8 | lineRetryQueue | Firestore `lineRetryQueue/*` where `to == lineUserId` AND status pending | query | none |
| D9 | rateLimits | Firestore `rateLimits/{authUid}_*` | prefix | none |
| D10 | tenants archive (returning tenants) | Firestore `tenants/{b}/archive/{contractId}` for EACH building, where `tenantId` matches | composite per building | none (already cleaned via separate retention) |
| D11 | tenants/{b}/list/{r} | conditional behavior — see §3.3 | direct doc | none |
| D12 | people/{tenantId} | conditional behavior — see §3.3 | direct doc | none |

### §3.2 RETAIN (statutory obligation, disclosed in response)

| Resource | Reason | Citation |
|----------|--------|----------|
| RTDB `bills/{b}/{r}/*` | Tax retention | Revenue Code §87 (5yr) |
| Firestore `leases/{b}/list/{contractId}` | Rent claim prescription | Civil Code §193/34 (5yr) |
| Firestore `tenants/{b}/list/{r}/paymentHistory/*` subcoll | Financial audit | Revenue Code §87 |
| RTDB `payments/{b}/{r}/*` | Financial audit | Revenue Code §87 |
| BigQuery `audit_archive.auth_events` | Fraud prevention legitimate interest | PDPA §32(2)(e) |
| BigQuery `audit_archive.slipLogs` | Fraud prevention legitimate interest | PDPA §32(2)(e) |
| Firestore `audit_logs/bills/*` | Operational audit | PDPA §32(2)(e) |
| Firestore `auth_events/*` (recent, pre-archive) | Recent sign-in security | PDPA §32(2)(e) |

### §3.3 Conditional behavior for D11 (tenants doc) and D12 (people doc)

```
IF active tenant (tenants/{b}/list/{r} exists with this tenantId, linkedAuthUid match):
  D11: tenants doc → zero-out FIELDS_TO_ERASE only (name, firstName, lastName, phone, email,
       idCardNumber, lineID, address, emergencyContact, companyInfo, licensePlate),
       set { pdpaErasedAt: now, pdpaErasureRequestId: <id> }, leave room/contract/lease intact
  D12: people/{tenantId} → zero-out same FIELDS_TO_ERASE, leave gamification + tenantId + erasure marker

ELSE IF player (people/{tenantId} exists, no active tenants doc):
  D11: skip
  D12: firestore.recursiveDelete(people/{tenantId}) — deletes all 5 subcollections too

ELSE (orphan token — mismatched tenantId): ABORT with permission-denied
```

---

## §4 Cloud Function design — `requestDataDeletion`

### §4.1 Signature
```js
exports.requestDataDeletion = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })  // recursiveDelete needs headroom
  .https.onCall(async (data, context) => { ... });
```

### §4.2 Input
```js
{
  confirmationPhrase: 'ลบข้อมูลของฉัน',
  acknowledgedRetention: true,        // user clicked the "I understand bills/leases retained" box
  acknowledgedTerminal: true,         // user clicked the "I understand I cannot sign back in" box
}
```

### §4.3 Pre-flight gate (in order)
1. `if (!context.auth?.uid)` → `unauthenticated`
2. `tenantId = token.tenantId`; `room = token.room`; `building = token.building`; `lineUserId = token.lineUserId || (uid starts with 'line:' ? slice : '')`
3. `if (!tenantId)` → `permission-denied` (cannot erase without canonical key)
4. `if (data?.confirmationPhrase?.trim() !== 'ลบข้อมูลของฉัน')` → `failed-precondition` "confirmation phrase mismatch"
5. `if (!data?.acknowledgedRetention || !data?.acknowledgedTerminal)` → `failed-precondition` "acknowledgements required"
6. **Cooldown check**: query `dataDeletionLog where tenantId == X order by requestedAt desc limit 1`; if exists AND `requestedAt > now - 7d` → `resource-exhausted` with `retry-after` in error details
7. **Mismatch check** (anti-pattern P): if room AND building present, read `tenants/{b}/list/{r}` — if exists AND `tenantId !== claim tenantId` → `permission-denied` "tenant identity mismatch — contact admin"

### §4.4 Idempotency fence
```js
const requestId = `${tenantId}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const logRef = firestore.collection('dataDeletionLog').doc(requestId);
await logRef.create({                  // throws ALREADY_EXISTS on duplicate
  tenantId, authUid, room, building, lineUserId,
  requestedAt: admin.firestore.FieldValue.serverTimestamp(),
  status: 'in_progress',
  startedAt: Date.now(),
});
```

### §4.5 Order of operations (CRITICAL — gets compliance right)

```
Step 0: Audit-fence write (§4.4)
Step 1: Revoke tokens IMMEDIATELY
        await admin.auth().setCustomUserClaims(authUid, {})
        await admin.auth().revokeRefreshTokens(authUid)   // ← S1 mitigation
Step 2: Cascade DELETE (per §3.1, best-effort)
        - Collect per-resource counts and errors into `summary`
        - Storage cleanups: log-and-continue on failure
        - Firestore deletes: log-and-continue per doc; ABORT only on catastrophic admin SDK fail
        - recursiveDelete for D12 player path
Step 3: Write auth_events row
        firestore.collection('auth_events').add({
          action: 'pdpa_erasure', authUid, tenantId, room, building,
          ts: serverTimestamp(), requestId, maskedEmail: masked(email)
        })
Step 4: Update log doc with completion
        logRef.update({ status, summary, completedAt, errors })
Step 5: Return { success, summary, retainedReason, signOutRequired: true }
```

Why this order:
- **Step 1 BEFORE step 2**: closes the stale-token-write window. Even if step 2 fails halfway, user CANNOT add more data.
- **Step 3 AFTER step 2**: the auth_events entry is the cross-system audit anchor. If step 2 throws catastrophically, we still flush the log with `status: 'failed'` in a `finally` block.

### §4.6 Error handling matrix

| Failure point | Action |
|---------------|--------|
| Storage prefix delete fails | log warn, increment `summary.storageErrors`, continue |
| Single Firestore doc delete fails | log warn, append `{ path, error.message }` to `summary.errors`, continue |
| `recursiveDelete` on player doc fails | log error, mark `summary.errors[D12]`, continue (player doc partially deleted is acceptable; retention sweep will catch remainder) |
| `revokeRefreshTokens` fails | LOG ERROR, but proceed — claims already cleared, tokens expire in <1hr regardless |
| `setCustomUserClaims` fails | ABORT, mark log status='failed', throw |
| `dataDeletionLog.create()` throws ALREADY_EXISTS | catch, query existing doc, return its summary (idempotent retry) |
| `auth_events` write fails | log warn, continue (audit log is the primary record) |

### §4.7 Cleanup loop pseudo-code

```js
async function cascade(ctx) {
  const summary = { deleted: {}, retained: {}, errors: [], storageErrors: 0 };
  const helpers = [
    () => deleteChecklistsByRoom(ctx, summary),
    () => deleteConsentsByTenantId(ctx, summary),
    () => deleteLiffUser(ctx, summary),
    () => deleteRtdbPaths(ctx, summary),
    () => deleteBookingsByOwner(ctx, summary),
    () => deletePetsSubcollection(ctx, summary),
    () => deleteLineRetryQueueEntries(ctx, summary),
    () => deleteRateLimits(ctx, summary),
    () => deleteAllTenantArchives(ctx, summary),
    () => handleTenantsDoc(ctx, summary),       // conditional zero-out vs skip
    () => handlePeopleDoc(ctx, summary),        // conditional zero-out vs recursiveDelete
  ];
  for (const h of helpers) {
    try { await h(); }
    catch (e) { summary.errors.push({ step: h.name, error: e.message }); }
  }
  return summary;
}
```

---

## §5 Firestore rules

### §5.1 New `dataDeletionLog` block (after consents block)
```
// PDPA §32 erasure audit trail. Server-only writes (CF via Admin SDK).
// Tenant reads their own row by tenantId claim (NOT by authUid — survives UID drift, per anti-pattern P).
match /dataDeletionLog/{docId} {
  allow read: if isAdmin()
           || (isSignedIn() && resource.data.tenantId == request.auth.token.tenantId);
  allow write: if false;
}
```

### §5.2 Sanity-check consents rule (no change expected)
Current `consents` has `allow write: if false;`. Admin SDK bypasses rules — confirmed. Leave as-is.

### §5.3 Lineretryqueue rule check (might need patch)
The CF queries `lineRetryQueue where to == lineUserId AND status == 'pending'`. Admin SDK bypasses. Check rule denies tenant direct write/delete (security review).

---

## §6 Composite indexes — `firestore.indexes.json`

Add:
```json
{
  "collectionGroup": "dataDeletionLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenantId", "order": "ASCENDING" },
    { "fieldPath": "requestedAt", "order": "DESCENDING" }
  ]
}
```

Verify existing indexes cover:
- `consents where tenantId == X` (likely covered already — DSR export already uses it)
- `bookings where prospectUid == X` and `bookings where prospectLineId == X` (verify)
- `tenants/{b}/archive where tenantId == X` per building (collection-group? check existing index for similar query)

---

## §7 UI in `tenant_app.html`

### §7.1 Menu row (after exportMyData around line 3627)
```html
<div class="menu-item" data-action="confirmDataDeletion">
    <div class="icon-box icon-red"><i class="fas fa-user-slash"></i></div>
    <span>ลบข้อมูลของฉัน (PDPA §32)</span>
    <i class="fas fa-chevron-right arrow"></i>
</div>
```

### §7.2 Wire data-action (around line 6743)
```js
if (a === 'confirmDataDeletion') { if (window.confirmDataDeletion) window.confirmDataDeletion(); return; }
```

### §7.3 Styled modal (NOT native confirm — anti-pattern Q)
Two-step modal:

**Step 1 — Disclosure**:
- Title: "🗑️ ลบข้อมูลของฉัน (PDPA §32)"
- Body:
  - ✅ จะลบ: ประวัติเช็คลิสต์ + รูปถ่าย, ประวัติยินยอม (consents), การเชื่อมต่อ LINE, ประวัติแจ้งซ่อม/ร้องเรียน, รูป KYC ในการจองที่ผ่านมา, รูปสัตว์เลี้ยง, ข้อมูลผู้เช่าที่เก็บไว้ในนี้
  - ⚠️ ต้องเก็บไว้ตามกฎหมาย: บิลค่าเช่า (5 ปี - พ.ร.บ.สรรพากร), สัญญาเช่า (5 ปี - ป.พ.พ.), ประวัติชำระเงิน
  - 🔒 อยู่ในระบบความปลอดภัย ลบไม่ได้: บันทึกการเข้าระบบ + การตรวจสลิป (สำหรับป้องกันการฉ้อโกง - PDPA §32(2)(จ))
  - 🚫 **หลังลบจะไม่สามารถเข้าใช้งานได้อีก** — ต้องให้แอดมินอนุมัติใหม่ทุกครั้ง
- 2 checkboxes:
  - [ ] ฉันเข้าใจว่าบิลและสัญญาจะถูกเก็บไว้ตามกฎหมาย
  - [ ] ฉันเข้าใจว่าจะไม่สามารถเข้าใช้งานได้อีกหลังลบ
- Buttons: ยกเลิก | ดำเนินการต่อ (disabled until both checkboxes ticked)

**Step 2 — Friction confirmation**:
- "พิมพ์ ลบข้อมูลของฉัน เพื่อยืนยัน:"
- Input box (case-sensitive, trim)
- Buttons: ย้อนกลับ | ✅ ลบข้อมูล (disabled until phrase matches exactly)

### §7.4 Handler `window.confirmDataDeletion`
```js
window.confirmDataDeletion = async function() {
  // 1. Open Step 1 modal, wait for both checkboxes + ดำเนินการต่อ
  // 2. Open Step 2 modal, wait for phrase
  // 3. Call CF with { confirmationPhrase, acknowledgedRetention: true, acknowledgedTerminal: true }
  // 4. On success: show summary modal (deleted: X, retained: Y, requestId: Z)
  //    Then: await firebase.auth().signOut() → location.href = '/login.html'
  // 5. On cooldown: show modal with retry-after date
  // 6. On other error: toast with error code + requestId (if any) so admin can investigate
};
```

### §7.5 Modals — markup
Add at end of `<body>` near `photoModal`:
- `#pdpaDeleteStep1Modal` (disclosure)
- `#pdpaDeleteStep2Modal` (friction)
- `#pdpaDeleteSummaryModal` (result)

All use styled `<div>` not native — explicit `style="display:none"` toggle (anti-pattern C check: no CSS rule binds them → must use `= 'none'` not `= ''` on close).

---

## §8 `functions/index.js` registration
```js
// PDPA Section 32 (Data Subject Right): tenant requests erasure of their data.
// Cascades across Firestore + RTDB + Storage. Retains bills/leases per legal carve-outs.
exports.requestDataDeletion = require('./requestDataDeletion').requestDataDeletion;
```

---

## §9 Tests — `functions/__tests__/requestDataDeletion.test.js`

Follow `checklist.test.js` Module._load stub pattern. **12 cases**:

| # | Case | Expected |
|---|------|----------|
| T1 | No auth uid | throws `unauthenticated` |
| T2 | Auth but no tenantId claim | throws `permission-denied` |
| T3 | Wrong confirmation phrase | throws `failed-precondition` |
| T4 | Missing `acknowledgedRetention` | throws `failed-precondition` |
| T5 | Missing `acknowledgedTerminal` | throws `failed-precondition` |
| T6 | Within 7d cooldown | throws `resource-exhausted` |
| T7 | tenantId claim doesn't match tenants doc | throws `permission-denied` |
| T8 | Idempotency — duplicate requestId | catch ALREADY_EXISTS, return existing summary |
| T9 | Active tenant happy path | tenants doc zeroed, people doc zeroed, NOT deleted; bills NOT touched; audit log written |
| T10 | Player happy path (no active tenant) | `recursiveDelete(people/{tenantId})` called; audit log written |
| T11 | Storage prefix delete fails | doc delete still proceeds; `summary.storageErrors > 0` |
| T12 | `revokeRefreshTokens` fails | claims still cleared; CF returns success with warning in summary |

---

## §10 Memory updates — `~/.claude/.../memory/lifecycle_pdpa_checklist.md`

Add §5 to the four-piece pattern:

```markdown
### 5. Right to erasure — `requestDataDeletion`
- File: `functions/requestDataDeletion.js`
- Caller: tenant via styled modal (NOT confirm()) on profile page
- Cascade: 12 resources deleted, 5 retained per PDPA §32(2) carve-outs
- Order: audit-fence write → revoke tokens → cascade → cross-write auth_events → update log
- ...
```

Update "What's NOT done" section — remove DELETE-my-data line.

Add to verification table:
| Claim | Verifier |
|-------|----------|
| Erasure CF exports the handler | `grep -n "exports.requestDataDeletion" functions/requestDataDeletion.js` |
| Order: revokeRefreshTokens after setCustomUserClaims | `grep -n "revokeRefreshTokens" functions/requestDataDeletion.js` |
| Tenants archive scanned per building | `grep -n "tenants.*archive" functions/requestDataDeletion.js` |

---

## §11 Files touched (8 — bigger than V1)

1. `functions/requestDataDeletion.js` (new, ~400 lines)
2. `functions/__tests__/requestDataDeletion.test.js` (new, ~350 lines, 12 cases)
3. `functions/index.js` (+3 lines registration)
4. `firestore.rules` (+6 lines `dataDeletionLog` block)
5. `firestore.indexes.json` (+1 composite index for dataDeletionLog)
6. `tenant_app.html` (~150 lines: 1 menu row + 3 modals + 1 handler + 1 wire-up)
7. `~/.claude/.../memory/lifecycle_pdpa_checklist.md` (update template to 5 pieces)
8. *(possible)* `firestore.indexes.json` extra indexes if `bookings where prospectUid == X` not already covered

---

## §12 Execution order

1. [ ] Build `requestDataDeletion.js` helpers (one helper per cascade item D1–D12) + main handler
2. [ ] Build test file with 12 cases
3. [ ] Run tests until green
4. [ ] Register in `functions/index.js`
5. [ ] Update `firestore.rules` + `firestore.indexes.json`
6. [ ] Deploy CF + rules + indexes: `firebase deploy --only functions:requestDataDeletion,firestore:rules,firestore:indexes`
7. [ ] Build modal + menu + handler in `tenant_app.html`
8. [ ] Run `npm run test:rules` (no new rule cases added but ensure no regression)
9. [ ] Update lifecycle_pdpa_checklist.md
10. [ ] Run `npm run verify:memory` — exit 0
11. [ ] Commit + `git push origin main`
12. [ ] User verifies on LIFF (need user testing — production data action — DO NOT auto-click)

---

## §13 Risk register + rollback strategy

| Risk | Likelihood | Impact | Mitigation/Rollback |
|------|------------|--------|---------------------|
| User clicks delete by mistake | Low | High (irreversible) | Two-step modal + checkbox + typed phrase; cooldown blocks rapid retries |
| Step 2 fails mid-cascade after step 1 (tokens revoked, data partially intact) | Low | Medium | `dataDeletionLog.status='partial_failure'` + admin alert (auth_events row); admin can manually finish via cleanupChecklistsManual + manual scripts; tenant locked out until admin re-approves liffUsers |
| `setCustomUserClaims` fails (rare admin SDK failure) | Very low | High (entire CF aborts) | Pre-flight check: try a no-op `getUser(uid)` first; abort cleanly before any destructive op if Auth SDK unreachable |
| Stale cached ID token used to write to RTDB during the ~1s between step 1 and Firestore deletes | Very low | Low | `revokeRefreshTokens` invalidates on next admin verification (5-min Firestore cache exception per docs, but writes are server-side and verify fresh) |
| `recursiveDelete` on player doc times out | Low | Medium | 300s timeout + 512MB. If still times out, the remaining subcols sweep on next `cleanupPlayersOver1YearScheduled` run |
| Tenant has 100+ checklistInstances → cascade slow | Very low (max ~3 in practice) | Low | Pagination at 200/batch already; CF stays under 300s for realistic data sizes |
| Index missing for a query | Medium | High (CF throws at runtime) | Deploy indexes BEFORE CF; verify in `firestore.indexes.json` |
| Anti-pattern N — onSnapshot in tenant_app fires permission_denied after liffUsers deletion | Certain (by design) | Low | Client UI signs out immediately after CF returns; listener cleanup happens in signOut path |
| BigQuery archive still has user's auth events / slip logs after "erasure" | Certain (by design) | Legal disclosure | Modal explicitly discloses §32(2)(e) legitimate-interest retention |

**Rollback strategy if shipped broken**:
- Hide menu row in `tenant_app.html` (1-line `style="display:none"`); push; CF stays deployed but unreachable from UI
- Or: throw `unimplemented` early in CF until fix lands
- No data rollback possible — destructive by nature; relies on Firestore daily backup (`backupFirestoreScheduled` 03:00 BKK)

---

## §14 What changed from V1

| Issue | V1 missed | V2 adds |
|-------|-----------|---------|
| Stale token write window | Did not address | `revokeRefreshTokens` after claim clear |
| `tenants/{b}/archive/*` PII clones | Not deleted | D10: scan all buildings, delete matching archives |
| Storage paths beyond checklists | Only checklists | D6/D7: bookings KYC + slips, pets |
| BigQuery archive disclosure | Silent | Explicit "🔒 cannot delete" line in modal |
| liffUsers terminal effect | Not warned | 🚫 explicit warning + acknowledged checkbox |
| Mismatched tenantId attack vector | Not checked | §4.3 step 7 mismatch check |
| Idempotency | Cooldown only | Idempotency fence via `.create()` returns existing summary on duplicate |
| auth_events cross-system audit | Not written | Step 3 of cascade |
| Two-step modal | Single confirm | Disclosure step + friction step |
| `lineRetryQueue` cleanup | Missed | D8: delete pending pushes to this lineUserId |
| `rateLimits` cleanup | Missed | D9: clean up authUid-keyed entries |

---

## §15 Open questions for user (answer before I implement)

1. **Disclosure language** — comfortable with my Thai text in §7.3, or you want softer / more legalese?
2. **Two-step modal vs single-page modal** — two-step adds friction (good for irreversible action); single-page is faster. Prefer?
3. **Active-tenant erasure** — should we allow it (zero-out fields, keep room slot) per my plan, OR refuse outright and tell user "end your lease first"? V2 plan = allow. Tradeoff: data minimisation vs admin overhead.
4. **`revokeRefreshTokens` blast radius** — this also kicks out the user from booking.html if they're signed into both. Acceptable?
5. **Privacy policy `/privacy.html`** — should the modal link to it (TBD page), or inline disclosure is enough for now?
6. **Cooldown duration** — 7 days OK, or different (24h / 30 days)?
