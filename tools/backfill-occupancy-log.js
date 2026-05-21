/**
 * tools/backfill-occupancy-log.js
 *
 * Reconstruct per-room `occupancyLog/{idempotencyKey}` entries from the
 * existing `leases/{b}/list/*` collection. Plan B' S4.
 *
 * DEFAULT: --dry-run — reads Firestore, prints derived event counts +
 *          per-building breakdown + sample. NO writes.
 * --apply  : execute writes (idempotent via deterministic doc ID).
 * --building <b> : restrict to one building (default: rooms + nest).
 *
 * Derivation rules (mirror Plan B' S2 live-CF behavior):
 *
 *   For each lease L in leases/{building}/list/*:
 *
 *     1. moved_in event — ONLY if L is the ROOT of a chain
 *        (no priorLeaseId AND no transferredFromLeaseId).
 *        Discriminator = sourceBookingId || L.id (so backfill key is stable).
 *
 *     2. For each amendment in L.amendments[] where type=='room_transfer':
 *          emit transferred_out at amendment.fromRoom (leaseId=L.id)
 *          emit transferred_in  at amendment.toRoom   (leaseId=L.id)
 *        Discriminator = amendment.at (matches live transferTenant.variation).
 *
 *     3. Terminal event by status:
 *        - 'transferred'  → emit transferred_out at L.roomId (leaseId=L.id,
 *                          discriminator=transferredToLeaseId)
 *                          PLUS emit transferred_in at the NEXT lease's
 *                          room (leaseId=nextLease.id, discriminator=L.id)
 *                          [matches live novation pair]
 *        - 'ended'        → emit moved_out at L.roomId (leaseId=L.id)
 *        - 'renewed'      → SKIP (renewal doesn't change room; new lease is
 *                          at the same room and we already filter its
 *                          moved_in because it has priorLeaseId set)
 *        - 'active'       → SKIP (no terminal event yet)
 *
 * Source is always 'backfill' on every entry — distinguishes from live writes.
 * The deterministic key includes source+leaseId+action+building+roomId+
 * discriminator, so backfill re-runs collapse onto the SAME doc (idempotent).
 *
 * Known gaps documented for S5/S6 follow-up:
 *   - `archived` events not derivable from leases alone (live archive CF
 *     writes them; old archives without an archived-event would need a
 *     separate pass over `tenants/{b}/list/{r}.lastArchivedAt` + the
 *     `tenants/{b}/archive/*` subcollection).
 *   - `restored` events not yet implemented (restoreReturningTenant CF doesn't
 *     exist yet — Plan B' future A).
 *
 * Auth: same resolver as tools/migrate-tenant-doc-to-slim.js — firebase-tools
 *       OAuth token, or GCLOUD_ACCESS_TOKEN env var. Both bypass Firestore
 *       rules via cloud-platform scope.
 *
 * Usage:
 *   node tools/backfill-occupancy-log.js                 # dry-run, all buildings
 *   node tools/backfill-occupancy-log.js --building nest # dry-run, one building
 *   node tools/backfill-occupancy-log.js --apply         # writes
 */

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const PROJECT_ID = 'the-green-haven';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DEFAULT_BUILDINGS = ['rooms', 'nest'];
const DRY_RUN = !process.argv.includes('--apply');
const BUILDING_FILTER = (() => {
  const i = process.argv.indexOf('--building');
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : null;
})();
const SAMPLE_SIZE = 8;

// ── Auth (mirrors tools/migrate-tenant-doc-to-slim.js) ────────────────────────

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
      if (tok && tok.access_token) {
        if (tok.expires_at > Date.now()) {
          console.log('✓  Auth: firebase-tools OAuth token');
        } else {
          console.warn('⚠️  firebase-tools token may be expired — proceeding anyway');
        }
        return tok.access_token;
      }
    } catch (_) { /* fall through */ }
  }
  throw new Error(
    'No credentials found.\n' +
    '  Option A: run `firebase login`\n' +
    '  Option B: pass GCLOUD_ACCESS_TOKEN env var'
  );
}

// ── REST helpers (mirrors migrate script — REST only, no admin SDK) ───────────

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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
    for (const [k, v] of Object.entries(val)) if (v !== undefined) fields[k] = toValue(v);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

