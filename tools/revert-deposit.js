'use strict';
/**
 * tools/revert-deposit.js
 *
 * Revert ONE deposit settlement back to the holding state, so the admin "บันทึกคืนมัดจำ"
 * button reappears for that room (useful to re-test the return flow, e.g. the new
 * 🔍 ตรวจสลิป / verifyRefundSlip button — there is no in-UI revert).
 *
 * What it does (single room):
 *   deposits/{building}_{roomId}:
 *     status → 'holding'; DELETES the return fields (returnedAt, returnedAmount,
 *     deductions, refundBank, refundPromptPay, refundSlip, refundSlipVerified,
 *     finalBillTotal, settledBills, notes). Preserves amount / paidSoFar / receivedAt.
 *   tenants/{building}/list/{roomId} (best-effort, skipped on 404):
 *     depositStatus → 'holding'; DELETES depositReturnedAt.
 *
 * It does NOT touch bills. For a nest room there is no billing pipeline (no bills were
 * marked paid on settle); for a rooms room, any bills that #253 flipped to
 * paidVia:'deposit_settlement' are NOT un-flipped here — revert only re-opens the
 * deposit form. (If you need to un-pay those bills too, do it deliberately/separately.)
 *
 * SAFETY (§7-I — production financial data):
 *   - DEFAULT: dry-run — prints before→after, NO writes.
 *   - `--apply`: PATCH the two docs.
 *   - Required: --building <id> --room <id>.
 *   - Recovery: Firestore PITR can roll back any unintentional write within retention.
 *
 * Auth (same resolution as fix-orphan-leases.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login`)
 *
 * Usage:
 *   node tools/revert-deposit.js --building nest --room N101            # dry-run
 *   node tools/revert-deposit.js --building nest --room N101 --apply    # commit
 */

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Return fields cleared on revert (deleted from the doc via updateMask without a body value).
const CLEAR_FIELDS = [
  'returnedAt', 'returnedAmount', 'deductions', 'refundBank', 'refundPromptPay',
  'refundSlip', 'refundSlipVerified', 'finalBillTotal', 'settledBills', 'notes',
];

function parseArgs() {
  const out = { apply: process.argv.includes('--apply'), building: null, room: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i], next = process.argv[i + 1];
    if (a === '--building') { out.building = next; i++; }
    else if (a === '--room') { out.room = next; i++; }
  }
  return out;
}

