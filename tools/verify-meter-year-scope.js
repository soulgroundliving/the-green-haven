/**
 * §7-AAA verification — READ-ONLY. NEVER MUTATES. NEVER PRINTS THE TOKEN.
 *
 * Proves the admin meter_data fix (commit d89b7cd):
 *   OLD: query(collection(db,'meter_data'), limit(N))     // doc-ID-ASCENDING → drops NEWEST
 *   NEW: query(collection(db,'meter_data'), where('year','in',[BE-1,BE,'BE-1','BE']))
 *
 * It runs the EXACT server-side equivalent of the fixed client query via Firestore
 * REST runQuery, and contrasts it with the doc-ID-ascending window an unordered
 * limit() would have returned. If the fixed query includes the latest month while
 * the old cap window would have dropped it, the fix is proven at the data layer.
 *
 * Auth: reuses the Firebase CLI cached OAuth token (configstore). Run any
 * `firebase` command first if the token has expired.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ID = 'the-green-haven';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

// The exact caps the old code used (so the contrast is faithful):
//   dashboard-extra.js setupMeterDataListener watch  -> limit(500)
//   behavioral-energy (trend) / insights-operations (spike) -> limit(5000)
const OLD_CAPS = [500, 5000];

function readToken() {
  const o = JSON.parse(fs.readFileSync(CONFIGSTORE, 'utf8'));
  const t = o.tokens || {};
  if (!t.access_token) throw new Error('no access_token in firebase-tools configstore');
  if (Date.now() >= (t.expires_at || 0)) {
    console.log('  (note) token expired — run any `firebase` command to refresh, then re-run.');
  }
  return t.access_token;
}

// REST returns each field as { integerValue:"69" } | { stringValue:"69" } | ...
function fieldType(field) {
  if (!field) return ['missing', undefined];
  if ('integerValue' in field) return ['integer', Number(field.integerValue)];
  if ('stringValue' in field) return ['string', field.stringValue];
  if ('doubleValue' in field) return ['double', field.doubleValue];
  if ('booleanValue' in field) return ['boolean', field.booleanValue];
  if ('nullValue' in field) return ['null', null];
  return [Object.keys(field)[0] || 'unknown', undefined];
}

async function listAll(token, coll, pageSize = 300) {
  let pageToken = null;
  const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${coll}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`);
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return all;
}

// Mirror of the fixed client query: where('year','in',[BE-1, BE, 'BE-1', 'BE'])
async function runYearInQuery(token, yearScope) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const values = yearScope.map(v =>
    typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) }
  );
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'meter_data' }],
      where: { fieldFilter: { field: { fieldPath: 'year' }, op: 'IN', value: { arrayValue: { values } } } },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`runQuery HTTP ${res.status}: ${(await res.text()).slice(0, 350)}`);
  const arr = await res.json();
  return arr.filter(x => x.document).map(x => x.document);
}

(async () => {
  const token = readToken();
  const curBE = new Date().getFullYear() - 1957; // 2026 -> 69 (2-digit BE, §7-E)
  const curMonth = new Date().getMonth() + 1;
  const yearScope = [curBE - 1, curBE, String(curBE - 1), String(curBE)];

  console.log('=== §7-AAA admin meter_data — year-scope verification (READ-ONLY) ===');
  console.log(`Today ${new Date().toISOString().slice(0, 10)} | curBE(2-digit)=${curBE} | month=${curMonth}`);
  console.log(`Fixed query scope: where('year','in',[${yearScope.join(', ')}])`);

  // ---- Ground truth: full collection ----
  const all = await listAll(token, 'meter_data');
  console.log(`\nmeter_data total docs: ${all.length}`);
  if (!all.length) {
    console.log('Collection empty — nothing to verify. (Firestore short-circuits empty queries; see §7-J sub-lesson.)');
    process.exit(0);
  }

  const yearTypeCount = {};
  const yearDist = {};
  const ymDist = {};
  let latest = null; // {y, m, id}
  for (const doc of all) {
    const id = doc.name.split('/').pop();
    const f = doc.fields || {};
    const [yt, yv] = fieldType(f.year);
    const [, mv] = fieldType(f.month);
    yearTypeCount[yt] = (yearTypeCount[yt] || 0) + 1;
    yearDist[String(yv)] = (yearDist[String(yv)] || 0) + 1;
    const ny = Number(yv), nm = Number(mv);
    ymDist[`${yv}_${mv}`] = (ymDist[`${yv}_${mv}`] || 0) + 1;
    if (Number.isFinite(ny) && Number.isFinite(nm)) {
      if (!latest || ny > latest.y || (ny === latest.y && nm > latest.m)) latest = { y: ny, m: nm, id };
    }
  }
  console.log(`year field TYPES:  ${JSON.stringify(yearTypeCount)}`);
  console.log(`year DISTRIBUTION: ${JSON.stringify(yearDist)}`);
  const topYm = Object.entries(ymDist).sort((a, b) => {
    const [ay, am] = a[0].split('_').map(Number), [by, bm] = b[0].split('_').map(Number);
    return by - ay || bm - am;
  }).slice(0, 8);
  console.log(`newest year_month buckets: ${topYm.map(([k, n]) => `${k}=${n}`).join('  ')}`);
  console.log(`LATEST month present: ${latest ? `${latest.id} (year=${latest.y}, month=${latest.m})` : '(none parseable)'}`);

  // ---- What an unordered limit() returns (doc-ID ascending) ----
  const idsAsc = all.map(d => d.name.split('/').pop()).sort();
  console.log(`\ndoc-ID ascending order (what an unordered limit() keeps FIRST):`);
  console.log(`  first 4: ${idsAsc.slice(0, 4).join(', ')}`);
  console.log(`  last  4: ${idsAsc.slice(-4).join(', ')}`);
  for (const cap of OLD_CAPS) {
    const windowIds = idsAsc.slice(0, cap);
    const inWindow = latest ? windowIds.includes(latest.id) : false;
    const dropped = Math.max(0, all.length - cap);
    console.log(`  OLD limit(${cap}): keeps ${windowIds.length}, drops ${dropped} newest → latest month (${latest && latest.id}) kept: ${inWindow ? 'YES' : 'NO (dropped!)'}`);
  }

  // ---- The FIXED query (exact server-side equivalent) ----
  let got;
  try {
    got = await runYearInQuery(token, yearScope);
  } catch (e) {
    console.log(`\nFAIL  fixed query errored: ${e.message}`);
    console.log('      (a FAILED_PRECONDITION here would mean the single-field index is missing — §7-N)');
    process.exit(1);
  }
  const gotIds = got.map(d => d.name.split('/').pop());
  const latestIncluded = latest ? gotIds.includes(latest.id) : false;
  const curMonthDocs = got.filter(d => {
    const f = d.fields || {};
    const [, yv] = fieldType(f.year);
    const [, mv] = fieldType(f.month);
    return Number(yv) === curBE && Number(mv) === curMonth;
  });
  console.log(`\nFIXED where('year','in',[...]) returned: ${got.length} docs`);
  console.log(`  latest-month doc (${latest && latest.id}) included: ${latestIncluded ? 'YES' : 'NO'}`);
  console.log(`  current-month (BE${curBE} month ${curMonth}) docs returned: ${curMonthDocs.length}`);

  // ---- Verdict ----
  console.log('\n=== VERDICT ===');
  const yearKeys = Object.keys(yearDist).filter(k => k !== 'undefined' && k !== 'null');
  const yearIs2DigitBE = yearKeys.length > 0 && yearKeys.every(k => {
    const n = Number(k);
    return Number.isFinite(n) && n >= 60 && n <= 75;
  });
  const lines = [];
  lines.push([yearIs2DigitBE, `year is 2-digit BE (§7-E assumption the 'in' scope relies on) — values: ${yearKeys.join(',')}`]);
  lines.push([latestIncluded, `fixed query INCLUDES the latest month (${latest && latest.id})`]);
  lines.push([got.length > 0, `fixed query is non-empty (${got.length} docs) — no missing-index / empty-result regression`]);
  let allPass = true;
  for (const [ok, msg] of lines) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!ok) allPass = false;
  }
  console.log(allPass
    ? '\nALL PASS — the year-scoped query serves the newest month at the data layer.'
    : '\nFAILURES above — investigate before claiming #2 verified.');
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
