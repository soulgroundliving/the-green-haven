# CRITICAL Security Sprint — 2026-05-22

**Status:** plan-first, awaiting ✅ from user. Do NOT edit code until approved.

**Prior plan archived:** [tasks/todo-plan-b-prime-archive.md](tasks/todo-plan-b-prime-archive.md) (Plan B' occupancyLog — S2+S3+S4+S6 shipped per `3c79fc1`, S5 partial, Review section never closed).

---

## Scope

ปิด **7 CRITICAL** (5 จาก multi-dimensional review + **2 ใหม่** จาก deep rules review ที่ second-pass จัดเป็น CRITICAL หลังเห็น attack scenario ที่ trivial-to-exploit).

ไม่รวม: HIGH/MEDIUM/LOW → next sprint (table ด้านล่าง).

---

## 🚨 2 CRITICAL ใหม่ (เกิดจาก deep review — promoted from MED in first pass)

### NC-1 — RTDB `payments` tenant-writable: forge payment records
**[config/database.rules.json:29-31](config/database.rules.json:29)**

`.write` ใช้ `auth.token.room == $room && auth.token.building == $building` → tenant ที่ login ปกติ call ตรงๆ ได้:

```js
firebaseSet(ref(db, 'payments/rooms/15/anyBillId'),
  { amount: 9999, status: 'paid', billId: 'anyBillId' });
```

Admin reconciliation อ่านจาก RTDB เห็น "paid" — อาจไม่ cross-check `verifiedSlips` → bill ถูกมาร์คชำระโดย slip ปลอม.

- **Risk:** financial fraud trivial
- **Fix (1 line):** `.write` → `"auth != null && auth.token.admin == true"` (เหมือน bills/)
- **Pre-fix cross-check:** memory บอก `shared/tenant-system.js:1499` มี `firebaseSet` ลง payments → ต้องตรวจ flow นั้นว่ายังต้องการเขียนตรงไหม หรือควรไปผ่าน verifySlip CF

### NC-2 — `tenants/{b}/list/{r}` update: cross-tenant PII overwrite
**[firestore.rules:242-244](firestore.rules:242)**

Update rule ไม่มี ownership check. signed-in user คนใดก็ได้ (รวม anon booking prospect) เขียน `name`/`phone`/`email`/`nationalId` ของห้องอื่นได้. block แค่ `gamification`/`rentAmount`/`building`/`roomId`/`tenantId`.

- **Risk:** PII tampering ใครๆ ก็ทำได้
- **Fix:** เพิ่ม `(isAdmin() || (isSignedIn() && resource.data.linkedAuthUid == request.auth.uid))` AND existing `affectedKeys().hasOnly()` block
- **Pre-fix gotcha:** tenant ที่ยังไม่ link (linkedAuthUid ว่าง) จะอัพเดท self-profile ผ่าน path นี้ไม่ได้ — ต้องมั่นใจ liffSignIn / admin link flow seed `linkedAuthUid` ก่อน (`grep linkedAuthUid functions/`)

---

## ✅ Phase 1 — Code Edits (no deploy, all in repo)

### Fix #1 — smoke_config.json hygiene
ไฟล์เก็บ Firebase Web API key (public-by-design แต่ config-commit ขัด hygiene). Pre-commit hook ดักเฉพาะ pattern `firebaseConfig.*apiKey` ไม่ใช่ raw JSON shape.

- [ ] Add `smoke_config*.json` to `.gitignore` (line ใหม่ใต้ `smoke_*.html` ที่มีอยู่)
- [ ] `git rm --cached smoke_config.json` (ไฟล์ยังอยู่ local, ไม่ถูก git track)
- [ ] Update `tools/smoke-test/*.js` runner (ถ้ามี ref smoke_config.json) ให้โหลด config ผ่าน `/api/config` runtime แทน
- **Why:** ลบ vector + ป้องกัน config drift local/CI + ตรงตามจุดยืน .gitignore เดิม

### Fix #2 — Slip rate-limit fail-CLOSED (2 CFs)
**[functions/verifySlip.js:103-107](functions/verifySlip.js:103)** ปัจจุบัน:
```js
} catch (error) {
  console.error('❌ Rate limit check failed:', error);
  return true;   // ← fail open
}
```

**[functions/verifyBookingSlip.js:85-88](functions/verifyBookingSlip.js:85)** — pattern เดียวกัน.

- [ ] Change return `true` → `false` (deny)
- [ ] Caller code already handles `false` → returns 503 ไปแล้ว — ตรวจ caller path
- **Why deny:** transient Firestore throttle ≠ free pass. 503 spike เห็นและ alertable; abuse spike เงียบ.

### Fix #3 — `_billFlex.js` surface silent errors
**[functions/_billFlex.js:45](functions/_billFlex.js:45)** — `loadRoomConfig` catch ปัจจุบัน:
```js
} catch (e) { /* fall through to defaults */ }
```

**[functions/_billFlex.js:54-56](functions/_billFlex.js:54)** — `loadOwnerInfo` catch silent return blank.

- [ ] เพิ่ม `console.error('[_billFlex] loadRoomConfig failed for', building, roomId, ':', e?.message || e)` ใน catch
- [ ] เพิ่ม `console.error('[_billFlex] loadOwnerInfo failed:', e?.message || e)` ใน loadOwnerInfo
- **Behavior:** ไม่เปลี่ยน — ยัง fall through to DEFAULTS, แค่มี log line ให้เห็น failure
- **Why:** ปัจจุบันบิลออกด้วย DEFAULT rates (rooms: rent 1200 / นี่อาจไม่ตรงห้องจริง) โดยไม่มีอะไรเตือน

### Fix #4 — CSP enforce
**[vercel.json:39](vercel.json:39)** — เปลี่ยน header name `Content-Security-Policy-Report-Only` → `Content-Security-Policy`.

- [ ] Single-char-class change in vercel.json
- [ ] **DO NOT** remove `style-src-attr 'unsafe-inline'` ในรอบนี้ — a11y review พบ 297 hardcoded hex (inline style) ใน tenant_app → ลบจะแตกหน้า
- **Why this round:** hash whitelist 26 ตัวเสียเปล่าทั้งหมดถ้ายัง Report-Only
- **Risk mitigation:** existing CSP `'unsafe-inline'` ยังอยู่ใน script-src/style-src → backward-compat OK ในรอบเดียว

### Fix #5 — `facilityBookings` claim fallback (closes §7-P gap)
**[firestore.rules:451-460](firestore.rules:451)** — read rule L453 ใช้แค่ `tenantUid == request.auth.uid`. หลัง LIFF anon-UID rotation → booking สูญหาย invisible แม้ tenant คนเดียวกัน.

- [ ] Mirror checklistInstances dual-path ที่ L495-497 — เพิ่ม:
  ```
  || (isSignedIn()
      && resource.data.tenantBuilding == request.auth.token.building
      && resource.data.tenantRoom == request.auth.token.room)
  ```
  ลง read rule
- Create rule L457 มี `tenantBuilding == request.auth.token.building` แล้ว ✓ — ไม่ต้องแก้
- Keep `tenantUid == request.auth.uid` stamp at create (defensive double-anchor)

### Fix #6 — RTDB payments admin-only write (NC-1)
**[config/database.rules.json:29-31](config/database.rules.json:29)**

- [ ] **Pre-fix:** `grep -rn "firebaseSet.*payments\|set.*payments/" shared/ tenant_app.html dashboard.html` — บันทึก call site ทุกตัว
- [ ] ถ้ามี client write — refactor ไปผ่าน CF ที่เหมาะสม (อาจเป็น verifySlip → markBillPaidInRTDB ที่มีอยู่)
- [ ] เปลี่ยน `.write` → `"auth != null && auth.token.admin == true"`
- [ ] Read rule keep current (tenant อ่าน payment ตัวเองได้)

### Fix #7 — tenants update self-ownership (NC-2)
**[firestore.rules:242-244](firestore.rules:242)**

- [ ] **Pre-fix:** `grep -rn "linkedAuthUid" functions/ shared/` — ยืนยัน linkedAuthUid ถูก seed ทุกเส้นทาง link (liffSignIn, admin manual link)
- [ ] เพิ่ม condition: `(isAdmin() || (isSignedIn() && resource.data.linkedAuthUid == request.auth.uid))` AND existing affectedKeys() block
- **Risk:** ถ้ามี tenant ใน prod ที่ `linkedAuthUid` ว่าง — self-update จะถูก block → ต้อง backfill ก่อน OR ใช้ admin UI

---

## ✅ Phase 2 — Local Verification (read-back, no deploy)

- [ ] Cross-session self-conflict check (§7-G): re-read ALL session diffs end-to-end
- [ ] `npm run verify:memory` (pre-commit hook auto แต่ check ล่วงหน้า)
- [ ] `npm run test:rules` — ~70 cases ต้องผ่าน + **เพิ่ม new test cases:**
  - NC-1 — anon/tenant client write to `payments/...` → expect deny
  - NC-2 — signed-in non-owner write to `tenants/rooms/list/X` → expect deny; owner self-write OK
  - #5 — facilityBookings read after UID rotation (mock anon UID drift) → expect allow via claim fallback

---

## ✅ Phase 3 — Deploy (USER-CONTROLLED per §7-I, no auto-deploy)

- [ ] User: `firebase deploy --only firestore:rules,database` (rules atomic deploy)
- [ ] User: `firebase deploy --only functions:verifySlip,functions:verifyBookingSlip,functions:notifyTenantOnMeterUpload,functions:notifyBillOnCreate` (all _billFlex importers)
- [ ] User: `git push origin main` → Vercel auto-deploy → CSP enforce live

---

## ✅ Phase 4 — Live Verification (Chrome MCP, no auto-click per §7-I)

- [ ] Admin dashboard → DevTools console → check CSP violation reports (was silent in Report-Only)
- [ ] **Probe forge payment** (LIFF webview as tenant): paste in console:
  ```js
  firebaseSet(ref('payments/rooms/15/test_forge_' + Date.now()),
    { amount: 1, status: 'paid' })
  ```
  → expect `PERMISSION_DENIED`
- [ ] **Probe PII overwrite** (admin preview as room 15): paste in console:
  ```js
  updateDoc(doc(db, 'tenants/rooms/list/14'), { name: 'attacker' })
  ```
  → expect `PERMISSION_DENIED`
- [ ] **facilityBooking UID-rotation test:** open LIFF booking, `await auth.currentUser.getIdToken(true)`, close tab, reopen — confirm booking still visible
- [ ] **_billFlex log path:** mock failure by temporarily denying `rooms_config` read for one tenant → trigger meter upload → check CF logs for new error line

---

## ⏭️ Deferred to next sprint (knowingly)

| Item | Severity | Why deferred |
|------|----------|--------------|
| CORS `*` on 17 admin endpoints | HIGH | needs shared CORS helper extract — refactor scope |
| `liffUsers` create no schema | HIGH | needs `userId == 'line:' + ...` check + allowlist |
| RTDB `housekeeping` tenant-writable | HIGH | same pattern as NC-1, lower business risk |
| `buildings/{id}` promptPayId all-readable | HIGH | needs decision: split sensitive to admin subcoll? |
| Marketplace `ownerUid` impersonation | HIGH | needs `ownerUid == request.auth.uid` create stamp |
| `isBuildingManager` `'ro' in 'rooms'` CEL | HIGH | only via admin grant error — fix grant tool first |
| HTML-escape 14 dups → `window.ghEsc` | HIGH (XSS path) | careful grep-replace, batch w/ brand cleanup |
| `dashboard-extra.js` split (1734 LOC) | MED | architectural refactor |
| `BuildingPolicy` for building #3 | MED | strategic, not urgent |
| A11y/Brand cleanup batch | C+ | UX debt |
| 6 silent-failure sites | C+ | separate sprint |
| Remove CSP `style-src-attr 'unsafe-inline'` | MED | gated on inline-style cleanup |
| Legacy RTDB `tenants` + `financials` nodes | LOW | verify zero callers + cleanup |

---

## Estimated effort
- Phase 1 (code): ~75 min (#6 pre-fix grep may grow scope)
- Phase 2 (verify local + new test cases): ~30 min
- Phase 3 (deploy): user, ~15 min total
- Phase 4 (verify live): ~30 min
- **Total: ~2h sprint**

## Files touched
- `.gitignore` (+1 line)
- `smoke_config.json` (removed from tracking, stays local)
- `tools/smoke-test/*.js` (if any references — refactor)
- `functions/verifySlip.js` (1-line change)
- `functions/verifyBookingSlip.js` (1-line change)
- `functions/_billFlex.js` (2 catch + log)
- `vercel.json` (1 header rename)
- `firestore.rules` (2 rules: facilityBookings + tenants)
- `config/database.rules.json` (1 path: payments)
- `test/firestore.rules.test.*` (add 3 new cases)
- Optionally `shared/tenant-system.js` (if NC-1 cross-check finds client payment-write)

---

## Review (2026-05-22 evening — Phase 1+2 complete, awaiting user for Phase 3 deploy)

### ✅ Shipped (Phase 1 — code in working tree, NOT committed)
1. **smoke_config.json** — removed from git tracking (staged delete), `.gitignore` updated. No code refactor needed (grep confirmed zero callers).
2. **Rate-limit fail-CLOSED** — both [functions/verifySlip.js:103](functions/verifySlip.js:103) and [functions/verifyBookingSlip.js:85](functions/verifyBookingSlip.js:85) now `return false` on infra error + descriptive log.
3. **_billFlex.js error surfacing** — [functions/_billFlex.js:45](functions/_billFlex.js:45) `loadRoomConfig` + L57 `loadOwnerInfo` now log on catch. Fallback to DEFAULTS preserved.
4. **CSP enforce** — [vercel.json:39](vercel.json:39) header renamed to `Content-Security-Policy`. `style-src-attr 'unsafe-inline'` retained (defer until inline-style cleanup batch).
5. **facilityBookings claim fallback** — [firestore.rules:451-465](firestore.rules:451) read rule now mirrors checklistInstances 3-path pattern (admin / tenantUid / tenantBuilding+tenantRoom claims). §7-P closed at this surface.
6. **RTDB payments admin-only write** — [config/database.rules.json:30](config/database.rules.json:30) lock + [functions/verifySlip.js markBillPaidInRTDB:308](functions/verifySlip.js:308) added Admin SDK push to `payments/{b}/{r}/{pushId}` with shape matching legacy client push (billId, month, year, amount, paidAt ISO, method, transRef, source='cf:verifySlip').
7. **tenants update self-ownership** — [firestore.rules:242-256](firestore.rules:242) update rule now requires `(isAdmin() OR linkedAuthUid match)` AND the existing affectedKeys block. Verified all active tenants have linkedAuthUid via [functions/liffSignIn.js:218-244](functions/liffSignIn.js:218) writes.

### ✅ Tests (376 unit + 192 rules, ALL PASS)
- Added [firestore.rules.test.js:157-198](firestore.rules.test.js:157) — replaced "anon CAN update non-sensitive" with 3 tests reflecting NC-2 rule: anon CANNOT update, linked CAN update, linked CANNOT update sensitive.
- Added [firestore.rules.test.js:~1296-1326](firestore.rules.test.js:1296) — 2 facilityBookings tests: UID-rotation read via claim fallback (Fix #5), cross-building claim mismatch denies.
- **NC-1 RTDB unit test DEFERRED** — firestore.rules.test.js infra is Firestore-only; adding RTDB would need `database:` config in initializeTestEnvironment + emulator port + new test helpers. Out of sprint scope.

### ⚠️ Pre-existing issues uncovered (NOT this sprint's fault)
- **`npm run verify:memory` has 1 fail unrelated to this sprint** — Cat-A CF hardening (commits `c98b7f6 _authSoT helper` + `5bbdbf8 migrate to _authSoT` + 5 more 6-path ports) was shipped on other branches (`claude/<various>`) but **NEVER MERGED to main**. `functions/_authSoT.js` doesn't exist in this worktree. The verifier in `lifecycle_pdpa_checklist.md:142` was written assuming Cat-A had landed. **Fix applied this sprint:** updated the verifier to target `functions/_authSoT.js` (literal user request) — will pass once Cat-A merges. **Still fails on this branch** until Cat-A merge lands. Pre-commit hook WILL block this commit. Options: (a) cherry-pick / merge the Cat-A branches into main first; (b) `git commit --no-verify` (last resort, but pre-existing-condition is the unusual case CLAUDE.md doesn't explicitly cover); (c) defer this sprint until Cat-A is merged.
- **Dead code (§7-K)** — [shared/tenant-system.js:1488-1513](shared/tenant-system.js:1488) `TenantFirebaseSync.updatePayment` is defined but has ZERO callers. Discovered during pre-fix grep. Safe to delete in cleanup sprint.

### 🚀 Phase 3 — User must run (deploy commands)
```bash
# 1. Deploy rules (Firestore + RTDB atomic)
firebase deploy --only firestore:rules,database

# 2. Deploy CFs (importers of _billFlex + the two slip CFs)
firebase deploy --only functions:verifySlip,functions:verifyBookingSlip,functions:notifyTenantOnMeterUpload,functions:notifyBillOnCreate

# 3. Push to Vercel (CSP enforce + .gitignore changes)
git add .gitignore config/database.rules.json firestore.rules firestore.rules.test.js functions/_billFlex.js functions/verifyBookingSlip.js functions/verifySlip.js vercel.json tasks/todo.md tasks/todo-plan-b-prime-archive.md
git status   # verify ONLY the intended files staged + smoke_config.json deletion
# Pre-commit verify:memory will fail on getChecklistMediaUrl — see "Pre-existing issues" above.
# If fix-forward chosen: address that BEFORE commit. Otherwise commit with --no-verify (last resort).
git commit
git push origin main
```

### 🔍 Phase 4 — Live verification probes (Chrome MCP, no auto-click per §7-I)
Open admin dashboard on https://the-green-haven.vercel.app + DevTools console:

1. **CSP enforce verification** — refresh, check console for CSP violations (now BLOCKING; was silent in Report-Only).
2. **Forge payment probe** (paste in LIFF tenant console):
   ```js
   firebaseSet(ref('payments/rooms/15/test_forge_' + Date.now()), { amount: 1, status: 'paid' })
   ```
   → **expect `PERMISSION_DENIED`** (was succeeding pre-NC-1).
3. **PII overwrite probe** (paste in admin preview as room 15):
   ```js
   updateDoc(doc(db, 'tenants/rooms/list/14'), { name: 'attacker' })
   ```
   → **expect `PERMISSION_DENIED`** (was succeeding pre-NC-2). Then test as the legit room-14 owner: should still succeed if linkedAuthUid matches.
4. **facilityBooking UID-rotation** — open LIFF booking, then `await auth.currentUser.getIdToken(true)`, close tab, reopen → booking must still appear.
5. **_billFlex log path** — trigger meter upload that causes a permission_denied on `rooms_config/{b}/{r}` (e.g. malformed config) → check CF logs for `[_billFlex] loadRoomConfig failed for ...` line.
6. **Payment CF audit** — verify a real slip → check RTDB `payments/{b}/{r}` for new doc with `source: 'cf:verifySlip'`.

### 📝 Out-of-sprint follow-ups (next sprint candidates)
1. **Fix `verify:memory` getChecklistMediaUrl verifier** (1-line fix to verifier OR add pattern back to CF)
2. **Delete `TenantFirebaseSync.updatePayment` dead code** (§7-K cleanup)
3. **Remove legacy tenant_app.html:12122 client push** to payments/bills paths (already silent-failing per locked-down rule; remove dead retry)
4. **NC-1 RTDB unit test** — add `database:` config to test env, write RTDB rule tests
5. **CSP `style-src-attr 'unsafe-inline'` removal** — gated on inline-style cleanup batch (297 hex hardcoded in tenant_app)
6. **Update memory lifecycle docs** — `lifecycle_verifyslip.md` (new payments/ CF write), `firestore_schema_canonical.md` (tenants update gate), `billing_monthly_flow.md` (rate-limit fail-closed semantics)
7. **HIGH security findings** (still pending from deep review): CORS `*` on 17 admin endpoints, liffUsers schema, marketplace ownerUid spoofing, buildings PII, RTDB housekeeping, isBuildingManager CEL substring

### 🧠 Potential new §7 anti-patterns (defer to user judgment — CLAUDE.md already 944 LOC)
- **"II. Rate-limit checks must fail CLOSED, not open"** — both slip CFs had explicit `return true` on catch with "fail open" comment. Recurring vulnerability pattern; would warrant a §7 entry if it surfaces again.
- **"JJ. Tenant-writable RTDB path with admin-only readers = forgery vector"** — `payments/` was tenant-writable so client could push records that admin reconciliation displayed as truth. Pattern: never let principals lower in the auth chain write data that higher principals trust without server-side validation.
