/**
 * tools/migrate-lease-duplicates.js
 *
 * One-shot migration: delete duplicate `leases/{building}/list/*` docs that the
 * render-time dedupe at `shared/dashboard-extra.js:1940-1960` already hides.
 *
 * Why this exists
 * ───────────────
 * Three lease-id minting patterns coexist:
 *   • CONTRACT_<ts>_<roomId>            ← convertBookingToTenant CF (since 2026-05-04)
 *   • <building>_<roomId>_<tenantId>_*  ← legacy `createLease()` from manual admin save
 *   • LEGACY_<tenantId>_<ts>            ← archive helper / pre-booking-flow tenants
 *
 * The dashboard render groups by (building, roomId, moveInDate, tenantId) and
 * keeps the doc with the BEST score: non-LEGACY_* prefix > higher rentAmount >
 * newer createdAt. Losers are hidden in the UI but still occupy Firestore
 * storage. This script applies the same scoring to the source data and deletes
 * the losers so future readers don't need the dedupe shim at all.
 *
 * DEFAULT: dry-run — reads Firestore, prints a per-group audit, NO writes.
 * --apply : execute deletions.
 *
 * Auth: firebase-tools OAuth token (run `firebase login` first).
 *
 * Safety
 * ──────
 *   1. Groups with size 1 are skipped (no duplicates).
 *   2. Survivor selection uses the EXACT same scoring as the UI dedupe so the
 *      record admins already see in the dashboard is the one preserved.
 *   3. Per-group audit printed before any write. Review with --apply absent
 *      first; pass --apply only after the report looks correct.
 *   4. Firestore PITR can restore any accidentally deleted doc.
 *   5. localStorage `lease_agreements_data` is NOT touched — dashboard refresh
 *      via `LeaseAgreementManager.loadLeasesFromFirebase()` re-syncs from
 *      Firestore on next admin page load.
 *
 * Usage:
 *   node tools/migrate-lease-duplicates.js
 *   node tools/migrate-lease-duplicates.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const BUILDINGS = ['rooms', 'nest'];
const DRY_RUN   = !process.argv.includes('--apply');

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

async function deleteDoc(docPath, token) {
  const res = await request('DELETE', `${FS_BASE}/${docPath}`, token);
  if (res.status !== 200) throw new Error(`Delete ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// ── Survivor selection (mirrors shared/dashboard-extra.js:1947-1957) ───────────

function pickCanonical(arr) {
  if (arr.length === 1) return arr[0];
  return [...arr].sort((a, b) => {
    const aLegacy = String(a.id || '').startsWith('LEGACY_') ? 1 : 0;
    const bLegacy = String(b.id || '').startsWith('LEGACY_') ? 1 : 0;
    if (aLegacy !== bLegacy) return aLegacy - bLegacy;        // non-legacy first
    const ar = Number(a.data.rentAmount || 0);
    const br = Number(b.data.rentAmount || 0);
    if (ar !== br) return br - ar;                            // higher rent first
    return String(b.data.createdDate || b.data.createdAt || '')
      .localeCompare(String(a.data.createdDate || a.data.createdAt || '')); // newer first
  })[0];
}

// ── Core migration ─────────────────────────────────────────────────────────────

async function migrate() {
  const token = getAccessToken();

  console.log('');
  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no writes will be made  (pass --apply to execute)');
  } else {
    console.log('⚡  APPLY MODE — deleting duplicate lease docs from Firestore');
  }
  console.log('');

  let totalGroups   = 0;
  let groupsWithDup = 0;
  let totalDocs     = 0;
  let losersTotal   = 0;
  let deletedOk     = 0;
  let errCount      = 0;

  for (const building of BUILDINGS) {
    const docs = await listCollection(`leases/${building}/list`, token);
    totalDocs += docs.length;
    console.log(`\n📦  ${building}  (${docs.length} lease doc(s))`);
    console.log('─'.repeat(72));

    // Group by (roomId, moveInDate, tenantId)
    const groups = {};
    for (const { id, data } of docs) {
      const key = `${data.roomId || '?'}|${data.moveInDate || ''}|${data.tenantId || data.tenantName || '?'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ id, data });
    }

    for (const [key, members] of Object.entries(groups)) {
      totalGroups++;
      if (members.length === 1) continue;

      groupsWithDup++;
      const survivor = pickCanonical(members);
      const losers   = members.filter(m => m.id !== survivor.id);
      losersTotal   += losers.length;

      const [roomId, moveInDate, tenantId] = key.split('|');
      console.log(`\n  Group: room=${roomId} moveIn=${moveInDate || '—'} tenant=${tenantId}`);
      console.log(`    ✅ KEEP    ${survivor.id}` +
        `  (rent=${survivor.data.rentAmount ?? '—'}, status=${survivor.data.status || '—'}, createdAt=${survivor.data.createdDate || survivor.data.createdAt || '—'})`);
      for (const loser of losers) {
        console.log(`    ❌ DELETE  ${loser.id}` +
          `  (rent=${loser.data.rentAmount ?? '—'}, status=${loser.data.status || '—'}, createdAt=${loser.data.createdDate || loser.data.createdAt || '—'})`);
      }

      if (!DRY_RUN) {
        for (const loser of losers) {
          try {
            await deleteDoc(`leases/${building}/list/${loser.id}`, token);
            deletedOk++;
            console.log(`       → deleted`);
          } catch (e) {
            errCount++;
            console.error(`       → ERROR: ${e.message}`);
          }
        }
      }
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  Total lease docs scanned:     ${totalDocs}`);
  console.log(`  Total groups:                 ${totalGroups}`);
  console.log(`  Groups with duplicates:       ${groupsWithDup}`);
  console.log(`  Loser docs that would delete: ${losersTotal}`);
  if (!DRY_RUN) {
    console.log(`  Deletions succeeded:          ${deletedOk}`);
    console.log(`  Deletion errors:              ${errCount}`);
  } else {
    console.log('');
    console.log('  Re-run with --apply to delete the loser docs.');
  }
  console.log('═'.repeat(72));
}

migrate().catch(e => { console.error('FATAL:', e); process.exit(1); });
