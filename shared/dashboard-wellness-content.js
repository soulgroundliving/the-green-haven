const _escWC = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
// ===== CONTENT MANAGEMENT TAB SWITCHING =====
function switchContentTab(tabName, btn) {
  // Hide all content tabs
  document.querySelectorAll('.content-mgmt-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Remove active style from all tab buttons
  document.querySelectorAll('.content-mgmt-tab').forEach(button => button.classList.remove('active'));

  // Show selected tab
  const tabElement = document.getElementById('content-tab-' + tabName);
  const resolvedBtn = btn || document.getElementById('tab-' + tabName + '-btn');
  if(tabElement) {
    tabElement.style.display = 'block';
    if(resolvedBtn) resolvedBtn.classList.add('active');
    // Lazy-init tab content
    if(tabName === 'announcements') initAnnouncementsPage();
    else if(tabName === 'events' && typeof initCommunityEventsPage === 'function') initCommunityEventsPage();
    else if(tabName === 'docs' && typeof initCommunityDocsPage === 'function') initCommunityDocsPage();
    else if(tabName === 'wellness' && typeof initWellnessArticlesPage === 'function') initWellnessArticlesPage();
  }
}

// ===== WELLNESS ARTICLES CRUD =====
// ===== Wellness Article Editor Helpers (no HTML hand-typing) =====
const WELLNESS_ICONS = [
  { icon: 'fa-leaf',         label: 'ใบไม้' },
  { icon: 'fa-spa',          label: 'สปา' },
  { icon: 'fa-heart',        label: 'หัวใจ' },
  { icon: 'fa-bed',          label: 'นอน' },
  { icon: 'fa-utensils',     label: 'อาหาร' },
  { icon: 'fa-running',      label: 'ออกกำลัง' },
  { icon: 'fa-brain',        label: 'จิตใจ' },
  { icon: 'fa-sun',          label: 'แสง' },
  { icon: 'fa-water',        label: 'น้ำ' },
  { icon: 'fa-mug-hot',      label: 'ชา/กาแฟ' },
  { icon: 'fa-home',         label: 'บ้าน' },
  { icon: 'fa-music',        label: 'เพลง' },
  { icon: 'fa-book-reader',  label: 'อ่าน' },
  { icon: 'fa-yin-yang',     label: 'สมดุล' }
];
function ensureWellnessIconPicker() {
  const wrap = document.getElementById('wellness-icon-picker');
  if (!wrap || wrap.dataset.built === '1') return;
  wrap.dataset.built = '1';
  wrap.innerHTML = WELLNESS_ICONS.map(o => `
    <button type="button" data-icon="${o.icon}" onclick="window.pickWellnessIcon('${o.icon}',this)"
      style="padding:8px 12px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:'Sarabun';font-size:.8rem;transition:all .15s;"
      onmouseover="this.style.background='#f0f9f3'" onmouseout="if(this.dataset.selected!=='1')this.style.background='#fff'">
      <i class="fas ${o.icon}" style="color:var(--green);width:14px;text-align:center;"></i>${o.label}
    </button>`).join('');
  // Restore selection from hidden input
  const cur = document.getElementById('wellness-icon')?.value || 'fa-leaf';
  window.pickWellnessIcon(cur);
}
window.pickWellnessIcon = function(icon, btn) {
  const hidden = document.getElementById('wellness-icon');
  if (hidden) hidden.value = icon;
  // Update large preview
  const preview = document.getElementById('wellness-icon-preview');
  if (preview) preview.innerHTML = `<i class="fas ${icon}"></i>`;
  // Highlight selected button
  document.querySelectorAll('#wellness-icon-picker button').forEach(b => {
    if (b.dataset.icon === icon) {
      b.style.background = 'var(--green-pale)';
      b.style.borderColor = 'var(--green)';
      b.dataset.selected = '1';
    } else {
      b.style.background = '#fff';
      b.style.borderColor = 'var(--border)';
      b.dataset.selected = '0';
    }
  });
};

/** Wrap selection in textarea with given prefix/suffix (for B/I) or line-prefix (for lists/h3). */
window.wellnessFormat = function(kind) {
  const ta = document.getElementById('wellness-body');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const before = ta.value.slice(0, start);
  const sel = ta.value.slice(start, end) || (kind === 'h3' ? 'หัวข้อย่อย' : (kind === 'ul' || kind === 'ol' ? 'รายการ' : 'ข้อความ'));
  const after = ta.value.slice(end);
  let inserted = '', cursorOffset = 0;
  if (kind === 'bold')   { inserted = `**${sel}**`;   cursorOffset = inserted.length; }
  if (kind === 'italic') { inserted = `*${sel}*`;     cursorOffset = inserted.length; }
  if (kind === 'h3')     { inserted = `\n## ${sel}\n`; cursorOffset = inserted.length; }
  if (kind === 'ul') {
    inserted = sel.split('\n').map(l => `- ${l}`).join('\n');
    cursorOffset = inserted.length;
  }
  if (kind === 'ol') {
    inserted = sel.split('\n').map((l, i) => `${i+1}. ${l}`).join('\n');
    cursorOffset = inserted.length;
  }
  ta.value = before + inserted + after;
  ta.focus();
  ta.setSelectionRange(start + cursorOffset, start + cursorOffset);
};

/** Convert plain-text/light-markdown body → HTML for storage.
 *  Already-HTML (detected by presence of < tags) passes through unchanged. */
function wellnessBodyToHtml(text) {
  if (!text) return '';
  const t = String(text).trim();
  // If user already wrote HTML (power user), keep as-is
  if (/<\/?(p|div|h[1-6]|ul|ol|li|strong|em|br)\b/i.test(t)) return t;
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Split into paragraph blocks by blank lines
  const blocks = t.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n');
    // List detection: every line starts with "- " or "1. " etc.
    const allUL = lines.every(l => /^\s*[-•]\s+/.test(l));
    const allOL = lines.every(l => /^\s*\d+\.\s+/.test(l));
    if (allUL && lines.length) {
      return '<ul>' + lines.map(l => '<li>' + applyInline(esc(l.replace(/^\s*[-•]\s+/, ''))) + '</li>').join('') + '</ul>';
    }
    if (allOL && lines.length) {
      return '<ol>' + lines.map(l => '<li>' + applyInline(esc(l.replace(/^\s*\d+\.\s+/, ''))) + '</li>').join('') + '</ol>';
    }
    // ## heading
    if (/^##\s+/.test(block)) {
      return '<h3>' + applyInline(esc(block.replace(/^##\s+/, ''))) + '</h3>';
    }
    // Default paragraph; inner newlines become <br>
    return '<p>' + lines.map(l => applyInline(esc(l))).join('<br>') + '</p>';
  }).join('\n');
  function applyInline(s) {
    // **bold** → <strong>, *italic* → <em>
    return s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, '$1<em>$2</em>$3');
  }
}
window.wellnessBodyToHtml = wellnessBodyToHtml;

/** Reverse: HTML → plain-text/markdown for editing existing articles. */
function wellnessHtmlToText(html) {
  if (!html) return '';
  let t = String(html);
  t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n## $1\n');
  t = t.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  t = t.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  t = t.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  t = t.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  t = t.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner) => inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n'));
  t = t.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let i = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++i}. $1\n`).replace(/\$1/g, m => m);
  });
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  t = t.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '');
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.trim();
}
window.wellnessHtmlToText = wellnessHtmlToText;

/** Compress image File → base64 data URL (max 800px wide, JPEG q=0.78). */
function compressImageToBase64(file, maxWidth = 800, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read fail'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode fail'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const useFmt = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(useFmt, quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
window.compressImageToBase64 = compressImageToBase64;

// Cover image (single thumbnail shown in tenant article list)
window._wellnessCoverImage = window._wellnessCoverImage || null;

window.onWellnessCoverPicked = async function(ev) {
  const file = ev.target.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const dataUrl = await compressImageToBase64(file, 600, 0.75);
    window._wellnessCoverImage = dataUrl;
    const preview = document.getElementById('wellness-cover-preview');
    const img = document.getElementById('wellness-cover-img');
    if (preview) preview.style.display = 'block';
    if (img) img.src = dataUrl;
  } catch(e) { console.error('cover image upload failed:', e); }
  ev.target.value = '';
};

window.clearWellnessCover = function() {
  window._wellnessCoverImage = null;
  const preview = document.getElementById('wellness-cover-preview');
  const img = document.getElementById('wellness-cover-img');
  if (preview) preview.style.display = 'none';
  if (img) img.src = '';
  const inp = document.getElementById('wellness-cover-input');
  if (inp) inp.value = '';
};

// Store image data URLs by index so textarea stays readable with [img:N] placeholders
window._wellnessImages = window._wellnessImages || []; // array of dataUrl strings

/** Handle multiple image upload — compress + store + add [img:N] placeholder to body. */
window.onWellnessImagesPicked = async function(ev) {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  const previewEl = document.getElementById('wellness-images-preview');
  const bodyEl = document.getElementById('wellness-body');
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 10 * 1024 * 1024) {
      showToast(`ไฟล์ ${f.name} ใหญ่เกิน 10MB — ข้าม`, 'warning');
      continue;
    }
    try {
      const dataUrl = await compressImageToBase64(f);
      const idx = window._wellnessImages.length;
      window._wellnessImages.push(dataUrl);
      _renderWellnessImageThumb(idx);
      // Insert [img:N] placeholder at cursor position in body
      if (bodyEl) {
        const marker = `\n\n[img:${idx}]\n\n`;
        const start = bodyEl.selectionStart || bodyEl.value.length;
        bodyEl.value = bodyEl.value.slice(0, start) + marker + bodyEl.value.slice(start);
      }
    } catch (e) {
      console.error('image upload failed:', f.name, e);
      showToast(`อัพโหลด ${f.name} ไม่สำเร็จ`, 'error');
    }
  }
  ev.target.value = ''; // reset for re-pick
};

function _renderWellnessImageThumb(idx) {
  const previewEl = document.getElementById('wellness-images-preview');
  if (!previewEl) return;
  const dataUrl = window._wellnessImages[idx];
  if (!dataUrl) return;
  const thumb = document.createElement('div');
  thumb.id = `_wellness-thumb-${idx}`;
  thumb.style.cssText = 'position:relative;width:100px;height:100px;border:1px solid var(--border);border-radius:6px;overflow:hidden;';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  const label = document.createElement('div');
  label.textContent = `[img:${idx}]`;
  label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.7);color:#fff;font-size:.65rem;text-align:center;padding:2px;font-family:monospace;';
  thumb.appendChild(img);
  thumb.appendChild(label);
  previewEl.appendChild(thumb);
}

/** Replace [img:N] placeholders with <img src="..."> in saved HTML body. */
function expandWellnessImages(html) {
  if (!html || !window._wellnessImages?.length) return html;
  return html.replace(/\[img:(\d+)\]/g, (_m, n) => {
    const url = window._wellnessImages[Number(n)];
    if (!url) return '';
    return `<img src="${url}" style="max-width:100%;border-radius:8px;margin:8px 0;display:block;" alt="">`;
  });
}
window.expandWellnessImages = expandWellnessImages;

/** Reverse: convert <img src="data:..."> back into [img:N] placeholders + restore _wellnessImages. */
function collapseWellnessImages(html) {
  if (!html) return html;
  window._wellnessImages = [];
  let idx = 0;
  return html.replace(/<img[^>]*src="(data:image\/[^"]+)"[^>]*\/?>/gi, (_m, src) => {
    window._wellnessImages.push(src);
    return `\n\n[img:${idx++}]\n\n`;
  });
}
window.collapseWellnessImages = collapseWellnessImages;

function resetWellnessImages() {
  window._wellnessImages = [];
  const p = document.getElementById('wellness-images-preview');
  if (p) p.innerHTML = '';
}
window.resetWellnessImages = resetWellnessImages;

// Phase: Live wellness articles via onSnapshot (was one-shot getDocs)
let _wellnessUnsub = null;
let _wellnessCache = null;
async function initWellnessArticlesPage() {
  ensureWellnessIconPicker();
  // Render immediately from cache (or empty placeholder) so user doesn't see blank
  await renderWellnessArticlesList();
  if (_wellnessUnsub) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    setTimeout(initWellnessArticlesPage, 1500);
    return;
  }
  try {
    const db = window.firebase.firestore();
    const { collection, onSnapshot } = window.firebase.firestoreFunctions;
    // No orderBy — Firestore would silently exclude docs missing the field.
    // Sort client-side instead.
    _wellnessUnsub = onSnapshot(collection(db, 'wellness_articles'), snap => {
      const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      // Newest first, fallback to title for stable order
      docs.sort((a, b) => {
        const ta = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : (a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0);
        const tb = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : (b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0);
        if (ta !== tb) return tb - ta;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      _wellnessCache = docs;
      renderWellnessArticlesList();
    }, err => console.warn('wellness onSnapshot:', err?.message));
  } catch(e) { console.warn('wellness subscribe:', e); }
}

async function saveWellnessArticle() {
  const title   = document.getElementById('wellness-title').value.trim();
  const icon    = (document.getElementById('wellness-icon').value.trim() || 'fa-leaf').replace(/^fa[srlb]?\s+/, '');
  const excerpt = document.getElementById('wellness-excerpt').value.trim();
  const bodyRaw = document.getElementById('wellness-body').value.trim();
  // Auto-convert plain text → HTML, then expand [img:N] placeholders → <img>
  const body = expandWellnessImages(wellnessBodyToHtml(bodyRaw));
  const category= document.getElementById('wellness-category').value;
  const readtime= parseInt(document.getElementById('wellness-readtime').value) || 3;
  const reward  = parseInt(document.getElementById('wellness-reward').value) || 0;
  const editId  = document.getElementById('wellness-edit-id').value;

  if (!title || !excerpt || !bodyRaw) {
    if (typeof showToast === 'function') showToast('กรอกหัวข้อ + คำโปรย + เนื้อหาให้ครบ', 'error');
    return;
  }
  if (!window.firebase?.firestore) {
    if (typeof showToast === 'function') showToast('Firebase ยังไม่พร้อม ลองรีเฟรชหน้า', 'error');
    return;
  }

  const db = window.firebase.firestore();
  const { collection, doc, addDoc, setDoc, serverTimestamp } = window.firebase.firestoreFunctions || {};
  const data = { title, icon, excerpt, body, category, readtime, reward, updatedAt: serverTimestamp ? serverTimestamp() : new Date(), coverImage: window._wellnessCoverImage || null };

  try {
    if (editId) {
      await setDoc(doc(db, 'wellness_articles', editId), data, { merge: true });
      if (typeof showToast === 'function') showToast('อัปเดตบทความเรียบร้อย', 'success');
    } else {
      data.createdAt = serverTimestamp ? serverTimestamp() : new Date();
      await addDoc(collection(db, 'wellness_articles'), data);
      if (typeof showToast === 'function') showToast('บันทึกบทความใหม่แล้ว', 'success');
    }
    resetWellnessForm();
    await renderWellnessArticlesList();
  } catch (e) {
    console.error('saveWellnessArticle failed:', e);
    if (typeof showToast === 'function') showToast('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error');
  }
}

function resetWellnessForm() {
  ['wellness-title','wellness-icon','wellness-excerpt','wellness-body','wellness-edit-id'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const rt = document.getElementById('wellness-readtime'); if (rt) rt.value = '3';
  const rw = document.getElementById('wellness-reward'); if (rw) rw.value = '5';
  const cat = document.getElementById('wellness-category'); if (cat) cat.value = 'Wellness';
  if (typeof resetWellnessImages === 'function') resetWellnessImages();
  if (typeof window.clearWellnessCover === 'function') window.clearWellnessCover();
  if (typeof window.pickWellnessIcon === 'function') window.pickWellnessIcon('fa-leaf');
}

async function renderWellnessArticlesList() {
  const el = document.getElementById('wellnessList');
  if (!el) return;
  // Use cached snapshot if available (populated by onSnapshot in initWellnessArticlesPage)
  let docs = _wellnessCache;
  if (!docs) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">⌛ กำลังโหลด...</div>';
    if (!window.firebase?.firestore) { el.innerHTML = '<div style="color:var(--danger);padding:20px;">Firebase ไม่พร้อม</div>'; return; }
    try {
      const db = window.firebase.firestore();
      const { collection, getDocs } = window.firebase.firestoreFunctions || {};
      const snap = await getDocs(collection(db, 'wellness_articles'));
      docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
      docs.sort((a, b) => {
        const ta = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : (a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0);
        const tb = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : (b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0);
        if (ta !== tb) return tb - ta;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      _wellnessCache = docs;
    } catch (e) {
      console.error('renderWellnessArticlesList getDocs:', e);
      el.innerHTML = '<div style="color:var(--danger);padding:20px;">โหลดรายการไม่สำเร็จ: ' + _escWC(e.message || String(e)) + '</div>';
      return;
    }
  }
  if (!docs.length) { el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px;">ยังไม่มีบทความ — เขียนบทความแรกด้านบน</div>'; return; }
  try {
    el.innerHTML = docs.map(({ id, data: a }) => {
      const d = { id };
      const title = _escWC(a.title || '');
      const excerpt = _escWC(a.excerpt || '');
      return `<div style="padding:1rem;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:var(--green-pale);color:var(--green);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ${a.icon || 'fa-leaf'}"></i></div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;margin-bottom:4px;">${title}</div>
          <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:6px;">${excerpt}</div>
          <div style="font-size:.75rem;color:var(--text-muted);">${a.category || 'Wellness'} • อ่าน ${a.readtime || 3} นาที • ${a.reward > 0 ? '+' + a.reward + ' pts' : 'ไม่ให้แต้ม'}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="editWellnessArticle('${d.id}')" style="padding:6px 10px;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun';font-size:.8rem;">✏️ แก้</button>
          <button data-wid="${_escWC(d.id)}" data-wtitle="${title}" onclick="deleteWellnessArticle(this.dataset.wid,this.dataset.wtitle)" style="padding:6px 10px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:'Sarabun';font-size:.8rem;">🗑️ ลบ</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('renderWellnessArticlesList failed:', e);
    el.innerHTML = '<div style="color:var(--danger);padding:20px;">โหลดรายการไม่สำเร็จ: ' + (e.message || e) + '</div>';
  }
}

