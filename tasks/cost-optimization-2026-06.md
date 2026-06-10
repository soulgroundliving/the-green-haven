# Cost optimization — Firebase Blaze (the-green-haven), 2026-06

**Context (2026-06-10):** forecast **~฿319/mo (~$9)**, ↑16% vs May. Billing account
`01BC33-EDDDB7-F0C4FF` ("Firebase Payment", THB) is **`open: false`** — disabled by a
**PAYMENT failure**, NOT a cost overrun (฿319 is trivially affordable; for an app with
100+ Cloud Functions + Firestore + RTDB + Storage + real-time listeners + LIFF serving
real tenants, this is near the floor).

> ⚠️ While billing is disabled, **every `gcloud` call is 403 BILLING_DISABLED and no
> CF/rules deploy is possible.** So cost *investigation* and *optimization* are blocked at
> the source — Step 0 must happen first.

**Verified 2026-06-10 (before billing went down):**
- ✅ **No CF min-instances** (`minScale` empty on all Gen2/Cloud Run CFs) → no idle 24/7 billing (the usual hidden cost is absent).
- ✅ All ~17 scheduled jobs are **under the Cloud Functions free tier** (2M invocations/mo). `keepLiffWarm` (/5min, pings 5 CFs) is NOT a meaningful cost.

---

## Step 0 — restore billing (blocks everything below)
Fix the payment method + settle the overdue invoice → **reopen account `01BC33-EDDDB7-F0C4FF`**.
Console: https://console.cloud.google.com/billing/01BC33-EDDDB7-F0C4FF (or Firebase Console
→ ⚙️ Project Settings → Usage and billing). Until then the tenant app is DOWN
(Storage 402 / Functions fail / Firestore fail).

## Step 1 — SEE where the money goes (do FIRST, before any change — don't optimize blind)
GCP Console → **Billing → Reports → group by "Service"** (then SKU). Screenshot it.
That pinpoints the real driver. Likely candidates for this app:
Firestore **reads** · networking **egress** · **Cloud Build** (CF deploys) ·
**Artifact Registry** storage · **Cloud Logging** ingestion.

## Step 2 — preventive (highest value; do regardless)
- [ ] **Budget + alert** — Billing → Budgets → create (e.g. ฿500/mo) with 50/90/100% email
  alerts. Works even while billing is disabled. **Prevents the next silent surprise** — this
  is the single most valuable action.

## Step 3 — "same efficiency" wins (zero functionality loss; need billing back)
- [ ] **Artifact Registry cleanup policy** on `gcf-artifacts` — keep last 2–3 versions, delete
  older. 100+ Gen2 CFs rebuilt on every CI merge → image storage piles up ($0.10/GB/mo). Also
  kills the §7-NN stale-image class that broke `unsendMarketplaceMessage` on staging this session.
  `gcloud artifacts repositories set-cleanup-policies gcf-artifacts --location=asia-southeast1 --project=the-green-haven --policy=<json>`
  (or Console → Artifact Registry → gcf-artifacts → Cleanup policies).
- [ ] **Log Router exclusion** — Logging → Log Router → exclude high-volume/low-value logs
  (e.g. `keepLiffWarm` warnings, verbose `console.info`). 50GB/mo free, then $0.50/GB.
- [ ] **(Only if Reports shows reads dominate) Firestore read audit** — admin dashboard
  real-time `onSnapshot` on whole collections (`communityRequests`/`foodShares`/`helpRequests`/
  `quests`/`complaints`/`tradeHistory` + `collectionGroup('pets')`) keep reading while the tab
  is open. Check each setup fn for §7-V leaks (re-bind without prior unsub = stacked listeners
  = N× reads) + add/tighten `limit()`. **Targeted only** — never rip out the live-ness.

## Step 4 — NOT recommended (would HURT "same efficiency")
- ❌ `keepLiffWarm` /5min → /15min: saves ~฿0 (under free tier) but increases sign-in
  cold-start latency. Keep as-is. (The owner asked to reduce cost *without* losing performance.)

## Reality check
฿319/mo is near the floor for this app's scope. Realistic safe savings ≈ artifact cleanup +
log exclusion (maybe ฿50–100/mo *if* those are the drivers — confirm via Step 1). The app is
**efficient, not wasteful** — there is no big obvious leak (no min-instances, schedulers free).
