// shared/tenant-pet-health.js
// Pet health memory — an ongoing timeline (vet visit / vaccine / weight / med /
// note) per pet. Meaning Layer #9 (roadmap), opens the Pet pillar.
//
// DATA MODEL (tasks/todo.md DECISION 1, owner-locked 2026-06-10): entries live
// as a `healthLog[]` ARRAY on the pet doc — tenants/{b}/list/{r}/pets/{petId}.
// This makes archive / erasure / DSR-export / Storage-cleanup ride on the proven
// pet lifecycle (no new rule, no recursiveDelete, no nested-archive — §7-DD/L
// avoided). Capacity is a non-issue: an entry is metadata only (files go to
// Storage); 1 MB ⇒ ~5000 entries, a 2-yr lease ≈ <100.
//
// REPOSITORY BOUNDARY ("ต่อยอดได้" owner directive): EVERY Firestore touch is in
// _petRef / _readPet / _writeLog / addEntry / removeEntry. A future array→
// subcollection migration changes ONLY those five — the UI + pure helpers stay.
//
// Requires (window globals):
//   _taBuilding, _taRoom            — var globals (tenant-liff-auth.js)
//   toast, showSubPage              — global UI/nav helpers
//   firebase + firestoreFunctions   — modular SDK wrapper (doc/getDoc/updateDoc)
//   _taUploadPetFile                — exposed by tenant-pets.js (DRY Storage upload)
//
// Pure helpers (HEALTH_TYPES, healthTypeMeta, validateHealthInput,
//   buildHealthEntry, sortHealthLog) are exported via module.exports in a node
//   realm for unit tests (shared/__tests__/tenant-pet-health.test.js).
//
// Anti-patterns honoured: §7-A/U (claim guard before read/write; the page opens
//   on a user tap so claims are already set, but _taBuilding/_taRoom is still
//   guarded), §7-BB (_taBuilding — never the phantom _liffClaims), §7-I
//   (tenant-initiated; no auto-click; the write is a surgical updateDoc({healthLog})
//   that NEVER rewrites the admin-controlled `status`), §7-N (read-fail → a
//   visible error, never a stuck spinner), §7-X (every render path writes
//   non-empty content), §7-RR (all styling is static .ph-* in components.css —
//   never an injected <style>), feedback_modal_security (DOM API + textContent
//   for user-entered title/note/fileName — no innerHTML for user data).

