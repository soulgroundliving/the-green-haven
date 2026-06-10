# 9-Dimension Re-Audit Remediation Plan (run 2)

> **▶ NEW forward-looking program (2026-06-02):** [core-readiness-roadmap.md](core-readiness-roadmap.md) — Core readiness for "เปิดตรวจจริง" (accountant/tax/investor) + the blueprint's 3 future features (Behavioral Intelligence · Trust System · Autonomous Ops). ✅ approved 2026-06-02; **Phase 0 (pointsLedger append-only event log) shipped** (PR #227 `96ca28a`, deployed). This file below = the (mostly-done) 9-dim audit remediation.

---

## ▶▶▶ ACTIVE PLAN (2026-06-11) — Meaning Layer **#6 Kindness · tenant tier badge v1.x** · ✅ APPROVED · PR1 server+rules BUILT (all gates green) · ⏳ owner merge+deploy → then PR2 frontend

> **Gate (PR1, 2026-06-11):** full functions suite **2288/0** (+7) · rules emulator **332/0** (+2 kindnessTier tamper-proof cases) · `_kindness` 16/0 (+6 kindnessTier) · `recordChecklistConsent` 10/0 (+1 kindness_v1) · sweep 10/0 (mirror assertions updated for combined write) · node --check clean · §7-TT mojibake clean. exportMyData unchanged (DSR already covers trustScores+consents).

