/**
 * _behaviorRollup.js — pure aggregation for the Behavioral Analytics dead-feature
 * detector (Phase 1b). NO firebase deps → testable in isolation (mirrors _reputation.js).
 *
 * Input: the RTDB behaviorEvents tree { building: { room: { pushId: {events,flushedAt,n} } } }
 * written by shared/tenant-analytics.js. Output: identity-free adoption totals
 * (counts + DISTINCT-room counts per page/action) → behavioralRollup/adoption.
 *
 * AGGREGATE-ONLY (Fork #1): emits COUNTS only — distinct-room COUNTS, never room ids.
 * `pct` is distinct-rooms / occupiedRooms (the adoption %); a feature with a low pct
 * over the window is the dead-feature signal.
 */
'use strict';

const DAY_MS = 86400000;

// RTDB stores an events array as a real array OR an object with numeric keys.
function _events(node) {
  const e = node && node.events;
  if (Array.isArray(e)) return e;
  if (e && typeof e === 'object') return Object.values(e);
  return [];
}

/**
 * @param {object} tree  behaviorEvents RTDB val (building→room→pushId→{events,flushedAt})
 * @param {{occupiedRooms?:number, nowMs?:number, windowDays?:number}} opts
 * @returns {{windowDays:number, occupiedRooms:number, totalEvents:number,
 *   totalFlushes:number, activeRooms:number,
 *   pages:Array<{k:string,count:number,rooms:number,pct:number|null}>,
 *   actions:Array<{k:string,count:number,rooms:number,pct:number|null}>}}
 */
function computeAdoption(tree, opts) {
  const o = opts || {};
  const windowDays = o.windowDays || 30;
  const occupiedRooms = o.occupiedRooms || 0;
  const cutoff = (o.nowMs || 0) - windowDays * DAY_MS;

  const pages = new Map();   // page   → { count, rooms:Set }
  const actions = new Map(); // action → { count, rooms:Set }
  const activeRooms = new Set();
  let totalEvents = 0, totalFlushes = 0;

  const bump = (m, k, rk) => {
    let e = m.get(k);
    if (!e) { e = { count: 0, rooms: new Set() }; m.set(k, e); }
    e.count += 1;
    e.rooms.add(rk);
  };

  Object.keys(tree || {}).forEach((building) => {
    const rooms = tree[building] || {};
    Object.keys(rooms).forEach((room) => {
      const rk = building + '/' + room;
      const pushes = rooms[room] || {};
      Object.keys(pushes).forEach((pid) => {
        totalFlushes += 1;
        _events(pushes[pid]).forEach((ev) => {
          if (!ev) return;
          const ts = Number(ev.ts);
          if (isFinite(ts) && ts < cutoff) return;   // outside the adoption window
          totalEvents += 1;
          activeRooms.add(rk);
          if (ev.t === 'pv') bump(pages, ev.p || '(none)', rk);
          else if (ev.t === 'ac') bump(actions, ev.a || '(none)', rk);
        });
      });
    });
  });

  const toArr = (m) => Array.from(m.entries())
    .map(([k, e]) => ({
      k,
      count: e.count,
      rooms: e.rooms.size,
      pct: occupiedRooms ? Math.round((e.rooms.size / occupiedRooms) * 100) : null,
    }))
    .sort((a, b) => b.rooms - a.rooms || b.count - a.count || (a.k < b.k ? -1 : 1));

  return {
    windowDays,
    occupiedRooms,
    totalEvents,
    totalFlushes,
    activeRooms: activeRooms.size,
    pages: toArr(pages),
    actions: toArr(actions),
  };
}

module.exports = { computeAdoption };
