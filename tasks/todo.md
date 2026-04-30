# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Phase 1 — Dashboard Deep Analytics

## Context
Category tabs ship แล้ว (commit `e454e25`). ขั้นต่อไปคือเพิ่ม "Deep Analytics" ระดับ 2 (Cohort/Time-Series) เข้าไปในแต่ละ tab — เริ่มจาก Phase 1 ที่มีข้อมูลพร้อม:
1. **Wellness Engagement Matrix** → ชุมชน tab
2. **Daily Login Streak Leaderboard** → ชุมชน tab
3. **Per-Tenant Payment Behavior** → การเงิน tab

ทั้งสามตอบคำถามที่ผู้ใช้ถามตรงๆ ("ใครอ่าน wellness, ใครรับคะแนน, ใครจ่ายช้า/เร็ว") + ใช้ข้อมูลที่ Firestore/RTDB มีอยู่แล้ว ไม่ต้อง schema migration

---

## ⚠️ Pre-Step (Blocker) — Firestore Rule

`firestore.rules:193-201` มี per-doc rule สำหรับ `wellnessClaimed/{articleId}` แต่ **ไม่มี wildcard** สำหรับ `collectionGroup('wellnessClaimed')` query (เทียบกับ `pets` ที่มีที่ line 210-212 → ทำงานได้)

→ **ต้องเพิ่ม:**
```javascript
// ===== WELLNESS CLAIMED — collectionGroup query support (admin only) =====
match /{path=**}/wellnessClaimed/{articleId} {
  allow read: if isAdmin();
}
```
วางต่อจาก pets wildcard rule (~line 213). Deploy ผ่าน `firebase deploy --only firestore:rules` หลัง `npm run test:rules` ผ่าน

- [ ] เพิ่ม rule ใน `firestore.rules`
- [ ] เพิ่ม test ใน `firestore.rules.test.js` — admin collectionGroup read pass + tenant fail
- [ ] รัน `npm run test:rules` ผ่าน
- [ ] Deploy rules

---

## Feature 1: Wellness Engagement Matrix

### Question answered
"แต่ละบทความ wellness มีกี่ห้องอ่าน/รับคะแนน ห้องไหนมีส่วนร่วมมากที่สุด"

### Data sources (verified)
| Field | Path | Verifier |
|-------|------|----------|
| Article master | `wellness_articles/{id}` Firestore — มี `title`, `reward` | `dashboard-wellness-content.js:315` |
| Per-room claim | `tenants/{building}/list/{roomId}/wellnessClaimed/{articleId}` — `{articleId, title, reward, claimedAt: ISO}` | `tenant_app.html:8859-8864` |

### Query
```javascript
const articles = await getDocs(collection(db, 'wellness_articles'));
const claims   = await getDocs(collectionGroup(db, 'wellnessClaimed'));
// Aggregate by article + by room
claims.forEach(c => {
  const room = c.ref.parent.parent.id;       // tenants/{b}/list/{room}/wellnessClaimed/{articleId}
  const building = c.ref.parent.parent.parent.parent.id;
  byArticle[c.data().articleId].rooms.add(`${building}:${room}`);
  byRoom[room].count++;
});
```

### Layout (in `dash-cat-community`)
```
┌──────────────────────────────────────────────────────────┐
│ 📚 Wellness Engagement                          [↻ refresh] │
│ ─────────────────────────────────────────────────────── │
│ รวม 87 claims · 23/43 ห้อง active (53%)                 │
│                                                          │
│ บทความ                       ห้องอ่าน   อัตรา   รวมแต้ม │
│ ─────────────────────────────────────────────────────── │
│ ดูแลปอด PM2.5                  18 / 43   42%     180    │
│ ออมเงินผู้เช่า                  14 / 43   33%     280    │
│ ทำอาหาร 5 นาที                 11 / 43   26%     110    │
│ ─────────────────────────────────────────────────────── │
│ 🏆 ผู้เช่ากระตือรือร้น (Top 3):                          │
│   N301 (12 บทความ) · 25 (9) · N105 (8)                  │
└──────────────────────────────────────────────────────────┘
```
Click row → modal แสดงรายชื่อห้องที่อ่านบทความนั้น (with claimedAt date)

- [ ] เพิ่ม `<div id="dashWellnessMatrix">` ใน `dash-cat-community`
- [ ] `renderWellnessMatrix()` ใน `shared/dashboard-insights.js`
- [ ] Modal: row click → list of rooms+date

---

## Feature 2: Daily Login Streak Leaderboard

