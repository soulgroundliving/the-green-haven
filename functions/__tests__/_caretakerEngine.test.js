/**
 * Unit tests for _caretakerEngine — pure Emergency-Caretaker lifecycle logic
 * (Meaning Layer #14). No firebase mock needed; every function is pure.
 *
 * Run: node --test functions/__tests__/_caretakerEngine.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  VALID_STATUS, VALID_URGENCY, PET_SAFE_FIELDS, MAX_NEED_LEN,
  isValidStatus, isValidUrgency, normalizeUrgency,
  sanitizeNeed, validatePeriod, buildPetSnapshot,
  canAccept, canComplete, canCancel,
} = require('../_caretakerEngine');

const REQUESTER = 'line:Uowner';
const CARETAKER = 'line:Usitter';

describe('status / urgency vocab', () => {
  it('isValidStatus accepts the 4 lifecycle states only', () => {
    for (const s of ['open', 'accepted', 'done', 'cancelled']) assert.ok(isValidStatus(s));
    assert.equal(isValidStatus('paused'), false);
    assert.equal(isValidStatus(''), false);
    assert.equal(VALID_STATUS.size, 4);
  });

  it('isValidUrgency allows empty/unset, rejects unknown', () => {
    assert.ok(isValidUrgency(''));
    assert.ok(isValidUrgency(null));
    assert.ok(isValidUrgency(undefined));
    assert.ok(isValidUrgency('scheduled'));
    assert.ok(isValidUrgency('urgent'));
    assert.equal(isValidUrgency('asap'), false);
    assert.equal(VALID_URGENCY.size, 2);
  });

  it('normalizeUrgency keeps known values, defaults unknown/empty to scheduled', () => {
    assert.equal(normalizeUrgency('urgent'), 'urgent');
    assert.equal(normalizeUrgency('scheduled'), 'scheduled');
    assert.equal(normalizeUrgency(''), 'scheduled');
    assert.equal(normalizeUrgency('nonsense'), 'scheduled');
    assert.equal(normalizeUrgency(undefined), 'scheduled');
  });
});

describe('sanitizeNeed', () => {
  it('trims and caps at MAX_NEED_LEN', () => {
    assert.equal(sanitizeNeed('  ให้อาหารเช้า-เย็น  '), 'ให้อาหารเช้า-เย็น');
    assert.equal(sanitizeNeed(''), '');
    assert.equal(sanitizeNeed(null), '');
    assert.equal(sanitizeNeed('x'.repeat(MAX_NEED_LEN + 100)).length, MAX_NEED_LEN);
  });
});

describe('validatePeriod', () => {
  it('accepts epoch-ms numbers with to > from', () => {
    const r = validatePeriod({ from: 1000, to: 2000 });
    assert.deepEqual(r, { ok: true, fromMs: 1000, toMs: 2000 });
  });
  it('accepts Date objects', () => {
    const from = new Date('2026-06-20T08:00:00Z');
    const to = new Date('2026-06-22T18:00:00Z');
    assert.equal(validatePeriod({ from, to }).ok, true);
  });
  it('accepts Firestore-Timestamp-like {seconds} / toMillis()', () => {
    assert.equal(validatePeriod({ from: { seconds: 100 }, to: { seconds: 200 } }).ok, true);
    assert.equal(validatePeriod({ from: { toMillis: () => 1 }, to: { toMillis: () => 9 } }).ok, true);
    // admin SDK wire shape (_seconds)
    assert.equal(validatePeriod({ from: { _seconds: 100 }, to: { _seconds: 200 } }).ok, true);
  });
  it('rejects missing bounds', () => {
    assert.equal(validatePeriod(null).reason, 'missing');
    assert.equal(validatePeriod({}).reason, 'missing');
    assert.equal(validatePeriod({ from: 1000 }).reason, 'missing');
    assert.equal(validatePeriod({ to: 1000 }).reason, 'missing');
  });
  it('rejects to <= from (order)', () => {
    assert.equal(validatePeriod({ from: 2000, to: 1000 }).reason, 'order');
    assert.equal(validatePeriod({ from: 2000, to: 2000 }).reason, 'order');
  });
});

describe('buildPetSnapshot — SAFE fields only (PDPA, no health leak)', () => {
  it('picks only name + typeEmoji, NEVER health/vaccine/status/path', () => {
    const snap = buildPetSnapshot({
      name: '  ขนมปัง  ', typeEmoji: '🐶', type: 'dog',
      healthLog: [{ note: 'rabies due' }], vaccineBookURL: 'x', status: 'approved',
      photoPath: 'pets/abc.jpg', age: '3 ปี', breed: 'corgi',
    });
    assert.deepEqual(snap, { petName: 'ขนมปัง', petTypeEmoji: '🐶' });
    // explicit: the sensitive keys never appear on the snapshot
    for (const leak of ['healthLog', 'vaccineBookURL', 'status', 'photoPath', 'age', 'breed']) {
      assert.equal(Object.prototype.hasOwnProperty.call(snap, leak), false, `leaked ${leak}`);
    }
  });
  it('falls back to the legacy `type` alias for the emoji', () => {
    assert.equal(buildPetSnapshot({ name: 'A', type: '🐱' }).petTypeEmoji, '🐱');
  });
  it('missing fields become empty strings (stable shape)', () => {
    assert.deepEqual(buildPetSnapshot({}), { petName: '', petTypeEmoji: '' });
    assert.deepEqual(buildPetSnapshot(null), { petName: '', petTypeEmoji: '' });
  });
  it('PET_SAFE_FIELDS documents exactly the surfaced source keys', () => {
    assert.deepEqual(PET_SAFE_FIELDS, ['name', 'typeEmoji']);
  });
});

describe('canAccept', () => {
  it('a different tenant can accept an open request', () => {
    assert.deepEqual(canAccept({ status: 'open', requesterUid: REQUESTER }, CARETAKER), { ok: true });
  });
  it('cannot accept your own request (self-accept)', () => {
    const v = canAccept({ status: 'open', requesterUid: REQUESTER }, REQUESTER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'self-accept');
  });
  it('cannot accept a non-open request', () => {
    assert.equal(canAccept({ status: 'accepted', requesterUid: REQUESTER }, CARETAKER).reason, 'not-open');
    assert.equal(canAccept({ status: 'done', requesterUid: REQUESTER }, CARETAKER).reason, 'not-open');
    assert.equal(canAccept({ status: 'cancelled', requesterUid: REQUESTER }, CARETAKER).reason, 'not-open');
  });
  it('null request → not-found', () => {
    assert.equal(canAccept(null, CARETAKER).reason, 'not-found');
  });
});

describe('canComplete (the OWNER confirms, never the caretaker — §6)', () => {
  it('the requester can complete an accepted request', () => {
    assert.deepEqual(canComplete({ status: 'accepted', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester (even the caretaker) cannot complete', () => {
    const v = canComplete({ status: 'accepted', requesterUid: REQUESTER, caretakerUid: CARETAKER }, CARETAKER);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'not-requester');
  });
  it('cannot complete a request that is not accepted', () => {
    assert.equal(canComplete({ status: 'open', requesterUid: REQUESTER }, REQUESTER).reason, 'not-accepted');
    assert.equal(canComplete({ status: 'done', requesterUid: REQUESTER }, REQUESTER).reason, 'not-accepted');
  });
  it('null request → not-found', () => {
    assert.equal(canComplete(null, REQUESTER).reason, 'not-found');
  });
});

describe('canCancel', () => {
  it('the requester can cancel an open or accepted request', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, REQUESTER), { ok: true });
    assert.deepEqual(canCancel({ status: 'accepted', requesterUid: REQUESTER }, REQUESTER), { ok: true });
  });
  it('a non-requester cannot cancel', () => {
    assert.equal(canCancel({ status: 'open', requesterUid: REQUESTER }, CARETAKER).reason, 'not-requester');
  });
  it('an admin can cancel anyone\'s non-terminal request (moderation)', () => {
    assert.deepEqual(canCancel({ status: 'open', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
    assert.deepEqual(canCancel({ status: 'accepted', requesterUid: REQUESTER }, 'admin-x', { isAdmin: true }), { ok: true });
  });
  it('cannot cancel a terminal (done/cancelled) request, even as admin', () => {
    assert.equal(canCancel({ status: 'done', requesterUid: REQUESTER }, REQUESTER).reason, 'terminal');
    assert.equal(canCancel({ status: 'cancelled', requesterUid: REQUESTER }, 'a', { isAdmin: true }).reason, 'terminal');
  });
});
