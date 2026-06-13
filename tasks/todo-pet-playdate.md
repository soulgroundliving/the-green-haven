# ▶▶▶ PLAN (2026-06-13) — Meaning Layer **#11 Pet Playdate Booking** (🐾 นัดเล่นกลุ่มของสัตว์เลี้ยง) · ⏳ AWAITING OWNER APPROVAL

> **Roadmap:** [meaning-layer-roadmap.md](meaning-layer-roadmap.md) #11 — *"ระบบนัดหมายกลุ่มเล่นของสัตว์เลี้ยง."* Pet pillar consumer of #10 (now live-verified ✅). Build order slot **#2** after #13 ([build-order](meaning-layer-remaining-plans.md) §5).
> **Reuse spine:** clone the **facility-booking atomic transaction** (slot/capacity lock) + the **#10 / foodShares building-scoped-collection + onCall template** + the **tenant-pet-social module skeleton**. Almost nothing is net-new logic.

---

## ⚠️ Concurrent-session safety (carries over from [todo-lost-pet-alert.md](todo-lost-pet-alert.md))
2 sessions live (deposit + auth/§MMM). **OFF-LIMITS:** deposit files · auth files (`_authSoT.js`/`recordChecklistConsent.js`/`tenant-liff-auth.js`/liffUsers-rules/`CLAUDE.md`/`README.md`/`lessons_antipatterns.md`) · **#10 write-path** (`tenant-pet-social.js`/`upsertPetProfile.js`/`_petSocialEngine.js`).
**#11 collision = LOW:** it READS `petProfiles`/`petLinks` (#10) **read-only** — it never writes them, so it does NOT touch `upsertPetProfile.js`/`_petSocialEngine.js`. All logic is in NEW files. Shared append-only points: `functions/index.js` (exports — rebase point vs deposit) · `firestore.rules` (new `petPlaydates` block) · `tenant_app.html` (page + button) · `shared/tenant-navigation.js` (1-line hook) · `shared/components.css`. **Build in a worktree off `origin/main`; land after deposit+auth merge.**

---

## What already exists (REUSE — do NOT rebuild) — grep-verified 2026-06-13
- **Atomic conflict/lock transaction** — [functions/createFacilityBooking.js](../functions/createFacilityBooking.js): `region('asia-southeast1').https.onCall` (:36) · `resolveTenantClaims`+`assertTenantAccess` (§7-Z 6-path, :73-90) · `getValidBuildings` check (:95) · **`runTransaction`** (:178) does `tx.get(conflictQuery)` → throw `'already-exists'` if taken → `tx.set(newRef,…)` (:179-201). **#11 clones this tx shape**, but for a **CAPACITY** check (attendees < capacity + no dup) on a SINGLE playdate doc — NOT a slot-exclusive query → **no composite index** (facilityBookings itself has none in `firestore.indexes.json`).
- **Config-doc pattern** — `facilityConfig/{building}_{facilityType}` (:109-110) with `slots[]`/`timeSlots[]`/`maxAdvanceDays`/`active`. #11 may add a `facilityConfig/{building}_petplay` (or skip config: free-text place) — see D4.
- **Booking doc shape** — `facilityBookings/{id}` {building, facilityType, slot, date, timeSlot, tenantUid, tenantRoom, tenantBuilding, tenantName, status:'confirmed', cancelledBy, createdAt, updatedAt} (:187-201). #11's `petPlaydates` mirrors the metadata fields.
- **Tenant booking UI** — [shared/facility-booking.js](../shared/facility-booking.js): `_callable(name)=window.firebase?.functions?.httpsCallable?.(name)` (:30); `createFacilityBooking`/`cancelFacilityBooking` call sites (:165/:177); `getFacilityLabel/Emoji` helpers. Clone the list→book interaction into `tenant-pet-playdate.js`.
- **Building-scoped collection + CF-only-write rule** — [firestore.rules](../firestore.rules) `foodShares`/`petProfiles` block: `allow read: if isAdmin() || (isSignedIn() && request.auth.token.building != null && resource.data.building == request.auth.token.building); allow write: if false;`. Copy verbatim for `petPlaydates`.
- **#10 read (attendee picker / display)** — `petProfiles/{petId}` SAFE fields `['name','typeEmoji','breed','gender','age','photoURL']` ([_petSocialEngine.js:51](../functions/_petSocialEngine.js)) + `petLinks` friend edges (for D3 friend-notify). Read-only. Own pets via `getDocs(collection(db,'tenants',b,'list',r,'pets'))` (registry).
- **Ephemeral auto-expire sweep** — [functions/cleanupFoodSharesScheduled.js](../functions/cleanupFoodSharesScheduled.js): `pubsub.schedule('20 3 * * *').timeZone('Asia/Bangkok')` (§7-NN) + `where('expiresAt','<',cutoff).limit(300)` paginated → delete. Clone for `cleanupPetPlaydatesScheduled`.
- **LINE notify (D3 cancel/invite)** — `_notifyHelper.pushAndRetry` + `enqueueLineRetry` (see [[lifecycle_line_notification]]); for friend-only invite, enumerate `petLinks` accepted edges → recipient rooms → `lookupApprovedRoomUsers`.
- **Tenant module skeleton** — [shared/tenant-pet-social.js](../shared/tenant-pet-social.js): IIFE · `_ready()` claim guard · `_onLiffClaimsReady(_subscribe)` (§7-A) · `_tenantAppBuilding/_tenantAppRoom` (§7-BB) · onSnapshot + error-cb-nulls-unsub (§7-N) · `_teardown` before rebind (§7-V) · `httpsCallable` · DIRECT listeners (§7-JJJ-safe) · `window.renderX` explicit export (§7-QQ).

