#!/usr/bin/env node
/**
 * One-shot repair: restore Thai text double-encoded (UTF-8 → CP874 → UTF-8) by the
 * bulk console.info sed in commit 7e5ef7b. Last clean commit = 0ad1d8a (verified by
 * walking tenant-system.js history: the getTenantDisplayName default literal is valid
 * Thai at 0ad1d8a and mojibake from 7e5ef7b onward).
 *
 * Design constraint: NO Thai (clean or mojibake) is typed in this file — every
 * replacement byte is read from `git show 0ad1d8a:shared/tenant-system.js`. We locate
 * lines by UNIQUE ASCII anchors (verified count==1) and copy the clean line across,
 * preserving the work file's own indentation. Each anchor is asserted unique on both
 * sides before writing; the script aborts without writing if anything is off.
 *
 * tenant-firebase-sync.js was split out of tenant-system.js AFTER corruption, so its
 * two corrupted comment lines are sourced from the same clean blob (they originated
 * in tenant-system.js's loadLease region).
 *
 * Usage: node tools/fix-thai-mojibake.js [--apply]   (dry-run without --apply)
 */
'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');

const APPLY = process.argv.includes('--apply');
const GOOD_REF = '0ad1d8a';

const goodTS = cp
  .execSync(`git show ${GOOD_REF}:shared/tenant-system.js`, { encoding: 'utf8', maxBuffer: 1e8 })
  .split(/\r?\n/);

// Return the single clean line containing `anchor`; throw if not exactly one.
function goodLine(anchor) {
  const hits = goodTS.filter((l) => l.includes(anchor));
  if (hits.length !== 1) throw new Error(`good anchor not unique (${hits.length}): ${anchor}`);
  return hits[0].replace(/^\s*/, '');
}
// Clean line at fixed offset after the unique `id: 'ANN_00X'` line.
function goodAfterId(annId, offset) {
  const i = goodTS.findIndex((l) => l.includes(`id: '${annId}'`));
  if (i < 0) throw new Error(`good ANN id not found: ${annId}`);
  return goodTS[i + offset].replace(/^\s*/, '');
}

/**
 * Fix plan per file: list of { anchor, occ?, good } where `anchor` is a unique ASCII
 * substring identifying the WORK line to replace, and `good` is the clean replacement
 * (indentation-stripped; work indentation is reused).
 */
function buildPlanTS() {
  return [
    // header comment — the corrupted Thai line sits one line BELOW the unique
    // "* Consolidates:" anchor. Replace at offset +1 with the parent's matching
    // header line (found by its ASCII-free position relative to the same anchor).
    { afterAnchor: '* Consolidates: tenant-config.js', offset: 1,
      good: goodTS[goodTS.findIndex((l) => l.includes('* Consolidates: tenant-config.js')) + 1].replace(/^\s*/, '') },
    { anchor: 'return tenantData?.tenant?.name ||', good: goodLine('return tenantData?.tenant?.name ||') },
    { anchor: 'const roomName = room?.name ||', good: goodLine('const roomName = room?.name ||') },
    { anchor: 'name: tenant?.name ||', good: goodLine('name: tenant?.name ||') },
    { anchor: "color: 'green' };", good: goodLine("color: 'green' };") },
    { anchor: "color: 'red' };", good: goodLine("color: 'red' };") },
    { anchor: '${daysLeft}', good: goodLine('${daysLeft}') },
    // maintenance demo block — title is id+1, content is id+5 (verified offsets)
    { afterAnchor: "id: 'ANN_001'", offset: 1, good: goodAfterId('ANN_001', 1) },
    { afterAnchor: "id: 'ANN_001'", offset: 5, good: goodAfterId('ANN_001', 5) },
    { afterAnchor: "id: 'ANN_002'", offset: 1, good: goodAfterId('ANN_002', 1) },
    { afterAnchor: "id: 'ANN_002'", offset: 5, good: goodAfterId('ANN_002', 5) },
    { afterAnchor: "id: 'ANN_003'", offset: 1, good: goodAfterId('ANN_003', 1) },
    { afterAnchor: "id: 'ANN_003'", offset: 5, good: goodAfterId('ANN_003', 5) },
  ];
}

// em-dash "โ€"" → "—" sourced from the clean blob (find a clean line containing —).
const EMDASH_GOOD = (() => {
  const l = goodTS.find((x) => / — /.test(x));
  const m = l && l.match(/ (—) /);
  return m ? m[1] : null;
})();
// the corrupt em-dash run, read from the work file itself (no multibyte typed here)
function emdashBad(lines) {
  const l = lines.find((x) => /โ€/.test(x));
  const m = l && l.match(/โ€[^\x00-\x7F]?/);
  return m ? m[0] : null;
}

function applyPlan(file, plan) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const indentOf = (s) => (s.match(/^\s*/) || [''])[0];
  const log = [];
  let failed = 0;

  for (const step of plan) {
    if (step.anchor) {
      const idxs = lines.map((l, i) => (l.includes(step.anchor) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length !== 1) { log.push(`❌ anchor ${idxs.length}×: ${step.anchor}`); failed++; continue; }
      const i = idxs[0];
      lines[i] = indentOf(lines[i]) + step.good;
      log.push(`✅ L${i + 1}: ${JSON.stringify(step.good).slice(0, 64)}`);
    } else if (step.afterAnchor) {
      const idxs = lines.map((l, i) => (l.includes(step.afterAnchor) ? i : -1)).filter((i) => i >= 0);
      if (idxs.length !== 1) { log.push(`❌ afterAnchor ${idxs.length}×: ${step.afterAnchor}`); failed++; continue; }
      const i = idxs[0] + (step.offset || 0);
      lines[i] = indentOf(lines[i]) + step.good.replace(/^\s*/, '');
      log.push(`✅ L${i + 1}: ${JSON.stringify(lines[i].trim()).slice(0, 64)}`);
    }
  }

  // em-dash pass
  const bad = emdashBad(lines);
  let emFixed = 0;
  if (bad && EMDASH_GOOD) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(bad)) { lines[i] = lines[i].split(bad).join(EMDASH_GOOD); emFixed++; }
    }
  }
  if (emFixed) log.push(`✅ em-dash fixed on ${emFixed} line(s)`);

  console.log(`\n=== ${file} ===`);
  log.forEach((l) => console.log('  ' + l));

  if (APPLY && failed === 0) {
    fs.writeFileSync(file, lines.join(eol), 'utf8');
    console.log('  ✍️  WROTE');
  } else if (APPLY) {
    console.log('  ⛔ SKIPPED WRITE — ' + failed + ' failed anchor(s)');
  }
  return failed === 0;
}

// tenant-firebase-sync.js: its 2 comment lines map to clean loadLease-region comments.
function buildPlanSync() {
  // anchors unique within tenant-firebase-sync.js work file
  return [
    { anchor: 'Room IDs:', good: goodLine('Room IDs:') },
    { anchor: 'Firestore docId', good: goodLine('Firestore docId') },
  ];
}

const okTS = applyPlan('shared/tenant-system.js', buildPlanTS());
const okSync = applyPlan('shared/tenant-firebase-sync.js', buildPlanSync());
console.log(`\n${APPLY ? 'Applied.' : 'Dry run — pass --apply to write.'}`);
process.exit(okTS && okSync ? 0 : 1);
