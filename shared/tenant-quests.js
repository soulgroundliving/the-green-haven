/**
 * tenant-quests.js — the tenant's daily quest checklist (Meaning Layer #1).
 * Replaces the disabled "Coming soon" URGENT_QUESTS placeholder; renders into
 * #urgent-quests-list on the quest-page (Profile → อันดับ tab).
 *
 * Tenants only (a room is required to claim). Each quest is "กดรับ"; the server
 * routes on verifyMode (self award / auto re-verify / admin → pending). Points
 * are server-authoritative — we never trust a client value (§6).
 *
 * State source (no new subscription): the catalog (`quests/`) is fetched once
 * and cached; per-quest CURRENT state rides `gamification.questsToday`, which the
 * existing eco-points onSnapshot in tenant-leaderboard.js stashes on
 * window._taQuestsToday and re-renders us via loadGamificationData. So an admin
 * approval / a fresh claim reflects live with zero extra reads.
 *
 * §7-A/U: gated on window._tenantAppBuilding/Room (claims). §7-I: explicit tap.
 * §7-N: read failure → muted, never a spinner. §7-RR: styles in components.css.
 */
(function () {
  'use strict';

  let _catalog = null;        // cached active quests for this tenant's building
  let _catalogLoading = false;
  const _busy = new Set();    // questIds with an in-flight claim (optimistic lock)

  function _fs() { const f = window.firebase; return (f && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { const f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }
  function _bldg() { return window._tenantAppBuilding || ''; }
  function _room() { return window._tenantAppRoom || ''; }

  function _bkkDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
  // Client mirror of _questEngine.periodKeyFor for the v1 UI cadences (daily/once).
  function _periodKey(cadence) { return cadence === 'once' ? 'once' : _bkkDate(); }

  // Per-quest state from the live questsToday map (or 'available' if none/stale).
  function _stateOf(quest) {
    const map = window._taQuestsToday || {};
    const entry = map[quest.id];
    if (entry && entry.periodKey === _periodKey(quest.cadence)) {
      if (entry.status === 'pending') return 'pending';
      if (entry.status === 'rejected') return 'rejected';
      if (entry.status === 'self' || entry.status === 'auto' || entry.status === 'approved') return 'claimed';
    }
    return 'available';
  }

  async function _loadCatalog() {
    if (_catalogLoading) return;
    const fs = _fs(); const db = _db();
    if (!fs || !db) return;
    _catalogLoading = true;
    try {
      const snap = await fs.getDocs(fs.collection(db, 'quests'));
      const b = _bldg();
      _catalog = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(q => q.active !== false && (q.building === 'all' || !q.building || q.building === b))
        .sort((a, b2) => (a.order || 999) - (b2.order || 999));
    } catch (e) {
      // permission-denied is expected pre-LIFF-link — stay quiet (§7-N)
      if (!/permission/i.test((e && e.message) || '')) console.warn('[quests] catalog read failed:', e && e.message);
      _catalog = _catalog || null;
    } finally {
      _catalogLoading = false;
      _render();
    }
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
    if (_catalog === null) {
      // Not loaded yet / unreadable — kick a load, leave existing content (§7-X: no blank).
      if (!_catalogLoading) _loadCatalog();
      return;
    }
    if (!_catalog.length) {
      el.innerHTML = '<div class="quest-empty">ยังไม่มีภารกิจตอนนี้ — แวะมาดูใหม่เร็ว ๆ นี้ 🌱</div>';
      return;
    }
    el.innerHTML = '';
    _catalog.forEach(q => {
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

      card.appendChild(main);
      card.appendChild(button);
      el.appendChild(card);
    });
  }

  // §7-I: explicit tap → claimQuest callable. Optimistic button lock; the eco
  // onSnapshot delivers the authoritative new questsToday + points → re-render.
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
      _busy.delete(quest.id);
      if (status === 'pending') _toast('ส่งคำขอแล้ว รอแอดมินอนุมัติ 🙏', 'success');
      else _toast(`รับ ${quest.rewardPoints || 0} แต้มแล้ว! 🎉`, 'success');
      _render(); // immediate; the snapshot will also confirm
    } catch (e) {
      _busy.delete(quest.id);
      const msg = (e && e.message) || '';
      // Friendly mapping for the common server rejections.
      if (/already|รับเควส|รอตรวจ/i.test(msg)) _toast('รับเควสนี้ไปแล้ว', 'error');
      else if (/precondition|ยังทำ/i.test(msg)) _toast('ยังทำภารกิจนี้ไม่ครบ', 'error');
      else if (/exhausted|โควต้า/i.test(msg)) _toast('วันนี้รับเควสครบโควต้าแล้ว', 'error');
      else _toast('รับไม่สำเร็จ กรุณาลองใหม่', 'error');
      _render();
    }
  }

  function _toast(msg, kind) {
    if (typeof window.showTenantToast === 'function') return window.showTenantToast(msg, kind);
    if (typeof window.toast === 'function') return window.toast(msg, kind);
  }

  // Public: called by tenant-leaderboard.loadGamificationData (replaces the
  // placeholder render) and on the eco snapshot via that same path.
  function renderTenantQuests() {
    if (!_bldg() || !_room()) return; // §7-A/U — wait for claims
    if (_catalog === null && !_catalogLoading) { _loadCatalog(); return; }
    _render();
  }

  window.renderTenantQuests = renderTenantQuests;
})();
