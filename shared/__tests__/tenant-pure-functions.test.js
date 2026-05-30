/**
 * Unit tests for pure functions in shared/tenant-*.js modules.
 *
 * Modules covered (top-3 by LOC after god-file extraction PRs #158-#182):
 *   - tenant-system.js       (1,583 LOC) — TenantConfigManager static helpers
 *   - tenant-liff-auth.js    (  934 LOC) — building/room classifier helpers
 *   - tenant-slip-verify.js  (  169 LOC) — PromptPay payload builder
 *
 * Strategy: load each module in a vm sandbox with stubbed browser globals
 * (window, localStorage, sessionStorage). Pure functions are then accessible
 * via the sandbox's `window.X` exports OR (for non-IIFE files) via the
 * sandbox's global scope captured at load time.
 *
 * Run: node --test shared/__tests__/tenant-pure-functions.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ────────────────────────────────────────────────────────────────────────────
// Sandbox helpers
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
    _peek: () => Object.fromEntries(map),
  };
}

function makeSandbox() {
  const window = {};
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  window.localStorage = localStorage;
  window.sessionStorage = sessionStorage;
  window.location = { search: '', href: 'https://example.test/' };

  const context = {
    window,
    localStorage,
    sessionStorage,
    document: { createElement: () => ({}), getElementById: () => null },
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    URLSearchParams,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    Date,
    Object,
    Array,
    Map,
    Set,
    Promise,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { userAgent: 'test', onLine: true },
    module: { exports: {} },
  };
  // Also expose `module` so CommonJS-aware files (tenant-system.js) populate it
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

// ────────────────────────────────────────────────────────────────────────────
// tenant-slip-verify.js — PromptPay payload builder (pure)
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-slip-verify.js — buildPromptPayPayload', () => {
  const sandbox = makeSandbox();
  // Stub firebase pieces it touches at IIFE entry (only on actual call, but
  // safe to provide upfront).
  sandbox.window.firebase = { auth: () => ({ currentUser: null }) };
  loadInSandbox(sandbox, 'tenant-slip-verify.js');

  const build = sandbox.window.buildPromptPayPayload;

  test('exposes buildPromptPayPayload on window', () => {
    assert.equal(typeof build, 'function');
  });

  test('builds payload from Thai mobile number — starts with format header', () => {
    const payload = build('0812345678', 100);
    // EMVCo Tag 00 (Payload Format Indicator) is fixed to value "01"
    assert.equal(payload.slice(0, 6), '000201');
    // Tag 01 (Point of Initiation Method) is "12" for dynamic QR
    assert.match(payload, /^000201010212/);
  });

  test('builds payload terminating with 4-char hex CRC', () => {
    const payload = build('0812345678', 250.75);
    // Last 8 chars: "6304" + 4 uppercase hex
    assert.match(payload.slice(-8), /^6304[0-9A-F]{4}$/);
  });

  test('embeds amount with 2-decimal precision via Tag 54', () => {
    const payload = build('0812345678', 99);
    // Tag 54 length 05 value "99.00"
    assert.match(payload, /5405(99\.00)/);
  });

  test('produces deterministic output for same inputs (no randomness)', () => {
    const a = build('0812345678', 500);
    const b = build('0812345678', 500);
    assert.equal(a, b);
  });

  test('strips non-digit characters from phone before encoding', () => {
    const withDashes = build('081-234-5678', 100);
    const cleaned   = build('0812345678', 100);
    assert.equal(withDashes, cleaned);
  });

  test('encodes Thailand country code "TH"', () => {
    const payload = build('0812345678', 100);
    assert.match(payload, /5802TH/);
  });

  test('encodes Thai currency code "764" (THB)', () => {
    const payload = build('0812345678', 100);
    assert.match(payload, /5303764/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// tenant-liff-auth.js — building/room classifiers (pure)
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-liff-auth.js — _taDetectBuilding', () => {
  // Cannot use require() — module is not CommonJS. Load via vm and capture
  // the sandbox's globals (the file declares top-level `function _taDetectBuilding`
  // which becomes a property of the context object).
  const sandbox = makeSandbox();
  // Stub the parts the module touches at top level (auth onSnapshot etc.)
  sandbox.window.firebase = {
    auth: () => ({ onAuthStateChanged: () => {} }),
    firestore: () => ({}),
    firestoreFunctions: {},
  };
  sandbox.window.liff = { init: async () => {}, ready: Promise.resolve() };
  // Many event-listener calls happen at load time — provide a stub
  sandbox.window.addEventListener = () => {};
  sandbox.window.dispatchEvent = () => {};
  // detectRoomBuilding reads sessionStorage at load? It's only called from
  // initTenantApp, but we still want to be defensive.
  loadInSandbox(sandbox, 'tenant-liff-auth.js');

  const detect = sandbox._taDetectBuilding;

  test('exposes _taDetectBuilding in module scope', () => {
    assert.equal(typeof detect, 'function');
  });

  test('classifies numeric room 101 as nest (range 101-405)', () => {
    assert.equal(detect('101'), 'nest');
    assert.equal(detect('405'), 'nest');
    assert.equal(detect('250'), 'nest');
  });

  test('classifies numeric room 13-33 as rooms (outside nest range)', () => {
    assert.equal(detect('13'), 'rooms');
    assert.equal(detect('15'), 'rooms');
    assert.equal(detect('33'), 'rooms');
  });

  test('classifies numeric room 100 as rooms (just below nest range)', () => {
    assert.equal(detect('100'), 'rooms');
  });

  test('classifies numeric room 406 as rooms (just above nest range)', () => {
    assert.equal(detect('406'), 'rooms');
  });

  test('classifies N-prefixed room as nest regardless of number', () => {
    assert.equal(detect('N101'), 'nest');
    assert.equal(detect('N15'), 'nest');
    assert.equal(detect('n205'), 'nest');
  });

  test('classifies Thai "ร้านใหญ่" suffix as rooms', () => {
    assert.equal(detect('15ก'), 'rooms');
  });

  test('classifies empty/null input as rooms (default)', () => {
    assert.equal(detect(''), 'rooms');
    assert.equal(detect(null), 'rooms');
    assert.equal(detect(undefined), 'rooms');
  });
});

describe('tenant-liff-auth.js — _taNormalizeRoom', () => {
  const sandbox = makeSandbox();
  sandbox.window.firebase = {
    auth: () => ({ onAuthStateChanged: () => {} }),
    firestore: () => ({}),
    firestoreFunctions: {},
  };
  sandbox.window.liff = { init: async () => {}, ready: Promise.resolve() };
  sandbox.window.addEventListener = () => {};
  sandbox.window.dispatchEvent = () => {};
  loadInSandbox(sandbox, 'tenant-liff-auth.js');

  const norm = sandbox._taNormalizeRoom;

  test('exposes _taNormalizeRoom in module scope', () => {
    assert.equal(typeof norm, 'function');
  });

  test('adds N prefix to nest rooms missing one', () => {
    assert.equal(norm('101', 'nest'), 'N101');
    assert.equal(norm('205', 'nest'), 'N205');
  });

  test('preserves N prefix already present on nest rooms', () => {
    assert.equal(norm('N101', 'nest'), 'N101');
    assert.equal(norm('N205', 'nest'), 'N205');
  });

  test('strips N prefix from rooms-building IDs', () => {
    assert.equal(norm('N15', 'rooms'), '15');
    assert.equal(norm('15', 'rooms'), '15');
  });

  test('strips non-alphanumeric chars (defensive)', () => {
    assert.equal(norm('N-101', 'nest'), 'N101');
    assert.equal(norm('15 ', 'rooms'), '15');
  });

  test('preserves Thai chars in room IDs (e.g. "15ก")', () => {
    assert.equal(norm('15ก', 'rooms'), '15ก');
  });

  test('handles unknown building as identity (defensive)', () => {
    assert.equal(norm('15', 'mystery'), '15');
    assert.equal(norm('N101', 'mystery'), 'N101');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// tenant-system.js — TenantConfigManager helpers (CommonJS-friendly)
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-system.js — TenantConfigManager._resolveRoomId', () => {
  const sandbox = makeSandbox();
  loadInSandbox(sandbox, 'tenant-system.js');
  const TenantConfigManager = sandbox.module.exports.TenantConfigManager
    || sandbox.window.TenantConfigManager;

  test('TenantConfigManager is loaded', () => {
    assert.ok(TenantConfigManager, 'TenantConfigManager should be available');
    assert.equal(typeof TenantConfigManager._resolveRoomId, 'function');
  });

  test('returns tenantData.roomId when present (canonical)', () => {
    assert.equal(
      TenantConfigManager._resolveRoomId('TENANT_1234_99', { roomId: '15' }),
      '15'
    );
  });

  test('parses TENANT_<ts>_<roomId> pattern when tenantData lacks roomId', () => {
    assert.equal(TenantConfigManager._resolveRoomId('TENANT_1727000000_15', {}), '15');
    assert.equal(TenantConfigManager._resolveRoomId('TENANT_999_N101', null), 'N101');
  });

  test('falls back to tenantId when pattern does not match', () => {
    assert.equal(TenantConfigManager._resolveRoomId('15', null), '15');
    assert.equal(TenantConfigManager._resolveRoomId('legacy-key', null), 'legacy-key');
  });

  test('returns null when tenantId is empty/null', () => {
    assert.equal(TenantConfigManager._resolveRoomId(null, null), null);
    assert.equal(TenantConfigManager._resolveRoomId('', null), null);
  });

  test('tenantData.roomId takes precedence over TENANT_*_ pattern (Phase 4 SSoT)', () => {
    assert.equal(
      TenantConfigManager._resolveRoomId('TENANT_1234_LEGACY', { roomId: 'N205' }),
      'N205'
    );
  });
});

describe('tenant-system.js — TenantManager.getTenantDisplayName', () => {
  const sandbox = makeSandbox();
  loadInSandbox(sandbox, 'tenant-system.js');
  const TenantManager = sandbox.module.exports.TenantManager
    || sandbox.window.TenantManager;

  test('returns tenant.name when present', () => {
    assert.equal(
      TenantManager.getTenantDisplayName({ tenant: { name: 'สมชาย สิบห้า' } }),
      'สมชาย สิบห้า'
    );
  });

  test('returns default "ผู้เช่า" when name missing', () => {
    assert.equal(TenantManager.getTenantDisplayName({}), 'ผู้เช่า');
    assert.equal(TenantManager.getTenantDisplayName({ tenant: {} }), 'ผู้เช่า');
    assert.equal(TenantManager.getTenantDisplayName(null), 'ผู้เช่า');
    assert.equal(TenantManager.getTenantDisplayName(undefined), 'ผู้เช่า');
  });
});

describe('tenant-system.js — TenantManager.getRoomDisplayInfo', () => {
  const sandbox = makeSandbox();
  loadInSandbox(sandbox, 'tenant-system.js');
  const TenantManager = sandbox.module.exports.TenantManager
    || sandbox.window.TenantManager;

  test('uses room.name when provided', () => {
    const info = TenantManager.getRoomDisplayInfo({
      room: { name: 'ห้องเล็ก', rentPrice: 4500, waterRate: 18, electricRate: 7 },
      roomId: '15',
      building: 'rooms',
    });
    assert.equal(info.name, 'ห้องเล็ก');
    assert.equal(info.id, '15');
    assert.equal(info.rentPrice, 4500);
    assert.equal(info.waterRate, 18);
    assert.equal(info.electricRate, 7);
    assert.equal(info.building, 'rooms');
  });

  test('falls back to "ห้อง <id>" when no room.name', () => {
    const info = TenantManager.getRoomDisplayInfo({
      roomId: '20',
      building: 'rooms',
    });
    assert.equal(info.name, 'ห้อง 20');
  });

  test('applies default pricing when room object missing rates', () => {
    const info = TenantManager.getRoomDisplayInfo({
      roomId: '15',
      building: 'rooms',
    });
    assert.equal(info.rentPrice, 5900);
    assert.equal(info.waterRate, 20);
    assert.equal(info.electricRate, 8);
  });

  test('computes floor from roomId numeric portion', () => {
    assert.equal(TenantManager.getRoomDisplayInfo({ roomId: '101', building: 'nest' }).floor, 1);
    assert.equal(TenantManager.getRoomDisplayInfo({ roomId: '205', building: 'nest' }).floor, 2);
    assert.equal(TenantManager.getRoomDisplayInfo({ roomId: '305', building: 'nest' }).floor, 3);
  });

  test('handles N-prefixed Nest IDs (strips letters for floor calc)', () => {
    assert.equal(TenantManager.getRoomDisplayInfo({ roomId: 'N101', building: 'nest' }).floor, 1);
    assert.equal(TenantManager.getRoomDisplayInfo({ roomId: 'N305', building: 'nest' }).floor, 3);
  });
});

describe('tenant-system.js — TenantManager.getLeaseDisplayInfo', () => {
  const sandbox = makeSandbox();
  loadInSandbox(sandbox, 'tenant-system.js');
  const TenantManager = sandbox.module.exports.TenantManager
    || sandbox.window.TenantManager;

  test('returns lease fields when present', () => {
    const info = TenantManager.getLeaseDisplayInfo({
      lease: {
        moveInDate: '2026-01-01',
        moveOutDate: '2027-01-01',
        rentAmount: 6500,
        deposit: 13000,
        status: 'active',
        tenantName: 'สมชาย',
      },
    });
    assert.equal(info.startDate, '2026-01-01');
    assert.equal(info.endDate, '2027-01-01');
    assert.equal(info.rentAmount, 6500);
    assert.equal(info.deposit, 13000);
    assert.equal(info.status, 'active');
    assert.equal(info.tenantName, 'สมชาย');
  });

  test('returns null when lease missing', () => {
    assert.equal(TenantManager.getLeaseDisplayInfo({}), null);
    assert.equal(TenantManager.getLeaseDisplayInfo({ lease: null }), null);
  });

  test('applies default rentAmount when missing', () => {
    const info = TenantManager.getLeaseDisplayInfo({ lease: { moveInDate: '2026-01-01' } });
    assert.equal(info.rentAmount, 5900);
    assert.equal(info.deposit, 0);
  });
});

describe('tenant-system.js — TenantConfigManager localStorage CRUD', () => {
  // Each test gets a fresh sandbox so localStorage is isolated.
  function fresh() {
    const sandbox = makeSandbox();
    loadInSandbox(sandbox, 'tenant-system.js');
    return {
      TCM: sandbox.module.exports.TenantConfigManager || sandbox.window.TenantConfigManager,
      ls: sandbox.localStorage,
    };
  }

  test('addTenant persists to localStorage under the building key', () => {
    const { TCM, ls } = fresh();
    const ok = TCM.addTenant('rooms', 'TENANT_001', { name: 'สมชาย', roomId: '15' });
    assert.equal(ok, true);
    const raw = JSON.parse(ls.getItem('tenant_master_data'));
    assert.ok(raw.rooms);
    assert.equal(raw.rooms.TENANT_001.name, 'สมชาย');
    assert.equal(raw.rooms.TENANT_001.building, 'rooms');
    assert.ok(raw.rooms.TENANT_001.createdDate);
  });

  test('addTenant rejects missing name', () => {
    const { TCM } = fresh();
    assert.equal(TCM.addTenant('rooms', 'TENANT_002', {}), false);
  });

  test('addTenant rejects duplicate tenantId in same building', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'TENANT_001', { name: 'สมชาย' });
    assert.equal(TCM.addTenant('rooms', 'TENANT_001', { name: 'อื่น' }), false);
  });

  test('getTenant returns null for missing tenant', () => {
    const { TCM } = fresh();
    assert.equal(TCM.getTenant('rooms', 'TENANT_999'), null);
  });

  test('getTenantList sorts by name (Thai locale)', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'T1', { name: 'นภดล' });
    TCM.addTenant('rooms', 'T2', { name: 'กมล' });
    TCM.addTenant('rooms', 'T3', { name: 'สมชาย' });
    const list = TCM.getTenantList('rooms');
    assert.equal(list.length, 3);
    assert.equal(list[0].name, 'กมล');
    assert.equal(list[1].name, 'นภดล');
    assert.equal(list[2].name, 'สมชาย');
  });

  test('updateTenant merges fields without removing existing ones', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'TENANT_001', { name: 'สมชาย', phone: '0812345678' });
    const ok = TCM.updateTenant('rooms', 'TENANT_001', { phone: '0899999999' });
    assert.equal(ok, true);
    const t = TCM.getTenant('rooms', 'TENANT_001');
    assert.equal(t.name, 'สมชาย');
    assert.equal(t.phone, '0899999999');
    // createdDate stamped by addTenant must survive the merge
    assert.ok(t.createdDate);
  });

  test('updateTenant fails on missing tenant', () => {
    const { TCM } = fresh();
    assert.equal(TCM.updateTenant('rooms', 'TENANT_999', { phone: 'x' }), false);
  });

  test('deleteTenant removes from store', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'TENANT_001', { name: 'สมชาย' });
    assert.equal(TCM.deleteTenant('rooms', 'TENANT_001'), true);
    assert.equal(TCM.getTenant('rooms', 'TENANT_001'), null);
  });

  test('deleteTenant fails for non-existent tenant', () => {
    const { TCM } = fresh();
    assert.equal(TCM.deleteTenant('rooms', 'TENANT_999'), false);
  });

  test('searchTenants matches name/phone/idCard case-insensitively', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'T1', { name: 'สมชาย', phone: '0812345678', idCardNumber: '1234567890123' });
    TCM.addTenant('rooms', 'T2', { name: 'นภดล',  phone: '0898888888', idCardNumber: '9876543210987' });
    assert.equal(TCM.searchTenants('rooms', 'สมชาย').length, 1);
    assert.equal(TCM.searchTenants('rooms', '081234').length, 1);
    assert.equal(TCM.searchTenants('rooms', '0987').length, 1);
    assert.equal(TCM.searchTenants('rooms', 'NOMATCH').length, 0);
  });

  test('getTenantByIdAnyBuilding finds across rooms+nest', () => {
    const { TCM } = fresh();
    TCM.addTenant('rooms', 'T_R', { name: 'A' });
    TCM.addTenant('nest', 'T_N', { name: 'B' });
    assert.equal(TCM.getTenantByIdAnyBuilding('T_R').name, 'A');
    assert.equal(TCM.getTenantByIdAnyBuilding('T_N').name, 'B');
    assert.equal(TCM.getTenantByIdAnyBuilding('T_X'), null);
  });

  test('getTenantCount returns correct count per building', () => {
    const { TCM } = fresh();
    assert.equal(TCM.getTenantCount('rooms'), 0);
    TCM.addTenant('rooms', 'T1', { name: 'A' });
    TCM.addTenant('rooms', 'T2', { name: 'B' });
    TCM.addTenant('nest', 'T3', { name: 'C' });
    assert.equal(TCM.getTenantCount('rooms'), 2);
    assert.equal(TCM.getTenantCount('nest'), 1);
  });
});
