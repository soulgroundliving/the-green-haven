// ═════════════════════════════════════════════════════════════════════════════
// dashboard-domain-stores.js — extracted from dashboard-extra.js 2026-05-19
// ═════════════════════════════════════════════════════════════════════════════
//
// Phase 1 of the dashboard-extra.js refactor (Plan #6). Holds the 4 IIFE-wrapped
// domain stores plus their immediately-bound UI helpers — all the code that's
// tightly coupled to a Firestore/RTDB collection on the admin side.
//
// Stores (each exposed on `window.X`):
//   - ServiceProvidersStore  ← system/serviceProviders.items
//   - CommunityEventsStore   ← communityEvents/* (legacy; C4 S2 sealed reads
//                              behind _newAnnouncementsEventCache from
//                              announcements/{id} type='event')
//   - RequestsStore          ← Firestore complaints/* (RTDB facade for
//                              maintenance + housekeeping)
//   - HistoricalDataStore    ← historicalRevenue/{yearShort}
//
// Sibling UI helpers preserved verbatim (page init, render, click handlers).
// Each store still owns its own auto-subscribe (setTimeout 700-800ms).
//
// Load order: MUST load BEFORE dashboard-extra.js — that file's init paths
// reference `window.RequestsStore`, `window.ServiceProvidersStore`, etc., and
// the cleanupAdminListeners function (still in dashboard-extra.js) reads
// `window._RequestsStoreComplaintsUnsub` for tear-down on beforeunload.
//
// External dependencies (resolved at call time, after dashboard-extra.js loads):
//   - `_esc(s)` — HTML escape utility, function declared at top level in
//     dashboard-extra.js → auto-hoisted to window
//   - `showToast`, `ghAlert`, `window.ghConfirm` — global UI helpers
//   - `window.firebase.firestore` + `window.firebase.firestoreFunctions` —
//     Firebase v11 modular SDK shims initialized earlier in dashboard.html
//
// One behavioral fix during extraction: `_RequestsStoreComplaintsUnsub` was a
// `let` at module scope (L3946 in pre-extraction file). Since cleanupAdminListeners
// in dashboard-extra.js references it for teardown, it must cross the script
// boundary. Converted to `window._RequestsStoreComplaintsUnsub` (the only
// non-verbatim change in this file).
// ═════════════════════════════════════════════════════════════════════════════

// ===== SERVICE PROVIDERS MANAGEMENT =====
function initServiceProvidersPage() {
  loadAndRenderServiceProviders();
}

// ===== ServiceProvidersStore (Phase 4 2026-04-19) =====
// Single Source of Truth: Firestore system/serviceProviders.items
//   localStorage cache only; cloud canonical so admin from any device sees same list
window.ServiceProvidersStore = window.ServiceProvidersStore || (function(){
  let cache = null;            // null = not loaded yet
  const listeners = new Set();
  let unsub = null;

  function _local() {
    try { return JSON.parse(localStorage.getItem('service_providers_data') || '[]'); }
    catch(e) { return []; }
  }
  function _writeLocal(arr) {
    try { localStorage.setItem('service_providers_data', JSON.stringify(arr)); } catch(e){}
  }
  function getAll() { return cache !== null ? cache : _local(); }
  function onChange(fn) {
    listeners.add(fn);
    if (cache !== null) { try { fn(cache); } catch(e){} }
    return () => listeners.delete(fn);
  }
  function _notify() { listeners.forEach(fn => { try { fn(getAll()); } catch(e){} }); }

  async function _push(items) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return false;
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.setDoc(fs.doc(db, 'system', 'serviceProviders'), {
        items, updatedAt: new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (e) { console.warn('ServiceProvidersStore push:', e?.message); return false; }
  }
  async function setAll(items) {
    cache = Array.isArray(items) ? items : [];
    _writeLocal(cache);
    _notify();
    await _push(cache);
  }
  async function add(provider) {
    const list = getAll().slice();
    list.push(provider);
    return setAll(list);
  }
  async function update(id, changes) {
    const list = getAll().slice();
    const idx = list.findIndex(p => p.id === id);
    if (idx < 0) return false;
    list[idx] = { ...list[idx], ...changes, updatedDate: new Date().toISOString() };
    return setAll(list);
  }
  async function remove(id) {
    return setAll(getAll().filter(p => p.id !== id));
  }
  async function migrateLocalToCloud() {
    return _push(_local()) ? { pushed: _local().length } : { pushed: 0 };
  }
  function subscribe() {
    if (unsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribe, 1500); return;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      unsub = fs.onSnapshot(fs.doc(db, 'system', 'serviceProviders'), snap => {
        const items = snap.exists() ? ((snap.data() || {}).items || []) : [];
        cache = items;
        _writeLocal(items);
        _notify();
      }, err => console.warn('serviceProviders listen:', err?.message));
    } catch(e) { console.warn('subscribe:', e); }
  }
  if (typeof window !== 'undefined') setTimeout(subscribe, 800);
  return { getAll, onChange, setAll, add, update, remove, migrateLocalToCloud, subscribe };
})();

