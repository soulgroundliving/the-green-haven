# Nest Marketplace — Spec v1.0 → 6 Sprint Roadmap

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Previous plan:** Quiz Session B (server-trusted quiz claim) — archived to `tasks/todo-quiz-session-b-pending-archive.md` for later pickup. Quiz design doc still in `tasks/todo-quiz-expansion.md`.

**Triggered by:** User-supplied `Nest_Marketplace_Specification.pdf` v1.0 (MVP for 20-room Nest sandbox). Comparison vs current state found 6 missing features + 2 schema migrations.

**Reference:** `Nest_Marketplace_Specification.pdf` (PDF in `~/Downloads/`); current state per [memory/lifecycle_marketplace.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_marketplace.md).

---

## Locked decisions (user-confirmed 2026-05-24)

| # | Decision | Value | Reason |
|---|----------|-------|--------|
| 1 | Category key naming | **Keep existing `item/service/free` + add new (`request` for Wishlist)** | Avoids data migration of every existing post + ruleset; new categories slot in cleanly. Spec values `SELL/SERVICE/FREE` are display labels only. |
| 2 | `status` enum | **Migrate `active/closed` → `AVAILABLE/RESERVED/COMPLETED`** | Spec needs `RESERVED` to drive self-destruct of chat on `COMPLETED`; current 2-state model can't express "reserved but not final". |
| 3 | Image storage | **Migrate to Firebase Storage** | Lifts ~1MB doc cap; enables multi-image; aligns with `lifecycle_storage_uploads.md` pattern. |
| 4 | Owner identity | **Keep `ownerUid = line:<LINE_USER_ID>`** (no change) | Already canonical via `liffSignIn` per `auth_liff_sot.md`. Spec's `users.uid = LINE ID` matches by construction. |
| 5 | Sprint order | **3.2 → 3.3 → 4.2 → 4.4 → 4.1 → 4.3** (per earlier ROI ranking) | Unblock privacy (3.2) before notification (3.3); easy wins (4.2/4.4) before model expansion (4.1) before badges (4.3 depends on 4.1/4.2 stats). |

---

## Sprint 0 — Foundations (architectural, ship before Sprint 1)

**Why:** Sprint 1 self-destruct logic depends on `status='COMPLETED'`; Sprint 1+ chat carries post-image previews and benefits from URL-based images. Doing schema work upfront avoids two migrations.

- [x] **S0.1 — Status enum migration (writer-tolerant transition)** ✅ 2026-05-24
  - **Why:** Cannot hard-cutover existing `active/closed` posts; readers must handle BOTH during transition (per §7-T fix pattern).
  - ✅ Helper `_normalizeMarketStatus()` + `MARKET_STATUS_VISIBLE` const in [tenant_app.html:6367](tenant_app.html:6367)
  - ✅ Subscribe filter `where status in ['AVAILABLE','RESERVED','active']` — uses existing `building+status+createdAt` composite index (Firestore `in` query)
  - ✅ Writer: new posts write `'AVAILABLE'`, close handler writes `'COMPLETED'`
  - ✅ `tools/migrate-marketplace-status.js` — dry-run default, REST API via firebase-tools OAuth, status field-only update via updateMask
  - ⚠️ Firestore rules: NO change (current rule has no status validator; tightening defer to later sprint per §7-T avoidance)
  - **Files touched:** `tenant_app.html`, `tools/migrate-marketplace-status.js` (new)

- [ ] **S0.2 — Image storage migration (lazy + dual-read)**
  - **Why:** Existing base64 posts stay valid (per §7-L "code-only ≠ data migrated"); only NEW posts write to Storage.
  - Storage path: `marketplace/{building}/{postId}/img.jpg`
  - `storage.rules`: signed-in read for `marketplace/**`, owner-write (match via Firestore lookup of `ownerUid`)
  - Add post → upload to Storage → set `imageUrl: <downloadURL>` (NOT `imageData`)
  - Reader: prefer `item.imageUrl`, fallback to `item.imageData` (base64)
  - `tools/migrate-marketplace-images.js` (optional one-shot, deferred — old posts naturally expire in ≤30d via `expiresAt`)
  - **Files:** `tenant_app.html`, `storage.rules`, `tools/migrate-marketplace-images.js` (new, optional)

- [ ] **S0.3 — Lifecycle doc update**
  - Update [memory/lifecycle_marketplace.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_marketplace.md) — new schema + migration plan + verifier rows
  - Run `npm run verify:memory` — exit 0 required

**Ship gate S0:** dry-run migration shows expected diff; reader tolerates both shapes; rules deploy + smoke (post + close + delete); push → Vercel → Chrome MCP verify on https://the-green-haven.vercel.app

---

## Sprint 1 — Privacy-First Temporary Chat (Spec §3.2) — `~3-4 sessions`

