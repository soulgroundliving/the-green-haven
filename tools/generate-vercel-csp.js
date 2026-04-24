#!/usr/bin/env node
/**
 * Phase 4E — Generate the Content-Security-Policy-Report-Only header value.
 *
 * Reads tools/csp-hashes.json, unions every script/style hash across all
 * tracked HTML files, and prints a single CSP string. Copy the output into
 * vercel.json under the "Content-Security-Policy-Report-Only" header.
 *
 * We keep Report-Only mode + leave the existing <meta CSP> (with 'unsafe-inline')
 * enforcing. The browser will still load the site normally but will report
 * every violation — this gives us the refactor scope before we flip to enforce.
 *
 * Run: npm run csp:print
 */
const fs = require('fs');
const path = require('path');

const HASHES_JSON = path.join(__dirname, 'csp-hashes.json');

if (!fs.existsSync(HASHES_JSON)) {
  console.error('Missing tools/csp-hashes.json — run `npm run csp:hash` first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(HASHES_JSON, 'utf8'));

const scriptHashes = new Set();
const styleHashes = new Set();
for (const file of Object.keys(data)) {
  (data[file].scriptHashes || []).forEach(h => scriptHashes.add(h));
  (data[file].styleHashes || []).forEach(h => styleHashes.add(h));
}

const scriptHashTokens = [...scriptHashes].map(h => `'sha256-${h}'`).join(' ');
const styleHashTokens  = [...styleHashes].map(h => `'sha256-${h}'`).join(' ');

// External origins actually used across the 8 HTML files (audited 2026-04-25).
// cdn.tailwindcss.com removed after Phase 4E Tailwind migration (pre-built CSS).
const SCRIPT_SRC_EXTERNAL = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://js.sentry-cdn.com',
  'https://unpkg.com',
  'https://static.line-scdn.net',
  'https://www.gstatic.com',
  'https://www.google.com',
  'https://www.recaptcha.net',
  'https://apis.google.com',
].join(' ');

const STYLE_SRC_EXTERNAL = [
  'https://fonts.googleapis.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
].join(' ');

const FONT_SRC = [
  "'self'",
  'data:',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com',
].join(' ');

const CONNECT_SRC = [
  "'self'",
  'https:',
  'wss:',
  // Sentry + Firebase + LIFF + reCAPTCHA + Google Fonts are all https:
].join(' ');

const IMG_SRC = [
  "'self'",
  'data:',
  'blob:',
  'https:',
].join(' ');

const FRAME_SRC = [
  "'self'",
  'https://www.google.com',    // reCAPTCHA iframe
  'https://www.recaptcha.net',
].join(' ');

const directives = [
  `default-src 'self' https: wss:`,
  `script-src 'self' ${scriptHashTokens} ${SCRIPT_SRC_EXTERNAL}`,
  `script-src-elem 'self' ${scriptHashTokens} ${SCRIPT_SRC_EXTERNAL}`,
  `style-src 'self' ${styleHashTokens} ${STYLE_SRC_EXTERNAL}`,
  `style-src-elem 'self' ${styleHashTokens} ${STYLE_SRC_EXTERNAL}`,
  `img-src ${IMG_SRC}`,
  `font-src ${FONT_SRC}`,
  `connect-src ${CONNECT_SRC}`,
  `frame-src ${FRAME_SRC}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
];

const cspValue = directives.join('; ');

console.log('=== Content-Security-Policy-Report-Only header value ===\n');
console.log(cspValue);
console.log(`\n=== Stats ===`);
console.log(`Script hashes: ${scriptHashes.size}`);
console.log(`Style hashes:  ${styleHashes.size}`);
console.log(`Total length:  ${cspValue.length} chars`);