> Roadmap ([meaning-layer-roadmap.md](meaning-layer-roadmap.md)) item **#6**: server + admin **already shipped** (#329/#330/#331, live-verified N101=13). This plan builds the **last sub-phase** — the tenant-facing **Kindness tier badge**: a positive-framed TIER LABEL (never the 0–100 number), consent-gated, on the eco/quest Info tab, beside the reputation badge.
>
> **Approach = mirror the already-shipped Reputation tier badge v1.x EXACTLY** (#288 server+rules / #289 frontend — [[lifecycle_trust_reputation]] "Tenant-visible (v1.x)"). Same MIRROR architecture: the daily sweep maps `kindness`+`kindnessProvisional` → a coarse tier ENUM via a pure `kindnessTier()` and writes ONLY that enum onto the tenant-readable roster doc `tenants/{b}/list/{r}.kindnessTier`; the raw number + factors never leave the admin-only `trustScores` doc. The badge reads the enum off the tenant doc it already loads (`TenantFirebaseSync.loadLease`) — no new subscription, no `trustScores` read-rule change.

### Why
Completes #6 end-to-end — the tenant now SEES the น้ำใจ they've accrued (quests + food-shares + helping neighbours), reinforcing the pro-social loop the Meaning Layer exists to create. Tier-only + positive-framing avoids the credit-score anxiety the reputation badge guards against. **Why Plan-First (CLAUDE.md §1):** touches `firestore.rules` (protected field) + a consent purpose + sweep CF + 8 files; CF+rules deploy = not single-revert; 2+ real choices (consent gate vs disclosure-only · PR split). Verified-reuse map below from 2 Explore agents (file:line, §7-H/K/O).

### ⭐ Decisions to confirm (before any code)
**D1 — Consent gate vs disclosure-only · REC: consent-gate (`kindness_v1`, mirror reputation).** Kindness is purely positive so the owner *could* show it to everyone (disclosure-only, less friction). REC keeps the gate: PDPA-consistent (displaying company-derived personal data → §19 consent), matches the roadmap's literal "consent-gated, tier-only", and the gentle prompt doubles as a "here's the kindness we noticed" moment. Alt = disclosure-only (no opt-in) — diverges from spec + reputation precedent.

**D2 — One combined tenant-doc mirror write · REC: yes.** Fold `kindnessTier` into the existing reputation mirror → `batch.set(tDoc.ref, {reputationTier, kindnessTier}, {merge:true})`. One write carries both tiers ⇒ no extra batch op (stays `pending += 2`), single writer (§7-T). Cost: update 1 existing sweep-test assertion (`Object.keys(mirror.data)` `['reputationTier']` → `['reputationTier','kindnessTier']`). Elegant; recommended.

**D3 — PR split · REC: 2 PRs (mirror reputation).** PR1 server+rules (owner-gated deploy, NOT single-revert) · PR2 frontend (single-revert, Vercel auto). Alt = 1 PR (couples non-single-revert rules/CF with revertible frontend) — not recommended.

**Tier enum + labels** (positive-framed; server `kindnessTier(kindness, provisional)` → `radiant|warm|kind|seed`; bounds aligned with admin `kindTier` 70/40/10; provisional or <10 → `seed`):
| enum | bound | emoji | label | sub |
|------|-------|-------|-------|-----|
| radiant | ≥70 | 💚 | น้ำใจล้น | คุณคือผู้ให้ของชุมชน |
| warm | ≥40 | 🌿 | ใจดี | น้ำใจของคุณช่วยให้ชุมชนอบอุ่น |
| kind | ≥10 | 🤲 | มีน้ำใจ | ขอบคุณที่แบ่งปันให้เพื่อนบ้าน |
| seed | <10 / provisional | 🌱 | กำลังสร้างน้ำใจ | เริ่มแบ่งปันเพื่อสะสมน้ำใจ |
(provisional = <3 kind acts → gentle seed face, mirroring reputation's provisional→seed collapse. Never a "ต่ำ"/red state.)

### Verified-reuse map (2 Explore agents, file:line — §7-H/K/O)
- `functions/_reputation.js:208` `reputationTier(rep, prov)` (bounds 80/60/40 → `high/good/fair/low/provisional`) — the template for `kindnessTier`.
- `functions/_kindness.js` (124 LOC) — `computeKindness` + `KINDNESS_SOURCES` + `KINDNESS_CONSTANTS`; module.exports:116; **no tier fn yet**. Sweep imports `{computeKindness, KINDNESS_SOURCES}` at `computeTrustScoresScheduled.js:55`.
- `computeTrustScoresScheduled.js:~236` — existing reputation mirror `batch.set(tDoc.ref, {reputationTier: reputationTier(...)}, {merge:true})`; kindness already computed at `:211` (`kind.kindness`/`kind.provisional`). Fold kindnessTier here (D2).
- `firestore.rules` `tenants/{b}/list/{r}` update — protected list `hasAny(['gamification','rentAmount','building','roomId','tenantId','reputationTier'])` → add `'kindnessTier'`.
- `functions/recordChecklistConsent.js:29` `VALID_PURPOSES = Set(['checklist_v1','account_v1','reputation_v1'])` → add `'kindness_v1'`; writes `consents/{tenantId}_{purpose}`.
- `functions/exportMyData.js` — already exports `trustScores/{tenantId}` (incl. kindness fields) + `consents` ledger → **NO CHANGE** (DSR §30 already covered).
- `shared/dashboard-kindness.js:31` admin `kindTier` (70/40/10, radiant💚/warm🌿/kind🤲/budding🌱/seed) — align tenant labels.
- Frontend template `shared/tenant-reputation.js` (242 LOC, IIFE, `window.TenantReputation`, `tierDisplay`, `_onLiffClaimsReady` + `_tenantAppBuilding/_tenantAppRoom` guard, getDoc own-read, `rep_consent_v1`→consents→prompt→`httpsCallable('recordChecklistConsent')({purpose:'reputation_v1'})`, mount `#tenant-reputation-card`); css `.rep-card*` `components.css:797-864` (static, §7-RR); wired `tenant_app.html:140` `<script defer>` + mount div `:~4186` after `#profile-rewards-card` in `#eco-panel-info`; tests `shared/__tests__/tenant-reputation.test.js` (16). **CSP: external `<script src>` + markup div → NO regen (§7-II/RR confirmed).**

### PR1 — server + rules
- [ ] `functions/_kindness.js` — add pure `kindnessTier(kindness, provisional)` (named bounds `KIND_TIER_BOUND_RADIANT=70/_WARM=40/_KIND=10`); export it + add bounds to `KINDNESS_CONSTANTS`. *Why: single source of truth for the enum, mirrors `reputationTier()`; pure → unit-testable.*
- [ ] `functions/computeTrustScoresScheduled.js` — import `kindnessTier`; fold into the existing tenant-doc mirror (D2). *Why: badge needs the enum on the doc it already reads; combined write = no extra op.*
- [ ] `firestore.rules` — add `'kindnessTier'` to the `tenants/{b}/list/{r}` update protected `hasAny([...])`. *Why: §6 tamper-proof — tenant must NOT fake their tier; CF writes via Admin SDK (bypasses rules).*
- [ ] `functions/recordChecklistConsent.js` — add `'kindness_v1'` to `VALID_PURPOSES`. *Why: badge consent gate calls this CF; unknown purposes throw.*
- [ ] `functions/exportMyData.js` — **NO CHANGE** (already exports trustScores+consents; DSR §30 complete).
- [ ] `functions/__tests__/_kindness.test.js` — `describe('kindnessTier')`: radiant/warm/kind boundary + provisional→seed + non-finite→seed.
- [ ] `functions/__tests__/computeTrustScoresScheduled.test.js` — update mirror assertion (`:248`) to `['reputationTier','kindnessTier']` + assert the mirrored `kindnessTier` for a scored vs provisional tenant.

### PR2 — frontend
- [ ] `shared/tenant-kindness.js` (clone `tenant-reputation.js`) — `window.TenantKindness`; pure `tierDisplay(enum)` (table above; unknown/absent→seed); self-wire `_onLiffClaimsReady` + `_tenantAppBuilding/_tenantAppRoom` guard (§7-U) + `_isPlayerMode` defer; own-read `getDoc tenants/{b}/list/{r}` field `kindnessTier` (§7-N catch); consent gate localStorage `kind_consent_v1` → `consents/{tenantId}_kindness_v1` → inline prompt → `httpsCallable('recordChecklistConsent')({purpose:'kindness_v1'})`; mount `#tenant-kindness-card`.
- [ ] `shared/components.css` — `.kind-card*` block cloned from `.rep-card*` (static external, §7-RR — no CSP impact).
- [ ] `tenant_app.html` — `<script src="./shared/tenant-kindness.js" defer></script>` after the reputation script; `<div id="tenant-kindness-card"></div>` after `#tenant-reputation-card`. *Markup + external script → NO CSP hash regen.*
- [ ] `privacy.html` — parallel kindness disclosure in §1/§2/§5 (pure HTML; privacy.html NOT in the 8 CSP-tracked files → no regen).
- [ ] `shared/__tests__/tenant-kindness.test.js` — mirror the 16 `tierDisplay` tests (3 positive tiers · seed collapse · privacy invariant no-digit/no-"ต่ำ" · display contract).

### Verify / test / deploy
- [ ] `npm run test:shared` (tenant-kindness) · functions tests (`_kindness`, sweep) · `npm run test:rules` (kindnessTier protected) — all green · mojibake (§7-TT) · CSP no-drift (§7-II §G).
- [ ] `npm run verify:memory` after updating [[lifecycle_trust_reputation]].
- [ ] **Deploy (owner-gated):** PR1 merge → CI deploys `computeTrustScoresScheduled` + `recordChecklistConsent`; owner runs `firebase deploy --only firestore:rules`. PR2 merge → Vercel auto.
- [ ] **§7-J live verify:** after sweep / admin ⟳ recompute → `tenants/{b}/list/{r}.kindnessTier` mirrored; real tenant READs but can't WRITE it; on real LINE → กดยินยอม → badge renders (N101 kindness 13 → 🤲 "มีน้ำใจ").
- [ ] Update [[lifecycle_trust_reputation]] kindness tenant-badge section + flip roadmap #6 sub-phase → ✅.

### Anti-patterns honoured
§7-NN (callable not trigger) · §6 (trust ≠ points; tier-only; tamper-proof via protected field) · §7-T (single writer — combined mirror) · §7-U (claim guard before read) · §7-N (own-read permission-denied catch) · §7-A (`_onLiffClaimsReady`) · §7-RR (static CSS) · §7-II (no inline edit → no CSP regen) · §7-J (live-data verify, not empty-collection).

### Out of scope (named)
player/`people/` path (active-tenant only, mirror reputation) · combining the kindness+reputation consent into one prompt (kept separate per spec) · #7 Verified Helper / #8 Resident Rank (accrual-gated) · capture-CF canonical-tenantId cleanup (the sweep room-key join handles it, §7-J #330).

### Review (appended after execution)
_(pending approval — no code yet)_

---

## ▶▶▶ ACTIVE PLAN (2026-06-10) — Meaning Layer **#9: Pet health memory** · ✅ APPROVED — BUILDING PR1

> **Decisions LOCKED (owner 2026-06-10):** (1) **array-on-pet-doc** `healthLog[]` — "เลือกที่ยั่งยืนและต่อยอดได้": built sustainable now, but ALL health data access goes behind a thin module interface (`window.PetHealth.add/list/delete` — repository pattern per [[patterns]]) so a future array→subcollection migration touches only that module, not the UI/consumers. (2) **PDPA lean** — reuse `getDownloadURL` (parity w/ vaccine books) + rely on `account_v1` consent (no new CF/consent); add disclosure + pets→DSR-export. (3) admin read-only view IN. → only `exportMyData` deploys.

> Roadmap ([meaning-layer-roadmap.md](meaning-layer-roadmap.md)) item **#9 · 🔴 buildable now**. The #1–5 capture block is COMPLETE; #6/#7/#8 are accrual-gated (~weeks of #1–5 data) → **#9 is the next buildable in order**, opening the **Pet pillar** (blueprint "Emotional Network"). Each pet gets an ongoing **health timeline** (vet visits, weight, meds, vaccines over time) beyond today's single vaccine-book file.

### Verified state (2 Explore agents + rules read — §7-H/AA/K/O)
- **Greenfield confirmed (§7-O/AA/K):** grep `health|vet|weight history` across `shared/` + `functions/` → only **doc-level** vaccine fields (`isVaccinated/vaxDate/vaxExpiry/vaccineBookURL/Path/FileName`) on the pet doc. No timeline anywhere, no orphaned API to wire.
- **Pet doc** `tenants/{b}/list/{r}/pets/{petId}` ([tenant-pets.js:189](shared/tenant-pets.js#L189)); petId = `Date.now().toString()`. **Write rule** ([firestore.rules:467](firestore.rules#L467)) = `isAdmin() || (isSignedIn() && get(tenants/$(b)/list/$(r)).linkedAuthUid == auth.uid)` — durable SoT crosscheck (§7-P-safe).
- **Storage** `pets/{b}/{r}/{petId}/{file=**}` claim-match read/write, admin-only delete ([storage.rules:58](storage.rules#L58)) → health files land in the **same prefix** ⇒ **no storage.rules change**.
- **Admin queue** ([dashboard-tenant-lease.js:1199](shared/dashboard-tenant-lease.js#L1199)) `collectionGroup('pets')` + live-path filter `[2]==='list'` — already loads the full pet doc, so a read-only health view is nearly free.
- **PDPA surfaces all exist & extend cleanly:** consent `VALID_PURPOSES` ([recordChecklistConsent.js:29](functions/recordChecklistConsent.js#L29)) · DSR export ([exportMyData.js](functions/exportMyData.js) — **currently exports ZERO pet data = a pre-existing gap**) · erasure/archive (pets ∈ `ARCHIVED_SUBCOLLECTIONS` in [archiveTenantOnMoveOut.js](functions/archiveTenantOnMoveOut.js) + `_petStorage` cleanup in `deletePetMedia`/move-out).

### ⭐ DECISION 1 (your call) — data model: **`healthLog[]` array on the pet doc (REC)** vs subcollection
The roadmap text said "health **subcoll**", but verifying the PDPA lifecycle flips the calculus:

| | **A · `healthLog[]` array on pet doc (REC)** | B · `pets/{petId}/health/{entryId}` subcollection |
|---|---|---|
| Archive on move-out | **FREE** — `pets` already in `ARCHIVED_SUBCOLLECTIONS`, array rides along | needs explicit nested-archive (§7-DD risk: nested subcoll NOT auto-copied by `.get()`) |
| Erasure §32 / admin remove | **FREE** — gone with the pet doc | needs `recursiveDelete` in `deletePetMedia` + nested cascade in `requestDataDeletion` |
| Export §30 | **FREE** — rides in the pet doc | needs nested collectionGroup/loop |
| Firestore rule | **none** (covered by existing pets write rule) | new `match /health/{id}` + collectionGroup wildcard |
| Capacity | entry ≈ 200 B; files → Storage (URL only). 1 MB ⇒ ~5000 entries; a 2-yr lease ≈ <100 | unbounded |
| Per-entry query | whole-array read (fine at this scale) | independently queryable |

**REC = A.** KISS/YAGNI + minimal blast radius: archive/erasure/retention/Storage-cleanup all ride on the **proven** pet lifecycle instead of adding new nested-data handling the §7-DD/L anti-patterns warn is bug-prone. Capacity is a non-issue (files in Storage; doc holds metadata only). **Diverges from the roadmap's literal "subcoll" wording → flagging for your OK.**

### ⭐ DECISION 2 — file links: reuse existing `getDownloadURL` (REC) vs new signed-URL CF
Pet photo + vaccine-book files already use `getDownloadURL()` (permanent tokenized URL in the doc). The PDPA checklist uses a 1h signed-URL CF (`getChecklistMediaUrl`). Pet health is personal data **but not PDPA §26-sensitive** (§26 = a *person's* medical data, not an animal's).
- **REC: reuse the existing pet `getDownloadURL` pattern** — parity with vaccine books, smallest blast radius. Note a follow-up to migrate **both** vaccine-book + health files to a `getPetMediaUrl` signed-URL CF *together* (coherent, avoids a piecemeal breadth sweep — [[feedback_score_instability_breadth_trap]]).
- Alt: build `getPetMediaUrl` now (clone `getChecklistMediaUrl` 6-path gate) — stricter but inconsistent with vaccine books + bigger scope.

### ⭐ DECISION 3 — consent: rely on existing `account_v1` (REC) vs new `pet_health_v1`
The existing pet-registration feature has **no per-feature consent** (covered by whole-app `account_v1` + privacy disclosure). A dedicated `pet_health_v1` only for health — while basic pet data has none — is inconsistent.
- **REC: no new consent gate** — pet health rides on `account_v1` + contract performance; add a pet-health line to the privacy notice (PDPA disclosure §1/§2/§5) + add pets to the DSR export. Sufficient (pet health ≠ §26-sensitive).
- Alt: add a `pet_health_v1` consent gate (strict template) — heavier UX, inconsistent with pet reg.

*(Pick the strict side on all three — B + signed-URL CF + new consent — and I re-scope to the bigger PR.)*

### Data model — `healthLog[]` entry (Option A)
`tenants/{b}/list/{r}/pets/{petId}.healthLog: [ entry, … ]`, entry =
`{ id:<ts>, type:'vet'|'vaccine'|'weight'|'med'|'note', date:'YYYY-MM-DD', title, note?, weightKg?:number|null, fileURL?:null, filePath?:null, fileName?:null, createdAt:ISO }`
- **Add:** `updateDoc(petRef, { healthLog: arrayUnion(entry) })` — surgical; **never rewrites `status`** so admin approval is untouched. **Delete entry:** read-modify-write tx. **Edit:** delete + re-add in v1 (no in-place edit).
- **File** (optional vet doc / lab result): `_uploadPetFile(file, b, r, petId, 'health')` → `pets/{b}/{r}/{petId}/health_{ts}.{ext}` (existing helper + prefix + rules — no change).

### Build — PR1 (tenant UI + minimal admin read-view + PDPA export/disclosure)
- [ ] `shared/tenant-pet-health.js` (NEW, IIFE) — pure helpers (`buildHealthEntry`, `sortHealthLog`, `healthTypeMeta`, validators) + timeline render + add-entry form + delete; `updateDoc(arrayUnion)` add, optimistic (§7-I tenant-initiated); §7-A/U claim guard via `_taBuilding/_taRoom` (not phantom `_liffClaims`, §7-BB); §7-N read-fail muted; §7-X innerHTML fallbacks; DOM API for user text ([[feedback_modal_security]]); `window.*` exports (§7-QQ/CC).
- [ ] `tenant_app.html` — new `#pet-health-page` sub-page (timeline + add form: type/date/title/note/weight/file) reachable per-pet from `#pet-park-page`; `<script src tenant-pet-health.js>` external (no CSP drift §7-II; order after tenant-pets.js §7-PP).
- [ ] `shared/tenant-pets.js` — add "📋 ประวัติสุขภาพ" button to each pet card → opens `#pet-health-page` for that petId (small render edit).
- [ ] `shared/components.css` — static `.pet-health-*` timeline styles (§7-RR, NOT JS-injected).
- [ ] `shared/dashboard-tenant-lease.js` — admin read-only "📋 ประวัติสุขภาพ" on the pet card → modal listing `p.healthLog` (data already loaded; no new query, no admin write).
- [ ] `functions/exportMyData.js` — add a `pets` section (each pet doc incl. `healthLog`), scoped by building+room — **closes the pre-existing no-pet-export gap**. +tests (present / empty).
- [ ] `tenant_app.html` privacy section + `privacy.html` — one pet-health line in the collected-data disclosure (PDPA §1/§2/§5). Text-only (no CSP regen).
- [ ] Tests: `shared/__tests__/tenant-pet-health.test.js` (build/sort/type-meta/validation) + extend `functions/__tests__/exportMyData.test.js` (pets+healthLog).
- [ ] Gate: `node --check` · test:shared green · functions tests green · static-harness preview-MCP screenshot (timeline empty/populated, add form, dark+light) · mojibake (§7-TT) · CSP no-drift (§7-II §G) · `verify:memory`.
- [ ] **OWNER:** merge → CI auto-deploys `exportMyData` (the ONLY CF; Option A needs no rules/storage deploy). Then owner real-LINE live-verify (LIFF-gated): add a vet/weight entry → reopen persists → admin sees the timeline.

### Guardrails (§7 + §6 + PDPA)
§7-A/U/BB tenant claim-gated self-wire · §7-I tenant-initiated, no auto-click, surgical `arrayUnion` (never rewrites admin `status`) · §7-N read-fail→muted · §7-X innerHTML fallback · §7-RR static CSS · §7-II external script only (no inline edit → no CSP regen) · §7-PP script order · §7-QQ/CC window export · §7-T single writer (tenant owns the pet doc; admin read-only) · **§7-DD/L AVOIDED by design** (array rides on existing pet lifecycle — zero new nested-data handling) · [[feedback_modal_security]] DOM API for user text · PDPA disclosure + DSR export (erasure/retention free via pet lifecycle).

### Out of scope (named, not dropped)
weight sparkline/chart (v2) · in-place entry edit (v1 = add + delete) · signed-URL CF migration for pet files (vaccine-book + health together — follow-up) · `pet_health_v1` dedicated consent · admin write/annotate on health (admin read-only v1) · **#10 Pet Social Graph** (next pet ตัว) · pet-doc `status` self-approve hole (PRE-EXISTING: the pets write rule lets a linked tenant write `status:'approved'` via devtools — low-severity, flag separately, NOT introduced by #9).

### Risk
Frontend-heavy; Option A touches **no rules/storage**, only the additive `exportMyData` CF. Health writes go to the tenant's own pet doc via the existing claim-gated rule — no new trust surface, no points/money path (§7-I). Live-verify on real LINE is owner-gated (LIFF auth); static-harness screenshot proves the visual states pre-merge.

### Why
Roadmap #9 — the next buildable Meaning-Layer ตัว (capture #1–5 done; trust scores #6–8 accrual-gated). Opens the Pet pillar; builds the health-timeline primitive future pet features (e.g. #14 emergency-caretaker context) lean on. Array-on-doc keeps the PDPA lifecycle free and the blast radius minimal.

### Review (2026-06-10) — BUILT (PR1), ⏳ owner merge + live-verify
**Shipped (10 files, 1 branch `feat/pet-health-memory`):**
- `shared/tenant-pet-health.js` (NEW) — pure helpers + repository-boundary data ops (`_readPet`/`_writeLog`/`addEntry`/`removeEntry` — the ONLY Firestore touch, so a future array→subcoll migration is contained) + DOM-API timeline render + add/delete. `healthLog[]` written via surgical read-modify-write `updateDoc({healthLog})` (NEVER rewrites admin `status`; `arrayUnion` is server-only in this repo, not on the client wrapper → RMW is both safe + dependency-free).
- `shared/__tests__/tenant-pet-health.test.js` (NEW) — 23 pure-helper tests (validate/build/sort/typeMeta).
- `tenant_app.html` — `#pet-health-page` sub-page (form in native `<details>`, timeline) + `<script src>` (external, §7-II no CSP drift) + privacy disclosure line. **CSP no-drift confirmed** (no inline `<script>`/`<style>` block touched).
- `shared/tenant-pets.js` — "📋 ประวัติสุขภาพ" button per pet card (`data-action="openPetHealth"`, mirrors `viewVaccineBook`) + exposes `_taUploadPetFile` (DRY Storage reuse).
- `shared/components.css` — static `.ph-*` timeline styles (§7-RR; theme-aware via `--card`/`--text`/`--border` vars).
- `shared/dashboard-tenant-lease.js` — admin **read-only** health `<details>` in the pet card (data already on the collectionGroup doc; `_escapeHTML`/`_escapeAttr` on all tenant free-text; no admin write, no new query).
- `functions/exportMyData.js` (+test) — DSR §30 now exports `pets` (incl. `healthLog`) — **closes the pre-existing gap that ZERO pet data was exported**. +2 tests.
- `privacy.html` + tenant_app privacy section — PDPA disclosure line for the health timeline.

**Gate (all green):** `test:shared` **507/0** (+23) · `exportMyData` **10/0** (+2 pets) · `node --check` 4 files OK · **mojibake CLEAN** (§7-TT) · **CSP no-drift** (§7-II) · **verify:memory 0 fails**. Visual: static-harness preview-MCP screenshot — timeline renders light + dark (theme-aware, dots/title/note/weight-chip/date/delete; sort newest-first), 0 console errors (the earlier full-width-dot screenshot was a browser CSS-cache artifact, not a bug — confirmed `phRules:13`, `dot 38px`, `display:flex` after cache-bust).

**Decisions honoured:** array-on-doc (sustainable) + repository interface (extensible — "ต่อยอดได้") · PDPA lean (getDownloadURL + `account_v1`, no new CF/consent) · admin read-only.

**⏳ Owner-gated next:**
1. **Merge** (= CI auto-deploys `exportMyData` — the only CF; additive, try/catch-guarded, low-risk). Frontend (Vercel) ships on merge too.
2. **Live LIFF verify** (auth-gated, can't drive from dev env): open a pet → 📋 ประวัติสุขภาพ → add a vet/weight entry (+ optional file) → reopen persists → admin pet queue shows the read-only timeline → DSR `exportMyData` JSON includes `pets[].healthLog`.

**Out of scope (named):** weight chart (v2) · in-place edit (v1 = add+delete) · signed-URL CF for pet files (vaccine-book + health together, follow-up) · #10 Pet Social Graph (next pet ตัว) · pre-existing pet-doc `status` self-approve hole (flag separately).

---

## ✅ SHIPPED (2026-06-09) — Meaning Layer **#2: Helper-request lifecycle** · PR #303 server + #304 UI

> Roadmap ([meaning-layer-roadmap.md](meaning-layer-roadmap.md)) item **#2 · 🔴 buildable now** — next in order after #1 Community Quests (✅ shipped #296–#302). Neighbor posts a help request → another tenant accepts → requester confirms-done + rates → **helper earns peer-confirmed kindness points**. Captures the job-history + ratings that **#7 Verified Helper** aggregates and feeds the **#6 Kindness score** (helper side). Mirrors the #1 quests architecture exactly: pure engine + per-transition callables + CF-only-write records + `pointsLedger` capture.

### Why Plan-First (CLAUDE.md §1 — all three thresholds)
New `helpRequests/` collection + **4 transition callables** + `firestore.rules` (building-scoped read / CF-only write) + `pointsLedger 'help_completed'` source + LINE-notify wiring + tenant board UI + (light) admin monitor + tests + lifecycle doc ≈ **12–14 files**; schema+security+architectural; CF+rules deploy = not single-revert; 2+ valid models (completion authority · LINE in/out). Touches the live gamification balance (helper award) → **money-of-points path (§7-I)**.

### State machine — `open → accepted → done` (+ `cancelled`); ONE callable per transition (§7-NN)
| Callable | Transition | Driver (auth gate) | Key writes |
|---|---|---|---|
| `postHelpRequest` | — → `open` | any tenant (`requesterUid = auth.uid`, anti-spoof) | create doc; rate-limit 5/day (`_rateLimit.js`) |
| `acceptHelpRequest` | `open → accepted` | a **different** tenant (`helperUid = auth.uid`, ≠ requester) | tx-guard `status===open` (atomic single-winner); notify requester |
| `completeHelpRequest` | `accepted → done` + rating | **requester only** (`auth.uid === requesterUid`) | rating 1–5; **award helper** points + `pointsLedger`; notify helper |
| `cancelHelpRequest` | `open\|accepted → cancelled` | requester only | terminal; no award |

**Completion authority = requester (peer-confirmed).** The helper never self-marks done → kindness credit is honest (§6 "never self-claim"; mirrors quests `admin`-verify). **[FORK 1]**

### Data model — `helpRequests/{auto-id}` (top-level Firestore)
`{ requesterUid, requesterTenantId, requesterName, building, room, title, detail?, category?, status:'open'|'accepted'|'done'|'cancelled', helperUid?, helperTenantId?, helperName?, rating?(1–5), ratingNote?, createdAt, acceptedAt?, completedAt?, cancelledAt? }`
- Names denormalized for display (**PDPA**: visible within building only — read gate below).
- §7-T: single writer (CF/admin SDK); readers = tenant board + admin monitor + future #7 aggregator.

### Rules (`firestore.rules`) — building-scoped read, CF-only write
```
match /helpRequests/{id} {
  allow read:  if isAdmin() || (isSignedIn() && request.auth.token.building == resource.data.building);
  allow write: if false;   // every transition via callable (admin SDK)
}
```
- Tenant token carries `building` claim (confirmed live: quests #299 `token.building` self-read). Building-scoped → a Nest tenant never sees rooms' requests; admin sees all.
- **No composite index (§7-J/N):** tenant board = ONE `onSnapshot(where building == myBuilding)` (single-field, auto-indexed) → client buckets by status + (mine / helper / others). Same "no new index" win as #1.

### pointsLedger capture (feeds #6 Kindness)
- Add `'help_completed'` to `VALID_SOURCES` ([_pointsLedger.js:41](functions/_pointsLedger.js#L41)) — the roadmap's named kindness source (`source ∈ {quest, food_share, giveaway, help_completed}`).
- `completeHelpRequest` tx: bump helper's `tenants/{hb}/list/{hr}.gamification.points` + `appendPointsLedger({ tenantId: helperTenantId, source:'help_completed', discriminator: requestId, refId: requestId, points: HELPER_REWARD, balanceAfter, by: requesterUid })` — atomic, idempotent by `requestId` (one award per request). **[FORK 3: reward 10/20/30, REC 20]**
- `SOURCE_LABEL.help_completed = 'น้ำใจ'` ([dashboard-behavioral-engagement.js:29](shared/dashboard-behavioral-engagement.js#L29)) — graceful fallback, §7-T.

### Verified reuse (Explore, file:line — §7-H/K/O/AA)
- **§7-O/AA greenfield confirmed:** `grep helpRequest|helperUid` → only roadmap + trust-plan docs, **no code**. Nothing orphaned to wire.
- **Pure engine:** clone `_questEngine.js` (179 LOC) → `_helpRequestEngine.js` (transition guards `canAccept/canComplete/canCancel`, `isValidStatus/Category/Rating`, `HELPER_REWARD_POINTS`).
- **Callable:** clone `claimQuest.js` (region SE1, `functions.https.onCall`, auth gate, `assertTenantAccess` from `_authSoT`, `runTransaction`, `appendPointsLedger`). §7-NN callable not trigger.
- **Atomic accept:** `runTransaction` re-reads `status===open` inside the tx (single-winner; loser → `failed-precondition` "มีคนรับไปแล้ว"). Mirrors the booking atomic-lock.
- **LINE notify:** `pushAndRetry(...)` ([_notifyHelper.js:50](functions/_notifyHelper.js#L50)) + liffUsers lookup (`where building/room/status==approved`) + `_lineRetry` queue; idempotencyKey `help-{requestId}-{transition}-{userId}`. Mirrors `notifyMaintenanceTenant.js`; best-effort/non-blocking (re-uses the EXISTING LINE secret — no new defineSecret, §7-WW-safe). **[FORK 2]**
- **Tenant board UI:** clone `tenant-maintenance.js` IIFE (board precedent) + `tenant-quests.js` optimistic-callable; self-wire `_onLiffClaimsReady` + `_taBuilding/_taRoom` (§7-A/U/BB); new sub-page via `showSubPage`.
- **Admin monitor:** clone `dashboard-requests-admin.js` read-only onSnapshot list + cancel-abusive. **[FORK 4: REC light-included]**

### Build — PR1 (server + rules + tests; owner-deploy-gated, NOT stacked)
- [ ] `functions/_pointsLedger.js` — add `'help_completed'` to `VALID_SOURCES` (+comment; test 7→8).
- [ ] `functions/_helpRequestEngine.js` (NEW, pure) — transition guards + validators + `HELPER_REWARD_POINTS`.
- [ ] `functions/postHelpRequest.js` (NEW callable SE1) — tenant gate (`assertTenantAccess`), `requesterUid=auth.uid`, rate-limit 5/day, title validate.
- [ ] `functions/acceptHelpRequest.js` (NEW callable SE1) — tx `status===open` guard, helper≠requester; notify requester [FORK2].
- [ ] `functions/completeHelpRequest.js` (NEW callable SE1) — requester-only, rating 1–5, award helper + ledger (tx); notify helper [FORK2].
- [ ] `functions/cancelHelpRequest.js` (NEW callable SE1) — requester-only → cancelled.
- [ ] `functions/index.js` — register 4 callables column-0 (§7-CCC/SS · §7-NN).
- [ ] `firestore.rules` — `helpRequests/{id}` block + rule tests (building-scoped read · write false).
- [ ] `functions/__tests__/_helpRequestEngine.test.js` (NEW) + callable integration tests (mirror quest tests).
- [ ] `shared/dashboard-behavioral-engagement.js` — `SOURCE_LABEL.help_completed`.
- [ ] Gate: `node --check` · functions tests green · rules emulator green · `verify:memory` · mojibake (§7-TT) · pre-commit.
- [ ] **OWNER:** merge → CI auto-deploys 4 callables + `firebase deploy --only firestore:rules`.

### Build — PR2 (tenant board + admin monitor; off main AFTER PR1 deploy)
- [ ] `shared/tenant-helpers.js` (NEW) — board: post form + open list (others' → accept) + "คำขอของฉัน" (status · complete+rate · cancel) + "งานที่รับ" (jobs accepted); optimistic callables (§7-I); `_onLiffClaimsReady` guard.
- [ ] `tenant_app.html` — `<script src tenant-helpers.js>` (§7-PP order) + new sub-page "ช่วยเหลือเพื่อนบ้าน" + nav entry.
- [ ] `shared/dashboard-helpers-admin.js` (NEW, light) — read-only monitor + cancel-abusive (§7-I explicit click).
- [ ] `dashboard.html` — monitor tab/panel + script + hub wires.
- [ ] `shared/components.css` — static `.help-card*` (§7-RR).
- [ ] Gate: test:shared green · static-harness preview-MCP screenshot (board states) · no CSP drift (§7-II) · mojibake.

### Guardrails (§7 + §6)
§6 kindness integrity (peer-confirmed award only, server-authoritative) · §7-NN callables not triggers · §7-I no auto-click on accept/complete · §7-A/U/BB tenant claim-gated · §7-T pointsLedger writer+reader · §7-J no composite index (single-field board query) · §7-N read-error muted · §7-RR static CSS · §7-II CSP no-drift · §7-PP/QQ/CC script order + window export · anti-spoof (requesterUid/helperUid = auth.uid server-side) · rate-limit post · PDPA building-scoped read · **CF+rules deploy OWNER-CONFIRMED** · don't stack ([[feedback_stacked_pr_squash_merge]]).

### Owner decisions (LOCKED 2026-06-08 — all REC)
1. **Completion authority = requester confirms-and-rates** (peer-confirmed; helper never self-marks done → honest kindness capture).
2. **LINE push IN v1** — accept→requester · complete→helper (reuse existing LINE secret + pushAndRetry, best-effort/non-blocking).
3. **Helper reward = 20 pts** per completed help (`HELPER_REWARD_POINTS`).
4. **Admin monitor IN v1** — light read-only + cancel-abusive (PR2).

### Out of scope (named, not dropped)
helper-release (accepted→open re-list) · auto-expire stale open requests · photo proof · two-way rating (helper rates requester) · #3 Community-requests board (next ตัว — reuses this lifecycle wholesale) · #6 Kindness score (sums `help_completed` after accrual) · #7 Verified Helper (aggregates these jobs + ratings).

### Review (2026-06-09) — SHIPPED + DEPLOYED end-to-end
- **PR1 #303 (`e132b04`)** server — merged + **deployed to prod** (4 callables `post`/`accept`/`complete`/`cancel` live SE1 nodejs22, verified `firebase functions:list`; rules deployed). Pure `_helpRequestEngine` + `pointsLedger source:'help_completed'`. Staging deploy gated the merge (de-risk §7-WW). **49 new tests** (engine + 4 callables + ledger); functions 2125/0, rules emulator 306/0, README synced 101→106 / 282→288.
- **PR2 #304 (`c06ab04`)** UI — merged → Vercel. Tenant `#helper-board` sub-page (`tenant-helpers.js`, 3 live sections, ONE `where building==` snapshot §7-J) + admin "น้ำใจ" monitor (`dashboard-helpers-admin.js`). test:shared 484/0; no CSP drift; mojibake clean.
- **§7-W catch (PR2):** static-harness preview screenshot exposed `var(--green-pale)` flipping near-black in dark mode (it's `--brand-primary-soft`, not pale) while cards stay `#fff` → count/ghost/badge chips dark-on-white. Fixed to hardcoded light values + re-screenshot confirmed.
- **§7-B catch (PR2):** pre-commit hook blocked a compat `firebase.auth().currentUser` fallback in `_uid()` → switched to `window._authUid` (canonical, §7-BB).
- **Owner decisions (locked, all REC):** requester confirms+rates (peer-confirmed) · LINE push IN (accept→requester, complete→helper, reuses existing secret §7-WW-safe) · helper reward 20 · admin monitor IN.
- **Open:** owner real-LINE live-verify (board is LIFF-auth-gated — post→accept→complete loop + admin cancel). Lifecycle: [[lifecycle_helper_requests]].

---

## ✅ SHIPPED (2026-06-08) — Meaning Layer **#1: Community Quests engine** (daily checklist · fuller engine) · #296–#302

> Roadmap ([meaning-layer-roadmap.md](meaning-layer-roadmap.md)) item **#1 · ⭐ START HERE**. #0 Reputation shipped (#288/#289). Owner directives (2026-06-08): verify model = **"quest ให้เค้ากดรับเมื่อมี checklist ให้ทำในแต่ละวัน"** (daily tap-to-claim checklist) · scope = **fuller engine now**.

### Recommended verification design — ONE unified tap-to-claim checklist; behaviour routes on per-quest `verifyMode`
Every quest in the tenant's daily checklist is **"กดรับ"**. What the server does on tap depends on the quest definition's `verifyMode`:

| `verifyMode` | On tap "รับ" | Tamper-proof | Use for | Points |
|---|---|---|---|---|
| `auto` | Server **re-derives the signal** (login-streak / daily check-in) → award only if satisfied, else "ยังทำไม่ครบ" | ✅ server re-checks | เช็คอินวันนี้ · เช็คอินครบ N วัน | any |
| `self` | Award immediately; **idempotent per-period + per-day total cap + low points** | ⚠️ honor, capped/low-stakes | daily habits: รดน้ำต้นไม้ · แยกขยะ | 1–5 |
| `admin` | Create a **pending claim** (no award) → owner approves in dashboard → award | ✅ human-verified | real kindness: ช่วยยกของ · Silent Helper | 10–50 |

**Why:** it *is* the daily checklist (everything = กดรับ), keeps the **#6 Kindness feed honest** (kindness quests are `admin`-verified, never self-claimed → respects roadmap "no pure self-claim"), and confines honor-system to low-stakes capped habits. The admin picks `verifyMode` per quest at creation.

### ✅ Owner review decisions (2026-06-08, post-PR1) — applied to PR1 + binding on PR2
- **Energy auto = CUT from v1.** `meter_data` is monthly meter readings (no hourly), so "ลดใช้ไฟช่วงบ่าย" is unmeasurable. Removed `energy_month_saver` from engine + `claimQuest` (no meter read). v1 auto signals = `checkin_today` + `login_streak` only. (Can return later as its own ตัว.)
- **self daily cap = 10 pts/day** (lowered from 20). Per-quest `selfDailyCap` still overrides.
- **UI scope (PR2): tenants only** (have a room) + cadence **daily + once** in the admin form. Backend keeps the player path + `weekly` (tested, dormant) — just not surfaced in v1 UI.

### Why Plan-First (CLAUDE.md §1 — all three thresholds)
New `quests/` + `questClaims/` collections + 2 callables + `firestore.rules` (read/write + tamper-protected field) + new composite index + pointsLedger enum + admin UI + tenant UI + tests + lifecycle doc ≈ **14 files**; schema+security+architectural; CF+rules deploy = **not single-revert**; 2+ valid verify architectures (settled above with owner).

### Verified reuse (Explore, file:line — §7-H/K/O/AA discovery)
- **§7-O/AA — placeholder already exists:** `URGENT_QUESTS` hard-coded ([gamification-rules.js:97](shared/gamification-rules.js#L97)) rendered as a **disabled "รับ X Pts · Coming soon"** card ([tenant-leaderboard.js:299](shared/tenant-leaderboard.js#L299)) into `#urgent-quests-list` ([tenant_app.html:3948](tenant_app.html#L3948)). Comment: *"post-launch admin can move to a Firestore `quests` collection."* → we **wire the stub to real infra**, not greenfield. No other quest/ภารกิจ/challenge code exists.
- **Points capture:** add `'quest'` to `VALID_SOURCES` ([_pointsLedger.js:41](functions/_pointsLedger.js#L41)); `appendPointsLedger(tx, fs, {...})` is atomic with the `gamification.points` balance update on `tenants/{b}/list/{r}` or `people/{tenantId}`. Ledger rules (admin-read / CF-write, firestore.rules:757) + composite index `tenantId ASC, at DESC` **already exist** → no ledger rule/index change. Add `quest:` label to `SOURCE_LABEL` ([dashboard-behavioral-engagement.js:29](shared/dashboard-behavioral-engagement.js#L29)) (graceful fallback if missing — no break, §7-T).
- **Award CF template:** clone `claimDailyLoginPoints` — auth gate (`assertTenantAccess` / player token) → `runTransaction` → idempotency marker → `appendPointsLedger` → `{success, pointsBefore, pointsAfter}`. Per-day cap via `_rateLimit.js` `checkRateLimit(uid, action, max, win)`.
- **Admin catalog:** clone the **rewards CRUD** ([dashboard-config.js:1025](shared/dashboard-config.js#L1025)) — direct admin Firestore write, modal form + onSnapshot table; rule precedent `rewards/{id} allow read: if true; write: if isAdmin()` (firestore.rules:40). `data-action` hub at [dashboard-main.js:686](shared/dashboard-main.js#L686).
- **Tenant claim UI:** clone the `redeemReward` optimistic-callable pattern ([tenant-leaderboard.js:410](shared/tenant-leaderboard.js#L410)); self-wire via `_onLiffClaimsReady` + `_taBuilding/_taRoom` guard (§7-A/U/BB), cleanest template = [tenant-reputation.js](shared/tenant-reputation.js) (#289). CSS in `components.css` (§7-RR).

### Data model
- **`quests/{questId}`** (admin catalog) — `{ title, description, icon, category, rewardPoints, cadence:'daily'|'weekly'|'once', verifyMode:'auto'|'self'|'admin', autoSignal?:'energy_afternoon'|'login_streak', dailyCapPoints?, building:'all'|'nest'|'rooms', active, order, startDate?, endDate?, createdAt, updatedAt, createdBy{uid,email} }`. Read: signed-in; write: admin (rewards model).
- **`questClaims/{questId}__{tenantId}__{day}`** (deterministic id = per-day idempotency + immutable audit + admin review queue) — `{ questId, tenantId, building, roomId, status:'self'|'auto'|'pending'|'approved'|'rejected', day:'YYYY-MM-DD', points, claimedAt, reviewedAt?, reviewedBy?, note?, photoURL? }`. Read: admin + own (claim-gated by `tenantId` token, §7-A/U/P); write: false (CF only).
- **`tenants/{b}/list/{r}.gamification.questsToday`** (lightweight per-day state map `{questId:status}`) — written by the CF in the SAME tx; the tenant's **existing** eco-points `onSnapshot` ([tenant-leaderboard.js:170](shared/tenant-leaderboard.js#L170)) already delivers it → **no new tenant read/query/index**. Must be a **tamper-protected field** (§6, like `reputationTier`).
- **`pointsLedger`** append `source:'quest'`, `refId:questId`, discriminator `questId__day`.

### Build — PR1 (server + rules + index; owner-deploy-gated, NOT stacked) — ✅ BUILT, PR #296 (⏳ owner merge+deploy)
- [x] `functions/_pointsLedger.js` — `'quest'` added to `VALID_SOURCES` (+ schema/discriminator comment; test 6→7).
- [x] `functions/_questEngine.js` (NEW, **pure**) — `periodKeyFor` (daily/weekly/once), `resolveState` (inactive/locked/available/pending/claimed/rejected), `evaluateAutoSignal` (checkin_today/login_streak — energy cut per owner), `selfCapCheck` (default 10), validators.
- [x] `functions/claimQuest.js` (NEW callable, SE1) — tenant+player paths; `_authSoT` gate; per-period idempotency via `questClaims/{questId}__{tenantId}__{periodKey}`; route by `verifyMode` (`auto`→re-derive signal→award/deny · `self`→cap+award · `admin`→`pending` no-award); tx + `appendPointsLedger` + `gamification.questsToday` mirror. (engine + claimQuest + reviewQuestClaim = **61 unit tests**.)
- [x] `functions/reviewQuestClaim.js` (NEW callable, SE1, **admin**) — approve→credit+ledger+`questsToday`; reject→re-claimable; `status==='pending'` no-double-credit fence. **13 tests**.
- [x] `functions/index.js` — both registered column-0 (§7-CCC/SS · §7-NN callables).
- [x] `firestore.rules` — `quests/{id}` (read public like rewards / write admin) + `questClaims/{id}` (read admin / **write false** — tenant reads `questsToday` not here). **Simplification: `questsToday` needed NO new protected-field — the tenants update rule already protects the whole `gamification` object (firestore.rules:382), so it's tamper-proof via the CF-only write.** +9 rule tests.
- [x] ~~`firestore.indexes.json`~~ — **No index needed.** Admin review queue uses single-field `where status=='pending'` (auto-indexed) + client sort (reputation-card precedent); `pointsLedger` index already exists. (§7-J-free.)
- [x] `shared/dashboard-behavioral-engagement.js` — `SOURCE_LABEL.quest = 'เควสต์'`.
- [x] Gate: `node --check` clean · **functions 2076/0** · **rules 298/0** (emulator) · `verify:memory` green (README 274→280, 98→101) · mojibake clean (§7-TT) · pre-commit hook green.
- [ ] **OWNER:** merge PR #296 (CI auto-deploys `claimQuest`+`reviewQuestClaim`) + `firebase deploy --only firestore:rules`. Then PR2 off fresh main.

### Build — PR2 (admin UI + tenant checklist) — ✅ BUILT (off main AFTER PR1 deploy)
- [x] `shared/dashboard-quests-admin.js` (NEW) — catalog CRUD (table `#questsAdminTable` + modal `#questEditModal`, conditional autoSignal/cap rows by verifyMode) → direct admin write; pending-claims review queue (`#questClaimsQueue`, `where status==pending` + client sort) → `reviewQuestClaim` (§7-I explicit click).
- [x] `dashboard.html` — new **เควส** tab + `#gamificationQuests` panel (table/queue/modal) + `<script src>` after dashboard-config.js (§7-PP) + hub wires (openQuestEdit/closeQuestEdit/saveQuest) in dashboard-main.js + `switchGamificationTab` loads on tab==='quests'. HTML+external-script only → **no CSP drift** (§7-II).
- [x] `shared/tenant-quests.js` (NEW) — tenants-only IIFE; `window.renderTenantQuests()` (called by `loadGamificationData`); catalog getDocs+cache; per-quest state from `window._taQuestsToday` (stashed by the eco onSnapshot, both branches); tap → `claimQuest` optimistic (§7-I); §7-A/U guard, §7-N muted.
- [x] `shared/tenant-leaderboard.js` — `_renderUrgentQuests()` call → delegates to `renderTenantQuests()` (placeholder kept as load-failure fallback); eco snapshot stashes `window._taQuestsToday`. `tenant_app.html` — `<script src tenant-quests.js>`.
- [x] `shared/components.css` — static `.quest-card*` + `.quest-empty` styles (§7-RR).
- [x] Gate: **test:shared 484/0** · `node --check` clean · **static-harness preview-MCP screenshot — 5 states render (available/claimed/pending/rejected/empty), on-brand muji** · mojibake clean (§7-TT) · no CSP drift (§7-II).
- [x] Docs: `memory/lifecycle_community_quests.md` (grep-backed) + MEMORY.md index + roadmap #1 → ✅ SHIPPED.

### Owner-only live-verify (cannot run from this env — §7-A/U/J)
Real LINE tenant → `#quest-page` → ranking tab → daily checklist renders → tap `self`/`auto` quest → points + ledger update (reopen persists); admin creates a quest + approves a `pending` `admin`-mode claim → tenant sees ✓.

### Defaults (owner-tunable — proposed, flag don't block)
- **Seed quests (no energy per owner):** 1 `auto` `checkin_today` (เช็คอินวันนี้, 2pt) · 2–3 `self` daily habits (รดน้ำต้นไม้/แยกขยะ/ทักทายเพื่อนบ้าน, 2–3pt) · 1–2 `admin` kindness (ช่วยยกของ/Silent Helper, 20–30pt). Owner edits freely post-ship.
- **Caps:** `self` per-day total **10pt** (owner decision). **Placement:** admin on Gamification 🏆 page [REC] (vs content-management tab). **Catalog write:** direct admin write [REC] (callable only for claim/review — they need server authority).

### Guardrails (§7 + §6)
§6 trust/points integrity (server-authoritative award; `questsToday` tamper-protected) · §7-NN callables not triggers · §7-I no auto-click on approve · §7-A/U/BB tenant claim-gated self-wire · §7-T grep `pointsLedger`/`questsToday` writer+reader before/after · §7-J index READY before query · §7-N read-error→muted state · §7-RR CSS static · §7-II/§G CSP no-drift · §7-PP/QQ/CC script order + window export · §7-E `YearUtils` if BE dates touch · **CF+rules deploy = OWNER-CONFIRMED before merge** (CI auto-deploys CFs; rules not single-revert) · PR2 frontend auto-merge ([[feedback_auto_merge_prs]]) · don't stack (PR1 deploy → PR2 off fresh main, [[feedback_stacked_pr_squash_merge]]).

### Risk (money-of-points path, §7-I)
Tenant tap writes ledger + balance. Anti-gaming: per-day `questClaims` idempotency doc + per-day cap + `admin`-verify for high-value + server re-verify for `auto` (no client-trusted award). Production write gated by valid claim; no auto-click. Touches the live gamification balance → needs approval before build.

### Out of scope (named, not dropped)
peer-verify (#2 Helper-lifecycle prerequisite) · #6 Kindness score (sums these quest events after ~weeks accrual) · weekly/seasonal rotation beyond the cadence field · photo-proof storage for `admin` claims (text note v1; photo a fast follow if owner wants).

### Review (2026-06-08) — SHIPPED end-to-end
- **PR1 #296 (`dcbec48`)** server + rules + 2 callables — merged + deployed (CFs live SE1, rules deployed). 61 quest tests, rules 298/0.
- **PR2 #297 (`c3eb13c`)** admin เควส tab (catalog + review queue) + tenant checklist — merged + Vercel. test:shared 484/0, 5-state harness.
- **Live-test fixes (real LINE, N101):**
  - **#298 (`03f27f5`)** tenant checklist made REAL-TIME — `onSnapshot('quests')` (new quest instant) + own `onSnapshot(tenant doc)` state + optimistic claim lock (replaced getDocs-once + eco-snapshot piggyback that left new quests invisible + claimed cards stale).
  - **#299 (`f494192`)** **§7-HH rule fix** — points/state didn't display because the tenant couldn't READ their own doc (`tenants/{b}/list/{r}` read gated on `linkedAuthUid`, EMPTY on the slim N101 doc). Added a **claim-based self-read path** (`token.room==roomId && token.building==building`, the assertTenantAccess model). REST-verified the award ALWAYS landed server-side (points 1→11, ledger row). Rules 300/0, deployed.
  - **#300 (`7610d46`)** cap-exceeded was MIS-LABELED "รับเควสนี้ไปแล้ว" (cap msg "รับเควสครบโควต้า" contains "รับเควส" → matched the already-claimed regex first). Now shows the server's real Thai message + admin warns when a `self` quest's points exceed its cap.
  - **#301 (`8db929b`)** self **uncapped by default** — the default-10 + shared per-day total blocked every self quest after one claim (and a `selfDailyCap=1`, reward-20 quest was permanently unclaimable). Now blank `selfDailyCap` = unlimited (once/day via idempotency); owner sets a ceiling only if wanted. CF redeployed.
  - **#302 (`aee332d`)** admin quest-form polish — required `*` markers + legend, icon `<select>` dropdown, per-field `.quest-hint` helper text (static CSS, §7-RR).
- **✅ Owner-verified on real LINE:** create→appears-instantly · claim→points rise · delete works (catalog emptied). Core loop confirmed. `admin`-approve flow = nice-to-have left to owner.
- **Deferred:** energy-auto · weekly cadence · player UI (roadmap #1 / Out-of-scope).

---

## ▶▶▶ ACTIVE PLAN (2026-06-08) — Tenant can pay the CURRENT (synth) month via SlipOK & have it marked paid · ⏳ AWAITING APPROVAL (Plan-First)

> Surfaced while fixing the SlipOK slip-verification bug chain (form-data → CI-deploy-regex → API key/branch → data:URL prefix — all SHIPPED & live-verified, admin+tenant ✅). Paying the **current month** still shows "รอชำระ" → separate billing-lifecycle gap below.

### ▶▶ PIVOT (2026-06-08) — user directive "ทำให้ยั่งยืน" → ROOT fix (Option C). ✅ SHIPPED + DEPLOYED (`c33d084`)

> **Review (2026-06-08):** Option C SHIPPED. `notifyTenantOnMeterUpload` → `writeBillOnIssue` (NEW `functions/_billWrite.js`) creates `bills/{b}/{r}/TGH-{BE}{MM}-{room}` `status:'pending'` at meter-approve (best-effort · idempotent · dedup by room+MONTH · §7-BBB boundary). `tools/backfill-synth-bills.js` (dry-run default, `--apply`/`--building`/`--room`/`--month`). 63 tests, suite 2009/0, deployed via CI. **June ห้อง13 fixed** (`--room 13 --month 6 --apply` → paid ฿2,020, live-verified). **Jan-Mar 2569 ห้อง13 HELD** (owner call — ฿5,328, Apr/May paid → likely settled outside app). **Open:** live-verify a real meter-approve creates the bill (§7-J admin step). Catches: §7-T (`'pending'` not `'unpaid'`), §7-D/E (legacy suffixed bill ids → dedup by month). Docs: [[billing_monthly_flow]] + handoff `next_session_handoff_2026_06_08_option_c_canonical_bill.md`. The Option-C checklist below is now historical.

Option B (materialize-on-payment) was SHIPPED + unit-tested, but live testing exposed it's FRAGILE: it depended on the tenant app sending a new field, and §7-MM stale SW cache kept the client from sending it / even from calling verifySlip (client-state confusion after repeated attempts). The user's question "why don't admin & tenant connect?" pinpointed the REAL gap: **there is no canonical bill record.** → Pivot to Option C; keep Option B deployed as a SAFETY NET.

**Root cause (confirmed BOTH sides via Explore):** on meter upload, `notifyTenantOnMeterUpload` writes `meter_data` + an `INV-` invoice number + a LINE message, but **NOT an RTDB bill** (generateBillsOnMeterUpdate frozen, SE3). So the "bill" exists in 3 fragmented forms that never converge:
- Admin dashboard reads RTDB `bills/` ONLY (no synth) → doesn't see the month. Paid status from `verifiedSlips` (PaymentStore), not bill status.
- Tenant app synthesizes from meter (`SYNTH-…`) → sees a pending bill. Paid status from bill `status`.
- Payment lives in `verifiedSlips` — a 3rd record, separate from the bill.

**Option C — create the canonical RTDB bill at meter-upload (the connection point):**
- [ ] **CF `notifyTenantOnMeterUpload`** (functions/): after the existing `computeBill` + `issueInvoiceNo`, WRITE `bills/{b}/{r}/{billId}` — deterministic `TGH-{BE4}{MM}-{room}`, `status:'unpaid'`, the computed `charges`/`meterReadings`/`totalCharge`, `invoiceNo`, `year` as "BE4" string (§7-E). **Idempotent:** create if absent; if exists+unpaid → update amounts (meter correction); if exists+PAID → never touch. Respect §7-BBB `moveInDate` boundary (don't bill before move-in).
- [ ] **Fix the `verifiedSlips` write bug** (makes admin SEE tenant payments + restores dedup): `saveVerifiedSlip` (verifySlip.js:262) + `logVerificationAttempt` (verifySlip.js:237) write `userId: params.userId` → **undefined for tenant calls** → Firestore rejects → verifiedSlips never written (confirmed: June slip doc 404) → admin payment view AND dedup both broken (4 duplicate payment pushes = double-pay risk). Fix: `params.userId || params.room || null` at every write site.
- [ ] **Backfill** existing synth-only months → RTDB (`tools/backfill-synth-bills.js`, preview + `--apply` per §7-I): for each room, months with meter_data but no RTDB bill → create it; `status='paid'` if a payments/verifiedSlips record exists, else `'unpaid'`. **Fixes June ห้อง 13** (4 payment records → paid).
- [ ] **Keep Option B** (materialize-on-payment) as a safety net for any residual synth-at-payment-time.
- [ ] Tenant/admin reads need NO change (both already read RTDB `bills/`; synth becomes a pure legacy fallback that dedups against the real bill). Optional: add synth fallback to the admin grid for pre-Option-C legacy months.
- [ ] Tests: notifyTenantOnMeterUpload writes bill (idempotent · no-overwrite-paid · boundary); userId fallback; backfill dry-run. Docs: billing_monthly_flow.md rewrite + §7 anti-pattern (3-fragmented-forms / frozen-CF gap).

**Why sustainable:** ONE canonical bill per room/month, created when the admin issues it, read + updated by BOTH sides + verifySlip. No synth divergence, no payment-time band-aid, dedup + admin-payment-view restored.

**Risk (money path, §7-I):** writes RTDB bills on every meter upload → idempotency + no-overwrite-paid + §7-BBB boundary mandatory; backfill preview-first. Touches the live meter→bill flow → needs approval before I build.

---
_(Below: the earlier Option B analysis + checklist — Option B is SHIPPED as the safety net.)_

### Problem (verified via code + RTDB read + 2 Explore agents)
- Current-month bill is **synthesized client-side** (`SYNTH-rooms-13-202606`) by `synthesizeFromMeter` ([shared/billing-system.js:1045](shared/billing-system.js:1045)); never a real RTDB doc under `bills/{b}/{r}`.
- `generateBillsOnMeterUpdate` (used to create RTDB bills on meter write) is **FROZEN + SE3-region-dead** (never fires) → nothing auto-creates RTDB bills. `notifyTenantOnMeterUpload` issues the invoice number but does **not** create the bill.
- `verifySlip`→`_verifySlipWrite.js:92-114` flips only **existing** RTDB bills to paid; synth month = no doc = nothing marked, no `payments/` push.
- `synthesizeFromMeter` sets current month `status:'pending'` ([billing-system.js:1080](shared/billing-system.js:1080)) and never checks a payment record → re-renders "รอชำระ" every load. Explicit client guard refuses synth payment at [tenant_app.html:6000](tenant_app.html:6000).
- Confirmed live: RTDB `bills/rooms/13` = only TGH-256904(เม.ย.,paid)+TGH-256905(พ.ค.,paid); no มิ.ย.

### Open product question (confirm before build)
**Should a tenant pay the current month directly the moment the meter is in (synth), with NO separate admin "ออกบิล" step?** User's testing implies **YES** (this plan assumes YES). If instead "admin must issue the official bill first", the fix is different — say so & I re-plan.

### Options
- **A read-side only** (synth checks payments/ → show paid): ❌ leaves `bills/` without the doc → ADMIN view still unpaid → tenant/admin disagree.
- **B materialize-on-payment in `verifySlip` — RECOMMENDED:** valid slip + no existing bill → **create the real RTDB bill `status:'paid'`** from the synth breakdown the client already holds. ✅ fixes tenant+admin (RTDB=SoT), contained to the actual payment (one bill, slip-amount-validated), reuses receipt/`payments/` writes.
- **C materialize-on-meter-upload** (`notifyTenantOnMeterUpload` creates the bill, restore frozen-CF via §7-NN callable): root-cause fix for ALL months but biggest blast radius (every room/upload, idempotency+§7-BBB-boundary+admin-semantics) → queue as **follow-up** after B.

### Recommended: Option B — checklist
- [ ] **Client** [tenant-slip-verify.js:97](shared/tenant-slip-verify.js:97): also send `billMonth`, `billYear`, `charges`, `totalAmount`, `synthetic:true` to `verifySlip` (slip `amount` stays the enforced check; breakdown is for receipt/record only).
- [ ] **CF** `functions/_verifySlipWrite.js`: when no existing unpaid bill matches the slip month AND request carries a synthetic **current-month** bill → create `bills/{b}/{r}/{billId}` with **deterministic** id `TGH-{BE-yymm}-{room}` (match April/May, NOT `SYNTH-`), `status:'paid'`,`paidAt`,`paidVia:'tenant_app_slipok'`,`paidRef`,`charges`,`meterReadings`,`totalAmount`; then existing `payments/` push + RCP receipt fire.
- [ ] **Idempotency/safety:** deterministic id → re-pay merges never dups; pre-check not already `paid`; never overwrite a paid bill; only `billYM === currentYM` (no back-dating).
- [ ] **Client guard** [tenant_app.html:6000](tenant_app.html:6000): let the synth current-month path proceed; RTDB subscription delivers canonical paid bill (synth dedup removes twin).
- [ ] **Tests** `functions/__tests__/verifySlip.test.js`: synth+valid slip → creates paid bill (deterministic id); existing paid → not overwritten/dup'd; past synth → NOT materialized.
- [ ] **Docs:** update `billing_monthly_flow.md`; new §7 anti-pattern (existing-bill-only writer can't mark synth paid).

### Risk / verify
- Production write gated by valid SlipOK verify + slip-amount match, tenant-initiated (no auto-click §7-I). Deterministic id + paid-check guard dup/overwrite.
- Verify live (Vercel): tenant pays current month → "ตรวจสอบสำเร็จ" → usage/payment shows paid; reload still paid; RTDB `bills/rooms/13/TGH-256906-13` exists `status:paid`; admin dashboard shows มิ.ย. paid.

### Why
Current-month bill is synth-only because RTDB-bill creation is frozen; `verifySlip` marks only existing bills. Option B makes the bill **real & paid at the slip-validated payment moment** → tenant+admin agree, smallest safe blast radius. C (meter-upload materialize) is the deeper follow-up.

---

## ▶▶▶ ACTIVE PLAN (2026-06-07) — Roadmap Phase 3.2a v1.x: **Tenant-visible Reputation** (tier badge + consent gate, quest-page) · ⏳ AWAITING APPROVAL (Plan-First)

**Scope:** expose the admin-only 3.2a Reputation (the server-computed `trustScores/{tenantId}`, shipped #286/#287) to the **active tenant** in `tenant_app.html` as a **positive-framed TIER BADGE** (no raw number, no factor breakdown), gated behind an **explicit PDPA consent**, on the **quest-page** (gamification profile). First tenant-facing Trust surface → activates the blueprint's Emotional-Lock-in moat (Core Metric 3). Builds on the existing sweep CF + write-locked doc — does NOT recompute anything client-side (§6 tamper-proof preserved).

**Owner decisions (locked 2026-06-07):**
- **Exposure = TIER LABEL ONLY** — 🌱/🌿/⭐/💎 positive ladder; never the 0–100 number or raw factors (avoids credit-score anxiety + "ทำไมคะแนนหนูต่ำ" support load; the only live tenant is `26 provisional`). → server mirrors a tier ENUM onto a tenant-readable field; client maps enum→display.
- **PDPA = explicit CONSENT GATE before the badge renders** (mirror the checklist `consents/` pattern) — heavier than disclosure-only, most defensive. Plus DSR export + privacy-policy disclosure.
- **Placement = quest-page** (`#profile-rewards-card` neighbour) — already gamification-themed.

**Why Plan-First (CLAUDE.md §1):** touches `firestore.rules` (tamper-proof protected-field) + 3–4 CFs (sweep mirror, exportMyData, consent recorder) + new tenant module + tenant_app.html + privacy.html + tests + 2 lifecycle docs ≈ 11 files; security/rules + PDPA change; not single-revert (rules + CF deploy). All three thresholds met. PDPA template: [lifecycle_pdpa_checklist.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_pdpa_checklist.md).

### Verified infra (grep-grounded 2026-06-07 — §7-H/T)
- **Claims carry `tenantId`** — `liffSignIn.js:193,207` mints `{room,building,tenantId}` (tenant) + `:128` `{role:'player',tenantId}` (player). So tenant-self rules on `request.auth.token.tenantId` work.
- **Mirror target is already tenant-readable** — `tenants/{building}/list/{roomId}` read allows `resource.data.linkedAuthUid == request.auth.uid` (`firestore.rules:367`); tenant doc is ALREADY loaded by `TenantFirebaseSync.loadLease()` (`tenant-firebase-sync.js:68`) — same path the deposit badge piggybacks (`tenant-render.js:248` reads `depositStatus`). → **no new subscription, no read-rule change.**
- **⚠️ TAMPER HOLE — must fix:** `tenants/{b}/list/{r}` UPDATE rule (`firestore.rules:375-379`) lets a self-owned tenant write any field NOT in `hasAny(['gamification','rentAmount','building','roomId','tenantId'])`. `reputationTier` is absent → a tenant could set their own tier via devtools, breaking §6. **Must add `'reputationTier'` to that protected block (+rules test).**
- **Consent infra exists** — `consents/{tenantId}_{purpose}` `read: own(authUid|tenantId claim); write: if false` (`firestore.rules:727-732`, CF-only); writer precedent `recordChecklistConsent` (`index.js:240`). New purpose `reputation_v1` is auto-covered by the existing rule (keyed by `{docId}`) → **no consent-rule change, just a CF**.
- **DSR export** `exportMyData.js:92-154` exports 9 sources; `trustScores` ABSENT → add it.
- **Admin tier thresholds** `dashboard-reputation.js:32-34` = `>=80 ดีเยี่ยม · >=60 ดี · >=40 พอใช้` (+below). Reuse these boundaries for the tenant enum (one mental model); kinder labels for the tenant face.
- **trustScores doc** = `{tenantId,building,roomId,reputation,provisional,factors{...},computedAt}` (server-write-only, `firestore.rules:778` admin-read) — sweep `runTrustScoreSweep()` in `computeTrustScoresScheduled.js` (05:40 daily) + `recomputeTrustScores` callable already batch-write it.

### Tier ladder (proposed default — owner-tunable, brand pass per design-q#2)
CF maps `reputation`+`provisional` → enum (thresholds reuse admin 80/60/40); client maps enum → display. **Bottom collapses into one gentle growth state — never show a "low" judgment.**

| enum | when | tenant face (label · emoji) |
|------|------|------------------------------|
| `provisional` | `provisional:true` (0 ratable bills) | กำลังสร้างคะแนน · 🌱 |
| `building` | score < 40 | กำลังสร้างคะแนน · 🌱 (same gentle state) |
| `fair` | 40–59 | กำลังไปได้ดี · 🌿 |
| `good` | 60–79 | ดี · ⭐ |
| `great` | 80–100 | ดีเยี่ยม · 💎 |

### Build — PR1 (server + rules, owner-deploy-gated) ✅ BUILT 2026-06-07 (gates green; ⏳ owner deploy)
- [x] **`functions/_reputation.js`** — pure `reputationTier(reputation, provisional)` → `'provisional'|'high'|'good'|'fair'|'low'`; bounds named `TIER_BOUND_HIGH/GOOD/FAIR` (80/60/40, reuse admin) + exported in `REPUTATION_CONSTANTS`. +7 unit tests.
- [x] **`functions/computeTrustScoresScheduled.js`** — sweep now `batch.set(tDoc.ref, { reputationTier }, {merge:true})` in the SAME batch as the trustScores write (2 ops/tenant, BATCH_LIMIT safe). +2 sweep tests (mirror tier-only no-leak; provisional). Active tenants only.
- [x] **`firestore.rules`** — `'reputationTier'` added to the `tenants/{b}/list/{r}` update protected `hasAny([...])`. +1 rules test (linked tenant DENIED to fake tier; admin test extended to set it). §6 tamper-proof.
- [x] **`functions/exportMyData.js`** — `trustScore` = `trustScores/{tenantId}` added to DSR payload. +2 tests (present / null).
- [x] **Consent recorder (D2 → REUSE)** — `recordChecklistConsent` already had `VALID_PURPOSES`; added `'reputation_v1'` (no new CF, no consents-rule change). +1 test. JSDoc updated.
- [x] Gate: `node --check` (4 files) · **functions 1967/0** · **rules 289/0** (emulator) · **verify:memory GREEN** (README rules-count 273→274). No CSP/HTML touched.

### Build — PR2 (frontend, auto-merge + Vercel; off fresh main AFTER PR1 deploy — NOT stacked)
- [x] **`shared/tenant-reputation.js`** (NEW, #289) — self-wired card; own getDoc roster read (tenantId+reputationTier, NOT piggyback — decoupled, no race); pure `tierDisplay(enum)` collapsing provisional/low/unknown→🌱; consent gate localStorage `rep_consent_v1` + own-read `consents/{tenantId}_reputation_v1` (non-existent→permission-denied caught as not-consented); on ยินยอม → optimistic reveal + fire-forget `recordChecklistConsent({purpose:'reputation_v1'})`; §7-N read-fail→muted. 16 tests.
- [x] **`tenant_app.html`** (#289) — `#tenant-reputation-card` mount under `#profile-rewards-card`; external `<script src>` next to tenant-consent.js (any defer-order safe — depends only on `_onLiffClaimsReady`/firebase/`_tenantApp*`). No inline edit → **CSP no-drift confirmed by pre-commit §G**.
- [x] **`shared/components.css`** (#289) — static `.rep-card*` + `.rep-consent__*` tier styles (§7-RR).
- [x] **`privacy.html`** (#289) — reputation disclosure in §1 (computed data) / §2 (purpose) / §5 (retention). Text-only, no CSP regen.
- [x] Gate: **test:shared 477/477** · node --check · **static-harness preview-MCP screenshot — 6 states (consent/seed/fair/good/great/muted) all render, 0 console errors** · mojibake clean (§7-TT) · CSP no-drift (§7-II §G) · verify:memory GREEN.
- [ ] **Live-verify on real LINE — OWNER STEP** (§7-A/U/J — admin preview can't prove claim-gated tenant reads): open as a real tenant → consent prompt → ยินยอม → tier renders; reopen → no re-prompt; confirm raw number/factors NOT in the readable doc/devtools. *(Cannot be done from this environment — no LINE/tenant device.)*

### Decisions to settle at build (named)
- **D1 — tier labels/thresholds:** ship the table above as default; flag to owner for a brand pass (muji tone). Thresholds reuse admin 80/60/40.
- **D2 — consent CF:** prefer generalizing `recordChecklistConsent(purpose)` (DRY) vs new `recordReputationConsent` — decide after reading the existing CF; either way `consents` rule unchanged.
- **D3 — mirror location:** `tenants/{b}/list/{r}.reputationTier` for active tenants (piggyback existing read) **[REC]**; player (people/) tier deferred with the rest of player-facing trust.

### Guardrails
§6 (trust ≠ points; server-computed; **tamper-proof** — hence the protected-field rule) · §7-NN (consent = callable, sweep = scheduled; no Firestore trigger) · §7-A/U (claim-gated; tier read piggybacks the claim-loaded tenant doc) · §7-T (single writer for `reputationTier`; grep writer+reader before/after) · §7-I (no auto-write; consent is an explicit tenant tap) · §7-RR (CSS in components.css) · §7-II (avoid inline edits; pre-commit verifies no hash drift) · §7-PP (script load order) · §7-N (read error → UI state) · §7-J (no new index — piggyback) · PDPA = consent ledger + DSR + privacy disclosure ([lifecycle_pdpa_checklist.md]) · CF+rules deploy = **OWNER-CONFIRMED before merge** (CI auto-deploys CFs; rules not single-revert); PR2 frontend auto-merge per [[feedback_auto_merge_prs]]. Don't stack (build PR1 → owner deploy → PR2 off fresh main).

### Out of scope (named, not dropped)
- Raw score / factor breakdown to tenant (tier-only by decision) · player-facing (people/) tier · Resident Rank 3.2c · Kindness/Verified-Helper 3.2b · v2 engagement dimension (pointsLedger ~Aug) · tenant-triggered recompute (server schedule + admin button own it).

### Review (2026-06-07)

**Shipped:** Phase 3.2a v1.x tenant-visible Reputation, both PRs.
- PR1 server [#288] — `reputationTier()` enum + sweep mirror onto `tenants/{b}/list/{r}.reputationTier` + protected-field rule (§6) + `reputation_v1` consent (reused CF) + DSR `trustScore`. Merged + deployed prod SE1.
- PR2 frontend [#289] — `shared/tenant-reputation.js` (self-wired §7-A/U, own getDoc, consent gate, pure `tierDisplay()`), `.rep-card*` in `components.css` (§7-RR), `#tenant-reputation-card` mount + `<script src>` in `tenant_app.html` (no CSP drift §7-II), `privacy.html` disclosure, 16 tests (suite 477/477). Merged (squash, auto-merge per [[feedback_auto_merge_prs]]) + Vercel-deployed. 6 card states harness-verified via preview MCP.

**Decisions settled:** D1 — shipped the default tier ladder (🌱 provisional+low / 🌿 fair / ⭐ good / 💎 high); owner brand-tone pass still open if desired. D2 — REUSED `recordChecklistConsent(purpose)` (DRY, no new CF). D3 — mirror on `tenants/{b}/list/{r}.reputationTier` (active tenants); player/`people/` tier deferred. Build note: chose an **own getDoc** for the roster read (not piggybacking `_taTenant`) — fully decoupled, no dependency on tenant-render timing/`_raw`.

**Deferred / follow-ups:**
- **Owner real-LINE live-verify** (the one open box above) — cannot run from this environment.
- Player-facing (`people/`) tier, v2 engagement dimension (pointsLedger ~Aug), 3.2b/c Kindness/Verified-Helper/Resident-Rank — all out-of-scope, named above, untouched.
- Mirror field is empty until the next 05:40 sweep or an admin ⟳; the only live tenant (provisional) renders the gentle 🌱 seed state — intentional, not a bug.

---

## ✅ SHIPPED + LIVE-VERIFIED (2026-06-07) — Roadmap Phase 3.2a: Reputation Score v1 · PR1 server #286 + PR2 card #287 merged + deployed (rules + CFs live) · prod live-verify DONE (Chrome MCP: N101→26 provisional, all layers proven)

**Scope:** Trust System sub-phase 3.2a v1 — a **server-computed, admin-only** Reputation score (0–100) per tenant from 3 back-historical signals: payment punctuality + lease tenure + complaint-free record. Design doc: [phase-3.2-trust-system-plan.md](phase-3.2-trust-system-plan.md). First Trust primitive — the blueprint's retention moat (Core Metric 3, emotional lock-in) + gate for future FinTech/Verified-Helper revenue. NOT blocked by pointsLedger accrual (that's only the v2 engagement dimension); the 3 v1 signals all have back-history today.

**Owner decisions (locked 2026-06-06):**
- **Visibility = ADMIN-ONLY v1** — validate the formula before exposing. No tenant badge / claim-gate / tenant-facing PDPA yet (those land when tenant-visible v1.x ships).
- **Weighting = payment 60% · tenure 25% · complaint-free 15%** — payment dominates (blueprint / accountant / investor lens).

**Why Plan-First (CLAUDE.md §1):** new Firestore collection (`trustScores/`) + new security rule + new scheduled CF + admin callable + dashboard card + tests + lifecycle doc ≈ 10 files; schema+rules change; multi-session; not single-revert. All three thresholds met.

### Verified data sources (grep, 2026-06-06 — §7-H/T)
- **Payment punctuality:** RTDB bills carry `paidAt` (epoch ms — `verifySlip.js:349`, `_verifySlipWrite.js:106`) + `dueDate` (persisted ISO, immutable — `dashboard-aging.js:16`) + `status` ∈ {paid,refunded,void,…} (`dashboard-aging.js:75`). On-time = `paidAt <= dueDate`. ⚠️ bills paid without a slip (cash / mark-paid / paid-from-deposit) may lack `paidAt` → excluded from the ratio (honest metric, count logged).
- **Tenure:** `leases/{b}/list/{leaseId}.moveInDate` (ISO; fallback `startDate`) — `lease-config.js:82,238`. tenureMonths = now − moveInDate.
- **Complaint-free:** complaints carry `createdAt` (`complaintAndGamification.js:99`). complaintFreeMonths = now − most-recent complaint (else tenure start).
- **Roster + key:** `people/` SSoT + `tenants/{b}/list/{r}`; trust doc id = `tenantId`.
- **NOT in v1:** `pointsLedger` engagement-consistency = data-gated v2 (~2026-08+). `points` balance NEVER feeds trust (§6: trust ≠ spendable points).

### Architecture — scheduled CF writes, admin reads (mirrors redeemReward server-authority + actionAudit immutability)
**Why a CF, not client-on-read (unlike 3.1):** trust MUST be tamper-proof/server-computed (§6 — the moat collapses if the client can influence it) and derives from RTDB bills + FS leases + RTDB complaints across ALL tenants (too heavy + sensitive for in-browser). Firestore triggers can't watch SE3 (§7-NN) → **daily scheduled CF** + an **admin on-demand callable**, both sharing one pure helper.
- `trustScores/{tenantId}` — server-write-only: `{ reputation:0–100, factors:{ paymentScore, tenureScore, complaintScore, onTimeRatio, onTimeBills, lateBills, tenureMonths, complaintFreeMonths }, provisional:bool, computedAt }`. Rule `read: if isAdmin(); write: if false;`. v1 writes ONLY reputation+factors — no kindness/rank/verifiedHelper fields yet (3.2b/c add them; avoids §7-T drift).
- **Formula** (each factor → 0–100, then weighted; all thresholds are named constants tunable at review):
  - paymentScore = onTimeBills / (onTimeBills + lateBills) × 100; late = (paid & paidAt>dueDate) OR (unpaid & now>dueDate); exclude refunded/void/no-timestamp. 0 ratable bills → paymentScore=null + `provisional:true` + reweight survivors.
  - tenureScore = min(tenureMonths / 24, 1) × 100.
  - complaintScore = min(complaintFreeMonths / 12, 1) × 100.
  - reputation = round(0.60·payment + 0.25·tenure + 0.15·complaint); provisional → renormalize weights over present factors.

### Build steps (checkable; PR1 = server, PR2 = admin card — sequential, card needs the data to exist)

**Phase 1 — compute core (pure, TDD first)** ✅
- [x] `functions/_reputation.js` — pure `computeReputation({bills, moveInDate, complaints, now})` → `{reputation, factors, provisional}`. No I/O. Defensive `_ms` coerces epoch/ISO/Date/Firestore-Timestamp.
- [x] `functions/__tests__/_reputation.test.js` (repo convention = tests in `__tests__/`, not colocated) — 24 table-driven cases (all-on-time→100 · all-late→0 · 2/3→66.7 · 0-bills→provisional+reweight · tenure 0/12/24/30 · complaint recent/none · 60/25/15 math · no-paidAt/refunded/void excluded · ISO/Date/Timestamp inputs). **24/24 GREEN.**

**Phase 2 — server wiring (CF) [PR1]** ✅
- [x] `functions/computeTrustScoresScheduled.js` — daily scheduled CF (SE1, **05:40 BKK `40 5 * * *`** — confirmed free, between cleanupPlayers 05:00 & lease 08:00). Shared `runTrustScoreSweep()`: per building reads bills(RTDB)/active-leases(FS `moveInDate`)/roster(FS, occupancy gate) + one bounded `complaints` read → `_reputation` → chunked batch-write `trustScores/*`. Idempotent. **Plan correction:** complaints are **Firestore** `complaints` (top-level, `createdAt` ISO, `building`+`room`), NOT RTDB.
- [x] `functions/recomputeTrustScores.js` — admin `onCall` (SE1, §7-NN not a trigger): delegates to shared `runTrustScoreSweep` ("refresh now"). Gate `context.auth.token.admin === true`.
- [x] Registered both in `functions/index.js` (TRUST SYSTEM section). CF tests: sweep (6 cases — occupancy gate, provisional, multi-building, doc shape) + callable (4 cases — auth gates + delegation). **10/10 GREEN.**

**Phase 3 — rules + index [PR1]** ✅
- [x] `firestore.rules` — `match /trustScores/{tenantId} { allow read: if isAdmin(); allow write: if false; }` (mirrors `pointsLedger`/`actionAudit`). 7 cases in `firestore.rules.test.js`. **Rules suite 288/288 GREEN (emulator).**
- [x] `firestore.indexes.json` — **no change needed**: v1 iterates by known keys; card reads full `trustScores` (admin query) + sorts client-side. No composite `where+orderBy`. (Revisit if the card adds one.)

**Phase 4 — admin dashboard card (read-only) [PR2]** ✅ #287
- [x] `shared/dashboard-reputation.js` — "🏅 คะแนนความน่าเชื่อถือ" card in the **ผู้เช่า tab** (left `ten-col`): tenants ranked by reputation, tier-coloured score chip + factor breakdown + `ชั่วคราว` provisional badge + KPI strip + empty state. Reads `trustScores/*`; `_ins.utils` pattern; `errorHTML` on failure (§7-N). Pure `repTier`/`computeRepStats` + 7 unit tests.
- [x] `dashboard.html` — `#dashReputation` mount + `<script>` after `dashboard-insights.js` (§7-PP). **No new CSS** (reuses `.card` + inline-style like every sibling card → §7-RR satisfied, no injected `<style>`); **no inline edit → no CSP drift** (§7-II, pre-commit confirmed in-sync). Plus a `⟳ คำนวณใหม่` button → deployed `recomputeTrustScores` callable (§7-I explicit click).

**Phase 5 — deploy + verify + docs (spans both PRs)** ✅ (live-verify owner-pending)
- [x] Server PR deployed — rules deployed by owner (`firebase deploy --only firestore:rules`), CFs auto-deployed via CI (run 27086277817 ✅; `firebase functions:list` shows both, SE1 node22). PR1 #286 + PR2 #287 merged to main.
- [x] §7-J live-data verify — `tools/preview-trust-scores.js` (READ-ONLY, ADC) ran on prod: 1 active tenant (nest/N101) → reputation **26** provisional, factors resolve (tenure 4.5mo, no moveInDate flags). Formula correct on real data. (The WRITE happens via owner's `⟳ คำนวณใหม่` button or the 05:40 schedule — not auto-written, §7-I.)
- [x] Card verified via static harness (full + empty states screenshot) + **✅ prod live-verify (Chrome MCP, 2026-06-07):** owner logged in as admin → Insights → ผู้เช่า → card renders (empty state, admin-read OK) → owner clicked ⟳ → `recomputeTrustScores` wrote `trustScores/*` → card populated N101 Nest → **26** provisional (💳—/📅18.8/🙂37.6 — exact formula match). All layers proven end-to-end.
- [x] `lifecycle_trust_reputation.md` + `lifecycle_scheduled_jobs` (13 jobs + 05:40) + `feature_state_canonical` (24 registry CFs) + MEMORY.md + README counts. `npm run verify:memory` green.

### Guardrails (§6 + project)
Trust ≠ points (never read `points`) · server-computed only · callable not trigger (§7-NN) · admin auth gate on callable · grep writer+reader for `trustScores`/`paidAt`/`moveInDate`/complaint before use (§7-T) · index READY before query (§7-J) · CSS in components.css (§7-RR) · CSP regen on inline edit (§7-II) · **CF + rules deploy = OWNER-CONFIRMED before merge** (CI auto-deploys on merge; rules+CF not single-revert — unlike the pure-frontend redesign PRs which I auto-merge). PDPA tenant-facing deferred (admin-only v1) — noted in lifecycle doc for when tenant-visible lands.

### Open for owner — RESOLVED 2026-06-07
- ✅ **Constants owner-reviewed + kept (don't re-ask):** tenure cap **24mo** · complaint-clean cap **12mo** · payment grace **0 days** (strict). Named in `_reputation.js` `REPUTATION_CONSTANTS`; re-tune only if the real score distribution warrants.
- ✅ Scheduled slot 05:40 BKK — confirmed free (only 05:00 cleanupPlayers nearby).
- Weights 60/25/15 — owner-locked earlier.

### Review (append after execution)
- **PR1 (server) — ✅ BUILT + all gates GREEN, ⏳ NOT merged/deployed (owner-gated).** 6 files: `_reputation.js` (pure core), `computeTrustScoresScheduled.js` + `recomputeTrustScores.js` (CFs), 3 test files; +`index.js` wiring, +`firestore.rules` match, +`firestore.rules.test.js` cases. Gates: `node --check` all clean · **functions suite 1955/0** · **rules suite 288/0 (emulator)** · verify:memory GREEN · no CSP/HTML touched. Architecture exactly as planned (server-computed, callable-not-trigger §7-NN, write-locked rule, trust≠points §6).
  - **Plan deltas (grep-grounded at build):** (1) complaints live in **Firestore** `complaints` top-level (`complaintAndGamification.js:98`), not RTDB — sweep reads FS with a streak-cap-bounded `where createdAt >=` (single-field, no index). (2) tests go in `functions/__tests__/` per repo convention. (3) doc carries `tenantId/building/roomId` identity context (single writer → no §7-T drift) beyond the planned `reputation/factors/provisional/computedAt`.
  - **⏳ Open (owner — the only gate left for PR1):** merge the PR → CI `deploy-functions.yml` auto-deploys the 2 CFs + you deploy `firestore:rules` (branch-checked prod). Merge == deploy (not single-revert) → needs your go-ahead. Then trigger `recomputeTrustScores` once + inspect real `trustScores/*` (§7-J live-data verify).
- **PR2 (admin card, Phase 4) — ✅ MERGED #287 (`9e89c34`).** `shared/dashboard-reputation.js` in the ผู้เช่า tab — ranked tenant list (tier-coloured chip + factor breakdown + provisional badge), KPI strip, empty state, `⟳ คำนวณใหม่` → `recomputeTrustScores` callable. Wired via `dashboard-insights.js` (render + refresh + recomputeTrust action). Pure `repTier`/`computeRepStats` + 7 tests (TDD caught two `Number(null)===0` bugs). Gates: shared **461/0** · CSP no drift · static-harness screenshot (full+empty) · pre-commit green. Pure frontend → auto-merged + Vercel-deployed. **✅ Live-verified on prod 2026-06-07** (Chrome MCP): owner clicked ⟳ → `trustScores/*` populated → card shows N101 Nest → 26 provisional (exact formula match). Nothing left open.
- **Whole Phase 3.2a v1 = ✅ SHIPPED end-to-end (2026-06-07):** PR1 server (#286) + PR2 card (#287), rules + CFs deployed, formula live-verified read-only. Next sub-phases (deferred, design doc `tasks/phase-3.2-trust-system-plan.md`): tenant-visible v1.x (claim-gated badge + PDPA) · v2 engagement dim (pointsLedger ~Aug) · 3.2b Kindness/Verified-Helper · 3.2c Resident Rank.
- **Memory:** new `lifecycle_trust_reputation.md` + `lifecycle_scheduled_jobs` (+05:40 row) + MEMORY.md index — written same session (CLAUDE.md §8).

---

## ✅ COMPLETE (2026-06-06) — Roadmap Phase 3.1: Behavioral Intelligence (PRs #268 tenure · engagement · #278 peak-repair)

**Scope:** roadmap Phase 3.1 "Behavioral Intelligence" — admin analytics that read the historical substrate Phase 0 created. **Re-scoped after evidence (3 Explore agents, file:line):** the roadmap's premise "skeleton not greenfield" UNDERSTATES it — **15 analytics signals already ship** (7 OLD `ins-*` in People→Insights via `dashboard-owner-insights.js`; 8 NEW `dash*` across 5 tabs via `dashboard-insights{,-community,-financial,-tenant,-operations}.js`). So v1 = build only what's **genuinely new AND green-data**, extend (not duplicate) what exists, defer what's blocked — with reasons.

**Why Plan-First:** multi-session feature, 5+ files, 2+ valid architectures (client-on-read vs pre-compute CF) → CLAUDE.md §1 threshold. (Reversible per-card, but the program spans sessions + sets the analytics-architecture precedent.)

### Verified current state (file:line — grep-advisory, re-confirm at build)
- **Compute architecture = client-on-read, NO pre-compute CF exists.** All 15 signals compute in-browser on tab-show, 5-min client cache (`dashboard-insights.js:27`); `window._ins.utils` namespace (loads first, `dashboard.html:5671`). `grep "pubsub.schedule" functions/` = 11 scheduled jobs, **none analytics** (revenue/cleanup/reminders only).
- **Substrate READY — both new sources unused by any card yet** (`grep -rln "pointsLedger\|occupancyLog" shared/` = only the writer `occupancy-log.js` + `dashboard-tenant-modal.js`, **zero analytics readers**):
  - `occupancyLog` (subcoll `tenants/{b}/list/{r}/occupancyLog/{idemKey}`) — append-only, server-`at`, `action` ∈ moved_in/moved_out/transferred_*/archived/restored. Composite index `tenantId ASC, at DESC` EXISTS (`firestore.indexes.json:170`, collectionGroup) + READY in prod (24/24 per MEMORY). **GREEN.**
  - `pointsLedger` (flat `pointsLedger/{idemKey}`) — append-only, signed `points`, `balanceAfter`, server-`at`, `source` ∈ 6 enums. Composite index `tenantId ASC, at DESC` EXISTS (`firestore.indexes.json:178`). **GREEN.**
- **Existing churn/health is point-in-time, occupancyLog-blind:** `computeHealthScore({paymentDelta,streak,complaintCount90d,monthsTenure})` (`dashboard-insights-tenant.js:18`) — `monthsTenure == null → 12` neutral guess (`:44`); churn flags + `churnCount` (`:245/:276`) annotate rooms but read NO real tenure history. → extend this, don't rebuild.
- **Per-signal data readiness (Agent 2 verdict):** move-out propensity **GREEN** (occupancyLog) · community-activity **GREEN** (pointsLedger) · energy pattern **YELLOW but already shipped** (`renderMeterSpike` ops tab + meter-anomaly z-score OLD) · payment behavior **YELLOW but already shipped** (`renderPaymentBehavior` + `renderOverdueBills`) · peak-repair-season **RED** (RTDB maintenance `status=done` deleted >30d by `cleanupMaintenanceRTDBScheduled` 04:10 — seasonality impossible without first preserving history) · pet patterns **YELLOW-thin** (only current binary state; no approval/adoption timeline logged).

### Architecture decision — client-on-read, NO new CF/schema/rules/index (matches all 15 existing signals)
The historical record ALREADY exists (occupancyLog + pointsLedger are the append-only logs Phase 0/4C created), so the analytics layer is pure read+compute. **No `behavioralScores/` pre-compute doc, no scheduled CF** for v1. *Why:* minimal blast radius, per-card reversible, gate-first, zero deploy risk, no §7-NN concern. *Alt (rejected for v1):* nightly CF writing score docs — only justified if we needed cross-day snapshots, but the ledgers ARE the snapshots. Revisit only for Trust System (3.2) if read-cost bites.

### v1 SCOPE — the 2 green-new signals that exploit the unused substrate (each = own PR, gate-first)

#### PR A — Move-out / Tenure Intelligence (occupancyLog → real tenure + turnover) · ~1 day · risk LOW
Home: **tenants tab** (next to existing health/churn — extend, per §7-K/AA discovery discipline).
- [ ] **Grep-confirm first** the exact existing churn/health surface (`dashboard-insights-tenant.js:18-57,232-276`) so we extend the same card, not add a duplicate.
- [ ] **`shared/dashboard-behavioral-tenure.js`** — read occupancyLog (per-room subcoll, or collectionGroup `where at >= cutoff`) → derive per-tenant **real `monthsTenure`** (from `moved_in` `at`, fallback `moveInDate`) and feed it into `computeHealthScore` to replace the `null→12` guess (one honest input, no formula change).
- [ ] **"Tenure & Turnover" card** — building-level: avg/median stay length, historical turnover rate (moved_out count / window), longest/shortest current stays, and a **move-out propensity ranking** grounded in real exits (tenants resembling past short-stayers) — NOT a new point-in-time guess. §7-E year math via `YearUtils` where dates touch BE.
- [ ] Render via `_ins.utils` pattern; CSS in `shared/components.css` (**§7-RR** — never `createElement('style')`); external `<script src>` after `dashboard-insights.js` (**§7-II** no CSP drift, **§7-PP** load order); `_ins.utils.errorHTML` on failure (**§7-N**).
- [ ] Unit test the pure tenure/turnover math (mock occupancyLog rows). Gate: node --check · test:shared · mojibake · verify:memory · no CSP drift.

#### PR B — Community Engagement Trend (pointsLedger time-series — the roadmap's headline unlock) · ~1 day · risk LOW
Home: **community tab** (next to streak leaderboard). First card to read pointsLedger as a series.
- [ ] **`shared/dashboard-behavioral-engagement.js`** — query last-90d ledger (`where at >= cutoff order by at` single-field, group client-side by `tenantId`; or per-tenant composite). Compute per-tenant **engagement velocity** (Σ positive `points` per 30/90d), building **participation rate** (active earners / occupied), and **top risers / fallers** (Δ vs prior window) — "whose engagement rose/fell over time", impossible before the ledger.
- [ ] Exclude redemptions (`points < 0`) from the *earning* signal; surface them separately if useful. Respect `GAMIFICATION_LIVE` (LIVE 2026-05-10) — if ever off, render a muted "ปิดอยู่" state not an error.
- [ ] Same render/CSP/load-order/error guardrails as PR A. Unit test the velocity/participation/Δ math (mock ledger rows).
- [ ] Gate identical to PR A.

### DEFERRED (named, not dropped — with the reason each is not in v1)
- **Peak-repair-season → BLOCKED (RED).** Needs a maintenance-history archive FIRST (a mini-"Phase 0 for maintenance") because `cleanupMaintenanceRTDBScheduled` (04:10) deletes `status=done` >30d — we're losing the data daily. Separate prerequisite PR: archive closed tickets to Firestore before cleanup, then build seasonality on the archive. *Flag to owner: the longer this waits, the less history survives* (same irreversibility logic that made pointsLedger Phase-0).
- **Pet patterns → THIN (YELLOW).** Only current binary `has-pets` state exists; no approval/vaccination/adoption timeline is logged → no real time-series. Low value until pet-lifecycle events are logged (pairs with the Nest pet-deposit work ~Aug).
- **Energy / payment behavior → ALREADY SHIPPED.** `renderMeterSpike`, meter-anomaly z-score, `renderPaymentBehavior`, `renderOverdueBills` cover these. Extend only if a specific gap surfaces — don't rebuild (§7-K).
- **Pre-compute CF / `behavioralScores/` doc** — only if 3.2 Trust System needs cross-day snapshots or read-cost bites.

### Cross-cutting guardrails (every PR)
One surface per PR behind `validate.yml`; tests with/before the change. Client-on-read only (no CF → §7-NN moot). New reader → grep writer first (§7-T). Composite indexes already READY (§7-J satisfied — re-confirm `gcloud firestore indexes composite list` shows READY before first query). CSS → `components.css` not inline/injected (§7-RR/II). Script after `dashboard-insights.js` (§7-PP). `onSnapshot`/read error → UI state (§7-N). Year math via `YearUtils` (§7-E). Admin-gated → live-verify on Vercel via Chrome MCP (agent can't drive admin — §7-J/I). Auto-merge own PRs ([[feedback_auto_merge_prs]]); no CF deploy so no owner gate, BUT live-verify each card on prod admin before "done". Re-read session diffs for self-conflict (§7-G). Update `lifecycle_insights_analytics.md` SAME session as each card.

### Open decision (need owner call before build)
1. **v1 scope** — **[REC]** ship PR A + PR B only (the 2 green-new signals), defer the rest with the reasons above · vs also build the **maintenance-archive prerequisite** now so peak-repair-season isn't perpetually losing data · vs a different subset. *My recommendation: A + B now (fast, pure-additive, zero-deploy), and separately greenlight the maintenance-archive as its own small PR since every day delays loses repair history.*

### Review (append per PR after execution)
- **PR A — Tenure & Move-out Propensity** ✅ MERGED #268 (`aab56e8`). New `shared/dashboard-behavioral-tenure.js` in the tenants tab: current-tenure distribution (reuses `tenants_all` cache, 0 extra reads), historical turnover from `tenants/{b}/archive` parent docs (1 admin query/building, index-free — `occupancyLog` is NOT in `ARCHIVED_SUBCOLLECTIONS` so the archive parent is the cleanest move-in+archivedAt source), move-out propensity ranking (lease-expiry/tenure/inactivity + best-effort payment-late/complaint enrichment from the Health card's warmed caches). Client-on-read; no CF/schema/rules/index. Gates: 20 unit tests · test:shared 406/0 · node render-smoke · static-harness screenshot · mojibake clean · no CSP drift · pre-commit green. **Open (owner):** live-verify on prod admin (Insights → ผู้เช่า).
- **PR B — Community Engagement Trend** ✅ (this PR). New `shared/dashboard-behavioral-engagement.js` in the community tab — FIRST card to read `pointsLedger` as a time-series (admin read rules:755; `where at>=now-90d orderBy at desc limit 3000`, single-field `at` index, bounded+logged no silent cap). Computes participation rate (active earners / occupied), 30d/90d earned totals + avg/active, source breakdown, risers/fallers (Δ recent-30d vs prior-30d) — the roadmap's "whose engagement rose/fell" unlock. tenantId→name via `tenants_all` map (real `tenantId` OR synthetic `{building}_{roomId}`) + `PersonManager.getPersonSync` fallback. Redemptions excluded from earning (counted separately). Client-on-read. Gates: 9 unit tests · test:shared 415/0 · render-smoke · static harness (cardWidth 538px, title single-line, math matches tests) · mojibake clean · no CSP drift. **Open (owner):** live-verify on prod admin (Insights → ชุมชน).
- **Deferred (named, per plan):** peak-repair-season (RED — maintenance `status=done` deleted >30d by `cleanupMaintenanceRTDBScheduled`; needs a maintenance-archive prerequisite, flagged to owner) · pet patterns (YELLOW — only current binary state, no lifecycle timeline; pairs w/ Nest pet work ~Aug) · energy/payment (already shipped: meter-spike + payment-behavior) · pre-compute CF / `behavioralScores/` doc (only if 3.2 needs cross-day snapshots).
- **Next (Phase 3.2 Trust System):** blocked until `pointsLedger` accumulates ~1–3 months; the engagement card is the read-substrate it will build on.

---

## ✅ DONE — Per-tenant deposit evidence HISTORY (Item B) · steps 1-3 #260 + step 4 #265 (2026-06-05) ALL SHIPPED

> **Review (steps 1-3+6):** `tenantId` stamped on seed+return; `_reconcileDepositForRoom` (per-room, self-healing) backfills holding tenantId + archives a settled doc whose tenantId≠current to `deposits/{b}_{r}/history/{settlementId}` (archive FIRST, then reset to holding). `firestore.rules` history subcollection (admin write / accountant read) + 5 tests. Gates: node --check · **test:rules 276/0** (emulator) · **test:shared 386/0** · verify:memory ALL GREEN (README 256→261) · mojibake clean. Legacy (no tenantId) docs untouched (§7-L).
> **Review (step 4, ✅ #265 2026-06-05):** `showDepositEvidence` renders "การคืนล่าสุด" + "📜 ประวัติผู้เช่าก่อนหน้า (N)" (collapsible per archived settlement, newest-first, name via `PersonManager.getPerson`, lazy img/PDF). `_reconcileDepositForRoom` stamps `historyCount` on the freshHolding reset (`(prev||0)+1`) → card gate `(isReturned&&hasEvidence)||historyCount>0`, label `ดูประวัติ (N)` so a **holding** room (new tenant) exposes the prior tenant's evidence without an N+1 query. History read is try/catch → degrades silently until #260 rules deploy. Verified via stubbed-firebase static harness (returned / holding / no-history / rules-not-deployed). test:shared 386/0 · lint 0-err · verify:memory green · mojibake clean. Folded into [[lifecycle_deposit_management]]. **Open (owner):** #260 `firebase deploy --only firestore:rules`; confirm a real move-in sets `deposit`+`tenantId` so the turnover reset fires (decision #3).

**Context:** Same session shipped the deposit evidence VIEWER (bug-fix, not logged here): clickable 📎 on pending deductions → blob lightbox · `showDepositEvidence` retrospective gallery button on returned cards (thumbnails via `getDownloadURL` + ✅-verified slip badge + PDF link) · `👁 ดู` slip preview in the return modal. `shared/dashboard-deposits-admin.js` + 4 `data-action` hub wires in `shared/dashboard-main.js`; node --check clean, static-harness verified, NOT yet pushed. Owner then asked to also **"ทำประวัติหลักฐานรายผู้เช่า"** — keep each tenancy's move-out evidence so a room's condition can be compared across successive tenants.

**Why Plan-First:** schema change (`deposits/` doc + new `history/` subcollection), `firestore.rules` change (+tests), touches the seed that runs for EVERY room on admin load (blast radius), 2+ valid designs → crosses CLAUDE.md §1 threshold.

### Current-state findings (grep-verified this session)
- `deposits/{b}_{r}` = **one doc per room**; written only in seed (create-if-missing), `_saveDepositInstallment` (merge), `_saveDepositReturn` (**full `setDoc`** → `returned`). *(verify: `grep -n "doc(db, 'deposits'" shared/dashboard-deposits-admin.js`)*
- `status:'holding'` set **only** in the seed; seed keys by room id, **skips any existing doc**, and does **not** read/store `tenantId`. → a new tenant in a previously-returned room gets **no fresh deposit**; tenant A's returned doc + evidence linger for tenant B. *(verify: `grep -rn "status: 'holding'" shared/`; `grep -n existingIds shared/dashboard-deposits-admin.js`)*
- No CF resets `deposits/` on move-out — `archiveTenantOnMoveOut` only zeroes the TENANT doc (`deposit:0`, `tenantId:''`, status `vacant`). Storage evidence files **persist** (unique timestamped paths, no delete CF) — only doc references are overwritten at the next settlement.
- Tenant SSoT doc DOES carry `tenantId` (written by `dashboard-tenant-modal.js`, cleared by `archiveTenantOnMoveOut`) → usable to detect tenant change. *(verify: `grep -n "tenantId:" shared/dashboard-tenant-modal.js`)*

**Implication:** the deposit system is single-cycle-per-room today. "Compare with the next tenant" first needs the doc to become **tenant-aware** + gain a **new-cycle reset**; the history archive is the payload.

### Recommended approach — `history/` subcollection + tenant-aware seed
- **+`deposits/{b}_{r}.tenantId`** — stamp current tenancy at seed + return (legacy docs absent → "unknown previous"; never archived spuriously).
- **+`deposits/{b}_{r}/history/{settlementId}`** — immutable snapshot per completed settlement `{tenantId, returnedAt, returnedAmount, finalBillTotal, deductions[], refundSlip, refundSlipVerified, archivedAt}` (Storage paths still live). Mirrors the `actionAudit/` immutable-record philosophy; keeps the live "current" doc simple.
  - *Alt considered:* flat top-level `depositSettlements/{…}` — more decoupled but +1 listener/collection; rejected as heavier for now.

### Steps
- [x] **1.** Stamp `tenantId` on the deposit doc (seed writes `t.tenantId||''`; `_saveDepositReturn` preserves). — *join key for "which tenancy".* ✅ #260 (`dashboard-deposits-admin.js:533`).
- [x] **2.** Tenant-aware new-cycle reset — shipped as `_reconcileDepositForRoom` (per-room, self-healing): a settled doc whose stored `tenantId` ≠ current → archive into `history/{settlementId}` FIRST, then reset main doc to fresh `holding` with `historyCount++`. Legacy-empty tenantId → backfill only (no spurious archive). ✅ #260 (`dashboard-deposits-admin.js:111-159`).
- [x] **3.** `firestore.rules` `match /history/{settlementId}` (admin read+write, accountant read) + 12 `test:rules` cases. ✅ #260 (`firestore.rules:844`). **⚠️ Open (owner): `firebase deploy --only firestore:rules` not yet run — history reads degrade silently (try/catch) until deployed.**
- [x] **4.** Gallery "ดูประวัติ (N)": `showDepositEvidence` shows current first, then collapsible past settlements (each its own sub-gallery, labelled tenant + returnedAt) from `history/`. — *the actual cross-tenant compare surface.* ✅ #265 (2026-06-05).
- [x] **5.** Legacy degrades cleanly (§7-L): existing returned docs render as the single current settlement; first turnover after ship starts history. No backfill. ✅ (no `historyCount` → no button; verified no-history harness case).
- [x] **6.** Update `lifecycle_deposit_management.md` (schema + Flow + Key Files) + `npm run verify:memory`. ✅ (#260 steps 1-3 + #265 step 4).

### Open decisions (need owner call)
1. **Archive writer:** client-side in the seed (admin-authed, simplest, no §7-NN SE3 concern) **[REC]** vs a small `onCall` CF for atomicity.
2. **PR scope:** ship 1–6 together vs land 1–3 (capture history now so no turnover is lost) then 4 (compare UI) as follow-up **[REC: split]**.
3. **Does turnover actually re-seed today?** Reset fires only when a new tenant's `deposit` is set & status≠vacant — confirm against one real move-in before building step 2.

### Guardrails
§7-I (no auto-write to prod beyond the intended reset; preview) · §7-T (grep `tenantId`/`history` writers+readers) · §7-L (legacy degrade) · §7-DD (deposit doc is the only write here) · §7-J (no new index unless a `history` query needs one) · `test:rules` green before deploy (branch-protection) · one PR off fresh main behind `validate.yml`.

### Out of scope (named)
Auto-collecting any tenant still-owes · pet-deposit history (Nest ~Aug) · backfilling pre-ship returned docs into history · automatic move-out→settlement coupling (stays manual per Slice C D4).

---

## ▶▶▶ ACTIVE PLAN (2026-06-04 PM) — Deposit settlement: deduct final/outstanding bill (spec §1.3) · ✅ SHIPPED to branch (PR pending) — gates green (shared 382/0, +8: netRefund + outstandingBillsForRoom), verify:memory 0 fail, mojibake clean, client-only

**Why:** owner caught that Slice C settlement deducts only manual damage rows — it never pulls the **final-month bill** (ค่าเช่า+น้ำ+ไฟ+ขยะ) that spec §1.3 says to deduct from the deposit (canonical example: มัดจำ 3,000 − บิลเดือนสุดท้าย 2,300 = คืน 700). The `finalBillTotal` was in the original Slice C plan but dropped in the "core" re-scope. Owner chose **Option 1 (auto-pull + deduct + mark bills paid-from-deposit)**.

**Why Plan-First:** money-flow (marks prod bills `status:'paid'`), cross-collection (deposit + bills + audit, §7-DD), not single-revert (writes prod bill status). Rooms-building only (Nest has no billing pipeline → no-op there).

### Verified infra (this session, file:line)
- **Outstanding source:** `BillStore.listAll()` (`billing-system.js:914`) + `dashboard-aging.js` `_normBill` (`:138`, reads `b.roomId||b.room`, BE-year via `toBE`) + `_isArrears` (status ∉ {paid,refunded,void}). `computeAging` (`:86`) groups by building+room. **Reuse via a new exported `outstandingBillsForRoom(b,r)`** — DON'T re-implement the filter (§7-D/E year+room traps live in `_normBill`).
- **Mark-paid path:** existing `saveBillToFirebase` (`dashboard-bill-payment-status.js:107`) is a FULL-replace from the admin form — NOT reusable here (no form `d`). Use a **partial** `firebaseUpdate` (exposed in dashboard.html) on `bills/{b}/{r}/{billId}` → `{status:'paid', paidVia:'deposit_settlement', paidAt, paidRef:'deposit_'+key}`, preserving charges.
- **⚠️ path-key trap:** `listAll()`/`getByRoom()` drop the RTDB path key (return `Object.values`). Marking paid needs the exact key → read `BillStore._cache[bld][room]` via `Object.entries` to get `[pathKey, bill]`. `billId` field == path key for saveBillToFirebase-written bills but NOT guaranteed for others → use the real key.
- **Audit:** one `DEPOSIT_RETURNED` event (not N `BILL_PAID_MANUAL`) — its `after` carries `finalBillTotal` + `settledBillIds[]`.

### Build
- [ ] **`dashboard-aging.js`** — export `window.outstandingBillsForRoom(building, room)` → `{ bills:[{key, billId, month, beYear, total}], total }` (reuse `_normBill`+`_isArrears`; iterate `_cache[bld][room]` entries for the key). +unit test (mock BillStore).
- [ ] **`deposit-calc.js`** — `netRefund(held, finalBillTotal, deductions)` pure helper (`held − finalBillTotal − Σdeductions`) + test (incl. spec §1.3 example).
- [ ] **`dashboard-deposits-admin.js`** — `showReturnDepositModal`: pull `outstandingBillsForRoom` → stash `_depFinalBills`; show a read-only "บิลค้างชำระ (เดือนสุดท้าย)" block (only if total>0). `_updateRefundSummary` + `_genRefundQR`: net = held − finalBillTotal − damageTotal. `_saveDepositReturn`: firebaseUpdate each final bill → paid/deposit_settlement; store `finalBillTotal`+`settledBills[]` on deposit doc; DEPOSIT_RETURNED `after` += finalBillTotal+settledBillIds. **§7-I:** the bills show in the preview; the existing ยืนยัน click is the gate (no auto-click). Nest → empty → no bill writes.
- [ ] **receipt** (`exportDepositReceipt`) — add "บิลเดือนสุดท้าย" line above net.
- [ ] Gate (node --check, test:shared, mojibake, verify:memory) + lifecycle doc + live-verify on a **rooms-building** room with an unpaid bill.

### Decisions
- **D1 mark-paid mechanism:** partial `firebaseUpdate` (preserve charges) **[REC]** vs full `saveBillToFirebase` rebuild (needs form data — N/A).
- **D2 reconcile impact:** deposit-settled bills have no slip → would land in reconcile's "unmatched paid" bucket. **DEFER + name** (the bill is correctly paid; reconcile cosmetic) vs add `paidVia:'deposit_settlement'` skip to `dashboard-reconcile.js` now. **[REC: defer]**
- **D3 idempotency:** re-settling an already-`returned` deposit shouldn't re-mark bills. Guard on deposit `status==='returned'` (modal only opens for non-returned) — sufficient.

### Guardrails
§7-DD (deposit + bills + lease siblings — here deposit+bills) · §7-I (preview→explicit click, no auto-`.click()`) · §7-D/E (reuse `_normBill`, don't re-filter) · §7-T (grep `paidVia`/`settledBills` readers) · money-flow client-side write (precedent: manual mark-paid is client-side) · branch off fresh main, behind `validate.yml`, auto-merge per [[feedback_auto_merge_prs]] (client-only — no CF deploy).

### Out of scope (named)
Synthetic manualReceipt for reconcile (D2) · partial bill settlement (all-or-nothing per bill) · Nest (no bills until ~Aug).

---

## ▶▶▶ ACTIVE PLAN (2026-06-04) — Deposit · Pet-fee · Damage-settlement · ⏳ AWAITING APPROVAL (Plan-First)

**Source spec:** [tasks/deposit-pet-damage-rules.md](deposit-pet-damage-rules.md) — owner-confirmed 2026-06-04 (deposit = 2×rent w/ installments · pet fee ฿400/ตัว/เดือน · pet deposit ฿10,000/ห้อง · move-out settlement w/ itemized damage routing). This plan = the implementation of §2 "สเปกระบบ" of that doc.

**Why Plan-First:** schema change (`deposits/` doc shape, bill `charges.petFee`, new revenue category, settlement record), new `onCall` CF, rules + storage + index changes, multi-session, 2+ valid approaches → CLAUDE.md §1 threshold (every leg crosses it).

### Verified current state (3 Explore agents, file:line — grep-advisory, re-confirm at build)
- **`deposits/{b}_{r}`** flat doc = `{building, roomId, amount, status('holding'|'returned'), receivedAt, returnedAt, returnedAmount, deductions[{reason,amount}], refundBank, notes, updatedAt}` (`dashboard-deposits-admin.js:2-3,47-56,185-202`). Seed `amount = Number(t.deposit)` from `tenants/{b}/list/{r}.deposit` (`:38,49`) — **NOT** computed 2×rent. **No installment** (grep `paidSoFar|installment|partial` = 0), **no pet deposit** (grep `petDeposit|ประกันสัตว์` = 0), status only holding/returned. Rules `firestore.rules:805-812` (admin write · admin+accountant read). Tenant badge `tenant-render.js:240-254` reads `depositStatus`. **No audit** on `_saveDepositReturn`.
- **Rent source:** room config `config-unified.js` (`rent` for rooms `:220`, `rentPrice` for nest `:257`) + tenant doc `rent`/`rentAmount` (`tenant-render.js:240`). Pet-allowed rooms = `type:'pet-allowed'` in nest config (`:267-276`).
- **Bill charges** = rent/electric/water/trash (+eUnits/wUnits) only — `notifyTenantOnMeterUpload.js:107-126` (Firestore `invoices/` of-record) · `billing-system.js:338-355` (tenant RTDB view) · `_billFlex.js:94-100` (compute). **No `petFee`** anywhere (grep = 0).
- **`aggregateMonthlyRevenue.js`**: categories `rentIncome/electricIncome/waterIncome/trashIncome/otherIncome/totalRevenue` (`_emptyMonth :50-58`); `other = max(0, total − rent − elec − water − trash)` residual (`:101-103`); accumulate `:106-111`; per-building `:120-124`; annual `:137-153`; skips `status==='refunded'` (`:94`). `otherIncome` (#243) = **generic residual, NOT pet-specific** (#243 explicitly deferred pet-fee-as-category "no data"). → `taxSummary/{BE}` via `writeSummary :170-182`; tax-filing UI renders the columns.
- **Pets:** `tenants/{b}/list/{r}/pets/{petId}` w/ `status` field (`tenant-pets.js:38-42,189-201`); initial `'pending'`. ⚠️ exact APPROVED enum value NOT yet confirmed — grep the admin pet-approval writer at build (lifecycle_pets_registration).
- **Move-out:** `archiveTenantOnMoveOut.js` writes tenants+leases+occupancyLog in one batch (`:249-314`) — **never deposits**; deposit return is the separate manual `_saveDepositReturn`. §7-DD already satisfied for leases.
- **Audit:** `recordAdminAction` onCall SE1 `{action,targetType,targetId?,building?,roomId?,before?,after?,note?}` (`recordAdminAction.js:49-89`); in-tx `appendActionAudit(writer,fs,payload)` (`_actionAudit.js:84-126`); `VALID_ACTIONS` Set (`:53-61`) has **no `DEPOSIT_RETURNED`**.
- **Refund slip storage:** `refundBill.js` (#245) stores status+audit, **no image**. Admin-image storage pattern = `{collection}/{id}/{subdir}/{file}` (`storage.rules` booking/lease/checklist); **no deposit-slip path** exists.
- **Outstanding/arrears** reusable: aging just shipped (#246) — `BillStore.listAll()` (`billing-system.js:914`) + `computeAging` (`dashboard-aging.js`) give per-room outstanding for settlement overflow.

### Design decisions (confirm or adjust before build)
- **D1 — Pet deposit storage:** nest a `pet:{amount,paidSoFar,status,returnedAt,returnedAmount}` object on the SAME `deposits/{b}_{r}` doc (one read, atomic with room deposit, no new collection). *Alt:* separate `deposits/{b}_{r}_pet` doc. **Recommend: same doc, nested `pet`.**
- **D2 — Pet-fee revenue category:** own `petFeeIncome` key in `aggregateMonthlyRevenue` (spec §2.1 lists ค่าสัตว์ as its own revenue line; auditor-clear) + subtract petFee from the `other` residual so total still reconciles. *Alt:* fold into `otherIncome` (simpler, loses visibility). **Recommend: own `petFeeIncome`.**
- **D3 — Pet-fee timing:** compute `petFee = 400 × (approved pets in room)` at bill generation inside `notifyTenantOnMeterUpload` (auto, admin sees it in the bill preview before approve — §7-I safe). *Alt:* admin manually keys it. **Recommend: auto-compute, admin-visible.**
- **D4 — Settlement ↔ move-out coupling:** keep `settleDeposit` a SEPARATE admin action (don't auto-fire from `archiveTenantOnMoveOut` — avoids coupling + §7-DD blast); surface a "ยังไม่ settle มัดจำ" badge on vacant/archived rooms so it isn't forgotten. **Recommend: separate + reminder badge.**

### SLICE A — Pet fee billing + `petFeeIncome` revenue category · ~0.5–1 day · risk LOW · own PR (closes #243-deferred)
Independent of deposits; revenue-side only. Do first.
- [ ] **Confirm approved-pet predicate** — grep the pet-approval writer to get the exact `status` value + whether pet-allowed-room gating matters. *Why:* §7-T/§7-J — count must match the real enum, not assume `'approved'`.
- [ ] **Add `charges.petFee`** at the canonical bill-assembly site `notifyTenantOnMeterUpload.js:107-126` = `400 × approvedPetCount` (read `tenants/{b}/list/{r}/pets` server-side in the CF). Mirror into the tenant RTDB bill view (`billing-system.js:338-355`) + dashboard bill form display (`dashboard-bill.js:411-443`). *Why:* one source-of-truth charge, surfaced everywhere a bill renders.
- [ ] **`aggregateMonthlyRevenue.js`** — add `petFeeIncome` to `_emptyMonth`/`_emptyByBuilding`/annual; compute `petFee = Number(b.charges?.petFee)||0`; `m.petFeeIncome += petFee`; change residual to `other = max(0, total − rent − elec − water − trash − petFee)`. *Why:* keeps Σcategories === totalRevenue (the #243 invariant) while giving pet fee its own line.
- [ ] **tax-filing UI** — add "ค่าสัตว์เลี้ยง" column reading `petFeeIncome` (mirror the #243 otherIncome column). 
- [ ] **Tests + gate:** unit test pet-fee math in the bill CF + a `aggregateMonthlyRevenue` reconciliation test (Σ === total incl. petFee). `node --check`, `test:shared`, rules unaffected.
- [ ] **Deploy:** `firebase deploy --only functions:notifyTenantOnMeterUpload,functions:aggregateMonthlyRevenue` (branch-check first per [[feedback_branch_before_firebase_deploy]]) + Vercel for UI. Live-verify: a room with N pets → bill shows ฿400N → tax P&L petFee column populates.

### SLICE B — Deposit installments + pet deposit · ~1–2 days · risk MED · own PR
- [ ] **Schema extend `deposits/{b}_{r}`** — add `paidSoFar` (number, default = `amount` for legacy = treat existing as fully paid), derived `due = amount − paidSoFar`; add `status:'partial'` between holding/returned; nest `pet:{amount:10000, paidSoFar, status}` (D1) only for pet-allowed rooms / rooms with pets. *Why:* spec §1.1 installments + §1.2 separate pet deposit. §7-L: existing docs keep working (reader treats missing `paidSoFar` as fully-paid; no destructive migration).
- [ ] **Seed = 2×rent** — `_seedDepositsFromTenants` derive room-deposit `amount = 2 × monthlyRent` (rent from config/tenant) when seeding NEW docs; leave existing `amount` untouched. *Why:* spec §1.1; don't rewrite live amounts (§7-I/§7-L).
- [ ] **Admin UI** (`dashboard-deposits-admin.js`) — "บันทึกการผ่อนมัดจำ" (record an installment → bump `paidSoFar`, flip `partial`→`holding` when complete) + pet-deposit fields in the same panel. KPI: add outstanding-deposit total. *Why:* spec §1.1 "ส่วนที่ยังไม่ครบ = ยอดค้าง".
- [ ] **Rules** — `deposits` stays admin-write/admin+accountant-read (new fields, same access); add `test:rules` cases for the nested `pet` + `paidSoFar`. 
- [ ] **Tenant badge** (`tenant-render.js:240-254`) — show installment progress (`paidSoFar/amount`) + pet-deposit status when present. *Why:* tenant transparency (spec §1.5).
- [ ] **Tests + gate** + Vercel live-verify (admin records partial → tenant sees progress).

### SLICE C — Move-out settlement: itemized damage routing + audit + refund slip · ~2 days · risk MED-HIGH · own PR (depends on B)
- [ ] **Deduction shape** → `{type, cause:'human'|'pet', desc, amount, photo}` (photo = Storage path). Replace `{reason,amount}` reader/writer in `dashboard-deposits-admin.js` (back-compat: treat legacy `reason` as `desc`, missing `cause` as `'human'`). *Why:* spec §2.2 routing needs `cause`; §1.4 needs photo evidence.
- [ ] **New CF `functions/settleDeposit.js`** (onCall SE1, admin-gated — copy `refundBill.js`/`archiveTenantOnMoveOut.js` pattern, §7-NN). Input `{building, room, deductions[], finalBillTotal, refundBankRef}`. Routing (spec §2.2), atomic Firestore tx:
  - `cause==='pet'`: consume `pet.amount` → overflow `room amount` → overflow = tenant still-owes (record, don't auto-collect).
  - `cause==='human'`/ambiguous-default: consume `room amount` → overflow still-owes. **Never touch `pet`.**
  - Subtract `finalBillTotal` from room deposit (spec §1.3). Compute `returnedAmount` (room) + pet `returnedAmount`.
  - Write `deposits/{b}_{r}` status='returned' + settlement record; `appendActionAudit({action:'DEPOSIT_RETURNED', before, after, ...})` in the SAME tx (§7-DD). 
- [ ] **`_actionAudit.js:53-61`** — add `'DEPOSIT_RETURNED'` to `VALID_ACTIONS` (+ test).
- [ ] **Storage** — new admin-write path `deposits/{b}_{r}/{damage|slip}/{file}` in `storage.rules` (mirror checklist/lease admin-image pattern); use `dataUrlToBlob` not `fetch(dataURL)` for canvas→blob (§7-Y).
- [ ] **Admin settlement UI** — itemized-deduction editor (cause dropdown + photo upload per row), live preview of routed refund (reuse `computeAging`/`BillStore.listAll` for outstanding), `httpsCallable('settleDeposit')` — **§7-I: preview → admin clicks, never auto-`.click()`**. Upload refund transfer slip.
- [ ] **Reminder badge** (D4) — mark vacant/archived rooms with held deposit as "ยังไม่ settle".
- [ ] **Tests** (routing math: pet-overflow-to-room, human-never-touches-pet, final-bill-deduction, return-difference example มัดจำ3000−บิล2300=700) **+ rules test + index READY (§7-J) + live-verify** (admin settles a test room → audit row immutable, slip stored, tenant badge flips).

### Cross-cutting guardrails (every slice)
- One surface per PR, behind `validate.yml`; tests with/before the change. Backend = `onCall` SE1 not Firestore trigger (§7-NN). New field → grep writer+reader first (§7-T). Composite index `READY` before any query (§7-J). Production data actions → preview, never auto-`.click()` (§7-I). After each: re-read session diffs for self-conflict (§7-G); update `lifecycle_deposit_management.md` SAME session.
- Auto-merge own PRs per [[feedback_auto_merge_prs]]; **deploy step waits for owner confirmation**. Don't stack PRs (§stacked-PR lesson) — branch each off fresh `main`.

### Out of scope (named, not dropped)
- Auto-collecting the still-owes overflow (settlement records it; collection is a separate dunning flow).
- Auto-firing settlement from move-out (D4 keeps them separate).
- Multi-currency / partial pet-deposit refund schedules.

### Recommended order
**A** (pet fee — independent, closes #243-deferred) → **B** (deposit schema) → **C** (settlement, needs B). Each its own PR.

### Review (append per slice after execution)
- **A1 — `petFeeIncome` revenue category** ✅ SHIPPED #247 (`8efc162`). Behaviour-neutral (no bill emits petFee yet). CF deploy deferred → batch with A2b.
- **A2a — `rooms_config.petFee` source** ✅ SHIPPED #248 (`718420b`). `shared/pet-fee.js` (+5 tests) · `syncRoomPetFee` wired to approve/reject/remove · `backfillRoomPetFees()` · RoomConfigManager carries petFee both sync directions (§7-T). Client-only, inert until A2b.
- **A2b — bills emit ฿400×pets** ⏸️ PARKED till Nest live (~Aug 2026). Live trace 2026-06-04: real persist writer = `saveBillToFirebase` (nested charges, **rooms-bldg only**); `calculateBillFromMeterData` confirmed dead (prod config has `rentPrice` not `rent`). **Nest = all pet rooms, but it's unbuilt (~Aug, owner restructuring to all-floors-pet) → `bills/nest` null, 0 nest meter_data → no Nest bill to emit petFee onto, and revenue reads `bills/`.** A1+A2a ready for when Nest is billed. Map in `next_session_handoff_2026_06_04_petfee.md`.
- ⚠️ **Nest billing-pipeline gap (surfaced):** Nest has no meters→bills→revenue at all. It needs one (like the rooms building) before the Aug launch — prerequisite for pet fee + pet deposit + pet-damage. Separate project.
- **Slice B core** ✅ SHIPPED #249 (`9ccf4e6`) — deposit installments: `shared/deposit-calc.js` (+6 tests) · `paidSoFar`/`due` · ผ่อนมัดจำ modal · ค้างรับ KPI · **return flow now installment-aware** (refund = held−deductions) · tenant ค้างมัดจำ badge. Rooms-building; pet-deposit (฿10,000) deferred to Nest ~Aug. Lifecycle doc updated.
- **Slice C core** ✅ MERGED + DEPLOYED to prod · **PR [#250](https://github.com/soulgroundliving/the-green-haven/pull/250)** (squash `81d8bfe`, +251/−26). Rooms-building, human-damage only (pet-cause routing deferred to Nest ~Aug).
  - Deductions `{reason,amount}` → `{desc,amount,photo}`; §7-L back-compat via `DepositCalc.deductionDesc` (legacy `reason`→`desc`, no migration). New `deposit-calc.js` helpers `deductionDesc`/`deductionsTotal` (+7 tests).
  - Optional damage photo per deduction + optional refund slip → `deposits/{building}/{roomId}/` Storage (admin-only, mirrors leases). +6 `storage.rules` tests (36→**42**, emulator-verified). File inputs → `uploadBytes` direct (no §7-Y).
  - **Decision: `recordAdminAction` reuse** (not a new `settleDeposit` CF) — settlement = single client-side Firestore write, no RTDB cross-write like void/refund. `DEPOSIT_RETURNED` ∈ `_actionAudit.js` VALID_ACTIONS (+3 tests); fire-and-forget after the write (§7-I). **Decision: photo optional** (rooms-bldg; spec §2.4.1 mandatory deferred to Nest).
  - New doc fields `refundBank`+`refundSlip`; `paidSoFar` preserved; `returnedAmount = held−Σdeductions`. Save button locks during async uploads.
  - **Gates:** node --check all · shared **368/0** · functions **1908/0** (pre-commit) · storage **42/42** (emulator) · verify:memory **0 fail** · mojibake clean · no CSP drift (external `<script src>`). CI `validate` ✅ pass.
  - **Deployed 2026-06-04:** functions auto-deployed via `deploy-functions.yml` on merge (run 26949005186 success → `recordAdminAction` accepts `DEPOSIT_RETURNED`); storage rules `firebase deploy --only storage` done (owner, branch-checked prod); client on Vercel. Graceful-degradation design held — settlement saved regardless; photos/audit activated on backend deploy.
  - **⏳ Open (owner — only item left):** live-verify (admin-gated, §7-I — agent can't drive): admin settles test room w/ photo → `returned` + `refundSlip` stored + `DEPOSIT_RETURNED` audit row + tenant badge flips.
  - **Deferred (named):** reminder badge for vacant-room-held-deposit (D4) · pet-cause routing + pet deposit (Nest ~Aug) · auto-collect shortfall.
- _Process: stopped A2b at a safe milestone (A1+A2a merged+inert) rather than rush financial multi-writer code at the tail of a long session (§score-instability breadth-trap). Null-byte §7-TT incident caught + fixed mid-A2a (node `0x00→0x20` pass)._

---

## ▶▶▶ ACTIVE PLAN (2026-06-03 PM) — Roadmap Phase 2: Refund flow (reverse a PAID bill + trail) · ✅ SHIPPED #245 (main `3d35c8f`)

**Scope:** roadmap Phase 2 "Refund flow — paid-bill reversal with trail + 1.1 audit row." Blueprint (PDF p.1) lists **คืนเงิน (refund)** as a SEPARATE internal-control from **ยกเลิกบิล (void**, shipped 1.3): refund = money already COLLECTED is returned. Forward-only. Mirrors the `voidInvoice` CF + audit pattern exactly. **Branch off fresh `main` (NOT stacked — §stacked-PR lesson 2026-06-03 [[feedback_stacked_pr_squash_merge]]).**

### Verified state (3 Explore agents, file:line — grep-advisory, re-confirm at build)
- **No bill-refund code exists** — only `shared/dashboard-deposits-admin.js` (deposit return) + tax-balance. grep `refund` functions/ = 0 bill-reversal. (Agent A.)
- **Paid-bill SoT (reversal target):** RTDB `bills/{building}/{room}/{billId}` — `status:'paid'`, `paidAt`, `paidVia`, `paidRef`(→ slip `transactionId`), `receiptNo` (`verifySlip.js:~347`). Payment doc-of-record = Firestore `verifiedSlips/{transactionId}` (real slip OR synthetic `manual_{b}_{r}_{y}_{m}` for cash, `dashboard-bill-payment-status.js:~70`). Mirror RTDB `payments/{b}/{r}/{pushId}`; manual cash also `manualReceipts/{b}_{r}_{billId}`.
- **Reversal key:** `(building, room, yearBE, month)` deterministic + `bill.paidRef`. §7-E: billId encodes BE/CE inconsistently → key off (building,room,period)+paidRef, NOT the billId string.
- **Void template** (`voidInvoice.js`): onCall v1 SE1, admin-gate `token.admin===true`, `runTransaction`: read → idempotent early-return if terminal → `tx.update(status + *At/*By/*Reason)` → `appendActionAudit(tx,db,{action:'BILL_VOIDED',before,after,actor/ip server-stamped})` — never deletes. Registered `index.js`. (Agent B.)
- **Audit infra** (`_actionAudit.js`): `VALID_ACTIONS` Set (BILL_VOIDED present, **no BILL_REFUNDED**); `appendActionAudit(writer,fs,payload)` stamps actor/role/ip/at server-side; optional `idempotencyKey`. UI template `dashboard-invoice-void.js` (`window.voidInvoicePrompt`: read persisted doc → preview → `ghPrompt` reason → `httpsCallable` → §7-I no auto-click; `data-action` + `dashboard-main.js` hub + `<script src>`, no CSP drift).
- **Revenue** (`aggregateMonthlyRevenue.js`): LIVE RTDB read each run, `isPaid = status==='paid'`; paid→`paidRevenue`, **else→`pendingRevenue`**. So `'refunded'` auto-leaves paidRevenue **BUT the else branch would inflate `pendingRevenue`** → needs a guard. `taxSummary/{BE}` = CACHE; refresh scheduled 02:07 1st-of-month OR admin HTTP POST `{year}`; §7-L client fallback meanwhile. (Agent C.)
- **Reconcile** (`dashboard-reconcile.js`): `computeReconciliation` processes only `status==='paid'`; a refunded bill's slip would orphan into `unmatchedSlips` → flip the slip record so reconcile skips it.
- **Points** (`verifySlip.js:~410`, Nest-only): payment awards 150/100/40/15/0 + `appendPointsLedger`. **No reverse path** (`_pointsLedger.js` VALID_SOURCES has none) → claw-back = decision D2.

### Design — `refundBill` CF mirrors `voidInvoice`, propagates to the readers
- **CF `functions/refundBill.js`** (onCall v1 SE1, admin-gated) — input `{building, room, year, month, reason}`; read the bill to derive billId/paidRef. Atomic-as-possible:
  1. RTDB `bills/{b}/{r}/{billId}` → `status:'refunded'` + `refundedAt/refundedBy/refundReason` (never delete; keep `paidRef`/`receiptNo` for trail).
  2. Firestore `verifiedSlips/{paidRef}` → `status:'reversed'` + `reversedAt/By/Reason` (reconcile skips it; proof preserved).
  3. `appendActionAudit({action:'BILL_REFUNDED', targetType:'bill', before:{status:'paid',amount}, after:{status:'refunded',reason}, actor/ip server-stamped})`.
  - Idempotent: already-refunded → early-return. *(RTDB + Firestore aren't one tx — sequence Firestore tx (slip+audit) then RTDB update; confirm ordering at build, both admin-SDK so no client race.)*
- **`_actionAudit.js`** — add `'BILL_REFUNDED'` to `VALID_ACTIONS` (+ test).
- **`aggregateMonthlyRevenue.js`** — guard: exclude `status==='refunded'` from paid AND pending (and gross categories if cash-basis — **confirm exact summation by reading the file at build**, §verify-via-grep). Optional `refundedRevenue` bucket = defer.
- **`dashboard-reconcile.js`** — skip `status==='reversed'` slips + refunded bills (optional `refundedBills[]` bucket).
- **Admin UI `shared/dashboard-bill-refund.js`** — `window.refundBillPrompt()` mirrors void UI: read the paid bill (key normalized like server — §7-E/T), preview (amount/receiptNo/period), `ghPrompt` reason, `httpsCallable('refundBill')`, §7-I no auto-`.click()`. Wire `data-action="refundBill"` in the บิล payment modal footer (`dashboard-bill.js:~1068`) + `dashboard-main.js` hub + `<script src>` (no inline → no CSP drift §7-II).
- **Rules:** refund writes via CF/Admin SDK (bypasses rules); verifiedSlips already client-`write:false`. RTDB bill-write tightening = OUT (would need tracing every admin mark-paid client — §feedback_rule_tighten_trace_clients). Register `exports.refundBill` in `index.js`.
- **Tests:** CF unit (paid→refunded + slip reversed + BILL_REFUNDED row · idempotent re-refund=no-op · refund non-paid bill=rejected · atomic) + reconcile unit (reversed slip not orphaned) + aggregation unit (refunded excluded from paid&pending). Gate green pre-deploy.
- **Deploy:** money-flow → **user-confirmed** + `firebase use` prod + branch-before-deploy (§Critical rules). Owner live-verify (admin refunds a real paid test bill → status flips, audit row, revenue drops after re-aggregate).

### Decisions (✅ RESOLVED at approval 2026-06-03 — all = REC): D1 `status:'refunded'` · D2 points claw-back DEFERRED (before Phase 3.2) · D3 reuse verifiedSlips+audit (no new collection) · D4 full reversal only · D5 no auto re-aggregate.
1. **Refund semantics** — `status:'refunded'` = money returned, charge cancelled, excluded from revenue **[✅ CHOSEN — matches blueprint คืนเงิน, separate from void]** vs flip to `'pending'` = tenant still owes (chargeback/bounced).
2. **Points claw-back** — **(a) in-scope** (negative `pointsLedger` + decrement counters; keeps Trust-System data honest; ~+80 LOC Nest-only) vs **(b) deferred-named** (v1 = money + audit only) **[REC for a tight gate-first v1]**. Agent C flags (a) "critical" — your call.
3. **Refund record** — reuse `verifiedSlips` flip + `actionAudit` row, no new collection **[REC, mirrors void]** vs dedicated `refunds/{key}` register.
4. **Scope** — full reversal only **[REC v1]**; partial-amount deferred.
5. **Tax re-aggregate** — CF does NOT auto-trigger; admin re-runs / next 02:07 + §7-L fallback **[REC, minimal blast radius]** vs CF fire-and-forget re-aggregate.

### Guardrails
§7-NN (callable, never Firestore trigger — SE3) · §7-I (preview + explicit click, never auto-`.click()`) · §7-E (key off building/room/period + paidRef) · §7-T (grep writer+reader of new fields; slip `status` readers) · §7-J (no new index unless a query needs it; READY by state) · §7-Z N/A · §7-II (UI `<script src>` only → pre-commit §G confirms no CSP drift) · money-flow deploy user-confirmed + `firebase use` prod + branch check · one branch off fresh main, behind `validate.yml`.

### Deferred (named, not dropped)
- Points claw-back (if D2=b) · partial refunds · dedicated `refunds/` register (if D3=reuse) · RTDB bill-write rule tightening · tenant-facing refund status in tenant_app bill view · auto re-aggregation trigger · refund credit-note PNG.

### Review (2026-06-03/04 — BUILT on branch `feat/phase2-refund-flow`, gates green · ⏳ awaiting commit + deploy approval)
- **Backend:** `functions/refundBill.js` (onCall v1 SE1, admin-gated) — finds the paid bill by (building,room,year,month) like `markBillPaidInRTDB`; **audit-FIRST** (Firestore batch, deterministic `idempotencyKey=refund_{b}_{r}_{BE}{MM}`) then flips RTDB `bills/{b}/{r}/{billId}` → `status:'refunded'` + refundedAt/By/Reason (never deletes; keeps paidRef/receiptNo). Idempotent (already-refunded early-return). `BILL_REFUNDED` added to `_actionAudit.js` VALID_ACTIONS; registered in `index.js`. +14 unit tests.
- **Propagation:** `aggregateMonthlyRevenue.js` skips `status==='refunded'` (excluded from paid AND pending AND totals — the guard stops the else-branch inflating pendingRevenue) +1 test. `dashboard-reconcile.js` pairs a refunded bill's slip via `paidRef` (no orphan) + `refundedBills[]` bucket + summary `refunded`/`refundedAmount` + render section/card +2 tests.
- **Admin UI:** `shared/dashboard-bill-refund.js` `window.refundBillPrompt(roomId,year,month)` (BillStore preview → `ghPrompt` reason → `httpsCallable('refundBill')`, §7-I no auto-click). Refund button in the payment-modal paid-footer (`dashboard-bill.js`, `data-action="refundBill"` + data-id/year/month) + a refunded display state. Hub wire in `dashboard-main.js`. `<script src>` in `dashboard.html`.
- **Decisions (all REC, user-approved):** D1 `status:'refunded'` (excluded from revenue) · D2 points claw-back DEFERRED · D3 reuse verifiedSlips+audit (no new collection; slip NOT mutated — refund is a new fact, not a history rewrite) · D4 full-only · D5 no auto re-aggregate (next 02:07 / admin HTTP + §7-L fallback).
- **Gates:** node --check all · functions **1904/0** (+15) · test:shared **332/0** (+2) · verify:memory ALL GREEN (README CF-test-files 93→94) · mojibake clean (§7-TT) · CSP no drift (external `<script src>` only, §7-II) · audit:size ok.
- **§ guardrails held:** §7-NN callable not trigger · §7-I preview+explicit click · §7-E key off period+paidRef · §7-T refundReason/refundedAt written only by the CF, readers = bill modal + reconcile · §7-Z N/A.
- **Deferred (named):** points claw-back (before Phase 3.2) · partial refunds · manual-cash synthetic-slip orphan in reconcile (slip-paid path clean) · refund credit-note PNG · tenant-facing refund display.
- **⏳ Open (owner, money-flow §7-I/§7-J):** commit+push → deploy `refundBill` CF (user-confirmed, `firebase use` prod) → live-verify: admin refunds a real PAID test bill → modal shows คืนเงินแล้ว · `BILL_REFUNDED` row in audit panel · re-aggregate → that period's paidRevenue drops · reconcile shows it in the คืนเงิน bucket (slip not orphaned).

---

## ▶▶▶ ACTIVE PLAN (2026-06-03) — Roadmap Phase 2: Reconcile report (slip↔bill) · ✅ SHIPPED to branch (stacked on #241) · PR pending

**Scope:** roadmap Phase 2 "Reconcile report" — admin slip↔bill matched/unmatched view (bank-statement reconciliation basis). Home = **dashboard.html (admin)** per user choice — `verifiedSlips`/`manualReceipts` are admin-read-only, so no rules change (§7-rule-tighten).

### Verified data model (Explore)
Slips lack `billId`; but paid bills carry `paidRef` (=slip txId) + `manualReceipts` carry explicit `billId` → matching = `paidRef`→slip OR `manualReceipts[billId]` OR heuristic building+room+month+amount. Reuse `BillStore.listAllForYear`; read `verifiedSlips`+`manualReceipts` via `getDocs` (known schema, admin).

### Shipped
- `shared/dashboard-reconcile.js`: pure `computeReconciliation({bills,slips,manualReceipts})` → `{matched, unmatchedSlips, unmatchedPaidBills, mismatches, summary}` + `initReconcilePage` (year selector, §7-N error→UI, bounded reads with no-silent-cap log). +11 unit tests (vm sandbox).
- `dashboard.html`: nav + `#page-reconcile` + `<script src>`. `dashboard-main.js`: `_showPageImpl` wire. **HTML + external script only → NO CSP drift** (confirmed: csp-hashes.json unchanged).

### Gate
node --check ✓ · reconcile 11/11 ✓ · test:shared 330/330 ✓ · CSP no drift ✓.

### Deferred
explicit `billId` on `verifiedSlips` (audit-grade) — touches money-flow verifySlip CF; `paidRef` + heuristic enough for v1.

### Open (owner)
merge (after #240+#241) = Vercel deploy → live-verify on prod admin: open กระทบยอดสลิป → pick year → confirm matched / unmatched-slips / unmatched-paid-bills / mismatch buckets render (§7-J admin-gated — agent can't drive).

### Review
Shipped to branch `feat/phase2-reconcile-report`. Next Phase 2: refund flow · per-tenant arrears/aging.

---

## ▶▶▶ ACTIVE PLAN (2026-06-03) — Roadmap Phase 2: Revenue categories (`otherIncome` reconcile) · ✅ SHIPPED to branch (stacked on #240) · PR pending

**Scope:** roadmap Phase 2 "Revenue categories". **Re-scoped after data-reality check** (user-approved): pet fee + marketplace fee have NO charge field (grep 0) → can't be categories. The real gap = `aggregateMonthlyRevenue` sums only rent/elec/water/trash but `totalRevenue` = bill total (incl. `lateFee`/`other`/`common`) → the category breakdown doesn't reconcile to the total. Fix = add `otherIncome = max(0, total − rent − elec − water − trash)`.

### Shipped
- **CF** `aggregateMonthlyRevenue.js`: `otherIncome` in month + annual + byBuilding buckets (reconciling remainder) + JSDoc. +2 reconciliation tests (**30/30**).
- **Readers** `tax-filing.html`: report table gains an "อื่นๆ" column (header + per-room computed + total row); CSV export gains "รายได้อื่นๆ". **§7-L** compute-if-missing fallback (`data.otherIncome ?? max(0, total−sum4)`) so pre-existing taxSummary docs reconcile without re-aggregation.
- CSP regen (§7-II — tax-filing.html inline changed). `lifecycle_tax_filing.md` schema + verifier updated.

### Deferred (no data — named, not dropped)
pet fee / marketplace fee as distinct categories — need upstream fee-capture (no `charges.petFee`/commission field exists). `other`/`common`/`lateFee` all roll into `otherIncome` for now.

### Gate
node --check ✓ · CF tests 30/30 ✓ · mojibake 0 ✓ · CSP regen ✓ · stacked on #240 → clean separate diff (+58/−17).

### Open (owner)
merge (after #240) = Vercel deploy → optionally re-run `aggregateMonthlyRevenue` HTTP (admin) to persist `otherIncome` into existing taxSummary docs (client fallback covers the read meanwhile); live-verify report table + CSV show อื่นๆ reconciling to รวม.

### Review
Shipped to branch `feat/phase2-revenue-categories`. Discovery: the roadmap's 3 named categories were ~⅓ buildable (pet/marketplace fee = no data); delivered the achievable reconciliation (`otherIncome`) + named the deferred. Next Phase 2: reconcile report · refund flow · per-tenant arrears/aging.

---

## ▶▶▶ ACTIVE PLAN (2026-06-03) — Roadmap Phase 2: Remove dead 15%-corporate tax path · 🚧 EXECUTING (branch `feat/phase2-remove-dead-corporate-tax`)

**Scope:** roadmap Phase 2 "Remove dead 15%-corporate path". Pivoted here from "Thai-font PDF" — the Sarabun jsPDF patch's ONLY live consumers are the corporate text-PDF exports targeted here, so this PR retires BOTH roadmap items. Goal: kill auditor-confusing corporate forms (ป.พ.6 quarterly + ภ.ป.ภ.50 annual + 15% flat calc) that contradict the live personal **ภ.ง.ด.90 progressive** model.

### Verified this session (grep + read, file:line — §7-EE checked)
- **Override = wholesale replacement** (`tax-filing.html:1145/1159/1170`): `window.calculateXIncomeTax = progressive ภ.ง.ด.90`, never calls original, `rate` param ignored → 15% bodies (`tax-filing.js:416/450/504`) DEAD at runtime.
- **§7-EE:** bareword calc callers (`generateMonthlyTaxReport:550`, `loadTaxDashboard:909`) resolve to `window.X` = override → progressive. Live path confirmed not-15%.
- **Sarabun patch vestigial:** only live jsPDF on page = `downloadCurrentReportAsPDF:1762` (html2canvas → addImage, no `.text`/`.autoTable`). Deleting corporate text exports leaves no Thai-text jsPDF consumer → patch + jsdelivr fetch removable (closes Thai-font item).
- `calculateQuarterlyIncomeTax` callers = only `generateQuarterlyReturn:616` + `getQuarterlyBreakdown:874` (both deleted) → orphan → delete.
- **KEEP (shared/live):** `calculateMonthlyIncomeTax`+`calculateAnnualIncomeTax` (seed + override — live via §7-EE; dashboard KPI `:909`) · `getFullYearExpenseBreakdown` (dashboard chart `:1006`) · `formatCurrency`/`_getOwnerForPDF`/`showError`/`showSuccess` (monthly Excel + overridden) · all monthly funcs + `downloadCurrentReportAsPDF` + `exportMonthlyReportExcel` + `estimateThaiPersonalTax`.

### DELETE (Option 1 — forms-only, minimal-blast-radius)
- **tax-export.js:** `exportQuarterlyReturnPDF` · `exportAnnualReportPDF` · `exportAnnualReportExcel` · orphaned `exportMonthlyReportPDF` (§7-K) · `_addPDFLetterhead` (only dead callers).
- **tax-filing.js:** `calculateQuarterlyIncomeTax` · `generateQuarterlyReturn` · `displayQuarterlyReturn` · `generateAnnualReport` · `displayAnnualReport` · `getQuarterlyBreakdown` + **export-manifest entries `:1850/:1853/:1854`** (⚠️ object literal refs deleted names → remove same edit or ReferenceError).
- **tax-filing.html:** quarterly-page · annual-page · sidebar quarterly+annual · dashboard shortcuts · dispatch handlers (5 branches) · quarterly override + Sarabun font patch + jsdelivr fetch (`:1170-1247` contiguous).
- **KEEP** monthly/annual income-tax overrides (`:1145-1169`) — live.

### Gate (pre-deploy)
`node --check` both JS · re-grep **0 dangling callers** of every deleted name · re-grep **no other `.text(`/`.autoTable(`/`new jsPDF`** in tax-filing.html before removing patch · `test:shared` + functions + `verify:memory` green · **§7-II CSP regen** (tax-filing.html inline `<script>` changed → `npm run csp:hash && node tools/update-vercel-csp.js` same commit; pre-commit §G confirms).

### Guardrails
§7-II CSP regen · §7-K verify 0 callers · §7-EE keep monthly/annual calc seeds · minimal-blast-radius · owner live-verify (auth-gated tax page, §7-I): monthly report + dashboard KPI still render via override; quarterly/annual pages + sidebar gone; monthly PDF export still works.

### Review (2026-06-03 — SHIPPED to branch · PR #240 · ⏳ awaiting merge=deploy)
- **PR [#240](https://github.com/soulgroundliving/the-green-haven/pull/240)** (`444634d`, −1201/+35) — removes the dead 15%-corporate path AND retires the now-vestigial Sarabun jsPDF patch → **closes the "Thai-font PDF" roadmap item too** (both in one PR).
- **Removed:** tax-export.js (3 jsPDF exports + orphaned `exportMonthlyReportPDF` + `_addPDFLetterhead`) · tax-filing.js (`calculateQuarterlyIncomeTax` + generate/display Quarterly+Annual + `getQuarterlyBreakdown` + manifest entries) · tax-filing.html (quarterly/annual pages, sidebar, shortcuts, dispatch, quarterly override + Sarabun patch + jsdelivr fetch, orphaned `fillYearSelect('annual-year')`).
- **Kept (live):** monthly report (html2canvas PDF — Thai via CSS `font-family:Sarabun` web font + Excel), dashboard KPI, monthly/annual calc seeds + progressive overrides (§7-EE), `getFullYearExpenseBreakdown`.
- **Gates:** node --check ✓ · 0 dangling callers (grep) ✓ · test:shared 319/319 ✓ · verify:memory green ✓ · CSP regen §7-II ✓ · pre-commit all green.
- **Discovery:** the roadmap's "Thai renders as boxes" premise was already false — a Sarabun jsPDF patch existed + worked (jsdelivr 200 + CSP `connect-src https:` ok); its ONLY consumers were the corporate forms removed here. Monthly PDF was always html2canvas (Thai-safe).
- **Architecture doc:** `lifecycle_tax_filing.md` updated (3 pages, monthly-only exports, no jsPDF patch; verifiers fixed — old line-166 OR-grep was a §7-J trivially-passing trap masking 3 dead terms via surviving `AuditLogger.log`).
- **⏳ Open:** merge = Vercel deploy (live tax page → user-confirm) → owner live-verify (auth-gated, §7-I — agent can't drive): dashboard + monthly report render via override; sidebar = Dashboard/รายงานเดือน/หัก ณ ที่จ่าย/เช็คลิสต์ only; monthly PDF Thai intact.
- **Phase 2 remaining:** refund flow · per-tenant arrears/aging · revenue categories · reconcile report · ~~Thai-font PDF~~ (resolved here).

---

## ▶▶▶ ACTIVE PLAN (2026-06-02) — Roadmap Phase 1.4: ToS + Privacy consent + DSR wiring · ✅ ALL SLICES SHIPPED + DEPLOYED (A #236 · B #237 · C1 #238 · C2 #239) — see Review below

**Scope:** the PDPA + investor-facing gap from `core-readiness-roadmap.md` §1.4. **3 slices, gate-first (3 PRs, each behind `validate.yml`)** — user-chosen 2026-06-02. **ToS = scaffold + placeholder** (I build the page structure + standard headings + clearly-marked placeholders; the owner/lawyer fills the legal text — I do NOT fabricate legal wording).

### Verified state (3 Explore agents, grep-checked this session — incl. stale-roadmap corrections)
- **Consent infra exists + reusable:** `recordChecklistConsent.js` (v1 onCall SE1, `_authSoT` tenant-gated) writes `consents/{tenantId}_{purpose}` `{tenantId,authUid,room,building,purpose,noticeVersion,consentedAt,userAgent}`; `VALID_PURPOSES = Set(['checklist_v1'])` (`:25`), registered `index.js:218`. Rule `consents/` (`firestore.rules:721-732`) = admin-read OR tenant authUid/tenantId match · write:false → **a new purpose needs NO rule change.** ⚠️ **No `consents` describe block in `firestore.rules.test.js`** → must ADD rules tests.
- **`privacy.html` = a REAL PDPA policy** (5 sections, effective 1 พ.ค. 2568) but **linked from NOWHERE** (login/index/booking/tenant_app = 0 refs, grep-confirmed). ⚠️ `dashboard.html` has an admin editor `policy-admin-privacy` → **verify whether privacy.html renders STATIC HTML or loads admin-edited text before editing the data-inventory** (else the fix belongs in the editable source).
- **No legal ToS exists** — tenant_app `cleaning-terms-page` (`:3198`) is a cleaning-service manual, not ToS.
- **`exportMyData` (DSR §30) = confirmed §7-K orphan** (0 callers). v1 onCall SE1, `_authSoT` tenant-scoped, returns a full JSON (person/tenant/lease/liffUser/checklists/consents/complaints/maintenance/bills; storage paths listed, not inlined). `index.js:221`.
- ⚠️ **ROADMAP STALE — national ID:** the ID *number* is NOT collected anywhere. What IS collected (undisclosed in privacy.html): **ID-card PHOTOS** (`idCardFront`/`idCardBack`, required), `houseReg`, `employmentLetter` → Storage `bookings/{id}/kyc/` (`submitBookingKyc.js`), + `prospectLineId`. The data-inventory fix discloses THOSE.
- **Consent-gate auth nuance:** booking prospects are anonymous (no room claim) until `createBookingLock` → they CANNOT call `recordChecklistConsent` (`_authSoT` needs tenant claims). So booking consent must be recorded **in `createBookingLock`** (prospect context); tenant first-run consent uses `recordChecklistConsent` (new purpose, tenant has claims).

### Slice A — link privacy + ToS scaffold + data-inventory fix (PR A, content-only, lowest risk)
- [ ] **`terms.html`** (new, NOT in the CSP-tracked 8) — ToS scaffold mirroring `privacy.html` structure (muji-minimal): standard headings (acceptance · service desc · tenant obligations · payment · liability · termination · governing law · contact) with **`[รอข้อความจริง — …]` placeholders**. *Why scaffold:* legal text is the owner's/lawyer's; I wire the plumbing, not the wording.
- [ ] **`privacy.html` data-inventory fix** — add the collected-but-undisclosed items (ID-card photos front/back, house registration, employment letter, LINE User ID) to the "ข้อมูลที่เราเก็บ" section (`:203-235`). *Why:* PDPA data-inventory must match what's actually collected (`submitBookingKyc.js`). **First verify static vs admin-editable** (the `policy-admin-privacy` editor).
- [ ] **Link privacy.html + terms.html** from `login.html` / `index.html` / `booking.html` (footer) + tenant_app `page-privacy`/settings. *Why:* PDPA §19 needs the notice reachable; investor-facing. **CSP: `<a href>` is markup, no inline-block change → no hash drift** (§7-II) — confirm with the pre-commit §G check.
- [ ] Live-verify links resolve on Vercel (3 entry pages + tenant_app).

### Slice B — DSR `exportMyData` wiring (PR B, closes the §7-K orphan) · ✅ BUILT
- [x] **`shared/tenant-data-export.js`** → `window.exportMyDataPrompt()`: `httpsCallable('exportMyData')({})` → Blob (NOT `data:` — §7-Y) → `<a download>` `nature-haven-my-data-{date}.json`. §7-N error→`window.toast`. **Self-wires** the menu item by id (click + Enter/Space a11y) — does NOT touch the inline delegation hub (5420), so no CSP drift.
- [x] **`tenant_app.html` settings** (`.menu-list` `:4067`) — a "ดาวน์โหลดข้อมูลของฉัน (JSON · PDPA §30)" menu-item (`id="btn-export-my-data"`, role=button/tabindex) beside the Privacy Policy item. **No `data-action`** (self-wired, not hub) → avoids editing the inline hub.
- [x] **`<script src>`** `./shared/tenant-data-export.js` (defer, after tenant-cleaning). §7-K orphan closed (grep: caller now at `tenant-data-export.js:26`). **CSP: markup + external src only → no drift** (pre-commit §G to confirm).
- [ ] **Deferred / owner:** §30 wording self-service mention belongs in `system/policies.privacy` (admin-edited in-app copy, dashboard Policies tab) — not the static embedded FAQ (it's overwritten by the SSoT). Standalone privacy.html §30 left as-is.
- [ ] Live-verify (owner, §7-A — agent can't drive LIFF): tenant opens Settings → ดาวน์โหลด → JSON file of own data only. (LIFF webview `<a download>` — confirm it triggers; fallback if blocked.)

### Slice C — consent acceptance gate (PR C)
- [x] **Booking gate (prospect, blocking)** [C2 #239] — `booking.html` Step 2 modal: a required "ยอมรับ [นโยบายความเป็นส่วนตัว] + [ข้อตกลงการใช้งาน]" checkbox (links to privacy/terms) gating the lock button. Record consent **in `createBookingLock`** (the CF where prospect identity exists — NOT recordChecklistConsent, which needs tenant claims): persist `consentAcceptedAt`/`consentVersion` on the `bookings/{id}` doc. *Why here:* prospect is anonymous pre-lock; the booking doc is the consent record-of-proof. ⚠️ **CSP: the Step-2 submit handler is inline script in booking.html → editing it drifts the hash → `npm run csp:hash && node tools/update-vercel-csp.js` in the same commit (§7-II).**
- [x] **Tenant first-run gate (info)** [C1 #238] — a one-time consent acknowledgment in `tenant_app.html` (hook the existing `GhTour`/first-run, localStorage-gated) → `recordChecklistConsent({purpose:'account_v1', noticeVersion})` (add `'account_v1'` to `VALID_PURPOSES`). §7-A claims-gated. *Why:* demonstrable ongoing-use consent for existing tenants (PDPA §19).
- [x] **`recordChecklistConsent.js`** [C1 #238] — added `'account_v1'` to `VALID_PURPOSES` (+ unit test). **`firestore.rules.test.js`** — ADDED a `consents` describe block (admin read-all · tenant authUid/tenantId-claim read own · cross-tenant denied · client write/update/delete denied) — 271/0 total (README 249→256).
- [ ] Live-verify (owner): booking submit writes `consentAcceptedAt`; tenant first-run writes `consents/{tenantId}_account_v1`.

### Decisions to confirm (at approval)
1. **Tenant first-run consent purpose name** — `account_v1` **[proposed]** vs `tos_privacy_v1` / `terms_v1`.
2. **Booking consent storage** — on the `bookings/{id}` doc via `createBookingLock` **[recommended — prospect has no tenant claim]** vs a separate `consents/` row (needs an anon-callable variant).
3. **ToS reachability** — standalone `terms.html` **[recommended, mirrors privacy.html]** vs a `page-terms` section inside tenant_app.

### Guardrails
§7-I (no auto-`.click()`) · §7-A/§7-U (tenant gates via `_onLiffClaimsReady` + claim guard; live-verify on real LINE) · §7-K (wire exportMyData = close the orphan) · §7-T (consent writer+reader) · §7-II (**Slice C booking.html inline-handler → CSP regen**; Slice A/B markup+external only → no drift) · §7-Z N/A · gate-first A→B→C, each behind `validate.yml` · ToS legal text is owner-supplied (scaffold only).

### Review (2026-06-02 — ALL SLICES SHIPPED + DEPLOYED)
- **A** (PR [#236](https://github.com/soulgroundliving/the-green-haven/pull/236) `7ba1905`): `privacy.html` KYC-photo data-inventory + `terms.html` scaffold (placeholders — owner fills legal) + `login.html` `.page-legal-footer` → privacy/terms. Content-only, no CSP drift.
- **B** (PR [#237](https://github.com/soulgroundliving/the-green-haven/pull/237) `a8556fb`): `shared/tenant-data-export.js` `window.exportMyDataPrompt()` (httpsCallable → Blob → `<a download>`) + Settings menu item — closes the §7-K `exportMyData` orphan. Self-wired, no CSP drift.
- **C1** (PR [#238](https://github.com/soulgroundliving/the-green-haven/pull/238) `13eca99`): tenant first-run `account_v1` consent — `recordChecklistConsent` VALID_PURPOSES + `shared/tenant-consent.js` (`window.maybePromptAccountConsent`, GhModal + localStorage + fire-and-forget; **self-wired via `window._onLiffClaimsReady` → no CSP drift**, `<script src>` only) + `consents` rules describe block. CF deployed; prod probe → UNAUTHENTICATED.
- **C2** (PR [#239](https://github.com/soulgroundliving/the-green-haven/pull/239) `dd74681`): booking-prospect gate — `booking.html` Step 2 required `#modalConsent` checkbox (privacy+terms links) gating the lock + `createBookingLock` enforces `consentAccepted===true` for prospects (admin exempt) + persists `consentAcceptedAt`/`consentVersion` on `bookings/{id}`; +4 CF tests; CSP regen (booking inline `<script>`/`<style>` changed). Money-flow CF deployed; prod probe → UNAUTHENTICATED.
- **Decisions taken (as approved):** purpose `account_v1` · booking consent on the `bookings/{id}` doc (prospect has no tenant claim) · ToS = standalone `terms.html`.
- **Gates:** functions 1886/0 · rules 271/0 (README 249→256) · shared 319/0 · verify:memory 0 fail · CSP in sync (pre-commit §G). Both CF prod deploys success (deploy-functions.yml).
- **Sequencing-safe deploy:** C1 then C2 (disjoint files; C1 had no CSP change → no cross-drift). Each merged on green CI; Vercel ships the client before the CF lands so no broken window.
- **Open (owner live-verify, §7-A/§7-I — agent can't drive LIFF / the booking money flow):** ① tenant first-run → GhModal → ยอมรับ → `consents/{tenantId}_account_v1` row written. ② booking Step 2 → checkbox required → lock → `bookings/{id}.consentAcceptedAt` set. ③ fill `terms.html` legal text + mirror KYC disclosure into `system/policies.privacy` (dashboard Policies tab) for the in-app copy.
- **Architecture docs:** lifecycle_pdpa_checklist (account_v1 + booking consent + exportMyData self-serve restore) + lifecycle_booking_flow (consent fields) + handoff next_session_handoff_2026_06_02_phase_1_4_pdpa.
- **Next (roadmap):** Phase 2 — accountant FAQ (refund / arrears-aging / revenue-categories / reconcile / Thai-font-PDF).

---

## ▶▶ ACTIVE PLAN (2026-06-02) — Roadmap Phase 1.2 (gapless INVOICE number `INV-`) + 1.3 (void bill with trail) · ✅ SHIPPED + DEPLOYED (PR #235 `d5c15c6`) — see Review below

**Scope:** the next two tax blockers from `core-readiness-roadmap.md` (recommended order step 3). They are **coupled** ("shared bill-issuance refactor"): both need a *persisted invoice document-of-record*, which **does not exist today** on the primary path. Phase 1.2 mints a gapless sequential `INV-{building}-{BE}-{NNNNN}` at issuance + persists the record; Phase 1.3 voids that record (state, not delete) with an audit row. Forward-only. Receipt (`RCP-`) is already done (1.2a) — this is the *invoice* (ใบแจ้งหนี้) side.

### Verified architecture (3 Explore agents + 4 direct reads, grep-checked this session — reconciled against memory)
- **`generateBillsOnMeterUpdate` writes a bill in its body BUT is FROZEN — never fires in prod** (Eventarc does not support SE3-Jakarta Firestore; confirmed by the CF's own sibling comment `notifyTenantOnMeterUpload.js:12-15` + `generate_bills_cf_frozen.md` + §7-NN). So in production the **primary path persists NO bill record.**
- **Primary issuance flow (the 95% path):** admin approves meter import → `approvePendingImportWithFirebase` (`dashboard-meter-import.js:707`) writes `meter_data` (Firestore) + calls **`notifyTenantOnMeterUpload`** (callable, SE1, admin-gated, **per-room** `docId`, already idempotent via `meter_data.notifiedAt`) → that CF computes the bill on-the-fly from `meter_data`+`rooms_config` and sends a LINE Flex **"ใบแจ้งหนี้"**. **Persists nothing but `notifiedAt`.**
- **Current invoice "numbers" — all 3 ad-hoc, none gapless/persisted:** `_billFlex.js:167` `INV-{initial}{room}-{YYMM}` (LINE Flex, computed every send, collisions) · `dashboard-bill.js:440` + `:1224` `TGH-{yr}{mo}-{room}-{MMSS}` (minute+second of click, print only, persisted as `billId` ONLY at mark-paid) · `invoice-receipt-manager.js:21/65` (**§7-K orphan — 0 callers**).
- **`batchSendInvoices` (`dashboard-bill.js:1233`) is cosmetic** — loops unpaid rooms calling `logBillGenerated` (localStorage audit) only; **sends no LINE, persists no bill.** Not a real issuance moment.
- **Only persisted financial docs today:** Firestore `verifiedSlips/{txId}` + `manualReceipts/{key}` (both carry `RCP-` from 1.2a) + RTDB `bills/{b}/{r}/{billId}` (written ONLY at mark-paid = payment time, `dashboard-bill-payment-status.js:193` full-replace). **No hard-delete of bills exists** (grep: 0 `.remove()` on `bills/`); overwrite-in-place only.
- **Reusable 1.2a infra:** `_receiptCounter.js` `assignReceiptNo(tx,db,{building,be})` → `counters/receipt_{building}_{BE}` `{seq,...}` atomic `runTransaction`, format `RCP-{building}-{BE}-{NNNNN}` (5-pad). **`'receipt'`/`'RCP-'`/`'receipt_'` are hardcoded** → write a sibling `_invoiceCounter.js` (agent rec: don't generalize the money-flow counter). `assignReceiptNumber.js` = admin callable + deterministic idempotent `manualReceipts/{b}_{r}_{billId}` (re-call = same number). Rules pattern `counters|manualReceipts|actionAudit`: `read: if isAdmin(); write: if false;` (`firestore.rules:759/772/782`).
- **Audit infra (Phase 1.1, shipped):** `_actionAudit.js:53` `VALID_ACTIONS = {TENANT_UPDATED, PAYMENT_VERIFIED, BILL_PAID_MANUAL, METER_IMPORT_APPROVED}` — **no `BILL_ISSUED`/`BILL_VOIDED` yet.** `appendActionAudit(writer, fs, payload)` writes in-tx (verifySlip pattern); `recordAdminAction` callable server-stamps actor/role/ip/at. `BILL_DELETED` exists only in legacy localStorage `audit.js:271` (0 callers, §7-K).

### Design — introduce a persisted invoice document-of-record (`invoices/`, Firestore)
- **Home:** Firestore `invoices/{building}_{room}_{YYYYMM}` (deterministic key → re-notify is idempotent, never burns a 2nd number). Body: `{ invoiceNo, building, room, period (YYYYMM), be, status: 'issued'|'paid'|'void', amount, charges (snapshot from meter_data at issuance), issuedAt, issuedBy, reissueOf?, voidedAt?, voidedBy?, voidReason? }`. *Why Firestore not RTDB:* matches counters/receipts/audit; admin-queryable for reconciliation; same `write:false` rule family.
- **Counter:** sibling `_invoiceCounter.js` → `counters/invoice_{building}_{BE}` atomic increment → `INV-{building}-{BE}-{NNNNN}`. *Why per-building + sibling:* mirrors 1.2a exactly; avoids re-touching the receipt counter that verifySlip depends on (minimal blast radius).
- **Gapless invariant:** number minted in the SAME `runTransaction` as the `invoices/` doc create + the `BILL_ISSUED` audit row → a re-notify / failed write never gaps the sequence (deterministic key = get-or-return).

### PR A — Phase 1.2: invoice counter + persisted issuance record (branch `feat/phase1-2-invoice-number`) · ✅ BUILT + PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235) `0f1e3a5` — gates green, ⏳ awaiting merge=deploy (user-confirmed)
- [x] **`functions/_invoiceCounter.js`** — sibling of `_receiptCounter.js`: `assignInvoiceNo(tx, db, {building, be})` + `formatInvoiceNo()`; `counters/invoice_{building}_{BE}`, `docType:'invoice'`, `INV-{building}-{BE}-{NNNNN}`. +9 unit tests.
- [x] **Mint + persist at the real issuance moment** — `notifyTenantOnMeterUpload.js` `issueInvoiceNo()`: `runTransaction` get-or-mint (dedup read → `assignInvoiceNo` → `invoices/{building}_{room}_{period}` set `status:'issued'`+charges snapshot → `BILL_ISSUED` audit). Minted AFTER the no-approved-tenant guard, non-fatal. `be = bill.year` (already 4-digit BE — §7-E-safe). auditActor server-stamped from `request.auth`.
- [x] **`_actionAudit.js`** — `BILL_ISSUED` added to `VALID_ACTIONS`.
- [x] **Display** — `_billFlex.js buildBillFlex`: uses `opts.invoiceNo`, falls back to legacy ref for callers that don't pass one (§7-T).
- [x] **Rules** — `firestore.rules` `match /invoices/{id}` admin-read / `write:false` + counters comment covers `invoice_`. +6 rules tests.
- [x] **Index** — `firestore.indexes.json` `invoices` (`building` ASC, `period` DESC).
- [x] **Tests** — gapless/consecutive/re-notify-idempotent/no-mint-without-tenant/non-fatal. Gates: **functions 1871/0 · rules 264/0 · verify:memory 482/0** (+ README counts 243→249, 91→92).
- [ ] **Merge=Deploy** (⚠️ merge auto-fires deploy-functions.yml CF + deploy-rules.yml — money-adjacent → user-confirmed; §branch-before-deploy + `firebase use` prod check) + **live-verify** (real meter import → tenant LINE shows `INV-rooms-2569-00001`; re-import same room → same number; `invoices/` doc persisted; §7-J/§7-I — owner drives LIFF).

### PR B — Phase 1.3: void invoice with trail (same branch `feat/phase1-2-invoice-number` → PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235), deploy 1.2+1.3 together per user) · ✅ BUILT — gates green
- [x] **`_actionAudit.js`** — `BILL_VOIDED` added to `VALID_ACTIONS`.
- [x] **`functions/voidInvoice.js`** — admin callable (v1, SE1, §7-NN): `runTransaction` flips `invoices/{key}.status='void'` + `voidedAt/voidedBy/voidReason` + `appendActionAudit('BILL_VOIDED')` (server-stamped actor/role/ip, before/after snapshot), all atomic. **Never deletes / overwrites.** Idempotent (already-void early-return). `index.js` registered. +10 unit tests.
- [x] **Void invariant in issueInvoiceNo** — a re-notify of a VOIDED period does NOT silently reuse its number (returns null → Flex falls back to legacy ref). +1 test. *Re-issue (deliberate new INV-) deferred — see below.*
- [x] **Admin UI** — `shared/dashboard-invoice-void.js` `window.voidInvoicePrompt()`: reads the persisted `invoices/{key}` for the room/period the admin is billing (`window.invoiceData`, key normalized identically to the server — §7-E/§7-T safe), **previews + requires a reason (ghPrompt) → explicit user action** (§7-I, no auto-`.click()`), calls `voidInvoice`. Button `data-action="voidInvoice"` in the บิล doc panel + delegation-hub wire (`dashboard-main.js`) + `<script src>` (no inline → no CSP drift, §7-II).
- [x] **Gates:** functions **1882/0** (+11) · test:shared 319/0 · node --check all clean.
- [ ] **Live-verify (owner, post-deploy):** admin voids a real issued invoice → `invoices/{key}.status='void'` + `BILL_VOIDED` row in the dashboard audit panel + original preserved; re-notify of a voided period does not resurrect the number (§7-I/§7-J).

### Deferred (named, not dropped) — Phase 1.3 follow-up
- [ ] **Deliberate re-issue** — a corrected invoice for a voided period (new `INV-` number, `reissueOf` → voided, distinct doc) as an explicit admin action. Deferred because auto-re-issue-on-renotify interacts subtly with the deterministic-key dedup; the void invariant (no silent reuse) is the safe v1 floor. The void event is preserved in `actionAudit` regardless.
- [ ] **In-app invoiceNo display** in tenant_app bill view + dashboard grid (the LINE Flex already shows it).

### Decisions to confirm (at approval)
1. **Issuance anchor — KEY DECISION.** Mint the invoice number automatically inside `notifyTenantOnMeterUpload` (every tenant who *receives* an invoice gets a gapless number — tax-correct "issued = sent", server-side, idempotent) **[RECOMMENDED]** — vs. an explicit admin "ออกเลขใบแจ้งหนี้" button (manual control, but the primary flow is auto-notify so most invoices would stay unnumbered unless the admin also clicks). The recommendation re-touches the notify CF (gated by tests + staged deploy).
2. **Counter scope** — per-building `counters/invoice_{building}_{BE}`, resets each BE year (matches 1.2a `RCP-`) **[RECOMMENDED]** vs one global series.
3. **Migration** — forward-only (numbers start now; past synthesized bills stay unnumbered) **[RECOMMENDED, matches 1.2a]** vs backfill historical `meter_data`/`verifiedSlips` by date order.

### Guardrails
§7-NN callable not trigger (SE3) · §7-I no auto-`.click()` on void · §7-J index READY by state (seed 1 doc) · §7-T grep writer+reader of `invoices.invoiceNo` before wiring readers · §7-Z N/A (no new claims) · money-adjacent CF deploy user-confirmed + `firebase use` prod check (1.2a lesson) · §7 tx-mock gotcha when re-touching `notifyTenantOnMeterUpload` tests · gate-first: PR A then PR B, each behind `validate.yml`.

### Deferred (named, not dropped)
- **In-app invoiceNo display** in tenant_app bill view + dashboard grid (readers of the synthesized bill) — follow-up after the LINE Flex shows it (§7-T: wire readers once the writer is stable).
- **Manual-path invoice persistence** (`saveBillToFirebase`/`batchSendInvoices`) — the primary path covers 95%; fold the manual path in as fast-follow if needed.
- **Retire the 3 ad-hoc schemes** (`dashboard-bill.js:440/:1224` TGH-, orphan `invoice-receipt-manager.js`) once the persisted `invoiceNo` is the single source.

### Review (2026-06-02 — SHIPPED + DEPLOYED)
- **Shipped + deployed to prod:** PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235) (`d5c15c6`, squash of `0f1e3a5` 1.2 + `6fbd524` 1.3). Prod deploy all green (Deploy CF 3m38s · Deploy Rules 1m23s · Firebase Rules · E2E). User chose: build 1.3 first, deploy 1.2+1.3 together, staging-green before merge.
- **1.2:** `_invoiceCounter` → `INV-{b}-{BE}-{NNNNN}` minted in `notifyTenantOnMeterUpload.issueInvoiceNo` + persisted `invoices/{b}_{r}_{period}` doc-of-record + `BILL_ISSUED` audit + Flex shows the number. **1.3:** `voidInvoice` CF (status:void + `BILL_VOIDED`, never deletes, idempotent) + void invariant + admin void UI (`dashboard-invoice-void.js`).
- **Decisions taken:** issuance anchor = auto-mint in notify CF · per-building counter · forward-only (all RECOMMENDED, user-approved).
- **Gates:** functions 1882/0 · rules 264/0 · test:shared 319/0 · verify:memory 505/0 · README counts. Prod probe: `voidInvoice`→UNAUTHENTICATED, notify→PERMISSION_DENIED.
- **Deferred (named):** deliberate re-issue (new INV- + `reissueOf`) · in-app invoiceNo display · manual-path persistence · retire the 3 ad-hoc schemes.
- **Open (owner live-verify, §7-I/§7-J):** real meter import → `INV-…00001`; re-import → same; admin void → `BILL_VOIDED` row + status:void; voided period not resurrected on re-notify.
- **Architecture doc:** `memory/lifecycle_invoice_numbering.md` (grep-backed) + handoff `memory/next_session_handoff_2026_06_02_phase_1_2_1_3_invoice.md`.

---

## ▶ ACTIVE PLAN (2026-06-02 PM) — Roadmap 1.2a: Gapless RECEIPT number (`RCP-`) · ✅ PR 1.2a-1 (slip #233) + 1.2a-2 (cash #234) SHIPPED + DEPLOYED · ⏳ PR 1.2a-2b (saveBillToFirebase Path-2 + jsPDF) deferred

**Scope (user-chosen 2026-06-02):** Receipt-first. Gapless `RCP-{building}-{BE}-{NNNNN}` (per-building, resets each BE year) assigned atomically at payment confirmation, persisted, displayed. Forward-only migration. **Invoice numbers = separate 1.2b (deferred)** — the primary bill path (meter import) writes no persisted record, so invoice numbering needs its own design.

**✅ PR 1.2a-1 SHIPPED + DEPLOYED 2026-06-02** ([#233](https://github.com/soulgroundliving/the-green-haven/pull/233) `c306ec6`): counter helper + verifySlip `batch→runTransaction` (dedup + gapless number + audit atomic, no-burn-on-dup) + `counters` rule + Flex display. Gates: functions 1848/0 · rules 254/0 (CI emulator) · verify:memory 482/0 · staging + **prod CF + rules deploy success**. Open: owner live-verify (real slip → `RCP-rooms-2569-00001`, consecutive, no dup number). → [[lifecycle_verifyslip]] §5.

### Verified architecture (3 Explore agents + `billing_monthly_flow.md`, grep-checked)
- `generateBillsOnMeterUpdate` **DEAD** (Eventarc SE3 gap, frozen tombstone) — CANNOT anchor a number there.
- `meter_data` = SoT; **bills are derived views**; Path 1 (meter import, primary) writes **NO** bill record. Only persisted payment records: Path 2 manual `saveBillToFirebase`→RTDB (`dashboard-bill.js:1121`) + **payment → `verifiedSlips/{transactionId}`** (verifySlip CF, just refactored PR 1b).
- Tax aggregation (`aggregateMonthlyRevenue`) ignores doc numbers (sums by amount/month) → renumber is tax-safe. ✅
- Receipt-issuance moments: **(1) verifySlip** (slip, all buildings, server CF) · **(2) manual mark-paid** (cash, client `markBillPaid`/`saveBillToFirebase`).

### Design
- **Counter:** Firestore `counters/receipt_{building}_{BE}` `{ seq, updatedAt }`, atomic `runTransaction` increment. Format `RCP-{building}-{BE}-{NNNNN}` (5-digit pad).
- **Gapless invariant:** the number is assigned in the **SAME transaction** as the payment-record write, so a duplicate/failed payment never burns a number (no gap).

### PR 1.2a-1 — counter infra + verifySlip slip-receipt (primary path)
- [ ] **Counter helper** `functions/_receiptCounter.js` — `assignReceiptNo(tx, db, {building, be})`: `tx.get(counterRef)` → `seq+1` → `tx.set` → return `RCP-…`. *Why:* gapless requires a serialized atomic increment inside the caller's tx.
- [ ] **verifySlip** — convert `saveVerifiedSlip` **batch → `runTransaction`**: `tx.get(slipRef)` dedup (exists → duplicate, **counter untouched → no gap**) + `assignReceiptNo` + `tx.set(slipRef, {…, receiptNo})` + `appendActionAudit(tx,…)` + counter set, all atomic. *Why:* dedup + number + audit must commit together; a dup must not consume a number. ⚠️ **re-touches the PR 1b money-flow CF** — staged + user-confirmed deploy.
- [ ] **Persist** `receiptNo` on `verifiedSlips/{transactionId}` + mirror into RTDB bill via `markBillPaidInRTDB` (`bills/{b}/{r}/{billId}/receiptNo`). *Why:* one immutable source; readers display, never recompute.
- [ ] **Rule** `firestore.rules` — `counters/*` read:admin, write:false (CF/Admin-SDK only). + `npm run test:rules`.
- [ ] **Display** — `functions/_billFlex.js buildReceiptFlex` (:240): use the passed persisted `receiptNo` instead of the computed `RCP-${initial}${room}-${YYMM}`. *Why:* kill the ephemeral collision-prone scheme; show the gapless number on the LINE receipt.
- [ ] **Tests** — counter gapless increment; two concurrent verifies → consecutive numbers, no dup/gap; duplicate slip burns no number; `receiptNo` on slip + Flex. Mind the §7 tx-mock gotcha (the new tx needs `get`/`set` + `counters`/`actionAudit` branches). Keep functions 1835 green.
- [ ] **Deploy** (money-flow, user-confirmed; §branch-before-deploy + `firebase use` prod) + **live-verify** (real slip → `RCP-` on receipt + persisted; duplicate → no new number).

### PR 1.2a-2 — manual cash mark-paid receipt number (closes the gap) · ✅ SHIPPED + DEPLOYED ([#234](https://github.com/soulgroundliving/the-green-haven/pull/234) `71b2fdc`)
- [x] **Callable** `assignReceiptNumber` (admin-gated, SE1) — mints from `_receiptCounter` in a tx + deterministic `manualReceipts/{b}_{r}_{billId}` record (gapless **+ idempotent**: retry = same number, no double-mint). 7 unit tests. Registered in index.js.
- [x] **Wire** `markBillPaid` (`dashboard-tenant-modal.js`) → call it, persist `receiptNo` on the RTDB bill + payments record (non-blocking). `saveBillToFirebase`/`markRoomPaid` (now `dashboard-bill-payment-status.js:107`) → **deferred 1.2a-2b** (handles slip + cash; needs `!slipVerified` gate to avoid double-numbering a slip-verified bill).
- [x] **Display** — `tenant-render.js` `rcpt-bill-no` → `bill.receiptNo` (benefits slip + cash). PDF `invoice-pdf-generator.js` → **deferred 1.2a-2b**.
- [x] **Rules** `manualReceipts/{id}` read:admin write:false + 4 tests. Gates: functions 1855/0 · rules 258/0 · prod CF+rules+Vercel deploy ✓.
- [ ] **Owner live-verify:** cash mark-paid → tenant receipt shows next `RCP-` in the shared series; re-mark same bill → SAME number (idempotent).

### PR 1.2a-2b — deferred follow-up (named)
- [ ] `saveBillToFirebase` Path-2 "ออกใบเสร็จ" (`dashboard-bill-payment-status.js:107`) → assignReceiptNumber gated on `!window.slipVerified` (slip already numbered via verifySlip) + don't overwrite an existing `receiptNo`.
- [ ] jsPDF receipt export display of `receiptNo`.

### Decisions to confirm (at approval)
1. **Format** `RCP-{building}-{BE}-{NNNNN}` — per-building counter (matches roadmap `counters/{docType}_{building}_{BE}`, avoids cross-building contention)? Or one global per-BE series?
2. **Year reset** — `NNNNN` restarts each BE year (standard Thai เลขที่ practice)? Or never resets?
3. **Migration** — forward-only (gapless starts now; historical paid receipts keep their old display number) **[recommended]** vs backfill existing `verifiedSlips` by `verifiedAt` order (one-shot, deterministic).

### Guardrails
§7-NN callable not trigger (SE3) · §7-I no auto-`.click()` · §7-J rule READY by state · money-flow deploy user-confirmed · gate-first: PR 1.2a-1 then 1.2a-2, each behind `validate.yml` · §7 tx-mock gotcha when re-touching verifySlip tests.

### Review (append after execution)
_(shipped / deferred / follow-ups)_

---

## ▶▶ ACTIVE PLAN (2026-06-02) — Phase 1.1: Server-side immutable audit trail · ✅ PR 1a BUILT (write-path) — gates green, awaiting deploy

**Roadmap:** `core-readiness-roadmap.md` Phase 1.1 (⭐ highest leverage — closes Accounting blocker #3 + the Legal "audit-viewer theater" gap in one move). **Approach chosen by user:** *Hybrid ค่อยเป็นค่อยไป* — callable logger for client-side admin mutations, in-tx logging where the action is already a CF; **bill issue/void deferred** to land atomically with Phase 1.2/1.3.

> **§7-M discovery (2026-06-02):** `audit-log-viewer.html` loads **zero Firebase** and uses the legacy localStorage/SecurityUtils session (NOT Firebase Auth) — so reading the admin-gated `actionAudit` there is a Firebase-Auth retrofit, NOT the line-502 swap originally planned. **User decision: read-UI → Dashboard audit panel (PR 1a.2)** — dashboard.html already has Firebase Auth + firestore + admin claim. PR 1a ships the **write-path only** (the irreversible-value half); the standalone viewer is left as-is.

**Why now:** the accountant's #1 ask. Today the "audit log" is `shared/audit.js` → browser **localStorage** (`audit_logs`, mutable, has `clearLogs()`, max 1000) + `access-control.js:411` → localStorage `access_logs`; `audit-log-viewer.html:502` reads **localStorage `access_logs`** (per-browser, clearable — evidence theater). The only real server trail (`auth_events`→BigQuery via `archiveAuthEvents.js`) logs **failed logins + PDPA erasures only** — never bill/meter/tenant/payment admin actions. Precedents to mirror exist in-repo: `_occupancyLog.js` (immutable append helper), `_pointsLedger.js` (just shipped), `dataDeletionLog`.

### Evidence (grep-verified this session — file:line)
- Current logger localStorage-only: `shared/audit.js:14` (`audit_logs`), `shared/access-control.js:396-424` (`logAccessAttempt`→`access_logs`).
- Viewer reads localStorage: `audit-log-viewer.html:502` `localStorage.getItem('access_logs')`. ← swap target.
- Server precedents: `functions/_occupancyLog.js:114` `appendLog(writer, firestore, payload)`; `functions/archiveAuthEvents.js` (auth_events→BigQuery, IAM write-only); `functions/requestDataDeletion.js` (`dataDeletionLog`).
- Callable house pattern: `firebase-functions/v1`, `.region('asia-southeast1').https.onCall((data, context)=>…)`; admin gate `if (!context.auth?.token?.admin) throw HttpsError('permission-denied')` (`adminApprovedLink.js:49`).
- Rules model: `pointsLedger`/`dataDeletionLog`/`consents` blocks → `allow read: if isAdmin(); allow write: if false;` (`firestore.rules` ~:754/:739/:727).
- `actionAudit` + `recordAdminAction` confirmed **absent** (clean slate).
- Wire points: `verifySlip.js:356`/`:403` `recordPaymentAndAwardPoints` tx (in-tx, tamper-proof) · `dashboard-tenant-modal.js:530-701` tenant edit (client, already calls `AuditLogger.log`) · `dashboard-meter-import.js` approve→`meter-unified.js:99` setDoc (client) · `dashboard-tenant-modal.js:477` bill-mark-paid manual (client RTDB).

### Ship as 2 PRs (gate-first, one vertical slice each)

**PR 1a — write-path foundation** (branch `feat/phase1-1-action-audit`) · ✅ BUILT, gates green:
- [x] `functions/_actionAudit.js` — append helper mirroring `_pointsLedger.js`: `appendActionAudit(writer, firestore, payload)`, `VALID_ACTIONS` enum, validation. autoId for client events (admin actions aren't idempotent — two edits = two events); **optional deterministic `idempotencyKey`** for the in-tx CF case (PR 1b verifySlip). 13 unit tests.
- [x] `functions/recordAdminAction.js` — onCall (v1, SE1), admin-gated. **Stamps `actor`/`actorEmail`/`actorRole`/`at`/`ip` server-side** from verified context (never client-trusted — proven by a forgery test). Caps before/after snapshots. 9 unit tests.
- [x] `functions/index.js` — registered `exports.recordAdminAction` (after the gamification CFs).
- [x] `firestore.rules` — `match /actionAudit/{entryId} { read: if isAdmin(); write: if false; }` (after pointsLedger). 7 rules tests (admin read/query OK; tenant/unauth/client-write/update/delete denied).
- [x] `firestore.indexes.json` — composite `actionAudit` (`actor` ASC, `at` DESC).
- [x] **Wire 1 client action as proof:** tenant edit (`dashboard-tenant-modal.js:695`, beside `AuditLogger.log`) → `recordAdminAction` with `TENANT_UPDATED`. Non-blocking, **field-NAMES only (no PII values)**, fired AFTER the save (§7-I).
- [x] **Tests + gates:** functions unit **1831/0** (+22), rules **249/0** (+7).
- [ ] **Read-UI swap → MOVED to PR 1a.2** (Dashboard audit panel) per §7-M discovery above. Standalone `audit-log-viewer.html` left as-is.
- [x] **Commit → push → PR (#229) → squash-merge `0d23ea8` → DEPLOYED prod** (user-confirmed). CF deploy ✓ (`recordAdminAction(asia-southeast1)` created); rules+index deploy failed once on a transient `Failed to make request` to the indexes API → fresh `workflow_dispatch` re-run `✔ Deploy complete!` (rule + index live). §7-NN held (callable, no trigger).
- [ ] **Live-verify (OPEN):** admin edits a tenant in the dashboard → REST-read `actionAudit` shows one row with server-stamped `actor`/`ip`/`at`. Needs a real admin edit (no auto-click, §7-I). Self-confirms on first real edit; or user triggers one + re-probe.

**PR 1a.2 — Dashboard audit panel** (read UI) · ✅ BUILT (branch `feat/phase1-1-audit-panel`):
- [x] `shared/dashboard-audit-panel.js` (new, 148 lines) — `window.initAuditPage()`; subscribes `actionAudit` `orderBy('at','desc') limit 200` via `window.firebase.firestoreFunctions`; idempotent; **§7-N error callback** renders an error state (no silent stuck spinner); client-side search (no composite-index dependency for v1); Firestore `Timestamp.toDate()` for `at`; escapes all fields.
- [x] `dashboard.html` — nav button (`data-page="audit"`, SYSTEM group) + `#page-audit` container (`.page`/`.active` system, not §7-SS u-init-hide) + search bar + `<script src>` tag. **CSP: no drift** (HTML + external src only — no inline-script content changed; `csp:hash` diff empty).
- [x] `shared/dashboard-main.js` — `_showPageImpl`: `if(page==='audit')initAuditPage();`.
- [ ] Ship: commit → push → PR → merge (Vercel static deploy) → **live-verify on prod** (admin login → open panel → empty state renders no-error; then a tenant edit → row appears = closes PR 1a live-verify too).

**PR 1b — expand coverage** ✅ SHIPPED + DEPLOYED 2026-06-02 (client [#231](https://github.com/soulgroundliving/the-green-haven/pull/231) `28b80a7` · CF [#232](https://github.com/soulgroundliving/the-green-haven/pull/232) `bfb992e`):
- [x] In-tx (tamper-proof): `verifySlip.js` → `PAYMENT_VERIFIED`. **Anchored in `saveVerifiedSlip` (NOT `recordPaymentAndAwardPoints` :403 — that returns early for non-`nest`, would miss every rooms payment).** Bare `.create()` → `db.batch()` + `batch.create()` + `appendActionAudit()` + `batch.commit()` (atomic, idempotencyKey=transactionId). actor/role/ip server-stamped from onCall context (forgery test). Test mock: added `db.batch()` (commit throws `verifiedSlipsCreateThrow` → 3 dup tests preserved) + 4 audit-row tests. functions 1831→1835.
- [x] Via callable (client): meter-import approve (`dashboard-meter-import.js` `approvePendingImportWithFirebase`, both approve paths' convergence, gated `totalSaved>0` → `METER_IMPORT_APPROVED`) · bill-mark-paid manual (`dashboard-tenant-modal.js` `markBillPaid` → `BILL_PAID_MANUAL`). Both non-blocking, fired AFTER action (§7-I).
- [x] Tests + gates green (functions 1835/0 · test:shared 319/319 · pre-commit hooks · staging deploy · prod CF deploy 3m36s success). **Lifecycle docs updated: [[lifecycle_audit_trail]] + [[lifecycle_verifyslip]]; verify:memory 482/0.**
- [ ] **Live-verify (owner, §7-J/§7-I):** real admin tenant-edit / meter-approve / bill-paid / slip-verify (admin + tenant LIFF) → `actionAudit` shows the rows; duplicate slip writes no 2nd `PAYMENT_VERIFIED`. Agent can't drive LIFF / won't auto-click approve.

### Deferred (named, not dropped)
- **bill issue / void atomic logging** → Phase 1.2 (gapless doc number) + 1.3 (void-with-trail) — shared bill-issuance refactor; that's where financial mutations move into CFs (option B).
- **Unify existing dedicated server logs** (occupancyLog / dataDeletionLog / deletePetMedia / hideMarketplaceChat) into `actionAudit` — fast-follow; they already log, lower priority.
- maintenance create/update, batch rent adjustment (`dashboard-property.js`), tax export → fast-follow.
- **tenant self-view** of own `actionAudit` rows → later (add a claim-traced read clause then, not now — admin-read-only for v1).

### Cross-cutting guardrails (this PR)
- §7-NN callable not trigger (SE3). · §7-I observe-only, never auto-`.click()` an approve. · §7-J index READY by state. · §7-T grep writer+reader done (above). · Dashboard admin actions use email/admin auth — NOT `_onLiffClaimsReady` (that's LIFF-tenant only). · §7 Phase-0 test-mock gotcha when touching an existing CF's tx.

### Review (Phase 1.1 — shipped 2026-06-02 session 2)
- **Shipped + deployed + verified:** PR 1a write-path ([#229](https://github.com/soulgroundliving/the-green-haven/pull/229) `0d23ea8`) + PR 1a.2 dashboard read panel ([#230](https://github.com/soulgroundliving/the-green-haven/pull/230) `25052e2`). Read path **live-verified** via Chrome MCP (admin → panel query OK, empty-state, no console error). Static deploy verified (content-hashed module served 200). Gates: functions 1831/0 · rules 249/0 · shared 319/0 · verify:memory GREEN. Lifecycle doc: `~/.claude/.../memory/lifecycle_audit_trail.md`.
- **PR 1b ✅ SHIPPED + DEPLOYED 2026-06-02 (#231 client + #232 CF):** verifySlip `PAYMENT_VERIFIED` in-batch (anchored in `saveVerifiedSlip`, all-buildings — improved over the spec's nest-only `:403`) · meter-approve `METER_IMPORT_APPROVED` · bill-paid `BILL_PAID_MANUAL`. functions 1835/0. Owner live-verify open.
- **Deferred to roadmap 1.2/1.3:** bill issue/void atomic logging (the bill-issuance refactor — financial mutations move INTO CFs).
- **Follow-ups:** full end-to-end live-verify (real admin tenant-edit → row in panel) closes PR 1a's write-path verify; Phase 0 `pointsLedger` live-write verify still open.
- **Gotchas logged in handoff:** deploy-rules transient index-API failure (re-run fresh) · content-hash 404 masks static verify · Chrome MCP privacy-filter on rendered rows.

---

**Created:** 2026-05-31 · **Audit score:** 3.04 / 4.0 (B) — adversarial re-audit, 9 parallel agents
**Supersedes:** the earlier 2026-05-31 plan (score 3.12, all 36 tasks completed — commits `87bb4a3` / `7e5ef7b` / `2cb408e`; preserved in git history).

> This run was more adversarial and surfaced **net-new** latent issues (the prior pass fixed wellness/admin-ops XSS; this pass found 4 *different* sinks; prior PERF-Q1 capped insights queries but missed the `dashboard-extra` meter watch).

---

## ▶ ACTIVE PLAN (2026-06-02 PM): P2 plan-first — verifySlip→onCall (#1) · defer tenant-liff-auth (#2)

**Status:** ⏳ AWAITING APPROVAL. The two remaining P2 plan-first items (todo lines ~107 + ~109). User decision taken (choice menu): verifySlip auth model = **Admin + owning tenant** (onCall + `_authSoT`).

### ⚠️ Key discovery — scope is bigger than the audit one-liner
Deployed verifySlip returns **401** to POST-without-auth → `requireAdmin` (added 2026-04-24, commit `1176e46` "security hardening") is live. The admin caller (`dashboard-bill-slip-verify.js:128`) sends `Authorization: Bearer <idToken>` and works. But **both tenant callers** (`tenant-slip-verify.js:95` rent · `tenant-cleaning.js:243` ฿500 cleaning) send **no** auth header → **tenant self-slip-verify has 401'd for ~6 weeks**. `verifyTenantSlip` IS fully wired (`tenant_app.html:3587` button → hub `:5361` → module). Option A fixes this as a side effect by gating on admin-OR-owning-tenant via `_authSoT.assertTenantAccess` (same helper 7 other tenant CFs use).

---

### Phase 1 — verifySlip `onRequest` → `onCall` (Option A)

**Why:** (1) transport-layer auth consistency (audit goal) — align with the 7 `_authSoT` onCall CFs, drop manual `Authorization: Bearer` parse + manual CORS; (2) fixes the 6-week-broken tenant self-verify (gamification early_bird/on_time tiers are computed from the tenant's OWN slip date → self-verify was the intended design); (3) defense is **unchanged** — SlipOK cryptographic verify + amount hard-reject (|diff|>1) + atomic `.create()` dedup still gate every call. onCall only changes WHO may call (admin + that room's tenant) and HOW the token is transported.

**Server — `functions/verifySlip.js`**
- [ ] **Trigger swap:** `.https.onRequest(async (req,res)=>…)` → `.https.onCall(async (data, context)=>…)`. *Why:* callable auto-verifies the ID token into `context.auth` + auto-CORS.
- [ ] **Delete** CORS-header block + `OPTIONS`/`GET`/method branches. *Why:* onCall owns transport; keepLiffWarm still warms via GET→4xx (see keepLiffWarm step).
- [ ] **Auth gate:** remove `requireAdmin(req,res)`; move validation up so building+room are known, then `await assertTenantAccess({ building, roomId:String(room), context, firestore: db, HttpsError: functions.https.HttpsError })`. *Why:* admin = Path 0; owning tenant = Path 1 (claim) / 1b (tenantId) / 2a (linkedAuthUid) → survives §7-Z claim-strip + §7-HH stale-UID.
- [ ] **Input:** `req.body` → `data` for `{file, expectedAmount, building, room, userId}`.
- [ ] **Error mapping — THROW vs RETURN (deliberate, minimizes client churn):**
  - **THROW** `functions.https.HttpsError`: `unauthenticated`/`permission-denied` (from `_authSoT`), `invalid-argument` (missing fields · bad base64 · payload >5MB), `resource-exhausted` (rate-limit, keep `retryAfter:60` detail), `internal` (unexpected catch).
  - **RETURN** `{success:false, …}` (NOT throw) for business outcomes shown inline: `scb_delay` (retryable), `amount_mismatch` (+slipAmount/expectedAmount), `isDuplicate`, generic SlipOK fail. *Why:* keeps client branching on `result.success`/`result.code` like today; "slip didn't pass" is not an exception.
  - **RETURN** `{success:true, data:slipData, amountValid:true, amountDiff}` on success.
- [ ] **Req metadata:** `req.ip`/`req.get('user-agent')` → `context.rawRequest?.ip` / `context.rawRequest?.get?.('user-agent')` in `logVerificationAttempt` calls (preserve audit trail). *Why:* v1 onCall exposes raw req under `context.rawRequest`.
- [ ] **Unchanged:** rate-limit (fail-closed), SlipOK call, amount hard-reject, atomic dedup, markBillPaidInRTDB, sendReceiptNotification, recordPaymentAndAwardPoints, region `asia-southeast1`, secrets `[SLIPOK_API_KEY, LINE_CHANNEL_ACCESS_TOKEN]`. *Why:* behavior-preserving — only the transport+auth shell changes.

**Client — 3 callers: `fetch` → `httpsCallable`** (`window.firebase.functions.httpsCallable('verifySlip')(data)` → `{data: result}`)
- [ ] **`shared/dashboard-bill-slip-verify.js`** (admin): drop `getIdToken()`+`fetch(...Authorization...)`; use httpsCallable; read `res.data`; map thrown HttpsError → existing error UI (`err.message`/`err.details`); keep `skipSlipVerify` fallback. *Why:* SDK auto-attaches admin token.
- [ ] **`shared/tenant-slip-verify.js`** (rent): swap `fetch`→httpsCallable; read `res.data`; keep `scb_delay` countdown + success→`goToPaymentStep(3)`. *Why:* tenant signed-in via LIFF custom token → auto-attached → fixes 401. **Verify** whether the `window.firebase.functions.httpsCallable` wrapper forwards a `{timeout}` option; if yes pass `{timeout:12000}` (§7-R), if not rely on SDK default (httpsCallable has a built-in timeout unlike raw fetch — AbortController becomes unnecessary).
- [ ] **`shared/tenant-cleaning.js`** (฿500): same swap; `{file, expectedAmount:500, building, room}` (CF ignores the `context:'cleaning'` field — drop or keep). *Why:* same 401 fix.
- [ ] **CSP:** none expected — callable POSTs to `…cloudfunctions.net` (https:) already allowed by `connect-src 'self' https: wss:`. *(verify on deploy, don't assume.)*

**keepLiffWarm**
- [ ] **`functions/keepLiffWarm.js`** — `verifySlip` `callable:false` → `callable:true`. *Why:* onCall returns 4xx (not 200) to the warm GET; the `callable:true` branch already treats that as expected-warm → no warn-log noise.

**Tests**
- [ ] **Rewrite `functions/__tests__/verifySlip.test.js`** — stub `https.onCall` (capture handler); call `handler(data, context)` for: admin (`context.auth.token.admin=true`), owning tenant (`context.auth.token={room,building}` Path 1), no-auth (expect `unauthenticated`). Assert invalid-argument / resource-exhausted / amount_mismatch RETURN / duplicate RETURN / success shapes. *Why:* current test stubs `onRequest`+`requireAdmin`+`x-no-auth` — all obsolete.
- [ ] **Check `verifySlipReceipt.test.js`** (stubs `onRequest:(fn)=>fn`) + `verifySlipLogic.test.js` — update trigger stub to `onCall` where they load the module; pure-logic tests may be untouched. *Why:* suite is now a PR gate (validate.yml).
- [ ] **Gate:** `npm test` (functions) green before deploy.

**Deploy (⚠️ user-confirmed, coordinated — money-adjacent core flow)**
- [ ] **Sequencing risk:** onCall server + httpsCallable client are NOT compatible with the old shape — deploying one side alone breaks slip verify until the other lands. Plan: merge client PR + `firebase deploy --only functions:verifySlip` back-to-back, low-traffic time. Volume is low (≤50/room/day) — a short window is acceptable.
- [ ] **§branch-before-deploy:** `pwd && git branch --show-current && git log -3 functions/verifySlip.js` first (wrong-branch deploy silently rolls back prod).
- [ ] **Deploy-shape:** onRequest→onCall is https→https (NOT the §7-NN background→callable block) → expected in-place. Fallback if Firebase refuses: `firebase functions:delete verifySlip --region asia-southeast1 --force` then redeploy (brief outage). Secrets already bound → no Secret Manager setup (§7-WW N/A).
- [ ] **Live-verify (§7-J):** admin ตรวจสลิป on Vercel (agent via Chrome MCP) + **user** confirms tenant LIFF rent-slip + cleaning-slip self-verify now succeed (were 401).

**Rollback:** `git revert` client commit → redeploy Vercel **AND** `git revert` CF commit → `firebase deploy --only functions:verifySlip`. Must revert BOTH (matched pair).

---

### Phase 2 — defer parser-blocking JS (todo line ~107)

**2a. async Sentry CDN (4 pages — low risk, clear win)**
- [ ] Add `async` to `<script src="…sentry-cdn.com…">` on `booking.html:47`, `dashboard.html:18`, `tax-filing.html:19`, `tenant_app.html:47` (audit said 3; it's 4). *Why:* Sentry is an independent reporter, nothing calls it at parse-time → safe to unblock the parser. **CSP:** `async` doesn't change anything (external `src`, not an inline hash) → no regen.

**2b. defer `tenant-liff-auth.js` (47KB, `tenant_app.html:5199` — HIGHER risk, §7-PP/§7-A/§7-HH)**
- [ ] **AUDIT FIRST (gate):** module defines the auth spine (`_taBuilding`/`_taRoom`/`_callLiffSignIn`/`_onLiffClaimsReady`). Grep every `<script>` (inline + src) AFTER line 5199 and every deferred script BEFORE it for **parse-time** calls to its exports. *Why §7-PP:* deferred scripts run at DOMContentLoaded in DOM order; an inline script calling these at parse-time runs first → ReferenceError. Most usage is in the delegation hub / event handlers / `_onLiffClaimsReady` callbacks (later) — must be PROVEN, not assumed.
- [ ] If clean → add `defer`, keep tenant-liff-auth positioned before any deferred dependents. If parse-time deps found → **STOP, report, don't force** (breadth-trap: a perf tweak must not risk the auth spine).
- [ ] **Live-verify (mandatory, §7-A/§7-U/§7-HH):** full LIFF auth on real LINE — sign-in → claims arrive → bills/meter/checklist load. Agent can't drive LIFF → **user** verifies. Treat any "stuck at ตั้งค่าสิทธิ์" as a defer-order regression.

**Why 2a/2b split:** 2a is independent + safe → ship freely. 2b touches the most incident-prone file in the repo → gated on an audit + user LIFF verification. Independent of each other and of Phase 1.

---

### Out of scope (named, not silently dropped)
- CSS hashing; identifier-rename minify (build.js Phase B); the audit's already-closed items.
- Removing client-side rate limiters (`_tenantRateLimit`, `checkDashboardRateLimit`) — keep as cheap pre-flight; server rate-limit is the real gate.
- Re-architecting the tenant payment UX — only the auth/transport changes here.

### Review (2026-06-02 PM) — SHIPPED + DEPLOYED
- **Phase 1 (verifySlip onCall)** ✅ PR #224 (squash `ec6330b`) merged + **deployed to PROD** (`firebase deploy --only functions:verifySlip --project the-green-haven` → Successful update; onRequest→onCall in-place, no delete-first needed). Prod probe confirms onCall + handler runs (`{data:{}}` → "File is required"). Restores the ~6-week-broken tenant self-verify.
- **Phase 2a (Sentry defer)** ✅ in #224, live on prod (`sentry-cdn…defer` + `sentry-init.<hash>.js defer` served; 0 CSP drift).
- **Phase 2b (defer tenant-liff-auth)** ❌ AUDITED → SKIPPED — auth spine with a documented synchronous dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). Not forced (breadth-trap).
- **Process note:** first deploy accidentally hit `the-green-haven-staging` (stale `firebase use` alias) — caught from the `Project Console:` URL, re-deployed to prod with pinned `--project`. Lesson added to `feedback_branch_before_firebase_deploy.md` (check `firebase use` before deploy).
- **Follow-up (user):** functional smoke — admin ตรวจสลิป (dashboard) + tenant LIFF rent-slip + ฿500 cleaning-slip now succeed (were 401). Tests: functions 1791 · test:shared 319 · verify:memory green.

---

## ▶ ACTIVE PLAN (2026-06-02): Content-hash caching for `shared/*.js` (P2 item, line ~61)

**Status:** ✅ SHIPPED + PROD-VERIFIED (2026-06-02, PR #223 `d393f35`). Unit 18/18 + full `build.js` temp smoke + **Vercel prod build SUCCESS** + **live curl on prod**: hashed JS 200 w/ `public, max-age=31536000, immutable`; dashboard HTML `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200. Only optional remnant: owner in-app *visual* render (doesn't affect caching — all scripts load 200).

### Goal & Why
Non-SW pages (dashboard, tax-filing, login, booking, index, audit-log-viewer, privacy) currently re-fetch **every** `shared/*.js` on every navigation — `vercel.json` sets `no-cache, no-store, must-revalidate` on `/shared/(.*)\.js`. Dashboard alone pulls **71** local scripts per load. **Why it matters:** biggest LCP/TTI win available; a returning admin re-downloads ~70 files that never changed. **Why it's currently no-cache:** to guarantee freshness after deploy without `?v=` (decision 2026-04-28, [[feedback_vercel_verification]]). Content-hashed filenames make immutable caching *strictly safer* than no-cache (new bytes → new URL → staleness is impossible) **and** faster.

### Research facts that de-risk this (verified 2026-06-02, grep-backed)
- **100% of local JS loads are static `<script src>`** — only dynamic `createElement('script')` is the CDN xlsx (`dashboard-meter-import.js:10`, unpkg). → a build-time `src=` rewrite covers every load; nothing resolves a `shared/` path at runtime.
- **0 SRI** on local scripts (minify already changes bytes) → rename needs no integrity update.
- **CSP** `script-src`/`script-src-elem` use `'self'` for external files (sha256 only for inline) → renaming files = **no CSP change** ([[csp_pipeline]] untouched).
- Ref shapes to rewrite: `./shared/X.js` ×137 · bare `shared/X.js` ×6 · `./accounting/X.js` ×2. (`index.html` 0 local JS.)
- esbuild minify is **deterministic** → unchanged source ⇒ identical hash ⇒ same URL across deploys ⇒ browser keeps the cache (the entire point).
- **Scope = the exact set `build.js` already minifies:** `shared/**/*.js` + `accounting/**/*.js` (102 + 2). CSS (`brand.css`/`components.css`/`tailwind.css`) **out of scope** this round — only 3 files, and `brand.css` is hardcoded in the SW `PRECACHE_URLS`; keep its current header.

### Decision needed — which approach? (recommend A)
- **[A] Build-time content-hash + immutable (RECOMMENDED — the todo's intent).** `build.js` (Vercel-only) renames each minified `shared/X.js`→`shared/X.<hash8>.js`, rewrites all refs from a manifest, then a **build-time verify gate fails the deploy (red) if any ref is dangling** — so a missed reference is a failed build, never a prod 404. Source files keep plain names (local dev untouched). Full win, contained risk. ~1 deploy to revert (HTML is no-cache → always points at current hashes).
- **[C] Fallback — just relax the header.** Change `/shared/(.*)\.js` to `public, max-age=300, stale-while-revalidate=86400`. 1-line, near-zero risk, **partial** win (within-session only) and **reintroduces a small staleness window** the no-cache was chosen to avoid. Offer if A feels too heavy.
- (Rejected: `?v=hash` query strings — Vercel header `source` matches pathname not query, so can't cleanly set immutable; and reverses the explicit "no `?v=`" decision for a worse-caching mechanism.)

### Implementation steps — Approach A (✅ all done 2026-06-02)
- [x] **build.js — hashing pass.** After the JS-minify loop, for each emitted `shared|accounting/*.js`: sha256 of the **minified** bytes → 8-char hash → rename to `<base>.<hash>.js`; record `{ 'shared/X.js': 'shared/X.<hash>.js' }` manifest. **Why:** hash the bytes the browser actually caches; deterministic across unchanged deploys.
- [x] **build.js — ref rewrite.** One pass over all `*.html` (+ SW if it ever refs a hashed asset — it doesn't, JS-only) replacing every `(\./|/)?(shared|accounting)/<name>\.js` with the manifest value, preserving the original prefix (`./` / bare / `/`) + `defer`. **Why:** all 3 prefix shapes exist; must not change load semantics (§7-PP defer-order untouched — order in HTML is preserved, only the filename token changes).
- [x] **build.js — verify gate (the safety net).** After rewrite: assert every remaining `(shared|accounting)/...\.js` ref in HTML maps to an on-disk emitted file, AND no referenced plain name survives. Mismatch → `console.error` + `process.exit(1)`. **Why:** converts "missed ref = silent prod 404" into "failed Vercel build" (§7-J / breadth-trap containment).
- [x] **build.js — ordering.** Run hashing+manifest BEFORE the HTML-minify/rewrite stage so the manifest exists when HTML is processed. **Why:** rewrite needs the final names.
- [x] **vercel.json — headers.** `/shared/(.*)\.js` and add `/accounting/(.*)\.js` → `public, max-age=31536000, immutable`. Leave HTML (`/`, page list) + `service-worker.js` + `manifest.json` + `*.css` on **no-cache** (unchanged). **Why:** hashed JS is safe to pin forever; HTML must stay fresh so it always emits current hashes. (`(.*)\.js` already matches `X.<hash>.js` — greedy.)
- [x] **Pure-function extraction + unit tests (gate).** (`tools/asset-hash.js` + `shared/__tests__/asset-hash.test.js`, 18 tests) Extract `computeAssetManifest(files, readBytes)` + `rewriteHtmlRefs(html, manifest)` + `verifyNoDanglingRefs(htmls, emittedSet)` into a testable module (e.g. `tools/asset-hash.js`); `shared/__tests__/asset-hash.test.js`: hash determinism, all-3-prefix rewrite, defer preserved, dangling-ref → throws, unchanged-file → stable hash. **Why:** matches the project's "extract pure fn + test" gate pattern (#220/#221); lets me prove logic without running the in-place build against the real repo.
- [x] **SW sanity.** (confirmed: no `shared/*.js` in PRECACHE_URLS; cache-first ext-regex matches hashed names; CACHE_VERSION purge unchanged — SW needs no edit) Confirm `service-worker.js` needs **no** change: cache-first matches `.js` by extension regex (works for hashed names); `PRECACHE_URLS` has no `shared/*.js`; CACHE_VERSION bump still purges per deploy. **Why:** §7-MM — verify hashing doesn't worsen the SW-stale-debug trap (it improves it: changed files get new URLs).

### Verification (what I can prove vs what needs the owner)
- [x] **Local (done):** 18/18 unit tests; integration smoke on real files (104 hashable, 10 HTML, 0 dangling, negative case flags bogus ref); **full `build.js` on a throwaway temp working-tree copy** (`FORCE_BUILD=1`, NODE_PATH→real node_modules, tailwind execSync neutralized) → exit 0, `🔗 Content-hashed 104 JS assets; all HTML refs rewritten + verified`, `shared/utils.8708c263.js` emitted + dashboard ref rewritten + 0 plain refs.
- [x] **Headers/refs (done by agent via curl — public static, no auth):** prod `shared/<hashed>.js` → 200 + `public, max-age=31536000, immutable`; dashboard HTML → `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200.
- [ ] **Owner in-app (optional, §7-I — agent can't auth):** hard-reload (clear SW+cache, §7-MM) → dashboard/tenant_app render fine + `(disk cache)` on 2nd navigation + no CSP/console errors + tenant_app (SW page) boots. Not blocking — caching change doesn't alter render; all scripts already proven 200.

### Rollback
`git revert` the build.js + vercel.json commit → redeploy. HTML is no-cache → next load points back at plain names + header returns to no-cache. One deploy cycle, clean.

### Out of scope (named, not silently dropped)
CSS hashing (3 files, SW-precache coupling); identifier-renaming minify (build.js Phase B, separate); the other 2 plan-first P2 items (verifySlip onCall, defer tenant-liff-auth).

---

## Scores by dimension

| Dim | Score | Grade | Headline gap |
|-----|:-----:|:-----:|--------------|
| DevOps/Deploy | 3.4 | A-/B+ | no branch protection; rules never auto-deployed |
| Architecture | 3.2 | B/B+ | `window.X` global coupling; `detectBuilding` ×4 |
| Security | 3.2 | B+ | 4 XSS sinks (now fixed); verifySlip onRequest |
| Tech Debt | 3.1 | B+ | 22MB dup (removed); 28 un-archived migrations |
| Docs & Memory | 3.0 | B | count drift; MEMORY.md over limit; stale docs/README |
| UX/UI | 3.0 | B/B- | tenant nav not keyboard-operable; tab ARIA=0; contrast |
| Code Quality | 2.9 | B- | 21 files >800L; 6 prompt(); silent billing catches |
| Performance | 2.8 | B- | meter_data watch (fixed); no HTTP cache on shared/*.js |
| Testing | 2.8 | B- | frontend ~3% coverage; test:shared not in PR gate |

---

## ✅ DONE this session (working tree — commit + live-verify pending)

- [x] **Perf CRITICAL — bound `meter_data` watch** — `shared/dashboard-extra.js:716` `onSnapshot(collection(db,'meter_data'))` → `query(…, limit(500))`. **Why:** unbounded full-collection real-time watch replayed the whole collection on every admin open + fanned out per meter write. Callback only pings `updateDashboardLive()` (never reads payload). ⚠️ **Live-verify** dashboard auto-refresh after a meter import.
- [x] **XSS — audit log viewer** — `audit-log-viewer.html:599-601` added local `esc()` + wrapped `userEmail`/`userRole`/`attemptedPage`. **Why:** auth gate writes user-controlled fields (incl. unauthenticated denials) → stored XSS into the admin-only viewer. (Net-new sink; prior pass fixed wellness/admin-ops, not this.)
- [x] **XSS — payment notif panel** — `shared/dashboard-bills.js:364/366/373/375` `_esc()` on tenant-controlled `room`/`slipId`/`receiptId`.
- [x] **XSS — billing import status** — `shared/dashboard-bills.js:1255` `_esc(message)`.
- [x] **XSS — toast** — `shared/dashboard-main.js:219` `innerHTML`→`textContent` (defense at the sink for all callers).
- [x] **Tech Debt — delete 22MB stale `The_green_haven/` dup + 3.6MB+448KB debug logs + `tools/csp-hashes-new.json`** (~26MB freed; verified stale: no `.git`, 0 files newer than May 1, old 11KB CLAUDE.md).

All edited JS passes `node --check`. ⚠️ A prompt-injection was detected mid-session (a fabricated `shared/utils.js` read with embedded instructions steering away from the toast fix) — disregarded; every edit verified against on-disk content via `git diff`.

### Verify-before-commit
- [ ] `git push origin main` → Chrome MCP admin login on https://the-green-haven.vercel.app → confirm: meter live-refresh works, payment notif panel renders, toast shows, audit-log viewer renders (per §7-J: static deploy ≠ live verified).

---

## P1 — soon (high value, low/medium effort)

### ✅ DONE this session (commit pending)
- [x] **🔴 PRODUCTION BUG found + fixed — Thai mojibake** — `shared/tenant-system.js` (13 user-facing lines: default tenant name, room label, maintenance titles/content, payment-status text) + `shared/tenant-firebase-sync.js` (2 comments) were double-encoded (UTF-8→CP874→UTF-8) **by the prior P1 commit `7e5ef7b`** (the `console.info` bulk sed). Recovered byte-exact from last-clean commit `0ad1d8a` via `tools/fix-thai-mojibake.js` (git-sourced, zero Thai typed). Also fixed 7 em-dash `โ€"`→`—` corruptions. **`test:shared` 84→86/86 pass.** Full-repo scan: 0 mojibake remaining across 287 files. ⚠️ **Correction to audit:** the `.gitattributes`/CRLF hypothesis was WRONG — corruption was in the committed bytes (RED on every OS), not a Windows line-ending flake.
- [x] **Testing — `.gitattributes` `* text=auto eol=lf`** + per-type rules + binary excludes. **Why:** locks repo to LF (blobs already LF; verified `git add --renormalize` = 0 collateral churn) so working-copy CRLF can never be committed and UTF-8 stays clean. (Not the test-fix cause, but correct hygiene.)
- [x] **Testing — gate `test:shared` in `validate.yml` on PR** — added step after CF unit tests (pure `node --test`, no emulator). Now 86 frontend tests block merge. Safe because suite is green post-bug-fix.
- [x] **DevOps — `deploy-rules.yml`** created — push to main touching rules/indexes → re-run 3 emulator rules suites → `firebase deploy --only firestore:rules,firestore:indexes,storage,database`. Mirrors `deploy-functions.yml` SA/IAM pattern. **Closes the "rules tested but never auto-deployed / wrong-branch-rollback" gap.** Needs SA roles: firebaserules.admin + datastore.indexAdmin + firebase.admin (documented in workflow header).

### ▶ Still open
- [x] **DevOps — branch protection on `main`** — DONE 2026-06-01. Required check `validate`; `enforce_admins:false` (admin bypass — owner keeps `git push origin main` deploy path); force-push + deletion blocked. Noted in CLAUDE.md §5. `firestore-rules`/staging NOT required (path-filtered — would block non-rules PRs).
- [x] **UX HIGH — keyboard-operable tenant nav** — DONE 2026-06-01 (PR #203). `shared/tenant-navigation.js`: `enhanceMenuItemA11y()` (role=button+tabindex on `.menu-item[data-action]`) + `_onTileKeydown` (Enter/Space → synthetic bubbling click, reuses the capture-phase hub). `components.css` `:focus-visible` ring. +11 tests. **Dynamic tiles** (if any) need a `window.enhanceMenuItemA11y()` call in their renderer — static tiles covered.
- [x] **UX HIGH — tab ARIA + dynamic `aria-current`** — DONE 2026-06-01 (nav-current PR #204 + tab-ARIA PR #205). Nav: `updateNavActiveIndex`/`showPage` move `aria-current="page"` (was hardcoded on Home). Tabs: new `shared/dashboard-tab-aria.js` `syncTabAria()` mirrors `.active` → role=tab/tablist + aria-selected via capture-click+microtask (no 7-switcher edit, no HTML sweep). +7 tests. **Deferred:** panel `role=tabpanel`/`aria-controls` (no shared selector).
- [x] **UX HIGH — contrast tokens (core)** — DONE 2026-06-01 (PR #206). `--muted`/`--pebble` darkened to AA + false comment fixed; `--ok-text`/`--alert-text`/`--brand-primary-text` added (light+dark); components.css text uses switched; +18 contrast-lock tests. **Deferred (needs CSP regen):** `<style>`-block `--alert`/`--ok` text in booking/login/tenant_app.html + dark `--brand-primary`-as-text (27 sites, light-passing) → do via live per-element contrast audit, not a blind sweep.
- [~] **UX — live a11y verify on Vercel** — DONE (deployed-code level) 2026-06-01 via Chrome MCP (SW+cache cleared first, §7-MM). On prod, the DEPLOYED MINIFIED modules behave correctly: `enhanceMenuItemA11y` → role=button+tabindex; `_onTileKeydown` Enter → click fires; `syncTabAria` → role=tab/tablist + aria-selected flips on active-move; `updateNavActiveIndex` → aria-current moves. Contrast tokens computed live (--muted 5.40, --pebble 5.14, --ok-text 5.58, --alert-text 5.98 on --cloud) + login.html renders clean (no mojibake, brand intact). **Remaining (needs owner's logged-in session):** in-situ visual on the real dashboard tabs / tenant_app tiles (focus ring, SR announce) — dashboard/tenant are auth-gated; agent does not enter credentials (§7-I / safety).
- [x] **Code Quality — replace 6 `prompt()`** with `window.ghPrompt` — DONE 2026-06-01 (PR #197, `a706b05`). All 6 → async `await window.ghPrompt(...)` (null-on-cancel semantics preserved). NOTE: `generateMonthlyBillsUI`/`downloadInvoicesPDF` are orphaned (0 callers, §7-K) — converted for consistency; **wire-or-delete still open** (see P2).
- [x] **Code Quality — log silent billing catches** — DONE 2026-06-01 (PR #197). 7 bare `catch(e){}` in `_subscribeGlobalVerifiedSlips`/`PaymentStore.onChange` cluster → `console.warn('[billing] …')`. 4 best-effort catches outside the cluster (`_notify` listener isolation, print-window teardown) left per minimal-change.

---

## P2 — when time allows

- [x] **Performance — content-hash caching for `shared/*.js`** — ✅ SHIPPED 2026-06-02 (PR #223 `d393f35`, Approach A — see "▶ ACTIVE PLAN" at top). `build.js` content-hashes `shared/*.js`+`accounting/*.js` (104 files) → `immutable`; HTML/CSS/SW stay no-cache. `tools/asset-hash.js` + 18 tests + build-time verify gate. **Prod-verified live** via curl (hashed JS 200+immutable, dashboard no-cache, 0 plain refs, all pages 200).
- [x] **Performance — analytics aggregation** — DONE 2026-06-02 (the actionable remnant). **`lineRetryQueue`** unbounded `getDocs(collection)` → `query(orderBy('firstFailureAt','desc'), limit(500))` (`dashboard-owner-insights.js`). Found + fixed a **latent bug while there**: the CF-health board read `i.createdAt`, but queue docs only carry `firstFailureAt` (enqueue, `merge:false`) → 7-day success-rate/abandoned/avg-attempts were dead and oldest-pending age showed `NaN`. Extracted pure `_computeCFHealthStats` + **+11 tests** (gate 281→292) incl. a `reads firstFailureAt not createdAt` regression guard. **N/A / already-done (per 2026-06-01 handoff):** `meter_data`/`complaints`/`pets`/`liffUsers` can't use `count()`/`sum()` (per-row processing; `liffUsers` count would undercount status-less docs); `announcements`/`wellness_articles` already bounded. ⚠️ Live-verify (owner): admin dashboard → Owner Insights → CF Health card now shows real %/age, not —/NaN.
- [x] **Performance — defer parser-blocking JS** — ✅ async/defer Sentry loader+init ×4 pages (#224). `tenant-liff-auth.js` defer **SKIPPED** — auth spine, documented sync dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). See Review at top.
- [x] **Security — move WAQI/IQAir tokens → Secret Manager** — ❌ DROPPED 2026-06-01 (won't do). Attempted (PR #216) → broke prod CF deploy because the secrets weren't in the prod project (`the-green-haven` 404; my `:get` had checked the wrong project) → reverted `adae1cc`. **Decision: keep `.env`** — it's gitignored + CI-injected from a GitHub Actions secret (not a leak), and Secret Manager was pure hardening not worth the per-project secret-creation + SA-accessor + test-deploy friction for non-critical AQ tokens. Lesson captured in §7-WW. Re-open only if these tokens ever become sensitive.
- [x] **Security — refactor `verifySlip` `onRequest` → `onCall`** — ✅ DONE #224 (admin OR owning-tenant via `_authSoT`); deployed + prod-verified. Restored the ~6-week-broken tenant self-verify (401). See Review at top.
- [x] **Docs — fix count drift** — DONE 2026-06-01. README.md (CF tests 39→86, firestore rules 304→220, added database 48), CLAUDE.md §2 (101→102 files, 26→27 tenant-*.js) + §5 (~70→220 rules cases), MEMORY god-file entry (101→102 shared). Ground truth: 86 CF tests, 83 exported CFs, 220/36/48 firestore/storage/rtdb rules. **`verify:memory` README-count assertion DONE 2026-06-02:** new `runReadmeCountAssertions()` checks 5 in-repo README claims against live counts (firestore 220 / storage 36 / database 48 rule tests · 86 CF unit-test **files** · §7 anti-pattern range+count A–WW/49 vs `### <Letter>.` headings in CLAUDE.md), every occurrence checked so a half-updated README is RED. It immediately caught 3 live drifts → fixed: README commands-table still said firestore "(304 cases)" (the 2026-06-01 fix only touched the layout block — exactly the duplicate-occurrence miss this guards), "86 CF unit tests" relabeled "…files" (the 86 is a file count; ~1.8k `it(` cases), and "§7 A–NN, ~40 patterns" → "A–WW, 49 patterns" (×2 lines). verify:memory green (459 rows, 0 fail).
- [x] **Docs — trim MEMORY.md <24.4KB** — DONE 2026-06-01. 26.2KB → 24.21KiB (197 bytes margin) by compressing Current-state handoff entries + verbose index lines (detail already in linked docs). Fixed stale "checklist-manager skipped / gate 248" → "281, PR #213". `verify:memory` green.
- [x] **Docs — rewrite stale `docs/README.md`** — DONE 2026-06-01. Was a localStorage-era doc (localStorage persistence, localhost:8080, nonexistent tenant-payment.html, © 2024, PII phone) → accurate index of `docs/` runbooks + pointers to root README / CLAUDE.md. **`SECURITY.md` rewritten** as a disclosure policy; removed 3 in-clear API keys (Firebase web, SlipOK, secondary Firebase). ⚠️ Key-rotation status raised with user.
- [x] **Testing — frontend unit tests** — DONE. checklist-manager.js added 2026-06-01 (PR #213, +33 tests, gate 248→281); billing-system / bill-generator / lease-config already covered (prior session). All 4 target modules now have coverage.
- [x] **Architecture — collapse `detectBuilding`** — DONE 2026-06-02. `BuildingConfig.getBuildingForRoom` (`building-config.js`) is now the single source (N-prefix OR named legacy range `NEST_LEGACY_NUMERIC_MIN/MAX` 101-405). `BillingSystem.detectBuilding` + `detectBuildingFromRoomId` + `_taDetectBuilding` all delegate to it (thin defensive inline mirrors kept for pre-load / auth-critical safety). **Latent bug fixed while there:** `getBuildingForRoom` was N-prefix-only AND had 0 callers (§7-K) → it would have returned `'rooms'` for numeric 101-405, disagreeing with the real detector (§7-T landmine); now correct. `detectBuildingFromRooms` (meter-import, array/batch, N-prefix only) intentionally left — different signature + semantics. +9 tests (`building-config.test.js`); behavior-preserving (billing-system's 8 detectBuilding cases still green = fallback === SoT). Gate 292→301.
- [~] **Tech Debt — archive 28 one-shot migration scripts** → `tools/migrations/done/`. ⚠️ **Re-scoped 2026-06-02:** NOT low-blast — only **7** of ~33 one-shots are truly orphan. **7-orphan move DONE 2026-06-02:** `git mv` the 7 (`migrate-lease-duplicates`, `migrate-rewards-strip-note`, `migrate-service-providers-clean-internet`, `backfill-verifiedSlips-from-rtdb`, `fix-csp-styles-p2`, `fix-csp-styles-p3`, `sweep-hex-colors`) → `tools/migrations/done/` + a `README.md` there (archive rationale + per-script purpose/add-date + §7-I do-not-re-run + list of the live templates that stay). Re-verified 0 refs before moving (only self-refs + this todo + handoff). **Still deferred (plan-first):** the other 26 are cited in CLAUDE.md §7 + memory as templates/history → a full archive = doc-repointing sweep past Plan-First threshold (breadth-trap: freeze). Don't blind `git mv *`.
- [x] **Tech Debt — orphaned bill-gen UI** — RESOLVED. `generateMonthlyBillsUI` + `downloadInvoicesPDF` were already deleted by **#202** (a11y session) — grep 2026-06-02 returns 0 definitions. This todo line was stale (written off the PR #197 note). Nothing to do; `BillGenerator.generateMonthlyBills` remains the real entry.
- [x] **Tech Debt — root junk files** — DELETED 2026-06-02 (`bill69-final.xlsx` PII 324K, `S__91643910.jpg` 192K, `Nature Haven Design System.zip` 20K). All were untracked + unreferenced; removed from disk (no commit — never tracked).

---

## Review (2026-05-31, run 2)

**Shipped:** 5 code fixes (1 perf CRITICAL + 4 XSS sinks) + ~26MB junk cleanup. All JS `node --check` clean; `git diff` verified.
**Deferred:** P1/P2 above.
**Follow-up before "done":** live admin verification on Vercel (meter refresh + the 4 escaped surfaces).
**Process note:** prompt-injection detected & disregarded; ground truth re-established via Bash; edits applied against real on-disk content.
**Prior plan:** the 3.12 run (36 tasks, all completed) is in git history at `87bb4a3` / `7e5ef7b` / `2cb408e`. Marketplace sprints remain in [tasks/marketplace-sprints.md](marketplace-sprints.md).
