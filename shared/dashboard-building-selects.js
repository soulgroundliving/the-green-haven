// Dynamic building <select> populator — keeps every hardcoded building dropdown
// in dashboard.html in sync with BuildingRegistry. Re-runs on the
// `buildingRegistryChanged` event so new buildings created via the Buildings
// page surface everywhere without per-surface code changes.
//
// Surfaces covered:
//   #exp-building, #exp-filter-building       — ค่าใช้จ่าย form + filter
//   #roomConfigBuilding                       — จัดการห้องพัก / ตั้งค่าอัตรา
//   #pvh-building                             — Bill page · ประวัติตามห้อง
//   #f-building                                — Bill page · ออกบิล (canonical IDs)
//   #eventBuilding, #eventBuildingFilter      — Community Events
//   #bc-audience-row (radio group)            — Requests & Approvals · Broadcast ส่งถึง
//
// Adding a new dropdown? Add a spec entry below — no other file change needed.

(function () {
  const SPECS = [
    { id: 'exp-building' },
    { id: 'exp-filter-building' },
    { id: 'roomConfigBuilding' },
    { id: 'pvh-building',         placeholder: '-- เลือกตึก --' },
    { id: 'f-building' },
    { id: 'eventBuildingFilter',  allOption: true,  allLabel: '🌐 ทุกตึก' },
    { id: 'eventBuilding',        allOption: true,  allLabel: '🌐 ทุกตึก (ทั้งห้องแถว + Nest เห็น)', suffix: ' เท่านั้น' }
  ];

  function _list() {
    return (window.BuildingRegistry && window.BuildingRegistry.list && window.BuildingRegistry.list())
      || [{ id: 'rooms', displayName: 'ห้องแถว' }, { id: 'nest', displayName: 'Nest' }];
  }

  function _icon(id) {
    if (id === 'nest') return '🏢';
    if (id === 'rooms') return '🏠';
    return '🏘️';
  }

  function _populateSelect(spec) {
    const el = document.getElementById(spec.id);
    if (!el || el.tagName !== 'SELECT') return;
    const buildings = _list();
    const prev = el.value;
    const parts = [];
    if (spec.placeholder) parts.push(`<option value="">${spec.placeholder}</option>`);
    if (spec.allOption)   parts.push(`<option value="all">${spec.allLabel || '🌐 ทุกตึก'}</option>`);
    for (const b of buildings) {
      const label = String(b.displayName || b.id).replace(/</g, '&lt;');
      parts.push(`<option value="${b.id}">${_icon(b.id)} ${label}${spec.suffix || ''}</option>`);
    }
    el.innerHTML = parts.join('');
    if (prev && el.querySelector(`option[value="${CSS.escape(prev)}"]`)) el.value = prev;
  }

  function _renderBroadcastAudienceRadios() {
    const row = document.getElementById('bc-audience-row');
    if (!row) return;
    const buildings = _list();
    const checked = (row.querySelector('input[name="bc-audience"]:checked')?.value) || 'all';
    const radio = (value, label) => `
      <label class="bc-audience-radio" style="display:flex;align-items:center;gap:.4rem;padding:.5rem .9rem;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
        <input type="radio" name="bc-audience" value="${value}"${checked === value ? ' checked' : ''}> ${label}
      </label>`;
    const parts = [radio('all', '🏢 ทุกอาคาร')];
    for (const b of buildings) {
      const label = String(b.displayName || b.id).replace(/</g, '&lt;');
      parts.push(radio(b.id, `${_icon(b.id)} ${label}`));
    }
    row.innerHTML = parts.join('');
  }

  function _populateAll() {
    for (const spec of SPECS) _populateSelect(spec);
    _renderBroadcastAudienceRadios();
  }

  // Wire up: initial populate + re-populate on registry change.
  window.addEventListener('buildingRegistryChanged', _populateAll);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _populateAll();
      if (window.BuildingRegistry && typeof window.BuildingRegistry.init === 'function') {
        window.BuildingRegistry.init().then(_populateAll).catch(() => { /* fallback already rendered */ });
      }
    });
  } else {
    _populateAll();
    if (window.BuildingRegistry && typeof window.BuildingRegistry.init === 'function') {
      window.BuildingRegistry.init().then(_populateAll).catch(() => { /* fallback already rendered */ });
    }
  }

  window._populateBuildingSelects = _populateAll;
})();
