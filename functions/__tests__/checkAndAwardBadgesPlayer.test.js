/**
 * Unit tests for _runCheckAndAwardBadgesPlayer (player path of checkAndAwardBadges).
 *
 * Stubs firebase-admin, firebase-functions/v1, and ./gamification-rules so the
 * function can be called directly without a live Firestore connection.
 *
 * Run: node --test functions/__tests__/checkAndAwardBadgesPlayer.test.js
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
const updateCalls = [];

function resetStubs(overrides = {}) {
  stubState = {
    playerExists: true,
    playerData: { gamification: { points: 0, badges: [] } },
    ...overrides,
  };
  updateCalls.length = 0;
}

// ── HttpsError stub ───────────────────────────────────────────────────────────

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── Badge catalog (must match shared/gamification-rules.js exactly) ───────────

const BADGE_CATALOG = [
  { id: 'first_month',     emoji: '🥇', label: 'The First Generation', minPts: 0    },
  { id: 'on_time',         emoji: '⏰', label: 'On Time',               minPts: 50   },
  { id: 'community_star',  emoji: '⭐', label: 'Community Star',        minPts: 75   },
  { id: 'green_guardian',  emoji: '🌿', label: 'Green Guardian',        minPts: 100  },
  { id: 'loyal_resident',  emoji: '💎', label: 'Loyal Resident',        minPts: 250  },
  { id: 'rising_star',     emoji: '🌟', label: 'Rising Star',           minPts: 300  },
  { id: 'perfect_record',  emoji: '🏆', label: 'Perfect Record',        minPts: 500  },
  { id: 'master_resident', emoji: '👑', label: 'Master Resident',       minPts: 1000 },
];

function badgeId(b) {
  if (!b) return '';
  if (typeof b === 'string') return b.toLowerCase().replace(/ /g, '_');
  return b.id || '';
}

function normaliseBadges(raw, nowISO) {
  if (!Array.isArray(raw)) return [];
  return raw.map(b => {
    if (typeof b === 'string') {
      const id = badgeId(b);
      const match = BADGE_CATALOG.find(c => c.id === id || c.label === b);
      return match
        ? { id: match.id, emoji: match.emoji, label: match.label, earnedAt: nowISO }
        : { id, emoji: '🏅', label: b, earnedAt: nowISO };
    }
    return b;
  });
}

// ── firebase-admin stub ───────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  database: () => ({}),
  firestore: Object.assign(
    () => ({
      collection: () => ({
        doc: (id) => ({
          get: async () => ({
            exists: stubState.playerExists,
            data: () => stubState.playerData,
          }),
          update: async (fields) => { updateCalls.push({ id, fields }); },
        }),
      }),
    }),
    { Timestamp: { fromDate: (d) => d } }
  ),
  initializeApp: () => {},
};

// ── firebase-functions/v1 stub ────────────────────────────────────────────────

const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    // Chainable stub — handles region().https.onCall, region().runWith().https.onCall,
    // and region().pubsub.schedule().timeZone().onRun() patterns.
    const chain = {};
    chain.onCall  = (fn) => fn;
    chain.onRun   = () => ({});
    chain.timeZone = () => chain;
    chain.schedule = () => chain;
    chain.runWith  = () => chain;
    chain.https    = { onCall: chain.onCall, onRequest: () => ({}), HttpsError };
    chain.pubsub   = { schedule: chain.schedule };
    return { region: () => chain, https: { HttpsError, onCall: chain.onCall } };
  }
  if (request === './gamification-rules') {
    return { BADGE_CATALOG, badgeId, normaliseBadges, getLevelProgress: () => ({}) };
  }
  return originalLoad.apply(this, arguments);
};

const { _runCheckAndAwardBadgesPlayer } = require('../complaintAndGamification');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('_runCheckAndAwardBadgesPlayer', () => {
  beforeEach(() => resetStubs());

  it('awards first_month badge when player has 0 pts and no badges', async () => {
    const result = await _runCheckAndAwardBadgesPlayer('tenant-1', { tenantId: 'tenant-1' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.badgesAwarded, 1);
    assert.strictEqual(result.newBadges[0].id, 'first_month');
    assert.strictEqual(updateCalls.length, 1);
    assert.ok(Array.isArray(updateCalls[0].fields['gamification.badges']));
  });

  it('awards all badges whose minPts the player meets', async () => {
    resetStubs({ playerData: { gamification: { points: 100, badges: [] } } });
    const result = await _runCheckAndAwardBadgesPlayer('tenant-2', { tenantId: 'tenant-2' });
    // first_month(0) + on_time(50) + community_star(75) + green_guardian(100) = 4
    assert.strictEqual(result.badgesAwarded, 4);
    const ids = result.newBadges.map(b => b.id);
    assert.ok(ids.includes('first_month'));
    assert.ok(ids.includes('on_time'));
    assert.ok(ids.includes('community_star'));
    assert.ok(ids.includes('green_guardian'));
    assert.ok(!ids.includes('loyal_resident'));
  });

  it('does not re-award already earned badges', async () => {
    const existing = [{ id: 'first_month', emoji: '🥇', label: 'The First Generation', earnedAt: '2026-01-01T00:00:00.000Z' }];
    resetStubs({ playerData: { gamification: { points: 100, badges: existing } } });
    const result = await _runCheckAndAwardBadgesPlayer('tenant-3', { tenantId: 'tenant-3' });
    // on_time + community_star + green_guardian = 3 (first_month already earned)
    assert.strictEqual(result.badgesAwarded, 3);
    const ids = result.newBadges.map(b => b.id);
    assert.ok(!ids.includes('first_month'));
    assert.ok(ids.includes('on_time'));
  });

  it('does not call Firestore update when no new badges', async () => {
    const existing = [{ id: 'first_month', emoji: '🥇', label: 'The First Generation', earnedAt: '2026-01-01T00:00:00.000Z' }];
    resetStubs({ playerData: { gamification: { points: 0, badges: existing } } });
    const result = await _runCheckAndAwardBadgesPlayer('tenant-4', { tenantId: 'tenant-4' });
    assert.strictEqual(result.badgesAwarded, 0);
    assert.deepStrictEqual(result.newBadges, []);
    assert.strictEqual(updateCalls.length, 0);
  });

  it('throws permission-denied for wrong tenantId in token', async () => {
    await assert.rejects(
      () => _runCheckAndAwardBadgesPlayer('tenant-abc', { tenantId: 'tenant-xyz' }),
      (e) => { assert.strictEqual(e.code, 'permission-denied'); return true; }
    );
  });

  it('admin token bypasses tenantId check', async () => {
    resetStubs({ playerData: { gamification: { points: 0, badges: [] } } });
    const result = await _runCheckAndAwardBadgesPlayer('tenant-5', { admin: true, tenantId: 'someone-else' });
    assert.strictEqual(result.success, true);
  });

  it('throws not-found when player doc does not exist', async () => {
    resetStubs({ playerExists: false });
    await assert.rejects(
      () => _runCheckAndAwardBadgesPlayer('tenant-ghost', { tenantId: 'tenant-ghost' }),
      (e) => { assert.strictEqual(e.code, 'not-found'); return true; }
    );
  });
});
