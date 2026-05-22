/**
 * tools/cleanup-test-leases.js
 *
 * One-shot cleanup of room 15 test data: HARD-DELETE 5 non-active legacy
 * leases left over from extensive renewLease/transferTenant testing during
 * 2026-05-21/22 sprints. The active lease + the legacy real-tenant orphan
 * (#1 LEGACY_TENANT_..._1778006886119 = สมชาย สิบห้าว, kept as historical
 * pointer to the pre-test era) are intentionally PRESERVED.
 *
 * Scope is hardcoded — NOT computed from current state — so re-running this
 * script after a future test session would only touch the 5 listed IDs.
 * Future test cleanup needs its own targeted script.
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — prints exact DELETE ops, NO writes.
 * - --apply: executes the deletes (per §7-I user-triggered).
 * - PRE-FLIGHT (always runs, even in dry-run):
 *     1. Each target's CURRENT status must be in {renewed, transferred, ended}.
 *        If any status=='active' is seen → ABORT (would orphan the tenant).
 *     2. Tenant doc tenants/rooms/list/15.activeContractId must NOT be in the
 *        delete set. If it points at one of these IDs → ABORT.
 *     3. Each target must actually exist. Missing docs are flagged but don't
 *        abort (idempotent re-run).
 * - Recovery: Firestore PITR can roll back any unintentional delete within
 *   the 7-day retention window. The script commit + git diff are the
 *   permanent audit record of what was deleted.
 *
 * Auth (same pattern as fix-orphan-leases.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login`)
 *
 * Usage:
 *   # Preview (default — no writes):
 *   node tools/cleanup-test-leases.js
 *
 *   # Execute deletes:
 *   node tools/cleanup-test-leases.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Hardcoded scope ────────────────────────────────────────────────────────────
// 5 lease docs to delete. All verified via tools/inspect-room-leases.js
// at 2026-05-22 evening — see next_session_handoff_2026_05_22_test_cleanup.md.
const BUILDING = 'rooms';
const ROOM_ID  = '15';
const DELETE_IDS = [
  'rooms_15_TENANT_1774620396700_15_1777195379927',  // status=renewed (legacy-id-shape)
  'CONTRACT_1779370223943_17',                       // status=renewed
  'CONTRACT_1779341731750_15',                       // status=transferred
  'CONTRACT_1779370734135_15',                       // status=renewed
  'CONTRACT_1779372399618_15',                       // status=renewed (renewedTo active)
];
const ALLOWED_STATUSES = new Set(['renewed', 'transferred', 'ended']);

// ── CLI ────────────────────────────────────────────────────────────────────────

function parseArgs() {
  return { apply: process.argv.includes('--apply') };
}

// ── Auth ───────────────────────────────────────────────────────────────────────

function getAccessToken() {
  if (process.env.GCLOUD_ACCESS_TOKEN) {
    console.log('✓  Auth: GCLOUD_ACCESS_TOKEN env var');
    return process.env.GCLOUD_ACCESS_TOKEN;
  }
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (ft.tokens && ft.tokens.access_token) {
        console.log('✓  Auth: firebase-tools OAuth token');
        return ft.tokens.access_token;
      }
    } catch (_) {}
  }
  throw new Error('No credentials. Run `firebase login` first.');
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

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

async function fetchLease(building, leaseId, token) {
  const url = `${FS_BASE}/leases/${encodeURIComponent(building)}/list/${encodeURIComponent(leaseId)}`;
  const res = await request('GET', url, token);
  if (res.status === 404) return { exists: false };
  if (res.status !== 200) {
    throw new Error(`lease GET ${leaseId} failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return { exists: true, decoded: decodeDoc(res.data) };
}

async function fetchTenantDoc(building, roomId, token) {
  const url = `${FS_BASE}/tenants/${encodeURIComponent(building)}/list/${encodeURIComponent(roomId)}`;
  const res = await request('GET', url, token);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`tenant GET failed (HTTP ${res.status})`);
  return decodeDoc(res.data);
}

async function deleteLease(building, leaseId, token) {
  const url = `${FS_BASE}/leases/${encodeURIComponent(building)}/list/${encodeURIComponent(leaseId)}`;
  const res = await request('DELETE', url, token);
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`DELETE ${leaseId} failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
}

(async () => {
  const args = parseArgs();
  const token = getAccessToken();
  console.log(`\n🧹  cleanup-test-leases — ${args.apply ? '🔴 APPLY' : '🟢 DRY-RUN (no writes)'}`);
  console.log(`   target: ${BUILDING}/${ROOM_ID}, ${DELETE_IDS.length} lease(s)\n`);

  // ── Pre-flight 1: tenant doc safety ───────────────────────────────────────
  const tenant = await fetchTenantDoc(BUILDING, ROOM_ID, token);
  if (!tenant) {
    console.error(`✗ ABORT: tenants/${BUILDING}/list/${ROOM_ID} does not exist`);
    process.exit(1);
  }
  const activeId = String(tenant.activeContractId || tenant.contractId || '');
  console.log(`📌 Tenant safety check: activeContractId = ${activeId || '(none)'}`);
  if (!activeId) {
    console.error(`✗ ABORT: tenant has no activeContractId — room appears vacant; manual review needed`);
    process.exit(1);
  }
  if (DELETE_IDS.includes(activeId)) {
    console.error(`✗ ABORT: activeContractId ${activeId} is IN delete set — would orphan tenant`);
    process.exit(1);
  }
  console.log(`   ✓ activeContractId not in delete set`);

  // ── Pre-flight 2: per-lease status check ──────────────────────────────────
  console.log(`\n📋 Per-lease pre-flight:`);
  const plan = [];
  for (const id of DELETE_IDS) {
    const r = await fetchLease(BUILDING, id, token);
    if (!r.exists) {
      console.log(`   - ${id}  → SKIP (missing — idempotent re-run?)`);
      plan.push({ id, action: 'skip', reason: 'missing' });
      continue;
    }
    const status = String(r.decoded.status || '?');
    if (!ALLOWED_STATUSES.has(status)) {
      console.error(`✗ ABORT: ${id} has status=${status} — refusing (only renewed/transferred/ended allowed)`);
      process.exit(1);
    }
    const start = String(r.decoded.contractStart || r.decoded.moveInDate || '').slice(0, 10);
    const end   = String(r.decoded.moveOutDate   || r.decoded.endDate    || '').slice(0, 10);
    console.log(`   - ${id}`);
    console.log(`        status=${status.padEnd(11, ' ')} ${start} → ${end}`);
    plan.push({ id, action: 'delete', status });
  }

  const deleteCount = plan.filter(p => p.action === 'delete').length;
  const skipCount   = plan.filter(p => p.action === 'skip').length;

  console.log(`\n📊 Plan: delete=${deleteCount}, skip=${skipCount}`);

  if (!args.apply) {
    console.log(`\n🟢  Dry-run complete — re-run with --apply to execute.\n`);
    return;
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  console.log(`\n🔴 Executing deletes…`);
  let ok = 0, fail = 0;
  for (const p of plan) {
    if (p.action !== 'delete') continue;
    try {
      await deleteLease(BUILDING, p.id, token);
      console.log(`   ✓ deleted ${p.id}`);
      ok++;
    } catch (e) {
      console.error(`   ✗ FAILED ${p.id}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n📊 Result: ok=${ok}, failed=${fail}, skipped=${skipCount}`);
  if (fail > 0) process.exit(2);
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
