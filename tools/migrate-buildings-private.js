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
 * --include-empty (2026-05-23): also FieldValue.delete() fields whose value is "" (empty string)
 * at the top-level. The empty value is NOT copied to private/admin (nothing to copy); only the
 * top-level key is removed. Needed for buildings/rooms which had address:'' and contact:'' left
 * behind after the initial migration (the original filter skipped empty strings).
 *
 * Run (dry-run default):
 *   node tools/migrate-buildings-private.js                          # report only
 *   node tools/migrate-buildings-private.js --apply                  # move non-empty fields
 *   node tools/migrate-buildings-private.js --apply --include-empty  # full cleanup
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
const APPLY         = args.includes('--apply');
const INCLUDE_EMPTY = args.includes('--include-empty');
const HELP          = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log('Usage: node tools/migrate-buildings-private.js [--apply] [--include-empty]');
  console.log('');
  console.log('  (default)       Dry-run — report what would change without writing.');
  console.log('  --apply         Actually write. Idempotent — safe to re-run.');
  console.log('  --include-empty Also delete top-level fields whose value is "" (empty string).');
  console.log('                  Those fields are NOT copied to private/admin (nothing to copy);');
  console.log('                  only the top-level key is removed via FieldValue.delete().');
  console.log('');
  console.log('Typical one-shot:');
  console.log('  node tools/migrate-buildings-private.js              # dry-run');
  console.log('  node tools/migrate-buildings-private.js --apply --include-empty  # full cleanup');
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

  const modeLabel = [APPLY ? 'APPLY' : 'DRY-RUN', INCLUDE_EMPTY ? '+include-empty' : ''].filter(Boolean).join(' ');
  console.log(`Found ${snap.size} buildings/* doc(s). Mode: ${modeLabel}\n`);

  let movedCount   = 0;  // docs where non-empty fields were copied to private/admin
  let cleanedCount = 0;  // docs where empty-string fields were deleted (no copy)
  let skippedCount = 0;  // docs with nothing to do

  for (const doc of snap.docs) {
    const data = doc.data() || {};

    // Fields with real values: copy to private/admin AND delete from top-level.
    const presentWithValue = PRIVATE_FIELDS.filter(
      k => data[k] !== undefined && data[k] !== null && data[k] !== ''
    );

    // Fields that are empty strings: delete from top-level only (nothing to copy).
    // Only collected when --include-empty is passed.
    const presentEmpty = INCLUDE_EMPTY
      ? PRIVATE_FIELDS.filter(k => data[k] !== undefined && data[k] !== null && data[k] === '')
      : [];

    // All fields that need removing from top-level in this pass.
    const toDelete = [...presentWithValue, ...presentEmpty];

    if (toDelete.length === 0) {
      skippedCount++;
      console.log(`  • ${doc.id}: no top-level private fields to handle ✓`);
      continue;
    }

    if (presentWithValue.length > 0) {
      console.log(`  • ${doc.id}: will move [${presentWithValue.join(', ')}] → private/admin`);
      for (const k of presentWithValue) {
        const val = data[k];
        const masked = typeof val === 'string' && val.length > 0
          ? (k === 'ownerEmail'
              ? val.replace(/(.{2}).+@(.+)/, '$1***@$2')
              : (val.length > 20 ? val.slice(0, 12) + '…' : val))
          : String(val);
        console.log(`      ${k}: ${masked}`);
      }
    }

    if (presentEmpty.length > 0) {
      console.log(`  • ${doc.id}: will delete empty top-level [${presentEmpty.join(', ')}] (no data to copy)`);
    }

    if (APPLY) {
      try {
        // Step 1: write non-empty fields to private/admin (only if there's something to copy).
        if (presentWithValue.length > 0) {
          const privPayload = {};
          for (const k of presentWithValue) privPayload[k] = data[k];
          const privRef = doc.ref.collection('private').doc('admin');
          await privRef.set({
            ...privPayload,
            migratedAt: admin.firestore.FieldValue.serverTimestamp(),
            migratedFromTopLevel: presentWithValue
          }, { merge: true });
        }

        // Step 2: delete ALL matched fields from top-level (both non-empty + empty).
        const deletePatch = {};
        for (const k of toDelete) deletePatch[k] = admin.firestore.FieldValue.delete();
        await doc.ref.update(deletePatch);

        if (presentWithValue.length > 0) { movedCount++;   console.log(`      ✅ moved + deleted`); }
        if (presentEmpty.length > 0)     { cleanedCount++; console.log(`      ✅ empty fields deleted`); }
      } catch (e) {
        console.error(`      ❌ failed: ${e.message}`);
      }
    } else {
      // Dry-run counters
      if (presentWithValue.length > 0) movedCount++;
      if (presentEmpty.length > 0)     cleanedCount++;
    }
  }

  console.log('');
  console.log(`${APPLY ? 'Moved' : 'Would move'} (copy + delete): ${movedCount}`);
  if (INCLUDE_EMPTY) {
    console.log(`${APPLY ? 'Cleaned' : 'Would clean'} empty-string fields (delete only): ${cleanedCount}`);
  }
  console.log(`No-op (already migrated / nothing to do): ${skippedCount}`);
  if (!APPLY) {
    console.log('');
    console.log('Dry-run only. Re-run with --apply (and --include-empty) to write.');
  }

  process.exit(0);
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
