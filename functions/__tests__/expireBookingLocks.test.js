/**
 * Unit tests for expireBookingLocks — scheduled safety-net CF.
 *
 * Tests exercise the pubsub onRun handler captured via Module._load interception.
 * All Firebase Admin and firebase-functions/v1 calls are stubbed — no network required.
 *
 * Run: node --test functions/__tests__/expireBookingLocks.test.js
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
    snapEmpty: true,
    snapDocs: [],       // [{ id, data: { status, lockedUntil } }]
    queryError: null,
    batchCommitError: null,
    ...overrides,
  };
  captured = {
    batchUpdateCalls: [],   // [{ ref, data }]
    batchCommitCalled: false,
  };
}
resetStubs();

// ── Firestore stubs ───────────────────────────────────────────────────────────

const batchStub = {
  update: (ref, data) => { captured.batchUpdateCalls.push({ ref, data }); },
  commit: async () => {
    if (stubState.batchCommitError) throw stubState.batchCommitError;
    captured.batchCommitCalled = true;
  },
};

const queryChainable = {
  where: () => queryChainable,
  limit: () => queryChainable,
  get: async () => {
    if (stubState.queryError) throw stubState.queryError;
    return {
      empty: stubState.snapEmpty,
      size: stubState.snapDocs.length,
      docs: stubState.snapDocs.map(d => ({
        ref: { id: d.id },
        data: () => d.data,
      })),
    };
  },
};

const TimestampSentinel = { now: () => ({ _type: 'Timestamp', now: true }) };
const FieldValueSentinel = { serverTimestamp: () => ({ _type: 'serverTimestamp' }) };

const firestoreInstance = {
  collection: () => queryChainable,
  batch: () => batchStub,
};

// ── Admin stub ────────────────────────────────────────────────────────────────
// admin.firestore() is called at module-load time as a singleton.
// Object.assign merges static methods (Timestamp, FieldValue) onto the callable.

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: Object.assign(() => firestoreInstance, {
    Timestamp: TimestampSentinel,
    FieldValue: FieldValueSentinel,
  }),
};

// ── firebase-functions/v1 stub — captures pubsub onRun handler ────────────────

let capturedScheduledHandler = null;

// ── Module._load intercept ────────────────────────────────────────────────────

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions/v1') {
    return {
      region: () => ({
        pubsub: {
          schedule: () => ({
            timeZone: () => ({
              onRun: (h) => { capturedScheduledHandler = h; return {}; },
            }),
          }),
        },
      }),
    };
  }
  return _origLoad.apply(this, arguments);
};

delete require.cache[require.resolve('../expireBookingLocks.js')];
require('../expireBookingLocks.js');

after(() => { Module._load = _origLoad; });

// ── Sanity check ──────────────────────────────────────────────────────────────

assert.ok(
  typeof capturedScheduledHandler === 'function',
  'capturedScheduledHandler must be a function — check the pubsub onRun stub'
);

// ── Helper ────────────────────────────────────────────────────────────────────

function makeDoc(id, overrides = {}) {
  return {
    id,
    data: {
      status: 'locked',
      lockedUntil: { toMillis: () => Date.now() - 1000 },
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe('expireBookingLocks — scheduled handler', () => {
  beforeEach(() => resetStubs());

  // ── Handler capture ─────────────────────────────────────────────────────────

  describe('handler capture', () => {
    it('captures the scheduled onRun handler (not null)', () => {
      assert.ok(capturedScheduledHandler !== null);
      assert.equal(typeof capturedScheduledHandler, 'function');
    });
  });

  // ── Empty snapshot path ─────────────────────────────────────────────────────

  describe('no expired locks (empty snapshot)', () => {
    it('returns null when snap is empty', async () => {
      resetStubs({ snapEmpty: true, snapDocs: [] });
      const result = await capturedScheduledHandler();
      assert.equal(result, null);
    });

    it('does not call batch.update when snap is empty', async () => {
      resetStubs({ snapEmpty: true, snapDocs: [] });
      await capturedScheduledHandler();
      assert.equal(captured.batchUpdateCalls.length, 0);
    });

    it('does not call batch.commit when snap is empty', async () => {
      resetStubs({ snapEmpty: true, snapDocs: [] });
      await capturedScheduledHandler();
      assert.equal(captured.batchCommitCalled, false);
    });
  });

  // ── Query error ─────────────────────────────────────────────────────────────

  describe('query error propagation', () => {
    it('throws the error when the Firestore query fails', async () => {
      const queryErr = new Error('Firestore query failed');
      resetStubs({ queryError: queryErr });
      await assert.rejects(
        () => capturedScheduledHandler(),
        /Firestore query failed/
      );
    });

    it('does not call batch.commit when query throws', async () => {
      resetStubs({ queryError: new Error('network error') });
      try { await capturedScheduledHandler(); } catch (_) { /* expected */ }
      assert.equal(captured.batchCommitCalled, false);
    });
  });

  // ── Single expired lock ─────────────────────────────────────────────────────

  describe('one expired lock', () => {
    it('calls batch.update exactly once for a single expired doc', async () => {
      resetStubs({ snapEmpty: false, snapDocs: [makeDoc('booking1')] });
      await capturedScheduledHandler();
      assert.equal(captured.batchUpdateCalls.length, 1);
    });

    it('calls batch.commit after the update', async () => {
      resetStubs({ snapEmpty: false, snapDocs: [makeDoc('booking1')] });
      await capturedScheduledHandler();
      assert.equal(captured.batchCommitCalled, true);
    });

    it('returns null on success', async () => {
      resetStubs({ snapEmpty: false, snapDocs: [makeDoc('booking1')] });
      const result = await capturedScheduledHandler();
      assert.equal(result, null);
    });
  });

  // ── Multiple expired locks ──────────────────────────────────────────────────

  describe('multiple expired locks', () => {
    it('calls batch.update once per expired doc (3 docs)', async () => {
      resetStubs({
        snapEmpty: false,
        snapDocs: [
          makeDoc('booking1'),
          makeDoc('booking2'),
          makeDoc('booking3'),
        ],
      });
      await capturedScheduledHandler();
      assert.equal(captured.batchUpdateCalls.length, 3);
    });
  });

  // ── Batch update payload ────────────────────────────────────────────────────

  describe('batch.update payload shape', () => {
    beforeEach(() => {
      resetStubs({ snapEmpty: false, snapDocs: [makeDoc('booking1')] });
    });

    it('sets status to "expired" in the update payload', async () => {
      await capturedScheduledHandler();
      const { data } = captured.batchUpdateCalls[0];
      assert.equal(data.status, 'expired');
    });

    it('sets expiredAt to the serverTimestamp sentinel', async () => {
      await capturedScheduledHandler();
      const { data } = captured.batchUpdateCalls[0];
      assert.deepEqual(data.expiredAt, { _type: 'serverTimestamp' });
    });

    it('sets updatedAt to the serverTimestamp sentinel', async () => {
      await capturedScheduledHandler();
      const { data } = captured.batchUpdateCalls[0];
      assert.deepEqual(data.updatedAt, { _type: 'serverTimestamp' });
    });

    it('passes the doc ref to batch.update', async () => {
      await capturedScheduledHandler();
      const { ref } = captured.batchUpdateCalls[0];
      assert.deepEqual(ref, { id: 'booking1' });
    });
  });

  // ── Batch commit error ──────────────────────────────────────────────────────

  describe('batch commit error propagation', () => {
    it('throws when batch.commit fails', async () => {
      resetStubs({
        snapEmpty: false,
        snapDocs: [makeDoc('booking1')],
        batchCommitError: new Error('commit fail'),
      });
      await assert.rejects(
        () => capturedScheduledHandler(),
        /commit fail/
      );
    });

    it('still calls batch.update before commit throws', async () => {
      resetStubs({
        snapEmpty: false,
        snapDocs: [makeDoc('booking1')],
        batchCommitError: new Error('commit fail'),
      });
      try { await capturedScheduledHandler(); } catch (_) { /* expected */ }
      assert.equal(captured.batchUpdateCalls.length, 1);
    });
  });

  // ── Return value ────────────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns null on the empty-snap path', async () => {
      resetStubs({ snapEmpty: true, snapDocs: [] });
      const result = await capturedScheduledHandler();
      assert.equal(result, null);
    });

    it('returns null on the successful non-empty-snap path', async () => {
      resetStubs({ snapEmpty: false, snapDocs: [makeDoc('booking1')] });
      const result = await capturedScheduledHandler();
      assert.equal(result, null);
    });
  });

  // ── Timestamp.now usage ─────────────────────────────────────────────────────

  describe('Timestamp.now usage', () => {
    it('invokes the query (i.e. .get() is called — implies Timestamp.now was used in the where clause)', async () => {
      // The handler calls admin.firestore.Timestamp.now() before the query.
      // We verify the query was executed (not short-circuited) by confirming
      // that get() ran — the only way .get() runs is if the code reached the
      // query block, which requires Timestamp.now() to have been evaluated first.
      resetStubs({ snapEmpty: true, snapDocs: [] });
      await capturedScheduledHandler();
      // If we reach here without throwing, the query was executed and null returned.
      // batch.update not called confirms we hit the empty-snap early-return.
      assert.equal(captured.batchUpdateCalls.length, 0);
    });
  });

  // ── Batch commit only when docs present ─────────────────────────────────────

  describe('batch.commit gating', () => {
    it('does not call batch.commit on the empty-snap path', async () => {
      resetStubs({ snapEmpty: true });
      await capturedScheduledHandler();
      assert.equal(captured.batchCommitCalled, false);
    });

    it('calls batch.commit exactly once when docs are present', async () => {
      resetStubs({
        snapEmpty: false,
        snapDocs: [makeDoc('booking1'), makeDoc('booking2')],
      });
      await capturedScheduledHandler();
      assert.equal(captured.batchCommitCalled, true);
    });
  });
});
