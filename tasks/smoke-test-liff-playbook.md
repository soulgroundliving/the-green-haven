# LIFF Smoke Test — Tenant Side (5 critical flows, manual)

**Purpose:** mirror the admin-side smoke from `smoke-test-admin-playbook.md` from the tenant LIFF side. Catches regressions in the auth handshake / bill rendering / slip upload / checklist UX / deposit visibility that Chrome MCP physically cannot exercise (LINE platform blocks non-LIFF origins — see [auth_liff_sot.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/auth_liff_sot.md)).

**Who runs this:** the user, on a real phone, inside LINE. **Not Claude.** Open this file in an editor while testing — tick rows + paste obs.

**Runtime target:** ~5 minutes total if no failures. If a flow fails, stop and paste the failure section back; that's the regression signal.

**Pre-state:** ideally re-test as a tenant that has at least one room with bills + at least one checklist instance + a known deposit. Use the same fixture tenant the dev team uses for QA (e.g. `rooms/15`).

---

## 0. Pre-flight — LIFF entry must succeed

Open LINE → Rich Menu → **"เปิดแอป"** (or whichever entry opens Nature Haven tenant LIFF).

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | "ตั้งค่าสิทธิ์..." overlay disappears within ~5s | Home screen renders with tenant name + room number in app bar | |
| ☐ | No hang at "ตั้งค่าสิทธิ์ ค้าง" ≥30s | If hung, see §7-S (multi-LIFF auth conflict) — note any other LIFF you had open in parallel | |
| ☐ | Console (if DevTools attached) — no sustained `permission-denied` flood | Transient auth-transition flicker is normal; sustained spam = §7-A / §7-U / §7-Z regression | |

**If pre-flight fails: stop. The 5 flows below will all fail by association.** Paste the overlay state + any other LIFF you had open back to Claude.

---

## Flow 1 — Sign-in / claims propagation

**Mirror of admin Flow 1.** Confirms `_taBuilding` + `_taRoom` claims arrive from `liffSignIn` CF and `setCustomUserClaims` persisted them (§7-Z).

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Top app bar shows correct room number + tenant name | matches the LINE account's bound room | |
| ☐ | Switch to a claim-gated page (Service / Bill / Profile) — page renders, no "permission-denied" toast | claim-gated reads succeed = `token.building` / `token.room` present | |
| ☐ | Leave the app open ≥75 minutes (or come back next day), THEN reopen a claim-gated page | still renders correctly = §7-Z `setCustomUserClaims` persistence working. If now fails → §7-Z regression | |

**Result:** ☐ Pass / ☐ Fail · Obs: _______

---

## Flow 2 — Bill list + bill detail

**Mirror of admin Flow 2.** Confirms `BillStore.getByRoom` works and tenant sees their own bills.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Open Bill page (or wherever bills appear on home) | bill list renders within ~3s — at least 1 bill card visible | |
| ☐ | If list shows "ไม่มีข้อมูล" but data exists in admin | regression — see §7-A (wrong auth hook used for the read) | |
| ☐ | Tap a bill card → detail modal opens | totals, water/electric breakdown, due date all visible | |
| ☐ | Year format displays correctly (no `25xx` raw integers) | check the year label on the bill detail header | |

**Result:** ☐ Pass / ☐ Fail · Obs: _______

---

## Flow 3 — Slip upload + verification

**Mirror of admin Flow 3.** This is the only WRITE-PATH flow in the tenant smoke. Use a real bill that's currently unpaid (and if testing on production data, coordinate with admin so the test slip is dismissed/cleared after).

⚠️ **Skip this flow entirely** if you're not testing the slip pipeline specifically — slip uploads create real `payments/` records.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | On a bill detail, tap "อัพโหลดสลิป" | file picker opens, accept tiny test PNG | |
| ☐ | Upload completes within ~10s | progress indicator → success toast | |
| ☐ | verifySlip CF result reflects in UI | if SlipOK verified: bill status flips to "ชำระแล้ว" within ~30s; if SlipOK rejected: error toast with reason | |
| ☐ | LINE notification arrives (if enabled) | push to user's LINE OA chat with payment confirmation | |
| ☐ | Slip image is viewable later (NOT 404) | reopen the same bill detail → slip thumbnail loads | |

