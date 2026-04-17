# World Map Backgrounds — Nest building dynamic scenes

บันทึกไฟล์ 3 ไฟล์นี้ลงใน `shared/bg/` ให้ตรงชื่อเป๊ะ:

| ไฟล์ | ใช้เมื่อ | แนะนำขนาด |
|------|---------|-----------|
| `nest-day.webp`   | กลางวัน + ฟ้าปลอดโปร่ง / มีเมฆบ้าง | 1080×2340 (อัตราส่วน iPhone Pro Max) |
| `nest-rain.webp`  | ฝน / พายุฝนฟ้าคะนอง / หมอก (WMO 45-67, 80-82, 95-99) | same |
| `nest-night.webp` | กลางคืนไทย 19:00–06:00 Asia/Bangkok | same |

## แนะนำ format
- **WebP** (ประหยัด 30-50% เทียบกับ JPG) — ทุก browser ยุคใหม่รองรับ
- ขนาดรวมพยายามให้ < 200 KB ต่อไฟล์ (LIFF webview โหลดไว)
- ถ้าใช้ JPG/PNG ให้แก้ path ใน `tenant_app.html` — search `shared/bg/nest-` 

## ทำ WebP จาก PNG/JPG ยังไง
```bash
# ใช้ cwebp (Google WebP CLI)
cwebp -q 80 input.jpg -o nest-day.webp

# หรือออนไลน์: https://squoosh.app/
```

## ถ้าไฟล์หาย
CSS มี gradient fallback (สีเขียวอ่อน / เทาฝน / น้ำเงินเข้ม) ระบบยังใช้งานได้ปกติ

## วันที่เพิ่มฟีเจอร์
2026-04-18 — ตาม request ของ user ที่ต้องการ world-map bg เปลี่ยนตามสภาพอากาศจริงและเวลาไทย