function loadAndRenderServiceProviders() {
  const list = document.getElementById('providersList');
  if (!list) return;

  // Phase 4 race fix: auto-rerender when cloud snapshot arrives after initial render
  if (typeof ServiceProvidersStore !== 'undefined' && !window._spRendererSubscribed) {
    window._spRendererSubscribed = true;
    ServiceProvidersStore.onChange(() => {
      // Only rerender if the providers list element is currently in the DOM
      if (document.getElementById('providersList')) loadAndRenderServiceProviders();
    });
  }

  let providers = (typeof ServiceProvidersStore !== 'undefined')
    ? ServiceProvidersStore.getAll()
    : JSON.parse(localStorage.getItem('service_providers_data') || '[]');
  const searchVal = document.getElementById('providerSearch')?.value.toLowerCase() || '';

  if (searchVal) {
    providers = providers.filter(p =>
      p.name.toLowerCase().includes(searchVal) ||
      p.type.toLowerCase().includes(searchVal) ||
      p.phone.includes(searchVal)
    );
  }

  if (providers.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No service providers yet</div>';
    return;
  }

  list.innerHTML = providers.map(p => {
    const safeWebsite = /^https?:\/\//i.test(p.website || '') ? p.website : '';
    const websiteHtml = safeWebsite
      ? `<a href="${safeWebsite}" target="_blank" rel="noopener noreferrer" style="color: var(--blue);">${_esc(safeWebsite)}</a>`
      : (_esc(p.website) || '-');
    return `
    <div class="card" style="margin-bottom: 1rem; border-left: 4px solid var(--green);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
        <div>
          <div style="font-weight: 700; font-size: 1rem;">📞 ${_esc(p.name)}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">Type: <strong>${_esc(p.type)}</strong></div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button data-action="editServiceProvider" data-id="${_esc(p.id)}" class="compact-btn compact-btn-edit">✏️ Edit</button>
          <button data-action="deleteServiceProvider" data-id="${_esc(p.id)}" class="compact-btn compact-btn-delete">🗑️ Delete</button>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
        <div>📱 Phone: <strong>${_esc(p.phone)}</strong></div>
        <div>📧 Email: <strong>${_esc(p.email || '-')}</strong></div>
        <div style="grid-column: 1/-1;">🌐 Website: <strong>${websiteHtml}</strong></div>
        ${p.details ? `<div style="grid-column: 1/-1; padding-top: 0.5rem; border-top: 1px dashed var(--border); font-size: 0.85rem; color: var(--text-muted); white-space: pre-wrap;">📝 ${_esc(p.details)}</div>` : ''}
      </div>
    </div>
  `;
  }).join('');
}

function _clearLegacyProviderTypeOptions() {
  // Remove any one-off options that editServiceProvider may have prepended for
  // legacy free-form types. Keeps the dropdown clean across add/edit cycles
  // so admins can't accidentally re-add a banned type (internet/maintenance).
  const sel = document.getElementById('providerType');
  if (!sel) return;
  Array.from(sel.options)
    .filter(o => o.dataset && o.dataset.legacyType === '1')
    .forEach(o => o.remove());
}

function toggleAddProviderForm() {
  const form = document.getElementById('addProviderForm');
  if (!form) return;
  form.classList.toggle('u-hidden');
  if (!form.classList.contains('u-hidden')) {
    _clearLegacyProviderTypeOptions();
    document.getElementById('providerType').focus();
  }
}

async function saveServiceProvider() {
  const type = document.getElementById('providerType')?.value.trim();
  const name = document.getElementById('providerName')?.value.trim();
  const phone = document.getElementById('providerPhone')?.value.trim();
  const email = document.getElementById('providerEmail')?.value.trim();
  const website = document.getElementById('providerWebsite')?.value.trim();
  const details = document.getElementById('providerDetails')?.value.trim();

  if (!type || !name || !phone) {
    showToast('Please fill in Type, Name, and Phone', 'warning');
    return;
  }

  const newProvider = {
    id: 'sp_' + Date.now(),
    type, name, phone, email, website, details,
    createdDate: new Date().toISOString()
  };

  // Phase 4: dual-write via ServiceProvidersStore (Firestore + localStorage)
  await ServiceProvidersStore.add(newProvider);

  ['providerType','providerName','providerPhone','providerEmail','providerWebsite','providerDetails']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  toggleAddProviderForm();
  loadAndRenderServiceProviders();
  showToast('✅ Service provider added successfully (☁️ Firestore)', 'success');
}

function editServiceProvider(id) {
  const providers = ServiceProvidersStore.getAll();
  const provider = providers.find(p => p.id === id);
  if (!provider) return;

  // providerType is a <select> (2026-05-17 cleanup). Pre-existing free-form
  // types from the old <input> era won't match any option — preserve the value
  // by prepending a one-off option so the admin sees what's stored and can
  // re-select a canonical type without losing the existing value. Marked with
  // data-legacy-type so toggleAddProviderForm can strip it on next open.
  _clearLegacyProviderTypeOptions();
  const typeSel = document.getElementById('providerType');
  if (typeSel && provider.type) {
    const known = Array.from(typeSel.options).some(o => o.value === provider.type);
    if (!known) {
      const opt = document.createElement('option');
      opt.value = provider.type;
      opt.textContent = `${provider.type} (เดิม — โปรดเลือกประเภทใหม่)`;
      opt.dataset.legacyType = '1';
      typeSel.insertBefore(opt, typeSel.options[1] || null);
    }
  }
  document.getElementById('providerType').value = provider.type;
  document.getElementById('providerName').value = provider.name;
  document.getElementById('providerPhone').value = provider.phone;
  document.getElementById('providerEmail').value = provider.email || '';
  document.getElementById('providerWebsite').value = provider.website || '';
  const detailsEl = document.getElementById('providerDetails');
  if (detailsEl) detailsEl.value = provider.details || '';

  const form = document.getElementById('addProviderForm');
  form.classList.remove('u-hidden');

  const button = form.querySelector('button.btn-receipt');
  const originalText = button.textContent;
  button.textContent = '✏️ Update Provider';
  button.onclick = async function() {
    const changes = {
      type: document.getElementById('providerType').value.trim(),
      name: document.getElementById('providerName').value.trim(),
      phone: document.getElementById('providerPhone').value.trim(),
      email: document.getElementById('providerEmail').value.trim(),
      website: document.getElementById('providerWebsite').value.trim(),
      details: document.getElementById('providerDetails')?.value.trim() || ''
    };
    const ok = await ServiceProvidersStore.update(id, changes);
    if (ok !== false) {
      ['providerType','providerName','providerPhone','providerEmail','providerWebsite','providerDetails']
        .forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
      form.classList.add('u-hidden');
      button.textContent = originalText;
      button.onclick = null;
      loadAndRenderServiceProviders();
      showToast('✅ Service provider updated', 'success');
    }
  };
}

