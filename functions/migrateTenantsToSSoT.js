/**
 * migrateTenantsToSSoT — one-off (but idempotent) Firestore consolidation.
 *
 * Tenant + lease data has been split across 4 places. This CF reads them all
 * and writes a single consolidated document per room at:
 *
 *     tenants/{building}/list/{roomId}        (canonical: building ∈ {rooms, nest})
 *
 * Sources (priority, newest first):
 *   1. tenants/{alias}/list/{roomId}          — tenant-edited (saveProfileEdit, OTP)
 *   2. tenants/{alias}/list/{TENANT_*}        — admin-master (TenantConfigManager)
 *   3. leases/{alias}/list/{leaseId}          — admin lease (LeaseAgreementManager)
 *   4. buildings/{alias}/rooms/{roomId}       — legacy snapshot (migrateToFirestore.js)
 *
 *   alias ∈ {rooms, RentRoom, nest, Nest} — both casings/aliases handled.
 *
 * Auth: admin custom-claim required.
 *
 * Modes:
 *   GET ?mode=dry-run  (default) — log what WOULD change, no writes
 *   GET ?mode=apply              — actually write merged docs to tenants/{b}/list/{roomId}
 *
 * Filters:
 *   ?building=rooms|nest         — restrict to one canonical building
 *   ?room=<roomId>               — restrict to one room (debug single-room migration)
 *
 * Idempotent: rerun any time, it merges over existing fields with set(merge:true).
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

// canonical building → list of aliases that may exist in Firestore today
const BUILDING_ALIASES = {
  rooms: ['rooms', 'RentRoom'],
  nest:  ['nest', 'Nest'],
};

// A doc keyed by `TENANT_<timestamp>_<roomId>` is the admin-master tenant doc
// (TenantConfigManager.saveTenantToFirebase). Anything else is treated as
// tenant-edited (saveProfileEdit / setVerifiedPhone), which keys by roomId.
function isTenantIdKey(key) {
  return /^TENANT_\d+/.test(String(key));
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function stripEmpty(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object' && obj._seconds === undefined) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      const cleaned = stripEmpty(v);
      if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
      out[k] = cleaned;
    }
    return out;
  }
  return obj;
}

function diffKeys(existing, proposed) {
  const ignore = new Set(['migratedAt', 'updatedAt']);
  const changed = [];
  const seen = new Set([...Object.keys(existing || {}), ...Object.keys(proposed || {})]);
  for (const k of seen) {
    if (ignore.has(k)) continue;
    if (JSON.stringify((existing || {})[k]) !== JSON.stringify((proposed || {})[k])) {
      changed.push(k);
    }
  }
  return changed;
}

exports.migrateTenantsToSSoT = functions
  .region('asia-southeast1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }

    const decoded = await requireAdmin(req, res);
    if (!decoded) return;

    const mode = req.query.mode === 'apply' ? 'apply' : 'dry-run';
    const buildingFilter = req.query.building;
    const roomFilter = req.query.room ? String(req.query.room) : null;
    const targets = buildingFilter ? [buildingFilter] : ['rooms', 'nest'];

    if (targets.some(b => !BUILDING_ALIASES[b])) {
      return res.status(400).json({ error: 'building must be rooms or nest' });
    }

    const fs = admin.firestore();
    const log = [];
    const summary = { totalRooms: 0, withChanges: 0, written: 0, skipped: 0 };

    for (const building of targets) {
      log.push(`\n=== Building: ${building} (aliases: ${BUILDING_ALIASES[building].join(', ')}) ===`);

      const rooms = {}; // roomId → { buildings, tenantsByRoom, tenantsByTenantId, lease, _meta:{...} }

      // ── 1a. buildings/{alias}/rooms/{roomId} ─────────────────────────────
      for (const alias of BUILDING_ALIASES[building]) {
        const snap = await fs.collection('buildings').doc(alias).collection('rooms').get();
        snap.forEach(d => {
          if (!rooms[d.id]) rooms[d.id] = { _sources: [] };
          rooms[d.id].buildings = d.data();
          rooms[d.id]._sources.push(`buildings/${alias}/rooms/${d.id}`);
        });
      }

      // ── 1b. tenants/{alias}/list/* ───────────────────────────────────────
      for (const alias of BUILDING_ALIASES[building]) {
        const snap = await fs.collection('tenants').doc(alias).collection('list').get();
        snap.forEach(d => {
          const data = d.data();
          let roomId;
          if (isTenantIdKey(d.id)) {
            // Admin-master doc keyed by TENANT_xxx_roomId — extract roomId
            const match = String(d.id).match(/^TENANT_\d+_(.+)$/);
            roomId = data.roomId || data.room || (match ? match[1] : null);
            if (!roomId) {
              log.push(`  ⚠️ Skipped tenants/${alias}/list/${d.id}: cannot determine roomId`);
              return;
            }
            if (!rooms[roomId]) rooms[roomId] = { _sources: [] };
            rooms[roomId].tenantsByTenantId = data;
            rooms[roomId]._tenantIdKey = d.id;
            rooms[roomId]._sources.push(`tenants/${alias}/list/${d.id}`);
          } else {
            // Tenant-edited doc, keyed by roomId
            roomId = d.id;
            if (!rooms[roomId]) rooms[roomId] = { _sources: [] };
            rooms[roomId].tenantsByRoom = data;
            rooms[roomId]._tenantsByRoomAlias = alias;
            rooms[roomId]._sources.push(`tenants/${alias}/list/${d.id}`);
          }
        });
      }

      // ── 1c. leases/{alias}/list/* — pick active or most recent per room ──
      for (const alias of BUILDING_ALIASES[building]) {
        const snap = await fs.collection('leases').doc(alias).collection('list').get();
        snap.forEach(d => {
          const data = d.data();
          const roomId = data.roomId || data.room;
          if (!roomId) return;
          if (!rooms[roomId]) rooms[roomId] = { _sources: [] };
          const cur = rooms[roomId].lease;
          const better = !cur ||
                         (data.status === 'active' && cur.status !== 'active') ||
                         (cur.status !== 'active' && new Date(data.updatedAt || 0) > new Date(cur.updatedAt || 0));
          if (better) {
            rooms[roomId].lease = { ...data, _leaseId: d.id, _leaseAlias: alias };
            rooms[roomId]._sources.push(`leases/${alias}/list/${d.id}`);
          }
        });
      }

      // ── 2. Build merged doc per room and write/log ───────────────────────
      for (const [roomId, src] of Object.entries(rooms)) {
        if (roomFilter && roomId !== roomFilter) continue;
        summary.totalRooms++;

        const b = src.buildings || {};
        const bTenant = b.tenant || b.personalInfo || {};
        const bOps = b.operations || {};
        const bLease = b.lease || {};
        const tByRoom = src.tenantsByRoom || {};
        const tByTid = src.tenantsByTenantId || {};
        const lease = src.lease || {};

        // Strategy: spread admin-master + tenant-edited as BASE (preserves all
        // identity fields like firstName/lastName/idCardNumber/address/notes/lineID),
        // then OVERLAY canonical structured fields. Anything in tByTid/tByRoom
        // we don't explicitly map still survives via the spread.
        const merged = {
          // Base layer — oldest first, newest overrides via Object.assign order
          ...bTenant,
          ...bOps,
          ...tByTid,
          ...tByRoom,

          // Canonical structured identity fields (override base if present)
          name:         pickFirst(tByRoom.name, tByTid.name, bTenant.name, lease.tenantName, bOps.tenantName),
          phone:        pickFirst(tByRoom.phone, tByTid.phone, bTenant.phone, bOps.tenantPhone),
          email:        pickFirst(tByRoom.email, tByTid.email, bTenant.email, bOps.tenantEmail),
          licensePlate: pickFirst(tByRoom.licensePlate, tByTid.licensePlate, bTenant.licensePlate, bOps.plateNumber),

          // Lease snapshot — leases/{b}/list/* archive stays untouched
          lease: {
            startDate:        pickFirst(lease.moveInDate, tByTid.moveInDate, tByRoom.moveInDate, bLease.moveInDate),
            endDate:          pickFirst(lease.moveOutDate, tByTid.moveOutDate, tByRoom.moveOutDate, bLease.moveOutDate),
            rentAmount:       pickFirst(lease.rentAmount, bLease.rentAmount),
            deposit:          pickFirst(lease.deposit, tByTid.deposit, tByRoom.deposit, bLease.deposit),
            status:           pickFirst(lease.status, bLease.status, 'empty'),
            contractDocument: pickFirst(lease.contractDocument, tByTid.contractDocument, tByRoom.contractDocument, bLease.contractDocument),
            contractFileName: pickFirst(lease.contractFileName, tByTid.contractFileName, tByRoom.contractFileName),
            documents:        pickFirst(lease.documents, lease.documentURLs),
            leaseId:          lease._leaseId || null,
          },

          // Identifiers / auth links
          tenantId:        pickFirst(tByRoom.tenantId, tByTid.id, lease.tenantId, bOps.tenantId, src._tenantIdKey),
          linkedAuthUid:   tByRoom.linkedAuthUid || null,
          linkedAt:        tByRoom.linkedAt || null,
          phoneVerifiedAt: tByRoom.phoneVerifiedAt || null,
          lineUserId:      tByRoom.lineUserId || null,

          // Tenant-managed prefs
          companyInfo: pickFirst(tByRoom.companyInfo, tByTid.companyInfo, bTenant.companyInfo),
          receiptType: pickFirst(tByRoom.receiptType, tByTid.receiptType, bTenant.receiptType),

          // Gamification — admin-controlled, never lose state
          gamification: pickFirst(tByRoom.gamification, tByTid.gamification),

          // Metadata
          building:    building,
          roomId:      roomId,
          migratedAt:  admin.firestore.FieldValue.serverTimestamp(),
        };

        // Drop spread artifacts that are now redundant (replaced by structured fields)
        delete merged.id;             // was tenantId via TenantConfigManager — now in .tenantId
        delete merged.createdDate;    // localStorage artifact
        delete merged.tenant;         // legacy buildings/.../rooms.tenant nesting
        delete merged.operations;     // legacy buildings/.../rooms.operations nesting
        delete merged.personalInfo;   // alias of .tenant
        // Operations subobject duplicates canonical fields — drop them
        delete merged.tenantName;     // → .name
        delete merged.tenantPhone;    // → .phone
        delete merged.tenantEmail;    // → .email
        delete merged.plateNumber;    // → .licensePlate
        // Promote moveInDate/moveOutDate/deposit/contract* to .lease only
        delete merged.moveInDate;
        delete merged.moveOutDate;
        delete merged.contractDocument;
        delete merged.contractFileName;
        delete merged.deposit;

        const cleaned = stripEmpty(merged);

        // Read current canonical doc to diff
        const destRef = fs.collection('tenants').doc(building).collection('list').doc(roomId);
        const existingSnap = await destRef.get();
        const existing = existingSnap.exists ? existingSnap.data() : null;

        const changedKeys = diffKeys(existing, cleaned);
        if (changedKeys.length === 0) {
          log.push(`  ✅ ${roomId}: no changes (sources: ${src._sources.length})`);
          summary.skipped++;
          continue;
        }

        summary.withChanges++;
        log.push(`  📝 ${roomId}: changed [${changedKeys.join(', ')}] from ${src._sources.length} sources`);
        log.push(`      sources: ${src._sources.join(' | ')}`);
        log.push(`      merged:  name=${cleaned.name||'∅'} phone=${cleaned.phone||'∅'} email=${cleaned.email||'∅'} lease.status=${cleaned.lease?.status||'∅'} rent=${cleaned.lease?.rentAmount||'∅'} deposit=${cleaned.lease?.deposit||'∅'}`);

        if (mode === 'apply') {
          await destRef.set(cleaned, { merge: true });
          summary.written++;
        }
      }
    }

    log.push(`\n=== Summary ===`);
    log.push(`Mode: ${mode}`);
    log.push(`Total rooms scanned: ${summary.totalRooms}`);
    log.push(`Rooms with changes:  ${summary.withChanges}`);
    log.push(`Rooms unchanged:     ${summary.skipped}`);
    log.push(`Docs written:        ${summary.written}${mode === 'dry-run' ? ' (dry-run — would have written withChanges count)' : ''}`);

    return res.status(200).json({
      ok: true,
      mode,
      summary,
      log,
    });
  });
