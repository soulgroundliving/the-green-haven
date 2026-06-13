/**
 * Integration tests for forfeitReservedDeposit.js — deposit Phase 2 no-show forfeit.
 *
 * Verifies: reserved → forfeited flip, forfeitedAmount = all paid (Q2 no refund),
 * DEPOSIT_FORFEITED actionAudit in the same tx, admin gate, reserved-status guard.
 *
 * Run: node --test functions/__tests__/forfeitReservedDeposit.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let captured = { txSets: [] };
let docs = {};

function makeSnap(exists, data) { return { exists, data: () => data || {} }; }

function resetStubs() {
  captured = { txSets: [] };
  docs = {
    'deposits/rooms_20': { exists: true, data: {
      status: 'reserved', amount: 9000, paidSoFar: 500, building: 'rooms', roomId: '20',
      expectedMoveInDate: '2026-07-01', payments: [{ label: 'จอง', amount: 500, method: 'cash' }],
    } },
  };
}
resetStubs();

function makeRef(path) {
  return { path, collection: (sub) => ({ doc: (id) => makeRef(`${path}/${sub}/${id}`) }) };
}

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (coll) => ({ doc: (docId) => makeRef(`${coll}/${docId}`) }),
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => { const d = docs[ref.path]; return makeSnap(d ? d.exists : false, d ? d.data : null); },
          set: (ref, data, options) => { captured.txSets.push({ path: ref.path, data, options: options || null }); },
        };
        return await fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__delete__' };
    return { apps: { length: 1 }, initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions' || id === 'firebase-functions/v1') {
    const HttpsError = class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } };
    const wrapOnCall = (handler) => { const fn = (data, ctx) => handler(data, ctx); fn.run = (data, ctx) => handler(data, ctx); return fn; };
    return { region: () => ({ https: { onCall: wrapOnCall, HttpsError } }), https: { HttpsError, onCall: wrapOnCall } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { forfeitReservedDeposit } = require('../forfeitReservedDeposit');

function adminCtx() { return { auth: { uid: 'admin-uid', token: { admin: true, email: 'a@x.co' } } }; }
const VALID = { building: 'rooms', roomId: '20', reason: 'ไม่ติดต่อกลับ 2 สัปดาห์' };
const exactSet = (path) => captured.txSets.find(s => s.path === path);
const auditSet = () => captured.txSets.find(s => s.path.startsWith('actionAudit/'));

describe('forfeitReservedDeposit — reserved → forfeited', () => {
  beforeEach(() => { resetStubs(); });

  it('flips to forfeited and forfeits ALL paid so far (Q2: no refund)', async () => {
    const out = await forfeitReservedDeposit.run(VALID, adminCtx());
    const dep = exactSet('deposits/rooms_20');
    assert.ok(dep, 'deposit doc must be written');
    assert.equal(dep.data.status, 'forfeited');
    assert.equal(dep.data.forfeitedAmount, 500);              // = paidSoFar (only the ฿500 booking)
    assert.equal(dep.data.forfeitedBy, 'admin-uid');
    assert.equal(dep.data.forfeitReason, 'ไม่ติดต่อกลับ 2 สัปดาห์');
    assert.equal(dep.data.expectedMoveInDate, null);
    assert.equal(out.forfeitedAmount, 500);
    assert.equal(out.depositStatus, 'forfeited');
  });

  it('writes a DEPOSIT_FORFEITED actionAudit row in the same tx', async () => {
    await forfeitReservedDeposit.run(VALID, adminCtx());
    const audit = auditSet();
    assert.ok(audit, 'actionAudit entry must be written');
    assert.equal(audit.data.action, 'DEPOSIT_FORFEITED');
    assert.equal(audit.data.targetType, 'deposit');
    assert.equal(audit.data.targetId, 'rooms_20');
    assert.equal(audit.data.actor, 'admin-uid');
    assert.equal(audit.data.after.forfeitedAmount, 500);
    assert.equal(audit.data.after.fromStatus, 'reserved');
  });

  it('returns the success contract', async () => {
    const out = await forfeitReservedDeposit.run(VALID, adminCtx());
    assert.deepEqual(out, { success: true, building: 'rooms', roomId: '20', forfeitedAmount: 500, depositStatus: 'forfeited' });
  });
});

describe('forfeitReservedDeposit — guards', () => {
  beforeEach(() => { resetStubs(); });

  it('rejects a non-admin caller (permission-denied) with no writes', async () => {
    await assert.rejects(() => forfeitReservedDeposit.run(VALID, { auth: { uid: 'u1', token: {} } }), (e) => e.code === 'permission-denied');
    assert.equal(captured.txSets.length, 0);
  });

  it('rejects an unauthenticated caller (unauthenticated)', async () => {
    await assert.rejects(() => forfeitReservedDeposit.run(VALID, {}), (e) => e.code === 'unauthenticated');
  });

  it('rejects missing building/roomId (invalid-argument)', async () => {
    await assert.rejects(() => forfeitReservedDeposit.run({ roomId: '20' }, adminCtx()), (e) => e.code === 'invalid-argument');
    await assert.rejects(() => forfeitReservedDeposit.run({ building: 'rooms' }, adminCtx()), (e) => e.code === 'invalid-argument');
  });

  it('rejects a non-reserved deposit — idempotency guard (failed-precondition)', async () => {
    docs['deposits/rooms_20'].data.status = 'holding';
    await assert.rejects(() => forfeitReservedDeposit.run(VALID, adminCtx()), (e) => e.code === 'failed-precondition');
    assert.equal(captured.txSets.length, 0);
  });

  it('rejects when there is no deposit (not-found)', async () => {
    docs['deposits/rooms_20'] = { exists: false, data: null };
    await assert.rejects(() => forfeitReservedDeposit.run(VALID, adminCtx()), (e) => e.code === 'not-found');
  });

  it('forfeitedAmount is 0 when nothing was paid yet (defensive)', async () => {
    docs['deposits/rooms_20'].data.paidSoFar = 0;
    const out = await forfeitReservedDeposit.run(VALID, adminCtx());
    assert.equal(out.forfeitedAmount, 0);
    assert.equal(exactSet('deposits/rooms_20').data.status, 'forfeited');
  });
});
