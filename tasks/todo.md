# Plan B' — Per-room occupancyLog: durable + scalable + audit-grade history

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Triggered by:** User feedback 2026-05-21 evening (7) after Plan B P3-P7 closed —
"เราเคยย้ายลูกบ้านไปห้อง 17 แต่ใน history จะไม่ขึ้นว่าเคยอยู่ห้องนั้น ... เราควรมี record
ว่าผู้เช่าคนนี้เคยไปอยู่ห้องไหนบ้าง". Confirmed via grep of [LeaseAgreementManager.getLeaseHistory()](shared/lease-config.js:97):
filters by **current** `lease.roomId === roomId` — variation transfers flip the field
in-place so the OLD room loses the lease from its history view. Data trail exists
(`amendments[]`, RTDB `audit_logs/leases`) but is not indexed by room.

**Previous plan:** Plan B (transferTenant + composite UI) — SHIPPED + LIVE-VERIFIED
all 4 paths via real user clicks 2026-05-21 evening (7). Review section closed.
This file overwrites that plan.

**Explicit design criteria from user** (must thread through every sprint):
1. **ยั่งยืน** — append-only · immutable docs · rule blocks UPDATE/DELETE on logs
2. **Scalable** — composite indexes ready · collectionGroup-friendly · pagination
3. **Audit/compliance** — by/byEmail/at/source on every entry · no gap in chain · idempotent retries

---

## Why now

1. **Real UX gap** — admin opens "📋 ประวัติผู้เช่าเก่า" for a room and sees nothing if the
   prior tenant was variation-transferred away. Data isn't lost (`amendments[]` carries it),
   but the indexed surface doesn't expose it. §7-T cousin (writer/reader drift).
2. **Unblocks compliance & legal** — PDPA §32 data-deletion + future tenant-DSR
   requests need a queryable per-tenant occupancy timeline. Today building from scratch
   requires scanning every lease's `amendments[]` array.
3. **Future-proofs every upcoming lifecycle CF** — A (returning tenant), G/H
   (forced archive), E (lease assignment) ALL benefit from the same indexed log.
   Shipping the schema now means every future state-transition CF inherits "free"
   room + tenant history surfaces.
4. **Backfillable from existing data** — `leases/.../amendments[]` + `priorLeaseId`
   chain + `transferredToLeaseId` already carry every event we need. One-shot script
   reconstructs the log without manual recall.

## Goal

Ship a per-room occupancy history collection that:
- Survives every existing + future state transition (move-in, move-out,
  transfer, archive, restore, lease assignment) without code change to readers
- Answers BOTH "ใครเคยอยู่ห้อง 17?" and "ฉันเคยอยู่ห้องไหนบ้าง?" via single Firestore query
- Carries a complete audit trail (actor + timestamp + source CF + reason) on EVERY entry
- Is **append-only + immutable** — Firestore rule rejects update/delete on log docs
- Has zero data loss on retry — idempotent via deterministic keys
- Backfills correctly from existing prod data without manual reconstruction

## Schema decisions to confirm BEFORE coding (your call)

### D1. Subcollection vs flat collection

- (a) **Subcollection** `tenants/{building}/list/{roomId}/occupancyLog/{auto}` ⭐ recommended
  - Pros: room-scoped queries trivial (`getDocs(.../occupancyLog)`); rules mirror tenants pattern; existing precedent (`wellnessClaimed`, `pets` per firestore.rules:316/340); `collectionGroup('occupancyLog')` answers per-tenant queries
  - Cons: 2 docs per transfer = 2 batched writes in different subcollection paths
- (b) **Flat top-level collection** `roomOccupancyLog/{auto}` with `{building, roomId, ...}`
  - Pros: one rule block; one composite index suffices
  - Cons: new top-level collection adds project surface; rule scoping awkward (admin all + tenant-self + nobody-else)
- (c) **Per-tenant subcollection** `people/{personId}/occupancyLog/{auto}`
  - Pros: tenant timeline trivial
  - Cons: "who lived in room 17" requires collectionGroup scan; loses room-scoped affordance

### D2. Schema fields (immutable per doc)

