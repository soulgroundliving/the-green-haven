# Staging Environment + Restore Drill — Runbook

Two related goals served by the same staging Firebase project:

1. **Restore drill** — verify backups can actually be restored (quarterly).
2. **Staging deployment** — let preview branches deploy to a non-production Firebase project so risky changes don't touch real tenant data.

The Vercel/Firebase code path supports staging now (see `api/config.js`); what's left is the human steps to provision the project and wire env vars.

---

## One-time setup (15 min)

### Step 1 — Create the staging Firebase project

1. https://console.firebase.google.com/ → **Add project** → name it `the-green-haven-staging` (or set your own — pass it as `STAGING_PROJECT_ID` later).
2. Skip Google Analytics (we don't need it for staging).
3. Once created, in the new project:
   - **Build → Firestore Database → Create database**
     - Location: `asia-southeast3` (Jakarta — same as prod for region-locked behaviour)
     - Mode: production
   - **Build → Realtime Database → Create database** (same region)
   - **Build → Authentication → Get started → Email/Password + Anonymous** (whichever prod uses)
   - **Build → Storage → Get started**

### Step 2 — Grab the staging Firebase Web SDK config

Project Settings → General → Your apps → Add app (Web) → register `the-green-haven-staging-web` → copy the `firebaseConfig` object.

### Step 3 — Add staging vars to Vercel

Vercel project → Settings → Environment Variables → add **for Preview environment only**:

| Key | Value |
|-----|-------|
| `FIREBASE_STAGING_API_KEY` | from Step 2 |
| `FIREBASE_STAGING_PROJECT_ID` | `the-green-haven-staging` |
| `FIREBASE_STAGING_AUTH_DOMAIN` | `the-green-haven-staging.firebaseapp.com` |
| `FIREBASE_STAGING_DATABASE_URL` | from Step 2 |
| `FIREBASE_STAGING_STORAGE_BUCKET` | `the-green-haven-staging.firebasestorage.app` |
| `FIREBASE_STAGING_MESSAGING_SENDER_ID` | from Step 2 |
| `FIREBASE_STAGING_APP_ID` | from Step 2 |

`api/config.js` already detects `VERCEL_ENV === 'preview'` AND staging vars → returns staging config. Production deploys are untouched.

### Step 4 — Grant the staging service account access to the prod backup bucket

Restore drill needs to read prod backups. Without this it fails with `PERMISSION_DENIED`:

```bash
gcloud storage buckets add-iam-policy-binding gs://the-green-haven-backups \
  --member="serviceAccount:service-<STAGING_PROJECT_NUMBER>@gcp-sa-firestore.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

Find `<STAGING_PROJECT_NUMBER>` in: https://console.firebase.google.com/project/the-green-haven-staging/settings/general (the numeric Project number, not the project ID).

---

## Restore drill (run quarterly, ~10 min)

```bash
chmod +x tools/restore-drill.sh
STAGING_PROJECT_ID=the-green-haven-staging ./tools/restore-drill.sh
```

What it does:
1. Locates the most recent timestamped folder in `gs://the-green-haven-backups`
2. Calls `gcloud firestore import` against the staging project (async)
3. Polls until import finishes (timeout 30 min)
4. Spot-counts docs in 5 collections so you can sanity-check vs production

Manual verification after the script finishes:
- Open Firebase Console for staging → Firestore → spot-check 5-10 random tenant docs
- Open the staging Auth tab → confirm user list looks right (or empty if backups don't include auth — they don't by default)
- Record the wall-clock time + any anomalies in `docs/RESTORE_DRILL_LOG.md`

If the drill fails, capture the error and fix BEFORE you need a real restore. Common failures:
- IAM bucket access (Step 4 above)
- Firestore not initialized in staging (`gcloud firestore databases create --location=asia-southeast3 --project=the-green-haven-staging`)
- Quota / billing not enabled in staging project

---

## Using staging for risky changes (deploy preview)

Once env vars are set:

```bash
git checkout -b risky-rule-change
# edit firestore.rules
git push origin risky-rule-change
```

Vercel auto-deploys to a preview URL. Open it — `api/config` returns staging vars, so the dashboard talks to `the-green-haven-staging` Firestore. You can `firebase deploy --only firestore:rules --project=the-green-haven-staging` to test the rule change there before merging.

For Cloud Functions, deploy to staging too:
```bash
firebase deploy --only functions --project=the-green-haven-staging
```

---

## What staging does NOT replicate

- **Cloud Scheduler crons** — staging has its own scheduled jobs. Don't expect prod-fired cron output.
- **External webhooks (LINE, SlipOK)** — these call the prod CF URLs. To test, manually invoke the staging CF endpoints.
- **Tenant data** — fresh staging is empty. Restore drill populates it from a snapshot.
- **Custom auth claims** — claims from prod don't carry over. Re-run `tools/grant-admin-claim.js` against staging if you need an admin login there.

---

## When in doubt

- "Should I deploy this rule to prod?" → **No.** Deploy to staging first, smoke-test, then prod.
- "Is the backup actually restorable?" → Run the drill. The answer is "we don't know" until you've actually done it.
- "How fresh is the staging data?" → Last restore drill date in `docs/RESTORE_DRILL_LOG.md`.
