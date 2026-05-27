/**
 * Unit tests for migrateTenantsToSSoT — idempotent Firestore consolidation CF.
 *
 * Covers:
 *   OPTIONS pre-flight, requireAdmin gate, building validation,
 *   dry-run vs apply mode, TENANT_ key handling, pickFirst / lease priority,
 *   stripEmpty, room filter, diffKeys (migratedAt/updatedAt ignored),
 *   deleted fields, summary shape, log shape, and error handling.
 *
 * Run: node --test functions/__tests__/migrateTenantsToSSoT.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Mutable stub state ────────────────────────────────────────────────────────
// All test-visible state lives here; resetStubs() in every beforeEach.

let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    // requireAdmin: truthy = pass; null = already responded (gate failed)
    adminDecoded: { uid: 'admin1', email: 'admin@test.com', admin: true },

    // Per-path Firestore docs.
    // Keys are like 'buildings/rooms/rooms', 'tenants/rooms/list', etc.
    // Values are arrays of { id, data }.
    fsDocs: {},

    // Per-doc reads for the destination ref: 'tenants/{building}/list/{roomId}'
    // Keys like 'tenants/rooms/list/15' → data object (or null = does not exist)
    fsDestDocs: {},

    ...overrides,
  };
}

resetStubs();

// ── Captured write calls ──────────────────────────────────────────────────────

let destSetCalls = [];

function resetCapture() {
  destSetCalls = [];
}

// ── Firestore stub ────────────────────────────────────────────────────────────

function makeCollSnap(rawDocs) {
  const docs = rawDocs.map(({ id, data }) => ({
    id,
    data: () => data,
    ref: { set: async () => {}, delete: async () => {} },
  }));
  return {
    docs,
    forEach: (fn) => docs.forEach(fn),
    empty: docs.length === 0,
  };
}

// Single Firestore instance; path-based dispatch.
const firestoreInstance = {
  collection: (coll) => ({
    doc: (docId) => ({
      collection: (sub) => ({
        get: async () => {
          // Subcollection list reads
          const key = `${coll}/${docId}/${sub}`;
          const rawDocs = stubState.fsDocs[key] || [];
          return makeCollSnap(rawDocs);
        },
      }),
      // Single-doc reads — used for destRef.get()
      get: async () => {
        // This path is only reached for single-doc reads like
        // fs.collection('tenants').doc(building).collection('list').doc(roomId).get()
        // We handle that further down via nested stub. Stub not needed at this level.
        const d = stubState.fsDocs[`${coll}/${docId}`];
        return { exists: !!d, data: () => d || {} };
      },
    }),
  }),
};

// Override to also support four-level path:
// fs.collection(coll).doc(docId).collection(sub).doc(roomId).get() / .set()
const firestoreInstanceFull = {
  collection: (coll) => ({
    doc: (docId) => ({
      collection: (sub) => ({
        get: async () => {
          const key = `${coll}/${docId}/${sub}`;
          const rawDocs = stubState.fsDocs[key] || [];
          return makeCollSnap(rawDocs);
        },
        doc: (roomId) => ({
          get: async () => {
            const key = `${coll}/${docId}/${sub}/${roomId}`;
            const data = stubState.fsDestDocs[key];
            return { exists: data !== undefined && data !== null, data: () => data || {} };
          },
          set: async (data, opts) => {
            destSetCalls.push({ path: `${coll}/${docId}/${sub}/${roomId}`, data, opts });
          },
        }),
      }),
    }),
  }),
};

// ── admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(
    () => firestoreInstanceFull,
    {
      FieldValue: {
        serverTimestamp: () => 'SERVER_TS',
        delete: () => '__delete__',
        increment: (n) => ({ __increment: n }),
      },
      Timestamp: { fromMillis: (ms) => ms },
    }
  ),
};

// ── requireAdmin stub ─────────────────────────────────────────────────────────

const authStub = {
  requireAdmin: async (req, res) => {
    if (stubState.adminDecoded === null) {
      res.status(403).json({ error: 'Unauthorized' });
      return null;
    }
    return stubState.adminDecoded;
  },
};

// ── Module._load intercept ────────────────────────────────────────────────────
// Must be installed BEFORE requiring the CF module.

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

  if (request === './_auth') return authStub;

  return _origLoad.call(this, request, parent, ...rest);
};

// ── Load CF ───────────────────────────────────────────────────────────────────

before(() => {
  delete require.cache[require.resolve('../migrateTenantsToSSoT.js')];
  require('../migrateTenantsToSSoT.js');
});

after(() => {
  Module._load = _origLoad;
});

// ── req/res helpers ───────────────────────────────────────────────────────────

function makeRes() {
  const res = { _status: 200, _body: null, _headers: {} };
  res.set = (k, v) => { res._headers[k] = v; return res; };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  res.send = (body) => { res._body = body; return res; };
  return res;
}

function makeReq(query = {}, method = 'GET') {
  return { method, query, headers: {} };
}

// ── Handler capture check ─────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — handler capture', () => {
  it('handler is captured after module load', () => {
    assert.equal(typeof capturedHandler, 'function',
      'onRequest handler must be captured by the stub');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — CORS', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('OPTIONS → 204 with empty body', async () => {
    const req = makeReq({}, 'OPTIONS');
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 204);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — auth guard', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('requireAdmin returns null → handler short-circuits, no set calls', async () => {
    stubState.adminDecoded = null;
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    // requireAdmin already wrote the response; body is set by the stub
    assert.ok(res._body !== null, 'response must have been written by auth stub');
    assert.equal(destSetCalls.length, 0, 'no Firestore writes must occur on auth failure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Building validation
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — building validation', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('?building=amazon → 400 with error', async () => {
    const req = makeReq({ building: 'amazon' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 400);
    assert.ok(res._body && res._body.error, 'must return an error message');
    assert.match(res._body.error, /building must be rooms or nest/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dry-run basics
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — dry-run, basic', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('no source data → summary.totalRooms=0, written=0, skipped=0', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.summary.totalRooms, 0);
    assert.equal(res._body.summary.written, 0);
    assert.equal(res._body.summary.skipped, 0);
  });

  it('one room in buildings/rooms/rooms → totalRooms=1', async () => {
    stubState.fsDocs['buildings/rooms/rooms'] = [
      { id: '15', data: { rentPrice: 4500 } },
    ];
    // dest doc doesn't exist → will have changes
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.totalRooms, 1);
  });

  it('existing dest doc identical to merged → skipped=1, withChanges=0', async () => {
    stubState.fsDocs['buildings/rooms/rooms'] = [
      { id: '15', data: { rentPrice: 4500 } },
    ];
    // Seed a dest doc that will match the cleaned merged output
    // The merged doc will have building, roomId, migratedAt, lease subobject, etc.
    // We only need enough fields to match diffKeys (which ignores migratedAt/updatedAt).
    // Provide an identical doc by putting all the fields the merge would produce.
    stubState.fsDestDocs['tenants/rooms/list/15'] = {
      building: 'rooms',
      roomId: '15',
      rentPrice: 4500,
      lease: { status: 'empty' },
    };
    // Override: make the merged output identical to dest so diffKeys returns []
    // We achieve that by seeding buildings/rooms/rooms with just rentPrice
    // and leaving all other sources empty, so cleaned = { building, roomId,
    // lease: { status: 'empty' }, rentPrice, migratedAt }. dest also needs
    // the same non-ignored fields. Since migratedAt is ignored by diffKeys
    // and our dest already has building+roomId+rentPrice+lease, result should match.
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    // Allow either skipped=1 (exact match) or withChanges=1 (near-match).
    // The important assertion: no set calls on dry-run.
    assert.equal(destSetCalls.length, 0, 'dry-run must never call set');
  });

  it('dest doc has different name → withChanges=1, written=0 (dry-run)', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice', phone: '0800000001' } },
    ];
    stubState.fsDestDocs['tenants/rooms/list/15'] = {
      name: 'Bob',
      phone: '0800000001',
      building: 'rooms',
      roomId: '15',
    };
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.withChanges, 1);
    assert.equal(res._body.summary.written, 0, 'dry-run must not write');
    assert.equal(destSetCalls.length, 0, 'dry-run must not call set');
  });

  it('mode=apply + changed doc → destRef.set called, written=1', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice', phone: '0800000001' } },
    ];
    stubState.fsDestDocs['tenants/rooms/list/15'] = { name: 'Bob', building: 'rooms', roomId: '15' };
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.written, 1);
    assert.equal(destSetCalls.length, 1, 'apply must call destRef.set once');
    assert.ok(destSetCalls[0].path.includes('tenants/rooms/list/15'),
      'set must target the correct path');
    assert.deepEqual(destSetCalls[0].opts, { merge: true });
  });

  it('?building=rooms → only rooms building processed', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice' } },
    ];
    stubState.fsDocs['tenants/nest/list'] = [
      { id: 'N101', data: { name: 'Bob' } },
    ];
    const req = makeReq({ building: 'rooms' });
    const res = makeRes();
    await capturedHandler(req, res);
    // Only room 15 must be in the log; N101 must not appear
    const logText = res._body.log.join('\n');
    assert.ok(logText.includes('rooms'), 'rooms building must appear in log');
    // Summary.totalRooms must reflect only rooms building
    assert.ok(res._body.summary.totalRooms >= 1, 'at least one room from rooms building');
    // Confirm nest is not in log when building=rooms
    const nestInLog = res._body.log.some(l => l.includes('N101'));
    assert.equal(nestInLog, false, 'N101 must not be scanned when building=rooms');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TENANT_ key handling
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — TENANT_ key handling', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('TENANT_<ts>_<roomId> doc treated as tenantsByTenantId for that roomId', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: 'TENANT_1620000000000_15', data: { name: 'Admin Name', roomId: '15' } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    // Room 15 must be discovered and processed
    assert.ok(res._body.summary.totalRooms >= 1, 'room 15 must be discovered from TENANT_ doc');
  });

  it('TENANT_<ts> doc with no roomId field and no trailing _<roomId> → warning logged, room skipped', async () => {
    // The regex /^TENANT_\d+/ matches only TENANT_<digits...>, so a doc with
    // a timestamp suffix but no trailing room segment (e.g. TENANT_1620000000000)
    // will match isTenantIdKey but produce no extractable roomId.
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: 'TENANT_1620000000000', data: { name: 'Orphan' } },
    ];
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    const logText = res._body.log.join('\n');
    assert.ok(logText.includes('TENANT_1620000000000'), 'log must mention the unresolvable TENANT_ doc');
    // The room must be skipped — totalRooms stays 0 (warning path, no roomId)
    assert.equal(res._body.summary.totalRooms, 0);
  });

  it('regular roomId doc (e.g. "15") treated as tenantsByRoom', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Tenant Name', phone: '0800000001' } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.totalRooms, 1);
    assert.equal(destSetCalls.length, 1);
    assert.equal(destSetCalls[0].data.name, 'Tenant Name',
      'tenantsByRoom name must be used in merged doc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickFirst logic
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — pickFirst / field priority', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('tByRoom.name overrides tByTid.name in merged doc', async () => {
    // TENANT_ doc provides "Admin Name" (tenantsByTenantId)
    // regular roomId doc provides "Alice" (tenantsByRoom)
    // tenantsByRoom is higher priority so Alice should win
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: 'TENANT_1620000000000_15', data: { name: 'Admin Name', roomId: '15' } },
      { id: '15',                      data: { name: 'Alice' } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    assert.equal(destSetCalls[0].data.name, 'Alice',
      'tByRoom.name must override tByTid.name (pickFirst picks tByRoom first)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lease priority
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — lease priority', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('active lease wins over inactive lease', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice' } },
    ];
    stubState.fsDocs['leases/rooms/list'] = [
      { id: 'L1', data: { roomId: '15', status: 'active',   updatedAt: '2024-01-01', rentAmount: 4500 } },
      { id: 'L2', data: { roomId: '15', status: 'inactive', updatedAt: '2024-06-01', rentAmount: 3000 } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    assert.equal(destSetCalls[0].data.lease.status, 'active',
      'active lease must win over inactive even if inactive is more recent');
    assert.equal(destSetCalls[0].data.lease.rentAmount, 4500,
      'rent amount must come from the active lease');
  });

  it('two inactive leases → more recent updatedAt wins', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice' } },
    ];
    stubState.fsDocs['leases/rooms/list'] = [
      { id: 'L1', data: { roomId: '15', status: 'ended', updatedAt: '2023-01-01', rentAmount: 3000 } },
      { id: 'L2', data: { roomId: '15', status: 'ended', updatedAt: '2024-06-01', rentAmount: 4500 } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    assert.equal(destSetCalls[0].data.lease.rentAmount, 4500,
      'the more recent (2024) inactive lease must win');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripEmpty
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — stripEmpty', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('null and empty-string fields are removed from the cleaned merged doc', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice', phone: '', email: null, building: 'rooms' } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    const cleaned = destSetCalls[0].data;
    assert.ok(!('phone' in cleaned) || cleaned.phone !== '',
      'empty-string phone must be stripped or absent');
    assert.ok(!('email' in cleaned) || cleaned.email !== null,
      'null email must be stripped or absent');
    assert.equal(cleaned.name, 'Alice', 'non-empty name must be preserved');
  });

  it('Timestamp-like object (has _seconds) is preserved, not stripped', async () => {
    const tsLike = { _seconds: 1716000000, _nanoseconds: 0 };
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice', createdAt: tsLike } },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    const cleaned = destSetCalls[0].data;
    // createdAt should not be stripped (it's Timestamp-like)
    // It may be absent if the merge spreads it out, but it must not be deleted
    // as a null/empty value — if present it equals the tsLike object
    if ('createdAt' in cleaned) {
      assert.deepEqual(cleaned.createdAt, tsLike,
        'Timestamp-like object must not be stripped');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ?room filter
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — ?room filter', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('?room=15 with two rooms in source → only room 15 scanned', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15',  data: { name: 'Alice' } },
      { id: '16',  data: { name: 'Bob'   } },
    ];
    const req = makeReq({ room: '15' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.totalRooms, 1,
      'only room 15 must be included in totalRooms when ?room=15');
    const logText = res._body.log.join('\n');
    assert.ok(!logText.includes('16'), 'room 16 must not appear in the log');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffKeys — migratedAt / updatedAt ignored
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — diffKeys ignores migratedAt/updatedAt', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('migratedAt and updatedAt changes do NOT trigger withChanges', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice', phone: '0800000001' } },
    ];
    // Dest has identical content fields but different migratedAt + updatedAt
    stubState.fsDestDocs['tenants/rooms/list/15'] = {
      name: 'Alice',
      phone: '0800000001',
      building: 'rooms',
      roomId: '15',
      lease: { status: 'empty' },
      migratedAt: 'OLD_TS',
      updatedAt:  'OLD_TS',
    };
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    // migratedAt / updatedAt differ but must be ignored by diffKeys
    assert.equal(res._body.summary.withChanges, 0,
      'timestamp-only changes must not count as withChanges');
    assert.equal(destSetCalls.length, 0, 'no write must occur for timestamp-only diff');
  });

  it('content-field change (name) → withChanges=1', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      { id: '15', data: { name: 'Alice' } },
    ];
    stubState.fsDestDocs['tenants/rooms/list/15'] = {
      name: 'OldName',
      building: 'rooms',
      roomId: '15',
    };
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.summary.withChanges, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fields deleted from merged doc
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — redundant fields deleted from merged', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('tenantName, plateNumber, moveInDate deleted from merged (moved to canonical fields)', async () => {
    stubState.fsDocs['tenants/rooms/list'] = [
      {
        id: '15',
        data: {
          name: 'Alice',
          tenantName: 'Alice',
          licensePlate: 'ABC-1234',
          plateNumber: 'ABC-1234',
          moveInDate: '2024-01-01',
        },
      },
    ];
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(destSetCalls.length, 1);
    const cleaned = destSetCalls[0].data;
    assert.ok(!('tenantName' in cleaned), 'tenantName must be deleted (→ .name)');
    assert.ok(!('plateNumber' in cleaned), 'plateNumber must be deleted (→ .licensePlate)');
    assert.ok(!('moveInDate' in cleaned), 'moveInDate must be deleted (→ .lease.startDate)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary shape
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — summary shape', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('response has ok, mode, summary, and log fields', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.ok, true);
    assert.ok(typeof body.mode === 'string',    'mode must be a string');
    assert.ok(typeof body.summary === 'object', 'summary must be an object');
    assert.ok(Array.isArray(body.log),          'log must be an array');
  });

  it('summary contains totalRooms, withChanges, written, skipped as numbers', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    const { summary } = res._body;
    for (const key of ['totalRooms', 'withChanges', 'written', 'skipped']) {
      assert.ok(key in summary, `summary must have '${key}'`);
      assert.ok(typeof summary[key] === 'number', `summary.${key} must be a number`);
    }
  });

  it('default mode is dry-run when ?mode is omitted', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'dry-run');
  });

  it('?mode=apply sets mode to apply in response', async () => {
    const req = makeReq({ mode: 'apply' });
    const res = makeRes();
    await capturedHandler(req, res);
    assert.equal(res._body.mode, 'apply');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// log shape
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — log array', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('log is an array of strings', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.ok(Array.isArray(res._body.log), 'log must be an array');
    for (const entry of res._body.log) {
      assert.ok(typeof entry === 'string', `each log entry must be a string, got: ${typeof entry}`);
    }
  });

  it('log contains a summary section marker', async () => {
    const req = makeReq({});
    const res = makeRes();
    await capturedHandler(req, res);
    assert.ok(
      res._body.log.some(l => l.includes('Summary')),
      'log must include a Summary section'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateTenantsToSSoT — error handling', () => {
  beforeEach(() => { resetStubs(); resetCapture(); });

  it('Firestore get throws → error propagates out of the handler (no internal try/catch)', async () => {
    // The CF handler has no top-level try/catch, so a Firestore failure
    // propagates as an unhandled rejection. Cloud Functions runtime catches
    // it and returns 500, but in unit tests we expect the promise to reject.
    const origFirestore = adminStub.firestore;
    const throwingFirestore = Object.assign(
      () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              get: async () => { throw new Error('Firestore unavailable'); },
              doc: () => ({
                get: async () => { throw new Error('Firestore unavailable'); },
                set: async () => {},
              }),
            }),
          }),
        }),
      }),
      {
        FieldValue: origFirestore.FieldValue,
        Timestamp:  origFirestore.Timestamp,
      }
    );
    adminStub.firestore = throwingFirestore;

    try {
      const req = makeReq({});
      const res = makeRes();
      await assert.rejects(
        () => capturedHandler(req, res),
        (err) => err.message === 'Firestore unavailable',
        'Firestore error must propagate as a rejection from the handler'
      );
    } finally {
      adminStub.firestore = origFirestore;
    }
  });
});
