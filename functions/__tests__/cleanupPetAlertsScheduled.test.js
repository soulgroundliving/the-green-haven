/**
 * Unit tests for cleanupPetAlertsScheduled._run — the Lost Pet Alert (#13)
 * housekeeping sweep. Deletes alerts whose expiresAt passed more than GRACE_MS
 * ago (one single-field query, no composite index), keeps within-grace + fresh.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let docs;            // id → { expiresAt: epochMs }
function reset() { docs = {}; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    function makeQuery(cutoffMs) {
      return {
        where: (_field, _op, val) => makeQuery(val && val._ms != null ? val._ms : cutoffMs),
        limit: () => ({
          get: async () => {
            const matched = Object.entries(docs)
              .filter(([, d]) => d.expiresAt < cutoffMs)
              .map(([docId, d]) => ({ id: docId, data: () => d, ref: { delete: async () => { delete docs[docId]; } } }));
            return { empty: matched.length === 0, size: matched.length, docs: matched };
          },
        }),
      };
    }
    const firestoreFn = () => ({ collection: () => makeQuery(Infinity) });
    firestoreFn.Timestamp = { fromMillis: (ms) => ({ _ms: ms }) };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = {
      runWith: () => chain,
      https: { onCall: (h) => h },
      pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (h) => h }) }) },
    };
    return { region: () => chain, https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const cf = require('../cleanupPetAlertsScheduled');

after(() => { Module._load = _origLoad; });

describe('cleanupPetAlertsScheduled._run', () => {
  beforeEach(reset);

  it('deletes alerts expired > GRACE_MS ago; keeps within-grace + fresh', async () => {
    const now = Date.now();
    docs.old1 = { expiresAt: now - cf.GRACE_MS - 1000 };    // past expiry+grace → delete
    docs.old2 = { expiresAt: now - cf.GRACE_MS - 99000 };   // delete
    docs.recentlyExpired = { expiresAt: now - 1000 };        // expired but within grace → keep
    docs.fresh = { expiresAt: now + 3600 * 1000 };           // active → keep

    const res = await cf._run();
    assert.equal(res.deleted, 2);
    assert.ok(!('old1' in docs) && !('old2' in docs), 'stale alerts deleted');
    assert.ok('recentlyExpired' in docs && 'fresh' in docs, 'within-grace + fresh kept');
    assert.equal(res.errors.length, 0);
  });

  it('no stale docs → deletes nothing', async () => {
    docs.fresh = { expiresAt: Date.now() + 1000 };
    const res = await cf._run();
    assert.equal(res.deleted, 0);
    assert.ok('fresh' in docs);
  });
});
