/**
 * Unit tests for reviewQuestClaim — admin approve/reject of pending quest claims.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs, peopleDocs, claimDocs;
let writtenLedger, lastUpdate;

function resetStubs() {
  tenantDocs = {}; peopleDocs = {}; claimDocs = {};
  writtenLedger = []; lastUpdate = null;
}
resetStubs();
const SERVER_TS = '__SERVER_TS__';

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') return { doc: (b) => ({ collection: () => ({ doc: (r) => ({ _kind: 'tenant', _key: `${b}/${r}` }) }) }) };
        if (name === 'people') return { doc: (tid) => ({ _kind: 'people', _key: tid }) };
        if (name === 'questClaims') return { doc: (cid) => ({ _kind: 'claim', _key: cid }) };
        if (name === 'pointsLedger') return { doc: (lid) => ({ _kind: 'ledger', _ledgerKey: lid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const store = (ref) => ref._kind === 'tenant' ? tenantDocs : ref._kind === 'people' ? peopleDocs : claimDocs;
        const tx = {
          get: async (ref) => ({ exists: ref._key in store(ref), data: () => store(ref)[ref._key] }),
          update: async (ref, patch) => {
            lastUpdate = { key: ref._key, patch };
            const s = store(ref); s[ref._key] = { ...(s[ref._key] || {}), ...patch };
          },
          set: async (ref, doc) => {
            if (ref._kind === 'ledger') { writtenLedger.push({ key: ref._ledgerKey, doc }); }
            else { store(ref)[ref._key] = doc; }
          },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    return { region: () => ({ https: { onCall: (h) => h } }), https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { reviewQuestClaim: handler } = require('../reviewQuestClaim');

function adminCtx(uid = 'admin@x') { return { auth: { uid, token: { admin: true } } }; }

function seedPendingTenant(cid, { b = 'rooms', r = '15', questId = 'q5', points = 30, periodKey = 'once' } = {}) {
  claimDocs[cid] = { questId, tenantId: `${b}_${r}`, building: b, roomId: r, periodKey, points, status: 'pending', questTitle: 'ช่วยยกของ' };
  tenantDocs[`${b}/${r}`] = { gamification: { points: 50 } };
}

describe('reviewQuestClaim — approve', () => {
  beforeEach(resetStubs);

  it('credits reward, writes ledger, marks approved', async () => {
    seedPendingTenant('c1');
    const r = await handler({ claimId: 'c1', decision: 'approve' }, adminCtx());
    assert.equal(r.success, true);
    assert.equal(r.reward, 30);
    assert.equal(r.pointsAfter, 80);
    assert.equal(claimDocs.c1.status, 'approved');
    assert.equal(writtenLedger.length, 1);
    assert.equal(writtenLedger[0].doc.source, 'quest');
    assert.equal(writtenLedger[0].doc.points, 30);
    assert.equal(writtenLedger[0].doc.refId, 'q5');
    assert.equal(writtenLedger[0].key, 'quest__rooms_15__q5__once', 'ledger id embeds the questId__period discriminator');
  });

  it('double-approve is a no-op (idempotency fence) → failed-precondition', async () => {
    seedPendingTenant('c1');
    await handler({ claimId: 'c1', decision: 'approve' }, adminCtx());
    await assert.rejects(
      () => handler({ claimId: 'c1', decision: 'approve' }, adminCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(writtenLedger.length, 1, 'no second credit');
  });

  it('approves a player claim on the people doc', async () => {
    claimDocs.cp = { questId: 'q5', tenantId: 'p-1', building: null, roomId: null, periodKey: 'once', points: 20, status: 'pending' };
    peopleDocs['p-1'] = { gamification: { points: 4 } };
    const r = await handler({ claimId: 'cp', decision: 'approve' }, adminCtx());
    assert.equal(r.pointsAfter, 24);
    assert.equal(writtenLedger[0].doc.building, null);
  });

  it('reward 0 → approved but no ledger', async () => {
    seedPendingTenant('c1', { points: 0 });
    const r = await handler({ claimId: 'c1', decision: 'approve' }, adminCtx());
    assert.equal(claimDocs.c1.status, 'approved');
    assert.equal(writtenLedger.length, 0);
  });
});

describe('reviewQuestClaim — reject', () => {
  beforeEach(resetStubs);

  it('marks rejected, no balance change, no ledger', async () => {
    seedPendingTenant('c1');
    const r = await handler({ claimId: 'c1', decision: 'reject' }, adminCtx());
    assert.equal(r.decision, 'reject');
    assert.equal(claimDocs.c1.status, 'rejected');
    assert.equal(writtenLedger.length, 0);
    assert.equal(lastUpdate.patch['gamification.points'], undefined);
    assert.equal(lastUpdate.patch['gamification.questsToday'].q5.status, 'rejected');
  });
});

describe('reviewQuestClaim — guards', () => {
  beforeEach(resetStubs);

  it('non-admin → permission-denied', async () => {
    await assert.rejects(
      () => handler({ claimId: 'c1', decision: 'approve' }, { auth: { uid: 'u', token: { admin: false } } }),
      (e) => e.code === 'permission-denied',
    );
  });
  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ claimId: 'c1', decision: 'approve' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing claimId → invalid-argument', async () => {
    await assert.rejects(() => handler({ decision: 'approve' }, adminCtx()), (e) => e.code === 'invalid-argument');
  });
  it('bad decision → invalid-argument', async () => {
    await assert.rejects(() => handler({ claimId: 'c1', decision: 'maybe' }, adminCtx()), (e) => e.code === 'invalid-argument');
  });
  it('claim not found → not-found', async () => {
    await assert.rejects(() => handler({ claimId: 'ghost', decision: 'approve' }, adminCtx()), (e) => e.code === 'not-found');
  });
});
