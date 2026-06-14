/*
 * Pet Playdate Booking — tenant UI (Meaning Layer #11).
 *
 * The frontend for the server (petPlaydates/{id} + the 4 callables
 * createPetPlaydate / joinPetPlaydate / leavePetPlaydate / cancelPetPlaydate). A
 * tenant with an APPROVED pet opens a playdate slot ("เล่นเย็นนี้"); neighbours in
 * the SAME building bring their own approved pet and join up to a capacity; the
 * host can cancel (attendees get a LINE push).
 *
 * One live source, building-scoped (single-field where building== → no composite
 * index, §7-J/AAA-safe — status filter + chrono sort happen in JS):
 *   - petPlaydates (onSnapshot) → every playdate in the building (incl. own).
 * Plus a once-per-open getDocs of the tenant's own pets (for the host form) — a
 * read-only consumer of the pet roster, NOT of #10's petProfiles (so this never
 * touches the contended #10 write-path).
 *
 * Past / cancelled playdates are filtered out client-side (status open|full AND
 * endAt > now) — so the feature is complete without the (deferred) server sweep.
 *
 * Anti-patterns honoured: §7-A/U/BB self-wire via _onLiffClaimsReady + the
 * _tenantAppBuilding/_tenantAppRoom globals (never the phantom _liffClaims), claim
 * guard before the first read · §7-N onSnapshot error callback that resets the
 * unsub so a later claims-ready fire retries · §7-V unsub-before-rebind on a
 * building change · §7-X every render path writes non-empty content · §7-FFF
 * "mine / joined" buckets by ROOM identity (hostRoom / attendee.room), not auth uid ·
 * §7-JJJ DIRECT listeners (no data-action hub) · §7-RR all styling is static
 * .pet-play-* in components.css (never an injected <style>) · §7-I tenant-initiated
 * only (no programmatic .click) · escaping on every piece of user text
 * ([[feedback_modal_security]]) · window.* exports (§7-QQ/CC).
 *
 * Pure helpers (isHost, slotsLeft, isJoinable, fmtWhen) are exported on
 * window.PetPlaydate for unit tests (shared/__tests__/tenant-pet-playdate.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-pet-playdate.test.js
 */