**Cleanup:** ask admin to clear the test payment from Firestore + RTDB (if dev fixture, this is part of the QA fixture flow).

**Result:** ☐ Pass / ☐ Fail / ☐ Skipped · Obs: _______

---

## Flow 4 — Checklist fill (PDPA + photos + signature)

**Mirror of admin Flow 4.** Confirms tenant-side write path for checklist instances, including PDPA consent + photo upload (via signed-URL CF, NOT `getDownloadURL`).

⚠️ **WRITE-PATH** — creates a real checklist instance. Skip if not testing checklist pipeline.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Open Service → "ใบตรวจสภาพห้อง" (or wherever the checklist entry is) — first time | PDPA modal appears (📦 GhModal with 2yr retention notice + ยินยอม/ยกเลิก buttons) | |
| ☐ | Tap "ยินยอม" → form renders | checklist form visible | |
| ☐ | Add a photo to an item → thumbnail appears within ~5s | upload succeeds; signed URL used (URL has `X-Goog-Algorithm=` NOT `?token=`) — §7-Y check | |
| ☐ | Add tenant signature (signature pad) → captured | signature PNG renders in the form area | |
| ☐ | Submit form → status = "รอตรวจสอบ" | LINE notify to admin OA chat | |
| ☐ | Reopen the instance → photos + signature still load | signed URL refresh via `getChecklistMediaUrl` CF works (§7-J live verify) | |

**Cleanup:** admin should delete the test instance via `deleteChecklistInstance` after verification.

**Result:** ☐ Pass / ☐ Fail / ☐ Skipped · Obs: _______

---

## Flow 5 — Deposit visibility

**Mirror of admin Flow 5.** Tenant should see their deposit amount in profile / badges / wherever the deposit surface is.

| ☐ | Check | Expected | Obs |
|---|-------|----------|-----|
| ☐ | Open Profile / Badges (or wherever deposit appears in tenant_app) | deposit amount renders within ~3s | |
| ☐ | If deposit is in "returned" state: return date + remaining (after deductions) visible | matches admin view exactly | |
| ☐ | No "permission-denied" toast / no infinite spinner | tenant can read `deposits/{building}_{room}` per rules | |

**Result:** ☐ Pass / ☐ Fail · Obs: _______

---

## Summary

| Flow | Pass | Fail | Skipped |
|------|------|------|---------|
| 1. Sign-in + claims | ☐ | ☐ | — |
| 2. Bill list + detail | ☐ | ☐ | — |
| 3. Slip upload | ☐ | ☐ | ☐ |
| 4. Checklist fill | ☐ | ☐ | ☐ |
| 5. Deposit visibility | ☐ | ☐ | — |

**Overall:** ☐ Green (all pass) · ☐ Yellow (writes skipped) · ☐ Red (≥1 fail)

**Failure paste-back template (send to Claude):**

```
Flow #: __
Stage: __ (what step you tapped before it broke)
Symptom: __ (what you saw vs expected)
Console (if DevTools): __ (paste relevant lines)
Any other LIFF you had open: __ (§7-S diagnostic)
Time since last sign-in: __ (helps diagnose §7-Z token-refresh boundary)
```

---

## When to run this playbook

- After deploying any change to: `tenant_app.html`, `shared/billing-system.js`, `shared/checklist-manager.js`, `functions/verifySlip.js`, `functions/liffSignIn.js`, `firestore.rules`, `storage.rules`
- Before sealing a quarterly release
- After §7-N / §7-P / §7-U / §7-Z audit-gate touches that pass the linter but might miss runtime behavior
- Pair with admin playbook for full cross-side coverage of the same 5 domains

## What this playbook does NOT cover

These are intentionally out of scope — they have their own focused playbooks:

- PDPA Tier 3I full coverage (consent ledger, DSR export, retention sweep) — see `tasks/liff-verify-checklist.md` §A–F
- C4 announcements unified — covered by `lifecycle_announcements_unified.md` verification grep
- Gamification (daily login, wellness claim, leaderboard, redemption) — separate smoke when those areas regress
- Booking / facility / community / marketplace — only critical-path features above are in the smoke
