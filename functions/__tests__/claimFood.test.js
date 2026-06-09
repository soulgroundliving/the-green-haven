/**
 * Unit tests for claimFood — a neighbour claims a food share; the SHARER earns
 * peer-confirmed food_share points (capped). Covers: award + ledger row
 * (source:'food_share', shareId discriminator → awards the SHARER), the daily
 * cap, self-claim / expired / already-claimed / cross-building blocks, the
 * sharer-doc-missing graceful path, and guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let shareDocs, tenantDocs, writtenLedger, lastSharePatch, lastTenantPatch;
function reset() { shareDocs = {}; tenantDocs = {}; writtenLedger = []; lastSharePatch = null; lastTenantPatch = null; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'foodShares') return { doc: (sid) => ({ _kind: 'share', _key: sid }) };
        if (name === 'tenants') return { doc: (b) => ({ collection: () => ({ doc: (r) => ({ _kind: 'tenant', _key: `${b}/${r}` }) }) }) };
        if (name === 'pointsLedger') return { doc: (lid) => ({ _kind: 'ledger', _ledgerKey: lid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ref._kind === 'share'
            ? ({ exists: ref._key in shareDocs, data: () => shareDocs[ref._key] })
            : ({ exists: ref._key in tenantDocs, data: () => tenantDocs[ref._key] }),
          update: async (ref, patch) => {
            if (ref._kind === 'share') { lastSharePatch = patch; shareDocs[ref._key] = { ...(shareDocs[ref._key] || {}), ...patch }; }
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

const { claimFood: handler } = require('../claimFood');

after(() => { Module._load = _origLoad; });

const CLAIMER = 'line:Uclaimer';
function claimerCtx(room = '102', building = 'rooms', uid = CLAIMER) { return { auth: { uid, token: { room, building } } }; }
const future = () => Date.now() + 3600 * 1000;
function seedAvailable(id = 's1', { sharerBuilding = 'rooms', sharerRoom = '101', sharerPoints = 30, sharerUid = 'line:Usharer', expiresAt } = {}) {
  shareDocs[id] = {
    status: 'available', sharerUid, building: sharerBuilding, room: sharerRoom,
    sharerTenantId: `${sharerBuilding}_${sharerRoom}`, title: 'ข้าวกล่อง',
    expiresAt: expiresAt == null ? future() : expiresAt,
  };
  tenantDocs[`${sharerBuilding}/${sharerRoom}`] = { gamification: { points: sharerPoints } };
}

describe('claimFood — claim + award the SHARER', () => {
  beforeEach(reset);

  it('claim available → sharer +10, ledger food_share, status claimed, claimer stamped', async () => {
    seedAvailable('s1');
    const r = await handler({ shareId: 's1', building: 'rooms', roomId: '102', claimerName: 'สมหญิง' }, claimerCtx());
    assert.equal(r.success, true);
    assert.equal(r.awarded, 10);
    assert.equal(shareDocs.s1.status, 'claimed');
    assert.equal(shareDocs.s1.claimerUid, CLAIMER);
    assert.equal(shareDocs.s1.claimerRoom, '102');
    assert.equal(shareDocs.s1.claimerName, 'สมหญิง');
    assert.equal(shareDocs.s1.sharerPointsAwarded, 10);
    assert.equal(lastTenantPatch['gamification.points'], 40, 'sharer balance 30 → 40');

    assert.equal(writtenLedger.length, 1);
    const led = writtenLedger[0];
    assert.equal(led.doc.source, 'food_share');
    assert.equal(led.doc.points, 10);
    assert.equal(led.doc.balanceAfter, 40);
    assert.equal(led.doc.tenantId, 'rooms_101', 'awards the SHARER, not the claimer');
    assert.equal(led.doc.refId, 's1');
    assert.equal(led.key, 'food_share__rooms_101__s1', 'ledger id embeds the shareId discriminator');
  });

  it('daily cap: sharer already at 50 today → awards 0 (capped) but still claims', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    shareDocs.s1 = { status: 'available', sharerUid: 'line:Usharer', building: 'rooms', room: '101', sharerTenantId: 'rooms_101', title: 'x', expiresAt: future() };
    tenantDocs['rooms/101'] = { gamification: { points: 80, foodShareDay: today, foodShareToday: 50 } };
    const r = await handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx());
    assert.equal(r.awarded, 0);
    assert.equal(r.capped, true);
    assert.equal(shareDocs.s1.status, 'claimed', 'still claims');
    assert.equal(shareDocs.s1.sharerPointsAwarded, 0);
    assert.equal(writtenLedger.length, 0, 'no ledger row when capped');
    assert.equal(lastTenantPatch['gamification.points'], undefined, 'no points bump');
    assert.equal(lastTenantPatch['gamification.foodShareToday'], 50, 'counter stays at the cap');
  });

  it('daily cap: sharer at 45 → awards 5, counter → 50', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    shareDocs.s1 = { status: 'available', sharerUid: 'line:Usharer', building: 'rooms', room: '101', sharerTenantId: 'rooms_101', title: 'x', expiresAt: future() };
    tenantDocs['rooms/101'] = { gamification: { points: 10, foodShareDay: today, foodShareToday: 45 } };
    const r = await handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx());
    assert.equal(r.awarded, 5);
    assert.equal(r.capped, false);
    assert.equal(lastTenantPatch['gamification.points'], 15);
    assert.equal(lastTenantPatch['gamification.foodShareToday'], 50);
    assert.equal(writtenLedger.length, 1);
  });

  it('sharer tenant doc missing → claims but awards 0, no ledger', async () => {
    shareDocs.s1 = { status: 'available', sharerUid: 'line:Usharer', building: 'rooms', room: '999', sharerTenantId: 'rooms_999', title: 'x', expiresAt: future() };
    const r = await handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx());
    assert.equal(r.awarded, 0);
    assert.equal(shareDocs.s1.status, 'claimed');
    assert.equal(shareDocs.s1.sharerPointsAwarded, 0);
    assert.equal(writtenLedger.length, 0);
  });
});

describe('claimFood — guards', () => {
  beforeEach(reset);

  it('cannot claim your own share → failed-precondition (self-claim)', async () => {
    seedAvailable('s1', { sharerUid: CLAIMER });
    await assert.rejects(() => handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx()), (e) => e.code === 'failed-precondition');
    assert.equal(shareDocs.s1.status, 'available');
    assert.equal(writtenLedger.length, 0);
  });

  it('cannot claim an expired share → failed-precondition', async () => {
    seedAvailable('s1', { expiresAt: Date.now() - 1000 });
    await assert.rejects(() => handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx()), (e) => e.code === 'failed-precondition');
    assert.equal(shareDocs.s1.status, 'available');
  });

  it('already claimed → failed-precondition (single-winner)', async () => {
    seedAvailable('s1');
    shareDocs.s1.status = 'claimed';
    await assert.rejects(() => handler({ shareId: 's1', building: 'rooms', roomId: '102' }, claimerCtx()), (e) => e.code === 'failed-precondition');
  });

  it('cross-building claim → permission-denied', async () => {
    seedAvailable('s1', { sharerBuilding: 'rooms' });
    await assert.rejects(() => handler({ shareId: 's1', building: 'nest', roomId: 'N12' }, claimerCtx('N12', 'nest')), (e) => e.code === 'permission-denied');
  });

  it('share not found → not-found', async () => {
    await assert.rejects(() => handler({ shareId: 'ghost', building: 'rooms', roomId: '102' }, claimerCtx()), (e) => e.code === 'not-found');
  });
  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ shareId: 's1', building: 'rooms', roomId: '102' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing shareId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '102' }, claimerCtx()), (e) => e.code === 'invalid-argument');
  });
});
