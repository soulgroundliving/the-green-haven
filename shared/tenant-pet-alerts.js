/*
 * Lost Pet Alert — tenant building-wide "my pet is missing" broadcast (Meaning
 * Layer #13). The frontend for the raisePetAlert / resolvePetAlert callables +
 * the petAlerts/{alertId} collection.
 *
 * The owner picks one of their APPROVED pets, types where it was last seen (+ an
 * optional contact note), confirms a preview of the building-wide push, and
 * raises a 🆘 alert. Every approved neighbour in the SAME building gets a LINE
 * push and sees the alert card here; the owner taps "✅ เจอแล้ว" to resolve it.
 *
 * One live source, building-scoped (single-field where building== → no composite
 * index, §7-J/N-safe). The client filters status==='active' && expiresAt>now and
 * sorts by createdAt IN JS (§7-AAA: never an unordered limit()).
 *
 * Privacy: the alert card only shows the SAFE snapshot raisePetAlert copied
 * (petName / petTypeEmoji / petPhotoURL + owner room label). health / vaccine
 * NEVER reach petAlerts (CF whitelist). Raising is owner-initiated, own pet, each
 * alert is an explicit per-event action (= implicit consent) + auto-expires — so
 * no separate consent doc (lean, like #9 pet-health).
 *
 * Anti-patterns honoured: §7-A/U/BB self-wire via _onLiffClaimsReady + the
 * _tenantAppBuilding/_tenantAppRoom globals (never the phantom _liffClaims), claim
 * guard before the first read · §7-N onSnapshot error callback that resets the
 * unsub so a later claims-ready fire retries · §7-V unsub-before-rebind on a
 * building change · §7-X every render path writes non-empty content · §7-FFF "my
 * own alert" buckets by ROOM identity (ownerRoom), not auth uid · §7-RR all
 * styling is static .pet-alert__* in components.css (never an injected <style>) ·
 * §7-I tenant-initiated only — the building-wide push is previewed behind a
 * GhModal confirm before it fires (the CF ALSO hard rate-limits 2/day server-side)
 * · §7-R the own-pets getDocs is Promise.race-timeout-wrapped · §7-JJJ direct
 * listeners in this module (no data-action hub) · escaping on every piece of user
 * text ([[feedback_modal_security]]) · window.* exports (§7-QQ/CC).
 *
 * Pure helpers (isOwnAlert / isActiveAlert / fmtLastSeen / alertSortKey) are
 * exported on window.PetAlerts for unit tests (shared/__tests__/tenant-pet-alerts.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-pet-alerts.test.js
 */
