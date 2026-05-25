/**
 * MarketplaceChat — privacy-first 1:1 chat for marketplace listings (Sprint 1+2+3).
 *
 * Replaces the legacy `line.me/ti/p/<lineUserId>` personal-LINE leak. The
 * entire conversation lives in `marketplace_chats/{chatId}` + messages
 * sub-collection and is self-destructed by the `cleanupMarketplaceChat`
 * callable when the parent post transitions to `status=COMPLETED`.
 *
 * Two surfaces in tenant_app.html:
 *   #market-chat-list-page : list of all my conversations (subscribeList)
 *   #market-chat-page      : the active 1:1 conversation (subscribeMessages)
 *
 * Action-hub contract (tenant_app.html dispatches data-action attributes):
 *   data-action="sendChatMessage"             -> window.sendChatMessage
 *   data-action="cancelChatReply"             -> window._cancelChatReply
 *   data-action="chatActReply"                -> window._chatActReply
 *   data-action="chatActUnsend"               -> window._chatActUnsend
 *   data-action="closeChatActionSheetIfOverlay" -> window._closeChatActionSheet
 * The legacy underscore-prefixed names are intentional — every consumer
 * outside this module (HTML attributes, action-hub at tenant_app.html:8412+,
 * tenant_app.html caller of `openChat`/`_openOrCreateChat`) expects them.
 *
 * Anti-patterns deliberately enforced here (see CLAUDE.md §7):
 *   §7-A  : subscribe is wired through `_onLiffClaimsReady` (in tenant_app.html)
 *   §7-CC : cross-script state stays on `window.X`, NOT module-private `let`
 *   §7-N  : every onSnapshot has an error callback that resets its unsub
 *           on permission-denied / failed-precondition so liffLinked retry
 *           can resubscribe
 *   §7-U  : claim-first guard `if (!window._authUid) return;` inside subscribe
 *   §7-V  : prior unsub torn down before rebinding (subscribeMessages)
 *   §7-GG : deep-link query param sticky-persisted to localStorage
 *   §7-KK : cached snapshot does not trigger markRead reconciliation
 *   §7-NN : LINE notify is HTTPS callable (not Firestore trigger) — SE3 limit
 *   §7-OO candidate : nested-map writes use object-literal form, NOT dot-
 *           notation keys. `setDoc(..., {merge:true})` does NOT interpret
 *           dot-keys as nested paths (that's updateDoc-only); the literal
 *           "lastReadAt.UID" top-level field would never be read.
 *
 * Depends on canonical Firebase globals (set in tenant_app.html bootstrap):
 *   window.firebase.firestore()        — Firestore instance (function call)
 *   window.firebase.firestoreFunctions — { collection, doc, query, where,
 *                                          orderBy, onSnapshot, getDocs,
 *                                          setDoc, addDoc, increment }
 *   window.firebase.functions          — { httpsCallable(name) } static
 *   window._authUid                     — set by _callLiffSignIn
 *   window.toast(msg, kind)             — toast helper (optional)
 *   window.ghConfirm(msg, opts)         — styled confirm (optional, falls
 *                                          back to native confirm)
 *
 * UMD-style: attaches window.MarketplaceChat + back-compat globals.
 */
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────
  const COL = 'marketplace_chats';
  const COL_MARKETPLACE = 'marketplace';   // Sprint 7 — parent-post live subscribe target
  const LS_PENDING_CHAT_KEY = 'gh_pending_chat_id';
  const UNSEND_WINDOW_MS = 24 * 60 * 60 * 1000;
  const SWIPE_THRESHOLD = 50;
  const SWIPE_OPEN_PX = -80;
  const LONGPRESS_DELAY_MS = 400;
  const LONGPRESS_MOVE_THRESHOLD = 10;
  const MAX_MESSAGE_LEN = 2000;
  const REPLY_SNIPPET_MAX = 80;

  // ── Firebase SDK accessors ─────────────────────────────────────────────
  function _db() { return window.firebase?.firestore?.(); }
  function _fs() { return window.firebase?.firestoreFunctions; }
  function _hc(name) {
    const hc = window.firebase?.functions?.httpsCallable;
    if (typeof hc !== 'function') return null;
    return hc(name);
  }

  // ── UI helpers ─────────────────────────────────────────────────────────
  function _toast(msg, kind) {
    if (typeof window.toast === 'function') window.toast(msg, kind);
  }
  function _confirm(msg, opts) {
    const fn = window.ghConfirm || ((m) => Promise.resolve(window.confirm(m)));
    return fn(msg, opts);
  }
  // Local _esc — tenant_app.html's _esc is a local function (not on window),
  // so we re-implement here. Same XSS escape set: <, >, &, ", '.
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function _formatChatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  // ── Cross-script state (§7-CC) — kept on window for visibility ─────────
  // (Module helpers below read/write via window.X so any other inline script
  // reading the same names sees the live value.)
  window._chatList = window._chatList || [];
  window._chatListUnsub = window._chatListUnsub || null;
  window._activeChatId = window._activeChatId || null;
  window._activeChat = window._activeChat || null;
  window._chatMessages = window._chatMessages || [];
  window._chatMessagesUnsub = window._chatMessagesUnsub || null;
  window._activeChatReplyTarget = window._activeChatReplyTarget || null;
  window._actionSheetMsgId = window._actionSheetMsgId || null;
  // Sprint 7 bugfix — live parent-post listener (replaces one-shot getDoc).
  window._chatParentPostUnsub = window._chatParentPostUnsub || null;
  // Sprint 7 follow-up — per-chat last-seen unreadCount for in-app toast
  // diffing. null on first snapshot so historical unread doesn't toast.
  window._chatListSeen = window._chatListSeen || null;

  // ── Deep-link (§7-GG) ──────────────────────────────────────────────────
  // notifyMarketplaceChat CF builds links of the form
  // `https://liff.line.me/<LIFF_ID>?chat=<chatId>`. LIFF can strip the query
  // string on redirect, so we sticky-persist to localStorage on first detect
  // and read it back from BOTH the URL AND storage thereafter. Use ?chat=0
  // to explicitly clear a stuck marker.
  function captureDeepLink() {
    try {
      const params = new URLSearchParams(location.search || '');
      const fromUrl = params.get('chat') || '';
      if (fromUrl === '0') {
        localStorage.removeItem(LS_PENDING_CHAT_KEY);
        return null;
      }
      if (fromUrl) {
        localStorage.setItem(LS_PENDING_CHAT_KEY, fromUrl);
        return fromUrl;
      }
      return localStorage.getItem(LS_PENDING_CHAT_KEY) || null;
    } catch (_) { return null; }
  }

  function tryOpenPending() {
    const pending = captureDeepLink();
    if (!pending) return;
    if (window._activeChatId === pending) {
      try { localStorage.removeItem(LS_PENDING_CHAT_KEY); } catch (_) {}
      return;
    }
    const chat = (window._chatList || []).find(c => c.id === pending);
    if (!chat) return; // not yet in list — try again next snapshot
    try { localStorage.removeItem(LS_PENDING_CHAT_KEY); } catch (_) {}
    openChat(chat);
  }

  // ── List subscription ──────────────────────────────────────────────────
  function subscribeList() {
    if (window._chatListUnsub) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    if (!window._authUid) return; // §7-U claim-first guard
    try {
      const db = _db();
      const fs = _fs();
      const q = fs.query(
        fs.collection(db, COL),
        fs.where('participants', 'array-contains', window._authUid),
        fs.orderBy('lastMessageTime', 'desc')
      );
      window._chatListUnsub = fs.onSnapshot(q, snap => {
        const myUid = window._authUid;
        const nextChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Sprint 7 follow-up: detect chats whose unreadCount[myUid] went
        // UP since the previous snapshot — that's a "new message from
        // counterparty" event. If the user isn't currently viewing THAT
        // specific chat, show an in-app toast so they notice without
        // needing a LINE OA push. Skip the very first snapshot to avoid
        // toasting historical unread messages on app open. Skip cached
        // snapshots too (§7-KK) — only count server-confirmed deltas.
        const firstSnap = !window._chatListSeen;
        const fromCache = !!snap.metadata?.fromCache;
        const chatPageActive = !!document.getElementById('market-chat-page')?.classList.contains('active');
        if (!firstSnap && !fromCache && typeof window.toast === 'function') {
          for (const chat of nextChats) {
            const nowUnread = (chat.unreadCount && chat.unreadCount[myUid]) || 0;
            const prevUnread = window._chatListSeen.get(chat.id) || 0;
            if (nowUnread > prevUnread) {
              const isCurrentChat = chatPageActive && window._activeChatId === chat.id;
              if (!isCurrentChat) {
                const title = chat.postTitle || 'ข้อความใหม่';
                const preview = (chat.lastMessage || '').slice(0, 40);
                window.toast(`📩 ${title}${preview ? ': ' + preview : ''}`, 'info', 5000);
              }
            }
          }
        }
        // Refresh per-chat unread cache for next-snapshot diffing. Always
        // run (even on first snap / cached) so the baseline is correct.
        if (!window._chatListSeen) window._chatListSeen = new Map();
        for (const chat of nextChats) {
          window._chatListSeen.set(chat.id, (chat.unreadCount && chat.unreadCount[myUid]) || 0);
        }

        window._chatList = nextChats;
        renderList();
        renderUnreadBadge();
        // S3 PR 2: refresh the frozen _activeChat snapshot so the
        // counterparty's lastReadAt updates show up live while the
        // user is viewing the conversation. Re-render messages so
        // the "อ่านแล้ว HH:mm" tag moves to the latest read bubble.
        if (window._activeChatId) {
          const fresh = window._chatList.find(c => c.id === window._activeChatId);
          if (fresh) {
            window._activeChat = fresh;
            renderMessages();
          }
        }
        // After each fresh chat-list snapshot, see if a deep-link
        // is waiting on this chat being visible to the user.
        tryOpenPending();
      }, err => {
        console.warn('[market-chat-list] subscribe failed:', err?.message || err);
        if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
          window._chatListUnsub = null;
        }
      });
    } catch (e) { console.warn('subscribeChatList:', e); }
  }

  function renderList() {
    const cont = document.getElementById('market-chat-list-container');
    if (!cont) return;
    const empty = document.getElementById('market-chat-list-empty');
    // Remove any existing chat rows (preserve empty state element).
    cont.querySelectorAll('.market-chat-row-wrap').forEach(n => n.remove());
    const myUid = window._authUid;
    // S3 PR 3: filter out chats the user has soft-deleted via swipe.
    // notifyMarketplaceChat CF clears hiddenBy[recipient] on incoming
    // messages, so the row reappears automatically on new activity.
    const visible = (window._chatList || []).filter(c => !(c.hiddenBy && c.hiddenBy[myUid]));
    if (!visible.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    const cards = visible.map(chat => {
      const unread = (chat.unreadCount && chat.unreadCount[myUid]) || 0;
      const lastMsg = chat.lastMessage || 'เริ่มการสนทนา';
      const lastTime = chat.lastMessageTime ? _formatChatTime(chat.lastMessageTime) : '';
      const imgSrc = chat.postImageUrl || '';
      const imgHtml = imgSrc
        ? `<img src="${_esc(imgSrc)}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
        : `<span style="font-size:1.4rem; display:flex; align-items:center; justify-content:center; height:100%;">🛒</span>`;
      const unreadBadge = unread > 0
        ? `<span style="background:#dc2626; color:#fff; font-size:var(--fs-xs); padding:1px 8px; border-radius:10px; font-weight:700; flex-shrink:0;">${unread > 9 ? '9+' : unread}</span>`
        : '';
      const safeId = _esc(chat.id);
      // S3 PR 3: each row is wrapped in a swipe container so the
      // red "ลบ" panel sits underneath. attachListSwipe translateX's
      // the inner row to reveal the panel on left-swipe.
      return `<div class="market-chat-row-wrap" style="position:relative; overflow:hidden; border-bottom:1px solid #f0f0f0;">
                <button type="button" data-chat-row-delete data-chat-id="${safeId}"
                    style="position:absolute; right:0; top:0; bottom:0; width:80px; background:#dc2626; color:#fff; border:none; font-weight:700; font-size:var(--fs-sm); cursor:pointer; touch-action:manipulation;">ลบ</button>
                <div class="market-chat-row" data-mkt-chat-id="${safeId}" style="position:relative; background:#fff; display:flex; gap:12px; padding:14px 16px; cursor:pointer; touch-action:pan-y; align-items:center; will-change:transform;">
                    <div style="width:48px; height:48px; border-radius:10px; background:#f3f4f6; flex-shrink:0; overflow:hidden;">${imgHtml}</div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:2px;">
                            <span style="font-weight:700; font-size:var(--fs-sm); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:#222;">${_esc(chat.postTitle || 'สินค้า')}</span>
                            <span style="font-size:var(--fs-xs); color:#888; flex-shrink:0;">${_esc(lastTime)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                            <span style="font-size:var(--fs-xs); color:#666; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${_esc(lastMsg)}</span>
                            ${unreadBadge}
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
    cont.insertAdjacentHTML('beforeend', cards);

    // Single delegated listener — survives subsequent renderList calls.
    if (!cont._chatDelegated) {
      cont.addEventListener('click', e => {
        if (e.target.closest('[data-chat-row-delete]')) return; // swipe handler owns this
        const row = e.target.closest('[data-mkt-chat-id]');
        if (!row) return;
        // Don't open the chat if the row is in "swipe-open" state — let
        // the first tap close the swipe instead.
        if (row.dataset.swipeOpen === '1') {
          row.style.transition = 'transform 180ms ease-out';
          row.style.transform = '';
          row.dataset.swipeOpen = '';
          return;
        }
        const id = row.dataset.mktChatId;
        const chat = window._chatList.find(c => c.id === id);
        if (chat) openChat(chat);
      });
      cont._chatDelegated = true;
    }
    // S3 PR 3: wire swipe-to-delete (idempotent — internal guard).
    attachListSwipe();
  }

  function renderUnreadBadge() {
    const myUid = window._authUid;
    const total = (window._chatList || []).reduce(
      (sum, c) => sum + ((c.unreadCount && c.unreadCount[myUid]) || 0), 0
    );
    const badge = document.getElementById('market-chat-unread-badge');
    if (badge) {
      if (total > 0) {
        badge.textContent = total > 9 ? '9+' : String(total);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // ── Open chat ──────────────────────────────────────────────────────────
  function openChat(chat) {
    if (!chat || !chat.id) return;
    window._activeChatId = chat.id;
    window._activeChat = chat;

    // Render header from frozen snapshot — survives the post being closed/deleted.
    const titleEl = document.getElementById('market-chat-header-title');
    const subEl = document.getElementById('market-chat-header-sub');
    const imgEl = document.getElementById('market-chat-header-img');
    if (titleEl) titleEl.textContent = chat.postTitle || 'สินค้า';
    if (subEl) {
      const price = Number(chat.postPrice);
      subEl.textContent = price === 0 ? '🎁 ฟรี' : (price > 0 ? '฿' + price : '');
    }
    if (imgEl) {
      imgEl.textContent = '';
      if (chat.postImageUrl) {
        const img = document.createElement('img');
        img.src = chat.postImageUrl;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        imgEl.appendChild(img);
      } else {
        imgEl.textContent = '🛒';
        imgEl.style.fontSize = '1.4rem';
      }
    }

    // Render an initial loading state then subscribe.
    const msgs = document.getElementById('market-chat-messages');
    if (msgs) {
      msgs.innerHTML = '<div style="text-align:center; color:#aaa; padding:40px 20px; font-size:var(--fs-sm);">กำลังโหลด...</div>';
    }
    const comp = document.getElementById('market-chat-composer');
    if (comp) comp.style.display = 'flex';
    const inp = document.getElementById('market-chat-input');
    if (inp) inp.value = '';

    // showSubPage lives in tenant_app.html.
    if (typeof window.showSubPage === 'function') window.showSubPage('market-chat-page');
    subscribeMessages(chat.id);
    markRead(chat.id);
    // S3 PR 3: clear any leftover reply context from prior chat, and
    // wire the long-press handler (idempotent — internal guard).
    cancelReply();
    attachLongPress();
    // Sprint 7: fetch parent-post status to gate the composer. close=pause,
    // delete=permanent — when the post is COMPLETED/closed/missing the user
    // cannot send a new message until the owner re-opens (or the chat is a
    // tombstone if the post was deleted entirely). Default optimistic
    // (unlocked) until the first snapshot lands so the common AVAILABLE
    // case has no perceived latency. Sprint 7 bugfix (post-PR #73): use
    // onSnapshot instead of one-shot getDoc so the composer locks/unlocks
    // LIVE when the seller toggles status from another device or tab —
    // previously the lock state was frozen at openChat-time.
    window._activeChatParentStatus = null;
    _renderComposerLockState();
    _subscribeParentPostStatus(chat.postId);
  }

  // Sprint 7 — parent-post live subscription. Replaces the prior one-shot
  // _fetchParentPostStatus so that ปิดประกาศ → composer locks in real time on
  // the counterparty's screen (and เปิดประกาศ → unlocks just as fast).
  //
  // §7-V: tear down the previous listener before rebinding (so opening a
  // different chat doesn't leak the old post's subscription).
  // §7-N: error callback nulls the unsub on permission-denied /
  // failed-precondition so a transient auth blip self-heals on next open.
  function _subscribeParentPostStatus(postId) {
    if (typeof window._chatParentPostUnsub === 'function') {
      try { window._chatParentPostUnsub(); } catch (_) { /* noop */ }
      window._chatParentPostUnsub = null;
    }
    if (!postId) {
      window._activeChatParentStatus = 'DELETED';
      _renderComposerLockState();
      return;
    }
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    try {
      const db = _db();
      const fs = _fs();
      window._chatParentPostUnsub = fs.onSnapshot(
        fs.doc(db, COL_MARKETPLACE, postId),
        (snap) => {
          // Race-safe: drop if user has navigated to a different chat
          // before this snapshot arrived.
          if (!window._activeChatId || window._activeChat?.postId !== postId) return;
          const post = snap.exists() ? snap.data() : null;
          window._activeChatParentStatus = post ? (post.status || 'AVAILABLE') : 'DELETED';
          _renderComposerLockState();
        },
        (err) => {
          console.warn('[market-chat] parent-post subscribe failed:', err?.message || err);
          if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
            window._chatParentPostUnsub = null;
          }
        }
      );
    } catch (e) {
      console.warn('[market-chat] parent-post subscribe init failed:', e?.message || e);
    }
  }

  // Back-compat: the legacy one-shot helper kept exposed in case any
  // external caller relied on the immediate-promise shape. Internally we
  // now route through the live subscriber, but external callers (verify
  // scripts, future plugins) that just want "tell me the current status"
  // can keep using this name.
  async function _fetchParentPostStatus(postId) {
    _subscribeParentPostStatus(postId);
  }

  // Lock the composer when the parent post is COMPLETED / closed / deleted.
  // Surfaces an inline notice so the user understands WHY they can't reply.
  // Idempotent — safe to call repeatedly (e.g. on every status refresh).
  function _renderComposerLockState() {
    const composer = document.getElementById('market-chat-composer');
    const input = document.getElementById('market-chat-input');
    if (!composer) return;
    const status = window._activeChatParentStatus;
    // Treat both legacy 'closed' and new 'COMPLETED' as locked. 'DELETED'
    // means the parent post is gone (cleanupMarketplaceChat should have
    // wiped this chat too, but the user might still be looking at a stale
    // tab) — show a tombstone notice.
    const isLocked = status === 'COMPLETED' || status === 'closed' || status === 'DELETED';
    let notice = document.getElementById('market-chat-closed-notice');
    if (isLocked) {
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'market-chat-closed-notice';
        notice.style.cssText = 'padding:8px 12px; background:#fef3c7; color:#92400e; font-size:12px; text-align:center; border-bottom:1px solid #fde68a; line-height:1.4;';
        composer.insertBefore(notice, composer.firstChild);
      }
      notice.textContent = status === 'DELETED'
        ? '🗑️ ประกาศนี้ถูกลบแล้ว — ตอบกลับไม่ได้'
        : '🔒 ประกาศนี้ปิดอยู่ — รอเจ้าของเปิดอีกครั้งเพื่อตอบกลับ';
      if (input) { input.disabled = true; input.placeholder = 'ตอบกลับไม่ได้ขณะนี้'; }
      const sendBtn = composer.querySelector('[data-action="sendChatMessage"]');
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (notice) notice.remove();
      if (input) { input.disabled = false; input.placeholder = 'พิมพ์ข้อความ...'; }
      const sendBtn = composer.querySelector('[data-action="sendChatMessage"]');
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ── Messages subscription ──────────────────────────────────────────────
  function subscribeMessages(chatId) {
    // §7-V: tear down prior listener before re-attaching.
    if (typeof window._chatMessagesUnsub === 'function') {
      try { window._chatMessagesUnsub(); } catch (_) { /* noop */ }
      window._chatMessagesUnsub = null;
    }
    window._chatMessages = [];
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions || !chatId) return;
    try {
      const db = _db();
      const fs = _fs();
      const q = fs.query(
        fs.collection(db, COL, chatId, 'messages'),
        fs.orderBy('timestamp', 'asc')
      );
      window._chatMessagesUnsub = fs.onSnapshot(q, snap => {
        window._chatMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMessages();
        // §7-KK: only mark-read on server-confirmed snapshots — cached
        // initial replay would reset the badge before real server data.
        //
        // Sprint 7 follow-up: ALSO gate on chat-detail page actually being
        // visible. Without this, navigating from chat A back to chat-list
        // leaves subscribeMessages alive — a counterparty message would
        // trigger this callback while user is on chat-list, and markRead
        // would zero the unread badge before the user has actually opened
        // (and seen) the new message.
        const chatPageActive = !!document.getElementById('market-chat-page')?.classList.contains('active');
        if (chatPageActive
          && window._activeChatId === chatId
          && !snap.metadata?.fromCache
          && !snap.metadata?.hasPendingWrites) {
          markRead(chatId);
        }
      }, err => {
        console.warn('[market-chat-messages] subscribe failed:', err?.message || err);
        if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
          window._chatMessagesUnsub = null;
        }
      });
    } catch (e) { console.warn('subscribeChatMessages:', e); }
  }

  function renderMessages() {
    const cont = document.getElementById('market-chat-messages');
    if (!cont) return;
    const myUid = window._authUid;
    if (!window._chatMessages.length) {
      cont.innerHTML = '<div style="text-align:center; color:#aaa; padding:40px 20px; font-size:var(--fs-sm);">เริ่มการสนทนาด้านล่าง...</div>';
      return;
    }
    // S3 PR 2: status tag under the LAST own-message — shows "ส่งแล้ว"
    // immediately after send (so the sender knows the message landed),
    // then transitions to "✓ อ่านแล้ว HH:mm" once the counterparty
    // opens the chat (their markRead writes lastReadAt[uid]).
    const counterpart = (window._activeChat?.participants || [])
      .find(p => p !== myUid);
    const counterpartReadAt = counterpart
      ? (window._activeChat?.lastReadAt?.[counterpart] || null)
      : null;
    let lastOwnIdx = -1;
    for (let i = window._chatMessages.length - 1; i >= 0; i--) {
      if (window._chatMessages[i].senderId === myUid) { lastOwnIdx = i; break; }
    }
    cont.innerHTML = window._chatMessages.map((m, idx) => {
      const mine = m.senderId === myUid;
      const time = m.timestamp ? _formatChatTime(m.timestamp) : '';
      // S3 PR 3: unsent message renders a dim italic tombstone in
      // place of the original text; the bubble stays so layout
      // doesn't jump.
      const unsent = !!m.unsent;
      const txtRaw = unsent ? 'ข้อความถูกยกเลิก' : (m.text || '');
      const txt = _esc(txtRaw);
      const bubbleStyle = unsent
        ? `background:${mine ? 'var(--primary-green)' : '#f3f4f6'}; color:${mine ? '#fff' : '#666'}; opacity:0.55; font-style:italic; ${mine ? 'border-bottom-right-radius:4px;' : 'border-bottom-left-radius:4px;'}`
        : (mine
          ? 'background:var(--primary-green); color:#fff; border-bottom-right-radius:4px;'
          : 'background:#f3f4f6; color:#222; border-bottom-left-radius:4px;');
      let statusTag = '';
      if (idx === lastOwnIdx && !unsent) {
        const wasRead = counterpartReadAt && m.timestamp && m.timestamp <= counterpartReadAt;
        statusTag = wasRead
          ? `<div style="font-size:10px; color:var(--primary-green); margin-top:2px; text-align:right; padding:0 4px; font-weight:600;">✓ อ่านแล้ว ${_esc(_formatChatTime(counterpartReadAt))}</div>`
          : `<div style="font-size:10px; color:#9aa1a9; margin-top:2px; text-align:right; padding:0 4px;">ส่งแล้ว</div>`;
      }
      // S3 PR 3: reply-quote card above the message text when m.replyTo set
      let replyCard = '';
      if (!unsent && m.replyTo && m.replyTo.textSnippet) {
        const repliedToMine = m.replyTo.senderId === myUid;
        const senderLabel = repliedToMine ? 'คุณ' : 'อีกฝ่าย';
        replyCard = `<div style="background:rgba(255,255,255,0.18); border-left:3px solid ${mine ? 'rgba(255,255,255,0.6)' : 'var(--primary-green)'}; padding:4px 8px; border-radius:6px; margin-bottom:6px; font-size:11px; ${mine ? 'color:rgba(255,255,255,0.85)' : 'color:#555'}; overflow:hidden;">
                <div style="font-weight:700; opacity:0.85;">↩ ${_esc(senderLabel)}</div>
                <div style="overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${_esc(m.replyTo.textSnippet)}</div>
            </div>`;
      }
      // data-msg-id powers the long-press handler (action sheet).
      // Skip data-msg-id on already-unsent messages so they can't be
      // long-pressed for further actions (Unsend disabled anyway).
      const tapAttr = unsent ? '' : ` data-msg-id="${_esc(m.id)}"`;
      return `<div style="display:flex; ${mine ? 'justify-content:flex-end' : 'justify-content:flex-start'};">
                <div style="max-width:78%;">
                    <div${tapAttr} style="padding:8px 12px; border-radius:14px; ${bubbleStyle} font-size:var(--fs-sm); word-break:break-word; white-space:pre-wrap; cursor:${unsent ? 'default' : 'pointer'};">${replyCard}${txt}</div>
                    <div style="font-size:10px; color:#999; margin-top:2px; text-align:${mine ? 'right' : 'left'}; padding:0 4px;">${_esc(time)}</div>
                    ${statusTag}
                </div>
            </div>`;
    }).join('');
    requestAnimationFrame(() => { cont.scrollTop = cont.scrollHeight; });
  }

  // ── Send message ───────────────────────────────────────────────────────
  async function sendMessage() {
    const inp = document.getElementById('market-chat-input');
    if (!inp) return;
    const text = (inp.value || '').trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LEN) {
      _toast('ข้อความยาวเกินไป (≤ 2000 ตัวอักษร)', 'warning');
      return;
    }
    if (!window._activeChatId || !window._authUid) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    // Sprint 7 defense-in-depth: if openChat's parent-status fetch already
    // reported the post as closed/deleted, refuse to send. The composer UI
    // is already locked but a stale tab or scripted call could bypass that.
    const ps = window._activeChatParentStatus;
    if (ps === 'COMPLETED' || ps === 'closed' || ps === 'DELETED') {
      _toast(ps === 'DELETED' ? 'ประกาศถูกลบแล้ว' : 'ประกาศนี้ปิดอยู่', 'warning');
      return;
    }
    const chatId = window._activeChatId;
    // S3 PR 3: capture + clear reply target BEFORE the await so a
    // rapid second send doesn't re-attach the same quote.
    const replyTo = window._activeChatReplyTarget || null;
    // Optimistic clear so user can keep typing while the round-trip resolves.
    inp.value = '';
    cancelReply();
    try {
      const db = _db();
      const fs = _fs();
      const now = new Date().toISOString();
      const counterpart = (window._activeChat?.participants || [])
        .find(p => p !== window._authUid);
      const msgPayload = { senderId: window._authUid, text, timestamp: now, isRead: false };
      if (replyTo) msgPayload.replyTo = replyTo;
      const msgRef = await fs.addDoc(
        fs.collection(db, COL, chatId, 'messages'),
        msgPayload
      );
      // §7-OO candidate: nested object literal (NOT dot-notation key) so
      // setDoc(merge:true) properly merges into the unreadCount map
      // instead of creating a literal top-level "unreadCount.UID" field.
      const patch = { lastMessage: text, lastMessageTime: now };
      if (counterpart) {
        patch.unreadCount = { [counterpart]: fs.increment(1) };
      }
      await fs.setDoc(fs.doc(db, COL, chatId), patch, { merge: true });
      // §7-NN: LINE notify via HTTPS callable (Firestore triggers can't
      // watch SE3-hosted Firestore). Fire-and-forget — the message is
      // already saved; notification is a best-effort follow-up. Server
      // enforces 30s throttle, so rapid typing is safe to call repeatedly.
      if (msgRef?.id) {
        try {
          const notify = _hc('notifyMarketplaceChat');
          if (notify) {
            notify({ chatId, messageId: msgRef.id }).catch(err => {
              console.warn('notifyMarketplaceChat invoke failed:', err?.message || err);
            });
          }
        } catch (e) {
          console.warn('notifyMarketplaceChat sync error:', e);
        }
      }
    } catch (e) {
      console.warn('sendChatMessage:', e);
      _toast('ส่งไม่สำเร็จ ลองใหม่ครับ', 'error');
      // Restore so the user doesn't lose their text + reply context.
      inp.value = text;
      if (replyTo) setReplyTarget(replyTo);
    }
  }

  async function markRead(chatId) {
    if (!chatId || !window._authUid) return;
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    try {
      const db = _db();
      const fs = _fs();
      // §7-OO candidate: setDoc(merge:true) does NOT interpret dot-notation
      // keys as nested field paths — that's updateDoc-only. Use a nested
      // object literal so the maps merge correctly. Writing
      // `{[`lastReadAt.${uid}`]: now}` was creating a LITERAL top-level
      // field "lastReadAt.UID" that no reader ever queried.
      await fs.setDoc(
        fs.doc(db, COL, chatId),
        {
          unreadCount: { [window._authUid]: 0 },
          lastReadAt: { [window._authUid]: new Date().toISOString() }
        },
        { merge: true }
      );
    } catch (e) {
      // Non-fatal — next focus / snapshot retries.
      console.warn('markChatRead:', e?.message || e);
    }
  }

  // ── Reply (S3 PR 3 — LINE-parity reply) ────────────────────────────────
  function setReplyTarget(target) {
    // target shape: { messageId, senderId, textSnippet } (≤80 chars snippet)
    window._activeChatReplyTarget = target;
    const preview = document.getElementById('market-chat-reply-preview');
    const nameEl = document.getElementById('market-chat-reply-name');
    const snipEl = document.getElementById('market-chat-reply-snippet');
    if (!preview || !nameEl || !snipEl) return;
    const repliedToMine = target.senderId === window._authUid;
    nameEl.textContent = repliedToMine ? 'คุณ' : 'อีกฝ่าย';
    snipEl.textContent = target.textSnippet || '';
    preview.style.display = 'flex';
    document.getElementById('market-chat-input')?.focus();
  }

  function cancelReply() {
    window._activeChatReplyTarget = null;
    const preview = document.getElementById('market-chat-reply-preview');
    if (preview) preview.style.display = 'none';
  }

  // ── Long-press action sheet (S3 PR 3) ──────────────────────────────────
  function openActionSheet(msgId) {
    const sheet = document.getElementById('market-chat-action-sheet');
    if (!sheet || !msgId) return;
    const msg = (window._chatMessages || []).find(m => m.id === msgId);
    if (!msg) return;
    window._actionSheetMsgId = msgId;
    // Unsend only on own bubble + within 24h.
    const myUid = window._authUid;
    const mine = msg.senderId === myUid;
    const ageMs = msg.timestamp ? (Date.now() - Date.parse(msg.timestamp)) : Infinity;
    const canUnsend = mine && Number.isFinite(ageMs) && ageMs <= UNSEND_WINDOW_MS;
    const unsendBtn = document.getElementById('market-chat-act-unsend');
    if (unsendBtn) unsendBtn.style.display = canUnsend ? 'flex' : 'none';
    sheet.style.display = 'flex';
    // Light haptic for known patterns; harmless if unsupported.
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
  }

  function closeActionSheet() {
    const sheet = document.getElementById('market-chat-action-sheet');
    if (sheet) sheet.style.display = 'none';
    window._actionSheetMsgId = null;
  }

  function actReply() {
    const msgId = window._actionSheetMsgId;
    closeActionSheet();
    if (!msgId) return;
    const msg = (window._chatMessages || []).find(m => m.id === msgId);
    if (!msg) return;
    const text = String(msg.text || '');
    const snippet = text.length > REPLY_SNIPPET_MAX
      ? text.slice(0, REPLY_SNIPPET_MAX - 1) + '…'
      : text;
    setReplyTarget({
      messageId: msg.id,
      senderId: msg.senderId,
      textSnippet: snippet,
    });
  }

  async function actUnsend() {
    const msgId = window._actionSheetMsgId;
    closeActionSheet();
    if (!msgId || !window._activeChatId) return;
    const fn = _hc('unsendMarketplaceMessage');
    if (!fn) {
      _toast('ระบบยังไม่พร้อม', 'error');
      return;
    }
    const ok = await _confirm('ยกเลิกข้อความนี้? อีกฝ่ายจะเห็นเป็น "ข้อความถูกยกเลิก"', {
      title: 'ยืนยันการยกเลิก', confirmLabel: 'ยกเลิกข้อความ', danger: true,
    });
    if (!ok) return;
    try {
      await fn({ chatId: window._activeChatId, messageId: msgId });
      // onSnapshot will refresh the bubble to the tombstone state.
    } catch (e) {
      console.warn('unsendMarketplaceMessage:', e);
      const msg = e?.code === 'functions/failed-precondition'
        ? 'ยกเลิกไม่ได้ — เกิน 24 ชั่วโมง'
        : (e?.message || 'ยกเลิกไม่สำเร็จ');
      _toast(msg, 'error');
    }
  }

  // Long-press detection on the chat messages container. Single delegated
  // handler survives every renderMessages rerun.
  function attachLongPress() {
    const cont = document.getElementById('market-chat-messages');
    if (!cont || cont._lpAttached) return;
    cont._lpAttached = true;
    let pressTimer = null;
    let pressX = 0, pressY = 0;
    const reset = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    cont.addEventListener('pointerdown', (e) => {
      const bubble = e.target.closest('[data-msg-id]');
      if (!bubble) return;
      pressX = e.clientX; pressY = e.clientY;
      const msgId = bubble.dataset.msgId;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        openActionSheet(msgId);
      }, LONGPRESS_DELAY_MS);
    }, { passive: true });
    cont.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - pressX) > LONGPRESS_MOVE_THRESHOLD ||
          Math.abs(e.clientY - pressY) > LONGPRESS_MOVE_THRESHOLD) reset();
    }, { passive: true });
    cont.addEventListener('pointerup', reset, { passive: true });
    cont.addEventListener('pointercancel', reset, { passive: true });
    cont.addEventListener('pointerleave', reset, { passive: true });
  }

  // Swipe-left on chat-list rows — reveals an 80px red "ลบ" panel.
  // Tap on panel → confirm → hideMarketplaceChat CF.
  function attachListSwipe() {
    const cont = document.getElementById('market-chat-list-container');
    if (!cont || cont._swipeAttached) return;
    cont._swipeAttached = true;
    let activeRow = null;
    let startX = 0, startY = 0, dx = 0;
    let horizontal = false;

    function _setOpen(row, open) {
      row.style.transform = open ? `translateX(${SWIPE_OPEN_PX}px)` : '';
      row.dataset.swipeOpen = open ? '1' : '';
    }

    cont.addEventListener('pointerdown', (e) => {
      // Ignore presses on the delete panel itself.
      if (e.target.closest('[data-chat-row-delete]')) return;
      const row = e.target.closest('[data-mkt-chat-id]');
      if (!row) return;
      // Close any other open row first.
      cont.querySelectorAll('[data-swipe-open="1"]').forEach(r => {
        if (r !== row) _setOpen(r, false);
      });
      activeRow = row;
      startX = e.clientX; startY = e.clientY; dx = 0;
      horizontal = false;
      row.style.transition = '';
    }, { passive: true });

    cont.addEventListener('pointermove', (e) => {
      if (!activeRow) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!horizontal) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          horizontal = Math.abs(dx) > Math.abs(dy);
          if (!horizontal) { activeRow = null; return; }
        }
      }
      if (!horizontal) return;
      // Allow left swipe only (negative dx); cap at SWIPE_OPEN_PX.
      const tx = Math.max(SWIPE_OPEN_PX, Math.min(0, dx));
      activeRow.style.transform = `translateX(${tx}px)`;
    }, { passive: true });

    function _onEnd() {
      if (!activeRow || !horizontal) { activeRow = null; horizontal = false; return; }
      activeRow.style.transition = 'transform 180ms ease-out';
      _setOpen(activeRow, dx < -SWIPE_THRESHOLD);
      activeRow = null; horizontal = false;
    }
    cont.addEventListener('pointerup', _onEnd, { passive: true });
    cont.addEventListener('pointercancel', _onEnd, { passive: true });

    // Tap on delete panel → confirm + hide CF.
    cont.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-chat-row-delete]');
      if (!del) return;
      e.stopPropagation();
      const chatId = del.dataset.chatId;
      const fn = _hc('hideMarketplaceChat');
      if (!chatId || !fn) return;
      const ok = await _confirm('ลบแชทนี้ออกจากรายการของคุณ?', {
        title: 'ลบแชท', confirmLabel: 'ลบ', danger: true,
      });
      if (!ok) {
        const row = del.closest('[data-mkt-chat-id]');
        if (row) _setOpen(row, false);
        return;
      }
      try {
        await fn({ chatId });
        // chat-list onSnapshot will re-render; the hiddenBy filter drops this row.
      } catch (err) {
        console.warn('hideMarketplaceChat:', err);
        _toast(err?.message || 'ลบไม่สำเร็จ', 'error');
      }
    });
  }

  // ── Open-or-create (S1.4) ──────────────────────────────────────────────
  async function openOrCreateChat(item) {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions || !window._authUid) {
      _toast('ระบบยังไม่พร้อม ลองใหม่ครับ', 'error');
      return;
    }
    const ownerUid = item?.ownerUid;
    if (!ownerUid) {
      _toast('ประกาศนี้ยังไม่รองรับการแชท', 'warning');
      return;
    }
    try {
      const db = _db();
      const fs = _fs();
      // Find existing chat: (postId == X) ∩ (participants array-contains me).
      const q = fs.query(
        fs.collection(db, COL),
        fs.where('postId', '==', item.id),
        fs.where('participants', 'array-contains', window._authUid)
      );
      const snap = await fs.getDocs(q);
      let chatId = null;
      let chatData = null;
      snap.forEach(d => {
        if (!chatId) {
          chatId = d.id;
          chatData = { id: d.id, ...d.data() };
        }
      });
      if (!chatId) {
        // First contact — create chat with frozen post-context snapshot.
        const now = new Date().toISOString();
        const postImage = item.imageUrl || item.imageData || '';
        const postPrice = item.category === 'free' ? 0 : Number(item.price || 0);
        const newChat = {
          participants: [ownerUid, window._authUid],
          postId: item.id,
          postTitle: item.title || '',
          postImageUrl: postImage,
          postPrice,
          lastMessage: '',
          lastMessageTime: now,
          unreadCount: { [ownerUid]: 0, [window._authUid]: 0 },
          createdAt: now,
        };
        const docRef = await fs.addDoc(fs.collection(db, COL), newChat);
        chatId = docRef.id;
        chatData = { id: chatId, ...newChat };
      }
      openChat(chatData);
    } catch (e) {
      console.warn('_openOrCreateChat:', e);
      _toast('เปิดการสนทนาไม่สำเร็จ ลองใหม่ครับ', 'error');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────
  window.MarketplaceChat = {
    subscribeList,
    renderList,
    renderUnreadBadge,
    openChat,
    subscribeMessages,
    renderMessages,
    sendMessage,
    markRead,
    setReplyTarget,
    cancelReply,
    openActionSheet,
    closeActionSheet,
    actReply,
    actUnsend,
    openOrCreateChat,
    captureDeepLink,
    tryOpenPending,
    // Sprint 7 — close=pause / delete=permanent
    fetchParentPostStatus: _fetchParentPostStatus,
    subscribeParentPostStatus: _subscribeParentPostStatus,
    renderComposerLockState: _renderComposerLockState,
  };

  // ── Legacy global aliases ──────────────────────────────────────────────
  // Every consumer outside this module (HTML data-action attributes, the
  // action-hub at tenant_app.html:8412+, and any place that calls
  // `openChat(chat)` / `_openOrCreateChat(item)` directly) expects the
  // legacy names. Keep them as references — NOT thin wrappers — so a
  // future inline shim doesn't accidentally re-create the function with
  // stale closure.
  window._subscribeChatList = subscribeList;
  window.renderChatList = renderList;
  window._renderMarketChatUnreadBadge = renderUnreadBadge;
  window.openChat = openChat;
  window._subscribeChatMessages = subscribeMessages;
  window.renderChatMessages = renderMessages;
  window.sendChatMessage = sendMessage;
  window._markChatRead = markRead;
  window._setChatReplyTarget = setReplyTarget;
  window._cancelChatReply = cancelReply;
  window._closeChatActionSheet = closeActionSheet;
  window._chatActReply = actReply;
  window._chatActUnsend = actUnsend;
  window._openOrCreateChat = openOrCreateChat;
  window._attachChatLongPress = attachLongPress;
  window._attachChatListSwipe = attachListSwipe;
  window._captureDeepLinkChat = captureDeepLink;
  window._tryOpenPendingChat = tryOpenPending;

  // Capture immediately at script load so LIFF redirect-strip doesn't
  // race the first onSnapshot (which can fire several seconds later).
  captureDeepLink();
})();
