/**
 * Unit tests for remindLeaseExpiry — scheduled pubsub CF.
 *
 * Tests exercise runExpirySweep() through the captured pubsub onRun handler.
 * All Firestore, admin, buildingRegistry and fetch calls are stubbed via
 * Module._load interception installed BEFORE the module is required.
 *
 * Run: node --test functions/__tests__/remindLeaseExpiry.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    token: 'line-tok',
    buildings: ['rooms'],
    // Array of lease doc descriptors for leases/{building}/list where status=active
    // Each: { id, data: { roomId, tenantId, tenantName, moveOutDate, status, lastExpiryTier? } }
    leaseDocs: [],
    // Map of "{building}_{roomId}" → array of lineUserId strings
    liffUsers: {},
    liffQueryError: null,
    // Array of notif doc descriptors for stale reconciliation
    // Each: { id, data: { building, room, tier, status } }
    notifDocs: [],
    // Map of leaseNotifications docId → existing doc data (null/undefined = not exists)
    leaseNotifExisting: {},
    leaseNotifSetError: null,
    lineOk: true,
    leasesQueryError: null,
    staleQueryError: null,
    ...overrides,
  };
  captured = {
    leaseUpdates: {},   // leaseId → last data passed to doc.ref.update()
    notifSets: {},      // docId → data passed to ref.set()
    notifUpdates: {},   // notifDocId → data passed to ref.update() (stale pass)
    fetchCalls: [],     // { url, opts }
  };
  process.env.LINE_CHANNEL_ACCESS_TOKEN = stubState.token;
}
resetStubs();

// ── FieldValue / Timestamp sentinels ─────────────────────────────────────────

const FieldValue = {
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
  delete: () => ({ _type: 'FieldValue.delete' }),
};

const Timestamp = {
  fromDate: (d) => ({ _type: 'Timestamp', date: d.toISOString() }),
};

// ── Firestore stub ────────────────────────────────────────────────────────────
// Tracks which building/room filter is active for liffUsers queries so we can
// route multi-.where() chains to the right stubState bucket.

let _liffWhereBuilding = '';
let _liffWhereRoom = '';

function makeCollectionQuery(colPath) {
  const q = {
    where: (field, op, val) => {
      if (field === 'building') _liffWhereBuilding = val;
      if (field === 'room')     _liffWhereRoom     = val;
      return q;
    },
    get: async () => {
      // ── leases/{building}/list ───────────────────────────────────────────
      if (colPath.startsWith('leases/')) {
        if (stubState.leasesQueryError) throw stubState.leasesQueryError;
        return {
          docs: stubState.leaseDocs.map(d => ({
            id: d.id,
            data: () => ({ ...d.data }),
            ref: {
              update: async (data) => {
                captured.leaseUpdates[d.id] = data;
              },
            },
          })),
        };
      }

      // ── liffUsers ────────────────────────────────────────────────────────
      if (colPath === 'liffUsers') {
        if (stubState.liffQueryError) throw stubState.liffQueryError;
        const key = `${_liffWhereBuilding}_${_liffWhereRoom}`;
        const users = stubState.liffUsers[key] || [];
        return {
          empty: users.length === 0,
          docs: users.map(uid => ({ id: uid })),
        };
      }

      // ── leaseNotifications (stale reconciliation query) ──────────────────
      if (colPath === 'leaseNotifications') {
        if (stubState.staleQueryError) throw stubState.staleQueryError;
        return {
          docs: stubState.notifDocs.map(d => ({
            id: d.id,
            data: () => ({ ...d.data }),
            ref: {
              update: async (data) => {
                captured.notifUpdates[d.id] = data;
              },
            },
          })),
        };
      }

      return { docs: [] };
    },
  };
  return q;
}

function makeDocRef(colPath, docId) {
  return {
    path: `${colPath}/${docId}`,
    get: async () => {
      const existing = stubState.leaseNotifExisting[docId];
      if (existing == null) {
        return { exists: false, data: () => ({}) };
      }
      return { exists: true, data: () => ({ ...existing }) };
    },
    set: async (data) => {
      if (stubState.leaseNotifSetError) throw stubState.leaseNotifSetError;
      captured.notifSets[docId] = data;
    },
  };
}

// ── Capture the scheduled handler ─────────────────────────────────────────────

let capturedScheduledHandler = null;

// ── Module._load interception ─────────────────────────────────────────────────
// Must run BEFORE the require() at the bottom of this file.

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  // ── firebase-admin ──────────────────────────────────────────────────────────
  if (request === 'firebase-admin') {
    const adminStub = {
      apps: [{}],
      initializeApp: () => {},
      firestore: () => ({
        collection: (name) => ({
          // For ensureLeaseNotificationDoc: .collection('leaseNotifications').doc(id)
          doc: (id) => makeDocRef(name, id),
          // For queries: .collection(...).where(...).get()
          where: (field, op, val) => {
            if (field === 'building') _liffWhereBuilding = val;
            if (field === 'room')     _liffWhereRoom     = val;
            return makeCollectionQuery(name);
          },
        }),
      }),
    };
    adminStub.firestore.FieldValue = FieldValue;
    adminStub.firestore.Timestamp  = Timestamp;
    return adminStub;
  }

  // ── ./buildingRegistry ──────────────────────────────────────────────────────
  if (request === './buildingRegistry' || request.endsWith('/buildingRegistry')) {
    return { getAllBuildings: async () => stubState.buildings };
  }

  // ── firebase-functions/v1 ───────────────────────────────────────────────────
  // Intercept the chained declaration:
  //   functions.region('...').runWith({...}).pubsub.schedule('...').timeZone('...').onRun(handler)
  // Capture handler so tests can call it directly.
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    const onRunCapture = (h) => {
      capturedScheduledHandler = h;
      return h;
    };
    const chainEnd   = { onRun: onRunCapture };
    const schedChain = { timeZone: () => chainEnd };
    const pubsubObj  = { schedule: () => schedChain };
    const runWithResult = {
      pubsub: pubsubObj,
      https: { HttpsError, onRequest: (h) => h },
    };
    return {
      region: () => ({ runWith: () => runWithResult }),
      https: { HttpsError, onRequest: (h) => h },
    };
  }

  // ── ./_auth (only needed by HTTP handler, not tested here) ──────────────────
  if (request === './_auth' || request.endsWith('/_auth')) {
    return { requireAdmin: async () => ({ uid: 'admin' }) };
  }

  return originalLoad.call(this, request, parent, isMain);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (!stubState.lineOk) {
    return { ok: false, status: 429, text: async () => 'limit exceeded' };
  }
  return { ok: true, status: 200, text: async () => '' };
};

// ── Require CF after all stubs are in place ───────────────────────────────────
delete require.cache[require.resolve('../remindLeaseExpiry.js')];
require('../remindLeaseExpiry');

after(() => {
  Module._load = originalLoad;
  if (typeof originalFetch === 'function') global.fetch = originalFetch;
  else delete global.fetch;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a lease doc descriptor where the moveOutDate is `daysLeft` days from now.
 * Positive daysLeft = future expiry; 0 = today; negative = already expired.
 */
