/**
 * Unit tests for the tab-switcher show/hide contract — §7-SS regression guard.
 *
 * §7-SS: a CSS migration replaced inline `style="display:none"` on tab panels
 * with class `u-init-hide` (display:none, NO !important). Seven tab switchers
 * that "showed" a panel by only CLEARING the inline display (`el.style.display
 * = ''`) silently broke — clearing leaves `u-init-hide` in force, so the panel
 * stays hidden. The fix: the show step must SET `el.style.display = 'block'` to
 * override the class. This test locks that contract on the canonical example
 * `switchContentTab` (shared/dashboard-wellness-content.js): a future revert to
 * "just clear the inline style" makes the `display === 'block'` assertion fail.
 *
 * NOTE — the §7-SS counterexample `switchDashboardTab` is intentionally NOT
 * tested here: its panels use the toggleable `u-hidden` (!important) class, so
 * clearing inline display is correct for it. See CLAUDE.md §7-SS.
 *
 * Strategy: load dashboard-wellness-content.js in a vm sandbox (top-level
 * `function switchContentTab` becomes a context global), drive it against a
 * minimal DOM stub. Tab names with no lazy-init branch are used so no page
 * bootstrap fires during the test.
 *
 * Run: node --test shared/__tests__/tab-switchers.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function makeEl(id, classes = []) {
  const set = new Set(classes);
  return {
    id,
    style: { display: '' },
    dataset: {},
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

function makeSandbox() {
  const window = {};
  const context = {
    window,
    document: makeDoc([]),
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    JSON, Math, Number, String, Boolean, Object, Array, Map, Set,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    navigator: { userAgent: 'test' },
  };
  window.addEventListener = () => {};
  vm.createContext(context);
  const abs = path.join(__dirname, '..', 'dashboard-wellness-content.js');
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: 'dashboard-wellness-content.js' });
  return context;
}

// Build a content-management tab group: panels carry the migrated `u-init-hide`
// class (the §7-SS hazard). 'reports' has no lazy-init branch in switchContentTab.
function makeTabGroup() {
  const panelReports = makeEl('content-tab-reports', ['content-mgmt-content', 'u-init-hide']);
  const panelOther   = makeEl('content-tab-other',   ['content-mgmt-content', 'u-init-hide']);
  const btnReports   = makeEl('tab-reports-btn', ['content-mgmt-tab']);
  const btnOther     = makeEl('tab-other-btn',   ['content-mgmt-tab']);
  return { panelReports, panelOther, btnReports, btnOther,
           els: [panelReports, panelOther, btnReports, btnOther] };
}

describe('switchContentTab — §7-SS u-init-hide show/hide contract', () => {
  const sb = makeSandbox();
  const switchContentTab = sb.switchContentTab || sb.window.switchContentTab;

  test('switchContentTab is loaded as a global function', () => {
    assert.equal(typeof switchContentTab, 'function');
  });

  test('shows the active panel by SETTING display:block (not just clearing inline) — the §7-SS guard', () => {
    const g = makeTabGroup();
    sb.document = makeDoc(g.els);

    switchContentTab('reports', g.btnReports);

    // The whole point of §7-SS: clearing inline display is NOT enough because
    // u-init-hide would keep it hidden. Must be an explicit 'block'.
    assert.equal(g.panelReports.style.display, 'block',
      'active panel must get display:block to override u-init-hide');
    assert.ok(!g.panelReports.classList.contains('u-hidden'),
      'active panel must not retain u-hidden');
  });

  test('hides the inactive panel via u-hidden', () => {
    const g = makeTabGroup();
    sb.document = makeDoc(g.els);

    switchContentTab('reports', g.btnReports);
    assert.ok(g.panelOther.classList.contains('u-hidden'),
      'inactive panel must be hidden with u-hidden');
  });

  test('marks the clicked button active and clears the others', () => {
    const g = makeTabGroup();
    g.btnOther.classList.add('active');
    sb.document = makeDoc(g.els);

    switchContentTab('reports', g.btnReports);
    assert.ok(g.btnReports.classList.contains('active'));
    assert.ok(!g.btnOther.classList.contains('active'));
  });

  test('resolves the button by id when none is passed', () => {
    const g = makeTabGroup();
    sb.document = makeDoc(g.els);

    switchContentTab('reports'); // no btn arg → looks up tab-reports-btn
    assert.ok(g.btnReports.classList.contains('active'));
  });

  test('switching tabs moves both the visible panel and the active button', () => {
    const g = makeTabGroup();
    sb.document = makeDoc(g.els);

    switchContentTab('reports', g.btnReports);
    switchContentTab('other', g.btnOther);

    // 'other' now visible, 'reports' hidden
    assert.equal(g.panelOther.style.display, 'block');
    assert.ok(!g.panelOther.classList.contains('u-hidden'));
    assert.ok(g.panelReports.classList.contains('u-hidden'));

    // active button followed
    assert.ok(g.btnOther.classList.contains('active'));
    assert.ok(!g.btnReports.classList.contains('active'));
  });

  test('does not throw when the target panel is missing', () => {
    sb.document = makeDoc([]); // nothing to find
    assert.doesNotThrow(() => switchContentTab('ghost'));
  });
});
