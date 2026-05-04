# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Bill Format Customization — Tenant chooses recipient entity (personal/company)

## Goal (user approved 2026-05-04)
ลูกบ้านเลือก format บิลของตัวเอง: บุคคลธรรมดา (default, brand-friendly) หรือ นิติบุคคล (สำหรับเบิกบริษัท). Bill rendering swaps **logo + recipient block** ตาม `tenant.billRecipient.entityType` — single trigger, no separate switch.

## Architecture
- **Issuer** (Owner Info): admin อัพ 2 logos — `logoDataUrl` (โลโก้บริษัท, B2B) + `apartmentLogoDataUrl` (โลโก้อพาร์ทเม้น, B2C default)
- **Recipient** (per tenant): Firestore `tenants/{building}/list/{roomId}.billRecipient = { entityType, companyName?, taxId?, address? }`
- **Render**: state-driven, no explicit trigger. Bill code อ่าน billRecipient → switch logo + recipient block
- **Snapshot**: skip ใน MVP — render live จาก tenant.billRecipient. v2 ค่อยเพิ่ม snapshot เวลา verifySlip
- **Tax ID**: validate 13-digit + checksum, warning only (ไม่บล็อก save)
- **Header**: "ใบเสร็จรับเงิน / Receipt" ทั้งสอง entityType (issuer ยังไม่ VAT — ออกใบกำกับภาษีไม่ได้)

## Phase 1 — Owner Info (admin uploads dual logo) ✅
- [x] `shared/owner-config.js`: เพิ่ม `apartmentLogoDataUrl: ''` ใน DEFAULT_OWNER_CONFIG
- [x] `shared/dashboard-extra.js`: update label โลโก้บริษัท → "โลโก้บริษัท (ใช้บนบิลนิติบุคคล + รายงานภาษี)"
- [x] `shared/dashboard-extra.js`: เพิ่ม UI block ใหม่ "โลโก้อพาร์ทเม้น (ใช้บนบิลบุคคลธรรมดา — default)" ใต้โลโก้บริษัท
- [x] เพิ่ม `_writeApartmentLogo`, `uploadApartmentLogo`, `removeApartmentLogo` (mirror existing pattern)

## Phase 2 — Tenant Profile (recipient form) ✅ ALREADY EXISTS
**Discovery 2026-05-04:** Feature นี้ถูกสร้างไว้แล้วใน tenant_app.html ตั้งแต่ก่อน — ไม่ต้องสร้างใหม่:
- [x] HTML section "ตั้งค่าการออกใบเสร็จ" — line 3261-3287 (dropdown + company info form + save button + confirm message)
- [x] JS `loadReceiptSettings()` — line 4666 (read from `_taTenant.receiptType` + `_taTenant.companyInfo`)
- [x] JS `saveCompanyInfo()` — line 4689 (Tax ID validate 13 digit, write Firestore via TenantFirebaseSync)
- [x] JS `onReceiptTypeChange()` — line 4743 (handle dropdown switch, persist localStorage + Firestore)
- [x] JS `applyReceiptUI(type, co)` — line 4761 (show/hide company info block)
- [x] JS `window.getReceiptMetaForBill()` — line 4776 (public API for bill rendering — was orphaned!)
- [x] Bill detail block — line 2659 `receipt-company-info-block` shows recipient on tenant_app receipt

**Schema in use:** `tenants/{building}/list/{roomId}.receiptType` ('personal'|'company') + `.companyInfo = { name, taxId, address }`. Firestore rule already allows tenant update (rule line 179 excludes only protected fields, receiptType+companyInfo fine ✓)

## Phase 3 — Bill rendering switch ✅
- [x] `shared/dashboard-bill.js` `buildDocHTML`: lookup `TenantConfigManager.getTenant(d.building, d.room).receiptType` + `companyInfo` → choose logo (apartmentLogo for personal, companyLogo for company) + recipient block at top of doc-content
- [x] `shared/invoice-pdf-generator.js` `generateInvoicePDF`: read `invoiceData.recipient`, switch header emoji+name + add recipient block (จุดอยู่หลัง "Room & Invoice Details")
- [x] `shared/invoice-pdf-generator.js` `generateReceiptPDF`: เหมือนกัน (header swap + recipient block หลัง verification info)
- [x] `shared/dashboard-extra.js` caller: เพิ่ม helper `_resolveBillRecipient(building, roomId)` + enrich invoice ก่อน pass เข้า PDF generator

## Phase 4 — Firestore rules + verification ✅
- [x] Firestore rules: ตรวจแล้ว ไม่ต้องแก้ — `receiptType` + `companyInfo` ไม่ได้อยู่ใน excluded keys
- [x] `npm run verify:memory` → ALL GREEN (212 rows, 0 fails)
- [x] Syntax check 4 modified files (`node -c`) → ALL OK
- [ ] Live test: tenant_app → Profile/Settings → ตั้งนิติบุคคล → save → admin doc preview → ดู logo+recipient ตรงกัน
- [ ] Update lessons.md ถ้ามี gotcha (จะเพิ่มหลัง live test)

## Scope deferred to v2
- **Tenant_app brand header logo swap** — line 2533-2538 (STEP 1) + 2624-2628 (STEP 3) ยังเป็น hardcoded "🌿 The Green Haven". รอดู v1 จริงก่อนค่อยตัดสินใจว่าควร swap ตาม receiptType หรือไม่. recipient-info-block (line 2659) แสดงข้อมูลถูกอยู่แล้ว
- **Snapshot recipient on paid bill** — ตอนนี้ render live จาก tenant.companyInfo. ถ้าลูกบ้านแก้ทีหลัง บิลเก่าโชว์ของใหม่. v2 ค่อย snapshot ใน verifySlip CF

---

# Owner Info — Save bug + Bills respect "อยู่ระหว่างจดทะเบียน" status

## Symptom (user report 2026-05-04)
- Owner Info form ใน people management → set "สถานะการจดทะเบียน = อยู่ระหว่างจดทะเบียน" → กดบันทึก → toast ไม่ขึ้น
- บิล/ใบเสร็จที่ออกให้ลูกบ้านยังขึ้น "บริษัท เดอะ กรีนเฮฟเว่น จำกัด" เต็ม ๆ ไม่บอกว่าอยู่ระหว่างจดทะเบียน

## Root cause
1. **Save broken:** [shared/dashboard-extra.js:1517-1519](shared/dashboard-extra.js:1517) อ่านจาก 3 element ที่ `renderOwnerInfoPage()` ไม่ได้ render — `getElementById` คืน null → `.value` โยน TypeError → save อบอร์ตเงียบ
2. **Bill ignores status:** [invoice-pdf-generator.js:25,196](shared/invoice-pdf-generator.js:25) + [dashboard-bill.js:954](shared/dashboard-bill.js:954) ดึง `companyLegalNameTH` ตรง ๆ ไม่เช็ค `registrationStatus` (ต่างจาก [tax-filing.html:1401](tax-filing.html:1401) ที่เช็คแล้ว)

## Plan (user approved option ก — append " (อยู่ระหว่างจดทะเบียน)")
- [x] Fix save: ใช้ optional chaining ใน 3 บรรทัด (pattern เดียวกับ company identity ด้านบน)
- [x] Append suffix when `registrationStatus === 'pending'` ที่ 3 ฝั่ง:
  - [x] `shared/invoice-pdf-generator.js:25` (invoice PDF header)
  - [x] `shared/invoice-pdf-generator.js:196` (receipt PDF header)
  - [x] `shared/dashboard-bill.js:954` (admin doc preview / PNG export)
- [x] **Leave alone:** `dashboard-bill.js:638` (admin PromptPay payee reference) — financial transfer destination, suffix ไม่เหมาะ

