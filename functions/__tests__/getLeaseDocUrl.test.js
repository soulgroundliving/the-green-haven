/**
 * Unit tests for getLeaseDocUrl — 6-path auth gate via _authSoT.assertTenantAccess
 * + Path 1d (current-tenant-contract) fallback + signed URL minting.
 *
 * The 6 generic paths (admin / managedBuildings / claim / tenantId-sot /
 * linkedAuthUid-sot / lease-doc-sot) are covered by _authSoT.test.js. Here we
 * focus on:
 *   - Plumbing: handler invokes assertTenantAccess with correct args, mints
 *     v4 signed URL with 1h TTL.
 *   - Path 1d fallback: when assertTenantAccess throws, the handler MAY still
 *     succeed if the path matches the caller's current tenant doc's
 *     contractDocument or lease.contractPath (per claims).
 *   - Error surfaces: unauthenticated / invalid-argument / internal.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;            // keyed by `${building}/${roomId}`
let tenantReadThrows;
let assertThrows;          // assertTenantAccess outcome — Error to throw, or null for success
let assertResolveValue;    // assertTenantAccess success-return object (when not throwing)
let signedUrlReturn;
let signedUrlErr;
let lastSignArgs;
let lastAssertArgs;
let buildingsList;

function resetStubs() {
  tenantDocs = {};
  tenantReadThrows = null;
  assertThrows = null;
  assertResolveValue = { viaPath: 'claim', leaseData: null };
  signedUrlReturn = 'https://storage.googleapis.com/signed?TOKEN';
  signedUrlErr = null;
  lastSignArgs = null;
  lastAssertArgs = null;
  buildingsList = ['rooms', 'nest'];
}
resetStubs();

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') {
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
  if (id === './_authSoT') {
    return {
      assertTenantAccess: async (args) => {
        lastAssertArgs = args;
        if (assertThrows) throw assertThrows;
        return assertResolveValue;
      },
    };
  }
  if (id === './buildingRegistry') {
    return {
      getAllBuildings: async () => buildingsList,
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { getLeaseDocUrl: handler, SIGNED_URL_TTL_MS, PATH_PATTERN } =
  require('../getLeaseDocUrl');

function ctx({ uid = 'line:Ucaller', admin = false, room = '', building = '', tenantId = '', managedBuildings = null } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (managedBuildings) token.managedBuildings = managedBuildings;
  return { auth: { uid, token } };
}

describe('getLeaseDocUrl', () => {
  beforeEach(resetStubs);

  // ── Pre-flight ────────────────────────────────────────────────────────────

  it('unauthenticated → unauthenticated error', async () => {
    await assert.rejects(
      () => handler({ path: 'leases/rooms/15/lease-1/contract.pdf' }, { auth: null }),
      (err) => err.code === 'unauthenticated',
    );
  });

  it('malformed path → invalid-argument', async () => {
    await assert.rejects(
      () => handler({ path: 'not-a-lease-path' }, ctx({ admin: true })),
      (err) => err.code === 'invalid-argument',
    );
  });

  it('PATH_PATTERN accepts Thai room IDs (e.g. 15ก) and nest IDs (N101)', () => {
    assert.ok(PATH_PATTERN.test('leases/rooms/15ก/lease-1/contract.pdf'));
    assert.ok(PATH_PATTERN.test('leases/nest/N101/lease-2/signed.pdf'));
    assert.ok(PATH_PATTERN.test('leases/amazon/A1/lease-3/file_v2.pdf'));
    assert.ok(!PATH_PATTERN.test('leases//15/lease-1/contract.pdf'));
    assert.ok(!PATH_PATTERN.test('checklists/rooms/15/inst-1/photo.jpg'));
  });

  // ── Happy path via _authSoT ───────────────────────────────────────────────

  it('admin context → assertTenantAccess success → signed URL minted', async () => {
    assertResolveValue = { viaPath: 'admin', leaseData: null };
    const res = await handler(
      { path: 'leases/rooms/15/lease-1/contract.pdf' },
      ctx({ admin: true }),
    );
    assert.ok(res.url);
    assert.equal(res.url, signedUrlReturn);
    assert.ok(res.expiresAt > Date.now());
    assert.equal(lastSignArgs.path, 'leases/rooms/15/lease-1/contract.pdf');
    assert.equal(lastSignArgs.opts.version, 'v4');
    assert.equal(lastSignArgs.opts.action, 'read');
  });

  it('tenant with matching claims → success', async () => {
    assertResolveValue = { viaPath: 'claim', leaseData: null };
    const res = await handler(
      { path: 'leases/rooms/15/lease-1/contract.pdf' },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.ok(res.url);
  });

  it('expiresAt is ~1 hour out', async () => {
    const before = Date.now();
    const res = await handler(
      { path: 'leases/rooms/15/lease-1/contract.pdf' },
      ctx({ admin: true }),
    );
    const expectedRange = [before + SIGNED_URL_TTL_MS - 100, before + SIGNED_URL_TTL_MS + 1000];
    assert.ok(res.expiresAt >= expectedRange[0] && res.expiresAt <= expectedRange[1],
      `expiresAt ${res.expiresAt} should be in ${expectedRange.join('..')}`);
  });

  it('assertTenantAccess receives leaseId + leaseBuildings for Path 1c lookup', async () => {
    buildingsList = ['rooms', 'nest', 'amazon'];
    await handler(
      { path: 'leases/rooms/15/lease-abc/contract.pdf' },
      ctx({ admin: true }),
    );
    assert.equal(lastAssertArgs.building, 'rooms');
    assert.equal(lastAssertArgs.roomId, '15');
    assert.equal(lastAssertArgs.leaseId, 'lease-abc');
    assert.deepEqual(lastAssertArgs.leaseBuildings, ['rooms', 'nest', 'amazon']);
  });

  // ── Path 1d — current-tenant-contract fallback ────────────────────────────

  it('Path 1d: _authSoT throws but tenant doc contractDocument matches path → success', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    tenantDocs['nest/N101'] = {
      tenantId: 't-101',
      contractDocument: 'leases/rooms/15/old-lease/contract.pdf',  // path frozen at old room
    };
    const res = await handler(
      { path: 'leases/rooms/15/old-lease/contract.pdf' },
      ctx({ uid: 'line:UtenantTransferred', room: 'N101', building: 'nest', tenantId: 't-101' }),
    );
    assert.ok(res.url);
    assert.equal(res.url, signedUrlReturn);
  });

  it('Path 1d: _authSoT throws but tenant doc lease.contractPath matches → success', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    tenantDocs['nest/N101'] = {
      tenantId: 't-101',
      lease: { contractPath: 'leases/rooms/15/old-lease/contract.pdf' },
    };
    const res = await handler(
      { path: 'leases/rooms/15/old-lease/contract.pdf' },
      ctx({ uid: 'line:UtenantTransferred', room: 'N101', building: 'nest', tenantId: 't-101' }),
    );
    assert.ok(res.url);
  });

  it('Path 1d: _authSoT throws, tenant doc exists but path matches neither contractDocument nor lease.contractPath → original throw surfaces', async () => {
    const origErr = Object.assign(new Error('Tenant SoT check failed: linkedAuthUid=line:Uother caller.uid=line:UtenantTransferred'), { code: 'permission-denied' });
    assertThrows = origErr;
    tenantDocs['nest/N101'] = {
      tenantId: 't-101',
      contractDocument: 'leases/rooms/15/DIFFERENT-lease/contract.pdf',
    };
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/lease-abc/contract.pdf' },
        ctx({ uid: 'line:UtenantTransferred', room: 'N101', building: 'nest', tenantId: 't-101' }),
      ),
      (err) => err.code === 'permission-denied' && /Tenant SoT check failed/.test(err.message),
    );
  });

  it('Path 1d: _authSoT throws AND tenant doc tenantId differs from token.tenantId → original throw surfaces (no impersonation)', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    tenantDocs['nest/N101'] = {
      tenantId: 't-different',
      contractDocument: 'leases/rooms/15/old-lease/contract.pdf',
    };
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/old-lease/contract.pdf' },
        ctx({ uid: 'line:Uattacker', room: 'N101', building: 'nest', tenantId: 't-101' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('Path 1d: _authSoT throws AND tenant doc missing → original throw surfaces', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    // tenantDocs is empty — current tenant doc doesn't exist
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/lease-1/contract.pdf' },
        ctx({ uid: 'line:Ucaller', room: 'N101', building: 'nest', tenantId: 't-101' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('Path 1d: caller lacks token.tenantId → fallback skipped, original throw surfaces', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    tenantDocs['nest/N101'] = {
      tenantId: 't-101',
      contractDocument: 'leases/rooms/15/old-lease/contract.pdf',
    };
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/old-lease/contract.pdf' },
        // no tenantId in token — Path 1d's token-derived lookup is skipped
        ctx({ uid: 'line:Ucaller', room: 'N101', building: 'nest' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  it('Path 1d: tenant doc read throws → original auth error surfaces (no leak)', async () => {
    assertThrows = Object.assign(new Error('Tenant SoT check failed'), { code: 'permission-denied' });
    tenantReadThrows = new Error('Firestore unavailable');
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/old-lease/contract.pdf' },
        ctx({ uid: 'line:Ucaller', room: 'N101', building: 'nest', tenantId: 't-101' }),
      ),
      (err) => err.code === 'permission-denied',
    );
  });

  // ── Storage signing ───────────────────────────────────────────────────────

  it('signing failure surfaces as internal', async () => {
    signedUrlErr = new Error('boom');
    await assert.rejects(
      () => handler(
        { path: 'leases/rooms/15/lease-1/contract.pdf' },
        ctx({ admin: true }),
      ),
      (err) => err.code === 'internal',
    );
  });

  it('signed URL is requested at the EXACT path the caller supplied (no rewrite)', async () => {
    await handler(
      { path: 'leases/nest/N101/lease-xyz/scan_v3.pdf' },
      ctx({ admin: true }),
    );
    assert.equal(lastSignArgs.path, 'leases/nest/N101/lease-xyz/scan_v3.pdf');
  });
});
