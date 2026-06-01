/**
 * WCAG AA contrast lock for shared/brand.css text tokens.
 *
 * Parses the ACTUAL token values out of brand.css (light :root + the dark
 * override block) and asserts every text-intended token clears 4.5:1 against the
 * page background it renders on (--cloud). If a future edit darkens a background
 * or lightens a text token below AA, this test goes red — the dimension can't
 * silently regress (the 2026-05-31 audit found --pebble at 3.55, --ok-as-text at
 * 2.30; this guards the fix).
 *
 * Run: node --test shared/__tests__/brand-contrast.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'brand.css'), 'utf8');

// Split light scope from the first dark block so same-named tokens resolve per mode.
const darkAt = css.search(/\[data-theme="dark"\]|color-scheme:\s*dark/);
const lightCss = css.slice(0, darkAt);
const darkCss = css.slice(darkAt);

function tokenValue(scope, name) {
  const m = scope.match(new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{6})'));
  return m ? m[1] : null;
}

function relLum(hex) {
  const ch = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(fg, bg) {
  const a = relLum(fg), b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA = 4.5;
// Text tokens that must clear AA against the page background (--cloud).
const TEXT_TOKENS = ['muted', 'pebble', 'ok-text', 'alert-text', 'brand-primary-text', 'warn-text', 'info-text', 'ink'];

describe('brand.css — WCAG AA text contrast (light)', () => {
  const bg = tokenValue(lightCss, 'cloud');

  test('--cloud (page bg) is defined', () => {
    assert.ok(bg, '--cloud must be defined in light :root');
  });

  for (const name of TEXT_TOKENS) {
    test(`--${name} clears ${AA}:1 on --cloud`, () => {
      const fg = tokenValue(lightCss, name);
      assert.ok(fg, `--${name} must be defined`);
      const r = ratio(fg, bg);
      assert.ok(r >= AA, `--${name} ${fg} on ${bg} = ${r.toFixed(2)}:1 (< ${AA})`);
    });
  }
});

describe('brand.css — WCAG AA text contrast (dark)', () => {
  const bg = tokenValue(darkCss, 'cloud');

  test('dark --cloud (page bg) is defined', () => {
    assert.ok(bg, 'dark --cloud must be defined');
  });

  for (const name of TEXT_TOKENS) {
    test(`dark --${name} clears ${AA}:1 on dark --cloud`, () => {
      // dark block may inherit some tokens from light; fall back to light value.
      const fg = tokenValue(darkCss, name) || tokenValue(lightCss, name);
      assert.ok(fg, `--${name} must resolve in dark`);
      const r = ratio(fg, bg);
      assert.ok(r >= AA, `dark --${name} ${fg} on ${bg} = ${r.toFixed(2)}:1 (< ${AA})`);
    });
  }
});
