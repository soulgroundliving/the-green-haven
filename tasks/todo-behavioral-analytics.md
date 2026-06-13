# Plan — Product / Behavioral Analytics Layer (Nature Haven)

> **Status:** Phase 0 SHIPPED (PR off `main`, branch `behavioral-timing-phase0`). Phases 1–4 remain PLANNED.
> **Decisions locked (2026-06-13):** Fork #1 = **aggregate-only**; build scope = **Phase 0 only**; branch off `main` (isolated worktree — concurrent session was on `verifiedslips-cf-only`).
> **Threshold:** above plan-first (new collection use + scheduled CF in later phases + PDPA fork + spans sessions). Reversible per-phase.

---

## 1. Goal & Why

Give the owner a **behavioral-analytics layer** that answers four questions the current dashboard cannot:

1. คน active **กี่โมง** (when, by hour/day) ← **Phase 0 delivers this**
2. **ใครใช้ส่วนไหนมากสุด** (feature/page popularity, per-room)
3. พฤติกรรมการใช้ → **ปรับ feature** (adoption, time-to-task, stickiness)
4. **กดพลาดตรงไหน / หลุดออกหน้าไหน** (frustration = rage/dead-click; drop-off)

**Why this, not generic business insights:** the dashboard already has *business* insights (revenue/bills/complaints). This layer is **observability of the product itself** — the killer use case is the **dead-feature detector**: we shipped Meaning Layer #1–16, Trust, Pet Social, Marketplace, Facility booking… and currently have **zero idea which ones tenants actually touch**. "ลงทุนสร้าง #X ไป มีคนใช้ 3% ของ tenant ใน 30 วัน → ควรเลิก/ปรับ/โปรโมท" is the decision this unlocks.

**Honest scope of the data:** `pointsLedger` logs only the **9 point-earning sources**, not page views / mis-clicks / drop-off. So Q1–Q2 are partially answerable today from the ledger; Q3–Q4 need real instrumentation (Phase 1+).

---

## 2. Questions → Metric → Data source (verified)

| คำถาม | Metric | จับจากไหน (verified) |
|---|---|---|
| active กี่โมง | Temporal heatmap (hour × day-of-week) | `pointsLedger.at` (serverTimestamp) → **BKK (UTC+7)** bucketed ✅ Phase 0 |
| ใครใช้ส่วนไหนมากสุด | Feature/page popularity + per-room | `bySource` **already built** in `dashboard-behavioral-engagement.js`; full picture = `page_view` via `showPage(id)` (`tenant-navigation.js:15`) |
| พฤติกรรม → ปรับ feature | Adoption rate, time-to-task, stickiness | `action` via global `data-action` `_dispatch` hub (tenant_app.html) |
| กดพลาดตรงไหน | Rage-click (≥3 <1s) + dead-click (no handler) | same click-delegation hub |
| หลุดหน้าไหน | Funnel drop-off + exit page | `session_start/end` + `funnel_step` |

---

## 3. Architecture decisions (the 3 forks)

### Fork #1 — PDPA scope ✅ DECIDED: aggregate-only
Counts/buckets only, no per-tenant identity. Zero PDPA surface. Revisit room-level (consent ledger `consents/{tenantId}_{purpose}`, PDPA layer already supports it) only for a card that needs "ใครเงียบ" identity at Phase 1.

### Fork #2 — Storage sink (Phase 1+) — recommend the default
Per-tap = 1 Firestore write = แพง. Client accumulates in memory → batch flush on `visibilitychange:hidden` → **RTDB append** (cheap) → daily rollup CF → Firestore aggregate doc → TTL raw 30–90d. Precedent: `computeTrustScoresScheduled` (daily 05:40 BKK).

### Fork #3 — LIFF flush reliability (Phase 1+) — recommend the default
`sendBeacon` / `visibilitychange` + `AbortController` timeout (§7-R). Precedent: presence heartbeat at `facility-booking-ui.js:302`.

---

## 4. Identity & exclusion rules (non-negotiable, Phase 1+)

- ❌ **NEVER key on `auth.uid`** — anon UID drifts per LIFF session (§7-P / §7-HH).
- ✅ Key on **`building`+`roomId`** (active tenant) or **`tenantId`** (player path).
- ✅ **Exclude admin-preview**: skip events when `sessionStorage.getItem('_adminPreview') === '1'` (verified `tenant-liff-auth.js:884`).

