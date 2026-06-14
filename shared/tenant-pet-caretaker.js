/**
 * tenant-pet-caretaker.js — the Emergency Caretaker board (Meaning Layer #14,
 * 🆘🐾 หาคนช่วยดูแลสัตว์เลี้ยงยามฉุกเฉิน). Renders into the #pet-caretaker-page
 * sub-page (Pet Park → "หาคนช่วยดูแลน้องยามฉุกเฉิน" tile).
 *
 * An owner posts an urgent pet-sitting request (picking one of their approved
 * pets + a care window + what's needed) → a neighbour in the SAME building
 * accepts → the OWNER confirms the care is done (§6 peer-confirmed — the
 * caretaker never self-marks). Three live sections:
 *   • คำขอในตึก    — others' open requests → "รับดูแล" (acceptCaretakerRequest)
 *   • คำขอของฉัน   — my requests: open→cancel · accepted→ยืนยันเสร็จ / cancel · done
 *   • ที่ฉันรับดูแล  — requests I accepted: accepted→รอเจ้าของยืนยัน · done
 *
 * Clones the Meaning Layer #2 tenant-helpers.js spine wholesale (the same
 * §7-A/U claims guard · §7-N error callbacks · §7-V subscribe-once · §7-FFF
 * bucket-by-stable-identity · §7-I explicit-tap-only · §7-X non-empty paths ·
 * §7-RR static CSS · §7-R LIFF awaits time-boxed). For pet-sitting instead of
 * labour: the post form additionally reads the tenant's OWN approved pets
 * (tenants/{b}/list/{r}/pets — read-only, D1; never petProfiles/#10).
 *
 * ONE onSnapshot(`where building == myBuilding`) — single-field, auto-indexed
 * (§7-J, no composite index); client buckets by status + uid. Identity is by uid
 * (window._authUid, the stable line:Uxxx anchor — matches the CF gating, §7-HH).
 * D2 point-free: no points surface — care is its own reward.
 */
