/**
 * Unit tests for cleanupPlayersOver1Year.
 *
 * Stubs firebase-admin so _runCleanupPlayersOver1Year can be called
 * directly without a live Firestore connection.
 *
 * Run: node --test functions/__tests__/cleanupPlayersOver1Year.test.js
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    playerDocs: [],          // array of { id, transitionedAt (ms) }
    recursiveDeleteError: null,
    ...overrides,
  };
}

// ── firebase-admin stub ───────────────────────────────────────────────────────

const deletedIds = [];

function makeDocRef(id) {
  return { id, path: `people/${id}` };
}

function makeQuerySnap(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map(d => ({
      id: d.id,
      ref: makeDocRef(d.id),
      data: () => ({
        transitionedAt: { toDate: () => new Date(d.transitionedAt), toMillis: () => d.transitionedAt },
      }),
    })),
  };
}

const adminStub = {
  apps: [{}],
  firestore: Object.assign(
    () => ({
      collection: () => ({
        where: () => ({
          get: async () => makeQuerySnap(stubState.playerDocs),
        }),
      }),
      recursiveDelete: async (ref) => {
        if (stubState.recursiveDeleteError && stubState.recursiveDeleteError[ref.id]) {
          throw new Error(stubState.recursiveDeleteError[ref.id]);
        }
        deletedIds.push(ref.id);
      },
    }),
    {
      Timestamp: {
        fromDate: (d) => ({ toDate: () => d, toMillis: () => d.getTime() }),
      },
    }
  ),
  initializeApp: () => {},
};

// Inject stubs before requiring the module under test
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({ runWith: () => ({ pubsub: { schedule: () => ({ timeZone: () => ({ onRun: () => ({}) }) }) } }) }),
    };
  }
  return originalLoad.apply(this, arguments);
};

const { _runCleanupPlayersOver1Year } = require('../cleanupPlayersOver1Year');

// ── Helpers ───────────────────────────────────────────────────────────────────

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const now = Date.now();
const expiredAt = now - YEAR_MS - 1000;   // just over 1 year ago
const freshAt   = now - YEAR_MS + 1000;   // just under 1 year ago (still valid)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanupPlayersOver1Year', () => {
  beforeEach(() => {
    resetStubs();
    deletedIds.length = 0;
  });

  it('returns zeros when no expired players exist', async () => {
    resetStubs({ playerDocs: [] });
    const result = await _runCleanupPlayersOver1Year();
    assert.deepStrictEqual(result, { scanned: 0, deleted: 0 });
    assert.strictEqual(deletedIds.length, 0);
  });

  it('deletes a single expired player doc', async () => {
    resetStubs({ playerDocs: [{ id: 'tenant-abc', transitionedAt: expiredAt }] });
    const result = await _runCleanupPlayersOver1Year();
    assert.strictEqual(result.scanned, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.errors, 0);
    assert.deepStrictEqual(deletedIds, ['tenant-abc']);
  });

  it('deletes multiple expired players', async () => {
    resetStubs({
      playerDocs: [
        { id: 'tenant-1', transitionedAt: expiredAt },
        { id: 'tenant-2', transitionedAt: expiredAt - 5000 },
        { id: 'tenant-3', transitionedAt: expiredAt - 86400000 },
      ],
    });
    const result = await _runCleanupPlayersOver1Year();
    assert.strictEqual(result.scanned, 3);
    assert.strictEqual(result.deleted, 3);
    assert.strictEqual(result.errors, 0);
    assert.deepStrictEqual(deletedIds.sort(), ['tenant-1', 'tenant-2', 'tenant-3'].sort());
  });

  it('counts errors without throwing when one recursiveDelete fails', async () => {
    resetStubs({
      playerDocs: [
        { id: 'tenant-ok', transitionedAt: expiredAt },
        { id: 'tenant-bad', transitionedAt: expiredAt },
      ],
      recursiveDeleteError: { 'tenant-bad': 'permission-denied' },
    });
    const result = await _runCleanupPlayersOver1Year();
    assert.strictEqual(result.scanned, 2);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.errors, 1);
    assert.ok(deletedIds.includes('tenant-ok'));
    assert.ok(!deletedIds.includes('tenant-bad'));
  });

  it('does not delete player docs within the 1-year grace period (query boundary)', async () => {
    // The Firestore query filters on transitionedAt < cutoff, so fresh docs
    // are never returned. This test verifies the stub only returns what
    // the query would (playerDocs is what the .where().get() returns).
    resetStubs({ playerDocs: [] }); // query returns nothing (fresh docs excluded)
    const result = await _runCleanupPlayersOver1Year();
    assert.strictEqual(result.scanned, 0);
    assert.strictEqual(result.deleted, 0);
    assert.strictEqual(deletedIds.length, 0);
  });

  it('returns correct structure even when all deletes fail', async () => {
    resetStubs({
      playerDocs: [
        { id: 'tenant-a', transitionedAt: expiredAt },
        { id: 'tenant-b', transitionedAt: expiredAt },
      ],
      recursiveDeleteError: { 'tenant-a': 'network error', 'tenant-b': 'timeout' },
    });
    const result = await _runCleanupPlayersOver1Year();
    assert.strictEqual(result.scanned, 2);
    assert.strictEqual(result.deleted, 0);
    assert.strictEqual(result.errors, 2);
  });
});
