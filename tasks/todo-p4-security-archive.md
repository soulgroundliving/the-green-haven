# P4 HIGH security batch — 2026-05-23

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Previous plan:** Plan B' Per-room occupancyLog — SHIPPED prior session (commits `3c79fc1` etc.). Review section closed in archived plan. This file overwrites that.

**Source:** `next_session_handoff_2026_05_22_critical_sprint_followups.md` PRIORITY 4 (HIGH security batch deferred from `aa62ca4` sprint). User picked this in 2026-05-23 (1) handoff resume.

---

## Scope decision — ship 5 of 6 P4 items this session (user-approved 2026-05-23)

| Item | Decision | Why |
|---|---|---|
| **P4.1 CORS hardening on 17 onRequest CFs** | DEFER | Risk: `liffSignIn` + `liffBookingSignIn` are called from LIFF webview — restricting Origin can break tenant LIFF flow. Needs per-CF audit + LIFF Origin research. |
| **P4.2 liffUsers create rule** | ✅ SHIP | Rules-only, small surface, test-able |
| **P4.3 marketplace ownerUid** | ✅ SHIP | Rules-only, one-line addition, test-able |
| **P4.4 buildings/{id} all-readable** | ✅ SHIP (user opted in) | Reader audit drives approach choice (subcollection-split vs scoped-read). Decision made in Phase 1 after grep |
| **P4.5 RTDB housekeeping** | ✅ SHIP (after audit) | Rules-only IF zero tenant-write callers; if any, escalate (CF write path first) |
| **P4.6 isBuildingManager substring** | ✅ SHIP w/ defensive `is list` rule guard | User opted in for guard; audit A4 must run first to confirm no existing manager has a string claim |

Net: 5 P4 items this session. P4.1 deferred to own sprint.

**Why this packaging:** keeps the changeset rules-mostly (firestore.rules + database.rules.json + grant-building-manager.js + new tests). Single `firebase deploy --only firestore:rules,database` after merge, no CF deploy. Avoids the high-blast-radius LIFF Origin question.

---

## Branch strategy (user-approved)

New worktree + new branch off `claude/fervent-kare-f45fb1`. Branch name: `claude/p4-rules-hardening`.

Worktree path: `C:\Users\usEr\Downloads\The_green_haven\.claude\worktrees\p4-rules-hardening`

Why: sprint already has Fix #5 (facilityBookings claim fallback), Fix #7 (tenants update self-ownership), Cat-A `_authSoT` helper, and the rules tests covering all of those. P4 rule changes stack cleanly on top. When fervent-kare merges to main, this branch fast-forwards on top.

---

## Phase 1 — Audit ✅ COMPLETE (2026-05-23)

### A1 housekeeping — ESCALATE P4.5 to defer

- [x] Tenant LIFF writes directly to RTDB `housekeeping/{building}/{room}/{id}` at [tenant_app.html:5554](tenant_app.html:5554) via `window.firebaseSet`.
- [x] Admin reads from same path in [dashboard-domain-stores.js:566+](shared/dashboard-domain-stores.js:566) (RequestsStore) and writes status updates via [dashboard-requests-admin.js:1247](shared/dashboard-requests-admin.js:1247).
- **Same NC-1 forge pattern.** Tenant-writable + admin-trusted = forge vector for cleaning credits / ticket inflation.
- **Decision:** **DEFER P4.5 → next sprint.** Locking RTDB to admin-write requires a `submitHousekeepingTicket` CF (mirror of `verifySlip` for cleaning), proper validation, and update of tenant_app to call the CF. Out of scope for rules-only batch.

### A2 liffUsers writer — field allowlist updated

- [x] Only one writer: [tenant_app.html:10141-10150](tenant_app.html:10141) `fs.setDoc(fs.doc(..., 'liffUsers', _lineUserId), payload)`
- [x] Payload schema:
  ```js
  {
    lineUserId: window._lineUserId,
    lineDisplayName: window._lineProfile?.displayName || '',  // NOT "displayName"
    linePictureUrl: window._lineProfile?.pictureUrl || '',     // NOT "pictureUrl"
    room: String(room),
    building: bld,
    status: 'pending',
    requestedAt: new Date().toISOString()                       // NOT request.time
  }
  ```
