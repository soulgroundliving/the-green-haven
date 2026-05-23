/**
 * reset-nest-gamification — one-shot test-data reset for Nest tenants.
 *
 * Clears the 4 gamification fields users specified:
 *   - gamification.points        → 0
 *   - gamification.dailyStreak   → 0
 *   - gamification.lastDailyClaim → FieldValue.delete()
 *   - gamification.badges        → []
 *
 * Leaves untouched: gamification.lastDailyClaimAt (audit trail; CF overwrites
 * on next claim), complaintFreeMonthAwarded subcollection (own lifecycle),
 * top-level tenant fields (name, lease, etc.), Rooms-building tenants, and
 * people/* (post-tenancy players are out of scope per gamification SSoT).
 *
 * Default mode is dry-run — prints a per-room diff but writes nothing. Pass
 * `--apply` to commit. Per CLAUDE.md §7-I, bulk writes to production must
 * preview first; the script itself enforces the gate.
 *
 * Usage:
 *   One-time: place a service-account JSON at functions/serviceAccountKey.json
 *             OR run `gcloud auth application-default login`
 *   Dry-run:  NODE_PATH=functions/node_modules node tools/reset-nest-gamification.js
 *   Apply:    NODE_PATH=functions/node_modules node tools/reset-nest-gamification.js --apply
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function init() {
  if (admin.apps.length) return;
  const candidates = [
    path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const key = require(p);
      admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
      console.log(`✓ Initialized from ${p}`);
      return;
    }
  }
  admin.initializeApp({ projectId: 'the-green-haven' });
  console.log('✓ Initialized with Application Default Credentials');
}

async function main() {
  const apply = process.argv.includes('--apply');
  init();
  const db = admin.firestore();
  const FV = admin.firestore.FieldValue;

  console.log('');
  console.log(`Mode: ${apply ? '⚠️  APPLY (will write)' : '🧪 DRY-RUN (read-only)'}`);
  console.log('Target: tenants/nest/list/*');
  console.log('');

  const snap = await db.collection('tenants').doc('nest').collection('list').get();
  if (snap.empty) {
    console.log('No Nest tenant docs found. Nothing to do.');
    return;
  }

  const rows = [];
  let touched = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const g = data.gamification || {};
    const cur = {
      points: Number(g.points) || 0,
      streak: Number(g.dailyStreak) || 0,
      lastClaim: g.lastDailyClaim || null,
      badges: Array.isArray(g.badges) ? g.badges.length : 0,
    };
    const needsUpdate =
      cur.points !== 0 ||
      cur.streak !== 0 ||
      cur.lastClaim !== null ||
      cur.badges !== 0;
    rows.push({ roomId: doc.id, name: data.name || '', ...cur, willTouch: needsUpdate });
    if (needsUpdate) touched++;
  }

  // Print a tidy diff
  console.log(`Found ${snap.size} Nest rooms · ${touched} need reset · ${snap.size - touched} already clean`);
  console.log('');
  console.log('roomId      name                     points  streak  lastClaim    badges  action');
  console.log('----------  -----------------------  ------  ------  -----------  ------  ------');
  for (const r of rows) {
    const action = r.willTouch ? 'RESET' : 'skip';
    const name = String(r.name).slice(0, 22).padEnd(23);
    console.log(
      `${r.roomId.padEnd(10)}  ${name}  ${String(r.points).padStart(6)}  ${String(r.streak).padStart(6)}  ${String(r.lastClaim || '-').padEnd(11)}  ${String(r.badges).padStart(6)}  ${action}`
    );
  }
  console.log('');

  if (!apply) {
    console.log('Dry-run complete. Re-run with --apply to commit.');
    return;
  }

  if (touched === 0) {
    console.log('Nothing to write.');
    return;
  }

  // Firestore batch limit = 500 ops. Nest has well under that, single batch is safe.
  const batch = db.batch();
  for (const r of rows) {
    if (!r.willTouch) continue;
    const ref = db.collection('tenants').doc('nest').collection('list').doc(r.roomId);
    batch.update(ref, {
      'gamification.points': 0,
      'gamification.dailyStreak': 0,
      'gamification.lastDailyClaim': FV.delete(),
      'gamification.badges': [],
    });
  }
  await batch.commit();
  console.log(`✅ Reset ${touched} rooms.`);
}

main().catch(err => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