async function deleteServiceProvider(id) {
  const ok = await window.ghConfirm('ลบผู้ให้บริการนี้?', { danger: true });
  if (!ok) return;
  await ServiceProvidersStore.remove(id);
  loadAndRenderServiceProviders();
  showToast('✅ Service provider deleted', 'success');
}

// ===== COMMUNITY EVENTS MANAGEMENT =====
let _eventsUnsub = null;
// ===== C4 merge (2026-05-17) — new-collection event subscriber =====
// New events go to announcements/{id} with type='event' via publishAnnouncement CF.
// Legacy events stay in communityEvents (CommunityEventsStore). This subscriber
// hydrates the new-collection slice; loadAndRenderCommunityEvents merges both.
window._newAnnouncementsEventCache = window._newAnnouncementsEventCache || new Map();
window._newAnnouncementsEventUnsub = window._newAnnouncementsEventUnsub || null;
function _subscribeNewAnnouncementsEvents() {
  if (window._newAnnouncementsEventUnsub) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(_subscribeNewAnnouncementsEvents, 1500);
    return;
  }
  try {
    const fs = window.firebase.firestoreFunctions;
    const db = window.firebase.firestore();
    const q = fs.query(
      fs.collection(db, 'announcements'),
      fs.where('type', '==', 'event')
    );
    window._newAnnouncementsEventUnsub = fs.onSnapshot(q, snap => {
      window._newAnnouncementsEventCache.clear();
      snap.docs.forEach(d => {
        const data = d.data() || {};
        // Adapt new schema (type/title/body/audience/eventDate/location) to
        // legacy render shape (title/date/time/location/description/building).
        const dt = data.eventDate?.toDate?.() || (data.eventDate ? new Date(data.eventDate) : null);
        const dateStr = dt ? dt.toISOString().split('T')[0] : '';
        const timeStr = dt ? dt.toISOString().split('T')[1]?.slice(0, 5) : '';
        window._newAnnouncementsEventCache.set(d.id, {
          id: d.id,
          title: data.title || '',
          date: dateStr,
          time: timeStr,
          location: data.location || '',
          description: data.body || '',
          building: data.audience || 'all',
          _source: 'announcements',
        });
      });
      if (document.getElementById('eventsList')) loadAndRenderCommunityEvents();
    }, err => {
      console.warn('[announcements/event] subscribe failed:', err?.message || err);
      if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
        window._newAnnouncementsEventUnsub = null;
      }
    });
  } catch (e) { console.warn('_subscribeNewAnnouncementsEvents:', e); }
}

// CommunityEventsStore REMOVED — C4 S3 (2026-05-27).
// communityEvents collection migrated to announcements/ (type='event') in S2.
// Admin reads events via _subscribeNewAnnouncementsEvents (announcements/ only).

function initCommunityEventsPage() {
  loadAndRenderCommunityEvents();
  // C4 S2 (2026-05-18): _subscribeNewAnnouncementsEvents triggers rerender on snapshot.
  // CommunityEventsStore subscription dropped — single-source from announcements/.
  _subscribeNewAnnouncementsEvents();        // idempotent — C4 announcements/event subscriber
}

function loadAndRenderCommunityEvents() {
  const list = document.getElementById('eventsList');
  if (!list) return;

  // C4 S2 (2026-05-18): single-source from announcements/event cache.
  let events = window._newAnnouncementsEventCache
    ? [...window._newAnnouncementsEventCache.values()]
    : [];
  const searchVal = document.getElementById('eventSearch')?.value.toLowerCase() || '';
  const buildingFilter = document.getElementById('eventBuildingFilter')?.value || 'all';

  if (searchVal) {
    events = events.filter(e =>
      (e.title || '').toLowerCase().includes(searchVal) ||
      (e.location || '').toLowerCase().includes(searchVal)
    );
  }
  if (buildingFilter !== 'all') {
    events = events.filter(e => !e.building || e.building === buildingFilter || e.building === 'all');
  }

  // Sort: upcoming first, then past
  const today = new Date(); today.setHours(0,0,0,0);
  events.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    const aPast = da < today, bPast = db < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return da - db;
  });

  if (events.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">📭 No events scheduled</div>';
    return;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  list.innerHTML = events.map(e => {
    const isPast = new Date(e.date) < today;
    const bldgLabel = e.building === 'nest' ? '🏢 Nest' : e.building === 'rooms' ? '🏠 ห้องแถว' : '🌐 ทุกตึก';
    return `
    <div class="card" style="margin-bottom: 1rem; border-left: 4px solid ${isPast ? DashColors.TEXT_LIGHTER : '#ff8f00'};">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 1rem;">📅 ${esc(e.title)} ${isPast ? `<span style="font-size:.7rem;color:${DashColors.TEXT_LIGHTER};">(ผ่านแล้ว)</span>` : ''}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">
            ${bldgLabel} | 📍 ${esc(e.location)} | 🕐 ${esc(e.time)}
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button data-action="editEvent" data-id="${esc(e.id)}" class="compact-btn compact-btn-edit">✏️</button>
          <button data-action="deleteEvent" data-id="${esc(e.id)}" class="compact-btn compact-btn-delete">🗑️</button>
        </div>
      </div>
      <div style="font-size: 0.9rem; color: var(--text);">📝 ${esc(e.description || '-')}</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">📅 ${new Date(e.date).toLocaleDateString('th-TH')}</div>
    </div>
  `;}).join('');
}

