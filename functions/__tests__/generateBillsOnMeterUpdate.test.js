/**
 * Unit tests for generateBillsOnMeterUpdate.js
 *
 * Covers: deleted-doc skip, unparseable docId, rent=0 guard, paid/manual bill
 * preservation, ghost-stub overwrite, charge calculation, due-date month
 * wraparound, negative meter delta clamping, config fallback, success shape.
 *
 * Run: node --test functions/__tests__/generateBillsOnMeterUpdate.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state (reset per test) ────────────────────────────────────────────────

let stubRoomCfg = null;       // null → rooms_config not found → use DEFAULTS
let stubExistingBill = null;  // null → no pre-existing bill
let capturedBillWrite = null; // { path, data } captured from RTDB ref.set()
let capturedAuditWrite = null;

const RTDB_TS = '__SERVER_TS__';

function resetStubs(overrides = {}) {
  stubRoomCfg      = overrides.roomCfg      !== undefined ? overrides.roomCfg      : null;
  stubExistingBill = overrides.existingBill !== undefined ? overrides.existingBill : null;
  capturedBillWrite  = null;
  capturedAuditWrite = null;
}
resetStubs();

// ── Module._load intercept ──────────────────────────────────────────────────────
// Must run BEFORE require('../generateBillsOnMeterUpdate.js') so the module-load
// side effects (admin.database(), admin.firestore() calls) see the stubs.

let capturedHandler = null;
const _origLoad = Module._load;

function databaseFn() {
  return {
    ref: (path) => ({
      once: async () => ({
        val: () => (path.startsWith('rooms_config/') ? stubRoomCfg : stubExistingBill),
      }),
      set: async (data) => { capturedBillWrite = { path, data }; },
      push: () => ({
        set: async (data) => { capturedAuditWrite = data; },
      }),
    }),
  };
}
databaseFn.ServerValue = { TIMESTAMP: RTDB_TS };

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    return {
      apps: [{}],
      initializeApp: () => {},
      database: databaseFn,
      firestore: () => ({}),  // called at module load but unused by handler
    };
  }
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        firestore: {
          document: () => ({
            onWrite: (h) => { capturedHandler = h; return h; },
          }),
        },
      }),
    };
  }
  return _origLoad.apply(this, arguments);
};

delete require.cache[require.resolve('../generateBillsOnMeterUpdate.js')];
require('../generateBillsOnMeterUpdate.js');

after(() => { Module._load = _origLoad; });

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeChange({ exists = true, data = {} } = {}) {
  return { after: { exists, data: () => (exists ? data : null) } };
}

function makeCtx(docId) {
  return { params: { docId } };
}

// Standard meter doc with all fields populated (rooms building, room 15, Apr 69BE)
const DEFAULT_METER = {
  building: 'rooms', roomId: '15', year: 69, month: 4,
  eOld: 100, eNew: 130, wOld: 20, wNew: 25,
};
const DEFAULT_DOC_ID = 'rooms_69_04_15';

// Standard room config matching DEFAULTS.rooms
const ROOM_CFG = { rentPrice: 1200, electricRate: 8, waterRate: 20, trashRate: 20 };

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('generateBillsOnMeterUpdate', () => {
  beforeEach(() => resetStubs({ roomCfg: ROOM_CFG }));

  // 0. Sanity
  it('handler was captured from onWrite', () => {
    assert.equal(typeof capturedHandler, 'function');
  });

  // 1. Deleted doc
  it('returns null and skips RTDB write when doc is deleted', async () => {
    const result = await capturedHandler(
      makeChange({ exists: false }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.equal(result, null);
    assert.equal(capturedBillWrite, null);
  });

  // 2. Unparseable docId + no doc fields
  it('returns null for unparseable docId with missing doc fields', async () => {
    const result = await capturedHandler(
      makeChange({ data: {} }),  // no building/roomId/year/month
      makeCtx('bad_id'),        // too few segments for parseDocId
    );
    assert.equal(result, null);
    assert.equal(capturedBillWrite, null);
  });

  // 3. docId parsing fallback
  it('falls back to docId parsing when doc fields are absent', async () => {
    const result = await capturedHandler(
      makeChange({ data: { eOld: 0, eNew: 10, wOld: 0, wNew: 2 } }),
      makeCtx('nest_67_10_22'),
    );
    assert.ok(result?.success, 'should succeed via docId parse');
    assert.ok(capturedBillWrite, 'bill should be written');
    assert.equal(capturedBillWrite.data.building, 'nest');
    assert.equal(capturedBillWrite.data.room, '22');
    assert.equal(capturedBillWrite.data.month, 10);
    assert.equal(capturedBillWrite.data.year, 2567);  // 2500 + 67
  });

  // 4. rent=0 guard
  // loadRoomConfig rejects configs with falsy rentPrice (0) via the `cfg.rentPrice` truthy
  // check, falling through to DEFAULTS. The guard fires for non-numeric strings ('n/a', etc.)
  // which ARE truthy (pass the check) but yield NaN → 0 after Number().
  it('returns null without writing bill when config rentPrice is non-numeric (rent=0)', async () => {
    resetStubs({ roomCfg: { rentPrice: 'n/a', electricRate: 8, waterRate: 20, trashRate: 20 } });
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.equal(result, null);
    assert.equal(capturedBillWrite, null);
  });

  // 5. Paid bill preservation
  it('does not overwrite a paid bill', async () => {
    resetStubs({
      roomCfg: ROOM_CFG,
      existingBill: { status: 'paid', totalCharge: 1500, generatedBy: 'auto_cf' },
    });
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.equal(result, null);
    assert.equal(capturedBillWrite, null);
  });

  // 6. Manual bill preservation
  it('does not overwrite manually generated bill (totalCharge>0, generatedBy≠auto_cf)', async () => {
    resetStubs({
      roomCfg: ROOM_CFG,
      existingBill: { status: 'pending', totalCharge: 1500, generatedBy: 'admin' },
    });
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.equal(result, null);
    assert.equal(capturedBillWrite, null);
  });

  // 7. Ghost stub overwrite
  it('overwrites ghost stub (existing bill has totalCharge=0)', async () => {
    resetStubs({
      roomCfg: ROOM_CFG,
      existingBill: { status: 'pending', totalCharge: 0, generatedBy: 'admin' },
    });
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.ok(result?.success, 'should overwrite ghost stub');
    assert.ok(capturedBillWrite, 'bill should be written');
  });

  // 8. auto_cf bill re-generation
  it('overwrites auto_cf bill on meter re-run', async () => {
    resetStubs({
      roomCfg: ROOM_CFG,
      existingBill: { status: 'pending', totalCharge: 1400, generatedBy: 'auto_cf' },
    });
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.ok(result?.success);
    assert.ok(capturedBillWrite);
  });

  // 9. Bill RTDB path and deterministic ID
  it('writes to correct RTDB path with deterministic billId', async () => {
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    assert.ok(capturedBillWrite);
    // year=69 → beYear=2569, month=4 → mm='04', roomId=15
    assert.ok(
      capturedBillWrite.path.includes('bills/rooms/15/TGH-256904-15'),
      `expected TGH-256904-15 in path, got: ${capturedBillWrite.path}`,
    );
    assert.equal(capturedBillWrite.data.billId, 'TGH-256904-15');
  });

  // 10. Charge computation
  it('computes totalCharge = rent + eCost + wCost + trash correctly', async () => {
    // eUnits = 130-100 = 30 × 8 = 240; wUnits = 25-20 = 5 × 20 = 100
    // total = 1200 + 240 + 100 + 20 = 1560
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    const charges = capturedBillWrite.data.charges;
    assert.equal(capturedBillWrite.data.totalCharge, 1560);
    assert.equal(capturedBillWrite.data.totalAmount, 1560);
    assert.equal(charges.rent, 1200);
    assert.equal(charges.electric.units, 30);
    assert.equal(charges.electric.cost, 240);
    assert.equal(charges.water.units, 5);
    assert.equal(charges.water.cost, 100);
    assert.equal(charges.trash, 20);
  });

  // 11. Negative meter delta clamped
  it('clamps negative meter delta to 0 units (eNew < eOld)', async () => {
    const data = { ...DEFAULT_METER, eNew: 90 }; // delta=-10 → clamped to 0
    await capturedHandler(makeChange({ data }), makeCtx(DEFAULT_DOC_ID));
    assert.equal(capturedBillWrite.data.charges.electric.units, 0);
    assert.equal(capturedBillWrite.data.charges.electric.cost, 0);
  });

  // 12. Due-date non-December
  it('dueDate is 5th of the following month', async () => {
    // month=4 (April) → dueDate = 2026-05-05 (ceYear = 2569-543 = 2026)
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    assert.equal(capturedBillWrite.data.dueDate, '2026-05-05');
  });

  // 13. Due-date December wraparound
  it('dueDate wraps to 5 January of next CE year when month=12', async () => {
    const data = { building: 'rooms', roomId: '15', year: 69, month: 12,
                   eOld: 0, eNew: 10, wOld: 0, wNew: 2 };
    await capturedHandler(makeChange({ data }), makeCtx('rooms_69_12_15'));
    // ceYear = 2569-543 = 2026, month=12 → dueYear=2027, dueMonth=1
    assert.equal(capturedBillWrite.data.dueDate, '2027-01-05');
  });

  // 14. DEFAULTS fallback when no rooms_config
  it('falls back to DEFAULTS.rooms when rooms_config entry is absent', async () => {
    resetStubs({ roomCfg: null });  // rooms_config not found
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    assert.ok(capturedBillWrite);
    // DEFAULTS.rooms.rentPrice = 1200
    assert.equal(capturedBillWrite.data.charges.rent, 1200);
  });

  // 15. Custom room config
  it('uses custom room config rates when available', async () => {
    resetStubs({ roomCfg: { rentPrice: 2000, electricRate: 10, waterRate: 30, trashRate: 50 } });
    // eUnits=30×10=300; wUnits=5×30=150; total=2000+300+150+50=2500
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    assert.equal(capturedBillWrite.data.charges.rent, 2000);
    assert.equal(capturedBillWrite.data.totalCharge, 2500);
  });

  // 16. Success response shape
  it('returns { success: true, billId, total } on successful generation', async () => {
    const result = await capturedHandler(
      makeChange({ data: DEFAULT_METER }),
      makeCtx(DEFAULT_DOC_ID),
    );
    assert.equal(result.success, true);
    assert.equal(result.billId, 'TGH-256904-15');
    assert.equal(result.total, 1560);
  });

  // 17. Fixed metadata fields
  it('bill has generatedBy=auto_cf and status=pending', async () => {
    await capturedHandler(makeChange({ data: DEFAULT_METER }), makeCtx(DEFAULT_DOC_ID));
    assert.equal(capturedBillWrite.data.generatedBy, 'auto_cf');
    assert.equal(capturedBillWrite.data.status, 'pending');
    assert.equal(capturedBillWrite.data.building, 'rooms');
    assert.equal(capturedBillWrite.data.room, '15');
    assert.equal(capturedBillWrite.data.meterDocId, DEFAULT_DOC_ID);
  });
});
