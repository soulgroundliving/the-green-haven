#!/usr/bin/env node
/**
 * tools/sweep-hex-colors.js
 *
 * Replaces hardcoded hex colors in shared/dashboard-*.js with DashColors.CONSTANT
 * references. Three replacement patterns in priority order:
 *
 *   A. '#hexval'  (standalone single-quoted) → DashColors.CONST
 *   B. "#hexval"  (standalone double-quoted) → DashColors.CONST
 *   C. '...#hexval...' (hex inside a single-quoted HTML string with no existing
 *       ${} interpolation) → `...${DashColors.CONST}...`  (converts to template literal)
 *   D. #hexval (bare, remaining — inside backtick template literals)
 *       → ${DashColors.CONST}
 *
 * Usage:
 *   node tools/sweep-hex-colors.js --all
 *   node tools/sweep-hex-colors.js shared/dashboard-tenant-lease.js ...
 *   node tools/sweep-hex-colors.js --dry-run --all
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ─── Color map ────────────────────────────────────────────────────────────────
// Order: longer hex before shorter to avoid prefix collision (e.g. #fff8e1 before #fff).
// Each entry is [hex, DashColors constant name].
const COLOR_MAP = [
  // White / near-white
  ['#fafafa', 'SURFACE_FAINT'],
  ['#f0f0f0', 'SURFACE_GRAY'],
  ['#fff',    'WHITE'],
  // Brand warm
  ['#ebe9e2', 'WARM_WHITE'],
  // Borders / dividers
  ['#e5e7eb', 'BORDER_LIGHT'],
  ['#ddd',    'BORDER'],
  // Gray text
  ['#6b7280', 'TEXT_SECONDARY'],
  ['#666',    'TEXT_MUTED'],
  ['#999',    'TEXT_LIGHTER'],
  // Green palette
  ['#1b5e20', 'GREEN_DEEP'],
  ['#2e7d32', 'GREEN_DARK'],
  ['#388e3c', 'GREEN_MED'],
  ['#4caf50', 'GREEN_ACTIVE'],
  ['#c8e6c9', 'GREEN_BORDER'],
  ['#e8f5e9', 'GREEN_BG'],
  // Red / danger
  ['#b71c1c', 'RED_DARKEST'],
  ['#d32f2f', 'RED_TEXT'],
  ['#c62828', 'RED_DEEP'],
  ['#f44336', 'RED_MED'],
  ['#ffebee', 'RED_BG'],
  // Orange / warning
  ['#e65100', 'ORANGE_DEEP'],
  ['#f57c00', 'ORANGE_DARK'],
  ['#ff9800', 'ORANGE_MED'],
  ['#fff3e0', 'ORANGE_BG'],
  // Blue / info
  ['#1565c0', 'BLUE_DARK'],
  ['#1976d2', 'BLUE_MED'],
  ['#e3f2fd', 'BLUE_BG'],
  ['#039',    'BLUE_LINK'],
  // Yellow
  ['#fff9c4', 'YELLOW_BG'],
  // Purple
  ['#f3e5f5', 'PURPLE_BG'],
  // Teal
  ['#0f766e', 'TEAL'],
  // Brand terracotta / clay
  ['#c06458', 'TERRACOTTA'],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sweep one color through the file content.
 * Runs patterns A → B → C → D in order.
 */
function sweepColor(content, hex, name) {
  const e   = escRe(hex);
  const nb  = '(?![0-9a-fA-F])';      // negative lookahead: not a hex digit after
  const K   = `DashColors.${name}`;

  // A: standalone single-quoted: '#hex' → DashColors.CONST
  content = content.replace(new RegExp(`'${e}${nb}'`, 'g'), K);

  // B: standalone double-quoted: "#hex" → DashColors.CONST
  content = content.replace(new RegExp(`"${e}${nb}"`, 'g'), K);

  // C: hex embedded inside a single-quoted HTML string (no existing ${} inside) →
  //    convert that string to a template literal with the hex interpolated.
  //    Restricted to single-line matches (\n excluded) to prevent cross-line grabs.
  //    (?<!&) prevents matching HTML entities like &#039; (would mangle the entity).
  content = content.replace(
    new RegExp(`'([^'\\n\\$]*?)(?<!&)${e}${nb}([^'\\n\\$]*?)'`, 'g'),
    (_, before, after) => '`' + before + '${' + K + '}' + after + '`'
  );

  // D: remaining bare hex (inside backtick template literals) → ${DashColors.CONST}
  //    (?<!&) prevents matching HTML entities like &#039;
  content = content.replace(new RegExp(`(?<!&)${e}${nb}`, 'g'), '${' + K + '}');

  return content;
}

// ─── File sweep ───────────────────────────────────────────────────────────────
function sweepFile(filePath, dryRun) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  for (const [hex, name] of COLOR_MAP) {
    content = sweepColor(content, hex, name);
  }

  const changed = content !== original;
  if (changed && !dryRun) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return { changed, original, content };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const sweepAll = args.includes('--all');

const files = sweepAll
  ? fs.readdirSync('shared')
      .filter(f => /^dashboard-/.test(f) && f.endsWith('.js') && f !== 'dashboard-colors.js')
      .map(f => path.join('shared', f))
  : args.filter(a => !a.startsWith('--'));

if (!files.length) {
  console.error('Usage: node tools/sweep-hex-colors.js --all | <file1> [file2 ...]');
  process.exit(1);
}

let totalChanged = 0;
for (const f of files) {
  const { changed, original, content } = sweepFile(f, dryRun);
  if (changed) {
    totalChanged++;
    console.log(`  ${dryRun ? '[dry]' : '✓'} ${f}`);
    if (verbose && dryRun) {
      const oLines = original.split('\n');
      const nLines = content.split('\n');
      let shown = 0;
      for (let i = 0; i < oLines.length && shown < 8; i++) {
        if (oLines[i] !== nLines[i]) {
          console.log(`    L${i + 1}: ${oLines[i].trim().slice(0, 80)}`);
          console.log(`       → ${nLines[i].trim().slice(0, 80)}`);
          shown++;
        }
      }
    }
  }
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}${totalChanged}/${files.length} files changed`);
