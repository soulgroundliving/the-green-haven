#!/usr/bin/env node
/**
 * update-vercel-csp.js — write the freshly-generated CSP value into vercel.json
 *
 * Reads tools/csp-hashes.json (regen with `npm run csp:hash` first), composes
 * the full CSP string via tools/generate-vercel-csp.js, and replaces the
 * "Content-Security-Policy" header value in vercel.json in place.
 *
 * Preserves JSON formatting (2-space indent) and writes LF line endings.
 *
 * Run: node tools/update-vercel-csp.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERCEL = path.join(ROOT, 'vercel.json');

const printed = execSync('node tools/generate-vercel-csp.js', {
  cwd: ROOT,
  encoding: 'utf8'
});

const cspValue = printed
  .split('=== Content-Security-Policy header value ===')[1]
  .split('=== Stats ===')[0]
  .trim();

if (!cspValue || !cspValue.startsWith('default-src')) {
  console.error('Failed to extract CSP value from generate-vercel-csp.js output');
  process.exit(1);
}

const vj = JSON.parse(fs.readFileSync(VERCEL, 'utf8'));
const headers = vj.headers[0].headers;
const cspHeader = headers.find(h => h.key === 'Content-Security-Policy');
if (!cspHeader) {
  console.error('Content-Security-Policy header not found in vercel.json[0].headers');
  process.exit(1);
}

const oldLen = cspHeader.value.length;
const newLen = cspValue.length;
cspHeader.value = cspValue;

fs.writeFileSync(VERCEL, JSON.stringify(vj, null, 2) + '\n', 'utf8');

console.log(`OK — vercel.json CSP updated. oldLen=${oldLen} newLen=${newLen} delta=${newLen - oldLen}`);