**Why:** Current `contactSeller()` opens `line.me/ti/p/<lineUserId>` directly, leaking the seller's personal LINE. Spec's #1 design goal is privacy-first; this sprint replaces the leak with in-LIFF chat.

- [ ] **S1.1 — Firestore schema + rules**
  - `marketplace_chats/{chatId}` — `{ postId, postTitle, postImageUrl, postPrice, participants: [ownerUid, interestedUid], lastMessage, lastMessageTime, unreadCount: {<uid>: N}, createdAt }`
  - `marketplace_chats/{chatId}/messages/{messageId}` — `{ senderId, text, timestamp, isRead }`
  - Rules: read/write only if `request.auth.uid in resource.data.participants`; create requires authed user adds self + post-owner to participants
  - `firestore.indexes.json`: composite on `participants` array + `lastMessageTime desc`
  - **Files:** `firestore.rules`, `firestore.indexes.json`
  - **§7 hazards:** §7-N (onSnapshot error callback required), §7-V (cleanup before re-attach), §7-KK (cached-snapshot reconciliation)

- [ ] **S1.2 — Chat list sub-page in tenant_app.html**
  - New page `#market-chat-list-page` accessible from marketplace nav
  - Subscribe `marketplace_chats where participants array-contains _authUid order by lastMessageTime desc`
  - Card: post thumbnail + title + last message preview + unread badge
  - **§7 hazards:** §7-A (use `_onLiffClaimsReady`), §7-U (claim-first guard before subscribe)

- [ ] **S1.3 — Active chat view + message send**
  - New page `#market-chat-page` with context header (post image + title + price — locked at chat-creation time)
  - Message list subscribe on `messages` sub-collection
  - Send: `addDoc` to messages + `setDoc merge` on parent chat (lastMessage, lastMessageTime, increment unreadCount)
  - Mark-read on focus: clear `unreadCount[myUid]` + `isRead: true` on visible messages
  - **§7 hazards:** §7-CC (use `window.` prefix for cross-script state)

- [ ] **S1.4 — Rewire `contactSeller()`**
  - Replace `liff.openWindow('https://line.me/ti/p/' + lineUserId)` with:
    1. Find existing chat: `query(chats, where('postId','==',postId), where('participants','array-contains',_authUid))`
    2. If none: create with `addDoc(chats, {postId, postTitle, postImageUrl, postPrice, participants:[ownerUid, _authUid], ...})`
    3. Navigate to `#market-chat-page` with chatId
  - **Files:** `tenant_app.html:6623-6636`

- [ ] **S1.5 — Self-destruct on `COMPLETED`** _(must be HTTPS callable — NOT a Firestore trigger; §7-NN: SE3 region blocks all Eventarc triggers)_
  - New CF `cleanupMarketplaceChat.js` — HTTPS callable invoked by client when `status` transitions to `COMPLETED`:
    - Find all chats `where postId == updated postId`
    - Delete each `messages` sub-collection (batched, recursive)
    - Delete each chat doc
  - **Files:** `functions/cleanupMarketplaceChat.js` (new), `functions/index.js`
  - **§7 hazards:** §7-DD (sibling collection cleanup), §7-AA (grep `functions/` for existing similar CFs before writing)

- [ ] **S1.6 — Lifecycle doc + tests**
  - New `memory/lifecycle_marketplace_chat.md` — full schema + flow + verifier
  - Update `lifecycle_marketplace.md` — link to chat lifecycle
  - Unit tests: chat create idempotency, self-destruct trigger
  - Rules tests: non-participant cannot read; owner cannot write to other chat
  - **Files:** `memory/lifecycle_marketplace_chat.md` (new), `functions/__tests__/cleanupMarketplaceChat.test.js` (new), `test/firestore-rules.spec.js`

**Ship gate S1:** Chat E2E live on Vercel — tenant A posts → tenant B opens detail → "ติดต่อผู้ขาย" creates chat → real-time message exchange → owner closes post → chat disappears from both sides within ~5s. `npm run test:rules` passes (+ ~6 new cases).

---

## Sprint 2 — LINE OA Notification Broker (Spec §3.3) — `~1-2 sessions`

**Why:** Without notification, new chat messages are invisible — privacy chat becomes useless because nobody checks.

