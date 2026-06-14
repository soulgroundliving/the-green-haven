/**
 * Unit tests for raisePetAlert — a tenant raises a building-wide Lost Pet Alert.
 *
 * Mocks firebase-admin (firestore: pet read + petAlerts dup-check/add + liffUsers
 * fan-out), firebase-functions, and the 3 helper modules (assertTenantAccess /
 * checkRateLimit / pushAndRetry) so the handler's ORCHESTRATION + the
 * canRaiseAlert / buildAlertDoc / fan-out-exclusion logic is what's under test.
 * The pure engine has its own exhaustive test; the auth/rate-limit/fan-out
 * primitives each have their own tests too.
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const SERVER_TS = '__SERVER_TS__';
let pets;            // `${b}/${r}/${petId}` -> pet doc data (or absent)
let alerts;          // alertId -> alert doc
let liffUsers;       // [{ id, building, room, status }]
let pushedCalls;     // captured pushAndRetry args
let rateLimitCalls;  // captured checkRateLimit args
let nextAlertId;

function reset() {
  pets = {};
  alerts = {};
  liffUsers = [];
  pushedCalls = [];
  rateLimitCalls = [];
  nextAlertId = 1;
}
reset();

const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    function petsCollection(b, r) {
      return {
        doc: (petId) => ({
          collection: () => { throw new Error('unexpected nested'); },
          get: async () => {
            const key = `${b}/${r}/${petId}`;
            const d = pets[key];
            return { exists: d != null, data: () => d };
          },
        }),
      };
    }
    // tenants/{b}/list/{r}/pets/{petId}
    function tenantsCollection() {
      return {
        doc: (b) => ({
          collection: (listName) => {
            if (listName !== 'list') throw new Error('unexpected: ' + listName);
            return { doc: (r) => ({ collection: (petsName) => {
              if (petsName !== 'pets') throw new Error('unexpected: ' + petsName);
              return petsCollection(b, r);
            } }) };
          },
        }),
      };
    }
    // A tiny query builder for petAlerts (dup check) + liffUsers (fan-out).
    function makeQuery(coll, filters) {
      return {
        where: (field, _op, val) => makeQuery(coll, filters.concat([[field, val]])),
        limit: () => makeQuery(coll, filters),
        get: async () => {
          let rows;
          if (coll === 'petAlerts') {
            rows = Object.entries(alerts).map(([id, d]) => ({ id, data: () => d }));
          } else if (coll === 'liffUsers') {
            rows = liffUsers.map((u) => ({ id: u.id, data: () => u }));
          } else {
            throw new Error('unexpected query collection: ' + coll);
          }
          const matched = rows.filter((row) => filters.every(([f, v]) => String((row.data() || {})[f]) === String(v)));
          return { empty: matched.length === 0, size: matched.length, docs: matched };
        },
      };
    }
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') return tenantsCollection();
        if (name === 'petAlerts') {
          return Object.assign(makeQuery('petAlerts', []), {
            add: async (doc) => { const id = 'alert' + (nextAlertId++); alerts[id] = doc; return { id }; },
          });
        }
        if (name === 'liffUsers') return makeQuery('liffUsers', []);
        throw new Error('unexpected collection: ' + name);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    firestoreFn.Timestamp = { fromMillis: (ms) => ({ _ms: ms, toMillis: () => ms }) };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    const chain = { runWith: () => chain, https: { onCall: (h) => h } };
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './_authSoT') {
    return { assertTenantAccess: async () => ({ tenantData: { tenantId: 'nest_N101' }, viaPath: 'claim' }) };
  }
  if (id === './_rateLimit') {
    return { checkRateLimit: async (uid, action, max, win) => { rateLimitCalls.push({ uid, action, max, win }); } };
  }
  if (id === './_notifyHelper') {
    return { pushAndRetry: async (opts) => { pushedCalls.push(opts); return { pushed: opts.docs.length, failed: 0 }; } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const mod = require('../raisePetAlert');
const handler = mod.raisePetAlert;

after(() => { Module._load = _origLoad; delete process.env.LINE_CHANNEL_ACCESS_TOKEN; });

const OWNER = 'line:Uowner';
const ownerCtx = () => ({ auth: { uid: OWNER, token: { building: 'nest', room: 'N101' } } });

function seedPet(petId = 'pet1', status = 'approved', extra = {}) {
  pets[`nest/N101/${petId}`] = { name: 'มะลิ', typeEmoji: '🐱', photoURL: 'https://x/p.png', status, ...extra };
}

describe('raisePetAlert', () => {
  beforeEach(() => { reset(); process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok123'; });

  it('creates an active alert + fans out to approved tenants EXCLUDING the owner room', async () => {
    seedPet('pet1', 'approved');
    liffUsers = [
      { id: 'line:Uowner', building: 'nest', room: 'N101', status: 'approved' }, // owner — excluded
      { id: 'line:Ua', building: 'nest', room: 'N102', status: 'approved' },
      { id: 'line:Ub', building: 'nest', room: 'N103', status: 'approved' },
      { id: 'line:Uc', building: 'nest', room: 'N104', status: 'pending' },       // not approved — excluded by query
      { id: 'line:Ud', building: 'rooms', room: '5', status: 'approved' },        // other building — excluded by query
    ];
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'pet1', lastSeen: 'แถวลิฟต์' }, ownerCtx());

    assert.equal(r.success, true);
    assert.ok(r.alertId);
    // one alert written, status active, safe snapshot only
    const created = alerts[r.alertId];
    assert.equal(created.status, 'active');
    assert.equal(created.ownerUid, OWNER);             // server-set
    assert.equal(created.ownerTenantId, 'nest_N101');
    assert.equal(created.petName, 'มะลิ');
    assert.equal(created.lastSeen, 'แถวลิฟต์');
    assert.equal(created.createdAt, SERVER_TS);
    assert.ok(!('healthLog' in created) && !('status_pet' in created));
    // fan-out: only Ua + Ub (owner room + non-approved + other-building all excluded)
    assert.equal(pushedCalls.length, 1);
    const recipientIds = pushedCalls[0].docs.map((d) => d.id).sort();
    assert.deepEqual(recipientIds, ['line:Ua', 'line:Ub']);
    assert.equal(r.pushed, 2);
    // idempotency key shape
    assert.equal(pushedCalls[0].idempotencyKeyFn('line:Ua'), `petalert-${r.alertId}-line:Ua`);
  });

  it('enforces the hard 2/day rate limit', async () => {
    seedPet('pet1', 'approved');
    await handler({ building: 'nest', roomId: 'N101', petId: 'pet1' }, ownerCtx());
    assert.equal(rateLimitCalls.length, 1);
    assert.deepEqual(rateLimitCalls[0], { uid: OWNER, action: 'raisePetAlert', max: 2, win: 86400 });
  });

  it('rejects an un-approved pet → failed-precondition', async () => {
    seedPet('pet1', 'pending');
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'pet1' }, ownerCtx()),
      (e) => e.code === 'failed-precondition'
    );
    assert.equal(Object.keys(alerts).length, 0);
  });

  it('rejects when an ACTIVE alert already exists for the pet → failed-precondition', async () => {
    seedPet('pet1', 'approved');
    alerts.existing = { building: 'nest', petId: 'pet1', status: 'active' };
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'pet1' }, ownerCtx()),
      (e) => e.code === 'failed-precondition'
    );
    // no new alert added (still just the seeded one)
    assert.equal(Object.keys(alerts).length, 1);
  });

  it('allows a new alert when the prior one is resolved (not active)', async () => {
    seedPet('pet1', 'approved');
    alerts.old = { building: 'nest', petId: 'pet1', status: 'resolved' };
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'pet1' }, ownerCtx());
    assert.equal(r.success, true);
    assert.equal(Object.keys(alerts).length, 2);
  });

  it('a missing pet → failed-precondition (not-found)', async () => {
    await assert.rejects(
      () => handler({ building: 'nest', roomId: 'N101', petId: 'ghost' }, ownerCtx()),
      (e) => e.code === 'failed-precondition'
    );
  });

  it('alert is still created when the LINE token is absent (push skipped, not fatal)', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    seedPet('pet1', 'approved');
    const r = await handler({ building: 'nest', roomId: 'N101', petId: 'pet1' }, ownerCtx());
    assert.equal(r.success, true);
    assert.equal(r.pushed, 0);
    assert.equal(pushedCalls.length, 0);
    assert.equal(alerts[r.alertId].status, 'active');
  });

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101', petId: 'p' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing petId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'nest', roomId: 'N101' }, ownerCtx()), (e) => e.code === 'invalid-argument');
  });
  it('unknown building → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'mars', roomId: 'N101', petId: 'p' }, ownerCtx()), (e) => e.code === 'invalid-argument');
  });
});

describe('raisePetAlert._buildFlex — urgent 🆘 Flex bubble', () => {
  it('includes the pet line, room, deep-link, and hero when a photo exists', () => {
    const flex = mod._buildFlex(
      { petName: 'มะลิ', petTypeEmoji: '🐱', petPhotoURL: 'https://x/p.png', lastSeen: 'แถวลิฟต์', contactNote: 'โทร N101' },
      'ห้อง N101'
    );
    assert.equal(flex.type, 'flex');
    assert.match(flex.altText, /🆘/);
    assert.match(flex.altText, /มะลิ/);
    assert.equal(flex.contents.hero.type, 'image');
    assert.equal(flex.contents.hero.url, 'https://x/p.png');
    assert.equal(flex.contents.footer.contents[0].action.uri, mod.PET_ALERT_DEEP_LINK);
  });
  it('omits the hero when there is no photo', () => {
    const flex = mod._buildFlex({ petName: 'มะลิ', petTypeEmoji: '🐱', petPhotoURL: null }, 'ห้อง N101');
    assert.equal(flex.contents.hero, undefined);
  });
});
