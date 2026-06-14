/**
 * tenant-pet-matching.js — Meaning Layer #12 "เพื่อนซี้แนะนำ" (Pet-friendly matching).
 *
 * A DERIVE-ONLY suggestion surface on the Pet pillar. Given the tenant's own
 * pet(s) + room, it ranks the OTHER public pets in the building (the #10
 * `petProfiles` opt-in directory) by:
 *   • type compatibility  — same pet type (typeEmoji) = a likely playmate  (+3)
 *   • floor proximity     — same floor (+2) / adjacent floor (+1), derived
 *                            from the room number (hundreds digit == floor,
 *                            matching shared/config-unified.js's `floor` field).
 * and funnels the tenant into the #10 directory to actually befriend / #11 to
 * play. ZERO new collection / index / capture / CF — it reads the SAME building
 * `petProfiles` + `petLinks` snapshots #10 already exposes (tenant-readable per
 * the #10 rules), plus the tenant's own pet roster (one getDocs).
 *
 * Anti-patterns honoured: §7-A/U/BB (self-wire via _onLiffClaimsReady + claim
 * guard, canonical _tenantApp* globals) · §7-V (teardown before rebind) · §7-N
 * (onSnapshot error cb) · §7-X (every render path non-empty) · §7-FFF (own-bucket
 * by ownerRoom, never auth uid) · §7-RR (static .pet-match__* CSS) · §7-JJJ (nav
 * via generic data-action="showSubPage", no hub edit). Pure helpers exported for
 * unit tests (shared/__tests__/tenant-pet-matching.test.js).
 */