function makeLeaseDoc(id, daysLeft, extra = {}) {
  const endMs     = Date.now() + daysLeft * 24 * 60 * 60 * 1000;
  const moveOutDate = new Date(endMs).toISOString().slice(0, 10);
  return {
    id,
    data: {
      roomId:     '15',
      tenantId:   'T1',
      tenantName: 'สมชาย',
      moveOutDate,
      status:     'active',
      ...extra,
    },
  };
}

function seedLease(id, daysLeft, extra = {}) {
  stubState.leaseDocs = [makeLeaseDoc(id, daysLeft, extra)];
}

function seedUsers(lineUserIds, key = 'rooms_15') {
  stubState.liffUsers[key] = lineUserIds;
}

// Convenience: run the sweep and return its result
async function runSweep() {
  return capturedScheduledHandler();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('remindLeaseExpiry — runExpirySweep', () => {
  beforeEach(() => resetStubs());

  // ────────────────────────────────────────────────────────────────────────────
  describe('no token → early return', () => {
    // Test 1
    it('returns scanned=0 immediately when LINE_CHANNEL_ACCESS_TOKEN is empty', async () => {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = '';
      const result = await runSweep();
      assert.equal(result.scanned, 0, 'scanned must be 0 when aborting early');
      assert.equal(result.sent,    0);
      assert.equal(result.errors,  0);
      assert.equal(captured.fetchCalls.length, 0, 'fetch must not be called');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('pickTier logic via result', () => {
    // Tests 2-7 verify tier assignment indirectly: we seed a lease + a user and
    // confirm which tier key ends up in captured.leaseUpdates[id].lastExpiryTier.

    // Test 2 — daysLeft=0 → 'expired'
    it('assigns tier="expired" when daysLeft is exactly 0', async () => {
      seedLease('L0', 0);
      seedUsers(['U1']);
      await runSweep();
      assert.equal(
        captured.leaseUpdates['L0']?.lastExpiryTier,
        'expired',
        'lease at day 0 must land in the expired tier'
      );
    });

    // Test 3 — daysLeft=10 → '14'
    it('assigns tier="14" when daysLeft is 10', async () => {
      seedLease('L10', 10);
      seedUsers(['U1']);
      await runSweep();
      assert.equal(captured.leaseUpdates['L10']?.lastExpiryTier, '14');
    });

    // Test 4 — daysLeft=25 → '30'
    it('assigns tier="30" when daysLeft is 25', async () => {
      seedLease('L25', 25);
      seedUsers(['U1']);
      await runSweep();
      assert.equal(captured.leaseUpdates['L25']?.lastExpiryTier, '30');
    });

    // Test 5 — daysLeft=45 → '60'
    it('assigns tier="60" when daysLeft is 45', async () => {
      seedLease('L45', 45);
      seedUsers(['U1']);
      await runSweep();
      assert.equal(captured.leaseUpdates['L45']?.lastExpiryTier, '60');
    });

    // Test 6 — daysLeft=61 → outside window → skipped (no update)
    it('skips the lease when daysLeft is 61 (beyond the 60-day window)', async () => {
      seedLease('L61', 61);
      seedUsers(['U1']);
      const result = await runSweep();
      assert.equal(
        captured.leaseUpdates['L61'],
        undefined,
        'no update must be written for a lease outside the alert window'
      );
      assert.ok(result.skipped >= 1, 'skipped counter must be incremented');
    });

    // Test 7 — daysLeft=-1 → post-expiry → skipped (no update)
    it('skips the lease when daysLeft is -1 (already past expiry)', async () => {
      seedLease('LNEG', -1);
      seedUsers(['U1']);
      const result = await runSweep();
      assert.equal(captured.leaseUpdates['LNEG'], undefined);
      assert.ok(result.skipped >= 1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('lease skips', () => {
    // Test 8 — missing moveOutDate
    it('skips a lease that has no moveOutDate field', async () => {
      stubState.leaseDocs = [{
        id: 'LNO_DATE',
        data: { roomId: '15', tenantId: 'T1', status: 'active' },
      }];
      const result = await runSweep();
      assert.ok(result.skipped >= 1, 'lease without moveOutDate must be skipped');
      assert.equal(captured.leaseUpdates['LNO_DATE'], undefined);
      assert.equal(captured.fetchCalls.length, 0);
    });

    // Test 9 — invalid moveOutDate
    it('skips a lease whose moveOutDate is not a valid date string', async () => {
      stubState.leaseDocs = [{
        id: 'LBAD_DATE',
        data: { roomId: '15', tenantId: 'T1', moveOutDate: 'not-a-date', status: 'active' },
      }];
      const result = await runSweep();
      assert.ok(result.skipped >= 1, 'lease with invalid date must be skipped');
      assert.equal(captured.leaseUpdates['LBAD_DATE'], undefined);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('anti-spam', () => {
    // Test 10 — same tier already recorded → skip
    it('skips the lease when lastExpiryTier already matches the current tier', async () => {
      // daysLeft=10 → tier='14'; lease already has lastExpiryTier='14'
      seedLease('L_SAME', 10, { lastExpiryTier: '14' });
      seedUsers(['U1']);
      const result = await runSweep();
      assert.equal(captured.leaseUpdates['L_SAME'], undefined, 'no update for same-tier lease');
      assert.equal(captured.fetchCalls.length, 0, 'no LINE push for same-tier lease');
      assert.ok(result.skipped >= 1);
    });

    // Test 11 — different tier → fires
    it('fires when lastExpiryTier differs from the current tier', async () => {
      // daysLeft=25 → tier='30'; lease has lastExpiryTier='60' (old tier)
      seedLease('L_DIFF', 25, { lastExpiryTier: '60' });
      seedUsers(['U1']);
      const result = await runSweep();
      assert.equal(
        captured.leaseUpdates['L_DIFF']?.lastExpiryTier,
        '30',
        'update must be written when tier changed from "60" to "30"'
      );
      assert.equal(captured.fetchCalls.length, 1, 'one LINE push must fire');
      assert.ok(result.sent >= 1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('bell write (ensureLeaseNotificationDoc)', () => {
    // Test 12 — new notification doc
    it('creates a new leaseNotifications doc with status:unread when none exists', async () => {
      seedLease('L_BELL', 10);
      seedUsers(['U1']);
      // leaseNotifExisting is empty → doc does not exist
      const result = await runSweep();
      const docId = 'rooms_15_14';
      assert.ok(
        captured.notifSets[docId] !== undefined,
        `notifSets must contain docId "${docId}"`
      );
      assert.equal(captured.notifSets[docId].status,   'unread');
      assert.equal(captured.notifSets[docId].tier,     '14');
      assert.equal(captured.notifSets[docId].building, 'rooms');
      assert.equal(captured.notifSets[docId].room,     '15');
      assert.ok(result.bellWrites >= 1, 'bellWrites must be incremented');
    });

    // Test 13 — existing doc with status:'unread' → no overwrite
    it('does not overwrite an existing leaseNotifications doc that is already unread', async () => {
      seedLease('L_EXIST', 10);
      seedUsers(['U1']);
      // Simulate an existing unread doc
      stubState.leaseNotifExisting['rooms_15_14'] = {
        status: 'unread', tier: '14', building: 'rooms', room: '15',
      };
      const result = await runSweep();
      assert.equal(
        captured.notifSets['rooms_15_14'],
        undefined,
        'set must NOT be called when the doc already exists as unread'
      );
      assert.equal(result.bellWrites, 0, 'bellWrites must be 0 when no new doc was created');
    });

    // Test 14 — existing doc with status:'stale' → resurrect (overwrite with status:'unread')
    it('overwrites a stale leaseNotifications doc with status:unread (resurrection)', async () => {
      seedLease('L_STALE', 10);
      seedUsers(['U1']);
      stubState.leaseNotifExisting['rooms_15_14'] = {
        status: 'stale', tier: '14', building: 'rooms', room: '15',
      };
      const result = await runSweep();
      assert.ok(
        captured.notifSets['rooms_15_14'] !== undefined,
        'set must be called to resurrect a stale notification doc'
      );
      assert.equal(captured.notifSets['rooms_15_14'].status, 'unread');
      assert.equal(result.bellWrites, 1, 'bellWrites must count the resurrected doc');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('LINE push and lease update', () => {
    // Test 15 — unlinked tenant (no liffUsers) → skip push, still update tier
    it('updates lastExpiryTier but sends no LINE message when tenant has no linked users', async () => {
      seedLease('L_UNLINKED', 25);
      // liffUsers stays empty for 'rooms_15'
      const result = await runSweep();
      assert.equal(captured.fetchCalls.length, 0, 'no LINE push when no linked users');
      assert.equal(
        captured.leaseUpdates['L_UNLINKED']?.lastExpiryTier,
        '30',
        'tier marker must still be updated even when no users are linked'
      );
      assert.ok(result.skipped >= 1, 'unlinked case contributes to skipped count');
    });

    // Test 16 — 1 linked user, LINE ok → sent=1 and tier update recorded
    it('sends 1 LINE push and updates lastExpiryTier when one linked user exists', async () => {
      seedLease('L_SEND', 25);
      seedUsers(['U_HAPPY']);
      const result = await runSweep();
      assert.equal(result.sent, 1, 'sent must be 1');
      assert.equal(captured.fetchCalls.length, 1, 'exactly one fetch must be made');
      assert.ok(
        captured.fetchCalls[0].url.includes('line.me'),
        'fetch URL must target LINE API'
      );
      assert.equal(captured.leaseUpdates['L_SEND']?.lastExpiryTier, '30');
    });

    // Test 17 — LINE push fails → error counted, sent=0, no lease update
    it('counts an error and does not update lastExpiryTier when LINE push fails', async () => {
      stubState.lineOk = false;
      seedLease('L_FAIL', 25);
      seedUsers(['U_FAIL']);
      const result = await runSweep();
      assert.equal(result.sent, 0, 'sent must be 0 on push failure');
      assert.ok(result.errors >= 1, 'errors must be incremented');
      assert.equal(
        captured.leaseUpdates['L_FAIL'],
        undefined,
        'lease must NOT be updated when all pushes failed'
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('stale reconciliation', () => {
    // Test 18 — notif exists for a building/room not in activeLeaseMap → mark stale
    it('marks a notification stale when its source lease is absent from the active lease map', async () => {
      // The sweep scans building='rooms', lease roomId='15'
      // The notif doc refers to room='99' → not in activeLeaseMap → stale
      seedLease('L_ACTIVE', 25);
      seedUsers(['U1']);
      stubState.notifDocs = [{
        id: 'rooms_99_30',
        data: { building: 'rooms', room: '99', tier: '30', status: 'unread' },
      }];
      const result = await runSweep();
      assert.equal(
        captured.notifUpdates['rooms_99_30']?.status,
        'stale',
        'notification must be marked stale when source lease is not in the active map'
      );
      assert.ok(
        typeof captured.notifUpdates['rooms_99_30']?.staleReason === 'string',
        'staleReason must be a string'
      );
      assert.equal(result.staleMarked, 1);
    });

    // Test 19 — lease still active but in a different tier → mark stale
    it('marks a notification stale when the lease has shifted to a different tier', async () => {
      // Lease at daysLeft=10 → tier='14'. Notif says tier='60' → stale.
      seedLease('L_SHIFT', 10);
      seedUsers(['U1']);
      stubState.notifDocs = [{
        id: 'rooms_15_60',
        data: { building: 'rooms', room: '15', tier: '60', status: 'unread' },
      }];
      const result = await runSweep();
      assert.equal(captured.notifUpdates['rooms_15_60']?.status, 'stale');
      assert.ok(
        captured.notifUpdates['rooms_15_60']?.staleReason.includes('tier shifted'),
        `expected "tier shifted" in staleReason, got: "${captured.notifUpdates['rooms_15_60']?.staleReason}"`
      );
      assert.equal(result.staleMarked, 1);
    });

    // Test 20 — lease extended past 60 days → mark stale
    it('marks a notification stale when the lease has been extended past 60 days', async () => {
      // daysLeft=90 → pickTier returns null → "extended past alert window"
      seedLease('L_EXT', 90);
      seedUsers(['U1']);
      stubState.notifDocs = [{
        id: 'rooms_15_30',
        data: { building: 'rooms', room: '15', tier: '30', status: 'unread' },
      }];
      const result = await runSweep();
      assert.equal(captured.notifUpdates['rooms_15_30']?.status, 'stale');
      assert.ok(
        captured.notifUpdates['rooms_15_30']?.staleReason.includes('extended past'),
        `expected "extended past" in staleReason, got: "${captured.notifUpdates['rooms_15_30']?.staleReason}"`
      );
      assert.equal(result.staleMarked, 1);
    });

    // Test 21 — lease still in the same tier as the notification → NOT stale
    it('does not mark a notification stale when the lease tier matches the notification tier', async () => {
      // daysLeft=25 → tier='30'. Notif also says tier='30' → same tier → no stale.
      seedLease('L_MATCH', 25);
      seedUsers(['U1']);
      stubState.notifDocs = [{
        id: 'rooms_15_30',
        data: { building: 'rooms', room: '15', tier: '30', status: 'unread' },
      }];
      const result = await runSweep();
      assert.equal(
        captured.notifUpdates['rooms_15_30'],
        undefined,
        'notification must NOT be updated when tier still matches'
      );
      assert.equal(result.staleMarked, 0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('return shape', () => {
    // Test 22 — successful sweep returns all expected keys
    it('returns an object with scanned/sent/bellWrites/staleMarked/skipped/errors/summary', async () => {
      seedLease('L_SHAPE', 25);
      seedUsers(['U1']);
      const result = await runSweep();
      const requiredKeys = ['scanned', 'sent', 'bellWrites', 'staleMarked', 'skipped', 'errors', 'summary'];
      for (const key of requiredKeys) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(result, key),
          `result must have key "${key}"`
        );
      }
      assert.ok(Array.isArray(result.summary), 'summary must be an array');
      assert.equal(result.scanned, 1, 'scanned must equal the number of lease docs iterated');
      assert.equal(result.sent,    1, 'sent must equal the number of successful pushes');
      assert.equal(result.bellWrites, 1, 'bellWrites must equal new notification docs created');
    });
  });
});
