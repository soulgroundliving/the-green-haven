#!/usr/bin/env node
/**
 * Phase 4E — Generate the Content-Security-Policy header value.
 *
 * Reads tools/csp-hashes.json, unions every script/style hash across all
 * tracked HTML files, and prints a single CSP string. Copy the output into
 * vercel.json under the "Content-Security-Policy" header.
 *
 * Enforce mode — all inline handlers have been migrated to data-action delegation.
 * Re-run: npm run csp:hash && npm run csp:print, then paste output into vercel.json.
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
//
// 2026-05-24: added `https://*.firebasedatabase.app` — Firebase RTDB SDK falls
// back to JSONP long-polling when its WebSocket can't connect, injecting
// <script src="https://<project>-default-rtdb.<region>.firebasedatabase.app/..."
// tags. Without this origin in script-src-elem, the fallback path is blocked
// and the user sees a flood of CSP violations whenever WebSocket is flaky.
const SCRIPT_SRC_EXTERNAL = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://js.sentry-cdn.com',
  'https://browser.sentry-cdn.com', // lazy-loaded full SDK by the loader stub
  'https://unpkg.com',
  'https://static.line-scdn.net',
  'https://www.gstatic.com',
  'https://www.google.com',
  'https://www.recaptcha.net',
  'https://apis.google.com',
  'https://*.firebasedatabase.app',   // RTDB JSONP long-polling fallback
  'https://*.firebaseio.com',         // RTDB legacy US-region origin
].join(' ');

const STYLE_SRC_EXTERNAL = [
  'https://fonts.googleapis.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
].join(' ');

// html2canvas (v1.4.1, lazy-loaded for the PNG receipt/checklist exports) re-injects
// two <style> elements into its render clone (the page's reformatted stylesheets +
// a pseudoelement-reset), both blocked by `style-src-elem`. The PNG still renders (see
// the ensureHtml2Canvas note in dashboard.html). Verified via a real-html2canvas harness:
// the pseudoelement-reset hash below is content-independent + stable for the pinned
// version; the cloned-stylesheet hash tracks the dashboard's inline styles (so it can
// drift when those change — regenerate if it reappears). Allowing the two SPECIFIC hashes
// is the CSP-correct fix (NOT 'unsafe-inline').
//
// NOTE: the deposit export (`exportDepositReceipt`) instead strips <style>/<link> from the
// clone via html2canvas `onclone`, which removes BOTH injected styles outright (robust, no
// hash to maintain). These allowlist entries cover the checklist + tenant receipt exports
// that don't yet do that. Prefer the `onclone` approach for new exports.
const STYLE_SRC_RUNTIME = [
  "'sha256-o/aIZnrzFh03q9JH54Wr0UZbTwytXEgmeuG4ce8fRgI='", // cloned dashboard stylesheets (may drift)
  "'sha256-UP0QZg7irvSMvOBz9mH2PIIE28+57UiavRfeVea0l3g='", // pseudoelement reset (stable; harness-verified)
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
  // Firebase RTDB JSONP fallback also injects an iframe pointing at the
  // <project>-default-rtdb.<region>.firebasedatabase.app endpoint when the
  // WebSocket can't connect. Mirrors the SCRIPT_SRC_EXTERNAL addition.
  'https://*.firebasedatabase.app',
  'https://*.firebaseio.com',
].join(' ');

// Inline style="..." attribute count audited 2026-04-29: dashboard 604,
// tenant_app 990, tax-filing 84 → 1681 total. Hashing each via 'unsafe-hashes'
// would push the CSP header past 30 KB (practical HTTP limit). Solution:
// scope CSP3's per-target directives — style-src-elem stays strict with
// hashes, style-src-attr opens to 'unsafe-inline'. This keeps the high-value
// defense (no injected <style> blocks) without churning every inline style.
// Style attribute injection is far less impactful than script injection
// (no JS execution, only CSS-selector data exfil under sophisticated attack).
const directives = [
  `default-src 'self' https: wss:`,
  `script-src 'self' ${scriptHashTokens} ${SCRIPT_SRC_EXTERNAL}`,
  `script-src-elem 'self' ${scriptHashTokens} ${SCRIPT_SRC_EXTERNAL}`,
  `style-src 'self' ${styleHashTokens} ${STYLE_SRC_EXTERNAL} ${STYLE_SRC_RUNTIME}`,
  `style-src-elem 'self' ${styleHashTokens} ${STYLE_SRC_EXTERNAL} ${STYLE_SRC_RUNTIME}`,
  `style-src-attr 'unsafe-inline'`,
  `img-src ${IMG_SRC}`,
  `font-src ${FONT_SRC}`,
  `connect-src ${CONNECT_SRC}`,
  `frame-src ${FRAME_SRC}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
];

const cspValue = directives.join('; ');

console.log('=== Content-Security-Policy header value ===\n');
console.log(cspValue);
console.log(`\n=== Stats ===`);
console.log(`Script hashes: ${scriptHashes.size}`);
console.log(`Style hashes:  ${styleHashes.size}`);
console.log(`Total length:  ${cspValue.length} chars`);
