/**
 * Unit tests for marketplaceStatsAggregator — Sprint 6 event-based
 * badge awarder. Pure-logic tests against a stubbed Firestore.
 *
 * firebase-admin + firebase-functions are stubbed via Module._load so
 * the test runs without those packages installed (same pattern as
 * cleanupMarketplaceChat.test.js / unsendMarketplaceMessage.test.js).
 *
 * Coverage:
 *   - free post → freeGiven++ ; 3rd free → The Giver awarded
 *   - skyHookReady post → skyHookCompleted++ ; 5th → Sky Walker
 *   - isPetCategory post → petHelped++ ; 1st → Pet Whisperer (minCount=1)
 *   - one post can bump multiple counters (sky-hook + pet) on same complete
 *   - idempotency: same postId twice → 2nd call short-circuits via ledger
 *   - non-owner + non-admin → permission-denied
 *   - admin can aggregate any post
 *   - missing post → not-found
 *   - status != COMPLETED → no-op skip
 *   - no relevant flags (paid item, no tags) → no-op skip + no ledger entry
 *   - missing postId → invalid-argument
 *   - player-path (post has tenantId but no building/room) writes to people/{id}
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// Stub firebase-admin + firebase-functions before requiring the CF.
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: Object.assign(
        () => ({}),
        { FieldValue: { increment: (n) => ({ __op: 'increment', delta: n }) } }
      ),
    };
  }
  if (id === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return {
      HttpsError,
      onCall: (opts, h) => (typeof opts === 'function' ? opts : h),
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};
after(() => { Module._load = _origLoad; });

delete require.cache[require.resolve('../marketplaceStatsAggregator.js')];
const { _runAggregator, _expandDotKeys } = require('../marketplaceStatsAggregator.js');

const OWNER = 'line:Uowner';
const STRANGER = 'line:Ustranger';
const POST_ID = 'p1';

const FieldValue = { increment: (n) => ({ __op: 'increment', delta: n }) };

/**
 * Build a stub Firestore with two collections: `marketplace/{postId}`
 * (read-only fixture) and a target gamification doc (read/write).
 *
 * targetState shape: { gamification: { points, badges, marketplaceStats, marketplaceLedger } }
 * The stub mimics tx.get + tx.set semantics (single-snapshot reads).
 */
function makeFirestore({ post, targetState, targetPath }) {
  const writes = [];
  let target = targetState ? JSON.parse(JSON.stringify(targetState), reviveOps) : null;

  function reviveOps(_k, v) {
    // pass through — JSON.parse will revive plain objects; FieldValue
    // sentinels are not parseable so they're handled by the apply step.
    return v;
  }

  // Apply a setMerge / update patch onto an in-memory doc, including
  // FieldValue.increment semantics. Patch keys are already nested
  // objects (after _expandDotKeys) for set-merge; update() passes flat
  // dot keys.
  function applyPatch(doc, patch, flatKeys = false) {
    if (flatKeys) {
      // update(): keys may be dot-notation paths
      for (const [k, v] of Object.entries(patch)) {
        const parts = k.split('.');
        let cur = doc;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
          cur = cur[p];
        }
        cur[parts[parts.length - 1]] = applyFieldValue(cur[parts[parts.length - 1]], v);
      }
    } else {
      // set(merge): keys are nested objects
      mergeNested(doc, patch);
    }
  }

  function mergeNested(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && v.__op === 'increment') {
        dst[k] = applyFieldValue(dst[k], v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (dst[k] == null || typeof dst[k] !== 'object') dst[k] = {};
        mergeNested(dst[k], v);
      } else {
        dst[k] = v;
      }
    }
  }

  function applyFieldValue(existing, value) {
    if (value && typeof value === 'object' && value.__op === 'increment') {
      return (Number(existing) || 0) + Number(value.delta);
    }
    return value;
  }

  function targetRef() {
    return {
      _path: targetPath,
      get: async () => ({ exists: target !== null, data: () => target }),
      set: async (data, opts) => {
        writes.push({ path: targetPath, data, opts });
        if (target === null) target = {};
        applyPatch(target, data, /*flatKeys*/ false);
      },
      update: async (data) => {
        writes.push({ path: targetPath, data, opts: { update: true } });
        if (target === null) target = {};
        applyPatch(target, data, /*flatKeys*/ true);
      },
    };
  }

  function postRef() {
    return {
      _path: `marketplace/${POST_ID}`,
      get: async () => ({ exists: !!post, data: () => post }),
    };
  }

  return {
    _state: () => target,
    _writes: () => writes,
    collection(name) {
      if (name === 'marketplace') {
        return { doc: (id) => (id === POST_ID ? postRef() : { get: async () => ({ exists: false }) }) };
      }
      if (name === 'tenants' && targetPath?.startsWith('tenants/')) {
        const [, b] = targetPath.split('/');
        return {
          doc: (bid) => ({
            collection: (sub) => ({
              doc: (rid) => {
                if (bid === b && targetPath === `tenants/${b}/list/${rid}` && sub === 'list') {
                  return targetRef();
                }
                return { get: async () => ({ exists: false }) };
              },
            }),
          }),
        };
      }
      if (name === 'people' && targetPath?.startsWith('people/')) {
        const id = targetPath.split('/')[1];
        return {
          doc: (pid) => (pid === id ? targetRef() : { get: async () => ({ exists: false }) }),
        };
      }
      return { doc: () => ({ get: async () => ({ exists: false }) }) };
    },
    runTransaction: async (fn) => {
      // Stub transaction: just pass through the existing target as if it
      // were a single-snapshot read; tx.set uses the same write path.
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.update(data),
      };
      return fn(tx);
    },
  };
}

