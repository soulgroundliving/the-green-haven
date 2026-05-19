/**
 * tools/fix-orphan-leases.js
 *
 * One-shot cleanup for orphan "active" leases left behind by pre-fix
 * archiveTenantOnMoveOut / transitionToPlayer / revertTransitionToPlayer
 * (the §7-L bug fixed 2026-05-20 in commit X).
 *
 * Detection logic:
 *   For each lease where status='active':
 *     Read tenants/{lease.building}/list/{lease.roomId}
 *     - If live doc missing OR tenantId empty → ORPHAN (tenant was archived)
 *     - If live doc has tenantId different from lease.tenantId → ORPHAN (room
 *       was reassigned to a new tenant without ending this one)
 *     - Else → KEEP (real active tenancy)
 *
 *   ORPHAN action: PATCH lease with
 *     status='ended', endedAt=<lease.endDate || now>, endReason='orphan_cleanup_2026-05-20'.
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — prints decision per lease, NO writes.
 * - `--apply`: PATCH only the ORPHAN docs (single-doc writes, idempotent).
 * - `--building rooms`: scope to one building (default: rooms + nest).
 * - Recovery: Firestore PITR can roll back any unintentional write within
 *   retention. To re-activate a wrongly-ended lease, use revertTransitionToPlayer
 *   (sets status='active' atomically with restore).
 *
 * Auth (resolved in this order, same as seed-lease-notif-test.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login` is sufficient)
 *
 * Usage:
 *   # Dry-run preview (default, scans rooms + nest):
 *   node tools/fix-orphan-leases.js
 *
 *   # Scope to one building:
 *   node tools/fix-orphan-leases.js --building rooms
 *
 *   # Commit the cleanup:
 *   node tools/fix-orphan-leases.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── CLI parsing ────────────────────────────────────────────────────────────────

function parseArgs() {
  const out = {
    buildings: ['rooms', 'nest'],
    apply: process.argv.includes('--apply'),
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--building') {
      out.buildings = [next];
      i++;
    }
  }
  return out;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

function getAccessToken() {
  if (process.env.GCLOUD_ACCESS_TOKEN) {
    console.log('✓  Auth: GCLOUD_ACCESS_TOKEN env var');
    return process.env.GCLOUD_ACCESS_TOKEN;
  }
  const ftCandidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of ftCandidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft = JSON.parse(fs.readFileSync(p, 'utf8'));
      const tok = ft.tokens;
      if (tok && tok.access_token) {
        console.log('✓  Auth: firebase-tools OAuth token');
        return tok.access_token;
      }
    } catch (_) {}
  }
  throw new Error('No credentials found. Run `firebase login` or set GCLOUD_ACCESS_TOKEN.');
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (_) { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Firestore field decoder for the small set of scalar types we need here.
function decode(field) {
  if (!field) return undefined;
  if ('stringValue'    in field) return field.stringValue;
  if ('integerValue'   in field) return parseInt(field.integerValue, 10);
  if ('doubleValue'    in field) return field.doubleValue;
  if ('booleanValue'   in field) return field.booleanValue;
  if ('nullValue'      in field) return null;
  if ('timestampValue' in field) return field.timestampValue;
  return undefined;
}

function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decode(v);
  return out;
}

// ── Core ──────────────────────────────────────────────────────────────────────

async function listActiveLeases(building, token) {
  // List ALL leases for the building, filter client-side. runQuery returns
  // 401 ACCESS_TOKEN_TYPE_UNSUPPORTED with firebase-tools OAuth scope, while
  // plain GET on collections works (same pattern as seed-lease-notif-test.js
  // PATCH operations). Trade-off: pulls full collection vs server-filtered —
  // acceptable for cleanup runs (rooms+nest have <100 leases each).
  let pageToken = null;
  const all = [];
  do {
    const qs = pageToken ? `?pageSize=300&pageToken=${encodeURIComponent(pageToken)}` : '?pageSize=300';
    const url = `${FS_BASE}/leases/${encodeURIComponent(building)}/list${qs}`;
    const res = await request('GET', url, token, null);
    if (res.status === 404) return [];  // building has no leases collection yet
    if (res.status !== 200) {
      throw new Error(`list GET failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 400)}`);
    }
    const docs = res.data.documents || [];
    for (const d of docs) {
      const decoded = decodeDoc(d);
      if (decoded.status !== 'active') continue;
      const id = d.name.split('/').pop();
      all.push({ id, name: d.name, fields: d.fields, decoded });
    }
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function fetchTenantDoc(building, roomId, token) {
  const url = `${FS_BASE}/tenants/${encodeURIComponent(building)}/list/${encodeURIComponent(roomId)}`;
  const res = await request('GET', url, token, null);
  if (res.status === 404) return null;
  if (res.status !== 200) {
    throw new Error(`tenant GET failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`);
  }
  return decodeDoc(res.data);
}

async function patchLeaseEnded(building, leaseId, endDate, token) {
  const url = `${FS_BASE}/leases/${encodeURIComponent(building)}/list/${encodeURIComponent(leaseId)}?updateMask.fieldPaths=status&updateMask.fieldPaths=endedAt&updateMask.fieldPaths=endReason&updateMask.fieldPaths=endedBy`;
  const body = {
    fields: {
      status:    { stringValue: 'ended' },
      endedAt:   { timestampValue: endDate.toISOString() },
      endReason: { stringValue: 'orphan_cleanup_2026-05-20' },
      endedBy:   { stringValue: 'tools/fix-orphan-leases.js' },
    },
  };
  const res = await request('PATCH', url, token, body);
  if (res.status !== 200) {
    throw new Error(`PATCH failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const dry  = !args.apply;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  fix-orphan-leases — ${dry ? 'DRY RUN' : '⚠️  APPLY MODE'}`);
  console.log(`  Buildings: ${args.buildings.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const token = getAccessToken();

  let totalActive  = 0;
  let totalOrphans = 0;
  let totalApplied = 0;
  const orphans   = [];

  for (const building of args.buildings) {
    console.log(`\n── Scanning building: ${building} ──`);
    let leases;
    try {
      leases = await listActiveLeases(building, token);
    } catch (e) {
      console.error(`  ✗ Failed to list active leases for ${building}: ${e.message}`);
      continue;
    }
    console.log(`  Found ${leases.length} active leases`);
    totalActive += leases.length;

    for (const lease of leases) {
      const leaseTenantId = lease.decoded.tenantId || '';
      const roomId        = lease.decoded.roomId || '';
      const tenantDoc = await fetchTenantDoc(building, roomId, token);

      let verdict;
      if (!tenantDoc) {
        verdict = 'ORPHAN (live tenant doc missing)';
      } else if (!tenantDoc.tenantId) {
        verdict = `ORPHAN (live tenants/${building}/list/${roomId}.tenantId is empty — was archived)`;
      } else if (tenantDoc.tenantId !== leaseTenantId) {
        verdict = `ORPHAN (live tenantId='${tenantDoc.tenantId}' ≠ lease tenantId='${leaseTenantId}' — room reassigned)`;
      } else {
        verdict = 'KEEP (active tenant matches lease)';
      }

      const isOrphan = verdict.startsWith('ORPHAN');
      console.log(`  ${isOrphan ? '✗' : '✓'} ${building}/${lease.id} room=${roomId} tenantId=${leaseTenantId}`);
      console.log(`      ${verdict}`);
      if (isOrphan) {
        totalOrphans++;
        orphans.push({ building, leaseId: lease.id, leaseEndDate: lease.decoded.endDate });
      }
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Summary: ${totalActive} active leases scanned, ${totalOrphans} orphans`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (dry) {
    console.log('');
    console.log('DRY RUN — no writes. Re-run with --apply to end the orphan leases.');
    return;
  }

  if (totalOrphans === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log('');
  console.log(`Applying ${totalOrphans} updates (status → ended, endReason=orphan_cleanup_2026-05-20)...`);
  for (const orphan of orphans) {
    // Use original lease.endDate when present, else now. The latter is rare
    // (most leases have endDate set from the rental contract).
    let endDate = new Date();
    if (orphan.leaseEndDate) {
      const d = new Date(orphan.leaseEndDate);
      if (!isNaN(d.getTime())) endDate = d;
    }
    try {
      await patchLeaseEnded(orphan.building, orphan.leaseId, endDate, token);
      console.log(`  ✓ ${orphan.building}/${orphan.leaseId} — status=ended endedAt=${endDate.toISOString()}`);
      totalApplied++;
    } catch (e) {
      console.error(`  ✗ ${orphan.building}/${orphan.leaseId} — PATCH failed: ${e.message}`);
    }
  }

  console.log('');
  console.log(`Done — ${totalApplied} / ${totalOrphans} leases updated.`);
  if (totalApplied < totalOrphans) {
    console.log('Some PATCHes failed. Check log above.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
