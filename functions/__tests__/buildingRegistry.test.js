/**
 * Unit tests for buildingRegistry — CF-side building registry that reads
 * `buildings` Firestore collection via Admin SDK, caches in-memory for 5 min,
 * and falls back to ['rooms', 'nest'] on error or empty collection.
 *
 * Run: node --test functions/__tests__/buildingRegistry.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    // Array of { id, data } objects representing Firestore building docs
    buildingDocs: [
      { id: 'rooms', data: { status: 'active' } },
      { id: 'nest',  data: { status: 'active' } },
    ],
    firestoreError: null,
    ...overrides,
  };
}
resetStubs();

// ── Firestore snapshot helper ─────────────────────────────────────────────────

function makeSnapshot(docs) {
  return {
    forEach: (cb) => docs.forEach(doc => cb({ id: doc.id, data: () => doc.data })),
  };
}

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({
    collection: (_name) => ({
      get: async () => {
        if (stubState.firestoreError) throw stubState.firestoreError;
        return makeSnapshot(stubState.buildingDocs);
      },
    }),
  }),
};

// ── Module._load intercept (must happen BEFORE require('../buildingRegistry')) ─

const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  return _origLoad.apply(this, arguments);
};

// Load the module under test after stubs are installed
delete require.cache[require.resolve('../buildingRegistry.js')];
const { getAllBuildings, getValidBuildings, clearCache, STATIC_FALLBACK } = require('../buildingRegistry.js');

after(() => { Module._load = _origLoad; });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildingRegistry', () => {
  beforeEach(() => {
    resetStubs();
    clearCache();
  });

  // ── STATIC_FALLBACK constant ──────────────────────────────────────────────

  describe('STATIC_FALLBACK', () => {
    it("is ['rooms', 'nest']", () => {
      assert.deepEqual(STATIC_FALLBACK, ['rooms', 'nest']);
    });
  });

  // ── getAllBuildings — happy path ───────────────────────────────────────────

  describe('getAllBuildings — happy path', () => {
    it("returns ['rooms', 'nest'] when Firestore has those two active docs", async () => {
      const result = await getAllBuildings();
      assert.ok(Array.isArray(result), 'result must be an array');
      assert.equal(result.length, 2);
      assert.ok(result.includes('rooms'));
      assert.ok(result.includes('nest'));
    });
  });

  // ── getValidBuildings ─────────────────────────────────────────────────────

  describe('getValidBuildings', () => {
    it('returns a Set instance', async () => {
      const result = await getValidBuildings();
      assert.ok(result instanceof Set, 'getValidBuildings must return a Set');
    });

    it("returned Set contains 'rooms' and 'nest'", async () => {
      const result = await getValidBuildings();
      assert.ok(result.has('rooms'), "Set must contain 'rooms'");
      assert.ok(result.has('nest'),  "Set must contain 'nest'");
    });
  });

  // ── Firestore error / empty collection fallback ───────────────────────────

  describe('fallback behaviour', () => {
    it('Firestore error → falls back to STATIC_FALLBACK', async () => {
      stubState.firestoreError = new Error('Firestore unavailable');
      const result = await getAllBuildings();
      assert.deepEqual(result, STATIC_FALLBACK);
    });

    it('empty collection (buildingDocs: []) → falls back to STATIC_FALLBACK', async () => {
      stubState.buildingDocs = [];
      const result = await getAllBuildings();
      assert.deepEqual(result, STATIC_FALLBACK);
    });
  });

  // ── Status filtering ──────────────────────────────────────────────────────

  describe('status filtering', () => {
    it("archived building is excluded (status: 'archived')", async () => {
      stubState.buildingDocs = [
        { id: 'rooms',    data: { status: 'active'   } },
        { id: 'old-wing', data: { status: 'archived' } },
        { id: 'nest',     data: { status: 'active'   } },
      ];
      const result = await getAllBuildings();
      assert.ok(!result.includes('old-wing'), 'archived building must be excluded');
      assert.ok(result.includes('rooms'));
      assert.ok(result.includes('nest'));
    });

    it("inactive building is excluded (status: 'inactive')", async () => {
      stubState.buildingDocs = [
        { id: 'rooms',  data: { status: 'active'   } },
        { id: 'wing-b', data: { status: 'inactive' } },
        { id: 'nest',   data: { status: 'active'   } },
      ];
      const result = await getAllBuildings();
      assert.ok(!result.includes('wing-b'), 'inactive building must be excluded');
      assert.ok(result.includes('rooms'));
      assert.ok(result.includes('nest'));
    });

    it('active building with no status field is included (backward compat)', async () => {
      stubState.buildingDocs = [
        { id: 'rooms',     data: {} },  // no status field at all
        { id: 'nest',      data: { status: 'active' } },
      ];
      const result = await getAllBuildings();
      assert.ok(result.includes('rooms'), 'building without status field must be included');
    });
  });

  // ── Alias / canonical normalisation ──────────────────────────────────────

  describe('alias normalisation', () => {
    it("doc id 'RentRoom' → canonical 'rooms' in returned list", async () => {
      stubState.buildingDocs = [
        { id: 'RentRoom', data: { status: 'active' } },
        { id: 'nest',     data: { status: 'active' } },
      ];
      const result = await getAllBuildings();
      assert.ok(result.includes('rooms'),   "RentRoom must resolve to 'rooms'");
      assert.ok(!result.includes('RentRoom'), "RentRoom must not appear as-is");
    });

    it("doc id 'old' → canonical 'rooms'", async () => {
      stubState.buildingDocs = [
        { id: 'old',  data: { status: 'active' } },
        { id: 'nest', data: { status: 'active' } },
      ];
      const result = await getAllBuildings();
      assert.ok(result.includes('rooms'), "alias 'old' must resolve to 'rooms'");
      assert.ok(!result.includes('old'), "'old' must not appear as-is");
    });

    it("doc id 'new' → canonical 'nest'", async () => {
      stubState.buildingDocs = [
        { id: 'rooms', data: { status: 'active' } },
        { id: 'new',   data: { status: 'active' } },
      ];
      const result = await getAllBuildings();
      assert.ok(result.includes('nest'), "alias 'new' must resolve to 'nest'");
      assert.ok(!result.includes('new'), "'new' must not appear as-is");
    });

    it("unknown alias doc id 'amazonia' → returned as-is", async () => {
      stubState.buildingDocs = [
        { id: 'rooms',   data: { status: 'active' } },
        { id: 'amazonia', data: { status: 'active' } },
      ];
      const result = await getAllBuildings();
      assert.ok(result.includes('amazonia'), "unknown alias must pass through unchanged");
    });
  });

  // ── In-memory cache ───────────────────────────────────────────────────────

  describe('in-memory cache', () => {
    it('second call within TTL does not fire Firestore again (cache hit)', async () => {
      let fetchCount = 0;
      const origFirestore = adminStub.firestore;

      // Override adminStub.firestore to count get() calls
      adminStub.firestore = () => ({
        collection: (_name) => ({
          get: async () => {
            fetchCount++;
            return makeSnapshot(stubState.buildingDocs);
          },
        }),
      });

      try {
        clearCache();
        await getAllBuildings();   // first call — should hit Firestore
        await getAllBuildings();   // second call — should use cache
        assert.equal(fetchCount, 1, 'Firestore must be called exactly once; second call must use cache');
      } finally {
        // Restore original stub regardless of assertion outcome
        adminStub.firestore = origFirestore;
      }
    });
  });
});
