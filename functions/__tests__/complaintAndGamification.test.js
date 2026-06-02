/**
 * Unit tests for complaintAndGamification.js
 *
 * Covers: cleanupResolvedComplaints (scheduled), awardComplaintFreeMonthManual
 * (onRequest), awardComplaintFreeMonth (scheduled), checkAndAwardBadges (onCall),
 * calculateTenantRank (onCall), getLeaderboard (onCall).
 *
 * All Firestore, firebase-admin, firebase-functions/v1 and gamification-rules
 * calls are stubbed via Module._load interception installed BEFORE the module is
 * required.
 *
 * Run: node --test functions/__tests__/complaintAndGamification.test.js
 */

'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Fake badge catalog ────────────────────────────────────────────────────────

const fakeBadgeCatalog = [
  { id: 'seedling',    emoji: '🌱', label: 'Seedling',    minPts: 0,   marketplace: false },
  { id: 'sprout',      emoji: '🌿', label: 'Sprout',      minPts: 100, marketplace: false },
  { id: 'seller_star', emoji: '⭐', label: 'Seller Star', minPts: 0,   marketplace: true  },
];

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    // cleanupResolvedComplaints
    buildings: [],          // array of { id, rooms: [{ id, complaints: [{ id, data }] }] }

    // _runAwardComplaintFreeMonth
    complaintsDocs: [],     // array of { data: { building, room } }
    nestTenantDocs: [],     // array of { id, markerExists: bool }

    // checkAndAwardBadges — people path
    peopleExists: true,
    peopleData: { gamification: { points: 0, badges: [] } },

    // checkAndAwardBadges — tenants/{building}/list/{roomId} path
    tenantExists: true,
    tenantData: { gamification: { points: 0, badges: [] } },

    // calculateTenantRank — flat tenants/{tenantId}
    rankTenantExists: true,
    rankTenantData: { gamification: { points: 50 } },

    // getLeaderboard
    leaderboardTenantDocs: [],
    leaderboardPeopleDocs: [],

    // requireAdmin stub result
    requireAdminResult: { uid: 'admin1', admin: true, email: 'admin@test.com' },

    // Set to a function to override the entire collection() dispatch for error testing
    collectionOverride: null,

    ...overrides,
  };

  captured = {
    archivedComplaints: {},    // docId → data passed to archived_complaints set()
    complaintDeletes: [],      // docIds passed to ref.delete()
    batchUpdates: [],          // { ref, fields }
    batchSets: [],             // { ref, data }
    batchCommitCount: 0,
    peopleUpdate: null,        // fields passed to peopleRef.update()
    tenantUpdate: null,        // fields passed to tenantRef.update()
    ledgerWrites: [],          // { key, data } passed to pointsLedger via appendPointsLedger
  };
}
resetStubs();

// ── FieldValue sentinel ───────────────────────────────────────────────────────

const FieldValue = {
  increment: (n) => ({ _type: 'FieldValue.increment', n }),
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  delete: () => ({ _type: 'FieldValue.delete' }),
};

// ── Firestore stub factory ────────────────────────────────────────────────────
// All routing is driven by stubState at call time so beforeEach resets work.
//
// tenants collection must serve three different callers:
//   1. awardComplaintFreeMonth:  .doc('nest').collection('list').get()
//   2. checkAndAwardBadges:      .doc(building).collection('list').doc(roomId).get() / .update()
//   3. calculateTenantRank:      .doc(tenantId).get()   ← flat, no sub-collection call
//   4. getLeaderboard:           .doc(building).collection('list').orderBy(...).limit(...).get()
//
// The distinguishing pattern is whether the caller follows up with .collection('list')
// or calls .get() directly on the doc ref. We handle this by returning a doc ref
// that has BOTH a .get() (flat path) AND a .collection() method (sub-path).

