/**
 * Unit tests for _actionAudit.js — the append-only admin-action audit helper.
 *
 * Covers: valid write with autoId (client-action default), deterministic key
 * when idempotencyKey is supplied (in-tx CF retry-safe), null defaults for
 * optional fields, and every guard (invalid action, missing actor/action/
 * targetType, bad writer, bad firestore, no-write-on-reject).
 *
 * firebase-admin is stubbed via Module._load so FieldValue.serverTimestamp()
 * resolves to a sentinel and collection().doc() returns an inspectable ref
 * (with .doc() → autoId marker, .doc(id) → fixed id).
 *
 * Run: node --test functions/__tests__/_actionAudit.test.js
 */
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => ({
        // .doc()    → server autoId (client-action default)
        // .doc(id)  → caller-supplied deterministic id (in-tx CF retry dedup)
        doc: (docId) => (docId === undefined
          ? { _collection: name, _id: null, _auto: true }
          : { _collection: name, _id: docId }),
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { appendActionAudit, VALID_ACTIONS } = require('../_actionAudit');
const firestore = require('firebase-admin').firestore();

after(() => { Module._load = _origLoad; });

function makeWriter() {
  const calls = [];
  return { set: (ref, data) => calls.push({ ref, data }), calls };
}

describe('appendActionAudit — valid writes', () => {
  it('writes a full row with an autoId ref + correct doc shape', () => {
    const writer = makeWriter();
    const res = appendActionAudit(writer, firestore, {
      actor: 'admin-uid-1', actorEmail: 'a@x.com', actorRole: 'admin',
      action: 'TENANT_UPDATED', targetType: 'tenant', targetId: '15',
      building: 'rooms', roomId: '15',
      before: { phone: '08' }, after: { phone: '09' },
      ip: '1.2.3.4', source: 'recordAdminAction', note: 'edit phone',
    });

    assert.equal(writer.calls.length, 1, 'writer.set called exactly once');
    assert.ok(res.ref, 'returns the ref');

    const { ref, data } = writer.calls[0];
    assert.equal(ref._collection, 'actionAudit');
    assert.equal(ref._auto, true, 'autoId when no idempotencyKey supplied');
    assert.equal(data.actor, 'admin-uid-1');
    assert.equal(data.actorEmail, 'a@x.com');
    assert.equal(data.actorRole, 'admin');
    assert.equal(data.action, 'TENANT_UPDATED');
    assert.equal(data.targetType, 'tenant');
    assert.equal(data.targetId, '15');
    assert.equal(data.building, 'rooms');
    assert.equal(data.roomId, '15');
    assert.deepEqual(data.before, { phone: '08' });
    assert.deepEqual(data.after, { phone: '09' });
    assert.equal(data.ip, '1.2.3.4');
    assert.equal(data.source, 'recordAdminAction');
    assert.equal(data.note, 'edit phone');
    assert.equal(data.at, SERVER_TS);
  });

  it('uses a deterministic doc id when idempotencyKey is supplied (in-tx retry dedup)', () => {
    const writer = makeWriter();
    const res = appendActionAudit(writer, firestore, {
      actor: 'system', action: 'PAYMENT_VERIFIED', targetType: 'payment',
      targetId: 'txn-abc', idempotencyKey: 'PAYMENT_VERIFIED__nest_15__2026-06',
    });
    assert.equal(res.ref._id, 'PAYMENT_VERIFIED__nest_15__2026-06');
    assert.equal(res.ref._auto, undefined);
    assert.equal(writer.calls[0].data.action, 'PAYMENT_VERIFIED');
  });

  it('sanitises Firestore-illegal characters in a supplied idempotencyKey', () => {
    const writer = makeWriter();
    const res = appendActionAudit(writer, firestore, {
      actor: 'system', action: 'PAYMENT_VERIFIED', targetType: 'payment',
      idempotencyKey: 'a/b.c#d',
    });
    assert.equal(res.ref._id, 'a_b_c_d');
  });

  it('defaults optional fields to null', () => {
    const writer = makeWriter();
    appendActionAudit(writer, firestore, {
      actor: 'admin-uid-1', action: 'TENANT_UPDATED', targetType: 'tenant',
    });
    const d = writer.calls[0].data;
    assert.equal(d.targetId, null);
    assert.equal(d.actorEmail, null);
    assert.equal(d.actorRole, null);
    assert.equal(d.building, null);
    assert.equal(d.roomId, null);
    assert.equal(d.before, null);
    assert.equal(d.after, null);
    assert.equal(d.ip, null);
    assert.equal(d.note, null);
    assert.equal(d.source, 'recordAdminAction');
  });

  it('coerces a non-object before/after to null', () => {
    const writer = makeWriter();
    appendActionAudit(writer, firestore, {
      actor: 'admin-uid-1', action: 'TENANT_UPDATED', targetType: 'tenant',
      before: 'not-an-object', after: 42,
    });
    assert.equal(writer.calls[0].data.before, null);
    assert.equal(writer.calls[0].data.after, null);
  });
});

describe('appendActionAudit — guards', () => {
  const base = { actor: 'admin-uid-1', action: 'TENANT_UPDATED', targetType: 'tenant' };

  it('throws on an invalid action', () => {
    assert.throws(
      () => appendActionAudit(makeWriter(), firestore, { ...base, action: 'BOGUS_ACTION' }),
      /invalid action/,
    );
  });

  it('throws on missing actor', () => {
    const { actor, ...noActor } = base;
    assert.throws(() => appendActionAudit(makeWriter(), firestore, noActor), /actor/);
  });

  it('throws on missing action', () => {
    const { action, ...noAction } = base;
    assert.throws(() => appendActionAudit(makeWriter(), firestore, noAction), /action/);
  });

  it('throws on missing targetType', () => {
    const { targetType, ...noTarget } = base;
    assert.throws(() => appendActionAudit(makeWriter(), firestore, noTarget), /targetType/);
  });

  it('throws when writer is not a batch/transaction (no .set)', () => {
    assert.throws(() => appendActionAudit(null, firestore, base), /batch or transaction/);
    assert.throws(() => appendActionAudit({}, firestore, base), /batch or transaction/);
  });

  it('throws when firestore is not an admin Firestore instance', () => {
    assert.throws(() => appendActionAudit(makeWriter(), null, base), /admin Firestore/);
    assert.throws(() => appendActionAudit(makeWriter(), {}, base), /admin Firestore/);
  });

  it('does NOT write when a guard rejects the payload', () => {
    const writer = makeWriter();
    assert.throws(() => appendActionAudit(writer, firestore, { ...base, action: 'BOGUS_ACTION' }));
    assert.equal(writer.calls.length, 0);
  });
});

describe('VALID_ACTIONS', () => {
  it('includes the Phase 1.1 (PR 1a + 1b) action set', () => {
    for (const a of ['TENANT_UPDATED', 'PAYMENT_VERIFIED', 'BILL_PAID_MANUAL', 'METER_IMPORT_APPROVED']) {
      assert.ok(VALID_ACTIONS.has(a), `VALID_ACTIONS must include ${a}`);
    }
  });
});
