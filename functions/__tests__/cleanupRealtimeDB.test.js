/**
 * Unit tests for cleanupRealtimeDB — migration verification and RTDB cleanup HTTP handlers.
 *
 * Covers:
 *   verifyMigrationComplete: token gate, Firestore room counting, RTDB room counting,
 *     readyForCleanup logic, partial error paths, response shape.
 *   deleteRealtimeDBData: token gate, preview action, delete action, invalid action,
 *     remove() error path, response shape.
 *
 * Run: node --test functions/__tests__/cleanupRealtimeDB.test.js
 */
'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ─────────────────────────────────────────────────────────────────
let rtdbState = {};
let fsState = {};
let captured = {};

function resetStubs(overrides = {}) {
  rtdbState = {
    rooms: null,          // null = does not exist; object = exists with these keys
    rtdbGetError: null,
    rtdbRemoveError: null,
    removed: false,
    ...((overrides.rtdb) || {}),
  };
  fsState = {
    buildings: [],        // array of { id, rooms: <count> }
    fsGetError: null,
    fsRoomsGetError: null,
    ...((overrides.fs) || {}),
  };
  captured = {
    removeCalled: false,
  };
}
resetStubs();

// ── RTDB stub ──────────────────────────────────────────────────────────────────
const dbInstance = {
  ref: (path) => ({
    get: async () => {
      if (rtdbState.rtdbGetError) throw rtdbState.rtdbGetError;
      const val = path === 'data/rooms' ? rtdbState.rooms : null;
      return {
        exists: () => val != null,
        val: () => val,
      };
    },
    remove: async () => {
      if (rtdbState.rtdbRemoveError) throw rtdbState.rtdbRemoveError;
      captured.removeCalled = true;
      rtdbState.removed = true;
    },
  }),
};

// ── Firestore stub ─────────────────────────────────────────────────────────────
const fsInstance = {
  collection: (_name) => ({
    get: async () => {
      if (fsState.fsGetError) throw fsState.fsGetError;
      return {
        docs: fsState.buildings.map((b) => ({
          id: b.id,
          ref: {
            collection: (_sub) => ({
              get: async () => {
                if (fsState.fsRoomsGetError) throw fsState.fsRoomsGetError;
                return { size: typeof b.rooms === 'number' ? b.rooms : 0 };
              },
            }),
          },
        })),
      };
    },
  }),
};

// ── Admin stub ─────────────────────────────────────────────────────────────────
const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => dbInstance,
  firestore: Object.assign(() => fsInstance, {
    FieldValue: {},
    Timestamp: {},
  }),
};

// ── Module interception ────────────────────────────────────────────────────────
let capturedVerifyHandler = null;
let capturedDeleteHandler = null;

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    let httpCount = 0;
    return {
      region: () => ({
        https: {
          onRequest: (h) => {
            // Declaration order in cleanupRealtimeDB.js:
            //   1st onRequest → verifyMigrationComplete handler
            //   2nd onRequest → deleteRealtimeDBData handler
            if (httpCount === 0) {
              capturedVerifyHandler = h;
              httpCount++;
            } else {
              capturedDeleteHandler = h;
            }
            return {};
          },
        },
      }),
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// Force fresh load with mocks in place.
delete require.cache[require.resolve('../cleanupRealtimeDB.js')];
require('../cleanupRealtimeDB.js');

after(() => { Module._load = _origLoad; });

// ── Request / response helpers ─────────────────────────────────────────────────
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; };
  return res;
}

function makeReq(query = {}) {
  return { query };
}

// ── Setup ──────────────────────────────────────────────────────────────────────
before(() => {
  process.env.MIGRATION_TOKEN = 'test-migrate-token';
  process.env.CLEANUP_TOKEN = 'test-cleanup-token';
});

// ── Handler capture ────────────────────────────────────────────────────────────
describe('handler capture', () => {
  it('verifyMigrationComplete handler is captured', () => {
    assert.equal(typeof capturedVerifyHandler, 'function',
      'verifyMigrationComplete onRequest handler must be captured');
  });

  it('deleteRealtimeDBData handler is captured', () => {
    assert.equal(typeof capturedDeleteHandler, 'function',
      'deleteRealtimeDBData onRequest handler must be captured');
  });
});

