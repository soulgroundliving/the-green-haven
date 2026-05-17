# C4 — Merge ประกาศ + events into unified `announcements/{id}` (Plan-First)

**Threshold check:** ✅ touches 8+ files · ✅ schema + rules + new CF · ✅ multi-session · ✅ data migration deferred · ✅ multiple valid approaches considered → **Plan-First mandatory** per CLAUDE.md §1.

**Architectural decisions confirmed by user (this session):**
1. **3-way merge** — `broadcastMessages` + `communityEvents` + existing `announcements` → single `announcements/{id}`
2. **Unified audience field** — every doc has `audience: 'all' | <buildingId>`; events default to `'all'` for backwards compat
3. **Session 1 = schema + CF + dual-write/dual-read** (no data migration; cutover next session)

---

## Current state (verified 2026-05-17 via grep)

| Collection | Writer | Reader | Visibility |
|------------|--------|--------|-----------|
| `broadcastMessages/{auto}` | `broadcastMessage` CF (HTTP, admin-only) — [functions/broadcastMessage.js:76](functions/broadcastMessage.js:76) · [shared/dashboard-broadcast.js:99](shared/dashboard-broadcast.js:99) | `_subscribeBroadcasts` bell — [tenant_app.html:7423-7465](tenant_app.html:7423) | audience-scoped: `'all' \| 'rooms' \| 'nest'` |
| `communityEvents/{auto}` | `CommunityEventsStore.setOne` direct Firestore — [shared/dashboard-extra.js:3311-3357](shared/dashboard-extra.js:3311) | `_taEventsUnsub` — [tenant_app.html:10308](tenant_app.html:10308) | public-read |
| `announcements/{auto}` | Direct Firestore from admin — [shared/dashboard-content-features.js:95,133](shared/dashboard-content-features.js:95) | `_taAnnUnsub` — [tenant_app.html:9976-9985](tenant_app.html:9976) | public-read (banner-style) |

**Pain points the merge solves:**
- 3 places to add an "announcement" type feature in the future
- 3 different rule blocks to keep in sync (security audit surface)
- 3 different localStorage cache shapes ([shared/dashboard-extra.js:794-815](shared/dashboard-extra.js:794))
- Mental-model overhead: "is this a broadcast or an announcement?"
- Audience filtering only works on broadcasts; events/announcements leak across buildings

---

## Target schema — `announcements/{autoId}`

```js
{
  type:     'notice' | 'event' | 'banner',   // discriminator
  title:    string,    // 1-80 chars (required for all types)
  body:     string,    // 1-1000 chars (required for all types; bumped from 500 to fit event descriptions)
  audience: 'all' | 'rooms' | 'nest',         // 'all' = no claim filter; buildingId = claim match
  sender:   { uid, email },
  sentAt:   serverTimestamp,
  status:   'published' | 'archived',

  // Type-specific (optional, validated server-side per type):
  eventDate?:  Timestamp,    // type='event' only — when the event happens
  location?:   string,       // type='event' only — max 200 chars
  photoUrl?:   string,       // type='event' only — Storage URL or base64 (existing convention)
  expiresAt?:  Timestamp,    // type='banner' only — hide after this time
}
```

**Why discriminator + optional fields (not subcollections):**
- Single query path on tenant side: `where audience in ['all', _taBuilding] orderBy sentAt desc` returns everything
- Type-based rendering filter happens client-side (cheap)
- Avoids subcollection composite indexing complexity
- Matches the user's "single mental model" intent

**Why `body` bumped from 500 → 1000:**
- Existing events have longer descriptions than broadcast char limit allows
- Reviewing actual `communityEvents` data shows current admin entries fit well under 1000
- Backwards-compat: any existing broadcast under 500 still passes new 1000 limit

---

## Rule change — [firestore.rules:43-56](firestore.rules:43)

```
match /announcements/{annId} {
  allow read:  if isAdmin()
            || (isSignedIn() && resource.data.audience == 'all')
            || (isSignedIn() && resource.data.audience == request.auth.token.building);
  allow write: if false;  // CF only (publishAnnouncement)
}
```

**Keep alive during Session 1:** old rules for `broadcastMessages` + `communityEvents` stay (legacy reads still flow). Deprecation = Session 2.

**Note:** Existing `announcements/{annId}` rule (line 43, `allow read: if true`) is REPLACED — tighter visibility model. Legacy `announcements` docs (banner-style, ~3 of them per localStorage backup) will need to be backfilled with `audience: 'all'` in Session 2. **Risk:** during Session 1, the rule tightening could hide existing legacy `announcements` docs from anonymous reads. **Mitigation:** legacy `announcements` rendering on tenant side is gated by signed-in tenant context (LIFF), so any actual tenant viewing them is already signed-in → `audience == 'all'` allows them through. Anonymous public reads (none exist in tenant_app today) will break, but those don't exist.