(function () {
  'use strict';

  var MAX_TITLE_LEN = 80;        // mirrors functions/_petPlaydateEngine.js
  var MAX_PLACE_LEN = 80;
  var DEFAULT_CAPACITY = 6;
  var MIN_CAPACITY = 2;
  var MAX_CAPACITY = 12;

  // ── PURE helpers (tested; safe in the node test realm) ──────────────────────

  // startAt/endAt arrive as Firestore Timestamp / {seconds} / epoch-ms.
  function _ms(ts) {
    if (ts == null) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    var n = Number(ts);
    return isFinite(n) ? n : 0;
  }

  /** Is this playdate hosted by MY room? §7-FFF — bucket by ROOM, never auth uid. */
  function isHost(playdate, myRoom) {
    return !!playdate && String(playdate.hostRoom) === String(myRoom);
  }

  /** Open seats remaining (host counts as one attendee; never negative). */
  function slotsLeft(playdate) {
    var cap = Number(playdate && playdate.capacity) || DEFAULT_CAPACITY;
    var n = (playdate && Array.isArray(playdate.attendees)) ? playdate.attendees.length : 0;
    return Math.max(0, cap - n);
  }

  /** Is `room` already an attendee of `playdate`? (one slot per room) */
  function roomJoined(playdate, room) {
    var r = String(room);
    var list = (playdate && Array.isArray(playdate.attendees)) ? playdate.attendees : [];
    for (var i = 0; i < list.length; i++) if (String(list[i] && list[i].room) === r) return true;
    return false;
  }

  /**
   * Can MY room join `playdate` at `nowMs`? Drives whether the card shows เข้าร่วม.
   *   - status 'open',
   *   - not past its end,
   *   - a seat free,
   *   - my room not already in (host or guest).
   */
  function isJoinable(playdate, myRoom, nowMs) {
    if (!playdate) return false;
    if (playdate.status !== 'open') return false;
    var end = _ms(playdate.endAt);
    if (end > 0 && Number(nowMs) >= end) return false;
    if (slotsLeft(playdate) <= 0) return false;
    if (roomJoined(playdate, myRoom)) return false;
    return true;
  }

  /** Is this playdate still showable (open|full AND not past its end)? */
  function isLive(playdate, nowMs) {
    if (!playdate) return false;
    if (playdate.status !== 'open' && playdate.status !== 'full') return false;
    var end = _ms(playdate.endAt);
    return !(end > 0 && Number(nowMs) >= end);
  }

  /** Clamp a capacity input to the engine's [MIN..MAX] for the host form. */
  function clampCapacity(c) {
    var n = Math.floor(Number(c));
    if (!isFinite(n) || n < 1) return DEFAULT_CAPACITY;
    return Math.max(MIN_CAPACITY, Math.min(n, MAX_CAPACITY));
  }

  /**
   * Format a playdate window for display in Thai-ish short form. Pure — takes the
   * two epoch-ms (resolved by the caller) + an optional Date factory for testing.
   * Same-day → "14 มิ.ย. 17:00–19:00"; cross-day → "14 มิ.ย. 23:00 – 15 มิ.ย. 01:00".
   */
  var _TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function _two(n) { return (n < 10 ? '0' : '') + n; }
  function fmtWhen(startMs, endMs, mkDate) {
    var make = mkDate || function (ms) { return new Date(ms); };
    var s = make(Number(startMs));
    var e = make(Number(endMs));
    if (!startMs || !endMs || isNaN(s.getTime()) || isNaN(e.getTime())) return '';
    var sDay = s.getDate() + ' ' + _TH_MONTHS[s.getMonth()];
    var sTime = _two(s.getHours()) + ':' + _two(s.getMinutes());
    var eTime = _two(e.getHours()) + ':' + _two(e.getMinutes());
    var sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
    if (sameDay) return sDay + ' ' + sTime + '–' + eTime;
    var eDay = e.getDate() + ' ' + _TH_MONTHS[e.getMonth()];
    return sDay + ' ' + sTime + ' – ' + eDay + ' ' + eTime;
  }

  // ── browser-only state + helpers (skipped under node --test) ────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        isHost: isHost, slotsLeft: slotsLeft, roomJoined: roomJoined,
        isJoinable: isJoinable, isLive: isLive, clampCapacity: clampCapacity, fmtWhen: fmtWhen,
      };
    }
    return;
  }

  var LIST_ID = 'pet-playdate-list';

  var _unsub = null;              // petPlaydates onSnapshot unsub (§7-V)
  var _subKey = '';               // building the sub is bound to (rebind on change)
  var _playdates = [];            // live petPlaydates in the building
  var _ownPets = [];              // tenant's own pets (getDocs on open)
  var _ownLoaded = false;
  var _tenantId = '';             // canonical tenants/{b}/list/{r}.tenantId
  var _hostPetId = '';            // which own approved pet the host form will use
  var _showForm = false;          // the create form's expand/collapse state
  var _busy = {};                 // id -> true while a callable is in flight

  function _fs() { var f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { var f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _fns() { var f = window.firebase; return f && f.functions; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _ready() { return !!(_bldg() && _room() && _fs() && _db()); }
  function _now() { return Date.now(); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }

  // HttpsError messages from the CFs are user-friendly Thai — surface them, but
  // fall back for the opaque transport codes (mirrors tenant-pet-social.js).
  function _errMsg(e, fallback) {
    var code = String((e && e.code) || '');
    var msg = String((e && e.message) || '');
    return (/internal|unknown|unavailable|deadline/i.test(code) || !msg) ? fallback : msg;
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── live subscription (claims-ready, §7-A/U/V) ──────────────────────────────
  function _subscribe() {
    if (!_ready()) return;                          // §7-U: claim-presence guard
    var b = _bldg();
    if (_unsub && _subKey === b) return;            // §7-V idempotent
    _teardown();                                    // building changed → tear down stale sub
    var fs = _fs(); var db = _db();
    _subKey = b;
    try {
      var q = fs.query(fs.collection(db, 'petPlaydates'), fs.where('building', '==', b));
      _unsub = fs.onSnapshot(q, function (snap) {
        _playdates = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        _render();
      }, function (err) {
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-playdate] sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _unsub = null; _subKey = ''; }  // §7-U reset so a later claims-ready fire retries
      });
    } catch (e) {
      console.warn('[pet-playdate] subscribe init failed:', e && e.message || e);
    }
  }

  function _teardown() {
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
  }

  // Own pets (+ canonical tenantId) — read once per open; cheap getDocs, not a 2nd
  // live sub. Only APPROVED pets can host/join, but we load all + filter in render.
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
      if (!/permission/i.test((e && e.message) || '')) console.warn('[pet-playdate] own-pets read failed:', e && e.message);
    }
  }

  function _approvedPets() {
    return _ownPets.filter(function (p) { return p && p.status === 'approved'; });
  }

  // ── render (§7-X: every section + path writes non-empty content) ────────────
  function _muted(text) { return '<div class="pet-play__muted">' + _esc(text) + '</div>'; }

  function _render() {
    var root = document.getElementById(LIST_ID);
    if (!root) return;
    if (!_ready()) { root.innerHTML = _muted('กำลังเตรียมข้อมูล… กรุณาเปิดผ่าน LINE'); return; }
    root.innerHTML = _sectionForm() + _sectionList();
    _wire(root);
  }

  function _whenOf(pd) {
    return fmtWhen(_ms(pd.startAt), _ms(pd.endAt));
  }

  // (1) สร้างนัดเล่น — the host form (collapsible). Empty-state branches to pet
  // registration when the tenant has no approved pet (§7-X).
  function _sectionForm() {
    var html = '<div class="pet-play__section-title">สร้างนัดเล่นของน้อง</div>';
    var approved = _approvedPets();
    if (!_ownLoaded) {
      return html + _muted('กำลังโหลดสัตว์เลี้ยงของคุณ…');
    }
    if (!approved.length) {
      return html + '<div class="pet-play__empty">ยังไม่มีน้องที่อนุมัติ — เพิ่มและรออนุมัติในหน้า Pet Park ก่อนจึงจะเปิดนัดเล่นได้ 🐾</div>';
    }
    if (!_showForm) {
      return html +
        '<button type="button" class="pet-play__btn pet-play__btn--primary pet-play__open-form" data-pp="open-form">+ เปิดนัดเล่นใหม่</button>';
    }
    // Default the acting host pet to the first approved one.
    if (!_hostPetId || !approved.some(function (p) { return String(p.petId) === String(_hostPetId); })) {
      _hostPetId = String(approved[0].petId);
    }
    var busy = !!_busy.create;
    var petOptions = approved.map(function (p) {
      return '<option value="' + _esc(p.petId) + '"' + (String(p.petId) === String(_hostPetId) ? ' selected' : '') + '>น้อง' + _esc(p.name) + '</option>';
    }).join('');
    var capOptions = '';
    for (var c = MIN_CAPACITY; c <= MAX_CAPACITY; c++) {
      capOptions += '<option value="' + c + '"' + (c === DEFAULT_CAPACITY ? ' selected' : '') + '>' + c + ' ตัว</option>';
    }
    return html +
      '<div class="pet-play__form">' +
        '<label class="pet-play__label">น้องที่ไป' +
          '<select class="pet-play__select" data-pp-field="host">' + petOptions + '</select></label>' +
        '<label class="pet-play__label">ชื่อกิจกรรม' +
          '<input type="text" class="pet-play__input" data-pp-field="title" maxlength="' + MAX_TITLE_LEN + '" placeholder="เช่น เล่นกับน้องหมาเย็นนี้"></label>' +
        '<label class="pet-play__label">สถานที่' +
          '<input type="text" class="pet-play__input" data-pp-field="place" maxlength="' + MAX_PLACE_LEN + '" placeholder="เช่น ลานหญ้าชั้น G"></label>' +
        '<div class="pet-play__row">' +
          '<label class="pet-play__label pet-play__label--grow">เริ่ม' +
            '<input type="datetime-local" class="pet-play__input" data-pp-field="start"></label>' +
          '<label class="pet-play__label pet-play__label--grow">สิ้นสุด' +
            '<input type="datetime-local" class="pet-play__input" data-pp-field="end"></label>' +
        '</div>' +
        '<label class="pet-play__label">จำนวนน้องสูงสุด' +
          '<select class="pet-play__select" data-pp-field="capacity">' + capOptions + '</select></label>' +
        '<div class="pet-play__actions">' +
          '<button type="button" class="pet-play__btn pet-play__btn--primary" data-pp="create"' + (busy ? ' disabled' : '') + '>' + (busy ? 'กำลังเปิด…' : 'เปิดนัดเล่น') + '</button>' +
          '<button type="button" class="pet-play__btn pet-play__btn--ghost" data-pp="cancel-form">ยกเลิก</button>' +
        '</div>' +
      '</div>';
  }

  // (2) นัดเล่นที่เปิดอยู่ — the live list (open|full, not past), host's own card
  // last-mile gets ยกเลิก; others get เข้าร่วม / ออก / เต็มแล้ว.
  function _sectionList() {
    var now = _now();
    var live = _playdates.filter(function (p) { return isLive(p, now); });
    // Sort by startAt ascending (soonest first) — JS sort, no Firestore orderBy (§7-AAA).
    live.sort(function (a, b) { return _ms(a.startAt) - _ms(b.startAt); });

    var html = '<div class="pet-play__section-title">นัดเล่นที่เปิดอยู่</div>';
    if (!live.length) {
      return html + '<div class="pet-play__empty">ยังไม่มีนัดเล่นในอาคารตอนนี้ — เปิดนัดแรกเลย! 🌱</div>';
    }
    var myRoom = _room();
    html += live.map(function (pd) {
      return _card(pd, myRoom, now);
    }).join('');
    return html;
  }

  function _card(pd, myRoom, now) {
    var id = _esc(pd.id);
    var host = isHost(pd, myRoom);
    var joinedHere = roomJoined(pd, myRoom);
    var left = slotsLeft(pd);
    var cap = Number(pd.capacity) || DEFAULT_CAPACITY;
    var seated = (Array.isArray(pd.attendees) ? pd.attendees.length : 0);
    var busy = !!_busy['pd_' + pd.id];
    var dis = busy ? ' disabled' : '';

    var head =
      '<div class="pet-play__card-head">' +
        '<strong class="pet-play__title">' + _esc(pd.title || 'นัดเล่นของน้อง') + '</strong>' +
        (host ? '<span class="pet-play__pill pet-play__pill--host">นัดของคุณ</span>' : '') +
      '</div>';
    var meta =
      '<div class="pet-play__meta">📍 ' + _esc(pd.place || '-') + '</div>' +
      '<div class="pet-play__meta">🕒 ' + _esc(_whenOf(pd)) + '</div>' +
      '<div class="pet-play__meta">🐾 ' + seated + '/' + cap + ' ตัว' + (left > 0 ? '' : ' · เต็มแล้ว') + '</div>';

    // Attendee chips — safe fields only (name + emoji), escaped.
    var chips = (Array.isArray(pd.attendees) ? pd.attendees : []).map(function (a) {
      return '<span class="pet-play__chip">' + _esc(a.typeEmoji || '🐾') + ' น้อง' + _esc(a.petName || '') + '</span>';
    }).join('');
    var chipRow = chips ? '<div class="pet-play__chips">' + chips + '</div>' : '';

    var actions;
    if (host) {
      actions = '<button type="button" class="pet-play__btn pet-play__btn--mute" data-pp="cancel" data-id="' + id + '"' + dis + '>ยกเลิกนัด</button>';
    } else if (joinedHere) {
      actions = '<span class="pet-play__pill pet-play__pill--on">✓ น้องของคุณเข้าร่วมแล้ว</span>' +
        '<button type="button" class="pet-play__btn pet-play__btn--mute" data-pp="leave" data-id="' + id + '"' + dis + '>ออกจากนัด</button>';
    } else if (left <= 0 || pd.status === 'full') {
      actions = '<span class="pet-play__pill pet-play__pill--full">เต็มแล้ว</span>';
    } else if (!_approvedPets().length) {
      actions = '<span class="pet-play__hint">เพิ่มน้องที่อนุมัติแล้วเพื่อเข้าร่วม</span>';
    } else {
      actions = '<button type="button" class="pet-play__btn pet-play__btn--primary" data-pp="join" data-id="' + id + '"' + dis + '>' + (busy ? 'กำลังเข้าร่วม…' : 'เข้าร่วม') + '</button>';
    }

    return '<div class="pet-play__card">' + head + meta + chipRow +
      '<div class="pet-play__actions">' + actions + '</div></div>';
  }

  // ── wire (DIRECT listeners — §7-JJJ-safe, no data-action hub) ───────────────
  function _wire(root) {
    root.querySelectorAll('[data-pp]').forEach(function (el) {
      var kind = el.getAttribute('data-pp');
      el.addEventListener('click', function () {
        if (kind === 'open-form') { _showForm = true; _render(); return; }
        if (kind === 'cancel-form') { _showForm = false; _render(); return; }
        if (kind === 'create') return _create(root);
        if (kind === 'join') return _join(el.getAttribute('data-id'));
        if (kind === 'leave') return _leave(el.getAttribute('data-id'));
        if (kind === 'cancel') return _cancel(el.getAttribute('data-id'));
      });
    });
    var hostSel = root.querySelector('[data-pp-field="host"]');
    if (hostSel) hostSel.addEventListener('change', function () { _hostPetId = String(hostSel.value || ''); });
  }

  function _field(root, name) {
    var el = root.querySelector('[data-pp-field="' + name + '"]');
    return el ? el.value : '';
  }

  // datetime-local yields "YYYY-MM-DDTHH:mm" in LOCAL time → epoch ms via Date().
  function _localToMs(v) {
    if (!v) return 0;
    var d = new Date(v);
    var t = d.getTime();
    return isNaN(t) ? 0 : t;
  }

  // ── data ops (callables; optimistic busy flag, §7-I tenant-initiated) ───────
  async function _create(root) {
    var fns = _fns();
    if (!fns || typeof fns.httpsCallable !== 'function') { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    if (!_bldg() || !_room()) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    var title = String(_field(root, 'title') || '').trim();
    var place = String(_field(root, 'place') || '').trim();
    var startMs = _localToMs(_field(root, 'start'));
    var endMs = _localToMs(_field(root, 'end'));
    var capacity = clampCapacity(_field(root, 'capacity'));
    var hostPetId = _hostPetId || (_approvedPets()[0] && _approvedPets()[0].petId) || '';
    if (!hostPetId) { _toast('เลือกน้องที่จะไปก่อน', 'warning'); return; }
    if (!title) { _toast('ตั้งชื่อกิจกรรมก่อน', 'warning'); return; }
    if (!place) { _toast('ระบุสถานที่ก่อน', 'warning'); return; }
    if (!startMs || !endMs) { _toast('เลือกเวลาเริ่มและสิ้นสุด', 'warning'); return; }
    if (endMs <= startMs) { _toast('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'warning'); return; }
    if (endMs <= _now()) { _toast('เลือกเวลาในอนาคต', 'warning'); return; }

    _busy.create = true; _render();
    try {
      await fns.httpsCallable('createPetPlaydate')({
        building: _bldg(), roomId: _room(), hostPetId: String(hostPetId),
        title: title, place: place, startAt: startMs, endAt: endMs, capacity: capacity,
      });
      _showForm = false;
      _toast('เปิดนัดเล่นแล้ว 🐾', 'success');
      // The onSnapshot will bring the new card; clear busy + collapse the form.
    } catch (e) {
      _toast(_errMsg(e, 'เปิดนัดไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy.create; _render();
    }
  }

  // Resolve MY approved pet for a join. One slot per room, so any approved pet
  // works; default to the host-form pick, else the first approved.
  function _myJoinPetId() {
    var approved = _approvedPets();
    if (!approved.length) return '';
    var pick = _hostPetId && approved.filter(function (p) { return String(p.petId) === String(_hostPetId); })[0];
    return String((pick || approved[0]).petId);
  }

  async function _join(playdateId) {
    if (!playdateId) return;
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    var petId = _myJoinPetId();
    if (!petId) { _toast('เพิ่มน้องที่อนุมัติแล้วก่อนเข้าร่วม', 'warning'); return; }
    _busy['pd_' + playdateId] = true; _render();
    try {
      await fns.httpsCallable('joinPetPlaydate')({ building: _bldg(), roomId: _room(), playdateId: String(playdateId), petId: petId });
      _toast('น้องเข้าร่วมนัดเล่นแล้ว 🐾', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'เข้าร่วมไม่สำเร็จ — นัดอาจเต็มแล้ว'), 'error');
    } finally {
      delete _busy['pd_' + playdateId]; _render();
    }
  }

  // Resolve which of MY pets is in this playdate (to leave it).
  function _myAttendingPetId(playdate) {
    var r = _room();
    var list = (playdate && Array.isArray(playdate.attendees)) ? playdate.attendees : [];
    for (var i = 0; i < list.length; i++) if (String(list[i].room) === r) return String(list[i].petId);
    return '';
  }

  async function _leave(playdateId) {
    if (!playdateId) return;
    var pd = _playdateById(playdateId);
    var petId = _myAttendingPetId(pd);
    if (!petId) { _toast('น้องไม่ได้อยู่ในนัดนี้', 'warning'); return; }
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['pd_' + playdateId] = true; _render();
    try {
      await fns.httpsCallable('leavePetPlaydate')({ building: _bldg(), roomId: _room(), playdateId: String(playdateId), petId: petId });
      _toast('ออกจากนัดแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ดำเนินการไม่สำเร็จ'), 'error');
    } finally {
      delete _busy['pd_' + playdateId]; _render();
    }
  }

  // ยกเลิกนัด = ปิดนัดถาวร + แจ้งผู้เข้าร่วมทาง LINE. ใช้ GhModal (ไม่ใช่ native confirm —
  // ตัว native โชว์โดเมน ดูเหมือน pop-up หลอกลวง, feedback_modal_security).
  function _cancel(playdateId) {
    if (!playdateId) return;
    var msg = 'ผู้เข้าร่วมจะได้รับแจ้งเตือนว่านัดนี้ถูกยกเลิก และนัดจะไม่แสดงอีก';
    if (!window.GhModal || typeof window.GhModal.open !== 'function') {
      if (window.confirm('ยกเลิกนัดเล่นนี้? ' + msg)) _doCancel(playdateId);
      return;
    }
    window.GhModal.open({
      title: 'ยกเลิกนัดเล่นนี้?',
      body: msg,
      size: 'small',
      actions: [
        { label: 'ไม่ใช่ตอนนี้', variant: 'ghost', onClick: function (m) { m.close(); } },
        { label: 'ยกเลิกนัด', variant: 'danger', onClick: function (m) { m.close(); _doCancel(playdateId); } },
      ],
    });
  }

  async function _doCancel(playdateId) {
    var fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['pd_' + playdateId] = true; _render();
    try {
      await fns.httpsCallable('cancelPetPlaydate')({ building: _bldg(), roomId: _room(), playdateId: String(playdateId) });
      _toast('ยกเลิกนัดแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยกเลิกไม่สำเร็จ'), 'error');
    } finally {
      delete _busy['pd_' + playdateId]; _render();
    }
  }

  function _playdateById(id) {
    for (var i = 0; i < _playdates.length; i++) if (String(_playdates[i].id) === String(id)) return _playdates[i];
    return null;
  }

  // ── public entry (nav render hook) ──────────────────────────────────────────
  // Called by shared/tenant-navigation.js showSubPage('pet-playdate-page'). Kicks
  // the sub (in case claims just arrived), re-reads own pets, then renders.
  function renderPetPlaydates() {
    _subscribe();
    if (!_ready()) { _render(); return; }
    _loadOwn().then(_render);
  }

  // ── exports + self-wire (§7-A) ──────────────────────────────────────────────
  window.PetPlaydate = {
    // pure (tested)
    isHost: isHost, slotsLeft: slotsLeft, roomJoined: roomJoined,
    isJoinable: isJoinable, isLive: isLive, clampCapacity: clampCapacity, fmtWhen: fmtWhen,
    // entry + debug
    renderPetPlaydates: renderPetPlaydates, _subscribe: _subscribe, _render: _render,
  };
  window.renderPetPlaydates = renderPetPlaydates;

  // Subscribe as soon as building/room claims are ready (never authReady/liffLinked
  // directly — §7-A). The _ready + idempotency guards make extra fires no-ops.
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(_subscribe);
  }
})();