let _editingEventId = null;
function toggleAddEventForm() {
  const form = document.getElementById('addEventForm');
  if (!form) return;
  if (!form.classList.contains('u-hidden')) {
    form.classList.add('u-hidden');
    _editingEventId = null;
    return;
  }
  form.classList.remove('u-hidden');
  document.getElementById('eventTitle')?.focus();
}

async function saveCommunityEvent() {
  const title = document.getElementById('eventTitle')?.value.trim();
  const date = document.getElementById('eventDate')?.value;
  const time = document.getElementById('eventTime')?.value;
  const location = document.getElementById('eventLocation')?.value.trim();
  const description = document.getElementById('eventDescription')?.value.trim();
  const building = document.getElementById('eventBuilding')?.value || 'all';

  if (!title || !date || !time || !location) {
    showToast('Please fill in Title, Date, Time, and Location', 'warning');
    return;
  }

  const wasEdit = !!_editingEventId;
  // C4 S2 (2026-05-18): event edit disabled — updateAnnouncement CF lands in S3.
  // S2 sealed legacy reads, so the old `isLegacyEdit → CommunityEventsStore.setOne`
  // path is dead. Create path via publishAnnouncement CF stays.
  if (wasEdit) {
    showToast('การแก้ไขกิจกรรมจะรองรับใน Session 3 (เร็วๆ นี้) — กรุณาลบแล้วสร้างใหม่', 'warning');
    return;
  }

  try {
    const eventDateIso = new Date(`${date}T${time || '00:00'}`).toISOString();
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) throw new Error('Not signed in');
    const res = await fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/publishAnnouncement', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'event',
        title,
        body: description || title,
        audience: building,
        eventDate: eventDateIso,
        location,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  } catch (e) {
    console.error('saveCommunityEvent failed:', e);
    showToast('❌ บันทึกไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error');
    return;
  }

  ['eventTitle','eventDate','eventTime','eventLocation','eventDescription']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const bldEl = document.getElementById('eventBuilding'); if (bldEl) bldEl.value = 'all';
  _editingEventId = null;
  toggleAddEventForm();
  showToast('✅ สร้างกิจกรรมแล้ว (☁️ Firestore)', 'success');
}

// C4 S2 (2026-05-18): edit + delete disabled — update/deleteAnnouncement CFs land in S3.
// Reading from new cache so a future re-enable doesn't require touching legacy store.
function editEvent(id) {
  showToast('การแก้ไขกิจกรรมจะรองรับใน Session 3 (เร็วๆ นี้) — กรุณาลบแล้วสร้างใหม่', 'warning');
}

async function deleteEvent(id) {
  showToast('การลบกิจกรรมจะรองรับใน Session 3 (เร็วๆ นี้) — แก้ไขผ่าน Firestore Console ชั่วคราว', 'warning');
}

// ===== COMPLAINTS PAGE =====
// ===== RequestsStore — single facade for complaints/maintenance/housekeeping =====
// Phase 3 (2026-04-19): Source of truth = Firestore complaints/{id} for complaints,
// RTDB for maintenance + housekeeping. localStorage retained as offline cache only.
//
// EXTRACTION FIX (2026-05-19): the original `let _RequestsStoreComplaintsUnsub`
// was at module scope; cleanupAdminListeners (still in dashboard-extra.js) reads
// it for teardown on beforeunload. Converted to `window._RequestsStoreComplaintsUnsub`
// so the cross-script reference survives the split.
window._RequestsStoreComplaintsUnsub = window._RequestsStoreComplaintsUnsub || null;
window.RequestsStore = window.RequestsStore || (function(){
  const cache = { complaints: [], maintenance: [], housekeeping: [] };
  const listeners = { complaints: new Set(), maintenance: new Set(), housekeeping: new Set() };
  const subscribed = { complaints: false, maintenance: false, housekeeping: false };

  function _legacy(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
  }

  function getComplaints() {
    if (cache.complaints.length === 0) return _legacy('complaints_data');
    return cache.complaints;
  }
  function getMaintenance() {
    if (cache.maintenance.length === 0) return _legacy('maintenance_data');
    return cache.maintenance;
  }
  function getHousekeeping() {
    if (cache.housekeeping.length === 0) return _legacy('housekeeping_data');
    return cache.housekeeping;
  }

  function onChange(type, fn) {
    if (!listeners[type]) return () => {};
    listeners[type].add(fn);
    // Catch-up: fire immediately if cache populated
    if (cache[type].length > 0) {
      try { fn(cache[type]); } catch(e) {}
    }
    return () => listeners[type].delete(fn);
  }

  function _notify(type) {
    listeners[type].forEach(fn => { try { fn(cache[type]); } catch(e) {} });
  }

  function _ingest(type, list) {
    cache[type] = list || [];
    // Backfill localStorage for offline cache
    try { localStorage.setItem(`${type}_data`, JSON.stringify(cache[type])); } catch(e) {}
    _notify(type);
  }

  function subscribeComplaints() {
    if (subscribed.complaints) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribeComplaints, 1500);
      return;
    }
    subscribed.complaints = true;
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      // Store unsub so cleanupAdminListeners() can detach. Without this the
      // listener would persist for the whole session even after admin closes
      // the dashboard tab — burning callback CPU on every complaints write.
      window._RequestsStoreComplaintsUnsub = fs.onSnapshot(fs.collection(db, 'complaints'), snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Merge with any local-only entries (Firestore wins on collision)
        const local = _legacy('complaints_data');
        const byId = new Map();
        local.forEach(c => byId.set(c.id, c));
        docs.forEach(c => byId.set(c.id, c));
        _ingest('complaints', Array.from(byId.values()));
      }, err => console.warn('RequestsStore complaints listen:', err?.message));
    } catch(e) { subscribed.complaints = false; console.warn('subscribeComplaints:', e); }
  }

  // Auto-subscribe complaints on load (admin dashboard always wants live data)
  if (typeof window !== 'undefined') setTimeout(subscribeComplaints, 800);

  return { getComplaints, getMaintenance, getHousekeeping, onChange,
           subscribeComplaints, _ingest };
})();