async function listCollection(collPath, token) {
  const docs = [];
  let pageToken;
  do {
    const qs  = '?pageSize=300' + (pageToken ? `&pageToken=${pageToken}` : '');
    const url = `${FS_BASE}/${collPath}${qs}`;
    const res = await request('GET', url, token);
    if (res.status !== 200) {
      throw new Error(`List ${collPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    for (const doc of (res.data.documents || [])) {
      docs.push({ id: doc.name.split('/').pop(), data: parseDoc(doc) });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return docs;
}

// Set doc REPLACING existing fields (no merge). Idempotent on same doc ID.
async function writeDoc(docPath, data, token) {
  const url = `${FS_BASE}/${docPath}`;
  const res = await request('PATCH', url, token, { fields: toFields(data) });
  if (res.status !== 200) {
    throw new Error(`writeDoc ${docPath} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  }
}

// ── idempotencyKey builder (mirrors functions/_occupancyLog.js exactly) ───────

function _sanitiseSegment(s) {
  return String(s == null ? '' : s).replace(/[\/.#$\[\]]/g, '_');
}

function buildIdempotencyKey({ source, leaseId, action, building, roomId, discriminator }) {
  return [
    _sanitiseSegment(source),
    _sanitiseSegment(leaseId),
    _sanitiseSegment(action),
    _sanitiseSegment(building),
    _sanitiseSegment(roomId),
    _sanitiseSegment(discriminator || ''),
  ].join('__');
}

// ── Event derivation ──────────────────────────────────────────────────────────

function parseIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Given a list of leases (all from one building), derive the events that
 * should exist in occupancyLog. Returns: [{ docPath, key, data, lease, why }]
 */
function deriveEvents(building, leases) {
  const events = [];
  const byId = new Map(leases.map(l => [l.id, l]));

  for (const L of leases) {
    const d = L.data || {};
    const leaseId = L.id;
    const roomId  = d.roomId || d.room || '';
    const tenantId = d.tenantId || '';
    const tenantName = d.tenantName || '';
    const personId = tenantId || null;
    if (!roomId || !tenantId || !tenantName) {
      events.push({ skipped: true, reason: `lease ${leaseId} missing roomId/tenantId/tenantName`, lease: L });
      continue;
    }

    const hasPrior = !!(d.priorLeaseId || d.transferredFromLeaseId);

    // 1. moved_in (only if chain root)
    if (!hasPrior) {
      const at = parseIso(d.contractStart) || parseIso(d.moveInDate) || parseIso(d.createdDate);
      if (at) {
        const discriminator = String(d.sourceBookingId || leaseId);
        const payload = {
          tenantId, tenantName, personId,
          building, roomId,
          action: 'moved_in',
          reason: null, otherBuilding: null, otherRoom: null,
          leaseId,
          by: 'system-backfill', byEmail: null,
          source: 'backfill',
          discriminator,
          notes: 'derived from lease root (no priorLeaseId)',
          _at: at, // used only for sort + dry-run display; real write uses serverTimestamp
        };
        const key = buildIdempotencyKey({ source: 'backfill', leaseId, action: 'moved_in', building, roomId, discriminator });
        events.push({
          docPath: `tenants/${building}/list/${roomId}/occupancyLog/${key}`,
          key,
          data: { ...payload, idempotencyKey: key },
          lease: L,
        });
      } else {
        events.push({ skipped: true, reason: `lease ${leaseId}: no parseable contractStart/moveInDate for moved_in`, lease: L });
      }
    }

    // 2. amendment events (variation transfers)
    const amendments = Array.isArray(d.amendments) ? d.amendments : [];
    const sortedAmendments = [...amendments].sort((a, b) => {
      const ta = parseIso(a?.at) || '';
      const tb = parseIso(b?.at) || '';
      return ta.localeCompare(tb);
    });
    for (const a of sortedAmendments) {
      if (!a || a.type !== 'room_transfer') continue;
      const at = parseIso(a.at);
      if (!at) continue;
      const discriminator = at;
      const fromB = a.fromBuilding || building;
      const fromR = a.fromRoom;
      const toB   = a.toBuilding || building;
      const toR   = a.toRoom;
      if (!fromR || !toR) continue;
      // transferred_out at fromRoom
      {
        const key = buildIdempotencyKey({ source: 'backfill', leaseId, action: 'transferred_out', building: fromB, roomId: fromR, discriminator });
        events.push({
          docPath: `tenants/${fromB}/list/${fromR}/occupancyLog/${key}`,
          key,
          data: {
            tenantId, tenantName, personId,
            building: fromB, roomId: fromR,
            action: 'transferred_out',
            reason: a.notes || null,
            otherBuilding: toB, otherRoom: toR,
            leaseId,
            by: 'system-backfill', byEmail: null,
            source: 'backfill',
            idempotencyKey: key,
            notes: 'derived from amendments[] (variation transfer)',
            _at: at,
          },
          lease: L,
        });
      }
      // transferred_in at toRoom
      {
        const key = buildIdempotencyKey({ source: 'backfill', leaseId, action: 'transferred_in', building: toB, roomId: toR, discriminator });
        events.push({
          docPath: `tenants/${toB}/list/${toR}/occupancyLog/${key}`,
          key,
          data: {
            tenantId, tenantName, personId,
            building: toB, roomId: toR,
            action: 'transferred_in',
            reason: a.notes || null,
            otherBuilding: fromB, otherRoom: fromR,
            leaseId,
            by: 'system-backfill', byEmail: null,
            source: 'backfill',
            idempotencyKey: key,
            notes: 'derived from amendments[] (variation transfer)',
            _at: at,
          },
          lease: L,
        });
      }
    }

    // 3. Terminal event
    const status = String(d.status || 'active');
    if (status === 'transferred') {
      const at = parseIso(d.transferredAt) || parseIso(d.updatedAt) || parseIso(d.contractEnd);
      const nextLeaseId = d.transferredToLeaseId;
      const nextLease = nextLeaseId ? byId.get(nextLeaseId) : null;
      if (at && nextLease) {
        const nextD = nextLease.data || {};
        const nextRoomId = nextD.roomId || nextD.room || '';
        const nextBuilding = building; // novation in this scope assumes same building
        // out at THIS lease's room, in at the NEXT lease's room
        const discOut = nextLeaseId;
        const discIn = leaseId;
        {
          const key = buildIdempotencyKey({ source: 'backfill', leaseId, action: 'transferred_out', building, roomId, discriminator: discOut });
          events.push({
            docPath: `tenants/${building}/list/${roomId}/occupancyLog/${key}`,
            key,
            data: {
              tenantId, tenantName, personId,
              building, roomId,
              action: 'transferred_out',
              reason: 'novation',
              otherBuilding: nextBuilding, otherRoom: nextRoomId,
              leaseId,
              by: 'system-backfill', byEmail: null,
              source: 'backfill',
              idempotencyKey: key,
              notes: `derived from terminal status='transferred' → ${nextLeaseId}`,
              _at: at,
            },
            lease: L,
          });
        }
        {
          const key = buildIdempotencyKey({ source: 'backfill', leaseId: nextLeaseId, action: 'transferred_in', building: nextBuilding, roomId: nextRoomId, discriminator: discIn });
          events.push({
            docPath: `tenants/${nextBuilding}/list/${nextRoomId}/occupancyLog/${key}`,
            key,
            data: {
              tenantId, tenantName, personId,
              building: nextBuilding, roomId: nextRoomId,
              action: 'transferred_in',
              reason: 'novation',
              otherBuilding: building, otherRoom: roomId,
              leaseId: nextLeaseId,
              by: 'system-backfill', byEmail: null,
              source: 'backfill',
              idempotencyKey: key,
              notes: `derived from prior lease ${leaseId} terminal status='transferred'`,
              _at: at,
            },
            lease: L,
          });
        }
      } else if (!nextLease) {
        events.push({ skipped: true, reason: `lease ${leaseId} status='transferred' but transferredToLeaseId='${nextLeaseId}' not found in this building's lease list`, lease: L });
      } else {
        events.push({ skipped: true, reason: `lease ${leaseId} status='transferred' but no parseable transferredAt/updatedAt`, lease: L });
      }
    } else if (status === 'ended') {
      const at = parseIso(d.endedAt) || parseIso(d.updatedAt) || parseIso(d.contractEnd);
      if (at) {
        const key = buildIdempotencyKey({ source: 'backfill', leaseId, action: 'moved_out', building, roomId, discriminator: '' });
        events.push({
          docPath: `tenants/${building}/list/${roomId}/occupancyLog/${key}`,
          key,
          data: {
            tenantId, tenantName, personId,
            building, roomId,
            action: 'moved_out',
            reason: d.endReason || null,
            otherBuilding: null, otherRoom: null,
            leaseId,
            by: 'system-backfill', byEmail: null,
            source: 'backfill',
            idempotencyKey: key,
            notes: "derived from terminal status='ended'",
            _at: at,
          },
          lease: L,
        });
      } else {
        events.push({ skipped: true, reason: `lease ${leaseId} status='ended' but no parseable endedAt/updatedAt`, lease: L });
      }
    }
    // status 'renewed' or 'active' or 'superseded' → no terminal event
  }

  return events;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('▶ Plan B\' S4 — occupancy log backfill');
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY (will write)'}`);
  if (BUILDING_FILTER) console.log(`  Building filter: ${BUILDING_FILTER}`);

  const token = getAccessToken();
  const buildings = BUILDING_FILTER ? [BUILDING_FILTER] : DEFAULT_BUILDINGS.slice();

  let grandLease = 0, grandEvent = 0, grandSkipped = 0, grandWritten = 0;
  const allEvents = [];

  for (const building of buildings) {
    console.log(`\n── Building: ${building} ──`);
    let leases;
    try {
      leases = await listCollection(`leases/${building}/list`, token);
    } catch (e) {
      console.error(`  ✗ Failed to list leases/${building}/list: ${e.message}`);
      continue;
    }
    console.log(`  leases found: ${leases.length}`);
    grandLease += leases.length;

    const events = deriveEvents(building, leases);
    const skipped = events.filter(e => e.skipped);
    const writes  = events.filter(e => !e.skipped);
    console.log(`  events derived: ${writes.length}`);
    console.log(`  skipped: ${skipped.length}`);
    grandEvent += writes.length;
    grandSkipped += skipped.length;

    if (skipped.length) {
      console.log(`  ─ skipped reasons (first 5):`);
      for (const s of skipped.slice(0, 5)) console.log(`    · ${s.reason}`);
    }

    allEvents.push(...writes);

    if (!DRY_RUN && writes.length) {
      console.log(`  writing ${writes.length} events…`);
      let ok = 0, fail = 0;
      for (const e of writes) {
        const payload = { ...e.data };
        delete payload._at; // server-side serverTimestamp would be best but
        // we don't have FieldValue via REST — embed the derived ISO into `at`
        // so timeline sorting works. Real-time CFs use serverTimestamp; this
        // backfill writes the historical ISO timestamp (more accurate anyway).
        payload.at = e.data._at;
        try {
          await writeDoc(e.docPath, payload, token);
          ok++;
        } catch (err) {
          fail++;
          console.error(`    ✗ ${e.docPath}: ${err.message}`);
        }
      }
      console.log(`  written: ${ok}, failed: ${fail}`);
      grandWritten += ok;
    }
  }

  // Sample output — first N events sorted by _at
  const sorted = allEvents.slice().sort((a, b) => (a.data._at || '').localeCompare(b.data._at || ''));
  console.log(`\n── Sample (oldest ${Math.min(SAMPLE_SIZE, sorted.length)} of ${sorted.length}) ──`);
  for (const e of sorted.slice(0, SAMPLE_SIZE)) {
    console.log(`  ${e.data._at} · ${e.data.action.padEnd(16)} ${e.data.building}/${e.data.roomId.padEnd(6)} ${(e.data.tenantName || '').padEnd(20)} lease=${e.data.leaseId.slice(0, 30)}…`);
  }

  // Action breakdown
  const breakdown = {};
  for (const e of allEvents) breakdown[e.data.action] = (breakdown[e.data.action] || 0) + 1;
  console.log(`\n── Action breakdown ──`);
  for (const [action, n] of Object.entries(breakdown).sort()) {
    console.log(`  ${action.padEnd(20)} ${n}`);
  }

  console.log(`\n── TOTAL ──`);
  console.log(`  leases scanned: ${grandLease}`);
  console.log(`  events derived: ${grandEvent}`);
  console.log(`  events skipped: ${grandSkipped}`);
  if (!DRY_RUN) console.log(`  events written: ${grandWritten}`);
  console.log(`  ratio events/lease: ${grandLease ? (grandEvent / grandLease).toFixed(2) : 'n/a'}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
