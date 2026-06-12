/*
 * Pet Social Graph — tenant directory + friend UI (Meaning Layer #10, PR2).
 *
 * The frontend for the PR1 server (petProfiles/{petId} + petLinks/{linkId} + the
 * 4 callables upsertPetProfile / requestPetLink / respondPetLink / removePetLink).
 * A tenant opts a pet INTO the building-visible directory, browses neighbours'
 * opted-in pets, and sends / answers / removes pet↔pet friend requests.
 *
 * Three live sources, all building-scoped (single-field where building== → no
 * composite index, §7-J/N-safe):
 *   - petProfiles (onSnapshot)  → every PUBLIC pet in the building (incl. own).
 *   - petLinks    (onSnapshot)  → every friend edge touching the building.
 *   - own pets    (getDocs, on open) → the tenant's pets in tenants/{b}/list/{r}/pets,
 *                                  to offer the publish toggle (publish-state comes
 *                                  from the live petProfiles cache, cross-ref by id).
 *
 * Privacy: the directory only ever READS the safe-field mirror petProfiles
 * (name/type/breed/gender/age/photo/bio + room). healthLog / vaccine / status
 * never reach this collection (PR1 PROFILE_SAFE_FIELDS). PUBLISHING a pet is a
 * PDPA §19 disclosure → gated behind an explicit pet_profile_v1 consent (mirrors
 * tenant-kindness.js): localStorage fast-path + a server ledger row written by
 * recordChecklistConsent. The CF ALSO enforces the consent server-side, so this
 * gate is graceful-UX, never the security boundary. BROWSING / answering needs
 * no consent (reading others' opted-in profiles is not a disclosure of yours).
 *
 * Anti-patterns honoured: §7-A/U/BB self-wire via _onLiffClaimsReady + the
 * _tenantAppBuilding/_tenantAppRoom globals (never the phantom _liffClaims), claim
 * guard before the first read · §7-N onSnapshot error callback that resets the
 * unsub so a later claims-ready fire retries · §7-V unsub-before-rebind on a
 * building change · §7-X every render path writes non-empty content · §7-FFF
 * "mine vs others" buckets by ROOM identity (ownerRoom), not auth uid · §7-RR all
 * styling is static .pet-dir-* in components.css (never an injected <style>) ·
 * §7-I tenant-initiated only (no programmatic .click) · escaping on every piece
 * of user text ([[feedback_modal_security]]) · window.* exports (§7-QQ/CC).
 *
 * Pure helpers (buildLinkId / linkStatusFor / isOwnProfile / sanitizeBio) are
 * exported on window.PetSocial for unit tests (shared/__tests__/tenant-pet-social.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-pet-social.test.js
 */
