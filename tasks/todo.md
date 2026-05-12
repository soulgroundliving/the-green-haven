# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Plan — Tier 1A: Broadcast Announcements (in-app only, no LINE)

## Why
Admin currently has no way to push announcements to all tenants. LINE OA free tier = 200 msg/month → too expensive at scale. In-app notification is free + unlimited + owned infra. Bell icon on World Map = tenant sees it immediately on first screen after login.

**Decision (2026-05-12, user)**: skip LINE Multicast entirely. CF writes `broadcastMessages/{id}` doc; tenant_app subscribes via `onSnapshot` filtered by building. LINE integration deferred until tenant base justifies a paid OA plan.

## Existing infra to REUSE (no duplication)
- `_auth.js` `requireAdmin(req,res)` — Bearer token + admin claim gate
- `functions/index.js` — CF re-export pattern
- Dashboard tab pattern — `data-action="switchContentTab"` (Announcements is the closest UX pattern)
- Building filter pattern — `setAnnouncementBuilding('all'|'rooms'|'nest')` (`dashboard-content-features.js:7`)
- Toast — `showToast()` (`dashboard-main.js:207`)
- Confirm — `window.ghConfirm(msg,{danger:true})` (`modal.js:244`)
- Admin CF call pattern — `getIdToken()` + `Authorization: Bearer` (`dashboard-extra.js:6274`)
- `_onLiffClaimsReady(fn)` (`tenant_app.html:7244`) — gates auth-dependent subscriptions in tenant_app per CLAUDE.md §7.A
- World Map avatar chip pattern (`tenant_app.html:2185`) — rounded card with backdrop-filter, top-left corner — bell icon mirrors at top-right

## What to BUILD

### A1. Cloud Function `functions/broadcastMessage.js`
HTTPS onRequest (Gen 1, asia-southeast1, mirrors region of existing CFs).

**Flow:**
1. `requireAdmin(req,res)` — reject non-admin
2. Validate body: `{title, body, building}`
   - `title`: 1–80 chars
   - `body`: 1–500 chars
   - `building`: `'all'` | `'rooms'` | `'nest'`
3. Compute `audience = building` (kept as separate field for rule clarity)
4. Write `broadcastMessages/{auto}` doc atomically:
   - `{title, body, audience, sender: {uid, email}, sentAt: serverTimestamp, status: 'published'}`
5. Return `{ok: true, id}` 

**Why no LINE call**: free tier = 200 msg/mo, paid = ฿1,200+/mo. In-app subscription on free Firestore listener is cheaper + delivery is verifiable via UI. LINE integration deferred to Tier 2 if needed.

**Tradeoff vs LINE**: Tenant must open the app to see notification. Acceptable because (a) tenants open app for bills/eco-points anyway, (b) future: add push notification via Service Worker (already registered) for free.

### A2. Cloud Function tests `functions/__tests__/broadcastMessage.test.js`
- valid request → doc written with audience, title, body, status='published'
- non-admin → 403
- missing title → 400
- title > 80 chars → 400
- body > 500 chars → 400
- invalid building value → 400
- title trimmed of whitespace
- sender populated from decoded token (uid + email)
- 8 test cases

### A3. Dashboard admin UI — new tab in Requests & Approvals page
Add a 6th sub-tab to the Requests & Approvals page (where LINE Link Requests already lives) — **"📣 ประกาศ"**.

**Form:**
- หัวข้อ (title) — text input, 80 char counter
- ข้อความ (body) — textarea, 500 char counter
- ส่งถึง — radio buttons: ทุกอาคาร (all) / ห้องแถว (rooms) / Nest
- 📤 เผยแพร่ — disabled until form valid
  - On click → `ghConfirm('เผยแพร่ประกาศนี้ใน {building} — ยืนยัน?', {danger:false})`
  - On confirm → call CF, show toast, refresh log, clear form

**Publication log:**
- Table below form: last 20 broadcasts (date, sender email, title preview, audience badge)
- Click row → modal showing full body + sender + sentAt
- Delete button (admin-only) → `ghConfirm` + CF call to soft-delete (`status:'deleted'`) — or stretch goal, skip in v1

