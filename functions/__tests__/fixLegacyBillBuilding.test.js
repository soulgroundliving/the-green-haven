/**
 * Unit tests for fixLegacyBillBuilding — one-shot RTDB migration HTTP endpoint.
 *
 * Covers: OPTIONS / non-POST guards, requireAdmin short-circuit, normalize()
 * behaviour (canonical-skip, path-mismatch-skip, needs-fix), dry-run vs apply
 * mode, sample collection (cap=5), and error handling.
 *
 * Run: node --test functions/__tests__/fixLegacyBillBuilding.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────
//
// rtdbState mirrors the RTDB tree: { [buildingPath]: { [roomId]: { [billId]: billObj } } }
// requireAdminReturn: null → short-circuit (as if requireAdmin wrote 401/403 itself)
//                    object → decoded token returned to handler

let rtdbState = {};
let requireAdminReturn = { uid: 'adminUid', email: 'admin@example.com', admin: true };

function resetStubs(overrides = {}) {
  rtdbState = overrides.rtdbState || {};
  requireAdminReturn = overrides.requireAdminReturn !== undefined
    ? overrides.requireAdminReturn
    : { uid: 'adminUid', email: 'admin@example.com', admin: true };
}
resetStubs();

// ── RTDB stub ─────────────────────────────────────────────────────────────────
//
// `writes` is module-level so we can reset it between tests and inspect
// across the full handler run.

let rtdbWrites = [];

function makeRtdbRef(path) {
  return {
    once: async (_event) => {
      // path is like 'bills/rooms' or 'bills/nest'
      // Split off 'bills/' prefix then walk the rest
      const parts = path.split('/');
      let node = rtdbState;
      for (const p of parts.slice(1)) {
        node = (node != null && typeof node === 'object') ? node[p] : null;
      }
      return { val: () => node != null ? node : null };
    },
    set: async (val) => {
      rtdbWrites.push({ path, val });
    },
  };
}

const rtdbInstance = { ref: (path) => makeRtdbRef(path) };

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => rtdbInstance,
  firestore: Object.assign(() => ({}), {
    FieldValue: { delete: () => ({ _type: 'FieldValue.delete' }) },
  }),
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────
//
// region().runWith().https.onRequest(handler) → captures handler

let capturedHandler = null;

const functionsStub = {
  region: () => ({
    runWith: () => ({
      https: {
        onRequest: (h) => { capturedHandler = h; return {}; },
      },
    }),
  }),
  https: {
    onRequest: (h) => { capturedHandler = h; return {}; },
  },
};

// ── Module._load intercept ────────────────────────────────────────────────────
//
// Must stay active for the lifetime of the test run because `requireAdmin`
// is lazy-required INSIDE the handler via require('./_auth').

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin')        return adminStub;
  if (request === 'firebase-functions/v1') return functionsStub;
  if (request === './_auth')               return { requireAdmin: async (req, res) => requireAdminReturn };
  return originalLoad.call(this, request, parent, isMain);
};

// ── Load CF under test ────────────────────────────────────────────────────────

before(() => {
  delete require.cache[require.resolve('../fixLegacyBillBuilding.js')];
  require('../fixLegacyBillBuilding.js');
  assert.ok(
    typeof capturedHandler === 'function',
    'capturedHandler must be a function — check the onRequest stub',
  );
});

after(() => {
  Module._load = originalLoad;
});

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    query: {},
    get: (_name) => '',
    ...overrides,
  };
}

function makeRes() {
  const r = { _status: null, _body: null };
  r.set = () => r;
  r.status = (code) => {
    r._status = code;
    return {
      json: (b) => { r._body = b; return r; },
      send: (b) => { r._body = b; return r; },
    };
  };
  return r;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

/** Seeds a single bill at bills/{buildingPath}/{roomId}/{billId}. */
function seedBill(buildingPath, roomId, billId, bill) {
  if (!rtdbState[buildingPath]) rtdbState[buildingPath] = {};
  if (!rtdbState[buildingPath][roomId]) rtdbState[buildingPath][roomId] = {};
  rtdbState[buildingPath][roomId][billId] = bill;
}

// ── Run helper ────────────────────────────────────────────────────────────────

