/**
 * Unit tests for getChecklistMediaUrl — claim-based gate + signed URL minting.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let instanceDocs;
let signedUrlReturn;
let signedUrlErr;
let lastSignArgs;

function resetStubs() {
  instanceDocs = {};
  signedUrlReturn = 'https://storage.googleapis.com/signed?TOKEN';
  signedUrlErr = null;
  lastSignArgs = null;
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: () => ({
        doc: (id) => ({
          get: async () => ({
            exists: id in instanceDocs,
            data: () => instanceDocs[id],
          }),
        }),
      }),
    });
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
      storage: () => ({
        bucket: () => ({
          file: (path) => ({
            getSignedUrl: async (opts) => {
              lastSignArgs = { path, opts };
              if (signedUrlErr) throw signedUrlErr;
              return [signedUrlReturn];
            },
          }),
        }),
      }),
    };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { getChecklistMediaUrl: handler, SIGNED_URL_TTL_MS, PATH_PATTERN } =
  require('../getChecklistMediaUrl');

function ctx({ admin = false, room = '', building = '' } = {}) {
  return { auth: { uid: 'u1', token: { admin, room, building } } };
}

describe('getChecklistMediaUrl', () => {
  beforeEach(resetStubs);

  it('admin can sign any path with no instance check', async () => {
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo_1.jpg' },
      ctx({ admin: true }),
    );
    assert.ok(res.url);
    assert.ok(res.expiresAt > Date.now());
    assert.equal(lastSignArgs.path, 'checklists/rooms/15/inst-1/photo_1.jpg');
    assert.equal(lastSignArgs.opts.action, 'read');
    assert.equal(lastSignArgs.opts.version, 'v4');
  });

  it('expiresAt is ~1 hour out', async () => {
    const before = Date.now();
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo_1.jpg' },
      ctx({ admin: true }),
    );
    const expectedRange = [before + SIGNED_URL_TTL_MS - 100, before + SIGNED_URL_TTL_MS + 1000];
    assert.ok(res.expiresAt >= expectedRange[0] && res.expiresAt <= expectedRange[1],
      `expiresAt ${res.expiresAt} should be in ${expectedRange.join('..')}`);
  });

  it('tenant with matching claims AND matching instance → success', async () => {
    instanceDocs['inst-1'] = { building: 'rooms', roomId: '15' };
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/signature_tenant.png' },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.ok(res.url);
  });

  it('tenant with wrong room claim → permission-denied', async () => {
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ room: '14', building: 'rooms' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('tenant with right claims but instance lives in different room → permission-denied', async () => {
    instanceDocs['inst-1'] = { building: 'rooms', roomId: '14' }; // claims say 15
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('tenant with right claims but instance missing → not-found', async () => {
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/missing/photo.jpg' },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (err) => err.code === 'not-found',
    );
  });

  it('malformed path → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ path: 'not-a-checklist-path' }, ctx({ admin: true })),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('unauthenticated → unauthenticated error', async () => {
    await assert.rejects(
      () => handler({ path: 'checklists/rooms/15/inst-1/photo.jpg' }, { auth: null }),
      (err) => err.code === 'unauthenticated',
    );
  });

  it('signing failure surfaces as internal', async () => {
    signedUrlErr = new Error('boom');
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ admin: true }),
      ),
      (err) => err.code === 'internal',
    );
  });

  it('PATH_PATTERN accepts Thai room IDs (e.g. 15ก)', () => {
    assert.ok(PATH_PATTERN.test('checklists/rooms/15ก/inst-1/photo.jpg'));
    assert.ok(PATH_PATTERN.test('checklists/nest/N101/inst-2/signature_tenant.png'));
  });
});
