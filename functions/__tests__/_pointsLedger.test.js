/**
 * Unit tests for _pointsLedger.js — the append-only points event log helper.
 *
 * Covers: valid earn write (key + doc shape), negative points (redeem), null
 * defaults for optional fields, deterministic + sanitised key, and every guard
 * (invalid source, missing tenantId/source/discriminator, zero/non-finite
 * points, bad writer, bad firestore).
 *
 * firebase-admin is stubbed via Module._load so FieldValue.serverTimestamp()
 * resolves to a sentinel and collection().doc() returns an inspectable ref.
 *
 * Run: node --test functions/__tests__/_pointsLedger.test.js
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
        doc: (docId) => ({ _collection: name, _id: docId }),
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { appendPointsLedger, buildLedgerKey, VALID_SOURCES } = require('../_pointsLedger');
const firestore = require('firebase-admin').firestore();

after(() => { Module._load = _origLoad; });

function makeWriter() {
  const calls = [];
  return { set: (ref, data) => calls.push({ ref, data }), calls };
}

describe('appendPointsLedger — valid writes', () => {
  it('writes a full earn row with the deterministic key + correct doc shape', () => {
    const writer = makeWriter();
    const res = appendPointsLedger(writer, firestore, {
      tenantId: 't-1', source: 'daily_login', discriminator: '2026-06-02',
      points: 5, balanceAfter: 25, by: 'line:U1',
      building: 'rooms', roomId: '15', refId: '2026-06-02', note: 'streak day 5',
    });

    assert.equal(writer.calls.length, 1, 'writer.set called exactly once');
    assert.equal(res.idempotencyKey, 'daily_login__t-1__2026-06-02');

    const { ref, data } = writer.calls[0];
    assert.equal(ref._collection, 'pointsLedger');
    assert.equal(ref._id, 'daily_login__t-1__2026-06-02');
    assert.equal(data.tenantId, 't-1');
    assert.equal(data.source, 'daily_login');
    assert.equal(data.points, 5);
    assert.equal(data.balanceAfter, 25);
    assert.equal(data.building, 'rooms');
    assert.equal(data.roomId, '15');
    assert.equal(data.by, 'line:U1');
    assert.equal(data.refId, '2026-06-02');
    assert.equal(data.note, 'streak day 5');
    assert.equal(data.at, SERVER_TS);
  });

  it('accepts negative points for a redeem event', () => {
    const writer = makeWriter();
    appendPointsLedger(writer, firestore, {
      tenantId: 't-1', source: 'redeem', discriminator: 'redempt-abc',
      points: -50, balanceAfter: 10,
    });
    assert.equal(writer.calls[0].data.points, -50);
    assert.equal(writer.calls[0].data.balanceAfter, 10);
  });

  it('defaults optional fields to null (and by → "system")', () => {
    const writer = makeWriter();
    appendPointsLedger(writer, firestore, {
      tenantId: 't-1', source: 'payment', discriminator: '2026-06', points: 100,
    });
    const d = writer.calls[0].data;
    assert.equal(d.building, null);
    assert.equal(d.roomId, null);
    assert.equal(d.balanceAfter, null);
    assert.equal(d.by, 'system');
    assert.equal(d.refId, null);
    assert.equal(d.note, null);
  });

  it('coerces a non-finite balanceAfter to null (still writes the row)', () => {
    const writer = makeWriter();
    appendPointsLedger(writer, firestore, {
      tenantId: 't-1', source: 'wellness_quiz', discriminator: 'a_2026-06',
      points: 10, balanceAfter: undefined,
    });
    assert.equal(writer.calls[0].data.balanceAfter, null);
  });
});

describe('appendPointsLedger — guards', () => {
  const base = { tenantId: 't-1', source: 'daily_login', discriminator: 'd', points: 1 };

  it('throws on an invalid source', () => {
    assert.throws(
      () => appendPointsLedger(makeWriter(), firestore, { ...base, source: 'bogus' }),
      /invalid source/,
    );
  });

  it('throws on missing tenantId', () => {
    const { tenantId, ...noTenant } = base;
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, noTenant), /tenantId/);
  });

  it('throws on missing source', () => {
    const { source, ...noSource } = base;
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, noSource), /source/);
  });

  it('throws on missing discriminator', () => {
    const { discriminator, ...noDisc } = base;
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, noDisc), /discriminator/);
  });

  it('throws on points === 0', () => {
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, { ...base, points: 0 }), /non-zero/);
  });

  it('throws on non-finite points (NaN, Infinity)', () => {
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, { ...base, points: NaN }), /non-zero|finite/);
    assert.throws(() => appendPointsLedger(makeWriter(), firestore, { ...base, points: Infinity }), /non-zero|finite/);
  });

  it('throws when writer is not a batch/transaction (no .set)', () => {
    assert.throws(() => appendPointsLedger(null, firestore, base), /batch or transaction/);
    assert.throws(() => appendPointsLedger({}, firestore, base), /batch or transaction/);
  });

  it('throws when firestore is not an admin Firestore instance', () => {
    assert.throws(() => appendPointsLedger(makeWriter(), null, base), /admin Firestore/);
    assert.throws(() => appendPointsLedger(makeWriter(), {}, base), /admin Firestore/);
  });

  it('does NOT write when a guard rejects the payload', () => {
    const writer = makeWriter();
    assert.throws(() => appendPointsLedger(writer, firestore, { ...base, points: 0 }));
    assert.equal(writer.calls.length, 0);
  });
});

describe('buildLedgerKey + VALID_SOURCES', () => {
  it('is deterministic for the same payload', () => {
    const payload = { source: 'redeem', tenantId: 't-1', discriminator: 'r1' };
    assert.equal(buildLedgerKey(payload), buildLedgerKey({ ...payload }));
  });

  it('joins the three segments with "__"', () => {
    assert.equal(
      buildLedgerKey({ source: 'payment', tenantId: 'nest_15', discriminator: '2026-06' }),
      'payment__nest_15__2026-06',
    );
  });

  it('sanitises Firestore-illegal characters (/ . #)', () => {
    assert.equal(
      buildLedgerKey({ source: 'daily_login', tenantId: 'a/b.c', discriminator: 'x#y' }),
      'daily_login__a_b_c__x_y',
    );
  });

  it('exposes exactly the 6 canonical sources', () => {
    assert.equal(VALID_SOURCES.size, 6);
    for (const s of ['daily_login', 'wellness_quiz', 'contract_quiz', 'complaint_free_month', 'payment', 'redeem']) {
      assert.ok(VALID_SOURCES.has(s), `VALID_SOURCES must include ${s}`);
    }
  });
});
