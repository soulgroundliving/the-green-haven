/**
 * Integration-ish unit tests for the four Pet Playdate callables (Meaning Layer
 * #11): createPetPlaydate / joinPetPlaydate / leavePetPlaydate / cancelPetPlaydate.
 *
 * Uses the same in-memory firebase-admin mock as requestPetLink.test.js (a flat
 * `store` keyed by doc path; runTransaction get/set/update/delete operate on it).
 * assertTenantAccess is NOT mocked — it runs for real and short-circuits on the
 * Path-1 claim match (ctx() sets token.room/token.building == the args), so no
 * tenant doc is required for auth. The pet roster + pets subcollection ARE seeded
 * because the callables read them for the approved-pet gate.
 *
 * Run: node --test functions/__tests__/petPlaydateCallables.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// cancelPetPlaydate gates the LINE push on this secret being present (§7-WW).
// Set it so the notify path runs and the push assertions exercise it.
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

const SERVER_TS = '__SERVER_TS__';
let store, rateLimitCalls, pushCalls;
function reset() { store = {}; rateLimitCalls = []; pushCalls = []; }
reset();

function docRef(path) {
  return {
    _path: path,
    id: String(path).split('/').pop(),
    async get() { return { exists: path in store, data: () => store[path], ref: docRef(path) }; },
    async set(data) { store[path] = { ...data }; },
    async update(patch) { store[path] = { ...(store[path] || {}), ...patch }; },
    async delete() { delete store[path]; },
    collection(sub) { return collRef(path + '/' + sub); },
  };
}
function collRef(prefix) {
  return {
    _prefix: prefix,
    doc(id) { return docRef(id == null ? prefix + '/auto' + (collRef._n = (collRef._n || 0) + 1) : prefix + '/' + id); },
  };
}

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const Timestamp = {
      fromMillis: (ms) => ({ __ts: true, _ms: ms, toMillis: () => ms }),
    };
    const firestoreFn = () => ({
      collection: (n) => collRef(n),
      runTransaction: async (fn) => fn({
        get: async (ref) => ref.get(),
        set: (ref, d) => { store[ref._path] = { ...d }; },
        update: (ref, patch) => { store[ref._path] = { ...(store[ref._path] || {}), ...patch }; },
        delete: (ref) => { delete store[ref._path]; },
      }),
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    firestoreFn.Timestamp = Timestamp;
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
  if (id === './_notifyHelper') {
    return {
      lookupApprovedRoomUsers: async (_fs, building, room) => ({ docs: [{ id: 'U_' + room }] }),
      pushAndRetry: async (opts) => { pushCalls.push(opts); return { pushed: 1, failed: 0 }; },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { createPetPlaydate } = require('../createPetPlaydate');
const { joinPetPlaydate } = require('../joinPetPlaydate');
const { leavePetPlaydate } = require('../leavePetPlaydate');
const { cancelPetPlaydate } = require('../cancelPetPlaydate');
after(() => { Module._load = _origLoad; });

const HOUR = 60 * 60 * 1000;
function ctx(room = 'N101', building = 'nest', uid = 'line:Uhost') {
  return { auth: { uid, token: { room, building, tenantId: 'TENANT_A' } } };
}
function adminCtx() { return { auth: { uid: 'admin1', token: { admin: true } } }; }

// Seed a room roster + an approved pet for (building, room, petId).
function seedPet(building, room, petId, status = 'approved', name = 'น้อง') {
  store[`tenants/${building}/list/${room}`] = { tenantId: 'T_' + room, name: 'เจ้าของ' + room };
  store[`tenants/${building}/list/${room}/pets/${petId}`] = { status, name, typeEmoji: '🐶' };
}

function futureArgs(over = {}) {
  const now = Date.now();
  return Object.assign({
    building: 'nest', roomId: 'N101', hostPetId: 'h1',
    title: 'เล่นเย็นนี้', place: 'ลานหญ้าชั้น G',
    startAt: now + HOUR, endAt: now + 3 * HOUR, capacity: 2,
  }, over);
}

// Create a playdate directly in the store (skip the create CF) for join/leave/cancel tests.
function seedPlaydate(id, over = {}) {
  const now = Date.now();
  store['petPlaydates/' + id] = Object.assign({
    hostPetId: 'h1', hostTenantId: 'T_N101', hostRoom: 'N101', hostName: 'โฮสต์',
    building: 'nest', title: 'เล่นเย็นนี้', place: 'ลานหญ้าชั้น G',
    startAt: { toMillis: () => now + HOUR }, endAt: { toMillis: () => now + 3 * HOUR },
    capacity: 2,
    attendees: [{ petId: 'h1', tenantId: 'T_N101', room: 'N101', petName: 'โฮสต์', typeEmoji: '🐶' }],
    status: 'open',
  }, over);
}

describe('createPetPlaydate', () => {
  beforeEach(reset);

  it('creates an open playdate with the host as attendee[0] + rate-limit', async () => {
    seedPet('nest', 'N101', 'h1');
    const r = await createPetPlaydate(futureArgs(), ctx());
    assert.equal(r.success, true);
    assert.ok(r.playdateId);
    const pd = store['petPlaydates/' + r.playdateId];
    assert.equal(pd.status, 'open');
    assert.equal(pd.building, 'nest');
    assert.equal(pd.hostRoom, 'N101');
    assert.equal(pd.capacity, 2);
    assert.equal(pd.attendees.length, 1);
    assert.equal(pd.attendees[0].petId, 'h1');
    assert.equal(pd.attendees[0].typeEmoji, '🐶');
    // privacy: attendee snapshot has no status/health
    assert.ok(!('status' in pd.attendees[0]));
    assert.deepEqual(rateLimitCalls[0], ['line:Uhost', 'createPetPlaydate', 5, 86400]);
  });

  it('rejects a non-approved host pet → failed-precondition', async () => {
    seedPet('nest', 'N101', 'h1', 'pending');
    await assert.rejects(() => createPetPlaydate(futureArgs(), ctx()),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects when the host pet is not found → not-found', async () => {
    store['tenants/nest/list/N101'] = { tenantId: 'T_N101' };   // roster but no pet
    await assert.rejects(() => createPetPlaydate(futureArgs(), ctx()),
      (e) => e.code === 'not-found');
  });

  it('rejects a missing title → invalid-argument', async () => {
    seedPet('nest', 'N101', 'h1');
    await assert.rejects(() => createPetPlaydate(futureArgs({ title: '   ' }), ctx()),
      (e) => e.code === 'invalid-argument');
  });

  it('rejects an end-before-start window → invalid-argument', async () => {
    seedPet('nest', 'N101', 'h1');
    const now = Date.now();
    await assert.rejects(() => createPetPlaydate(futureArgs({ startAt: now + 3 * HOUR, endAt: now + HOUR }), ctx()),
      (e) => e.code === 'invalid-argument');
  });

  it('clamps an over-cap request to 12', async () => {
    seedPet('nest', 'N101', 'h1');
    const r = await createPetPlaydate(futureArgs({ capacity: 99 }), ctx());
    assert.equal(store['petPlaydates/' + r.playdateId].capacity, 12);
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => createPetPlaydate(futureArgs(), { auth: null }),
      (e) => e.code === 'unauthenticated');
  });
});

describe('joinPetPlaydate — the capacity-race lock', () => {
  beforeEach(reset);

  it('a neighbour pet joins an open playdate (open → full at capacity)', async () => {
    seedPlaydate('pd1');                       // cap 2, host in slot 0
    seedPet('nest', 'N202', 'g1');
    const r = await joinPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1', petId: 'g1' }, ctx('N202'));
    assert.equal(r.success, true);
    const pd = store['petPlaydates/pd1'];
    assert.equal(pd.attendees.length, 2);
    assert.equal(pd.attendees[1].petId, 'g1');
    assert.equal(pd.status, 'full');           // 2/2 filled
  });

  it('rejects a join when full → failed-precondition', async () => {
    seedPlaydate('pd1', { status: 'full', attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    seedPet('nest', 'N303', 'g2');
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N303', playdateId: 'pd1', petId: 'g2' }, ctx('N303')),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects a duplicate room join → failed-precondition', async () => {
    seedPlaydate('pd1', { capacity: 6 });      // plenty of seats
    seedPet('nest', 'N101', 'h2');             // same room as the host
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'pd1', petId: 'h2' }, ctx('N101')),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects a non-approved joining pet → failed-precondition', async () => {
    seedPlaydate('pd1');
    seedPet('nest', 'N202', 'g1', 'pending');
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1', petId: 'g1' }, ctx('N202')),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects joining a cancelled playdate → failed-precondition', async () => {
    seedPlaydate('pd1', { status: 'cancelled' });
    seedPet('nest', 'N202', 'g1');
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1', petId: 'g1' }, ctx('N202')),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects a missing playdate → not-found', async () => {
    seedPet('nest', 'N202', 'g1');
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'nope', petId: 'g1' }, ctx('N202')),
      (e) => e.code === 'not-found');
  });

  it('serialized concurrent joins on the last seat → exactly one winner', async () => {
    // cap 2, host fills slot 0 → 1 free seat. Two different rooms try to join.
    // The mock runTransaction is synchronous, so awaiting them in series models
    // the real serialize-on-conflict: the first commits (→ full), the second sees
    // full and is rejected.
    seedPlaydate('pd1');
    seedPet('nest', 'N202', 'g1');
    seedPet('nest', 'N303', 'g2');
    const first = await joinPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1', petId: 'g1' }, ctx('N202'));
    assert.equal(first.success, true);
    await assert.rejects(() => joinPetPlaydate({ building: 'nest', roomId: 'N303', playdateId: 'pd1', petId: 'g2' }, ctx('N303')),
      (e) => e.code === 'failed-precondition');
    assert.equal(store['petPlaydates/pd1'].attendees.length, 2);
  });
});

describe('leavePetPlaydate', () => {
  beforeEach(reset);

  it('a guest leaves a full playdate → re-opens (full → open)', async () => {
    seedPlaydate('pd1', { status: 'full', attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    const r = await leavePetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1', petId: 'g1' }, ctx('N202'));
    assert.equal(r.success, true);
    const pd = store['petPlaydates/pd1'];
    assert.equal(pd.attendees.length, 1);
    assert.equal(pd.status, 'open');
  });

  it('the host cannot leave → failed-precondition', async () => {
    seedPlaydate('pd1');
    await assert.rejects(() => leavePetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'pd1', petId: 'h1' }, ctx('N101')),
      (e) => e.code === 'failed-precondition');
  });

  it('cannot remove a pet from another room → permission-denied', async () => {
    seedPlaydate('pd1', { attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    // caller is N303 trying to eject g1 (which is in N202)
    await assert.rejects(() => leavePetPlaydate({ building: 'nest', roomId: 'N303', playdateId: 'pd1', petId: 'g1' }, ctx('N303')),
      (e) => e.code === 'permission-denied');
  });

  it('rejects leaving a missing playdate → not-found', async () => {
    await assert.rejects(() => leavePetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'nope', petId: 'g1' }, ctx('N202')),
      (e) => e.code === 'not-found');
  });
});

describe('cancelPetPlaydate', () => {
  beforeEach(reset);

  it('the host cancels → status cancelled + LINE-notifies guests, NOT the host', async () => {
    seedPlaydate('pd1', { attendees: [
      { petId: 'h1', room: 'N101' }, { petId: 'g1', room: 'N202' },
    ] });
    const r = await cancelPetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'pd1' }, ctx('N101'));
    assert.equal(r.success, true);
    assert.equal(store['petPlaydates/pd1'].status, 'cancelled');
    assert.equal(store['petPlaydates/pd1'].cancelledBy, 'host');
    // notified the guest room N202 exactly once, not the host room N101
    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0].context.roomId, 'N202');
    assert.equal(pushCalls[0].idempotencyKeyFn('Ux'), 'playdate-cancel-pd1-Ux');
  });

  it('an admin can cancel any playdate → cancelledBy admin', async () => {
    seedPlaydate('pd1', { attendees: [{ petId: 'h1', room: 'N101' }] });
    const r = await cancelPetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'pd1' }, adminCtx());
    assert.equal(r.success, true);
    assert.equal(store['petPlaydates/pd1'].cancelledBy, 'admin');
  });

  it('a non-host room cannot cancel → permission-denied', async () => {
    seedPlaydate('pd1');
    await assert.rejects(() => cancelPetPlaydate({ building: 'nest', roomId: 'N202', playdateId: 'pd1' }, ctx('N202')),
      (e) => e.code === 'permission-denied');
  });

  it('an already-cancelled playdate → failed-precondition', async () => {
    seedPlaydate('pd1', { status: 'cancelled' });
    await assert.rejects(() => cancelPetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'pd1' }, ctx('N101')),
      (e) => e.code === 'failed-precondition');
  });

  it('rejects a missing playdate → not-found', async () => {
    await assert.rejects(() => cancelPetPlaydate({ building: 'nest', roomId: 'N101', playdateId: 'nope' }, ctx('N101')),
      (e) => e.code === 'not-found');
  });
});