// ── verifyMigrationComplete ────────────────────────────────────────────────────
describe('verifyMigrationComplete — token gate', () => {
  beforeEach(() => resetStubs());

  it('MIGRATION_TOKEN not set → 500 Server misconfigured', async () => {
    const saved = process.env.MIGRATION_TOKEN;
    delete process.env.MIGRATION_TOKEN;
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'any' }), res);
    process.env.MIGRATION_TOKEN = saved;
    assert.equal(res._status, 500);
    assert.match(res._body.error, /Server misconfigured/);
  });

  it('wrong token → 403 Unauthorized', async () => {
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'wrong-token' }), res);
    assert.equal(res._status, 403);
    assert.match(res._body.error, /Unauthorized/);
  });

  it('missing token (no query.token) → 403 Unauthorized', async () => {
    const res = makeRes();
    await capturedVerifyHandler(makeReq({}), res);
    assert.equal(res._status, 403);
    assert.match(res._body.error, /Unauthorized/);
  });
});

describe('verifyMigrationComplete — Firestore room counting', () => {
  beforeEach(() => resetStubs());

  it('no buildings → stats.firestoreRooms is 0', async () => {
    fsState.buildings = [];
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.stats.firestoreRooms, 0);
  });

  it('one building with 15 rooms → stats.firestoreRooms is 15', async () => {
    fsState.buildings = [{ id: 'rooms', rooms: 15 }];
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.firestoreRooms, 15);
  });

  it('two buildings with rooms → firestoreRooms is the sum across buildings', async () => {
    fsState.buildings = [
      { id: 'rooms', rooms: 33 },
      { id: 'nest', rooms: 10 },
    ];
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.firestoreRooms, 43);
  });

  it('Firestore collection().get() throws → warning added to stats.warnings, response still 200', async () => {
    fsState.fsGetError = new Error('Firestore unavailable');
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._status, 200);
    assert.ok(Array.isArray(res._body.stats.warnings));
    assert.ok(
      res._body.stats.warnings.some((w) => /Firestore/i.test(w)),
      'A Firestore-related warning must be recorded',
    );
  });
});

describe('verifyMigrationComplete — RTDB room counting', () => {
  beforeEach(() => resetStubs());

  it('RTDB data/rooms does not exist → stats.realtimeRooms is 0', async () => {
    rtdbState.rooms = null;
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.realtimeRooms, 0);
  });

  it('RTDB data/rooms has 5 keys → stats.realtimeRooms is 5', async () => {
    rtdbState.rooms = { '1': {}, '2': {}, '3': {}, '4': {}, '5': {} };
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.realtimeRooms, 5);
  });

  it('RTDB db.ref().get() throws → warning added to stats.warnings, response still 200', async () => {
    rtdbState.rtdbGetError = new Error('RTDB quota exceeded');
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._status, 200);
    assert.ok(
      res._body.stats.warnings.some((w) => /Realtime/i.test(w) || /RTDB/i.test(w)),
      'An RTDB-related warning must be recorded',
    );
  });
});

describe('verifyMigrationComplete — readyForCleanup logic', () => {
  beforeEach(() => resetStubs());

  it('firestoreRooms >= 43 AND realtimeRooms > 0 → readyForCleanup is true', async () => {
    fsState.buildings = [{ id: 'rooms', rooms: 43 }];
    rtdbState.rooms = { '1': {} };
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.readyForCleanup, true);
  });

  it('firestoreRooms < 43 → readyForCleanup is false even when realtimeRooms > 0', async () => {
    fsState.buildings = [{ id: 'rooms', rooms: 42 }];
    rtdbState.rooms = { '1': {}, '2': {} };
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.readyForCleanup, false);
  });

  it('firestoreRooms >= 43 but realtimeRooms is 0 → readyForCleanup is false', async () => {
    fsState.buildings = [{ id: 'rooms', rooms: 50 }];
    rtdbState.rooms = null;
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._body.stats.readyForCleanup, false);
  });
});

describe('verifyMigrationComplete — response shape', () => {
  beforeEach(() => resetStubs());

  it('success response has { success: true, message, stats, timestamp }', async () => {
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.success, true);
    assert.equal(typeof body.message, 'string');
    assert.ok(body.stats && typeof body.stats === 'object');
    assert.equal(typeof body.timestamp, 'string');
  });

  it('stats object contains firestoreRooms, realtimeRooms, readyForCleanup, warnings', async () => {
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    const { stats } = res._body;
    assert.ok('firestoreRooms' in stats, 'stats.firestoreRooms must be present');
    assert.ok('realtimeRooms' in stats, 'stats.realtimeRooms must be present');
    assert.ok('readyForCleanup' in stats, 'stats.readyForCleanup must be present');
    assert.ok(Array.isArray(stats.warnings), 'stats.warnings must be an array');
  });

  it('timestamp is a valid ISO date string', async () => {
    const res = makeRes();
    await capturedVerifyHandler(makeReq({ token: 'test-migrate-token' }), res);
    const ts = res._body.timestamp;
    assert.ok(!isNaN(Date.parse(ts)), `timestamp "${ts}" must be parseable as a date`);
  });
});

