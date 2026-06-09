/**
 * dashboard-trade-history-admin.js — admin read-only monitor for Trade History
 * Memory (Meaning Layer #5). Lives on the Gamification → "ประวัติแลกเปลี่ยน" tab.
 *
 * Read-only: the trade-history record is immutable (written by
 * marketplaceStatsAggregator via admin SDK when a marketplace post completes).
 * There is no moderation action — unlike the food/help boards, a completed
 * trade is a historical fact, not a live state to cancel. Reads all trades
 * across buildings (rule: admin reads any). NO points are shown because #5
 * deliberately awards an achievement, not money (owner decision 2026-06-09).
 *
 * §7-AAA: bounded read — orderBy(completedAt desc) + limit so this append-only
 * collection can't grow the snapshot unbounded, and the NEWEST trades are the
 * ones kept (an unordered limit() would drop them).
 *
 * Top-level function declarations (NOT an IIFE) so the dashboard tab-switcher +
 * event hub reach loadTradeHistoryAdmin by bareword global lookup (§7-QQ/CC).
 * Listener is window-attached for teardown (§7-V).
 */

window._tradeHistoryAdminUnsub = null;
let _tradeHistoryAdminCache = [];

const TRADE_HISTORY_LIMIT = 200;

const TRADE_CAT_LABEL = {
  item: '🛍️ สินค้า', service: '💅 บริการ', free: '🎁 แจกฟรี', request: '✋ ขอรับ',
};

function _thEsc(s) { return String(s == null ? '' : s); }
function _thWho(building, room) { return building && room ? ((building === 'nest' ? 'Nest ' : 'ห้อง ') + room) : '—'; }
function _thMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const n = Date.parse(ts); return Number.isFinite(n) ? n : (Number.isFinite(+ts) ? +ts : 0);
}
function _thWhen(ts) {
  const ms = _thMs(ts);
  if (!ms) return '—';
  try { return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' }); }
  catch (_) { return '—'; }
}

function loadTradeHistoryAdmin() {
  if (window._tradeHistoryAdminUnsub) return; // idempotent (§7-V: teardown on tab leave if ever added)
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const q = fs.query(
    fs.collection(db, 'tradeHistory'),
    fs.orderBy('completedAt', 'desc'),
    fs.limit(TRADE_HISTORY_LIMIT)
  );
  window._tradeHistoryAdminUnsub = fs.onSnapshot(q, snap => {
    _tradeHistoryAdminCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTradeHistoryAdminTable();
  }, err => {
    console.warn('[trade-history-admin] onSnapshot failed:', err);
    const t = document.getElementById('tradeHistoryAdminTable');
    if (t) t.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#b00020;padding:20px;">โหลดไม่สำเร็จ: ${_thEsc(err.message)}</td></tr>`;
  });
}

function renderTradeHistoryAdminTable() {
  const tbody = document.getElementById('tradeHistoryAdminTable');
  const countEl = document.getElementById('tradeHistoryCount');
  if (countEl) countEl.textContent = String(_tradeHistoryAdminCache.length);
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!_tradeHistoryAdminCache.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">ยังไม่มีประวัติการแลกเปลี่ยน</td>';
    tbody.appendChild(tr);
    return;
  }
  _tradeHistoryAdminCache.forEach(r => {
    const tr = document.createElement('tr');
    const td = (txt, mut) => { const c = document.createElement('td'); c.textContent = txt; if (mut) { c.style.fontSize = '.82rem'; c.style.color = 'var(--text-muted)'; } return c; };

    tr.appendChild(td(_thWho(r.building, r.room)));

    // รายการ — thumbnail (https token URL only, §7-XX safe) + title
    const titleTd = td(_thEsc(r.title) || '(ไม่มีชื่อ)');
    if (r.imageUrl) {
      const thumb = document.createElement('img');
      thumb.src = r.imageUrl;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:6px;margin-right:8px;vertical-align:middle;';
      titleTd.insertBefore(thumb, titleTd.firstChild);
    }
    tr.appendChild(titleTd);

    // ประเภท
    const catTd = document.createElement('td');
    catTd.style.cssText = 'font-size:.82rem;';
    catTd.textContent = TRADE_CAT_LABEL[r.category] || r.category || '—';
    tr.appendChild(catTd);

    // ราคา / แจกฟรี
    const priceTd = document.createElement('td');
    priceTd.style.cssText = 'font-size:.82rem;font-weight:600;';
    if (r.isGiveaway) { priceTd.textContent = '🎁 ฟรี'; priceTd.style.color = 'var(--green-dark)'; }
    else if (Number(r.price) > 0) priceTd.textContent = '฿' + Number(r.price).toLocaleString();
    else priceTd.textContent = '—';
    tr.appendChild(priceTd);

    tr.appendChild(td(_thWhen(r.completedAt), true));
    tbody.appendChild(tr);
  });
}

// Cross-script exports (tab-switcher reaches loadTradeHistoryAdmin).
if (typeof window !== 'undefined') {
  window.loadTradeHistoryAdmin = loadTradeHistoryAdmin;
  window.renderTradeHistoryAdminTable = renderTradeHistoryAdminTable;
}
