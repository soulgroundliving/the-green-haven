/**
 * Unit tests for shared/checklist-manager.js — ChecklistManager facade (Tier 3I).
 *
 * ChecklistManager is a thin Firebase facade, but it carries real, bug-prone
 * logic worth locking:
 *   • Storage path construction (§7 checklist incidents — UID drift, PDPA paths)
 *   • `_dataUrlToBlob` — the atob decode that replaced `fetch('data:...')`
 *     (§7-Y: fetching a data URL is a CSP connect-src violation)
 *   • client-side sort/filter on instance queries (no composite index → done in JS)
 *   • getSignedUrl CF-first-with-fallback (PDPA 1h-URL preference)
 *   • CF-wrapper payload shapes
 *
 * The module is an IIFE that sets `window.ChecklistManager`, so the loader reads
 * it straight off the sandbox window (no shim needed). All Firebase access goes
 * through `window.firebase.*` (canonical client globals), which the loader mocks
 * with capturing spies; onSnapshot is driven from a per-test snapshot/error.
 *
 * Run: node --test shared/__tests__/checklist-manager.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// A Firestore query snapshot: docs are {id, data:()=>fields}; empty derived.
function makeSnap(docs = []) {
  return {
    empty: docs.length === 0,
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  };
}
// A createdAt Timestamp stub the module sorts on via `.toMillis()`.
const ts = (ms) => ({ toMillis: () => ms });

// Objects built INSIDE the vm sandbox (CF payloads, mapped docs, `|| []`
// defaults) carry the sandbox realm's Object/Array prototype, so deepStrictEqual
// rejects them as "same structure, not reference-equal". Round-trip through the
// host JSON to rebase into this realm before a structural compare.
const plain = (o) => JSON.parse(JSON.stringify(o));

// Build a capturing window.firebase mock. `cfg` drives the async results:
//   cfg.getDoc(ref)        → the DocumentSnapshot getTemplate reads
//   cfg.snapshot           → the QuerySnapshot onSnapshot delivers (default empty)
//   cfg.snapshotError      → if set, onSnapshot invokes its error callback instead
//   cfg.cf[name](payload)  → CF impl (may throw / return {data})
//   cfg.downloadURL        → getDownloadURL result
function makeFirebase(cfg = {}) {
  const calls = {
    doc: [], collection: [], getDoc: [], setDoc: [],
    where: [], orderBy: [], onSnapshot: 0, unsub: 0,
    storageRef: [], uploadBytes: [], getDownloadURL: [],
    httpsCallable: [], cf: [],
  };
  const firestoreFunctions = {
    collection: (_db, p) => { calls.collection.push(p); return { __t: 'collection', path: p }; },
    doc: (_db, p) => { calls.doc.push(p); return { __t: 'doc', path: p }; },
    getDoc: async (ref) => { calls.getDoc.push(ref.path); return cfg.getDoc ? cfg.getDoc(ref) : { exists: () => false }; },
    setDoc: async (ref, data) => { calls.setDoc.push({ path: ref.path, data }); },
    query: (coll, ...constraints) => ({ __t: 'query', coll, constraints }),
    where: (f, op, v) => { calls.where.push([f, op, v]); return { __c: 'where', f, op, v }; },
    orderBy: (f, dir) => { calls.orderBy.push([f, dir]); return { __c: 'orderBy', f, dir }; },
    onSnapshot: (_q, cb, errCb) => {
      calls.onSnapshot += 1;
      // Deliver asynchronously so the returned Promise is the thing under test.
      Promise.resolve().then(() => {
        if (cfg.snapshotError) errCb(cfg.snapshotError);
        else cb(cfg.snapshot || makeSnap([]));
      });
      return () => { calls.unsub += 1; };
    },
  };
  const storageFunctions = {
    ref: (_st, p) => { calls.storageRef.push(p); return { __t: 'storageRef', path: p }; },
    uploadBytes: async (ref, data, meta) => { calls.uploadBytes.push({ path: ref.path, data, meta }); return { ref }; },
    getDownloadURL: async (ref) => { calls.getDownloadURL.push(ref.path); return cfg.downloadURL || ('https://dl/' + ref.path); },
  };
  const functions = {
    httpsCallable: (name) => {
      calls.httpsCallable.push(name);
      return async (payload) => {
        calls.cf.push({ name, payload });
        if (cfg.cf && cfg.cf[name]) return cfg.cf[name](payload);
        return { data: {} };
      };
    },
  };
  const firebase = {
    firestore: () => ({ __db: true }),
    firestoreFunctions,
    storage: () => ({ __st: true }),
    storageFunctions,
    functions,
  };
  return { firebase, calls };
}

// Fresh sandbox per call → isolated state. Loads the IIFE and returns its export.
function loadCM(cfg = {}) {
  const { firebase, calls } = makeFirebase(cfg);
  const window = { firebase };
  const context = {
    window,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Date,
    Promise, Error, RegExp,
    parseInt, parseFloat, isFinite, isNaN,
    atob, Blob, Uint8Array,
    setTimeout: () => 0, clearTimeout: () => {},
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'checklist-manager.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'checklist-manager.js' });
  return { CM: context.window.ChecklistManager, calls };
}

// A 1×1 transparent PNG data URL (real base64 → exercises the atob decode).
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pY8AAAAAElFTkSuQmCC';

// ────────────────────────────────────────────────────────────────────────────
// module shape
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager — export shape', () => {
  test('exposes the documented facade methods', () => {
    const { CM } = loadCM();
    assert.equal(typeof CM, 'object');
    for (const m of [
      'getTemplate', 'saveTemplate', 'createInstance', 'getMyLatestInstance',
      'getMyPendingInstance', 'getInstanceForMyRoom', 'getActiveInstanceForRoom',
      'subscribeAdminInstances', 'uploadPhoto', 'uploadSignature',
      'uploadAdminSignature', 'getSignedUrl', 'submitChecklist',
      'adminSignChecklist', 'deleteInstance',
    ]) {
      assert.equal(typeof CM[m], 'function', `${m} is a function`);
    }
  });

  test('getMyPendingInstance is the deprecated alias of getMyLatestInstance', () => {
    const { CM } = loadCM();
    assert.equal(CM.getMyPendingInstance, CM.getMyLatestInstance);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getTemplate / saveTemplate
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.getTemplate', () => {
  test('reads checklistTemplates/{building} and unwraps id+data when present', async () => {
    const { CM, calls } = loadCM({
      getDoc: () => ({ exists: () => true, id: 'rooms', data: () => ({ items: [{ id: 'a', label: 'Key' }] }) }),
    });
    const tpl = await CM.getTemplate('rooms');
    assert.equal(calls.doc[0], 'checklistTemplates/rooms');
    assert.equal(tpl.id, 'rooms');
    assert.deepEqual(tpl.items, [{ id: 'a', label: 'Key' }]);
  });

  test('returns null when the template does not exist', async () => {
    const { CM } = loadCM({ getDoc: () => ({ exists: () => false }) });
    assert.equal(await CM.getTemplate('nest'), null);
  });
});

describe('ChecklistManager.saveTemplate', () => {
  test('writes building + items + a fresh updatedAt to checklistTemplates/{building}', async () => {
    const { CM, calls } = loadCM();
    await CM.saveTemplate('rooms', { items: [{ id: 'x', label: 'Door' }] });
    assert.equal(calls.setDoc.length, 1);
    const { path: p, data } = calls.setDoc[0];
    assert.equal(p, 'checklistTemplates/rooms');
    assert.equal(data.building, 'rooms');
    assert.deepEqual(data.items, [{ id: 'x', label: 'Door' }]);
    assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}T/); // ISO string
  });

  test('defaults items to [] when omitted', async () => {
    const { CM, calls } = loadCM();
    await CM.saveTemplate('rooms', {});
    assert.deepEqual(plain(calls.setDoc[0].data.items), []);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CF wrappers — createInstance / submit / adminSign / delete
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager — CF wrappers pass payloads + unwrap res.data', () => {
  test('createInstance calls createChecklistInstance and returns res.data', async () => {
    const { CM, calls } = loadCM({ cf: { createChecklistInstance: (p) => ({ data: { instanceId: 'I9', echo: p } }) } });
    const data = { building: 'rooms', roomId: '15', tenantUid: 'U1', type: 'move-in' };
    const res = await CM.createInstance(data);
    assert.equal(calls.httpsCallable[0], 'createChecklistInstance');
    assert.equal(res.instanceId, 'I9');
    assert.deepEqual(res.echo, data);
  });

  test('submitChecklist forwards {instanceId, items, tenantSignaturePath}', async () => {
    const { CM, calls } = loadCM({ cf: { submitChecklist: () => ({ data: { submitted: true } }) } });
    const res = await CM.submitChecklist('I1', [{ id: 'a', ok: true }], 'checklists/rooms/15/I1/signature_tenant.png');
    assert.deepEqual(plain(calls.cf[0]), {
      name: 'submitChecklist',
      payload: { instanceId: 'I1', items: [{ id: 'a', ok: true }], tenantSignaturePath: 'checklists/rooms/15/I1/signature_tenant.png' },
    });
    assert.equal(res.submitted, true);
  });

  test('adminSignChecklist forwards {instanceId, adminSignaturePath}', async () => {
    const { CM, calls } = loadCM({ cf: { adminSignChecklist: () => ({ data: { signed: true } }) } });
    const res = await CM.adminSignChecklist('I1', 'checklists/rooms/15/I1/signature_admin.png');
    assert.deepEqual(plain(calls.cf[0].payload), { instanceId: 'I1', adminSignaturePath: 'checklists/rooms/15/I1/signature_admin.png' });
    assert.equal(res.signed, true);
  });

  test('deleteInstance forwards {instanceId} and returns res.data', async () => {
    const { CM, calls } = loadCM({ cf: { deleteChecklistInstance: () => ({ data: { deleted: true, storageFilesDeleted: 3 } }) } });
    const res = await CM.deleteInstance('I1');
    assert.equal(calls.httpsCallable[0], 'deleteChecklistInstance');
    assert.deepEqual(plain(calls.cf[0].payload), { instanceId: 'I1' });
    assert.equal(res.storageFilesDeleted, 3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getMyLatestInstance — validation, empty, newest-first sort, error surface
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.getMyLatestInstance', () => {
  test('rejects when tenantUid is missing', async () => {
    const { CM } = loadCM();
    await assert.rejects(() => CM.getMyLatestInstance(''), /tenantUid required/);
  });

  test('queries by tenantUid equality', async () => {
    const { CM, calls } = loadCM({ snapshot: makeSnap([]) });
    await CM.getMyLatestInstance('U1');
    assert.deepEqual(calls.where[0], ['tenantUid', '==', 'U1']);
  });

  test('resolves null on an empty snapshot', async () => {
    const { CM } = loadCM({ snapshot: makeSnap([]) });
    assert.equal(await CM.getMyLatestInstance('U1'), null);
  });

  test('returns the newest instance by createdAt desc (client-side sort)', async () => {
    const { CM } = loadCM({
      snapshot: makeSnap([
        { id: 'old', data: { createdAt: ts(100), status: 'submitted' } },
        { id: 'new', data: { createdAt: ts(300), status: 'pending' } },
        { id: 'mid', data: { createdAt: ts(200), status: 'pending' } },
      ]),
    });
    const inst = await CM.getMyLatestInstance('U1');
    assert.equal(inst.id, 'new');
  });

  test('treats a missing createdAt as oldest (0)', async () => {
    const { CM } = loadCM({
      snapshot: makeSnap([
        { id: 'noTs', data: { status: 'pending' } },
        { id: 'hasTs', data: { createdAt: ts(50), status: 'pending' } },
      ]),
    });
    assert.equal((await CM.getMyLatestInstance('U1')).id, 'hasTs');
  });

  test('rejects (does not hang) when the subscription errors', async () => {
    const { CM } = loadCM({ snapshotError: new Error('permission-denied') });
    await assert.rejects(() => CM.getMyLatestInstance('U1'), /permission-denied/);
  });

  test('unsubscribes after resolving', async () => {
    const { CM, calls } = loadCM({ snapshot: makeSnap([{ id: 'x', data: { createdAt: ts(1) } }]) });
    await CM.getMyLatestInstance('U1');
    assert.equal(calls.unsub, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getInstanceForMyRoom — UID-drift-safe query (building+room, not authUid)
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.getInstanceForMyRoom', () => {
  test('rejects when building or roomId is missing', async () => {
    const { CM } = loadCM();
    await assert.rejects(() => CM.getInstanceForMyRoom('', '15'), /building and roomId required/);
    await assert.rejects(() => CM.getInstanceForMyRoom('rooms', ''), /building and roomId required/);
  });

  test('queries by building + roomId equality (stringified)', async () => {
    const { CM, calls } = loadCM({ snapshot: makeSnap([]) });
    await CM.getInstanceForMyRoom('rooms', 15);
    assert.deepEqual(calls.where[0], ['building', '==', 'rooms']);
    assert.deepEqual(calls.where[1], ['roomId', '==', '15']);
  });

  test('returns newest-first across the room', async () => {
    const { CM } = loadCM({
      snapshot: makeSnap([
        { id: 'a', data: { createdAt: ts(10) } },
        { id: 'b', data: { createdAt: ts(99) } },
      ]),
    });
    assert.equal((await CM.getInstanceForMyRoom('rooms', '15')).id, 'b');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getActiveInstanceForRoom — dedup guard: only pending|submitted, newest first
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.getActiveInstanceForRoom', () => {
  test('filters out archived/signed and keeps newest pending|submitted', async () => {
    const { CM } = loadCM({
      snapshot: makeSnap([
        { id: 'archived', data: { status: 'archived', createdAt: ts(999) } },
        { id: 'signed', data: { status: 'signed', createdAt: ts(998) } },
        { id: 'pendingOld', data: { status: 'pending', createdAt: ts(100) } },
        { id: 'submittedNew', data: { status: 'submitted', createdAt: ts(200) } },
      ]),
    });
    const active = await CM.getActiveInstanceForRoom('rooms', '15');
    assert.equal(active.id, 'submittedNew');
  });

  test('returns null when no instance is pending|submitted', async () => {
    const { CM } = loadCM({
      snapshot: makeSnap([{ id: 'signed', data: { status: 'signed', createdAt: ts(1) } }]),
    });
    assert.equal(await CM.getActiveInstanceForRoom('rooms', '15'), null);
  });

  test('returns null on an empty room', async () => {
    const { CM } = loadCM({ snapshot: makeSnap([]) });
    assert.equal(await CM.getActiveInstanceForRoom('rooms', '15'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// subscribeAdminInstances — live admin list (mapped docs + error wiring)
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.subscribeAdminInstances', () => {
  test('orders by createdAt desc and maps {id,...data} to the callback', async () => {
    const { CM, calls } = loadCM({
      snapshot: makeSnap([
        { id: 'i1', data: { roomId: '15', status: 'pending' } },
        { id: 'i2', data: { roomId: '16', status: 'submitted' } },
      ]),
    });
    const received = await new Promise((resolve) => {
      const unsub = CM.subscribeAdminInstances('rooms', (list) => { resolve(list); });
      assert.equal(typeof unsub, 'function');
    });
    assert.deepEqual(calls.where[0], ['building', '==', 'rooms']);
    assert.deepEqual(calls.orderBy[0], ['createdAt', 'desc']);
    assert.equal(received.length, 2);
    assert.deepEqual(plain(received[0]), { id: 'i1', roomId: '15', status: 'pending' });
  });

  test('routes subscription errors to the error callback', async () => {
    const { CM } = loadCM({ snapshotError: new Error('failed-precondition') });
    const err = await new Promise((resolve) => {
      CM.subscribeAdminInstances('rooms', () => {}, (e) => resolve(e));
    });
    assert.match(err.message, /failed-precondition/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// uploadPhoto — Storage path + extension derivation
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.uploadPhoto', () => {
  test('builds checklists/{b}/{r}/{instance}/item_{itemId}.{ext} and returns the path', async () => {
    const { CM, calls } = loadCM();
    const file = { name: 'kitchen.JPG' };
    const p = await CM.uploadPhoto('I1', 'rooms', '15', 'door', file);
    assert.equal(p, 'checklists/rooms/15/I1/item_door.jpg'); // ext lowercased
    assert.equal(calls.storageRef[0], p);
    assert.equal(calls.uploadBytes[0].path, p);
    assert.equal(calls.uploadBytes[0].data, file);
  });

  test('defaults the extension to jpg when the file has no name', async () => {
    const { CM } = loadCM();
    const p = await CM.uploadPhoto('I1', 'nest', '101', 'tap', {});
    assert.equal(p, 'checklists/nest/101/I1/item_tap.jpg');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// uploadSignature / uploadAdminSignature — data-URL → Blob, fixed paths
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.uploadSignature / uploadAdminSignature', () => {
  test('tenant signature → signature_tenant.png with image/png blob + contentType', async () => {
    const { CM, calls } = loadCM();
    const p = await CM.uploadSignature('I1', 'rooms', '15', PNG_1PX);
    assert.equal(p, 'checklists/rooms/15/I1/signature_tenant.png');
    const up = calls.uploadBytes[0];
    assert.equal(up.path, p);
    assert.equal(up.meta.contentType, 'image/png');
    assert.ok(up.data instanceof Blob, 'decoded to a Blob, not a fetch Response (§7-Y)');
    assert.equal(up.data.type, 'image/png');
    assert.ok(up.data.size > 0, 'base64 payload decoded to bytes');
  });

  test('admin signature → signature_admin.png', async () => {
    const { CM, calls } = loadCM();
    const p = await CM.uploadAdminSignature('I1', 'nest', '101', PNG_1PX);
    assert.equal(p, 'checklists/nest/101/I1/signature_admin.png');
    assert.equal(calls.uploadBytes[0].path, p);
  });

  test('rejects an invalid data URL instead of uploading garbage', async () => {
    const { CM, calls } = loadCM();
    await assert.rejects(() => CM.uploadSignature('I1', 'rooms', '15', 'not-a-data-url'), /Invalid data URL/);
    assert.equal(calls.uploadBytes.length, 0, 'no upload attempted on a bad payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getSignedUrl — CF-minted 1h URL preferred, getDownloadURL fallback (PDPA)
// ────────────────────────────────────────────────────────────────────────────

describe('ChecklistManager.getSignedUrl', () => {
  test('returns the CF-minted short-lived URL when available', async () => {
    const { CM, calls } = loadCM({ cf: { getChecklistMediaUrl: () => ({ data: { url: 'https://signed/1h' } }) } });
    const url = await CM.getSignedUrl('checklists/rooms/15/I1/item_door.jpg');
    assert.equal(url, 'https://signed/1h');
    assert.equal(calls.cf[0].payload.path, 'checklists/rooms/15/I1/item_door.jpg');
    assert.equal(calls.getDownloadURL.length, 0, 'no fallback when the CF succeeds');
  });

  test('falls back to getDownloadURL when the CF throws', async () => {
    const { CM, calls } = loadCM({
      cf: { getChecklistMediaUrl: () => { throw new Error('unauthenticated'); } },
      downloadURL: 'https://perm/url',
    });
    const url = await CM.getSignedUrl('checklists/rooms/15/I1/item_door.jpg');
    assert.equal(url, 'https://perm/url');
    assert.equal(calls.getDownloadURL[0], 'checklists/rooms/15/I1/item_door.jpg');
  });

  test('falls back when the CF returns no url field', async () => {
    const { CM, calls } = loadCM({
      cf: { getChecklistMediaUrl: () => ({ data: {} }) },
      downloadURL: 'https://perm/url2',
    });
    assert.equal(await CM.getSignedUrl('p/x.png'), 'https://perm/url2');
    assert.equal(calls.getDownloadURL.length, 1);
  });
});
