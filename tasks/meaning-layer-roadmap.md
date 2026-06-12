# Meaning Layer Roadmap — "ทำทั้งหมด ทีละตัว"

**Created:** 2026-06-08
**Source:** `proptech_unicorn_living_os_blueprint.pdf` — **Phase 2: The Meaning Layer (Community & Emotional Architecture)** — "เปลี่ยนตึกคอนกรีต ให้กลายเป็นระบบนิเวศแห่งความผูกพัน เพื่อลดอัตราการย้ายออก"
**Basis:** gap analysis 2026-06-08 (blueprint vs live code). Of ~17 Meaning-Layer sub-features, **only Reputation v1 has real data**; ~14 have **no capture flow yet** (the actions aren't recorded → the scores can't be computed).
**Companion docs:** [phase-3.2-trust-system-plan.md](phase-3.2-trust-system-plan.md) (Trust detail) · [core-readiness-roadmap.md](core-readiness-roadmap.md) (Phase 0–3.1 — DONE)

> **Working principle** ([[feedback_decision_protocol]] 2026-06-08): we build the **whole** Meaning Layer, **one ตัว at a time**, sustainably. This doc is the **order**, not a menu to pick a subset from. **Flip the checkbox + cite the PR the same session a ตัว ships** (mirror `core-readiness-roadmap.md` discipline — §7-K doc-drift).

---

## หลักความยั่งยืน (sustainability principles — apply to every ตัว)

1. **แต่ละตัว = 1 PR ที่ ship เองได้ + มีคุณค่าในตัว.** No big-bang, nothing half-wired. Behind `validate.yml`; tests for the surface ship with it.
2. **Capture before Score.** Build the data-capture flow before the metric that consumes it — several scores read the same capture, so the primitive comes first to avoid rework.
3. **Reuse, don't reinvent.** Every pet/economy/memory feature has an existing pattern to extend (verified paths in each ตัว below).
4. **Respect data-readiness gates.** A score is only as honest as its accrued data — some ตัว must wait weeks for capture to fill (like Reputation v1 only worked because bills/leases already existed).
5. **No breadth sweeps.** One surface per PR ([[feedback_score_instability_breadth_trap]]; the §7-SS/RR/QQ/TT incidents were all self-inflicted by mass edits).

---

## Status (12 shipped · 4 pending)

