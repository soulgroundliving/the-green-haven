# Green Haven — Launch Checklist (Pre-Production)

ตรวจให้ครบทุก check ก่อน launch. แต่ละหัวข้อต้อง **เปิด live URL จริง + เห็นผลด้วยตา** ไม่ใช่แค่ assume

Live URL: <https://the-green-haven.vercel.app>

---

## 1. Login + redirect flow

- [ ] เปิด `/login` → กรอก tenant credentials → redirect ไป `/tenant_app?room=15` ถูกต้อง
- [ ] เปิด `/login` → กรอก admin credentials → redirect ไป `/dashboard.html` ถูกต้อง
- [ ] เปิด URL เก่า `/tenant.html` → 308 redirect → 404 (ลบแล้ว ไม่ต้องมี fallback)
- [ ] Console ฝั่ง tenant_app: ไม่มี error, `Firebase init successful`, `firebaseInitialized` event fired

## 2. Tenant app — Bills + Payment

- [ ] หน้า home → 4 nav cards คลิกได้, badge ที่ Bills แสดงจำนวนที่ยังไม่จ่าย
- [ ] หน้า Bills → เห็นบิลของห้องตัวเอง (เดือน/ปี/จำนวนเงิน)
- [ ] กดบิล → step-1 แสดงรายละเอียดค่าเช่า/น้ำ/ไฟ/ขยะ ถูกต้อง
- [ ] Step-2 → แสดง PromptPay QR + จำนวนเงินตรงกับบิล
- [ ] Upload สลิป → SlipOK verify → ขึ้น "✅ ตรวจสอบสำเร็จ"
- [ ] Step-3 → แสดงใบเสร็จ + ปุ่ม "พิมพ์" + "ดาวน์โหลด"
- [ ] กด "ดาวน์โหลด" → ได้ไฟล์ PNG (html2canvas)
- [ ] **Reload หน้า bills** → บิลที่จ่ายแล้วแสดง "ชำระแล้ว" (ไม่ revert เป็น "ยังไม่จ่าย")
- [ ] เปิด Firebase Console → RTDB `payments/rooms/15/{pushId}` → มี record
- [ ] เปิด RTDB `bills/rooms/15/{billId}/status` → `'paid'`

## 3. Tenant app — Maintenance + Housekeeping + Complaints

- [ ] Service page → เห็น 4 menu (maintenance, cleaning, complaint, …)
- [ ] กด "แจ้งซ่อม" → form → submit → ขึ้น toast success + ขึ้นใน RTDB `maintenance/rooms/15/{id}`
- [ ] กด "ทำความสะอาด" → submit → RTDB `housekeeping/rooms/15/{id}` ✅
- [ ] กด "แจ้งเรื่องร้องเรียน" → submit → Firestore `complaints/{id}` ✅
- [ ] เปิด admin dashboard → page-requests-approvals → เห็น ticket ใหม่ทั้ง 3 อันภายใน 5 วินาที (realtime)

## 4. Tenant app — Community + Profile + Contract

- [ ] Community page → ประกาศ + events + documents โหลดจาก Firestore (real-time)
- [ ] Profile page → แสดงชื่อ/เบอร์/ห้อง/วันเริ่มเช่า ถูกต้อง
- [ ] Contract page → แสดงสัญญา + ปุ่ม "ดู" + "ดาวน์โหลด" สัญญา (PDF/JPG จาก base64 contractDocument)

## 5. Tenant app — Gamification (Nest only — defer if no real Nest tenant)

- [ ] Login as **Nest tenant** (e.g. N101)
- [ ] Home page → eco-score card visible
- [ ] Eco-score page → คะแนนแสดง = ค่าใน Firestore `tenants/nest/list/N101.gamification.points`
- [ ] เปิด Firestore Console → แก้ `gamification.points` มือ → tenant app updates ทันที (onSnapshot)
- [ ] Login as **Rooms tenant** (e.g. 15) → eco-score card **ไม่แสดง** (Nest-only guard)
- [ ] Open rewards shop → เห็น 7 รายการจาก Firestore `rewards/`
- [ ] กดแลก → confirm → CF `redeemReward` ถูกเรียก → points decrement
- [ ] Firestore `tenants/nest/list/N101/redemptions/{auto}` → record ใหม่
- [ ] กดแลกอันเดิมอีกครั้ง พร้อมกัน 2 tab → CF reject อันที่ 2 (transaction prevents double-spend)

