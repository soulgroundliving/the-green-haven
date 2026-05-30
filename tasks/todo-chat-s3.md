# Marketplace Chat S3 — LINE-parity UX

Asked 2026-05-25. Plan-first per CLAUDE.md §1 (touches 5+ files, schema-additive, multiple designs with tradeoffs).

Status: **AWAITING USER APPROVAL** — do not start coding until the boxes below are confirmed (or amended).

---

## What the user asked for

1. **Read receipts** visible to both sides
2. **Unsend** + visible "ข้อความถูกยกเลิก" tombstone where the message used to be
3. **Reply** to a selected message (quote)
4. **No iOS auto-zoom** when tapping the input
5. **Send button on the SAME ROW as the input** (currently appears above on iOS — the composer IS `display:flex` but iOS scroll behavior under zoom is breaking it)
6. **Unread count badge on the 💬 ข้อความ chip** in the marketplace app-bar (currently `_renderMarketChatUnreadBadge` exists but unread UX is incomplete)
7. **Swipe-left to delete a conversation** — one-sided (only the user who swiped loses it; counterparty still sees the chat)

## Design decisions (with my proposed default)

| # | Decision | Default | Alternative |
|---|----------|---------|-------------|
| A | Read-receipt style | **LINE-style "อ่านแล้ว HH:mm" tag** on the last-read own message only | Per-message ✓ / ✓✓ ticks (busier, twice the DOM) |
| B | Read tracking granularity | **Per participant `lastReadAt[uid]: ISO timestamp` on the chat doc** | Per-message `readBy[uid]: ts` (more reads + writes, finer detail) |
| C | Unsend window | **24h after send** (matches LINE) | Always allowed (risk of late-night gaslighting) |
| D | Unsend tombstone | **Bubble stays, text → "ข้อความถูกยกเลิก" in italic + bubble dimmed**, timestamp kept | Bubble vanishes entirely (jumps the layout) |
| E | Unsend semantics | **Hard delete `text` field, set `unsent: true` + `unsentAt`** — recipient sees tombstone immediately via onSnapshot | Soft-flag only (text remains in Firestore — privacy concern) |
| F | Long-press menu | **Press-and-hold 400ms on own bubble** → action sheet with Reply / Unsend (Unsend disabled if >24h or not own message) | Three-dot button on every bubble (cluttered) |
| G | Reply payload | Inline preview block above the new bubble: 1-line truncated quote + sender name | Floating threaded view (big lift, not LINE-style) |
| H | Soft-delete | `hiddenBy[uid]: ISO timestamp` map on chat doc — list query filters out where `hiddenBy[myUid]` exists. Counterparty still sees full history. New incoming message from counterpart **un-hides** (matches LINE behavior). | Hard-deletes for self only (loses thread on re-engage) |
| I | iOS zoom fix | Set input `font-size: 16px` (Safari only zooms inputs < 16px) | `<meta viewport user-scalable=no>` (accessibility regression — blocks pinch-zoom everywhere) |

If any of A–I is wrong, say so in the reply and I'll revise the plan before starting.

---

## Phased rollout — 3 PRs

Splitting into 3 PRs limits blast radius and lets you verify each layer before the next ships. Each PR is independently revertable.

### PR 1 — Quick UX (≈ 30 min, low risk)

Smallest user-visible payoff, zero rules/schema change. Ship first to unblock chat usability.

- [ ] **Fix iOS auto-zoom** — `market-chat-input` font-size 14→16px ([tenant_app.html:4207](tenant_app.html:4207))
- [ ] **Composer layout safety** — add `align-items:center` + an `overflow-anchor:none` rule so the iOS keyboard doesn't push the send button above the input ([tenant_app.html:4205](tenant_app.html:4205))
- [ ] **Unread badge on 💬 ข้อความ chip** — finish wiring `_renderMarketChatUnreadBadge` ([tenant_app.html:7068](tenant_app.html:7068)) to the existing `#market-chat-unread-badge` span ([tenant_app.html:3231](tenant_app.html:3231)). Show number, `9+` for >9.
- [ ] **CSP regen** — inline `<script>` block edits trigger §II hook
- [ ] **Live-verify on Vercel** (iOS shape via Chrome MCP — limited but enough for layout sanity)

**Why first:** smallest diff, no rule change, addresses the most user-friction items (zoom + send-button + tab badge). Reversible by 1 revert.

### PR 2 — Read receipts (≈ 1.5h)

Schema-additive only. Backward compatible — older messages without `lastReadAt` render as before.

