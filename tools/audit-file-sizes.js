#!/usr/bin/env node
/**
 * audit-file-sizes.js — sustainable 3-tier file-size gate.
 *
 *   INFO   — printed every run: current size, % of hard limit, growth in
 *            the currently staged diff (if any).
 *   WARN   — file ≥ soft limit OR single commit adds > growthPerCommit
 *            net lines. Non-blocking — printed to stderr.
 *   BLOCK  — file ≥ hard limit. Exit 1.
 *
 * Why: large monolithic files hide bugs (§7-W cascade, §7-X innerHTML
 * footgun) and reviewing diffs in 13k-line files is unreliable. Hard
 * limits force extraction into shared/<feature>.js — precedent:
 * checklist-manager.js, building-registry.js. Soft limits give early
 * warning while there's still runway. Growth-per-commit catches
 * "let me just add this inline" before it lands.
 *
 * Limits are explicit JSON (tools/file-size-limits.json) so every bump
 * shows up in git diff with the commit's rationale.
 *
 * Usage:
 *   node tools/audit-file-sizes.js           # info + warn + block (verbose)
 *   node tools/audit-file-sizes.js --quiet   # suppress INFO; WARN/BLOCK only
 *
 * Wired into pre-commit hook (section F).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'file-size-limits.json');
const QUIET = process.argv.includes('--quiet');

function countLines(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return fs.readFileSync(absPath, 'utf8').split(/\r?\n/).length;
}

function stagedGrowth(relPath) {
  // Net lines added in the currently staged diff. null if not staged.
  try {
    const out = execSync(`git diff --cached --numstat -- "${relPath}"`, {
      cwd: REPO_ROOT, encoding: 'utf8'
    }).trim();
    if (!out) return null;
    const parts = out.split(/\s+/);
    const added = Number(parts[0]);
    const deleted = Number(parts[1]);
    if (isNaN(added) || isNaN(deleted)) return null;
    return added - deleted;
  } catch {
    return null;
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[audit-size] config missing: ${CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function main() {
  const config = loadConfig();
  const infos = [];
  const warns = [];
  let blocked = false;

  for (const [relPath, limits] of Object.entries(config)) {
    if (relPath.startsWith('_')) continue;
    const lines = countLines(path.join(REPO_ROOT, relPath));
    if (lines === null) continue;
    const growth = stagedGrowth(relPath);

    const pctHard = Math.round((lines / limits.hard) * 100);
    const pctSoft = Math.round((lines / limits.soft) * 100);
    const growthStr = (growth !== null && growth !== 0)
      ? ` · staged ${growth > 0 ? '+' : ''}${growth}`
      : '';
    infos.push(`  ${relPath}: ${lines} lines · ${pctSoft}% of soft (${limits.soft}) · ${pctHard}% of hard (${limits.hard})${growthStr}`);

    if (lines >= limits.hard) {
      warns.push(
        `BLOCK ${relPath}: ${lines} lines ≥ hard limit ${limits.hard}\n` +
        `      Extract a feature into shared/<feature>.js OR bump 'hard' in tools/file-size-limits.json (with rationale in commit msg).`
      );
      blocked = true;
    } else if (lines >= limits.soft) {
      warns.push(
        `WARN  ${relPath}: ${lines} lines ≥ soft limit ${limits.soft} (hard ${limits.hard})\n` +
        `      Consider extracting the next big feature into shared/<feature>.js. ${limits.hard - lines} lines until hard block.`
      );
    }

    if (growth !== null && growth > limits.growthPerCommit) {
      warns.push(
        `WARN  ${relPath}: this commit adds +${growth} lines (threshold ${limits.growthPerCommit})\n` +
        `      Consider whether the new code should live in shared/<feature>.js (precedent: checklist-manager.js).`
      );
    }
  }

  if (!QUIET) {
    console.log('audit-file-sizes:');
    for (const i of infos) console.log(i);
  }
  for (const w of warns) console.error(w);
  if (blocked) {
    console.error('\n(See tools/file-size-limits.json. Hard limit exists for §7-W/§7-X reasons — review-at-scale failures.)');
    process.exit(1);
  }
  process.exit(0);
}

main();
