/**
 * Archive slipVerificationLog from Firestore → BigQuery.
 *
 * Why: slipVerificationLog grows ~2 MB/year. Storing audit logs in Firestore
 * costs ~7x more than BigQuery ($0.18/GB vs $0.02/GB per month) and Firestore
 * doc reads are charged per-query while BigQuery charges per-byte-scanned.
 * At year 5+ the delta starts to matter; this CF moves docs > 90 days old
 * out of Firestore into BigQuery so hot storage stays small.
 *
 * BigQuery destination:
 *   dataset: audit_archive (auto-created on first run)
 *   table:   slip_verification (auto-created, schema matches Firestore doc)
 *
 * Triggers:
 *   - Scheduled: daily 02:00 BKK (cron '0 19 * * *' UTC)
 *   - HTTP: POST to manually run or backfill
 *
 * Safety:
 *   - Firestore docs are deleted ONLY after BigQuery insert returns success.
 *     If BQ fails, docs stay in Firestore and next run retries.
 *   - Batch limit 500 docs/run → bounded cost + rollback-able per run.
 *
 * IAM required on the default service account
 *   ({PROJECT_ID}@appspot.gserviceaccount.com):
 *     - BigQuery Admin (needed so CF can create dataset/table on first run;
 *       after initial setup you may downgrade to BigQuery Data Editor).
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
const TABLE_ID = 'slip_verification';
const DATASET_LOCATION = 'asia-southeast1';
const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;

// Schema matches slipVerificationLog Firestore shape (functions/verifySlip.js:216).
// Each field NULLABLE because old docs may be missing fields added later.
const TABLE_SCHEMA = [
  { name: 'docId', type: 'STRING', mode: 'REQUIRED' },
  { name: 'status', type: 'STRING', mode: 'NULLABLE' },
  { name: 'building', type: 'STRING', mode: 'NULLABLE' },
  { name: 'room', type: 'STRING', mode: 'NULLABLE' },
  { name: 'userId', type: 'STRING', mode: 'NULLABLE' },
  { name: 'expectedAmount', type: 'FLOAT', mode: 'NULLABLE' },
  { name: 'verifiedAmount', type: 'FLOAT', mode: 'NULLABLE' },
  { name: 'transactionId', type: 'STRING', mode: 'NULLABLE' },
  { name: 'slipSender', type: 'STRING', mode: 'NULLABLE' },
  { name: 'slipDate', type: 'STRING', mode: 'NULLABLE' },
  { name: 'error', type: 'STRING', mode: 'NULLABLE' },
  { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'ipAddress', type: 'STRING', mode: 'NULLABLE' },
  { name: 'userAgent', type: 'STRING', mode: 'NULLABLE' },
  { name: 'archivedAt', type: 'TIMESTAMP', mode: 'REQUIRED' }
];

/**
 * Idempotent: create dataset + table if they don't exist.
 * Runs every invocation so a fresh GCP project self-heals without manual setup.
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
      timePartitioning: { type: 'DAY', field: 'timestamp' }  // cheaper per-day scans
    });
    console.log(`📋 Created BigQuery table: ${DATASET_ID}.${TABLE_ID}`);
  }
}

/**
 * Core archive logic. Returns { scanned, inserted, deleted } for observability.
 */
async function runArchive() {
  await ensureBigQueryTable();

  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs);

  const snapshot = await firestore.collection('slipVerificationLog')
    .where('timestamp', '<', cutoff)
    .orderBy('timestamp', 'asc')
    .limit(BATCH_SIZE)
    .get();

  if (snapshot.empty) {
    console.log('✓ No slip logs older than 90 days. Nothing to archive.');
    return { scanned: 0, inserted: 0, deleted: 0 };
  }

  const rows = snapshot.docs.map(d => {
    const data = d.data();
    const ts = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
    return {
      docId: d.id,
      status: data.status || null,
      building: data.building || null,
      room: data.room || null,
      userId: data.userId || null,
      expectedAmount: typeof data.expectedAmount === 'number' ? data.expectedAmount : null,
      verifiedAmount: typeof data.verifiedAmount === 'number' ? data.verifiedAmount : null,
      transactionId: data.transactionId || null,
      slipSender: data.slipSender || null,
      slipDate: data.slipDate || null,
      error: data.error || null,
      timestamp: ts.toISOString(),
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      archivedAt: new Date().toISOString()
    };
  });

  // Insert into BigQuery. If this throws, the catch below aborts BEFORE any
  // Firestore delete runs — docs remain in place and next run retries.
  await bigquery.dataset(DATASET_ID).table(TABLE_ID).insert(rows);
  console.log(`✅ Inserted ${rows.length} rows into BigQuery ${DATASET_ID}.${TABLE_ID}`);

  // Only after successful BQ insert do we delete from Firestore.
  // Batch limit is 500 operations — matches BATCH_SIZE.
  const batch = firestore.batch();
  snapshot.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  console.log(`🗑️ Deleted ${snapshot.size} archived docs from Firestore`);

  return { scanned: snapshot.size, inserted: rows.length, deleted: snapshot.size };
}

// ============================================================
// Scheduled — daily 02:00 BKK
// ============================================================
exports.archiveSlipLogsScheduled = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 2 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async (context) => {
    try {
      const result = await runArchive();
      console.log('🗂️ Slip log archive done:', result);
      return null;
    } catch (e) {
      console.error('archiveSlipLogsScheduled failed:', e);
      throw e;  // Cloud Functions retry policy handles next attempt
    }
  });

// ============================================================
// HTTP — for manual trigger during initial deploy / debugging
// POST https://asia-southeast1-<project>.cloudfunctions.net/archiveSlipLogs
// Protect with Firebase Auth admin check (matches verifySlip pattern).
// ============================================================
exports.archiveSlipLogs = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    // Allow CORS for admin dashboard invocation
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    try {
      const result = await runArchive();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.error('archiveSlipLogs HTTP failed:', e);
      return res.status(500).json({ error: e.message });
    }
  });
