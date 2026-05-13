/**
 * Unit tests for checklist Cloud Functions:
 *   createChecklistInstance, submitChecklist, adminSignChecklist, deleteChecklistInstance
 *
 * firebase-functions/v1 is stubbed so that `functions.region(...).https.onCall(fn)`
 * returns `fn` directly, making the exported symbol the async handler itself.
 *
 * Run: node --test functions/__tests__/checklist.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};

function resetStubs(overrides = {}) {
  stubState = {
    templateExists: true,
    templateItems: [{ id: 'f1', label: 'พัดลมเพดาน' }, { id: 'f2', label: 'ตู้เย็น' }],

    instanceExists: true,
    instanceData: {
      building: 'nest', roomId: '15', tenantUid: 'uid-tenant-1',
      type: 'move_in', status: 'pending',
      items: [{ id: 'f1', label: 'พัดลมเพดาน' }, { id: 'f2', label: 'ตู้เย็น' }],
    },

    storageFiles: [
      { name: 'checklists/nest/15/INST_123/item_f1.jpg' },
      { name: 'checklists/nest/15/INST_123/signature_tenant.png' },
    ],
    storageDeleteError: null,

    lastSetData:    null,
    lastUpdateData: null,
    lastDeletedId:  null,
    newDocId:       'INST_123',

    ...overrides,
  };
}

resetStubs();

// ── Module._load stubs ─────────────────────────────────────────────────────────

const Module = require('module');
const _origLoad = Module._load;

Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-functions/v1') {
    const HttpsError = class extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    const self = {
      region: () => self,
      https: { onCall: (fn) => fn, HttpsError },
      HttpsError,
    };
    return self;
  }

  if (id === 'firebase-admin') {
    const firestoreFn = function () {
      return {
        collection: (coll) => {
          if (coll === 'checklistTemplates') {
            return {
              doc: () => ({
                get: async () => ({
                  exists: stubState.templateExists,
                  data: () => ({ items: stubState.templateItems }),
                }),
              }),
            };
          }
          if (coll === 'checklistInstances') {
            return {
              doc: (docId) => {
                if (!docId) {
                  // New doc (createChecklistInstance)
                  return {
                    id: stubState.newDocId,
                    set: async (data) => { stubState.lastSetData = data; },
                  };
                }
                // Existing doc (submit / adminSign / delete)
                return {
                  get: async () => ({
                    exists: stubState.instanceExists,
                    data: () => ({ ...stubState.instanceData }),
                  }),
                  update: async (data) => { stubState.lastUpdateData = data; },
                  delete: async () => { stubState.lastDeletedId = docId; },
                };
              },
            };
          }
          return { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) };
        },
      };
    };
    firestoreFn.FieldValue = { serverTimestamp: () => '__ts__' };

    const storageFn = () => ({
      bucket: () => ({
        getFiles: async ({ prefix }) => {
          const matched = stubState.storageFiles.filter(f => f.name.startsWith(prefix));
          return [matched.map(f => ({
            delete: async () => {
              if (stubState.storageDeleteError) throw stubState.storageDeleteError;
              stubState.storageFiles = stubState.storageFiles.filter(x => x.name !== f.name);
            },
          }))];
        },
      }),
    });

    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
      storage: storageFn,
    };
  }

  return _origLoad.call(this, id, parent, ...rest);
};

// Load modules AFTER stubs installed
const { createChecklistInstance } = require('../createChecklistInstance');
const { submitChecklist }          = require('../submitChecklist');
const { adminSignChecklist }       = require('../adminSignChecklist');
const { deleteChecklistInstance }  = require('../deleteChecklistInstance');

// ── Auth context helpers ───────────────────────────────────────────────────────

function adminCtx(uid = 'admin-uid') {
  return { auth: { uid, token: { admin: true } } };
}
function tenantCtx(uid = 'uid-tenant-1') {
  return { auth: { uid, token: {} } };
}
const noAuth = { auth: null };

// ── createChecklistInstance ───────────────────────────────────────────────────

describe('createChecklistInstance', () => {
  beforeEach(() => resetStubs());

  const valid = {
    building: 'nest', roomId: '15', tenantUid: 'uid-tenant-1',
    type: 'move_in', tenantName: 'สมชาย',
  };

  it('creates instance from template and returns instanceId', async () => {
    const res = await createChecklistInstance(valid, adminCtx());
    assert.equal(res.instanceId, 'INST_123');
    assert.equal(stubState.lastSetData.building, 'nest');
    assert.equal(stubState.lastSetData.roomId, '15');
    assert.equal(stubState.lastSetData.status, 'pending');
    assert.equal(stubState.lastSetData.type, 'move_in');
    assert.equal(stubState.lastSetData.items.length, 2);
    assert.equal(stubState.lastSetData.items[0].checked, false);
    assert.equal(stubState.lastSetData.items[0].note, '');
    assert.equal(stubState.lastSetData.createdAt, '__ts__');
  });

  it('throws unauthenticated when no auth', async () => {
    await assert.rejects(
      () => createChecklistInstance(valid, noAuth),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('throws permission-denied for non-admin', async () => {
    await assert.rejects(
      () => createChecklistInstance(valid, tenantCtx()),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('throws invalid-argument when building is missing', async () => {
    await assert.rejects(
      () => createChecklistInstance({ ...valid, building: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when roomId is missing', async () => {
    await assert.rejects(
      () => createChecklistInstance({ ...valid, roomId: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when tenantUid is missing', async () => {
    await assert.rejects(
      () => createChecklistInstance({ ...valid, tenantUid: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument for unknown type', async () => {
    await assert.rejects(
      () => createChecklistInstance({ ...valid, type: 'move_sideways' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws not-found when template does not exist', async () => {
    resetStubs({ templateExists: false });
    await assert.rejects(
      () => createChecklistInstance(valid, adminCtx()),
      (err) => { assert.equal(err.code, 'not-found'); return true; }
    );
  });

  it('throws failed-precondition when template has no items', async () => {
    resetStubs({ templateItems: [] });
    await assert.rejects(
      () => createChecklistInstance(valid, adminCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });
});

// ── submitChecklist ───────────────────────────────────────────────────────────

describe('submitChecklist', () => {
  beforeEach(() => resetStubs());

  const valid = {
    instanceId: 'INST_123',
    items: [{ id: 'f1', checked: true, note: 'ปกติ', photoPath: null }],
    tenantSignaturePath: 'checklists/nest/15/INST_123/signature_tenant.png',
  };

  it('marks instance submitted and persists filled items', async () => {
    const res = await submitChecklist(valid, tenantCtx());
    assert.equal(res.submitted, true);
    assert.equal(stubState.lastUpdateData.status, 'submitted');
    assert.equal(stubState.lastUpdateData.tenantSignaturePath, valid.tenantSignaturePath);
    assert.equal(stubState.lastUpdateData.updatedAt, '__ts__');
    assert.equal(stubState.lastUpdateData.items[0].checked, true);
  });

  it('throws unauthenticated when no auth', async () => {
    await assert.rejects(
      () => submitChecklist(valid, noAuth),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('throws invalid-argument when instanceId is missing', async () => {
    await assert.rejects(
      () => submitChecklist({ ...valid, instanceId: '' }, tenantCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when items is not an array', async () => {
    await assert.rejects(
      () => submitChecklist({ ...valid, items: 'bad' }, tenantCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when tenantSignaturePath is missing', async () => {
    await assert.rejects(
      () => submitChecklist({ ...valid, tenantSignaturePath: '' }, tenantCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws not-found when instance does not exist', async () => {
    resetStubs({ instanceExists: false });
    await assert.rejects(
      () => submitChecklist(valid, tenantCtx()),
      (err) => { assert.equal(err.code, 'not-found'); return true; }
    );
  });

  it('throws permission-denied when caller does not own the instance', async () => {
    await assert.rejects(
      () => submitChecklist(valid, tenantCtx('other-uid')),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('throws failed-precondition when instance is already submitted', async () => {
    resetStubs({
      instanceData: {
        building: 'nest', roomId: '15', tenantUid: 'uid-tenant-1',
        type: 'move_in', items: [], status: 'submitted',
      },
    });
    await assert.rejects(
      () => submitChecklist(valid, tenantCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });

  it('truncates note at 500 chars and strips unknown fields', async () => {
    const longNote = 'x'.repeat(600);
    await submitChecklist({
      ...valid,
      items: [{ id: 'f1', checked: true, note: longNote, photoPath: null, injected: 'bad' }],
    }, tenantCtx());
    const item = stubState.lastUpdateData.items[0];
    assert.equal(item.note.length, 500);
    assert.equal(item.injected, undefined, 'extra fields must be stripped');
  });
});

// ── adminSignChecklist ────────────────────────────────────────────────────────

describe('adminSignChecklist', () => {
  beforeEach(() => resetStubs({
    instanceData: {
      building: 'nest', roomId: '15', tenantUid: 'uid-t',
      type: 'move_in', items: [], status: 'submitted',
    },
  }));

  const valid = {
    instanceId: 'INST_123',
    adminSignaturePath: 'checklists/nest/15/INST_123/signature_admin.png',
  };

  it('marks instance admin_signed with correct fields', async () => {
    const res = await adminSignChecklist(valid, adminCtx());
    assert.equal(res.signed, true);
    assert.equal(stubState.lastUpdateData.status, 'admin_signed');
    assert.equal(stubState.lastUpdateData.adminSignaturePath, valid.adminSignaturePath);
    assert.equal(stubState.lastUpdateData.adminSignedBy, 'admin-uid');
    assert.equal(stubState.lastUpdateData.adminSignedAt, '__ts__');
    assert.equal(stubState.lastUpdateData.updatedAt, '__ts__');
  });

  it('throws unauthenticated when no auth', async () => {
    await assert.rejects(
      () => adminSignChecklist(valid, noAuth),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('throws permission-denied for non-admin', async () => {
    await assert.rejects(
      () => adminSignChecklist(valid, tenantCtx()),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('throws invalid-argument when instanceId is missing', async () => {
    await assert.rejects(
      () => adminSignChecklist({ ...valid, instanceId: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws invalid-argument when adminSignaturePath is missing', async () => {
    await assert.rejects(
      () => adminSignChecklist({ ...valid, adminSignaturePath: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws not-found when instance does not exist', async () => {
    resetStubs({ instanceExists: false, instanceData: {} });
    await assert.rejects(
      () => adminSignChecklist(valid, adminCtx()),
      (err) => { assert.equal(err.code, 'not-found'); return true; }
    );
  });

  it('throws failed-precondition when status is not submitted', async () => {
    resetStubs({
      instanceData: {
        building: 'nest', roomId: '15', tenantUid: 'uid-t',
        type: 'move_in', items: [], status: 'pending',
      },
    });
    await assert.rejects(
      () => adminSignChecklist(valid, adminCtx()),
      (err) => { assert.equal(err.code, 'failed-precondition'); return true; }
    );
  });
});

// ── deleteChecklistInstance ───────────────────────────────────────────────────

describe('deleteChecklistInstance', () => {
  beforeEach(() => resetStubs({
    instanceData: {
      building: 'nest', roomId: '15', tenantUid: 'uid-t',
      type: 'move_in', items: [], status: 'pending',
    },
  }));

  it('deletes Firestore doc and all matching Storage files', async () => {
    const res = await deleteChecklistInstance({ instanceId: 'INST_123' }, adminCtx());
    assert.equal(res.deleted, true);
    assert.equal(res.storageFilesDeleted, 2);
    assert.equal(stubState.lastDeletedId, 'INST_123');
    assert.equal(stubState.storageFiles.length, 0, 'all storage files should be removed');
  });

  it('throws unauthenticated when no auth', async () => {
    await assert.rejects(
      () => deleteChecklistInstance({ instanceId: 'INST_123' }, noAuth),
      (err) => { assert.equal(err.code, 'unauthenticated'); return true; }
    );
  });

  it('throws permission-denied for non-admin', async () => {
    await assert.rejects(
      () => deleteChecklistInstance({ instanceId: 'INST_123' }, tenantCtx()),
      (err) => { assert.equal(err.code, 'permission-denied'); return true; }
    );
  });

  it('throws invalid-argument when instanceId is missing', async () => {
    await assert.rejects(
      () => deleteChecklistInstance({ instanceId: '' }, adminCtx()),
      (err) => { assert.equal(err.code, 'invalid-argument'); return true; }
    );
  });

  it('throws not-found when instance does not exist', async () => {
    resetStubs({ instanceExists: false, instanceData: {} });
    await assert.rejects(
      () => deleteChecklistInstance({ instanceId: 'INST_123' }, adminCtx()),
      (err) => { assert.equal(err.code, 'not-found'); return true; }
    );
  });

  it('still deletes Firestore doc when Storage cleanup fails', async () => {
    resetStubs({
      instanceData: {
        building: 'nest', roomId: '15', tenantUid: 'uid-t',
        type: 'move_in', items: [], status: 'pending',
      },
      storageDeleteError: new Error('bucket unavailable'),
    });
    const res = await deleteChecklistInstance({ instanceId: 'INST_123' }, adminCtx());
    assert.equal(res.deleted, true, 'should return deleted:true despite storage error');
    assert.equal(stubState.lastDeletedId, 'INST_123', 'Firestore doc must still be deleted');
  });
});