Proposed (recommend):
```js
{
  // Identity (denormalized for query-without-join)
  tenantId: string,           // canonical id (carries across rooms)
  tenantName: string,         // display copy at time of event
  personId: string | null,    // people/{personId} link if present

  // Where + when
  building: string,           // 'rooms' | 'nest' | ...
  roomId: string,
  at: Timestamp,              // serverTimestamp() at write — sort key

  // What happened
  action: 'moved_in' | 'moved_out' | 'transferred_in' | 'transferred_out'
        | 'archived'  | 'restored',
  reason: string | null,      // human-readable (admin notes / archive reason)

  // Cross-reference for the room-pair side of a transfer (null for non-transfer)
  otherBuilding: string | null,
  otherRoom: string | null,

  // Lease at the time
  leaseId: string,

  // Actor (admin caller — every entry MUST have this)
  by: string,                 // admin UID
  byEmail: string | null,     // admin email (denormalized — survives user delete)

  // Provenance (which CF wrote this — for backfill differentiation + audit)
  source: 'convertBookingToTenant' | 'transferTenant.variation' | 'transferTenant.novation'
        | 'archiveTenantOnMoveOut' | 'restoreReturningTenant' | 'backfill' | 'manual',

  // Idempotency key — deterministic per event (re-runs don't double-write)
  // Shape: '{source}-{leaseId}-{action}-{building}-{roomId}' (no ts because ts can be
  // serverTimestamp sentinel; uniqueness comes from the structural triple).
  idempotencyKey: string,

  // Optional compliance/notes blob — admin can attach free text
  notes: string | null,
}
```

Confirm or override.

### D3. Doc ID strategy (idempotency)

- (a) **Deterministic ID = idempotencyKey** ⭐ recommended
  - Pros: re-running backfill is no-op (set with merge:false would fail; we use set without merge); CF retries hit the same key
  - Cons: must hash long keys (Firestore doc ID ≤ 1500 bytes — fine for our shape)
- (b) **Auto ID** (`doc(coll).id`)
  - Pros: simpler
  - Cons: CF retry doubles writes; backfill needs explicit dedup logic

### D4. Append-only rule enforcement

Recommend: write `occupancyLog` rule that blocks `update` + `delete` entirely (even for admin).
Compliance-grade history MUST be tamper-proof from the dashboard. Admin who needs to
correct an error writes a NEW entry (`action: 'corrected'` or a `correctedById` link).

- (a) **Strict immutable** ⭐ recommended — admin cannot edit or delete after write
- (b) **Soft immutable** — admin can delete but UI hides the action
- (c) **Mutable** — admin can edit (rejected: defeats audit grade)

### D5. Writes within existing CFs' batches

Each occupancyLog write MUST be in the same Firestore batch as the lease/tenant update
it accompanies. Partial-success would create orphan log entries OR lose history.

- (a) **Single batch** ⭐ — atomicity guaranteed; failure rolls everything back
- (b) **Separate write after batch.commit** — simpler code but breaks atomicity invariant

### D6. Backfill strategy

- (a) **Lease-derived reconstruction** ⭐ recommended
  - Iterate every lease doc in `leases/{b}/list/*`
  - For each lease:
    - Write `moved_in` at `lease.contractStart` / `lease.moveInDate`
    - If `amendments[]`: for each amendment, write `transferred_out` at `fromRoom` + `transferred_in` at `toRoom` (sorted by `at`)
    - If `status='transferred'`: write `transferred_out` at terminal `transferredAt` + matching `transferred_in` at the **next** lease doc (via `transferredToLeaseId`)
    - If `status='renewed'`: NO write (renewal doesn't change room — already covered by next lease's `moved_in`)
    - If `status='ended'`: write `moved_out` at `endedAt`
  - Use `source: 'backfill'` + deterministic idempotencyKey so re-runs are safe
- (b) **No backfill** — only forward events tracked
  - Pros: simplest
  - Cons: existing data forever opaque; defeats "ผู้เช่าเก่า" use case for ทดสอบ ห้อง15's 6-deep chain

### D7. Reader API shape

- (a) **`OccupancyLog.getByRoom(building, roomId, opts)`** — new module ⭐ recommended
  - Pure read; pagination via `limit` + `startAfter`; sorted by `at` DESC
  - Companion `OccupancyLog.getByTenant(tenantId, opts)` via collectionGroup
- (b) **Extend `LeaseAgreementManager.getLeaseHistory(building, roomId)`** to merge log + leases
  - Pros: one entry point for callers
  - Cons: mixes two collections, harder to test

---

## State write contract — what each CF writes

Mirror existing §7-DD batches. EVERY transition adds 1-2 log entries TO THE SAME BATCH.

### `transferTenant` (variation)

