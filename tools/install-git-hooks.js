#!/usr/bin/env node
/**
 * install-git-hooks.js — copies committed git hooks from tools/git-hooks/
 * into .git/hooks/, making them executable.
 *
 * Runs automatically on `npm install` via package.json `postinstall`.
 * Idempotent: safe to re-run; overwrites .git/hooks/<name> with the canonical version.
 *
 * Why: git doesn't propagate .git/hooks/ to clones. By committing the hooks
 * under tools/git-hooks/ and wiring this script to npm install, every fresh
 * clone gets the same hook setup the moment they `npm install` — no manual
 * "remember to install hooks" step pushed onto the next person/session.
 *
 * Graceful: if .git/ doesn't exist (e.g. the repo was downloaded as a zip,
 * not cloned), the script exits 0 silently rather than blocking the install.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const GIT_HOOKS_DIR = path.join(REPO_ROOT, '.git', 'hooks');
const SOURCE_HOOKS_DIR = path.join(REPO_ROOT, 'tools', 'git-hooks');

function main() {
  // Skip silently if not a git checkout (e.g. zip download, deploy environment).
  if (!fs.existsSync(path.join(REPO_ROOT, '.git'))) {
    console.log('[install-git-hooks] no .git directory — skipping (not a git checkout)');
    return;
  }
  if (!fs.existsSync(GIT_HOOKS_DIR)) {
    fs.mkdirSync(GIT_HOOKS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SOURCE_HOOKS_DIR)) {
    console.log(`[install-git-hooks] no source hooks at ${SOURCE_HOOKS_DIR} — skipping`);
    return;
  }

  const hooks = fs.readdirSync(SOURCE_HOOKS_DIR).filter(f => !f.startsWith('.'));
  let installed = 0;
  for (const name of hooks) {
    const src = path.join(SOURCE_HOOKS_DIR, name);
    const dst = path.join(GIT_HOOKS_DIR, name);
    fs.copyFileSync(src, dst);
    // Make executable (matters on Unix; no-op on Windows but harmless).
    try { fs.chmodSync(dst, 0o755); } catch (_) {}
    installed++;
  }
  console.log(`[install-git-hooks] installed ${installed} hook(s) from tools/git-hooks/ → .git/hooks/`);
}

try {
  main();
} catch (e) {
  // Never block `npm install` for hook setup failure — log and proceed.
  console.warn(`[install-git-hooks] non-fatal: ${e.message}`);
}
