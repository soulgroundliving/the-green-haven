/**
 * tenant-marketplace.js — Marketplace feature for tenant_app.html.
 *
 * Extracted from the ===== MARKETPLACE ===== section (was ~750 lines inline).
 * Loaded as a deferred script; wires _onLiffClaimsReady internally so the
 * subscription starts after LIFF claims are ready without depending on the
 * inline script's parse-time evaluation order.
 *
 * Status enum (Nest Marketplace Spec v1.0 §3.2):
 *   AVAILABLE | RESERVED | COMPLETED
 *   Legacy: 'active' (= AVAILABLE), 'closed' (= COMPLETED).
 *
 * Anti-patterns enforced (CLAUDE.md §7):
 *   §7-T : dual-write reader-tolerance for legacy status values
 *   §7-U : claim-first guard (`if (!_taBuilding) return;`) in _subscribeMarketplace
 *   §7-N : onSnapshot has error callback that resets _marketUnsub on denied/precondition
 *   §7-Y : data: URL → Blob via _marketDataUrlToBlob (never fetch('data:...') under CSP)
 *   §7-X : innerHTML assignments have non-empty fallbacks; DOM API used for detail modal
 *
 * Depends on globals set before this defer script runs:
 *   window._taBuilding, window._taRoom, window._taTenant  (tenant-liff-auth.js vars)
 *   window._authUid, window._lineUserId, window._lineProfile  (tenant-liff-auth.js)
 *   window._onLiffClaimsReady  (tenant-liff-auth.js)
 *   window.firebase.*  (Firebase module init)
 *   window.toast(msg, kind)  (tenant_app.html inline)
 *   window.showPage(id)  (tenant_app.html inline)
 *   window.showSubPage(id)  (tenant_app.html inline)
 *   window.compressImage(src, maxW, maxH, q)  (tenant_app.html inline)
 *   window.GhModal  (modal.js)
 *   window._openOrCreateChat  (marketplace-chat.js)
 *   window._renderBellVisibility  (broadcasts.js, optional — typeof-guarded)
 */
