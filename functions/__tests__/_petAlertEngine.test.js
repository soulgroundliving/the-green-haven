/**
 * Unit tests for _petAlertEngine — pure Lost Pet Alert logic (Meaning Layer #13).
 * No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_petAlertEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ALERT_SAFE_FIELDS, DEFAULT_TTL_HOURS, MIN_TTL_HOURS, MAX_TTL_HOURS,
  MAX_LAST_SEEN_LEN, MAX_CONTACT_LEN,
  isValidStatus, safeLastSeen, safeContact, normalizeTtlHours, computeExpiresAtMs,
  isExpired, buildPetSnapshot, canRaiseAlert, canResolveAlert, buildAlertDoc,
} = require('../_petAlertEngine');

describe('isValidStatus', () => {
  it('accepts only the 3 alert states', () => {
    for (const s of ['active', 'resolved', 'expired']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('available'), false);   // that's a food-share state
    assert.equal(isValidStatus(''), false);
    assert.equal(isValidStatus(undefined), false);
  });
});

describe('safeLastSeen / safeContact — trim + cap free text', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(safeLastSeen('  แถวลิฟต์ชั้น 3  '), 'แถวลิฟต์ชั้น 3');
    assert.equal(safeContact('  โทร 08x  '), 'โทร 08x');
  });
  it('caps at the max length', () => {
    assert.equal(safeLastSeen('ก'.repeat(500)).length, MAX_LAST_SEEN_LEN);
    assert.equal(safeContact('x'.repeat(500)).length, MAX_CONTACT_LEN);
  });
  it('empty / nullish → empty string (never throws)', () => {
    assert.equal(safeLastSeen(''), '');
    assert.equal(safeLastSeen(null), '');
    assert.equal(safeLastSeen(undefined), '');
    assert.equal(safeContact('   '), '');
  });
  it('coerces non-string input', () => {
    assert.equal(safeLastSeen(42), '42');
  });
});

describe('normalizeTtlHours — clamp to [MIN, MAX], blank → DEFAULT', () => {
  it('blank / invalid / non-positive → DEFAULT', () => {
    assert.equal(normalizeTtlHours(undefined), DEFAULT_TTL_HOURS);
    assert.equal(normalizeTtlHours(null), DEFAULT_TTL_HOURS);
    assert.equal(normalizeTtlHours('nope'), DEFAULT_TTL_HOURS);
    assert.equal(normalizeTtlHours(0), DEFAULT_TTL_HOURS);
    assert.equal(normalizeTtlHours(-5), DEFAULT_TTL_HOURS);
  });
  it('clamps below MIN and above MAX', () => {
    assert.equal(normalizeTtlHours(0.2), MIN_TTL_HOURS);   // 0.2 floored = 0, but >0 so clamps up to MIN
    assert.equal(normalizeTtlHours(1000), MAX_TTL_HOURS);
  });
  it('passes a valid value through (floored)', () => {
    assert.equal(normalizeTtlHours(48), 48);
    assert.equal(normalizeTtlHours(72.9), 72);
  });
});

describe('computeExpiresAtMs', () => {
  it('adds the clamped TTL to the base time', () => {
    assert.equal(computeExpiresAtMs(1000, 1), 1000 + 3600 * 1000);
    assert.equal(computeExpiresAtMs(0, 48), 48 * 3600 * 1000);
  });
  it('uses DEFAULT TTL when hours are blank', () => {
    assert.equal(computeExpiresAtMs(0), DEFAULT_TTL_HOURS * 3600 * 1000);
  });
});

describe('isExpired — accepts Timestamp / {seconds} / {_ms} / epoch-ms', () => {
  const now = 2_000_000_000_000;
  it('true when expiresAt < now', () => {
    assert.equal(isExpired({ expiresAt: now - 1 }, now), true);
    assert.equal(isExpired({ expiresAt: { _ms: now - 1 } }, now), true);
    assert.equal(isExpired({ expiresAt: { seconds: Math.floor((now - 1000) / 1000) } }, now), true);
    assert.equal(isExpired({ expiresAt: { toMillis: () => now - 1 } }, now), true);
  });
  it('false when expiresAt > now or missing', () => {
    assert.equal(isExpired({ expiresAt: now + 10000 }, now), false);
    assert.equal(isExpired({}, now), false);
    assert.equal(isExpired(null, now), false);
  });
});

describe('buildPetSnapshot — safe-field whitelist (privacy)', () => {
  it('copies ONLY petName/petTypeEmoji/petPhotoURL, never health/vaccine/status/paths', () => {
    const raw = {
      name: '  มะลิ  ', typeEmoji: '🐱', breed: 'วิเชียรมาศ', gender: 'female', age: '2 ปี',
      photoURL: 'https://x/p.png',
      // private — must NOT appear in the snapshot:
      healthLog: [{ type: 'vet' }], isVaccinated: true, vaxDate: '2026-01-01',
      vaccineBookURL: 'https://x/v.png', vaccineBookPath: 'pets/a/b/c/v.png',
      status: 'approved', photoPath: 'pets/a/b/c/p.png',
    };
    const out = buildPetSnapshot(raw);
    assert.deepEqual(Object.keys(out).sort(), ['petName', 'petPhotoURL', 'petTypeEmoji']);
    assert.equal(out.petName, 'มะลิ');     // trimmed
    assert.equal(out.petTypeEmoji, '🐱');
    assert.equal(out.petPhotoURL, 'https://x/p.png');
    // privacy invariant: no private keys leak
    for (const k of ['healthLog', 'isVaccinated', 'vaxDate', 'vaccineBookURL', 'vaccineBookPath', 'status', 'photoPath', 'breed', 'gender', 'age']) {
      assert.ok(!(k in out), `${k} must not be in the alert snapshot`);
    }
  });
  it('falls back typeEmoji → legacy `type`, defaults to 🐾, photo null', () => {
    const out = buildPetSnapshot({ type: '🐶' });
    assert.equal(out.petTypeEmoji, '🐶');
    assert.equal(out.petName, '');
    assert.equal(out.petPhotoURL, null);
    assert.equal(buildPetSnapshot({}).petTypeEmoji, '🐾');
  });
  it('handles null/undefined input without throwing', () => {
    assert.deepEqual(buildPetSnapshot(null), { petName: '', petTypeEmoji: '🐾', petPhotoURL: null });
  });
});

describe('canRaiseAlert — approved pet + no active dup', () => {
  const approvedPet = { name: 'มะลิ', status: 'approved' };
  it('allows when the pet is approved and no active alert exists', () => {
    assert.deepEqual(canRaiseAlert(approvedPet, null), { ok: true });
    assert.deepEqual(canRaiseAlert(approvedPet, { status: 'resolved' }), { ok: true });
    assert.deepEqual(canRaiseAlert(approvedPet, { status: 'expired' }), { ok: true });
  });
  it('rejects a missing pet', () => {
    assert.equal(canRaiseAlert(null, null).reason, 'not-found');
  });
  it('rejects an un-approved pet (pending / ghost)', () => {
    assert.equal(canRaiseAlert({ status: 'pending' }, null).reason, 'not-approved');
    assert.equal(canRaiseAlert({}, null).reason, 'not-approved');
  });
  it('rejects when an active alert already exists (anti-dup / anti-spam)', () => {
    assert.equal(canRaiseAlert(approvedPet, { status: 'active' }).reason, 'already-active');
  });
});

describe('canResolveAlert — owner-only, active-only, same building', () => {
  const alert = { status: 'active', building: 'nest', ownerRoom: 'N101' };
  it('the owner of an active alert in the same building may resolve', () => {
    assert.deepEqual(canResolveAlert(alert, 'nest', 'N101'), { ok: true });
  });
  it('room match is string-coerced (numeric rooms in rooms building)', () => {
    const numericAlert = { status: 'active', building: 'rooms', ownerRoom: '15' };
    assert.deepEqual(canResolveAlert(numericAlert, 'rooms', 15), { ok: true });   // 15 → '15'
  });
  it('a non-owner room cannot resolve', () => {
    assert.equal(canResolveAlert(alert, 'nest', 'N202').reason, 'not-owner');
  });
  it('cannot resolve a terminal alert', () => {
    assert.equal(canResolveAlert({ status: 'resolved', building: 'nest', ownerRoom: 'N101' }, 'nest', 'N101').reason, 'not-active');
    assert.equal(canResolveAlert({ status: 'expired', building: 'nest', ownerRoom: 'N101' }, 'nest', 'N101').reason, 'not-active');
  });
  it('cross-building resolve is rejected', () => {
    assert.equal(canResolveAlert(alert, 'rooms', 'N101').reason, 'cross-building');
  });
  it('null alert → not-found', () => {
    assert.equal(canResolveAlert(null, 'nest', 'N101').reason, 'not-found');
  });
});

describe('buildAlertDoc — server-set identity + safe snapshot + sanitized text', () => {
  const pet = {
    name: 'มะลิ', typeEmoji: '🐱', photoURL: 'https://x/p.png',
    healthLog: [{ x: 1 }], status: 'approved', vaxDate: '2026-01-01',   // private — must not copy
  };
  it('snapshots only safe pet fields and carries server identity', () => {
    const doc = buildAlertDoc({
      petId: 'pet1', pet, building: 'nest', room: 'N101',
      ownerTenantId: 'nest_N101', ownerUid: 'line:Uabc',
      lastSeen: '  แถวลิฟต์  ', contactNote: '  โทรหาห้อง N101  ',
    });
    assert.equal(doc.petId, 'pet1');
    assert.equal(doc.ownerUid, 'line:Uabc');
    assert.equal(doc.ownerTenantId, 'nest_N101');
    assert.equal(doc.building, 'nest');
    assert.equal(doc.ownerRoom, 'N101');
    assert.equal(doc.petName, 'มะลิ');
    assert.equal(doc.petTypeEmoji, '🐱');
    assert.equal(doc.petPhotoURL, 'https://x/p.png');
    assert.equal(doc.lastSeen, 'แถวลิฟต์');      // trimmed
    assert.equal(doc.contactNote, 'โทรหาห้อง N101');
    assert.equal(doc.status, 'active');
    assert.equal(doc.resolvedAt, null);
    // privacy: no private keys leak into the alert doc
    for (const k of ['healthLog', 'vaxDate', 'status_pet', 'isVaccinated']) {
      assert.ok(!(k in doc), `${k} must not leak into the alert doc`);
    }
  });
  it('empty free text → null (stable shape)', () => {
    const doc = buildAlertDoc({ petId: 'p', pet, building: 'nest', room: 'N1', ownerTenantId: 't', ownerUid: 'u' });
    assert.equal(doc.lastSeen, null);
    assert.equal(doc.contactNote, null);
  });
  it('coerces room/ids to strings (claims may be numeric)', () => {
    const doc = buildAlertDoc({ petId: 9, pet, building: 'rooms', room: 15, ownerTenantId: 0, ownerUid: 0 });
    assert.equal(doc.petId, '9');
    assert.equal(doc.ownerRoom, '15');
    assert.equal(typeof doc.ownerTenantId, 'string');
  });
});

describe('ALERT_SAFE_FIELDS export', () => {
  it('is exactly the 3 pet-display fields', () => {
    assert.deepEqual(ALERT_SAFE_FIELDS, ['petName', 'petTypeEmoji', 'petPhotoURL']);
  });
});
