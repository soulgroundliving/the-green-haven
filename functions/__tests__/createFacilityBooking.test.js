/**
 * Unit tests for createFacilityBooking — tenant auth gate via _authSoT.
 * Focused on §7-Z hardening; full booking logic (conflict detection, slot
 * config, date range) covered by manual + integration testing.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;     // keyed by `${building}/${roomId}`
let peopleDocs;     // keyed by tenantId
let facilityConfigs; // keyed by configId (`${building}_${facilityType}`)
let bookingWrites;
let conflicts;       // toggle conflict result for the next tx.get
let validBuildings;

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  facilityConfigs = {};
  bookingWrites = [];
  conflicts = false;
  validBuildings = new Set(['rooms', 'nest']);
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

function tenantDocRef(building, roomId) {
  const key = `${building}/${roomId}`;
  return {
    _key: key,
    get: async () => ({ exists: key in tenantDocs, data: () => tenantDocs[key] }),
  };
}

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') {
          return {
            doc: (building) => ({
              collection: () => ({
                doc: (roomId) => tenantDocRef(building, roomId),
              }),
            }),
          };
        }
        if (name === 'people') {
          return {
            doc: (id) => ({
              get: async () => ({
                exists: id in peopleDocs,
                data: () => peopleDocs[id],
              }),
            }),
          };
        }
        if (name === 'facilityConfig') {
          return {
            doc: (id) => ({
              get: async () => ({
                exists: id in facilityConfigs,
                data: () => facilityConfigs[id],
              }),
            }),
          };
        }
        if (name === 'facilityBookings') {
          const newDocFactory = () => {
            const id = 'BK_' + Math.random().toString(36).slice(2, 8);
            return { id };
          };
          return {
            doc: () => newDocFactory(),
            where: () => ({
              where: function () { return this; },
              limit: function () { return this; },
              _isConflictQuery: true,
            }),
          };
        }
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (refOrQuery) => {
            if (refOrQuery?._isConflictQuery) {
              return { empty: !conflicts, docs: conflicts ? [{ id: 'x' }] : [] };
            }
            return { exists: refOrQuery._key in tenantDocs, data: () => tenantDocs[refOrQuery._key] };
          },
          set: async (ref, payload) => { bookingWrites.push({ id: ref.id, payload }); },
          update: async () => {},
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
    };
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
  if (id === './buildingRegistry') {
    return {
      getValidBuildings: async () => validBuildings,
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { createFacilityBooking: handler } = require('../createFacilityBooking');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
}

function tomorrowISO() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return t.toISOString().slice(0, 10);
}

function seedConfig(building, facilityType, slotId) {
  facilityConfigs[`${building}_${facilityType}`] = {
    active: true,
    slots:  [{ id: slotId, enabled: true }],
    timeSlots: [],
    maxAdvanceDays: 14,
  };
}

describe('createFacilityBooking — auth gate', () => {
  beforeEach(resetStubs);

  it('Path 1 claim match → booking succeeds', async () => {
    seedConfig('rooms', 'parking', 'A1');
    tenantDocs['rooms/15'] = { name: 'T15' };
    const r = await handler(
      { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
      ctx({ room: '15', building: 'rooms', tenantId: 't-15' }),
    );
    assert.ok(r.bookingId);
    assert.equal(bookingWrites.length, 1);
    assert.equal(bookingWrites[0].payload.tenantRoom, '15');
  });

  it('Path 2a uid-sot: claims drifted, people doc resolves → booking succeeds', async () => {
    seedConfig('rooms', 'parking', 'A1');
    peopleDocs['t-15'] = { building: 'rooms', room: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15', name: 'T15' };
    const r = await handler(
      { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
      ctx({ uid: 'line:Utenant15', tenantId: 't-15' /* no room/building claims */ }),
    );
    assert.ok(r.bookingId);
    assert.equal(bookingWrites[0].payload.tenantRoom, '15');
  });

  it('admin path uses data.tenantRoom (not tok)', async () => {
    seedConfig('rooms', 'parking', 'A1');
    const r = await handler(
      { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning', tenantRoom: '17' },
      ctx({ uid: 'admin@x', admin: true }),
    );
    assert.ok(r.bookingId);
    assert.equal(bookingWrites[0].payload.tenantRoom, '17');
  });

  it('tenant trying to book in OTHER building → permission-denied', async () => {
    seedConfig('nest', 'parking', 'A1');
    peopleDocs['t-15'] = { building: 'rooms', room: '15' };
    await assert.rejects(
      () => handler(
        { building: 'nest', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
        ctx({ room: '15', building: 'rooms', tenantId: 't-15' }),
      ),
      (e) => e.code === 'permission-denied' && /own building/.test(e.message),
    );
  });

  it('claim drift + no people doc → permission-denied (cannot resolve)', async () => {
    seedConfig('rooms', 'parking', 'A1');
    await assert.rejects(
      () => handler(
        { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
        ctx({ uid: 'line:Uorphan' /* no claims, no people doc */ }),
      ),
      (e) => e.code === 'permission-denied' && /Unable to resolve/.test(e.message),
    );
  });

  it('resolved room but tenant doc disagrees → permission-denied (SoT defense)', async () => {
    seedConfig('rooms', 'parking', 'A1');
    peopleDocs['t-attacker'] = { building: 'rooms', room: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Uvictim', tenantId: 't-victim' };
    await assert.rejects(
      () => handler(
        { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' /* no room/building claims */ }),
      ),
      (e) => e.code === 'permission-denied' && /Tenant SoT check failed/.test(e.message),
    );
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', facilityType: 'parking', slot: 'A1', date: tomorrowISO(), timeSlot: 'morning' },
        { auth: null },
      ),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('invalid input (missing date) → invalid-argument', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', facilityType: 'parking', slot: 'A1', timeSlot: 'morning' },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });
});
