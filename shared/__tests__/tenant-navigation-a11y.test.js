/**
 * Unit tests for the keyboard-accessibility additions in
 * shared/tenant-navigation.js (WCAG 2.1.1 + 2.4.7):
 *   - enhanceMenuItemA11y(root): tags .menu-item[data-action] <div>s with
 *     role="button" + tabindex="0" (idempotent; respects existing attrs).
 *   - _onTileKeydown(e): Enter/Space on a non-native [data-action] element
 *     fires a synthetic click; native controls + other keys are ignored.
 *
 * These lock the keyboard surface so a future god-file sweep can't silently
 * strip operability (same regression class as §7-QQ / §7-SS).
 *
 * Run: node --test shared/__tests__/tenant-navigation-a11y.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ── Mock element: attribute map + class set + closest()/dispatchEvent() ──────
function makeEl({ tag = 'DIV', classes = [], attrs = {} } = {}) {
  const classSet = new Set(classes);
  const attrMap = { ...attrs };
  const el = {
    tagName: tag,
    dispatched: [],
    getAttribute: (n) => (n in attrMap ? attrMap[n] : null),
    setAttribute: (n, v) => { attrMap[n] = String(v); },
    hasAttribute: (n) => n in attrMap,
    dispatchEvent(evt) { this.dispatched.push(evt); return true; },
    // Supports compound selectors like ".menu-item[data-action]" and "[data-action]".
    _matches(sel) {
      let ok = true;
      (sel.match(/\.[a-z0-9_-]+/gi) || []).forEach((c) => { if (!classSet.has(c.slice(1))) ok = false; });
      (sel.match(/\[[a-z0-9_-]+\]/gi) || []).forEach((a) => { if (!(a.slice(1, -1) in attrMap)) ok = false; });
      return ok;
    },
  };
  el.closest = (sel) => {
    let cur = el;
    while (cur) {
      if (cur._matches(sel)) return cur;
      cur = cur._parent || null;
    }
    return null;
  };
  return el;
}

function makeDoc(els) {
  return {
    querySelectorAll: (sel) => els.filter((e) => e._matches(sel)),
    addEventListener: () => {},
    readyState: 'complete',
  };
}

function loadSandbox() {
  const window = {};
  const context = {
    window,
    document: makeDoc([]),
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    MouseEvent: class MouseEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } },
    JSON, Math, Number, String, Boolean, Object, Array, Set, Map,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'tenant-navigation.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'tenant-navigation.js' });
  return context;
}

describe('tenant-navigation.js — enhanceMenuItemA11y (WCAG 2.1.1)', () => {
  const sb = loadSandbox();

  test('is exported on window', () => {
    assert.equal(typeof sb.window.enhanceMenuItemA11y, 'function');
  });

  test('tags .menu-item[data-action] tiles with role=button + tabindex=0', () => {
    const tile = makeEl({ classes: ['menu-item'], attrs: { 'data-action': 'showSubPage' } });
    const n = sb.window.enhanceMenuItemA11y(makeDoc([tile]));
    assert.equal(n, 1);
    assert.equal(tile.getAttribute('role'), 'button');
    assert.equal(tile.getAttribute('tabindex'), '0');
  });

  test('ignores .menu-item WITHOUT data-action (non-interactive)', () => {
    const plain = makeEl({ classes: ['menu-item'] });
    const n = sb.window.enhanceMenuItemA11y(makeDoc([plain]));
    assert.equal(n, 0);
    assert.equal(plain.getAttribute('role'), null);
    assert.equal(plain.getAttribute('tabindex'), null);
  });

  test('does not overwrite an existing role / tabindex', () => {
    const tile = makeEl({ classes: ['menu-item'], attrs: { 'data-action': 'x', role: 'link', tabindex: '-1' } });
    sb.window.enhanceMenuItemA11y(makeDoc([tile]));
    assert.equal(tile.getAttribute('role'), 'link');
    assert.equal(tile.getAttribute('tabindex'), '-1');
  });

  test('is a safe no-op when given no scope and no document', () => {
    assert.doesNotThrow(() => sb.window.enhanceMenuItemA11y(null));
  });
});

describe('tenant-navigation.js — _onTileKeydown (WCAG 2.1.1)', () => {
  const sb = loadSandbox();

  function press(key, target) {
    let prevented = false;
    sb.window._onTileKeydown({ key, target, preventDefault: () => { prevented = true; } });
    return prevented;
  }

  test('is exported on window', () => {
    assert.equal(typeof sb.window._onTileKeydown, 'function');
  });

  test('Enter on a div[data-action] tile fires a synthetic bubbling click', () => {
    const tile = makeEl({ classes: ['menu-item'], attrs: { 'data-action': 'showSubPage' } });
    const prevented = press('Enter', tile);
    assert.equal(prevented, true);
    assert.equal(tile.dispatched.length, 1);
    assert.equal(tile.dispatched[0].type, 'click');
    assert.equal(tile.dispatched[0].bubbles, true);
  });

  test('Space fires too (both modern " " and legacy "Spacebar")', () => {
    for (const key of [' ', 'Spacebar']) {
      const tile = makeEl({ classes: ['menu-item'], attrs: { 'data-action': 'x' } });
      press(key, tile);
      assert.equal(tile.dispatched.length, 1, `key "${key}" should activate`);
    }
  });

  test('other keys are ignored (no click, no preventDefault)', () => {
    const tile = makeEl({ classes: ['menu-item'], attrs: { 'data-action': 'x' } });
    const prevented = press('a', tile);
    assert.equal(prevented, false);
    assert.equal(tile.dispatched.length, 0);
  });

  test('native controls (BUTTON) are skipped — no double activation', () => {
    const btn = makeEl({ tag: 'BUTTON', classes: ['nav-item'], attrs: { 'data-action': 'showPage' } });
    const prevented = press('Enter', btn);
    assert.equal(prevented, false);
    assert.equal(btn.dispatched.length, 0);
  });

  test('Enter with no [data-action] ancestor is ignored', () => {
    const plain = makeEl({ classes: ['whatever'] });
    const prevented = press('Enter', plain);
    assert.equal(prevented, false);
    assert.equal(plain.dispatched.length, 0);
  });
});