---

## Composite index — [firestore.indexes.json](firestore.indexes.json)

Add (mirrors existing `broadcastMessages` index at line 128):

```json
{
  "collectionGroup": "announcements",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "sentAt", "order": "DESCENDING" }
  ]
}
```

**Why:** tenant query `where('audience', 'in', ['all', _taBuilding]) orderBy('sentAt', 'desc')` requires composite index. Anti-pattern §7-N (silent failure on missing index) — deploy index BEFORE tenant_app changes that use it.

---

## CF design — `functions/publishAnnouncement.js` (new)

Mirrors `broadcastMessage` CF structure (Gen2, asia-southeast1, requireAdmin gate), but with type-aware validation:

```js
// Pseudocode shape — concrete code in implementation phase
exports.publishAnnouncement = onRequest({ region: 'asia-southeast1', cors: true }, async (req, res) => {
  // 1. requireAdmin → decoded token
  // 2. validate({ type, title, body, audience, ...typeFields })
  //    - type ∈ {'notice', 'event', 'banner'}
  //    - title 1-80, body 1-1000
  //    - audience ∈ {'all', 'rooms', 'nest'}
  //    - type='event' → eventDate required (ISO string → Timestamp), location optional max 200, photoUrl optional
  //    - type='banner' → expiresAt optional
  //    - type='notice' → no extra fields
  // 3. Write to announcements/{auto} with sender + sentAt + status='published'
  // 4. Return { ok: true, id, type }
});
```

**Unit tests (mandatory per TDD §1):** mirror `__tests__/broadcastMessage.test.js` pattern (13 tests). Coverage:
- Each type's required-field validation (notice/event/banner)
- Audience whitelist
- Title/body length boundaries
- Missing auth → 403
- Non-admin → 403
- Server error path → 500

---

## Dual-write strategy (admin side — Session 1)

Each existing admin form rewired to write to NEW `announcements/{id}` via `publishAnnouncement` CF. **Old collections are NO LONGER WRITTEN.**

| Existing form | Type discriminator | Audience default |
|---------------|---------------------|-----------------|
| Broadcast tab ([shared/dashboard-broadcast.js:99](shared/dashboard-broadcast.js:99)) | `'notice'` | from existing radio (`all`/`rooms`/`nest`) |
| Events tab ([shared/dashboard-extra.js:3476-3496](shared/dashboard-extra.js:3476)) | `'event'` | `'all'` (preserves current public visibility) |
| Announcements tab ([shared/dashboard-content-features.js:86-95](shared/dashboard-content-features.js:86)) | `'banner'` | `'all'` (preserves current public visibility) |

**Why "no longer written" instead of true dual-write:** writing to BOTH new+old would mean double-billing Firestore + double-cleanup later. The DUAL part is on the READER side (tenant reads new+old merged), giving legacy data a graceful path until migration runs in Session 2.

