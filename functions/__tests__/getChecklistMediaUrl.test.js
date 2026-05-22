/**
 * Unit tests for getChecklistMediaUrl — 6-path auth gate + signed URL minting.
 * Matches getLeaseDocUrl.js template: admin / managedBuildings / claim match /
 * tenantId-claim SoT / linkedAuthUid SoT.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let instanceDocs;
let tenantDocs;            // keyed by `${building}/${roomId}`
let tenantReadThrows;      // when truthy, tenants doc read throws this error
let signedUrlReturn;
let signedUrlErr;
let lastSignArgs;

function resetStubs() {
  instanceDocs = {};
  tenantDocs = {};
  tenantReadThrows = null;
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
      collection: (name) => {
        if (name === 'checklistInstances') {
          return {
            doc: (id) => ({
              get: async () => ({
                exists: id in instanceDocs,
                data: () => instanceDocs[id],
              }),
            }),
          };
        }
        if (name === 'tenants') {
          // collection('tenants').doc(building).collection('list').doc(roomId).get()
          return {
            doc: (building) => ({
              collection: (sub) => {
                if (sub !== 'list') throw new Error('unexpected subcollection: ' + sub);
                return {
                  doc: (roomId) => ({
                    get: async () => {
                      if (tenantReadThrows) throw tenantReadThrows;
                      const key = `${building}/${roomId}`;
                      return {
                        exists: key in tenantDocs,
                        data: () => tenantDocs[key],
                      };
                    },
                  }),
                };
              },
            }),
          };
        }
        throw new Error('unexpected collection: ' + name);
      },
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

function ctx({ uid = 'u1', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
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

  it('tenant with wrong room claim AND no SoT match → permission-denied', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:UotherTenant', tenantId: 't-other' };
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ uid: 'line:Ucaller', room: '14', building: 'rooms' }),
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

  // ── New tests for 6-path auth model (§7-P/§7-HH/§7-Z hardening) ────────

  it('Path 0b: building manager (managedBuildings) → success bypasses claim + instance check', async () => {
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo.jpg' },
      ctx({ uid: 'line:UbuildingMgr', managedBuildings: ['rooms', 'nest'] }),
    );
    assert.ok(res.url);
  });

  it('Path 0b: managedBuildings for OTHER building → falls through to tenant gates', async () => {
    // Manager of `nest` tries to read `rooms` — no admin, no rooms claim, no SoT entry
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ uid: 'line:UbuildingMgr', managedBuildings: ['nest'] }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('Path 2a: claims drifted but linkedAuthUid matches caller.uid → success', async () => {
    instanceDocs['inst-1'] = { building: 'rooms', roomId: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15' };
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo.jpg' },
      ctx({ uid: 'line:Utenant15' /* no room/building claims — claims drifted post §7-Z window */ }),
    );
    assert.ok(res.url);
  });

  it('Path 1b: claims drifted but tenantId claim matches doc.tenantId → success', async () => {
    instanceDocs['inst-1'] = { building: 'rooms', roomId: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:UoldUid', tenantId: 't-15' };
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo.jpg' },
      // caller is on a rotated anon UID (post §7-HH); only tenantId claim survived
      ctx({ uid: 'anon-rotated-xyz', tenantId: 't-15' }),
    );
    assert.ok(res.url);
  });

  it('Path 2/1b: SoT match but instance doc lives in different room → permission-denied', async () => {
    // Caller IS the linked tenant of room 15, but tries to read an instance
    // that belongs to room 16 via a forged path.
    instanceDocs['inst-cross'] = { building: 'rooms', roomId: '16' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15' };
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-cross/photo.jpg' },
        ctx({ uid: 'line:Utenant15' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('Path 2: no claim match AND no SoT match → permission-denied with diagnostic', async () => {
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:UrealTenant', tenantId: 't-real' };
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
      ),
      (err) => err.code === 'permission-denied'
        && /Tenant SoT check failed/.test(err.message)
        && /linkedAuthUid=line:/.test(err.message)
        && /caller.uid=line:/.test(err.message),
    );
  });

  it('Path 2: tenant doc missing → permission-denied (relink hint)', async () => {
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ uid: 'line:Utenant15' /* no claim match, no tenant doc */ }),
      ),
      (err) => err.code === 'permission-denied' && /relink request/.test(err.message),
    );
  });

  it('Path 2: tenant doc read throws → permission-denied (no leak)', async () => {
    tenantReadThrows = new Error('Firestore unavailable');
    await assert.rejects(
      () => handler(
        { path: 'checklists/rooms/15/inst-1/photo.jpg' },
        ctx({ uid: 'line:Utenant15' }),
      ),
      (err) => err.code === 'permission-denied' && /tenant doc lookup failed/.test(err.message),
    );
  });

  it('Path 2a wins when both claims and SoT could match but claims do not', async () => {
    // Verify SoT path is reachable even when caller has SOME claims (just wrong ones)
    instanceDocs['inst-1'] = { building: 'rooms', roomId: '15' };
    tenantDocs['rooms/15'] = { linkedAuthUid: 'line:Utenant15', tenantId: 't-15' };
    const res = await handler(
      { path: 'checklists/rooms/15/inst-1/photo.jpg' },
      ctx({
        uid: 'line:Utenant15',
        room: '14',          // wrong room claim — stale from prior tenancy
        building: 'rooms',
      }),
    );
    assert.ok(res.url);
  });
});
