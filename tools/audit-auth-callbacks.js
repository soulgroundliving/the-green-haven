#!/usr/bin/env node
/**
 * audit-auth-callbacks.js — guard against §7-A/§7-U/§7-Z regressions.
 *
 * Every raw `window.addEventListener('authReady'|'liffLinked', ...)` in client
 * code MUST EITHER:
 *   a) be the internal implementation of `_onLiffClaimsReady` itself (whitelisted), OR
 *   b) carry a `[audit-skip]` justification comment within 3 lines above.
 *
 * Why: §7-A cost 5+ sessions ("bills not showing"), §7-Z (claim-ephemeral) was
 * discovered 2026-05-18. Both share root: auth-gated reads firing before LIFF
 * custom-token claims arrive. The `_onLiffClaimsReady` helper centralizes the
 * pattern; raw listeners are how the bug class recurs. This script makes the
 * justification explicit and grep-checkable.
 *
 * Exit 0 if every match is justified.
 * Exit 1 if any unjustified match exists.
 *
 * Usage:
 *   node tools/audit-auth-callbacks.js
 *
 * Wired into `npm run verify:memory:all` so the pre-push hook catches it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const SCAN_GLOBS = [
  'tenant_app.html',
  'dashboard.html',
  'booking.html',
  'login.html',
  'tax-filing.html',
  'audit-log-viewer.html',
  'payment.html',
  'privacy.html',
];

const LISTENER_RE = /window\.addEventListener\(\s*['"](?:authReady|liffLinked)['"]/;
const AUDIT_SKIP_RE = /\[audit-skip\]/;

function listSharedJs() {
  const sharedDir = path.join(REPO_ROOT, 'shared');
  if (!fs.existsSync(sharedDir)) return [];
  return fs.readdirSync(sharedDir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('shared', f));
}

function findInFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) return [];
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!LISTENER_RE.test(lines[i])) continue;
    hits.push({ file: relPath, lineNo: i + 1, line: lines[i], prev: lines.slice(Math.max(0, i - 3), i) });
  }
  return hits;
}

function isHelperInternal(hit) {
  // Whitelist: the two lines inside `function _onLiffClaimsReady(fn) { ... }` itself.
  // Look back up to 6 lines for the declaration; require `function _onLiffClaimsReady` to appear.
  const abs = path.join(REPO_ROOT, hit.file);
  const all = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const start = Math.max(0, hit.lineNo - 7);
  const window = all.slice(start, hit.lineNo).join('\n');
  return /function\s+_onLiffClaimsReady\s*\(/.test(window);
}

function isJustified(hit) {
  // [audit-skip] in any of the 3 lines above the listener (the comment block).
  return hit.prev.some(l => AUDIT_SKIP_RE.test(l));
}

function main() {
  const files = [...SCAN_GLOBS, ...listSharedJs()];
  const allHits = [];
  for (const f of files) {
    for (const hit of findInFile(f)) allHits.push(hit);
  }

  const violations = [];
  for (const hit of allHits) {
    if (isHelperInternal(hit)) continue;        // helper definition itself
    if (isJustified(hit)) continue;             // has [audit-skip] comment
    violations.push(hit);
  }

  if (violations.length === 0) {
    console.log(`audit-auth-callbacks: PASS (${allHits.length} matches, all justified or in helper)`);
    process.exit(0);
  }

  console.error(`audit-auth-callbacks: FAIL — ${violations.length} unjustified listener(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.lineNo}`);
    console.error(`    ${v.line.trim()}`);
  }
  console.error(`\nFix: either wrap via _onLiffClaimsReady(fn), OR add a comment within 3 lines above:`);
  console.error(`  // [audit-skip] <reason — e.g. "system/X is public-read (firestore.rules:NN)">`);
  console.error(`\nSee §7-A, §7-U, §7-Z in CLAUDE.md for context.`);
  process.exit(1);
}

main();
