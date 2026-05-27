// ---- Broadcast Announcements + Lease Notifications (shared module) ----
// Extracted from tenant_app.html inline script.
//
// Runtime dependencies (resolved via window.* at call time):
//   window._tenantAppBuilding / window._tenantAppRoom — set by detectRoomBuilding / linkAuthUid
//   window._onLiffClaimsReady(fn)    — fn run on authReady + liffLinked events
//   window._bellLastErr              — error state exposed to dev tools
//   window.firebase.firestore / .firestoreFunctions — Firebase SDK
//   window.firebaseAuth              — Firebase Auth SDK
//
// Exposes:
//   window._renderBroadcastBadge()   — re-render bell badge (called from displayLeaseRenewalAlert)
//   window._renderBroadcastsList()   — re-render announcement panel (called from displayLeaseRenewalAlert)
//   window._taLeaseNotifs            — array of server-emitted lease-expiry docs (read by openLeaseAlertFromBell)
//   window.openBroadcastsPanel()
//   window.closeBroadcastsPanel()

(function () {
    'use strict';

    // ── Private state ─────────────────────────────────────────────────────────
    var _broadcastsUnsub = null;
    var _broadcastsList  = [];           // cached, filtered, newest first
    var _broadcastsInitialReplay = true; // toast suppressed during first snapshot
    var _broadcastsRefreshScheduled = false;
    window._bellLastErr = window._bellLastErr || {};

    // Lease-expiry notification docs from server (leaseNotifications/{b}_{r}_{tier}).
    // Also exposed as window._taLeaseNotifs so openLeaseAlertFromBell handler in
    // the inline script can mark docs as read without requiring a cross-module API.
    var _taLeaseNotifs = [];
    window._taLeaseNotifs = _taLeaseNotifs;
    var _taLeaseNotifsUnsub = null;

    // ── Toast ─────────────────────────────────────────────────────────────────
    function _broadcastShowToast(msg) {
        try {
            var el = document.createElement('div');
            el.textContent = String(msg || '');
            el.setAttribute('role', 'status');
            el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:80px;' +
                'background:rgba(20,30,25,0.94);color:#fff;padding:11px 18px;border-radius:22px;' +
                'font-size:14px;font-family:inherit;z-index:2000;box-shadow:0 6px 24px rgba(0,0,0,.25);' +
                'max-width:88vw;text-align:center;line-height:1.4;animation:fadein .25s;';
            document.body.appendChild(el);
            setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3400);
            setTimeout(function () { el.remove(); }, 3800);
        } catch (_) {}
    }

    // ── Broadcast read-at (localStorage) ─────────────────────────────────────
    function _broadcastReadKey() {
        var room = window._tenantAppRoom || 'anon';
        return 'gh_last_broadcast_read_' + room;
    }
    function _getLastBroadcastReadAt() {
        try { return localStorage.getItem(_broadcastReadKey()) || ''; } catch (_) { return ''; }
    }
    function _setLastBroadcastReadAt(iso) {
        try { localStorage.setItem(_broadcastReadKey(), iso); } catch (_) {}
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _broadcastSentAtIso(d) {
        if (!d || !d.sentAt) return '';
        if (typeof d.sentAt === 'string') return d.sentAt;
        if (typeof d.sentAt.toDate === 'function') return d.sentAt.toDate().toISOString();
        return '';
    }
    function _broadcastRelTime(iso) {
        if (!iso) return '';
        var t = new Date(iso).getTime();
        if (!Number.isFinite(t)) return '';
        var diff = Date.now() - t;
        if (diff < 60*1000)            return 'เมื่อสักครู่';
        if (diff < 60*60*1000)         return Math.floor(diff/60000) + ' นาทีที่แล้ว';
        if (diff < 24*60*60*1000)      return Math.floor(diff/3600000) + ' ชั่วโมงที่แล้ว';
        if (diff < 7*24*60*60*1000)    return Math.floor(diff/86400000) + ' วันที่แล้ว';
        return new Date(t).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' });
    }
    function _escapeBroadcastHtml(s) {
        return String(s || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // ── Lease-alert synthesizer ───────────────────────────────────────────────
    // Reads from server-emitted leaseNotifications/ docs subscribed below.
    // Returns highest-urgency UNREAD item, null if none.
    function _leaseAlertItem() {
        var URGENCY = { 'expired': 0, '14': 1, '30': 2, '60': 3 };
        var unread = (_taLeaseNotifs || [])
            .filter(function (d) { return d.status !== 'read' && d.status !== 'stale'; });
        if (unread.length === 0) return null;
        unread.sort(function (a, b) {
            return (URGENCY[a.tier] != null ? URGENCY[a.tier] : 99) -
                   (URGENCY[b.tier] != null ? URGENCY[b.tier] : 99);
        });
        return _formatLeaseNotifForBell(unread[0]);
    }
    function _formatLeaseNotifForBell(d) {
        var tier = d.tier;
        var days = d.daysRemainingAtEmit;
        var icon, title;
        if (tier === 'expired') { icon = '⛔'; title = 'สัญญาเช่าหมดอายุแล้ว'; }
        else if (tier === '14') { icon = '🚨'; title = 'สัญญาเช่าใกล้หมดอายุ!'; }
        else if (tier === '30') { icon = '⚠️'; title = 'สัญญาเช่าใกล้หมดอายุ'; }
        else                    { icon = '📢'; title = 'สัญญาเช่าใกล้หมดอายุ'; }
        var dateStr = (d.leaseEndDate && d.leaseEndDate.toDate)
            ? d.leaseEndDate.toDate().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
            : '—';
        var body = (tier === 'expired')
            ? ('วันสิ้นสุด ' + dateStr + ' · โปรดติดต่อ Admin เพื่อจัดการสัญญา')
            : ('สัญญาของคุณจะหมดอายุในอีก ' + (days != null ? days : '—') + ' วัน · วันสิ้นสุด ' + dateStr);
        return {
            type: 'notice',
            title: icon + ' ' + title,
            body: body,
            sentAt: new Date().toISOString(),
            _virtualLeaseAlert: true,
            _tier: tier,
            _daysRemaining: days,
            _notifId: d.id
        };
    }

    // ── Unread count ──────────────────────────────────────────────────────────
    function _unreadBroadcastCount() {
        var cutoff = _getLastBroadcastReadAt();
        var broadcasts = _broadcastsList.filter(function (d) {
            var iso = _broadcastSentAtIso(d);
            return iso && (!cutoff || iso > cutoff);
        }).length;
        // Lease-renewal alert is a persistent reminder — counts as unread
        // for as long as the tenant's lease is within the 60-day warning
        // window, regardless of when they last opened the bell.
        return broadcasts + (_leaseAlertItem() ? 1 : 0);
    }

    // ── Bell badge + visibility ───────────────────────────────────────────────
    function _renderBroadcastBadge() {
        var badge = document.getElementById('map-bell-badge');
        if (!badge) return;
        var n = _unreadBroadcastCount();
        if (n > 0) {
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
        _renderBellVisibility();
    }
    function _renderBellVisibility() {
        var btn = document.getElementById('map-bell-btn');
        if (!btn) return;
        btn.style.display = 'flex';
    }

    // ── Announcements list renderer ───────────────────────────────────────────
    function _renderBroadcastsList() {
        var el = document.getElementById('broadcasts-panel-list');
        if (!el) return;
        var leaseItem = _leaseAlertItem();
        var items = leaseItem ? [leaseItem].concat(_broadcastsList) : _broadcastsList;
        if (!items.length) {
            el.innerHTML = '<div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:.92rem;">ยังไม่มีประกาศ</div>';
            return;
        }
        var cutoff = _getLastBroadcastReadAt();
        var TYPE_BADGE = { notice: '📢', event: '📅', banner: '🎉' };
        var TYPE_LABEL = { notice: 'ประกาศ', event: 'กิจกรรม', banner: 'ประกาศ' };
        var MONTHS_TH  = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        function fmtEventDate(ts) {
            var d;
            if (ts instanceof Date) d = ts;
            else if (ts && ts.toDate) d = ts.toDate();
            else if (typeof ts === 'string') d = new Date(ts);
            else if (typeof ts === 'number') d = new Date(ts);
            else return '';
            if (!d || isNaN(d.getTime())) return '';
            return d.getDate() + ' ' + MONTHS_TH[d.getMonth()] + ' ' + (d.getFullYear()+543) +
                ' · ' + ('0'+d.getHours()).slice(-2) + ':' + ('0'+d.getMinutes()).slice(-2);
        }
        el.innerHTML = items.map(function (d) {
            var iso    = _broadcastSentAtIso(d);
            var unread = d._virtualLeaseAlert ? true : (iso && (!cutoff || iso > cutoff));
            var type   = d.type || 'notice';
            var badge  = TYPE_BADGE[type] || '📢';
            var label  = d._virtualLeaseAlert ? 'สัญญาเช่า' : (TYPE_LABEL[type] || 'ประกาศ');
            var title  = _escapeBroadcastHtml(d.title || '(ไม่มีหัวข้อ)');
            var body   = _escapeBroadcastHtml(d.body || '');
            var when   = d._virtualLeaseAlert ? '' : _broadcastRelTime(iso);
            var LEASE_TIER_COLOR = { 'expired': '#b71c1c', '14': '#c62828', '30': '#e65100', '60': '#f57f17' };
            var leaseBorder = d._virtualLeaseAlert
                ? ('border-left:4px solid ' + (LEASE_TIER_COLOR[d._tier] || '#f57f17') + ';')
                : (unread ? 'border-left:3px solid var(--primary-green, #4caf50);' : '');
            var leaseBg = d._virtualLeaseAlert ? 'background:#fff8e1;' : '';
            var leaseClick = (d._virtualLeaseAlert && d._notifId)
                ? (' data-action="openLeaseAlertFromBell" data-notif-id="' + _escapeBroadcastHtml(d._notifId) + '" role="button" tabindex="0"')
                : '';
            var leaseCursor = d._virtualLeaseAlert ? 'cursor:pointer;' : '';
            var eventMeta = (type === 'event' && (d.eventDate || d.location)) ? (
                '<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #e5e7eb; font-size:.82rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:12px;">' +
                (d.eventDate ? '<span>📅 ' + _escapeBroadcastHtml(fmtEventDate(d.eventDate)) + '</span>' : '') +
                (d.location ? '<span>📍 ' + _escapeBroadcastHtml(d.location) + '</span>' : '') +
                '</div>') : '';
            var leaseFooter = d._virtualLeaseAlert
                ? '<div style="margin-top:8px; font-size:.82rem; color:#1565c0; font-weight:600;">แตะเพื่อต่อสัญญา →</div>'
                : '';
            return '<div' + leaseClick + ' style="border-bottom:1px solid var(--border, #e5e5e5); padding:14px 20px; ' + leaseBorder + ' ' + leaseBg + ' ' + leaseCursor + '">' +
                '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:.35rem;">' +
                '<strong style="font-size:.98rem; ' + (unread ? 'color:var(--text-dark);' : 'color:var(--text-muted);') + '">' + (d._virtualLeaseAlert ? '' : badge + ' ') + title + '</strong>' +
                (when ? '<span style="font-size:.78rem; color:var(--text-muted); white-space:nowrap;">' + when + '</span>' : '') +
                '</div>' +
                '<div style="font-size:.74rem; color:var(--text-muted); margin-bottom:.4rem;">' + label + '</div>' +
                '<div style="font-size:.9rem; color:var(--text-dark, #333); white-space:pre-wrap;">' + body + '</div>' +
                eventMeta +
                leaseFooter +
                '</div>';
        }).join('');
    }

    // ── Audience resolver (reads actual token claim, not _taBuilding shortcut) ─
    // S1 v2.1: use token claim so Firestore rule `audience == request.auth.token.building`
    // resolves correctly — client-side _tenantAppBuilding can differ from the real claim.
    async function _bellResolveAudiences() {
        var audiences = ['all'];
        try {
            var user = window.firebaseAuth && window.firebaseAuth.currentUser;
            if (user && typeof user.getIdTokenResult === 'function') {
                var res = await user.getIdTokenResult();
                var claimed = res && res.claims && res.claims.building;
                if (claimed && claimed !== 'all' && audiences.indexOf(claimed) === -1) {
                    audiences.push(claimed);
                }
            }
        } catch (_) {}
        return audiences;
    }

    // ── Announcements subscriber ──────────────────────────────────────────────
    // C4 S2 (2026-05-18): single-source from announcements/ post-migration.
    async function _subscribeBroadcasts() {
        if (_broadcastsUnsub) return;
        if (!window.firebase || !window.firebase.firestore || !window.firebase.firestoreFunctions) return;
        // §7-U: claim-presence guard FIRST, before setting unsub.
        if (!window._tenantAppBuilding) return;
        var fs = window.firebase.firestoreFunctions;
        var db = window.firebase.firestore();
        var audiences = await _bellResolveAudiences();

        var newCache    = new Map();
        var sourcesReplayed = new Set();
        var TOTAL_SOURCES = 1;
        var unsubNew = null;
        var retryNewTimer = null;

        function rerender(sourceId) {
            sourcesReplayed.add(sourceId);
            var byId = new Map();
            for (var entry of newCache.values()) byId.set(entry.id, entry);
            var priorIds = new Set(_broadcastsList.map(function (b) { return b.id; }));
            _broadcastsList = Array.from(byId.values()).sort(function (a, b) {
                var ta = a.sentAt && a.sentAt.toDate ? a.sentAt.toDate().getTime() : new Date(a.sentAt || 0).getTime();
                var tb = b.sentAt && b.sentAt.toDate ? b.sentAt.toDate().getTime() : new Date(b.sentAt || 0).getTime();
                return tb - ta;
            }).slice(0, 20);
            _renderBroadcastBadge();
            _renderBroadcastsList();
            if (_broadcastsInitialReplay) {
                if (sourcesReplayed.size >= TOTAL_SOURCES) _broadcastsInitialReplay = false;
                return;
            }
            var fresh = _broadcastsList.find(function (d) { return !priorIds.has(d.id); });
            if (fresh) _broadcastShowToast('📣 ประกาศใหม่: ' + (fresh.title || ''));
        }

        function subscribeNew() {
            if (unsubNew) return;
            try {
                var qNew = fs.query(
                    fs.collection(db, 'announcements'),
                    fs.where('audience', 'in', audiences),
                    fs.limit(20)
                );
                unsubNew = fs.onSnapshot(qNew, function (snap) {
                    newCache.clear();
                    snap.docs.forEach(function (d) { newCache.set(d.id, Object.assign({ id: d.id }, d.data())); });
                    window._bellLastErr.new = null;
                    rerender('new');
                }, function (err) {
                    console.warn('announcements/bell subscribe failed:', err && err.message || err);
                    window._bellLastErr.new = (err && (err.code || err.message)) || String(err);
                    if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) {
                        try { unsubNew && unsubNew(); } catch(_){}
                        unsubNew = null;
                        if (err.code === 'failed-precondition' && !retryNewTimer) {
                            retryNewTimer = setTimeout(function () {
                                retryNewTimer = null;
                                if (_broadcastsUnsub) subscribeNew();
                            }, 8000);
                        }
                    }
                });
            } catch (e) {
                console.warn('announcements/bell init failed:', e && e.message || e);
                window._bellLastErr.new = 'init: ' + (e && e.message || e);
            }
        }

        subscribeNew();
        _broadcastsUnsub = function () {
            if (retryNewTimer) { clearTimeout(retryNewTimer); retryNewTimer = null; }
            try { unsubNew && unsubNew(); } catch(_){}
            unsubNew = null;
        };
    }

    // ── Lease-expiry notifications subscriber ─────────────────────────────────
    // Server emits at 60/30/14/expired milestones via remindLeaseExpiry.js CF.
    function _subscribeLeaseNotifications() {
        if (_taLeaseNotifsUnsub) return;  // §7-V: idempotency
        // §7-U: claim guard — without building+room from token claims, the
        // where() returns empty AND we mark unsub set → stale forever.
        if (!window._tenantAppBuilding || !window._tenantAppRoom) return;
        if (!window.firebase || !window.firebase.firestoreFunctions) return;
        var fs = window.firebase.firestoreFunctions;
        var db = window.firebase.firestore();
        var q = fs.query(
            fs.collection(db, 'leaseNotifications'),
            fs.where('building', '==', window._tenantAppBuilding),
            fs.where('room', '==', String(window._tenantAppRoom))
        );
        _taLeaseNotifsUnsub = fs.onSnapshot(q, function (snap) {
            _taLeaseNotifs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
            window._taLeaseNotifs = _taLeaseNotifs;  // keep window ref in sync for inline callers
            try { _renderBroadcastBadge(); } catch (e) { console.warn('[leaseNotifs] badge re-render failed:', e && e.message || e); }
            try { _renderBroadcastsList(); } catch (e) { console.warn('[leaseNotifs] list re-render failed:', e && e.message || e); }
        }, function (err) {
            // §7-N: error callback prevents silent stuck state. Reset unsub on
            // permission-denied / failed-precondition so the next claim-ready
            // event can retry (§7-U recovery pattern).
            console.warn('[leaseNotifs] subscribe failed:', err && (err.code || err.message));
            if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition')) {
                _taLeaseNotifsUnsub = null;
            }
        });
    }

    // Register both subscribers via _onLiffClaimsReady so they run once
    // building/room claims are available (§7-A: never use authReady/liffLinked directly).
    window._onLiffClaimsReady(_subscribeBroadcasts);
    window._onLiffClaimsReady(_subscribeLeaseNotifications);

    // ── Bell auth-recovery wiring ─────────────────────────────────────────────
    // C4 S1 v2.2 (2026-05-17): if Firebase Auth becomes available AFTER the bell
    // first subscribed (or while the subscribers were stuck in permission-denied),
    // re-trigger _subscribeBroadcasts so the now-authenticated queries can succeed.
    (function _wireBellAuthRecovery() {
        function tryWire() {
            var auth = window.firebaseAuth;
            if (!auth || typeof auth.onAuthStateChanged !== 'function') {
                setTimeout(tryWire, 800);
                return;
            }
            auth.onAuthStateChanged(function (user) {
                if (!user || !window._tenantAppBuilding) return;
                var errs = window._bellLastErr || {};
                var someSourceFailed = !!errs.new;
                if (!_broadcastsUnsub || someSourceFailed) {
                    if (_broadcastsUnsub) {
                        try { _broadcastsUnsub(); } catch(_){}
                        _broadcastsUnsub = null;
                    }
                    _subscribeBroadcasts();
                }
            });
        }
        tryWire();
    })();

    // ── Panel open / close ────────────────────────────────────────────────────
    function openBroadcastsPanel() {
        var panel = document.getElementById('broadcasts-panel');
        if (!panel) return;
        _renderBroadcastsList();
        panel.style.display = 'flex';
        var newest = _broadcastsList[0];
        var iso = newest ? _broadcastSentAtIso(newest) : new Date().toISOString();
        if (iso) {
            _setLastBroadcastReadAt(iso);
            _renderBroadcastBadge();
            setTimeout(_renderBroadcastsList, 0);
        }
    }
    function closeBroadcastsPanel() {
        var panel = document.getElementById('broadcasts-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window._renderBroadcastBadge  = _renderBroadcastBadge;
    window._renderBroadcastsList  = _renderBroadcastsList;
    window._renderBellVisibility  = _renderBellVisibility;
    window.openBroadcastsPanel    = openBroadcastsPanel;
    window.closeBroadcastsPanel   = closeBroadcastsPanel;
})();