### Question answered
"ห้องไหน active สม่ำเสมอ ห้องไหนหายไป"

### Data sources (verified)
| Field | Path | Verifier |
|-------|------|----------|
| `gamification.dailyStreak` | tenant doc field, Number | `claimDailyLoginPoints.js:83` |
| `gamification.lastDailyClaim` | tenant doc field, "YYYY-MM-DD" Bangkok TZ | `claimDailyLoginPoints.js:82` |
| `gamification.lastDailyClaimAt` | tenant doc field, server timestamp | `claimDailyLoginPoints.js:84` |
| `gamification.points` | tenant doc field | `claimDailyLoginPoints.js:81` |

### Query
```javascript
for (const building of ['rooms','nest']) {
  const snap = await getDocs(collection(db, `tenants/${building}/list`));
  snap.forEach(d => allRooms.push({ id: d.id, building, ...(d.data().gamification||{}) }));
}
allRooms.sort((a,b) => (b.dailyStreak||0) - (a.dailyStreak||0));
```

### Layout (in `dash-cat-community`, ข้างๆ Wellness Matrix — 2-col grid)
```
┌──────────────────────────────────────────┐
│ 🔥 Streak Leaderboard         [↻ refresh] │
│ ─────────────────────────────────────── │
│ 🥇 N201   47 days   🔥🔥🔥              │
│ 🥈 18     31 days   🔥🔥                │
│ 🥉 N105   28 days   🔥🔥                │
│    25     14 days   🔥                  │
│    N304    9 days                        │
│ ─────────────────────────────────────── │
│ Today's logins:  18 / 43 ห้อง           │
│ 💤 Inactive >7d: 14 ห้อง [ดูรายชื่อ]   │
└──────────────────────────────────────────┘
```
Click "ดูรายชื่อ" → modal of inactive rooms with last seen

- [ ] เพิ่ม `<div id="dashStreakLeaderboard">` ใน `dash-cat-community`
- [ ] `renderStreakLeaderboard()`
- [ ] Modal: inactive rooms list

---

## Feature 3: Per-Tenant Payment Behavior

### Question answered
"ห้องไหนจ่ายเร็ว/ตรงเวลา/ช้า เฉลี่ยกี่วันจาก due date"

### Data sources (verified)
| Field | Path | Verifier |
|-------|------|----------|
| Bill due date | RTDB `bills/{building}/{room}/{billId}.dueDate` (Date) | `verifySlip.js:370` |
| Bill paid date | RTDB `bills/{building}/{room}/{billId}.paidAt` (epoch ms) | `verifySlip.js:294` |
| Bill status | `.status === 'paid'` | `verifySlip.js:293` |
| RTDB read | admin/accountant token | `config/database.rules.json:14` |

### Computation
```javascript
const ref = firebase.database().ref('bills');
const snap = await ref.once('value');
const all = snap.val() || {};
// per-room aggregate
Object.entries(all).forEach(([building, rooms]) => {
  Object.entries(rooms || {}).forEach(([room, bills]) => {
    Object.values(bills || {}).forEach(b => {
      if (b.status !== 'paid' || !b.paidAt || !b.dueDate) return;
      const due = new Date(b.dueDate).getTime();
      const delta = (b.paidAt - due) / 86400000;  // days, neg=early
      perRoom[`${building}:${room}`].deltas.push(delta);
    });
  });
});
```
Categorize: early (< -2), on-time (-2..2), late (3..7), very-late (>7)
Filter: bills paid in last 6 months only (`paidAt > now - 180d`)

### Layout (in `dash-cat-financial`, หลัง 12-month table)
```
┌────────────────────────────────────────────────────────┐
│ 💳 Per-Tenant Payment Behavior (last 6 months)         │
│ Sort: [จ่ายช้าสุด ▼] [ตึก: ทั้งหมด ▼]   [↻ refresh]   │
│ ────────────────────────────────────────────────────── │
│ ห้อง   เฉลี่ย       ประวัติ                Tier        │
│ ────────────────────────────────────────────────────── │
│ N301   −2.4 วัน   ████████ 6/6 early      ⭐⭐⭐⭐      │
│ N201   +0.5 วัน   ████░░░░ 4/6 on-time    ⭐⭐⭐        │
│ 25     +6.2 วัน   ██░░░░░░ 2/6 late       ⭐⭐         │
│ 17     +14.0 วัน  █░░░░░░░ 1/6 chronic    ⭐           │
└────────────────────────────────────────────────────────┘
```

