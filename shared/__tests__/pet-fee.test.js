/**
 * Unit tests for shared/pet-fee.js
 * Run: node --test shared/__tests__/pet-fee.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PetFee = require('../pet-fee.js');

describe('PetFee.computeRoomFee', () => {
  it('rate is ฿400 per approved pet per month', () => {
    assert.equal(PetFee.PER_PET, 400);
  });

  it('zero pets → ฿0', () => {
    assert.equal(PetFee.computeRoomFee([]), 0);
  });

  it('counts only approved pets (pending/rejected excluded)', () => {
    const pets = [
      { status: 'approved' },
      { status: 'approved' },
      { status: 'pending' },
      { status: 'rejected' },
    ];
    assert.equal(PetFee.computeRoomFee(pets), 800); // 2 approved × 400
  });

  it('three approved pets → ฿1,200', () => {
    assert.equal(PetFee.computeRoomFee([
      { status: 'approved' }, { status: 'approved' }, { status: 'approved' },
    ]), 1200);
  });

  it('defensive: null / non-array / malformed entries → ฿0, no throw', () => {
    assert.equal(PetFee.computeRoomFee(null), 0);
    assert.equal(PetFee.computeRoomFee(undefined), 0);
    assert.equal(PetFee.computeRoomFee('nope'), 0);
    assert.equal(PetFee.computeRoomFee([null, {}, { status: '' }]), 0);
  });
});
