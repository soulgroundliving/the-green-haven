# LIFF live-verify checklist

**Purpose:** verify in real LINE app the features that were only grep-verified at deploy time. Open this file in the editor while testing on phone — fill in observations as you go.

**Last assembled:** 2026-05-18 (covers C4 S2 announcements merge, Tier 3I PDPA layer, per-room WiFi, Services UX polish, lease action + doc viewer).

**Why this is user-action only:** Chrome MCP / preview servers cannot enter the LIFF auth handshake (LINE blocks non-LIFF origins). Only a real LINE app reopen exercises `signInWithCustomToken` → `token.room/building/admin` claims correctly. See [memory/auth_liff_sot.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/auth_liff_sot.md).

**How to test each item:** open the LIFF entry → follow Steps → compare what you see to Expected → tick ☐ Pass / ☐ Fail and paste a one-line observation. Send the filled file (or just the failures section) back when done; I'll update the lifecycle docs + open follow-up commits for any failures.

---

## 0. Pre-flight — MUST pass before any other section

Open LINE → Rich Menu → "เปิดแอป" (or whichever opens Nature Haven LIFF).

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | LIFF entry overlay closes within ~5s | "ตั้งค่าสิทธิ์..." overlay disappears, room view renders | |
| ☐ | No "ตั้งค่าสิทธิ์ ค้าง" hang | If it does hang ≥30s → see §7-S anti-pattern (multi-LIFF auth conflict). Note any other LIFF you had open | |
| ☐ | Top-right indicates correct identity | Tenant name + room number visible in the app bar | |
| ☐ | Console (if you can attach DevTools) — no `permission-denied` floods | Occasional permission-denied during auth transition is normal; sustained spam is not | |

**If pre-flight fails:** stop testing. Capture the overlay state + paste back. Likely auth path is broken; rest of checklist will fail by association.

---

## A. PDPA Tier 3I — consent dialog + ledger

Goal: confirm first-open consent dialog fires + writes ledger row (`consents/{tenantId}_checklist_v1`).

**Pre-state cleanup (one-time):** to re-trigger first-open, clear localStorage on the LIFF device:
- LINE → Settings → Storage → Clear cached data for Nature Haven (or just open a different LINE account)
- OR open DevTools console and run: `localStorage.removeItem('cl_consent_v1'); location.reload();`

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Open Service → "ใบตรวจสภาพห้อง" first time → modal appears | GhModal titled "🛡️ ข้อตกลงการใช้ข้อมูลส่วนบุคคล (PDPA)" — bullet list (รูปภาพ/ลายเซ็น/บันทึก) + 2-yr retention note | |
| ☐ | Tap "ยกเลิก" → returns to Services list | Page back to Services, no consent written | |
| ☐ | Tap "ยินยอม" → form renders | Checklist form visible (camera/signature/notes); modal closed | |
| ☐ | Reload page → modal does NOT re-appear | localStorage `cl_consent_v1='1'` gate works | |
| ☐ | Server ledger row written (verify after) | (Admin checks Firestore Console: `consents/{tenantId}_checklist_v1` exists with `consentedAt`, `noticeVersion='v1'`, `userAgent`) | |

**Post-test verify (admin grep, run after user has touched the flow):**
```bash
# (admin Firestore Console) Expected: 1 row for the test tenant
collection: consents
filter: tenantId == <test tenant ID> AND purpose == 'checklist_v1'
```

---

## B. PDPA Tier 3I — checklist photo upload via signed URL CF

Goal: confirm tenant photo upload uses CF-minted signed URL, not raw `getDownloadURL`.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Add a photo to a checklist item (e.g. "ห้องน้ำ" → 📷) | Photo uploads, thumbnail appears in <5s | |
| ☐ | Reload page → photo still loads | `getSignedUrl` reads via `getChecklistMediaUrl` CF; URL contains `?X-Goog-Algorithm=` (signed) NOT `?token=` (public) | |
| ☐ | (If you opened DevTools) check the photo `<img src>` | URL contains `Expires=` + `Signature=` query params (1h TTL) | |

---

## C. PDPA §32 admin erasure — CF cascade

⚠️ **Requires a test player** (a tenant whose lease has ended via `transitionToPlayer`). Do NOT run against the only live active tenant. If no test player exists, skip this section and flag below.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Admin → dashboard → tenant modal of a *transitioned player* → "🗑️ ลบข้อมูล (PDPA §32)" | Red button in modal footer (between Checklist + Close) | |
| ☐ | Step 1 modal opens | Disclosure of target identity + 2 ack checkboxes + reason field | |
| ☐ | Both checkboxes + reason → "ต่อไป" enabled | Button transitions from disabled to enabled | |
| ☐ | Step 2 friction phrase | "ลบข้อมูลของฉัน" required typed exactly; mistype → button stays disabled | |
| ☐ | "ยืนยันลบ" → loading → summary modal | Summary lists per-resource deleted counts (people/, consents/, checklistInstances/, ...) + retained-reasons (bills/leases/audit) | |
| ☐ | requestId visible in summary | Format `T_..._<iso>` (matches `dataDeletionLog/{docId}`) | |
| ☐ | Re-attempt within 7 days → "resource-exhausted" toast | "ลบไปแล้วใน 7 วัน" message; CF blocks the re-run | |

**If you have no test player available:** mark all rows ⚠️ + observation "no player to test against". I'll flag this as a known gap in `lifecycle_pdpa_checklist.md`.

