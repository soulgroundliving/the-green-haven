/**
 * tools/smoke-test/verify.js
 *
 * Read-only post-condition asserter for the Chrome MCP smoke test playbook.
 * Run BETWEEN Chrome MCP steps in `tasks/smoke-test-admin-playbook.md` to
 * confirm that what the playbook saw in the browser also matches Firestore
 * + RTDB ground truth.
 *
 * Why a separate Node verifier (instead of just eyeballing the browser):
 * ────────────────────────────────────────────────────────────────────────
 * The browser can render stale data, cached service worker responses, or
 * pre-existing UI from a prior session — none of which match what the
 * backing data actually says. §7-J ("static deploy ≠ live-verified") and
 * §7-N ("onSnapshot must have error callback") have both fired in past
 * sessions because the UI looked fine but the data path was broken. A
 * REST-based check from outside the browser closes that gap.
 *
 * SAFETY
 * ──────
 * - 100% read-only. No writes, no deletes, no side effects.
 * - All checks issue GET requests against Firestore REST + RTDB REST +
 *   Identity Toolkit REST. None of the project's Cloud Functions are
 *   invoked from here.
 *
 * Auth (resolved in this order, same as seed-lease-notif-test.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login` is sufficient)
 *
 * Usage:
 *   node tools/smoke-test/verify.js login    --email admin@example.com
 *   node tools/smoke-test/verify.js bill     --building rooms --room 15
 *   node tools/smoke-test/verify.js checklist-instance --id <instanceId>
 *   node tools/smoke-test/verify.js deposit  --building rooms --room 15
 *
 * Output: one JSON line per check. Exit 0 = pass, 1 = fail/inconclusive.
 *
 *   { "check": "login", "target": "admin@x.com", "pass": true,  "diag": null }
 *   { "check": "bill",  "target": "rooms/15",    "pass": true,  "diag": "2 bills ..." }
 *   { "check": "deposit", "target": "rooms_15",  "pass": false, "diag": "doc not found ...", "inconclusive": true }
 *
 * The `inconclusive: true` flag is set when the fixture is legitimately absent
 * (no deposit recorded yet, checklist instance never existed, fixture room has
 * no bills) — distinguishes a real regression from "we haven't generated test
 * data yet". Smoke playbook treats inconclusive as a yellow/skip, not a red.
 *
 * Playbook usage:
 *   In the admin playbook, after step "Login → dashboard renders",
 *   you'll see a fenced shell block:
 *       node tools/smoke-test/verify.js login --email $SMOKE_ADMIN_EMAIL
 *   Run that. If `"pass": true` → tick the ☐ for that step. Otherwise the
 *   `diag` field tells you what mismatched.
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const RTDB_BASE  = 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app';
const IDTK_BASE  = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;

// ── CLI parsing ────────────────────────────────────────────────────────────────

function parseArgs() {
  const out = {
    check: process.argv[2] || null,
    email: null,
    building: null,
    room: null,
    year: null,
    id: null,
  };
  for (let i = 3; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--email')         { out.email = next; i++; }
    else if (a === '--building') { out.building = next; i++; }
    else if (a === '--room')     { out.room = String(next); i++; }
    else if (a === '--year')     { out.year = String(next); i++; }
    else if (a === '--id')       { out.id = next; i++; }
  }
  return out;
}

function usage() {
  console.error('Usage:');
  console.error('  node tools/smoke-test/verify.js login    --email <email>');
  console.error('  node tools/smoke-test/verify.js bill     --building <b> --room <r> [--year YYYY-BE]');
  console.error('  node tools/smoke-test/verify.js checklist-instance --id <instanceId>');
  console.error('  node tools/smoke-test/verify.js deposit  --building <b> --room <r>');
  console.error('');
  console.error('Output: JSON line. Exit 0 = pass, 1 = fail.');
}

// ── Access token resolution (mirrors seed-lease-notif-test.js) ─────────────────

function getAccessToken() {
  if (process.env.GCLOUD_ACCESS_TOKEN) return process.env.GCLOUD_ACCESS_TOKEN;
  const ftCandidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of ftCandidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft  = JSON.parse(fs.readFileSync(p, 'utf8'));
      const tok = ft.tokens;
      if (tok && tok.access_token) return tok.access_token;
    } catch (_) {}
  }
  throw new Error(
    'No credentials found. Run `firebase login` or set GCLOUD_ACCESS_TOKEN env var.',
  );
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
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

// Firestore field decoder — handles common scalar types in returned docs.
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
  if ('arrayValue'     in field) return (field.arrayValue.values || []).map(decode);
  return undefined;
}

function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decode(v);
  return out;
}

// ── Output helper ──────────────────────────────────────────────────────────────

function emit(check, target, pass, diag, opts) {
  // One JSON line per call so playbook can grep / pipe / jq.
  // `inconclusive` is a third state separate from pass/fail: data fixture
  // legitimately absent (e.g. no deposits seeded yet) vs malformed.
  const out = { check, target, pass, diag: diag || null };
  if (opts && opts.inconclusive) out.inconclusive = true;
  console.log(JSON.stringify(out));
}

// ── Checks ─────────────────────────────────────────────────────────────────────

async function checkLogin(args, token) {
  if (!args.email) {
    emit('login', '(no email)', false, '--email required');
    return false;
  }
  const url = `${IDTK_BASE}/accounts:lookup`;
  const res = await request('POST', url, token, { email: [args.email] });
  if (res.status !== 200) {
    emit('login', args.email, false, `lookup HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    return false;
  }
  const users = res.data?.users || [];
  if (users.length === 0) {
    emit('login', args.email, false, 'no user found for email');
    return false;
  }
  const u = users[0];
  let claims = {};
  try { claims = JSON.parse(u.customAttributes || '{}'); } catch (_) {}
  if (!claims.admin) {
    emit('login', args.email, false, `user exists but custom claim admin!=true (claims: ${JSON.stringify(claims)})`);
    return false;
  }
  emit('login', args.email, true, `uid=${u.localId}, claims=${JSON.stringify(claims)}`);
  return true;
}

async function checkBill(args, token) {
  if (!args.building || !args.room) {
    emit('bill', '(missing args)', false, '--building and --room required');
    return false;
  }
  const target = `${args.building}/${args.room}`;
  // RTDB shallow listing — returns just keys (billIds) when ?shallow=true.
  const url = `${RTDB_BASE}/bills/${encodeURIComponent(args.building)}/${encodeURIComponent(args.room)}.json?shallow=true&access_token=${encodeURIComponent(token)}`;
  const res = await request('GET', url, '_', null);
  if (res.status === 401 || res.status === 403) {
    emit('bill', target, false, `RTDB auth failed (HTTP ${res.status}): firebase-tools token may lack RTDB scope`);
    return false;
  }
  if (res.status !== 200) {
    emit('bill', target, false, `RTDB HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    return false;
  }
  if (!res.data || typeof res.data !== 'object') {
    emit('bill', target, false, 'no bills found (inconclusive — fixture room has no bills yet)', { inconclusive: true });
    return false;
  }
  const billIds = Object.keys(res.data);
  if (billIds.length === 0) {
    emit('bill', target, false, 'no bill children (inconclusive)', { inconclusive: true });
    return false;
  }
  emit('bill', target, true, `${billIds.length} bills (sample: ${billIds.slice(0, 3).join(', ')})`);
  return true;
}

async function checkChecklistInstance(args, token) {
  if (!args.id) {
    emit('checklist-instance', '(no id)', false, '--id required');
    return false;
  }
  const url = `${FS_BASE}/checklists/${encodeURIComponent(args.id)}`;
  const res = await request('GET', url, token, null);
  if (res.status === 404) {
    emit('checklist-instance', args.id, false, 'doc not found (inconclusive — no instance with this id)', { inconclusive: true });
    return false;
  }
  if (res.status !== 200) {
    emit('checklist-instance', args.id, false, `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    return false;
  }
  const d = decodeDoc(res.data);
  const required = ['building', 'roomId', 'status'];
  const missing = required.filter(k => d[k] === undefined);
  if (missing.length) {
    emit('checklist-instance', args.id, false, `missing fields: ${missing.join(', ')}`);
    return false;
  }
  emit('checklist-instance', args.id, true, `building=${d.building}, room=${d.roomId}, status=${d.status}`);
  return true;
}

async function checkDeposit(args, token) {
  if (!args.building || !args.room) {
    emit('deposit', '(missing args)', false, '--building and --room required');
    return false;
  }
  const docId  = `${args.building}_${args.room}`;
  const target = docId;
  const url    = `${FS_BASE}/deposits/${encodeURIComponent(docId)}`;
  const res    = await request('GET', url, token, null);
  if (res.status === 404) {
    emit('deposit', target, false, 'doc not found (inconclusive — no deposit recorded for this room yet)', { inconclusive: true });
    return false;
  }
  if (res.status !== 200) {
    emit('deposit', target, false, `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    return false;
  }
  const d = decodeDoc(res.data);
  if (typeof d.originalAmount !== 'number' && typeof d.originalAmt !== 'number') {
    emit('deposit', target, false, `no originalAmount/originalAmt field (keys: ${Object.keys(d).join(', ')})`);
    return false;
  }
  const amt = d.originalAmount ?? d.originalAmt;
  emit('deposit', target, true, `originalAmount=${amt}, status=${d.status || '(none)'}`);
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  if (!args.check || ['-h', '--help'].includes(args.check)) {
    usage();
    process.exit(args.check ? 0 : 1);
  }

  let token;
  try { token = getAccessToken(); }
  catch (e) {
    emit(args.check, '(auth)', false, e.message);
    process.exit(1);
  }

  let pass = false;
  switch (args.check) {
    case 'login':              pass = await checkLogin(args, token);              break;
    case 'bill':               pass = await checkBill(args, token);               break;
    case 'checklist-instance': pass = await checkChecklistInstance(args, token);  break;
    case 'deposit':            pass = await checkDeposit(args, token);            break;
    default:
      emit(args.check, '(unknown)', false, `unknown check '${args.check}'`);
      usage();
      process.exit(1);
  }
  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error(JSON.stringify({ check: 'fatal', target: null, pass: false, diag: err.message }));
  process.exit(1);
});
