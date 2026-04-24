/**
 * Tailwind CSS v3 config for Phase 4E Tailwind CDN → pre-built migration.
 *
 * Only tenant_app.html loads Tailwind at all — dashboard.html and the other
 * tools use shared/brand.css + their own CSS. We still scan every HTML + JS
 * file to be safe (so classes used in shared modules that happen to render
 * into tenant_app are picked up by the JIT scanner).
 */
module.exports = {
  content: [
    './*.html',
    './shared/**/*.js',
    './accounting/**/*.js',
    './api/**/*.js',
  ],
  theme: { extend: {} },
  plugins: [],
};
