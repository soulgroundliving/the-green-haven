/**
 * tenant-food-share.js — the neighbour food-sharing feed (Meaning Layer #4).
 * Renders into the #food-share sub-page (Profile → "แบ่งปันอาหาร" tile).
 *
 * A tenant SHARES leftover food → a neighbour in the SAME building CLAIMS it →
 * the SHARER earns peer-confirmed kindness points (server-side, claimFood). The
 * feed is EPHEMERAL — each share carries an expiresAt; the client HIDES expired
 * shares from the "เปิดให้" feed (the server also rejects claiming them). Three
 * live sections:
 *   • เปิดให้        — others' available (not-expired) shares → "🙋 ฉันเอา" (claimFood)
 *   • ของที่ฉันแบ่ง  — my shares: available→cancel · claimed→ใครรับ+แต้ม
 *   • ของที่ฉันรับ   — shares I claimed
 *
 * ONE onSnapshot(`where building == myBuilding`) — single-field, auto-indexed
 * (§7-J, no composite index); client buckets by status + uid + expiry. Identity
 * is by uid (window._authUid, §7-HH). Display is a building-aware room label
 * (PDPA-minimal). §7-A/U/V/N guards; §7-I every write is an explicit tap.
 */
(function () {
  'use strict';

  let _raw = [];
  let _unsub = null;
  let _key = '';
  let _wired = false;
  const _busy = new Set();
  const _confirmCancel = new Set();

  const CAT_LABEL = {
    meal: '🍱 อาหารจานหลัก', snack: '🍪 ของว่าง', fruit: '🍎 ผลไม้',
    drink: '🥤 เครื่องดื่ม', ingredient: '🧂 เครื่องปรุง/วัตถุดิบ', other: '🍽️ อื่น ๆ',
  };

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _fns() { return window.firebase && window.firebase.functions; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return String(window._tenantAppRoom || ''); }
  function _uid() { return window._authUid || ''; }
  function _who(building, room) { return (building === 'nest' ? 'Nest ' : 'ห้อง ') + room; }
  function _myLabel() { return _who(_bldg(), _room()); }
  function _toast(m, k) { if (typeof window.toast === 'function') window.toast(m, k); }

  function _ms(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const n = Date.parse(ts); return Number.isFinite(n) ? n : (Number.isFinite(+ts) ? +ts : 0);
  }
  function _byNewest(a, b) { return _ms(b.createdAt) - _ms(a.createdAt); }
  function _expMs(share) { return _ms(share && share.expiresAt); }
  function _isExpired(share, nowMs) { const e = _expMs(share); return e > 0 && nowMs >= e; }

  // "หมดใน Xh" / "ใกล้หมด" countdown badge for an available share.
  function _expiryLabel(share, nowMs) {
    const e = _expMs(share);
    if (!e) return '';
    const mins = Math.round((e - nowMs) / 60000);
    if (mins <= 0) return 'หมดเวลา';
    if (mins < 60) return `⏳ อีก ${mins} น.`;
    return `⏳ อีก ${Math.round(mins / 60)} ชม.`;
  }

  function _subscribe() {
    const b = _bldg();
    if (!b) return;                       // §7-U
    if (_unsub && _key === b) return;     // §7-V
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    _key = b;
    const q = fs.query(fs.collection(db, 'foodShares'), fs.where('building', '==', b));
    _unsub = fs.onSnapshot(q, snap => {
      _raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _render();
    }, err => {
      if (!/permission/i.test((err && err.message) || '')) console.warn('[food-share] sub failed:', err && err.message);
    });
  }

  function _render() {
    if (!document.getElementById('food-share')) return;
    const myUid = _uid();
    const nowMs = Date.now();
    const open = _raw.filter(r => r.status === 'available' && r.sharerUid !== myUid && !_isExpired(r, nowMs)).sort(_byNewest);
    const mine = _raw.filter(r => r.sharerUid === myUid && r.status !== 'cancelled').sort(_byNewest);
    const got = _raw.filter(r => r.claimerUid === myUid && r.status === 'claimed').sort((a, b) => _ms(b.claimedAt) - _ms(a.claimedAt));
    _renderSummary(mine.filter(r => r.status === 'claimed'));
    _renderList('food-open-list', 'food-open-count', open, 'open', nowMs, 'ยังไม่มีของแบ่งปันตอนนี้ 🌱 เป็นคนแรกที่แบ่งสิ!');
    _renderList('food-mine-list', 'food-mine-count', mine, 'mine', nowMs, 'คุณยังไม่ได้แบ่งปันอะไร');
    _renderList('food-got-list', 'food-got-count', got, 'got', nowMs, 'ยังไม่ได้รับของจากใคร — ไปที่ "เปิดให้" ดูสิ');
  }

  function _renderSummary(mineClaimed) {
    const el = document.getElementById('food-share-summary');
    if (!el) return;
    const n = mineClaimed.length;
    if (!n) { el.classList.add('u-hidden'); el.textContent = ''; return; }
    const pts = mineClaimed.reduce((s, r) => s + (Number(r.sharerPointsAwarded) || 0), 0);
    el.classList.remove('u-hidden');
    el.textContent = `🤲 คุณแบ่งปันอาหารให้เพื่อนบ้านไป ${n} ครั้ง · +${pts.toLocaleString()} แต้มน้ำใจ 💚`;
  }

  function _renderList(listId, countId, rows, kind, nowMs, emptyMsg) {
    const el = document.getElementById(listId);
    const cnt = document.getElementById(countId);
    if (cnt) cnt.textContent = String(rows.length);
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="food-empty">' + emptyMsg + '</div>'; return; }
    el.innerHTML = '';
    rows.forEach(r => el.appendChild(_card(r, kind, nowMs)));
  }

  function _card(r, kind, nowMs) {
    const card = document.createElement('div');
    card.className = 'food-card';
    card.dataset.status = r.status || 'available';

    const main = document.createElement('div');
    main.className = 'food-card__main';
    const title = document.createElement('p');
    title.className = 'food-card__title';
    title.textContent = r.title || 'ของแบ่งปัน';
    if (r.portions) {
      const port = document.createElement('span');
      port.className = 'food-portions';
      port.textContent = `×${r.portions}`;
      title.appendChild(port);
    }
    main.appendChild(title);
    if (r.detail) {
      const det = document.createElement('p');
      det.className = 'food-card__detail';
      det.textContent = r.detail;
      main.appendChild(det);
    }
    const sub = document.createElement('p');
    sub.className = 'food-card__sub';
    sub.textContent = _subLine(r, kind, nowMs);
    main.appendChild(sub);

    const side = document.createElement('div');
    side.className = 'food-card__side';
    _actionsFor(r, kind, nowMs).forEach(node => side.appendChild(node));

    card.appendChild(main);
    card.appendChild(side);
    return card;
  }

  function _subLine(r, kind, nowMs) {
    const cat = r.category && CAT_LABEL[r.category] ? CAT_LABEL[r.category] + ' · ' : '';
    if (kind === 'open') {
      const exp = _expiryLabel(r, nowMs);
      return cat + _who(r.building, r.room) + (exp ? ' · ' + exp : '');
    }
    if (kind === 'mine') {
      if (r.status === 'available') {
        return _isExpired(r, nowMs) ? cat + 'หมดเวลาแล้ว' : cat + 'รอเพื่อนบ้านมารับ · ' + _expiryLabel(r, nowMs);
      }
      if (r.status === 'claimed') {
        const who = (r.claimerBuilding && r.claimerRoom) ? _who(r.claimerBuilding, r.claimerRoom) : 'เพื่อนบ้าน';
        const pts = Number(r.sharerPointsAwarded) || 0;
        return '✅ ' + who + ' รับไปแล้ว' + (pts > 0 ? ' · +' + pts + ' แต้มน้ำใจ 💚' : '');
      }
    }
    if (kind === 'got') {
      return 'ได้รับจาก ' + _who(r.building, r.room) + ' · ขอบคุณ 🙏';
    }
    return cat;
  }

  function _btn(label, cls, handler) {
    const b = document.createElement('button');
    b.className = 'food-btn ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  function _disabled(label) {
    const b = document.createElement('span');
    b.className = 'food-badge';
    b.textContent = label;
    return b;
  }

  function _actionsFor(r, kind, nowMs) {
    if (_busy.has(r.id)) return [_disabled('⏳')];
    if (kind === 'open') return [_btn('🙋 ฉันเอา', 'food-btn--claim', () => _claim(r))];
    if (kind === 'mine') {
      if (r.status === 'available') return [_cancelBtn(r)];
      return []; // claimed — sub-line shows who took it
    }
    return []; // got
  }

  function _cancelBtn(r) {
    const armed = _confirmCancel.has(r.id);
    return _btn(armed ? 'แน่ใจ? ลบ' : 'ลบ', armed ? 'food-btn--danger' : 'food-btn--ghost', () => {
      if (!_confirmCancel.has(r.id)) { _confirmCancel.add(r.id); _render(); return; }
      _confirmCancel.delete(r.id);
      _cancel(r);
    });
  }

  // ── Actions (§7-I: explicit tap → callable) ────────────────────────────────
  async function _post() {
    const titleEl = document.getElementById('food-post-title');
    const catEl = document.getElementById('food-post-category');
    const portionsEl = document.getElementById('food-post-portions');
    const expiryEl = document.getElementById('food-post-expiry');
    const detailEl = document.getElementById('food-post-detail');
    const title = (titleEl && titleEl.value || '').trim();
    if (!title) { _toast('กรุณาระบุของกินที่จะแบ่งปัน', 'warning'); return; }
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    const b = _bldg(); const r = _room();
    if (!b || !r) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่อีกครั้ง', 'error'); return; }
    const btn = document.getElementById('food-post-submit');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังโพสต์…'; }
    try {
      await fns.httpsCallable('shareFood')({
        building: b, roomId: r,
        title,
        category: (catEl && catEl.value) || undefined,
        portions: (portionsEl && portionsEl.value) ? Number(portionsEl.value) : undefined,
        expiresInHours: (expiryEl && expiryEl.value) ? Number(expiryEl.value) : undefined,
        detail: (detailEl && detailEl.value || '').trim() || undefined,
        sharerName: _myLabel(),
      });
      if (titleEl) titleEl.value = '';
      if (detailEl) detailEl.value = '';
      if (catEl) catEl.value = '';
      if (portionsEl) portionsEl.value = '';
      _togglePostForm(false);
      _toast('แบ่งปันแล้ว 🍲 ขอบคุณที่ทำให้ตึกเราอบอุ่น', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'โพสต์ไม่สำเร็จ กรุณาลองใหม่'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'แบ่งปัน'; }
    }
  }

  async function _claim(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    const b = _bldg(); const room = _room();
    if (!b || !room) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('claimFood')({
        shareId: r.id, building: b, roomId: room, claimerName: _myLabel(),
      });
      _toast('รับของแล้ว 🙏 ไปรับได้เลย', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'รับไม่สำเร็จ — อาจมีคนรับไปก่อน หรือหมดเวลาแล้ว'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  async function _cancel(r) {
    const fns = _fns();
    if (!fns) { _toast('ระบบยังไม่พร้อม', 'error'); return; }
    _busy.add(r.id); _render();
    try {
      await fns.httpsCallable('cancelFood')({ shareId: r.id });
      _toast('ลบรายการแล้ว', 'success');
    } catch (e) {
      _toast(_errMsg(e, 'ลบไม่สำเร็จ'), 'error');
    } finally {
      _busy.delete(r.id); _render();
    }
  }

  function _errMsg(e, fallback) {
    const code = String((e && e.code) || '');
    const msg = String((e && e.message) || '');
    return (/internal|unknown|unavailable|deadline/i.test(code) || !msg) ? fallback : msg;
  }

  function _togglePostForm(show) {
    const form = document.getElementById('food-post-form');
    const toggle = document.getElementById('food-post-toggle');
    if (!form) return;
    const open = (show === undefined) ? form.classList.contains('u-hidden') : show;
    form.classList.toggle('u-hidden', !open);
    if (toggle) toggle.textContent = open ? '✕ ปิดฟอร์ม' : '+ แบ่งปันของกิน';
    if (open) { const t = document.getElementById('food-post-title'); if (t) t.focus(); }
  }

  function _wire() {
    if (_wired) return;
    const board = document.getElementById('food-share');
    if (!board) return;
    _wired = true;
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('food-post-toggle', 'click', () => _togglePostForm());
    on('food-post-submit', 'click', _post);
  }

  function renderFoodShare() {
    _wire();
    _subscribe();
    _render();
  }

  window.renderFoodShare = renderFoodShare;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderFoodShare(); });
  }
})();
