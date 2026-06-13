/**
 * Read-only Firestore integrity probe — REST variant.
 *
 * Same intent as check-firestore-integrity.js but uses Firestore REST API
 * with the OAuth access token from the Firebase CLI configstore.
 * Avoids the firebase-admin ADC requirement so the daily probe can run
 * without gcloud or a service-account key.
 *
 * NEVER MUTATES.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ID = 'the-green-haven';
const RTDB_URL = 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const issues = [];
const passes = [];

function pass(msg) { passes.push(msg); console.log('  PASS  ' + msg); }
function warn(msg, detail) {
  issues.push({ msg, detail });
  console.log('  WARN  ' + msg);
  if (detail) console.log('        ' + detail);
}

function readToken() {
  const raw = fs.readFileSync(CONFIGSTORE, 'utf8');
  const obj = JSON.parse(raw);
  const tokens = obj.tokens;
  if (!tokens || !tokens.access_token) throw new Error('no access_token in firebase-tools configstore');
  if (Date.now() >= (tokens.expires_at || 0)) {
    console.log('  (note) access_token expired — running a Firebase CLI command first will refresh it');
  }
  return tokens.access_token;
}

async function fetchFs(token, urlPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${urlPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} on ${urlPath}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchRtdbShallow(token, dbPath) {
  // RTDB REST: ?shallow=true returns top-level keys as {key:true}
  const url = `${RTDB_URL}/${dbPath}.json?access_token=${encodeURIComponent(token)}&shallow=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`RTDB HTTP ${res.status} on ${dbPath}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// Firestore REST returns fields as { stringValue, integerValue, ... } maps
function fsValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('mapValue' in field) {
    const out = {};
    const f = field.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fsValue(f[k]);
    return out;
  }
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsValue);
  if ('nullValue' in field) return null;
  return undefined;
}

function flat(doc) {
  if (!doc.fields) return {};
  const out = {};
  for (const k of Object.keys(doc.fields)) out[k] = fsValue(doc.fields[k]);
  return out;
}

function docId(name) {
  return name.split('/').pop();
}

async function listAll(token, urlPath, pageSize = 300) {
  // listDocuments returns { documents: [...], nextPageToken? }
  let pageToken = null;
  const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${urlPath}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status} list ${urlPath}: ${txt.slice(0, 300)}`);
    }
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function checkTenants(token) {
  console.log('\n=== 1. TENANTS (canonical paths: tenants/rooms/list, tenants/nest/list) ===');
  for (const building of ['rooms', 'nest', 'RentRoom']) {
    let docs = [];
    try {
      docs = await listAll(token, `tenants/${building}/list`);
    } catch (e) {
      warn(`Could not list tenants/${building}/list`, e.message);
      continue;
    }
    if (docs.length === 0) {
      if (building === 'RentRoom') {
        pass(`tenants/RentRoom/list is empty (correct — canonical key is "rooms")`);
      } else {
        warn(`tenants/${building}/list is EMPTY`, 'expected populated');
      }
      continue;
    }
    console.log(`  -- tenants/${building}/list — ${docs.length} doc(s) --`);
    let okCount = 0;
    const missingFields = [];
    for (const doc of docs) {
      const id = docId(doc.name);
      const d = flat(doc);
      const missing = [];
      const hasName = d.tenantName || (d.firstName && d.lastName) || d.name;
      if (!hasName) missing.push('tenantName');
      const hasRent = d.monthlyRent || d.rentPrice;
      if (!hasRent) missing.push('monthlyRent');
      const hasStart = d.leaseStart || d.moveInDate;
      if (!hasStart) missing.push('leaseStart');
      if (missing.length === 0) okCount++;
      else missingFields.push({ id, missing });
    }
    if (missingFields.length === 0) {
      pass(`tenants/${building}/list — all ${docs.length} docs have name + rent + start`);
    } else {
      const detail = missingFields.slice(0, 8).map(x => `${x.id}:[${x.missing.join(',')}]`).join(' ');
      warn(
        `tenants/${building}/list — ${missingFields.length}/${docs.length} docs missing fields`,
        detail + (missingFields.length > 8 ? ` (+${missingFields.length - 8} more)` : '')
      );
    }
  }
}

async function checkVerifiedSlips(token) {
  console.log('\n=== 2. verifiedSlips (transRef SlipOK normalization) ===');
  let docs = [];
  try {
    // structured query → orderBy verifiedAt DESC limit 50
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'verifiedSlips' }],
        orderBy: [{ field: { fieldPath: 'verifiedAt' }, direction: 'DESCENDING' }],
        limit: 50
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      // Fall back to listDocuments
      console.log('  (structured query failed, falling back to list)');
      const all = await listAll(token, 'verifiedSlips', 50);
      docs = all.slice(0, 50);
    } else {
      const arr = await res.json();
      docs = arr.filter(x => x.document).map(x => x.document);
    }
  } catch (e) {
    warn('Could not query verifiedSlips', e.message);
    return;
  }
  if (docs.length === 0) {
    warn('verifiedSlips is EMPTY', 'no slips to inspect');
    return;
  }
  let withTransRef = 0, withTxnId = 0, withNeither = 0;
  const neitherIds = [];
  for (const doc of docs) {
    const id = docId(doc.name);
    const d = flat(doc);
    if (d.transRef) withTransRef++;
    if (d.transactionId) withTxnId++;
    if (!d.transRef && !d.transactionId) {
      withNeither++;
      if (neitherIds.length < 5) neitherIds.push(id);
    }
  }
  console.log(`  Sampled ${docs.length} docs: transRef=${withTransRef}  transactionId=${withTxnId}  neither=${withNeither}`);
  if (withNeither > 0) {
    warn(
      `verifiedSlips — ${withNeither}/${docs.length} sampled docs missing both transRef and transactionId`,
      `examples: ${neitherIds.join(', ')}`
    );
  } else {
    pass(`verifiedSlips — every sampled doc has at least one transaction id field`);
  }
  if (withTransRef === 0 && docs.length > 0) {
    warn(
      `verifiedSlips — ZERO sampled docs have transRef field`,
      'either nothing has been verified since the SlipOK normalization patch landed, or alias is broken'
    );
  }
}

async function checkMeterData(token) {
  console.log('\n=== 3. meter_data (current-month entries + V3 parsing) ===');
  let docs = [];
  try {
    docs = await listAll(token, 'meter_data', 300);
  } catch (e) {
    warn('Could not list meter_data', e.message);
  }
  if (!docs.length) {
    // Try RTDB fallback
    try {
      const v = await fetchRtdbShallow(token, 'meter_data');
      if (!v) {
        warn('meter_data EMPTY in both Firestore and RTDB', '');
        return;
      }
      console.log(`  Found RTDB meter_data, top-level keys: ${Object.keys(v).slice(0, 10).join(', ')}`);
      pass(`meter_data — RTDB fallback shape detected`);
    } catch (e) {
      warn('meter_data EMPTY in Firestore + RTDB read failed', e.message);
    }
    return;
  }
  console.log(`  Source: Firestore meter_data (${docs.length} doc(s))`);

  const now = new Date();
  const ceYear = now.getFullYear();
  const beShort = (ceYear + 543) % 100; // BE 2-digit
  const monthNum = now.getMonth() + 1;

  // Memory says doc id pattern: rooms_67_10_13 (canonical_BEyear_month_roomId)
  // and current month would be rooms_${beShort}_${monthNum}_*

  let currentMonthCount = 0;
  let v3OK = 0;
  const v3IssueIds = [];
  const yearMonthDistribution = {};

  for (const doc of docs) {
    const id = docId(doc.name);
    const d = flat(doc);

    // Distribution
    const ym = (d.yearMonth || `${d.year}_${d.month}`);
    yearMonthDistribution[ym] = (yearMonthDistribution[ym] || 0) + 1;

    // Current month detection — canonical schema: year (BE 2-digit) + month (1-12)
    const docMonth = Number(d.month);
    const docYear = Number(d.year);
    if (docMonth === monthNum && docYear === beShort) currentMonthCount++;

    // V3 schema check (canonical): eOld, eNew, wOld, wNew, year, month, building, roomId
    const hasV3 = ('eNew' in d) && ('wNew' in d) && ('year' in d) && ('month' in d);
    if (hasV3) v3OK++;
    else if (v3IssueIds.length < 5) v3IssueIds.push(id);
  }

  // Top distribution rows
  const topDist = Object.entries(yearMonthDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  console.log(`  Top yearMonth buckets: ${topDist.map(([k, n]) => `${k}=${n}`).join(', ')}`);
  console.log(`  Current month (BE${beShort}_${monthNum}) entries: ${currentMonthCount}`);
  console.log(`  V3-shape OK: ${v3OK}/${docs.length}`);

  if (currentMonthCount === 0) {
    warn(
      `meter_data — 0 entries for current month (BE${beShort}_${monthNum})`,
      `today ${now.toISOString().slice(0,10)}; admin may not have entered this month yet`
    );
  } else {
    pass(`meter_data — ${currentMonthCount} current-month entries present`);
  }

  if (v3OK === 0 && docs.length > 0) {
    warn(`meter_data — none of ${docs.length} sampled docs match V3 shape`, `examples: ${v3IssueIds.join(', ')}`);
  } else {
    pass(`meter_data — V3 shape recognized in ${v3OK}/${docs.length} sampled docs`);
  }
}

async function checkBuildingsRooms(token) {
  console.log('\n=== 4. buildings/{RentRoom|nest}/rooms/* (expected ~24 total) ===');
  let totalRooms = 0;
  for (const building of ['RentRoom', 'nest']) {
    let docs = [];
    try {
      docs = await listAll(token, `buildings/${building}/rooms`);
    } catch (e) {
      warn(`Could not list buildings/${building}/rooms`, e.message);
      continue;
    }
    if (docs.length === 0) {
      warn(`buildings/${building}/rooms is EMPTY`, '');
      continue;
    }
    const ids = docs.map(d => docId(d.name)).sort();
    console.log(`  buildings/${building}/rooms — ${docs.length} room(s):`);
    console.log(`    [${ids.join(', ')}]`);
    totalRooms += docs.length;
  }
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
    const token = readToken();
    await checkTenants(token);
    await checkVerifiedSlips(token);
    await checkMeterData(token);
    await checkBuildingsRooms(token);

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
    console.error('PROBE FAILED:', e.message);
    process.exit(1);
  }
})();
