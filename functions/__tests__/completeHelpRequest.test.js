/**
 * Unit tests for completeHelpRequest — the requester confirms-done + rates, the
 * helper earns peer-confirmed kindness points. Covers: award + ledger row
 * (source:'help_completed', requestId discriminator), the requester-only gate,
 * not-accepted block, double-complete idempotency, rating validation, and the
 * helper-doc-missing graceful path.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let reqDocs, tenantDocs, writtenLedger, lastReqPatch, lastTenantPatch;
function reset() { reqDocs = {}; tenantDocs = {}; writtenLedger = []; lastReqPatch = null; lastTenantPatch = null; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'helpRequests') return { doc: (rid) => ({ _kind: 'req', _key: rid }) };
        if (name === 'tenants') return { doc: (b) => ({ collection: () => ({ doc: (r) => ({ _kind: 'tenant', _key: `${b}/${r}` }) }) }) };
        if (name === 'pointsLedger') return { doc: (lid) => ({ _kind: 'ledger', _ledgerKey: lid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ref._kind === 'req'
            ? ({ exists: ref._key in reqDocs, data: () => reqDocs[ref._key] })
            : ({ exists: ref._key in tenantDocs, data: () => tenantDocs[ref._key] }),
          update: async (ref, patch) => {
            if (ref._kind === 'req') { lastReqPatch = patch; reqDocs[ref._key] = { ...(reqDocs[ref._key] || {}), ...patch }; }
            else { lastTenantPatch = patch; tenantDocs[ref._key] = { ...(tenantDocs[ref._key] || {}), ...patch }; }
          },
          set: async (ref, doc) => { if (ref._kind === 'ledger') writtenLedger.push({ key: ref._ledgerKey, doc }); },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './_notifyHelper') {
    return { lookupApprovedRoomUsers: async () => ({ docs: [] }), pushAndRetry: async () => ({ pushed: 0, failed: 0 }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { completeHelpRequest: handler } = require('../completeHelpRequest');

after(() => { Module._load = _origLoad; });

const REQUESTER = 'line:Urequester';
function requesterCtx(uid = REQUESTER) { return { auth: { uid, token: {} } }; }
function seedAccepted(id = 'r1', { helperBuilding = 'rooms', helperRoom = '102', helperPoints = 50 } = {}) {
  reqDocs[id] = {
    status: 'accepted', requesterUid: REQUESTER, helperUid: 'line:Uhelper',
    helperBuilding, helperRoom, helperTenantId: `${helperBuilding}_${helperRoom}`, title: 'ช่วยยกของ',
  };
  tenantDocs[`${helperBuilding}/${helperRoom}`] = { gamification: { points: helperPoints } };
}

describe('completeHelpRequest — award', () => {
  beforeEach(reset);

  it('requester completes → helper +20, ledger help_completed, request done', async () => {
    seedAccepted('r1');
    const r = await handler({ requestId: 'r1', rating: 5, ratingNote: 'ขอบคุณมาก' }, requesterCtx());
    assert.equal(r.success, true);
    assert.equal(r.awarded, 20);
    assert.equal(r.rating, 5);

    assert.equal(reqDocs.r1.status, 'done');
    assert.equal(reqDocs.r1.rating, 5);
    assert.equal(reqDocs.r1.helperPointsAwarded, 20);
    assert.equal(lastTenantPatch['gamification.points'], 70, 'helper balance 50 → 70');

    assert.equal(writtenLedger.length, 1);
    const led = writtenLedger[0];
    assert.equal(led.doc.source, 'help_completed');
    assert.equal(led.doc.points, 20);
    assert.equal(led.doc.balanceAfter, 70);
    assert.equal(led.doc.refId, 'r1');
    assert.equal(led.doc.tenantId, 'rooms_102');
    assert.equal(led.key, 'help_completed__rooms_102__r1', 'ledger id embeds the requestId discriminator');
  });

  it('double-complete is a no-op (status guard) → failed-precondition', async () => {
    seedAccepted('r1');
    await handler({ requestId: 'r1', rating: 4 }, requesterCtx());
    await assert.rejects(
      () => handler({ requestId: 'r1', rating: 4 }, requesterCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(writtenLedger.length, 1, 'no second credit');
  });

  it('helper tenant doc missing → completes but awards 0, no ledger', async () => {
    reqDocs.r1 = { status: 'accepted', requesterUid: REQUESTER, helperBuilding: 'rooms', helperRoom: '999', helperTenantId: 'rooms_999', title: 'x' };
    const r = await handler({ requestId: 'r1', rating: 3 }, requesterCtx());
    assert.equal(r.awarded, 0);
    assert.equal(reqDocs.r1.status, 'done');
    assert.equal(reqDocs.r1.helperPointsAwarded, 0);
    assert.equal(writtenLedger.length, 0);
  });
});

describe('completeHelpRequest — guards', () => {
  beforeEach(reset);

  it('only the requester can complete → permission-denied for the helper', async () => {
    seedAccepted('r1');
    await assert.rejects(
      () => handler({ requestId: 'r1', rating: 5 }, requesterCtx('line:Uhelper')),
      (e) => e.code === 'permission-denied',
    );
    assert.equal(writtenLedger.length, 0);
  });

  it('cannot complete a request that is not accepted → failed-precondition', async () => {
    reqDocs.r1 = { status: 'open', requesterUid: REQUESTER };
    await assert.rejects(() => handler({ requestId: 'r1', rating: 5 }, requesterCtx()), (e) => e.code === 'failed-precondition');
  });

  it('invalid rating → invalid-argument', async () => {
    seedAccepted('r1');
    for (const bad of [0, 6, 2.5, 'x', undefined]) {
      await assert.rejects(() => handler({ requestId: 'r1', rating: bad }, requesterCtx()), (e) => e.code === 'invalid-argument');
    }
    assert.equal(writtenLedger.length, 0);
  });

  it('request not found → not-found', async () => {
    await assert.rejects(() => handler({ requestId: 'ghost', rating: 5 }, requesterCtx()), (e) => e.code === 'not-found');
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ requestId: 'r1', rating: 5 }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
});
