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

(async () => {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    console.error(`❌ No Firebase Auth user found for "${email}". Make sure the user has signed in at least once.`);
    console.error(`   Underlying error: ${e.message}`);
    process.exit(1);
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
