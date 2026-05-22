/**
 * tools/inspect-room-leases.js
 *
 * Read-only inspector for a single room's lease history. Used to preview
 * cleanup decisions before running tools/cleanup-test-leases.js.
 *
 * Usage:
 *   node tools/inspect-room-leases.js --building rooms --room 15
 *   node tools/inspect-room-leases.js --room 15           # building defaults to rooms
 *
 * Output columns: id, status, contractStart → moveOutDate, tenantId, contractDocument shape.
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function parseArgs() {
  const out = { building: 'rooms', room: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--building') { out.building = next; i++; }
    else if (a === '--room')     { out.room     = next; i++; }
  }
  if (!out.room) {
    console.error('--room <roomId> is required');
    process.exit(1);
  }
  return out;
}

function getAccessToken() {
  if (process.env.GCLOUD_ACCESS_TOKEN) return process.env.GCLOUD_ACCESS_TOKEN;
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (ft.tokens && ft.tokens.access_token) return ft.tokens.access_token;
    } catch (_) {}
  }
  throw new Error('No credentials. Run `firebase login` first.');
}

function request(method, url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (_) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function decode(field) {
  if (!field) return undefined;
  if ('stringValue'    in field) return field.stringValue;
  if ('integerValue'   in field) return parseInt(field.integerValue, 10);
  if ('doubleValue'    in field) return field.doubleValue;
  if ('booleanValue'   in field) return field.booleanValue;
  if ('nullValue'      in field) return null;
  if ('timestampValue' in field) return field.timestampValue;
  if ('mapValue'       in field) {
    const out = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) out[k] = decode(v);
    return out;
  }
  return undefined;
}

function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decode(v);
  return out;
}

async function listAllLeases(building, token) {
  let pageToken = null;
  const all = [];
  do {
    const qs = pageToken ? `?pageSize=300&pageToken=${encodeURIComponent(pageToken)}` : '?pageSize=300';
    const url = `${FS_BASE}/leases/${encodeURIComponent(building)}/list${qs}`;
    const res = await request('GET', url, token);
    if (res.status === 404) return [];
    if (res.status !== 200) throw new Error(`list GET ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    for (const d of res.data.documents || []) {
      const id = d.name.split('/').pop();
      all.push({ id, decoded: decodeDoc(d) });
    }
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);
  return all;
}

function summarizeDoc(decoded) {
  const hasCanonical = !!(decoded.documentURLs && decoded.documentURLs.agreement);
  const hasLegacy = !!decoded.contractDocument;
  if (hasCanonical && hasLegacy) return 'canonical+legacy';
  if (hasCanonical)              return 'canonical-only';
  if (hasLegacy)                 return 'legacy-only';
  return 'no-doc';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

(async () => {
  const args = parseArgs();
  const token = getAccessToken();
  console.log(`\n📋 Inspecting leases for ${args.building}/${args.room}`);
  console.log(`   project=${PROJECT_ID}  base=${FS_BASE}\n`);

  const all = await listAllLeases(args.building, token);
  const forRoom = all.filter(l => String(l.decoded.roomId || '') === String(args.room));
  forRoom.sort((a, b) => String(a.decoded.contractStart || a.decoded.moveInDate || '').localeCompare(String(b.decoded.contractStart || b.decoded.moveInDate || '')));

  if (forRoom.length === 0) {
    console.log(`(no leases found for room ${args.room} in building ${args.building})`);
    return;
  }

  console.log(`Found ${forRoom.length} lease(s):\n`);
  forRoom.forEach((l, i) => {
    const d = l.decoded;
    const num = String(i + 1).padStart(2, ' ');
    const status = String(d.status || '?').padEnd(11, ' ');
    const start = fmtDate(d.contractStart || d.moveInDate);
    const end   = fmtDate(d.moveOutDate || d.endDate);
    const name  = String(d.tenantName || '?').padEnd(18, ' ');
    const tid   = String(d.tenantId || '?').slice(0, 16);
    const shape = summarizeDoc(d);
    console.log(`  ${num}. ${l.id}`);
    console.log(`      status=${status}  ${start} → ${end}  tenant=${name}  tid=${tid}  doc=${shape}`);
    if (d.renewedToLeaseId)         console.log(`      → renewed to: ${d.renewedToLeaseId}`);
    if (d.transferredToLeaseId)     console.log(`      → transferred to: ${d.transferredToLeaseId}`);
    if (d.endReason)                console.log(`      endReason=${d.endReason}  endedAt=${fmtDate(d.endedAt)}`);
  });

  // Also peek at tenant doc
  console.log(`\n📌 Tenant doc tenants/${args.building}/list/${args.room}:`);
  const tenantUrl = `${FS_BASE}/tenants/${encodeURIComponent(args.building)}/list/${encodeURIComponent(args.room)}`;
  const tres = await request('GET', tenantUrl, token);
  if (tres.status === 404) {
    console.log('  (does not exist)');
  } else if (tres.status !== 200) {
    console.log(`  (error ${tres.status})`);
  } else {
    const td = decodeDoc(tres.data);
    console.log(`  name=${td.name}  tenantId=${td.tenantId}  activeContractId=${td.activeContractId}`);
    console.log(`  lease=${JSON.stringify(td.lease || null)}`);
    console.log(`  contractEnd=${fmtDate(td.contractEnd)}  status=${td.status || '?'}`);
  }

  // Active summary
  const active = forRoom.filter(l => l.decoded.status === 'active');
  const ended  = forRoom.filter(l => l.decoded.status === 'ended');
  const renewed = forRoom.filter(l => l.decoded.status === 'renewed');
  const transferred = forRoom.filter(l => l.decoded.status === 'transferred');
  console.log(`\n📊 Summary:  active=${active.length}  ended=${ended.length}  renewed=${renewed.length}  transferred=${transferred.length}  total=${forRoom.length}`);
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
