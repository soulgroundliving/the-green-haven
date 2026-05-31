/**
 * Unit tests for shared/lease-config.js — LeaseAgreementManager localStorage CRUD.
 *
 * Lease lifecycle is bug-prone (§7-DD: lifecycle CFs that update one collection
 * but leave sibling leases orphaned; §7-E year formats). The localStorage-backed
 * static CRUD here is the client cache those flows read/write, so its query +
 * mutation rules are worth locking.
 *
 * `class LeaseAgreementManager` is a top-level class with no `window.X` export
 * (it's reached cross-script via the shared global lexical environment). vm does
 * not expose lexically-scoped class bindings on the context object, so the loader
 * appends a one-line `window.__LAM = LeaseAgreementManager` shim to the SOURCE
 * STRING (test-only; the production file is untouched).
 *
 * TenantConfigManager is intentionally left undefined so getActiveLease /
 * isRoomOccupied exercise their legacy localStorage scan (not the Phase-4 SSoT
 * path, which belongs to tenant-system.js).
 *
 * Run: node --test shared/__tests__/lease-config.test.js
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

// Fresh sandbox per call → isolated localStorage. Returns the class via an
// appended shim that runs in the same script scope as the class declaration.
function loadLAM() {
  const window = {};
  const localStorage = makeStorage();
  window.localStorage = localStorage;
  const context = {
    window, localStorage,
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    parseInt, parseFloat, isFinite, isNaN,
    setTimeout: () => 0, clearTimeout: () => {},
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'lease-config.js');
  const src = fs.readFileSync(abs, 'utf8');
  vm.runInContext(src + '\nwindow.__LAM = LeaseAgreementManager;', context, { filename: 'lease-config.js' });
  return { LAM: context.window.__LAM, ls: localStorage };
}

const baseLease = (over = {}) => ({
  building: 'rooms', roomId: '15', tenantId: 'T1', tenantName: 'สมชาย',
  moveInDate: '2026-01-01', rentAmount: 5900, deposit: 11800, ...over,
});

// ────────────────────────────────────────────────────────────────────────────
// createLease + persistence
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager.createLease', () => {
  test('class is reachable via the test shim', () => {
    const { LAM } = loadLAM();
    assert.equal(typeof LAM, 'function');
    assert.equal(typeof LAM.createLease, 'function');
  });

  test('mints a CONTRACT_<ts>_<roomId> id and persists with status active', () => {
    const { LAM, ls } = loadLAM();
    const id = LAM.createLease(baseLease());
    assert.match(id, /^CONTRACT_\d+_15$/);
    const stored = JSON.parse(ls.getItem('lease_agreements_data'));
    assert.ok(stored[id]);
    assert.equal(stored[id].status, 'active');
    assert.equal(stored[id].tenantName, 'สมชาย');
    assert.ok(stored[id].createdDate, 'createdDate is stamped');
  });

  test('reuses a caller-supplied id (contractId end-to-end)', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease({ id: 'CONTRACT_PRESET_15' }));
    assert.equal(id, 'CONTRACT_PRESET_15');
  });

  test('honors an explicit status', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease({ status: 'inactive' }));
    assert.equal(LAM.getLease(id).status, 'inactive');
  });

  test('rejects missing building / room / tenant', () => {
    const { LAM } = loadLAM();
    assert.equal(LAM.createLease({ roomId: '15', tenantId: 'T1' }), null);
    assert.equal(LAM.createLease({ building: 'rooms', tenantId: 'T1' }), null);
    assert.equal(LAM.createLease({ building: 'rooms', roomId: '15' }), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getLease / getAllLeases / getAllLeasesList
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager.getLease / getAllLeases', () => {
  test('getAllLeases is {} on a fresh store', () => {
    const { LAM } = loadLAM();
    assert.deepEqual(Object.keys(LAM.getAllLeases()), []);
  });

  test('getLease returns the doc or null', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease());
    assert.equal(LAM.getLease(id).roomId, '15');
    assert.equal(LAM.getLease('NOPE'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getActiveLease (legacy localStorage scan)
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager.getActiveLease (legacy path)', () => {
  test('finds the active lease for a building+room', () => {
    const { LAM } = loadLAM();
    LAM.createLease(baseLease());
    const active = LAM.getActiveLease('rooms', '15');
    assert.ok(active);
    assert.equal(active.tenantId, 'T1');
    assert.equal(active.status, 'active');
  });

  test('returns null when the only lease is inactive', () => {
    const { LAM } = loadLAM();
    LAM.createLease(baseLease({ status: 'inactive' }));
    assert.equal(LAM.getActiveLease('rooms', '15'), null);
  });

  test('does not cross building or room boundaries', () => {
    const { LAM } = loadLAM();
    LAM.createLease(baseLease({ roomId: '15' }));
    assert.equal(LAM.getActiveLease('rooms', '16'), null);
    assert.equal(LAM.getActiveLease('nest', '15'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getLeaseHistory — filter superseded, sort by moveInDate desc
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager.getLeaseHistory', () => {
  test('returns building+room leases newest-first, excluding superseded', () => {
    const { LAM } = loadLAM();
    LAM.createLease(baseLease({ id: 'L_OLD', moveInDate: '2025-01-01', status: 'inactive' }));
    LAM.createLease(baseLease({ id: 'L_NEW', moveInDate: '2026-01-01', status: 'active' }));
    LAM.createLease(baseLease({ id: 'L_SUP', moveInDate: '2025-06-01', status: 'superseded' }));

    const hist = LAM.getLeaseHistory('rooms', '15');
    assert.equal(hist.length, 2, 'superseded is excluded');
    assert.equal(hist[0].id, 'L_NEW', 'newest moveInDate first');
    assert.equal(hist[1].id, 'L_OLD');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// updateLease / endLease / deleteLease
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager.updateLease / endLease / deleteLease', () => {
  test('updateLease merges fields and preserves the rest', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease({ rentAmount: 5900 }));
    assert.equal(LAM.updateLease(id, { rentAmount: 6500 }), true);
    const l = LAM.getLease(id);
    assert.equal(l.rentAmount, 6500);
    assert.equal(l.tenantId, 'T1', 'untouched fields survive');
  });

  test('updateLease returns false for a missing lease', () => {
    const { LAM } = loadLAM();
    assert.equal(LAM.updateLease('NOPE', { rentAmount: 1 }), false);
  });

  test('endLease flips status to inactive and records moveOutDate', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease());
    assert.equal(LAM.endLease(id, '2026-12-31'), true);
    const l = LAM.getLease(id);
    assert.equal(l.status, 'inactive');
    assert.equal(l.moveOutDate, '2026-12-31');
  });

  test('deleteLease removes the lease; false when absent', () => {
    const { LAM } = loadLAM();
    const id = LAM.createLease(baseLease());
    assert.equal(LAM.deleteLease(id), true);
    assert.equal(LAM.getLease(id), null);
    assert.equal(LAM.deleteLease(id), false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Building/tenant queries + occupancy
// ────────────────────────────────────────────────────────────────────────────

describe('LeaseAgreementManager queries + occupancy', () => {
  function seed(LAM) {
    LAM.createLease(baseLease({ id: 'A', building: 'rooms', roomId: '15', tenantId: 'T1', status: 'active', moveInDate: '2026-03-01' }));
    LAM.createLease(baseLease({ id: 'B', building: 'rooms', roomId: '16', tenantId: 'T2', status: 'active', moveInDate: '2026-01-01' }));
    LAM.createLease(baseLease({ id: 'C', building: 'rooms', roomId: '17', tenantId: 'T1', status: 'inactive', moveInDate: '2025-01-01' }));
    LAM.createLease(baseLease({ id: 'D', building: 'nest', roomId: '101', tenantId: 'T3', status: 'active', moveInDate: '2026-02-01' }));
  }

  test('getLeasesByBuilding filters by building, newest moveInDate first', () => {
    const { LAM } = loadLAM(); seed(LAM);
    const rooms = LAM.getLeasesByBuilding('rooms');
    assert.equal(rooms.length, 3);
    assert.equal(rooms[0].id, 'A', '2026-03-01 is newest');
  });

  test('getLeasesByTenant gathers across rooms', () => {
    const { LAM } = loadLAM(); seed(LAM);
    const t1 = LAM.getLeasesByTenant('T1');
    assert.equal(t1.length, 2);
    assert.ok(t1.every((l) => l.tenantId === 'T1'));
  });

  test('getActiveLeaseCount counts only active in the building', () => {
    const { LAM } = loadLAM(); seed(LAM);
    assert.equal(LAM.getActiveLeaseCount('rooms'), 2); // A,B active; C inactive
    assert.equal(LAM.getActiveLeaseCount('nest'), 1);
  });

  test('getRoomOccupancy returns active room ids + count', () => {
    const { LAM } = loadLAM(); seed(LAM);
    const occ = LAM.getRoomOccupancy('rooms');
    assert.equal(occ.count, 2);
    assert.ok([...occ.occupied].includes('15'));
    assert.ok([...occ.occupied].includes('16'));
    assert.ok(![...occ.occupied].includes('17'), 'inactive room is vacant');
  });

  test('isRoomOccupied reflects an active lease', () => {
    const { LAM } = loadLAM(); seed(LAM);
    assert.equal(LAM.isRoomOccupied('rooms', '15'), true);
    assert.equal(LAM.isRoomOccupied('rooms', '17'), false); // inactive
    assert.equal(LAM.isRoomOccupied('rooms', '99'), false); // no lease
  });
});
