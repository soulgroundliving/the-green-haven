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
                  docs: (world.tenantsByBuilding[building] || []).map((t) => ({ id: t.roomId, data: () => t })),
                }),
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
        set: (ref, data) => writes.push({ id: ref._id, data }),
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

const byId = (id) => writes.find((w) => w.id === id);

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
    assert.equal(writes.length, 1);
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

  it('exposes the scheduled CF as a callable handler', () => {
    assert.equal(typeof computeTrustScoresScheduled, 'function');
  });
});