## §7-O/AA greenfield check — ✅ CLEAN (run 2026-06-13)
`grep -rn "petPlaydate\|playdate\|นัดเล่น\|PetPlaydate" shared/ functions/ tenant_app.html` → only a forward-reference COMMENT in `_petSocialEngine.js:8` ("#11 playdate…"); **0 implementation** (nothing half-built).

---

## 🔓 OWNER DECISIONS NEEDED (lock at approval)
| # | Decision | Recommended | Alt |
|---|----------|-------------|-----|
| **D1** | Who can host | **Any tenant with an `approved` pet** (registry) — playdate display snapshots the pet name/emoji. Doesn't force a #10 public profile. | Require a published `petProfiles` profile (couples to #10 publish). |
| **D2** | Capacity | **default 6, max 12** attendees; host's pet is attendee #1. | owner picks per-event. |
| **D3** | Notify | **v1: in-app discovery + LINE-notify ATTENDEES on cancel only** (lean, no spam). | Push an invite to pet-FRIENDS (`petLinks` accepted, building-scoped) on create; or whole building (spammy — avoid). |
| **D4** | Place | **free-text `place`** ("ลานหญ้าชั้น G", "rooftop") | Bind to a `facilityConfig` slot (reuse the rooftop booking — heavier; couples to facility tx). |
| **D5** | Scope | **same-building only** (mirror #10) | cross-building. |
| **D6** | TTL | **auto-expire past `endAt` + 24h grace** → sweep deletes (mirror foodShares). | keep as `done` history. |
| **D7** | Points | **point-free** (social, mirror #3/#10 — no farm surface). | tie a small kindness signal (NOT recommended). |
| **D8** | PR shape | **one PR** (server+rules+UI+tests), worktree off main, land after the 2 sessions merge. | split server/frontend. |

## Why Plan-First (CLAUDE.md §1 — all three)
NEW collection + rules block + 3–4 CFs (incl. an atomic-tx join) + scheduled sweep + `tenant_app.html`/nav/CSS + new tenant module + tests ≈ **10–12 files**; rules+CF+schedule deploy = **not single-revert**; **2+ approaches** (D1 host-gate, D3 notify, D4 place).

---

## Data model — `petPlaydates/{id}` (top-level, building-scoped, CF-only-write)
```
{
  id,
  hostPetId, hostTenantId, hostRoom, hostName,    // hostTenantId = canonical tenants/{b}/list/{r}.tenantId
  building,                                        // 'rooms' | 'nest'
  title,                                           // "เล่นกับน้องหมาเย็นนี้"
  place,                                           // free text (D4)
  startAt, endAt,                                  // Firestore Timestamp
  capacity,                                        // int (D2)
  attendees: [ { petId, tenantId, room, petName, typeEmoji } ],  // host is index 0
  status: 'open' | 'full' | 'cancelled' | 'done',
  createdAt, expiresAt,                            // expiresAt = endAt + grace (sweep)
}
```
- **Attendee snapshot is SAFE fields only** (name/typeEmoji) — no health/vaccine (mirror PROFILE_SAFE_FIELDS).
- **Client read** = `onSnapshot(query('petPlaydates', where('building','==',b)))` → single-field → **no composite index**; filter `status in {open,full}` + `endAt>now`, sort by `startAt` **in JS** (§7-AAA no unordered `limit()`).

## State machine
```
(host: สร้างนัดเล่น)        → open    (host = attendee[0] · expiresAt = endAt+24h)
  open ─[join, atomic]──────→ open/full   (attendees<capacity & no dup → arrayUnion; flip 'full' at capacity)
  full ─[leave, atomic]─────→ open
  open/full ─[host cancel]──→ cancelled   (LINE-notify attendees · D3)
  open/full ─[auto past endAt]→ done → (sweep deletes after grace · D6)
```

---

## Tasks (TDD — pure helpers + engine RED→GREEN before wiring)

### Phase 1 — server: collection + callables + rules (pure-TDD)
- [ ] **`functions/_petPlaydateEngine.js`** (NEW, pure) — `canJoin(playdate, petId, tenantId)` (status open, `attendees.length < capacity`, petId not already in attendees, host≠self-join-dup), `addAttendee(playdate, attendee)` (immutable → new attendees + status flip), `removeAttendee(...)`, `isPast(playdate, now)`, `buildPlaydateDoc({...})` (snapshots SAFE fields; assert no health leak). Unit-test (mirror `_petSocialEngine`/`_foodShareEngine` tests).
- [ ] **`functions/createPetPlaydate.js`** (NEW) — `region('asia-southeast1').https.onCall`; `assertTenantAccess`; `checkRateLimit(uid,'createPetPlaydate',5,86400)`; read the host's registry pet (`tenants/{b}/list/{r}/pets/{petId}`, `status==='approved'`, D1); validate title/place/startAt<endAt/capacity (D2 bounds); `tx`-free create (new event, no conflict) → `petPlaydates/{auto}` (host = attendee[0], `expiresAt=endAt+grace`).
- [ ] **`functions/joinPetPlaydate.js`** (NEW) — onCall SE1; `assertTenantAccess`; read joiner's approved pet; **`runTransaction`** (clone createFacilityBooking:178): `tx.get(playdateRef)` → `canJoin` → `tx.update(attendees + status)`; throw `'failed-precondition'` if full / `'already-exists'` if dup. **The capacity-race lock.**
- [ ] **`functions/leavePetPlaydate.js`** (NEW) — onCall SE1; atomic remove (host leaving → cancel the whole event, or block host-leave → must cancel instead).
- [ ] **`functions/cancelPetPlaydate.js`** (NEW) — onCall SE1; host (`playdate.hostRoom===room`) or admin → `status:'cancelled'`; LINE-notify attendees (D3, `_notifyHelper.pushAndRetry`, idempotencyKey `playdate-cancel-${id}-${userId}`).
- [ ] **`functions/cleanupPetPlaydatesScheduled.js`** (NEW) — clone `cleanupFoodSharesScheduled`: `pubsub.schedule('50 3 * * *').timeZone('Asia/Bangkok')` (§7-NN), `where('expiresAt','<',cutoff).limit(300)` paginated → delete + `cleanupPetPlaydatesManual` admin companion. Register in [[lifecycle_scheduled_jobs]] + `verify:memory`.
- [ ] **`functions/index.js`** — `exports.createPetPlaydate`/`joinPetPlaydate`/`leavePetPlaydate`/`cancelPetPlaydate`/`cleanupPetPlaydatesScheduled`/`cleanupPetPlaydatesManual` (column-0, §7-CCC un-indented for CI auto-deploy). ⚠️ rebase point vs deposit.
- [ ] **`firestore.rules`** — NEW `match /petPlaydates/{id}` building-scoped read + `write:false` (copy foodShares) + rules-emulator tests (same-building read ✅ / cross ✗ / client write ✗).
- [ ] **PDPA (§7-DD top-level collection):** add `cleanupPetPlaydatesByTenant(fs, tenantId)` to the move-out + erasure cascade (mirror `cleanupPetSocialByTenant`) — removes the tenant's hosted/joined playdates. ⚠️ `archiveTenantOnMoveOut`/`requestDataDeletion` may be touched by other sessions — confirm before editing; defer with a noted gap if contended.

### Phase 2 — frontend (no CSP regen — markup + external script + external CSS)
- [ ] **`shared/tenant-pet-playdate.js`** (NEW IIFE, clone `tenant-pet-social.js`) — `window.renderPetPlaydates` + `_subscribe` (onSnapshot `petPlaydates where building==`, §7-N/V/U/A) + `_loadOwn` (own approved pets for the host form). Renders into `#pet-playdate-list`: **(1) นัดเล่นที่เปิดอยู่** (cards: title, place, time, 🐾 attendees x/capacity, **เข้าร่วม** button or **เต็มแล้ว**; host's own card shows **ยกเลิก** — §7-FFF bucket by `hostRoom`) · **(2) สร้างนัดเล่น** (pick own approved pet + title + place + start/end + capacity → `createPetPlaydate`; §7-X empty "ยังไม่มีน้องที่อนุมัติ" → pet registration). DIRECT listeners (§7-JJJ). Pure helpers (`isHost`, `slotsLeft`, `fmtWhen`) exported + unit-tested.
- [ ] **`tenant_app.html`** — `<div id="pet-playdate-page" class="page">` after `#pet-directory-page` (~:4860+) + entry button in `#pet-park-page` (`data-action="showSubPage" data-page="pet-playdate-page"`) + `<script src="./shared/tenant-pet-playdate.js" defer>` at line ≥152 (after `tenant-pet-social.js`, §7-PP).
- [ ] **`shared/tenant-navigation.js`** — one `if (id === 'pet-playdate-page' && typeof window.renderPetPlaydates === 'function') window.renderPetPlaydates();` after the existing pet-directory hook (:99).
- [ ] **`shared/components.css`** — appended static `.pet-playdate__*` (§7-RR/III token-driven). Verify `npm run csp:hash` no-drift.

### Phase 3 — gate + verify + docs
- [ ] Gates: `test:shared` (+pure) · CF suite (+engine/callable/tx-race/cleanup) · `test:rules` (+petPlaydates) · §7-TT mojibake clean · `csp:hash` no-drift · `verify:memory` green.
- [ ] **Live-verify (owner, real LINE):** A hosts a playdate → appears in B's list same building → B joins → counter increments, A & B both see it → fill to capacity → "เต็มแล้ว" → A cancels → B gets the cancel push → cross-building isolation. Concurrency: two tenants join the last slot → only one wins (the tx).
- [ ] **Docs same session:** `lifecycle_pet_playdate.md` (memory) + MEMORY.md Pet section + flip [[meaning-layer-roadmap]] #11 ✅ + add the scheduled job to [[lifecycle_scheduled_jobs]].

---

## Anti-pattern guardrails
- **§7-NN** onCall not trigger. **§7-I** the join/create are the user's own explicit taps (no auto-click); cancel-push to attendees only. **§7-A/U/BB/N/V/X/FFF/JJJ** tenant-module discipline (clone tenant-pet-social). **§7-AAA** no unordered `limit()` — building-scoped, sort in JS. **§7-DD** wire move-out/erasure cleanup. **§7-CCC** un-indented exports. **§7-PP** new `<script defer>` after `tenant-navigation.js`. **§7-II/RR** no inline style → no CSP regen. **Atomic capacity** via `runTransaction` (clone facility) — the only correctness-critical bit.

## Reuse verification (grep before coding — §7-H)
```bash
grep -n "runTransaction\|tx.get(conflictQuery)\|facilityConfig" functions/createFacilityBooking.js
grep -n "_callable\|createFacilityBooking\|getFacilityEmoji" shared/facility-booking.js
grep -n "PROFILE_SAFE_FIELDS" functions/_petSocialEngine.js          # read-only #10 fields
grep -n "pubsub.schedule\|expiresAt.*<\|limit(300)" functions/cleanupFoodSharesScheduled.js
grep -n "match /foodShares" firestore.rules                          # rule shape
grep -n "_onLiffClaimsReady\|_teardown\|renderPetDirectory" shared/tenant-pet-social.js
grep -n "pet-park-page\|pet-directory-page" tenant_app.html
```

---

## Review (fill on ship)
- _Pending owner approval (D1–D8) + build (held until deposit/auth sessions merge per concurrent-session safety)._
