# Meaning Layer — REMAINING plans (after #13) · 2026-06-13 · ⏳ planning only, no code

> Companion to [todo-lost-pet-alert.md](todo-lost-pet-alert.md) (#13, planned separately) + [meaning-layer-roadmap.md](meaning-layer-roadmap.md) (the master order). This doc plans **every other pending ตัว** so the whole Meaning Layer is mapped. Same principles: one ตัว = 1 self-shipping PR · capture-before-score · **reuse don't reinvent** · respect readiness gates · no breadth sweeps.
>
> **Concurrent-session safety carries over from the #13 plan** — 2 sessions live (deposit + auth/§MMM). OFF-LIMITS: deposit files (`deposit-calc.js`/`dashboard-deposits-admin.js`/`dashboard-main.js`/`_billWrite.js`/`confirmMoveIn|forfeitReservedDeposit|verifyDepositSlip.js`/deposits-rules/`todo.md`/`todo-deposit-premovein.md`), auth files (`_authSoT.js`/`recordChecklistConsent.js`/`tenant-liff-auth.js`/liffUsers-rules/`CLAUDE.md`/`README.md`/`lessons_antipatterns.md`), and **#10 pet write-path** (`tenant-pet-social.js`/`upsertPetProfile.js`/`_petSocialEngine.js`). Build any of these in a worktree off `origin/main`, land after the 2 sessions merge.

---

## §0 — #7 Verified Helper · ✅ ALREADY CODE-COMPLETE (roadmap doc-drift §7-K — NOT a build task)

**Finding (grep-verified 2026-06-13):** the roadmap lists #7 as "🟡 gated on #2 job history" but the **entire stack already shipped** (with the #8 Resident Rank batch — #8's `round(0.40·rep + 0.30·kind + 0.30·vh)` literally reads `verifiedHelper`, so it had to):
- `functions/_verifiedHelper.js` — pure engine, complete. Score = `clamp01(completedCount/8·0.6 + distinctRequesters/4·0.4) + tagBonus(≤0.10)` → 0–100; `provisional` below **VH_MIN_JOBS=3** confirmed jobs; tiers `trusted|seasoned|helper|newcomer` (70/40/10). **Owner D2 2026-06-12** baked in. Anti-farm = DISTINCT requesters (can't grind with one buddy). Derives from `helpRequests` where `status==='done'` & this tenant is the HELPER (requester-confirmed → honest; §6 never self-claim). **NOT points-derived** (distinct from #6 Kindness which sums the `help_completed` ledger). NOTE: the roadmap's "derives from KYC #236" precondition was **dropped** — the shipped model is pure peer-confirmed job-history + appreciation tags.
- Wired in `functions/computeTrustScoresScheduled.js` (`computeVerifiedHelper` import :67; writes `verifiedHelper`/`verifiedHelperProvisional`/`verifiedHelperFactors{completedCount,distinctRequesters,totalTags,tagCounts,lastCompletedAt}` to `trustScores/{tid}`).
- Surfaces: `shared/dashboard-verified-helper.js` (admin card) + `shared/tenant-verified-helper.js` (tenant badge, `vh_consent_v1`) + both `__tests__/*` + `firestore.rules` protected field + refs in `tenant_app.html`/`dashboard.html`/`components.css`.

**∴ #7 needs NO build.** Action items (cheap, NOT this planning effort's scope):
- [ ] Confirm the script tags are actually wired live (`grep -n "tenant-verified-helper.js\|dashboard-verified-helper.js" tenant_app.html dashboard.html`) — files + tests exist; verify the `<script defer>` + render-hook are present (else it's an orphaned-API §7-QQ gap).
- [ ] Flip roadmap #7 `🟡 → ✅` + cite the shipping commit (find via `git log --oneline -- functions/_verifiedHelper.js`).
- [ ] **Gate = accrual only:** the score stays `provisional` until a helper has ≥3 requester-confirmed `done` jobs. Owner real-LINE verify once #2 accrues. No code.

---

## §1 — #11 Pet Playdate Booking · 🟢 buildable (clone facility-booking)
**What:** "ระบบนัดหมายกลุ่มเล่นของสัตว์เลี้ยง" — a tenant opens a playdate slot (date/time/place), neighbours' pets join up to a capacity, atomic conflict/capacity check.
**Readiness:** #10 live-verified ✅ (provides the public pet roster). Gate: none.

**Reuse (grep-verified):**
- `functions/createFacilityBooking.js` — `region('asia-southeast1').https.onCall` (:36), reads `facilityConfig/{configId}` (:110), **atomic `runTransaction`** conflict query on slot+timeSlot+date (:167-180). **This is the slot/lock template** → clone into `petPlaydates`.
- `shared/facility-booking.js` + `facility-booking-ui.js` — tenant slot-list + book UI.
- #10 `petProfiles/{petId}` (read-only) for which pets can attend (PROFILE_SAFE_FIELDS — no edit to `upsertPetProfile`, so **no #10 write-path collision**).
- `checkRateLimit` + `assertTenantAccess` standard guards.

**Data model `petPlaydates/{id}`** (top-level, building-scoped, CF-only-write):
```
{ id, hostPetId, hostTenantId, hostRoom, building, title, place, startAt, endAt,
  capacity, attendees:[{petId,tenantId,room,name}], status:'open'|'full'|'cancelled'|'done',
  createdAt, expiresAt }
```
**Callables (SE1 onCall):** `createPetPlaydate` (rate-limit; host owns the pet) · `joinPetPlaydate` (atomic `runTransaction` — capacity + dup-attendee check, the facility-booking conflict pattern) · `leavePetPlaydate`/`cancelPetPlaydate` · `cleanupPetPlaydatesScheduled` (clone the foodShares sweep — auto-expire past `endAt`).
**Rules:** new `match /petPlaydates/{id}` building-scoped read + `write:false` (copy foodShares shape).
**Frontend:** new `shared/tenant-pet-playdate.js` (clone `tenant-pet-social.js` skeleton — §7-A/U/N/V/X/FFF/JJJ) + sub-page `#pet-playdate-page` + entry button on `#pet-park-page` + nav hook + `.pet-playdate__*` CSS (§7-RR/III). LINE-notify attendees on create/cancel (reuse `_notifyHelper.pushAndRetry`).
**Decisions for owner:** capacity default? · same-building only (yes, mirror #10)? · who can create (any tenant w/ an approved pet)? · TTL of a past playdate.
**Collision:** LOW — reads #10, never writes it; all-new files + the usual `index.js`/`rules`/`tenant_app.html` append points.

---

## §2 — #12 Pet-friendly Matching Floors · 🟡 buildable, LIGHTEST (derive-only, lowest value)
**What:** "จับคู่อยู่อาศัย/แนะนำเพื่อนน้องในชั้น/พันธุ์เดียวกัน" — a DERIVED suggestion: "น้องแมวห้องใกล้คุณ" / "เพื่อนสุนัขพันธุ์เดียวกันในตึก".
**Readiness:** #10 live ✅. Gate: none.

**Design (no new collection / CF / index):** pure derive from the `petProfiles` snapshot the directory already subscribes to + the tenant's own pet `typeEmoji`/`breed` + `ownerRoom` (floor = room prefix). A `suggestMatches(myPets, allProfiles)` pure helper → a "🐾 น้องที่น่าจะถูกคอ" section. **Smallest ตัว** — effectively a new render section.
**⚠️ Collision note:** the natural home is `shared/tenant-pet-social.js` (the directory) — **but that file is owned by the pet/auth session.** Options: (a) ship #12 as a SEPARATE tiny module `shared/tenant-pet-matching.js` rendering into its own slot on `#pet-directory-page` (no edit to the contended file), or (b) **defer #12 until the pet session lands**, then fold it into the directory. Recommend (a) if built standalone, else (b).
**Value:** lowest of the pending set — a nicety on top of #10's friend graph. **Candidate to defer or skip** unless the owner wants the discovery nudge.
**Decisions:** match signal (same type? same breed? same floor? distance?) · standalone module vs fold into directory (collision) · is it worth building at all vs deferring.

---

## §3 — #14 Emergency Caretaker · 🟢 buildable (mirror #2 helper flow) — but has a #10-collision point
**What:** "ระบบหาคนช่วยดูแลสัตว์เลี้ยงยามฉุกเฉิน" — owner posts an urgent caretaker request (period + need), a neighbour accepts, completes.
**Readiness:** #10 live ✅ + #2 helper pattern shipped. Gate: none.

**Reuse:** the #2 **`helpRequests` request→accept→complete→cancel** 4-callable template + `_helpRequestEngine` (status `open|accepted|done|cancelled`, `helperUid/helperTenantId`, building-scoped read rule, LINE-notify-on-transition). #14 is the SAME shape for pet-sitting. Reuse `_notifyHelper` + `assertTenantAccess` + `checkRateLimit`.

**Data model `caretakerRequests/{id}`** (clone `helpRequests`): `{ requesterUid, petId, building, room, period:{from,to}, need, status, caretakerUid, caretakerTenantId, caretakerName, createdAt, acceptedAt, completedAt }`.
**Callables (SE1 onCall):** `postCaretakerRequest` · `acceptCaretakerRequest` · `completeCaretakerRequest` (requester-confirmed — honest, §6) · `cancelCaretakerRequest`. Each LINE-notifies the counter-party.
**Frontend:** new `shared/tenant-pet-caretaker.js` (clone tenant-helpers.js / tenant-pet-social.js) + sub-page + entry button + nav hook + CSS.
**⚠️ Collision point — the `caretakerOptIn` flag:** the roadmap suggests a "caretaker opt-in flag on the pet profile." Storing it on `petProfiles` means editing `upsertPetProfile.js` + `_petSocialEngine.js` + `tenant-pet-social.js` — **all owned by the pet/auth session.** **Recommended dodge:** make caretaking a per-REQUEST flow (no persistent opt-in flag) — anyone in the building can accept an open request, exactly like #2 (no profile edit needed). Drop the opt-in flag for v1. If a persistent "I'm available to pet-sit" roster is wanted later, store it on a SEPARATE `caretakerVolunteers/{tenantId}` doc, never on `petProfiles`.
**Could double as #7's accrual feeder?** No — keep #14 point-free/separate; it's care, not the help-job credential.
**Decisions:** per-request only vs persistent opt-in (collision) · reward (none / a kindness tie-in?) · same-building only.
**Collision:** MEDIUM if opt-in-on-profile; **LOW if per-request only** (recommended).

---

## §4 — #16-v2 Farewell Archive + AI Summary · 🔵 buildable but needs a NET-NEW AI-infra decision
**What:** on move-out — a "Memory wall" + an **AI-generated summary** of the tenant's life in the community, gifted before they leave. v1 (derive-only card `#tlf-card`) already shipped; v2 adds the AI prose + the move-out hook.
**Readiness:** gate none, BUT this is the only pending ตัว that introduces **net-new infrastructure**.

**Reuse / hook points (grep-verified):**
- `functions/archiveTenantOnMoveOut.js` — `region('asia-southeast1').https.onCall` (:125), archives the live doc → `tenants/{building}/archive/{contractId}` (:183, a SUBcollection, not top-level), preserving `gamification`/badges/payment history/wellness. **This is the move-out moment** an AI summary hooks into (read the rich tenant data here).
- `shared/tenant-farewell.js` `deriveFarewell()` — v1 surface (`#tlf-card`: tenure + 2×2 stat grid + farewell-tone on `lease.endDate ≤ 45d`/ended). v2 renders the AI prose into/above this card.
- Secret pattern: `runWith({secrets:[...]})` + `region('asia-southeast1')` (the LINE/verifySlip CFs' model).

**🔴 AI infra is 100% NET-NEW** (grep `anthropic|claude|openai|gpt|gemini|generativeai` over `functions/`/`shared/`/`*.html` → **zero app-level hits**; only `firebase-functions`'s bundled Vertex/Gemini provider sits unused in `node_modules`). So #16-v2 adds: a new API key/secret, a new CF dependency, real cost + latency, and PDPA weight (an AI summary of a person = personal data).

**🔑 BIGGEST OWNER DECISION — the AI provider + trigger:**
| Choice | Option A (recommended) | Option B |
|--------|------------------------|----------|
| **Provider** | **Anthropic Claude** (`ANTHROPIC_API_KEY` secret; CLAUDE.md "default to latest Claude models" — use a cheap fast model e.g. `claude-haiku-4-5` for a short warm summary). New secret via `firebase functions:secrets:set` (§7-WW: verify in the deploy project, test-deploy ONE CF first). | Firebase **Vertex AI / Gemini** (provider already in `node_modules`; no new vendor key but Google AI, different prompt ergonomics). |
| **Trigger** | **Admin "🎁 gift summary" button** at move-out (preview → owner sends — §7-I, never auto on an irreversible AI spend) | Auto-compose inside `archiveTenantOnMoveOut` (cheaper UX, but inline AI in a callable = latency + §7-I concern). |

**Data model / flow:** `composeFarewellSummary` onCall (SE1, `runWith({secrets:['ANTHROPIC_API_KEY']})`, admin-gated) → reads the tenant's archived/live data → calls Claude with a bounded prompt (tenure, badges, trades, help given, milestones — NO sensitive PII beyond what the tenant earned) → writes `farewellSummary{text, model, generatedAt}` to the tenant/archive doc → `tenant-farewell.js` renders it on `#tlf-card`. **PDPA:** `farewell_v1` consent (the summary is personal data) + add to `exportMyData` + erase in `requestDataDeletion` (§7-DD/§30/§32) — same pattern the pet-social/kindness consents follow (BUT `recordChecklistConsent.js` is auth-session-owned right now → coordinate / defer the consent-purpose add).
**Anti-patterns:** §7-NN onCall · §7-I admin preview before the AI send · §7-WW secret in the right project, test-deploy one CF · §7-YY if it ever does multipart (it won't — JSON to Claude) · cost: a short summary, capped tokens, NOT inline-per-pageload.
**Decisions:** provider+trigger (table above) · model+cost ceiling · prose length/tone (Thai, warm, muji) · consent purpose `farewell_v1`.
**Collision:** LOW on new files; the `recordChecklistConsent.js` consent-purpose add + `archiveTenantOnMoveOut.js` hook are the shared touch points (coordinate with auth session).

---

## §5 — Recommended build order (readiness × collision × value)
| Order | ตัว | Why this slot | Collision |
|-------|-----|---------------|-----------|
| **1** | **#13 Lost Pet Alert** (planned) | highest safety value, no #10 dep, lowest collision; ready to build when the tree settles | LOW |
| **2** | **#11 Pet Playdate** | clean facility-booking clone, reads #10 read-only, all-new files | LOW |
| **3** | **#16-v2 Farewell AI** | the blueprint's signature "gift" (emotional lock-in); decide AI provider+secret in parallel NOW, build once chosen | LOW + new infra |
| **4** | **#14 Emergency Caretaker** | valuable; build per-request (no profile opt-in) to stay LOW-collision; after pet session lands | LOW (if per-request) |
| **5** | **#12 Pet-friendly Matching** | lowest value/effort; standalone module or fold into directory later — **candidate to defer/skip** | LOW |
| — | **#7 Verified Helper** | ✅ code-complete — flip roadmap + accrual + owner verify, no build | none |

**Net:** of the 6 "pending", **#7 is actually done**, **#12 is a defer/skip candidate**, leaving **4 real builds: #13 → #11 → #16-v2 → #14.** All build behind `validate.yml`, in worktrees off `origin/main`, landing after the deposit + auth sessions merge to avoid `index.js`/`firestore.rules` rebase churn.

## Review (fill as each ships)
- _Planning only (2026-06-13). #7 doc-drift caught (code-complete). No code written. Awaiting owner approval of order + per-ตัว decisions._