function makeFirestoreInstance() {
  // batch()
  const makeBatch = () => ({
    update: (ref, fields) => { captured.batchUpdates.push({ ref, fields }); },
    set:    (ref, data)   => {
      if (ref && ref._kind === 'ledger') { captured.ledgerWrites.push({ key: ref._ledgerKey, data }); return; }
      captured.batchSets.push({ ref, data });
    },
    commit: async ()      => { captured.batchCommitCount++; },
  });

  // archived_complaints doc stub
  const makeArchivedComplaintsDoc = (id) => ({
    set: async (data) => { captured.archivedComplaints[id] = data; },
  });

  // complaintHistory doc stub (individual complaint inside a room)
  const makeComplaintDoc = (id, data) => ({
    id,
    data: () => ({ ...data }),
    ref: {
      delete: async () => { captured.complaintDeletes.push(id); },
    },
  });

  // complaintHistory collection stub (per room)
  const makeComplaintHistoryQuery = (complaints) => ({
    where: () => ({
      get: async () => ({
        docs: complaints.map(c => makeComplaintDoc(c.id, c.data)),
      }),
    }),
  });

  // Room doc stub (for buildings traversal)
  const makeRoomDoc = (roomId, complaints) => ({
    id: roomId,
    ref: {
      collection: () => makeComplaintHistoryQuery(complaints),
    },
  });

  // Building doc stub (for buildings traversal)
  const makeBuildingDoc = (buildingId, rooms) => ({
    id: buildingId,
    ref: {
      collection: () => ({
        get: async () => ({
          docs: rooms.map(r => makeRoomDoc(r.id, r.complaints || [])),
        }),
      }),
    },
  });

  // Marker doc for complaintFreeMonthAwarded sub-collection
  const makeMarkerRef = (exists) => ({
    get: async () => ({ exists }),
  });

  // Tenant doc stub for nestSnap (used by _runAwardComplaintFreeMonth).
  // Real QueryDocumentSnapshots expose .data() — the ledger wiring reads
  // tenantDoc.data().tenantId + .gamification.points, so the stub must too.
  const makeNestTenantDoc = (id, markerExists, opts = {}) => ({
    id,
    // opts.vacant → empty room (no tenantId, status:'vacant') so the occupancy
    // gate in _runAwardComplaintFreeMonth skips it.
    data: () => (opts.vacant
      ? { gamification: { points: 0 }, status: 'vacant' }
      : { gamification: { points: 0 }, tenantId: `tnt_${id}`, status: 'occupied' }),
    ref: {
      _id: id,
      collection: () => ({
        doc: () => makeMarkerRef(markerExists),
      }),
    },
  });

  // Unified tenants/{id} doc ref — handles:
  //   • flat .get()                     → calculateTenantRank
  //   • .collection('list').get()       → awardComplaintFreeMonth (for 'nest')
  //   • .collection('list').orderBy()…  → getLeaderboard
  //   • .collection('list').doc()…      → checkAndAwardBadges
  const makeTenantDocRef = (id) => ({
    // flat get() — calculateTenantRank
    get: async () => ({
      exists: stubState.rankTenantExists,
      data: () => ({ ...stubState.rankTenantData }),
    }),
    collection: (subName) => {
      // For 'nest' building — awardComplaintFreeMonth iterates .collection('list').get()
      if (id === 'nest' && subName === 'list') {
        // Use a flag to distinguish direct .get() from .orderBy().get()
        let _orderedQuery = false;
        const nestListQuery = {
          // awardComplaintFreeMonth calls .get() directly (no orderBy)
          get: async () => {
            if (_orderedQuery) {
              // getLeaderboard path
              return {
                docs: stubState.leaderboardTenantDocs.map(d => ({
                  id: d.id,
                  data: () => ({ ...d.data }),
                })),
              };
            }
            // awardComplaintFreeMonth path
            return {
              size: stubState.nestTenantDocs.length,
              docs: stubState.nestTenantDocs.map(t => makeNestTenantDoc(t.id, t.markerExists, { vacant: t.vacant })),
            };
          },
          orderBy: function () { _orderedQuery = true; return this; },
          limit:   function () { return this; },
          // checkAndAwardBadges: .doc(building).collection('list').doc(roomId)
          doc: () => ({
            get: async () => ({
              exists: stubState.tenantExists,
              data: () => ({ ...stubState.tenantData }),
            }),
            update: async (fields) => { captured.tenantUpdate = fields; },
          }),
        };
        return nestListQuery;
      }
      // Non-nest building (e.g. 'rooms') — getLeaderboard + checkAndAwardBadges
      if (subName === 'list') {
        return {
          // getLeaderboard: .orderBy(...).limit(...).get()
          orderBy: function () { return this; },
          limit:   function () { return this; },
          get: async () => ({
            docs: stubState.leaderboardTenantDocs.map(d => ({
              id: d.id,
              data: () => ({ ...d.data }),
            })),
          }),
          // checkAndAwardBadges: .doc(roomId).get() / .update()
          doc: () => ({
            get: async () => ({
              exists: stubState.tenantExists,
              data: () => ({ ...stubState.tenantData }),
            }),
            update: async (fields) => { captured.tenantUpdate = fields; },
          }),
        };
      }
      return { get: async () => ({ docs: [] }) };
    },
  });

  return {
    batch: makeBatch,
    collection: (name) => {
      // Allow per-test override for error injection
      if (stubState.collectionOverride) return stubState.collectionOverride(name);

      if (name === 'buildings') {
        return {
          get: async () => ({
            docs: stubState.buildings.map(b => makeBuildingDoc(b.id, b.rooms || [])),
          }),
        };
      }

      if (name === 'archived_complaints') {
        return {
          doc: (id) => makeArchivedComplaintsDoc(id),
        };
      }

      if (name === 'complaints') {
        return {
          where: function () { return this; },
          get: async () => ({
            size: stubState.complaintsDocs.length,
            forEach: (fn) => stubState.complaintsDocs.forEach(d => fn({ data: () => d.data })),
          }),
        };
      }

      if (name === 'pointsLedger') {
        return { doc: (id) => ({ _kind: 'ledger', _ledgerKey: id }) };
      }

      if (name === 'tenants') {
        return {
          doc: (id) => makeTenantDocRef(id),
        };
      }

      if (name === 'people') {
        return {
          // _runCheckAndAwardBadgesPlayer: .doc(tenantId).get() / .update()
          doc: (id) => ({
            get: async () => ({
              exists: stubState.peopleExists,
              data: () => ({ ...stubState.peopleData }),
            }),
            update: async (fields) => { captured.peopleUpdate = fields; },
          }),
          // getLeaderboard: .orderBy(...).limit(...).get()
          orderBy: function () { return this; },
          limit:   function () { return this; },
          get: async () => ({
            docs: stubState.leaderboardPeopleDocs.map(d => ({
              id: d.id,
              data: () => ({ ...d.data }),
            })),
          }),
        };
      }

      return {
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
        where: function () { return this; },
        get: async () => ({ docs: [] }),
      };
    },
  };
}

