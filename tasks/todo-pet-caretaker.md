# ▶▶▶ PLAN (2026-06-13) — Meaning Layer **#14 Emergency Caretaker** (🆘🐾 หาคนช่วยดูแลสัตว์เลี้ยงยามฉุกเฉิน) · ⏳ AWAITING OWNER APPROVAL

> **Roadmap:** [meaning-layer-roadmap.md](meaning-layer-roadmap.md) #14 — *"ระบบหาคนช่วยดูแลยามฉุกเฉิน."* Pet pillar; build order slot **#4** ([remaining-plans](meaning-layer-remaining-plans.md) §5) — last of the Pet builds because its one risky design choice (a profile opt-in flag) touches #10's write-path, and #10's auth is still stabilizing. **The recommended design avoids that collision entirely** (see D1).
> **Reuse spine:** clone the **#2 helpRequests request→accept→complete→cancel** lifecycle wholesale (same 4-callable + pure-engine + building-scoped-rule + LINE-notify template) — for PET-SITTING instead of labour. Almost nothing is net-new logic.

---

## ⚠️ Concurrent-session safety (carries over)
2 sessions live (deposit + auth/§MMM). **OFF-LIMITS:** deposit files · auth files (`_authSoT.js`/`recordChecklistConsent.js`/`tenant-liff-auth.js`/liffUsers-rules/`CLAUDE.md`/`README.md`/`lessons_antipatterns.md`) · **#10 write-path** (`tenant-pet-social.js`/`upsertPetProfile.js`/`_petSocialEngine.js`).
**#14 collision = LOW *if* the per-request design (D1) is chosen** — it READS the pet registry (`tenants/{b}/list/{r}/pets`, #9-era, stable) **read-only**, never `petProfiles`, so it touches NONE of the pet-session files. The alt (persistent opt-in flag on `petProfiles`) WOULD edit `upsertPetProfile.js`/`_petSocialEngine.js`/`tenant-pet-social.js` → **MEDIUM collision** — avoid. Shared append-only points: `functions/index.js` (rebase vs deposit) · `firestore.rules` (new block) · `tenant_app.html` · `tenant-navigation.js` · `components.css`.

---

