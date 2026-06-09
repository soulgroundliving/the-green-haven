// ---- Community activity feed (world-map "new posts from other rooms") ----
// Aggregates the LATEST active posts from OTHER rooms in the same building across
// the neighbour boards — helpRequests (ขอความช่วยเหลือ), communityRequests
// (ขอ-ยืมของ), foodShares (แบ่งอาหาร). These boards deliberately do NOT push a LINE
// flex message (non-intrusive, by owner's design), so this 🏘️ button + badge on the
// world-map is the in-app "what's new nearby" surface. Future boards plug in by
// adding one BOARDS entry.
//
// Mirrors shared/broadcasts.js: localStorage last-seen → unread badge → panel.
// §7-U claim-presence guard before subscribing · §7-N onSnapshot error callback ·
// §7-V idempotent per-board unsub · §7-FFF buckets by ROOM identity, not uid.
//
// Exposes: window.openActivityPanel / window.closeActivityPanel /
//          window._renderActivityBadge
(function () {
    'use strict';

    // boardKey -> unsub fn (§7-V idempotency) ; boardKey -> filtered item[]
    var _subs = {};
    var _cache = {};

    // Each board: how to read it, which status is "active/open", how to label it,
    // and which sub-page a tap should open (window.showSubPage id).
    var BOARDS = [
        { key: 'help',  coll: 'helpRequests',      emoji: '🆘', label: 'ขอความช่วยเหลือ', sub: 'helper-board',
          titleFb: 'ขอความช่วยเหลือ', active: function (r) { return r.status === 'open'; } },
        { key: 'borrow', coll: 'communityRequests', emoji: '📦', label: 'ขอ-ยืมของ',      sub: 'community-requests',
          titleFb: 'ขอ/แบ่งของ',     active: function (r) { return r.status === 'open'; } },
        { key: 'food',  coll: 'foodShares',         emoji: '🍲', label: 'แบ่งอาหาร',       sub: 'food-share',
          titleFb: 'ของแบ่งปัน',     active: function (r) { return r.status === 'available' && !_isExpired(r); } }
    ];
    var MAX_ITEMS = 30;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _building() { return window._tenantAppBuilding || ''; }
    function _room() { return window._tenantAppRoom != null ? String(window._tenantAppRoom) : ''; }
    function _ms(ts) {
        if (!ts) return 0;
        if (typeof ts.toMillis === 'function') return ts.toMillis();
        if (typeof ts.seconds === 'number') return ts.seconds * 1000;
        var n = Date.parse(ts); return Number.isFinite(n) ? n : (Number.isFinite(+ts) ? +ts : 0);
    }
    function _isExpired(r) { var e = _ms(r && r.expiresAt); return e > 0 && Date.now() >= e; }
    function _relTime(ms) {
        if (!ms) return '';
        var diff = Date.now() - ms; if (diff < 0) diff = 0;
        if (diff < 60000)     return 'เมื่อสักครู่';
        if (diff < 3600000)   return Math.floor(diff / 60000) + ' นาที';
        if (diff < 86400000)  return Math.floor(diff / 3600000) + ' ชม.';
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' วัน';
        return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    }
    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Aggregate: newest active posts from OTHER rooms, across all boards ──────
    function _allItems() {
        var items = [];
        BOARDS.forEach(function (b) {
            (_cache[b.key] || []).forEach(function (r) {
                items.push({
                    board: b.key, emoji: b.emoji, label: b.label, sub: b.sub,
                    title: r.title || b.titleFb,
                    room: (r.room != null ? String(r.room) : ''),
                    ts: _ms(r.createdAt)
                });
            });
        });
        items.sort(function (a, b) { return b.ts - a.ts; });
        return items.slice(0, MAX_ITEMS);
    }

    // ── Last-seen (localStorage, per room) → unread count ──────────────────────
    function _seenKey() { return 'gh_activity_seen_' + (_room() || 'anon'); }
    function _getLastSeenMs() {
        try { return parseInt(localStorage.getItem(_seenKey()) || '0', 10) || 0; } catch (_) { return 0; }
    }
    function _setLastSeenMs(ms) {
        try { localStorage.setItem(_seenKey(), String(ms || 0)); } catch (_) {}
    }
    function _unreadCount() {
        var cutoff = _getLastSeenMs();
        return _allItems().filter(function (it) { return it.ts > cutoff; }).length;
    }

    // ── Badge ───────────────────────────────────────────────────────────────
    function _renderActivityBadge() {
        var badge = document.getElementById('map-activity-badge');
        if (!badge) return;
        var n = _unreadCount();
        if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = 'inline-flex'; }
        else { badge.style.display = 'none'; }
    }

    // ── Panel list ────────────────────────────────────────────────────────────
    function _renderActivityList() {
        var el = document.getElementById('activity-panel-list');
        if (!el) return;
        var items = _allItems();
        if (!items.length) {
            el.innerHTML = '<div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:.92rem;">' +
                'ยังไม่มีโพสใหม่จากเพื่อนบ้านตอนนี้ 🌱</div>';
            return;
        }
        var cutoff = _getLastSeenMs();
        el.innerHTML = items.map(function (it) {
            var unread = it.ts > cutoff;
            var when = _relTime(it.ts);
            var room = it.room ? ('ห้อง ' + _esc(it.room)) : '';
            var meta = [it.label, room].filter(Boolean).join(' · ');
            return '<div class="gh-activity-item" role="button" tabindex="0" data-sub="' + _esc(it.sub) + '" ' +
                'style="border-bottom:1px solid var(--border, #e5e5e5); padding:14px 20px; cursor:pointer; ' +
                (unread ? 'border-left:3px solid var(--primary-green, #4caf50);' : '') + '">' +
                '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:.3rem;">' +
                '<strong style="font-size:.98rem; ' + (unread ? 'color:var(--text-dark);' : 'color:var(--text-muted);') + '">' +
                it.emoji + ' ' + _esc(it.title) + '</strong>' +
                (when ? '<span style="font-size:.78rem; color:var(--text-muted); white-space:nowrap;">' + _esc(when) + '</span>' : '') +
                '</div>' +
                '<div style="font-size:.8rem; color:var(--text-muted);">' + meta + '</div>' +
                '</div>';
        }).join('');
        // Tap an item → open that board's sub-page (direct listener, not the
        // data-action hub, so this module needs no inline-script edit).
        el.querySelectorAll('.gh-activity-item').forEach(function (node) {
            node.addEventListener('click', function () {
                var sub = node.getAttribute('data-sub');
                closeActivityPanel();
                if (sub && typeof window.showSubPage === 'function') window.showSubPage(sub);
            });
        });
    }

    // ── Subscriptions — one onSnapshot per board ───────────────────────────────
    function _subscribeActivity() {
        if (!window.firebase || !window.firebase.firestore || !window.firebase.firestoreFunctions) return;
        if (!_building()) return;  // §7-U: claim-presence guard BEFORE setting any unsub
        var fs = window.firebase.firestoreFunctions;
        var db = window.firebase.firestore();
        var b = _building();
        BOARDS.forEach(function (board) {
            if (_subs[board.key]) return;  // §7-V: idempotent per board
            try {
                var q = fs.query(fs.collection(db, board.coll), fs.where('building', '==', b));
                _subs[board.key] = fs.onSnapshot(q, function (snap) {
                    var myRoom = _room();
                    var rows = [];
                    snap.forEach(function (d) {
                        var r = Object.assign({ id: d.id }, d.data());
                        // active + from ANOTHER room (§7-FFF: room identity, not uid)
                        if (board.active(r) && String(r.room) !== myRoom) rows.push(r);
                    });
                    _cache[board.key] = rows;
                    _renderActivityBadge();
                    _renderActivityList();
                }, function (err) {
                    // §7-N: surface + reset unsub so a later claim-ready event can retry (§7-U).
                    console.warn('[activity] ' + board.coll + ' subscribe failed:', err && (err.code || err.message));
                    if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) {
                        _subs[board.key] = null;
                    }
                });
            } catch (e) {
                console.warn('[activity] ' + board.coll + ' init failed:', e && e.message || e);
            }
        });
    }

    // ── Panel open / close ──────────────────────────────────────────────────
    function openActivityPanel() {
        var panel = document.getElementById('activity-panel');
        if (!panel) return;
        _renderActivityList();
        panel.style.display = 'flex';
        // Mark everything seen at the newest item's timestamp → clear the badge.
        var items = _allItems();
        var newestMs = items.length ? items[0].ts : Date.now();
        _setLastSeenMs(newestMs);
        _renderActivityBadge();
        setTimeout(_renderActivityList, 0);  // repaint unread strips as read
    }
    function closeActivityPanel() {
        var panel = document.getElementById('activity-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Wire button + close (direct listeners; static DOM, deferred script) ────
    function _wireControls() {
        var btn = document.getElementById('map-activity-btn');
        if (btn && !btn._activityWired) { btn._activityWired = true; btn.addEventListener('click', openActivityPanel); }
        var close = document.getElementById('activity-panel-close');
        if (close && !close._activityWired) { close._activityWired = true; close.addEventListener('click', closeActivityPanel); }
        var panel = document.getElementById('activity-panel');
        if (panel && !panel._activityWired) {
            panel._activityWired = true;
            // Tap the dim backdrop (the panel element itself) closes it.
            panel.addEventListener('click', function (e) { if (e.target === panel) closeActivityPanel(); });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wireControls);
    else _wireControls();

    // Subscribe once building/room claims are ready (§7-A: never authReady/liffLinked
    // directly). Guarded like the sibling boards — tenant-liff-auth.js defines this.
    if (typeof window._onLiffClaimsReady === 'function') {
        window._onLiffClaimsReady(_subscribeActivity);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.openActivityPanel    = openActivityPanel;
    window.closeActivityPanel   = closeActivityPanel;
    window._renderActivityBadge = _renderActivityBadge;
})();
