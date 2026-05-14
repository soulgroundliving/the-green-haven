/**
 * Unit tests for shared occupancy heuristic — guards against the double-booking
 * regression where Phase 3+ slim tenant docs (no `name` field) were treated as
 * vacant by both createBookingLock and getRoomAvailability.
 *
 * Run: node --test functions/__tests__/occupancy.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isActiveTenant } = require('../_occupancy');

describe('isActiveTenant — vacancy heuristics', () => {
  it('legacy active tenant with only name field → occupied', () => {
    assert.equal(isActiveTenant({ name: 'สมชาย สิบห้าว' }), true);
  });

  it('Phase 3+ slim doc (tenantId + linkedAuthUid + lease, NO name) → occupied', () => {
    assert.equal(isActiveTenant({
      tenantId: 'T_2026_15',
      linkedAuthUid: 'line:U123abc',
      lease: { leaseId: 'CONTRACT_1', status: 'active' },
    }), true);
  });

  it('only tenantId set (linkedAuthUid + name absent) → occupied', () => {
    assert.equal(isActiveTenant({ tenantId: 'T_X' }), true);
  });

  it('only linkedAuthUid set (no tenantId, no name) → occupied', () => {
    assert.equal(isActiveTenant({ linkedAuthUid: 'line:abc' }), true);
  });

  it('only active lease subobject → occupied', () => {
    assert.equal(isActiveTenant({ lease: { status: 'active' } }), true);
  });

  it('archived/vacant doc (all identity fields cleared by archiveTenantOnMoveOut) → vacant', () => {
    assert.equal(isActiveTenant({
      tenantId: '', linkedAuthUid: '', name: '',
      // lease field is FieldValue.delete()d, i.e. undefined
    }), false);
  });

  it('player doc after transitionToPlayer (cleared fields, same shape) → vacant', () => {
    assert.equal(isActiveTenant({
      tenantId: '', linkedAuthUid: '', name: '', firstName: '', lastName: '',
    }), false);
  });

  it('whitespace-only values must NOT count as active (cheap guard against corrupt writes)', () => {
    assert.equal(isActiveTenant({ tenantId: '   ', linkedAuthUid: '\t', name: ' ' }), false);
  });

  it('explicit movedOut flag overrides every identity signal', () => {
    assert.equal(isActiveTenant({
      tenantId: 'T_X', linkedAuthUid: 'line:abc', name: 'Foo',
      lease: { status: 'active' },
      movedOut: true,
    }), false);
  });

  it('lease in non-active status (ended/cancelled) does NOT count by itself', () => {
    assert.equal(isActiveTenant({ lease: { status: 'ended' } }), false);
    assert.equal(isActiveTenant({ lease: { status: 'cancelled' } }), false);
  });

  it('null / non-object / empty doc → vacant', () => {
    assert.equal(isActiveTenant(null), false);
    assert.equal(isActiveTenant(undefined), false);
    assert.equal(isActiveTenant({}), false);
    assert.equal(isActiveTenant('not an object'), false);
  });
});
