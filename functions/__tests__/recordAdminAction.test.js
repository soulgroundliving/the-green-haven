/**
 * Unit tests for recordAdminAction — the admin-action audit callable.
 *
 * Key contract under test: actor / actorEmail / actorRole / ip are stamped from
 * the VERIFIED auth context, never from client-supplied `data` (an attacker who
 * passes data.actor / data.ip must NOT be able to forge the log).
 *
 * Mocks firebase-functions/v1 so onCall returns the raw handler, and firebase-admin
 * so firestore().batch() captures the appended row.
 *
 * Run: node --test functions/__tests__/recordAdminAction.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';

let committed;     // rows captured from batch.set
let didCommit;

function resetStubs() { committed = []; didCommit = false; }
resetStubs();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({
        doc: (docId) => (docId === undefined
          ? { _collection: name, _auto: true }
          : { _collection: name, _id: docId }),
      }),
      batch: () => ({
        set: (ref, data) => committed.push({ ref, data }),
        commit: async () => { didCommit = true; },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { recordAdminAction: handler } = require('../recordAdminAction');

function ctx({ uid = 'admin-1', admin = true, email = 'admin@x.com', role = '', ip = '1.2.3.4' } = {}) {
  const token = { admin };
  if (email) token.email = email;
  if (role) token.role = role;
  return { auth: { uid, token }, rawRequest: { ip, headers: {} } };
}

async function throwsCode(fn, code) {
  try { await fn(); assert.fail(`expected throw with code ${code}`); }
  catch (e) { assert.equal(e.code, code, `expected code ${code}, got ${e.code}`); }
}

describe('recordAdminAction — auth gate', () => {
  beforeEach(resetStubs);

  it('rejects unauthenticated callers', async () => {
    await throwsCode(() => handler({ action: 'TENANT_UPDATED', targetType: 'tenant' }, { auth: null }), 'unauthenticated');
    assert.equal(committed.length, 0);
  });

  it('rejects non-admin callers', async () => {
    await throwsCode(
      () => handler({ action: 'TENANT_UPDATED', targetType: 'tenant' }, ctx({ admin: false })),
      'permission-denied',
    );
    assert.equal(committed.length, 0);
  });
});

describe('recordAdminAction — input validation', () => {
  beforeEach(resetStubs);

  it('rejects an invalid action', async () => {
    await throwsCode(() => handler({ action: 'NOPE', targetType: 'tenant' }, ctx()), 'invalid-argument');
  });

  it('rejects a missing action', async () => {
    await throwsCode(() => handler({ targetType: 'tenant' }, ctx()), 'invalid-argument');
  });

  it('rejects a missing targetType', async () => {
    await throwsCode(() => handler({ action: 'TENANT_UPDATED' }, ctx()), 'invalid-argument');
  });
});

describe('recordAdminAction — writes the row', () => {
  beforeEach(resetStubs);

  it('commits one actionAudit row with the right shape', async () => {
    const res = await handler({
      action: 'TENANT_UPDATED', targetType: 'tenant', targetId: '15',
      building: 'rooms', roomId: '15',
      before: { phone: '08' }, after: { phone: '09' }, note: 'edit phone',
    }, ctx());

    assert.deepEqual(res, { ok: true });
    assert.equal(didCommit, true, 'batch.commit() awaited');
    assert.equal(committed.length, 1);

    const { ref, data } = committed[0];
    assert.equal(ref._collection, 'actionAudit');
    assert.equal(ref._auto, true, 'client action → server autoId');
    assert.equal(data.action, 'TENANT_UPDATED');
    assert.equal(data.targetType, 'tenant');
    assert.equal(data.targetId, '15');
    assert.equal(data.building, 'rooms');
    assert.equal(data.roomId, '15');
    assert.deepEqual(data.before, { phone: '08' });
    assert.deepEqual(data.after, { phone: '09' });
    assert.equal(data.note, 'edit phone');
    assert.equal(data.at, SERVER_TS);
    assert.equal(data.source, 'recordAdminAction');
  });

  it('STAMPS actor/actorEmail/actorRole/ip from context — ignores client-supplied forgeries', async () => {
    await handler({
      action: 'TENANT_UPDATED', targetType: 'tenant',
      // forgery attempts in the client payload:
      actor: 'evil-uid', actorEmail: 'evil@x.com', actorRole: 'superuser', ip: '9.9.9.9', source: 'fake',
    }, ctx({ uid: 'admin-real', email: 'real@x.com', ip: '1.2.3.4' }));

    const { data } = committed[0];
    assert.equal(data.actor, 'admin-real', 'actor from context.auth.uid, not data.actor');
    assert.equal(data.actorEmail, 'real@x.com', 'email from token, not data');
    assert.equal(data.actorRole, 'admin', 'role derived from admin claim, not data');
    assert.equal(data.ip, '1.2.3.4', 'ip from rawRequest, not data');
    assert.equal(data.source, 'recordAdminAction', 'source fixed server-side, not data');
  });

  it('takes the first hop of an x-forwarded-for chain', async () => {
    const c = ctx();
    c.rawRequest = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } };
    await handler({ action: 'TENANT_UPDATED', targetType: 'tenant' }, c);
    assert.equal(committed[0].data.ip, '203.0.113.5');
  });

  it('truncates an oversized before/after snapshot', async () => {
    const huge = { blob: 'x'.repeat(9000) };
    await handler({ action: 'TENANT_UPDATED', targetType: 'tenant', after: huge }, ctx());
    assert.equal(committed[0].data.after._truncated, true);
  });
});
