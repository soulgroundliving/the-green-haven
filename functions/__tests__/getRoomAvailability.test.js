/**
 * Unit tests for getRoomAvailability — aggregated room availability for the booking calendar.
 *
 * Covers auth gate, building validation, occupied-room heuristics, active-booking
 * filtering (including expired-lock pruning), error propagation, and response shape.
 *
 * Run: node --test functions/__tests__/getRoomAvailability.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────
let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    validBuildings: new Set(['rooms', 'nest']),
    tenantDocs: [],          // array of { id, data }
    bookingDocs: [],         // array of { id, data }
    tenantsQueryError: null,
    bookingsQueryError: null,
    ...overrides,
  };
}
resetStubs();

// ── Firestore stub ────────────────────────────────────────────────────────────
// Supports two query patterns used by the CF:
//   1. collection('tenants').doc(b).collection('list').get()
//   2. collection('bookings').where(...).where(...).get()

function makeCollectionStub(name) {
  if (name === 'tenants') {
    return {
      doc: (_building) => ({
        collection: (_sub) => ({
          get: async () => {
            if (stubState.tenantsQueryError) throw stubState.tenantsQueryError;
            return {
              docs: stubState.tenantDocs.map(d => ({ id: d.id, data: () => d.data })),
            };
          },
        }),
      }),
    };
  }
  if (name === 'bookings') {
    // .where().where().get() — query chain returns same object with get()
    const q = {
      where: () => q,
      get: async () => {
        if (stubState.bookingsQueryError) throw stubState.bookingsQueryError;
        return {
          docs: stubState.bookingDocs.map(d => ({ id: d.id, data: () => d.data })),
        };
      },
    };
    return q;
  }
  return {
    doc: () => ({}),
    where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }),
  };
}

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({
    collection: (name) => makeCollectionStub(name),
  }),
};
adminStub.firestore.FieldValue = {
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
};

const buildingRegistryStub = {
  getValidBuildings: async () => stubState.validBuildings,
};

// ── Module interception (must happen BEFORE require('../getRoomAvailability')) ──
const _origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return adminStub;

  if (request.endsWith('/buildingRegistry') || request === './buildingRegistry') {
    return buildingRegistryStub;
  }

  if (request.endsWith('/_occupancy') || request === './_occupancy') {
    // Inline copy of the real isActiveTenant logic for test isolation —
    // same logic, no file-system dependency.
    return {
      isActiveTenant(td) {
        if (!td || typeof td !== 'object') return false;
        if (td.movedOut === true) return false;
        return !!(
          (typeof td.tenantId === 'string' && td.tenantId.trim()) ||
          (typeof td.linkedAuthUid === 'string' && td.linkedAuthUid.trim()) ||
          (td.lease && td.lease.status === 'active') ||
          (typeof td.name === 'string' && td.name.trim())
        );
      },
    };
  }

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    // region().https.onCall(handler) → returns handler directly
    return {
      region: () => ({ https: { HttpsError, onCall: (h) => h } }),
      https: { HttpsError },
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

const { getRoomAvailability: handler } = require('../getRoomAvailability');

// ── Context helpers ───────────────────────────────────────────────────────────
const ADMIN_CTX = { auth: { uid: 'adminUid', token: { admin: true } } };
const PROSPECT_CTX = { auth: { uid: 'prosp1', token: { role: 'prospect' } } };
const TENANT_CTX = { auth: { uid: 'uid1', token: { room: '15', building: 'rooms' } } };

// Asserts the promise rejects with an HttpsError whose code matches the expected.
function expectHttpsError(fn, code) {
  return fn.then(
    () => assert.fail(`Expected HttpsError(${code}) but the call resolved`),
    (e) => {
      assert.equal(e.code, code, `Expected code=${code}, got code=${e.code}: ${e.message}`);
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('getRoomAvailability', () => {
  beforeEach(() => resetStubs());

  // ── Auth gate ───────────────────────────────────────────────────────────────
  describe('auth gate', () => {
    it('no auth context → unauthenticated', async () => {
      await expectHttpsError(
        handler({ building: 'rooms' }, { auth: null }),
        'unauthenticated',
      );
    });

    it('auth without uid → unauthenticated', async () => {
      await expectHttpsError(
        handler({ building: 'rooms' }, { auth: { uid: '', token: { role: 'prospect' } } }),
        'unauthenticated',
      );
    });

    it('regular tenant (no admin, no prospect role) → permission-denied', async () => {
      await expectHttpsError(
        handler({ building: 'rooms' }, TENANT_CTX),
        'permission-denied',
      );
    });
  });

  // ── Building validation ─────────────────────────────────────────────────────
  describe('building validation', () => {
    it('missing building field → invalid-argument', async () => {
      await expectHttpsError(
        handler({}, ADMIN_CTX),
        'invalid-argument',
      );
    });

    it('null data → invalid-argument (treats building as missing)', async () => {
      await expectHttpsError(
        handler(null, ADMIN_CTX),
        'invalid-argument',
      );
    });

    it('unknown building ("amazon") → invalid-argument', async () => {
      await expectHttpsError(
        handler({ building: 'amazon' }, ADMIN_CTX),
        'invalid-argument',
      );
    });

    it('building normalised to lowercase: "ROOMS" is accepted, result.building = "rooms"', async () => {
      const result = await handler({ building: 'ROOMS' }, ADMIN_CTX);
      assert.equal(result.building, 'rooms');
    });
  });

  // ── Who can call ────────────────────────────────────────────────────────────
  describe('who can call', () => {
    it('admin (tok.admin=true) can query room availability', async () => {
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.ok(result, 'Expected a result object');
      assert.equal(result.building, 'rooms');
    });

    it('prospect (tok.role="prospect") can query room availability', async () => {
      const result = await handler({ building: 'rooms' }, PROSPECT_CTX);
      assert.ok(result, 'Expected a result object');
      assert.equal(result.building, 'rooms');
    });
  });

  // ── Occupied rooms ──────────────────────────────────────────────────────────
  describe('occupied rooms', () => {
    it('no tenant docs → occupied is empty array', async () => {
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.occupied, []);
    });

    it('tenant with tenantId → room ID is in occupied', async () => {
      stubState.tenantDocs = [
        { id: '15', data: { tenantId: 'T_2026_15' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.occupied, ['15']);
    });

    it('tenant with movedOut=true → NOT in occupied even with tenantId', async () => {
      stubState.tenantDocs = [
        { id: '15', data: { tenantId: 'T_2026_15', movedOut: true } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.occupied, []);
    });

    it('tenant with only legacy name field → in occupied', async () => {
      stubState.tenantDocs = [
        { id: '7', data: { name: 'สมชาย สิบห้า' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.occupied, ['7']);
    });

    it('vacant tenant doc (no tenantId, no linkedAuthUid, no lease, no name) → NOT in occupied', async () => {
      stubState.tenantDocs = [
        { id: '12', data: { movedOut: false, someOtherField: true } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.occupied, []);
    });

    it('multiple tenants: 2 active, 1 vacant → occupied has the 2 active room IDs', async () => {
      stubState.tenantDocs = [
        { id: '1', data: { tenantId: 'T_01' } },
        { id: '2', data: { linkedAuthUid: 'line:Uabc' } },
        { id: '3', data: {} },   // vacant — no identity fields
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.occupied.length, 2);
      assert.ok(result.occupied.includes('1'));
      assert.ok(result.occupied.includes('2'));
      assert.ok(!result.occupied.includes('3'));
    });
  });

  // ── Active bookings ─────────────────────────────────────────────────────────
  describe('active bookings', () => {
    it('no booking docs → activeBookings is empty array', async () => {
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.activeBookings, []);
    });

    it('booking with status="paid" → in activeBookings with lockedUntil=null', async () => {
      stubState.bookingDocs = [
        { id: 'BK1', data: { roomId: '15', status: 'paid', building: 'rooms' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.activeBookings.length, 1);
      assert.equal(result.activeBookings[0].roomId, '15');
      assert.equal(result.activeBookings[0].status, 'paid');
      assert.equal(result.activeBookings[0].lockedUntil, null);
    });

    it('booking status="locked" with future lockedUntil → in activeBookings', async () => {
      const futureTimestamp = { toMillis: () => Date.now() + 600000 };
      stubState.bookingDocs = [
        { id: 'BK2', data: { roomId: '7', status: 'locked', building: 'rooms', lockedUntil: futureTimestamp } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.activeBookings.length, 1);
      assert.equal(result.activeBookings[0].roomId, '7');
      assert.equal(result.activeBookings[0].status, 'locked');
    });

    it('booking status="locked" with expired lockedUntil (past) → NOT in activeBookings', async () => {
      const expiredTimestamp = { toMillis: () => Date.now() - 1 };
      stubState.bookingDocs = [
        { id: 'BK3', data: { roomId: '8', status: 'locked', building: 'rooms', lockedUntil: expiredTimestamp } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.activeBookings, []);
    });

    it('booking status="locked" with lockedUntil lacking toMillis() → treated as expired, NOT in activeBookings', async () => {
      stubState.bookingDocs = [
        { id: 'BK4', data: { roomId: '9', status: 'locked', building: 'rooms', lockedUntil: { notATimestamp: true } } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.deepEqual(result.activeBookings, []);
    });

    it('booking with valid lockedUntil → lockedUntil in result is the millisecond number', async () => {
      const futureMs = Date.now() + 600000;
      const futureTimestamp = { toMillis: () => futureMs };
      stubState.bookingDocs = [
        { id: 'BK5', data: { roomId: '10', status: 'locked', building: 'rooms', lockedUntil: futureTimestamp } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.activeBookings.length, 1);
      assert.equal(result.activeBookings[0].lockedUntil, futureMs);
    });

    it('booking with status="kyc_pending" → in activeBookings with lockedUntil=null', async () => {
      stubState.bookingDocs = [
        { id: 'BK6', data: { roomId: '11', status: 'kyc_pending', building: 'rooms' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.activeBookings.length, 1);
      assert.equal(result.activeBookings[0].status, 'kyc_pending');
    });

    it('booking with status="kyc_approved" → in activeBookings', async () => {
      stubState.bookingDocs = [
        { id: 'BK7', data: { roomId: '12', status: 'kyc_approved', building: 'rooms' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(result.activeBookings.length, 1);
      assert.equal(result.activeBookings[0].status, 'kyc_approved');
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────
  describe('error handling', () => {
    it('tenant query throws Firestore error → internal HttpsError', async () => {
      stubState.tenantsQueryError = new Error('Firestore unavailable');
      await expectHttpsError(
        handler({ building: 'rooms' }, ADMIN_CTX),
        'internal',
      );
    });

    it('bookings query throws Firestore error → internal HttpsError', async () => {
      stubState.bookingsQueryError = new Error('Quota exceeded');
      await expectHttpsError(
        handler({ building: 'rooms' }, ADMIN_CTX),
        'internal',
      );
    });
  });

  // ── Response shape ──────────────────────────────────────────────────────────
  describe('response shape', () => {
    it('full success returns { building, occupied, activeBookings, fetchedAt } with correct types', async () => {
      const futureTimestamp = { toMillis: () => Date.now() + 600000 };
      stubState.tenantDocs = [
        { id: '15', data: { tenantId: 'T_2026_15' } },
        { id: '16', data: { name: 'ทดสอบ ห้องสิบหก' } },
      ];
      stubState.bookingDocs = [
        { id: 'BK1', data: { roomId: '20', status: 'paid', building: 'rooms' } },
        { id: 'BK2', data: { roomId: '21', status: 'locked', building: 'rooms', lockedUntil: futureTimestamp } },
      ];

      const before = Date.now();
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      const after = Date.now();

      assert.equal(result.building, 'rooms');

      assert.ok(Array.isArray(result.occupied), 'occupied must be an array');
      assert.equal(result.occupied.length, 2);
      assert.ok(result.occupied.includes('15'));
      assert.ok(result.occupied.includes('16'));

      assert.ok(Array.isArray(result.activeBookings), 'activeBookings must be an array');
      assert.equal(result.activeBookings.length, 2);

      const paid = result.activeBookings.find(b => b.status === 'paid');
      assert.ok(paid, 'paid booking must appear in activeBookings');
      assert.equal(paid.roomId, '20');
      assert.equal(paid.lockedUntil, null);

      const locked = result.activeBookings.find(b => b.status === 'locked');
      assert.ok(locked, 'locked booking must appear in activeBookings');
      assert.equal(locked.roomId, '21');
      assert.ok(typeof locked.lockedUntil === 'number' && locked.lockedUntil > after,
        'lockedUntil must be a future millisecond number');

      assert.ok(typeof result.fetchedAt === 'number', 'fetchedAt must be a number');
      assert.ok(result.fetchedAt >= before && result.fetchedAt <= after,
        `fetchedAt ${result.fetchedAt} must be within [${before}, ${after}]`);
    });

    it('roomId and status fields in activeBookings are always strings', async () => {
      stubState.bookingDocs = [
        // Simulate numeric roomId coming from Firestore
        { id: 'BK8', data: { roomId: 15, status: 'paid', building: 'rooms' } },
      ];
      const result = await handler({ building: 'rooms' }, ADMIN_CTX);
      assert.equal(typeof result.activeBookings[0].roomId, 'string');
      assert.equal(typeof result.activeBookings[0].status, 'string');
      assert.equal(result.activeBookings[0].roomId, '15');
    });

    it('prospect caller also gets the same response shape', async () => {
      stubState.tenantDocs = [{ id: '5', data: { tenantId: 'T_05' } }];
      const result = await handler({ building: 'nest' }, PROSPECT_CTX);
      assert.equal(result.building, 'nest');
      assert.ok(Array.isArray(result.occupied));
      assert.ok(Array.isArray(result.activeBookings));
      assert.ok(typeof result.fetchedAt === 'number');
    });
  });
});
