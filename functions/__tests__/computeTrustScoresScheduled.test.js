/**
 * Unit tests for computeTrustScoresScheduled.js — runTrustScoreSweep gather +
 * compute + write orchestration (Roadmap Phase 3.2a v1).
 *
 * Mocks firebase-admin (RTDB bills + Firestore leases/tenants/complaints + batch),
 * firebase-functions/v1 (so the scheduled export resolves to its raw handler), and
 * ./buildingRegistry (getAllBuildings). The pure ./_reputation core is REAL — this
 * verifies the wiring (occupancy gate, per-room bill grouping, provisional path,
 * doc shape), not the math (covered by _reputation.test.js).
 *
 * Run: node --test functions/__tests__/computeTrustScoresScheduled.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { REPUTATION_CONSTANTS: C } = require('../_reputation');
const NOW = Date.parse('2026-06-07T00:00:00.000Z');
const monthsAgo = (n) => NOW - n * C.MONTH_MS;
const weeksAgo = (n) => NOW - n * C.WEEK_MS - C.DAY_MS; // mid-week of bucket n

// ── Mutable test world + captured writes ─────────────────────────────────────
let world;
let writes;     // [{ id, data }] captured from batch.set on trustScores/{id}
let commits;

function resetWorld() {
  writes = [];
  commits = 0;
  world = {
    buildings: ['rooms'],
    billsByBuilding: {},       // { [building]: { [room]: { [billId]: bill } } }
    leasesByBuilding: {},      // { [building]: [ { roomId, status, moveInDate } ] }
    tenantsByBuilding: {},     // { [building]: [ { roomId, tenantId, status } ] }
    complaints: [],            // [ { building, room, createdAt } ]
    ledger: [],                // pointsLedger rows: [ { tenantId, source, points } ]
    helpRequests: [],          // [ { status, helperBuilding, helperRoom, requesterTenantId, requesterRoom, appreciationTags, completedAt } ]
  };
}
resetWorld();

// ── Stubs (installed before require) ─────────────────────────────────────────
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const rtdb = {
      ref: (path) => ({
        once: async () => {
          const parts = String(path).split('/'); // 'bills/rooms'
          let node = { bills: world.billsByBuilding };
          for (const p of parts) node = (node || {})[p];
          return { val: () => node ?? null };
        },
      }),
    };
    const fs = {
      collection: (name) => {
        if (name === 'complaints') {
          return { where: () => ({ get: async () => ({ forEach: (cb) => world.complaints.forEach((c) => cb({ data: () => c })) }) }) };
        }
        if (name.startsWith('leases/')) {
          const building = name.split('/')[1];
          return {
            where: (_f, _op, val) => ({
              get: async () => ({
                forEach: (cb) => (world.leasesByBuilding[building] || [])
                  .filter((L) => L.status === val)
                  .forEach((L) => cb({ data: () => L })),
              }),
            }),
          };
        }
        if (name === 'tenants') {
          return {
            doc: (building) => ({
              collection: () => ({
                get: async () => ({
                  // each doc carries a .ref so the sweep can batch.set the tier
                  // mirror onto the roster doc (tenants/{b}/list/{roomId})
                  docs: (world.tenantsByBuilding[building] || []).map((t) => ({
                    id: t.roomId, ref: { _col: 'tenants', _id: t.roomId }, data: () => t,
                  })),
                }),
              }),
            }),
          };
        }
        if (name === 'pointsLedger') {
          // .where('source','in',[...]).get() → rows whose source is in the array
          // (mirrors the real single-field `in` filter the kindness read uses).
          return {
            where: (_f, _op, vals) => ({
              get: async () => ({
                forEach: (cb) => (world.ledger || [])
                  .filter((e) => (Array.isArray(vals) ? vals.includes(e.source) : true))
                  .forEach((e) => cb({ data: () => e })),
              }),
            }),
          };
        }
        if (name === 'helpRequests') {
          // .where('status','==','done').get() → done jobs (single-field filter,
          // mirrors the real verified-helper read §7).
          return {
            where: (_f, _op, val) => ({
              get: async () => ({
                forEach: (cb) => (world.helpRequests || [])
                  .filter((h) => h.status === val)
                  .forEach((h) => cb({ data: () => h })),
              }),
            }),
          };
        }
        if (name === 'trustScores') {
          return { doc: (id) => ({ _col: 'trustScores', _id: id }) };
        }
        throw new Error(`unexpected collection(${name})`);
      },
      batch: () => ({
        set: (ref, data) => writes.push({ col: ref._col, id: ref._id, data }),
        commit: async () => { commits++; },
      }),
    };
    const firestoreFn = () => fs;
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };
    return { apps: [{}], initializeApp: () => {}, database: () => rtdb, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    const onRun = (h) => h;
    const chain = {
      runWith: () => chain,
      pubsub: { schedule: () => ({ timeZone: () => ({ onRun }) }) },
      https: { onCall: (h) => h },
    };
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    return { region: () => chain, https: { HttpsError } };
  }
  if (id === './buildingRegistry') {
    return { getAllBuildings: async () => world.buildings };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { runTrustScoreSweep, computeTrustScoresScheduled } = require('../computeTrustScoresScheduled');

const byId = (id) => writes.find((w) => w.col === 'trustScores' && w.id === id);
const byMirror = (roomId) => writes.find((w) => w.col === 'tenants' && w.id === roomId);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runTrustScoreSweep', () => {
  beforeEach(resetWorld);

  it('scores an active tenant with on-time bills → reputation 100', async () => {
    world.billsByBuilding = { rooms: { '15': {
      b1: { status: 'paid', dueDate: '2026-05-05', paidAt: Date.parse('2026-05-03Z') },
      b2: { status: 'paid', dueDate: '2026-04-05', paidAt: Date.parse('2026-04-03Z') },
    } } };
    world.leasesByBuilding = { rooms: [{ roomId: '15', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { rooms: [{ roomId: '15', tenantId: 't15', status: 'active' }] };

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.scored, 1);
    assert.equal(summary.skippedVacant, 0);
    const w = byId('t15');
    assert.ok(w, 'wrote trustScores/t15');
    assert.equal(w.data.reputation, 100);
    assert.equal(w.data.provisional, false);
    assert.equal(w.data.building, 'rooms');
    assert.equal(w.data.roomId, '15');
    assert.equal(w.data.tenantId, 't15');
    assert.equal(w.data.factors.onTimeBills, 2);
    assert.equal(w.data.factors.lateBills, 0);
    assert.equal(w.data.computedAt, '__ts__');
    // Kindness (#6) fields are ALWAYS written; no ledger here → seed/provisional.
    assert.equal(w.data.kindness, 0);
    assert.equal(w.data.kindnessProvisional, true);
    assert.equal(w.data.kindnessFactors.totalEvents, 0);
    // Verified Helper (#7) fields are ALWAYS written; no help jobs here → seed/provisional.
    assert.equal(w.data.verifiedHelper, 0);
    assert.equal(w.data.verifiedHelperProvisional, true);
    assert.equal(w.data.verifiedHelperFactors.completedCount, 0);
    // Resident Rank (#8) — derived from the three dims (here reputation 100 only).
    // 0.40·100 + 0.30·0 + 0.30·0 = 40. NOT provisional (reputation is real, has bills).
    assert.equal(w.data.residentRank, 40);
    assert.equal(w.data.residentRankProvisional, false);
    assert.equal(w.data.residentRankFactors.reputation, 100);
    assert.deepEqual(w.data.residentRankFactors.weights, { reputation: 0.40, kindness: 0.30, verifiedHelper: 0.30 });
  });

  it('skips vacant / unlinked rooms (occupancy gate)', async () => {
    world.tenantsByBuilding = { rooms: [
      { roomId: '15', tenantId: 't15', status: 'active' },
      { roomId: '16', tenantId: '', status: 'vacant' },   // no tenantId + vacant
      { roomId: '17', status: 'active' },                  // missing tenantId
    ] };
    world.leasesByBuilding = { rooms: [{ roomId: '15', status: 'active', moveInDate: monthsAgo(10) }] };

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.scored, 1);
    assert.equal(summary.skippedVacant, 2);
    assert.equal(writes.filter((w) => w.col === 'trustScores').length, 1); // 1 score (+1 tier mirror)
    assert.ok(byId('t15'));
  });

  it('no-bills tenant → provisional (payment reweighted out)', async () => {
    // No bills anywhere (e.g. a Nest tenant before Nest billing exists).
    world.leasesByBuilding = { rooms: [{ roomId: '20', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { rooms: [{ roomId: '20', tenantId: 't20', status: 'active' }] };

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.provisional, 1);
    const w = byId('t20');
    assert.equal(w.data.provisional, true);
    assert.equal(w.data.factors.paymentScore, null);
    // tenure(100) + complaint(100) renormalised → 100
    assert.equal(w.data.reputation, 100);
  });

  it('a recent complaint lowers the complaint factor', async () => {
    world.billsByBuilding = { rooms: { '15': { b1: { status: 'paid', dueDate: '2026-05-05', paidAt: Date.parse('2026-05-03Z') } } } };
    world.leasesByBuilding = { rooms: [{ roomId: '15', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { rooms: [{ roomId: '15', tenantId: 't15', status: 'active' }] };
    world.complaints = [{ building: 'rooms', room: '15', createdAt: new Date(NOW).toISOString() }]; // today

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.complaintsScanned, 1);
    const w = byId('t15');
    assert.equal(w.data.factors.complaintScore, 0);
    // payment100·0.6 + tenure100·0.25 + complaint0·0.15 = 85
    assert.equal(w.data.reputation, 85);
  });

  it('iterates multiple buildings and reports per-building written counts', async () => {
    world.buildings = ['rooms', 'nest'];
    world.leasesByBuilding = {
      rooms: [{ roomId: '15', status: 'active', moveInDate: monthsAgo(30) }],
      nest:  [{ roomId: 'A1', status: 'active', moveInDate: monthsAgo(30) }],
    };
    world.tenantsByBuilding = {
      rooms: [{ roomId: '15', tenantId: 't15', status: 'active' }],
      nest:  [{ roomId: 'A1', tenantId: 'tA1', status: 'active' }],
    };

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.scored, 2);
    assert.deepEqual(summary.buildings, [{ building: 'rooms', written: 1 }, { building: 'nest', written: 1 }]);
    assert.ok(byId('t15') && byId('tA1'));
  });

  it('mirrors the tier enums onto the tenant roster doc — tier-only, no leak (v1.x)', async () => {
    world.billsByBuilding = { rooms: { '15': {
      b1: { status: 'paid', dueDate: '2026-05-05', paidAt: Date.parse('2026-05-03Z') },
    } } };
    world.leasesByBuilding = { rooms: [{ roomId: '15', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { rooms: [{ roomId: '15', tenantId: 't15', status: 'active' }] };

    await runTrustScoreSweep({ nowMs: NOW });

    // trustScores doc keeps the full number + factors (admin-only)…
    assert.equal(byId('t15').data.reputation, 100);
    // …the tenant roster doc gets ONLY the coarse tier enums (no number/factors leak).
    // ONE combined mirror write carries reputationTier + kindnessTier (#6) +
    // verifiedHelperTier (#7) + residentRankTier (#8).
    const mirror = byMirror('15');
    assert.ok(mirror, 'wrote the tier enums onto tenants/rooms/list/15');
    assert.equal(mirror.data.reputationTier, 'high');
    assert.equal(mirror.data.kindnessTier, 'seed'); // no ledger here → seed
    assert.equal(mirror.data.verifiedHelperTier, 'newcomer'); // no help jobs → provisional → newcomer
    // reputation 100 + kindness 0 + vh 0 → composite 40 → rooted (the settled-resident rung)
    assert.equal(mirror.data.residentRankTier, 'rooted');
    assert.deepEqual(Object.keys(mirror.data), ['reputationTier', 'kindnessTier', 'verifiedHelperTier', 'residentRankTier']);
  });

  it('mirrors a provisional (0-bill) tenant as the provisional tier', async () => {
    world.leasesByBuilding = { rooms: [{ roomId: '20', status: 'active', moveInDate: monthsAgo(5) }] };
    world.tenantsByBuilding = { rooms: [{ roomId: '20', tenantId: 't20', status: 'active' }] };

    await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(byId('t20').data.provisional, true);
    assert.equal(byMirror('20').data.reputationTier, 'provisional');
    assert.equal(byMirror('20').data.kindnessTier, 'seed'); // no ledger → provisional → seed (#6)
  });

  it('computes kindness (#6) via the tenantId fallback when events carry no building/roomId', async () => {
    world.leasesByBuilding = { rooms: [
      { roomId: '15', status: 'active', moveInDate: monthsAgo(30) },
      { roomId: '16', status: 'active', moveInDate: monthsAgo(30) },
    ] };
    world.tenantsByBuilding = { rooms: [
      { roomId: '15', tenantId: 't15', status: 'active' },
      { roomId: '16', tenantId: 't16', status: 'active' },
    ] };
    world.ledger = [
      { tenantId: 't15', source: 'help_completed', points: 20 },
      { tenantId: 't15', source: 'food_share', points: 10 },
      { tenantId: 't15', source: 'quest', points: 5 },
      { tenantId: 't15', source: 'daily_login', points: 1 }, // excluded by the `in` query
      { tenantId: 't16', source: 'quest', points: 5 },        // single event → provisional
    ];

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    // daily_login filtered out by the source `in` query → 4 kindness rows scanned.
    assert.equal(summary.kindnessEventsScanned, 4);
    assert.equal(summary.kindnessProvisional, 1); // only t16 is below the event floor

    const w15 = byId('t15');
    assert.equal(w15.data.kindnessFactors.totalPoints, 35);
    assert.equal(w15.data.kindnessFactors.totalEvents, 3);
    assert.equal(w15.data.kindnessFactors.helpCompletedPoints, 20);
    assert.equal(w15.data.kindnessFactors.foodSharePoints, 10);
    assert.equal(w15.data.kindnessFactors.questPoints, 5);
    assert.equal(w15.data.kindnessProvisional, false); // 3 events ≥ floor
    assert.ok(w15.data.kindness > 0, 'positive kindness score');

    const w16 = byId('t16');
    assert.equal(w16.data.kindnessFactors.totalEvents, 1);
    assert.equal(w16.data.kindnessProvisional, true); // seed state

    // The tenant-doc mirror carries the derived kindnessTier (score → tier → mirror).
    assert.equal(byMirror('15').data.kindnessTier, 'kind');  // 35pts → kindness 12 (≥10) → kind
    assert.equal(byMirror('16').data.kindnessTier, 'seed');  // provisional → seed

    // Reputation is untouched by the kindness extension (separate concern).
    assert.equal(typeof w15.data.reputation, 'number');
  });

  it('joins kindness by (building, roomId) when the ledger tenantId is the ${building}_${room} form (§7-J fix)', async () => {
    // Real prod shape (verified 2026-06-10): claimQuest/completeHelpRequest/claimFood
    // tag the ledger `tenantId` with `${building}_${room}` (e.g. "nest_N101"), NOT the
    // canonical roster tenantId ("TENANT_…"). The sweep must still join these to the
    // roster tenant — by room key, not by id — or the score is silently 0 (§7-J).
    world.buildings = ['nest'];
    world.leasesByBuilding = { nest: [{ roomId: 'N101', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { nest: [{ roomId: 'N101', tenantId: 'TENANT_canon_15', status: 'occupied' }] };
    world.ledger = [
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
    ];

    await runTrustScoreSweep({ nowMs: NOW });

    // Doc keyed by the CANONICAL tenantId; kindness joined via the room key despite
    // the id mismatch. (With the old id-only join this would be totalEvents=0 / kindness=0.)
    const w = byId('TENANT_canon_15');
    assert.ok(w, 'wrote trustScores for the canonical tenantId');
    assert.equal(w.data.kindnessFactors.questCount, 4);
    assert.equal(w.data.kindnessFactors.totalPoints, 40);
    assert.equal(w.data.kindnessProvisional, false); // 4 events ≥ floor
    assert.ok(w.data.kindness > 0, 'kindness joined via room key, not 0');
  });

  it('computes verified-helper (#7) joining helpRequests by ${helperBuilding}_${helperRoom} (§7-J #330)', async () => {
    // helpRequests stamp helperTenantId as `${building}_${room}` (acceptHelpRequest.js),
    // NOT the canonical roster tenantId — the same §7-J trap kindness hit. The sweep
    // must join the helper's done jobs to the roster room by room key, or score 0.
    world.buildings = ['nest'];
    world.leasesByBuilding = { nest: [{ roomId: 'N101', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { nest: [{ roomId: 'N101', tenantId: 'TENANT_canon_15', status: 'occupied' }] };
    world.helpRequests = [
      // 4 confirmed-done jobs by the N101 helper across 3 DISTINCT requesters (+ tags)
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_a', appreciationTags: ['kind', 'fast'], completedAt: '2026-05-01T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_b', appreciationTags: ['friendly'], completedAt: '2026-06-02T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_c', appreciationTags: [], completedAt: '2026-06-10T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_a', appreciationTags: ['trusty'], completedAt: '2026-06-11T00:00:00Z' },
      // noise: an OPEN job (not done) must be ignored, and another room's job
      { status: 'open', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N999', requesterTenantId: 'req_y', appreciationTags: ['kind'], completedAt: '2026-06-01T00:00:00Z' },
    ];

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.verifiedHelperJobsScanned, 5); // 5 DONE jobs (the open one excluded)
    const w = byId('TENANT_canon_15');
    assert.ok(w, 'wrote trustScores for the canonical tenantId');
    assert.equal(w.data.verifiedHelperFactors.completedCount, 4);   // N999 job is a different room
    assert.equal(w.data.verifiedHelperFactors.distinctRequesters, 3); // req_a/b/c (a counted once)
    assert.equal(w.data.verifiedHelperFactors.totalTags, 4);
    assert.equal(w.data.verifiedHelperProvisional, false); // 4 ≥ VH_MIN_JOBS
    assert.ok(w.data.verifiedHelper > 0, 'verified-helper joined via room key, not 0');
    assert.equal(w.data.verifiedHelperFactors.lastCompletedAt, '2026-06-11T00:00:00Z');
    // tenant-doc mirror carries the derived verifiedHelperTier
    assert.ok(['helper', 'seasoned', 'trusted'].includes(byMirror('N101').data.verifiedHelperTier));
  });

  it('computes resident rank (#8) as the 40/30/30 blend of the three dims + mirrors the rung', async () => {
    // One tenant with real signal in ALL THREE dims: on-time bills (reputation 100),
    // 4 kind quest events (kindness 13), 4 confirmed help jobs across 3 requesters
    // (verifiedHelper 60). Composite = 0.40·100 + 0.30·13 + 0.30·60 = 61.9 → 62 → canopy.
    world.buildings = ['nest'];
    world.billsByBuilding = { nest: { N101: {
      b1: { status: 'paid', dueDate: '2026-05-05', paidAt: Date.parse('2026-05-03Z') },
    } } };
    world.leasesByBuilding = { nest: [{ roomId: 'N101', status: 'active', moveInDate: monthsAgo(30) }] };
    world.tenantsByBuilding = { nest: [{ roomId: 'N101', tenantId: 'TENANT_canon_15', status: 'active' }] };
    world.ledger = [
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'quest', points: 10 },
    ];
    world.helpRequests = [
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_a', appreciationTags: [], completedAt: '2026-05-01T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_b', appreciationTags: [], completedAt: '2026-06-02T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_c', appreciationTags: [], completedAt: '2026-06-10T00:00:00Z' },
      { status: 'done', helperBuilding: 'nest', helperRoom: 'N101', requesterTenantId: 'req_a', appreciationTags: [], completedAt: '2026-06-11T00:00:00Z' },
    ];

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    const w = byId('TENANT_canon_15');
    assert.ok(w, 'wrote trustScores for the canonical tenantId');
    assert.equal(w.data.reputation, 100);
    assert.equal(w.data.kindness, 13);        // 40pts/300 → 13
    assert.equal(w.data.verifiedHelper, 60);  // 4 jobs / 3 distinct, no tags → base 0.6
    // 0.40·100 + 0.30·13 + 0.30·60 = 61.9 → 62
    assert.equal(w.data.residentRank, 62);
    assert.equal(w.data.residentRankProvisional, false); // reputation real (has bills)
    assert.equal(w.data.residentRankFactors.reputation, 100);
    assert.equal(w.data.residentRankFactors.kindness, 13);
    assert.equal(w.data.residentRankFactors.verifiedHelper, 60);
    assert.equal(summary.residentRankProvisional, 0);
    // The tenant-doc mirror carries the derived rung (62 ≥ 55 → canopy).
    assert.equal(byMirror('N101').data.residentRankTier, 'canopy');
  });

  it('applies the Reputation v2 engagement bonus, joining pointsLedger by room key (§6 cadence)', async () => {
    // A no-bills (provisional) tenant: 6mo tenure (25) + 6mo complaint-free (50),
    // payment null → renorm base 34. 4 daily_login events across 4 DISTINCT weeks →
    // engagement 4/8 → +5 → reputation 39. daily_login is an ENGAGEMENT source but
    // NOT a kindness source, so kindness stays 0 (clean isolation).
    world.buildings = ['nest'];
    world.leasesByBuilding = { nest: [{ roomId: 'N101', status: 'active', moveInDate: monthsAgo(6) }] };
    world.tenantsByBuilding = { nest: [{ roomId: 'N101', tenantId: 'TENANT_canon_15', status: 'active' }] };
    world.ledger = [
      // §7-J: tagged by `${building}_${room}` (nest_N101), NOT the canonical tenantId
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'daily_login', points: 1, at: weeksAgo(0) },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'daily_login', points: 1, at: weeksAgo(1) },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'daily_login', points: 1, at: weeksAgo(2) },
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'daily_login', points: 1, at: weeksAgo(3) },
      // an OLD event (out of the 8-week window) must NOT count
      { tenantId: 'nest_N101', building: 'nest', roomId: 'N101', source: 'daily_login', points: 1, at: weeksAgo(20) },
    ];

    const summary = await runTrustScoreSweep({ nowMs: NOW });

    assert.equal(summary.engagementEventsScanned, 5); // all 5 daily_login rows read
    const w = byId('TENANT_canon_15');
    assert.ok(w, 'wrote trustScores for the canonical tenantId');
    assert.equal(w.data.factors.baseReputation, 34);          // v1 base
    assert.equal(w.data.factors.engagementActiveWeeks, 4);    // weeks 0-3 (week 20 out of window)
    assert.equal(w.data.factors.engagementBonus, 5);          // 4/8 → +5
    assert.equal(w.data.reputation, 39);                      // 34 + 5
    assert.equal(w.data.kindness, 0);                         // daily_login is NOT a kindness source
  });

  it('exposes the scheduled CF as a callable handler', () => {
    assert.equal(typeof computeTrustScoresScheduled, 'function');
  });
});
