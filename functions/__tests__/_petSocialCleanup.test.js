/**
 * Unit tests for _petSocialCleanup — the §7-DD top-level cleanup helpers for the
 * Pet Social Graph (#10). A tiny in-memory Firestore mock backs the single-field
 * where()/limit()/get() queries + per-doc ref.delete().
 *
 * Run: node --test functions/__tests__/_petSocialCleanup.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { cleanupLinksForPet, cleanupPetSocialByTenant } = require('../_petSocialCleanup');

// ── In-memory Firestore mock ──────────────────────────────────────────────────
function makeFirestore(state) {
  function coll(name) {
    const store = state[name] || (state[name] = {});
    const filters = [];
    const q = {
      where(field, _op, val) { filters.push([field, String(val)]); return q; },
      limit() { return q; },
      async get() {
        const docs = Object.entries(store)
          .filter(([, d]) => filters.every(([f, v]) => String(d[f]) === v))
          .map(([id, d]) => ({
            id,
            data: () => d,
            ref: { delete: async () => { delete store[id]; } },
          }));
        return { empty: docs.length === 0, docs };
      },
    };
    return q;
  }
  return { collection: coll, _state: state };
}

describe('cleanupLinksForPet', () => {
  let fs;
  beforeEach(() => {
    fs = makeFirestore({
      petLinks: {
        'p1_p2': { petA: 'p1', petB: 'p2' },   // p1 is petA
        'p2_p3': { petA: 'p2', petB: 'p3' },   // p3-side, p2 is petA
        'p0_p3': { petA: 'p0', petB: 'p3' },   // p3 is petB  ← touches p3 only
        'p3_p9': { petA: 'p3', petB: 'p9' },   // p3 is petA
      },
    });
  });

  it('deletes every edge touching the pet in BOTH directions', async () => {
    const n = await cleanupLinksForPet(fs, 'p3');
    assert.equal(n, 3);                                  // p2_p3 + p0_p3 + p3_p9
    assert.deepEqual(Object.keys(fs._state.petLinks).sort(), ['p1_p2']);
  });

  it('returns 0 and no-ops for a pet with no edges', async () => {
    const n = await cleanupLinksForPet(fs, 'pX');
    assert.equal(n, 0);
    assert.equal(Object.keys(fs._state.petLinks).length, 4);
  });

  it('returns 0 for an empty petId', async () => {
    assert.equal(await cleanupLinksForPet(fs, ''), 0);
  });
});

describe('cleanupPetSocialByTenant', () => {
  let fs;
  beforeEach(() => {
    fs = makeFirestore({
      petProfiles: {
        'p1': { ownerTenantId: 'TENANT_A' },
        'p2': { ownerTenantId: 'TENANT_A' },
        'p3': { ownerTenantId: 'TENANT_B' },
      },
      petLinks: {
        'p1_p3': { requesterTenantId: 'TENANT_A', recipientTenantId: 'TENANT_B' },
        'p2_p9': { requesterTenantId: 'TENANT_B', recipientTenantId: 'TENANT_A' },
        'p7_p8': { requesterTenantId: 'TENANT_C', recipientTenantId: 'TENANT_D' },
      },
    });
  });

  it('removes the tenant profiles + every edge they are a party to', async () => {
    const r = await cleanupPetSocialByTenant(fs, 'TENANT_A');
    assert.equal(r.profiles, 2);                         // p1 + p2
    assert.equal(r.links, 2);                            // p1_p3 (requester) + p2_p9 (recipient)
    assert.deepEqual(Object.keys(fs._state.petProfiles).sort(), ['p3']);
    assert.deepEqual(Object.keys(fs._state.petLinks).sort(), ['p7_p8']);
  });

  it('returns zeros for an empty tenantId', async () => {
    assert.deepEqual(await cleanupPetSocialByTenant(fs, ''), { profiles: 0, links: 0 });
  });
});