- **Adjustment to P4.2:** allowlist must use `lineDisplayName`/`linePictureUrl` (not the names I assumed in v1 of plan). `requestedAt` is a client-generated ISO string, not `request.time` — drop that check OR coerce. Keep `status == 'pending'` to prevent self-approve.

### A3 marketplace create — safe

- [x] Single create site: [tenant_app.html:6531-6541](tenant_app.html:6531) — `addDoc(collection(db, 'marketplace'), { ..., ownerUid: window._authUid })` already sets ownerUid to own auth UID.
- **Conclusion:** P4.3 rule tightening is transparent. Will not break legitimate flow.

### A4 managedBuildings claim shape — safe to add `is list` guard

- [x] Two writers: [tools/grant-building-manager.js:88](tools/grant-building-manager.js:88) (CLI) and [functions/grantBuildingManager.js:78](functions/grantBuildingManager.js:78) (CF).
- [x] Both writers set claim from an Array source (`args.slice(1).filter(...)` in CLI; `Array.isArray(buildings)` validated in CF).
- [x] Existing `_authSoT.js:75` already does `Array.isArray(tok.managedBuildings) ? tok.managedBuildings : []` defensively.
- **Conclusion:** zero existing managers have string claims. P4.6-2 `is list` rule guard is safe to add — no historical manager breaks.
- **Bonus finding:** the CF (`grantBuildingManager.js`) DOES validate buildings against `getValidBuildings()` registry; the CLI tool (`tools/grant-building-manager.js`) does NOT. P4.6-1 = port validation to the CLI tool.

### A5 buildings/{id} readers — REVISED P4.4 path

- [x] **tenant_app.html (signed-in tenants):** reads ONLY `buildings/{_taBuilding}` (own building from token claim) via direct `doc()`. No list-all read. ([tenant_app.html:8695](tenant_app.html:8695), [:12418](tenant_app.html:12418))
- [x] **booking.html (anonymous prospects):** reads BOTH `buildings/rooms` AND `buildings/nest` (list-all equivalent) at [booking.html:1257-1278](booking.html:1257) for PromptPay info display. **Anonymous prospects have no `token.building` claim** — Approach A (scope-by-claim) would break booking entirely.
- [x] **dashboard (admin):** uses `BuildingRegistry` which does `getDocs(collection(db, 'buildings'))` — list-all read. Admin can bypass scoping. ([shared/building-registry.js:48](shared/building-registry.js:48))
- **Decision:** Approach A (scope-by-claim) is OFF the table because of booking.html anonymous reads.
- **Revised P4.4 path:** **Approach B (subcollection split).** Move only the actually-private fields to `buildings/{id}/private/{docId}` admin-only. Keep top-level fields (promptPayId, companyName, ownerName, displayName, internet subdoc) readable to all signed-in for compatibility with booking.html and tenant_app.html.
- **Field classification:**
  - **TOP-LEVEL (keep readable to signed-in):** `displayName`, `promptPayId`, `companyName`, `ownerName`, `internet` subdoc
  - **PRIVATE (move to subcollection):** `ownerEmail` (admin contact), `contact` (admin phone), possibly `address` (debatable — appears on receipt?)
- **Implementation cost:** rule add + dashboard reader/writer update + optional migration script. **Bigger than expected.**

---

**User decisions captured 2026-05-23 (after audit):**

1. **P4.5 RTDB housekeeping** — DEFER (audit-blocked). Reason above.
2. **P4.4 B-full chosen.** Receipt audit confirmed: tenant_app `_recipientCo.address` is the tenant's own company address, NOT building. dashboard-bill.js line 1073 only prints tenant company address. So building `address` is admin-only-readable → safe to move private.
   - **Private subcollection fields:** `ownerEmail` + `contact` + `address`
   - **Top-level (stays readable to signed-in):** `displayName`, `promptPayId`, `companyName`, `ownerName`, `internet` subdoc

---

## Phase 2 — P4.2 liffUsers create hardening

**File:** `firestore.rules:432`

Current (sprint state):
```
match /liffUsers/{userId} {
  allow read:   if isAdmin() || (isSignedIn() && request.auth.uid == 'line:' + userId);
  allow create: if isSignedIn();
  allow update, delete: if isAdmin();
}
```

