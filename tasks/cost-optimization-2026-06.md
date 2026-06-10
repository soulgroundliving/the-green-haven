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

## 🧰 Owner runbook (prepared 2026-06-10) — copy-paste, owner runs in console

> Billing is `open: true` again, so these now work. **These are owner-console actions** (billing/IAM) — Claude prepared them but does not run them. Easiest path: run the `gcloud` blocks in **Cloud Shell** (top-right `>_` in console — pre-authed, no local install). Or use the Console UI steps.

### A. Budget + email alert  (Step 2 — highest value, prevents the next silent surprise)

**Console (easiest, no API/IAM prereq):**
1. https://console.cloud.google.com/billing/01BC33-EDDDB7-F0C4FF/budgets
2. **Create budget** → Name `Green Haven ฿500/mo` → Scope: **Project = the-green-haven** → Amount: **Specified amount = 500** (account currency is THB) → Thresholds **50% / 90% / 100%** (actual) → Finish. Alerts email Billing Account admins/users by default.

**gcloud alternative (run in Cloud Shell):**
```bash
gcloud billing budgets create --billing-account=01BC33-EDDDB7-F0C4FF --display-name="Green Haven ฿500/mo" --budget-amount=500 --filter-projects=projects/the-green-haven --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend
```
Prereq for the gcloud route: Cloud Billing Budget API (`billingbudgets.googleapis.com`) enabled + role **Billing Account Administrator**. To also email a specific address (beyond billing admins), create a Cloud Monitoring notification channel and add `--notifications-rule-monitoring-notification-channels=<channel>`.

### B. Artifact Registry cleanup policy  (Step 3 — caps `gcf-artifacts` image growth; also kills the §7-NN stale-image class)

Policy = **keep the 3 most recent versions per function, delete the rest once older than 30 days** (committed as [`tools/gcf-artifacts-cleanup-policy.json`](../tools/gcf-artifacts-cleanup-policy.json)). Keep-rules win over Delete-rules, so the latest 3 builds per CF are always retained.

**⚠️ Run with `--dry-run` FIRST, inspect what it would delete, then re-run with `--no-dry-run` to enforce.** Run in Cloud Shell:
```bash
cat > /tmp/gcf-cleanup.json <<'EOF'
[
  { "name": "gcf-keep-recent-3", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 3 } },
  { "name": "gcf-delete-older-than-30d", "action": { "type": "Delete" }, "condition": { "tagState": "any", "olderThan": "2592000s" } }
]
EOF

# 1) DRY-RUN — logs what WOULD be deleted, deletes nothing:
gcloud artifacts repositories set-cleanup-policies gcf-artifacts --location=asia-southeast1 --project=the-green-haven --policy=/tmp/gcf-cleanup.json --dry-run

# 2) After confirming it looks right, ENFORCE:
gcloud artifacts repositories set-cleanup-policies gcf-artifacts --location=asia-southeast1 --project=the-green-haven --policy=/tmp/gcf-cleanup.json --no-dry-run
```
(If gcloud rejects `"2592000s"`, swap it for `"30d"` — both are accepted by most versions.) Console equivalent: Artifact Registry → `gcf-artifacts` → **Cleanup policies** → add a Keep-most-recent=3 rule + a Delete older-than-30-days rule → save in **Dry run** mode → review → switch to **Live**. Prereq: role **Artifact Registry Administrator**. AR is only ~1.1 GB today, so savings are small — the real win is bounding future growth + the stale-image hygiene.

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
- [ ] **Budget + alert** — ✅ commands prepared → **see "🧰 Owner runbook → A" above** (Console + gcloud, ฿500/mo, 50/90/100%). **Prevents the next silent surprise** — single most valuable action. _Awaiting owner run in console._

## Step 3 — "same efficiency" wins (zero functionality loss; need billing back)
- [ ] **Artifact Registry cleanup policy** on `gcf-artifacts` — ✅ policy + commands prepared → **see "🧰 Owner runbook → B" above** (`tools/gcf-artifacts-cleanup-policy.json`, keep-3 + delete-older-than-30d, **`--dry-run` first**). Caps image growth + kills the §7-NN stale-image class. _Awaiting owner run in console._
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
