/**
 * Unit tests for recomputeTrustScores.js — the admin "refresh now" callable.
 *
 * Contract: admin claim required; on success it delegates to the shared
 * runTrustScoreSweep and returns { ok:true, ...summary }; a sweep failure surfaces
 * as an 'internal' HttpsError (never a raw stack to the client).
 *
 * Mocks firebase-functions/v1 (onCall → raw handler) and ./computeTrustScoresScheduled
 * (runTrustScoreSweep stub) so the sweep's heavy I/O isn't exercised here — that
 * orchestration is covered by computeTrustScoresScheduled.test.js.
 *
 * Run: node --test functions/__tests__/recomputeTrustScores.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

let sweepResult;   // resolved value of the stubbed runTrustScoreSweep
let sweepError;    // if set, runTrustScoreSweep throws this
let sweepCalls;

function resetStubs() {
  sweepResult = { scored: 3, skippedVacant: 1, provisional: 1, complaintsScanned: 0, buildings: [], errors: 0 };
  sweepError = null;
  sweepCalls = 0;
}
resetStubs();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './computeTrustScoresScheduled') {
    return {
      computeTrustScoresScheduled: () => {},
      runTrustScoreSweep: async () => {
        sweepCalls++;
        if (sweepError) throw sweepError;
        return sweepResult;
      },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { recomputeTrustScores: handler } = require('../recomputeTrustScores');

const adminCtx = { auth: { uid: 'admin-1', token: { admin: true } } };

async function throwsCode(fn, code) {
  try { await fn(); assert.fail(`expected throw with code ${code}`); }
  catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code}`); }
}

describe('recomputeTrustScores — auth gate', () => {
  beforeEach(resetStubs);

  it('rejects unauthenticated callers', async () => {
    await throwsCode(() => handler({}, { auth: null }), 'unauthenticated');
    assert.equal(sweepCalls, 0);
  });

  it('rejects non-admin callers', async () => {
    await throwsCode(() => handler({}, { auth: { uid: 'u1', token: { admin: false } } }), 'permission-denied');
    await throwsCode(() => handler({}, { auth: { uid: 'u2', token: {} } }), 'permission-denied');
    assert.equal(sweepCalls, 0);
  });
});

describe('recomputeTrustScores — happy path', () => {
  beforeEach(resetStubs);

  it('admin → runs the sweep and returns ok + summary', async () => {
    const res = await handler({}, adminCtx);
    assert.equal(sweepCalls, 1);
    assert.equal(res.ok, true);
    assert.equal(res.scored, 3);
    assert.equal(res.skippedVacant, 1);
    assert.equal(res.provisional, 1);
  });

  it('wraps a sweep failure as internal (no raw error leaks)', async () => {
    sweepError = new Error('rtdb exploded');
    await throwsCode(() => handler({}, adminCtx), 'internal');
  });
});