**Existing CFs preserved (no breaking deploys this session):**
- `broadcastMessage` CF stays deployed but unused by UI (defensive — in case admin browser cache holds old JS)
- `CommunityEventsStore.setOne` / `remove` stay alive for admin localStorage cache write but skip the Firestore write (legacy events still readable for tenant; admin can't create NEW events through that path)

---

## Dual-read strategy (tenant side — Session 1)

Each tenant subscriber adds a NEW subscription to `announcements/{id}`, merges with existing legacy subscription, dedupes by ID (defensive — no migration yet, so no actual overlap), renders by type.

| Surface | Reads from | Filter by type |
|---------|-----------|----------------|
| Bell icon ([tenant_app.html:7423](tenant_app.html:7423)) | `announcements` WHERE `type='notice'` + legacy `broadcastMessages` | merged + sentAt desc |
| Community feed events ([tenant_app.html:10308](tenant_app.html:10308)) | `announcements` WHERE `type='event'` + legacy `communityEvents` | merged + sentAt desc |
| Community feed banners ([tenant_app.html:9976](tenant_app.html:9976)) | `announcements` WHERE `type='banner'` + legacy `announcements` collection | merged + sentAt desc |

**Anti-pattern §7-U guard MANDATORY on new subscribers:** `if (!_taBuilding) return;` before setting unsub; reset unsub on `permission-denied` for `liffLinked` retry. Mirror `_subscribeBroadcasts` pattern at [tenant_app.html:7423-7465](tenant_app.html:7423).

**Subscription dedup logic:**
```js
// Merge by id; new collection wins (it has type, legacy doesn't)
const byId = new Map();
[...newAnnouncements, ...legacyDocs].forEach(d => {
  if (!byId.has(d.id)) byId.set(d.id, d);
});
```

---

## Files affected

### Created (3)
- [ ] `functions/publishAnnouncement.js` — new CF
- [ ] `functions/__tests__/publishAnnouncement.test.js` — 13+ unit tests
- [ ] `memory/lifecycle_announcements_unified.md` — lifecycle doc with verify-via-grep section (replaces `lifecycle_broadcast_announcement.md` + `lifecycle_community_feed.md` event/banner sections in Session 3)

### Modified (8)
- [ ] [functions/index.js](functions/index.js) — export `publishAnnouncement`
- [ ] [firestore.rules](firestore.rules:43) — add `announcements/{annId}` rule (replaces existing simpler rule)
- [ ] [firestore.indexes.json](firestore.indexes.json) — add `announcements` composite
- [ ] [firestore.rules.test.js](firestore.rules.test.js) — 5 new rule tests (admin, audience=all signed-in, audience=building match, audience mismatch denied, write denied)
- [ ] [shared/dashboard-broadcast.js:71-119](shared/dashboard-broadcast.js:71) — `publishBroadcast()` POSTs to `publishAnnouncement` with `type: 'notice'`
- [ ] [shared/dashboard-extra.js:3476-3496](shared/dashboard-extra.js:3476) — `saveCommunityEvent()` POSTs to `publishAnnouncement` with `type: 'event'`
- [ ] [shared/dashboard-content-features.js:86-95](shared/dashboard-content-features.js:86) — `saveAnnouncement()` POSTs to `publishAnnouncement` with `type: 'banner'`
- [ ] [tenant_app.html:7423,9976,10308](tenant_app.html:7423) — 3 NEW subscribers added, each merging with existing legacy subscriber

### Not touched this session (deferred to Session 2/3)
- `functions/broadcastMessage.js` — kept alive defensively
- `CommunityEventsStore` facade — kept alive for legacy reads
- Tenant-side localStorage caches (`announcements_data`) — kept (will migrate in S2)
- Migration scripts (`tools/migrate-to-announcements.js`)
- `lifecycle_broadcast_announcement.md` deprecation (still useful for legacy bell)

---

## Implementation order (sequential — each step verifiable before next)

### Step 1 — Backend foundation (~30 min) 🟢 LOW RISK
- [ ] 1.1 Write `functions/publishAnnouncement.js` + tests
- [ ] 1.2 Add to `functions/index.js` exports
- [ ] 1.3 Update `firestore.rules` (new `announcements` block; keep legacy blocks)
- [ ] 1.4 Update `firestore.rules.test.js` with 5 new tests
- [ ] 1.5 Add composite index to `firestore.indexes.json`
- [ ] 1.6 Run `npm test` in `functions/` → 13+ new tests green
- [ ] 1.7 Run `npm run test:rules` → all rule tests green
- [ ] 1.8 User runs `firebase deploy --only firestore:indexes` (index builds 1-5 min in background)

### Step 2 — Admin dual-write (~45 min) 🟡 MEDIUM RISK
- [ ] 2.1 Wire `shared/dashboard-broadcast.js` `publishBroadcast()` → `publishAnnouncement` CF with `type: 'notice'`
- [ ] 2.2 Wire `shared/dashboard-extra.js` `saveCommunityEvent()` → `publishAnnouncement` CF with `type: 'event'` (event-specific fields)
- [ ] 2.3 Wire `shared/dashboard-content-features.js` `saveAnnouncement()` → `publishAnnouncement` CF with `type: 'banner'`
- [ ] 2.4 User runs `firebase deploy --only functions:publishAnnouncement,firestore:rules`
- [ ] 2.5 Live-verify each admin form via Chrome MCP: post one of each type → verify doc lands in `announcements/{id}` with correct fields

### Step 3 — Tenant dual-read (~60 min) 🟡 MEDIUM RISK
- [ ] 3.1 Add `_subscribeAnnouncementsNotice` to tenant_app.html (mirrors `_subscribeBroadcasts`; filters `type='notice'`)
- [ ] 3.2 Modify bell-icon render path: merge `announcements` notice docs + legacy `broadcastMessages` docs by id
- [ ] 3.3 Add `_subscribeAnnouncementsEvent` (filters `type='event'`); merge into existing `_taEventsUnsub` render path
- [ ] 3.4 Add `_subscribeAnnouncementsBanner` (filters `type='banner'`); merge into existing `_taAnnUnsub` render path
- [ ] 3.5 All 3 new subscribers wired through `_onLiffClaimsReady` + claim-presence guard (§7-U) + error callback resets unsub (§7-N)
- [ ] 3.6 Push to Vercel → live-verify on https://the-green-haven.vercel.app with real LIFF tenant: bell shows new notice + legacy broadcast; events feed shows new event + legacy events; banner panel shows new banner + legacy announcements

### Step 4 — Lifecycle doc + memory updates (~15 min) 🟢 LOW RISK
- [ ] 4.1 Write `memory/lifecycle_announcements_unified.md` with full schema + rule + CF + dual-read strategy + verify-via-grep section
- [ ] 4.2 Update `memory/MEMORY.md`: add new lifecycle to 🏛️ System Lifecycles · core data section
- [ ] 4.3 Run `npm run verify:memory` → exit 0
- [ ] 4.4 Write `next_session_handoff_2026_05_17_c4_announcements_phase1.md` with: what shipped, Session 2 task list (migration script + reader cutover), Session 3 task list (legacy collection drop)

### Step 5 — Commit + push (~5 min) 🟢 LOW RISK
- [ ] 5.1 `git status` first (per [feedback_git_status_before_add.md](memory/feedback_git_status_before_add.md))
- [ ] 5.2 One or more focused commits (Step 1 backend / Step 2 admin / Step 3 tenant / Step 4 docs) with `feat(announcements):` prefix
- [ ] 5.3 `git push origin main`
- [ ] 5.4 User runs deploy commands captured in handoff

---

## Verification (live, not from memory)

End-of-session, all must be true:

1. ✅ `gh search code "collection.*announcements" --owner soulgroundliving` shows write/read in expected files
2. ✅ Admin posts a `type='notice'` via Broadcast tab → bell on tenant LIFF shows it within 5s (live snapshot)
3. ✅ Admin posts a `type='event'` via Events tab → community feed shows it on tenant LIFF
4. ✅ Admin posts a `type='banner'` via Announcements tab → banner panel shows it on tenant LIFF
5. ✅ Legacy broadcast (one of the existing 3+ in `broadcastMessages`) still shows on bell — proves dual-read works
6. ✅ Tenant from `nest` building does NOT see a `notice` with `audience='rooms'` — proves audience scoping enforced
7. ✅ Admin can see all 3 types in their respective tabs (read-back working)
8. ✅ `npm run verify:memory` exit 0
9. ✅ All 13+ unit tests + 5+ rule tests green

---

## Risks + rollback

| Risk | Likelihood | Mitigation | Rollback |
|------|-----------|-----------|----------|
| Composite index not built when tenant code deploys → bell breaks | MEDIUM | Step 1.8 BEFORE Step 3 push (index needs 1-5 min build time) | Revert tenant_app changes; legacy subscribers still working |
| Old admin browser cache hits new CF path with old payload shape | LOW | Defensive validation in CF + backwards-compat: legacy `broadcastMessage` CF stays alive | Admin refreshes browser → new JS loads |
| `announcements` rule tightening hides legacy banner from anonymous read | LOW | tenant_app reads in signed-in LIFF context; anonymous read path doesn't exist | Revert rules (one-line revert) |
| Anti-pattern §7-U stale subscription on new subscribers | MEDIUM (3 new subscribers × past recurrence) | Audit each new subscriber for claim-first guard + permission-denied unsub reset before deploy | Anti-pattern recipe in CLAUDE.md §7-U |
| `audience` field migration breaks legacy `announcements` docs missing the field | LOW | Reader merge logic treats missing audience as `'all'` (backwards compat) | Reader fix already in dual-read plan |

---

## Out of scope (explicitly deferred)

- ❌ Data migration of existing `broadcastMessages` + `communityEvents` + `announcements` docs → `announcements/{id}` (Session 2)
- ❌ Decommissioning `broadcastMessage` CF, `CommunityEventsStore` facade, legacy subscribers (Session 3)
- ❌ Removing legacy collections from `firestore.rules` (Session 3)
- ❌ LINE multicast integration (out of C4 scope entirely)
- ❌ Scheduled announcements (out of C4 scope)
- ❌ Per-room granular filter UI (admin currently chooses building only)
- ❌ Soft-delete from admin UI (out of C4 scope)
- ❌ Lease duplicate cleanup migration (separate optional item from user prompt)
- ❌ Reward `note` field cleanup migration (separate optional item from user prompt)
- ❌ `system/serviceProviders` `type='internet'` decision (separate optional item)

---

## Session 2 preview (next session, not now)

- Backfill migration script: `tools/migrate-to-announcements.js` reads all 3 legacy collections → writes equivalent `announcements/{id}` docs with type+audience derived from source
- Flip tenant subscribers: remove legacy subscriber, keep ONLY `announcements/{id}` subscriber
- Drop dual-read merge logic
- Add `migratedAt` field on backfilled docs for audit

## Session 3 preview

- Drop legacy rules + indexes for `broadcastMessages` / `communityEvents` / old `announcements`
- Drop legacy CF `broadcastMessage`
- Drop `CommunityEventsStore` facade
- Drop localStorage `announcements_data` cache
- Lifecycle doc consolidation: `lifecycle_broadcast_announcement.md` archived, `lifecycle_community_feed.md` simplified to just `communityDocuments` + `wellness_articles`
- One-shot data cleanup: delete legacy collections after verifying all reads pointed elsewhere

---

## Decision-mode chip (per [feedback_decision_protocol.md](memory/feedback_decision_protocol.md))

**Awaiting approval on this plan.** Reply:
- ✅ Approve → proceed with Step 1 (backend foundation)
- 🔄 Modify → tell me which step/decision to change
- ❌ Reject → discuss alternative approach

---

# Review (appended 2026-05-17 after Session 1 ship)

## Shipped

- ✅ Step 1 backend: `publishAnnouncement` CF + 24 unit tests (all green) + tightened rule + composite index + 6 new rules tests
- ✅ Step 2 admin dual-write: 3 forms (broadcast/events/announcements) rewired to CF; admin log dual-source merged; admin announcement listener normalizes new banner shape into legacy localStorage cache
- ✅ Step 3 tenant dual-read: bell dual-source merged with §7-U guard + fixed initial-replay toast bug; banner subscriber replaced with claim-guarded version; new events subscriber added alongside legacy
- ✅ Step 4 lifecycle doc + handoff written; MEMORY.md indexed; memory verifier exit 0
- ✅ Step 5 commit + push

## Mid-flight pivots from the original plan

1. **"Dual-write" terminology clarified** — what actually shipped is "single-write to new + dual-read on tenant". Old admin paths NO LONGER WRITE to legacy collections. Tenant READS BOTH for transition compatibility. Trade-off: simpler cleanup + lower Firestore $ vs harder rollback. Documented in handoff.
2. **Rule transition risk caught mid-session** — initial design tightened `announcements` write to CF-only, but admin browsers may hold stale JS. Pivoted to `allow write: if isAdmin()` for S1 (CF-only tightens in S3).
3. **Legacy `audience` field gap caught mid-session** — initial plan didn't account for legacy `announcements` docs lacking the `audience` field. Without backfill, tight tenant query would exclude them entirely. Added [tools/c4-backfill-legacy-announcements.js](tools/c4-backfill-legacy-announcements.js) as Step 1.8a prerequisite (idempotent, dry-run by default).
4. **Bell toast bug caught during self-conflict check** — dual-source `_subscribeBroadcasts` would have fired duplicate toasts on initial replay (2nd source treated as new). Fixed with `sourcesReplayed` set + `TOTAL_SOURCES` gate before flipping `_broadcastsInitialReplay`.
5. **Admin log query needed index alignment caught during self-conflict check** — `where type='notice' + orderBy sentAt` query wouldn't use the `type + audience + sentAt` composite (audience is in between). Fixed by adding `where audience in [all,rooms,nest]` to admin log query (admin sees all 3 anyway per rule).
6. **`time` field loss on legacy banner normalization** — minor cosmetic regression for backfilled banners that had time stamps. Documented as known limitation.

## Deferred

- Data migration (Session 2 per plan)
- Legacy CF + collection decom (Session 3 per plan)
- `time` field rendering on normalized banners (S2 cleanup)
- Edit affordance for new-collection events (needs S2 update CF)
- Cleanup migrations: lease duplicates + reward `note` field — user optional this session, skipped to keep C4 focus
- `system/serviceProviders` `type='internet'` decision — user optional, skipped

## Pending user actions

1. ⏳ `firebase deploy --only functions:publishAnnouncement,firestore:rules,firestore:indexes` and wait for index build (1-5 min)
2. ⏳ `npm run test:rules` (needs Java emulator) — my new tests verified by static review only this session
3. ⏳ `node tools/c4-backfill-legacy-announcements.js` dry-run then `--apply` BEFORE tenant subscribers go live
4. ⏳ Push to Vercel; verify bell + events + banners on live LIFF via Chrome MCP per handoff verification table
