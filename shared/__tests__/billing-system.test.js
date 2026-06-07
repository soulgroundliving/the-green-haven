/**
 * Unit tests for pure functions in shared/billing-system.js.
 *
 * Billing is the single most bug-prone surface in this project (see CLAUDE.md
 * §7-D BillStore.getByRoom vs listForYear, §7-E the 3 coexisting year formats).
 * These tests lock the calculation + year-normalization + synthetic-dedup logic
 * so the next billing sweep can't silently break the math.
 *
 * Classes covered:
 *   - BillingSystem — calculateUsage / calculateCost / detectBuilding / generateBill
 *   - BillStore     — _bld / _be (§7-E) / isPaid / isSynthetic / dedupSynthetic /
 *                     tenantBoundaryYM / filterByTenantBoundary
 *
 * Strategy: load billing-system.js in a vm sandbox with stubbed browser globals.
 * The module exposes both classes via `window.X`. setTimeout is a no-op stub so
 * the auto-subscribe at the bottom never fires; window.YearUtils is intentionally
 * absent so _be / dedupSynthetic exercise their self-contained fallback paths.
 *
 * Run: node --test shared/__tests__/billing-system.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ────────────────────────────────────────────────────────────────────────────
// Sandbox helpers (mirror tenant-pure-functions.test.js so each test file stays
// independently runnable per repo convention).
// ────────────────────────────────────────────────────────────────────────────

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] || null,
  };
}

function makeSandbox() {
  const window = {};
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  window.localStorage = localStorage;
  window.sessionStorage = sessionStorage;
  // Non-dashboard path so the module's load-time _bootstrapAutoBilling() and
  // BillStore.subscribe() both short-circuit (no Firebase touch during tests).
  window.location = { search: '', href: 'https://example.test/', pathname: '/test' };
  window.addEventListener = () => {};
  window.removeEventListener = () => {};
  window.dispatchEvent = () => {};

  const context = {
    window,
    localStorage,
    sessionStorage,
    location: window.location,
    document: {
      createElement: () => ({}),
      getElementById: () => null,
      addEventListener: () => {},
      readyState: 'complete',
    },
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    URLSearchParams,
    JSON, Math, Number, String, Boolean,
    parseInt, parseFloat, isFinite, isNaN,
    Date, Object, Array, Map, Set, Promise,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { userAgent: 'test', onLine: true },
    module: { exports: {} },
  };
  context.exports = context.module.exports;
  vm.createContext(context);
  return context;
}

function loadInSandbox(sandbox, relPath) {
  const abs = path.join(__dirname, '..', relPath);
  const src = fs.readFileSync(abs, 'utf8');
  vm.runInContext(src, sandbox, { filename: relPath });
  return sandbox;
}

function loadBilling() {
  const sandbox = makeSandbox();
  loadInSandbox(sandbox, 'billing-system.js');
  return {
    BillingSystem: sandbox.window.BillingSystem,
    BillStore: sandbox.window.BillStore,
    sandbox,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// BillingSystem.calculateUsage
// ────────────────────────────────────────────────────────────────────────────

describe('BillingSystem.calculateUsage', () => {
  const { BillingSystem } = loadBilling();

  test('exposes BillingSystem on window', () => {
    assert.equal(typeof BillingSystem, 'function');
    assert.equal(typeof BillingSystem.calculateUsage, 'function');
  });

  test('computes usage = current - previous when increasing', () => {
    const r = BillingSystem.calculateUsage(150, 100);
    assert.equal(r.usage, 50);
    assert.equal(r.valid, true);
    assert.equal(r.error, null);
  });

  test('zero usage when readings are equal', () => {
    const r = BillingSystem.calculateUsage(100, 100);
    assert.equal(r.usage, 0);
    assert.equal(r.valid, true);
  });

  test('flags a meter reset (current < previous) as invalid with usage 0', () => {
    const r = BillingSystem.calculateUsage(40, 100);
    assert.equal(r.usage, 0);
    assert.equal(r.valid, false);
    assert.match(r.error, /รีเซ็ต/);
  });

  test('defaults previousReading to 0', () => {
    const r = BillingSystem.calculateUsage(75);
    assert.equal(r.usage, 75);
    assert.equal(r.valid, true);
  });

  test('coerces numeric strings', () => {
    const r = BillingSystem.calculateUsage('200', '120');
    assert.equal(r.usage, 80);
    assert.equal(r.valid, true);
  });

  test('treats non-numeric readings as 0', () => {
    const r = BillingSystem.calculateUsage('abc', 'xyz');
    assert.equal(r.usage, 0);
    assert.equal(r.valid, true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillingSystem.calculateCost
// ────────────────────────────────────────────────────────────────────────────

describe('BillingSystem.calculateCost', () => {
  const { BillingSystem } = loadBilling();

  test('multiplies usage by rate', () => {
    assert.equal(BillingSystem.calculateCost(10, 8), 80);
    assert.equal(BillingSystem.calculateCost(5, 20), 100);
  });

  test('coerces numeric strings', () => {
    assert.equal(BillingSystem.calculateCost('10', '8'), 80);
  });

  test('returns 0 when either operand is non-numeric', () => {
    assert.equal(BillingSystem.calculateCost('x', 8), 0);
    assert.equal(BillingSystem.calculateCost(10, 'y'), 0);
  });

  test('handles fractional rates', () => {
    assert.equal(BillingSystem.calculateCost(3, 7.5), 22.5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillingSystem.detectBuilding  (the magic 101-405 range — §7 detectBuilding ×4)
// ────────────────────────────────────────────────────────────────────────────

describe('BillingSystem.detectBuilding', () => {
  const { BillingSystem } = loadBilling();

  test('returns [building, roomStr] tuple', () => {
    const r = BillingSystem.detectBuilding('15');
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 2);
    assert.equal(r[1], '15');
  });

  test('N / n prefix → nest regardless of number', () => {
    assert.equal(BillingSystem.detectBuilding('N101')[0], 'nest');
    assert.equal(BillingSystem.detectBuilding('n15')[0], 'nest');
    assert.equal(BillingSystem.detectBuilding('N9')[0], 'nest');
  });

  test('numeric 101-405 → nest', () => {
    assert.equal(BillingSystem.detectBuilding('101')[0], 'nest');
    assert.equal(BillingSystem.detectBuilding('250')[0], 'nest');
    assert.equal(BillingSystem.detectBuilding('405')[0], 'nest');
  });

  test('numeric just outside 101-405 → rooms', () => {
    assert.equal(BillingSystem.detectBuilding('100')[0], 'rooms');
    assert.equal(BillingSystem.detectBuilding('406')[0], 'rooms');
  });

  test('low row-house numbers (13/15/33) → rooms', () => {
    assert.equal(BillingSystem.detectBuilding('13')[0], 'rooms');
    assert.equal(BillingSystem.detectBuilding('15')[0], 'rooms');
    assert.equal(BillingSystem.detectBuilding('33')[0], 'rooms');
  });

  test('accepts a numeric (non-string) roomId', () => {
    assert.equal(BillingSystem.detectBuilding(205)[0], 'nest');
    assert.equal(BillingSystem.detectBuilding(15)[0], 'rooms');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillingSystem.generateBill
// ────────────────────────────────────────────────────────────────────────────

describe('BillingSystem.generateBill', () => {
  const { BillingSystem } = loadBilling();

  test('builds canonical billId BILL-<year>-<MM>-<building>-<room>', () => {
    const bill = BillingSystem.generateBill({ building: 'rooms', roomId: '15', month: 5, year: 2569 });
    assert.equal(bill.billId, 'BILL-2569-05-rooms-15');
  });

  test('totalCharge = rent + water + electric + common + trash', () => {
    const bill = BillingSystem.generateBill({
      building: 'rooms', roomId: '15', month: 1, year: 2569,
      rentPrice: 5000,
      waterCurrentReading: 110, waterPreviousReading: 100, waterRate: 20,   // 10 * 20 = 200
      electricCurrentReading: 250, electricPreviousReading: 200, electricRate: 8, // 50 * 8 = 400
      commonChargePerRoom: 50,
      trashCharge: 40,
    });
    assert.equal(bill.charges.water.cost, 200);
    assert.equal(bill.charges.electric.cost, 400);
    assert.equal(bill.totalCharge, 5000 + 200 + 400 + 50 + 40);
  });

  test('applies default water/electric/trash rates when omitted', () => {
    const bill = BillingSystem.generateBill({
      building: 'nest', roomId: '101', month: 3, year: 2569,
      rentPrice: 0,
      waterCurrentReading: 1, waterPreviousReading: 0,      // 1 * 20 (default) = 20
      electricCurrentReading: 1, electricPreviousReading: 0, // 1 * 8 (default) = 8
    });
    assert.equal(bill.charges.water.rate, 20);
    assert.equal(bill.charges.electric.rate, 8);
    assert.equal(bill.charges.trash, 40);
    assert.equal(bill.totalCharge, 0 + 20 + 8 + 0 + 40);
  });

  test('records a meter-reset error in the errors array', () => {
    const bill = BillingSystem.generateBill({
      building: 'rooms', roomId: '15', month: 2, year: 2569,
      waterCurrentReading: 10, waterPreviousReading: 50,  // reset
    });
    assert.equal(bill.charges.water.usage, 0);
    assert.ok(bill.errors.length >= 1);
    assert.match(bill.errors[0], /รีเซ็ต/);
  });

  test('starts new bills in pending status', () => {
    const bill = BillingSystem.generateBill({ building: 'rooms', roomId: '15', month: 5, year: 2569 });
    assert.equal(bill.status, 'pending');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillStore._bld — building alias coercion
// ────────────────────────────────────────────────────────────────────────────

describe('BillStore._bld', () => {
  const { BillStore } = loadBilling();

  test('legacy aliases collapse to rooms', () => {
    assert.equal(BillStore._bld('old'), 'rooms');
    assert.equal(BillStore._bld('rooms'), 'rooms');
    assert.equal(BillStore._bld('RentRoom'), 'rooms');
  });

  test('nest aliases collapse to nest', () => {
    assert.equal(BillStore._bld('new'), 'nest');
    assert.equal(BillStore._bld('nest'), 'nest');
  });

  test('unknown building passes through unchanged', () => {
    assert.equal(BillStore._bld('amazon'), 'amazon');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillStore._be — §7-E year-format normalization (fallback path, no YearUtils)
// ────────────────────────────────────────────────────────────────────────────

describe('BillStore._be (§7-E year normalization)', () => {
  const { BillStore } = loadBilling();

  test('2-digit BE → 4-digit BE (69 → 2569)', () => {
    assert.equal(BillStore._be(69), 2569);
    assert.equal(BillStore._be('69'), 2569);
  });

  test('4-digit CE → 4-digit BE (2026 → 2569)', () => {
    assert.equal(BillStore._be(2026), 2569);
    assert.equal(BillStore._be('2026'), 2569);
  });

  test('4-digit BE passes through (2569 → 2569)', () => {
    assert.equal(BillStore._be(2569), 2569);
    assert.equal(BillStore._be('2569'), 2569);
  });

  test('all three formats of the same year normalize identically', () => {
    const a = BillStore._be(69);
    const b = BillStore._be(2026);
    const c = BillStore._be(2569);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  test('zero / negative pass through unchanged', () => {
    assert.equal(BillStore._be(0), 0);
    assert.equal(BillStore._be(-5), -5);
  });

  test('non-numeric input yields NaN (caller treats as no-match)', () => {
    assert.ok(Number.isNaN(BillStore._be('abc')));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillStore.isPaid / isSynthetic
// ────────────────────────────────────────────────────────────────────────────

describe('BillStore.isPaid', () => {
  const { BillStore } = loadBilling();

  test('status "paid" (any case) is paid', () => {
    assert.equal(BillStore.isPaid({ status: 'paid' }), true);
    assert.equal(BillStore.isPaid({ status: 'PAID' }), true);
  });

  test('paidAt set without status is still paid', () => {
    assert.equal(BillStore.isPaid({ paidAt: '2026-05-01T00:00:00Z' }), true);
  });

  test('pending / missing → not paid', () => {
    assert.equal(BillStore.isPaid({ status: 'pending' }), false);
    assert.equal(BillStore.isPaid({}), false);
    assert.equal(BillStore.isPaid(null), false);
  });
});

describe('BillStore.isSynthetic', () => {
  const { BillStore } = loadBilling();

  test('explicit synthetic flag', () => {
    assert.equal(BillStore.isSynthetic({ synthetic: true }), true);
  });

  test('SYNTH- prefix on billId or id', () => {
    assert.equal(BillStore.isSynthetic({ billId: 'SYNTH-rooms-15-202605' }), true);
    assert.equal(BillStore.isSynthetic({ id: 'SYNTH-nest-101-202605' }), true);
  });

  test('real bill is not synthetic', () => {
    assert.equal(BillStore.isSynthetic({ billId: 'BILL-2569-05-rooms-15' }), false);
    assert.equal(BillStore.isSynthetic({}), false);
    assert.equal(BillStore.isSynthetic(null), false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillStore.dedupSynthetic — drop synth twin when a real bill exists same YM
// ────────────────────────────────────────────────────────────────────────────

describe('BillStore.dedupSynthetic', () => {
  const { BillStore } = loadBilling();

  test('drops the synthetic when a real bill exists for the same year+month', () => {
    const bills = [
      { billId: 'BILL-2569-05-rooms-15', year: 2569, month: 5 },
      { billId: 'SYNTH-rooms-15-202605', synthetic: true, year: 2569, month: 5 },
    ];
    const out = BillStore.dedupSynthetic(bills);
    assert.equal(out.length, 1);
    assert.equal(out[0].billId, 'BILL-2569-05-rooms-15');
  });

  test('keeps the synthetic when no real twin exists', () => {
    const bills = [
      { billId: 'BILL-2569-05-rooms-15', year: 2569, month: 5 },
      { billId: 'SYNTH-rooms-15-202604', synthetic: true, year: 2569, month: 4 },
    ];
    const out = BillStore.dedupSynthetic(bills);
    assert.equal(out.length, 2);
  });

  test('keeps all bills when none are synthetic', () => {
    const bills = [
      { billId: 'BILL-2569-05-rooms-15', year: 2569, month: 5 },
      { billId: 'BILL-2569-04-rooms-15', year: 2569, month: 4 },
    ];
    assert.equal(BillStore.dedupSynthetic(bills).length, 2);
  });

  test('returns a new array (no in-place mutation)', () => {
    const bills = [
      { billId: 'BILL-2569-05-rooms-15', year: 2569, month: 5 },
      { billId: 'SYNTH-rooms-15-202605', synthetic: true, year: 2569, month: 5 },
    ];
    const out = BillStore.dedupSynthetic(bills);
    assert.notEqual(out, bills);
    assert.equal(bills.length, 2, 'input array unchanged');
  });

  test('empty / non-array input is safe', () => {
    // Returned arrays may be created inside the vm sandbox (different realm),
    // so check shape via Array.isArray + length rather than cross-realm deepEqual.
    const a = BillStore.dedupSynthetic([]);
    const b = BillStore.dedupSynthetic(null);
    assert.ok(Array.isArray(a) && a.length === 0);
    assert.ok(Array.isArray(b) && b.length === 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BillStore.tenantBoundaryYM / filterByTenantBoundary
// ────────────────────────────────────────────────────────────────────────────

describe('BillStore.tenantBoundaryYM', () => {
  const { BillStore } = loadBilling();

  test('returns YYYYMM from moveInDate', () => {
    assert.equal(BillStore.tenantBoundaryYM({ moveInDate: '2026-03-15' }), 202603);
  });

  test('falls back to startDate (canonical lease field)', () => {
    assert.equal(BillStore.tenantBoundaryYM({ startDate: '2026-01-01' }), 202601);
  });

  test('moveInDate takes precedence over startDate', () => {
    assert.equal(
      BillStore.tenantBoundaryYM({ moveInDate: '2026-06-01', startDate: '2026-01-01' }),
      202606
    );
  });

  test('returns 0 when no usable date (show everything)', () => {
    assert.equal(BillStore.tenantBoundaryYM({}), 0);
    assert.equal(BillStore.tenantBoundaryYM(null), 0);
    assert.equal(BillStore.tenantBoundaryYM({ moveInDate: 'not-a-date' }), 0);
  });
});

describe('BillStore.filterByTenantBoundary', () => {
  const { BillStore } = loadBilling();
  const getYM = (it) => it.ym;

  test('drops items before the move-in month', () => {
    const items = [{ ym: 202601 }, { ym: 202603 }, { ym: 202605 }];
    const out = BillStore.filterByTenantBoundary(items, getYM, { moveInDate: '2026-03-01' });
    assert.deepEqual([...out].map((i) => i.ym), [202603, 202605]);
  });

  test('keeps items whose month is unknown (ym === 0) — never hide uncategorized', () => {
    const items = [{ ym: 0 }, { ym: 202601 }, { ym: 202605 }];
    const out = BillStore.filterByTenantBoundary(items, getYM, { moveInDate: '2026-03-01' });
    assert.ok(out.some((i) => i.ym === 0));
    assert.ok(!out.some((i) => i.ym === 202601));
  });

  test('no-op when the lease has no usable boundary', () => {
    const items = [{ ym: 202601 }, { ym: 202605 }];
    const out = BillStore.filterByTenantBoundary(items, getYM, {});
    assert.equal(out.length, 2);
  });

  test('future move-in/start date never hides current data (transfer-carried future contractStart)', () => {
    // Regression for 2026-06-07: a variation-mode transfer carried a future contractStart
    // into .lease.startDate with no moveInDate → boundary in the future hid every reading
    // → the synthesized current-month bill never rendered. A future boundary must be a
    // no-op, never a total blackout. '2099-01-01' is unambiguously future regardless of run date.
    const items = [{ ym: 202604 }, { ym: 202605 }, { ym: 202606 }];
    const out = BillStore.filterByTenantBoundary(items, getYM, { startDate: '2099-01-01' });
    assert.equal(out.length, 3);
  });

  test('empty / non-array input is safe', () => {
    const a = BillStore.filterByTenantBoundary([], getYM, {});
    const b = BillStore.filterByTenantBoundary(null, getYM, {});
    assert.ok(Array.isArray(a) && a.length === 0);
    assert.ok(Array.isArray(b) && b.length === 0);
  });
});