## 6. Admin dashboard

- [ ] Page-property → เห็นห้อง 23 ห้อง (rooms) + 20 ห้อง (nest) + Amazon
- [ ] Page-tenant → list ลูกบ้าน + edit modal ทำงาน
- [ ] Page-meter → import Excel `บิลปี69.xlsx` → preview ถูก columns (F/L for eNew/wNew)
- [ ] Page-monthly → generate bills → push ขึ้น RTDB `bills/rooms/{room}/{billId}` ครบ
- [ ] Page-payment-verify → SlipOK feed shows verified slips realtime
- [ ] Page-gamification → tab Rewards → list 7 rewards จาก Firestore
- [ ] กด "+ Add Reward" → save → tenant app เห็นรายการใหม่ทันที (no redeploy)
- [ ] กด Edit/Delete → เปลี่ยนแปลงบน tenant app real-time

## 7. Cloud Functions deployment

- [ ] `firebase deploy --only functions` สำเร็จ ครบ:
  - [ ] `verifySlip` (asia-southeast1)
  - [ ] `redeemReward` (asia-southeast1) — **NEW**
  - [ ] `seedRewards` (asia-southeast1) — **NEW** one-shot
  - [ ] `checkAndAwardBadges`, `getLeaderboard`, `calculateTenantRank`
  - [ ] `cleanupResolvedComplaints` (pubsub), `awardComplaintFreeMonth` (pubsub)
- [ ] รัน seedRewards ครั้งเดียว: `curl -X POST https://asia-southeast1-the-green-haven.cloudfunctions.net/seedRewards`
- [ ] ตรวจ Firestore `rewards/` มี 7 docs

## 8. Cross-device + cache

- [ ] Test บนมือถือ (Safari iOS + Chrome Android) — UI render ถูก, ไม่มี layout broken
- [ ] Login บน device A → จ่ายบิล → Login บน device B → เห็นสถานะ "paid" (ไม่ใช่ stale localStorage)
- [ ] Clear localStorage → reload tenant app → ข้อมูลโหลดจาก Firebase ครบ (ไม่หาย)

## 9. Console clean

- [ ] ฝั่ง tenant_app: ไม่มี red error (warnings OK ถ้ามาจาก analytics)
- [ ] ฝั่ง dashboard: ไม่มี red error
- [ ] Network tab: ทุก request 200/304 (ไม่มี 4xx/5xx)

## 10. Security spot-check

- [ ] Open Firestore Rules — verify auth required สำหรับ writes ที่สำคัญ
- [ ] Try edit `points` ใน browser console → CF write should reject (test redeemReward integrity)
- [ ] XSS smoke test: ใส่ `<script>alert(1)</script>` ในชื่อใน profile/complaint/maintenance → ไม่ execute (escaped)

---

## Scheduled monitoring

มี 4 scheduled tasks ที่ตั้งไว้แล้ว — ตรวจว่ายัง active:
- `gh-auto-billing-monthly` (วันที่ 1, 06:03)
- `gh-firebase-health-daily` (08:07)
- `gh-meter-import-reminder` (ศุกร์ 17:14)
- `gh-prelaunch-smoke-test` (09:20) — **เปลี่ยนเป็นรายสัปดาห์หลัง launch**

## Known TODOs (post-launch ทำได้)

1. ~~Tighten Firestore rules + Auth — tenant CF redeem~~ — done 2026-04-28: redeemReward + claimDailyLoginPoints now check `context.auth.token.{room,building}` against requested room
2. ~~CF migration: `awardRentPaymentPoints`~~ — removed 2026-04-28 (no caller; verifySlip already awards rent payment points)
3. Image optimization — contract documents เป็น base64 JPG ใน Firestore = bloat. ย้ายไป Cloud Storage
4. PDF export ใบเสร็จ — มี jsPDF โหลดแล้ว แต่ยังใช้ html2canvas → PNG, ทำ PDF version
