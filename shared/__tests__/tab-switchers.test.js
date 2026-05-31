/**
 * Unit tests for the dashboard tab-switcher show/hide contract — §7-SS guard.
 *
 * §7-SS: a CSS migration replaced inline `style="display:none"` on tab panels
 * with class `u-init-hide` (display:none, NO !important). Seven switchers that
 * "showed" a panel by only CLEARING the inline display (`el.style.display = ''`)
 * silently broke — clearing leaves `u-init-hide` in force, so the panel stays
 * hidden. The fix: the show step must SET `el.style.display = 'block'`. These
 * tests lock that contract on every affected switcher; a future revert to "just
 * clear the inline style" makes the `display === 'block'` assertion fail (proven
 * with teeth on switchContentTab in the §7-SS-guard test).
 *
 * COUNTEREXAMPLE: §7-SS's `switchDashboardTab` (dash-cat-* category tabs) uses
 * the toggleable `u-hidden` (!important) class, so clearing inline display is
 * CORRECT for it and it must NOT set display:block. That contract is locked
 * separately below so a "consistency" rewrite can't break the counterexample.
 *
 * Strategy: load each source file in a vm sandbox (their only load-time side
 * effects are `document.addEventListener` registrations, no-op'd by the stub),
 * then drive each switcher against a minimal DOM stub. Tab names are chosen to
 * avoid the switchers' unguarded lazy-init calls.
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

// querySelectorAll supports `.class` and `[id^="prefix"]`; every other selector
// (id-lists, [data-action], compound) returns [] — those only drive button
// reset loops the tests don't assert on (the clicked button is passed directly).
function makeDoc(els) {
  return {
    getElementById: (id) => els.find((e) => e.id === id) || null,
    querySelectorAll: (sel) => {
      const s = String(sel);
      if (s.startsWith('.')) return els.filter((e) => e._has(s.slice(1)));
      const m = /^\[id\^="(.+?)"\]$/.exec(s);
      if (m) return els.filter((e) => e.id.startsWith(m[1]));
      return [];
    },
    addEventListener: () => {},
    readyState: 'complete',
  };
}

function makeSandbox(relPath) {
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
  window.ghAlert = () => {};
  window.ghConfirm = () => {};
  vm.createContext(context);
  const abs = path.join(__dirname, '..', relPath);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: relPath });
  return context;
}

// Generic §7-SS assertion: after a switch, the active panel is shown via an
// explicit display:block (NOT a cleared inline), and inactive panels are hidden
// via u-hidden.
function assertActiveShownInactiveHidden(active, inactive) {
  assert.equal(active.style.display, 'block',
    'active panel must get display:block to override u-init-hide (§7-SS)');
  assert.ok(!active.classList.contains('u-hidden'), 'active panel must not retain u-hidden');
  assert.ok(inactive.classList.contains('u-hidden'), 'inactive panel must be hidden with u-hidden');
}

// ════════════════════════════════════════════════════════════════════════════
// shared/dashboard-wellness-content.js — switchContentTab (with teeth proof)
// ════════════════════════════════════════════════════════════════════════════

describe('switchContentTab — §7-SS u-init-hide show/hide contract', () => {
  const sb = makeSandbox('dashboard-wellness-content.js');
  const switchContentTab = sb.switchContentTab || sb.window.switchContentTab;

  function group() {
    const active   = makeEl('content-tab-reports', ['content-mgmt-content', 'u-init-hide']);
    const inactive = makeEl('content-tab-other',   ['content-mgmt-content', 'u-init-hide']);
    const btn      = makeEl('tab-reports-btn', ['content-mgmt-tab']);
    return { active, inactive, btn, els: [active, inactive, btn] };
  }

  test('switchContentTab is loaded as a global function', () => {
    assert.equal(typeof switchContentTab, 'function');
  });

  test('shows the active panel by SETTING display:block (the §7-SS guard)', () => {
    const g = group();
    sb.document = makeDoc(g.els);
    switchContentTab('reports', g.btn);
    assertActiveShownInactiveHidden(g.active, g.inactive);
  });

  test('marks the clicked button active and resolves the button by id when omitted', () => {
    const g = group();
    sb.document = makeDoc(g.els);
    switchContentTab('reports'); // no btn → looks up tab-reports-btn
    assert.ok(g.btn.classList.contains('active'));
  });

  test('does not throw when the target panel is missing', () => {
    sb.document = makeDoc([]);
    assert.doesNotThrow(() => switchContentTab('ghost'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// shared/dashboard-main.js — the 5 §7-SS switchers + the counterexample
// ════════════════════════════════════════════════════════════════════════════

describe('dashboard-main.js §7-SS switchers — active panel gets display:block', () => {
  const sb = makeSandbox('dashboard-main.js');

  test('all switchers are exported (load did not silently drop them)', () => {
    assert.equal(typeof sb.window.switchTenantMainTab, 'function');
    assert.equal(typeof sb.window.switchBillingMainTab, 'function');
    assert.equal(typeof sb.window.switchMeterTab, 'function');
    assert.equal(typeof sb.switchRequestsTab, 'function');
    assert.equal(typeof sb.switchPeopleTab, 'function');
  });

  test('switchTenantMainTab: requests panel shown, tenants panel hidden', () => {
    const active   = makeEl('tenant-main-tab-requests');
    const inactive = makeEl('tenant-main-tab-tenants');
    const btn = makeEl('tenant-main-tab-btn-requests');
    sb.document = makeDoc([active, inactive, btn]);
    sb.window.switchTenantMainTab('requests', btn);
    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('active'));
  });

  test('switchBillingMainTab: history panel shown, billing panel hidden', () => {
    const active   = makeEl('pv-tab-history');         // tab key 'history'
    const inactive = makeEl('bill-main-tab-billing');  // tab key 'billing'
    const btn = makeEl('bill-main-tab-btn-history');
    sb.document = makeDoc([active, inactive, btn]);
    sb.window.switchBillingMainTab('history', btn);
    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('active'));
  });

  test('switchMeterTab: electric panel shown, water panel hidden', () => {
    const active   = makeEl('meter-electric-content', ['meter-tab-content']);
    const inactive = makeEl('meter-water-content',    ['meter-tab-content']);
    const btn = makeEl('tab-electric-btn', ['meter-tab']);
    sb.document = makeDoc([active, inactive, btn]);
    sb.window.switchMeterTab('electric', btn);
    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('active'));
  });

  test('switchRequestsTab: deposits panel shown, complaints panel hidden', () => {
    const active   = makeEl('requests-tab-deposits',  ['requests-mgmt-content']);
    const inactive = makeEl('requests-tab-complaints', ['requests-mgmt-content']);
    const btn = makeEl('tab-deposits-btn', ['requests-mgmt-tab']);
    sb.document = makeDoc([active, inactive, btn]);
    sb.switchRequestsTab('deposits', btn); // 'deposits' init is typeof-guarded
    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('active'));
  });

  test('switchPeopleTab: insights panel shown, policies panel hidden', () => {
    const active   = makeEl('people-tab-insights', ['people-mgmt-content']);
    const inactive = makeEl('people-tab-policies', ['people-mgmt-content']);
    const btn = makeEl('people-tab-btn-insights');
    sb.document = makeDoc([active, inactive, btn]);
    sb.switchPeopleTab('insights', btn); // 'insights' init is typeof-guarded
    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('active'));
  });
});

describe('dashboard-main.js — switchDashboardTab COUNTEREXAMPLE (§7-SS: must NOT set display:block)', () => {
  const sb = makeSandbox('dashboard-main.js');

  // window.switchDashboardTab is the dash-cat category switcher whose panels use
  // the toggleable u-hidden (!important) class — it reveals by REMOVING u-hidden
  // and clearing inline display, never by setting display:block. Locking this so
  // a future "make all switchers consistent" sweep can't wrongly add block here.
  test('reveals the active category by clearing u-hidden, leaving display NOT set to block', () => {
    const active   = makeEl('dash-cat-tenants', ['u-hidden']);
    const inactive = makeEl('dash-cat-financial');
    const canonical = makeEl('dash-cat-btn-tenants');
    sb.document = makeDoc([active, inactive, canonical]);

    sb.window.switchDashboardTab('tenants', canonical);

    assert.ok(!active.classList.contains('u-hidden'), 'active category must lose u-hidden');
    assert.notEqual(active.style.display, 'block',
      'counterexample must rely on the class default, NOT an explicit display:block');
    assert.ok(inactive.classList.contains('u-hidden'), 'inactive category keeps u-hidden');
    assert.ok(canonical.classList.contains('active'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// shared/dashboard-config.js — switchGamificationTab
// ════════════════════════════════════════════════════════════════════════════

describe('switchGamificationTab — §7-SS contract + u-gamification-tab button class', () => {
  const sb = makeSandbox('dashboard-config.js');
  const switchGamificationTab = sb.switchGamificationTab || sb.window.switchGamificationTab;

  test('switchGamificationTab is loaded as a global function', () => {
    assert.equal(typeof switchGamificationTab, 'function');
  });

  test('leaderboard panel shown via display:block, badges panel hidden', () => {
    // Panels are matched by [id^="gamification"] and revealed by capitalised id.
    const active   = makeEl('gamificationLeaderboard');
    const inactive = makeEl('gamificationBadges');
    const btn = makeEl('btn-leaderboard');
    sb.document = makeDoc([active, inactive, btn]);

    switchGamificationTab('leaderboard', btn); // 'leaderboard' fires no unguarded init

    assertActiveShownInactiveHidden(active, inactive);
    assert.ok(btn.classList.contains('u-gamification-tab-active'),
      'clicked button gets the active gamification class');
  });
});
