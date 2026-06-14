/**
 * Unit tests for postCaretakerRequest — an owner posts an emergency pet-sitting
 * request (Meaning Layer #14). Covers: server-set requesterUid (anti-spoof),
 * open status, SAFE pet snapshot (no health leak), canonicalised building,
 * need/period/pet validation, approved-pet gate, auth + rate-limit guards.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let added;          // docs passed to caretakerRequests.add()
let rateLimitCalls; // [uid, action, max, window]
let petDocs;        // keyed `${building}/${room}/${petId}`

function reset() { added = []; rateLimitCalls = []; petDocs = {}; }
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const petCollection = (building, room) => ({
      doc: (petId) => ({
        get: async () => {
          const key = `${building}/${room}/${petId}`;
          return { exists: key in petDocs, data: () => petDocs[key] };
        },
      }),
    });
    const tenantDoc = (building) => ({
      collection: (sub) => {
        if (sub !== 'list') throw new Error('unexpected sub: ' + sub);
        return {
          doc: (room) => ({
            collection: (s2) => {
              if (s2 !== 'pets') throw new Error('unexpected pets sub: ' + s2);
              return petCollection(building, room);
            },
          }),
        };
      },
    });
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'caretakerRequests') {
          return { add: async (doc) => { added.push(doc); return { id: `req-${added.length}` }; } };
        }
        if (name === 'tenants') return { doc: (building) => tenantDoc(building) };
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    firestoreFn.Timestamp = { fromMillis: (ms) => ({ _ts: ms, toMillis: () => ms }) };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './_rateLimit') {
    return { checkRateLimit: async (uid, action, max, win) => { rateLimitCalls.push([uid, action, max, win]); } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { postCaretakerRequest: handler } = require('../postCaretakerRequest');

after(() => { Module._load = _origLoad; });

// LIFF tenant with matching room/building claims → assertTenantAccess claim fast-path.
function tenantCtx(room = '101', building = 'rooms', uid = 'line:Uowner') {
  return { auth: { uid, token: { room, building } } };
}
function seedPet(building, room, petId, data) {
  petDocs[`${building}/${room}/${petId}`] = data;
}
const PERIOD = { from: Date.parse('2026-06-20T08:00:00Z'), to: Date.parse('2026-06-22T18:00:00Z') };

describe('postCaretakerRequest — create', () => {
  beforeEach(reset);

  it('creates an open request with server-set requesterUid + SAFE pet snapshot', async () => {
    seedPet('rooms', '101', 'p1', {
      name: '  ขนมปัง  ', typeEmoji: '🐶', status: 'approved',
      healthLog: [{ note: 'rabies' }], vaccineBookURL: 'x',
    });
    const r = await handler({
      building: 'rooms', roomId: '101', petId: 'p1',
      period: PERIOD, need: '  ให้อาหารเช้า-เย็น  ', urgency: 'urgent',
      requesterName: 'สมชาย', requesterUid: 'line:Uattacker',
    }, tenantCtx());
    assert.equal(r.success, true);
    assert.equal(r.requestId, 'req-1');
    const doc = added[0];
    assert.equal(doc.requesterUid, 'line:Uowner', 'requesterUid from auth, not the spoofed field');
    assert.equal(doc.status, 'open');
    assert.equal(doc.building, 'rooms');
    assert.equal(doc.room, '101');
    assert.equal(doc.petId, 'p1');
    assert.equal(doc.petName, 'ขนมปัง', 'pet name trimmed from SAFE snapshot');
    assert.equal(doc.petTypeEmoji, '🐶');
    assert.equal(doc.need, 'ให้อาหารเช้า-เย็น', 'need trimmed');
    assert.equal(doc.urgency, 'urgent');
    assert.equal(doc.requesterTenantId, 'rooms_101');
    assert.equal(doc.caretakerUid, null);
    // PDPA: the sensitive pet fields NEVER reach the request doc.
    assert.equal('healthLog' in doc, false);
    assert.equal('vaccineBookURL' in doc, false);
    assert.equal('status' in doc === true && doc.status === 'open', true, 'status is the request status, not the pet status');
    assert.deepEqual(rateLimitCalls[0], ['line:Uowner', 'postCaretakerRequest', 5, 86400]);
  });

  it('canonicalises building, defaults urgency to scheduled, falls back to ห้อง-label name', async () => {
    seedPet('nest', 'N12', 'p9', { name: 'มะลิ', type: '🐱', status: 'approved' });
    await handler({
      building: 'NEST', roomId: 'N12', petId: 'p9', period: PERIOD, need: 'พาเดินเล่น',
    }, tenantCtx('N12', 'nest'));
    assert.equal(added[0].building, 'nest');
    assert.equal(added[0].requesterName, 'ห้อง N12');
    assert.equal(added[0].urgency, 'scheduled', 'unset urgency → scheduled');
    assert.equal(added[0].petTypeEmoji, '🐱', 'legacy type alias');
  });

  it('stores the validated period as Timestamps (from < to)', async () => {
    seedPet('rooms', '101', 'p1', { name: 'A', typeEmoji: '🐶', status: 'approved' });
    await handler({ building: 'rooms', roomId: '101', petId: 'p1', period: PERIOD, need: 'x' }, tenantCtx());
    assert.equal(added[0].period.from.toMillis(), PERIOD.from);
    assert.equal(added[0].period.to.toMillis(), PERIOD.to);
  });
});

describe('postCaretakerRequest — guards', () => {
  beforeEach(reset);

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', petId: 'p1', period: PERIOD, need: 'x' }, { auth: null }),
      (e) => e.code === 'unauthenticated');
  });
  it('missing building/roomId → invalid-argument', async () => {
    await assert.rejects(() => handler({ petId: 'p1', period: PERIOD, need: 'x' }, tenantCtx()), (e) => e.code === 'invalid-argument');
  });
  it('missing petId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', period: PERIOD, need: 'x' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('blank need → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', petId: 'p1', period: PERIOD, need: '   ' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('bad period (to <= from) → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', petId: 'p1', period: { from: 2000, to: 1000 }, need: 'x' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('missing period → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '101', petId: 'p1', need: 'x' }, tenantCtx()),
      (e) => e.code === 'invalid-argument');
  });
  it('unknown building → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'amazon', roomId: '1', petId: 'p1', period: PERIOD, need: 'x' }, tenantCtx('1', 'amazon')),
      (e) => e.code === 'invalid-argument');
  });
  it('pet not found → not-found', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '101', petId: 'ghost', period: PERIOD, need: 'x' }, tenantCtx()),
      (e) => e.code === 'not-found',
    );
    assert.equal(added.length, 0);
  });
  it('unapproved pet → failed-precondition', async () => {
    seedPet('rooms', '101', 'p1', { name: 'A', typeEmoji: '🐶', status: 'pending' });
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '101', petId: 'p1', period: PERIOD, need: 'x' }, tenantCtx()),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(added.length, 0);
  });
  it('claim mismatch (wrong room) → permission-denied (assertTenantAccess)', async () => {
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '999', petId: 'p1', period: PERIOD, need: 'x' }, tenantCtx('101', 'rooms')),
      (e) => e.code === 'permission-denied' || e.code === 'internal',
    );
  });
});
