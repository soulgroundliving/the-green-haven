/**
 * backupFirestore — scheduled snapshot of the entire Firestore database
 * to Cloud Storage for disaster recovery.
 *
 * Why: Firestore has no native "oops" button. If someone deploys a bad
 * security rule that permits a bulk delete, or an admin triggers a faulty
 * batch write, there's no undo. This CF writes a full daily export to
 * Cloud Storage under a dated prefix so we can restore from any of the
 * last 30 snapshots via `gcloud firestore import`.
 *
 * Schedule: daily 03:00 BKK (after BigQuery archive at 02:00 so exports
 * don't race for quota).
 *
 * Retention: 30 days — older exports are deleted at the end of each run
 * to cap storage cost. At current ~30-room scale expected data size is
 * <50 MB per snapshot → ≤1.5 GB rolling window → ~$0.04/month storage.
 *
 * Storage layout:
 *   gs://{PROJECT}.firebasestorage.app/firestore-backups/YYYY-MM-DD_HHmmss/
 *     ├── all_namespaces/
 *     │   ├── all_kinds/
 *     │   │   └── output-0
 *     │   └── ...
 *     └── metadata
 *
 * IAM prerequisite: the default App Engine service account
 * ({project}@appspot.gserviceaccount.com) already has project Editor role
 * on this project, which covers datastore.importExportAdmin + storage
 * permissions. If IAM gets tightened later, grant explicitly:
 *   - roles/datastore.importExportAdmin  (for export)
 *   - roles/storage.admin on the bucket  (for write + lifecycle cleanup)
 *
 * Region: asia-southeast1 (matches stack). Bucket location inherits from
 * the default Firebase Storage bucket (asia-southeast1 or wherever it
 * was initially provisioned).
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const firestoreLib = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

if (!admin.apps.length) admin.initializeApp();

const firestoreClient = new firestoreLib.v1.FirestoreAdminClient();
const storage = new Storage();

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
// Dedicated bucket for Firestore exports. MUST live in the same region as
// the Firestore database (asia-southeast3 / Jakarta) — Firestore Admin's
// exportDocuments rejects cross-region destinations. We can't reuse the
// default Firebase Storage bucket because that's in asia-southeast1
// (chosen for low-latency tenant uploads). Two-bucket setup is the official
// pattern recommended in Google's Firestore backup docs.
const BACKUP_BUCKET = `${PROJECT_ID}-firestore-backups`;
const BACKUP_BUCKET_LOCATION = 'asia-southeast3';
const PREFIX = 'firestore-backups';
const RETENTION_DAYS = 30;

function tsStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function ensureBackupBucket() {
  // Idempotent: create the dedicated backup bucket on first run so a fresh
  // checkout self-heals. Bucket lives in asia-southeast3 to match Firestore.
  // Storage Admin permission required (already granted to the default SA).
  const bucket = storage.bucket(BACKUP_BUCKET);
  const [exists] = await bucket.exists();
  if (exists) return BACKUP_BUCKET;

  console.log(`📦 Creating backup bucket gs://${BACKUP_BUCKET} in ${BACKUP_BUCKET_LOCATION}...`);
  await storage.createBucket(BACKUP_BUCKET, {
    location: BACKUP_BUCKET_LOCATION,
    storageClass: 'STANDARD'
  });
  console.log(`✅ Created bucket gs://${BACKUP_BUCKET}`);
  return BACKUP_BUCKET;
}

async function runBackup() {
  if (!PROJECT_ID) {
    throw new Error('GCLOUD_PROJECT / GCP_PROJECT env not set');
  }

  const bucketName = await ensureBackupBucket();
  const stamp = tsStamp();
  const outputUriPrefix = `gs://${bucketName}/${PREFIX}/${stamp}`;
  const databaseName = firestoreClient.databasePath(PROJECT_ID, '(default)');

  console.log(`📦 Starting Firestore export → ${outputUriPrefix}`);

  // exportDocuments is async — kicks off a long-running operation and
  // returns immediately. The operation finishes server-side in a few
  // minutes; we don't block the CF waiting.
  const [operation] = await firestoreClient.exportDocuments({
    name: databaseName,
    outputUriPrefix,
    collectionIds: []  // empty = all collections
  });
  console.log(`✅ Export operation queued: ${operation.name}`);

  // Prune old snapshots past retention window. Cheap: listFiles + delete.
  const pruned = await pruneOldBackups(bucketName);

  return {
    stamp,
    outputUriPrefix,
    operationName: operation.name,
    pruned
  };
}

async function pruneOldBackups(bucketName) {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let scanned = 0;

  try {
    const bucket = storage.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: `${PREFIX}/` });
    for (const file of files) {
      scanned++;
      const created = file.metadata?.timeCreated
        ? new Date(file.metadata.timeCreated).getTime()
        : 0;
      if (created && created < cutoffMs) {
        await file.delete({ ignoreNotFound: true });
        deleted++;
      }
    }
    if (deleted > 0) console.log(`🗑️ Pruned ${deleted}/${scanned} files older than ${RETENTION_DAYS}d`);
  } catch (e) {
    console.warn(`⚠️ Prune step failed (backup still succeeded): ${e.message}`);
  }

  return { scanned, deleted };
}

// ============================================================
// Scheduled — daily 03:00 BKK
// ============================================================
exports.backupFirestoreScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    try {
      const result = await runBackup();
      console.log('🗂️ Firestore backup complete:', JSON.stringify(result));
      return null;
    } catch (e) {
      console.error('backupFirestoreScheduled failed:', e);
      throw e;
    }
  });

// ============================================================
// HTTP — admin manual trigger
// POST https://asia-southeast1-<project>.cloudfunctions.net/backupFirestore
// ============================================================
exports.backupFirestore = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    try {
      const result = await runBackup();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('backupFirestore HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