| Existing batch ops | + occupancyLog adds |
|---|---|
| set tenants/{newRoom} | + write `transferred_in` at newRoom subcol |
| update tenants/{oldRoom} (clear) | + write `transferred_out` at oldRoom subcol |
| update lease (`amendments[]` arrayUnion + roomId flip) | (no extra) |
| RTDB audit_logs/leases | (unchanged) |

### `transferTenant` (novation)

Same 2 occupancyLog entries (in/out) — `source: 'transferTenant.novation'`. New lease creation
is referenced via `leaseId` field in the log entry.

### `archiveTenantOnMoveOut`

| + occupancyLog | `moved_out` (action) + `archived` (action) — split into 2 events OR fold into 1 with `action: 'archived'` |

Recommend: ONE entry `action: 'archived'` (move-out is a special case of archive when no
transferTo is set).

### `convertBookingToTenant`

| + occupancyLog | `moved_in` at the assigned room |

### Future: `restoreReturningTenant` (planned A)

| + occupancyLog | `restored` at the room being re-occupied |

### `renewLease`

**NO write to occupancyLog** — renewal doesn't change room. The existing tenant's
`moved_in` from a prior CF already covers their presence at this room. (`amendments[]` on
the lease still tracks lease-level events; occupancyLog is room-level.)

---

## Files Touched (estimated)

| File | Action | Est LOC |
|---|---|---|
| `functions/_occupancyLog.js` | NEW — helper module exporting `appendLog(batch, opts)` + `buildIdempotencyKey(opts)` | ~120 |
| `functions/transferTenant.js` | MODIFY — both modes call `appendLog` in batch (2 entries each) | +~40 |
| `functions/__tests__/transferTenant.test.js` | MODIFY (+8 tests covering log writes both modes + idempotency + missing-claim guard) | +~140 |
| `functions/archiveTenantOnMoveOut.js` | MODIFY — call `appendLog` for archive event | +~20 |
| `functions/__tests__/archiveTenantOnMoveOut.test.js` | MODIFY (+3 tests for log write + idempotency) | +~60 |
| `functions/convertBookingToTenant.js` | MODIFY — call `appendLog` for moved_in | +~15 |
| `functions/__tests__/convertBookingToTenant.test.js` | MODIFY (+3 tests) | +~50 |
| `firestore.rules` | MODIFY — append `occupancyLog/{auto}` subcollection rule (admin-read + tenant-self-read + create-only via CF + reject update/delete) | +~25 |
| `firestore.rules.test.js` | MODIFY (+8 rule tests covering each access pattern) | +~120 |
| `shared/lease-config.js` | MODIFY — `LeaseAgreementManager.getLeaseHistory()` augmented to also pull occupancyLog AND/OR add new `OccupancyLog` module | +~30 |
| `shared/occupancy-log.js` | NEW — `OccupancyLog.getByRoom`, `OccupancyLog.getByTenant`, helper formatters | ~120 |
| `shared/dashboard-tenant-modal.js` | MODIFY — `showTenantLeaseHistory` renders merged view: lease docs + occupancyLog timeline | +~80 |
| `dashboard.html` | MODIFY — add `shared/occupancy-log.js` script tag | +1 |
| `tools/backfill-occupancy-log.js` | NEW — dry-run + apply backfill script | ~200 |
| `lifecycle_tenant_transitions.md` | UPDATE Existing rows · ## Verification block · Cross-references | +~30 |
| `next_session_handoff_2026_05_22_occupancy_log.md` | NEW handoff | ~90 |
| `MEMORY.md` | UPDATE 🎯 Current state | +2 |

Total: **~15 files, ~1,200-1,400 LOC net new + modified.** Well above 5-file Plan-First threshold.

---

## Sprint plan (S1-S7, ~6-8 sessions estimated)

### S1 — Schema + rule + helper module + first CF wire ✅ SHIPPED `687771f`