| # | ตัว | Pillar | Status |
|---|-----|--------|--------|
| 0 | Reputation score v1 | Trust | ✅ SHIPPED (#288/#289) |
| 1 | Community Quests engine | Trust | ✅ SHIPPED (server #296 + UI) |
| 2 | Helper-request lifecycle | Trust | ✅ SHIPPED (#303 server + #304 UI) |
| 3 | Community requests board | Micro-Econ | ✅ SHIPPED (#312 server + UI) |
| 4 | Food sharing feed | Micro-Econ | ✅ SHIPPED (#314 server + UI) |
| 5 | Trade history memory | Micro-Econ | ✅ SHIPPED (#325 — achievement, NOT points) |
| 6 | Kindness score | Trust | ✅ SHIPPED — server+admin (#329/#330/#331) + tenant tier badge v1.x (#333 server+rules · #334 frontend); prod-verified 2026-06-11 (rules ✅ `kindnessTier` in deployed ruleset · sweep mirrored `nest/N101.kindnessTier=kind`); on-device 🤲 "มีน้ำใจ" render owner-confirmed on real LINE 2026-06-11 ✅ |
| 7 | Verified Helper | Trust | 🟡 gated on #2 job history |
| 8 | Resident Rank | Trust | ✅ SHIPPED (#338 server+rules+admin + #339 tenant badge); owner real-LINE verify pending |
| — | Reputation v2 (engagement dim) | Trust | ✅ SHIPPED 2026-06-13 (#343 — additive engagement bonus, early) |
| 9 | Pet health memory | Pet | ✅ SHIPPED (#327 — append-only timeline + DSR export) |
| 10 | Pet Social Graph | Pet | ✅ SHIPPED — PR1 server (`f174f02`, callables+rules live) + PR2 frontend (`4dd1ba3`, directory+opt-in+friend UI, Vercel deployed); owner real-LINE live-verify pending |
| 11 | Pet playdate booking | Pet | 🔴 after #10 |
| 12 | Pet-friendly matching floors | Pet | 🔴 after #10 |
| 13 | Lost pet alert | Pet | 🔴 buildable now |
| 14 | Emergency caretaker | Pet | 🔴 after #10 |
| 15 | Life Timeline | Tenant | ✅ SHIPPED ([#335](https://github.com/soulgroundliving/the-green-haven/pull/335)) — owner real-LINE verify pending |
| 16 | Farewell Archive + AI Summary | Tenant | 🟡 v1 SHIPPED ([#336](https://github.com/soulgroundliving/the-green-haven/pull/336)) — AI summary = v2 |

**Sequencing logic:** capture flows (1–5) first because they unlock the retention-moat scores (6–8 = blueprint Core Metric 3 "Emotional Lock-in") → then Pet ecosystem (9–14) → then Tenant memory (15–16). Within a pillar, build the shared primitive (e.g. #10 graph) before its consumers (#11/#12/#14).

---

## Pillar map (blueprint Phase 2)

- **Trust & Economy** — Deep Marketplace & Trust (#0,1,6,7,8) · Community Quests (#1) · Micro Economy (#3,4,5)
- **Emotional Network** — Deep Pet Ecosystem (#10,11,12) · Safety & Care (#9,13,14)
- **Deep Tenant System** ("Territory of Memories") — Life Timeline (#15) · Farewell Archive + AI (#16) · Neighbour Bonds card (bonus, #349 — social-memory from helpRequests)

---

## Sequenced build plan

### 0 — Reputation score v1 · ✅ SHIPPED (#288/#289)
**What:** server-computed reliability 0–100 per tenant; tenant sees coarse tier badge only.
**Lives in:** `functions/_reputation.js` (pure core: payment 60% / tenure 25% / complaint-free 15%) → `trustScores/{tenantId}` {reputation, provisional, factors, computedAt}; tier enum mirrored onto `tenants/{b}/list/{r}.reputationTier`. CF `computeTrustScoresScheduled` (daily 05:40 BKK) + admin `recomputeTrustScores` callable. Admin card `shared/dashboard-reputation.js`; tenant badge `shared/tenant-reputation.js`.
**This is the template** for #6/#7/#8 — same write-locked doc, same daily sweep, same "Trust ≠ points / server-only" stance.

---

### 1 — Community Quests engine · ✅ SHIPPED 2026-06-08 (server #296 `dcbec48` + UI)
**Shipped:** daily tap-to-claim checklist; `quests/` catalog + `questClaims/` fence + `gamification.questsToday` state; `claimQuest`/`reviewQuestClaim` callables + pure `_questEngine.js`; `pointsLedger source:'quest'`; admin Gamification→เควส tab (catalog CRUD + review queue) + tenant `tenant-quests.js` checklist. verifyMode self/auto/admin. **Owner trims:** energy auto cut (meter_data is monthly), self cap 10, tenants-only + daily/once UI. Lifecycle: [[lifecycle_community_quests]]. **Open:** owner real-LINE live-verify (tap a quest → points; admin approve a pending claim).

**What:** turn real-life behaviors into quests — "ช่วยยกของให้เพื่อนบ้าน", "ปิดไฟ/แอร์ก่อนออกครบ 7 วัน", "ช่วยรดน้ำต้นไม้ส่วนกลาง", "Silent Helper" → แลกสิทธิประโยชน์.
**Captures (proposed):** `quests/{questId}` (definition: title, type, reward, cadence, verifyMode) + completion → append to **`pointsLedger/{idempotencyKey}`** with a new `source:'quest'` value (+ `refId: questId`). Energy-saver quests can verify off the `meter_data` signal the #276 energy card already reads — no self-claim.
**Depends / Reuses:** `pointsLedger` (verified: `functions/_pointsLedger.js`, `source` enum at line ~25 — **extend the enum** for `'quest'`) + gamification points display.
**Gate:** none.
**Value:** standalone engagement + behavior change NOW; **the capture primitive that #6 Kindness sums.** Highest unlock-per-effort.
**Guardrails:** anti-gaming — peer/auto-verified completion only, cap per-day quest credit; §7-NN callable; §7-T grep `pointsLedger` readers before adding the `source` value.

### 2 — Helper-request lifecycle · ✅ SHIPPED 2026-06-09 (PR #303 server `e132b04` + #304 UI `c06ab04`)
**Shipped:** `helpRequests/{id}` board (open→accepted→done + cancelled); 4 transition callables (post/accept/complete/cancel, SE1, §7-NN) + pure `_helpRequestEngine`; building-scoped read rule (CF-only write); `pointsLedger source:'help_completed'` (+20 peer-confirmed → feeds #6/#7); tenant `#helper-board` sub-page (`tenant-helpers.js`, 3 live sections) + admin "น้ำใจ" monitor (`dashboard-helpers-admin.js`). Owner decisions baked: requester confirms+rates · LINE push IN · reward 20 · admin monitor IN. CFs verified `firebase functions:list`; rules deployed. **Open:** owner real-LINE live-verify (board is LIFF-auth-gated). Lifecycle: [[lifecycle_helper_requests]].
**What:** neighbor asks for help → another accepts → completes → **peer rating**.
**Captures (proposed):** `helpRequests/{id}` { requesterUid, building, room, title, status: open→accepted→done, helperUid, rating, createdAt } (§7-T status-enum writer/reader). One callable per transition.
**Depends / Reuses:** request/notification pattern (maintenance + announcements precedent); LINE notify infra.
**Gate:** none.
**Value:** real neighbor help NOW; **unlocks #7 Verified Helper + feeds #6 Kindness (helper side).**
**Guardrails:** §7-NN callable not trigger; rate-limit request creation; sender==auth.uid (anti-spoof); PDPA (names visible to building).

### 3 — Community requests board · ✅ SHIPPED 2026-06-09 (PR #312 server + UI)
**Shipped:** `communityRequests/{id}` board (open→offered→fulfilled + cancelled); 4 transition callables (post/offer/fulfill/cancel, SE1, §7-NN) + pure `_communityRequestEngine`; building-scoped read rule (CF-only write); tenant `#community-requests` sub-page (`tenant-community-requests.js`, Profile 🔄 tile, 3 live sections) + admin "🔄 ขอ-ยืมของ" monitor (`dashboard-community-requests-admin.js`). `requestKind` (🔁 ขอยืม / 🎁 ขอแบ่ง) + item categories distinguish it from #2's labour board. **Awards NO points — deliberately outside #6 Kindness** (sources `{quest, food_share, giveaway, help_completed}` exclude it), so no farm surface; reward = the connection + a thank-you note. offer/fulfill reuse the existing `LINE_CHANNEL_ACCESS_TOKEN` (§7-WW-safe, no new secret). 52 tests; functions 2190/0, rules 294/0, shared 484/0. Auto-deploys on merge (deploy-functions + deploy-rules + Vercel). **Open:** owner real-LINE live-verify (board is LIFF-auth-gated). Lifecycle: [[lifecycle_community_requests]]. Next capture ตัว = **#4 Food sharing feed**.
**What:** "บอร์ดกระจายคำร้องขอจากคนในตึก" — ใครมี X ให้ยืม/ขอ/ช่วยได้บ้าง.
**Captures:** `communityRequests/{id}` — same lifecycle shape as #2 (open→fulfilled), reused the #2 callable + rule pattern wholesale.
**Depends / Reuses:** #2 (built right after — same mental model loaded = sustainable batching).
**Gate:** none. **Value:** turns the building into a micro-economy; low marginal cost on top of #2.

### 4 — Food sharing feed · ✅ SHIPPED 2026-06-09 (PR #314 server + UI)
**Shipped:** ephemeral `foodShares/{id}` share→claim feed (available→claimed + cancelled); 3 callables (share/claim/cancel, SE1, §7-NN) + `cleanupFoodSharesScheduled` (daily 03:20 BKK, single-field expiresAt sweep) + pure `_foodShareEngine`; building-scoped read rule (CF-only write); tenant `#food-share` sub-page (`tenant-food-share.js`, Profile 🍲 tile, 3 sections + ⏳ expiry countdown) + admin "🍲 แบ่งปันอาหาร" monitor. **The SHARER earns peer-confirmed `food_share` points on claim** (reward 10, own daily cap 50 — anti-farm; extends `_pointsLedger` VALID_SOURCES 8→9 — #4 IS in the #6 Kindness set, unlike #3). Ephemeral: expiresAt default 24h/max 72h, client hides expired + the cron sweeps. claimFood reuses the existing LINE secret (§7-WW). 68 tests; functions 2241/0, rules 318/0, shared 484/0. Auto-deployed (deploy-functions + deploy-rules + Vercel). **Open:** owner real-LINE live-verify (LIFF-gated). Lifecycle: [[lifecycle_food_sharing]]. Next capture ตัว = **#5 Trade history memory**.
**What:** "คืนนี้มีคนปล่อยของกินเหลือ" — ephemeral share feed.
**Captures:** `foodShares/{id}` { sharerUid, building, title, claimerUid, expiresAt, … } + claim action → `pointsLedger source:'food_share'` (awards the SHARER, peer-confirmed).
**Depends / Reuses:** the #2 award+cap pattern + the cleanup-sweep precedent (`cleanupChecklistsScheduled`); LINE notify.
**Gate:** none. **Value:** light, high-frequency kindness signal; feeds #6.

### 5 — Trade history memory · ✅ SHIPPED 2026-06-09 (PR #325 server + UI)
**Shipped:** durable `tradeHistory/{postId}` written on every marketplace completion (one per post, fenced by the same `marketplaceLedger[postId]`, survives post deletion) + a `tradesCompleted` counter → **Community Trader achievement** at 10 trades (📜 `BADGE_CATALOG` entry, auto-renders in the tenant badge grid). Extends the existing `marketplaceStatsAggregator` CF (NO new board, NO new CF). Admin read-only "📜 ประวัติแลกเปลี่ยน" monitor. Lifecycle: [[lifecycle_trade_history]].
**Owner decision (don't re-litigate):** **awards NO points** — marketplace completion is **self-attested** (owner closes their own post; no peer claim/confirm like #4), and points = money, so points would be a farm surface. Reward = a cosmetic achievement instead. **No `pointsLedger source:'giveaway'` created** — so #6 Kindness sums `{quest, food_share, help_completed}` (the originally-planned `giveaway` 4th source is intentionally not built; revisit only via a peer-confirm path, never self-close).
**Tests:** aggregator 23/23 (6 new), rules 306/306 (6 new), shared 484/484. Full CF suite 2267, CSP unchanged. **Open:** owner real-LINE live-verify (complete a trade → admin monitor row; reach 10 → badge). **#1–5 capture block COMPLETE → #6 Kindness unblocked (accrual only).**

### 6 — Kindness score · ✅ SHIPPED server+admin 2026-06-10 (#329 + #330 + #331)
**What:** "คะแนนความมีน้ำใจ" — generosity 0–100, positive-framed (never "ต่ำ"/red).
**Shipped:** pure `functions/_kindness.js` (`computeKindness`: sums the 3 kind-EARN sources `{quest, food_share, help_completed}` — trade #5 excluded per its self-attested decision; `clamp01(totalPoints/300)×100`; `provisional` < 3 events = accrual gate) → additive `kindness`/`kindnessProvisional`/`kindnessFactors` on `trustScores/{tenantId}` in the SAME daily sweep (`computeTrustScoresScheduled`). Admin card `shared/dashboard-kindness.js` (Insights→ผู้เช่า, ranks givers, ⟳ recompute). Reuses the #0 pattern exactly (write-locked doc, server-only, Trust ≠ points). No rules/index change.
**⚠️ §7-J finding (the live-verify earned its keep):** the active tenant scored kindness=0 despite 4 real quests because the capture CFs tag `pointsLedger.tenantId` with the `${building}_${room}` form (`nest_N101`), NOT the canonical roster `tenantId` (`TENANT_…`). #330 fixed the sweep to JOIN by `${building}_${roomId}` first, canonical tenantId fallback. Live-verified on prod: N101 → kindness 13 (4 quests).
**Pending sub-phase:** tenant-facing tier badge v1.x (consent-gated, tier-only) — mirror reputation #288/#289 (`kindnessTier` enum + sweep mirror onto tenant doc + protected-field rule + `kindness_v1` consent + DSR; `tenant-kindness.js`). Capture-CF cleanup (write canonical tenantId + migrate) is an optional separate revisit — the sweep join handles it robustly without migration.
**Guardrails honoured:** §6 Trust ≠ points (reads only the kind-EARN subset, never spendable `gamification.points`); server-computed only; §7-N/§7-AAA (single-field `in`, no composite, no limit).

### 7 — Verified Helper · 🟡 gated on #2 job history
**What:** "ผู้ช่วยชุมชนที่ยืนยันตัวตน" — safe-to-hire badge → gates paid helper market (**revenue Tier 3**).
**Captures:** *none new* — derives from KYC (#236) AND ≥N completed+rated #2 jobs AND avg rating ≥ threshold → `trustScores/{tenantId}.verifiedHelper` {bool, tier}.
**Depends:** #2 live + accrued. **Reuses:** #236 KYC gate, #2 rating data.
**Guardrails:** liability/ToS depth = owner decision (phase-3.2 §8 Q4).

### 8 — Resident Rank · ✅ SHIPPED 2026-06-12 (PR1 #338 server+rules+admin + PR2 #339 tenant badge)
**What:** "แรงก์ตามการมีส่วนร่วม" — composite growth ladder. **The Emotional-Lock-in display** (blueprint Core Metric 3 — "you'd lose แกนนำ rank if you leave").
**Shipped:** pure `functions/_residentRank.js` `computeResidentRank()` → `round(0.40·reputation + 0.30·kindness + 0.30·verifiedHelper)` (**owner "สมดุล"**; tenure rides inside reputation, NOT double-counted) → 5-rung enum `taproot|canopy|rooted|sprout|seed` (**owner growth ladder**: เมล็ดใหม่ → ต้นกล้า → ไม้ประจำถิ่น → ร่มเงาของตึก → รากแก้วชุมชน; bounds 75/55/35/15). Additive on `trustScores/{tid}` in the SAME daily sweep + `residentRankTier` as the 4th tier in the combined mirror (§7-T) + protected-field rule (§6) + `resident_rank_v1` consent. Admin card `shared/dashboard-resident-rank.js` + tenant badge `shared/tenant-resident-rank.js` (`.rr-card` 5-step green ladder). **Top rungs UNREACHABLE on reputation alone (cap 0.40·100=40) → participation lock-in by design.** Reuses the #0/#6/#7 architecture exactly (write-locked doc, server-only, Trust ≠ points). 43 new tests (17 engine + 9 admin + 17 tenant + sweep/rules/consent). prod: deploy-rules ✅ + deploy-functions ✅ + Vercel ✅; static-harness light+dark verified. **Open:** owner real-LINE verify (กดยินยอม → badge). Lifecycle: [[lifecycle_trust_reputation]] (Resident Rank section).
**⚠️ Distinct from gamification rank** (Seedling/etc. in `complaintAndGamification.js`) which is points-based — this is Trust-derived (§6).
**Trust pillar #0/#6/#7/#8 + Reputation v2 COMPLETE.** Next Trust = v3 ideas (~later).

### — Reputation v2 (engagement dimension) · ✅ SHIPPED 2026-06-13 (#343 — shipped EARLY)
Added the engagement-consistency dimension to #0 as an **ADDITIVE, positive-only bonus** (owner decision — NOT a re-weighting): `reputation = min(100, v1_base + round(activeWeeks/8·10))`, +10 max. Can only RAISE the score (live metric/tiers/resident-rank input never drop; no-history → bonus 0 = v1 → self-safe, so it shipped early — the ~Aug gate was conservative, `daily_login` already had history). §6: counts PRESENCE (distinct active weeks), never points value → not farmable. Pure `computeEngagement()` in `_reputation.js` + one `pointsLedger in ENGAGEMENT_SOURCES` sweep read (§7-J join) + admin `⚡ +N`. No rules/CSP/tenant change. Detail: [[lifecycle_trust_reputation]] (Reputation v2 section).

---

### 9 — Pet health memory · 🔴 buildable now
**What:** "สมุดบันทึกสุขภาพและวัคซีน" → ongoing health timeline (vet visits, weight, meds, vaccines over time).
**Captures (proposed):** extend pet doc `tenants/{b}/list/{r}/pets/{petId}` with a `health` subcoll (entries: type, date, note, fileURL). Today only a one-time vaccine-book file exists.
**Depends / Reuses:** existing pet registry + Storage `pets/{b}/{r}/{petId}/` (verified: [[lifecycle_pets_registration]]).
**Gate:** none. **Guardrails:** PDPA (vaccine/health = sensitive); storage.rules claim-match already tightened.

### 10 — Pet Social Graph · ✅ SHIPPED (PR1 `f174f02` + PR2 `4dd1ba3`)
**What:** "สร้างโปรไฟล์และผูกความสัมพันธ์ระหว่างสัตว์เลี้ยงในตึก."
**Captures (proposed):** public pet profile (opt-in) + `petLinks/{id}` (friend edges). Foundation for #11/#12/#14.
**Depends / Reuses:** pet registry. **Gate:** none. **Guardrails:** owner consent to make a pet profile building-visible (PDPA opt-in).

### 11 — Pet playdate booking · 🔴 after #10
**What:** "ระบบนัดหมายกลุ่มเล่นของสัตว์เลี้ยง (Pet playdate booking)."
**Captures (proposed):** `petPlaydates/{id}` slot + attendees, atomic conflict-check.
**Depends:** #10. **Reuses:** facility-booking atomic tx (verified: `functions/createFacilityBooking.js` + `shared/facility-booking.js`) — clone the slot/lock pattern.
**Gate:** none.

### 12 — Pet-friendly matching floors · 🔴 after #10
**What:** "จับคู่อยู่อาศัยในชั้นที่เป็นมิตรต่อสัตว์เลี้ยงประเภทเดียวกัน."
**Captures:** derived suggestion from #10 graph + pet type + room/floor data. **Depends:** #10. **Gate:** none.

### 13 — Lost pet alert · 🔴 buildable now
**What:** "วันนี้แมวหาย" → urgent building-wide broadcast so everyone watches.
**Captures (proposed):** `petAlerts/{id}` (active flag, photo, last-seen) → fan-out push.
**Depends / Reuses:** LINE notification + broadcast infra (verified: `shared/broadcasts.js`, [[lifecycle_line_notification]]).
**Gate:** none. **Guardrails:** rate-limit (no alert spam); auto-expire.

### 14 — Emergency caretaker · 🔴 after #10
**What:** "ระบบหาคนช่วยดูแลยามฉุกเฉิน."
**Captures (proposed):** caretaker opt-in flag on pet profile + a request→accept flow (mirror #2). **Depends:** #10 (+ #2 pattern). **Gate:** none.

---

### 15 — Life Timeline · ✅ SHIPPED 2026-06-12 (PR #335)
**Shipped:** read-only tenant "journey" sub-page (Profile → 🪴 ไทม์ไลน์ชีวิต), **DERIVE-only from the tenant's own doc** `tenants/{b}/list/{r}` — no new collection / index / capture. Events: ย้ายเข้า (`lease.moveInDate || startDate`, §7-BBB) · อยู่ครบ N ปี (derived from move-in + wall clock) · ได้รับเหรียญ (`gamification.badges[].earnedAt`) · สัญญาครบกำหนด (`lease.endDate`, future-only accent) + a warm tenure intro. Pure `deriveTimeline()`/`anniversaries()`/`tenureText()` — 17 tests; full `test:shared` 593/0. `shared/tenant-life-timeline.js` + `.tl-*` (components.css, §7-RR) + tile/sub-page/script (tenant_app.html) + `showSubPage` hook (tenant-navigation.js). Static-harness verified (light render + dark computed-values §7-III). **v2 deferred:** cross-room transfers (occupancyLog `getByTenant` needs the `{tenantId,at}` composite index — §7-J — + canonical tenantId + extra include). **Open:** owner real-LINE live-verify (LIFF-gated). Lifecycle: [[lifecycle_life_timeline]].
**What:** "Move-in journey / First-night welcome / Room memory timeline" — เช่น "อยู่ครบ 1 ปี".
**Captures:** mostly **reads existing data** (lease start, milestones, events) + a few milestone markers. Low-risk — derive a timeline view from data already captured.
**Depends / Reuses:** lease (`leases/{b}/list`), occupancyLog, events. **Gate:** none.

### 16 — Farewell Archive + AI Summary · 🟡 v1 SHIPPED 2026-06-12 (PR #336)
**Shipped (v1, no AI):** a derive-only farewell / journey-summary card at the top of the 🪴 Life Timeline page (`#tlf-card`) — built ENTIRELY from the tenant's own doc `tenants/{b}/list/{r}` (no new collection / index / capture / CF). Tenure + a 2×2 stat grid (🏅 badges · ✨ points · 🤝 trades · 🔥 streak) + a warm message that shifts to a FAREWELL tone when `lease.endDate ≤ 45d` or `status:ended` (the only client-readable move-out signal — `leaseRequests` is admin-read-only). Always visible (testable now). `shared/tenant-farewell.js` (pure `deriveFarewell()` 12 tests) + `.tlf-*` (components.css) + `#tlf-card` slot + `showSubPage` hook. Static-harness light + dark (§7-III). **Open:** owner real-LINE live-verify. Lifecycle: [[lifecycle_farewell]] (write on merge).
**What (v2):** on move-out — "Memory wall" + AI summary of the tenant's life in the community, gifted before they leave.
**Captures / Reuses:** `archiveTenantOnMoveOut` already moves docs to `archive/{contractId}/*` (verified earlier) — add a memory-wall compose + AI summary step (callable). **Depends:** #15 helps. **Gate:** none. **Guardrails:** PDPA (summary = personal data, consent + DSR); AI cost/latency = callable not inline.

---

## Cross-cutting guardrails (every ตัว)
- **Backend = `onCall`, never Firestore trigger** (§7-NN — Firestore in SE3, Eventarc unsupported). Invoke from client after the write.
- **Trust = server-computed only; Trust ≠ points** (§6) — never buyable, or the retention moat collapses.
- **New field/UI → grep writer + reader first** (§7-T). **Composite index READY before any `where+orderBy`** (§7-J).
- **Any claim mint → `setCustomUserClaims` twin** (§7-Z). **Tenant LIFF reads → `_onLiffClaimsReady` + claim guard** (§7-A/U); live-verify on real LINE.
- **PDPA** for every personal-data feature (consent #236/#238 gate, DSR export, retention) — pets health, profiles, helper identity, farewell summary all qualify.
- **Production data actions → preview, never auto-`.click()`** (§7-I). **One surface per PR; no sweeps.**

## Data-readiness gates (when each can START)
| ตัว | Blocker | Earliest |
|-----|---------|----------|
| 1–5, 9, 10, 13, 15, 16 | none | now |
| 11, 12, 14 | #10 live | after #10 |
| 6 (Kindness) | ~weeks of #1–5 accrual | after #1–5 + accrual |
| 7 (Verified Helper) | #2 job history | after #2 + accrual |
| 8 (Resident Rank) | #6 + #7 live | ✅ SHIPPED 2026-06-12 |
| Reputation v2 | ~1–3 mo pointsLedger | ✅ SHIPPED 2026-06-13 (early — daily_login had history) |

---

## Review (flip + cite as each ตัว ships)
- **2026-06-08:** roadmap created from blueprint Phase 2 gap analysis. Confirmed live: only Reputation v1 (#288/#289) has real data; #1–16 have no capture. Verified reuse paths (`_pointsLedger.js source` enum, `createFacilityBooking`, `broadcasts.js`). Order chosen capture-first (1–5) → trust scores (6–8) → pet (9–14) → tenant memory (15–16).
- **2026-06-08 — #1 Community Quests SHIPPED.** Server PR #296 (`dcbec48`, merged + deployed: 2 callables via CI + rules) + UI PR (admin เควส tab + tenant checklist, Vercel). Engine pure-TDD (61 quest tests); rules 298/0; shared 484/0. Owner review trimmed energy-auto + cap→10 + tenants-only/daily-once. Next capture ตัว = **#2 Helper-request lifecycle**. Lifecycle doc [[lifecycle_community_quests]].
- **2026-06-09 — #2 Helper-request lifecycle SHIPPED.** Server PR #303 (`e132b04`) + UI PR #304 (`c06ab04`) + appreciation-tags refinement #306–311 (warm tags not stars, thank-you note surfaced, daily kindness-points cap 60/day). `helpRequests` board + 4 callables + `pointsLedger source:'help_completed'` (+20 peer-confirmed → feeds #6/#7). Next capture ตัว = **#3 Community requests board**. Lifecycle doc [[lifecycle_helper_requests]].
- **2026-06-09 — #3 Community requests board SHIPPED.** PR #312 (`580b1d7`, server + UI in one PR; auto-deploys via deploy-functions + deploy-rules + Vercel). `communityRequests` board (open→offered→fulfilled), 4 transition callables + pure `_communityRequestEngine`, building-scoped read rule, tenant 🔄 sub-page + admin monitor. Clones #2 wholesale but for ITEMS (borrow/share, `requestKind`) and **awards NO points** — deliberately outside the #6 Kindness source set, so zero farm surface + clearly distinct from #2. 52 new tests (functions 2190/0, rules 294/0, shared 484/0). Next capture ตัว = **#4 Food sharing feed**. Lifecycle doc [[lifecycle_community_requests]].
- **2026-06-09 — #4 Food sharing feed SHIPPED.** PR #314 (`fbd6fba`, server + UI in one PR; auto-deploys). Ephemeral `foodShares` share→claim feed + 3 callables + `cleanupFoodSharesScheduled` (daily sweep) + pure `_foodShareEngine`. **First points-awarding capture since #2** — the SHARER earns `food_share` (reward 10, own daily cap 50, anti-farm peer-confirmed-on-claim); extends `_pointsLedger` 8→9 sources (#4 IS in the #6 set). Ephemeral via expiresAt (24h/72h) + client-hide + cron sweep. 68 new tests (functions 2241/0, rules 318/0, shared 484/0). Next capture ตัว = **#5 Trade history memory** (last of the #1–5 capture block → then #6 Kindness can compute). Lifecycle doc [[lifecycle_food_sharing]].
- **2026-06-09 — #5 Trade history memory SHIPPED.** PR [#325](https://github.com/soulgroundliving/the-green-haven/pull/325) (`e4896b2`, server + UI in one PR; auto-deploys via deploy-functions + deploy-rules + Vercel). Durable `tradeHistory/{postId}` written on every completion (fenced by `marketplaceLedger[postId]`, survives post deletion) + `tradesCompleted` counter → **Community Trader** achievement at 10 (📜). Extends the existing `marketplaceStatsAggregator` (no new board/CF). Admin "📜 ประวัติแลกเปลี่ยน" monitor (§7-AAA bounded read). **Owner decision: NO points — marketplace completion is self-attested (no peer confirm), points = money → farm surface; reward is a cosmetic achievement. No `giveaway` ledger source created.** Tests: aggregator 23/23 (6 new ML#5), rules 306/306 (6 new), shared 484/484; full CF 2267; CSP unchanged. **#1–5 capture block COMPLETE.** Next ตัว = **#6 Kindness score** — no new capture; sums `{quest, food_share, help_completed}` from `pointsLedger`; gated on ACCRUAL only (~weeks of data) + reuses the #0 `trustScores/{tenantId}` + daily-sweep pattern. Lifecycle doc [[lifecycle_trade_history]].
- **2026-06-10 — #9 Pet health memory SHIPPED.** PR [#327](https://github.com/soulgroundliving/the-green-haven/pull/327) (`3f37e19`, squash; auto-deploys exportMyData + Vercel — prod CF deploy green). Per-pet **append-only** health timeline — entries stored as a `healthLog[]` **ARRAY** on the pet doc (NOT a subcollection, so archive / DSR-erasure / DSR-export / Storage-cleanup all ride the EXISTING pet lifecycle — §7-DD/L avoided), with a repository boundary in `shared/tenant-pet-health.js` so a future array→subcoll migration stays contained. **Owner directives (locked):** array model ("ยั่งยืน + ต่อยอดได้") · PDPA lean (reuse `getDownloadURL` + `account_v1`, no new CF/consent — pet health ≠ §26-sensitive) · theme-aware muji form (brand tokens + box-sizing, fixed dark mode + overflow) · **NO tenant delete** (a health record is a permanent memory; an accidental tap must never lose history — `removeEntry` kept as console/admin-only correction). `exportMyData` now exports `pets` incl. `healthLog` (closed a pre-existing gap). 25 tests (23 helper + 2 export); test:shared 507/0; verify:memory 646/0. Opens the **Pet pillar** — next buildable pet ตัว = **#10 Pet Social Graph** (#13/#15/#16 also buildable; #6–8 still accrual-gated). Lifecycle doc [[lifecycle_pets_registration]] (#9 section).
- **2026-06-10 — #6 Kindness score SHIPPED (server + admin).** Three PRs, all merged + deployed + live-verified on prod: [#329](https://github.com/soulgroundliving/the-green-haven/pull/329) (`39c0cbb` — `_kindness.js` engine + sweep extension), [#330](https://github.com/soulgroundliving/the-green-haven/pull/330) (`49eac74` — §7-J room-join fix) + [#331](https://github.com/soulgroundliving/the-green-haven/pull/331) (`fe7cd83` — `dashboard-kindness.js` admin card). Sums `{quest, food_share, help_completed}` from `pointsLedger` → `trustScores/{tenantId}.kindness` (0–100) in the daily sweep; admin card in Insights→ผู้เช่า. **The live-verify (§7-J) caught a real bug:** ledger `tenantId` is `${building}_${room}` (`nest_N101`), not the canonical `TENANT_…` the sweep keyed on → kindness=0 despite 4 real quests; #330 joins by room key. **Prod-verified end-to-end via Chrome MCP:** N101 → kindness **13** (4 quests × 10 = 40 → round(40/300×100)). Read-only verify tools `tools/preview-kindness-scores.js` + `tools/read-trustscores.js` (ADC). Tests: kindness engine 10 + sweep 9 + admin-card 8; full CF 2281/0, shared 522/0. **Pending:** tenant tier badge v1.x (consent-gated, mirror #288/#289). Next: #7 Verified Helper (gated on #2 job accrual) or the #6 tenant badge. Lifecycle doc [[lifecycle_trust_reputation]] (extended with kindness).
- **2026-06-11 — #6 Kindness tenant badge v1.x SHIPPED + on-device verified.** PR1 #333 (server+rules) + PR2 #334 (frontend); rules deployed + sweep mirror prod-verified; **on-device badge 🤲 "มีน้ำใจ" owner-confirmed on real LINE** → #6 fully ✅ end-to-end.
- **2026-06-11 — #10 Pet Social Graph PR1 (server + rules + PDPA) SHIPPED + DEPLOYED.** Commit `f174f02` → main → CI `27347926501` success. 2 collections (`petProfiles/{petId}` safe-fields mirror — health never leaks + `petLinks/{linkId}` friend edges), 4 callables LIVE (SE1, §7-NN, point-free), rules deployed (ruleset `848727bb`), `pet_profile_v1` consent + §7-DD cleanup (archive + erasure) + §30 export. code+security review: 2 HIGH fixed (opt-out auth bypass, canRespondLink same-room). Gates: functions 2357/0, rules 342/0, mojibake clean, verify:memory green. **Next = #10 PR2 frontend** (directory sub-page + opt-in toggle + friend UI; off main, builds independently). Lifecycle doc [[lifecycle_pet_social]]; handoff [[next_session_handoff_2026_06_11_pet_social_pr1]].
- **2026-06-12 — #15 Life Timeline SHIPPED (PR [#335](https://github.com/soulgroundliving/the-green-haven/pull/335)).** First **Tenant-pillar** ตัว. Read-only "journey" sub-page derived ENTIRELY from the tenant's own doc `tenants/{b}/list/{r}` — zero new collection/index/capture, so it shipped behind the same claim-gate every tenant read already passes. Events: ย้ายเข้า · อยู่ครบ N ปี · ได้รับเหรียญ · สัญญาครบกำหนด + tenure intro. Pure `deriveTimeline()` 17 tests (full shared 593/0); static-harness verified light + dark (§7-III computed values). Honours §7-A/U/N/V/X/QQ/CC/B/RR. **v2 deferred:** cross-room transfers need occupancyLog `getByTenant` ({tenantId,at} composite index — §7-J). Built in an isolated worktree off `origin/main` (concurrent pet/deposit sessions — no shared files touched). **Open:** owner real-LINE live-verify. Next buildable Tenant ตัว = **#16 Farewell Archive + AI Summary**; Pet ตัว #11/#13 also unblocked. Lifecycle doc [[lifecycle_life_timeline]].
- **2026-06-13 — Neighbour Bonds card SHIPPED (bonus Tenant-pillar, PR [#349](https://github.com/soulgroundliving/the-green-haven/pull/349)).** A 🤝 "เพื่อนบ้านที่ผูกพัน" social-memory card at the bottom of the 🪴 Life Timeline page — who the tenant has helped / been helped by, derived from this building's `helpRequests` (the #2-board rule-safe read; NO new collection/index/capture/CF). PDPA-minimal room-label only. Pure `deriveBonds()` 14 tests; shared 690/0; static-harness light+dark. The first SOCIAL Tenant-pillar card (vs #15/#16 self-only). Frontend-only. Lifecycle [[lifecycle_neighbor_bonds]]. (Survived a concurrent-session git-index collision — recovered byte-identical.)
- **2026-06-13 — Reputation v2 (engagement dim) SHIPPED EARLY (PR [#343](https://github.com/soulgroundliving/the-green-haven/pull/343)).** Closes the LAST open Trust item → **Trust pillar #0/#6/#7/#8 + Reputation v2 ALL COMPLETE.** Additive, positive-only engagement-consistency bonus on Reputation (#0): `min(100, v1_base + round(activeWeeks/8·10))`, +10 max — can only RAISE (owner decision — never re-weights/lowers; no-history → bonus 0 = v1, so it shipped before the ~Aug gate since `daily_login` already had cadence history). §6: PRESENCE per week (distinct active weeks), never points value → not farmable. Pure `computeEngagement()` in `_reputation.js` (14 tests) + one `pointsLedger in ENGAGEMENT_SOURCES` sweep read (§7-J room-key join, +1 test) + admin `⚡ +N`. No rules/CSP/consent/tenant change (badge auto-reflects the new number; resident-rank #8 reads it automatically). functions 2408/0; backward-compat (31 v1 + 12 sweep tests unchanged). deploy-functions ✅. Lifecycle [[lifecycle_trust_reputation]] (Reputation v2 section). **Forward:** Pet #11/#13/#14 · Tenant follow-ups · Reputation v3.
- **2026-06-12 — #8 Resident Rank SHIPPED (PR1 [#338](https://github.com/soulgroundliving/the-green-haven/pull/338) server+rules+admin + PR2 [#339](https://github.com/soulgroundliving/the-green-haven/pull/339) tenant badge).** The 4th + FINAL Trust dim → **Trust pillar #0/#6/#7/#8 COMPLETE.** DERIVED composite (no new capture): `_residentRank.js` `round(0.40·rep + 0.30·kind + 0.30·vh)` (owner "สมดุล") → 5-rung growth ladder `taproot|canopy|rooted|sprout|seed` (owner ladder; bounds 75/55/35/15). Top rungs unreachable on reputation alone (cap 40) → participation lock-in by design. Additive `trustScores` dim + 4th tier in the combined mirror (§7-T) + `residentRankTier` protected (§6) + `resident_rank_v1` consent; admin card `dashboard-resident-rank.js` + tenant `.rr-card` badge `tenant-resident-rank.js`. 43 new tests (functions 2393/0, shared 676/0, rules 344/0); verify:memory green; no CSP drift; static-harness light+dark verified. Both PRs merged + deployed (deploy-rules ✅ + deploy-functions ✅ + Vercel ✅). **Open:** owner real-LINE verify. Next Trust = Reputation v2 (~Aug accrual); other buildable = Pet #11/#13/#14. Lifecycle [[lifecycle_trust_reputation]].
- **2026-06-12 — #16 Farewell card v1 SHIPPED (PR [#336](https://github.com/soulgroundliving/the-green-haven/pull/336)).** Derive-only farewell / journey-summary card atop the 🪴 Life Timeline page (`#tlf-card`): tenure + 2×2 stat grid (badges/points/trades/streak) + a message that turns FAREWELL-toned when `lease.endDate ≤ 45d` / ended. From the tenant's own doc only — no new collection/index/capture/CF/**AI**. `shared/tenant-farewell.js` pure `deriveFarewell()` 12 tests; full shared 611/0; static-harness light+dark (§7-III). Worktree off origin/main, rebased onto `37fe555` (pet-social asserter — no shared files touched). **v2 deferred:** move-out hook (admin gift at archive) + AI prose + archive read. **Open:** owner real-LINE verify; write `lifecycle_farewell.md` on merge. **Both Tenant-pillar ตัว (#15+#16) now shipped** — next buildable = Pet #11/#13 (collide w/ pet session) or accrual-gated Trust #7/#8.
