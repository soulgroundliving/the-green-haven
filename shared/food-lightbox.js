// Shared full-screen photo carousel for leftover-food shares — used by BOTH the
// tenant card viewer (shared/tenant-food-share.js) and the admin monitor
// (shared/dashboard-food-share-admin.js). Single source of truth so the two
// pages can't drift, replacing the two near-identical _openLightbox builders.
//
// Safety contract:
//   §7-XX — image src must be an https URL (food shares store CF-uploaded
//           tokenised https URLs); never a blob:/data: URL.
//   §7-RR — all styling lives in shared/components.css (.food-lightbox*); this
//           module builds DOM only, never document.createElement('style').
//
// Swipe is pure CSS scroll-snap (no carousel library); JS only tracks the
// snapped page to drive the counter + dots.
(function () {
  'use strict';

  // urls: string[] of https photo URLs. No-op on empty/invalid input.
  function open(urls) {
    if (!Array.isArray(urls) || !urls.length) return;
    const multi = urls.length > 1;

    const ov = document.createElement('div');
    ov.className = 'food-lightbox';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'food-lightbox__close';
    close.setAttribute('aria-label', 'ปิด');
    close.textContent = '✕';

    const frame = document.createElement('div');
    frame.className = 'food-lightbox__frame';

    let counter = null;
    if (multi) {
      counter = document.createElement('div');
      counter.className = 'food-lightbox__counter';
      counter.textContent = '1 / ' + urls.length;
      frame.appendChild(counter);
    }

    const track = document.createElement('div');
    track.className = 'food-lightbox__track';
    urls.forEach(function (u) {
      const im = document.createElement('img');
      im.className = 'food-lightbox__img';
      im.src = u;
      im.alt = '';
      im.loading = 'lazy';
      track.appendChild(im);
    });
    frame.appendChild(track);

    const dotEls = [];
    if (multi) {
      const dots = document.createElement('div');
      dots.className = 'food-lightbox__dots';
      urls.forEach(function (_u, i) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'food-lightbox__dot' + (i === 0 ? ' is-active' : '');
        d.setAttribute('aria-label', 'รูปที่ ' + (i + 1));
        d.addEventListener('click', function () {
          track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
        });
        dots.appendChild(d);
        dotEls.push(d);
      });
      frame.appendChild(dots);

      // Reflect the snapped page in the counter + active dot. The update is
      // featherweight (one textContent + a few class toggles), so it runs inline
      // on scroll — no rAF throttle needed (KISS), and no dependency on rAF firing
      // (which a backgrounded/non-painting tab can starve).
      track.addEventListener('scroll', function () {
        const w = track.clientWidth || 1;
        const i = Math.max(0, Math.min(urls.length - 1, Math.round(track.scrollLeft / w)));
        counter.textContent = (i + 1) + ' / ' + urls.length;
        dotEls.forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
      }, { passive: true });
    }

    function destroy() {
      ov.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') destroy(); }
    document.addEventListener('keydown', onKey);

    // Tap the dim backdrop or the ✕ closes; taps on the photo/dots/frame don't.
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target === close) destroy();
    });

    ov.appendChild(close);
    ov.appendChild(frame);
    document.body.appendChild(ov);
  }

  window.FoodLightbox = { open: open };
})();