- [ ] **S2.1 — `notifyMarketplaceChat` CF** _(must be HTTPS callable — NOT a Firestore trigger; §7-NN: SE3 region blocks all Eventarc triggers)_
  - Client invokes after writing message doc to `marketplace_chats/{chatId}/messages/{messageId}`
  - Compute recipient = the participant who is NOT `senderId`
  - Lookup recipient's `lineUserId` from `liffUsers/{lineUserId}` (reverse lookup via `linkedAuthUid` field) — or store `lineUserId` per participant directly in chat doc to skip lookup
  - Enqueue via existing `enqueueLineRetry` infra (per [memory/lifecycle_line_notification.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_line_notification.md))
  - Message: `📩 ข้อความใหม่จาก {senderDisplayName}: {messageText[:80]}` + LIFF deep-link back to chat
  - **Files:** `functions/notifyMarketplaceChat.js` (new), `functions/index.js`
  - **§7 hazards:** §7-AA (grep existing notifiers — `notifyMaintenanceTenant.js` pattern), idempotency via `idempotencyKey: messageId`

- [ ] **S2.2 — Anti-spam throttle**
  - Track per `(chatId, recipientUid)` last-notify timestamp in CF memory or Firestore counter
  - Suppress if < 30s since last push (rapid typing scenario)

- [ ] **S2.3 — Deep-link handler in tenant_app.html**
  - URL param `?chat=<chatId>` on LIFF entry → navigate to `#market-chat-page` after auth
  - Per §7-GG: persist via localStorage in case LIFF strips query

- [ ] **S2.4 — Tests + memory**
  - Unit test: notification on new message; suppression on throttle; no notification when sender = recipient
  - Update `lifecycle_marketplace_chat.md` + add CF to `lifecycle_scheduled_jobs.md`
  - **Files:** `functions/__tests__/notifyMarketplaceChat.test.js` (new)

**Ship gate S2:** Send message from tenant A to tenant B → tenant B's LINE OA receives push within ~3s with deep-link → tap → LIFF opens directly to chat.

---

## Sprint 3 — Vertical Delivery Tag / Sky Hook (Spec §4.2) — `~0.5 session`

**Why:** Unique-to-Nest physical-link feature; quick win (~1 boolean + 1 checkbox + 1 filter pill + 1 badge).

- [ ] **S3.1 — Field + form + UI**
  - Add `skyHookReady: boolean` to `marketplace` doc
  - Checkbox in `#add-market-page` form with label "📦 ส่งผ่านรอก (ชั้น 3 หรือ 4)"
  - Badge on card when true: `📦 Sky Hook`
  - Filter pill in `#market-filter-pills`
  - **Files:** `tenant_app.html`, `memory/lifecycle_marketplace.md`

- [ ] **S3.2 — Verifier + ship**
  - Add verifier row to lifecycle doc; `npm run verify:memory`
  - Push → Chrome MCP verify

**Ship gate S3:** Tenant creates post with Sky Hook checkbox checked → card shows 📦 badge → filter pill correctly narrows to Sky Hook posts.

---

## Sprint 4 — Pet-Friendly Filter (Spec §4.4) — `~0.5 session`

**Why:** 1-boolean ergonomic win for pet-owner sub-community; foundation for Sprint 6 Pet Whisperer badge.

- [ ] **S4.1 — Field + form + filter**
  - Add `isPetCategory: boolean` to `marketplace` doc
  - Checkbox in add form: "🐾 เกี่ยวกับสัตว์เลี้ยง"
  - Filter pill: 🐾 สัตว์เลี้ยง
  - **Files:** `tenant_app.html`, `memory/lifecycle_marketplace.md`

**Ship gate S4:** Filter pill correctly narrows.

---

## Sprint 5 — Wishlist & Requests (Spec §4.1) — `~1 session`

**Why:** Expands marketplace from one-way (sell) to two-way (request) — major UX expansion. Foundation for community Engagement metrics.

- [ ] **S5.1 — New category `request`**
  - Per Decision #1: add `request` to category enum (NOT replace existing); price field becomes optional/N/A for requests
  - Filter pill: 🙋 ตามหา / ขอความช่วยเหลือ
  - Add-form: when category = `request`, hide price input + show description hint "ระบุสิ่งที่ต้องการ"
  - Detail modal CTA: "✋ ฉันช่วยได้" instead of "ติดต่อผู้ขาย"
  - **Files:** `tenant_app.html`, `firestore.rules` (no change — `category` is free-form string already), `memory/lifecycle_marketplace.md`

- [ ] **S5.2 — Stats for badge unlock prep**
  - Count `requests fulfilled` per user (foundation for Sprint 6 Pet Whisperer if request is petCategory)
  - Increment counter on chat close with `status=COMPLETED` AND original post was `request` category
  - **Files:** prep only — actual badge unlock lands in Sprint 6

**Ship gate S5:** Create request post → other tenant opens → "✋ ฉันช่วยได้" → chat opens → close as COMPLETED → counter increments.

---

## Sprint 6 — Trophies & Badges (Spec §4.3) — `~1-2 sessions`

**Why:** Engagement layer that recognizes 3 community archetypes (Giver / Sky Walker / Pet Whisperer); depends on stats from S3/S4/S5.

