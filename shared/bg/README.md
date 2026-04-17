# World Map Backgrounds — Nest building dynamic scenes (5 modes)

บันทึกไฟล์ **5 ไฟล์** ลงใน `shared/bg/` ให้ตรงชื่อเป๊ะ:

| ไฟล์ | ใช้เมื่อ | ภาพควรเป็น |
|------|---------|------------|
| `nest-day-clear.webp`   | 06:00–19:00 + WMO code 0 (ฟ้าใส) | กลางวัน แดดจัด ฟ้าปลอดโปร่ง ป่าเขียวสดใส |
| `nest-day-cloudy.webp`  | 06:00–19:00 + WMO 1-3 (มีเมฆ) | กลางวัน เมฆครึ้ม แต่ไม่ฝน บรรยากาศทึมอ่อน |
| `nest-rain.webp`        | ฝน/หมอก/พายุ (WMO 45-67, 80-82, 95-99) กลางวัน | ฝนตก ฟ้าสีเทา ไม่มีแดด |
| `nest-night-clear.webp` | 19:00–06:00 + ไม่ฝน | กลางคืน ดาวเต็มฟ้า/พระจันทร์ ไฟอาคารติด |
| `nest-night-rain.webp`  | 19:00–06:00 + ฝน | กลางคืนฝนตก ฟ้ามืดสนิท มีแสงไฟสะท้อนบนพื้นเปียก |

## Decision logic
```
isNight = hour ≥ 19 OR hour < 6   (Asia/Bangkok)
rain    = WMO 45-48, 51-67, 80-82, 95-99
cloudy  = WMO 1-3

if  isNight && rain    → night-rain
elif isNight            → night-clear
elif rain               → rain
elif cloudy             → day-cloudy
else                    → day-clear  (code 0 / fallback)
```

## แนะนำ format
- **WebP** (ประหยัด 30-50% เทียบกับ JPG) — ทุก browser ยุคใหม่รองรับ
- ขนาดรวม < 200 KB ต่อไฟล์ (LIFF webview โหลดไว)
- 1080×2340 px (อัตราส่วน iPhone Pro Max)

## ทำ WebP จาก PNG/JPG
```bash
cwebp -q 80 input.jpg -o nest-day-clear.webp
# หรือออนไลน์: https://squoosh.app/
```

## ถ้าไฟล์หาย
CSS มี gradient fallback (เขียวสดใส / เทาอมเขียว / เทาฝน / น้ำเงินเข้ม / น้ำเงินดำ)
ระบบยังใช้งานได้ปกติ

## วันที่เพิ่มฟีเจอร์
2026-04-18 — ขยายจาก 3 โหมด → 5 โหมด เพื่อแยก day-clear/day-cloudy และ
night-clear/night-rain ให้ตรงสภาพจริงมากขึ้น
