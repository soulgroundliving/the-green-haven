# Lease-Expiry Auto-Notifier — 60d / 30d → 🔔 Bell + Admin

**Status:** plan-first, awaiting approval. Do NOT edit code until ✅ from user.
**Supersedes:** previous C4 Session 2 plan (shipped 2026-05-18, see `next_session_handoff_2026_05_18_c4_announcements_phase2.md`).

## Goal (user request 2026-05-19)

> "อยากให้แจ้งลูกบ้านอัตโนมัติไปเลยภายใน 60 วันมีแจ้งเตือน 1 รอบ และ 30 วัน อีก 1 รอบ
> โดยที่แจ้งในกระดิ่งและสามารถกด redirect ไปที่หน้าต่อสัญญาได้อัตโนมัติ
> ส่วนในหน้าแอดมินก็แจ้งเตือนอัตโนมัติ"

**Two reminders only:** one when daysRemaining first hits ≤ 60, one when daysRemaining first hits ≤ 30. After that, no further notifications until renewal / move-out. Bell click → `contract-action-page`. Admin dashboard mirrors the same alerts.

This **supersedes** the always-on `_leaseAlertItem()` we just shipped (`b039bc8`) — that one is "warn continuously while in window" which conflicts with the user's "exactly 2 reminders" spec. The local synthesizer comes out.

## Architecture

**Single source of truth:** new Firestore collection `leaseNotifications/{building}_{room}_{milestone}` (deterministic doc ID for idempotency).

```
leaseNotifications/{docId}                    docId = `${b}_${r}_${ms}`  e.g. "rooms_15_60d"
├─ building              string  ('rooms' | 'nest')
├─ room                  string  ('15' / 'N101')
├─ tenantId              string  (people/{id})
├─ tenantName            string  (denormalized for admin display)
├─ milestone             string  ('60d' | '30d')
├─ leaseEndDate          timestamp
├─ daysRemainingAtEmit   number   (e.g. 58 if CF caught up after a missed day)
├─ createdAt             timestamp  (serverTimestamp)
├─ status                string  ('unread' | 'read' | 'stale')
└─ lastReadAt            timestamp?  (when tenant opened the bell entry)
```

**Trigger:** new scheduled CF `leaseExpiryNotifier` runs daily 09:00 BKK in asia-southeast1.

**Catch-up logic** (handles missed days, deploy gaps, paused tenants):
```
for each active lease (tenants/{b}/list/{r}):
  daysRemaining = ceil((endDate - now) / 86400000)
  if daysRemaining > 60: continue                                  # too early
  if daysRemaining <= 60 AND !exists(`${b}_${r}_60d`):
    write the 60d doc
  if daysRemaining <= 30 AND !exists(`${b}_${r}_30d`):
    write the 30d doc
```

Idempotency via deterministic ID + existence check → safe to re-run, safe to ship a backfill day-1.

**Tenant bell read path:**
- New onSnapshot subscriber in `tenant_app.html` — filters `leaseNotifications/` by `building == token.building AND room == token.room`
- Result is 0–2 docs, prepended to bell list (same render slot as current `_leaseAlertItem`, same yellow-band styling)
- Click handler on the lease-notification row → `showSubPage('contract-action-page')` + write `status:'read', lastReadAt: serverTimestamp()`
- Remove the local `_leaseAlertItem()` synthesizer + `displayLeaseRenewalAlert` shim

**Admin dashboard:**
- Replace local localStorage compute in `populateLeaseAlerts` (`shared/dashboard-extra.js:~625-706`, hard-coded 30d threshold) with Firestore subscription on `leaseNotifications/` grouped by building + milestone
- Existing UI cards (`#lease-expiry-alerts` rooms / `#nest-lease-expiry-alerts` nest) reused — just data source flip
- New visual: group by milestone ("60 วัน (X)" then "30 วัน (Y)") inside each card
- Click admin row → opens People Mgmt drawer for that tenantId (existing pattern)

## Files Touched

