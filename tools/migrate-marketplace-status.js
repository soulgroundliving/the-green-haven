/**
 * tools/migrate-marketplace-status.js
 *
 * One-shot migration: normalize the `status` field on every doc in the
 * top-level `marketplace/*` Firestore collection to the new Spec v1.0 enum.
 *
 * Why this exists
 * ───────────────
 * Per Nest_Marketplace_Specification.pdf v1.0 §3.2, the post status enum is
 *   AVAILABLE → RESERVED → COMPLETED
 *
 * Legacy production posts (pre-2026-05-24) use a 2-state model:
 *   'active'  ⇄  'closed'
 *
 * tenant_app.html reader was made enum-tolerant first (CLAUDE.md §7-T fix
 * pattern) — it accepts both shapes via _normalizeMarketStatus(). This script
 * closes the loop by backfilling every legacy doc to the canonical enum so
 * subscribe filters (which use `where status in [...]`) match without legacy
 * fallback values polluting the allow-list forever.
 *
 * Mapping:
 *   'active'  → 'AVAILABLE'
 *   'closed'  → 'COMPLETED'
 *   anything in ['AVAILABLE','RESERVED','COMPLETED'] → already migrated, skip
 *   missing/null status → 'AVAILABLE' (defensive — matches default in code)
 *
 * DEFAULT: dry-run — reads Firestore, prints a per-doc audit, NO writes.
 * --apply : execute updates.
 *
 * Auth: firebase-tools OAuth token (run `firebase login` first).
 *
 * Safety
 * ──────
 *   1. Only touches the `status` field via Firestore REST updateMask — every
 *      other field on the doc (title, ownerUid, imageData, etc.) is preserved.
 *   2. Skips docs already on the new enum (idempotent — safe to re-run).
 *   3. Firestore PITR can restore any accidentally overwritten field.
 *
 * Usage:
 *   node tools/migrate-marketplace-status.js
 *   node tools/migrate-marketplace-status.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DRY_RUN = !process.argv.includes('--apply');

const NEW_ENUM    = ['AVAILABLE', 'RESERVED', 'COMPLETED'];
const LEGACY_MAP  = { active: 'AVAILABLE', closed: 'COMPLETED' };

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
        console.log('OK  Auth: firebase-tools OAuth token');
        return tok.access_token;
      }
      if (tok && tok.access_token) {
        console.warn('WARN  firebase-tools token may be expired — proceeding anyway');
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

async function listCollection(collPath, token) {
  const docs = [];
  let pageToken;
  do {
    const qs  = '?pageSize=300' + (pageToken ? `&pageToken=${pageToken}` : '');
    const url = `${FS_BASE}/${collPath}${qs}`;
    const res = await request('GET', url, token);
    if (res.status !== 200) throw new Error(`List ${collPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
    for (const doc of (res.data.documents || [])) {
      docs.push({ id: doc.name.split('/').pop(), data: parseDoc(doc) });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return docs;
}

async function writeDocField(docPath, fieldName, stringValue, token) {
  const mask = `updateMask.fieldPaths=${encodeURIComponent(fieldName)}`;
  const url  = `${FS_BASE}/${docPath}?${mask}&currentDocument.exists=true`;
  const body = { fields: { [fieldName]: { stringValue } } };
  const res  = await request('PATCH', url, token, body);
  if (res.status !== 200) throw new Error(`writeDocField ${docPath}.${fieldName} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// ── Core migration ─────────────────────────────────────────────────────────────

async function migrate() {
  const token = getAccessToken();

  console.log('');
  if (DRY_RUN) {
    console.log('DRY RUN — no writes will be made  (pass --apply to execute)');
  } else {
    console.log('APPLY MODE — normalizing marketplace/*.status to Spec v1.0 enum');
  }
  console.log('');

  const docs = await listCollection('marketplace', token);
  console.log(`marketplace  (${docs.length} doc(s))`);
  console.log('-'.repeat(72));

  let alreadyClean = 0;
  let needsMigrate = 0;
  let migrated     = 0;
  let errCount     = 0;
  const byStatus   = {};

  for (const { id, data } of docs) {
    const cur = data.status;
    byStatus[cur || '(missing)'] = (byStatus[cur || '(missing)'] || 0) + 1;

    if (NEW_ENUM.includes(cur)) {
      alreadyClean++;
      continue;
    }

    const next = LEGACY_MAP[cur] || 'AVAILABLE';
    needsMigrate++;
    const titlePreview = String(data.title || '').slice(0, 40).replace(/\s+/g, ' ');
    console.log(`  [${id}]  status="${cur ?? '(missing)'}" -> "${next}"  title="${titlePreview}"`);

    if (!DRY_RUN) {
      try {
        await writeDocField(`marketplace/${id}`, 'status', next, token);
        migrated++;
        console.log(`            -> migrated`);
      } catch (e) {
        errCount++;
        console.error(`            -> ERROR: ${e.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log('SUMMARY');
  console.log('-'.repeat(72));
  console.log(`  Total marketplace docs scanned:  ${docs.length}`);
  console.log(`  Already on new enum:             ${alreadyClean}`);
  console.log(`  Need migration:                  ${needsMigrate}`);
  console.log('');
  console.log('  Status distribution (before this run):');
  for (const [k, v] of Object.entries(byStatus).sort()) {
    console.log(`    ${k.padEnd(15)}  ${v}`);
  }
  if (!DRY_RUN) {
    console.log('');
    console.log(`  Migrated successfully:           ${migrated}`);
    console.log(`  Migration errors:                ${errCount}`);
  } else {
    console.log('');
    console.log('  Re-run with --apply to execute the migration.');
  }
  console.log('='.repeat(72));
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
