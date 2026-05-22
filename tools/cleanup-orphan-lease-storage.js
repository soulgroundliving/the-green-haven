/**
 * tools/cleanup-orphan-lease-storage.js
 *
 * One-shot cleanup of orphan Storage objects in `leases/rooms/15/<leaseId>/...`
 * left behind by commit 85133e7 (hard-deleted 5 non-active legacy leases from
 * Firestore at tools/cleanup-test-leases.js). Storage objects don't auto-track
 * Firestore deletions — the PDFs/JPGs in those 5 folders are now ungated.
 *
 *  IMPORTANT — the active lease's `contractDocument` STILL points at
 *  `leases/rooms/15/CONTRACT_1779372399618_15/lease-renewal-1779372582686.jpg`
 *  (one of the deleted-lease folders). We MUST NOT delete that file. This
 *  script handles the case by:
 *    1. Listing all surviving Firestore lease docs for room 15
 *    2. Recursively scanning every string field for `leases/rooms/15/...`
 *       substrings (catches contractDocument + documentURLs.agreement.path
 *       + tenant.lease.contractPath + any other field that holds the path)
 *    3. Deleting only Storage objects in the deleted-lease folders that are
 *       NOT in the "referenced" set
 *
 * SAFETY
 * ──────
 * - DEFAULT: dry-run — lists orphan + preserved files. NO writes.
 * - --apply: deletes orphans (per §7-I user-triggered).
 * - PRE-FLIGHT (always runs, even in dry-run):
 *     • Loads tenants/rooms/list/15 + both surviving lease docs
 *     • If ANY fails to load → ABORT (don't act on partial info)
 *     • Collects every string field containing `leases/rooms/15/`
 *     • If the referenced set is empty → ABORT (something's wrong; refuse
 *       to delete everything)
 *
 * Recovery: Firebase Storage has lifecycle-versioning if configured.
 *           Standard production Storage has NO undo — the script commit +
 *           git diff are the permanent audit record of what was deleted.
 *
 * Auth (same pattern as cleanup-test-leases.js):
 *   0. GCLOUD_ACCESS_TOKEN env var
 *   1. firebase-tools OAuth token (`firebase login`)
 *
 * Usage:
 *   # Preview (default — no writes):
 *   node tools/cleanup-orphan-lease-storage.js
 *
 *   # Execute deletes:
 *   node tools/cleanup-orphan-lease-storage.js --apply
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID  = 'the-green-haven';
const BUCKET      = 'the-green-haven.firebasestorage.app';
const FS_BASE     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STORAGE_API = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}/o`;

// ── Hardcoded scope ────────────────────────────────────────────────────────────
const BUILDING = 'rooms';
const ROOM_ID  = '15';

// Deleted in commit 85133e7. ANY file under these prefixes is a candidate.
const DELETED_LEASE_IDS = [
  'rooms_15_TENANT_1774620396700_15_1777195379927',
  'CONTRACT_1779370223943_17',
  'CONTRACT_1779341731750_15',
  'CONTRACT_1779370734135_15',
  'CONTRACT_1779372399618_15',
];

// Surviving Firestore leases for room 15. Hardcoded to match the
// post-cleanup state captured in next_session_handoff_2026_05_22_test_lease_cleanup.md.
const SURVIVING_LEASE_IDS = [
  'CONTRACT_1779372584106_15',                       // active (current tenancy)
  'LEGACY_TENANT_1774620396700_15_1778006886119',    // ended (pre-test era pointer)
];

const STORAGE_PREFIX = `leases/${BUILDING}/${ROOM_ID}/`;

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

function request(method, url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    req.end();
  });
}

// ── Firestore helpers ────────────────────────────────────────────────────────

async function fetchDoc(docPath, token) {
  const url = `${FS_BASE}/${docPath}`;
  const res = await request('GET', url, token);
  if (res.status === 404) return null;
  if (res.status !== 200) {
    throw new Error(`GET ${docPath} failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return res.data; // raw Firestore doc shape with `fields`
}

/**
 * Recursively walk every value in a Firestore doc, collecting any string
 * value that contains the given prefix as a substring.
 */