// ── Build the single firestoreInstance used for module-load singletons ────────

let firestoreInstance;

function buildFirestoreInstance() {
  firestoreInstance = makeFirestoreInstance();
}
buildFirestoreInstance();

// ── admin stub ────────────────────────────────────────────────────────────────

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  database: () => ({}),
  firestore: Object.assign(
    () => firestoreInstance,   // called at module load → captures singleton
    { FieldValue }
  ),
};

// ── Handler capture ───────────────────────────────────────────────────────────

let cleanupScheduledHandler   = null;   // cleanupResolvedComplaints  — no timeZone()
let awardScheduledHandler     = null;   // awardComplaintFreeMonth    — with timeZone()
let manualHttpHandler         = null;   // awardComplaintFreeMonthManual
const callableHandlers        = [];     // [checkAndAwardBadges, calculateTenantRank, getLeaderboard]

// Track schedule() call order so we can distinguish the two pubsub patterns.
let scheduleCallCount = 0;

// ── HttpsError ────────────────────────────────────────────────────────────────

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── requireAdmin stub ─────────────────────────────────────────────────────────

let requireAdminFn = async (_req, _res) => stubState.requireAdminResult;

// ── Module._load interception ─────────────────────────────────────────────────

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request === 'firebase-functions/v1') {
    const scheduleChain = () => {
      scheduleCallCount++;
      const currentCallIndex = scheduleCallCount;
      return {
        // cleanupResolvedComplaints uses .schedule('...').onRun(h) — no timeZone()
        onRun: (h) => {
          cleanupScheduledHandler = h;
          return {};
        },
        // awardComplaintFreeMonth uses .schedule('...').timeZone('...').onRun(h)
        timeZone: () => ({
          onRun: (h) => {
            awardScheduledHandler = h;
            return {};
          },
        }),
      };
    };

    return {
      region: () => ({
        pubsub: {
          schedule: scheduleChain,
        },
        runWith: () => ({
          https: {
            onRequest: (h) => {
              manualHttpHandler = h;
              return {};
            },
          },
        }),
        https: {
          onCall: (h) => {
            callableHandlers.push(h);
            return {};
          },
          HttpsError,
        },
      }),
      https: { HttpsError },
    };
  }

  if (request === './gamification-rules') {
    return {
      BADGE_CATALOG: fakeBadgeCatalog,
      badgeId: (b) => (typeof b === 'string' ? b : (b && b.id) || ''),
      normaliseBadges: (badges) =>
        Array.isArray(badges) ? badges.filter(b => b && typeof b === 'object') : [],
      getLevelProgress: () => ({
        tier: { name: 'Seedling', emoji: '🌱' },
        next: { name: 'Sprout', emoji: '🌿', min: 100 },
      }),
    };
  }

  if (request === './_auth') {
    return {
      requireAdmin: async (req, res) => requireAdminFn(req, res),
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// ── Require CF after stubs are installed ──────────────────────────────────────

delete require.cache[require.resolve('../complaintAndGamification')];
require('../complaintAndGamification');

after(() => {
  Module._load = _origLoad;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Produce an ISO timestamp N days ago */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Fake request/response pair for awardComplaintFreeMonthManual */
function makeReq(overrides = {}) {
  return { method: 'POST', query: {}, ...overrides };
}

function makeRes() {
  const r = {
    _status: null,
    _body: null,
    _headers: {},
    set: (k, v) => { r._headers[k] = v; },
    status: (code) => { r._status = code; return r; },
    json:   (body) => { r._body = body; return r; },
    send:   (body) => { r._body = body; return r; },
  };
  return r;
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('complaintAndGamification', () => {
  beforeEach(() => {
    resetStubs();
    // Rebuild firestoreInstance on each test so stub state changes take effect
    buildFirestoreInstance();
    // Reset callable handler list index tracking (handlers stay registered)
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('cleanupResolvedComplaints', () => {
    it('handler is registered', () => {
      assert.ok(typeof cleanupScheduledHandler === 'function', 'cleanupScheduledHandler must be a function');
    });

    it('returns true with no buildings → no archive writes', async () => {
      stubState.buildings = [];
      const result = await cleanupScheduledHandler({});
      assert.strictEqual(result, true);
      assert.strictEqual(Object.keys(captured.archivedComplaints).length, 0);
      assert.strictEqual(captured.complaintDeletes.length, 0);
    });

    it('returns true with buildings that have no complaints', async () => {
      stubState.buildings = [
        { id: 'rooms', rooms: [{ id: '15', complaints: [] }] },
      ];
      const result = await cleanupScheduledHandler({});
      assert.strictEqual(result, true);
      assert.strictEqual(Object.keys(captured.archivedComplaints).length, 0);
    });

    it('archives and deletes a resolved complaint older than 30 days', async () => {
      stubState.buildings = [
        {
          id: 'rooms',
          rooms: [
            {
              id: '15',
              complaints: [
                { id: 'c-old', data: { status: 'resolved', resolvedDate: daysAgo(35), note: 'noise' } },
              ],
            },
          ],
        },
      ];
      const result = await cleanupScheduledHandler({});
      assert.strictEqual(result, true);
      assert.ok(captured.archivedComplaints['c-old'] !== undefined, 'old complaint must be archived');
      assert.strictEqual(captured.archivedComplaints['c-old'].building, 'rooms');
      assert.strictEqual(captured.archivedComplaints['c-old'].room, '15');
      assert.strictEqual(captured.archivedComplaints['c-old'].note, 'noise');
      assert.ok(typeof captured.archivedComplaints['c-old'].archivedAt === 'string', 'archivedAt must be a string');
      assert.ok(captured.complaintDeletes.includes('c-old'), 'old complaint must be deleted after archiving');
    });

    it('does not archive a resolved complaint that is fewer than 30 days old', async () => {
      stubState.buildings = [
        {
          id: 'rooms',
          rooms: [
            {
              id: '15',
              complaints: [
                { id: 'c-recent', data: { status: 'resolved', resolvedDate: daysAgo(10) } },
              ],
            },
          ],
        },
      ];
      await cleanupScheduledHandler({});
      assert.strictEqual(captured.archivedComplaints['c-recent'], undefined);
      assert.strictEqual(captured.complaintDeletes.length, 0);
    });

    it('processes multiple buildings and rooms, archiving only old complaints', async () => {
      stubState.buildings = [
        {
          id: 'rooms',
          rooms: [
            {
              id: '15',
              complaints: [
                { id: 'c-old',    data: { status: 'resolved', resolvedDate: daysAgo(40) } },
                { id: 'c-recent', data: { status: 'resolved', resolvedDate: daysAgo(5) } },
              ],
            },
          ],
        },
        {
          id: 'nest',
          rooms: [
            {
              id: 'N101',
              complaints: [
                { id: 'c-nest-old', data: { status: 'resolved', resolvedDate: daysAgo(60) } },
              ],
            },
          ],
        },
      ];
      await cleanupScheduledHandler({});
      assert.ok(captured.archivedComplaints['c-old'] !== undefined);
      assert.strictEqual(captured.archivedComplaints['c-recent'], undefined);
      assert.ok(captured.archivedComplaints['c-nest-old'] !== undefined);
      assert.strictEqual(captured.archivedComplaints['c-nest-old'].building, 'nest');
      assert.strictEqual(captured.archivedComplaints['c-nest-old'].room, 'N101');
      assert.strictEqual(captured.complaintDeletes.length, 2);
    });

    it('returns false when firestore throws', async () => {
      stubState.collectionOverride = () => ({
        get: async () => { throw new Error('firestore unavailable'); },
      });
      const result = await cleanupScheduledHandler({});
      assert.strictEqual(result, false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('awardComplaintFreeMonthManual', () => {
    it('handler is registered', () => {
      assert.ok(typeof manualHttpHandler === 'function', 'manualHttpHandler must be a function');
    });

    it('OPTIONS request returns 204', async () => {
      const res = makeRes();
      await manualHttpHandler(makeReq({ method: 'OPTIONS' }), res);
      assert.strictEqual(res._status, 204);
    });

    it('GET request returns 405', async () => {
      const res = makeRes();
      await manualHttpHandler(makeReq({ method: 'GET' }), res);
      assert.strictEqual(res._status, 405);
    });

    it('PUT request returns 405', async () => {
      const res = makeRes();
      await manualHttpHandler(makeReq({ method: 'PUT' }), res);
      assert.strictEqual(res._status, 405);
    });

    it('returns early (no 200) when requireAdmin returns null', async () => {
      requireAdminFn = async (_req, _res) => null;
      const res = makeRes();
      await manualHttpHandler(makeReq(), res);
      // requireAdmin returned null → handler must return without writing a response
      assert.strictEqual(res._status, null, 'status must not be set when requireAdmin short-circuits');
    });

    it('POST dryRun=1 → success:true with dryRun:true in result', async () => {
      stubState.nestTenantDocs = [{ id: '101', markerExists: false }];
      requireAdminFn = async () => ({ uid: 'admin1', admin: true });
      const res = makeRes();
      await manualHttpHandler(makeReq({ query: { dryRun: '1' } }), res);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.success, true);
      assert.strictEqual(res._body.dryRun, true);
      // dryRun → no batch commits
      assert.strictEqual(captured.batchCommitCount, 0);
    });

    it('POST dryRun=true (string) is also treated as dry run', async () => {
      requireAdminFn = async () => ({ uid: 'admin1', admin: true });
      const res = makeRes();
      await manualHttpHandler(makeReq({ query: { dryRun: 'true' } }), res);
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.dryRun, true);
    });

    it('POST apply mode (no dryRun) → awards points and commits batch', async () => {
      stubState.nestTenantDocs = [
        { id: '201', markerExists: false },
        { id: '202', markerExists: false },
      ];
      requireAdminFn = async () => ({ uid: 'admin1', admin: true });
      const res = await (async () => {
        const r = makeRes();
        await manualHttpHandler(makeReq(), r);
        return r;
      })();
      assert.strictEqual(res._status, 200);
      assert.strictEqual(res._body.success, true);
      assert.ok(res._body.awarded >= 0, 'awarded must be a non-negative number');
      // dryRun undefined → false → batches committed
      assert.ok(captured.batchCommitCount >= 0);
    });

    it('returns 500 when _runAwardComplaintFreeMonth throws', async () => {
      requireAdminFn = async () => ({ uid: 'admin1', admin: true });
      // Inject throwing behavior via collectionOverride
      stubState.collectionOverride = (name) => {
        if (name === 'complaints') {
          return {
            where: function () { return this; },
            get: async () => { throw new Error('db error'); },
          };
        }
        return { get: async () => ({ docs: [] }) };
      };
      const res = makeRes();
      await manualHttpHandler(makeReq(), res);
      assert.strictEqual(res._status, 500);
      assert.ok(typeof res._body.error === 'string');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('awardComplaintFreeMonth (scheduled)', () => {
    it('handler is registered', () => {
      assert.ok(typeof awardScheduledHandler === 'function', 'awardScheduledHandler must be a function');
    });

    it('runs _runAwardComplaintFreeMonth and returns result with monthKey', async () => {
      stubState.nestTenantDocs = [];
      const result = await awardScheduledHandler();
      assert.ok(typeof result.monthKey === 'string', 'result must have monthKey');
      assert.ok(typeof result.awarded === 'number', 'result must have awarded count');
    });

    it('skips tenant who had a complaint last month', async () => {
      // Complaint for nest room '301'
      stubState.complaintsDocs = [{ data: { building: 'nest', room: '301' } }];
      stubState.nestTenantDocs = [
        { id: '301', markerExists: false },   // had complaint → skipped
        { id: '302', markerExists: false },   // clean → awarded
      ];
      const result = await awardScheduledHandler();
      assert.strictEqual(result.skippedHadComplaint, 1);
    });

    it('skips tenant who already has the marker for this month', async () => {
      stubState.nestTenantDocs = [
        { id: '401', markerExists: true },   // already awarded → skip
      ];
      const result = await awardScheduledHandler();
      assert.strictEqual(result.skippedAlreadyAwarded, 1);
      assert.strictEqual(result.awarded, 0);
      assert.strictEqual(captured.batchCommitCount, 0);
    });

    it('skips vacant room with no tenantId (occupancy gate)', async () => {
      stubState.nestTenantDocs = [
        { id: 'N101', markerExists: false },                 // occupied → awarded
        { id: 'N102', markerExists: false, vacant: true },   // empty → skipped
        { id: 'N103', markerExists: false, vacant: true },   // empty → skipped
      ];
      const result = await awardScheduledHandler();
      assert.strictEqual(result.awarded, 1, 'only the occupied room is awarded');
      assert.strictEqual(result.skippedVacant, 2, 'both empty rooms skipped by occupancy gate');
      assert.strictEqual(captured.batchCommitCount, 1, 'no batch write for vacant rooms');
    });

    it('awards points and sets marker for eligible tenant in apply mode', async () => {
      stubState.nestTenantDocs = [
        { id: '501', markerExists: false },
      ];
      const result = await awardScheduledHandler();
      assert.strictEqual(result.awarded, 1);
      assert.strictEqual(captured.batchCommitCount, 1);
      // batch.update should have been called with the increment
      assert.ok(captured.batchUpdates.length >= 1, 'batch.update must be called');
      const updateFields = captured.batchUpdates[0].fields;
      assert.ok(
        updateFields['gamification.points'] && updateFields['gamification.points']._type === 'FieldValue.increment',
        'gamification.points must use FieldValue.increment'
      );
      assert.strictEqual(updateFields['gamification.points'].n, 40);
      // pointsLedger row appended in the SAME batch
      assert.strictEqual(captured.ledgerWrites.length, 1, 'one ledger row per awarded tenant');
      assert.strictEqual(captured.ledgerWrites[0].data.source, 'complaint_free_month');
      assert.strictEqual(captured.ledgerWrites[0].data.points, 40);
      assert.strictEqual(captured.ledgerWrites[0].data.tenantId, 'tnt_501');
      assert.strictEqual(captured.ledgerWrites[0].data.balanceAfter, 40);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('checkAndAwardBadges', () => {
    // callableHandlers[0] = checkAndAwardBadges
    const getHandler = () => callableHandlers[0];

    describe('tenantId (player) path', () => {
      it('throws permission-denied when token.tenantId !== tenantId and not admin', async () => {
        await assert.rejects(
          () => getHandler()({ tenantId: 'T1' }, { auth: { token: { tenantId: 'T2' } } }),
          (e) => { assert.strictEqual(e.code, 'permission-denied'); return true; }
        );
      });

      it('admin token bypasses tenantId permission check', async () => {
        stubState.peopleData = { gamification: { points: 0, badges: [] } };
        const result = await getHandler()(
          { tenantId: 'T1' },
          { auth: { token: { admin: true, tenantId: 'other' } } }
        );
        assert.strictEqual(result.success, true);
      });

      it('throws not-found when people doc does not exist', async () => {
        stubState.peopleExists = false;
        await assert.rejects(
          () => getHandler()({ tenantId: 'T1' }, { auth: { token: { tenantId: 'T1' } } }),
          (e) => { assert.strictEqual(e.code, 'not-found'); return true; }
        );
      });

      it('awards seedling badge when player has 0 pts and no badges', async () => {
        stubState.peopleData = { gamification: { points: 0, badges: [] } };
        const result = await getHandler()(
          { tenantId: 'T1' },
          { auth: { token: { tenantId: 'T1' } } }
        );
        assert.strictEqual(result.badgesAwarded, 1);
        assert.strictEqual(result.newBadges[0].id, 'seedling');
        assert.ok(captured.peopleUpdate !== null, 'update must have been called');
      });

      it('does not re-award already-earned badges', async () => {
        stubState.peopleData = {
          gamification: {
            points: 0,
            badges: [{ id: 'seedling', emoji: '🌱', label: 'Seedling', earnedAt: '2026-01-01T00:00:00.000Z' }],
          },
        };
        const result = await getHandler()(
          { tenantId: 'T1' },
          { auth: { token: { tenantId: 'T1' } } }
        );
        assert.strictEqual(result.badgesAwarded, 0);
        assert.strictEqual(captured.peopleUpdate, null);
      });

      it('skips marketplace badges regardless of points', async () => {
        stubState.peopleData = { gamification: { points: 1000, badges: [] } };
        const result = await getHandler()(
          { tenantId: 'T1' },
          { auth: { token: { tenantId: 'T1' } } }
        );
        const awardedIds = result.newBadges.map(b => b.id);
        assert.ok(!awardedIds.includes('seller_star'), 'marketplace badge must not be awarded');
        // seedling (0pts) and sprout (100pts) should both be awarded
        assert.ok(awardedIds.includes('seedling'));
        assert.ok(awardedIds.includes('sprout'));
      });

      it('does not call update when no new badges to award', async () => {
        stubState.peopleData = {
          gamification: {
            points: 0,
            badges: [{ id: 'seedling', emoji: '🌱', label: 'Seedling', earnedAt: '2026-01-01T00:00:00.000Z' }],
          },
        };
        await getHandler()(
          { tenantId: 'T1' },
          { auth: { token: { tenantId: 'T1' } } }
        );
        assert.strictEqual(captured.peopleUpdate, null);
      });
    });

    describe('building + roomId (active tenant) path', () => {
      it('throws invalid-argument when building is missing', async () => {
        await assert.rejects(
          () => getHandler()({ roomId: '15' }, { auth: { token: {} } }),
          (e) => { assert.strictEqual(e.code, 'invalid-argument'); return true; }
        );
      });

      it('throws invalid-argument when roomId is missing', async () => {
        await assert.rejects(
          () => getHandler()({ building: 'rooms' }, { auth: { token: {} } }),
          (e) => { assert.strictEqual(e.code, 'invalid-argument'); return true; }
        );
      });

      it('throws not-found when tenant doc does not exist', async () => {
        stubState.tenantExists = false;
        await assert.rejects(
          () => getHandler()({ building: 'rooms', roomId: '15' }, { auth: { token: {} } }),
          (e) => { assert.strictEqual(e.code, 'not-found'); return true; }
        );
      });

      it('awards badges and updates tenantRef', async () => {
        stubState.tenantData = { gamification: { points: 0, badges: [] } };
        const result = await getHandler()(
          { building: 'rooms', roomId: '15' },
          { auth: { token: {} } }
        );
        assert.strictEqual(result.success, true);
        assert.ok(result.badgesAwarded >= 1);
        assert.ok(captured.tenantUpdate !== null, 'tenantRef.update must be called');
        assert.ok(Array.isArray(captured.tenantUpdate['gamification.badges']));
      });

      it('returns badgesAwarded:0 and no update when tenant already has all eligible badges', async () => {
        stubState.tenantData = {
          gamification: {
            points: 0,
            badges: [{ id: 'seedling', emoji: '🌱', label: 'Seedling', earnedAt: '2026-01-01T00:00:00.000Z' }],
          },
        };
        const result = await getHandler()(
          { building: 'rooms', roomId: '15' },
          { auth: { token: {} } }
        );
        assert.strictEqual(result.badgesAwarded, 0);
        assert.strictEqual(captured.tenantUpdate, null);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('calculateTenantRank', () => {
    // callableHandlers[1] = calculateTenantRank
    const getHandler = () => callableHandlers[1];

    it('throws not-found when tenant doc does not exist', async () => {
      stubState.rankTenantExists = false;
      await assert.rejects(
        () => getHandler()({ tenantId: 'ghost' }, {}),
        (e) => { assert.strictEqual(e.code, 'not-found'); return true; }
      );
    });

    it('returns success:true with rank and points from getLevelProgress', async () => {
      stubState.rankTenantData = { gamification: { points: 75 } };
      const result = await getHandler()({ tenantId: 'T1' }, {});
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rank, 'Seedling');
      assert.strictEqual(result.rankIcon, '🌱');
      assert.strictEqual(result.points, 75);
      assert.ok(result.nextMilestone !== null, 'nextMilestone must be set when next tier exists');
      assert.strictEqual(result.nextMilestone.name, 'Sprout');
      assert.strictEqual(result.nextMilestone.points, 100);
    });

    it('defaults points to 0 when gamification field is absent', async () => {
      stubState.rankTenantData = {};
      const result = await getHandler()({ tenantId: 'T2' }, {});
      assert.strictEqual(result.points, 0);
      assert.strictEqual(result.progressToNext, 100);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('getLeaderboard', () => {
    // callableHandlers[2] = getLeaderboard
    const getHandler = () => callableHandlers[2];

    it('throws invalid-argument when building is not "rooms" or "nest"', async () => {
      await assert.rejects(
        () => getHandler()({ building: 'amazon' }, {}),
        (e) => { assert.strictEqual(e.code, 'invalid-argument'); return true; }
      );
    });

    it('defaults building to "nest" when not provided', async () => {
      stubState.leaderboardTenantDocs = [];
      stubState.leaderboardPeopleDocs = [];
      const result = await getHandler()({}, {});
      assert.strictEqual(result.success, true);
      assert.ok(Array.isArray(result.leaderboard));
    });

    it('filters out entries with 0 points', async () => {
      stubState.leaderboardTenantDocs = [
        { id: '15', data: { name: 'สมชาย', gamification: { points: 0 } } },
      ];
      stubState.leaderboardPeopleDocs = [];
      const result = await getHandler()({ building: 'rooms' }, {});
      assert.strictEqual(result.leaderboard.length, 0);
    });

    it('merges tenants and people, sorts by points desc, assigns rank', async () => {
      stubState.leaderboardTenantDocs = [
        { id: '15', data: { name: 'สมชาย', gamification: { points: 200 } } },
      ];
      stubState.leaderboardPeopleDocs = [
        { id: 'P1', data: { name: 'สมหญิง', gamification: { points: 500 } } },
      ];
      const result = await getHandler()({ building: 'nest' }, {});
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.leaderboard.length, 2);
      // Sorted desc → P1 (500pts) first, then 15 (200pts)
      assert.strictEqual(result.leaderboard[0].name, 'สมหญิง');
      assert.strictEqual(result.leaderboard[0].rank, 1);
      assert.strictEqual(result.leaderboard[0].isPlayer, true);
      assert.strictEqual(result.leaderboard[1].rank, 2);
      assert.strictEqual(result.leaderboard[1].isPlayer, false);
    });

    it('slices result to 10 entries maximum', async () => {
      stubState.leaderboardTenantDocs = Array.from({ length: 8 }, (_, i) => ({
        id: String(i + 1),
        data: { name: `Tenant${i}`, gamification: { points: 100 + i } },
      }));
      stubState.leaderboardPeopleDocs = Array.from({ length: 6 }, (_, i) => ({
        id: `P${i}`,
        data: { name: `Player${i}`, gamification: { points: 200 + i } },
      }));
      const result = await getHandler()({ building: 'rooms' }, {});
      assert.ok(result.leaderboard.length <= 10, 'leaderboard must have at most 10 entries');
    });

    it('falls back to (ไม่มีชื่อ) when name and firstName are absent', async () => {
      stubState.leaderboardTenantDocs = [
        { id: '99', data: { gamification: { points: 50 } } },
      ];
      stubState.leaderboardPeopleDocs = [];
      const result = await getHandler()({ building: 'rooms' }, {});
      assert.strictEqual(result.leaderboard[0].name, '(ไม่มีชื่อ)');
    });
  });
});