- [ ] เพิ่ม `<div id="dashPaymentBehavior">` ใน `dash-cat-financial`
- [ ] `renderPaymentBehavior()` ดึง RTDB `bills/`
- [ ] Sort + building filter dropdown

---

## Implementation Order

1. **PRE — Firestore rule** — Add wellnessClaimed wildcard + test + deploy
2. **Skeleton** — Create `shared/dashboard-insights.js` (empty render fns + 5-min cache)
3. **HTML** — Add 3 placeholder divs in tabs
4. **Wire lazy init** — `switchDashboardTab` calls `initCommunityInsights()` / `initFinancialInsights()` on tab show
5. **F1: Wellness** — implement + verify live
6. **F2: Streak** — implement + verify live
7. **F3: Payment** — implement + verify live

Each feature = its own commit (atomic rollback)

---

## Files Summary

| File | Change | Approx LOC |
|------|--------|-----------|
| `firestore.rules` | Add wildcard rule for wellnessClaimed | +4 |
| `firestore.rules.test.js` | Add test for collectionGroup admin pass | +10 |
| `dashboard.html` | 3 placeholder divs + 1 script tag | +9 |
| `shared/dashboard-insights.js` | NEW: 3 render fns + 5-min cache helper | ~250 |
| `shared/dashboard-main.js` | Lazy-init hooks in `switchDashboardTab` | +2 |

**ไม่แตะ:** existing tab logic, ทุก page อื่น, build config

---

## Verification (per feature, on live)

### Wellness Matrix
1. After rules deploy: admin Console:
   ```javascript
   const s = await firebase.firestore().collectionGroup('wellnessClaimed').get();
   console.log(s.size);  // not throw
   ```
2. ชุมชน tab → matrix renders
3. Manually count claims for 1 article → match displayed count

### Streak Leaderboard
1. ชุมชน tab → top streaks display
2. "Today's logins" count = manual filter rooms where `lastDailyClaim === todayBKK`
3. "Inactive >7d" list correct

### Payment Behavior
1. การเงิน tab → table renders rooms with paid bills (6 mo)
2. Pick 1 room → manually compute `paidAt - dueDate` from RTDB → match avg
3. Sort + building filter work
4. No-history rooms show "—"

---

## Rollback strategy
Each feature = own commit → `git revert <sha>` ปลด feature เดียวได้ Category-tab layer คงอยู่

---

## Review — 2026-04-30 session

### Shipped (10 commits)
| sha | what |
|-----|------|
| `dd0da40` | Category tabs (5 categories) + multi-property nav (Apartment / Mall coming-soon) — replaces year-only filter |
| `e454e25` | Remove redundant building (rooms/Nest) filter row inside การเงิน — building breakdown already in KPI cards |
| `ba23ace` | Firestore rule: `match /{path=**}/wellnessClaimed/{articleId}` admin collectionGroup wildcard (mirrors pets pattern) — deployed live |
| `21316b8` | Phase 1 — 3 deep-analytics cards (Wellness Engagement Matrix, Streak Leaderboard, Per-Tenant Payment Behavior) — `shared/dashboard-insights.js` ~582 LOC, 5-min cache, lazy-init via `switchDashboardTab` hooks |
| `68890f5` | Fix: Firebase v11 modular SDK for RTDB (`firebase.database()` does NOT exist; project uses `window.firebaseRef` + `firebaseGet`) — see `tasks/lessons.md` 2026-04-30 entry |
| `b7fd3da` | Fix: dropdown collapsing on click — `click` handler was matching SELECT and re-rendering the card, removed SELECT branch from click router (change handler covers it) |
| `d8a4923` | Phase 2 — Tenant Health Score (composite 0-100, 4 sub-scores 25 each: payment / engagement / issues / tenure) + Churn Risk Alert (any of 5 trigger flags). Both inside ผู้เช่า tab |
| `9eb0fe0` | Convert Health + Churn rows from table → grid tiles |
| `d357e88` | ผู้เช่า tab layout: Churn Risk (L) ‖ Health Score (R), responsive auto-stack <760px |
| `a51fdd4` | Churn Risk: 3-per-row compact tiles to match Health Score density (minmax 170px) |

### Architecture additions
- New module `shared/dashboard-insights.js` — single hub for all deep-analytic cards (Phase 1 + 2). Lazy-init pattern: render fns called on first tab show, cached 5 min, refresh chip per panel. All scoring graceful when data missing (e.g. paymentDelta=null → 15/25 neutral, not 0).
- New reference memory `firebase_client_sdk_v11_modular.md` — captures the API surface of this project (modular, NOT compat) so future sessions don't repeat the `firebase.database().ref().once()` mistake.
- New lesson in `tasks/lessons.md` 2026-04-30 — Firebase v11 modular SDK contract.