## Review (2026-05-04)
**Shipped:** 4 mechanical edits across 3 files. `npm run verify:memory` ALL GREEN (212 rows, 0 fails). No Tailwind/build needed.

**What changed:**
- `shared/dashboard-extra.js:1517-1519` — defensive optional chaining (3 บรรทัด) → save function ทนต่อ DOM ที่ไม่ render แล้ว
- `shared/invoice-pdf-generator.js:25, 196` — invoice + receipt PDF header เช็ค registrationStatus
- `shared/dashboard-bill.js:954` — admin doc preview (logo subtitle) ที่ใช้ html2canvas → PNG export ก็ติด suffix ด้วย

**Live verification (after `git push origin main`):**
1. https://the-green-haven.vercel.app/dashboard.html → People Management → Owner Info
2. Set "สถานะการจดทะเบียน = ⏳ อยู่ระหว่างจดทะเบียน" → กด 💾 บันทึกข้อมูล
3. ✅ Toast "บันทึกข้อมูลเจ้าของสำเร็จ" ขึ้น
4. F12 → `localStorage.getItem('owner_info')` → JSON parse → `registrationStatus: 'pending'` ติด
5. Bills tab → preview ใบเสร็จ/ใบวางบิล → header แสดง "บริษัท เดอะ กรีนเฮฟเว่น จำกัด (อยู่ระหว่างจดทะเบียน)"
6. Export PNG → ตรวจว่า suffix ติดด้วย
7. หลังจดเสร็จ: เปลี่ยน status เป็น "✅ จดทะเบียนแล้ว" → suffix หายอัตโนมัติ

**Follow-up (none required):** PromptPay payee แสดง (`pp-display-payee` ใน admin) ไม่ได้แตะ — เป็น financial transfer reference, suffix ไม่เหมาะ

## Why option ก
Consistent with tax-filing.html pattern (ใช้แล้ว) → ลูกบ้านเห็นชัดว่ายังจดทะเบียนไม่เสร็จ → โปร่งใส, ตรงกับเอกสารภาษีที่ admin ใช้

## Verification
- Build: ไม่มีการเปลี่ยน Tailwind class → ไม่ต้อง `npm run tailwind:build`
- Memory: ไม่กระทบ load-bearing claims → ไม่ต้อง `npm run verify:memory`
- Live: push → vercel → admin หน้า Owner Info → set pending → save → ดู toast → ตรวจ localStorage `owner_info` → render บิลใหม่ใน Bills tab

---

# LIFF Booking Site — Real-time Availability + Auto-Verified Deposit + Bookings SoT

## Goal

ระบบจองห้องผ่าน LINE LIFF ที่ end-to-end เริ่มจากเลือกห้องบนปฏิทิน → ล็อคห้อง → จ่ายมัดจำผ่าน PromptPay QR → auto-verify slip → ออกใบรับเงินชั่วคราว → (ภายหลัง) แปลงเป็นสัญญา/Tenant จริง

3 เสาหลักจาก brief:
1. **Real-time Availability (Calendar View)** — สถานะสีเทาอัตโนมัติ + filter ประเภท/ชั้น + lock 15-30 นาที กัน race condition
2. **Payment Integration** — Instant invoice + PromptPay QR + auto-verify slip → "Booked" state ไม่ต้องรอแอดมิน
3. **Database Structure** — Bookings collection แยกจาก Contracts; flow โอนข้อมูลเมื่อทำสัญญาจริง

ของเสริม (Phase 5+, ทำหลัง MVP เสร็จ): Pre-Check-in KYC, Gamification Early Bird

---

## ⚠️ Design decisions — ขอ confirm ก่อนลงโค้ด

ทุกข้อมี **default ที่แนะนำ** + **เหตุผล**. ตอบ "OK" / "เปลี่ยนเป็น X" ก่อนเริ่ม Phase 1