(function () {
  'use strict';

  // ── pure layer (Node-testable) ──────────────────────────────────────────────

  // Floor from a room id. Hundreds digit == floor for every room in
  // config-unified.js (rooms 101→1/204→2, nest N101→1/N405→4). Sub-100 ids fall
  // back to floor 1; non-numeric → null (skip the proximity bonus, don't guess).
  function deriveFloor(room) {
    var digits = String(room == null ? '' : room).replace(/\D/g, '');
    var n = parseInt(digits, 10);
    if (!n) return null;
    return n >= 100 ? Math.floor(n / 100) : 1;
  }

  function normType(t) { return String(t == null ? '' : t).trim(); }
  function typeMatch(a, b) { var na = normType(a), nb = normType(b); return !!na && na === nb; }

  // 'same' | 'adjacent' | 'far' | 'unknown' (a null floor → unknown, never far).
  function floorRel(fa, fb) {
    if (fa == null || fb == null) return 'unknown';
    var d = Math.abs(fa - fb);
    return d === 0 ? 'same' : d === 1 ? 'adjacent' : 'far';
  }

  // Score one candidate profile against one of my pet's types + my floor.
  function scoreOne(myType, myFloor, profile) {
    var reasons = [], score = 0;
    if (typeMatch(myType, profile && (profile.typeEmoji || profile.type))) { score += 3; reasons.push('type'); }
    var rel = floorRel(myFloor, deriveFloor(profile && profile.ownerRoom));
    if (rel === 'same') { score += 2; reasons.push('same-floor'); }
    else if (rel === 'adjacent') { score += 1; reasons.push('adjacent-floor'); }
    return { score: score, reasons: reasons, rel: rel };
  }

  // Rank the building's public profiles as suggestions for my pets.
  // opts = { myRoom, friendPetIds:{petId:true} }. Returns sorted
  // [{ profile, score, reasons[], rel, isFriend }]; excludes own room + zero-signal.
  function rankMatches(myPets, profiles, opts) {
    opts = opts || {};
    var myRoom = String(opts.myRoom == null ? '' : opts.myRoom);
    var friendPetIds = opts.friendPetIds || {};
    var myFloor = deriveFloor(myRoom);
    var myTypes = (myPets || []).map(function (p) { return normType(p && (p.typeEmoji || p.type)); }).filter(Boolean);
    if (!myTypes.length) myTypes = ['']; // floor-only scoring when the tenant has no pet type on file
    var out = [];
    for (var i = 0; i < (profiles || []).length; i++) {
      var pr = profiles[i];
      if (!pr) continue;
      if (String(pr.ownerRoom) === myRoom) continue;          // §7-FFF own bucket
      var best = { score: 0, reasons: [], rel: 'unknown' };
      for (var t = 0; t < myTypes.length; t++) {
        var s = scoreOne(myTypes[t], myFloor, pr);
        if (s.score > best.score) best = s;
      }
      if (best.score <= 0) continue;                          // no signal → not a suggestion
      out.push({ profile: pr, score: best.score, reasons: best.reasons, rel: best.rel,
                 isFriend: !!friendPetIds[String(pr.petId)] });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;      // strongest match first
      if (a.isFriend !== b.isFriend) return a.isFriend ? 1 : -1; // surface NEW connections over existing friends
      return String((a.profile || {}).name || '').localeCompare(String((b.profile || {}).name || ''));
    });
    return out;
  }

  // Set of OTHER petIds my pets are ACCEPTED friends with (so a suggestion can be
  // badged "เพื่อนแล้ว" + deprioritised). links = petLinks docs; myPetIds = Set-like obj.
  function friendPetIdSet(links, myPetIds) {
    var set = {};
    for (var i = 0; i < (links || []).length; i++) {
      var l = links[i];
      if (!l || l.status !== 'accepted') continue;
      var a = String(l.petA), b = String(l.petB);
      if (myPetIds[a] && !myPetIds[b]) set[b] = true;
      else if (myPetIds[b] && !myPetIds[a]) set[a] = true;
    }
    return set;
  }

  var PURE = { deriveFloor: deriveFloor, typeMatch: typeMatch, floorRel: floorRel,
               scoreOne: scoreOne, rankMatches: rankMatches, friendPetIdSet: friendPetIdSet };

  // ── browser-only layer (skipped under node --test) ──────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
    return;
  }

  var LIST_ID = 'pet-match-list';
  var _profilesUnsub = null, _linksUnsub = null, _subKey = '';
  var _profiles = [], _links = [], _ownPets = [], _ownLoaded = false;

  function _fs() { var f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { var f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _ready() { return !!(_bldg() && _room() && _fs() && _db()); }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _teardown() {
    if (_profilesUnsub) { try { _profilesUnsub(); } catch (_) {} _profilesUnsub = null; }
    if (_linksUnsub) { try { _linksUnsub(); } catch (_) {} _linksUnsub = null; }
  }

  // petProfiles + petLinks live, building-scoped (single-field, §7-N). Claims-ready
  // guarded (§7-U); teardown-before-rebind on building change (§7-V).
  function _subscribe() {
    if (!_ready()) return;
    var b = _bldg();
    if ((_profilesUnsub || _linksUnsub) && _subKey === b) return;
    _teardown();
    var fs = _fs(), db = _db();
    _subKey = b;
    try {
      var pq = fs.query(fs.collection(db, 'petProfiles'), fs.where('building', '==', b));
      _profilesUnsub = fs.onSnapshot(pq, function (snap) {
        _profiles = snap.docs.map(function (d) { return Object.assign({ petId: d.id }, d.data()); });
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-match] profiles sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _profilesUnsub = null; _subKey = ''; }
      });
      var lq = fs.query(fs.collection(db, 'petLinks'), fs.where('building', '==', b));
      _linksUnsub = fs.onSnapshot(lq, function (snap) {
        _links = snap.docs.map(function (d) { return Object.assign({ linkId: d.id }, d.data()); });
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-match] links sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _linksUnsub = null; _subKey = ''; }
      });
    } catch (e) {
      console.warn('[pet-match] subscribe init failed:', (e && e.message) || e);
    }
  }

  async function _loadOwn() {
    var fs = _fs(), db = _db();
    if (!fs || !db) return;
    var b = _bldg(), r = _room();
    try {
      var petsSnap = await fs.getDocs(fs.collection(db, 'tenants', b, 'list', r, 'pets'));
      _ownPets = petsSnap.docs.map(function (d) { return Object.assign({ petId: d.id }, d.data()); });
      _ownLoaded = true;
      _render();
    } catch (e) {
      if (!/permission/i.test((e && e.message) || '')) console.warn('[pet-match] own-pets read failed:', e && e.message);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────
  var REASON_CHIP = { 'type': '🐾 ชนิดเดียวกัน', 'same-floor': '🏠 ชั้นเดียวกัน', 'adjacent-floor': '🪜 ชั้นใกล้กัน' };
  var DIR_BTN = 'data-action="showSubPage" data-page="pet-directory-page"';

  function _muted(msg) {
    return '<div class="pet-match__muted">' + _esc(msg) + '</div>';
  }
  function _emptyCta(msg, btnLabel, page) {
    return '<div class="pet-match__empty">' + _esc(msg) +
      '<button type="button" class="pet-match__btn pet-match__btn--ghost" data-action="showSubPage" data-page="' + _esc(page) + '">' +
      _esc(btnLabel) + '</button></div>';
  }

  function _avatar(p) {
    var url = p && p.photoURL;
    if (url) return '<span class="pet-match__avatar"><img src="' + _esc(url) + '" alt="" loading="lazy"></span>';
    return '<span class="pet-match__avatar" aria-hidden="true">' + _esc((p && (p.typeEmoji || p.type)) || '🐾') + '</span>';
  }

  function _floorLabel(room) {
    var f = PURE.deriveFloor(room);
    return f == null ? ('ห้อง ' + _esc(room)) : ('ชั้น ' + f + ' · ห้อง ' + _esc(room));
  }

  function _matchCard(m, top) {
    var p = m.profile || {};
    var chips = (m.reasons || []).map(function (r) {
      return '<span class="pet-match__chip">' + (REASON_CHIP[r] || '') + '</span>';
    }).join('');
    var meta = [];
    if (p.breed) meta.push(_esc(p.breed));
    if (p.gender) meta.push(_esc(p.gender));
    if (p.age) meta.push(_esc(p.age));
    var friend = m.isFriend ? '<span class="pet-match__pill pet-match__pill--friend">เพื่อนแล้ว ✓</span>' : '';
    return '<div class="pet-match__card' + (top ? ' pet-match__card--top' : '') + '">' +
      _avatar(p) +
      '<div class="pet-match__body">' +
        '<strong class="pet-match__name">' + _esc(p.name || 'น้องไม่มีชื่อ') + '</strong>' +
        (meta.length ? '<span class="pet-match__sub">' + meta.join(' · ') + '</span>' : '') +
        '<span class="pet-match__sub pet-match__sub--room">' + _floorLabel(p.ownerRoom) + '</span>' +
        '<div class="pet-match__chips">' + chips + friend + '</div>' +
      '</div>' +
      '<button type="button" class="pet-match__btn pet-match__btn--ghost" ' + DIR_BTN + ' aria-label="ดูในไดเรกทอรี">ไดเรกทอรี →</button>' +
    '</div>';
  }

  function _render() {
    var el = document.getElementById(LIST_ID);
    if (!el) return;
    if (!_ready() || !_ownLoaded) { el.innerHTML = _muted('กำลังโหลด…'); return; }

    // No pet on file → nudge to register first (the matching anchor is the pet's type).
    if (!_ownPets.length) {
      el.innerHTML = _emptyCta('เพิ่มน้องของคุณก่อน แล้วเราจะแนะนำเพื่อนซี้ที่น่าจะถูกคอให้ 🐾', '+ เพิ่มสัตว์เลี้ยง', 'add-pet-page');
      return;
    }

    var myPetIds = {};
    _ownPets.forEach(function (p) { myPetIds[String(p.petId)] = true; });
    var friendIds = PURE.friendPetIdSet(_links, myPetIds);
    var matches = PURE.rankMatches(_ownPets, _profiles, { myRoom: _room(), friendPetIds: friendIds });

    // Is at least one of my pets already public? If not, nudge to publish so the
    // neighbour graph can find THEM too (the matching still works off the registry).
    var iAmPublic = false;
    for (var i = 0; i < _profiles.length; i++) { if (String(_profiles[i].ownerRoom) === _room()) { iAmPublic = true; break; } }
    var nudge = iAmPublic ? '' :
      _emptyCta('เปิดโปรไฟล์น้องของคุณ เพื่อให้เพื่อนบ้านเจอน้องด้วย', 'เปิดโปรไฟล์น้อง →', 'pet-directory-page');

    if (!matches.length) {
      el.innerHTML = nudge +
        _emptyCta('ยังไม่มีเพื่อนบ้านที่เข้ากันกับน้องของคุณตอนนี้ — ลองเปิดโปรไฟล์น้องไว้ เผื่อมีคนมาทักก่อน', 'ดูไดเรกทอรี', 'pet-directory-page');
      return;
    }

    var top = matches.slice(0, 8); // a focused shortlist, strongest first
    var cards = top.map(function (m, i) { return _matchCard(m, i === 0); }).join('');
    el.innerHTML =
      '<p class="pet-match__lead">เพื่อนบ้านที่น้องของคุณน่าจะถูกคอ จากคนที่เปิดโปรไฟล์ไว้ในตึกเดียวกัน</p>' +
      nudge + cards +
      '<div class="pet-match__foot">' +
        '<button type="button" class="pet-match__btn pet-match__btn--primary" ' + DIR_BTN + '>ไปหน้าไดเรกทอรีเพื่อทำความรู้จัก</button>' +
      '</div>';
  }

  function renderPetMatch() {
    _subscribe();
    if (!_ownLoaded) _loadOwn();
    _render();
  }

  window.PetMatch = PURE;
  window.renderPetMatch = renderPetMatch;

  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(_subscribe);
  }
})();
