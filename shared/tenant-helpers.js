/**
 * tenant-helpers.js — the neighbor Helper board (Meaning Layer #2). Renders into
 * the #helper-board sub-page (Profile → "ช่วยเหลือเพื่อนบ้าน" tile).
 *
 * A tenant posts a help request → a neighbor in the SAME building accepts → the
 * requester confirms-done + rates 1-5 → the helper earns peer-confirmed kindness
 * points (server-side, completeHelpRequest). Three live sections:
 *   • เปิดรับ      — others' open requests → "รับช่วย" (acceptHelpRequest)
 *   • คำขอของฉัน   — my requests: open→cancel · accepted→ยืนยัน+ดาว / cancel · done→⭐
 *   • งานที่ฉันรับ  — requests I accepted: accepted→รอผู้ขอยืนยัน · done→+แต้ม
 *
 * ONE onSnapshot(`where building == myBuilding`) — single-field, auto-indexed
 * (§7-J, no composite index); client buckets by status + uid. Identity is by uid
 * (window._authUid, the stable line:Uxxx anchor — matches the CF gating, §7-HH).
 * Display is a building-aware room label, never a personal name (PDPA-minimal).
 *
 * §7-A/U claims guard · §7-N error callbacks · §7-V subscribe-once · §7-I every
 * write is an explicit tap → a callable; nothing auto-clicks. §7-RR CSS static.
 */
