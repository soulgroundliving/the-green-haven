/**
 * Unit tests for resolvePetAlert — the owner (or admin, for moderation) closes a
 * Lost Pet Alert. Covers: owner resolve, admin resolve, non-owner block, terminal
 * block, cross-building block, guards. Mirrors cancelFood.test.js's tx mock.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let alertDocs;
function reset() { alertDocs = {}; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'petAlerts') return { doc: (aid) => ({ _kind: 'alert', _key: aid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => ({ exists: ref._key in alertDocs, data: () => alertDocs[ref._key] }),
          update: async (ref, patch) => { alertDocs[ref._key] = { ...(alertDocs[ref._key] || {}), ...patch }; },
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
  // assertTenantAccess: the auth gate is exercised by its own test — here we mock it
  // so the resolve guard (canResolveAlert) is what's under test. Admin path returns
  // tenantData null; a tenant path returns null too (the owner check is alert-based).
  if (id === './_authSoT') {
    return { assertTenantAccess: async () => ({ tenantData: null, viaPath: 'claim' }) };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { resolvePetAlert: handler } = require('../resolvePetAlert');

after(() => { Module._load = _origLoad; });

const OWNER = 'line:Uowner';
const ownerCtx = () => ({ auth: { uid: OWNER, token: { building: 'nest', room: 'N101' } } });
const adminCtx = () => ({ auth: { uid: 'admin-1', token: { admin: true } } });
const otherCtx = () => ({ auth: { uid: 'line:Uother', token: { building: 'nest', room: 'N202' } } });

function seed(id = 'a1', status = 'active', extra = {}) {
  alertDocs[id] = { status, building: 'nest', ownerRoom: 'N101', petName: 'มะลิ', ...extra };
}

describe('resolvePetAlert', () => {
  beforeEach(reset);

  it('owner resolves their active alert → status resolved + resolvedAt', async () => {
    seed('a1', 'active');
    const r = await handler({ building: 'nest', roomId: 'N101', alertId: 'a1' }, ownerCtx());
    assert.equal(r.success, true);
    assert.equal(r.status, 'resolved');
    assert.equal(alertDocs.a1.status, 'resolved');
    assert.equal(alertDocs.a1.resolvedAt, SERVER_TS);
  });

  it('admin resolves any active alert (moderation)', async () => {
    seed('a1', 'active');
    await handler({ building: 'nest', roomId: 'N999', alertId: 'a1' }, adminCtx());
    assert.equal(alertDocs.a1.status, 'resolved');
  });

  it('a non-owner non-admin tenant cannot resolve → permission-denied', async () => {
    seed('a1', 'active');
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N202', alertId: 'a1' }, otherCtx()),
      (e) => e.code === 'permission-denied'
    );
    assert.equal(alertDocs.a1.status, 'active');
  });

  it('cannot resolve a terminal alert → permission-denied (not-active)', async () => {
    seed('a1', 'resolved');
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', alertId: 'a1' }, ownerCtx()),
      (e) => e.code === 'permission-denied'
    );
  });

  it('admin resolving a terminal alert → failed-precondition', async () => {
    seed('a1', 'resolved');
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', alertId: 'a1' }, adminCtx()),
      (e) => e.code === 'failed-precondition'
    );
  });

  it('cross-building owner room cannot resolve → permission-denied (cross-building)', async () => {
    seed('a1', 'active', { building: 'nest', ownerRoom: 'N101' });
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: 'N101', alertId: 'a1' }, ownerCtx()),
      (e) => e.code === 'permission-denied'
    );
  });

  it('alert not found → not-found', async () => {
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', alertId: 'ghost' }, ownerCtx()),
      (e) => e.code === 'not-found'
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', alertId: 'a1' }, { auth: null }),
      (e) => e.code === 'unauthenticated'
    );
  });

  it('missing alertId → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101' }, ownerCtx()),
      (e) => e.code === 'invalid-argument'
    );
  });
});
