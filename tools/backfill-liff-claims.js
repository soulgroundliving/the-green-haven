#!/usr/bin/env node
/**
 * backfill-liff-claims.js — one-shot script that walks every approved
 * liffUser and ensures their Firebase Auth user record carries the
 * { room, building, tenantId } custom claims.
 *
 * Why: liffSignIn previously minted these claims via createCustomToken only.
 * Those developer claims are EPHEMERAL — they live in the FIRST ID token
 * after signInWithCustomToken and disappear on the next ID-token auto-refresh
 * (~1 h). Every claim-gated read (bills, maintenance, deposits, lease,
 * checklist, storage) then returned `permission-denied` until the tenant
 * reopened LINE. Fixed in commit a5f4e5a by also calling setCustomUserClaims
 * inside liffSignIn — but EXISTING tenants whose user record was created
 * before that commit still have no persisted claims; they'll keep failing
 * until either (a) they reopen LINE so the patched liffSignIn runs, or
 * (b) this backfill script runs.
 *
 * Approach:
 *   1. Query Firestore liffUsers where status == 'approved'
 *   2. For each: read tenantId from tenants/{building}/list/{room}
 *   3. setCustomUserClaims('line:' + lineUserId, { room, building, tenantId })
 *
 * Run:
 *   node tools/backfill-liff-claims.js              # dry-run (default)
 *   node tools/backfill-liff-claims.js --apply      # actually set claims
 *
 * Idempotent: rerunning with the same data writes identical claims and is a
 * no-op effectively. Safe to re-run after tenant moves or new approvals.
 *
 * Auth source for firebase-admin (in priority order):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var
 *   2. functions/.runtime-credentials.json (gitignored)
 *   3. ADC via `gcloud auth application-default login`
 */

'use strict';

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const verbose = args.includes('--verbose') || args.includes('-v');

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

admin.initializeApp(initOpts);
const firestore = admin.firestore();
const auth = admin.auth();

(async () => {
  console.log(`backfill-liff-claims ${apply ? '[APPLY]' : '[DRY RUN]'}\n`);

  const liffSnap = await firestore.collection('liffUsers')
    .where('status', '==', 'approved')
    .get();

  if (liffSnap.empty) {
    console.log('No approved liffUsers found — nothing to backfill.');
    process.exit(0);
  }
  console.log(`Found ${liffSnap.size} approved liffUser(s).\n`);

  const summary = { updated: 0, unchanged: 0, skipped: 0, errors: 0 };

  for (const doc of liffSnap.docs) {
    const lineUserId = doc.id;
    const data = doc.data() || {};
    const room = String(data.room || '');
    const building = String(data.building || '');

    if (!room || !building) {
      console.warn(`⚠️ ${lineUserId} skipped: missing room/building (room='${room}', building='${building}')`);
      summary.skipped++;
      continue;
    }

    // Tenant doc lookup — same path liffSignIn uses
    let tenantId = '';
    try {
      const tenantSnap = await firestore
        .collection('tenants').doc(building)
        .collection('list').doc(room)
        .get();
      if (tenantSnap.exists) {
        tenantId = String((tenantSnap.data() || {}).tenantId || '');
      }
    } catch (e) {
      console.warn(`⚠️ ${lineUserId} (${building}/${room}): tenant lookup failed — ${e.message}`);
      // continue without tenantId — claims are still useful without it
    }

    const uid = 'line:' + lineUserId;
    const desired = { room, building, tenantId };

    let existing = {};
    try {
      const userRec = await auth.getUser(uid);
      existing = userRec.customClaims || {};
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.warn(`⚠️ ${uid}: Firebase Auth user does not exist yet — they have not opened LIFF after Anonymous flow. Skipping.`);
        summary.skipped++;
        continue;
      }
      console.error(`❌ ${uid}: getUser failed — ${e.message}`);
      summary.errors++;
      continue;
    }

    const same = existing.room === desired.room
      && existing.building === desired.building
      && existing.tenantId === desired.tenantId;

    if (same) {
      if (verbose) console.log(`✓ ${uid} (${building}/${room}): already up-to-date`);
      summary.unchanged++;
      continue;
    }

    const next = { ...existing, ...desired };
    if (apply) {
      try {
        await auth.setCustomUserClaims(uid, next);
        console.log(`✅ ${uid} (${building}/${room}): claims set`);
        summary.updated++;
      } catch (e) {
        console.error(`❌ ${uid}: setCustomUserClaims failed — ${e.message}`);
        summary.errors++;
      }
    } else {
      console.log(`(dry) ${uid} (${building}/${room}): would set ${JSON.stringify(next)}`);
      summary.updated++;
    }
  }

  console.log(`\n${apply ? 'Applied' : 'Would apply'}: ${summary.updated} | Unchanged: ${summary.unchanged} | Skipped: ${summary.skipped} | Errors: ${summary.errors}`);
  if (!apply && summary.updated > 0) {
    console.log('\nRe-run with --apply to write claims to Firebase Auth.');
  }
  process.exit(summary.errors > 0 ? 1 : 0);
})();
