/**
 * One-off verification script for the two important catches:
 *   1. Housekeeping RTDB: prove no historical writes existed (rule was
 *      blocking tenants), inspect current state.
 *   2. awardComplaintFreeMonth: dry-run the new logic against live data
 *      and confirm nobody has spurious complaintFreeMonthAwarded markers.
 *
 * Usage:  node tools/verify-fixes.js
 *
 * Auth: uses Firebase CLI Application Default Credentials (already set up
 * via `firebase login`). No user login required.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'the-green-haven',
    databaseURL: 'https://the-green-haven-default-rtdb.firebaseio.com'
  });
}

const fs = admin.firestore();
const rtdb = admin.database();

async function checkHousekeeping() {
  const snap = await rtdb.ref('housekeeping').once('value');
  const val = snap.val();
  console.log('--- HOUSEKEEPING RTDB ---');
  if (!val) {
    console.log('  ❌ /housekeeping is empty (no bookings ever synced — confirms historical rule rejection)');
  } else {
    const buildings = Object.keys(val);
    let count = 0;
    for (const b of buildings) {
      for (const r of Object.keys(val[b] || {})) {
        count += Object.keys(val[b][r] || {}).length;
      }
    }
    console.log(`  ✅ Found ${count} bookings across ${buildings.length} buildings:`, buildings.join(', '));
  }
}

async function dryRunComplaintFreeMonth() {
  console.log('--- awardComplaintFreeMonth DRY-RUN ---');
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthKey = prevMonthStart.slice(0, 7);
  console.log(`  Period: ${monthKey} (${prevMonthStart} → ${prevMonthEnd})`);

  const complaintsSnap = await fs.collection('complaints')
    .where('createdAt', '>=', prevMonthStart)
    .where('createdAt', '<', prevMonthEnd)
    .get();
  console.log(`  Complaints found in period: ${complaintsSnap.size}`);

  const complainedRooms = new Set();
  complaintsSnap.forEach(d => {
    const c = d.data();
    if (c.building === 'nest' && c.room) complainedRooms.add(String(c.room));
  });
  console.log(`  Nest rooms that complained:`, Array.from(complainedRooms));

  const nestSnap = await fs.collection('tenants').doc('nest').collection('list').get();
  const wouldAward = [];
  const skippedAlreadyAwarded = [];
  const skippedHadComplaint = [];

  for (const doc of nestSnap.docs) {
    const roomId = doc.id;
    if (complainedRooms.has(String(roomId))) {
      skippedHadComplaint.push(roomId);
      continue;
    }
    const marker = await doc.ref.collection('complaintFreeMonthAwarded').doc(monthKey).get();
    if (marker.exists) {
      skippedAlreadyAwarded.push(roomId);
      continue;
    }
    wouldAward.push(roomId);
  }

  console.log(`  Total Nest tenants: ${nestSnap.size}`);
  console.log(`  Would award (40 pts each): ${wouldAward.length}`, wouldAward);
  console.log(`  Skipped (already awarded): ${skippedAlreadyAwarded.length}`, skippedAlreadyAwarded);
  console.log(`  Skipped (had complaint):    ${skippedHadComplaint.length}`, skippedHadComplaint);
}

async function checkHistoricalAwards() {
  console.log('--- HISTORICAL AWARDS (markers in tenants/nest/list/*/complaintFreeMonthAwarded) ---');
  const nestSnap = await fs.collection('tenants').doc('nest').collection('list').get();
  let totalMarkers = 0;
  for (const doc of nestSnap.docs) {
    const markersSnap = await doc.ref.collection('complaintFreeMonthAwarded').get();
    if (markersSnap.size > 0) {
      console.log(`  Room ${doc.id}: ${markersSnap.size} award marker(s)`,
        markersSnap.docs.map(d => d.id));
      totalMarkers += markersSnap.size;
    }
  }
  if (totalMarkers === 0) {
    console.log('  ✅ Zero markers — function has never run (consistent with deploy date 2026-04-19)');
  } else {
    console.log(`  ${totalMarkers} total markers across rooms (function has run before)`);
  }
}

async function checkPointsDistribution() {
  console.log('--- POINTS DISTRIBUTION (Nest tenants) ---');
  const nestSnap = await fs.collection('tenants').doc('nest').collection('list').get();
  const points = [];
  nestSnap.forEach(doc => {
    const d = doc.data();
    points.push({ room: doc.id, points: d.gamification?.points || 0, name: d.name || d.tenantName || '—' });
  });
  points.sort((a, b) => b.points - a.points);
  console.log('  Top 10:');
  for (const p of points.slice(0, 10)) {
    console.log(`    Room ${p.room}: ${p.points} pts (${p.name})`);
  }
  const total = points.reduce((s, p) => s + p.points, 0);
  console.log(`  Total points across ${points.length} tenants: ${total}`);
  console.log(`  Mean: ${(total / points.length).toFixed(1)} pts`);
}

(async () => {
  try {
    await checkHousekeeping();
    console.log('');
    await dryRunComplaintFreeMonth();
    console.log('');
    await checkHistoricalAwards();
    console.log('');
    await checkPointsDistribution();
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e);
    process.exit(1);
  }
})();
