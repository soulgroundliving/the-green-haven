/**
 * Unit tests for shared/building-config.js — BuildingConfig.
 *
 * Focus: getBuildingForRoom, the single source of truth for room→building
 * resolution. BillingSystem.detectBuilding, _taDetectBuilding (tenant-liff-auth)
 * and detectBuildingFromRoomId (dashboard-tenant-modal) all resolve through it,
 * each keeping a defensive inline mirror for pre-load safety. The cases below
 * lock the exact contract the mirrors must match (they intentionally duplicate
 * the billing-system.test.js detectBuilding cases at the SoT level).
 *
 * Note the deliberate asymmetry with isNestRoom: isNestRoom is a pure 'N'-prefix
 * string check, so isNestRoom('101') === false, while getBuildingForRoom('101')
 * === 'nest' (it also maps the legacy bare-numeric Nest range 101–405). Both are
 * tested so the distinction stays intentional, not accidental drift.
 *
 * building-config.js is an IIFE that assigns window.BuildingConfig, so no shim
 * is needed — just read it off the sandbox window after running the source.
 *
 * Run: node --test shared/__tests__/building-config.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadBuildingConfig(extraWindow) {
  const window = Object.assign({}, extraWindow);
  const context = {
    window,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    JSON, Math, Number, String, Boolean, Object, Array, parseInt, parseFloat, isFinite, isNaN,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'building-config.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'building-config.js' });
  return context.window.BuildingConfig;
}

const BC = loadBuildingConfig();

describe('BuildingConfig.getBuildingForRoom — N prefix', () => {
  test("'N'/'n' prefix → nest regardless of number", () => {
    assert.equal(BC.getBuildingForRoom('N101'), 'nest');
    assert.equal(BC.getBuildingForRoom('n15'), 'nest');
    assert.equal(BC.getBuildingForRoom('N9'), 'nest');
    assert.equal(BC.getBuildingForRoom('N999'), 'nest');
  });
});

describe('BuildingConfig.getBuildingForRoom — legacy numeric range 101-405', () => {
  test('numeric inside 101-405 → nest', () => {
    assert.equal(BC.getBuildingForRoom('101'), 'nest');
    assert.equal(BC.getBuildingForRoom('250'), 'nest');
    assert.equal(BC.getBuildingForRoom('405'), 'nest');
  });

  test('numeric just outside 101-405 → rooms', () => {
    assert.equal(BC.getBuildingForRoom('100'), 'rooms');
    assert.equal(BC.getBuildingForRoom('406'), 'rooms');
  });

  test('low row-house numbers (13/15/33) → rooms', () => {
    assert.equal(BC.getBuildingForRoom('13'), 'rooms');
    assert.equal(BC.getBuildingForRoom('15'), 'rooms');
    assert.equal(BC.getBuildingForRoom('33'), 'rooms');
  });

  test('accepts a numeric (non-string) roomId', () => {
    assert.equal(BC.getBuildingForRoom(205), 'nest');
    assert.equal(BC.getBuildingForRoom(15), 'rooms');
  });

  test("Thai-suffixed row house '15ก' → rooms (parseInt → 15)", () => {
    assert.equal(BC.getBuildingForRoom('15ก'), 'rooms');
  });
});

describe('BuildingConfig.getBuildingForRoom — empty / nullish → rooms (default building)', () => {
  test('null / undefined / empty string default to rooms', () => {
    assert.equal(BC.getBuildingForRoom(null), 'rooms');
    assert.equal(BC.getBuildingForRoom(undefined), 'rooms');
    assert.equal(BC.getBuildingForRoom(''), 'rooms');
  });
});

describe('BuildingConfig.getBuildingForRoom vs isNestRoom — intentional asymmetry', () => {
  test('isNestRoom is N-prefix-only; getBuildingForRoom also maps legacy numeric', () => {
    // Same answer for N-prefixed ids…
    assert.equal(BC.isNestRoom('N301'), true);
    assert.equal(BC.getBuildingForRoom('N301'), 'nest');
    // …but diverge for the legacy bare-numeric Nest range — by design.
    assert.equal(BC.isNestRoom('250'), false);
    assert.equal(BC.getBuildingForRoom('250'), 'nest');
  });
});

describe('BuildingConfig.getBuildingForRoom returns canonical ids', () => {
  test('outputs are exactly CANONICAL.ROOMS / CANONICAL.NEST', () => {
    assert.equal(BC.getBuildingForRoom('N1'), BC.CANONICAL.NEST);
    assert.equal(BC.getBuildingForRoom('15'), BC.CANONICAL.ROOMS);
  });
});