function getAccessToken() {
  if (process.env.GCLOUD_ACCESS_TOKEN) { console.log('✓  Auth: GCLOUD_ACCESS_TOKEN env var'); return process.env.GCLOUD_ACCESS_TOKEN; }
  const ftCandidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of ftCandidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (ft.tokens && ft.tokens.access_token) { console.log('✓  Auth: firebase-tools OAuth token'); return ft.tokens.access_token; }
    } catch (_) {}
  }
  throw new Error('No credentials found. Run `firebase login` or set GCLOUD_ACCESS_TOKEN.');
}

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch (_) { resolve({ status: res.statusCode, data: raw }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function decode(field) {
  if (!field) return undefined;
  if ('stringValue'   in field) return field.stringValue;
  if ('integerValue'  in field) return parseInt(field.integerValue, 10);
  if ('doubleValue'   in field) return field.doubleValue;
  if ('booleanValue'  in field) return field.booleanValue;
  if ('nullValue'     in field) return null;
  if ('timestampValue'in field) return field.timestampValue;
  if ('arrayValue'    in field) return (field.arrayValue.values || []).map(decode);
  if ('mapValue'      in field) { const o = {}; for (const [k, v] of Object.entries(field.mapValue.fields || {})) o[k] = decode(v); return o; }
  return undefined;
}
function decodeDoc(doc) { const o = {}; for (const [k, v] of Object.entries((doc && doc.fields) || {})) o[k] = decode(v); return o; }

async function main() {
  const args = parseArgs();
  if (!args.building || !args.room) {
    console.error('Usage: node tools/revert-deposit.js --building <id> --room <id> [--apply]');
    process.exit(1);
  }
  const token = getAccessToken();
  const depId = `${args.building}_${args.room}`;
  const depUrl = `${FS_BASE}/deposits/${depId}`;
  const tenUrl = `${FS_BASE}/tenants/${args.building}/list/${args.room}`;

  console.log(`\n${args.apply ? '⚙️  APPLY' : '🔍 DRY-RUN'} — revert deposit ${depId} → holding\n`);

  // ── Read current deposit ──
  const depRes = await request('GET', depUrl, token);
  if (depRes.status === 404) { console.error(`❌ deposits/${depId} not found`); process.exit(1); }
  if (depRes.status !== 200) { console.error(`❌ read deposits/${depId} failed: ${depRes.status}`, depRes.data); process.exit(1); }
  const dep = decodeDoc(depRes.data);
  console.log('BEFORE  deposits/' + depId + ':');
  console.log('  status        =', dep.status);
  console.log('  returnedAmount =', dep.returnedAmount, ' returnedAt =', dep.returnedAt);
  console.log('  deductions     =', JSON.stringify(dep.deductions || []));
  console.log('  refundSlip     =', dep.refundSlip || '(none)', ' refundSlipVerified =', JSON.stringify(dep.refundSlipVerified || null));
  console.log('  preserved      → amount =', dep.amount, ' paidSoFar =', dep.paidSoFar, ' receivedAt =', dep.receivedAt);
  console.log('\nAFTER   deposits/' + depId + ':');
  console.log('  status         → "holding"');
  console.log('  cleared        →', CLEAR_FIELDS.join(', '));

  // ── Read tenant mirror (best-effort) ──
  const tenRes = await request('GET', tenUrl, token);
  const tenExists = tenRes.status === 200;
  if (tenExists) {
    const ten = decodeDoc(tenRes.data);
    console.log('\nBEFORE  tenants/' + args.building + '/list/' + args.room + ':  depositStatus =', ten.depositStatus, ' depositReturnedAt =', ten.depositReturnedAt);
    console.log('AFTER   → depositStatus = "holding"; depositReturnedAt cleared');
  } else {
    console.log(`\n(tenants/${args.building}/list/${args.room} → ${tenRes.status}; tenant mirror skipped)`);
  }

  if (!args.apply) { console.log('\n🔍 DRY-RUN — no writes. Re-run with --apply to commit.\n'); return; }

  // ── APPLY: PATCH deposit (updateMask deletes CLEAR_FIELDS, sets status+updatedAt) ──
  const depMask = ['status', 'updatedAt', ...CLEAR_FIELDS].map(f => `updateMask.fieldPaths=${f}`).join('&');
  const depBody = { fields: { status: { stringValue: 'holding' }, updatedAt: { stringValue: new Date().toISOString() } } };
  const depPatch = await request('PATCH', `${depUrl}?${depMask}`, token, depBody);
  if (depPatch.status !== 200) { console.error('❌ PATCH deposit failed:', depPatch.status, depPatch.data); process.exit(1); }
  console.log('\n✅ deposits/' + depId + ' → holding (return fields cleared)');

  if (tenExists) {
    const tenMask = ['depositStatus', 'depositReturnedAt'].map(f => `updateMask.fieldPaths=${f}`).join('&');
    const tenBody = { fields: { depositStatus: { stringValue: 'holding' } } };
    const tenPatch = await request('PATCH', `${tenUrl}?${tenMask}`, token, tenBody);
    if (tenPatch.status !== 200) console.warn('⚠️ PATCH tenant mirror failed (non-fatal):', tenPatch.status, tenPatch.data);
    else console.log('✅ tenants/' + args.building + '/list/' + args.room + ' → depositStatus holding');
  }
  console.log('\n✅ Done. Refresh the dashboard มัดจำ tab — "บันทึกคืนมัดจำ" should reappear for room ' + args.room + '.\n');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