(function () {
  'use strict';

  let _raw = [];            // all helpRequests in my building (live)
  let _unsub = null;
  let _key = '';            // building the sub is bound to
  let _wired = false;       // static controls wired once
  const _busy = new Set();  // requestIds with an in-flight action
  const _confirmCancel = new Set(); // requestIds armed for a 2-tap cancel
  let _ratingFor = null;    // requestId currently being thanked
  const _selectedTags = new Set();

  const CAT_LABEL = {
    lifting: '📦 ยกของ', errand: '🏃 ธุระ', petcare: '🐾 สัตว์เลี้ยง',
    tech: '🔧 อุปกรณ์', other: '📝 อื่น ๆ',
  };
  // Appreciation tag labels — MIRROR functions/_helpRequestEngine.js APPRECIATION_LABELS.
  const TAG_LABEL = {
    kind: '💚 ใจดีมาก', fast: '⚡ รวดเร็วทันใจ', extra: '✨ ช่วยเกินคาด',
    friendly: '😊 เป็นกันเอง', trusty: '🤝 ไว้ใจได้',
  };

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
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const n = Date.parse(ts); return Number.isFinite(n) ? n : 0;
  }
  function _byNewest(a, b) {
    return _ms(b.createdAt || b.acceptedAt) - _ms(a.createdAt || a.acceptedAt);
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
    const q = fs.query(fs.collection(db, 'helpRequests'), fs.where('building', '==', b));
    _unsub = fs.onSnapshot(q, snap => {
      _raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
    }, err => {
      if (!/permission/i.test((err && err.message) || '')) console.warn('[helpers] sub failed:', err && err.message);
    });
  }

  // ── Render the three buckets ───────────────────────────────────────────────
  function _render() {
    if (!document.getElementById('helper-board')) return;
    const myUid = _uid();
    const open = _raw.filter(r => r.status === 'open' && r.requesterUid !== myUid).sort(_byNewest);
    const mine = _raw.filter(r => r.requesterUid === myUid && r.status !== 'cancelled').sort(_byNewest);
    const jobs = _raw.filter(r => r.helperUid === myUid && r.status !== 'cancelled').sort(_byNewest);
    _renderList('help-open-list', 'help-open-count', open, 'open', 'ยังไม่มีคำขอจากเพื่อนบ้านตอนนี้ 🌱');
    _renderList('help-mine-list', 'help-mine-count', mine, 'mine', 'คุณยังไม่ได้โพสต์คำขอ');
    _renderList('help-jobs-list', 'help-jobs-count', jobs, 'jobs', 'ยังไม่ได้รับช่วยใคร — ไปที่ "เปิดรับ" เพื่อช่วยเพื่อนบ้าน');
  }

  function _renderList(listId, countId, rows, kind, emptyMsg) {
    const el = document.getElementById(listId);
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = String(rows.length);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="help-empty">' + emptyMsg + '</div>';
      return;
    }
    el.innerHTML = '';
    rows.forEach(r => el.appendChild(_card(r, kind)));
  }

  function _card(r, kind) {
    const card = document.createElement('div');
    card.className = 'help-card';
    card.dataset.status = r.status || 'open';

    const main = document.createElement('div');
    main.className = 'help-card__main';
    const title = document.createElement('p');
    title.className = 'help-card__title';
    title.textContent = r.title || 'ขอความช่วยเหลือ';
    const sub = document.createElement('p');
    sub.className = 'help-card__sub';
    sub.textContent = _subLine(r, kind);
    main.appendChild(title);
    if (r.detail) {
      const det = document.createElement('p');
      det.className = 'help-card__detail';
      det.textContent = r.detail;
      main.appendChild(det);
    }
    main.appendChild(sub);
    if (r.status === 'done' && r.ratingNote) {
      const note = document.createElement('p');
      note.className = 'help-card__note';
      note.textContent = '💬 ' + r.ratingNote;   // the thank-you message — surfaced to the helper
      main.appendChild(note);
    }

    const side = document.createElement('div');
    side.className = 'help-card__side';
    _actionsFor(r, kind).forEach(node => side.appendChild(node));

    card.appendChild(main);
    card.appendChild(side);
    return card;
  }

  function _subLine(r, kind) {
    const cat = r.category && CAT_LABEL[r.category] ? CAT_LABEL[r.category] + ' · ' : '';
    if (kind === 'open') return cat + _who(r.building, r.room);
    if (kind === 'mine') {
      if (r.status === 'open') return cat + 'รอเพื่อนบ้านรับ…';
      if (r.status === 'accepted') return '✅ ' + _who(r.helperBuilding, r.helperRoom) + ' กำลังช่วย';
      if (r.status === 'done') return 'ขอบคุณแล้ว · ' + (_praise(r) || 'เสร็จสิ้น');
    }
    if (kind === 'jobs') {
      if (r.status === 'accepted') return cat + 'คุณกำลังช่วย ' + _who(r.building, r.room) + ' — รอผู้ขอยืนยัน';
      if (r.status === 'done') return (_praise(r) ? 'ได้รับคำชม: ' + _praise(r) + ' · ' : '') + '+20 แต้มน้ำใจ 💚';
    }
    return cat;
  }

  function _stars(n) {
    const s = Math.max(0, Math.min(5, Number(n) || 0));
    return s ? '⭐'.repeat(s) : '—';
  }

  // The appreciation shown on a done card: warm tags (new) or a legacy star count.
  function _praise(r) {
    if (Array.isArray(r.appreciationTags) && r.appreciationTags.length) {
      return r.appreciationTags.map(k => TAG_LABEL[k] || k).join('  ');
    }
    return r.rating ? _stars(r.rating) : '';
  }

  function _btn(label, cls, handler) {
    const b = document.createElement('button');
    b.className = 'help-btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function _actionsFor(r, kind) {
    if (_busy.has(r.id)) return [_disabled('⏳')];
    if (kind === 'open') {
      return [_btn('🤝 รับช่วย', 'help-btn--accept', () => _accept(r))];
    }
    if (kind === 'mine') {
      if (r.status === 'open') return [_cancelBtn(r)];
      if (r.status === 'accepted') return [
        _btn('ยืนยัน + ให้ดาว', 'help-btn--done', () => _openRating(r)),
        _cancelBtn(r),
      ];
      return []; // done — sub-line shows the rating
    }
    if (kind === 'jobs') {
      if (r.status === 'accepted') return [_disabled('กำลังช่วย')];
      return [];
    }
    return [];
  }

  function _disabled(label) {
    const b = document.createElement('span');
    b.className = 'help-badge';
    b.textContent = label;
    return b;
  }

  // Two-tap cancel: first tap arms, second tap within the same render cancels.
  function _cancelBtn(r) {
    const armed = _confirmCancel.has(r.id);
    return _btn(armed ? 'แน่ใจ? ยกเลิก' : 'ยกเลิก', armed ? 'help-btn--danger' : 'help-btn--ghost', () => {
      if (!_confirmCancel.has(r.id)) { _confirmCancel.add(r.id); _render(); return; }
      _confirmCancel.delete(r.id);
      _cancel(r);
    });
  }

  // ── Actions (§7-I: explicit tap → callable) ────────────────────────────────
  async function _post() {
    const titleEl = document.getElementById('help-post-title');
    const catEl = document.getElementById('help-post-category');
    const detailEl = document.getElementById('help-post-detail');
    const title = (titleEl && titleEl.value || '').trim();
    if (!title) { _toast('กรุณาระบุว่าต้องการให้ช่วยอะไร', 'warning'); return; }
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    const b = _bldg(); const r = _room();
    if (!b || !r) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่อีกครั้ง', 'error'); return; }
    const btn = document.getElementById('help-post-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังโพสต์…'; }
    try {
      await fns.httpsCallable('postHelpRequest')({
        building: b, roomId: r,
        title,
        detail: (detailEl && detailEl.value || '').trim() || undefined,
        category: (catEl && catEl.value) || undefined,
        requesterName: _myLabel(),
      });
      if (titleEl) titleEl.value = '';
      if (detailEl) detailEl.value = '';
      if (catEl) catEl.value = '';
      _togglePostForm(false);
      _toast('โพสต์คำขอแล้ว 🤝 รอเพื่อนบ้านมาช่วย', 'success');
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
      await fns.httpsCallable('acceptHelpRequest')({
        requestId: r.id, building: b, roomId: room, helperName: _myLabel(),
      });
      _toast('รับช่วยแล้ว 🙌 ขอบคุณสำหรับน้ำใจ', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'รับไม่สำเร็จ — อาจมีคนรับไปก่อนแล้ว'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  async function _cancel(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('cancelHelpRequest')({ requestId: r.id });
      _toast('ยกเลิกคำขอแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยกเลิกไม่สำเร็จ'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  // ── Rating modal (complete) ────────────────────────────────────────────────
  function _openRating(r) {
    _ratingFor = r.id;
    _selectedTags.clear();
    _paintTags();
    const note = document.getElementById('help-rating-note');
    if (note) note.value = '';
    const modal = document.getElementById('help-rating-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.remove('u-hidden'); }
  }

  function _closeRating() {
    _ratingFor = null;
    const modal = document.getElementById('help-rating-modal');
    if (modal) { modal.style.display = 'none'; modal.classList.add('u-hidden'); }
  }

  function _paintTags() {
    const wrap = document.getElementById('help-appreciation-tags');
    if (wrap) {
      Array.prototype.forEach.call(wrap.children, chip => {
        chip.classList.toggle('is-on', _selectedTags.has(chip.dataset.tag));
      });
    }
    const ok = document.getElementById('help-rating-confirm');
    if (ok) ok.disabled = _selectedTags.size < 1;
  }

  async function _confirmRating() {
    if (!_ratingFor || _selectedTags.size < 1) return;
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    const id = _ratingFor;
    const note = document.getElementById('help-rating-note');
    const ok = document.getElementById('help-rating-confirm');
    if (ok) { ok.disabled = true; ok.textContent = '⏳'; }
    _busy.add(id);
    try {
      await fns.httpsCallable('completeHelpRequest')({
        requestId: id, appreciationTags: [..._selectedTags],
        ratingNote: (note && note.value || '').trim() || undefined,
      });
      _closeRating();
      _toast('ส่งคำขอบคุณให้ผู้ช่วยแล้ว 💚', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ส่งไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      _busy.delete(id);
      if (ok) { ok.textContent = 'ส่งคำขอบคุณ'; ok.disabled = false; }
      _render();
    }
  }

  function _errMsg(e, fallback) {
    const code = String((e && e.code) || '');
    const msg = String((e && e.message) || '');
    return (/internal|unknown|unavailable|deadline/i.test(code) || !msg) ? fallback : msg;
  }

  // ── Static-control wiring (once) ───────────────────────────────────────────
  function _togglePostForm(show) {
    const form = document.getElementById('help-post-form');
    const toggle = document.getElementById('help-post-toggle');
    if (!form) return;
    const open = (show === undefined) ? form.classList.contains('u-hidden') : show;
    form.classList.toggle('u-hidden', !open);
    if (toggle) toggle.textContent = open ? '✕ ปิดฟอร์ม' : '+ โพสต์ขอความช่วยเหลือ';
    if (open) { const t = document.getElementById('help-post-title'); if (t) t.focus(); }
  }

  function _wire() {
    if (_wired) return;
    const board = document.getElementById('helper-board');
    if (!board) return;
    _wired = true;
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('help-post-toggle', 'click', () => _togglePostForm());
    on('help-post-submit', 'click', _post);
    on('help-rating-confirm', 'click', _confirmRating);
    on('help-rating-cancel', 'click', _closeRating);
    const tags = document.getElementById('help-appreciation-tags');
    if (tags) {
      Array.prototype.forEach.call(tags.children, chip => {
        chip.addEventListener('click', () => {
          const k = chip.dataset.tag;
          if (_selectedTags.has(k)) _selectedTags.delete(k); else _selectedTags.add(k);
          _paintTags();
        });
      });
    }
  }

  // ── Public entry — wire + subscribe + render (idempotent) ──────────────────
  function renderHelperBoard() {
    _wire();
    _subscribe();
    _render();
  }

  window.renderHelperBoard = renderHelperBoard;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderHelperBoard(); });
  }
})();
