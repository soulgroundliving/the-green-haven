/**
 * tools/smoke-test/runner.js
 *
 * Entry point for `npm run smoke`. Prints the playbook path, reminds the
 * sequence, and pre-flights the env + auth so the playbook driver (Claude
 * via Chrome MCP) doesn't waste a step discovering a missing prerequisite.
 *
 * Does NOT execute the playbook itself — Chrome MCP can only be driven by
 * Claude, not from a Node process. This script's job is to make sure the
 * playbook is ready to run.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLAYBOOK_ADMIN = path.join('tasks', 'smoke-test-admin-playbook.md');
const PLAYBOOK_LIFF  = path.join('tasks', 'smoke-test-liff-playbook.md');

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

function ftTokenAvailable() {
  if (process.env.GCLOUD_ACCESS_TOKEN) return true;
  const os = require('os');
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const ft = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (ft.tokens?.access_token) return true;
    } catch (_) {}
  }
  return false;
}

function main() {
  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  Nature Haven Smoke Test — runner');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Pre-flight checks
  const checks = [
    {
      name: 'Admin playbook present',
      pass: exists(PLAYBOOK_ADMIN),
      fix:  `expected at ${PLAYBOOK_ADMIN} — re-run repo init if missing`,
    },
    {
      name: 'LIFF playbook present',
      pass: exists(PLAYBOOK_LIFF),
      fix:  `expected at ${PLAYBOOK_LIFF} — re-run repo init if missing`,
    },
    {
      name: 'Verifier present',
      pass: exists(path.join('tools', 'smoke-test', 'verify.js')),
      fix:  'expected at tools/smoke-test/verify.js',
    },
    {
      name: 'SMOKE_ADMIN_EMAIL env var',
      pass: !!process.env.SMOKE_ADMIN_EMAIL,
      fix:  '$env:SMOKE_ADMIN_EMAIL = "admin@example.com" (PowerShell) — export SMOKE_ADMIN_EMAIL=... (bash)',
    },
    {
      name: 'SMOKE_ADMIN_PASSWORD env var',
      pass: !!process.env.SMOKE_ADMIN_PASSWORD,
      fix:  '(value hidden) — set in shell, NEVER commit. See tools/smoke-test/README.md',
    },
    {
      name: 'firebase-tools OAuth token OR GCLOUD_ACCESS_TOKEN',
      pass: ftTokenAvailable(),
      fix:  'run `firebase login` once, OR set GCLOUD_ACCESS_TOKEN env var',
    },
  ];

  let allPass = true;
  lines.push('Pre-flight:');
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    lines.push(`  ${icon}  ${c.name}`);
    if (!c.pass) { lines.push(`     ↳ ${c.fix}`); allPass = false; }
  }
  lines.push('');

  if (!allPass) {
    lines.push('Fix the failing rows above, then re-run `npm run smoke`.');
    console.log(lines.join('\n'));
    process.exit(1);
  }

  // Print runbook
  lines.push('Pre-flight OK. Proceed with the playbook in this order:');
  lines.push('');
  lines.push(`  1. Admin side  →  open ${PLAYBOOK_ADMIN}`);
  lines.push('     Driver: Claude via mcp__Claude_in_Chrome__* tools.');
  lines.push('     Per flow: execute steps, fill ☐ Pass/Fail, run verifier subcommand.');
  lines.push('     Runtime: ~5–7 min if green.');
  lines.push('');
  lines.push(`  2. Tenant LIFF  →  open ${PLAYBOOK_LIFF}`);
  lines.push('     Driver: USER on a real phone in LINE.');
  lines.push('     Cannot be automated — LINE platform blocks non-LIFF origins.');
  lines.push('     Runtime: ~5 min if green.');
  lines.push('');
  lines.push('Verifier (read-only post-condition checks):');
  lines.push('  npm run smoke:verify -- login    --email $SMOKE_ADMIN_EMAIL');
  lines.push('  npm run smoke:verify -- bill     --building rooms --room 15');
  lines.push('  npm run smoke:verify -- checklist-instance --id <id>');
  lines.push('  npm run smoke:verify -- deposit  --building rooms --room 15');
  lines.push('');
  lines.push('Exit 0 from each verifier = pass for that row in the playbook.');
  lines.push('═══════════════════════════════════════════════════════════════');

  console.log(lines.join('\n'));
}

main();
