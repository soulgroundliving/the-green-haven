# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

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