### Deferred (next session candidates)
- **Phase 2.5 — Anomaly Detection** (slip amount mismatch + meter usage spike). Blocked partly by `meter_data` schema having mixed conventions (`meter_data/{building_yy_m_roomId}` flat vs nested `meter_data/{building}/{yearMonth}/data` map). Need to consolidate to one before z-score / threshold logic is reliable.
- **Phase 3 — Predictive Cash Flow + Provider Scorecard.** Cash Flow needs scheduled CF for forecast model. Provider Scorecard BLOCKED — no `service-providers` Firestore collection (currently localStorage-only), no `assignedProviderId` field on maintenance/complaint records, no `costThb` tracked. Schema migration required first.
- **Visual verification of Phase 1+2 cards** by user — Browser MCP tabId encoding bug in this session prevented automated verification. HTTP-level deploy artifacts confirmed (HTML markers, JS exports, file sizes). User to confirm rendering on live.

### Constraints discovered
- meter history depth limited to 6 months in `billing-system.js:1018` (`.slice(0, 6)`) — affects any z-score-style anomaly detection that needs more lookback.
- Contract Quiz attempts stored localStorage-only (per-tenant device); admin can only see aggregate points awarded (`source: 'contract_quiz'`), not which questions were correct/wrong without new CF.
- Wellness articles have NO quiz — only "read → claim points". User asked "ใครตอบคำถามถูก" referring to wellness; clarified no quiz exists for wellness, separate Contract Quiz feature exists.

---

# 🎨 Design Guidelines (Phase 1)

## Brand foundation (ทางสายกลาง · muji minimal)
- **Font:** `IBM Plex Sans Thai Looped` (fallback Sarabun) — ใช้ตัวเลขด้วย (รองรับ tabular-nums)
- **Hierarchy:**
  - Section title: `.card-title` (uppercase, 0.82rem, weight 700, color `var(--text-muted)`, letter-spacing .5px)
  - Body: 0.85rem, weight 400-500, color `var(--ink)` หรือ `#1f1f1c`
  - Numeric/metric: weight 600, **NO uppercase**
- **Spacing:** padding card 1.4rem (existing `.card`), gap-grid 0.7rem (existing pattern)
- **Radius:** `var(--radius-md, 16px)` standard; pills/chips ใช้ `var(--radius-pill)`
- **No shadows ใหม่** ใช้ `var(--shadow-sm)` หรือ `var(--shadow-md)` (existing tokens)

## Color palette mapping (semantic — ใช้ token เท่านั้น)

### Status tiers (ใช้ทุก feature)
| Tier | Background | Border-left | Text | Token usage |
|------|-----------|-------------|------|-------------|
| 🟢 **Excellent** | `var(--green-pale)` | `var(--green)` | `var(--green-dark)` | early payment, high streak, top reader |
| 🟡 **Good / Steady** | `var(--blue-pale)` | `var(--blue)` | `#1a5c8a` | on-time, mid streak |
| 🟠 **Warning** | `var(--accent-light, #fff3e0)` | `var(--accent, #ff9800)` หรือ `var(--warn)` | `#bf360c` | late payment, dropping streak, low engagement |
| 🔴 **Alert** | `#fce4ec` | `var(--alert, #c06458)` | `#c62828` | chronic late, churn risk, inactive |
| ⚪ **Neutral / Empty** | `var(--mist)` | `var(--stone)` | `var(--text-muted)` | no data, "—" |

### Background treatments
- **Card body:** `var(--card)` = white (existing)
- **Subtle band (table alternating):** `var(--green-pale)` 30% opacity หรือ `var(--mist)`
- **Page bg:** ใช้ของเดิม (`var(--cloud)`)
- **Avoid:** linear gradients ที่หนัก ✗ (เก็บไว้ที่ KPI live cards เท่านั้น), pure black ✗ (ใช้ `var(--ink)`), saturated colors ✗

### Accent colors (use sparingly)
- Streak fire 🔥 — text-only emoji, ไม่เปลี่ยน background
- Tier stars ⭐ — `color: var(--accent-gold, #D4AF37)` (มีใน contract-quiz section แล้ว)
- Top-3 medals 🥇🥈🥉 — emoji เดียว, ไม่เพิ่ม visual chrome

---

