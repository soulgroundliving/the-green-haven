/**
 * tools/cleanup-roomWifi.js
 *
 * One-shot cleanup: delete all docs under the `roomWifi/` collection.
 *
 * BACKGROUND
 * ──────────
 * The `roomWifi/*` collection stored admin-entered SSID + password + speed per
 * Nest room from 2026-05-17 (`df30e46`) until 2026-05-18, when the feature was
 * decommissioned. Per user intent — tenants self-install their own ISP per room,
 * project hands-off, support direct to ISP. App's only WiFi-related job is now
 * the on-demand speed test (`api/speed-test.js` + tenant_app speed test panel).
 *
 * The reader (tenant_app `_subscribeRoomWifi`) and writer (dashboard-extra
 * `saveRoomWifiConfig`) were removed in the same commit that drops the
 * `match /roomWifi/{key}` rule block. That alone closes the access path —
 * the orphaned docs aren't reachable anymore. This script is for hygiene:
 * delete them so prod Firestore doesn't carry dead data forever.
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — lists docs that would be deleted, NO writes.
 * - `--apply`: execute deletes.
 * - Recovery: Firestore PITR can restore deleted docs within retention window.
 *   But: admin-entered passwords aren't recoverable from anywhere else, so
 *   review the dry-run output carefully before --apply.
 *
 * Auth (resolved in this order):
 *   0. GCLOUD_ACCESS_TOKEN env var — pass an OAuth token directly. Pair with
 *      gcloud ADC (PowerShell):
 *        $env:GCLOUD_ACCESS_TOKEN = (& gcloud auth application-default print-access-token).Trim()
 *      …or bash:
 *        GCLOUD_ACCESS_TOKEN=$(gcloud auth application-default print-access-token) node tools/cleanup-roomWifi.js
 *   1. firebase-tools OAuth token (`firebase login` is sufficient).
 *
 * Usage:
 *   node tools/cleanup-roomWifi.js              # dry-run
 *   node tools/cleanup-roomWifi.js --apply      # actually delete
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DRY_RUN = !process.argv.includes('--apply');

// ── Access token resolution ────────────────────────────────────────────────────

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

async function listCollection(collPath, token) {
  const docs = [];
  let pageToken;
  do {
    const qs  = '?pageSize=300' + (pageToken ? `&pageToken=${pageToken}` : '');
    const url = `${FS_BASE}/${collPath}${qs}`;
    const res = await request('GET', url, token);
    if (res.status !== 200) {
      // 403/404 on an empty/missing collection is fine — return [].
      if (res.status === 404) return [];
      throw new Error(`List ${collPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    for (const doc of (res.data.documents || [])) {
      docs.push({ id: doc.name.split('/').pop(), data: parseDoc(doc) });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return docs;
}

async function deleteOne(docKey, token) {
  const url = `${FS_BASE}/roomWifi/${encodeURIComponent(docKey)}`;
  const res = await request('DELETE', url, token);
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`delete ${docKey} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  roomWifi cleanup — ${DRY_RUN ? 'DRY RUN' : '⚠️  APPLY MODE (writes will happen!)'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const token = getAccessToken();
  console.log('');

  console.log('→ Listing roomWifi/* …');
  const docs = await listCollection('roomWifi', token);
  console.log(`  found ${docs.length} doc(s)`);
  console.log('');

  if (docs.length === 0) {
    console.log('Nothing to clean. Exiting.');
    return;
  }

  // Preview
  console.log('Preview (first 20):');
  for (const d of docs.slice(0, 20)) {
    const ssidLen = (d.data.ssid || '').length;
    const pwdLen  = (d.data.password || '').length;
    console.log(`  - ${d.id}  (ssid:${ssidLen}c, pwd:${pwdLen}c)`);
  }
  if (docs.length > 20) console.log(`  …and ${docs.length - 20} more`);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — nothing deleted.');
    console.log('Re-run with --apply to delete these docs.');
    return;
  }

  console.log(`→ Deleting ${docs.length} doc(s) …`);
  let ok = 0, fail = 0;
  for (const d of docs) {
    try {
      await deleteOne(d.id, token);
      ok++;
      if (ok % 5 === 0) console.log(`  …${ok}/${docs.length}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${d.id}: ${e.message}`);
    }
  }
  console.log('');
  console.log(`Done — deleted: ${ok}  failed: ${fail}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
