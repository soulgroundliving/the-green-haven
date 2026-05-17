/**
 * tools/migrate-service-providers-clean-internet.js
 *
 * One-shot migration: remove `type === 'internet'` and `type === 'maintenance'`
 * items from `system/serviceProviders.items` (Firestore).
 *
 * Why this exists
 * ───────────────
 * `system/serviceProviders` is a single doc containing an `items` array — the
 * canonical list of admin-entered service contacts (electrician, plumber, …).
 *
 * Two `type` values are dead in the tenant UI:
 *   • internet     ← `buildings/{b}/meta/internet` already owns this (Internet
 *                    Status accordion in tenant_app.html line 2656).
 *   • maintenance  ← Maintenance has its own ticket flow + RTDB tree.
 *
 * Tenant_app strips both at render time (tenant_app.html:12126) — the items
 * sit in Firestore forever, invisible to tenants but cluttering the admin
 * list. Companion change: dashboard.html replaces the free-text `providerType`
 * input with a `<select>` that omits these two values, so the admin can't add
 * new ones either.
 *
 * DEFAULT: dry-run — reads Firestore, prints the items it would remove, NO writes.
 * --apply : writes the filtered array back to `system/serviceProviders`.
 *
 * Auth: firebase-tools OAuth token (run `firebase login` first).
 *
 * Safety
 * ──────
 *   1. Reads the entire doc, filters in-memory, writes the filtered array
 *      with merge:true — every non-target item is preserved.
 *   2. Only the `items` and `updatedAt` fields are touched.
 *   3. Firestore PITR can restore the prior items array.
 *
 * Usage:
 *   node tools/migrate-service-providers-clean-internet.js
 *   node tools/migrate-service-providers-clean-internet.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DEAD_TYPES = new Set(['internet', 'maintenance']);
const DRY_RUN    = !process.argv.includes('--apply');

// ── Access token resolution ────────────────────────────────────────────────────

function getAccessToken() {
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
    '  Option A: run `firebase login` (uses firebase-tools token)\n' +
    '  Option B: place service account key at functions/serviceAccountKey.json\n' +
    '  Option C: run `gcloud auth application-default login`'
  );
}

// ── Firestore REST client ──────────────────────────────────────────────────────

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

function parseValue(v) {
  if (v.stringValue    !== undefined) return v.stringValue;
  if (v.integerValue   !== undefined) return Number(v.integerValue);
  if (v.doubleValue    !== undefined) return v.doubleValue;
  if (v.booleanValue   !== undefined) return v.booleanValue;
  if (v.nullValue      !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue) {
    const obj = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields || {})) obj[k] = parseValue(fv);
    return obj;
  }
  if (v.arrayValue) return (v.arrayValue.values || []).map(parseValue);
  return null;
}

function parseDoc(doc) {
  if (!doc || !doc.fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = parseValue(v);
  return out;
}

function toValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string')  return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val))  return { arrayValue: { values: val.map(toValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toValue(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toValue(v);
  }
  return fields;
}

async function getDoc(docPath, token) {
  const res = await request('GET', `${FS_BASE}/${docPath}`, token);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Get ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  return parseDoc(res.data);
}

async function setDocMerge(docPath, data, token) {
  const fields = toFields(data);
  const mask   = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url    = `${FS_BASE}/${docPath}?${mask}`;
  const res    = await request('PATCH', url, token, { fields });
  if (res.status !== 200) throw new Error(`setDocMerge ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// ── Core migration ─────────────────────────────────────────────────────────────

async function migrate() {
  const token = getAccessToken();

  console.log('');
  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no writes will be made  (pass --apply to execute)');
  } else {
    console.log('⚡  APPLY MODE — writing filtered items[] to system/serviceProviders');
  }
  console.log('');

  const data = await getDoc('system/serviceProviders', token);
  if (!data) {
    console.log('  Doc system/serviceProviders does not exist — nothing to do.');
    return;
  }

  const items   = Array.isArray(data.items) ? data.items : [];
  const keepers = [];
  const removed = [];

  for (const it of items) {
    const t = String(it && it.type || '').toLowerCase();
    if (DEAD_TYPES.has(t)) removed.push(it); else keepers.push(it);
  }

  console.log(`📦  system/serviceProviders.items  (${items.length} total)`);
  console.log('─'.repeat(72));
  console.log(`  ✅ keep:    ${keepers.length}`);
  console.log(`  ❌ remove:  ${removed.length}  (type ∈ {${[...DEAD_TYPES].join(', ')}})`);

  if (removed.length) {
    console.log('');
    console.log('  Items that would be removed:');
    for (const it of removed) {
      console.log(`    - id=${it.id || '?'}  type=${it.type}  name=${it.name || '?'}  phone=${it.phone || '?'}`);
    }
  }

  if (!DRY_RUN && removed.length) {
    try {
      await setDocMerge('system/serviceProviders', {
        items: keepers,
        updatedAt: new Date().toISOString(),
      }, token);
      console.log('\n  ✓ Updated system/serviceProviders.items');
    } catch (e) {
      console.error(`\n  ERROR: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  Before:  ${items.length} items`);
  console.log(`  After:   ${keepers.length} items`);
  if (DRY_RUN && removed.length) {
    console.log('');
    console.log('  Re-run with --apply to remove the dead-type items.');
  }
  console.log('═'.repeat(72));
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
