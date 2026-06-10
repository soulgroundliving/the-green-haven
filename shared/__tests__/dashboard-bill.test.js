/**
 * Unit tests for the pure-logic helpers in shared/dashboard-bill.js.
 *
 * dashboard-bill.js is mostly DOM/form-coupled rendering, but its three form
 * validators encode real, bug-prone rules (year range, meter-reset detection,
 * required fields, length caps) and `getBuildingInfo` is a pure config lookup.
 * Billing is the most bug-prone surface in the app (§7-D/E), so these rules are
 * worth locking. The validators read inputs via document.getElementById; the
 * test drives them with a flat id→value form stub rather than a real DOM.
 *
 * Strategy: load dashboard-bill.js in a vm sandbox (load-time side effects are
 * two document.addEventListener registrations + the PaymentStore IIFE, none of
 * which touch the network with stubbed globals). Validators + getBuildingInfo
 * are top-level function declarations → reachable as context globals.
 *
 * Run: node --test shared/__tests__/dashboard-bill.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Flat form stub: getElementById returns a fake input for ANY id so validators
// never null-deref. `fields[id]` is either a raw value or { value, classes }.
function makeForm(fields = {}) {
  const cache = new Map();
  const get = (id) => {
    if (!cache.has(id)) {
      const spec = fields[id];
      const isObj = spec && typeof spec === 'object' && !Array.isArray(spec);
      const value = isObj ? (spec.value ?? '') : (spec ?? '');
      const classes = new Set((isObj && spec.classes) || []);
      cache.set(id, {
        value: String(value),
        classList: { contains: (c) => classes.has(c), add() {}, remove() {}, toggle() {} },
      });
    }
    return cache.get(id);
  };
  return {
    getElementById: get,
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete',
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

function loadBill() {
  const window = {};
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  window.localStorage = localStorage;
  window.sessionStorage = sessionStorage;
  const context = {
    window,
    localStorage,
    sessionStorage,
    document: makeForm({}),
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    parseInt, parseFloat, isFinite, isNaN,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    navigator: { userAgent: 'test' },
  };
  window.addEventListener = () => {};
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-bill.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'dashboard-bill.js' });
  return context;
}

// A monthly bill form that passes every rule; spread + override per test.
const VALID_BILL = { 'f-room': '15', 'f-rent': '5000', 'f-year': '2569' };

// ────────────────────────────────────────────────────────────────────────────
// validateBillForm
// ────────────────────────────────────────────────────────────────────────────

describe('dashboard-bill.js — validateBillForm', () => {
  const sb = loadBill();
  const run = (fields) => {
    sb.document = makeForm(fields);
    return sb.validateBillForm();
  };

  test('validateBillForm is loaded as a global function', () => {
    assert.equal(typeof sb.validateBillForm, 'function');
  });

  test('a complete monthly form is valid', () => {
    const r = run({ ...VALID_BILL });
    assert.equal(r.isValid, true);
    assert.equal(r.errors.length, 0);
  });

  test('flags a missing room', () => {
    const r = run({ ...VALID_BILL, 'f-room': '' });
    assert.equal(r.isValid, false);
    assert.ok(r.errors.some((e) => /เลือกห้อง/.test(e)));
  });

  test('flags a room id longer than 20 chars', () => {
    const r = run({ ...VALID_BILL, 'f-room': '123456789012345678901' });
    assert.ok(r.errors.some((e) => /ไม่เกิน 20/.test(e)));
  });

  test('flags non-positive rent on the monthly path', () => {
    const r = run({ ...VALID_BILL, 'f-rent': '0' });
    assert.ok(r.errors.some((e) => /ค่าเช่า.*มากกว่า 0/.test(e)));
  });

  test('flags a year outside 2560-2590', () => {
    assert.ok(run({ ...VALID_BILL, 'f-year': '2599' }).errors.some((e) => /ระหว่าง 2560-2590/.test(e)));
    assert.ok(run({ ...VALID_BILL, 'f-year': '2000' }).errors.some((e) => /ระหว่าง 2560-2590/.test(e)));
  });

  test('warns when the latest electric reading is below the previous (meter reset)', () => {
    const r = run({ ...VALID_BILL, 'f-elec-new': '10', 'f-elec-old': '50' });
    assert.ok(r.errors.some((e) => /มิเตอร์ไฟ.*<.*เดิม/.test(e)));
  });

  test('treats "-" meter placeholders as 0 (no spurious error)', () => {
    const r = run({ ...VALID_BILL, 'f-elec-new': '-', 'f-elec-old': '-', 'f-water-new': '-', 'f-water-old': '-' });
    assert.equal(r.isValid, true);
  });

  test('on the daily path, flags zero nights and zero daily rate', () => {
    const r = run({
      ...VALID_BILL,
      'f-rent-type': 'daily',
      dailySection: { classes: ['show'] },
      'f-nights': '0',
      'f-daily-rate': '0',
    });
    assert.ok(r.errors.some((e) => /จำนวนคืน.*มากกว่า 0/.test(e)));
    assert.ok(r.errors.some((e) => /รายวัน.*มากกว่า 0/.test(e)));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// validateMaintenanceForm / validateTenantForm
// ────────────────────────────────────────────────────────────────────────────

describe('dashboard-bill.js — validateMaintenanceForm', () => {
  const sb = loadBill();
  const run = (fields) => {
    sb.document = makeForm(fields);
    return sb.validateMaintenanceForm();
  };

  test('a complete maintenance form (past date) is valid', () => {
    const r = run({ 'mx-room': '15', 'mx-date': '2020-01-01', 'mx-desc': 'ไฟห้องน้ำเสีย' });
    assert.equal(r.isValid, true);
  });

  test('flags a missing room', () => {
    assert.ok(run({ 'mx-date': '2020-01-01', 'mx-desc': 'ไฟเสียมาก' }).errors.some((e) => /กรอกเลขห้อง/.test(e)));
  });

  test('rejects a future report date', () => {
    const r = run({ 'mx-room': '15', 'mx-date': '2099-01-01', 'mx-desc': 'ไฟเสียมาก' });
    assert.ok(r.errors.some((e) => /อนาคต/.test(e)));
  });

  test('requires a description of at least 5 chars', () => {
    assert.ok(run({ 'mx-room': '15', 'mx-date': '2020-01-01', 'mx-desc': 'สั้น' }).errors.some((e) => /อย่างน้อย 5/.test(e)));
  });
});

describe('dashboard-bill.js — validateTenantForm', () => {
  const sb = loadBill();
  const run = (fields) => {
    sb.document = makeForm(fields);
    return sb.validateTenantForm();
  };

  test('a complete tenant form is valid', () => {
    const r = run({ 'tp-room': '15', 'tp-description': 'น้ำรั่วในห้องน้ำ' });
    assert.equal(r.isValid, true);
  });

  test('flags a missing room and an empty description', () => {
    const r = run({ 'tp-room': '', 'tp-description': '' });
    assert.equal(r.isValid, false);
    assert.ok(r.errors.some((e) => /เลขห้อง/.test(e)));
    assert.ok(r.errors.some((e) => /อธิบายปัญหา/.test(e)));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getBuildingInfo — pure config lookup
// ────────────────────────────────────────────────────────────────────────────

describe('dashboard-bill.js — getBuildingInfo', () => {
  const sb = loadBill();
  sb.window.CONFIG = { getBuildingConfig: (id) => id };
  sb.window.ROOMS_OLD = [{ room: '15' }];
  sb.window.NEST_ROOMS = [{ room: '101' }];

  test('resolves rooms metadata + registry displayName', () => {
    sb.window.BuildingRegistry = { getById: () => ({ displayName: 'ร้านแถว' }) };
    const info = sb.getBuildingInfo('rooms');
    assert.equal(info.firebaseBuilding, 'rooms');
    assert.equal(info.metadataArray.length, 1);
    assert.equal(info.displayName, 'ร้านแถว');
  });

  test('resolves nest metadata from NEST_ROOMS', () => {
    sb.window.BuildingRegistry = { getById: () => ({ displayName: 'Nest' }) };
    const info = sb.getBuildingInfo('nest');
    assert.equal(info.firebaseBuilding, 'nest');
    assert.equal(info.metadataArray[0].room, '101');
  });

  test('falls back to a default displayName when the registry has none', () => {
    sb.window.BuildingRegistry = { getById: () => null };
    const info = sb.getBuildingInfo('rooms');
    assert.ok(info.displayName && info.displayName.length > 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PaymentStore — BillStore merge (§7-T reader fix: ออกบิล grid honors RTDB bill paid)
// ────────────────────────────────────────────────────────────────────────────
describe('dashboard-bill.js — PaymentStore BillStore merge', () => {
  function withBillStore(cache) {
    const sb = loadBill();
    sb.window.BillStore = { _cache: cache };
    return sb.window.PaymentStore;
  }
  // The live June ห้อง13 case: RTDB bill paid, NO verifiedSlips doc.
  const JUNE_13_PAID = { rooms: { '13': { 'TGH-256906-13': { status: 'paid', year: 2569, month: 6, totalCharge: 2020, paidAt: 1780857710703 } } } };

  test('listForMonth merges an RTDB-bill-paid room when verifiedSlips has none', () => {
    const ps = withBillStore(JUNE_13_PAID);
    const map = ps.listForMonth(2569, 6, 'rooms');
    assert.equal(map['13']?.status, 'paid');
    assert.equal(map['13']?.amount, 2020);
    assert.equal(map['13']?.fromBill, true);
  });

  test('isPaid honors the RTDB bill status when building is passed', () => {
    const ps = withBillStore(JUNE_13_PAID);
    assert.equal(ps.isPaid('rooms', '13', 2569, 6), true);
    assert.equal(ps.isPaid('rooms', '13', 2569, 5), false); // different month
    assert.equal(ps.isPaid('rooms', '99', 2569, 6), false); // no bill for room
  });

  test('a non-paid (pending) RTDB bill is NOT counted paid', () => {
    const ps = withBillStore({ rooms: { '14': { 'TGH-256906-14': { status: 'pending', year: 2569, month: 6, totalCharge: 1500 } } } });
    assert.equal(ps.listForMonth(2569, 6, 'rooms')['14'], undefined);
    assert.equal(ps.isPaid('rooms', '14', 2569, 6), false);
  });

  test('back-compat: no building arg → no BillStore merge (unchanged behavior)', () => {
    const ps = withBillStore(JUNE_13_PAID);
    assert.equal(ps.listForMonth(2569, 6)['13'], undefined);
  });

  test('normalizes a string/2-digit bill year to BE before matching', () => {
    const ps = withBillStore({ rooms: { '13': { 'TGH-256906-13': { status: 'paid', year: '2569', month: 6, totalCharge: 2020 } } } });
    assert.equal(ps.listForMonth(2569, 6, 'rooms')['13']?.status, 'paid');
  });

  test('no-throw + empty when BillStore is absent', () => {
    const sb = loadBill();   // no window.BillStore set
    // (Object.keys, not deepEqual({}) — the sandbox realm's {} has a different
    //  prototype than this test realm's, which strict deepEqual would reject.)
    assert.equal(Object.keys(sb.window.PaymentStore.listForMonth(2569, 6, 'rooms')).length, 0);
    assert.equal(sb.window.PaymentStore.isPaid('rooms', '13', 2569, 6), false);
  });

  // §7 (2026-06-10): "รีเซ็ตกลับยังไม่จ่าย" left the room showing ✅ because the grid reads
  // verifiedSlips via the PaymentStore cache and reset never cleared it. _remove is the cache
  // drop that the reset (and the subscription 'removed' handler) now call.
  test('_remove drops a room from the verifiedSlips cache (the reset fix)', () => {
    const sb = loadBill();
    const ps = sb.window.PaymentStore;
    ps._ingest(2569, 6, '19', { status: 'paid', amount: 2512 });
    assert.equal(ps.isPaid('rooms', '19', 2569, 6), true);
    assert.equal(ps.listForMonth(2569, 6)['19']?.status, 'paid');
    ps._remove(2569, 6, '19');
    assert.equal(ps.isPaid('rooms', '19', 2569, 6), false);
    assert.equal(ps.listForMonth(2569, 6)['19'], undefined);
  });

  test('_remove normalizes a CE year to the BE cache key', () => {
    const sb = loadBill();
    const ps = sb.window.PaymentStore;
    ps._ingest(2569, 6, '19', { status: 'paid', amount: 2512 });
    ps._remove(2026, 6, '19'); // CE 2026 → BE 2569 via _key
    assert.equal(ps.listForMonth(2569, 6)['19'], undefined);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// calcBill — keeps window.invoiceData in sync after the invoice is sent.
//
// Live bug (2026-06-10): admin pressed "ส่งใบวางบิล" (snapshots window.invoiceData),
// THEN added ค่าปรับ ฿800. The live preview + QR updated to ฿2512, but the snapshot
// stayed ฿1712 — and dashboard-bill-slip-verify.js sends invoiceData.total to verifySlip
// as expectedAmount. SlipOK then rejected a correct ฿2512 slip: "จำนวนเงินไม่ตรงกับยอดบิล
// (สลิป ฿2512 / ต้องการ ฿1712)" — diff = exactly the late fee. calcBill must propagate the
// recomputed total back into the snapshot. invoicePanel is stubbed hidden so the fix's
// doc re-render (buildDocHTML) is skipped — this isolates the invoiceData sync.
// ────────────────────────────────────────────────────────────────────────────
describe('dashboard-bill.js — calcBill syncs window.invoiceData', () => {
  // 19 units × ฿8 = 152, 2 units × ฿20 = 40 → 1500 + 152 + 40 + 20 + lateFee.
  const BASE_FORM = {
    'f-rent': '1500',
    'f-elec-old': '100', 'f-elec-new': '119', 'f-elec-rate': '8',
    'f-water-old': '50', 'f-water-new': '52', 'f-water-rate': '20',
    'f-trash': '20', 'f-other': '0',
    invoicePanel: { classes: ['u-hidden'] }, // skip the doc re-render in the test
  };

  test('a late fee added after "ส่งใบวางบิล" flows into the stale snapshot', () => {
    const sb = loadBill();
    // Snapshot taken at send time, BEFORE the ค่าปรับ was entered.
    sb.window.invoiceData = { total: 1712, lateFee: 0, room: '15', building: 'rooms', now: new Date() };
    sb.document = makeForm({ ...BASE_FORM, 'f-latefee': '800' });
    sb.calcBill();
    assert.equal(sb.window.invoiceData.total, 2512); // 1712 + 800 — what SlipOK now expects
    assert.equal(sb.window.invoiceData.lateFee, 800);
  });

  test('does nothing (no throw) before the invoice is sent', () => {
    const sb = loadBill();
    assert.equal(sb.window.invoiceData, null); // load-time default
    sb.document = makeForm({ ...BASE_FORM, 'f-latefee': '800' });
    sb.calcBill();
    assert.equal(sb.window.invoiceData, null); // still null — nothing to sync
  });

  test('a later edit that lowers the total syncs downward too', () => {
    const sb = loadBill();
    sb.window.invoiceData = { total: 2512, lateFee: 800, room: '15', building: 'rooms', now: new Date() };
    sb.document = makeForm({ ...BASE_FORM, 'f-latefee': '0' }); // admin removes the penalty
    sb.calcBill();
    assert.equal(sb.window.invoiceData.total, 1712);
    assert.equal(sb.window.invoiceData.lateFee, 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// _resetBillExtras — manual per-bill extras must NOT carry between rooms.
//
// Live bug (2026-06-10): ห้อง 19's bill inherited the previous room's leftover ค่าปรับ
// because onRoomChange reset f-rent/f-elec-rate/f-trash (room-config fields) but NOT the
// manual extras (late fee / other / note). The fee then inflated the total, QR and slip
// expectedAmount and was recorded as paid. onRoomChange + onBuildingChange now both call
// _resetBillExtras so a fresh room starts with zeroed extras.
// ────────────────────────────────────────────────────────────────────────────
describe('dashboard-bill.js — _resetBillExtras', () => {
  test('zeroes f-latefee, f-other and clears f-note', () => {
    const sb = loadBill();
    sb.document = makeForm({ 'f-latefee': '800', 'f-other': '50', 'f-note': 'ค้างเดือนก่อน' });
    sb._resetBillExtras();
    // (real DOM coerces value to a string; the form stub keeps the raw 0 — assert intent)
    assert.equal(Number(sb.document.getElementById('f-latefee').value), 0);
    assert.equal(Number(sb.document.getElementById('f-other').value), 0);
    assert.equal(sb.document.getElementById('f-note').value, '');
  });

  test('no throw when the fields are absent (defensive null guards)', () => {
    const sb = loadBill();
    // makeForm returns a stub for every id, so emulate "absent" by overriding getElementById.
    sb.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, readyState: 'complete' };
    assert.doesNotThrow(() => sb._resetBillExtras());
  });
});
