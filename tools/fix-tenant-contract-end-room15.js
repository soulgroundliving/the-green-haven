/**
 * tools/fix-tenant-contract-end-room15.js
 *
 * One-shot cosmetic fix for tenants/rooms/list/15.contractEnd drift left
 * over from extensive 2026-05-21/22 renewLease + transferTenant testing.
 *
 * Background
 * ──────────
 * The tenant doc has TWO fields that should describe the same value:
 *   • lease.endDate   (canonical — reader source; matches the active
 *                      lease's moveOutDate via the embedded `lease`
 *                      subobject written by renewLease/transferTenant)
 *   • contractEnd     (legacy mirror — readers don't use this anymore,
 *                      but admin UI may render it for backwards-compat)
 *
 * After ~6 rounds of renewal testing, the active lease ended up with
 * lease.endDate=2027-01-21 but contractEnd kept getting stamped with
 * each test renewal's projected end (final value: 2031-10-21). Visible
 * via tools/inspect-room-leases.js — confirmed 2026-05-22 evening:
 *
 *   lease.endDate     = "2027-01-21"                  ✓ canonical (date-only)
 *   contractEnd       = "2031-10-21T00:00:00.000Z"    ✗ drift (ISO shape)
 *
 * contractEnd is stamped as a full toISOString() by renewLease/transferTenant,
 * so we patch with the ISO shape (not the date-only form) to avoid changing
 * the field type.
 *
 * No production reader uses contractEnd as the source of truth; this fix
 * is purely cosmetic to keep the admin tenant modal consistent on a
 * field-by-field inspection.
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — prints planned update, NO writes.
 * - --apply: executes the patch (per §7-I user-triggered).
 * - PRE-FLIGHT (always runs, even in dry-run):
 *     1. Tenant doc exists; activeContractId == CONTRACT_1779372584106_15
 *     2. tenant.lease.endDate == "2027-01-21" (refuse if drifted)
 *     3. tenant.contractEnd   == "2031-10-21" (refuse if already-fixed
 *        or new drift — script is one-shot)
 *
 * Scope is hardcoded (one room, one field, one tenant). Future drift
 * fixes need their own targeted script.
 *
 * Auth (same as cleanup-test-leases.js / cleanup-orphan-lease-storage.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login`)
 *
 * Usage:
 *   # Preview (default — no writes):
 *   node tools/fix-tenant-contract-end-room15.js
 *
 *   # Execute the patch:
 *   node tools/fix-tenant-contract-end-room15.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Hardcoded scope ────────────────────────────────────────────────────────────
const BUILDING            = 'rooms';
const ROOM_ID             = '15';
const EXPECTED_ACTIVE_ID  = 'CONTRACT_1779372584106_15';
const EXPECTED_LEASE_END  = '2027-01-21';
// contractEnd in this doc is a full ISO timestamp (renewLease/transferTenant
// write toISOString()). EXPECTED_OLD_VALUE + NEW_VALUE match that shape so
// we don't accidentally change the field's type/shape during the fix.
const EXPECTED_OLD_VALUE  = '2031-10-21T00:00:00.000Z';
const NEW_VALUE           = '2027-01-21T00:00:00.000Z';   // == lease.endDate, ISO shape

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
    } catch (_) { /* keep looking */ }
  }
  throw new Error('No credentials. Run `firebase login` first.');
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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
    if (body) req.write(JSON.stringify(body));
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
  if ('mapValue'       in field) {
    const out = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
      out[k] = decode(v);
    }
    return out;
  }
  return undefined;
}

function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decode(v);
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const args  = parseArgs();
  const token = getAccessToken();
  console.log(`\n🩹  fix-tenant-contract-end-room15 — ${args.apply ? '🔴 APPLY' : '🟢 DRY-RUN (no writes)'}`);
  console.log(`   target: tenants/${BUILDING}/list/${ROOM_ID}.contractEnd`);
  console.log(`   change: "${EXPECTED_OLD_VALUE}"  →  "${NEW_VALUE}"\n`);

  // ── Pre-flight ─────────────────────────────────────────────────────────
  console.log(`📋 Pre-flight checks:`);
  const docUrl = `${FS_BASE}/tenants/${encodeURIComponent(BUILDING)}/list/${encodeURIComponent(ROOM_ID)}`;
  const r = await request('GET', docUrl, token);
  if (r.status === 404) {
    console.error(`✗ ABORT: tenants/${BUILDING}/list/${ROOM_ID} does not exist`);
    process.exit(1);
  }
  if (r.status !== 200) {
    console.error(`✗ ABORT: tenant GET failed (HTTP ${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
    process.exit(1);
  }
  const tenant = decodeDoc(r.data);
  const activeId    = String(tenant.activeContractId || tenant.contractId || '');
  const contractEnd = String(tenant.contractEnd || '');
  const leaseEnd    = String(tenant.lease?.endDate || '');

  console.log(`   • activeContractId    = ${activeId || '(none)'}`);
  console.log(`   • lease.endDate       = ${leaseEnd || '(none)'}`);
  console.log(`   • contractEnd (curr)  = ${contractEnd || '(none)'}`);

  if (activeId !== EXPECTED_ACTIVE_ID) {
    console.error(`\n✗ ABORT: activeContractId is ${activeId}, expected ${EXPECTED_ACTIVE_ID}`);
    console.error(`   The tenant may have been re-tenanted since this fix was written — review state with tools/inspect-room-leases.js`);
    process.exit(1);
  }
  if (leaseEnd !== EXPECTED_LEASE_END) {
    console.error(`\n✗ ABORT: lease.endDate is "${leaseEnd}", expected "${EXPECTED_LEASE_END}"`);
    console.error(`   Canonical lease boundary has shifted — refusing to stamp the old value`);
    process.exit(1);
  }
  if (contractEnd !== EXPECTED_OLD_VALUE) {
    if (contractEnd === NEW_VALUE) {
      console.log(`\n✅ contractEnd already == "${NEW_VALUE}". No fix needed (idempotent re-run).`);
      return;
    }
    console.error(`\n✗ ABORT: contractEnd is "${contractEnd}", expected "${EXPECTED_OLD_VALUE}"`);
    console.error(`   New drift detected — review state with tools/inspect-room-leases.js`);
    process.exit(1);
  }
  console.log(`   ✓ All pre-flight checks pass.`);

  if (!args.apply) {
    console.log(`\n🟢  Dry-run complete — re-run with --apply to execute the patch.\n`);
    return;
  }

  // ── Execute ────────────────────────────────────────────────────────────
  console.log(`\n🔴 Patching contractEnd → "${NEW_VALUE}" …`);
  const patchUrl = `${docUrl}?updateMask.fieldPaths=contractEnd`;
  const body = {
    fields: { contractEnd: { stringValue: NEW_VALUE } },
  };
  const patch = await request('PATCH', patchUrl, token, body);
  if (patch.status !== 200) {
    console.error(`✗ PATCH failed (HTTP ${patch.status}): ${JSON.stringify(patch.data).slice(0, 300)}`);
    process.exit(2);
  }
  const after = decodeDoc(patch.data);
  console.log(`   ✓ patched. New contractEnd = "${after.contractEnd}"`);
  console.log(`\n📊 Result: ok=1, failed=0`);
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
