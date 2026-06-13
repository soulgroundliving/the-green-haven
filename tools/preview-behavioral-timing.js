/**
 * READ-ONLY preview of the Behavioral Analytics Phase 0 timing heatmap against LIVE
 * prod data (§7-J live-data verify — closes the gap the admin-auth-gated dashboard
 * card can't be screenshotted without a session).
 *
 * Uses ADC (gcloud application-default login) — no service-account key file. NEVER
 * writes. Reads the SAME pointsLedger 90-day window the card reads, then runs the
 * REAL shipped computeTiming (loaded from shared/dashboard-behavioral-timing.js via
 * the same vm shim the unit test uses — single source of truth, no drift) and prints
 * the heatmap + peak stats.
 *
 * AGGREGATE-ONLY (mirrors the card, Fork #1): consumes only event timestamps — no
 * tenantId / name / room is printed. Zero PII.
 *
 * Run: NODE_PATH=functions/node_modules node tools/preview-behavioral-timing.js
 *   (firebase-admin lives in functions/node_modules; same pattern as the other
 *    admin-SDK tools, e.g. preview-trust-scores.js.)
 */
'use strict';

const admin = require('firebase-admin');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

admin.initializeApp({ projectId: 'the-green-haven' });
const db = admin.firestore();

const WINDOW_DAYS = 90;
const LEDGER_LIMIT = 3000;

// Load the REAL shipped computeTiming (browser IIFE → window._ins.behavioralTiming).
function loadCard() {
  const prev = global.window;
  global.window = {};
  try {
    const abs = path.join(__dirname, '..', 'shared', 'dashboard-behavioral-timing.js');
    vm.runInThisContext(fs.readFileSync(abs, 'utf8'), { filename: 'dashboard-behavioral-timing.js' });
    return global.window._ins.behavioralTiming;
  } finally {
    if (prev === undefined) delete global.window; else global.window = prev;
  }
}

const SHADE = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function shade(count, max) {
  if (!count) return ' ';
  const i = Math.min(SHADE.length - 1, Math.max(1, Math.round((count / max) * (SHADE.length - 1))));
  return SHADE[i];
}
const hh = (h) => String(h).padStart(2, '0');

async function main() {
  const card = loadCard();
  const now = Date.now();
  const cutoff = new Date(now - WINDOW_DAYS * 86400000);

  let snap;
  try {
    snap = await db.collection('pointsLedger')
      .where('at', '>=', cutoff)
      .orderBy('at', 'desc')
      .limit(LEDGER_LIMIT)
      .get();
  } catch (e) {
    console.error('pointsLedger read failed:', e.message);
    console.error('(ADC not set up? run: gcloud auth application-default login)');
    process.exit(1);
  }

  const events = [];
  const bySource = new Map();
  let minMs = Infinity, maxMs = -Infinity;
  snap.forEach((d) => {
    const data = d.data() || {};
    const atMs = data.at && typeof data.at.toMillis === 'function' ? data.at.toMillis() : null;
    if (atMs == null) return;
    events.push({ atMs });
    if (atMs < minMs) minMs = atMs;
    if (atMs > maxMs) maxMs = atMs;
    bySource.set(data.source || '?', (bySource.get(data.source || '?') || 0) + 1);
  });

  const e = card.computeTiming(events, now);

  console.log(`\npointsLedger events in last ${WINDOW_DAYS}d: ${events.length}${snap.size >= LEDGER_LIMIT ? ` (capped at ${LEDGER_LIMIT})` : ''}`);
  if (events.length === 0) {
    console.log('→ the card will render its empty-state ("ยังไม่มีกิจกรรม…"). No ledger data yet.\n');
    return;
  }
  console.log(`range: ${new Date(minMs).toISOString().slice(0, 10)} … ${new Date(maxMs).toISOString().slice(0, 10)}`);
  console.log(`peak hour (BKK): ${hh(e.peakHour.hour)}:00  (${e.peakHour.count})   ` +
              `peak day: ${DOW[e.peakDow.dow]} (${e.peakDow.count})   ` +
              `weekday/weekend: ${e.weekdayCount}/${e.weekendCount}`);
  console.log(`hottest cell: ${DOW[e.peak.dow]} ${hh(e.peak.hour)}:00 → ${e.peak.count}\n`);

  // ASCII heatmap (7 rows × 24 hour cols), BKK — same grid the card renders.
  const max = e.peak.count || 1;
  console.log('      ' + Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? hh(h) : '  ')).join(' '));
  for (let d = 0; d < 7; d++) {
    const row = e.grid[d].map((c) => shade(c, max)).join('  ');
    console.log(`  ${DOW[d]}  ${row}`);
  }
  console.log(`\n  legend  low ${SHADE.join('')} high   (cell = point-earning events in that BKK hour)`);

  const srcRank = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join('  ');
  console.log(`  sources: ${srcRank}`);
  console.log('\n(READ-ONLY preview — nothing written. Verifies the live data the dashboard card renders.)');
}

main().then(() => process.exit(0)).catch((err) => { console.error('preview failed:', err); process.exit(1); });