---

## D. Per-room WiFi (Nest) — admin → tenant flow

Goal: verify the `roomWifi/{building}_{roomId}` Firestore + tenant claim-scoped read.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Admin → Buildings → Nest room (e.g. N201) → "WiFi/Internet" section → set SSID + password | Save succeeds | |
| ☐ | Nest tenant in N201 opens app → settings → "ข้อมูลอาคาร" / WiFi card | `#roomWifiAdminSection` shows SSID (monospace) + password (masked with 👁 toggle) | |
| ☐ | Tap 👁 toggle → password becomes visible | Toggle text changes "แสดง" ↔ "ซ่อน"; underlying value matches what admin set | |
| ☐ | Tenant in DIFFERENT Nest room (e.g. N202) → does NOT see N201's password | `#roomWifiAdminSection` either hidden (no doc for their room) or shows only their own room's WiFi | |
| ☐ | Tenant in `rooms` (ห้องแถว) building → section hidden | Per-room WiFi is Nest-only; ห้องแถว uses building-level fallback | |

**Anti-pattern §7-U guard check:** if a tenant sees an EMPTY WiFi card (SSID = `-`) for a room that admin DID set, the subscriber may be stale-bound from anonymous phase. Note any room where this happens.

---

## E. Announcements bell (C4 S2 single-source)

Goal: confirm `_subscribeBroadcasts` reads ONLY from `announcements/` (TOTAL_SOURCES=1) and renders notice + event + banner types correctly.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Open app → 🔔 bell icon — initial badge state | Either empty (0 unread) or N unread (matches your last-read cutoff) | |
| ☐ | Admin publishes a new broadcast (type=notice) | Bell badge increments within ~3s; new row appears at top with 📢 icon | |
| ☐ | Admin publishes a new event (type=event) | Bell shows 📅 icon + event date + location below body | |
| ☐ | Admin publishes a banner (type=banner) | Banner shows 🎉 icon | |
| ☐ | Tap bell to open panel | All 3 types in same panel, sorted newest first | |
| ☐ | Tap "อ่านแล้ว" / close panel → badge clears | Unread count resets; localStorage `gh_last_broadcast_read_{tid}` updated | |
| ☐ | Reload page → badge stays cleared | Last-read cutoff persists | |
| ☐ | Tenant in OTHER building (rooms vs nest) → only sees `all` + their building's audience | Audience scoping works (the test broadcast targeted to "nest" shouldn't show for ห้องแถว tenant) | |

**Composite index check (if any "FAILED_PRECONDITION" toast appears):** `firestore.indexes.json` must include `announcements: audience+sentAt` and `announcements: type+audience+sentAt`. Wait 1-5 min after deploy for index build.

---

## F. Services UX polish (2026-05-18 batch)

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Service → cleaning → Standard Clean — first-time opt-in modal | Modal appears with "Standard Clean เดือนนี้ฟรี!" if admin has opened campaign month | |
| ☐ | Service → cleaning → "ข้อตกลงและเงื่อนไข" link | Opens `#cleaning-terms-page` (Standard Clean ฟรี + Deep Cleaning 500฿ details) | |
| ☐ | Service → cleaning → checkbox "ยอมรับข้อตกลง" | Submit button enables only after check | |
| ☐ | Date picker on cleaning booking form | Date input shows correctly on iOS / Android LINE webview (no "Invalid date" placeholder) | |
| ☐ | Service → facility deep-links (parking / laundry / rooftop tiles) | Tapping each tile opens its tab inside facility page (not generic facility overview) | |
| ☐ | Service form type tabs (`#fb-type-tabs`) | Hidden (recent change — single-flow UX) | |
| ☐ | Cleaning history section position | History appears BELOW form, not above (recent UX move) | |
| ☐ | Standard Clean 6-month quota | If a tenant has used Standard Clean 6× in last 6 months → 7th attempt shows quota message | |

---

## G. Lease action — two-step confirm + doc viewer

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Profile → "ต่อสัญญา" (or "ย้ายออก") → tap | Step 1 confirm prompt appears | |
| ☐ | Step 1 → tap confirm → Step 2 final confirm | Two-step gate prevents accidental tap; clear "ส่งคำขอ" button | |
| ☐ | Submit → success page renders | "ส่งคำขอสำเร็จ" card; admin sees in 📨 คำขอ tab | |
| ☐ | Profile → "เอกสารสัญญา" → tap | Inline image viewer opens; URL is signed (1h TTL via `getLeaseDocUrl` CF) | |
| ☐ | Close viewer → return to profile | No errors | |

---

## H. Quick free-form notes

Anything weird, slow, off-brand, or confusing you noticed that doesn't fit a row above — paste below:

```
(your notes here)
```

---

## How to report back

When done, paste back (in any format):

- Filled checklist (this file) — easiest, I'll diff against expected and act on each ❌/⚠️.
- OR just the failures — name the section + row + observation.
- OR a screenshot of what looks wrong + which section it relates to.

I'll then:
1. Update `lifecycle_pdpa_checklist.md`, `lifecycle_room_wifi.md`, `lifecycle_announcements_unified.md`, `lifecycle_lease_action.md` from "code-grep verified" → "live-verified 2026-05-18".
2. Open follow-up commits for any failures with minimal diffs.
3. Promote any recurring failure mode to CLAUDE.md §7 anti-pattern if it cost a debugging round.