## Component patterns (สอดคล้อง dashboard เดิม)

### Wrapper card (ทุก feature)
```html
<div class="card">
  <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
    <span>📚 Wellness Engagement</span>
    <button data-action="refreshInsight" data-target="wellness"
            style="font-size:.72rem;padding:2px 10px;background:var(--green-pale);
                   color:var(--green-dark);border:1px solid var(--green);
                   border-radius:var(--radius-pill);cursor:pointer;">
      ↻ refresh
    </button>
  </div>
  <div class="insight-summary" style="font-size:.78rem;color:var(--text-muted);margin-bottom:.7rem;">
    รวม 87 claims · 23/43 ห้อง active (53%)
  </div>
  <div class="insight-body"><!-- table/list --></div>
</div>
```

### Data table pattern (Wellness, Payment Behavior)
```css
table { width:100%; border-collapse:collapse; font-size:.82rem; }
thead tr { background: var(--green-pale); color: var(--green-dark); }
thead th { padding: .55rem .7rem; text-align:left; font-weight:700; }
tbody tr { border-bottom: 1px solid var(--border-subtle, #ebe9e2); }
tbody tr:hover { background: var(--mist); }
tbody td { padding: .5rem .7rem; }
tbody td.numeric { text-align:right; font-variant-numeric: tabular-nums; }
```
- Sortable headers: ใช้ `▼` after sorted col (ไม่ใช้ icon library)
- Empty rows: 1 row spanning all cols, text-center, color `var(--text-muted)`, "ยังไม่มีข้อมูล"

### Bar visualization (history strip)
ใช้ Unicode block chars ❌ (อ่านยาก) → ใช้ `<div>` styled bar:
```html
<div style="display:inline-flex;gap:2px;vertical-align:middle;">
  <div style="width:10px;height:14px;background:var(--green);border-radius:2px;"></div>
  <div style="width:10px;height:14px;background:var(--green);border-radius:2px;"></div>
  <div style="width:10px;height:14px;background:var(--mist);border-radius:2px;"></div>
  ...
</div>
```
- Filled = `var(--green)` หรือ tier color
- Empty = `var(--mist)`
- 6 bars (6 months) max ใน Payment Behavior

### Leaderboard list (Streak)
```html
<ol style="list-style:none;padding:0;margin:0;">
  <li style="display:grid;grid-template-columns:30px 1fr 70px 60px;
             padding:.45rem .25rem;border-bottom:1px solid var(--border-subtle);
             align-items:center;font-size:.86rem;">
    <span>🥇</span>
    <span style="font-weight:600;">N201</span>
    <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--green-dark);font-weight:600;">47 days</span>
    <span style="text-align:right;">🔥🔥🔥</span>
  </li>
</ol>
```

### Sub-text + chip
```html
<div style="font-size:.78rem;color:var(--text-muted);margin-top:.6rem;
            padding-top:.6rem;border-top:1px dashed var(--border-subtle);">
  💤 Inactive >7d: <strong style="color:var(--alert);">14 ห้อง</strong>
  <button data-action="showInactiveRooms"
          style="margin-left:.4rem;font-size:.72rem;padding:1px 8px;
                 background:transparent;border:none;color:var(--blue);
                 cursor:pointer;text-decoration:underline;">ดูรายชื่อ →</button>
</div>
```

---

## State design

### Loading
ก่อนข้อมูลโหลดเสร็จ — แทนที่ body ด้วย:
```html
<div style="text-align:center;color:var(--text-muted);padding:2rem;font-size:.85rem;">
  <span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span>
  กำลังโหลด...
</div>
```
**ห้ามใส่ skeleton screen** — ขัดกับ muji (น่ารำคาญสายตา) ใช้แค่ message สั้น

### Empty (ไม่มีข้อมูลเลย)
```html
<div style="text-align:center;color:var(--text-muted);padding:2rem;">
  <div style="font-size:2rem;opacity:.4;margin-bottom:.5rem;">📭</div>
  <div style="font-size:.85rem;">ยังไม่มี [wellness claim/streak/payment] ในช่วงนี้</div>
</div>
```

### Error (Firestore permission/network)
```html
<div style="text-align:center;padding:1.5rem;">
  <div style="color:var(--alert);font-size:.88rem;margin-bottom:.4rem;">
    ⚠️ โหลดข้อมูลไม่สำเร็จ
  </div>
  <button data-action="refreshInsight" data-target="wellness"
          style="font-size:.78rem;padding:4px 12px;background:var(--green-pale);
                 color:var(--green-dark);border:1px solid var(--green);
                 border-radius:var(--radius-pill);cursor:pointer;">
    ลองใหม่
  </button>
</div>
```

