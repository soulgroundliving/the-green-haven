/**
 * Unit tests for createChecklistInstance Cloud Function.
 *
 * Design notes:
 *   - admin.firestore() is called at MODULE LOAD TIME (singleton), so the
 *     Module._load intercept must be installed BEFORE require('../createChecklistInstance').
 *   - All test-controlled state lives in closure variables reset in beforeEach().
 *   - HttpsError is a local class captured from the firebase-functions/v1 stub.
 *
 * Run: node --test functions/__tests__/createChecklistInstance.test.js
 */

'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ──────────────────────────────────────────────────────────────
// All mutable stub state lives here. resetStubs() is called in every beforeEach
// so tests cannot bleed into each other.

let templateData = null;   // null = doc not found; object = doc.data() return value
let setCalls     = [];
const FAKE_INSTANCE_ID = 'inst-test-001';

function resetStubs() {
  templateData = null;
  setCalls     = [];
}

resetStubs(); // initialise before anything else runs

// ── FieldValue sentinels ────────────────────────────────────────────────────
const SERVER_TIMESTAMP = '__serverTimestamp__';

// ── Firestore stub (returned as the module-load-time singleton) ─────────────
const fsInstance = {
  collection: (name) => {
    if (name === 'checklistTemplates') {
      return {
        doc: (_building) => ({
          get: async () => ({
            exists: templateData !== null,
            data:   () => templateData || {},
          }),
        }),
      };
    }

    if (name === 'checklistInstances') {
      return {
        doc: () => ({
          id:  FAKE_INSTANCE_ID,
          set: async (data) => { setCalls.push(data); },
        }),
      };
    }

    return {};
  },
};

// ── firebase-admin stub ─────────────────────────────────────────────────────
const adminStub = {
  apps:          [{}],
  initializeApp: () => {},
  firestore: Object.assign(
    () => fsInstance,
    {
      FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
      Timestamp:  {},
    }
  ),
};

// ── Module._load intercept ──────────────────────────────────────────────────
// Installed BEFORE require('../createChecklistInstance') so that every top-level
// require() inside the CF is intercepted at module-load time.

let capturedHandler = null;
let HttpsError;

const _origLoad = Module._load;

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    return adminStub;
  }

  if (request === 'firebase-functions/v1') {
    HttpsError = class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    };
    return {
      region: () => ({
        https: {
          HttpsError,
          onCall: (fn) => { capturedHandler = fn; return fn; },
        },
      }),
      https: { HttpsError },
    };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// ── Load CF under test ──────────────────────────────────────────────────────
// Require AFTER stubs are in place so the module-level admin.firestore() call
// and the onCall registration both see our stubs.
const cfExports = require('../createChecklistInstance');

after(() => {
  Module._load = _origLoad;
});

// ── Handler reference ───────────────────────────────────────────────────────
const handler = capturedHandler || cfExports.createChecklistInstance;

// ── Context helpers ─────────────────────────────────────────────────────────
const ADMIN_UID = 'admin-uid-1';

function adminCtx(uidOverride) {
  return {
    auth: {
      uid:   uidOverride || ADMIN_UID,
      token: { admin: true },
    },
  };
}

const noAuth = { auth: undefined };

// ── Valid input shorthand ───────────────────────────────────────────────────
const VALID_DATA = {
  building:   'rooms',
  roomId:     '15',
  tenantUid:  'tenant-uid-99',
  tenantRoom: '15',
  tenantName: 'สมชาย สิบห้า',
  type:       'move_in',
};

// ── Template helpers ────────────────────────────────────────────────────────
function makeTemplate(items) {
  return { items };
}

