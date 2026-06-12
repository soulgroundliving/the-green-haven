'use strict';

/**
 * Unit tests for shared/tenant-neighbor-bonds.js — the pure deriveBonds() + roomLabel().
 * The subscribe/render paths need DOM + Firebase + LIFF claims and are verified via
 * the static harness + live on LINE (§7-J). deriveBonds is the load-bearing logic:
 * it turns a building's helpRequests into the per-neighbour bond tally, keyed off
 * the OTHER party's room, counting both directions (I-helped-them / they-helped-me).
 *
 * The module is a browser IIFE that, in a node realm (no window/document), exports
 * { deriveBonds, roomLabel } via module.exports.
 *
 * Run: node --test shared/__tests__/tenant-neighbor-bonds.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { deriveBonds, roomLabel } = require('../tenant-neighbor-bonds.js');

// A done helpRequest: requester = (building, room), helper = (helperBuilding, helperRoom).
const done = (building, room, helperBuilding, helperRoom, extra) =>
  Object.assign({ status: 'done', building, room, helperBuilding, helperRoom }, extra || {});

const ME = { myBuilding: 'rooms', myRoom: '15' };

describe('deriveBonds — guards', () => {
  test('no rows → []', () => {
    assert.deepEqual(deriveBonds({ rows: [], ...ME }), []);
  });
  test('missing myBuilding/myRoom → []', () => {
    assert.deepEqual(deriveBonds({ rows: [done('rooms', '15', 'rooms', '16')] }), []);
    assert.deepEqual(deriveBonds({ rows: [done('rooms', '15', 'rooms', '16')], myBuilding: 'rooms' }), []);
  });
  test('undefined input → [] (no throw)', () => {
    assert.deepEqual(deriveBonds(), []);
    assert.deepEqual(deriveBonds({}), []);
  });
});

describe('deriveBonds — direction + aggregation', () => {
  test("I'm the REQUESTER → bond with the helper, counted as helpedBy", () => {
    const out = deriveBonds({ rows: [done('rooms', '15', 'rooms', '16')], ...ME });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { building: 'rooms', room: '16', helped: 0, helpedBy: 1, total: 1 });
  });

  test("I'm the HELPER → bond with the requester, counted as helped", () => {
    const out = deriveBonds({ rows: [done('rooms', '20', 'rooms', '15')], ...ME });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { building: 'rooms', room: '20', helped: 1, helpedBy: 0, total: 1 });
  });

  test('repeat interactions with the same neighbour aggregate (both directions)', () => {
    const out = deriveBonds({ rows: [
      done('rooms', '15', 'rooms', '16'), // 16 helped me
      done('rooms', '15', 'rooms', '16'), // 16 helped me again
      done('rooms', '16', 'rooms', '15'), // I helped 16
    ], ...ME });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { building: 'rooms', room: '16', helped: 1, helpedBy: 2, total: 3 });
  });

  test('multiple distinct neighbours, sorted by total interactions desc', () => {
    const out = deriveBonds({ rows: [
      done('rooms', '15', 'rooms', '16'),
      done('rooms', '15', 'rooms', '17'),
      done('rooms', '17', 'rooms', '15'),
      done('rooms', '17', 'rooms', '15'),
    ], ...ME });
    assert.equal(out.length, 2);
    assert.equal(out[0].room, '17'); // 3 interactions
    assert.equal(out[0].total, 3);
    assert.equal(out[1].room, '16'); // 1 interaction
  });
});

describe('deriveBonds — filtering', () => {
  test('non-done rows are ignored', () => {
    const out = deriveBonds({ rows: [
      Object.assign(done('rooms', '15', 'rooms', '16'), { status: 'open' }),
      Object.assign(done('rooms', '15', 'rooms', '16'), { status: 'accepted' }),
    ], ...ME });
    assert.deepEqual(out, []);
  });

  test("rows where I'm neither requester nor helper are ignored", () => {
    const out = deriveBonds({ rows: [done('rooms', '20', 'rooms', '21')], ...ME });
    assert.deepEqual(out, []);
  });

  test('rows missing a room on either side are skipped (no throw)', () => {
    const out = deriveBonds({ rows: [
      done('rooms', '15', 'rooms', undefined), // no helperRoom
      { status: 'done', building: 'rooms', room: '15' }, // no helper fields
    ], ...ME });
    assert.deepEqual(out, []);
  });
});

describe('deriveBonds — defensive field reads (§7-T requester-room variants)', () => {
  test('requester room shipped as roomId or requesterRoom still resolves', () => {
    const viaRoomId = { status: 'done', building: 'rooms', roomId: '15', helperBuilding: 'rooms', helperRoom: '18' };
    const viaRequesterRoom = { status: 'done', building: 'rooms', requesterRoom: '15', helperBuilding: 'rooms', helperRoom: '19' };
    const out = deriveBonds({ rows: [viaRoomId, viaRequesterRoom], ...ME });
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(b => b.room).sort(), ['18', '19']);
    assert.ok(out.every(b => b.helpedBy === 1));
  });

  test('numeric rooms coerce to strings + match', () => {
    const out = deriveBonds({ rows: [{ status: 'done', building: 'rooms', room: 15, helperBuilding: 'rooms', helperRoom: 16 }], myBuilding: 'rooms', myRoom: 15 });
    assert.equal(out.length, 1);
    assert.equal(out[0].room, '16');
  });
});

describe('roomLabel — PDPA-minimal building-aware label (no personal name)', () => {
  test('nest → "Nest <room>", others → "ห้อง <room>"', () => {
    assert.equal(roomLabel('nest', 'N101'), 'Nest N101');
    assert.equal(roomLabel('rooms', '15'), 'ห้อง 15');
  });
  test('never contains a digit-free personal-name placeholder — just the room', () => {
    const l = roomLabel('rooms', '15');
    assert.ok(/15/.test(l));
  });
});