---

## Interaction patterns

| Action | Affordance |
|--------|-----------|
| Row click → drill-down modal | `cursor:pointer; tbody tr:hover { background: var(--mist); }` + small `→` arrow ตอน hover |
| Sort by column | header เป็น `<button>` styling เหมือน `<th>` + `▼`/`▲` after active col |
| Refresh single panel | `↻ refresh` chip บนขวา card-title |
| Filter dropdown | reuse `.year-tab` look (rounded pill) |
| Loading from cache (5min) | small subtitle: `อัปเดตล่าสุด: 2 นาทีที่แล้ว` (color text-muted, .72rem) |

**ห้ามใช้:** modal stacking >1 ลึก, popup notification, animated reveal, hover tooltip ที่ต้องรอ delay (cognitive load สูง)

---

## Per-feature design summary

### F1: Wellness Engagement Matrix
- **Card accent:** `var(--green)` (สื่อถึง health/wellness)
- **Header summary:** ตัวเลขสีเขียวเข้มเด่น
- **Table tier colors:**
  - อัตรา ≥40% → green (var(--green-dark) text)
  - 20-39% → moss (var(--moss) text)
  - <20% → muted (var(--text-muted) text)
- **Top 3 chip:** inline pill "🏆 N301 (12) · 25 (9) · N105 (8)" — สี `var(--green-pale)` bg
- **Click row:** เปิด modal — list of rooms + claimedAt date (Thai date format "12 เม.ย. 2569")

### F2: Daily Login Streak Leaderboard
- **Card accent:** `var(--accent-gold, #D4AF37)` (สื่อถึง achievement) — ใช้ border-left 4px
- **Top 3:** medals emoji (🥇🥈🥉) — ไม่เปลี่ยนสีพื้น row
- **Streak fire emoji rules:**
  - 1-6 days → no flame
  - 7-13 days → 🔥
  - 14-29 days → 🔥🔥
  - 30+ days → 🔥🔥🔥
- **Today's logins:** progress bar — 18/43 with `var(--blue)` fill
- **Inactive >7d:** alert pill, click → modal with red `var(--alert)` color rows

### F3: Per-Tenant Payment Behavior
- **Card accent:** `var(--green)` (financial = green ใน brand)
- **Tier colors per row:** (border-left 3px)
  - Excellent (avg < -2d) → `var(--green)`
  - Good (-2..2d) → `var(--blue)`
  - Late (3-7d) → `var(--accent, #ff9800)`
  - Chronic (>7d) → `var(--alert)`
- **Bar viz:** 6 boxes filled = paid on history; color = same tier
- **Stars:** ⭐ count = 4-tier mapping (4★ excellent → 1★ chronic)
- **Empty room:** "—" with `var(--text-muted)` (rooms ที่ไม่มี paid bill ใน 6 เดือน)

---

## Responsive (mobile, tablet)

- **Stack 2-col grid → 1-col** ที่ width <768px (existing CSS pattern via grid-template-columns)
- **Table:** horizontal scroll wrapped (existing pattern — `<div style="overflow-x:auto;">`)
- **Bar viz:** ลดขนาด box จาก 10px → 8px ที่ <480px
- **Modal:** full-screen ที่ <600px (ใช้ `.modal` existing class)

---

## Accessibility / a11y notes

- ทุก button มี `aria-label` (เช่น `aria-label="รีเฟรชข้อมูล wellness"`)
- Modal ใช้ `role="dialog" aria-modal="true" aria-labelledby="..."` เหมือนใน tenant_app.html
- Color is supplemented with text/icon (อย่าใช้สีอย่างเดียวบอกสถานะ — มี emoji + ตัวเลขด้วย)
- Tabular numbers: `font-variant-numeric: tabular-nums` ทุกที่มีตัวเลข

---

## Build/Deploy notes (per CLAUDE.md)

- **ห้ามใส่ `?v=...`** ใน script URL — vercel.json no-cache สำหรับ shared/*.js แล้ว
- **Tailwind:** ไม่ต้อง rebuild — ทั้งหมดใช้ inline style + brand.css tokens
- **Test locally:** ❌ — push → Vercel → verify on live (per CLAUDE.md § 2.1)
- **Pre-commit hook** จะรัน `verify:memory` อัตโนมัติ — ถ้ามี doc claim ใหม่ต้องเพิ่ม verifier
