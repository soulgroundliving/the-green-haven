#!/usr/bin/env node
/**
 * cleanup-orphan-pet-storage.js — one-shot scan of Storage for orphan pet files.
 *
 * Background:
 *   Pet uploads land at storage://pets/{building}/{roomId}/{petId}/{file}.
 *   Before commit `<this-sprint>`, no lifecycle CF touched Storage, so every
 *   archive/transition/admin-remove orphaned the photo + vaccine book files.
 *   They accumulated forever (quota cost + PDPA retention concern).
 *
 *   Going forward: archiveTenantOnMoveOut + deletePetMedia (Phase A/B of the
 *   same sprint) clean Storage symmetrically. This script handles the EXISTING
 *   backlog from past archives.
 *
 * Definition of orphan (must match ALL):
 *   1. File lives at pets/{b}/{r}/{petId}/* in Storage
 *   2. NO Firestore doc exists at tenants/{b}/list/{r}/pets/{petId}
 *      (the LIVE path only — archive subcollection docs do NOT count as
 *      referenced, because their photoURL/vaccineBookURL tokens are tied
 *      to files we want to delete. PDPA: archive metadata stays; the
 *      personal-data binaries should not outlive the tenancy.)
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — prints orphan table + total bytes, NO deletes.
 * - --apply: executes deletes (per §7-I user-triggered).
 * - PRE-FLIGHT (always runs):
 *     1. Storage list MUST return >0 files OR the script aborts (likely
 *        IAM misconfig — better to bail than report "everything's clean")
 *     2. Firestore live-path query MUST succeed (network/permission check)
 *     3. Each orphan group sized + counted before any delete
 * - Recovery: Storage delete is irreversible. Run dry-run first, eyeball
 *   the output, only then re-run with --apply.
 *
 * Auth (mirrors tools/backfill-liff-claims.js):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var
 *   2. functions/.runtime-credentials.json (gitignored)
 *   3. ADC via `gcloud auth application-default login`
 *
 * Usage:
 *   # Preview (default — no writes):
 *   node tools/cleanup-orphan-pet-storage.js
 *
 *   # Execute deletes:
 *   node tools/cleanup-orphan-pet-storage.js --apply
 *
 *   # Limit scan + delete to a single building:
 *   node tools/cleanup-orphan-pet-storage.js --building rooms
 */

