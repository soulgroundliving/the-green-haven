#!/usr/bin/env node
/**
 * Phase 4E — CSP hash generator.
 *
 * Extracts every inline <script> and <style> block from the HTML files below,
 * computes the SHA-256 hash of each block's exact content (no trimming), and
 * writes tools/csp-hashes.json. The generator in tools/generate-vercel-csp.js
 * consumes that JSON to render the vercel.json headers block.
 *
 * Run: npm run csp:hash  (regenerate when any inline script/style changes)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'index.html',
  'login.html',
  'dashboard.html',
  'tenant_app.html',
  'tax-filing.html',
  'meter_history.html',
  'audit-log-viewer.html',
  'payment.html',
];

// Normalize to LF. Git is configured with core.autocrlf=true on Windows, so the
// working-copy file has CRLF but Git stores LF and Vercel serves LF. Browsers
// hash what they receive (LF), so we must hash the LF form — not the CRLF one
// sitting on local disk — or every CSP hash will mismatch in production.
function sha256b64(content) {
  const lf = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(lf, 'utf8').digest('base64');
}

// Extract inline <script>...</script> blocks (no src= attribute).
function extractInlineScripts(html) {
  const re = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
  const hashes = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[2];
    if (body.length === 0) continue; // skip empty <script></script>
    hashes.add(sha256b64(body));
  }
  return Array.from(hashes);
}

// Extract inline <style>...</style> blocks.
function extractInlineStyles(html) {
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
  const hashes = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[2];
    if (body.length === 0) continue;
    hashes.add(sha256b64(body));
  }
  return Array.from(hashes);
}

function main() {
  const out = {};
  let totalScripts = 0;
  let totalStyles = 0;

  for (const file of FILES) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      console.warn(`skip (missing): ${file}`);
      continue;
    }
    const html = fs.readFileSync(full, 'utf8');
    const scriptHashes = extractInlineScripts(html);
    const styleHashes = extractInlineStyles(html);
    out[file] = { scriptHashes, styleHashes };
    totalScripts += scriptHashes.length;
    totalStyles += styleHashes.length;
    console.log(`${file.padEnd(26)} scripts=${scriptHashes.length}  styles=${styleHashes.length}`);
  }

  const outPath = path.join(__dirname, 'csp-hashes.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nTotal: ${totalScripts} script hashes, ${totalStyles} style hashes`);
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
}

main();