- [ ] **Schema:** add `lastReadAt: { uid1: ISO, uid2: ISO }` map on each `marketplace_chats/{chatId}` doc — update on every active-chat snapshot via the existing `_markChatRead` path
- [ ] **firestore.rules:** widen the existing update rule (already permits any participant to update — just need to confirm `lastReadAt` is allowed in the diff). Today's rule has no `hasOnly([...])` constraint on chat-doc updates so this is permissive enough — add a comment naming the field for future readers
- [ ] **`_markChatRead`** — write `lastReadAt.${myUid} = now` + clear `unreadCount.${myUid}` in one batch (today it only clears unread)
- [ ] **renderChatMessages** — find the LAST message where `senderId === myUid` AND `timestamp <= lastReadAt[counterpartUid]`. Render "อ่านแล้ว HH:mm" under that bubble in `var(--fs-xs)` muted color
- [ ] **Rules CI tests:** 2 new cases — participant can write `lastReadAt.${self}`; non-participant cannot
- [ ] **Migration:** none — existing docs missing the field render as "no read receipt yet", which is correct semantically (counterparty has never opened the chat)

**Why second:** highest perceived value after PR 1; doesn't depend on unsend/reply infra; tells the user "the recipient saw your message" — the #1 missing chat affordance.

### PR 3 — Long-press menu + Reply + Unsend + Swipe-delete (≈ 4h)

The 4 are coupled (they share the per-message touch handler and bubble re-render shape). One PR avoids a half-finished menu.

- [ ] **Long-press handler** — module-level `_attachChatLongPress(container)` that detects 400ms touchstart-without-move, opens an action sheet positioned near the bubble. Two actions:
  - Reply (always shown)
  - Unsend (own bubble + within 24h only)
- [ ] **Reply preview UI** — above `#market-chat-input`, a 36px-tall inline block showing the quoted text (truncated 1 line) + sender label + a × dismiss button. Stored in a new global `window._activeChatReplyTarget`
- [ ] **Reply field** — when send fires with `_activeChatReplyTarget` set, write `replyTo: { messageId, senderId, textSnippet }` (snippet capped to 80 chars to keep doc small). Existing 5-key `hasOnly` rule needs to widen — schema-additive change to rules
- [ ] **Reply render** — incoming/outgoing bubble with `replyTo` shows a tiny grey card above the message text: "↩ ตอบกลับ {senderLabel}: {snippet}". Tapping the card scrolls to & briefly highlights the parent message (CSS animation)
- [ ] **Unsend logic** — call a new CF `unsendMarketplaceMessage({chatId, messageId})` that verifies `senderId === auth.uid`, `now - timestamp < 24h`, then `update({ text: '', unsent: true, unsentAt: now })`. Why CF: the existing rule allows updating only `isRead`; loosening rules to allow self-edits creates an integrity hole (sender could rewrite history). CF is safer.
- [ ] **Unsent render** — bubble dimmed (50% opacity), text replaced with italic "ข้อความถูกยกเลิก", timestamp kept, no long-press menu on already-unsent messages
- [ ] **Swipe-left to soft-delete** — pointer events on each `.market-chat-row` (chat list). Threshold 80px → reveals a red 80px-wide "ลบ" panel. Tap → confirm dialog → call new CF `hideMarketplaceChat({chatId})` that writes `hiddenBy.${auth.uid} = now`. Chat list query stays the same — client filters out `hiddenBy[myUid]` rows
- [ ] **Un-hide on new message** — `notifyMarketplaceChat` CF (or a new `onCreate` hook on messages) clears the counterpart's `hiddenBy` entry when a new message arrives, matching LINE
- [ ] **firestore.rules updates:**
  - Allow self-set of `hiddenBy.${self}` on chat-doc update
  - Allow `replyTo` in message create — widen `hasOnly` to include it
  - Disallow client setting `unsent`/`unsentAt`/`hiddenBy[other]` directly (CFs handle those via admin SDK)
- [ ] **Rules CI tests:** 5 new cases (reply field allowed, self-hide allowed, other-hide blocked, unsent-by-client blocked, unsend-CF-write allowed via admin)
- [ ] **CF unit tests:** unsendMarketplaceMessage (3 cases: own/24h ✓, own/>24h ✗, non-own ✗); hideMarketplaceChat (2 cases: participant ✓, non-participant ✗)
- [ ] **Live-verify on Vercel** end-to-end via Chrome MCP — limited because real interaction needs 2 tenant accounts; will document a manual LIFF test plan

**Why third / bundled:** these 4 share rule-edit + CF-deploy + message-bubble-shape changes. A staggered rollout would re-edit the same rules/bubble code 4 times. One PR, one rules deploy, one CF deploy.

---

## Out of scope (this sprint)

- Group chats (>2 participants)
- Media messages (images, voice notes)
- Typing indicators
- Push notifications other than the existing `notifyMarketplaceChat` LINE Flex bubble
- Message search
- Admin-side moderation UI

---

## Open question for you

If you want any of decisions A–I changed before I start, say so. Otherwise reply "go" and I'll execute PR 1 → 2 → 3 in sequence, opening each as its own PR and merging via your standing-auth squash flow.

Recommended path: **PR 1 alone first** to unblock the chat-typing pain, then ack before I open PR 2/3 (since 2 & 3 take real schema + rule changes that warrant a re-look).
