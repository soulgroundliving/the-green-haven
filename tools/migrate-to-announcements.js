/**
 * tools/migrate-to-announcements.js
 *
 * C4 Session 2 data migration (2026-05-18). Reads legacy collections
 * `broadcastMessages/{id}` and `communityEvents/{id}` and writes equivalent
 * `announcements/{sameId}` docs with the unified schema:
 *
 *   broadcastMessages → announcements (type='notice')
 *   communityEvents   → announcements (type='event')
 *
 * Doc IDs are preserved across the migration so the script is idempotent —
 * a doc already present in `announcements/` with a `migratedAt` field is
 * skipped on re-run.
 *
 * Legacy `announcements/{id}` banner docs are NOT touched here — they were
 * already handled by `tools/c4-backfill-legacy-announcements.js` in S1.
 *
 * DEFAULT: dry-run — prints what would be written, NO writes.
 * --apply: execute the .set() writes.
 *
 * Auth: ADC (gcloud auth application-default login) OR service account JSON
 * at functions/serviceAccountKey.json.
 *
 * Usage:
 *   NODE_PATH=functions/node_modules node tools/migrate-to-announcements.js
 *   NODE_PATH=functions/node_modules node tools/migrate-to-announcements.js --apply
 *
 * Run AFTER:
 *   - C4 Session 1 deployed (publishAnnouncement CF + composite index + rule)
 *   - c4-backfill-legacy-announcements.js --apply (legacy banners shaped)
 * Run BEFORE:
 *   - C4 Session 2 tenant/admin code flip (drops legacy reads)
 *
 * Idempotent: safe to run multiple times. Migrated docs carry `migratedAt`;
 * subsequent runs skip them.
 */

'use strict';

const BUILDING_ALIASES = {
  'rooms':    'rooms',
  'old':      'rooms',
  'RentRoom': 'rooms',
  'nest':     'nest',
  'new':      'nest',
  'all':      'all',
};

const VALID_AUDIENCES = new Set(['all', 'rooms', 'nest']);
const MIGRATION_SENDER = { uid: 'migration', email: 'migration@thegreenhaven' };

/**
 * Coerce a legacy `building` value to a canonical C4 `audience`.
 * Unknown values fall through to 'all' (pre-C4 events were public).
 * Returns { audience, warning } — warning is non-empty when fallback fired.
 */
function normalizeAudience(rawBuilding) {
  if (rawBuilding == null || rawBuilding === '') return { audience: 'all', warning: '' };
  const aliased = BUILDING_ALIASES[rawBuilding];
  if (aliased && VALID_AUDIENCES.has(aliased)) return { audience: aliased, warning: '' };
  if (VALID_AUDIENCES.has(rawBuilding)) return { audience: rawBuilding, warning: '' };
  return {
    audience: 'all',
    warning: `unknown building=${JSON.stringify(rawBuilding)} → fallback to 'all'`,
  };
}

/**
 * Build the announcements/{id} payload for a legacy broadcastMessages doc.
 * Broadcast docs were CF-written (Tier 1A) so most fields are already canonical.
 *
 * @param {object} legacy - the broadcastMessages doc data
 * @param {object} TimestampCtor - the Firestore Timestamp constructor (for `migratedAt`)
 * @returns {object} the payload + warnings array
 */
function buildNoticePayload(legacy, TimestampCtor) {
  const data = legacy || {};
  const warnings = [];
  const { audience, warning } = normalizeAudience(data.audience);
  if (warning) warnings.push(`audience: ${warning}`);

  const payload = {
    type: 'notice',
    title: typeof data.title === 'string' ? data.title : '',
    body:  typeof data.body  === 'string' ? data.body  : '',
    audience,
    sender: data.sender || MIGRATION_SENDER,
    sentAt: data.sentAt || null,
    status: data.status || 'published',
    migratedAt: TimestampCtor ? TimestampCtor.now() : new Date(),
  };
  if (!payload.sentAt) warnings.push('sentAt missing — left null, client falls back to migratedAt');
  return { payload, warnings };
}

/**
 * Build the announcements/{id} payload for a legacy communityEvents doc.
 * Legacy events have YYYY-MM-DD `date` + HH:MM `time` + `description` +
 * `building` — these map to `eventDate` Timestamp + `body` + `audience`.
 *
 * @param {object} legacy - the communityEvents doc data
 * @param {object} TimestampCtor - the Firestore Timestamp constructor
 * @returns {object} the payload + warnings array
 */
