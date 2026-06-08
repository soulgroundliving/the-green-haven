#!/usr/bin/env node
/**
 * tools/backfill-synth-bills.js — one-shot reconcile of synth-only months into
 * canonical RTDB bills (Option C companion, 2026-06-08).
 *
 * WHY: before Option C, a meter upload created meter_data + an INV- number + a
 * LINE message but NO RTDB bill (generateBillsOnMeterUpdate frozen, §7-NN). The
 * tenant app synthesized a `SYNTH-…` bill client-side; the admin dashboard (which
 * reads RTDB `bills/` only) never saw the month. Result: months with meter_data
 * but no `bills/{b}/{r}/{billId}` doc. This backfills the missing canonical bills
 * so admin + tenant read ONE shared record (the synth twin then auto-dedups by
 * year+month — BillStore.dedupSynthetic).
 *
 * For each meter_data doc with no matching RTDB bill:
 *   - compute the bill (same _billFlex.computeBill the CF uses → no drift)
 *   - status = 'paid' if a payments/{b}/{r} record exists for that month
 *     (e.g. June ห้อง13: 4 payment records, ฿2,020 — was paid but never billed),
 *     else 'pending'
 *   - §7-BBB move-in boundary: never bill a month before the tenant moved in
 *   - write via the SAME idempotent writer the CF uses (never overwrites a paid
 *     or manually-generated bill)
 *
 * SAFETY (§7-I — production money path):
 *   - DEFAULT = dry-run. Prints every bill it WOULD create. NO writes.
 *   - `--apply` performs the writes.
 *   - `--building rooms|nest` scopes to one building (default: both).
 *   - `--room 13` scopes to one room (use with --building to fix a single room).
 *   - `--month 6` scopes to one BE month (e.g. apply only June, leave others).
 *   - Idempotent: an existing bill for the month (ANY id) is left untouched.
 *
 * Auth: ADC (same as preview-trust-scores.js). Run `gcloud auth application-default
 *   login` once if needed. Reads functions/node_modules/firebase-admin so it shares
 *   the exact firebase-admin instance the shared helpers use.
 *
 * Usage:
 *   node tools/backfill-synth-bills.js                              # dry-run, all
 *   node tools/backfill-synth-bills.js --building rooms --room 13   # preview ห้อง13
 *   node tools/backfill-synth-bills.js --building rooms --room 13 --month 6 --apply  # only มิ.ย.
 *   node tools/backfill-synth-bills.js --building rooms --room 13 --apply            # all of ห้อง13
 *   node tools/backfill-synth-bills.js --apply                     # backfill all
 */
'use strict';

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'the-green-haven',
    databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const fsdb = admin.firestore();
const rtdb = admin.database();

const { computeBill, DEFAULTS } = require('../functions/_billFlex');
const {
  buildCanonicalBill, writeCanonicalBillIdempotent, findBillForMonth,
  moveInBoundaryYM, isBeforeMoveIn, toBE, billIdFor, BKK_OFFSET_MS,
} = require('../functions/_billWrite');

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { apply: argv.includes('--apply'), buildings: ['rooms', 'nest'], room: null, month: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--building') out.buildings = [argv[++i]];
    else if (argv[i] === '--room') out.room = String(argv[++i]);
    else if (argv[i] === '--month') out.month = Number(argv[++i]);  // 1-12, scope to a single BE month
  }
  return out;
}

// rooms_config/{building}/{roomId} → cfg with rentPrice; else per-building DEFAULTS.
function cfgFor(roomsConfig, building, roomId) {
  const c = roomsConfig && roomsConfig[roomId];
  if (c && c.rentPrice) return c;
  return DEFAULTS[building] || DEFAULTS.rooms;
}

// A payments/{b}/{r} push record matching this BE-year + month → the month was paid.
function paidRecordFor(paymentsForRoom, beYear, month) {
  for (const k of Object.keys(paymentsForRoom || {})) {
    const p = paymentsForRoom[k];
    if (!p) continue;
    if (Number(p.month) === month && toBE(p.year) === beYear) return p;
  }
  return null;
}

function thMonth(m) {
  return ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m] || m;
}

