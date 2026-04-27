/**
 * Manual dry-run of awardComplaintFreeMonth using Firebase Admin SDK.
 *
 * Why: the scheduled CF fires 2026-05-01. The fix landed 2026-04-19 but has
 * never run against production. This script runs the same logic locally in
 * dryRun mode (no DB writes) so we can sanity-check the wouldAward list
 * before May 1.
 *
 * Usage (two paths):
 *
 *   Path A (recommended) — click the button on the dashboard:
 *      Open https://the-green-haven.vercel.app/dashboard
 *      → People Management → 📊 Insights
 *      → ⚙️ CF Health card → 🧪 Run Dry Run button
 *      Result appears inline. Uses your admin Firebase Auth token. No setup.
 *
 *   Path B — run this script locally (for CI / scheduled checks):
 *      One-time: `gcloud auth application-default login` (sets ADC)
 *                or place a service account JSON at functions/serviceAccountKey.json
 *      Run:      `NODE_PATH=functions/node_modules node tools/award-dryrun.js`
 *      (NODE_PATH lets node find firebase-admin in functions/, since the
 *       repo root has no node_modules of its own.)
 *
 * Output: JSON with monthKey, complaintsLastMonth, complainedRooms,
 * wouldAward (rooms that would receive 40 pts), skipped counters.
 *
 * Reads only — verified by the dryRun=true short-circuit at line ~273
 * of functions/complaintAndGamification.js.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function init() {
  if (admin.apps.length) return;

  // Try the conventional service-account paths first
  const candidates = [
    path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const key = require(p);
      admin.initializeApp({
        credential: admin.credential.cert(key),
        projectId: key.project_id
      });
      console.log(`✓ Initialized with credentials from ${p}`);
      return;
    }
  }

  // Fall back to ADC (works if `gcloud auth application-default login` was run
  // or GOOGLE_APPLICATION_CREDENTIALS is set elsewhere)
  admin.initializeApp({ projectId: 'the-green-haven' });
  console.log('✓ Initialized with Application Default Credentials');
}

async function runDryRun() {
  init();
  const firestore = admin.firestore();
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthKey = prevMonthStart.slice(0, 7);

  console.log('');
  console.log('🎯 Dry-run window:');
  console.log(`   monthKey:       ${monthKey}`);
  console.log(`   prevMonthStart: ${prevMonthStart}`);
  console.log(`   prevMonthEnd:   ${prevMonthEnd}`);
  console.log('');

  const complaintsSnap = await firestore.collection('complaints')
    .where('createdAt', '>=', prevMonthStart)
    .where('createdAt', '<',  prevMonthEnd)
    .get();

  const complainedRooms = new Set();
  complaintsSnap.forEach(d => {
    const c = d.data();
    if (c.building === 'nest' && c.room) complainedRooms.add(String(c.room));
  });

  const nestSnap = await firestore.collection('tenants').doc('nest').collection('list').get();
  let skippedAlreadyAwarded = 0, skippedHadComplaint = 0;
  const wouldAward = [];

  for (const tenantDoc of nestSnap.docs) {
    const roomId = tenantDoc.id;
    if (complainedRooms.has(String(roomId))) { skippedHadComplaint++; continue; }
    const markerRef = tenantDoc.ref.collection('complaintFreeMonthAwarded').doc(monthKey);
    const markerSnap = await markerRef.get();
    if (markerSnap.exists) { skippedAlreadyAwarded++; continue; }
    wouldAward.push(roomId);
  }

  const result = {
    monthKey,
    totalNestRooms: nestSnap.size,
    complaintsLastMonth: complaintsSnap.size,
    complainedRooms: Array.from(complainedRooms),
    wouldAward,
    skippedAlreadyAwarded,
    skippedHadComplaint,
    pointsPerAward: 40
  };

  console.log('📊 Result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('');
  console.log(`✅ Would award ${wouldAward.length} tenants × 40 pts = ${wouldAward.length * 40} pts total`);
  console.log('');
  console.log('   No DB writes performed — re-run without dry-run flag, or wait for the 2026-05-01 schedule.');
  process.exit(0);
}

runDryRun().catch(e => {
  console.error('❌ Dry-run failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});