(Phase 0 sidesteps all of this — it reads only timestamps from the existing admin-gated ledger.)

---

## 5. Phased rollout

### Phase 0 — temporal heatmap from existing ledger ✅ SHIPPED
- [x] `shared/dashboard-behavioral-timing.js` — pure `computeTiming(events, nowMs)` (hour-of-day × day-of-week, BKK-bucketed, aggregate-only) + `renderTimingHeatmap()` card. Reuses the shared `engagement_ledger` cache (0 extra reads).
- [x] `shared/__tests__/dashboard-behavioral-timing.test.js` — 8 unit tests (empty, BKK bucketing + day-rollover, calendar-independent dow distribution, peak, grid integrity). Green.
- [x] Wired into the **community insights tab**: container in `dashboard.html`, `<script>` tag, render call + refresh case in `dashboard-insights.js`.
- **Blast radius:** dashboard JS + HTML only. No tenant_app, no CF, no rules, no index, no PDPA.
- **Verify:** unit tests green; render mirrors the 5 sibling `dashboard-behavioral-*` cards. Live verify on Vercel (community tab → 🕐 ช่วงเวลาที่ active) post-merge.

### Phase 1 — instrument the 2 choke points → adoption / dead-feature (PLANNED)
- [ ] Wrap the global `data-action` `_dispatch` hub once → `action {action, targetId, page, ts}`.
- [ ] Wrap `window.showPage(id)` once → `page_view {page, ts, sid, bld, room, src}`.
- [ ] Client buffer + flush (Fork #2/#3) → RTDB `behaviorEvents/{building}/{roomId}/{pushId}` → daily rollup CF.
- [ ] Dead-feature card: adoption % per feature over 30d.

### Phase 2 — frustration map (rage/dead click) (PLANNED)
### Phase 3 — funnel / drop-off + auth-hang observability (PLANNED)
### Phase 4 — full dashboard "พฤติกรรม" tab (heatmap + top features + drop-off) (PLANNED)

---

## 6. Event taxonomy (Phase 1+, start ~5)

```
page_view      { page, ts, sid, bld, room, src:'liff'|'web' }
action         { action, targetId, page, ts }       ← from _dispatch
session_start  { entryPage }
session_end    { exitPage, durationMs }
dead_click     { selector, page }
rage_click     { selector, page, count }
funnel_step    { flow:'pay'|'booking'|'onboarding', step }
```

---

## 7. Risks / anti-patterns respected

- Phase 0: §7-RR/II (inline style attrs only, no injected `<style>` → CSP-safe); §7-E (BKK fixed +7h, no local TZ); §7-AAA (orderBy at desc + limit → newest, not oldest); §7-X (innerHTML empty-state branch).
- Phase 1+: §7-R/S (LIFF flush timeout), §7-N/KK (onSnapshot err cb + fromCache gate), §7-P/HH/FFF (no auth.uid keys), §7-I (no auto-write), §7-AA/NN (scheduled CF, not a Firestore trigger).

---

## 8. Open decisions for owner (before Phase 1)

1. ~~Fork #1 PDPA scope~~ → **DECIDED aggregate-only.**
2. ~~Phase 0 vs Phase 1 now~~ → **DECIDED Phase 0 only.**
3. After Phase 0 live-verifies, greenlight Phase 1 (the dead-feature detector — needs the 2 tenant-app wraps + RTDB sink + 1 CF)?

---

## Review (Phase 0)
- **Shipped:** `dashboard-behavioral-timing.js` (card, ~230 lines) + 8 unit tests + 4-line wiring across `dashboard.html` / `dashboard-insights.js`. Branch `behavioral-timing-phase0` off `main` (isolated worktree; concurrent session held `verifiedslips-cf-only`).
- **Why aggregate-only first:** answers "active กี่โมง" with zero PDPA/XSS surface (consumes only timestamps) and zero new infra — proves the value before investing in Phase 1 instrumentation.
- **Deferred:** the optional rollup CF (`computeBehavioralRollupScheduled`) — the card reads the live 90d/≤3000-row ledger query directly (same as the engagement card); rollup is a perf optimization only, not needed until read cost bites.
- **Follow-ups:** live-verify on Vercel (community tab); then decide Phase 1.
