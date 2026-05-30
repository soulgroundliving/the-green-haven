/**
 * tenant-community.js — Community subscriptions for tenant_app.html.
 *
 * Extracted from tenant_app.html inline script (~125 lines removed):
 *   - Banner subscriptions (_subscribeAnnouncementsFromFirestore)
 *   - Event subscriptions (_subscribeNewAnnouncementsEvents)
 *   - Nav badge updates (_updateCommunityBadge)
 *   - Community read marker (markCommunityRead)
 *
 * Anti-patterns enforced (CLAUDE.md §7):
 *   §7-U: claim-guard (if (!_taBuilding) return) before setting unsub, plus error
 *          callback resets unsub so liffLinked retry can resubscribe.
 *   §7-N: every onSnapshot has an error callback.
 *
 * Depends on globals:
 *   _taBuilding              (window var from inline tenant_app.html)
 *   window.firebase.*        (Firebase module init)
 *   window._setMarketSeenAt  (tenant-marketplace.js)
 *   window._renderBellVisibility (inline tenant_app.html)
 *   window.renderQuizHub     (tenant-quiz.js)
 *   window.renderQuizHistory (tenant-quiz.js)
 *   _onLiffClaimsReady       (inline tenant_app.html — wired at module load)
 */
(function () {
    'use strict';

    // ── 1. COMMUNITY BANNERS (C4 type='banner') ───────────────────────────
    // Firestore: announcements/ WHERE type='banner' AND audience in [all, building].
    // Hydrates localStorage.announcements_data for badge counts.
    // Anti-pattern §7-U: claim-guard FIRST, error callback resets unsub for liffLinked retry.

    let _taAnnUnsub = null;

    function _subscribeAnnouncementsFromFirestore() {
        if (_taAnnUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        if (!_taBuilding) return;  // §7-U claim-presence guard
        try {
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            const q = fs.query(
                fs.collection(db, 'announcements'),
                fs.where('type', '==', 'banner'),
                fs.where('audience', 'in', ['all', _taBuilding]),
                fs.limit(20)
            );
            _taAnnUnsub = fs.onSnapshot(q, snap => {
                const docs = snap.docs.map(d => {
                    const data = d.data() || {};
                    // Safely resolve sentAt → Date. Manually-backfilled docs may
                    // lack sentAt; `??` doesn't catch NaN from Date.parse('').
                    let sentMs = data.sentAt?.toDate?.()?.getTime?.();
                    if (sentMs == null) sentMs = Date.parse(data.sentAt || '');
                    if (!Number.isFinite(sentMs)) sentMs = Date.now();
                    const sentDate = new Date(sentMs);
                    return {
                        id: d.id,
                        icon: data.icon || '📢',
                        title: data.title || '',
                        content: data.body || '',
                        date: sentDate.toISOString().split('T')[0],
                        time: '',
                        building: data.audience || 'all',
                        createdAt: sentDate.toISOString(),
                        createdBy: data.sender?.email || '📌 Admin',
                    };
                });
                const local = JSON.parse(localStorage.getItem('announcements_data') || '[]');
                const byId = new Map();
                local.forEach(a => byId.set(a.id, a));
                docs.forEach(a => byId.set(a.id, a));
                localStorage.setItem('announcements_data', JSON.stringify(Array.from(byId.values())));
                _updateCommunityBadge(docs);
            }, err => {
                console.warn('[announcements/banner] subscribe failed:', err?.message || err);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
                    _taAnnUnsub = null;
                }
            });
        } catch(e) { console.warn('tenant announcements subscribe failed:', e); }
    }

    // ── 2. COMMUNITY BADGE ────────────────────────────────────────────────

    function _updateCommunityBadge(docs) {
        const badge = document.getElementById('nav-badge-community');
        if (!badge) return;
        const lastSeen = localStorage.getItem('ta_community_seen_at');
        if (!lastSeen) {
            // First open: treat all existing announcements as seen — no badge on fresh install
            localStorage.setItem('ta_community_seen_at', new Date().toISOString());
            badge.style.display = 'none';
            return;
        }
        badge.style.display = docs.some(a => (a.createdAt || '') > lastSeen) ? 'block' : 'none';
    }

    function markCommunityRead() {
        localStorage.setItem('ta_community_seen_at', new Date().toISOString());
        const badge = document.getElementById('nav-badge-community');
        if (badge) badge.style.display = 'none';
        if (typeof window._setMarketSeenAt === 'function') window._setMarketSeenAt();
        if (typeof window._renderBellVisibility === 'function') window._renderBellVisibility();
        if (typeof window.renderQuizHub === 'function') window.renderQuizHub();
        if (typeof window.renderQuizHistory === 'function') window.renderQuizHistory();
    }

    // ── 3. COMMUNITY EVENTS (C4 type='event') ─────────────────────────────
    // Firestore: announcements/ WHERE type='event' AND audience in [all, building].
    // Hydrates localStorage.community_events_data for badge counts.

    let _taNewEventsUnsub = null;

    function _subscribeNewAnnouncementsEvents() {
        if (_taNewEventsUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        if (!_taBuilding) return;  // §7-U claim-presence guard
        try {
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            const q = fs.query(
                fs.collection(db, 'announcements'),
                fs.where('type', '==', 'event'),
                fs.where('audience', 'in', ['all', _taBuilding]),
                fs.limit(50)
            );
            _taNewEventsUnsub = fs.onSnapshot(q, snap => {
                // Normalize C4 event shape → legacy shape (title/date/time/location/description/building).
                const docs = snap.docs.map(d => {
                    const data = d.data() || {};
                    const dt = data.eventDate?.toDate?.() || (data.eventDate ? new Date(data.eventDate) : null);
                    const dateStr = dt ? dt.toISOString().split('T')[0] : '';
                    const timeStr = dt ? dt.toISOString().split('T')[1]?.slice(0, 5) : '';
                    return {
                        id: d.id,
                        title: data.title || '',
                        date: dateStr,
                        time: timeStr,
                        location: data.location || '',
                        description: data.body || '',
                        building: data.audience || 'all',
                    };
                });
                const local = JSON.parse(localStorage.getItem('community_events_data') || '[]');
                const byId = new Map();
                local.forEach(e => byId.set(e.id, e));
                docs.forEach(e => byId.set(e.id, e));
                localStorage.setItem('community_events_data', JSON.stringify(Array.from(byId.values())));
            }, err => {
                console.warn('[announcements/event] subscribe failed:', err?.message || err);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
                    _taNewEventsUnsub = null;
                }
            });
        } catch(e) { console.warn('tenant new-events subscribe failed:', e); }
    }

    // ── Wiring ─────────────────────────────────────────────────────────────

    if (typeof _onLiffClaimsReady === 'function') {
        _onLiffClaimsReady(_subscribeAnnouncementsFromFirestore);
        _onLiffClaimsReady(_subscribeNewAnnouncementsEvents);
    }

    window.markCommunityRead     = markCommunityRead;
    window._updateCommunityBadge = _updateCommunityBadge;
})();
