/**
 * tools/migrate-rewards-strip-note.js
 *
 * One-shot migration: strip the dead `note` field from every doc in the
 * top-level `rewards/*` Firestore collection.
 *
 * Why this exists
 * ───────────────
 * Up to 2026-05-17 the reward-edit modal carried a free-text `note` that the
 * admin used to explain redemption limits ("ครบสิทธิ์เดือนนี้แล้ว..."). The
 * 2026-05-17 quota-only redesign replaced this with `monthlyQuota` (number);
 * both the admin save path (shared/dashboard-extra.js:4632) and
 * functions/redeemReward.js:79,183 now auto-generate the rejection text.
 *
 * `note` is no longer written, no longer read — but Firestore `updateDoc` with
 * merge:true never removes fields, so existing reward docs still carry the
 * stale value. This script wipes it.
 *
 * DEFAULT: dry-run — reads Firestore, prints a per-doc audit, NO writes.
 * --apply : execute deletions.
 *
 * Auth: firebase-tools OAuth token (run `firebase login` first).
 *
 * Safety
 * ──────
 *   1. Only touches the `note` field via Firestore REST updateMask — every
 *      other field on the doc is preserved.
 *   2. Skips docs without a `note` field.
 *   3. Firestore PITR can restore any accidentally deleted field.
 *
 * Usage:
 *   node tools/migrate-rewards-strip-note.js
 *   node tools/migrate-rewards-strip-note.js --apply
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

async function deleteDocFields(docPath, fieldNames, token) {
  const mask = fieldNames.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url  = `${FS_BASE}/${docPath}?${mask}&currentDocument.exists=true`;
  const res  = await request('PATCH', url, token, { fields: {} });
  if (res.status !== 200) throw new Error(`deleteDocFields ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// ── Core migration ─────────────────────────────────────────────────────────────

async function migrate() {
  const token = getAccessToken();

  console.log('');
  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no writes will be made  (pass --apply to execute)');
  } else {
    console.log('⚡  APPLY MODE — stripping `note` from rewards/*');
  }
  console.log('');

  const docs = await listCollection('rewards', token);
  console.log(`📦  rewards  (${docs.length} doc(s))`);
  console.log('─'.repeat(72));

  let withNote     = 0;
  let withoutNote  = 0;
  let stripped     = 0;
  let errCount     = 0;

  for (const { id, data } of docs) {
    const hasNote = Object.prototype.hasOwnProperty.call(data, 'note');
    if (!hasNote) {
      withoutNote++;
      continue;
    }
    withNote++;
    const preview = String(data.note ?? '').slice(0, 60).replace(/\s+/g, ' ');
    console.log(`  [${id}]  note="${preview}"  monthlyQuota=${data.monthlyQuota ?? 0}`);

    if (!DRY_RUN) {
      try {
        await deleteDocFields(`rewards/${id}`, ['note'], token);
        stripped++;
        console.log(`            → stripped`);
      } catch (e) {
        errCount++;
        console.error(`            → ERROR: ${e.message}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  Total reward docs scanned:      ${docs.length}`);
  console.log(`  Already clean (no note):        ${withoutNote}`);
  console.log(`  Carrying stale note field:      ${withNote}`);
  if (!DRY_RUN) {
    console.log(`  Stripped successfully:          ${stripped}`);
    console.log(`  Strip errors:                   ${errCount}`);
  } else {
    console.log('');
    console.log('  Re-run with --apply to strip the dead `note` field.');
  }
  console.log('═'.repeat(72));
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