function buildEventPayload(legacy, TimestampCtor) {
  const data = legacy || {};
  const warnings = [];
  const { audience, warning } = normalizeAudience(data.building);
  if (warning) warnings.push(`audience: ${warning}`);

  const tsFromMs = (ms) => {
    if (!Number.isFinite(ms)) return null;
    if (TimestampCtor && typeof TimestampCtor.fromMillis === 'function') {
      return TimestampCtor.fromMillis(ms);
    }
    return new Date(ms);
  };

  let eventDate = null;
  if (data.date) {
    const time = (data.time && /^\d{2}:\d{2}/.test(data.time)) ? data.time : '00:00';
    const ms = Date.parse(`${data.date}T${time}`);
    if (Number.isFinite(ms)) {
      eventDate = tsFromMs(ms);
    } else {
      warnings.push(`eventDate parse failed for date=${JSON.stringify(data.date)} time=${JSON.stringify(data.time)}`);
    }
  } else {
    warnings.push('legacy event has no date field');
  }

  // sentAt = when this announcement was published. For legacy events, the only
  // honest sources are createdDate / createdAt. Do NOT fall back to data.date —
  // that's the EVENT happening date, and using it would push future events to
  // the top of the bell. If both are missing, fall back to eventDate as a
  // rough approximation; the client renderer is NaN-safe regardless.
  let sentAt = null;
  const sentSource = data.createdDate || data.createdAt;
  if (sentSource) {
    const ms = Date.parse(typeof sentSource === 'string' ? sentSource : '');
    if (Number.isFinite(ms)) sentAt = tsFromMs(ms);
  }
  if (!sentAt && eventDate) sentAt = eventDate;

  const payload = {
    type: 'event',
    title: typeof data.title === 'string' ? data.title : '',
    body:  typeof data.description === 'string' && data.description
      ? data.description
      : (typeof data.title === 'string' ? data.title : ''),
    audience,
    sender: MIGRATION_SENDER,
    sentAt,
    status: 'published',
    eventDate,
    location: typeof data.location === 'string' ? data.location : '',
    migratedAt: TimestampCtor ? TimestampCtor.now() : new Date(),
  };
  return { payload, warnings };
}

/**
 * Migrate one legacy collection in-place. Returns counts + warnings.
 *
 * @param {object} args
 * @param {string} args.legacyCollection - 'broadcastMessages' or 'communityEvents'
 * @param {(legacy, ts) => {payload, warnings}} args.buildPayload
 * @param {object} args.db - Admin SDK firestore() instance
 * @param {object} args.TimestampCtor - admin.firestore.Timestamp
 * @param {boolean} args.dryRun
 */
async function migrateCollection({ legacyCollection, buildPayload, db, TimestampCtor, dryRun }) {
  const legacySnap = await db.collection(legacyCollection).get();
  let toMigrate = 0;
  let alreadyMigrated = 0;
  let written = 0;
  const warnings = [];
  const plan = [];

  for (const docSnap of legacySnap.docs) {
    const id = docSnap.id;
    const targetSnap = await db.collection('announcements').doc(id).get();
    if (targetSnap.exists && targetSnap.data() && targetSnap.data().migratedAt) {
      alreadyMigrated++;
      continue;
    }
    const { payload, warnings: docWarnings } = buildPayload(docSnap.data(), TimestampCtor);
    if (docWarnings.length) {
      warnings.push({ id, warnings: docWarnings });
    }
    plan.push({ id, payload });
    toMigrate++;
  }

  console.log(`  ${legacyCollection}: ${legacySnap.size} legacy, ${alreadyMigrated} already migrated, ${toMigrate} to migrate`);
  if (warnings.length) {
    console.log(`  ⚠️  ${warnings.length} doc(s) had warnings:`);
    for (const w of warnings) {
      console.log(`     ${w.id}: ${w.warnings.join('; ')}`);
    }
  }

  if (!dryRun) {
    for (const item of plan) {
      await db.collection('announcements').doc(item.id).set(item.payload);
      written++;
    }
    console.log(`  ✅ wrote ${written} doc(s) to announcements/`);
  }

  return { legacySize: legacySnap.size, alreadyMigrated, toMigrate, written, warnings };
}

async function main() {
  const path = require('path');
  const fs = require('fs');
  const admin = require('firebase-admin');

  const DRY_RUN = !process.argv.includes('--apply');
  const PROJECT_ID = 'the-green-haven';

  if (!admin.apps.length) {
    const saPath = path.join(__dirname, '..', 'functions', 'serviceAccountKey.json');
    if (fs.existsSync(saPath)) {
      admin.initializeApp({
        credential: admin.credential.cert(require(saPath)),
        projectId: PROJECT_ID,
      });
    } else {
      admin.initializeApp({ projectId: PROJECT_ID });
    }
  }

  const db = admin.firestore();
  const TimestampCtor = admin.firestore.Timestamp;

  console.log(`\n=== migrate-to-announcements ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  console.log('Phase 1 — broadcastMessages → announcements (type=notice)');
  const p1 = await migrateCollection({
    legacyCollection: 'broadcastMessages',
    buildPayload: buildNoticePayload,
    db, TimestampCtor, dryRun: DRY_RUN,
  });

  console.log('\nPhase 2 — communityEvents → announcements (type=event)');
  const p2 = await migrateCollection({
    legacyCollection: 'communityEvents',
    buildPayload: buildEventPayload,
    db, TimestampCtor, dryRun: DRY_RUN,
  });

  console.log('\n=== Report ===');
  console.log(`  Phase 1: ${p1.toMigrate} to migrate (${p1.alreadyMigrated} already done; ${p1.warnings.length} warnings)`);
  console.log(`  Phase 2: ${p2.toMigrate} to migrate (${p2.alreadyMigrated} already done; ${p2.warnings.length} warnings)`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — no writes performed. Re-run with --apply to commit.');
  } else {
    console.log(`\n✅ Wrote ${p1.written + p2.written} total doc(s) to announcements/`);
  }
}

// Exported for unit tests; run main() only when invoked directly.
module.exports = {
  normalizeAudience,
  buildNoticePayload,
  buildEventPayload,
  migrateCollection,
  BUILDING_ALIASES,
  VALID_AUDIENCES,
  MIGRATION_SENDER,
};

if (require.main === module) {
  main().catch(err => {
    console.error('FAIL:', err);
    process.exit(1);
  });
}