| File | Change | Why |
|------|--------|-----|
| `functions/leaseExpiryNotifier.js` | **NEW** scheduled CF (~120 LOC) | Daily cron, scans tenants, writes notifications |
| `functions/index.js` | export the new CF | Wire into deploy graph |
| `firestore.rules` | add rules for `leaseNotifications/{docId}` | tenant read own, admin read all, CF/admin write |
| `firestore.indexes.json` | composite index `(building, room)` + `(building, milestone, status)` | needed for the two query shapes |
| `tenant_app.html` | swap `_leaseAlertItem` synth → onSnapshot subscriber + click handler with CTA | bell shows server doc, click → renewal page |
| `shared/dashboard-extra.js` + `dashboard.html` | replace `populateLeaseAlerts` localStorage compute → Firestore subscription | admin sees same server truth |
| `memory/lifecycle_lease_action.md` | append "Auto-notifier" section | doc the new lifecycle |
| `memory/lifecycle_scheduled_jobs.md` | bump CF count + register `leaseExpiryNotifier` | scheduled-job index |
| `memory/MEMORY.md` | update lifecycle_lease_action.md line description | index sync |

Total: ~7 code files (1 new), 1 new CF, 1 new collection, 1 rules block, 1 index pair, 3 memory docs.

## Sprint Plan

### S1 — Server-side (~30 min)
- [ ] `functions/leaseExpiryNotifier.js` — scheduled CF, asia-southeast1, daily 09:00 BKK, Asia/Bangkok tz
- [ ] Export in `functions/index.js`
- [ ] `firestore.rules` — add `match /leaseNotifications/{docId}` block:
  - tenant read: `request.auth.token.building == resource.data.building && request.auth.token.room == resource.data.room`
  - tenant update: same gate, only `status` + `lastReadAt` fields mutable
  - admin read+write: all
  - CF write: bypasses rules (admin SDK)
- [ ] `firestore.indexes.json` — composite indexes for the 2 query shapes
- [ ] Deploy: `firebase deploy --only functions:leaseExpiryNotifier,firestore:rules,firestore:indexes`
- [ ] Trigger CF manually once via Cloud Scheduler (or pubsub topic publish) — verify it writes docs for any currently-eligible leases without crashing
- [ ] **Commit + push**

### S2 — Tenant bell (~25 min)
- [ ] Add module state in `tenant_app.html`: `_taLeaseNotifsUnsub`, `_taLeaseNotifs = []`
- [ ] Add `_subscribeLeaseNotifications()` — gated via `_onLiffClaimsReady` (per §7-A/U), claim-presence guard, error callback (per §7-N), prior-unsub teardown on rebind (per §7-V)
- [ ] Rewrite `_leaseAlertItem` to **read from `_taLeaseNotifs`** instead of computing locally; return most recent unread doc (30d wins over 60d if both exist) as the synthesized bell entry
- [ ] Add click handler on the lease-notification row → `showSubPage('contract-action-page')` + setDoc merge `status:'read', lastReadAt: serverTimestamp()`
- [ ] Remove (or stub) `displayLeaseRenewalAlert` — subscription drives re-render directly
- [ ] **Commit + push, verify on Chrome MCP** (mock lease end-date to trigger 60d/30d, see bell entry, click → renewal page redirects)

