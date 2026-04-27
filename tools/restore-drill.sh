#!/usr/bin/env bash
#
# Restore drill — pulls the latest production Firestore backup into a
# separate staging GCP project and verifies the import succeeded.
#
# Why this exists: daily backups are useless if they've never been tested.
# This script forces an end-to-end restore exercise so we know recovery
# actually works before we need it.
#
# Prerequisites:
#   1. gcloud CLI installed + logged in (`gcloud auth login`)
#   2. A second Firebase/GCP project (recommended: the-green-haven-staging)
#   3. Set STAGING_PROJECT_ID below before running
#
# Usage:
#   chmod +x tools/restore-drill.sh
#   ./tools/restore-drill.sh
#
# Schedule: run this quarterly. Calendar reminder.

set -euo pipefail

PROD_PROJECT="the-green-haven"
PROD_BACKUP_BUCKET="gs://the-green-haven-backups"
STAGING_PROJECT="${STAGING_PROJECT_ID:-the-green-haven-staging}"

echo "🔍 Restore drill — $(date -Iseconds)"
echo "   Source backup bucket: $PROD_BACKUP_BUCKET"
echo "   Target staging project: $STAGING_PROJECT"
echo ""

# 1. Find the latest backup directory
echo "📂 Finding latest backup..."
LATEST_BACKUP=$(gcloud storage ls "$PROD_BACKUP_BUCKET/" --project="$PROD_PROJECT" 2>/dev/null \
  | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}T' \
  | sort \
  | tail -1)

if [ -z "$LATEST_BACKUP" ]; then
  echo "❌ No backup found at $PROD_BACKUP_BUCKET — check the cron is running."
  echo "   Look at Firebase Console → Firestore → Backups."
  exit 1
fi
echo "   Latest backup: $LATEST_BACKUP"
echo ""

# 2. Verify staging project exists + has Firestore enabled
echo "🔐 Verifying staging project access..."
if ! gcloud projects describe "$STAGING_PROJECT" >/dev/null 2>&1; then
  echo "❌ Staging project '$STAGING_PROJECT' not accessible."
  echo "   Either:"
  echo "   - Create it: https://console.firebase.google.com/  (Add project)"
  echo "   - Pass STAGING_PROJECT_ID=<your-staging-id> when running this script"
  exit 1
fi
echo "   ✓ Project '$STAGING_PROJECT' accessible"
echo ""

# 3. Trigger import (async — gcloud returns immediately, import runs server-side)
echo "📥 Importing backup into staging Firestore..."
echo "   This is async — the operation runs server-side."
echo ""
OP=$(gcloud firestore import "$LATEST_BACKUP" \
  --project="$STAGING_PROJECT" \
  --async \
  --format='value(name)' 2>&1) || {
    echo "❌ Import failed to start. Common causes:"
    echo "   - Staging project doesn't have Firestore initialized yet"
    echo "     → run: gcloud firestore databases create --location=asia-southeast3 --project=$STAGING_PROJECT"
    echo "   - IAM: prod backup bucket needs read access from staging service account"
    echo "     → grant 'roles/storage.objectViewer' to staging-compute@$STAGING_PROJECT.iam.gserviceaccount.com"
    echo "     on bucket $PROD_BACKUP_BUCKET"
    echo ""
    echo "Original error:"
    echo "$OP"
    exit 1
  }

echo "   ✓ Import operation started: $OP"
echo ""

# 4. Poll until done (every 30s, max 30min)
echo "⏳ Waiting for import to finish (poll every 30s, timeout 30min)..."
START_TS=$(date +%s)
TIMEOUT=1800
while true; do
  STATUS=$(gcloud firestore operations describe "$OP" \
    --project="$STAGING_PROJECT" \
    --format='value(done,error.message)' 2>/dev/null || echo "false ")

  DONE=$(echo "$STATUS" | awk '{print $1}')
  ERR=$(echo "$STATUS" | cut -d' ' -f2-)

  ELAPSED=$(($(date +%s) - START_TS))
  if [ "$DONE" = "True" ]; then
    if [ -n "$ERR" ] && [ "$ERR" != "" ]; then
      echo "❌ Import finished with error: $ERR"
      exit 1
    fi
    echo "   ✓ Import complete in ${ELAPSED}s"
    break
  fi
  if [ $ELAPSED -gt $TIMEOUT ]; then
    echo "⚠️  Import still running after 30 min — check manually:"
    echo "     gcloud firestore operations describe $OP --project=$STAGING_PROJECT"
    exit 1
  fi
  printf "   ... %ds elapsed\r" "$ELAPSED"
  sleep 30
done
echo ""

# 5. Spot-check: count docs in 5 representative collections
echo "🔬 Spot-checking restored data (counting docs in 5 collections)..."
for COL in "tenants" "system" "owner_info" "complaints" "rewards"; do
  CNT=$(gcloud firestore documents list "/$COL" \
    --project="$STAGING_PROJECT" \
    --format='value(name)' 2>/dev/null | wc -l || echo "?")
  echo "   $COL: $CNT docs"
done
echo ""

echo "✅ Restore drill complete."
echo ""
echo "Next steps:"
echo "  1. Open Firebase Console for staging project: https://console.firebase.google.com/project/$STAGING_PROJECT"
echo "  2. Spot-check tenant docs match production (5-10 random checks)"
echo "  3. Record the result + restore time in your runbook log"
echo "  4. Schedule the next drill in 3 months"