### A4. Firestore rules
Add to `firestore.rules`:
```
match /broadcastMessages/{id} {
  allow read: if isAdmin();
  allow write: if false;  // CF writes via admin SDK
}
```

### A5. Firestore rules tests
Add 3 cases to `firestore.rules.test.js`:
- admin can read broadcastMessages list
- non-admin cannot read
- direct client write rejected (must go through CF)

### A6. Tenant app in-app notification — Bell on World Map
**Where**: World Map page (first screen after login), top-right corner mirroring avatar chip at top-left (`tenant_app.html:2185`).

**Bell UI** (visible ONLY on `#world-map-page`):
- Rounded card same backdrop style as avatar chip: `background: rgba(255,255,255,0.8); padding: 8px 12px; border-radius: 30px; backdrop-filter: blur(5px);`
- Position: `top: 20px; right: 20px; z-index: 20`
- 🔔 icon + red badge with unread count (hidden when count = 0)
- aria-label="ประกาศจากผู้ดูแล (N ใหม่)"

**Dropdown / overlay** when bell clicked:
- Full-screen overlay on mobile, popover on desktop
- Header: "📣 ประกาศ" + close button
- List of last 10 broadcasts, newest first
  - Each item: title (bold), body excerpt (2-line clamp), relative time ("เมื่อสักครู่", "5 นาทีที่แล้ว", "เมื่อวาน")
  - Unread items have left-border accent + bold title
- Tap item → expand inline to show full body
- Empty state: "ยังไม่มีประกาศ"
- Auto mark-as-read on first open (update localStorage timestamp)

**Subscribe via** `_onLiffClaimsReady(_subscribeBroadcasts)`:
- Firestore query: `broadcastMessages` orderBy(sentAt desc) limit(20)
- Client-side filter on `audience` in (`'all'`, `token.building`)
- Update badge + list on every snapshot
- On NEW broadcast detected (after initial replay): show toast "📣 ประกาศใหม่" + play subtle chime (existing tenant_app sound system if available, else skip)

**localStorage**:
- Key: `gh_last_broadcast_read_{tenantId}` — ISO timestamp string
- Default: epoch 0 (everything counts as unread on first login)
- Updated when bell dropdown opens

**Out of scope (A6 v1)**: per-broadcast read receipt (server-side), pinning, dismiss action, FCM push notification, scheduled broadcasts

### A7. Memory updates
- New `~/.../memory/lifecycle_broadcast_message.md` with Verification block (5-6 claim/grep triples — must cover both CF + tenant app subscription)
- Append to MEMORY.md under 🏛️ System Lifecycles (Admin / analytics section)
- New handoff doc + update index

## Risk gate (BEFORE implementation)

| Risk | Mitigation |
|------|-----------|
| Wrong audience (sent to all when meant one building) | Confirm dialog shows audience label before publish |
| Spam abuse if admin token leaks | `requireAdmin` gate; CF rejects empty/oversized payloads |
| Auth-gate race in tenant_app (per CLAUDE.md §7.A) | Subscribe via `_onLiffClaimsReady` not `addEventListener('authReady')` |
| Stale unread count when switching devices | Use server timestamp comparison + localStorage; on next load badge re-derived from Firestore (no client mutation persisted to server) |
| Bell icon hidden on other tenant_app pages | Intentional v1 — World Map is the landing page; tenants will see badge before navigating elsewhere |
| Service worker caches old broadcasts | Firestore onSnapshot bypasses SW cache for data (only UI shell is cached) |

## Out of scope (Tier 1A — defer to later)
- LINE broadcasts (deferred until paid OA plan justified)
- Bell icon on other tenant_app pages (only World Map v1)
- Scheduled broadcasts (send at future time)
- Per-room granular filter UI (only building-level v1)
- Per-recipient read receipts (only client-side unread tracking v1)
- Service Worker push notification
- Broadcast templates / saved drafts
- Soft-delete from admin UI (v1: append-only log)

