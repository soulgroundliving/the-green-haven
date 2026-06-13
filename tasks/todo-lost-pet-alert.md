# ▶▶▶ PLAN (2026-06-13) — Meaning Layer **#13 Lost Pet Alert** (🆘 "วันนี้แมวหาย" → broadcast ทั้งตึก) · ⏳ AWAITING OWNER APPROVAL

> **Roadmap:** [meaning-layer-roadmap.md](meaning-layer-roadmap.md) #13 — *"วันนี้แมวหาย" → urgent building-wide broadcast so everyone watches.* Pet pillar, **gate: none / buildable now**. Picked over #11/#14 because it does NOT depend on #10's (still-stabilizing) social graph + auth, reuses the most-mature infra (LINE push + ephemeral sweep), and has the **lowest file-collision** with the 2 concurrent sessions (all-new files; clones, never edits, #10/auth/deposit code).
>
> **Working principle** ([[meaning-layer-roadmap]]): one ตัว at a time · capture before score · **reuse don't reinvent** · respect data-readiness gates · **no breadth sweeps** (one surface per PR).

---

## ⚠️ Concurrent-session safety (2 other sessions live — [[feedback_concurrent_session_handling]])
This plan was written on branch `docs/antipattern-mmm-dual-auth-gate` (the **auth/§MMM session's** branch, with its staged `CLAUDE.md`/`README.md`/`tasks/lessons_antipatterns.md`). **Do NOT touch / stage / commit those.** Build #13 in an **isolated worktree off `origin/main`** (mirror how #15/#16/#349 shipped during concurrent sessions).

**OFF-LIMITS files (owned by other sessions — must not edit):**
- **Deposit session:** `shared/deposit-calc.js` · `shared/dashboard-deposits-admin.js` · `shared/dashboard-main.js` · `shared/__tests__/deposit-calc.test.js` · `functions/_billWrite.js` · `functions/confirmMoveIn.js` · `functions/forfeitReservedDeposit.js` · `functions/verifyDepositSlip.js` · the `deposits` block in `firestore.rules` · `tasks/todo.md` · `tasks/todo-deposit-premovein.md` · `tools/_harness_reserve_deposit.html`
- **Auth/§MMM session:** `functions/_authSoT.js` · `functions/recordChecklistConsent.js` · `shared/tenant-liff-auth.js` · the `liffUsers` block in `firestore.rules` · `CLAUDE.md` · `README.md` · `tasks/lessons_antipatterns.md`
- **#10 Pet Social write-path (auth session touched it for #342):** `shared/tenant-pet-social.js` · `functions/upsertPetProfile.js` · `functions/_petSocialEngine.js` — **#13 does NOT need any of these** (it reads the **pet registry** `tenants/{b}/list/{r}/pets`, not `petProfiles`).

**SHARED registry files #13 must append to (additive only — rebase carefully, expect a merge touch):**
`functions/index.js` (new exports — deposit session also appends here → **highest rebase-churn point**) · `firestore.rules` (NEW `petAlerts` block — different block from deposits/liffUsers) · `firestore.indexes.json` · `tenant_app.html` (new page div + entry button — additive) · `shared/tenant-navigation.js` (1-line hook) · `shared/components.css` (appended `.pet-alert__*` block) · `firebase deploy` recipients.
**Recommendation:** land #13 **AFTER** deposit + auth sessions merge, to dodge `index.js`/`firestore.rules` rebase churn. Plan is safe to write + review now; hold the build until the tree settles or coordinate the `index.js` export lines.

---

## What already exists (REUSE — do NOT rebuild) — all grep-verified 2026-06-13
- **LINE fan-out primitives** — [functions/_notifyHelper.js](../functions/_notifyHelper.js): `lookupApprovedRoomUsers(fs, building, roomId)` (`:25-36`, queries `liffUsers where building== & room== & status=='approved'`, **doc.id IS the lineUserId**) + `pushAndRetry(...)` (`:50-83`, `Promise.allSettled` fan-out `fetch`→LINE push, `enqueueLineRetry` on failure). **Building-wide = drop the `.where('room',…)` clause** → `liffUsers where building== & status=='approved'`.
- **Retry queue (already LIVE, no change)** — `enqueueLineRetry` ([_lineRetry.js](../functions/_lineRetry.js)) → `lineRetryQueue/{idempotencyKey}` (merge:false, idempotent); drained by `processLineRetryQueue` ([lineRetryQueue.js](../functions/lineRetryQueue.js), every 15 min, SE1, Asia/Bangkok, 5-attempt backoff). See [[lifecycle_line_notification]].
- **onCall + tenant-auth + rate-limit template** — [functions/shareFood.js](../functions/shareFood.js): `functions.region('asia-southeast1').https.onCall` (`:33`) + `assertTenantAccess({building,roomId,context})` (`:81`, §7-Z/HH/P-robust 6-path) + `checkRateLimit(uid, action, max, windowSec)` ([_rateLimit.js:25](../functions/_rateLimit.js)). **This is the actor model for #13** (tenant raises their own alert — NOT admin-only like `notifyMaintenanceTenant`).
- **Ephemeral auto-expire sweep** — [functions/cleanupFoodSharesScheduled.js](../functions/cleanupFoodSharesScheduled.js): `pubsub.schedule('20 3 * * *').timeZone('Asia/Bangkok')` (§7-NN scheduled, NOT trigger) + `where('expiresAt','<',cutoff).limit(300)` paginated loop + storage-delete + `doc.ref.delete()`. **Single-field inequality → auto-indexed, no composite.** Clone for `cleanupPetAlertsScheduled`.
- **Building-scoped collection + CF-only-write read rule** — [firestore.rules:88-93](../firestore.rules) `foodShares` block (identical shape on `petProfiles`/`petLinks`/`helpRequests`): `allow read: if isAdmin() || (isSignedIn() && request.auth.token.building != null && resource.data.building == request.auth.token.building); allow write: if false;`. **Copy verbatim** for `petAlerts`.
- **Tenant UI wiring** — sub-page `<div id="…-page" class="page">` (e.g. `#pet-park-page` [tenant_app.html:4333], `#pet-directory-page` :4850) + entry button `data-action="showSubPage" data-page="…"` + `<script src="./shared/tenant-pet-*.js" defer>` after `tenant-navigation.js` (`:107`; pet modules `:149-151`, §7-PP) + `showSubPage` render hook ([tenant-navigation.js:90-99](../shared/tenant-navigation.js) — one `if (id === 'pet-alert-page' && typeof window.renderPetAlerts === 'function') window.renderPetAlerts();`).
- **Tenant module skeleton** — [shared/tenant-pet-social.js](../shared/tenant-pet-social.js): IIFE · `_ready()` claim guard · `_onLiffClaimsReady(_subscribe)` self-wire (§7-A) · `window._tenantAppBuilding`/`_tenantAppRoom` (§7-BB) · `onSnapshot` + error-cb-nulls-unsub (§7-N) · `_teardown` before rebind (§7-V) · callables via `window.firebase.functions.httpsCallable` · DIRECT button listeners (no data-action hub → §7-JJJ-safe) · `window.renderPetAlerts` explicit export (§7-QQ). **Clone the skeleton into a NEW `shared/tenant-pet-alerts.js`.**
- **Pet registry read** — `getDocs(collection(db,'tenants',building,'list',room,'pets'))` ([tenant-pets.js:64](../shared/tenant-pets.js)). Pet doc fields the alert card can show: `name`, `typeEmoji`, `breed`, `photoURL`, `status` (`'approved'` required). **NO new photo upload** — reuse existing `photoURL` (lean, like #9).
- **CSS** — static `.pet-dir__*` in [components.css:1143-1263](../shared/components.css), token-driven `var(--card)`/`var(--text)`/`var(--text-muted)`/`var(--border-subtle)`/`var(--green)` + `[data-theme="dark"]` only for hardcoded pale fallbacks (§7-RR no injected `<style>`; §7-III dark aliases). New `.pet-alert__*` follows this exactly (+ a danger/urgent accent token).

## §7-O/AA greenfield check — ✅ CLEAN (run 2026-06-13)
`grep -rn "lostPetAlert\|petAlert\|raisePetAlert\|LostPet\|น้องหาย\|สัตว์เลี้ยงหาย" shared/ functions/ tenant_app.html` → **0 hits** (nothing half-built/orphaned to wire). No existing scheduled CF named `*petAlert*` (`grep -rln pubsub.schedule functions/` — won't dup §7-AA).

---

## 🔓 OWNER DECISIONS NEEDED (lock at approval — there are real tradeoffs)
| # | Decision | Recommended (my default) | Alt |
|---|----------|--------------------------|-----|
| **D1** | Who raises an alert? | **Tenant-self** — the owner knows first; `raisePetAlert` gated by `assertTenantAccess` on their own room (mirror `shareFood`). | Admin-mediated (slower; owner texts admin). |
| **D2** | Push scope | **Whole building, approved tenants only**, exclude the owner's own room (no self-push). | Opt-in "pet watchers" only / both buildings. |
| **D3** | Card content | pet `name`+`typeEmoji`+`photoURL` (safe snapshot) + `room` ("เห็นน้อง? ห้อง Nxxx") + free-text **`lastSeen`** + **optional** owner-typed `contactNote`. **No health/vaccine** (PDPA — mirror `PROFILE_SAFE_FIELDS`). | Add a structured phone field (more PDPA disclosure). |
| **D4** | TTL / auto-expire | **48h default** (a search runs longer than a food share's 24h), owner re-raises if still lost. | Owner picks 24h/48h/7d; or admin-extend. |
| **D5** | Resolve | Owner taps **"✅ เจอแล้ว"** → `status:'resolved'`, stops showing. **No relief-push in v1.** | Send a "พบน้องแล้ว 🎉" relief push to the building (Phase 2). |
| **D6** | Consent / PDPA | **No new consent doc** — owner-initiated, own pet, each alert = an explicit per-event action (= implicit consent) + auto-expires. Lean like #9 pet-health (no `*_v1` consent). **Confirm modal (`GhModal`) previews the push before it fires** (§7-I spirit — no silent mass-push). | Add a `pet_alert_v1` consent gate (heavier; risks the §7-LLL await-race). |
| **D7** | In-app urgency surface | **v1 = pet-park sub-page + LINE push only.** | Phase 2: a world-map banner "🆘 มีน้องหายในตึก" when an active alert exists (touches more `tenant_app.html` → more collision). |
| **D8** | Admin monitor | **v1 tenant-only** (admin sees via Firestore). | Phase 2: read-only admin monitor (touches `dashboard-*` files → collision; defer). |
| **D9** | PR shape | **One PR** (server + rules + index + UI + tests; behind `validate.yml`), isolated worktree off `origin/main`, **land after deposit+auth merge**. | Split PR1 server / PR2 frontend (more rebase touches on `index.js`). |

## Why Plan-First (CLAUDE.md §1 — all three apply)
NEW collection + `firestore.rules` block + 3 CFs + composite-index question + `tenant_app.html`/nav/CSS + new tenant module + tests ≈ **10–12 files**; schema + rules-deploy + CF-deploy + index-deploy = **not single-revert**; **2+ approaches** (D1 tenant-vs-admin, D6 consent-or-not, D9 one-vs-two PR).

---

## Data model — `petAlerts/{alertId}` (top-level, building-scoped, CF-only-write)
Mirrors the `foodShares` shape (ephemeral + building + status + expiresAt):
```
{
  alertId,                       // doc id
  petId,                         // owner's pet registry doc id (tenants/{b}/list/{r}/pets/{petId})
  ownerUid,                      // context.auth.uid — server-set, anti-spoof
  ownerTenantId,                 // canonical tenants/{b}/list/{r}.tenantId (matches consents/trustScores ids)
  building,                      // 'rooms' | 'nest' (canonical — §7-buildings)
  ownerRoom,                     // String(room) — for the recipient-only resolve guard + "ห้อง Nxxx" display
  petName, petTypeEmoji, petPhotoURL,   // SAFE snapshot only (D3) — health/vaccine NEVER copied
  lastSeen,                      // free text "เห็นครั้งสุดท้ายแถวลิฟต์ชั้น 3"
  contactNote,                   // optional, owner-typed (D3)
  status: 'active' | 'resolved' | 'expired',
  createdAt,                     // serverTimestamp
  resolvedAt,                    // when owner taps เจอแล้ว
  expiresAt,                     // serverTimestamp + 48h (D4) — single-field inequality for the sweep
}
```
- **Client read** = `onSnapshot(query(collection 'petAlerts', where('building','==',b)))` → single-field → **no composite index**. Filter `status==='active' && expiresAt>now` + sort by `createdAt` **in JS** (§7-AAA: never an unordered `limit()`; building scope is naturally bounded).
- **Anti-dup:** `raisePetAlert` refuses if an `active` alert already exists for this `petId`.

## State machine
```
(owner: แจ้งน้องหาย + confirm modal) → active   (fan-out LINE push to building · expiresAt +48h)
  active ─[owner: ✅ เจอแล้ว]──────────→ resolved  (stops showing · D5)
  active ─[auto: expiresAt < now]──────→ expired   (cleanupPetAlertsScheduled flips/deletes · D4)
```

---

## Tasks (TDD per ตัว — pure helpers + engine tests RED→GREEN before wiring)

### Phase 0 — verify the index question (§7-N — BEFORE any UI deploy)
- [ ] The existing `liffUsers` composite is `(building, room, status)` ([firestore.indexes.json:45-53](../firestore.indexes.json)) — this does **NOT** prefix-match the building-wide `(building, status)` query. **Determine empirically** whether the 2-equality query needs a new composite or is served by a single-field **zigzag merge** (Firestore can merge two auto single-field indexes for equality-only filters): verify by STATE (`gcloud firestore indexes composite list`) or run the actual query against prod once (§7-J sub-lesson — don't trust an empty-collection pass). If needed → add `{collectionGroup:'liffUsers', fields:[building ASC, status ASC]}` + `firebase deploy --only firestore:indexes` and WAIT for build-complete **before** the CF goes live (§7-N onSnapshot/getDocs swallow the missing-index error).

### Phase 1 — server: collection + 3 callables + rules (pure-TDD)
- [ ] **`functions/_petAlertEngine.js`** (NEW, pure) — `canRaiseAlert(pet, existingActive)` (pet `status==='approved'`, no active dup), `buildAlertDoc({petId, pet, building, room, ownerTenantId, ownerUid, lastSeen, contactNote, now})` (snapshots SAFE fields only — assert no `healthLog`/`vaccine*`/`photoPath` leak), `safeContact(str)` cap/escape, `isExpired(alert, now)`. Unit-test all (mirror `_foodShareEngine` + `_petSocialEngine` tests).
- [ ] **`functions/raisePetAlert.js`** (NEW) — `region('asia-southeast1').https.onCall`; `assertTenantAccess({building,roomId,context})`; `checkRateLimit(uid,'raisePetAlert',2,86400)` (**hard 2/day — no alert spam**); read `tenants/{b}/list/{r}/pets/{petId}` → `canRaiseAlert`; write `petAlerts/{auto}`; **fan-out**: `liffUsers where building== & status=='approved'`, **exclude `ownerRoom`**, `pushAndRetry` a 🆘 Flex (deep-link `?page=pet-alert`), idempotencyKey `petalert-${alertId}-${userId}`; `runWith({secrets:['LINE_CHANNEL_ACCESS_TOKEN']})`.
- [ ] **`functions/resolvePetAlert.js`** (NEW) — onCall SE1; `assertTenantAccess` + **verify `alert.ownerRoom===room`** (recipient/owner-only guard — mirror the `upsertPetProfile` opt-out HIGH-2 `ownerRoom==room` fix); `status:'resolved'`, `resolvedAt`. (Admin `token.admin===true` may also resolve — OR.)
- [ ] **`functions/cleanupPetAlertsScheduled.js`** (NEW) — clone `cleanupFoodSharesScheduled`: `pubsub.schedule('40 3 * * *').timeZone('Asia/Bangkok')` (§7-NN), `where('expiresAt','<',cutoff).limit(300)` paginated → delete (+ `cleanupPetAlertsManual` admin onCall companion). **No storage cleanup needed** (reuses existing pet photo, not an alert-owned upload). Register in [[lifecycle_scheduled_jobs]] (13→14 jobs) + `npm run verify:memory`.
- [ ] **`functions/index.js`** — `exports.raisePetAlert` / `resolvePetAlert` / `cleanupPetAlertsScheduled` / `cleanupPetAlertsManual` (column-0; **§7-CCC** match `^\s*exports\.` — keep un-indented so CI auto-deploy picks them up). ⚠️ rebase point vs deposit session.
- [ ] **`firestore.rules`** — NEW `match /petAlerts/{alertId}` building-scoped read + `allow write: if false` (copy `foodShares:88-93`). + rules-emulator tests (mirror `foodShares` rules tests: same-building read ✅, cross-building ✗, client write ✗).
- [ ] **PDPA wiring (§7-DD — top-level collection doesn't auto-archive):** add a `cleanupPetAlertsByTenant(fs, tenantId)` to the move-out (`archiveTenantOnMoveOut`) + erasure (`requestDataDeletion`) cascade — mirror `cleanupPetSocialByTenant`. Decide (D6) whether `exportMyData` includes `petAlerts` (likely yes, keyed on ownerTenantId). ⚠️ these CFs may be touched by other sessions — confirm before editing; if contended, defer the cascade to a follow-up commit but **note the gap**.

### Phase 2 — frontend: tenant sub-page (no CSP regen — markup + external script + external CSS)
- [ ] **`shared/tenant-pet-alerts.js`** (NEW IIFE, clone `tenant-pet-social.js`) — `window.renderPetAlerts` + `_subscribe` (`onSnapshot petAlerts where building==`, error-cb-nulls-unsub §7-N, `_teardown` before rebind §7-V, claim guard §7-U, `_onLiffClaimsReady` self-wire §7-A) + `_loadOwn` (getDocs own approved pets for the form). Renders into `#pet-alert-list`: **(1) 🆘 active alerts in the building** (urgent cards: photo/emoji, name, "ห้อง Nxxx", lastSeen, contactNote; the OWNER's own alert shows **✅ เจอแล้ว** — bucket by `ownerRoom` not `auth.uid`, §7-FFF) · **(2) แจ้งว่าน้องหาย** (pick own approved pet + lastSeen + optional contact → **confirm modal previews the push** → `raisePetAlert`; §7-X empty state "ยังไม่มีน้องที่อนุมัติ" → link to pet registration). DIRECT listeners (§7-JJJ-safe). Pure helpers (`isOwnAlert`, `fmtLastSeen`, dedup key) exported + unit-tested (`shared/__tests__/tenant-pet-alerts.test.js`).
- [ ] **`tenant_app.html`** — `<div id="pet-alert-page" class="page">` after `#pet-directory-page` (~:4860+) + entry button in `#pet-park-page` (`data-action="showSubPage" data-page="pet-alert-page"`, generic dispatch — no hub edit, §7-JJJ) + `<script src="./shared/tenant-pet-alerts.js" defer>` at line ≥152 (after `tenant-pet-social.js`, §7-PP) + **deep-link route**: `?page=pet-alert` → `showPage`/`showSubPage('pet-alert-page')` on load (so the 🆘 Flex button lands here — see [[lifecycle_line_notification]] §Deep-links: both the CF URL builder AND the tenant_app route are required).
- [ ] **`shared/tenant-navigation.js`** — one `if (id === 'pet-alert-page' && typeof window.renderPetAlerts === 'function') window.renderPetAlerts();` in the `showSubPage` hook (after :99).
- [ ] **`shared/components.css`** — appended static `.pet-alert__*` block, token-driven (§7-RR/§7-III), urgent accent. **No JS-injected `<style>`.** Verify `npm run csp:hash` shows **no `tools/csp-hashes.json` drift** (markup + external assets → no inline → no CSP regen, §7-II/RR).

### Phase 3 — gate + verify + docs
- [ ] Gates: `npm run test:shared` (+ new pure tests) · full CF suite (+ engine/callable/cleanup tests) · `npm run test:rules` (+ petAlerts cases) · §7-TT mojibake clean · `npm run csp:hash` no-drift · `npm run verify:memory` green.
- [ ] **Live-verify (owner, real LINE — §7-J, can't drive from dev):** room A raises an alert → every approved tenant in the building gets the 🆘 push → tapping it deep-links to `#pet-alert-page` → the card shows → owner taps ✅ เจอแล้ว → it clears; cross-building isolation (other building gets nothing); rate-limit (3rd raise same day blocked). A read-only preflight asserter (mirror `tools/preview-pet-social.js`) is optional.
- [ ] **Docs (same session it ships):** new `lifecycle_pet_alert.md` (memory) + MEMORY.md 🏛️ Pet section + flip the [[meaning-layer-roadmap]] #13 checkbox + Review entry citing the PR + add the scheduled job to [[lifecycle_scheduled_jobs]].

---

## Anti-pattern guardrails (every task)
- **§7-NN** backend = `onCall`, never a Firestore trigger (Firestore SE3, Eventarc unsupported). **§7-I** the building-wide push is a mass action → confirm modal previews it, never auto-fire; hard rate-limit 2/day server-side.
- **§7-A/U/BB** tenant LIFF reads via `_onLiffClaimsReady` + claim guard + `_tenantAppBuilding/_tenantAppRoom` (never `_liffClaims`). **§7-N/V** onSnapshot error cb + unsub-before-rebind. **§7-X** non-empty render paths. **§7-FFF** bucket "mine" by `ownerRoom`, not `auth.uid`. **§7-JJJ** direct listeners or explicit dispatch cases for arg-taking actions.
- **§7-AAA** no unordered `limit()` — building-scoped, sort/filter in JS. **§7-N** composite index READY before the UI deploy (Phase 0). **§7-DD** top-level collection → wire move-out + erasure cleanup cascade. **§7-CCC** un-indented `exports.` so CI auto-deploys. **§7-PP** new `<script defer>` after `tenant-navigation.js`. **§7-II/RR** no inline `<style>`/injected style → no CSP regen.
- **PDPA** safe-fields-only snapshot (no health/vaccine), auto-expire, owner-initiated (D6).

## Reuse-path verification (grep before coding — §7-H)
```bash
grep -n "lookupApprovedRoomUsers\|pushAndRetry" functions/_notifyHelper.js          # fan-out primitives
grep -n "region('asia-southeast1').https.onCall\|assertTenantAccess\|checkRateLimit" functions/shareFood.js
grep -n "pubsub.schedule\|expiresAt.*<\|limit(300)" functions/cleanupFoodSharesScheduled.js
grep -n "match /foodShares" firestore.rules                                          # rule shape to copy
grep -n "liffUsers" firestore.indexes.json                                           # confirm (building,room,status) only
grep -n "renderPetDirectory\|_onLiffClaimsReady\|_teardown" shared/tenant-pet-social.js   # module skeleton
grep -n "showSubPage\|renderPetDirectory" shared/tenant-navigation.js                # nav hook
grep -n "pet-directory-page\|pet-park-page" tenant_app.html                          # surface anchors
```

---

## Review (fill on ship)
- _Pending owner approval (D1–D9) + build (held until deposit/auth sessions merge per concurrent-session safety)._
