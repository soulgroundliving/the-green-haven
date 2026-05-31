/**
 * Rich-Text Policy — shared editor + sanitizer for People → Policies tab.
 *
 * Admin writes formatted HTML (bold/italic/size/headings/lists/alignment) in a
 * contenteditable surface; tenant_app renders the same HTML safely. Both sides
 * route content through `sanitize()` so a future compromised admin token can't
 * inject script/iframe/event-handler payloads.
 *
 * Backward compat: existing policies in Firestore are plain text. `renderTo()`
 * detects no-tag content and converts newlines to <br> automatically.
 */
(function() {
  'use strict';

  // === SANITIZER WHITELIST ===
  const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'h2', 'h3', 'h4',
    'p', 'br', 'div', 'span',
    'ul', 'ol', 'li',
    'blockquote',
    'font', // execCommand('fontSize') outputs <font size="N">
    'a'
  ]);
  const ALLOWED_ATTRS_BY_TAG = {
    'a':    ['href', 'target', 'rel'],
    'font': ['size', 'color', 'face'],
    '*':    ['style']
  };
  // CSS properties allowed inside style="..."
  const ALLOWED_CSS_PROPS = new Set([
    'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
    'font-size', 'font-family',
    'color', 'background-color',
    'text-align', 'line-height',
    'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
    'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom'
  ]);
  const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/)/i;

  function _filterStyle(styleStr) {
    if (!styleStr) return '';
    const out = [];
    styleStr.split(';').forEach(decl => {
      const idx = decl.indexOf(':');
      if (idx < 0) return;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!ALLOWED_CSS_PROPS.has(prop)) return;
      // Reject anything trying to escape the value (url(), expression, etc.)
      if (/url\s*\(|expression\s*\(|javascript:/i.test(val)) return;
      out.push(`${prop}: ${val}`);
    });
    return out.join('; ');
  }

  function _walkAndClean(node) {
    // Walk children in reverse so removals don't shift indexes.
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child.nodeType === 1) { // ELEMENT_NODE
        const tag = child.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          // Replace with its text content (don't drop user content silently)
          const text = document.createTextNode(child.textContent || '');
          child.parentNode.replaceChild(text, child);
          continue;
        }
        // Strip all attributes except whitelisted
        const allowed = (ALLOWED_ATTRS_BY_TAG[tag] || []).concat(ALLOWED_ATTRS_BY_TAG['*'] || []);
        for (let j = child.attributes.length - 1; j >= 0; j--) {
          const attr = child.attributes[j];
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) { child.removeAttribute(attr.name); continue; }
          if (!allowed.includes(name)) { child.removeAttribute(attr.name); continue; }
          if (name === 'href') {
            if (!SAFE_URL_RE.test(attr.value)) child.removeAttribute(attr.name);
          } else if (name === 'style') {
            const filtered = _filterStyle(attr.value);
            if (filtered) child.setAttribute('style', filtered);
            else child.removeAttribute('style');
          }
        }
        // Force external links to safe rel + target
        if (tag === 'a' && child.getAttribute('href')) {
          child.setAttribute('rel', 'noopener noreferrer');
          if (!child.hasAttribute('target')) child.setAttribute('target', '_blank');
        }
        _walkAndClean(child);
      } else if (child.nodeType === 8) { // COMMENT
        child.parentNode.removeChild(child);
      }
    }
  }

  function sanitize(html) {
    if (!html || typeof html !== 'string') return '';
    const doc = new DOMParser().parseFromString(`<div id="__rt_root">${html}</div>`, 'text/html');
    const root = doc.getElementById('__rt_root');
    if (!root) return '';
    _walkAndClean(root);
    return root.innerHTML;
  }

  // === BACKWARD-COMPAT RENDER ===
  // Old policies are plain text; new ones are HTML. Detect and render appropriately.
  function _looksLikeHtml(s) {
    return /<\w+[^>]*>/.test(s);
  }
  function _plainToHtml(s) {
    const div = document.createElement('div');
    div.textContent = s; // escape
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  function renderTo(targetEl, content) {
    if (!targetEl) return;
    const raw = String(content || '');
    if (_looksLikeHtml(raw)) {
      targetEl.classList.remove('u-pre-wrap');
      targetEl.innerHTML = sanitize(raw);
    } else {
      targetEl.classList.add('u-pre-wrap');
      targetEl.textContent = raw;
    }
  }

  // === EDITOR MOUNT ===
  // Replaces a placeholder element with [toolbar + contenteditable surface].
  // Returns the contenteditable element (use it later for getContent()).
  const TOOLBAR_HTML = `
    <div class="rt-toolbar" role="toolbar" aria-label="Format">
      <button type="button" data-rt-cmd="bold" title="ตัวหนา (Ctrl+B)" style="font-weight:700;">B</button>
      <button type="button" data-rt-cmd="italic" title="เอียง (Ctrl+I)" style="font-style:italic;">I</button>
      <button type="button" data-rt-cmd="underline" title="ขีดเส้นใต้ (Ctrl+U)" style="text-decoration:underline;">U</button>
      <span class="rt-sep"></span>
      <select data-rt-cmd="formatBlock" title="ระดับหัวข้อ" aria-label="ระดับหัวข้อ">
        <option value="P">ย่อหน้า</option>
        <option value="H2">หัวข้อใหญ่</option>
        <option value="H3">หัวข้อย่อย</option>
        <option value="H4">หัวข้อเล็ก</option>
        <option value="BLOCKQUOTE">คำพูด</option>
      </select>
      <select data-rt-cmd="fontSize" title="ขนาดตัวอักษร" aria-label="ขนาดตัวอักษร">
        <option value="2">ขนาดเล็ก</option>
        <option value="3" selected>ขนาดปกติ</option>
        <option value="5">ขนาดใหญ่</option>
        <option value="6">ใหญ่มาก</option>
      </select>
      <span class="rt-sep"></span>
      <button type="button" data-rt-cmd="insertUnorderedList" title="รายการ">• List</button>
      <button type="button" data-rt-cmd="insertOrderedList" title="ลำดับเลข">1. List</button>
      <span class="rt-sep"></span>
      <button type="button" data-rt-cmd="justifyLeft" title="ชิดซ้าย">⇤</button>
      <button type="button" data-rt-cmd="justifyCenter" title="กึ่งกลาง">↔</button>
      <button type="button" data-rt-cmd="justifyRight" title="ชิดขวา">⇥</button>
      <span class="rt-sep"></span>
      <button type="button" data-rt-cmd="removeFormat" title="ล้างรูปแบบ">✕ ล้าง</button>
    </div>`;

  // CSS moved to shared/components.css (rt-wrap, rt-toolbar, rt-content, etc.)
  // to satisfy CSP style-src-elem hash — dynamic style injection is blocked.
  function _injectStyles() { /* no-op: styles live in components.css */ }

  function mountEditor(placeholderEl, initialContent, opts) {
    if (!placeholderEl) return null;
    if (placeholderEl.dataset.rtMounted === '1') {
      // Already mounted — just update content.
      const editor = placeholderEl.querySelector('.rt-content');
      if (editor) _setContent(editor, initialContent);
      return editor;
    }
    _injectStyles();
    const placeholder = (opts && opts.placeholder) || placeholderEl.dataset.placeholder || '';

    placeholderEl.classList.add('rt-wrap');
    placeholderEl.dataset.rtMounted = '1';
    placeholderEl.innerHTML = TOOLBAR_HTML;

    const editor = document.createElement('div');
    editor.className = 'rt-content';
    editor.contentEditable = 'true';
    editor.spellcheck = false;
    if (placeholder) editor.dataset.placeholder = placeholder;
    placeholderEl.appendChild(editor);

    _setContent(editor, initialContent);
    _wireToolbar(placeholderEl, editor);
    _wirePlaceholder(editor);
    return editor;
  }

  function _setContent(editor, content) {
    const raw = String(content || '');
    if (!raw) {
      editor.innerHTML = '';
    } else if (_looksLikeHtml(raw)) {
      editor.innerHTML = sanitize(raw);
    } else {
      editor.innerHTML = _plainToHtml(raw);
    }
    _refreshPlaceholder(editor);
  }

  function _wireToolbar(wrap, editor) {
    wrap.querySelector('.rt-toolbar').addEventListener('mousedown', e => {
      // Prevent toolbar clicks from stealing focus from editor (selection would collapse).
      if (e.target.closest('button, select')) e.preventDefault();
    });
    wrap.querySelectorAll('button[data-rt-cmd]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const cmd = btn.dataset.rtCmd;
        editor.focus();
        try { document.execCommand(cmd, false, null); } catch (_) {}
        _refreshPlaceholder(editor);
      });
    });
    wrap.querySelectorAll('select[data-rt-cmd]').forEach(sel => {
      sel.addEventListener('change', e => {
        const cmd = sel.dataset.rtCmd;
        const val = sel.value;
        editor.focus();
        try { document.execCommand(cmd, false, val); } catch (_) {}
        // Reset formatBlock dropdown to "ปกติ" so the next click on the same heading reapplies cleanly
        if (cmd === 'formatBlock') sel.value = 'P';
        _refreshPlaceholder(editor);
      });
    });
  }

  function _wirePlaceholder(editor) {
    editor.addEventListener('input', () => _refreshPlaceholder(editor));
    editor.addEventListener('blur',  () => _refreshPlaceholder(editor));
    editor.addEventListener('focus', () => _refreshPlaceholder(editor));
  }

  function _refreshPlaceholder(editor) {
    const empty = !editor.textContent.trim() && !editor.querySelector('img,br,hr');
    if (empty) editor.dataset.empty = '1';
    else delete editor.dataset.empty;
  }

  function getContent(editor) {
    if (!editor) return '';
    return sanitize(editor.innerHTML || '');
  }

  window.RichTextPolicy = {
    sanitize,
    renderTo,
    mountEditor,
    getContent
  };
})();
