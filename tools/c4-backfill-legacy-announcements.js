/**
 * tools/c4-backfill-legacy-announcements.js
 *
 * C4 Session 1 prerequisite (2026-05-17). The new firestore.rules for
 * `announcements/{id}` requires `resource.data.audience` to match the tenant's
 * building (or be 'all'). Legacy banner docs in this collection were written
 * before C4 and use a `building` field instead of `audience`. Without this
 * backfill, tenant queries `where('audience', 'in', [...])` would silently
 * exclude legacy docs AND any UNFILTERED admin query containing a building-
 * mismatched legacy doc would be rejected with `permission-denied`.
 *
 * What it does:
 *   - Reads every doc in `announcements`
 *   - Skips docs that already have a `type` field (already C4-shaped)
 *   - For legacy docs:
 *       audience = doc.building || 'all'         (preserve targeting)
 *       type     = 'banner'                       (legacy was banner-only)
 *       sentAt   = doc.createdAt || Timestamp.now()   (preserve order)
 *   - Writes via merge:true — never overwrites existing fields
 *
 * DEFAULT: dry-run — prints what would be written, NO writes.
 * --apply: execute the merge writes.
 *
 * Auth: ADC (gcloud auth application-default login) OR service account JSON
 * at functions/serviceAccountKey.json.
 *
 * Usage:
 *   NODE_PATH=functions/node_modules node tools/c4-backfill-legacy-announcements.js
 *   NODE_PATH=functions/node_modules node tools/c4-backfill-legacy-announcements.js --apply
 *
 * Run AFTER:
 *   - functions/publishAnnouncement CF deployed
 *   - firestore.indexes.json deployed (composite type+audience+sentAt built)
 * Run BEFORE:
 *   - Tenant-side dual-read subscribers go live (Vercel deploy of tenant_app.html)
 *
 * Idempotent: safe to run multiple times. Subsequent runs do nothing (every
 * doc has `type` after first apply).
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DRY_RUN = !process.argv.includes('--apply');
const PROJECT_ID = 'the-green-haven';

function init() {
  if (admin.apps.length) return;
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

async function main() {
  init();
  const db = admin.firestore();

  console.log(`\n=== c4-backfill-legacy-announcements ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const snap = await db.collection('announcements').get();
  console.log(`Read ${snap.size} doc(s) from announcements/\n`);

  let alreadyMigrated = 0;
  let toBackfill = 0;
  let skipped = 0;
  const plan = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (data.type) {
      alreadyMigrated++;
      continue;
    }

    // Legacy doc: build the merge payload
    const audience = data.building || 'all';
    const validAudiences = new Set(['all', 'rooms', 'nest']);
    if (!validAudiences.has(audience)) {
      console.warn(`  SKIP ${docSnap.id}: legacy building=${JSON.stringify(audience)} not in {all,rooms,nest}; manual review needed`);
      skipped++;
      continue;
    }

    const payload = {
      type: 'banner',
      audience,
    };
    // Map legacy fields onto C4 schema for forward-compat (idempotent merge).
    if (data.content && !data.body) payload.body = data.content;
    if (data.createdAt && !data.sentAt) {
      // createdAt was ISO string; convert to Firestore Timestamp.
      const ms = Date.parse(data.createdAt);
      if (Number.isFinite(ms)) {
        payload.sentAt = admin.firestore.Timestamp.fromMillis(ms);
      }
    }
    if (!data.status) payload.status = 'published';

    plan.push({ id: docSnap.id, currentBuilding: data.building, payload });
    toBackfill++;
  }

  console.log(`Plan: ${toBackfill} doc(s) to backfill, ${alreadyMigrated} already C4-shaped, ${skipped} skipped.\n`);

  if (toBackfill === 0) {
    console.log('Nothing to do. Exit.');
    return;
  }

  for (const item of plan) {
    console.log(`  ${item.id}: building=${item.currentBuilding} → audience=${item.payload.audience}, type=banner`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN — no writes performed. Re-run with --apply to commit.');
    return;
  }

  console.log('\nApplying merges...');
  let written = 0;
  for (const item of plan) {
    await db.collection('announcements').doc(item.id).set(item.payload, { merge: true });
    written++;
  }
  console.log(`\nWrote ${written} merge(s). Done.`);
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