## What already exists (REUSE — do NOT rebuild) — grep-verified 2026-06-13
- **The #2 lifecycle template** — 4 callables `postHelpRequest`/`acceptHelpRequest`/`completeHelpRequest`/`cancelHelpRequest` ([functions/index.js:192-195](../functions/index.js)), all `region('asia-southeast1').https.onCall`. **#14 clones all four** for `caretakerRequests`.
- **Pure transition engine** — [functions/_helpRequestEngine.js](../functions/_helpRequestEngine.js): `VALID_STATUS = {open, accepted, done, cancelled}`; `canAccept(req, helperUid)` (status `open` + anti-self `requesterUid !== helperUid`, atomic single-winner); `canComplete(req, callerUid)` (status `accepted` + **`requesterUid === callerUid`** → requester confirms, never self-claim, §6); `canCancel(req, callerUid, {isAdmin})` (open|accepted, requester-or-admin). **Clone verbatim into `_caretakerEngine.js`.**
- **Doc shape** — `helpRequests/{id}` `{requesterUid, requesterTenantId, requesterName, building, room, title, status, helperUid?, helperTenantId?, helperBuilding?, helperRoom?, helperName?, createdAt, completedAt}` ([_helpRequestEngine.js:15-18](../functions/_helpRequestEngine.js)). #14 = same + pet fields.
- **Building-scoped read + CF-only-write rule** — [firestore.rules:65](../firestore.rules) `helpRequests` block. Copy verbatim for `caretakerRequests`.
- **Tenant UI module** — [shared/tenant-helpers.js](../shared/tenant-helpers.js): `renderHelperBoard` + `_onLiffClaimsReady` self-wire + `_fs/_db/_fns/_bldg/_room/_uid` helpers (§7-HH/BB) + `httpsCallable`. Admin monitor [shared/dashboard-helpers-admin.js](../shared/dashboard-helpers-admin.js). Clone the board structure.
- **Pet registry read** — `getDocs(collection(db,'tenants',b,'list',r,'pets'))`; safe fields `name`/`typeEmoji`/`photoURL`/`status` (`approved`). #14 snapshots name+emoji onto the request (mirror the PROFILE_SAFE_FIELDS discipline — no health leak).
- **LINE notify on transition** — `_notifyHelper.pushAndRetry` + `enqueueLineRetry` (the #2 pattern). For an URGENT request, the building-wide fan-out query (`liffUsers where building== & status==approved`) is the same one #13 introduces — **reuse #13's helper if #13 ships first** (D3).

## §7-O/AA greenfield check — ✅ CLEAN (run 2026-06-13)
`grep -rn "caretaker\|ดูแลฉุกเฉิน\|caretakerRequest\|petSit" shared/ functions/ tenant_app.html` → only a forward-reference COMMENT in `_petSocialEngine.js:9`; **0 implementation**.

---

## 🔓 OWNER DECISIONS NEEDED (lock at approval)
| # | Decision | Recommended | Alt |
|---|----------|-------------|-----|
| **D1** | Opt-in model | **Per-request only** — anyone in the building can accept an open caretaker request (mirror #2). **No persistent flag, NO `petProfiles` edit → LOW collision.** | A persistent "available to pet-sit" flag on `petProfiles` (#10) → edits `upsertPetProfile.js` etc. (collision) — **avoid**; if wanted later, a SEPARATE `caretakerVolunteers/{tenantId}` doc. |
| **D2** | Points | **Point-free v1** (care + neighbourly connection, mirror #3/#10 — no farm surface, keeps it lean). | Feed #6 Kindness / #7 Verified-Helper by writing `help_completed` on a peer-confirmed complete (caretaking IS confirmed help). Defer to a v2 if wanted. |
| **D3** | Urgency / notify | **v1: notify on transition like #2** (accept/complete/cancel → the counter-party). | Add an `urgency:'urgent'` that fan-outs a building-wide push (reuse #13's `liffUsers where building==` helper) — **Phase 2 / after #13 ships**. |
| **D4** | Scope | **Same-building only** (mirror #10/#2). | cross-building. |
| **D5** | Stale cleanup | **Light sweep** auto-cancels `open` requests whose `period.to` has passed (clone foodShares sweep, single-field). | manual cancel only. |
| **D6** | PR shape | **one PR** (server+rules+UI+tests), worktree off main, land after the 2 sessions merge. | split. |

## Why Plan-First (CLAUDE.md §1 — all three)
NEW collection + rules block + 4 CFs + (optional sweep) + `tenant_app.html`/nav/CSS + new tenant module + tests ≈ **10–12 files**; rules+CF deploy = **not single-revert**; **2+ approaches** (D1 per-request-vs-opt-in, D2 points, D3 urgency).

---

## Data model — `caretakerRequests/{id}` (top-level, building-scoped, CF-only-write)
Clone `helpRequests` + pet fields:
```
{
  requesterUid, requesterTenantId, requesterName, building, room,
  petId, petName, petTypeEmoji,          // SAFE snapshot from the registry (no health)
  period: { from, to },                  // when care is needed (Firestore Timestamps)
  need,                                  // "ให้อาหารเช้า-เย็น พาเดินเล่น"
  urgency: 'scheduled' | 'urgent',       // (D3)
  status: 'open' | 'accepted' | 'done' | 'cancelled',
  caretakerUid?, caretakerTenantId?, caretakerName?, caretakerRoom?,
  createdAt, acceptedAt?, completedAt?,
}
```
- **Client read** = `onSnapshot(query('caretakerRequests', where('building','==',b)))` → single-field → **no composite index**; filter status + sort `createdAt` in JS (§7-AAA).

## State machine (identical to #2)
```
(owner: ขอผู้ดูแล + pick pet + period)  → open      (LINE notify per D3)
  open  ─[neighbour accept, atomic]──────→ accepted  (canAccept: open + anti-self · notify requester)
  accepted ─[requester confirm done]─────→ done       (canComplete: requester===caller, §6 honest)
  open/accepted ─[requester/admin cancel]→ cancelled  (canCancel)
  open ─[auto: period.to < now]──────────→ cancelled  (sweep · D5)
```

---

## Tasks (TDD — clone #2)

### Phase 1 — server: collection + 4 callables + engine + rules (pure-TDD)
- [ ] **`functions/_caretakerEngine.js`** (NEW, pure) — clone `_helpRequestEngine`: `VALID_STATUS`, `canAccept`/`canComplete`/`canCancel`, + `buildCaretakerDoc({...})` (snapshots SAFE pet fields — assert no health leak). Unit-test (mirror the #2 engine tests).
- [ ] **`functions/postCaretakerRequest.js`** (NEW) — onCall SE1; `assertTenantAccess`; `checkRateLimit(uid,'postCaretakerRequest',5,86400)`; read the requester's approved pet (`tenants/{b}/list/{r}/pets/{petId}`, D1); validate period/need; write `caretakerRequests/{auto}` (status `open`).
- [ ] **`functions/acceptCaretakerRequest.js`** (NEW) — onCall SE1; `assertTenantAccess`; **`runTransaction`** re-read status (atomic single-winner, mirror #2 acceptHelpRequest) → `canAccept` → set `accepted` + caretaker identity; LINE-notify requester.
- [ ] **`functions/completeCaretakerRequest.js`** (NEW) — onCall SE1; `canComplete` (**requester confirms** — §6 honest); set `done`. (D2: if points chosen, write `help_completed` here.)
- [ ] **`functions/cancelCaretakerRequest.js`** (NEW) — onCall SE1; `canCancel` (requester or `token.admin`).
- [ ] *(D5)* **`functions/cleanupCaretakerRequestsScheduled.js`** (NEW) — clone foodShares sweep: `pubsub.schedule('30 4 * * *').timeZone('Asia/Bangkok')` (§7-NN), auto-cancel `open` past `period.to`. Register in [[lifecycle_scheduled_jobs]] + `verify:memory`.
- [ ] **`functions/index.js`** — 4 (+1) exports column-0 (§7-CCC). ⚠️ rebase vs deposit.
- [ ] **`firestore.rules`** — NEW `match /caretakerRequests/{id}` building-scoped read + `write:false` (copy helpRequests) + rules-emulator tests.

### Phase 2 — frontend (no CSP regen)
- [ ] **`shared/tenant-pet-caretaker.js`** (NEW IIFE, clone `tenant-helpers.js` + `tenant-pet-social.js` skeleton) — `window.renderPetCaretaker` + `_subscribe` (onSnapshot `caretakerRequests where building==`, §7-N/V/U/A) + `_loadOwn` (own approved pets for the form). Renders into `#pet-caretaker-list`: **(1) คำขอผู้ดูแลในตึก** (open requests: pet name/emoji, period, need, **รับดูแล** button; the OWNER's own request shows status + **เสร็จแล้ว**/**ยกเลิก** — §7-FFF bucket by `requesterRoom`) · **(2) ขอผู้ดูแล** (pick own approved pet + period + need (+urgency D3) → `postCaretakerRequest`; §7-X empty "ยังไม่มีน้องที่อนุมัติ" → registration). DIRECT listeners (§7-JJJ). Pure helpers (`isRequester`, `fmtPeriod`) exported + unit-tested.
- [ ] **`tenant_app.html`** — `<div id="pet-caretaker-page" class="page">` after `#pet-directory-page` + entry button in `#pet-park-page` (`data-action="showSubPage" data-page="pet-caretaker-page"`) + `<script src="./shared/tenant-pet-caretaker.js" defer>` line ≥152 (§7-PP).
- [ ] **`shared/tenant-navigation.js`** — one `if (id === 'pet-caretaker-page' …) window.renderPetCaretaker();` hook (after :99).
- [ ] **`shared/components.css`** — appended `.pet-caretaker__*` (§7-RR/III). `csp:hash` no-drift.
- [ ] *(optional)* admin monitor — clone `dashboard-helpers-admin.js` → "🐾 ผู้ดูแลฉุกเฉิน". Defer to Phase 2 to minimize collision (touches dashboard files).

### Phase 3 — gate + verify + docs
- [ ] Gates: `test:shared` (+pure) · CF suite (+engine/callable/atomic-accept-race/sweep) · `test:rules` (+caretakerRequests) · §7-TT mojibake clean · `csp:hash` no-drift · `verify:memory` green.
- [ ] **Live-verify (owner, real LINE):** A posts a caretaker request for their pet → appears in B's board same building → B accepts → A gets notify → A confirms done → cleared; race: two accept the same open request → only one wins (the tx); cross-building isolation; (D5) a past-period open request auto-cancels.
- [ ] **Docs same session:** `lifecycle_pet_caretaker.md` (memory) + MEMORY.md Pet section + flip [[meaning-layer-roadmap]] #14 ✅ + (D5) add the job to [[lifecycle_scheduled_jobs]].

---

## Anti-pattern guardrails
- **§7-NN** onCall not trigger. **§7-I** accept/post are the user's own taps; no auto-click. **§6** requester confirms completion (never self-claim). **§7-A/U/BB/N/V/X/FFF/JJJ** tenant-module discipline (clone tenant-helpers). **§7-AAA** no unordered `limit()`. **Atomic accept** via `runTransaction` (single-winner, clone #2 acceptHelpRequest) — the correctness-critical bit. **§7-DD** wire move-out/erasure cleanup for the new collection. **§7-CCC** un-indented exports. **§7-PP** script after `tenant-navigation.js`. **§7-II/RR** no inline style → no CSP regen.

## Reuse verification (grep before coding — §7-H)
```bash
grep -nE "exports\.(post|accept|complete|cancel)HelpRequest" functions/index.js     # 4-callable template
grep -n "canAccept\|canComplete\|canCancel\|VALID_STATUS" functions/_helpRequestEngine.js
grep -n "runTransaction\|canAccept" functions/acceptHelpRequest.js                   # atomic single-winner
grep -n "match /helpRequests" firestore.rules                                        # rule shape
grep -n "renderHelperBoard\|_onLiffClaimsReady" shared/tenant-helpers.js             # UI skeleton
grep -n "PROFILE_SAFE_FIELDS" functions/_petSocialEngine.js                          # safe-field discipline (read-only #10)
grep -n "pet-park-page\|pet-directory-page" tenant_app.html
```

---

## Review (fill on ship)
- _Pending owner approval (D1–D6, esp. D1 per-request to keep collision LOW) + build (held until deposit/auth sessions merge)._
