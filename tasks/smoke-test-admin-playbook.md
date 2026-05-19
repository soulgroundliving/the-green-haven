# Chrome MCP Smoke Test — Admin Side (5 critical flows)

**Purpose:** repeatable regression-catch for the 5 admin-side critical flows. Run this whenever a recent deploy could plausibly break login, bill rendering, slip viewing, checklist viewing, or deposit viewing.

**Runtime target:** <10 minutes end-to-end, all 5 flows green.

**Read-only by default** — this playbook never creates / modifies / deletes production data. It clicks, navigates, observes, and asserts. Any write-path smoke would go in a separate `smoke-test-admin-playbook-write.md` (does not exist yet — file an issue when it does).

**Driver:** Claude (via `mcp__Claude_in_Chrome__*` tools) — `mcp__Claude_in_Chrome__navigate`, `find`, `form_input`, `left_click`, `get_page_text`, `read_console_messages`, `read_network_requests`, `screenshot`. If the Chrome extension isn't connected, ask the user to install it before starting.

**Backed by:** `tools/smoke-test/verify.js` — Node REST asserter that confirms server-side ground truth matches what the playbook saw in the browser. Each flow calls one verifier subcommand.

**Reading verifier output:** each subcommand prints one JSON line. Treat it as:
- `"pass": true` → tick ☐ Pass for that row
- `"pass": false, "inconclusive": true` → tick ☐ Inconclusive (fixture absent, not a regression — e.g. no deposit doc has been seeded yet)
- `"pass": false` with no `inconclusive` flag → tick ☐ Fail; the `diag` field tells you what's wrong

---

