# ▶▶▶ ACTIVE PLAN (2026-06-13) — Deposit **pre-move-in lifecycle** (จอง 500 ก่อนเข้า · reserved · no-show ริบ · เดือนแรก waiver) · ⏳ AWAITING OWNER APPROVAL

> Owner asked (2026-06-13): a system to take the deposit **before actual move-in** (deposit ≠ guarantee of moving in), record the two payment chunks (฿500 จอง + ส่วนที่เหลือ) + slips, waive the first month rent, and refund at move-out with a transfer slip. This plan adds the **FRONT half** of the deposit lifecycle. The **BACK half** (held → move-out refund + slip) already exists (#253 + owner spec [deposit-pet-damage-rules.md](deposit-pet-damage-rules.md) §1.1–1.5) — **untouched** here.

---

## What already exists (reuse — do NOT rebuild)
- **Owner spec** [deposit-pet-damage-rules.md](deposit-pet-damage-rules.md) §1.1 (มัดจำ = ค่าเช่า 2 เดือน, **คืนได้** ไม่ใช่ค่าธรรมเนียม, ผ่อนได้) · §1.3 (ย้ายออก = หักบิลเดือนสุดท้าย + เสียหายจากมัดจำ → คืนส่วนต่าง + สลิป). **Confirms Q1 answer.**
- **Move-out #253 — COMPLETE.** `_saveDepositReturn` ([dashboard-deposits-admin.js:476-599](../shared/dashboard-deposits-admin.js)) = `DepositCalc.netRefund(held, finalBillTotal, deductions)` (= held − บิลเดือนสุดท้าย − หัก) + `refundSlip` upload + bills→`paidVia:'deposit_settlement'` + `DEPOSIT_RETURNED` audit + history archive + PNG receipt. The "คนย้ายออก + สลิปโอนคืน" the owner has = **already supported**.
- **`DepositCalc`** ([deposit-calc.js](../shared/deposit-calc.js)) — `depositPaid`/`depositDue` (`paidSoFar`; absent = fully paid §7-L) = ready-made **2-chunk** math. `netRefund` (:50) = the refund model — **don't touch**. Deductions are free-text `{desc, amount, photo}` → "ค่าทำความสะอาด" is just another deduction line (no new type).
- **Installment mechanism present** — `_saveDepositInstallment` ([dashboard-deposits-admin.js:459-467](../shared/dashboard-deposits-admin.js)) writes `paidSoFar` + mirrors `depositPaidSoFar`. The "ผ่อนมัดจำ" entry button was removed (2026-06-04 `d217b7b`) but the **write path is intact** → re-wire it for the 2-chunk pre-move-in recording.
- **Move-in billing gate** — `moveInBoundaryYM` ([_billWrite.js:65](../functions/_billWrite.js), precedence `lease.moveInDate → moveInDate → lease.startDate → startDate`, **NOT** contractStart §7-BBB) + `isBeforeMoveIn` (:82) already skip bills BEFORE the move-in month. Note: **month-granularity** (loses the day) — the first-month waiver needs a **new day-aware** helper.

## Owner decisions LOCKED (2026-06-13)
- **Q1 — accounting.** มัดจำ = เงินประกัน **คืนได้** (held). เดือนสุดท้าย: หักค่าใช้จ่ายทั้งหมด (ค่าห้อง + น้ำ + ไฟ + ขยะ + เสียหาย + ทำความสะอาด) ออกจากมัดจำ → โอนคืนส่วนต่าง + สลิป → **= §1.3 / #253 ที่ทำแล้ว, ขาคืนไม่แตะ.** เดือนแรก: **ไม่จ่ายค่าห้องถ้าเข้าต้นเดือน; เข้ากลางเดือน = จ่ายปกติ** (waiver มีเงื่อนไข — NEW).
- **Q2 — 500 + no-show.** ฿500 = **เครดิตเข้ามัดจำ** (นับเป็นส่วนหนึ่งของ 2 เดือน). จ่ายแล้วไม่ย้ายเข้าจริง = **ริบทั้งหมด** (forfeit, no refund).

## Owner decisions — FINAL LOCKED (2026-06-13)
- **🔑 Move-in month rent = DAILY PRORATION (Option A).** default `charges.rent = round((monthlyRent ÷ 30) × daysOccupied)`, `daysOccupied = lastDayOfMonth − moveInDay + 1`. **Grace: `daysOccupied ≤ 5` → 0 (ฟรี)**. เดือนเต็มถัดไป = เก็บเต็มปกติ **ทุกเคส**. utilities/น้ำ/ไฟ/ขยะ = ตามจริงเสมอ. **⛔ SUPERSEDES the earlier "D1 ≤5 ฟรีเดือนแรก"** — ไม่มี free first month: คนเข้าต้นเดือนจ่าย ~เต็ม (อยู่เกือบเต็มเดือน), คนเข้าปลายเดือน ≤5 วัน = ฟรี (grace).
- **🔑 Admin override (มาตรฐาน + ยืดหยุ่นรายเคส).** ระบบคิด default proration ให้ → admin ปรับได้ต่อเคส (ลดราคา / ยกเว้น / ใส่-ลดค่าปรับ) → บันทึก `amount` + `reason` + `actionAudit`. นี่คือกลไกที่ทำให้ "บางเคสขอลด / จ่ายช้าหักค่าปรับ / ยอมหักเต็ม" เป็นระบบ + โปร่งใส ตรวจสอบได้.
- **D4 · admin-driven** (ขยาย `deposits/` admin page).
- **D5 · UPDATED 2026-06-13 — สลิป verify ผ่าน SlipOK ได้ (รวม "จ่ายรวมหลายห้อง 1 สลิป"); เงินสด = บันทึกเอง.** `method:'slip'` → SlipOK (anti-fraud เหมือน rent/booking) → เก็บ `txid`; `method:'cash'` → หลักฐาน manual. ลำดับ: จอง ฿500 → ยืนยันจ่าย → ผู้เช่าโอนมัดจำที่เหลือ → บันทึก/verify ก้อนสอง.
- **🔑 Lump (หลายห้องจ่ายรวมก้อนเดียว).** 1 payment ครอบหลายห้อง → กระจายเข้าแต่ละ `deposits/{b}_{r}` + อ้างอิงร่วม `lumpRef`. รองรับ `cash` (บันทึกเอง) **และ `slip` → verify ผ่าน SlipOK** (ยอดสลิป = Σ allocations ผ่าน `splitLumpCash`, dedup 1 `txid`, กระจายทุกห้อง).
- **Q1/Q2:** มัดจำ = ประกันคืนได้ (move-out #253 untouched) · ฿500 เครดิตเข้ามัดจำ · no-show ริบทั้งหมด.

## Why Plan-First (CLAUDE.md §1 — all three)
schema (status enum + reserved/forfeit + chunk/slip fields) + billing rule (first-month waiver in `_billWrite.js`) + CF (confirmMoveIn / forfeit) + `firestore.rules` + dashboard UI + tenant badge + tests ≈ **8–12 files**; schema/billing/CF/rules = **not single-revert** (CF + rules deploy); **2+ approaches** (admin-vs-LIFF D4, waiver scope D2).

## §7-O/AA greenfield check (run before coding)
`grep -rn "reserved\|preMoveIn\|forfeit\|firstMonthWaiv\|moveInWaiver\|isFirstOccupiedMonth" shared/ functions/` → expect ~0 outside this plan. Confirm nothing orphaned to wire.

---

## Data model changes
**`deposits/{b}_{r}`** (additive — existing docs untouched, no destructive migration §7-L):
- `status`: add `'reserved'` (จ่ายก่อนย้ายเข้า, ยังไม่ active) + `'forfeited'` (no-show). Existing `{holding, returned}` unchanged.
- `paidSoFar`: reuse for 2 chunks — จอง ฿500 → `paidSoFar=500`; ส่วนที่เหลือ → `paidSoFar=amount`.
- NEW: `reservedAt`, `expectedMoveInDate`, `payments:[{label:'จอง'|'มัดจำ', amount, method:'slip'|'cash', slipPath?, lumpRef?, txid?, at}]` (D5: สลิป(SlipOK)/เงินสด; `lumpRef`=จ่ายรวมหลายห้อง; `txid`=SlipOK transactionId), `forfeitedAt`, `forfeitedAmount`.
- Move-in slip files (when `method='slip'`) → `deposits/{b}/{r}/payment_*.{ext}` (mirror the `refundSlip` storage pattern).

**Bill (RTDB)** for the move-in month: `charges.rent` = `round((monthlyRent/30) × daysOccupied)`, OR `0` when `daysOccupied ≤ 5` (grace); admin may override → write `charges.rent` + `rentAdjustment:{reason, by, defaultWas}`; utilities/trash = actual; flag `rentProration:{moveInDay, daysOccupied, graced}`; recompute `totalCharge`/`totalAmount`.

## State machine
```
(admin records pre-move-in)   → reserved   (paidSoFar 500→full · slips · expectedMoveInDate)
  reserved ─[ยืนยันย้ายเข้าจริง]→ holding    (set lease.moveInDate §7-BBB · activate tenant · first-month rule applies)
  reserved ─[no-show]──────────→ forfeited  (ริบทั้งหมด · audit · NO refund)              [Q2]
  holding  ─[#253 move-out]────→ returned   (refund = held − บิลเดือนสุดท้าย − หัก + สลิป)  ← DONE, untouched
```

---

## Tasks

### Phase 1 — Data model + pre-move-in reserved recording (admin · additive · NO billing change)
- [x] ✅ **`shared/deposit-calc.js`** (pure + dual-export) — added `depositPhase(dep)` (`reserved|holding|returned|forfeited`, legacy→holding §7-L), `recordDepositPayment(dep, {amount, method, slipPath, lumpRef, txid})` → `{paidSoFar, payments[]}` (immutable, clamps to `amount`; `txid`=SlipOK ref), `splitLumpCash(total, [{building, roomId, amount}])` (Σ=total ±฿1, feeds SlipOK amount-match). `netRefund` unchanged.
- [x] ✅ **`shared/__tests__/deposit-calc.test.js`** — +14 tests (phase mapping · 2-chunk accrual 500→full · clamp · lumpRef · immutability · lump-split). **`node --test` → 38/38 pass.**
- [x] ✅ **`shared/dashboard-deposits-admin.js`** + **`shared/dashboard-main.js`** — `depositPhase`-driven render: `reserved` (🕒 รอย้ายเข้า) / `forfeited` (⛔ ริบแล้ว) badges + KPI counts + card (คาดย้ายเข้า / ชำระแล้ว·ค้าง); "+ บันทึกมัดจำก่อนย้ายเข้า" create modal (อาคาร/ห้อง/มัดจำ/คาดย้ายเข้า + ก้อนแรก จอง ฿500) + "💵 บันทึกชำระเพิ่ม" on reserved cards, both via `recordDepositPayment` (slip-evidence/cash); **seeding guard** (`_reconcileDepositForRoom` returns early on reserved/forfeited); 3 dispatch cases (§7-JJJ). `node --check` ✅ · §7-TT clean.
- [ ] **`firestore.rules`** — confirm `deposits/` admin-write covers `reserved`/`forfeited` (likely no change); mirror `depositStatus:'reserved'` → `tenants/{b}/list/{r}` on confirmMoveIn (Phase 2) + rules test.
- [ ] **Deferred → Phase 2 (couples with `verifyDepositSlip`):** lump-cash multi-room UI (`splitLumpCash` ready) · SlipOK verify on a deposit slip · `dep-kpi-reserved` tile in `dashboard.html` (setEl wired, element TBD) · tenant-side reserved badge.
- [ ] Visual: owner live-verify on Vercel (auth-gated) OR static-harness screenshot of the reserve modal.

### Phase 2 — confirmMoveIn + forfeit + SlipOK deposit-slip verify (CF · owner-deploy-gated)
- [x] ✅ **`functions/confirmMoveIn.js`** (NEW callable SE1, admin) — `reserved → holding` in ONE `runTransaction` (§7-DD): stamps `receivedAt`=real move-in + `tenantId`; mirrors `moveInDate` onto BOTH the lease doc AND `tenant.lease` (§7-BBB, the bill-boundary field); `appendLog` `moved_in`/`confirmMoveIn` (added to `_occupancyLog` VALID_SOURCES). **ASSUMES tenant+lease exist** (does NOT create them — convertBookingToTenant/admin UI does); reserved-status = idempotency guard. Registered in `index.js` (§7-CCC). **11 tests pass · functions suite 2420/2420 · node --check · mojibake clean.**
- [x] ✅ **`functions/forfeitReservedDeposit.js`** (NEW callable SE1, admin) — `reserved → forfeited` in one `runTransaction`: `forfeitedAmount` = all `paidSoFar` (Q2: no refund) + `forfeitedBy`/`forfeitReason`; immutable `DEPOSIT_FORFEITED` `appendActionAudit` (added to `_actionAudit` VALID_ACTIONS) in the same tx; no tenant/occupancy writes; reserved-status idempotency guard. Registered `index.js`. **9 tests pass · functions suite 2429/2429 · mojibake clean.**
- [ ] **`functions/verifyDepositSlip.js`** (NEW callable SE1, admin) — SlipOK-verify a deposit slip, **single room OR lump multi-room**. Strip dataURL prefix (§7-EEE) · multipart via global FormData+Blob (§7-YY) · hard-validate SlipOK amount = Σ allocations (±1, reuse `splitLumpCash`) · atomic dedup `verifiedSlips/{txid}` `source:'deposit'` + `allocations[]` (ALREADY_EXISTS blocks reuse + double-count vs booking) · per-room `paidSoFar += amount` + `payments[]` (`txid`/`lumpRef`) · store slip once · audit. *Why: anti-fraud on deposit slips incl. lump 1-slip-many-rooms (owner ask 2026-06-13); model on `verifyBookingSlip`.*
- [x] ✅ **`functions/index.js`** — `confirmMoveIn` + `forfeitReservedDeposit` registered column-0 (§7-CCC); `verifyDepositSlip` pending.
- [x] ✅ **Admin UI wiring** (`dashboard-deposits-admin.js` + `dashboard-main.js`) — reserved-card buttons "✓ ยืนยันย้ายเข้า" (date-picker modal → `httpsCallable('confirmMoveIn')`) + "✕ ริบ" (warning modal → `httpsCallable('forfeitReservedDeposit')`); §7-I styled preview + explicit click (no auto-click) + 6 dispatch cases (§7-JJJ). `node --check` ✅ · mojibake ✅. Live-verify owner-gated.

### Phase 3 — Move-in month rent (daily proration + ≤5-day grace + admin override) — ✅ spec locked
- [ ] **`functions/_billWrite.js`** — add `moveInDay(tenantData)` + `isMoveInMonth(tenantData, billCeYM)` + pure `proratedMoveInRent(monthlyRent, moveInDay, billCeYM)` = `round((monthlyRent/30) × daysOccupied)`, `daysOccupied = lastDayOfMonth − moveInDay + 1`, **`daysOccupied ≤ 5 → 0`**. Apply to the move-in month only; utilities/trash = actual; flag `rentProration:{moveInDay, daysOccupied, graced}`; recompute totals. §7-E (4-digit BE int year). *Why: the one new billing rule — MONEY path; gate hard with unit tests + read-only preview before deploy (§7-I/J).*
- [ ] **Admin override** — dashboard move-in-month bill row edits `charges.rent` (default = prorated) → write `rentAdjustment:{reason, by, defaultWas}` + `actionAudit`. *Why: standardise the case-by-case flexibility transparently (owner: "บางเคสขอลด/หักค่าปรับ/หักเต็ม").*
- [ ] **Tests** — day 1 → full; day 15 → rent/30×16; `daysOccupied ≤ 5` → 0; utilities intact; non-move-in month unaffected; future contractStart ignored (§7-BBB); override writes audit.

### Phase 4 — Tenant badge + verify
- [ ] **`tenant_app.html` / shared badge** — "มัดจำรับแล้ว · รอย้ายเข้า" / "ถือมัดจำ ฿X" from the `depositStatus` mirror (§7-A/U `_onLiffClaimsReady` + claim guard, §7-N error cb). *Why: tenant sees their deposit state.*
- [ ] **Docs** — update [lifecycle_deposit_management.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/lifecycle_deposit_management.md) + add **§1.0 ก่อนย้ายเข้า** + **§1.6 เดือนแรก** to [deposit-pet-damage-rules.md](deposit-pet-damage-rules.md); `npm run verify:memory`.
- [ ] **OWNER live-verify (real data, §7-I/J):** record a reserved deposit → confirm move-in → first bill of a start-of-month room shows rent waived → move-out #253 unchanged. Read-only preview before any write.

---

## Anti-patterns honoured
§7-BBB (moveInDate occupancy, **day-aware** — the existing helper is month-only) · §7-DD (activate writes tenant + lease + deposit in one batch) · §7-E (4-digit BE bill year) · §7-I (no auto-click; preview → confirm) · §7-L (additive enum, no destructive migration; existing docs unaffected) · §7-N (badge read error cb) · §7-T (single writer per doc) · §7-CCC (column-0 CF register) · §7-YY (SlipOK multipart = global FormData+Blob) · §7-EEE (strip FileReader dataURL prefix at the CF) · global `verifiedSlips` dedup now USED — 1 `txid` → multi-room `allocations`, blocks reuse + double-count vs booking.

## Out of scope (named, not dropped)
LIFF self-serve booking 2-chunk (D4 admin-first; booking-flow path later) · mid-month proration (D3) · **pet deposit ฿10,000 + pet fee ฿400 + damage routing** (spec §1.2/§1.4/§2.2 — separate #243 track, NOT this) · `refundBill` (different flow — paid-bill correction ≠ move-out refund) · auto-expiry of stale `reserved` deposits.

## Risk
Mostly additive; move-out path untouched (#253 verified). Riskiest = first-month waiver in **live billing** (Phase 3) — gate with unit tests + a read-only preview on a real start-of-month tenant before deploy. The activation batch (§7-DD) needs the documented sibling-write care. The Phase-1 seeding guard must not let the SSoT seed clobber a pre-move-in `reserved` doc.

## Why
Closes the half of the deposit lifecycle the owner actually operates but the system never modelled: money taken **before** a move-in that isn't guaranteed, the 2-chunk reality, and the first-month concession — while reusing the proven held→refund machinery (#253 + `DepositCalc` + `paidSoFar`) instead of rebuilding it.

---

## Review
_(append after build: shipped / deferred / follow-ups)_
