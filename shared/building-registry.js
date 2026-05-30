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
 * Schema for `buildings/{id}` root doc (signed-in readable):
 *   { displayName, promptPayId, companyName, ownerName, status, createdAt,
 *     createdBy, ownerUid }
 *
 * Schema for `buildings/{id}/private/admin` subdoc (admin-only readable, P4.4 2026-05-23):
 *   { address, contact, ownerEmail }
 *
 * Why the split: top-level used to also store address/contact/ownerEmail,
 * but `match /buildings/{id} { allow read: if isSignedIn() }` leaks them to
 * every signed-in user including anonymous booking prospects. P4.4 moved
 * the sensitive subset to the admin-only `private/admin` subdoc.
 * Migration: tools/migrate-buildings-private.js (one-shot, gated by --apply).
 *
 * Usage:
 *   await BuildingRegistry.init();                     // fetch from Firestore
 *   BuildingRegistry.list();                           // [{id, displayName, ...}, ...]
 *                                                       // admin context: includes
 *                                                       // address/contact/ownerEmail.
 *                                                       // non-admin: those fields blank.
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
  // P4.4: only attempt the admin-only private subdoc read when the caller
  // is admin (sets isAdmin claim). For tenants the read would always
  // permission_denied; avoiding it keeps console clean and saves a wasted
  // round-trip per building.
  let _isAdminContext = null; // null = not yet checked, true/false once resolved

  function _hasFirestore() {
    return !!(window.firebase?.firestore && window.firebase?.firestoreFunctions);
  }

  async function _resolveAdminContext() {
    try {
      const auth = window.firebase?.auth?.();
      const user = auth?.currentUser;
      if (!user) return false;
      // Use cached token by default — admin claim doesn't rotate often,
      // and a force-refresh on every BuildingRegistry init would be too costly.
      const result = await user.getIdTokenResult();
      return !!result?.claims?.admin;
    } catch (_) {
      return false;
    }
  }

  async function _fetch() {
    if (!_hasFirestore()) return FALLBACK.slice();
    const db = window.firebase.firestore();
    const fs = window.firebase.firestoreFunctions;
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'buildings'), fs.limit(100)));
      const byCanonical = new Map();
      const docIdsForPrivate = [];
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
        // doc ID as a placeholder (a now-removed legacy admin UI auto-filled
        // `displayName: doc.id` for 'nest' and 'RentRoom' before Tier 3F).
        // Fall back to BuildingConfig's human-readable name in that case.
        const rawName = (data.displayName || data.name || '').trim();
        const isPlaceholder = !rawName || rawName === doc.id;
        const displayName = isPlaceholder
          ? ((window.BuildingConfig?.getDisplayName?.(canonical)) || canonical)
          : rawName;
        const entry = {
          id: canonical,
          legacyDocId,
          displayName,
          // Fallback to legacy top-level fields for pre-P4.4 docs. Once the
          // migration runs these will be empty here and live in private/admin
          // for admin contexts.
          address: data.address || '',
          promptPayId: data.promptPayId || '',
          contact: data.contact || '',
          companyName: data.companyName || '',
          ownerName: data.ownerName || '',
          ownerEmail: data.ownerEmail || '',
          status: data.status || 'active',
          createdAt: data.createdAt || null,
          createdBy: data.createdBy || null,
          _docId: doc.id  // for private subdoc lookup
        };
        const existing = byCanonical.get(canonical);
        if (!existing) {
          byCanonical.set(canonical, entry);
          docIdsForPrivate.push(doc.id);
        }
        else if (existing.legacyDocId && !entry.legacyDocId) {
          byCanonical.set(canonical, entry);
          // Replace docId in the private-lookup list too
          const idx = docIdsForPrivate.indexOf(existing._docId);
          if (idx !== -1) docIdsForPrivate[idx] = doc.id;
        }
      });

      // Admin-only enrichment: fetch private/admin subdoc for each building
      // and merge into the entry. Non-admins skip — the rule would deny.
      if (_isAdminContext === null) _isAdminContext = await _resolveAdminContext();
      if (_isAdminContext) {
        await Promise.all(docIdsForPrivate.map(async docId => {
          try {
            const privRef = fs.doc(db, 'buildings', docId, 'private', 'admin');
            const privSnap = await fs.getDoc(privRef);
            if (!privSnap.exists()) return;
            const priv = privSnap.data() || {};
            // Find the entry for this docId and merge
            for (const entry of byCanonical.values()) {
              if (entry._docId === docId) {
                if (priv.address) entry.address = priv.address;
                if (priv.contact) entry.contact = priv.contact;
                if (priv.ownerEmail) entry.ownerEmail = priv.ownerEmail;
                break;
              }
            }
          } catch (e) {
            // permission_denied / not-found / network — non-fatal
            if (e?.code !== 'permission-denied') {
              console.warn('[BuildingRegistry] private subdoc read failed for', docId, e?.message || e);
            }
          }
        }));
      }

      // Strip _docId before returning (internal-only field)
      const list = Array.from(byCanonical.values()).map(e => {
        const { _docId, ...rest } = e;
        return rest;
      });
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

  // P4.4: split write paths. Top-level fields are signed-in-readable;
  // private fields go in buildings/{id}/private/admin (admin-only).
  const PUBLIC_FIELDS  = ['displayName', 'promptPayId', 'companyName', 'ownerName', 'status'];
  const PRIVATE_FIELDS = ['address', 'contact', 'ownerEmail'];

  async function create({ id, displayName, address, promptPayId, contact, companyName, ownerName, ownerEmail }) {
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

    // Top-level: public-readable fields only
    await fs.setDoc(ref, {
      displayName: String(displayName).trim(),
      promptPayId: promptPayId || '',
      companyName: companyName || '',
      ownerName: ownerName || '',
      status: 'active',
      createdAt: fs.serverTimestamp(),
      createdBy: uid
    });

    // Private subdoc: admin-only fields. Only write if at least one is set
    // (avoids creating empty private/admin docs on minimal building seeds).
    const privPayload = {};
    if (address) privPayload.address = String(address);
    if (contact) privPayload.contact = String(contact);
    if (ownerEmail) privPayload.ownerEmail = String(ownerEmail);
    if (Object.keys(privPayload).length > 0) {
      const privRef = fs.doc(db, 'buildings', slug, 'private', 'admin');
      await fs.setDoc(privRef, { ...privPayload, updatedAt: fs.serverTimestamp() });
    }

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

    // Split patch into public (top-level) vs private (subdoc)
    const publicPatch = {};
    for (const k of PUBLIC_FIELDS) {
      if (patch[k] !== undefined) publicPatch[k] = patch[k];
    }
    const privatePatch = {};
    for (const k of PRIVATE_FIELDS) {
      if (patch[k] !== undefined) privatePatch[k] = patch[k];
    }

    if (Object.keys(publicPatch).length > 0) {
      const ref = fs.doc(db, 'buildings', docId);
      await fs.setDoc(ref, publicPatch, { merge: true });
    }
    if (Object.keys(privatePatch).length > 0) {
      const privRef = fs.doc(db, 'buildings', docId, 'private', 'admin');
      await fs.setDoc(privRef, { ...privatePatch, updatedAt: fs.serverTimestamp() }, { merge: true });
    }

    if (Object.keys(publicPatch).length === 0 && Object.keys(privatePatch).length === 0) return;
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
