/**
 * Archive auth_events from Firestore → BigQuery (immutable audit log).
 *
 * Why: auth_events is the failed-login audit trail (Phase 4B). Firestore
 * rules block client update/delete, but admin SDK bypasses rules — meaning
 * a compromised admin or a malicious CF could erase login history before
 * a forensics review. Moving rows older than 90 days into BigQuery with
 * restricted-write IAM (BigQuery Data Editor, NO delete permission) makes
 * the cold copy tamper-resistant even against insider threats.
 *
 * BigQuery destination:
 *   dataset: audit_archive (shared with archiveSlipLogs; auto-created)
 *   table:   auth_events (auto-created; matches Firestore rule schema)
 *
 * Triggers:
 *   - Scheduled: daily 02:30 BKK (offset from archiveSlipLogs at 02:00)
 *   - HTTP: POST to manually run / backfill (admin-gated)
 *
 * Safety:
 *   - Firestore docs are deleted ONLY after BigQuery insert returns success.
 *     If BQ fails, docs stay in Firestore and next run retries.
 *   - Batch limit 500 docs/run.
 *
 * IAM (post-launch hardening — see docs/SECURITY_AUDIT_2026_04_28.md P2.6):
 *   - {PROJECT_ID}@appspot.gserviceaccount.com keeps BigQuery Data Editor
 *     on dataset audit_archive (write only — NO delete on the table).
 *   - This means even if the same service account is later abused via a
 *     compromised CF, it cannot rewrite history.
 *
 * Region: asia-southeast1 (matches rest of project)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { BigQuery } = require('@google-cloud/bigquery');

if (!admin.apps.length) {
  admin.initializeApp();
}
const firestore = admin.firestore();
const bigquery = new BigQuery();

const DATASET_ID = 'audit_archive';
const TABLE_ID = 'auth_events';
const DATASET_LOCATION = 'asia-southeast1';
const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;

// Schema matches firestore.rules auth_events constraint (4 fields + size caps).
// docId added so each archived row is traceable back to the original write.
// archivedAt added for cold-storage observability.
const TABLE_SCHEMA = [
  { name: 'docId', type: 'STRING', mode: 'REQUIRED' },
  { name: 'maskedEmail', type: 'STRING', mode: 'NULLABLE' },
  { name: 'ua', type: 'STRING', mode: 'NULLABLE' },
  { name: 'errorCode', type: 'STRING', mode: 'NULLABLE' },
  { name: 'ts', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'archivedAt', type: 'TIMESTAMP', mode: 'REQUIRED' }
];

/**
 * Idempotent: create dataset + table if they don't exist.
 */
async function ensureBigQueryTable() {
  const dataset = bigquery.dataset(DATASET_ID);
  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await bigquery.createDataset(DATASET_ID, { location: DATASET_LOCATION });
    console.log(`📦 Created BigQuery dataset: ${DATASET_ID}`);
  }

  const table = dataset.table(TABLE_ID);
  const [tableExists] = await table.exists();
  if (!tableExists) {
    await dataset.createTable(TABLE_ID, {
      schema: { fields: TABLE_SCHEMA },
      timePartitioning: { type: 'DAY', field: 'ts' }
    });
    console.log(`📋 Created BigQuery table: ${DATASET_ID}.${TABLE_ID}`);
  }
}

/**
 * Core archive logic. Returns { scanned, inserted, deleted } for observability.
 *
 * Filters: ts < (now - 90 days). The auth_events doc shape uses `ts` (the
 * Firestore-rules contract field, not `timestamp`).
 */
async function runArchive() {
  await ensureBigQueryTable();

  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);

  const snapshot = await firestore.collection('auth_events')
    .where('ts', '<', cutoff)
    .orderBy('ts', 'asc')
    .limit(BATCH_SIZE)
    .get();

  if (snapshot.empty) {
    console.log('✓ No auth_events older than 90 days. Nothing to archive.');
    return { scanned: 0, inserted: 0, deleted: 0 };
  }

  const rows = snapshot.docs.map(d => {
    const data = d.data();
    const ts = data.ts?.toDate ? data.ts.toDate() : new Date(data.ts);
    return {
      docId: d.id,
      maskedEmail: data.maskedEmail || null,
      ua: data.ua || null,
      errorCode: data.errorCode || null,
      ts: ts.toISOString(),
      archivedAt: new Date().toISOString()
    };
  });

  // Insert into BigQuery first. Throws → catch aborts BEFORE Firestore
  // delete runs. Docs stay in place for next-run retry.
  await bigquery.dataset(DATASET_ID).table(TABLE_ID).insert(rows);
  console.log(`✅ Inserted ${rows.length} rows into BigQuery ${DATASET_ID}.${TABLE_ID}`);

  // Only after successful BQ insert do we delete from Firestore. Admin SDK
  // bypasses the rules `allow delete: if false`, which is intentional —
  // the CF needs to free hot storage. The point is that AFTER this delete,
  // the BigQuery copy with restricted-write IAM is the only remaining
  // record, and it can't be tampered with by a compromised admin.
  const batch = firestore.batch();
  snapshot.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  console.log(`🗑️ Deleted ${snapshot.size} archived docs from Firestore`);

  return { scanned: snapshot.size, inserted: rows.length, deleted: snapshot.size };
}

// ============================================================
// Scheduled — daily 02:30 BKK (offset 30 min from archiveSlipLogs)
// ============================================================
exports.archiveAuthEventsScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('30 2 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async (context) => {
    try {
      const result = await runArchive();
      console.log('🗂️ auth_events archive done:', result);
      return null;
    } catch (e) {
      console.error('archiveAuthEventsScheduled failed:', e);
      throw e;
    }
  });

// ============================================================
// HTTP — manual trigger / backfill. Admin-gated.
// POST https://asia-southeast1-<project>.cloudfunctions.net/archiveAuthEvents
// ============================================================
exports.archiveAuthEvents = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const { requireAdmin } = require('./_auth');
    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    try {
      const result = await runArchive();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('archiveAuthEvents HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
