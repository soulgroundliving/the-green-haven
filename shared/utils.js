// Shared HTML-escape utility — single canonical definition for the whole project.
// Loaded early (after rich-text-policy.js) in dashboard.html and tenant_app.html.
// All shared/*.js modules that formerly defined a local `function _esc(s)` now
// rely on this global instead.
window._esc = function(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