Attack surface today: any signed-in user (including anon prospects from booking LIFF) can `setDoc(doc(db, 'liffUsers/U_ATTACKER_PICK'), { displayName: 'สมชาย (ผู้ดูแล)', status: 'approved', ... })` — pre-poisoning the admin approval queue with impersonation entries. Admin "approve" flow then mints claims for the wrong UID, or admin opens detail modal and sees fake info.

- [ ] **P4.2-1** — Tighten create to UID-match + field allowlist + size caps:

```
allow create: if isSignedIn()
  && request.auth.uid == 'line:' + userId
  && request.resource.data.keys().hasOnly(['lineUserId', 'displayName', 'pictureUrl', 'room', 'building', 'status', 'requestedAt'])
  && request.resource.data.lineUserId is string
  && request.resource.data.lineUserId.size() <= 64
  && request.resource.data.displayName is string
  && request.resource.data.displayName.size() <= 80
  && (!('pictureUrl' in request.resource.data) || request.resource.data.pictureUrl.size() <= 512)
  && request.resource.data.status == 'pending'
  && request.resource.data.requestedAt == request.time;
```

**Why each clause:**
- `auth.uid == 'line:' + userId` — closes impersonation. `liffSignIn` CF uses deterministic UID format `line:<lineUserId>` (per `auth_liff_sot.md`), so this matches naturally for the legitimate flow.
- `hasOnly([...])` — locks the field shape so attacker can't sneak `admin: true` or other extras
- string + size caps — bounds attack surface size (DoS via large blob)
- `status == 'pending'` — caller cannot self-approve
- `requestedAt == request.time` — caller cannot backdate

- [ ] **P4.2-2** — Add rules tests (2 new):
  - Positive: LIFF tenant creates own `liffUsers/U_self` with allowed fields → succeeds
  - Negative: LIFF tenant tries to create `liffUsers/U_other` with `auth.uid = 'line:U_self'` → fails
  - Negative: LIFF tenant tries to create own doc with `status: 'approved'` → fails

---

## Phase 3 — P4.3 marketplace ownerUid

**File:** `firestore.rules:99-103`

Current:
```
match /marketplace/{id} {
  allow read:   if isSignedIn();
  allow create: if isSignedIn();
  allow update: if isSignedIn() && (isAdmin() || request.auth.uid == resource.data.ownerUid);
  allow delete: if isAdmin() || (isSignedIn() && request.auth.uid == resource.data.ownerUid);
}
```

Attack: tenant-A creates listing with `ownerUid = 'line:UVICTIM'`. Now tenant-A can update/delete via admin route, but tenant-VICTIM cannot delete (rule requires `auth.uid == ownerUid` → mismatch). Listing is "stuck" attributed to victim.

- [ ] **P4.3-1** — Add ownerUid enforcement on create:

```
allow create: if isSignedIn()
  && request.resource.data.ownerUid == request.auth.uid;
```

- [ ] **P4.3-2** — Add rules tests (2 new):
  - Positive: tenant creates with own `ownerUid` → succeeds
  - Negative: tenant creates with another tenant's `ownerUid` → fails

---

## Phase 4 — P4.5 RTDB housekeeping (conditional on audit A1)

**File:** `config/database.rules.json:48-56`

Current:
```json
"housekeeping": {
  ".read": "auth != null && auth.token.admin == true",
  "$building": {
    "$room": {
      ".read": "auth != null && (auth.token.admin == true || (auth.token.room == $room && auth.token.building == $building))",
      ".write": "auth != null && (auth.token.admin == true || (auth.token.room == $room && auth.token.building == $building))"
    }
  }
}
```

Same NC-1 pattern as payments — tenant-writable RTDB path that admin reads as truth. Forge vector: tenant fakes housekeeping records to inflate own activity / get cleaning credits / etc.

- [ ] **P4.5-1** — IF audit A1 shows zero tenant-write callers: tighten `.write` to admin-only at the deep path. (Same diff as NC-1 fixed for payments.)
- [ ] **P4.5-2** — IF audit A1 shows tenant write callers: this item escalates to defer (CF write path needed first). State which CF path is the right design and recommend deferring.

RTDB rules tests don't run in `npm run test:rules` (Firestore-only). Manual verification: locally read `database.rules.json`, walk the rule path mentally + check sprint's NC-1 fix for payments uses the identical pattern.

---

