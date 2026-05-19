/**
 * tools/seed-lease-notif-test.js
 *
 * One-shot mock writer for `leaseNotifications/{building}_{room}_{tier}` —
 * used to verify the lease-expiry auto-notifier surface (🔔 bell in tenant_app,
 * admin dashboard subscriber) on real LIFF without waiting for a real lease
 * to enter the 60-day window.
 *
 * WHY a separate tool
 * ───────────────────
 * The §7-A/U/V/N safety pattern (claim-arrival timing in `_onLiffClaimsReady`
 * → idempotency guard → listener teardown → onSnapshot error callback) only
 * really exercises through the LIFF auth flow. Chrome MCP admin preview uses
 * URL params and skips the LIFF custom-token handshake, so a bug like §7-U
 * could pass admin preview and still break LIFF. The §7-J rule ("Static
 * deploy ≠ live-data verified") asks for an authenticated LIFF read path —
 * that requires a real notification doc, hence this seeder.
 *
 * Doc shape matches `ensureLeaseNotificationDoc()` in
 * functions/remindLeaseExpiry.js exactly so the subscriber + admin renderer
 * see the same fields they'd see from a real CF emission.
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — prints what would be written, NO writes.
 * - `--apply`: PATCH the doc (single-doc write, fully reversible via --delete).
 * - `--delete --apply`: DELETE the doc after testing.
 * - Recovery: Firestore PITR can restore a deleted mock within retention window;
 *   but since this is test data the user is expected to clean up promptly,
 *   recovery should never be needed.
 *
 * Auth (resolved in this order, same as cleanup-roomWifi.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login` is sufficient)
 *
 * Usage:
 *   # Dry-run preview (default):
 *   node tools/seed-lease-notif-test.js --building rooms --room 15 --tier 60
 *
 *   # Seed the mock for LIFF testing:
 *   node tools/seed-lease-notif-test.js --building rooms --room 15 --tier 60 --apply
 *
 *   # Cleanup after testing:
 *   node tools/seed-lease-notif-test.js --building rooms --room 15 --tier 60 --delete --apply
 *
 *   # Optional overrides:
 *   --days 28              days remaining at emit (default: tier midpoint)
 *   --tenant-name "..."    default '(LIFF verify test)'
 *   --tenant-id "uid-..."  default null
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
    building: null,
    room: null,
    tier: null,
    days: null,
    tenantName: '(LIFF verify test)',
    tenantId: null,
    delete: process.argv.includes('--delete'),
    apply: process.argv.includes('--apply'),
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--building')      { out.building = next; i++; }
    else if (a === '--room')     { out.room = String(next); i++; }
    else if (a === '--tier')     { out.tier = String(next); i++; }
    else if (a === '--days')     { out.days = parseInt(next, 10); i++; }
    else if (a === '--tenant-name') { out.tenantName = next; i++; }
    else if (a === '--tenant-id')   { out.tenantId = next; i++; }
  }
  return out;
}

function defaultDaysForTier(tier) {
  // Pick a value INSIDE the tier band so the CF anti-spam guard wouldn't
  // skip it on a hypothetical re-run. tier='expired' → 0.
  if (tier === '60') return 55;
  if (tier === '30') return 25;
  if (tier === '14') return 10;
  if (tier === 'expired') return 0;
  return null;
}

function validateArgs(args) {
  const errors = [];
  if (!args.building) errors.push('--building (rooms|nest) required');
  else if (!['rooms', 'nest'].includes(args.building)) {
    errors.push(`--building must be 'rooms' or 'nest' (got: ${args.building})`);
  }
  if (!args.room) errors.push('--room <id> required');
  if (!args.tier) errors.push('--tier (60|30|14|expired) required');
  else if (!['60', '30', '14', 'expired'].includes(args.tier)) {
    errors.push(`--tier must be one of 60|30|14|expired (got: ${args.tier})`);
  }
  if (args.days === null) args.days = defaultDaysForTier(args.tier);
  return errors;
}

// ── Access token resolution (same shape as cleanup-roomWifi.js) ────────────────

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
      const ft  = JSON.parse(fs.readFileSync(p, 'utf8'));
      const tok = ft.tokens;
      if (tok && tok.access_token && tok.expires_at > Date.now()) {
        console.log('✓  Auth: firebase-tools OAuth token');
        return tok.access_token;
      }
      if (tok && tok.access_token) {
        console.warn('⚠️  firebase-tools token may be expired — proceeding anyway');
        return tok.access_token;
      }
    } catch (_) {}
  }
  throw new Error(
    'No credentials found.\n' +
    '  Option A: pass GCLOUD_ACCESS_TOKEN env var (pair with `gcloud auth application-default print-access-token`)\n' +
    '  Option B: run `firebase login` (uses firebase-tools token)'
  );
}

// ── Firestore REST helpers ─────────────────────────────────────────────────────

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) { fields[k] = { nullValue: null }; }
    else if (typeof v === 'string')    { fields[k] = { stringValue: v }; }
    else if (typeof v === 'number' && Number.isInteger(v)) { fields[k] = { integerValue: String(v) }; }
    else if (typeof v === 'number')    { fields[k] = { doubleValue: v }; }
    else if (typeof v === 'boolean')   { fields[k] = { booleanValue: v }; }
    else if (v instanceof Date)        { fields[k] = { timestampValue: v.toISOString() }; }
    else throw new Error(`Cannot encode value for ${k}: ${typeof v}`);
  }
  return fields;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function buildDocPayload(args) {
  const now = new Date();
  const leaseEnd = new Date(now.getTime() + args.days * 24 * 60 * 60 * 1000);
  return {
    building: args.building,
    room: String(args.room),
    tenantId: args.tenantId,
    tenantName: args.tenantName,
    tier: args.tier,
    leaseEndDate: leaseEnd,
    daysRemainingAtEmit: args.days,
    createdAt: now,
    status: 'unread',
  };
}

async function main() {
  const args = parseArgs();
  const errors = validateArgs(args);
  if (errors.length) {
    console.error('Argument errors:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nRun without args to see usage in file header.');
    process.exit(1);
  }

  const docId = `${args.building}_${args.room}_${args.tier}`;
  const mode  = args.delete ? 'DELETE' : 'SEED';
  const dry   = !args.apply;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  lease-notif test ${mode} — ${dry ? 'DRY RUN' : '⚠️  APPLY MODE'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Target: leaseNotifications/${docId}`);
  console.log('');

  if (!args.delete) {
    const payload = buildDocPayload(args);
    console.log('Doc payload:');
    for (const [k, v] of Object.entries(payload)) {
      console.log(`  ${k}: ${v instanceof Date ? v.toISOString() : JSON.stringify(v)}`);
    }
    console.log('');
  }

  if (dry) {
    console.log(`DRY RUN — nothing written. Re-run with --apply to ${mode.toLowerCase()}.`);
    return;
  }

  const token = getAccessToken();
  const url = `${FS_BASE}/leaseNotifications/${encodeURIComponent(docId)}`;

  if (args.delete) {
    const res = await request('DELETE', url, token);
    if (res.status === 200 || res.status === 204) {
      console.log(`✓ Deleted leaseNotifications/${docId}`);
    } else if (res.status === 404) {
      console.log(`(no-op) leaseNotifications/${docId} did not exist`);
    } else {
      throw new Error(`DELETE failed: ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    }
  } else {
    const payload = buildDocPayload(args);
    const body = { fields: encodeFields(payload) };
    const res = await request('PATCH', url, token, body);
    if (res.status === 200) {
      console.log(`✓ Wrote leaseNotifications/${docId}`);
      console.log('');
      console.log('Next steps:');
      console.log(`  1. Open LIFF tenant_app as ${args.building} room ${args.room}`);
      console.log('  2. Bell badge should show count ≥1');
      console.log('  3. Open the bell — lease alert appears with amber/orange/red border per tier');
      console.log('  4. Click the alert → navigates to contract-action-page');
      console.log('  5. Doc flips to status:"read" + lastReadAt timestamp');
      console.log('');
      console.log('Cleanup (run when done):');
      console.log(`  node tools/seed-lease-notif-test.js --building ${args.building} --room ${args.room} --tier ${args.tier} --delete --apply`);
    } else {
      throw new Error(`PATCH failed: ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