(function () {
  'use strict';

  let _raw = [];            // all caretakerRequests in my building (live)
  let _unsub = null;
  let _key = '';            // building the sub is bound to
  let _wired = false;       // static controls wired once
  let _ownPets = [];        // the tenant's own pets (getDocs on first open, §7-R timed)
  let _ownLoaded = false;
  const _busy = new Set();  // requestIds with an in-flight action
  const _confirmCancel = new Set(); // requestIds armed for a 2-tap cancel
  const _confirmDone = new Set();   // requestIds armed for a 2-tap confirm-done

  const URGENCY_LABEL = { urgent: '🚨 ด่วน', scheduled: '🗓️ ตามนัด' };
  const LIFF_TIMEOUT_MS = 8000;     // §7-R: time-box the own-pets read (LIFF webview can hang)

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _fns() { return window.firebase && window.firebase.functions; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _uid() { return window._authUid || ''; }   // canonical stable uid (§7-BB); no compat firebase.auth() (§7-B)
  function _who(building, room) { return (building === 'nest' ? 'Nest ' : 'ห้อง ') + room; }
  function _myLabel() { return _who(_bldg(), _room()); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }

  function _ms(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const n = Date.parse(ts); return Number.isFinite(n) ? n : 0;
  }
  function _byNewest(a, b) {
    return _ms(b.createdAt || b.acceptedAt) - _ms(a.createdAt || a.acceptedAt);
  }

  // §7-R: race any LIFF-path await against a timeout so a hung webview never
  // freezes the form open. Returns a sentinel on timeout (treated as "no pets").
  function _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  // ── Pure helpers (exported + unit-tested) ──────────────────────────────────
  // Bucket a request relative to the viewer (§7-FFF — by stable uid, NOT a live
  // recompute against a possibly-not-yet-loaded value). myUid '' (pre-auth) →
  // nothing is "mine", which is the safe default (render shows others' only).
  function isRequester(req, myUid) { return !!myUid && (req && req.requesterUid) === myUid; }
  function isCaretaker(req, myUid) { return !!myUid && (req && req.caretakerUid) === myUid; }

  // Format the care window "20 มิ.ย. 08:00 – 22 มิ.ย. 18:00" (Thai locale, BKK).
  function fmtPeriod(period) {
    if (!period) return '';
    const from = _ms(period.from);
    const to = _ms(period.to);
    if (!from || !to) return '';
    const opt = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' };
    try {
      const f = new Date(from).toLocaleString('th-TH', opt);
      const t = new Date(to).toLocaleString('th-TH', opt);
      return `${f} – ${t}`;
    } catch (_) { return ''; }
  }

  // ── Own approved pets (read-only, D1) — loaded once on first open (§7-R) ────
  async function _loadOwnPets() {
    if (_ownLoaded) return;
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    const b = _bldg(); const r = _room();
    if (!b || !r) return;                 // §7-U: wait for claims
    try {
      const snap = await _withTimeout(fs.getDocs(fs.collection(db, 'tenants', b, 'list', r, 'pets')), LIFF_TIMEOUT_MS);
      _ownPets = snap.docs
        .map(d => Object.assign({ petId: d.id }, d.data()))
        .filter(p => p.status === 'approved');   // only approved pets can be posted (matches the CF gate)
      _ownLoaded = true;
    } catch (e) {
      if (!/permission|timeout/i.test((e && e.message) || '')) console.warn('[caretaker] own-pets read failed:', e && e.message);
    }
    _paintPetOptions();
  }

  // ── Live subscription: every request in my building (§7-J single-field) ────
  function _subscribe() {
    const b = _bldg();
    if (!b) return;                       // §7-U: wait for claims
    if (_unsub && _key === b) return;     // §7-V: already bound to this building
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    _key = b;
    const q = fs.query(fs.collection(db, 'caretakerRequests'), fs.where('building', '==', b));
    _unsub = fs.onSnapshot(q, snap => {
      _raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
    }, err => {                            // §7-N: error callback, never silent
      _key = '';                           // allow a clean re-subscribe after a transient denial
      if (!/permission/i.test((err && err.message) || '')) console.warn('[caretaker] sub failed:', err && err.message);
    });
  }

  // ── Render the three buckets ───────────────────────────────────────────────
  function _render() {
    if (!document.getElementById('pet-caretaker-page')) return;
    const myUid = _uid();
    const open = _raw.filter(r => r.status === 'open' && !isRequester(r, myUid)).sort(_byNewest);
    const mine = _raw.filter(r => isRequester(r, myUid) && r.status !== 'cancelled').sort(_byNewest);
    const jobs = _raw.filter(r => isCaretaker(r, myUid) && r.status !== 'cancelled').sort(_byNewest);
    _renderList('pc-open-list', 'pc-open-count', open, 'open', 'ยังไม่มีคำขอผู้ดูแลในตึกตอนนี้ 🌱');
    _renderList('pc-mine-list', 'pc-mine-count', mine, 'mine', 'คุณยังไม่ได้โพสต์คำขอ');
    _renderList('pc-jobs-list', 'pc-jobs-count', jobs, 'jobs', 'ยังไม่ได้รับดูแลให้ใคร — ดูที่ "คำขอในตึก"');
  }

  function _renderList(listId, countId, rows, kind, emptyMsg) {
    const el = document.getElementById(listId);
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = String(rows.length);
    if (!el) return;
    if (!rows.length) {                      // §7-X: always a non-empty fallback
      el.innerHTML = '<div class="pc-empty">' + emptyMsg + '</div>';
      return;
    }
    el.innerHTML = '';
    rows.forEach(r => el.appendChild(_card(r, kind)));
  }

  function _card(r, kind) {
    const card = document.createElement('div');
    card.className = 'pc-card';
    card.dataset.status = r.status || 'open';

    const main = document.createElement('div');
    main.className = 'pc-card__main';

    const title = document.createElement('p');
    title.className = 'pc-card__title';
    const emoji = r.petTypeEmoji ? r.petTypeEmoji + ' ' : '🐾 ';
    title.textContent = emoji + (r.petName || 'สัตว์เลี้ยง');
    main.appendChild(title);

    if (r.need) {
      const need = document.createElement('p');
      need.className = 'pc-card__need';
      need.textContent = r.need;
      main.appendChild(need);
    }

    const sub = document.createElement('p');
    sub.className = 'pc-card__sub';
    sub.textContent = _subLine(r, kind);
    main.appendChild(sub);

    const side = document.createElement('div');
    side.className = 'pc-card__side';
    _actionsFor(r, kind).forEach(node => side.appendChild(node));

    card.appendChild(main);
    card.appendChild(side);
    return card;
  }

  function _subLine(r, kind) {
    const urg = (r.urgency && URGENCY_LABEL[r.urgency]) ? URGENCY_LABEL[r.urgency] + ' · ' : '';
    const when = fmtPeriod(r.period);
    const whenStr = when ? when + ' · ' : '';
    if (kind === 'open') return urg + whenStr + _who(r.building, r.room);
    if (kind === 'mine') {
      if (r.status === 'open') return urg + whenStr + 'รอเพื่อนบ้านรับดูแล…';
      if (r.status === 'accepted') return '✅ ' + _who(r.caretakerBuilding, r.caretakerRoom) + ' กำลังช่วยดูแล';
      if (r.status === 'done') {
        const who = (r.caretakerBuilding && r.caretakerRoom) ? _who(r.caretakerBuilding, r.caretakerRoom) : '';
        return who ? 'ขอบคุณ ' + who + ' · ดูแลเสร็จแล้ว 💚' : 'ดูแลเสร็จแล้ว 💚';
      }
    }
    if (kind === 'jobs') {
      if (r.status === 'accepted') return urg + whenStr + 'คุณกำลังช่วยดูแลให้ ' + _who(r.building, r.room) + ' — รอเจ้าของยืนยัน';
      if (r.status === 'done') return 'ช่วยดูแลให้ ' + _who(r.building, r.room) + ' · เสร็จแล้ว 💚';
    }
    return urg + whenStr;
  }

  function _btn(label, cls, handler) {
    const b = document.createElement('button');
    b.className = 'pc-btn ' + (cls || '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', handler);   // §7-JJJ: DIRECT listener for an arg-taking action
    return b;
  }
  function _badge(label) {
    const b = document.createElement('span');
    b.className = 'pc-badge';
    b.textContent = label;
    return b;
  }

  function _actionsFor(r, kind) {
    if (_busy.has(r.id)) return [_badge('⏳')];
    if (kind === 'open') {
      return [_btn('🐾 รับดูแล', 'pc-btn--accept', () => _accept(r))];
    }
    if (kind === 'mine') {
      if (r.status === 'open') return [_cancelBtn(r)];
      if (r.status === 'accepted') return [_doneBtn(r), _cancelBtn(r)];
      return []; // done — sub-line shows the outcome
    }
    if (kind === 'jobs') {
      if (r.status === 'accepted') return [_badge('กำลังดูแล')];
      return [];
    }
    return [];
  }

  // Two-tap cancel: first tap arms, second tap within the same render cancels.
  function _cancelBtn(r) {
    const armed = _confirmCancel.has(r.id);
    return _btn(armed ? 'แน่ใจ? ยกเลิก' : 'ยกเลิก', armed ? 'pc-btn--danger' : 'pc-btn--ghost', () => {
      if (!_confirmCancel.has(r.id)) { _confirmCancel.add(r.id); _render(); return; }
      _confirmCancel.delete(r.id);
      _cancel(r);
    });
  }
  // Two-tap confirm-done (the OWNER confirms the care happened — §6).
  function _doneBtn(r) {
    const armed = _confirmDone.has(r.id);
    return _btn(armed ? 'แน่ใจ? เสร็จแล้ว' : 'ยืนยันเสร็จสิ้น', armed ? 'pc-btn--done' : 'pc-btn--primary', () => {
      if (!_confirmDone.has(r.id)) { _confirmDone.add(r.id); _render(); return; }
      _confirmDone.delete(r.id);
      _complete(r);
    });
  }

  // ── Actions (§7-I: explicit tap → callable; nothing auto-clicks) ───────────
  async function _post() {
    const petEl = document.getElementById('pc-post-pet');
    const fromEl = document.getElementById('pc-post-from');
    const toEl = document.getElementById('pc-post-to');
    const needEl = document.getElementById('pc-post-need');
    const urgEl = document.getElementById('pc-post-urgency');

    const petId = petEl && petEl.value;
    if (!petId) { _toast('กรุณาเลือกสัตว์เลี้ยง', 'warning'); return; }
    const need = (needEl && needEl.value || '').trim();
    if (!need) { _toast('กรุณาระบุสิ่งที่ต้องการให้ช่วยดูแล', 'warning'); return; }
    const fromMs = fromEl && fromEl.value ? Date.parse(fromEl.value) : NaN;
    const toMs = toEl && toEl.value ? Date.parse(toEl.value) : NaN;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) { _toast('กรุณาระบุช่วงเวลาที่ต้องการให้ช่วยดูแล', 'warning'); return; }
    if (toMs <= fromMs) { _toast('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'warning'); return; }

    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    const b = _bldg(); const r = _room();
    if (!b || !r) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่อีกครั้ง', 'error'); return; }

    const btn = document.getElementById('pc-post-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังโพสต์…'; }
    try {
      await fns.httpsCallable('postCaretakerRequest')({
        building: b, roomId: r,
        petId,
        period: { from: fromMs, to: toMs },
        need,
        urgency: (urgEl && urgEl.value) || 'scheduled',
        requesterName: _myLabel(),
      });
      if (needEl) needEl.value = '';
      if (fromEl) fromEl.value = '';
      if (toEl) toEl.value = '';
      _togglePostForm(false);
      _toast('โพสต์คำขอแล้ว 🐾 รอเพื่อนบ้านมาช่วยดูแล', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'โพสต์ไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'โพสต์คำขอ'; }
    }
  }

  async function _accept(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    const b = _bldg(); const room = _room();
    if (!b || !room) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('acceptCaretakerRequest')({
        requestId: r.id, building: b, roomId: room, caretakerName: _myLabel(),
      });
      _toast('รับดูแลแล้ว 🙌 ขอบคุณสำหรับน้ำใจ', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'รับไม่สำเร็จ — อาจมีคนรับไปก่อนแล้ว'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  async function _complete(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('completeCaretakerRequest')({ requestId: r.id });
      _toast('ยืนยันการดูแลเสร็จสิ้นแล้ว 💚', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยืนยันไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  async function _cancel(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('cancelCaretakerRequest')({ requestId: r.id });
      _toast('ยกเลิกคำขอแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยกเลิกไม่สำเร็จ'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  function _errMsg(e, fallback) {
    const code = String((e && e.code) || '');
    const msg = String((e && e.message) || '');
    return (/internal|unknown|unavailable|deadline/i.test(code) || !msg) ? fallback : msg;
  }

  // ── Pet picker options (§7-X: explicit empty-state → registration) ──────────
  function _paintPetOptions() {
    const sel = document.getElementById('pc-post-pet');
    const empty = document.getElementById('pc-no-pets');
    const toggle = document.getElementById('pc-post-toggle');
    if (!sel) return;
    if (!_ownPets.length) {
      sel.innerHTML = '';
      if (empty) empty.classList.remove('u-hidden');
      if (toggle) toggle.classList.add('u-hidden');   // nothing to post → hide the open-form button
      return;
    }
    if (empty) empty.classList.add('u-hidden');
    if (toggle) toggle.classList.remove('u-hidden');
    sel.innerHTML = _ownPets.map(p => {
      const label = (p.typeEmoji ? p.typeEmoji + ' ' : '') + (p.name || 'สัตว์เลี้ยง');
      return '<option value="' + _attr(p.petId) + '">' + _esc(label) + '</option>';
    }).join('');
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function _attr(s) { return _esc(s); }

  // ── Static-control wiring (once) ───────────────────────────────────────────
  function _togglePostForm(show) {
    const form = document.getElementById('pc-post-form');
    const toggle = document.getElementById('pc-post-toggle');
    if (!form) return;
    const open = (show === undefined) ? form.classList.contains('u-hidden') : show;
    form.classList.toggle('u-hidden', !open);
    if (toggle) toggle.textContent = open ? '✕ ปิดฟอร์ม' : '+ ขอคนช่วยดูแลน้อง';
  }

  function _wire() {
    if (_wired) return;
    const page = document.getElementById('pet-caretaker-page');
    if (!page) return;
    _wired = true;
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('pc-post-toggle', 'click', () => _togglePostForm());
    on('pc-post-submit', 'click', _post);
  }

  // ── Public entry — wire + load pets + subscribe + render (idempotent) ──────
  function renderPetCaretaker() {
    _wire();
    _loadOwnPets();   // async, paints the picker when ready
    _subscribe();
    _render();
  }

  window.renderPetCaretaker = renderPetCaretaker;
  // Pure helpers exposed for unit testing (and future reuse).
  window._petCaretakerHelpers = { isRequester, isCaretaker, fmtPeriod };

  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderPetCaretaker(); });
  }
})();