// ── deleteRealtimeDBData ───────────────────────────────────────────────────────
describe('deleteRealtimeDBData — token gate', () => {
  beforeEach(() => resetStubs());

  it('CLEANUP_TOKEN not set → 500 Server misconfigured', async () => {
    const saved = process.env.CLEANUP_TOKEN;
    delete process.env.CLEANUP_TOKEN;
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'any' }), res);
    process.env.CLEANUP_TOKEN = saved;
    assert.equal(res._status, 500);
    assert.match(res._body.error, /Server misconfigured/);
  });

  it('wrong token → 403 Unauthorized', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'bad-token' }), res);
    assert.equal(res._status, 403);
    assert.match(res._body.error, /Unauthorized/);
  });

  it('missing token → 403 Unauthorized', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({}), res);
    assert.equal(res._status, 403);
    assert.match(res._body.error, /Unauthorized/);
  });
});

describe('deleteRealtimeDBData — preview action', () => {
  beforeEach(() => resetStubs());

  it('default action (no ?action) → preview mode, remove() is NOT called', async () => {
    rtdbState.rooms = { '1': {}, '2': {}, '3': {} };
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token' }), res);
    assert.equal(res._status, 200);
    assert.equal(captured.removeCalled, false, 'remove() must NOT be called in preview mode');
  });

  it('?action=preview → success with message "Preview only..."', async () => {
    rtdbState.rooms = { '1': {}, '2': {} };
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.match(res._body.message, /Preview only/);
  });

  it('?action=preview with rooms → stats.roomsDeleted equals room count', async () => {
    rtdbState.rooms = { '10': {}, '11': {}, '12': {}, '13': {}, '14': {} };
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(res._body.stats.roomsDeleted, 5);
  });

  it('?action=preview with no RTDB data → stats.roomsDeleted is 0', async () => {
    rtdbState.rooms = null;
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(res._body.stats.roomsDeleted, 0);
    assert.equal(captured.removeCalled, false);
  });

  it('preview response includes nextStep hint', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(typeof res._body.nextStep, 'string');
    assert.ok(res._body.nextStep.length > 0, 'nextStep must be a non-empty string');
  });
});

describe('deleteRealtimeDBData — delete action', () => {
  beforeEach(() => resetStubs());

  it('?action=delete → db.ref("data/rooms").remove() is called', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'delete' }), res);
    assert.equal(captured.removeCalled, true, 'remove() must be called in delete mode');
  });

  it('?action=delete → response message contains "Old Realtime Database data deleted"', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'delete' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.match(res._body.message, /Old Realtime Database data deleted/);
  });

  it('?action=delete → remove() throws → 500 with success: false', async () => {
    rtdbState.rtdbRemoveError = new Error('Permission denied on remove');
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'delete' }), res);
    assert.equal(res._status, 500);
    assert.equal(res._body.success, false);
  });
});

describe('deleteRealtimeDBData — invalid action', () => {
  beforeEach(() => resetStubs());

  it('?action=nuke → 400 Invalid action', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'nuke' }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /Invalid action/);
  });

  it('?action=purge → 400 Invalid action', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'purge' }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /Invalid action/);
  });
});

describe('deleteRealtimeDBData — response shape', () => {
  beforeEach(() => resetStubs());

  it('preview response has { success, message, stats, nextStep }', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    const body = res._body;
    assert.equal(typeof body.success, 'boolean');
    assert.equal(typeof body.message, 'string');
    assert.ok(body.stats && typeof body.stats === 'object');
    assert.equal(typeof body.nextStep, 'string');
  });

  it('delete response has { success, message, stats }', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'delete' }), res);
    const body = res._body;
    assert.equal(typeof body.success, 'boolean');
    assert.equal(typeof body.message, 'string');
    assert.ok(body.stats && typeof body.stats === 'object');
  });

  it('stats.action mirrors the requested action', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(res._body.stats.action, 'preview');
  });

  it('stats.dataPath is "data/rooms"', async () => {
    const res = makeRes();
    await capturedDeleteHandler(makeReq({ token: 'test-cleanup-token', action: 'preview' }), res);
    assert.equal(res._body.stats.dataPath, 'data/rooms');
  });
});