- [x] **S1.1** Created `functions/_occupancyLog.js` (167 LOC): `appendLog(writer, firestore, payload)` accepts both batch AND tx (both have `.set`). `buildIdempotencyKey({source,leaseId,action,building,roomId,discriminator})` returns `__`-joined sanitized key. Schema fully documented in JSDoc + `VALID_ACTIONS` + `VALID_SOURCES` sets for compile-time-ish validation.
- [x] **S1.2** Updated `firestore.rules` — nested rule at `tenants/{b}/list/{r}/occupancyLog/{eventId}` + collectionGroup wildcard at `/{path=**}/occupancyLog/{eventId}` (catches per-tenant timeline queries). `create, update, delete: if false` everywhere = CF-only via Admin SDK + tamper-proof.
- [x] **S1.3** `firestore.rules.test.js` +8 tests: admin read all · tenant-self read · cross-tenant blocked · unauth blocked · client create blocked · admin update blocked (tamper-proof) · admin delete blocked (audit-grade) · admin collectionGroup succeeds. **188/188 GREEN.**
- [x] **S1.4** Wired `convertBookingToTenant.js` — `appendLog(tx, firestore, {action:'moved_in', source:'convertBookingToTenant', discriminator: bookingId, ...})` inside existing transaction. Throws abort the conversion on log build failure (catches bad source/action at deploy-time, not runtime).
- [x] **S1.5** Tests: `npm run test:unit` → **334/334 GREEN** (was 331; +3 occupancyLog write asserts on convertBookingToTenant). `firebase emulators:exec ... node --test firestore.rules.test.js` → **188/188 GREEN**.
- [x] **Commit:** `687771f feat(occupancyLog): append-only per-room history + convertBookingToTenant wire (S1)`
- [x] **Deploy:** `firebase deploy --only firestore:rules,functions:convertBookingToTenant` — rules released + CF updated in asia-southeast1.
- [x] **Checkpoint:** helper module exists ✓; rule blocks update/delete enforced by rule tests ✓; convertBookingToTenant writes one log entry per call (verified in tests) ✓; **production already accepts new occupancyLog writes** (only convertBookingToTenant writes them for now — S2 expands).

### S2 — Wire `archiveTenantOnMoveOut` + `transferTenant` ✅ SHIPPED

- [x] **S2.1** `archiveTenantOnMoveOut.js` now calls `appendLog(batch, firestore, {action:'archived', source:'archiveTenantOnMoveOut', discriminator:'', leaseId: leaseIdToEnd || contractId, ...})` BEFORE `batch.commit()`. On helper throw, aborts via `HttpsError('internal', ...)` so an archive without history is impossible. `totalOps` bumped by 1 (now `(leaseRefToEnd ? 4 : 3) + (totalSubDocs * 2)`).
- [x] **S2.2** `transferTenant.js` both modes write 2 paired log entries inside the existing batch:
  - **variation**: `source='transferTenant.variation'`, BOTH entries carry the SAME `leaseId` (same lease moves rooms) and `discriminator = amendmentEntry.at` (the ISO timestamp of the amendments[] entry) so the pair shares a discriminator.
  - **novation**: `source='transferTenant.novation'`, `transferred_out` carries OLD `leaseId` + `discriminator = newLeaseId`; `transferred_in` carries NEW `leaseId` + `discriminator = oldLeaseId`. Either side's discriminator identifies the OTHER lease — admin can pair without re-reading.
  - Both entries on both modes carry `otherBuilding` + `otherRoom` pointing at each other.
  - New helper `_resolveTenantName(leaseData, tenantData)` exported — fallback chain `lease.tenantName → tenant.name → firstName+lastName → 'unknown'` so empty identity never trips the helper's required-field check.