const _basePost = {
  ownerUid: OWNER,
  status: 'COMPLETED',
  building: 'rooms',
  room: '15',
  tenantId: 'tenant_15',
  category: 'item',
  skyHookReady: false,
  isPetCategory: false,
};

describe('marketplaceStatsAggregator', () => {
  describe('_expandDotKeys', () => {
    it('expands a flat dot-key map into nested objects', () => {
      const out = _expandDotKeys({
        'a.b.c': 1,
        'a.b.d': 2,
        'a.e': 3,
        'f': 4,
      });
      assert.deepEqual(out, { a: { b: { c: 1, d: 2 }, e: 3 }, f: 4 });
    });

    it('preserves FieldValue sentinel objects untouched', () => {
      const inc = { __op: 'increment', delta: 1 };
      const out = _expandDotKeys({ 'g.h': inc });
      assert.equal(out.g.h, inc);
    });
  });

  describe('auth + lookup', () => {
    it('missing postId → invalid-argument', async () => {
      const fs = makeFirestore({ post: null, targetState: null, targetPath: null });
      await assert.rejects(
        () => _runAggregator({ firestore: fs, postId: '', callerUid: OWNER, isAdmin: false, FieldValue }),
        (e) => e.code === 'invalid-argument'
      );
    });

    it('non-existent post → not-found', async () => {
      const fs = makeFirestore({ post: null, targetState: null, targetPath: null });
      await assert.rejects(
        () => _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue }),
        (e) => e.code === 'not-found'
      );
    });

    it('non-owner + non-admin → permission-denied', async () => {
      const fs = makeFirestore({ post: { ..._basePost, category: 'free' }, targetState: {}, targetPath: 'tenants/rooms/list/15' });
      await assert.rejects(
        () => _runAggregator({ firestore: fs, postId: POST_ID, callerUid: STRANGER, isAdmin: false, FieldValue }),
        (e) => e.code === 'permission-denied'
      );
    });

    it('admin can aggregate any post', async () => {
      const fs = makeFirestore({ post: { ..._basePost, category: 'free' }, targetState: {}, targetPath: 'tenants/rooms/list/15' });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: STRANGER, isAdmin: true, FieldValue });
      assert.equal(out.statsBumped.freeGiven, 1);
    });
  });

  describe('skip paths', () => {
    it('status != COMPLETED → no-op skip', async () => {
      const fs = makeFirestore({ post: { ..._basePost, status: 'AVAILABLE', category: 'free' }, targetState: {}, targetPath: 'tenants/rooms/list/15' });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.skipped, 'post-not-completed');
      assert.equal(out.badgesAwarded, 0);
    });

    it('no relevant flags (paid item, no tags) → no-stats-eligible skip', async () => {
      const fs = makeFirestore({ post: { ..._basePost, category: 'item' }, targetState: {}, targetPath: 'tenants/rooms/list/15' });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.skipped, 'no-stats-eligible');
      assert.equal(fs._writes().length, 0, 'no writes on no-op skip');
    });

    it('post missing building+room+tenantId → no-target skip', async () => {
      const fs = makeFirestore({ post: { ..._basePost, building: '', room: '', tenantId: '', category: 'free' }, targetState: null, targetPath: null });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.skipped, 'no-target');
    });
  });

  describe('badge unlocks', () => {
    it('3rd free completion awards The Giver', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, category: 'free' },
        targetState: { gamification: { marketplaceStats: { freeGiven: 2 }, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.badgesAwarded, 1);
      assert.equal(out.newBadges[0].id, 'the_giver');
      // counter should land at 3 after increment
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 3);
    });

    it('2nd free completion does NOT yet award The Giver (minCount=3)', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, category: 'free' },
        targetState: { gamification: { marketplaceStats: { freeGiven: 1 }, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.badgesAwarded, 0);
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 2);
    });

    it('5th sky-hook completion awards Sky Walker', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, skyHookReady: true },
        targetState: { gamification: { marketplaceStats: { skyHookCompleted: 4 }, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.badgesAwarded, 1);
      assert.equal(out.newBadges[0].id, 'sky_walker');
    });

    it('1st pet completion awards Pet Whisperer (minCount=1)', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, isPetCategory: true },
        targetState: { gamification: { marketplaceStats: {}, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.badgesAwarded, 1);
      assert.equal(out.newBadges[0].id, 'pet_whisperer');
    });

    it('a single completion can bump multiple counters (sky-hook + pet)', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, skyHookReady: true, isPetCategory: true },
        targetState: { gamification: { marketplaceStats: {}, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.statsBumped.skyHookCompleted, 1);
      assert.equal(out.statsBumped.petHelped, 1);
      // Pet Whisperer fires (minCount=1) but Sky Walker does not (needs 5)
      assert.equal(out.badgesAwarded, 1);
      assert.equal(out.newBadges[0].id, 'pet_whisperer');
    });
  });

  describe('idempotency', () => {
    it('same postId twice → 2nd call short-circuits via ledger', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, category: 'free' },
        targetState: { gamification: { marketplaceStats: { freeGiven: 2 }, badges: [] } },
        targetPath: 'tenants/rooms/list/15',
      });
      // First call awards The Giver
      const first = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(first.badgesAwarded, 1);
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 3);
      // Second call is a no-op (ledger has the postId)
      const second = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(second.skipped, 'already-counted');
      assert.equal(second.badgesAwarded, 0);
      // counter stays at 3
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 3);
    });

    it('already-earned badge is not re-awarded on subsequent qualifying completions', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, category: 'free' },
        targetState: {
          gamification: {
            marketplaceStats: { freeGiven: 5 },
            badges: [{ id: 'the_giver', emoji: '🍃', label: 'The Giver', earnedAt: '2026-05-01T00:00:00Z' }],
          },
        },
        targetPath: 'tenants/rooms/list/15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.badgesAwarded, 0, 'badge already in array, do not re-award');
      // counter still bumps
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 6);
    });
  });

  describe('player path (no building+room, only tenantId)', () => {
    it('writes to people/{tenantId} when building+room absent', async () => {
      const fs = makeFirestore({
        post: { ..._basePost, building: '', room: '', tenantId: 'tenant_15', category: 'free' },
        targetState: {},
        targetPath: 'people/tenant_15',
      });
      const out = await _runAggregator({ firestore: fs, postId: POST_ID, callerUid: OWNER, isAdmin: false, FieldValue });
      assert.equal(out.statsBumped.freeGiven, 1);
      assert.equal(fs._state().gamification.marketplaceStats.freeGiven, 1);
    });
  });
});