'use strict';
(function () {
    // ── PURE helpers (tested in a node realm) ───────────────────────────────
    // Catalog of entry types. `key` is persisted; emoji/label/color are display.
    var HEALTH_TYPES = [
        { key: 'vet',     emoji: '🩺', label: 'พบสัตวแพทย์', color: '#2563eb' },
        { key: 'vaccine', emoji: '💉', label: 'วัคซีน',       color: '#16a34a' },
        { key: 'weight',  emoji: '⚖️', label: 'ชั่งน้ำหนัก',  color: '#d97706' },
        { key: 'med',     emoji: '💊', label: 'ยา/รักษา',      color: '#db2777' },
        { key: 'note',    emoji: '📝', label: 'บันทึกทั่วไป',  color: '#6b7280' },
    ];
    var TITLE_MAX = 120;
    var NOTE_MAX = 500;
    var WEIGHT_MAX = 200; // kg — a sane upper bound (largest pet dog ≈ 90kg)

    // Resolve a type key → its display meta. Unknown/absent → the 'note' fallback
    // (never throws, never returns undefined) so a corrupt entry still renders.
    function healthTypeMeta(type) {
        for (var i = 0; i < HEALTH_TYPES.length; i++) {
            if (HEALTH_TYPES[i].key === type) return HEALTH_TYPES[i];
        }
        return HEALTH_TYPES[HEALTH_TYPES.length - 1]; // 'note'
    }

    // Validate raw form input. Returns { ok:true } or { ok:false, error:<thai> }.
    function validateHealthInput(input) {
        input = input || {};
        var hasType = false;
        for (var i = 0; i < HEALTH_TYPES.length; i++) {
            if (HEALTH_TYPES[i].key === input.type) { hasType = true; break; }
        }
        if (!hasType) return { ok: false, error: 'กรุณาเลือกประเภท' };

        if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) {
            return { ok: false, error: 'กรุณาเลือกวันที่' };
        }

        var title = (input.title == null ? '' : String(input.title)).trim();
        if (!title) return { ok: false, error: 'กรุณาระบุหัวข้อ' };
        if (title.length > TITLE_MAX) return { ok: false, error: 'หัวข้อยาวเกินไป (สูงสุด ' + TITLE_MAX + ' ตัวอักษร)' };

        var note = (input.note == null ? '' : String(input.note));
        if (note.length > NOTE_MAX) return { ok: false, error: 'บันทึกยาวเกินไป (สูงสุด ' + NOTE_MAX + ' ตัวอักษร)' };

        if (input.weightKg !== null && input.weightKg !== undefined && input.weightKg !== '') {
            var w = Number(input.weightKg);
            if (!isFinite(w) || w <= 0 || w > WEIGHT_MAX) {
                return { ok: false, error: 'น้ำหนักไม่ถูกต้อง (0–' + WEIGHT_MAX + ' กก.)' };
            }
        }
        return { ok: true };
    }

    // Normalise validated input → a persisted entry. `now` (ms) is injected so
    // tests are deterministic; the browser passes Date.now().
    function buildHealthEntry(input, now) {
        input = input || {};
        now = (typeof now === 'number' && isFinite(now)) ? now : 0;
        var meta = healthTypeMeta(input.type);
        var w = (input.weightKg === null || input.weightKg === undefined || input.weightKg === '')
            ? null : Number(input.weightKg);
        return {
            id: 'ph_' + now,
            type: meta.key,
            date: String(input.date || ''),
            title: (input.title == null ? '' : String(input.title)).trim(),
            note: (input.note == null ? '' : String(input.note)).trim(),
            weightKg: (w !== null && isFinite(w)) ? w : null,
            fileURL: input.fileURL ? String(input.fileURL) : null,
            filePath: input.filePath ? String(input.filePath) : null,
            fileName: input.fileName ? String(input.fileName) : null,
            createdAt: new Date(now).toISOString(),
        };
    }

    // Newest first: by event `date` desc, tie-break `createdAt` desc. Pure +
    // immutable (returns a new array; never mutates the input).
    function sortHealthLog(log) {
        if (!Array.isArray(log)) return [];
        return log.slice().sort(function (a, b) {
            var da = (a && a.date) || '';
            var db = (b && b.date) || '';
            if (da !== db) return da < db ? 1 : -1;
            var ca = (a && a.createdAt) || '';
            var cb = (b && b.createdAt) || '';
            if (ca !== cb) return ca < cb ? 1 : -1;
            return 0;
        });
    }

    // ── Node realm (unit tests): export pure helpers + stop (no DOM/Firebase) ──
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        if (typeof module !== 'undefined' && module.exports) {
            module.exports = {
                HEALTH_TYPES: HEALTH_TYPES,
                healthTypeMeta: healthTypeMeta,
                validateHealthInput: validateHealthInput,
                buildHealthEntry: buildHealthEntry,
                sortHealthLog: sortHealthLog,
            };
        }
        return;
    }

    // ── Browser-only below ──────────────────────────────────────────────────
    var _currentPetId = null;
    var _saving = false;

    function _toast(msg, kind) {
        if (typeof window.toast === 'function') window.toast(msg, kind);
    }

    // ── Repository layer (the ONLY Firestore-touching code) ─────────────────
    function _ctx() {
        var building = window._taBuilding || '';
        var room = window._taRoom || '';
        if (!building || !room) return null;                         // §7-A/U claim guard
        if (!window.firebase || !window.firebase.firestore || !window.firebase.firestoreFunctions) return null;
        return {
            db: window.firebase.firestore(),
            fs: window.firebase.firestoreFunctions,
            building: building,
            room: String(room),
        };
    }

    function _petRef(c, petId) {
        return c.fs.doc(c.db, 'tenants', c.building, 'list', c.room, 'pets', petId);
    }

    async function _readPet(petId) {
        var c = _ctx();
        if (!c) return null;
        var snap = await c.fs.getDoc(_petRef(c, petId));
        if (!snap || !snap.exists()) return null;
        return Object.assign({ id: snap.id }, snap.data());
    }

    // Surgical: writes ONLY healthLog (never touches admin-controlled `status`).
    async function _writeLog(petId, log) {
        var c = _ctx();
        if (!c) throw new Error('ยังไม่พร้อม — กรุณาลองใหม่');
        await c.fs.updateDoc(_petRef(c, petId), { healthLog: log });
    }

    async function addEntry(petId, entry) {
        var pet = await _readPet(petId);
        if (!pet) throw new Error('ไม่พบข้อมูลสัตว์เลี้ยง');
        var log = Array.isArray(pet.healthLog) ? pet.healthLog.slice() : [];
        log.push(entry);
        await _writeLog(petId, log);
        return log;
    }

    async function removeEntry(petId, entryId) {
        var pet = await _readPet(petId);
        if (!pet) throw new Error('ไม่พบข้อมูลสัตว์เลี้ยง');
        var log = (Array.isArray(pet.healthLog) ? pet.healthLog : []).filter(function (e) {
            return e && e.id !== entryId;
        });
        await _writeLog(petId, log);
        return log;
    }

    // ── Rendering (DOM API for user data — feedback_modal_security) ──────────
    function _el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function _buildEntryCard(entry) {
        var meta = healthTypeMeta(entry.type);
        var card = _el('div', 'ph-entry');

        var dot = _el('div', 'ph-entry__dot');
        dot.style.background = meta.color;
        dot.textContent = meta.emoji;
        card.appendChild(dot);

        var body = _el('div', 'ph-entry__body');

        var head = _el('div', 'ph-entry__head');
        head.appendChild(_el('span', 'ph-entry__type', meta.label));
        head.appendChild(_el('span', 'ph-entry__date', entry.date || ''));
        body.appendChild(head);

        body.appendChild(_el('div', 'ph-entry__title', entry.title || '(ไม่มีหัวข้อ)'));

        if (entry.note) body.appendChild(_el('div', 'ph-entry__note', entry.note));

        var chips = _el('div', 'ph-entry__chips');
        var hasChip = false;
        if (entry.weightKg != null && isFinite(Number(entry.weightKg))) {
            chips.appendChild(_el('span', 'ph-entry__chip', '⚖️ ' + Number(entry.weightKg) + ' กก.'));
            hasChip = true;
        }
        // File link — only honour https Storage URLs (defence-in-depth vs javascript:)
        if (entry.fileURL && /^https:\/\//.test(String(entry.fileURL))) {
            var a = _el('a', 'ph-entry__file', '📎 ' + (entry.fileName || 'ไฟล์แนบ'));
            a.href = entry.fileURL;
            a.target = '_blank';
            a.rel = 'noopener';
            chips.appendChild(a);
            hasChip = true;
        }
        if (hasChip) body.appendChild(chips);

        card.appendChild(body);

        var del = _el('button', 'ph-entry__del', '🗑️');
        del.type = 'button';
        del.setAttribute('aria-label', 'ลบรายการนี้');
        del.setAttribute('data-action', 'deletePetHealthEntry');
        del.setAttribute('data-arg', entry.id);
        card.appendChild(del);

        return card;
    }

    function _renderTimeline(pet) {
        var box = document.getElementById('pet-health-timeline');
        if (!box) return;
        var log = sortHealthLog(pet && pet.healthLog);
        box.replaceChildren();
        if (!log.length) {
            // §7-X: never leave the slot empty.
            var empty = _el('div', 'ph-empty');
            empty.appendChild(_el('div', 'ph-empty__icon', '📋'));
            empty.appendChild(_el('p', 'ph-empty__title', 'ยังไม่มีบันทึกสุขภาพ'));
            empty.appendChild(_el('p', 'ph-empty__text', 'เพิ่มการพบสัตวแพทย์ น้ำหนัก หรือวัคซีน เพื่อเก็บประวัติของน้อง'));
            box.appendChild(empty);
            return;
        }
        for (var i = 0; i < log.length; i++) box.appendChild(_buildEntryCard(log[i]));
    }

    function _renderError(msg) {
        var box = document.getElementById('pet-health-timeline');
        if (!box) return;
        box.replaceChildren();
        var e = _el('p', 'ph-error', msg || 'โหลดไม่สำเร็จ — กรุณา Reload');
        box.appendChild(e);
    }

    function _setPetName(pet) {
        var h = document.getElementById('pet-health-pet-name');
        if (!h) return;
        if (!pet) { h.textContent = '🐾 ประวัติสุขภาพ'; return; }
        var emoji = pet.typeEmoji || pet.type || '🐾';
        h.textContent = emoji + ' น้อง' + (pet.name || '');
    }

    function _todayISO() {
        var d = new Date();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + day;
    }

    function _resetForm() {
        var ids = ['ph-title', 'ph-note', 'ph-weight'];
        ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
        var t = document.getElementById('ph-type'); if (t) t.value = 'vet';
        var d = document.getElementById('ph-date'); if (d) d.value = _todayISO();
        var f = document.getElementById('ph-file'); if (f) f.value = '';
        var fn = document.getElementById('ph-file-name'); if (fn) fn.textContent = '';
    }

    async function _renderPage() {
        _setPetName(null);
        var box = document.getElementById('pet-health-timeline');
        if (box) { box.replaceChildren(); box.appendChild(_el('p', 'ph-loading', 'กำลังโหลด…')); }
        if (!_currentPetId) { _renderError('ไม่พบสัตว์เลี้ยง'); return; }
        if (!window._taBuilding || !window._taRoom) { _renderError('กรุณาเปิดผ่าน LINE เพื่อดูข้อมูล'); return; }
        try {
            var pet = await _readPet(_currentPetId);
            if (!pet) { _setPetName(null); _renderError('ไม่พบข้อมูลสัตว์เลี้ยง'); return; }
            _setPetName(pet);
            _renderTimeline(pet);
        } catch (e) {
            console.warn('[pet-health] render failed:', e && e.message);
            _renderError('โหลดไม่สำเร็จ — กรุณา Reload');                 // §7-N
        }
    }

    // ── Public actions (wired via data-action; the dispatcher passes data-arg) ─
    function openPetHealth(petId) {
        _currentPetId = petId || null;
        _resetForm();
        if (typeof window.showSubPage === 'function') window.showSubPage('pet-health-page');
        _renderPage();
    }

    function updatePetHealthFilePreview(input) {
        var fn = document.getElementById('ph-file-name');
        if (fn) fn.textContent = (input && input.files && input.files[0]) ? ('📎 ' + input.files[0].name) : '';
    }

    async function savePetHealthEntry() {
        if (_saving) return;
        if (!_currentPetId) { _toast('ไม่พบสัตว์เลี้ยง', 'error'); return; }
        if (!window._taBuilding || !window._taRoom) { _toast('กรุณาเปิดผ่าน LINE', 'error'); return; }

        var input = {
            type: (document.getElementById('ph-type') || {}).value || '',
            date: (document.getElementById('ph-date') || {}).value || '',
            title: (document.getElementById('ph-title') || {}).value || '',
            note: (document.getElementById('ph-note') || {}).value || '',
            weightKg: (document.getElementById('ph-weight') || {}).value || '',
        };
        var v = validateHealthInput(input);
        if (!v.ok) { _toast(v.error, 'error'); return; }

        var btn = document.getElementById('ph-save-btn');
        _saving = true;
        if (btn) btn.disabled = true;
        try {
            // Optional file (vet doc / lab result) → existing pet Storage prefix,
            // reusing tenant-pets.js's uploader (DRY). Best-effort: a failed upload
            // saves the rest of the entry, mirroring saveNewPet's vaccine-book path.
            var file = (document.getElementById('ph-file') || {}).files;
            file = file && file[0];
            if (file && typeof window._taUploadPetFile === 'function') {
                try {
                    var up = await window._taUploadPetFile(file, window._taBuilding, String(window._taRoom), _currentPetId, 'health');
                    input.fileURL = up.url; input.filePath = up.path; input.fileName = up.fileName;
                } catch (e) {
                    console.warn('[pet-health] file upload failed:', e && e.message);
                    _toast('แนบไฟล์ไม่สำเร็จ — บันทึกข้อมูลที่เหลือต่อ', 'warning');
                }
            }
            var entry = buildHealthEntry(input, Date.now());
            await addEntry(_currentPetId, entry);
            _toast('บันทึกประวัติสุขภาพแล้ว');
            _resetForm();
            await _renderPage();
        } catch (e) {
            console.warn('[pet-health] save failed:', e && e.message);
            _toast((e && e.message) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
        } finally {
            _saving = false;
            if (btn) btn.disabled = false;
        }
    }

    function deletePetHealthEntry(entryId) {
        if (!entryId || !_currentPetId) return;
        // User-initiated (a tap on 🗑️) → an explicit confirm is OK (§7-I: no
        // auto-action; the tenant chose to delete). Native confirm works in LIFF.
        var ok = (typeof window.confirm === 'function') ? window.confirm('ลบรายการนี้ออกจากประวัติสุขภาพ?') : true;
        if (!ok) return;
        removeEntry(_currentPetId, entryId)
            .then(function () { _toast('ลบรายการแล้ว'); return _renderPage(); })
            .catch(function (e) {
                console.warn('[pet-health] delete failed:', e && e.message);
                _toast('ลบไม่สำเร็จ กรุณาลองใหม่', 'error');
            });
    }

    // ── Exports ─────────────────────────────────────────────────────────────
    window.openPetHealth = openPetHealth;
    window.savePetHealthEntry = savePetHealthEntry;
    window.deletePetHealthEntry = deletePetHealthEntry;
    window.updatePetHealthFilePreview = updatePetHealthFilePreview;
    // Pure helpers + repository ops exposed for tests/console debug (mirrors the
    // window.TenantReputation convention).
    window.PetHealth = {
        HEALTH_TYPES: HEALTH_TYPES,
        healthTypeMeta: healthTypeMeta,
        validateHealthInput: validateHealthInput,
        buildHealthEntry: buildHealthEntry,
        sortHealthLog: sortHealthLog,
        addEntry: addEntry,
        removeEntry: removeEntry,
        _renderPage: _renderPage,
    };
})();