## Phase 4b — P4.4 buildings/{id} read tightening (user opted in)

**File:** `firestore.rules:206-232`

Current sprint state:
```
match /buildings/{buildingId} {
  allow read:  if isSignedIn();
  allow write: if isAdmin();
  match /rooms/{roomId} { ... allow read: if isSignedIn(); }
}
```

Attack surface: any signed-in user (incl. anonymous booking prospect) can read EVERY building's `promptPayId`, `companyName`, `ownerEmail`, `address`, `internet`, `policies`, etc. PromptPay is on the receipt → low risk; email/address → privacy violation.

Approach choice driven by audit A5:

**Approach A (preferred if tenant readers are SCOPED):** scope buildings/{id} read to admin OR manager OR tenant of that building.
```
allow read: if isAdmin()
         || isBuildingManager(buildingId)
         || (isSignedIn() && request.auth.token.building == buildingId);
```
Pro: minimal diff, no data migration. Con: breaks any unscoped `getDocs(collection(db, 'buildings'))` read.

**Approach B (preferred if there are list-all reads):** keep `buildings/{id}` readable but split sensitive fields to `buildings/{id}/private/{doc}` admin-only subcollection.
Pro: keeps list-all working for tenant UIs that need cross-building data (probably none). Con: requires data migration (move ownerEmail/address/etc. to subcollection) and reader code update (read main doc + subcollection).

**Tenant-visible `buildings/{id}` fields (need to stay readable):**
- `name` (display in tenant_app)
- `promptPayId` / `promptpayNumber` (receipt + bill page)
- `internet` (status badge — already its own lifecycle doc)
- `policies` (gamification eligibility etc.)

**Admin-only fields (candidates for subcollection):**
- `ownerEmail`
- `address`
- `companyName` (probably tenant-visible too — confirm in audit)
- `phoneNumber`
- any new admin-config field added since audit

- [ ] **P4.4-1** — Run audit A5; record findings inline below.
- [ ] **P4.4-2** — Choose Approach A vs B based on findings.
- [ ] **P4.4-3** — Implement chosen approach in firestore.rules.
- [ ] **P4.4-4** — IF Approach B: write migration script `tools/migrate-buildings-private.js` (read-only first, --apply later). Move sensitive fields. DO NOT auto-run.
- [ ] **P4.4-5** — IF Approach B: update reader code in `dashboard*.js` (admin reads from subcollection). Tenant readers unchanged.
- [ ] **P4.4-6** — Add 2 rules tests:
  - Positive: admin reads any building → succeeds
  - Negative: anon prospect reads `buildings/rooms` (not their building) → fails

---

## Phase 5 — P4.6 isBuildingManager substring

**File 1:** `tools/grant-building-manager.js` — add input validation
**File 2 (optional):** `firestore.rules:18-22` — defensive guard

Current rule:
```
function isBuildingManager(building) {
  return isSignedIn()
    && request.auth.token.managedBuildings != null
    && building in request.auth.token.managedBuildings;
}
```

CEL `in` operator on string: `'X' in 'XY'` returns **true** (substring check). So if a manager is mis-granted `managedBuildings: 'ro'` (string instead of array), `'rooms' in 'ro'` → false, but `'r' in 'ro'` → true — they match any building containing 'r'. The other way: `'rooms' in 'rooms_v2'` → true.

- [ ] **P4.6-1** — `tools/grant-building-manager.js` validation:
  - assert `Array.isArray(managedBuildings)` — else throw with message
  - assert each element is a string AND appears in `BuildingRegistry.list()` (or hardcoded ['rooms', 'nest'] if BuildingRegistry not loadable from Node — confirm)
  - assert no duplicates
  - log final claim shape before `setCustomUserClaims`
- [x] **P4.6-2 (user-approved)** — add `request.auth.token.managedBuildings is list` to the rule. CEL has `is` type check; if claim is set as string, the rule short-circuits to false instead of doing substring match. **Conditional:** audit A4 must show zero existing managers with string claims. If A4 finds any string-claim manager, escalate before adding the guard (option: backfill those claims as arrays first via a one-shot, then add guard).

---

## Phase 6 — Verify + commit

