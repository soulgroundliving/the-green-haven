/**
 * READ-ONLY preview of raw behaviorEvents (Behavioral Analytics Phase 1a verify).
 *
 * Reads RTDB behaviorEvents/{building}/{room}/{pushId} = { events:[…], flushedAt, n }
 * written by shared/tenant-analytics.js and prints aggregate page-view / action
 * counts + DISTINCT-room adoption. NEVER writes. ADC, no key file.
 *
 * AGGREGATE-ONLY: prints counts + `building/room` keys only — the rollup CF (1b)
 * will collapse these to identity-free adoption totals. Use this after a real-LINE
 * open to confirm events are landing (the gate the admin dashboard can't show).
 *
 * Run: NODE_PATH=functions/node_modules node tools/preview-behavior-events.js
 */
'use strict';

const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'the-green-haven',
  databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const rtdb = admin.database();

const _arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const _top = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n);

async function main() {
  let tree;
  try {
    tree = (await rtdb.ref('behaviorEvents').once('value')).val() || {};
  } catch (e) {
    console.error('behaviorEvents read failed:', e.message);
    console.error('(ADC not set up? run: gcloud auth application-default login)');
    process.exit(1);
  }

  let flushes = 0, events = 0, minTs = Infinity, maxTs = -Infinity;
  const pages = new Map();   // page  → { n, rooms:Set }
  const actions = new Map(); // action→ { n, rooms:Set }
  const roomsSeen = new Set();
  const bump = (m, k, rk) => {
    if (!m.has(k)) m.set(k, { n: 0, rooms: new Set() });
    const e = m.get(k); e.n++; e.rooms.add(rk);
  };

  for (const building of Object.keys(tree)) {
    for (const room of Object.keys(tree[building] || {})) {
      const rk = `${building}/${room}`;
      for (const pushId of Object.keys(tree[building][room] || {})) {
        const node = tree[building][room][pushId] || {};
        flushes++;
        if (typeof node.flushedAt === 'number') {
          if (node.flushedAt < minTs) minTs = node.flushedAt;
          if (node.flushedAt > maxTs) maxTs = node.flushedAt;
        }
        for (const ev of _arr(node.events)) {
          if (!ev) continue;
          events++; roomsSeen.add(rk);
          if (ev.t === 'pv') bump(pages, ev.p || '(none)', rk);
          else if (ev.t === 'ac') bump(actions, ev.a || '(none)', rk);
        }
      }
    }
  }

  console.log(`\nbehaviorEvents: ${flushes} flushes · ${events} events · ${roomsSeen.size} distinct rooms`);
  if (!flushes) {
    console.log('→ no events yet. Open the tenant LIFF app as a real tenant, navigate a few pages, then re-run.\n');
    return;
  }
  console.log(`range: ${new Date(minTs).toISOString().slice(0, 16)} … ${new Date(maxTs).toISOString().slice(0, 16)} UTC`);
  const N = roomsSeen.size || 1;

  console.log('\nTOP PAGES (page_view) — count · adoption (distinct rooms / rooms seen):');
  for (const [p, e] of _top(pages).slice(0, 15)) {
    console.log(`  ${String(p).padEnd(24)} ${String(e.n).padStart(5)}   ${e.rooms.size}/${N} (${Math.round(e.rooms.size / N * 100)}%)`);
  }
  console.log('\nTOP ACTIONS (data-action) — count · distinct rooms:');
  for (const [a, e] of _top(actions).slice(0, 20)) {
    console.log(`  ${String(a).padEnd(28)} ${String(e.n).padStart(5)}   ${e.rooms.size}/${N}`);
  }
  console.log('\n(READ-ONLY preview — nothing written. The 1b rollup CF will write identity-free adoption totals.)');
}

main().then(() => process.exit(0)).catch((err) => { console.error('preview failed:', err); process.exit(1); });
