/**
 * Unit tests for shared/tenant-navigation.js — page switching + nav-bar state.
 *
 * This module was LOST during the god-file refactor (§7-QQ): a top-level
 * `function showPage()` in tenant_app.html silently dropped off `window` when
 * extracted, killing every navigation button. The first test below is the exact
 * regression guard — it asserts `window.showPage` (and siblings) are exported.
 * The behavior tests lock the show/hide DOM mechanics and the goBack→nav-index
 * contract so a future extraction/sweep can't break navigation unnoticed.
 *
 * Strategy: load the module in a vm sandbox (pure `window.X =` assignments, no
 * load-time side effects), then drive each function against a minimal DOM stub
 * (elements with id + classList + style) swapped into the live context global.
 *
 * Run: node --test shared/__tests__/tenant-navigation.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ────────────────────────────────────────────────────────────────────────────
// Minimal DOM stub — enough for querySelectorAll('.class') + getElementById(id)
// + element.style / element.classList. Realm-safe (no cross-realm deepEqual).
// ────────────────────────────────────────────────────────────────────────────

function makeEl(id, classes = []) {
  const set = new Set(classes);
  return {
    id,
    style: { display: '', pointerEvents: '', zIndex: '' },
    classList: {
      add: (...cs) => cs.forEach((c) => set.add(c)),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !set.has(c) : !!force;
        if (want) set.add(c); else set.delete(c);
        return want;
      },
    },
    _has: (c) => set.has(c),
  };
}

function makeDoc(els) {
  return {
    getElementById: (id) => els.find((e) => e.id === id) || null,
    querySelectorAll: (sel) => els.filter((e) => e._has(String(sel).replace(/^\./, ''))),
    addEventListener: () => {},
    readyState: 'complete',
  };
}

function makeNavSandbox() {
  const window = {};
  const context = {
    window,
    document: makeDoc([]),
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set,
    setTimeout: () => 0, clearTimeout: () => {},
  };
  window.scrollTo = () => {};
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'tenant-navigation.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'tenant-navigation.js' });
  return context;
}

// ────────────────────────────────────────────────────────────────────────────
// §7-QQ regression guard — the exports must exist on window
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-navigation.js — window exports (§7-QQ regression guard)', () => {
  const sb = makeNavSandbox();

  test('exposes window.showPage (the function the god-file refactor dropped)', () => {
    assert.equal(typeof sb.window.showPage, 'function');
  });

  test('exposes every navigation helper on window', () => {
    const expected = [
      'showPage', 'showSubPage', 'updateNavActiveIndex',
      'goBackToService', 'goBackToCommunity', 'goBackToMarketplace',
      'goBackToUsage', 'goBackToProfile', 'goBackToHome', 'goBackFromPayment',
    ];
    for (const fn of expected) {
      assert.equal(typeof sb.window[fn], 'function', `window.${fn} should be a function`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// showPage — show/hide mechanics
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-navigation.js — showPage', () => {
  const sb = makeNavSandbox();

  test('reveals the <id>-page target and hides all other .page elements', () => {
    const home = makeEl('home-page', ['page']);
    const profile = makeEl('profile-page', ['page']);
    sb.document = makeDoc([home, profile, makeEl('main-nav-bar')]);
    sb.window.showPage('home');

    assert.equal(home.style.display, 'block');
    assert.ok(home.classList.contains('active'));
    assert.equal(home.style.pointerEvents, 'auto');

    assert.equal(profile.style.display, 'none');
    assert.ok(!profile.classList.contains('active'));
    assert.equal(profile.style.pointerEvents, 'none');
  });

  test('falls back to the bare id when <id>-page does not exist', () => {
    const exact = makeEl('marketplace', ['page']); // note: no "marketplace-page"
    sb.document = makeDoc([exact]);
    sb.window.showPage('marketplace');
    assert.equal(exact.style.display, 'block');
    assert.ok(exact.classList.contains('active'));
  });

  test('hides the nav bar on world-map and shows it on normal pages', () => {
    const wm = makeEl('world-map-page', ['page']);
    const home = makeEl('home-page', ['page']);
    const nav = makeEl('main-nav-bar');
    sb.document = makeDoc([wm, home, nav]);

    sb.window.showPage('world-map');
    assert.equal(nav.style.display, 'none');

    sb.window.showPage('home');
    assert.equal(nav.style.display, 'flex');
  });

  test('gives world-map a lower z-index than normal pages', () => {
    const wm = makeEl('world-map-page', ['page']);
    const home = makeEl('home-page', ['page']);
    sb.document = makeDoc([wm, home]);

    sb.window.showPage('world-map');
    assert.equal(wm.style.zIndex, '5');

    sb.window.showPage('home');
    assert.equal(home.style.zIndex, '10');
  });

  test('moves the .active highlight to the passed nav element', () => {
    const home = makeEl('home-page', ['page']);
    const navA = makeEl('navA', ['nav-item']);
    const navB = makeEl('navB', ['nav-item']);
    navA.classList.add('active');
    sb.document = makeDoc([home, navA, navB]);

    sb.window.showPage('home', navB);
    assert.ok(!navA.classList.contains('active'));
    assert.ok(navB.classList.contains('active'));
  });

  test('logs an error and does not throw when the target page is missing', () => {
    let logged = '';
    sb.document = makeDoc([]);
    sb.console.error = (...a) => { logged = a.join(' '); };
    assert.doesNotThrow(() => sb.window.showPage('ghost'));
    assert.match(logged, /not found/);
    sb.console.error = () => {};
  });
});

// ────────────────────────────────────────────────────────────────────────────
// showSubPage / updateNavActiveIndex
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-navigation.js — showSubPage', () => {
  const sb = makeNavSandbox();

  test('reveals the exact-id sub-page, hides other pages and the nav bar', () => {
    const sub = makeEl('elec_usage', ['page']);
    const home = makeEl('home-page', ['page']);
    const nav = makeEl('main-nav-bar');
    sb.document = makeDoc([sub, home, nav]);

    sb.window.showSubPage('elec_usage');
    assert.equal(sub.style.display, 'block');
    assert.ok(sub.classList.contains('active'));
    assert.equal(sub.style.zIndex, '20');
    assert.equal(home.style.display, 'none');
    assert.equal(nav.style.display, 'none');
  });
});

describe('tenant-navigation.js — updateNavActiveIndex', () => {
  const sb = makeNavSandbox();

  test('activates the nav-item at the given index, clearing the rest', () => {
    const items = [0, 1, 2].map((i) => makeEl('n' + i, ['nav-item']));
    items[0].classList.add('active');
    sb.document = makeDoc(items);

    sb.window.updateNavActiveIndex(2);
    assert.ok(!items[0].classList.contains('active'));
    assert.ok(!items[1].classList.contains('active'));
    assert.ok(items[2].classList.contains('active'));
  });

  test('is a no-op when the index is out of range', () => {
    const item = makeEl('n0', ['nav-item']);
    item.classList.add('active');
    sb.document = makeDoc([item]);

    assert.doesNotThrow(() => sb.window.updateNavActiveIndex(5));
    assert.ok(item.classList.contains('active'), 'existing active state is preserved');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// goBack helpers — page + nav-index contract (bottom-nav button order)
// ────────────────────────────────────────────────────────────────────────────

describe('tenant-navigation.js — goBack helpers route to the right page + nav index', () => {
  const sb = makeNavSandbox();

  const cases = [
    { fn: 'goBackToHome',        page: 'home-page',        index: 0 },
    { fn: 'goBackToService',     page: 'services-page',    index: 1 },
    { fn: 'goBackToCommunity',   page: 'community-page',    index: 2 },
    { fn: 'goBackToMarketplace', page: 'marketplace-page', index: 2 },
    { fn: 'goBackToUsage',       page: 'usage-page',        index: 3 },
    { fn: 'goBackFromPayment',   page: 'usage-page',        index: 3 },
    { fn: 'goBackToProfile',     page: 'profile-page',      index: 4 },
  ];

  for (const { fn, page, index } of cases) {
    test(`${fn} → shows ${page} and highlights nav index ${index}`, () => {
      const target = makeEl(page, ['page']);
      const navItems = [0, 1, 2, 3, 4].map((i) => makeEl('nav' + i, ['nav-item']));
      sb.document = makeDoc([target, ...navItems]);

      sb.window[fn]();
      assert.equal(target.style.display, 'block', `${fn} should reveal ${page}`);
      assert.ok(navItems[index].classList.contains('active'), `${fn} should activate nav ${index}`);
    });
  }
});