| # | Decision | Recommended default | Why |
|---|----------|---------------------|-----|
| 1 | LIFF channel ID | **ใช้ตัวเดิม `2009790149-Db7T76sd` + route-based start URL** (`https://the-green-haven.vercel.app/booking.html`) | ประหยัดต้นทุน LINE channel, ไม่ต้องตั้งค่า LIFF ใหม่; การแยก endpoint URL พอแล้ว |
| 2 | New page or section in tenant_app.html | **Standalone `booking.html`** (วาง `/booking.html`) | tenant_app.html ใหญ่มาก (25 pages), prospects ไม่ควรเห็น tenant flows; แยกชัด, bundle เบา |
| 3 | Auth strategy สำหรับ prospect | **New CF `liffBookingSignIn`** mint custom token with `claims: { role: 'prospect', lineUserId }` (ไม่มี room/building) | กันใช้ anonymous (เพิ่ม security risk + memory rule §⛔ NEVER tighten rules); ใช้ pattern เดียวกับ liffSignIn.js |
| 4 | Source of "available" rooms | **`shared/room-config.js` ลบด้วย active rooms ใน `tenants/{b}/list/*` ลบด้วย active bookings** | ไม่ต้อง schema migration, room-config มีอยู่แล้ว, ทุก source ตรงกับโค้ดเดิม |
| 5 | Lock duration | **20 นาที** (กึ่งกลาง 15-30) | นานพอเปิด LINE Pay app, สั้นพอไม่ block ห้องนาน |
| 6 | Deposit amount source | **`room-config.deposit` ถ้ามี (Nest); Rooms ใช้ค่า default 1 เดือนเช่า**; admin override ได้ใน booking doc | room-config.js มีอยู่แล้ว, ลด UX ตั้งค่าซ้ำ |
| 7 | PromptPay receiver | **`OwnerConfigManager.getOwnerInfo().phone`** (เจ้าของบัญชีคนเดิมกับบิลรายเดือน) | source of truth เดียว, ไม่มี config เพิ่ม |
| 8 | verifySlip reuse | **New CF `verifyBookingSlip`** (clone โครง verifySlip.js) | verifySlip ปัจจุบัน hard-code path bills/* + Nest gamification; clone สะอาดกว่าใส่ branch |
| 9 | Pre-Check-in KYC | **หลังจ่ายเงินยืนยันแล้ว, optional** (ลูกบ้านอัปได้, แต่ admin อนุมัติ KYC แยก) | กันการล้มเลิกระหว่างกรอกฟอร์ม, prospect ใส่เอกสารที ผ่อนคลายกว่า |
| 10 | Early Bird threshold | **จองล่วงหน้า ≥ 30 วันก่อน move-in → 500 pts**, เก็บใน booking doc, transfer ไปยัง gamification เมื่อ contract สร้าง | brief เสนอ 500, สอดคล้องกับ gamification economy (10pts=1฿) → 50บ ส่วนลด, ไม่ over |
| 11 | Admin UI location | **เพิ่ม Booking sub-tab ใน dashboard.html → Tenant section** | dashboard เป็น admin SPA หลัก, เปิดแล้ว, อยู่ใกล้ Contract management |
| 12 | Booking → Contract conversion | **Manual: admin กดปุ่ม "Convert to Tenant"** ใน Booking sub-tab → mint `tenants/{b}/list/{roomId}` doc + ลิงก์ tenantId | ปลอดภัยกว่า auto, admin ต้องดู KYC ก่อน |
| 13 | Existing vs new tenant | **เก็บ `lineUserId` บน booking; เมื่อ admin convert, ค้นใน tenants/* ว่าเคยมี linkedAuthUid ตรงกับ `line:{userId}` ไหม** → ถ้ามีใช้ tenantId เดิม, ไม่งั้นสร้างใหม่ | ใช้ pattern linkedAuthUid ที่มีอยู่ |
| 14 | Cancellation policy | **ก่อนชำระ → ยกเลิกฟรี (auto-expire 20 นาที); หลังชำระ → admin manual refund** | กันโค้ดยุ่งกับ refund automation; brief ไม่ระบุ |

---

## Phase 0 — Pre-flight grep verification (do this myself before coding)

ก่อนตอบ Decision questions ข้างบน user อยากให้เช็คก่อน — เลยไม่ใช่ user task

- [ ] Verify `OwnerConfigManager.getOwnerInfo()` schema (มี `.phone` ไหม) — `shared/owner-config.js`
- [ ] Verify `tenants/{building}/list/{roomId}.linkedAuthUid` field มีจริง + format `line:{lineUserId}` — `lifecycle_auth_liff_sot.md` กับ `firestore_schema_canonical.md`
- [ ] Confirm `room-config.js` ครบทุกห้อง + มี deposit เฉพาะ Nest (ตามที่ inventory บอก)
- [ ] เช็คว่า dashboard.html "Tenant section" มี sub-tab structure ไหม → หา insertion point
- [ ] Confirm gamification rules engine รับ event `booking_early_bird` ได้ (หรือต้องเพิ่ม rule)

**Why:** memory rule "Verify-via-grep doctrine" — ทุก claim ต้องมี grep proof ก่อนใช้ในโค้ด

---

## Phase 1 — Bookings Schema + Firestore Rules + CF skeleton

### Files
- `firestore.rules` — เพิ่ม `bookings/{bookingId}` rule block
- `firestore.rules.test.js` — เพิ่ม test cases
- `functions/index.js` — export new CFs
- `functions/liffBookingSignIn.js` — NEW (clone liffSignIn pattern, no room claim)
- `functions/createBookingLock.js` — NEW (HTTPS callable; transaction-based lock)
- `functions/expireBookingLocks.js` — NEW (scheduled CF, every 5 min, mark expired)

### Bookings collection schema (top-level, NOT under tenants/)

```
bookings/{bookingId}
  prospectUid: string         // line:lineUserId (from custom claim)
  prospectLineId: string      // for admin reference
  prospectName: string        // from liff.getProfile()
  prospectPhone: string       // user-entered
  building: 'rooms' | 'nest'
  roomId: string              // matches room-config.js id
  startDate: timestamp        // move-in date
  durationMonths: number      // 6 | 12 | etc.
  monthlyRent: number         // copied from room-config at lock time
  depositAmount: number       // copied from room-config OR 1 month rent
  earlyBirdEligible: boolean  // computed: (startDate - createdAt) >= 30 days
  earlyBirdPoints: number     // 0 or 500
  status: 'locked' | 'paid' | 'kyc_pending' | 'kyc_approved' | 'converted' | 'cancelled' | 'expired'
  lockedUntil: timestamp      // status=locked → +20min from createdAt
  promptPayPayload: string    // generated server-side
  qrAmount: number            // = depositAmount
  slipVerifiedAt: timestamp?
  slipTransactionRef: string?
  slipImagePath: string?      // Storage path
  kycDocsPath: string?        // Storage path prefix
  contractId: string?         // filled on convert
  tenantId: string?           // filled on convert (linked or new)
  createdAt: serverTimestamp
  updatedAt: serverTimestamp
```

### Rules

```javascript
// bookings/{bookingId}
match /bookings/{bookingId} {
  // Prospect can read own; admin can read all
  allow read: if isAdmin() ||
              (isSignedIn() && resource.data.prospectUid == request.auth.uid);
  // CF-only writes (createBookingLock + verifyBookingSlip + scheduled expire + admin convert)
  allow write: if isAdmin();
}
```

**Why CF-only write:** สำคัญสำหรับ race-condition prevention (lock ต้องเป็น atomic Firestore transaction). ถ้าเปิด client write จะมีคนสร้าง lock ซ้อน

### `liffBookingSignIn` CF — pattern

- Region SE1, `https.onRequest`
- Body: `{ idToken }` (LIFF ID token จาก `liff.getAccessToken()` หรือ `liff.getIDToken()`)
- Verify ผ่าน LINE `/verify` endpoint (เหมือน liffSignIn.js:32+)
- Mint custom token: `admin.auth().createCustomToken('line:'+lineUserId, { role: 'prospect', lineUserId })`
- Return `{ customToken }` → client ใช้ `signInWithCustomToken`

### `createBookingLock` CF — atomic lock

- `https.onCall`, must have `auth.token.role === 'prospect'`
- Body: `{ building, roomId, startDate, durationMonths, prospectName, prospectPhone }`
- **Transaction:**
  1. Read all bookings WHERE `building == X AND roomId == Y AND status IN ('locked','paid','kyc_pending','kyc_approved') AND lockedUntil > now`
  2. ถ้าเจอ → throw `failed-precondition: room-already-locked`
  3. Read `tenants/{building}/list/{roomId}` — ถ้ามี active tenant + endDate > startDate → throw `failed-precondition: room-occupied`
  4. Compute `depositAmount` (room-config.deposit OR monthlyRent * 1)
  5. Generate PromptPay payload server-side (port `buildPromptPayPayload` จาก tenant_app.html:9533 → `functions/promptpay.js`)
  6. `transaction.create(bookings/{auto})` with status='locked', lockedUntil=now+20min
- Return `{ bookingId, qrPayload, qrAmount, lockedUntil }`

### `expireBookingLocks` CF — scheduled

- `pubsub.schedule('every 5 minutes')`, region SE1, BKK timezone
- Query `bookings WHERE status='locked' AND lockedUntil < now`
- Batch update status='expired' (max 500/run)

### Tasks
- [ ] Phase 0 grep checks complete
- [ ] Add `bookings/*` rule block + test
- [ ] Implement `liffBookingSignIn` CF + unit smoke test
- [ ] Implement `createBookingLock` CF (transaction-based)
- [ ] Implement `expireBookingLocks` CF
- [ ] Extract `buildPromptPayPayload` to `functions/promptpay.js` (server-side mirror)
- [ ] Wire all into `functions/index.js`
- [ ] `npm run test:rules` ผ่าน
- [ ] Deploy: `firebase deploy --only functions:liffBookingSignIn,functions:createBookingLock,functions:expireBookingLocks,firestore:rules`
- [ ] Manual test: lock → wait 20min → confirm auto-expire

**Verification (memory doctrine):** end of phase, write `lifecycle_booking_flow.md` with `## Verification` section grep-backing every claim (collection path, rule line, CF region, lock duration, etc.)

---

## Phase 2 — Slip Verify CF + KYC Storage rules

### Files
- `functions/verifyBookingSlip.js` — NEW (clone verifySlip.js, write to bookings/*)
- `storage.rules` — add `/bookings/{bookingId}/slips/*` + `/bookings/{bookingId}/kyc/*` paths

### `verifyBookingSlip` CF
- Clone `functions/verifySlip.js` minus tenant-specific gamification + bills RTDB write
- Input: `{ bookingId, file (base64), expectedAmount }` + auth.uid must match booking.prospectUid
- Validates: file size, dimension, SlipOK API call, amount match (hard reject if mismatch), atomic dedup via `verifiedSlips/{transRef}.create()` (gRPC-6 pattern from existing CF)
- On success:
  - Upload slip image to Storage `bookings/{bookingId}/slips/{transRef}.jpg`
  - Update `bookings/{bookingId}` → status='paid', slipVerifiedAt, slipTransactionRef, slipImagePath
- Return `{ success, status: 'paid' }` หรือ `{ retryable: true, code: 'scb_delay' }` (เหมือน verifySlip)
- Rate limit: 50/day per `prospectUid` (port logic จาก verifySlip)

### Storage rules
```
match /bookings/{bookingId}/slips/{file} {
  allow read: if isAdmin() ||
              (isSignedIn() && firestore.exists(/databases/(default)/documents/bookings/$(bookingId)) &&
               firestore.get(/databases/(default)/documents/bookings/$(bookingId)).data.prospectUid == request.auth.uid);
  allow write: if false;  // CF-only
}
match /bookings/{bookingId}/kyc/{file} {
  allow read: if isAdmin() || /* same prospectUid check */ ;
  allow write: if isSignedIn() && /* same check */ &&
               request.resource.size < 5 * 1024 * 1024 &&
               request.resource.contentType.matches('image/.*');
}
```

### Tasks
- [ ] Implement `verifyBookingSlip` CF
- [ ] Add storage rules + test (smoke)
- [ ] Deploy: `firebase deploy --only functions:verifyBookingSlip,storage`
- [ ] Manual test: lock → upload real slip → status flips to paid

---

## Phase 3 — `booking.html` LIFF page (MVP UI)

### File: `booking.html` (new, ~600 lines target)

Sections (single-page, stepwise reveal):

1. **Loading / LIFF init** — `liff.init` → `liff.isLoggedIn()` → `liffBookingSignIn` CF → `signInWithCustomToken`
2. **Calendar / Room Picker** (main view)
   - Building tabs: Rooms / Nest (uses room-config.js)
   - Filter row: Floor (Nest only), Type (studio/pet-allowed for Nest), Max Rent slider
   - Month navigation (←/→ + month label)
   - Grid: รายชื่อห้องในแถวซ้าย, วันในเดือนเป็นคอลัมน์ → ช่องสีเขียว=ว่าง, เทา=มีคนอยู่/จองแล้ว, เหลือง=ของฉันที่ล็อคไว้
   - Click ช่อง → modal step 3
3. **Booking detail modal**
   - Show: ห้อง, วัน move-in, ระยะสัญญา (dropdown: 6/12/24 เดือน), monthly rent, deposit
   - Form: ชื่อ-นามสกุล, เบอร์โทร (10 หลัก validation)
   - "Lock & Pay" button → call `createBookingLock` CF → show step 4
4. **Payment step**
   - QR code render (qrcodejs จาก CDN — เหมือน tenant_app.html:9269)
   - Amount + countdown timer (20 min)
   - Slip upload (file input → base64) → `verifyBookingSlip` CF
   - Polling/listener: `onSnapshot(bookings/{id})` → status='paid' → step 5
5. **Confirmation step** — ใบรับเงินชั่วคราว, "อัปโหลด KYC ตอนนี้" button (Phase 5)

### Data fetching strategy

- Cache room-config.js (already client-bundled)
- onSnapshot ของ `bookings WHERE building == X AND status IN ('locked','paid','kyc_pending','kyc_approved') AND lockedUntil > now` → ใช้คำนวณช่องเทา
- onSnapshot ของ `tenants/{b}/list/*` ดูช่อง active tenant
- Avoid loading 1000s of docs — limit query to current month +/- 3 months

### Tailwind classes
- ใช้ tailwind v3 ตามเดิม (per CLAUDE.md), build ผ่าน `npm run tailwind:build`
- ใช้ `shared/brand.css` tokens (Muji minimal — `var(--color-text)`, etc.)

### Service Worker
- Add `booking.html` to SW cache list (auto via `VERCEL_GIT_COMMIT_SHA`)

### Tasks
- [ ] Build `booking.html` skeleton + LIFF init + auth wiring
- [ ] Build calendar grid component (vanilla)
- [ ] Build filter row
- [ ] Build booking modal + form validation
- [ ] Build payment step + QR render + slip upload
- [ ] Build confirmation step
- [ ] Add to SW cache
- [ ] Run `npm run tailwind:build`
- [ ] Push → verify on Vercel (NOT localhost — per ⛔ rule)
- [ ] Test E2E with real LINE account: book → pay → confirm

---

## Phase 4 — Admin Booking sub-tab in dashboard.html

### Files
- `dashboard.html` — add "Booking" sub-tab inside Tenant section
- `shared/dashboard-bookings.js` — NEW (~300 lines, follow dashboard-extra.js pattern)
- `functions/convertBookingToTenant.js` — NEW (HTTPS callable, admin only)

### `convertBookingToTenant` CF
- `auth.token.role === 'admin'` (custom claim)
- Body: `{ bookingId }`
- Transaction:
  1. Read booking → must status='kyc_approved' (or status='paid' if KYC skipped)
  2. Lookup existing tenant by `linkedAuthUid == 'line:'+booking.prospectLineId` in `tenants/{building}/list/*` → tenantId เดิม OR mint new
  3. Create `tenants/{building}/list/{roomId}` doc with: tenantId, contractStart=startDate, contractMonths, monthlyRent, deposit (paid), linkedAuthUid
  4. Update booking → status='converted', contractId, tenantId
  5. Award `earlyBirdPoints` to gamification (+500 if eligible)

### Admin UI
- Table: pending bookings (status IN ['paid','kyc_pending','kyc_approved'])
- Per-row: view details, view slip image, view KYC docs, Approve KYC button, Convert button
- Filter by status, date range
- Search by phone/name

### Tasks
- [ ] Implement `convertBookingToTenant` CF
- [ ] Build dashboard sub-tab UI
- [ ] Build `dashboard-bookings.js` module
- [ ] Add to dashboard.html script load order
- [ ] Manual test: admin → approve KYC → convert → verify tenant doc created + gamification points awarded

---

## Phase 5 — Pre-Check-in KYC (after MVP)

- KYC upload UI inside booking.html confirmation step
- Doc types: ID card (front+back), house registration (optional), employment letter (optional)
- Storage path: `bookings/{bookingId}/kyc/{type}_{timestamp}.jpg`
- After upload: status='kyc_pending' → admin reviews → status='kyc_approved'

---

## Phase 6 — Gamification Early Bird (after MVP)

- เก็บ `earlyBirdPoints` ใน booking doc แล้ว (Phase 1)
- Award trigger: ใน `convertBookingToTenant` CF — ถ้า earlyBirdEligible → award via gamification rules engine (`shared/gamification-rules.js`) event `booking_early_bird`
- ต้องเพิ่ม rule ใน rules engine: 500 pts, max 1/booking
- Verify หลัง launch ใน `gamification_ssot.md`

---

## Out of scope (explicit — do NOT do)

- ❌ Auto-cancellation refund flow (manual admin process, brief ไม่ระบุ)
- ❌ Multi-room booking ในครั้งเดียว (1 booking = 1 room)
- ❌ Walk-in booking (LIFF only, dashboard admin manual createBookingLock เป็น escape hatch)
- ❌ External payment gateway (PromptPay only, ตรงกับสิ่งที่มีอยู่)
- ❌ Internationalization (Thai only)
- ❌ React/Vue/TS — stays vanilla JS per CLAUDE.md tech-stack guardrail

---

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Race condition: 2 prospects lock พร้อมกัน | Firestore transaction in `createBookingLock` CF (atomic check-then-create) |
| LIFF ID token expiry mid-booking | Refresh token before each CF call; show retry UI |
| Slip auto-verify false positive (mismatch amount) | verifyBookingSlip hard-rejects mismatch (port from verifySlip pattern) |
| Lock blocks ห้องนาน + lock CF crash | `expireBookingLocks` scheduled every 5 min as safety net + Firestore TTL ทบ |
| New CF region ผิด (SE3 ผิด, ต้อง SE1) | All booking CFs `region('asia-southeast1')` เหมือนของเดิม |
| `booking.html` bundle ใหญ่เกิน 150kb | Lazy-load qrcodejs (CDN, current pattern); no extra libs |
| Existing tenant double-booked เป็น prospect | `convertBookingToTenant` CF tries lookup linkedAuthUid first → reuses tenantId |

---

## Memory updates after ship

- New lifecycle doc: `lifecycle_booking_flow.md` with full `## Verification` section
- Update `MEMORY.md` index — add to "🏛️ System Lifecycles → Tenant-facing"
- Update `tasks/lessons.md` after every correction during dev
- Update `firestore_schema_canonical.md` — new `bookings/*` collection
- Update CSP if booking.html needs new domains (LINE Pay maybe — check during Phase 3)

---

## Phasing recommendation

**Sprint 1 (MVP, ~3-5 sessions):** Phases 0-3 → standalone booking site live, no admin UI yet (admin uses Firestore console temporarily)

**Sprint 2 (~1-2 sessions):** Phase 4 → admin UI, conversion flow

**Sprint 3 (optional):** Phases 5+6 → KYC + gamification

**Recommend ship Sprint 1 first**, validate with 1-2 real prospects, then Sprint 2.

---

## Review — Phase 1 shipped 2026-05-04

### Files added (5 new CFs)
- [functions/promptpay.js](functions/promptpay.js) — server-side mirror of `tenant_app.html:9533` `buildPromptPayPayload`. Same EMV tags + CRC16-CCITT polynomial as client. With input validation.
- [functions/liffBookingSignIn.js](functions/liffBookingSignIn.js) — exchanges LIFF ID token for Firebase custom token. UID prefix `book:` + claim `role:'prospect'`. **Why separate from `liffSignIn`:** prospects don't have a `liffUsers/{lineUserId}` doc; tenants do. Different namespace prevents claim collision when same LINE account uses both apps.
- [functions/createBookingLock.js](functions/createBookingLock.js) — HTTPS callable, atomic Firestore transaction. Reads room rate from `rooms_config/{building}/{roomId}` (RTDB), receiver phone from `owner_info/main` (Firestore). Locks for 20 minutes. Computes Early Bird eligibility (≥30 days = 500 pts).
- [functions/getRoomAvailability.js](functions/getRoomAvailability.js) — HTTPS callable, returns `{occupied: [roomIds], activeBookings: [{roomId,status,lockedUntil}]}` for the calendar UI. **Why this CF exists:** prospects can't read `tenants/{b}/list/*` directly (rules block cross-room PII reads). Admin SDK aggregates server-side, returning only non-PII fields.
- [functions/expireBookingLocks.js](functions/expireBookingLocks.js) — scheduled every 5 minutes, BKK timezone. Flips abandoned `status='locked'` rows to `status='expired'`. Worst-case lock duration ~25min (20 lock + 5 sweep gap).

### Files modified (3)
- [firestore.rules](firestore.rules) — added `bookings/{bookingId}` block. CF-only writes (admin SDK bypasses); read = own + admin.
- [firestore.rules.test.js](firestore.rules.test.js) — added `PROSPECT()` auth helper + 12-test booking suite. **All 12 pass.**
- [functions/index.js](functions/index.js) — wired 4 new CFs (one is a pure helper).

### Test results
- `firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'`
- **97/98 pass** — the 1 failure (`anon tenant can create claim doc` in wellnessClaimed suite) is **pre-existing** (rule requires parent tenant doc with `linkedAuthUid` to exist, test seeds the claim without seeding the parent). NOT touched by this work. Flagged for follow-up.
- All 5 CF files pass `node --check`.

### Deferred (to next sessions, by design)
- **Deploy** — held until user OK. Command:
  ```
  firebase deploy --only functions:liffBookingSignIn,functions:createBookingLock,functions:getRoomAvailability,functions:expireBookingLocks,firestore:rules
  ```
- **Memory doc** — `lifecycle_booking_flow.md` with `## Verification` section (per CLAUDE.md verify-via-grep doctrine). Will write at end of Sprint 1 (or after Phase 2 ships) so it can describe the full lock → pay → verify flow at once.
- **Phase 2** — `verifyBookingSlip` CF + Storage rules for slip/KYC paths.
- **Phase 3** — `booking.html` LIFF page (the part that's actually browser-observable).

### Verification commands for next session
```bash
# Rules tests still green:
export JAVA_HOME="/c/Users/usEr/jdk21/jdk-21.0.5+11-jre" && export PATH="$JAVA_HOME/bin:$PATH"
firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'

# All booking CFs syntax-clean:
for f in functions/promptpay.js functions/liffBookingSignIn.js functions/createBookingLock.js functions/getRoomAvailability.js functions/expireBookingLocks.js; do node --check "$f" && echo "✓ $f"; done
```

### Lessons for `tasks/lessons.md` (none yet)
No corrections from user, no production bugs hit. Phase 1 went per plan.

### Notes / drift from original plan
- Added a 5th CF (`getRoomAvailability`) that wasn't in the original plan — discovered during rule design that prospects can't read `tenants/*` directly (PII gate). This CF is the privacy-safe aggregator. Documented in plan above.
- Lock duration confirmed at 20 minutes (decision #5 from "Design decisions" table).
- UID prefix `book:` (not `line:`) confirmed prevents claim collision with tenant flow.

---

## Review — Phase 2 shipped 2026-05-04

### Files added (1 new CF)
- [functions/verifyBookingSlip.js](functions/verifyBookingSlip.js) — SlipOK-backed deposit verification. **Clones** the SlipOK API call + atomic dedup pattern from `verifySlip.js` but:
  - Uses `https.onCall` (auth via `context.auth`) instead of `onRequest+requireAdmin` — matches `createBookingLock` pattern
  - Drops bill-marking RTDB write (booking is not a bill)
  - Drops Nest gamification + `paymentHistory` writes (those are tenant-flow concerns)
  - Adds Storage upload at `bookings/{bookingId}/slips/{txid}.jpg` (verifySlip skips this; bookings need image trail for admin disputes)
  - Reuses `verifiedSlips/{txid}.create()` atomic dedup (gRPC code 6) — same SlipOK quota, same race fence
  - Per-prospect rate limit (10/day) via separate `rateLimits/booking_{uid}_{window}` keyspace — no collision with tenant rate limits

### Files modified (2)
- [storage.rules](storage.rules) — added `bookings/{bookingId}/slips/*` (read-only for admin/owner; CF-only writes) and `bookings/{bookingId}/kyc/*` (admin OR owner with status=='paid'|'kyc_pending', 5MB cap, image+PDF only). 31 lines added.
- [functions/index.js](functions/index.js) — wired `verifyBookingSlip` export.

### Verification
- `node --check functions/verifyBookingSlip.js` ✓
- `git diff --stat` confirms scope: 53 lines across 2 modified files + 1 new CF (no unintended changes)
- Rule tests still green from Phase 1 (no firestore.rules changes in Phase 2)
- **Storage rule tests skipped** — project has no Storage emulator test infra; existing storage rules also untested. Real validation will happen at deploy + browser flow in Phase 3.

### Behavioral choices to flag
- **Hard reject on amount mismatch** — same as `verifySlip` (data poisoning prevention). A ฿1 slip against ฿3000 deposit fails fast.
- **SCB delay returns retryable shape** — `{ success: false, retryable: true, code: 'scb_delay', retryAfterSec: 120 }`. Client should wait 2 min and retry, not show error. Same shape as `verifySlip`.
- **Atomic `verifiedSlips/{txid}.create()` shared with rent flow** — a slip already used to pay rent CANNOT be re-submitted as a booking deposit, and vice versa. Cross-flow replay is blocked by Firestore doc-id uniqueness.
- **Storage upload is non-fatal** — if Storage upload fails, the booking still flips to `paid` (slip is verified by SlipOK + recorded in `verifiedSlips`). Logged for admin to recover. Phase 4 admin UI can re-fetch image from `verifiedSlips` collection if needed.
- **Bookings status update post-slip is logged loudly on failure** — slip is verified but booking didn't flip. Admin must intervene. Acceptable: this is rare (Firestore single-doc update is reliable).

### Sprint 1 backend complete

Phase 1 + Phase 2 ship together:
- 6 new CFs total: `liffBookingSignIn`, `createBookingLock`, `getRoomAvailability`, `expireBookingLocks`, `verifyBookingSlip`, plus `promptpay.js` helper
- 1 new Firestore rule block (`bookings/*`)
- 2 new Storage rule blocks (`bookings/{}/slips/*`, `bookings/{}/kyc/*`)
- 12 rule tests pass (97/98 total — 1 pre-existing wellnessClaimed failure unrelated)

**Deploy command** (when user OKs):
```bash
firebase deploy --only \
  functions:liffBookingSignIn,\
functions:createBookingLock,\
functions:getRoomAvailability,\
functions:expireBookingLocks,\
functions:verifyBookingSlip,\
firestore:rules,\
storage
```

Pre-deploy checklist:
- [ ] `SLIPOK_API_KEY` secret set (already exists from rent flow — no action)
- [ ] `SLIPOK_API_URL` defineString set in `functions/.env` (already exists — no action)
- [ ] `owner_info/main.phone` populated in Firestore (admin must set via dashboard before first booking)
- [ ] `rooms_config/{building}/{roomId}` populated in RTDB (already auto-synced from `room-config.js`)

**Phase 3 next** — `booking.html` LIFF page (preview-verifiable) + admin will be able to test end-to-end.

---

## Review — Phase 3 shipped 2026-05-04

### Files added (1)
- [booking.html](booking.html) — standalone LIFF page (~1,400 lines). Single-file SPA, 4 stepwise sections (calendar/picker, booking modal, payment, confirmation). Vanilla JS + Tailwind v3 + brand.css tokens. Muji minimal aesthetic, IBM Plex Sans Thai Looped, mobile-first. No React/Vue/TS per CLAUDE.md tech-stack guardrail.

### Files modified (4)
- [service-worker.js](service-worker.js) — added `/booking.html` to PRECACHE_URLS so the LIFF page works offline (LINE webview offline state).
- [vercel.json](vercel.json) — added `booking` to the no-cache HTML route regex (deploys publish without 1-hour CDN delay).
- [tools/compute-csp-hashes.js](tools/compute-csp-hashes.js) — added `booking.html` to the FILES list. **Hashes regenerated:** `npm run csp:hash` ran clean (booking.html: 4 scripts + 1 style hashed). Total now 25 script + 9 style hashes (was 21+8).
- [shared/tailwind.css](shared/tailwind.css) — `npm run tailwind:build` ran clean, output committed.

### What's in booking.html
- **Boot overlay** — LIFF init + Firebase init + `liffBookingSignIn` CF + `signInWithCustomToken` with 3-attempt retry on network errors (LIFF webview quirk pattern from `tenant_app.html`).
- **Building tabs** — Rooms / Nest with live "X ห้องว่าง" counts.
- **Filters** — floor (Nest only), type (studio / pet-allowed), max rent (5 brackets).
- **Date strip** — 60-day horizontal scroll, defaults to "Early Bird threshold" (today + 30) so prospects naturally hit the bonus.
- **Rooms list** — cards with status pills (ว่าง / มีคนอยู่ / ล็อคไว้ / จองแล้ว). Available cards click → modal.
- **Booking modal** — duration (3/6/12/24), name, phone (10-digit Thai validation), early-bird hint (≥30 days). "Lock & Pay" calls `createBookingLock` CF → returns `qrPayload`.
- **Payment step** — PromptPay QR via qrcodejs (CDN), 20-minute countdown timer with warning/danger color shifts at 5min/1min, slip upload (drag-drop / tap to pick), AVIF/HEIC → JPEG canvas conversion, `verifyBookingSlip` CF call with friendly error mapping (amount mismatch, duplicate slip, lock expired, rate-limited).
- **Confirmation step** — auto-revealed via Firestore `onSnapshot` on the booking doc (status=='paid'). Shows booking ID, room, deposit amount, transaction ref, optional Early Bird +500 hint.
- **Cancel button** — closes the booking flow without server-side write; `expireBookingLocks` scheduled CF cleans up after lock TTL.

### Browser preview verification
- Server: `python -m http.server 8000` via `.claude/launch.json` config "green-haven-test"
- LIFF init **legitimately fails on localhost** (LINE security — endpoint URL must be `https://the-green-haven.vercel.app/...`) → user lands on the boot-overlay error state with "ลองอีกครั้ง" button. Verified: button now properly sized (was stretched to fill flex column before fix).
- `/api/config` 404s on python server (Vercel serverless function only) — logged as expected error in console; doesn't block static layout.
- Manually seeded sample DOM via `preview_eval` to verify: building tabs render with "X ห้องว่าง" counts, filter dropdowns work, date strip horizontal-scrolls with active state on selected day, rooms list renders 4 sample cards (available/occupied/locked/paid) with correct status pills + grayscale on unavailable. Layout is clean Muji minimal.
- 2 bugs fixed during preview verification: (a) retry button stretch in boot overlay (added `flex: 0 0 auto` inline override), (b) duplicate click listener on available cards (was adding listener both before and after `card.innerHTML = ...`).

### What can NOT be verified outside of LINE LIFF
- Full LIFF init success (requires LINE webview)
- `liffBookingSignIn` CF call (requires real LIFF ID token)
- `createBookingLock` / `verifyBookingSlip` CF calls (require Firebase auth from LIFF sign-in)
- onSnapshot booking subscription (requires Firestore + auth)
- Real PromptPay QR scan + slip upload + auto-verify

End-to-end testing requires deploy to Vercel + open the LIFF URL in LINE app on a real device.

### Sprint 1 fully complete

**6 new Cloud Functions + 1 new HTML page + 5 config edits:**

| File | Status |
|---|---|
| `functions/promptpay.js` | ✅ NEW |
| `functions/liffBookingSignIn.js` | ✅ NEW |
| `functions/createBookingLock.js` | ✅ NEW |
| `functions/getRoomAvailability.js` | ✅ NEW |
| `functions/expireBookingLocks.js` | ✅ NEW |
| `functions/verifyBookingSlip.js` | ✅ NEW |
| `functions/index.js` | ✅ wired |
| `firestore.rules` | ✅ booking block |
| `firestore.rules.test.js` | ✅ 12 new tests pass |
| `storage.rules` | ✅ booking paths |
| `booking.html` | ✅ NEW |
| `service-worker.js` | ✅ precache |
| `vercel.json` | ✅ no-cache |
| `tools/compute-csp-hashes.js` | ✅ listed |
| `tools/csp-hashes.json` | ✅ regenerated |
| `shared/tailwind.css` | ✅ rebuilt |

**Pre-deploy checklist** (must complete before deploy):
- [x] All `node --check` syntax checks pass
- [x] `npm run test:rules` 97/98 pass (1 pre-existing failure in wellnessClaimed unrelated to this work)
- [x] `npm run csp:hash` clean
- [x] `npm run tailwind:build` clean
- [x] booking.html static layout verified in browser preview
- [ ] **`owner_info/main.phone` populated in Firestore** (admin must set via dashboard before first booking — required for QR generation)

**Deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,\
functions:createBookingLock,\
functions:getRoomAvailability,\
functions:expireBookingLocks,\
functions:verifyBookingSlip,\
firestore:rules,\
storage
```

After deploy, the booking site is live at: `https://the-green-haven.vercel.app/booking.html`

To register the URL with LINE: LINE Developers Console → LIFF tab → optionally add a new LIFF entry that points at `/booking.html` (or reuse existing channel since same `LIFF_ID`). For prospects to access, share the LIFF URL e.g. via QR code or LINE Official Account.

### Phase 4 next (admin Booking sub-tab)

Sprint 2 work:
- `functions/convertBookingToTenant.js` — admin-triggered conversion CF
- `dashboard.html` — new "Booking" sub-tab in Tenant section
- `shared/dashboard-bookings.js` — admin UI module (table, slip viewer, KYC view, approve/convert buttons)

Sprint 3 (optional):
- Phase 5: Pre-Check-in KYC upload UI (storage rules already in place)
- Phase 6: Gamification Early Bird award on contract creation

### Memory doc lifecycle

To be written at end of Sprint 1 (per CLAUDE.md verify-via-grep doctrine):
- `lifecycle_booking_flow.md` with `## Verification` section grep-backing every claim (collection paths, rule lines, CF region, lock duration, Early Bird threshold, etc.)
- Add to `MEMORY.md` index under "🏛️ System Lifecycles → Tenant-facing"
- Update `firestore_schema_canonical.md` with new `bookings/*` collection

---

## Review — Phase 4 shipped 2026-05-04

### Files added (2)
- [functions/convertBookingToTenant.js](functions/convertBookingToTenant.js) — admin-only HTTPS callable, ~180 lines. Atomic Firestore transaction creates tenant doc + approves liffUsers + flips booking status='converted'. Pre-tx queries both buildings for `linkedAuthUid` match → reuses `tenantId` for returning LINE users (cross-room continuity), mints fresh `TENANT_${ts}_${roomId}` otherwise (matches existing pattern in `dashboard-tenant-modal.js:499`).
- [shared/dashboard-bookings.js](shared/dashboard-bookings.js) — admin module, ~330 lines. IIFE with `window.initBookingsAdmin` + `window.dashboardBookings` exports (UMD pattern). Idempotent onSnapshot subscription to `bookings/* orderBy createdAt desc limit 200`. Filterable table with status pills, search across name/phone/room/lineId/bookingId, per-row actions: 📄 details modal · 🧾 slip viewer (Storage `getDownloadURL` → new tab) · ✓ approve KYC (admin direct write) · 🏠 convert (calls CF) · ✕ cancel locked (admin direct write).

### Files modified (3)
- [dashboard.html](dashboard.html) — added 5th sub-tab button `🗓️ จอง` in Tenant section + new tab content card (`tenant-main-tab-bookings`) with filter row + mount point + footer hint, + `<script src="./shared/dashboard-bookings.js">` in script load order (after `dashboard-tenant-modal.js`).
- [shared/dashboard-main.js](shared/dashboard-main.js) — `switchTenantMainTab` array updated `['tenants','leases','requests','alerts'] → ['tenants','leases','requests','alerts','bookings']`; button selector updated; `initBookingsAdmin()` call added when tab='bookings'.
- [functions/index.js](functions/index.js) — wired `convertBookingToTenant` export.

### Behavioral choices

**Why admin-only convert (not auto):** the original plan bullet (#12 in Design decisions) specified manual convert so admin can review KYC + slip before promoting prospect to tenant. Skipping auto-convert prevents "I paid → I'm a tenant" race in case of fraud / failed KYC. Admin sees full booking detail, slip image, KYC docs (when Phase 5 ships) before clicking the button.

**Why pre-transaction tenant lookup (not inside the tx):** the cross-building `linkedAuthUid` query needs to scan two collections (no Firestore index spans collection paths). Doing this inside the transaction would conflict on every tenants/* read, ballooning retry rate. `linkedAuthUid` is set-once per LINE account by `liffSignIn` — it doesn't drift mid-conversion, so the read-then-tx pattern is safe.

**Why atomic tx for tenant + liffUsers + booking update:** if any of the three writes fails partway, admins would need manual cleanup (e.g., booking marked converted but no tenant doc). Single transaction = all three commit together or none do.

**Why direct setDoc (not CF) for approve KYC + cancel locked:** these are simple status flips with no race-condition concerns and no cross-doc writes. Admin already has full write access to `bookings/*` per rules. Adding a CF for a 1-field flip would be over-engineering. Convert is the only action that needs a CF (atomic multi-doc write).

**`liffUsers/{lineUserId}` auto-approval after convert:** this means the new tenant can open `tenant_app.html` immediately after admin clicks Convert and the existing `liffSignIn` CF will mint their tenant token without a second admin approval step. Keeps the flow: lock → pay → admin convert → tenant signs into app.

### Verification
- `node --check functions/convertBookingToTenant.js` ✓
- `node --check shared/dashboard-bookings.js` ✓
- `npm run csp:hash` clean (dashboard.html script count unchanged — no new inline `<script>` blocks, just markup changes)
- `npm run verify:memory` — **31/31 booking verifier rows GREEN** (added 7 Phase 4 verifiers; still 22 docs / 0 fails total)
- Browser preview DOM verification: all 5 tenant tab buttons load, `dashboard-bookings.js` script tag present, `initBookingsAdmin` function exposed, switchTenantMainTab updated. Visual UI verification deferred to Vercel deploy (localhost dashboard auth + Firebase init both fail without /api/config + admin custom claim).

### What can NOT be verified outside production
- End-to-end convert flow (requires admin custom claim + real bookings docs)
- Slip image viewer (requires real Storage upload from `verifyBookingSlip` CF run)
- Returning-tenant detection (requires existing tenant with matching `linkedAuthUid`)
- Auto-approval of liffUsers leading to successful tenant_app sign-in

### Sprint 2 (Phase 4) complete

**8 booking files modified/added across Sprint 1 + Sprint 2:**

| File | Sprint | Status |
|---|---|---|
| `functions/promptpay.js` | 1 | ✅ |
| `functions/liffBookingSignIn.js` | 1 | ✅ |
| `functions/createBookingLock.js` | 1 | ✅ |
| `functions/getRoomAvailability.js` | 1 | ✅ |
| `functions/expireBookingLocks.js` | 1 | ✅ |
| `functions/verifyBookingSlip.js` | 1 | ✅ |
| **`functions/convertBookingToTenant.js`** | **2** | ✅ NEW |
| `booking.html` | 1 | ✅ |
| **`shared/dashboard-bookings.js`** | **2** | ✅ NEW |
| `dashboard.html` | 2 | ✅ +5th tab |
| `shared/dashboard-main.js` | 2 | ✅ +bookings handler |

**Updated deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,functions:createBookingLock,\
functions:getRoomAvailability,functions:expireBookingLocks,\
functions:verifyBookingSlip,functions:convertBookingToTenant,\
firestore:rules,storage
```

### Phase 5 + 6 (Sprint 3, optional)

- **Phase 5**: Pre-Check-in KYC upload UI in `booking.html` confirmation step (storage rules already in place from Sprint 1).
- **Phase 6**: Gamification Early Bird award trigger inside `convertBookingToTenant` — port from `gamification-rules.js` rules engine, gated on `GAMIFICATION_LIVE` flag, +500 pts when `booking.earlyBirdEligible == true`. Currently `convertBookingToTenant` already preserves `gamification` subobject from any returning tenant; the new-room write would need to seed `gamification.points = earlyBirdPoints`.

---

## Review — Phase 5 + 6 shipped 2026-05-04

### Phase 5: Pre-Check-in KYC

#### Files added (1)
- [functions/submitBookingKyc.js](functions/submitBookingKyc.js) — HTTPS callable, ~110 lines. Server-verified KYC submission. Lists `bookings/{id}/kyc/*` via admin SDK to confirm required uploads exist (don't trust client-provided file list), validates required types (`idCardFront` + `idCardBack`), updates booking → status='paid' → 'kyc_pending' + records `kycDocsTypes`, `kycDocsPath`, `kycSubmittedAt`. Status guard allows re-submission while `kyc_pending` so admin can ask for re-upload.

#### Files modified (1)
- [booking.html](booking.html) — added Storage SDK import to Firebase init module + `window.bookingFirebase.uploadKyc()` helper; replaced "เปิดใช้งานเร็วๆ นี้" placeholder in `#stepConfirm` with full KYC upload UI:
  - 4 file picker tiles (`idCardFront`, `idCardBack`, `houseReg`, `employmentLetter`) with deterministic filenames so re-uploads overwrite
  - Per-tile state classes: `.uploaded` / `.uploading` / `.error` for visual feedback (green/amber/red)
  - 5MB cap + image|PDF MIME check + AVIF/HEIC→JPEG canvas conversion (matches slip flow)
  - Submit button gated on required-types-uploaded; calls `submitBookingKyc` CF on click
  - Success state (`#kycDone`) replaces upload section after server confirms

#### Why server-verified (not client-trusted)
A client could call `submitBookingKyc({bookingId})` claiming uploads exist when they don't. CF lists Storage server-side via `bucket.getFiles({prefix})` and matches filename stems against the type whitelist before flipping booking status. Required types missing → throws `failed-precondition` with friendly Thai error message.

#### Why deterministic filenames (not timestamp-based like slips)
Re-uploading the same KYC type overwrites — admin sees only the latest version per type, prospects can re-upload bad photos without admin intervention. Slip uploads use timestamp-based filenames because slip provenance matters for audit + dedup; KYC docs are admin-reviewed live, latest-wins is fine.

### Phase 6: Early Bird gamification

#### Files modified (3)
- [functions/createBookingLock.js](functions/createBookingLock.js) — `earlyBirdEligible` now requires `building === 'nest'` AND `daysUntilStart >= 30`. Rooms prospects don't see misleading "+500 pts" hints in `booking.html` that would never materialize.
- [functions/convertBookingToTenant.js](functions/convertBookingToTenant.js) — when converting an `earlyBirdEligible` booking, mergedGamification adds `+500 pts` to existing `gamification.points` (or seeds 500 from 0 for new tenants), records `earlyBirdAwardedAt` + `earlyBirdPoints` audit fields, writes a `paymentHistory/booking_early_bird_{YYYY-MM}` ledger marker (mirrors verifySlip's payment-history pattern), and stamps `earlyBirdAwarded: true` + `earlyBirdAwardedPoints: 500` on the booking doc for admin dashboard visibility. All inside the same atomic transaction.
- [booking.html](booking.html) — modal Early Bird hint now also gates on `state.building === 'nest'` (was time-only). Server-side gate matches: hint is only shown when actually awardable.

#### Why Nest-only

Per `gamification_ssot.md`: the gamification system (points, badges, leaderboard, redemption) is Nest-building-only. Awarding points to a Rooms tenant doc would be dead data — the tenant_app.html points display + leaderboard + redemption UI all gate on `building === 'nest'`. Keeping the gate in `createBookingLock` is the **single source of truth**: `earlyBirdEligible` and `earlyBirdPoints` fields on the booking doc are reliable; downstream code (UI, convert CF) can trust them without re-checking building.

#### Idempotency

`convertBookingToTenant` runs once per booking — the status guard rejects subsequent calls (`booking.status === 'converted'` is not in `CONVERT_ELIGIBLE_STATUSES`). Within the transaction, gamification points + paymentHistory ledger marker + booking flip all commit together or none do. No "re-award" path exists, so double-award is structurally impossible.

#### Returning-tenant case

If the prospect was already a Nest tenant before (linkedAuthUid match), their existing `gamification` subobject is preserved AND has earlyBirdPoints added. A Nest tenant moving from N101 to N301 with eligible booking → +500 on top of their existing balance, in the new room's tenant doc. (The original room's tenant doc is untouched — admin chooses whether to mark it moved-out separately.)

### Verification
- `node --check` all 3 modified/new CF files ✓
- `npm run csp:hash` — clean. booking.html still 4 scripts + 1 style (no new inline blocks; existing module script body changed → new hash, recorded).
- `npm run verify:memory` — **39/39 booking verifier rows GREEN** (was 31, added 8 Phase 5+6 verifiers). 22 docs / 197+ rows / 0 fails total.
- Browser preview DOM: KYC section present in `#stepConfirm`, 4 tiles with correct `data-kyc-type` values, submit button starts disabled, kycDone (success state) ready to replace upload section. (Screenshot tool stuck on localhost — visual verification deferred to Vercel deploy.)

### What can NOT be verified outside production
- End-to-end KYC upload flow (requires LIFF auth + booking doc in `paid` state)
- Storage rule guard on KYC writes (requires real prospect token)
- `submitBookingKyc` server-side file verification (requires actual Storage uploads)
- Early Bird points landing in tenant_app.html UI (requires `GAMIFICATION_LIVE` flag flip + Nest tenant signed in)

### Sprint 3 complete

**3 booking phases shipped today (2026-05-04):** Phase 4 admin UI + Phase 5 KYC + Phase 6 Early Bird.

**Final Sprint 1+2+3 file inventory:**

| File | Status |
|---|---|
| `functions/promptpay.js` (Phase 1) | ✅ |
| `functions/liffBookingSignIn.js` (Phase 1) | ✅ |
| `functions/createBookingLock.js` (Phase 1, modified Phase 6) | ✅ |
| `functions/getRoomAvailability.js` (Phase 1) | ✅ |
| `functions/expireBookingLocks.js` (Phase 1) | ✅ |
| `functions/verifyBookingSlip.js` (Phase 2) | ✅ |
| `functions/convertBookingToTenant.js` (Phase 4, modified Phase 6) | ✅ |
| `functions/submitBookingKyc.js` (Phase 5) | ✅ |
| `booking.html` (Phase 3, modified Phase 5+6) | ✅ |
| `shared/dashboard-bookings.js` (Phase 4) | ✅ |
| `dashboard.html` (Phase 4) | ✅ |
| `shared/dashboard-main.js` (Phase 4) | ✅ |
| `firestore.rules` + `firestore.rules.test.js` (Phase 1) | ✅ |
| `storage.rules` (Phase 2) | ✅ |
| `service-worker.js` + `vercel.json` + `tools/compute-csp-hashes.js` + `tools/csp-hashes.json` + `shared/tailwind.css` (Phase 3) | ✅ |
| `lifecycle_booking_flow.md` + `MEMORY.md` + `firestore_schema_canonical.md` (Phase 3-6) | ✅ |

**Final deploy command:**
```bash
firebase deploy --only \
  functions:liffBookingSignIn,functions:createBookingLock,\
functions:getRoomAvailability,functions:expireBookingLocks,\
functions:verifyBookingSlip,functions:convertBookingToTenant,\
functions:submitBookingKyc,\
firestore:rules,storage
```

Pre-deploy gate: `owner_info/main.phone` must be set in Firestore (admin sets via dashboard before first booking).

### What's NOT in scope (intentional, per Sprint 1 design decisions)

- ❌ Auto-cancellation refund flow (manual admin process)
- ❌ Multi-room booking in one transaction (1 booking = 1 room)
- ❌ Walk-in booking (LIFF only; admin can manually create via Firestore Console as escape hatch)
- ❌ External payment gateway (PromptPay only)
- ❌ Booking-flow English/multi-lang (Thai only)
- ❌ Booking site hosted on a separate LIFF channel (reuses tenant LIFF channel; route-based separation via URL)