(function () {
    'use strict';

    // ── Local wrappers for globals defined in the main inline script ───────


    function _toast(msg, kind) {
        if (typeof window.toast === 'function') window.toast(msg, kind);
    }

    // ── Status enum + helpers ──────────────────────────────────────────────

    // Status enum (Nest Marketplace Spec v1.0 §3.2): AVAILABLE | RESERVED | COMPLETED.
    // Legacy values still in production data: 'active' (= AVAILABLE), 'closed' (= COMPLETED).
    // Reader-tolerant transition per CLAUDE.md §7-T: subscribe queries both old + new;
    // _normalizeMarketStatus() collapses to canonical enum for all UI logic. Backfill via
    // tools/migrate-marketplace-status.js (dry-run default per §7-I).
    // Subscribe pulls active AND closed posts. Public feed filters COMPLETED out
    // (renderMarketFeed below), but "ประกาศของฉัน" needs closed entries so the
    // owner can re-open or edit them (2026-05-25). Composite index unchanged
    // because Firestore `in` query just widens accepted values.
    const MARKET_STATUS_VISIBLE = ['AVAILABLE', 'RESERVED', 'COMPLETED', 'active', 'closed'];

    function _normalizeMarketStatus(s) {
        if (s === 'active') return 'AVAILABLE';
        if (s === 'closed') return 'COMPLETED';
        return s || 'AVAILABLE';
    }

    // Convert a data: URL to a Blob synchronously (per §7-Y — never use
    // fetch('data:...') under CSP; connect-src does not include data:).
    function _marketDataUrlToBlob(dataUrl) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
        if (!m) throw new Error('Invalid data URL');
        const bin = atob(m[2]);
        const u8  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: m[1] });
    }

    // Upload a Blob to marketplace/{postId}/img.<ext> in Firebase Storage,
    // return the getDownloadURL. Path matches storage.rules /marketplace/{postId}/{fileName}.
    async function _uploadMarketImage(postId, blob) {
        const stg = window.firebase?.storage?.();
        const stgFs = window.firebase?.storageFunctions;
        if (!stg || !stgFs) throw new Error('Firebase Storage not initialized');
        const ext = (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'jpg';
        const path = `marketplace/${postId}/img.${ext}`;
        const ref = stgFs.ref(stg, path);
        await stgFs.uploadBytes(ref, blob, { contentType: blob.type });
        return stgFs.getDownloadURL(ref);
    }

    // ── State ──────────────────────────────────────────────────────────────

    let _marketUnsub = null;
    let _marketItems = [];
    let _marketFilter = 'all';
    let _marketImageData = null;
    // Set by editMarketItem(); cleared by saveNewMarketItem() success path,
    // _resetMarketFormToCreateMode(), and goBackToMarketplace(). When truthy, form-submit
    // takes the setDoc(merge:true) branch instead of addDoc.
    let _marketEditingId = null;

    // ── Seen-at tracking (for bell badge / unread indicator) ───────────────

    function _marketSeenKey() {
        return 'gh_market_seen_at_' + (_taBuilding || '') + '_' + (_taRoom || '');
    }
    function _getMarketSeenAt() { return localStorage.getItem(_marketSeenKey()); }
    function _setMarketSeenAt() {
        localStorage.setItem(_marketSeenKey(), new Date().toISOString());
    }
    function _hasNewMarketItem() {
        if (!_marketItems.length) return false;
        const seen = _getMarketSeenAt();
        if (!seen) { _setMarketSeenAt(); return false; } // first open — treat all as seen
        return _marketItems.some(i => (i.createdAt || '') > seen);
    }

    // ── Firestore subscription ─────────────────────────────────────────────

    function _subscribeMarketplace() {
        if (_marketUnsub) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions || !_taBuilding) return;
        try {
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            const q = fs.query(
                fs.collection(db, 'marketplace'),
                fs.where('building', '==', _taBuilding),
                fs.where('status', 'in', MARKET_STATUS_VISIBLE),
                fs.orderBy('createdAt', 'desc'),
                fs.limit(100)
            );
            _marketUnsub = fs.onSnapshot(q, snap => {
                const now = new Date().toISOString();
                _marketItems = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(i => !i.expiresAt || i.expiresAt > now);
                renderMarketFeed();
                if (typeof window._renderBellVisibility === 'function') window._renderBellVisibility();
            }, err => {
                console.error('[marketplace] subscribe failed:', err?.message);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') _marketUnsub = null;
                const c = document.getElementById('market-list-container');
                if (c && !c.querySelector('[data-err="market"]')) {
                    c.innerHTML = '<p data-err="market" class="ta-err-msg-lg">โหลดไม่สำเร็จ — กรุณา Reload</p>';
                }
            });
        } catch(e) { console.warn('subscribeMarketplace:', e); }
    }

    // ── Feed rendering ─────────────────────────────────────────────────────

    function renderMarketFeed() {
        const container = document.getElementById('market-list-container');
        if (!container) return;
        // Filter dimensions: 'all' (no filter), category strings ('item'/'service'/'free'),
        // OR boolean-flag pills ('skyhook' → skyHookReady===true, 'pet' → isPetCategory===true).
        // Single-select per spec §4.2/§4.4 — selecting a flag pill replaces the category
        // filter. Future could add multi-dimensional (category × flag); not in MVP.
        // Closed posts come into _marketItems so owners can re-open / edit them
        // in "ประกาศของฉัน" — but the public feed below must NOT show them.
        const publicItems = _marketItems.filter(i => _normalizeMarketStatus(i.status) !== 'COMPLETED');
        let filtered;
        if (_marketFilter === 'all') {
            filtered = publicItems;
        } else if (_marketFilter === 'skyhook') {
            filtered = publicItems.filter(i => i.skyHookReady === true);
        } else if (_marketFilter === 'pet') {
            filtered = publicItems.filter(i => i.isPetCategory === true);
        } else {
            filtered = publicItems.filter(i => i.category === _marketFilter);
        }

        container.textContent = '';

        if (filtered.length === 0) {
            const isFiltered = _marketFilter !== 'all';
            const empty = document.createElement('div');
            empty.className = 'gh-empty-state';
            empty.style.gridColumn = '1/-1';
            // Reuse the brand muji empty-state (SVG + tokens) for consistency
            // with the static pre-load state in tenant_app.html.
            empty.innerHTML = `
                <div class="gh-empty-state__illust">
                    <svg viewBox="0 0 120 120" aria-hidden="true">
                        <path d="M30 42 l4-12 h52 l4 12 v50 a4 4 0 0 1-4 4 h-52 a4 4 0 0 1-4-4 z"/>
                        <path d="M48 42 v-8 a12 12 0 0 1 24 0 v8"/>
                        <path d="M58 64 l-4 4 M62 60 l4 4 M60 56 v8"/>
                    </svg>
                </div>
                <p class="gh-empty-state__title">${isFiltered ? 'ไม่มีประกาศในหมวดนี้' : 'ยังไม่มีใครลงประกาศ'}</p>
                <p class="gh-empty-state__text">${isFiltered ? 'ลองดูหมวดอื่น หรือเป็นคนแรกที่ลงประกาศก็ได้นะ' : 'เป็นคนแรกของตึกสิครับ — ของที่ไม่ใช้ ขายต่อให้เพื่อนบ้านได้'}</p>`;
            container.appendChild(empty);
            renderMyListings();
            return;
        }

        // Category accent metadata — emoji + short Thai label + glyph color.
        // Color is used ONLY for the small media chip text + tag chips
        // (semantic, sparing) per the muji palette; card surfaces stay neutral.
        const CAT = {
            item:    { label: '🛍️', name: 'มือสอง',  text: '#3B82F6' },
            service: { label: '💅', name: 'บริการ',   text: '#7C3AED' },
            free:    { label: '🎁', name: 'แจกฟรี',   text: '#16A34A' },
            // Sprint 5 — Wishlist: tenant asking, not selling. Rose distinguishes
            // "asking" from "free giveaway" (green).
            request: { label: '✋', name: 'อยากได้',  text: '#E11D48' }
        };

        // Build the feed as one innerHTML pass (perf: single parse vs ~200 style
        // writes). Each card is a role=button surface — the WHOLE card opens the
        // detail modal, so there's no chunky per-card CTA button (the old
        // "อ่านรายละเอียด" button wrapped to 3 lines in the narrow 2-col grid).
        // Owner-only actions (close/delete) live inside the detail modal.
        const cards = filtered.map(item => {
            const cat       = CAT[item.category] || CAT.item;
            const isFree    = item.category === 'free';
            const isRequest = item.category === 'request';
            // Sprint 5 — Wishlist: "อยากได้" replaces the price on request posts.
            const priceText = isFree ? 'ฟรี' : isRequest ? 'อยากได้' : '฿' + (item.price || 0);
            const priceMod  = isFree ? ' mk-price--free' : isRequest ? ' mk-price--ask' : '';
            const safeId    = _esc(item.id);
            const safeTitle = _esc(item.title || '');
            // Dual-read per CLAUDE.md §7-L: prefer Storage URL (new posts), fall
            // back to inline base64 (legacy posts) until natural ~30d expiry.
            const imgSrc    = item.imageUrl || item.imageData || '';
            const mediaInner = imgSrc
                ? `<img src="${_esc(imgSrc)}" alt="${safeTitle}" loading="lazy">`
                : `<span class="mk-card__media-emoji">${cat.label}</span>`;
            const roomHtml = (item.showRoom && item.room)
                ? `<span class="mk-room">ห้อง ${_esc(item.room)}</span>` : '';
            // Sprint 3 + Sprint 4 tag chips — hidden when both flags are false.
            const tagsHtml = (item.skyHookReady || item.isPetCategory)
                ? `<div class="mk-tags">${item.skyHookReady ? '<span class="mk-tag" style="background:#EFF6FF;color:#3B82F6;">📦 Sky Hook</span>' : ''}${item.isPetCategory ? '<span class="mk-tag" style="background:#FDF4FF;color:#A855F7;">🐾 สัตว์เลี้ยง</span>' : ''}</div>`
                : '';
            return `<div class="mk-card" role="button" tabindex="0" data-mkt-act="detail" data-mid="${safeId}" aria-label="${safeTitle}">
                <div class="mk-card__media">${mediaInner}<span class="mk-chip" style="color:${cat.text};">${cat.label} ${cat.name}</span></div>
                <div class="mk-card__body">
                    <div class="mk-card__title">${safeTitle}</div>
                    ${tagsHtml}
                    <div class="mk-card__meta"><span class="mk-price${priceMod}">${_esc(priceText)}</span>${roomHtml}</div>
                    <div class="mk-card__cta">ดูรายละเอียด <i class="fas fa-arrow-right"></i></div>
                </div>
            </div>`;
        }).join('');
        container.innerHTML = cards;

        // Click + keyboard delegation — cards are role=button so Enter/Space
        // must activate them too (§ a11y). One listener for the whole grid.
        if (!container._mktDelegated) {
            const _openCard = (el) => {
                const card = el.closest('[data-mkt-act="detail"]');
                if (!card) return;
                const it = _marketItems.find(i => i.id === card.dataset.mid);
                if (it) openMarketDetail(it);
            };
            container.addEventListener('click', (e) => _openCard(e.target));
            container.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    const card = e.target.closest('.mk-card[data-mkt-act]');
                    if (card) { e.preventDefault(); _openCard(card); }
                }
            });
            container._mktDelegated = true;
        }

        renderMyListings();
    }

    function renderMyListings() {
        const section = document.getElementById('my-listings-section');
        const cont = document.getElementById('my-listings-container');
        if (!section || !cont) return;
        const mine = _marketItems.filter(i => i.ownerUid === window._authUid);
        if (!mine.length) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        cont.textContent = '';

        const catEmoji = { free: '🎁', service: '💅', request: '✋', item: '🛍️' };

        mine.forEach(item => {
            const norm       = _normalizeMarketStatus(item.status);
            const isClosed   = norm === 'COMPLETED';
            const isReserved = norm === 'RESERVED';

            const card = document.createElement('div');
            card.className = 'mk-mine';

            // ── head: thumbnail + info + status ──
            const head = document.createElement('div');
            head.className = 'mk-mine__head';

            const thumb = document.createElement('div');
            thumb.className = 'mk-mine__thumb';
            const imgSrc = item.imageUrl || item.imageData || '';
            if (imgSrc) {
                const im = document.createElement('img');
                im.src = imgSrc;
                im.alt = item.title || '';
                im.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                thumb.appendChild(im);
            } else {
                thumb.textContent = catEmoji[item.category] || catEmoji.item;
            }
            head.appendChild(thumb);

            const info = document.createElement('div');
            info.className = 'mk-mine__info';
            const t = document.createElement('div');
            t.className = 'mk-mine__title';
            t.textContent = item.title || '';
            const sub = document.createElement('div');
            sub.className = 'mk-mine__sub';
            sub.textContent = (item.category === 'free' ? 'แจกฟรี' : item.category === 'request' ? 'อยากได้' : '฿' + (item.price || 0))
                + (item.showRoom && item.room ? ' · ห้อง ' + item.room : '');
            const status = document.createElement('div');
            status.className = 'mk-mine__status';
            const dot = document.createElement('span');
            dot.className = 'mk-mine__dot';
            dot.style.background = isClosed ? '#9ca3af' : isReserved ? '#d97706' : '#16a34a';
            const stxt = document.createElement('span');
            stxt.style.color = isClosed ? 'var(--muted)' : isReserved ? '#b45309' : 'var(--ok-text)';
            stxt.textContent = isClosed ? 'ปิดแล้ว' : isReserved ? 'มีคนจอง' : 'เปิดอยู่';
            status.appendChild(dot);
            status.appendChild(stxt);
            info.appendChild(t);
            info.appendChild(sub);
            info.appendChild(status);
            head.appendChild(info);
            card.appendChild(head);

            // ── action row: [ปิด / เปิดใหม่] · [แก้ไข] · [ลบ] — full-width pills.
            // Colors kept distinct + saturated per #295 (delete must read as
            // danger). innerHTML is static label markup only (no user data).
            const actions = document.createElement('div');
            actions.className = 'mk-mine__actions';
            const mkBtn = (cls, html, fn) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'mk-act ' + cls;
                b.innerHTML = html;
                b.addEventListener('click', fn);
                return b;
            };
            actions.appendChild(isClosed
                ? mkBtn('mk-act--reopen', '<i class="fas fa-rotate-right"></i> เปิดใหม่', () => _reopenMarketItem(item.id))
                : mkBtn('mk-act--close',  '<i class="fas fa-circle-check"></i> ปิด',     () => markMarketClosed(item.id)));
            actions.appendChild(mkBtn('mk-act--edit', '<i class="fas fa-pen"></i> แก้ไข', () => editMarketItem(item)));
            actions.appendChild(mkBtn('mk-act--del',  '<i class="fas fa-trash-can"></i> ลบ', () => deleteMarketItem(item.id)));
            card.appendChild(actions);

            cont.appendChild(card);
        });
    }

    function filterMarket(filter, btn) {
        _marketFilter = filter;
        document.querySelectorAll('.market-pill').forEach(p => p.classList.remove('market-pill-active'));
        if (btn) btn.classList.add('market-pill-active');
        renderMarketFeed();
    }

    // ── Detail modal ───────────────────────────────────────────────────────

    // Open the full-detail modal for a marketplace listing. The main feed cards
    // intentionally show ONLY a "อ่านรายละเอียด" CTA — destructive owner actions
    // (close, delete) live INSIDE this modal so non-owners never see them.
    // Owner gating is by ownerUid match; the same gate is enforced server-side
    // in firestore.rules:77 (update allowed only for admin OR ownerUid match).
    function openMarketDetail(item) {
        if (!window.GhModal || !item) {
            // Fallback: if modal helper hasn't loaded, jump straight to contact.
            if (item) contactSeller(item);
            return;
        }
        const isFree    = item.category === 'free';
        const isRequest = item.category === 'request';
        const isOwn     = item.ownerUid === window._authUid;
        // Sprint 5 — Wishlist parity with renderMarketFeed: badge + CTA flip
        // for request posts. "✋ ฉันช่วยได้" replaces "ติดต่อผู้ขาย" since the
        // poster is asking, not selling — the helper is the responder.
        const priceText = isFree ? 'ฟรี' : isRequest ? 'อยากได้' : '฿' + (item.price || 0);
        const priceBg  = isFree ? '#F0FDF4' : isRequest ? '#FFF1F2' : '#FFF7ED';
        const priceCol = isFree ? '#16A34A' : isRequest ? '#E11D48' : '#D97706';
        const actionLabel = item.category === 'service' ? '📞 นัดหมายผู้ให้บริการ'
            : isFree    ? '🙋 ขอรับของ'
            : isRequest ? '✋ ฉันช่วยได้'
            : '💬 ติดต่อผู้ขาย';

        // Build body via DOM API (avoid innerHTML — §7-X footgun + XSS).
        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

        const _detailImgSrc = item.imageUrl || item.imageData || '';
        if (_detailImgSrc) {
            const img = document.createElement('img');
            img.src = _detailImgSrc;
            img.alt = item.title || '';
            img.style.cssText = 'width:100%;border-radius:12px;max-height:280px;object-fit:cover;';
            body.appendChild(img);
        }

        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        const priceBadge = document.createElement('span');
        priceBadge.style.cssText = 'background:' + priceBg + ';color:' + priceCol + ';padding:4px 12px;border-radius:8px;font-weight:700;font-size:var(--fs-sm);';
        priceBadge.textContent = priceText;
        meta.appendChild(priceBadge);
        if (item.showRoom && item.room) {
            const roomBadge = document.createElement('span');
            roomBadge.style.cssText = 'color:#666;font-size:var(--fs-sm);';
            roomBadge.textContent = '· ห้อง ' + item.room;
            meta.appendChild(roomBadge);
        }
        // Sprint 3 + Sprint 4 tags inline with the meta row.
        if (item.skyHookReady) {
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#EFF6FF;color:#3B82F6;font-weight:600;font-size:var(--fs-xs);padding:2px 8px;border-radius:6px;';
            tag.textContent = '📦 Sky Hook';
            meta.appendChild(tag);
        }
        if (item.isPetCategory) {
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#FDF4FF;color:#A855F7;font-weight:600;font-size:var(--fs-xs);padding:2px 8px;border-radius:6px;';
            tag.textContent = '🐾 สัตว์เลี้ยง';
            meta.appendChild(tag);
        }
        body.appendChild(meta);

        if (item.desc) {
            const desc = document.createElement('p');
            desc.style.cssText = 'color:#444;white-space:pre-wrap;margin:0;font-size:var(--fs-base);line-height:1.6;';
            desc.textContent = item.desc;
            body.appendChild(desc);
        }

        if (item.lineDisplayName) {
            const owner = document.createElement('p');
            owner.style.cssText = 'color:#888;font-size:var(--fs-xs);margin:0;';
            owner.textContent = 'โดย: ' + item.lineDisplayName;
            body.appendChild(owner);
        }

        const actions = [];
        if (isOwn) {
            // Owner: destructive actions (matches firestore.rules:77 — only owner/admin can update/delete)
            const _detailNormStatus = _normalizeMarketStatus(item.status);
            actions.push(
                { label: '🗑️ ลบประกาศ', variant: 'danger', onClick: m => { m.close(); deleteMarketItem(item.id); } },
                { label: '✏️ แก้ไขประกาศ', variant: 'ghost', onClick: m => { m.close(); editMarketItem(item); } }
            );
            if (_detailNormStatus === 'COMPLETED') {
                actions.push({ label: '🔄 เปิดประกาศอีกครั้ง', variant: 'primary', onClick: m => { m.close(); _reopenMarketItem(item.id); } });
            } else {
                actions.push({ label: '✅ ปิดประกาศ', variant: 'ghost',  onClick: m => { m.close(); markMarketClosed(item.id); } });
            }
        } else {
            actions.push({ label: actionLabel, variant: 'primary', onClick: m => { m.close(); contactSeller(item); } });
        }
        // Modal already has a × close button in the header (shared/modal.js
        // adds it when dismissible:true, the default). A redundant "ปิด"
        // footer button caused two problems on the owner view: (1) it
        // collided semantically with "✅ ปิดประกาศ" — both read "ปิด"; (2)
        // four 96px-min footer buttons overflowed the mobile modal width.

        window.GhModal.open({
            title: item.title || 'รายละเอียดประกาศ',
            body,
            size: 'default',
            actions
        });
    }

    // ── Contact seller / chat ──────────────────────────────────────────────

    // Sprint 1 rewire — privacy-first chat replaces the personal-LINE link.
    // The line.me/ti/p/<lineUserId> path leaked the seller's personal LINE
    // identity to every interested buyer; the new in-LIFF chat keeps the
    // 1:1 conversation inside marketplace_chats and self-destructs when
    // the post is marked COMPLETED (cleanupMarketplaceChat CF).
    //
    // Fallback paths (in order):
    //   1. ownerUid present  → in-LIFF chat (canonical path post-S0)
    //   2. lineUserId only   → legacy line.me link (very old posts)
    //   3. showRoom + room   → "go knock on the door" hint
    //   4. nothing           → unhelpful but honest
    function contactSeller(item) {
        if (!item) return;
        const myUid = window._authUid;
        if (item.ownerUid && myUid && item.ownerUid !== myUid) {
            if (typeof window._openOrCreateChat === 'function') window._openOrCreateChat(item);
            return;
        }
        // Self-contact (shouldn't happen — detail-modal action is hidden
        // for own posts — but guard regardless).
        if (item.ownerUid && item.ownerUid === myUid) {
            _toast('นี่คือประกาศของคุณเอง', 'info');
            return;
        }
        // Legacy: pre-S0 posts that lack ownerUid still have lineUserId.
        // These naturally age out within ~30d (expiresAt) — leave the
        // legacy path so the post stays useful in the meantime.
        if (item.lineUserId) {
            const url = 'https://line.me/ti/p/' + item.lineUserId;
            if (typeof liff !== 'undefined' && liff.isInClient?.()) {
                liff.openWindow({ url, external: false });
            } else {
                window.open(url, '_blank');
            }
            return;
        }
        if (item.showRoom && item.room) {
            _toast('ติดต่อผู้ขายได้ที่ ห้อง ' + item.room + ' ครับ', 'info');
        } else {
            _toast('ผู้ขายไม่ได้ระบุช่องทางติดต่อครับ', 'warning');
        }
    }

    // ── CF invocations ─────────────────────────────────────────────────────

    // Sprint 1 — invoke cleanupMarketplaceChat callable (replaces the
    // previously-attempted Firestore trigger which can't fire from SE3-
    // hosted Firestore). Non-blocking on failure: chats persist until
    // admin manual cleanup, but the user-facing close/delete still goes
    // through. See lifecycle_marketplace_chat.md for the region-split
    // rationale (region_split_southeast1_3.md).
    async function _invokeCleanupMarketplaceChat(postId) {
        if (!window.firebase?.functions?.httpsCallable) return;
        try {
            const fn = window.firebase.functions.httpsCallable('cleanupMarketplaceChat');
            await fn({ postId });
        } catch (e) {
            console.warn('cleanupMarketplaceChat invoke failed:', e?.message || e);
        }
    }

    // Sprint 6 — invoke marketplaceStatsAggregator callable after a post
    // completes. Bumps per-owner counters (freeGiven / skyHookCompleted /
    // petHelped) and unlocks The Giver / Sky Walker / Pet Whisperer
    // badges. Idempotent server-side via gamification.marketplaceLedger,
    // so a double-fire is safe. Fire-and-forget — close already toast'd
    // success; badge unlock is bonus content surfaced on next profile open.
    // §7-NN: HTTPS callable (not Firestore trigger) because Firestore is
    // in SE3 and Eventarc doesn't watch SE3.
    async function _invokeMarketplaceStatsAggregator(postId) {
        if (!window.firebase?.functions?.httpsCallable) return;
        try {
            const fn = window.firebase.functions.httpsCallable('marketplaceStatsAggregator');
            const res = await fn({ postId });
            if (res?.data?.badgesAwarded > 0) {
                const labels = (res.data.newBadges || []).map(b => `${b.emoji} ${b.label}`).join(', ');
                if (labels) _toast(`ปลดล็อกตราใหม่: ${labels}`, 'success');
            }
        } catch (e) {
            console.warn('marketplaceStatsAggregator invoke failed:', e?.message || e);
        }
    }

    // ── Status mutations ───────────────────────────────────────────────────

    async function markMarketClosed(id) {
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            await fs.setDoc(fs.doc(db, 'marketplace', id), { status: 'COMPLETED' }, { merge: true });
            _toast('ปิดประกาศแล้วครับ', 'success');
            // Sprint 7: chats stay alive on close. cleanupMarketplaceChat
            // is only fired by deleteMarketItem (permanent delete). The
            // chat composer surfaces a "🔒 ปิดอยู่" lock on closed posts
            // so users can't reply until the owner re-opens. Re-open
            // (_reopenMarketItem) flips status back to AVAILABLE and the
            // composer unlocks automatically on the next openChat fetch.
            // Sprint 6 — bump stats + check badge unlocks. Server verifies
            // status=COMPLETED + ownerUid match, so calling on a post that
            // hasn't actually closed is a safe no-op.
            _invokeMarketplaceStatsAggregator(id);
        } catch(e) {
            console.warn('markMarketClosed:', e);
            _toast('เกิดข้อผิดพลาด ลองใหม่ครับ', 'error');
        }
    }

    // Re-open a previously closed post. Old chats stay deleted —
    // cleanupMarketplaceChat ran at close-time and that is irreversible by
    // design. The listing itself reappears in the public feed with a fresh
    // 30-day expiresAt window (matches addDoc default).
    async function _reopenMarketItem(id) {
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            const now = new Date();
            await fs.setDoc(fs.doc(db, 'marketplace', id), {
                status: 'AVAILABLE',
                expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
            }, { merge: true });
            _toast('เปิดประกาศอีกครั้งแล้วครับ 🎉', 'success');
        } catch(e) {
            console.warn('_reopenMarketItem:', e);
            _toast('เปิดประกาศไม่สำเร็จ ลองใหม่ครับ', 'error');
        }
    }

    // ── Form: edit / create ────────────────────────────────────────────────

    // Open the add-market form pre-populated from an existing item; submit
    // path takes the setDoc(merge:true) branch via _marketEditingId flag.
    // Image swap: existing imageUrl/imageData is surfaced as preview. If the
    // user picks a new image (sets _marketImageData), the submit path uploads
    // it to Storage at the same `marketplace/{postId}/img.<ext>` path so
    // same-ext picks overwrite cleanly (different-ext leaves the prior file
    // as orphan — acceptable MVP per lifecycle_marketplace.md L155).
    // Chat frozen-snapshot fields (postTitle/postPrice/postImageUrl) do NOT
    // auto-refresh — that's by design per lifecycle_marketplace_chat.md.
    function editMarketItem(item) {
        if (!item) return;
        _marketEditingId = item.id;
        // Pre-populate fields
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        set('market-title', item.title);
        set('market-price', (item.category === 'free' || item.category === 'request') ? '' : (item.price ?? ''));
        set('market-desc', item.desc);
        document.querySelectorAll('input[name="mcat"]').forEach(r => { r.checked = r.value === (item.category || 'item'); });
        const showRoomEl = document.getElementById('market-show-room');
        if (showRoomEl) showRoomEl.checked = item.showRoom === true;
        const skyEl = document.getElementById('market-skyhook');
        if (skyEl) skyEl.checked = item.skyHookReady === true;
        const petEl = document.getElementById('market-pet');
        if (petEl) petEl.checked = item.isPetCategory === true;
        _onMarketCatChange();
        // Swap page title + submit button labels
        const titleEl = document.getElementById('add-market-page-title');
        if (titleEl) titleEl.textContent = 'แก้ไขประกาศ ✏️';
        const submitBtn = document.getElementById('market-submit-btn');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> บันทึกการแก้ไข';
        // Surface existing image as preview so the user sees what's on the
        // post. _marketImageData stays null as a sentinel meaning "user has
        // NOT picked a new image yet" — the submit branch leaves imageUrl
        // untouched in that case. Picking a new image sets _marketImageData
        // and triggers the upload+swap path.
        _marketImageData = null;
        const prev = document.getElementById('market-image-preview');
        const ph   = document.getElementById('market-image-placeholder');
        const existingImg = item.imageUrl || item.imageData || '';
        if (existingImg && prev) {
            prev.src = existingImg;
            prev.style.display = 'block';
            if (ph) ph.style.display = 'none';
        } else {
            if (prev) { prev.style.display = 'none'; prev.src = ''; }
            if (ph) ph.style.display = '';
        }
        // Navigate to the form
        if (typeof window.showSubPage === 'function') window.showSubPage('add-market-page');
        else if (typeof window.showPage === 'function') window.showPage('add-market-page');
    }

    // Restore add-mode labels and clear edit state. Called by
    // goBackToMarketplace (cancel) AND saveNewMarketItem success (after
    // both create and edit paths) so the next visit starts clean.
    function _resetMarketFormToCreateMode() {
        _marketEditingId = null;
        const titleEl = document.getElementById('add-market-page-title');
        if (titleEl) titleEl.textContent = 'ลงประกาศ 📢';
        const submitBtn = document.getElementById('market-submit-btn');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> โพสต์ลงตลาดนัด';
        const ph = document.getElementById('market-image-placeholder');
        if (ph && !ph.querySelector('i')) {
            // Restore placeholder content if we cleared it on entry to edit-mode
            ph.innerHTML = '<i class="fas fa-camera ta-cam-icon"></i>'
                + '<div class="ta-md-600-dk">เพิ่มรูปภาพ</div>'
                + '<div class="ta-fs-sm-sub-mt">กดเพื่อเลือกรูปจากคลัง</div>';
        }
    }

    async function deleteMarketItem(id) {
        const _delOk = await window.GhModal.confirm({
            title: 'ลบประกาศ',
            body: 'ลบประกาศนี้ถาวรเลยไหมครับ? ไม่สามารถกู้คืนได้',
            confirmLabel: 'ลบ',
            cancelLabel: 'ยกเลิก',
            danger: true,
        });
        if (!_delOk) return;
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
        try {
            // Clean chats FIRST while post still exists — auth requires
            // post.ownerUid to match caller. After delete, only admin
            // could clean orphan chats (deliberate guard).
            await _invokeCleanupMarketplaceChat(id);
            const db = window.firebase.firestore();
            const fs = window.firebase.firestoreFunctions;
            await fs.deleteDoc(fs.doc(db, 'marketplace', id));
            _marketItems = _marketItems.filter(i => i.id !== id);
            renderMarketFeed();
            _toast('ลบประกาศแล้วครับ', 'success');
        } catch(e) {
            console.warn('deleteMarketItem:', e);
            _toast('ลบไม่สำเร็จ ลองใหม่ครับ', 'error');
        }
    }

    // ── Image upload zone ──────────────────────────────────────────────────

    function _initMarketImageUpload() {
        const zone = document.getElementById('market-image-zone');
        const inp  = document.getElementById('market-image-input');
        const prev = document.getElementById('market-image-preview');
        const ph   = document.getElementById('market-image-placeholder');
        if (!zone || !inp) return;
        zone.addEventListener('click', () => inp.click());
        inp.addEventListener('change', async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                // Pass File directly — compressImage handles Blob via createObjectURL
                // (avoids FileReader→base64 buffer). Fix: signature is
                // (source, maxW, maxH, quality) — was passing 0.75 as maxHeight.
                _marketImageData = await window.compressImage(file, 400, 400, 0.75);
                if (prev) { prev.src = _marketImageData; prev.style.display = 'block'; }
                if (ph) ph.style.display = 'none';
            } catch(err) { console.warn('compress market image:', err); }
        });
    }

    function _onMarketCatChange() {
        const cat = document.querySelector('input[name="mcat"]:checked')?.value;
        const row = document.getElementById('market-price-row');
        // Sprint 5 — Wishlist also has no price (poster is asking, not selling).
        if (row) row.style.display = (cat === 'free' || cat === 'request') ? 'none' : '';
    }

    // ── Save / submit ──────────────────────────────────────────────────────

    async function saveNewMarketItem() {
        const title = document.getElementById('market-title')?.value.trim();
        const cat   = document.querySelector('input[name="mcat"]:checked')?.value || 'item';
        // Sprint 5 — Wishlist + Free both skip the monetary value.
        const price = (cat === 'free' || cat === 'request') ? 0 : parseFloat(document.getElementById('market-price')?.value || '0');
        const desc  = document.getElementById('market-desc')?.value.trim() || '';
        const showRoom = document.getElementById('market-show-room')?.checked ?? true;
        // Sprint 3 — Sky Hook: opt-in vertical-delivery tag (Nest 3F/4F pulley system).
        // Sprint 4 — Pet Filter: opt-in pet-related-content tag (pet-owner sub-community).
        // Both default to false — explicit opt-in matches showRoom PDPA pattern above.
        const skyHookReady  = document.getElementById('market-skyhook')?.checked === true;
        const isPetCategory = document.getElementById('market-pet')?.checked === true;

        if (!title) { _toast('กรุณาใส่ชื่อสินค้า/บริการครับ', 'warning'); document.getElementById('market-title')?.focus(); return; }
        if (cat !== 'free' && cat !== 'request' && (!price || isNaN(price) || price <= 0)) { _toast('กรุณาระบุราคาครับ', 'warning'); document.getElementById('market-price')?.focus(); return; }
        if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions || !window._authUid) { _toast('ระบบยังไม่พร้อม ลองใหม่ครับ', 'error'); return; }

        const btn = document.getElementById('market-submit-btn');
        const isEdit = !!_marketEditingId;
        if (btn) { btn.disabled = true; btn.innerHTML = isEdit ? '⏳ กำลังบันทึก...' : '⏳ กำลังโพสต์...'; }

        try {
            const db  = window.firebase.firestore();
            const fs  = window.firebase.firestoreFunctions;
            const now = new Date();
            if (isEdit) {
                // Edit mode: setDoc(merge:true) on the existing doc. Only fields the
                // user can actually change in the form are written. ownerUid, createdAt,
                // expiresAt, status are intentionally NOT touched. Rule
                // firestore.rules:77 enforces owner/admin gate server-side.
                const patch = {
                    title, category: cat, price,
                    desc, showRoom,
                    room: showRoom ? String(_taRoom || '') : '',
                    skyHookReady, isPetCategory
                };
                // Image swap: only if user picked a new image. Upload first,
                // then merge the new imageUrl + clear legacy imageData so the
                // reader (item.imageUrl || item.imageData) picks the fresh
                // Storage URL. Failure leaves the prior image intact (graceful
                // degrade — text edits still land).
                if (_marketImageData) {
                    try {
                        const blob = _marketDataUrlToBlob(_marketImageData);
                        const url  = await _uploadMarketImage(_marketEditingId, blob);
                        patch.imageUrl = url;
                        patch.imageData = '';
                    } catch (upErr) {
                        console.warn('marketplace image swap failed (text edits still saved):', upErr?.message || upErr);
                        _toast('เปลี่ยนรูปไม่สำเร็จ แต่ข้อมูลอื่นบันทึกแล้ว', 'warning');
                    }
                }
                await fs.setDoc(fs.doc(db, 'marketplace', _marketEditingId), patch, { merge: true });
                _toast('แก้ไขประกาศแล้วครับ ✨', 'success');
            } else {
                // Step 1: addDoc with empty image fields — need postId for Storage path
                const docRef = await fs.addDoc(fs.collection(db, 'marketplace'), {
                    title, category: cat, price,
                    desc, showRoom,
                    room: showRoom ? String(_taRoom || '') : '',
                    building: _taBuilding || '',
                    tenantId: _taTenant?.tenantId || '',
                    imageData: '',
                    imageUrl: '',
                    status: 'AVAILABLE',
                    skyHookReady,    // Sprint 3 — boolean tag (no rules change; existing owner-write covers it)
                    isPetCategory,   // Sprint 4 — boolean tag (foundation for Sprint 6 Pet Whisperer badge)
                    lineUserId: window._lineUserId || '',
                    lineDisplayName: window._lineProfile?.displayName || '',
                    ownerUid: window._authUid,
                    createdAt: now.toISOString(),
                    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                });
                // Step 2: if image attached, upload to Storage then setDoc merge imageUrl.
                // Failure here leaves post with no image (acceptable — reader handles
                // missing-image fallback). Storage rule firestore.get checks ownerUid
                // on the existing doc, so order matters: addDoc MUST come first.
                if (_marketImageData) {
                    try {
                        const blob = _marketDataUrlToBlob(_marketImageData);
                        const url  = await _uploadMarketImage(docRef.id, blob);
                        await fs.setDoc(docRef, { imageUrl: url }, { merge: true });
                    } catch (upErr) {
                        console.warn('marketplace image upload failed (post saved without image):', upErr?.message || upErr);
                    }
                }
                _toast('ลงประกาศแล้วครับ! 🎉', 'success');
            }
            // reset form (shared between create + edit)
            ['market-title','market-price','market-desc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            _marketImageData = null;
            const prev = document.getElementById('market-image-preview');
            const ph   = document.getElementById('market-image-placeholder');
            if (prev) { prev.style.display = 'none'; prev.src = ''; }
            if (ph) ph.style.display = '';
            document.querySelectorAll('input[name="mcat"]').forEach(r => { r.checked = r.value === 'item'; });
            ['market-skyhook','market-pet'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
            _onMarketCatChange();
            _resetMarketFormToCreateMode();
            if (typeof window.goBackToMarketplace === 'function') window.goBackToMarketplace();
        } catch(e) {
            console.warn('saveNewMarketItem:', e);
            _toast(isEdit ? 'แก้ไขไม่สำเร็จ ลองใหม่ครับ' : 'โพสต์ไม่สำเร็จ ลองใหม่ครับ', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = isEdit
                    ? '<i class="fas fa-save"></i> บันทึกการแก้ไข'
                    : '<i class="fas fa-paper-plane"></i> โพสต์ลงตลาดนัด';
            }
        }
    }

    // ── Subscription wiring ────────────────────────────────────────────────

    // Auth-gated: depends on _taBuilding (set by loadTenantAppData after LIFF claims).
    // Wire from inside the defer module so the callback is registered BEFORE
    // authReady fires (authReady comes from the Firebase module script which
    // runs after regular defer scripts). The §7-U guard inside keeps early calls idempotent.
    if (typeof _onLiffClaimsReady === 'function') {
        _onLiffClaimsReady(_subscribeMarketplace);
    }

    // ── Public API ─────────────────────────────────────────────────────────

    window._subscribeMarketplace        = _subscribeMarketplace;
    window.renderMarketFeed             = renderMarketFeed;
    window.renderMyListings             = renderMyListings;
    window.filterMarket                 = filterMarket;
    window.openMarketDetail             = openMarketDetail;
    window.contactSeller                = contactSeller;
    window.markMarketClosed             = markMarketClosed;
    window.editMarketItem               = editMarketItem;
    window._resetMarketFormToCreateMode = _resetMarketFormToCreateMode;
    window.deleteMarketItem             = deleteMarketItem;
    window._initMarketImageUpload       = _initMarketImageUpload;
    window._onMarketCatChange           = _onMarketCatChange;
    window.saveNewMarketItem            = saveNewMarketItem;
    window._hasNewMarketItem            = _hasNewMarketItem;
    window._setMarketSeenAt             = _setMarketSeenAt;
    window._getMarketSeenAt             = _getMarketSeenAt;
})();