- [x] **S2.3a** NEW `functions/__tests__/archiveTenantOnMoveOut.test.js` (no test file existed before): 18 tests covering auth (2) + validation (4) + pre-conditions (4) + batch shape (5) + occupancyLog write (3). All GREEN.
- [x] **S2.3b** `functions/__tests__/transferTenant.test.js` +8 occupancyLog tests in 2 suites (variation × 4: paired writes, shared discriminator, otherBuilding/otherRoom pair, reverse-transfer-fresh-discriminator; novation × 4: paired writes, paired-via-OTHER-lease-id discriminator, tenantName fallback, doc-id=idempotencyKey replay safety). 51 → 59 tests on this file, all GREEN.
- [x] **S2.4** `npm run test:unit` → **360/360 GREEN** (was 334 after S1; +18 archive + +8 transfer = 360).
- [x] **Commit:** `feat(occupancyLog): wire archive + transfer (both modes) (S2)`
- [x] **Checkpoint:** 3/4 transition CFs now write occupancyLog (convertBookingToTenant via S1; archiveTenantOnMoveOut + transferTenant via S2). `restoreReturningTenant` not yet implemented (Plan B' future A). Test suite green.

### S3 — Reader module + UI surface (~3-4 hr)

- [ ] **S3.1** Create `shared/occupancy-log.js`:
  - `OccupancyLog.getByRoom(building, roomId, {limit=50, startAfter=null})` → list sorted by `at` DESC
  - `OccupancyLog.getByTenant(tenantId, {limit=50})` → collectionGroup query
  - Pagination cursor helpers
  - Pure read; uses `window.firebase.firestoreFunctions`
- [ ] **S3.2** Update `shared/dashboard-tenant-modal.js` `showTenantLeaseHistory(building, roomId)`:
  - Fetch BOTH `LeaseAgreementManager.getLeaseHistory()` AND `OccupancyLog.getByRoom()`
  - Render merged timeline sorted by date: each entry shows `action icon · tenantName · at · source CF`
  - Highlight `transferred_in/out` so admin sees the pair at a glance
  - Empty-state: "ยังไม่มีประวัติผู้เช่า" (existing)
- [ ] **S3.3** Wire script tag `<script src="./shared/occupancy-log.js"></script>` in `dashboard.html` BEFORE `dashboard-tenant-modal.js`
- [ ] **S3.4** Composite index for collectionGroup query — `firestore.indexes.json`: `{collectionGroup: 'occupancyLog', fields:[{tenantId, asc}, {at, desc}]}` + deploy via `firebase deploy --only firestore:indexes`
- [ ] **Commit:** `feat(occupancyLog): reader module + ประวัติผู้เช่าเก่า surface (S3)`
- [ ] **Checkpoint:** Modal "ประวัติผู้เช่าเก่า" shows BOTH lease docs AND occupancyLog events.

### S4 — Backfill script (S effort, sensitive) (~3-4 hr)

- [ ] **S4.1** Create `tools/backfill-occupancy-log.js`:
  - `--dry-run` (default): scan all `leases/*/list/*`, derive events, print count + sample, no writes
  - `--apply`: same scan + write to Firestore via Admin SDK
  - Idempotent: re-runs use same `buildIdempotencyKey` → set on same doc, no duplicates
  - `--building <b>` filter for incremental rollout
- [ ] **S4.2** Event derivation logic (mirror S1 schema):
  - For each lease, write `moved_in` at `lease.contractStart`/`moveInDate`
  - For amendments[]: per entry, write `transferred_out` at `fromRoom` + `transferred_in` at `toRoom` (sort by `at`)
  - For `status='transferred'`: write `transferred_out` at `transferredAt`, paired `transferred_in` via `transferredToLeaseId` chain
  - For `status='ended'`: write `moved_out` at `endedAt`
  - Skip `status='renewed'` (renewal doesn't change room)
  - `source: 'backfill'` on every entry
- [ ] **S4.3** Run `--dry-run` against production. Expected output: count of events ≈ 2-3× count of leases (each lease has at least move-in + move-out, transferred leases have extra pair).
- [ ] **S4.4** Apply for `building='rooms'` first. Verify via spot-check of ทดสอบ ห้อง15's chain. Then apply for `nest`.
- [ ] **S4.5** Live verify: Open "ประวัติผู้เช่าเก่า" for ห้อง 17 → should show "transferred_in 2026-05-21" + "transferred_out 2026-05-21" entries for ทดสอบ ห้อง15.
- [ ] **Commit:** `feat(occupancyLog): backfill script + applied to prod (S4)`
- [ ] **Checkpoint:** Backfill applied; "ประวัติผู้เช่าเก่า" for every previously-touched room shows history.

### S5 — Live verify all 6 lifecycle CFs round-trip (~1-2 hr)

- [ ] **S5.1** Chrome MCP E2E walk on ทดสอบ ห้อง15 (still the fixture):
  - convertBookingToTenant (skip — would need a fresh booking + admin convert; existing log entries from backfill suffice)
  - transferTenant variation forward + reverse → verify 2+2 = 4 log entries written
  - transferTenant novation forward + reverse → verify 2+2 = 4 log entries written
  - archiveTenantOnMoveOut → verify 1 log entry written
- [ ] **S5.2** Verify "ประวัติผู้เช่าเก่า" UI shows the new entries in order with correct icons + actors
- [ ] **S5.3** Verify rule blocking: from DevTools, attempt to write/update/delete via client SDK → expect permission-denied on all 3
- [ ] **S5.4** Verify tenant-self-read: switch to tenant LIFF, query own `OccupancyLog.getByTenant(tenantId)` → should return their entries only
- [ ] **Checkpoint:** All 4 transition CFs write log correctly; rule enforcement verified; tenant-self-read works.

### S6 — Memory + handoff (~1 hr)

- [ ] **S6.1** Update `lifecycle_tenant_transitions.md`:
  - § Existing transitions table — add `occupancyLog` column showing which CFs write to it
  - ## Verification — add grep for `_occupancyLog.appendLog` callers (should be 4 CFs)
  - ## Cross-references — link to new module + reader
- [ ] **S6.2** Write `next_session_handoff_2026_05_22_occupancy_log.md`
- [ ] **S6.3** Update MEMORY.md 🎯 Current state
- [ ] **S6.4** Run `npm run verify:memory` → must exit 0
- [ ] **S6.5** Append Review section to this `tasks/todo.md`
- [ ] **Commit:** `docs(memory): occupancyLog shipped + lifecycle update (S6)`
- [ ] **Checkpoint:** Memory sync · verify:memory green · handoff in place.

---

## Invariants — must hold across every sprint

1. **Append-only**: Firestore rule blocks update/delete on `occupancyLog/{auto}` even for admin claim. Audit-grade.
2. **Atomicity**: occupancyLog writes are in the SAME batch as their parent state change. No orphan log entries.
3. **Idempotency**: deterministic `idempotencyKey` derived from `{source, leaseId, action, building, roomId}`. Retries are safe.
4. **Denormalized snapshot**: `tenantName` + `by`/`byEmail` written at event time so the log survives identity edits.
5. **Pair completeness**: transferTenant writes BOTH legs (out + in) in same batch. Never have a half-pair.
6. **Source-traceability**: every entry has `source` field naming the CF or backfill that wrote it.
7. **Time monotone**: `at` is serverTimestamp() at write — no client clocks.
8. **PDPA-respectful**: tenant can read their OWN entries via collectionGroup + claim.tenantId match; cannot read others'.

## Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Backfill double-writes existing entries from forward-CFs (race during deploy window) | Idempotency key + Firestore `set` (no merge) on same doc id |
| R2 | Batch grows beyond Firestore 500-op limit (multi-leg transfer + log writes) | Current max: variation 8 ops + 2 logs = 10. Novation: 10 ops + 2 logs = 12. Far below limit. |
| R3 | Composite index needed for collectionGroup query fails on first deploy → user query stuck "loading" (§7-N pattern) | Add index BEFORE deploying client code that calls it; verify in Firestore Console |
| R4 | Rule too strict (admin can't read their own audit) | Add explicit `request.auth.token.admin == true` allow; rule test must cover this |
| R5 | renewLease should NOT write to log — but oversight could add one | Explicit comment in renewLease.js + grep verifier in S6 confirming `renewLease.js` has zero `appendLog` calls |
| R6 | Backfill amendments[] event ordering — duplicate entries if amendments[] sorts wrong | Sort by `at` field within amendments before iterating |
| R7 | Existing prod leases with malformed dates / missing fields → backfill skips silently | Dry-run reports skipped count + reasons; admin reviews before apply |
| R8 | Re-running backfill writes new "by" field if admin context changes between runs | `by: 'system-backfill'` (constant) for backfill source — not admin UID |

## Anti-pattern relevance

- **§7-DD (lifecycle CFs update siblings)** — extends to a 4th collection (occupancyLog) for transferTenant; design baked in from S1
- **§7-T (writer/reader drift)** — this sprint IS the resolution to a §7-T cousin (variation lease.roomId field updates but reader filters by it)
- **§7-N (onSnapshot must have error callback)** — reader uses `getDocs` (one-shot) initially; if we add live updates later, MUST wire error callback
- **§7-FF (claim reversal contract)** — N/A here (occupancyLog doesn't change Auth claims)
- **§7-J (static deploy ≠ live verified)** — S5 closes probation for the 4 wired CFs via E2E walk

May newly surface: idempotency-key-collision pattern if `{source, leaseId, action, building, roomId}` isn't unique enough — extension would document as new anti-pattern.

---

## Open questions to resolve before approving

1. **D1** — subcollection (recommended a) vs flat collection (b) vs per-tenant (c)?
2. **D2** — schema fields as proposed, or add/remove anything? (e.g. do we want `priorLeaseId` field on log entries too?)
3. **D3** — deterministic idempotency key (a) vs auto ID (b)?
4. **D4** — strict immutable (a, recommended)?
5. **D5** — single-batch atomicity (a, recommended)?
6. **D6** — backfill yes (a, recommended) or skip (b)?
7. **D7** — new `OccupancyLog` module (a) vs extend existing manager (b)?

---

## Awaiting

User decisions on **D1-D7** above (or "go with recommendations on all"). Then ✅ to start S1.

## Review

(To be filled at end of sprint per CLAUDE.md §1 Plan-First Protocol)