- [ ] **S6.1 — Badge definitions in gamification engine**
  - Per [memory/gamification_ssot.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\gamification_ssot.md): add 3 badge entries to rules engine
  - `the_giver` — unlock when user has posted ≥3 `free` items that reached `COMPLETED` (icon: leaf 🍃 Olive Green)
  - `sky_walker` — unlock when user has ≥5 transactions where `skyHookReady=true` AND `status=COMPLETED` (icon: cloud ☁️ grey)
  - `pet_whisperer` — unlock when user has ≥1 completed pet-related help (`isPetCategory=true` AND `status=COMPLETED`) (icon: paw 🐾)
  - **Files:** `shared/gamification-rules.js` (or wherever badge defs live — grep first per §7-AA)

- [ ] **S6.2 — Server-side stats counter CF**
  - New CF `marketplaceStatsAggregator.js` — Firestore onUpdate trigger on `marketplace/{postId}`; when status → COMPLETED:
    - Increment `people/{ownerUid}.marketplaceStats.{freeGiven|skyHookCompleted|petHelped}` atomically
    - Trigger badge unlock check via existing gamification engine
  - **Files:** `functions/marketplaceStatsAggregator.js` (new), `functions/index.js`

- [ ] **S6.3 — UI integration**
  - Badges appear in existing `_unlockedBadges` UI in tenant_app profile/feed
  - Icons follow Muji-minimal aesthetic per [memory/brand_living_os.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\brand_living_os.md)
  - **Files:** `tenant_app.html` (badge render), possibly `shared/gamification-display.js`

- [ ] **S6.4 — Tests + memory**
  - Unit test each badge unlock condition + idempotency (closing same post twice doesn't double-count)
  - Update `gamification_ssot.md` + `lifecycle_marketplace.md` with badge section
  - **Files:** `functions/__tests__/marketplaceStatsAggregator.test.js` (new)

**Ship gate S6:** Test tenant completes 3 free giveaways → "The Giver" badge unlocks + appears in profile + Firestore confirms.

---

## Cross-sprint hazards (CLAUDE.md §7 patterns to watch)

| Pattern | Where it might bite |
|---------|---------------------|
| §7-A (auth-gated reads) | Every chat/marketplace subscribe must use `_onLiffClaimsReady` |
| §7-N (onSnapshot error cb) | Every new subscribe must have error callback that resets unsub on permission-denied |
| §7-U (claim-first guard) | First check inside subscribe MUST be `if (!_taBuilding) return;` |
| §7-V (cleanup before rebind) | Chat list re-subscribes when building changes — must tear down old listener |
| §7-CC (`let` vs `window.`) | Chat state vars (`_chatItems`, etc.) accessed across scripts must be `window.X` |
| §7-DD (sibling cleanup) | S1.5 self-destruct must delete BOTH chat doc AND messages sub-collection |
| §7-II (CSP hash regen) | Every HTML edit that touches inline `<style>`/`<script>` must run `npm run csp:hash` + `node tools/update-vercel-csp.js` |
| §7-KK (cached-snapshot race) | Optimistic message-send + cached snapshot reconciliation — gate on `snap.metadata?.fromCache` |
| §7-J (live-verify) | Every sprint ships with Chrome MCP smoke on production, not just unit-test green |
| §7-Z (custom claims persist) | NOT applicable directly, but participants array filtering via rules must survive token refresh |

## Out-of-scope (explicitly deferred)

- Payment integration (spec §5 note: "ไม่จำเป็นต้องมี Payment Gateway" for MVP)
- Escrow service (same reason)
- Marketplace-specific admin moderation dashboard (use existing Firestore console for MVP)
- Bulk-migration of legacy base64 images (S0.2 covers lazy migration; ~30d expiry handles rest)
- Cross-building marketplace (per-building scope is intentional)
- Image upload multi-photo (single image in S0.2; multi can land post-MVP)

## Estimated total: ~6-9 sessions across all 6 sprints

| Sprint | Sessions | Cumulative |
|--------|----------|------------|
| S0 (Foundations) | 1 | 1 |
| S1 (Chat) | 3-4 | 4-5 |
| S2 (Notification) | 1-2 | 5-7 |
| S3 (Sky Hook) | 0.5 | ~6-7 |
| S4 (Pet Filter) | 0.5 | ~6-8 |
| S5 (Wishlist) | 1 | ~7-9 |
| S6 (Badges) | 1-2 | ~8-11 |

---

## ✅ Approved 2026-05-24 — execution begins

- **Sprint order:** S0 → S1 → S2 → S3 → S4 → S5 → S6 (confirmed)
- **Ship cadence:** Push every sprint gate (6+ pushes) — small blast radius, easy rollback
- **Start:** S0.1 status enum migration now
