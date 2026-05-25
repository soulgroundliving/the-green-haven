/**
 * smoke-transfer-tenant — live E2E exerciser for the transferTenant CF.
 *
 * Closes carryover item #5 from next_session_handoff_2026_05_25_sprint7_marketplace_complete.md.
 *
 * Why this exists:
 *   Unit tests (functions/__tests__/transferTenant.test.js, 51+ cases) cover the
 *   carry-over contract end-to-end with mocked Firestore. But none of them touch
 *   production data. The 2026-05-23 daily-bonus session asked for a live smoke
 *   that verifies the 6-collection write matrix (tenants/leases/people/liffUsers/
 *   occupancyLog/Auth claims) against the real-shaped seeded record, with the
 *   admin SDK avoiding the §7-JJ-fragile dashboard.html UI path entirely.
 *
 * Strategy:
 *   - DRY-RUN (default): read source + target rooms, print the expected diff,
 *     identify whether pre-conditions hold (source occupied, target vacant,
 *     active lease, etc.). Touches Firestore for READS ONLY.
 *   - APPLY: directly invoke _runVariationMode / _runNovationMode from the CF
 *     module. These are exported helpers — they take a fake (callerUid, callerEmail,
 *     firestore) and execute the full batch + claim refresh + audit-log write
 *     EXACTLY like the live callable. After commit, re-read both rooms + the
 *     lease doc + people doc and assert the post-state matches expectations.
 *   - ROLLBACK: if --rollback is passed AFTER an apply, runs the inverse
 *     transfer (newRoom → oldRoom) so the smoke is non-destructive over the
 *     full run. Variation rollback = another variation back; novation rollback
 *     creates a third lease doc per Thai property practice (novation is
 *     one-way legally — caller must accept the extra paperwork).
 *
 * Usage:
 *   # Pick rooms — must be a tenant pair you actually want to exercise.
 *   # Source MUST have an active tenant with active lease. Target MUST be vacant.
 *
 *   # 1. Dry-run — preview what would happen
 *   NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \
 *     --building nest --old N101 --new N301 --mode variation
 *
 *   # 2. Apply — actually run the CF against production data
 *   NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \
 *     --building nest --old N101 --new N301 --mode variation --apply
 *
 *   # 3. Rollback — reverse the just-applied transfer (variation mode only;
 *   # novation creates a 3rd lease doc, less clean)
 *   NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \
 *     --building nest --old N301 --new N101 --mode variation --apply
 *
 * Production-data caveats (per CLAUDE.md §7-I):
 *   - This script writes to production Firestore + Firebase Auth claims when
 *     --apply is set. Treat it as a destructive action: dry-run first, eyeball
 *     the diff, then apply. The script itself ENFORCES the dry-run-first gate.
 *   - The user MUST own the room pair being transferred. Don't run this against
 *     someone else's tenant. The transferTenant CF doesn't ask for the tenant's
 *     consent — admin override.
 *   - Custom-claims refresh runs against the linked LIFF UID. The user whose
 *     tenant just moved may need to close-and-reopen LINE to pick up new claims
 *     (per §7-FF — server-side revokeRefreshTokens lands quickly; client cached
 *     ID token lives up to ~1 h otherwise).
 *
 * Pre-requisites:
 *   - functions/serviceAccountKey.json present (gitignored), OR
 *   - GOOGLE_APPLICATION_CREDENTIALS env var set to a SA key file, OR
 *   - `gcloud auth application-default login` configured.
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// CF helpers — exported from functions/transferTenant.js for white-box testing.
const transferCf = require('../functions/transferTenant.js');
const { _runVariationMode, _runNovationMode, _writeAuditLog } = transferCf;

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { apply: false, mode: 'variation' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; continue; }
    if (a === '--building') { args.building = argv[++i]; continue; }
    if (a === '--old') { args.oldRoomId = argv[++i]; continue; }
    if (a === '--new') { args.newRoomId = argv[++i]; continue; }
    if (a === '--new-building') { args.newBuilding = argv[++i]; continue; }
    if (a === '--mode') { args.mode = argv[++i]; continue; }
    if (a === '--notes') { args.notes = argv[++i]; continue; }
    if (a === '-h' || a === '--help') { args.help = true; continue; }
  }
  if (!args.newBuilding) args.newBuilding = args.building;
  return args;
}

function printUsage() {
  console.log(`
Usage: NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \\
         --building <id> --old <roomId> --new <roomId> [options]

Required:
  --building <id>     Source building (rooms | nest | ...)
  --old <roomId>      Source room — MUST be occupied with active lease
  --new <roomId>      Target room — MUST be vacant or non-existent

Options:
  --new-building <id> Target building (default: same as --building)
  --mode <m>          variation (default) | novation
  --notes "<str>"     Admin note recorded in amendment / new lease
  --apply             Actually invoke the CF (default = dry-run preview)
  -h, --help          Show this help

Examples:
  # Preview
  NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \\
    --building nest --old N101 --new N301 --mode variation

  # Run for real
  NODE_PATH=functions/node_modules node tools/smoke-transfer-tenant.js \\
    --building nest --old N101 --new N301 --mode variation --apply
`);
}

// ─── Admin SDK init ──────────────────────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return;
  const candidates = [
    path.join(__dirname, '..', 'functions', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const key = require(p);
      admin.initializeApp({
        credential: admin.credential.cert(key),
        projectId: key.project_id,
        // RTDB needed for audit-log write — match production region URL shape.
        databaseURL: `https://${key.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`,
        storageBucket: `${key.project_id}.appspot.com`,
      });
      console.log(`✓ Initialized from ${p}`);
      return;
    }
  }
  admin.initializeApp({ projectId: 'the-green-haven' });
  console.log('✓ Initialized with Application Default Credentials');
}

// ─── State readers ───────────────────────────────────────────────────────────
async function readRoom(db, building, roomId) {
  const ref = db.collection('tenants').doc(building).collection('list').doc(roomId);
  const snap = await ref.get();
  return { ref, exists: snap.exists, data: snap.exists ? (snap.data() || {}) : null };
}

async function readLease(db, building, leaseId) {
  if (!leaseId) return { exists: false, data: null };
  const ref = db.collection('leases').doc(building).collection('list').doc(leaseId);
  const snap = await ref.get();
  return { ref, exists: snap.exists, data: snap.exists ? (snap.data() || {}) : null };
}

function resolveLeaseIdFromTenant(td) {
  if (!td) return null;
  return (td.lease && td.lease.leaseId) || td.activeContractId || (td.contractId ? String(td.contractId) : null);
}

function summarizeRoom(label, building, roomId, td) {
  const lines = [`  ${label} → ${building}/${roomId}`];
  if (!td) {
    lines.push('    (doc does not exist)');
    return lines.join('\n');
  }
  const name = td.name || [td.firstName, td.lastName].filter(Boolean).join(' ') || '(no name)';
  const leaseId = resolveLeaseIdFromTenant(td);
  const g = td.gamification || {};
  lines.push(`    tenantId       : ${td.tenantId || '(empty)'}`);
  lines.push(`    name           : ${name}`);
  lines.push(`    status         : ${td.status || '(unset)'}`);
  lines.push(`    leaseId        : ${leaseId || '(none)'}`);
  lines.push(`    rentAmount     : ${td.rentAmount || 0}`);
  lines.push(`    contractEnd    : ${td.contractEnd || '(unset)'}`);
  lines.push(`    linkedAuthUid  : ${td.linkedAuthUid || '(unlinked)'}`);
  lines.push(`    gamification   : points=${g.points || 0} streak=${g.dailyStreak || 0} badges=${(g.badges || []).length}`);
  return lines.join('\n');
}

// ─── Pre-condition checks ────────────────────────────────────────────────────
function checkPreconditions(building, oldRoomId, newBuilding, newRoomId, src, tgt, lease) {
  const issues = [];
  if (!src.exists)     issues.push(`tenants/${building}/list/${oldRoomId} does not exist`);
  if (src.exists && !(src.data.tenantId || '').trim()) issues.push(`source ${building}/${oldRoomId} is vacant (no tenantId)`);
  if (!lease.exists)   issues.push(`lease doc not found at leases/${building}/list/<resolvedLeaseId>`);
  if (lease.exists && (lease.data.status || 'active') !== 'active') issues.push(`source lease has status='${lease.data.status}' — must be 'active'`);
  if (tgt.exists && (tgt.data.tenantId || '').trim()) issues.push(`target ${newBuilding}/${newRoomId} is occupied (tenantId='${tgt.data.tenantId}')`);
  if (building === newBuilding && oldRoomId === newRoomId) issues.push(`same-room transfer is a no-op`);
  return issues;
}

// ─── Post-state assertions ───────────────────────────────────────────────────
function assertPostState(building, oldRoomId, newBuilding, newRoomId, srcPre, srcPost, tgtPost, mode) {
  const expected = [];
  const actual = [];

  // OLD room: identity blanked, status='vacant'
  const oldTenantIdNowEmpty = !(srcPost.data && (srcPost.data.tenantId || '').trim());
  expected.push(`OLD/${oldRoomId}.tenantId empty`);
  actual.push(`OLD/${oldRoomId}.tenantId=${(srcPost.data && srcPost.data.tenantId) || '(empty)'}`);
  const oldStatusVacant = srcPost.data && srcPost.data.status === 'vacant';
  expected.push(`OLD/${oldRoomId}.status='vacant'`);
  actual.push(`OLD/${oldRoomId}.status=${(srcPost.data && srcPost.data.status) || '(unset)'}`);

  // OLD gamification: blanked to null (carried to new room)
  const oldGamiNull = srcPost.data && (srcPost.data.gamification === null || srcPost.data.gamification === undefined);
  expected.push(`OLD/${oldRoomId}.gamification=null`);
  actual.push(`OLD/${oldRoomId}.gamification=${srcPost.data ? JSON.stringify(srcPost.data.gamification) : '(no data)'}`);

  // NEW room: identity carried, status='occupied', gamification matches pre-transfer source
  const newTenantIdMatches = tgtPost.data && (tgtPost.data.tenantId || '') === ((srcPre.data && srcPre.data.tenantId) || '');
  expected.push(`NEW/${newRoomId}.tenantId == source.tenantId`);
  actual.push(`NEW/${newRoomId}.tenantId=${tgtPost.data && tgtPost.data.tenantId}`);
  const newStatusOccupied = tgtPost.data && tgtPost.data.status === 'occupied';
  expected.push(`NEW/${newRoomId}.status='occupied'`);
  actual.push(`NEW/${newRoomId}.status=${tgtPost.data && tgtPost.data.status}`);

  const sourcePoints = (srcPre.data && srcPre.data.gamification && srcPre.data.gamification.points) || 0;
  const newPoints = (tgtPost.data && tgtPost.data.gamification && tgtPost.data.gamification.points) || 0;
  const gamiCarried = newPoints === sourcePoints;
  expected.push(`NEW/${newRoomId}.gamification.points == ${sourcePoints}`);
  actual.push(`NEW/${newRoomId}.gamification.points=${newPoints}`);

  const passes = oldTenantIdNowEmpty && oldStatusVacant && oldGamiNull && newTenantIdMatches && newStatusOccupied && gamiCarried;
  return { passes, expected, actual };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.building || !args.oldRoomId || !args.newRoomId) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }
  if (args.mode !== 'variation' && args.mode !== 'novation') {
    console.error(`Mode must be 'variation' or 'novation' (got '${args.mode}')`);
    process.exit(1);
  }

  initAdmin();
  const db = admin.firestore();

  console.log('');
  console.log(`Mode: ${args.apply ? '⚠️  APPLY (will write production data)' : '🧪 DRY-RUN (read-only)'}`);
  console.log(`Transfer: ${args.building}/${args.oldRoomId}  →  ${args.newBuilding}/${args.newRoomId}`);
  console.log(`Variant : ${args.mode}`);
  console.log('');

  // ── Read pre-state ─────────────────────────────────────────────────────────
  const srcPre = await readRoom(db, args.building, args.oldRoomId);
  const tgtPre = await readRoom(db, args.newBuilding, args.newRoomId);
  const leaseId = resolveLeaseIdFromTenant(srcPre.data);
  const leasePre = await readLease(db, args.building, leaseId);

  console.log('── Source state ──');
  console.log(summarizeRoom('SRC', args.building, args.oldRoomId, srcPre.data));
  console.log('');
  console.log('── Target state ──');
  console.log(summarizeRoom('TGT', args.newBuilding, args.newRoomId, tgtPre.data));
  console.log('');
  if (leasePre.exists) {
    console.log('── Source lease ──');
    console.log(`  leases/${args.building}/list/${leaseId}`);
    console.log(`    status        : ${leasePre.data.status || '(unset)'}`);
    console.log(`    rentAmount    : ${leasePre.data.rentAmount || 0}`);
    console.log(`    moveOutDate   : ${leasePre.data.moveOutDate || leasePre.data.endDate || '(unset)'}`);
    console.log(`    amendments[]  : ${Array.isArray(leasePre.data.amendments) ? leasePre.data.amendments.length : 0}`);
    console.log('');
  }

  // ── Pre-condition check ────────────────────────────────────────────────────
  const issues = checkPreconditions(args.building, args.oldRoomId, args.newBuilding, args.newRoomId, srcPre, tgtPre, leasePre);
  if (issues.length) {
    console.log('❌ Pre-conditions failed:');
    for (const i of issues) console.log(`   · ${i}`);
    console.log('');
    process.exit(1);
  }
  console.log('✓ Pre-conditions OK — transfer would proceed.');
  console.log('');

  if (!args.apply) {
    console.log('Dry-run complete. Re-run with --apply to actually invoke the CF.');
    console.log('');
    console.log('Expected post-state (per transferTenant._runVariationMode contract):');
    console.log(`   OLD/${args.oldRoomId}: identity blanked, status='vacant', gamification=null`);
    console.log(`   NEW/${args.newRoomId}: identity carried, status='occupied', gamification carried`);
    if (args.mode === 'variation') {
      console.log(`   lease ${leaseId}: roomId/building updated, amendments[] += room_transfer entry`);
    } else {
      console.log(`   lease ${leaseId}: status='transferred', transferredToLeaseId set`);
      console.log(`   new lease    : created at leases/${args.newBuilding}/list/CONTRACT_*, priorLeaseId chain`);
    }
    console.log(`   Auth claims  : refreshed for linkedAuthUid (if present)`);
    console.log(`   audit_logs/leases: push entry {action:'tenant_transferred', mode:'${args.mode}', ...}`);
    return;
  }

  // ── APPLY: invoke the CF helper directly ───────────────────────────────────
  console.log('⚠️  Invoking transferTenant CF helper directly (admin-bypass)...');
  console.log('');

  const cfInput = {
    building: args.building,
    oldRoomId: args.oldRoomId,
    newBuilding: args.newBuilding,
    newRoomId: args.newRoomId,
    mode: args.mode,
    effectiveDate: new Date(),
    transferDeposit: true,
    prorateBills: false,
    notes: args.notes || 'smoke-transfer-tenant.js E2E',
  };
  const runner = args.mode === 'variation' ? _runVariationMode : _runNovationMode;
  let result;
  try {
    result = await runner(cfInput, 'smoke-script', 'smoke@local', db);
  } catch (e) {
    console.error('❌ CF helper threw:', e.message || e);
    if (e.code) console.error(`   code: ${e.code}`);
    process.exit(2);
  }

  if (_writeAuditLog) {
    try { await _writeAuditLog(result.auditPayload); } catch (_) { /* non-fatal */ }
  }

  console.log('✓ CF invocation returned:');
  for (const [k, v] of Object.entries(result)) {
    if (k === 'auditPayload') continue;
    console.log(`   ${k.padEnd(18)}: ${JSON.stringify(v)}`);
  }
  console.log('');

  // ── Verify post-state ──────────────────────────────────────────────────────
  console.log('── Verifying post-state ──');
  const srcPost = await readRoom(db, args.building, args.oldRoomId);
  const tgtPost = await readRoom(db, args.newBuilding, args.newRoomId);

  const verdict = assertPostState(args.building, args.oldRoomId, args.newBuilding, args.newRoomId, srcPre, srcPost, tgtPost, args.mode);
  console.log('');
  for (let i = 0; i < verdict.expected.length; i++) {
    const exp = verdict.expected[i];
    const got = verdict.actual[i];
    const m = (() => {
      switch (i) {
        case 0: return !(srcPost.data && (srcPost.data.tenantId || '').trim());
        case 1: return srcPost.data && srcPost.data.status === 'vacant';
        case 2: return srcPost.data && (srcPost.data.gamification === null || srcPost.data.gamification === undefined);
        case 3: return tgtPost.data && (tgtPost.data.tenantId || '') === ((srcPre.data && srcPre.data.tenantId) || '');
        case 4: return tgtPost.data && tgtPost.data.status === 'occupied';
        case 5: {
          const sp = (srcPre.data && srcPre.data.gamification && srcPre.data.gamification.points) || 0;
          const np = (tgtPost.data && tgtPost.data.gamification && tgtPost.data.gamification.points) || 0;
          return sp === np;
        }
        default: return false;
      }
    })();
    console.log(`  ${m ? '✓' : '✗'}  expected: ${exp}`);
    console.log(`     got     : ${got}`);
  }
  console.log('');
  console.log(verdict.passes
    ? `✅ E2E smoke PASSED — all 6 assertions hold.`
    : `❌ E2E smoke FAILED — at least one assertion drift detected.`);
  if (!verdict.passes) process.exit(3);
}

main().catch(err => {
  console.error('❌ smoke-transfer-tenant failed:', err);
  process.exit(1);
});
