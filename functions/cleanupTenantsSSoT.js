/**
 * cleanupTenantsSSoT — Phase 6 cleanup of legacy tenant/lease paths.
 *
 * After Phase 2 migration consolidated everything into tenants/{b}/list/{roomId},
 * three classes of legacy data remain:
 *
 *   1. Top-level duplicates inside tenants/{b}/list/{roomId} — fields like
 *      `deposit`, `contractDocument`, `moveInDate` survive at the doc root
 *      AND inside `.lease`. The .lease subobject is the SSoT, so root copies
 *      are noise (and a future-write footgun).
 *
 *   2. tenants/{b}/list/TENANT_<ts>_<roomId> docs — admin-master tenant docs
 *      keyed by tenantId, written by TenantConfigManager.saveTenantToFirebase
 *      pre-Phase-4. Their content has been merged into the roomId-keyed doc.
 *
 *   3. buildings/{alias}/rooms/{roomId}.{tenant, lease, operations, personalInfo}
 *      subobjects — original snapshot from migrateToFirestore.js. Now stale.
 *      The room doc itself stays for room-level config (rates, area, etc.),
 *      but the per-tenant subobjects move to tenants/{b}/list/{roomId}.
 *
 * Auth: admin custom-claim required. Dry-run by default.
 *
 * Tasks (?task=...):
 *   - top-level-dupes        Remove root-level dupes from tenants/{b}/list/{roomId}
 *   - tenant-id-docs         Delete tenants/{b}/list/TENANT_*
 *   - buildings-subobjects   Remove .tenant/.lease/.operations/.personalInfo from buildings/{alias}/rooms/{r}
 *   - all (default)          Run all three sequentially
 *
 * Modes:
 *   - ?mode=dry-run (default)   Log what would change, no writes
 *   - ?mode=apply               Write changes
 *
 * Filters:
 *   - ?building=rooms|nest      Restrict to one canonical building
 *
 * Idempotent: rerun any time, no-op once cleanup is complete.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdmin } = require('./_auth');

if (!admin.apps.length) admin.initializeApp();

const FIELD_DELETE = admin.firestore.FieldValue.delete;

const BUILDING_ALIASES = {
  rooms: ['rooms', 'RentRoom'],
  nest:  ['nest', 'Nest'],
};

// Top-level fields on tenants/{b}/list/{roomId} that duplicate `.lease.X` after Phase-2.
// Drop these — they are read with `t.lease.X || t.X` fallback, so removal is safe.
const TOP_LEVEL_DUPE_FIELDS = [
  'deposit',
  'contractDocument',
  'contractFileName',
  'moveInDate',
  'moveOutDate',
  'rentAmount',
  // 'documents' was sometimes at root too — leave; storage URLs are admin-managed
];

// Subobjects on buildings/{alias}/rooms/{r} to drop after migration.
// Room-level config (rentPrice/electricRate/waterRate/area/internet) stays.
const BUILDINGS_DROP_FIELDS = [
  'tenant',
  'lease',
  'operations',
  'personalInfo',
];

function isTenantIdKey(key) {
  return /^TENANT_\d+/.test(String(key));
}

exports.cleanupTenantsSSoT = functions
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
    const task = req.query.task || 'all';
    const buildingFilter = req.query.building;
    const targets = buildingFilter ? [buildingFilter] : ['rooms', 'nest'];

    if (targets.some(b => !BUILDING_ALIASES[b])) {
      return res.status(400).json({ error: 'building must be rooms or nest' });
    }
    const validTasks = ['top-level-dupes', 'tenant-id-docs', 'buildings-subobjects', 'all'];
    if (!validTasks.includes(task)) {
      return res.status(400).json({ error: `task must be one of ${validTasks.join(', ')}` });
    }

    const fs = admin.firestore();
    const log = [];
    const summary = {
      topLevelDupesScanned: 0,  topLevelDupesCleared: 0,
      tenantIdDocsScanned: 0,   tenantIdDocsDeleted: 0,
      buildingsRoomsScanned: 0, buildingsRoomsCleared: 0,
    };

    const runTopLevelDupes = task === 'top-level-dupes' || task === 'all';
    const runTenantIdDocs = task === 'tenant-id-docs' || task === 'all';
    const runBuildingsSubobjects = task === 'buildings-subobjects' || task === 'all';

    // ─────────────────────────────────────────────────────────────────────
    // Task 1: tenants/{b}/list/{roomId} — drop root-level dupes of .lease.X
    // ─────────────────────────────────────────────────────────────────────
    if (runTopLevelDupes) {
      log.push(`\n=== Task: top-level-dupes (remove root deposit/contractDocument/etc.) ===`);
      for (const building of targets) {
        const snap = await fs.collection('tenants').doc(building).collection('list').get();
        snap.forEach(d => {
          if (isTenantIdKey(d.id)) return; // those are deleted by task 2
          summary.topLevelDupesScanned++;
          const data = d.data();
          const toClear = TOP_LEVEL_DUPE_FIELDS.filter(f => data[f] !== undefined);
          if (!toClear.length) {
            log.push(`  ✅ tenants/${building}/list/${d.id}: no root dupes`);
            return;
          }
          summary.topLevelDupesCleared++;
          log.push(`  📝 tenants/${building}/list/${d.id}: drop [${toClear.join(', ')}]`);
        });
      }

      if (mode === 'apply') {
        for (const building of targets) {
          const snap = await fs.collection('tenants').doc(building).collection('list').get();
          for (const d of snap.docs) {
            if (isTenantIdKey(d.id)) continue;
            const data = d.data();
            const updates = {};
            TOP_LEVEL_DUPE_FIELDS.forEach(f => {
              if (data[f] !== undefined) updates[f] = FIELD_DELETE();
            });
            if (Object.keys(updates).length) {
              await d.ref.update(updates);
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task 2: tenants/{b}/list/TENANT_* — delete legacy tenantId-keyed docs
    // ─────────────────────────────────────────────────────────────────────
    if (runTenantIdDocs) {
      log.push(`\n=== Task: tenant-id-docs (delete tenants/{b}/list/TENANT_*) ===`);
      for (const building of targets) {
        for (const alias of BUILDING_ALIASES[building]) {
          const snap = await fs.collection('tenants').doc(alias).collection('list').get();
          snap.forEach(d => {
            if (!isTenantIdKey(d.id)) return;
            summary.tenantIdDocsScanned++;
            const data = d.data();
            log.push(`  🗑️  tenants/${alias}/list/${d.id}: delete (tenantName=${data.name || data.firstName || '?'})`);
            summary.tenantIdDocsDeleted++;
          });
        }
      }

      if (mode === 'apply') {
        for (const building of targets) {
          for (const alias of BUILDING_ALIASES[building]) {
            const snap = await fs.collection('tenants').doc(alias).collection('list').get();
            for (const d of snap.docs) {
              if (!isTenantIdKey(d.id)) continue;
              await d.ref.delete();
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task 3: buildings/{alias}/rooms/{r} — drop .tenant/.lease/.operations
    // ─────────────────────────────────────────────────────────────────────
    if (runBuildingsSubobjects) {
      log.push(`\n=== Task: buildings-subobjects (drop .tenant/.lease/.operations from rooms doc) ===`);
      for (const building of targets) {
        for (const alias of BUILDING_ALIASES[building]) {
          const snap = await fs.collection('buildings').doc(alias).collection('rooms').get();
          snap.forEach(d => {
            summary.buildingsRoomsScanned++;
            const data = d.data();
            const toClear = BUILDINGS_DROP_FIELDS.filter(f => data[f] !== undefined);
            if (!toClear.length) {
              log.push(`  ✅ buildings/${alias}/rooms/${d.id}: no legacy subobjects`);
              return;
            }
            summary.buildingsRoomsCleared++;
            log.push(`  📝 buildings/${alias}/rooms/${d.id}: drop [${toClear.join(', ')}]`);
          });
        }
      }

      if (mode === 'apply') {
        for (const building of targets) {
          for (const alias of BUILDING_ALIASES[building]) {
            const snap = await fs.collection('buildings').doc(alias).collection('rooms').get();
            for (const d of snap.docs) {
              const data = d.data();
              const updates = {};
              BUILDINGS_DROP_FIELDS.forEach(f => {
                if (data[f] !== undefined) updates[f] = FIELD_DELETE();
              });
              if (Object.keys(updates).length) {
                await d.ref.update(updates);
              }
            }
          }
        }
      }
    }

    log.push(`\n=== Summary ===`);
    log.push(`Mode: ${mode}`);
    log.push(`Task: ${task}`);
    Object.entries(summary).forEach(([k, v]) => log.push(`  ${k}: ${v}`));

    return res.status(200).json({ ok: true, mode, task, summary, log });
  });
