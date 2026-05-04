/*
 * Green Haven — Empty state illustrations (muji-minimal line art)
 *
 * Pairs with .gh-empty-state* classes in shared/components.css.
 *
 * Stock SVGs (single-stroke, monochrome, ~120×120):
 *   - bills:       receipt with checkmark — "no bills yet" or "all settled"
 *   - marketplace: shopping bag with sparkle — "no listings"
 *   - messages:    speech bubble with calm dots — "no complaints / messages"
 *   - tasks:       checklist with single line — "nothing pending"
 *   - generic:     leaf — fallback
 *
 * API (UMD-ish):
 *   GhEmptyState.render(target, type, opts)
 *     target: HTMLElement | string (id or selector)
 *     type:   'bills' | 'marketplace' | 'messages' | 'tasks' | 'generic'
 *     opts:   { title?, text?, actionLabel?, onAction? }  — all optional;
 *             sensible defaults per type if omitted.
 *
 *   GhEmptyState.html(type, opts)  — returns innerHTML string instead of mutating
 */
(function () {
  'use strict';

  // SVG illustrations — keep stroke-only, no fill, work in any color via currentColor
  const SVG = {
    bills: '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M30 22 h60 v76 l-12-8 -12 8 -12-8 -12 8 -12-8z"/>' +
      '<path d="M42 42 h36 M42 56 h36 M42 70 h22"/>' +
      '<circle cx="78" cy="70" r="9"/>' +
      '<path d="M73 70 l4 4 6-7"/>' +
      '</svg>',
    marketplace: '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M30 42 l4-12 h52 l4 12 v50 a4 4 0 0 1-4 4 h-52 a4 4 0 0 1-4-4 z"/>' +
      '<path d="M48 42 v-8 a12 12 0 0 1 24 0 v8"/>' +
      '<path d="M58 64 l-4 4 M62 60 l4 4 M60 56 v8"/>' +
      '</svg>',
    messages: '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M28 38 a8 8 0 0 1 8-8 h48 a8 8 0 0 1 8 8 v34 a8 8 0 0 1-8 8 h-32 l-12 12 v-12 h-4 a8 8 0 0 1-8-8 z"/>' +
      '<circle cx="50" cy="55" r="2"/>' +
      '<circle cx="60" cy="55" r="2"/>' +
      '<circle cx="70" cy="55" r="2"/>' +
      '</svg>',
    tasks: '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M30 28 h60 a4 4 0 0 1 4 4 v56 a4 4 0 0 1-4 4 h-60 a4 4 0 0 1-4-4 v-56 a4 4 0 0 1 4-4 z"/>' +
      '<path d="M40 46 l4 4 8-8 M40 64 l4 4 8-8 M40 82 l4 4 8-8"/>' +
      '<path d="M60 48 h26 M60 66 h26 M60 84 h18"/>' +
      '</svg>',
    generic: '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<path d="M60 22 c20 0 36 16 36 36 c0 24-20 40-36 40 c-16 0-36-16-36-40 c0-20 16-36 36-36 z"/>' +
      '<path d="M60 38 v44 M44 60 c8-12 24-12 32 0"/>' +
      '</svg>',
  };

  const DEFAULTS = {
    bills:       { title: 'ยังไม่มีบิล',      text: 'เมื่อมีบิลเข้ามา จะแสดงที่นี่' },
    marketplace: { title: 'ยังไม่มีประกาศ',    text: 'มาเป็นคนแรกที่ลงประกาศในชุมชน' },
    messages:    { title: 'ทุกอย่างเรียบร้อย', text: 'ไม่มีข้อความรอตอบกลับ' },
    tasks:       { title: 'ไม่มีรายการค้าง',  text: 'ทุกอย่างเสร็จเรียบร้อยแล้ว' },
    generic:     { title: 'ว่างเปล่า',         text: 'ยังไม่มีรายการในตอนนี้' },
  };

  function _resolveTarget(target) {
    if (target instanceof HTMLElement) return target;
    if (typeof target === 'string') {
      // Accept either '#id' or 'id' for convenience
      return document.querySelector(target.startsWith('#') || target.includes(' ') ? target : '#' + target);
    }
    return null;
  }

  function html(type, opts) {
    type = (type && SVG[type]) ? type : 'generic';
    opts = opts || {};
    const def = DEFAULTS[type];
    const title = opts.title != null ? opts.title : def.title;
    const text  = opts.text  != null ? opts.text  : def.text;
    const safeTitle = String(title).replace(/</g, '&lt;');
    const safeText  = String(text).replace(/</g, '&lt;');
    let out = '<div class="gh-empty-state">';
    out += '<div class="gh-empty-state__illust">' + SVG[type] + '</div>';
    if (safeTitle) out += '<p class="gh-empty-state__title">' + safeTitle + '</p>';
    if (safeText)  out += '<p class="gh-empty-state__text">'  + safeText  + '</p>';
    if (opts.actionLabel) {
      const label = String(opts.actionLabel).replace(/</g, '&lt;');
      out += '<div class="gh-empty-state__action">' +
             '<button type="button" class="gh-btn gh-btn--ghost gh-btn--small" data-gh-empty-action>' + label + '</button>' +
             '</div>';
    }
    out += '</div>';
    return out;
  }

  function render(target, type, opts) {
    const el = _resolveTarget(target);
    if (!el) return null;
    el.innerHTML = html(type, opts);
    if (opts && typeof opts.onAction === 'function') {
      const btn = el.querySelector('[data-gh-empty-action]');
      if (btn) btn.addEventListener('click', opts.onAction);
    }
    return el;
  }

  window.GhEmptyState = { render: render, html: html };
})();
