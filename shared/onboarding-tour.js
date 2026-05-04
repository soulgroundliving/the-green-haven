/*
 * Green Haven — Onboarding tour (UMD-ish window.GhTour)
 *
 * Lightweight first-run tour for tenant_app and other surfaces.
 * - Steps configured by caller as array of { target?, title, body, placement? }
 * - target: CSS selector of element to highlight; omit for centered modal
 * - placement: 'top' | 'bottom' | 'left' | 'right' | 'center' (default: smart)
 * - Persists "done" flag in localStorage so tour shows once per key
 *
 * API:
 *   GhTour.start({ key, steps, onDone })
 *   GhTour.reset(key)         — clear "done" so tour shows again (debug)
 *   GhTour.hasSeen(key)       — boolean
 *
 * CSS in shared/components.css under .gh-tour-*
 */
(function () {
  'use strict';

  const STORAGE_PREFIX = 'gh_tour_done_';

  function _hasSeen(key) {
    try { return localStorage.getItem(STORAGE_PREFIX + key) === '1'; }
    catch (_) { return false; }
  }
  function _markSeen(key) {
    try { localStorage.setItem(STORAGE_PREFIX + key, '1'); } catch (_) { /* private mode */ }
  }
  function _reset(key) {
    try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (_) { /* noop */ }
  }

  function _make(tag, opts) {
    const el = document.createElement(tag);
    if (!opts) return el;
    if (opts.className) el.className = opts.className;
    if (opts.text) el.textContent = opts.text;
    if (opts.html) el.innerHTML = opts.html;
    if (opts.attrs) Object.keys(opts.attrs).forEach(k => el.setAttribute(k, opts.attrs[k]));
    return el;
  }

  function _resolveTarget(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch (_) { return null; }
  }

  function _positionTooltip(tooltip, targetRect, placement) {
    const margin = 14;
    const tipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top, left;

    if (!targetRect || placement === 'center') {
      // Center
      top = Math.max(margin, (vh - tipRect.height) / 2);
      left = Math.max(margin, (vw - tipRect.width) / 2);
      tooltip.style.top = Math.round(top) + 'px';
      tooltip.style.left = Math.round(left) + 'px';
      return;
    }

    // Smart placement: try below, then above, then left/right
    const order = placement
      ? [placement, 'bottom', 'top', 'right', 'left']
      : ['bottom', 'top', 'right', 'left'];

    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      if (p === 'bottom') {
        top = targetRect.bottom + margin;
        left = targetRect.left + (targetRect.width - tipRect.width) / 2;
        if (top + tipRect.height < vh - margin) break;
      } else if (p === 'top') {
        top = targetRect.top - tipRect.height - margin;
        left = targetRect.left + (targetRect.width - tipRect.width) / 2;
        if (top > margin) break;
      } else if (p === 'right') {
        top = targetRect.top + (targetRect.height - tipRect.height) / 2;
        left = targetRect.right + margin;
        if (left + tipRect.width < vw - margin) break;
      } else if (p === 'left') {
        top = targetRect.top + (targetRect.height - tipRect.height) / 2;
        left = targetRect.left - tipRect.width - margin;
        if (left > margin) break;
      }
    }

    // Clamp into viewport
    top  = Math.max(margin, Math.min(top, vh - tipRect.height - margin));
    left = Math.max(margin, Math.min(left, vw - tipRect.width - margin));
    tooltip.style.top = Math.round(top) + 'px';
    tooltip.style.left = Math.round(left) + 'px';
  }

  function start(opts) {
    opts = opts || {};
    const key = opts.key;
    const steps = Array.isArray(opts.steps) ? opts.steps : [];
    if (!key || !steps.length) return;
    if (_hasSeen(key)) return;

    let idx = 0;
    let cleanup = null;

    const overlay  = _make('div', { className: 'gh-tour-overlay' });
    const spotlight = _make('div', { className: 'gh-tour-spotlight', attrs: { 'aria-hidden': 'true' } });
    const tooltip  = _make('div', {
      className: 'gh-tour-tooltip',
      attrs: { 'role': 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gh-tour-title' },
    });

    overlay.appendChild(spotlight);
    document.body.appendChild(overlay);
    document.body.appendChild(tooltip);
    document.body.classList.add('gh-tour-open');

    function render() {
      const step = steps[idx];
      const target = _resolveTarget(step.target);
      const targetRect = target ? target.getBoundingClientRect() : null;

      // Spotlight: align to target, or hide for centered steps
      if (targetRect && targetRect.width > 0) {
        spotlight.style.display = '';
        spotlight.style.top    = (targetRect.top - 8) + 'px';
        spotlight.style.left   = (targetRect.left - 8) + 'px';
        spotlight.style.width  = (targetRect.width + 16) + 'px';
        spotlight.style.height = (targetRect.height + 16) + 'px';
        // Scroll into view if needed
        if (targetRect.top < 0 || targetRect.bottom > window.innerHeight) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        spotlight.style.display = 'none';
      }

      const isLast = idx === steps.length - 1;
      const stepIndicator = steps.length > 1 ? `<span class="gh-tour-progress">${idx + 1} / ${steps.length}</span>` : '';

      // Build tooltip content. Use textContent for title/body to avoid XSS;
      // build action buttons via DOM API.
      tooltip.innerHTML = '';
      const indicator = _make('div', { className: 'gh-tour-step', html: stepIndicator });
      const titleEl   = _make('h3', { className: 'gh-tour-title', id: 'gh-tour-title', text: step.title || '' });
      const bodyEl    = _make('p',  { className: 'gh-tour-body', text: step.body || '' });
      const actions   = _make('div', { className: 'gh-tour-actions' });

      const skipBtn = _make('button', {
        className: 'gh-btn gh-btn--ghost gh-btn--small',
        text: isLast ? 'ปิด' : 'ข้าม',
        attrs: { 'type': 'button' },
      });
      skipBtn.addEventListener('click', finish);

      const nextBtn = _make('button', {
        className: 'gh-btn gh-btn--primary gh-btn--small',
        text: isLast ? (opts.finishLabel || 'เริ่มเลย') : 'ถัดไป',
        attrs: { 'type': 'button' },
      });
      nextBtn.addEventListener('click', function () {
        if (isLast) finish();
        else { idx += 1; render(); }
      });

      actions.appendChild(skipBtn);
      actions.appendChild(nextBtn);

      tooltip.appendChild(indicator);
      tooltip.appendChild(titleEl);
      tooltip.appendChild(bodyEl);
      tooltip.appendChild(actions);

      // Position tooltip after layout settles
      requestAnimationFrame(function () {
        _positionTooltip(tooltip, targetRect, step.placement);
        // Move keyboard focus to next button (primary action)
        nextBtn.focus();
      });
    }

    function finish() {
      if (cleanup) cleanup();
      _markSeen(key);
      if (typeof opts.onDone === 'function') {
        try { opts.onDone(); } catch (_) { /* swallow */ }
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish();
      }
    }
    function onResize() { render(); }

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);

    cleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      document.body.classList.remove('gh-tour-open');
      cleanup = null;
    };

    render();
  }

  window.GhTour = {
    start: start,
    reset: _reset,
    hasSeen: _hasSeen,
  };
})();
