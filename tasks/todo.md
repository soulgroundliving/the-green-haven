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

## Review (append after done)
