/**
 * Unit tests for cleanupTenantsSSoT — Phase 6 cleanup of legacy tenant/lease paths.
 *
 * Covers:
 *   OPTIONS pre-flight, requireAdmin gate, invalid query params, dry-run and apply
 *   mode for all three tasks (top-level-dupes, tenant-id-docs, buildings-subobjects),
 *   task=all integration, ?building= filter, and response shape.
 *
 * Run: node --test functions/__tests__/cleanupTenantsSSoT.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────
// All mutable state lives here; resetStubs() is called in every beforeEach.

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    // requireAdmin: return value. null = admin gate passed; anything else short-circuits.
    adminDecoded: { uid: 'admin1', admin: true },
    // Firestore collections keyed by (collectionName, docId, subCollectionName)
    // tenants/{building}/list → array of { id, data }
    tenantsRoomsList: [],
    tenantsRentRoomList: [],
    tenantsNestList: [],
    tenantsNestAliasList: [],
    // buildings/{alias}/rooms → array of { id, data }
    buildingsRoomsRooms: [],
    buildingsRoomsRentRoom: [],
    buildingsRoomsNest: [],
    buildingsRoomsNestAlias: [],
    ...overrides,
  };
  captured = {
    updateCalls: [],   // { docPath, updates }
    deleteCalls: [],   // docPath strings
  };
}

resetStubs();

// ── FieldValue sentinel ───────────────────────────────────────────────────────
// FIELD_DELETE = admin.firestore.FieldValue.delete — accessed at MODULE LOAD TIME.
// The CF stores it as `const FIELD_DELETE = admin.firestore.FieldValue.delete;`
// and later calls `FIELD_DELETE()` to produce the sentinel value.

const fieldDeleteSentinel = '__delete__';

// ── Firestore stub factory ────────────────────────────────────────────────────

function makeDocRef(docPath, id, data) {
  return {
    id,
    data: () => data,
    ref: {
      update: async (updates) => {
        captured.updateCalls.push({ docPath: `${docPath}/${id}`, updates });
      },
      delete: async () => {
        captured.deleteCalls.push(`${docPath}/${id}`);
      },
    },
  };
}

function makeCollSnap(docs) {
  return {
    docs,
    forEach: (fn) => docs.forEach(fn),
    empty: docs.length === 0,
  };
}

// Map alias names to the correct stub array.
function getTenantsListDocs(alias) {
  switch (alias) {
    case 'rooms':    return stubState.tenantsRoomsList;
    case 'RentRoom': return stubState.tenantsRentRoomList;
    case 'nest':     return stubState.tenantsNestList;
    case 'Nest':     return stubState.tenantsNestAliasList;
    default:         return [];
  }
}

function getBuildingsRoomsDocs(alias) {
  switch (alias) {
    case 'rooms':    return stubState.buildingsRoomsRooms;
    case 'RentRoom': return stubState.buildingsRoomsRentRoom;
    case 'nest':     return stubState.buildingsRoomsNest;
    case 'Nest':     return stubState.buildingsRoomsNestAlias;
    default:         return [];
  }
}

// Single Firestore instance (returned each time admin.firestore() is called).
const firestoreInstance = {
  collection: (topLevel) => ({
    doc: (buildingAlias) => ({
      collection: (subColl) => ({
        get: async () => {
          if (topLevel === 'tenants' && subColl === 'list') {
            const rawDocs = getTenantsListDocs(buildingAlias);
            const docs = rawDocs.map(({ id, data }) =>
              makeDocRef(`tenants/${buildingAlias}/list`, id, data)
            );
            return makeCollSnap(docs);
          }
          if (topLevel === 'buildings' && subColl === 'rooms') {
            const rawDocs = getBuildingsRoomsDocs(buildingAlias);
            const docs = rawDocs.map(({ id, data }) =>
              makeDocRef(`buildings/${buildingAlias}/rooms`, id, data)
            );
            return makeCollSnap(docs);
          }
          return makeCollSnap([]);
        },
      }),
    }),
  }),
};

// ── Admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  // admin.firestore() → singleton instance; admin.firestore.FieldValue.delete → fn
  firestore: Object.assign(
    () => firestoreInstance,
    {
      FieldValue: {
        delete: () => fieldDeleteSentinel,
        increment: (n) => ({ __increment: n }),
        serverTimestamp: () => '__serverTimestamp__',
      },
    }
  ),
};

// ── requireAdmin stub ─────────────────────────────────────────────────────────
// Controlled per-test via stubState.adminDecoded.
// null  → gate passes (decoded returned to CF, CF continues)
// falsy → CF calls res.status(401).json() itself and requireAdmin already responded

let requireAdminStub = async (req, res) => {
  if (stubState.adminDecoded === null) {
    // Simulate requireAdmin having already responded; return null so CF returns early.
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return stubState.adminDecoded;
};

// ── Module._load intercept ────────────────────────────────────────────────────
// Must be installed BEFORE requiring the CF.

let capturedHandler = null;
const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        runWith: () => ({
          https: {
            onRequest: (fn) => {
              capturedHandler = fn;
              return fn;
            },
          },
        }),
      }),
    };
  }

  if (request === './_auth') {
    return {
      requireAdmin: (req, res) => requireAdminStub(req, res),
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// ── Load CF (inside before so stubs are wired first) ─────────────────────────

before(() => {
  delete require.cache[require.resolve('../cleanupTenantsSSoT.js')];
  require('../cleanupTenantsSSoT.js');
});

after(() => {
  Module._load = _origLoad;
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeRes() {
  const res = { _status: 200, _body: null };
  res.set = () => res;
  res.status = (code) => { res._status = code; return res; };
  res.json  = (body)  => { res._body  = body;  return res; };
  res.send  = (body)  => { res._body  = body;  return res; };
  return res;
}

function makeReq(query = {}, method = 'GET') {
  return { method, query };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — handler capture', () => {
  it('handler is captured after module load', () => {
    assert.equal(typeof capturedHandler, 'function',
      'onRequest handler must be captured');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Basic request handling
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — basic request handling', () => {
  beforeEach(() => resetStubs());

  it('OPTIONS → 204 with empty body', async () => {
    const req = makeReq({}, 'OPTIONS');
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 204);
  });

  it('requireAdmin returns null → short-circuits, no Firestore writes', async () => {
    stubState.adminDecoded = null;
    const req = makeReq({ mode: 'apply', task: 'all' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 401);
    assert.equal(captured.updateCalls.length, 0);
    assert.equal(captured.deleteCalls.length, 0);
  });

  it('invalid ?building value → 400 with error message', async () => {
    const req = makeReq({ building: 'amazon' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /building must be rooms or nest/);
  });

  it('invalid ?task value → 400 with error message', async () => {
    const req = makeReq({ task: 'unknown-task' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /task must be one of/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: top-level-dupes
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — task: top-level-dupes, dry-run', () => {
  beforeEach(() => resetStubs());

  it('doc with no dupe fields → logged as ✅, topLevelDupesCleared=0', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { name: 'สมชาย', status: 'active' } },
    ];
    const req = makeReq({ task: 'top-level-dupes' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.summary.topLevelDupesCleared, 0);
    assert.equal(res._body.summary.topLevelDupesScanned, 1);
    assert.ok(
      res._body.log.some(l => l.includes('no root dupes')),
      'log should mention no root dupes'
    );
  });

  it('doc with dupe field (deposit) → topLevelDupesCleared incremented', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { name: 'สมชาย', deposit: 5000, status: 'active' } },
    ];
    const req = makeReq({ task: 'top-level-dupes' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.topLevelDupesCleared, 1);
    assert.ok(
      res._body.log.some(l => l.includes('deposit')),
      'log should mention the deposit field'
    );
  });

  it('TENANT_* docs are skipped in top-level-dupes scan', async () => {
    stubState.tenantsRoomsList = [
      { id: 'TENANT_1234567890_15', data: { deposit: 999 } },
      { id: '15', data: { name: 'สมชาย' } },
    ];
    const req = makeReq({ task: 'top-level-dupes' });
    const res = makeRes();
    await capturedHandler(req, res);
    // Only the non-TENANT_ doc is scanned
    assert.equal(res._body.summary.topLevelDupesScanned, 1);
  });

  it('dry-run mode does not call d.ref.update', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { deposit: 5000, moveInDate: '2023-01-01' } },
    ];
    const req = makeReq({ task: 'top-level-dupes', mode: 'dry-run' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(captured.updateCalls.length, 0,
      'dry-run must not call update');
  });
});

describe('cleanupTenantsSSoT — task: top-level-dupes, apply mode', () => {
  beforeEach(() => resetStubs());

  it('apply mode: d.ref.update called with FieldValue.delete() for each dupe field', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { deposit: 5000, moveInDate: '2023-01-01', name: 'สมชาย' } },
    ];
    const req = makeReq({ task: 'top-level-dupes', mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'apply');
    // One update call for the rooms building
    const updateCall = captured.updateCalls.find(c =>
      c.docPath.includes('tenants/rooms/list/15')
    );
    assert.ok(updateCall, 'update must have been called for room 15');
    assert.equal(updateCall.updates.deposit, fieldDeleteSentinel,
      'deposit must be set to FieldValue.delete() sentinel');
    assert.equal(updateCall.updates.moveInDate, fieldDeleteSentinel,
      'moveInDate must be set to FieldValue.delete() sentinel');
    assert.ok(!('name' in updateCall.updates),
      'name is not a dupe field and must not be included in updates');
  });

  it('apply mode: docs with no dupe fields do not trigger an update call', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { name: 'สมชาย', status: 'active' } },
    ];
    const req = makeReq({ task: 'top-level-dupes', mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(captured.updateCalls.length, 0,
      'no update should be triggered when no dupe fields exist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: tenant-id-docs
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — task: tenant-id-docs, dry-run', () => {
  beforeEach(() => resetStubs());

  it('docs NOT matching /^TENANT_\\d+/ are skipped', async () => {
    stubState.tenantsRoomsList     = [{ id: '15', data: { name: 'สมชาย' } }];
    stubState.tenantsRentRoomList  = [{ id: '15', data: { name: 'สมชาย' } }];
    const req = makeReq({ task: 'tenant-id-docs' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.tenantIdDocsScanned, 0);
    assert.equal(res._body.summary.tenantIdDocsDeleted, 0);
  });

  it('docs matching TENANT_ pattern are logged and counted', async () => {
    stubState.tenantsRoomsList = [
      { id: 'TENANT_1620000000000_15', data: { name: 'สมชาย', firstName: '' } },
    ];
    const req = makeReq({ task: 'tenant-id-docs' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.tenantIdDocsScanned, 1);
    assert.equal(res._body.summary.tenantIdDocsDeleted, 1);
    assert.ok(
      res._body.log.some(l => l.includes('TENANT_1620000000000_15')),
      'log must mention the TENANT_ doc id'
    );
  });

  it('dry-run mode does not call d.ref.delete', async () => {
    stubState.tenantsRoomsList = [
      { id: 'TENANT_1620000000000_15', data: {} },
    ];
    const req = makeReq({ task: 'tenant-id-docs', mode: 'dry-run' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(captured.deleteCalls.length, 0,
      'dry-run must not call delete');
  });
});

describe('cleanupTenantsSSoT — task: tenant-id-docs, apply mode', () => {
  beforeEach(() => resetStubs());

  it('apply mode: d.ref.delete() called for each TENANT_ doc', async () => {
    stubState.tenantsRoomsList    = [{ id: 'TENANT_1620000000000_15', data: {} }];
    stubState.tenantsRentRoomList = [{ id: 'TENANT_1620000000000_15', data: {} }];
    const req = makeReq({ task: 'tenant-id-docs', mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'apply');
    // Both canonical + alias aliases are iterated for the rooms building
    assert.ok(
      captured.deleteCalls.some(p => p.includes('TENANT_1620000000000_15')),
      'delete must be called for the TENANT_ doc'
    );
  });

  it('apply mode: non-TENANT_ docs are not deleted', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { name: 'สมชาย' } },
      { id: 'TENANT_1620000000000_15', data: {} },
    ];
    const req = makeReq({ task: 'tenant-id-docs', mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.ok(
      !captured.deleteCalls.some(p => p.includes('/15')),
      'non-TENANT_ doc must not be deleted'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: buildings-subobjects
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — task: buildings-subobjects, dry-run', () => {
  beforeEach(() => resetStubs());

  it('room with no legacy fields → logged as ✅, buildingsRoomsCleared=0', async () => {
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { rentPrice: 4500, area: 28 } },
    ];
    stubState.buildingsRoomsRentRoom = [
      { id: '15', data: { rentPrice: 4500, area: 28 } },
    ];
    const req = makeReq({ task: 'buildings-subobjects' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.buildingsRoomsCleared, 0);
    assert.ok(
      res._body.log.some(l => l.includes('no legacy subobjects')),
      'log should mention no legacy subobjects'
    );
  });

  it('room with tenant/lease fields → logged and buildingsRoomsCleared incremented', async () => {
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { rentPrice: 4500, tenant: { name: 'สมชาย' }, lease: { deposit: 5000 } } },
    ];
    const req = makeReq({ task: 'buildings-subobjects' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.buildingsRoomsCleared, 1);
    assert.ok(
      res._body.log.some(l => l.includes('buildings/rooms/rooms/15')),
      'log must reference the room path'
    );
  });

  it('dry-run mode does not call d.ref.update', async () => {
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { tenant: { name: 'สมชาย' }, operations: {} } },
    ];
    const req = makeReq({ task: 'buildings-subobjects', mode: 'dry-run' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(captured.updateCalls.length, 0,
      'dry-run must not call update');
  });
});

describe('cleanupTenantsSSoT — task: buildings-subobjects, apply mode', () => {
  beforeEach(() => resetStubs());

  it('apply mode: update called with FieldValue.delete() for each legacy subobject field', async () => {
    stubState.buildingsRoomsRooms = [
      {
        id: '15',
        data: { rentPrice: 4500, tenant: { name: 'A' }, lease: {}, personalInfo: {}, area: 28 },
      },
    ];
    const req = makeReq({ task: 'buildings-subobjects', mode: 'apply', building: 'rooms' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'apply');
    const updateCall = captured.updateCalls.find(c =>
      c.docPath.includes('buildings/rooms/rooms/15')
    );
    assert.ok(updateCall, 'update must have been called for rooms/15');
    assert.equal(updateCall.updates.tenant, fieldDeleteSentinel);
    assert.equal(updateCall.updates.lease, fieldDeleteSentinel);
    assert.equal(updateCall.updates.personalInfo, fieldDeleteSentinel);
    assert.ok(!('rentPrice' in updateCall.updates),
      'rentPrice is a config field and must not be deleted');
    assert.ok(!('area' in updateCall.updates),
      'area is a config field and must not be deleted');
  });

  it('apply mode: rooms with no legacy fields do not trigger update', async () => {
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { rentPrice: 4500 } },
    ];
    const req = makeReq({ task: 'buildings-subobjects', mode: 'apply', building: 'rooms' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(captured.updateCalls.length, 0,
      'no update should be triggered for clean rooms');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: task=all
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — task: all (integration)', () => {
  beforeEach(() => resetStubs());

  it('task=all runs all three tasks and populates all summary counters', async () => {
    // Seed data for each task
    stubState.tenantsRoomsList = [
      { id: '15', data: { deposit: 5000, name: 'สมชาย' } },
      { id: 'TENANT_1620000000000_15', data: {} },
    ];
    stubState.tenantsRentRoomList = [
      { id: 'TENANT_1620000000000_15', data: {} },
    ];
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { tenant: { name: 'สมชาย' } } },
    ];
    const req = makeReq({ task: 'all' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.task, 'all');
    assert.equal(res._body.summary.topLevelDupesCleared,  1, 'task1 counter');
    assert.equal(res._body.summary.tenantIdDocsDeleted,   2, 'task2 counter (rooms + RentRoom aliases)');
    assert.equal(res._body.summary.buildingsRoomsCleared, 1, 'task3 counter');
  });

  it('task=all log contains section headers for all three tasks', async () => {
    const req = makeReq({ task: 'all' });
    const res = makeRes();
    await capturedHandler(req, res);
    const log = res._body.log;
    assert.ok(log.some(l => l.includes('top-level-dupes')),     'log must include task1 header');
    assert.ok(log.some(l => l.includes('tenant-id-docs')),      'log must include task2 header');
    assert.ok(log.some(l => l.includes('buildings-subobjects')), 'log must include task3 header');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ?building= filter
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — ?building= filter', () => {
  beforeEach(() => resetStubs());

  it('?building=rooms restricts top-level-dupes scan to rooms only (not nest)', async () => {
    stubState.tenantsRoomsList = [
      { id: '15', data: { deposit: 3000 } },
    ];
    stubState.tenantsNestList = [
      { id: 'N101', data: { deposit: 4000 } },
    ];
    const req = makeReq({ task: 'top-level-dupes', building: 'rooms' });
    const res = makeRes();
    await capturedHandler(req, res);
    // Only 1 rooms doc scanned, not the nest doc
    assert.equal(res._body.summary.topLevelDupesScanned, 1);
    assert.equal(res._body.summary.topLevelDupesCleared, 1);
  });

  it('?building=nest restricts buildings-subobjects scan to nest only', async () => {
    stubState.buildingsRoomsRooms = [
      { id: '15', data: { tenant: { name: 'ก' } } },
    ];
    stubState.buildingsRoomsNest = [
      { id: 'N101', data: { lease: {} } },
    ];
    const req = makeReq({ task: 'buildings-subobjects', building: 'nest' });
    const res = makeRes();
    await capturedHandler(req, res);
    // Only the nest room is scanned
    assert.equal(res._body.summary.buildingsRoomsCleared, 1);
    // The rooms building log entry should not appear
    assert.ok(
      !res._body.log.some(l => l.includes('buildings/rooms')),
      'rooms building must not appear in log when building=nest'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanupTenantsSSoT — response shape', () => {
  beforeEach(() => resetStubs());

  it('successful response has ok, mode, task, summary, and log fields', async () => {
    const req = makeReq({ task: 'top-level-dupes' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.ok, true);
    assert.ok(typeof body.mode    === 'string', 'mode must be a string');
    assert.ok(typeof body.task    === 'string', 'task must be a string');
    assert.ok(typeof body.summary === 'object', 'summary must be an object');
    assert.ok(Array.isArray(body.log),           'log must be an array');
  });

  it('default mode is dry-run when ?mode is omitted', async () => {
    const req = makeReq({ task: 'top-level-dupes' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'dry-run');
  });

  it('?mode=apply sets mode to apply in response', async () => {
    const req = makeReq({ task: 'top-level-dupes', mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'apply');
  });

  it('summary contains all six counter keys with numeric values', async () => {
    const req = makeReq({ task: 'all' });
    const res = makeRes();
    await capturedHandler(req, res);
    const expectedKeys = [
      'topLevelDupesScanned',  'topLevelDupesCleared',
      'tenantIdDocsScanned',   'tenantIdDocsDeleted',
      'buildingsRoomsScanned', 'buildingsRoomsCleared',
    ];
    for (const key of expectedKeys) {
      assert.ok(key in res._body.summary,                   `summary must have ${key}`);
      assert.ok(typeof res._body.summary[key] === 'number', `summary.${key} must be a number`);
    }
  });
});
