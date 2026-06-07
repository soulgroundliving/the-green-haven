/**
 * READ-ONLY preview of Trust Reputation scores against LIVE prod data (§7-J live-data verify).
 *
 * Uses ADC (gcloud application-default login) — no service-account key file needed.
 * NEVER writes: it gathers the same sources as computeTrustScoresScheduled and runs the
 * REAL computeReputation (functions/_reputation.js), printing what each active tenant's
 * score WOULD be. The actual trustScores/* write happens ONLY via the deployed CF
 * (scheduled 05:40 BKK, or the admin recomputeTrustScores callable) — never from here (§7-I).
 *
 * Output is scores + factor COUNTS only (no names / amounts / complaint text) to keep PII out.
 *
 * Run: node tools/preview-trust-scores.js
 */
'use strict';

const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'the-green-haven',
  databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const rtdb = admin.database();
const fs = admin.firestore();

const { computeReputation, REPUTATION_CONSTANTS } = require('../functions/_reputation');
const { MONTH_MS, COMPLAINT_CLEAN_MAX_MONTHS } = REPUTATION_CONSTANTS;

async function getBuildings() {
  try {
    const snap = await fs.collection('buildings').get();
    const ids = snap.docs.map((d) => d.id).filter(Boolean);
    if (ids.length) return ids;
  } catch (_) { /* fall through */ }
  return ['rooms', 'nest'];
}

async function main() {
  const now = Date.now();
  const buildings = await getBuildings();

  // complaints (bounded, same as the sweep)
  const complaintsByRoom = new Map();
  const cutoffISO = new Date(now - (COMPLAINT_CLEAN_MAX_MONTHS + 1) * MONTH_MS).toISOString();
  try {
    const cSnap = await fs.collection('complaints').where('createdAt', '>=', cutoffISO).get();
    cSnap.forEach((d) => {
      const c = d.data() || {};
      if (!c.building || c.room == null) return;
      const k = `${c.building}_${c.room}`;
      if (!complaintsByRoom.has(k)) complaintsByRoom.set(k, []);
      complaintsByRoom.get(k).push({ createdAt: c.createdAt });
    });
  } catch (e) { console.warn('complaints read failed:', e.message); }

  const rows = [];
  let scored = 0, vacant = 0, provisional = 0;

  for (const building of buildings) {
    let billsByRoom = {};
    try { billsByRoom = (await rtdb.ref(`bills/${building}`).once('value')).val() || {}; }
    catch (e) { console.warn(`bills/${building} read failed:`, e.message); }

    const moveInByRoom = new Map();
    try {
      const lSnap = await fs.collection(`leases/${building}/list`).where('status', '==', 'active').get();
      lSnap.forEach((d) => { const L = d.data() || {}; if (L.roomId != null) moveInByRoom.set(String(L.roomId), L.moveInDate || L.startDate || L.contractStart || null); });
    } catch (e) { console.warn(`leases/${building} read failed:`, e.message); }

    let tSnap;
    try { tSnap = await fs.collection('tenants').doc(building).collection('list').get(); }
    catch (e) { console.warn(`tenants/${building} read failed:`, e.message); continue; }

    for (const tDoc of tSnap.docs) {
      const roomId = tDoc.id;
      const td = tDoc.data() || {};
      if (!td.tenantId || td.status === 'vacant') { vacant++; continue; }
      const node = billsByRoom[roomId];
      const bills = node && typeof node === 'object' ? Object.values(node) : [];
      const moveInDate = moveInByRoom.get(String(roomId)) || td.moveInDate || td.leaseStart || null;
      const complaints = complaintsByRoom.get(`${building}_${roomId}`) || [];
      const r = computeReputation({ bills, moveInDate, complaints, now });
      scored++; if (r.provisional) provisional++;
      const f = r.factors;
      rows.push({
        loc: `${building}/${roomId}`,
        tid: String(td.tenantId).slice(0, 14),
        rep: r.reputation,
        prov: r.provisional ? 'Y' : '·',
        pay: f.paymentScore == null ? '   —' : String(f.paymentScore).padStart(4),
        bills: `${f.onTimeBills}✓/${f.lateBills}✗`,
        tenure: `${f.tenureMonths}mo`,
        cf: `${f.complaintFreeMonths}mo`,
        hasMoveIn: moveInDate ? '' : ' (no moveInDate!)',
      });
    }
  }

  rows.sort((a, b) => b.rep - a.rep);
  console.log(`\nbuildings: ${buildings.join(', ')}`);
  console.log(`active scored: ${scored} · provisional: ${provisional} · skipped vacant: ${vacant}\n`);
  console.log('  rep prov  pay  bills      tenure   cf       loc / tenantId');
  console.log('  ─────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    console.log(`  ${String(r.rep).padStart(3)}  ${r.prov}   ${r.pay}  ${r.bills.padEnd(9)}  ${r.tenure.padEnd(7)} ${r.cf.padEnd(7)} ${r.loc} ${r.tid}${r.hasMoveIn}`);
  }
  console.log('\n(READ-ONLY preview — no trustScores/* written. The deployed CF writes the real docs.)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('preview failed:', e); process.exit(1); });