### S3 — Admin dashboard (~25 min)
- [ ] Replace `populateLeaseAlerts` in `shared/dashboard-extra.js` (currently localStorage compute at 30d, lines ~625-706) with Firestore subscription on `leaseNotifications/`
- [ ] Same building split (rooms vs nest), same `#lease-expiry-alerts` / `#nest-lease-expiry-alerts` containers
- [ ] Group rendered items by milestone with sub-headers
- [ ] Click row → opens People Mgmt drawer for that tenantId
- [ ] Tear-down listener pattern (per §7-V — `realtimeListeners.leaseNotifs` slot, unsub before rebind)
- [ ] **Commit + push, verify on Chrome MCP** (admin sees the 60d + 30d entries in both buildings' cards)

### S4 — Memory + verify (~15 min)
- [ ] Append "Auto-notifier (2026-05-19)" section to `memory/lifecycle_lease_action.md` with grep-verifiable claims (file + line + function name + collection path)
- [ ] Update `memory/lifecycle_scheduled_jobs.md` — bump CF count from 9 → 10, register `leaseExpiryNotifier` schedule + region
- [ ] Update `memory/MEMORY.md` — bump lifecycle_lease_action.md line description
- [ ] Run `npm run verify:memory` — green
- [ ] **Commit + push**

## Risks & decisions

1. **Audience-per-tenant in `announcements/`?** Decided NO. The existing `audience: 'all'|'rooms'|'nest'` enum is building-scoped. Extending it to per-tenant would require schema changes across `publishAnnouncement` CF, bell subscriber, and rules — wider blast radius than introducing a focused `leaseNotifications/` collection. Less coupling: lease lifecycle owns its own collection.

2. **Reuse existing `_leaseAlertItem` rendering?** Yes — same yellow-band styling, same virtual-item marker. Just swap data source from local compute to subscriber state. Minimizes UI churn.

3. **What if a tenant never opens the app?** They miss the in-app bell. LINE push integration is OUT of scope for this sprint — flag as follow-up. Admin can still see the dashboard alert and reach out manually.

4. **What if lease end date changes (renewal approved, admin edited)?** The notification docs become stale (still say "60d left" when actual is now further out). Decision: scheduled CF re-evaluates daily; if `daysRemainingAtEmit` no longer matches reality (lease was renewed, endDate moved out > 60d), mark doc `status:'stale'`. Tenant + admin still see them as historical record. Cleaner audit trail than silent deletions.

5. **§7-A / §7-U risk** (auth-callback bypass): new tenant subscriber MUST go through `_onLiffClaimsReady` with `if (!_taBuilding) return` claim guard. Pre-commit `audit:auth` gate will catch a missed wrapper.

6. **§7-V risk** (listener leaks): the new subscribers (both tenant + admin) must store unsubscribe in a stable slot AND tear down the prior listener before rebinding. Otherwise multiple subscriptions stack across rerenders.

7. **§7-N risk** (silent onSnapshot errors): every onSnapshot MUST have an error callback. Silent `permission-denied` during init = stuck state with no diagnostic.

8. **§7-Z claim risk:** the rule `request.auth.token.room == resource.data.room` requires the persistent custom claims fix from `a5f4e5a` (`setCustomUserClaims` in `liffSignIn`). Already shipped; new tenants are good. Pre-existing tenants who never re-opened LINE since 2026-05-18 may have stale tokens — they'd see permission-denied until next sign-in. Acceptable transitional state; admin can re-trigger via "ลิงก์ LINE" flow if needed.

9. **Pre-commit hooks:** verify-memory + audit-auth + audit-size + anti-pattern detection all run automatically. No special bypass needed.

## Estimated total time: ~95 min across 4 sprints, ~4 commits

## Branch / push plan

- Current worktree branch `claude/nervous-bhabha-7b1503`, pushing directly to `main` (project workflow §5)
- 4 atomic commits along sprint boundaries — each independently revertable
- Vercel auto-deploys static; Firebase CLI deploys CF + rules + indexes

## Verification checklist (rolled up to S4)

- [ ] CF deployed, visible in GCP Console scheduled jobs (`firebase functions:list` or Console UI)
- [ ] Manual trigger via Cloud Scheduler succeeds without errors; deployed CF logs show clean run
- [ ] Mock lease (62d → set to 58d via Firestore Console): no doc written until ≤ 60d, then `${b}_${r}_60d` appears
- [ ] Mock lease (30d): both `_60d` and `_30d` docs exist
- [ ] Tenant bell shows the unread doc with click → renewal page redirect verified on Chrome MCP (admin preview)
- [ ] Admin dashboard shows same docs grouped by milestone on Chrome MCP
- [ ] Marking `status:'read'` from tenant click reflects in dashboard (no double-counts)
- [ ] `npm run verify:memory` green
- [ ] Optional / nice-to-have: a real Nest tenant on LINE LIFF (per §7-J)

## After approval

Mark each item with ✅ as it ships. Append "Review" section at the end with: shipped / deferred / follow-ups (per CLAUDE.md §3).
