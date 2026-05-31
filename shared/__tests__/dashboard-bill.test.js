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
        classList: { contains: (c) => classes.has(c), add() {}, remove() {} },
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
