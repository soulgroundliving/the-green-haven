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
