#!/usr/bin/env node
/**
 * Convert style="display:none;" to CSS classes in tenant_app.html.
 *
 * Strategy:
 *  A) .accordion-content elements — CSS now sets display:none by default;
 *     just strip the inline style attribute (no class change).
 *  B) Section/panel elements — replace inline style with class="ta-sect-hidden"
 *     (or append to existing class attribute).
 *
 * JS toggle updates are done separately via Edit tool.
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'tenant_app.html');

let html = fs.readFileSync(FILE, 'utf8');
const original = html;
let totalA = 0, totalB = 0;

// ── Helper: strip style="display:none;" from a tag string ────────────────────
function stripDisplayNone(tag) {
  return tag
    .replace(/\s+style="display:none;"/, '')  // attr preceded by space
    .replace(/style="display:none;"\s*/, ''); // attr at start or followed by space
}

// ── Helper: add a class to a tag string ──────────────────────────────────────
function addClass(tag, cls) {
  // If class attr already exists: append
  if (/class="/.test(tag)) {
    return tag.replace(/class="([^"]*)"/, `class="$1 ${cls}"`);
  }
  // Otherwise insert after opening <tagName
  return tag.replace(/^(<\w+)/, `$1 class="${cls}"`);
}

// ── Group A: accordion-content — strip style only ────────────────────────────
// Pattern: opening tag has class containing "accordion-content" AND has style="display:none;"
html = html.replace(
  /<(div)[^>]*class="[^"]*accordion-content[^"]*"[^>]*style="display:none;"[^>]*>/g,
  (m) => { totalA++; return stripDisplayNone(m); }
);
// Also handle style before class
html = html.replace(
  /<(div)[^>]*style="display:none;"[^>]*class="[^"]*accordion-content[^"]*"[^>]*>/g,
  (m) => { totalA++; return stripDisplayNone(m); }
);

// ── Group B: named section/panel elements — add ta-sect-hidden ──────────────
const SECTION_IDS = [
  'internetStatusSection',
  'roomInternetStatusSection',
  'bills-history-section',
  'payment-step-2',
  'payment-step-3',
  'receiptContent',
  'eco-panel-achievements',
  'eco-panel-rankings',
  'eco-panel-stats',
  'fb-type-tabs',
  'cl-form-area',
  'cl-done-area',
  'profile-edit-form',
  'otp-step-2',
  'profile-deposit-badge',
];

for (const id of SECTION_IDS) {
  // Match the opening tag containing this specific id AND style="display:none;"
  const re = new RegExp(
    `<([a-z]+)[^>]*id="${id}"[^>]*style="display:none;"[^>]*>`,
    'g'
  );
  const re2 = new RegExp(
    `<([a-z]+)[^>]*style="display:none;"[^>]*id="${id}"[^>]*>`,
    'g'
  );

  html = html.replace(re, (m) => {
    totalB++;
    return addClass(stripDisplayNone(m), 'ta-sect-hidden');
  });
  html = html.replace(re2, (m) => {
    totalB++;
    return addClass(stripDisplayNone(m), 'ta-sect-hidden');
  });
}

// ── Summary ──────────────────────────────────────────────────────────────────
const remainingNone = (html.match(/style="display:none;"/g) || []).length;
console.log(`Group A (accordion-content, style stripped): ${totalA}`);
console.log(`Group B (section IDs → ta-sect-hidden):     ${totalB}`);
console.log(`Remaining style="display:none;" :            ${remainingNone}`);

if (html !== original) {
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('✅ tenant_app.html updated.');
} else {
  console.log('ℹ️  No changes made.');
}
