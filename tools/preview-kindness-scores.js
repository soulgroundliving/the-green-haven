/**
 * READ-ONLY preview of Kindness scores against LIVE prod data (§7-J live-data verify).
 * Meaning Layer #6 — sibling of tools/preview-trust-scores.js.
 *
 * Uses ADC (gcloud application-default login) — no service-account key file needed.
 * NEVER writes: mirrors runTrustScoreSweep's kindness join — reads the kind-tagged
 * pointsLedger, indexes events by `${building}_${roomId}` (+ tenantId fallback), then
 * for each ACTIVE roster tenant joins by room key first / canonical tenantId fallback
 * and runs the REAL computeKindness (functions/_kindness.js). Prints what each tenant's
 * trustScores.kindness WOULD be + the raw counts (the §7-J hand-count). The actual write
 * happens ONLY via the deployed CF (05:40 sweep / admin recompute) — never here (§7-I).
 *
 * Output: scores + counts only (tenantId truncated; no names) — PII-lean.
 * Run: NODE_PATH=functions/node_modules node tools/preview-kindness-scores.js
 */
'use strict';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'the-green-haven' });
const fs = admin.firestore();

const { computeKindness, KINDNESS_SOURCES, KINDNESS_CONSTANTS } = require('../functions/_kindness');

async function getBuildings() {
  try {
    const snap = await fs.collection('buildings').get();
    const ids = snap.docs.map((d) => d.id).filter(Boolean);
    if (ids.length) return ids;
  } catch (_) { /* fall through */ }
  return ['rooms', 'nest'];
}

async function main() {
  // Index kindness events exactly as the sweep does: room key first, tenantId fallback.
  const byRoomKey = new Map();   // `${building}_${roomId}` → [events]
  const byTenantId = new Map();  // tenantId → [events]
  let totalRows = 0;
  const snap = await fs.collection('pointsLedger').where('source', 'in', [...KINDNESS_SOURCES]).get();
  snap.forEach((d) => {
    const e = d.data() || {};
    const ev = { source: e.source, points: e.points };
    if (e.building && e.roomId != null && e.roomId !== '') {
      const rk = `${e.building}_${String(e.roomId)}`;
      if (!byRoomKey.has(rk)) byRoomKey.set(rk, []);
      byRoomKey.get(rk).push(ev); totalRows++;
    } else if (e.tenantId) {
      const tid = String(e.tenantId);
      if (!byTenantId.has(tid)) byTenantId.set(tid, []);
      byTenantId.get(tid).push(ev); totalRows++;
    }
  });

  console.log(`\nKINDNESS_TARGET_POINTS=${KINDNESS_CONSTANTS.KINDNESS_TARGET_POINTS} · KINDNESS_MIN_EVENTS=${KINDNESS_CONSTANTS.KINDNESS_MIN_EVENTS}`);
  console.log(`kind-tagged ledger rows: ${totalRows} · roomKeys=${byRoomKey.size} tenantIdKeys=${byTenantId.size}\n`);

  const rows = [];
  let scored = 0, vacant = 0;
  for (const building of await getBuildings()) {
    let tSnap;
    try { tSnap = await fs.collection('tenants').doc(building).collection('list').get(); }
    catch (e) { console.warn(`tenants/${building} read failed:`, e.message); continue; }
    for (const tDoc of tSnap.docs) {
      const roomId = tDoc.id;
      const td = tDoc.data() || {};
      if (!td.tenantId || td.status === 'vacant') { vacant++; continue; }
      const events = [
        ...(byRoomKey.get(`${building}_${String(roomId)}`) || []),
        ...(byTenantId.get(String(td.tenantId)) || []),
      ];
      const r = computeKindness({ events });
      const f = r.factors;
      scored++;
      rows.push({
        loc: `${building}/${roomId}`, tid: String(td.tenantId).slice(0, 18),
        kind: r.kindness, prov: r.provisional ? 'Y' : '·',
        tot: `${f.totalEvents}ev/${f.totalPoints}p`,
        brk: `q${f.questCount} f${f.foodShareCount} h${f.helpCompletedCount}`,
      });
    }
  }
  rows.sort((a, b) => b.kind - a.kind);
  console.log(`active roster tenants scored: ${scored} · skipped vacant: ${vacant}\n`);
  console.log(' kind prov  TOTAL        breakdown    loc / tenantId');
  console.log(' ───────────────────────────────────────────────────────────────');
  for (const r of rows) {
    console.log(` ${String(r.kind).padStart(3)}   ${r.prov}   ${r.tot.padEnd(11)}  ${r.brk.padEnd(11)}  ${r.loc} ${r.tid}`);
  }
  if (!scored) console.log('  (no active roster tenants)');
  console.log('\n(READ-ONLY — mirrors the sweep join; no trustScores/* written. The deployed CF writes the real docs.)\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error('preview failed:', e && e.message ? e.message : e); process.exit(1); });
