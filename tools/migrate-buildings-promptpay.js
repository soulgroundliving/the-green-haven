/**
 * tools/migrate-buildings-promptpay.js
 *
 * One-shot migration: canonicalise per-building PromptPay field name across
 * the `buildings/*` Firestore docs.
 *
 * BACKGROUND
 * ──────────
 * Buildings page (since 2026-05-14 consolidation, see CLAUDE.md §7-T) writes
 * `promptPayId` as the canonical field. Pre-Tier-3F seeded docs (notably
 * `buildings/nest`, seeded 2026-05-07) still hold the legacy `promptpayNumber`.
 * Readers are canonical-first (`promptPayId || promptpayNumber || ...`), so
 * nothing is broken today. This script finishes the migration so the legacy
 * fallback branches can be dropped in a follow-up commit.
 *
 * For each doc in `buildings/`:
 *   - If `promptPayId` is absent AND `promptpayNumber` is present:
 *       1. Copy `promptpayNumber` → `promptPayId`
 *       2. Delete `promptpayNumber`
 *   - Already-canonical docs are skipped.
 *   - Docs with neither field are skipped (nothing to do).
 *   - Docs with BOTH fields are skipped with a warning (manual review;
 *     usually means a write race — `promptPayId` should win).
 *
 * DEFAULT: dry-run — prints what would change, NO writes.
 * --apply: execute the writes.
 *
 * Auth (resolved in this order):
 *   0. GCLOUD_ACCESS_TOKEN env var — pass an OAuth token directly. Pair with
 *      gcloud ADC (PowerShell):
 *        $env:GCLOUD_ACCESS_TOKEN = (& gcloud auth application-default print-access-token).Trim()
 *      …or bash:  GCLOUD_ACCESS_TOKEN=$(gcloud auth application-default print-access-token) node tools/migrate-buildings-promptpay.js
 *   1. firebase-tools OAuth token (`firebase login` is sufficient).
 *
 * Recovery: Firestore PITR can restore any accidentally deleted field.
 *
 * Usage:
 *   node tools/migrate-buildings-promptpay.js
 *   node tools/migrate-buildings-promptpay.js --apply
 *
 * Followup (separate commit, AFTER --apply succeeds + ≥1 user-visible cycle):
 *   - Drop legacy fallback branches in 5 readers:
 *       shared/building-registry.js:73
 *       shared/dashboard-bill.js:670
 *       tenant_app.html:8462
 *       functions/createBookingLock.js:140
 *       booking.html:1163
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
  if (v.mapValue)   {
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

// Atomic: in one PATCH request, write `promptPayId` AND delete `promptpayNumber`.
// updateMask listing both field paths; body fields map only contains promptPayId
// → Firestore writes promptPayId and deletes promptpayNumber.
async function migrateOne(docId, value, token) {
  const url = `${FS_BASE}/buildings/${encodeURIComponent(docId)}`
    + `?updateMask.fieldPaths=promptPayId`
    + `&updateMask.fieldPaths=promptpayNumber`
    + `&currentDocument.exists=true`;
  const body = { fields: { promptPayId: { stringValue: String(value) } } };
  const res = await request('PATCH', url, token, body);
  if (res.status !== 200) {
    throw new Error(`migrate ${docId} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  }
}

// ── Core migration ─────────────────────────────────────────────────────────────

async function migrate() {
  const token = getAccessToken();

  console.log('');
  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no writes will be made  (pass --apply to execute)');
  } else {
    console.log('⚡  APPLY MODE — writing to Firestore');
  }
  console.log('');

  const docs = await listCollection('buildings', token);
  console.log(`📦  buildings/  (${docs.length} docs)`);
  console.log('─'.repeat(60));

  let alreadyCanonical = 0;
  let needsMigration   = 0;
  let bothPresent      = 0;
  let neitherPresent   = 0;
  let migratedOk       = 0;
  let errCount         = 0;

  for (const { id, data } of docs) {
    const hasCanonical = typeof data.promptPayId === 'string'    && data.promptPayId.length > 0;
    const hasLegacy    = typeof data.promptpayNumber === 'string' && data.promptpayNumber.length > 0;

    if (hasCanonical && hasLegacy) {
      bothPresent++;
      console.log(`  [${id}] ⚠️  BOTH fields present`);
      console.log(`         promptPayId:     ${data.promptPayId}`);
      console.log(`         promptpayNumber: ${data.promptpayNumber}`);
      console.log(`         → manual review needed; will NOT auto-strip legacy here`);
      continue;
    }

    if (hasCanonical) {
      alreadyCanonical++;
      console.log(`  [${id}] ✅ canonical only (promptPayId=${data.promptPayId})`);
      continue;
    }

    if (!hasLegacy) {
      neitherPresent++;
      console.log(`  [${id}] ⬜ neither field — skip`);
      continue;
    }

    // hasLegacy && !hasCanonical → migrate
    needsMigration++;
    console.log(`  [${id}] 🔄 legacy only (promptpayNumber=${data.promptpayNumber})`);
    if (DRY_RUN) {
      console.log(`         → would copy → promptPayId, delete promptpayNumber`);
    } else {
      try {
        await migrateOne(id, data.promptpayNumber, token);
        migratedOk++;
        console.log(`         ✅ migrated`);
      } catch (e) {
        errCount++;
        console.error(`         ❌ failed: ${e.message}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const bar = '═'.repeat(60);
  console.log(`\n${bar}`);
  console.log('📊  SUMMARY');
  console.log(`    Docs scanned:        ${docs.length}`);
  console.log(`    Already canonical:   ${alreadyCanonical}`);
  console.log(`    Needs migration:     ${needsMigration}`);
  console.log(`    Both fields present: ${bothPresent}  (manual review)`);
  console.log(`    Neither field:       ${neitherPresent}`);
  if (!DRY_RUN) {
    console.log(`    Migrated OK:         ${migratedOk}`);
    console.log(`    Errors:              ${errCount}`);
  }
  console.log('');
  if (DRY_RUN && needsMigration > 0) {
    console.log('    Review the audit above, then run with --apply to execute.');
  } else if (DRY_RUN && needsMigration === 0) {
    console.log('    ✅ Nothing to migrate — all buildings docs are already canonical.');
  } else if (!DRY_RUN && errCount === 0) {
    console.log('    ✅ Migration complete. Verify Bill page PromptPay still renders on Vercel.');
  } else if (!DRY_RUN && errCount > 0) {
    console.log(`    ⚠️  ${errCount} error(s) — review output above.`);
  }
  if (bothPresent > 0) {
    console.log(`    ⚠️  ${bothPresent} doc(s) have BOTH fields — review manually before dropping reader fallback.`);
  }
  console.log(`${bar}\n`);
  process.exit(errCount > 0 ? 1 : 0);
}

migrate().catch(e => {
  console.error('\n❌ Migration crashed:', e.message);
  process.exit(1);
});
