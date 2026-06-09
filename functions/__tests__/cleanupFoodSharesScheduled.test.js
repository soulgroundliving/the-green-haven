/**
 * Unit tests for cleanupFoodSharesScheduled._run — the ephemeral-feed housekeeping
 * sweep. Deletes shares whose expiresAt passed more than GRACE_MS ago (one
 * single-field query, no composite index), keeps fresh / within-grace ones.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let docs;            // id → { expiresAt: epochMs, imagePath?: string }
let storagePrefixes; // prefixes passed to bucket.getFiles (photo cleanup wiring)
function reset() { docs = {}; storagePrefixes = []; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    function makeQuery(cutoffMs) {
      return {
        // only the expiresAt '<' filter carries a cutoff value we care about
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
    const storageFn = () => ({
      bucket: () => ({
        getFiles: async ({ prefix }) => { storagePrefixes.push(prefix); return [[{ name: prefix + 'photo.jpg', delete: async () => {} }]]; },
      }),
    });
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn, storage: storageFn };
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

const cf = require('../cleanupFoodSharesScheduled');

after(() => { Module._load = _origLoad; });

describe('cleanupFoodSharesScheduled._run', () => {
  beforeEach(reset);

  it('deletes shares expired > GRACE_MS ago; keeps within-grace + fresh', async () => {
    const now = Date.now();
    docs.old1 = { expiresAt: now - cf.GRACE_MS - 1000 };   // well past expiry+grace → delete
    docs.old2 = { expiresAt: now - cf.GRACE_MS - 99000 };  // delete
    docs.recentlyExpired = { expiresAt: now - 1000 };       // expired but within grace → keep
    docs.fresh = { expiresAt: now + 3600 * 1000 };          // not expired → keep

    const res = await cf._run();
    assert.equal(res.deleted, 2);
    assert.ok(!('old1' in docs) && !('old2' in docs), 'stale shares deleted');
    assert.ok('recentlyExpired' in docs && 'fresh' in docs, 'within-grace + fresh kept');
  });

  it('no stale docs → deletes nothing', async () => {
    docs.fresh = { expiresAt: Date.now() + 1000 };
    const res = await cf._run();
    assert.equal(res.deleted, 0);
    assert.ok('fresh' in docs);
    assert.equal(res.deletedFiles, 0);
  });

  it('also deletes the Storage photo for shares that have one (no getFiles for text-only)', async () => {
    const now = Date.now();
    docs.withImg = { expiresAt: now - cf.GRACE_MS - 1000, imagePath: 'foodShares/withImg/photo.jpg' };
    docs.textOnly = { expiresAt: now - cf.GRACE_MS - 1000 };   // no image → no storage round-trip
    const res = await cf._run();
    assert.equal(res.deleted, 2);
    assert.equal(res.deletedFiles, 1);
    assert.deepEqual(storagePrefixes, ['foodShares/withImg/'], 'only the share with a photo hit Storage');
  });
});
