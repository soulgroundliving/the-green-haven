(function() {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────
  let _clInstance   = null;   // current instance doc
  let _clBuilding   = '';
  let _clRoomId     = '';
  let _clTenantUid  = '';
  let _clSigCtx     = null;   // canvas 2D context
  let _clSigDrawing = false;
  let _clSigLastPos = null;
  let _clUploading  = false;
  let _clClaimWait  = 0;      // claim-token retry counter

  // ── Signature pad setup ───────────────────────────────────────────────
  function _initSignatureCanvas() {
    const canvas = document.getElementById('cl-signature-canvas');
    if (!canvas || _clSigCtx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    _clSigCtx = canvas.getContext('2d');
    _clSigCtx.scale(dpr, dpr);
    _clSigCtx.strokeStyle = '#1a1a1a';
    _clSigCtx.lineWidth   = 2;
    _clSigCtx.lineCap     = 'round';
    _clSigCtx.lineJoin    = 'round';

    function _pos(e) {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }
    function _start(e) {
      e.preventDefault();
      _clSigDrawing = true;
      _clSigLastPos = _pos(e);
      _clSigCtx.beginPath();
      _clSigCtx.moveTo(_clSigLastPos.x, _clSigLastPos.y);
    }
    function _move(e) {
      if (!_clSigDrawing) return;
      e.preventDefault();
      const p = _pos(e);
      _clSigCtx.lineTo(p.x, p.y);
      _clSigCtx.stroke();
      _clSigLastPos = p;
    }
    function _end(e) { _clSigDrawing = false; }

    canvas.addEventListener('mousedown', _start);
    canvas.addEventListener('mousemove', _move);
    canvas.addEventListener('mouseup', _end);
    canvas.addEventListener('mouseleave', _end);
    canvas.addEventListener('touchstart', _start, { passive: false });
    canvas.addEventListener('touchmove',  _move,  { passive: false });
    canvas.addEventListener('touchend',   _end);
  }

  window.clClearSignature = function() {
    if (_clSigCtx) {
      const c = document.getElementById('cl-signature-canvas');
      _clSigCtx.clearRect(0, 0, c.offsetWidth, c.offsetHeight);
    }
  };

  function _sigDataUrl() {
    const c = document.getElementById('cl-signature-canvas');
    if (!c) return null;
    return c.toDataURL('image/png');
  }

  function _isSigEmpty() {
    const c = document.getElementById('cl-signature-canvas');
    if (!c || !_clSigCtx) return true;
    const d = _clSigCtx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) return false; }
    return true;
  }

  // ── Page init ─────────────────────────────────────────────────────────
  async function _initChecklistPage() {
    const statusEl = document.getElementById('cl-status-area');
    const formEl   = document.getElementById('cl-form-area');
    const doneEl   = document.getElementById('cl-done-area');
    if (!statusEl) return;

    // Reset visibility
    formEl && formEl.classList.add('ta-sect-hidden');
    doneEl && doneEl.classList.add('ta-sect-hidden');
    statusEl.innerHTML = '<div class="gh-skeleton" style="height:1em; width:60%; margin:0 auto 12px;"></div>'
                       + '<div class="gh-skeleton" style="height:1em; width:80%; margin:0 auto 12px;"></div>'
                       + '<div class="gh-skeleton" style="height:120px; border-radius:12px; margin:8px 16px 0;"></div>';

    if (!window.ChecklistManager) {
      statusEl.innerHTML = '<div style="color:#888;text-align:center;padding:2rem;">เปิดในแอป LIFF เพื่อใช้งาน</div>';
      return;
    }

    // PDPA: gate first-ever form render behind explicit consent. We use a
    // localStorage flag for the fast path and a server-side ledger row at
    // consents/{tenantId}_checklist_v1 for proof. The CF is fire-and-forget;
    // even if the ledger write fails the UX continues — the worst case is
    // re-prompting on the next device/install.
    const _consentKey = 'cl_consent_v1';
    if (!localStorage.getItem(_consentKey)) {
      // In-app GhModal (per CLAUDE.md §7-Q: native confirm() can't be
      // screenshotted in support flows and looks off-brand in LIFF).
      const consentBody = document.createElement('div');
      consentBody.style.cssText = 'font-size:var(--fs-sm); line-height:1.55; color:var(--text-dark);';
      consentBody.innerHTML =
        '<p style="margin:0 0 10px;">การกรอกใบตรวจสภาพห้องจะมีการเก็บ:</p>' +
        '<ul style="margin:0 0 12px; padding-left:20px;">' +
          '<li>รูปภาพภายในห้องที่คุณแนบ</li>' +
          '<li>ลายเซ็นของคุณ</li>' +
          '<li>บันทึก/หมายเหตุที่คุณพิมพ์</li>' +
        '</ul>' +
        '<p style="margin:0; color:var(--text-muted); font-size:var(--fs-sm);">ใช้เพื่อยืนยันสภาพห้อง ณ วันย้ายเข้า/ย้ายออกเท่านั้น — ลบอัตโนมัติภายใน 2 ปีหลังแอดมินเซ็นรับ</p>';
      const ok = await window.GhModal.confirm({
        title: '🛡️ ข้อตกลงการใช้ข้อมูลส่วนบุคคล (PDPA)',
        body: consentBody,
        confirmLabel: 'ยินยอม',
        cancelLabel: 'ยกเลิก',
        dismissible: false,
      });
      if (!ok) {
        if (typeof goBackToService === 'function') goBackToService();
        return;
      }
      localStorage.setItem(_consentKey, '1');
      // Fire-and-forget server ledger write
      try {
        const fn = window.firebase?.functions?.httpsCallable?.('recordChecklistConsent');
        if (fn) fn({ purpose: 'checklist_v1', noticeVersion: 'v1', userAgent: navigator.userAgent.slice(0, 256) })
          .catch(e => console.warn('[checklist] consent ledger write failed (non-fatal):', e?.message));
      } catch (_) { /* CF not wired in this build — non-fatal */ }
    }

    try {
      // Prefer room+building lookup (stable across anon UID drift). Falls
      // back to tenantUid for compatibility with older instances created
      // before this fix — and so the function still works during a brief
      // window when room/building claims aren't yet on the token.
      if (_clBuilding && _clRoomId) {
        _clInstance = await window.ChecklistManager.getInstanceForMyRoom(_clBuilding, _clRoomId);
      }
      if (!_clInstance && _clTenantUid) {
        _clInstance = await window.ChecklistManager.getMyLatestInstance(_clTenantUid);
      }
    } catch (err) {
      // §7-U/§7-P: permission-denied here usually means the auth token
      // doesn't yet carry the building/room claims (custom-token sign-in
      // race). Auto-retry ONCE when liffLinked next fires — that event is
      // guaranteed to post-date setCustomUserClaims + signInWithCustomToken.
      const isPermErr = err?.code === 'permission-denied'
        || /Missing or insufficient permissions/i.test(err?.message || '');
      if (isPermErr && _clClaimWait < 1) {
        _clClaimWait++;
        statusEl.innerHTML = `<div style="text-align:center;padding:2rem;color:#888;">⏳ รอ LIFF claims sync... <small style="display:block;margin-top:.4rem;color:#bbb;font-size:.7rem;">(retrying after LINE link refresh)</small></div>`;
        const retry = () => { try { _initChecklistPage(); } catch (_) {} };
        // [audit-skip] this IS the §7-U/§7-P recovery pattern — explicit one-shot
        // liffLinked retry after a permission-denied caught above. Don't wrap.
        window.addEventListener('liffLinked', retry, { once: true });
        // Belt-and-braces: also retry after 4s in case liffLinked already
        // dispatched for this page session and won't fire again.
        setTimeout(retry, 4000);
        return;
      }
      statusEl.innerHTML = `<div style="color:#c62828;padding:1rem;">โหลดข้อมูลไม่ได้: ${_esc(err.message || String(err))} <button type="button" data-action="reloadPage" style="display:block;margin:.8rem auto 0;padding:.4rem 1.1rem;background:var(--green-dark);color:#fff;border:none;border-radius:6px;cursor:pointer;">🔄 รีเฟรช</button></div>`;
      return;
    }

    if (!_clInstance) {
      // Diagnostic: surface the actual search params on screen so admin can
      // confirm whether doc.building/doc.roomId match this tenant's token
      // claims. Most "stuck at ยังไม่มี" reports are data drift between
      // liffUsers.room (token.room) and doc.roomId (e.g. '15' vs '15ก').
      console.warn('[checklist] no instance found for', { building: _clBuilding, roomId: _clRoomId, tenantUid: _clTenantUid });
      statusEl.innerHTML = `<div class="card" style="text-align:center;padding:2rem;"><div style="font-size:2rem;margin-bottom:.5rem;">🗒️</div><div style="color:#888;font-size:.9rem;">ยังไม่มี checklist รอดำเนินการ</div><div style="margin-top:.5rem;font-size:.8rem;color:#bbb;">ผู้ดูแลจะสร้างใบตรวจให้คุณก่อนย้ายเข้า/ออก</div><div style="margin-top:.6rem;font-size:.7rem;color:#ccc;">(ห้อง ${_esc(_clRoomId)} · ${_esc(_clBuilding)})</div></div>`;
      return;
    }

    statusEl.innerHTML = '';

    // If already submitted/signed
    if (_clInstance.status !== 'pending') {
      doneEl && (doneEl.style.display = '');
      const doneMsg = document.getElementById('cl-done-msg');
      const statusMap = { submitted: 'รอผู้ดูแลเซ็นกลับ', admin_signed: 'เสร็จสมบูรณ์ ✅' };
      if (doneMsg) doneMsg.textContent = statusMap[_clInstance.status] || _clInstance.status;
      return;
    }

    // Show form
    const titleEl = document.getElementById('cl-form-title');
    if (titleEl) {
      const typeLabel = _clInstance.type === 'move_out' ? '📦 ย้ายออก' : '🏠 ย้ายเข้า';
      titleEl.textContent = `${typeLabel} — ห้อง ${_clInstance.roomId}`;
    }

    _renderItemsList();
    formEl && formEl.classList.remove('ta-sect-hidden');

    // Init signature canvas after layout
    setTimeout(_initSignatureCanvas, 100);
  }

  function _renderItemsList() {
    const list = document.getElementById('cl-items-list');
    if (!list || !_clInstance) return;
    const items = _clInstance.items || [];
    // Two file inputs per item: one forces camera, one opens gallery.
    // Both are hidden — user taps the visible button labels above them.
    // After a file is chosen, the picker row hides and the preview row
    // (with retake/remove buttons) takes its place.
    list.innerHTML = items.map((item, idx) => `
      <div id="cl-item-${idx}" style="border-bottom:1px solid #f0f0f0;padding:.75rem 0;">
        <div style="font-weight:600;font-size:.9rem;margin-bottom:.4rem;">${idx+1}. ${_esc(item.label)}</div>
        <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;font-size:.85rem;">
          <input type="checkbox" id="cl-check-${idx}" style="width:18px;height:18px;"> ผ่าน / OK
        </label>
        <textarea id="cl-note-${idx}" rows="1" placeholder="หมายเหตุ (ถ้ามี)"
          style="width:100%;padding:.4rem;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:.82rem;box-sizing:border-box;resize:none;"></textarea>

        <!-- Hidden file inputs: one for camera, one for gallery. -->
        <input type="file" id="cl-photo-${idx}"        accept="image/*" capture="environment" style="display:none;" data-action-change="clPhotoChange" data-idx="${idx}">
        <input type="file" id="cl-photo-${idx}-gallery" accept="image/*"                      style="display:none;" data-action-change="clPhotoChange" data-idx="${idx}">

        <!-- Picker buttons (shown when no photo selected) -->
        <div id="cl-photo-picker-${idx}" style="display:flex;gap:.5rem;margin-top:.4rem;flex-wrap:wrap;">
          <button type="button" data-action="clRequestPhoto" data-idx="${idx}" data-source="camera"
            style="flex:1;min-width:120px;padding:.5rem;font-size:.82rem;color:#1976d2;background:#e3f2fd;border:1px dashed #90caf9;border-radius:6px;cursor:pointer;font-family:inherit;">
            📷 ถ่ายรูป
          </button>
          <button type="button" data-action="clRequestPhoto" data-idx="${idx}" data-source="gallery"
            style="flex:1;min-width:120px;padding:.5rem;font-size:.82rem;color:#388e3c;background:#e8f5e9;border:1px dashed #a5d6a7;border-radius:6px;cursor:pointer;font-family:inherit;">
            🖼️ เลือกจากคลังภาพ
          </button>
        </div>

        <!-- Preview + action buttons (shown when a photo is selected) -->
        <div id="cl-photo-preview-${idx}" style="margin-top:.4rem;display:none;"></div>
      </div>
    `).join('');
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // First-time permission notice. Shown ONCE per LIFF install (gated by
  // localStorage) before the first 📷 or 🖼️ tap actually opens the OS
  // picker. After the user taps "ดำเนินการ" we set the flag and proceed —
  // subsequent taps go straight to the OS picker as before.
  window.clRequestPhoto = function(idx, source) {
    const proceed = () => {
      const id = source === 'gallery' ? `cl-photo-${idx}-gallery` : `cl-photo-${idx}`;
      const el = document.getElementById(id);
      if (el) el.click();
    };
    try {
      if (!localStorage.getItem('cl_photo_notice_shown')) {
        // In-app modal — see PDPA consent above for rationale.
        // Promise-based; the click chain is short so .then() is fine without
        // awaiting (no later state to consume).
        window.GhModal.confirm({
          title: '📸 แนบรูปภาพหลักฐาน',
          body: 'แอปจะใช้กล้องหรือรูปภาพในคลังของคุณเพื่อแนบหลักฐานการตรวจห้อง — รูปภาพจะถูกส่งให้แอดมินดูเท่านั้น ไม่เผยแพร่ที่ไหน',
          confirmLabel: 'ดำเนินการ',
          cancelLabel: 'ยกเลิก',
        }).then(ok => {
          if (!ok) return;
          try { localStorage.setItem('cl_photo_notice_shown', '1'); } catch (_) { /* private mode */ }
          proceed();
        });
        return;
      }
    } catch (_) { /* localStorage may be disabled — fall through */ }
    proceed();
  };

  window.clPhotoChange = function(input, idx) {
    const preview = document.getElementById(`cl-photo-preview-${idx}`);
    const picker  = document.getElementById(`cl-photo-picker-${idx}`);
    if (!input.files[0] || !preview) return;
    const url = URL.createObjectURL(input.files[0]);
    // Mirror selection across both inputs so clSubmit's getElementById
    // (which only reads `cl-photo-${idx}`, the camera input) sees the
    // file regardless of which picker actually captured it.
    if (input.id.endsWith('-gallery')) {
      try {
        const camInput = document.getElementById(`cl-photo-${idx}`);
        if (camInput) {
          const dt = new DataTransfer();
          dt.items.add(input.files[0]);
          camInput.files = dt.files;
        }
      } catch (_) { /* DataTransfer may not exist on old browsers — submit will fall back to gallery input */ }
    }
    preview.style.display = 'block';
    preview.innerHTML =
      `<img src="${url}" alt="preview" style="max-width:100%;max-height:160px;border-radius:6px;object-fit:cover;display:block;">` +
      `<div style="display:flex;gap:.5rem;margin-top:.3rem;">` +
        `<button type="button" data-action="clRequestPhoto" data-idx="${idx}" data-source="camera" style="flex:1;padding:.4rem;font-size:.78rem;color:#1976d2;background:#fff;border:1px solid #90caf9;border-radius:6px;cursor:pointer;font-family:inherit;">🔄 ถ่ายใหม่</button>` +
        `<button type="button" data-action="clRequestPhoto" data-idx="${idx}" data-source="gallery" style="flex:1;padding:.4rem;font-size:.78rem;color:#388e3c;background:#fff;border:1px solid #a5d6a7;border-radius:6px;cursor:pointer;font-family:inherit;">🖼️ เลือกใหม่</button>` +
        `<button type="button" data-action="clRemovePhoto" data-idx="${idx}" style="padding:.4rem .65rem;font-size:.78rem;color:#c62828;background:#fff;border:1px solid #ef9a9a;border-radius:6px;cursor:pointer;font-family:inherit;">🗑️</button>` +
      `</div>`;
    if (picker) picker.style.display = 'none';
  };

  window.clRemovePhoto = function(idx) {
    const camInput     = document.getElementById(`cl-photo-${idx}`);
    const galInput     = document.getElementById(`cl-photo-${idx}-gallery`);
    const preview      = document.getElementById(`cl-photo-preview-${idx}`);
    const picker       = document.getElementById(`cl-photo-picker-${idx}`);
    if (camInput) camInput.value = '';
    if (galInput) galInput.value = '';
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    if (picker)  picker.style.display = 'flex';
  };

  // ── Submit ────────────────────────────────────────────────────────────
  window.clSubmit = async function() {
    if (!_clInstance || _clUploading) return;
    if (_isSigEmpty()) { alert('กรุณาเซ็นชื่อก่อนส่ง'); return; }

    // Required items check — each item needs a tick OR a note
    const _preItems = (_clInstance.items || []).map((item, idx) => ({
      checked: document.getElementById(`cl-check-${idx}`)?.checked || false,
      note:    (document.getElementById(`cl-note-${idx}`)?.value || '').trim(),
    }));
    const _unfilled = _preItems.filter(it => !it.checked && !it.note);
    if (_unfilled.length > 0) {
      alert(`ยังมี ${_unfilled.length} รายการที่ยังไม่ได้ตรวจสอบ\n\nกรุณาติ๊กถูก หรือเพิ่มหมายเหตุสำหรับทุกรายการก่อนส่ง`);
      return;
    }

    const submitBtn = document.getElementById('cl-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ กำลังส่ง...'; }
    _clUploading = true;

    try {
      const items = _clInstance.items || [];
      const filledItems = items.map((item, idx) => {
        const checked = document.getElementById(`cl-check-${idx}`)?.checked || false;
        const note    = document.getElementById(`cl-note-${idx}`)?.value?.trim() || '';
        // Fallback to gallery input if the DataTransfer mirror failed in
        // clPhotoChange (older WebViews without DataTransfer support).
        const file    = document.getElementById(`cl-photo-${idx}`)?.files?.[0]
                     || document.getElementById(`cl-photo-${idx}-gallery`)?.files?.[0]
                     || null;
        return { id: item.id, note, checked, _file: file, photoPath: null };
      });

      // Upload photos
      for (const fi of filledItems) {
        if (fi._file) {
          try {
            fi.photoPath = await window.ChecklistManager.uploadPhoto(
              _clInstance.instanceId, _clBuilding, _clRoomId, fi.id, fi._file
            );
          } catch (_) { /* non-fatal — photo optional */ }
        }
        delete fi._file;
      }

      // Upload signature
      const sigDataUrl = _sigDataUrl();
      const tenantSignaturePath = await window.ChecklistManager.uploadSignature(
        _clInstance.instanceId, _clBuilding, _clRoomId, sigDataUrl
      );

      // Submit via CF
      await window.ChecklistManager.submitChecklist(
        _clInstance.instanceId, filledItems, tenantSignaturePath
      );

      // Show done state
      document.getElementById('cl-form-area').classList.add('ta-sect-hidden');
      document.getElementById('cl-done-area').classList.remove('ta-sect-hidden');
      const msg = document.getElementById('cl-done-msg');
      if (msg) msg.textContent = 'ส่งใบตรวจแล้ว — รอผู้ดูแลเซ็นกลับ';

    } catch (err) {
      alert('ส่งไม่ได้: ' + (err.message || err));
    } finally {
      _clUploading = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✅ ส่งใบตรวจห้อง'; }
    }
  };

  // ── Wire into showSubPage ─────────────────────────────────────────────
  const _origSSP_cl = window.showSubPage;
  window.showSubPage = function(page) {
    if (page === 'checklist') {
      // Delegate page swap to canonical showSubPage (line ~4773). This is
      // the same pattern facility-booking uses at line ~12419. The canonical
      // path correctly updates `_currentPageEl` so subsequent navigation
      // hides the checklist; doing the swap inline here leaves the tracker
      // pointing at the prior page → checklist bleeds under every page
      // after first open (anti-pattern G, 2026-05-15 incident).
      if (_origSSP_cl) _origSSP_cl(page);

      // Show loading immediately so the user sees something is happening
      // even if claims take a moment to propagate.
      const _clStatusEl = document.getElementById('cl-status-area');
      if (_clStatusEl) _clStatusEl.innerHTML = '<div class="gh-skeleton" style="height:1em; width:60%; margin:0 auto 12px;"></div>'
                                             + '<div class="gh-skeleton" style="height:1em; width:80%; margin:0 auto 12px;"></div>'
                                             + '<div class="gh-skeleton" style="height:120px; border-radius:12px; margin:8px 16px 0;"></div>';
      const _clFormEl = document.getElementById('cl-form-area');
      const _clDoneEl = document.getElementById('cl-done-area');
      if (_clFormEl) _clFormEl.classList.add('ta-sect-hidden');
      if (_clDoneEl) _clDoneEl.classList.add('ta-sect-hidden');
      _clSigCtx = null;

      // Gate init on LIFF claims — without this, tapping before custom-token
      // sign-in completes left the page hanging on ⏳ and triggered a
      // separate permission_denied bills toast (anti-pattern A).
      window._onLiffClaimsReady(async function _clInitOnce() {
        // Idempotent: re-read fresh state each fire.
        // Read from canonical window globals set by detectRoomBuilding() +
        // linkAuthUid() in the main script block (same source every other
        // auth-gated subscriber uses — §7-BB).
        _clBuilding  = window._tenantAppBuilding || 'rooms';
        _clRoomId    = window._tenantAppRoom     || '';
        _clTenantUid = window._authUid || '';
        if (!_clTenantUid) {
          // Anon sign-in hasn't completed yet (or failed) — show clear msg
          if (_clStatusEl) _clStatusEl.innerHTML = '<div style="text-align:center;padding:2rem;color:#c62828;">⛔ ยังไม่ได้เข้าระบบ — ลองปิด/เปิด LINE ใหม่</div>';
          return;
        }
        if (!_clRoomId) {
          // signInWithCustomToken hasn't completed yet — _tenantAppRoom is unset.
          // Show clear status + diagnostic so the user knows what's pending.
          // The _onLiffClaimsReady listener re-fires on liffLinked, so this
          // recovers automatically once LIFF link completes.
          if (_clStatusEl) _clStatusEl.innerHTML = `<div style="text-align:center;padding:2rem;color:#888;">⏳ รอ LIFF เชื่อมต่อห้อง... <small style="display:block;margin-top:.4rem;color:#bbb;font-size:.7rem;">(uid=${_esc(_clTenantUid.slice(0,8))} · ห้องยังไม่ถูก map)</small></div>`;
          return;
        }
        // Fire the query — let Firestore enforce. If server-side token
        // claims aren't ready yet (rare race), the catch in _initChecklistPage
        // schedules ONE retry on the next liffLinked event. Previous attempt
        // to client-side-gate via getIdTokenResult left the page stuck on
        // ⏳ forever when the auth cache was out of sync with the LIFF flow.
        _initChecklistPage();
      });
      return;
    }
    if (_origSSP_cl) _origSSP_cl(page);
  };

  // Show/hide checklist card only when user has a pending instance (non-intrusive check)
  window._onLiffClaimsReady(function(tok) {
    _clBuilding  = tok.building || 'rooms';
    _clRoomId    = tok.room     || '';
    _clTenantUid = window._authUid || '';
    // The card is always visible — no need to hide it; user sees it on services page
  });

})();
