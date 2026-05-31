/**
 * Unit tests for shared/bill-generator.js — BillGenerator.
 *
 * BillGenerator.generateMonthlyBills is the admin "issue all invoices for the
 * month" orchestrator (called from dashboard-bills.js); its per-room charge
 * breakdown (rent default, electric = meter × rate, water = meter × rate, fixed
 * trash) and its missing-dependency guards are worth locking. getThaiMonthName
 * is a pure month-name table (off-by-one bait).
 *
 * `class BillGenerator` has no `window.X` export (reached cross-script via the
 * shared global lexical env), so the loader appends a test-only shim to the
 * source string. RoomConfigManager / InvoiceReceiptManager are bareword globals
 * the orchestrator depends on — stubbed per test on the context.
 *
 * Run: node --test shared/__tests__/bill-generator.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

function loadBG() {
  const window = {};
  const localStorage = makeStorage();
  window.localStorage = localStorage;
  window.dispatchEvent = () => {};
  const context = {
    window, localStorage,
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    parseInt, parseFloat, isFinite, isNaN,
    Event: class { constructor(t) { this.type = t; } },
    setTimeout: () => 0, clearTimeout: () => {},
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'bill-generator.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8') + '\nwindow.__BG = BillGenerator;', context, { filename: 'bill-generator.js' });
  return { BG: context.window.__BG, sb: context, ls: localStorage };
}

// ────────────────────────────────────────────────────────────────────────────
// getThaiMonthName
// ────────────────────────────────────────────────────────────────────────────

describe('BillGenerator.getThaiMonthName', () => {
  const { BG } = loadBG();

  test('maps 1 and 12 to the right Thai month', () => {
    assert.equal(BG.getThaiMonthName(1), 'มกราคม');
    assert.equal(BG.getThaiMonthName(12), 'ธันวาคม');
  });

  test('maps a mid-year month (no off-by-one)', () => {
    assert.equal(BG.getThaiMonthName(3), 'มีนาคม');
  });

  test('returns the fallback for out-of-range months', () => {
    assert.equal(BG.getThaiMonthName(0), 'ไม่ระบุ');
    assert.equal(BG.getThaiMonthName(13), 'ไม่ระบุ');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// generatePromptPayQR
// ────────────────────────────────────────────────────────────────────────────

describe('BillGenerator.generatePromptPayQR', () => {
  const { BG } = loadBG();

  test('returns a promptpay descriptor carrying the amount', () => {
    const qr = BG.generatePromptPayQR(2480);
    assert.equal(qr.type, 'promptpay');
    assert.equal(qr.amount, 2480);
    assert.ok(qr.identifier);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// generateMonthlyBills — orchestration + breakdown
// ────────────────────────────────────────────────────────────────────────────

describe('BillGenerator.generateMonthlyBills', () => {
  test('returns {success:false} when RoomConfigManager is unavailable', () => {
    const { BG } = loadBG(); // no managers stubbed
    const r = BG.generateMonthlyBills('rooms', 2569, 3);
    assert.equal(r.success, false);
    assert.equal(r.count, 0);
  });

  test('issues one invoice per active (non-deleted) room with the right breakdown', () => {
    const { BG, sb, ls } = loadBG();
    const created = [];
    sb.RoomConfigManager = {
      getRoomsConfig: () => ({
        rooms: [
          { id: '15', rentPrice: 5000, electricRate: 8, waterRate: 20 },
          { id: '16', deleted: true }, // skipped
        ],
      }),
    };
    sb.InvoiceReceiptManager = {
      createInvoice: (building, roomId, month, breakdown, opts) => {
        created.push({ roomId, breakdown, month, opts });
        return { id: 'INV-' + roomId };
      },
    };
    // Meter reading for room 15, 2569-03 → electric 100 units, water 50 units.
    ls.setItem('meter_data', JSON.stringify({
      'rooms_15_2569_3': { electric_current: 100, water_current: 50 },
    }));

    const r = BG.generateMonthlyBills('rooms', 2569, 3);

    assert.equal(r.success, true);
    assert.equal(r.count, 1, 'deleted room 16 is skipped');
    assert.deepEqual([...r.invoiceIds], ['INV-15']);

    assert.equal(created.length, 1);
    const b = created[0].breakdown;
    assert.equal(b.rent, 5000);
    assert.equal(b.electric, 100 * 8);
    assert.equal(b.water, 50 * 20);
    assert.equal(b.trash, 40);
    assert.equal(created[0].month, '2569_03', 'month is zero-padded YEAR_MM');
  });

  test('defaults rent to 1500 and meter usage to 0 when data is missing', () => {
    const { BG, sb } = loadBG();
    const created = [];
    sb.RoomConfigManager = { getRoomsConfig: () => ({ rooms: [{ id: '20' }] }) };
    sb.InvoiceReceiptManager = {
      createInvoice: (b, roomId, m, breakdown) => { created.push(breakdown); return { id: 'INV-' + roomId }; },
    };
    BG.generateMonthlyBills('rooms', 2569, 5);
    assert.equal(created[0].rent, 1500);
    assert.equal(created[0].electric, 0);
    assert.equal(created[0].water, 0);
    assert.equal(created[0].trash, 40);
  });
});
