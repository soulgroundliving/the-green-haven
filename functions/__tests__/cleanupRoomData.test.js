/**
 * Unit tests for cleanupRoomData — RTDB room data cleanup and analysis HTTP handlers.
 *
 * Covers:
 *   cleanupRoomData: token auth gate, OPTIONS bypass, room processing,
 *   property stripping, batch update, error propagation.
 *   analyzeRoomData: no-auth, response shape, totalRooms, willRemove,
 *   error propagation.
 *
 * Run: node --test functions/__tests__/cleanupRoomData.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────
let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    rooms: {
      '15': {
        tenantName: 'สมชาย',
        email: 'a@b.com',
        contractEndDate: '2025-01-01',
        lineId: 'U123',
        status: 'active',
      },
    },
    rtdbReadError: null,
    rtdbUpdateError: null,
    ...overrides,
  };
  captured = {
    updateCalls: [],
  };
}
resetStubs();

// ── RTDB stub — created once at module-load time (singleton via admin.database()) ──
const rtdbStub = {
  ref: (path = '') => ({
    once: async (_event) => {
      if (stubState.rtdbReadError) throw stubState.rtdbReadError;
      // Only 'data/rooms' returns room data; root ref returns empty object.
      const val = path === 'data/rooms' ? stubState.rooms : {};
      return { val: () => val };
    },
    update: async (updates) => {
      if (stubState.rtdbUpdateError) throw stubState.rtdbUpdateError;
      captured.updateCalls.push(updates);
    },
  }),
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => rtdbStub,
};

// ── Module interception ───────────────────────────────────────────────────────
let capturedCleanupHandler = null;
let capturedAnalyzeHandler = null;

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        https: {
          onRequest: (fn) => {
            // Declaration order in cleanupRoomData.js:
            //   1st onRequest → cleanupRoomData handler
            //   2nd onRequest → analyzeRoomData handler
            if (!capturedCleanupHandler) {
              capturedCleanupHandler = fn;
            } else if (!capturedAnalyzeHandler) {
              capturedAnalyzeHandler = fn;
            }
            return fn;
          },
        },
      }),
    };
  }

  return _origLoad.apply(this, arguments);
};

// Force fresh load with mocks in place.
delete require.cache[require.resolve('../cleanupRoomData.js')];
require('../cleanupRoomData.js');

after(() => { Module._load = _origLoad; });

// ── Request / response helpers ────────────────────────────────────────────────
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; };
  return res;
}

function makeReq(overrides = {}) {
  return { method: 'GET', query: {}, ...overrides };
}

// ── cleanupRoomData tests ─────────────────────────────────────────────────────
describe('cleanupRoomData — handler capture', () => {
  it('both cleanupRoomData and analyzeRoomData handlers are captured', () => {
    assert.equal(typeof capturedCleanupHandler, 'function',
      'cleanupRoomData onRequest handler must be captured');
    assert.equal(typeof capturedAnalyzeHandler, 'function',
      'analyzeRoomData onRequest handler must be captured');
  });
});

describe('cleanupRoomData — auth gate', () => {
  beforeEach(() => {
    resetStubs();
    process.env.CLEANUP_TOKEN = 'secret';
  });

  it('missing token → 403 Unauthorized', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 403);
    assert.equal(res._body.error, 'Unauthorized');
  });

  it('wrong token → 403 Unauthorized', async () => {
    const req = makeReq({ query: { token: 'wrong' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 403);
    assert.equal(res._body.error, 'Unauthorized');
  });

  it('OPTIONS method bypasses token check and proceeds to success', async () => {
    // No token supplied but method is OPTIONS — auth check should be skipped.
    const req = makeReq({ method: 'OPTIONS', query: {} });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
  });

  it('correct token → 200 success with success: true', async () => {
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
    assert.equal(res._body.message, 'Room data cleanup completed');
  });
});

describe('cleanupRoomData — room processing', () => {
  beforeEach(() => {
    resetStubs();
    process.env.CLEANUP_TOKEN = 'secret';
  });

  it('roomsProcessed count matches number of rooms in stub', async () => {
    stubState.rooms = {
      '10': { tenantName: 'ก', email: 'g@h.com', status: 'active' },
      '11': { tenantName: 'ข', email: 'i@j.com', status: 'vacant' },
      '12': { tenantName: 'ค', email: 'k@l.com', status: 'active' },
    };
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._body.roomsProcessed, 3);
  });

  it('propertiesRemoved counts properties matching PROPERTIES_TO_REMOVE across all rooms', async () => {
    // Room 15 already has contractEndDate + lineId in resetStubs default.
    // Add a second room with additional removable props.
    stubState.rooms = {
      '15': {
        tenantName: 'สมชาย',
        email: 'a@b.com',
        contractEndDate: '2025-01-01',  // removable
        lineId: 'U123',                 // removable
        status: 'active',
      },
      '16': {
        tenantName: 'สมหญิง',
        email: 'c@d.com',
        contractStartDate: '2024-01-01', // removable
        waterMeterStart: '0',            // removable
        status: 'active',
      },
    };
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    // Room 15: contractEndDate + lineId = 2; Room 16: contractStartDate + waterMeterStart = 2 → total 4
    assert.equal(res._body.propertiesRemoved, 4);
  });

  it('cleaned rooms contain only PROPERTIES_TO_KEEP: contractEndDate stripped, email kept', async () => {
    // Default stub has room 15 with email (keep) + contractEndDate + lineId (strip).
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(captured.updateCalls.length, 1,
      'db.ref().update() should have been called exactly once');
    const writtenRoom = captured.updateCalls[0]['data/rooms/15'];
    assert.ok(writtenRoom, 'update must include data/rooms/15 key');
    assert.ok(!('contractEndDate' in writtenRoom),
      'contractEndDate must be stripped from the cleaned room');
    assert.ok(!('lineId' in writtenRoom),
      'lineId must be stripped from the cleaned room');
    assert.ok('email' in writtenRoom,
      'email must be kept in the cleaned room');
    assert.equal(writtenRoom.email, 'a@b.com');
    assert.ok('tenantName' in writtenRoom,
      'tenantName must be kept in the cleaned room');
    assert.equal(writtenRoom.status, 'active');
  });

  it('null roomData entries are skipped and not included in updates', async () => {
    stubState.rooms = {
      '15': null,
      '16': { tenantName: 'ทดสอบ', email: 'x@y.com', status: 'active' },
    };
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._body.roomsProcessed, 1);
    const updates = captured.updateCalls[0];
    assert.ok(!('data/rooms/15' in updates), 'null room must be skipped');
    assert.ok('data/rooms/16' in updates, 'valid room must be included');
  });

  it('RTDB read error → 500 with error: Cleanup failed', async () => {
    stubState.rtdbReadError = new Error('RTDB unavailable');
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 500);
    assert.equal(res._body.error, 'Cleanup failed');
    assert.equal(res._body.message, 'RTDB unavailable');
  });

  it('RTDB update error → 500 with error: Cleanup failed', async () => {
    stubState.rtdbUpdateError = new Error('Write quota exceeded');
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._status, 500);
    assert.equal(res._body.error, 'Cleanup failed');
    assert.equal(res._body.message, 'Write quota exceeded');
  });

  it('empty rooms object → roomsProcessed 0 and update called with empty object', async () => {
    stubState.rooms = {};
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.equal(res._body.success, true);
    assert.equal(res._body.roomsProcessed, 0);
    assert.equal(res._body.propertiesRemoved, 0);
    // db.ref().update({}) should still be called.
    assert.equal(captured.updateCalls.length, 1);
    assert.deepEqual(captured.updateCalls[0], {});
  });

  it('response includes removedProperties and keptProperties arrays', async () => {
    const req = makeReq({ query: { token: 'secret' } });
    const res = makeRes();
    await capturedCleanupHandler(req, res);
    assert.ok(Array.isArray(res._body.removedProperties),
      'removedProperties must be an array');
    assert.ok(Array.isArray(res._body.keptProperties),
      'keptProperties must be an array');
    assert.ok(res._body.removedProperties.includes('contractEndDate'));
    assert.ok(res._body.removedProperties.includes('lineId'));
    assert.ok(res._body.keptProperties.includes('email'));
    assert.ok(res._body.keptProperties.includes('status'));
  });
});

// ── analyzeRoomData tests ─────────────────────────────────────────────────────
describe('analyzeRoomData — no auth required', () => {
  beforeEach(() => {
    resetStubs();
    // analyzeRoomData has no token check so we omit process.env.CLEANUP_TOKEN.
  });

  it('no auth required — no query.token needed, returns 200 success: true', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.success, true);
  });

  it('response contains success, analysis object, willRemove, willKeep, and timestamp', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    const body = res._body;
    assert.ok(body.success === true, 'success must be true');
    assert.ok(body.analysis && typeof body.analysis === 'object',
      'analysis must be an object');
    assert.ok(Array.isArray(body.willRemove), 'willRemove must be an array');
    assert.ok(Array.isArray(body.willKeep), 'willKeep must be an array');
    assert.ok(typeof body.timestamp === 'string', 'timestamp must be a string');
  });

  it('analysis.totalRooms equals number of rooms in stub', async () => {
    stubState.rooms = {
      '10': { tenantName: 'ก', lineId: 'U1', status: 'active' },
      '11': { tenantName: 'ข', contractEndDate: '2025-01-01', status: 'active' },
      '12': { tenantName: 'ค', status: 'vacant' },
    };
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    assert.equal(res._body.analysis.totalRooms, 3);
  });

  it('willRemove list includes known removable properties', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    const willRemove = res._body.willRemove;
    assert.ok(willRemove.includes('contractEndDate'),
      'contractEndDate must appear in willRemove');
    assert.ok(willRemove.includes('lineId'),
      'lineId must appear in willRemove');
    assert.ok(willRemove.includes('notes'),
      'notes must appear in willRemove');
  });

  it('RTDB read error → 500 with error: Analysis failed', async () => {
    stubState.rtdbReadError = new Error('Connection timeout');
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    assert.equal(res._status, 500);
    assert.equal(res._body.error, 'Analysis failed');
    assert.equal(res._body.message, 'Connection timeout');
  });

  it('rooms with removable props → estimatedBytesSaved is greater than 0', async () => {
    // Room 15 has contractEndDate and lineId — both removable — so bytes saved > 0.
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    assert.ok(res._body.analysis.estimatedBytesSaved > 0,
      'estimatedBytesSaved must be positive when rooms have removable properties');
  });

  it('analysis.firstRoomExample is set when a room has removable properties', async () => {
    // Default stub room 15 has contractEndDate and lineId — both removable.
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    const example = res._body.analysis.firstRoomExample;
    assert.ok(example !== null && example !== undefined,
      'firstRoomExample must be set when at least one room has removable props');
    assert.ok('roomId' in example, 'firstRoomExample must have roomId');
    assert.ok(Array.isArray(example.removedProperties),
      'firstRoomExample.removedProperties must be an array');
    assert.ok(example.removedProperties.length > 0,
      'firstRoomExample.removedProperties must be non-empty');
  });

  it('rooms with no removable properties → firstRoomExample is null/undefined', async () => {
    // Room with only PROPERTIES_TO_KEEP fields — nothing to remove.
    stubState.rooms = {
      '20': { tenantName: 'สมชาย', email: 'a@b.com', status: 'active' },
    };
    const req = makeReq({ query: {} });
    const res = makeRes();
    await capturedAnalyzeHandler(req, res);
    const example = res._body.analysis.firstRoomExample;
    // No removable props means the example is never set (stays undefined).
    assert.ok(example === null || example === undefined,
      'firstRoomExample must be null/undefined when no room has removable props');
  });
});
