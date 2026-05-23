#!/usr/bin/env node
/**
 * migrate-buildings-private.js — one-shot migration for P4.4 (2026-05-23).
 *
 * Moves sensitive admin-only fields from `buildings/{id}` (signed-in-readable)
 * into `buildings/{id}/private/admin` subdoc (admin-only-readable) so they
 * no longer leak to booking-anonymous prospects and signed-in tenants.
 *
 * Fields moved: address, contact, ownerEmail.
 *
 * Flow:
 *   1. List every buildings/{id} doc.
 *   2. For each, copy any of {address, contact, ownerEmail} into
 *      `buildings/{id}/private/admin` (setDoc merge).
 *   3. Then FieldValue.delete() those keys from the top-level doc.
 *
 * Idempotent: re-running on already-migrated docs is a no-op (no fields to
 * move, FieldValue.delete on missing keys is harmless).
 *
 * Run (dry-run default):
 *   node tools/migrate-buildings-private.js              # report only, no writes
 *   node tools/migrate-buildings-private.js --apply       # actually write
 *
 * Auth source: same priority as grant-admin-claim.js (GOOGLE_APPLICATION_CREDENTIALS,
 * functions/.runtime-credentials.json, then ADC).
 *
 * IMPORTANT: run AFTER firestore.rules with the new private/admin match is
 * deployed — the admin SDK bypasses rules so the script can write the
 * subcollection before deploy, but the dashboard reader expects the subdoc
 * to exist with the admin rule already serving.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log('Usage: node tools/migrate-buildings-private.js [--apply]');
  console.log('');
  console.log('  (default)  Dry-run — report what would change without writing.');
  console.log('  --apply    Actually move fields. Idempotent — safe to re-run.');
  process.exit(0);
}

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const projectId = 'the-green-haven';
let initOpts = { projectId };

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initOpts.credential = admin.credential.applicationDefault();
} else {
  const candidates = [
    path.join(__dirname, '..', 'functions', '.runtime-credentials.json'),
    path.join(__dirname, '..', '.runtime-credentials.json')
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (found) {
    initOpts.credential = admin.credential.cert(require(found));
  } else {
    initOpts.credential = admin.credential.applicationDefault();
  }
}

admin.initializeApp(initOpts);

const PRIVATE_FIELDS = ['address', 'contact', 'ownerEmail'];

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('buildings').get();

  if (snap.empty) {
    console.log('ℹ️  No buildings/* docs found — nothing to migrate.');
    process.exit(0);
  }

  console.log(`Found ${snap.size} buildings/* doc(s). Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  let movedCount = 0;
  let alreadyMigratedCount = 0;
  let untouchedCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const present = PRIVATE_FIELDS.filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '');

    if (present.length === 0) {
      untouchedCount++;
      console.log(`  • ${doc.id}: no private fields at top-level (already migrated or never set) ✓`);
      continue;
    }

    const privPayload = {};
    for (const k of present) privPayload[k] = data[k];

    console.log(`  • ${doc.id}: will move [${present.join(', ')}] to private/admin`);
    for (const k of present) {
      const val = data[k];
      const masked = typeof val === 'string' && val.length > 0
        ? (k === 'ownerEmail'
            ? val.replace(/(.{2}).+@(.+)/, '$1***@$2')
            : (val.length > 20 ? val.slice(0, 12) + '…' : val))
        : String(val);
      console.log(`      ${k}: ${masked}`);
    }

    if (APPLY) {
      try {
        // Step 1: write to private/admin (merge)
        const privRef = doc.ref.collection('private').doc('admin');
        await privRef.set({
          ...privPayload,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          migratedFromTopLevel: present
        }, { merge: true });

        // Step 2: delete from top-level
        const deletePatch = {};
        for (const k of present) deletePatch[k] = admin.firestore.FieldValue.delete();
        await doc.ref.update(deletePatch);

        movedCount++;
        console.log(`      ✅ moved`);
      } catch (e) {
        console.error(`      ❌ failed: ${e.message}`);
      }
    } else {
      movedCount++; // counted as "would move" in dry-run
    }
  }

  console.log('');
  console.log(`${APPLY ? 'Moved' : 'Would move'}: ${movedCount}`);
  console.log(`Already migrated (no top-level private fields): ${untouchedCount}`);
  if (!APPLY) {
    console.log('');
    console.log('Dry-run only. Re-run with --apply to write.');
  }

  process.exit(0);
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