## Pre-flight (must pass before any flow)

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | `SMOKE_ADMIN_EMAIL` env var is set | non-empty | |
| ☐ | `SMOKE_ADMIN_PASSWORD` env var is set | non-empty (don't print) | |
| ☐ | `firebase login` was run on this machine | `node tools/smoke-test/verify.js login --email $SMOKE_ADMIN_EMAIL` returns `"pass": true` even before opening any browser tab (this confirms verifier auth + admin claim) | |
| ☐ | Vercel reachable | `curl -sI https://the-green-haven.vercel.app/login` → HTTP 200 | |
| ☐ | Chrome MCP extension connected | `mcp__Claude_in_Chrome__list_connected_browsers` returns a browser | |
| ☐ | Fixture room `rooms/15` has bills | `node tools/smoke-test/verify.js bill --building rooms --room 15` returns `"pass": true` — verified 2026-05-19 dry-run = 2 bills exist | |
| ◯ | Fixture deposit `deposits/rooms_15` exists (informational) | `node tools/smoke-test/verify.js deposit --building rooms --room 15` — verified 2026-05-19: empty (`"inconclusive": true`). Flow 5 will run in inconclusive mode until a deposit is recorded | |
| ◯ | Any checklist instance exists (informational) | Until a tenant submits one, Flow 4 will run inconclusive | |

**Stop conditions:** rows marked ☐ MUST pass. Rows marked ◯ are informational only — they document fixture state, not gating. If a ☐ row fails, do NOT proceed (smoke result would be meaningless). If only ◯ rows are inconclusive, proceed; flow result will be Yellow not Red.

---

## Flow 1 — Admin Login

**Goal:** confirm credentials path works end-to-end (Firebase Auth → custom claim → dashboard redirect).

### Steps

1. `mcp__Claude_in_Chrome__navigate` → `https://the-green-haven.vercel.app/login`
2. Wait for `#loginForm` to be present (`find` by id or text "เข้าสู่ระบบ")
3. `form_input` on `#loginEmail` → `$SMOKE_ADMIN_EMAIL`
4. `form_input` on `#loginPassword` → `$SMOKE_ADMIN_PASSWORD`
5. `left_click` on `#loginBtn`
6. Wait ≤8s for URL change to `/dashboard`
7. `read_console_messages` — capture any messages

### Assertions

| ☐ | Assertion | How |
|---|-----------|-----|
| ☐ | URL ends with `/dashboard` | `mcp__Claude_in_Chrome__read_page` → check `location.href` |
| ☐ | Sidebar visible (renders dashboard sidebar with `[data-action="showPage"]` buttons) | `find` element with `data-page="dashboard"` |
| ☐ | No `[ERROR]` lines in console | `read_console_messages` — filter level=error |
| ☐ | No `permission-denied` floods | sustained spam = §7-P / §7-Z hazard, file follow-up |
| ☐ | Verifier confirms admin claim | `node tools/smoke-test/verify.js login --email $SMOKE_ADMIN_EMAIL` → exit 0 |

### Result

- [ ] Pass / [ ] Fail
- Obs:

---

## Flow 2 — Bill view (admin)

**Goal:** confirm admin can navigate to a room's bills and that a bill detail modal renders correctly.

### Steps

1. From dashboard, click sidebar entry `[data-page="bill"]` (`left_click`)
2. Wait for bill page to render (`find` by text "บิล" or similar header)
3. Locate the fixture room (`rooms/15`) bill card — `find` by text containing "ห้อง 15" or by selector `[data-room="15"]`
4. `left_click` to open bill detail modal
5. Wait for modal to be visible (look for `display:flex` or `aria-modal="true"`)
6. `read_page` modal contents

### Assertions

| ☐ | Assertion | How |
|---|-----------|-----|
| ☐ | Bill modal opens, contains room number | text "15" present in modal |
| ☐ | A `totalAmount` or "ยอดรวม" is rendered (non-zero number) | regex match digits in modal text |
| ☐ | Payment status displays ("ชำระแล้ว" / "ค้างชำระ" / "รอตรวจสลิป") | one of those phrases present |
| ☐ | No `[ERROR]` in console since flow start | `read_console_messages` filter |
| ☐ | Verifier confirms server data exists | `node tools/smoke-test/verify.js bill --building rooms --room 15` → exit 0 |

### Result

- [ ] Pass / [ ] Fail
- Obs:

---

## Flow 3 — Slip view (admin)

**Goal:** confirm admin can view a verified payment slip image + metadata. **Does NOT upload anything.**

### Steps

1. Stay on bill modal from Flow 2 (or re-open if closed)
2. `find` element with text "ดูสลิป" / "สลิป" / or `<img>` thumbnail inside the bill detail
3. If a slip exists on this bill: `left_click` to expand
4. If no slip exists on the fixture bill: navigate to "ค้นหาบิลที่มีสลิป" — open another room's bill known to have a slip (during S4 dry-run, populate `SMOKE_BILL_WITH_SLIP_ROOM` env var with the room id)
5. Wait for slip viewer overlay (`find` by image with `slip_*` filename pattern in src or class `slip-img`)
6. `read_network_requests` — check the slip image URL

### Assertions

| ☐ | Assertion | How |
|---|-----------|-----|
| ☐ | Slip viewer overlay appears | DOM contains `<img>` with src matching slip URL |
| ☐ | Image src is a Storage signed URL (NOT raw download) | URL contains `X-Goog-Algorithm=` or signed-url params (§7-Y check) |
| ☐ | Verification status displays ("verified" / "verified by SlipOK" / amount + bank) | extract by text grep |
| ☐ | No `[ERROR]` since flow start | `read_console_messages` |

### Result

- [ ] Pass / [ ] Fail
- Obs:

**Known limitation:** if no fixture room has a verified slip at smoke time, this flow is **inconclusive** rather than fail. Mark Obs="no slip available — flow inconclusive" and continue.

---

## Flow 4 — Checklist view (admin)

**Goal:** confirm admin can navigate to a checklist instance and that photos / signatures / status all render.

### Steps

1. From dashboard, click sidebar → People Mgmt (`[data-page="tenant"]`) OR Requests-Approvals (`[data-page="requests-approvals"]`) — whichever surface hosts the checklist tab in this deploy (the admin UI is `#checklist-admin-list` per dashboard.html:5257)
2. `find` "ใบตรวจสภาพห้อง" / "checklist" tab and click
3. Wait for `#checklist-admin-list` to render
4. Pick the first instance card — `find` first child of `#checklist-admin-list` with status-tag (`รอตรวจสอบ` / `เสร็จสิ้น` / etc.)
5. `left_click` to open the instance viewer
6. `read_page` viewer contents

### Assertions

| ☐ | Assertion | How |
|---|-----------|-----|
| ☐ | Instance viewer opens with room number visible | text matches `/ห้อง\s*\d+/` |
| ☐ | At least one photo `<img>` renders | DOM query: `img[src*="firebasestorage"]` or signed-URL src |
| ☐ | Tenant signature OR admin signature image present | `<img>` with `signature_` in src |
| ☐ | Status badge displays | one of `รอตรวจสอบ` / `กำลังตรวจ` / `เสร็จสิ้น` |
| ☐ | Capture instance ID from URL or DOM data attribute | required for verifier in next row |
| ☐ | Verifier confirms instance exists with required fields | `node tools/smoke-test/verify.js checklist-instance --id <id>` → exit 0 |
| ☐ | No `[ERROR]` since flow start | `read_console_messages` |

### Result

- [ ] Pass / [ ] Fail
- Obs:

**Known limitation:** if `#checklist-admin-list` is empty (no instances on production), mark this flow inconclusive. Don't generate a test instance — write-path is out of scope.

---

## Flow 5 — Deposit view (admin)

**Goal:** confirm admin can open the deposit management page for a known room and see deductions + remaining balance.

### Steps

1. Navigate to People Mgmt (`[data-page="tenant"]`) or wherever the per-tenant drawer opens
2. `find` the fixture room (`rooms/15`) tenant card / row
3. `left_click` to open tenant detail drawer
4. `find` deposit tab or button (text "เงินมัดจำ" / "deposit")
5. `left_click` to enter deposit detail
6. `read_page` deposit panel

### Assertions

| ☐ | Assertion | How |
|---|-----------|-----|
| ☐ | Deposit panel opens, shows `originalAmount` value | regex match: number with "฿" or "บาท" |
| ☐ | If deductions exist: list/table renders | DOM check |
| ☐ | If status='returned': remaining balance + return-date visible | text grep |
| ☐ | No `[ERROR]` since flow start | `read_console_messages` |
| ☐ | Verifier confirms server data | `node tools/smoke-test/verify.js deposit --building rooms --room 15` → exit 0 |

### Result

- [ ] Pass / [ ] Fail
- Obs:

---

## Summary

| Flow | Pass | Inconclusive | Fail |
|------|------|--------------|------|
| 1. Login | ☐ | — | ☐ |
| 2. Bill view | ☐ | — | ☐ |
| 3. Slip view | ☐ | ☐ | ☐ |
| 4. Checklist view | ☐ | ☐ | ☐ |
| 5. Deposit view | ☐ | — | ☐ |

**Overall result:**
- ☐ All flows Pass → smoke green
- ☐ ≥1 Fail → smoke red; capture failure mode below and route per "Failure-mode appendix"
- ☐ ≥1 Inconclusive (Flows 3 or 4 only) → smoke yellow; document missing fixture data

**Failure notes:**

```
(paste console errors, screenshot paths, or one-line summary per failed flow)
```

---

## Failure-mode appendix — most likely break per flow

| Flow | Likely cause | First diagnostic |
|------|--------------|------------------|
| 1. Login | Firebase Auth API key rotated · CSP regression blocking auth domain · admin claim revoked | Network panel: `identitytoolkit.googleapis.com` request status. Verifier: `login` check fails = claim issue, not network. |
| 2. Bill view | `BillStore.getByRoom` broken (see §7-D) · billing-system.js script load failed · RTDB rule tightened without grep (see [feedback_rule_tighten_trace_clients.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/feedback_rule_tighten_trace_clients.md)) | Console: look for "BillStore" or "permission-denied" on `bills/rooms`. Verifier `bill` check confirms server has data. |
| 3. Slip view | `getDownloadURL` ban regression · CSP `connect-src` doesn't allow Storage host · §7-Y (`fetch(data:)`) reintroduced | Network panel: image fetch URL — should have `X-Goog-Algorithm=`. CSP violation if any: console will show "Refused to connect". |
| 4. Checklist view | §7-P UID-drift on storage.rules · `#checklist-admin-list` doesn't render = `dashboard-checklist-admin.js` failed to load · §7-Z claims expired (waited >1h) | Console: look for module-load failures. If permission-denied: re-login and retry — likely §7-Z token-refresh boundary. |
| 5. Deposit view | `deposits/{building}_{room}` doc was migrated to a different shape · rules block admin read · drawer UI script (dashboard-requests-admin.js) failed to load | Verifier `deposit` check separates server-shape issue from client UI issue. |

---

## Anti-pattern relevance reminder

When triaging a smoke failure, scan these CLAUDE.md §7 patterns first — they fire most often in this app:

- **§7-A / §7-U / §7-V** — auth-gated reads / `_onLiffClaimsReady` / setupXxxListener leaks (only relevant on the tenant side, but symptoms cross over when admin previews tenant flows)
- **§7-N** — `onSnapshot` without error callback = silent stuck-loading
- **§7-P** — UID-drift fixes must traverse every rule layer
- **§7-T** — two writers, one reader — field-name drift
- **§7-Y** — `fetch('data:...')` CSP block (slip viewer)
- **§7-Z** — `createCustomToken` claims ephemeral after ~1h (login retry test catches)

If smoke fails AND triage points to a new anti-pattern not listed above, add it to CLAUDE.md §7 per the Self-Improvement Loop (CLAUDE.md §1).
