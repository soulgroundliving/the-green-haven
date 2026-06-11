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

  function _consentedLocally() { try { return localStorage.getItem(LS_CONSENT) === '1'; } catch (_) { return false; } }
  function _rememberConsent() { try { localStorage.setItem(LS_CONSENT, '1'); } catch (_) { /* storage off */ } }

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

  function _lineSafeOpen(url) {
    try {
      if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
        liff.openWindow({ url: url, external: true });
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
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-social] profiles sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _profilesUnsub = null; _subKey = ''; }
      });

      var lq = fs.query(fs.collection(db, 'petLinks'), fs.where('building', '==', b));
      _linksUnsub = fs.onSnapshot(lq, function (snap) {
        _links = snap.docs.map(function (d) { return Object.assign({ linkId: d.id }, d.data()); });
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

  // ── render (§7-X: every section + path writes non-empty content) ────────────
  function _muted(text) {
    return '<div class="pet-dir__muted">' + _esc(text) + '</div>';
  }

  function _render() {
    var root = document.getElementById(LIST_ID);
    if (!root) return;
    if (!_ready()) { root.innerHTML = _muted('กำลังเตรียมข้อมูล… กรุณาเปิดผ่าน LINE'); return; }
    root.innerHTML = _consentBanner() + _sectionOwn() + _sectionIncoming() + _sectionNeighbours();
    _wire(root);
  }

  function _consentBanner() {
    if (!_pendingConsentPetId) return '';
    var pet = _ownPetById(_pendingConsentPetId);
    var name = pet ? ('น้อง' + _esc(pet.name)) : 'สัตว์เลี้ยงของคุณ';
    return '' +
      '<div class="pet-dir__consent">' +
        '<div class="pet-dir__consent-head"><span aria-hidden="true">🐾</span><span>แสดง' + name + 'ในไดเรกทอรีอาคาร</span></div>' +
        '<p class="pet-dir__consent-text">การเปิดสัตว์เลี้ยงในไดเรกทอรีจะแสดง<b>ชื่อ ประเภท สายพันธุ์ รูป และหมายเลขห้อง</b>ของคุณให้เพื่อนบ้านในอาคารเดียวกันเห็น เพื่อให้น้องๆ หาเพื่อนเล่นได้ — ข้อมูลสุขภาพและวัคซีนจะไม่ถูกเปิดเผย คุณปิดได้ทุกเมื่อ</p>' +
        '<button type="button" class="pet-dir__btn pet-dir__btn--primary" data-ps="consent-accept">ยินยอมและแสดงน้อง</button>' +
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
      var bioVal = published ? _esc((prof && prof.bio) || '') : '';
      var busy = !!_busy['pub_' + p.petId];
      var bioBox = '<textarea class="pet-dir__bio" data-ps-bio="' + pid + '" maxlength="' + MAX_BIO_LEN + '" rows="2" placeholder="แนะนำน้องสั้นๆ เช่น นิสัยดี ชอบเล่นกับเพื่อน">' + bioVal + '</textarea>';
      var actions;
      if (published) {
        actions = '<div class="pet-dir__actions">' +
          '<span class="pet-dir__pill pet-dir__pill--on">✓ แสดงอยู่</span>' +
          '<button type="button" class="pet-dir__btn pet-dir__btn--ghost" data-ps="save-bio" data-pid="' + pid + '"' + (busy ? ' disabled' : '') + '>บันทึกข้อมูล</button>' +
          '<button type="button" class="pet-dir__btn pet-dir__btn--mute" data-ps="unpublish" data-pid="' + pid + '"' + (busy ? ' disabled' : '') + '>ซ่อน</button>' +
          '</div>';
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
        if (kind === 'consent-cancel') { _pendingConsentPetId = ''; _render(); return; }
        if (kind === 'consent-privacy') return _lineSafeOpen(PRIVACY_URL);
        if (kind === 'publish') return _onPublishClick(el.getAttribute('data-pid'));
        if (kind === 'save-bio') { var pid = el.getAttribute('data-pid'); return _doPublish(pid, _readBio(pid)); }
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

  function _acceptConsent() {
    var petId = _pendingConsentPetId;
    _rememberConsent();
    // Fire-and-forget PDPA ledger write (consents/{tenantId}_pet_profile_v1).
    try {
      var fns = _fns();
      if (fns && typeof fns.httpsCallable === 'function') {
        fns.httpsCallable('recordChecklistConsent')({
          purpose: 'pet_profile_v1',
          noticeVersion: NOTICE_VERSION,
          userAgent: (navigator.userAgent || '').slice(0, 256),
        }).catch(function (e) { console.warn('[pet-social] consent ledger write failed (non-fatal):', e && (e.message || e)); });
      }
    } catch (_) { /* CF not wired in this build */ }
    _pendingConsentPetId = '';
    var bio = _pendingPublishBio; _pendingPublishBio = '';
    if (petId) _doPublish(petId, bio);
    else _render();
  }

  async function _doPublish(petId, bio) {
    if (!petId) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    if (!_bldg() || !_room()) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    bio = sanitizeBio(bio);
    _busy['pub_' + petId] = true; _render();
    try {
      await fns.httpsCallable('upsertPetProfile')({ building: _bldg(), roomId: _room(), petId: String(petId), bio: bio, isPublic: true });
      _toast('เปิดน้องในไดเรกทอรีแล้ว 🐾', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy['pub_' + petId]; _render();
    }
  }

  async function _unpublish(petId) {
    if (!petId) return;
    if (!window.confirm('ซ่อนน้องจากไดเรกทอรี? เพื่อนที่ผูกไว้จะถูกยกเลิกทั้งหมด')) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['pub_' + petId] = true; _render();
    try {
      await fns.httpsCallable('upsertPetProfile')({ building: _bldg(), roomId: _room(), petId: String(petId), isPublic: false });
      _toast('ซ่อนน้องจากไดเรกทอรีแล้ว', 'success');
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
