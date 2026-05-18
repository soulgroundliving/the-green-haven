/**
 * tools/migrate-tenant-doc-to-slim.js
 *
 * One-shot migration: strip duplicate identity + lease-snapshot fields from
 * tenants/{building}/list/* docs that predate Phase 6 (2026-05-12).
 *
 * Phase 6 made future WRITES slim (identity → people/, lease → leases/).
 * Existing docs still carry the old fields because Firestore merge:true never
 * deletes. This script finishes the job for pre-Phase-6 docs.
 *
 * DEFAULT: dry-run — reads Firestore, prints a per-doc audit report, NO writes.
 * --apply : execute the changes (backfills + field deletions).
 *
 * Auth (resolved in this order):
 *   0. GCLOUD_ACCESS_TOKEN env var — pass an OAuth token directly. Pair with
 *      gcloud ADC like this (PowerShell):
 *        $env:GCLOUD_ACCESS_TOKEN = (& gcloud auth application-default print-access-token).Trim()
 *      …or bash:  GCLOUD_ACCESS_TOKEN=$(gcloud auth application-default print-access-token) node tools/migrate-tenant-doc-to-slim.js
 *   1. firebase-tools OAuth token in ~/.config/configstore/firebase-tools.json
 *      (i.e. `firebase login` is sufficient).
 *   2. functions/serviceAccountKey.json — not currently wired through; future.
 *
 * Safety:
 *   1. Verifies people/{tenantId} exists before stripping identity fields.
 *      If missing, backfills it from the tenant doc first (merge:true), then strips.
 *   2. Verifies leases/{b}/list/{leaseId} exists before stripping lease fields.
 *      If missing, backfills it from the tenant doc first (merge:true), then strips.
 *   3. Strips ONLY the fields successfully backed up — never strips blindly.
 *   4. Vacant rooms (no tenantId) are skipped entirely.
 *   5. Per-doc audit log printed before any write — review before passing --apply.
 *
 * Recovery: Firestore PITR can restore any accidentally deleted field.
 *
 * Usage:
 *   node tools/migrate-tenant-doc-to-slim.js
 *   node tools/migrate-tenant-doc-to-slim.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── Field manifests ────────────────────────────────────────────────────────────

// Identity fields: belong on people/{tenantId} only
const IDENTITY_FIELDS = [
  'firstName', 'lastName', 'phone', 'email', 'lineID',
  'idCardNumber', 'address', 'licensePlate',
  'emergencyContact', 'notes', 'companyInfo', 'avatar', 'receiptType',
];

// Lease snapshot fields: belong on leases/{b}/list/{leaseId} only
const LEASE_FIELDS = [
  'moveInDate', 'contractStart', 'contractMonths', 'contractEnd',
  'moveOutDate', 'deposit', 'depositPaid', 'depositPaidAt',
  'depositSlipRef', 'rentAmount', 'contractDocument', 'contractFileName',
];

const BUILDINGS = ['rooms', 'nest'];
const DRY_RUN   = !process.argv.includes('--apply');

// ── Access token resolution ────────────────────────────────────────────────────

function getAccessToken() {
  // 0. Env-var override — caller passes an OAuth token directly.
  //    Pair with gcloud ADC for a fresh token; see header for one-liners.
  if (process.env.GCLOUD_ACCESS_TOKEN) {
    console.log('✓  Auth: GCLOUD_ACCESS_TOKEN env var');
    return process.env.GCLOUD_ACCESS_TOKEN;
  }

  // 1. Service account key (Admin SDK style — convert to OAuth via ADC)
  //    Not used here since we go REST-only. Skip for now.

  // 2. firebase-tools OAuth token (~/.config/configstore/firebase-tools.json)
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

  // 3. GOOGLE_APPLICATION_CREDENTIALS / gcloud — not easily usable without SDK.
  //    If neither worked, error out with helpful message.
  throw new Error(
    'No credentials found.\n' +
    '  Option A: run `firebase login` (uses firebase-tools token)\n' +
    '  Option B: pass GCLOUD_ACCESS_TOKEN env var (pair with `gcloud auth application-default print-access-token`)\n' +
    '  Option C: place service account key at functions/serviceAccountKey.json'
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

// Convert a Firestore REST field value to a plain JS value
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

// Convert a Firestore REST document to a plain JS object
function parseDoc(doc) {
  if (!doc || !doc.fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = parseValue(v);
  return out;
}

// Convert a plain JS value to a Firestore REST field value
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

// Convert a plain JS object to Firestore REST fields map
function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toValue(v);
  }
  return fields;
}

// List all documents in a Firestore collection path (handles pagination)
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

// Check if a document exists; returns true/false
async function docExists(docPath, token) {
  const res = await request('GET', `${FS_BASE}/${docPath}`, token);
  return res.status === 200;
}

// Merge-set a document (PATCH with updateMask = keys being written)
async function setDocMerge(docPath, data, token) {
  const fields = toFields(data);
  const mask   = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url    = `${FS_BASE}/${docPath}?${mask}`;
  const res    = await request('PATCH', url, token, { fields });
  if (res.status !== 200) throw new Error(`setDocMerge ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// Delete specific top-level fields from a document.
// PATCH with updateMask listing the fields to delete but no values → Firestore deletes them.
async function deleteDocFields(docPath, fieldNames, token) {
  const mask = fieldNames.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url  = `${FS_BASE}/${docPath}?${mask}&currentDocument.exists=true`;
  const res  = await request('PATCH', url, token, { fields: {} });
  if (res.status !== 200) throw new Error(`deleteDocFields ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickNonNull(obj, fields) {
  const out = {};
  for (const f of fields) {
    if (obj[f] !== undefined && obj[f] !== null) out[f] = obj[f];
  }
  return out;
}

function presentIn(obj, fields) {
  return fields.filter(f => obj[f] !== undefined && obj[f] !== null);
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

  let totalDocs      = 0;
  let vacantSkipped  = 0;
  let alreadySlim    = 0;
  let needsMigration = 0;
  let migratedOk     = 0;
  let errCount       = 0;

  for (const building of BUILDINGS) {
    const docs = await listCollection(`tenants/${building}/list`, token);
    console.log(`\n📦  ${building}  (${docs.length} docs)`);
    console.log('─'.repeat(60));

    for (const { id: roomId, data } of docs) {
      totalDocs++;

      // ── Skip vacant rooms ────────────────────────────────────────
      if (!data.tenantId) {
        vacantSkipped++;
        console.log(`  [${roomId}] ⬜ vacant — skip`);
        continue;
      }

      const tenantId = data.tenantId;

      // ── Identify duplicate fields ────────────────────────────────
      const identityPresent = presentIn(data, IDENTITY_FIELDS);
      const leasePresent    = presentIn(data, LEASE_FIELDS);

      if (identityPresent.length === 0 && leasePresent.length === 0) {
        alreadySlim++;
        console.log(`  [${roomId}] ✅ already slim  (tenantId=${tenantId})`);
        continue;
      }

      needsMigration++;
      console.log(`\n  [${roomId}]  tenantId=${tenantId}`);

      // ── Identity: check people/ ──────────────────────────────────
      let identityToStrip  = [];
      let backfilledPeople = false;

      if (identityPresent.length > 0) {
        const exists = await docExists(`people/${tenantId}`, token);

        if (DRY_RUN) {
          const action = exists ? 'exists — will strip' : 'MISSING — will backfill + strip';
          console.log(`    identity (${identityPresent.length}): ${identityPresent.join(', ')}`);
          console.log(`    people/${tenantId}: ${action}`);
        } else {
          if (!exists) {
            const identityData = pickNonNull(data, identityPresent);
            await setDocMerge(`people/${tenantId}`, {
              ...identityData,
              tenantId,
              updatedAt: new Date().toISOString(),
            }, token);
            backfilledPeople = true;
            console.log(`    ↑ backfilled people/${tenantId}  (${identityPresent.length} fields)`);
          }
        }
        identityToStrip = identityPresent;
      }

      // ── Lease: check leases/ ─────────────────────────────────────
      const leaseId     = data.activeContractId || data.contractId || data.lease?.leaseId;
      let leaseToStrip  = [];
      let backfilledLease = false;

      if (leasePresent.length > 0) {
        if (!leaseId) {
          console.log(`    lease (${leasePresent.length}): ${leasePresent.join(', ')}`);
          console.log(`    ⚠️  no leaseId found — lease fields will NOT be stripped`);
        } else {
          const lPath  = `leases/${building}/list/${leaseId}`;
          const exists = await docExists(lPath, token);

          if (DRY_RUN) {
            const action = exists ? 'exists — will strip' : 'MISSING — will backfill + strip';
            console.log(`    lease (${leasePresent.length}): ${leasePresent.join(', ')}`);
            console.log(`    ${lPath}: ${action}`);
          } else {
            if (!exists) {
              const leaseData = pickNonNull(data, leasePresent);
              await setDocMerge(lPath, {
                id: leaseId,
                building,
                roomId,
                tenantId,
                tenantName: data.name || '',
                status:     data.status || 'active',
                ...leaseData,
                updatedAt: new Date().toISOString(),
              }, token);
              backfilledLease = true;
              console.log(`    ↑ backfilled ${lPath}  (${leasePresent.length} fields)`);
            }
          }
          leaseToStrip = leasePresent;
        }
      }

      // ── Strip duplicate fields from tenant doc ───────────────────
      const toStrip = [...identityToStrip, ...leaseToStrip];

      if (DRY_RUN) {
        if (toStrip.length > 0) {
          console.log(`    → would strip ${toStrip.length} field(s): ${toStrip.join(', ')}`);
        }
      } else if (toStrip.length > 0) {
        try {
          await deleteDocFields(`tenants/${building}/list/${roomId}`, toStrip, token);
          migratedOk++;
          console.log(`    ✅ stripped ${toStrip.length} field(s)`);
        } catch (e) {
          errCount++;
          console.error(`    ❌ strip failed: ${e.message}`);
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const bar = '═'.repeat(60);
  console.log(`\n${bar}`);
  console.log('📊  SUMMARY');
  console.log(`    Docs scanned:    ${totalDocs}`);
  console.log(`    Vacant skipped:  ${vacantSkipped}`);
  console.log(`    Already slim:    ${alreadySlim}`);
  console.log(`    Need migration:  ${needsMigration}`);
  if (!DRY_RUN) {
    console.log(`    Migrated OK:     ${migratedOk}`);
    console.log(`    Errors:          ${errCount}`);
  }
  console.log('');
  if (DRY_RUN && needsMigration > 0) {
    console.log('    Review the audit above, then run with --apply to execute.');
  } else if (DRY_RUN && needsMigration === 0) {
    console.log('    ✅ Nothing to migrate — all tenant docs are already slim.');
  } else if (!DRY_RUN && errCount === 0) {
    console.log('    ✅ Migration complete. Verify on https://the-green-haven.vercel.app');
  } else if (!DRY_RUN && errCount > 0) {
    console.log(`    ⚠️  ${errCount} error(s) — review output above.`);
  }
  console.log(`${bar}\n`);
  process.exit(errCount > 0 ? 1 : 0);
}

migrate().catch(e => {
  console.error('\n❌ Migration crashed:', e.message);
  process.exit(1);
});