async function editWellnessArticle(id) {
  if (!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const { doc, getDoc } = window.firebase.firestoreFunctions || {};
  try {
    const snap = await getDoc(doc(db, 'wellness_articles', id));
    if (!snap.exists()) return;
    const a = snap.data();
    document.getElementById('wellness-title').value = a.title || '';
    // Sync icon picker (visual + hidden input)
    if (typeof window.pickWellnessIcon === 'function') window.pickWellnessIcon(a.icon || 'fa-leaf');
    else { const ic = document.getElementById('wellness-icon'); if (ic) ic.value = a.icon || 'fa-leaf'; }
    document.getElementById('wellness-excerpt').value = a.excerpt || '';
    // Reset images, then collapse <img> back to [img:N] for editing
    resetWellnessImages();
    const collapsed = collapseWellnessImages(a.body || '');
    // Re-render thumbnails for restored images
    (window._wellnessImages || []).forEach((_, idx) => _renderWellnessImageThumb(idx));
    // Convert stored HTML back to plain text for editing
    document.getElementById('wellness-body').value = (typeof wellnessHtmlToText === 'function')
      ? wellnessHtmlToText(collapsed) : collapsed;
    document.getElementById('wellness-category').value = a.category || 'Wellness';
    document.getElementById('wellness-readtime').value = a.readtime || 3;
    document.getElementById('wellness-reward').value = a.reward ?? 5;
    document.getElementById('wellness-edit-id').value = id;
    // Restore cover image if saved
    if (a.coverImage) {
      window._wellnessCoverImage = a.coverImage;
      const preview = document.getElementById('wellness-cover-preview');
      const img = document.getElementById('wellness-cover-img');
      if (preview) preview.style.display = 'block';
      if (img) img.src = a.coverImage;
    } else {
      if (typeof window.clearWellnessCover === 'function') window.clearWellnessCover();
    }
    document.getElementById('wellness-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { console.error('editWellnessArticle failed:', e); }
}

// Seed: 7 starter Wellness articles (mirrors hardcoded fallback in tenant_app.html
// const WELLNESS_ARTICLES). Pushed to Firestore once so admin can edit them.
async function seedWellnessStarters() {
  if (!confirm('นำเข้าบทความตัวอย่าง 7 บทความเข้า Firestore?\n(ถ้ามีอยู่แล้วจะไม่ทับ — id เดียวกันจะข้าม)')) return;
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    showToast('Firebase ยังไม่พร้อม', 'error');
    return;
  }
  const STARTERS = [
    { id:'sleep-bedroom',  icon:'fa-spa',         title:'3 เคล็ดลับจัดห้องนอนหลับลึก', excerpt:'ลองปรับแสงไฟโทนอุ่น และวางต้นไม้เล็กๆ ช่วยให้เช้าวันใหม่สดชื่น...', category:'Wellness', readtime:3, reward:5,
      body:'<p><strong>1. ปรับแสงให้อุ่นก่อนนอน 1 ชั่วโมง</strong> — หลอดไฟโทนเหลือง 2700K ช่วยให้ร่างกายหลั่งเมลาโทนิน เข้าสู่โหมดพักผ่อนเร็วขึ้น</p><p><strong>2. ต้นไม้ฟอกอากาศหัวเตียง</strong> — พลูด่าง หรือลิ้นมังกร ดูดซับ CO₂ ตอนกลางคืน ช่วยให้อากาศสดชื่น หลับสนิทขึ้น</p><p><strong>3. อุณหภูมิ 24-26°C</strong> — ร่างกายหลับลึกที่สุดในช่วงนี้ ตั้งแอร์ไว้และห่มผ้าบางๆ ดีกว่าห้องเย็นจัดแล้วห่มหนา</p><p>ลองปรับแค่ 1-2 ข้อแล้วสังเกตคุณภาพการนอนในสัปดาห์นี้</p>' },
    { id:'amethyst-power', icon:'fa-gem',         title:'พลังของ \'หินนำโชค\' อเมทิสต์', excerpt:'ทำความรู้จักกับอเมทิสต์ที่จะช่วยให้ใจคุณสงบ และดึงดูดสิ่งดีๆ...', category:'Mindfulness', readtime:3, reward:5,
      body:'<p>อเมทิสต์เป็นหินในตระกูลควอตซ์สีม่วง ที่โบราณเชื่อว่าช่วย <strong>สงบจิตใจ</strong> และ <strong>ปัดเป่าพลังลบ</strong></p><p><strong>วิธีวางในห้อง:</strong> วางบนโต๊ะทำงาน (ด้านซ้ายสุด ใกล้ประตู) หรือหัวเตียง สะท้อนแสงอ่อนๆ ทำให้บรรยากาศสงบ</p><p><strong>การดูแล:</strong> ล้างด้วยน้ำเปล่าเดือนละครั้ง ตากแดดอ่อนๆ ช่วงเช้า 30 นาที เป็นการ "ชาร์จพลัง" ให้หิน</p><p>นอกจากความเชื่อ การมี object สวยๆ อยู่ในสายตาก็ช่วยลดความเครียดได้จริง</p>' },
    { id:'balcony-charge', icon:'fa-mug-hot',     title:'มุมระเบียงชาร์จพลัง', excerpt:'เปลี่ยนพื้นที่เล็กๆ ให้เป็นที่นั่งดูพระอาทิตย์ตกดินสุดพิเศษสำหรับคุณ...', category:'Lifestyle', readtime:3, reward:5,
      body:'<p>ระเบียง 2×1 เมตร ก็สร้างมุมพักใจได้ ลองทำตามนี้</p><p><strong>เบาะนั่งพื้น</strong> — ซื้อเบาะผ้า waterproof ขนาด 60×60 ซม. + หมอนอิงใบใหญ่ จะได้มุมนั่งทันที</p><p><strong>ต้นไม้แนวตั้ง</strong> — แขวนกระถางพลูบนราวกันตก ประหยัดพื้นที่ + ช่วยกรองฝุ่น PM2.5</p><p><strong>โคมไฟ solar</strong> — ไม่ต้องเดินสายไฟ เก็บแสงกลางวัน กลางคืนให้แสงอุ่นธรรมชาติ</p><p>เวลาที่ดีที่สุดคือ 17:00-18:30 น. ดูแสงส้มกับดื่มชาร้อน</p>' },
    { id:'morning-ritual', icon:'fa-sun',         title:'Morning Ritual 10 นาที เริ่มวันดีทั้งวัน', excerpt:'ลองสร้างนิสัยเล็กๆ ที่ทำให้สมองพร้อมก่อนเช็คโทรศัพท์ครั้งแรก...', category:'Wellness', readtime:3, reward:5,
      body:'<p>อย่าเพิ่งหยิบมือถือทันทีที่ตื่น เปลี่ยนเป็น 10 นาทีนี้แทน</p><p><strong>นาทีที่ 1-3:</strong> ดื่มน้ำเปล่า 1 แก้ว เปิดม่าน รับแสงแดด (รีเซ็ต circadian rhythm)</p><p><strong>นาทีที่ 4-7:</strong> ยืดกล้ามเนื้อง่ายๆ คอ ไหล่ หลัง หายใจลึกๆ 5 ครั้ง</p><p><strong>นาทีที่ 8-10:</strong> เขียน 3 สิ่งที่รู้สึกขอบคุณในสมุด (gratitude journaling)</p><p>ทำแค่ 7 วันจะเห็นความต่าง พลังงานเช้าขึ้นและอารมณ์ดีตลอดวัน</p>' },
    { id:'aromatherapy',   icon:'fa-wind',        title:'กลิ่นที่ช่วยคลายเครียดในห้องคอนโด', excerpt:'Lavender, Bergamot, Eucalyptus — 3 กลิ่นที่ควรมีติดห้องไว้...', category:'Health', readtime:3, reward:5,
      body:'<p>Aromatherapy ไม่ใช่แค่ของสวย — มีงานวิจัยยืนยันผลจริง</p><p><strong>Lavender (ลาเวนเดอร์)</strong> — ใช้ก่อนนอน 30 นาที ลดคลื่นสมองให้ผ่อนคลาย งานวิจัยพบว่าช่วยปรับปรุงคุณภาพการนอน 20%</p><p><strong>Bergamot (เบอร์กามอท)</strong> — ใช้ช่วงบ่าย ลดความวิตกกังวล ให้อารมณ์สดชื่นขึ้น</p><p><strong>Eucalyptus (ยูคาลิปตัส)</strong> — ใช้เช้า ปลุกสมองให้ตื่นตัว เหมาะช่วง WFH</p><p>ใช้ diffuser ดีกว่าเทียนหอม (ปลอดภัยในห้องเล็ก)</p>' },
    { id:'indoor-plants',  icon:'fa-leaf',        title:'5 ต้นไม้ในร่มที่เลี้ยงง่ายสุดๆ', excerpt:'ไม่ต้องรดน้ำบ่อย ไม่ต้องแดดเยอะ แต่ฟอกอากาศได้...', category:'Home', readtime:3, reward:5,
      body:'<p>ต้นไม้ 5 ชนิดนี้ แม้ไม่มีมือเขียวก็เลี้ยงรอด</p><p><strong>1. พลูด่าง (Pothos)</strong> — รดน้ำสัปดาห์ละครั้ง แสงน้อยได้ ฟอก formaldehyde</p><p><strong>2. ลิ้นมังกร (Snake Plant)</strong> — ทนแล้ง ปล่อย O₂ ตอนกลางคืน (วางข้างเตียงได้)</p><p><strong>3. ZZ Plant</strong> — "ต้นฆ่าไม่ตาย" รดน้ำ 2-3 สัปดาห์ครั้ง</p><p><strong>4. Peace Lily</strong> — ดอกสวย ชอบที่ชื้น เหมาะในห้องน้ำ</p><p><strong>5. Monstera</strong> — ใบใหญ่ตระการตา โตเร็ว เติม aesthetic ให้ห้อง</p>' },
    { id:'digital-detox',  icon:'fa-mobile-alt',  title:'Digital Detox 1 ชั่วโมงก่อนนอน', excerpt:'แสงสีฟ้าและการ scroll ก่อนนอน = คุณภาพการนอนแย่ลง...', category:'Wellness', readtime:3, reward:5,
      body:'<p>งานวิจัยชัดเจน: แสงสีฟ้าจากหน้าจอกดการหลั่ง melatonin ทำให้หลับยาก + หลับไม่ลึก</p><p><strong>วิธีทำ Digital Detox:</strong></p><p>• ตั้ง alarm "bedtime mode" 1 ชม. ก่อนนอน</p><p>• วางโทรศัพท์นอกห้องนอน (ใช้นาฬิกาปลุกแทน)</p><p>• เปลี่ยนเป็น <strong>หนังสือเล่ม</strong> ฟังพอดแคสต์เบาๆ หรือเขียน journal</p><p>ยากวันแรก ง่ายวันที่ 4 หลังจากนั้นคุณภาพการนอนดีขึ้นชัดเจน</p>' }
  ];
  const db = window.firebase.firestore();
  const { collection, doc, getDoc, setDoc, serverTimestamp } = window.firebase.firestoreFunctions;
  let pushed = 0, skipped = 0, failed = 0;
  for (const s of STARTERS) {
    try {
      const ref = doc(collection(db, 'wellness_articles'), s.id);
      const snap = await getDoc(ref);
      if (snap.exists()) { skipped++; continue; }
      await setDoc(ref, {
        ...s,
        createdAt: serverTimestamp ? serverTimestamp() : new Date(),
        updatedAt: serverTimestamp ? serverTimestamp() : new Date()
      });
      pushed++;
    } catch (e) { console.error('seed', s.id, e); failed++; }
  }
  showToast(`✅ Seed เสร็จ: เพิ่ม ${pushed} / ข้าม ${skipped} / ล้มเหลว ${failed}`,
            failed ? 'warning' : 'success');
}

async function deleteWellnessArticle(id, title) {
  if (!confirm(`ลบบทความ "${title}" ใช่ไหม?`)) return;
  if (!window.firebase?.firestore) return;
  const db = window.firebase.firestore();
  const { doc, deleteDoc } = window.firebase.firestoreFunctions || {};
  try {
    await deleteDoc(doc(db, 'wellness_articles', id));
    if (typeof showToast === 'function') showToast('ลบบทความแล้ว', 'success');
    await renderWellnessArticlesList();
  } catch (e) {
    console.error('deleteWellnessArticle failed:', e);
    if (typeof showToast === 'function') showToast('ลบไม่สำเร็จ', 'error');
  }
}

