#!/usr/bin/env node
/**
 * grant-building-manager.js — set the `managedBuildings` custom claim
 * on a Firebase Auth user identified by email.
 *
 * A building manager can read tenant, billing, and meter data for their
 * buildings without being a global admin. Firestore rules check
 * `isBuildingManager(building)` for read paths.
 *
 * Run:
 *   node tools/grant-building-manager.js manager@example.com rooms
 *   node tools/grant-building-manager.js manager@example.com rooms nest
 *   node tools/grant-building-manager.js manager@example.com --revoke
 *
 * Auth source (same priority as grant-admin-claim.js):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var
 *   2. functions/.runtime-credentials.json
 *   3. ADC via `gcloud auth application-default login`
 *
 * After setting the claim the user MUST sign out + sign back in (or call
 * `auth.currentUser.getIdToken(true)`) to receive a token containing it.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node tools/grant-building-manager.js <email> [building1 building2 ...] [--revoke]');
  console.log('  --revoke  Remove managedBuildings claim entirely');
  process.exit(0);
}

const email = args[0];
if (!email || !email.includes('@')) {
  console.error('❌ First argument must be a valid email.');
  process.exit(1);
}

const revoke = args.includes('--revoke');
const buildings = revoke ? [] : args.slice(1).filter(a => !a.startsWith('--'));

if (!revoke && buildings.length === 0) {
  console.error('❌ Provide at least one building id, or use --revoke.');
  process.exit(1);
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

// P4.6-1 (2026-05-23): validate buildings against the live registry before
// granting the claim. Without this, a typo on the CLI (e.g. `node tools/...
// manager@x rom` instead of `rooms`) would mint a claim with a non-canonical
// building id that no `isBuildingManager(building)` check in firestore.rules
// would ever match — silently broken. The companion functions/grantBuildingManager.js
// CF already validates via `getValidBuildings()`; this brings the CLI to parity.
async function fetchValidBuildingIds(db) {
  const snap = await db.collection('buildings').get();
  const ids = new Set();
  snap.forEach(doc => {
    const data = doc.data() || {};
    // Skip archived buildings — they shouldn't be assignable as managed
    if (data.status === 'archived') return;
    ids.add(doc.id);
  });
  return ids;
}

(async () => {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    console.error(`❌ No Firebase Auth user found for "${email}". Make sure the user has signed in at least once.`);
    console.error(`   Underlying error: ${e.message}`);
    process.exit(1);
  }

  // Validate buildings argument shape + identifiers (skip on revoke)
  if (!revoke) {
    if (!Array.isArray(buildings)) {
      console.error('❌ Internal error: buildings is not an array. This is a parser bug.');
      process.exit(1);
    }
    const dupes = buildings.filter((b, i) => buildings.indexOf(b) !== i);
    if (dupes.length > 0) {
      console.error(`❌ Duplicate building ids in arguments: ${[...new Set(dupes)].join(', ')}`);
      process.exit(1);
    }
    const db = admin.firestore();
    let validIds;
    try {
      validIds = await fetchValidBuildingIds(db);
    } catch (e) {
      console.error(`❌ Could not fetch buildings registry for validation: ${e.message}`);
      console.error('   This validation is required to prevent typos that mint useless claims.');
      console.error('   If this is a fresh install with zero buildings, seed at least one first.');
      process.exit(1);
    }
    if (validIds.size === 0) {
      console.error('❌ No active buildings in registry. Seed buildings/{id} docs first.');
      process.exit(1);
    }
    const invalid = buildings.filter(b => !validIds.has(b));
    if (invalid.length > 0) {
      console.error(`❌ Unknown building id(s): ${invalid.join(', ')}`);
      console.error(`   Valid building ids: ${[...validIds].join(', ')}`);
      process.exit(1);
    }
  }

  const existingClaims = user.customClaims || {};
  const next = { ...existingClaims };

  if (revoke) {
    delete next.managedBuildings;
  } else {
    next.managedBuildings = buildings;
  }

  await admin.auth().setCustomUserClaims(user.uid, next);

  const action = revoke ? 'REVOKED' : `SET to [${buildings.join(', ')}]`;
  console.log(`✅ managedBuildings ${action} for ${email} (uid=${user.uid})`);
  console.log(`   Before: ${JSON.stringify(existingClaims)}`);
  console.log(`   After:  ${JSON.stringify(next)}`);
  console.log('');
  console.log('⚠️  The user must sign out and sign back in (or force-refresh their ID token)');
  console.log('   for the new claim to appear in their auth.token. Existing sessions retain');
  console.log('   the old claims until the next refresh.');

  process.exit(0);
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
