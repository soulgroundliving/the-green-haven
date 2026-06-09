/**
 * tenant-community-requests.js — the neighbour borrow/share board (Meaning Layer
 * #3). Renders into the #community-requests sub-page (Profile → "ขอ-ยืมของ" tile).
 *
 * The micro-economy sibling of the Helper board (#2): a tenant posts a request to
 * BORROW or be GIVEN an item → a neighbour in the SAME building offers it → the
 * requester confirms they received it (+ an optional thank-you note). NO points
 * are awarded here — this board is a pure connection board (see the CF engine).
 * Three live sections:
 *   • เปิดรับ        — others' open requests → "🙋 ฉันมีให้" (offerCommunityRequest)
 *   • คำขอของฉัน     — my requests: open→cancel · offered→ได้รับแล้ว+ขอบคุณ / cancel · fulfilled→ขอบคุณแล้ว
 *   • ของที่ฉันแบ่ง   — requests I offered: offered→รอผู้ขอยืนยัน · fulfilled→ได้รับคำขอบคุณ
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

  let _raw = [];            // all communityRequests in my building (live)
  let _unsub = null;
  let _key = '';            // building the sub is bound to
  let _wired = false;       // static controls wired once
  const _busy = new Set();  // requestIds with an in-flight action
  const _confirmCancel = new Set(); // requestIds armed for a 2-tap cancel
  let _thankFor = null;     // requestId currently being confirmed-received

  const CAT_LABEL = {
    tool: '🔧 เครื่องมือ', kitchen: '🍳 ของใช้ครัว', household: '🏠 ของใช้ในบ้าน',
    electronics: '🔌 อุปกรณ์ไฟฟ้า', other: '📦 อื่น ๆ',
  };
  // borrow = lend-and-return · have = give-away. MIRRORS _communityRequestEngine VALID_KIND.
  const KIND_LABEL = { borrow: '🔁 ขอยืม', have: '🎁 ขอแบ่ง' };

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
    return _ms(b.createdAt || b.offeredAt) - _ms(a.createdAt || a.offeredAt);
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
    const q = fs.query(fs.collection(db, 'communityRequests'), fs.where('building', '==', b));
    _unsub = fs.onSnapshot(q, snap => {
      _raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
    }, err => {
      if (!/permission/i.test((err && err.message) || '')) console.warn('[community-requests] sub failed:', err && err.message);
    });
  }

  // ── Render the three buckets ───────────────────────────────────────────────
  function _render() {
    if (!document.getElementById('community-requests')) return;
    const myUid = _uid();
    const open = _raw.filter(r => r.status === 'open' && r.requesterUid !== myUid).sort(_byNewest);
    const mine = _raw.filter(r => r.requesterUid === myUid && r.status !== 'cancelled').sort(_byNewest);
    const given = _raw.filter(r => r.offererUid === myUid && r.status !== 'cancelled').sort(_byNewest);
    _renderShareSummary(given.filter(r => r.status === 'fulfilled'));
    _renderList('creq-open-list', 'creq-open-count', open, 'open', 'ยังไม่มีคำขอจากเพื่อนบ้านตอนนี้ 🌱');
    _renderList('creq-mine-list', 'creq-mine-count', mine, 'mine', 'คุณยังไม่ได้โพสต์คำขอ');
    _renderList('creq-given-list', 'creq-given-count', given, 'given', 'ยังไม่ได้แบ่งปันของให้ใคร — ไปที่ "เปิดรับ" เพื่อช่วยเพื่อนบ้าน');
  }

  // "ของที่ฉันแบ่งปัน" summary — gives the sharing a visible, warm home (there are
  // no points on this board, so the count IS the reward).
  function _renderShareSummary(givenDone) {
    const el = document.getElementById('creq-share-summary');
    if (!el) return;
    const n = givenDone.length;
    if (!n) { el.classList.add('u-hidden'); el.textContent = ''; return; }
    el.classList.remove('u-hidden');
    el.textContent = `🤲 คุณแบ่งปัน/ให้ยืมของเพื่อนบ้านไปแล้ว ${n} ครั้ง — ขอบคุณที่ทำให้ตึกเราอบอุ่น`;
  }

  function _renderList(listId, countId, rows, kind, emptyMsg) {
    const el = document.getElementById(listId);
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = String(rows.length);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="creq-empty">' + emptyMsg + '</div>';
      return;
    }
    el.innerHTML = '';
    rows.forEach(r => el.appendChild(_card(r, kind)));
  }

  function _card(r, kind) {
    const card = document.createElement('div');
    card.className = 'creq-card';
    card.dataset.status = r.status || 'open';

    const main = document.createElement('div');
    main.className = 'creq-card__main';

    const titleRow = document.createElement('p');
    titleRow.className = 'creq-card__title';
    if (r.requestKind && KIND_LABEL[r.requestKind]) {
      const kindBadge = document.createElement('span');
      kindBadge.className = 'creq-kind';
      kindBadge.textContent = KIND_LABEL[r.requestKind];
      titleRow.appendChild(kindBadge);
    }
    titleRow.appendChild(document.createTextNode(r.title || 'ขอความช่วยเหลือ'));
    main.appendChild(titleRow);

    if (r.detail) {
      const det = document.createElement('p');
      det.className = 'creq-card__detail';
      det.textContent = r.detail;
      main.appendChild(det);
    }
    const sub = document.createElement('p');
    sub.className = 'creq-card__sub';
    sub.textContent = _subLine(r, kind);
    main.appendChild(sub);

    if (r.status === 'fulfilled' && r.thankNote) {
      const note = document.createElement('p');
      note.className = 'creq-card__note';
      note.textContent = '💬 ' + r.thankNote;   // the thank-you message — surfaced to the offerer
      main.appendChild(note);
    }

    const side = document.createElement('div');
    side.className = 'creq-card__side';
    _actionsFor(r, kind).forEach(node => side.appendChild(node));

    card.appendChild(main);
    card.appendChild(side);
    return card;
  }

  function _subLine(r, kind) {
    const cat = r.category && CAT_LABEL[r.category] ? CAT_LABEL[r.category] + ' · ' : '';
    if (kind === 'open') return cat + _who(r.building, r.room);
    if (kind === 'mine') {
      if (r.status === 'open') return cat + 'รอเพื่อนบ้านเสนอให้…';
      if (r.status === 'offered') return '✅ ' + _who(r.offererBuilding, r.offererRoom) + ' มีให้แล้ว — นัดรับได้เลย';
      if (r.status === 'fulfilled') {
        const giver = (r.offererBuilding && r.offererRoom) ? _who(r.offererBuilding, r.offererRoom) : '';
        return (giver ? 'ขอบคุณ ' + giver : 'ขอบคุณแล้ว') + ' · ได้รับเรียบร้อย 🙏';
      }
    }
    if (kind === 'given') {
      if (r.status === 'offered') return cat + 'คุณเสนอให้ ' + _who(r.building, r.room) + ' — รอผู้ขอยืนยันรับ';
      if (r.status === 'fulfilled') return 'แบ่งปันให้ ' + _who(r.building, r.room) + ' เรียบร้อย 🤲';
    }
    return cat;
  }

  function _btn(label, cls, handler) {
    const b = document.createElement('button');
    b.className = 'creq-btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function _actionsFor(r, kind) {
    if (_busy.has(r.id)) return [_disabled('⏳')];
    if (kind === 'open') {
      return [_btn('🙋 ฉันมีให้', 'creq-btn--offer', () => _offer(r))];
    }
    if (kind === 'mine') {
      if (r.status === 'open') return [_cancelBtn(r)];
      if (r.status === 'offered') return [
        _btn('ได้รับแล้ว · ขอบคุณ', 'creq-btn--done', () => _openThank(r)),
        _cancelBtn(r),
      ];
      return []; // fulfilled — sub-line shows the thanks
    }
    if (kind === 'given') {
      if (r.status === 'offered') return [_disabled('รอยืนยันรับ')];
      return [];
    }
    return [];
  }

  function _disabled(label) {
    const b = document.createElement('span');
    b.className = 'creq-badge';
    b.textContent = label;
    return b;
  }

  // Two-tap cancel: first tap arms, second tap within the same render cancels.
  function _cancelBtn(r) {
    const armed = _confirmCancel.has(r.id);
    return _btn(armed ? 'แน่ใจ? ยกเลิก' : 'ยกเลิก', armed ? 'creq-btn--danger' : 'creq-btn--ghost', () => {
      if (!_confirmCancel.has(r.id)) { _confirmCancel.add(r.id); _render(); return; }
      _confirmCancel.delete(r.id);
      _cancel(r);
    });
  }

  // ── Actions (§7-I: explicit tap → callable) ────────────────────────────────
  async function _post() {
    const titleEl = document.getElementById('creq-post-title');
    const kindEl = document.getElementById('creq-post-kind');
    const catEl = document.getElementById('creq-post-category');
    const detailEl = document.getElementById('creq-post-detail');
    const title = (titleEl && titleEl.value || '').trim();
    if (!title) { _toast('กรุณาระบุสิ่งที่ต้องการขอ/ยืม', 'warning'); return; }
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    const b = _bldg(); const r = _room();
    if (!b || !r) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่อีกครั้ง', 'error'); return; }
    const btn = document.getElementById('creq-post-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังโพสต์…'; }
    try {
      await fns.httpsCallable('postCommunityRequest')({
        building: b, roomId: r,
        title,
        requestKind: (kindEl && kindEl.value) || 'borrow',
        detail: (detailEl && detailEl.value || '').trim() || undefined,
        category: (catEl && catEl.value) || undefined,
        requesterName: _myLabel(),
      });
      if (titleEl) titleEl.value = '';
      if (detailEl) detailEl.value = '';
      if (catEl) catEl.value = '';
      if (kindEl) kindEl.value = 'borrow';
      _togglePostForm(false);
      _toast('โพสต์คำขอแล้ว 🔄 รอเพื่อนบ้านมาแบ่งปัน', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'โพสต์ไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'โพสต์คำขอ'; }
    }
  }

  async function _offer(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    const b = _bldg(); const room = _room();
    if (!b || !room) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('offerCommunityRequest')({
        requestId: r.id, building: b, roomId: room, offererName: _myLabel(),
      });
      _toast('เสนอให้แล้ว 🙌 ขอบคุณที่แบ่งปัน', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'เสนอให้ไม่สำเร็จ — อาจมีคนเสนอไปก่อนแล้ว'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  async function _cancel(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('cancelCommunityRequest')({ requestId: r.id });
      _toast('ยกเลิกคำขอแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยกเลิกไม่สำเร็จ'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  // ── Thank modal (confirm received) ─────────────────────────────────────────
  function _openThank(r) {
    _thankFor = r.id;
    const note = document.getElementById('creq-thank-note');
    if (note) note.value = '';
    const modal = document.getElementById('creq-thank-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.remove('u-hidden'); }
  }

  function _closeThank() {
    _thankFor = null;
    const modal = document.getElementById('creq-thank-modal');
    if (modal) { modal.style.display = 'none'; modal.classList.add('u-hidden'); }
  }

  async function _confirmThank() {
    if (!_thankFor) return;
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    const id = _thankFor;
    const note = document.getElementById('creq-thank-note');
    const ok = document.getElementById('creq-thank-confirm');
    if (ok) { ok.disabled = true; ok.textContent = '⏳'; }
    _busy.add(id);
    try {
      await fns.httpsCallable('fulfillCommunityRequest')({
        requestId: id,
        thankNote: (note && note.value || '').trim() || undefined,
      });
      _closeThank();
      _toast('ยืนยันรับของแล้ว 🙏 ขอบคุณเพื่อนบ้าน', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ยืนยันไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      _busy.delete(id);
      if (ok) { ok.textContent = 'ยืนยันรับของ'; ok.disabled = false; }
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
    const form = document.getElementById('creq-post-form');
    const toggle = document.getElementById('creq-post-toggle');
    if (!form) return;
    const open = (show === undefined) ? form.classList.contains('u-hidden') : show;
    form.classList.toggle('u-hidden', !open);
    if (toggle) toggle.textContent = open ? '✕ ปิดฟอร์ม' : '+ โพสต์ขอ/ยืมของ';
    if (open) { const t = document.getElementById('creq-post-title'); if (t) t.focus(); }
  }

  function _wire() {
    if (_wired) return;
    const board = document.getElementById('community-requests');
    if (!board) return;
    _wired = true;
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('creq-post-toggle', 'click', () => _togglePostForm());
    on('creq-post-submit', 'click', _post);
    on('creq-thank-confirm', 'click', _confirmThank);
    on('creq-thank-cancel', 'click', _closeThank);
  }

  // ── Public entry — wire + subscribe + render (idempotent) ──────────────────
  function renderCommunityRequests() {
    _wire();
    _subscribe();
    _render();
  }

  window.renderCommunityRequests = renderCommunityRequests;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderCommunityRequests(); });
  }
})();