(function () {
  'use strict';

  var MAX_LAST_SEEN_LEN = 200;       // mirrors functions/_petAlertEngine.js
  var MAX_CONTACT_LEN = 200;

  // §7-GG: LIFF's auth handshake can DROP ?query= before _maybeRoute() runs (it
  // fires on _onLiffClaimsReady, AFTER auth). Capture the ?page=pet-alert intent
  // into localStorage NOW — at module load (this <script> at tenant_app.html runs
  // before tenant-liff-auth's flow) — so the 🆘 Flex deep-link survives a stripped
  // query. _maybeRoute() recovers + clears it on route (one-shot, never sticky).
  var DEEPLINK_LS_KEY = 'petAlertDeepLink';
  try {
    var _dlPage = (new URLSearchParams(window.location.search).get('page') || '').toLowerCase();
    if (_dlPage === 'pet-alert' || _dlPage === 'pet-alert-page') localStorage.setItem(DEEPLINK_LS_KEY, '1');
  } catch (_) {}

  // ── PURE helpers (tested; safe in the node test realm) ──────────────────────

  /** Trim + length-cap the free-text "last seen". Mirrors the engine safeLastSeen. */
  function fmtLastSeen(t) {
    return String(t == null ? '' : t).trim().slice(0, MAX_LAST_SEEN_LEN);
  }

  /** Trim + length-cap the optional owner contact note. Mirrors the engine safeContact. */
  function fmtContact(t) {
    return String(t == null ? '' : t).trim().slice(0, MAX_CONTACT_LEN);
  }

  // expiresAt may be a Firestore Timestamp, a {seconds}/{_ms} shape, or epoch-ms.
  function _expiryMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts._ms === 'number') return ts._ms;
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    var n = Number(ts);
    return isFinite(n) ? n : 0;
  }

  /**
   * Is this alert live RIGHT NOW? status must be 'active' AND it must not have
   * passed its expiresAt (the server sweep is a follow-up, so the client is the
   * authority on hiding expired alerts — D4/§7-J). Mirrors the engine isExpired.
   */
  function isActiveAlert(alert, nowMs) {
    if (!alert || alert.status !== 'active') return false;
    var exp = _expiryMs(alert.expiresAt);
    if (exp > 0 && Number(nowMs) >= exp) return false;   // expired → not active anymore
    return true;
  }

  /**
   * §7-FFF own-filter: is this alert one of MY room's? Buckets by ROOM identity
   * (ownerRoom), never auth uid — correct for real tenants, admin preview, and
   * before the auth uid loads.
   */
  function isOwnAlert(alert, myRoom) {
    return !!alert && String(alert.ownerRoom) === String(myRoom);
  }

  // createdAt may be a Timestamp / {seconds} / {_ms} / ms — newest first.
  function alertSortKey(alert) {
    if (!alert) return 0;
    var c = alert.createdAt;
    if (!c) return 0;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c._ms === 'number') return c._ms;
    if (typeof c.seconds === 'number') return c.seconds * 1000;
    var n = Number(c);
    return isFinite(n) ? n : 0;
  }

  // ── browser-only state + helpers (skipped under node --test) ────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        fmtLastSeen: fmtLastSeen, fmtContact: fmtContact,
        isActiveAlert: isActiveAlert, isOwnAlert: isOwnAlert, alertSortKey: alertSortKey,
      };
    }
    return;
  }

  var LIST_ID = 'pet-alert-list';

  var _alertsUnsub = null;     // petAlerts onSnapshot unsub (§7-V)
  var _subKey = '';            // building the sub is bound to (rebind on change)
  var _alerts = [];            // live petAlerts in the building
  var _ownPets = [];           // tenant's own pets (getDocs on open)
  var _ownLoaded = false;
  var _tenantId = '';          // canonical tenants/{b}/list/{r}.tenantId
  var _selPetId = '';          // selected own pet for the raise form
  var _busy = {};              // key -> true while a callable is in flight
  var _routedOnce = false;     // deep-link ?page=pet-alert handled once

  function _fs() { var f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { var f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _fns() { var f = window.firebase; return f && f.functions; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _ready() { return !!(_bldg() && _room() && _fs() && _db()); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }
  function _now() { return Date.now(); }

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

  // ── live subscription (claims-ready, §7-A/U/V) ──────────────────────────────
  function _subscribe() {
    if (!_ready()) return;                          // §7-U: claim-presence guard
    var b = _bldg();
    if (_alertsUnsub && _subKey === b) return;      // §7-V idempotent
    _teardown();                                    // building changed (or first run) → tear down stale sub
    var fs = _fs(); var db = _db();
    _subKey = b;
    try {
      var q = fs.query(fs.collection(db, 'petAlerts'), fs.where('building', '==', b));
      _alertsUnsub = fs.onSnapshot(q, function (snap) {
        _alerts = snap.docs.map(function (d) { return Object.assign({ alertId: d.id }, d.data()); });
        _render();
      }, function (err) {                           // §7-N: error cb, reset unsub so a later claims-ready fire retries
        if (!/permission/i.test((err && err.message) || '')) console.warn('[pet-alerts] sub failed:', err && (err.code || err.message));
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) { _alertsUnsub = null; _subKey = ''; }
        var root = document.getElementById(LIST_ID);
        if (root && !_alerts.length) root.innerHTML = _muted('โหลดไม่สำเร็จ — กรุณาเปิดผ่าน LINE แล้วลองใหม่');
      });
    } catch (e) {
      console.warn('[pet-alerts] subscribe init failed:', e && e.message || e);
    }
  }

  function _teardown() {
    if (_alertsUnsub) { try { _alertsUnsub(); } catch (_) {} _alertsUnsub = null; }
  }

  // Own pets (+ canonical tenantId) — read once per open; cheap getDocs, not a 2nd
  // live sub. §7-R: race a timeout so a hung LIFF-webview read surfaces as an error
  // instead of an indefinite spinner.
  function _withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) { setTimeout(function () { var e = new Error('การเชื่อมต่อหมดเวลา'); e.code = 'timeout'; rej(e); }, ms || 12000); }),
    ]);
  }

  async function _loadOwn() {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return;
    var b = _bldg(); var r = _room();
    try {
      var rosterSnap = await _withTimeout(fs.getDoc(fs.doc(db, 'tenants', b, 'list', r)));
      _tenantId = (rosterSnap && rosterSnap.exists()) ? String((rosterSnap.data() || {}).tenantId || '') : '';
    } catch (_) { /* permission pre-link / timeout — quiet (§7-N) */ }
    try {
      var petsSnap = await _withTimeout(fs.getDocs(fs.collection(db, 'tenants', b, 'list', r, 'pets')));
      _ownPets = petsSnap.docs.map(function (d) { return Object.assign({ petId: d.id }, d.data()); });
      _ownLoaded = true;
    } catch (e) {
      if (!/permission/i.test((e && e.message) || '')) console.warn('[pet-alerts] own-pets read failed:', e && e.message);
    }
  }

  // ── derived selectors ───────────────────────────────────────────────────────
  function _activeAlerts() {
    var now = _now();
    return _alerts.filter(function (a) { return isActiveAlert(a, now); })
      .sort(function (a, b) { return alertSortKey(b) - alertSortKey(a); });   // newest first
  }
  function _approvedOwnPets() {
    return _ownPets.filter(function (p) { return p.status === 'approved'; });
  }
  // Does the owner already have an active alert for this pet? (mirror the CF dup guard)
  function _activeAlertForPet(petId) {
    var now = _now();
    for (var i = 0; i < _alerts.length; i++) {
      if (String(_alerts[i].petId) === String(petId) && isActiveAlert(_alerts[i], now)) return _alerts[i];
    }
    return null;
  }
  function _selectedPet() {
    var approved = _approvedOwnPets();
    if (!approved.length) { _selPetId = ''; return null; }
    var found = _selPetId && approved.filter(function (p) { return String(p.petId) === String(_selPetId); })[0];
    if (!found) { _selPetId = String(approved[0].petId); found = approved[0]; }
    return found;
  }

  // ── render (§7-X: every section + path writes non-empty content) ────────────
  function _muted(text) { return '<div class="pet-alert__muted">' + _esc(text) + '</div>'; }

  function _avatar(a) {
    if (a && a.petPhotoURL) {
      return '<div class="pet-alert__avatar"><img src="' + _esc(a.petPhotoURL) + '" alt="" loading="lazy"></div>';
    }
    return '<div class="pet-alert__avatar" aria-hidden="true">' + _esc((a && a.petTypeEmoji) || '🐾') + '</div>';
  }

  function _render() {
    var root = document.getElementById(LIST_ID);
    if (!root) return;
    if (!_ready()) { root.innerHTML = _muted('กำลังเตรียมข้อมูล… กรุณาเปิดผ่าน LINE'); return; }
    root.innerHTML = _sectionRaise() + _sectionActive();
    _wire(root);
  }

  // Section A — raise form (pick own approved pet + lastSeen + optional contact).
  function _sectionRaise() {
    var html = '<div class="pet-alert__section-title">แจ้งน้องหาย</div>';
    if (!_ownLoaded && !_ownPets.length) {
      return html + '<div class="pet-alert__empty">กำลังโหลดสัตว์เลี้ยงของคุณ…</div>';
    }
    var approved = _approvedOwnPets();
    if (!approved.length) {
      return html + '<div class="pet-alert__empty">ยังไม่มีน้องที่อนุมัติ — เพิ่มและรออนุมัติในหน้า Pet Park ก่อนจึงจะแจ้งหายได้ 🐾' +
        '<div class="pet-alert__actions" style="justify-content:center;margin-top:10px;">' +
        '<button type="button" class="pet-alert__btn pet-alert__btn--ghost" data-pa="go-petpark">ไปหน้า Pet Park</button></div></div>';
    }

    var sel = _selectedPet();
    var existing = sel ? _activeAlertForPet(sel.petId) : null;
    var busy = !!_busy['raise'];

    var selector = approved.length > 1
      ? '<select class="pet-alert__select" data-pa="select-pet">' +
          approved.map(function (p) {
            return '<option value="' + _esc(p.petId) + '"' + (String(p.petId) === String(_selPetId) ? ' selected' : '') + '>น้อง' + _esc(p.name) + '</option>';
          }).join('') + '</select>'
      : '<div class="pet-alert__pet-name">น้อง' + _esc((sel && sel.name) || '') + '</div>';

    var card = '<div class="pet-alert__card pet-alert__card--raise">' +
      _avatar(sel ? { petPhotoURL: sel.photoURL, petTypeEmoji: sel.typeEmoji || sel.type } : null) +
      '<div class="pet-alert__body">' +
        '<label class="pet-alert__label">น้องที่หาย</label>' + selector;

    if (existing) {
      // Already broadcasting for this pet — show resolve, not a second raise.
      card += '<div class="pet-alert__pill pet-alert__pill--live">📣 กำลังประกาศตามหาน้องตัวนี้อยู่</div>' +
        '<div class="pet-alert__actions">' +
          '<button type="button" class="pet-alert__btn pet-alert__btn--found" data-pa="resolve" data-aid="' + _esc(existing.alertId) + '"' + (busy ? ' disabled' : '') + '>✅ เจอแล้ว</button>' +
        '</div>';
    } else {
      card +=
        '<label class="pet-alert__label">เห็นครั้งสุดท้ายที่ไหน</label>' +
        '<input type="text" class="pet-alert__input" data-pa="lastseen" maxlength="' + MAX_LAST_SEEN_LEN + '" placeholder="เช่น แถวลิฟต์ชั้น 3 เมื่อเช้านี้">' +
        '<label class="pet-alert__label">เบอร์ติดต่อ/ข้อความ (ถ้ามี)</label>' +
        '<input type="text" class="pet-alert__input" data-pa="contact" maxlength="' + MAX_CONTACT_LEN + '" placeholder="เช่น โทร 08x-xxx-xxxx">' +
        '<div class="pet-alert__actions">' +
          '<button type="button" class="pet-alert__btn pet-alert__btn--alert" data-pa="raise"' + (busy ? ' disabled' : '') + '>' + (busy ? 'กำลังส่ง…' : '🆘 แจ้งหาย — แจ้งเตือนทั้งอาคาร') + '</button>' +
        '</div>' +
        '<p class="pet-alert__hint">เพื่อนบ้านที่อนุมัติแล้วทุกห้องในอาคารจะได้รับการแจ้งเตือนทาง LINE</p>';
    }
    card += '</div></div>';
    return html + card;
  }

  // Section B — active alerts in the building (own alert shows ✅ เจอแล้ว, §7-FFF).
  function _sectionActive() {
    var active = _activeAlerts();
    var myRoom = _room();
    var html = '<div class="pet-alert__section-title">น้องที่กำลังตามหาในอาคาร</div>';
    if (!active.length) {
      return html + '<div class="pet-alert__empty">ตอนนี้ไม่มีน้องที่กำลังตามหา 🌿</div>';
    }
    html += active.map(function (a) {
      var own = isOwnAlert(a, myRoom);
      var aid = _esc(a.alertId);
      var busy = !!_busy['resolve_' + a.alertId];
      var meta = '<strong class="pet-alert__name">' + _esc(a.petTypeEmoji || '🐾') + ' น้อง' + _esc(a.petName || '') + '</strong>' +
        '<span class="pet-alert__sub">หาย · ห้อง ' + _esc(a.ownerRoom || '') + (own ? ' (น้องของคุณ)' : '') + '</span>';
      var lastSeen = a.lastSeen ? '<p class="pet-alert__detail">เห็นล่าสุด: ' + _esc(a.lastSeen) + '</p>' : '';
      var contact = a.contactNote ? '<p class="pet-alert__detail pet-alert__detail--contact">' + _esc(a.contactNote) + '</p>' : '';
      var action = own
        ? '<div class="pet-alert__actions"><button type="button" class="pet-alert__btn pet-alert__btn--found" data-pa="resolve" data-aid="' + aid + '"' + (busy ? ' disabled' : '') + '>✅ เจอแล้ว</button></div>'
        : '<div class="pet-alert__actions"><span class="pet-alert__hint">เห็นน้องช่วยแจ้งห้อง ' + _esc(a.ownerRoom || '') + ' ด้วยนะครับ 🙏</span></div>';
      return '<div class="pet-alert__card pet-alert__card--active' + (own ? ' pet-alert__card--own' : '') + '">' + _avatar(a) +
        '<div class="pet-alert__body">' + meta + lastSeen + contact + action + '</div></div>';
    }).join('');
    return html;
  }

  // ── wire (direct listeners — pet-social pattern, no data-action hub §7-JJJ) ──
  function _wire(root) {
    root.querySelectorAll('[data-pa]').forEach(function (el) {
      var kind = el.getAttribute('data-pa');
      if (kind === 'select-pet') {
        el.addEventListener('change', function () { _selPetId = String(el.value || ''); _render(); });
        return;
      }
      if (kind === 'lastseen' || kind === 'contact') return;   // plain inputs — read at submit
      el.addEventListener('click', function () {
        if (kind === 'raise') return _onRaiseClick();
        if (kind === 'resolve') return _resolve(el.getAttribute('data-aid'));
        if (kind === 'go-petpark') { if (typeof window.showSubPage === 'function') window.showSubPage('pet-park-page'); return; }
      });
    });
  }

  function _readField(kind) {
    var el = document.querySelector('[data-pa="' + kind + '"]');
    return el ? String(el.value || '') : '';
  }

  // ── data ops (callables; §7-I tenant-initiated + confirm-modal preview) ─────
  function _onRaiseClick() {
    var pet = _selectedPet();
    if (!pet) { _toast('เลือกน้องที่หายก่อนนะครับ', 'warning'); return; }
    if (pet.status !== 'approved') { _toast('สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะแจ้งหายได้', 'warning'); return; }
    if (_activeAlertForPet(pet.petId)) { _toast('มีประกาศตามหาน้องตัวนี้อยู่แล้ว', 'warning'); return; }
    var lastSeen = fmtLastSeen(_readField('lastseen'));
    var contact = fmtContact(_readField('contact'));

    // §7-I: a building-wide push is a MASS action → preview it behind a confirm
    // modal before it fires (the CF also hard rate-limits 2/day). GhModal, never
    // window.confirm (feedback_modal_security). Fall back to confirm if absent.
    var previewLines = 'น้อง' + (pet.name || '') + ' หาย';
    if (lastSeen) previewLines += '\nเห็นล่าสุด: ' + lastSeen;
    var body = 'จะส่งแจ้งเตือน 🆘 ทาง LINE ถึงเพื่อนบ้านที่อนุมัติแล้วทุกห้องในอาคาร เพื่อช่วยกันตามหา' +
      '\n\n' + previewLines + '\n\nยืนยันส่งการแจ้งเตือน?';
    if (!window.GhModal || typeof window.GhModal.open !== 'function') {
      if (window.confirm('แจ้งน้องหายทั้งอาคาร?\n\n' + body)) _doRaise(pet.petId, lastSeen, contact);
      return;
    }
    window.GhModal.open({
      title: '🆘 แจ้งน้องหายทั้งอาคาร?',
      body: body,
      size: 'small',
      actions: [
        { label: 'ยกเลิก', variant: 'ghost', onClick: function (m) { m.close(); } },
        { label: 'ยืนยันแจ้งหาย', variant: 'danger', onClick: function (m) { m.close(); _doRaise(pet.petId, lastSeen, contact); } },
      ],
    });
  }

  async function _doRaise(petId, lastSeen, contact) {
    if (!petId) return;
    var fns = _fns();
    if (!fns || typeof fns.httpsCallable !== 'function') { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    if (!_bldg() || !_room()) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    _busy['raise'] = true; _render();
    try {
      var res = await fns.httpsCallable('raisePetAlert')({
        building: _bldg(), roomId: _room(), petId: String(petId),
        lastSeen: lastSeen || '', contactNote: contact || '',
      });
      var n = (res && res.data && typeof res.data.pushed === 'number') ? res.data.pushed : null;
      _toast(n != null ? ('แจ้งเตือนเพื่อนบ้านแล้ว ' + n + ' ห้อง 🆘') : 'แจ้งน้องหายแล้ว 🆘', 'success');
      // The onSnapshot will surface the new alert; no optimistic insert needed (the
      // alert appears in Section B within a moment, and the form flips to resolve).
    } catch (e) {
      _toast(_errMsg(e, 'แจ้งหายไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy['raise']; _render();
    }
  }

  async function _resolve(alertId) {
    if (!alertId) return;
    var fns = _fns();
    if (!fns || typeof fns.httpsCallable !== 'function') { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy['resolve_' + alertId] = true; _busy['raise'] = true; _render();
    try {
      await fns.httpsCallable('resolvePetAlert')({ building: _bldg(), roomId: _room(), alertId: String(alertId) });
      // Optimistically flip it locally so the card clears immediately (the
      // onSnapshot update lags the CF write); the server snapshot reconciles.
      for (var i = 0; i < _alerts.length; i++) {
        if (String(_alerts[i].alertId) === String(alertId)) { _alerts[i] = Object.assign({}, _alerts[i], { status: 'resolved' }); break; }
      }
      _toast('ดีใจด้วยที่เจอน้องแล้วนะครับ 🎉', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      delete _busy['resolve_' + alertId]; delete _busy['raise']; _render();
    }
  }

  // ── deep-link route (§7-GG: LIFF can drop ?query — but the LINE Flex button URL
  // carries ?page=pet-alert and the in-app browser keeps it; tenant-liff-auth.js
  // owns the canonical router, so this module self-routes for its own page without
  // editing that file). Runs once, when the page surface + claims are ready.
  function _maybeRoute() {
    if (_routedOnce) return;
    var target = '';
    try { target = (new URLSearchParams(window.location.search).get('page') || '').toLowerCase(); } catch (_) {}
    var wantAlert = (target === 'pet-alert' || target === 'pet-alert-page');
    // §7-GG fallback: recover the intent persisted at module load if a LIFF
    // redirect stripped the query between load and now.
    if (!wantAlert) { try { wantAlert = localStorage.getItem(DEEPLINK_LS_KEY) === '1'; } catch (_) {} }
    if (wantAlert) {
      _routedOnce = true;
      try { localStorage.removeItem(DEEPLINK_LS_KEY); } catch (_) {}  // one-shot — never sticky
      if (typeof window.showSubPage === 'function') { try { window.showSubPage('pet-alert-page'); } catch (_) {} }
    }
  }

  // ── public entry (nav render hook) ──────────────────────────────────────────
  // Called by shared/tenant-navigation.js showSubPage('pet-alert-page'). Kicks the
  // sub (in case claims just arrived), re-reads own pets, then renders.
  function renderPetAlerts() {
    _subscribe();
    if (!_ready()) { _render(); return; }
    _loadOwn().then(_render);
  }

  // ── exports + self-wire (§7-A) ──────────────────────────────────────────────
  window.PetAlerts = {
    // pure (tested)
    fmtLastSeen: fmtLastSeen, fmtContact: fmtContact,
    isActiveAlert: isActiveAlert, isOwnAlert: isOwnAlert, alertSortKey: alertSortKey,
    // entry + debug
    renderPetAlerts: renderPetAlerts, _subscribe: _subscribe, _render: _render,
  };
  window.renderPetAlerts = renderPetAlerts;

  // Subscribe as soon as building/room claims are ready (never authReady/liffLinked
  // directly — §7-A). The _ready + idempotency guards make extra fires no-ops. Also
  // try the deep-link route once claims are in (so the 🆘 Flex button lands here).
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { _subscribe(); _maybeRoute(); });
  }
})();
