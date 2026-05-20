#!/usr/bin/env node
/**
 * backfill-unlinked-claims.js — clear persisted custom claims + revoke refresh
 * tokens for every liffUsers entry with status === 'unlinked'. Mirror of
 * backfill-liff-claims.js for the inverse case (§7-Z reversal).
 *
 * Why this exists: unlinkLiffUser CF only got the setCustomUserClaims({}) +
 * revokeRefreshTokens() calls in commit ba084ef (2026-05-20). Records unlinked
 * BEFORE that deploy kept full {room, building, tenantId} claims on the user
 * record — those users could keep walking back into LIFF with their cached
 * ID token. This script catches up the legacy backlog.
 *
 * What it does — for each liffUsers.status='unlinked' doc:
 *   1. uid = 'line:' + doc.lineUserId  (deterministic post-liffSignIn UID)
 *   2. setCustomUserClaims(uid, {})   — strip claims from user record
 *   3. revokeRefreshTokens(uid)        — force ID-token refresh on next SDK call
 *
 * NOT touched: legacy anonymous UIDs from the pre-liffSignIn era. Those would
 * have been recoverable from tenants/{b}/list/{r}.linkedAuthUid, but the field
 * is deleted on first unlink — the legacy UIDs are now lost. In practice every
 * user who has opened LIFF since liffSignIn shipped uses the deterministic UID,
 * so this is the path that matters.
 *
 * Run:
 *   node tools/backfill-unlinked-claims.js              # dry-run (default)
 *   node tools/backfill-unlinked-claims.js --apply      # actually clear
 *
 * Idempotent: re-running just rewrites empty claims and revokes again. Safe.
 */

'use strict';

const path = require('path');
const args = process.argv.slice(2);
const apply = args.includes('--apply');

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'the-green-haven' });
}

const db = admin.firestore();
const auth = admin.auth();

async function main() {
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  backfill-unlinked-claims — ${apply ? 'APPLY MODE' : 'DRY RUN'}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  const snap = await db.collection('liffUsers').where('status', '==', 'unlinked').get();
  console.log(`Found ${snap.size} unlinked liffUsers\n`);

  let cleared = 0, failed = 0, skipped = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const lineUserId = data.lineUserId || doc.id;
    const uid = 'line:' + lineUserId;
    const label = `${data.lineDisplayName || '(no name)'} ${data.building || '?'}/${data.room || '?'}`;

    if (!apply) {
      console.log(`  ⏭️  ${label}  uid=${uid}  (dry-run, would clear claims + revoke)`);
      skipped++;
      continue;
    }

    try {
      await auth.setCustomUserClaims(uid, {});
      await auth.revokeRefreshTokens(uid);
      console.log(`  ✅ ${label}  uid=${uid}  claims cleared + tokens revoked`);
      cleared++;
    } catch (e) {
      // user-not-found is expected if the user record never existed (e.g.,
      // pre-liffSignIn anon UID era). Don't treat as a hard failure.
      const code = e?.code || '';
      if (code === 'auth/user-not-found') {
        console.log(`  ⏭️  ${label}  uid=${uid}  user record not found (legacy anon — skip)`);
        skipped++;
      } else {
        console.log(`  ✗ ${label}  uid=${uid}  ${code || ''} ${e?.message || e}`);
        failed++;
      }
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  cleared: ${cleared}   skipped: ${skipped}   failed: ${failed}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  if (!apply) console.log(`\nDry-run only. Re-run with --apply to commit.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e?.message || e);
  process.exit(1);
});