- [ ] **V1** — `npm run test:rules` → all existing 192 tests + new 4+ tests pass
- [ ] **V2** — `npm run verify:memory` → still 34 docs / 0 fails (no new docs touched here unless `firestore_schema_canonical.md` needs a verifier row update — check after rules diff)
- [ ] **V3** — `git diff` review by user (or self-review per §G cross-session conflict check)
- [ ] **V4** — commit on branch off `claude/fervent-kare-f45fb1`
- [ ] **V5** — push to origin, prep PR-open link for user

---

## Out of scope (explicit)

- ❌ Deploy rules to production (user-driven; pre-commit hook handles verifier; user merges PR)
- ❌ P4.1 CORS hardening (defer, see Scope table)
- ❌ P4.4 buildings/{id} split (defer, see Scope table)
- ❌ PRIORITY 5/6/7/9 from prior handoff (separate sprints)

---

## Review — 2026-05-23 (P4 batch shipped)

### Shipped

- **P4.2 liffUsers create hardening** — `firestore.rules` `match /liffUsers/{userId}` now requires `auth.uid == 'line:' + userId` + field allowlist (lineUserId, lineDisplayName, linePictureUrl, room, building, status, requestedAt) + size caps + `status == 'pending'`.
- **P4.3 marketplace ownerUid impersonation** — create rule now enforces `request.resource.data.ownerUid == request.auth.uid`. Transparent to tenant_app.html:6541 which already passes own UID.
- **P4.4 buildings/{id} subcollection split** — sensitive fields `address`, `contact`, `ownerEmail` moved to `buildings/{id}/private/admin` admin-only subcollection. Top-level keeps `displayName`, `promptPayId`, `companyName`, `ownerName`, `status` for booking.html anonymous reads. BuildingRegistry split write paths (PUBLIC_FIELDS / PRIVATE_FIELDS) + admin-context-aware merged read. Migration script `tools/migrate-buildings-private.js` (dry-run default, --apply gate, idempotent).
- **P4.6-1 grant-building-manager.js validation** — CLI now validates building IDs against the live `buildings/{id}` registry (rejects typos that mint useless claims).
- **P4.6-2 isBuildingManager `is list` guard** — rule short-circuits to false if `managedBuildings` claim is ever set as string (closes CEL substring-match attack).
- **Tests** — 192 → 206 rule tests (+14). 13 new + 1 updated. All pass.
- **Verifier** — memory verifier still 34 docs / 328 rows / 0 fails.

### Deferred (separate sprint)

- **P4.1 CORS hardening on 17 CFs** — needs per-CF audit for LIFF webview Origin compatibility before locking.
- **P4.5 RTDB housekeeping admin-write** — audit revealed tenant LIFF writes directly to RTDB at `housekeeping/{b}/{r}/{id}` (tenant_app.html:5554). Needs `submitHousekeepingTicket` CF first.

### Verification

- `firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'` → 206 pass / 0 fail
- `npm run verify:memory` → 34 docs / 328 rows / 0 fails

### Branch state

- Branch: `claude/p4-rules-hardening` off `claude/fervent-kare-f45fb1`
- Worktree: `.claude/worktrees/p4-rules-hardening`
- Ready for push + PR open

### Files changed

- `firestore.rules` — P4.2 liffUsers, P4.3 marketplace, P4.4 buildings + private subcollection, P4.6 isBuildingManager guard
- `firestore.rules.test.js` — +13 new tests, 1 updated test (liffUsers)
- `shared/building-registry.js` — PUBLIC_FIELDS / PRIVATE_FIELDS split, admin-context merged read, schema doc updated
- `tools/grant-building-manager.js` — building registry validation
- `tools/migrate-buildings-private.js` — NEW one-shot migration script
- `tasks/todo.md` — this plan

### Next session

After this branch merges into fervent-kare (or fervent-kare → main), run the migration: `node tools/migrate-buildings-private.js` (dry-run) → review → `--apply`. Then verify in Chrome MCP that booking.html still reads promptpay + admin dashboard still shows owner email/contact in Buildings card.

---

## User decisions captured 2026-05-23

1. ✅ Scope: P4.2 + P4.3 + P4.4 + P4.5 + P4.6 (added P4.4 per user)
2. ✅ Branch: new worktree + new branch off fervent-kare (`claude/p4-rules-hardening`)
3. ✅ P4.6-2: add `is list` rule guard (with audit A4 first)

Proceed to Phase 1 audits.
