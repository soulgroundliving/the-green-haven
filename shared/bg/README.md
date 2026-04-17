# World Map Backgrounds — Nest building (5 base + holiday overrides)

บันทึกไฟล์ใน `shared/bg/` ตามชื่อเป๊ะ

## Base 5 modes (weather + time)

| ไฟล์ | เงื่อนไข |
|------|---------|
| `nest-day-clear.webp`   | 06:00–19:00 BKK + WMO 0 (ฟ้าใส) |
| `nest-day-cloudy.webp`  | 06:00–19:00 BKK + WMO 1-3 (มีเมฆ) |
| `nest-rain.webp`        | ฝน/หมอก/พายุ (WMO 45-67, 80-82, 95-99) กลางวัน |
| `nest-night-clear.webp` | 19:00–06:00 BKK + ไม่ฝน |
| `nest-night-rain.webp`  | 19:00–06:00 BKK + ฝน |

## Holiday overrides (priority > base)

| ไฟล์ | ช่วงเวลา |
|------|---------|
| `nest-halloween.webp`        | 31 ต.ค. 17:00 → 1 พ.ย. 06:00 |
| `nest-christmas-night.webp`  | 24-26 ธ.ค. ช่วง 18:00-06:00 |
| `nest-christmas-day.webp`    | 24-26 ธ.ค. ช่วง 06:00-17:59 |
| `nest-newyear.webp`          | 31 ธ.ค. – 2 ม.ค. (ทั้งวัน) |

## Priority logic
```
1. Holiday ชนะทุกอย่าง (halloween > christmas > newyear)
2. ถ้าไม่ใช่ holiday → base 5-mode ตามเวลา + weather code
```

## สำหรับอนาคต (ยังไม่เจน)
- `nest-songkran.webp` — 13-15 เม.ย. (สงกรานต์)
- `nest-valentine.webp` — 14 ก.พ.
- `nest-loykratong.webp` — วันลอยกระทง (ขึ้น 15 ค่ำ เดือน 12)
- `nest-mothersday.webp` — 12 ส.ค. (วันแม่)
- `nest-fathersday.webp` — 5 ธ.ค. (วันพ่อ)

เมื่อเจนภาพแล้ว save ลง folder นี้ + บอกแอดมินให้เพิ่มช่วง date check ใน `_checkHoliday()`

## Format
- **WebP** (30-50% เล็กกว่า JPG) < 200 KB/ไฟล์
- 1080×2340 px (iPhone Pro Max aspect)

## Fallback
หากไฟล์หาย — CSS gradient render แทนอัตโนมัติ (9 gradient แยกตาม mode)

## Updated
2026-04-18 — base 5 + halloween/christmas-night/christmas-day/newyear
