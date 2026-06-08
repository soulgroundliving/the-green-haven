/**
 * tenant-quests.js — the tenant's daily quest checklist (Meaning Layer #1).
 * Replaces the disabled "Coming soon" URGENT_QUESTS placeholder; renders into
 * #urgent-quests-list on the quest-page (Profile → อันดับ tab).
 *
 * REAL-TIME + self-contained (does NOT depend on the eco-points snapshot):
 *   - onSnapshot(`quests`)               → a quest the admin just added/edits
 *                                          appears in the tenant app instantly.
 *   - onSnapshot(tenant doc)             → `gamification.questsToday` per-quest
 *                                          state (claimed/pending/rejected) live.
 *   - optimistic overlay on claim        → the button locks the instant the tap
 *                                          succeeds, so a double-tap can't hit the
 *                                          server's "already claimed" path.
 *
 * Tenants only (a room is required). Points are server-authoritative (§6) — we
 * never trust a client value. §7-A/U claim guard; §7-N error callbacks on both
 * subscriptions; §7-V idempotent (subscribe-once) guards; §7-RR CSS is static.
 */
(function () {
  'use strict';

  let _catalogRaw = null;     // all active quests (filtered by building at render)
  let _questsToday = {};      // live from the tenant-doc subscription
  const _optimistic = {};     // questId -> {status, periodKey} set on a fresh claim
  const _busy = new Set();
  let _catalogUnsub = null;
  let _stateUnsub = null;
  let _stateKey = '';         // building/room the state sub is bound to

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return window._tenantAppRoom || ''; }

  function _bkkDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
  function _periodKey(cadence) { return cadence === 'once' ? 'once' : _bkkDate(); }

  // Per-quest state: a fresh optimistic claim wins; else the live questsToday map.
  function _stateOf(quest) {
    const pk = _periodKey(quest.cadence);
    const opt = _optimistic[quest.id];
    const ent = (opt && opt.periodKey === pk) ? opt : _questsToday[quest.id];
    if (ent && ent.periodKey === pk) {
      if (ent.status === 'pending') return 'pending';
      if (ent.status === 'rejected') return 'rejected';
      if (ent.status === 'self' || ent.status === 'auto' || ent.status === 'approved') return 'claimed';
    }
    return 'available';
  }

  // ── Catalog subscription (public read; building filter applied at render) ──
  function _subscribeCatalog() {
    if (_catalogUnsub) return;
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    _catalogUnsub = fs.onSnapshot(fs.collection(db, 'quests'), snap => {
      _catalogRaw = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(q => q.active !== false)
        .sort((a, b) => (a.order || 999) - (b.order || 999));
      _render();
    }, err => {
      if (!/permission/i.test((err && err.message) || '')) console.warn('[quests] catalog sub failed:', err && err.message);
    });
  }

  // ── State subscription: the tenant's own doc → questsToday (claim-gated) ──
  function _subscribeState() {
    const b = _bldg(); const r = _room();
    if (!b || !r) return;            // §7-U: wait for claims before binding
    const key = b + '/' + r;
    if (_stateUnsub && _stateKey === key) return; // §7-V: already bound to this room
    if (_stateUnsub) { try { _stateUnsub(); } catch (_) {} _stateUnsub = null; }
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    _stateKey = key;
    _stateUnsub = fs.onSnapshot(fs.doc(db, 'tenants', b, 'list', String(r)), snap => {
      const g = (snap.exists() ? (snap.data() || {}) : {}).gamification || {};
      _questsToday = g.questsToday || {};
      // Drop optimistic entries the server has now confirmed for the same period.
      Object.keys(_optimistic).forEach(qid => {
        const e = _questsToday[qid];
        if (e && e.periodKey === _optimistic[qid].periodKey) delete _optimistic[qid];
      });
      _render();
    }, err => {
      if (!/permission/i.test((err && err.message) || '')) console.warn('[quests] state sub failed:', err && err.message);
    });
  }

  function _btnFor(quest, state) {
    const pts = Number(quest.rewardPoints || 0);
    if (state === 'claimed') return { cls: 'quest-card__btn is-done', label: '✓ รับแล้ว', disabled: true };
    if (state === 'pending') return { cls: 'quest-card__btn is-pending', label: '⏳ รอตรวจ', disabled: true };
    if (_busy.has(quest.id)) return { cls: 'quest-card__btn', label: '⏳', disabled: true };
    const verb = quest.verifyMode === 'admin' ? 'ขอรับ' : 'รับ';
    return { cls: 'quest-card__btn', label: `${verb} ${pts}`, disabled: false };
  }

  function _render() {
    const el = document.getElementById('urgent-quests-list');
    if (!el) return;
    if (_catalogRaw === null) return; // not loaded yet — leave existing content (§7-X)
    const b = _bldg();
    const list = _catalogRaw.filter(q => !q.building || q.building === 'all' || q.building === b);
    if (!list.length) {
      el.innerHTML = '<div class="quest-empty">ยังไม่มีภารกิจตอนนี้ — แวะมาดูใหม่เร็ว ๆ นี้ 🌱</div>';
      return;
    }
    el.innerHTML = '';
    list.forEach(q => {
      const state = _stateOf(q);
      const btn = _btnFor(q, state);
      const card = document.createElement('div');
      card.className = 'quest-card';
      card.dataset.state = state;
      const main = document.createElement('div');
      main.className = 'quest-card__main';
      const icon = document.createElement('span');
      icon.className = 'quest-card__icon';
      icon.textContent = q.icon || '🎯';
      const txt = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'quest-card__title';
      title.textContent = q.title || 'ภารกิจ';
      const sub = document.createElement('p');
      sub.className = 'quest-card__sub';
      sub.textContent = state === 'rejected'
        ? 'ถูกปฏิเสธ — ลองใหม่ได้'
        : (q.description || (q.verifyMode === 'admin' ? 'รออนุมัติหลังกดรับ' : ''));
      txt.appendChild(title); txt.appendChild(sub);
      main.appendChild(icon); main.appendChild(txt);
      const button = document.createElement('button');
      button.className = btn.cls;
      button.textContent = btn.label;
      button.disabled = btn.disabled;
      if (!btn.disabled) button.addEventListener('click', () => _claim(q, button));
      card.appendChild(main); card.appendChild(button);
      el.appendChild(card);
    });
  }

  // §7-I: explicit tap → claimQuest callable. Optimistic lock the instant it
  // succeeds; the state subscription delivers the authoritative confirm.
  async function _claim(quest, button) {
    if (_busy.has(quest.id)) return;
    const fns = window.firebase && window.firebase.functions;
    if (!fns) { _toast('ระบบยังไม่พร้อม กรุณาลองใหม่', 'error'); return; }
    const b = _bldg(); const r = _room();
    if (!b || !r) { _toast('กำลังเตรียมข้อมูล กรุณาลองใหม่อีกครั้ง', 'error'); return; }
    _busy.add(quest.id);
    button.disabled = true; button.textContent = '⏳';
    try {
      const res = await fns.httpsCallable('claimQuest')({ building: b, roomId: String(r), questId: quest.id });
      const status = (res && res.data && res.data.status) || 'self';
      _optimistic[quest.id] = { status, periodKey: _periodKey(quest.cadence) }; // lock the card now
      _busy.delete(quest.id);
      if (status === 'pending') _toast('ส่งคำขอแล้ว รอแอดมินอนุมัติ 🙏', 'success');
      else _toast(`รับ ${quest.rewardPoints || 0} แต้มแล้ว! 🎉`, 'success');
      _render();
    } catch (e) {
      _busy.delete(quest.id);
      // Show the server's user-friendly Thai message directly — it already
      // distinguishes already-claimed / pending / not-done / cap-exceeded. The
      // old substring mapping mis-fired: the cap message "...รับเควสครบโควต้า..."
      // contains "รับเควส" and was wrongly shown as "รับเควสนี้ไปแล้ว".
      const code = String((e && e.code) || '');
      const msg = String((e && e.message) || '');
      _toast((/internal|unknown|unavailable|deadline/i.test(code) || !msg)
        ? 'รับไม่สำเร็จ กรุณาลองใหม่' : msg, 'error');
      _render();
    }
  }

  function _toast(msg, kind) {
    if (typeof window.showTenantToast === 'function') return window.showTenantToast(msg, kind);
    if (typeof window.toast === 'function') return window.toast(msg, kind);
  }

  // Public entry — set up both subscriptions (idempotent) + render. Called by
  // _onLiffClaimsReady (self-wire) AND tenant-leaderboard.loadGamificationData.
  function renderTenantQuests() {
    _subscribeCatalog();           // catalog read is public — safe before claims
    _subscribeState();             // gated on claims internally
    _render();
  }

  window.renderTenantQuests = renderTenantQuests;
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { renderTenantQuests(); });
  }
})();