function collectPathStrings(node, prefix, found) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) collectPathStrings(v, prefix, found);
    return;
  }
  // Firestore JSON shape: { stringValue / mapValue / arrayValue / ... }
  if ('stringValue' in node && typeof node.stringValue === 'string') {
    const s = node.stringValue;
    if (s.includes(prefix)) {
      // Could be a bare path OR a download URL (which contains the URL-encoded
      // path after /o/). Normalize: extract substring starting at the prefix.
      // Decode URL encoding so `/o/leases%2Frooms%2F15%2F...` becomes the path.
      try {
        const decoded = decodeURIComponent(s);
        // Find the deepest occurrence (covers both bare paths and URLs)
        const idx = decoded.indexOf(prefix);
        if (idx !== -1) {
          // Trim any URL query string (?alt=media&token=...) or fragment
          let pathPart = decoded.slice(idx);
          pathPart = pathPart.split('?')[0].split('#')[0];
          found.add(pathPart);
        }
      } catch (_) {
        // Bare string with prefix — add as-is (trimmed)
        const idx = s.indexOf(prefix);
        if (idx !== -1) found.add(s.slice(idx).split('?')[0].split('#')[0]);
      }
    }
    return;
  }
  if ('mapValue' in node && node.mapValue?.fields) {
    for (const v of Object.values(node.mapValue.fields)) {
      collectPathStrings(v, prefix, found);
    }
    return;
  }
  if ('arrayValue' in node && node.arrayValue?.values) {
    for (const v of node.arrayValue.values) {
      collectPathStrings(v, prefix, found);
    }
    return;
  }
  // For top-level doc with `fields`
  if (node.fields) {
    for (const v of Object.values(node.fields)) {
      collectPathStrings(v, prefix, found);
    }
  }
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function listStorageObjects(prefix, token) {
  const out = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ prefix, maxResults: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `${STORAGE_API}?${qs.toString()}`;
    const res = await request('GET', url, token);
    if (res.status !== 200) {
      throw new Error(`Storage LIST failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    const items = res.data.items || [];
    for (const it of items) out.push({ name: it.name, size: parseInt(it.size || '0', 10) });
    pageToken = res.data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function deleteStorageObject(name, token) {
  const url = `${STORAGE_API}/${encodeURIComponent(name)}`;
  const res = await request('DELETE', url, token);
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`DELETE ${name} failed (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const args = parseArgs();
  const token = getAccessToken();
  console.log(`\n🧹  cleanup-orphan-lease-storage — ${args.apply ? '🔴 APPLY' : '🟢 DRY-RUN (no writes)'}`);
  console.log(`   bucket: ${BUCKET}`);
  console.log(`   prefix: ${STORAGE_PREFIX}\n`);

  // ── Step 1: Collect referenced paths from surviving Firestore docs ──────
  console.log(`📋 Step 1 — collect referenced Storage paths from surviving Firestore docs`);
  const referenced = new Set();
  const docsToScan = [
    `tenants/${BUILDING}/list/${ROOM_ID}`,
    ...SURVIVING_LEASE_IDS.map(id => `leases/${BUILDING}/list/${id}`),
  ];
  for (const docPath of docsToScan) {
    const doc = await fetchDoc(docPath, token);
    if (!doc) {
      console.error(`✗ ABORT: ${docPath} not found — refusing to proceed on partial info`);
      process.exit(1);
    }
    const before = referenced.size;
    collectPathStrings(doc, STORAGE_PREFIX, referenced);
    console.log(`   • ${docPath}  →  +${referenced.size - before} ref(s)`);
  }
  if (referenced.size === 0) {
    console.error(`\n✗ ABORT: no referenced paths found across surviving docs — something is wrong; refusing to delete blindly`);
    process.exit(1);
  }
  console.log(`\n   Referenced set (${referenced.size}):`);
  for (const p of [...referenced].sort()) console.log(`     · ${p}`);

  // ── Step 2: List all Storage objects under the prefix ──────────────────
  console.log(`\n📦 Step 2 — list Storage objects under ${STORAGE_PREFIX}`);
  const allObjects = await listStorageObjects(STORAGE_PREFIX, token);
  console.log(`   total: ${allObjects.length} object(s)`);

  // ── Step 3: Classify objects ───────────────────────────────────────────
  const orphans   = [];
  const preserved = [];      // in deleted-lease folder BUT still referenced
  const untouched = [];      // NOT in any deleted-lease folder
  for (const obj of allObjects) {
    const inDeletedFolder = DELETED_LEASE_IDS.some(id =>
      obj.name.startsWith(`${STORAGE_PREFIX}${id}/`));
    if (!inDeletedFolder) {
      untouched.push(obj);
      continue;
    }
    if (referenced.has(obj.name)) {
      preserved.push(obj);
    } else {
      orphans.push(obj);
    }
  }

  console.log(`\n📊 Classification:`);
  console.log(`   • untouched (outside deleted-lease folders): ${untouched.length}`);
  console.log(`   • preserved (in deleted folder BUT referenced): ${preserved.length}`);
  console.log(`   • orphans   (in deleted folder + unreferenced): ${orphans.length}`);

  if (preserved.length > 0) {
    console.log(`\n🟡 Preserved files (in deleted-lease folders but still referenced):`);
    for (const obj of preserved) {
      console.log(`     · ${obj.name}  (${(obj.size / 1024).toFixed(1)} KiB)`);
    }
  }
  if (untouched.length > 0) {
    console.log(`\n⚪ Untouched files (outside scope — surviving lease folders):`);
    for (const obj of untouched) {
      console.log(`     · ${obj.name}  (${(obj.size / 1024).toFixed(1)} KiB)`);
    }
  }
  if (orphans.length > 0) {
    console.log(`\n🔴 Orphan files (TARGET FOR DELETE):`);
    let totalKiB = 0;
    for (const obj of orphans) {
      const kib = obj.size / 1024;
      totalKiB += kib;
      console.log(`     · ${obj.name}  (${kib.toFixed(1)} KiB)`);
    }
    console.log(`     ─── ${orphans.length} file(s), ${totalKiB.toFixed(1)} KiB total ───`);
  } else {
    console.log(`\n✅ No orphans found. Nothing to delete.`);
  }

  if (!args.apply) {
    console.log(`\n🟢  Dry-run complete — re-run with --apply to execute deletes.\n`);
    return;
  }
  if (orphans.length === 0) {
    console.log(`\n🟢  Nothing to apply.\n`);
    return;
  }

  // ── Step 4: Execute deletes ────────────────────────────────────────────
  console.log(`\n🔴 Executing deletes…`);
  let ok = 0, fail = 0;
  for (const obj of orphans) {
    try {
      await deleteStorageObject(obj.name, token);
      console.log(`   ✓ deleted ${obj.name}`);
      ok++;
    } catch (e) {
      console.error(`   ✗ FAILED ${obj.name}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n📊 Result: ok=${ok}, failed=${fail}, preserved=${preserved.length}`);
  if (fail > 0) process.exit(2);
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