const SAMPLE_ITEMS = [
  { id: 'item-a', label: 'ประตู' },
  { id: 'item-b', label: 'หน้าต่าง' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('createChecklistInstance', () => {

  // ── Auth gates ─────────────────────────────────────────────────────────

  describe('auth gates', () => {
    beforeEach(() => resetStubs());

    it('throws unauthenticated when context.auth is undefined', async () => {
      await assert.rejects(
        () => handler(VALID_DATA, noAuth),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });

    it('throws unauthenticated when auth.uid is null', async () => {
      const ctx = { auth: { uid: null, token: { admin: true } } };
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
      );
    });

    it('throws permission-denied when admin token claim is absent', async () => {
      const ctx = { auth: { uid: 'uid-1', token: {} } };
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; }
      );
    });

    it('throws permission-denied when admin claim is explicitly false', async () => {
      const ctx = { auth: { uid: 'uid-1', token: { admin: false } } };
      await assert.rejects(
        () => handler(VALID_DATA, ctx),
        (err) => { assert.equal(err.code, 'permission-denied'); return true; }
      );
    });
  });

  // ── Input validation ───────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => resetStubs());

    it('throws invalid-argument when building is absent', async () => {
      const { building: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when building is not a string', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, building: 42 }, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when roomId is absent', async () => {
      const { roomId: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when roomId is not a string', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, roomId: 15 }, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when tenantUid is absent', async () => {
      const { tenantUid: _omit, ...rest } = VALID_DATA;
      await assert.rejects(
        () => handler(rest, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when tenantUid is not a string', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, tenantUid: true }, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('throws invalid-argument when type is an unrecognised value', async () => {
      await assert.rejects(
        () => handler({ ...VALID_DATA, type: 'invalid_type' }, adminCtx()),
        (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
      );
    });

    it('accepts type "move_in" without throwing a validation error', async () => {
      templateData = makeTemplate(SAMPLE_ITEMS);
      // Should not throw — just verify no validation HttpsError propagates
      const res = await handler({ ...VALID_DATA, type: 'move_in' }, adminCtx());
      assert.equal(res.instanceId, FAKE_INSTANCE_ID);
    });

    it('accepts type "move_out" without throwing a validation error', async () => {
      templateData = makeTemplate(SAMPLE_ITEMS);
      const res = await handler({ ...VALID_DATA, type: 'move_out' }, adminCtx());
      assert.equal(res.instanceId, FAKE_INSTANCE_ID);
    });
  });

  // ── Template loading ───────────────────────────────────────────────────

  describe('template loading', () => {
    beforeEach(() => resetStubs());

    it('throws not-found when template doc does not exist for the building', async () => {
      templateData = null; // doc does not exist
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx()),
        (err) => { assert.equal(err.code, 'not-found'); return true; }
      );
    });

    it('not-found message contains the building name', async () => {
      templateData = null;
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx()),
        (err) => {
          assert.ok(
            err.message.includes(VALID_DATA.building),
            `Expected message to contain "${VALID_DATA.building}", got: ${err.message}`
          );
          return true;
        }
      );
    });

    it('throws failed-precondition when template has an empty items array', async () => {
      templateData = makeTemplate([]);
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx()),
        (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
      );
    });

    it('throws failed-precondition when template.items is not an array', async () => {
      templateData = { items: 'not-an-array' };
      await assert.rejects(
        () => handler(VALID_DATA, adminCtx()),
        (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
      );
    });

    it('proceeds to create when template has at least one item', async () => {
      templateData = makeTemplate([{ id: 'x', label: 'test' }]);
      const res = await handler(VALID_DATA, adminCtx());
      assert.equal(res.instanceId, FAKE_INSTANCE_ID);
    });
  });

  // ── Instance creation — items mapping ─────────────────────────────────

  describe('instance creation — items mapping', () => {
    beforeEach(() => {
      resetStubs();
      templateData = makeTemplate(SAMPLE_ITEMS);
    });

    it('maps item.id and item.label from the template', async () => {
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      assert.equal(items[0].id,    'item-a');
      assert.equal(items[0].label, 'ประตู');
      assert.equal(items[1].id,    'item-b');
      assert.equal(items[1].label, 'หน้าต่าง');
    });

    it('sets note to empty string for each item', async () => {
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      items.forEach((item) => assert.equal(item.note, ''));
    });

    it('sets photoPath to null for each item', async () => {
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      items.forEach((item) => assert.equal(item.photoPath, null));
    });

    it('sets checked to false for each item', async () => {
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      items.forEach((item) => assert.equal(item.checked, false));
    });

    it('falls back to String(idx) when item.id is missing', async () => {
      templateData = makeTemplate([
        { label: 'ไม่มี id' },
        { label: 'อีกรายการ' },
      ]);
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      assert.equal(items[0].id, '0');
      assert.equal(items[1].id, '1');
    });

    it('falls back to empty string when item.label is missing', async () => {
      templateData = makeTemplate([{ id: 'no-label' }]);
      await handler(VALID_DATA, adminCtx());
      const { items } = setCalls[0];
      assert.equal(items[0].label, '');
    });
  });

  // ── Instance creation — document fields ───────────────────────────────

  describe('instance creation — document fields', () => {
    beforeEach(() => {
      resetStubs();
      templateData = makeTemplate(SAMPLE_ITEMS);
    });

    it('returns { instanceId: FAKE_INSTANCE_ID }', async () => {
      const res = await handler(VALID_DATA, adminCtx());
      assert.deepEqual(res, { instanceId: FAKE_INSTANCE_ID });
    });

    it('writes instanceId equal to the doc auto-id', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].instanceId, FAKE_INSTANCE_ID);
    });

    it('writes building, roomId, tenantUid, and type from input', async () => {
      await handler(VALID_DATA, adminCtx());
      const doc = setCalls[0];
      assert.equal(doc.building,  VALID_DATA.building);
      assert.equal(doc.roomId,    VALID_DATA.roomId);
      assert.equal(doc.tenantUid, VALID_DATA.tenantUid);
      assert.equal(doc.type,      VALID_DATA.type);
    });

    it('sets status to "pending"', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].status, 'pending');
    });

    it('sets createdBy to context.auth.uid', async () => {
      const uid = 'super-admin-42';
      await handler(VALID_DATA, adminCtx(uid));
      assert.equal(setCalls[0].createdBy, uid);
    });

    it('sets createdAt to serverTimestamp sentinel', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].createdAt, SERVER_TIMESTAMP);
    });

    it('sets updatedAt to serverTimestamp sentinel', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].updatedAt, SERVER_TIMESTAMP);
    });

    it('sets submittedAt to null', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].submittedAt, null);
    });

    it('sets adminSignedAt to null', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].adminSignedAt, null);
    });

    it('sets tenantSignaturePath to null', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].tenantSignaturePath, null);
    });

    it('sets adminSignaturePath to null', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].adminSignaturePath, null);
    });

    it('sets adminSignedBy to null', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].adminSignedBy, null);
    });
  });

  // ── Instance creation — optional field defaults ────────────────────────

  describe('instance creation — optional field defaults', () => {
    beforeEach(() => {
      resetStubs();
      templateData = makeTemplate(SAMPLE_ITEMS);
    });

    it('defaults tenantRoom to roomId when tenantRoom is not provided', async () => {
      const { tenantRoom: _omit, ...rest } = VALID_DATA;
      await handler(rest, adminCtx());
      assert.equal(setCalls[0].tenantRoom, VALID_DATA.roomId);
    });

    it('uses provided tenantRoom when it differs from roomId', async () => {
      await handler({ ...VALID_DATA, tenantRoom: 'room-alt' }, adminCtx());
      assert.equal(setCalls[0].tenantRoom, 'room-alt');
    });

    it('defaults tenantName to empty string when tenantName is not provided', async () => {
      const { tenantName: _omit, ...rest } = VALID_DATA;
      await handler(rest, adminCtx());
      assert.equal(setCalls[0].tenantName, '');
    });

    it('uses provided tenantName when supplied', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls[0].tenantName, VALID_DATA.tenantName);
    });
  });

  // ── set() called exactly once ──────────────────────────────────────────

  describe('firestore write', () => {
    beforeEach(() => {
      resetStubs();
      templateData = makeTemplate(SAMPLE_ITEMS);
    });

    it('calls ref.set() exactly once on success', async () => {
      await handler(VALID_DATA, adminCtx());
      assert.equal(setCalls.length, 1);
    });
  });
});
