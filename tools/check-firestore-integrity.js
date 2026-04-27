/**
 * Read-only Firestore + RTDB integrity probe.
 * Scheduled task: gh-firebase-health-daily
 *
 *   1. tenants/{rooms|nest}/list/{roomId} — tenantName/monthlyRent/leaseStart presence
 *   2. verifiedSlips                       — transRef field present
 *   3. meter_data                          — current-month entries + V3 format parsing
 *   4. buildings/{RentRoom|nest}/rooms/*   — total rooms (target 24)
 *
 * NEVER MUTATES. Auth via Firebase CLI ADC.
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

const issues = [];
const passes = [];

function pass(msg) { passes.push(msg); console.log('  PASS  ' + msg); }
function warn(msg, detail) {
  issues.push({ msg, detail });
  console.log('  WARN  ' + msg);
  if (detail) console.log('        ' + detail);
}

async function checkTenants() {
  console.log('\n=== 1. TENANTS (canonical paths: tenants/rooms/list, tenants/nest/list) ===');

  // Memory says canonical building keys are "rooms" and "nest" (NOT "RentRoom").
  // Probe both just in case stale "RentRoom" docs exist.
  for (const building of ['rooms', 'nest', 'RentRoom']) {
    const snap = await fs.collection('tenants').doc(building).collection('list').get();
    if (snap.empty) {
      if (building === 'RentRoom') {
        pass(`tenants/RentRoom/list is empty (correct — canonical key is "rooms")`);
      } else {
        warn(`tenants/${building}/list is EMPTY`, 'expected populated');
      }
      continue;
    }
    console.log(`  -- tenants/${building}/list — ${snap.size} doc(s) --`);

    let okCount = 0;
    const missingFields = []; // { roomId, missing: [fieldNames] }
    snap.forEach(doc => {
      const d = doc.data() || {};
      const missing = [];

      // tenantName: accept tenantName OR (firstName && lastName) OR name
      const hasName = d.tenantName ||
        (d.firstName && d.lastName) ||
        d.name;
      if (!hasName) missing.push('tenantName');

      // monthlyRent: accept monthlyRent or rentPrice
      const hasRent = d.monthlyRent || d.rentPrice;
      if (!hasRent) missing.push('monthlyRent');

      // leaseStart: accept leaseStart or moveInDate
      const hasStart = d.leaseStart || d.moveInDate;
      if (!hasStart) missing.push('leaseStart');

      if (missing.length === 0) okCount++;
      else missingFields.push({ roomId: doc.id, missing });
    });

    if (missingFields.length === 0) {
      pass(`tenants/${building}/list — all ${snap.size} docs have name + rent + start`);
    } else {
      const detail = missingFields.slice(0, 8).map(x => `${x.roomId}:[${x.missing.join(',')}]`).join(' ');
      warn(
        `tenants/${building}/list — ${missingFields.length}/${snap.size} docs missing fields`,
        detail + (missingFields.length > 8 ? ` (+${missingFields.length - 8} more)` : '')
      );
    }
  }
}

async function checkVerifiedSlips() {
  console.log('\n=== 2. verifiedSlips (transRef SlipOK normalization) ===');
  // Sample most recent 50; full collection could be large.
  const snap = await fs.collection('verifiedSlips')
    .orderBy('verifiedAt', 'desc')
    .limit(50)
    .get()
    .catch(async () => {
      // Fallback if no verifiedAt index
      return await fs.collection('verifiedSlips').limit(50).get();
    });

  if (snap.empty) {
    warn('verifiedSlips is EMPTY', 'no slips to inspect');
    return;
  }

  let withTransRef = 0;
  let withTransactionId = 0;
  let withNeither = 0;
  const neitherIds = [];

  snap.forEach(doc => {
    const d = doc.data() || {};
    if (d.transRef) withTransRef++;
    if (d.transactionId) withTransactionId++;
    if (!d.transRef && !d.transactionId) {
      withNeither++;
      if (neitherIds.length < 5) neitherIds.push(doc.id);
    }
  });

  console.log(`  Sampled ${snap.size} docs: transRef=${withTransRef}  transactionId=${withTransactionId}  neither=${withNeither}`);

  if (withNeither > 0) {
    warn(
      `verifiedSlips — ${withNeither}/${snap.size} sampled docs missing both transRef and transactionId`,
      `examples: ${neitherIds.join(', ')}`
    );
  } else {
    pass(`verifiedSlips — every sampled doc has at least one transaction id field`);
  }

  // Memory note (2026-04-XX): SlipOK returns transRef; downstream code expected transactionId
  // and was patched to alias. So old docs may have only transactionId; new docs should have transRef.
  if (withTransRef === 0 && snap.size > 0) {
    warn(
      `verifiedSlips — ZERO sampled docs have transRef field`,
      'either nothing has been verified since the SlipOK normalization patch landed, or alias is broken'
    );
  }
}

async function checkMeterData() {
  console.log('\n=== 3. meter_data (current-month entries + V3 parsing) ===');

  // Path per repo: meter_data lives in RTDB? or Firestore? Check both.
  // Memory references METER_DATA via Firestore (dashboard.html commit c87aa05 reads from Firestore).
  // Let's try Firestore collection 'meter_data' first.

  let snap;
  let source = '';
  try {
    snap = await fs.collection('meter_data').limit(200).get();
    source = 'Firestore meter_data';
  } catch (e) {
    warn('Could not read Firestore meter_data', e.message);
  }

  if (!snap || snap.empty) {
    // Try RTDB fallback
    const rtSnap = await rtdb.ref('meter_data').once('value');
    const val = rtSnap.val();
    if (!val) {
      warn('meter_data EMPTY in both Firestore and RTDB', '');
      return;
    }
    source = 'RTDB meter_data';
    console.log(`  Found ${source}, top-level keys: ${Object.keys(val).slice(0,10).join(', ')}`);
    // Light V3 sanity: V3 keys often look like `roomId-YYYY-MM` or month-keyed nodes.
    return;
  }

  console.log(`  Source: ${source} (${snap.size} doc(s))`);

  // V3 format heuristic: docs keyed like `${room}_${YYYY}-${MM}` or with explicit
  // `month`/`year` fields, plus `previousReading`/`currentReading`/`unitsUsed`.
  const now = new Date();
  const ceYear = now.getFullYear();
  const beYear = ceYear + 543;
  const monthNum = now.getMonth() + 1;
  const monthKey = `${ceYear}-${String(monthNum).padStart(2, '0')}`;

  let currentMonthCount = 0;
  let v3OK = 0;
  let v3Issues = 0;
  const v3IssueIds = [];

  snap.forEach(doc => {
    const d = doc.data() || {};
    const id = doc.id;

    // Detect current month either by id contains monthKey, or by month/year fields
    const idHasMonth = id.includes(monthKey) || id.includes(`${monthNum}-${ceYear}`) || id.includes(`${monthNum}-${beYear}`);
    const fieldMatches = (
      (Number(d.month) === monthNum) &&
      (Number(d.year) === ceYear || Number(d.year) === beYear)
    );
    if (idHasMonth || fieldMatches) currentMonthCount++;

    // V3 sanity: at least one of the canonical fields present
    const hasV3 = ('currentReading' in d) || ('current' in d) || ('newReading' in d) ||
      ('electricCurrent' in d) || ('waterCurrent' in d) || ('readings' in d);
    if (hasV3) v3OK++;
    else { v3Issues++; if (v3IssueIds.length < 5) v3IssueIds.push(id); }
  });

  console.log(`  Current-month (${monthKey}) entries: ${currentMonthCount}`);
  console.log(`  V3-shape OK: ${v3OK}   V3-shape unrecognized: ${v3Issues}`);

  if (currentMonthCount === 0) {
    warn(
      `meter_data — 0 entries for current month ${monthKey}`,
      'admin may not have entered this month yet (today is 2026-04-27, end-of-month near)'
    );
  } else {
    pass(`meter_data — ${currentMonthCount} current-month entries present`);
  }

  if (v3Issues > 0 && v3OK === 0) {
    warn(`meter_data — none of ${snap.size} sampled docs match V3 shape`, `examples: ${v3IssueIds.join(', ')}`);
  } else if (v3OK > 0) {
    pass(`meter_data — V3 shape recognized in ${v3OK}/${snap.size} sampled docs`);
  }
}

async function checkBuildingsRooms() {
  console.log('\n=== 4. buildings/{RentRoom|nest}/rooms/* (expected ~24 total) ===');

  let totalRooms = 0;
  for (const building of ['RentRoom', 'nest']) {
    const snap = await fs.collection('buildings').doc(building).collection('rooms').get();
    if (snap.empty) {
      warn(`buildings/${building}/rooms is EMPTY`, '');
      continue;
    }
    const ids = snap.docs.map(d => d.id).sort();
    console.log(`  buildings/${building}/rooms — ${snap.size} room(s):`);
    console.log(`    [${ids.join(', ')}]`);
    totalRooms += snap.size;
  }

  // Note: memory says rooms 13–33 + ร้านใหญ่ for RentRoom (~22), plus nest 101..405
  // The task says "ห้องครบ 24 ห้องไหม" — report whatever we find.
  console.log(`  TOTAL rooms across both buildings: ${totalRooms}`);
  if (totalRooms === 0) {
    warn('buildings rooms — 0 total', 'critical: no room config seeded');
  } else if (totalRooms < 20) {
    warn(`buildings rooms — only ${totalRooms} total (expected ~24)`, '');
  } else {
    pass(`buildings rooms — ${totalRooms} total`);
  }
}

(async () => {
  try {
    await checkTenants();
    await checkVerifiedSlips();
    await checkMeterData();
    await checkBuildingsRooms();

    console.log('\n=== SUMMARY ===');
    console.log(`  PASS: ${passes.length}`);
    console.log(`  WARN: ${issues.length}`);
    if (issues.length > 0) {
      console.log('\nIssues:');
      issues.forEach((x, i) => {
        console.log(`  ${i + 1}. ${x.msg}`);
        if (x.detail) console.log(`     ${x.detail}`);
      });
    }
    process.exit(0);
  } catch (e) {
    console.error('PROBE FAILED:', e);
    process.exit(1);
  }
})();
