/**
 * preview-movein-proration.js — READ-ONLY dry-run for the move-in-month rent
 * proration (Phase 3, owner FINAL spec 2026-06-13). Shows, on REAL tenant data,
 * what each tenant's MOVE-IN-MONTH rent line WOULD become under the new rule —
 * WITHOUT writing anything. This is the §7-I/J gate before deploying a live-billing
 * change: eyeball the proration against real move-in dates first.
 *
 * The math is the EXACT same helpers the CF uses (no re-implementation, no drift):
 *   functions/_billWrite.js → moveInBoundaryYM / moveInDay / proratedMoveInRent / daysInMonth
 * (requiring _billWrite triggers admin.initializeApp() lazily but never connects —
 * this tool reads over REST with the Firebase CLI token, like preview-deposit-settlement.)
 *
 * NEVER MUTATES. Every network call is a GET read.
 *
 * Usage:
 *   node tools/preview-movein-proration.js                       # scan ALL tenants
 *   node tools/preview-movein-proration.js --building rooms --room 15
 *   npm run preview:movein-proration
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { moveInBoundaryYM, moveInDay, proratedMoveInRent, daysInMonth } = require('../functions/_billWrite.js');

const PROJECT_ID = 'the-green-haven';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const BUILDINGS = ['rooms', 'nest'];

// ── Pure preview core (exported for parity tests — NO I/O) ──────────────────
// Best-effort monthly rent from a tenant doc (field names vary across the data).
function tenantRent(t) {
  const lease = (t && t.lease) || {};
  const cand = [t && t.rent, t && t.monthlyRent, t && t.roomRate, t && t.price, lease.rent, lease.monthlyRent];
  for (const c of cand) { const n = Number(c); if (Number.isFinite(n) && n > 0) return n; }
  return 0;
}

// What the move-in-month bill's rent line would be for this tenant. Returns null
// when there is no parseable occupancy date (nothing to prorate).
function previewForTenant(t) {
  const boundaryYM = moveInBoundaryYM(t); // CE YYYYMM, occupancy (never contractStart §7-BBB)
  if (!boundaryYM) return null;
  const day = moveInDay(t);
  const rent = tenantRent(t);
  const daysOccupied = daysInMonth(boundaryYM) - day + 1;
  const proratedRent = proratedMoveInRent(rent, day, boundaryYM);
  return {
    moveInMonthCE: boundaryYM,
    moveInDay: day,
    daysOccupied,
    fullRent: rent,
    proratedRent,
    graced: rent > 0 && day >= 1 && daysOccupied <= 5,
    capped: rent > 0 && daysOccupied > 5 && Math.round((rent / 30) * daysOccupied) > rent,
    saving: rent > 0 ? rent - proratedRent : 0,
  };
}

// ── REST layer (thin, I/O — same token pattern as preview-deposit-settlement) ─
function readToken() {
  let raw;
  try { raw = fs.readFileSync(CONFIGSTORE, 'utf8'); }
  catch { throw new Error('No Firebase CLI session (~/.config/configstore/firebase-tools.json).\n  → Run `firebase login` first, then re-run this preview.'); }
  const tokens = JSON.parse(raw).tokens;
  if (!tokens || !tokens.access_token) throw new Error('No access_token in the firebase-tools configstore.\n  → Run `firebase login` first.');
  if (Date.now() >= (tokens.expires_at || 0)) {
    throw new Error('Firebase CLI access token is EXPIRED.\n  → Run any firebase command (e.g. `firebase projects:list`) to refresh, then re-run.');
  }
  return tokens.access_token;
}

function fsValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('mapValue' in field) {
    const out = {}; const f = field.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fsValue(f[k]);
    return out;
  }
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsValue);
  return undefined;
}
function flat(doc) {
  const out = {};
  if (doc && doc.fields) for (const k of Object.keys(doc.fields)) out[k] = fsValue(doc.fields[k]);
  return out;
}

async function getTenantDoc(token, building, room) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/${building}/list/${encodeURIComponent(room)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore HTTP ${res.status} on tenants/${building}/list/${room}: ${(await res.text()).slice(0, 200)}`);
  return flat(await res.json());
}

async function listTenants(token, building) {
  let pageToken = null; const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/${building}/list?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore HTTP ${res.status} listing tenants/${building}/list: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return all.map((d) => ({ room: d.name.split('/').pop(), data: flat(d) }));
}

// ── CLI presentation ────────────────────────────────────────────────────────
const fmt = (n) => '฿' + (Number(n) || 0).toLocaleString('en-US');
const ymStr = (ceYM) => `${Math.floor(ceYM / 100)}-${String(ceYM % 100).padStart(2, '0')}`;

function printRow(building, room, p) {
  const flags = [p.graced ? 'GRACE(ฟรี)' : '', p.capped ? 'CAPPED(เต็ม)' : ''].filter(Boolean).join(' ');
  console.log(`  ${building}/${room}  ย้ายเข้า ${ymStr(p.moveInMonthCE)} วันที่ ${p.moveInDay}  · อยู่ ${p.daysOccupied} วัน`
    + `  · ค่าเช่า ${fmt(p.fullRent)} → ${fmt(p.proratedRent)}`
    + (p.saving > 0 ? `  (ลด ${fmt(p.saving)})` : '')
    + (flags ? `  [${flags}]` : '')
    + (p.fullRent <= 0 ? '  ⚠️ rent unknown in tenant doc' : ''));
}

function parseArgs(argv) {
  const out = { building: null, room: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--building') out.building = argv[++i];
    else if (argv[i] === '--room') out.room = argv[++i];
  }
  return out;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  MOVE-IN-MONTH RENT PRORATION — READ-ONLY DRY-RUN (no writes)');
  console.log('  rent/30 × daysOccupied · ≤5 days = free · capped at one full month');
  console.log('════════════════════════════════════════════════════════════════');

  const args = parseArgs(process.argv.slice(2));
  const token = readToken();

  if (args.building && args.room) {
    const t = await getTenantDoc(token, args.building, args.room);
    if (!t) { console.log(`\n  No tenant at tenants/${args.building}/list/${args.room}\n`); return; }
    const p = previewForTenant(t);
    if (!p) { console.log(`\n  ${args.building}/${args.room}: no parseable move-in date — nothing to prorate.\n`); return; }
    console.log('');
    printRow(args.building, args.room, p);
    console.log('\n  (read-only — nothing was written)\n');
    return;
  }

  let total = 0, prorated = 0;
  for (const building of BUILDINGS) {
    let tenants = [];
    try { tenants = await listTenants(token, building); }
    catch (e) { console.log(`  (skip ${building}: ${e.message})`); continue; }
    console.log(`\n  ── ${building} (${tenants.length} tenant doc(s)) ──`);
    let shown = 0;
    for (const t of tenants) {
      const p = previewForTenant(t.data);
      if (!p) continue;
      total++; shown++;
      if (p.proratedRent !== p.fullRent) prorated++;
      printRow(building, t.room, p);
    }
    if (!shown) console.log('     (no tenants with a parseable move-in date)');
  }
  console.log(`\n  ${total} tenant(s) with a move-in date · ${prorated} whose move-in-month rent would differ from full.`);
  console.log('  (read-only — nothing was written. Proration applies ONLY to the move-in month; every later month bills full rent.)\n');
}

module.exports = { tenantRent, previewForTenant };

if (require.main === module) {
  main().catch((e) => { console.error('\nPREVIEW STOPPED:', e.message, '\n'); process.exitCode = 1; });
}
