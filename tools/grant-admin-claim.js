#!/usr/bin/env node
/**
 * grant-admin-claim.js — set Firebase Auth custom claim `admin: true` (or
 * `accountant: true`) on a user identified by email.
 *
 * Why this exists: firestore.rules / RTDB rules use
 *   request.auth.token.admin == true
 * If the claim is missing, every admin-only read/write fails with
 * "Missing or insufficient permissions" — the symptom we hit in dashboard
 * console. There is also a callable CF (`setAdminClaim`) for in-product use,
 * but it requires an already-admin caller. This script bootstraps the first
 * admin (or repairs a lost claim) using the service account directly.
 *
 * Run:
 *   node tools/grant-admin-claim.js admin1@test.com
 *   node tools/grant-admin-claim.js accountant1@test.com --role accountant
 *   node tools/grant-admin-claim.js admin1@test.com --revoke   # remove claim
 *
 * Auth source for firebase-admin (in priority order):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var → path to service account JSON
 *   2. functions/.runtime-credentials.json (gitignored)
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
  console.log('Usage: node tools/grant-admin-claim.js <email> [--role admin|accountant] [--revoke]');
  process.exit(0);
}

const email = args[0];
if (!email || !email.includes('@')) {
  console.error('❌ First argument must be a valid email.');
  process.exit(1);
}

const roleIdx = args.indexOf('--role');
const role = roleIdx >= 0 ? args[roleIdx + 1] : 'admin';
if (!['admin', 'accountant'].includes(role)) {
  console.error(`❌ --role must be "admin" or "accountant", got "${role}".`);
  process.exit(1);
}

const revoke = args.includes('--revoke');

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

// Resolve credentials. Prefer env var; else look for a local service account file.
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
    console.error(`❌ No Firebase Auth user found for "${email}". Make sure the user has signed in with email/password at least once.`);
    console.error(`   Underlying error: ${e.message}`);
    process.exit(1);
  }

  const existingClaims = user.customClaims || {};
  const next = { ...existingClaims };
  if (revoke) {
    delete next[role];
  } else {
    next[role] = true;
  }

  await admin.auth().setCustomUserClaims(user.uid, next);

  console.log(`✅ Updated custom claims for ${email} (uid=${user.uid})`);
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
