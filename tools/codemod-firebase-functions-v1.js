#!/usr/bin/env node
/**
 * One-shot codemod: replace `require('firebase-functions')` with
 * `require('firebase-functions/v1')` across functions/*.js.
 *
 * Needed when bumping firebase-functions from v5 → v6+ because v6+ no longer
 * exposes the v1 API as the default top-level export. All existing CFs in this
 * repo use the v1 API (`functions.region().https.onCall(...)` etc), so we
 * preserve behavior by routing imports through the `/v1` subpath.
 *
 * Idempotent — safe to re-run.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'functions');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && !f.startsWith('__'));

let touched = 0;
const re = /require\((["'])firebase-functions\1\)/g;

for (const f of files) {
  const p = path.join(dir, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(re, "require('firebase-functions/v1')");
  if (after !== before) {
    fs.writeFileSync(p, after);
    touched++;
    console.log('  ' + f);
  }
}
console.log('---');
console.log('Touched:', touched, 'files');