'use strict';

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const verbose = args.includes('--verbose') || args.includes('-v');
const buildingArgIdx = args.indexOf('--building');
const buildingFilter = buildingArgIdx >= 0 ? args[buildingArgIdx + 1] : null;

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const projectId = 'the-green-haven';
let initOpts = { projectId };
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  initOpts.credential = admin.credential.applicationDefault();
} else {
  const candidates = [
    path.join(__dirname, '..', 'functions', '.runtime-credentials.json'),
    path.join(__dirname, '..', '.runtime-credentials.json'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    initOpts.credential = admin.credential.cert(require(found));
  } else {
    initOpts.credential = admin.credential.applicationDefault();
  }
}
initOpts.storageBucket = `${projectId}.appspot.com`;
admin.initializeApp(initOpts);

const firestore = admin.firestore();
const bucket = admin.storage().bucket();

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/**
 * Parse a Storage object name `pets/{b}/{r}/{petId}/{file}` →
 * { building, room, petId } or null if shape is wrong.
 */
function parsePetPath(name) {
  const parts = name.split('/');
  if (parts.length < 5) return null;
  if (parts[0] !== 'pets') return null;
  return {
    building: parts[1],
    room: parts[2],
    petId: parts[3],
  };
}

function keyOf(building, room, petId) {
  return `${building}/${room}/${petId}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`cleanup-orphan-pet-storage.js — ${apply ? 'APPLY MODE' : 'DRY-RUN'}` +
    (buildingFilter ? ` (building=${buildingFilter})` : ''));
  console.log('────────────────────────────────────────────────────────────────');

  // ── Step 1: list Storage ────────────────────────────────────────────────
  const prefix = buildingFilter ? `pets/${buildingFilter}/` : 'pets/';
  console.log(`[step 1/4] Listing Storage under ${prefix} ...`);
  const [files] = await bucket.getFiles({ prefix });
  if (!files.length) {
    console.log(`No files under ${prefix}. Either the bucket is empty or IAM blocks listing.`);
    console.log('If you expected files, check:');
    console.log('  - GOOGLE_APPLICATION_CREDENTIALS / Application Default Credentials');
    console.log('  - The service account has roles/storage.objectViewer + roles/storage.objectAdmin');
    process.exit(0);
  }
  console.log(`  → ${files.length} files total`);

  // Group by petId
  const byPet = new Map();   // key → { building, room, petId, files: [], bytes: 0 }
  const malformed = [];      // names that don't match pets/{b}/{r}/{pid}/{f}
  for (const f of files) {
    const parsed = parsePetPath(f.name);
    if (!parsed) {
      malformed.push(f.name);
      continue;
    }
    const k = keyOf(parsed.building, parsed.room, parsed.petId);
    let entry = byPet.get(k);
    if (!entry) {
      entry = { ...parsed, files: [], bytes: 0 };
      byPet.set(k, entry);
    }
    entry.files.push(f);
    // size is on f.metadata.size as string OR f.metadata.contentLength on some versions
    const sizeRaw = f.metadata?.size ?? f.metadata?.contentLength ?? 0;
    entry.bytes += Number(sizeRaw) || 0;
  }
  if (malformed.length) {
    console.warn(`  ⚠ ${malformed.length} malformed paths skipped (not pets/{b}/{r}/{pid}/{f}):`);
    malformed.slice(0, 5).forEach((n) => console.warn(`     ${n}`));
    if (malformed.length > 5) console.warn(`     ... (${malformed.length - 5} more)`);
  }
  console.log(`  → ${byPet.size} unique pet groups`);

  // ── Step 2: query live Firestore pets ───────────────────────────────────
  console.log(`[step 2/4] Querying Firestore collectionGroup('pets') for LIVE references ...`);
  const cgSnap = await firestore.collectionGroup('pets').get();
  const referenced = new Set();
  let liveCount = 0;
  let archivedSkipped = 0;
  for (const d of cgSnap.docs) {
    const parts = d.ref.path.split('/');
    // tenants/{b}/list/{r}/pets/{pid} → parts[2] === 'list'
    // tenants/{b}/archive/{cid}/pets/{pid} → parts[2] === 'archive' (skip — orphan-able)
    if (parts[2] !== 'list') {
      archivedSkipped++;
      continue;
    }
    const b = parts[1];
    const r = parts[3];
    const pid = d.id;
    referenced.add(keyOf(b, r, pid));
    liveCount++;
  }
  console.log(`  → ${liveCount} live pet docs referenced, ${archivedSkipped} archived pets skipped (treated as orphan candidates)`);

  // ── Step 3: compute orphans ─────────────────────────────────────────────
  console.log(`[step 3/4] Computing orphans ...`);
  const orphans = [];   // { building, room, petId, files, bytes }
  let referencedBytes = 0;
  let referencedFiles = 0;
  for (const [k, entry] of byPet.entries()) {
    if (referenced.has(k)) {
      referencedBytes += entry.bytes;
      referencedFiles += entry.files.length;
    } else {
      orphans.push(entry);
    }
  }
  orphans.sort((a, b) => b.bytes - a.bytes); // largest first

  const orphanBytes = orphans.reduce((s, o) => s + o.bytes, 0);
  const orphanFiles = orphans.reduce((s, o) => s + o.files.length, 0);

  console.log('');
  console.log('Summary');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  Live (referenced):  ${referencedFiles} files, ${fmtBytes(referencedBytes)}`);
  console.log(`  Orphan:             ${orphanFiles} files in ${orphans.length} pet groups, ${fmtBytes(orphanBytes)}`);
  console.log('');

  if (!orphans.length) {
    console.log('No orphans found. Nothing to do.');
    process.exit(0);
  }

  // ── Preview table (top 20 by size) ──────────────────────────────────────
  console.log('Orphan groups (top 20 by size):');
  console.log('  building/room/petId                                            files    size');
  console.log('  ────────────────────────────────────────────────────────────  ─────  ───────');
  for (const o of orphans.slice(0, 20)) {
    const key = `${o.building}/${o.room}/${o.petId}`.padEnd(60).slice(0, 60);
    const fc = String(o.files.length).padStart(5);
    const sz = fmtBytes(o.bytes).padStart(7);
    console.log(`  ${key}  ${fc}  ${sz}`);
  }
  if (orphans.length > 20) {
    console.log(`  ... (${orphans.length - 20} more orphan groups not shown)`);
  }
  if (verbose) {
    console.log('');
    console.log('Full file list (verbose):');
    for (const o of orphans) {
      for (const f of o.files) {
        console.log(`  ${f.name} (${fmtBytes(Number(f.metadata?.size ?? 0))})`);
      }
    }
  }

  // ── Step 4: apply or skip ───────────────────────────────────────────────
  console.log('');
  if (!apply) {
    console.log('────────────────────────────────────────────────────────────────');
    console.log('DRY-RUN — no files deleted. Re-run with --apply to execute.');
    console.log(`Would delete: ${orphanFiles} files (${fmtBytes(orphanBytes)})`);
    process.exit(0);
  }

  console.log(`[step 4/4] APPLY — deleting ${orphanFiles} files ...`);
  let deleted = 0;
  let errors = 0;
  for (const o of orphans) {
    const results = await Promise.allSettled(
      o.files.map((f) => f.delete({ ignoreNotFound: true }))
    );
    let groupDeleted = 0;
    let groupErrors = 0;
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        groupDeleted++;
        deleted++;
      } else {
        groupErrors++;
        errors++;
        console.warn(`  ✗ ${o.building}/${o.room}/${o.petId}: ${r.reason?.message || r.reason}`);
      }
    });
    console.log(`  ✓ ${o.building}/${o.room}/${o.petId}: deleted ${groupDeleted}/${o.files.length}` +
      (groupErrors ? ` (${groupErrors} error)` : ''));
  }

  console.log('');
  console.log('Done.');
  console.log(`  Deleted:  ${deleted}/${orphanFiles}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Bytes:    ~${fmtBytes(orphanBytes)} reclaimed`);

  process.exit(errors > 0 ? 1 : 0);
})().catch((err) => {
  console.error('FATAL:', err.message || err);
  console.error(err.stack);
  process.exit(2);
});
