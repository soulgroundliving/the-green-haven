/**
 * Unit tests for shared/dashboard-tab-aria.js — WCAG 4.1.2 / 1.4.1 tab semantics.
 *
 * syncTabAria() mirrors the `.active` class (set by the 7 dashboard switchers)
 * into role="tab" + aria-selected on .year-tab / .dash-tab-btn buttons, and tags
 * the parent bar role="tablist". Additive ARIA only — these lock the surface so a
 * future "consistency" sweep can't silently strip the tab semantics.
 *
 * Run: node --test shared/__tests__/dashboard-tab-aria.test.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function makeEl({ classes = [], parent = null } = {}) {
  const set = new Set(classes);
  const attrs = {};
  const el = {
    classList: { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    parentElement: parent,
    // matches a single class or a comma list like ".year-tab, .dash-tab-btn"
    _matches(sel) {
      return String(sel).split(',').some((part) => {
        const cls = part.trim().replace(/^\./, '');
        return cls && set.has(cls);
      });
    },
  };
  el.closest = (sel) => (el._matches(sel) ? el : (parent && parent.closest ? parent.closest(sel) : null));
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
    console: { log() {}, info() {}, warn() {}, error() {} },
    Promise,
    JSON, Math, Number, String, Boolean, Object, Array, Set, Map,
  };
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-tab-aria.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'dashboard-tab-aria.js' });
  return context;
}

describe('dashboard-tab-aria.js — syncTabAria (WCAG 4.1.2)', () => {
  const sb = loadSandbox();

  test('is exported on window', () => {
    assert.equal(typeof sb.window.syncTabAria, 'function');
  });

  test('sets role=tab on both .year-tab and .dash-tab-btn buttons', () => {
    const bar = makeEl({ classes: ['year-tabs'] });
    const a = makeEl({ classes: ['year-tab', 'active'], parent: bar });
    const b = makeEl({ classes: ['year-tab'], parent: bar });
    const g = makeEl({ classes: ['dash-tab-btn'], parent: bar });
    const n = sb.window.syncTabAria(makeDoc([a, b, g]));
    assert.equal(n, 3);
    assert.equal(a.getAttribute('role'), 'tab');
    assert.equal(g.getAttribute('role'), 'tab');
  });

  test('aria-selected mirrors the .active class', () => {
    const bar = makeEl({ classes: ['year-tabs'] });
    const active = makeEl({ classes: ['year-tab', 'active'], parent: bar });
    const idle = makeEl({ classes: ['year-tab'], parent: bar });
    sb.window.syncTabAria(makeDoc([active, idle]));
    assert.equal(active.getAttribute('aria-selected'), 'true');
    assert.equal(idle.getAttribute('aria-selected'), 'false');
  });

  test('tags the parent bar role=tablist', () => {
    const bar = makeEl({ classes: ['year-tabs'] });
    const a = makeEl({ classes: ['year-tab', 'active'], parent: bar });
    sb.window.syncTabAria(makeDoc([a]));
    assert.equal(bar.getAttribute('role'), 'tablist');
  });

  test('ignores non-tab elements', () => {
    const other = makeEl({ classes: ['btn'] });
    const n = sb.window.syncTabAria(makeDoc([other]));
    assert.equal(n, 0);
    assert.equal(other.getAttribute('role'), null);
  });

  test('re-sync flips aria-selected when the active tab moves', () => {
    const bar = makeEl({ classes: ['year-tabs'] });
    const a = makeEl({ classes: ['year-tab', 'active'], parent: bar });
    const b = makeEl({ classes: ['year-tab'], parent: bar });
    const doc = makeDoc([a, b]);
    sb.window.syncTabAria(doc);
    assert.equal(a.getAttribute('aria-selected'), 'true');
    assert.equal(b.getAttribute('aria-selected'), 'false');

    // simulate a switch: active moves a -> b
    a.classList.remove('active');
    b.classList.add('active');
    sb.window.syncTabAria(doc);
    assert.equal(a.getAttribute('aria-selected'), 'false');
    assert.equal(b.getAttribute('aria-selected'), 'true');
  });

  test('never throws on a null scope', () => {
    assert.doesNotThrow(() => sb.window.syncTabAria(null));
  });
});