async function run(reqOverrides = {}) {
  const req = makeReq(reqOverrides);
  const res = makeRes();
  await capturedHandler(req, res);
  return { req, res };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('fixLegacyBillBuilding', () => {
  beforeEach(() => {
    resetStubs();
    rtdbWrites = [];
  });

  // ── HTTP method guards ──────────────────────────────────────────────────────

  describe('HTTP method guards', () => {
    it('OPTIONS → 204 (CORS preflight)', async () => {
      const { res } = await run({ method: 'OPTIONS' });
      assert.equal(res._status, 204);
    });

    it('GET → 405', async () => {
      const { res } = await run({ method: 'GET' });
      assert.equal(res._status, 405);
    });

    it('PUT → 405', async () => {
      const { res } = await run({ method: 'PUT' });
      assert.equal(res._status, 405);
    });

    it('DELETE → 405', async () => {
      const { res } = await run({ method: 'DELETE' });
      assert.equal(res._status, 405);
    });

    it('405 response has { error: "POST only" }', async () => {
      const { res } = await run({ method: 'GET' });
      assert.ok(res._body && typeof res._body.error === 'string');
    });
  });

  // ── requireAdmin gate ───────────────────────────────────────────────────────

  describe('requireAdmin gate', () => {
    it('requireAdmin returns null → handler returns early, no RTDB reads', async () => {
      resetStubs({ requireAdminReturn: null });
      // Seed data so we can verify nothing was read
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run();
      // Response was written by requireAdmin stub itself (or handler returned early)
      // The important assertion: no RTDB reads or writes happened from handler logic
      assert.equal(rtdbWrites.length, 0, 'no RTDB writes when requireAdmin short-circuits');
      // No 200 response from handler logic
      assert.notEqual(res._status, 200, 'handler must not send 200 when requireAdmin returns null');
    });
  });

  // ── normalize() behaviour (tested via handler stats) ───────────────────────

  describe('normalize() — already-canonical bills are skipped', () => {
    it('bill.building === "rooms" → canonical=null → skipped (scanned++, wouldFix stays 0)', async () => {
      seedBill('rooms', '15', 'b1', { building: 'rooms' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0);
      assert.equal(res._body.fixed, 0);
    });

    it('bill.building === "nest" → canonical=null → skipped', async () => {
      seedBill('nest', 'N101', 'b1', { building: 'nest' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0);
    });

    it('bill.building is null → canonical=null → skipped (counts as scanned)', async () => {
      seedBill('rooms', '15', 'b1', { building: null });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0);
    });

    it('bill.building is undefined (field absent) → canonical=null → skipped', async () => {
      seedBill('rooms', '15', 'b1', {});
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0);
    });
  });

  describe('normalize() — legacy display-name bills need fixing', () => {
    it('rooms bill with building="เดอะ กรีน เฮฟเว่น" normalizes to "rooms" → wouldFix++', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 1);
    });

    it('nest bill with building="Nest · เดอะ กรีน เฮฟเว่น" (contains "nest") normalizes to "nest" → wouldFix++', async () => {
      seedBill('nest', 'N101', 'b1', { building: 'Nest · เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 1);
    });

    it('building value containing "nest" (case-insensitive) normalizes to "nest"', async () => {
      // "Nest Building" contains 'nest' → canonical 'nest'
      seedBill('nest', 'N102', 'b2', { building: 'Nest Building' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.wouldFix, 1);
      if (res._body.samples.length > 0) {
        assert.equal(res._body.samples[0].become, 'nest');
      }
    });

    it('building value without "nest" in it normalizes to "rooms"', async () => {
      // "The Green Haven (ห้องแถว)" does not contain 'nest' → canonical 'rooms'
      seedBill('rooms', '20', 'b3', { building: 'The Green Haven (ห้องแถว)' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.wouldFix, 1);
      if (res._body.samples.length > 0) {
        assert.equal(res._body.samples[0].become, 'rooms');
      }
    });
  });

  describe('normalize() — path-mismatch bills are skipped', () => {
    it('buildingPath="rooms" but building contains "nest" → canonical="nest" ≠ "rooms" → skip (wouldFix stays 0)', async () => {
      // Bill is stored under rooms/ path but its building value normalises to 'nest'
      seedBill('rooms', '15', 'b1', { building: 'Nest · เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0, 'path-mismatch should not increment wouldFix');
      assert.equal(res._body.fixed, 0);
    });

    it('buildingPath="nest" but building value normalizes to "rooms" → skip', async () => {
      // Stored under nest/ but building field has no 'nest' → normalises to 'rooms'
      seedBill('nest', 'N101', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 1);
      assert.equal(res._body.wouldFix, 0, 'path-mismatch bill under nest/ should be skipped');
    });
  });

  // ── Dry-run mode (default — no ?apply) ─────────────────────────────────────

  describe('dry-run mode (default)', () => {
    it('response has dryRun: true when ?apply is absent', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.dryRun, true);
    });

    it('wouldFix > 0 but fixed stays 0 in dry-run', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.wouldFix, 1);
      assert.equal(res._body.fixed, 0);
    });

    it('no RTDB .set() calls in dry-run', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      await run({ method: 'POST' });
      assert.equal(rtdbWrites.length, 0, 'dry-run must not write to RTDB');
    });
  });

  // ── Apply mode (?apply=1) ───────────────────────────────────────────────────

  describe('apply mode (?apply=1)', () => {
    it('response has dryRun: false when ?apply=1', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST', query: { apply: '1' } });
      assert.equal(res._body.dryRun, false);
    });

    it('response has dryRun: false when ?apply=true', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST', query: { apply: 'true' } });
      assert.equal(res._body.dryRun, false);
    });

    it('fixed is incremented for each written bill', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      seedBill('rooms', '16', 'b2', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST', query: { apply: '1' } });
      assert.equal(res._body.fixed, 2);
    });

    it('rtdb.ref().set() called with canonical value per fixed bill', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      await run({ method: 'POST', query: { apply: '1' } });
      assert.equal(rtdbWrites.length, 1);
      assert.equal(rtdbWrites[0].path, 'bills/rooms/15/b1/building');
      assert.equal(rtdbWrites[0].val, 'rooms');
    });

    it('nest bill: set() called with "nest" as canonical value', async () => {
      seedBill('nest', 'N101', 'b1', { building: 'Nest · เดอะ กรีน เฮฟเว่น' });
      await run({ method: 'POST', query: { apply: '1' } });
      assert.equal(rtdbWrites.length, 1);
      assert.equal(rtdbWrites[0].path, 'bills/nest/N101/b1/building');
      assert.equal(rtdbWrites[0].val, 'nest');
    });

    it('fixed + wouldFix both reflect the actual count in apply mode', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST', query: { apply: '1' } });
      assert.equal(res._body.wouldFix, 1);
      assert.equal(res._body.fixed, 1);
    });
  });

  // ── Samples collection ──────────────────────────────────────────────────────

  describe('samples collection', () => {
    it('samples array is empty when no bills need fixing', async () => {
      seedBill('rooms', '15', 'b1', { building: 'rooms' });
      const { res } = await run({ method: 'POST' });
      assert.deepEqual(res._body.samples, []);
    });

    it('sample entry has { path, was, become } shape', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.samples.length, 1);
      const s = res._body.samples[0];
      assert.ok('path' in s, 'sample must have path');
      assert.ok('was' in s, 'sample must have was');
      assert.ok('become' in s, 'sample must have become');
    });

    it('sample.was is the original building field value', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.samples[0].was, 'เดอะ กรีน เฮฟเว่น');
    });

    it('sample.become is the canonical id string', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.samples[0].become, 'rooms');
    });

    it('sample.path is "{buildingPath}/{roomId}/{billId}" (no bills/ prefix)', async () => {
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.samples[0].path, 'rooms/15/b1');
    });

    it('samples are capped at 5 even when more bills need fixing', async () => {
      // Seed 7 fixable bills across different rooms
      for (let i = 1; i <= 7; i++) {
        seedBill('rooms', String(i), `bill${i}`, { building: 'เดอะ กรีน เฮฟเว่น' });
      }
      const { res } = await run({ method: 'POST' });
      assert.ok(res._body.wouldFix >= 7, 'wouldFix must count all 7');
      assert.ok(res._body.samples.length <= 5, 'samples must be capped at 5');
    });
  });

  // ── Scanned counter ─────────────────────────────────────────────────────────

  describe('scanned counter', () => {
    it('scanned counts every bill object visited, regardless of outcome', async () => {
      // 1 fixable + 1 already canonical + 1 path-mismatch
      seedBill('rooms', '15', 'b1', { building: 'เดอะ กรีน เฮฟเว่น' });        // fixable
      seedBill('rooms', '16', 'b2', { building: 'rooms' });                       // canonical → skip
      seedBill('rooms', '17', 'b3', { building: 'Nest · เดอะ กรีน เฮฟเว่น' }); // path-mismatch → skip
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.scanned, 3);
    });

    it('scanned spans both buildingPaths (rooms + nest)', async () => {
      seedBill('rooms', '15', 'b1', { building: 'rooms' });
      seedBill('nest', 'N101', 'b2', { building: 'nest' });
      const { res } = await run({ method: 'POST' });
      assert.equal(res._body.scanned, 2);
    });

    it('empty RTDB → scanned=0, wouldFix=0, fixed=0', async () => {
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.scanned, 0);
      assert.equal(res._body.wouldFix, 0);
      assert.equal(res._body.fixed, 0);
    });
  });

  // ── Response shape ──────────────────────────────────────────────────────────

  describe('response shape', () => {
    it('200 success response contains { success, dryRun, scanned, wouldFix, fixed, samples }', async () => {
      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 200);
      assert.equal(res._body.success, true);
      assert.ok('dryRun'   in res._body, 'must have dryRun');
      assert.ok('scanned'  in res._body, 'must have scanned');
      assert.ok('wouldFix' in res._body, 'must have wouldFix');
      assert.ok('fixed'    in res._body, 'must have fixed');
      assert.ok('samples'  in res._body, 'must have samples');
    });

    it('samples is always an array', async () => {
      const { res } = await run({ method: 'POST' });
      assert.ok(Array.isArray(res._body.samples));
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('rtdb.ref().once() throws → 500 response with error message', async () => {
      // Override the rtdb singleton's ref to throw on once()
      const origRef = rtdbInstance.ref;
      rtdbInstance.ref = (path) => ({
        once: async () => { throw new Error('RTDB unavailable'); },
        set: async () => {},
      });

      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 500);
      assert.ok(res._body && typeof res._body.error === 'string', 'error field must be a string');

      rtdbInstance.ref = origRef;
    });

    it('500 body contains the error message string', async () => {
      const origRef = rtdbInstance.ref;
      rtdbInstance.ref = (path) => ({
        once: async () => { throw new Error('Connection refused'); },
        set: async () => {},
      });

      const { res } = await run({ method: 'POST' });
      assert.equal(res._status, 500);
      assert.match(res._body.error, /Connection refused/);

      rtdbInstance.ref = origRef;
    });
  });
});