async function main() {
  const args = parseArgs();
  const dry = !args.apply;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  backfill-synth-bills — ${dry ? 'DRY RUN' : '⚠️  APPLY MODE'}`);
  console.log(`  Buildings: ${args.buildings.join(', ')}${args.room ? `   Room: ${args.room}` : ''}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const nb = new Date(Date.now() + BKK_OFFSET_MS);
  const nowCeYM = nb.getUTCFullYear() * 100 + (nb.getUTCMonth() + 1);

  const tot = { meter: 0, exists: 0, skipBoundary: 0, rentZero: 0, create: 0, paid: 0, applied: 0, failed: 0 };

  for (const building of args.buildings) {
    console.log(`── Building: ${building} ──`);

    const roomsConfig = (await rtdb.ref(`rooms_config/${building}`).once('value')).val() || {};
    const bills       = (await rtdb.ref(`bills/${building}`).once('value')).val() || {};
    const payments    = (await rtdb.ref(`payments/${building}`).once('value')).val() || {};

    const tenants = {};
    try {
      const tSnap = await fsdb.collection('tenants').doc(building).collection('list').get();
      tSnap.forEach((d) => { tenants[d.id] = d.data() || {}; });
    } catch (e) { console.warn(`  tenants/${building} read failed: ${e.message}`); }

    let mSnap;
    try {
      mSnap = await fsdb.collection('meter_data').where('building', '==', building).get();
    } catch (e) { console.error(`  meter_data read failed for ${building}: ${e.message}`); continue; }

    // Collect candidate rows (one bill per room-month). Sort for a readable preview.
    const rows = [];
    mSnap.forEach((d) => {
      const m = d.data() || {};
      const roomId = m.roomId != null ? String(m.roomId) : null;
      if (!roomId) return;
      if (args.room && roomId !== args.room) return;
      rows.push({ docId: d.id, roomId, m });
    });
    rows.sort((a, b) => (a.roomId.localeCompare(b.roomId, undefined, { numeric: true })) ||
                        (toBE(a.m.year) * 100 + Number(a.m.month)) - (toBE(b.m.year) * 100 + Number(b.m.month)));

    for (const { roomId, m } of rows) {
      tot.meter++;
      const cfg = cfgFor(roomsConfig, building, roomId);
      const bill = computeBill({
        building, roomId, year: m.year, month: m.month,
        eOld: m.eOld, eNew: m.eNew, wOld: m.wOld, wNew: m.wNew,
      }, cfg);
      if (!bill) { tot.rentZero++; continue; }  // vacant / rent 0

      const beYear = toBE(bill.year);
      const month  = Number(bill.month);
      if (args.month && month !== args.month) continue;  // --month scope
      const billId = billIdFor(beYear, month, roomId);
      const billCeYM = (beYear - 543) * 100 + month;

      // Dedup by room+MONTH (any id) — a legacy bill may use a suffixed id
      // (TGH-256904-13-4725) + string year, which an exact-id check would miss.
      const existing = findBillForMonth(bills[roomId], beYear, month);
      if (existing) { tot.exists++; continue; }  // already has a canonical bill for this month

      const boundaryYM = moveInBoundaryYM(tenants[roomId]);
      if (isBeforeMoveIn(billCeYM, boundaryYM, nowCeYM)) {
        tot.skipBoundary++;
        console.log(`  ⤵ ${building}/${roomId} ${thMonth(month)}/${beYear} — skip (before move-in ${boundaryYM})`);
        continue;
      }

      const paid = paidRecordFor(payments[roomId], beYear, month);
      const status = paid ? 'paid' : 'pending';
      const billObject = buildCanonicalBill(bill, {
        status, generatedBy: 'backfill_synth', source: 'tools:backfill-synth-bills',
      });
      if (paid) {
        billObject.paidAt = paid.paidAt ? new Date(paid.paidAt).getTime() : Date.now();
        billObject.paidVia = 'backfill_from_payments';
        billObject.paidRef = paid.transRef || paid.transactionId || paid.paidRef || '';
        billObject.slipVerified = !!paid.slipOkVerified;
      }

      tot.create++;
      if (paid) tot.paid++;
      console.log(`  ${paid ? '✓paid ' : '•unpaid'} ${building}/${roomId} ${thMonth(month)}/${beYear} ฿${billObject.totalCharge}  →  ${billId}${paid ? `  (payment ฿${paid.amount || '?'})` : ''}`);

      if (!dry) {
        try {
          const r = await writeCanonicalBillIdempotent(rtdb, { building, roomId, billObject });
          if (r.action === 'created') tot.applied++;
          else console.log(`      ↳ ${r.action} (not created)`);
        } catch (e) {
          tot.failed++;
          console.error(`      ✗ write failed: ${e.message}`);
        }
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  meter_data scanned : ${tot.meter}`);
  console.log(`  already canonical  : ${tot.exists}`);
  console.log(`  rent 0 / vacant    : ${tot.rentZero}`);
  console.log(`  skipped (boundary) : ${tot.skipBoundary}`);
  console.log(`  to create          : ${tot.create}  (paid ${tot.paid} / pending ${tot.create - tot.paid})`);
  if (!dry) console.log(`  WRITTEN            : ${tot.applied}${tot.failed ? `   FAILED ${tot.failed}` : ''}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (dry) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to create these bills.');
  }
  if (tot.failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
