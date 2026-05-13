/**
 * BuildingRegistry — client-side dynamic building list, loaded from Firestore.
 *
 * Unlocks multi-property support: admin creates `buildings/{id}` doc via the
 * Buildings UI → BuildingRegistry picks it up on next refresh → dashboard
 * selectors render it automatically. CFs validate against the same collection
 * (see functions/buildingRegistry.js).
 *
 * Loads after building-config.js. Depends on window.firebase.firestore()
 * being initialized.
 *
 * Schema for `buildings/{id}` root doc:
 *   { displayName, address, promptPayId, contact, status, createdAt, createdBy }
 *
 * Usage:
 *   await BuildingRegistry.init();                     // fetch from Firestore
 *   BuildingRegistry.list();                           // [{id, displayName, ...}, ...]
 *   BuildingRegistry.getById('rooms');                 // {id, displayName, ...} or null
 *   await BuildingRegistry.refresh();                  // force re-fetch
 *
 * Fallback: if Firestore unavailable or collection empty, returns the legacy
 * hardcoded ['rooms', 'nest'] from BuildingConfig so the UI keeps working
 * during initial seeding.
 */
(function() {
  'use strict';

  const FALLBACK = [
    { id: 'rooms', displayName: 'Nature Haven', status: 'active', _fallback: true },
    { id: 'nest',  displayName: 'Nature Nest',  status: 'active', _fallback: true }
  ];

  let _cache = null;
  let _lastFetch = 0;
  const STALE_MS = 60_000;

  function _hasFirestore() {
    return !!(window.firebase?.firestore && window.firebase?.firestoreFunctions);
  }

  async function _fetch() {
    if (!_hasFirestore()) return FALLBACK.slice();
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    try {
      const snap = await fs.getDocs(fs.collection(db, 'buildings'));
      const byCanonical = new Map();
      snap.forEach(doc => {
        const data = doc.data() || {};
        if (data.status && data.status !== 'active') return;
        // Normalize legacy Firestore doc IDs (e.g. 'RentRoom' → 'rooms') so the
        // registry presents canonical IDs everywhere. Multiple legacy docs that
        // alias to the same canonical merge into one entry (first-wins, with
        // displayName preferring a value that isn't the raw doc ID).
        const canonical = (window.BuildingConfig?.normalizeId?.(doc.id)) || doc.id;
        const legacyDocId = doc.id !== canonical ? doc.id : null;
        // Prefer Firestore displayName, but treat a value that equals the raw
        // doc ID as a placeholder (legacy `saveBuildingPaymentConfig` auto-
        // filled `displayName: doc.id` for 'nest' and 'RentRoom'). Fall back to
        // BuildingConfig's human-readable name in that case.
        const rawName = (data.displayName || data.name || '').trim();
        const isPlaceholder = !rawName || rawName === doc.id;
        const displayName = isPlaceholder
          ? ((window.BuildingConfig?.getDisplayName?.(canonical)) || canonical)
          : rawName;
        const entry = {
          id: canonical,
          legacyDocId,
          displayName,
          address: data.address || '',
          promptPayId: data.promptPayId || data.promptpayNumber || '',
          contact: data.contact || '',
          companyName: data.companyName || '',
          ownerName: data.ownerName || '',
          status: data.status || 'active',
          createdAt: data.createdAt || null,
          createdBy: data.createdBy || null
        };
        const existing = byCanonical.get(canonical);
        if (!existing) byCanonical.set(canonical, entry);
        else if (existing.legacyDocId && !entry.legacyDocId) byCanonical.set(canonical, entry);
      });
      const list = Array.from(byCanonical.values());
      if (list.length === 0) return FALLBACK.slice();
      list.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'th'));
      return list;
    } catch (err) {
      console.warn('[BuildingRegistry] fetch failed, using fallback:', err?.message || err);
      return FALLBACK.slice();
    }
  }

  async function init() {
    if (_cache) return _cache;
    _cache = await _fetch();
    _lastFetch = Date.now();
    return _cache;
  }

  async function refresh() {
    _cache = await _fetch();
    _lastFetch = Date.now();
    try {
      window.dispatchEvent(new CustomEvent('buildingRegistryChanged', { detail: { list: _cache } }));
    } catch (_) { /* ignore */ }
    return _cache;
  }

  function list() {
    return (_cache || FALLBACK).slice();
  }

  function getById(id) {
    if (!id) return null;
    const canonical = window.BuildingConfig?.normalizeId?.(id) || id;
    const src = _cache || FALLBACK;
    return src.find(b => b.id === canonical) || null;
  }

  function isStale() {
    return !_cache || (Date.now() - _lastFetch) > STALE_MS;
  }

  async function create({ id, displayName, address, promptPayId, contact, companyName, ownerName }) {
    if (!_hasFirestore()) throw new Error('Firestore unavailable');
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    const slug = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!slug) throw new Error('id ว่าง (slug)');
    if (!displayName) throw new Error('displayName ว่าง');
    const ref = fs.doc(db, 'buildings', slug);
    const existing = await fs.getDoc(ref);
    if (existing.exists()) throw new Error(`buildings/${slug} มีอยู่แล้ว`);
    const uid = window.firebase.auth?.()?.currentUser?.uid || null;
    await fs.setDoc(ref, {
      displayName: String(displayName).trim(),
      address: address || '',
      promptPayId: promptPayId || '',
      contact: contact || '',
      companyName: companyName || '',
      ownerName: ownerName || '',
      status: 'active',
      createdAt: fs.serverTimestamp(),
      createdBy: uid
    });
    await refresh();
    return slug;
  }

  async function update(id, patch) {
    if (!_hasFirestore()) throw new Error('Firestore unavailable');
    if (!id) throw new Error('id ว่าง');
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    // If the entry came from a legacy doc (e.g. 'RentRoom'), write to that
    // exact path — otherwise canonical 'rooms' would create a duplicate doc.
    const entry = getById(id);
    const docId = entry?.legacyDocId || id;
    const ref = fs.doc(db, 'buildings', docId);
    const allowed = ['displayName', 'address', 'promptPayId', 'contact', 'companyName', 'ownerName', 'status'];
    const clean = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    }
    if (Object.keys(clean).length === 0) return;
    await fs.setDoc(ref, clean, { merge: true });
    await refresh();
  }

  async function archive(id) {
    return update(id, { status: 'archived' });
  }

  window.BuildingRegistry = {
    init,
    refresh,
    list,
    getById,
    isStale,
    create,
    update,
    archive,
    FALLBACK
  };
})();