(function () {
  'use strict';

  var MAX_BIO_LEN = 160;          // mirrors functions/_petSocialEngine.js
  var LS_CONSENT = 'pet_profile_consent_v1';
  var NOTICE_VERSION = 'v1';
  var PRIVACY_URL = '/privacy.html';

  // ── PURE helpers (tested; safe in the node test realm) ──────────────────────

  /** Trim + length-cap an owner-written bio. Mirrors the engine sanitizeBio. */
  function sanitizeBio(t) {
    return String(t == null ? '' : t).trim().slice(0, MAX_BIO_LEN);
  }

  /**
   * Deterministic edge id for two pets — sorted so A→B and B→A collapse to ONE
   * doc. Mirrors functions/_petSocialEngine.js buildLinkId exactly so the client
   * looks up the same doc the CF writes.
   * @returns {string} `${min}_${max}` by string order
   */
  function buildLinkId(petIdA, petIdB) {
    var a = String(petIdA == null ? '' : petIdA);
    var b = String(petIdB == null ? '' : petIdB);
    if (!a || !b) return '';
    return a < b ? a + '_' + b : b + '_' + a;
  }

  /**
   * §7-FFF own-filter: is this public profile one of MY room's pets? Buckets by
   * ROOM identity (ownerRoom), never auth uid — correct for real tenants, admin
   * preview, and before the auth uid loads.
   */
  function isOwnProfile(profile, myRoom) {
    return !!profile && String(profile.ownerRoom) === String(myRoom);
  }

  /**
   * Classify the friend edge between MY acting pet and a neighbour pet, from the
   * caller's room perspective. Pure — drives which button a neighbour card shows.
   * @param {Object|null} link the petLinks doc (or null when no edge exists)
   * @param {string} myRoom the caller's room
   * @returns {'none'|'outgoing'|'incoming'|'friends'|'declined'}
   */
  function linkStatusFor(link, myRoom) {
    if (!link) return 'none';
    var s = link.status;
    if (s === 'accepted') return 'friends';
    if (s === 'declined') return 'declined';   // a fresh request is allowed again
    if (s === 'pending') {
      // outgoing if I'm the requester, incoming if I'm the recipient.
      return String(link.requesterRoom) === String(myRoom) ? 'outgoing' : 'incoming';
    }
    return 'none';
  }

  // ── browser-only state + helpers (skipped under node --test) ────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { sanitizeBio: sanitizeBio, buildLinkId: buildLinkId, isOwnProfile: isOwnProfile, linkStatusFor: linkStatusFor };
    }
    return;
  }

  var LIST_ID = 'pet-directory-list';

  var _profilesUnsub = null;      // petLinks/petProfiles unsubs (§7-V)
  var _linksUnsub = null;
  var _subKey = '';               // building the subs are bound to (rebind on change)
  var _profiles = [];             // live petProfiles in the building
  var _links = [];                // live petLinks in the building
  var _ownPets = [];              // tenant's own pets (getDocs on open)
  var _ownLoaded = false;
  var _tenantId = '';             // canonical tenants/{b}/list/{r}.tenantId (consent id)
  var _actingPetId = '';          // which own published pet acts in the browse list
  var _pendingConsentPetId = '';  // a publish awaiting the consent step
  var _pendingPublishBio = '';    // bio captured at click, carried across the consent re-render
  var _busy = {};                 // id -> true while a callable is in flight

  function _fs() { var f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { var f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _fns() { var f = window.firebase; return f && f.functions; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _ready() { return !!(_bldg() && _room() && _fs() && _db()); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }

  // HttpsError messages from the CFs are user-friendly Thai — surface them, but
  // fall back for the opaque transport codes (mirrors the sibling boards).
  function _errMsg(e, fallback) {
    var code = String((e && e.code) || '');
    var msg = String((e && e.message) || '');
    return (/internal|unknown|unavailable|deadline/i.test(code) || !msg) ? fallback : msg;
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Consent is PER-TENANT (the server doc is consents/{tenantId}_pet_profile_v1), so the
  // local "already consented" shortcut MUST be keyed by tenantId too. A device-global key
  // leaked across tenants: tenant A consents on a device → tenant B (same device, e.g. owner
  // testing a 2nd room) skipped the consent step → upsertPetProfile's server gate rejected the
  // publish (failed-precondition "ต้องยินยอมก่อนแสดง…"). Empty tenantId → not-consented (fall
  // through to the server check + opt-in step). §7-LLL family (local consent state ≠ server).
  function _consentKey() { return LS_CONSENT + '_' + _tenantId; }
  function _consentedLocally() { try { return !!_tenantId && localStorage.getItem(_consentKey()) === '1'; } catch (_) { return false; } }
  function _rememberConsent() { try { if (_tenantId) localStorage.setItem(_consentKey(), '1'); } catch (_) { /* storage off */ } }

  // Reading a non-existent consents/{id} throws permission-denied (the rule needs
  // resource.data) → treat ANY failure as "not consented yet" (§7-N: not an error,
  // just show the opt-in step).
  async function _serverConsentExists(tenantId) {
    var fs = _fs(); var db = _db();
    if (!fs || !db || !tenantId) return false;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'consents', tenantId + '_pet_profile_v1'));
      return !!(snap && snap.exists());
    } catch (_) { return false; }
  }

  // Open the privacy notice in the LINE in-app browser (external:false) so the
  // tenant STAYS inside LINE and closes back to this LIFF. external:true opened
  // the OS browser (Safari), leaving LIFF — and a standalone privacy.html load
  // there bounced "back" to /login (no LIFF auth). In-app keeps the context.
  function _lineSafeOpen(url) {
    try {
      if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
        liff.openWindow({ url: url, external: false });
        return;
      }
    } catch (_) { /* fall through */ }
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* noop */ }
  }

  // ── live subscriptions (claims-ready, §7-A/U/V) ─────────────────────────────
  function _subscribe() {
    if (!_ready()) return;                          // §7-U: claim-presence guard
    var b = _bldg();
    if ((_profilesUnsub || _linksUnsub) && _subKey === b) return;  // §7-V idempotent
    // building changed (or first run) → tear down stale subs before rebinding.
    _teardown();
    var fs = _fs(); var db = _db();
    _subKey = b;
    try {
      var pq = fs.query(fs.collection(db, 'petProfiles'), fs.where('building', '==', b));
      _profilesUnsub = fs.onSnapshot(pq, function (snap) {
        _profiles = snap.docs.map(function (d) { return Object.assign({ petId: d.id }, d.data()); });
        _applyPendingProfiles();   // §7-KK: hold optimistic saves until the server snapshot confirms them
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-social] profiles sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _profilesUnsub = null; _subKey = ''; }
      });

      var lq = fs.query(fs.collection(db, 'petLinks'), fs.where('building', '==', b));
      _linksUnsub = fs.onSnapshot(lq, function (snap) {
        _links = snap.docs.map(function (d) { return Object.assign({ linkId: d.id }, d.data()); });
        _applyPendingLinks(snap.metadata && snap.metadata.fromCache);   // §7-KK: trust server snapshots, bridge only on cache
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-social] links sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _linksUnsub = null; _subKey = ''; }
      });
    } catch (e) {
      console.warn('[pet-social] subscribe init failed:', e && e.message || e);
    }
  }

  function _teardown() {
    if (_profilesUnsub) { try { _profilesUnsub(); } catch (_) {} _profilesUnsub = null; }
    if (_linksUnsub) { try { _linksUnsub(); } catch (_) {} _linksUnsub = null; }
  }

  // Own pets (+ canonical tenantId) — read once per open; cheap getDocs, not a
  // 4th live sub. Publish-state is derived live from _profiles, so this only needs
  // the pet roster (which rarely changes mid-session).
  async function _loadOwn() {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return;
    var b = _bldg(); var r = _room();
    try {
      var rosterSnap = await fs.getDoc(fs.doc(db, 'tenants', b, 'list', r));
      _tenantId = (rosterSnap && rosterSnap.exists()) ? String((rosterSnap.data() || {}).tenantId || '') : '';
    } catch (_) { /* permission pre-link — quiet (§7-N) */ }
    try {
      var petsSnap = await fs.getDocs(fs.collection(db, 'tenants', b, 'list', r, 'pets'));
      _ownPets = petsSnap.docs.map(function (d) { return Object.assign({ petId: d.id }, d.data()); });
      _ownLoaded = true;
    } catch (e) {
      if (!/permission/i.test((e && e.message) || '')) console.warn('[pet-social] own-pets read failed:', e && e.message);
    }
  }

  // ── derived selectors ───────────────────────────────────────────────────────
  function _profileById(petId) {
    for (var i = 0; i < _profiles.length; i++) if (String(_profiles[i].petId) === String(petId)) return _profiles[i];
    return null;
  }
  function _ownPetById(petId) {
    for (var i = 0; i < _ownPets.length; i++) if (String(_ownPets[i].petId) === String(petId)) return _ownPets[i];
    return null;
  }
  function _isPublished(petId) { return !!_profileById(petId); }
  // My published pets — the candidates that can act / be friended in the browse list.
  function _myPublishedPets() {
    return _ownPets.filter(function (p) { return _isPublished(p.petId); });
  }
  // The pet that "acts" in the browse list (request/answer as). Defaults to the
  // first published own pet; survives re-render unless it stops being published.
  function _acting() {
    var pub = _myPublishedPets();
    if (!pub.length) { _actingPetId = ''; return null; }
    var found = _actingPetId && pub.filter(function (p) { return String(p.petId) === String(_actingPetId); })[0];
    if (!found) { _actingPetId = String(pub[0].petId); found = pub[0]; }
    return found;
  }
  function _linkBetween(petA, petB) {
    var id = buildLinkId(petA, petB);
    if (!id) return null;
    for (var i = 0; i < _links.length; i++) if (String(_links[i].linkId) === id) return _links[i];
    return null;
  }
  // Incoming pending requests addressed to MY room (answer in Section B).
  function _incoming() {
    var r = _room();
    return _links.filter(function (l) { return l.status === 'pending' && String(l.recipientRoom) === r; });
  }

  // ── optimistic publish cache (§7-KK) ────────────────────────────────────────
  // upsertPetProfile writes petProfiles/{petId} SERVER-side (a CF), so it gets NO
  // client latency compensation — the onSnapshot above lags the callable by up to
  // a few seconds. Without this, the _render() right after a successful save reads
  // the STALE _profiles cache → a just-published pet shows its old/unpublished
  // state (empty textarea, "แสดงในไดเรกทอรี") even though the save succeeded, so
  // the owner thinks nothing happened and saves again ("save twice"). We reflect
  // the result locally on success and HOLD it (via _pendingPub) until a server
  // snapshot confirms it — so a stale/concurrent snapshot can't revert it
  // mid-flight, and the authoritative snapshot clears the pending entry.
  var _pendingPub = {};   // petId -> optimistic profile (publish) | null (unpublish)

  function _upsertLocalProfile(profile) {
    for (var i = 0; i < _profiles.length; i++) {
      if (String(_profiles[i].petId) === String(profile.petId)) { _profiles[i] = profile; return; }
    }
    _profiles = _profiles.concat([profile]);
  }
  function _removeLocalProfile(petId) {
    _profiles = _profiles.filter(function (p) { return String(p.petId) !== String(petId); });
  }

  // Build the optimistic public profile from the own-pet doc + the new bio,
  // mirroring the CF payload shape (empty bio → null, exactly as the CF stores it).
  // The own section renders name/type from _ownPets, so bio + existence are what
  // actually drive the post-save view; the rest is carried for completeness.
  function _optimisticProfile(petId, bio) {
    var pet = _ownPetById(petId) || {};
    return {
      petId: String(petId), building: _bldg(), ownerRoom: _room(), ownerTenantId: _tenantId,
      name: pet.name, type: pet.type, typeEmoji: pet.typeEmoji, breed: pet.breed,
      gender: pet.gender, age: pet.age, photoURL: pet.photoURL,
      bio: (bio == null || bio === '') ? null : bio,
    };
  }

  function _applyOptimisticPublish(petId, bio) {
    var prof = _optimisticProfile(petId, bio);
    _pendingPub[String(petId)] = prof;
    _upsertLocalProfile(prof);
  }
  function _applyOptimisticUnpublish(petId) {
    _pendingPub[String(petId)] = null;
    _removeLocalProfile(petId);
  }

  // Re-apply each un-confirmed optimistic result after a fresh server snapshot,
  // dropping it once the server agrees (bio matches / doc gone). Guards the just-
  // saved state from flickering back on a stale or unrelated petProfiles snapshot.
  function _applyPendingProfiles() {
    Object.keys(_pendingPub).forEach(function (pid) {
      var pending = _pendingPub[pid];
      var server = _profileById(pid);
      if (pending === null) {
        if (!server) { delete _pendingPub[pid]; return; }   // server confirms removal
        _removeLocalProfile(pid);                            // not propagated yet → keep hidden
      } else {
        if (server && String(server.bio || '') === String(pending.bio || '')) { delete _pendingPub[pid]; return; }
        _upsertLocalProfile(pending);                        // not propagated yet → keep shown
      }
    });
  }

  // ── optimistic friend-link cache (§7-KK) ────────────────────────────────────
  // Same CF-write lag as the publish cache above: requestPetLink / respondPetLink
  // / removePetLink write petLinks/{linkId} SERVER-side, so the petLinks onSnapshot
  // lags the callable. Without this a neighbour button keeps its old state after a
  // click (ขอเป็นเพื่อน stays ขอเป็นเพื่อน instead of flipping to รอตอบรับ; an
  // answered request lingers in คำขอเป็นเพื่อน) until the snapshot arrives — the
  // same "click twice" feel as the bio save. Mirror the publish layer exactly:
  // apply on CF success, hold in _pendingLink until a server snapshot confirms.
  var _pendingLink = {};   // linkId -> optimistic link (request/respond) | null (remove)

  function _linkById(linkId) {
    for (var i = 0; i < _links.length; i++) if (String(_links[i].linkId) === String(linkId)) return _links[i];
    return null;
  }
  function _upsertLocalLink(link) {
    for (var i = 0; i < _links.length; i++) {
      if (String(_links[i].linkId) === String(link.linkId)) { _links[i] = link; return; }
    }
    _links = _links.concat([link]);
  }
  function _removeLocalLink(linkId) {
    _links = _links.filter(function (l) { return String(l.linkId) !== String(linkId); });
  }

  // A just-sent request — mirror the requestPetLink doc shape for the fields the
  // render reads (status + requester/recipient room+name); recipient meta from the
  // neighbour's public profile.
  function _applyOptimisticRequest(acting, toPetId) {
    var lid = buildLinkId(acting.petId, toPetId);
    if (!lid) return;
    var n = _profileById(toPetId) || {};
    var link = {
      linkId: lid, status: 'pending', building: _bldg(),
      requesterPetId: String(acting.petId), requesterRoom: _room(), requesterName: acting.name,
      recipientPetId: String(toPetId), recipientRoom: String(n.ownerRoom || ''), recipientName: n.name,
    };
    _pendingLink[lid] = link;
    _upsertLocalLink(link);
  }
  // accept → 'accepted', decline → 'declined' (respondPetLink tx.update); keep the
  // rest of the existing edge so requester/recipient meta survives the optimism.
  function _applyOptimisticRespond(linkId, accept) {
    var existing = _linkById(linkId);
    var status = accept ? 'accepted' : 'declined';
    var link = existing ? Object.assign({}, existing, { status: status }) : { linkId: String(linkId), status: status };
    _pendingLink[String(linkId)] = link;
    _upsertLocalLink(link);
  }
  // removePetLink deletes the doc → drop it locally now.
  function _applyOptimisticRemove(linkId) {
    _pendingLink[String(linkId)] = null;
    _removeLocalLink(linkId);
  }

  // A SERVER (non-cache) snapshot is authoritative and post-dates our CF write, so
  // trust it outright and drop the optimism. petLinks are SHARED — the OTHER party
  // can accept / decline / remove the edge — so forcing our optimistic value past a
  // server snapshot is exactly what got the two views stuck out of sync (one side
  // unfriended/declined, the other stayed "เพื่อนแล้ว"/"รอตอบรับ"). Only a CACHED
  // snapshot (which can pre-date our own write) keeps bridging the optimism set by
  // _applyOptimisticRequest/Respond/Remove. (§7-KK: act on server-confirmed
  // snapshots, ignore cached ones. The exact-status-match version this replaces
  // never matched once the other party moved the edge — and for a deleted edge it
  // re-added it (server===null + non-null pending) — so it re-applied forever.)
  function _applyPendingLinks(fromCache) {
    if (!fromCache) { _pendingLink = {}; return; }
    Object.keys(_pendingLink).forEach(function (lid) {
      var pending = _pendingLink[lid];
      if (pending === null) _removeLocalLink(lid); else _upsertLocalLink(pending);
    });
  }

  // ── render (§7-X: every section + path writes non-empty content) ────────────
  function _muted(text) {
    return '<div class="pet-dir__muted">' + _esc(text) + '</div>';
  }

  function _render() {
    var root = document.getElementById(LIST_ID);
    if (!root) return;
    if (!_ready()) { root.innerHTML = _muted('กำลังเตรียมข้อมูล… กรุณาเปิดผ่าน LINE'); return; }
    root.innerHTML = _sectionOwn() + _sectionIncoming() + _sectionNeighbours();
    _wire(root);
  }

  // Inline consent step (PDPA §19) — rendered IN PLACE of the publish button on
  // the pet's own card, so clicking "แสดงในไดเรกทอรี" doesn't scroll away or look
  // like the form was lost. The typed bio stays visible in the textarea above.
  function _inlineConsent() {
    var busy = !!_busy['pub_' + _pendingConsentPetId];
    return '<div class="pet-dir__consent pet-dir__consent--inline">' +
        '<p class="pet-dir__consent-text">เปิดน้องในไดเรกทอรีจะแสดง<b>ชื่อ ประเภท สายพันธุ์ รูป และหมายเลขห้อง</b>ให้เพื่อนบ้านในอาคารเดียวกันเห็น เพื่อให้น้องๆ หาเพื่อนเล่นได้ — ข้อมูลสุขภาพและวัคซีนจะไม่ถูกเปิดเผย คุณปิดได้ทุกเมื่อ</p>' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="consent-accept"' + (busy ? ' disabled' : '') + '>' + (busy ? 'กำลังบันทึก…' : 'ยินยอมและแสดงน้อง') + '</button>' +
        '<div class="pet-dir__consent-foot">' +
          '<button type="button" class="pet-dir__link" data-ps="consent-cancel">ไม่ใช่ตอนนี้</button>' +
          '<button type="button" class="pet-dir__link" data-ps="consent-privacy">นโยบายความเป็นส่วนตัว</button>' +
        '</div>' +
      '</div>';
  }

  function _sectionOwn() {
    var html = '<div class="pet-dir__section-title">สัตว์เลี้ยงของคุณ</div>';
    if (!_ownPets.length) {
      return html + '<div class="pet-dir__empty">ยังไม่มีสัตว์เลี้ยง — เพิ่มในหน้า Pet Park ก่อนเพื่อหาเพื่อนให้น้อง 🐾</div>';
    }
    html += _ownPets.map(function (p) {
      var pid = _esc(p.petId);
      var nameLine = '<strong class="pet-dir__name">น้อง' + _esc(p.name) + '</strong>' +
        '<span class="pet-dir__sub">' + _esc(p.typeEmoji || p.type || '🐾') + ' ' + _esc(p.breed || '') + '</span>';
      var avatar = _avatar(p);
      if (p.status !== 'approved') {
        return '<div class="pet-dir__card">' + avatar +
          '<div class="pet-dir__body">' + nameLine +
          '<span class="pet-dir__pill pet-dir__pill--wait">รออนุมัติก่อนจึงแสดงได้</span></div></div>';
      }
      var published = _isPublished(p.petId);
      var prof = published ? _profileById(p.petId) : null;
      var pendingConsent = String(p.petId) === String(_pendingConsentPetId);
      // Keep the typed bio visible: published → the saved bio; awaiting consent →
      // what the tenant just typed (stashed in _pendingPublishBio); else empty.
      var bioVal = published ? _esc((prof && prof.bio) || '')
                 : (pendingConsent ? _esc(_pendingPublishBio) : '');
      var busy = !!_busy['pub_' + p.petId];
      var bioBox = '<textarea class="pet-dir__bio" data-ps-bio="' + pid + '" maxlength="' + MAX_BIO_LEN + '" rows="2" placeholder="แนะนำน้องสั้นๆ เช่น นิสัยดี ชอบเล่นกับเพื่อน">' + bioVal + '</textarea>';
      var actions;
      if (published) {
        actions = '<div class="pet-dir__actions">' +
          '<span class="pet-dir__pill pet-dir__pill--on">✓ แสดงอยู่</span>' +
          '<button type="button" class="pet-dir__btn pet-dir__btn--ghost" data-ps="save-bio" data-pid="' + pid + '"' + (busy ? ' disabled' : '') + '>บันทึกข้อมูล</button>' +
          '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="unpublish" data-pid="' + pid + '"' + (busy ? ' disabled' : '') + '>เลิกแสดง</button>' +
          '</div>';
      } else if (pendingConsent) {
        actions = _inlineConsent();
      } else {
        actions = '<div class="pet-dir__actions">' +
          '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="publish" data-pid="' + pid + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'กำลังบันทึก…' : 'แสดงในไดเรกทอรี') + '</button>' +
          '</div>';
      }
      return '<div class="pet-dir__card pet-dir__card--own">' + avatar +
        '<div class="pet-dir__body">' + nameLine + bioBox + actions + '</div></div>';
    }).join('');
    return html;
  }

  function _sectionIncoming() {
    var rows = _incoming();
    if (!rows.length) return '';
    var html = '<div class="pet-dir__section-title">คำขอเป็นเพื่อน</div>';
    html += rows.map(function (l) {
      var lid = _esc(l.linkId);
      var busy = !!_busy['link_' + l.linkId];
      return '<div class="pet-dir__card">' +
        '<div class="pet-dir__avatar" aria-hidden="true">🐾</div>' +
        '<div class="pet-dir__body">' +
          '<strong class="pet-dir__name">น้อง' + _esc(l.requesterName || '') + '</strong>' +
          '<span class="pet-dir__sub">ห้อง ' + _esc(l.requesterRoom || '') + ' · อยากเป็นเพื่อนกับน้อง' + _esc(l.recipientName || '') + '</span>' +
          '<div class="pet-dir__actions">' +
            '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="accept" data-lid="' + lid + '"' + (busy ? ' disabled' : '') + '>ตอบรับ</button>' +
            '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="decline" data-lid="' + lid + '"' + (busy ? ' disabled' : '') + '>ปฏิเสธ</button>' +
          '</div>' +
        '</div></div>';
    }).join('');
    return html;
  }

  function _sectionNeighbours() {
    var myRoom = _room();
    var others = _profiles.filter(function (p) { return !isOwnProfile(p, myRoom); });
    var html = '<div class="pet-dir__section-title">เพื่อนบ้านสี่ขา</div>';

    var acting = _acting();
    // Acting-pet selector — only when the tenant has >1 published pet.
    var pub = _myPublishedPets();
    if (acting && pub.length > 1) {
      html += '<div class="pet-dir__acting"><span>หาเพื่อนในนามของ</span>' +
        '<select class="pet-dir__select" data-ps="acting">' +
        pub.map(function (p) {
          return '<option value="' + _esc(p.petId) + '"' + (String(p.petId) === String(_actingPetId) ? ' selected' : '') + '>น้อง' + _esc(p.name) + '</option>';
        }).join('') +
        '</select></div>';
    }

    if (!others.length) {
      return html + '<div class="pet-dir__empty">ยังไม่มีสัตว์เลี้ยงของเพื่อนบ้านในไดเรกทอรีตอนนี้ 🌱</div>';
    }

    html += others.map(function (p) {
      var avatar = _avatar(p);
      var meta = '<strong class="pet-dir__name">น้อง' + _esc(p.name) + '</strong>' +
        '<span class="pet-dir__sub">' + _esc(p.typeEmoji || p.type || '🐾') + ' ' + _esc(p.breed || '') + ' · ห้อง ' + _esc(p.ownerRoom || '') + '</span>';
      var bio = p.bio ? '<p class="pet-dir__bio-read">' + _esc(p.bio) + '</p>' : '';
      return '<div class="pet-dir__card">' + avatar +
        '<div class="pet-dir__body">' + meta + bio + _friendControl(acting, p) + '</div></div>';
    }).join('');
    return html;
  }

  // The friend button for a neighbour pet, given my acting pet + the edge state.
  function _friendControl(acting, neighbour) {
    if (!acting) {
      return '<div class="pet-dir__actions"><span class="pet-dir__hint">เปิดน้องของคุณในไดเรกทอรีก่อนจึงจะส่งคำขอได้</span></div>';
    }
    var link = _linkBetween(acting.petId, neighbour.petId);
    var state = linkStatusFor(link, _room());
    var lid = link ? _esc(link.linkId) : '';
    var busyKey = 'link_' + (link ? link.linkId : buildLinkId(acting.petId, neighbour.petId));
    var busy = !!_busy[busyKey];
    var dis = busy ? ' disabled' : '';
    if (state === 'friends') {
      return '<div class="pet-dir__actions"><span class="pet-dir__pill pet-dir__pill--on">🐾 เพื่อนแล้ว</span>' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="remove" data-lid="' + lid + '"' + dis + '>เลิกเป็นเพื่อน</button></div>';
    }
    if (state === 'outgoing') {
      return '<div class="pet-dir__actions"><span class="pet-dir__pill pet-dir__pill--pending">รอตอบรับ</span>' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="remove" data-lid="' + lid + '"' + dis + '>ยกเลิก</button></div>';
    }
    if (state === 'incoming') {
      return '<div class="pet-dir__actions">' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="accept" data-lid="' + lid + '"' + dis + '>ตอบรับ</button>' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="decline" data-lid="' + lid + '"' + dis + '>ปฏิเสธ</button></div>';
    }
    // none | declined → can (re)send
    return '<div class="pet-dir__actions">' +
      '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="request" data-to="' + _esc(neighbour.petId) + '"' + dis + '>' + (busy ? 'กำลังส่ง…' : 'ขอเป็นเพื่อน') + '</button></div>';
  }

  function _avatar(p) {
    // Photo via an <img> (not a CSS background-image): _esc() turns the Firebase
    // URL's `&` into `&amp;` — correct in an HTML src attribute (the browser
    // decodes it back before fetch), but it would corrupt a CSS url(). https only
    // is implied by Storage download URLs (§7-XX). Falls back to the type emoji.
    if (p && p.photoURL) {
      return '<div class="pet-dir__avatar"><img src="' + _esc(p.photoURL) + '" alt="" loading="lazy"></div>';
    }
    return '<div class="pet-dir__avatar" aria-hidden="true">' + _esc((p && (p.typeEmoji || p.type)) || '🐾') + '</div>';
  }

  // ── wire (direct listeners — activity-feed pattern, no data-action hub) ──────
  function _wire(root) {
    root.querySelectorAll('[data-ps]').forEach(function (el) {
      var kind = el.getAttribute('data-ps');
      if (kind === 'acting') {
        el.addEventListener('change', function () { _actingPetId = String(el.value || ''); _render(); });
        return;
      }
      el.addEventListener('click', function () {
        if (kind === 'consent-accept') return _acceptConsent();
        if (kind === 'consent-cancel') { _pendingConsentPetId = ''; _pendingPublishBio = ''; _render(); return; }
        if (kind === 'consent-privacy') return _lineSafeOpen(PRIVACY_URL);
        if (kind === 'publish') return _onPublishClick(el.getAttribute('data-pid'));
        if (kind === 'save-bio') { var pid = el.getAttribute('data-pid'); return _doPublish(pid, _readBio(pid), true); }
        if (kind === 'unpublish') return _unpublish(el.getAttribute('data-pid'));
        if (kind === 'request') return _request(el.getAttribute('data-to'));
        if (kind === 'accept') return _respond(el.getAttribute('data-lid'), true);
        if (kind === 'decline') return _respond(el.getAttribute('data-lid'), false);
        if (kind === 'remove') return _remove(el.getAttribute('data-lid'));
      });
    });
  }

  function _readBio(petId) {
    var el = document.querySelector('[data-ps-bio="' + (window.CSS && CSS.escape ? CSS.escape(String(petId)) : String(petId)) + '"]');
    return el ? sanitizeBio(el.value) : '';
  }

  // ── data ops (callables; optimistic busy flag, §7-I tenant-initiated) ───────
  function _onPublishClick(petId) {
    if (!petId) return;
    var pet = _ownPetById(petId);
    if (!pet) { _toast('ไม่พบสัตว์เลี้ยง', 'error'); return; }
    if (pet.status !== 'approved') { _toast('สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะแสดงได้', 'warning'); return; }
    // Capture the typed bio NOW — the consent step re-renders (recreating the
    // textarea empty), so reading it later would lose what the tenant wrote.
    var bio = _readBio(petId);
    // PDPA §19 consent gate (graceful — the CF re-checks server-side).
    if (_consentedLocally()) { _doPublish(petId, bio); return; }
    _serverConsentExists(_tenantId).then(function (ok) {
      if (ok) { _rememberConsent(); _doPublish(petId, bio); }
      else { _pendingConsentPetId = String(petId); _pendingPublishBio = bio; _render(); }
    });
  }

  async function _acceptConsent() {
    var petId = _pendingConsentPetId;
    var bio = _pendingPublishBio;
    if (!petId) { _render(); return; }
    _rememberConsent();
    // Loading state on the inline consent button.
    _busy['pub_' + petId] = true; _render();

    // CRITICAL: upsertPetProfile (publish) REQUIRES the consents/{tenantId}_pet_profile_v1
    // doc to ALREADY exist server-side (PDPA §19 gate). So the consent write MUST
    // complete BEFORE the publish — a fire-and-forget here raced the publish, which
    // hit the gate before the doc existed → failed-precondition → silent failure.
    try {
      var fns = _fns();
      if (!fns || typeof fns.httpsCallable !== 'function') throw new Error('ระบบยังไม่พร้อม');
      await fns.httpsCallable('recordChecklistConsent')({
        purpose: 'pet_profile_v1',
        noticeVersion: NOTICE_VERSION,
        userAgent: (navigator.userAgent || '').slice(0, 256),
      });
    } catch (e) {
      // Consent write failed → publish would fail too. Surface + keep the consent
      // step open (don't clear _pendingConsentPetId) so the tenant can retry.
      delete _busy['pub_' + petId];
      _toast(_errMsg(e, 'บันทึกการยินยอมไม่สำเร็จ กรุณาลองใหม่'), 'error');
      _render();
      return;
    }

    // Consent recorded — now publish (busy flag stays set; _doPublish clears it).
    _pendingConsentPetId = ''; _pendingPublishBio = '';
    await _doPublish(petId, bio);
  }

  async function _doPublish(petId, bio, resave) {
    if (!petId) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    if (!_bldg() || !_room()) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    bio = sanitizeBio(bio);
    _busy['pub_' + petId] = true; _render();
    try {
      await fns.httpsCallable('upsertPetProfile')({ building: _bldg(), roomId: _room(), petId: String(petId), bio: bio, isPublic: true });
      // Reflect the save immediately — the onSnapshot lags this CF write (§7-KK),
      // so without this the finally _render() below shows the stale (pre-save) state.
      _applyOptimisticPublish(petId, bio);
      // resave = แก้ไขข้อมูลน้องที่เปิดอยู่แล้ว (อย่าใช้ข้อความ "เปิดน้อง…" ซึ่งทำให้เข้าใจผิดว่าไม่มีอะไรเกิดขึ้น)
      _toast(resave ? 'บันทึกข้อมูลน้องแล้ว ✓' : 'เปิดน้องในไดเรกทอรีแล้ว 🐾', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy['pub_' + petId]; _render();
    }
  }

  // เลิกแสดง = ถอนการเผยแพร่ + ยกเลิกเพื่อนสี่ขาทั้งหมด (สิทธิ์ถอนความยินยอม PDPA).
  // ใช้ GhModal ที่ออกแบบไว้แล้ว แทน window.confirm ของเบราว์เซอร์ — ตัว native โชว์โดเมน
  // the-green-haven.vercel.app ซึ่งดูเหมือน pop-up หลอกลวง (feedback_modal_security).
  function _unpublish(petId) {
    if (!petId) return;
    var msg = 'เพื่อนสี่ขาที่ผูกไว้จะถูกยกเลิกทั้งหมด และน้องจะไม่แสดงให้เพื่อนบ้านเห็น (เปิดใหม่ได้ภายหลัง)';
    if (!window.GhModal || typeof window.GhModal.open !== 'function') {  // defensive fallback
      if (window.confirm('เลิกแสดงน้องจากไดเรกทอรี? ' + msg)) _doUnpublish(petId);
      return;
    }
    window.GhModal.open({
      title: 'เลิกแสดงน้องจากไดเรกทอรี?',
      body: msg,
      size: 'small',
      actions: [
        { label: 'ยกเลิก', variant: 'ghost', onClick: function (m) { m.close(); } },
        { label: 'เลิกแสดง', variant: 'danger', onClick: function (m) { m.close(); _doUnpublish(petId); } },
      ],
    });
  }

  async function _doUnpublish(petId) {
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['pub_' + petId] = true; _render();
    try {
      await fns.httpsCallable('upsertPetProfile')({ building: _bldg(), roomId: _room(), petId: String(petId), isPublic: false });
      _applyOptimisticUnpublish(petId);   // §7-KK: drop locally now; onSnapshot delete lags the CF
      _toast('เลิกแสดงน้องแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ดำเนินการไม่สำเร็จ'), 'error');
    } finally {
      delete _busy['pub_' + petId]; _render();
    }
  }

  async function _request(toPetId) {
    if (!toPetId) return;
    var acting = _acting();
    if (!acting) { _toast('เปิดน้องของคุณในไดเรกทอรีก่อน', 'warning'); return; }
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    var key = 'link_' + buildLinkId(acting.petId, toPetId);
    _busy[key] = true; _render();
    try {
      await fns.httpsCallable('requestPetLink')({ building: _bldg(), roomId: _room(), fromPetId: String(acting.petId), toPetId: String(toPetId) });
      _applyOptimisticRequest(acting, toPetId);   // §7-KK: flip to รอตอบรับ now; onSnapshot lags the CF
      _toast('ส่งคำขอเป็นเพื่อนแล้ว 🐾', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy[key]; _render();
    }
  }

  async function _respond(linkId, accept) {
    if (!linkId) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['link_' + linkId] = true; _render();
    try {
      await fns.httpsCallable('respondPetLink')({ building: _bldg(), roomId: _room(), linkId: String(linkId), accept: accept === true });
      _applyOptimisticRespond(linkId, accept === true);   // §7-KK: settle the row now; onSnapshot lags the CF
      _toast(accept ? 'เป็นเพื่อนกันแล้ว 🎉' : 'ปฏิเสธคำขอแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ดำเนินการไม่สำเร็จ — คำขออาจถูกตอบไปแล้ว'), 'error');
    } finally {
      delete _busy['link_' + linkId]; _render();
    }
  }

  async function _remove(linkId) {
    if (!linkId) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['link_' + linkId] = true; _render();
    try {
      await fns.httpsCallable('removePetLink')({ building: _bldg(), roomId: _room(), linkId: String(linkId) });
      _applyOptimisticRemove(linkId);   // §7-KK: drop the edge now; onSnapshot delete lags the CF
      _toast('ดำเนินการแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ดำเนินการไม่สำเร็จ'), 'error');
    } finally {
      delete _busy['link_' + linkId]; _render();
    }
  }

  // ── public entry (nav render hook) ──────────────────────────────────────────
  // Called by shared/tenant-navigation.js showSubPage('pet-directory-page'). Kicks
  // the subs (in case claims just arrived), re-reads own pets, then renders.
  function renderPetDirectory() {
    _subscribe();
    if (!_ready()) { _render(); return; }
    _loadOwn().then(_render);
  }

  // ── exports + self-wire (§7-A) ──────────────────────────────────────────────
  window.PetSocial = {
    // pure (tested)
    sanitizeBio: sanitizeBio, buildLinkId: buildLinkId, isOwnProfile: isOwnProfile, linkStatusFor: linkStatusFor,
    // entry + debug
    renderPetDirectory: renderPetDirectory, _subscribe: _subscribe, _render: _render,
  };
  window.renderPetDirectory = renderPetDirectory;

  // Subscribe as soon as building/room claims are ready (never authReady/liffLinked
  // directly — §7-A). The _ready + idempotency guards make extra fires no-ops.
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(_subscribe);
  }
})();