let _complaintsUnsub = null;
function initComplaintsPage() {
  console.log('✅ Complaints page initialized');
  // Phase 3: pull from RequestsStore (cache + Firestore subscription auto-runs)
  renderComplaints(window.RequestsStore.getComplaints());
  if (typeof window !== 'undefined' && !window._complaintsRendererSubscribed) {
    window._complaintsRendererSubscribed = true;
    window.RequestsStore.onChange('complaints', list => renderComplaints(list));
  }
  // Idempotent: ensure subscription is live (no-op if already subscribed)
  window.RequestsStore.subscribeComplaints();
}

function renderComplaints(complaints){
  const open     = complaints.filter(c => c.status === 'open').length;
  const inProg   = complaints.filter(c => c.status === 'in-progress').length;
  const resolved = complaints.filter(c => c.status === 'resolved').length;

  const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setTxt('totalComplaintsCount', complaints.length);
  setTxt('openComplaintsCount', open);
  setTxt('inProgressComplaintsCount', inProg);
  setTxt('resolvedComplaintsCount', resolved);

  const list = document.getElementById('complaintsList');
  if (!list) return;

  if (complaints.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">ยังไม่มีการร้องเรียน</div>';
    return;
  }

  const statusColor = { 'open': DashColors.ORANGE_DARK, 'in-progress': DashColors.BLUE_MED, 'resolved': DashColors.GREEN_MED };
  const statusLabel = { 'open': '🔴 Open', 'in-progress': '🟡 In Progress', 'resolved': '🟢 Resolved' };

  const sorted = complaints.slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  list.innerHTML = sorted.map(c => {
    const color = statusColor[c.status] || DashColors.TEXT_LIGHTER;
    const label = statusLabel[c.status] || c.status;
    const date  = c.createdAt ? new Date(c.createdAt).toLocaleDateString('th-TH') : '-';
    return `
      <div style="background:${DashColors.WHITE};border:1px solid var(--border);border-radius:var(--radius-sm);padding:1.2rem;margin-bottom:.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-weight:700;">${c.title || '(ไม่มีหัวข้อ)'}</span>
          <span style="font-size:0.8rem;color:${color};font-weight:600;">${label}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem;">ห้อง ${c.room || '-'} · ${date}</div>
        <div style="font-size:0.9rem;">${c.desc || ''}</div>
        <div style="margin-top:0.8rem;display:flex;gap:0.5rem;">
          ${c.status !== 'resolved' ? `<button data-action="updateComplaintStatus" data-id="${c.id}" data-arg="resolved" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:${DashColors.GREEN_BG};color:${DashColors.GREEN_MED};border:1px solid ${DashColors.GREEN_BORDER};border-radius:4px;cursor:pointer;">✅ Resolve</button>` : ''}
          ${c.status === 'open' ? `<button data-action="updateComplaintStatus" data-id="${c.id}" data-arg="in-progress" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:${DashColors.BLUE_BG};color:${DashColors.BLUE_MED};border:1px solid #bbdefb;border-radius:4px;cursor:pointer;">🔄 In Progress</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function updateComplaintStatus(id, newStatus) {
  const now = new Date().toISOString();
  // Optimistic update through store facade — updates in-memory cache + localStorage + notifies listeners (re-renders)
  const updated = window.RequestsStore.getComplaints().map(c =>
    c.id === id ? { ...c, status: newStatus, updatedAt: now } : c
  );
  window.RequestsStore._ingest('complaints', updated);
  // Firestore is canonical — onSnapshot confirms
  if (window.firebase?.firestore) {
    try {
      const db = window.firebase.firestore();
      const fs = window.firebase.firestoreFunctions;
      await fs.setDoc(fs.doc(fs.collection(db, 'complaints'), id),
        { status: newStatus, updatedAt: now }, { merge: true });
    } catch(e) { console.warn('Firestore complaint update failed:', e); }
  }
}

// ===== HistoricalDataStore (Phase 2c 2026-04-19) =====
// Single Source of Truth for legacy/pre-launch annual bill summaries.
//   Firestore canonical: historicalRevenue/{yearShort}  (e.g., 67/68/69)
//   localStorage cache:  HISTORICAL_DATA  (read-through, fast)
//   Excel imports dual-write to both. Migration helper pushes any local-only
//   years up to Firestore so they persist across devices.
window.HistoricalDataStore = window.HistoricalDataStore || (function(){
  let cloudCache = null;            // {yearShort: {label, months}}
  let cloudUnsub = null;
  const listeners = new Set();

  function _local() {
    try { return JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}'); }
    catch(e) { return {}; }
  }
  function _writeLocal(data) {
    try { localStorage.setItem('HISTORICAL_DATA', JSON.stringify(data)); } catch(e) {}
  }

  /** Merge cloud + local; cloud wins per-year if both exist. */
  function getAll() {
    const local = _local();
    if (!cloudCache) return local;
    return { ...local, ...cloudCache };
  }
  function getYear(year) { return getAll()[String(year)] || null; }
  function listYears() { return Object.keys(getAll()).sort(); }
  function onChange(fn) {
    listeners.add(fn);
    // Catch-up: if cloud data already loaded, fire immediately so late
    // subscribers don't miss the initial snapshot
    if (cloudCache !== null) {
      try { fn(getAll()); } catch(e) {}
    }
    return () => listeners.delete(fn);
  }
  function _notify() { listeners.forEach(fn => { try { fn(getAll()); } catch(e){} }); }

  /** Write a single year (used by Excel import); dual-writes to local + cloud. */
  async function setYear(year, payload) {
    const local = _local();
    local[String(year)] = payload;
    _writeLocal(local);
    if (!cloudCache) cloudCache = {};
    cloudCache[String(year)] = payload;
    _notify();
    await _pushYearToCloud(year, payload);
  }

  async function _pushYearToCloud(year, payload) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      console.warn('HistoricalDataStore: Firestore not ready, year saved locally only');
      return false;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      await fs.setDoc(fs.doc(db, 'historicalRevenue', String(year)), {
        ...payload,
        year: Number(year),
        savedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`☁️ historicalRevenue/${year} pushed to Firestore`);
      return true;
    } catch (e) {
      console.warn(`HistoricalDataStore push failed for year ${year}:`, e?.message);
      return false;
    }
  }

  /** One-shot migration: push every localStorage year to Firestore. */
  async function migrateLocalToCloud() {
    const local = _local();
    const years = Object.keys(local);
    if (years.length === 0) return { pushed: 0, failed: 0, skipped: 0 };
    let pushed = 0, failed = 0;
    for (const y of years) {
      const ok = await _pushYearToCloud(y, local[y]);
      if (ok) pushed++; else failed++;
    }
    console.log(`☁️ Migration done: ${pushed} pushed, ${failed} failed`);
    return { pushed, failed, skipped: 0, years };
  }

  /** Subscribe to Firestore historicalRevenue collection (live). */
  function subscribe() {
    if (cloudUnsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
      setTimeout(subscribe, 1500);
      return;
    }
    try {
      const fs = window.firebase.firestoreFunctions;
      const db = window.firebase.firestore();
      cloudUnsub = fs.onSnapshot(fs.collection(db, 'historicalRevenue'), snap => {
        const next = {};
        snap.forEach(doc => { next[doc.id] = doc.data(); });
        cloudCache = next;
        // Backfill localStorage so dashboard charts work offline next time
        const local = _local();
        Object.keys(next).forEach(y => { local[y] = next[y]; });
        _writeLocal(local);
        _notify();
      }, err => console.warn('historicalRevenue subscribe:', err?.message));
    } catch(e) { console.warn('subscribe error:', e); }
  }

  // Auto-subscribe
  if (typeof window !== 'undefined') setTimeout(subscribe, 700);

  return { getAll, getYear, listYears, setYear, migrateLocalToCloud, subscribe, onChange };
})();

// One-shot migrate button — appears above the historical year dropdown
async function _renderHistoricalCloudMigrateButton(historicalData) {
  const yearSelect = document.getElementById('historicalDataYearSelect');
  if (!yearSelect) return;
  const parent = yearSelect.parentElement;
  if (!parent) return;
  let btn = document.getElementById('historicalDataMigrateBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'historicalDataMigrateBtn';
    btn.className = 'u-btn-upload';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '☁️ กำลังอัพโหลด...';
      try {
        const r = await HistoricalDataStore.migrateLocalToCloud();
        const msg = `☁️ Migrate เสร็จ: ${r.pushed} ปี → Firestore${r.failed?` (${r.failed} ล้มเหลว)`:''}`;
        if (typeof showToast === 'function') showToast(msg, r.failed ? 'warning' : 'success');
        else ghAlert(msg);
        btn.textContent = `☁️ ขึ้น cloud แล้ว (${r.pushed})`;
        setTimeout(() => { btn.disabled = false; btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore อีกครั้ง'; }, 3000);
      } catch (e) {
        if (typeof showToast === 'function') showToast('Migration ล้มเหลว: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore';
      }
    };
    btn.textContent = '☁️ อัพข้อมูลเก่าขึ้น Firestore';
    parent.appendChild(btn);
  }
}

// Initialize HISTORICAL_DATA dropdown and display
function initHistoricalDataDisplay() {
  const historicalData = (typeof HistoricalDataStore !== 'undefined')
    ? HistoricalDataStore.getAll()
    : JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const yearSelect = document.getElementById('historicalDataYearSelect');
  const displayDiv = document.getElementById('historicalDataDisplay');

  if (!yearSelect) return;

  if (Object.keys(historicalData).length === 0) {
    displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">ยังไม่มีข้อมูลบิล - โปรดอัพโหลดไฟล์บิล Excel</p>';
    yearSelect.disabled = true;
    return;
  }

  yearSelect.disabled = false;

  // Phase 2c: Cloud migration button (visible if any year only in localStorage)
  _renderHistoricalCloudMigrateButton(historicalData);

  // Auto-rerender on cloud updates
  if (typeof HistoricalDataStore !== 'undefined' && !window._histStoreSubscribed) {
    window._histStoreSubscribed = true;
    HistoricalDataStore.onChange(() => {
      try { initHistoricalDataDisplay(); } catch(e){}
    });
  }

  // Populate dropdown with available years (sorted descending)
  const years = Object.keys(historicalData).sort((a, b) => parseInt(b) - parseInt(a));

  // Clear existing options (except the placeholder)
  while (yearSelect.options.length > 1) {
    yearSelect.remove(1);
  }

  // Add year options (Buddhist year format only)
  years.forEach(year => {
    const buddhistYear = 2500 + parseInt(year);
    const option = document.createElement('option');
    option.value = year;
    option.textContent = buddhistYear.toString(); // Just show Buddhist year number
    yearSelect.appendChild(option);
  });

  // Select first year by default
  if (years.length > 0) {
    yearSelect.value = years[0];
    displayHistoricalDataForYear(years[0]);
  }

  // Add change event listener
  yearSelect.addEventListener('change', function() {
    if (this.value) {
      displayHistoricalDataForYear(this.value);
    } else {
      displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">โปรดเลือกปีที่ต้องการดู</p>';
    }
  });
}

// Display data for a specific year
function displayHistoricalDataForYear(year) {
  const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
  const displayDiv = document.getElementById('historicalDataDisplay');

  if (!historicalData[year]) {
    displayDiv.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">ไม่พบข้อมูลสำหรับปีนี้</p>';
    return;
  }

  const yearData = historicalData[year];
  const yearLabel = yearData.label || `ปี ${2500 + parseInt(year)} (${year})`;
  const months = yearData.months || [];

  let html = '<div style="font-family:\'Sarabun\',sans-serif;font-size:0.9rem;overflow-x:auto;">';
  html += `<table style="width:100%;border-collapse:collapse;">`;
  html += `<thead>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.8rem;text-align:left;border-right:1px solid var(--border);rowspan:2;">เดือน</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};color:${DashColors.GREEN_DEEP};font-weight:700;">🏠 Rooms</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};color:#4a148c;font-weight:700;">🏢 Nest</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};color:#f57f17;font-weight:700;">📦 Amazon</th>
      <th style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">รวม</th>
    </tr>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.2rem;border-right:1px solid var(--border);"></th>
      <th class="dx-th-rooms">เช่า</th>
      <th class="dx-th-rooms">ไฟ</th>
      <th class="dx-th-rooms">น้ำ</th>
      <th class="dx-th-rooms">ขยะ</th>
      <th class="dx-th-rooms">รวม</th>
      <th class="dx-th-nest">เช่า</th>
      <th class="dx-th-nest">ไฟ</th>
      <th class="dx-th-nest">น้ำ</th>
      <th class="dx-th-nest">ขยะ</th>
      <th class="dx-th-nest">รวม</th>
      <th class="dx-th-amazon">เช่า</th>
      <th class="dx-th-amazon">ไฟ</th>
      <th class="dx-th-amazon">น้ำ</th>
      <th class="dx-th-amazon">ขยะ</th>
      <th class="dx-th-amazon">รวม</th>
      <th style="padding:0.2rem;text-align:right;font-size:0.8rem;color:var(--green);font-weight:700;">รวม</th>
    </tr>
  </thead>`;
  html += `<tbody>`;

  let totalRent = 0, totalElec = 0, totalWater = 0, totalAll = 0;
  let totalRoomsRent = 0, totalRoomsElec = 0, totalRoomsWater = 0, totalRoomsAll = 0;
  let totalNestRent = 0, totalNestElec = 0, totalNestWater = 0, totalNestAll = 0;
  let totalAmazonRent = 0, totalAmazonElec = 0, totalAmazonWater = 0, totalAmazonAll = 0;

  months.forEach((month, idx) => {
    if (!month) {
      html += `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:0.8rem;color:var(--text-muted);border-right:1px solid var(--border);">เดือน ${idx + 1}</td>
                <td colspan="8" style="padding:0.8rem;text-align:center;color:var(--text-muted);font-style:italic;">ไม่มีข้อมูล</td>
              </tr>`;
      return;
    }

    // Support both old format (array) and new format (object with total/rooms/nest)
    let rent, elec, water, trash, total, roomsData, nestData;
    if (Array.isArray(month)) {
      // Old format: [rent, elec, water, total] or new format: [rent, elec, water, trash, total]
      if (month.length >= 5) {
        [rent, elec, water, trash, total] = month;
      } else {
        [rent, elec, water, total] = month;
        trash = 0;
      }
      roomsData = [0, 0, 0, 0, 0];
      nestData = [0, 0, 0, 0, 0];
    } else {
      // New format: { total: [...], rooms: [...], nest: [...], amazon: [...] }
      const totalArr = month.total || [0, 0, 0, 0, 0];
      if (totalArr.length >= 5) {
        [rent, elec, water, trash, total] = totalArr;
      } else {
        [rent, elec, water, total] = totalArr;
        trash = 0;
      }
      roomsData = month.rooms || [0, 0, 0, 0, 0];
      nestData = month.nest || [0, 0, 0, 0, 0];
      var amazonData = month.amazon || [0, 0, 0, 0, 0];
    }

    totalRent += rent || 0;
    totalElec += elec || 0;
    totalWater += water || 0;
    totalAll += total || 0;
    totalRoomsRent += roomsData[0] || 0;
    totalRoomsElec += roomsData[1] || 0;
    totalRoomsWater += roomsData[2] || 0;
    totalRoomsAll += roomsData[4] || 0;
    totalNestRent += nestData[0] || 0;
    totalNestElec += nestData[1] || 0;
    totalNestWater += nestData[2] || 0;
    totalNestAll += nestData[4] || 0;
    totalAmazonRent += amazonData[0] || 0;
    totalAmazonElec += amazonData[1] || 0;
    totalAmazonWater += amazonData[2] || 0;
    totalAmazonAll += amazonData[4] || 0;

    const monthNames = ['มค.', 'กพ.', 'มีค.', 'เมย.', 'พค.', 'มิย.', 'กค.', 'สค.', 'กย.', 'ตค.', 'พย.', 'ธค.'];
    const monthName = monthNames[idx] || `เดือน ${idx + 1}`;

    html += `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:0.8rem;border-right:1px solid var(--border);font-weight:600;">${monthName}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.GREEN_BG};">฿${(roomsData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.GREEN_BG};">฿${(roomsData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.GREEN_BG};">฿${(roomsData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.GREEN_BG};">฿${(roomsData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.GREEN_BG};color:#2d8653;font-weight:600;">฿${(roomsData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.PURPLE_BG};">฿${(nestData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.PURPLE_BG};">฿${(nestData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.PURPLE_BG};">฿${(nestData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.PURPLE_BG};">฿${(nestData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.PURPLE_BG};color:#7b1fa2;font-weight:600;">฿${(nestData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.YELLOW_BG};">฿${(amazonData[0] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.YELLOW_BG};">฿${(amazonData[1] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.YELLOW_BG};">฿${(amazonData[2] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.YELLOW_BG};">฿${(amazonData[3] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);font-size:0.9rem;background:${DashColors.YELLOW_BG};color:#f57f17;font-weight:600;">฿${(amazonData[4] || 0).toLocaleString()}</td>
              <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${(total || 0).toLocaleString()}</td>
            </tr>`;
  });

  // Calculate trash totals for rooms, nest, and amazon
  let totalRoomsTrash = 0, totalNestTrash = 0, totalAmazonTrash = 0;
  months.forEach(month => {
    if (month) {
      if (Array.isArray(month)) {
        if (month.length >= 5) {
          totalRoomsTrash += month[3] || 0; // This logic needs review
        }
      } else {
        const rd = month.rooms || [];
        const nd = month.nest || [];
        const ad = month.amazon || [];
        totalRoomsTrash += rd[3] || 0;
        totalNestTrash += nd[3] || 0;
        totalAmazonTrash += ad[3] || 0;
      }
    }
  });

  html += `<tr style="font-weight:700;border-bottom:2px solid var(--green);">
            <td style="padding:0.8rem;border-right:1px solid var(--border);">รวมทั้งสิ้น</td>
            <td class="dx-td-rooms">฿${totalRoomsRent.toLocaleString()}</td>
            <td class="dx-td-rooms">฿${totalRoomsElec.toLocaleString()}</td>
            <td class="dx-td-rooms">฿${totalRoomsWater.toLocaleString()}</td>
            <td class="dx-td-rooms">฿${totalRoomsTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};color:#2d8653;font-weight:700;">฿${totalRoomsAll.toLocaleString()}</td>
            <td class="dx-td-nest">฿${totalNestRent.toLocaleString()}</td>
            <td class="dx-td-nest">฿${totalNestElec.toLocaleString()}</td>
            <td class="dx-td-nest">฿${totalNestWater.toLocaleString()}</td>
            <td class="dx-td-nest">฿${totalNestTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};color:#7b1fa2;font-weight:700;">฿${totalNestAll.toLocaleString()}</td>
            <td class="dx-td-amazon">฿${totalAmazonRent.toLocaleString()}</td>
            <td class="dx-td-amazon">฿${totalAmazonElec.toLocaleString()}</td>
            <td class="dx-td-amazon">฿${totalAmazonWater.toLocaleString()}</td>
            <td class="dx-td-amazon">฿${totalAmazonTrash.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};color:#f57f17;font-weight:700;">฿${totalAmazonAll.toLocaleString()}</td>
            <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${totalAll.toLocaleString()}</td>
          </tr>`;

  html += `</tbody></table>`;
  html += '</div>';
  displayDiv.innerHTML = html;
}

// Initialize display on page load and when switching tabs
document.addEventListener('DOMContentLoaded', function() {
  // Initialize when page loads if on billing import tab
  const billingContent = document.getElementById('meter-import-billing-content');
  if (billingContent && !billingContent.classList.contains('u-hidden')) {
    setTimeout(initHistoricalDataDisplay, 100);
  }
});

// Hook into tab switching to refresh display
if (window.switchMeterTab) {
  const originalSwitchTab = window.switchMeterTab;
  window.switchMeterTab = function(tab, btn) {
    originalSwitchTab.call(window, tab, btn);
    if (tab === 'import-billing') {
      setTimeout(initHistoricalDataDisplay, 100);
    }
  };
}
