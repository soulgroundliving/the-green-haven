/*
 * Green Haven — Theme toggle (light / dark / auto)
 *
 * Persists user choice in localStorage.gh_theme and syncs to <html data-theme>.
 * Auto mode follows prefers-color-scheme. Brand.css token overrides do the
 * rest — no per-surface styling needed.
 *
 * API:
 *   GhTheme.get()                  -> 'light' | 'dark' | 'auto'
 *   GhTheme.set('light'|'dark'|'auto')
 *   GhTheme.cycle()                -> rotates auto -> light -> dark -> auto
 *   GhTheme.effective()            -> resolves 'auto' to current 'light'|'dark'
 *
 *   Auto-wires any element with data-action="toggle-theme" to call cycle().
 *   Updates aria-pressed and inner emoji/text on the trigger if it has
 *   [data-theme-icon] children.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'gh_theme';
  const VALID = ['auto', 'light', 'dark'];

  function _read() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (VALID.includes(v)) return v;
      // Migrate legacy localStorage.theme='night' → gh_theme='dark' (one-time)
      if (localStorage.getItem('theme') === 'night') {
        localStorage.setItem(STORAGE_KEY, 'dark');
        return 'dark';
      }
      return 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function _write(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) { /* private mode */ }
  }

  function effective(mode) {
    mode = mode || _read();
    if (mode === 'auto') {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return dark ? 'dark' : 'light';
    }
    return mode;
  }

  function _apply(mode) {
    const root = document.documentElement;
    if (mode === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
    _refreshTriggers(mode);
  }

  const ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
  const LABEL = { auto: 'อัตโนมัติ', light: 'สว่าง', dark: 'มืด' };

  function _refreshTriggers(mode) {
    const triggers = document.querySelectorAll('[data-action="toggle-theme"]');
    triggers.forEach(function (btn) {
      btn.setAttribute('aria-label', 'ธีม: ' + LABEL[mode] + ' (กดเพื่อสลับ)');
      const icon = btn.querySelector('[data-theme-icon]');
      if (icon) icon.textContent = ICON[mode];
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = LABEL[mode];
      btn.dataset.themeMode = mode;
    });
  }

  function get() { return _read(); }

  function set(mode) {
    if (!VALID.includes(mode)) return;
    _write(mode);
    _apply(mode);
  }

  function cycle() {
    const cur = _read();
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    set(next);
  }

  // Apply on script load (BEFORE DOMContentLoaded so first paint matches)
  _apply(_read());

  // Re-attach trigger labels once DOM is ready (in case triggers exist in HTML)
  function _attach() {
    _refreshTriggers(_read());
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action="toggle-theme"]');
      if (btn) {
        e.preventDefault();
        cycle();
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  // React to OS-level prefers-color-scheme changes when in auto mode
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
      if (_read() === 'auto') _refreshTriggers('auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);  // Safari < 14
  }

  window.GhTheme = { get: get, set: set, cycle: cycle, effective: effective };
})();
