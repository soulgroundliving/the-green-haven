/**
 * Unit tests for adminApprovedLink — admin-mediated F2 LINE re-link.
 *
 * Covers: auth gate, input validation, building registry, tenant-record guard,
 * duplicate-room guard, liffUsers write shape, RTDB audit, and success response.
 *
 * Run: node --test functions/__tests__/adminApprovedLink.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured = {};

function resetStubs(overrides = {}) {
  stubState = {
    docs: {},          // path → data (undefined = not exists)
    setError: null,
    auditPushError: null,
    validBuildings: new Set(['rooms', 'nest']),
    ...overrides,
  };
  captured = {
    liffSet: null,     // { ref, payload, opts }
    auditSet: null,    // { path, data }
    fetchCalls: [],
  };
}
resetStubs();

// ── firebase-admin stub ───────────────────────────────────────────────────────

function makeSnap(path) {
  const data = stubState.docs[path];
  return {
    exists: data !== undefined && data !== null,
    data: () => (data ? { ...data } : {}),
    ref: { path },
  };
}

function makeDocRef(path) {
  return {
    path,
    collection: (sub) => makeColl(`${path}/${sub}`),
    get: async () => makeSnap(path),
    set: async (payload, opts) => {
      if (stubState.setError) throw stubState.setError;
      captured.liffSet = { path, payload, opts };
    },
  };
}

function makeColl(path) {
  return {
    path,
    doc: (id) => makeDocRef(`${path}/${id}`),
  };
}

const FieldValue = {
  delete: () => ({ _type: 'FieldValue.delete' }),
  serverTimestamp: () => ({ _type: 'FieldValue.serverTimestamp' }),
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  firestore: () => ({
    collection: (c) => makeColl(c),
  }),
  database: () => ({
    ref: (path) => ({
      push: () => ({
        set: async (data) => {
          if (stubState.auditPushError) throw stubState.auditPushError;
          captured.auditSet = { path, data };
        },
      }),
    }),
  }),
};
adminStub.firestore.FieldValue = FieldValue;

// ── buildingRegistry stub ─────────────────────────────────────────────────────

const buildingRegistryStub = {
  getValidBuildings: async () => stubState.validBuildings,
};

// ── fetch stub ───────────────────────────────────────────────────────────────

const fetchStub = (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  return Promise.resolve({ ok: true });
};

// ── Module._load intercept ────────────────────────────────────────────────────

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') return adminStub;
  if (request.endsWith('/buildingRegistry') || request === './buildingRegistry') return buildingRegistryStub;
  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const wrapOnCall = (h) => { const fn = (d, c) => h(d, c); fn.run = (d, c) => h(d, c); return fn; };
    return { https: { HttpsError, onCall: wrapOnCall }, region: () => ({ https: { HttpsError, onCall: wrapOnCall } }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.fetch = fetchStub;

// ── Load CF under test ────────────────────────────────────────────────────────

const { adminApprovedLink } = require('../adminApprovedLink');
const handler = adminApprovedLink.run;

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_CTX = {
  auth: { uid: 'adminUid', token: { admin: true, email: 'admin@example.com' } },
};
const NON_ADMIN_CTX = {
  auth: { uid: 'uid1', token: {} },
};

function makeData(overrides = {}) {
  return {
    lineUserId: 'Uabc123',
    building: 'rooms',
    room: '15',
    evidenceNote: 'ยืนยันตัวตนทางโทรศัพท์วิดีโอ',
    ...overrides,
  };
}

function seedTenant(building = 'rooms', room = '15', data = { name: 'สมชาย', tenantId: 'T1' }) {
  stubState.docs[`tenants/${building}/list/${room}`] = data;
}

function expectHttpsError(fn, code) {
  return fn.then(
    () => assert.fail('Expected HttpsError but resolved'),
    (e) => assert.equal(e.code, code, `Expected code=${code}, got ${e.code}: ${e.message}`)
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('adminApprovedLink', () => {
  beforeEach(() => resetStubs());

  describe('auth gate', () => {
    it('rejects non-admin caller', () => {
      seedTenant();
      return expectHttpsError(handler(makeData(), NON_ADMIN_CTX), 'permission-denied');
    });

    it('rejects missing auth', () => {
      return expectHttpsError(handler(makeData(), {}), 'permission-denied');
    });
  });

  describe('input validation', () => {
    it('rejects missing lineUserId', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ lineUserId: '' }), ADMIN_CTX), 'invalid-argument');
    });

    it('rejects lineUserId not starting with U', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ lineUserId: 'abc123' }), ADMIN_CTX), 'invalid-argument');
    });

    it('rejects missing building', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ building: '' }), ADMIN_CTX), 'invalid-argument');
    });

    it('rejects invalid room format', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ room: '!' }), ADMIN_CTX), 'invalid-argument');
    });

    it('rejects evidenceNote shorter than 10 chars', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ evidenceNote: 'short' }), ADMIN_CTX), 'invalid-argument');
    });

    it('rejects empty evidenceNote', () => {
      seedTenant();
      return expectHttpsError(handler(makeData({ evidenceNote: '' }), ADMIN_CTX), 'invalid-argument');
    });
  });

  describe('building validation', () => {
    it('rejects unknown building', () => {
      seedTenant('amazon', '15');
      stubState.validBuildings = new Set(['rooms', 'nest']); // 'amazon' not in registry
      return expectHttpsError(
        handler(makeData({ building: 'amazon' }), ADMIN_CTX),
        'invalid-argument'
      );
    });
  });

  describe('tenant record guard', () => {
    it('rejects when no tenant record exists at building/room', () => {
      // Do NOT seed a tenant doc
      return expectHttpsError(handler(makeData(), ADMIN_CTX), 'not-found');
    });
  });

  describe('duplicate room guard', () => {
    it('rejects when lineUserId already approved for a DIFFERENT room', () => {
      seedTenant();
      stubState.docs['liffUsers/Uabc123'] = {
        status: 'approved',
        building: 'rooms',
        room: '20',
      };
      return expectHttpsError(handler(makeData(), ADMIN_CTX), 'already-exists');
    });

    it('allows updating liffUsers doc that is pending (same line user submitting request)', async () => {
      seedTenant();
      stubState.docs['liffUsers/Uabc123'] = {
        status: 'pending',
        building: 'rooms',
        room: '15',
      };
      const result = await handler(makeData(), ADMIN_CTX);
      assert.equal(result.ok, true);
    });

    it('allows creating a fresh liffUsers doc (no prior entry)', async () => {
      seedTenant();
      // liffUsers/Uabc123 does not exist
      const result = await handler(makeData(), ADMIN_CTX);
      assert.equal(result.ok, true);
    });
  });

  describe('liffUsers write shape', () => {
    it('writes correct status=approved payload', async () => {
      seedTenant();
      await handler(makeData({ lineDisplayName: 'สมชาย ใหม่' }), ADMIN_CTX);
      const { payload } = captured.liffSet;
      assert.equal(payload.status, 'approved');
      assert.equal(payload.building, 'rooms');
      assert.equal(payload.room, '15');
      assert.equal(payload.lineUserId, 'Uabc123');
      assert.equal(payload.lineDisplayName, 'สมชาย ใหม่');
      assert.equal(payload.adminDirectLink, true);
      assert.equal(payload.approvedBy, 'admin@example.com');
      assert.ok(payload.adminDirectLinkNote.length >= 10);
    });

    it('clears rejection/terminal fields with FieldValue.delete', async () => {
      seedTenant();
      await handler(makeData(), ADMIN_CTX);
      const { payload } = captured.liffSet;
      assert.deepEqual(payload.rejectedAt, FieldValue.delete());
      assert.deepEqual(payload.rejectedBy, FieldValue.delete());
      assert.deepEqual(payload.rejectionReason, FieldValue.delete());
      assert.deepEqual(payload.unlinkedAt, FieldValue.delete());
      assert.deepEqual(payload.unlinkedBy, FieldValue.delete());
    });

    it('uses merge:true so existing fields are preserved', async () => {
      seedTenant();
      await handler(makeData(), ADMIN_CTX);
      assert.deepEqual(captured.liffSet.opts, { merge: true });
    });

    it('trims room whitespace', async () => {
      seedTenant('rooms', '15');
      await handler(makeData({ room: '  15  ' }), ADMIN_CTX);
      assert.equal(captured.liffSet.payload.room, '15');
    });
  });

  describe('RTDB audit log', () => {
    it('writes to audit_logs/admin_direct_link', async () => {
      seedTenant();
      await handler(makeData(), ADMIN_CTX);
      assert.ok(captured.auditSet, 'RTDB audit should be written');
      assert.equal(captured.auditSet.data.lineUserId, 'Uabc123');
      assert.equal(captured.auditSet.data.building, 'rooms');
      assert.equal(captured.auditSet.data.room, '15');
      assert.equal(captured.auditSet.data.adminEmail, 'admin@example.com');
      assert.ok(captured.auditSet.data.evidenceNote.length >= 10);
    });

    it('does NOT throw when RTDB audit write fails (non-fatal)', async () => {
      seedTenant();
      stubState.auditPushError = new Error('RTDB unavailable');
      const result = await handler(makeData(), ADMIN_CTX);
      assert.equal(result.ok, true); // Firestore write still succeeded
    });
  });

  describe('Firestore write failure', () => {
    it('throws internal error when liffUsers set fails', () => {
      seedTenant();
      stubState.setError = new Error('quota exceeded');
      return expectHttpsError(handler(makeData(), ADMIN_CTX), 'internal');
    });
  });

  describe('success response', () => {
    it('returns { ok, lineUserId, building, room, status }', async () => {
      seedTenant();
      const result = await handler(makeData(), ADMIN_CTX);
      assert.deepEqual(result, {
        ok: true,
        lineUserId: 'Uabc123',
        building: 'rooms',
        room: '15',
        status: 'approved',
      });
    });
  });

  describe('LINE notification', () => {
    it('fires best-effort notify (non-blocking)', async () => {
      seedTenant();
      await handler(makeData(), ADMIN_CTX);
      assert.ok(
        captured.fetchCalls.some(c => c.url.includes('notifyLiffRequest')),
        'Should fire notifyLiffRequest'
      );
    });
  });
});