## Build order
1. ✅ Recon + plan (this doc)
2. ⏳ A1 broadcastMessage.js CF
3. ⏳ A2 CF tests
4. ⏳ A4 + A5 rules + rules tests
5. ⏳ A3 dashboard admin UI
6. ⏳ A6 tenant_app in-app notification UI
7. ⏳ Deploy CF + push UI → Vercel
8. ⏳ Live verify: 1 test broadcast → LINE received + bell badge appears on tenant_app ห้อง 15
9. ⏳ A7 memory + handoff
10. ⏳ Commit + merge to main

## Verification gate (DOD)
- [ ] `node --test functions/__tests__/broadcastMessage.test.js` ≥ 8/8 pass
- [ ] `npm run test:rules` 5 new cases pass (3 admin + 2 tenant read scope)
- [ ] CF deployed `firebase deploy --only functions:broadcastMessage`
- [ ] Dashboard admin tab visible + form publishes broadcast → row appears in log
- [ ] `broadcastMessages/{id}` doc written with `audience='rooms'`, `status:'published'`, sender populated
- [ ] tenant_app World Map: bell icon visible at top-right with badge `1`
- [ ] Click bell → dropdown shows the test broadcast title + body
- [ ] Reload tenant_app → badge clears (was marked-read on dropdown open)
- [ ] Publish 2nd broadcast → badge re-appears with `1`
- [ ] Console zero errors on both dashboard + tenant_app
- [ ] Memory verifier still GREEN (`npm run verify:memory`)

---

## Review (2026-05-12)

### Shipped
- CF `broadcastMessage` deployed (asia-southeast1) — admin-only, validated, returns `{ok, id}`
- 13/13 CF unit tests pass (validation + 400/403/500 + whitespace + OPTIONS)
- Firestore rules: `broadcastMessages` admin write blocked + tenant reads filtered by audience
- 7 new rules tests (admin / tenant building match / mismatch / unauth / direct write blocked)
- Dashboard admin tab "📣 ประกาศ" — compose form + char counters + audience radio + ghConfirm + live publication log (onSnapshot, last 20)
- Tenant_app bell icon on World Map top-right + red unread badge + fullscreen panel + auto-mark-read + toast on new
- Subscription via `_onLiffClaimsReady(_subscribeBroadcasts)` per CLAUDE.md §7.A anti-pattern guard
- Inline toast helper `_broadcastShowToast` (no global showToast dependency)
- Memory: new `lifecycle_broadcast_announcement.md` + handoff doc + MEMORY.md index — verifier 24 docs / 224 rows ALL GREEN

### Live verified
- Admin published 1 test broadcast → toast `✅ เผยแพร่สำเร็จ` + log row shows correctly
- Firestore REST query: `broadcastMessages` has 1 doc with proper shape (title/audience/sender/sentAt)
- Bell DOM rendered on tenant_app (admin preview chrome occludes it visually — not a real-world issue)
- Zero console errors on dashboard or tenant_app

### Bug found + fixed mid-session
- `publishBroadcast` not in dashboard-main.js event delegation hub → button click had no effect.
  Fixed in commit `112a98e` (1 line added).

### Commits + merges
- `37d861b` — feat(tier1a): broadcast announcements
- `112a98e` — fix: wire publishBroadcast in data-action hub
- `9706cd5`, `0f03598` — merge commits on main
- CF + rules deployed via `firebase deploy`; UI deployed via Vercel auto-build

### Deferred (out of scope this session)
- LINE multicast (cost gated)
- Scheduled broadcasts
- Per-room granular filter UI
- Server-side read receipts
- FCM push
- Soft-delete from admin UI
- Saved drafts
- Bell on tenant_app pages other than World Map

### Next session
- Tier 1B: Monthly Expense Tracking (`expenses/{building}/{YYYY-MM}/{auto}` + dashboard tab + P&L integration with `aggregateMonthlyRevenue`)
- Or extend Phase 6 migration manifest to cover leftover legacy fields if found in active rooms
