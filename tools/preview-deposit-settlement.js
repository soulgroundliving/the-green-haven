/**
 * preview-deposit-settlement.js — READ-ONLY dry-run for the #253 move-out
 * deposit settlement (deduct the final/unpaid bill from the held deposit).
 *
 * WHY: the #253 "บิลค้างชำระ → หักจากมัดจำ" flow is code-complete but its live
 * verification was deferred repeatedly because (a) confirming the return WRITES
 * to production (flips bills to status:'paid', §7-I) and (b) no room obviously
 * had BOTH a holding deposit AND an outstanding bill to exercise it. This tool
 * answers both safely: it reads the real data and prints exactly what the
 * settlement modal would compute — WITHOUT writing anything.
 *
 * It mirrors the in-app selection/normalisation EXACTLY:
 *   - bill path        bills/{_bld(building)}/{room}/{billId}   (RTDB)
 *   - arrears predicate _isArrears                              (shared/dashboard-aging.js)
 *   - year handling     toBE — §7-E 2-digit BE / CE / 4-digit BE
 *   - net refund        DepositCalc.netRefund (REUSED, not re-implemented)
 *
 * Uses the Firebase CLI configstore OAuth token (same as
 * check-firestore-integrity-rest.js) — no service-account key, no gcloud.
 *
 * NEVER MUTATES. Every network call is a GET / runQuery read.
 *
 * Usage:
 *   node tools/preview-deposit-settlement.js                       # scan ALL holding deposits
 *   node tools/preview-deposit-settlement.js --scan                # (explicit) same
 *   node tools/preview-deposit-settlement.js --building rooms --room 15
 *   npm run preview:deposit-settlement -- --building rooms --room 15
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const DepositCalc = require('../shared/deposit-calc.js'); // dual-export → { depositPaid, netRefund, deductionsTotal, ... }

const PROJECT_ID = 'the-green-haven';
const RTDB_URL = 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

// ── Pure core (exported for parity tests — NO I/O) ──────────────────────────

// Building → RTDB bills key. MUST agree with BillStore._bld (shared/billing-system.js).
function bld(b) {
  if (b === 'old' || b === 'rooms' || b === 'RentRoom') return 'rooms';
  if (b === 'new' || b === 'nest') return 'nest';
  return b;
}

// §7-E — bills carry mixed 2-digit BE / CE / 4-digit BE. Mirrors dashboard-aging.js toBE.
function toBE(y) {
  const n = Number(y) || 0;
  if (n < 100) return 2500 + n; // 2-digit BE (69 → 2569)
  if (n < 2400) return n + 543; // CE (2026 → 2569)
  return n; // already 4-digit BE
}

// Arrears predicate — mirrors _isArrears (shared/dashboard-aging.js): not
// paid/refunded/void, and not a zero/ghost stub.
function isArrears(status, total, hasCharges) {
  const st = String(status || '').toLowerCase();
  if (st === 'paid' || st === 'refunded' || st === 'void') return false;
  if ((Number(total) || 0) <= 0 && !hasCharges) return false;
  return true;
}

// raw RTDB bill → the fields the modal displays. Mirrors _normBill total fallback.
function normalizeBill(key, raw) {
  const total = Number(
    raw.totalCharge != null ? raw.totalCharge
      : (raw.totalAmount != null ? raw.totalAmount : raw.total)
  ) || 0;
  return {
    key,
    billId: raw.billId || raw.id || key,
    month: Number(raw.month) || 0,
    beYear: toBE(raw.year),
    total,
    status: raw.status || '',
    hasCharges: !!raw.charges,
  };
}

// rawBills = the RTDB subtree at bills/{bld}/{room} ({key: rawBill} | null).
// Returns the same shape as outstandingBillsForRoom(): { bills[], total }.
function outstandingFromBills(rawBills) {
  const bills = [];
  let total = 0;
  for (const [key, raw] of Object.entries(rawBills || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const n = normalizeBill(key, raw);
    if (!isArrears(n.status, n.total, n.hasCharges)) continue;
    bills.push(n);
    total += n.total;
  }
  return { bills, total: Math.round(total * 100) / 100 };
}

// Full settlement preview for one room — exactly what showReturnDepositModal +
// _saveDepositReturn would compute. deductions default to the deposit doc's
// current deductions[] (usually empty pre-settlement; the admin adds damage
// items live in the modal, which this dry-run can't know).
function computeSettlementPreview(deposit, rawBills) {
  const held = DepositCalc.depositPaid(deposit || {});
  const { bills, total: finalBillTotal } = outstandingFromBills(rawBills);
  const deductions = Array.isArray(deposit && deposit.deductions) ? deposit.deductions : [];
  const net = DepositCalc.netRefund(held, finalBillTotal, deductions);
  return {
    held,
    status: (deposit && deposit.status) || '',
    outstandingBills: bills,
    finalBillTotal,
    deductions,
    deductionTotal: DepositCalc.deductionsTotal(deductions),
    netRefund: net,
    tenantOwes: net < 0,
  };
}

// ── REST layer (thin, I/O — untested, like the sibling integrity probe) ─────

function readToken() {
  let raw;
  try { raw = fs.readFileSync(CONFIGSTORE, 'utf8'); }
  catch { throw new Error('No Firebase CLI session found (~/.config/configstore/firebase-tools.json).\n  → Run `firebase login` first, then re-run this preflight.'); }
  const tokens = JSON.parse(raw).tokens;
  if (!tokens || !tokens.access_token) throw new Error('No access_token in the firebase-tools configstore.\n  → Run `firebase login` first, then re-run this preflight.');
  // Fail FAST on an expired token: a doomed REST call would return a raw 401, and
  // calling process.exit() mid-fetch trips a Windows libuv assertion. Bailing here
  // (before any network handle exists) gives a clear message and a clean exit.
  if (Date.now() >= (tokens.expires_at || 0)) {
    throw new Error('Firebase CLI access token is EXPIRED.\n  → Refresh it by running any firebase command (e.g. `firebase projects:list`),\n    then re-run `npm run preview:deposit-settlement`.');
  }
  return tokens.access_token;
}

// Firestore REST field-map → plain value (handles the shapes deposit docs use).
function fsValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('mapValue' in field) {
    const out = {};
    const f = field.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fsValue(f[k]);
    return out;
  }
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsValue);
  return undefined;
}
function flat(doc) {
  const out = {};
  if (doc && doc.fields) for (const k of Object.keys(doc.fields)) out[k] = fsValue(doc.fields[k]);
  return out;
}

async function getDepositDoc(token, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/deposits/${encodeURIComponent(docId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore HTTP ${res.status} on deposits/${docId}: ${(await res.text()).slice(0, 200)}`);
  return flat(await res.json());
}

async function listDepositDocs(token) {
  let pageToken = null;
  const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/deposits?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore HTTP ${res.status} listing deposits: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return all.map((d) => ({ id: d.name.split('/').pop(), data: flat(d) }));
}

// Full (non-shallow) RTDB read of bills/{bld}/{room} → { billId: rawBill } | null.
async function getRoomBills(token, building, room) {
  const dbPath = `bills/${bld(building)}/${room}`;
  const url = `${RTDB_URL}/${dbPath}.json?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RTDB HTTP ${res.status} on ${dbPath}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── CLI presentation ────────────────────────────────────────────────────────

const fmt = (n) => '฿' + (Number(n) || 0).toLocaleString('en-US');

function printRoomPreview(building, room, dep, preview) {
  console.log(`\n  ── ${building} / ห้อง ${room}  (deposits/${building}_${room}) ──`);
  console.log(`     สถานะมัดจำ:   ${preview.status || '(ไม่มีเอกสาร)'}`);
  console.log(`     มัดจำที่ถือ:   ${fmt(preview.held)}`);
  if (!preview.outstandingBills.length) {
    console.log(`     บิลค้างชำระ:   — ไม่มี (ไม่มีอะไรให้หักจากมัดจำ)`);
  } else {
    console.log(`     บิลค้างชำระ:`);
    for (const b of preview.outstandingBills) {
      console.log(`        • บิลเดือน ${b.month}/${b.beYear}   ${fmt(b.total)}   [${b.key}]`);
    }
    console.log(`        รวมบิลค้าง:  ${fmt(preview.finalBillTotal)}`);
  }
  if (preview.deductionTotal > 0) {
    console.log(`     หักเสียหาย:    ${fmt(preview.deductionTotal)} (${preview.deductions.length} รายการในเอกสาร)`);
  } else {
    console.log(`     หักเสียหาย:    ${fmt(0)}  (admin กรอกรายการหักเสียหายตอนกดคืนมัดจำ — dry-run ไม่ทราบ)`);
  }
  const net = preview.netRefund;
  if (preview.tenantOwes) {
    console.log(`     => คืนสุทธิ:    ${fmt(net)}  ⚠️ ติดลบ → ผู้เช่าค้างเพิ่ม ${fmt(-net)}`);
  } else {
    console.log(`     => คืนสุทธิ:    ${fmt(net)}   (มัดจำ ${fmt(preview.held)} − บิลค้าง ${fmt(preview.finalBillTotal)} − หักเสียหาย ${fmt(preview.deductionTotal)})`);
  }
}

function parseArgs(argv) {
  const out = { scan: false, building: null, room: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan') out.scan = true;
    else if (a === '--building') out.building = argv[++i];
    else if (a === '--room') out.room = argv[++i];
  }
  return out;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  #253 DEPOSIT SETTLEMENT — READ-ONLY DRY-RUN (no writes)');
  console.log('  Shows what the move-out modal would deduct/refund, on real data.');
  console.log('════════════════════════════════════════════════════════════════');

  const args = parseArgs(process.argv.slice(2));
  const token = readToken();

  if (args.building && args.room) {
    const dep = await getDepositDoc(token, `${args.building}_${args.room}`);
    const rawBills = await getRoomBills(token, args.building, args.room);
    const preview = computeSettlementPreview(dep || {}, rawBills);
    printRoomPreview(args.building, args.room, dep, preview);
    console.log('\n  (read-only — nothing was written)\n');
    return;
  }

  // Scan mode: every holding deposit → flag the ones that can exercise #253 now.
  console.log('\n  Scanning all holding deposits for outstanding bills…');
  const deposits = await listDepositDocs(token);
  const holding = deposits.filter((d) => (d.data.status || 'holding') === 'holding');
  console.log(`  ${deposits.length} deposit doc(s); ${holding.length} holding.`);

  const testable = [];
  for (const d of holding) {
    const building = d.data.building || d.id.split('_')[0];
    const room = d.data.roomId || d.id.split('_').slice(1).join('_');
    let rawBills = null;
    try { rawBills = await getRoomBills(token, building, room); }
    catch (e) { console.log(`     (skip ${d.id}: ${e.message})`); continue; }
    const preview = computeSettlementPreview(d.data, rawBills);
    if (preview.outstandingBills.length) {
      testable.push({ building, room, dep: d.data, preview });
    }
  }

  if (!testable.length) {
    console.log('\n  ✅ No holding room currently has an outstanding bill.');
    console.log('     → #253 cannot be exercised live right now (this matches the handoff note).');
    console.log('     → Wait for a real move-out whose final bill is still unpaid, OR seed a');
    console.log('       test scenario (a holding deposit + one pending bill on a rooms-room).');
  } else {
    console.log(`\n  ⭐ ${testable.length} room(s) can exercise #253 right now:`);
    for (const t of testable) printRoomPreview(t.building, t.room, t.dep, t.preview);
  }
  console.log('\n  (read-only — nothing was written)\n');
}

// Export the pure core for parity tests; run the CLI only when invoked directly.
module.exports = { bld, toBE, isArrears, normalizeBill, outstandingFromBills, computeSettlementPreview };

if (require.main === module) {
  // Set exitCode (not process.exit()) so the event loop drains naturally — an
  // abrupt process.exit() while an undici fetch handle is mid-close trips a
  // Windows libuv assertion (!(handle->flags & UV_HANDLE_CLOSING), async.c:76).
  main().catch((e) => { console.error('\nPREFLIGHT STOPPED:', e.message, '\n'); process.exitCode = 1; });
}
