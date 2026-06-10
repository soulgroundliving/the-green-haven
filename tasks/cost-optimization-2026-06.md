# Cost optimization — Firebase Blaze (the-green-haven), 2026-06

**Context (2026-06-10):** forecast **~฿319/mo (~$9)**, ↑16% vs May. Billing account
`01BC33-EDDDB7-F0C4FF` ("Firebase Payment", THB) is **`open: false`** — disabled by a
**PAYMENT failure**, NOT a cost overrun (฿319 is trivially affordable; for an app with
100+ Cloud Functions + Firestore + RTDB + Storage + real-time listeners + LIFF serving
real tenants, this is near the floor).

> ⚠️ While billing is disabled, **every `gcloud` call is 403 BILLING_DISABLED and no
> CF/rules deploy is possible.** So cost *investigation* and *optimization* are blocked at
> the source — Step 0 must happen first.

## ✅ RESOLVED 2026-06-10 — driver was min-instances; removed (~40% cut, deployed)

Billing restored (`open: true`, app back). Owner sent the **Reports → by Service/SKU** breakdown, which pinpointed it.

**Per-service breakdown (Reports, May 11 – Jun 9 = ฿340.89):**
| Service | Subtotal | Note |
|---|---|---|
| **Cloud Run Functions (Gen1)** | **฿241 (71%)** | the SKU "**Min Instance Memory Tier 2**" grew **+฿111** |
| **App Engine** | ฿56 (16%) | NO App Engine app exists (`gcloud app … not found`) → this is the **Gen1-functions backing** (Gen1 bills under both SKUs) |
| **Cloud Scheduler** | ฿41 (12%) | ~14 jobs × $0.10/mo — the per-**JOB** fee (NOT free past the first 3; invocations ARE free) |
| Artifact Registry / Storage / Pub/Sub | ~฿3 | negligible (Artifact Registry only 1.1 GB) |

**Root cause:** `liffSignIn` + `liffBookingSignIn` each held **`.runWith({ minInstances: 1 })`** → one idle instance billed 24/7 per function = the "Min Instance Memory Tier 2" SKU (~40% of the bill). **Redundant:** `keepLiffWarm` already pings both every 5 min (< the ~15-min idle timeout) → they stay warm at ~$0. The min-instance paid twice for warmth keepLiffWarm gives free.

**Fix (shipped `e2a0b17`, CI-deployed):** removed `minInstances` from both → `gcloud functions describe` confirms `minInstances` now empty (0) on both. Sign-in stays warm via keepLiffWarm; near-zero added cold-start risk; auth logic untouched. **Saves ~40% (~฿100-150/mo).** (Local `firebase deploy` hit a firebase-tools 15.13.0 bug — `TypeError: …reading 'ram'` in min-instance cost calc — so the CI toolchain did the deploy instead.)

> ⚠️ **Lesson — auditing min-instances needs BOTH gens.** I first said "no min-instances" because I checked only **Gen2** Cloud Run `minScale` (`gcloud run services list` → all empty). **Gen1 functions set min-instances via `.runWith({ minInstances })` in CODE**, invisible to `gcloud run services list`. Audit with `grep -rn "minInstances" functions/` AND `gcloud functions describe <name> --format="value(minInstances)"`. Also corrected: Cloud Scheduler is NOT "free" (฿41 per-job fee; reducing job COUNT, not frequency, is the only lever — marginal). The empirical lesson held: the Reports-by-SKU screenshot was what surfaced the truth — don't conclude "no waste" from partial gcloud inspection.

**Recurrence prevention for the DISABLE (separate from cost):** the incident was a PAYMENT failure (not spend), which a budget alert does NOT catch. Real prevention = a **backup payment method** on the billing account + watch Google's billing-failure emails.

---
_(Below: the historical plan written while billing was disabled — Step 0–4. Superseded by the RESOLVED section above; kept for the residual marginal wins + the owner-console steps.)_

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

## Reality check (post-fix)
The min-instance fix removed the ONE big waste (~40%). What remains (~฿200/mo) is genuine
diffuse operating cost — Gen1 function compute + Cloud Scheduler per-job fees + small egress.
Further trims (consolidate ~14 scheduler jobs into fewer; log exclusion) are marginal (~฿20–40)
and not worth the risk. **Post-fix, the app is efficient — no remaining big leak.**
